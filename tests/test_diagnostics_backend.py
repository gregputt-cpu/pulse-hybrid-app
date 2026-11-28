import asyncio
import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_LIVE_STATE_PATH = REPO_ROOT / "backend" / "live_state.json"

_TMP_DIR_OBJ = tempfile.TemporaryDirectory(prefix="pulse_diag_be_")
TMP_DIR = Path(_TMP_DIR_OBJ.name).resolve()
DATA_DIR = TMP_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ISOLATED_LIVE_STATE_PATH = DATA_DIR / "live_state.json"
shutil.copy2(SEED_LIVE_STATE_PATH, ISOLATED_LIVE_STATE_PATH)

os.environ["DATA_DIR"] = str(DATA_DIR)
os.environ["LIVE_STATE_PATH"] = str(ISOLATED_LIVE_STATE_PATH)
os.environ["PULSE_API_SECRET"] = "test-secret-diag"
os.environ.pop("RAILWAY_ENVIRONMENT", None)
os.environ.pop("GEMINI_API_KEY", None)


def _cleanup_tmp() -> None:
    try:
        _TMP_DIR_OBJ.cleanup()
    except Exception:
        pass


atexit.register(_cleanup_tmp)
sys.path.insert(0, str(REPO_ROOT / "backend"))

import db  # noqa: E402
import diagnostics_ai  # noqa: E402
import diagnostics_context  # noqa: E402
import diagnostics_safety  # noqa: E402
import exercise_biomechanics  # noqa: E402
import main  # noqa: E402
import requests  # noqa: E402
from time_utils import uk_now  # noqa: E402


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
        req_headers.append((b"authorization", b"Bearer test-secret-diag"))
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


def asgi_json(
    method: str,
    url_path: str,
    json_body: Any = None,
    raw_body: Optional[bytes] = None,
    headers: Optional[List[Tuple[str, str]]] = None,
    auth: bool = True,
) -> Tuple[int, Dict[str, str], Any]:
    if raw_body is not None:
        payload_bytes = raw_body
    elif json_body is not None:
        payload_bytes = json.dumps(json_body).encode("utf-8")
    else:
        payload_bytes = b""
    st, hdrs, raw = asyncio.run(_asgi_call(method, url_path, payload_bytes, headers=headers, auth=auth))
    parsed = json.loads(raw.decode("utf-8")) if raw and raw.lstrip().startswith((b"{", b"[")) else raw.decode("utf-8", errors="replace")
    return st, hdrs, parsed


def _reset_db_and_state(seed_state: Optional[Dict[str, Any]] = None) -> None:
    db.init_db()
    with closing(db.get_connection()) as conn:
        for tbl in (
            "workout_sessions",
            "manual_activities",
            "strength_logs",
            "daily_biometrics",
            "renpho_history",
            "daily_nutrition_logs",
            "diagnostic_assessments",
        ):
            conn.execute(f"DELETE FROM {tbl}")
        conn.commit()
    if seed_state is not None:
        main.save_live_state(seed_state)
    else:
        shutil.copy2(SEED_LIVE_STATE_PATH, ISOLATED_LIVE_STATE_PATH)
    with main._DIAGNOSTICS_RATE_LOCK:
        main._DIAGNOSTICS_BUCKETS.clear()
    with diagnostics_ai._GLOBAL_GEMINI_LOCK:
        diagnostics_ai._GLOBAL_GEMINI_TIMESTAMPS.clear()


