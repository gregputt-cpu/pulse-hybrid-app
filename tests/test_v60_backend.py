import asyncio
import gc
import gzip
import json
import os
import shutil
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_LIVE_STATE_PATH = REPO_ROOT / "backend" / "live_state.json"

# ---------------------------------------------------------------------------
# Environment Isolation (MUST execute BEFORE importing backend modules)
# ---------------------------------------------------------------------------
_TMP_DIR_OBJ = tempfile.TemporaryDirectory(prefix="pulse_v60_be_")
TMP_DIR = Path(_TMP_DIR_OBJ.name).resolve()
DATA_DIR = TMP_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ISOLATED_LIVE_STATE_PATH = DATA_DIR / "live_state.json"
shutil.copy2(SEED_LIVE_STATE_PATH, ISOLATED_LIVE_STATE_PATH)

os.environ["DATA_DIR"] = str(DATA_DIR)
os.environ["LIVE_STATE_PATH"] = str(ISOLATED_LIVE_STATE_PATH)
os.environ["GARMIN_TOKEN_DIR"] = str(DATA_DIR / "garmin_tokens")
os.environ["MND_TOKEN_DIR"] = str(DATA_DIR / "mnd_tokens")
os.environ["PULSE_API_SECRET"] = "test-secret-v60"
os.environ.pop("RAILWAY_ENVIRONMENT", None)
os.environ.pop("ARTIFACT_LIVE_STATE_PATH", None)

sys.path.insert(0, str(REPO_ROOT / "backend"))

import state_store  # noqa: E402
import db  # noqa: E402
import analytics_service  # noqa: E402
import garmin_sync_service  # noqa: E402
import mnd_sync_service  # noqa: E402
import main  # noqa: E402
from time_utils import UK_TZ, uk_now  # noqa: E402


def _assert_inside_tmp(path_str: str, label: str) -> None:
    resolved = Path(path_str).resolve()
    assert resolved.is_relative_to(TMP_DIR), (
        f"{label} resolved outside TMP_DIR: {resolved} (expected under {TMP_DIR})"
    )


_assert_inside_tmp(db.DB_PATH, "db.DB_PATH")
_assert_inside_tmp(main.LIVE_STATE_PATH, "main.LIVE_STATE_PATH")
_assert_inside_tmp(garmin_sync_service.LIVE_STATE_PATH, "garmin_sync_service.LIVE_STATE_PATH")
_assert_inside_tmp(mnd_sync_service.LIVE_STATE_PATH, "mnd_sync_service.LIVE_STATE_PATH")


# ---------------------------------------------------------------------------
# Compact Async ASGI Test Helper (no httpx / TestClient dependency)
# ---------------------------------------------------------------------------
async def _asgi_call(
    method: str,
    url_path: str,
    body: bytes = b"",
    headers: Optional[List[Tuple[str, str]]] = None,
    auth: bool = True,
) -> Tuple[int, Dict[str, str], bytes]:
    if "?" in url_path:
        path, query_str = url_path.split("?", 1)
    else:
        path, query_str = url_path, ""

    req_headers: List[Tuple[bytes, bytes]] = []
    has_auth = False
    has_ct = False
    for k, v in headers or []:
        lk = k.lower()
        if lk == "authorization":
            has_auth = True
        if lk == "content-type":
            has_ct = True
        req_headers.append((lk.encode("latin-1"), v.encode("latin-1")))

    if auth and not has_auth and path.startswith("/api/"):
        req_headers.append((b"authorization", b"Bearer test-secret-v60"))
    if body and not has_ct:
        req_headers.append((b"content-type", b"application/json"))
    if body:
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
        "client": ("127.0.0.1", 12345),
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
    resp_headers: Dict[str, str] = {}
    chunks: List[bytes] = []

    async def send(message: Dict[str, Any]) -> None:
        nonlocal status_code
        msg_type = message["type"]
        if msg_type == "http.response.start":
            status_code = int(message["status"])
            for hk, hv in message.get("headers", []):
                resp_headers[hk.decode("latin-1").lower()] = hv.decode("latin-1")
        elif msg_type == "http.response.body":
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                done.set()

    try:
        await main.app(scope, receive, send)
    finally:
        done.set()
    return status_code, resp_headers, b"".join(chunks)


