# PULSE • Hybrid Athlete OS — Project Handoff

**Repository:** `gregputt-cpu/pulse-hybrid-app`  
**Branch / Latest Commit:** `main` (`f8b26a7`)  
**Status:** All Critical (`CRIT-01`–`CRIT-07`), High (`HIGH-01`–`HIGH-14`), Medium (`MED-01`–`MED-13`), and Low (`LOW-01`–`LOW-07`) items from `AUDIT_REPORT.md` have been resolved, verified, and pushed to `main`.

---

## 1. Current Architecture

```text
pulse-hybrid-app/
├── index.html                  # Main PWA shell (5 tabs: Today, Train, Timer, Fuel, Body + 15 modals)
├── css/styles.css              # Design system, responsive desktop layout (680px), reduced-motion & modal scroll
├── js/
│   ├── state.js                # Global state, auth gate, escapeHtml(), getLocalDateStr(), getTodayActiveBurn(), error boundary, Escape/backdrop modal UX
│   ├── workout-engine.js       # Autoregulated workouts, KB Flow / conditioning timers, injury guardrails, progressive overload
│   ├── fuel-engine.js          # MyNetDiary ingestion, calorie runway, diet strategy & macro calculator, Quick Log
│   ├── telemetry.js            # /api/live_state hydration, Garmin/Renpho/MND DOM bindings, biometric sparklines
│   └── charts.js               # SVG Renpho 30-day trend, strength e1RM progression, Garmin HR zones & TE gauges
├── sw.js                       # PWA Service Worker (network-first API w/ 503 JSON offline fallback, asset caching)
├── build.js                    # Syncs root assets to backend/static/, dist/, public/, and .vercel/output/static/
├── Dockerfile & railway.json   # Single-container Railway deployment (FastAPI + static PWA + /api/health check)
├── .env.example                # Complete environment variable template
├── AUDIT_REPORT.md             # Full read-only system audit report
└── backend/
    ├── main.py                 # FastAPI app, auth middleware, CORS, lifespan APScheduler, all /api/* routes
    ├── state_store.py          # Reentrant thread + fcntl.flock locked atomic live_state.json RMW + .bak recovery
    ├── db.py                   # SQLite (WAL + busy_timeout=10000): renpho_history, strength_logs, hydration_logs, workout_sessions, manual_activities, kv_store
    ├── time_utils.py           # Canonical Europe/London timezone helpers (uk_now, uk_today_str, uk_timestamp_str)
    ├── garmin_sync_service.py  # Garmin Connect OAuth sync (single-flight lock, 180s debounce, 429 backoff, HRV/stress, day rollover)
    ├── mnd_sync_service.py     # MyNetDiary sync (JSON cookies, background 10-day history backfill, hydration merge, Garmin bridge)
    ├── renpho_sync_service.py  # Renpho cloud sync (cached client, 60-min throttle, sinew kg muscle mapping)
    ├── benefits_engine.py      # Physiological workout benefit analysis engine
    └── requirements.txt        # Python backend dependencies
```

### Data & Sync Flow
- **Backend APScheduler** (managed via FastAPI `lifespan`) runs every 5 minutes with isolated `try/except` blocks for Garmin, MyNetDiary, and Renpho.
- **Persistent State:** When `/data` (or `DATA_DIR`) is mounted, `pulse.db`, `live_state.json`, `garmin_tokens/`, and `mnd_tokens/` persist across deploys.
- **Frontend Polling:** Polls read-only `GET /api/live_state` (never triggers third-party logins on page boot). Explicit user sync buttons call `POST /api/garmin/sync`, `POST /api/mnd/sync`, and `POST /api/renpho/sync`.

---

## 2. Completed Features & Hardening

- **Security & Auth (`CRIT-01`, `CRIT-02`):** Removed all hardcoded passwords/emails/PII; added `PULSE_API_SECRET` session-cookie + Bearer/API-key auth middleware; locked down CORS via `ALLOWED_ORIGINS`; removed token export & arbitrary state overwrite endpoints; added `escapeHtml()` DOM XSS protection.
- **Crash-Safe Atomic Persistence (`CRIT-03`, `CRIT-04`, `HIGH-06`):** `state_store.py` provides thread-reentrant `RLock` + `fcntl.flock` + `fsync` + `os.replace` + `.bak` recovery; SQLite runs in `WAL` mode with `busy_timeout=10000` and single-run `init_db()`; replaced `pickle` cookies with `0600` JSON.
- **Complete API Contract (`CRIT-05`, `HIGH-13`):** Added `POST /api/mnd/login`, `POST /api/mnd/manual`, `POST /api/sync_session`, `POST /api/sync_activity`; fixed `/api/sync_set` response contract and string weight/rep coercion.
- **Integrations Hardened (`HIGH-01`–`HIGH-05`, `HIGH-12`):**
  - Garmin: single-flight lock, 180s debounce, 429 exponential backoff, HRV & stress extraction, day-rollover clearing, null activity guards.
  - MyNetDiary: background 10-day history backfill (non-blocking), SQLite hydration preservation, metric weight unit guard, word-boundary date regex, zeroed cache invalidation.
  - Renpho: `sinew` kg muscle mass mapping + one-time SQLite migration, cached `RenphoClient`, 60-min throttle, manual weigh-in SQLite upsert & bounds validation.
  - Timezone: unified `Europe/London` backend (`time_utils.py`) and local-date frontend (`getLocalDateStr()`).
