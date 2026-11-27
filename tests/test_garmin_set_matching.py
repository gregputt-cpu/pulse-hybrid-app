import asyncio
import atexit
import json
import os
import shutil
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_LIVE_STATE_PATH = REPO_ROOT / "backend" / "live_state.json"

_TMP_DIR_OBJ = tempfile.TemporaryDirectory(prefix="pulse_garmin_match_")
TMP_DIR = Path(_TMP_DIR_OBJ.name).resolve()
DATA_DIR = TMP_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ISOLATED_LIVE_STATE_PATH = DATA_DIR / "live_state.json"
shutil.copy2(SEED_LIVE_STATE_PATH, ISOLATED_LIVE_STATE_PATH)

os.environ["DATA_DIR"] = str(DATA_DIR)
os.environ["LIVE_STATE_PATH"] = str(ISOLATED_LIVE_STATE_PATH)
os.environ["GARMIN_TOKEN_DIR"] = str(DATA_DIR / "garmin_tokens")
os.environ["MND_TOKEN_DIR"] = str(DATA_DIR / "mnd_tokens")
os.environ["PULSE_API_SECRET"] = "test-secret-garmin-match"
os.environ.pop("RAILWAY_ENVIRONMENT", None)

atexit.register(lambda: _TMP_DIR_OBJ.cleanup())

sys.path.insert(0, str(REPO_ROOT / "backend"))

import db  # noqa: E402
import benefits_engine  # noqa: E402
import diagnostics_context  # noqa: E402
import garmin_sync_service  # noqa: E402
import main  # noqa: E402
import set_matcher  # noqa: E402
import state_store  # noqa: E402
from time_utils import uk_now, uk_today_str  # noqa: E402


async def _asgi_call(method: str, url_path: str, json_body: Any = None) -> Tuple[int, Any]:
    payload_bytes = json.dumps(json_body).encode("utf-8") if json_body is not None else b""
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "http",
        "path": url_path,
        "raw_path": url_path.encode("utf-8"),
        "query_string": b"",
        "headers": [
            (b"authorization", b"Bearer test-secret-garmin-match"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload_bytes)).encode("ascii")),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    sent = False
    status_code = 500
    chunks: List[bytes] = []

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": payload_bytes, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        nonlocal status_code
        if message["type"] == "http.response.start":
            status_code = int(message["status"])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))

    await main.app(scope, receive, send)
    body = b"".join(chunks)
    return status_code, json.loads(body.decode("utf-8")) if body else None