def asgi_request(
    method: str,
    url_path: str,
    json_body: Any = None,
    raw_body: Optional[bytes] = None,
    headers: Optional[List[Tuple[str, str]]] = None,
    auth: bool = True,
) -> Tuple[int, Dict[str, str], bytes]:
    if raw_body is not None:
        payload_bytes = raw_body
    elif json_body is not None:
        payload_bytes = json.dumps(json_body).encode("utf-8")
    else:
        payload_bytes = b""
    return asyncio.run(_asgi_call(method, url_path, payload_bytes, headers=headers, auth=auth))


def asgi_json(
    method: str,
    url_path: str,
    json_body: Any = None,
    headers: Optional[List[Tuple[str, str]]] = None,
    auth: bool = True,
) -> Tuple[int, Dict[str, str], Any]:
    status, resp_headers, body = asgi_request(
        method, url_path, json_body=json_body, headers=headers, auth=auth
    )
    parsed = json.loads(body.decode("utf-8")) if body else None
    return status, resp_headers, parsed


def _reset_live_state_from_seed() -> Dict[str, Any]:
    with open(SEED_LIVE_STATE_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    state_store.save_live_state(seed, str(ISOLATED_LIVE_STATE_PATH))
    return seed


# ---------------------------------------------------------------------------
# [1] Schema & Midnight Rollover Persistence
# ---------------------------------------------------------------------------
def test_1_schema_and_midnight_rollover() -> None:
    db.init_db(force=True)
    with closing(db.get_connection()) as conn:
        rows = conn.execute(
            "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')"
        ).fetchall()
        tables = {r["name"] for r in rows if r["type"] == "table"}
        indexes = {r["name"] for r in rows if r["type"] == "index"}
        assert "daily_biometrics" in tables, f"Missing daily_biometrics table: {tables}"
        assert "daily_nutrition_logs" in tables, f"Missing daily_nutrition_logs table: {tables}"
        for idx_name in (
            "idx_strength_exercise",
            "idx_daily_biometrics_date",
            "idx_daily_nutrition_date",
        ):
            assert idx_name in indexes, f"Missing index {idx_name}: {indexes}"

        conn.execute("DELETE FROM daily_biometrics")
        conn.execute("DELETE FROM daily_nutrition_logs")
        conn.commit()

    today_dt = uk_now().date()
    today_str = today_dt.isoformat()
    yesterday_str = (today_dt - timedelta(days=1)).isoformat()

    state = _reset_live_state_from_seed()
    state["date"] = yesterday_str
    garmin = state.setdefault("garmin", {})
    garmin["oauth_date"] = yesterday_str
    garmin["sleep_score"] = 78
    garmin["resting_hr"] = 48
    garmin["body_battery"] = 72
    garmin["training_readiness"] = 81
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))

    mock_client = MagicMock()
    mock_client.get_user_summary.return_value = {
        "totalSteps": 4120,
        "restingHeartRate": 46,
        "bodyBatteryMostRecentValue": 79,
    }
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 84}},
            "sleepTimeSeconds": 27000,
        }
    }
    mock_client.get_training_readiness.return_value = [
        {"score": 88, "level": "OPTIMAL", "feedbackShort": "WELL_RECOVERED"}
    ]
    mock_client.get_hrv_data.return_value = {}
    mock_client.get_stress_data.return_value = {}
    mock_client.get_activities.return_value = []
    mock_client.get_activities_by_date.return_value = []
    mock_client.get_body_battery.return_value = []
    mock_client.get_body_battery_events.return_value = []
    mock_client.client.dumps.return_value = "{}"

    svc = garmin_sync_service.GarminSyncService()
    with patch.object(svc, "get_client", return_value=mock_client):
        synced_state = svc.sync_today(target_date_str=today_str, force=True)

    assert synced_state["garmin"]["garmin_sync_mode"] == "oauth"

    with closing(db.get_connection()) as conn:
        bio_rows = conn.execute(
            "SELECT date_str, sleep_score, resting_hr, body_battery, training_readiness, source "
            "FROM daily_biometrics WHERE date_str IN (?, ?)",
            (yesterday_str, today_str),
        ).fetchall()
    bio_by_date = {r["date_str"]: dict(r) for r in bio_rows}
    assert yesterday_str in bio_by_date, f"Missing yesterday rollover row in {bio_by_date}"
    assert bio_by_date[yesterday_str]["source"] == "garmin_rollover"
    assert bio_by_date[yesterday_str]["sleep_score"] == 78
    assert bio_by_date[yesterday_str]["resting_hr"] == 48
    assert bio_by_date[yesterday_str]["body_battery"] == 72
    assert bio_by_date[yesterday_str]["training_readiness"] == 81

    assert today_str in bio_by_date, f"Missing today row in {bio_by_date}"
    assert bio_by_date[today_str]["sleep_score"] == 84
    # GarminSyncService writes 'garmin_oauth', MND bridge later normalizes via garmin_sync_mode ('oauth')
    assert bio_by_date[today_str]["source"] in ("oauth", "garmin_oauth")

    mnd_svc = mnd_sync_service.MyNetDiarySyncService()
    with state_store.state_lock(str(ISOLATED_LIVE_STATE_PATH)):
        mnd_svc._update_live_state_locked(
            totals={"calories": 1850, "protein": 170, "carbs": 190, "fat": 55},
            meals={},
            target_date_str=today_str,
        )

    with closing(db.get_connection()) as conn:
        nut_row = conn.execute(
            "SELECT date_str, calories, protein_g, carbs_g, fat_g FROM daily_nutrition_logs WHERE date_str = ?",
            (today_str,),
        ).fetchone()
    assert nut_row is not None
    assert nut_row["calories"] == 1850
    assert nut_row["protein_g"] == 170

    print("PASS [1] Schema & Midnight Rollover Persistence")


