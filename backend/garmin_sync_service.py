import json
import math
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timedelta
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from benefits_engine import PhysiologicalBenefitsEngine
import analytics_service
try:
    import autonomic_service
except Exception:
    autonomic_service = None
try:
    import db
except Exception:
    db = None
import state_store
import time_utils
from time_utils import UK_TZ, uk_now, uk_today_str

_DATA_DIR = state_store.get_data_dir()
if 'GARMIN_TOKEN_DIR' in os.environ and os.environ['GARMIN_TOKEN_DIR'].strip():
    TOKEN_DIR = os.environ['GARMIN_TOKEN_DIR'].strip()
else:
    TOKEN_DIR = os.path.join(_DATA_DIR, 'garmin_tokens')

# Only fall back to /tmp/garmin_tokens if TOKEN_DIR isn't writable
try:
    os.makedirs(TOKEN_DIR, exist_ok=True)
    test_file = os.path.join(TOKEN_DIR, '.write_test')
    with open(test_file, 'w') as f:
        f.write('1')
    os.remove(test_file)
except Exception:
    TOKEN_DIR = '/tmp/garmin_tokens'
    os.makedirs(TOKEN_DIR, exist_ok=True)

LIVE_STATE_PATH = state_store.get_live_state_path()


def _finite_pos_float(val):
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(val)
        return num if math.isfinite(num) and num > 0 else None
    except (TypeError, ValueError):
        return None


def _finite_nonneg_float(val):
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(val)
        return num if math.isfinite(num) and num >= 0 else None
    except (TypeError, ValueError):
        return None


def _has_clock_time(ts_val):
    if not ts_val:
        return False
    return bool(re.search(r'(?:T|\s)\d{1,2}:\d{2}', str(ts_val)))


def _is_manual_watch_duplicate(manual_entry, watch_entries):
    m_cals = float(manual_entry.get('calories') or 0)
    m_date = manual_entry.get('date')
    m_has_clock = _has_clock_time(m_date)
    m_dt = time_utils.parse_uk_ts(m_date) if m_has_clock else None

    for w in watch_entries:
        w_cals = float(w.get('calories') or 0)
        if abs(w_cals - m_cals) > 15.0:
            continue
        w_date = w.get('date')
        w_has_clock = _has_clock_time(w_date)
        if not m_has_clock or not w_has_clock:
            return True
        w_dt = time_utils.parse_uk_ts(w_date)
        if m_dt is not None and w_dt is not None and abs((w_dt - m_dt).total_seconds()) <= 7200:
            return True
    return False


