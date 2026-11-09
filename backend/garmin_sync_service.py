import os
import json
from datetime import datetime, date
from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from benefits_engine import PhysiologicalBenefitsEngine

TOKEN_DIR = os.environ.get('GARMIN_TOKEN_DIR', '/shared/user/.gemini/garmin_tokens')
if 'GARMIN_TOKENS_JSON' in os.environ:
    TOKEN_DIR = '/tmp/garmin_tokens'
    os.makedirs(TOKEN_DIR, exist_ok=True)
    with open(os.path.join(TOKEN_DIR, 'garmin_tokens.json'), 'w') as f:
        f.write(os.environ['GARMIN_TOKENS_JSON'])

LIVE_STATE_PATH = os.environ.get('LIVE_STATE_PATH', '/home/antigravity/live_state.json')
if not os.path.exists(LIVE_STATE_PATH):
    LIVE_STATE_PATH = 'live_state.json'
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
                raise
        return self.client

    def sync_today(self, target_date_str=None):
        if not target_date_str:
            target_date_str = date.today().isoformat()
        
        client = self.get_client()
        
        # 1. Fetch user summary
        try:
            summary = client.get_user_summary(target_date_str)
        except Exception as e:
            print(f"[GarminSync] Warning fetching summary: {e}")
            summary = {}

        # 2. Fetch today's activities
        try:
            raw_activities = client.get_activities_by_date(target_date_str)
        except Exception as e:
            print(f"[GarminSync] Warning fetching activities: {e}")
            raw_activities = []

        # 3. Fetch sleep data
        sleep_score = None
        sleep_duration = None
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
        readiness_score = None
        readiness_level = None
        readiness_feedback = None
        hrv_weekly = None
        try:
            readiness = client.get_morning_training_readiness(target_date_str)
            readiness_score = readiness.get('score')
            readiness_level = readiness.get('level')
            readiness_feedback = readiness.get('feedbackShort')
            hrv_weekly = readiness.get('hrvWeeklyAverage')
        except Exception as e:
            print(f"[GarminSync] Warning fetching readiness: {e}")

        # 5. Read current live_state.json
        state = {}
        if os.path.exists(LIVE_STATE_PATH):
            with open(LIVE_STATE_PATH, 'r') as f:
                state = json.load(f)

        state['last_synced'] = datetime.now().isoformat()
        state['date'] = target_date_str

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

        # Map today's activities
        existing_activities = garmin_state.get('recent_activities', [])
        existing_map = {str(a.get('id')): a for a in existing_activities}

        today_active_burn = 0
        today_activity_list = []

        for ra in raw_activities:
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
            today_activity_list.append(entry)

        # Update activities
        garmin_state['today_activities'] = today_activity_list
        garmin_state['active_calories'] = today_active_burn

        # Retain older activities from previous days in recent_activities for history viewing
        today_ids = {str(a['id']) for a in today_activity_list}
        all_activities = list(today_activity_list)
        for old in existing_activities:
            if str(old.get('id')) not in today_ids:
                all_activities.append(old)

        garmin_state['recent_activities'] = all_activities

        # Recalculate dynamic nutrition targets
        nutrition = state.setdefault('nutrition', {})
        baseline_budget = 2092
        nutrition['calorie_target'] = baseline_budget + today_active_burn
        
        mnd_cals = state.get('garmin', {}).get('mnd_logged', {}).get('calories', 0)
        nutrition['calories_remaining'] = nutrition['calorie_target'] - mnd_cals
        nutrition['protein_target_g'] = 200
        mnd_prot = state.get('garmin', {}).get('mnd_logged', {}).get('protein_g', 0)
        nutrition['protein_remaining'] = max(0, 200 - mnd_prot)

        # Save to both paths
        with open(LIVE_STATE_PATH, 'w') as f:
            json.dump(state, f, indent=2)

        try:
            with open(ARTIFACT_LIVE_STATE_PATH, 'w') as f:
                json.dump(state, f, indent=2)
        except Exception as e:
            print(f"[GarminSync] Warning copying to artifact: {e}")

        # Also save to permanent backend directory if available
        try:
            perm_dir = '/shared/user/.gemini/pulse_backend'
            os.makedirs(perm_dir, exist_ok=True)
            with open(os.path.join(perm_dir, 'live_state.json'), 'w') as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass

        return state
