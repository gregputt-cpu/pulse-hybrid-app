import os
import re
import json
import tempfile
import threading
import requests
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from benefits_engine import PhysiologicalBenefitsEngine
import state_store
try:
    import db
except Exception:
    db = None

def uk_today_str() -> str:
    return datetime.now(ZoneInfo("Europe/London")).date().isoformat()

def uk_now() -> datetime:
    return datetime.now(ZoneInfo("Europe/London"))

_DATA_DIR = state_store.get_data_dir()
if 'MND_TOKEN_DIR' in os.environ and os.environ['MND_TOKEN_DIR'].strip():
    MND_DIR = os.environ['MND_TOKEN_DIR'].strip()
elif _DATA_DIR:
    MND_DIR = os.path.join(_DATA_DIR, 'mnd_tokens')
elif os.path.exists('/shared/user/.gemini'):
    MND_DIR = '/shared/user/.gemini/mnd_tokens'
else:
    MND_DIR = '/tmp/mnd_tokens'

try:
    os.makedirs(MND_DIR, exist_ok=True)
    _mnd_test = os.path.join(MND_DIR, '.write_test')
    with open(_mnd_test, 'w', encoding='utf-8') as _tf:
        _tf.write('1')
    os.remove(_mnd_test)
except Exception:
    MND_DIR = '/tmp/mnd_tokens'
    os.makedirs(MND_DIR, exist_ok=True)

CREDS_FILE = os.path.join(MND_DIR, 'credentials.json')
COOKIES_FILE = os.path.join(MND_DIR, 'session_cookies.json')
HISTORY_CACHE_FILE = os.path.join(MND_DIR, 'mnd_history_cache.json')

LIVE_STATE_PATH = state_store.get_live_state_path()
ARTIFACT_LIVE_STATE_PATH = os.environ.get('ARTIFACT_LIVE_STATE_PATH', LIVE_STATE_PATH)

DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.mynetdiary.com',
    'Referer': 'https://www.mynetdiary.com/logonPage.do'
}

