import asyncio
import atexit
import csv
import io
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

_TMP_OBJ = tempfile.TemporaryDirectory(prefix="pulse_autonomic_be_")
TMP_DIR = _TMP_OBJ.name
os.makedirs(os.path.join(TMP_DIR, "garmin_tokens"), exist_ok=True)
os.environ["DATA_DIR"] = TMP_DIR
os.environ["LIVE_STATE_PATH"] = os.path.join(TMP_DIR, "pulse_live_state.json")
os.environ["GARMIN_TOKEN_DIR"] = os.path.join(TMP_DIR, "garmin_tokens")
os.environ["PULSE_API_SECRET"] = "test-secret-auto"
os.environ.pop("RAILWAY_ENVIRONMENT", None)


def _cleanup():
    try:
        _TMP_OBJ.cleanup()
    except Exception:
        pass


atexit.register(_cleanup)

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

SEED_LIVE_STATE = os.path.join(BACKEND_DIR, "live_state.json")
if os.path.exists(SEED_LIVE_STATE):
    shutil.copy2(SEED_LIVE_STATE, os.environ["LIVE_STATE_PATH"])

import db
import state_store
import time_utils
import autonomic_service
import analytics_service
import garmin_sync_service
import main as pulse_main

db.DATA_DIR = TMP_DIR
db.DB_PATH = os.path.join(TMP_DIR, "pulse.db")
db._INITIALIZED_DB_PATH = None
LIVE_STATE_PATH = os.environ["LIVE_STATE_PATH"]
pulse_main.LIVE_STATE_PATH = LIVE_STATE_PATH
garmin_sync_service.LIVE_STATE_PATH = LIVE_STATE_PATH


async def _asgi_call(
    method: str,
    url_path: str,
    payload: Any = None,
    auth: bool = True,
) -> Tuple[int, str]:
    path, query_str = url_path.split("?", 1) if "?" in url_path else (url_path, "")
    body = json.dumps(payload).encode("utf-8") if payload is not None else b""
    req_headers: List[Tuple[bytes, bytes]] = []
    if auth and path.startswith("/api/"):
        req_headers.append((b"authorization", b"Bearer test-secret-auto"))
    if body:
        req_headers.append((b"content-type", b"application/json"))
        req_headers.append((b"content-length", str(len(body)).encode("latin-1")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("latin-1"),
        "query_string": query_str.encode("latin-1"),
        "root_path": "",
        "headers": req_headers,
        "client": ("127.0.0.1", 54321),
        "server": ("testserver", 80),
    }
    sent_body = False
    done = asyncio.Event()

    async def receive() -> Dict[str, Any]:
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}
        await done.wait()
        return {"type": "http.disconnect"}

    status_code = 500
    chunks: List[bytes] = []

    async def send(message: Dict[str, Any]) -> None:
        nonlocal status_code
        if message["type"] == "http.response.start":
            status_code = int(message["status"])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                done.set()

    await pulse_main.app(scope, receive, send)
    return status_code, b"".join(chunks).decode("utf-8")


def api_req(method: str, url_path: str, payload: Any = None, auth: bool = True) -> Tuple[int, str]:
    return asyncio.run(_asgi_call(method, url_path, payload=payload, auth=auth))


def reset_env():
    if os.path.exists(db.DB_PATH):
        os.remove(db.DB_PATH)
    for ext in ("-wal", "-shm"):
        if os.path.exists(db.DB_PATH + ext):
            os.remove(db.DB_PATH + ext)
    db._INITIALIZED_DB_PATH = None
    db.init_db(force=True)
    if os.path.exists(LIVE_STATE_PATH):
        os.remove(LIVE_STATE_PATH)
    state_store.ensure_live_state_seeded(LIVE_STATE_PATH)


def _ms(dt_obj: datetime) -> int:
    return int(round(dt_obj.timestamp() * 1000.0))


