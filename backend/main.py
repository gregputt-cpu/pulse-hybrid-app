import os
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from benefits_engine import PhysiologicalBenefitsEngine
from garmin_sync_service import GarminSyncService
from mnd_sync_service import MyNetDiarySyncService
from renpho_sync_service import RenphoSyncService

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

LIVE_STATE_PATH = os.environ.get("LIVE_STATE_PATH", "/home/antigravity/live_state.json")
if not os.path.exists(LIVE_STATE_PATH):
    LIVE_STATE_PATH = "live_state.json"

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

@app.get("/")
def root():
    return {
        "service": "PULSE • Hybrid Athlete OS Cloud Engine",
        "status": "online",
        "docs": "/docs",
        "version": "1.0.0"
    }

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
    try:
        updated = garmin_service.sync_today(target_date)
        try:
            mnd_res = mnd_service.fetch_today_data(target_date)
            if mnd_res.get("success"):
                updated = load_live_state()
        except Exception as ex:
            logger.warning(f"MND sync during Garmin pull: {ex}")
        return {"success": True, "state": updated}
    except Exception as e:
        logger.error(f"Garmin sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/mnd/status")
def mnd_status():
    return mnd_service.get_status()

@app.get("/api/mnd/sync")
@app.post("/api/mnd/sync")
def sync_mnd(payload: Optional[DatePayload] = None):
    target_date = payload.date if payload else None
    try:
        res = mnd_service.fetch_today_data(target_date)
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

@app.post("/api/sync_set")
def sync_set(payload: SetLogPayload):
    state = load_live_state()
    sp = state.setdefault("strength_prescriptions", {}).setdefault(payload.exercise_id, {})
    if payload.logged_weight is not None:
        sp["last_logged_weight"] = payload.logged_weight
    if payload.logged_reps is not None:
        sp["last_logged_reps"] = payload.logged_reps
    save_live_state(state)
    return {"success": True, "result": sp}

# Background Continuous Sync (APScheduler)
from apscheduler.schedulers.background import BackgroundScheduler

def run_scheduled_sync():
    logger.info("[Scheduler] Starting scheduled sync with Garmin, MyNetDiary, and Renpho...")
    try:
        garmin_service.sync_today()
        mnd_service.fetch_today_data()
        renpho_service.sync_latest()
        logger.info("[Scheduler] Periodic sync completed successfully.")
    except Exception as e:
        logger.warning(f"[Scheduler] Sync warning: {e}")

scheduler = BackgroundScheduler()
scheduler.add_job(run_scheduled_sync, "interval", minutes=15)
scheduler.start()
