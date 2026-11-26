import csv
import io
import math
import statistics
import uuid
from datetime import date, datetime, time as dt_time, timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import db
import time_utils
from time_utils import UK_TZ, uk_now

CLINICAL_DISCLAIMER = (
    "Self-monitoring & Garmin biometric correlation record only. "
    "NOT a medical device and does NOT diagnose, rule out, or replace evaluation "
    "for neurological, autonomic, cardiac, or metabolic conditions. Routine resting "
    "20-40 min surface EEG was normal; review patterns with GP / Neurology / Cardiology."
)

DRIVING_SAFETY_ADVISORY = (
    "Safety Notice: Avoid driving (Volkswagen ID. Buzz) and avoid solo high-risk "
    "physical exertion (heavy solo lifting, water exposure, heights) until autonomic "
    "metrics normalize and symptoms fully clear."
)

CAUTION_CHECKIN_ADVISORY = (
    "Elevated autonomic strain detected. Do a quick symptom check before driving "
    "or hard solo training — dismiss for today if you feel completely normal."
)

WATCH_INFO_ADVISORY = (
    "Overnight HRV is slightly below your 7-day baseline. "
    "Informational only — hydrate well and pace load."
)

WATCH_POST_ILLNESS_ADVISORY = (
    "Overnight HRV is slightly below baseline — expected lag while recovering from illness. "
    "Hydrate well and pace load."
)

SYMPTOM_LABELS: Dict[str, str] = {
    "dizziness_vertigo": "Dizziness / Vertigo",
    "lightheaded_presyncope": "Lightheadedness / Presyncope",
    "dissociation": "Dissociation / Detachment",
    "confusion_brain_fog": "Confusion / Brain Fog",
    "impending_doom": "Impending Doom / Adrenaline Wave",
    "visual_changes": "Visual Changes",
    "blackout": "Blackout / Loss of Consciousness",
}

TRIGGER_LABELS: Dict[str, str] = {
    "standing_quickly": "Standing Up Quickly",
    "driving": "Driving (ID. Buzz)",
    "fasted_state": "Fasted State",
    "post_exercise": "Post-Exercise",
    "poor_sleep": "Poor Sleep",
    "high_workload": "High Workload / Screen Strain",
    "illness_infection": "Illness / Active Infection",
    "dehydration_heat": "Dehydration / Heat",
    "caffeine_stimulant": "Caffeine / Stimulant",
}

ILLNESS_SYMPTOM_LABELS: Dict[str, str] = {
    "fever_chills": "Fever / Chills",
    "fatigue_malaise": "Deep Fatigue / Malaise",
    "respiratory_sinus": "Respiratory / Sinus Congestion",
    "gi_nausea": "GI Upset / Nausea",
    "headache_aches": "Headache / Body Aches",
    "elevated_rhr_stress": "Elevated RHR / High Sleep Stress",
}

DIFFERENTIAL_PATHWAYS: Dict[str, Dict[str, Any]] = {
    "autonomic_dysregulation": {
        "key": "autonomic_dysregulation",
        "label": "Autonomic Nervous System Dysregulation",
        "summary": "Sympathetic hyperarousal or impaired parasympathetic braking (nocturnal stress 30+, suppressed HRV, illness recovery lag).",
    },
    "paroxysmal_focal_neuro": {
        "key": "paroxysmal_focal_neuro",
        "label": "Paroxysmal Focal Neurological Signaling",
        "summary": "Brief deep temporal/insular episodes (dissociation, rising adrenaline/doom wave, visual shifts, brain fog, blackout) missed on brief resting scalp EEG.",
    },
    "perfusion_orthostatic": {
        "key": "perfusion_orthostatic",
        "label": "Transient Cerebral Perfusion / Orthostatic Shifts",
        "summary": "Postural baroreceptor lag, presyncope, post-exertional vasodilation, or dehydration dips relevant to Cardiology / tilt review.",
    },
    "metabolic_fuel_load": {
        "key": "metabolic_fuel_load",
        "label": "Metabolic / Fueling & Load Triggers",
        "summary": "Fasted strain, cumulative physical load, sleep deprivation, or acute viral/febrile illness lowering episode threshold.",
    },
}

VALID_SYMPTOMS = set(SYMPTOM_LABELS.keys())
VALID_TRIGGERS = set(TRIGGER_LABELS.keys())
VALID_ILLNESS_SYMPTOMS = set(ILLNESS_SYMPTOM_LABELS.keys())


def _parse_ts_ms(raw_val: Any) -> Optional[int]:
    if raw_val is None or isinstance(raw_val, bool):
        return None
    if isinstance(raw_val, (int, float)):
        f = float(raw_val)
        if not math.isfinite(f) or f <= 0:
            return None
        return int(round(f if f > 1e12 else f * 1000.0))
    s = str(raw_val).strip()
    if not s:
        return None
    try:
        num = float(s)
        if math.isfinite(num) and num > 0:
            return int(round(num if num > 1e12 else num * 1000.0))
    except ValueError:
        pass
    dt = time_utils.parse_uk_ts(s)
    if dt is not None:
        return int(round(dt.timestamp() * 1000.0))
    return None


def _ms_to_uk_iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000.0, tz=UK_TZ).isoformat()


def _day_bounds_ms(date_str: str) -> Tuple[int, int]:
    d = datetime.strptime(str(date_str)[:10], "%Y-%m-%d").date()
    start_dt = datetime.combine(d, dt_time.min, tzinfo=UK_TZ)
    end_dt = start_dt + timedelta(days=1)
    return int(round(start_dt.timestamp() * 1000.0)), int(round(end_dt.timestamp() * 1000.0))


def normalize_intraday_series(
    raw_items: Any,
    min_val: int = 0,
    max_val: int = 100,
    keep_negative: bool = False,
) -> List[List[int]]:
    """Normalize Garmin array/dict intraday series into sorted [[ts_ms, val], ...] pairs."""
    if not isinstance(raw_items, list):
        return []
    out_map: Dict[int, int] = {}
    for item in raw_items:
        ts_raw = None
        val_raw = None
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            ts_raw = item[0]
            # bodyBatteryValuesArray sometimes has 4 elements; stress/hr has 2
            val_raw = item[1]
        elif isinstance(item, dict):
            ts_raw = (
                item.get("startGMT")
                or item.get("timestampGMT")
                or item.get("timestamp")
                or item.get("ts")
                or item.get("time")
            )
            for vk in ("value", "stressLevel", "heartRate", "val"):
                if item.get(vk) is not None:
                    val_raw = item.get(vk)
                    break
        ts_ms = _parse_ts_ms(ts_raw)
        if ts_ms is None:
            continue
        if val_raw is None or isinstance(val_raw, bool):
            continue
        try:
            f_val = float(val_raw)
        except (ValueError, TypeError):
            continue
        if not math.isfinite(f_val):
            continue
        v = int(round(f_val))
        if not keep_negative and (v < min_val or v > max_val):
            continue
        if keep_negative and v >= 0 and (v < min_val or v > max_val):
            continue
        if keep_negative and v < -10:
            continue
        out_map[ts_ms] = v
    return [[ts, out_map[ts]] for ts in sorted(out_map.keys())]