class MyNetDiarySyncService:
    def __init__(self):
        try:
            os.makedirs(MND_DIR, exist_ok=True)
        except Exception:
            pass
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.benefits_engine = PhysiologicalBenefitsEngine()
        self._load_cookies()

    def _load_cookies(self):
        if os.path.exists(COOKIES_FILE):
            try:
                with open(COOKIES_FILE, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
                if isinstance(raw, list):
                    for item in raw:
                        if not isinstance(item, dict) or not item.get('name'):
                            continue
                        self.session.cookies.set(
                            item['name'],
                            item.get('value', ''),
                            domain=item.get('domain') or '',
                            path=item.get('path') or '/',
                            secure=bool(item.get('secure', False)),
                            expires=item.get('expires'),
                        )
                elif isinstance(raw, dict):
                    self.session.cookies.update(requests.utils.cookiejar_from_dict(raw))
            except Exception as e:
                print(f"[MNDSync] Failed loading cookies: {e}")

    def _save_cookies(self):
        tmp_path = None
        try:
            os.makedirs(MND_DIR, exist_ok=True)
            serialized = [
                {
                    'name': c.name,
                    'value': c.value,
                    'domain': c.domain,
                    'path': c.path,
                    'secure': bool(c.secure),
                    'expires': c.expires,
                }
                for c in self.session.cookies
            ]
            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                dir=MND_DIR,
                prefix='.session_cookies.',
                suffix='.tmp',
                delete=False,
            ) as tmp:
                tmp_path = tmp.name
                json.dump(serialized, tmp, indent=2)
                tmp.flush()
                os.fsync(tmp.fileno())
            try:
                os.chmod(tmp_path, 0o600)
            except OSError:
                pass
            os.replace(tmp_path, COOKIES_FILE)
            tmp_path = None
        except Exception as e:
            print(f"[MNDSync] Failed saving cookies: {e}")
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    def get_credentials(self):
        env_u = os.environ.get('MND_USERNAME')
        env_p = os.environ.get('MND_PASSWORD')
        if env_u and env_p:
            return {'username': env_u, 'password': env_p}
        if os.path.exists(CREDS_FILE):
            try:
                with open(CREDS_FILE, 'r', encoding='utf-8') as f:
                    creds = json.load(f)
                if isinstance(creds, dict) and creds.get('username') and creds.get('password'):
                    return {'username': creds['username'], 'password': creds['password']}
            except Exception:
                pass
        return None

    def save_credentials(self, username, password):
        creds = {
            'username': username,
            'password': password,
            'updated_at': uk_now().isoformat()
        }
        try:
            os.makedirs(MND_DIR, exist_ok=True)
            with open(CREDS_FILE, 'w', encoding='utf-8') as f:
                json.dump(creds, f, indent=2)
            try:
                os.chmod(CREDS_FILE, 0o600)
            except OSError:
                pass
        except Exception:
            pass

    def login(self, username, password):
        url = 'https://www.mynetdiary.com/muiSignIn.do'
        payload = {
            'login': username,
            'password': password,
            'rememberMe': True
        }
        headers = dict(DEFAULT_HEADERS)
        headers['Content-Type'] = 'application/json;charset=UTF-8'

        try:
            resp = self.session.post(url, json=payload, headers=headers, timeout=15)
            data = resp.json()
            if data.get('loggedIn'):
                self._save_cookies()
                self.save_credentials(username, password)
                return {
                    'success': True,
                    'message': 'Successfully authenticated with MyNetDiary',
                    'username': username
                }
            else:
                return {
                    'success': False,
                    'error': 'Invalid username/email or password.'
                }
        except Exception as e:
            return {
                'success': False,
                'error': f"Connection to MyNetDiary failed: {str(e)}"
            }

    def ensure_authenticated(self):
        creds = self.get_credentials()
        if not creds:
            return False, 'No saved credentials found'
        res = self.login(creds['username'], creds['password'])
        if res.get('success'):
            return True, None
        return False, res.get('error', 'Login failed')

    def _extract_garmin_bridge_data(self, dash_data, exercises_ByDate, target_date_str, raw_exercise_items=None):
        """
        Extracts Garmin fēnix 8 telemetry synced into MyNetDiary's Linked Activity Tracker:
        - Daily Steps (id: 61)
        - Total Hours of Sleep (id: 54), Deep (id: 111), Light (id: 112), Awake (id: 113), REM (id: 115)
        - Active Calories (id: 103), Total Calories Out (id: 101), BMR (id: 108)
        - Total Distance (id: 114), Floors (id: 102), Active Minutes (id: 107)
        """
        if not isinstance(dash_data, dict):
            return {}
        trackables = dash_data.get('trackables', {})
        groups = trackables.get('groups', []) if isinstance(trackables, dict) else []
        by_id = {}
        for g in groups:
            for item in g.get('list', []):
                tid = item.get('id')
                if tid is not None:
                    entries_by_date = {}
                    for e in item.get('entries', []):
                        d = e.get('date')
                        if d:
                            entries_by_date[d] = e
                    by_id[tid] = entries_by_date

        def get_val(tid, d_str):
            e = by_id.get(tid, {}).get(d_str)
            if not e:
                return None
            return e.get('valueRounded')

        def get_hm(tid, d_str):
            e = by_id.get(tid, {}).get(d_str)
            if not e:
                return None, None
            h = e.get('hour')
            m = e.get('minute')
            if h is not None and m is not None:
                try:
                    return int(h), int(m)
                except Exception:
                    pass
            return None, None

        steps = get_val(61, target_date_str)
        active_cals = get_val(103, target_date_str)
        total_cals_out = get_val(101, target_date_str)
        distance_miles = get_val(114, target_date_str)
        active_mins = get_val(107, target_date_str)
        floors = get_val(102, target_date_str)

        sh, sm = get_hm(54, target_date_str)
        dh, dm = get_hm(111, target_date_str)
        lh, lm = get_hm(112, target_date_str)
        ah, am = get_hm(113, target_date_str)
        rh, rm = get_hm(115, target_date_str)

        sleep_duration = None
        sleep_score = None
        body_battery = None
        training_readiness = None
        readiness_level = None
        readiness_feedback = None

        if sh is not None and sm is not None:
            sleep_duration = f"{sh}h {sm}m"
            total_sleep_min = sh * 60 + sm
            deep_min = (dh or 0) * 60 + (dm or 0)
            rem_min = (rh or 0) * 60 + (rm or 0)
            awake_min = (ah or 0) * 60 + (am or 0)

            # Calculate physiological Firstbeat-aligned sleep score from Garmin sleep stage breakdown
            dur_pts = min(36.0, (total_sleep_min / 480.0) * 36.0)
            deep_pts = min(20.0, (deep_min / 100.0) * 20.0)
            rem_pts = min(20.0, (rem_min / 100.0) * 20.0)
            awake_penalty = max(0.0, (awake_min - 8.0) * 0.48)
            restfulness_pts = max(-8.0, 14.0 - awake_penalty)
            sleep_score = int(round(min(99, max(45, dur_pts + deep_pts + rem_pts + restfulness_pts))))


            morning_bb = min(100, int(round(sleep_score * 1.05)))
            burn_drain = int(round((active_cals or 0) / 45.0))
            body_battery = max(25, min(100, morning_bb - burn_drain))

            training_readiness = int(round(sleep_score * 0.65 + morning_bb * 0.38 - min(10, (active_cals or 0) / 150.0)))
            training_readiness = max(40, min(98, training_readiness))
            readiness_level = "OPTIMAL" if training_readiness >= 85 else ("HIGH" if training_readiness >= 75 else "MODERATE")
            readiness_feedback = "WELL_RECOVERED" if training_readiness >= 75 else "MODERATE_LOAD"

        # Build recent Garmin workouts from linked tracker days (today + past 4 days)
        recent_days = sorted(list(set(list(by_id.get(103, {}).keys()) + [target_date_str])), reverse=True)[:5]
        bridged_activities = []
        for d_str in recent_days:
            d_active_cals = int(round(get_val(103, d_str) or 0))
            d_active_mins = float(get_val(107, d_str) or 0)
            d_dist_miles = float(get_val(114, d_str) or 0)
            d_steps = int(round(get_val(61, d_str) or 0))
            ex_notes = exercises_ByDate.get(d_str, '')

            # Check if ex_notes contains workout calories, e.g. "(including 581 workout calories)"
            m_wc = re.search(r'including\s+([0-9,]+)\s+workout\s+calories', ex_notes)
            workout_cals = int(m_wc.group(1).replace(',', '')) if m_wc else 0

            # 1. When d_active_cals < 50 and workout_cals < 50, do NOT emit any individual_items (or bridged_activities) for d_str
            if d_active_cals < 50 and workout_cals < 50:
                continue

            # Only target_date_str has raw_exercise_items passed in directly
            day_raw_items = raw_exercise_items if (d_str == target_date_str and raw_exercise_items) else []

            # 1. Check for explicit individual workout items (non-generic 1505/1507)
            individual_items = []
            for it in day_raw_items:
                if not isinstance(it, dict):
                    continue
                act_id = (it.get('exercise') or {}).get('activityId')
                name = (it.get('inputString') or (it.get('exercise') or {}).get('activityName') or '').strip()
                name_lower = name.lower()
                if act_id in [1505, 1507] or name_lower in ['garmin active calories', 'daily step bonus', 'step bonus']:
                    continue
                if 'garmin' in name_lower or 'step' in name_lower or 'tracker' in name_lower or 'bmr' in name_lower:
                    continue

                cals = it.get('calories')
                if cals is None or cals == 0:
                    m_c = re.search(r'(\d+)\s*(?:cal|calories|kcal)', str(it.get('amountInputString', '')) + ' ' + str(it.get('notes', '')))
                    cals = int(m_c.group(1)) if m_c else 0
                else:
                    try:
                        cals = int(round(float(cals)))
                    except (ValueError, TypeError):
                        cals = 0

                if cals <= 10:
                    continue

                m_d = re.search(r'(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)', str(it.get('amountInputString', '')) + ' ' + str(it.get('notes', '')))
                dur = float(m_d.group(1)) if m_d else round(max(20.0, cals / 9.0), 1)
                time_s = it.get('timeString') or '08:30:00'
                if len(time_s) == 5:
                    time_s += ':00'

                individual_items.append({
                    'name': name or 'Garmin Workout',
                    'calories': cals,
                    'duration_min': dur,
                    'time': time_s,
                    'notes': it.get('notes', '')
                })

            if individual_items:
                # Add each individual workout as a distinct activity card
                for idx, item in enumerate(individual_items):
                    act_id = int(f"99{d_str.replace('-', '')}{idx+1:02d}")
                    act_name = item['name']
                    sub_title = f"fēnix 8 • {item['calories']} kcal ({item['duration_min']} min)"
                    avg_hr = 130
                    max_hr = 160
                    aerobic_te = round(min(4.5, max(1.5, item['calories'] / 200.0)), 1)
                    anaerobic_te = round(min(2.5, max(0.2, item['calories'] / 450.0)), 1)
                    benefits = self.benefits_engine.generate_benefits(
                        "Cardio", sub_title, item['duration_min'], item['calories'], avg_hr, max_hr, aerobic_te, anaerobic_te
                    )
                    bridged_activities.append({
                        "id": act_id,
                        "name": act_name,
                        "sub_title": sub_title,
                        "date": f"{d_str} {item['time']}",
                        "duration_min": item['duration_min'],
                        "calories": item['calories'],
                        "workout_calories": item['calories'],
                        "avg_hr": avg_hr,
                        "max_hr": max_hr,
                        "aerobic_te": aerobic_te,
                        "anaerobic_te": anaerobic_te,
                        "benefits": benefits,
                        "source": "garmin_via_mnd_bridge"
                    })

                # If steps were taken, append a separate movement card
                if d_steps >= 1000:
                    step_cals = max(60, int(round(d_steps * 0.038)))
                    s_id = int(f"99{d_str.replace('-', '')}99")
                    s_sub = f"fēnix 8 • {d_steps:,} steps ({d_dist_miles:.2f} mi)"
                    s_benefits = self.benefits_engine.generate_benefits(
                        "Walking", s_sub, 45.0, step_cals, 92, 118, 0.8, 0.0
                    )
                    s_time = uk_now().strftime("%H:%M:%S") if d_str == target_date_str else "17:30:00"
                    bridged_activities.append({
                        "id": s_id,
                        "name": "Daily Steps & Movement",
                        "sub_title": s_sub,
                        "date": f"{d_str} {s_time}",
                        "duration_min": 45.0,
                        "calories": step_cals,
                        "workout_calories": step_cals,
                        "steps": d_steps,
                        "distance_miles": d_dist_miles,
                        "avg_hr": 92,
                        "max_hr": 118,
                        "aerobic_te": 0.8,
                        "anaerobic_te": 0.0,
                        "benefits": s_benefits,
                        "source": "garmin_via_mnd_bridge"
                    })
            elif d_active_mins >= 10 or workout_cals >= 50 or d_active_cals >= 80:
                if workout_cals > 0 and d_str == target_date_str:
                    # Build separate individual workout card for today
                    w_id = int(f"99{d_str.replace('-', '')}01")
                    w_dur = round(min(d_active_mins or 50.0, max(30.0, workout_cals / 9.5)), 1)
                    w_name = "Hybrid Training Session" if w_dur >= 45 else "Active Conditioning"
                    w_sub = f"fēnix 8 • {workout_cals} kcal Workout"
                    w_avg_hr = 132 if workout_cals >= 500 else 122
                    w_max_hr = 166 if workout_cals >= 500 else 150
                    w_aero = round(min(4.5, max(2.2, workout_cals / 190.0)), 1)
                    w_anaero = round(min(2.5, max(0.5, workout_cals / 420.0)), 1)
                    w_benefits = self.benefits_engine.generate_benefits(
                        "Cardio", w_sub, w_dur, workout_cals, w_avg_hr, w_max_hr, w_aero, w_anaero
                    )
                    bridged_activities.append({
                        "id": w_id,
                        "name": w_name,
                        "sub_title": w_sub,
                        "date": f"{d_str} 08:30:00",
                        "duration_min": w_dur,
                        "calories": workout_cals,
                        "workout_calories": workout_cals,
                        "avg_hr": w_avg_hr,
                        "max_hr": w_max_hr,
                        "aerobic_te": w_aero,
                        "anaerobic_te": w_anaero,
                        "benefits": w_benefits,
                        "source": "garmin_via_mnd_bridge"
                    })

                    # Build separate steps/daily movement card if steps recorded
                    if d_steps >= 500:
                        s_id = int(f"99{d_str.replace('-', '')}02")
                        s_dur = round(max(15.0, (d_active_mins or 30.0) - min(d_active_mins or 0, w_dur)), 1) if d_active_mins else 30.0
                        s_cals = max(50, d_active_cals - workout_cals) if d_active_cals > workout_cals else max(50, int(round(d_steps * 0.038)))
                        s_sub = f"fēnix 8 • {d_steps:,} steps ({d_dist_miles:.2f} mi)"
                        s_benefits = self.benefits_engine.generate_benefits(
                            "Walking", s_sub, s_dur, s_cals, 92, 118, 0.8, 0.0
                        )
                        s_time = uk_now().strftime("%H:%M:%S") if d_str == target_date_str else "17:30:00"
                        bridged_activities.append({
                            "id": s_id,
                            "name": "Daily Steps & Movement",
                            "sub_title": s_sub,
                            "date": f"{d_str} {s_time}",
                            "duration_min": s_dur,
                            "calories": s_cals,
                            "workout_calories": s_cals,
                            "steps": d_steps,
                            "distance_miles": d_dist_miles,
                            "avg_hr": 92,
                            "max_hr": 118,
                            "aerobic_te": 0.8,
                            "anaerobic_te": 0.0,
                            "benefits": s_benefits,
                            "source": "garmin_via_mnd_bridge"
                        })
                elif d_steps >= 2500 or d_active_mins >= 25:
                    # Daily movement card only when genuine meaningful movement exists (never on low morning steps/allowance)
                    act_id = int("99" + d_str.replace("-", ""))
                    act_name = "Daily Steps & Movement"
                    sub_title = f"fēnix 8 • {d_steps:,} steps ({d_dist_miles:.2f} mi)"
                    avg_hr = 98 if d_active_mins >= 45 else 92
                    max_hr = 124 if d_active_mins >= 45 else 118
                    aerobic_te = round(min(2.4, max(0.8, d_active_cals / 260.0)), 1)
                    anaerobic_te = 0.0
                    benefits = self.benefits_engine.generate_benefits(
                        "Walking", sub_title, d_active_mins or 35.0, d_active_cals, avg_hr, max_hr, aerobic_te, anaerobic_te
                    )
                    bridged_activities.append({
                        "id": act_id,
                        "name": act_name,
                        "sub_title": sub_title,
                        "date": f"{d_str} 09:30:00",
                        "duration_min": round(d_active_mins or 35.0, 1),
                        "calories": d_active_cals,
                        "workout_calories": workout_cals if workout_cals > 0 else d_active_cals,
                        "distance_miles": d_dist_miles,
                        "steps": d_steps,
                        "avg_hr": avg_hr,
                        "max_hr": max_hr,
                        "aerobic_te": aerobic_te,
                        "anaerobic_te": anaerobic_te,
                        "benefits": benefits,
                        "source": "garmin_via_mnd_bridge"
                    })

        return {
            "steps": int(round(steps)) if steps is not None else None,
            "active_calories": int(round(active_cals)) if active_cals is not None else None,
            "total_calories_out": int(round(total_cals_out)) if total_cals_out is not None else None,
            "distance_miles": float(distance_miles) if distance_miles is not None else None,
            "active_minutes": int(round(active_mins)) if active_mins is not None else None,
            "floors": int(round(floors)) if floors is not None else None,
            "sleep_duration": sleep_duration,
            "sleep_score": sleep_score,
            "body_battery": body_battery,
            "training_readiness": training_readiness,
            "readiness_level": readiness_level,
            "readiness_feedback": readiness_feedback,
            "bridged_activities": bridged_activities,
            "raw_exercise_items": raw_exercise_items or []
        }

    def _load_history_cache(self):
        cache = {}
        if os.path.exists(HISTORY_CACHE_FILE):
            try:
                with open(HISTORY_CACHE_FILE, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                    if isinstance(loaded, dict):
                        cache = loaded
            except Exception as e:
                print(f"[MNDSync] Warning loading history cache: {e}")

        try:
            ls = state_store.load_live_state(LIVE_STATE_PATH)
            hist_days = (ls.get('mnd_history') or {}).get('days') or []
            for d in hist_days:
                if isinstance(d, dict) and d.get('date') and d['date'] not in cache and (d.get('calories') or 0) > 0:
                    cache[d['date']] = d
        except Exception:
            pass
        return cache

    def _save_history_cache(self, cache):
        try:
            os.makedirs(MND_DIR, exist_ok=True)
            with open(HISTORY_CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2)
        except Exception as e:
            print(f"[MNDSync] Warning saving history cache: {e}")

    def _build_day_summary(self, date_str, totals, meals):
        return {
            "date": date_str,
            "calories": int(totals.get("calories", 0) or 0),
            "protein": int(totals.get("protein", 0) or 0),
            "carbs": int(totals.get("carbs", 0) or 0),
            "fat": int(totals.get("fat", 0) or 0),
            "fiber": int(totals.get("fiber", 0) or 0),
            "sodium": int(totals.get("sodium", 0) or 0),
            "sugar_g": float(totals.get("sugar_g", 0.0) or 0.0),
            "sat_fat_g": float(totals.get("sat_fat_g", 0.0) or 0.0),
            "items": [
                {
                    "name": it.get("name", ""),
                    "cals": int(it.get("cals", 0) or 0),
                    "p": int(it.get("p", 0) or 0),
                    "c": int(it.get("c", 0) or 0),
                    "f": int(it.get("f", 0) or 0),
                }
                for m in (meals or {}).values()
                for it in m.get("items", [])
                if isinstance(it, dict) and it.get("name")
            ],
        }

    def _compute_history_averages(self, day_list):
        if not day_list:
            return {
                "calories": 0,
                "protein": 0,
                "carbs": 0,
                "fat": 0.0,
                "fiber": 0.0,
                "sodium": 0,
                "sugar_g": 0.0,
                "sat_fat_g": 0.0,
            }
        n = len(day_list)
        return {
            "calories": int(round(sum(d.get("calories", 0) or 0 for d in day_list) / n)),
            "protein": int(round(sum(d.get("protein", 0) or 0 for d in day_list) / n)),
            "carbs": int(round(sum(d.get("carbs", 0) or 0 for d in day_list) / n)),
            "fat": round(sum(d.get("fat", 0) or 0 for d in day_list) / n, 1),
            "fiber": round(sum(d.get("fiber", 0) or 0 for d in day_list) / n, 1),
            "sodium": int(round(sum(d.get("sodium", 0) or 0 for d in day_list) / n)),
            "sugar_g": round(sum(d.get("sugar_g", 0.0) or 0.0 for d in day_list) / n, 1),
            "sat_fat_g": round(sum(d.get("sat_fat_g", 0.0) or 0.0 for d in day_list) / n, 1),
        }

    def fetch_multi_day_history(self, end_date_str=None, days=10, skip_refresh_dates=None):
        if not end_date_str:
            end_date_str = uk_today_str()

        today_str = uk_today_str()
        try:
            today_dt = datetime.strptime(today_str, '%Y-%m-%d').date()
            yesterday_str = (today_dt - timedelta(days=1)).isoformat()
            end_dt = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except Exception:
            end_dt = uk_now().date()
            end_date_str = end_dt.isoformat()
            yesterday_str = (end_dt - timedelta(days=1)).isoformat()

        window_dates = [
            (end_dt - timedelta(days=offset)).isoformat()
            for offset in range(max(1, int(days)) - 1, -1, -1)
        ]

        cache = self._load_history_cache()
        skip_set = set(skip_refresh_dates or [])
        headers = dict(DEFAULT_HEADERS)
        headers['Referer'] = 'https://www.mynetdiary.com/daily.do'
        meals_url = 'https://www.mynetdiary.com/muiGetMeals.do'
        cache_dirty = False

        for d_str in window_dates:
            if d_str in skip_set:
                continue
            cached_day = cache.get(d_str)
            cached_items = cached_day.get('items') if isinstance(cached_day, dict) else None
            has_zeroed_items = (
                isinstance(cached_items, list)
                and len(cached_items) > 0
                and all(isinstance(it, dict) and (it.get('cals') or 0) == 0 for it in cached_items)
            )
            is_past_cached = (
                d_str < today_str
                and d_str != yesterday_str
                and isinstance(cached_day, dict)
                and (cached_day.get('calories') or 0) > 0
                and not has_zeroed_items
            )
            if is_past_cached:
                continue

            try:
                resp = self.session.get(meals_url, params={'date': d_str}, headers=headers, timeout=8)
                if resp.status_code != 200:
                    continue
                r_json = resp.json()
                if isinstance(r_json, dict) and r_json.get('needLogon'):
                    authed, _ = self.ensure_authenticated()
                    if authed:
                        resp = self.session.get(meals_url, params={'date': d_str}, headers=headers, timeout=8)
                        r_json = resp.json()
                    else:
                        continue
                if not r_json or (isinstance(r_json, dict) and r_json.get('needLogon')):
                    continue

                d_totals, d_meals = self._parse_mnd_response(r_json, {})
                if d_totals.get('calories', 0) > 0 or d_str not in cache:
                    cache[d_str] = self._build_day_summary(d_str, d_totals, d_meals)
                    cache_dirty = True
            except Exception as e:
                print(f"[MNDSync] History fetch warning for {d_str}: {e}")

        if cache_dirty:
            self._save_history_cache(cache)

        logged_days = [
            cache[d_str]
            for d_str in window_dates
            if isinstance(cache.get(d_str), dict) and (cache[d_str].get('calories') or 0) > 0
        ]

        return {
            "window_days": len(logged_days),
            "start_date": logged_days[0]["date"] if logged_days else end_date_str,
            "end_date": end_date_str,
            "days": logged_days,
            "averages_10d": self._compute_history_averages(logged_days),
            "averages_7d": self._compute_history_averages(logged_days[-7:]),
        }

    def fetch_today_data(self, target_date_str=None):
        if not target_date_str:
            target_date_str = uk_today_str()

        meals_url = 'https://www.mynetdiary.com/muiGetMeals.do'
        headers = dict(DEFAULT_HEADERS)
        headers['Referer'] = 'https://www.mynetdiary.com/daily.do'

        params = {'date': target_date_str}
        try:
            resp = self.session.get(meals_url, params=params, headers=headers, timeout=15)
            data = resp.json()
        except Exception as e:
            return {'success': False, 'error': f'Request failed: {str(e)}'}

        if not data or (isinstance(data, dict) and data.get('needLogon')):
            authed, err = self.ensure_authenticated()
            if not authed:
                return {'success': False, 'requires_auth': True, 'error': err}
            try:
                resp = self.session.get(meals_url, params=params, headers=headers, timeout=15)
                data = resp.json()
            except Exception as e:
                return {'success': False, 'error': f'Request failed after relogin: {str(e)}'}
            if not data or (isinstance(data, dict) and data.get('needLogon')):
                return {'success': False, 'requires_auth': True, 'error': 'MyNetDiary session still requires login after re-authentication'}

        self._save_cookies()

        analysis_data = {}
        try:
            analysis_url = 'https://www.mynetdiary.com/muiGetDailyAnalysis.do'
            a_resp = self.session.get(analysis_url, params={'date': target_date_str}, headers=headers, timeout=10)
            if a_resp.status_code == 200:
                analysis_data = a_resp.json()
        except Exception as e:
            print(f"[MNDSync] Warning fetching analysis: {e}")

        dash_data = {}
        exercises_by_date = {}
        raw_exercise_items = []
        try:
            dash_resp = self.session.get('https://www.mynetdiary.com/muiGetDashboard.do', params={'date': target_date_str}, headers=headers, timeout=12)
            if dash_resp.status_code == 200:
                dash_data = dash_resp.json()
            ex_resp = self.session.get('https://www.mynetdiary.com/muiGetExercises.do', params={'date': target_date_str}, headers=headers, timeout=10)
            if ex_resp.status_code == 200:
                ex_json = ex_resp.json()
                raw_exercise_items = [item for item in ex_json.get('list', []) if isinstance(item, dict)]
                notes_list = [str(item.get('notes', '')) for item in raw_exercise_items]
                exercises_by_date[target_date_str] = " | ".join(notes_list)
        except Exception as e:
            print(f"[MNDSync] Warning fetching dashboard/exercises bridge: {e}")

        garmin_bridge = self._extract_garmin_bridge_data(dash_data, exercises_by_date, target_date_str, raw_exercise_items)
        totals, meals = self._parse_mnd_response(data, analysis_data)

        history_summary = None
        try:
            cache = self._load_history_cache()
            cache[target_date_str] = self._build_day_summary(target_date_str, totals, meals)
            self._save_history_cache(cache)

            # Build immediate history summary from cache without blocking the HTTP response
            try:
                end_dt = datetime.strptime(target_date_str, '%Y-%m-%d').date()
            except Exception:
                end_dt = uk_now().date()
            window_dates = [
                (end_dt - timedelta(days=offset)).isoformat()
                for offset in range(9, -1, -1)
            ]
            logged_days = [
                cache[d_str]
                for d_str in window_dates
                if isinstance(cache.get(d_str), dict) and (cache[d_str].get('calories') or 0) > 0
            ]
            history_summary = {
                "window_days": len(logged_days),
                "start_date": logged_days[0]["date"] if logged_days else target_date_str,
                "end_date": target_date_str,
                "days": logged_days,
                "averages_10d": self._compute_history_averages(logged_days),
                "averages_7d": self._compute_history_averages(logged_days[-7:]),
            }
            self._schedule_history_backfill(target_date_str, days=10)
        except Exception as e:
            print(f"[MNDSync] Warning building multi-day history: {e}")

        weight_info = analysis_data.get('weightInfo')
        state = self._update_live_state(totals, meals, weight_info, garmin_bridge, target_date_str, history_summary=history_summary)

        return {
            'success': True,
            'date': target_date_str,
            'totals': totals,
            'meals': meals,
            'garmin_bridge': garmin_bridge,
            'weight_info': weight_info,
            'history': history_summary,
            'live_state': state
        }

    def _schedule_history_backfill(self, target_date_str, days=10):
        lock = getattr(self, '_history_backfill_lock', None)
        if lock is None:
            lock = threading.Lock()
            self._history_backfill_lock = lock
        if not lock.acquire(blocking=False):
            return

        def _worker():
            try:
                summary = self.fetch_multi_day_history(
                    target_date_str, days=days, skip_refresh_dates={target_date_str}
                )
                if summary:
                    with state_store.state_lock(LIVE_STATE_PATH):
                        st = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)
                        st.setdefault('garmin', {})['mnd_history'] = summary
                        state_store.save_live_state(st, LIVE_STATE_PATH)
            except Exception as exc:
                print(f"[MNDSync] Background history backfill warning: {exc}")
            finally:
                lock.release()

        t = threading.Thread(target=_worker, name="mnd-history-backfill", daemon=True)
        t.start()

    def _parse_mnd_response(self, meals_data, analysis_data):
        totals = {
            'calories': 0,
            'protein': 0,
            'carbs': 0,
            'fat': 0,
            'fiber': 0,
            'sodium': 0,
            'water': 0.0,
            'sugar_g': 0.0,
            'sat_fat_g': 0.0
        }

        def _get_nut(fl, *keys):
            if not isinstance(fl, dict):
                return 0.0
            for k in keys:
                entry = fl.get(k)
                if isinstance(entry, dict):
                    raw_val = entry.get('values', {}).get('rawValue')
                    if raw_val is not None:
                        try:
                            return float(raw_val)
                        except (ValueError, TypeError):
                            pass
                elif entry is not None:
                    try:
                        return float(entry)
                    except (ValueError, TypeError):
                        pass
            return 0.0

        total_sugar = 0.0
        total_sat_fat = 0.0

        meals = {
            'breakfast': {'name': 'Breakfast', 'time': '07:30', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []},
            'lunch': {'name': 'Lunch', 'time': '12:45', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []},
            'dinner': {'name': 'Dinner', 'time': 'Pending', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []},
            'snacks': {'name': 'Snacks & Hydration', 'time': '15:15', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []}
        }

        meal_list = meals_data.get('meals', []) if isinstance(meals_data, dict) else (meals_data if isinstance(meals_data, list) else [])
        if not meal_list and isinstance(meals_data, dict):
            meal_list = meals_data.get('list', [])

        category_map = {
            1: 'breakfast',
            2: 'lunch',
            3: 'dinner',
            4: 'snacks'
        }

        for m in meal_list:
            if not isinstance(m, dict):
                continue
            cat_id = m.get('mealTypeId') or m.get('type')
            cat_key = category_map.get(cat_id, 'snacks')
            if 'mealTypeName' in m:
                m_name = m['mealTypeName'].lower()
                if 'breakfast' in m_name: cat_key = 'breakfast'
                elif 'lunch' in m_name: cat_key = 'lunch'
                elif 'dinner' in m_name: cat_key = 'dinner'
                elif 'snack' in m_name: cat_key = 'snacks'

            target_meal = meals[cat_key]
            entries = m.get('foodEntries', []) or m.get('entries', []) or m.get('items', [])
            times = []
            for item in entries:
                if not isinstance(item, dict):
                    continue
                label = item.get('foodLabel') or {}
                item_vals = item.get('values') or {}
                name = label.get('cleanFoodName') or label.get('foodName') or item.get('inputString') or item.get('name', 'Food Item')
                cals = int(round(float(item.get('calories') or 0)))

                def _safe_nut(label_key, val_code):
                    node = label.get(label_key)
                    vals = node.get('values') if isinstance(node, dict) else None
                    raw = vals.get('rawValue') if isinstance(vals, dict) else None
                    if raw is not None:
                        return raw
                    return item_vals.get(val_code) or 0

                p = int(round(float(_safe_nut('protein', '203') or 0)))
                c = int(round(float(_safe_nut('totalCarbs', '205') or 0)))
                f = int(round(float(_safe_nut('totalFat', '204') or 0)))
                totals['fiber'] += int(round(float(_safe_nut('fiber', '291') or 0)))
                totals['sodium'] += int(round(float(_safe_nut('sodium', '307') or 0)))

                sugar_g = _get_nut(label, "sugars", "sugar", "totalSugars", "269")
                if sugar_g == 0.0 and isinstance(item.get('values'), dict):
                    sugar_g = _get_nut(item.get('values'), "269")
                if sugar_g > 0:
                    total_sugar += sugar_g

                sat_fat_g = _get_nut(label, "saturatedFat", "satFat", "606")
                if sat_fat_g == 0.0 and isinstance(item.get('values'), dict):
                    sat_fat_g = _get_nut(item.get('values'), "606")
                if sat_fat_g > 0:
                    total_sat_fat += sat_fat_g

                time_s = item.get('timeString')
                if time_s:
                    times.append(time_s)

                target_meal['items'].append({'name': name, 'cals': cals, 'p': p, 'c': c, 'f': f})
                target_meal['calories'] += cals
                target_meal['protein'] += p
                target_meal['carbs'] += c
                target_meal['fat'] += f

                totals['calories'] += cals
                totals['protein'] += p
                totals['carbs'] += c
                totals['fat'] += f

            if times:
                target_meal['time'] = times[0]

        totals['sugar_g'] = round(total_sugar, 1)
        totals['sat_fat_g'] = round(total_sat_fat, 1)

        if isinstance(meals_data, dict):
            apple = meals_data.get('appleData', {})
            if apple.get('consumedCalories') is not None:
                totals['calories'] = int(apple['consumedCalories'])
            elif meals_data.get('dayTotals', {}).get('eaten', {}).get('value') is not None:
                v = str(meals_data['dayTotals']['eaten']['value']).replace(',', '')
                try:
                    totals['calories'] = int(float(v))
                except Exception:
                    pass
            for k in ['totalSodium', 'sodium']:
                if k in analysis_data and analysis_data[k]:
                    totals['sodium'] = round(float(analysis_data[k]))
                    break
            for k in ['water', 'waterAmount']:
                if k in analysis_data and analysis_data[k]:
                    totals['water'] = round(float(analysis_data[k]), 1)
                    break

        return totals, meals

    def _update_live_state(self, totals, meals, weight_info=None, garmin_bridge=None, target_date_str=None, history_summary=None):
        with state_store.state_lock(LIVE_STATE_PATH):
            return self._update_live_state_locked(
                totals,
                meals,
                weight_info=weight_info,
                garmin_bridge=garmin_bridge,
                target_date_str=target_date_str,
                history_summary=history_summary,
            )

    def _update_live_state_locked(self, totals, meals, weight_info=None, garmin_bridge=None, target_date_str=None, history_summary=None):
        state = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)

        if target_date_str:
            state['date'] = target_date_str
        state['last_synced'] = uk_now().isoformat()

        garmin_state = state.setdefault('garmin', {})
        today_str = target_date_str or uk_today_str()
        has_live_garmin_oauth = (
            garmin_state.get('source') == 'garmin_oauth'
            and garmin_state.get('oauth_date') == today_str
        )

        # Apply live Garmin bridge metrics from MyNetDiary if present (only when direct Garmin OAuth hasn't already populated today)
        if garmin_bridge:
            if garmin_bridge.get('steps') is not None:
                if not has_live_garmin_oauth or not garmin_state.get('steps'):
                    garmin_state['steps'] = garmin_bridge['steps']
                else:
                    garmin_state['steps'] = max(int(garmin_state.get('steps') or 0), int(garmin_bridge['steps'] or 0))
            if garmin_bridge.get('active_calories') is not None and (not has_live_garmin_oauth or garmin_state.get('active_calories') is None):
                garmin_state['active_calories'] = garmin_bridge['active_calories']
            if garmin_bridge.get('distance_miles') is not None and (not has_live_garmin_oauth or garmin_state.get('distance_miles') is None):
                garmin_state['distance_miles'] = garmin_bridge['distance_miles']
            if garmin_bridge.get('active_minutes') is not None and (not has_live_garmin_oauth or garmin_state.get('active_minutes') is None):
                garmin_state['active_minutes'] = garmin_bridge['active_minutes']
            if garmin_bridge.get('sleep_duration') and (not has_live_garmin_oauth or not garmin_state.get('sleep_duration')):
                garmin_state['sleep_duration'] = garmin_bridge['sleep_duration']
            # Check manual override dates for sleep_score, body_battery, and training_readiness
            is_manual_override = (
                garmin_state.get('sleep_score_manual_date') == today_str
                and garmin_state.get('sleep_score') is not None
            )
            is_bb_manual = (
                garmin_state.get('body_battery_manual_date') == today_str
                and garmin_state.get('body_battery') is not None
            )
            is_tr_manual = (
                garmin_state.get('readiness_manual_date') == today_str
                and garmin_state.get('training_readiness') is not None
            )

            if garmin_state.get('sleep_score') is not None:
                effective_sleep_score = garmin_state['sleep_score']
                if is_manual_override:
                    garmin_state['sleep_score_source'] = "manual_override"
                else:
                    garmin_state['sleep_score_source'] = garmin_state.get('sleep_score_source') or "garmin_oauth"
            else:
                effective_sleep_score = garmin_bridge.get('sleep_score')
                if effective_sleep_score is not None:
                    garmin_state['sleep_score'] = effective_sleep_score
                    garmin_state['sleep_score_source'] = "mnd_estimated"

            # Never overwrite an existing body_battery or training_readiness
            if garmin_state.get('body_battery') is None and not is_bb_manual:
                if effective_sleep_score is not None:
                    active_cals_val = garmin_state.get('active_calories') or 0
                    morning_bb = min(100, int(round(effective_sleep_score * 1.05)))
                    burn_drain = int(round(active_cals_val / 45.0))
                    calc_bb = max(25, min(100, morning_bb - burn_drain))
                    garmin_state['body_battery'] = calc_bb
                elif garmin_bridge.get('body_battery') is not None:
                    garmin_state['body_battery'] = garmin_bridge['body_battery']

            if garmin_state.get('training_readiness') is None and not is_tr_manual:
                if effective_sleep_score is not None:
                    active_cals_val = garmin_state.get('active_calories') or 0
                    morning_bb = min(100, int(round(effective_sleep_score * 1.05)))
                    calc_tr = int(round(effective_sleep_score * 0.65 + morning_bb * 0.38 - min(10, active_cals_val / 150.0)))
                    calc_tr = max(40, min(98, calc_tr))
                    garmin_state['training_readiness'] = calc_tr
                    garmin_state['readiness_level'] = "OPTIMAL" if calc_tr >= 85 else ("HIGH" if calc_tr >= 75 else "MODERATE")
                    garmin_state['readiness_feedback'] = "WELL_RECOVERED" if calc_tr >= 75 else "MODERATE_LOAD"
                else:
                    if garmin_bridge.get('training_readiness') is not None:
                        garmin_state['training_readiness'] = garmin_bridge['training_readiness']
                    if garmin_bridge.get('readiness_level'):
                        garmin_state['readiness_level'] = garmin_bridge['readiness_level']
                    if garmin_bridge.get('readiness_feedback'):
                        garmin_state['readiness_feedback'] = garmin_bridge['readiness_feedback']

            if garmin_bridge.get('raw_exercise_items'):
                garmin_state['raw_exercise_items'] = garmin_bridge['raw_exercise_items']

            def _is_synthetic_bridge(act):
                if not isinstance(act, dict):
                    return False
                aid = str(act.get('id', ''))
                return act.get('source') == 'garmin_via_mnd_bridge' or aid.startswith(('990', '9920'))

            bridged_acts = garmin_bridge.get('bridged_activities', [])
            today_str = target_date_str or uk_today_str()
            today_bridged = [a for a in bridged_acts if str(a.get('date', '')).startswith(today_str)]

            if has_live_garmin_oauth:
                # Direct Garmin OAuth is authoritative for today: never inject MND bridge activities and strip any synthetic bridge items
                garmin_state['today_activities'] = [
                    a for a in garmin_state.get('today_activities', [])
                    if str(a.get('date', '')).startswith(today_str) and not _is_synthetic_bridge(a)
                ]
                garmin_state['recent_activities'] = [
                    a for a in garmin_state.get('recent_activities', [])
                    if not _is_synthetic_bridge(a)
                ]
            else:
                if today_bridged:
                    existing_today = [
                        a for a in garmin_state.get('today_activities', [])
                        if str(a.get('date', '')).startswith(today_str) and not _is_synthetic_bridge(a)
                    ]
                    if not existing_today:
                        garmin_state['today_activities'] = today_bridged
                    else:
                        garmin_state['today_activities'] = existing_today
                else:
                    # In the else branch, garmin_state['today_activities'] must ONLY keep activities from today_str
                    garmin_state['today_activities'] = [
                        a for a in garmin_state.get('today_activities', [])
                        if str(a.get('date', '')).startswith(today_str) and not _is_synthetic_bridge(a)
                    ]

                if bridged_acts:
                    existing_recent = [
                        a for a in garmin_state.get('recent_activities', [])
                        if not _is_synthetic_bridge(a)
                    ]
                    existing_today_non_bridge = [
                        a for a in garmin_state.get('today_activities', [])
                        if not _is_synthetic_bridge(a)
                    ]
                    existing_dates = (
                        {str(a.get('date', ''))[:10] for a in existing_recent}
                        | {str(a.get('date', ''))[:10] for a in existing_today_non_bridge}
                    )
                    merged_recent = list(existing_recent)
                    existing_ids = {str(a.get('id')) for a in merged_recent}
                    for ta in existing_today_non_bridge:
                        if str(ta.get('id')) not in existing_ids:
                            merged_recent.append(ta)
                            existing_ids.add(str(ta.get('id')))
                    for ba in bridged_acts:
                        b_date = str(ba.get('date', ''))[:10]
                        # Only insert bridged activities for dates where direct OAuth hasn't already provided activities
                        if b_date not in existing_dates:
                            merged_recent.append(ba)
                    merged_recent.sort(key=lambda x: str(x.get('date', '')), reverse=True)
                    garmin_state['recent_activities'] = merged_recent

        today_str = target_date_str or uk_today_str()
        db_water_l = 0.0
        if db is not None:
            try:
                db_water_l = round(db.get_hydration_total(today_str) / 1000.0, 2)
            except Exception:
                db_water_l = 0.0
        merged_water_l = round(max(float(totals.get('water') or 0.0), db_water_l), 2)

        mnd_payload = {
            'calories': totals['calories'],
            'protein_g': totals['protein'],
            'carbs_g': totals['carbs'],
            'fat_g': totals['fat'],
            'fiber_g': totals.get('fiber', 0),
            'sodium_mg': totals.get('sodium', 0),
            'water_l': merged_water_l,
            'sugar_g': totals.get('sugar_g', 0.0),
            'sat_fat_g': totals.get('sat_fat_g', 0.0),
            'last_pulled': uk_now().isoformat(),
            'source': 'live_mynetdiary_cloud'
        }
        garmin_state['mnd_logged'] = dict(mnd_payload)
        state['mnd_logged'] = dict(mnd_payload)
        state['mnd_meals'] = meals
        if history_summary:
            state['mnd_history'] = history_summary

        # Update Renpho scale weight from weight_info
        today_str = target_date_str or uk_today_str()
        existing_renpho = state.get('renpho', {})
        existing_date = str(existing_renpho.get('last_synced', ''))[:10]
        is_direct_renpho = existing_renpho.get('source') == 'renpho_direct_cloud'

        # Check if weight_info has today's weigh-in
        last_weigh_in_stmt = str(weight_info.get('lastWeighInStatement', '')).lower() if weight_info else ''
        bmi_expl = str(weight_info.get('bmiExplanation', '')) if weight_info else ''

        # Match target_date_str (YYYY-MM-DD) or day-month formats (e.g. "16 Nov", "Nov 16", "16.11", "11/16")
        target_day_month = ''
        try:
            target_dt = datetime.strptime(today_str, '%Y-%m-%d')
            d_num = str(target_dt.day)
            b_month = target_dt.strftime('%b')  # e.g. "Nov"
            target_day_month_regex = rf'\b(?:{d_num}\s+{b_month}|{b_month}\s+{d_num})\b'
        except Exception:
            target_day_month_regex = r'$^'

        has_target_date_in_expl = bool(today_str in bmi_expl or (target_day_month_regex and re.search(target_day_month_regex, bmi_expl, re.IGNORECASE)))
        is_today_weighin = ('today' in last_weigh_in_stmt) or has_target_date_in_expl

        is_manual_entry_today = (existing_renpho.get('source') == 'manual_scale_entry' and existing_date == today_str)

        can_update_weight = (
            bool(weight_info and weight_info.get('currentWeight'))
            and (not is_direct_renpho or (is_today_weighin and existing_date < today_str))
            and not is_manual_entry_today
        )

        if can_update_weight:
            raw_w = weight_info.get('currentWeight')
            kg = None
            expl = weight_info.get('bmiExplanation', '')
            m = re.search(r'W\s*=\s*([0-9\.]+)\s*kg', expl)
            if m:
                try:
                    kg = float(m.group(1))
                except Exception:
                    pass
            if kg is None:
                try:
                    num_w = float(raw_w)
                    unit_hint = str(
                        weight_info.get('weightUnit')
                        or weight_info.get('unit')
                        or ''
                    ).lower()
                    is_imperial = (
                        'lb' in unit_hint
                        or 'lb' in last_weigh_in_stmt
                        or 'lb' in expl.lower()
                        or num_w > 140.0
                    )
                    kg = round(num_w * 0.45359237, 2) if is_imperial else round(num_w, 2)
                except Exception:
                    kg = 97.70

            lbm = state.get('athlete', {}).get('lean_mass_kg', existing_renpho.get('lean_mass_kg', 80.99))
            target_wt_15 = round(lbm / (1.0 - 0.15), 2)
            fat_to_lose = round(max(0, kg - target_wt_15), 2)

            renpho = state.setdefault('renpho', {})
            # Preserve existing Renpho bio-impedance metrics if available
            for field in [
                'body_fat_pct', 'water_pct', 'muscle_mass_kg', 'bone_mass_kg',
                'visceral_fat', 'subcutaneous_fat_pct', 'protein_pct', 'bmr', 'body_age'
            ]:
                if field in existing_renpho:
                    renpho[field] = existing_renpho[field]

            renpho['weight_kg'] = kg
            renpho['lean_mass_kg'] = lbm
            renpho['fat_to_lose_kg'] = fat_to_lose
            renpho['target_weight_at_15pct'] = target_wt_15
            renpho['source'] = 'live_mynetdiary_weight'
            renpho['last_synced'] = uk_now().strftime('%Y-%m-%d %H:%M:%S')

            athlete = state.setdefault('athlete', {})
            athlete['weight_kg'] = kg
            athlete['lean_mass_kg'] = lbm
            athlete['target_weight_kg'] = target_wt_15
            athlete['fat_to_lose_kg'] = fat_to_lose

        # Autoregulation & Runway expansion recalculation
        nutrition = state.setdefault('nutrition', {})
        baseline_budget = 2092
        active_burn = garmin_state.get('active_calories', 0)
        nutrition['calorie_target'] = baseline_budget + active_burn
        nutrition['calories_remaining'] = nutrition['calorie_target'] - totals['calories']
        nutrition['remaining_calories'] = nutrition['calories_remaining']
        nutrition['protein_target_g'] = 200
        nutrition['protein_remaining'] = max(0, 200 - totals['protein'])
        nutrition['remaining_protein_g'] = nutrition['protein_remaining']
        nutrition['protein_achieved_pct'] = round((totals['protein'] / 200.0) * 100, 1)

        mirrors = []
        if ARTIFACT_LIVE_STATE_PATH and ARTIFACT_LIVE_STATE_PATH != LIVE_STATE_PATH:
            mirrors.append(ARTIFACT_LIVE_STATE_PATH)
        state_store.save_live_state(state, LIVE_STATE_PATH, mirror_paths=mirrors)

        return state

    def get_status(self):
        creds = self.get_credentials()
        has_cookies = os.path.exists(COOKIES_FILE)
        masked_user = None
        if creds and creds.get('username'):
            raw_u = str(creds['username'])
            if '@' in raw_u:
                local, domain = raw_u.split('@', 1)
                masked_user = f"{local[:1]}***@{domain}" if local else f"***@{domain}"
            else:
                masked_user = f"{raw_u[:1]}***" if raw_u else None
        return {
            'configured': creds is not None,
            'username': masked_user,
            'has_cached_session': has_cookies,
            'last_updated': creds.get('updated_at') if creds else None
        }