# [1] 54-Exercise Catalog Parity & ID Normalization
def test_1_exercise_biomechanics_parity():
    node_script = (
        "const fs=require('fs'), vm=require('vm');"
        "const ctx={window:{athleteProfile:{}},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},console,Date};"
        "vm.createContext(ctx);"
        "vm.runInContext(fs.readFileSync('js/workout-catalog.js','utf8'),ctx);"
        "console.log(JSON.stringify(ctx.getAllExercises().map(e=>({id:e.id,family:e.family}))));"
    )
    proc = subprocess.run(
        ["node", "-e", node_script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    js_catalog = json.loads(proc.stdout.strip())
    assert len(js_catalog) == 54, f"Expected 54 exercises in JS catalog, got {len(js_catalog)}"
    js_map = {item["id"]: item["family"] for item in js_catalog}
    py_map = {eid: meta["family"] for eid, meta in exercise_biomechanics.EXERCISE_BIOMECHANICS.items()}
    assert set(py_map.keys()) == set(js_map.keys()), "Python & JS exercise ID sets diverged"
    for eid, fam in js_map.items():
        assert py_map[eid] == fam, f"Family mismatch for {eid}: py={py_map[eid]} vs js={fam}"

    assert exercise_biomechanics.normalize_exercise_id("barbell_rdl_1") == "barbell_rdl"
    assert exercise_biomechanics.normalize_exercise_id("emom_hybrid_10") == "emom_hybrid_10"
    assert exercise_biomechanics.normalize_exercise_id("kb_flow_2h_pyramid_1_5") == "kb_flow_2h_pyramid_1_5"
    assert "kb_goblet_lunge" in exercise_biomechanics.LEGACY_EXERCISE_ALIASES
    assert exercise_biomechanics.is_exercise_contraindicated_py("kb_flow_2h_gladiator_post", ["elbows"]) is False
    for j in exercise_biomechanics.ALL_ADAPTOR_JOINTS:
        assert exercise_biomechanics.is_exercise_contraindicated_py("kb_flow_2h_out_about", [j]) is True
        assert exercise_biomechanics.is_exercise_contraindicated_py("kb_flow_1h_armor_chain", [j]) is True
    print("PASS [1] 54-Exercise Catalog Parity & ID Normalization")


# [2] Context Aggregator Deduplication, Normalization & Budget Cap
def test_2_context_aggregator_dedup_and_budget():
    _reset_db_and_state()
    today_str = uk_now().date().isoformat()
    yesterday_ts = uk_now().replace(hour=10, minute=0, second=0, microsecond=0).isoformat()

    db.log_workout_session({
        "date": yesterday_ts,
        "preset": "gym",
        "goal": "recomp",
        "exercisesCompleted": 2,
        "setsLogged": 4,
        "calories": 320,
        "details": {"barbell_rdl_1": {"logged": True}, "barbell_rdl_2": {"logged": True}, "duration_min": 42},
    })
    # Duplicate manual activity same day within 10 kcal
    db.log_manual_activity({
        "id": "man_1",
        "date": yesterday_ts,
        "name": "Strength Training",
        "sub_title": "Barbell Session",
        "duration_min": 40,
        "calories": 325,
        "avg_hr": 122,
        "max_hr": 154,
    })
    # Working sets + 1 warmup (excluded)
    db.log_strength_set("barbell_rdl", 90.0, 8, 114.0, timestamp=yesterday_ts, is_warmup=False)
    db.log_strength_set("barbell_rdl", 40.0, 8, 50.7, timestamp=yesterday_ts, is_warmup=True)

    # Seed dense Garmin recent_activities including duplicate (318 kcal) & Daily Steps bridge
    state = main.load_live_state()
    state["garmin"]["today_activities"] = [
        {"id": "g_steps", "name": "Daily Steps & Movement", "date": f"{today_str} 09:00:00", "calories": 180, "source": "garmin_via_mnd_bridge"},
        {"id": "g_dup", "name": "Jump Rope & Kettlebells", "date": f"{today_str} 10:15:00", "duration_min": 40, "calories": 318, "source": "garmin_oauth"},
    ]
    from datetime import timedelta as _td
    for i in range(1, 35):
        d_item = (uk_now().date() - _td(days=((i % 19) + 1))).isoformat()
        state["garmin"]["today_activities"].append({
            "id": f"g_dense_{i}",
            "name": f"Running & Kettlebell Intervals Session {i}",
            "date": f"{d_item} 07:00:00",
            "duration_min": 35,
            "calories": 400 + i * 25,
            "source": "garmin_oauth",
        })

    ctx = diagnostics_context.build_diagnostic_context(state, window_days=21, candidate_region="knee")
    names = [w["name"] for w in ctx["recent_workouts"]]
    assert not any("Daily Steps" in n for n in names), "Daily Steps bridge entry must be filtered out"
    # Priority 2 Garmin (318 kcal) beats duplicate manual (325) & workout_session (320)
    assert "Jump Rope & Kettlebells" in names
    assert "Strength Training" not in names, "Duplicate lower-priority manual activity must be deduplicated"
    assert ctx["history_availability"] == "rich"
    assert any(ex["exercise_id"] == "barbell_rdl" and ex["sets_7d"] == 1 for ex in ctx["strength_exposure"])
    encoded = json.dumps(ctx, allow_nan=False)
    assert len(encoded) <= diagnostics_context.MAX_CONTEXT_JSON_CHARS, f"Context budget exceeded: {len(encoded)}"
    print("PASS [2] Context Aggregator Deduplication, Normalization & Budget Cap")


# [3] Empty History Fallback
def test_3_empty_history_fallback():
    _reset_db_and_state()
    req = diagnostics_ai.SymptomInputModel(raw_text="Sharp pain below my left kneecap after stairs")
    report = diagnostics_ai.analyze_athlete_symptoms(req, main.load_live_state())
    assert report["recovery_context"]["history_availability"] == "empty"
    assert report["recovery_context"]["workouts_analyzed"] == 0
    assert report["load_correlations"] == []
    assert report["recovery_context"]["data_gap_note"]
    assert report["needs_clarification"] is False
    print("PASS [3] Empty History Fallback")


# [4] Dual-Layer Red-Flag Override & Ordering Before Clarification
def test_4_red_flags_override_and_ordering():
    _reset_db_and_state()
    for urgent_text in ("chest pain", "numb leg", "heard an audible pop in my knee and can't bear weight"):
        rep = diagnostics_ai.analyze_athlete_symptoms(
            diagnostics_ai.SymptomInputModel(raw_text=urgent_text),
            main.load_live_state(),
        )
        assert rep["needs_clarification"] is False, f"Urgent prompt '{urgent_text}' must NEVER trigger clarification"
        assert rep["red_flags"]["triggered"] is True
        assert rep["red_flags"]["deterministic_override"] is True
        assert rep["triage_level"] == "red_seek_care"
        assert rep["red_flags"]["training_clearance"] == "stop_and_evaluate"
        assert rep["adaptor_handoff"]["rest_recommended"] is True

    # Severe pain >= 9 with acute keyword triggers red flag too
    sev_rep = diagnostics_ai.analyze_athlete_symptoms(
        diagnostics_ai.SymptomInputModel(raw_text="Sudden sharp knee pain when lunging", pain_severity=9, onset_type="sudden_acute"),
        main.load_live_state(),
    )
    assert sev_rep["triage_level"] == "red_seek_care" and sev_rep["red_flags"]["triggered"] is True

    # Mock AI trying to downgrade red flag must be overridden
    fake_ai_json = {
        "summary_headline": "<b>Mild soreness</b>",
        "anatomical_region": "knee",
        "laterality": "left",
        "severity": "mild",
        "triage_level": "green_modify",
        "red_flags": {"triggered": False, "flags": [], "clinical_action": "Keep training", "training_clearance": "modified_allowed"},
        "probable_causes": [{"rank": 1, "label": "Mild strain", "likelihood": "moderate", "confidence_pct": 50, "mechanism": "Minor tension", "supporting_evidence": []}],
        "load_correlations": [],
        "action_plan": {"immediate_relief_protocol": ["Stretch"], "load_management_guidance": "Continue", "recovery_horizon_hours": "24h", "return_to_load_criteria": ["None"]},
        "adaptor_handoff": {"affected_joints": ["knees"], "movement_restrictions": ["deep_knee_flexion"], "restricted_exercise_ids": [], "rest_recommended": False, "summary_note": "Mild", "expires_hint_hours": 24},
    }
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = {"candidates": [{"content": {"parts": [{"text": json.dumps(fake_ai_json)}]}}]}
    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-key"}), patch.object(requests, "post", return_value=mock_resp):
        overridden = diagnostics_ai.analyze_athlete_symptoms(
            diagnostics_ai.SymptomInputModel(raw_text="Left knee radiating numbness and buckling"),
            main.load_live_state(),
        )
        assert overridden["red_flags"]["triggered"] is True
        assert overridden["red_flags"]["deterministic_override"] is True
        assert overridden["triage_level"] == "red_seek_care"
        assert overridden["red_flags"]["training_clearance"] == "stop_and_evaluate"
        assert overridden["adaptor_handoff"]["rest_recommended"] is True
        assert "<b>" not in overridden["summary_headline"]
    print("PASS [4] Dual-Layer Red-Flag Override & Ordering Before Clarification")


# [5] Vague Input Clarification & 1-Round Cap
def test_5_vague_clarification_and_one_round_cap():
    _reset_db_and_state()
    for vague in ("hurt", "my leg hurts", "arm is sore"):
        rep = diagnostics_ai.analyze_athlete_symptoms(
            diagnostics_ai.SymptomInputModel(raw_text=vague),
            main.load_live_state(),
        )
        assert rep["needs_clarification"] is True, f"Expected clarification for '{vague}'"
        assert rep["adaptor_handoff"] is None
        assert 1 <= len(rep["clarification_questions"]) <= 3

    # With clarification_context, must cap at 1 round & never re-ask
    resolved = diagnostics_ai.analyze_athlete_symptoms(
        diagnostics_ai.SymptomInputModel(
            raw_text="my leg hurts",
            clarification_context={"prior_assessment_id": "prev-1", "answers": ["Knee / Kneecap", "After cardio"]},
        ),
        main.load_live_state(),
    )
    assert resolved["needs_clarification"] is False
    assert resolved["anatomical_region"] == "knee"
    assert "knees" in resolved["adaptor_handoff"]["affected_joints"]
    print("PASS [5] Vague Input Clarification & 1-Round Cap")


# [6] Conflicting Chronic Injury Swap Filtering
def test_6_conflicting_chronic_swaps_filtered():
    _reset_db_and_state()
    state = main.load_live_state()
    state["injuries"]["shoulders"] = True
    state["injuries"]["chronic_profile"] = {
        "shoulders": {"permanent": True, "label": "Left Rotator Cuff", "laterality": "left", "notes": "Chronic"}
    }
    main.save_live_state(state)

    rep = diagnostics_ai.analyze_athlete_symptoms(
        diagnostics_ai.SymptomInputModel(raw_text="Sharp right patellar knee pain descending stairs"),
        main.load_live_state(),
    )
    swaps = rep["adaptor_handoff"]["recommended_swaps"]
    assert len(swaps) > 0
    for sid in swaps:
        assert not exercise_biomechanics.is_exercise_contraindicated_py(sid, ["shoulders", "knees"]), (
            f"Swap '{sid}' violates merged shoulders+knees injuries"
        )
    print("PASS [6] Conflicting Chronic Injury Swap Filtering")


# [7] Mocked Gemini Happy Path + Markup Strip + Timeout / 429 / Malformed Failover
def test_7_gemini_happy_path_and_failover():
    _reset_db_and_state()
    # Assert flattened schema has no $defs / $ref / title
    schema_txt = json.dumps(diagnostics_ai.GEMINI_RESPONSE_SCHEMA)
    assert '"$defs"' not in schema_txt and '"$ref"' not in schema_txt and '"title"' not in schema_txt

    happy_json = {
        "summary_headline": "<strong>Left Knee</strong> Patellar Overload **Mild**",
        "anatomical_region": "knee",
        "laterality": "left",
        "severity": "mild",
        "triage_level": "green_modify",
        "red_flags": {"triggered": False, "flags": [], "clinical_action": "Modify load", "training_clearance": "modified_allowed"},
        "probable_causes": [{"rank": 1, "label": "Patellar overload", "likelihood": "high", "confidence_pct": 80, "mechanism": "Impact volume", "supporting_evidence": ["Reported stair pain"]}],
        "load_correlations": [],
        "action_plan": {"immediate_relief_protocol": ["Spanish squat hold"], "load_management_guidance": "Swap squats", "recovery_horizon_hours": "48h", "return_to_load_criteria": ["Pain-free squat"]},
        "adaptor_handoff": {"affected_joints": ["knees"], "movement_restrictions": ["deep_knee_flexion"], "restricted_exercise_ids": ["barbell_squat"], "rest_recommended": False, "summary_note": "<script>x</script>Knee load", "expires_hint_hours": 48},
    }
    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["timeout"] = timeout
        m = MagicMock(status_code=200)
        m.json.return_value = {"candidates": [{"content": {"parts": [{"text": __import__("json").dumps(happy_json)}]}}]}
        return m

    with patch.dict(os.environ, {"GEMINI_API_KEY": "secret-gem-key"}), patch.object(requests, "post", side_effect=fake_post):
        rep = diagnostics_ai.analyze_athlete_symptoms(
            diagnostics_ai.SymptomInputModel(raw_text="Left knee ache going down stairs"),
            main.load_live_state(),
        )
        assert rep["engine"] == "ai"
        assert rep["model_id"] == "gemini-2.5-flash"
        assert "secret-gem-key" not in captured["url"]
        assert captured["headers"]["x-goog-api-key"] == "secret-gem-key"
        assert captured["timeout"] == (4.0, 14.0)
        assert "<strong>" not in rep["summary_headline"] and "**" not in rep["summary_headline"]
        assert "<script>" not in rep["adaptor_handoff"]["summary_note"]

    # Failover cases: Timeout, HTTP 429, malformed JSON
    with patch.dict(os.environ, {"GEMINI_API_KEY": "secret-gem-key"}):
        with patch.object(requests, "post", side_effect=requests.Timeout("timed out")):
            r_to = diagnostics_ai.analyze_athlete_symptoms(diagnostics_ai.SymptomInputModel(raw_text="Left shoulder pinch on dips"), main.load_live_state())
            assert r_to["engine"] == "deterministic_fallback" and "timeout" in r_to["fallback_reason"]

        r429 = MagicMock(status_code=429)
        with patch.object(requests, "post", return_value=r429):
            r_rl = diagnostics_ai.analyze_athlete_symptoms(diagnostics_ai.SymptomInputModel(raw_text="Left shoulder pinch on dips"), main.load_live_state())
            assert r_rl["engine"] == "deterministic_fallback" and r_rl["fallback_reason"] == "gemini_http_429"

        r_bad = MagicMock(status_code=200)
        r_bad.json.return_value = {"candidates": [{"content": {"parts": [{"text": "{not-valid-json"}]}}]}
        with patch.object(requests, "post", return_value=r_bad):
            r_mal = diagnostics_ai.analyze_athlete_symptoms(diagnostics_ai.SymptomInputModel(raw_text="Left shoulder pinch on dips"), main.load_live_state())
            assert r_mal["engine"] == "deterministic_fallback"

    print("PASS [7] Mocked Gemini Happy Path, Markup Strip & Timeout/429/Malformed Failover")


# [8] HTTP Endpoints & Read-Only Live State Guarantee
def test_8_http_endpoints_and_readonly_guarantee():
    _reset_db_and_state()
    st_unauth, _, _ = asgi_json("POST", "/api/diagnostics/analyze", {"raw_text": "knee pain"}, auth=False)
    assert st_unauth == 401

    before_injuries = main.load_live_state()["injuries"]
    st, _, rep = asgi_json("POST", "/api/diagnostics/analyze", {
        "raw_text": "Right knee patellar ache after skipping intervals",
        "input_mode": "voice_edited",
        "transcript_edited": True,
        "pain_severity": 4,
    })
    assert st == 200
    assert rep["anatomical_region"] == "knee"
    assert main.load_live_state()["injuries"] == before_injuries, "/api/diagnostics/analyze must NEVER mutate live_state['injuries']"

    st_h, _, hist = asgi_json("GET", "/api/diagnostics/history?limit=10")
    assert st_h == 200 and hist["count"] == 1
    aid = rep["assessment_id"]
    assert hist["history"][0]["applied_to_adaptor"] is False

    st_a, _, app_res = asgi_json("POST", f"/api/diagnostics/{aid}/apply")
    assert st_a == 200 and app_res["applied_to_adaptor"] is True

    _, _, hist2 = asgi_json("GET", "/api/diagnostics/history?limit=10")
    assert hist2["history"][0]["applied_to_adaptor"] is True

    st_404, _, _ = asgi_json("POST", "/api/diagnostics/nonexistent-uuid/apply")
    assert st_404 == 404
    print("PASS [8] HTTP Endpoints (/analyze, /history, /apply) & Read-Only Guarantee")


# [9] Hardened POST /api/athlete/injuries & Permanent Chronic Invariant
def test_9_hardened_injuries_endpoint():
    _reset_db_and_state()
    st, _, res = asgi_json("POST", "/api/athlete/injuries", {
        "lumbar": False,
        "shoulders": False,
        "knees": True,
        "notes": "Acute patellar flare",
        "updated_at_ms": 1700000000000,
        "chronic_profile": {
            "shoulders": {"permanent": True, "label": "Left AC Joint", "laterality": "left", "notes": "Old dislocation"}
        },
        "active_constraints": {
            "knees": {
                "severity": "moderate",
                "source": "diagnostic",
                "laterality": "right",
                "anatomical_region": "knee",
                "movement_restrictions": ["deep_knee_flexion", "fake_ignored_restr"],
                "restricted_exercise_ids": ["barbell_squat", "nonexistent_ex"],
                "assessment_id": "a-1",
                "applied_at": "2026-11-21T07:00:00",
                "expires_hint_hours": 72,
            },
            # Orphaned false joint should be pruned
            "wrists": {"severity": "mild", "source": "manual"},
        },
        "last_diagnostic_summary": {
            "assessment_id": "a-1",
            "generated_at": "2026-11-21T07:00:00",
            "summary_headline": "<b>Right Knee</b> Overload",
            "anatomical_region": "knee",
            "severity": "moderate",
            "triage_level": "amber_deload",
            "affected_joints": ["knees"],
        },
    })
    assert st == 200
    inj = res["injuries"]
    assert inj["shoulders"] is True, "chronic_profile.shoulders.permanent must enforce shoulders=True"
    assert inj["knees"] is True
    assert "wrists" not in inj["active_constraints"]
    assert inj["active_constraints"]["knees"]["movement_restrictions"] == ["deep_knee_flexion"]
    assert inj["active_constraints"]["knees"]["restricted_exercise_ids"] == ["barbell_squat"]
    assert "<b>" not in inj["last_diagnostic_summary"]["summary_headline"]

    # Reject Infinity JSON
    st_inf, _, _ = asgi_json("POST", "/api/athlete/injuries", raw_body=b'{"notes":"x","updated_at_ms":Infinity}')
    assert st_inf == 422
    print("PASS [9] Hardened POST /api/athlete/injuries & Permanent Chronic Invariant")


# [10] Permissions-Policy Header & 12-per-10m Rate Limiting
def test_10_permissions_policy_and_rate_limit():
    _reset_db_and_state()
    st_html, hdrs, _ = asyncio.run(_asgi_call("GET", "/", auth=False))
    if st_html == 200:
        assert hdrs.get("permissions-policy") == "microphone=(self)", f"Expected Permissions-Policy header, got {hdrs}"

    for i in range(12):
        st_ok, _, _ = asgi_json("POST", "/api/diagnostics/analyze", {"raw_text": f"Left knee ache attempt {i}"})
        assert st_ok == 200, f"Request {i+1} unexpectedly failed with {st_ok}"

    st_rl, hdrs_rl, _ = asgi_json("POST", "/api/diagnostics/analyze", {"raw_text": "Left knee ache attempt 13"})
    assert st_rl == 429
    assert int(hdrs_rl.get("retry-after", "0")) > 0
    print("PASS [10] Permissions-Policy Header & Diagnostics 429 Rate Limit")


if __name__ == "__main__":
    test_1_exercise_biomechanics_parity()
    test_2_context_aggregator_dedup_and_budget()
    test_3_empty_history_fallback()
    test_4_red_flags_override_and_ordering()
    test_5_vague_clarification_and_one_round_cap()
    test_6_conflicting_chronic_swaps_filtered()
    test_7_gemini_happy_path_and_failover()
    test_8_http_endpoints_and_readonly_guarantee()
    test_9_hardened_injuries_endpoint()
    test_10_permissions_policy_and_rate_limit()
    print("ALL 10 DIAGNOSTICS BACKEND SUITES PASSED")