# ---------------------------------------------------------------------------
# [2] GET /api/analytics/summary
# ---------------------------------------------------------------------------
def _clear_analytics_tables_and_state() -> Dict[str, Any]:
    with closing(db.get_connection()) as conn:
        for tbl in (
            "renpho_history",
            "daily_nutrition_logs",
            "daily_biometrics",
            "workout_sessions",
            "manual_activities",
        ):
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
    state = _reset_live_state_from_seed()
    state["mnd_history"] = {"days": []}
    state.setdefault("garmin", {})["recent_activities"] = []
    state["garmin"]["today_activities"] = []
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))
    return state


def test_2_analytics_summary() -> None:
    now_uk = uk_now()
    today_dt = now_uk.date()
    today_str = today_dt.isoformat()

    # 2a. Sparse test
    _clear_analytics_tables_and_state()
    status, _, data = asgi_json("GET", "/api/analytics/summary")
    assert status == 200, f"Expected 200, got {status}: {data}"
    assert data["adaptive_tdee"]["status"] == "insufficient_data"
    assert data["adaptive_tdee"]["span_days"] == 0
    assert data["overreaching"]["status"] == "calibrating"

    # 2b. Ready OLS TDEE excluding today + zero-variance guard
    _clear_analytics_tables_and_state()
    renpho_items = []
    for offset, wt in [(8, 100.0), (6, 99.9), (4, 99.8), (2, 99.7), (0, 99.6)]:
        d = today_dt - timedelta(days=offset)
        ts = int(datetime(d.year, d.month, d.day, 8, 0, tzinfo=UK_TZ).timestamp())
        renpho_items.append({"id": f"w_{offset}", "timestamp": ts, "weight_kg": wt})
    db.upsert_renpho_measurements(renpho_items)

    for offset in range(1, 8):
        d_str = (today_dt - timedelta(days=offset)).isoformat()
        db.upsert_daily_nutrition(d_str, calories=2100, protein_g=180, carbs_g=200, fat_g=60, source="mnd")
    db.upsert_daily_nutrition(today_str, calories=450, protein_g=40, carbs_g=30, fat_g=10, source="mnd")

    status, _, data = asgi_json("GET", "/api/analytics/summary")
    assert status == 200
    tdee = data["adaptive_tdee"]
    assert tdee["status"] == "ready", f"Expected ready TDEE, got {tdee}"
    assert tdee["avg_intake_kcal"] == 2100, f"Today's 450 kcal leaked into avg: {tdee}"
    assert tdee["weight_trend_kg_per_week"] == -0.35
    assert tdee["estimated_tdee"] == 2485
    assert tdee["recommended_recomp_target"] == 2135

    same_day_rows = [
        {"timestamp": int(datetime(today_dt.year, today_dt.month, today_dt.day, h, 0, tzinfo=UK_TZ).timestamp()), "weight_kg": 99.5 + h * 0.05}
        for h in (7, 8, 9, 10)
    ]
    same_day_nut = [
        {"date_str": (today_dt - timedelta(days=offset)).isoformat(), "calories": 2100}
        for offset in range(1, 7)
    ]
    zv_res = analytics_service.compute_adaptive_tdee({}, same_day_rows, same_day_nut, today_str)
    assert zv_res["status"] == "insufficient_data"

    # 2c. ACWR normalized days 14-27, dedup vs two-a-day, bridge filter, strain markers
    d20 = (today_dt - timedelta(days=20)).isoformat()
    d2 = (today_dt - timedelta(days=2)).isoformat()
    d1 = (today_dt - timedelta(days=1)).isoformat()

    # Normalized days 14-27 (inclusive 21-day span across [today - 20d, today])
    state_norm = {
        "garmin": {
            "recent_activities": [
                {"date": f"{d20} 10:00:00", "calories": 600, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d2} 10:00:00", "calories": 400, "name": "Row", "source": "garmin_oauth"},
            ]
        }
    }
    res_norm = analytics_service.compute_acwr_overreaching(state_norm, [], [], [], today_str=today_str)
    expected_chronic = round(1000.0 / (21.0 / 7.0), 1)
    assert res_norm["span_days"] == 21
    assert res_norm["chronic_weekly_avg"] == expected_chronic, (
        f"Expected {expected_chronic}, got {res_norm['chronic_weekly_avg']}"
    )

    # Dedup Garmin (priority=2, 10:00:00, 400) + workout_session (priority=0, 10:15:00, 395) -> 400 kcal
    state_dedup = {
        "garmin": {
            "recent_activities": [
                {"date": f"{d20} 10:00:00", "calories": 500, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d2} 10:00:00", "calories": 400, "name": "Strength", "source": "garmin_oauth"},
            ]
        }
    }
    sess_dedup = [
        {"timestamp": f"{d2}T10:15:00", "date_str": d2, "calories": 395, "payload": {"title": "Strength"}}
    ]
    res_dedup = analytics_service.compute_acwr_overreaching(state_dedup, sess_dedup, [], [], today_str=today_str)
    assert res_dedup["acute_7d_load"] == 400.0, f"Expected deduped 400.0, got {res_dedup['acute_7d_load']}"

    # Two-a-day (>2h apart: 08:00 and 19:00) keeps BOTH -> 795 kcal
    state_two = {
        "garmin": {
            "recent_activities": [
                {"date": f"{d20} 10:00:00", "calories": 500, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d2} 08:00:00", "calories": 400, "name": "Morning Run", "source": "garmin_oauth"},
            ]
        }
    }
    sess_two = [
        {"timestamp": f"{d2}T19:00:00", "date_str": d2, "calories": 395, "payload": {"title": "Evening Lift"}}
    ]
    res_two = analytics_service.compute_acwr_overreaching(state_two, sess_two, [], [], today_str=today_str)
    assert res_two["acute_7d_load"] == 795.0, f"Expected 795.0 for two-a-day, got {res_two['acute_7d_load']}"

    # Synthetic bridge card excluded
    state_bridge = {
        "garmin": {
            "recent_activities": [
                {"date": f"{d20} 10:00:00", "calories": 500, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d2} 08:00:00", "calories": 400, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d1} 23:59:00", "calories": 500, "name": "Daily Steps & Activity", "source": "garmin_via_mnd_bridge"},
            ]
        }
    }
    res_bridge = analytics_service.compute_acwr_overreaching(state_bridge, [], [], [], today_str=today_str)
    assert res_bridge["acute_7d_load"] == 400.0, f"Synthetic bridge leaked: {res_bridge['acute_7d_load']}"

    # Acute spike (1.30 <= acwr < 1.45) + body_battery=30 -> deload_recommended with fatigued_markers
    d14 = (today_dt - timedelta(days=14)).isoformat()
    state_strain = {
        "garmin": {
            "body_battery": 30,
            "recent_activities": [
                {"date": f"{d20} 10:00:00", "calories": 400, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d14} 10:00:00", "calories": 400, "name": "Run", "source": "garmin_oauth"},
                {"date": f"{d2} 10:00:00", "calories": 700, "name": "Long Run", "source": "garmin_oauth"},
            ],
        }
    }
    res_strain = analytics_service.compute_acwr_overreaching(state_strain, [], [], [], today_str=today_str)
    assert res_strain["acwr"] is not None and 1.30 <= res_strain["acwr"] < 1.45, res_strain
    assert res_strain["status"] == "deload_recommended", res_strain
    assert len(res_strain["fatigued_markers"]) > 0, res_strain

    # 2d. Per-source freshness
    state_fresh = _clear_analytics_tables_and_state()
    state_fresh["last_synced"] = now_uk.isoformat()
    state_fresh.pop("mnd_last_synced", None)
    if isinstance(state_fresh.get("mnd_logged"), dict):
        state_fresh["mnd_logged"].pop("last_pulled", None)
    renpho_obj = state_fresh.setdefault("renpho", {})
    renpho_obj["last_checked"] = (now_uk - timedelta(minutes=2)).isoformat()
    renpho_obj["last_synced"] = (now_uk - timedelta(hours=36)).strftime("%Y-%m-%d %H:%M:%S")
    state_store.save_live_state(state_fresh, str(ISOLATED_LIVE_STATE_PATH))

    status, _, data = asgi_json("GET", "/api/analytics/summary")
    assert status == 200
    sf = data["sync_freshness"]
    assert sf["mnd"]["stale"] is True, sf
    assert sf["mnd"]["age_minutes"] is None, sf
    assert sf["renpho"]["stale"] is False, sf
    assert sf["renpho"]["weigh_in_age_hours"] is not None and sf["renpho"]["weigh_in_age_hours"] >= 35.5, sf

    print("PASS [2] GET /api/analytics/summary")


