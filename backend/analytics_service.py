import json
import math
import uuid
from contextlib import closing
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional, Tuple

import db
try:
    import autonomic_service
except Exception:
    autonomic_service = None
import time_utils
from time_utils import UK_TZ, uk_now, uk_today_str

ALLOWED_PREF_KEYS = (
    "goal_key",
    "custom_goal_macros",
    "diet_strategy",
    "carb_cycle_level",
    "fasting_protocol",
    "fasting_timer_state",
    "equipment_profile",
    "conditioning_progression",
    "pro_dial_macros",
)

SCALAR_ENUM_PREF_KEYS = {
    "goal_key",
    "diet_strategy",
    "carb_cycle_level",
    "fasting_protocol",
}

GOAL_NUTRITION_ANCHORS: Dict[str, Tuple[int, int]] = {
    "recomp": (2092, 200),
    "aerobic": (2200, 200),
    "pushups": (2442, 195),
    "rdl": (2592, 190),
    "work_capacity": (2350, 185),
}

parse_uk_datetime = time_utils.parse_uk_ts


def _finite_float(val: Any) -> Optional[float]:
    if val is None or isinstance(val, bool):
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def compute_composition_from_weight(
    weight_kg: float,
    existing_lbm: Any = None,
    body_fat_pct: Any = None,
) -> Dict[str, Optional[float]]:
    """Derive BF%, LBM, target 15% weight, and fat-to-lose from weight + BF% or valid existing LBM."""
    bf = _finite_float(body_fat_pct)
    if bf is not None and 3.0 <= bf <= 60.0:
        bf_r = round(bf, 1)
        lbm_r = round(weight_kg * (1.0 - (bf_r / 100.0)), 2)
        target_wt = round(lbm_r / 0.85, 2)
        fat_lose = round(max(0.0, weight_kg - target_wt), 2)
        return {
            "body_fat_pct": bf_r,
            "lean_mass_kg": lbm_r,
            "target_weight_at_15pct": target_wt,
            "fat_to_lose_kg": fat_lose,
        }
    lbm = _finite_float(existing_lbm)
    if lbm is not None and 0.0 < lbm < weight_kg:
        lbm_r = round(lbm, 2)
        bf_r = round(max(0.0, (weight_kg - lbm_r) / weight_kg) * 100.0, 1)
        target_wt = round(lbm_r / 0.85, 2)
        fat_lose = round(max(0.0, weight_kg - target_wt), 2)
        return {
            "body_fat_pct": bf_r,
            "lean_mass_kg": lbm_r,
            "target_weight_at_15pct": target_wt,
            "fat_to_lose_kg": fat_lose,
        }
    return {
        "body_fat_pct": None,
        "lean_mass_kg": None,
        "target_weight_at_15pct": None,
        "fat_to_lose_kg": None,
    }


def compute_macro_targets(
    base_calories: float,
    active_calories: float,
    base_protein: float,
    diet_strategy: str = "balanced",
    carb_cycle_level: str = "mod",
    custom_goal_macros: Optional[Dict[str, Any]] = None,
    pro_dial_macros: Optional[Dict[str, Any]] = None,
    goal_key: Optional[str] = None,
) -> Dict[str, int]:
    b_cals = _finite_float(base_calories)
    a_cals = _finite_float(active_calories) or 0.0
    b_prot = _finite_float(base_protein)
    if b_cals is None or b_cals <= 0:
        b_cals = 2092.0
    if b_prot is None or b_prot <= 0:
        b_prot = 200.0

    calorie_target = int(round(b_cals + max(0.0, a_cals)))

    protein_target_g: Optional[int] = None
    if diet_strategy == "custom" and isinstance(pro_dial_macros, dict):
        pd_p = _finite_float(pro_dial_macros.get("protein"))
        if pd_p is not None and pd_p > 0:
            protein_target_g = int(round(pd_p))
    if protein_target_g is None and goal_key == "custom" and isinstance(custom_goal_macros, dict):
        cg_p = _finite_float(custom_goal_macros.get("protein"))
        if cg_p is not None and cg_p > 0:
            protein_target_g = int(round(cg_p))
    if protein_target_g is None:
        protein_target_g = int(round(b_prot))

    rem_cals = max(0, calorie_target - protein_target_g * 4)
    strategy = str(diet_strategy or "balanced").strip().lower()

    if strategy == "lowcarb":
        carbs_g = 75
        fat_g = max(40, int(round(max(0, rem_cals - 75 * 4) / 9)))
    elif strategy == "carbcycle":
        carb_map = {"high": 300, "mod": 200, "low": 80}
        lvl = str(carb_cycle_level or "mod").strip().lower()
        carbs_g = carb_map.get(lvl, 200)
        fat_g = max(30, int(round(max(0, rem_cals - carbs_g * 4) / 9)))
    elif strategy == "fasting":
        carbs_g = max(50, int(round((rem_cals * 0.55) / 4)))
        fat_g = max(35, int(round((rem_cals * 0.45) / 9)))
    elif strategy == "custom":
        raw_fat_pct = _finite_float(pro_dial_macros.get("fat_pct")) if isinstance(pro_dial_macros, dict) else None
        fat_pct = max(15.0, min(65.0, raw_fat_pct)) if raw_fat_pct is not None else 30.0
        fat_g = max(20, int(round((calorie_target * (fat_pct / 100.0)) / 9)))
        carbs_g = max(20, int(round((calorie_target - protein_target_g * 4 - calorie_target * (fat_pct / 100.0)) / 4)))
    else:
        carbs_g = max(50, int(round((rem_cals * 0.62) / 4)))
        fat_g = max(30, int(round((rem_cals * 0.38) / 9)))

    return {
        "calorie_target": calorie_target,
        "protein_target_g": protein_target_g,
        "carbs_target_g": carbs_g,
        "fat_target_g": fat_g,
    }


