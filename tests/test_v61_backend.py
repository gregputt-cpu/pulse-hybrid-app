import asyncio
import atexit
import contextlib
import json
import math
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_LIVE_STATE_PATH = REPO_ROOT / "backend" / "live_state.json"
ROOT_SEED_LIVE_STATE_PATH = REPO_ROOT / "live_state.json"

# ---------------------------------------------------------------------------
# Environment Isolation (MUST execute BEFORE importing backend modules)
# ---------------------------------------------------------------------------
_TMP_DIR_OBJ = tempfile.TemporaryDirectory(prefix="pulse_v61_be_")
TMP_DIR = Path(_TMP_DIR_OBJ.name).resolve()
DATA_DIR = TMP_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ISOLATED_LIVE_STATE_PATH = DATA_DIR / "live_state.json"
shutil.copy2(SEED_LIVE_STATE_PATH, ISOLATED_LIVE_STATE_PATH)

os.environ["DATA_DIR"] = str(DATA_DIR)
os.environ["LIVE_STATE_PATH"] = str(ISOLATED_LIVE_STATE_PATH)
os.environ["GARMIN_TOKEN_DIR"] = str(DATA_DIR / "garmin_tokens")
os.environ["MND_TOKEN_DIR"] = str(DATA_DIR / "mnd_tokens")
os.environ["RENPHO_CREDS_FILE"] = str(DATA_DIR / "renpho_creds.json")
os.environ["PULSE_API_SECRET"] = "test-secret-v61"
os.environ.pop("RAILWAY_ENVIRONMENT", None)
os.environ.pop("ARTIFACT_LIVE_STATE_PATH", None)


def _cleanup_tmp() -> None:
    try:
        _TMP_DIR_OBJ.cleanup()
    except Exception:
        pass


atexit.register(_cleanup_tmp)

sys.path.insert(0, str(REPO_ROOT / "backend"))

import state_store  # noqa: E402
import time_utils  # noqa: E402
import db  # noqa: E402
import analytics_service  # noqa: E402
import benefits_engine  # noqa: E402
import garmin_sync_service  # noqa: E402
import mnd_sync_service  # noqa: E402
import renpho_sync_service  # noqa: E402
import main  # noqa: E402
from garminconnect import GarminConnectAuthenticationError  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from time_utils import UK_TZ, uk_now, uk_today_str  # noqa: E402


def _assert_inside_tmp(path_str: str, label: str) -> None:
    resolved = Path(path_str).resolve()
    assert resolved.is_relative_to(TMP_DIR), (
        f"{label} resolved outside TMP_DIR: {resolved} (expected under {TMP_DIR})"
    )


_assert_inside_tmp(db.DB_PATH, "db.DB_PATH")
_assert_inside_tmp(main.LIVE_STATE_PATH, "main.LIVE_STATE_PATH")
_assert_inside_tmp(garmin_sync_service.LIVE_STATE_PATH, "garmin_sync_service.LIVE_STATE_PATH")
_assert_inside_tmp(garmin_sync_service.TOKEN_DIR, "garmin_sync_service.TOKEN_DIR")
_assert_inside_tmp(mnd_sync_service.LIVE_STATE_PATH, "mnd_sync_service.LIVE_STATE_PATH")
_assert_inside_tmp(mnd_sync_service.MND_DIR, "mnd_sync_service.MND_DIR")
_assert_inside_tmp(renpho_sync_service.LIVE_STATE_PATH, "renpho_sync_service.LIVE_STATE_PATH")
_assert_inside_tmp(renpho_sync_service.CREDS_FILE, "renpho_sync_service.CREDS_FILE")


# ---------------------------------------------------------------------------
# Compact Async ASGI Test Helper (exercises full FastAPI app stack)
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
        req_headers.append((b"authorization", b"Bearer test-secret-v61"))
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
    raw_body: Optional[bytes] = None,
    headers: Optional[List[Tuple[str, str]]] = None,
    auth: bool = True,
) -> Tuple[int, Dict[str, str], Any]:
    status, resp_headers, body = asgi_request(
        method, url_path, json_body=json_body, raw_body=raw_body, headers=headers, auth=auth
    )
    parsed = json.loads(body.decode("utf-8")) if body else None
    return status, resp_headers, parsed


