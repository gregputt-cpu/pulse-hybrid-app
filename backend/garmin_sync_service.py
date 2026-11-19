import os
import json
import time
import threading
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from benefits_engine import PhysiologicalBenefitsEngine
try:
    import db
except Exception:
    db = None
import state_store

_DATA_DIR = state_store.get_data_dir()
if 'GARMIN_TOKEN_DIR' in os.environ:
    TOKEN_DIR = os.environ['GARMIN_TOKEN_DIR']
elif _DATA_DIR:
    TOKEN_DIR = os.path.join(_DATA_DIR, 'garmin_tokens')
else:
    TOKEN_DIR = '/shared/user/.gemini/garmin_tokens'

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

if 'GARMIN_TOKENS_JSON' in os.environ:
    raw_env = os.environ['GARMIN_TOKENS_JSON'].strip()
    if (raw_env.startswith('"') and raw_env.endswith('"')) or (raw_env.startswith("'") and raw_env.endswith("'")):
        raw_env = raw_env[1:-1].strip()
    os.environ['GARMIN_TOKENS_JSON'] = raw_env

LIVE_STATE_PATH = state_store.get_live_state_path()
ARTIFACT_LIVE_STATE_PATH = os.environ.get('ARTIFACT_LIVE_STATE_PATH', LIVE_STATE_PATH)

