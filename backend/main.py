import os
import json
import hmac
import hashlib
import logging
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional, Dict, Any, Union, List

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from garminconnect import GarminConnectAuthenticationError
from pydantic import BaseModel

from benefits_engine import PhysiologicalBenefitsEngine
from garmin_sync_service import GarminSyncService
from mnd_sync_service import MyNetDiarySyncService
from renpho_sync_service import RenphoSyncService
import db
import state_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pulse-backend")

PULSE_API_SECRET = os.environ.get("PULSE_API_SECRET", "").strip()
PULSE_SESSION_COOKIE = "pulse_session"
_PUBLIC_API_PATHS = {"/api/health", "/api/auth/status", "/api/auth/login"}

if not PULSE_API_SECRET:
    logger.warning("[SECURITY] PULSE_API_SECRET is not set. Configure PULSE_API_SECRET in Railway Variables to require authentication on /api/* endpoints.")

def _sign_session_token(secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), b"pulse-hybrid-session-v1", hashlib.sha256).hexdigest()

def _is_request_authenticated(request: Request) -> bool:
    if not PULSE_API_SECRET:
        return True
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if hmac.compare_digest(token, PULSE_API_SECRET):
            return True
    api_key = request.headers.get("x-api-key", "").strip()
    if api_key and hmac.compare_digest(api_key, PULSE_API_SECRET):
        return True
    cookie_val = request.cookies.get(PULSE_SESSION_COOKIE, "")
    expected_cookie = _sign_session_token(PULSE_API_SECRET)
    if cookie_val and hmac.compare_digest(cookie_val, expected_cookie):
        return True
    return False

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    scheduler.add_job(
        run_scheduled_sync,
        "interval",
        minutes=5,
        id="pulse_periodic_sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=120,
    )
    if not scheduler.running:
        scheduler.start()
        logger.info("[Scheduler] BackgroundScheduler started via FastAPI lifespan.")
    try:
        yield
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)
            logger.info("[Scheduler] BackgroundScheduler stopped gracefully.")

app = FastAPI(
    title="PULSE • Hybrid Athlete Cloud Engine",
    description="24/7 Autoregulation, Telemetry Ingestion, and Caloric Runway Backend",
    version="1.0.0",
    lifespan=lifespan,
)

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "").strip()
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip() and o.strip() != "*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=bool(_allowed_origins),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)

@app.middleware("http")
async def api_auth_and_cache_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and request.method != "OPTIONS" and path not in _PUBLIC_API_PATHS:
        if not _is_request_authenticated(request):
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    response = await call_next(request)
    if path == "/" or path.endswith((".html", ".js", ".css", ".json")) or path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

LIVE_STATE_PATH = state_store.get_live_state_path()
state_store.ensure_live_state_seeded(LIVE_STATE_PATH)

garmin_service = GarminSyncService()
mnd_service = MyNetDiarySyncService()
renpho_service = RenphoSyncService()
benefits_engine = PhysiologicalBenefitsEngine()

def load_live_state(raise_on_corrupt: bool = False) -> Dict[str, Any]:
    return state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=raise_on_corrupt)

def save_live_state(state: Dict[str, Any]):
    state_store.save_live_state(state, LIVE_STATE_PATH)

class SetLogPayload(BaseModel):
    exercise_id: str
    target_weight: Optional[Any] = None
    target_reps: Optional[Union[int, str]] = None
    logged_weight: Optional[Union[float, int, str]] = None
    logged_reps: Optional[Union[int, float, str]] = None

class MndLoginPayload(BaseModel):
    login: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    password: str

class ActivitySyncPayload(BaseModel):
    name: str
    sub_title: Optional[str] = None
    duration_min: Optional[float] = 0.0
    calories: Optional[float] = 0.0
    avg_hr: Optional[float] = 0.0
    max_hr: Optional[float] = 0.0
    aerobic_te: Optional[float] = 0.0
    anaerobic_te: Optional[float] = 0.0
    steps: Optional[int] = None
    distance_miles: Optional[float] = None
    benefits: Optional[Any] = None
    date: Optional[str] = None

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
    reps: Union[int, str]

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
        "timestamp": datetime.now(ZoneInfo("Europe/London")).isoformat(),
        "state_loaded": os.path.exists(LIVE_STATE_PATH)
    }

