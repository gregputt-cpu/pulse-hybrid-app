import os
import json
import time
import logging
import threading
from datetime import datetime
from renpho import RenphoClient
import db
import state_store
import time_utils

logger = logging.getLogger("pulse-renpho-sync")

_DATA_DIR = state_store.get_data_dir() or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
CREDS_FILE = os.environ.get('RENPHO_CREDS_FILE', os.path.join(_DATA_DIR, 'renpho_creds.json'))
LIVE_STATE_PATH = state_store.get_live_state_path()

class RenphoSyncService:
    def __init__(self, email=None, password=None):
        self.email = email or os.environ.get('RENPHO_EMAIL')
        self.password = password or os.environ.get('RENPHO_PASSWORD')
        if (not self.email or not self.password) and os.path.exists(CREDS_FILE):
            try:
                with open(CREDS_FILE, 'r', encoding='utf-8') as f:
                    creds = json.load(f)
                self.email = self.email or creds.get('email') or creds.get('username')
                self.password = self.password or creds.get('password')
            except Exception:
                pass
        self.client = None
        self._sync_lock = threading.Lock()
        self._last_sync_ts = 0.0

    def get_client(self, force_refresh=False):
        if not self.email or not self.password:
            raise ValueError("Renpho credentials not configured. Set RENPHO_EMAIL and RENPHO_PASSWORD environment variables.")
        if force_refresh or not self.client:
            self.client = RenphoClient(self.email, self.password)
            self.client.login()
        return self.client

    def sync_latest(self, force=False):
        now_ts = time.time()
        if not force and self._last_sync_ts and (now_ts - self._last_sync_ts) < 3600:
            state = state_store.load_live_state(LIVE_STATE_PATH)
            return {"success": True, "skipped": "throttled", "metrics": state.get("renpho", {}), "state": state}
        if not self._sync_lock.acquire(blocking=False):
            state = state_store.load_live_state(LIVE_STATE_PATH)
            return {"success": True, "skipped": "in_progress", "metrics": state.get("renpho", {}), "state": state}
        try:
            client = self.get_client(force_refresh=False)
            try:
                measurements = client.get_all_measurements()
            except Exception as e:
                logger.warning(f"[RenphoSync] First attempt failed ({e}), retrying with fresh login...")
                client = self.get_client(force_refresh=True)
                measurements = client.get_all_measurements()

            self._last_sync_ts = time.time()
            if not measurements:
                logger.warning("[RenphoSync] No measurements returned.")
                return {"success": False, "error": "No measurements found"}

            try:
                db.upsert_renpho_measurements(measurements)
            except Exception as dbe:
                logger.warning(f"[RenphoSync] Failed upserting to SQLite db: {dbe}")

            measurements.sort(key=lambda m: m.get('timeStamp', 0), reverse=True)
            latest = measurements[0]

            weight_kg = round(float(latest.get('weight', 97.7)), 2)
            body_fat = round(float(latest.get('bodyfat', 17.1)), 1)
            water = round(float(latest.get('water', 59.9)), 1)
            bone = round(float(latest.get('bone', 4.0)), 2)
            lbm = round(float(latest.get('fatFreeWeight', 80.99)), 2)
            skeletal_muscle_pct = round(float(latest.get('muscle', 53.5)), 1)
            raw_sinew = latest.get('sinew')
            muscle_mass_kg = round(float(raw_sinew), 2) if raw_sinew is not None else round(max(0.0, lbm - bone), 2)
            visfat = round(float(latest.get('visfat', 10.0)), 1)
            subfat = round(float(latest.get('subfat', 14.4)), 1)
            bmi = round(float(latest.get('bmi', 27.1)), 1)
            protein = round(float(latest.get('protein', 18.9)), 1)
            bmr = int(latest.get('bmr', 2096))
            body_age = int(latest.get('bodyage', 46))
            ts = latest.get('timeStamp')
            if ts:
                timestamp_str = time_utils.uk_timestamp_str(ts)
            else:
                timestamp_str = latest.get('localCreatedAt') or time_utils.uk_timestamp_str()

            # Target at 15.0% body fat based on genuine Renpho lean mass
            target_wt = round(lbm / (1.0 - 0.15), 2)
            fat_to_lose = round(max(0, weight_kg - target_wt), 2)

            # Update live state atomically under lock
            with state_store.state_lock(LIVE_STATE_PATH):
                state = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)

                existing_date = str(state.get('renpho', {}).get('last_synced', ''))[:10]
                if state.get('renpho', {}).get('source') == 'manual_scale_entry' and existing_date >= timestamp_str[:10]:
                    logger.info(f"[RenphoSync] Preserving manual scale entry from {state['renpho'].get('last_synced')} over cloud reading {timestamp_str}")
                    return {
                        "success": True,
                        "metrics": state['renpho'],
                        "state": state
                    }

                if existing_date > timestamp_str[:10]:
                    logger.info(f"[RenphoSync] Preserving newer state reading ({existing_date}) over older cloud reading ({timestamp_str[:10]})")
                    return {
                        "success": True,
                        "metrics": state.get('renpho', {}),
                        "preserved_newer": True
                    }

                renpho_data = {
                    "source": "renpho_direct_cloud",
                    "weight_kg": weight_kg,
                    "body_fat_pct": body_fat,
                    "water_pct": water,
                    "muscle_mass_kg": muscle_mass_kg,
                    "skeletal_muscle_pct": skeletal_muscle_pct,
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
                athlete['muscle_mass_kg'] = muscle_mass_kg
                athlete['skeletal_muscle_pct'] = skeletal_muscle_pct
                athlete['target_weight_kg'] = target_wt
                athlete['fat_to_lose_kg'] = fat_to_lose

                state_store.save_live_state(state, LIVE_STATE_PATH)

            logger.info(f"[RenphoSync] Successfully synced: {weight_kg}kg, {body_fat}% BF")
            return {
                "success": True,
                "metrics": renpho_data,
                "state": state
            }
        except Exception as e:
            logger.error(f"[RenphoSync] Error syncing from Renpho: {e}")
            return {"success": False, "error": str(e)}
        finally:
            self._sync_lock.release()

    def get_history(self, days=90):
        try:
            history = db.get_renpho_history(days=days)
            if history:
                return history

            # If empty in SQLite, fetch all measurements from cloud and upsert
            logger.info("[RenphoSync] SQLite renpho history empty. Fetching from Renpho cloud...")
            client = self.get_client(force_refresh=False)
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