class GarminSyncService:
    def __init__(self):
        self.benefits_engine = PhysiologicalBenefitsEngine()
        self._sync_lock = threading.Lock()
        self._last_sync_ts = 0.0
        self._cooldown_until = 0.0
        self._backoff_sec = 60
        self.client = None
        self.pending_login_state = None

    def _persist_tokens(self, client):
        if not client:
            return
        try:
            os.makedirs(TOKEN_DIR, exist_ok=True)
            client.client.dump(TOKEN_DIR)
        except Exception as e:
            print(f"[GarminSync] Warning dumping tokens to {TOKEN_DIR}: {e}")
        dumped = None
        try:
            dumped = client.client.dumps()
        except Exception as e:
            print(f"[GarminSync] Warning serializing tokens: {e}")
        if dumped:
            try:
                os.makedirs(TOKEN_DIR, exist_ok=True)
                with open(os.path.join(TOKEN_DIR, 'garmin_tokens_dump.json'), 'w', encoding='utf-8') as f:
                    f.write(dumped)
            except Exception as e:
                print(f"[GarminSync] Warning writing garmin_tokens_dump.json: {e}")
            if os.path.exists('/shared/user/.gemini'):
                try:
                    backup_dir = '/shared/user/.gemini/pulse_backend'
                    os.makedirs(backup_dir, exist_ok=True)
                    with open(os.path.join(backup_dir, 'garmin_tokens.json'), 'w', encoding='utf-8') as f:
                        f.write(dumped)
                except Exception as e:
                    print(f"[GarminSync] Warning writing shared backup tokens: {e}")
        if db is not None and dumped:
            try:
                db.set_kv('garmin_tokens_json', dumped)
            except Exception as e:
                print(f"[GarminSync] Warning persisting tokens to DB: {e}")

    def _try_load_token_str(self, client, raw_tok):
        if not raw_tok:
            return False
        tok = raw_tok.strip()
        if (tok.startswith('"') and tok.endswith('"')) or (tok.startswith("'") and tok.endswith("'")):
            tok = tok[1:-1].strip()
        try:
            client.login(tokenstore=tok)
            return True
        except Exception:
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
            self.client = client
            self._persist_tokens(client)
            return True
        return False

    def get_client(self):
        if not self.client:
            self.client = Garmin()
            loaded = False
            # 1. Try SQLite persistent token store first (survives Railway restarts & stores refreshed OAuth2)
            if db is not None:
                try:
                    db_tok = db.get_kv('garmin_tokens_json')
                    if db_tok and self._try_load_token_str(self.client, db_tok):
                        loaded = True
                except Exception as e:
                    print(f"[GarminSync] DB token load notice: {e}")

            # 2. Try dumped JSON token files (dumps()/loads() is more reliable across reloads than garth dir)
            if not loaded:
                for dump_path in (
                    os.path.join(TOKEN_DIR, 'garmin_tokens_dump.json'),
                    '/shared/user/.gemini/pulse_backend/garmin_tokens.json',
                ):
                    if os.path.exists(dump_path):
                        try:
                            with open(dump_path, 'r', encoding='utf-8') as f:
                                raw_dump = f.read().strip()
                            if raw_dump and self._try_load_token_str(self.client, raw_dump):
                                loaded = True
                                break
                        except Exception as e:
                            print(f"[GarminSync] Token dump load notice ({dump_path}): {e}")

            # 3. Try persistent TOKEN_DIR
            if not loaded:
                try:
                    self.client.login(tokenstore=TOKEN_DIR)
                    loaded = True
                except Exception as e:
                    print(f"[GarminSync] Login from tokenstore ({TOKEN_DIR}) error: {e}")

            # 4. Fall back to GARMIN_TOKENS_JSON env var
            if not loaded and 'GARMIN_TOKENS_JSON' in os.environ:
                if self._try_load_token_str(self.client, os.environ['GARMIN_TOKENS_JSON']):
                    loaded = True

            if not loaded:
                self.client = None
                raise GarminConnectAuthenticationError("No valid Garmin token found in DB, tokenstore, or GARMIN_TOKENS_JSON")

            try:
                self.client.display_name = self.client.client.profile.get('displayName')
            except Exception:
                pass
        return self.client

    def export_tokens_json(self):
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
                if 'GARMIN_TOKENS_JSON' in os.environ and self._try_load_token_str(temp_client, os.environ['GARMIN_TOKENS_JSON']):
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
                self.pending_login_state = (client, res[1])
                return {"needs_mfa": True, "message": "2FA code required"}
            self._persist_tokens(client)
            self.client = client
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def submit_mfa(self, mfa_code):
        if not self.pending_login_state:
            return {"success": False, "error": "No pending MFA login session"}
        try:
            client, client_state = self.pending_login_state
            client.resume_login(client_state, mfa_code.strip())
            self._persist_tokens(client)
            self.client = client
            self.pending_login_state = None
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def sync_today(self, target_date_str=None, force=False):
        now_ts = time.time()
        if now_ts < self._cooldown_until:
            wait_s = int(self._cooldown_until - now_ts)
            print(f"[GarminSync] Rate-limit cooldown active ({wait_s}s remaining); serving cached state.")
            return state_store.load_live_state(LIVE_STATE_PATH)
        if not force and (now_ts - self._last_sync_ts) < 180:
            return state_store.load_live_state(LIVE_STATE_PATH)

        if not self._sync_lock.acquire(blocking=False):
            print("[GarminSync] Sync already in flight; serving cached state.")
            return state_store.load_live_state(LIVE_STATE_PATH)
        try:
            state = self._sync_today_impl(target_date_str=target_date_str)
            self._last_sync_ts = time.time()
            self._backoff_sec = 60
            self._cooldown_until = 0.0
            return state
        except GarminConnectTooManyRequestsError as rl_err:
            self._backoff_sec = min(3600, max(60, self._backoff_sec * 2))
            self._cooldown_until = time.time() + self._backoff_sec
            print(f"[GarminSync] 429 Too Many Requests ({rl_err}); backing off for {self._backoff_sec}s.")
            return state_store.load_live_state(LIVE_STATE_PATH)
        finally:
            self._sync_lock.release()

    def _sync_today_impl(self, target_date_str=None):
        if not target_date_str:
            target_date_str = datetime.now(ZoneInfo("Europe/London")).date().isoformat()

        client = self.get_client()

        summary = None
        raw_activities = None
        sleep_score = None
        sleep_duration = None
        readiness_score = None
        readiness_level = None
        readiness_feedback = None
        hrv_weekly = None
        hrv_status = None
        hrv_last_night = None
        avg_stress_level = None
        live_body_battery = None
        auth_failed = False
        last_auth_error = None

        AUTH_ERROR_TERMS = ["401", "Unauthorized", "invalid_grant", "OAuth2Token"]

        def is_auth_error(exc):
            if isinstance(exc, GarminConnectTooManyRequestsError):
                raise exc
            err_str = str(exc)
            if "429" in err_str or "too many requests" in err_str.lower():
                raise GarminConnectTooManyRequestsError(err_str)
            return any(term in err_str for term in AUTH_ERROR_TERMS)

        # 1. Fetch user summary
        try:
            summary = client.get_user_summary(target_date_str)
        except Exception as e:
            print(f"[GarminSync] Warning fetching summary: {e}")
            if is_auth_error(e):
                auth_failed = True
                last_auth_error = str(e)
            summary = {}

        # 2. Fetch today's & recent activities (last 5 days so recent_activities stays fresh while today_activities only has target_date_str)
        recent_raw_activities = []
        if not auth_failed:
            try:
                from datetime import timedelta
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
            except Exception as e:
                print(f"[GarminSync] Warning fetching activities: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)
                raw_activities = []
                recent_raw_activities = []
        else:
            raw_activities = []

        # 3. Fetch sleep data
        if not auth_failed:
            try:
                sleep = client.get_sleep_data(target_date_str)
                dto = (sleep or {}).get('dailySleepDTO') or {}
                scores = dto.get('sleepScores') or {}
                sleep_score = (scores.get('overall') or {}).get('value')
                sec = int(dto.get('sleepTimeSeconds') or 0)
                if sec > 0:
                    hours = sec // 3600
                    mins = (sec % 3600) // 60
                    sleep_duration = f"{hours}h {mins}m"
            except Exception as e:
                print(f"[GarminSync] Warning fetching sleep: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # 4. Fetch live training readiness (falls back to morning readiness if intraday list is empty)
        if not auth_failed:
            try:
                readiness = None
                try:
                    tr_list = client.get_training_readiness(target_date_str)
                    if isinstance(tr_list, list) and len(tr_list) > 0:
                        valid_tr = [r for r in tr_list if isinstance(r, dict) and r.get('score') is not None]
                        if valid_tr:
                            readiness = max(valid_tr, key=lambda r: str(r.get('timestamp') or r.get('timestampLocal') or ''))
                    elif isinstance(tr_list, dict) and tr_list.get('score') is not None:
                        readiness = tr_list
                except Exception as tr_e:
                    if is_auth_error(tr_e):
                        raise tr_e
                    readiness = None

                if not readiness:
                    readiness = client.get_morning_training_readiness(target_date_str)

                if isinstance(readiness, dict):
                    readiness_score = readiness.get('score')
                    readiness_level = readiness.get('level')
                    readiness_feedback = readiness.get('feedbackShort')
                    hrv_weekly = readiness.get('hrvWeeklyAverage')
            except Exception as e:
                print(f"[GarminSync] Warning fetching readiness: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # 5. Fetch live Body Battery timeline across all Garmin endpoints and reconcile with summary
        body_battery_debug = None
        if not auth_failed:
            london_tz = ZoneInfo("Europe/London")

            def _parse_bb_int(level_val):
                if level_val is None:
                    return None
                try:
                    lvl = int(round(float(level_val)))
                    return lvl if 0 <= lvl <= 100 else None
                except (ValueError, TypeError):
                    return None

            def _parse_ts_ms(ts_val):
                if ts_val is None:
                    return None
                if isinstance(ts_val, (int, float)):
                    if ts_val <= 0:
                        return None
                    return int(ts_val) if ts_val > 1e12 else int(ts_val * 1000)
                if isinstance(ts_val, str):
                    s = ts_val.strip()
                    if not s:
                        return None
                    try:
                        if s.endswith('Z'):
                            s = s[:-1] + '+00:00'
                        dt = datetime.fromisoformat(s)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        return int(dt.timestamp() * 1000)
                    except ValueError:
                        return None
                return None

            def _fmt_london_iso(ts_ms):
                if not ts_ms or ts_ms <= 0:
                    return None
                try:
                    return datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).astimezone(london_tz).isoformat()
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

            # Source A: client.get_body_battery(target_date_str)
            bb_ep_ts = -1
            bb_ep_val = None
            try:
                bb_data = client.get_body_battery(target_date_str)
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
                    if isinstance(stress_data, dict):
                        stress_ep_ts, stress_ep_val = _extract_latest_bb_array(stress_data.get('bodyBatteryValuesArray'))
                        if stress_data.get('avgStressLevel') is not None:
                            avg_stress_level = stress_data.get('avgStressLevel')
                except Exception as e:
                    print(f"[GarminSync] Warning fetching stress/body battery data: {e}")
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
                except Exception as e:
                    print(f"[GarminSync] Warning fetching HRV data: {e}")
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
            bb_events_time_iso = _fmt_london_iso(bb_events_ts) if bb_events_ts > 0 else None

            # Source D: summary Body Battery fields
            summary_dict = summary if isinstance(summary, dict) else {}
            summary_bb = _parse_bb_int(summary_dict.get('bodyBatteryMostRecentValue'))
            summary_last_sync_gmt = summary_dict.get('lastSyncTimestampGMT')
            summary_sync_ts = _parse_ts_ms(summary_last_sync_gmt)

            # Reconcile timeline sources first (pick newest timestamp)
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

            # Reconcile against Garmin's authoritative summary.bodyBatteryMostRecentValue
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
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

        # Persist refreshed tokens when direct calls succeed
        if not auth_failed and self.client:
            try:
                self._persist_tokens(self.client)
            except Exception:
                pass

        # If direct Garmin OAuth failed (401), do not overwrite with empty values; let MND Garmin bridge populate
        if auth_failed:
            self.client = None
            raise GarminConnectAuthenticationError(f"Direct Garmin OAuth error: {last_auth_error}")

        # Snapshot existing activities outside the lock so Garmin HTTP detail calls never hold the file lock
        snapshot_state = state_store.load_live_state(LIVE_STATE_PATH)
        snapshot_activities = snapshot_state.get('garmin', {}).get('recent_activities', [])
        snapshot_map = {str(a.get('id')): a for a in snapshot_activities}

        today_active_burn = 0
        today_activity_list = []

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
            sub_title = ra.get('activityName') or act_name
            calories = round(float(ra.get('calories') or 0))
            today_active_burn += calories

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

            if existing and existing.get('benefits') and not custom_note:
                benefits = existing['benefits']
                if existing.get('sub_title'):
                    sub_title = existing['sub_title']
            else:
                benefits = self.benefits_engine.generate_benefits(
                    act_name, sub_title, duration_min, calories, avg_hr, max_hr, aerobic_te, anaerobic_te
                )

            hr_samples = existing.get('hr_samples') if existing else None
            hr_zones = existing.get('hr_zones') if existing else None
            exercise_sets = existing.get('exercise_sets') if existing else None

            if idx < 3 and not hr_samples:
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

            if idx < 3 and not hr_zones:
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

            if 'strength' in str(act_name).lower() and idx < 3 and not exercise_sets:
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
                "distance_miles": act_dist_miles
            }
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
            now_london_iso = datetime.now(ZoneInfo("Europe/London")).isoformat()
            state['last_synced'] = now_london_iso
            state['date'] = target_date_str

            garmin_state = state.setdefault('garmin', {})
            # Clear stale prior-day daily metrics on day rollover so yesterday's values never leak into today
            if prev_date and prev_date != target_date_str:
                for stale_key in (
                    'sleep_score', 'sleep_duration', 'body_battery',
                    'training_readiness', 'readiness_level', 'readiness_feedback',
                    'today_activities', 'active_calories', 'workout_calories',
                    'steps', 'stress_avg', 'hrv_last_night'
                ):
                    garmin_state.pop(stale_key, None)

            garmin_state['source'] = 'garmin_oauth'
            garmin_state['oauth_date'] = target_date_str
            garmin_state['last_synced'] = now_london_iso
            if summary.get('totalSteps') is not None:
                garmin_state['steps'] = summary.get('totalSteps')
            if summary.get('restingHeartRate') is not None:
                garmin_state['resting_hr'] = summary.get('restingHeartRate')
            if live_body_battery is not None:
                garmin_state['body_battery'] = live_body_battery
            elif summary.get('bodyBatteryMostRecentValue') is not None:
                garmin_state['body_battery'] = summary.get('bodyBatteryMostRecentValue')
            if body_battery_debug is not None:
                garmin_state['body_battery_debug'] = body_battery_debug

            if sleep_score is not None:
                garmin_state['sleep_score'] = sleep_score
            if sleep_duration is not None:
                garmin_state['sleep_duration'] = sleep_duration

            if readiness_score is not None:
                garmin_state['training_readiness'] = readiness_score
            if readiness_level:
                garmin_state['readiness_level'] = readiness_level
            if readiness_feedback:
                garmin_state['readiness_feedback'] = readiness_feedback
            if hrv_weekly is not None:
                garmin_state['hrv_weekly_avg'] = hrv_weekly
            if hrv_status is not None:
                garmin_state['hrv_status'] = hrv_status
            if hrv_last_night is not None:
                garmin_state['hrv_last_night'] = hrv_last_night
            if stress_avg is not None:
                garmin_state['stress_avg'] = stress_avg

            existing_activities = garmin_state.get('recent_activities', [])
            existing_map = {str(a.get('id')): a for a in existing_activities}

            # Re-apply any user_notes added concurrently while Garmin HTTP calls were in flight
            for entry in today_activity_list:
                latest_existing = existing_map.get(str(entry['id']))
                if latest_existing and latest_existing.get('user_notes') and not entry.get('user_notes'):
                    entry['user_notes'] = latest_existing['user_notes']
                    entry['sub_title'] = latest_existing['user_notes']

            garmin_state['today_activities'] = today_activity_list
            garmin_state['workout_calories'] = today_active_burn
            raw_summary_active = summary.get('activeKilocalories')
            summary_active = int(round(float(raw_summary_active))) if raw_summary_active is not None else 0
            garmin_state['active_calories'] = max(summary_active, today_active_burn)

            if summary.get('distanceInMeters') is not None:
                garmin_state['distance_miles'] = round(float(summary.get('distanceInMeters')) / 1609.344, 2)
            elif summary.get('totalDistanceMeters') is not None:
                garmin_state['distance_miles'] = round(float(summary.get('totalDistanceMeters')) / 1609.344, 2)
            else:
                garmin_state['distance_miles'] = round(sum(float(a.get('distance_miles') or 0) for a in today_activity_list), 2)

            if summary.get('moderateIntensityMinutes') is not None or summary.get('vigorousIntensityMinutes') is not None:
                mod_m = float(summary.get('moderateIntensityMinutes') or 0)
                vig_m = float(summary.get('vigorousIntensityMinutes') or 0)
                garmin_state['active_minutes'] = int(round(mod_m + vig_m))
            elif not today_activity_list:
                garmin_state['active_minutes'] = 0

            # Ensure recent_activities includes real Garmin activities from the 5-day fetch + preserved older real Garmin activities
            today_ids = {str(a['id']) for a in today_activity_list}
            all_activities = list(today_activity_list)
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
                            r_name, r_sub, r_dur, r_cals, r_avg_hr, r_max_hr, r_aero, r_anaero
                        ),
                        "activity_type_key": r_type_key,
                        "total_sets": ra.get('totalSets'),
                        "total_reps": ra.get('totalReps'),
                        "steps": r_steps,
                        "distance_miles": r_dist_miles
                    }
                    all_activities.append(r_entry)
                seen_ids.add(r_id)

            for old in existing_activities:
                old_id = str(old.get('id', ''))
                if old_id in seen_ids:
                    continue
                if old.get('source') == 'garmin_via_mnd_bridge' or old_id.startswith(('990', '9920')):
                    continue
                all_activities.append(old)
                seen_ids.add(old_id)
            all_activities.sort(key=lambda x: str(x.get('date', '')), reverse=True)
            garmin_state['recent_activities'] = all_activities

            nutrition = state.setdefault('nutrition', {})
            baseline_budget = 2092
            nutrition['calorie_target'] = baseline_budget + garmin_state.get('active_calories', 0)

            mnd_cals = state.get('garmin', {}).get('mnd_logged', {}).get('calories', 0)
            nutrition['calories_remaining'] = nutrition['calorie_target'] - mnd_cals
            nutrition['protein_target_g'] = 200
            mnd_prot = state.get('garmin', {}).get('mnd_logged', {}).get('protein_g', 0)
            nutrition['protein_remaining'] = max(0, 200 - mnd_prot)

            state_store.save_live_state(state, LIVE_STATE_PATH)

        self._persist_tokens(client)
        return state
