import os
import json
import time
import logging
import tempfile
import threading
from contextlib import contextmanager
from typing import Dict, Any, Optional

try:
    import fcntl
except ImportError:
    fcntl = None

logger = logging.getLogger("pulse-state-store")

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BACKEND_DIR)

DEFAULT_STATE_PATH = os.path.join(REPO_ROOT, "live_state.json")
if not os.path.exists(DEFAULT_STATE_PATH):
    DEFAULT_STATE_PATH = os.path.join(BACKEND_DIR, "live_state.json")


def get_data_dir() -> str:
    """Resolve persistent data directory: explicit DATA_DIR env var, else /data if mounted, else <backend>/data."""
    env_dir = os.environ.get("DATA_DIR", "").strip()
    if env_dir:
        return env_dir
    if os.path.isdir("/data"):
        return "/data"
    return os.path.join(BACKEND_DIR, "data")


def get_live_state_path() -> str:
    env_path = os.environ.get("LIVE_STATE_PATH", "").strip()
    if env_path:
        return env_path
    return os.path.join(get_data_dir(), "live_state.json")


def _read_valid_json_dict(file_path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(file_path):
        return None
    try:
        if os.path.getsize(file_path) <= 0:
            return None
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def ensure_live_state_seeded(path: Optional[str] = None) -> bool:
    """Seed persistent live_state.json from .bak or bundled seed state when missing, 0-byte, or corrupt."""
    target = os.path.abspath(path or get_live_state_path())
    if _read_valid_json_dict(target) is not None:
        return False

    bak_path = f"{target}.bak"
    seed_candidates = [
        os.path.join(REPO_ROOT, "live_state.json"),
        os.path.join(BACKEND_DIR, "live_state.json"),
    ]
    with state_lock(target):
        if _read_valid_json_dict(target) is not None:
            return False
        bak_data = _read_valid_json_dict(bak_path)
        if bak_data is not None:
            _atomic_write_json(target, bak_data)
            logger.warning(f"[StateStore] Restored invalid/missing {target} from {bak_path}")
            return True
        for seed in seed_candidates:
            seed_abs = os.path.abspath(seed)
            if seed_abs == target or not os.path.exists(seed_abs):
                continue
            try:
                seed_data = _read_valid_json_dict(seed_abs)
                if seed_data is not None:
                    _atomic_write_json(target, seed_data)
                    try:
                        _atomic_write_json(bak_path, seed_data)
                    except Exception:
                        pass
                    logger.info(f"[StateStore] Seeded {target} from {seed_abs}")
                    return True
            except Exception as e:
                logger.warning(f"[StateStore] Could not seed {target} from {seed_abs}: {e}")
    return False


_PROCESS_LOCK = threading.RLock()
_THREAD_STATE = threading.local()


@contextmanager
def state_lock(path: Optional[str] = None):
    """Acquire process-wide reentrant lock + POSIX advisory file lock for atomic RMW."""
    target = os.path.abspath(path or get_live_state_path())
    lock_file_path = f"{target}.lock"
    with _PROCESS_LOCK:
        depths = getattr(_THREAD_STATE, "lock_depths", None)
        if depths is None:
            depths = {}
            _THREAD_STATE.lock_depths = depths

        current_depth = depths.get(target, 0)
        lock_fh = None
        if current_depth == 0 and fcntl is not None:
            try:
                os.makedirs(os.path.dirname(lock_file_path), exist_ok=True)
                lock_fh = open(lock_file_path, "a+", encoding="utf-8")
                fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
            except Exception as e:
                logger.error(f"[StateStore] Advisory file lock failed ({lock_file_path}): {e}")
                if lock_fh is not None:
                    try:
                        lock_fh.close()
                    except Exception:
                        pass
                    lock_fh = None
                raise RuntimeError(f"Failed acquiring state lock at {lock_file_path}: {e}") from e

        depths[target] = current_depth + 1
        try:
            yield
        finally:
            depths[target] -= 1
            if depths[target] <= 0:
                depths.pop(target, None)
            if lock_fh is not None:
                try:
                    fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass
                try:
                    lock_fh.close()
                except Exception:
                    pass


def _atomic_write_json(path: str, data: Dict[str, Any]) -> None:
    abs_path = os.path.abspath(path)
    parent = os.path.dirname(abs_path)
    os.makedirs(parent, exist_ok=True)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=parent,
            prefix=f".{os.path.basename(abs_path)}.",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_path = tmp.name
            json.dump(data, tmp, indent=2, allow_nan=False)
            tmp.flush()
            os.fsync(tmp.fileno())
        for delay in (0.05, 0.1, 0.2, None):
            try:
                os.replace(tmp_path, abs_path)
                tmp_path = None
                break
            except PermissionError:
                if delay is None:
                    raise
                time.sleep(delay)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def load_live_state(path: Optional[str] = None, raise_on_corrupt: bool = False) -> Dict[str, Any]:
    """Thread-safe read of live_state.json with automatic .bak recovery on missing/0-byte/corrupt primary."""
    target = os.path.abspath(path or get_live_state_path())
    bak_path = f"{target}.bak"
    with state_lock(target):
        primary_exists = os.path.exists(target)
        data = _read_valid_json_dict(target)
        if data is not None:
            return data

        if primary_exists:
            logger.error(f"[StateStore] Unreadable or 0-byte live state at {target}; attempting .bak recovery")
        bak_data = _read_valid_json_dict(bak_path)
        if bak_data is not None:
            try:
                _atomic_write_json(target, bak_data)
            except Exception as heal_err:
                logger.warning(f"[StateStore] Recovered from {bak_path} but failed rewriting {target}: {heal_err}")
            else:
                logger.warning(f"[StateStore] Recovered and healed {target} from {bak_path}")
            return bak_data

        if primary_exists or os.path.exists(bak_path):
            logger.error(f"[StateStore] Backup {bak_path} also unreadable or absent")
            if raise_on_corrupt:
                raise RuntimeError(f"Corrupt live state at {target} with no valid backup; aborting write to prevent state wipe")
        return {}


def save_live_state(
    state: Dict[str, Any],
    path: Optional[str] = None,
) -> None:
    """Thread-safe atomic write of live_state.json + .bak snapshot."""
    if not isinstance(state, dict):
        raise ValueError("live_state must be a dict")
    target = os.path.abspath(path or get_live_state_path())
    bak_path = f"{target}.bak"

    with state_lock(target):
        prev_data = _read_valid_json_dict(target)
        if prev_data is not None:
            try:
                _atomic_write_json(bak_path, prev_data)
            except Exception as e:
                logger.warning(f"[StateStore] Could not snapshot previous state to {bak_path}: {e}")

        _atomic_write_json(target, state)
        if not os.path.exists(bak_path):
            try:
                _atomic_write_json(bak_path, state)
            except Exception as e:
                logger.warning(f"[StateStore] Could not initialize backup {bak_path}: {e}")
