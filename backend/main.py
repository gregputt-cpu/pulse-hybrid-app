import os
import re
import copy
import math
import time
import json
import uuid
import hmac
import hashlib
import logging
import threading
from collections import defaultdict, deque
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass
from contextlib import asynccontextmanager, closing
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Union, List

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from garminconnect import GarminConnectAuthenticationError
from pydantic import BaseModel, ConfigDict, field_validator

import analytics_service
import autonomic_service
import diagnostics_ai
import exercise_biomechanics
from diagnostics_ai import SymptomInputModel
from diagnostics_safety import strip_markup
from benefits_engine import PhysiologicalBenefitsEngine
from garmin_sync_service import GarminSyncService
from mnd_sync_service import MyNetDiarySyncService
from renpho_sync_service import RenphoSyncService
import db
import state_store
import time_utils
from time_utils import uk_now, uk_today_str

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pulse-backend")

PULSE_API_SECRET = os.environ.get("PULSE_API_SECRET", "").strip()
PULSE_SESSION_COOKIE = "pulse_session"
_SESSION_TTL_SEC = 60 * 60 * 24 * 90
_PUBLIC_API_PATHS = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/logout"}
_LOGIN_FAIL_WINDOW_SEC = 300
_LOGIN_MAX_FAILS = 10
_LOGIN_FAILURES: Dict[str, deque] = defaultdict(deque)
_LOGIN_FAIL_LOCK = threading.Lock()
_DIAGNOSTICS_RATE_WINDOW_SEC = 600
_DIAGNOSTICS_RATE_MAX_REQS = 12
_DIAGNOSTICS_BUCKETS: Dict[str, deque] = defaultdict(deque)
_DIAGNOSTICS_RATE_LOCK = threading.Lock()

if not PULSE_API_SECRET:
    logger.warning("[SECURITY] PULSE_API_SECRET is not set. Configure PULSE_API_SECRET in Railway Variables to require authentication on /api/* endpoints.")


def _sign_session_token(secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), b"pulse-hybrid-session-v1", hashlib.sha256).hexdigest()