def test_level1_baseline_alerts():
    reset_env()
    now_uk = time_utils.uk_now()
    today_date = now_uk.date()
    today_str = today_date.isoformat()

    # Build 5 prior nights HRV ~52ms
    for off in range(1, 6):
        d = (today_date - timedelta(days=off)).isoformat()
        db.upsert_daily_biometrics(d, sleep_score=80, resting_hr=48, body_battery=75, hrv_last_night=52.0, sleep_avg_stress=18.0)

    # Sleep window 23:00 yesterday -> 06:30 today with -1/-2 sentinels mixed into elevated stress ~38
    s_start = datetime.combine(today_date - timedelta(days=1), datetime.min.time(), tzinfo=time_utils.UK_TZ) + timedelta(hours=23)
    s_end = s_start + timedelta(hours=7, minutes=30)
    sleep_samples = []
    cur = s_start
    idx = 0
    while cur <= s_end:
        val = -1 if idx % 6 == 0 else (38 if idx % 2 == 0 else 34)
        sleep_samples.append([_ms(cur), val])
        cur += timedelta(minutes=3)
        idx += 1

    db.upsert_daily_biometrics(
        today_str,
        sleep_score=64,
        resting_hr=54,
        body_battery=55,
        hrv_last_night=41.0,
        hrv_status="LOW",
        hrv_baseline_low=46.0,
        sleep_avg_stress=36.0,
        sleep_start_ts=_ms(s_start),
        sleep_end_ts=_ms(s_end),
    )
    db.upsert_garmin_intraday(today_str, sleep_stress_samples=sleep_samples)

    bio_hist = db.get_daily_biometrics(days=14)
    today_bio = next(r for r in bio_hist if r["date_str"] == today_str)
    lvl1 = autonomic_service.evaluate_level1_baseline(today_bio, bio_hist, db.get_garmin_intraday(today_str), target_date_str=today_str)
    assert lvl1["active"] is True
    assert "overnight_sleep_stress_elevated" in lvl1["triggers"]
    assert "overnight_hrv_below_baseline" in lvl1["triggers"]
    assert lvl1["sleep_data_quality"] == "ok"
    assert lvl1["sleep_avg_stress"] >= 34.0

    # Low coverage sleep (<30% valid due to -1 off-wrist) must NOT trigger sleep_stress even if those 3 points are 45
    sparse_sleep = [[_ms(s_start), 45], [_ms(s_start + timedelta(minutes=3)), 45], [_ms(s_start + timedelta(minutes=6)), 45]]
    for k in range(3, 80):
        sparse_sleep.append([_ms(s_start + timedelta(minutes=3 * k)), -1])
    today_bio_ok_hrv = dict(today_bio, hrv_last_night=51.0, hrv_status="BALANCED", sleep_avg_stress=None)
    lvl1_sparse = autonomic_service.evaluate_level1_baseline(
        today_bio_ok_hrv,
        bio_hist,
        {"date_str": today_str, "sleep_stress_samples": sparse_sleep, "stress_samples": []},
        target_date_str=today_str,
    )
    assert lvl1_sparse["sleep_data_quality"] == "insufficient"
    assert lvl1_sparse["active"] is False
    print("PASS [1] Level 1 Baseline Alerts & Negative/Low-Coverage Guards")