# ---------------------------------------------------------------------------
# [3] app_logged_meals Additive Overlay
# ---------------------------------------------------------------------------
def test_3_app_logged_meals_overlay() -> None:
    _clear_analytics_tables_and_state()
    today_str = uk_now().date().isoformat()

    item_name = "Casein Shake + Skim Milk"
    payload = {
        "date": today_str,
        "totals": {"calories": 1700, "protein": 140, "carbs": 160, "fat": 50},
        "meals": {
            "snacks": {
                "name": "Snacks",
                "time": "",
                "calories": 230,
                "protein": 34,
                "carbs": 18,
                "fat": 2,
                "items": [{"name": item_name, "cals": 230, "p": 34, "c": 18, "f": 2}],
            }
        },
        "logged_item": {"id": "casein_milk", "name": item_name, "cals": 230, "p": 34, "c": 18, "f": 2},
        "meal_category": "snacks",
    }
    status, _, resp = asgi_json("POST", "/api/mnd/manual", json_body=payload)
    assert status == 200, f"POST /api/mnd/manual failed: {status} {resp}"
    app_logged = resp["state"].get("app_logged_meals", {})
    assert today_str in app_logged and any(it.get("name") == item_name for it in app_logged[today_str])

    with closing(db.get_connection()) as conn:
        nut_row = conn.execute(
            "SELECT calories, protein_g FROM daily_nutrition_logs WHERE date_str = ?", (today_str,)
        ).fetchone()
    assert nut_row is not None and nut_row["calories"] == 1700

    # Cloud sync without the item -> additive overlay adds 230 kcal / 34p -> 1700 / 140
    mnd_svc = mnd_sync_service.MyNetDiarySyncService()
    with state_store.state_lock(str(ISOLATED_LIVE_STATE_PATH)):
        merged_state = mnd_svc._update_live_state_locked(
            totals={"calories": 1470, "protein": 106, "carbs": 142, "fat": 48},
            meals={
                "snacks": {
                    "name": "Snacks",
                    "time": "",
                    "calories": 0,
                    "protein": 0,
                    "carbs": 0,
                    "fat": 0,
                    "items": [],
                }
            },
            target_date_str=today_str,
        )
    assert merged_state["mnd_logged"]["calories"] == 1700
    assert merged_state["mnd_logged"]["protein_g"] == 140
    snack_items = merged_state["mnd_meals"]["snacks"]["items"]
    assert any(it.get("name") == item_name for it in snack_items)

    # Cloud sync ALREADY includes the item -> NOT double-counted
    with state_store.state_lock(str(ISOLATED_LIVE_STATE_PATH)):
        dedup_state = mnd_svc._update_live_state_locked(
            totals={"calories": 1700, "protein": 140, "carbs": 160, "fat": 50},
            meals={
                "snacks": {
                    "name": "Snacks",
                    "time": "",
                    "calories": 230,
                    "protein": 34,
                    "carbs": 18,
                    "fat": 2,
                    "items": [{"name": item_name, "cals": 230, "p": 34, "c": 18, "f": 2}],
                }
            },
            target_date_str=today_str,
        )
    assert dedup_state["mnd_logged"]["calories"] == 1700
    assert len(dedup_state["mnd_meals"]["snacks"]["items"]) == 1

    print("PASS [3] app_logged_meals Additive Overlay")


