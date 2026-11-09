import os
import json
import pickle
import requests
from datetime import datetime, date

MND_DIR = '/shared/user/.gemini/mnd_tokens'
CREDS_FILE = os.path.join(MND_DIR, 'credentials.json')
COOKIES_FILE = os.path.join(MND_DIR, 'session_cookies.pkl')
LIVE_STATE_PATH = '/home/antigravity/live_state.json'
ARTIFACT_LIVE_STATE_PATH = '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/edd5559b-aa78-4dd1-8c2a-5adb25870227/live_state.json'

DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.mynetdiary.com',
    'Referer': 'https://www.mynetdiary.com/logonPage.do'
}

class MyNetDiarySyncService:
    def __init__(self):
        os.makedirs(MND_DIR, exist_ok=True)
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self._load_cookies()

    def _load_cookies(self):
        if os.path.exists(COOKIES_FILE):
            try:
                with open(COOKIES_FILE, 'rb') as f:
                    self.session.cookies.update(pickle.load(f))
            except Exception as e:
                print(f"[MNDSync] Failed loading cookies: {e}")

    def _save_cookies(self):
        try:
            with open(COOKIES_FILE, 'wb') as f:
                pickle.dump(self.session.cookies, f)
        except Exception as e:
            print(f"[MNDSync] Failed saving cookies: {e}")

    def get_credentials(self):
        env_u = os.environ.get('MND_USERNAME')
        env_p = os.environ.get('MND_PASSWORD')
        if env_u and env_p:
            return {'username': env_u, 'password': env_p}
        if os.path.exists(CREDS_FILE):
            try:
                with open(CREDS_FILE, 'r') as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def save_credentials(self, username, password):
        creds = {
            'username': username,
            'password': password,
            'updated_at': datetime.now().isoformat()
        }
        with open(CREDS_FILE, 'w') as f:
            json.dump(creds, f, indent=2)

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

    def fetch_today_data(self, target_date_str=None):
        if not target_date_str:
            target_date_str = date.today().isoformat()

        # Try fetching meals endpoint
        meals_url = 'https://www.mynetdiary.com/muiGetMeals.do'
        headers = dict(DEFAULT_HEADERS)
        headers['Referer'] = 'https://www.mynetdiary.com/daily.do'

        params = {'date': target_date_str}
        try:
            resp = self.session.get(meals_url, params=params, headers=headers, timeout=15)
            data = resp.json()
        except Exception as e:
            return {'success': False, 'error': f'Request failed: {str(e)}'}

        # Check if login is required
        if data.get('needLogon') or not data:
            authed, err = self.ensure_authenticated()
            if not authed:
                return {'success': False, 'requires_auth': True, 'error': err}
            
            # Retry after authentication
            try:
                resp = self.session.get(meals_url, params=params, headers=headers, timeout=15)
                data = resp.json()
            except Exception as e:
                return {'success': False, 'error': f'Request failed after relogin: {str(e)}'}

        self._save_cookies()

        # Also fetch dashboard / daily analysis for exact macro, micronutrients AND scale weight
        analysis_data = {}
        try:
            analysis_url = 'https://www.mynetdiary.com/muiGetDailyAnalysis.do'
            a_resp = self.session.get(analysis_url, params={'date': target_date_str}, headers=headers, timeout=10)
            if a_resp.status_code == 200:
                analysis_data = a_resp.json()
        except Exception as e:
            print(f"[MNDSync] Warning fetching analysis: {e}")

        # Extract parsed nutrition values
        totals, meals = self._parse_mnd_response(data, analysis_data)

        # Update live_state.json with nutrition and Renpho scale weight
        weight_info = analysis_data.get('weightInfo')
        state = self._update_live_state(totals, meals, weight_info)

        return {
            'success': True,
            'date': target_date_str,
            'totals': totals,
            'meals': meals,
            'weight_info': weight_info,
            'live_state': state
        }

    def _parse_mnd_response(self, meals_data, analysis_data):
        totals = {
            'calories': 0,
            'protein': 0,
            'carbs': 0,
            'fat': 0,
            'fiber': 0,
            'sodium': 0,
            'water': 0.0
        }

        meals = {
            'breakfast': {'name': 'Breakfast', 'time': '07:30', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []},
            'lunch': {'name': 'Lunch', 'time': '12:45', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []},
            'dinner': {'name': 'Dinner', 'time': 'Pending', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []},
            'snacks': {'name': 'Snacks & Hydration', 'time': '15:15', 'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'items': []}
        }

        # Parse meals structure from MyNetDiary response
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
                label = item.get('foodLabel', {})
                name = label.get('cleanFoodName') or label.get('foodName') or item.get('inputString') or item.get('name', 'Food Item')
                cals = int(round(float(item.get('calories', 0) or 0)))

                # Protein
                p_val = label.get('protein', {}).get('values', {}).get('rawValue') or item.get('values', {}).get('203') or 0
                p = int(round(float(p_val)))

                # Carbs
                c_val = label.get('totalCarbs', {}).get('values', {}).get('rawValue') or item.get('values', {}).get('205') or 0
                c = int(round(float(c_val)))

                # Fat
                f_val = label.get('totalFat', {}).get('values', {}).get('rawValue') or item.get('values', {}).get('204') or 0
                f = int(round(float(f_val)))

                # Fiber
                fib_val = label.get('fiber', {}).get('values', {}).get('rawValue') or item.get('values', {}).get('291') or 0
                totals['fiber'] += int(round(float(fib_val)))

                # Sodium
                sod_val = label.get('sodium', {}).get('values', {}).get('rawValue') or item.get('values', {}).get('307') or 0
                totals['sodium'] += int(round(float(sod_val)))

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

        # Check appleData / dayTotals for overall consumed calories if available
        if isinstance(meals_data, dict):
            apple = meals_data.get('appleData', {})
            if apple.get('consumedCalories'):
                totals['calories'] = int(apple['consumedCalories'])
            elif meals_data.get('dayTotals', {}).get('eaten', {}).get('value'):
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

    def _update_live_state(self, totals, meals, weight_info=None):
        state = {}
        if os.path.exists(LIVE_STATE_PATH):
            with open(LIVE_STATE_PATH, 'r') as f:
                state = json.load(f)

        garmin_state = state.setdefault('garmin', {})
        mnd_logged = garmin_state.setdefault('mnd_logged', {})
        mnd_logged['calories'] = totals['calories']
        mnd_logged['protein_g'] = totals['protein']
        mnd_logged['carbs_g'] = totals['carbs']
        mnd_logged['fat_g'] = totals['fat']
        mnd_logged['fiber_g'] = totals.get('fiber', 24)
        mnd_logged['sodium_mg'] = totals.get('sodium', 1380)
        mnd_logged['water_l'] = totals.get('water', 2.4)
        mnd_logged['last_pulled'] = datetime.now().isoformat()
        mnd_logged['source'] = 'live_mynetdiary_cloud'

        state['mnd_meals'] = meals

        # Update Renpho scale weight from weight_info if present
        if weight_info and weight_info.get('currentWeight'):
            raw_w = weight_info.get('currentWeight')
            kg = None
            expl = weight_info.get('bmiExplanation', '')
            import re
            m = re.search(r'W\s*=\s*([0-9\.]+)\s*kg', expl)
            if m:
                try:
                    kg = float(m.group(1))
                except:
                    pass
            if kg is None:
                try:
                    lbs = float(raw_w)
                    kg = round(lbs * 0.45359237, 2)
                except:
                    kg = 98.90

            lbm = state.get('athlete', {}).get('lean_mass_kg', 82.38)
            fat_kg = max(0, kg - lbm)
            bf_pct = round((fat_kg / kg) * 100, 1)
            target_wt_15 = round(lbm / (1.0 - 0.15), 2)
            fat_to_lose = round(max(0, kg - target_wt_15), 2)

            renpho = state.setdefault('renpho', {})
            renpho['weight_kg'] = kg
            renpho['body_fat_pct'] = bf_pct
            renpho['lean_mass_kg'] = lbm
            renpho['fat_to_lose_kg'] = fat_to_lose
            renpho['target_weight_at_15pct'] = target_wt_15
            renpho['source'] = 'live_renpho_cloud'
            renpho['last_synced'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

            athlete = state.setdefault('athlete', {})
            athlete['weight_kg'] = kg
            athlete['body_fat_pct'] = bf_pct
            athlete['fat_to_lose_kg'] = fat_to_lose

        # Autoregulation & Runway expansion recalculation
        nutrition = state.setdefault('nutrition', {})
        baseline_budget = 2092
        active_burn = garmin_state.get('active_calories', 0)
        nutrition['calorie_target'] = baseline_budget + active_burn
        nutrition['calories_remaining'] = nutrition['calorie_target'] - totals['calories']
        nutrition['protein_target_g'] = 200
        nutrition['protein_remaining'] = max(0, 200 - totals['protein'])

        # Save to live state file
        with open(LIVE_STATE_PATH, 'w') as f:
            json.dump(state, f, indent=2)

        # Sync to artifact path
        try:
            with open(ARTIFACT_LIVE_STATE_PATH, 'w') as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass

        # Sync to permanent storage
        perm_dir = '/shared/user/.gemini/pulse_backend'
        os.makedirs(perm_dir, exist_ok=True)
        try:
            with open(os.path.join(perm_dir, 'live_state.json'), 'w') as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass

        return state

    def get_status(self):
        creds = self.get_credentials()
        has_cookies = os.path.exists(COOKIES_FILE)
        return {
            'configured': creds is not None,
            'username': creds.get('username') if creds else None,
            'has_cached_session': has_cookies,
            'last_updated': creds.get('updated_at') if creds else None
        }
