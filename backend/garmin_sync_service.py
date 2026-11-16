import os
import json
from datetime import datetime, date
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from benefits_engine import PhysiologicalBenefitsEngine
try:
    import db
except Exception:
    db = None

if 'GARMIN_TOKEN_DIR' in os.environ:
    TOKEN_DIR = os.environ['GARMIN_TOKEN_DIR']
elif os.path.exists('/data'):
    TOKEN_DIR = '/data/garmin_tokens'
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

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STATE_PATH = os.path.join(REPO_ROOT, 'live_state.json')
if not os.path.exists(DEFAULT_STATE_PATH):
    DEFAULT_STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live_state.json')
LIVE_STATE_PATH = os.environ.get('LIVE_STATE_PATH', DEFAULT_STATE_PATH)
ARTIFACT_LIVE_STATE_PATH = os.environ.get('ARTIFACT_LIVE_STATE_PATH', LIVE_STATE_PATH)

class GarminSyncService:
    def __init__(self):
        self.benefits_engine = PhysiologicalBenefitsEngine()
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
        if db is not None:
            try:
                dumped = client.client.dumps()
                if dumped:
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

            # 2. Try persistent TOKEN_DIR
            if not loaded:
                try:
                    self.client.login(tokenstore=TOKEN_DIR)
                    loaded = True
                except Exception as e:
                    print(f"[GarminSync] Login from tokenstore ({TOKEN_DIR}) error: {e}")

            # 3. Fall back to GARMIN_TOKENS_JSON env var
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

    def sync_today(self, target_date_str=None):
        if not target_date_str:
            target_date_str = date.today().isoformat()

        client = self.get_client()

        summary = None
        raw_activities = None
        sleep_score = None
        sleep_duration = None
        readiness_score = None
        readiness_level = None
        readiness_feedback = None
        hrv_weekly = None
        live_body_battery = None
        auth_failed = False
        last_auth_error = None

        AUTH_ERROR_TERMS = ["401", "400", "Unauthorized", "invalid_grant", "OAuth2Token"]

        def is_auth_error(exc):
            err_str = str(exc)
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

        # 2. Fetch today's activities
        if not auth_failed:
            try:
                try:
                    raw_activities = client.get_activities_by_date(target_date_str, target_date_str)
                except Exception as inner_e:
                    if is_auth_error(inner_e):
                        raise inner_e
                    # Fallback to get_activities(0, 15) so get_activities_by_date never fails due to arguments/API quirks
                    all_acts = client.get_activities(0, 15)
                    raw_activities = [a for a in all_acts if str(a.get('startTimeLocal', '')).startswith(target_date_str)]
            except Exception as e:
                print(f"[GarminSync] Warning fetching activities: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)
                raw_activities = []
        else:
            raw_activities = []

        # 3. Fetch sleep data
        if not auth_failed:
            try:
                sleep = client.get_sleep_data(target_date_str)
                dto = sleep.get('dailySleepDTO', {})
                scores = dto.get('sleepScores', {})
                sleep_score = scores.get('overall', {}).get('value')
                sec = dto.get('sleepTimeSeconds', 0)
                if sec > 0:
                    hours = sec // 3600
                    mins = (sec % 3600) // 60
                    sleep_duration = f"{hours}h {mins}m"
            except Exception as e:
                print(f"[GarminSync] Warning fetching sleep: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # 4. Fetch morning training readiness
        if not auth_failed:
            try:
                readiness = client.get_morning_training_readiness(target_date_str)
                readiness_score = readiness.get('score')
                readiness_level = readiness.get('level')
                readiness_feedback = readiness.get('feedbackShort')
                hrv_weekly = readiness.get('hrvWeeklyAverage')
            except Exception as e:
                print(f"[GarminSync] Warning fetching readiness: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # 5. Fetch live Body Battery timeline (more up-to-date than daily summary cache)
        if not auth_failed:
            try:
                bb_data = client.get_body_battery(target_date_str)
                if isinstance(bb_data, list) and len(bb_data) > 0:
                    day_bb = bb_data[-1] if isinstance(bb_data[-1], dict) else {}
                    vals = day_bb.get('bodyBatteryValuesArray') or []
                    for entry in reversed(vals):
                        if isinstance(entry, (list, tuple)) and len(entry) >= 2 and entry[1] is not None:
                            live_body_battery = int(round(float(entry[1])))
                            break
                    if live_body_battery is None and day_bb.get('bodyBatteryMostRecentValue') is not None:
                        live_body_battery = int(round(float(day_bb.get('bodyBatteryMostRecentValue'))))
            except Exception as e:
                print(f"[GarminSync] Warning fetching body battery: {e}")
                if is_auth_error(e):
                    auth_failed = True
                    last_auth_error = str(e)

        # Persist refreshed tokens when direct calls succeed
        if not auth_failed and self.client:
            try:
                self.client.client.dump(TOKEN_DIR)
            except Exception:
                pass

        # Read current live_state.json
        state = {}
        if os.path.exists(LIVE_STATE_PATH):
            with open(LIVE_STATE_PATH, 'r', encoding='utf-8') as f:
                state = json.load(f)

        state['last_synced'] = datetime.now().isoformat()
        state['date'] = target_date_str

        # If direct Garmin OAuth failed (401), do not overwrite with empty values; let MND Garmin bridge populate
        if auth_failed:
            self.client = None
            raise GarminConnectAuthenticationError(f"Direct Garmin OAuth error: {last_auth_error}")


        garmin_state = state.setdefault('garmin', {})
        garmin_state['source'] = 'garmin_oauth'
        if summary.get('totalSteps') is not None:
            garmin_state['steps'] = summary.get('totalSteps')
        if summary.get('restingHeartRate') is not None:
            garmin_state['resting_hr'] = summary.get('restingHeartRate')
        if live_body_battery is not None:
            garmin_state['body_battery'] = live_body_battery
        elif summary.get('bodyBatteryMostRecentValue') is not None:
            garmin_state['body_battery'] = summary.get('bodyBatteryMostRecentValue')

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

        existing_activities = garmin_state.get('recent_activities', [])
        existing_map = {str(a.get('id')): a for a in existing_activities}

        today_active_burn = 0
        today_activity_list = []

        for idx, ra in enumerate(raw_activities):
            act_id = str(ra.get('activityId'))
            activity_type_key = ra.get('activityType', {}).get('typeKey', 'cardio')
            total_sets = ra.get('totalSets')
            total_reps = ra.get('totalReps')
            act_name = ra.get('activityType', {}).get('typeKey', 'Cardio').capitalize()
            sub_title = ra.get('activityName', act_name)
            calories = round(float(ra.get('calories', 0)))
            today_active_burn += calories

            duration_min = round(float(ra.get('duration', 0)) / 60.0, 1)
            avg_hr = round(float(ra.get('averageHR', 0)))
            max_hr = round(float(ra.get('maxHR', 0)))
            aerobic_te = float(ra.get('aerobicTrainingEffect', 0.0) or 0.0)
            anaerobic_te = float(ra.get('anaerobicTrainingEffect', 0.0) or 0.0)
            start_time = ra.get('startTimeLocal', '')

            existing = existing_map.get(act_id)
            if existing and existing.get('benefits'):
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
            if hr_samples:
                entry["hr_samples"] = hr_samples
            if hr_zones:
                entry["hr_zones"] = hr_zones
            if exercise_sets:
                entry["exercise_sets"] = exercise_sets

            today_activity_list.append(entry)

        if today_activity_list or summary.get('activeKilocalories'):
            garmin_state['today_activities'] = today_activity_list
            garmin_state['active_calories'] = today_active_burn or int(round(summary.get('activeKilocalories', 0)))

            today_ids = {str(a['id']) for a in today_activity_list}
            all_activities = list(today_activity_list)
            for old in existing_activities:
                old_id = str(old.get('id', ''))
                old_date = str(old.get('date', ''))
                if old_id in today_ids:
                    continue
                if old.get('source') == 'garmin_via_mnd_bridge' or (old_date.startswith(target_date_str) and old_id.startswith(('990', '9920'))):
                    continue
                all_activities.append(old)
            garmin_state['recent_activities'] = all_activities

        nutrition = state.setdefault('nutrition', {})
        baseline_budget = 2092
        nutrition['calorie_target'] = baseline_budget + garmin_state.get('active_calories', 0)

        mnd_cals = state.get('garmin', {}).get('mnd_logged', {}).get('calories', 0)
        nutrition['calories_remaining'] = nutrition['calorie_target'] - mnd_cals
        nutrition['protein_target_g'] = 200
        mnd_prot = state.get('garmin', {}).get('mnd_logged', {}).get('protein_g', 0)
        nutrition['protein_remaining'] = max(0, 200 - mnd_prot)

        with open(LIVE_STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2)

        backend_state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live_state.json')
        if backend_state_path != LIVE_STATE_PATH:
            try:
                with open(backend_state_path, 'w', encoding='utf-8') as f:
                    json.dump(state, f, indent=2)
            except Exception:
                pass

        self._persist_tokens(client)
        return state
