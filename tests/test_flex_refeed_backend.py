import asyncio
import atexit
import json
import os
import shutil
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_LIVE_STATE_PATH = REPO_ROOT / "backend" / "live_state.json"

_TMP_DIR_OBJ = tempfile.TemporaryDirectory(prefix="pulse_flex_be_")
TMP_DIR = Path(_TMP_DIR_OBJ.name).resolve()
DATA_DIR = TMP_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ISOLATED_LIVE_STATE_PATH = DATA_DIR / "live_state.json"
shutil.copy2(SEED_LIVE_STATE_PATH, ISOLATED_LIVE_STATE_PATH)

os.environ["DATA_DIR"] = str(DATA_DIR)
os.environ["LIVE_STATE_PATH"] = str(ISOLATED_LIVE_STATE_PATH)
os.environ["PULSE_API_SECRET"] = "test-secret-flex"
os.environ.pop("RAILWAY_ENVIRONMENT", None)


def _cleanup_tmp() -> None:
    try:
        _TMP_DIR_OBJ.cleanup()
    except Exception:
        pass


atexit.register(_cleanup_tmp)
sys.path.insert(0, str(REPO_ROOT / "backend"))

import analytics_service  # noqa: E402
import db  # noqa: E402
import main  # noqa: E402
from time_utils import UK_TZ, uk_now  # noqa: E402


async def _asgi_call(
    method: str,
    url_path: str,
    body: bytes = b"",
    auth: bool = True,
) -> Tuple[int, bytes]:
    if "?" in url_path:
        path, query_str = url_path.split("?", 1)
    else:
        path, query_str = url_path, ""

    req_headers: List[Tuple[bytes, bytes]] = []
    if auth and path.startswith("/api/"):
        req_headers.append((b"authorization", b"Bearer test-secret-flex"))
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

    await main.app(scope, receive, send)
    return status_code, b"".join(chunks)


def api_json(method: str, url_path: str, payload: Optional[Dict[str, Any]] = None, auth: bool = True) -> Tuple[int, Any]:
    raw = json.dumps(payload).encode("utf-8") if payload is not None else b""
    st, body = asyncio.run(_asgi_call(method, url_path, body=raw, auth=auth))
    parsed = json.loads(body.decode("utf-8")) if body else None
    return st, parsed


def reset_test_db() -> Dict[str, Any]:
    db.init_db()
    with closing(db.get_connection()) as conn:
        for tbl in (
            "daily_nutrition_logs",
            "daily_biometrics",
            "renpho_history",
            "workout_sessions",
            "manual_activities",
            "kv_store",
        ):
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
    seed = json.loads(SEED_LIVE_STATE_PATH.read_text(encoding="utf-8"))
    seed["date"] = uk_now().date().isoformat()
    main.save_live_state(seed)
    return seed


def seed_clean_days(days_offsets: List[int], cals: int = 2050, protein_g: int = 200) -> None:
    today = uk_now().date()
    for off in days_offsets:
        d = (today - timedelta(days=off)).isoformat()
        db.upsert_daily_nutrition(d, cals, protein_g, 190, 55, source="mnd")


def test_1_unlogged_day_isolation() -> None:
    reset_test_db()
    # Sparse/unlogged days (<800 kcal) must count as 0 banked deficit and 0 clean days
    seed_clean_days([1, 2, 3, 4], cals=450, protein_g=210)
    st, summary = api_json("GET", "/api/analytics/summary")
    assert st == 200
    flex = summary["flex_refeed"]
    assert flex["status"] == "insufficient_data"
    assert flex["streak"]["logged_days_7d"] == 0
    assert flex["streak"]["clean_days_7d"] == 0
    assert flex["streak"]["banked_7d_kcal"] == 0
    assert flex["eligible_modes"] == []
    print("PASS [1] Unlogged Day (<800 kcal) Isolation")


