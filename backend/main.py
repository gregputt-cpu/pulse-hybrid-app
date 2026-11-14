import os
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any

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

class MfaPayload(BaseModel):
    mfa_code: str

class HydrationPayload(BaseModel):
    amount_ml: int = 500
    date: Optional[str] = None

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

@app.get("/api/garmin/sync")
@app.post("/api/garmin/sync")
def sync_garmin(payload: Optional[DatePayload] = None):
    target_date = payload.date if payload else None
    if payload and payload.email and payload.password:
        login_res = garmin_service.login_with_credentials(payload.email, payload.password)
        if login_res.get("needs_mfa"):
            return login_res
        if not login_res.get("success"):
            return {"success": False, "error": login_res.get("error", "Authentication failed")}

    try:
        try:
            garmin_service.sync_today(target_date)
        except Exception as gex:
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
        return {"success": True, "state": updated, "live_state": updated}
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
    return {"success": True, "state": updated, "live_state": updated}

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
        date_str = payload.date if payload.date else datetime.now().strftime("%Y-%m-%d")
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
        if payload.target_reps and r >= payload.target_reps:
            sp["progression_ready"] = True
            sp["weight"] = round(w + (2.5 if w > 0 else 0.0), 1) if w > 0 else w
            sp["reps"] = payload.target_reps if w > 0 else (r + 1)
        else:
            sp["progression_ready"] = False
            sp["weight"] = w
            sp["reps"] = payload.target_reps or r

    save_live_state(state)
    return {"success": True, "result": sp}

@app.post("/api/athlete/injuries")
def save_athlete_injuries(payload: Dict[str, Any]):
    state = load_live_state()
    state["injuries"] = payload
    save_live_state(state)
    return {"success": True, "injuries": payload}

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
