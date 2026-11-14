import os
import json
from datetime import datetime, date
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from benefits_engine import PhysiologicalBenefitsEngine

TOKEN_DIR = os.environ.get('GARMIN_TOKEN_DIR', '/shared/user/.gemini/garmin_tokens')
if 'GARMIN_TOKENS_JSON' in os.environ:
    TOKEN_DIR = '/tmp/garmin_tokens'
    os.makedirs(TOKEN_DIR, exist_ok=True)
    token_file = os.path.join(TOKEN_DIR, 'garmin_tokens.json')
    if not os.path.exists(token_file):
        with open(token_file, 'w') as f:
            f.write(os.environ['GARMIN_TOKENS_JSON'])

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

    def get_client(self):
        if not self.client:
            self.client = Garmin()
            try:
                self.client.login(tokenstore=TOKEN_DIR)
            except Exception as e:
                print(f"[GarminSync] Login from tokenstore error: {e}")
                self.client = None
                raise
        return self.client

    def login_with_credentials(self, email, password):
        try:
            os.makedirs(TOKEN_DIR, exist_ok=True)
            client = Garmin(email=email, password=password, return_on_mfa=True)
            res = client.login()
            if isinstance(res, tuple) and len(res) == 2 and res[0] == "needs_mfa":
                self.pending_login_state = (client, res[1])
                return {"needs_mfa": True, "message": "2FA code required"}
            client.client.dump(TOKEN_DIR)
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
            os.makedirs(TOKEN_DIR, exist_ok=True)
            client.client.dump(TOKEN_DIR)
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
        auth_failed = False

        # 1. Fetch user summary
        try:
            summary = client.get_user_summary(target_date_str)
        except Exception as e:
            print(f"[GarminSync] Warning fetching summary: {e}")
            if "401" in str(e) or "Unauthorized" in str(e) or "invalid_grant" in str(e):
                auth_failed = True
            summary = {}

        # 2. Fetch today's activities
        if not auth_failed:
            try:
                raw_activities = client.get_activities_by_date(target_date_str)
            except Exception as e:
                print(f"[GarminSync] Warning fetching activities: {e}")
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
            raise GarminConnectAuthenticationError("Direct Garmin OAuth token expired (falling back to MND Garmin bridge)")

        garmin_state = state.setdefault('garmin', {})
        if summary.get('totalSteps') is not None:
            garmin_state['steps'] = summary.get('totalSteps')
        if summary.get('restingHeartRate') is not None:
            garmin_state['resting_hr'] = summary.get('restingHeartRate')
        if summary.get('bodyBatteryMostRecentValue') is not None:
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
                "benefits": benefits
            }
            if hr_samples:
                entry["hr_samples"] = hr_samples
            if hr_zones:
                entry["hr_zones"] = hr_zones

            today_activity_list.append(entry)

        if today_activity_list or summary.get('activeKilocalories'):
            garmin_state['today_activities'] = today_activity_list
            garmin_state['active_calories'] = today_active_burn or int(round(summary.get('activeKilocalories', 0)))

            today_ids = {str(a['id']) for a in today_activity_list}
            all_activities = list(today_activity_list)
            for old in existing_activities:
                if str(old.get('id')) not in today_ids:
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

        return state
