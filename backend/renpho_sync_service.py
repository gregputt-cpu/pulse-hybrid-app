import json
import logging
import math
import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from renpho import RenphoClient
import analytics_service
import db
import state_store
import time_utils

logger = logging.getLogger("pulse-renpho-sync")

_DATA_DIR = state_store.get_data_dir()
CREDS_FILE = os.environ.get('RENPHO_CREDS_FILE', os.path.join(_DATA_DIR, 'renpho_creds.json'))
LIVE_STATE_PATH = state_store.get_live_state_path()


def _opt_float(val, precision=None, positive_only=False):
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    if positive_only and num <= 0:
        return None
    return round(num, precision) if precision is not None else num


def _opt_int(val, positive_only=False):
    num = _opt_float(val, positive_only=positive_only)
    return int(round(num)) if num is not None else None


def _is_auth_exc(exc: Exception) -> bool:
    if isinstance(exc, ValueError) and "credentials not configured" in str(exc).lower():
        return True
    msg = str(exc).lower()
    return any(tok in msg for tok in ("401", "403", "unauthorized", "auth", "login", "password", "credential", "token"))


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
        self._sync_lock = threading.RLock()
        self._last_sync_ts = 0.0
        self._error_until = 0.0

    def get_client(self, force_refresh=False):
        if not self.email or not self.password:
            raise ValueError("Renpho credentials not configured. Set RENPHO_EMAIL and RENPHO_PASSWORD environment variables.")
        if force_refresh or not self.client:
            self.client = RenphoClient(self.email, self.password)
            self.client.login()
        return self.client

    @staticmethod
    def _measurement_timestamp_str(latest):
        ts = latest.get('timeStamp')
        ts_num = _opt_float(ts, positive_only=True)
        if ts_num is not None:
            return time_utils.uk_timestamp_str(ts_num)
        local_created = latest.get('localCreatedAt')
        if local_created:
            s = str(local_created).strip()
            for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
                try:
                    dt_cn = datetime.strptime(s[:19], fmt).replace(tzinfo=ZoneInfo("Asia/Shanghai"))
                    return dt_cn.astimezone(time_utils.UK_TZ).strftime('%Y-%m-%d %H:%M:%S')
                except ValueError:
                    continue
            parsed = time_utils.parse_uk_ts(s)
            if parsed is not None:
                return parsed.strftime('%Y-%m-%d %H:%M:%S')
        return time_utils.uk_timestamp_str()

    def sync_latest(self, force=False):
        now_ts = time.time()
        if not force and ((self._last_sync_ts and (now_ts - self._last_sync_ts) < 3600) or now_ts < self._error_until):
            state = state_store.load_live_state(LIVE_STATE_PATH)
            return {
                "success": True,
                "throttled": True,
                "skipped": "throttled",
                "metrics": state.get("renpho", {}),
                "state": state,
            }
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

            if not measurements:
                logger.warning("[RenphoSync] No measurements returned.")
                self._error_until = time.time() + 300.0
                return {"success": False, "requires_auth": False, "error": "No measurements found"}

            try:
                db.upsert_renpho_measurements(measurements)
            except Exception as dbe:
                logger.warning(f"[RenphoSync] Failed upserting to SQLite db: {dbe}")

            valid_measurements = [m for m in measurements if isinstance(m, dict)]
            valid_measurements.sort(key=lambda m: (m.get('timeStamp') or 0), reverse=True)
            if not valid_measurements:
                self._error_until = time.time() + 300.0
                return {"success": False, "requires_auth": False, "error": "No valid scale measurement records"}

            latest = valid_measurements[0]
            weight_kg = _opt_float(latest.get('weight'), precision=2, positive_only=True)
            if weight_kg is None or weight_kg <= 20.0 or weight_kg >= 300.0:
                self._error_until = time.time() + 300.0
                return {"success": False, "requires_auth": False, "error": "Invalid scale weight measurement"}

            raw_bf = _opt_float(latest.get('bodyfat'), precision=1, positive_only=True)
            body_fat = raw_bf if (raw_bf is not None and 3.0 <= raw_bf <= 60.0) else None
            water = _opt_float(latest.get('water'), precision=1, positive_only=True)
            bone = _opt_float(latest.get('bone'), precision=2, positive_only=True)
            raw_lbm = _opt_float(latest.get('fatFreeWeight'), precision=2, positive_only=True)
            skeletal_muscle_pct = _opt_float(latest.get('muscle'), precision=1, positive_only=True)
            raw_sinew = _opt_float(latest.get('sinew'), precision=2, positive_only=True)
            visfat = _opt_float(latest.get('visfat'), precision=1, positive_only=True)
            subfat = _opt_float(latest.get('subfat'), precision=1, positive_only=True)
            bmi = _opt_float(latest.get('bmi'), precision=1, positive_only=True)
            protein = _opt_float(latest.get('protein'), precision=1, positive_only=True)
            bmr = _opt_int(latest.get('bmr'), positive_only=True)
            body_age = _opt_int(latest.get('bodyage'), positive_only=True)
            timestamp_str = self._measurement_timestamp_str(latest)
            incoming_dt = time_utils.parse_uk_ts(timestamp_str)

            checked_iso = time_utils.uk_now().isoformat()
            with state_store.state_lock(LIVE_STATE_PATH):
                state = state_store.load_live_state(LIVE_STATE_PATH, raise_on_corrupt=True)
                existing_renpho = state.get('renpho', {}) if isinstance(state.get('renpho'), dict) else {}
                existing_weight_ts = existing_renpho.get('weight_synced_at') or existing_renpho.get('last_synced')
                existing_dt = time_utils.parse_uk_ts(existing_weight_ts)
                existing_source = existing_renpho.get('weight_source') or existing_renpho.get('source') or ''

                # Precedence checks using parsed Europe/London datetimes
                preserve_reason = None
                if existing_source == 'manual_scale_entry':
                    if existing_dt is not None and (incoming_dt is None or incoming_dt <= existing_dt):
                        preserve_reason = "manual_scale_entry"
                elif existing_source == 'live_mynetdiary_weight':
                    if existing_dt is not None and incoming_dt is not None and existing_dt > incoming_dt:
                        preserve_reason = "live_mynetdiary_weight"
                elif existing_source == 'renpho_direct_cloud':
                    if existing_dt is not None and incoming_dt is not None and incoming_dt < existing_dt:
                        preserve_reason = "renpho_direct_cloud"

                if preserve_reason is not None:
                    state.setdefault('renpho', {})['last_checked'] = checked_iso
                    state_store.save_live_state(state, LIVE_STATE_PATH)
                    self._last_sync_ts = time.time()
                    self._error_until = 0.0
                    logger.info(
                        f"[RenphoSync] Preserving {preserve_reason} ({existing_weight_ts}) over cloud reading ({timestamp_str})"
                    )
                    return {
                        "success": True,
                        "metrics": state.get('renpho', {}),
                        "preserved_newer": True,
                        "state": state,
                    }

                if body_fat is not None:
                    if raw_lbm is not None and 0.0 < raw_lbm < weight_kg:
                        lbm = raw_lbm
                        target_wt = round(lbm / 0.85, 2)
                        fat_to_lose = round(max(0.0, weight_kg - target_wt), 2)
                        final_bf = body_fat
                    else:
                        comp = analytics_service.compute_composition_from_weight(
                            weight_kg, body_fat_pct=body_fat
                        )
                        final_bf = comp["body_fat_pct"]
                        lbm = comp["lean_mass_kg"]
                        target_wt = comp["target_weight_at_15pct"]
                        fat_to_lose = comp["fat_to_lose_kg"]
                    muscle_mass_kg = (
                        raw_sinew
                        if raw_sinew is not None
                        else (round(max(0.0, lbm - bone), 2) if (lbm is not None and bone is not None) else None)
                    )
                    bio_synced_at = timestamp_str
                    final_water = water
                    final_skeletal = skeletal_muscle_pct
                    final_bone = bone
                    final_visfat = visfat
                    final_subfat = subfat
                    final_bmi = bmi
                    final_protein = protein
                    final_bmr = bmr
                    final_body_age = body_age
                else:
                    # Socks-on / weight-only Renpho reading
                    existing_lbm = existing_renpho.get('lean_mass_kg')
                    if existing_lbm is None:
                        existing_lbm = (state.get('athlete') or {}).get('lean_mass_kg')
                    comp = analytics_service.compute_composition_from_weight(
                        weight_kg, existing_lbm=existing_lbm
                    )
                    final_bf = comp["body_fat_pct"]
                    lbm = comp["lean_mass_kg"]
                    target_wt = comp["target_weight_at_15pct"]
                    fat_to_lose = comp["fat_to_lose_kg"]
                    has_valid_lbm = lbm is not None
                    bio_synced_at = existing_renpho.get('bio_synced_at') if has_valid_lbm else None
                    muscle_mass_kg = raw_sinew if raw_sinew is not None else (existing_renpho.get('muscle_mass_kg') if has_valid_lbm else None)
                    final_water = water if water is not None else (existing_renpho.get('water_pct') if has_valid_lbm else None)
                    final_skeletal = skeletal_muscle_pct if skeletal_muscle_pct is not None else (existing_renpho.get('skeletal_muscle_pct') if has_valid_lbm else None)
                    final_bone = bone if bone is not None else (existing_renpho.get('bone_mass_kg') if has_valid_lbm else None)
                    final_visfat = visfat if visfat is not None else (existing_renpho.get('visceral_fat') if has_valid_lbm else None)
                    final_subfat = subfat if subfat is not None else (existing_renpho.get('subcutaneous_fat_pct') if has_valid_lbm else None)
                    final_bmi = bmi
                    final_protein = protein if protein is not None else (existing_renpho.get('protein_pct') if has_valid_lbm else None)
                    final_bmr = bmr if bmr is not None else (existing_renpho.get('bmr') if has_valid_lbm else None)
                    final_body_age = body_age if body_age is not None else (existing_renpho.get('body_age') if has_valid_lbm else None)

                renpho_data = {
                    "source": "renpho_direct_cloud",
                    "weight_source": "renpho_direct_cloud",
                    "weight_kg": weight_kg,
                    "body_fat_pct": final_bf,
                    "water_pct": final_water,
                    "muscle_mass_kg": muscle_mass_kg,
                    "skeletal_muscle_pct": final_skeletal,
                    "bone_mass_kg": final_bone,
                    "visceral_fat": final_visfat,
                    "subcutaneous_fat_pct": final_subfat,
                    "bmi": final_bmi,
                    "protein_pct": final_protein,
                    "lean_mass_kg": lbm,
                    "bmr": final_bmr,
                    "body_age": final_body_age,
                    "target_weight_at_15pct": target_wt,
                    "fat_to_lose_kg": fat_to_lose,
                    "weight_synced_at": timestamp_str,
                    "bio_synced_at": bio_synced_at,
                    "last_synced": timestamp_str,
                    "last_checked": checked_iso,
                    "raw_id": latest.get('id'),
                }
                state['renpho'] = renpho_data

                athlete = state.setdefault('athlete', {})
                athlete['weight_kg'] = weight_kg
                athlete['body_fat_pct'] = final_bf
                athlete['lean_mass_kg'] = lbm
                athlete['muscle_mass_kg'] = muscle_mass_kg
                athlete['skeletal_muscle_pct'] = final_skeletal
                athlete['target_weight_kg'] = target_wt
                athlete['fat_to_lose_kg'] = fat_to_lose

                state_store.save_live_state(state, LIVE_STATE_PATH)

            self._last_sync_ts = time.time()
            self._error_until = 0.0
            logger.info(f"[RenphoSync] Successfully synced: {weight_kg}kg, {final_bf}% BF")
            return {
                "success": True,
                "metrics": renpho_data,
                "state": state,
            }
        except Exception as e:
            self._error_until = time.time() + 300.0
            logger.error(f"[RenphoSync] Error syncing from Renpho: {e}")
            return {
                "success": False,
                "requires_auth": _is_auth_exc(e),
                "error": str(e),
            }
        finally:
            self._sync_lock.release()

    def get_history(self, days=90):
        with self._sync_lock:
            try:
                history = db.get_renpho_history(days=days)
                if history:
                    return history

                # If empty in SQLite, fetch all measurements from cloud and upsert
                logger.info("[RenphoSync] SQLite renpho history empty. Fetching from Renpho cloud...")
                try:
                    client = self.get_client(force_refresh=False)
                    measurements = client.get_all_measurements()
                except Exception:
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
