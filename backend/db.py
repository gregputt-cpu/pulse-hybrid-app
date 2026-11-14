import os
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

logger = logging.getLogger("pulse-db")

DATA_DIR = os.environ.get(
    "DATA_DIR",
    "/data" if os.path.exists("/data") else os.path.dirname(os.path.abspath(__file__))
)
DB_PATH = os.path.join(DATA_DIR, "pulse.db")

def get_connection() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_renpho_timestamp ON renpho_history(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_strength_timestamp ON strength_logs(timestamp)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hydration_date ON hydration_logs(date_str)")
        conn.commit()

        # Auto-seed from renpho_seed.json if table is empty
        cursor.execute("SELECT COUNT(*) FROM renpho_history")
        count = cursor.fetchone()[0]
        if count == 0:
            seed_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "renpho_seed.json")
            if os.path.exists(seed_path):
                try:
                    with open(seed_path, "r", encoding="utf-8") as f:
                        seed_items = json.load(f)
                    if isinstance(seed_items, list) and seed_items:
                        _insert_renpho_records(conn, seed_items)
                except Exception as e:
                    logger.warning(f"[DB] Failed loading renpho_seed.json: {e}")

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
            m_id = str(raw_id) if raw_id is not None and str(raw_id).strip() else (f"renpho_{ts}" if ts else f"renpho_{datetime.now().timestamp()}")

            if ts:
                try:
                    date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    date_str = str(item.get("date_str") or item.get("localCreatedAt") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            else:
                date_str = str(item.get("date_str") or item.get("localCreatedAt") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

            w = item.get("weight_kg") if item.get("weight_kg") is not None else item.get("weight")
            bf = item.get("body_fat_pct") if item.get("body_fat_pct") is not None else item.get("bodyfat")
            lm = item.get("lean_mass_kg") if item.get("lean_mass_kg") is not None else item.get("fatFreeWeight")
            if lm is None:
                lm = item.get("sinew")
            mm = item.get("muscle_mass_kg") if item.get("muscle_mass_kg") is not None else item.get("muscle")
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
            m_id = str(raw_id) if raw_id is not None and str(raw_id).strip() else (f"renpho_{ts}" if ts else f"renpho_{datetime.now().timestamp()}")

            if ts:
                try:
                    date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    date_str = str(getattr(item, "date_str", None) or getattr(item, "localCreatedAt", None) or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            else:
                date_str = str(getattr(item, "date_str", None) or getattr(item, "localCreatedAt", None) or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

            w = getattr(item, "weight_kg", None) if getattr(item, "weight_kg", None) is not None else getattr(item, "weight", None)
            bf = getattr(item, "body_fat_pct", None) if getattr(item, "body_fat_pct", None) is not None else getattr(item, "bodyfat", None)
            lm = getattr(item, "lean_mass_kg", None) if getattr(item, "lean_mass_kg", None) is not None else getattr(item, "fat_free_weight", None)
            if lm is None:
                lm = getattr(item, "fatFreeWeight", None) or getattr(item, "sinew", None)
            mm = getattr(item, "muscle_mass_kg", None) if getattr(item, "muscle_mass_kg", None) is not None else getattr(item, "muscle", None)
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
        cutoff_ts = int((datetime.now() - timedelta(days=days)).timestamp())
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
        timestamp = datetime.now().isoformat()
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
            cutoff = (datetime.now() - timedelta(days=days)).isoformat()
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
        timestamp = datetime.now().isoformat()
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