def test_level2_sympathetic_load_workout_and_gaps():
    reset_env()
    now_uk = time_utils.uk_now()
    today_date = now_uk.date()
    today_str = today_date.isoformat()

    wake_dt = datetime.combine(today_date, datetime.min.time(), tzinfo=time_utils.UK_TZ) + timedelta(hours=7)
    # Case A: 255 mins continuous stress 35..48 with one 9-min -1 gap (bridged) -> Level 2 ACTIVE
    samples_a = []
    for m in range(0, 258, 3):
        ts = _ms(wake_dt + timedelta(minutes=m))
        if 90 <= m <= 96:
            samples_a.append([ts, -1])  # 9m sensor adjustment gap (<15m)
        else:
            samples_a.append([ts, 36 + (m % 9)])
    lvl2_a = autonomic_service.evaluate_level2_sympathetic_load(
        {"date_str": today_str, "stress_samples": samples_a},
        sleep_end_ts=_ms(wake_dt),
        workout_intervals_ms=[],
        target_date_str=today_str,
    )
    assert lvl2_a["active"] is True
    assert lvl2_a["max_streak_mins"] >= 240

    # Case B: Same 255m window, EXCEPT 12 mins of <=20 parasympathetic recovery dip at 130m -> RESETS streak
    samples_b = []
    for m in range(0, 258, 3):
        ts = _ms(wake_dt + timedelta(minutes=m))
        val = 18 if 126 <= m <= 135 else 38
        samples_b.append([ts, val])
    lvl2_b = autonomic_service.evaluate_level2_sympathetic_load(
        {"date_str": today_str, "stress_samples": samples_b},
        sleep_end_ts=_ms(wake_dt),
        workout_intervals_ms=[],
        target_date_str=today_str,
    )
    assert lvl2_b["active"] is False
    assert lvl2_b["max_streak_mins"] < 240

    # Case C: Large off-wrist gap (>15m, e.g. 24m) breaks streak
    samples_c = []
    for m in range(0, 258, 3):
        if 120 <= m <= 141:
            continue
        samples_c.append([_ms(wake_dt + timedelta(minutes=m)), 38])
    lvl2_c = autonomic_service.evaluate_level2_sympathetic_load(
        {"date_str": today_str, "stress_samples": samples_c},
        sleep_end_ts=_ms(wake_dt),
        workout_intervals_ms=[],
        target_date_str=today_str,
    )
    assert lvl2_c["active"] is False

    # Case D: Logged workout from minute 0..60 excludes stress in that window -> remaining streak 190m < 240m
    workout_iv = [(_ms(wake_dt - timedelta(minutes=5)), _ms(wake_dt + timedelta(minutes=65)))]
    lvl2_d = autonomic_service.evaluate_level2_sympathetic_load(
        {"date_str": today_str, "stress_samples": samples_a},
        sleep_end_ts=_ms(wake_dt),
        workout_intervals_ms=workout_iv,
        target_date_str=today_str,
    )
    assert lvl2_d["active"] is False
    print("PASS [2] Level 2 4h+ Sympathetic Streak, Dip Reset, >15m Gap Break & Workout Masking")


def test_acute_spike_detection_and_dismissal():
    reset_env()
    now_uk = time_utils.uk_now()
    today_str = now_uk.date().isoformat()
    ref_now = _ms(now_uk)

    # 30m resting HR baseline ~58 bpm, then abrupt jump to 118 bpm + stress 86 outside workouts
    hr_samples = []
    for m in range(45, 10, -2):
        hr_samples.append([_ms(now_uk - timedelta(minutes=m)), 58])
    hr_samples.append([_ms(now_uk - timedelta(minutes=5)), 118])
    stress_samples = [
        [_ms(now_uk - timedelta(minutes=12)), 30],
        [_ms(now_uk - timedelta(minutes=9)), 82],
        [_ms(now_uk - timedelta(minutes=6)), 88],
    ]
    intraday = {"date_str": today_str, "stress_samples": stress_samples, "hr_samples": hr_samples}

    spike = autonomic_service.detect_acute_episode_spikes(intraday, [], now_ms=ref_now)
    assert spike is not None and spike["detected"] is True
    assert spike["peak_stress"] == 88
    assert spike["peak_hr"] == 118

    # Inside logged workout -> suppressed
    w_start = _ms(now_uk - timedelta(minutes=20))
    w_end = _ms(now_uk + timedelta(minutes=5))
    assert autonomic_service.detect_acute_episode_spikes(intraday, [(w_start, w_end)], now_ms=ref_now) is None

    # Dismissing persists in kv_store and suppresses same spike
    autonomic_service.dismiss_spike_until(spike["spike_ts_ms"])
    dismissed = autonomic_service._get_spike_dismissed_ms()
    assert autonomic_service.detect_acute_episode_spikes(intraday, [], now_ms=ref_now, dismissed_before_ms=dismissed) is None
    print("PASS [3] Acute Unprovoked Stress/HR Spike Detection, Workout Suppression & Dismissal")