class AuthLoginPayload(BaseModel):
    secret: str

@app.get("/api/auth/status")
def auth_status(request: Request):
    return {
        "auth_required": bool(PULSE_API_SECRET),
        "authenticated": _is_request_authenticated(request)
    }

@app.post("/api/auth/login")
def auth_login(payload: AuthLoginPayload, request: Request, response: Response):
    if not PULSE_API_SECRET:
        return {"success": True, "auth_required": False}
    if not hmac.compare_digest(payload.secret.strip(), PULSE_API_SECRET):
        raise HTTPException(status_code=401, detail="Invalid access key")
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"
    response.set_cookie(
        key=PULSE_SESSION_COOKIE,
        value=_sign_session_token(PULSE_API_SECRET),
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return {"success": True, "authenticated": True}

@app.get("/api/live_state")
def get_live_state():
    return load_live_state()

@app.post("/api/garmin/sync")
def sync_garmin(payload: Optional[DatePayload] = None):
    target_date = payload.date if payload else None
    garmin_sync_error = None
    try:
        try:
            garmin_service.sync_today(target_date, force=True)
        except Exception as gex:
            gex_str = str(gex)
            is_auth_exc = isinstance(gex, GarminConnectAuthenticationError) or any(
                term in gex_str for term in ("401", "Unauthorized", "invalid_grant", "No valid Garmin token", "OAuth")
            )
            if is_auth_exc and payload and payload.email and payload.password:
                login_res = garmin_service.login_with_credentials(payload.email, payload.password)
                if login_res.get("needs_mfa"):
                    return login_res
                if not login_res.get("success"):
                    return {"success": False, "error": login_res.get("error", "Authentication failed")}
                try:
                    garmin_service.sync_today(target_date, force=True)
                except Exception as gex2:
                    garmin_sync_error = str(gex2)
                    logger.warning(f"Direct Garmin OAuth sync notice after login (falling back to MND Garmin bridge): {gex2}")
            else:
                garmin_sync_error = gex_str
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
            "garmin_error": garmin_sync_error
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
        garmin_service.sync_today(force=True)
    except Exception as e:
        logger.warning(f"Garmin sync after MFA warning: {e}")
    updated = load_live_state()
    return {
        "success": True,
        "state": updated,
        "live_state": updated,
        "has_fresh_token": True
    }

class RestoreGarminSessionPayload(BaseModel):
    garmin_state: Optional[Dict[str, Any]] = None
    date: Optional[str] = None

@app.post("/api/garmin/restore_session")
def restore_garmin_session(payload: RestoreGarminSessionPayload):
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if payload.garmin_state and isinstance(payload.garmin_state, dict):
            garmin = state.setdefault("garmin", {})
            for k in ("body_battery", "training_readiness", "sleep_score", "sleep_duration", "resting_hr", "hrv_status", "hrv_weekly_avg", "oauth_date", "sleep_score_source", "body_battery_manual_date", "sleep_score_manual_date", "readiness_manual_date"):
                if payload.garmin_state.get(k) is not None and (garmin.get(k) is None or k.endswith("_manual_date")):
                    garmin[k] = payload.garmin_state[k]
            if payload.date:
                state["date"] = payload.date
            save_live_state(state)
    return {
        "success": True,
        "restored_token": False,
        "state": state
    }

@app.get("/api/mnd/status")
def mnd_status():
    return mnd_service.get_status()

@app.post("/api/mnd/login")
def mnd_login(payload: MndLoginPayload):
    username = (payload.login or payload.username or payload.email or "").strip()
    if not username or not payload.password:
        raise HTTPException(status_code=400, detail="Username/email and password are required")
    res = mnd_service.login(username, payload.password)
    if not res.get("success"):
        return {
            "success": False,
            "status": "error",
            "error": res.get("error", "Invalid username/email or password."),
        }
    sync_data = None
    try:
        sync_data = mnd_service.fetch_today_data()
    except Exception as e:
        logger.warning(f"Post-login MyNetDiary sync warning: {e}")
    return {
        "success": True,
        "status": "success",
        "username": username,
        "message": res.get("message", "Successfully authenticated with MyNetDiary"),
        "sync_data": sync_data,
    }

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

class ManualMndPayload(BaseModel):
    totals: Dict[str, Any]
    meals: Optional[Dict[str, Any]] = None
    date: Optional[str] = None

@app.post("/api/mnd/manual")
def manual_mnd_entry(payload: ManualMndPayload):
    t = payload.totals or {}
    now_uk = datetime.now(ZoneInfo("Europe/London"))
    date_str = payload.date or now_uk.date().isoformat()
    cals = int(round(float(t.get("calories") or 0)))
    prot = int(round(float(t.get("protein") or t.get("protein_g") or 0)))
    carbs = int(round(float(t.get("carbs") or t.get("carbs_g") or 0)))
    fat = int(round(float(t.get("fat") or t.get("fat_g") or 0)))
    fiber = int(round(float(t.get("fiber") or t.get("fiber_g") or 0)))
    sodium = int(round(float(t.get("sodium") or t.get("sodium_mg") or 0)))
    water = round(float(t.get("water") or t.get("water_l") or 0.0), 2)

    mnd_logged = {
        "date": date_str,
        "calories": max(0, cals),
        "protein_g": max(0, prot),
        "carbs_g": max(0, carbs),
        "fat_g": max(0, fat),
        "fiber_g": max(0, fiber),
        "sodium_mg": max(0, sodium),
        "water_l": max(0.0, water),
        "source": "manual_override",
        "last_pulled": now_uk.isoformat(),
    }

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        state["mnd_logged"] = mnd_logged
        state.setdefault("garmin", {})["mnd_logged"] = mnd_logged
        if isinstance(payload.meals, dict):
            state["mnd_meals"] = payload.meals
            state["garmin"]["mnd_meals"] = payload.meals
        nutrition = state.setdefault("nutrition", {})
        cal_target = int(nutrition.get("calorie_target") or (2092 + int(state.get("garmin", {}).get("active_calories") or 0)))
        nutrition["calories_remaining"] = cal_target - mnd_logged["calories"]
        prot_target = int(nutrition.get("protein_target_g") or 200)
        nutrition["protein_remaining"] = max(0, prot_target - mnd_logged["protein_g"])
        save_live_state(state)

    return {"success": True, "mnd_logged": mnd_logged, "state": state}

@app.post("/api/renpho/sync")
def sync_renpho():
    try:
        res = renpho_service.sync_latest(force=True)
        state = load_live_state()
        return {"success": True, "renpho": state.get("renpho", {}), "state": state}
    except Exception as e:
        logger.error(f"Renpho sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/renpho/manual")
def manual_renpho_entry(payload: ManualScalePayload):
    weight_kg = round(float(payload.weight_kg), 2)
    if weight_kg <= 20.0 or weight_kg >= 300.0:
        raise HTTPException(status_code=422, detail="weight_kg must be between 20 and 300 kg")
    if payload.body_fat_pct is not None:
        bf_check = float(payload.body_fat_pct)
        if bf_check < 3.0 or bf_check > 60.0:
            raise HTTPException(status_code=422, detail="body_fat_pct must be between 3 and 60")

    now_uk = datetime.now(ZoneInfo("Europe/London"))
    last_synced = now_uk.strftime('%Y-%m-%d %H:%M:%S')
    today_str = now_uk.date().isoformat()
    muscle_mass_kg = None
    water_pct = None

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if payload.body_fat_pct is not None:
            body_fat_pct = round(float(payload.body_fat_pct), 1)
            lean_mass_kg = round(weight_kg * (1.0 - (body_fat_pct / 100.0)), 2)
        else:
            existing_lbm = state.get('renpho', {}).get('lean_mass_kg') or state.get('athlete', {}).get('lean_mass_kg', 80.99)
            lean_mass_kg = round(float(existing_lbm), 2)
            body_fat_pct = round(max(0.0, (weight_kg - lean_mass_kg) / weight_kg) * 100.0, 1)

        target_weight_at_15pct = round(lean_mass_kg / (1.0 - 0.15), 2)
        fat_to_lose_kg = round(max(0.0, weight_kg - target_weight_at_15pct), 2)

        renpho_state = state.setdefault("renpho", {})
        muscle_mass_kg = renpho_state.get("muscle_mass_kg")
        water_pct = renpho_state.get("water_pct")
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

    try:
        db.upsert_renpho_measurements([{
            "id": f"manual_{today_str}",
            "timeStamp": int(now_uk.timestamp()),
            "localCreatedAt": last_synced,
            "weight": weight_kg,
            "bodyfat": body_fat_pct,
            "fatFreeWeight": lean_mass_kg,
            "sinew": muscle_mass_kg if muscle_mass_kg is not None else round(max(0.0, lean_mass_kg - 4.0), 2),
            "water": water_pct if water_pct is not None else 0.0,
        }])
    except Exception as dbe:
        logger.warning(f"Failed upserting manual Renpho entry to SQLite: {dbe}")

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

        with state_store.state_lock(LIVE_STATE_PATH):
            state = load_live_state(raise_on_corrupt=True)
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

def _coerce_weight_kg(val: Any) -> Optional[float]:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().lower()
    if not s:
        return None
    if s in ("body", "bw", "bodyweight", "body weight"):
        return 0.0
    if s.endswith("kg"):
        s = s[:-2].strip()
    try:
        return float(s)
    except ValueError:
        return None

def _coerce_int_reps(val: Any) -> Optional[int]:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(round(val))
    s = str(val).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None

@app.post("/api/sync_set")
def sync_set(payload: SetLogPayload):
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        sp = state.setdefault("strength_prescriptions", {}).setdefault(payload.exercise_id, {})
        if payload.logged_weight is not None:
            sp["last_logged_weight"] = payload.logged_weight
        if payload.logged_reps is not None:
            sp["last_logged_reps"] = payload.logged_reps

        w = _coerce_weight_kg(payload.logged_weight)
        r = _coerce_int_reps(payload.logged_reps)
        target_r = _coerce_int_reps(payload.target_reps)

        if w is not None and r is not None:
            e1rm = round(w * (1.0 + r / 30.0), 1)
            db.log_strength_set(payload.exercise_id, w, r, e1rm)
            sp["last_e1rm"] = e1rm
            sp["e1rm"] = e1rm
            eff_target_r = target_r or r
            pct_diff = ((r - eff_target_r) / eff_target_r) if eff_target_r > 0 else 0.0
            is_severe_underperf = (r == 0) or (eff_target_r - r >= 3) or (eff_target_r > 0 and r <= int(eff_target_r * 0.65)) or (pct_diff <= -0.20)
            if target_r and r >= target_r:
                sp["progression_ready"] = True
                sp["status"] = "progressed"
                sp["weight"] = round(w + (2.5 if w > 0 else 0.0), 1) if w > 0 else payload.logged_weight
                sp["reps"] = target_r if w > 0 else (r + 1)
            elif is_severe_underperf and w > 0:
                sp["progression_ready"] = False
                sp["status"] = "deloaded"
                deload_w = max(20.0, round((w * 0.85) / 2.5) * 2.5)
                sp["weight"] = deload_w
                sp["reps"] = eff_target_r
            else:
                sp["progression_ready"] = False
                sp["status"] = "holding"
                sp["weight"] = w if w > 0 else payload.logged_weight
                sp["reps"] = eff_target_r

        save_live_state(state)
    return {"success": True, "status": "success", "result": sp}

@app.post("/api/sync_session")
def sync_session(payload: Dict[str, Any]):
    now_iso = datetime.now(ZoneInfo("Europe/London")).isoformat()
    entry = dict(payload or {})
    entry.setdefault("date", now_iso)
    entry["synced_at"] = now_iso
    try:
        db.log_workout_session(entry)
    except Exception as e:
        logger.warning(f"Could not save workout session to db: {e}")

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        history = state.setdefault("session_history", [])
        if not isinstance(history, list):
            history = []
            state["session_history"] = history
        history.insert(0, entry)
        state["session_history"] = history[:50]
        state["last_workout_session"] = entry
        save_live_state(state)
    return {"success": True, "status": "success", "session": entry}

@app.post("/api/sync_activity")
def sync_activity(payload: ActivitySyncPayload):
    now_uk = datetime.now(ZoneInfo("Europe/London"))
    act_id = int(now_uk.timestamp() * 1000)
    date_str = payload.date or now_uk.strftime("%Y-%m-%d %H:%M:%S")
    dur = round(float(payload.duration_min or 0), 1)
    cals = int(round(float(payload.calories or 0)))
    avg_hr = int(round(float(payload.avg_hr or 0)))
    max_hr = int(round(float(payload.max_hr or 0)))
    aero_te = float(payload.aerobic_te or 0.0)
    anaero_te = float(payload.anaerobic_te or 0.0)
    sub_title = (payload.sub_title or payload.name).strip()

    benefits = payload.benefits
    if not benefits:
        try:
            benefits = benefits_engine.generate_benefits(
                payload.name, sub_title, dur, cals, avg_hr, max_hr, aero_te, anaero_te
            )
        except Exception:
            benefits = []

    entry = {
        "id": act_id,
        "name": payload.name,
        "sub_title": sub_title,
        "date": date_str,
        "duration_min": dur,
        "calories": cals,
        "avg_hr": avg_hr,
        "max_hr": max_hr,
        "aerobic_te": aero_te,
        "anaerobic_te": anaero_te,
        "steps": payload.steps,
        "distance_miles": payload.distance_miles,
        "benefits": benefits,
        "source": "manual_app_entry",
    }

    try:
        db.log_manual_activity(entry)
    except Exception as e:
        logger.warning(f"Could not save manual activity to db: {e}")

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        garmin = state.setdefault("garmin", {})
        today_list = garmin.setdefault("today_activities", [])
        recent_list = garmin.setdefault("recent_activities", [])
        today_str = now_uk.date().isoformat()
        if str(date_str).startswith(today_str):
            today_list.insert(0, entry)
            garmin["active_calories"] = int(garmin.get("active_calories") or 0) + cals
            nutrition = state.setdefault("nutrition", {})
            baseline_budget = 2092
            nutrition["calorie_target"] = baseline_budget + garmin["active_calories"]
            mnd_cals = garmin.get("mnd_logged", {}).get("calories", 0) or state.get("mnd_logged", {}).get("calories", 0)
            nutrition["calories_remaining"] = nutrition["calorie_target"] - mnd_cals
        recent_list.insert(0, entry)
        garmin["recent_activities"] = recent_list[:100]
        save_live_state(state)

    return {"success": True, "status": "success", "activity": entry, "state": state}

@app.post("/api/athlete/injuries")
def save_athlete_injuries(payload: Dict[str, Any]):
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        state["injuries"] = payload
        save_live_state(state)
    return {"success": True, "injuries": payload}

@app.post("/api/telemetry/override")
def override_telemetry(payload: TelemetryOverridePayload):
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
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
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        prescriptions = state.setdefault("strength_prescriptions", {})
        item = prescriptions.setdefault(payload.exercise_id, {})

        item["weight"] = payload.weight
        item["reps"] = payload.reps
        item["last_logged_weight"] = payload.weight
        item["last_logged_reps"] = payload.reps

        # Optionally calculate e1rm if both weight and reps are numeric
        w_val = _coerce_weight_kg(payload.weight)
        r_val = _coerce_int_reps(payload.reps)
        if w_val is not None and r_val is not None and w_val > 0 and r_val > 0:
            e1rm = round(w_val * (1.0 + r_val / 30.0), 1)
            item["e1rm"] = e1rm
            item["last_e1rm"] = e1rm

        save_live_state(state)
    return {"success": True, "exercise_id": payload.exercise_id, "prescription": item}

@app.post("/api/preferences/exercises")
def update_exercise_preferences(payload: ExercisePreferencesPayload):
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
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
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
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

def run_scheduled_sync():
    logger.info("[Scheduler] Starting scheduled sync with Garmin, MyNetDiary, and Renpho...")
    try:
        garmin_service.sync_today()
    except Exception as gex:
        logger.warning(f"[Scheduler] Garmin sync notice: {gex}")
    try:
        mnd_service.fetch_today_data()
    except Exception as mex:
        logger.warning(f"[Scheduler] MyNetDiary sync notice: {mex}")
    try:
        renpho_service.sync_latest()
    except Exception as rex:
        logger.warning(f"[Scheduler] Renpho sync notice: {rex}")
    logger.info("[Scheduler] Periodic sync cycle completed.")