# ---------------------------------------------------------------------------
# [4] POST /api/sync_set Live e1RM PRs
# ---------------------------------------------------------------------------
def test_4_sync_set_live_e1rm_prs() -> None:
    state = _reset_live_state_from_seed()
    state.setdefault("strength_prescriptions", {})["barbell_floor_press"] = {
        "weight": 65,
        "reps": 6,
        "e1rm": 78.0,
    }
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))

    with closing(db.get_connection()) as conn:
        conn.execute("DELETE FROM strength_logs WHERE exercise_id = ?", ("barbell_floor_press",))
        conn.commit()

    # Equal to seeded 78.0 -> NOT a PR
    st, _, r1 = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={
            "exercise_id": "barbell_floor_press",
            "target_weight": 65,
            "target_reps": 6,
            "logged_weight": 65,
            "logged_reps": 6,
        },
    )
    assert st == 200
    assert r1["result"]["is_pr"] is False
    assert r1["result"]["prev_best_e1rm"] == 78.0

    # 70 x 8 (88.7) -> IS a PR over 78.0
    st, _, r2 = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={
            "exercise_id": "barbell_floor_press",
            "target_weight": 70,
            "target_reps": 6,
            "logged_weight": 70,
            "logged_reps": 8,
        },
    )
    assert st == 200
    assert r2["result"]["is_pr"] is True
    assert r2["result"]["prev_best_e1rm"] == 78.0

    # 60 x 5 (70.0) -> NOT a PR, prev_best_e1rm == 88.7
    st, _, r3 = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={
            "exercise_id": "barbell_floor_press",
            "target_weight": 65,
            "target_reps": 6,
            "logged_weight": 60,
            "logged_reps": 5,
        },
    )
    assert st == 200
    assert r3["result"]["is_pr"] is False
    assert r3["result"]["prev_best_e1rm"] == 88.7

    # Non-numeric "Body" x 15 resets PR status (200); out-of-range 600 x 5 rejects with 422
    st, _, r_edge = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={
            "exercise_id": "barbell_floor_press",
            "target_weight": "Body",
            "target_reps": 15,
            "logged_weight": "Body",
            "logged_reps": 15,
        },
    )
    assert st == 200
    assert r_edge["result"]["is_pr"] is False
    assert r_edge["result"]["prev_best_e1rm"] is None

    st_oob, _, _ = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={
            "exercise_id": "barbell_floor_press",
            "target_weight": 600,
            "target_reps": 5,
            "logged_weight": 600,
            "logged_reps": 5,
        },
    )
    assert st_oob == 422, f"Expected 422 for out-of-range weight 600 kg, got {st_oob}"

    print("PASS [4] POST /api/sync_set Live e1RM PRs")


