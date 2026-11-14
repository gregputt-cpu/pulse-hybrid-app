import os
import json
import logging
from datetime import datetime
from renpho import RenphoClient
import db

logger = logging.getLogger("pulse-renpho-sync")

CREDS_FILE = os.environ.get('RENPHO_CREDS_FILE', '/home/antigravity/.gemini/renpho_creds.json')
LIVE_STATE_PATH = os.environ.get('LIVE_STATE_PATH', '/home/antigravity/live_state.json')
if not os.path.exists(LIVE_STATE_PATH):
    if os.path.exists('live_state.json'):
        LIVE_STATE_PATH = 'live_state.json'
    else:
        LIVE_STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live_state.json')

class RenphoSyncService:
    def __init__(self, email="greg.putt@gmail.com", password="He11o12345"):
        self.email = os.environ.get('RENPHO_EMAIL', email)
        self.password = os.environ.get('RENPHO_PASSWORD', password)
        self.client = None

    def get_client(self, force_refresh=True):
        if force_refresh or not self.client:
            self.client = RenphoClient(self.email, self.password)
            self.client.login()
        return self.client

    def sync_latest(self):
        try:
            client = self.get_client(force_refresh=True)
            try:
                measurements = client.get_all_measurements()
            except Exception as e:
                logger.warning(f"[RenphoSync] First attempt failed ({e}), retrying with fresh login...")
                client = self.get_client(force_refresh=True)
                measurements = client.get_all_measurements()

            if not measurements:
                logger.warning("[RenphoSync] No measurements returned.")
                return {"success": False, "error": "No measurements found"}

            try:
                db.upsert_renpho_measurements(measurements)
            except Exception as dbe:
                logger.warning(f"[RenphoSync] Failed upserting to SQLite db: {dbe}")

            measurements.sort(key=lambda m: m.get('timeStamp', 0), reverse=True)
            latest = measurements[0]

            weight_kg = round(float(latest.get('weight', 98.0)), 2)
            body_fat = round(float(latest.get('bodyfat', 17.2)), 1)
            water = round(float(latest.get('water', 59.8)), 1)
            muscle = round(float(latest.get('muscle', 53.4)), 1)
            bone = round(float(latest.get('bone', 4.01)), 2)
            visfat = round(float(latest.get('visfat', 10.0)), 1)
            subfat = round(float(latest.get('subfat', 14.5)), 1)
            bmi = round(float(latest.get('bmi', 27.1)), 1)
            protein = round(float(latest.get('protein', 18.9)), 1)
            lbm = round(float(latest.get('fatFreeWeight', 81.14)), 2)
            bmr = int(latest.get('bmr', 2101))
            body_age = int(latest.get('bodyage', 46))
            timestamp_str = latest.get('localCreatedAt', datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

            # Target at 15.0% body fat based on genuine Renpho lean mass
            target_wt = round(lbm / (1.0 - 0.15), 2)
            fat_to_lose = round(max(0, weight_kg - target_wt), 2)

            # Update live state
            state = {}
            if os.path.exists(LIVE_STATE_PATH):
                try:
                    with open(LIVE_STATE_PATH, 'r', encoding='utf-8') as f:
                        state = json.load(f)
                except Exception as e:
                    logger.error(f"[RenphoSync] Error reading live_state: {e}")

            renpho_data = {
                "source": "renpho_direct_cloud",
                "weight_kg": weight_kg,
                "body_fat_pct": body_fat,
                "water_pct": water,
                "muscle_mass_kg": muscle,
                "bone_mass_kg": bone,
                "visceral_fat": visfat,
                "subcutaneous_fat_pct": subfat,
                "bmi": bmi,
                "protein_pct": protein,
                "lean_mass_kg": lbm,
                "bmr": bmr,
                "body_age": body_age,
                "target_weight_at_15pct": target_wt,
                "fat_to_lose_kg": fat_to_lose,
                "last_synced": timestamp_str,
                "raw_id": latest.get('id')
            }
            state['renpho'] = renpho_data

            athlete = state.setdefault('athlete', {})
            athlete['weight_kg'] = weight_kg
            athlete['body_fat_pct'] = body_fat
            athlete['lean_mass_kg'] = lbm
            athlete['muscle_mass_kg'] = muscle
            athlete['target_weight_kg'] = target_wt
            athlete['fat_to_lose_kg'] = fat_to_lose

            # Write to resolved LIVE_STATE_PATH
            with open(LIVE_STATE_PATH, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=2)

            # Also ensure backend/live_state.json is written
            backend_state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live_state.json')
            if backend_state_path != LIVE_STATE_PATH:
                try:
                    with open(backend_state_path, 'w', encoding='utf-8') as f:
                        json.dump(state, f, indent=2)
                except Exception as e:
                    logger.error(f"[RenphoSync] Error writing backend live_state: {e}")

            root_state_path = '/home/antigravity/live_state.json'
            if root_state_path != LIVE_STATE_PATH and root_state_path != backend_state_path and os.path.exists('/home/antigravity'):
                try:
                    with open(root_state_path, 'w', encoding='utf-8') as f:
                        json.dump(state, f, indent=2)
                except Exception as e:
                    logger.error(f"[RenphoSync] Error writing root live_state: {e}")

            logger.info(f"[RenphoSync] Successfully synced: {weight_kg}kg, {body_fat}% BF")
            return {
                "success": True,
                "metrics": renpho_data,
                "state": state
            }
        except Exception as e:
            logger.error(f"[RenphoSync] Error syncing from Renpho: {e}")
            return {"success": False, "error": str(e)}

    def get_history(self, days=90):
        try:
            history = db.get_renpho_history(days=days)
            if history:
                return history

            # If empty in SQLite, fetch all measurements from cloud and upsert
            logger.info("[RenphoSync] SQLite renpho history empty. Fetching from Renpho cloud...")
            client = self.get_client(force_refresh=True)
            measurements = client.get_all_measurements()
            if measurements:
                db.upsert_renpho_measurements(measurements)
            return db.get_renpho_history(days=days)
        except Exception as e:
            logger.error(f"[RenphoSync] Error fetching history: {e}")
            return db.get_renpho_history(days=days)

if __name__ == "__main__":
    service = RenphoSyncService()
    res = service.sync_latest()
    print(json.dumps(res, indent=2))