def _sign_session_token_v2(secret: str, exp_ts: Optional[int] = None) -> str:
    exp = int(exp_ts if exp_ts is not None else (time.time() + _SESSION_TTL_SEC))
    sig = hmac.new(
        secret.encode("utf-8"),
        f"pulse-hybrid-session-v2:{exp}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"v2.{exp}.{sig}"


def _verify_session_cookie(cookie_val: str, secret: str) -> tuple[bool, bool]:
    """Return (is_valid, needs_upgrade_from_v1)."""
    if not cookie_val or not secret:
        return False, False
    if cookie_val.startswith("v2."):
        parts = cookie_val.split(".")
        if len(parts) != 3:
            return False, False
        _, exp_s, sig = parts
        try:
            exp = int(exp_s)
        except ValueError:
            return False, False
        if exp <= int(time.time()):
            return False, False
        expected = hmac.new(
            secret.encode("utf-8"),
            f"pulse-hybrid-session-v2:{exp}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return (hmac.compare_digest(sig, expected), False)
    expected_v1 = _sign_session_token(secret)
    if hmac.compare_digest(cookie_val, expected_v1):
        return True, True
    return False, False


def _is_request_authenticated(request: Request) -> tuple[bool, bool]:
    """Return (is_authenticated, should_upgrade_cookie)."""
    if not PULSE_API_SECRET:
        return (not bool(os.environ.get("RAILWAY_ENVIRONMENT")), False)
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if hmac.compare_digest(token, PULSE_API_SECRET):
            return True, False
    api_key = request.headers.get("x-api-key", "").strip()
    if api_key and hmac.compare_digest(api_key, PULSE_API_SECRET):
        return True, False
    cookie_val = request.cookies.get(PULSE_SESSION_COOKIE, "")
    return _verify_session_cookie(cookie_val, PULSE_API_SECRET)


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
            scheduler.shutdown(wait=True)
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
    needs_upgrade = False
    if path.startswith("/api/") and request.method != "OPTIONS" and path not in _PUBLIC_API_PATHS:
        if not PULSE_API_SECRET and os.environ.get("RAILWAY_ENVIRONMENT"):
            return JSONResponse(status_code=503, content={"detail": "Server authentication not configured"})
        authed, needs_upgrade = _is_request_authenticated(request)
        if not authed:
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    response = await call_next(request)
    if needs_upgrade and PULSE_API_SECRET:
        is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"
        response.set_cookie(
            key=PULSE_SESSION_COOKIE,
            value=_sign_session_token_v2(PULSE_API_SECRET),
            httponly=True,
            samesite="lax",
            secure=is_https,
            max_age=_SESSION_TTL_SEC,
            path="/",
        )
    if response.status_code == 200 and path.startswith(("/css/", "/js/")) and "v" in request.query_params:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path == "/" or path.endswith((".html", ".js", ".css", ".json")) or path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    if path == "/" or path.endswith(".html"):
        response.headers["Permissions-Policy"] = "microphone=(self)"
    return response


app.add_middleware(GZipMiddleware, minimum_size=500)

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


def _reject_non_finite_json(obj: Any, path: str = "payload") -> None:
    if isinstance(obj, float):
        if not math.isfinite(obj):
            raise HTTPException(status_code=422, detail=f"Non-finite numeric value at {path}")
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            _reject_non_finite_json(v, f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for idx, item in enumerate(obj):
            _reject_non_finite_json(item, f"{path}[{idx}]")


def _validate_past_or_today_date(raw_date: Optional[Any], allow_none: bool = True) -> str:
    today_uk = uk_today_str()
    if raw_date is None or str(raw_date).strip() == "":
        if allow_none:
            return today_uk
        raise HTTPException(status_code=422, detail="Date is required; expected YYYY-MM-DD")
    date_slice = str(raw_date).strip()[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_slice):
        raise HTTPException(status_code=422, detail="Invalid date format; expected YYYY-MM-DD")
    try:
        datetime.strptime(date_slice, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid calendar date; expected YYYY-MM-DD")
    if date_slice > today_uk:
        raise HTTPException(status_code=422, detail="Date cannot be in the future")
    return date_slice


def _finite_pos_weight(state: Dict[str, Any]) -> Optional[float]:
    for raw_w in (
        (state.get("athlete") or {}).get("weight_kg"),
        (state.get("renpho") or {}).get("weight_kg"),
    ):
        if raw_w is None or isinstance(raw_w, bool):
            continue
        try:
            num = float(raw_w)
            if math.isfinite(num) and num > 0:
                return num
        except (TypeError, ValueError):
            continue
    return None


def _reject_bool_nonfinite(v: Any, field_name: str, nonneg: bool = False) -> Any:
    if v is None:
        return None
    if isinstance(v, bool):
        raise ValueError(f"{field_name} cannot be a boolean")
    if isinstance(v, (int, float)):
        num = float(v)
        if not math.isfinite(num):
            raise ValueError(f"{field_name} must be finite")
        if nonneg and num < 0:
            raise ValueError(f"{field_name} must be non-negative")
    return v


class SetLogPayload(BaseModel):
    exercise_id: str
    target_weight: Optional[Any] = None
    target_reps: Optional[Union[int, str]] = None
    logged_weight: Optional[Union[float, int, str]] = None
    logged_reps: Optional[Union[int, float, str]] = None
    client_event_id: Optional[str] = None
    id: Optional[str] = None


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
    client_date: Optional[str] = None
    client_event_id: Optional[str] = None
    id: Optional[str] = None

    @field_validator(
        "duration_min", "calories", "avg_hr", "max_hr",
        "aerobic_te", "anaerobic_te", "distance_miles", "steps",
        mode="before",
    )
    @classmethod
    def _validate_nonneg_num_before(cls, v: Any, info: Any) -> Any:
        return _reject_bool_nonfinite(v, info.field_name, nonneg=True)

    @field_validator(
        "duration_min", "calories", "avg_hr", "max_hr",
        "aerobic_te", "anaerobic_te", "distance_miles", "steps",
    )
    @classmethod
    def _validate_nonneg_num_after(cls, v: Any, info: Any) -> Any:
        if v is None:
            return None
        f = float(v)
        if not math.isfinite(f) or f < 0:
            raise ValueError(f"{info.field_name} must be finite and >= 0")
        return v


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
    client_date: Optional[str] = None
    client_event_id: Optional[str] = None
    id: Optional[str] = None

    @field_validator("amount_ml", mode="before")
    @classmethod
    def _validate_amount_ml_before(cls, v: Any) -> Any:
        return _reject_bool_nonfinite(v, "amount_ml")


class TelemetryOverridePayload(BaseModel):
    sleep_score: Optional[int] = None
    sleep_duration: Optional[str] = None
    body_battery: Optional[int] = None
    training_readiness: Optional[int] = None
    date: Optional[str] = None
    client_date: Optional[str] = None
    key: Optional[str] = None
    value: Optional[Union[int, float, str]] = None
    category: Optional[str] = None

    @field_validator("sleep_score", "body_battery", "training_readiness", "value", mode="before")
    @classmethod
    def _validate_metric_before(cls, v: Any, info: Any) -> Any:
        return _reject_bool_nonfinite(v, info.field_name)


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

    @field_validator("weight_kg", "body_fat_pct", mode="before")
    @classmethod
    def _validate_scale_before(cls, v: Any, info: Any) -> Any:
        return _reject_bool_nonfinite(v, info.field_name)


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(os.path.join(static_dir, "css")):
    app.mount("/css", StaticFiles(directory=os.path.join(static_dir, "css")), name="css")
if os.path.isdir(os.path.join(static_dir, "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(static_dir, "js")), name="js")


@app.get("/")
@app.get("/index.html")
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
        "timestamp": uk_now().isoformat(),
        "state_loaded": os.path.exists(LIVE_STATE_PATH)
    }


class AuthLoginPayload(BaseModel):
    secret: str


@app.get("/api/auth/status")
def auth_status(request: Request):
    authed, _ = _is_request_authenticated(request)
    return {
        "auth_required": bool(PULSE_API_SECRET),
        "authenticated": authed
    }


def _get_client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if fwd:
        return fwd
    return request.client.host if request.client else "unknown"


@app.post("/api/auth/login")
def auth_login(payload: AuthLoginPayload, request: Request, response: Response):
    if not PULSE_API_SECRET:
        if os.environ.get("RAILWAY_ENVIRONMENT"):
            raise HTTPException(status_code=503, detail="Server authentication not configured")
        return {"success": True, "auth_required": False}
    client_ip = _get_client_ip(request)
    now_ts = time.time()
    with _LOGIN_FAIL_LOCK:
        bucket = _LOGIN_FAILURES[client_ip]
        while bucket and (now_ts - bucket[0]) > _LOGIN_FAIL_WINDOW_SEC:
            bucket.popleft()
        if len(bucket) >= _LOGIN_MAX_FAILS:
            raise HTTPException(status_code=429, detail="Too many failed login attempts. Try again in 5 minutes.")
    if not hmac.compare_digest(payload.secret.strip(), PULSE_API_SECRET):
        with _LOGIN_FAIL_LOCK:
            _LOGIN_FAILURES[client_ip].append(now_ts)
        raise HTTPException(status_code=401, detail="Invalid access key")
    with _LOGIN_FAIL_LOCK:
        _LOGIN_FAILURES.pop(client_ip, None)
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"
    response.set_cookie(
        key=PULSE_SESSION_COOKIE,
        value=_sign_session_token_v2(PULSE_API_SECRET),
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=_SESSION_TTL_SEC,
        path="/",
    )
    return {"success": True, "authenticated": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(key=PULSE_SESSION_COOKIE, path="/")
    return {"success": True, "authenticated": False}


@app.get("/api/live_state")
def get_live_state():
    return load_live_state()


@app.post("/api/garmin/sync")
def sync_garmin(payload: Optional[DatePayload] = None):
    target_date = payload.date if payload else None
    garmin_sync_error = None
    garmin_auth_req = False
    try:
        try:
            g_res = garmin_service.sync_today(target_date, force=True)
            if isinstance(g_res, dict) and g_res.get("success") is False:
                garmin_sync_error = str(g_res.get("error") or "Garmin sync failed")
                garmin_auth_req = bool(g_res.get("requires_auth"))
        except Exception as gex:
            gex_str = str(gex)
            is_auth_exc = isinstance(gex, GarminConnectAuthenticationError) or any(
                term in gex_str for term in ("401", "Unauthorized", "invalid_grant", "No valid Garmin token", "OAuth")
            )
            garmin_auth_req = is_auth_exc
            if is_auth_exc and payload and payload.email and payload.password:
                login_res = garmin_service.login_with_credentials(payload.email, payload.password)
                if login_res.get("needs_mfa"):
                    return login_res
                if not login_res.get("success"):
                    return JSONResponse(
                        status_code=502,
                        content={
                            "success": False,
                            "upstream_auth_required": True,
                            "error": login_res.get("error", "Authentication failed"),
                        },
                    )
                try:
                    g_res2 = garmin_service.sync_today(target_date, force=True)
                    if isinstance(g_res2, dict) and g_res2.get("success") is False:
                        garmin_sync_error = str(g_res2.get("error") or "Garmin sync failed")
                        garmin_auth_req = bool(g_res2.get("requires_auth"))
                    else:
                        garmin_auth_req = False
                except Exception as gex2:
                    garmin_sync_error = str(gex2)
                    logger.warning(f"Direct Garmin OAuth sync notice after login (falling back to MND Garmin bridge): {gex2}")
            else:
                garmin_sync_error = gex_str
                logger.warning(f"Direct Garmin OAuth sync notice (falling back to MND Garmin bridge): {gex}")

        if garmin_sync_error and garmin_auth_req and payload and payload.email and payload.password:
            login_res = garmin_service.login_with_credentials(payload.email, payload.password)
            if login_res.get("needs_mfa"):
                return login_res
            if not login_res.get("success"):
                return JSONResponse(
                    status_code=502,
                    content={
                        "success": False,
                        "upstream_auth_required": True,
                        "error": login_res.get("error", "Authentication failed"),
                    },
                )
            garmin_sync_error = None
            garmin_auth_req = False
            g_res2 = garmin_service.sync_today(target_date, force=True)
            if isinstance(g_res2, dict) and g_res2.get("success") is False:
                garmin_sync_error = str(g_res2.get("error") or "Garmin sync failed")
                garmin_auth_req = bool(g_res2.get("requires_auth"))

        mnd_ok = False
        mnd_auth_req = False
        mnd_err = None
        try:
            m_res = mnd_service.fetch_today_data(target_date)
            if isinstance(m_res, dict) and m_res.get("success"):
                mnd_ok = True
            else:
                mnd_err = (m_res.get("error") if isinstance(m_res, dict) else "MyNetDiary fallback failed")
                mnd_auth_req = bool(isinstance(m_res, dict) and m_res.get("requires_auth"))
        except Exception as ex:
            mnd_err = str(ex)
            logger.warning(f"MND sync during Garmin pull: {ex}")

        if garmin_sync_error is not None and not mnd_ok:
            return JSONResponse(
                status_code=502,
                content={
                    "success": False,
                    "upstream_auth_required": bool(garmin_auth_req or mnd_auth_req),
                    "error": f"Garmin OAuth and MND fallback failed ({garmin_sync_error}; {mnd_err})",
                },
            )

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
            "upstream_auth_required": bool(garmin_sync_error is not None and garmin_auth_req),
        }
    except Exception as e:
        logger.error(f"Garmin sync error: {e}")
        return JSONResponse(
            status_code=502,
            content={"success": False, "upstream_auth_required": False, "error": str(e)},
        )


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
            _reject_non_finite_json(payload.garmin_state, "garmin_state")
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
        sync_data = mnd_service.fetch_today_data(force=True)
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
        res = mnd_service.fetch_today_data(target_date, force=True)
        if not isinstance(res, dict) or not res.get("success"):
            return JSONResponse(
                status_code=502,
                content={
                    "success": False,
                    "upstream_auth_required": bool(isinstance(res, dict) and res.get("requires_auth")),
                    "error": (res.get("error") if isinstance(res, dict) else "MyNetDiary sync failed"),
                },
            )
        try:
            renpho_service.sync_latest()
        except Exception as rex:
            logger.warning(f"Renpho sync during MND pull: {rex}")
        state = load_live_state()
        return {"success": True, "mnd": res, "state": state}
    except Exception as e:
        logger.error(f"MyNetDiary sync error: {e}")
        return JSONResponse(
            status_code=502,
            content={"success": False, "upstream_auth_required": False, "error": str(e)},
        )


class ManualMndPayload(BaseModel):
    totals: Optional[Dict[str, Any]] = None
    meals: Optional[Dict[str, Any]] = None
    date: Optional[str] = None
    client_date: Optional[str] = None
    logged_item: Optional[Dict[str, Any]] = None
    remove_item: Optional[Dict[str, Any]] = None
    meal_category: Optional[str] = None
    client_event_id: Optional[str] = None
    id: Optional[str] = None


def _safe_nonneg_float(val: Any, field_name: str) -> float:
    if val is None or val == "":
        return 0.0
    if isinstance(val, bool):
        raise HTTPException(status_code=422, detail=f"Invalid numeric value for {field_name}")
    try:
        num = float(val)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"Invalid numeric value for {field_name}")
    if not math.isfinite(num) or num < 0:
        raise HTTPException(status_code=422, detail=f"Invalid numeric value for {field_name}")
    return num


def _safe_nonneg_int(val: Any, field_name: str) -> int:
    return int(round(_safe_nonneg_float(val, field_name)))


def _parse_validated_totals(t: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "calories": _safe_nonneg_int(t.get("calories"), "calories"),
        "protein_g": _safe_nonneg_int(t.get("protein") if t.get("protein") is not None else t.get("protein_g"), "protein"),
        "carbs_g": _safe_nonneg_int(t.get("carbs") if t.get("carbs") is not None else t.get("carbs_g"), "carbs"),
        "fat_g": _safe_nonneg_int(t.get("fat") if t.get("fat") is not None else t.get("fat_g"), "fat"),
        "fiber_g": _safe_nonneg_int(t.get("fiber") if t.get("fiber") is not None else t.get("fiber_g"), "fiber"),
        "sodium_mg": _safe_nonneg_int(t.get("sodium") if t.get("sodium") is not None else t.get("sodium_mg"), "sodium"),
        "water_l": round(_safe_nonneg_float(t.get("water") if t.get("water") is not None else t.get("water_l"), "water"), 2),
        "sugar_g": round(_safe_nonneg_float(t.get("sugar_g"), "sugar_g"), 1),
        "sat_fat_g": round(_safe_nonneg_float(t.get("sat_fat_g"), "sat_fat_g"), 1),
    }


def _pop_matching_overlay(items_list: List[Dict[str, Any]], rm_id: str, rm_sig: Optional[tuple], rm_cat: str) -> Optional[Dict[str, Any]]:
    if rm_id:
        for i, ov in enumerate(items_list):
            if isinstance(ov, dict) and str(ov.get("id") or "") == rm_id:
                return items_list.pop(i)
    if rm_sig is not None:
        for pass_cat in ([rm_cat] if rm_cat else []) + [None]:
            for i, ov in enumerate(items_list):
                if not isinstance(ov, dict):
                    continue
                if pass_cat is not None and str(ov.get("category") or "snacks").lower() != pass_cat:
                    continue
                ov_sig = mnd_service._normalize_meal_sig(ov.get("name", ""), ov.get("cals", 0), ov.get("p", 0))
                if ov_sig == rm_sig:
                    return items_list.pop(i)
    return None


@app.post("/api/mnd/manual")
def manual_mnd_entry(payload: ManualMndPayload):
    _reject_non_finite_json(payload.totals, "totals")
    _reject_non_finite_json(payload.meals, "meals")
    _reject_non_finite_json(payload.logged_item, "logged_item")
    _reject_non_finite_json(payload.remove_item, "remove_item")

    now_uk = uk_now()
    today_uk = now_uk.date().isoformat()
    date_str = _validate_past_or_today_date(payload.date or payload.client_date)

    has_logged_item = isinstance(payload.logged_item, dict) and bool(str(payload.logged_item.get("name") or "").strip())
    has_remove_item = isinstance(payload.remove_item, dict)
    is_delta = has_logged_item or has_remove_item
    if not is_delta and payload.totals is None:
        raise HTTPException(status_code=422, detail="totals is required for manual nutrition snapshot")
    if payload.totals is not None and not isinstance(payload.totals, dict):
        raise HTTPException(status_code=422, detail="totals must be an object")

    parsed_totals = _parse_validated_totals(payload.totals) if isinstance(payload.totals, dict) else None

    validated_logged_item = None
    if has_logged_item:
        li = payload.logged_item
        cat = str(payload.meal_category or li.get("category") or "snacks").lower()
        if cat not in ("breakfast", "lunch", "dinner", "snacks"):
            cat = "snacks"
        validated_logged_item = {
            "id": str(li.get("id") or "").strip() or f"app_{uuid.uuid4().hex[:10]}",
            "category": cat,
            "name": str(li.get("name")).strip()[:200],
            "cals": _safe_nonneg_int(li.get("cals"), "logged_item.cals"),
            "p": _safe_nonneg_int(li.get("p"), "logged_item.p"),
            "c": _safe_nonneg_int(li.get("c"), "logged_item.c"),
            "f": _safe_nonneg_int(li.get("f"), "logged_item.f"),
            "added_at": now_uk.isoformat(),
        }

    validated_remove = None
    if has_remove_item:
        ri = payload.remove_item
        rm_id = str(ri.get("id") or "").strip()
        rm_name = str(ri.get("name") or "").strip()
        if not rm_id and not rm_name:
            raise HTTPException(status_code=422, detail="remove_item must specify id or name")
        rm_cat = str(ri.get("meal_category") or ri.get("category") or payload.meal_category or "").lower()
        if rm_cat not in ("breakfast", "lunch", "dinner", "snacks"):
            rm_cat = ""
        rm_cals = _safe_nonneg_int(ri.get("cals"), "remove_item.cals")
        rm_p = _safe_nonneg_int(ri.get("p"), "remove_item.p")
        rm_c = _safe_nonneg_int(ri.get("c"), "remove_item.c")
        rm_f = _safe_nonneg_int(ri.get("f"), "remove_item.f")
        validated_remove = {
            "id": rm_id,
            "name": rm_name,
            "category": rm_cat or "snacks",
            "cals": rm_cals,
            "p": rm_p,
            "c": rm_c,
            "f": rm_f,
            "sig": list(mnd_service._normalize_meal_sig(rm_name, rm_cals, rm_p)) if rm_name else None,
        }

    now_iso = now_uk.isoformat()
    yesterday_str = (now_uk.date() - timedelta(days=1)).isoformat()
    event_id = str(payload.client_event_id or payload.id or "").strip()

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if event_id:
            if not db.claim_idempotency_key("mnd_manual", event_id):
                return {"success": True, "duplicate": True, "mnd_logged": state.get("mnd_logged"), "state": state}

        app_logged = state.setdefault("app_logged_meals", {})
        if not isinstance(app_logged, dict):
            app_logged = {}
            state["app_logged_meals"] = app_logged
        app_deleted = state.setdefault("app_deleted_meals", {})
        if not isinstance(app_deleted, dict):
            app_deleted = {}
            state["app_deleted_meals"] = app_deleted

        for d_key in list(app_logged.keys()):
            if str(d_key) < yesterday_str:
                app_logged.pop(d_key, None)
        for d_key in list(app_deleted.keys()):
            if str(d_key) < yesterday_str:
                app_deleted.pop(d_key, None)

        # Past-date write-through: write SQLite + mnd_history_cache without touching today's live_state
        if date_str < today_uk:
            cache = mnd_service._load_history_cache(include_live_state=False)
            existing_day = cache.get(date_str) if isinstance(cache.get(date_str), dict) else {}
            if is_delta:
                base_totals = parsed_totals if parsed_totals is not None else {
                    "calories": int(existing_day.get("calories") or 0),
                    "protein_g": int(existing_day.get("protein") or 0),
                    "carbs_g": int(existing_day.get("carbs") or 0),
                    "fat_g": int(round(float(existing_day.get("fat") or 0))),
                    "fiber_g": int(existing_day.get("fiber") or 0),
                    "sodium_mg": int(existing_day.get("sodium") or 0),
                    "sugar_g": float(existing_day.get("sugar_g") or 0.0),
                    "sat_fat_g": float(existing_day.get("sat_fat_g") or 0.0),
                }
                base_meals = copy.deepcopy(payload.meals) if isinstance(payload.meals, dict) else {}
                if validated_logged_item and parsed_totals is None:
                    base_totals, base_meals = mnd_service._compose_mnd_with_overlays(
                        base_totals, base_meals, [validated_logged_item], []
                    )
                elif validated_remove and parsed_totals is None:
                    base_totals["calories"] = max(0, base_totals["calories"] - validated_remove["cals"])
                    base_totals["protein_g"] = max(0, base_totals["protein_g"] - validated_remove["p"])
                    base_totals["carbs_g"] = max(0, base_totals["carbs_g"] - validated_remove["c"])
                    base_totals["fat_g"] = max(0, base_totals["fat_g"] - validated_remove["f"])
                past_logged = base_totals
                past_meals = base_meals
                db_source = "mnd_overlay"
            else:
                past_logged = parsed_totals
                past_meals = copy.deepcopy(payload.meals) if isinstance(payload.meals, dict) else {}
                db_source = "manual"

            db.upsert_daily_nutrition(
                date_str,
                int(past_logged.get("calories") or 0),
                int(past_logged.get("protein_g") or 0),
                int(past_logged.get("carbs_g") or 0),
                int(round(float(past_logged.get("fat_g") or 0))),
                source=db_source,
            )

            cache[date_str] = mnd_service._build_day_summary(date_str, past_logged, past_meals)
            mnd_service._save_history_cache(cache)

            end_dt = now_uk.date()
            win_dates = [(end_dt - timedelta(days=o)).isoformat() for o in range(13, -1, -1)]
            logged_days = [
                cache[d] for d in win_dates
                if isinstance(cache.get(d), dict) and (cache[d].get("calories") or 0) > 0
            ]
            state["mnd_history"] = {
                "window_days": len(logged_days),
                "start_date": logged_days[0]["date"] if logged_days else today_uk,
                "end_date": today_uk,
                "days": logged_days,
                "averages_10d": mnd_service._compute_history_averages(logged_days[-10:]),
                "averages_7d": mnd_service._compute_history_averages(logged_days[-7:]),
            }
            save_live_state(state)
            return {
                "success": True,
                "date": date_str,
                "past_date_only": True,
                "mnd_logged": state.get("mnd_logged"),
                "state": state,
            }

        # Today update: delta vs snapshot
        if is_delta:
            existing_cloud = state.get("mnd_cloud_logged")
            has_valid_cloud = isinstance(existing_cloud, dict) and existing_cloud.get("date") == date_str
            if has_valid_cloud:
                cloud_totals = copy.deepcopy(existing_cloud)
                cloud_meals = copy.deepcopy(state.get("mnd_cloud_meals") or {})
            else:
                if parsed_totals is not None:
                    base = copy.deepcopy(parsed_totals)
                    if validated_logged_item:
                        base["calories"] = max(0, base["calories"] - validated_logged_item["cals"])
                        base["protein_g"] = max(0, base["protein_g"] - validated_logged_item["p"])
                        base["carbs_g"] = max(0, base["carbs_g"] - validated_logged_item["c"])
                        base["fat_g"] = max(0, base["fat_g"] - validated_logged_item["f"])
                    elif validated_remove:
                        base["calories"] = base["calories"] + validated_remove["cals"]
                        base["protein_g"] = base["protein_g"] + validated_remove["p"]
                        base["carbs_g"] = base["carbs_g"] + validated_remove["c"]
                        base["fat_g"] = base["fat_g"] + validated_remove["f"]
                    base["date"] = date_str
                    base["source"] = "live_mynetdiary_cloud"
                    base["last_pulled"] = now_iso
                    cloud_totals = base
                else:
                    cloud_totals = {
                        "date": date_str, "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0,
                        "fiber_g": 0, "sodium_mg": 0, "water_l": 0.0, "sugar_g": 0.0, "sat_fat_g": 0.0,
                        "source": "live_mynetdiary_cloud", "last_pulled": now_iso,
                    }
                cloud_meals = copy.deepcopy(state.get("mnd_meals") or {})
                if validated_remove:
                    # Seed removed item once into cloud_meals if absent so tombstone subtracts cleanly
                    _, norm_cm = mnd_service._compose_mnd_with_overlays(cloud_totals, cloud_meals, [], [])
                    rm_cat = validated_remove["category"]
                    found_in_cm = any(
                        (validated_remove["id"] and str(it.get("id") or "") == validated_remove["id"])
                        or (
                            validated_remove["sig"]
                            and list(mnd_service._normalize_meal_sig(it.get("name", ""), it.get("cals", 0), it.get("p", 0))) == validated_remove["sig"]
                        )
                        for b in norm_cm.values()
                        if isinstance(b, dict)
                        for it in (b.get("items") or [])
                        if isinstance(it, dict)
                    )
                    if not found_in_cm:
                        norm_cm[rm_cat]["items"].append({
                            "id": validated_remove["id"] or "cloud_rm_0",
                            "name": validated_remove["name"],
                            "cals": validated_remove["cals"],
                            "p": validated_remove["p"],
                            "c": validated_remove["c"],
                            "f": validated_remove["f"],
                        })
                    cloud_meals = norm_cm
                state["mnd_cloud_logged"] = copy.deepcopy(cloud_totals)
                state["mnd_cloud_meals"] = copy.deepcopy(cloud_meals)

            day_app_logged = app_logged.setdefault(date_str, [])
            day_app_deleted = app_deleted.setdefault(date_str, [])

            if validated_logged_item:
                day_app_logged.append(validated_logged_item)

            if validated_remove:
                popped = _pop_matching_overlay(
                    day_app_logged,
                    validated_remove["id"],
                    tuple(validated_remove["sig"]) if validated_remove["sig"] else None,
                    validated_remove["category"],
                )
                if popped is None:
                    day_app_deleted.append({
                        "id": validated_remove["id"],
                        "sig": validated_remove["sig"],
                        "category": validated_remove["category"],
                        "name": validated_remove["name"],
                        "cals": validated_remove["cals"],
                        "p": validated_remove["p"],
                        "deleted_at": now_iso,
                    })

            composed_totals, composed_meals = mnd_service._compose_mnd_with_overlays(
                cloud_totals, cloud_meals, day_app_logged, day_app_deleted
            )
            db_water_l = 0.0
            try:
                db_water_l = round(db.get_hydration_total(date_str) / 1000.0, 2)
            except Exception:
                db_water_l = 0.0
            prev_water = float((state.get("mnd_logged") or {}).get("water_l") or 0.0)
            req_water = float(parsed_totals.get("water_l") or 0.0) if parsed_totals else 0.0
            final_water = round(max(float(composed_totals.get("water_l") or 0.0), db_water_l, prev_water, req_water), 2)

            mnd_logged = {
                "date": date_str,
                "calories": int(composed_totals.get("calories") or 0),
                "protein_g": int(composed_totals.get("protein_g") or 0),
                "carbs_g": int(composed_totals.get("carbs_g") or 0),
                "fat_g": int(composed_totals.get("fat_g") or 0),
                "fiber_g": int(composed_totals.get("fiber_g") or (parsed_totals["fiber_g"] if parsed_totals else 0)),
                "sodium_mg": int(composed_totals.get("sodium_mg") or (parsed_totals["sodium_mg"] if parsed_totals else 0)),
                "water_l": final_water,
                "sugar_g": float(composed_totals.get("sugar_g") if composed_totals.get("sugar_g") is not None else (parsed_totals["sugar_g"] if parsed_totals else 0.0)),
                "sat_fat_g": float(composed_totals.get("sat_fat_g") if composed_totals.get("sat_fat_g") is not None else (parsed_totals["sat_fat_g"] if parsed_totals else 0.0)),
                "source": "mnd_overlay" if (day_app_logged or day_app_deleted) else "live_mynetdiary_cloud",
                "last_pulled": now_iso,
            }
            state["mnd_last_synced"] = now_iso
            state["mnd_logged"] = dict(mnd_logged)
            state.setdefault("garmin", {})["mnd_logged"] = dict(mnd_logged)
            state["mnd_meals"] = composed_meals
            state["garmin"]["mnd_meals"] = composed_meals
            db_source = "mnd_overlay"
        else:
            # Snapshot override from Edit/Sync Totals modal
            db_water_l = 0.0
            try:
                db_water_l = round(db.get_hydration_total(date_str) / 1000.0, 2)
            except Exception:
                db_water_l = 0.0
            mnd_logged = {
                "date": date_str,
                "calories": parsed_totals["calories"],
                "protein_g": parsed_totals["protein_g"],
                "carbs_g": parsed_totals["carbs_g"],
                "fat_g": parsed_totals["fat_g"],
                "fiber_g": parsed_totals["fiber_g"],
                "sodium_mg": parsed_totals["sodium_mg"],
                "water_l": round(max(parsed_totals["water_l"], db_water_l), 2),
                "sugar_g": parsed_totals["sugar_g"],
                "sat_fat_g": parsed_totals["sat_fat_g"],
                "source": "manual_override",
                "last_pulled": now_iso,
            }
            state["mnd_last_synced"] = now_iso
            state["mnd_logged"] = dict(mnd_logged)
            state.setdefault("garmin", {})["mnd_logged"] = dict(mnd_logged)
            if isinstance(payload.meals, dict):
                state["mnd_meals"] = payload.meals
                state["garmin"]["mnd_meals"] = payload.meals
            db_source = "manual"

        analytics_service.recalculate_nutrition(state, date_str)
        save_live_state(state)

    try:
        db.upsert_daily_nutrition(
            date_str,
            mnd_logged["calories"],
            mnd_logged["protein_g"],
            mnd_logged["carbs_g"],
            mnd_logged["fat_g"],
            source=db_source,
        )
    except Exception as dbe:
        logger.warning(f"Failed persisting daily nutrition: {dbe}")

    return {"success": True, "mnd_logged": mnd_logged, "state": state}


@app.post("/api/renpho/sync")
def sync_renpho():
    try:
        res = renpho_service.sync_latest(force=True)
        if not isinstance(res, dict) or not res.get("success"):
            return JSONResponse(
                status_code=502,
                content={
                    "success": False,
                    "upstream_auth_required": bool(isinstance(res, dict) and res.get("requires_auth")),
                    "error": (res.get("error") if isinstance(res, dict) else "Renpho sync failed"),
                },
            )
        state = load_live_state()
        return {"success": True, "renpho": state.get("renpho", {}), "state": state}
    except Exception as e:
        logger.error(f"Renpho sync error: {e}")
        return JSONResponse(
            status_code=502,
            content={"success": False, "upstream_auth_required": False, "error": str(e)},
        )


@app.post("/api/renpho/manual")
def manual_renpho_entry(payload: ManualScalePayload):
    raw_w = float(payload.weight_kg)
    if not math.isfinite(raw_w) or raw_w <= 20.0 or raw_w >= 300.0:
        raise HTTPException(status_code=422, detail="weight_kg must be between 20 and 300 kg")
    weight_kg = round(raw_w, 2)
    if payload.body_fat_pct is not None:
        bf_check = float(payload.body_fat_pct)
        if not math.isfinite(bf_check) or bf_check < 3.0 or bf_check > 60.0:
            raise HTTPException(status_code=422, detail="body_fat_pct must be between 3 and 60")

    now_uk = uk_now()
    last_synced = now_uk.strftime('%Y-%m-%d %H:%M:%S')
    today_str = now_uk.date().isoformat()
    muscle_mass_kg = None
    water_pct = None

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        existing_renpho = state.get('renpho', {}) if isinstance(state.get('renpho'), dict) else {}
        existing_lbm = existing_renpho.get('lean_mass_kg')
        if existing_lbm is None:
            existing_lbm = (state.get('athlete') or {}).get('lean_mass_kg')

        comp = analytics_service.compute_composition_from_weight(
            weight_kg,
            existing_lbm=existing_lbm,
            body_fat_pct=payload.body_fat_pct,
        )
        body_fat_pct = comp["body_fat_pct"]
        lean_mass_kg = comp["lean_mass_kg"]
        target_weight_at_15pct = comp["target_weight_at_15pct"]
        fat_to_lose_kg = comp["fat_to_lose_kg"]

        renpho_state = state.setdefault("renpho", {})
        muscle_mass_kg = renpho_state.get("muscle_mass_kg") if lean_mass_kg is not None else None
        water_pct = renpho_state.get("water_pct") if lean_mass_kg is not None else None
        bio_synced_at = last_synced if payload.body_fat_pct is not None else (
            renpho_state.get("bio_synced_at") if lean_mass_kg is not None else None
        )
        renpho_state.update({
            "weight_kg": weight_kg,
            "body_fat_pct": body_fat_pct,
            "lean_mass_kg": lean_mass_kg,
            "muscle_mass_kg": muscle_mass_kg,
            "water_pct": water_pct,
            "target_weight_at_15pct": target_weight_at_15pct,
            "fat_to_lose_kg": fat_to_lose_kg,
            "source": "manual_scale_entry",
            "weight_source": "manual_scale_entry",
            "weight_synced_at": last_synced,
            "bio_synced_at": bio_synced_at,
            "last_synced": last_synced,
            "last_checked": now_uk.isoformat(),
        })

        athlete_state = state.setdefault("athlete", {})
        athlete_state.update({
            "weight_kg": weight_kg,
            "body_fat_pct": body_fat_pct,
            "lean_mass_kg": lean_mass_kg,
            "fat_to_lose_kg": fat_to_lose_kg,
            "target_weight_at_15pct": target_weight_at_15pct,
            "target_weight_kg": target_weight_at_15pct,
        })

        try:
            db.upsert_renpho_measurements([{
                "id": f"manual_{today_str}",
                "timeStamp": int(now_uk.timestamp()),
                "localCreatedAt": last_synced,
                "weight": weight_kg,
                "bodyfat": body_fat_pct,
                "fatFreeWeight": lean_mass_kg,
                "sinew": muscle_mass_kg,
                "water": water_pct,
            }])
        except Exception as dbe:
            logger.warning(f"Failed upserting manual Renpho entry to SQLite: {dbe}")

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
    if payload.amount_ml <= 0 or payload.amount_ml > 5000:
        raise HTTPException(status_code=422, detail="amount_ml must be between 1 and 5000 ml")
    date_str = _validate_past_or_today_date(payload.date or payload.client_date)
    today_uk = uk_today_str()
    event_id = str(payload.client_event_id or payload.id or "").strip()

    try:
        with state_store.state_lock(LIVE_STATE_PATH):
            state = load_live_state(raise_on_corrupt=True)
            if event_id:
                if not db.claim_idempotency_key("hydration_add", event_id):
                    curr_ml = db.get_hydration_total(date_str)
                    return {
                        "success": True,
                        "duplicate": True,
                        "date": date_str,
                        "total_ml": curr_ml,
                        "water_l": round(curr_ml / 1000.0, 2),
                        "state": state,
                    }
            total_ml = db.add_hydration(date_str, payload.amount_ml)
            new_water_l = round(total_ml / 1000.0, 2)
            if date_str == today_uk:
                garmin_state = state.setdefault("garmin", {})
                mnd_logged = garmin_state.setdefault("mnd_logged", {})
                current_water_l = float(mnd_logged.get("water_l") or 0.0)
                new_water_l = round(max(current_water_l + (payload.amount_ml / 1000.0), total_ml / 1000.0), 2)
                mnd_logged["water_l"] = new_water_l
                if "mnd_logged" in state and isinstance(state["mnd_logged"], dict):
                    state["mnd_logged"]["water_l"] = new_water_l
                save_live_state(state)
        return {
            "success": True,
            "date": date_str,
            "amount_added_ml": payload.amount_ml,
            "total_ml": total_ml,
            "water_l": new_water_l,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Hydration add error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _coerce_weight_kg(val: Any) -> Optional[float]:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        f = float(val)
        return f if math.isfinite(f) else None
    s = str(val).strip()
    if not s:
        return None
    if s.lower() in ("body", "bw", "bodyweight", "body weight"):
        return 0.0
    s = re.sub(r"^2\s*[×x]\s*", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"kg$", "", s, flags=re.IGNORECASE).strip()
    try:
        f = float(s)
        return f if math.isfinite(f) else None
    except ValueError:
        return None


def _coerce_int_reps(val: Any) -> Optional[int]:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(round(val)) if math.isfinite(val) else None
    s = str(val).strip()
    if not s:
        return None
    try:
        f = float(s)
        return int(round(f)) if math.isfinite(f) else None
    except ValueError:
        return None


@app.post("/api/sync_set")
def sync_set(payload: SetLogPayload):
    w = _coerce_weight_kg(payload.logged_weight)
    r = _coerce_int_reps(payload.logged_reps)
    if w is None or r is None or w < 0 or w > 500 or r < 0 or r > 200:
        raise HTTPException(
            status_code=422,
            detail="Invalid set metrics: logged_weight must be [0, 500] kg (or Bodyweight) and logged_reps [0, 200]",
        )
    target_w = _coerce_weight_kg(payload.target_weight)
    target_r = _coerce_int_reps(payload.target_reps)
    event_id = str(payload.client_event_id or payload.id or "").strip()

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if event_id:
            if not db.claim_idempotency_key("sync_set", event_id):
                return {"success": True, "duplicate": True, "status": "success", "state": state}

        prescriptions = state.setdefault("strength_prescriptions", {})
        existing_sp = prescriptions.get(payload.exercise_id)
        if not isinstance(existing_sp, dict):
            existing_sp = {}
            prescriptions[payload.exercise_id] = existing_sp

        e1rm = round(w * (1.0 + r / 30.0), 1)
        prev_best = None
        if w > 0 and r > 0:
            db_best = db.get_exercise_best_e1rm(payload.exercise_id)
            priors = [
                float(v)
                for v in (db_best, existing_sp.get("e1rm"))
                if not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(float(v)) and float(v) > 0
            ]
            prev_best = round(max(priors), 1) if priors else None

        eff_target_w = target_w if (target_w is not None and target_w > 0) else _coerce_weight_kg(existing_sp.get("weight"))
        is_warmup = bool(eff_target_w is not None and eff_target_w > 0 and w > 0 and w < 0.75 * eff_target_w)
        if is_warmup:
            db.log_strength_set(payload.exercise_id, w, r, e1rm, is_warmup=True)
            return {
                "success": True,
                "status": "success",
                "result": {
                    "status": "warmup",
                    "e1rm": e1rm,
                    "is_pr": False,
                    "prev_best_e1rm": prev_best,
                },
            }

        sp = existing_sp
        if payload.logged_weight is not None:
            sp["last_logged_weight"] = payload.logged_weight
        if payload.logged_reps is not None:
            sp["last_logged_reps"] = payload.logged_reps

        is_pr = bool(w > 0 and r > 0 and (prev_best is None or e1rm > prev_best))
        sp["is_pr"] = is_pr
        sp["prev_best_e1rm"] = prev_best
        db.log_strength_set(payload.exercise_id, w, r, e1rm, is_warmup=False)
        sp["last_e1rm"] = e1rm
        sp["e1rm"] = round(max(e1rm, prev_best), 1) if (prev_best is not None and w > 0) else e1rm
        sp["last_updated"] = uk_now().isoformat()

        eff_target_r = target_r or r
        pct_diff = ((r - eff_target_r) / eff_target_r) if eff_target_r > 0 else 0.0
        is_severe_underperf = (
            (r == 0)
            or (eff_target_r - r >= 3)
            or (eff_target_r > 0 and r <= int(eff_target_r * 0.65))
            or (pct_diff <= -0.20)
        )
        if target_r and r >= target_r:
            sp["progression_ready"] = True
            sp["status"] = "progressed"
            sp["weight"] = round(w + (2.5 if w > 0 else 0.0), 1) if w > 0 else payload.logged_weight
            sp["reps"] = target_r if w > 0 else (r + 1)
        elif is_severe_underperf and w > 0:
            sp["progression_ready"] = False
            sp["status"] = "deloaded"
            deload_w = min(w, max(2.5, round((w * 0.85) / 2.5) * 2.5))
            sp["weight"] = deload_w
            sp["reps"] = eff_target_r
        else:
            sp["progression_ready"] = False
            sp["status"] = "holding"
            sp["weight"] = w if w > 0 else payload.logged_weight
            sp["reps"] = eff_target_r

        save_live_state(state)
    return {"success": True, "status": "success", "result": sp}


def _validate_payload_size(payload_obj: Any, max_bytes: int = 65536) -> None:
    try:
        encoded = json.dumps(payload_obj, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Payload must be finite, JSON-serializable")
    if len(encoded) > max_bytes:
        raise HTTPException(status_code=422, detail=f"Payload exceeds maximum allowed size ({max_bytes} bytes)")


@app.post("/api/sync_session")
def sync_session(payload: Dict[str, Any]):
    _reject_non_finite_json(payload, "sync_session")
    _validate_payload_size(payload, 65536)

    now_iso = uk_now().isoformat()
    today_uk = uk_today_str()
    entry = dict(payload or {})
    raw_date = entry.get("date") or entry.get("client_date")
    if raw_date is not None and str(raw_date).strip() != "":
        date_str_day = _validate_past_or_today_date(raw_date, allow_none=False)
    else:
        date_str_day = today_uk
        entry["date"] = now_iso
    entry["synced_at"] = now_iso

    event_id = str(entry.get("client_event_id") or entry.get("id") or "").strip()

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if event_id:
            if not db.claim_idempotency_key("sync_session", event_id):
                return {"success": True, "duplicate": True, "status": "success", "state": state}

        try:
            db.log_workout_session(entry)
        except Exception as e:
            logger.warning(f"Could not save workout session to db: {e}")

        if date_str_day == today_uk:
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
    _reject_non_finite_json(payload.benefits, "benefits")
    now_uk = uk_now()
    today_uk = now_uk.date().isoformat()
    raw_d = payload.date or payload.client_date
    date_str_day = _validate_past_or_today_date(raw_d)
    if raw_d and str(raw_d).strip():
        s_raw = str(raw_d).strip()
        date_str = s_raw if len(s_raw) > 10 else (now_uk.strftime("%Y-%m-%d %H:%M:%S") if date_str_day == today_uk else f"{date_str_day} 12:00:00")
    else:
        date_str = now_uk.strftime("%Y-%m-%d %H:%M:%S")

    dur = round(float(payload.duration_min or 0), 1)
    cals = int(round(float(payload.calories or 0)))
    avg_hr = int(round(float(payload.avg_hr or 0)))
    max_hr = int(round(float(payload.max_hr or 0)))
    aero_te = float(payload.aerobic_te or 0.0)
    anaero_te = float(payload.anaerobic_te or 0.0)
    sub_title = (payload.sub_title or payload.name).strip()
    event_id = str(payload.client_event_id or payload.id or "").strip()

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if event_id:
            if not db.claim_idempotency_key("sync_activity", event_id):
                return {"success": True, "duplicate": True, "status": "success", "state": state}

        live_weight_kg = _finite_pos_weight(state)
        benefits = payload.benefits
        if not benefits:
            try:
                benefits = benefits_engine.generate_benefits(
                    payload.name,
                    sub_title,
                    dur,
                    cals,
                    avg_hr,
                    max_hr,
                    aero_te,
                    anaero_te,
                    weight_kg=live_weight_kg,
                )
            except Exception:
                benefits = []

        entry: Dict[str, Any] = {
            "id": event_id if event_id else int(now_uk.timestamp() * 1000),
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
        if event_id:
            entry["client_event_id"] = event_id

        try:
            db.log_manual_activity(entry)
        except Exception as e:
            logger.warning(f"Could not save manual activity to db: {e}")

        if date_str_day == today_uk:
            garmin = state.setdefault("garmin", {})
            today_list = garmin.setdefault("today_activities", [])
            recent_list = garmin.setdefault("recent_activities", [])
            today_list.insert(0, entry)
            garmin["active_calories"] = int(garmin.get("active_calories") or 0) + cals
            recent_list.insert(0, entry)
            garmin["recent_activities"] = recent_list[:100]
            analytics_service.recalculate_nutrition(state, date_str_day)
            save_live_state(state)

    return {"success": True, "status": "success", "activity": entry, "state": state}


_INJURY_JOINT_KEYS = ("lumbar", "shoulders", "knees", "elbows", "wrists", "ankles")
_INJURY_ALLOWED_KEYS = set(_INJURY_JOINT_KEYS) | {
    "notes",
    "assessment",
    "chronic_profile",
    "active_constraints",
    "last_diagnostic_summary",
    "updated_at_ms",
}


def _sanitize_injuries_payload(payload: Any) -> Dict[str, Any]:
    if payload is not None and not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Injuries payload must be a JSON object")
    _reject_non_finite_json(payload, "injuries")
    _validate_payload_size(payload, 65536)

    raw = payload or {}
    cleaned: Dict[str, Any] = {}
    for j in _INJURY_JOINT_KEYS:
        cleaned[j] = bool(raw.get(j, False))
    cleaned["notes"] = str(raw["notes"])[:2000] if raw.get("notes") is not None else ""

    raw_ts = raw.get("updated_at_ms")
    if isinstance(raw_ts, (int, float)) and not isinstance(raw_ts, bool) and math.isfinite(float(raw_ts)) and raw_ts >= 0:
        cleaned["updated_at_ms"] = int(raw_ts)
    else:
        cleaned["updated_at_ms"] = int(uk_now().timestamp() * 1000)

    if "assessment" in raw:
        ass = raw.get("assessment")
        if ass is not None and not isinstance(ass, dict):
            raise HTTPException(status_code=422, detail="assessment must be an object or null")
        cleaned["assessment"] = ass

    if isinstance(raw.get("chronic_profile"), dict):
        cp_clean: Dict[str, Dict[str, Any]] = {}
        for j, entry in raw["chronic_profile"].items():
            if j not in _INJURY_JOINT_KEYS or not isinstance(entry, dict):
                continue
            is_perm = bool(entry.get("permanent", True))
            cp_clean[j] = {
                "permanent": is_perm,
                "label": strip_markup(entry.get("label") or j.title())[:120],
                "laterality": str(entry.get("laterality") or "unspecified")[:20],
                "notes": strip_markup(entry.get("notes") or "")[:300],
            }
            # Invariant: permanent chronic profile entry always enforces top-level joint flag True
            if is_perm:
                cleaned[j] = True
        cleaned["chronic_profile"] = cp_clean

    if isinstance(raw.get("active_constraints"), dict):
        ac_clean: Dict[str, Dict[str, Any]] = {}
        valid_restr = set(exercise_biomechanics.MOVEMENT_RESTRICTIONS)
        valid_ex = set(exercise_biomechanics.EXERCISE_BIOMECHANICS) | set(exercise_biomechanics.LEGACY_EXERCISE_ALIASES)
        for j, entry in raw["active_constraints"].items():
            if j not in _INJURY_JOINT_KEYS or not isinstance(entry, dict) or not cleaned[j]:
                continue
            raw_r = entry.get("movement_restrictions") if isinstance(entry.get("movement_restrictions"), list) else []
            raw_e = entry.get("restricted_exercise_ids") if isinstance(entry.get("restricted_exercise_ids"), list) else []
            exp_h = entry.get("expires_hint_hours")
            ac_clean[j] = {
                "severity": str(entry.get("severity") or "moderate")[:20],
                "source": str(entry.get("source") or "manual")[:20],
                "laterality": str(entry.get("laterality") or "unspecified")[:20],
                "anatomical_region": str(entry.get("anatomical_region") or "other_unspecified")[:40],
                "movement_restrictions": [str(r) for r in raw_r if str(r) in valid_restr][:10],
                "restricted_exercise_ids": [str(e) for e in raw_e if str(e) in valid_ex][:25],
                "assessment_id": str(entry.get("assessment_id") or "")[:128] or None,
                "applied_at": str(entry.get("applied_at") or "")[:64],
                "expires_hint_hours": int(exp_h) if isinstance(exp_h, (int, float)) and not isinstance(exp_h, bool) and exp_h >= 0 else 72,
            }
        cleaned["active_constraints"] = ac_clean

    if "last_diagnostic_summary" in raw:
        lds = raw.get("last_diagnostic_summary")
        if lds is None:
            cleaned["last_diagnostic_summary"] = None
        elif isinstance(lds, dict):
            aff = lds.get("affected_joints") if isinstance(lds.get("affected_joints"), list) else []
            lds_clean = {
                "assessment_id": str(lds.get("assessment_id") or "")[:128],
                "generated_at": str(lds.get("generated_at") or "")[:64],
                "summary_headline": strip_markup(lds.get("summary_headline") or "")[:300],
                "anatomical_region": str(lds.get("anatomical_region") or "other_unspecified")[:40],
                "severity": str(lds.get("severity") or "moderate")[:20],
                "triage_level": str(lds.get("triage_level") or "amber_deload")[:24],
                "affected_joints": [str(j) for j in aff if str(j) in _INJURY_JOINT_KEYS][:6],
            }
            if len(json.dumps(lds_clean, allow_nan=False).encode("utf-8")) > 4096:
                raise HTTPException(status_code=422, detail="last_diagnostic_summary exceeds 4096 bytes")
            cleaned["last_diagnostic_summary"] = lds_clean
        else:
            raise HTTPException(status_code=422, detail="last_diagnostic_summary must be an object or null")

    return cleaned


@app.post("/api/athlete/injuries")
def save_athlete_injuries(payload: Dict[str, Any]):
    cleaned = _sanitize_injuries_payload(payload)
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        state["injuries"] = cleaned
        save_live_state(state)
    return {"success": True, "injuries": cleaned}


def _diagnostics_rate_key(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    sess_cookie = request.cookies.get(PULSE_SESSION_COOKIE, "")
    sess_hash = hashlib.sha256(sess_cookie.encode("utf-8")).hexdigest()[:12] if sess_cookie else "anon"
    return f"{peer}|{fwd}|{sess_hash}"


@app.post("/api/diagnostics/analyze")
def analyze_diagnostics(payload: SymptomInputModel, request: Request):
    key = _diagnostics_rate_key(request)
    now_ts = time.time()
    with _DIAGNOSTICS_RATE_LOCK:
        bucket = _DIAGNOSTICS_BUCKETS[key]
        while bucket and (now_ts - bucket[0]) > _DIAGNOSTICS_RATE_WINDOW_SEC:
            bucket.popleft()
        if len(bucket) >= _DIAGNOSTICS_RATE_MAX_REQS:
            retry_after = max(1, int(_DIAGNOSTICS_RATE_WINDOW_SEC - (now_ts - bucket[0])))
            return JSONResponse(
                status_code=429,
                content={"detail": "Diagnostics rate limit exceeded. Please wait before submitting another check."},
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now_ts)

    live_state = load_live_state()
    report = diagnostics_ai.analyze_athlete_symptoms(payload, live_state)
    try:
        db.save_diagnostic_assessment({
            "id": report["assessment_id"],
            "created_at": report["generated_at"],
            "date_str": str(report["generated_at"])[:10],
            "input_mode": payload.input_mode,
            "raw_text": payload.raw_text,
            "report": report,
        })
    except Exception as exc:
        logger.warning(f"[Diagnostics] Failed saving assessment to SQLite: {exc}")
    return report


@app.get("/api/diagnostics/history")
def get_diagnostics_history(limit: int = 10):
    capped = max(1, min(25, int(limit or 10)))
    items = db.get_recent_diagnostic_assessments(limit=capped)
    return {"success": True, "count": len(items), "history": items}


@app.post("/api/diagnostics/{assessment_id}/apply")
def mark_diagnostics_applied(assessment_id: str):
    cleaned_id = str(assessment_id or "").strip()
    if not cleaned_id:
        raise HTTPException(status_code=422, detail="assessment_id is required")
    updated = db.mark_diagnostic_applied(cleaned_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Diagnostic assessment not found")
    return {"success": True, "assessment_id": cleaned_id, "applied_to_adaptor": True}


def _parse_metric_0_100(val: Any, field_name: str) -> int:
    if isinstance(val, bool):
        raise HTTPException(status_code=422, detail=f"{field_name} must be an integer between 0 and 100")
    try:
        num = float(val)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a number between 0 and 100")
    if not math.isfinite(num):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a finite number between 0 and 100")
    score = int(round(num))
    if score < 0 or score > 100:
        raise HTTPException(status_code=422, detail=f"{field_name} must be between 0 and 100")
    return score


@app.post("/api/telemetry/override")
def override_telemetry(payload: TelemetryOverridePayload):
    if payload.key == "sleep_score" and payload.value is not None:
        payload.sleep_score = _parse_metric_0_100(payload.value, "sleep_score")
    elif payload.key == "body_battery" and payload.value is not None:
        payload.body_battery = _parse_metric_0_100(payload.value, "body_battery")
    elif payload.key == "training_readiness" and payload.value is not None:
        payload.training_readiness = _parse_metric_0_100(payload.value, "training_readiness")

    if payload.sleep_score is not None:
        payload.sleep_score = _parse_metric_0_100(payload.sleep_score, "sleep_score")
    if payload.body_battery is not None:
        payload.body_battery = _parse_metric_0_100(payload.body_battery, "body_battery")
    if payload.training_readiness is not None:
        payload.training_readiness = _parse_metric_0_100(payload.training_readiness, "training_readiness")

    today_uk = uk_today_str()
    raw_date = payload.date or payload.client_date
    target_date = _validate_past_or_today_date(raw_date) if raw_date else today_uk

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        if not raw_date and state.get("date"):
            state_d = str(state["date"])[:10]
            if state_d <= today_uk:
                target_date = state_d

        if target_date < today_uk:
            # Past-date telemetry override writes strictly to SQLite without touching today's live_state
            db_sleep = payload.sleep_score
            db_bb = payload.body_battery
            db_tr = payload.training_readiness
            if db_sleep is not None and db_bb is None:
                morning_bb = min(100, int(round(db_sleep * 1.05)))
                db_bb = max(25, min(100, morning_bb))
            if db_sleep is not None and db_tr is None:
                morning_bb = db_bb if db_bb is not None else min(100, int(round(db_sleep * 1.05)))
                db_tr = max(40, min(98, int(round(db_sleep * 0.65 + morning_bb * 0.38))))
            try:
                db.upsert_daily_biometrics(
                    target_date,
                    sleep_score=db_sleep,
                    body_battery=db_bb,
                    training_readiness=db_tr,
                    source="manual_override",
                )
            except Exception as dbe:
                logger.warning(f"Failed saving past-date telemetry override to daily_biometrics: {dbe}")
            return {"success": True, "date": target_date, "past_date_only": True}

        garmin = state.setdefault("garmin", {})
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

    try:
        db.upsert_daily_biometrics(
            target_date,
            sleep_score=garmin.get("sleep_score"),
            resting_hr=garmin.get("resting_hr"),
            body_battery=garmin.get("body_battery"),
            training_readiness=garmin.get("training_readiness"),
            source="manual_override",
        )
    except Exception as dbe:
        logger.warning(f"Failed saving telemetry override to daily_biometrics: {dbe}")

    return {"success": True, "garmin": garmin}


@app.post("/api/prescription/override")
def override_prescription(payload: PrescriptionOverridePayload):
    w_val = _coerce_weight_kg(payload.weight)
    if w_val is None or w_val < 0 or w_val > 500:
        raise HTTPException(status_code=422, detail="weight must be between 0 and 500 kg (or Bodyweight)")

    r_str = str(payload.reps).strip()
    r_val = _coerce_int_reps(payload.reps)
    is_valid_str_rep = bool(re.match(r"^(?:\d+s|Max|\d+-\d+)$", r_str))
    if r_val is not None:
        if r_val < 0 or r_val > 200:
            raise HTTPException(status_code=422, detail="reps must be between 0 and 200")
    elif not is_valid_str_rep:
        raise HTTPException(status_code=422, detail="reps must be 0-200, duration like '45s', 'Max', or a range like '8-12'")

    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        prescriptions = state.setdefault("strength_prescriptions", {})
        item = prescriptions.setdefault(payload.exercise_id, {})

        item["weight"] = payload.weight
        item["reps"] = payload.reps
        item["last_logged_weight"] = payload.weight
        item["last_logged_reps"] = payload.reps
        item["last_updated"] = uk_now().isoformat()

        if w_val > 0 and r_val is not None and r_val > 0:
            e1rm = round(w_val * (1.0 + r_val / 30.0), 1)
            item["e1rm"] = e1rm
            item["last_e1rm"] = e1rm

        save_live_state(state)
    return {"success": True, "exercise_id": payload.exercise_id, "prescription": item}


@app.post("/api/preferences/exercises")
def update_exercise_preferences(payload: ExercisePreferencesPayload):
    _reject_non_finite_json(payload.custom_exercises, "custom_exercises")
    _reject_non_finite_json(payload.permanent_swaps, "permanent_swaps")
    _reject_non_finite_json(payload.hidden_exercises, "hidden_exercises")
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
        athlete = dict(state.get("athlete") or {})
        live_weight_kg = _finite_pos_weight(state)
        if live_weight_kg is not None and not athlete.get("weight_kg"):
            athlete["weight_kg"] = live_weight_kg
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
                        "anaerobic_te": a.get("anaerobic_te") or 1.3,
                    }
                    a["benefits"] = benefits_engine.analyze_workout(text, telemetry, athlete)
                    updated_act = a
        save_live_state(state)
    return {"success": True, "activity_id": act_id_str, "sub_title": text, "activity": updated_act, "state": state}


def run_scheduled_sync():
    logger.info("[Scheduler] Starting scheduled sync with Garmin, MyNetDiary, and Renpho...")
    try:
        g_res = garmin_service.sync_today()
        if isinstance(g_res, dict) and g_res.get("success") is False:
            logger.warning(f"[Scheduler] Garmin sync notice: {g_res.get('error')}")
    except Exception as gex:
        logger.warning(f"[Scheduler] Garmin sync notice: {gex}")
    try:
        m_res = mnd_service.fetch_today_data(force=False)
        if isinstance(m_res, dict) and m_res.get("success") is False:
            logger.warning(f"[Scheduler] MyNetDiary sync notice: {m_res.get('error')}")
    except Exception as mex:
        logger.warning(f"[Scheduler] MyNetDiary sync notice: {mex}")
    try:
        r_res = renpho_service.sync_latest()
        if isinstance(r_res, dict) and r_res.get("success") is False:
            logger.warning(f"[Scheduler] Renpho sync notice: {r_res.get('error')}")
    except Exception as rex:
        logger.warning(f"[Scheduler] Renpho sync notice: {rex}")
    logger.info("[Scheduler] Periodic sync cycle completed.")


class PreferenceFieldEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: Any
    updated_at_ms: Optional[int] = None

    @field_validator("updated_at_ms", mode="before")
    @classmethod
    def _validate_ts_before(cls, v: Any) -> Any:
        return _reject_bool_nonfinite(v, "updated_at_ms", nonneg=True)


def _check_finite_pref_value(obj: Any, path: str = "value") -> None:
    if isinstance(obj, float) and not math.isfinite(obj):
        raise ValueError(f"Non-finite number in {path}")
    if isinstance(obj, dict):
        for k, v in obj.items():
            _check_finite_pref_value(v, f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, item in enumerate(obj):
            _check_finite_pref_value(item, f"{path}[{i}]")


class ClientPreferencesPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: Dict[str, PreferenceFieldEntry]

    @field_validator("fields")
    @classmethod
    def _validate_fields(cls, v: Dict[str, PreferenceFieldEntry]) -> Dict[str, PreferenceFieldEntry]:
        if len(v) > 9:
            raise ValueError("At most 9 preference fields allowed")
        for key, entry in v.items():
            if key not in analytics_service.ALLOWED_PREF_KEYS:
                raise ValueError(f"Unsupported preference key: {key}")
            _check_finite_pref_value(entry.value, key)
            if key in analytics_service.SCALAR_ENUM_PREF_KEYS:
                if not isinstance(entry.value, str) or len(entry.value) > 40:
                    raise ValueError(f"Preference field {key} must be a string <= 40 chars")
            if key == "pro_dial_macros":
                val = entry.value
                if not isinstance(val, dict):
                    raise ValueError("pro_dial_macros must be an object with protein and fat_pct")
                raw_p = val.get("protein")
                raw_fp = val.get("fat_pct")
                if (
                    isinstance(raw_p, bool) or not isinstance(raw_p, (int, float))
                    or not math.isfinite(float(raw_p)) or not (50 <= float(raw_p) <= 400)
                ):
                    raise ValueError("pro_dial_macros.protein must be in [50, 400]")
                if (
                    isinstance(raw_fp, bool) or not isinstance(raw_fp, (int, float))
                    or not math.isfinite(float(raw_fp)) or not (15 <= float(raw_fp) <= 65)
                ):
                    raise ValueError("pro_dial_macros.fat_pct must be in [15, 65]")
        return v


@app.get("/api/analytics/summary")
def get_analytics_summary():
    try:
        state = load_live_state()
        return analytics_service.build_analytics_summary(state)
    except Exception as e:
        logger.error(f"Analytics summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/preferences/state")
def get_preferences_state():
    raw = db.get_kv("client_preferences_v1")
    parsed: Dict[str, Any] = {"fields": {}, "updated_at_ms": 0}
    if raw:
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and isinstance(obj.get("fields"), dict):
                parsed = {
                    "fields": obj["fields"],
                    "updated_at_ms": int(obj.get("updated_at_ms") or 0),
                }
        except Exception:
            pass
    return {"preferences": parsed}


_NUTRITION_PREF_TRIGGERS = (
    "goal_key",
    "custom_goal_macros",
    "diet_strategy",
    "carb_cycle_level",
    "pro_dial_macros",
)


@app.post("/api/preferences/state")
def update_preferences_state(payload: ClientPreferencesPayload):
    dumped = payload.model_dump()
    _validate_payload_size(dumped, 65536)

    with state_store.state_lock(LIVE_STATE_PATH):
        raw_stored = db.get_kv("client_preferences_v1")
        stored_obj = None
        if raw_stored:
            try:
                parsed_stored = json.loads(raw_stored)
                if isinstance(parsed_stored, dict):
                    stored_obj = parsed_stored
            except Exception:
                stored_obj = None

        merged_result = analytics_service.merge_preferences_v1(stored_obj, dumped)
        merged_prefs = merged_result["preferences"]
        resolutions = merged_result["field_resolutions"]

        db.set_kv("client_preferences_v1", json.dumps(merged_prefs, allow_nan=False))

        if any(resolutions.get(k) == "accepted" for k in _NUTRITION_PREF_TRIGGERS):
            state = load_live_state(raise_on_corrupt=True)
            analytics_service.recalculate_nutrition(
                state,
                uk_today_str(),
                pref_fields=merged_prefs.get("fields", {}),
            )
            save_live_state(state)

    return {
        "success": True,
        "preferences": merged_prefs,
        "field_resolutions": resolutions,
    }


class FlexClaimPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str
    bonus_kcal: Optional[int] = None
    client_event_id: Optional[str] = None

    @field_validator("mode")
    @classmethod
    def _val_mode(cls, v: str) -> str:
        cleaned = str(v or "").strip()
        if cleaned not in analytics_service.FLEX_VALID_MODES:
            raise ValueError(f"mode must be one of {', '.join(analytics_service.FLEX_VALID_MODES)}")
        return cleaned

    @field_validator("bonus_kcal", mode="before")
    @classmethod
    def _val_bonus(cls, v: Any) -> Any:
        if v is None:
            return None
        _reject_bool_nonfinite(v, "bonus_kcal", nonneg=True)
        if isinstance(v, str):
            s = v.strip()
            if not s or not s.isdigit():
                raise ValueError("bonus_kcal must be an integer between 200 and 800")
            num = int(s)
        elif isinstance(v, (int, float)):
            if isinstance(v, float) and not v.is_integer():
                raise ValueError("bonus_kcal must be a whole integer")
            num = int(v)
        else:
            raise ValueError("bonus_kcal must be an integer between 200 and 800")
        if num < 200 or num > 800:
            raise ValueError("bonus_kcal must be between 200 and 800")
        return num

    @field_validator("client_event_id")
    @classmethod
    def _val_event_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        if len(s) > 120:
            raise ValueError("client_event_id too long")
        return s or None


class FlexUndoPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: Optional[str] = None

    @field_validator("claim_id")
    @classmethod
    def _val_cid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        if len(s) > 80:
            raise ValueError("claim_id too long")
        return s or None


class FlexPlanPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str = "upsert"
    target_date: Optional[str] = None
    target_kcal: Optional[int] = None
    label: Optional[str] = ""

    @field_validator("action")
    @classmethod
    def _val_action(cls, v: str) -> str:
        act = str(v or "").strip().lower()
        if act not in ("upsert", "cancel"):
            raise ValueError("action must be 'upsert' or 'cancel'")
        return act

    @field_validator("target_date")
    @classmethod
    def _val_tdate(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
            raise ValueError("target_date must use YYYY-MM-DD format")
        try:
            datetime.strptime(s, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("target_date is not a valid calendar date")
        return s

    @field_validator("target_kcal", mode="before")
    @classmethod
    def _val_tkcal(cls, v: Any) -> Any:
        if v is None:
            return None
        _reject_bool_nonfinite(v, "target_kcal", nonneg=True)
        if isinstance(v, str):
            s = v.strip()
            if not s or not s.isdigit():
                raise ValueError("target_kcal must be an integer between 200 and 800")
            num = int(s)
        elif isinstance(v, (int, float)):
            if isinstance(v, float) and not v.is_integer():
                raise ValueError("target_kcal must be a whole integer")
            num = int(v)
        else:
            raise ValueError("target_kcal must be an integer between 200 and 800")
        if num < 200 or num > 800:
            raise ValueError("target_kcal must be between 200 and 800")
        return num

    @field_validator("label")
    @classmethod
    def _val_label(cls, v: Optional[str]) -> str:
        cleaned = strip_markup(str(v or "")).strip()
        return cleaned[:40]


@app.post("/api/fuel/flex/claim")
def claim_fuel_flex(payload: FlexClaimPayload):
    event_id = str(payload.client_event_id or "").strip()
    try:
        with state_store.state_lock(LIVE_STATE_PATH):
            state = load_live_state(raise_on_corrupt=True)
            if event_id and db.get_kv(f"idem:fuel_flex_claim:{event_id}") == "1":
                fresh_status = analytics_service.compute_flex_refeed_status(state, today_str=uk_today_str())
                return {
                    "success": True,
                    "duplicate": True,
                    "claim": fresh_status["cooldown"].get("last_claim"),
                    "flex_refeed": fresh_status,
                    "state": state,
                }
            claim_rec, fresh_status = analytics_service.claim_flex_refeed(
                state,
                mode=payload.mode,
                bonus_kcal=payload.bonus_kcal,
            )
            if event_id:
                db.claim_idempotency_key("fuel_flex_claim", event_id)
            save_live_state(state)
        return {
            "success": True,
            "claim": claim_rec,
            "flex_refeed": fresh_status,
            "state": state,
        }
    except analytics_service.FlexRuleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[Flex] Claim error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/fuel/flex/undo")
def undo_fuel_flex(payload: Optional[FlexUndoPayload] = None):
    claim_id = payload.claim_id if payload else None
    try:
        with state_store.state_lock(LIVE_STATE_PATH):
            state = load_live_state(raise_on_corrupt=True)
            removed_id, fresh_status = analytics_service.undo_flex_refeed(state, claim_id=claim_id)
            save_live_state(state)
        return {
            "success": True,
            "removed_claim_id": removed_id,
            "flex_refeed": fresh_status,
            "state": state,
        }
    except analytics_service.FlexRuleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[Flex] Undo error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/fuel/flex/plan")
def update_fuel_flex_plan(payload: FlexPlanPayload):
    if payload.action == "upsert" and (not payload.target_date or payload.target_kcal is None):
        raise HTTPException(status_code=422, detail="target_date and target_kcal are required for upsert")
    try:
        with state_store.state_lock(LIVE_STATE_PATH):
            state = load_live_state(raise_on_corrupt=True)
            fresh_status = analytics_service.upsert_or_cancel_flex_bank_plan(
                state,
                action=payload.action,
                target_date=payload.target_date,
                target_kcal=payload.target_kcal,
                label=payload.label or "",
            )
            save_live_state(state)
        return {
            "success": True,
            "flex_refeed": fresh_status,
            "state": state,
        }
    except analytics_service.FlexRuleError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[Flex] Plan error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ==================== PAROXYSMAL EPISODE & ILLNESS RECOVERY TRACKER ====================

class EpisodeCreatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    onset_time: Optional[str] = None
    acute_peak_end_time: Optional[str] = None
    full_recovery_time: Optional[str] = None
    user_recovered_at: Optional[str] = None
    severity: Optional[str] = "moderate"
    symptoms: Optional[List[str]] = None
    triggers: Optional[List[str]] = None
    illness_active: Optional[bool] = None
    notes: Optional[str] = ""
    spike_auto_detected: Optional[bool] = False
    client_event_id: Optional[str] = None

    @field_validator("notes", mode="before")
    @classmethod
    def _clean_notes(cls, v: Any) -> str:
        return strip_markup(str(v or ""))[:2000]


class EpisodeUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    client_event_id: Optional[str] = None
    action: Optional[str] = "edit_details"
    timestamp: Optional[str] = None
    onset_time: Optional[str] = None
    acute_peak_end_time: Optional[str] = None
    full_recovery_time: Optional[str] = None
    user_recovered_at: Optional[str] = None
    severity: Optional[str] = None
    symptoms: Optional[List[str]] = None
    triggers: Optional[List[str]] = None
    notes: Optional[str] = None

    @field_validator("notes", mode="before")
    @classmethod
    def _clean_notes(cls, v: Any) -> Optional[str]:
        if v is None:
            return None
        return strip_markup(str(v))[:2000]


class EpisodeDeletePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str


class SpikeDismissPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    spike_ts_ms: Optional[int] = None

    @field_validator("spike_ts_ms", mode="before")
    @classmethod
    def _check_spike_ts(cls, v: Any) -> Any:
        return _reject_bool_nonfinite(v, "spike_ts_ms", nonneg=True)


class IllnessLogPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date_str: Optional[str] = None
    date: Optional[str] = None
    status: str = "active"
    severity: str = "moderate"
    symptoms: Optional[List[str]] = None
    notes: Optional[str] = ""

    @field_validator("notes", mode="before")
    @classmethod
    def _clean_notes(cls, v: Any) -> str:
        return strip_markup(str(v or ""))[:1000]


@app.get("/api/health/autonomic/status")
def get_autonomic_status():
    state = load_live_state()
    return autonomic_service.build_autonomic_summary(state)


@app.get("/api/health/episodes")
def list_paroxysmal_episodes(days: int = 365):
    bounded_days = max(1, min(730, int(days or 365)))
    state = load_live_state()
    summary = autonomic_service.build_autonomic_summary(state)
    episodes = db.get_paroxysmal_episodes(days=bounded_days)
    return {
        "episodes": episodes,
        "patterns": summary.get("patterns"),
        "autonomic": summary,
    }


@app.post("/api/health/episodes")
def create_paroxysmal_episode_endpoint(payload: EpisodeCreatePayload):
    state = load_live_state()
    req_data = payload.model_dump()
    if req_data.get("onset_time"):
        parsed = time_utils.parse_uk_ts(req_data["onset_time"])
        if parsed is None:
            raise HTTPException(status_code=422, detail="Invalid onset_time timestamp")
        if parsed.date().isoformat() > uk_today_str():
            raise HTTPException(status_code=422, detail="Episode onset_time cannot be in the future")
    episode = autonomic_service.create_episode(req_data, live_state=state)
    summary = autonomic_service.build_autonomic_summary(state)
    return {"success": True, "episode": episode, "autonomic": summary}


@app.post("/api/health/episodes/update")
def update_paroxysmal_episode_endpoint(payload: EpisodeUpdatePayload):
    if not payload.id and not payload.client_event_id:
        raise HTTPException(status_code=422, detail="Episode id or client_event_id is required")
    state = load_live_state()
    updated = autonomic_service.update_episode(payload.model_dump(exclude_none=True), live_state=state)
    if updated is None:
        raise HTTPException(status_code=404, detail="Paroxysmal episode not found")
    summary = autonomic_service.build_autonomic_summary(state)
    return {"success": True, "episode": updated, "autonomic": summary}


@app.post("/api/health/episodes/delete")
def delete_paroxysmal_episode_endpoint(payload: EpisodeDeletePayload):
    ep_id = str(payload.id or "").strip()
    if not ep_id:
        raise HTTPException(status_code=422, detail="Episode id is required")
    deleted = db.delete_paroxysmal_episode(ep_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Paroxysmal episode not found")
    state = load_live_state()
    summary = autonomic_service.build_autonomic_summary(state)
    return {"success": True, "deleted_id": ep_id, "autonomic": summary}


@app.post("/api/health/autonomic/dismiss-spike")
def dismiss_autonomic_spike(payload: Optional[SpikeDismissPayload] = None):
    ts_ms = payload.spike_ts_ms if payload else None
    autonomic_service.dismiss_spike_until(ts_ms)
    state = load_live_state()
    summary = autonomic_service.build_autonomic_summary(state)
    return {"success": True, "autonomic": summary}


@app.get("/api/health/episodes/export")
def export_paroxysmal_episodes(format: str = "json", days: int = 365):
    bounded_days = max(1, min(730, int(days or 365)))
    fmt = str(format or "json").strip().lower()
    episodes = db.get_paroxysmal_episodes(days=bounded_days)
    illness_logs = db.get_illness_logs(days=min(bounded_days, 180))
    if fmt == "csv":
        csv_body = autonomic_service.serialize_episodes_csv(episodes, illness_logs)
        return Response(
            content=csv_body,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="pulse-clinical-episodes.csv"'},
        )
    state = load_live_state()
    summary = autonomic_service.build_autonomic_summary(state)
    return {
        "generated_at": uk_now().isoformat(),
        "clinical_disclaimer": autonomic_service.CLINICAL_DISCLAIMER,
        "differential_pathways": list(autonomic_service.DIFFERENTIAL_PATHWAYS.values()),
        "patterns": summary.get("patterns"),
        "illness": summary.get("illness"),
        "illness_logs": illness_logs,
        "episodes": episodes,
    }


@app.get("/api/health/illness")
def get_illness_status_endpoint():
    return autonomic_service.compute_illness_status()


@app.post("/api/health/illness")
def upsert_illness_log_endpoint(payload: IllnessLogPayload):
    target_date = _validate_past_or_today_date(payload.date_str or payload.date, allow_none=True)
    status = str(payload.status or "active").strip().lower()
    if status in ("clear", "cleared", "none", "resolved", "delete"):
        db.delete_illness_log(target_date)
    else:
        if status not in ("active", "recovering"):
            raise HTTPException(status_code=422, detail="status must be 'active', 'recovering', or 'clear'")
        sev = str(payload.severity or "moderate").strip().lower()
        if sev not in ("mild", "moderate", "severe"):
            raise HTTPException(status_code=422, detail="severity must be 'mild', 'moderate', or 'severe'")
        syms = [s for s in (payload.symptoms or []) if str(s).strip() in autonomic_service.VALID_ILLNESS_SYMPTOMS]
        db.upsert_illness_log(
            date_str=target_date,
            status=status,
            severity=sev,
            symptoms=syms,
            notes=payload.notes or "",
        )

    today_uk = uk_today_str()
    with state_store.state_lock(LIVE_STATE_PATH):
        state = load_live_state(raise_on_corrupt=True)
        analytics_service.recalculate_nutrition(state, today_uk)
        save_live_state(state)

    summary = autonomic_service.build_autonomic_summary(state, today_uk)
    flex_refeed = analytics_service.compute_flex_refeed_status(state, today_str=today_uk)
    return {
        "success": True,
        "date_str": target_date,
        "illness": summary.get("illness"),
        "autonomic": summary,
        "flex_refeed": flex_refeed,
        "state": state,
    }
