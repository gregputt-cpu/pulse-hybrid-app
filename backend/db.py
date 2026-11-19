import os
import json
import sqlite3
import logging
import threading
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from time_utils import uk_now, uk_timestamp_str

logger = logging.getLogger("pulse-db")

DATA_DIR = os.environ.get(
    "DATA_DIR",
    "/data" if os.path.exists("/data") else os.path.dirname(os.path.abspath(__file__))
)
DB_PATH = os.path.join(DATA_DIR, "pulse.db")
_INIT_LOCK = threading.Lock()
_INITIALIZED_DB_PATH: Optional[str] = None

def get_connection() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=10000")
    except sqlite3.Error:
        pass
    return conn

def init_db(force: bool = False) -> None:
    global _INITIALIZED_DB_PATH
    if not force and _INITIALIZED_DB_PATH == DB_PATH:
        return
    with _INIT_LOCK:
        if not force and _INITIALIZED_DB_PATH == DB_PATH:
            return
        _init_db_unlocked()
        _INITIALIZED_DB_PATH = DB_PATH

def _init_db_unlocked() -> None:
    with get_connection() as conn:
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
                e1rm REAL
            )
        """)
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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_renpho_timestamp ON renpho_history(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_strength_timestamp ON strength_logs(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hydration_date ON hydration_logs(date_str)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON workout_sessions(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_manual_activities_timestamp ON manual_activities(timestamp)")
        conn.commit()

        # Auto-seed from renpho_seed.json if table is empty, or migrate legacy muscle % rows once
        cursor.execute("SELECT COUNT(*) FROM renpho_history")
        count = cursor.fetchone()[0]
        cursor.execute("SELECT value FROM kv_store WHERE key = 'migrated_renpho_muscle_kg_v1'")
        migrated_row = cursor.fetchone()
        seed_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "renpho_seed.json")

        if count == 0 or migrated_row is None:
            if os.path.exists(seed_path):
                try:
                    with open(seed_path, "r", encoding="utf-8") as f:
                        seed_items = json.load(f)
                    if isinstance(seed_items, list) and seed_items:
                        _insert_renpho_records(conn, seed_items)
                except Exception as e:
                    logger.warning(f"[DB] Failed loading renpho_seed.json: {e}")
            if migrated_row is None:
                # Fix any remaining non-seed rows where skeletal muscle % (<65) was stored as muscle_mass_kg
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
                conn.commit()

def _insert_renpho_records(conn: sqlite3.Connection, items: List[Any]) -> int:
    records = []
    for item in items:
        if isinstance(item, dict):
            raw_id = item.get("id") or item.get("raw_id")
            ts = item.get("timeStamp") or item.get("timestamp") or 0
            try:
                ts = int(ts)
            except (ValueError, TypeError):
                ts = 0
            m_id = str(raw_id) if raw_id is not None and str(raw_id).strip() else (f"renpho_{ts}" if ts else f"renpho_{uk_now().timestamp()}")

            if ts:
                try:
                    date_str = uk_timestamp_str(ts)
                except Exception:
                    date_str = str(item.get("date_str") or item.get("localCreatedAt") or uk_now().strftime("%Y-%m-%d %H:%M:%S"))
            else:
                date_str = str(item.get("date_str") or item.get("localCreatedAt") or uk_now().strftime("%Y-%m-%d %H:%M:%S"))

            w = item.get("weight_kg") if item.get("weight_kg") is not None else item.get("weight")
            bf = item.get("body_fat_pct") if item.get("body_fat_pct") is not None else item.get("bodyfat")
            lm = item.get("lean_mass_kg") if item.get("lean_mass_kg") is not None else item.get("fatFreeWeight")
            bone_val = item.get("bone_mass_kg") if item.get("bone_mass_kg") is not None else item.get("bone")
            mm = item.get("muscle_mass_kg") if item.get("muscle_mass_kg") is not None else item.get("sinew")
            if mm is None and lm is not None and bone_val is not None:
                try:
                    mm = max(0.0, float(lm) - float(bone_val))
                except (ValueError, TypeError):
                    mm = None
            water = item.get("water_pct") if item.get("water_pct") is not None else item.get("water")

            weight_kg = round(float(w), 2) if w is not None else None
            body_fat_pct = round(float(bf), 2) if bf is not None else None
            lean_mass_kg = round(float(lm), 2) if lm is not None else None
            muscle_mass_kg = round(float(mm), 2) if mm is not None else None
            water_pct = round(float(water), 2) if water is not None else None

            records.append((m_id, ts, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct))
        else:
            raw_id = getattr(item, "id", None)
            ts = getattr(item, "timestamp", None) or getattr(item, "timeStamp", 0) or 0
            try:
                ts = int(ts)
            except (ValueError, TypeError):
                ts = 0
            m_id = str(raw_id) if raw_id is not None and str(raw_id).strip() else (f"renpho_{ts}" if ts else f"renpho_{uk_now().timestamp()}")

            if ts:
                try:
                    date_str = uk_timestamp_str(ts)
                except Exception:
                    date_str = str(getattr(item, "date_str", None) or getattr(item, "localCreatedAt", None) or uk_now().strftime("%Y-%m-%d %H:%M:%S"))
            else:
                date_str = str(getattr(item, "date_str", None) or getattr(item, "localCreatedAt", None) or uk_now().strftime("%Y-%m-%d %H:%M:%S"))

            w = getattr(item, "weight_kg", None) if getattr(item, "weight_kg", None) is not None else getattr(item, "weight", None)
            bf = getattr(item, "body_fat_pct", None) if getattr(item, "body_fat_pct", None) is not None else getattr(item, "bodyfat", None)
            lm = getattr(item, "lean_mass_kg", None) if getattr(item, "lean_mass_kg", None) is not None else getattr(item, "fat_free_weight", None)
            if lm is None:
                lm = getattr(item, "fatFreeWeight", None)
            bone_val = getattr(item, "bone_mass_kg", None) if getattr(item, "bone_mass_kg", None) is not None else getattr(item, "bone", None)
            mm = getattr(item, "muscle_mass_kg", None) if getattr(item, "muscle_mass_kg", None) is not None else getattr(item, "sinew", None)
            if mm is None and lm is not None and bone_val is not None:
                try:
                    mm = max(0.0, float(lm) - float(bone_val))
                except (ValueError, TypeError):
                    mm = None
            water = getattr(item, "water_pct", None) if getattr(item, "water_pct", None) is not None else getattr(item, "water", None)

            weight_kg = round(float(w), 2) if w is not None else None
            body_fat_pct = round(float(bf), 2) if bf is not None else None
            lean_mass_kg = round(float(lm), 2) if lm is not None else None
            muscle_mass_kg = round(float(mm), 2) if mm is not None else None
            water_pct = round(float(water), 2) if water is not None else None

            records.append((m_id, ts, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct))

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

# Ensure tables are created upon module import
import json
init_db()

def upsert_renpho_measurements(items: List[Any]) -> int:
    if not items:
        return 0
    init_db()
    with get_connection() as conn:
        return _insert_renpho_records(conn, items)

def get_renpho_history(days: int = 90) -> List[Dict[str, Any]]:
    init_db()
    cutoff_ts = None
    query_ts = 0
    if days and days > 0:
        cutoff_ts = int((uk_now() - timedelta(days=days)).timestamp())
        # Fetch an extra 7 days prior to cutoff so rolling averages on edge days are accurate
        query_ts = cutoff_ts - (7 * 86400)

    with get_connection() as conn:
        cursor = conn.cursor()
        if cutoff_ts is not None:
            cursor.execute(
                "SELECT id, timestamp, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct FROM renpho_history WHERE timestamp >= ? ORDER BY timestamp ASC",
                (query_ts,)
            )
        else:
            cursor.execute(
                "SELECT id, timestamp, date_str, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct FROM renpho_history ORDER BY timestamp ASC"
            )
        rows = cursor.fetchall()

    all_records = []
    for r in rows:
        all_records.append({
            "id": r["id"],
            "timestamp": r["timestamp"],
            "date_str": r["date_str"],
            "weight_kg": r["weight_kg"],
            "body_fat_pct": r["body_fat_pct"],
            "lean_mass_kg": r["lean_mass_kg"],
            "muscle_mass_kg": r["muscle_mass_kg"],
            "water_pct": r["water_pct"]
        })

    # Compute 7d rolling average for weight and body fat
    computed_records = []
    seven_days_sec = 7 * 86400

    for i, r in enumerate(all_records):
        cur_ts = r["timestamp"] or 0
        window = [
            x for x in all_records[:i+1]
            if (cur_ts - (x["timestamp"] or 0)) <= seven_days_sec
        ]

        w_vals = [x["weight_kg"] for x in window if x.get("weight_kg") is not None and x["weight_kg"] > 0]
        bf_vals = [x["body_fat_pct"] for x in window if x.get("body_fat_pct") is not None and x["body_fat_pct"] > 0]

        r_copy = dict(r)
        r_copy["7d_avg_weight"] = round(sum(w_vals) / len(w_vals), 2) if w_vals else r["weight_kg"]
        r_copy["7d_avg_bf"] = round(sum(bf_vals) / len(bf_vals), 2) if bf_vals else r["body_fat_pct"]

        if cutoff_ts is None or (cur_ts >= cutoff_ts):
            computed_records.append(r_copy)

    return computed_records

def log_strength_set(exercise_id: str, weight: float, reps: int, e1rm: float, timestamp: Optional[str] = None) -> int:
    init_db()
    if not timestamp:
        timestamp = uk_now().isoformat()
    query = """
        INSERT INTO strength_logs (timestamp, exercise_id, weight, reps, e1rm)
        VALUES (?, ?, ?, ?, ?)
    """
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, (timestamp, exercise_id, float(weight), int(reps), float(e1rm)))
        conn.commit()
        return cursor.lastrowid

def get_strength_history(days: int = 30) -> Dict[str, List[Dict[str, Any]]]:
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        if days and days > 0:
            cutoff = (uk_now() - timedelta(days=days)).isoformat()
            cursor.execute(
                "SELECT id, timestamp, exercise_id, weight, reps, e1rm FROM strength_logs WHERE timestamp >= ? ORDER BY timestamp ASC",
                (cutoff,)
            )
        else:
            cursor.execute(
                "SELECT id, timestamp, exercise_id, weight, reps, e1rm FROM strength_logs ORDER BY timestamp ASC"
            )
        rows = cursor.fetchall()

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        ex_id = r["exercise_id"]
        grouped.setdefault(ex_id, []).append({
            "id": r["id"],
            "timestamp": r["timestamp"],
            "weight": r["weight"],
            "reps": r["reps"],
            "e1rm": r["e1rm"]
        })
    return grouped

def add_hydration(date_str: str, amount_ml: int, timestamp: Optional[str] = None) -> int:
    init_db()
    if not timestamp:
        timestamp = uk_now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO hydration_logs (date_str, amount_ml, timestamp) VALUES (?, ?, ?)",
            (date_str, int(amount_ml), timestamp)
        )
        cursor.execute(
            "SELECT SUM(amount_ml) as total FROM hydration_logs WHERE date_str = ?",
            (date_str,)
        )
        row = cursor.fetchone()
        conn.commit()
        return int(row["total"] or 0) if row and row["total"] is not None else int(amount_ml)

def get_hydration_total(date_str: str) -> int:
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT SUM(amount_ml) as total FROM hydration_logs WHERE date_str = ?",
            (date_str,)
        )
        row = cursor.fetchone()
        return int(row["total"] or 0) if row and row["total"] is not None else 0

def set_kv(key: str, value: str) -> None:
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO kv_store (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """,
            (key, value, uk_now().isoformat())
        )
        conn.commit()

