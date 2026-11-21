from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")


def uk_now() -> datetime:
    return datetime.now(UK_TZ)


def uk_today_str() -> str:
    return uk_now().date().isoformat()


def uk_timestamp_str(ts=None) -> str:
    if ts is not None:
        if isinstance(ts, bool):
            raise ValueError("Timestamp cannot be a boolean")
        ts_f = float(ts)
        if abs(ts_f) > 1e11:
            ts_f /= 1000.0
        return datetime.fromtimestamp(ts_f, tz=UK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    return uk_now().strftime("%Y-%m-%d %H:%M:%S")


def parse_uk_ts(ts_str: Optional[Any]) -> Optional[datetime]:
    """Parse ISO/datetime/epoch timestamps into an aware Europe/London datetime."""
    if ts_str is None or isinstance(ts_str, bool):
        return None
    if isinstance(ts_str, (int, float)):
        try:
            val = float(ts_str)
            if abs(val) > 1e11:
                val /= 1000.0
            return datetime.fromtimestamp(val, tz=timezone.utc).astimezone(UK_TZ)
        except Exception:
            return None
    s = str(ts_str).strip()
    if not s:
        return None
    try:
        iso_s = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso_s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UK_TZ)
        return dt.astimezone(UK_TZ)
    except Exception:
        pass
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(s[:26], fmt).replace(tzinfo=UK_TZ)
        except Exception:
            continue
    return None
