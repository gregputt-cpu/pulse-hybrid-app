import os
import json
import logging
import tempfile
import threading
from contextlib import contextmanager
from typing import Dict, Any, Iterable, Optional

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


def get_data_dir() -> Optional[str]:
    """Resolve persistent data directory: explicit DATA_DIR env var, else /data if mounted, else None."""
    env_dir = os.environ.get("DATA_DIR", "").strip()
    if env_dir:
        return env_dir
    if os.path.isdir("/data"):
        return "/data"
    return None


def get_live_state_path() -> str:
    env_path = os.environ.get("LIVE_STATE_PATH", "").strip()
    if env_path:
        return env_path
    data_dir = get_data_dir()
    if data_dir:
        return os.path.join(data_dir, "live_state.json")
    return DEFAULT_STATE_PATH


def ensure_live_state_seeded(path: Optional[str] = None) -> bool:
    """Seed persistent live_state.json from bundled app state on first boot if missing."""
    target = os.path.abspath(path or get_live_state_path())
    if os.path.exists(target):
        return False

    seed_candidates = [
        os.path.join(REPO_ROOT, "live_state.json"),
        os.path.join(BACKEND_DIR, "live_state.json"),
    ]
    for seed in seed_candidates:
        seed_abs = os.path.abspath(seed)
        if seed_abs == target or not os.path.exists(seed_abs):
            continue
        try:
            with open(seed_abs, "r", encoding="utf-8") as sf:
                seed_data = json.load(sf)
            if isinstance(seed_data, dict):
                with state_lock(target):
                    if not os.path.exists(target):
                        _atomic_write_json(target, seed_data)
                        try:
                            _atomic_write_json(f"{target}.bak", seed_data)
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
                logger.warning(f"[StateStore] Advisory file lock unavailable ({lock_file_path}): {e}")
                if lock_fh is not None:
                    try:
                        lock_fh.close()
                    except Exception:
                        pass
                    lock_fh = None

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
            json.dump(data, tmp, indent=2)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_path, abs_path)
        tmp_path = None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def load_live_state(path: Optional[str] = None, raise_on_corrupt: bool = False) -> Dict[str, Any]:
    """Thread-safe read of live_state.json with automatic .bak recovery on corruption."""
    target = path or get_live_state_path()
    bak_path = f"{target}.bak"
    with state_lock(target):
        if os.path.exists(target):
            try:
                with open(target, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
                raise ValueError(f"Expected JSON object in {target}, got {type(data).__name__}")
            except Exception as e:
                logger.error(f"[StateStore] Failed reading {target}: {e}")
                if os.path.exists(bak_path):
                    try:
                        with open(bak_path, "r", encoding="utf-8") as bf:
                            bak_data = json.load(bf)
                        if isinstance(bak_data, dict):
                            logger.warning(f"[StateStore] Recovered valid state from backup {bak_path}")
                            return bak_data
                    except Exception as be:
                        logger.error(f"[StateStore] Backup {bak_path} also unreadable: {be}")
                if raise_on_corrupt:
                    raise RuntimeError(f"Corrupt live state at {target} with no valid backup; aborting write to prevent state wipe") from e
                return {}
        return {}


def save_live_state(
    state: Dict[str, Any],
    path: Optional[str] = None,
    mirror_paths: Optional[Iterable[str]] = None,
) -> None:
    """Thread-safe atomic write of live_state.json + .bak snapshot + optional atomic mirrors."""
    if not isinstance(state, dict):
        raise ValueError("live_state must be a dict")
    target = path or get_live_state_path()
    bak_path = f"{target}.bak"
    backend_copy = os.path.join(BACKEND_DIR, "live_state.json")

    with state_lock(target):
        _atomic_write_json(target, state)
        try:
            _atomic_write_json(bak_path, state)
        except Exception as e:
            logger.warning(f"[StateStore] Could not update backup {bak_path}: {e}")

        targets = []
        if get_data_dir() is None and os.path.abspath(target) == os.path.abspath(get_live_state_path()) and os.path.abspath(backend_copy) != os.path.abspath(target):
            targets.append(backend_copy)
        if mirror_paths:
            for mp in mirror_paths:
                if mp and os.path.abspath(mp) != os.path.abspath(target) and os.path.abspath(mp) not in {os.path.abspath(t) for t in targets}:
                    targets.append(mp)

        for mirror in targets:
            try:
                _atomic_write_json(mirror, state)
            except Exception as e:
                logger.warning(f"[StateStore] Could not mirror state to {mirror}: {e}")
