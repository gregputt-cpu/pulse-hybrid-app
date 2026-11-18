import os
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, Union, List

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from benefits_engine import PhysiologicalBenefitsEngine
from garmin_sync_service import GarminSyncService
from mnd_sync_service import MyNetDiarySyncService
from renpho_sync_service import RenphoSyncService
import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pulse-backend")

app = FastAPI(
    title="PULSE • Hybrid Athlete Cloud Engine",
    description="24/7 Autoregulation, Telemetry Ingestion, and Caloric Runway Backend",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def no_cache_static_assets(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css", ".json")) or path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STATE_PATH = os.path.join(REPO_ROOT, "live_state.json")
if not os.path.exists(DEFAULT_STATE_PATH):
    DEFAULT_STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_state.json")
LIVE_STATE_PATH = os.environ.get("LIVE_STATE_PATH", DEFAULT_STATE_PATH)

garmin_service = GarminSyncService()
mnd_service = MyNetDiarySyncService()
renpho_service = RenphoSyncService()
benefits_engine = PhysiologicalBenefitsEngine()

def load_live_state() -> Dict[str, Any]:
    if os.path.exists(LIVE_STATE_PATH):
        try:
            with open(LIVE_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed reading live state: {e}")
    return {}

def save_live_state(state: Dict[str, Any]):
    try:
        with open(LIVE_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        backend_copy = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_state.json")
        if backend_copy != LIVE_STATE_PATH:
            with open(backend_copy, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
    except Exception as e:
        logger.error(f"Failed saving live state: {e}")

class SetLogPayload(BaseModel):
    exercise_id: str
    target_weight: Optional[Any] = None
    target_reps: Optional[int] = None
    logged_weight: Optional[float] = None
    logged_reps: Optional[int] = None

class DatePayload(BaseModel):
    date: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    garmin_tokens_json: Optional[str] = None

class MfaPayload(BaseModel):
    mfa_code: str

class HydrationPayload(BaseModel):
    amount_ml: int = 500
    date: Optional[str] = None

class TelemetryOverridePayload(BaseModel):
    sleep_score: Optional[int] = None
    sleep_duration: Optional[str] = None
    body_battery: Optional[int] = None
    training_readiness: Optional[int] = None
    date: Optional[str] = None
    key: Optional[str] = None
    value: Optional[Union[int, float, str]] = None
    category: Optional[str] = None

class PrescriptionOverridePayload(BaseModel):
    exercise_id: str
    weight: Union[float, int, str]
    reps: int

class ExercisePreferencesPayload(BaseModel):
    custom_exercises: Optional[List[Any]] = None
    permanent_swaps: Optional[Dict[str, Any]] = None
    hidden_exercises: Optional[List[Any]] = None

class ManualScalePayload(BaseModel):
    weight_kg: float
    body_fat_pct: Optional[float] = None


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(os.path.join(static_dir, "css")):
    app.mount("/css", StaticFiles(directory=os.path.join(static_dir, "css")), name="css")
if os.path.isdir(os.path.join(static_dir, "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(static_dir, "js")), name="js")

@app.get("/")
def root():
    static_index = os.path.join(static_dir, "index.html")
    if os.path.exists(static_index):
        return FileResponse(static_index)
    return {
        "service": "PULSE • Hybrid Athlete OS Cloud Engine",
        "status": "online",
        "docs": "/docs",
        "version": "1.0.0"
    }

@app.get("/sw.js")
def get_sw():
    sw_file = os.path.join(static_dir, "sw.js")
    if os.path.exists(sw_file):
        return FileResponse(sw_file, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="sw.js not found")

@app.get("/manifest.json")
def get_manifest():
    mf_file = os.path.join(static_dir, "manifest.json")
    if os.path.exists(mf_file):
        return FileResponse(mf_file, media_type="application/manifest+json")
    raise HTTPException(status_code=404, detail="manifest.json not found")

@app.get("/icon.svg")
def get_icon_svg():
    p = os.path.join(static_dir, "icon.svg")
    if os.path.exists(p):
        return FileResponse(p, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="icon.svg not found")

@app.get("/icon-192.png")
def get_icon_192():
    p = os.path.join(static_dir, "icon-192.png")
    if os.path.exists(p):
        return FileResponse(p, media_type="image/png")
    raise HTTPException(status_code=404, detail="icon-192.png not found")

@app.get("/icon-512.png")
def get_icon_512():
    p = os.path.join(static_dir, "icon-512.png")
    if os.path.exists(p):
        return FileResponse(p, media_type="image/png")
    raise HTTPException(status_code=404, detail="icon-512.png not found")

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "state_loaded": os.path.exists(LIVE_STATE_PATH)
    }

@app.get("/api/live_state")
def get_live_state():
    return load_live_state()

@app.post("/api/live_state")
def update_live_state(state: Dict[str, Any]):
    save_live_state(state)
    return {"success": True, "state": state}

@app.get("/api/garmin/export_token")
def export_garmin_token():
    tok = garmin_service.export_tokens_json()
    if not tok:
        return {"success": False, "error": "Not authenticated with Garmin"}
    return {"success": True, "garmin_tokens_json": tok}

@app.get("/api/garmin/sync")
@app.post("/api/garmin/sync")
def sync_garmin(payload: Optional[DatePayload] = None):
    target_date = payload.date if payload else None
    garmin_sync_error = None
    try:
        if payload and payload.garmin_tokens_json and garmin_service.client is None:
            garmin_service.restore_token_str(payload.garmin_tokens_json)
        try:
            garmin_service.sync_today(target_date)
        except Exception as gex:
            restored_and_synced = False
            if payload and payload.garmin_tokens_json:
                try:
                    if garmin_service.restore_token_str(payload.garmin_tokens_json):
                        garmin_service.sync_today(target_date)
                        restored_and_synced = True
                except Exception as rex:
                    gex = rex
            if not restored_and_synced:
                if payload and payload.email and payload.password:
                    login_res = garmin_service.login_with_credentials(payload.email, payload.password)
                    if login_res.get("needs_mfa"):
                        return login_res
                    if not login_res.get("success"):
                        return {"success": False, "error": login_res.get("error", "Authentication failed")}
                    try:
                        garmin_service.sync_today(target_date)
                    except Exception as gex2:
                        garmin_sync_error = str(gex2)
                        logger.warning(f"Direct Garmin OAuth sync notice after login (falling back to MND Garmin bridge): {gex2}")
                else:
                    garmin_sync_error = str(gex)
                    logger.warning(f"Direct Garmin OAuth sync notice (falling back to MND Garmin bridge): {gex}")
        try:
            mnd_service.fetch_today_data(target_date)
        except Exception as ex:
            logger.warning(f"MND sync during Garmin pull: {ex}")
        try:
            renpho_service.sync_latest()
        except Exception as rex:
            logger.warning(f"Renpho sync during Garmin pull: {rex}")
        updated = load_live_state()
        return {
            "success": True,
            "state": updated,
            "live_state": updated,
            "has_fresh_token": garmin_sync_error is None,
            "garmin_error": garmin_sync_error,
            "garmin_tokens_json": garmin_service.export_tokens_json() if garmin_sync_error is None else None
        }
    except Exception as e:
        logger.error(f"Garmin sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/garmin/submit_mfa")
def submit_garmin_mfa(payload: MfaPayload):
    res = garmin_service.submit_mfa(payload.mfa_code)
    if not res.get("success"):
        return res
    try:
        garmin_service.sync_today()
    except Exception as e:
        logger.warning(f"Garmin sync after MFA warning: {e}")
    updated = load_live_state()
    return {
        "success": True,
        "state": updated,
        "live_state": updated,
        "has_fresh_token": True,
        "garmin_tokens_json": garmin_service.export_tokens_json()
    }

class RestoreGarminSessionPayload(BaseModel):
    garmin_tokens_json: Optional[str] = None
    garmin_state: Optional[Dict[str, Any]] = None
    date: Optional[str] = None

@app.post("/api/garmin/restore_session")
def restore_garmin_session(payload: RestoreGarminSessionPayload):
    restored_token = False
    if payload.garmin_tokens_json:
        if garmin_service.restore_token_str(payload.garmin_tokens_json):
            restored_token = True
            try:
                garmin_service.sync_today(payload.date)
            except Exception as e:
                logger.warning(f"Garmin sync during session restore notice: {e}")
    state = load_live_state()
    if payload.garmin_state and isinstance(payload.garmin_state, dict):
        garmin = state.setdefault("garmin", {})
        for k in ("body_battery", "training_readiness", "sleep_score", "sleep_duration", "resting_hr", "hrv_status", "hrv_weekly_avg", "oauth_date", "sleep_score_source", "body_battery_manual_date", "sleep_score_manual_date", "readiness_manual_date"):
            if payload.garmin_state.get(k) is not None and (not restored_token or garmin.get(k) is None or k.endswith("_manual_date")):
                garmin[k] = payload.garmin_state[k]
        if payload.date:
            state["date"] = payload.date
        save_live_state(state)
    return {
        "success": True,
        "restored_token": restored_token,
        "state": load_live_state(),
        "garmin_tokens_json": garmin_service.export_tokens_json()
    }

@app.get("/api/mnd/status")
def mnd_status():
    return mnd_service.get_status()

@app.get("/api/mnd/sync")
@app.post("/api/mnd/sync")
def sync_mnd(payload: Optional[DatePayload] = None):
    target_date = payload.date if payload else None
    try:
        res = mnd_service.fetch_today_data(target_date)
        try:
            renpho_service.sync_latest()
        except Exception as rex:
            logger.warning(f"Renpho sync during MND pull: {rex}")
        state = load_live_state()
        return {"success": True, "mnd": res, "state": state}
    except Exception as e:
        logger.error(f"MyNetDiary sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/renpho/sync")
@app.post("/api/renpho/sync")
def sync_renpho():
    try:
        res = renpho_service.sync_latest()
        state = load_live_state()
        return {"success": True, "renpho": state.get("renpho", {}), "state": state}
    except Exception as e:
        logger.error(f"Renpho sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/renpho/manual")
def manual_renpho_entry(payload: ManualScalePayload):
    state = load_live_state()
    weight_kg = round(float(payload.weight_kg), 2)
    if payload.body_fat_pct is not None:
        body_fat_pct = round(float(payload.body_fat_pct), 1)
        lean_mass_kg = round(weight_kg * (1.0 - (body_fat_pct / 100.0)), 2)
    else:
        existing_lbm = state.get('renpho', {}).get('lean_mass_kg') or state.get('athlete', {}).get('lean_mass_kg', 80.99)
        lean_mass_kg = round(float(existing_lbm), 2)
        body_fat_pct = round(max(0.0, (weight_kg - lean_mass_kg) / weight_kg) * 100.0, 1)

    target_weight_at_15pct = round(lean_mass_kg / (1.0 - 0.15), 2)
    fat_to_lose_kg = round(max(0.0, weight_kg - target_weight_at_15pct), 2)
    last_synced = datetime.now(ZoneInfo("Europe/London")).strftime('%Y-%m-%d %H:%M:%S')

    renpho_state = state.setdefault("renpho", {})
    renpho_state.update({
        "weight_kg": weight_kg,
        "body_fat_pct": body_fat_pct,
        "lean_mass_kg": lean_mass_kg,
        "target_weight_at_15pct": target_weight_at_15pct,
        "fat_to_lose_kg": fat_to_lose_kg,
        "source": "manual_scale_entry",
        "last_synced": last_synced
    })

    athlete_state = state.setdefault("athlete", {})
    athlete_state.update({
        "weight_kg": weight_kg,
        "body_fat_pct": body_fat_pct,
        "lean_mass_kg": lean_mass_kg,
        "fat_to_lose_kg": fat_to_lose_kg,
        "target_weight_at_15pct": target_weight_at_15pct,
        "target_weight_kg": target_weight_at_15pct
    })

    save_live_state(state)
    return {"success": True, "renpho": state["renpho"], "state": state}


@app.get("/api/renpho/history")
def get_renpho_history(days: int = 90):
    try:
        data = renpho_service.get_history(days=days)
        return {"success": True, "days": days, "count": len(data), "history": data}
    except Exception as e:
        logger.error(f"Renpho history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/strength/history")
def get_strength_history(days: int = 30):
    try:
        data = db.get_strength_history(days=days)
        return {"success": True, "days": days, "exercises": data}
    except Exception as e:
        logger.error(f"Strength history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/hydration/add")
def add_hydration(payload: HydrationPayload):
    try:
        date_str = payload.date if payload.date else datetime.now(ZoneInfo("Europe/London")).date().isoformat()
        total_ml = db.add_hydration(date_str, payload.amount_ml)

        state = load_live_state()
        garmin_state = state.setdefault("garmin", {})
        mnd_logged = garmin_state.setdefault("mnd_logged", {})
        current_water_l = float(mnd_logged.get("water_l") or 0.0)
        new_water_l = round(current_water_l + (payload.amount_ml / 1000.0), 2)
        mnd_logged["water_l"] = new_water_l

        if "mnd_logged" in state and isinstance(state["mnd_logged"], dict):
            state["mnd_logged"]["water_l"] = new_water_l

        save_live_state(state)
        return {
            "success": True,
            "date": date_str,
            "amount_added_ml": payload.amount_ml,
            "total_ml": total_ml,
            "water_l": new_water_l
        }
    except Exception as e:
        logger.error(f"Hydration add error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sync_set")
def sync_set(payload: SetLogPayload):
    state = load_live_state()
    sp = state.setdefault("strength_prescriptions", {}).setdefault(payload.exercise_id, {})
    if payload.logged_weight is not None:
        sp["last_logged_weight"] = payload.logged_weight
    if payload.logged_reps is not None:
        sp["last_logged_reps"] = payload.logged_reps

    if payload.logged_weight is not None and payload.logged_reps is not None:
        w = float(payload.logged_weight)
        r = int(payload.logged_reps)
        e1rm = round(w * (1.0 + r / 30.0), 1)
        db.log_strength_set(payload.exercise_id, w, r, e1rm)
        sp["last_e1rm"] = e1rm
        sp["e1rm"] = e1rm
        target_r = payload.target_reps or r
        pct_diff = ((r - target_r) / target_r) if target_r > 0 else 0.0
        is_severe_underperf = (r == 0) or (target_r - r >= 3) or (target_r > 0 and r <= int(target_r * 0.65)) or (pct_diff <= -0.20)
        if payload.target_reps and r >= payload.target_reps:
            sp["progression_ready"] = True
            sp["status"] = "progressed"
            sp["weight"] = round(w + (2.5 if w > 0 else 0.0), 1) if w > 0 else w
            sp["reps"] = payload.target_reps if w > 0 else (r + 1)
        elif is_severe_underperf and w > 0:
            sp["progression_ready"] = False
            sp["status"] = "deloaded"
            deload_w = max(20.0, round((w * 0.85) / 2.5) * 2.5)
            sp["weight"] = deload_w
            sp["reps"] = target_r
        else:
            sp["progression_ready"] = False
            sp["status"] = "holding"
            sp["weight"] = w
            sp["reps"] = target_r

    save_live_state(state)
    return {"success": True, "result": sp}

@app.post("/api/athlete/injuries")
def save_athlete_injuries(payload: Dict[str, Any]):
    state = load_live_state()
    state["injuries"] = payload
    save_live_state(state)
    return {"success": True, "injuries": payload}

@app.post("/api/telemetry/override")
def override_telemetry(payload: TelemetryOverridePayload):
    state = load_live_state()
    garmin = state.setdefault("garmin", {})

    target_date = payload.date or state.get("date") or datetime.now(ZoneInfo("Europe/London")).date().isoformat()

    if payload.key == "sleep_score" and payload.value is not None:
        payload.sleep_score = int(float(payload.value))
    elif payload.key == "body_battery" and payload.value is not None:
        payload.body_battery = int(float(payload.value))
    elif payload.key == "training_readiness" and payload.value is not None:
        payload.training_readiness = int(float(payload.value))

    if payload.sleep_score is not None:
        garmin["sleep_score"] = payload.sleep_score
        garmin["sleep_score_source"] = "manual_override"
        garmin["sleep_score_manual_date"] = target_date

    if payload.sleep_duration is not None:
        garmin["sleep_duration"] = payload.sleep_duration

    if payload.body_battery is not None:
        garmin["body_battery"] = payload.body_battery
        garmin["body_battery_manual_date"] = target_date
        garmin["oauth_date"] = target_date
    elif payload.sleep_score is not None and garmin.get("body_battery") is None:
        active_cals_val = garmin.get("active_calories") or 0
        morning_bb = min(100, int(round(payload.sleep_score * 1.05)))
        burn_drain = int(round(active_cals_val / 45.0))
        garmin["body_battery"] = max(25, min(100, morning_bb - burn_drain))

    if payload.training_readiness is not None:
        garmin["training_readiness"] = payload.training_readiness
        garmin["readiness_manual_date"] = target_date
        tr_val = payload.training_readiness
        garmin["readiness_level"] = "OPTIMAL" if tr_val >= 85 else ("HIGH" if tr_val >= 75 else "MODERATE")
        garmin["readiness_feedback"] = "WELL_RECOVERED" if tr_val >= 75 else "MODERATE_LOAD"
    elif payload.sleep_score is not None and garmin.get("training_readiness") is None:
        active_cals_val = garmin.get("active_calories") or 0
        morning_bb = min(100, int(round(payload.sleep_score * 1.05)))
        calc_tr = int(round(payload.sleep_score * 0.65 + morning_bb * 0.38 - min(10, active_cals_val / 150.0)))
        calc_tr = max(40, min(98, calc_tr))
        garmin["training_readiness"] = calc_tr
        garmin["readiness_level"] = "OPTIMAL" if calc_tr >= 85 else ("HIGH" if calc_tr >= 75 else "MODERATE")
        garmin["readiness_feedback"] = "WELL_RECOVERED" if calc_tr >= 75 else "MODERATE_LOAD"

    save_live_state(state)
    return {"success": True, "garmin": garmin}

@app.post("/api/prescription/override")
def override_prescription(payload: PrescriptionOverridePayload):
    state = load_live_state()
    prescriptions = state.setdefault("strength_prescriptions", {})
    item = prescriptions.setdefault(payload.exercise_id, {})

    item["weight"] = payload.weight
    item["reps"] = payload.reps
    item["last_logged_weight"] = payload.weight
    item["last_logged_reps"] = payload.reps

    # Optionally calculate e1rm if weight is numeric
    try:
        w_val = float(payload.weight)
        e1rm = round(w_val * (1.0 + payload.reps / 30.0), 1)
        item["e1rm"] = e1rm
        item["last_e1rm"] = e1rm
    except (ValueError, TypeError):
        pass

    save_live_state(state)
    return {"success": True, "exercise_id": payload.exercise_id, "prescription": item}

@app.post("/api/preferences/exercises")
def update_exercise_preferences(payload: ExercisePreferencesPayload):
    state = load_live_state()
    prefs = state.setdefault("exercise_preferences", {})
    if payload.custom_exercises is not None:
        prefs["custom_exercises"] = payload.custom_exercises
    if payload.permanent_swaps is not None:
        prefs["permanent_swaps"] = payload.permanent_swaps
    if payload.hidden_exercises is not None:
        prefs["hidden_exercises"] = payload.hidden_exercises
    save_live_state(state)
    return {"success": True, "exercise_preferences": state["exercise_preferences"]}

class AnnotateActivityPayload(BaseModel):
    activity_id: Union[str, int]
    user_text: str

@app.post("/api/annotate_activity")
def annotate_activity(payload: AnnotateActivityPayload):
    act_id_str = str(payload.activity_id)
    text = payload.user_text.strip()
    try:
        db.set_kv(f"activity_note_{act_id_str}", text)
    except Exception as e:
        logger.warning(f"Could not save activity note to db: {e}")
    state = load_live_state()
    garmin = state.setdefault("garmin", {})
    athlete = state.get("athlete", {"weight_kg": 98.4, "body_fat_pct": 17.1})
    updated_act = None
    for lst_key in ("today_activities", "recent_activities"):
        for a in garmin.get(lst_key, []):
            if str(a.get("id")) == act_id_str:
                a["sub_title"] = text
                a["user_notes"] = text
                telemetry = {
                    "duration_min": a.get("duration_min") or 25,
                    "calories": a.get("calories") or 300,
                    "avg_hr": a.get("avg_hr") or 130,
                    "max_hr": a.get("max_hr") or 160,
                    "aerobic_te": a.get("aerobic_te") or 2.5,
                    "anaerobic_te": a.get("anaerobic_te") or 1.3
                }
                a["benefits"] = benefits_engine.analyze_workout(text, telemetry, athlete)
                updated_act = a
    save_live_state(state)
    return {"success": True, "activity_id": act_id_str, "sub_title": text, "activity": updated_act, "state": state}

# Background Continuous Sync (APScheduler)
from apscheduler.schedulers.background import BackgroundScheduler

def run_scheduled_sync():
    logger.info("[Scheduler] Starting scheduled sync with Garmin, MyNetDiary, and Renpho...")
    try:
        try:
            garmin_service.sync_today()
        except Exception as gex:
            logger.warning(f"[Scheduler] Direct Garmin OAuth notice: {gex}")
        mnd_service.fetch_today_data()
        renpho_service.sync_latest()
        logger.info("[Scheduler] Periodic sync completed successfully.")
    except Exception as e:
        logger.warning(f"[Scheduler] Sync warning: {e}")

scheduler = BackgroundScheduler()
scheduler.add_job(run_scheduled_sync, "interval", minutes=15)
scheduler.start()