def extract_workout_intervals(live_state: Optional[Dict[str, Any]], target_date_str: Optional[str] = None) -> List[Tuple[int, int]]:
    """Collect logged workout intervals buffered by +/- 5 minutes as epoch ms tuples."""
    intervals: List[Tuple[int, int]] = []
    buffer_ms = 5 * 60 * 1000
    seen: Set[Tuple[int, int]] = set()

    def _add_activity(raw_date: Any, raw_dur_min: Any) -> None:
        if raw_dur_min is None or isinstance(raw_dur_min, bool):
            return
        try:
            dur_m = float(raw_dur_min)
        except (ValueError, TypeError):
            return
        if not math.isfinite(dur_m) or dur_m <= 0:
            return
        dt = time_utils.parse_uk_ts(raw_date)
        if dt is None:
            return
        if target_date_str:
            d_str = dt.date().isoformat()
            prev_day = (datetime.strptime(target_date_str[:10], "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
            next_day = (datetime.strptime(target_date_str[:10], "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
            if d_str not in (prev_day, target_date_str[:10], next_day):
                return
        start_ms = int(round(dt.timestamp() * 1000.0)) - buffer_ms
        end_ms = int(round((dt.timestamp() + dur_m * 60.0) * 1000.0)) + buffer_ms
        key = (start_ms, end_ms)
        if key not in seen:
            seen.add(key)
            intervals.append(key)

    garmin = (live_state or {}).get("garmin") or {}
    for bucket_key in ("today_activities", "recent_activities"):
        acts = garmin.get(bucket_key)
        if isinstance(acts, list):
            for act in acts:
                if isinstance(act, dict):
                    _add_activity(act.get("date") or act.get("startTimeLocal"), act.get("duration_min"))

    try:
        for man in db.get_manual_activities(days=7):
            _add_activity(man.get("timestamp"), man.get("duration_min"))
    except Exception:
        pass

    return intervals


def _in_intervals(ts_ms: int, intervals: List[Tuple[int, int]]) -> bool:
    for s_ms, e_ms in intervals:
        if s_ms <= ts_ms <= e_ms:
            return True
    return False


def _filter_valid_stress(samples: List[List[int]]) -> List[List[int]]:
    clean: List[List[int]] = []
    for pair in samples or []:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        ts_ms, val = pair[0], pair[1]
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            continue
        if not math.isfinite(float(val)):
            continue
        v = int(round(float(val)))
        if 0 <= v <= 100 and isinstance(ts_ms, (int, float)) and ts_ms > 0:
            clean.append([int(ts_ms), v])
    clean.sort(key=lambda x: x[0])
    return clean


def _filter_valid_hr(samples: List[List[int]]) -> List[List[int]]:
    clean: List[List[int]] = []
    for pair in samples or []:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        ts_ms, val = pair[0], pair[1]
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            continue
        if not math.isfinite(float(val)):
            continue
        v = int(round(float(val)))
        if 25 <= v <= 240 and isinstance(ts_ms, (int, float)) and ts_ms > 0:
            clean.append([int(ts_ms), v])
    clean.sort(key=lambda x: x[0])
    return clean


def evaluate_level1_baseline(
    today_bio: Optional[Dict[str, Any]],
    bio_history: List[Dict[str, Any]],
    intraday_today: Optional[Dict[str, Any]],
    intraday_yesterday: Optional[Dict[str, Any]] = None,
    target_date_str: Optional[str] = None,
) -> Dict[str, Any]:
    """Alert Level 1 (Amber): Elevated overnight sleeping stress OR HRV drop below 7-day baseline."""
    t_date = target_date_str or (today_bio or {}).get("date_str") or uk_now().date().isoformat()
    bio = dict(today_bio or {})
    sleep_start_ts = bio.get("sleep_start_ts")
    sleep_end_ts = bio.get("sleep_end_ts")

    raw_sleep_samples: List[List[int]] = []
    if intraday_today and intraday_today.get("sleep_stress_samples"):
        raw_sleep_samples = list(intraday_today.get("sleep_stress_samples") or [])
    elif sleep_start_ts and sleep_end_ts and int(sleep_end_ts) > int(sleep_start_ts):
        combined_stress: List[List[int]] = []
        if intraday_yesterday and intraday_yesterday.get("stress_samples"):
            combined_stress.extend(intraday_yesterday.get("stress_samples") or [])
        if intraday_today and intraday_today.get("stress_samples"):
            combined_stress.extend(intraday_today.get("stress_samples") or [])
        s_ms, e_ms = int(sleep_start_ts), int(sleep_end_ts)
        raw_sleep_samples = [p for p in combined_stress if isinstance(p, list) and len(p) >= 2 and s_ms <= int(p[0]) <= e_ms]

    valid_sleep = _filter_valid_stress(raw_sleep_samples)
    total_sleep_samples = len(raw_sleep_samples)

    sleep_coverage_pct = None
    if sleep_start_ts and sleep_end_ts and int(sleep_end_ts) > int(sleep_start_ts):
        dur_mins = max(1.0, (int(sleep_end_ts) - int(sleep_start_ts)) / 60000.0)
        # Garmin stress epochs ~3 mins
        expected = max(1.0, dur_mins / 3.0)
        sleep_coverage_pct = round(min(100.0, (len(valid_sleep) / expected) * 100.0), 1)
    elif total_sleep_samples > 0:
        sleep_coverage_pct = round((len(valid_sleep) / total_sleep_samples) * 100.0, 1)

    sleep_avg_stress: Optional[float] = None
    sleep_rest_pct: Optional[float] = None
    sleep_30_plus_pct: Optional[float] = None
    sleep_stress_triggered = False
    sleep_quality = "missing"

    if len(valid_sleep) >= 6 and (sleep_coverage_pct is None or sleep_coverage_pct >= 30.0):
        sleep_quality = "ok"
        vals = [p[1] for p in valid_sleep]
        sleep_avg_stress = round(sum(vals) / len(vals), 1)
        rest_cnt = sum(1 for v in vals if v <= 25)
        elev_cnt = sum(1 for v in vals if v >= 30)
        sleep_rest_pct = round((rest_cnt / len(vals)) * 100.0, 1)
        sleep_30_plus_pct = round((elev_cnt / len(vals)) * 100.0, 1)
        if sleep_avg_stress >= 30.0 or (sleep_30_plus_pct >= 55.0 and sleep_rest_pct < 25.0):
            sleep_stress_triggered = True
    elif len(valid_sleep) > 0:
        sleep_quality = "insufficient"
    elif bio.get("sleep_avg_stress") is not None and (sleep_coverage_pct is None or sleep_coverage_pct >= 30.0):
        try:
            avg_s = float(bio["sleep_avg_stress"])
            if math.isfinite(avg_s) and 0 <= avg_s <= 100:
                sleep_quality = "summary_only"
                sleep_avg_stress = round(avg_s, 1)
                if sleep_avg_stress >= 30.0:
                    sleep_stress_triggered = True
        except (TypeError, ValueError):
            pass

    # Rolling 7-day HRV baseline excluding target date
    t_date_obj = datetime.strptime(t_date[:10], "%Y-%m-%d").date()
    win_start = (t_date_obj - timedelta(days=7)).isoformat()
    win_end = (t_date_obj - timedelta(days=1)).isoformat()
    prior_hrv_vals: List[float] = []
    for row in bio_history or []:
        d_str = str(row.get("date_str") or "")[:10]
        if not d_str or not (win_start <= d_str <= win_end):
            continue
        hv = row.get("hrv_last_night")
        if hv is not None and not isinstance(hv, bool):
            try:
                f_hv = float(hv)
                if math.isfinite(f_hv) and f_hv > 0:
                    prior_hrv_vals.append(f_hv)
            except (TypeError, ValueError):
                pass

    hrv_last_night = None
    if bio.get("hrv_last_night") is not None and not isinstance(bio.get("hrv_last_night"), bool):
        try:
            f_ln = float(bio["hrv_last_night"])
            if math.isfinite(f_ln) and f_ln > 0:
                hrv_last_night = round(f_ln, 1)
        except (TypeError, ValueError):
            pass

    hrv_baseline_low = None
    if bio.get("hrv_baseline_low") is not None and not isinstance(bio.get("hrv_baseline_low"), bool):
        try:
            f_bl = float(bio["hrv_baseline_low"])
            if math.isfinite(f_bl) and f_bl > 0:
                hrv_baseline_low = round(f_bl, 1)
        except (TypeError, ValueError):
            pass

    hrv_status = str(bio.get("hrv_status") or "").strip().upper() or None
    rolling_7d_baseline: Optional[float] = None
    threshold_ms: Optional[float] = None

    if len(prior_hrv_vals) >= 3:
        rolling_7d_baseline = round(sum(prior_hrv_vals) / len(prior_hrv_vals), 1)
        pct_floor = round(rolling_7d_baseline * 0.85, 1)
        low_floor = round(hrv_baseline_low - 5.0, 1) if hrv_baseline_low is not None else None
        threshold_ms = round(max(pct_floor, low_floor) if low_floor is not None else pct_floor, 1)
    elif hrv_baseline_low is not None:
        rolling_7d_baseline = hrv_baseline_low
        threshold_ms = round(hrv_baseline_low - 5.0, 1)

    hrv_drop_pct: Optional[float] = None
    if hrv_last_night is not None and rolling_7d_baseline and rolling_7d_baseline > 0:
        hrv_drop_pct = round(((hrv_last_night - rolling_7d_baseline) / rolling_7d_baseline) * 100.0, 1)

    hrv_mild_dip = bool(
        (hrv_last_night is not None and rolling_7d_baseline is not None and hrv_last_night < rolling_7d_baseline)
        or (hrv_last_night is not None and hrv_baseline_low is not None and hrv_last_night < hrv_baseline_low)
        or hrv_status in ("LOW", "POOR")
    )

    hrv_triggered = False
    if hrv_last_night is not None and threshold_ms is not None and hrv_last_night <= threshold_ms:
        hrv_triggered = True
    elif hrv_last_night is None and hrv_status in ("LOW", "POOR"):
        hrv_triggered = True

    triggers: List[str] = []
    if sleep_stress_triggered:
        triggers.append("overnight_sleep_stress_elevated")
    if hrv_triggered:
        triggers.append("overnight_hrv_below_baseline")

    return {
        "active": bool(sleep_stress_triggered or hrv_triggered),
        "triggers": triggers,
        "sleep_avg_stress": sleep_avg_stress,
        "sleep_rest_pct": sleep_rest_pct,
        "sleep_30_plus_pct": sleep_30_plus_pct,
        "sleep_valid_coverage_pct": sleep_coverage_pct,
        "sleep_valid_samples": len(valid_sleep),
        "sleep_data_quality": sleep_quality,
        "hrv_last_night": hrv_last_night,
        "hrv_7d_baseline": rolling_7d_baseline,
        "hrv_threshold_ms": threshold_ms,
        "hrv_baseline_low": hrv_baseline_low,
        "hrv_drop_pct": hrv_drop_pct,
        "hrv_mild_dip": hrv_mild_dip,
        "hrv_status": hrv_status,
        "hrv_prior_nights": len(prior_hrv_vals),
    }


def evaluate_level2_sympathetic_load(
    intraday_today: Optional[Dict[str, Any]],
    sleep_end_ts: Optional[int],
    workout_intervals_ms: List[Tuple[int, int]],
    target_date_str: Optional[str] = None,
) -> Dict[str, Any]:
    """Alert Level 2 (Amber/Red): Daytime non-workout stress pinned >25 for 4+ consecutive hours without recovery dips."""
    t_date = target_date_str or (intraday_today or {}).get("date_str") or uk_now().date().isoformat()
    day_start_ms, _ = _day_bounds_ms(t_date)
    day_0500 = day_start_ms + 5 * 3600 * 1000
    day_0600 = day_start_ms + 6 * 3600 * 1000
    daytime_start_ms = max(int(sleep_end_ts) if sleep_end_ts else day_0600, day_0500)

    raw_samples = list((intraday_today or {}).get("stress_samples") or [])
    valid_daytime = [
        p for p in _filter_valid_stress(raw_samples)
        if p[0] >= daytime_start_ms and not _in_intervals(p[0], workout_intervals_ms)
    ]

    if not valid_daytime:
        return {
            "active": False,
            "current_streak_mins": 0,
            "max_streak_mins": 0,
            "streak_start_time": None,
            "streak_coverage_pct": 0.0,
            "valid_samples": 0,
        }

    # Estimate nominal sampling interval cleanly (Garmin watch = 3 min; allow 3..10 min test vectors)
    diffs_min = [
        (valid_daytime[i][0] - valid_daytime[i - 1][0]) / 60000.0
        for i in range(1, len(valid_daytime))
        if 0 < (valid_daytime[i][0] - valid_daytime[i - 1][0]) <= 15 * 60 * 1000
    ]
    epoch_min = max(3.0, min(10.0, float(statistics.median(diffs_min)))) if diffs_min else 3.0

    max_gap_ms = 15 * 60 * 1000
    recovery_reset_ms = 6 * 60 * 1000

    streak_start_ms: Optional[int] = None
    last_high_ms: Optional[int] = None
    last_valid_ms: Optional[int] = None
    dip_start_ms: Optional[int] = None
    streak_count = 0

    best_streak_mins = 0
    best_streak_start: Optional[int] = None
    best_coverage_pct = 0.0

    current_streak_mins = 0
    current_coverage_pct = 0.0

    def _record_streak(s_ms: Optional[int], e_ms: Optional[int], cnt: int) -> Tuple[int, float]:
        if s_ms is None or e_ms is None or e_ms <= s_ms or cnt < 16:
            return 0, 0.0
        dur_m = int(round((e_ms - s_ms) / 60000.0))
        expected = max(1.0, dur_m / epoch_min)
        cov = round(min(100.0, (cnt / expected) * 100.0), 1)
        if cov < 50.0:
            return 0, cov
        return dur_m, cov

    for ts_ms, val in valid_daytime:
        if last_valid_ms is not None and (ts_ms - last_valid_ms) > max_gap_ms:
            # Break streak across >15m unmeasured gap
            dur_m, cov = _record_streak(streak_start_ms, last_high_ms, streak_count)
            if dur_m > best_streak_mins:
                best_streak_mins = dur_m
                best_streak_start = streak_start_ms
                best_coverage_pct = cov
            streak_start_ms = None
            last_high_ms = None
            dip_start_ms = None
            streak_count = 0

        last_valid_ms = ts_ms

        if val > 25:
            dip_start_ms = None
            if streak_start_ms is None:
                streak_start_ms = ts_ms
                streak_count = 1
            else:
                streak_count += 1
            last_high_ms = ts_ms
        else:
            if streak_start_ms is not None:
                if dip_start_ms is None:
                    dip_start_ms = ts_ms
                if (ts_ms - dip_start_ms) >= recovery_reset_ms:
                    dur_m, cov = _record_streak(streak_start_ms, last_high_ms, streak_count)
                    if dur_m > best_streak_mins:
                        best_streak_mins = dur_m
                        best_streak_start = streak_start_ms
                        best_coverage_pct = cov
                    streak_start_ms = None
                    last_high_ms = None
                    dip_start_ms = None
                    streak_count = 0

    # Final active tail
    tail_dur_m, tail_cov = _record_streak(streak_start_ms, last_high_ms, streak_count)
    current_streak_mins = tail_dur_m
    current_coverage_pct = tail_cov
    if tail_dur_m >= best_streak_mins and tail_dur_m > 0:
        best_streak_mins = tail_dur_m
        best_streak_start = streak_start_ms
        best_coverage_pct = tail_cov

    active = best_streak_mins >= 240
    return {
        "active": active,
        "current_streak_mins": current_streak_mins,
        "max_streak_mins": best_streak_mins,
        "streak_start_time": _ms_to_uk_iso(best_streak_start) if best_streak_start else None,
        "streak_coverage_pct": best_coverage_pct if best_streak_mins > 0 else current_coverage_pct,
        "valid_samples": len(valid_daytime),
    }


def detect_acute_episode_spikes(
    intraday_today: Optional[Dict[str, Any]],
    workout_intervals_ms: List[Tuple[int, int]],
    now_ms: Optional[int] = None,
    dismissed_before_ms: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Detect unprovoked Stress (>=75) or abrupt HR deviation outside logged workouts in last 3 hours."""
    if not intraday_today:
        return None
    ref_now = now_ms if now_ms is not None else int(round(uk_now().timestamp() * 1000.0))
    cutoff_ms = ref_now - (3 * 3600 * 1000)

    stress_pts = [
        p for p in _filter_valid_stress(intraday_today.get("stress_samples") or [])
        if cutoff_ms <= p[0] <= ref_now and not _in_intervals(p[0], workout_intervals_ms)
    ]
    hr_pts = [
        p for p in _filter_valid_hr(intraday_today.get("hr_samples") or [])
        if (cutoff_ms - 35 * 60 * 1000) <= p[0] <= ref_now and not _in_intervals(p[0], workout_intervals_ms)
    ]

    detected_stress_spike: Optional[Tuple[int, int, str]] = None
    # Stress >= 75 sustained >= 6 min (or >= 85 with adjacent >= 70)
    high_run_start: Optional[int] = None
    high_peak = 0
    for i, (ts_ms, val) in enumerate(stress_pts):
        if val >= 75:
            if high_run_start is None:
                high_run_start = ts_ms
                high_peak = val
            else:
                high_peak = max(high_peak, val)
            prev_close = i > 0 and stress_pts[i - 1][1] >= 70 and (ts_ms - stress_pts[i - 1][0]) <= 6 * 60 * 1000
            if (ts_ms - high_run_start) >= 3 * 60 * 1000 or (val >= 85 and prev_close):
                detected_stress_spike = (ts_ms, high_peak, f"Unprovoked Stress surge ({high_peak}/100) outside workout")
        else:
            high_run_start = None
            high_peak = 0

    detected_hr_spike: Optional[Tuple[int, int, int, str]] = None
    for ts_ms, bpm in hr_pts:
        if ts_ms < cutoff_ms or bpm < 105:
            continue
        base_vals = [b for t, b in hr_pts if (ts_ms - 35 * 60 * 1000) <= t <= (ts_ms - 5 * 60 * 1000)]
        if len(base_vals) >= 3:
            med_base = int(round(statistics.median(base_vals)))
            if (bpm - med_base) >= 30:
                detected_hr_spike = (
                    ts_ms,
                    bpm,
                    med_base,
                    f"Abrupt HR jump ({bpm} bpm vs {med_base} bpm baseline) outside workout",
                )

    best_ts: Optional[int] = None
    reason_parts: List[str] = []
    peak_stress = None
    peak_hr = None
    baseline_hr = None

    if detected_stress_spike:
        best_ts = detected_stress_spike[0]
        peak_stress = detected_stress_spike[1]
        reason_parts.append(detected_stress_spike[2])
    if detected_hr_spike:
        hr_ts, peak_hr, baseline_hr, hr_reason = detected_hr_spike
        if best_ts is None or hr_ts > best_ts:
            best_ts = hr_ts
        reason_parts.append(hr_reason)

    if best_ts is None:
        return None
    if dismissed_before_ms is not None and best_ts <= dismissed_before_ms:
        return None

    return {
        "detected": True,
        "spike_ts_ms": best_ts,
        "spike_time": _ms_to_uk_iso(best_ts),
        "peak_stress": peak_stress,
        "peak_hr": peak_hr,
        "baseline_hr": baseline_hr,
        "reason": " • ".join(reason_parts),
    }


def _downsample_window(points: List[List[int]], onset_ms: int, max_points: int = 45) -> List[Dict[str, Any]]:
    if not points:
        return []
    step = max(1, math.ceil(len(points) / max_points))
    sampled = [points[i] for i in range(0, len(points), step)]
    if points[-1] != sampled[-1]:
        sampled.append(points[-1])
    out: List[Dict[str, Any]] = []
    for ts_ms, val in sampled[:max_points]:
        out.append({
            "t": _ms_to_uk_iso(ts_ms),
            "offset_m": int(round((ts_ms - onset_ms) / 60000.0)),
            "v": int(val),
        })
    return out


def build_episode_biometric_snapshot(
    onset_iso: str,
    intraday_by_date: Dict[str, Dict[str, Any]],
    bio_by_date: Dict[str, Dict[str, Any]],
    illness_active: bool = False,
    now_ms: Optional[int] = None,
) -> Tuple[Dict[str, Any], str]:
    """Build +/-60m Garmin Stress/HR + prior-night HRV snapshot across date boundaries."""
    onset_dt = time_utils.parse_uk_ts(onset_iso) or uk_now()
    onset_ms = int(round(onset_dt.timestamp() * 1000.0))
    ref_now = now_ms if now_ms is not None else int(round(uk_now().timestamp() * 1000.0))
    win_start = onset_ms - 60 * 60 * 1000
    win_end = onset_ms + 60 * 60 * 1000
    d_str = onset_dt.date().isoformat()

    raw_stress: List[List[int]] = []
    raw_hr: List[List[int]] = []
    for entry in (intraday_by_date or {}).values():
        if not isinstance(entry, dict):
            continue
        raw_stress.extend(entry.get("stress_samples") or [])
        raw_hr.extend(entry.get("hr_samples") or [])

    stress_win = [p for p in _filter_valid_stress(raw_stress) if win_start <= p[0] <= win_end]
    hr_win = [p for p in _filter_valid_hr(raw_hr) if win_start <= p[0] <= win_end]

    pre_stress = [p[1] for p in stress_win if p[0] < onset_ms]
    post_stress = [p for p in stress_win if p[0] >= onset_ms]
    pre_hr = [p[1] for p in hr_win if p[0] < onset_ms]
    post_hr = [p for p in hr_win if p[0] >= onset_ms]

    day_bio = (bio_by_date or {}).get(d_str) or {}
    prior_hrv = day_bio.get("hrv_last_night")
    prior_sleep_stress = day_bio.get("sleep_avg_stress")
    resting_hr = day_bio.get("resting_hr")
    body_battery = day_bio.get("body_battery")

    post_max_ts = max([p[0] for p in post_stress] + [p[0] for p in post_hr], default=0)
    has_post_coverage = (
        ref_now >= win_end
        and (len(post_stress) >= 5 or len(post_hr) >= 5)
        and post_max_ts >= (onset_ms + 45 * 60 * 1000)
    )
    if has_post_coverage:
        status = "complete"
    elif len(stress_win) > 0 or len(hr_win) > 0:
        status = "partial"
    else:
        status = "pending"

    snapshot = {
        "window_minutes": 60,
        "onset_time": onset_dt.isoformat(),
        "prior_night_hrv": round(float(prior_hrv), 1) if prior_hrv is not None else None,
        "prior_night_sleep_stress": round(float(prior_sleep_stress), 1) if prior_sleep_stress is not None else None,
        "resting_hr": int(resting_hr) if resting_hr is not None else None,
        "body_battery": int(body_battery) if body_battery is not None else None,
        "illness_active": bool(illness_active),
        "stress": {
            "sample_count": len(stress_win),
            "pre_avg": round(sum(pre_stress) / len(pre_stress), 1) if pre_stress else None,
            "peak": max([p[1] for p in stress_win], default=None),
            "post_avg": round(sum(p[1] for p in post_stress) / len(post_stress), 1) if post_stress else None,
            "series": _downsample_window(stress_win, onset_ms, 45),
        },
        "hr": {
            "sample_count": len(hr_win),
            "pre_avg": round(sum(pre_hr) / len(pre_hr), 1) if pre_hr else None,
            "peak": max([p[1] for p in hr_win], default=None),
            "min": min([p[1] for p in hr_win], default=None),
            "post_avg": round(sum(p[1] for p in post_hr) / len(post_hr), 1) if post_hr else None,
            "series": _downsample_window(hr_win, onset_ms, 45),
        },
    }
    return snapshot, status


def check_biometric_recovery(acute_end_iso: Optional[str], intraday_by_date: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """Return UK ISO timestamp once Garmin stress stays <= 25 for >= 15 consecutive minutes after acute peak."""
    if not acute_end_iso:
        return None
    end_dt = time_utils.parse_uk_ts(acute_end_iso)
    if end_dt is None:
        return None
    end_ms = int(round(end_dt.timestamp() * 1000.0))

    raw_stress: List[List[int]] = []
    for entry in (intraday_by_date or {}).values():
        if isinstance(entry, dict):
            raw_stress.extend(entry.get("stress_samples") or [])
    pts = [p for p in _filter_valid_stress(raw_stress) if p[0] >= end_ms]

    calm_start_ms: Optional[int] = None
    last_calm_ms: Optional[int] = None
    calm_count = 0
    for ts_ms, val in pts:
        if val <= 25:
            if calm_start_ms is None or (last_calm_ms is not None and (ts_ms - last_calm_ms) > 10 * 60 * 1000):
                calm_start_ms = ts_ms
                calm_count = 1
            else:
                calm_count += 1
            last_calm_ms = ts_ms
            if (ts_ms - calm_start_ms) >= 15 * 60 * 1000 and calm_count >= 4:
                return _ms_to_uk_iso(ts_ms)
        else:
            calm_start_ms = None
            last_calm_ms = None
            calm_count = 0
    return None


def _episode_dates_needed(episodes: List[Dict[str, Any]]) -> List[str]:
    needed: Set[str] = set()
    for ep in episodes:
        onset_dt = time_utils.parse_uk_ts(ep.get("onset_time"))
        if not onset_dt:
            continue
        for delta in (-1, 0, 1):
            needed.add((onset_dt.date() + timedelta(days=delta)).isoformat())
    return sorted(needed)


def _compute_duration_mins(start_iso: Optional[str], end_iso: Optional[str]) -> Optional[int]:
    if not start_iso or not end_iso:
        return None
    s_dt = time_utils.parse_uk_ts(start_iso)
    e_dt = time_utils.parse_uk_ts(end_iso)
    if s_dt is None or e_dt is None:
        return None
    diff_m = int(round((e_dt - s_dt).total_seconds() / 60.0))
    return max(0, diff_m)


def backfill_episode_snapshots(live_state: Optional[Dict[str, Any]] = None) -> int:
    """Attach missing/partial +/-60m snapshots and auto-complete hybrid recovery when Garmin confirms stress <=25."""
    episodes = db.get_paroxysmal_episodes(days=14)
    cutoff_dt = uk_now() - timedelta(hours=96)
    candidates = []
    for ep in episodes:
        ep_dt = time_utils.parse_uk_ts(ep.get("onset_time"))
        if ep_dt and ep_dt >= cutoff_dt and (
            ep.get("biometric_snapshot_status") != "complete" or ep.get("state") == "POST_EPISODE_RECOVERY"
        ):
            candidates.append(ep)
    if not candidates:
        return 0

    date_strs = _episode_dates_needed(candidates)
    intraday_by_date = db.get_garmin_intraday_range(date_strs)
    bio_by_date = {r["date_str"]: r for r in db.get_daily_biometrics(days=30)}
    now_ms = int(round(uk_now().timestamp() * 1000.0))
    updated_count = 0

    for ep in candidates:
        fields: Dict[str, Any] = {}
        snap, snap_status = build_episode_biometric_snapshot(
            ep["onset_time"],
            intraday_by_date,
            bio_by_date,
            illness_active=bool(ep.get("illness_active")),
            now_ms=now_ms,
        )
        if snap_status != ep.get("biometric_snapshot_status") or snap != ep.get("biometric_snapshot"):
            fields["biometric_snapshot"] = snap
            fields["biometric_snapshot_status"] = snap_status

        if ep.get("state") == "POST_EPISODE_RECOVERY":
            bio_rec_at = ep.get("biometric_recovered_at") or check_biometric_recovery(
                ep.get("acute_peak_end_time") or ep.get("onset_time"),
                intraday_by_date,
            )
            if bio_rec_at and not ep.get("biometric_recovered_at"):
                fields["biometric_recovered_at"] = bio_rec_at
            user_rec_at = ep.get("user_recovered_at")
            if user_rec_at and bio_rec_at:
                u_dt = time_utils.parse_uk_ts(user_rec_at)
                b_dt = time_utils.parse_uk_ts(bio_rec_at)
                full_dt = max(u_dt, b_dt) if (u_dt and b_dt) else (u_dt or b_dt)
                if full_dt:
                    fields["full_recovery_time"] = full_dt.isoformat()
                    fields["total_recovery_duration_mins"] = _compute_duration_mins(ep["onset_time"], full_dt.isoformat())
                    fields["state"] = "RESOLVED"

        if fields:
            db.update_paroxysmal_episode(ep["id"], fields)
            updated_count += 1
    return updated_count


def derive_pathway_tags(
    symptoms: Iterable[str],
    triggers: Iterable[str],
    illness_active: bool = False,
    level1_active: bool = False,
    level2_active: bool = False,
) -> List[str]:
    """Non-diagnostic multi-pathway structural tagging for clinician review."""
    s_set = set(symptoms or [])
    t_set = set(triggers or [])
    tags: List[str] = []

    if (
        illness_active
        or level1_active
        or level2_active
        or "illness_infection" in t_set
        or "poor_sleep" in t_set
    ):
        tags.append("autonomic_dysregulation")

    if s_set.intersection({"dissociation", "impending_doom", "visual_changes", "confusion_brain_fog", "blackout"}):
        tags.append("paroxysmal_focal_neuro")

    if (
        s_set.intersection({"dizziness_vertigo", "lightheaded_presyncope", "blackout"})
        or t_set.intersection({"standing_quickly", "post_exercise", "dehydration_heat"})
    ):
        tags.append("perfusion_orthostatic")

    if (
        illness_active
        or t_set.intersection({"fasted_state", "post_exercise", "poor_sleep", "high_workload", "illness_infection", "caffeine_stimulant"})
    ):
        tags.append("metabolic_fuel_load")

    return tags


def compute_illness_status(target_date_str: Optional[str] = None) -> Dict[str, Any]:
    """Evaluate active illness, contiguous streak, Adaptive TDEE exclusions, Day-1 ramp & 48h Scale Shield."""
    now_dt = uk_now()
    today_date = datetime.strptime(target_date_str[:10], "%Y-%m-%d").date() if target_date_str else now_dt.date()
    today_str = today_date.isoformat()
    logs = db.get_illness_logs(days=90)
    by_date: Dict[str, Dict[str, Any]] = {r["date_str"]: r for r in logs if r.get("status") in ("active", "recovering")}

    today_log = by_date.get(today_str)
    active_today = bool(today_log is not None)

    streak = 0
    cursor = today_date if active_today else (today_date - timedelta(days=1))
    while cursor.isoformat() in by_date:
        streak += 1
        cursor -= timedelta(days=1)

    past_dates = sorted(d for d in by_date.keys() if d <= today_str)
    last_illness_date: Optional[str] = past_dates[-1] if past_dates else None
    days_since_ended: Optional[int] = None
    post_illness_ramp_active = False
    shield_active = False
    shield_hours_remaining = 0

    if not active_today and last_illness_date:
        last_d = datetime.strptime(last_illness_date, "%Y-%m-%d").date()
        days_since_ended = (today_date - last_d).days
        if days_since_ended == 1:
            post_illness_ramp_active = True
        if 1 <= days_since_ended <= 2:
            # 48h shield starting from 00:00 of day after last illness day
            shield_expires_dt = datetime.combine(last_d + timedelta(days=3), dt_time.min, tzinfo=UK_TZ)
            rem_secs = int((shield_expires_dt - now_dt).total_seconds())
            if rem_secs > 0:
                shield_active = True
                shield_hours_remaining = max(1, int(math.ceil(rem_secs / 3600.0)))

    # Exclude active illness dates AND +1 rebound day after each illness date from 14d TDEE regression
    excluded_tdee_dates: Set[str] = set()
    for d_str in by_date.keys():
        excluded_tdee_dates.add(d_str)
        try:
            d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
            excluded_tdee_dates.add((d_obj + timedelta(days=1)).isoformat())
        except Exception:
            pass

    shield_note = ""
    if shield_active:
        shield_note = (
            f"Illness recovery inflammation & extra cravings cause transient water/glycogen retention "
            f"(~{shield_hours_remaining}h shield remaining) — Adaptive TDEE excludes sick days automatically."
        )

    return {
        "active_today": active_today,
        "today_log": today_log,
        "current_streak_days": streak,
        "last_illness_date": last_illness_date,
        "days_since_illness_ended": days_since_ended,
        "post_illness_ramp_active": post_illness_ramp_active,
        "recovery_scale_shield": {
            "active": shield_active,
            "hours_remaining": shield_hours_remaining,
            "claim_mode": "illness_recovery",
            "note": shield_note,
        },
        "excluded_tdee_dates": sorted(excluded_tdee_dates),
        "recent_logs": logs[:30],
    }


def _stats_for_ints(vals: List[int]) -> Dict[str, Any]:
    if not vals:
        return {"count": 0, "avg": None, "median": None, "min": None, "max": None}
    return {
        "count": len(vals),
        "avg": round(sum(vals) / len(vals), 1),
        "median": round(float(statistics.median(vals)), 1),
        "min": min(vals),
        "max": max(vals),
    }


def compute_episode_patterns(
    episodes: List[Dict[str, Any]],
    bio_history: List[Dict[str, Any]],
    illness_status: Dict[str, Any],
    level1: Dict[str, Any],
    level2: Dict[str, Any],
    acute_spike: Optional[Dict[str, Any]],
    today_sleep_score: Optional[int] = None,
    target_date_str: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute duration stats, top symptoms/triggers, pre-episode biometrics, and Prodromal Risk Trajectory."""
    t_str = target_date_str or uk_now().date().isoformat()
    t_date = datetime.strptime(t_str[:10], "%Y-%m-%d").date()
    cut_7d = (t_date - timedelta(days=6)).isoformat()
    cut_30d = (t_date - timedelta(days=29)).isoformat()

    cnt_7d = 0
    cnt_30d = 0
    acute_durs: List[int] = []
    recovery_durs: List[int] = []
    symptom_counts: Dict[str, int] = {}
    trigger_counts: Dict[str, int] = {}
    pathway_counts: Dict[str, int] = {}
    tod_buckets = {
        "Morning (05-11)": 0,
        "Midday (11-15)": 0,
        "Afternoon (15-19)": 0,
        "Evening (19-23)": 0,
        "Night (23-05)": 0,
    }
    illness_linked_count = 0
    ep_dates: Set[str] = set()
    recent_48h_ep = False

    for ep in episodes or []:
        d_str = str(ep.get("date_str") or "")[:10]
        if d_str:
            ep_dates.add(d_str)
            if d_str >= cut_7d:
                cnt_7d += 1
            if d_str >= cut_30d:
                cnt_30d += 1
            try:
                if 0 <= (t_date - datetime.strptime(d_str, "%Y-%m-%d").date()).days <= 2:
                    recent_48h_ep = True
            except Exception:
                pass

        if ep.get("acute_duration_mins") is not None:
            acute_durs.append(int(ep["acute_duration_mins"]))
        if ep.get("total_recovery_duration_mins") is not None:
            recovery_durs.append(int(ep["total_recovery_duration_mins"]))

        for sym in ep.get("symptoms") or []:
            symptom_counts[sym] = symptom_counts.get(sym, 0) + 1
        ep_triggers = set(ep.get("triggers") or [])
        if ep.get("illness_active") or "illness_infection" in ep_triggers:
            illness_linked_count += 1
        for trig in ep_triggers:
            trigger_counts[trig] = trigger_counts.get(trig, 0) + 1
        for ptag in ep.get("pathway_tags") or []:
            pathway_counts[ptag] = pathway_counts.get(ptag, 0) + 1

        onset_dt = time_utils.parse_uk_ts(ep.get("onset_time"))
        if onset_dt:
            hr = onset_dt.hour
            if 5 <= hr < 11:
                tod_buckets["Morning (05-11)"] += 1
            elif 11 <= hr < 15:
                tod_buckets["Midday (11-15)"] += 1
            elif 15 <= hr < 19:
                tod_buckets["Afternoon (15-19)"] += 1
            elif 19 <= hr < 23:
                tod_buckets["Evening (19-23)"] += 1
            else:
                tod_buckets["Night (23-05)"] += 1

    total_eps = len(episodes or [])

    def _top_list(counts: Dict[str, int], label_map: Dict[str, str]) -> List[Dict[str, Any]]:
        ranked = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
        return [
            {
                "key": k,
                "label": label_map.get(k, k.replace("_", " ").title()),
                "count": c,
                "pct": round((c / total_eps) * 100.0, 1) if total_eps > 0 else 0.0,
            }
            for k, c in ranked
        ]

    # Compare prior-night biometrics on episode days vs non-episode days
    ep_hrv, non_hrv = [], []
    ep_sleep_stress, non_sleep_stress = [], []
    ep_rhr, non_rhr = [], []
    for row in bio_history or []:
        d_s = str(row.get("date_str") or "")[:10]
        is_ep_day = d_s in ep_dates
        if row.get("hrv_last_night") is not None:
            (ep_hrv if is_ep_day else non_hrv).append(float(row["hrv_last_night"]))
        if row.get("sleep_avg_stress") is not None:
            (ep_sleep_stress if is_ep_day else non_sleep_stress).append(float(row["sleep_avg_stress"]))
        if row.get("resting_hr") is not None:
            (ep_rhr if is_ep_day else non_rhr).append(float(row["resting_hr"]))

    def _avg_opt(arr: List[float]) -> Optional[float]:
        return round(sum(arr) / len(arr), 1) if arr else None

    # Prodromal Risk Trajectory (algorithmic warning heuristic, non-diagnostic)
    risk_score = 0
    drivers: List[str] = []

    if level2.get("active"):
        risk_score += 35
        drivers.append(
            f"Daytime sympathetic stress pinned >25 for {level2.get('max_streak_mins', 0)}m without recovery dips (+35)"
        )
    elif int(level2.get("current_streak_mins") or 0) >= 120:
        risk_score += 12
        drivers.append(
            f"Building daytime stress streak ({level2.get('current_streak_mins')}m >25 without rest dip) (+12)"
        )

    if level1.get("active"):
        risk_score += 25
        reasons = []
        if "overnight_sleep_stress_elevated" in (level1.get("triggers") or []):
            reasons.append(f"sleeping stress avg {level1.get('sleep_avg_stress')}")
        if "overnight_hrv_below_baseline" in (level1.get("triggers") or []):
            reasons.append(f"HRV {level1.get('hrv_last_night')}ms below 7d baseline {level1.get('hrv_7d_baseline')}ms")
        drivers.append(f"Overnight autonomic baseline strained ({', '.join(reasons) or 'Level 1 alert'}) (+25)")

    illness_recent = bool(
        illness_status.get("active_today")
        or (illness_status.get("days_since_illness_ended") is not None and illness_status["days_since_illness_ended"] <= 2)
    )
    if illness_status.get("active_today"):
        risk_score += 20
        drivers.append("Active intercurrent illness / systemic immune stress lowers autonomic threshold (+20)")
    elif illness_recent:
        risk_score += 10
        drivers.append("Recent post-illness recovery window (<48h since sick days ended) (+10)")

    if recent_48h_ep:
        risk_score += 15
        drivers.append("Episode logged within past 48h (short-term vulnerability cluster window) (+15)")

    if acute_spike and acute_spike.get("detected"):
        risk_score += 15
        drivers.append(f"Recent unprovoked Garmin spike: {acute_spike.get('reason')} (+15)")
    elif today_sleep_score is not None and today_sleep_score < 65:
        risk_score += 10
        drivers.append(f"Short/poor sleep recovery (score {today_sleep_score}) (+10)")

    risk_score = max(0, min(100, risk_score))
    if risk_score >= 50:
        risk_level = "high"
        risk_label = "High Prodromal Load — Take Safety Precautions"
    elif risk_score >= 25:
        risk_level = "elevated"
        risk_label = "Elevated Autonomic Strain — Pace & Monitor"
    else:
        risk_level = "low"
        risk_label = "Low / Calm Autonomic Baseline"

    return {
        "total_episodes": total_eps,
        "count_7d": cnt_7d,
        "count_30d": cnt_30d,
        "acute_duration_stats": _stats_for_ints(acute_durs),
        "total_recovery_stats": _stats_for_ints(recovery_durs),
        "top_symptoms": _top_list(symptom_counts, SYMPTOM_LABELS),
        "top_triggers": _top_list(trigger_counts, TRIGGER_LABELS),
        "illness_co_occurrence_pct": round((illness_linked_count / total_eps) * 100.0, 1) if total_eps > 0 else 0.0,
        "time_of_day": [{"bucket": k, "count": v} for k, v in tod_buckets.items()],
        "pathway_counts": _top_list(pathway_counts, {k: v["label"] for k, v in DIFFERENTIAL_PATHWAYS.items()}),
        "prodrome_comparison": {
            "episode_days_avg_hrv": _avg_opt(ep_hrv),
            "baseline_days_avg_hrv": _avg_opt(non_hrv),
            "episode_days_avg_sleep_stress": _avg_opt(ep_sleep_stress),
            "baseline_days_avg_sleep_stress": _avg_opt(non_sleep_stress),
            "episode_days_avg_rhr": _avg_opt(ep_rhr),
            "baseline_days_avg_rhr": _avg_opt(non_rhr),
        },
        "prodromal_risk": {
            "score": risk_score,
            "level": risk_level,
            "label": risk_label,
            "drivers": drivers,
        },
    }


def _get_spike_dismissed_ms() -> Optional[int]:
    try:
        raw = db.get_kv("autonomic_spike_dismissed_ms")
        if raw:
            val = int(float(raw))
            return val if val > 0 else None
    except Exception:
        pass
    return None


def dismiss_spike_until(spike_ts_ms: Optional[int] = None) -> int:
    ts_val = int(spike_ts_ms) if spike_ts_ms and spike_ts_ms > 0 else int(round(uk_now().timestamp() * 1000.0))
    db.set_kv("autonomic_spike_dismissed_ms", str(ts_val))
    return ts_val


def _get_caution_dismissed_date() -> Optional[str]:
    try:
        raw = db.get_kv("autonomic_caution_dismissed_date")
        if raw:
            s = str(raw).strip()[:10]
            return s if len(s) == 10 else None
    except Exception:
        pass
    return None


def dismiss_caution_today(date_str: Optional[str] = None) -> str:
    d_str = str(date_str or uk_now().date().isoformat()).strip()[:10]
    if len(d_str) != 10:
        d_str = uk_now().date().isoformat()
    db.set_kv("autonomic_caution_dismissed_date", d_str)
    return d_str


def build_autonomic_summary(live_state: Optional[Dict[str, Any]] = None, target_date_str: Optional[str] = None) -> Dict[str, Any]:
    """Assemble full non-diagnostic autonomic monitoring state, illness mode, patterns & safety banner."""
    now_dt = uk_now()
    t_str = target_date_str or now_dt.date().isoformat()
    t_date = datetime.strptime(t_str[:10], "%Y-%m-%d").date()
    yest_str = (t_date - timedelta(days=1)).isoformat()
    now_ms = int(round(now_dt.timestamp() * 1000.0))

    bio_hist = db.get_daily_biometrics(days=30)
    bio_by_date = {r["date_str"]: r for r in bio_hist}
    today_bio = bio_by_date.get(t_str)
    intraday_map = db.get_garmin_intraday_range([yest_str, t_str])
    intraday_today = intraday_map.get(t_str)
    intraday_yest = intraday_map.get(yest_str)

    workout_intervals = extract_workout_intervals(live_state, t_str)
    level1 = evaluate_level1_baseline(today_bio, bio_hist, intraday_today, intraday_yest, target_date_str=t_str)
    level2 = evaluate_level2_sympathetic_load(
        intraday_today,
        (today_bio or {}).get("sleep_end_ts"),
        workout_intervals,
        target_date_str=t_str,
    )

    episodes = db.get_paroxysmal_episodes(days=365)
    active_episode: Optional[Dict[str, Any]] = None
    for ep in episodes:
        if ep.get("state") in ("ACUTE_EPISODE", "POST_EPISODE_RECOVERY"):
            active_episode = ep
            break

    dismissed_ms = _get_spike_dismissed_ms()
    acute_spike = None
    if not active_episode or active_episode.get("state") != "ACUTE_EPISODE":
        acute_spike = detect_acute_episode_spikes(
            intraday_today,
            workout_intervals,
            now_ms=now_ms,
            dismissed_before_ms=dismissed_ms,
        )

    illness = compute_illness_status(t_str)
    today_sleep_score = (today_bio or {}).get("sleep_score")
    if today_sleep_score is None and live_state and isinstance(live_state.get("garmin"), dict):
        today_sleep_score = live_state["garmin"].get("sleep_score")

    patterns = compute_episode_patterns(
        episodes=episodes,
        bio_history=bio_hist,
        illness_status=illness,
        level1=level1,
        level2=level2,
        acute_spike=acute_spike,
        today_sleep_score=today_sleep_score,
        target_date_str=t_str,
    )

    # Determine proportional 3-tier alerting & state machine state
    caution_dismissed_date = _get_caution_dismissed_date()
    caution_dismissed_today = bool(caution_dismissed_date == t_str[:10])
    sleep_elevated = "overnight_sleep_stress_elevated" in level1["triggers"]
    hrv_sig_drop = "overnight_hrv_below_baseline" in level1["triggers"]
    post_illness_ramp = bool(illness.get("post_illness_ramp_active"))

    if active_episode and active_episode.get("state") in ("ACUTE_EPISODE", "POST_EPISODE_RECOVERY"):
        banner_tier = "active_safety"
    elif level2["active"] or sleep_elevated or (hrv_sig_drop and not post_illness_ramp):
        banner_tier = "caution"
    elif level1.get("hrv_mild_dip") or (hrv_sig_drop and post_illness_ramp):
        banner_tier = "watch"
    else:
        banner_tier = "none"

    if banner_tier == "active_safety":
        system_state = active_episode["state"]
        alert_level = 2 if system_state == "ACUTE_EPISODE" else 1
    elif banner_tier == "caution":
        system_state = "VULNERABILITY_ALERT"
        alert_level = 2 if level2["active"] else 1
    else:
        system_state = "IDLE"
        alert_level = 0

    reasons: List[str] = []
    if system_state == "ACUTE_EPISODE":
        reasons.append("Acute paroxysmal episode currently active")
    elif system_state == "POST_EPISODE_RECOVERY":
        reasons.append("Post-episode autonomic recovery in progress")
    if level2["active"]:
        reasons.append(f"Daytime stress >25 for {level2['max_streak_mins']}m (4h+ sympathetic load)")
    if banner_tier in ("caution", "watch"):
        if sleep_elevated:
            reasons.append(f"Overnight sleeping stress avg {level1['sleep_avg_stress']} (above 0-25 rest zone)")
        if hrv_sig_drop:
            reasons.append(f"Overnight HRV {level1['hrv_last_night']}ms significantly below 7d baseline ({level1['hrv_7d_baseline']}ms)")
        elif banner_tier == "watch" and level1.get("hrv_last_night") is not None and level1.get("hrv_7d_baseline") is not None:
            reasons.append(f"Overnight HRV {level1['hrv_last_night']}ms slightly below 7d baseline ({level1['hrv_7d_baseline']}ms)")
        elif banner_tier == "watch" and level1.get("hrv_mild_dip"):
            reasons.append("Overnight HRV slightly below recent baseline (Garmin Watch)")

    show_on_today = bool(
        banner_tier == "active_safety" or (banner_tier == "caution" and not caution_dismissed_today)
    )
    avoid_driving = bool(banner_tier == "active_safety")
    avoid_solo_exertion = bool(banner_tier == "active_safety")

    if system_state == "ACUTE_EPISODE":
        banner_title = "ACTIVE EPISODE TRACKING"
        banner_advisory = DRIVING_SAFETY_ADVISORY
        banner_tone = "red"
    elif system_state == "POST_EPISODE_RECOVERY":
        banner_title = "POST-EPISODE RECOVERY"
        banner_advisory = DRIVING_SAFETY_ADVISORY
        banner_tone = "amber"
    elif banner_tier == "caution":
        banner_title = "AUTONOMIC CAUTION — Sustained Daytime Load" if level2["active"] else "AUTONOMIC CAUTION — Strained Recovery Baseline"
        banner_advisory = CAUTION_CHECKIN_ADVISORY
        banner_tone = "amber"
    elif banner_tier == "watch":
        banner_title = "HRV Watch — Mild Overnight Dip"
        banner_advisory = WATCH_POST_ILLNESS_ADVISORY if (post_illness_ramp or illness.get("active_today")) else WATCH_INFO_ADVISORY
        banner_tone = "amber"
    else:
        banner_title = "Autonomic Baseline Calm"
        banner_advisory = "Autonomic metrics within normal baseline."
        banner_tone = "calm"

    safety_banner = {
        "active": show_on_today,
        "tier": banner_tier,
        "show_on_today": show_on_today,
        "dismissible": banner_tier == "caution",
        "dismissed_today": bool(banner_tier == "caution" and caution_dismissed_today),
        "level": alert_level,
        "tone": banner_tone,
        "title": banner_title,
        "reasons": reasons,
        "advisory": banner_advisory,
        "avoid_driving": avoid_driving,
        "avoid_solo_exertion": avoid_solo_exertion,
    }

    return {
        "evaluated_at": now_dt.isoformat(),
        "date_str": t_str,
        "system_state": system_state,
        "alert_level": alert_level,
        "safety_banner": safety_banner,
        "level1": level1,
        "level2": level2,
        "acute_spike": acute_spike,
        "active_episode": active_episode,
        "illness": illness,
        "patterns": patterns,
        "recent_episodes": episodes[:25],
        "differential_pathways": list(DIFFERENTIAL_PATHWAYS.values()),
        "symptom_catalog": [{"key": k, "label": v} for k, v in SYMPTOM_LABELS.items()],
        "trigger_catalog": [{"key": k, "label": v} for k, v in TRIGGER_LABELS.items()],
        "illness_symptom_catalog": [{"key": k, "label": v} for k, v in ILLNESS_SYMPTOM_LABELS.items()],
        "clinical_disclaimer": CLINICAL_DISCLAIMER,
    }


def _sanitize_episode_list(items: Optional[List[str]], allowed: Set[str]) -> List[str]:
    clean: List[str] = []
    seen: Set[str] = set()
    for raw in items or []:
        val = str(raw or "").strip().lower()
        if val in allowed and val not in seen:
            seen.add(val)
            clean.append(val)
    return clean


def create_episode(payload: Dict[str, Any], live_state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Create a new live or backdated episode with idempotency, state transition & +/-60m snapshot."""
    client_event_id = str(payload.get("client_event_id") or "").strip() or None
    if client_event_id:
        existing = db.get_paroxysmal_episode_by_client_event_id(client_event_id)
        if existing is not None:
            return existing
        db.claim_idempotency_key("paroxysmal_episode", client_event_id)

    now_dt = uk_now()
    onset_dt = time_utils.parse_uk_ts(payload.get("onset_time")) or now_dt
    onset_iso = onset_dt.isoformat()
    date_str = onset_dt.date().isoformat()

    acute_end_dt = time_utils.parse_uk_ts(payload.get("acute_peak_end_time"))
    acute_end_iso = acute_end_dt.isoformat() if acute_end_dt and acute_end_dt >= onset_dt else None

    full_rec_dt = time_utils.parse_uk_ts(payload.get("full_recovery_time"))
    full_rec_iso = full_rec_dt.isoformat() if full_rec_dt and full_rec_dt >= onset_dt else None

    user_rec_dt = time_utils.parse_uk_ts(payload.get("user_recovered_at")) or (full_rec_dt if full_rec_iso else None)
    user_rec_iso = user_rec_dt.isoformat() if user_rec_dt else None

    if full_rec_iso:
        state = "RESOLVED"
        if not acute_end_iso:
            acute_end_iso = full_rec_iso
    elif acute_end_iso:
        state = "POST_EPISODE_RECOVERY"
    else:
        state = "ACUTE_EPISODE"

    illness_log = db.get_illness_log(date_str)
    illness_active = bool(payload.get("illness_active")) or (illness_log is not None and illness_log.get("status") in ("active", "recovering"))

    symptoms = _sanitize_episode_list(payload.get("symptoms"), VALID_SYMPTOMS)
    triggers = _sanitize_episode_list(payload.get("triggers"), VALID_TRIGGERS)
    if illness_active and "illness_infection" not in triggers:
        triggers.append("illness_infection")

    bio_hist = db.get_daily_biometrics(days=30)
    bio_by_date = {r["date_str"]: r for r in bio_hist}
    ep_dates = [
        (onset_dt.date() - timedelta(days=1)).isoformat(),
        date_str,
        (onset_dt.date() + timedelta(days=1)).isoformat(),
    ]
    intraday_by_date = db.get_garmin_intraday_range(ep_dates)
    intraday_today = intraday_by_date.get(date_str)
    intraday_yest = intraday_by_date.get((onset_dt.date() - timedelta(days=1)).isoformat())
    today_bio = bio_by_date.get(date_str)
    lvl1 = evaluate_level1_baseline(today_bio, bio_hist, intraday_today, intraday_yest, target_date_str=date_str)
    lvl2 = evaluate_level2_sympathetic_load(
        intraday_today,
        (today_bio or {}).get("sleep_end_ts"),
        extract_workout_intervals(live_state, date_str),
        target_date_str=date_str,
    )
    pathway_tags = derive_pathway_tags(
        symptoms,
        triggers,
        illness_active=illness_active,
        level1_active=lvl1["active"],
        level2_active=lvl2["active"],
    )

    bio_rec_iso = check_biometric_recovery(acute_end_iso, intraday_by_date) if acute_end_iso else None
    if state == "POST_EPISODE_RECOVERY" and user_rec_iso and bio_rec_iso:
        u_dt = time_utils.parse_uk_ts(user_rec_iso)
        b_dt = time_utils.parse_uk_ts(bio_rec_iso)
        full_dt = max(u_dt, b_dt) if (u_dt and b_dt) else (u_dt or b_dt)
        if full_dt:
            full_rec_iso = full_dt.isoformat()
            state = "RESOLVED"

    snap, snap_status = build_episode_biometric_snapshot(
        onset_iso,
        intraday_by_date,
        bio_by_date,
        illness_active=illness_active,
        now_ms=int(round(now_dt.timestamp() * 1000.0)),
    )

    raw_id = str(payload.get("id") or "").strip()
    if raw_id and raw_id.startswith("ep_") and len(raw_id) <= 64 and db.get_paroxysmal_episode(raw_id) is None:
        ep_id = raw_id
    else:
        ep_id = f"ep_{int(now_dt.timestamp())}_{uuid.uuid4().hex[:8]}"

    severity = str(payload.get("severity") or "moderate").strip().lower()
    if severity not in ("mild", "moderate", "severe"):
        severity = "moderate"

    record = {
        "id": ep_id,
        "state": state,
        "onset_time": onset_iso,
        "date_str": date_str,
        "acute_peak_end_time": acute_end_iso,
        "full_recovery_time": full_rec_iso,
        "user_recovered_at": user_rec_iso,
        "biometric_recovered_at": bio_rec_iso,
        "acute_duration_mins": _compute_duration_mins(onset_iso, acute_end_iso),
        "total_recovery_duration_mins": _compute_duration_mins(onset_iso, full_rec_iso),
        "severity": severity,
        "symptoms": symptoms,
        "triggers": triggers,
        "pathway_tags": pathway_tags,
        "illness_active": illness_active,
        "notes": str(payload.get("notes") or "")[:2000],
        "biometric_snapshot": snap,
        "biometric_snapshot_status": snap_status,
        "spike_auto_detected": bool(payload.get("spike_auto_detected")),
        "client_event_id": client_event_id,
    }
    return db.create_paroxysmal_episode(record)


def update_episode(payload: Dict[str, Any], live_state: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Apply lifecycle transition or detail edits on an existing episode (lookup by id or client_event_id)."""
    ep_id = str(payload.get("id") or "").strip()
    ep = db.get_paroxysmal_episode(ep_id) if ep_id else None
    if ep is None and payload.get("client_event_id"):
        ep = db.get_paroxysmal_episode_by_client_event_id(str(payload.get("client_event_id")))
    if ep is None:
        return None

    now_dt = uk_now()
    action = str(payload.get("action") or "edit_details").strip().lower()
    fields: Dict[str, Any] = {}

    onset_iso = ep["onset_time"]
    if payload.get("onset_time"):
        parsed_onset = time_utils.parse_uk_ts(payload.get("onset_time"))
        if parsed_onset:
            onset_iso = parsed_onset.isoformat()
            fields["onset_time"] = onset_iso
            fields["date_str"] = parsed_onset.date().isoformat()

    acute_end_iso = ep.get("acute_peak_end_time")
    user_rec_iso = ep.get("user_recovered_at")
    full_rec_iso = ep.get("full_recovery_time")
    bio_rec_iso = ep.get("biometric_recovered_at")
    state = ep.get("state") or "ACUTE_EPISODE"

    if payload.get("symptoms") is not None:
        fields["symptoms"] = _sanitize_episode_list(payload.get("symptoms"), VALID_SYMPTOMS)
    if payload.get("triggers") is not None:
        fields["triggers"] = _sanitize_episode_list(payload.get("triggers"), VALID_TRIGGERS)
    if payload.get("severity") is not None:
        sev = str(payload.get("severity") or "moderate").strip().lower()
        if sev in ("mild", "moderate", "severe"):
            fields["severity"] = sev
    if payload.get("notes") is not None:
        fields["notes"] = str(payload.get("notes") or "")[:2000]

    ts_override = time_utils.parse_uk_ts(payload.get("timestamp")) or now_dt

    if action == "mark_acute_end":
        end_dt = time_utils.parse_uk_ts(payload.get("acute_peak_end_time")) or ts_override
        acute_end_iso = end_dt.isoformat()
        fields["acute_peak_end_time"] = acute_end_iso
        fields["acute_duration_mins"] = _compute_duration_mins(onset_iso, acute_end_iso)
        if state == "ACUTE_EPISODE":
            state = "POST_EPISODE_RECOVERY"
            fields["state"] = state
    elif action == "mark_user_recovered":
        u_dt = time_utils.parse_uk_ts(payload.get("user_recovered_at")) or ts_override
        user_rec_iso = u_dt.isoformat()
        fields["user_recovered_at"] = user_rec_iso
        if not acute_end_iso:
            acute_end_iso = user_rec_iso
            fields["acute_peak_end_time"] = acute_end_iso
            fields["acute_duration_mins"] = _compute_duration_mins(onset_iso, acute_end_iso)
        state = "POST_EPISODE_RECOVERY"
        fields["state"] = state
    elif action == "confirm_resolved_override":
        res_dt = time_utils.parse_uk_ts(payload.get("full_recovery_time")) or ts_override
        res_iso = res_dt.isoformat()
        if not acute_end_iso:
            acute_end_iso = res_iso
            fields["acute_peak_end_time"] = acute_end_iso
            fields["acute_duration_mins"] = _compute_duration_mins(onset_iso, acute_end_iso)
        if not user_rec_iso:
            fields["user_recovered_at"] = res_iso
        fields["full_recovery_time"] = res_iso
        fields["total_recovery_duration_mins"] = _compute_duration_mins(onset_iso, res_iso)
        state = "RESOLVED"
        fields["state"] = state
    else:
        if payload.get("acute_peak_end_time"):
            ae = time_utils.parse_uk_ts(payload.get("acute_peak_end_time"))
            if ae:
                acute_end_iso = ae.isoformat()
                fields["acute_peak_end_time"] = acute_end_iso
                fields["acute_duration_mins"] = _compute_duration_mins(onset_iso, acute_end_iso)
                if state == "ACUTE_EPISODE":
                    state = "POST_EPISODE_RECOVERY"
                    fields["state"] = state
        if payload.get("full_recovery_time"):
            fr = time_utils.parse_uk_ts(payload.get("full_recovery_time"))
            if fr:
                full_rec_iso = fr.isoformat()
                fields["full_recovery_time"] = full_rec_iso
                fields["user_recovered_at"] = full_rec_iso
                fields["total_recovery_duration_mins"] = _compute_duration_mins(onset_iso, full_rec_iso)
                state = "RESOLVED"
                fields["state"] = state

    onset_dt = time_utils.parse_uk_ts(onset_iso) or now_dt
    d_str = onset_dt.date().isoformat()
    ep_dates = [
        (onset_dt.date() - timedelta(days=1)).isoformat(),
        d_str,
        (onset_dt.date() + timedelta(days=1)).isoformat(),
    ]
    intraday_by_date = db.get_garmin_intraday_range(ep_dates)
    bio_by_date = {r["date_str"]: r for r in db.get_daily_biometrics(days=30)}

    if state == "POST_EPISODE_RECOVERY":
        bio_rec_iso = bio_rec_iso or check_biometric_recovery(acute_end_iso or onset_iso, intraday_by_date)
        if bio_rec_iso:
            fields["biometric_recovered_at"] = bio_rec_iso
        if user_rec_iso and bio_rec_iso:
            u_dt = time_utils.parse_uk_ts(user_rec_iso)
            b_dt = time_utils.parse_uk_ts(bio_rec_iso)
            full_dt = max(u_dt, b_dt) if (u_dt and b_dt) else (u_dt or b_dt)
            if full_dt:
                fields["full_recovery_time"] = full_dt.isoformat()
                fields["total_recovery_duration_mins"] = _compute_duration_mins(onset_iso, full_dt.isoformat())
                fields["state"] = "RESOLVED"

    final_syms = fields.get("symptoms", ep.get("symptoms") or [])
    final_trigs = fields.get("triggers", ep.get("triggers") or [])
    fields["pathway_tags"] = derive_pathway_tags(
        final_syms,
        final_trigs,
        illness_active=bool(ep.get("illness_active")),
    )
    snap, snap_status = build_episode_biometric_snapshot(
        onset_iso,
        intraday_by_date,
        bio_by_date,
        illness_active=bool(ep.get("illness_active")),
        now_ms=int(round(now_dt.timestamp() * 1000.0)),
    )
    fields["biometric_snapshot"] = snap
    fields["biometric_snapshot_status"] = snap_status
    return db.update_paroxysmal_episode(ep["id"], fields)


def _csv_safe(val: Any) -> str:
    if val is None:
        return ""
    s = str(val)
    stripped = s.lstrip()
    if stripped and stripped[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def serialize_episodes_csv(episodes: List[Dict[str, Any]], illness_logs: Optional[List[Dict[str, Any]]] = None) -> str:
    """Serialize clinical episode history with +/-60m Garmin snapshot metrics to RFC-4180 CSV."""
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "episode_id",
        "date_uk",
        "onset_time_uk",
        "acute_peak_end_time_uk",
        "full_recovery_time_uk",
        "state",
        "severity",
        "acute_duration_mins",
        "total_recovery_duration_mins",
        "illness_active",
        "symptoms",
        "triggers",
        "differential_pathways",
        "snapshot_status",
        "prior_night_hrv_ms",
        "prior_night_sleep_stress",
        "resting_hr_bpm",
        "body_battery",
        "pre_60m_stress_avg",
        "peak_stress_window",
        "post_60m_stress_avg",
        "pre_60m_hr_avg",
        "peak_hr_window",
        "post_60m_hr_avg",
        "notes",
    ])
    for ep in episodes or []:
        snap = ep.get("biometric_snapshot") or {}
        st = snap.get("stress") or {}
        hr = snap.get("hr") or {}
        writer.writerow([
            _csv_safe(ep.get("id")),
            _csv_safe(ep.get("date_str")),
            _csv_safe(ep.get("onset_time")),
            _csv_safe(ep.get("acute_peak_end_time")),
            _csv_safe(ep.get("full_recovery_time")),
            _csv_safe(ep.get("state")),
            _csv_safe(ep.get("severity")),
            ep.get("acute_duration_mins") if ep.get("acute_duration_mins") is not None else "",
            ep.get("total_recovery_duration_mins") if ep.get("total_recovery_duration_mins") is not None else "",
            "yes" if ep.get("illness_active") else "no",
            _csv_safe("; ".join(SYMPTOM_LABELS.get(s, s) for s in (ep.get("symptoms") or []))),
            _csv_safe("; ".join(TRIGGER_LABELS.get(t, t) for t in (ep.get("triggers") or []))),
            _csv_safe("; ".join((DIFFERENTIAL_PATHWAYS.get(p) or {}).get("label", p) for p in (ep.get("pathway_tags") or []))),
            _csv_safe(ep.get("biometric_snapshot_status")),
            snap.get("prior_night_hrv") if snap.get("prior_night_hrv") is not None else "",
            snap.get("prior_night_sleep_stress") if snap.get("prior_night_sleep_stress") is not None else "",
            snap.get("resting_hr") if snap.get("resting_hr") is not None else "",
            snap.get("body_battery") if snap.get("body_battery") is not None else "",
            st.get("pre_avg") if st.get("pre_avg") is not None else "",
            st.get("peak") if st.get("peak") is not None else "",
            st.get("post_avg") if st.get("post_avg") is not None else "",
            hr.get("pre_avg") if hr.get("pre_avg") is not None else "",
            hr.get("peak") if hr.get("peak") is not None else "",
            hr.get("post_avg") if hr.get("post_avg") is not None else "",
            _csv_safe(ep.get("notes")),
        ])
    return output.getvalue()