def _reset() -> None:
    db.init_db(force=True)
    with closing(db.get_connection()) as conn:
        for tbl in ("strength_logs", "kv_store", "workout_sessions", "daily_biometrics"):
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
    with open(SEED_LIVE_STATE_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    state_store.save_live_state(seed, str(ISOLATED_LIVE_STATE_PATH))


def test_compact_garmin_exercise_sets() -> None:
    raw = {
        "activityId": 25212575636,
        "exerciseSets": [
            {
                "setType": "ACTIVE",
                "repetitionCount": 8,
                "weight": 20000.0,
                "duration": 35.2,
                "startTime": "2026-11-27T06:17:28.0",
                "exercises": [
                    {"category": "SQUAT", "name": "BARBELL_SQUAT", "probability": 0.91},
                    {"category": "LUNGE", "name": "LUNGE", "probability": 0.05},
                ],
            },
            {
                "setType": "REST",
                "repetitionCount": None,
                "weight": None,
                "duration": 90.0,
            },
            {
                "setType": "ACTIVE",
                "repetitionCount": 0,
                "weight": 70000.0,
                "duration": 18.0,
                "exercises": [],
            },
        ],
    }
    compact = garmin_sync_service._compact_garmin_exercise_sets(raw)
    assert len(compact) == 3
    assert compact[0]["set_type"] == "ACTIVE"
    assert compact[0]["reps"] == 8
    assert compact[0]["weight"] == 20000.0
    assert compact[0]["exercise_name"] == "BARBELL_SQUAT"
    assert compact[0]["exercise_category"] == "SQUAT"
    assert compact[0]["start_time"] == "2026-11-27T06:17:28.0"
    assert compact[1]["set_type"] == "REST"
    assert compact[1]["reps"] is None
    assert compact[2]["reps"] == 0  # 0 reps preserved, not treated as falsy None

    assert garmin_sync_service._exercise_sets_need_refresh(None, None) is True
    assert garmin_sync_service._exercise_sets_need_refresh({"exercise_sets": compact}, compact) is True
    assert garmin_sync_service._exercise_sets_need_refresh({"exercise_sets_schema_v": 2}, compact) is False

    ids = diagnostics_context._extract_garmin_exercise_ids({"exercise_sets": compact})
    assert "barbell_squat" in ids, f"Expected barbell_squat in {ids}"
    print("PASS [1] _compact_garmin_exercise_sets & schema refresh helper")


def test_sync_today_backfills_schema_v2_once() -> None:
    _reset()
    today_str = uk_today_str()
    # Seed state with schema v1 strength activity (reps=None)
    state = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    state.setdefault("garmin", {})["recent_activities"] = [
        {
            "id": 25212575636,
            "name": "Strength_training",
            "date": f"{today_str} 06:17:28",
            "exercise_sets": [{"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 30.0}],
        }
    ]
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))

    mock_client = MagicMock()
    mock_client.display_name = "TestAthlete"
    mock_client.get_user_summary.return_value = {"totalSteps": 5000, "activeKilocalories": 300, "bmrCalories": 100}
    mock_client.get_activities_by_date.return_value = [
        {
            "activityId": 25212575636,
            "activityType": {"typeKey": "strength_training"},
            "activityName": "Strength",
            "startTimeLocal": f"{today_str} 06:17:28",
            "duration": 2298.0,
            "calories": 315.0,
            "bmrCalories": 63.0,
            "averageHR": 106.0,
            "maxHR": 149.0,
            "totalSets": 1,
            "totalReps": 6,
        }
    ]
    mock_client.get_sleep_data.return_value = {}
    mock_client.get_training_readiness.return_value = []
    mock_client.get_morning_training_readiness.return_value = {}
    mock_client.get_body_battery.return_value = []
    mock_client.get_stress_data.return_value = {}
    mock_client.get_hrv_data.return_value = {}
    mock_client.get_heart_rates.return_value = {}
    mock_client.get_body_battery_events.return_value = []
    mock_client.get_activity_details.return_value = {}
    mock_client.get_activity_hr_in_timezones.return_value = []
    mock_client.get_activity_exercise_sets.return_value = {
        "exerciseSets": [
            {
                "setType": "ACTIVE",
                "repetitionCount": 6,
                "weight": 70000.0,
                "duration": 40.0,
                "startTime": f"{today_str}T06:20:00.0",
                "exercises": [{"category": "SQUAT", "name": "BARBELL_BACK_SQUAT", "probability": 0.9}],
            }
        ]
    }

    svc = garmin_sync_service.GarminSyncService()
    svc.client = mock_client
    res1 = svc.sync_today(target_date_str=today_str, force=True)
    act1 = res1["garmin"]["today_activities"][0]
    assert act1["exercise_sets_schema_v"] == 2
    assert act1["exercise_sets"][0]["reps"] == 6
    assert act1["exercise_sets"][0]["start_time"] == f"{today_str}T06:20:00.0"
    assert mock_client.get_activity_exercise_sets.call_count == 1

    # Second sync must NOT re-fetch exercise sets now that schema_v == 2
    res2 = svc.sync_today(target_date_str=today_str, force=True)
    assert res2["garmin"]["today_activities"][0]["exercise_sets"][0]["reps"] == 6
    assert mock_client.get_activity_exercise_sets.call_count == 1
    print("PASS [2] sync_today schema v2 backfill & cache guard")


def test_sync_set_explicit_working_promotion() -> None:
    _reset()
    # Set 1 logged as warmup (70kg vs 100kg target, no explicit is_warmup)
    st1, r1 = asyncio.run(
        _asgi_call(
            "POST",
            "/api/sync_set",
            {"exercise_id": "barbell_squat", "target_weight": 100, "target_reps": 8, "logged_weight": 70, "logged_reps": 6},
        )
    )
    assert st1 == 200 and r1["result"]["status"] == "warmup"

    # Set 2 logged at same 70kg with explicit is_warmup=False -> promotes Set 1 + logs Set 2 as working!
    st2, r2 = asyncio.run(
        _asgi_call(
            "POST",
            "/api/sync_set",
            {
                "exercise_id": "barbell_squat",
                "target_weight": 100,
                "target_reps": 8,
                "logged_weight": 70,
                "logged_reps": 6,
                "is_warmup": False,
            },
        )
    )
    assert st2 == 200 and r2["result"]["status"] != "warmup"
    hist = db.get_strength_history(days=7).get("barbell_squat", [])
    assert len(hist) == 2, f"Expected both Set 1 and Set 2 in strength_history, got {hist}"
    assert all(float(row["weight"]) == 70.0 and int(row["reps"]) == 6 for row in hist)
    print("PASS [3] /api/sync_set explicit is_warmup=False promotes Set 1")


if __name__ == "__main__":
    test_compact_garmin_exercise_sets()
    test_sync_today_backfills_schema_v2_once()
    test_sync_set_explicit_working_promotion()
    print("PASS [1-3] Core Garmin set extraction & promotion")


def test_backend_set_matcher_and_benefits_and_migration() -> None:
    _reset()
    today_str = uk_today_str()
    note_txt = (
        "Strength. Also did 2 warm up body combat tracks before this which weren't recorded on the watch. "
        "Top of hamstrings felt very tight on 4th set of squats hence only doing 1 rep."
    )
    act = {
        "id": 25212575636,
        "name": "Strength_training",
        "sub_title": note_txt,
        "user_notes": note_txt,
        "date": f"{today_str} 06:17:28",
        "duration_min": 38.3,
        "calories": 315,
        "avg_hr": 106,
        "max_hr": 149,
        "aerobic_te": 1.4,
        "anaerobic_te": 1.0,
        "activity_type_key": "strength_training",
        "total_sets": 18,
        "total_reps": 119,
        "source": "garmin_oauth",
        "exercise_sets": [
            {"set_type": "ACTIVE", "reps": None, "weight": 20000.0, "duration": 60.579},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 91.401},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 66.364},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 127.311},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 42.435},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 120.18},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 43.666},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 133.613},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 27.375},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 116.281},
            {"set_type": "ACTIVE", "reps": None, "weight": 20000.0, "duration": 31.121},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 96.367},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 38.822},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 118.387},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 27.236},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 72.571},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 26.654},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 78.283},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 28.17},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 106.464},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 30.392},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 101.369},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 30.274},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 102.06},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 26.664},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 91.356},
            {"set_type": "ACTIVE", "reps": None, "weight": 70000.0, "duration": 30.916},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 119.272},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 19.057},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 90.862},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 16.66},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 67.114},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 16.72},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 81.863},
            {"set_type": "ACTIVE", "reps": None, "weight": 50000.0, "duration": 16.547},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 3.145},
        ],
    }
    sess = {
        "id": "sess_today_barbell",
        "date": f"{today_str}T06:56:00.016+00:00",
        "title": "BARBELL OPTION A",
        "preset": "custom",
        "calories": 306,
        "details": {
            "barbell_squat_1": {"exercise_id": "barbell_squat", "set_num": 1, "weight": 70, "reps": 6, "logged": True, "time": "06:21"},
            "barbell_squat_2": {"exercise_id": "barbell_squat", "set_num": 2, "weight": 70, "reps": 6, "logged": True, "time": "06:24"},
            "barbell_squat_3": {"exercise_id": "barbell_squat", "set_num": 3, "weight": 70, "reps": 6, "logged": True, "time": "06:26"},
            "barbell_squat_4": {"exercise_id": "barbell_squat", "set_num": 4, "weight": 70, "reps": 1, "logged": True, "time": "06:29"},
            "barbell_bench_press_1": {"exercise_id": "barbell_bench_press", "set_num": 1, "weight": 70, "reps": 8, "logged": True, "time": "06:35"},
            "barbell_bench_press_2": {"exercise_id": "barbell_bench_press", "set_num": 2, "weight": 50, "reps": 8, "logged": True, "time": "06:36"},
            "barbell_bench_press_3": {"exercise_id": "barbell_bench_press", "set_num": 3, "weight": 50, "reps": 8, "logged": True, "time": "06:38"},
            "barbell_bench_press_4": {"exercise_id": "barbell_bench_press", "set_num": 4, "weight": 50, "reps": 8, "logged": True, "time": "06:40"},
            "barbell_rdl_1": {"exercise_id": "barbell_rdl", "set_num": 1, "weight": 70, "reps": 6, "logged": True, "time": "06:42"},
            "barbell_rdl_2": {"exercise_id": "barbell_rdl", "set_num": 2, "weight": 70, "reps": 6, "logged": True, "time": "06:44"},
            "barbell_rdl_3": {"exercise_id": "barbell_rdl", "set_num": 3, "weight": 70, "reps": 6, "logged": True, "time": "06:46"},
            "barbell_rdl_4": {"exercise_id": "barbell_rdl", "set_num": 4, "weight": 70, "reps": 6, "logged": True, "time": "06:48"},
            "barbell_pendlay_row_1": {"exercise_id": "barbell_pendlay_row", "set_num": 1, "weight": 50, "reps": 6, "logged": True, "time": "06:51"},
            "barbell_pendlay_row_2": {"exercise_id": "barbell_pendlay_row", "set_num": 2, "weight": 50, "reps": 6, "logged": True, "time": "06:52"},
            "barbell_pendlay_row_3": {"exercise_id": "barbell_pendlay_row", "set_num": 3, "weight": 50, "reps": 6, "logged": True, "time": "06:55"},
            "barbell_pendlay_row_4": {"exercise_id": "barbell_pendlay_row", "set_num": 4, "weight": 50, "reps": 6, "logged": True, "time": "06:55"},
        },
    }

    # Test /api/sync_session enriches today's existing Garmin activity in live_state
    state = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    state.setdefault("garmin", {})["today_activities"] = [act]
    state["garmin"]["recent_activities"] = [act]
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))

    st_sess, r_sess = asyncio.run(_asgi_call("POST", "/api/sync_session", sess))
    assert st_sess == 200 and r_sess["success"] is True

    updated_state = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    enriched_act = updated_state["garmin"]["today_activities"][0]
    active_only = [s for s in enriched_act["exercise_sets"] if s.get("set_type") == "ACTIVE"]
    assert len(active_only) == 18
    assert active_only[0]["exercise_id"] == "barbell_squat" and active_only[0]["role"] == "warmup"
    assert active_only[1]["exercise_id"] == "barbell_squat" and active_only[1]["role"] == "working" and active_only[1]["pulse_reps"] == 6
    assert active_only[5]["exercise_id"] == "barbell_bench_press" and active_only[5]["role"] == "warmup"
    assert active_only[6]["exercise_id"] == "barbell_bench_press" and active_only[6]["weight_mismatch"] == {"garmin_kg": 50.0, "pulse_kg": 70.0}
    assert active_only[10]["exercise_id"] == "barbell_rdl" and active_only[10]["role"] == "working"
    assert active_only[16]["exercise_id"] == "barbell_pendlay_row" and active_only[16]["pulse_set_num"] == 3
    assert enriched_act["matched_exercise_ids"] == ["barbell_squat", "barbell_bench_press", "barbell_rdl", "barbell_pendlay_row"]
    assert "Barbell Back Squat: 1 WU + 4×70kg (6,6,6,1r)" in enriched_act["matched_exercises_summary"]
    assert "martial arts striking" not in enriched_act["benefits"]["biomechanics"].lower()

    # BenefitsEngine must NOT treat Strength_training with Body Combat warmup note as martial arts striking
    eng = benefits_engine.PhysiologicalBenefitsEngine(athlete_weight_kg=98.0)
    ben = eng.generate_benefits("Strength_training", note_txt, 38.3, 315, 106, 149, 1.4, 1.0)
    assert "martial arts striking" not in ben["biomechanics"].lower()
    assert "myofibrillar hypertrophy" in ben["biomechanics"].lower()

    # Repeated-warmup DB migration: multi-set repeated cluster promoted, single-set warmup preserved
    with closing(db.get_connection()) as conn:
        conn.execute("DELETE FROM strength_logs")
        conn.execute("DELETE FROM kv_store WHERE key = 'migrated_repeated_warmup_sets_v1'")
        t0 = uk_now().isoformat()
        conn.execute("INSERT INTO strength_logs (timestamp, exercise_id, weight, reps, e1rm, is_warmup) VALUES (?, 'barbell_squat', 70.0, 6, 84.0, 1)", (t0,))
        conn.execute("INSERT INTO strength_logs (timestamp, exercise_id, weight, reps, e1rm, is_warmup) VALUES (?, 'barbell_squat', 70.0, 6, 84.0, 1)", (t0,))
        conn.execute("INSERT INTO strength_logs (timestamp, exercise_id, weight, reps, e1rm, is_warmup) VALUES (?, 'barbell_bench_press', 20.0, 10, 26.7, 1)", (t0,))
        conn.commit()
    db.init_db(force=True)
    with closing(db.get_connection()) as conn:
        rows = conn.execute("SELECT exercise_id, weight, is_warmup FROM strength_logs ORDER BY id ASC").fetchall()
        assert [(r["exercise_id"], float(r["weight"]), int(r["is_warmup"])) for r in rows] == [
            ("barbell_squat", 70.0, 0),
            ("barbell_squat", 70.0, 0),
            ("barbell_bench_press", 20.0, 1),
        ]
    print("PASS [4] backend set_matcher, benefits_engine & repeated-warmup migration")


