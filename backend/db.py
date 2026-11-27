import os
import json
import math
import sqlite3
import logging
import threading
from contextlib import closing, contextmanager
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from zoneinfo import ZoneInfo

import state_store
import time_utils
from time_utils import UK_TZ, uk_now, uk_timestamp_str

logger = logging.getLogger("pulse-db")
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")

DATA_DIR = state_store.get_data_dir()
DB_PATH = os.path.join(DATA_DIR, "pulse.db")
_INIT_LOCK = threading.Lock()
_INITIALIZED_DB_PATH: Optional[str] = None

_parse_uk_ts = time_utils.parse_uk_ts


def get_connection() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=10000")
    except sqlite3.Error:
        pass
    return conn


@contextmanager
def _managed_conn(conn: Optional[sqlite3.Connection] = None):
    if conn is not None:
        yield conn
        return
    with closing(get_connection()) as active_conn:
        try:
            yield active_conn
            active_conn.commit()
        except Exception:
            try:
                active_conn.rollback()
            except sqlite3.Error:
                pass
            raise


def init_db(force: bool = False) -> None:
    global _INITIALIZED_DB_PATH
    if not force and _INITIALIZED_DB_PATH == DB_PATH:
        return
    with _INIT_LOCK:
        if not force and _INITIALIZED_DB_PATH == DB_PATH:
            return
        _init_db_unlocked()
        _INITIALIZED_DB_PATH = DB_PATH


def _ensure_initialized() -> None:
    if _INITIALIZED_DB_PATH != DB_PATH:
        init_db()