def compute_sync_freshness(
    state: Dict[str, Any], now_uk: Optional[datetime] = None
) -> Dict[str, Any]:
    now = now_uk or uk_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=UK_TZ)
    else:
        now = now.astimezone(UK_TZ)

    def _entry(ts_val: Optional[str], stale_threshold_min: int) -> Dict[str, Any]:
        dt = parse_uk_datetime(ts_val)
        if dt is None:
            return {"last_synced": ts_val, "age_minutes": None, "stale": True}
        age_min = max(0, int((now - dt).total_seconds() // 60))
        return {
            "last_synced": ts_val,
            "age_minutes": age_min,
            "stale": age_min > stale_threshold_min,
        }

    garmin_obj = state.get("garmin") if isinstance(state.get("garmin"), dict) else {}
    garmin_ts = garmin_obj.get("oauth_last_synced") or garmin_obj.get("last_synced")
    garmin_entry = _entry(garmin_ts, 180)
    garmin_entry["mode"] = garmin_obj.get("garmin_sync_mode") or garmin_obj.get("source")

    renpho_obj = state.get("renpho") if isinstance(state.get("renpho"), dict) else {}
    poll_ts = renpho_obj.get("last_checked")
    weigh_ts = renpho_obj.get("weight_synced_at") or renpho_obj.get("last_synced")
    renpho_entry = _entry(poll_ts, 720)
    renpho_entry["last_checked"] = poll_ts
    renpho_entry["weigh_in_at"] = weigh_ts
    weigh_dt = parse_uk_datetime(weigh_ts)
    renpho_entry["weigh_in_age_hours"] = (
        round(max(0.0, (now - weigh_dt).total_seconds() / 3600.0), 1)
        if weigh_dt is not None
        else None
    )

    mnd_logged = state.get("mnd_logged") if isinstance(state.get("mnd_logged"), dict) else {}
    mnd_ts = state.get("mnd_last_synced") or mnd_logged.get("last_pulled")
    mnd_entry = _entry(mnd_ts, 360)

    return {
        "garmin": garmin_entry,
        "renpho": renpho_entry,
        "mnd": mnd_entry,
    }


def compute_adaptive_tdee(
    state: Dict[str, Any],
    renpho_rows: List[Dict[str, Any]],
    nutrition_rows: List[Dict[str, Any]],
    today_str: Optional[str] = None,
) -> Dict[str, Any]:
    today_str = today_str or uk_today_str()
    try:
        today_date = datetime.strptime(str(today_str)[:10], "%Y-%m-%d").date()
    except ValueError:
        today_date = uk_now().date()
        today_str = today_date.isoformat()

    win_start = today_date - timedelta(days=14)
    excluded_dates: set = set()
    if autonomic_service is not None:
        try:
            ill_info = autonomic_service.compute_illness_status(today_str)
            for ds in ill_info.get("excluded_tdee_dates") or []:
                try:
                    excluded_dates.add(datetime.strptime(str(ds)[:10], "%Y-%m-%d").date())
                except ValueError:
                    pass
        except Exception:
            excluded_dates = set()

    daily_weight_lists: Dict[date, List[float]] = {}
    for row in renpho_rows or []:
        if not isinstance(row, dict):
            continue
        w = _finite_float(row.get("weight_kg"))
        if w is None or w <= 0:
            continue
        dt = parse_uk_datetime(row.get("timestamp")) or parse_uk_datetime(row.get("date_str"))
        if dt is None:
            continue
        d = dt.date()
        if win_start <= d <= today_date and d not in excluded_dates:
            daily_weight_lists.setdefault(d, []).append(w)

    daily_weights: Dict[date, float] = {
        d: sum(vals) / len(vals) for d, vals in daily_weight_lists.items()
    }
    weigh_ins_count = len(daily_weights)
    sorted_w_dates = sorted(daily_weights.keys())
    span_days = (sorted_w_dates[-1] - sorted_w_dates[0]).days if len(sorted_w_dates) >= 2 else 0

    fuel_by_date: Dict[date, int] = {}
    mnd_hist_days = ((state.get("mnd_history") or {}).get("days") or []) if isinstance(state, dict) else []
    for item in mnd_hist_days:
        if not isinstance(item, dict):
            continue
        raw_d = item.get("date") or item.get("date_str")
        dt = parse_uk_datetime(raw_d)
        if dt is None:
            continue
        c_val = _finite_float(item.get("calories"))
        cals = int(round(c_val)) if c_val is not None else 0
        if cals >= 800:
            fuel_by_date[dt.date()] = cals

    # Prioritize authoritative SQLite daily_nutrition_logs rows unconditionally
    for item in nutrition_rows or []:
        if not isinstance(item, dict):
            continue
        dt = parse_uk_datetime(item.get("date_str") or item.get("date"))
        if dt is None:
            continue
        c_val = _finite_float(item.get("calories"))
        cals = int(round(c_val)) if c_val is not None else 0
        if cals >= 800:
            fuel_by_date[dt.date()] = cals
        else:
            fuel_by_date.pop(dt.date(), None)

    min_fuel_date = (sorted_w_dates[0] - timedelta(days=2)) if sorted_w_dates else win_start
    max_fuel_date = (
        min(today_date - timedelta(days=1), sorted_w_dates[-1])
        if sorted_w_dates
        else (today_date - timedelta(days=1))
    )
    valid_fuel = sorted(
        (d, cals)
        for d, cals in fuel_by_date.items()
        if min_fuel_date <= d <= max_fuel_date and d not in excluded_dates
    )[-14:]
    fuel_days_count = len(valid_fuel)

    insufficient_payload = {
        "status": "insufficient_data",
        "weigh_ins_count": weigh_ins_count,
        "weigh_ins_required": 4,
        "fuel_days_count": fuel_days_count,
        "fuel_days_required": 5,
        "span_days": span_days,
        "span_days_required": 6,
        "illness_days_excluded": len(excluded_dates),
        "estimated_tdee": None,
        "avg_intake_kcal": None,
        "weight_trend_kg_per_week": None,
        "recommended_recomp_target": None,
    }

    if weigh_ins_count < 4 or span_days < 6 or fuel_days_count < 5:
        return insufficient_payload

    min_w_date = sorted_w_dates[0]
    xs = [float((d - min_w_date).days) for d in sorted_w_dates]
    ys = [daily_weights[d] for d in sorted_w_dates]
    n = float(len(xs))
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    var_x = sum((x - mean_x) ** 2 for x in xs)
    if var_x <= 0.0:
        return insufficient_payload

    cov_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = cov_xy / var_x
    avg_intake_kcal = int(round(sum(cals for _, cals in valid_fuel) / len(valid_fuel)))
    raw_tdee = avg_intake_kcal - (slope * 7700.0)
    estimated_tdee = int(round(max(1400.0, min(4500.0, raw_tdee))))

    return {
        "status": "ready",
        "weigh_ins_count": weigh_ins_count,
        "weigh_ins_required": 4,
        "fuel_days_count": fuel_days_count,
        "fuel_days_required": 5,
        "span_days": span_days,
        "span_days_required": 6,
        "illness_days_excluded": len(excluded_dates),
        "estimated_tdee": estimated_tdee,
        "avg_intake_kcal": avg_intake_kcal,
        "weight_trend_kg_per_week": round(slope * 7.0, 2),
        "recommended_recomp_target": max(1500, estimated_tdee - 350),
    }


def compute_acwr_overreaching(
    state: Dict[str, Any],
    sessions: List[Dict[str, Any]],
    manual_acts: List[Dict[str, Any]],
    bio_rows: List[Dict[str, Any]],
    today_str: Optional[str] = None,
) -> Dict[str, Any]:
    today_str = today_str or uk_today_str()
    try:
        today_date = datetime.strptime(str(today_str)[:10], "%Y-%m-%d").date()
    except ValueError:
        today_date = uk_now().date()
        today_str = today_date.isoformat()

    win_28_start = today_date - timedelta(days=27)
    win_7_start = today_date - timedelta(days=6)
    # (priority, date, dt, load, has_time)
    candidates: List[Tuple[int, date, Optional[datetime], float, bool]] = []

    def _add_candidate(
        raw_ts: Any,
        raw_date_str: Optional[str],
        calories: Any,
        duration_min: Any,
        source: Optional[str],
        name: Optional[str],
        priority: int,
    ) -> None:
        src = str(source or "").strip().lower()
        nm = str(name or "").strip().lower()
        if src == "garmin_via_mnd_bridge" and "daily steps" in nm:
            return
        cals = _finite_float(calories) or 0.0
        dur = _finite_float(duration_min) or 0.0
        load = cals if cals > 0.0 else (dur * 6.0)
        if load <= 0.0:
            return
        dt = parse_uk_datetime(raw_ts)
        has_time = bool(dt and (dt.hour or dt.minute or dt.second))
        if dt is not None:
            d = dt.date()
        else:
            d_dt = parse_uk_datetime(raw_date_str)
            if d_dt is None:
                return
            d = d_dt.date()
            dt = d_dt
            has_time = False
        if d > today_date or d < win_28_start:
            return
        candidates.append((priority, d, dt, load, has_time))

    garmin_recent = ((state.get("garmin") or {}).get("recent_activities") or []) if isinstance(state, dict) else []
    for act in garmin_recent:
        if not isinstance(act, dict):
            continue
        _add_candidate(
            act.get("date"),
            None,
            act.get("calories") or act.get("workout_calories"),
            act.get("duration_min") or act.get("durationMin"),
            act.get("source") or "garmin_oauth",
            act.get("name") or act.get("sub_title"),
            priority=2,
        )

    for act in manual_acts or []:
        if not isinstance(act, dict):
            continue
        payload = act.get("payload") if isinstance(act.get("payload"), dict) else {}
        _add_candidate(
            act.get("timestamp"),
            act.get("date_str"),
            act.get("calories"),
            act.get("duration_min"),
            payload.get("source") or "manual_app_entry",
            act.get("name") or act.get("sub_title"),
            priority=1,
        )

    for sess in sessions or []:
        if not isinstance(sess, dict):
            continue
        payload = sess.get("payload") if isinstance(sess.get("payload"), dict) else {}
        details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
        _add_candidate(
            sess.get("timestamp"),
            sess.get("date_str"),
            sess.get("calories"),
            details.get("duration_min") or 0.0,
            "workout_session",
            payload.get("title") or sess.get("preset"),
            priority=0,
        )

    candidates.sort(key=lambda item: (-item[0], item[1], item[2].timestamp() if item[2] else 0.0))

    deduped: List[Tuple[date, float]] = []
    kept_by_date: Dict[date, List[Tuple[Optional[datetime], float, int, bool]]] = {}
    for priority, d, dt, load, has_time in candidates:
        existing = kept_by_date.setdefault(d, [])
        is_dup = False
        for kept_dt, kept_load, kept_prio, kept_has_time in existing:
            if priority != kept_prio and abs(load - kept_load) <= 15.0:
                if (not has_time) or (not kept_has_time) or dt is None or kept_dt is None or abs((dt - kept_dt).total_seconds()) <= 7200.0:
                    is_dup = True
                    break
        if not is_dup:
            existing.append((dt, load, priority, has_time))
            deduped.append((d, load))

    min_28d_date = min((d for d, _ in deduped), default=None)
    span_days = ((today_date - min_28d_date).days + 1) if min_28d_date is not None else 0

    acute_7d = sum(load for d, load in deduped if win_7_start <= d <= today_date)
    total_28d = sum(load for d, load in deduped if win_28_start <= d <= today_date)
    effective_weeks = min(28.0, max(14.0, float(span_days))) / 7.0
    chronic_weekly_avg = round(total_28d / effective_weeks, 1) if total_28d > 0.0 else 0.0

    if span_days < 14 or chronic_weekly_avg <= 0.0:
        return {
            "status": "calibrating",
            "acwr": None,
            "acute_7d_load": round(acute_7d, 1),
            "chronic_weekly_avg": chronic_weekly_avg,
            "span_days": span_days,
            "fatigued_markers": [],
            "reason": "Requires 14+ days of workout history to establish an ACWR baseline.",
        }

    acwr = round(acute_7d / (total_28d / effective_weeks), 2)

    sorted_bios = sorted(
        (b for b in (bio_rows or []) if isinstance(b, dict) and b.get("date_str")),
        key=lambda b: str(b["date_str"]),
    )
    latest_bio: Dict[str, Any] = sorted_bios[-1] if sorted_bios else {}
    if latest_bio:
        bio_dt = parse_uk_datetime(latest_bio.get("date_str"))
        if bio_dt is not None and bio_dt.date() < (today_date - timedelta(days=2)):
            latest_bio = {}

    garmin_live_raw = state.get("garmin") if isinstance(state.get("garmin"), dict) else {}
    garmin_live: Dict[str, Any] = garmin_live_raw
    g_ts_raw = garmin_live_raw.get("metrics_date") or garmin_live_raw.get("last_synced")
    if g_ts_raw:
        g_dt = parse_uk_datetime(g_ts_raw)
        if g_dt is not None and g_dt.date() < (today_date - timedelta(days=1)):
            garmin_live = {}

    sleep_score = garmin_live.get("sleep_score") if garmin_live.get("sleep_score") is not None else latest_bio.get("sleep_score")
    body_battery = garmin_live.get("body_battery") if garmin_live.get("body_battery") is not None else latest_bio.get("body_battery")
    resting_hr = garmin_live.get("resting_hr") if garmin_live.get("resting_hr") is not None else latest_bio.get("resting_hr")

    prior_rhrs = []
    for b in sorted_bios:
        if str(b.get("date_str")) < today_str and b.get("resting_hr") is not None:
            r_val = _finite_float(b["resting_hr"])
            if r_val is not None and r_val > 25.0:
                prior_rhrs.append(r_val)
    baseline_rhr = (sum(prior_rhrs) / len(prior_rhrs)) if len(prior_rhrs) >= 5 else None

    fatigued_markers: List[str] = []
    s_val = _finite_float(sleep_score)
    bb_val = _finite_float(body_battery)
    rhr_val = _finite_float(resting_hr)
    if s_val is not None and s_val < 68:
        fatigued_markers.append(f"Sleep {int(round(s_val))} (<68)")
    if bb_val is not None and bb_val < 35:
        fatigued_markers.append(f"Battery {int(round(bb_val))}% (<35%)")
    if rhr_val is not None and rhr_val > 25.0 and baseline_rhr is not None and rhr_val >= (baseline_rhr + 4.0):
        fatigued_markers.append(f"RHR {int(round(rhr_val))} bpm (+{int(round(rhr_val - baseline_rhr))} vs baseline)")

    fatigued = bool(fatigued_markers)
    if acwr >= 1.45 and not fatigued:
        status = "deload_recommended"
        reason = "7-day training load exceeded 1.45x your 28-day chronic baseline; schedule a reduced-volume deload session."
    elif acwr >= 1.45 or (acwr >= 1.30 and fatigued):
        status = "deload_recommended"
        reason = "7-day training load spiked well above your 28-day baseline with recovery strain markers; prioritize recovery or Zone 2 flush."
    elif acwr >= 1.25:
        status = "caution"
        reason = "7-day workload is climbing rapidly above chronic capacity; monitor sleep and bar speed closely."
    else:
        status = "optimal"
        reason = "Training load is within the productive progression corridor."

    return {
        "status": status,
        "acwr": acwr,
        "acute_7d_load": round(acute_7d, 1),
        "chronic_weekly_avg": chronic_weekly_avg,
        "span_days": span_days,
        "fatigued_markers": fatigued_markers,
        "reason": reason,
    }


def build_analytics_summary(state: Dict[str, Any]) -> Dict[str, Any]:
    db.init_db()
    now_uk = uk_now()
    today_str = now_uk.date().isoformat()
    safe_state = state if isinstance(state, dict) else {}

    with closing(db.get_connection()) as conn:
        renpho_rows = db.get_renpho_history(days=21, conn=conn)
        sessions = db.get_workout_sessions(days=35, conn=conn)
        manual_acts = db.get_manual_activities(days=35, conn=conn)
        nutrition_rows = db.get_daily_nutrition(days=21, conn=conn)
        bio_rows = db.get_daily_biometrics(days=28, conn=conn)
        strength_prs = db.get_strength_pr_map(conn=conn)
        flex_history = load_flex_history(conn=conn)
        flex_plan = load_flex_bank_plan(conn=conn)

    prescriptions = safe_state.get("strength_prescriptions")
    if isinstance(prescriptions, dict):
        for ex_id, sp in prescriptions.items():
            if not isinstance(sp, dict):
                continue
            base_e1rm = _finite_float(sp.get("e1rm")) or 0.0
            if base_e1rm <= 0:
                continue
            cur = strength_prs.get(ex_id)
            if cur is None or base_e1rm > float(cur.get("e1rm") or 0.0):
                strength_prs[ex_id] = {
                    "e1rm": round(base_e1rm, 1),
                    "weight": sp.get("weight"),
                    "reps": sp.get("reps"),
                    "timestamp": sp.get("last_updated"),
                }

    adaptive_tdee = compute_adaptive_tdee(safe_state, renpho_rows, nutrition_rows, today_str)
    overreaching = compute_acwr_overreaching(safe_state, sessions, manual_acts, bio_rows, today_str)
    flex_refeed = compute_flex_refeed_status(
        safe_state,
        renpho_rows=renpho_rows,
        nutrition_rows=nutrition_rows,
        sessions=sessions,
        manual_acts=manual_acts,
        bio_rows=bio_rows,
        adaptive_tdee=adaptive_tdee,
        overreaching=overreaching,
        flex_history=flex_history,
        flex_plan=flex_plan,
        today_str=today_str,
        now_uk=now_uk,
    )

    autonomic_summary: Optional[Dict[str, Any]] = None
    if autonomic_service is not None:
        try:
            autonomic_summary = autonomic_service.build_autonomic_summary(safe_state, today_str)
        except Exception:
            autonomic_summary = None

    return {
        "adaptive_tdee": adaptive_tdee,
        "overreaching": overreaching,
        "sync_freshness": compute_sync_freshness(safe_state, now_uk=now_uk),
        "strength_prs": strength_prs,
        "flex_refeed": flex_refeed,
        "autonomic": autonomic_summary,
    }


def resolve_goal_nutrition_anchors(fields: Dict[str, Any]) -> Optional[Tuple[int, int]]:
    goal_entry = fields.get("goal_key")
    custom_entry = fields.get("custom_goal_macros")
    goal_key = goal_entry.get("value") if isinstance(goal_entry, dict) else None
    custom_val = custom_entry.get("value") if isinstance(custom_entry, dict) else None

    if goal_key == "custom" and isinstance(custom_val, dict):
        c_val = _finite_float(custom_val.get("calories"))
        p_val = _finite_float(custom_val.get("protein"))
        if c_val is not None and p_val is not None and c_val > 0 and p_val > 0:
            return (int(round(c_val)), int(round(p_val)))

    if isinstance(goal_key, str) and goal_key in GOAL_NUTRITION_ANCHORS:
        return GOAL_NUTRITION_ANCHORS[goal_key]
    return None


def recalculate_nutrition(
    state: Dict[str, Any],
    date_str: Optional[str] = None,
    pref_fields: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Recompute state['nutrition'] targets and remaining values from active preferences and live burn."""
    if pref_fields is None:
        pref_fields = {}
        try:
            raw_prefs = db.get_kv("client_preferences_v1")
            if raw_prefs:
                parsed = json.loads(raw_prefs)
                if isinstance(parsed, dict) and isinstance(parsed.get("fields"), dict):
                    pref_fields = parsed["fields"]
        except Exception:
            pref_fields = {}

    def _pref_val(key: str) -> Any:
        entry = pref_fields.get(key) if isinstance(pref_fields, dict) else None
        return entry.get("value") if isinstance(entry, dict) else None

    nutrition = state.setdefault("nutrition", {})
    anchors = resolve_goal_nutrition_anchors(pref_fields) if pref_fields else None
    if anchors is not None:
        base_cals, base_prot = anchors
    else:
        raw_base = _finite_float(nutrition.get("base_calorie_target"))
        raw_prot = _finite_float(
            nutrition.get("base_protein_target_g")
            if nutrition.get("base_protein_target_g") is not None
            else nutrition.get("protein_target_g")
        )
        base_cals = int(round(raw_base)) if (raw_base is not None and raw_base > 0) else 2092
        base_prot = int(round(raw_prot)) if (raw_prot is not None and raw_prot > 0) else 200

    garmin = state.setdefault("garmin", {})
    active_cals = int(round(_finite_float(garmin.get("active_calories")) or 0.0))
    diet_strategy = _pref_val("diet_strategy") or "balanced"
    carb_cycle_level = _pref_val("carb_cycle_level") or "mod"
    custom_goal_macros = _pref_val("custom_goal_macros")
    pro_dial_macros = _pref_val("pro_dial_macros")
    goal_key = _pref_val("goal_key")

    targets = compute_macro_targets(
        base_cals,
        active_cals,
        base_prot,
        diet_strategy=diet_strategy,
        carb_cycle_level=carb_cycle_level,
        custom_goal_macros=custom_goal_macros,
        pro_dial_macros=pro_dial_macros,
        goal_key=goal_key,
    )

    nutrition["base_calorie_target"] = base_cals
    nutrition["base_protein_target_g"] = base_prot
    nutrition["calorie_target"] = targets["calorie_target"]
    nutrition["protein_target_g"] = targets["protein_target_g"]
    nutrition["carbs_target_g"] = targets["carbs_target_g"]
    nutrition["fat_target_g"] = targets["fat_target_g"]

    target_date_str = str(date_str or uk_today_str())[:10]
    illness_status = None
    if autonomic_service is not None:
        try:
            illness_status = autonomic_service.compute_illness_status(target_date_str)
        except Exception:
            illness_status = None
    illness_active = bool(illness_status and illness_status.get("active_today"))

    flex_delta = compute_active_flex_delta(
        state,
        target_date_str=target_date_str,
        normal_calories=targets["calorie_target"],
        protein_g=targets["protein_target_g"],
        carbs_g=targets["carbs_target_g"],
        fat_g=targets["fat_target_g"],
    )
    if illness_active:
        # Pause Planned Bank deductions during illness while honoring any maintenance goal shift
        if flex_delta is not None and flex_delta.get("type") == "bank_deduction":
            flex_delta = None
        nut_tdee = _finite_float(nutrition.get("tdee"))
        maint_base = int(round(nut_tdee)) if (nut_tdee is not None and nut_tdee >= 1400) else (base_cals + 400)
        maint_cals = max(targets["calorie_target"], maint_base + active_cals)
        extra_kcal = max(0, maint_cals - nutrition["calorie_target"])
        nutrition["calorie_target"] = maint_cals
        nutrition["carbs_target_g"] = max(20, targets["carbs_target_g"] + int(round((extra_kcal * 0.60) / 4.0)))
        nutrition["fat_target_g"] = max(20, targets["fat_target_g"] + int(round((extra_kcal * 0.40) / 9.0)))
        nutrition["flex_active"] = flex_delta
        nutrition["illness_active"] = True
        nutrition["illness_severity"] = (illness_status.get("today_log") or {}).get("severity", "moderate")
        nutrition["illness_maintenance_kcal"] = maint_cals
    elif flex_delta is not None:
        nutrition["calorie_target"] = max(1200, targets["calorie_target"] + int(flex_delta["adjustment_kcal"]))
        nutrition["carbs_target_g"] = max(20, targets["carbs_target_g"] + int(flex_delta["carb_delta_g"]))
        nutrition["fat_target_g"] = max(20, targets["fat_target_g"] + int(flex_delta["fat_delta_g"]))
        nutrition["flex_active"] = flex_delta
        nutrition["illness_active"] = False
        nutrition.pop("illness_severity", None)
        nutrition.pop("illness_maintenance_kcal", None)
    else:
        nutrition["flex_active"] = None
        nutrition["illness_active"] = False
        nutrition.pop("illness_severity", None)
        nutrition.pop("illness_maintenance_kcal", None)

    def _logged_for_date(ml: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(ml, dict) or not ml:
            return None
        ml_date = ml.get("date")
        if date_str and ml_date and str(ml_date)[:10] != str(date_str)[:10]:
            return None
        return ml

    active_ml = _logged_for_date(state.get("mnd_logged")) or _logged_for_date(garmin.get("mnd_logged")) or {}
    logged_cals = int(round(_finite_float(active_ml.get("calories")) or 0.0))
    logged_prot = int(round(_finite_float(active_ml.get("protein_g")) or 0.0))
    nutrition["calories_remaining"] = nutrition["calorie_target"] - logged_cals
    nutrition["protein_remaining"] = max(0, nutrition["protein_target_g"] - logged_prot)
    return nutrition


def merge_preferences_v1(
    stored: Optional[Dict[str, Any]], incoming: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    stored_fields = (
        dict(stored.get("fields"))
        if isinstance(stored, dict) and isinstance(stored.get("fields"), dict)
        else {}
    )
    incoming_fields = (
        dict(incoming.get("fields"))
        if isinstance(incoming, dict) and isinstance(incoming.get("fields"), dict)
        else {}
    )

    now_ms = int(uk_now().timestamp() * 1000)
    max_allowed_ms = now_ms + 60_000
    merged_fields: Dict[str, Dict[str, Any]] = {}
    for k, entry in stored_fields.items():
        if k in ALLOWED_PREF_KEYS and isinstance(entry, dict) and "value" in entry:
            ts_raw = entry.get("updated_at_ms")
            ts_num = _finite_float(ts_raw)
            ts = int(ts_num) if ts_num is not None else 0
            merged_fields[k] = {"value": entry["value"], "updated_at_ms": max(0, ts)}

    field_resolutions: Dict[str, str] = {}
    for k, entry in incoming_fields.items():
        if k not in ALLOWED_PREF_KEYS or not isinstance(entry, dict) or "value" not in entry:
            continue
        raw_ts = entry.get("updated_at_ms")
        ts_num = _finite_float(raw_ts)
        inc_ts = int(ts_num) if ts_num is not None else now_ms
        inc_ts = min(max(0, inc_ts), max_allowed_ms)
        srv_ts = int((merged_fields.get(k) or {}).get("updated_at_ms") or 0)

        if inc_ts >= srv_ts:
            merged_fields[k] = {"value": entry["value"], "updated_at_ms": inc_ts}
            field_resolutions[k] = "accepted"
        else:
            field_resolutions[k] = "server_newer"

    max_ts = max((int(v.get("updated_at_ms") or 0) for v in merged_fields.values()), default=0)
    return {
        "preferences": {
            "fields": merged_fields,
            "updated_at_ms": max_ts,
        },
        "field_resolutions": field_resolutions,
    }


# ---------------------------------------------------------------------------
# Earned Flex, Refeed & Planned Weekend Banking Engine
# ---------------------------------------------------------------------------
FLEX_HISTORY_KV_KEY = "flex_refeed_history_v1"
FLEX_PLAN_KV_KEY = "flex_bank_plan_v1"
FLEX_HISTORY_MAX_ITEMS = 30
FLEX_VALID_MODES = ("flex_snack", "flex_meal", "refeed_day", "planned_flex")
FLEX_SHIELD_MODES = ("flex_meal", "refeed_day", "planned_flex")

_FLEX_MACRO_SPLITS: Dict[str, Tuple[float, float]] = {
    "flex_snack": (0.75, 0.25),
    "flex_meal": (0.65, 0.35),
    "planned_flex": (0.65, 0.35),
    "refeed_day": (0.80, 0.20),
}

_FLEX_SCALE_SHIELD_NOTE = (
    "Expected +0.5–1.2 kg water & muscle glycogen retention for 24–48h "
    "after your Flex/Refeed — normal hydration physics, not fat gain."
)


class FlexRuleError(ValueError):
    """Domain validation/eligibility error carrying an explicit HTTP status code."""

    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = int(status_code)


def _parse_iso_date(raw_val: Any) -> Optional[date]:
    dt = parse_uk_datetime(raw_val)
    return dt.date() if dt is not None else None


def _flex_mode_label(mode: str, bonus_kcal: int) -> str:
    sign = "+" if bonus_kcal >= 0 else ""
    titles = {
        "flex_snack": "Flex Snack",
        "flex_meal": "Flex Meal",
        "refeed_day": "Refeed Day",
        "planned_flex": "Planned Flex",
    }
    title = titles.get(mode, "Flex")
    return f"{title} ({sign}{bonus_kcal} kcal)"


def load_flex_history(conn=None) -> List[Dict[str, Any]]:
    raw = db.get_kv(FLEX_HISTORY_KV_KEY, conn=conn)
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    cleaned: List[Dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        mode = str(item.get("mode") or "").strip()
        d_str = str(item.get("date_str") or "")[:10]
        if mode not in FLEX_VALID_MODES or _parse_iso_date(d_str) is None:
            continue
        bonus = _finite_float(item.get("bonus_kcal"))
        if bonus is None or bonus <= 0:
            continue
        cleaned.append({
            "claim_id": str(item.get("claim_id") or f"flx_{d_str.replace('-', '')}"),
            "date_str": d_str,
            "claimed_at": str(item.get("claimed_at") or f"{d_str}T12:00:00+00:00"),
            "mode": mode,
            "bonus_kcal": int(round(bonus)),
            "carb_share": float(item.get("carb_share") or _FLEX_MACRO_SPLITS.get(mode, (0.65, 0.35))[0]),
            "fat_share": float(item.get("fat_share") or _FLEX_MACRO_SPLITS.get(mode, (0.65, 0.35))[1]),
            "triggers_scale_shield": bool(
                item.get("triggers_scale_shield")
                if item.get("triggers_scale_shield") is not None
                else (mode in FLEX_SHIELD_MODES)
            ),
            "plan_id": item.get("plan_id"),
            "source": str(item.get("source") or "earned"),
            "label": str(item.get("label") or _flex_mode_label(mode, int(round(bonus)))),
        })
    return cleaned[-FLEX_HISTORY_MAX_ITEMS:]


def save_flex_history(items: List[Dict[str, Any]]) -> None:
    trimmed = list(items or [])[-FLEX_HISTORY_MAX_ITEMS:]
    db.set_kv(FLEX_HISTORY_KV_KEY, json.dumps(trimmed, allow_nan=False))


def load_flex_bank_plan(conn=None) -> Optional[Dict[str, Any]]:
    raw = db.get_kv(FLEX_PLAN_KV_KEY, conn=conn)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def save_flex_bank_plan(plan: Optional[Dict[str, Any]]) -> None:
    db.set_kv(FLEX_PLAN_KV_KEY, json.dumps(plan, allow_nan=False))


def _merge_daily_nutrition_by_date(
    state: Dict[str, Any], nutrition_rows: List[Dict[str, Any]]
) -> Dict[date, Dict[str, int]]:
    """Merge MND history + authoritative SQLite nutrition logs; <800 kcal days stay excluded/unlogged."""
    by_date: Dict[date, Dict[str, int]] = {}
    mnd_days = ((state.get("mnd_history") or {}).get("days") or []) if isinstance(state, dict) else []
    for item in mnd_days:
        if not isinstance(item, dict):
            continue
        d = _parse_iso_date(item.get("date") or item.get("date_str"))
        if d is None:
            continue
        c_val = _finite_float(item.get("calories"))
        cals = int(round(c_val)) if c_val is not None else 0
        if cals >= 800:
            p_val = _finite_float(item.get("protein_g") if item.get("protein_g") is not None else item.get("protein"))
            cb_val = _finite_float(item.get("carbs_g") if item.get("carbs_g") is not None else item.get("carbs"))
            ft_val = _finite_float(item.get("fat_g") if item.get("fat_g") is not None else item.get("fat"))
            by_date[d] = {
                "calories": cals,
                "protein_g": int(round(p_val)) if p_val is not None else 0,
                "carbs_g": int(round(cb_val)) if cb_val is not None else 0,
                "fat_g": int(round(ft_val)) if ft_val is not None else 0,
            }

    for item in nutrition_rows or []:
        if not isinstance(item, dict):
            continue
        d = _parse_iso_date(item.get("date_str") or item.get("date"))
        if d is None:
            continue
        c_val = _finite_float(item.get("calories"))
        cals = int(round(c_val)) if c_val is not None else 0
        if cals >= 800:
            p_val = _finite_float(item.get("protein_g") if item.get("protein_g") is not None else item.get("protein"))
            cb_val = _finite_float(item.get("carbs_g") if item.get("carbs_g") is not None else item.get("carbs"))
            ft_val = _finite_float(item.get("fat_g") if item.get("fat_g") is not None else item.get("fat"))
            by_date[d] = {
                "calories": cals,
                "protein_g": int(round(p_val)) if p_val is not None else 0,
                "carbs_g": int(round(cb_val)) if cb_val is not None else 0,
                "fat_g": int(round(ft_val)) if ft_val is not None else 0,
            }
        else:
            by_date.pop(d, None)

    return by_date


def _build_daily_workout_burn_map(
    state: Dict[str, Any],
    sessions: List[Dict[str, Any]],
    manual_acts: List[Dict[str, Any]],
    today_date: date,
    win_days: int = 14,
) -> Dict[date, int]:
    """Build per-day deduped workout calories over recent days without inflating non-workout days."""
    win_start = today_date - timedelta(days=win_days)
    per_day_entries: Dict[date, List[Tuple[int, float, str]]] = {}

    def _add(raw_ts: Any, calories: Any, source: Any, name: Any, act_id: Any, prio: int) -> None:
        src = str(source or "").strip().lower()
        nm = str(name or "").strip().lower()
        if src == "garmin_via_mnd_bridge" and "daily steps" in nm:
            return
        d = _parse_iso_date(raw_ts)
        if d is None or d < win_start or d > today_date:
            return
        cals = _finite_float(calories) or 0.0
        if cals <= 0.0:
            return
        per_day_entries.setdefault(d, []).append((prio, cals, str(act_id or "").strip()))

    garmin = (state.get("garmin") or {}) if isinstance(state, dict) else {}
    for act_list in (garmin.get("recent_activities") or [], garmin.get("today_activities") or []):
        for a in act_list:
            if not isinstance(a, dict):
                continue
            src = a.get("source") or garmin.get("source")
            _add(a.get("date") or a.get("rawDate"), a.get("calories"), src, a.get("name"), a.get("id"), 1)

    for s in sessions or []:
        if isinstance(s, dict):
            _add(s.get("timestamp"), s.get("calories"), "workout_session", s.get("preset"), s.get("id"), 2)

    for m in manual_acts or []:
        if isinstance(m, dict):
            _add(m.get("timestamp"), m.get("calories"), "manual_app_entry", m.get("name"), m.get("id"), 2)

    burn_by_day: Dict[date, int] = {}
    for d, items in per_day_entries.items():
        items.sort(key=lambda x: x[0])
        seen_ids = set()
        seen_cals: List[float] = []
        day_total = 0.0
        for _, cals, aid in items:
            if aid and aid in seen_ids:
                continue
            if any(abs(cals - sc) <= 15.0 for sc in seen_cals):
                continue
            if aid:
                seen_ids.add(aid)
            seen_cals.append(cals)
            day_total += cals
        if day_total > 0:
            burn_by_day[d] = int(round(day_total))
    return burn_by_day


def _resolve_nutrition_anchors_and_normal_target(
    state: Dict[str, Any], pref_fields: Optional[Dict[str, Any]] = None
) -> Tuple[int, int, int, int, int]:
    """Return (base_cal, protein_anchor, default_deficit, pre_flex_today_target, active_cals)."""
    nutrition = state.get("nutrition") if isinstance(state, dict) and isinstance(state.get("nutrition"), dict) else {}
    anchors = resolve_goal_nutrition_anchors(pref_fields) if pref_fields else None
    if anchors is not None:
        base_cal, protein_anchor = anchors
    else:
        raw_base = _finite_float(nutrition.get("base_calorie_target"))
        if raw_base is None or raw_base <= 0:
            raw_base = _finite_float(nutrition.get("calorie_target"))
        raw_prot = _finite_float(
            nutrition.get("base_protein_target_g")
            if nutrition.get("base_protein_target_g") is not None
            else nutrition.get("protein_target_g")
        )
        base_cal = int(round(raw_base)) if (raw_base is not None and raw_base > 0) else 2092
        protein_anchor = int(round(raw_prot)) if (raw_prot is not None and raw_prot > 0) else 200

    raw_def = _finite_float(nutrition.get("deficit"))
    default_deficit = int(round(raw_def)) if (raw_def is not None and raw_def >= 0) else 350
    garmin = state.get("garmin") if isinstance(state, dict) and isinstance(state.get("garmin"), dict) else {}
    active_cals = int(round(max(0.0, _finite_float(garmin.get("active_calories")) or 0.0)))
    pre_flex_today_target = int(round(base_cal + active_cals))
    return base_cal, protein_anchor, default_deficit, pre_flex_today_target, active_cals


def _evaluate_planned_bank(
    plan: Optional[Dict[str, Any]],
    by_date: Dict[date, Dict[str, int]],
    workout_burn_map: Dict[date, int],
    base_cal: int,
    protein_anchor: int,
    pre_flex_today_target: int,
    today_date: date,
    active_today_claim: Optional[Dict[str, Any]],
    meal_cooldown_left: int,
) -> Dict[str, Any]:
    inactive = {
        "active": False,
        "plan_id": None,
        "target_date": None,
        "label": None,
        "target_kcal": 0,
        "actual_banked_kcal": 0,
        "daily_deduction_today": 0,
        "days_remaining": 0,
        "ready_to_redeem": False,
        "status": plan.get("status") if isinstance(plan, dict) else None,
    }
    if not isinstance(plan, dict) or plan.get("status") != "active":
        return inactive

    p_target = _parse_iso_date(plan.get("target_date"))
    p_start = _parse_iso_date(plan.get("start_date")) or _parse_iso_date(plan.get("created_date"))
    if p_target is None or p_start is None:
        return inactive
    if p_target < today_date:
        inactive["status"] = "expired"
        inactive["plan_id"] = plan.get("plan_id")
        inactive["target_date"] = p_target.isoformat()
        inactive["label"] = plan.get("label")
        inactive["target_kcal"] = int(_finite_float(plan.get("target_kcal")) or 0)
        return inactive

    target_kcal = max(200, min(800, int(round(_finite_float(plan.get("target_kcal")) or 550))))
    cap = min(200, max(50, int(round(_finite_float(plan.get("daily_deduction_cap")) or 200))))

    actual_banked = 0
    if p_start <= today_date:
        last_completed = min(today_date - timedelta(days=1), p_target - timedelta(days=1))
        cur_d = p_start
        while cur_d <= last_completed:
            rec = by_date.get(cur_d)
            if rec is not None:
                normal_d = base_cal + workout_burn_map.get(cur_d, 0)
                credit_d = max(0, min(cap + 100, int(round(normal_d - rec["calories"]))))
                actual_banked += credit_d
            cur_d += timedelta(days=1)

    days_remaining = max(0, (p_target - today_date).days)
    daily_floor = max(1600, int(round(protein_anchor * 4 + 600)))
    daily_deduction_today = 0
    if days_remaining >= 1 and active_today_claim is None:
        remaining_needed = max(0, target_kcal - actual_banked)
        if remaining_needed > 0:
            raw_trim = int(round(remaining_needed / float(days_remaining)))
            safe_headroom = max(0, int(round(pre_flex_today_target - daily_floor)))
            daily_deduction_today = max(0, min(cap, raw_trim, safe_headroom))

    unlock_kcal = min(target_kcal, actual_banked)
    is_event_day = (p_target == today_date)
    ready_to_redeem = (
        is_event_day
        and active_today_claim is None
        and meal_cooldown_left == 0
        and unlock_kcal >= 200
    )

    return {
        "active": True,
        "plan_id": str(plan.get("plan_id") or ""),
        "start_date": p_start.isoformat(),
        "target_date": p_target.isoformat(),
        "label": str(plan.get("label") or "") or "Planned Flex",
        "target_kcal": target_kcal,
        "actual_banked_kcal": int(actual_banked),
        "daily_deduction_today": int(daily_deduction_today),
        "days_remaining": int(days_remaining),
        "ready_to_redeem": bool(ready_to_redeem),
        "unlock_kcal": int(unlock_kcal) if unlock_kcal >= 200 else 0,
        "status": "active",
    }


def _evaluate_flex_cooldowns(
    history: List[Dict[str, Any]], today_date: date, now_uk: datetime
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any], Dict[str, Any]]:
    active_today_claim: Optional[Dict[str, Any]] = None
    snack_left = 0
    meal_left = 0
    refeed_left = 0
    last_claim: Optional[Dict[str, Any]] = None
    latest_shield_claim: Optional[Tuple[datetime, Dict[str, Any]]] = None

    for c in history:
        c_date = _parse_iso_date(c.get("date_str"))
        if c_date is None or c_date > today_date:
            continue
        mode = c.get("mode")
        last_claim = c

        c_dt = parse_uk_datetime(c.get("claimed_at")) or datetime(
            c_date.year, c_date.month, c_date.day, 12, 0, tzinfo=UK_TZ
        )
        if mode in FLEX_SHIELD_MODES and c.get("triggers_scale_shield", True):
            if latest_shield_claim is None or c_dt >= latest_shield_claim[0]:
                latest_shield_claim = (c_dt, c)

        if c_date == today_date:
            active_today_claim = c
            continue

        days_since = (today_date - c_date).days
        if mode == "flex_snack":
            snack_left = max(snack_left, 2 - days_since)
        elif mode in ("flex_meal", "planned_flex"):
            snack_left = max(snack_left, 3 - days_since)
            meal_left = max(meal_left, 5 - days_since)
            refeed_left = max(refeed_left, 5 - days_since)
        elif mode == "refeed_day":
            snack_left = max(snack_left, 3 - days_since)
            meal_left = max(meal_left, 5 - days_since)
            refeed_left = max(refeed_left, 12 - days_since)

    scale_shield: Dict[str, Any] = {
        "active": False,
        "claim_mode": None,
        "claimed_at": None,
        "hours_remaining": 0,
        "note": "",
    }
    if latest_shield_claim is not None:
        s_dt, s_rec = latest_shield_claim
        elapsed_h = (now_uk - s_dt).total_seconds() / 3600.0
        if -0.05 <= elapsed_h <= 48.0:
            clamped_elapsed = max(0.0, elapsed_h)
            hrs_rem = max(1, int(math.ceil(48.0 - clamped_elapsed)))
            scale_shield = {
                "active": True,
                "claim_mode": s_rec.get("mode"),
                "claimed_at": s_rec.get("claimed_at"),
                "hours_remaining": min(48, hrs_rem),
                "note": _FLEX_SCALE_SHIELD_NOTE,
            }

    cooldown = {
        "flex_snack_days_left": int(max(0, snack_left)),
        "flex_meal_days_left": int(max(0, meal_left)),
        "refeed_day_days_left": int(max(0, refeed_left)),
        "last_claim": last_claim,
    }
    return active_today_claim, cooldown, scale_shield


def compute_flex_refeed_status(
    state: Dict[str, Any],
    renpho_rows: Optional[List[Dict[str, Any]]] = None,
    nutrition_rows: Optional[List[Dict[str, Any]]] = None,
    sessions: Optional[List[Dict[str, Any]]] = None,
    manual_acts: Optional[List[Dict[str, Any]]] = None,
    bio_rows: Optional[List[Dict[str, Any]]] = None,
    adaptive_tdee: Optional[Dict[str, Any]] = None,
    overreaching: Optional[Dict[str, Any]] = None,
    flex_history: Optional[List[Dict[str, Any]]] = None,
    flex_plan: Optional[Dict[str, Any]] = None,
    today_str: Optional[str] = None,
    now_uk: Optional[datetime] = None,
    conn=None,
) -> Dict[str, Any]:
    """Compute Earned Flex, Refeed, Planned Banking, and 48h Scale Shield status."""
    safe_state = state if isinstance(state, dict) else {}
    now = now_uk or uk_now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=UK_TZ)
    else:
        now = now.astimezone(UK_TZ)
    today_iso = str(today_str or now.date().isoformat())[:10]
    today_date = _parse_iso_date(today_iso) or now.date()
    today_iso = today_date.isoformat()

    pref_fields: Dict[str, Any] = {}
    need_db = (
        nutrition_rows is None
        or sessions is None
        or manual_acts is None
        or flex_history is None
        or flex_plan is None
        or (adaptive_tdee is None and renpho_rows is None)
        or (overreaching is None and bio_rows is None)
    )
    if need_db:
        if conn is not None:
            if renpho_rows is None:
                renpho_rows = db.get_renpho_history(days=21, conn=conn)
            if sessions is None:
                sessions = db.get_workout_sessions(days=35, conn=conn)
            if manual_acts is None:
                manual_acts = db.get_manual_activities(days=35, conn=conn)
            if nutrition_rows is None:
                nutrition_rows = db.get_daily_nutrition(days=21, conn=conn)
            if bio_rows is None:
                bio_rows = db.get_daily_biometrics(days=28, conn=conn)
            if flex_history is None:
                flex_history = load_flex_history(conn=conn)
            if flex_plan is None:
                flex_plan = load_flex_bank_plan(conn=conn)
            raw_prefs = db.get_kv("client_preferences_v1", conn=conn)
        else:
            db.init_db()
            with closing(db.get_connection()) as active_conn:
                if renpho_rows is None:
                    renpho_rows = db.get_renpho_history(days=21, conn=active_conn)
                if sessions is None:
                    sessions = db.get_workout_sessions(days=35, conn=active_conn)
                if manual_acts is None:
                    manual_acts = db.get_manual_activities(days=35, conn=active_conn)
                if nutrition_rows is None:
                    nutrition_rows = db.get_daily_nutrition(days=21, conn=active_conn)
                if bio_rows is None:
                    bio_rows = db.get_daily_biometrics(days=28, conn=active_conn)
                if flex_history is None:
                    flex_history = load_flex_history(conn=active_conn)
                if flex_plan is None:
                    flex_plan = load_flex_bank_plan(conn=active_conn)
                raw_prefs = db.get_kv("client_preferences_v1", conn=active_conn)
        if raw_prefs:
            try:
                parsed_p = json.loads(raw_prefs)
                if isinstance(parsed_p, dict) and isinstance(parsed_p.get("fields"), dict):
                    pref_fields = parsed_p["fields"]
            except Exception:
                pref_fields = {}
    else:
        raw_prefs = db.get_kv("client_preferences_v1", conn=conn) if conn is not None else db.get_kv("client_preferences_v1")
        if raw_prefs:
            try:
                parsed_p = json.loads(raw_prefs)
                if isinstance(parsed_p, dict) and isinstance(parsed_p.get("fields"), dict):
                    pref_fields = parsed_p["fields"]
            except Exception:
                pref_fields = {}

    if adaptive_tdee is None:
        adaptive_tdee = compute_adaptive_tdee(safe_state, renpho_rows or [], nutrition_rows or [], today_iso)
    if overreaching is None:
        overreaching = compute_acwr_overreaching(
            safe_state, sessions or [], manual_acts or [], bio_rows or [], today_iso
        )

    history = list(flex_history or [])
    base_cal, protein_anchor, default_deficit, pre_flex_today_target, active_cals = (
        _resolve_nutrition_anchors_and_normal_target(safe_state, pref_fields)
    )
    nutrition = safe_state.get("nutrition") if isinstance(safe_state.get("nutrition"), dict) else {}

    adaptive_ready = adaptive_tdee.get("status") == "ready"
    tdee_est = _finite_float(adaptive_tdee.get("estimated_tdee")) if adaptive_ready else None
    nut_tdee = _finite_float(nutrition.get("tdee"))
    if tdee_est is not None and tdee_est > 0:
        tdee_ref = int(round(tdee_est))
    elif nut_tdee is not None and nut_tdee >= 1400:
        tdee_ref = int(round(nut_tdee))
    else:
        tdee_ref = int(round(base_cal + default_deficit))

    by_date = _merge_daily_nutrition_by_date(safe_state, nutrition_rows or [])
    workout_burn_map = _build_daily_workout_burn_map(
        safe_state, sessions or [], manual_acts or [], today_date, win_days=14
    )

    claims_by_date: Dict[date, int] = {}
    for c in history:
        cd = _parse_iso_date(c.get("date_str"))
        if cd is not None:
            claims_by_date[cd] = max(claims_by_date.get(cd, 0), int(c.get("bonus_kcal") or 0))

    protein_floor_req = int(round(0.85 * protein_anchor))
    logged_days_7d = 0
    clean_days_5d = 0
    clean_days_7d = 0
    clean_days_14d = 0
    banked_7d_sum = 0.0
    day_chips: List[Dict[str, Any]] = []

    for offset in range(14, 0, -1):
        d = today_date - timedelta(days=offset)
        rec = by_date.get(d)
        if rec is None:
            day_state = "unlogged"
            cals_d = 0
            prot_d = 0
        else:
            cals_d = rec["calories"]
            prot_d = rec["protein_g"]
            claim_bonus_d = claims_by_date.get(d, 0)
            w_burn_d = workout_burn_map.get(d, 0)
            if claim_bonus_d > 0:
                daily_ceiling_d = min(tdee_ref + 150, int(round(base_cal + w_burn_d + claim_bonus_d + 100)))
            elif w_burn_d == 0 and tdee_ref > base_cal + 350:
                daily_ceiling_d = min(int(round(base_cal + 250)), int(round(tdee_ref - 100)))
            else:
                daily_ceiling_d = int(round(base_cal + w_burn_d + 100))
                if adaptive_ready and tdee_ref >= base_cal:
                    daily_ceiling_d = min(daily_ceiling_d, max(1600, int(round(tdee_ref + w_burn_d - 50))))

            is_clean = (cals_d <= daily_ceiling_d) and (prot_d >= protein_floor_req)
            day_state = "clean" if is_clean else "over"
            if is_clean:
                clean_days_14d += 1
                if offset <= 7:
                    clean_days_7d += 1
                if offset <= 5:
                    clean_days_5d += 1
            if offset <= 7:
                logged_days_7d += 1
                day_tdee_d = float(tdee_ref)
                if not adaptive_ready and w_burn_d > 0:
                    day_tdee_d = max(day_tdee_d, float(base_cal + default_deficit + w_burn_d))
                day_delta = max(-500.0, min(day_tdee_d - 800.0, day_tdee_d - float(cals_d)))
                banked_7d_sum += day_delta

        if offset <= 7:
            day_chips.append({
                "date": d.isoformat(),
                "state": day_state,
                "calories": cals_d,
                "protein_g": prot_d,
            })

    banked_7d_kcal = int(round(max(0.0, banked_7d_sum)))
    active_today_claim, cooldown, scale_shield = _evaluate_flex_cooldowns(history, today_date, now)
    if autonomic_service is not None:
        try:
            ill_status = autonomic_service.compute_illness_status(today_iso)
            ill_shield = ill_status.get("recovery_scale_shield") or {}
            if ill_shield.get("active"):
                cur_hrs = int(scale_shield.get("hours_remaining") or 0) if scale_shield.get("active") else 0
                if not scale_shield.get("active") or int(ill_shield.get("hours_remaining") or 0) >= cur_hrs:
                    scale_shield = {
                        "active": True,
                        "hours_remaining": int(ill_shield.get("hours_remaining") or 24),
                        "claim_mode": "illness_recovery",
                        "note": str(ill_shield.get("note") or ""),
                    }
        except Exception:
            pass
    planned_bank = _evaluate_planned_bank(
        flex_plan,
        by_date=by_date,
        workout_burn_map=workout_burn_map,
        base_cal=base_cal,
        protein_anchor=protein_anchor,
        pre_flex_today_target=pre_flex_today_target,
        today_date=today_date,
        active_today_claim=active_today_claim,
        meal_cooldown_left=cooldown["flex_meal_days_left"],
    )

    trend_wk = _finite_float(adaptive_tdee.get("weight_trend_kg_per_week")) if adaptive_ready else None
    ov_status = str(overreaching.get("status") or "")
    fatigued_markers = list(overreaching.get("fatigued_markers") or [])

    snack_bonus = 300 if banked_7d_kcal >= 1400 else (250 if banked_7d_kcal >= 700 else 200)
    meal_headroom = max(400, (tdee_ref + 150) - base_cal)
    meal_bonus = min(650, max(400, min(550 if banked_7d_kcal < 2200 else 650, meal_headroom)))
    refeed_bonus = max(300, min(600, tdee_ref - base_cal))

    eligible_modes: List[str] = []
    tier_bonuses: Dict[str, int] = {}
    recommended_mode: Optional[str] = None
    suggested_bonus_kcal = 0
    status_label = "building"
    reason = ""

    if active_today_claim is not None:
        status_label = "claimed_today"
        recommended_mode = str(active_today_claim.get("mode"))
        suggested_bonus_kcal = int(active_today_claim.get("bonus_kcal") or 0)
        reason = f"Today's {_flex_mode_label(recommended_mode, suggested_bonus_kcal)} is active with protein anchor locked."
    elif planned_bank["active"] and planned_bank["days_remaining"] >= 1:
        status_label = "banking_in_progress"
        ded = planned_bank["daily_deduction_today"]
        banked = planned_bank["actual_banked_kcal"]
        tgt = planned_bank["target_kcal"]
        # Emergency Refeed override when dropping fast AND showing multiple fatigue markers
        emergency_refeed = (
            clean_days_14d >= 10
            and cooldown["refeed_day_days_left"] == 0
            and trend_wk is not None
            and trend_wk <= -0.75
            and len(fatigued_markers) >= 2
        )
        if emergency_refeed:
            eligible_modes.append("refeed_day")
            tier_bonuses["refeed_day"] = refeed_bonus
            recommended_mode = "refeed_day"
            suggested_bonus_kcal = refeed_bonus
            status_label = "unlocked"
            reason = (
                f"Rapid scale drop ({trend_wk:.2f} kg/wk) with fatigue markers triggered a priority "
                f"Maintenance Refeed (+{refeed_bonus} kcal) over planned banking."
            )
        else:
            if (
                active_cals >= 700
                and banked_7d_kcal >= 1000
                and cooldown["flex_snack_days_left"] == 0
            ):
                eligible_modes.append("flex_snack")
                tier_bonuses["flex_snack"] = snack_bonus
                recommended_mode = "flex_snack"
                suggested_bonus_kcal = snack_bonus
            lbl = planned_bank["label"]
            d_left = planned_bank["days_remaining"]
            reason = (
                f"Banking +{tgt} kcal for {lbl} ({planned_bank['target_date']}, {d_left}d left): "
                f"{banked} kcal earned so far, -{ded} kcal/day active trim. Earned Flex Meal paused to prevent double-dipping."
            )
    else:
        # Check planned_flex event day redemption
        if planned_bank["active"] and planned_bank["days_remaining"] == 0:
            if planned_bank["ready_to_redeem"]:
                eligible_modes.append("planned_flex")
                tier_bonuses["planned_flex"] = planned_bank["unlock_kcal"]

        # Tier 1: Flex Snack
        snack_cond = (clean_days_5d >= 3) or (active_cals >= 500 and clean_days_7d >= 3)
        if snack_cond and cooldown["flex_snack_days_left"] == 0:
            eligible_modes.append("flex_snack")
            tier_bonuses["flex_snack"] = snack_bonus

        # Tier 2: Flex Meal
        trend_ok_for_meal = (not adaptive_ready) or (trend_wk is not None and trend_wk <= -0.10)
        meal_cond = (
            clean_days_7d >= 5
            and logged_days_7d >= 5
            and banked_7d_kcal >= 1750
            and trend_ok_for_meal
        )
        if meal_cond and cooldown["flex_meal_days_left"] == 0:
            eligible_modes.append("flex_meal")
            tier_bonuses["flex_meal"] = meal_bonus

        # Tier 3: Structured Maintenance Refeed Day
        phys_need = (
            (adaptive_ready and trend_wk is not None and trend_wk <= -0.65)
            or (ov_status in ("caution", "deload_recommended"))
            or (len(fatigued_markers) >= 1)
        )
        refeed_cond = (clean_days_14d >= 10) and phys_need
        if refeed_cond and cooldown["refeed_day_days_left"] == 0:
            eligible_modes.append("refeed_day")
            tier_bonuses["refeed_day"] = refeed_bonus

        # Pick highest priority eligible tier
        for candidate in ("planned_flex", "refeed_day", "flex_meal", "flex_snack"):
            if candidate in eligible_modes:
                recommended_mode = candidate
                suggested_bonus_kcal = tier_bonuses[candidate]
                break

        if planned_bank["active"] and planned_bank["days_remaining"] == 0 and not planned_bank["ready_to_redeem"]:
            reason = (
                f"Planned event day ({planned_bank['label']}) only banked {planned_bank['actual_banked_kcal']} kcal "
                f"from completed logs (requires >=200 kcal)."
            )

        if recommended_mode is not None:
            status_label = "unlocked"
            if recommended_mode == "planned_flex":
                reason = (
                    f"{planned_bank['label']} unlocked: +{suggested_bonus_kcal} kcal earned from completed savings days "
                    f"(protein anchor locked at {protein_anchor}g)."
                )
            elif recommended_mode == "refeed_day":
                reason = (
                    f"{clean_days_14d}/14 clean days with recovery/loss demand — Maintenance Refeed Day "
                    f"(+{suggested_bonus_kcal} kcal high-carb boost) unlocked."
                )
            elif recommended_mode == "flex_meal":
                reason = (
                    f"{clean_days_7d}/7 clean logged days and ~{banked_7d_kcal:,} kcal banked — Flex Meal "
                    f"(+{suggested_bonus_kcal} kcal) unlocked with protein anchor locked."
                )
            else:
                reason = (
                    f"{clean_days_5d}/5 recent clean days — Flex Snack (+{suggested_bonus_kcal} kcal) unlocked."
                )
        elif logged_days_7d < 3:
            status_label = "insufficient_data"
            reason = "Log 3+ completed MyNetDiary days (>=800 kcal) to calibrate your Earned Flex meter."
        elif (
            (snack_cond and cooldown["flex_snack_days_left"] > 0)
            or (meal_cond and cooldown["flex_meal_days_left"] > 0)
            or (refeed_cond and cooldown["refeed_day_days_left"] > 0)
        ):
            status_label = "cooldown"
            reason = (
                f"Recent flex/refeed cooldown active (Snack: {cooldown['flex_snack_days_left']}d • "
                f"Meal: {cooldown['flex_meal_days_left']}d)."
            )
        else:
            status_label = "building"
            needed_clean = max(0, 3 - clean_days_5d)
            reason = (
                f"{clean_days_7d}/7 clean days & {banked_7d_kcal:,} kcal banked — "
                f"{needed_clean} more clean day(s) in window to unlock Flex Snack (5/7 for Flex Meal)."
                if needed_clean > 0
                else f"{clean_days_7d}/7 clean days & {banked_7d_kcal:,} kcal banked — hit 5/7 clean days & 1,750 kcal bank for Flex Meal."
            )

    active_deduction = planned_bank["daily_deduction_today"] if planned_bank["active"] else 0
    return {
        "date": today_iso,
        "status": status_label,
        "recommended_mode": recommended_mode,
        "eligible_modes": eligible_modes,
        "tier_bonuses": tier_bonuses,
        "suggested_bonus_kcal": int(suggested_bonus_kcal),
        "tdee_ref": int(tdee_ref),
        "streak": {
            "logged_days_7d": int(logged_days_7d),
            "clean_days_5d": int(clean_days_5d),
            "clean_days_7d": int(clean_days_7d),
            "clean_days_14d": int(clean_days_14d),
            "banked_7d_kcal": int(banked_7d_kcal),
            "day_chips": day_chips,
        },
        "cooldown": cooldown,
        "active_today": {
            "active": bool(active_today_claim is not None),
            "claim_id": active_today_claim.get("claim_id") if active_today_claim else None,
            "mode": active_today_claim.get("mode") if active_today_claim else None,
            "bonus_kcal": int(active_today_claim.get("bonus_kcal") or 0) if active_today_claim else 0,
            "deduction_kcal": int(active_deduction),
        },
        "planned_bank": planned_bank,
        "scale_shield": scale_shield,
        "reason": reason,
    }


def _format_bank_deduction_label(plan: Dict[str, Any], deduction: int) -> str:
    raw_lbl = str(plan.get("label") or "").strip()
    t_date = str(plan.get("target_date") or "")[:10]
    if raw_lbl:
        return f"Banking -{deduction} kcal ({raw_lbl})"
    return f"Banking -{deduction} kcal ({t_date})"


def compute_active_flex_delta(
    state: Dict[str, Any],
    target_date_str: str,
    normal_calories: int,
    protein_g: int,
    carbs_g: int,
    fat_g: int,
    now_uk: Optional[datetime] = None,
    conn=None,
) -> Optional[Dict[str, Any]]:
    """Compute today's net flex/bank adjustment without mutating protein targets."""
    target_date = _parse_iso_date(target_date_str)
    if target_date is None:
        return None
    target_iso = target_date.isoformat()

    history = load_flex_history(conn=conn)
    plan = load_flex_bank_plan(conn=conn)
    if not history and not plan:
        return None

    today_claim = None
    for c in history:
        if c.get("date_str") == target_iso:
            today_claim = c

    if today_claim is not None:
        mode = str(today_claim["mode"])
        bonus = int(today_claim["bonus_kcal"])
        c_share, f_share = _FLEX_MACRO_SPLITS.get(mode, (0.65, 0.35))
        carb_delta = int(round((bonus * c_share) / 4.0))
        fat_delta = int(round((bonus * f_share) / 9.0))
        return {
            "date": target_iso,
            "type": "claim",
            "mode": mode,
            "adjustment_kcal": bonus,
            "carb_delta_g": carb_delta,
            "fat_delta_g": fat_delta,
            "label": str(today_claim.get("label") or _flex_mode_label(mode, bonus)),
            "claim_id": today_claim.get("claim_id"),
            "plan_id": today_claim.get("plan_id"),
        }

    if not isinstance(plan, dict) or plan.get("status") != "active":
        return None

    p_target = _parse_iso_date(plan.get("target_date"))
    p_start = _parse_iso_date(plan.get("start_date")) or _parse_iso_date(plan.get("created_date"))
    if p_target is None or p_start is None or not (p_start <= target_date < p_target):
        return None

    if conn is not None:
        nutrition_rows = db.get_daily_nutrition(days=21, conn=conn)
        sessions = db.get_workout_sessions(days=35, conn=conn)
        manual_acts = db.get_manual_activities(days=35, conn=conn)
    else:
        db.init_db()
        with closing(db.get_connection()) as active_conn:
            nutrition_rows = db.get_daily_nutrition(days=21, conn=active_conn)
            sessions = db.get_workout_sessions(days=35, conn=active_conn)
            manual_acts = db.get_manual_activities(days=35, conn=active_conn)

    base_cal, protein_anchor, _, _, _ = _resolve_nutrition_anchors_and_normal_target(state)
    by_date = _merge_daily_nutrition_by_date(state, nutrition_rows)
    workout_burn_map = _build_daily_workout_burn_map(state, sessions, manual_acts, target_date, win_days=14)
    bank = _evaluate_planned_bank(
        plan,
        by_date=by_date,
        workout_burn_map=workout_burn_map,
        base_cal=base_cal,
        protein_anchor=max(protein_anchor, protein_g),
        pre_flex_today_target=normal_calories,
        today_date=target_date,
        active_today_claim=None,
        meal_cooldown_left=0,
    )
    deduction = int(bank.get("daily_deduction_today") or 0)
    if deduction <= 0:
        return None

    max_carb_cut_kcal = max(0, carbs_g - 50) * 4
    max_fat_cut_kcal = max(0, fat_g - 40) * 9
    carb_delta = 0
    fat_delta = 0
    if max_carb_cut_kcal + max_fat_cut_kcal > 0:
        carb_cut_kcal = min(max_carb_cut_kcal, int(round(deduction * 0.60)))
        fat_cut_kcal = min(max_fat_cut_kcal, deduction - carb_cut_kcal)
        rem_kcal = deduction - carb_cut_kcal - fat_cut_kcal
        if rem_kcal > 0:
            carb_cut_kcal += min(max_carb_cut_kcal - carb_cut_kcal, rem_kcal)
        carb_delta = -int(round(carb_cut_kcal / 4.0))
        fat_delta = -int(round(fat_cut_kcal / 9.0))

    return {
        "date": target_iso,
        "type": "bank_deduction",
        "mode": "planned_bank",
        "adjustment_kcal": -deduction,
        "carb_delta_g": carb_delta,
        "fat_delta_g": fat_delta,
        "label": _format_bank_deduction_label(plan, deduction),
        "claim_id": None,
        "plan_id": plan.get("plan_id"),
    }


def claim_flex_refeed(
    state: Dict[str, Any],
    mode: str,
    bonus_kcal: Optional[int] = None,
    now_uk: Optional[datetime] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate eligibility & cooldowns, persist claim, and recalculate today's nutrition."""
    req_mode = str(mode or "").strip()
    if req_mode not in FLEX_VALID_MODES:
        raise FlexRuleError(f"Unsupported flex mode '{req_mode}'", status_code=422)

    now = now_uk or uk_now()
    today_iso = now.date().isoformat()
    status_obj = compute_flex_refeed_status(state, today_str=today_iso, now_uk=now)

    if status_obj["active_today"]["active"]:
        raise FlexRuleError("A Flex/Refeed boost is already active today.", status_code=409)
    if req_mode not in status_obj["eligible_modes"]:
        raise FlexRuleError(
            status_obj.get("reason") or f"Mode '{req_mode}' is not eligible right now.",
            status_code=409,
        )

    tier_ceiling = int(status_obj["tier_bonuses"].get(req_mode) or status_obj.get("suggested_bonus_kcal") or 250)
    if bonus_kcal is not None:
        if bonus_kcal < 200 or bonus_kcal > 800:
            raise FlexRuleError("bonus_kcal must be between 200 and 800 kcal.", status_code=422)
        resolved_bonus = min(int(bonus_kcal), tier_ceiling)
        if resolved_bonus < 200:
            resolved_bonus = tier_ceiling
    else:
        resolved_bonus = tier_ceiling

    c_share, f_share = _FLEX_MACRO_SPLITS.get(req_mode, (0.65, 0.35))
    claim_id = f"flx_{today_iso.replace('-', '')}_{uuid.uuid4().hex[:6]}"
    plan_id = None
    source = "earned"
    plan = load_flex_bank_plan()
    if req_mode == "planned_flex" and isinstance(plan, dict) and plan.get("status") == "active":
        plan_id = plan.get("plan_id")
        source = "planned_bank"
        plan["status"] = "claimed"
        plan["claimed_id"] = claim_id
        plan["claimed_date"] = today_iso
        plan["updated_at"] = now.isoformat()
        save_flex_bank_plan(plan)

    claim_record = {
        "claim_id": claim_id,
        "date_str": today_iso,
        "claimed_at": now.isoformat(),
        "mode": req_mode,
        "bonus_kcal": int(resolved_bonus),
        "carb_share": c_share,
        "fat_share": f_share,
        "triggers_scale_shield": bool(req_mode in FLEX_SHIELD_MODES),
        "plan_id": plan_id,
        "source": source,
        "label": (
            f"{plan['label']} (+{resolved_bonus} kcal)"
            if (req_mode == "planned_flex" and isinstance(plan, dict) and plan.get("label"))
            else _flex_mode_label(req_mode, resolved_bonus)
        ),
    }

    history = load_flex_history()
    history.append(claim_record)
    save_flex_history(history)

    recalculate_nutrition(state, today_iso)
    fresh_status = compute_flex_refeed_status(state, today_str=today_iso, now_uk=now)
    return claim_record, fresh_status


def undo_flex_refeed(
    state: Dict[str, Any],
    claim_id: Optional[str] = None,
    now_uk: Optional[datetime] = None,
) -> Tuple[str, Dict[str, Any]]:
    """Undo a same-day Flex/Refeed claim; prior-date claims are immutable (HTTP 409)."""
    now = now_uk or uk_now()
    today_iso = now.date().isoformat()
    today_date = now.date()
    history = load_flex_history()

    target_idx = None
    target_claim = None
    if claim_id:
        cid = str(claim_id).strip()
        for idx in range(len(history) - 1, -1, -1):
            if history[idx].get("claim_id") == cid:
                target_idx = idx
                target_claim = history[idx]
                break
        if target_claim is None:
            raise FlexRuleError("Flex claim not found.", status_code=409)
        if target_claim.get("date_str") != today_iso:
            raise FlexRuleError("Only today's Flex/Refeed claim can be undone.", status_code=409)
    else:
        for idx in range(len(history) - 1, -1, -1):
            if history[idx].get("date_str") == today_iso:
                target_idx = idx
                target_claim = history[idx]
                break
        if target_claim is None:
            raise FlexRuleError("No active Flex/Refeed claim to undo today.", status_code=409)

    removed_id = str(target_claim.get("claim_id") or "")
    history.pop(target_idx)
    save_flex_history(history)

    linked_plan_id = target_claim.get("plan_id")
    if linked_plan_id:
        plan = load_flex_bank_plan()
        if isinstance(plan, dict) and plan.get("plan_id") == linked_plan_id and plan.get("status") == "claimed":
            p_target = _parse_iso_date(plan.get("target_date"))
            if p_target is not None and p_target >= today_date:
                plan["status"] = "active"
                plan.pop("claimed_id", None)
                plan.pop("claimed_date", None)
                plan["updated_at"] = now.isoformat()
                save_flex_bank_plan(plan)

    recalculate_nutrition(state, today_iso)
    fresh_status = compute_flex_refeed_status(state, today_str=today_iso, now_uk=now)
    return removed_id, fresh_status


def upsert_or_cancel_flex_bank_plan(
    state: Dict[str, Any],
    action: str,
    target_date: Optional[str] = None,
    target_kcal: Optional[int] = None,
    label: str = "",
    now_uk: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Create/update or cancel a Planned Weekend/Event Banking schedule."""
    act = str(action or "").strip().lower()
    if act not in ("upsert", "cancel"):
        raise FlexRuleError("action must be 'upsert' or 'cancel'.", status_code=422)

    now = now_uk or uk_now()
    today_date = now.date()
    today_iso = today_date.isoformat()

    if act == "cancel":
        save_flex_bank_plan(None)
        recalculate_nutrition(state, today_iso)
        return compute_flex_refeed_status(state, today_str=today_iso, now_uk=now)

    history = load_flex_history()
    if any(c.get("date_str") == today_iso for c in history):
        raise FlexRuleError(
            "An active Flex/Refeed claim is already applied today; undo today's claim before scheduling a new bank plan.",
            status_code=409,
        )

    parsed_target = _parse_iso_date(target_date)
    if parsed_target is None:
        raise FlexRuleError("Valid target_date (YYYY-MM-DD) is required.", status_code=422)
    days_ahead = (parsed_target - today_date).days
    if days_ahead < 1 or days_ahead > 7:
        raise FlexRuleError("target_date must be between 1 and 7 days ahead.", status_code=422)

    kcal_num = _finite_float(target_kcal)
    if kcal_num is None or kcal_num < 200 or kcal_num > 800:
        raise FlexRuleError("target_kcal must be between 200 and 800 kcal.", status_code=422)
    resolved_kcal = int(round(kcal_num))

    daily_cap = min(200, max(50, int(round(resolved_kcal / float(days_ahead)))))
    existing = load_flex_bank_plan()
    start_iso = today_iso
    if isinstance(existing, dict) and existing.get("status") == "active":
        ex_start = _parse_iso_date(existing.get("start_date"))
        if ex_start is not None and ex_start <= today_date and existing.get("target_date") == parsed_target.isoformat():
            start_iso = ex_start.isoformat()

    plan_obj = {
        "plan_id": f"fbp_{today_iso.replace('-', '')}_{uuid.uuid4().hex[:6]}",
        "status": "active",
        "created_date": today_iso,
        "start_date": start_iso,
        "target_date": parsed_target.isoformat(),
        "target_kcal": resolved_kcal,
        "label": str(label or "").strip()[:40],
        "daily_deduction_cap": daily_cap,
        "updated_at": now.isoformat(),
    }
    save_flex_bank_plan(plan_obj)
    recalculate_nutrition(state, today_iso)
    return compute_flex_refeed_status(state, today_str=today_iso, now_uk=now)