# ---------------------------------------------------------------------------
# [5] GET/POST /api/preferences/state LWW Merge & Validation
# ---------------------------------------------------------------------------
def test_5_preferences_lww_and_validation() -> None:
    _reset_live_state_from_seed()
    with closing(db.get_connection()) as conn:
        conn.execute("DELETE FROM kv_store WHERE key = 'client_preferences_v1'")
        conn.commit()

    # 1) Set goal_key='aerobic' @ 2000
    st, _, res1 = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={"fields": {"goal_key": {"value": "aerobic", "updated_at_ms": 2000}}},
    )
    assert st == 200, res1
    assert res1["field_resolutions"]["goal_key"] == "accepted"
    saved_state = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    assert saved_state["nutrition"]["base_calorie_target"] == 2200
    assert saved_state["nutrition"]["base_protein_target_g"] == 200

    # 2) Set fasting_protocol='18_6' @ 2500
    st, _, res2 = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={"fields": {"fasting_protocol": {"value": "18_6", "updated_at_ms": 2500}}},
    )
    assert st == 200, res2

    # 3) Stale goal_key @ 1000 + newer diet_strategy @ 3000 -> 200 partial LWW
    st, _, res3 = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={
            "fields": {
                "goal_key": {"value": "recomp", "updated_at_ms": 1000},
                "diet_strategy": {"value": "lowcarb", "updated_at_ms": 3000},
            }
        },
    )
    assert st == 200, res3
    assert res3["field_resolutions"] == {"goal_key": "server_newer", "diet_strategy": "accepted"}

    # 4) GET verifies merged state
    st, _, got = asgi_json("GET", "/api/preferences/state")
    assert st == 200
    fields = got["preferences"]["fields"]
    assert fields["goal_key"]["value"] == "aerobic"
    assert fields["fasting_protocol"]["value"] == "18_6"
    assert fields["diet_strategy"]["value"] == "lowcarb"

    # 5) Validation 422s
    st, _, _ = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={"fields": {"unknown_pref_key": {"value": "x", "updated_at_ms": 4000}}},
    )
    assert st == 422, f"Expected 422 for unknown key, got {st}"

    st, _, _ = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={"fields": {"goal_key": {"value": "x" * 41, "updated_at_ms": 4000}}},
    )
    assert st == 422, f"Expected 422 for >40 char goal_key, got {st}"

    st, _, _ = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={
            "fields": {
                "equipment_profile": {
                    "value": {"blob": "a" * 70000},
                    "updated_at_ms": 4000,
                }
            }
        },
    )
    assert st == 422, f"Expected 422 for >65536 byte payload, got {st}"

    print("PASS [5] GET/POST /api/preferences/state LWW Merge & Validation")