def _init_db_unlocked() -> None:
    with _managed_conn() as conn:
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.Error:
            pass
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS renpho_history (
                id TEXT PRIMARY KEY,
                timestamp INTEGER,
                date_str TEXT,
                weight_kg REAL,
                body_fat_pct REAL,
                lean_mass_kg REAL,
                muscle_mass_kg REAL,
                water_pct REAL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS strength_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                exercise_id TEXT,
                weight REAL,
                reps INTEGER,
                e1rm REAL,
                is_warmup INTEGER DEFAULT 0
            )
        """)
        cols = {row["name"] for row in cursor.execute("PRAGMA table_info(strength_logs)").fetchall()}
        if "is_warmup" not in cols:
            cursor.execute("ALTER TABLE strength_logs ADD COLUMN is_warmup INTEGER DEFAULT 0")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS hydration_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date_str TEXT,
                amount_ml INTEGER,
                timestamp TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS workout_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                preset TEXT,
                goal TEXT,
                exercises_completed INTEGER,
                sets_logged INTEGER,
                calories INTEGER,
                payload_json TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS manual_activities (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                name TEXT,
                sub_title TEXT,
                duration_min REAL,
                calories INTEGER,
                avg_hr INTEGER,
                max_hr INTEGER,
                payload_json TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_biometrics (
                date_str TEXT PRIMARY KEY,
                sleep_score INTEGER,
                resting_hr INTEGER,
                body_battery INTEGER,
                training_readiness INTEGER,
                source TEXT,
                updated_at TEXT
            )
        """)
        bio_cols = {row["name"] for row in cursor.execute("PRAGMA table_info(daily_biometrics)").fetchall()}
        for col_name, col_type in (
            ("hrv_last_night", "REAL"),
            ("hrv_weekly_avg", "REAL"),
            ("hrv_status", "TEXT"),
            ("hrv_baseline_low", "REAL"),
            ("avg_stress", "REAL"),
            ("sleep_avg_stress", "REAL"),
            ("sleep_start_ts", "INTEGER"),
            ("sleep_end_ts", "INTEGER"),
            ("deep_sleep_sec", "INTEGER"),
            ("rem_sleep_sec", "INTEGER"),
            ("light_sleep_sec", "INTEGER"),
            ("awake_sleep_sec", "INTEGER"),
        ):
            if col_name not in bio_cols:
                cursor.execute(f"ALTER TABLE daily_biometrics ADD COLUMN {col_name} {col_type}")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS garmin_intraday_telemetry (
                date_str TEXT PRIMARY KEY,
                stress_json TEXT,
                hr_json TEXT,
                sleep_stress_json TEXT,
                synced_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS illness_logs (
                date_str TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'active',
                severity TEXT NOT NULL DEFAULT 'moderate',
                symptoms_json TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS paroxysmal_episodes (
                id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                onset_time TEXT NOT NULL,
                date_str TEXT NOT NULL,
                acute_peak_end_time TEXT,
                full_recovery_time TEXT,
                user_recovered_at TEXT,
                biometric_recovered_at TEXT,
                acute_duration_mins INTEGER,
                total_recovery_duration_mins INTEGER,
                severity TEXT NOT NULL DEFAULT 'moderate',
                symptoms_json TEXT NOT NULL DEFAULT '[]',
                triggers_json TEXT NOT NULL DEFAULT '[]',
                pathway_tags_json TEXT NOT NULL DEFAULT '[]',
                illness_active INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                biometric_snapshot_json TEXT,
                biometric_snapshot_status TEXT NOT NULL DEFAULT 'pending',
                spike_auto_detected INTEGER NOT NULL DEFAULT 0,
                client_event_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_nutrition_logs (
                date_str TEXT PRIMARY KEY,
                calories INTEGER,
                protein_g INTEGER,
                carbs_g INTEGER,
                fat_g INTEGER,
                source TEXT,
                updated_at TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS diagnostic_assessments (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                date_str TEXT NOT NULL,
                input_mode TEXT,
                raw_text TEXT NOT NULL,
                anatomical_region TEXT,
                severity TEXT,
                triage_level TEXT,
                engine TEXT,
                affected_joints_json TEXT,
                report_json TEXT NOT NULL,
                applied_to_adaptor INTEGER DEFAULT 0,
                applied_at TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_renpho_timestamp ON renpho_history(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_strength_timestamp ON strength_logs(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_strength_exercise ON strength_logs(exercise_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hydration_date ON hydration_logs(date_str)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON workout_sessions(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_manual_activities_timestamp ON manual_activities(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_biometrics_date ON daily_biometrics(date_str)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_daily_nutrition_date ON daily_nutrition_logs(date_str)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostic_assessments(created_at DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_illness_date ON illness_logs(date_str DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_paroxysmal_onset ON paroxysmal_episodes(onset_time DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_paroxysmal_date ON paroxysmal_episodes(date_str DESC)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_paroxysmal_client_evt ON paroxysmal_episodes(client_event_id)")

        cursor.execute("SELECT value FROM kv_store WHERE key = 'migrated_renpho_muscle_kg_v1'")
        if cursor.fetchone() is None:
            cursor.execute("""
                UPDATE renpho_history
                SET muscle_mass_kg = ROUND(lean_mass_kg - 4.0, 2)
                WHERE muscle_mass_kg IS NOT NULL AND muscle_mass_kg < 65
                  AND lean_mass_kg IS NOT NULL AND lean_mass_kg > 70
            """)
            cursor.execute(
                "INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES ('migrated_renpho_muscle_kg_v1', '1', ?)",
                (uk_now().isoformat(),),
            )

        cursor.execute("SELECT value FROM kv_store WHERE key = 'migrated_repeated_warmup_sets_v1'")
        if cursor.fetchone() is None:
            warmup_rows = cursor.execute(
                """
                SELECT id, timestamp, exercise_id, weight
                FROM strength_logs
                WHERE COALESCE(is_warmup, 0) = 1 AND weight IS NOT NULL AND weight > 0
                ORDER BY id ASC
                """
            ).fetchall()
            clusters: Dict[Tuple[str, str], List[Tuple[int, float, datetime]]] = {}
            for wr in warmup_rows:
                dt = _parse_uk_ts(wr["timestamp"])
                if dt is None:
                    continue
                ex_id = str(wr["exercise_id"] or "")
                if not ex_id:
                    continue
                clusters.setdefault((ex_id, dt.date().isoformat()), []).append((int(wr["id"]), float(wr["weight"]), dt))

            promote_ids: List[int] = []
            for items in clusters.values():
                for idx_a, (id_a, w_a, dt_a) in enumerate(items):
                    has_cluster_mate = any(
                        idx_b != idx_a
                        and abs(w_a - w_b) <= 0.5
                        and abs((dt_a - dt_b).total_seconds()) <= 2700
                        for idx_b, (_, w_b, dt_b) in enumerate(items)
                    )
                    if has_cluster_mate:
                        promote_ids.append(id_a)

            if promote_ids:
                placeholders = ",".join("?" for _ in promote_ids)
                cursor.execute(
                    f"UPDATE strength_logs SET is_warmup = 0 WHERE id IN ({placeholders})",
                    tuple(promote_ids),
                )
            cursor.execute(
                "INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES ('migrated_repeated_warmup_sets_v1', '1', ?)",
                (uk_now().isoformat(),),
            )


def _opt_finite_round(val: Any, digits: int = 2) -> Optional[float]:
    if val is None or isinstance(val, bool):
        return None
    try:
        f = float(val)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(f):
        return None
    return round(f, digits)


def _parse_renpho_created_at_uk(raw_val: Any) -> Optional[datetime]:
    if not raw_val or isinstance(raw_val, bool):
        return None
    s = str(raw_val).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=SHANGHAI_TZ)
        return dt.astimezone(UK_TZ)
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:26], fmt).replace(tzinfo=SHANGHAI_TZ).astimezone(UK_TZ)
        except Exception:
            continue
    return None


def _get_item_attr(item: Any, *names: str) -> Any:
    is_dict = isinstance(item, dict)
    for name in names:
        val = item.get(name) if is_dict else getattr(item, name, None)
        if val is not None:
            return val
    return None


def _insert_renpho_records(conn: sqlite3.Connection, items: List[Any]) -> int:
    records = []
    for idx, item in enumerate(items):
        if item is None:
            continue
        raw_id = _get_item_attr(item, "id", "raw_id")
        raw_ts = _get_item_attr(item, "timeStamp", "timestamp")
        local_created = _get_item_attr(item, "localCreatedAt")
        explicit_date = _get_item_attr(item, "date_str")

        ts_sec: Optional[int] = None
        date_str: Optional[str] = None

        if raw_ts is not None and not isinstance(raw_ts, bool):
            try:
                ts_f = float(raw_ts)
                if math.isfinite(ts_f) and ts_f > 0:
                    if abs(ts_f) > 1e11:
                        ts_f /= 1000.0
                    ts_sec = int(ts_f)
                    date_str = uk_timestamp_str(ts_sec)
            except (ValueError, TypeError, OverflowError):
                ts_sec = None

        if ts_sec is None or date_str is None:
            dt_uk = _parse_uk_ts(explicit_date) if explicit_date else _parse_renpho_created_at_uk(local_created)
            if dt_uk is None and local_created and explicit_date:
                dt_uk = _parse_renpho_created_at_uk(local_created)
            if dt_uk is None:
                logger.warning(f"[DB] Skipping Renpho record {idx}: unparseable timestamp/localCreatedAt")
                continue
            ts_sec = int(dt_uk.timestamp())
            date_str = dt_uk.strftime("%Y-%m-%d %H:%M:%S")

        w = _opt_finite_round(_get_item_attr(item, "weight_kg", "weight"), 2)
        if w is None or w <= 0:
            logger.warning(f"[DB] Skipping Renpho record {idx}: missing or non-positive weight")
            continue

        bf = _opt_finite_round(_get_item_attr(item, "body_fat_pct", "bodyfat"), 2)
        lm = _opt_finite_round(_get_item_attr(item, "lean_mass_kg", "fat_free_weight", "fatFreeWeight"), 2)
        bone_val = _opt_finite_round(_get_item_attr(item, "bone_mass_kg", "bone"), 2)
        mm = _opt_finite_round(_get_item_attr(item, "muscle_mass_kg", "sinew"), 2)
        if mm is None and lm is not None and bone_val is not None:
            mm = round(max(0.0, lm - bone_val), 2)
        water = _opt_finite_round(_get_item_attr(item, "water_pct", "water"), 2)

        m_id = str(raw_id).strip() if raw_id is not None and str(raw_id).strip() else f"renpho_{ts_sec}_{idx}"
        records.append((m_id, ts_sec, date_str, w, bf, lm, mm, water))

    if not records:
        return 0

    query = """
        INSERT INTO renpho_history (id, timestamp, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            timestamp = excluded.timestamp,
            date_str = excluded.date_str,
            weight_kg = excluded.weight_kg,
            body_fat_pct = excluded.body_fat_pct,
            lean_mass_kg = excluded.lean_mass_kg,
            muscle_mass_kg = excluded.muscle_mass_kg,
            water_pct = excluded.water_pct
    """
    conn.executemany(query, records)
    conn.commit()
    logger.info(f"[DB] Upserted {len(records)} Renpho measurements to SQLite.")
    return len(records)


def upsert_renpho_measurements(items: List[Any]) -> int:
    if not items:
        return 0
    _ensure_initialized()
    with _managed_conn() as conn:
        return _insert_renpho_records(conn, items)


def get_renpho_history(days: int = 90, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_ts = None
    query_ts = 0
    if days and days > 0:
        cutoff_ts = int((uk_now() - timedelta(days=days)).timestamp())
        query_ts = cutoff_ts - (7 * 86400)

    with _managed_conn(conn) as active_conn:
        cursor = active_conn.cursor()
        if cutoff_ts is not None:
            cursor.execute(
                "SELECT id, timestamp, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct FROM renpho_history WHERE timestamp >= ? ORDER BY timestamp ASC",
                (query_ts,),
            )
        else:
            cursor.execute(
                "SELECT id, timestamp, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct FROM renpho_history ORDER BY timestamp ASC"
            )
        rows = cursor.fetchall()

    # Group and average non-null numeric fields per UK calendar date first
    by_day: Dict[str, List[sqlite3.Row]] = {}
    for r in rows:
        dt_uk = _parse_uk_ts(r["timestamp"]) or _parse_uk_ts(r["date_str"])
        if dt_uk is None:
            continue
        day_key = dt_uk.date().isoformat()
        by_day.setdefault(day_key, []).append(r)

    daily_records: List[Tuple[Any, Dict[str, Any]]] = []
    for day_key in sorted(by_day.keys()):
        day_rows = by_day[day_key]
        day_date = datetime.strptime(day_key, "%Y-%m-%d").date()

        def _mean_col(col: str) -> Optional[float]:
            vals = [float(x[col]) for x in day_rows if x[col] is not None and not isinstance(x[col], bool) and math.isfinite(float(x[col])) and float(x[col]) > 0]
            return round(sum(vals) / len(vals), 2) if vals else None

        latest_row = max(day_rows, key=lambda x: int(x["timestamp"] or 0))
        daily_records.append((
            day_date,
            {
                "id": latest_row["id"],
                "timestamp": int(latest_row["timestamp"] or 0),
                "date_str": str(latest_row["date_str"] or day_key),
                "weight_kg": _mean_col("weight_kg"),
                "body_fat_pct": _mean_col("body_fat_pct"),
                "lean_mass_kg": _mean_col("lean_mass_kg"),
                "muscle_mass_kg": _mean_col("muscle_mass_kg"),
                "water_pct": _mean_col("water_pct"),
            },
        ))

    # Compute 7-day calendar rolling average [d - 6d, d]
    computed_records = []
    for i, (cur_date, r) in enumerate(daily_records):
        window = [
            rec for d_prev, rec in daily_records[: i + 1]
            if 0 <= (cur_date - d_prev).days <= 6
        ]
        w_vals = [x["weight_kg"] for x in window if x.get("weight_kg") is not None and x["weight_kg"] > 0]
        bf_vals = [x["body_fat_pct"] for x in window if x.get("body_fat_pct") is not None and x["body_fat_pct"] > 0]

        r_copy = dict(r)
        r_copy["7d_avg_weight"] = round(sum(w_vals) / len(w_vals), 2) if w_vals else r["weight_kg"]
        r_copy["7d_avg_bf"] = round(sum(bf_vals) / len(bf_vals), 2) if bf_vals else r["body_fat_pct"]

        cur_ts = r["timestamp"] or 0
        if cutoff_ts is None or cur_ts >= cutoff_ts:
            computed_records.append(r_copy)

    return computed_records


def log_strength_set(
    exercise_id: str,
    weight: float,
    reps: int,
    e1rm: float,
    timestamp: Optional[str] = None,
    is_warmup: bool = False,
) -> int:
    _ensure_initialized()
    if not timestamp:
        timestamp = uk_now().isoformat()
    query = """
        INSERT INTO strength_logs (timestamp, exercise_id, weight, reps, e1rm, is_warmup)
        VALUES (?, ?, ?, ?, ?, ?)
    """
    with _managed_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(query, (timestamp, exercise_id, float(weight), int(reps), float(e1rm), 1 if is_warmup else 0))
        return cursor.lastrowid


def promote_recent_warmup_sets(
    exercise_id: str,
    weight: float,
    within_minutes: int = 45,
    conn: Optional[sqlite3.Connection] = None,
) -> int:
    """Promote recent same-weight warmup rows for exercise_id to working sets (is_warmup=0)."""
    if not exercise_id:
        return 0
    _ensure_initialized()
    cutoff_dt = uk_now() - timedelta(minutes=max(1, int(within_minutes)))
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT id, timestamp
            FROM strength_logs
            WHERE exercise_id = ? AND COALESCE(is_warmup, 0) = 1 AND ABS(weight - ?) <= 0.5
            """,
            (exercise_id, float(weight)),
        ).fetchall()
        ids_to_promote = []
        for r in rows:
            dt = _parse_uk_ts(r["timestamp"])
            if dt is not None and dt >= cutoff_dt:
                ids_to_promote.append(int(r["id"]))
        if not ids_to_promote:
            return 0
        placeholders = ",".join("?" for _ in ids_to_promote)
        cur = active_conn.execute(
            f"UPDATE strength_logs SET is_warmup = 0 WHERE id IN ({placeholders})",
            tuple(ids_to_promote),
        )
        return cur.rowcount or len(ids_to_promote)


def get_strength_history(days: int = 30, conn: Optional[sqlite3.Connection] = None) -> Dict[str, List[Dict[str, Any]]]:
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            "SELECT id, timestamp, exercise_id, weight, reps, e1rm FROM strength_logs WHERE COALESCE(is_warmup, 0) = 0"
        ).fetchall()

    cutoff_dt = (uk_now() - timedelta(days=days)) if (days and days > 0) else None
    parsed_rows = []
    for r in rows:
        dt = _parse_uk_ts(r["timestamp"])
        if cutoff_dt is not None:
            if dt is None or dt < cutoff_dt:
                continue
        sort_key = (dt or datetime.min.replace(tzinfo=UK_TZ), int(r["id"] or 0))
        parsed_rows.append((sort_key, r))
    parsed_rows.sort(key=lambda item: item[0])

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for _, r in parsed_rows:
        ex_id = r["exercise_id"]
        grouped.setdefault(ex_id, []).append({
            "id": r["id"],
            "timestamp": r["timestamp"],
            "weight": r["weight"],
            "reps": r["reps"],
            "e1rm": r["e1rm"],
        })
    return grouped


def add_hydration(date_str: str, amount_ml: int, timestamp: Optional[str] = None) -> int:
    _ensure_initialized()
    if not timestamp:
        timestamp = uk_now().isoformat()
    with _managed_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO hydration_logs (date_str, amount_ml, timestamp) VALUES (?, ?, ?)",
            (date_str, int(amount_ml), timestamp),
        )
        row = cursor.execute(
            "SELECT SUM(amount_ml) as total FROM hydration_logs WHERE date_str = ?",
            (date_str,),
        ).fetchone()
        return int(row["total"] or 0) if row and row["total"] is not None else int(amount_ml)


def get_hydration_total(date_str: str) -> int:
    _ensure_initialized()
    with _managed_conn() as conn:
        row = conn.execute(
            "SELECT SUM(amount_ml) as total FROM hydration_logs WHERE date_str = ?",
            (date_str,),
        ).fetchone()
        return int(row["total"] or 0) if row and row["total"] is not None else 0


def set_kv(key: str, value: str) -> None:
    _ensure_initialized()
    with _managed_conn() as conn:
        conn.execute(
            """
            INSERT INTO kv_store (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """,
            (key, value, uk_now().isoformat()),
        )


def get_kv(key: str, conn: Optional[sqlite3.Connection] = None) -> Optional[str]:
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute("SELECT value FROM kv_store WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row and row["value"] is not None else None


def claim_idempotency_key(scope: str, event_id: str) -> bool:
    """Atomically claim a scoped event ID in kv_store. Returns True if newly claimed, False on duplicate."""
    cleaned_id = str(event_id or "").strip()
    if not cleaned_id:
        return True
    cleaned_scope = str(scope or "default").strip()
    idem_key = f"idem:{cleaned_scope}:{cleaned_id}"
    _ensure_initialized()
    with _managed_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO kv_store (key, value, updated_at) VALUES (?, '1', ?)",
            (idem_key, uk_now().isoformat()),
        )
        return cursor.rowcount == 1


def log_workout_session(summary: Dict[str, Any]) -> int:
    if not isinstance(summary, dict):
        raise ValueError("Workout session summary must be a dict")
    _ensure_initialized()
    timestamp = str(summary.get("date") or uk_now().isoformat())
    preset = str(summary.get("preset") or "")
    goal = str(summary.get("goal") or "")
    exercises_completed = int(summary.get("exercisesCompleted") or 0)
    sets_logged = int(summary.get("setsLogged") or 0)
    calories = int(summary.get("calories") or 0)
    payload_json = json.dumps(summary, allow_nan=False)
    with _managed_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO workout_sessions (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json),
        )
        return cursor.lastrowid


def log_manual_activity(activity: Dict[str, Any]) -> None:
    if not isinstance(activity, dict):
        raise ValueError("Activity payload must be a dict")
    _ensure_initialized()
    act_id = str(activity.get("id") or int(uk_now().timestamp() * 1000))
    timestamp = str(activity.get("date") or uk_now().isoformat())
    name = str(activity.get("name") or "Activity")
    sub_title = str(activity.get("sub_title") or name)
    duration_min = float(activity.get("duration_min") or 0.0)
    calories = int(round(float(activity.get("calories") or 0)))
    avg_hr = int(round(float(activity.get("avg_hr") or 0)))
    max_hr = int(round(float(activity.get("max_hr") or 0)))
    payload_json = json.dumps(activity, allow_nan=False)
    with _managed_conn() as conn:
        conn.execute(
            """
            INSERT INTO manual_activities (id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                timestamp=excluded.timestamp,
                name=excluded.name,
                sub_title=excluded.sub_title,
                duration_min=excluded.duration_min,
                calories=excluded.calories,
                avg_hr=excluded.avg_hr,
                max_hr=excluded.max_hr,
                payload_json=excluded.payload_json
            """,
            (act_id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr, payload_json),
        )


def _opt_finite_int(val: Any) -> Optional[int]:
    if val is None or isinstance(val, bool):
        return None
    try:
        f = float(val)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(f):
        return None
    return int(round(f))


def upsert_daily_biometrics(
    date_str: str,
    sleep_score: Optional[int] = None,
    resting_hr: Optional[int] = None,
    body_battery: Optional[int] = None,
    training_readiness: Optional[int] = None,
    source: str = "garmin",
    overwrite_nulls: bool = False,
    *,
    hrv_last_night: Optional[float] = None,
    hrv_weekly_avg: Optional[float] = None,
    hrv_status: Optional[str] = None,
    hrv_baseline_low: Optional[float] = None,
    avg_stress: Optional[float] = None,
    sleep_avg_stress: Optional[float] = None,
    sleep_start_ts: Optional[int] = None,
    sleep_end_ts: Optional[int] = None,
    deep_sleep_sec: Optional[int] = None,
    rem_sleep_sec: Optional[int] = None,
    light_sleep_sec: Optional[int] = None,
    awake_sleep_sec: Optional[int] = None,
) -> None:
    if not date_str:
        return
    _ensure_initialized()
    if overwrite_nulls:
        sql = """
            INSERT INTO daily_biometrics (
                date_str, sleep_score, resting_hr, body_battery, training_readiness, source, updated_at,
                hrv_last_night, hrv_weekly_avg, hrv_status, hrv_baseline_low, avg_stress, sleep_avg_stress,
                sleep_start_ts, sleep_end_ts, deep_sleep_sec, rem_sleep_sec, light_sleep_sec, awake_sleep_sec
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date_str) DO UPDATE SET
                sleep_score = CASE WHEN daily_biometrics.source = 'mnd_estimated' THEN excluded.sleep_score ELSE COALESCE(excluded.sleep_score, daily_biometrics.sleep_score) END,
                resting_hr = CASE WHEN daily_biometrics.source = 'mnd_estimated' THEN excluded.resting_hr ELSE COALESCE(excluded.resting_hr, daily_biometrics.resting_hr) END,
                body_battery = CASE WHEN daily_biometrics.source = 'mnd_estimated' THEN excluded.body_battery ELSE COALESCE(excluded.body_battery, daily_biometrics.body_battery) END,
                training_readiness = CASE WHEN daily_biometrics.source = 'mnd_estimated' THEN excluded.training_readiness ELSE COALESCE(excluded.training_readiness, daily_biometrics.training_readiness) END,
                hrv_last_night = COALESCE(excluded.hrv_last_night, daily_biometrics.hrv_last_night),
                hrv_weekly_avg = COALESCE(excluded.hrv_weekly_avg, daily_biometrics.hrv_weekly_avg),
                hrv_status = COALESCE(excluded.hrv_status, daily_biometrics.hrv_status),
                hrv_baseline_low = COALESCE(excluded.hrv_baseline_low, daily_biometrics.hrv_baseline_low),
                avg_stress = COALESCE(excluded.avg_stress, daily_biometrics.avg_stress),
                sleep_avg_stress = COALESCE(excluded.sleep_avg_stress, daily_biometrics.sleep_avg_stress),
                sleep_start_ts = COALESCE(excluded.sleep_start_ts, daily_biometrics.sleep_start_ts),
                sleep_end_ts = COALESCE(excluded.sleep_end_ts, daily_biometrics.sleep_end_ts),
                deep_sleep_sec = COALESCE(excluded.deep_sleep_sec, daily_biometrics.deep_sleep_sec),
                rem_sleep_sec = COALESCE(excluded.rem_sleep_sec, daily_biometrics.rem_sleep_sec),
                light_sleep_sec = COALESCE(excluded.light_sleep_sec, daily_biometrics.light_sleep_sec),
                awake_sleep_sec = COALESCE(excluded.awake_sleep_sec, daily_biometrics.awake_sleep_sec),
                source = excluded.source,
                updated_at = excluded.updated_at
        """
    else:
        sql = """
            INSERT INTO daily_biometrics (
                date_str, sleep_score, resting_hr, body_battery, training_readiness, source, updated_at,
                hrv_last_night, hrv_weekly_avg, hrv_status, hrv_baseline_low, avg_stress, sleep_avg_stress,
                sleep_start_ts, sleep_end_ts, deep_sleep_sec, rem_sleep_sec, light_sleep_sec, awake_sleep_sec
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date_str) DO UPDATE SET
                sleep_score = COALESCE(excluded.sleep_score, daily_biometrics.sleep_score),
                resting_hr = COALESCE(excluded.resting_hr, daily_biometrics.resting_hr),
                body_battery = COALESCE(excluded.body_battery, daily_biometrics.body_battery),
                training_readiness = COALESCE(excluded.training_readiness, daily_biometrics.training_readiness),
                hrv_last_night = COALESCE(excluded.hrv_last_night, daily_biometrics.hrv_last_night),
                hrv_weekly_avg = COALESCE(excluded.hrv_weekly_avg, daily_biometrics.hrv_weekly_avg),
                hrv_status = COALESCE(excluded.hrv_status, daily_biometrics.hrv_status),
                hrv_baseline_low = COALESCE(excluded.hrv_baseline_low, daily_biometrics.hrv_baseline_low),
                avg_stress = COALESCE(excluded.avg_stress, daily_biometrics.avg_stress),
                sleep_avg_stress = COALESCE(excluded.sleep_avg_stress, daily_biometrics.sleep_avg_stress),
                sleep_start_ts = COALESCE(excluded.sleep_start_ts, daily_biometrics.sleep_start_ts),
                sleep_end_ts = COALESCE(excluded.sleep_end_ts, daily_biometrics.sleep_end_ts),
                deep_sleep_sec = COALESCE(excluded.deep_sleep_sec, daily_biometrics.deep_sleep_sec),
                rem_sleep_sec = COALESCE(excluded.rem_sleep_sec, daily_biometrics.rem_sleep_sec),
                light_sleep_sec = COALESCE(excluded.light_sleep_sec, daily_biometrics.light_sleep_sec),
                awake_sleep_sec = COALESCE(excluded.awake_sleep_sec, daily_biometrics.awake_sleep_sec),
                source = excluded.source,
                updated_at = excluded.updated_at
        """
    clean_hrv_status = str(hrv_status).strip()[:32] if hrv_status else None
    with _managed_conn() as conn:
        conn.execute(
            sql,
            (
                str(date_str)[:10],
                _opt_finite_int(sleep_score),
                _opt_finite_int(resting_hr),
                _opt_finite_int(body_battery),
                _opt_finite_int(training_readiness),
                str(source or "garmin"),
                uk_now().isoformat(),
                _opt_finite_round(hrv_last_night, 1),
                _opt_finite_round(hrv_weekly_avg, 1),
                clean_hrv_status,
                _opt_finite_round(hrv_baseline_low, 1),
                _opt_finite_round(avg_stress, 1),
                _opt_finite_round(sleep_avg_stress, 1),
                _opt_finite_int(sleep_start_ts),
                _opt_finite_int(sleep_end_ts),
                _opt_finite_int(deep_sleep_sec),
                _opt_finite_int(rem_sleep_sec),
                _opt_finite_int(light_sleep_sec),
                _opt_finite_int(awake_sleep_sec),
            ),
        )


def upsert_daily_nutrition(
    date_str: str,
    calories: int,
    protein_g: int,
    carbs_g: int,
    fat_g: int,
    source: str = "mnd",
    preserve_manual: bool = False,
) -> None:
    if not date_str:
        return
    _ensure_initialized()
    where_clause = " WHERE COALESCE(daily_nutrition_logs.source, '') != 'manual'" if preserve_manual else ""
    sql = f"""
        INSERT INTO daily_nutrition_logs (date_str, calories, protein_g, carbs_g, fat_g, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date_str) DO UPDATE SET
            calories = excluded.calories,
            protein_g = excluded.protein_g,
            carbs_g = excluded.carbs_g,
            fat_g = excluded.fat_g,
            source = excluded.source,
            updated_at = excluded.updated_at{where_clause}
    """
    with _managed_conn() as conn:
        conn.execute(
            sql,
            (
                str(date_str)[:10],
                max(0, int(round(float(calories or 0)))),
                max(0, int(round(float(protein_g or 0)))),
                max(0, int(round(float(carbs_g or 0)))),
                max(0, int(round(float(fat_g or 0)))),
                str(source or "mnd"),
                uk_now().isoformat(),
            ),
        )


def get_daily_biometrics(days: int = 28, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_date = (uk_now().date() - timedelta(days=max(1, int(days)))).isoformat()
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT date_str, sleep_score, resting_hr, body_battery, training_readiness, source, updated_at,
                   hrv_last_night, hrv_weekly_avg, hrv_status, hrv_baseline_low, avg_stress, sleep_avg_stress,
                   sleep_start_ts, sleep_end_ts, deep_sleep_sec, rem_sleep_sec, light_sleep_sec, awake_sleep_sec
            FROM daily_biometrics
            WHERE date_str >= ?
            ORDER BY date_str ASC
            """,
            (cutoff_date,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_daily_nutrition(days: int = 21, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_date = (uk_now().date() - timedelta(days=max(1, int(days)))).isoformat()
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT date_str, calories, protein_g, carbs_g, fat_g, source, updated_at
            FROM daily_nutrition_logs
            WHERE date_str >= ?
            ORDER BY date_str ASC
            """,
            (cutoff_date,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_workout_sessions(days: int = 35, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_dt = uk_now() - timedelta(days=max(1, int(days)))
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT id, timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json
            FROM workout_sessions
            ORDER BY id DESC
            """
        ).fetchall()
    results: List[Dict[str, Any]] = []
    for r in rows:
        dt = _parse_uk_ts(r["timestamp"])
        if dt is None or dt < cutoff_dt:
            continue
        payload: Dict[str, Any] = {}
        if r["payload_json"]:
            try:
                parsed = json.loads(r["payload_json"])
                if not isinstance(parsed, dict):
                    logger.warning(f"[DB] Skipping workout_session id={r['id']}: payload_json is not a dict")
                    continue
                payload = parsed
            except Exception as exc:
                logger.warning(f"[DB] Skipping corrupt workout_session id={r['id']}: {exc}")
                continue
        results.append({
            "id": r["id"],
            "date_str": dt.date().isoformat(),
            "timestamp": dt.isoformat(),
            "preset": r["preset"],
            "goal": r["goal"],
            "exercises_completed": int(r["exercises_completed"] or 0),
            "sets_logged": int(r["sets_logged"] or 0),
            "calories": int(r["calories"] or 0),
            "payload": payload,
        })
    return results


def get_manual_activities(days: int = 35, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_dt = uk_now() - timedelta(days=max(1, int(days)))
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr, payload_json
            FROM manual_activities
            ORDER BY timestamp DESC
            """
        ).fetchall()
    results: List[Dict[str, Any]] = []
    for r in rows:
        dt = _parse_uk_ts(r["timestamp"])
        if dt is None or dt < cutoff_dt:
            continue
        payload: Dict[str, Any] = {}
        if r["payload_json"]:
            try:
                parsed = json.loads(r["payload_json"])
                if not isinstance(parsed, dict):
                    logger.warning(f"[DB] Skipping manual_activity id={r['id']}: payload_json is not a dict")
                    continue
                payload = parsed
            except Exception as exc:
                logger.warning(f"[DB] Skipping corrupt manual_activity id={r['id']}: {exc}")
                continue
        results.append({
            "id": r["id"],
            "date_str": dt.date().isoformat(),
            "timestamp": dt.isoformat(),
            "name": r["name"],
            "sub_title": r["sub_title"],
            "duration_min": float(r["duration_min"] or 0.0),
            "calories": int(r["calories"] or 0),
            "avg_hr": int(r["avg_hr"] or 0),
            "max_hr": int(r["max_hr"] or 0),
            "payload": payload,
        })
    return results


def get_strength_pr_map(conn: Optional[sqlite3.Connection] = None) -> Dict[str, Dict[str, Any]]:
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT s.exercise_id, s.e1rm, s.weight, s.reps, s.timestamp
            FROM strength_logs s
            JOIN (
                SELECT exercise_id, MAX(e1rm) AS max_e1rm
                FROM strength_logs
                WHERE weight > 0 AND reps > 0 AND e1rm IS NOT NULL AND e1rm > 0 AND COALESCE(is_warmup, 0) = 0
                GROUP BY exercise_id
            ) m ON s.exercise_id = m.exercise_id AND s.e1rm = m.max_e1rm
            WHERE s.weight > 0 AND s.reps > 0 AND COALESCE(s.is_warmup, 0) = 0
            ORDER BY s.id DESC
            """
        ).fetchall()
    pr_map: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        ex_id = r["exercise_id"]
        if ex_id and ex_id not in pr_map:
            pr_map[ex_id] = {
                "e1rm": round(float(r["e1rm"]), 1),
                "weight": float(r["weight"]),
                "reps": int(r["reps"]),
                "timestamp": r["timestamp"],
            }
    return pr_map


def get_exercise_best_e1rm(exercise_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[float]:
    if not exercise_id:
        return None
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute(
            """
            SELECT MAX(e1rm) AS max_e1rm
            FROM strength_logs
            WHERE exercise_id = ? AND weight > 0 AND reps > 0 AND e1rm IS NOT NULL AND e1rm > 0 AND COALESCE(is_warmup, 0) = 0
            """,
            (exercise_id,),
        ).fetchone()
    if row and row["max_e1rm"] is not None:
        return round(float(row["max_e1rm"]), 1)
    return None


def save_diagnostic_assessment(record: Dict[str, Any], conn: Optional[sqlite3.Connection] = None) -> None:
    """Persist a diagnostic assessment and prune oldest records beyond 50 rows."""
    if not isinstance(record, dict) or not record.get("id"):
        raise ValueError("Diagnostic assessment record requires an id")
    _ensure_initialized()
    report_obj = record.get("report") if isinstance(record.get("report"), dict) else {}
    affected = record.get("affected_joints")
    if affected is None and isinstance(report_obj.get("adaptor_handoff"), dict):
        affected = report_obj["adaptor_handoff"].get("affected_joints")
    with _managed_conn(conn) as active_conn:
        active_conn.execute(
            """
            INSERT INTO diagnostic_assessments (
                id, created_at, date_str, input_mode, raw_text,
                anatomical_region, severity, triage_level, engine,
                affected_joints_json, report_json, applied_to_adaptor, applied_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                report_json = excluded.report_json,
                anatomical_region = excluded.anatomical_region,
                severity = excluded.severity,
                triage_level = excluded.triage_level,
                engine = excluded.engine,
                affected_joints_json = excluded.affected_joints_json
            """,
            (
                str(record["id"]),
                str(record.get("created_at") or uk_now().isoformat()),
                str(record.get("date_str") or uk_now().date().isoformat())[:10],
                str(record.get("input_mode") or "text")[:32],
                str(record.get("raw_text") or "")[:2000],
                str(record.get("anatomical_region") or report_obj.get("anatomical_region") or "other_unspecified"),
                str(record.get("severity") or report_obj.get("severity") or "moderate"),
                str(record.get("triage_level") or report_obj.get("triage_level") or "amber_deload"),
                str(record.get("engine") or report_obj.get("engine") or "deterministic_fallback"),
                json.dumps(list(affected or []), allow_nan=False),
                json.dumps(report_obj, allow_nan=False),
                int(bool(record.get("applied_to_adaptor", False))),
                record.get("applied_at"),
            ),
        )
        active_conn.execute(
            """
            DELETE FROM diagnostic_assessments
            WHERE id NOT IN (
                SELECT id FROM diagnostic_assessments
                ORDER BY created_at DESC, rowid DESC
                LIMIT 50
            )
            """
        )


def _row_to_diagnostic_entry(row: sqlite3.Row) -> Optional[Dict[str, Any]]:
    report = None
    if row["report_json"]:
        try:
            parsed = json.loads(row["report_json"])
            if isinstance(parsed, dict):
                report = parsed
        except Exception as exc:
            logger.warning(f"[DB] Skipping corrupt diagnostic_assessment id={row['id']}: {exc}")
            return None
    affected_joints: List[str] = []
    if row["affected_joints_json"]:
        try:
            parsed_j = json.loads(row["affected_joints_json"])
            if isinstance(parsed_j, list):
                affected_joints = [str(x) for x in parsed_j]
        except Exception:
            affected_joints = []
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "date_str": row["date_str"],
        "input_mode": row["input_mode"],
        "raw_text": row["raw_text"],
        "anatomical_region": row["anatomical_region"],
        "severity": row["severity"],
        "triage_level": row["triage_level"],
        "engine": row["engine"],
        "affected_joints": affected_joints,
        "report": report,
        "applied_to_adaptor": bool(row["applied_to_adaptor"]),
        "applied_at": row["applied_at"],
    }


def get_recent_diagnostic_assessments(limit: int = 10, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    capped = max(1, min(50, int(limit or 10)))
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT id, created_at, date_str, input_mode, raw_text,
                   anatomical_region, severity, triage_level, engine,
                   affected_joints_json, report_json, applied_to_adaptor, applied_at
            FROM diagnostic_assessments
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?
            """,
            (capped,),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        item = _row_to_diagnostic_entry(r)
        if item is not None:
            out.append(item)
    return out


def get_diagnostic_assessment(assessment_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    if not assessment_id:
        return None
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute(
            """
            SELECT id, created_at, date_str, input_mode, raw_text,
                   anatomical_region, severity, triage_level, engine,
                   affected_joints_json, report_json, applied_to_adaptor, applied_at
            FROM diagnostic_assessments
            WHERE id = ?
            """,
            (str(assessment_id),),
        ).fetchone()
    return _row_to_diagnostic_entry(row) if row else None


def mark_diagnostic_applied(assessment_id: str, conn: Optional[sqlite3.Connection] = None) -> bool:
    if not assessment_id:
        return False
    _ensure_initialized()
    now_iso = uk_now().isoformat()
    with _managed_conn(conn) as active_conn:
        cur = active_conn.execute(
            """
            UPDATE diagnostic_assessments
            SET applied_to_adaptor = 1,
                applied_at = COALESCE(applied_at, ?)
            WHERE id = ?
            """,
            (now_iso, str(assessment_id)),
        )
        return cur.rowcount > 0


# ==================== GARMIN INTRADAY TELEMETRY, ILLNESS & PAROXYSMAL EPISODES ====================

def _safe_json_loads(raw: Any, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        parsed = json.loads(raw)
        if type(parsed) is type(fallback):
            return parsed
    except Exception:
        pass
    return fallback


def upsert_garmin_intraday(
    date_str: str,
    stress_samples: Optional[List[List[int]]] = None,
    hr_samples: Optional[List[List[int]]] = None,
    sleep_stress_samples: Optional[List[List[int]]] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> None:
    if not date_str:
        return
    _ensure_initialized()
    d_key = str(date_str)[:10]
    stress_json = json.dumps(stress_samples, allow_nan=False) if stress_samples is not None else None
    hr_json = json.dumps(hr_samples, allow_nan=False) if hr_samples is not None else None
    sleep_stress_json = json.dumps(sleep_stress_samples, allow_nan=False) if sleep_stress_samples is not None else None
    prune_cutoff = (uk_now().date() - timedelta(days=30)).isoformat()
    now_iso = uk_now().isoformat()
    with _managed_conn(conn) as active_conn:
        active_conn.execute(
            """
            INSERT INTO garmin_intraday_telemetry (date_str, stress_json, hr_json, sleep_stress_json, synced_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date_str) DO UPDATE SET
                stress_json = COALESCE(excluded.stress_json, garmin_intraday_telemetry.stress_json),
                hr_json = COALESCE(excluded.hr_json, garmin_intraday_telemetry.hr_json),
                sleep_stress_json = COALESCE(excluded.sleep_stress_json, garmin_intraday_telemetry.sleep_stress_json),
                synced_at = excluded.synced_at
            """,
            (d_key, stress_json, hr_json, sleep_stress_json, now_iso),
        )
        active_conn.execute("DELETE FROM garmin_intraday_telemetry WHERE date_str < ?", (prune_cutoff,))


def _row_to_intraday_entry(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "date_str": str(row["date_str"]),
        "stress_samples": _safe_json_loads(row["stress_json"], []),
        "hr_samples": _safe_json_loads(row["hr_json"], []),
        "sleep_stress_samples": _safe_json_loads(row["sleep_stress_json"], []),
        "synced_at": row["synced_at"],
    }


def get_garmin_intraday(date_str: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    if not date_str:
        return None
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute(
            """
            SELECT date_str, stress_json, hr_json, sleep_stress_json, synced_at
            FROM garmin_intraday_telemetry
            WHERE date_str = ?
            """,
            (str(date_str)[:10],),
        ).fetchone()
    return _row_to_intraday_entry(row) if row else None


def get_garmin_intraday_range(date_strs: List[str], conn: Optional[sqlite3.Connection] = None) -> Dict[str, Dict[str, Any]]:
    clean_dates = sorted({str(d)[:10] for d in (date_strs or []) if d})
    if not clean_dates:
        return {}
    _ensure_initialized()
    placeholders = ",".join("?" for _ in clean_dates)
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            f"""
            SELECT date_str, stress_json, hr_json, sleep_stress_json, synced_at
            FROM garmin_intraday_telemetry
            WHERE date_str IN ({placeholders})
            ORDER BY date_str ASC
            """,
            tuple(clean_dates),
        ).fetchall()
    return {str(r["date_str"]): _row_to_intraday_entry(r) for r in rows}


def _row_to_illness_log(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "date_str": str(row["date_str"]),
        "status": str(row["status"] or "active"),
        "severity": str(row["severity"] or "moderate"),
        "symptoms": [str(x) for x in _safe_json_loads(row["symptoms_json"], [])],
        "notes": str(row["notes"] or ""),
        "created_at": str(row["created_at"] or ""),
        "updated_at": str(row["updated_at"] or ""),
    }


def upsert_illness_log(
    date_str: str,
    status: str = "active",
    severity: str = "moderate",
    symptoms: Optional[List[str]] = None,
    notes: str = "",
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    d_key = str(date_str or "")[:10]
    if not d_key:
        raise ValueError("date_str is required")
    _ensure_initialized()
    now_iso = uk_now().isoformat()
    clean_symptoms = [str(s)[:64] for s in (symptoms or []) if str(s).strip()]
    clean_status = str(status or "active").strip().lower()
    if clean_status not in ("active", "recovering"):
        clean_status = "active"
    clean_sev = str(severity or "moderate").strip().lower()
    if clean_sev not in ("mild", "moderate", "severe"):
        clean_sev = "moderate"
    clean_notes = str(notes or "")[:1000]
    with _managed_conn(conn) as active_conn:
        active_conn.execute(
            """
            INSERT INTO illness_logs (date_str, status, severity, symptoms_json, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date_str) DO UPDATE SET
                status = excluded.status,
                severity = excluded.severity,
                symptoms_json = excluded.symptoms_json,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            (d_key, clean_status, clean_sev, json.dumps(clean_symptoms, allow_nan=False), clean_notes, now_iso, now_iso),
        )
        row = active_conn.execute(
            "SELECT date_str, status, severity, symptoms_json, notes, created_at, updated_at FROM illness_logs WHERE date_str = ?",
            (d_key,),
        ).fetchone()
    return _row_to_illness_log(row)


def delete_illness_log(date_str: str, conn: Optional[sqlite3.Connection] = None) -> bool:
    d_key = str(date_str or "")[:10]
    if not d_key:
        return False
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        cur = active_conn.execute("DELETE FROM illness_logs WHERE date_str = ?", (d_key,))
        return cur.rowcount > 0


def get_illness_log(date_str: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    d_key = str(date_str or "")[:10]
    if not d_key:
        return None
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute(
            "SELECT date_str, status, severity, symptoms_json, notes, created_at, updated_at FROM illness_logs WHERE date_str = ?",
            (d_key,),
        ).fetchone()
    return _row_to_illness_log(row) if row else None


def get_illness_logs(days: int = 90, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_date = (uk_now().date() - timedelta(days=max(1, int(days)))).isoformat()
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT date_str, status, severity, symptoms_json, notes, created_at, updated_at
            FROM illness_logs
            WHERE date_str >= ?
            ORDER BY date_str DESC
            """,
            (cutoff_date,),
        ).fetchall()
    return [_row_to_illness_log(r) for r in rows]


def _row_to_paroxysmal_episode(row: sqlite3.Row) -> Dict[str, Any]:
    snapshot_obj = None
    if row["biometric_snapshot_json"]:
        try:
            parsed_snap = json.loads(row["biometric_snapshot_json"])
            if isinstance(parsed_snap, dict):
                snapshot_obj = parsed_snap
        except Exception:
            snapshot_obj = None
    return {
        "id": str(row["id"]),
        "state": str(row["state"]),
        "onset_time": str(row["onset_time"]),
        "date_str": str(row["date_str"]),
        "acute_peak_end_time": row["acute_peak_end_time"],
        "full_recovery_time": row["full_recovery_time"],
        "user_recovered_at": row["user_recovered_at"],
        "biometric_recovered_at": row["biometric_recovered_at"],
        "acute_duration_mins": row["acute_duration_mins"],
        "total_recovery_duration_mins": row["total_recovery_duration_mins"],
        "severity": str(row["severity"] or "moderate"),
        "symptoms": [str(x) for x in _safe_json_loads(row["symptoms_json"], [])],
        "triggers": [str(x) for x in _safe_json_loads(row["triggers_json"], [])],
        "pathway_tags": [str(x) for x in _safe_json_loads(row["pathway_tags_json"], [])],
        "illness_active": bool(row["illness_active"]),
        "notes": str(row["notes"] or ""),
        "biometric_snapshot": snapshot_obj,
        "biometric_snapshot_status": str(row["biometric_snapshot_status"] or "pending"),
        "spike_auto_detected": bool(row["spike_auto_detected"]),
        "client_event_id": row["client_event_id"],
        "created_at": str(row["created_at"] or ""),
        "updated_at": str(row["updated_at"] or ""),
    }


def create_paroxysmal_episode(record: Dict[str, Any], conn: Optional[sqlite3.Connection] = None) -> Dict[str, Any]:
    if not isinstance(record, dict) or not record.get("id") or not record.get("onset_time"):
        raise ValueError("Episode record requires id and onset_time")
    _ensure_initialized()
    now_iso = uk_now().isoformat()
    snapshot_json = json.dumps(record["biometric_snapshot"], allow_nan=False) if isinstance(record.get("biometric_snapshot"), dict) else None
    with _managed_conn(conn) as active_conn:
        active_conn.execute(
            """
            INSERT INTO paroxysmal_episodes (
                id, state, onset_time, date_str, acute_peak_end_time, full_recovery_time,
                user_recovered_at, biometric_recovered_at, acute_duration_mins, total_recovery_duration_mins,
                severity, symptoms_json, triggers_json, pathway_tags_json, illness_active,
                notes, biometric_snapshot_json, biometric_snapshot_status, spike_auto_detected,
                client_event_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(record["id"]),
                str(record.get("state") or "ACUTE_EPISODE"),
                str(record["onset_time"]),
                str(record.get("date_str") or str(record["onset_time"])[:10])[:10],
                record.get("acute_peak_end_time"),
                record.get("full_recovery_time"),
                record.get("user_recovered_at"),
                record.get("biometric_recovered_at"),
                _opt_finite_int(record.get("acute_duration_mins")),
                _opt_finite_int(record.get("total_recovery_duration_mins")),
                str(record.get("severity") or "moderate"),
                json.dumps(list(record.get("symptoms") or []), allow_nan=False),
                json.dumps(list(record.get("triggers") or []), allow_nan=False),
                json.dumps(list(record.get("pathway_tags") or []), allow_nan=False),
                1 if record.get("illness_active") else 0,
                str(record.get("notes") or "")[:2000],
                snapshot_json,
                str(record.get("biometric_snapshot_status") or "pending"),
                1 if record.get("spike_auto_detected") else 0,
                str(record.get("client_event_id") or "") or None,
                str(record.get("created_at") or now_iso),
                str(record.get("updated_at") or now_iso),
            ),
        )
        row = active_conn.execute("SELECT * FROM paroxysmal_episodes WHERE id = ?", (str(record["id"]),)).fetchone()
    return _row_to_paroxysmal_episode(row)


def update_paroxysmal_episode(episode_id: str, fields: Dict[str, Any], conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    if not episode_id or not isinstance(fields, dict):
        return None
    _ensure_initialized()
    col_map = {
        "state": ("state", lambda v: str(v)),
        "onset_time": ("onset_time", lambda v: str(v)),
        "date_str": ("date_str", lambda v: str(v)[:10]),
        "acute_peak_end_time": ("acute_peak_end_time", lambda v: str(v) if v is not None else None),
        "full_recovery_time": ("full_recovery_time", lambda v: str(v) if v is not None else None),
        "user_recovered_at": ("user_recovered_at", lambda v: str(v) if v is not None else None),
        "biometric_recovered_at": ("biometric_recovered_at", lambda v: str(v) if v is not None else None),
        "acute_duration_mins": ("acute_duration_mins", lambda v: _opt_finite_int(v)),
        "total_recovery_duration_mins": ("total_recovery_duration_mins", lambda v: _opt_finite_int(v)),
        "severity": ("severity", lambda v: str(v or "moderate")),
        "symptoms": ("symptoms_json", lambda v: json.dumps(list(v or []), allow_nan=False)),
        "triggers": ("triggers_json", lambda v: json.dumps(list(v or []), allow_nan=False)),
        "pathway_tags": ("pathway_tags_json", lambda v: json.dumps(list(v or []), allow_nan=False)),
        "illness_active": ("illness_active", lambda v: 1 if v else 0),
        "notes": ("notes", lambda v: str(v or "")[:2000]),
        "biometric_snapshot": ("biometric_snapshot_json", lambda v: json.dumps(v, allow_nan=False) if isinstance(v, dict) else None),
        "biometric_snapshot_status": ("biometric_snapshot_status", lambda v: str(v or "pending")),
    }
    assignments: List[str] = []
    params: List[Any] = []
    for key, val in fields.items():
        if key in col_map:
            col_name, converter = col_map[key]
            assignments.append(f"{col_name} = ?")
            params.append(converter(val))
    if not assignments:
        return get_paroxysmal_episode(episode_id, conn=conn)
    assignments.append("updated_at = ?")
    params.append(uk_now().isoformat())
    params.append(str(episode_id))
    with _managed_conn(conn) as active_conn:
        cur = active_conn.execute(
            f"UPDATE paroxysmal_episodes SET {', '.join(assignments)} WHERE id = ?",
            tuple(params),
        )
        if cur.rowcount == 0:
            return None
        row = active_conn.execute("SELECT * FROM paroxysmal_episodes WHERE id = ?", (str(episode_id),)).fetchone()
    return _row_to_paroxysmal_episode(row) if row else None


def delete_paroxysmal_episode(episode_id: str, conn: Optional[sqlite3.Connection] = None) -> bool:
    if not episode_id:
        return False
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        cur = active_conn.execute("DELETE FROM paroxysmal_episodes WHERE id = ?", (str(episode_id),))
        return cur.rowcount > 0


def get_paroxysmal_episode(episode_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    if not episode_id:
        return None
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute("SELECT * FROM paroxysmal_episodes WHERE id = ?", (str(episode_id),)).fetchone()
    return _row_to_paroxysmal_episode(row) if row else None


def get_paroxysmal_episode_by_client_event_id(client_event_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    cleaned = str(client_event_id or "").strip()
    if not cleaned:
        return None
    _ensure_initialized()
    with _managed_conn(conn) as active_conn:
        row = active_conn.execute(
            "SELECT * FROM paroxysmal_episodes WHERE client_event_id = ? ORDER BY created_at DESC LIMIT 1",
            (cleaned,),
        ).fetchone()
    return _row_to_paroxysmal_episode(row) if row else None


def get_paroxysmal_episodes(days: int = 365, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    _ensure_initialized()
    cutoff_date = (uk_now().date() - timedelta(days=max(1, int(days)))).isoformat()
    with _managed_conn(conn) as active_conn:
        rows = active_conn.execute(
            """
            SELECT * FROM paroxysmal_episodes
            WHERE date_str >= ?
            ORDER BY onset_time DESC, created_at DESC
            """,
            (cutoff_date,),
        ).fetchall()
    return [_row_to_paroxysmal_episode(r) for r in rows]
