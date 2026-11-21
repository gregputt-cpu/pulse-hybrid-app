import os
import re
import copy
import json
import math
import time
import hashlib
import tempfile
import threading
import requests
from collections import Counter
from contextlib import closing
from typing import Any
from datetime import datetime, date, timedelta
from benefits_engine import PhysiologicalBenefitsEngine
import analytics_service
import state_store
import time_utils
from time_utils import UK_TZ, uk_now, uk_today_str
try:
    import db
except Exception:
    db = None

_DATA_DIR = state_store.get_data_dir()
if 'MND_TOKEN_DIR' in os.environ and os.environ['MND_TOKEN_DIR'].strip():
    MND_DIR = os.environ['MND_TOKEN_DIR'].strip()
else:
    MND_DIR = os.path.join(_DATA_DIR, 'mnd_tokens')

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
        self._sync_lock = threading.RLock()
        self._history_backfill_lock = threading.Lock()
        self._session_lock = threading.RLock()
        self._history_cache_lock = threading.Lock()
        self._last_backfill_ts = 0.0
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
            return {'username': env_u, 'password': env_p, 'updated_at': None}
        if os.path.exists(CREDS_FILE):
            try:
                with open(CREDS_FILE, 'r', encoding='utf-8') as f:
                    creds = json.load(f)
                if isinstance(creds, dict) and creds.get('username') and creds.get('password'):
                    return {
                        'username': creds['username'],
                        'password': creds['password'],
                        'updated_at': creds.get('updated_at'),
                    }
            except Exception:
                pass
        return None

    def save_credentials(self, username, password):
        creds = {
            'username': username,
            'password': password,
            'updated_at': uk_now().isoformat()
        }
        tmp_path = None
        try:
            os.makedirs(MND_DIR, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                dir=MND_DIR,
                prefix='.credentials.',
                suffix='.tmp',
                delete=False,
            ) as tmp:
                tmp_path = tmp.name
                json.dump(creds, tmp, indent=2)
                tmp.flush()
                os.fsync(tmp.fileno())
            try:
                os.chmod(tmp_path, 0o600)
            except OSError:
                pass
            os.replace(tmp_path, CREDS_FILE)
            tmp_path = None
        except Exception:
            pass
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    def _copy_cookies_to_session(self, target_session):
        with self._session_lock:
            for c in list(self.session.cookies):
                target_session.cookies.set(
                    c.name,
                    c.value,
                    domain=c.domain,
                    path=c.path,
                    secure=c.secure,
                    expires=c.expires,
                )

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
            with self._session_lock:
                resp = self.session.post(url, json=payload, headers=headers, timeout=15)
                if resp.status_code != 200:
                    return {
                        'success': False,
                        'error': f'MyNetDiary returned HTTP {resp.status_code}.'
                    }
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

    def _extract_garmin_bridge_data(self, dash_data, exercises_ByDate, target_date_str, raw_exercise_items=None, weight_kg=None):
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
                        "Cardio", sub_title, item['duration_min'], item['calories'], avg_hr, max_hr, aerobic_te, anaerobic_te, weight_kg=weight_kg
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
                        "Walking", s_sub, 45.0, step_cals, 92, 118, 0.8, 0.0, weight_kg=weight_kg
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
                        "Cardio", w_sub, w_dur, workout_cals, w_avg_hr, w_max_hr, w_aero, w_anaero, weight_kg=weight_kg
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
                            "Walking", s_sub, s_dur, s_cals, 92, 118, 0.8, 0.0, weight_kg=weight_kg
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
                        "Walking", sub_title, d_active_mins or 35.0, d_active_cals, avg_hr, max_hr, aerobic_te, anaerobic_te, weight_kg=weight_kg
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

    def _load_history_cache(self, include_live_state=True):
        cache = {}
        with self._history_cache_lock:
            if os.path.exists(HISTORY_CACHE_FILE):
                try:
                    with open(HISTORY_CACHE_FILE, 'r', encoding='utf-8') as f:
                        loaded = json.load(f)
                        if isinstance(loaded, dict):
                            cache = loaded
                except Exception as e:
                    print(f"[MNDSync] Warning loading history cache: {e}")

        if include_live_state:
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
            cutoff_90d = (uk_now().date() - timedelta(days=90)).isoformat()
            pruned = {
                k: v for k, v in (cache or {}).items()
                if str(k)[:10] >= cutoff_90d
            }
            with self._history_cache_lock:
                os.makedirs(MND_DIR, exist_ok=True)
                state_store._atomic_write_json(HISTORY_CACHE_FILE, pruned)
        except Exception as e:
            print(f"[MNDSync] Warning saving history cache: {e}")

    def _build_day_summary(self, date_str, totals, meals):
        t = totals if isinstance(totals, dict) else {}
        return {
            "date": date_str,
            "calories": int(round(float(t.get("calories", 0) or 0))),
            "protein": int(round(float(t.get("protein") if t.get("protein") is not None else t.get("protein_g", 0) or 0))),
            "carbs": int(round(float(t.get("carbs") if t.get("carbs") is not None else t.get("carbs_g", 0) or 0))),
            "fat": int(round(float(t.get("fat") if t.get("fat") is not None else t.get("fat_g", 0) or 0))),
            "fiber": int(round(float(t.get("fiber") if t.get("fiber") is not None else t.get("fiber_g", 0) or 0))),
            "sodium": int(round(float(t.get("sodium") if t.get("sodium") is not None else t.get("sodium_mg", 0) or 0))),
            "sugar_g": float(t.get("sugar_g", 0.0) or 0.0),
            "sat_fat_g": float(t.get("sat_fat_g", 0.0) or 0.0),
            "fetched_at_ts": time.time(),
            "items": [
                {
                    "name": it.get("name", ""),
                    "cals": int(it.get("cals", 0) or 0),
                    "p": int(it.get("p", 0) or 0),
                    "c": int(it.get("c", 0) or 0),
                    "f": int(it.get("f", 0) or 0),
                }
                for m in (meals or {}).values()
                if isinstance(m, dict)
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

    def fetch_multi_day_history(self, end_date_str=None, days=14, skip_refresh_dates=None, force=False):
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
        now_ts = time.time()
        should_refresh = force or not self._last_backfill_ts or (now_ts - self._last_backfill_ts) >= 7200

        if should_refresh:
            skip_set = set(skip_refresh_dates or [])
            headers = dict(DEFAULT_HEADERS)
            headers['Referer'] = 'https://www.mynetdiary.com/daily.do'
            meals_url = 'https://www.mynetdiary.com/muiGetMeals.do'
            cache_dirty = False
            auth_aborted = False

            local_session = requests.Session()
            local_session.headers.update(DEFAULT_HEADERS)
            self._copy_cookies_to_session(local_session)

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
                is_zero_cached = (
                    d_str < today_str
                    and isinstance(cached_day, dict)
                    and (cached_day.get('calories') or 0) == 0
                    and cached_day.get('fetched_at_ts') is not None
                    and (now_ts - float(cached_day.get('fetched_at_ts') or 0)) < 43200
                )
                if is_past_cached or is_zero_cached:
                    continue

                try:
                    resp = local_session.get(meals_url, params={'date': d_str}, headers=headers, timeout=8)
                    if resp.status_code != 200:
                        continue
                    r_json = resp.json()
                    if isinstance(r_json, dict) and r_json.get('needLogon'):
                        authed, _ = self.ensure_authenticated()
                        if authed:
                            self._copy_cookies_to_session(local_session)
                            resp = local_session.get(meals_url, params={'date': d_str}, headers=headers, timeout=8)
                            if resp.status_code != 200:
                                continue
                            r_json = resp.json()
                        else:
                            auth_aborted = True
                            break
                    if not r_json or (isinstance(r_json, dict) and r_json.get('needLogon')):
                        auth_aborted = True
                        break

                    d_totals, d_meals = self._parse_mnd_response(r_json, {})
                    cache[d_str] = self._build_day_summary(d_str, d_totals, d_meals)
                    cache_dirty = True
                except Exception as e:
                    print(f"[MNDSync] History fetch warning for {d_str}: {e}")

            if cache_dirty:
                self._save_history_cache(cache)
            if not auth_aborted:
                self._last_backfill_ts = time.time()

        logged_days = [
            cache[d_str]
            for d_str in window_dates
            if isinstance(cache.get(d_str), dict) and (cache[d_str].get('calories') or 0) > 0
        ]

        if db is not None:
            for d_rec in logged_days:
                if d_rec.get("date") == today_str:
                    continue
                try:
                    db.upsert_daily_nutrition(
                        d_rec["date"],
                        int(d_rec.get("calories") or 0),
                        int(d_rec.get("protein") or 0),
                        int(d_rec.get("carbs") or 0),
                        int(round(float(d_rec.get("fat") or 0))),
                        source="mnd",
                        preserve_manual=True,
                    )
                except Exception as dbe:
                    print(f"[MNDSync] DB daily_nutrition backfill warning for {d_rec.get('date')}: {dbe}")

        return {
            "window_days": len(logged_days),
            "start_date": logged_days[0]["date"] if logged_days else end_date_str,
            "end_date": end_date_str,
            "days": logged_days,
            "averages_10d": self._compute_history_averages(logged_days[-10:]),
            "averages_7d": self._compute_history_averages(logged_days[-7:]),
        }

    def fetch_today_data(self, target_date_str=None, force=False):
        with self._sync_lock:
            if not target_date_str:
                target_date_str = uk_today_str()

            meals_url = 'https://www.mynetdiary.com/muiGetMeals.do'
            headers = dict(DEFAULT_HEADERS)
            headers['Referer'] = 'https://www.mynetdiary.com/daily.do'

            params = {'date': target_date_str}
            try:
                with self._session_lock:
                    resp = self.session.get(meals_url, params=params, headers=headers, timeout=15)
                if resp.status_code != 200:
                    return {'success': False, 'error': f'MND HTTP {resp.status_code}'}
                data = resp.json()
            except Exception as e:
                return {'success': False, 'error': f'Request failed: {str(e)}'}

            if not data or (isinstance(data, dict) and data.get('needLogon')):
                authed, err = self.ensure_authenticated()
                if not authed:
                    return {'success': False, 'requires_auth': True, 'error': err}
                try:
                    with self._session_lock:
                        resp = self.session.get(meals_url, params=params, headers=headers, timeout=15)
                    if resp.status_code != 200:
                        return {'success': False, 'error': f'MND HTTP {resp.status_code} after relogin'}
                    data = resp.json()
                except Exception as e:
                    return {'success': False, 'error': f'Request failed after relogin: {str(e)}'}
                if not data or (isinstance(data, dict) and data.get('needLogon')):
                    return {'success': False, 'requires_auth': True, 'error': 'MyNetDiary session still requires login after re-authentication'}

            with self._session_lock:
                self._save_cookies()

            analysis_data = {}
            try:
                analysis_url = 'https://www.mynetdiary.com/muiGetDailyAnalysis.do'
                with self._session_lock:
                    a_resp = self.session.get(analysis_url, params={'date': target_date_str}, headers=headers, timeout=10)
                if a_resp.status_code == 200:
                    parsed_analysis = a_resp.json()
                    if isinstance(parsed_analysis, dict):
                        analysis_data = parsed_analysis
            except Exception as e:
                print(f"[MNDSync] Warning fetching analysis: {e}")

            dash_data = {}
            exercises_by_date = {}
            raw_exercise_items = []
            try:
                with self._session_lock:
                    dash_resp = self.session.get('https://www.mynetdiary.com/muiGetDashboard.do', params={'date': target_date_str}, headers=headers, timeout=12)
                    ex_resp = self.session.get('https://www.mynetdiary.com/muiGetExercises.do', params={'date': target_date_str}, headers=headers, timeout=10)
                if dash_resp.status_code == 200:
                    dash_data = dash_resp.json()
                if ex_resp.status_code == 200:
                    ex_json = ex_resp.json()
                    if isinstance(ex_json, dict):
                        raw_exercise_items = [item for item in ex_json.get('list', []) if isinstance(item, dict)]
                        notes_list = [str(item.get('notes', '')) for item in raw_exercise_items]
                        exercises_by_date[target_date_str] = " | ".join(notes_list)
            except Exception as e:
                print(f"[MNDSync] Warning fetching dashboard/exercises bridge: {e}")

            pre_snap = state_store.load_live_state(LIVE_STATE_PATH)
            live_weight_kg = analytics_service._finite_float(
                (pre_snap.get('athlete') or {}).get('weight_kg')
                or (pre_snap.get('renpho') or {}).get('weight_kg')
            )
            if live_weight_kg is not None and live_weight_kg <= 0:
                live_weight_kg = None

            garmin_bridge = self._extract_garmin_bridge_data(
                dash_data,
                exercises_by_date,
                target_date_str,
                raw_exercise_items,
                weight_kg=live_weight_kg,
            )
            totals, meals = self._parse_mnd_response(data, analysis_data)
            weight_info = analysis_data.get('weightInfo') if isinstance(analysis_data, dict) else None

            state = self._update_live_state(
                totals,
                meals,
                weight_info,
                garmin_bridge,
                target_date_str,
                history_summary=None,
                force=force,
            )

            history_summary = None
            try:
                merged_ml = state.get('mnd_logged') if isinstance(state.get('mnd_logged'), dict) else totals
                merged_meals = state.get('mnd_meals') if isinstance(state.get('mnd_meals'), dict) else meals

                cache = self._load_history_cache()
                cache[target_date_str] = self._build_day_summary(target_date_str, merged_ml, merged_meals)
                self._save_history_cache(cache)

                try:
                    end_dt = datetime.strptime(target_date_str, '%Y-%m-%d').date()
                except Exception:
                    end_dt = uk_now().date()
                window_dates = [
                    (end_dt - timedelta(days=offset)).isoformat()
                    for offset in range(13, -1, -1)
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
                    "averages_10d": self._compute_history_averages(logged_days[-10:]),
                    "averages_7d": self._compute_history_averages(logged_days[-7:]),
                }
                with state_store.state_lock(LIVE_STATE_PATH):
                    st = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)
                    st['mnd_history'] = history_summary
                    state_store.save_live_state(st, LIVE_STATE_PATH)
                    state = st
                self._schedule_history_backfill(target_date_str, days=14)
            except Exception as e:
                print(f"[MNDSync] Warning building multi-day history: {e}")

            return {
                'success': True,
                'date': target_date_str,
                'totals': state['mnd_logged'] if isinstance(state.get('mnd_logged'), dict) else totals,
                'meals': state.get('mnd_meals', meals),
                'garmin_bridge': garmin_bridge,
                'weight_info': weight_info,
                'history': history_summary,
                'live_state': state
            }

    def _schedule_history_backfill(self, target_date_str, days=14, force=False):
        if not force and self._last_backfill_ts and (time.time() - self._last_backfill_ts) < 7200:
            return
        lock = getattr(self, '_history_backfill_lock', None)
        if lock is None:
            lock = threading.Lock()
            self._history_backfill_lock = lock
        if not lock.acquire(blocking=False):
            return

        def _worker():
            try:
                summary = self.fetch_multi_day_history(
                    target_date_str, days=days, skip_refresh_dates={target_date_str}, force=force
                )
                if summary:
                    with state_store.state_lock(LIVE_STATE_PATH):
                        st = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)
                        st['mnd_history'] = summary
                        if isinstance(st.get('garmin'), dict):
                            st['garmin'].pop('mnd_history', None)
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

        occ_counter = Counter()
        for m in meal_list:
            if not isinstance(m, dict):
                continue
            cat_id = m.get('mealTypeId') or m.get('type')
            cat_key = category_map.get(cat_id, 'snacks')
            if 'mealTypeName' in m:
                m_name = str(m.get('mealTypeName') or '').lower()
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

                norm_item_name = re.sub(r"\s+", " ", str(name).strip().lower())
                occ_key = (cat_key, norm_item_name, cals, p)
                occ_idx = occ_counter[occ_key]
                occ_counter[occ_key] += 1
                item_id = hashlib.sha1(
                    f"{cat_key}|{norm_item_name}|{cals}|{p}|{occ_idx}".encode("utf-8")
                ).hexdigest()[:12]

                target_meal['items'].append({'id': item_id, 'name': name, 'cals': cals, 'p': p, 'c': c, 'f': f})
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
            apple = meals_data.get('appleData') or {}
            if isinstance(apple, dict) and apple.get('consumedCalories') is not None:
                totals['calories'] = int(apple['consumedCalories'])
            elif isinstance(meals_data.get('dayTotals'), dict) and (meals_data['dayTotals'].get('eaten') or {}).get('value') is not None:
                v = str(meals_data['dayTotals']['eaten']['value']).replace(',', '')
                try:
                    totals['calories'] = int(float(v))
                except Exception:
                    pass
        if isinstance(analysis_data, dict):
            for k in ['totalSodium', 'sodium']:
                if k in analysis_data and analysis_data[k]:
                    totals['sodium'] = round(float(analysis_data[k]))
                    break
            for k in ['water', 'waterAmount']:
                if k in analysis_data and analysis_data[k]:
                    totals['water'] = round(float(analysis_data[k]), 1)
                    break

        return totals, meals

    @staticmethod
    def _normalize_meal_sig(name: str, cals: Any, protein: Any) -> tuple:
        norm = re.sub(r'\s+', ' ', str(name or '').strip().lower())
        return (norm, int(round(float(cals or 0))), int(round(float(protein or 0))))

    def _compose_mnd_with_overlays(self, cloud_totals, cloud_meals, app_logged, app_deleted):
        merged_totals = copy.deepcopy(cloud_totals) if isinstance(cloud_totals, dict) else {}
        merged_meals = copy.deepcopy(cloud_meals) if isinstance(cloud_meals, dict) else {}

        uses_g_keys = 'protein_g' in merged_totals or 'carbs_g' in merged_totals or 'fat_g' in merged_totals
        uses_plain_keys = (not uses_g_keys) or ('protein' in merged_totals)

        def _get_total(plain_k, g_k):
            v = merged_totals.get(g_k) if merged_totals.get(g_k) is not None else merged_totals.get(plain_k)
            try:
                return int(round(float(v or 0)))
            except (TypeError, ValueError):
                return 0

        tot_cals = _get_total('calories', 'calories')
        tot_p = _get_total('protein', 'protein_g')
        tot_c = _get_total('carbs', 'carbs_g')
        tot_f = _get_total('fat', 'fat_g')

        buckets = {}
        occ_counter = Counter()
        for cat in ('breakfast', 'lunch', 'dinner', 'snacks'):
            raw_cat = merged_meals.get(cat)
            if not isinstance(raw_cat, dict):
                raw_cat = {}
            cat_block = {
                'name': raw_cat.get('name') or ('Snacks & Hydration' if cat == 'snacks' else cat.capitalize()),
                'time': raw_cat.get('time') or 'Pending',
                'calories': int(round(float(raw_cat.get('calories') or 0))),
                'protein': int(round(float(raw_cat.get('protein') or 0))),
                'carbs': int(round(float(raw_cat.get('carbs') or 0))),
                'fat': int(round(float(raw_cat.get('fat') or 0))),
                'items': [],
            }
            for it in (raw_cat.get('items') or []):
                if not isinstance(it, dict) or not it.get('name'):
                    continue
                it_copy = dict(it)
                it_cals = int(round(float(it_copy.get('cals') or 0)))
                it_p = int(round(float(it_copy.get('p') or 0)))
                it_c = int(round(float(it_copy.get('c') or 0)))
                it_f = int(round(float(it_copy.get('f') or 0)))
                it_copy['cals'] = it_cals
                it_copy['p'] = it_p
                it_copy['c'] = it_c
                it_copy['f'] = it_f
                norm_n = re.sub(r'\s+', ' ', str(it_copy['name']).strip().lower())
                occ_key = (cat, norm_n, it_cals, it_p)
                occ_idx = occ_counter[occ_key]
                occ_counter[occ_key] += 1
                if not it_copy.get('id'):
                    it_copy['id'] = hashlib.sha1(
                        f"{cat}|{norm_n}|{it_cals}|{it_p}|{occ_idx}".encode('utf-8')
                    ).hexdigest()[:12]
                cat_block['items'].append(it_copy)
            merged_meals[cat] = cat_block
            buckets[cat] = cat_block

        # 1. Apply deletion tombstones against cloud items
        del_list = app_deleted if isinstance(app_deleted, list) else []
        for tombstone in del_list:
            if not isinstance(tombstone, dict):
                continue
            t_id = str(tombstone.get('id') or '').strip()
            t_cat = str(tombstone.get('category') or '').lower()
            raw_sig = tombstone.get('sig')
            if isinstance(raw_sig, (list, tuple)) and len(raw_sig) >= 3:
                t_sig = (
                    re.sub(r'\s+', ' ', str(raw_sig[0] or '').strip().lower()),
                    int(round(float(raw_sig[1] or 0))),
                    int(round(float(raw_sig[2] or 0))),
                )
            elif tombstone.get('name'):
                t_sig = self._normalize_meal_sig(
                    tombstone.get('name', ''),
                    tombstone.get('cals', 0),
                    tombstone.get('p', 0),
                )
            else:
                t_sig = None

            search_cats = ([t_cat] if t_cat in buckets else []) + [c for c in buckets if c != t_cat]
            removed_item = None
            removed_cat = None

            if t_id:
                for sc in search_cats:
                    items = buckets[sc]['items']
                    for idx_it, cand in enumerate(items):
                        if str(cand.get('id') or '') == t_id:
                            removed_item = items.pop(idx_it)
                            removed_cat = buckets[sc]
                            break
                    if removed_item is not None:
                        break

            if removed_item is None and t_sig is not None:
                for sc in search_cats:
                    items = buckets[sc]['items']
                    for idx_it, cand in enumerate(items):
                        if self._normalize_meal_sig(cand.get('name', ''), cand.get('cals', 0), cand.get('p', 0)) == t_sig:
                            removed_item = items.pop(idx_it)
                            removed_cat = buckets[sc]
                            break
                    if removed_item is not None:
                        break

            if removed_item is not None and removed_cat is not None:
                rm_cals = int(round(float(removed_item.get('cals') or 0)))
                rm_p = int(round(float(removed_item.get('p') or 0)))
                rm_c = int(round(float(removed_item.get('c') or 0)))
                rm_f = int(round(float(removed_item.get('f') or 0)))
                removed_cat['calories'] = max(0, int(removed_cat.get('calories') or 0) - rm_cals)
                removed_cat['protein'] = max(0, int(removed_cat.get('protein') or 0) - rm_p)
                removed_cat['carbs'] = max(0, int(removed_cat.get('carbs') or 0) - rm_c)
                removed_cat['fat'] = max(0, int(removed_cat.get('fat') or 0) - rm_f)
                tot_cals = max(0, tot_cals - rm_cals)
                tot_p = max(0, tot_p - rm_p)
                tot_c = max(0, tot_c - rm_c)
                tot_f = max(0, tot_f - rm_f)

        # 2. Collect cross-category cloud item IDs & signatures after deletions
        cloud_ids = set()
        cloud_sigs = Counter()
        for cat in ('breakfast', 'lunch', 'dinner', 'snacks'):
            for it in buckets[cat]['items']:
                if it.get('id'):
                    cloud_ids.add(str(it['id']))
                cloud_sigs[self._normalize_meal_sig(it.get('name', ''), it.get('cals', 0), it.get('p', 0))] += 1

        # 3. Merge app_logged overlays with cross-category deduplication
        add_list = app_logged if isinstance(app_logged, list) else []
        for raw_it in add_list:
            if not isinstance(raw_it, dict) or not raw_it.get('name'):
                continue
            cat = str(raw_it.get('category') or 'snacks').lower()
            if cat not in buckets:
                cat = 'snacks'
            cals = max(0, int(round(float(raw_it.get('cals') or 0))))
            p = max(0, int(round(float(raw_it.get('p') or 0))))
            carb = max(0, int(round(float(raw_it.get('c') or 0))))
            f = max(0, int(round(float(raw_it.get('f') or 0))))
            it_id = str(raw_it.get('id') or '').strip()
            sig = self._normalize_meal_sig(raw_it.get('name', ''), cals, p)

            if (it_id and it_id in cloud_ids) or cloud_sigs[sig] > 0:
                if cloud_sigs[sig] > 0:
                    cloud_sigs[sig] -= 1
                continue

            entry = {
                'name': raw_it.get('name'),
                'cals': cals,
                'p': p,
                'c': carb,
                'f': f,
                'source': 'app_overlay',
            }
            if it_id:
                entry['id'] = it_id
                cloud_ids.add(it_id)
            target_cat = buckets[cat]
            target_cat['items'].append(entry)
            target_cat['calories'] = int(target_cat.get('calories') or 0) + cals
            target_cat['protein'] = int(target_cat.get('protein') or 0) + p
            target_cat['carbs'] = int(target_cat.get('carbs') or 0) + carb
            target_cat['fat'] = int(target_cat.get('fat') or 0) + f
            tot_cals += cals
            tot_p += p
            tot_c += carb
            tot_f += f

        merged_totals['calories'] = tot_cals
        if uses_g_keys:
            merged_totals['protein_g'] = tot_p
            merged_totals['carbs_g'] = tot_c
            merged_totals['fat_g'] = tot_f
        if uses_plain_keys:
            merged_totals['protein'] = tot_p
            merged_totals['carbs'] = tot_c
            merged_totals['fat'] = tot_f

        return merged_totals, merged_meals

    def _merge_app_logged_meals(self, state, totals, meals, today_str: str):
        app_logged = state.get('app_logged_meals')
        app_deleted = state.get('app_deleted_meals')
        try:
            today_dt = datetime.strptime(today_str, '%Y-%m-%d').date()
            yesterday_str = (today_dt - timedelta(days=1)).isoformat()
        except Exception:
            yesterday_str = today_str

        if isinstance(app_logged, dict):
            for d_key in list(app_logged.keys()):
                if str(d_key) < yesterday_str:
                    app_logged.pop(d_key, None)
        if isinstance(app_deleted, dict):
            for d_key in list(app_deleted.keys()):
                if str(d_key) < yesterday_str:
                    app_deleted.pop(d_key, None)

        overlay_items = app_logged.get(today_str, []) if isinstance(app_logged, dict) else []
        delete_items = app_deleted.get(today_str, []) if isinstance(app_deleted, dict) else []
        if not overlay_items and not delete_items:
            return copy.deepcopy(totals) if isinstance(totals, dict) else {}, copy.deepcopy(meals) if isinstance(meals, dict) else {}
        return self._compose_mnd_with_overlays(totals, meals, overlay_items, delete_items)

    def _update_live_state(self, totals, meals, weight_info=None, garmin_bridge=None, target_date_str=None, history_summary=None, force=False):
        with state_store.state_lock(LIVE_STATE_PATH):
            return self._update_live_state_locked(
                totals,
                meals,
                weight_info=weight_info,
                garmin_bridge=garmin_bridge,
                target_date_str=target_date_str,
                history_summary=history_summary,
                force=force,
            )

    def _update_live_state_locked(self, totals, meals, weight_info=None, garmin_bridge=None, target_date_str=None, history_summary=None, force=False):
        state = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)

        now_iso = uk_now().isoformat()
        prev_date = state.get('date')
        today_str = target_date_str or uk_today_str()
        if target_date_str:
            state['date'] = target_date_str
        state['last_synced'] = now_iso
        state['mnd_last_synced'] = now_iso

        garmin_state = state.setdefault('garmin', {})
        has_live_garmin_oauth = (
            garmin_state.get('source') == 'garmin_oauth'
            and garmin_state.get('oauth_date') == today_str
        )
        retained_manuals = [
            a for a in (garmin_state.get('today_activities') or [])
            if isinstance(a, dict) and a.get('source') == 'manual_app_entry' and str(a.get('date', '')).startswith(today_str)
        ]

        prev_garmin_date = garmin_state.get('metrics_date') or garmin_state.get('oauth_date') or prev_date
        if prev_garmin_date and prev_garmin_date != today_str and not has_live_garmin_oauth:
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
                            source=garmin_state.get('garmin_sync_mode') or 'mnd_rollover',
                        )
                except Exception as dbe:
                    print(f"[MNDSync] Warning saving rollover biometrics: {dbe}")
            for stale_key in (
                'sleep_score', 'sleep_duration', 'sleep_score_source',
                'body_battery', 'training_readiness', 'readiness_level',
                'readiness_feedback', 'today_activities', 'active_calories',
                'workout_calories', 'steps', 'stress_avg', 'hrv_last_night',
                'distance_miles', 'active_minutes', 'resting_hr', 'body_battery_debug',
                'mnd_logged', 'mnd_meals',
            ):
                garmin_state.pop(stale_key, None)

        if prev_date and prev_date != today_str:
            for stale_root_key in ('mnd_logged', 'mnd_meals', 'mnd_cloud_logged', 'mnd_cloud_meals'):
                existing_root = state.get(stale_root_key)
                if isinstance(existing_root, dict) and existing_root.get('date') == today_str:
                    continue
                state.pop(stale_root_key, None)
            del_map = state.get('app_deleted_meals')
            if isinstance(del_map, dict):
                kept_del = {k: v for k, v in del_map.items() if str(k) >= today_str}
                if kept_del:
                    state['app_deleted_meals'] = kept_del
                else:
                    state.pop('app_deleted_meals', None)
            else:
                state.pop('app_deleted_meals', None)

        # Apply live Garmin bridge metrics from MyNetDiary ONLY when direct Garmin OAuth is not active for today
        if garmin_bridge:
            if not has_live_garmin_oauth:
                garmin_state['garmin_sync_mode'] = 'mnd_bridge'
                garmin_state['metrics_date'] = today_str
                garmin_state['last_synced'] = now_iso
                garmin_state['bridge_last_synced'] = now_iso

                if garmin_bridge.get('steps') is not None:
                    b_steps = int(garmin_bridge['steps'])
                    if b_steps > 0 or not garmin_state.get('steps'):
                        garmin_state['steps'] = b_steps

                manual_today_burn = sum(int(round(float(a.get('calories') or 0))) for a in retained_manuals)
                existing_watch_cals = max(
                    0,
                    int(round(float(garmin_state.get('active_calories') or 0))) - manual_today_burn,
                )
                bridge_active = garmin_bridge.get('active_calories')
                if bridge_active is not None:
                    b_act = int(bridge_active)
                    watch_base = b_act if (b_act > 0 or existing_watch_cals == 0) else existing_watch_cals
                    garmin_state['active_calories'] = watch_base + manual_today_burn
                elif manual_today_burn > 0 and garmin_state.get('active_calories') is None:
                    garmin_state['active_calories'] = manual_today_burn

                if garmin_bridge.get('distance_miles') is not None:
                    b_dist = float(garmin_bridge['distance_miles'])
                    if b_dist > 0 or not garmin_state.get('distance_miles'):
                        garmin_state['distance_miles'] = b_dist
                if garmin_bridge.get('active_minutes') is not None:
                    b_mins = int(garmin_bridge['active_minutes'])
                    if b_mins > 0 or not garmin_state.get('active_minutes'):
                        garmin_state['active_minutes'] = b_mins
                if garmin_bridge.get('sleep_duration') and not garmin_state.get('sleep_duration'):
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
                ][:100]
            else:
                existing_today = [
                    a for a in garmin_state.get('today_activities', [])
                    if str(a.get('date', '')).startswith(today_str) and not _is_synthetic_bridge(a)
                ]
                seen_today_ids = {str(a.get('id')) for a in existing_today}
                for rm in retained_manuals:
                    if str(rm.get('id')) not in seen_today_ids:
                        existing_today.append(rm)
                        seen_today_ids.add(str(rm.get('id')))
                if today_bridged:
                    garmin_state['today_activities'] = existing_today if existing_today else today_bridged
                else:
                    garmin_state['today_activities'] = existing_today

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
                        if b_date not in existing_dates:
                            merged_recent.append(ba)
                    merged_recent.sort(key=lambda x: str(x.get('date', '')), reverse=True)
                    garmin_state['recent_activities'] = merged_recent[:100]

        if db is not None:
            try:
                if any(
                    garmin_state.get(k) is not None
                    for k in ('sleep_score', 'resting_hr', 'body_battery', 'training_readiness')
                ):
                    bio_src = (
                        (garmin_state.get('garmin_sync_mode') or garmin_state.get('source') or 'garmin_oauth')
                        if has_live_garmin_oauth
                        else 'mnd_estimated'
                    )
                    db.upsert_daily_biometrics(
                        today_str,
                        sleep_score=garmin_state.get('sleep_score'),
                        resting_hr=garmin_state.get('resting_hr'),
                        body_battery=garmin_state.get('body_battery'),
                        training_readiness=garmin_state.get('training_readiness'),
                        source=bio_src,
                    )
            except Exception as dbe:
                print(f"[MNDSync] Failed saving daily_biometrics: {dbe}")

        db_water_l = 0.0
        existing_nut_source = None
        if db is not None:
            try:
                db_water_l = round(db.get_hydration_total(today_str) / 1000.0, 2)
            except Exception:
                db_water_l = 0.0
            try:
                with closing(db.get_connection()) as conn:
                    nut_row = conn.execute(
                        "SELECT source FROM daily_nutrition_logs WHERE date_str = ?",
                        (today_str,),
                    ).fetchone()
                    if nut_row is not None:
                        existing_nut_source = nut_row["source"]
            except Exception:
                existing_nut_source = None

        cloud_water_l = round(float(totals.get('water') or 0.0), 2) if isinstance(totals, dict) else 0.0
        raw_cloud_logged = {
            'date': today_str,
            'calories': int(round(float((totals or {}).get('calories') or 0))),
            'protein_g': int(round(float((totals or {}).get('protein') or 0))),
            'carbs_g': int(round(float((totals or {}).get('carbs') or 0))),
            'fat_g': int(round(float((totals or {}).get('fat') or 0))),
            'fiber_g': int(round(float((totals or {}).get('fiber') or 0))),
            'sodium_mg': int(round(float((totals or {}).get('sodium') or 0))),
            'water_l': cloud_water_l,
            'sugar_g': float((totals or {}).get('sugar_g') or 0.0),
            'sat_fat_g': float((totals or {}).get('sat_fat_g') or 0.0),
            'last_pulled': now_iso,
            'source': 'live_mynetdiary_cloud',
        }
        _, normalized_cloud_meals = self._compose_mnd_with_overlays(raw_cloud_logged, meals, [], [])
        state['mnd_cloud_logged'] = copy.deepcopy(raw_cloud_logged)
        state['mnd_cloud_meals'] = copy.deepcopy(normalized_cloud_meals)

        composed_totals, composed_meals = self._merge_app_logged_meals(state, totals, meals, today_str)
        prev_ml = state.get('mnd_logged') if isinstance(state.get('mnd_logged'), dict) else {}
        prev_ml_date = str(prev_ml.get('date') or '')
        is_manual_locked_today = (
            existing_nut_source == 'manual'
            and prev_ml.get('calories') is not None
            and (not prev_ml_date or prev_ml_date == today_str)
        )
        manual_nutrition_water_l = float(prev_ml.get('water_l') or 0.0) if is_manual_locked_today else 0.0
        merged_water_l = round(
            max(float(composed_totals.get('water') or 0.0), db_water_l, manual_nutrition_water_l),
            2,
        )

        has_active_overlays = bool(
            (isinstance(state.get('app_logged_meals'), dict) and state['app_logged_meals'].get(today_str))
            or (isinstance(state.get('app_deleted_meals'), dict) and state['app_deleted_meals'].get(today_str))
        )

        if not force and is_manual_locked_today:
            preserved_ml = dict(prev_ml)
            preserved_ml['date'] = today_str
            preserved_ml['water_l'] = merged_water_l
            garmin_state['mnd_logged'] = dict(preserved_ml)
            state['mnd_logged'] = dict(preserved_ml)
            if isinstance(state.get('mnd_meals'), dict):
                garmin_state['mnd_meals'] = state['mnd_meals']
        else:
            mnd_payload = {
                'date': today_str,
                'calories': int(composed_totals.get('calories') or 0),
                'protein_g': int(composed_totals.get('protein') or 0),
                'carbs_g': int(composed_totals.get('carbs') or 0),
                'fat_g': int(composed_totals.get('fat') or 0),
                'fiber_g': int(composed_totals.get('fiber') or 0),
                'sodium_mg': int(composed_totals.get('sodium') or 0),
                'water_l': merged_water_l,
                'sugar_g': composed_totals.get('sugar_g', 0.0),
                'sat_fat_g': composed_totals.get('sat_fat_g', 0.0),
                'last_pulled': state.get('mnd_last_synced') or now_iso,
                'source': 'mnd_overlay' if has_active_overlays else 'live_mynetdiary_cloud',
            }
            garmin_state['mnd_logged'] = dict(mnd_payload)
            state['mnd_logged'] = dict(mnd_payload)
            state['mnd_meals'] = composed_meals
            garmin_state['mnd_meals'] = composed_meals

        if history_summary:
            state['mnd_history'] = history_summary

        effective_ml = state.get('mnd_logged') or {}
        if db is not None and (effective_ml.get('calories') or 0) > 0:
            try:
                db.upsert_daily_nutrition(
                    today_str,
                    int(effective_ml.get('calories') or 0),
                    int(effective_ml.get('protein_g') or 0),
                    int(effective_ml.get('carbs_g') or 0),
                    int(round(float(effective_ml.get('fat_g') or 0))),
                    source='mnd_overlay' if has_active_overlays else 'mnd',
                    preserve_manual=True,
                )
            except Exception as dbe:
                print(f"[MNDSync] Failed saving today daily_nutrition: {dbe}")

        # Update Renpho scale weight from weight_info under 3-way precedence rules (undated MND weights never write)
        existing_renpho = state.get('renpho', {}) if isinstance(state.get('renpho'), dict) else {}
        existing_weight_ts = existing_renpho.get('weight_synced_at') or existing_renpho.get('last_synced')
        existing_dt = time_utils.parse_uk_ts(existing_weight_ts)
        existing_weight_date = existing_dt.date().isoformat() if existing_dt else str(existing_weight_ts or '')[:10]
        existing_weight_src = existing_renpho.get('weight_source') or existing_renpho.get('source') or ''
        is_protected_source = existing_weight_src in ('renpho_direct_cloud', 'manual_scale_entry')

        last_weigh_in_stmt = str(weight_info.get('lastWeighInStatement', '')).lower() if isinstance(weight_info, dict) else ''
        bmi_expl = str(weight_info.get('bmiExplanation', '')) if isinstance(weight_info, dict) else ''

        try:
            target_dt = datetime.strptime(today_str, '%Y-%m-%d')
            d_num = str(target_dt.day)
            b_month = target_dt.strftime('%b')
            target_day_month_regex = rf'(?:^|\D)0?{d_num}\s+{b_month}(?:\D|$)|(?:^|\D){b_month}\s+0?{d_num}(?:\D|$)'
        except Exception:
            target_day_month_regex = r'$^'

        has_target_date_in_expl = bool(today_str in bmi_expl or (target_day_month_regex and re.search(target_day_month_regex, bmi_expl, re.IGNORECASE)))
        is_today_weighin = ('today' in last_weigh_in_stmt) or has_target_date_in_expl

        can_update_weight = (
            bool(isinstance(weight_info, dict) and weight_info.get('currentWeight') is not None)
            and is_today_weighin
            and (
                not existing_weight_date
                or existing_weight_date < today_str
                or (not is_protected_source and existing_weight_date <= today_str)
            )
        )

        if can_update_weight:
            raw_w = weight_info.get('currentWeight')
            kg = None
            expl = weight_info.get('bmiExplanation', '') or ''
            m = re.search(r'W\s*=\s*([0-9\.]+)\s*kg', expl)
            if m:
                try:
                    cand_kg = float(m.group(1))
                    if math.isfinite(cand_kg) and 20.0 < cand_kg < 300.0:
                        kg = round(cand_kg, 2)
                except Exception:
                    kg = None
            if kg is None and not isinstance(raw_w, bool):
                try:
                    num_w = float(raw_w)
                    if math.isfinite(num_w) and num_w > 0:
                        unit_hint = str(weight_info.get('weightUnit') or weight_info.get('unit') or '')
                        imperial_ctx = f"{unit_hint} {last_weigh_in_stmt} {expl}"
                        is_imperial = bool(re.search(r'\b(lb|lbs|pounds?)\b', imperial_ctx, re.IGNORECASE))
                        cand_kg = round(num_w * 0.45359237, 2) if is_imperial else round(num_w, 2)
                        if 20.0 < cand_kg < 300.0:
                            kg = cand_kg
                except Exception:
                    kg = None

            if kg is not None:
                existing_lbm = existing_renpho.get('lean_mass_kg')
                if existing_lbm is None:
                    existing_lbm = (state.get('athlete') or {}).get('lean_mass_kg')
                comp = analytics_service.compute_composition_from_weight(kg, existing_lbm=existing_lbm)
                scale_ts = uk_now().strftime('%Y-%m-%d %H:%M:%S')

                renpho = state.setdefault('renpho', {})
                for field in (
                    'water_pct', 'muscle_mass_kg', 'skeletal_muscle_pct', 'bone_mass_kg',
                    'visceral_fat', 'subcutaneous_fat_pct', 'bmi', 'protein_pct', 'bmr',
                    'body_age', 'bio_synced_at',
                ):
                    if field in existing_renpho:
                        renpho[field] = existing_renpho[field]

                renpho['weight_kg'] = kg
                renpho['body_fat_pct'] = comp['body_fat_pct']
                renpho['lean_mass_kg'] = comp['lean_mass_kg']
                renpho['target_weight_at_15pct'] = comp['target_weight_at_15pct']
                renpho['fat_to_lose_kg'] = comp['fat_to_lose_kg']
                renpho['weight_source'] = 'live_mynetdiary_weight'
                renpho['source'] = 'live_mynetdiary_weight'
                renpho['weight_synced_at'] = scale_ts
                renpho['last_synced'] = scale_ts

                athlete = state.setdefault('athlete', {})
                athlete['weight_kg'] = kg
                athlete['body_fat_pct'] = comp['body_fat_pct']
                athlete['lean_mass_kg'] = comp['lean_mass_kg']
                athlete['target_weight_kg'] = comp['target_weight_at_15pct']
                athlete['fat_to_lose_kg'] = comp['fat_to_lose_kg']

        # Autoregulation & Runway expansion recalculation
        nutrition = analytics_service.recalculate_nutrition(state, today_str)
        eff_cals = int(effective_ml.get('calories') or 0)
        eff_prot = int(effective_ml.get('protein_g') or 0)
        nutrition['remaining_calories'] = nutrition['calories_remaining']
        nutrition['remaining_protein_g'] = nutrition['protein_remaining']
        nutrition['protein_achieved_pct'] = round((eff_prot / float(max(1, nutrition['protein_target_g']))) * 100, 1)

        state_store.save_live_state(state, LIVE_STATE_PATH)

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