def test_edit_session_set_and_explicit_warmup_matching() -> None:
    _reset()
    today_str = uk_today_str()
    # Seed strength_logs with Bench Set 1 at 70kg x 8 (false PR) + Sets 2-4 at 50kg x 8
    with closing(db.get_connection()) as conn:
        for t_min, w_val in ((35, 70.0), (36, 50.0), (38, 50.0), (40, 50.0)):
            ts = f"{today_str}T06:{t_min:02d}:15+00:00"
            e1rm = round(w_val * (1.0 + 8 / 30.0), 1)
            conn.execute(
                "INSERT INTO strength_logs (timestamp, exercise_id, weight, reps, e1rm, is_warmup) VALUES (?, 'barbell_bench_press', ?, 8, ?, 0)",
                (ts, w_val, e1rm),
            )
        conn.commit()

    act = {
        "id": 25212575636,
        "name": "Strength_training",
        "sub_title": "Strength",
        "date": f"{today_str} 06:17:28",
        "duration_min": 38.3,
        "calories": 315,
        "avg_hr": 106,
        "max_hr": 149,
        "aerobic_te": 1.4,
        "anaerobic_te": 1.0,
        "activity_type_key": "strength_training",
        "source": "garmin_oauth",
        "exercise_sets": [
            {"set_type": "ACTIVE", "reps": 12, "weight": 20000.0, "duration": 31.121, "start_time": f"{today_str}T06:31:17.0"},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 96.367},
            {"set_type": "ACTIVE", "reps": 8, "weight": 50000.0, "duration": 38.822, "start_time": f"{today_str}T06:33:24.0"},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 118.387},
            {"set_type": "ACTIVE", "reps": 8, "weight": 50000.0, "duration": 27.236, "start_time": f"{today_str}T06:36:01.0"},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 72.571},
            {"set_type": "ACTIVE", "reps": 8, "weight": 50000.0, "duration": 26.654, "start_time": f"{today_str}T06:37:41.0"},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 78.283},
            {"set_type": "ACTIVE", "reps": 8, "weight": 50000.0, "duration": 28.17, "start_time": f"{today_str}T06:39:26.0"},
        ],
    }
    sess = {
        "id": "sess_edit_1",
        "client_event_id": "sess_edit_1",
        "date": f"{today_str}T06:40:00+00:00",
        "title": "BARBELL OPTION A",
        "preset": "custom",
        "calories": 300,
        "details": {
            "barbell_bench_press_1": {"exercise_id": "barbell_bench_press", "set_num": 1, "weight": 70, "reps": 8, "target_w": 70, "target_r": 8, "logged": True, "time": "06:35"},
            "barbell_bench_press_2": {"exercise_id": "barbell_bench_press", "set_num": 2, "weight": 50, "reps": 8, "target_w": 70, "target_r": 8, "logged": True, "time": "06:36"},
            "barbell_bench_press_3": {"exercise_id": "barbell_bench_press", "set_num": 3, "weight": 50, "reps": 8, "target_w": 70, "target_r": 8, "logged": True, "time": "06:38"},
            "barbell_bench_press_4": {"exercise_id": "barbell_bench_press", "set_num": 4, "weight": 50, "reps": 8, "target_w": 70, "target_r": 8, "logged": True, "time": "06:40"},
        },
    }
    db.log_workout_session(sess)
    state = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    state["session_history"] = [sess]
    state["last_workout_session"] = dict(sess)
    state.setdefault("strength_prescriptions", {})["barbell_bench_press"] = {
        "weight": 72.5,
        "reps": 8,
        "last_logged_weight": 70,
        "last_logged_reps": 8,
        "last_e1rm": 88.7,
        "e1rm": 88.7,
        "prev_best_e1rm": 79.3,
        "is_pr": True,
        "status": "progressed",
        "progression_ready": True,
    }
    state.setdefault("garmin", {})["today_activities"] = [act]
    state["garmin"]["recent_activities"] = [act]
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))

    st_ed, r_ed = asyncio.run(
        _asgi_call(
            "POST",
            "/api/session/edit_set",
            {
                "session_id": "sess_edit_1",
                "session_date": today_str,
                "detail_key": "barbell_bench_press_1",
                "exercise_id": "barbell_bench_press",
                "weight": 50,
                "reps": 8,
            },
        )
    )
    assert st_ed == 200 and r_ed["success"] is True, r_ed
    assert r_ed["updated_set"]["weight"] == 50
    assert r_ed["updated_set"]["e1rm"] == 63.3

    saved = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    assert saved["session_history"][0]["details"]["barbell_bench_press_1"]["weight"] == 50
    assert saved["last_workout_session"]["details"]["barbell_bench_press_1"]["weight"] == 50
    sp_bench = saved["strength_prescriptions"]["barbell_bench_press"]
    assert sp_bench["e1rm"] == 79.3 and sp_bench["is_pr"] is False
    assert sp_bench["weight"] == 52.5 and sp_bench["last_logged_weight"] == 50.0

    # DB strength_logs and workout_sessions both updated
    bench_hist = db.get_strength_history(days=7)["barbell_bench_press"]
    assert all(float(x["weight"]) == 50.0 for x in bench_hist), bench_hist
    db_sess = db.get_workout_sessions(days=7)[0]["payload"]
    assert db_sess["details"]["barbell_bench_press_1"]["weight"] == 50

    # Garmin weight_mismatch cleared after edit
    active_sets = [s for s in saved["garmin"]["today_activities"][0]["exercise_sets"] if s.get("set_type") == "ACTIVE"]
    assert active_sets[1]["pulse_weight_kg"] == 50.0
    assert "weight_mismatch" not in active_sets[1]

    # Explicit Pulse _wu1 warmup set matching
    act_wu = {
        "id": 999001,
        "name": "Strength_training",
        "date": f"{today_str} 06:31:17",
        "duration_min": 10.0,
        "source": "garmin_oauth",
        "exercise_sets": [
            {"set_type": "ACTIVE", "reps": 12, "weight": 20000.0, "duration": 31.0, "start_time": f"{today_str}T06:31:17.0"},
            {"set_type": "REST", "reps": None, "weight": None, "duration": 90.0},
            {"set_type": "ACTIVE", "reps": 8, "weight": 50000.0, "duration": 30.0, "start_time": f"{today_str}T06:33:18.0"},
        ],
    }
    sess_wu = {
        "id": "sess_wu_1",
        "date": f"{today_str}T06:35:00+00:00",
        "details": {
            "barbell_bench_press_wu1": {"exercise_id": "barbell_bench_press", "set_num": 0, "warmup_num": 1, "weight": 20, "reps": 12, "logged": True, "is_warmup": True, "explicit_warmup": True, "time": "06:32"},
            "barbell_bench_press_1": {"exercise_id": "barbell_bench_press", "set_num": 1, "weight": 50, "reps": 8, "logged": True, "time": "06:34"},
        },
    }
    assert set_matcher.enrich_garmin_activity_with_pulse_sets(act_wu, [sess_wu]) is True
    wu_active = [s for s in act_wu["exercise_sets"] if s.get("set_type") == "ACTIVE"]
    assert wu_active[0]["role"] == "warmup" and wu_active[0]["pulse_reps"] == 12
    assert wu_active[1]["role"] == "working" and wu_active[1]["pulse_reps"] == 8
    print("PASS [5] /api/session/edit_set & explicit _wu1 matching")


if __name__ == "__main__":
    test_backend_set_matcher_and_benefits_and_migration()
    test_edit_session_set_and_explicit_warmup_matching()
    print("ALL GARMIN SET MATCHING BACKEND TESTS PASSED")