# ---------------------------------------------------------------------------
# [6] GZipMiddleware & Cache Headers
# ---------------------------------------------------------------------------
def test_6_gzip_and_cache_headers() -> None:
    state_js_path = REPO_ROOT / "backend" / "static" / "js" / "state.js"
    assert state_js_path.exists(), f"Missing static file: {state_js_path}"
    expected_bytes = state_js_path.read_bytes()

    st, hdrs, body = asgi_request(
        "GET",
        "/js/state.js?v=6.0",
        headers=[("accept-encoding", "gzip")],
        auth=False,
    )
    assert st == 200, f"GET /js/state.js?v=6.0 returned {st}"
    assert hdrs.get("content-encoding") == "gzip", hdrs
    assert hdrs.get("cache-control") == "public, max-age=31536000, immutable", hdrs
    assert gzip.decompress(body) == expected_bytes

    st_idx, hdrs_idx, _ = asgi_request("GET", "/index.html", auth=False)
    assert st_idx == 200
    assert "no-cache, no-store, must-revalidate" in hdrs_idx.get("cache-control", ""), hdrs_idx

    st_ls, hdrs_ls, _ = asgi_request("GET", "/api/live_state", auth=True)
    assert st_ls == 200
    assert "no-cache, no-store, must-revalidate" in hdrs_ls.get("cache-control", ""), hdrs_ls

    print("PASS [6] GZipMiddleware & Cache Headers")


def run_all() -> None:
    try:
        test_1_schema_and_midnight_rollover()
        test_2_analytics_summary()
        test_3_app_logged_meals_overlay()
        test_4_sync_set_live_e1rm_prs()
        test_5_preferences_lww_and_validation()
        test_6_gzip_and_cache_headers()
        print("ALL 6 SUITES PASSED")
    finally:
        gc.collect()
        _TMP_DIR_OBJ.cleanup()


if __name__ == "__main__":
    run_all()
