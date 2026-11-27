import math
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import exercise_biomechanics
import time_utils
from time_utils import UK_TZ


_SKIP_PULSE_PENALTY = -18.0
_MAX_PAIR_CLOCK_DIST_SEC = 900.0


def _coerce_weight_kg(raw_val: Any) -> float:
    if raw_val is None or isinstance(raw_val, bool):
        return 0.0
    if isinstance(raw_val, (int, float)):
        f = float(raw_val)
        return f if math.isfinite(f) and f >= 0 else 0.0
    s = str(raw_val).strip().lower()
    if not s or re.match(r"^(?:body(?:weight)?|bw)$", s):
        return 0.0
    s = re.sub(r"^2\s*[×x]\s*", "", s)
    s = re.sub(r"kg$", "", s).strip()
    try:
        f = float(s)
        return f if math.isfinite(f) and f >= 0 else 0.0
    except ValueError:
        return 0.0


def _garmin_weight_kg(raw_wt: Any) -> float:
    if raw_wt is None or isinstance(raw_wt, bool):
        return 0.0
    try:
        w = float(raw_wt)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(w) or w <= 0:
        return 0.0
    if w >= 1000.0:
        return round((w / 1000.0) * 10.0) / 10.0
    return round(w * 10.0) / 10.0


def _friendly_exercise_name(ex_id: str) -> str:
    meta = exercise_biomechanics.EXERCISE_BIOMECHANICS.get(ex_id)
    if isinstance(meta, dict) and meta.get("name"):
        return str(meta["name"])
    return ex_id.replace("_", " ").strip().title()


def _parse_pulse_log_window_ms(
    time_str: Any,
    base_date_str: str,
    prev_min_ms: int,
) -> Tuple[int, int]:
    if not time_str or not isinstance(time_str, str):
        return 0, 0
    trimmed = time_str.strip()
    hm = re.match(r"^(\d{1,2}):(\d{2})$", trimmed)
    if hm and base_date_str and re.match(r"^\d{4}-\d{2}-\d{2}$", base_date_str):
        try:
            d_obj = datetime.strptime(base_date_str, "%Y-%m-%d").date()
            dt = datetime(d_obj.year, d_obj.month, d_obj.day, int(hm.group(1)), int(hm.group(2)), 0, tzinfo=UK_TZ)
            ms = int(dt.timestamp() * 1000)
            if prev_min_ms > 0 and (prev_min_ms - ms) > 6 * 3600 * 1000:
                ms += 24 * 3600 * 1000
            return ms, ms + 59999
        except Exception:
            return 0, 0
    dt = time_utils.parse_uk_ts(trimmed)
    if dt is not None:
        ms = int(dt.timestamp() * 1000)
        return ms, ms + 59999
    return 0, 0


def _garmin_category_matches_pulse_ex(garmin_label: str, pulse_ex_id: str) -> int:
    g = str(garmin_label or "").lower()
    p = str(pulse_ex_id or "").lower()
    if not g or not p:
        return 0
    patterns = (
        (r"squat|lunge|split_squat|thruster", r"squat|lunge"),
        (r"bench|chest_press|floor_press|push_up|pushup|dip", r"bench|floor_press|pushup|dip|chest"),
        (r"deadlift|rdl|good_morning|hip_hinge|swing", r"rdl|deadlift|swing|hinge"),
        (r"row|pull_up|pullup|chin_up|lat_pull|curl", r"row|pullup|chin|curl"),
        (r"shoulder_press|overhead_press|military_press|z_press", r"press|z_press|ohp"),
    )
    g_hit = -1
    p_hit = -1
    for idx, (g_pat, p_pat) in enumerate(patterns):
        if g_hit == -1 and re.search(g_pat, g):
            g_hit = idx
        if p_hit == -1 and re.search(p_pat, p):
            p_hit = idx
    if g_hit == -1 or p_hit == -1:
        return 0
    return 1 if g_hit == p_hit else -1


def _is_strength_pulse_session(sess: Dict[str, Any]) -> bool:
    if not isinstance(sess, dict):
        return False
    details = sess.get("details")
    if not isinstance(details, dict) or not details:
        return False
    for k, s in details.items():
        if not isinstance(s, dict):
            continue
        if s.get("logged") is False:
            continue
        ex_id = str(s.get("exercise_id") or re.sub(r"_(?:wu)?\d+$", "", str(k or "")) or "")
        if ex_id and not ex_id.startswith("kb_flow_") and not re.match(r"^(?:zone2_flush|speed_rope|emom_|amrap_|for_time_)", ex_id):
            return True
    return False