def test_episode_state_machine_hybrid_recovery_and_cross_midnight_backfill():
    reset_env()
    now_uk = time_utils.uk_now()
    today_date = now_uk.date()
    yest_date = today_date - timedelta(days=1)

    # Episode onset at 23:25 yesterday (spans yesterday -> today 00:25 for +/-60m snapshot!)
    onset_dt = datetime.combine(yest_date, datetime.min.time(), tzinfo=time_utils.UK_TZ) + timedelta(hours=23, minutes=25)
    ep = autonomic_service.create_episode({
        "onset_time": onset_dt.isoformat(),
        "symptoms": ["dizziness_vertigo", "dissociation", "impending_doom"],
        "triggers": ["standing_quickly", "high_workload"],
        "severity": "moderate",
        "notes": "=SUM(1,2) sudden wave",
        "client_event_id": "evt_idem_test_1",
    })
    assert ep["state"] == "ACUTE_EPISODE"
    assert ep["biometric_snapshot_status"] == "pending"
    assert "paroxysmal_focal_neuro" in ep["pathway_tags"]
    assert "perfusion_orthostatic" in ep["pathway_tags"]

    # Duplicate client_event_id returns same episode without creating second row
    ep_dup = autonomic_service.create_episode({
        "onset_time": onset_dt.isoformat(),
        "client_event_id": "evt_idem_test_1",
    })
    assert ep_dup["id"] == ep["id"]

    # Acute peak ended after 12m; user marks feeling normal after 25m -> still POST_EPISODE_RECOVERY until Garmin stress <=25!
    acute_end_dt = onset_dt + timedelta(minutes=12)
    user_rec_dt = onset_dt + timedelta(minutes=25)
    ep2 = autonomic_service.update_episode({
        "id": ep["id"],
        "action": "mark_acute_end",
        "acute_peak_end_time": acute_end_dt.isoformat(),
    })
    assert ep2["state"] == "POST_EPISODE_RECOVERY"
    assert ep2["acute_duration_mins"] == 12

    ep3 = autonomic_service.update_episode({
        "id": ep["id"],
        "action": "mark_user_recovered",
        "user_recovered_at": user_rec_dt.isoformat(),
    })
    assert ep3["state"] == "POST_EPISODE_RECOVERY"
    assert ep3["user_recovered_at"] is not None

    # Delayed Garmin intraday telemetry arrives across BOTH yesterday (pre-onset) and today (post-onset + calm <=25)
    yest_stress = [[_ms(onset_dt - timedelta(minutes=m)), 35] for m in (40, 30, 20, 10)] + [[_ms(onset_dt + timedelta(minutes=5)), 82]]
    today_stress = []
    mid_today = datetime.combine(today_date, datetime.min.time(), tzinfo=time_utils.UK_TZ)
    for m in range(5, 80, 3):
        val = 18 if m >= 20 else 36
        today_stress.append([_ms(mid_today + timedelta(minutes=m)), val])

    db.upsert_daily_biometrics(yest_date.isoformat(), sleep_score=74, resting_hr=50, body_battery=65, hrv_last_night=42.0, sleep_avg_stress=31.0)
    db.upsert_garmin_intraday(yest_date.isoformat(), stress_samples=yest_stress)
    db.upsert_garmin_intraday(today_date.isoformat(), stress_samples=today_stress)

    updated = autonomic_service.backfill_episode_snapshots()
    assert updated >= 1
    ep_final = db.get_paroxysmal_episode(ep["id"])
    assert ep_final["state"] == "RESOLVED"
    assert ep_final["biometric_snapshot_status"] == "complete"
    assert ep_final["biometric_recovered_at"] is not None
    assert ep_final["total_recovery_duration_mins"] >= 25
    assert ep_final["biometric_snapshot"]["stress"]["peak"] == 82

    # CSV Formula Injection sanitization check
    csv_text = autonomic_service.serialize_episodes_csv([ep_final])
    reader = list(csv.reader(io.StringIO(csv_text)))
    assert len(reader) == 2
    assert reader[1][-1].startswith("'=SUM(1,2)")

    # Override resolution without Garmin data (anti-deadlock)
    ep_off = autonomic_service.create_episode({"onset_time": (now_uk - timedelta(minutes=30)).isoformat()})
    ep_off_res = autonomic_service.update_episode({
        "id": ep_off["id"],
        "action": "confirm_resolved_override",
        "full_recovery_time": now_uk.isoformat(),
    })
    assert ep_off_res["state"] == "RESOLVED"
    assert ep_off_res["total_recovery_duration_mins"] >= 29
    print("PASS [4] State Machine, Hybrid Recovery, Cross-Midnight Backfill, Anti-Deadlock & CSV Guard")


