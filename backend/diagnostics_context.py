import json
import math
from contextlib import closing
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import analytics_service
import db
import time_utils
from exercise_biomechanics import (
    ALL_ADAPTOR_JOINTS,
    EXERCISE_BIOMECHANICS,
    JOINT_MOBILITY_FALLBACKS,
    JOINT_SAFE_SWAPS,
    REGION_TO_ADAPTOR_MAP,
    classify_activity_biomechanics,
    normalize_exercise_id,
)
from time_utils import UK_TZ, uk_now

MAX_CONTEXT_JSON_CHARS = 15500


def _finite_float(val: Any) -> Optional[float]:
    if val is None or isinstance(val, bool):
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _parse_date_bounds(client_date: Optional[str]) -> Tuple[date, str]:
    now_uk = uk_now()
    today_date = now_uk.date()
    if client_date:
        try:
            parsed = datetime.strptime(str(client_date)[:10], "%Y-%m-%d").date()
            if (today_date - timedelta(days=7)) <= parsed <= today_date:
                today_date = parsed
        except ValueError:
            pass
    return today_date, today_date.isoformat()


def _extract_session_exercise_ids(payload: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    if not isinstance(payload, dict):
        return out
    details = payload.get("details")
    if isinstance(details, dict):
        for raw_key, entry in details.items():
            if raw_key in ("duration_min", "notes", "preset", "goal"):
                continue
            if isinstance(entry, dict) and entry.get("logged") is False:
                continue
            norm = normalize_exercise_id(raw_key)
            if norm in EXERCISE_BIOMECHANICS and norm not in out:
                out.append(norm)
    exercises = payload.get("exercises")
    if isinstance(exercises, list):
        for item in exercises:
            raw_id = item.get("id") if isinstance(item, dict) else item
            norm = normalize_exercise_id(raw_id)
            if norm in EXERCISE_BIOMECHANICS and norm not in out:
                out.append(norm)
    return out


def _extract_garmin_exercise_ids(act: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    ex_sets = act.get("exercise_sets") if isinstance(act, dict) else None
    if not isinstance(ex_sets, list):
        return out
    for item in ex_sets:
        if not isinstance(item, dict):
            continue
        for raw_candidate in (
            item.get("exercise_id"),
            item.get("exercise_name"),
            item.get("exercise_category"),
            item.get("category"),
            item.get("name"),
        ):
            raw_name = str(raw_candidate or "").strip().lower().replace(" ", "_")
            if not raw_name:
                continue
            norm = normalize_exercise_id(raw_name)
            if norm in EXERCISE_BIOMECHANICS and norm not in out:
                out.append(norm)
    return out


def _dedup_unified_workouts(
    state: Dict[str, Any],
    sessions: List[Dict[str, Any]],
    manual_acts: List[Dict[str, Any]],
    today_date: date,
    window_days: int,
) -> List[Dict[str, Any]]:
    """Aggregate and deduplicate workouts across Garmin, manual logs, and in-app sessions (priority 2 > 1 > 0)."""
    win_start = today_date - timedelta(days=window_days - 1)
    candidates: List[Tuple[int, date, Optional[datetime], float, bool, Dict[str, Any]]] = []

    def _push(
        raw_ts: Any,
        raw_date_str: Optional[str],
        calories: Any,
        duration_min: Any,
        source: str,
        name: str,
        sub_title: str,
        activity_type_key: str,
        exercise_ids: List[str],
        avg_hr: Any,
        max_hr: Any,
        source_bucket: str,
        priority: int,
    ) -> None:
        src_l = str(source or "").strip().lower()
        nm_l = str(name or "").strip().lower()
        if src_l == "garmin_via_mnd_bridge" and "daily steps" in nm_l:
            return
        cals = _finite_float(calories) or 0.0
        dur = _finite_float(duration_min) or 0.0
        load = cals if cals > 0.0 else (dur * 6.0)
        if load <= 0.0 and not exercise_ids:
            return

        dt = time_utils.parse_uk_ts(raw_ts)
        has_time = bool(dt and (dt.hour or dt.minute or dt.second))
        if dt is not None:
            d = dt.date()
        else:
            d_dt = time_utils.parse_uk_ts(raw_date_str)
            if d_dt is None:
                return
            d = d_dt.date()
            dt = d_dt
            has_time = False
        if d > today_date or d < win_start:
            return

        bio = classify_activity_biomechanics(name, sub_title, activity_type_key, exercise_ids)
        rec = {
            "date": d.isoformat(),
            "source": source_bucket,
            "name": str(name or sub_title or "Workout")[:80],
            "duration_min": round(dur, 1),
            "calories": int(round(cals)),
            "avg_hr": int(round(_finite_float(avg_hr) or 0)) or None,
            "max_hr": int(round(_finite_float(max_hr) or 0)) or None,
            "stressed_joints": bio["stressed_joints"],
            "impact_level": bio["impact_level"],
            "kinetic_chain": bio["kinetic_chain"],
            "exercise_ids": exercise_ids[:8],
            "_load": load,
        }
        candidates.append((priority, d, dt, load, has_time, rec))

    garmin_obj = state.get("garmin") if isinstance(state.get("garmin"), dict) else {}
    seen_garmin_ids: Set[str] = set()
    for act in [*(garmin_obj.get("today_activities") or []), *(garmin_obj.get("recent_activities") or [])]:
        if not isinstance(act, dict):
            continue
        aid = str(act.get("id") or "")
        if aid and aid in seen_garmin_ids:
            continue
        if aid:
            seen_garmin_ids.add(aid)
        _push(
            act.get("date"),
            None,
            act.get("calories") or act.get("workout_calories"),
            act.get("duration_min") or act.get("durationMin"),
            act.get("source") or "garmin_oauth",
            act.get("name") or act.get("sub_title") or "Garmin Workout",
            act.get("sub_title") or act.get("subTitle") or "",
            act.get("activity_type_key") or "",
            _extract_garmin_exercise_ids(act),
            act.get("avg_hr") or act.get("avgHr"),
            act.get("max_hr") or act.get("maxHr"),
            "garmin",
            priority=2,
        )

    for act in manual_acts or []:
        if not isinstance(act, dict):
            continue
        payload = act.get("payload") if isinstance(act.get("payload"), dict) else {}
        _push(
            act.get("timestamp"),
            act.get("date_str"),
            act.get("calories"),
            act.get("duration_min"),
            payload.get("source") or "manual_app_entry",
            act.get("name") or "Manual Activity",
            act.get("sub_title") or "",
            payload.get("activity_type_key") or "",
            _extract_session_exercise_ids(payload),
            act.get("avg_hr"),
            act.get("max_hr"),
            "manual",
            priority=1,
        )

    for sess in sessions or []:
        if not isinstance(sess, dict):
            continue
        payload = sess.get("payload") if isinstance(sess.get("payload"), dict) else {}
        details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
        _push(
            sess.get("timestamp"),
            sess.get("date_str"),
            sess.get("calories"),
            details.get("duration_min") or 0.0,
            "workout_session",
            payload.get("title") or sess.get("preset") or "PULSE Strength Session",
            sess.get("goal") or "",
            "",
            _extract_session_exercise_ids(payload),
            None,
            None,
            "workout_session",
            priority=0,
        )

    candidates.sort(key=lambda item: (-item[0], item[1], item[2].timestamp() if item[2] else 0.0))

    kept: List[Dict[str, Any]] = []
    kept_by_date: Dict[date, List[Tuple[Optional[datetime], float, int, bool]]] = {}
    for priority, d, dt, load, has_time, rec in candidates:
        existing = kept_by_date.setdefault(d, [])
        is_dup = False
        for kept_dt, kept_load, kept_prio, kept_has_time in existing:
            if priority != kept_prio and abs(load - kept_load) <= 15.0:
                if (not has_time) or (not kept_has_time) or dt is None or kept_dt is None or abs((dt - kept_dt).total_seconds()) <= 7200.0:
                    is_dup = True
                    break
        if not is_dup:
            existing.append((dt, load, priority, has_time))
            rec_clean = {k: v for k, v in rec.items() if k != "_load"}
            kept.append(rec_clean)

    kept.sort(key=lambda r: r["date"], reverse=True)
    return kept


def _compute_strength_exposure(
    strength_history: Dict[str, List[Dict[str, Any]]],
    today_date: date,
) -> List[Dict[str, Any]]:
    win_7_start = today_date - timedelta(days=6)
    win_14_start = today_date - timedelta(days=13)
    merged_by_ex: Dict[str, List[Tuple[date, float, int, Optional[float]]]] = {}

    for raw_ex_id, logs in (strength_history or {}).items():
        norm_id = normalize_exercise_id(raw_ex_id)
        if not norm_id:
            continue
        for entry in logs or []:
            if not isinstance(entry, dict):
                continue
            dt = time_utils.parse_uk_ts(entry.get("timestamp"))
            if dt is None:
                continue
            d = dt.date()
            w = _finite_float(entry.get("weight")) or 0.0
            reps = int(entry.get("reps") or 0)
            e1rm = _finite_float(entry.get("e1rm"))
            merged_by_ex.setdefault(norm_id, []).append((d, w, reps, e1rm))

    exposures: List[Dict[str, Any]] = []
    for ex_id, rows in merged_by_ex.items():
        meta = EXERCISE_BIOMECHANICS.get(ex_id)
        sets_7d = sum(1 for d, _, _, _ in rows if win_7_start <= d <= today_date)
        sets_prev_7d = sum(1 for d, _, _, _ in rows if win_14_start <= d < win_7_start)
        vol_delta_pct = (
            round(((sets_7d - sets_prev_7d) / sets_prev_7d) * 100.0, 1)
            if sets_prev_7d > 0
            else (100.0 if sets_7d > 0 else 0.0)
        )
        session_dates = {d for d, _, _, _ in rows}
        last_date = max(session_dates).isoformat()
        max_w = max((w for _, w, _, _ in rows), default=0.0)
        e1rms = [e for _, _, _, e in sorted(rows, key=lambda x: x[0]) if e is not None and e > 0]
        exposures.append({
            "exercise_id": ex_id,
            "name": meta["name"] if meta else ex_id.replace("_", " ").title(),
            "family": meta["family"] if meta else "functional",
            "sessions_count": len(session_dates),
            "sets_7d": sets_7d,
            "sets_prev_7d": sets_prev_7d,
            "volume_delta_pct": vol_delta_pct,
            "max_weight_kg": round(max_w, 1),
            "latest_e1rm": round(e1rms[-1], 1) if e1rms else None,
            "last_performed_date": last_date,
            "stressed_joints": list(meta["stressed_joints"]) if meta else [],
        })

    exposures.sort(key=lambda item: (item["last_performed_date"], item["sets_7d"] + item["sets_prev_7d"]), reverse=True)
    return exposures[:15]


def _compute_joint_load_deltas(
    workouts: List[Dict[str, Any]],
    strength_exposure: List[Dict[str, Any]],
    today_date: date,
) -> Dict[str, Dict[str, Any]]:
    win_7_start = today_date - timedelta(days=6)
    win_14_start = today_date - timedelta(days=13)
    counts_7d: Dict[str, int] = {j: 0 for j in ALL_ADAPTOR_JOINTS}
    counts_prev: Dict[str, int] = {j: 0 for j in ALL_ADAPTOR_JOINTS}

    for w in workouts:
        try:
            d = datetime.strptime(w["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        joints = [j for j in (w.get("stressed_joints") or []) if j in ALL_ADAPTOR_JOINTS]
        weight = 2 if w.get("impact_level") == "high" else 1
        if win_7_start <= d <= today_date:
            for j in joints:
                counts_7d[j] += weight
        elif win_14_start <= d < win_7_start:
            for j in joints:
                counts_prev[j] += weight

    for ex in strength_exposure:
        for j in (ex.get("stressed_joints") or []):
            if j not in ALL_ADAPTOR_JOINTS:
                continue
            counts_7d[j] += int(ex.get("sets_7d") or 0)
            counts_prev[j] += int(ex.get("sets_prev_7d") or 0)

    out: Dict[str, Dict[str, Any]] = {}
    for j in ALL_ADAPTOR_JOINTS:
        cur = counts_7d[j]
        prev = counts_prev[j]
        out[j] = {
            "load_7d": cur,
            "load_prev_7d": prev,
            "spike_ratio": round(cur / max(1, prev), 2) if cur > 0 else 0.0,
        }
    return out


def _compute_consecutive_days(workouts: List[Dict[str, Any]], today_date: date) -> int:
    dates = set()
    for w in workouts:
        try:
            dates.add(datetime.strptime(w["date"], "%Y-%m-%d").date())
        except ValueError:
            continue
    if not dates:
        return 0
    cursor = today_date if today_date in dates else (today_date - timedelta(days=1))
    streak = 0
    while cursor in dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _build_relevant_exercise_library(
    workouts: List[Dict[str, Any]],
    strength_exposure: List[Dict[str, Any]],
    candidate_region: Optional[str],
) -> List[Dict[str, Any]]:
    ids: List[str] = []
    for ex in strength_exposure:
        eid = ex["exercise_id"]
        if eid in EXERCISE_BIOMECHANICS and eid not in ids:
            ids.append(eid)
    for w in workouts:
        for eid in w.get("exercise_ids") or []:
            if eid in EXERCISE_BIOMECHANICS and eid not in ids:
                ids.append(eid)
    if candidate_region and candidate_region in REGION_TO_ADAPTOR_MAP:
        for j in REGION_TO_ADAPTOR_MAP[candidate_region]["affected_joints"]:
            for sid in JOINT_SAFE_SWAPS.get(j, ()):
                if sid in EXERCISE_BIOMECHANICS and sid not in ids:
                    ids.append(sid)
    for fid in JOINT_MOBILITY_FALLBACKS:
        if fid in EXERCISE_BIOMECHANICS and fid not in ids:
            ids.append(fid)

    return [
        {
            "id": meta["id"],
            "name": meta["name"],
            "family": meta["family"],
            "stressed_joints": meta["stressed_joints"],
            "kinetic_chain": meta["kinetic_chain"],
            "impact_level": meta["impact_level"],
            "axial_load": meta["axial_load"],
        }
        for meta in (EXERCISE_BIOMECHANICS[eid] for eid in ids[:25])
    ]


def build_diagnostic_context(
    live_state: Dict[str, Any],
    window_days: int = 21,
    candidate_region: Optional[str] = None,
    client_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Assemble and budget-cap the 14-30d athlete biomechanical, training, and recovery context."""
    db.init_db()
    safe_state = live_state if isinstance(live_state, dict) else {}
    clamped_days = max(14, min(30, int(window_days or 21)))
    today_date, today_str = _parse_date_bounds(client_date)

    with closing(db.get_connection()) as conn:
        sessions = db.get_workout_sessions(days=clamped_days, conn=conn)
        manual_acts = db.get_manual_activities(days=clamped_days, conn=conn)
        strength_hist = db.get_strength_history(days=clamped_days, conn=conn)
        strength_prs = db.get_strength_pr_map(conn=conn)
        bio_rows = db.get_daily_biometrics(days=max(clamped_days, 28), conn=conn)
        renpho_rows = db.get_renpho_history(days=clamped_days, conn=conn)
        nutrition_rows = db.get_daily_nutrition(days=14, conn=conn)
        raw_prefs = db.get_kv("client_preferences_v1", conn=conn)
        prior_raw = db.get_recent_diagnostic_assessments(limit=3, conn=conn)

    # Merge live prescriptions into PR map if missing
    prescriptions = safe_state.get("strength_prescriptions")
    if isinstance(prescriptions, dict):
        for raw_ex_id, sp in prescriptions.items():
            if not isinstance(sp, dict):
                continue
            ex_id = normalize_exercise_id(raw_ex_id)
            e1rm_val = _finite_float(sp.get("e1rm"))
            if e1rm_val and e1rm_val > 0 and ex_id not in strength_prs:
                strength_prs[ex_id] = {
                    "e1rm": round(e1rm_val, 1),
                    "weight": sp.get("weight"),
                    "reps": sp.get("reps"),
                    "timestamp": sp.get("last_updated"),
                }

    acwr_summary = analytics_service.compute_acwr_overreaching(
        safe_state, sessions, manual_acts, bio_rows, today_str
    )
    unified_workouts = _dedup_unified_workouts(
        safe_state, sessions, manual_acts, today_date, clamped_days
    )
    total_workouts = len(unified_workouts)
    strength_exposure = _compute_strength_exposure(strength_hist, today_date)
    joint_load_deltas = _compute_joint_load_deltas(unified_workouts, strength_exposure, today_date)
    streak_days = _compute_consecutive_days(unified_workouts, today_date)

    if total_workouts >= 5:
        availability = "rich"
    elif total_workouts >= 1 or len(strength_exposure) >= 1:
        availability = "sparse"
    else:
        availability = "empty"

    garmin_live = safe_state.get("garmin") if isinstance(safe_state.get("garmin"), dict) else {}
    athlete_live = safe_state.get("athlete") if isinstance(safe_state.get("athlete"), dict) else {}
    renpho_live = safe_state.get("renpho") if isinstance(safe_state.get("renpho"), dict) else {}
    nutrition_live = safe_state.get("nutrition") if isinstance(safe_state.get("nutrition"), dict) else {}
    injuries_live = safe_state.get("injuries") if isinstance(safe_state.get("injuries"), dict) else {}

    recent_7d_bios = [
        b for b in bio_rows if b.get("date_str") and str(b["date_str"]) >= (today_date - timedelta(days=6)).isoformat()
    ]
    avg_sleep = round(
        sum(float(b["sleep_score"]) for b in recent_7d_bios if b.get("sleep_score") is not None)
        / max(1, sum(1 for b in recent_7d_bios if b.get("sleep_score") is not None)),
        1,
    ) if any(b.get("sleep_score") is not None for b in recent_7d_bios) else None
    avg_rhr = round(
        sum(float(b["resting_hr"]) for b in recent_7d_bios if b.get("resting_hr") is not None)
        / max(1, sum(1 for b in recent_7d_bios if b.get("resting_hr") is not None)),
        1,
    ) if any(b.get("resting_hr") is not None for b in recent_7d_bios) else None

    latest_renpho = renpho_rows[-1] if renpho_rows else {}
    weight_kg = _finite_float(renpho_live.get("weight_kg") or athlete_live.get("weight_kg") or latest_renpho.get("weight_kg"))
    lean_mass_kg = _finite_float(renpho_live.get("lean_mass_kg") or athlete_live.get("lean_mass_kg") or latest_renpho.get("lean_mass_kg"))
    water_pct = _finite_float(renpho_live.get("water_pct") or latest_renpho.get("water_pct"))

    goal_key = None
    if raw_prefs:
        try:
            prefs_obj = json.loads(raw_prefs)
            fields = prefs_obj.get("fields") if isinstance(prefs_obj, dict) else {}
            if isinstance(fields, dict) and isinstance(fields.get("goal_key"), dict):
                goal_key = fields["goal_key"].get("value")
        except Exception:
            goal_key = None

    chronic_raw = injuries_live.get("chronic_profile") if isinstance(injuries_live.get("chronic_profile"), dict) else {}
    active_joints = [j for j in ALL_ADAPTOR_JOINTS if injuries_live.get(j)]
    chronic_joints = [
        j for j, meta in chronic_raw.items()
        if j in ALL_ADAPTOR_JOINTS and isinstance(meta, dict) and meta.get("permanent")
    ]
    for cj in chronic_joints:
        if cj not in active_joints:
            active_joints.append(cj)

    prior_diagnostics = [
        {
            "id": item["id"],
            "created_at": item["created_at"],
            "anatomical_region": item["anatomical_region"],
            "severity": item["severity"],
            "triage_level": item["triage_level"],
            "affected_joints": item["affected_joints"],
            "summary_headline": ((item.get("report") or {}).get("summary_headline") or "")[:160],
        }
        for item in prior_raw[:3]
    ]

    context_bundle: Dict[str, Any] = {
        "as_of_date": today_str,
        "window_days": clamped_days,
        "history_availability": availability,
        "workouts_analyzed": total_workouts,
        "consecutive_training_days": streak_days,
        "acwr": acwr_summary,
        "joint_load_7d_vs_prev_7d": joint_load_deltas,
        "biometrics_summary": {
            "sleep_score_latest": garmin_live.get("sleep_score"),
            "sleep_duration_latest": garmin_live.get("sleep_duration"),
            "sleep_score_7d_avg": avg_sleep,
            "resting_hr_latest": garmin_live.get("resting_hr"),
            "resting_hr_7d_avg": avg_rhr,
            "body_battery_latest": garmin_live.get("body_battery"),
            "training_readiness_latest": garmin_live.get("training_readiness"),
            "weight_kg": round(weight_kg, 2) if weight_kg else None,
            "lean_mass_kg": round(lean_mass_kg, 2) if lean_mass_kg else None,
            "water_pct": round(water_pct, 1) if water_pct else None,
            "calorie_target": nutrition_live.get("calorie_target"),
            "protein_target_g": nutrition_live.get("protein_target_g"),
            "nutrition_days_logged": len(nutrition_rows or []),
            "goal_key": goal_key,
        },
        "injury_context": {
            "active_joints": active_joints,
            "chronic_joints": chronic_joints,
            "chronic_profile": chronic_raw,
            "notes": str(injuries_live.get("notes") or "")[:400],
        },
        "recent_workouts": unified_workouts[:25],
        "strength_exposure": strength_exposure[:15],
        "exercise_library_subset": _build_relevant_exercise_library(
            unified_workouts, strength_exposure, candidate_region
        ),
        "prior_diagnostics": prior_diagnostics,
    }

    # Progressive char-budget guard: trim oldest workouts first, preserving aggregates & injury context
    while len(json.dumps(context_bundle, allow_nan=False)) > MAX_CONTEXT_JSON_CHARS and context_bundle["recent_workouts"]:
        context_bundle["recent_workouts"].pop()
    if len(json.dumps(context_bundle, allow_nan=False)) > MAX_CONTEXT_JSON_CHARS and context_bundle["exercise_library_subset"]:
        context_bundle["exercise_library_subset"] = context_bundle["exercise_library_subset"][:10]
    while len(json.dumps(context_bundle, allow_nan=False)) > MAX_CONTEXT_JSON_CHARS and context_bundle["strength_exposure"]:
        context_bundle["strength_exposure"].pop()

    return context_bundle