- **Frontend UX, Charts & Timers (`CRIT-06`, `CRIT-07`, `HIGH-08`–`HIGH-11`, `MED-01`–`MED-13`):**
  - Eliminated `#vitalBurn` DOM scraping; canonical `getTodayActiveBurn()` / `getTodayInAppBurn()`.
  - Fixed Session Summary modal, Skip 6-round cap & `resetTimer()`, KB Flow metadata & rest countdown, `+2.5kg` progression banner, `activeSessionMeta` persistence, injury guardrails.
  - Removed all synthetic/fabricated fallback charts; fixed TE `0.0` falsy override & `NaNkg` parsing; deduplicated chart boot calls.
  - Enabled pinch-to-zoom, text selection, scrollable `.modal-card`, Escape/backdrop modal close, desktop responsive layout, `prefers-reduced-motion`, and global frontend error boundary.

---

## 3. Known Bugs / Remaining Items

- **No open Critical or High bugs.** All 41 findings from `AUDIT_REPORT.md` have been addressed.
- **Minor Operational Caveats to Monitor:**
  1. **Rotating Credentials:** Because credentials were previously committed in git history before `CRIT-01`, rotate your Garmin, MyNetDiary, and Renpho passwords and update them in Railway Variables.
  2. **Legacy `backend/static/` Sync:** Always run `node build.js` after editing root `index.html`, `css/`, `js/`, or `sw.js` so `backend/static/` and build outputs stay synchronized.
  3. **Python Dependencies (`backend/requirements.txt`):** Currently uses `>=` minimum bounds; consider running `pip freeze` inside the production container to lock exact versions if reproducible builds are required.
  4. **Telemetry Override Prompts (`MED-09`):** Backend `oauth_date` bug is fixed; frontend Sleep/BB/Readiness manual overrides still use `window.prompt()` — consider replacing with an inline numeric modal if used frequently in iOS standalone PWA mode.

---

## 4. Required Environment Variables

See `.env.example` for the full template. For **Railway** (Production) or `.env` (Local):

| Variable | Required | Description |
| :--- | :--- | :--- |
| `PORT` | Auto (Railway) | Server port (defaults to `8080`). |
| `PULSE_API_SECRET` | Recommended | Strong random secret protecting all `/api/*` endpoints (login modal + cookie/Bearer auth). |
| `ALLOWED_ORIGINS` | Optional | Comma-separated allowed CORS origins (e.g. `https://pulse-hybrid-app-production.up.railway.app`). Leave blank for same-origin only. |
| `DATA_DIR` | Recommended | Persistent volume path (`/data` on Railway; defaults to `./backend` locally). |
| `LIVE_STATE_PATH` | Optional | Defaults to `<DATA_DIR>/live_state.json`. |
| `GARMIN_TOKEN_DIR` | Optional | Defaults to `<DATA_DIR>/garmin_tokens`. |
| `GARMIN_TOKENS_JSON` | Optional | Serialized Garmin OAuth token bundle for headless boots. |
| `MND_USERNAME` / `MND_PASSWORD` | For MND sync | MyNetDiary account credentials. |
| `MND_TOKEN_DIR` | Optional | Defaults to `<DATA_DIR>/mnd_tokens`. |
| `RENPHO_EMAIL` / `RENPHO_PASSWORD` | For Renpho sync | Renpho Health account credentials. |

---

## 5. Exact Next Steps (Local Development & Deployment)

### Run Locally
```bash
# 1. Unzip and enter project directory
unzip project-handoff.zip -d pulse-hybrid-app
cd pulse-hybrid-app

# 2. Configure environment variables
cp .env.example .env
# Edit .env with your credentials (leave DATA_DIR=./backend/data for local dev)

# 3. Install Python dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 4. Sync static assets (whenever you edit index.html, css/, js/, or sw.js)
node build.js

# 5. Start the FastAPI server
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8080
```
Open `http://localhost:8080` in your browser.

### Verify Railway Production Deployment
1. Confirm a **Persistent Volume** is mounted at `/data` in your Railway service settings.
2. Confirm all env vars from Section 4 are set in Railway Variables (including rotated passwords).
3. Verify `GET https://<your-railway-domain>/api/health` returns `{"status": "healthy", ...}`.
4. Log in with `PULSE_API_SECRET` (if set), trigger one manual Garmin/MND/Renpho sync, and verify live metrics hydrate across all 5 tabs.