def test_illness_logging_tdee_exclusion_nutrition_and_scale_shield():
    reset_env()
    now_uk = time_utils.uk_now()
    today_date = now_uk.date()
    today_str = today_date.isoformat()

    # Create 10 days of clean Renpho weight loss + 2100 kcal fuel, PLUS massive outlier spike on Day -2 when sick
    renpho_rows = []
    for off in range(10, -1, -1):
        d = (today_date - timedelta(days=off)).isoformat()
        d_ts = int(datetime.combine(today_date - timedelta(days=off), datetime.min.time(), tzinfo=time_utils.UK_TZ).timestamp()) + 28800
        # Healthy loss ~ -0.07 kg/day, EXCEPT Day -2 sick inflammation spike (+2.5kg)
        w = 91.5 if off == 2 else (89.5 - (10 - off) * 0.08)
        renpho_rows.append({"timestamp": d_ts, "date_str": d, "weight_kg": w})
        db.upsert_daily_nutrition(d, 4100 if off == 2 else 2100, 195, 220, 70, source="mnd")

    sick_day_str = (today_date - timedelta(days=2)).isoformat()
    db.upsert_illness_log(sick_day_str, status="active", severity="moderate", symptoms=["fatigue_malaise"], notes="Viral bug + cravings")
    ill_info = autonomic_service.compute_illness_status(today_str)
    assert sick_day_str in ill_info["excluded_tdee_dates"]
    assert (today_date - timedelta(days=1)).isoformat() in ill_info["excluded_tdee_dates"]  # +1d rebound
    assert ill_info["post_illness_ramp_active"] is False  # 2 days ago -> Day-2 recovery shield active
    assert ill_info["recovery_scale_shield"]["active"] is True

    # Adaptive TDEE should exclude sick_day outlier cleanly
    tdee_res = analytics_service.compute_adaptive_tdee({}, renpho_rows, db.get_daily_nutrition(days=21), today_str)
    assert tdee_res["status"] == "ready"
    assert tdee_res["illness_days_excluded"] >= 2
    assert tdee_res["avg_intake_kcal"] == 2100  # 4100 kcal sick binge excluded!

    # Now log TODAY as sick too -> maintenance nutrition override + Day-1 ramp once yesterday is sick
    db.upsert_illness_log(today_str, status="active", severity="severe", symptoms=["fever_chills"], notes="Active flu")
    st = state_store.load_live_state(LIVE_STATE_PATH)
    st.setdefault("nutrition", {})["tdee"] = 2580
    st["nutrition"]["base_calorie_target"] = 2092
    st["nutrition"]["base_protein_target_g"] = 200
    st["garmin"]["active_calories"] = 0
    nut = analytics_service.recalculate_nutrition(st, today_str)
    assert nut["illness_active"] is True
    assert nut["calorie_target"] >= 2580
    assert nut["protein_target_g"] == 200  # Protein anchor locked

    # Clear today and set yesterday sick -> verifies Day-1 Return Ramp
    db.delete_illness_log(today_str)
    yest_str = (today_date - timedelta(days=1)).isoformat()
    db.upsert_illness_log(yest_str, status="active", severity="mild")
    ill_after = autonomic_service.compute_illness_status(today_str)
    assert ill_after["active_today"] is False
    assert ill_after["post_illness_ramp_active"] is True
    assert ill_after["recovery_scale_shield"]["active"] is True

    flex_res = analytics_service.compute_flex_refeed_status(st, today_str=today_str)
    assert flex_res["scale_shield"]["active"] is True
    assert flex_res["scale_shield"]["claim_mode"] == "illness_recovery"
    print("PASS [5] Illness Backdating, TDEE Exclusion, Maintenance Fuel Override, Return Ramp & 48h Shield")


