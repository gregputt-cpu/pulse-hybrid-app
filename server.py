import os
import json
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime

from garmin_sync_service import GarminSyncService
from mnd_sync_service import MyNetDiarySyncService
from benefits_engine import PhysiologicalBenefitsEngine

PORT = 8080
LIVE_STATE_PATH = '/home/antigravity/live_state.json'
ARTIFACT_LIVE_STATE_PATH = '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/edd5559b-aa78-4dd1-8c2a-5adb25870227/live_state.json'
PERM_BACKEND_DIR = '/shared/user/.gemini/pulse_backend'

garmin_service = GarminSyncService()
mnd_service = MyNetDiarySyncService()
benefits_engine = PhysiologicalBenefitsEngine()

class PulseServerHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching for real-time JSON responses
        if self.path.endswith('.json') or self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body_json(self):
        content_len = int(self.headers.get('Content-Length', 0))
        if content_len == 0:
            return {}
        raw = self.rfile.read(content_len)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return {}

    def _load_live_state(self):
        if os.path.exists(LIVE_STATE_PATH):
            with open(LIVE_STATE_PATH, 'r') as f:
                return json.load(f)
        return {}

    def _save_live_state(self, state):
        with open(LIVE_STATE_PATH, 'w') as f:
            json.dump(state, f, indent=2)
        try:
            with open(ARTIFACT_LIVE_STATE_PATH, 'w') as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass
        try:
            os.makedirs(PERM_BACKEND_DIR, exist_ok=True)
            with open(os.path.join(PERM_BACKEND_DIR, 'live_state.json'), 'w') as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass

    def _bake_full_state_into_html_and_drive(self, state=None):
        try:
            if not state:
                state = self._load_live_state()
            if not state:
                return
            import re, subprocess
            html_path = '/home/antigravity/index.html'
            if not os.path.exists(html_path):
                return
            with open(html_path, 'r', encoding='utf-8') as f:
                html = f.read()

            # 1. Update window.BAKED_LIVE_STATE
            baked_decl = 'window.BAKED_LIVE_STATE = ' + json.dumps(state) + ';\n'
            if 'window.BAKED_LIVE_STATE' in html:
                html = re.sub(r'window\.BAKED_LIVE_STATE = \{[\s\S]*?\};\n', lambda m: baked_decl, html, count=1)
            else:
                html = html.replace('<script>\n', '<script>\n    ' + baked_decl)

            # 2. Update recentActivitiesData
            recent_acts = state.get('garmin', {}).get('recent_activities', [])
            js_acts = []
            for a in recent_acts:
                raw_date = a.get('date', '')
                is_today = '2026-11-09' in raw_date
                time_str = raw_date.split(' ')[1][:5] if ' ' in raw_date else ''
                date_label = f'Today • {time_str}' if is_today else f'Yesterday • {time_str}'
                js_acts.append({
                    'id': str(a.get('id')),
                    'name': a.get('name'),
                    'subTitle': a.get('sub_title') or a.get('name'),
                    'rawDate': raw_date,
                    'date': date_label,
                    'durationMin': a.get('duration_min'),
                    'calories': a.get('calories'),
                    'avgHr': a.get('avg_hr'),
                    'maxHr': a.get('max_hr'),
                    'aerobicTe': a.get('aerobic_te'),
                    'anaerobicTe': a.get('anaerobic_te'),
                    'isToday': is_today,
                    'benefits': a.get('benefits', {})
                })
            acts_decl = 'let recentActivitiesData = ' + json.dumps(js_acts, indent=6) + ';'
            html = re.sub(r'let recentActivitiesData = \[[\s\S]*?\n    \];', lambda m: acts_decl, html, count=1)

            # 3. Update active burn numbers in HTML
            burn = state.get('garmin', {}).get('active_calories', 0)
            today_acts = state.get('garmin', {}).get('today_activities', [])
            act_count = len(today_acts)
            target_budget = 2741 + burn
            remaining = target_budget - state.get('garmin', {}).get('mnd_logged', {}).get('calories', 0)

            html = re.sub(r'<div class="vital-val" id="vitalBurn">[\s\S]*?</div>', f'<div class="vital-val" id="vitalBurn">{burn} <small style="font-size:12.5px;font-weight:400;color:var(--text-muted);">kcal</small></div>', html, count=1)
            html = re.sub(r'<div style="font-size:13px; font-weight:800; color:#fff;" id="garminBannerSub">[\s\S]*?</div>', f'<div style="font-size:13px; font-weight:800; color:#fff;" id="garminBannerSub">{act_count} Workout{"s" if act_count != 1 else ""} Today ({burn} kcal)</div>', html, count=1)
            html = re.sub(r'<div style="font-size:13.5px; font-weight:900; color:var\(--lime\);" id="garminBannerBurn">[\s\S]*?</div>', f'<div style="font-size:13.5px; font-weight:900; color:var(--lime);" id="garminBannerBurn">{burn} kcal</div>', html, count=1)
            html = re.sub(r'<div style="font-size:11.5px; color:var\(--cyan\);" id="garminBannerAction">[\s\S]*?</div>', f'<div style="font-size:11.5px; color:var(--cyan);" id="garminBannerAction">Today: {burn} kcal active burn ➔</div>', html, count=1)
            html = re.sub(r'<span class="eq-chip eq-garmin" id="fuelGarminEqChip" title="Garmin Synced Active Burn">[\s\S]*?</span>', f'<span class="eq-chip eq-garmin" id="fuelGarminEqChip" title="Garmin Synced Active Burn">+{burn} <small>Garmin</small></span>', html, count=1)
            html = re.sub(r'<span class="eq-chip eq-budget" title="Total Daily Caloric Budget">[\s\S]*?</span>', f'<span class="eq-chip eq-budget" title="Total Daily Caloric Budget">{target_budget:,} <small>Budget</small></span>', html, count=1)
            html = re.sub(r'<div style="font-size:28px; font-weight:900; color:#fff; line-height:1.1; margin-top:2px;" id="fuelTargetNum">[\s\S]*?</div>', f'<div style="font-size:28px; font-weight:900; color:#fff; line-height:1.1; margin-top:2px;" id="fuelTargetNum">{target_budget:,} <small style="font-size:13px; color:var(--lime); font-weight:800;">+{burn} active</small></div>', html, count=1)
            html = re.sub(r'<div style="font-size:30px; font-weight:900; color:var\(--cyan\); line-height:1.1; margin-top:2px;" id="fuelRemainingNum">[\s\S]*?</div>', f'<div style="font-size:30px; font-weight:900; color:var(--cyan); line-height:1.1; margin-top:2px;" id="fuelRemainingNum">{remaining:,} <small style="font-size:14px; font-weight:700;">kcal</small></div>', html, count=1)

            with open(html_path, 'w', encoding='utf-8') as f:
                f.write(html)

            # Mirror to artifacts & pulse_backend
            for dest in [
                '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/edd5559b-aa78-4dd1-8c2a-5adb25870227/index.html',
                '/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/edd5559b-aa78-4dd1-8c2a-5adb25870227/hybrid_athlete_dashboard.html',
                '/shared/user/.gemini/pulse_backend/index.html'
            ]:
                try:
                    with open(dest, 'w', encoding='utf-8') as f_dest:
                        f_dest.write(html)
                except Exception:
                    pass

            env = os.environ.copy()
            env['ANTIGRAVITY_APP_DATA_DIR'] = '/tmp'
            subprocess.Popen(
                ['/opt/antigravity/bin/gdrive', 'mutate', 'update', '12T82X1PuU8QvjyiHyFrBgNXsnfU54WRc', html_path, '--mime-type', 'text/html'],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        except Exception as e:
            print("Warning baking full state into Drive HTML:", e)

    def _bake_mnd_into_html_and_drive(self, sync_res):
        try:
            if not sync_res or not sync_res.get('success'):
                return
            state = self._load_live_state()
            self._bake_full_state_into_html_and_drive(state)
        except Exception as e:
            print("Warning baking MND into Drive HTML:", e)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/' or path == '/index.html':
            self.path = '/index.html'
            return super().do_GET()

        if path == '/api/live_state' or path == '/live_state.json':
            state = self._load_live_state()
            return self._send_json(state)

        if path == '/api/mnd/status':
            status = mnd_service.get_status()
            return self._send_json(status)

        if path == '/api/mnd/sync':
            res = mnd_service.fetch_today_data()
            return self._send_json(res)

        if path == '/api/garmin/sync':
            try:
                updated_state = garmin_service.sync_today()
                try:
                    mnd_res = mnd_service.fetch_today_data()
                    if mnd_res.get('success'):
                        updated_state = self._load_live_state()
                except Exception:
                    pass
                self._bake_full_state_into_html_and_drive(updated_state)
                return self._send_json({'success': True, 'state': updated_state})
            except Exception as e:
                return self._send_json({'success': False, 'error': str(e)}, status=500)

        if path == '/api/renpho/sync':
            try:
                mnd_res = mnd_service.fetch_today_data()
                state = self._load_live_state()
                self._bake_full_state_into_html_and_drive(state)
                return self._send_json({'success': True, 'renpho': state.get('renpho', {}), 'state': state})
            except Exception as e:
                return self._send_json({'success': False, 'error': str(e)}, status=500)

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_body_json()

        # 1. Garmin Sync
        if path == '/api/garmin/sync':
            try:
                target_date = body.get('date')
                updated_state = garmin_service.sync_today(target_date)
                try:
                    mnd_res = mnd_service.fetch_today_data(target_date)
                    if mnd_res.get('success'):
                        updated_state = self._load_live_state()
                except Exception as ex_mnd:
                    print("Warning fetching MND during Garmin sync:", ex_mnd)
                self._bake_full_state_into_html_and_drive(updated_state)
                return self._send_json({'success': True, 'state': updated_state})
            except Exception as e:
                return self._send_json({'success': False, 'error': str(e)}, status=500)

        # 1b. Renpho Scale Sync
        if path == '/api/renpho/sync':
            try:
                target_date = body.get('date')
                mnd_res = mnd_service.fetch_today_data(target_date)
                self._bake_mnd_into_html_and_drive(mnd_res)
                state = self._load_live_state()
                return self._send_json({'success': True, 'renpho': state.get('renpho', {}), 'state': state})
            except Exception as e:
                return self._send_json({'success': False, 'error': str(e)}, status=500)

        # 2. Garmin MFA Submit
        if path == '/api/garmin/submit_mfa':
            return self._send_json({'success': True, 'message': 'MFA submitted'})

        # 3. MyNetDiary Login & Connect
        if path == '/api/mnd/login':
            username = body.get('username') or body.get('login')
            password = body.get('password')
            if not username or not password:
                return self._send_json({'success': False, 'status': 'error', 'error': 'Username and password required.'}, status=400)
            
            res = mnd_service.login(username, password)
            if res.get('success'):
                # Immediately pull today's data upon successful login
                sync_res = mnd_service.fetch_today_data()
                self._bake_mnd_into_html_and_drive(sync_res)
                return self._send_json({
                    'success': True,
                    'status': 'success',
                    'username': username,
                    'message': 'Connected to MyNetDiary & pulled today\'s food log!',
                    'sync_data': sync_res
                })
            else:
                return self._send_json({'success': False, 'status': 'error', 'message': res.get('error', 'Login failed')}, status=401)

        # 4. MyNetDiary Sync
        if path == '/api/mnd/sync':
            target_date = body.get('date')
            res = mnd_service.fetch_today_data(target_date)
            if res.get('requires_auth'):
                res['status'] = 'auth_needed'
            elif res.get('success'):
                res['status'] = 'success'
                self._bake_mnd_into_html_and_drive(res)
            else:
                res['status'] = 'error'
            return self._send_json(res)

        # 5. Annotate Activity with Benefits Engine
        if path == '/api/annotate_activity':
            act_id = body.get('id') or body.get('activity_id')
            user_title = body.get('sub_title') or body.get('name')
            state = self._load_live_state()
            activities = state.get('garmin', {}).get('recent_activities', [])

            found = False
            for act in activities:
                if str(act.get('id')) == str(act_id):
                    act['sub_title'] = user_title
                    act['benefits'] = benefits_engine.generate_benefits(
                        act.get('name', 'Cardio'),
                        user_title,
                        act.get('duration_min', 30),
                        act.get('calories', 300),
                        act.get('avg_hr', 120),
                        act.get('max_hr', 160),
                        act.get('aerobic_te', 2.0),
                        act.get('anaerobic_te', 1.0)
                    )
                    found = True
                    break

            if found:
                self._save_live_state(state)
                return self._send_json({'success': True, 'state': state})
            return self._send_json({'success': False, 'error': 'Activity not found'}, status=404)

        # 7. Update Athlete Active Goal
        if path == '/api/athlete/goal':
            state = self._load_live_state()
            athlete = state.setdefault('athlete', {})
            if 'target_bf' in body:
                athlete['target_body_fat_pct'] = float(body['target_bf'])
            if 'target_weight' in body:
                athlete['target_weight_kg'] = float(body['target_weight'])
            if 'fat_to_lose' in body:
                athlete['fat_to_lose_kg'] = float(body['fat_to_lose'])
            if 'deficit' in body:
                athlete['target_deficit_kcal'] = int(body['deficit'])
            if 'protein' in body:
                athlete['target_protein_g'] = int(body['protein'])
            if 'calories' in body:
                athlete['target_calories'] = int(body['calories'])
            self._save_live_state(state)
            return self._send_json({'success': True, 'athlete': athlete})

        # 8. Update Athlete Injury Profile
        if path == '/api/athlete/injuries':
            state = self._load_live_state()
            state['injuries'] = body
            self._save_live_state(state)
            return self._send_json({'success': True, 'injuries': body})

        # 6. Log Meal
        if path == '/api/log_meal':
            meal_name = body.get('meal_name', 'Quick Item')
            calories = int(body.get('calories', 0))
            protein = int(body.get('protein', 0))
            category = body.get('category', 'snacks')

            state = self._load_live_state()
            mnd_logged = state.setdefault('garmin', {}).setdefault('mnd_logged', {})
            mnd_logged['calories'] = mnd_logged.get('calories', 0) + calories
            mnd_logged['protein_g'] = mnd_logged.get('protein_g', 0) + protein

            nutrition = state.setdefault('nutrition', {})
            nutrition['calories_remaining'] = nutrition.get('calorie_target', 2741) - mnd_logged['calories']
            nutrition['protein_remaining'] = max(0, nutrition.get('protein_target_g', 200) - mnd_logged['protein_g'])

            self._save_live_state(state)
            return self._send_json({'success': True, 'state': state})

        # 7. Sync Set / Prescriptions
        if path == '/api/sync_set':
            ex_id = body.get('exercise_id')
            weight = body.get('weight')
            reps = body.get('reps')
            state = self._load_live_state()
            sp = state.setdefault('strength_prescriptions', {}).setdefault(ex_id, {})
            if weight is not None: sp['last_logged_weight'] = weight
            if reps is not None: sp['last_logged_reps'] = reps
            self._save_live_state(state)
            return self._send_json({'success': True, 'state': state})

        return self._send_json({'error': 'Not found'}, status=404)

def start_background_sync_worker():
    import threading, time
    def worker():
        time.sleep(15)  # Initial startup delay
        helper = PulseServerHandler(None, ('127.0.0.1', 0), None)
        while True:
            try:
                print("[AutoSync] Checking Garmin & MyNetDiary updates...")
                updated_state = garmin_service.sync_today()
                try:
                    mnd_res = mnd_service.fetch_today_data()
                    if mnd_res.get('success'):
                        updated_state = helper._load_live_state()
                except Exception:
                    pass
                helper._bake_full_state_into_html_and_drive(updated_state)
                print("[AutoSync] Successfully synced & updated Google Drive master.")
            except Exception as e:
                print("[AutoSync] Error during background sync:", e)
            time.sleep(900)  # Every 15 minutes

    t = threading.Thread(target=worker, daemon=True)
    t.start()

if __name__ == '__main__':
    print(f"Starting PULSE Hybrid Athlete Daemon on port {PORT}...")
    start_background_sync_worker()
    HTTPServer.allow_reuse_address = True
    server = HTTPServer(('0.0.0.0', PORT), PulseServerHandler)
    server.serve_forever()