def get_kv(key: str) -> Optional[str]:
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM kv_store WHERE key = ?", (key,))
        row = cursor.fetchone()
        return str(row["value"]) if row and row["value"] is not None else None

def log_workout_session(summary: Dict[str, Any]) -> int:
    init_db()
    timestamp = str(summary.get("date") or uk_now().isoformat())
    preset = str(summary.get("preset") or "")
    goal = str(summary.get("goal") or "")
    exercises_completed = int(summary.get("exercisesCompleted") or 0)
    sets_logged = int(summary.get("setsLogged") or 0)
    calories = int(summary.get("calories") or 0)
    payload_json = json.dumps(summary)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO workout_sessions (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json),
        )
        conn.commit()
        return cursor.lastrowid

def log_manual_activity(activity: Dict[str, Any]) -> None:
    init_db()
    act_id = str(activity.get("id") or int(uk_now().timestamp() * 1000))
    timestamp = str(activity.get("date") or uk_now().isoformat())
    name = str(activity.get("name") or "Activity")
    sub_title = str(activity.get("sub_title") or name)
    duration_min = float(activity.get("duration_min") or 0.0)
    calories = int(round(float(activity.get("calories") or 0)))
    avg_hr = int(round(float(activity.get("avg_hr") or 0)))
    max_hr = int(round(float(activity.get("max_hr") or 0)))
    payload_json = json.dumps(activity)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
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
        conn.commit()