def test_2_three_tier_eligibility_and_cooldowns() -> None:
    state = reset_test_db()
    today = uk_now().date()
    state["nutrition"]["tdee"] = 2740
    main.save_live_state(state)

    # 2a. Tier 1: 3 clean days in last 5 unlocks Flex Snack
    seed_clean_days([1, 2, 3], cals=2050, protein_g=200)
    st, summary = api_json("GET", "/api/analytics/summary")
    assert st == 200
    assert "flex_snack" in summary["flex_refeed"]["eligible_modes"]
    assert summary["flex_refeed"]["recommended_mode"] == "flex_snack"

    # Attempting flex_meal before 5/7 clean days must return 409
    st_bad, _ = api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_meal", "bonus_kcal": 500})
    assert st_bad == 409

    # 2b. Tier 2: 5/7 clean days + >=1750 banked deficit + non-rising Renpho trend unlocks Flex Meal
    seed_clean_days([1, 2, 3, 4, 5], cals=2000, protein_g=205)  # 5 * (2740 - 2000) = 3700 kcal banked
    renpho_rows = [
        {"date": (today - timedelta(days=10)).isoformat(), "timestamp": int((uk_now() - timedelta(days=10)).timestamp()), "weight_kg": 97.6, "body_fat_pct": 17.2},
        {"date": (today - timedelta(days=7)).isoformat(), "timestamp": int((uk_now() - timedelta(days=7)).timestamp()), "weight_kg": 97.4, "body_fat_pct": 17.1},
        {"date": (today - timedelta(days=4)).isoformat(), "timestamp": int((uk_now() - timedelta(days=4)).timestamp()), "weight_kg": 97.1, "body_fat_pct": 17.0},
        {"date": (today - timedelta(days=1)).isoformat(), "timestamp": int((uk_now() - timedelta(days=1)).timestamp()), "weight_kg": 96.9, "body_fat_pct": 16.9},
    ]
    db.upsert_renpho_measurements(renpho_rows)

    st, summary2 = api_json("GET", "/api/analytics/summary")
    assert st == 200
    assert "flex_meal" in summary2["flex_refeed"]["eligible_modes"]
    assert summary2["flex_refeed"]["recommended_mode"] == "flex_meal"

    # Claim Flex Meal with idempotency key
    st_c, claimed = api_json("POST", "/api/fuel/flex/claim", {
        "mode": "flex_meal",
        "bonus_kcal": 550,
        "client_event_id": "evt-meal-001",
    })
    assert st_c == 200
    assert claimed["state"]["nutrition"]["calorie_target"] == 2092 + 550
    assert claimed["state"]["nutrition"]["protein_target_g"] == 200

    # Retrying same client_event_id must succeed idempotently without double-claiming
    st_dup, dup_res = api_json("POST", "/api/fuel/flex/claim", {
        "mode": "flex_meal",
        "bonus_kcal": 550,
        "client_event_id": "evt-meal-001",
    })
    assert st_dup == 200 and dup_res.get("duplicate") is True

    # Different client_event_id same day must reject with 409
    st_c2, _ = api_json("POST", "/api/fuel/flex/claim", {
        "mode": "flex_snack",
        "client_event_id": "evt-snack-002",
    })
    assert st_c2 == 409

    # Cooldown check: if claim happened 2 days ago, both flex_snack (3d after meal) and flex_meal (5d) are in cooldown
    hist = analytics_service.load_flex_history()
    two_days_ago = (today - timedelta(days=2)).isoformat()
    hist[0]["date_str"] = two_days_ago
    hist[0]["claimed_at"] = (uk_now() - timedelta(days=2)).isoformat()
    analytics_service.save_flex_history(hist)
    st, summary_cd = api_json("GET", "/api/analytics/summary")
    assert summary_cd["flex_refeed"]["status"] == "cooldown"
    assert summary_cd["flex_refeed"]["cooldown"]["flex_meal_days_left"] == 3
    assert summary_cd["flex_refeed"]["cooldown"]["flex_snack_days_left"] == 1

    # 2c. Tier 3: Refeed Day unlocks when 10/14 clean days + fatigued/fast-loss markers & cooldown expired
    analytics_service.save_flex_history([])
    seed_clean_days(list(range(1, 11)), cals=2000, protein_g=200)
    renpho_fast_drop = [
        {"date": (today - timedelta(days=10)).isoformat(), "timestamp": int((uk_now() - timedelta(days=10)).timestamp()), "weight_kg": 98.4, "body_fat_pct": 17.5},
        {"date": (today - timedelta(days=7)).isoformat(), "timestamp": int((uk_now() - timedelta(days=7)).timestamp()), "weight_kg": 97.9, "body_fat_pct": 17.3},
        {"date": (today - timedelta(days=4)).isoformat(), "timestamp": int((uk_now() - timedelta(days=4)).timestamp()), "weight_kg": 97.4, "body_fat_pct": 17.1},
        {"date": (today - timedelta(days=1)).isoformat(), "timestamp": int((uk_now() - timedelta(days=1)).timestamp()), "weight_kg": 97.0, "body_fat_pct": 16.9},
    ]
    with closing(db.get_connection()) as conn:
        conn.execute("DELETE FROM renpho_history")
        conn.commit()
    db.upsert_renpho_measurements(renpho_fast_drop)

    st, summary_rf = api_json("GET", "/api/analytics/summary")
    assert st == 200
    assert "refeed_day" in summary_rf["flex_refeed"]["eligible_modes"]
    assert summary_rf["flex_refeed"]["recommended_mode"] == "refeed_day"
    print("PASS [2] 3-Tier Eligibility & Cooldowns")


