from datetime import datetime
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")


def uk_now() -> datetime:
    return datetime.now(UK_TZ)


def uk_today_str() -> str:
    return uk_now().date().isoformat()


def uk_timestamp_str(ts=None) -> str:
    if ts is not None:
        return datetime.fromtimestamp(int(ts), tz=UK_TZ).strftime("%Y-%m-%d %H:%M:%S")
    return uk_now().strftime("%Y-%m-%d %H:%M:%S")