def _reset_env_state() -> Dict[str, Any]:
    db.init_db(force=True)
    with closing(db.get_connection()) as conn:
        for tbl in (
            "renpho_history",
            "strength_logs",
            "hydration_logs",
            "kv_store",
            "workout_sessions",
            "manual_activities",
            "daily_biometrics",
            "daily_nutrition_logs",
        ):
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
    with open(SEED_LIVE_STATE_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    state_store.save_live_state(seed, str(ISOLATED_LIVE_STATE_PATH))
    if os.path.exists(mnd_sync_service.HISTORY_CACHE_FILE):
        os.remove(mnd_sync_service.HISTORY_CACHE_FILE)
    return seed


# ---------------------------------------------------------------------------
# [1] Storage & DB Recovery
# ---------------------------------------------------------------------------
def test_1_storage_and_db_recovery() -> None:
    _reset_env_state()
    expected_backend_data = os.path.abspath(os.path.join(state_store.BACKEND_DIR, "data"))

    # 1. get_data_dir() unset / "" -> <backend>/data
    real_isdir = os.path.isdir
    with patch("state_store.os.path.isdir", side_effect=lambda p: False if p == "/data" else real_isdir(p)):
        env_without_data = {k: v for k, v in os.environ.items() if k != "DATA_DIR"}
        with patch.dict(os.environ, env_without_data, clear=True):
            assert os.path.abspath(state_store.get_data_dir()) == expected_backend_data
        with patch.dict(os.environ, {"DATA_DIR": ""}, clear=False):
            assert os.path.abspath(state_store.get_data_dir()) == expected_backend_data
        with patch.dict(os.environ, {"DATA_DIR": "   "}, clear=False):
            assert os.path.abspath(state_store.get_data_dir()) == expected_backend_data

    # 2. Zero ARTIFACT_LIVE_STATE_PATH anywhere in storage/sync/main modules
    for mod in (state_store, garmin_sync_service, mnd_sync_service, renpho_sync_service, main):
        assert not hasattr(mod, "ARTIFACT_LIVE_STATE_PATH"), f"{mod.__name__} still defines ARTIFACT_LIVE_STATE_PATH"
    for rel in ("backend/state_store.py", "backend/garmin_sync_service.py", "backend/mnd_sync_service.py"):
        src = (REPO_ROOT / rel).read_text(encoding="utf-8")
        assert "ARTIFACT_LIVE_STATE_PATH" not in src, f"ARTIFACT_LIVE_STATE_PATH found in {rel}"

    # 3. os.replace() 3x retry on PermissionError
    retry_target = TMP_DIR / "retry_state.json"
    real_replace = os.replace
    attempts = {"count": 0}

    def _flaky_replace(src: str, dst: str) -> None:
        attempts["count"] += 1
        if attempts["count"] <= 3:
            raise PermissionError(f"Transient lock #{attempts['count']}")
        real_replace(src, dst)

    with patch("state_store.os.replace", side_effect=_flaky_replace), patch("state_store.time.sleep") as mock_sleep:
        state_store._atomic_write_json(str(retry_target), {"ok": True, "n": 42})
    assert attempts["count"] == 4
    assert [c.args[0] for c in mock_sleep.call_args_list] == [0.05, 0.1, 0.2]
    assert json.loads(retry_target.read_text(encoding="utf-8")) == {"ok": True, "n": 42}

    with patch("state_store.os.replace", side_effect=PermissionError("always locked")), patch("state_store.time.sleep"):
        raised = False
        try:
            state_store._atomic_write_json(str(retry_target), {"ok": False})
        except PermissionError:
            raised = True
        assert raised, "Expected PermissionError after exhausting retries"

    # 4. .bak healing for missing, 0-byte, and corrupt primary files
    heal_target = TMP_DIR / "heal_state.json"
    heal_bak = Path(f"{heal_target}.bak")
    payload_v1 = {"date": "2026-11-20", "marker": "from_bak"}
    state_store.save_live_state(payload_v1, str(heal_target))
    assert heal_target.exists() and heal_bak.exists()

    # Missing primary
    heal_target.unlink()
    recovered = state_store.load_live_state(str(heal_target))
    assert recovered == payload_v1
    assert heal_target.exists() and json.loads(heal_target.read_text(encoding="utf-8")) == payload_v1

    # 0-byte primary
    heal_target.write_bytes(b"")
    recovered = state_store.load_live_state(str(heal_target))
    assert recovered == payload_v1
    assert heal_target.stat().st_size > 0 and json.loads(heal_target.read_text(encoding="utf-8")) == payload_v1

    # Corrupt primary + ensure_live_state_seeded prefers .bak over DEFAULT_STATE_PATH
    heal_target.write_text("{corrupt_json", encoding="utf-8")
    assert state_store.ensure_live_state_seeded(str(heal_target)) is True
    assert json.loads(heal_target.read_text(encoding="utf-8")) == payload_v1

    # 5. allow_nan=False & _reject_non_finite_json()
    for bad_val in (float("nan"), float("inf"), float("-inf")):
        nan_failed = False
        try:
            state_store._atomic_write_json(str(TMP_DIR / "nan.json"), {"x": bad_val})
        except ValueError:
            nan_failed = True
        assert nan_failed, f"allow_nan=False should reject {bad_val}"

        http_failed = False
        try:
            main._reject_non_finite_json({"nested": [1, {"v": bad_val}]})
        except HTTPException as exc:
            http_failed = exc.status_code == 422
        assert http_failed, f"_reject_non_finite_json should raise 422 for {bad_val}"

    # 6. db.get_connection() raw connection vs internal helper closing
    raw_conn = db.get_connection()
    assert isinstance(raw_conn, sqlite3.Connection)
    raw_conn.execute("SELECT 1").fetchone()
    db.get_renpho_history(days=7, conn=raw_conn)
    # Caller-supplied conn remains open
    raw_conn.execute("SELECT 1").fetchone()
    raw_conn.close()

    closed_flags: List[bool] = []
    real_get_conn = db.get_connection

    class _TrackedConn:
        def __init__(self, inner: sqlite3.Connection) -> None:
            self._inner = inner
            self.closed = False

        def close(self) -> None:
            self.closed = True
            closed_flags.append(True)
            self._inner.close()

        def __getattr__(self, name: str) -> Any:
            return getattr(self._inner, name)

    with patch("db.get_connection", side_effect=lambda: _TrackedConn(real_get_conn())):
        db.set_kv("v61_conn_test", "ok")
        assert db.get_kv("v61_conn_test") == "ok"
    assert len(closed_flags) == 2 and all(closed_flags)

    # 7. backend/renpho_seed.json auto-seed removed
    db_src = (REPO_ROOT / "backend" / "db.py").read_text(encoding="utf-8")
    assert "renpho_seed.json" not in db_src
    assert db.get_renpho_history(days=90) == []

    # 8. get_workout_sessions() / get_manual_activities() corrupt JSON skip
    today_iso = uk_now().isoformat()
    with closing(db.get_connection()) as conn:
        conn.execute(
            "INSERT INTO workout_sessions (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (today_iso, "Upper", "recomp", 4, 12, 320, json.dumps({"ok": True})),
        )
        conn.execute(
            "INSERT INTO workout_sessions (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (today_iso, "Bad", "recomp", 1, 1, 50, "{not-json"),
        )
        conn.execute(
            "INSERT INTO workout_sessions (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (today_iso, "List", "recomp", 1, 1, 50, "[1, 2, 3]"),
        )
        conn.execute(
            "INSERT INTO manual_activities (id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("act_good", today_iso, "Run", "Easy", 30.0, 300, 140, 160, json.dumps({"source": "manual_app_entry"})),
        )
        conn.execute(
            "INSERT INTO manual_activities (id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("act_bad", today_iso, "Bad", "Bad", 10.0, 100, 120, 140, "{broken"),
        )
        conn.commit()

    sessions = db.get_workout_sessions(days=30)
    assert len(sessions) == 1 and sessions[0]["preset"] == "Upper" and sessions[0]["payload"] == {"ok": True}
    acts = db.get_manual_activities(days=30)
    assert len(acts) == 1 and acts[0]["id"] == "act_good"

    print("PASS [1] Storage & DB Recovery")


# ---------------------------------------------------------------------------
# [2] Renpho & Time Helpers
# ---------------------------------------------------------------------------
def test_2_renpho_and_time_helpers() -> None:
    _reset_env_state()

    # 1. uk_timestamp_str() ms epoch detection (> 1e11)
    assert time_utils.uk_timestamp_str(1700000000) == "2023-11-14 22:13:20"
    assert time_utils.uk_timestamp_str(1700000000000) == "2023-11-14 22:13:20"
    try:
        time_utils.uk_timestamp_str(True)
        raise AssertionError("Expected ValueError for bool timestamp")
    except ValueError:
        pass

    # 2. _insert_renpho_records UTC+08:00 localCreatedAt -> UK conversion & ms epoch
    with closing(db.get_connection()) as conn:
        inserted = db._insert_renpho_records(
            conn,
            [
                {"id": "cn_summer", "localCreatedAt": "2026-07-15 16:30:00", "weight": 89.4, "bodyfat": 16.5},
                {"id": "cn_winter", "localCreatedAt": "2026-01-15 16:30:00", "weight": 91.2},
                {"id": "ms_row", "timeStamp": 1700000000000, "weight": 92.0},
                {"id": "bad_no_ts", "weight": 90.0},
            ],
        )
        assert inserted == 3
        rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM renpho_history").fetchall()}

    # 16:30 UTC+08:00 -> 09:30 BST (UTC+01:00) in July, 08:30 GMT (UTC+00:00) in Jan
    assert rows["cn_summer"]["date_str"] == "2026-07-15 09:30:00"
    assert rows["cn_winter"]["date_str"] == "2026-01-15 08:30:00"
    assert rows["ms_row"]["timestamp"] == 1700000000
    assert rows["ms_row"]["date_str"] == "2023-11-14 22:13:20"
    assert "bad_no_ts" not in rows

    # 3. get_renpho_history() same-day averaging over 7 calendar days [d - 6d, d]
    with closing(db.get_connection()) as conn:
        conn.execute("DELETE FROM renpho_history")
        conn.commit()
    today_d = uk_now().date()
    d_m8 = today_d - timedelta(days=8)
    d_m6 = today_d - timedelta(days=6)
    d_m1 = today_d - timedelta(days=1)

    def _noon_ts(d_obj: Any, hour: int = 12) -> int:
        return int(datetime(d_obj.year, d_obj.month, d_obj.day, hour, 0, 0, tzinfo=UK_TZ).timestamp())

    db.upsert_renpho_measurements([
        {"id": "d_m8", "timeStamp": _noon_ts(d_m8), "weight": 80.0, "bodyfat": 15.0},
        {"id": "d_m6", "timeStamp": _noon_ts(d_m6), "weight": 88.0, "bodyfat": None},
        {"id": "d_m1_a", "timeStamp": _noon_ts(d_m1, 8), "weight": 90.0, "bodyfat": 20.0},
        {"id": "d_m1_b", "timeStamp": _noon_ts(d_m1, 18), "weight": 92.0, "bodyfat": 22.0},
    ])
    hist = db.get_renpho_history(days=14)
    assert len(hist) == 3, hist
    latest = hist[-1]
    assert latest["weight_kg"] == 91.0
    assert latest["body_fat_pct"] == 21.0
    # 7d window for (today - 1d) includes d_m6 and d_m1, excludes d_m8 ((d_m1 - d_m8).days == 7 > 6)
    assert latest["7d_avg_weight"] == 89.5, latest
    assert latest["7d_avg_bf"] == 21.0, latest

    # 4. Single shared time_utils.parse_uk_ts() parser
    assert db._parse_uk_ts is time_utils.parse_uk_ts
    assert analytics_service.parse_uk_datetime is time_utils.parse_uk_ts
    assert time_utils.parse_uk_ts(None) is None
    assert time_utils.parse_uk_ts(True) is None
    assert time_utils.parse_uk_ts("") is None
    assert time_utils.parse_uk_ts(1700000000000) == time_utils.parse_uk_ts(1700000000)
    parsed_z = time_utils.parse_uk_ts("2026-07-15T08:30:00Z")
    assert parsed_z is not None and parsed_z.tzinfo == UK_TZ and parsed_z.hour == 9

    print("PASS [2] Renpho & Time Helpers")


# ---------------------------------------------------------------------------
# [3] Garmin Sync Service
# ---------------------------------------------------------------------------
def test_3_garmin_sync() -> None:
    _reset_env_state()
    today_str = uk_today_str()
    yesterday_str = (uk_now().date() - timedelta(days=1)).isoformat()

    # 1 & 2. Mocked 0.3.2 display_name on MFA & clearing oauth_failed_at on re-auth
    state = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    state.setdefault("garmin", {})["oauth_failed_at"] = "2026-11-19T10:00:00+00:00"
    state_store.save_live_state(state, str(ISOLATED_LIVE_STATE_PATH))

    svc = garmin_sync_service.GarminSyncService()
    mock_g_client = MagicMock()
    mock_g_client.display_name = None
    mock_g_client.login.return_value = ("needs_mfa", {"ticket": "t1"})
    mock_g_client.resume_login.return_value = None
    mock_g_client.client.connectapi.return_value = {"displayName": "PulseAthlete"}
    mock_g_client.client.dumps.return_value = json.dumps({"oauth": "tok"})

    with patch.object(garmin_sync_service, "Garmin", return_value=mock_g_client):
        mfa_prompt = svc.login_with_credentials("athlete@example.com", "pw")
        assert mfa_prompt.get("needs_mfa") is True

        mfa_res = svc.submit_mfa("654321")
        assert mfa_res.get("success") is True
        assert mock_g_client.display_name == "PulseAthlete"
        mock_g_client.client.connectapi.assert_called_with("/userprofile-service/socialProfile")

    after_mfa = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    assert after_mfa["garmin"]["oauth_failed_at"] is None

    # Also test direct non-MFA login clears oauth_failed_at
    after_mfa["garmin"]["oauth_failed_at"] = "2026-11-19T12:00:00+00:00"
    state_store.save_live_state(after_mfa, str(ISOLATED_LIVE_STATE_PATH))
    mock_direct = MagicMock()
    mock_direct.display_name = None
    mock_direct.login.return_value = True
    mock_direct.client.connectapi.return_value = {"displayName": "DirectAthlete"}
    mock_direct.client.dumps.return_value = json.dumps({"oauth": "tok2"})
    with patch.object(garmin_sync_service, "Garmin", return_value=mock_direct):
        login_res = svc.login_with_credentials("athlete@example.com", "pw")
        assert login_res.get("success") is True
        assert mock_direct.display_name == "DirectAthlete"
    assert state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["garmin"]["oauth_failed_at"] is None

    # 3. 5-domain partial outage preserves failed domains
    seed = _reset_env_state()
    seed["date"] = today_str
    seed["garmin"].update({
        "oauth_date": today_str,
        "metrics_date": today_str,
        "steps": 4000,
        "active_calories": 250,
        "sleep_score": 81,
        "body_battery": 74,
        "training_readiness": 77,
    })
    state_store.save_live_state(seed, str(ISOLATED_LIVE_STATE_PATH))

    partial_client = MagicMock()
    partial_client.display_name = "Pulse"
    partial_client.client.dumps.return_value = json.dumps({"oauth": "tok"})
    partial_client.get_user_summary.return_value = {"totalSteps": 6200, "activeKilocalories": 410}
    partial_client.get_activities_by_date.return_value = []
    partial_client.get_sleep_data.side_effect = RuntimeError("503 sleep down")
    partial_client.get_training_readiness.side_effect = RuntimeError("503 tr down")
    partial_client.get_morning_training_readiness.side_effect = RuntimeError("503 morning tr down")
    partial_client.get_body_battery.side_effect = RuntimeError("503 bb down")
    partial_client.get_stress_data.side_effect = RuntimeError("503 stress down")
    partial_client.get_body_battery_events.side_effect = RuntimeError("503 events down")
    partial_client.get_hrv_data.side_effect = RuntimeError("503 hrv down")

    svc2 = garmin_sync_service.GarminSyncService()
    svc2.client = partial_client
    partial_state = svc2.sync_today(target_date_str=today_str, force=True)
    assert partial_state["garmin"]["steps"] == 6200
    assert partial_state["garmin"]["active_calories"] == 410
    assert partial_state["garmin"]["sleep_score"] == 81
    assert partial_state["garmin"]["body_battery"] == 74
    assert partial_state["garmin"]["training_readiness"] == 77
    assert partial_state["garmin"].get("oauth_last_synced")
    assert not partial_state["garmin"].get("bridge_last_synced")

    # 4. Full outage (all 5 fail) leaves _last_sync_ts unchanged & preserves metrics
    svc2._last_sync_ts = 12345.0
    outage_client = MagicMock()
    outage_client.display_name = "Pulse"
    outage_client.get_user_summary.side_effect = RuntimeError("503 summary")
    outage_client.get_activities_by_date.side_effect = RuntimeError("503 acts")
    outage_client.get_activities.side_effect = RuntimeError("503 acts2")
    outage_client.get_sleep_data.side_effect = RuntimeError("503 sleep")
    outage_client.get_training_readiness.side_effect = RuntimeError("503 tr")
    outage_client.get_morning_training_readiness.side_effect = RuntimeError("503 mtr")
    outage_client.get_body_battery.side_effect = RuntimeError("503 bb")
    outage_client.get_stress_data.side_effect = RuntimeError("503 stress")
    outage_client.get_body_battery_events.side_effect = RuntimeError("503 bbe")
    outage_client.get_hrv_data.side_effect = RuntimeError("503 hrv")
    svc2.client = outage_client
    outage_res = svc2.sync_today(target_date_str=today_str, force=True)
    assert outage_res["success"] is False and outage_res["requires_auth"] is False
    assert svc2._last_sync_ts == 12345.0
    assert state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["garmin"]["steps"] == 6200

    # Auth full outage stamps oauth_failed_at & leaves _last_sync_ts unchanged
    outage_client.get_user_summary.side_effect = GarminConnectAuthenticationError("401 Unauthorized")
    auth_outage_res = svc2.sync_today(target_date_str=today_str, force=True)
    assert auth_outage_res["success"] is False and auth_outage_res["requires_auth"] is True
    assert svc2._last_sync_ts == 12345.0
    assert state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["garmin"]["oauth_failed_at"] is not None

    # 5. UK rollover clears garmin_state['mnd_logged'] & garmin_state['mnd_meals'] + root mnd_*
    roll_state = _reset_env_state()
    roll_state["date"] = yesterday_str
    roll_state["mnd_logged"] = {"date": yesterday_str, "calories": 1900}
    roll_state["mnd_meals"] = {"breakfast": {"calories": 500, "items": []}}
    roll_state["mnd_cloud_logged"] = {"date": yesterday_str, "calories": 1900}
    roll_state["mnd_cloud_meals"] = {"breakfast": {"calories": 500, "items": []}}
    roll_state["app_deleted_meals"] = {yesterday_str: [{"name": "Old", "cals": 100, "p": 5}]}
    roll_state["garmin"].update({
        "metrics_date": yesterday_str,
        "oauth_date": yesterday_str,
        "mnd_logged": {"date": yesterday_str, "calories": 1900},
        "mnd_meals": {"breakfast": {"calories": 500, "items": []}},
        "distance_miles": 4.2,
        "active_minutes": 55,
        "resting_hr": 50,
    })
    state_store.save_live_state(roll_state, str(ISOLATED_LIVE_STATE_PATH))

    ok_client = MagicMock()
    ok_client.display_name = "Pulse"
    ok_client.client.dumps.return_value = json.dumps({"oauth": "tok"})
    ok_client.get_user_summary.return_value = {"totalSteps": 1000}
    ok_client.get_activities_by_date.return_value = []
    ok_client.get_sleep_data.return_value = {}
    ok_client.get_training_readiness.return_value = []
    ok_client.get_morning_training_readiness.return_value = {}
    ok_client.get_body_battery.return_value = []
    ok_client.get_stress_data.return_value = {}
    ok_client.get_body_battery_events.return_value = []
    ok_client.get_hrv_data.return_value = {}

    svc3 = garmin_sync_service.GarminSyncService()
    svc3.client = ok_client
    rolled = svc3.sync_today(target_date_str=today_str, force=True)
    assert "mnd_logged" not in rolled["garmin"]
    assert "mnd_meals" not in rolled["garmin"]
    assert "mnd_logged" not in rolled
    assert "mnd_meals" not in rolled
    assert "mnd_cloud_logged" not in rolled
    assert "mnd_cloud_meals" not in rolled
    assert "app_deleted_meals" not in rolled

    # 6. oauth_last_synced vs bridge_last_synced isolation
    _reset_env_state()
    mnd_svc = mnd_sync_service.MyNetDiarySyncService()
    bridge_payload = {"steps": 3300, "active_calories": 180, "sleep_score": 76}
    bridged_state = mnd_svc._update_live_state(
        {"calories": 1200, "protein": 110, "carbs": 120, "fat": 35},
        {"breakfast": {"name": "Breakfast", "time": "08:00", "calories": 400, "protein": 30, "carbs": 40, "fat": 10, "items": []}},
        garmin_bridge=bridge_payload,
        target_date_str=today_str,
    )
    assert bridged_state["garmin"].get("bridge_last_synced")
    assert not bridged_state["garmin"].get("oauth_last_synced")
    assert bridged_state["garmin"]["garmin_sync_mode"] == "mnd_bridge"

    print("PASS [3] Garmin Sync Service")


# ---------------------------------------------------------------------------
# [4] MND & Renpho Sync Services
# ---------------------------------------------------------------------------
def test_4_mnd_and_renpho_sync() -> None:
    _reset_env_state()
    today_d = uk_now().date()
    today_str = today_d.isoformat()
    yesterday_str = (today_d - timedelta(days=1)).isoformat()
    d_m2 = (today_d - timedelta(days=2)).isoformat()

    mnd_svc = mnd_sync_service.MyNetDiarySyncService()
    assert hasattr(mnd_svc, "_sync_lock")
    assert hasattr(mnd_svc, "_history_backfill_lock")
    assert hasattr(mnd_svc, "_history_cache_lock")

    # 1. Deadlock-free _history_cache_lock + 2. Backfill >= 7200s throttle & auth abort
    mnd_svc._last_backfill_ts = time.time() - 60.0  # within 7200s
    with patch("mnd_sync_service.requests.Session") as mock_sess_cls:
        summary_throttled = mnd_svc.fetch_multi_day_history(end_date_str=today_str, days=5, force=False)
        assert mock_sess_cls.return_value.get.call_count == 0
        assert summary_throttled["end_date"] == today_str

    # Auth abort when >= 7200s elapsed and needLogon + ensure_authenticated fails
    mnd_svc._last_backfill_ts = time.time() - 7205.0
    need_logon_resp = MagicMock(status_code=200)
    need_logon_resp.json.return_value = {"needLogon": True}
    mock_local_sess = MagicMock()
    mock_local_sess.get.return_value = need_logon_resp
    with patch("mnd_sync_service.requests.Session", return_value=mock_local_sess), \
         patch.object(mnd_svc, "ensure_authenticated", return_value=(False, "expired")):
        mnd_svc.fetch_multi_day_history(end_date_str=today_str, days=5, force=False)
    assert mock_local_sess.get.call_count == 1
    assert (time.time() - mnd_svc._last_backfill_ts) >= 7200.0

    # Concurrent backfill cache write + state_lock read (verify no lock inversion deadlock)
    errors: List[Exception] = []
    ok_meal_resp = MagicMock(status_code=200)
    ok_meal_resp.json.return_value = {
        "meals": [
            {
                "mealTypeId": 1,
                "foodEntries": [
                    {"foodLabel": {"cleanFoodName": "Oats", "protein": {"values": {"rawValue": 20}}}, "calories": 350}
                ],
            }
        ]
    }
    mock_local_sess_ok = MagicMock()
    mock_local_sess_ok.get.return_value = ok_meal_resp

    def _hold_state_then_cache() -> None:
        try:
            with state_store.state_lock(str(ISOLATED_LIVE_STATE_PATH)):
                time.sleep(0.02)
                mnd_svc._load_history_cache(include_live_state=False)
        except Exception as exc:
            errors.append(exc)

    t = threading.Thread(target=_hold_state_then_cache)
    t.start()
    with patch("mnd_sync_service.requests.Session", return_value=mock_local_sess_ok):
        hist_res = mnd_svc.fetch_multi_day_history(end_date_str=today_str, days=3, force=True)
    t.join(timeout=3.0)
    assert not t.is_alive(), "Deadlock detected around _history_cache_lock"
    assert not errors, errors
    assert hist_res["window_days"] >= 1

    # 3. preserve_manual=True in SQLite and background MND pull
    db.upsert_daily_nutrition(yesterday_str, 2450, 195, 220, 75, source="manual")
    db.upsert_daily_nutrition(yesterday_str, 1500, 100, 150, 40, source="mnd", preserve_manual=True)
    nut_rows = {r["date_str"]: r for r in db.get_daily_nutrition(days=7)}
    assert nut_rows[yesterday_str]["calories"] == 2450
    assert nut_rows[yesterday_str]["source"] == "manual"

    # Non-manual row IS updated with preserve_manual=True
    db.upsert_daily_nutrition(d_m2, 1700, 140, 160, 50, source="mnd")
    db.upsert_daily_nutrition(d_m2, 1850, 155, 175, 55, source="mnd", preserve_manual=True)
    nut_rows2 = {r["date_str"]: r for r in db.get_daily_nutrition(days=7)}
    assert nut_rows2[d_m2]["calories"] == 1850

    # Today manual lock during background poll (force=False)
    st_manual = _reset_env_state()
    st_manual["date"] = today_str
    st_manual["mnd_logged"] = {"date": today_str, "calories": 2111, "protein_g": 185, "water_l": 2.4}
    state_store.save_live_state(st_manual, str(ISOLATED_LIVE_STATE_PATH))
    db.upsert_daily_nutrition(today_str, 2111, 185, 190, 60, source="manual")
    updated_bg = mnd_svc._update_live_state(
        {"calories": 900, "protein": 60, "carbs": 80, "fat": 20, "water": 1.0},
        {},
        target_date_str=today_str,
        force=False,
    )
    assert updated_bg["mnd_logged"]["calories"] == 2111
    assert updated_bg["mnd_logged"]["water_l"] == 2.4

    # 3b. Comma-formatted numbers (e.g. '1,168' kcal / mg sodium) in MND response
    assert mnd_sync_service._parse_mnd_float("1,168") == 1168.0
    assert mnd_sync_service._parse_mnd_float("1,234.5 mg") == 1234.5
    assert mnd_sync_service._parse_mnd_float(None, 0.0) == 0.0
    comma_meals_payload = {
        "meals": [
            {
                "mealTypeId": 1,
                "foodEntries": [
                    {
                        "calories": "1,168",
                        "foodLabel": {
                            "cleanFoodName": "High Protein Feast",
                            "protein": {"values": {"rawValue": "42.5"}},
                            "totalCarbs": {"values": {"rawValue": "1,020"}},
                            "totalFat": {"values": {"rawValue": "30"}},
                            "fiber": {"values": {"rawValue": "12"}},
                            "sodium": {"values": {"rawValue": "1,168"}},
                        },
                    }
                ],
            }
        ],
        "appleData": {"consumedCalories": "1,168"},
    }
    comma_totals, comma_meals = mnd_svc._parse_mnd_response(
        comma_meals_payload,
        {"totalSodium": "2,350", "water": "2.5"},
    )
    assert comma_totals["calories"] == 1168
    assert comma_totals["protein"] == 42
    assert comma_totals["carbs"] == 1020
    assert comma_totals["sodium"] == 2350
    assert comma_totals["water"] == 2.5
    assert comma_meals["breakfast"]["items"][0]["cals"] == 1168

    # 4. overwrite_nulls=True scoped to source='mnd_estimated'
    db.upsert_daily_biometrics(yesterday_str, sleep_score=78, resting_hr=52, body_battery=80, training_readiness=75, source="mnd_estimated")
    db.upsert_daily_biometrics(yesterday_str, sleep_score=None, resting_hr=49, body_battery=None, training_readiness=None, source="garmin_oauth", overwrite_nulls=True)
    bio_map = {r["date_str"]: r for r in db.get_daily_biometrics(days=7)}
    assert bio_map[yesterday_str]["sleep_score"] is None
    assert bio_map[yesterday_str]["body_battery"] is None
    assert bio_map[yesterday_str]["training_readiness"] is None
    assert bio_map[yesterday_str]["resting_hr"] == 49
    assert bio_map[yesterday_str]["source"] == "garmin_oauth"

    # Existing garmin_oauth row is NOT wiped by nulls even with overwrite_nulls=True
    db.upsert_daily_biometrics(yesterday_str, sleep_score=None, resting_hr=None, body_battery=None, training_readiness=None, source="garmin_oauth", overwrite_nulls=True)
    bio_map2 = {r["date_str"]: r for r in db.get_daily_biometrics(days=7)}
    assert bio_map2[yesterday_str]["resting_hr"] == 49

    # 5. 3-way scale precedence table + 6. Socks-on null BF%
    _reset_env_state()
    renpho_svc = renpho_sync_service.RenphoSyncService(email="test@example.com", password="pw")
    now_dt = uk_now().replace(microsecond=0)
    t_old = int((now_dt - timedelta(hours=3)).timestamp())
    t_mid = int((now_dt - timedelta(hours=1)).timestamp())
    t_new = int(now_dt.timestamp())

    def _mock_renpho_cloud(measurements: List[Dict[str, Any]]) -> MagicMock:
        c = MagicMock()
        c.get_all_measurements.return_value = measurements
        return c

    # (a) Unseeded socks-on reading (bodyfat=None) -> all 4 derived fields None
    renpho_svc.client = _mock_renpho_cloud([
        {"id": "r1", "timeStamp": t_mid, "weight": 90.0, "bodyfat": None}
    ])
    res_unseeded = renpho_svc.sync_latest(force=True)
    assert res_unseeded["success"] is True
    r_m = res_unseeded["metrics"]
    assert r_m["weight_kg"] == 90.0
    assert r_m["body_fat_pct"] is None
    assert r_m["lean_mass_kg"] is None
    assert r_m["target_weight_at_15pct"] is None
    assert r_m["fat_to_lose_kg"] is None
    assert r_m["bio_synced_at"] is None

    # (b) Barefoot reading seeds valid LBM & secondary metrics; then socks-on preserves LBM & computes 4 derived
    renpho_svc.client = _mock_renpho_cloud([
        {"id": "r2", "timeStamp": t_old, "weight": 90.0, "bodyfat": 20.0, "water": 58.5, "sinew": 68.0}
    ])
    # Wait: t_old < t_mid and existing is renpho_direct_cloud @ t_mid -> strictly older returns preserved_newer
    res_older = renpho_svc.sync_latest(force=True)
    assert res_older.get("preserved_newer") is True

    # Newer barefoot reading @ t_mid + 60s
    t_bf = t_mid + 60
    renpho_svc.client = _mock_renpho_cloud([
        {"id": "r3", "timeStamp": t_bf, "weight": 90.0, "bodyfat": 20.0, "water": 58.5, "sinew": 68.0}
    ])
    res_bf = renpho_svc.sync_latest(force=True)
    assert res_bf["metrics"]["lean_mass_kg"] == 72.0
    assert res_bf["metrics"]["body_fat_pct"] == 20.0
    bio_ts_saved = res_bf["metrics"]["bio_synced_at"]

    # Socks-on @ t_new preserves valid LBM (72.0) and bio_synced_at
    renpho_svc.client = _mock_renpho_cloud([
        {"id": "r4", "timeStamp": t_new, "weight": 88.0, "bodyfat": None}
    ])
    res_socks = renpho_svc.sync_latest(force=True)
    assert res_socks["metrics"]["weight_kg"] == 88.0
    assert res_socks["metrics"]["lean_mass_kg"] == 72.0
    assert res_socks["metrics"]["body_fat_pct"] == 18.2
    assert res_socks["metrics"]["bio_synced_at"] == bio_ts_saved
    assert res_socks["metrics"]["water_pct"] == 58.5

    # (c) manual_scale_entry @ T_now vs renpho_direct_cloud @ older -> manual preserved
    st_man, _, r_man = asgi_json("POST", "/api/renpho/manual", json_body={"weight_kg": 87.5})
    assert st_man == 200
    assert r_man["renpho"]["weight_source"] == "manual_scale_entry"
    renpho_svc.client = _mock_renpho_cloud([
        {"id": "r5", "timeStamp": t_mid, "weight": 89.9, "bodyfat": 19.0}
    ])
    res_man_kept = renpho_svc.sync_latest(force=True)
    assert res_man_kept.get("preserved_newer") is True
    assert state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["renpho"]["weight_kg"] == 87.5

    # (d) MND weight precedence: same-day protected source keeps existing; undated MND never writes; yesterday -> today MND writes
    mnd_svc._update_live_state(
        {"calories": 1000, "protein": 80, "carbs": 100, "fat": 30},
        {},
        weight_info={"currentWeight": 85.0, "lastWeighInStatement": "Weighed in today"},
        target_date_str=today_str,
    )
    assert state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["renpho"]["weight_kg"] == 87.5

    # Yesterday existing weight + undated MND weight -> never writes
    st_y = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    st_y["renpho"] = {"weight_kg": 88.0, "weight_source": "renpho_direct_cloud", "weight_synced_at": f"{yesterday_str} 08:00:00", "last_synced": f"{yesterday_str} 08:00:00"}
    state_store.save_live_state(st_y, str(ISOLATED_LIVE_STATE_PATH))
    mnd_svc._update_live_state(
        {"calories": 1000, "protein": 80, "carbs": 100, "fat": 30},
        {},
        weight_info={"currentWeight": 84.5, "lastWeighInStatement": "Last weighed in 3 days ago"},
        target_date_str=today_str,
    )
    assert state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["renpho"]["weight_kg"] == 88.0

    # Yesterday existing + today MND weigh-in (lb -> kg) -> writes live_mynetdiary_weight
    mnd_svc._update_live_state(
        {"calories": 1000, "protein": 80, "carbs": 100, "fat": 30},
        {},
        weight_info={"currentWeight": 190.0, "weightUnit": "lbs", "lastWeighInStatement": "Weighed in today"},
        target_date_str=today_str,
    )
    st_mnd_w = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    assert st_mnd_w["renpho"]["weight_source"] == "live_mynetdiary_weight"
    assert st_mnd_w["renpho"]["weight_kg"] == round(190.0 * 0.45359237, 2)

    # 7. /api/renpho/manual with None LBM -> None sinew/water & derived fields
    _reset_env_state()
    st_m2, _, r_m2 = asgi_json("POST", "/api/renpho/manual", json_body={"weight_kg": 88.4})
    assert st_m2 == 200
    assert r_m2["renpho"]["lean_mass_kg"] is None
    assert r_m2["renpho"]["body_fat_pct"] is None
    assert r_m2["renpho"]["muscle_mass_kg"] is None
    assert r_m2["renpho"]["water_pct"] is None
    assert r_m2["renpho"]["target_weight_at_15pct"] is None
    assert r_m2["renpho"]["fat_to_lose_kg"] is None
    with closing(db.get_connection()) as conn:
        row_db = conn.execute("SELECT * FROM renpho_history WHERE id = ?", (f"manual_{today_str}",)).fetchone()
        assert row_db is not None
        assert row_db["weight_kg"] == 88.4
        assert row_db["body_fat_pct"] is None
        assert row_db["lean_mass_kg"] is None
        assert row_db["muscle_mass_kg"] is None
        assert row_db["water_pct"] is None

    print("PASS [4] MND & Renpho Sync Services")


# ---------------------------------------------------------------------------
# [5] Seeds, Macros & Physiological Benefits
# ---------------------------------------------------------------------------
def test_5_seeds_macros_and_benefits() -> None:
    # 1. live_state.json & backend/live_state.json seed alignment
    for seed_path in (ROOT_SEED_LIVE_STATE_PATH, SEED_LIVE_STATE_PATH):
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        nut = seed["nutrition"]
        assert nut["base_calorie_target"] == 2092
        assert nut["calorie_target"] == 2092
        assert nut["base_protein_target_g"] == 200
        assert nut["protein_target_g"] == 200
        assert nut["carbs_target_g"] == 200
        assert nut["fat_target_g"] == 55
        assert nut["deficit"] == 350
        ath = seed["athlete"]
        for k in ("age", "height_cm", "weight_kg", "body_fat_pct", "lean_mass_kg", "muscle_mass_kg", "fat_to_lose_kg", "target_weight_kg"):
            assert ath[k] is None, f"{seed_path.name} athlete.{k} expected None, got {ath[k]}"
        assert seed["renpho"] == {}

    # 2. compute_macro_targets() across all 5 strategies including custom [15, 65] Pro Dial
    m_bal = analytics_service.compute_macro_targets(2092, 400, 200, diet_strategy="balanced")
    # cal=2492, prot=200, rem=1692 -> c=round(1692*0.62/4)=262, f=round(1692*0.38/9)=71
    assert m_bal == {"calorie_target": 2492, "protein_target_g": 200, "carbs_target_g": 262, "fat_target_g": 71}, m_bal

    m_low = analytics_service.compute_macro_targets(2092, 0, 200, diet_strategy="lowcarb")
    # cal=2092, prot=200, rem=1292 -> c=75, f=round((1292-300)/9)=110
    assert m_low == {"calorie_target": 2092, "protein_target_g": 200, "carbs_target_g": 75, "fat_target_g": 110}, m_low

    m_cc_high = analytics_service.compute_macro_targets(2442, 0, 195, diet_strategy="carbcycle", carb_cycle_level="high")
    # cal=2442, prot=195, rem=1662, c=300 -> f=round((1662-1200)/9)=51
    assert m_cc_high == {"calorie_target": 2442, "protein_target_g": 195, "carbs_target_g": 300, "fat_target_g": 51}, m_cc_high

    m_cc_low = analytics_service.compute_macro_targets(2092, 0, 200, diet_strategy="carbcycle", carb_cycle_level="low")
    assert m_cc_low == {"calorie_target": 2092, "protein_target_g": 200, "carbs_target_g": 80, "fat_target_g": 108}, m_cc_low

    m_fast = analytics_service.compute_macro_targets(2092, 200, 200, diet_strategy="fasting")
    # cal=2292, prot=200, rem=1492 -> c=round(1492*0.55/4)=205, f=round(1492*0.45/9)=75
    assert m_fast == {"calorie_target": 2292, "protein_target_g": 200, "carbs_target_g": 205, "fat_target_g": 75}, m_fast

    m_pd = analytics_service.compute_macro_targets(
        2092, 0, 200, diet_strategy="custom", pro_dial_macros={"protein": 180, "fat_pct": 25}
    )
    # cal=2092, prot=180 -> fat=round(2092*0.25/9)=58, carbs=round((2092-720-523)/4)=212
    assert m_pd == {"calorie_target": 2092, "protein_target_g": 180, "carbs_target_g": 212, "fat_target_g": 58}, m_pd

    # Clamp fat_pct [15, 65] and fallback fat_pct=30
    m_pd_low = analytics_service.compute_macro_targets(
        2092, 0, 200, diet_strategy="custom", pro_dial_macros={"protein": 180, "fat_pct": 5}
    )
    assert m_pd_low["fat_target_g"] == int(round((2092 * 0.15) / 9))

    m_pd_high = analytics_service.compute_macro_targets(
        2092, 0, 200, diet_strategy="custom", pro_dial_macros={"protein": 180, "fat_pct": 90}
    )
    assert m_pd_high["fat_target_g"] == int(round((2092 * 0.65) / 9))

    m_pd_default = analytics_service.compute_macro_targets(2092, 0, 200, diet_strategy="custom", pro_dial_macros=None)
    assert m_pd_default["fat_target_g"] == int(round((2092 * 0.30) / 9))

    # 3. benefits_engine.py regexes, ruck priority, weight_kg=None, max_hr<=0, muscle dedup
    be = benefits_engine.PhysiologicalBenefitsEngine()
    assert be.weight_kg is None

    b_kick = be.generate_benefits("Kickbox", "Heavy bag rounds", 45, 500, 150, 178)
    assert "martial arts striking" in b_kick["biomechanics"]
    assert "Biceps Femoris" not in b_kick["muscles_worked"]  # "kb" inside "kickbox" did NOT match is_kettlebell

    b_crunch = be.generate_benefits("Crunch", "Ab circuit", 15, 100, 110, 130)
    assert "unilateral flight-and-impact" not in b_crunch["biomechanics"]  # "run" inside "crunch" did NOT match is_run

    b_ruck = be.generate_benefits("Rucking", "Weighted walk 5km", 60, 480, 125, 145, weight_kg=90.0)
    assert "Loaded axial locomotion" in b_ruck["biomechanics"]
    assert "~1.2× bodyweight" not in b_ruck["biomechanics"]

    for act_name in ("Box Jump", "Walking", "Running"):
        b_none = be.generate_benefits(act_name, act_name, 30, 300, 135, 165, weight_kg=None)
        assert "99.85" not in b_none["biomechanics"]
        assert "kg" not in b_none["biomechanics"]
    b_analyze_none = be.analyze_workout("Running intervals", {"max_hr": 0}, athlete={})
    assert "99.85" not in b_analyze_none["biomechanics"]
    assert "estimated HRmax" not in b_analyze_none["cardio"]

    b_zero_hr = be.generate_benefits("Cardio", "Easy", 30, 200, 110, 0)
    assert "estimated HRmax" not in b_zero_hr["cardio"]

    # Muscle deduplication (Squat Jump triggers both is_jump & is_squat)
    b_sj = be.generate_benefits("Squat Jump", "Plyo Squat", 20, 220, 140, 170)
    muscles_list = [m.strip() for m in b_sj["muscles_worked"].split(", ")]
    assert len(muscles_list) == len(set(muscles_list)), muscles_list

    print("PASS [5] Seeds, Macros & Physiological Benefits")


# ---------------------------------------------------------------------------
# [6] Routes, Analytics & Scoped Idempotency
# ---------------------------------------------------------------------------
def test_6_routes_analytics_and_idempotency() -> None:
    _reset_env_state()
    today_d = uk_now().date()
    today_str = today_d.isoformat()
    yesterday_str = (today_d - timedelta(days=1)).isoformat()
    future_str = (today_d + timedelta(days=3)).isoformat()

    # 1. 422 validation matrix (booleans, NaN/Inf, future/bad dates, (20,300) scale, [0,500] sets)
    for bad_act in (
        {"name": "Run", "calories": True},
        {"name": "Run", "duration_min": -5},
        {"name": "Run", "date": future_str},
        {"name": "Run", "date": "2026-02-30"},
    ):
        st, _, _ = asgi_json("POST", "/api/sync_activity", json_body=bad_act)
        assert st == 422, f"Expected 422 for {bad_act}, got {st}"

    for bad_hyd in (
        {"amount_ml": True},
        {"amount_ml": 0},
        {"amount_ml": 6000},
        {"amount_ml": 500, "date": future_str},
        {"amount_ml": 500, "client_date": "bad-date"},
    ):
        st, _, _ = asgi_json("POST", "/api/hydration/add", json_body=bad_hyd)
        assert st == 422, f"Expected 422 for {bad_hyd}, got {st}"

    for bad_scale in (
        {"weight_kg": True},
        {"weight_kg": 20.0},
        {"weight_kg": 300.0},
        {"weight_kg": 19.9},
        {"weight_kg": 301.0},
        {"weight_kg": 85.0, "body_fat_pct": True},
        {"weight_kg": 85.0, "body_fat_pct": 2.0},
    ):
        st, _, _ = asgi_json("POST", "/api/renpho/manual", json_body=bad_scale)
        assert st == 422, f"Expected 422 for {bad_scale}, got {st}"

    for bad_set in (
        {"exercise_id": "barbell_squat", "logged_weight": 501, "logged_reps": 5},
        {"exercise_id": "barbell_squat", "logged_weight": -1, "logged_reps": 5},
        {"exercise_id": "barbell_squat", "logged_weight": "bad", "logged_reps": 5},
        {"exercise_id": "barbell_squat", "logged_weight": 100, "logged_reps": 201},
        {"exercise_id": "barbell_squat", "logged_weight": 100, "logged_reps": -1},
    ):
        st, _, _ = asgi_json("POST", "/api/sync_set", json_body=bad_set)
        assert st == 422, f"Expected 422 for {bad_set}, got {st}"

    # Raw NaN/Infinity payloads -> 422
    st, _, _ = asgi_json("POST", "/api/sync_session", raw_body=b'{"calories": NaN}')
    assert st == 422
    st, _, _ = asgi_json("POST", "/api/athlete/injuries", raw_body=b'{"notes": "ok", "bad": Infinity}')
    assert st == 422
    st, _, _ = asgi_json("POST", "/api/mnd/manual", raw_body=b'{"totals": {"calories": NaN}}')
    assert st == 422
    st, _, _ = asgi_json("POST", "/api/telemetry/override", json_body={"sleep_score": True})
    assert st == 422
    st, _, _ = asgi_json("POST", "/api/telemetry/override", json_body={"sleep_score": 80, "date": future_str})
    assert st == 422
    st, _, _ = asgi_json("POST", "/api/sync_session", json_body={"calories": 200, "date": future_str})
    assert st == 422
    st, _, _ = asgi_json("POST", "/api/mnd/manual", json_body={"totals": {"calories": 500}, "date": future_str})
    assert st == 422

    # 2. /api/sync_set: "2x22.5kg", warmups is_warmup=1 excluded from sp/PRs, 10 kg deload
    st, _, r_db = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={
            "exercise_id": "db_press",
            "target_weight": "2x20kg",
            "target_reps": 10,
            "logged_weight": "2x22.5kg",
            "logged_reps": 10,
        },
    )
    assert st == 200, r_db
    assert r_db["result"]["e1rm"] == 30.0  # 22.5 * (1 + 10/30)
    assert r_db["result"]["weight"] == 25.0
    assert r_db["result"]["status"] == "progressed"

    # Seed working prescription on barbell_squat (100 kg x 5 -> e1rm 116.7), then log 60 kg warmup
    st, _, r_work = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={"exercise_id": "barbell_squat", "target_weight": 100, "target_reps": 5, "logged_weight": 100, "logged_reps": 5},
    )
    assert st == 200 and r_work["result"]["e1rm"] == 116.7

    st, _, r_warm = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={"exercise_id": "barbell_squat", "target_weight": 100, "target_reps": 5, "logged_weight": 60, "logged_reps": 8},
    )
    assert st == 200 and r_warm["result"]["status"] == "warmup" and r_warm["result"]["is_pr"] is False
    saved_sp = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["strength_prescriptions"]["barbell_squat"]
    assert saved_sp["e1rm"] == 116.7 and saved_sp["status"] == "progressed"
    with closing(db.get_connection()) as conn:
        warm_rows = conn.execute("SELECT is_warmup FROM strength_logs WHERE exercise_id='barbell_squat' ORDER BY id ASC").fetchall()
        assert [int(x["is_warmup"]) for x in warm_rows] == [0, 1]
    assert db.get_strength_pr_map()["barbell_squat"]["e1rm"] == 116.7
    assert len(db.get_strength_history(days=30)["barbell_squat"]) == 1

    # 10 kg deload drops below 10 (never doubled to 20 kg)
    st, _, r_deload = asgi_json(
        "POST",
        "/api/sync_set",
        json_body={"exercise_id": "lateral_raise", "target_weight": 10, "target_reps": 12, "logged_weight": 10, "logged_reps": 4},
    )
    assert st == 200 and r_deload["result"]["status"] == "deloaded"
    assert r_deload["result"]["weight"] == 7.5  # min(10, max(2.5, round(8.5/2.5)*2.5))

    # 3. /api/mnd/manual delta overlays vs snapshot source='manual'
    st, _, r_delta_add = asgi_json(
        "POST",
        "/api/mnd/manual",
        json_body={
            "totals": {"calories": 1400, "protein": 120, "carbs": 130, "fat": 40},
            "logged_item": {"name": "Greek Yogurt", "cals": 200, "p": 20, "c": 10, "f": 5, "category": "snacks"},
        },
    )
    assert st == 200
    assert r_delta_add["mnd_logged"]["calories"] == 1400
    assert r_delta_add["mnd_logged"]["source"] == "mnd_overlay"
    added_id = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))["app_logged_meals"][today_str][0]["id"]
    assert added_id.startswith("app_")
    # Check SQLite source is mnd_overlay (not manual lockout)
    nut_today = {r["date_str"]: r for r in db.get_daily_nutrition(days=3)}[today_str]
    assert nut_today["source"] == "mnd_overlay"

    # Delta delete removes the item and subtracts calories
    st, _, r_delta_rm = asgi_json(
        "POST",
        "/api/mnd/manual",
        json_body={"remove_item": {"id": added_id, "name": "Greek Yogurt", "cals": 200, "p": 20, "c": 10, "f": 5, "meal_category": "snacks"}},
    )
    assert st == 200 and r_delta_rm["mnd_logged"]["calories"] == 1200

    # Snapshot override writes source='manual'
    st, _, r_snap = asgi_json(
        "POST",
        "/api/mnd/manual",
        json_body={"totals": {"calories": 2050, "protein": 195, "carbs": 190, "fat": 55}},
    )
    assert st == 200 and r_snap["mnd_logged"]["source"] == "manual_override"
    nut_today2 = {r["date_str"]: r for r in db.get_daily_nutrition(days=3)}[today_str]
    assert nut_today2["source"] == "manual" and nut_today2["calories"] == 2050

    # 4. All 5 past-date routes routing strictly to SQLite + mnd_history_cache
    before_today = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    st, _, r_p1 = asgi_json("POST", "/api/mnd/manual", json_body={"date": yesterday_str, "totals": {"calories": 1999, "protein": 180, "carbs": 200, "fat": 50}})
    assert st == 200 and r_p1.get("past_date_only") is True
    st, _, r_p2 = asgi_json("POST", "/api/hydration/add", json_body={"client_date": yesterday_str, "amount_ml": 750})
    assert st == 200 and db.get_hydration_total(yesterday_str) == 750
    st, _, r_p3 = asgi_json("POST", "/api/telemetry/override", json_body={"date": yesterday_str, "sleep_score": 88})
    assert st == 200 and r_p3.get("past_date_only") is True
    st, _, _ = asgi_json("POST", "/api/sync_session", json_body={"date": yesterday_str, "preset": "PastSession", "calories": 310})
    assert st == 200
    st, _, _ = asgi_json("POST", "/api/sync_activity", json_body={"date": yesterday_str, "name": "PastRun", "calories": 410, "duration_min": 40})
    assert st == 200

    after_today = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    assert after_today["mnd_logged"]["calories"] == before_today["mnd_logged"]["calories"] == 2050
    assert after_today.get("session_history", []) == before_today.get("session_history", [])
    assert after_today["garmin"].get("sleep_score") == before_today["garmin"].get("sleep_score")
    assert len(after_today["garmin"]["today_activities"]) == len(before_today["garmin"]["today_activities"])
    assert any(d["date"] == yesterday_str and d["calories"] == 1999 for d in after_today["mnd_history"]["days"])
    assert {r["date_str"]: r for r in db.get_daily_biometrics(days=7)}[yesterday_str]["sleep_score"] == 88
    assert any(s["preset"] == "PastSession" for s in db.get_workout_sessions(days=7))
    assert any(a["name"] == "PastRun" for a in db.get_manual_activities(days=7))

    # 5. /api/garmin/sync MND bridge fallback (200) & /api/{garmin,mnd,renpho}/sync 502
    with patch.object(main.garmin_service, "sync_today", return_value={"success": False, "requires_auth": True, "error": "OAuth expired"}), \
         patch.object(main.mnd_service, "fetch_today_data", return_value={"success": True}), \
         patch.object(main.renpho_service, "sync_latest", return_value={"success": True}):
        st, _, res_fb = asgi_json("POST", "/api/garmin/sync")
        assert st == 200 and res_fb["success"] is True and res_fb["has_fresh_token"] is False and res_fb["upstream_auth_required"] is True

    with patch.object(main.garmin_service, "sync_today", return_value={"success": False, "requires_auth": True, "error": "OAuth down"}), \
         patch.object(main.mnd_service, "fetch_today_data", return_value={"success": False, "requires_auth": True, "error": "MND down"}):
        st, _, res_502 = asgi_json("POST", "/api/garmin/sync")
        assert st == 502 and res_502["success"] is False and res_502["upstream_auth_required"] is True

    with patch.object(main.mnd_service, "fetch_today_data", return_value={"success": False, "requires_auth": False, "error": "MND timeout"}):
        st, _, res_m502 = asgi_json("POST", "/api/mnd/sync")
        assert st == 502 and res_m502["success"] is False and res_m502["upstream_auth_required"] is False

    with patch.object(main.renpho_service, "sync_latest", return_value={"success": False, "requires_auth": True, "error": "Renpho 401"}):
        st, _, res_r502 = asgi_json("POST", "/api/renpho/sync")
        assert st == 502 and res_r502["success"] is False and res_r502["upstream_auth_required"] is True

    # Cache-Control: immutable gated on 200 only
    st_404, hdrs_404, _ = asgi_request("GET", "/js/does_not_exist_v61.js?v=6.1", auth=False)
    assert st_404 == 404 and "immutable" not in hdrs_404.get("cache-control", "")

    # 6. ACWR & TDEE edge cases
    ref_d = datetime(2026, 11, 20, tzinfo=UK_TZ).date()
    ref_str = ref_d.isoformat()
    w_rows = [
        {"timestamp": (ref_d - timedelta(days=o)).isoformat(), "weight_kg": 90.0 - (0.05 * (10 - o))}
        for o in (10, 8, 6, 4, 2)
    ]
    n_rows = [
        {"date_str": (ref_d - timedelta(days=o)).isoformat(), "calories": 2100}
        for o in range(1, 8)
    ]
    # SQLite < 800 kcal overrides mnd_history seed unconditionally
    n_rows.append({"date_str": (ref_d - timedelta(days=3)).isoformat(), "calories": 400})
    tdee_state = {"mnd_history": {"days": [{"date": (ref_d - timedelta(days=3)).isoformat(), "calories": 2500}]}}
    tdee_res = analytics_service.compute_adaptive_tdee(tdee_state, w_rows, n_rows, today_str=ref_str)
    # max_fuel_date = min(2026-11-19, 2026-11-18) = 2026-11-18 -> days 2,4,5,6,7 (5 days, day 3 popped, day 1 excluded > max_w_date)
    assert tdee_res["status"] == "ready" and tdee_res["fuel_days_count"] == 5, tdee_res

    # ACWR: distinct timed sessions preserved, RHR <= 25 ignored, acwr >= 1.45 without fatigued_markers
    acwr_acts = [
        {"date": f"{(ref_d - timedelta(days=20)).isoformat()} 08:00:00", "calories": 300, "source": "garmin_oauth", "name": "Run"},
        {"date": f"{(ref_d - timedelta(days=1)).isoformat()} 07:00:00", "calories": 500, "source": "garmin_oauth", "name": "AM Lift"},
        {"date": f"{(ref_d - timedelta(days=1)).isoformat()} 18:00:00", "calories": 500, "source": "manual_app_entry", "name": "PM Row"},
        {"date": f"{(ref_d - timedelta(days=1)).isoformat()} 12:00:00", "calories": 400, "source": "garmin_via_mnd_bridge", "name": "Daily Steps & Movement"},
    ]
    acwr_bios = [
        {"date_str": (ref_d - timedelta(days=i)).isoformat(), "resting_hr": 50 if i > 1 else 20}
        for i in range(1, 8)
    ]
    acwr_state = {"garmin": {"recent_activities": acwr_acts, "metrics_date": ref_str, "sleep_score": 82, "body_battery": 75, "resting_hr": 51}}
    acwr_res = analytics_service.compute_acwr_overreaching(acwr_state, [], [], acwr_bios, today_str=ref_str)
    assert acwr_res["acute_7d_load"] == 1000.0, acwr_res
    assert acwr_res["status"] == "deload_recommended"
    assert acwr_res["fatigued_markers"] == []
    assert "exceeded 1.45x" in acwr_res["reason"]

    # 7. POST /api/preferences/state pro_dial_macros nutrition recalculation + validation
    st_pref_bad, _, _ = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={"fields": {"pro_dial_macros": {"value": {"protein": 200, "fat_pct": 10}, "updated_at_ms": 1000}}},
    )
    assert st_pref_bad == 422
    st_pref_extra, _, _ = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={"fields": {}, "client_event_id": "forbidden"},
    )
    assert st_pref_extra == 422

    now_ms = int(uk_now().timestamp() * 1000)
    st_pref, _, r_pref = asgi_json(
        "POST",
        "/api/preferences/state",
        json_body={
            "fields": {
                "goal_key": {"value": "recomp", "updated_at_ms": now_ms},
                "diet_strategy": {"value": "custom", "updated_at_ms": now_ms},
                "pro_dial_macros": {"value": {"protein": 185, "fat_pct": 25}, "updated_at_ms": now_ms},
            }
        },
    )
    assert st_pref == 200 and r_pref["field_resolutions"]["pro_dial_macros"] == "accepted"
    st_after_pref = state_store.load_live_state(str(ISOLATED_LIVE_STATE_PATH))
    expected_macros = analytics_service.compute_macro_targets(
        2092,
        st_after_pref["garmin"].get("active_calories", 0),
        200,
        diet_strategy="custom",
        pro_dial_macros={"protein": 185, "fat_pct": 25},
        goal_key="recomp",
    )
    assert st_after_pref["nutrition"]["protein_target_g"] == expected_macros["protein_target_g"]
    assert st_after_pref["nutrition"]["fat_target_g"] == expected_macros["fat_target_g"]
    assert st_after_pref["nutrition"]["carbs_target_g"] == expected_macros["carbs_target_g"]

    # 8. Scoped client_event_id idempotency across all 5 event routes (claim AFTER 422 validation)
    # Failed 422 must NOT claim the event_id
    st_bad_idem, _, _ = asgi_json(
        "POST",
        "/api/hydration/add",
        json_body={"amount_ml": 99999, "client_event_id": "shared_evt_1"},
    )
    assert st_bad_idem == 422
    st_ok_idem, _, r_ok_idem = asgi_json(
        "POST",
        "/api/hydration/add",
        json_body={"amount_ml": 250, "client_event_id": "shared_evt_1"},
    )
    assert st_ok_idem == 200 and not r_ok_idem.get("duplicate")
    # Replay in same scope -> duplicate
    st_dup_idem, _, r_dup_idem = asgi_json(
        "POST",
        "/api/hydration/add",
        json_body={"amount_ml": 250, "client_event_id": "shared_evt_1"},
    )
    assert st_dup_idem == 200 and r_dup_idem.get("duplicate") is True

    # Same client_event_id in OTHER 4 scopes succeeds once and deduplicates on replay
    event_routes = [
        ("/api/sync_activity", {"name": "IdemRun", "calories": 250, "duration_min": 25, "client_event_id": "shared_evt_1"}),
        ("/api/mnd/manual", {"totals": {"calories": 1500, "protein": 130, "carbs": 140, "fat": 45}, "logged_item": {"name": "Apple", "cals": 95, "p": 0, "c": 25, "f": 0}, "client_event_id": "shared_evt_1"}),
        ("/api/sync_set", {"exercise_id": "db_press", "target_weight": 20, "target_reps": 10, "logged_weight": 20, "logged_reps": 10, "client_event_id": "shared_evt_1"}),
        ("/api/sync_session", {"preset": "IdemSess", "calories": 300, "client_event_id": "shared_evt_1"}),
    ]
    for route, body in event_routes:
        st1, _, r1 = asgi_json("POST", route, json_body=body)
        assert st1 == 200 and not r1.get("duplicate"), f"{route} first call failed: {st1} {r1}"
        st2, _, r2 = asgi_json("POST", route, json_body=body)
        assert st2 == 200 and r2.get("duplicate") is True, f"{route} replay not deduplicated: {st2} {r2}"

    print("PASS [6] Routes, Analytics & Scoped Idempotency")


def run_all() -> None:
    try:
        test_1_storage_and_db_recovery()
        test_2_renpho_and_time_helpers()
        test_3_garmin_sync()
        test_4_mnd_and_renpho_sync()
        test_5_seeds_macros_and_benefits()
        test_6_routes_analytics_and_idempotency()
        print("ALL 6 V6.1 BACKEND SUITES PASSED")
    finally:
        _cleanup_tmp()


if __name__ == "__main__":
    run_all()