def test_fastapi_endpoints_and_garmin_sync_backfill():
    reset_env()

    # Auth guard check
    st_unauth, _ = api_req("GET", "/api/health/autonomic/status", auth=False)
    assert st_unauth == 401

    # 1. Illness endpoint backdating (Mon/Tue/today)
    today_str = time_utils.uk_today_str()
    yest_str = (time_utils.uk_now().date() - timedelta(days=1)).isoformat()
    st_ill, raw_ill = api_req("POST", "/api/health/illness", {
        "date_str": yest_str,
        "status": "active",
        "severity": "moderate",
        "symptoms": ["fatigue_malaise", "elevated_rhr_stress"],
        "notes": "Down with viral fatigue",
    })
    assert st_ill == 200
    assert json.loads(raw_ill)["success"] is True

    st_ill2, raw_ill2 = api_req("POST", "/api/health/illness", {
        "date_str": today_str,
        "status": "active",
        "severity": "moderate",
        "symptoms": ["fatigue_malaise"],
    })
    assert st_ill2 == 200
    j_ill2 = json.loads(raw_ill2)
    assert j_ill2["illness"]["active_today"] is True
    assert j_ill2["state"]["nutrition"]["illness_active"] is True

    # 2. Create episode -> links active illness automatically
    st_ep, raw_ep = api_req("POST", "/api/health/episodes", {
        "id": "ep_api_roundtrip_1",
        "symptoms": ["lightheaded_presyncope", "visual_changes"],
        "triggers": ["driving"],
        "severity": "moderate",
        "notes": "Turn while stationary",
    })
    assert st_ep == 200
    ep_data = json.loads(raw_ep)["episode"]
    assert ep_data["id"] == "ep_api_roundtrip_1"
    assert ep_data["illness_active"] is True
    assert "illness_infection" in ep_data["triggers"]

    # 3. Update & Resolve via override
    st_upd, raw_upd = api_req("POST", "/api/health/episodes/update", {
        "id": "ep_api_roundtrip_1",
        "action": "confirm_resolved_override",
        "symptoms": ["lightheaded_presyncope", "dizziness_vertigo"],
    })
    assert st_upd == 200
    assert json.loads(raw_upd)["episode"]["state"] == "RESOLVED"

    # 4. Analytics summary includes autonomic & patterns
    st_sum, raw_sum = api_req("GET", "/api/analytics/summary")
    assert st_sum == 200
    summary = json.loads(raw_sum)
    assert summary["autonomic"]["patterns"]["total_episodes"] == 1
    assert summary["autonomic"]["patterns"]["illness_co_occurrence_pct"] == 100.0
    assert summary["autonomic"]["illness"]["current_streak_days"] >= 2

    # 5. CSV & JSON Clinical Export
    st_csv, csv_txt = api_req("GET", "/api/health/episodes/export?format=csv")
    assert st_csv == 200
    assert "episode_id,date_uk" in csv_txt
    assert "ep_api_roundtrip_1" in csv_txt

    st_json, raw_json = api_req("GET", "/api/health/episodes/export?format=json")
    assert st_json == 200
    assert len(json.loads(raw_json)["episodes"]) == 1

    # 6. Delete episode
    st_del, raw_del = api_req("POST", "/api/health/episodes/delete", {"id": "ep_api_roundtrip_1"})
    assert st_del == 200
    assert json.loads(raw_del)["deleted_id"] == "ep_api_roundtrip_1"

    # 7. Mock Garmin sync persists intraday stress, HR, sleep stress, HRV baseline & triggers snapshot backfill
    now_uk = time_utils.uk_now()
    onset_dt = now_uk - timedelta(hours=2)
    ep_sync = autonomic_service.create_episode({
        "id": "ep_garmin_sync_backfill",
        "onset_time": onset_dt.isoformat(),
        "acute_peak_end_time": (onset_dt + timedelta(minutes=8)).isoformat(),
        "user_recovered_at": (onset_dt + timedelta(minutes=20)).isoformat(),
    })
    assert ep_sync["state"] == "POST_EPISODE_RECOVERY"

    class FakeGarminClient:
        def get_user_summary(self, d):
            return {"totalSteps": 6400, "restingHeartRate": 50, "bodyBatteryMostRecentValue": 62}
        def get_activities_by_date(self, s, e):
            return []
        def get_sleep_data(self, d):
            return {
                "dailySleepDTO": {
                    "sleepScores": {"overall": {"value": 72}},
                    "sleepTimeSeconds": 25200,
                    "avgSleepStress": 34.0,
                    "sleepStartTimestampGMT": _ms(now_uk - timedelta(hours=10)),
                    "sleepEndTimestampGMT": _ms(now_uk - timedelta(hours=3)),
                },
                "sleepStress": [[_ms(now_uk - timedelta(hours=9, minutes=m)), 34] for m in range(0, 120, 10)],
            }
        def get_training_readiness(self, d):
            return [{"score": 68, "level": "MODERATE", "feedbackShort": "READY", "timestamp": now_uk.isoformat()}]
        def get_body_battery(self, d):
            return [{"bodyBatteryMostRecentValue": 62, "bodyBatteryValuesArray": [[_ms(now_uk), 62]]}]
        def get_stress_data(self, d):
            pts = [[_ms(onset_dt + timedelta(minutes=m)), 82 if 0 <= m <= 5 else 19] for m in range(-60, 61, 3)]
            return {"avgStressLevel": 24, "stressValuesArray": pts, "bodyBatteryValuesArray": [[_ms(now_uk), 62]]}
        def get_hrv_data(self, d):
            return {"hrvSummary": {"weeklyAvg": 50, "lastNightAvg": 39, "status": "LOW", "baseline": {"balancedLow": 44}}}
        def get_heart_rates(self, d):
            pts = [[_ms(onset_dt + timedelta(minutes=m)), 112 if 0 <= m <= 5 else 58] for m in range(-60, 61, 5)]
            return {"heartRateValues": pts}

    svc = garmin_sync_service.GarminSyncService()
    svc.client = FakeGarminClient()
    svc._persist_tokens = lambda c: None
    res_state = svc.sync_today(force=True)
    assert res_state["garmin"]["hrv_last_night"] == 39
    assert res_state["garmin"]["sleep_avg_stress"] == 34.0
    backfilled = db.get_paroxysmal_episode("ep_garmin_sync_backfill")
    assert backfilled["biometric_snapshot_status"] == "complete"
    assert backfilled["state"] == "RESOLVED"
    assert backfilled["biometric_snapshot"]["hr"]["peak"] == 112
    print("PASS [6] FastAPI /api/health/* Endpoints, Exports, Illness Linking & Garmin Intraday Backfill")


if __name__ == "__main__":
    test_level1_baseline_alerts()
    test_level2_sympathetic_load_workout_and_gaps()
    test_acute_spike_detection_and_dismissal()
    test_episode_state_machine_hybrid_recovery_and_cross_midnight_backfill()
    test_illness_logging_tdee_exclusion_nutrition_and_scale_shield()
    test_fastapi_endpoints_and_garmin_sync_backfill()
    print("ALL 6 AUTONOMIC & ILLNESS BACKEND SUITES PASSED")