def test_3_planned_banking_floor_anti_double_dip_and_undo() -> None:
    state = reset_test_db()
    today = uk_now().date()
    state["nutrition"]["tdee"] = 2740
    main.save_live_state(state)
    seed_clean_days([1, 2, 3, 4, 5, 6], cals=2000, protein_g=205)

    target_date = (today + timedelta(days=3)).isoformat()
    st_p, plan_res = api_json("POST", "/api/fuel/flex/plan", {
        "action": "upsert",
        "target_date": target_date,
        "target_kcal": 600,
        "label": "Saturday <b>Pizza</b> Night",
    })
    assert st_p == 200
    assert plan_res["flex_refeed"]["status"] == "banking_in_progress"
    assert plan_res["flex_refeed"]["planned_bank"]["label"] == "Saturday Pizza Night"
    # Anti-double-dipping: Earned Flex Meal must be paused while planned bank is active!
    assert "flex_meal" not in plan_res["flex_refeed"]["eligible_modes"]
    # Daily deduction capped <= 200 kcal and protein locked
    ded = plan_res["flex_refeed"]["planned_bank"]["daily_deduction_today"]
    assert 0 < ded <= 200
    assert plan_res["state"]["nutrition"]["calorie_target"] == 2092 - ded
    assert plan_res["state"]["nutrition"]["protein_target_g"] == 200

    # Floor enforcement: even with huge target & base=1700, target >= max(1600, protein*4+600)
    s_low = main.load_live_state()
    s_low["nutrition"]["base_calorie_target"] = 1700
    s_low["nutrition"]["base_protein_target_g"] = 200
    main.save_live_state(s_low)
    analytics_service.recalculate_nutrition(s_low, today.isoformat())
    assert s_low["nutrition"]["calorie_target"] >= 1600
    assert s_low["nutrition"]["protein_target_g"] == 200

    # Restore baseline=2092 and simulate arriving on event target_date with completed savings logs
    state = reset_test_db()
    state["nutrition"]["tdee"] = 2740
    main.save_live_state(state)
    plan_start = (today - timedelta(days=4)).isoformat()
    for off in (1, 2, 3, 4):
        db.upsert_daily_nutrition((today - timedelta(days=off)).isoformat(), 1940, 200, 175, 50, source="mnd")
    analytics_service.save_flex_bank_plan({
        "plan_id": "fbp_due_today",
        "status": "active",
        "created_date": plan_start,
        "start_date": plan_start,
        "target_date": today.isoformat(),
        "target_kcal": 600,
        "label": "Pizza Night",
        "daily_deduction_cap": 150,
    })

    st_s, due_sum = api_json("GET", "/api/analytics/summary")
    assert st_s == 200
    assert due_sum["flex_refeed"]["planned_bank"]["ready_to_redeem"] is True
    assert due_sum["flex_refeed"]["planned_bank"]["actual_banked_kcal"] == 608
    assert due_sum["flex_refeed"]["planned_bank"]["unlock_kcal"] == 600
    assert "planned_flex" in due_sum["flex_refeed"]["eligible_modes"]

    # Redeem Planned Flex -> marks plan claimed + boosts calorie target + enables undo
    st_red, red_res = api_json("POST", "/api/fuel/flex/claim", {"mode": "planned_flex"})
    assert st_red == 200
    assert red_res["state"]["nutrition"]["calorie_target"] == 2092 + 600
    assert analytics_service.load_flex_bank_plan()["status"] == "claimed"

    # Same-day Undo must restore baseline and re-activate plan
    st_u, undo_res = api_json("POST", "/api/fuel/flex/undo", {})
    assert st_u == 200
    assert undo_res["state"]["nutrition"]["calorie_target"] == 2092
    assert analytics_service.load_flex_bank_plan()["status"] == "active"

    # Prior-date claim undo must be rejected with 409
    old_id = "flx_old_001"
    analytics_service.save_flex_history([{
        "claim_id": old_id,
        "date_str": (today - timedelta(days=2)).isoformat(),
        "claimed_at": (uk_now() - timedelta(days=2)).isoformat(),
        "mode": "flex_meal",
        "bonus_kcal": 500,
        "triggers_scale_shield": True,
    }])
    st_old_u, _ = api_json("POST", "/api/fuel/flex/undo", {"claim_id": old_id})
    assert st_old_u == 409
    print("PASS [3] Planned Banking, Anti-Double-Dip, Floor & Undo")