class GarminSyncService:
    def __init__(self):
        self.benefits_engine = PhysiologicalBenefitsEngine()
        self._sync_lock = threading.Lock()
        self._client_lock = threading.RLock()
        self._last_sync_ts = 0.0
        self._cooldown_until = 0.0
        self._auth_cooldown_until = 0.0
        self._backoff_sec = 60
        self.client = None
        self.pending_login_state = None

    @staticmethod
    def _normalize_token_str(raw_tok):
        if not raw_tok:
            return ''
        tok = str(raw_tok).strip()
        if (tok.startswith('"') and tok.endswith('"')) or (tok.startswith("'") and tok.endswith("'")):
            tok = tok[1:-1].strip()
        return tok

    def _set_oauth_failed_at(self, value):
        try:
            with state_store.state_lock(LIVE_STATE_PATH):
                state = state_store.load_live_state(LIVE_STATE_PATH)
                state.setdefault('garmin', {})['oauth_failed_at'] = value
                state_store.save_live_state(state, LIVE_STATE_PATH)
        except Exception as e:
            print(f"[GarminSync] Warning updating oauth_failed_at: {e}")

    def _ensure_display_name(self, client):
        if not client or getattr(client, 'display_name', None):
            return
        try:
            profile = client.client.connectapi("/userprofile-service/socialProfile")
            if isinstance(profile, dict) and profile.get('displayName'):
                client.display_name = profile.get('displayName')
        except Exception as prof_err:
            err_str = str(prof_err)
            is_auth = isinstance(prof_err, GarminConnectAuthenticationError) or any(
                term in err_str for term in ("401", "Unauthorized", "invalid_grant", "OAuth2Token")
            )
            if is_auth:
                with self._client_lock:
                    self.client = None
                    self._auth_cooldown_until = time.time() + 1800
                raise GarminConnectAuthenticationError(
                    "Garmin OAuth session expired (401) — re-authenticate via Garmin Sync"
                ) from prof_err

    def _persist_tokens(self, client):
        if not client:
            return
        try:
            os.makedirs(TOKEN_DIR, exist_ok=True)
            try:
                os.chmod(TOKEN_DIR, 0o700)
            except OSError:
                pass
            client.client.dump(TOKEN_DIR)
            for fname in os.listdir(TOKEN_DIR):
                fpath = os.path.join(TOKEN_DIR, fname)
                if os.path.isfile(fpath):
                    try:
                        os.chmod(fpath, 0o600)
                    except OSError:
                        pass
        except Exception as e:
            print(f"[GarminSync] Warning dumping tokens to {TOKEN_DIR}: {e}")

        dumped = None
        try:
            dumped = client.client.dumps()
        except Exception as e:
            print(f"[GarminSync] Warning serializing tokens: {e}")
        if dumped:
            dump_path = os.path.join(TOKEN_DIR, 'garmin_tokens_dump.json')
            tmp_path = None
            try:
                os.makedirs(TOKEN_DIR, exist_ok=True)
                with tempfile.NamedTemporaryFile(
                    mode='w',
                    encoding='utf-8',
                    dir=TOKEN_DIR,
                    prefix='.garmin_tokens_dump.',
                    suffix='.tmp',
                    delete=False,
                ) as tmp:
                    tmp_path = tmp.name
                    tmp.write(dumped)
                    tmp.flush()
                    os.fsync(tmp.fileno())
                try:
                    os.chmod(tmp_path, 0o600)
                except OSError:
                    pass
                os.replace(tmp_path, dump_path)
                tmp_path = None
            except Exception as e:
                print(f"[GarminSync] Warning writing garmin_tokens_dump.json: {e}")
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
        if db is not None and dumped:
            try:
                db.set_kv('garmin_tokens_json', dumped)
            except Exception as e:
                print(f"[GarminSync] Warning persisting tokens to DB: {e}")

    def _try_load_token_str(self, client, raw_tok):
        tok = self._normalize_token_str(raw_tok)
        if not tok:
            return False
        try:
            client.login(tokenstore=tok)
            return True
        except Exception as exc:
            err_str = str(exc)
            if (
                isinstance(exc, (GarminConnectAuthenticationError, GarminConnectTooManyRequestsError))
                or any(term in err_str for term in ("401", "Unauthorized", "invalid_grant", "OAuth2Token", "429", "Too Many Requests"))
            ):
                return False
            try:
                client.client.loads(tok)
                return True
            except Exception:
                return False

    def restore_token_str(self, raw_tok):
        if not raw_tok:
            return False
        if not isinstance(raw_tok, str):
            try:
                raw_tok = json.dumps(raw_tok)
            except Exception:
                return False
        client = Garmin()
        if self._try_load_token_str(client, raw_tok):
            with self._client_lock:
                self.client = client
                self._auth_cooldown_until = 0.0
            self._persist_tokens(client)
            return True
        return False

    def get_client(self):
        with self._client_lock:
            if not self.client:
                candidate = Garmin()
                loaded = False
                # 1. Try SQLite persistent token store first (survives Railway restarts & stores refreshed OAuth2)
                if db is not None:
                    try:
                        db_tok = db.get_kv('garmin_tokens_json')
                        if db_tok and self._try_load_token_str(candidate, db_tok):
                            loaded = True
                    except Exception as e:
                        print(f"[GarminSync] DB token load notice: {e}")

                # 2. Try dumped JSON token files (dumps()/loads() is more reliable across reloads than garth dir)
                if not loaded:
                    dump_path = os.path.join(TOKEN_DIR, 'garmin_tokens_dump.json')
                    if os.path.exists(dump_path):
                        try:
                            with open(dump_path, 'r', encoding='utf-8') as f:
                                raw_dump = f.read().strip()
                            if raw_dump and self._try_load_token_str(candidate, raw_dump):
                                loaded = True
                        except Exception as e:
                            print(f"[GarminSync] Token dump load notice ({dump_path}): {e}")

                # 3. Try persistent TOKEN_DIR
                if not loaded:
                    try:
                        candidate.login(tokenstore=TOKEN_DIR)
                        loaded = True
                    except Exception as e:
                        print(f"[GarminSync] Login from tokenstore ({TOKEN_DIR}) error: {e}")

                # 4. Fall back to GARMIN_TOKENS_JSON env var (normalized cleanly per call, without mutating os.environ)
                if not loaded and 'GARMIN_TOKENS_JSON' in os.environ:
                    env_tok = self._normalize_token_str(os.environ.get('GARMIN_TOKENS_JSON', ''))
                    if env_tok and self._try_load_token_str(candidate, env_tok):
                        loaded = True

                if not loaded:
                    self.client = None
                    raise GarminConnectAuthenticationError("No valid Garmin token found in DB, tokenstore, or GARMIN_TOKENS_JSON")

                self.client = candidate
                self._ensure_display_name(self.client)
            return self.client

    def export_tokens_json(self):
        with self._client_lock:
            if self.client:
                try:
                    dumped = self.client.client.dumps()
                    if dumped:
                        return dumped
                except Exception as e:
                    print(f"[GarminSync] Warning dumping from active client: {e}")
        if db is not None:
            try:
                db_tok = db.get_kv('garmin_tokens_json')
                if db_tok:
                    return db_tok
            except Exception:
                pass
        try:
            temp_client = Garmin()
            try:
                temp_client.login(tokenstore=TOKEN_DIR)
            except Exception:
                env_tok = self._normalize_token_str(os.environ.get('GARMIN_TOKENS_JSON', ''))
                if env_tok and self._try_load_token_str(temp_client, env_tok):
                    pass
                else:
                    raise
            return temp_client.client.dumps()
        except Exception as e:
            print(f"[GarminSync] Could not export tokens: {e}")
            return None

    def login_with_credentials(self, email, password):
        try:
            os.makedirs(TOKEN_DIR, exist_ok=True)
            client = Garmin(email=email, password=password, return_on_mfa=True)
            res = client.login()
            if isinstance(res, tuple) and len(res) == 2 and res[0] == "needs_mfa":
                with self._client_lock:
                    self.pending_login_state = (client, res[1])
                return {"needs_mfa": True, "message": "2FA code required"}
            self._ensure_display_name(client)
            self._persist_tokens(client)
            with self._client_lock:
                self.client = client
                self._auth_cooldown_until = 0.0
                self.pending_login_state = None
            self._set_oauth_failed_at(None)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def submit_mfa(self, mfa_code):
        with self._client_lock:
            pending = self.pending_login_state
        if not pending:
            return {"success": False, "error": "No pending MFA login session"}
        try:
            client, client_state = pending
            client.resume_login(client_state, mfa_code.strip())
            self._ensure_display_name(client)
            self._persist_tokens(client)
            with self._client_lock:
                self.client = client
                self._auth_cooldown_until = 0.0
                self.pending_login_state = None
            self._set_oauth_failed_at(None)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def sync_today(self, target_date_str=None, force=False):
        effective_date = target_date_str or uk_today_str()
        now_ts = time.time()
        cached_state = state_store.load_live_state(LIVE_STATE_PATH)
        cached_oauth_date = (cached_state.get('garmin') or {}).get('oauth_date')

        if not force and now_ts < self._auth_cooldown_until:
            print("[GarminSync] OAuth session expired — awaiting re-auth (cooldown active); serving cached state.")
            return cached_state
        if now_ts < self._cooldown_until:
            wait_s = int(self._cooldown_until - now_ts)
            print(f"[GarminSync] Rate-limit cooldown active ({wait_s}s remaining); serving cached state.")
            return cached_state
        if not force and effective_date == cached_oauth_date and (now_ts - self._last_sync_ts) < 180:
            return cached_state

        if not self._sync_lock.acquire(blocking=False):
            print("[GarminSync] Sync already in flight; serving cached state.")
            return cached_state
        try:
            res = self._sync_today_impl(target_date_str=effective_date)
            if isinstance(res, dict) and res.get("success") is False:
                return res
            self._last_sync_ts = time.time()
            self._backoff_sec = 60
            self._cooldown_until = 0.0
            if not (isinstance(res, dict) and (res.get('garmin') or {}).get('oauth_failed_at')):
                self._auth_cooldown_until = 0.0
            return res
        except GarminConnectAuthenticationError as auth_err:
            with self._client_lock:
                self.client = None
                self._auth_cooldown_until = time.time() + 1800
            self._set_oauth_failed_at(uk_now().isoformat())
            return {"success": False, "requires_auth": True, "error": str(auth_err)}
        except GarminConnectTooManyRequestsError as rl_err:
            self._backoff_sec = min(3600, max(60, self._backoff_sec * 2))
            self._cooldown_until = time.time() + self._backoff_sec
            print(f"[GarminSync] 429 Too Many Requests ({rl_err}); backing off for {self._backoff_sec}s.")
            return state_store.load_live_state(LIVE_STATE_PATH)
        finally:
            self._sync_lock.release()

    def _sync_today_impl(self, target_date_str=None):
        if not target_date_str:
            target_date_str = uk_today_str()

        client = self.get_client()

        summary = None
        raw_activities = []
        recent_raw_activities = []
        sleep_score = None
        sleep_duration = None
        readiness_score = None
        readiness_level = None
        readiness_feedback = None
        hrv_weekly = None
        hrv_status = None
        hrv_last_night = None
        hrv_baseline_low = None
        avg_stress_level = None
        sleep_avg_stress = None
        sleep_start_ts = None
        sleep_end_ts = None
        deep_sleep_sec = None
        rem_sleep_sec = None
        light_sleep_sec = None
        awake_sleep_sec = None
        stress_samples = None
        hr_samples = None
        sleep_stress_samples = None
        live_body_battery = None
        auth_failed = False
        last_auth_error = None
        last_error = None

        summary_ok = False
        activities_ok = False
        sleep_ok = False
        readiness_ok = False
        bb_ok = False

        AUTH_ERROR_TERMS = ["401", "Unauthorized", "invalid_grant", "OAuth2Token"]

        def is_auth_error(exc):
            if isinstance(exc, GarminConnectTooManyRequestsError):
                raise exc
            err_str = str(exc)
            if "429" in err_str or "too many requests" in err_str.lower():
                raise GarminConnectTooManyRequestsError(err_str)
            if isinstance(exc, GarminConnectAuthenticationError):
                return True
            return any(term in err_str for term in AUTH_ERROR_TERMS)

        # 1. Fetch user summary
        try:
            summary = client.get_user_summary(target_date_str)
            if summary is None:
                summary = {}
            summary_ok = True
        except Exception as e:
            print(f"[GarminSync] Warning fetching summary: {e}")
            last_error = str(e)
            if is_auth_error(e):
                auth_failed = True
                last_auth_error = str(e)
            summary = {}

        # 2. Fetch today's & recent activities (last 5 days so recent_activities stays fresh while today_activities only has target_date_str)
        if not auth_failed:
            try:
                start_5d = (datetime.strptime(target_date_str, "%Y-%m-%d").date() - timedelta(days=5)).isoformat()
                try:
                    fetched_acts = client.get_activities_by_date(start_5d, target_date_str)
                except Exception as inner_e:
                    if is_auth_error(inner_e):
                        raise inner_e
                    # Fallback to get_activities(0, 15) so get_activities_by_date never fails due to arguments/API quirks
                    fetched_acts = client.get_activities(0, 15)
                recent_raw_activities = fetched_acts if isinstance(fetched_acts, list) else []
                raw_activities = [a for a in recent_raw_activities if str(a.get('startTimeLocal', '')).startswith(target_date_str)]
                activities_ok = True
            except Exception as e:
                print(f"[GarminSync] Warning fetching activities: {e}")
                last_error = str(e)
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)
                raw_activities = []
                recent_raw_activities = []

        # 3. Fetch sleep data
        if not auth_failed:
            try:
                sleep = client.get_sleep_data(target_date_str)
                sleep_ok = True
                dto = (sleep or {}).get('dailySleepDTO') or {}
                scores = dto.get('sleepScores') or {}
                sleep_score = (scores.get('overall') or {}).get('value')
                sec = int(dto.get('sleepTimeSeconds') or 0)
                if sec > 0:
                    hours = sec // 3600
                    mins = (sec % 3600) // 60
                    sleep_duration = f"{hours}h {mins}m"
                sleep_avg_stress = _finite_nonneg_float(dto.get('avgSleepStress'))
                if autonomic_service is not None:
                    sleep_start_ts = autonomic_service._parse_ts_ms(dto.get('sleepStartTimestampGMT') or dto.get('sleepStartTimestampLocal'))
                    sleep_end_ts = autonomic_service._parse_ts_ms(dto.get('sleepEndTimestampGMT') or dto.get('sleepEndTimestampLocal'))
                    if isinstance(sleep, dict) and isinstance(sleep.get('sleepStress'), list):
                        sleep_stress_samples = autonomic_service.normalize_intraday_series(
                            sleep.get('sleepStress'),
                            keep_negative=True,
                        )
                deep_sleep_sec = dto.get('deepSleepSeconds')
                rem_sleep_sec = dto.get('remSleepSeconds')
                light_sleep_sec = dto.get('lightSleepSeconds')
                awake_sleep_sec = dto.get('awakeSleepSeconds')
            except Exception as e:
                print(f"[GarminSync] Warning fetching sleep: {e}")
                last_error = str(e)
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # 4. Fetch live training readiness (falls back to morning readiness if intraday list is empty)
        if not auth_failed:
            try:
                readiness = None
                tr_ep_ok = False
                morning_tr_ok = False
                try:
                    tr_list = client.get_training_readiness(target_date_str)
                    tr_ep_ok = True
                    if isinstance(tr_list, list) and len(tr_list) > 0:
                        valid_tr = [r for r in tr_list if isinstance(r, dict) and r.get('score') is not None]
                        if valid_tr:
                            readiness = max(
                                valid_tr,
                                key=lambda r: (
                                    time_utils.parse_uk_ts(r.get('timestamp') or r.get('timestampLocal'))
                                    or datetime.min.replace(tzinfo=UK_TZ)
                                ),
                            )
                    elif isinstance(tr_list, dict) and tr_list.get('score') is not None:
                        readiness = tr_list
                except Exception as tr_e:
                    if is_auth_error(tr_e):
                        raise tr_e
                    readiness = None

                if not readiness:
                    morning_tr = client.get_morning_training_readiness(target_date_str)
                    if morning_tr is None or isinstance(morning_tr, (dict, list)):
                        morning_tr_ok = True
                    readiness = morning_tr if isinstance(morning_tr, dict) else None

                readiness_ok = tr_ep_ok or morning_tr_ok
                if isinstance(readiness, dict):
                    readiness_score = readiness.get('score')
                    readiness_level = readiness.get('level')
                    readiness_feedback = readiness.get('feedbackShort')
                    hrv_weekly = readiness.get('hrvWeeklyAverage')
            except Exception as e:
                print(f"[GarminSync] Warning fetching readiness: {e}")
                last_error = str(e)
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # 5. Fetch live Body Battery timeline across all Garmin endpoints and reconcile with summary
        body_battery_debug = None
        if not auth_failed:
            def _parse_bb_int(level_val):
                if level_val is None or isinstance(level_val, bool):
                    return None
                try:
                    lvl = int(round(float(level_val)))
                    return lvl if 0 <= lvl <= 100 else None
                except (ValueError, TypeError):
                    return None

            def _parse_ts_ms(ts_val):
                if ts_val is None or isinstance(ts_val, bool):
                    return None
                if isinstance(ts_val, (int, float)):
                    if not math.isfinite(ts_val) or ts_val <= 0:
                        return None
                    return int(ts_val) if ts_val > 1e11 else int(ts_val * 1000)
                dt = time_utils.parse_uk_ts(ts_val)
                return int(dt.timestamp() * 1000) if dt is not None else None

            def _fmt_london_iso(ts_ms):
                if not ts_ms or ts_ms <= 0:
                    return None
                try:
                    return datetime.fromtimestamp(ts_ms / 1000.0, tz=UK_TZ).astimezone(UK_TZ).isoformat()
                except Exception:
                    return None

            def _extract_latest_bb_array(vals):
                latest_ts = -1
                latest_val = None
                for entry in (vals or []):
                    if not isinstance(entry, (list, tuple)):
                        continue
                    if len(entry) >= 3 and isinstance(entry[1], str):
                        raw_ts, raw_lvl = entry[0], entry[2]
                    elif len(entry) >= 2:
                        raw_ts, raw_lvl = entry[0], entry[1]
                    else:
                        continue
                    lvl = _parse_bb_int(raw_lvl)
                    if lvl is None:
                        continue
                    t_ms = _parse_ts_ms(raw_ts) or 0
                    if t_ms >= latest_ts:
                        latest_ts = t_ms
                        latest_val = lvl
                return (latest_ts if latest_val is not None else -1), latest_val

            bb_ep_ok = False
            stress_ep_ok = False
            bb_events_ok = False
            events_data_valid = False

            # Source A: client.get_body_battery(target_date_str)
            bb_ep_ts = -1
            bb_ep_val = None
            try:
                bb_data = client.get_body_battery(target_date_str)
                bb_ep_ok = True
                bb_items = bb_data if isinstance(bb_data, list) else ([bb_data] if isinstance(bb_data, dict) else [])
                for day_bb in bb_items:
                    if not isinstance(day_bb, dict):
                        continue
                    arr_ts, arr_val = _extract_latest_bb_array(day_bb.get('bodyBatteryValuesArray'))
                    if arr_val is not None and arr_ts >= bb_ep_ts:
                        bb_ep_ts = arr_ts
                        bb_ep_val = arr_val
                    recent_val = _parse_bb_int(day_bb.get('bodyBatteryMostRecentValue'))
                    if recent_val is not None and bb_ep_val is None:
                        bb_ep_ts = 0
                        bb_ep_val = recent_val
            except Exception as e:
                print(f"[GarminSync] Warning fetching body battery: {e}")
                last_error = str(e)
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)
            bb_ep_time_iso = _fmt_london_iso(bb_ep_ts) if bb_ep_ts > 0 else None

            # Source B: client.get_stress_data(target_date_str) (returns intraday [ts, status, level, version])
            stress_ep_ts = -1
            stress_ep_val = None
            if not auth_failed:
                try:
                    stress_data = client.get_stress_data(target_date_str)
                    stress_ep_ok = True
                    if isinstance(stress_data, dict):
                        stress_ep_ts, stress_ep_val = _extract_latest_bb_array(stress_data.get('bodyBatteryValuesArray'))
                        if stress_data.get('avgStressLevel') is not None:
                            avg_stress_level = stress_data.get('avgStressLevel')
                        if autonomic_service is not None and isinstance(stress_data.get('stressValuesArray'), list):
                            stress_samples = autonomic_service.normalize_intraday_series(
                                stress_data.get('stressValuesArray'),
                                keep_negative=True,
                            )
                except Exception as e:
                    print(f"[GarminSync] Warning fetching stress/body battery data: {e}")
                    last_error = str(e)
                    if is_auth_error(e):
                        auth_failed = True
                        last_auth_error = str(e)
            stress_ep_time_iso = _fmt_london_iso(stress_ep_ts) if stress_ep_ts > 0 else None

            # Fetch HRV data (weekly avg, status, last night avg)
            if not auth_failed and hasattr(client, 'get_hrv_data'):
                try:
                    hrv_data = client.get_hrv_data(target_date_str)
                    if isinstance(hrv_data, dict):
                        hrv_sum = hrv_data.get('hrvSummary') or {}
                        if isinstance(hrv_sum, dict):
                            if hrv_sum.get('weeklyAvg') is not None:
                                hrv_weekly = hrv_sum.get('weeklyAvg')
                            if hrv_sum.get('status'):
                                hrv_status = hrv_sum.get('status')
                            if hrv_sum.get('lastNightAvg') is not None:
                                hrv_last_night = hrv_sum.get('lastNightAvg')
                            baseline_obj = hrv_sum.get('baseline') or {}
                            if isinstance(baseline_obj, dict):
                                raw_low = baseline_obj.get('balancedLow')
                                if raw_low is None:
                                    raw_low = baseline_obj.get('lowUpper')
                                hrv_baseline_low = _finite_pos_float(raw_low)
                except Exception as e:
                    print(f"[GarminSync] Warning fetching HRV data: {e}")
                    if is_auth_error(e):
                        auth_failed = True
                        last_auth_error = str(e)

            # Fetch intraday Heart Rate series (for +/-60m snapshots & abrupt HR spike detection)
            if not auth_failed and hasattr(client, 'get_heart_rates') and autonomic_service is not None:
                try:
                    hr_data = client.get_heart_rates(target_date_str)
                    if isinstance(hr_data, dict) and isinstance(hr_data.get('heartRateValues'), list):
                        hr_samples = autonomic_service.normalize_intraday_series(
                            hr_data.get('heartRateValues'),
                            min_val=25,
                            max_val=240,
                        )
                except Exception as e:
                    print(f"[GarminSync] Warning fetching intraday heart rates: {e}")
                    if is_auth_error(e):
                        auth_failed = True
                        last_auth_error = str(e)

            # Source C (optional): client.get_body_battery_events(target_date_str)
            bb_events_ts = -1
            bb_events_val = None
            bb_events_impact = None
            if not auth_failed and hasattr(client, 'get_body_battery_events'):
                try:
                    events_data = client.get_body_battery_events(target_date_str)
                    if isinstance(events_data, (list, dict)):
                        events_data_valid = True
                        bb_events_ok = True
                    event_items = events_data if isinstance(events_data, list) else ([events_data] if isinstance(events_data, dict) else [])
                    for ev in event_items:
                        if not isinstance(ev, dict):
                            continue
                        arr_ts, arr_val = _extract_latest_bb_array(ev.get('bodyBatteryValuesArray'))
                        if arr_val is not None and arr_ts >= bb_events_ts:
                            bb_events_ts = arr_ts
                            bb_events_val = arr_val
                        ev_meta = ev.get('event') if isinstance(ev.get('event'), dict) else ev
                        if isinstance(ev_meta, dict) and ev_meta.get('bodyBatteryImpact') is not None:
                            ev_start_ms = _parse_ts_ms(ev_meta.get('startTimestampGmt') or ev_meta.get('eventStartTimeGmt'))
                            ev_dur_ms = int(ev_meta.get('durationInMilliseconds') or 0)
                            ev_end_ms = (ev_start_ms + ev_dur_ms) if ev_start_ms else -1
                            if ev_end_ms >= bb_events_ts:
                                bb_events_impact = ev_meta.get('bodyBatteryImpact')
                except Exception as e:
                    print(f"[GarminSync] Warning fetching body battery events: {e}")
                    if is_auth_error(e):
                        auth_failed = True
                        last_auth_error = str(e)
            bb_events_time_iso = _fmt_london_iso(bb_events_ts) if bb_events_ts > 0 else None

            bb_ok = bb_ep_ok or stress_ep_ok or (bb_events_ok and events_data_valid)

            # Source D: summary Body Battery fields
            summary_dict = summary if isinstance(summary, dict) else {}
            summary_bb = _parse_bb_int(summary_dict.get('bodyBatteryMostRecentValue'))
            summary_last_sync_gmt = summary_dict.get('lastSyncTimestampGMT')
            summary_sync_ts = _parse_ts_ms(summary_last_sync_gmt)

            best_ts = -1
            best_bb_val = None
            best_source = None

            if bb_ep_val is not None and bb_ep_ts >= best_ts:
                best_ts = bb_ep_ts
                best_bb_val = bb_ep_val
                best_source = 'body_battery_endpoint'
            if stress_ep_val is not None and (stress_ep_ts > best_ts or best_bb_val is None):
                best_ts = stress_ep_ts
                best_bb_val = stress_ep_val
                best_source = 'stress_endpoint'
            if bb_events_val is not None and bb_events_ts > best_ts:
                best_ts = bb_events_ts
                best_bb_val = bb_events_val
                best_source = 'body_battery_events'

            now_ms = int(uk_now().timestamp() * 1000)
            chosen_source = best_source
            if summary_bb is not None and (
                best_bb_val is None
                or (summary_sync_ts is not None and summary_sync_ts >= best_ts)
                or (best_ts >= 0 and (now_ms - best_ts) > 10 * 60 * 1000 and summary_bb != best_bb_val)
            ):
                live_body_battery = summary_bb
                chosen_source = 'summary_most_recent'
            else:
                live_body_battery = best_bb_val

            if bb_ok or summary_bb is not None:
                body_battery_debug = {
                    "chosen": live_body_battery,
                    "chosen_source": chosen_source,
                    "summary_most_recent": summary_bb,
                    "summary_high": summary_dict.get('bodyBatteryHighestValue'),
                    "summary_low": summary_dict.get('bodyBatteryLowestValue'),
                    "summary_drained": summary_dict.get('bodyBatteryDrainedValue'),
                    "summary_charged": summary_dict.get('bodyBatteryChargedValue'),
                    "summary_at_wake": summary_dict.get('bodyBatteryAtWakeTime'),
                    "summary_last_sync_gmt": summary_last_sync_gmt,
                    "bb_endpoint_val": bb_ep_val,
                    "bb_endpoint_time": bb_ep_time_iso,
                    "stress_endpoint_val": stress_ep_val,
                    "stress_endpoint_time": stress_ep_time_iso,
                }
                if bb_events_val is not None or bb_events_impact is not None:
                    body_battery_debug["events_val"] = bb_events_val
                    body_battery_debug["events_time"] = bb_events_time_iso
                    body_battery_debug["events_impact"] = bb_events_impact

                print(
                    f"[GarminSync] Body Battery reconciled: chosen={live_body_battery} ({chosen_source}) | "
                    f"summary={summary_bb} (sync={summary_last_sync_gmt}) | "
                    f"bb_ep={bb_ep_val} ({bb_ep_time_iso}) | stress_ep={stress_ep_val} ({stress_ep_time_iso})"
                )

        any_ok = any((summary_ok, activities_ok, sleep_ok, readiness_ok, bb_ok))

        # Total outage or full auth failure: abort cleanly without overwriting today's metrics or advancing _last_sync_ts
        if not any_ok:
            if auth_failed:
                with self._client_lock:
                    self.client = None
                    self._auth_cooldown_until = time.time() + 1800
                self._set_oauth_failed_at(uk_now().isoformat())
            return {
                "success": False,
                "requires_auth": auth_failed,
                "error": last_auth_error or last_error or "Garmin upstream endpoints failed",
            }

        # Snapshot existing activities outside the lock so Garmin HTTP detail calls never hold the file lock
        snapshot_state = state_store.load_live_state(LIVE_STATE_PATH)
        snapshot_activities = snapshot_state.get('garmin', {}).get('recent_activities', [])
        snapshot_map = {str(a.get('id')): a for a in snapshot_activities}
        live_weight_kg = _finite_pos_float(
            (snapshot_state.get('athlete') or {}).get('weight_kg')
            or (snapshot_state.get('renpho') or {}).get('weight_kg')
        )

        watch_active_by_id = {}
        today_activity_list = []
        detail_auth_failed = False

        if activities_ok:
            for idx, ra in enumerate(raw_activities):
                if not isinstance(ra, dict):
                    continue
                act_id = str(ra.get('activityId') or '')
                if not act_id:
                    continue
                act_type = ra.get('activityType') or {}
                activity_type_key = act_type.get('typeKey') or 'cardio'
                total_sets = ra.get('totalSets')
                total_reps = ra.get('totalReps')
                act_name = str(act_type.get('typeKey') or 'Cardio').capitalize()
                raw_sub_title = ra.get('activityName') or act_name
                sub_title = raw_sub_title

                raw_cals = float(ra.get('calories') or 0)
                ra_bmr = max(0.0, float(ra.get('bmrCalories') or 0))
                calories = round(raw_cals)
                watch_active_by_id[act_id] = max(0, round(raw_cals - ra_bmr))

                duration_min = round(float(ra.get('duration') or 0) / 60.0, 1)
                avg_hr = round(float(ra.get('averageHR') or 0))
                max_hr = round(float(ra.get('maxHR') or 0))
                aerobic_te = float(ra.get('aerobicTrainingEffect') or 0.0)
                anaerobic_te = float(ra.get('anaerobicTrainingEffect') or 0.0)
                start_time = ra.get('startTimeLocal') or ''

                existing = snapshot_map.get(act_id)
                custom_note = (existing.get('user_notes') if existing else None)
                if not custom_note and db is not None:
                    try:
                        custom_note = db.get_kv(f"activity_note_{act_id}")
                    except Exception:
                        custom_note = None
                if custom_note:
                    sub_title = custom_note

                if existing and existing.get('benefits') and (not custom_note or custom_note == existing.get('sub_title')):
                    benefits = existing['benefits']
                    if existing.get('sub_title'):
                        sub_title = existing['sub_title']
                else:
                    benefits = self.benefits_engine.generate_benefits(
                        act_name,
                        sub_title,
                        duration_min,
                        calories,
                        avg_hr,
                        max_hr,
                        aerobic_te,
                        anaerobic_te,
                        weight_kg=live_weight_kg,
                    )

                hr_samples = existing.get('hr_samples') if existing else None
                hr_zones = existing.get('hr_zones') if existing else None
                exercise_sets = existing.get('exercise_sets') if existing else None

                if idx < 3 and not hr_samples and not detail_auth_failed:
                    try:
                        details = client.get_activity_details(act_id, maxchart=60)
                        extracted_samples = []
                        if isinstance(details, dict):
                            descriptors = details.get('metricDescriptors', [])
                            metrics_list = details.get('activityDetailMetrics', [])
                            hr_idx = None
                            for d in descriptors:
                                if d.get('key') in ('directHeartRate', 'heartRate'):
                                    hr_idx = d.get('metricsIndex')
                                    break
                            if hr_idx is not None and metrics_list:
                                for row in metrics_list:
                                    vals = row.get('metrics', [])
                                    if isinstance(vals, list) and len(vals) > hr_idx:
                                        v = vals[hr_idx]
                                        if v is not None:
                                            try:
                                                extracted_samples.append(int(round(float(v))))
                                            except (ValueError, TypeError):
                                                pass
                        if extracted_samples:
                            hr_samples = extracted_samples
                    except Exception as e:
                        print(f"[GarminSync] Warning fetching activity details for {act_id}: {e}")
                        if is_auth_error(e):
                            detail_auth_failed = True
                            auth_failed = True
                            last_auth_error = str(e)

                if idx < 3 and not hr_zones and not detail_auth_failed:
                    try:
                        raw_zones = client.get_activity_hr_in_timezones(act_id)
                        extracted_zones = {}
                        if isinstance(raw_zones, list):
                            for item in raw_zones:
                                if isinstance(item, dict):
                                    z_num = item.get('zoneNumber') or item.get('zone')
                                    secs = item.get('secsInZone') or item.get('seconds') or item.get('timeInZone') or 0
                                    if z_num is not None:
                                        try:
                                            extracted_zones[f"z{int(z_num)}"] = int(round(float(secs)))
                                        except (ValueError, TypeError):
                                            pass
                        if extracted_zones:
                            hr_zones = extracted_zones
                    except Exception as e:
                        print(f"[GarminSync] Warning fetching activity HR zones for {act_id}: {e}")
                        if is_auth_error(e):
                            detail_auth_failed = True
                            auth_failed = True
                            last_auth_error = str(e)

                if 'strength' in str(act_name).lower() and idx < 3 and not exercise_sets and not detail_auth_failed:
                    try:
                        raw_sets = client.get_activity_exercise_sets(act_id)
                        compact_sets = []
                        sets_list = raw_sets.get('exerciseSets', []) if isinstance(raw_sets, dict) else (raw_sets if isinstance(raw_sets, list) else [])
                        for s in sets_list:
                            if isinstance(s, dict):
                                compact_sets.append({
                                    "set_type": s.get('setType'),
                                    "reps": s.get('reps'),
                                    "weight": s.get('weight'),
                                    "exercise_name": s.get('exerciseName') or s.get('category'),
                                    "duration": s.get('duration')
                                })
                        if compact_sets:
                            exercise_sets = compact_sets
                        elif isinstance(raw_sets, (list, dict)) and raw_sets:
                            exercise_sets = raw_sets
                    except Exception as e:
                        print(f"[GarminSync] Warning fetching exercise sets for {act_id}: {e}")
                        if is_auth_error(e):
                            detail_auth_failed = True
                            auth_failed = True
                            last_auth_error = str(e)

                act_steps_raw = ra.get('steps')
                act_steps = int(round(float(act_steps_raw))) if act_steps_raw is not None and float(act_steps_raw or 0) > 0 else (existing.get('steps') if existing else None)
                act_dist_m = float(ra.get('distance', 0) or 0)
                act_dist_miles = round(act_dist_m / 1609.344, 2) if act_dist_m > 0 else (existing.get('distance_miles') if existing else None)

                entry = {
                    "id": int(act_id),
                    "name": act_name,
                    "sub_title": sub_title,
                    "date": start_time,
                    "duration_min": duration_min,
                    "calories": calories,
                    "avg_hr": avg_hr,
                    "max_hr": max_hr,
                    "aerobic_te": aerobic_te,
                    "anaerobic_te": anaerobic_te,
                    "benefits": benefits,
                    "activity_type_key": activity_type_key,
                    "total_sets": total_sets,
                    "total_reps": total_reps,
                    "steps": act_steps,
                    "distance_miles": act_dist_miles,
                    "source": "garmin_oauth",
                }
                if ra_bmr > 0:
                    entry["bmr_calories"] = round(ra_bmr)
                if custom_note:
                    entry["user_notes"] = custom_note
                if hr_samples:
                    entry["hr_samples"] = hr_samples
                if hr_zones:
                    entry["hr_zones"] = hr_zones
                if exercise_sets:
                    entry["exercise_sets"] = exercise_sets

                today_activity_list.append(entry)

        # Acquire state lock ONLY for the fast in-memory merge + atomic save
        with state_store.state_lock(LIVE_STATE_PATH):
            state = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)

            prev_date = state.get('date')
            now_london_iso = uk_now().isoformat()
            state['last_synced'] = now_london_iso
            state['date'] = target_date_str

            garmin_state = state.setdefault('garmin', {})
            prev_garmin_date = garmin_state.get('metrics_date') or garmin_state.get('oauth_date') or prev_date

            # Capture any same-day manual_app_entry workouts before rollover cleanup
            existing_today_raw = [
                a for a in (garmin_state.get('today_activities') or [])
                if isinstance(a, dict) and str(a.get('date', '')).startswith(target_date_str)
            ]
            pre_manual_candidates = [
                a for a in existing_today_raw if a.get('source') == 'manual_app_entry'
            ]
            prev_manual_burn = sum(int(round(float(a.get('calories') or 0))) for a in pre_manual_candidates)
            prev_watch_summary_active = max(
                0,
                int(round(float(garmin_state.get('active_calories') or 0))) - prev_manual_burn,
            )

            # Clear stale prior-day daily metrics on day rollover so yesterday's values never leak into today
            if prev_garmin_date and prev_garmin_date != target_date_str:
                prev_watch_summary_active = 0
                if db is not None:
                    try:
                        if any(
                            garmin_state.get(k) is not None
                            for k in ('sleep_score', 'resting_hr', 'body_battery', 'training_readiness')
                        ):
                            db.upsert_daily_biometrics(
                                prev_garmin_date,
                                sleep_score=garmin_state.get('sleep_score'),
                                resting_hr=garmin_state.get('resting_hr'),
                                body_battery=garmin_state.get('body_battery'),
                                training_readiness=garmin_state.get('training_readiness'),
                                source='garmin_rollover',
                            )
                    except Exception as dbe:
                        print(f"[GarminSync] Warning saving rollover biometrics: {dbe}")
                for stale_key in (
                    'sleep_score', 'sleep_duration', 'sleep_score_source',
                    'body_battery', 'training_readiness', 'readiness_level',
                    'readiness_feedback', 'today_activities', 'active_calories',
                    'workout_calories', 'steps', 'stress_avg', 'hrv_last_night',
                    'distance_miles', 'active_minutes', 'resting_hr', 'body_battery_debug',
                    'mnd_logged', 'mnd_meals',
                ):
                    garmin_state.pop(stale_key, None)
                state.pop('mnd_logged', None)
                state.pop('mnd_meals', None)
                state.pop('mnd_cloud_logged', None)
                state.pop('mnd_cloud_meals', None)
                state.pop('app_deleted_meals', None)

            garmin_state['source'] = 'garmin_oauth'
            garmin_state['garmin_sync_mode'] = 'oauth'
            garmin_state['oauth_date'] = target_date_str
            garmin_state['metrics_date'] = target_date_str
            garmin_state['last_synced'] = now_london_iso
            garmin_state['oauth_last_synced'] = now_london_iso
            if auth_failed:
                with self._client_lock:
                    self.client = None
                    self._auth_cooldown_until = time.time() + 1800
                garmin_state['oauth_failed_at'] = now_london_iso
            else:
                garmin_state['oauth_failed_at'] = None

            if summary_ok:
                if summary.get('totalSteps') is not None:
                    garmin_state['steps'] = int(summary.get('totalSteps'))
                elif isinstance(summary, dict) and summary:
                    garmin_state['steps'] = 0
                if (
                    summary.get('restingHeartRate') is not None
                    and garmin_state.get('resting_hr_manual_date') != target_date_str
                ):
                    garmin_state['resting_hr'] = summary.get('restingHeartRate')

            if garmin_state.get('body_battery_manual_date') != target_date_str:
                if bb_ok:
                    if live_body_battery is not None:
                        garmin_state['body_battery'] = live_body_battery
                    elif summary_ok and summary.get('bodyBatteryMostRecentValue') is not None:
                        garmin_state['body_battery'] = summary.get('bodyBatteryMostRecentValue')
                    if body_battery_debug is not None:
                        garmin_state['body_battery_debug'] = body_battery_debug
                elif summary_ok and summary.get('bodyBatteryMostRecentValue') is not None:
                    garmin_state['body_battery'] = summary.get('bodyBatteryMostRecentValue')

            if sleep_ok and garmin_state.get('sleep_score_manual_date') != target_date_str:
                if sleep_score is not None:
                    garmin_state['sleep_score'] = sleep_score
                    garmin_state['sleep_score_source'] = 'garmin_oauth'
                elif garmin_state.get('sleep_score_source') == 'mnd_estimated':
                    garmin_state.pop('sleep_score', None)
                    garmin_state.pop('sleep_duration', None)
                    garmin_state.pop('sleep_score_source', None)
                    if (
                        (not readiness_ok or readiness_score is None)
                        and garmin_state.get('readiness_manual_date') != target_date_str
                        and garmin_state.get('readiness_feedback') in ('WELL_RECOVERED', 'MODERATE_LOAD')
                    ):
                        garmin_state.pop('training_readiness', None)
                        garmin_state.pop('readiness_level', None)
                        garmin_state.pop('readiness_feedback', None)
                if sleep_duration is not None:
                    garmin_state['sleep_duration'] = sleep_duration

            if readiness_ok:
                if readiness_score is not None and garmin_state.get('readiness_manual_date') != target_date_str:
                    garmin_state['training_readiness'] = readiness_score
                if readiness_level and garmin_state.get('readiness_manual_date') != target_date_str:
                    garmin_state['readiness_level'] = readiness_level
                if readiness_feedback and garmin_state.get('readiness_manual_date') != target_date_str:
                    garmin_state['readiness_feedback'] = readiness_feedback
                if hrv_weekly is not None:
                    garmin_state['hrv_weekly_avg'] = hrv_weekly

            if bb_ok:
                if hrv_weekly is not None and garmin_state.get('hrv_weekly_avg') is None:
                    garmin_state['hrv_weekly_avg'] = hrv_weekly
                if hrv_status is not None:
                    garmin_state['hrv_status'] = hrv_status
                if hrv_last_night is not None:
                    garmin_state['hrv_last_night'] = hrv_last_night
                if hrv_baseline_low is not None:
                    garmin_state['hrv_baseline_low'] = hrv_baseline_low
                if avg_stress_level is not None:
                    garmin_state['stress_avg'] = avg_stress_level

            if sleep_avg_stress is not None:
                garmin_state['sleep_avg_stress'] = round(float(sleep_avg_stress), 1)
            if sleep_start_ts is not None:
                garmin_state['sleep_start_ts'] = sleep_start_ts
            if sleep_end_ts is not None:
                garmin_state['sleep_end_ts'] = sleep_end_ts

            existing_activities = garmin_state.get('recent_activities', [])
            existing_map = {str(a.get('id')): a for a in existing_activities if isinstance(a, dict)}

            if activities_ok:
                # Re-apply any user_notes added concurrently while Garmin HTTP calls were in flight
                for entry in today_activity_list:
                    latest_existing = existing_map.get(str(entry['id']))
                    if latest_existing and latest_existing.get('user_notes') and not entry.get('user_notes'):
                        entry['user_notes'] = latest_existing['user_notes']
                        entry['sub_title'] = latest_existing['user_notes']

                retained_manuals = [
                    m for m in pre_manual_candidates
                    if not _is_manual_watch_duplicate(m, today_activity_list)
                ]
                dropped_manual_ids = {
                    str(m.get('id')) for m in pre_manual_candidates
                    if m not in retained_manuals and m.get('id') is not None
                }
                merged_today = list(today_activity_list) + retained_manuals
                merged_today.sort(key=lambda x: str(x.get('date', '')), reverse=True)
                garmin_state['today_activities'] = merged_today
            else:
                merged_today = [
                    a for a in (garmin_state.get('today_activities') or [])
                    if isinstance(a, dict) and str(a.get('date', '')).startswith(target_date_str)
                ]
                for m in pre_manual_candidates:
                    if str(m.get('id')) not in {str(x.get('id')) for x in merged_today}:
                        merged_today.append(m)
                garmin_state['today_activities'] = merged_today
                dropped_manual_ids = set()

            watch_entries_today = [a for a in merged_today if a.get('source') != 'manual_app_entry']
            manual_entries_today = [a for a in merged_today if a.get('source') == 'manual_app_entry']
            manual_today_burn = sum(int(round(float(a.get('calories') or 0))) for a in manual_entries_today)

            if activities_ok:
                watch_today_burn = sum(
                    watch_active_by_id.get(str(a.get('id')), max(0, int(round(float(a.get('calories') or 0) - float(a.get('bmr_calories') or 0)))))
                    for a in watch_entries_today
                )
            else:
                watch_today_burn = sum(
                    max(0, int(round(float(a.get('calories') or 0) - float(a.get('bmr_calories') or 0))))
                    for a in watch_entries_today
                )

            garmin_state['workout_calories'] = watch_today_burn + manual_today_burn

            if summary_ok:
                raw_summary_active = summary.get('activeKilocalories')
                if raw_summary_active is not None:
                    summary_bmr = max(0.0, float(summary.get('bmrCalories') or 0))
                    summary_active = max(0, int(round(float(raw_summary_active) - summary_bmr)))
                else:
                    summary_active = 0
                garmin_state['active_calories'] = max(summary_active, watch_today_burn) + manual_today_burn
            else:
                garmin_state['active_calories'] = max(prev_watch_summary_active, watch_today_burn) + manual_today_burn

            if summary_ok:
                if summary.get('distanceInMeters') is not None:
                    garmin_state['distance_miles'] = round(float(summary.get('distanceInMeters')) / 1609.344, 2)
                elif summary.get('totalDistanceMeters') is not None:
                    garmin_state['distance_miles'] = round(float(summary.get('totalDistanceMeters')) / 1609.344, 2)
                else:
                    garmin_state['distance_miles'] = round(sum(float(a.get('distance_miles') or 0) for a in merged_today), 2)

                if summary.get('moderateIntensityMinutes') is not None or summary.get('vigorousIntensityMinutes') is not None:
                    mod_m = float(summary.get('moderateIntensityMinutes') or 0)
                    vig_m = float(summary.get('vigorousIntensityMinutes') or 0)
                    garmin_state['active_minutes'] = int(round(mod_m + vig_m))
                elif activities_ok and not merged_today:
                    garmin_state['active_minutes'] = 0
            elif activities_ok and merged_today and garmin_state.get('distance_miles') is None:
                garmin_state['distance_miles'] = round(sum(float(a.get('distance_miles') or 0) for a in merged_today), 2)

            if activities_ok:
                # Ensure recent_activities includes today + 5-day fetch + preserved older real Garmin / manual activities
                today_ids = {str(a['id']) for a in merged_today}
                all_activities = list(merged_today)
                seen_ids = set(today_ids)

                for ra in recent_raw_activities:
                    if not isinstance(ra, dict):
                        continue
                    r_id = str(ra.get('activityId') or '')
                    r_start = str(ra.get('startTimeLocal') or '')
                    if not r_id or r_id in seen_ids or r_start.startswith(target_date_str):
                        continue
                    existing = existing_map.get(r_id)
                    if existing:
                        all_activities.append(existing)
                    else:
                        r_type = ra.get('activityType') or {}
                        r_type_key = r_type.get('typeKey') or 'cardio'
                        r_name = str(r_type_key).capitalize()
                        r_sub = ra.get('activityName') or r_name
                        r_cals = round(float(ra.get('calories') or 0))
                        r_dur = round(float(ra.get('duration') or 0) / 60.0, 1)
                        r_avg_hr = round(float(ra.get('averageHR') or 0))
                        r_max_hr = round(float(ra.get('maxHR') or 0))
                        r_aero = float(ra.get('aerobicTrainingEffect') or 0.0)
                        r_anaero = float(ra.get('anaerobicTrainingEffect') or 0.0)
                        r_steps_raw = ra.get('steps')
                        r_steps = int(round(float(r_steps_raw))) if r_steps_raw is not None and float(r_steps_raw or 0) > 0 else None
                        r_dist_m = float(ra.get('distance') or 0)
                        r_dist_miles = round(r_dist_m / 1609.344, 2) if r_dist_m > 0 else None
                        r_entry = {
                            "id": int(r_id),
                            "name": r_name,
                            "sub_title": r_sub,
                            "date": r_start,
                            "duration_min": r_dur,
                            "calories": r_cals,
                            "avg_hr": r_avg_hr,
                            "max_hr": r_max_hr,
                            "aerobic_te": r_aero,
                            "anaerobic_te": r_anaero,
                            "benefits": self.benefits_engine.generate_benefits(
                                r_name,
                                r_sub,
                                r_dur,
                                r_cals,
                                r_avg_hr,
                                r_max_hr,
                                r_aero,
                                r_anaero,
                                weight_kg=live_weight_kg,
                            ),
                            "activity_type_key": r_type_key,
                            "total_sets": ra.get('totalSets'),
                            "total_reps": ra.get('totalReps'),
                            "steps": r_steps,
                            "distance_miles": r_dist_miles,
                            "source": "garmin_oauth",
                        }
                        all_activities.append(r_entry)
                    seen_ids.add(r_id)

                for old in existing_activities:
                    if not isinstance(old, dict):
                        continue
                    old_id = str(old.get('id', ''))
                    if old_id in seen_ids or old_id in dropped_manual_ids:
                        continue
                    if old.get('source') == 'garmin_via_mnd_bridge' or old_id.startswith(('990', '9920')):
                        continue
                    all_activities.append(old)
                    seen_ids.add(old_id)
                all_activities.sort(key=lambda x: str(x.get('date', '')), reverse=True)
                garmin_state['recent_activities'] = all_activities[:100]
            else:
                if isinstance(garmin_state.get('recent_activities'), list):
                    garmin_state['recent_activities'] = garmin_state['recent_activities'][:100]

            analytics_service.recalculate_nutrition(state, target_date_str)

            if db is not None:
                try:
                    db.upsert_daily_biometrics(
                        target_date_str,
                        sleep_score=garmin_state.get('sleep_score'),
                        resting_hr=garmin_state.get('resting_hr'),
                        body_battery=garmin_state.get('body_battery'),
                        training_readiness=garmin_state.get('training_readiness'),
                        source='garmin_oauth',
                        overwrite_nulls=True,
                        hrv_last_night=garmin_state.get('hrv_last_night'),
                        hrv_weekly_avg=garmin_state.get('hrv_weekly_avg'),
                        hrv_status=garmin_state.get('hrv_status'),
                        hrv_baseline_low=hrv_baseline_low,
                        avg_stress=garmin_state.get('stress_avg'),
                        sleep_avg_stress=sleep_avg_stress,
                        sleep_start_ts=sleep_start_ts,
                        sleep_end_ts=sleep_end_ts,
                        deep_sleep_sec=deep_sleep_sec,
                        rem_sleep_sec=rem_sleep_sec,
                        light_sleep_sec=light_sleep_sec,
                        awake_sleep_sec=awake_sleep_sec,
                    )
                    if stress_samples is not None or hr_samples is not None or sleep_stress_samples is not None:
                        db.upsert_garmin_intraday(
                            target_date_str,
                            stress_samples=stress_samples,
                            hr_samples=hr_samples,
                            sleep_stress_samples=sleep_stress_samples,
                        )
                except Exception as dbe:
                    print(f"[GarminSync] Failed saving daily_biometrics: {dbe}")

            state_store.save_live_state(state, LIVE_STATE_PATH)

        # Outside state_lock: backfill yesterday intraday if incomplete episode spans yesterday/midnight, then update snapshots
        if autonomic_service is not None and db is not None and not auth_failed:
            try:
                yest_str = (datetime.strptime(target_date_str, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
                eps = db.get_paroxysmal_episodes(days=7)
                needs_yest = any(
                    ep.get('biometric_snapshot_status') != 'complete'
                    and str(ep.get('date_str') or '') in (yest_str, target_date_str)
                    for ep in eps
                )
                if needs_yest:
                    existing_yest = db.get_garmin_intraday(yest_str)
                    stale_yest = existing_yest is None
                    if existing_yest and existing_yest.get('synced_at'):
                        y_dt = time_utils.parse_uk_ts(existing_yest['synced_at'])
                        if y_dt and (uk_now() - y_dt).total_seconds() > 1800:
                            stale_yest = True
                    if stale_yest:
                        y_stress, y_hr = None, None
                        try:
                            ys_raw = client.get_stress_data(yest_str)
                            if isinstance(ys_raw, dict) and isinstance(ys_raw.get('stressValuesArray'), list):
                                y_stress = autonomic_service.normalize_intraday_series(ys_raw.get('stressValuesArray'), keep_negative=True)
                        except Exception:
                            pass
                        if hasattr(client, 'get_heart_rates'):
                            try:
                                yh_raw = client.get_heart_rates(yest_str)
                                if isinstance(yh_raw, dict) and isinstance(yh_raw.get('heartRateValues'), list):
                                    y_hr = autonomic_service.normalize_intraday_series(yh_raw.get('heartRateValues'), min_val=25, max_val=240)
                            except Exception:
                                pass
                        if y_stress is not None or y_hr is not None:
                            db.upsert_garmin_intraday(yest_str, stress_samples=y_stress, hr_samples=y_hr)
                autonomic_service.backfill_episode_snapshots(state)
            except Exception as back_exc:
                print(f"[GarminSync] Episode snapshot backfill notice: {back_exc}")

        self._persist_tokens(client)
        return state