def collect_candidate_pulse_sessions(
    state: Dict[str, Any],
    db_module: Any = None,
    preloaded_db_sessions: Optional[List[Dict[str, Any]]] = None,
    days: int = 14,
) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    seen_keys = set()

    def _push(sess: Any) -> None:
        if not isinstance(sess, dict) or not sess.get("date"):
            return
        k = str(sess.get("id") or sess.get("client_event_id") or sess.get("date") or "")
        if k and k in seen_keys:
            return
        if k:
            seen_keys.add(k)
        candidates.append(sess)

    for item in (state.get("session_history") or []):
        _push(item)
    if state.get("last_workout_session"):
        _push(state.get("last_workout_session"))

    db_rows = preloaded_db_sessions
    if db_rows is None and db_module is not None:
        try:
            db_rows = db_module.get_workout_sessions(days=days)
        except Exception:
            db_rows = []
    for row in (db_rows or []):
        if isinstance(row, dict):
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else row
            if isinstance(payload, dict) and not payload.get("date") and row.get("timestamp"):
                payload = dict(payload)
                payload["date"] = row["timestamp"]
            _push(payload)
    return candidates


def _select_matching_pulse_session(
    act: Dict[str, Any],
    sessions: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    act_dt = time_utils.parse_uk_ts(act.get("rawDate") or act.get("date"))
    if act_dt is None:
        return None
    act_date_str = act_dt.date().isoformat()
    dur_min = float(act.get("duration_min") or act.get("durationMin") or 0.0)
    act_end_dt = act_dt + timedelta(minutes=max(0.0, dur_min))

    best_sess = None
    best_diff_sec = float("inf")
    for sess in (sessions or []):
        if not _is_strength_pulse_session(sess):
            continue
        sess_dt = time_utils.parse_uk_ts(sess.get("date"))
        if sess_dt is None:
            continue
        if sess_dt.date().isoformat() != act_date_str:
            continue
        diff_sec = abs((act_end_dt - sess_dt).total_seconds())
        if diff_sec <= 7200.0 and diff_sec < best_diff_sec:
            best_diff_sec = diff_sec
            best_sess = sess
    return best_sess


def enrich_garmin_activity_with_pulse_sets(
    act: Dict[str, Any],
    sessions: List[Dict[str, Any]],
) -> bool:
    if not isinstance(act, dict):
        return False
    if act.get("source") in ("manual_app_entry", "garmin_via_mnd_bridge"):
        return False
    raw_sets = act.get("exercise_sets")
    if not isinstance(raw_sets, list) or not raw_sets:
        return False

    matched_sess = _select_matching_pulse_session(act, sessions)
    if not matched_sess:
        return False

    act_dt = time_utils.parse_uk_ts(act.get("rawDate") or act.get("date"))
    cursor_ms = int(act_dt.timestamp() * 1000) if act_dt is not None else 0
    base_date_str = act_dt.date().isoformat() if act_dt is not None else ""

    g_sets: List[Dict[str, Any]] = []
    for raw_idx, s in enumerate(raw_sets):
        if not isinstance(s, dict):
            continue
        s_type = str(s.get("set_type") or s.get("setType") or "").upper()
        try:
            dur_raw = float(s.get("duration") or 0.0)
            if not math.isfinite(dur_raw) or dur_raw < 0:
                dur_raw = 0.0
        except (TypeError, ValueError):
            dur_raw = 0.0

        if s_type == "REST":
            if cursor_ms > 0 and dur_raw > 0:
                cursor_ms += int(round(dur_raw * 1000))
            continue
        if s_type != "ACTIVE":
            continue

        explicit_dt = time_utils.parse_uk_ts(s.get("start_time") or s.get("startTime"))
        start_ms = int(explicit_dt.timestamp() * 1000) if explicit_dt is not None else cursor_ms
        end_ms = (start_ms + int(round(dur_raw * 1000))) if (start_ms > 0 and dur_raw > 0) else start_ms
        if start_ms > 0:
            cursor_ms = end_ms

        raw_reps = s.get("reps") if s.get("reps") is not None else s.get("repetitionCount")
        parsed_reps: Optional[int] = None
        if raw_reps is not None and not isinstance(raw_reps, bool):
            try:
                rf = float(raw_reps)
                if math.isfinite(rf) and rf >= 0:
                    parsed_reps = int(round(rf))
            except (TypeError, ValueError):
                parsed_reps = None

        raw_garmin_name = s.get("garmin_exercise_name")
        if raw_garmin_name is None and not s.get("exercise_id") and s.get("exercise_name"):
            raw_garmin_name = s.get("exercise_name")

        g_sets.append({
            "raw_idx": raw_idx,
            "raw_dict": s,
            "weight_kg": _garmin_weight_kg(s.get("weight")),
            "reps": parsed_reps,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "garmin_name": str(raw_garmin_name or ""),
            "garmin_category": str(s.get("exercise_category") or s.get("category") or ""),
        })

    if not g_sets:
        return False

    details = matched_sess.get("details") or {}
    ex_order: List[str] = []
    sets_by_ex: Dict[str, Dict[str, Any]] = {}
    for k, item in details.items():
        if not isinstance(item, dict) or item.get("logged") is False:
            continue
        k_str = str(k or "")
        ex_id = str(item.get("exercise_id") or re.sub(r"_(?:wu)?\d+$", "", k_str) or "exercise")
        if ex_id not in sets_by_ex:
            sets_by_ex[ex_id] = {
                "ex_id": ex_id,
                "ex_name": _friendly_exercise_name(ex_id),
                "items": [],
            }
            ex_order.append(ex_id)
        wu_m = re.search(r"_wu(\d+)$", k_str)
        is_explicit_wu = bool(item.get("explicit_warmup")) or bool(wu_m)
        num_m = re.search(r"_(\d+)$", k_str)
        if is_explicit_wu:
            wu_num = int(item.get("warmup_num") or (int(wu_m.group(1)) if wu_m else len(sets_by_ex[ex_id]["items"]) + 1))
            set_num = 0
            sort_key = (0, wu_num)
        else:
            set_num = int(item.get("set_num") or (int(num_m.group(1)) if num_m else len(sets_by_ex[ex_id]["items"]) + 1))
            sort_key = (1, set_num)
        sets_by_ex[ex_id]["items"].append({
            "key": k_str,
            "raw": item,
            "set_num": set_num,
            "is_explicit_warmup": is_explicit_wu,
            "sort_key": sort_key,
        })

    pulse_sets: List[Dict[str, Any]] = []
    prev_min_ms = 0
    for ex_id in ex_order:
        grp = sets_by_ex[ex_id]
        grp["items"].sort(key=lambda x: x["sort_key"])
        for item in grp["items"]:
            raw_p = item["raw"]
            win_start, win_end = _parse_pulse_log_window_ms(raw_p.get("time"), base_date_str, prev_min_ms)
            if win_start > 0:
                prev_min_ms = win_start
            w_kg = _coerce_weight_kg(raw_p.get("weight"))
            try:
                reps_val = int(round(float(raw_p.get("reps") or 0)))
            except (TypeError, ValueError):
                reps_val = 0
            pulse_sets.append({
                "idx": len(pulse_sets),
                "key": item["key"],
                "exercise_id": ex_id,
                "exercise_name": grp["ex_name"],
                "set_num": item["set_num"],
                "is_explicit_warmup": item["is_explicit_warmup"],
                "weight_kg": w_kg,
                "reps": reps_val,
                "time_str": str(raw_p.get("time") or ""),
                "log_min_start_ms": win_start,
                "log_min_end_ms": win_end,
            })

    if not pulse_sets:
        return False

    def _pair_score(g: Dict[str, Any], p: Dict[str, Any]) -> float:
        score = 0.0
        if g["end_ms"] > 0 and p["log_min_start_ms"] > 0:
            dist_ms = 0
            if g["end_ms"] < p["log_min_start_ms"]:
                dist_ms = p["log_min_start_ms"] - g["end_ms"]
            elif g["end_ms"] > p["log_min_end_ms"]:
                dist_ms = g["end_ms"] - p["log_min_end_ms"]
            dist_sec = dist_ms / 1000.0
            if dist_sec > _MAX_PAIR_CLOCK_DIST_SEC:
                return float("-inf")
            if dist_sec <= 15:
                score += 55
            elif dist_sec <= 45:
                score += 48
            elif dist_sec <= 90:
                score += 38
            elif dist_sec <= 180:
                score += 24
            elif dist_sec <= 360:
                score += 10
            else:
                score += -5.0 - (dist_sec - 360.0) / 30.0
            if g["start_ms"] > 0 and p["log_min_end_ms"] < (g["start_ms"] - 30000):
                score -= 6.0
        else:
            score += 20.0

        gw = g["weight_kg"]
        pw = p["weight_kg"]
        if gw == 0.0 and pw == 0.0:
            score += 30.0
        elif gw > 0.0 and pw > 0.0:
            diff = abs(gw - pw)
            ratio = min(gw, pw) / max(gw, pw)
            if diff <= 0.5:
                score += 40.0
            elif diff <= 2.5:
                score += 26.0
            elif ratio >= 0.85:
                score += 14.0
            elif ratio >= 0.65:
                score += 2.0
            else:
                score -= 28.0
        else:
            score -= 15.0

        if g["reps"] is not None and p["reps"] > 0:
            rep_diff = abs(g["reps"] - p["reps"])
            if rep_diff == 0:
                score += 20.0
            elif rep_diff == 1:
                score += 12.0
            elif rep_diff == 2:
                score += 5.0
            elif rep_diff >= 5:
                score -= 6.0

        cat_hint = _garmin_category_matches_pulse_ex(f"{g['garmin_category']} {g['garmin_name']}", p["exercise_id"])
        if cat_hint > 0:
            score += 12.0
        elif cat_hint < 0:
            score -= 8.0

        return score

    n = len(g_sets)
    m = len(pulse_sets)
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    choice = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        choice[i][0] = 1
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + _SKIP_PULSE_PENALTY
        choice[0][j] = 2

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s_skip_g = dp[i - 1][j]
            s_skip_p = dp[i][j - 1] + _SKIP_PULSE_PENALTY
            ps = _pair_score(g_sets[i - 1], pulse_sets[j - 1])
            s_match = (dp[i - 1][j - 1] + ps) if ps > 0 else float("-inf")
            if s_match >= s_skip_g and s_match >= s_skip_p:
                dp[i][j] = s_match
                choice[i][j] = 3
            elif s_skip_g >= s_skip_p:
                dp[i][j] = s_skip_g
                choice[i][j] = 1
            else:
                dp[i][j] = s_skip_p
                choice[i][j] = 2

    matched_by_g: List[Optional[Dict[str, Any]]] = [None] * n
    i, j = n, m
    while i > 0 or j > 0:
        ch = choice[i][j]
        if i > 0 and j > 0 and ch == 3:
            matched_by_g[i - 1] = pulse_sets[j - 1]
            i -= 1
            j -= 1
        elif i > 0 and (j == 0 or ch == 1):
            i -= 1
        else:
            j -= 1

    group_by_ex: Dict[str, Dict[str, Any]] = {}
    ordered_groups: List[Dict[str, Any]] = []
    for ex_id in ex_order:
        grp = {
            "exercise_id": ex_id,
            "exercise_name": sets_by_ex[ex_id]["ex_name"],
            "warmup_sets": [],
            "working_sets": [],
            "extra_sets": [],
            "first_matched_idx": n + 1,
            "last_matched_idx": -1,
            "working_weight_kg": 0.0,
        }
        group_by_ex[ex_id] = grp
        ordered_groups.append(grp)

    roles = ["unmatched"] * n
    for gi, g in enumerate(g_sets):
        p = matched_by_g[gi]
        if p is not None:
            grp = group_by_ex[p["exercise_id"]]
            if p.get("is_explicit_warmup"):
                roles[gi] = "warmup"
                grp["warmup_sets"].append((gi, g))
            else:
                roles[gi] = "working"
                grp["working_sets"].append((gi, g, p))
                if gi < grp["first_matched_idx"]:
                    grp["first_matched_idx"] = gi
                if gi > grp["last_matched_idx"]:
                    grp["last_matched_idx"] = gi

    for grp in ordered_groups:
        pos_w = sorted(g["weight_kg"] for _, g, _ in grp["working_sets"] if g["weight_kg"] > 0)
        if pos_w:
            grp["working_weight_kg"] = pos_w[len(pos_w) // 2]
        elif grp["working_sets"]:
            grp["working_weight_kg"] = grp["working_sets"][0][2]["weight_kg"]

    for gi, g in enumerate(g_sets):
        if matched_by_g[gi] is not None:
            continue
        enclosing = next(
            (
                grp for grp in ordered_groups
                if grp["working_sets"]
                and grp["first_matched_idx"] < gi < grp["last_matched_idx"]
                and (grp["working_weight_kg"] == 0.0 or abs(g["weight_kg"] - grp["working_weight_kg"]) <= 2.5)
            ),
            None,
        )
        if enclosing is not None:
            roles[gi] = "extra_set"
            enclosing["extra_sets"].append((gi, g))
            continue

        next_candidates = [grp for grp in ordered_groups if grp["working_sets"] and grp["first_matched_idx"] > gi]
        next_candidates.sort(key=lambda x: x["first_matched_idx"])
        if next_candidates:
            next_grp = next_candidates[0]
            has_intervening = any(matched_by_g[k] is not None for k in range(gi + 1, next_grp["first_matched_idx"]))
            wk_kg = next_grp["working_weight_kg"]
            is_lighter = (g["weight_kg"] > 0 and wk_kg > 0 and g["weight_kg"] <= 0.78 * wk_kg) or (g["weight_kg"] == 0 and wk_kg > 0)
            if not has_intervening and is_lighter:
                roles[gi] = "warmup"
                next_grp["warmup_sets"].append((gi, g))

    # Stamp matched exercises directly onto raw_sets dicts
    warmup_owner: Dict[int, Dict[str, Any]] = {}
    extra_owner: Dict[int, Dict[str, Any]] = {}
    for grp in ordered_groups:
        for gi, _ in grp["warmup_sets"]:
            warmup_owner[gi] = grp
        for gi, _ in grp["extra_sets"]:
            extra_owner[gi] = grp

    for gi, g in enumerate(g_sets):
        s = g["raw_dict"]
        if g["garmin_name"] and not s.get("garmin_exercise_name"):
            s["garmin_exercise_name"] = g["garmin_name"]
        role = roles[gi]
        s["role"] = role
        p = matched_by_g[gi]
        if p is not None:
            s["exercise_id"] = p["exercise_id"]
            s["exercise_name"] = p["exercise_name"]
            s["pulse_set_num"] = p["set_num"]
            s["pulse_weight_kg"] = p["weight_kg"]
            s["pulse_reps"] = p["reps"]
            if p["time_str"]:
                s["pulse_time"] = p["time_str"]
            else:
                s.pop("pulse_time", None)
            if g["weight_kg"] > 0 and p["weight_kg"] > 0 and abs(g["weight_kg"] - p["weight_kg"]) > 2.5:
                s["weight_mismatch"] = {"garmin_kg": g["weight_kg"], "pulse_kg": p["weight_kg"]}
            else:
                s.pop("weight_mismatch", None)
        elif gi in warmup_owner or gi in extra_owner:
            owner = warmup_owner.get(gi) or extra_owner[gi]
            s["exercise_id"] = owner["exercise_id"]
            s["exercise_name"] = owner["exercise_name"]
            for stale_k in ("pulse_set_num", "pulse_weight_kg", "pulse_reps", "pulse_time", "weight_mismatch"):
                s.pop(stale_k, None)
        else:
            s.pop("exercise_id", None)
            if s.get("garmin_exercise_name"):
                s["exercise_name"] = s["garmin_exercise_name"]
            else:
                s.pop("exercise_name", None)
            for stale_k in ("pulse_set_num", "pulse_weight_kg", "pulse_reps", "pulse_time", "weight_mismatch"):
                s.pop(stale_k, None)

    active_groups = [
        grp for grp in ordered_groups
        if grp["warmup_sets"] or grp["working_sets"] or grp["extra_sets"]
    ]
    matched_ex_ids = [grp["exercise_id"] for grp in active_groups]
    summary_parts = []
    for grp in active_groups:
        wu_cnt = len(grp["warmup_sets"])
        wk_cnt = len(grp["working_sets"]) + len(grp["extra_sets"])
        wk_kg = grp["working_weight_kg"]
        wk_label = f"{wk_kg:g}kg" if wk_kg > 0 else "BW"
        reps_list = [str(p["reps"]) for _, _, p in grp["working_sets"] if p["reps"] > 0]
        reps_suffix = f" ({','.join(reps_list)}r)" if reps_list else ""
        parts = []
        if wu_cnt > 0:
            parts.append(f"{wu_cnt} WU")
        if wk_cnt > 0:
            parts.append(f"{wk_cnt}×{wk_label}{reps_suffix}")
        summary_parts.append(f"{grp['exercise_name']}: {' + '.join(parts)}")

    act["matched_pulse_session_id"] = str(matched_sess.get("id") or matched_sess.get("client_event_id") or matched_sess.get("date") or "")
    act["matched_pulse_title"] = str(matched_sess.get("title") or "")
    act["matched_exercise_ids"] = matched_ex_ids
    act["matched_exercises_summary"] = " • ".join(summary_parts)
    return True