def test_4_scale_shield_window() -> None:
    state = reset_test_db()
    state["nutrition"]["tdee"] = 2740
    main.save_live_state(state)
    seed_clean_days([1, 2, 3, 4, 5], cals=2000, protein_g=205)

    # Flex Snack must NOT trigger Scale Shield
    st_sn, sn_res = api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_snack"})
    assert st_sn == 200
    assert sn_res["flex_refeed"]["scale_shield"]["active"] is False

    # Same-day undo then claim Flex Meal -> MUST trigger 48h Scale Shield
    st_u, _ = api_json("POST", "/api/fuel/flex/undo", {})
    assert st_u == 200
    st_ml, ml_res = api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_meal", "bonus_kcal": 550})
    assert st_ml == 200
    assert ml_res["flex_refeed"]["scale_shield"]["active"] is True
    assert ml_res["flex_refeed"]["scale_shield"]["hours_remaining"] >= 47

    # Undo Flex Meal -> Scale Shield clears
    st_u2, u2_res = api_json("POST", "/api/fuel/flex/undo", {})
    assert st_u2 == 200
    assert u2_res["flex_refeed"]["scale_shield"]["active"] is False

    # Claim aged 50h -> Scale Shield expired
    today = uk_now().date()
    analytics_service.save_flex_history([{
        "claim_id": "flx_aged50h",
        "date_str": (today - timedelta(days=2)).isoformat(),
        "claimed_at": (uk_now() - timedelta(hours=50)).isoformat(),
        "mode": "flex_meal",
        "bonus_kcal": 550,
        "triggers_scale_shield": True,
    }])
    st_g, g_res = api_json("GET", "/api/analytics/summary")
    assert st_g == 200
    assert g_res["flex_refeed"]["scale_shield"]["active"] is False
    print("PASS [4] 48-Hour Post-Refeed Scale Shield")


def test_5_recalculate_preservation_and_validation() -> None:
    state = reset_test_db()
    today_iso = uk_now().date().isoformat()
    state["nutrition"]["tdee"] = 2740
    main.save_live_state(state)
    seed_clean_days([1, 2, 3], cals=2050, protein_g=200)

    st_c, _ = api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_snack", "bonus_kcal": 250})
    assert st_c == 200

    # Updating preference / MND manual intake must preserve active +250 flex boost
    st_m, m_res = api_json("POST", "/api/mnd/manual", {
        "date": today_iso,
        "totals": {
            "calories": 1200,
            "protein_g": 120,
            "carbs_g": 110,
            "fat_g": 30,
        },
    })
    assert st_m == 200
    assert m_res["state"]["nutrition"]["calorie_target"] == 2092 + 250
    assert m_res["state"]["nutrition"]["flex_active"]["adjustment_kcal"] == 250

    st_pr, _ = api_json("POST", "/api/preferences/state", {
        "fields": {"goal_key": {"value": "aerobic", "updated_at_ms": int(uk_now().timestamp() * 1000)}}
    })
    assert st_pr == 200
    st_ls, ls = api_json("GET", "/api/live_state")
    assert st_ls == 200
    assert ls["nutrition"]["calorie_target"] == 2200 + 250

    # Reset and check strict 422 / 401 validation
    reset_test_db()
    today = uk_now().date()
    assert api_json("POST", "/api/fuel/flex/claim", {"mode": "invalid_mode"})[0] == 422
    assert api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_snack", "bonus_kcal": True})[0] == 422
    assert api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_snack", "bonus_kcal": 999})[0] == 422
    assert api_json("POST", "/api/fuel/flex/plan", {"action": "upsert", "target_date": today.isoformat(), "target_kcal": 500})[0] == 422
    assert api_json("POST", "/api/fuel/flex/plan", {"action": "upsert", "target_date": (today + timedelta(days=10)).isoformat(), "target_kcal": 500})[0] == 422
    assert api_json("POST", "/api/fuel/flex/plan", {"action": "upsert", "target_date": "bad-date", "target_kcal": 500})[0] == 422
    assert api_json("POST", "/api/fuel/flex/claim", {"mode": "flex_snack"}, auth=False)[0] == 401
    print("PASS [5] recalculate_nutrition Preservation, Auth & 422 Schema Validation")


if __name__ == "__main__":
    test_1_unlogged_day_isolation()
    test_2_three_tier_eligibility_and_cooldowns()
    test_3_planned_banking_floor_anti_double_dip_and_undo()
    test_4_scale_shield_window()
    test_5_recalculate_preservation_and_validation()
    print("ALL 5 FLEX & REFEED BACKEND SUITES PASSED")
