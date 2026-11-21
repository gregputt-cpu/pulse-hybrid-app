import json
import math
from contextlib import closing
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional, Tuple

import db
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
        if win_start <= d <= today_date:
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
        if min_fuel_date <= d <= max_fuel_date
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

    return {
        "adaptive_tdee": compute_adaptive_tdee(safe_state, renpho_rows, nutrition_rows, today_str),
        "overreaching": compute_acwr_overreaching(safe_state, sessions, manual_acts, bio_rows, today_str),
        "sync_freshness": compute_sync_freshness(safe_state, now_uk=now_uk),
        "strength_prs": strength_prs,
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
