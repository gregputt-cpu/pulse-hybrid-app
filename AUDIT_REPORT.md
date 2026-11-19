# Pulse Hybrid App — Full Read-Only System Audit Report

**Audit Date:** 2026-11-19  
**Repository:** `gregputt-cpu/pulse-hybrid-app` (branch `main`, commit `c78ef99`)  
**Methodology:** Goldfish Protocol (zero assumptions — 100% of frontend, backend, PWA, data, and deployment source files inspected directly from disk; automated read-only AST/syntax, route, DOM ID, event handler, `localStorage`, and schema cross-checks executed; zero files modified and zero destructive DB/API calls made).

---

## Executive Summary & Subsystem Scorecard

| Subsystem | Health | Key Risk Drivers |
|---|---|---|
| **Security & Auth** | 🔴 Critical | Plaintext Renpho credentials & PII committed in git; unauthenticated `/api/garmin/export_token` & `/api/live_state` write; wildcard CORS with `allow_credentials=True`; DOM XSS + `localStorage` OAuth token theft; `pickle.load()` deserialization. |
| **Backend & Railway Infra** | 🔴 Critical | Non-atomic concurrent RMW on `live_state.json` (data corruption / total state wipe); `live_state.json` & MND sessions stored on ephemeral filesystem instead of `/data`; SQLite `init_db()` DDL executed on every request with no WAL mode; conflicting Railway/Docker configs with no healthcheck. |
| **Frontend & UI Flows** | 🔴 Critical | 3 missing backend API endpoints (404); broken Session Summary modal (`.active` vs `.open`); Custom Goal Architect null-deref crash (`#opt_custom`); orphaned Weight modal; dead Timer log button; missing `#vitalBurn` DOM ID; `inAppBurn` overwritten; `startRestTimer` typo; broken conditioning-to-Garmin match. |
| **Garmin Connect Integration** | 🟠 High | Unhandled `None` fields crash activity/sleep sync; zero 429 rate-limit backoff while APScheduler + frontend poll aggressively; HRV status never fetched & stress score discarded; `active_calories` overwritten by workout-only burn; stale yesterday biometrics survive day rollover. |
| **MyNetDiary Integration** | 🟠 High | Hydration overwritten to `0.0L` every 5 min; kg weights blindly multiplied by `0.45359237`; date regex missing word boundaries; 67 historical food items permanently frozen at `0` macros; blocking 127s sync aborted at 3.5s by frontend + wrong response key (`data.mnd`); `needLogon` unchecked post-relogin. |
| **Renpho Integration** | 🟠 High | Skeletal muscle `%` (`muscle: 53.5`) stored and displayed as `53.5kg` (actual kg is `sinew: 76.99`); full cloud login every 5 min (288/day); manual scale endpoint skips SQLite & risks `ZeroDivisionError`; UTC vs `Europe/London` timestamp drift. |
| **Cross-Source Reconciliation** | 🟠 High | Manual today activities wiped whenever any Garmin today activity exists; MND ingestion gated inside `if (state.garmin)`; `charts.js` camelCase vs snake_case mismatch yields `undefined` & `NaNkg`; fabricated placeholder charts shown as real data. |

### Severity Distribution
- **Critical:** 7 issues (`CRIT-01` – `CRIT-07`)
- **High:** 14 issues (`HIGH-01` – `HIGH-14`)
- **Medium:** 13 issues (`MED-01` – `MED-13`)
- **Low:** 7 issues (`LOW-01` – `LOW-07`)

---

## CRITICAL Issues

### `CRIT-01` — Hardcoded Plaintext Credentials & Personal PII Committed in Repository
- **Exact File Path & Line Numbers:**
  - `backend/mnd_sync_service.py:73`
  - `backend/renpho_sync_service.py:18-20`
  - `index.html:1614, 1625, 1894`
  - `js/fuel-engine.js:1331, 1390, 1407, 1418, 1535, 1598`
  - `js/telemetry.js:428`
  - `backend/renpho_seed.json:1`
  - `live_state.json:1-1552` & `js/state.js:1`
- **Root Cause:** Real account credentials (`greg.putt@gmail.com` and plaintext password `He11o12345`) are embedded as fallback defaults in both `backend/mnd_sync_service.py:73` (`os.environ.get('RENPHO_EMAIL', ...)` / `os.environ.get('RENPHO_PASSWORD', ...)`) and `backend/renpho_sync_service.py:18-20` (`def __init__(self, email=..., password=...)`). Personal email addresses are hardcoded into frontend input values and fallbacks, and `backend/renpho_seed.json` commits 648 raw health records containing date of birth (`1981-01-14`), Bluetooth MAC address (`ED:67:38:5C:51:69`), and `bUserId`.
- **Reproduction / Verification Steps:**
  1. Run `grep -rn "He11o12345\|greg\.putt@gmail\.com" backend/ js/ index.html`.
  2. Observe plaintext password in `backend/mnd_sync_service.py:73` and `backend/renpho_sync_service.py:18`, and personal PII in `backend/renpho_seed.json:1`.
- **Proposed Atomic Fix:**
  1. Rotate the Renpho and MyNetDiary account passwords immediately.
  2. Remove all hardcoded credential defaults from `backend/mnd_sync_service.py:73` and `backend/renpho_sync_service.py:18-20`; require `MND_USERNAME`/`MND_PASSWORD` and `RENPHO_EMAIL`/`RENPHO_PASSWORD` environment variables and raise/return an explicit configuration error if unset.
  3. Strip personal email defaults from `index.html`, `js/fuel-engine.js`, and `js/telemetry.js` (use empty strings and placeholder hints).
  4. Move `backend/renpho_seed.json` out of git tracking (or anonymize/strip `birthday`, `mac`, `bUserId`) and add a `.env.example` template.

---

### `CRIT-02` — Unauthenticated Garmin OAuth Token Exfiltration, Arbitrary State Overwrite, Permissive CORS & DOM XSS Token Theft
- **Exact File Path & Line Numbers:**
  - `backend/main.py:29-35` (CORS wildcard + `allow_credentials=True`)
  - `backend/main.py:188-198` (`POST /api/live_state`, `GET /api/garmin/export_token`)
  - `backend/main.py:249, 270, 301` (OAuth token JSON returned by `/api/garmin/sync`, `/submit_mfa`, `/restore_session`)
  - `backend/main.py:304-306` & `backend/mnd_sync_service.py:1106-1114` (`GET /api/mnd/status` leaks email)
  - `js/telemetry.js:163, 474, 547, 2508, 2522` (`localStorage.setItem('pulse_garmin_tokens_backup', ...)`)
  - `js/fuel-engine.js:584, 607, 1469` & `js/workout-engine.js:3330, 5430, 5533, 5703, 5783, 5858, 5885, 5921` (unescaped `innerHTML` sinks)
- **Root Cause:** Every API endpoint lacks authentication/authorization. Any external caller can hit `GET /api/garmin/export_token` to steal the full Garmin OAuth1+OAuth2 session bundle, or `POST /api/live_state` to overwrite server state with malicious JSON payloads (which are then rendered into unescaped `innerHTML` templates across the UI). Simultaneously, `CORSMiddleware` configures `allow_origins=["*"]` together with `allow_credentials=True`, reflecting arbitrary third-party origins so any malicious website can read `GET /api/garmin/export_token` cross-origin. Storing the full OAuth token bundle in browser `localStorage` (`pulse_garmin_tokens_backup`) turns any injected food name, activity note, or exercise name into immediate full Garmin account takeover.
- **Reproduction / Verification Steps:**
  1. Send an unauthenticated `curl -i https://<host>/api/garmin/export_token` -> returns `garmin_tokens_json` in plaintext.
  2. Send `curl -X POST https://<host>/api/live_state -H 'Content-Type: application/json' -d '{"garmin":{"today_activities":[{"name":"<img src=x onerror=alert(localStorage.pulse_garmin_tokens_backup)>"}]}}'` -> overwrites server state and triggers XSS on next page load.
- **Proposed Atomic Fix:**
  1. Add a mandatory API authentication dependency (e.g., Bearer token / signed HttpOnly session cookie verified against `PULSE_API_SECRET`) protecting all mutating and sensitive `/api/*` endpoints.
  2. Delete `GET /api/garmin/export_token` and stop returning `garmin_tokens_json` in API responses or storing Garmin tokens in `localStorage`; persist tokens exclusively server-side on the Railway `/data` volume.
  3. Restrict `allow_origins` in `backend/main.py:31` to an explicit `ALLOWED_ORIGINS` env var list and remove `POST /api/live_state`.
  4. Introduce an `escapeHtml()` helper on the frontend and sanitize all dynamic strings interpolated into `innerHTML` (or switch to `textContent`).

---

### `CRIT-03` — Concurrent Non-Atomic Read-Modify-Write on `live_state.json` Causes Corruption & Full State Wipe
- **Exact File Path & Line Numbers:**
  - `backend/main.py:58-76, 604-606`
  - `backend/garmin_sync_service.py:531-535, 817-826`
  - `backend/mnd_sync_service.py:818-824, 1078-1102`
  - `backend/renpho_sync_service.py:74-80, 130-149`
- **Root Cause:** Synchronous FastAPI routes run concurrently in AnyIO's worker threadpool while APScheduler's `BackgroundScheduler` executes `run_scheduled_sync()` every 5 minutes in a background thread. All four modules perform unlocked `open(LIVE_STATE_PATH, 'r')` -> mutate dict -> `open(LIVE_STATE_PATH, 'w')` -> `json.dump()` directly onto the live file (and a second unsynchronized mirror copy). Concurrent writers cause classic lost updates (e.g., MND sync clobbering Garmin/strength/hydration updates) and torn reads. Worse: `backend/garmin_sync_service.py:533-534` has no `try/except` around `json.load(f)` (crashes with `JSONDecodeError`), while `backend/main.py:63-65`, `backend/mnd_sync_service.py:823-824`, and `backend/renpho_sync_service.py:79-80` silently catch `JSONDecodeError` and reset `state = {}`, **permanently wiping all persisted athlete state** on the subsequent write.
- **Reproduction / Verification Steps:**
  1. Trigger `POST /api/sync_set`, `POST /api/hydration/add`, and `POST /api/mnd/sync` concurrently while `run_scheduled_sync()` executes.
  2. Observe truncated writes or a `JSONDecodeError` warning in logs followed by `live_state.json` losing prior keys (`strength_prescriptions`, `injuries`, `garmin`, or `renpho`).
- **Proposed Atomic Fix:**
  1. Centralize all reads/writes of `live_state.json` into a single thread-safe helper (e.g., `backend/state_store.py`) guarded by a process-wide `threading.RLock()` (plus `fcntl.flock` if multiple processes are ever used).
  2. Provide an atomic `update_state(mutator_fn)` that reads, applies `mutator_fn(state)` inside the lock, writes to a sibling temporary file + `fsync()`, and atomically swaps via `os.replace(tmp_path, LIVE_STATE_PATH)`.
  3. On `JSONDecodeError`, raise/abort rather than overwriting with `{}` (optionally keeping a `.bak` last-known-good copy).

---

### `CRIT-04` — Ephemeral Filesystem Storage for `live_state.json` & MyNetDiary Sessions on Railway (+ Unsafe `pickle.load`)
- **Exact File Path & Line Numbers:**
  - `backend/main.py:47-51`
  - `backend/garmin_sync_service.py:12-16, 36-41`
  - `backend/mnd_sync_service.py:16-26, 48-55`
  - `backend/renpho_sync_service.py:10-15`
  - Compare with `backend/db.py:10-14`
- **Root Cause:** `backend/db.py:10-14` and `backend/garmin_sync_service.py:14-15` detect a persistent Railway volume at `/data`, **but none of the 4 modules defining `LIVE_STATE_PATH` check `/data`**. On Railway, `LIVE_STATE_PATH` defaults to `/app/live_state.json` (ephemeral container layer), wiping all overrides, strength prescriptions, injury toggles, exercise preferences, and synced telemetry on every redeploy or container restart. Similarly, `MND_DIR` (`backend/mnd_sync_service.py:16`) defaults to ephemeral `/tmp/mnd_tokens` instead of `/data/mnd_tokens`, erasing session cookies, credentials, and the 10-day history cache on every restart. Additionally, `backend/mnd_sync_service.py:51` uses `pickle.load(f)` on `cookies.pkl` (arbitrary code execution vector if the file or `/tmp` path is tampered with).
- **Reproduction / Verification Steps:**
  1. Start container with `/data` mounted and no `LIVE_STATE_PATH` / `MND_TOKEN_DIR` env vars set.
  2. Inspect paths: `pulse.db` and `garmin_tokens` write to `/data`, whereas `live_state.json` writes to `/app/live_state.json` and MND cookies write to `/tmp/mnd_tokens`.
  3. Restart container -> all `live_state.json` changes and MND sessions disappear.
- **Proposed Atomic Fix:**
  1. Define a single `DATA_DIR` resolver (env `DATA_DIR`, else `/data` if `/data` exists, else repo/backend dir) and derive `LIVE_STATE_PATH = os.path.join(DATA_DIR, "live_state.json")` and `MND_DIR = os.path.join(DATA_DIR, "mnd_tokens")` across all modules (seeding `/data/live_state.json` from `/app/live_state.json` only on first boot if missing).
  2. Replace `pickle.dump`/`pickle.load` in `backend/mnd_sync_service.py:51,58` with JSON serialization of `requests.utils.dict_from_cookiejar(session.cookies)` / `cookiejar_from_dict(...)`.

---

### `CRIT-05` — Three Missing Backend API Routes (404) & Broken `/api/sync_set` Success Contract
- **Exact File Path & Line Numbers:**
  - `js/fuel-engine.js:1443` (`POST /api/mnd/login` -> **does not exist in `backend/main.py`**)
  - `js/state.js:304` (`POST /api/sync_session` -> **does not exist in `backend/main.py`**)
  - `js/telemetry.js:646` (`POST /api/sync_activity` -> **does not exist in `backend/main.py`**)
  - `js/state.js:286` vs `backend/main.py:459` (`data.status === 'success'` vs `{"success": True, "result": sp}`)
  - `backend/main.py:78-83, 108-111` vs `js/state.js:277` & `js/workout-engine.js:6134` (`422` when bodyweight/string reps sent to `float`/`int` Pydantic fields)
- **Root Cause:**
  1. **`POST /api/mnd/login` (`js/fuel-engine.js:1443`)** returns `404 Not Found`; the `catch` block silently displays `"Local mode active"` while discarding user-entered MyNetDiary credentials.
  2. **`POST /api/sync_session` (`js/state.js:304`)** returns `404 Not Found` on every completed workout, silently swallowed by an empty `catch` — workout session summaries are never persisted to the backend.
  3. **`POST /api/sync_activity` (`js/telemetry.js:646`)** returns `404 Not Found` whenever a user manually logs an activity via the Sync modal — manual activities are never saved server-side.
  4. **`syncSetToBackend()` (`js/state.js:286`)** checks `if (data.status === 'success' && data.result)`, whereas `backend/main.py:459` returns `{"success": True, "result": sp}`. The condition is permanently `false`, so progressive overload state returned by the server is ignored in the live UI.
  5. **`SetLogPayload` (`backend/main.py:82`)** types `logged_weight: Optional[float]` and **`PrescriptionOverridePayload` (`backend/main.py:111`)** types `reps: int`, causing FastAPI `422 Unprocessable Entity` whenever bodyweight strings (`"Body"`) or timed reps (`"30s"`, `"Max"`) are submitted.
- **Reproduction / Verification Steps:**
  1. Open DevTools Network tab -> submit MyNetDiary login modal -> observe `POST /api/mnd/login` returning `404`.
  2. Finish a workout or log a manual activity -> observe `POST /api/sync_session` and `POST /api/sync_activity` returning `404`.
  3. Log a barbell set -> observe `POST /api/sync_set` returns `{"success": true, "result": {...}}`, yet `js/state.js:286` branch never executes.
  4. Edit prescribed reps to `"30s"` in `editLoadModal` -> observe `POST /api/prescription/override` returning `422`.
- **Proposed Atomic Fix:**
  1. Implement `POST /api/mnd/login`, `POST /api/sync_session`, and `POST /api/sync_activity` in `backend/main.py` backed by SQLite + `live_state.json`.
  2. Update `js/state.js:286` to check `if ((data.success || data.status === 'success') && data.result)`.
  3. Change `PrescriptionOverridePayload.reps` to `Union[int, str]` and coerce/accept string bodyweight inputs (`"Body"`, `"BW"`) in `SetLogPayload` + change `index.html:2101` `#editLoadReps` to `type="text"`.

---

### `CRIT-06` — Broken Core Frontend Flows: Invisible Session Summary Modal, Custom Goal Crash, Dead Timer Logger & Unreachable Weight Modal
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:5359, 5365` vs `css/styles.css:1742-1756` (`.active` vs `.open`)
  - `js/telemetry.js:1178-1208, 1591` vs `index.html:1349-1395` (missing `#opt_custom` -> `TypeError`)
  - `js/workout-engine.js:6787-6791` (`logTimerSession()` is a fake no-op)
  - `index.html:1069` & `js/workout-engine.js:2279` (`openWeightModal()` has zero UI triggers)
  - `js/workout-engine.js:5991-6033` (`addCustomExerciseMidWorkout()` references non-existent `#customExName`..`#customExWeight` and undeclared `swapModalMode`)
- **Root Cause:**
  1. **Session Summary Modal never appears:** `openSessionSummaryModal()` (`js/workout-engine.js:5359`) calls `modal.classList.add('active')` and `closeSessionSummaryModal()` (`5365`) removes `'active'`, but `.modal-overlay` in `css/styles.css:1742-1756` is `display: none` unless class `.open` is applied (`.modal-overlay.open { display: flex !important; }`). Completing any KB Flow / AMRAP / EMOM / For-Time block never shows the summary/PR modal.
  2. **Custom Goal Architect throws uncaught `TypeError`:** `applyCustomGoalArchitect()` (`js/telemetry.js:1207`) invokes `selectGoal('custom')`, which executes `document.getElementById('opt_custom').classList.add('selected')` at `js/telemetry.js:1591` without a null check. `index.html` only defines `#opt_recomp`, `#opt_aerobic`, `#opt_pushups`, and `#opt_rdl` — `#opt_custom` does not exist, aborting goal persistence and modal close.
  3. **Timer Tab `logTimerSession()` is fake (`js/workout-engine.js:6787-6791`):** Displays `"✓ Logged X rounds conditioning to Garmin calendar!"` and switches to the Fuel tab without writing to `localStorage`, updating `inAppBurn`, adding to activity history, or calling any backend API.
  4. **Manual Weight Modal is unreachable:** `#weightModal` (`index.html:1069`) and `openWeightModal()` (`js/workout-engine.js:2279`) have **zero** `onclick` triggers anywhere in `index.html` or `js/*.js`.
- **Reproduction / Verification Steps:**
  1. Complete a timed KB Flow block -> inspect `#sessionSummaryModal` in DOM -> has `class="modal-overlay active"` and remains `display: none`.
  2. Open Goal modal -> click Custom Goal Architect -> Apply -> observe `Uncaught TypeError: Cannot read properties of null (reading 'classList')` at `js/telemetry.js:1591`.
  3. Open Timer tab -> run rounds -> click Log -> verify no data is written to `localStorage` or Network tab.
  4. Search `index.html` and `js/*.js` for `openWeightModal` -> only the function definition exists.
- **Proposed Atomic Fix:**
  1. Replace `'active'` with `'open'` in `openSessionSummaryModal()` (`js/workout-engine.js:5359`) and `closeSessionSummaryModal()` (`5365`).
  2. Null-guard `const optEl = document.getElementById(\`opt_\${goalKey}\`); if (optEl) optEl.classList.add('selected');` in `js/telemetry.js:1591` (and render a `#opt_custom` card or highlight the Custom Architect button).
  3. Wire `logTimerSession()` to persist to `pulse_conditioning_history`, update `inAppBurn`, append to activity feed, and POST to `/api/sync_activity` / `/api/sync_session`.
  4. Attach `onclick="openWeightModal()"` to the Body Scale vital card (`index.html:224-240`) and remove or wire the dead `addCustomExerciseMidWorkout()` UI inputs.

---

### `CRIT-07` — Missing `#vitalBurn` DOM Element Breaks Calorie Runway & `inAppBurn` Is Immediately Overwritten
- **Exact File Path & Line Numbers:**
  - `js/fuel-engine.js:254-288, 437-450`
  - `js/telemetry.js:622, 1573, 2069, 2412`
  - `index.html` (no element with `id="vitalBurn"` exists anywhere among the 345 static IDs)
- **Root Cause:** Six code paths read or write `document.getElementById('vitalBurn')` as the source of truth for active calorie burn. Because `#vitalBurn` does not exist in `index.html`, `updateRunwayUI()` (`js/fuel-engine.js:441-443`) always evaluates `burnEl` as `null` and falls back to hardcoded defaults (`355`, `623`, or `649` kcal across callers). Even worse, `calculateDailyTargets()` (`js/fuel-engine.js:254-287`) carefully computes `activeBurn = baseGarminBurn + inAppBurn` and updates `#fuelTargetNum`, then immediately calls `updateRunwayUI()` at line `437` — which ignores `inAppBurn`, falls back to `355` (because `#vitalBurn` is `null`), and **overwrites `#fuelTargetNum` and `athleteDailyBudget`** right back to the wrong value.
- **Reproduction / Verification Steps:**
  1. Run `document.getElementById('vitalBurn')` in console -> returns `null`.
  2. Log an in-app conditioning workout (sets `pulse_inapp_burn_today`) or load a Garmin state with `850` active kcal -> observe `updateRunwayUI()` overwriting `#fuelTargetNum` using the `355` kcal fallback instead of `baseGarminBurn + inAppBurn`.
- **Proposed Atomic Fix:**
  1. Eliminate DOM scraping of `#vitalBurn` as a state store; introduce a single canonical state accessor `getTodayActiveBurn()` returning `Number(window.BAKED_LIVE_STATE?.garmin?.active_calories || 0) + getTodayInAppBurn()`.
  2. Refactor `js/fuel-engine.js:287-288, 441-449` and `js/telemetry.js:622, 1573, 2069, 2412` to call `getTodayActiveBurn()`, and render active burn into a real visible element if desired.

---

## HIGH Issues

### `HIGH-01` — Hydration Logs Permanently Wiped Every 5 Minutes by MyNetDiary Sync & Static HTML Mockup
- **Exact File Path & Line Numbers:**
  - `backend/main.py:394-417` (`POST /api/hydration/add`)
  - `backend/mnd_sync_service.py:810-813, 980, 986-987`
  - `index.html:277, 680`
  - `js/fuel-engine.js:1854-1870`
- **Root Cause:** `POST /api/hydration/add` logs water into SQLite (`db.log_hydration`) and writes the summed total into `state["mnd_logged"]["water_l"]`. However, every 5 minutes `mnd_sync_service._update_live_state()` (`backend/mnd_sync_service.py:980, 986-987`) unconditionally overwrites `mnd_logged['water_l']` with `totals.get('water', 0.0)` from MyNetDiary (which is `0.0` when water isn't logged in MND — confirmed in `live_state.json:868`), wiping all in-app hydration logs. On the frontend, `#todayHydrationVal` (`index.html:277`) is only updated when clicking `+500ml` and is never hydrated from `live_state.json` on page load (always resets to `0.0L`), while `index.html:680` hardcodes static text `2.4L Water • 32g Fiber`.
- **Reproduction / Verification Steps:**
  1. Click `💧 +500ml` -> `water_l` becomes `0.5` in `live_state.json`.
  2. Reload page -> `#todayHydrationVal` resets to `0.0L`.
  3. Trigger `POST /api/mnd/sync` -> `live_state.json` `mnd_logged.water_l` resets to `0.0`.
- **Proposed Atomic Fix:**
  1. In `backend/mnd_sync_service.py:980`, compute `water_l = max(totals.get('water', 0.0), round(db.get_hydration_total(today_str) / 1000.0, 2))` (or sum distinct sources).
  2. Populate `#todayHydrationVal` and the Fuel summary strip (`index.html:680`) dynamically inside `applyLiveStateToDOM()` from `state.mnd_logged.water_l` and `fiber_g`.

---

### `HIGH-02` — Renpho Skeletal Muscle Percentage Stored & Displayed as Kilograms (Unit Corruption)
- **Exact File Path & Line Numbers:**
  - `backend/renpho_seed.json:1` (`"muscle": 53.5`, `"sinew": 76.99`, `"fatFreeWeight": 80.99`, `"bone": 4.0`)
  - `backend/renpho_sync_service.py:54, 105, 125`
  - `backend/db.py:106, 112, 138, 144`
  - `index.html:246, 1011` & `js/telemetry.js:2330`
- **Root Cause:** In Renpho's API payload, `muscle` (`53.5`) is **Skeletal Muscle Percentage (%)**, whereas actual **Muscle Mass in kg** is `sinew` (`76.99` kg, matching `fatFreeWeight - bone = 80.99 - 4.0 = 76.99` kg). Both `renpho_sync_service.py:54,105,125` and `db.py:106,138` map raw `muscle` into `muscle_mass_kg`, causing the dashboard (`index.html:246,1011`, `js/telemetry.js:2330`) to display `53.5kg` (~23.5 kg understated) as muscle mass.
- **Reproduction / Verification Steps:**
  1. Inspect `backend/renpho_seed.json` latest record (`2026-11-14`): `weight=97.7`, `bodyfat=17.1`, `fatFreeWeight=80.99`, `bone=4.0`, `sinew=76.99`, `muscle=53.5`.
  2. Inspect `live_state.json` `renpho.muscle_mass_kg` -> `53.5`.
- **Proposed Atomic Fix:**
  1. Map `sinew` (fallback `fatFreeWeight - bone`) to `muscle_mass_kg` and store `muscle` separately as `skeletal_muscle_pct` in `renpho_sync_service.py` and `db.py`.
  2. Add a one-time SQLite migration updating existing rows where `muscle_mass_kg < 65` and `lean_mass_kg > 70` (or re-seed from `sinew`).

---

### `HIGH-03` — MyNetDiary Weight Unit Corruption, Date Regex Collision, Zeroed History Macros & Unsafe `None` Chaining
- **Exact File Path & Line Numbers:**
  - `backend/mnd_sync_service.py:1024-1038` (blind lbs -> kg multiplication)
  - `backend/mnd_sync_service.py:1003-1012` (regex without `\b` word boundaries)
  - `backend/mnd_sync_service.py:450-455, 546-553` (history cache permanently freezes zeroed food macros — confirmed across 9/10 days / 67 items in `live_state.json:889-1474`)
  - `backend/mnd_sync_service.py:610-619` (`needLogon` not re-checked after relogin)
  - `backend/mnd_sync_service.py:748-761` (`label.get('protein', {}).get(...)` crashes if value is `None`)
  - `backend/mnd_sync_service.py:726-739` & `live_state.json:785-860` (all 6 logged foods grouped into `breakfast` while `lunch`/`dinner`/`snacks` are empty)
- **Root Cause:**
  1. If `bmiExplanation` does not match `W = <num> kg`, lines `1033-1038` blindly multiply `currentWeight` by `0.45359237`, turning a metric `97.7` kg reading into `44.32` kg.
  2. `target_day_month_regex = rf'(?:{d_num}\s+{b_month}|{b_month}\s+{d_num})'` lacks `\b` boundaries, so `"1 Nov"` matches `"11 Nov"` and `"21 Nov"`, falsely flagging old weigh-ins as today's.
  3. `fetch_multi_day_history()` (`546-553`) skips refreshing any past day in cache with `calories > 0`. Because 9 of 10 days (`2026-11-08` through `2026-11-16`) in `live_state.json` have 67 food items with `cals: 0, p: 0, c: 0, f: 0`, they are permanently frozen and never re-fetched.
  4. After re-authenticating in `fetch_today_data()` (`610-619`), `data.get('needLogon')` is never checked a second time — a failed relogin parses an empty `{needLogon: true}` payload as `0 kcal` and overwrites today's nutrition state.
  5. `label.get('protein', {}).get('values', {}).get('rawValue')` (`748-761`) throws `AttributeError: 'NoneType' object has no attribute 'get'` whenever MND explicitly sends `"protein": null` or `"values": null`.
- **Reproduction / Verification Steps:**
  1. Inspect `live_state.json:889-1474`: days `2026-11-08`–`2026-11-16` have `67/67` items with `cals=0, p=0, c=0, f=0`.
  2. Test `re.search(r'(?:1\s+Nov|Nov\s+1)', 'Recorded 21 Nov 2026')` -> returns a match.
  3. Pass `{"foodLabel": {"protein": None}}` to `_parse_mnd_response()` -> raises `AttributeError`.
- **Proposed Atomic Fix:**
  1. Check MND's weight unit field (or sanity range / explicit unit string) before applying `0.45359237`; never silently halve kg values.
  2. Wrap date regex in word boundaries: `rf'\b(?:{d_num}\s+{b_month}|{b_month}\s+{d_num})\b'`.
  3. Invalidate cached history days in `is_past_cached` whenever `items` exist but `all(it.get('cals', 0) == 0 for it in items)`.
  4. Check `if not data or data.get('needLogon'): return {'success': False, 'requires_auth': True, ...}` after relogin at line `619`.
  5. Use safe nested helper `(label.get('protein') or {}).get('values') or {}` across lines `748-761` (reusing `_get_nut`).

---

### `HIGH-04` — Garmin Sync Null-Field Crashes, Zero 429 Backoff, Dual-Loop Rate-Limit Storm, Missing HRV/Stress & Active-Calorie Overwrite
- **Exact File Path & Line Numbers:**
  - `backend/garmin_sync_service.py:5` (`GarminConnectTooManyRequestsError` imported, never caught)
  - `backend/garmin_sync_service.py:285-289, 583-593, 759-765` (`None` crashes `float()` / `.get()`)
  - `backend/garmin_sync_service.py:424` (calls `get_stress_data()` only for Body Battery, discards stress score; never calls `get_hrv_data()` even though `backend/main.py:291` checks `hrv_status`)
  - `backend/garmin_sync_service.py:724-725` (`if today_active_burn > 0: garmin_state['active_calories'] = today_active_burn`)
  - `backend/garmin_sync_service.py:554-573` & `backend/mnd_sync_service.py:866-905` (no day-rollover clearing of yesterday's `sleep_score`, `body_battery`, `training_readiness`, `hrv_weekly_avg`)
  - `backend/main.py:605` + `js/telemetry.js:2624-2646` (backend 5-min cron + frontend boot/5-min/focus/visibilitychange all fire `/api/garmin/sync`)
- **Root Cause:**
  1. `float(ra.get('averageHR', 0))` (`592, 764`) raises `TypeError` when Garmin returns `averageHR: null` (e.g., manual or strap-off activities); `ra.get('activityType', {}).get(...)` (`583, 586, 759, 760`) and `sleep.get('dailySleepDTO', {})` (`285`) raise `AttributeError` when those keys are explicitly `None`.
  2. Both backend APScheduler (every 5 min) and every open browser tab (`js/telemetry.js:2624-2646`: boot +1.5s, 5-min interval, `visibilitychange`, `focus` throttled at 2 min) hit `/api/garmin/sync`, which makes 6+ upstream Garmin API calls per request with **no single-flight debounce/cache and no `GarminConnectTooManyRequestsError` backoff**, risking Cloudflare/Garmin IP bans.
  3. Line `724-725` overwrites all-day NEAT + workout `activeKilocalories` from `get_stats()` with `today_active_burn` (recorded workouts only), underreporting TDEE by 200–600+ kcal on training days.
  4. On a new calendar day prior to the morning watch sync, yesterday's `sleep_score`, `body_battery`, `training_readiness`, and `hrv_weekly_avg` remain populated and are presented as today's readiness.
  5. `get_hrv_data()` is never called (`hrv_status` is always absent) and stress averages from `get_stress_data()` are discarded.
- **Reproduction / Verification Steps:**
  1. Feed a Garmin activity dict with `{"averageHR": None, "activityType": None}` into `sync_today()` -> crashes with `TypeError`/`AttributeError`.
  2. Open app on a training day with 400 kcal NEAT + 350 kcal workout (`activeKilocalories=750`) -> line `725` overwrites `active_calories` to `350`.
  3. Switch tabs back and forth every 2 minutes -> observe repeated `POST /api/garmin/sync` calls in Network tab alongside the backend 5-min cron.
- **Proposed Atomic Fix:**
  1. Guard all nullable Garmin fields (`float(ra.get('averageHR') or 0)`, `(ra.get('activityType') or {}).get(...)`, `(sleep or {}).get('dailySleepDTO') or {}`).
  2. Add a server-side cooldown/single-flight lock (e.g., 180s minimum interval unless `force=true`) + explicit `except GarminConnectTooManyRequestsError` with exponential backoff (`cooldown_until`).
  3. Change `js/telemetry.js:2624-2646` to poll `GET /api/live_state` (read-only) rather than triggering upstream `POST /api/garmin/sync` on focus/timer.
  4. Replace line `725` with `garmin_state['active_calories'] = max(int(garmin_state.get('active_calories') or 0), today_active_burn)` and store `workout_calories = today_active_burn` separately.
  5. Call `client.get_hrv_data(target_date_str)` and extract `avgStressLevel` from `get_stress_data()`; reset date-scoped readiness fields when `state.get('date') != target_date_str`.

---

### `HIGH-05` — Blocking 127s Backend Sync vs 3.5s Frontend Abort, Wrong MND Response Key & False-Positive Success Toasts
- **Exact File Path & Line Numbers:**
  - `backend/mnd_sync_service.py:542-575, 605-656` (up to ~127s sequential HTTP timeouts)
  - `js/fuel-engine.js:1551-1586, 1590-1615` (3.5s `AbortController` + wrong response key `data.data || data.sync_data` instead of `data.mnd`)
  - `backend/main.py:319` (`return {"success": True, "mnd": res, "live_state": state}`)
  - `js/telemetry.js:173-176, 450-457, 515-520` (Garmin sync error masking)
- **Root Cause:**
  1. `POST /api/mnd/sync` executes up to 15 sequential blocking `requests.get()` calls (`15+15+10+12+10 + 9×8s = 134s` worst case) on a cold cache. Meanwhile, the frontend (`js/fuel-engine.js:1551-1552`) aborts `/api/mnd/sync` after **3.5 seconds**, falls into `catch`, reads stale `localStorage`, and shows a green toast `"✓ Synced from MyNetDiary"`.
  2. Even when `/api/mnd/sync` succeeds within 3.5s, `js/fuel-engine.js:1575` extracts `data.totals ? data : (data.data || data.sync_data || data)`, missing `backend/main.py:319`'s actual key `data.mnd`. Consequently `payload.totals` is `undefined`, and the toast announces `"0 kcal • 0g P • 0 meals"`.
  3. Similarly, `triggerGarminCloudSync()` (`js/telemetry.js:450-457, 515-520`) and `triggerSilentGarminSync()` (`173-176`) treat HTTP 500s, network errors, and timeouts as `"✓ Today's Garmin workout is already loaded!"`, hiding real sync outages.
- **Reproduction / Verification Steps:**
  1. Click Sync MyNetDiary on a cold backend -> request aborts at 3.5s (`AbortError`) while UI shows green success toast.
  2. Mock a fast 200 response `{"success": true, "mnd": {"totals": {"calories": 2300, "protein": 216}}}` -> `js/fuel-engine.js:1575` logs `0 kcal • 0g P • 0 meals`.
  3. Stop backend and click Garmin Sync -> UI still reports `"✓ Today's Garmin workout is already loaded!"`.
- **Proposed Atomic Fix:**
  1. Decouple 10-day MND history backfill into a background task so `POST /api/mnd/sync` only fetches today's meals/analysis (< 3s) and increase the frontend abort timeout to `20000ms`.
  2. Update `js/fuel-engine.js:1575` to `const payload = data.mnd || data.data || data.sync_data || data;`.
  3. Display explicit warning/error states on non-2xx responses and network failures in `js/fuel-engine.js` and `js/telemetry.js` instead of false-positive success toasts.

---

### `HIGH-06` — SQLite Concurrency Locking (`init_db()` on Every Call, No WAL) + Manual Scale Skips DB & ZeroDivision Risk
- **Exact File Path & Line Numbers:**
  - `backend/db.py:16-19, 22-85, 168, 173, 178, 236, 250, 278, 296, 307, 321`
  - `backend/main.py:335-373` (`POST /api/renpho/manual`)
  - `backend/renpho_sync_service.py:23-35` (fresh Renpho login every 5 min)
- **Root Cause:**
  1. Every read and write function in `backend/db.py` invokes `init_db()`, which opens a new connection, executes 4 `CREATE TABLE IF NOT EXISTS` DDL statements, runs `SELECT COUNT(*)`, and commits — all in default rollback-journal mode (no `PRAGMA journal_mode=WAL`, no `PRAGMA busy_timeout`). Under concurrent FastAPI + APScheduler threads, writers contend on `CREATE TABLE` schema locks and trigger `sqlite3.OperationalError: database is locked`.
  2. `POST /api/renpho/manual` (`backend/main.py:335-373`) updates `live_state.json` but **never calls `db.upsert_renpho_measurements()`**, so manual weigh-ins never appear in `/api/renpho/history` or the 30-day body-composition trend chart. It also divides by `weight_kg` without validating `weight_kg > 0` (`ZeroDivisionError` on `0`).
  3. `RenphoSyncService.sync()` (`backend/renpho_sync_service.py:23-35`) creates a new `RenphoWeight` client and executes a full cloud authentication on every 5-minute cron run (288 logins/day), risking Renpho account lockout.
- **Reproduction / Verification Steps:**
  1. POST `{"weight_kg": 0}` to `/api/renpho/manual` -> triggers HTTP 500 `ZeroDivisionError`.
  2. POST `{"weight_kg": 96.5, "body_fat_pct": 16.5}` to `/api/renpho/manual`, then call `GET /api/renpho/history?days=30` -> manual entry is absent.
  3. Inspect `backend/db.py:168-321` -> 10 separate `init_db()` calls across module and functions.
- **Proposed Atomic Fix:**
  1. Call `init_db()` once during FastAPI `lifespan` startup; configure `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;` inside `get_conn()` using a context manager.
  2. Validate `weight_kg: float = Field(..., gt=20, lt=300)` and `body_fat_pct: Optional[float] = Field(None, ge=3, le=60)` in `ManualScalePayload` and persist manual entries to SQLite via `db.upsert_renpho_measurements()`.
  3. Cache the Renpho client/session token and reduce Renpho cloud sync cadence to every 60 minutes (or on-demand).

---

### `HIGH-07` — Railway / Docker / APScheduler Infrastructure Defects & Broken Service Worker Fallbacks
- **Exact File Path & Line Numbers:**
  - `Dockerfile:13-16, 21` vs `backend/Dockerfile:12, 17`
  - `railway.json:1-12` vs `backend/railway.json:1-11` vs `backend/Procfile:1`
  - `backend/main.py:176, 200, 308, 324, 589-606`
  - `sw.js:44-50, 64`
  - `backend/requirements.txt:1-9` (unpinned `>=`)
- **Root Cause:**
  1. **Conflicting deployment configs & missing healthcheck:** Two `Dockerfile`s and two `railway.json` files exist. `backend/Dockerfile` relies on manually mirrored `backend/static/` (which `build.js` never updates), while root `Dockerfile:16` copies `live_state.json` to `/app/live_state.json` (never `/app/static/live_state.json`, and `backend/main.py` has no `/live_state.json` route for the fallback fetch at `js/telemetry.js:2468`). Neither `railway.json` sets `"healthcheckPath": "/api/health"`, and both override `CMD` with raw `uvicorn ... --port $PORT` without `${PORT:-8080}` fallback.
  2. **Import-time APScheduler & shared `try` block (`backend/main.py:591-606`):** `scheduler.start()` runs at module import time (outside FastAPI `lifespan`), has no graceful `scheduler.shutdown()`, duplicates jobs if `--workers > 1` is ever set, and executes `mnd_service.fetch_today_data()` and `renpho_service.sync()` inside the **same `try` block** — any MyNetDiary network timeout aborts Renpho sync.
  3. **State-mutating `GET` routes (`backend/main.py:200, 308, 324`):** `/api/garmin/sync`, `/api/mnd/sync`, and `/api/renpho/sync` expose `GET` handlers that mutate state and accept Pydantic request bodies (`payload: Optional[DatePayload] = None`), violating HTTP semantics and triggering external syncs on browser prefetch/crawlers.
  4. **Service Worker bugs (`sw.js:44-50, 64`):** Line `64` writes `.catch(() => caches.match(event.request) || caches.match('/index.html'))` — `caches.match()` returns a `Promise` (always truthy), making `caches.match('/index.html')` **dead code** (offline deep links break). Line `48` resolves to `undefined` on offline `/api/*` misses, causing `FetchEvent.respondWith` to throw `TypeError`.
- **Reproduction / Verification Steps:**
  1. Inspect `sw.js:64`: `Boolean(caches.match('/missing'))` is always `true`, so `/index.html` fallback never runs.
  2. Take server offline and call `fetch('/api/live_state')` -> SW throws `TypeError: Failed to convert value to 'Response'`.
  3. Simulate an exception in `mnd_service.fetch_today_data()` inside `run_scheduled_sync()` -> `renpho_service.sync()` is skipped.
- **Proposed Atomic Fix:**
  1. Consolidate on root `Dockerfile` + root `railway.json` (remove stale `backend/Dockerfile`, `backend/railway.json`, `backend/Procfile`), add `"healthcheckPath": "/api/health"`, and use `sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"`.
  2. Move `BackgroundScheduler` startup/shutdown into FastAPI's `@asynccontextmanager async def lifespan(app)` and give Garmin, MND, and Renpho independent `try/except` blocks in `run_scheduled_sync()`.
  3. Restrict `/api/garmin/sync`, `/api/mnd/sync`, and `/api/renpho/sync` to `POST` only (updating `js/telemetry.js:436, 2560` to `POST` `/api/renpho/sync`).
  4. Fix `sw.js:64` to `.catch(() => caches.match(event.request).then(r => r || caches.match('/index.html')))` and return `new Response('{"offline":true}', {status: 503, headers: {'Content-Type':'application/json'}})` on offline `/api/*` misses.

---

### `HIGH-08` — Manual Today Activities Wiped on Sync & Conditioning-to-Garmin Matching Permanently Broken
- **Exact File Path & Line Numbers:**
  - `js/telemetry.js:2160` (manual activity wipe predicate)
  - `js/telemetry.js:65-75` vs `js/workout-engine.js:4566` (`Array.isArray(condHist)` on an Object map)
  - `js/telemetry.js:1954-2283` (MND nutrition rendering trapped inside `if (state.garmin)`)
- **Root Cause:**
  1. In `js/telemetry.js:2160`, deduplicating manual vs Garmin activities uses `Math.abs(aCals - gaCals) <= 15 || (a.isToday && ga.isToday)`. Because of the `|| (a.isToday && ga.isToday)` clause, **every manual activity logged today is unconditionally deleted** whenever ANY Garmin activity exists for today (even a morning walk wiping an evening kettlebell log).
  2. `js/workout-engine.js:4566` stores `pulse_conditioning_history` in `localStorage` as a plain Object keyed by exercise ID (`{ [exId]: { ... } }`), but `getMatchedPulseSessionForGarmin()` (`js/telemetry.js:69`) checks `if (Array.isArray(condHist))` — which is always `false`, permanently disabling Garmin-to-Pulse conditioning enrichment.
  3. All MyNetDiary meal/macro DOM updates in `applyLiveStateToDOM()` (`js/telemetry.js:1954-2283`) are nested inside `if (state.garmin) { ... }`. If Garmin telemetry is absent or lagged (`state.garmin` missing/null), the entire nutrition dashboard fails to render even when `state.mnd_logged` and `state.mnd_meals` are valid.
- **Reproduction / Verification Steps:**
  1. Log a manual workout today while `state.garmin.today_activities` contains a walk -> run `applyLiveStateToDOM()` -> manual workout disappears.
  2. Complete a KB conditioning workout -> inspect `JSON.parse(localStorage.pulse_conditioning_history)` (Object) -> call `getMatchedPulseSessionForGarmin()` -> skips conditioning block completely.
  3. Pass `{ mnd_logged: { calories: 2000 }, mnd_meals: {...} }` (without `garmin`) to `applyLiveStateToDOM()` -> Fuel UI stays blank/stale.
- **Proposed Atomic Fix:**
  1. Change `js/telemetry.js:2160` to match only when BOTH date and calorie/type proximity agree (`a.isToday && ga.isToday && Math.abs(aCals - gaCals) <= 25 && a.type === ga.type`).
  2. Normalize `condHist` in `js/telemetry.js:69` (`const condList = Array.isArray(condHist) ? condHist : Object.values(condHist || {});`).
  3. Close the `if (state.garmin)` block before MND nutrition ingestion in `applyLiveStateToDOM()` so MND and Renpho render independently of Garmin state.

---

### `HIGH-09` — `js/charts.js` Schema Mismatches (`undefined` / `NaNkg`), Falsy Zero TE Override & 3× Boot Render Storm
- **Exact File Path & Line Numbers:**
  - `js/charts.js:42, 90, 267-268, 557, 580, 615`
  - `js/charts.js:1085-1097`
  - `js/charts.js:1264-1278`
- **Root Cause:**
  1. `charts.js` reads camelCase properties (`act.durationMin`, `act.avgHr`, `act.aerobicTe`, `act.anaerobicTe`), whereas `BAKED_LIVE_STATE.garmin.recent_activities` uses snake_case (`duration_min`, `avg_hr`, `aerobic_te`, `anaerobic_te`). When rendering from `live_state.json` fallback, line `580` prints `⏱ undefined min` and HR charts default to `30` min.
  2. Lines `267-268` use `Number(act.aerobicTe || 2.2)` and `Number(act.anaerobicTe || 1.5)`, treating legitimate `0.0` Training Effect (e.g., easy recovery walk) as falsy and fabricating `2.2` / `1.5`.
  3. Lines `1085-1091` wrap non-numeric prescription weights like `"Bodyweight"` or `"24kg"` in `Number(...)`, yielding `NaN` and rendering `NaNkg` in strength progression cards.
  4. Lines `1264-1278` schedule `initPulseCharts()` **three separate times on boot** (immediate, `+350ms`, and `window.load + 250ms`), firing 6 redundant `/api/renpho/history` and `/api/strength/history` fetches and tearing down/recreating charts mid-render.
- **Reproduction / Verification Steps:**
  1. Open Network tab on initial load -> observe 3× `GET /api/renpho/history?days=30` and 3× `GET /api/strength/history?days=30`.
  2. Pass a snake_case activity with `aerobic_te: 0` into `renderActivityHistoryCard()` -> displays `undefined min` and `2.2` TE.
  3. Set any lift's `weight` in `strength_prescriptions` to `"Bodyweight"` -> strength chart card renders `NaNkg`.
- **Proposed Atomic Fix:**
  1. Normalize activity keys with nullish coalescing: `act.durationMin ?? act.duration_min ?? 0`, `act.aerobicTe ?? act.aerobic_te ?? 0`, etc.
  2. Guard `Number()` conversions in `js/charts.js:1085-1097` with `parseFloat()` + `Number.isFinite()` fallback (`'BW'` / default numeric weight).
  3. Deduplicate `initPulseCharts()` via a single `DOMContentLoaded` listener + an in-flight guard promise.

---

### `HIGH-10` — Workout Engine Runtime Defects: Undefined `startRestTimer()`, Stuck `restTimerInterval`, Broken Timer Reset/Loop & Stripped KB Flow Metadata
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:5038-5040` (`startRestTimer()` does not exist — real function is `startRestCountdown()`)
  - `js/workout-engine.js:5434, 6528, 6559` (`restTimerInterval` never set to `null` after `clearInterval()`)
  - `js/workout-engine.js:5182-5240` (`#inlineTimerPhaseBadge` never updated on work/rest/round transitions)
  - `js/workout-engine.js:6720-6739, 6762-6773` (Skip timer loops forever past Round 6; `resetTimer()` doesn't reset `tRounds`/`isWorkPhase`/labels)
  - `js/workout-engine.js:4469-4479, 5954-5964` (`launchDynamicWorkout()` & `selectSwapExercise()` strip `format`, `flowSteps`, `durationSec`, `workSec`, `restSec`, `rounds`, `handMode`, `repsPerRound`, `kbRepsPerRound`)
- **Root Cause:**
  1. Logging an inline conditioning round in `none_rest` mode checks `typeof startRestTimer === 'function'` (`5038`), which is always `false` because the function is named `startRestCountdown()` (`6496`). Rest countdown never starts.
  2. `clearInterval(restTimerInterval)` at lines `6528` (timer complete) and `6559` (`skipRest()`) leaves the numeric interval ID assigned to `restTimerInterval`. Subsequent exercises fail the `if (!restTimerInterval)` guard at `5434`, permanently locking `restSecs` to the first exercise's rest duration.
  3. `toggleInlineTimer()` ticks through work/rest/intermission phases without updating `#inlineTimerPhaseBadge` (`4964`), leaving the badge frozen at its initial state.
  4. Standalone Skip timer (`6720-6739`) increments `tRounds` indefinitely with no cap at Round 6, and `resetTimer()` (`6762-6773`) omits resetting `tRounds = 1`, `isWorkPhase = true`, and phase labels.
  5. `selectSwapExercise()` (`5954-5964`) and `launchDynamicWorkout()` (`4469-4479`) manually whitelist only strength fields when cloning exercises, stripping timed/KB Flow properties so swapped or launched conditioning exercises lose their interval timers and flow steps.
- **Reproduction / Verification Steps:**
  1. Complete set 1 of an exercise with 90s rest -> skip rest -> advance to an exercise with 45s rest -> rest display stays stuck at 90s.
  2. Swap a strength exercise to a KB Flow exercise -> inline flow timer and flow steps vanish.
  3. Run Timer tab in Skip mode past Round 6 -> timer enters Round 7+; hit Reset -> round counter stays at Round 7.
- **Proposed Atomic Fix:**
  1. Call `startRestCountdown()` at `js/workout-engine.js:5038-5040`.
  2. Set `restTimerInterval = null;` immediately after every `clearInterval(restTimerInterval)` (`6528, 6559`).
  3. Update `#inlineTimerPhaseBadge` text and color inside `toggleInlineTimer()` on every phase switch.
  4. Stop Skip timer at `tRounds >= 6` with completion audio/toast, and reset `tRounds = 1`, `isWorkPhase = true`, and DOM labels in `resetTimer()`.
  5. Spread the full source exercise object (`{ ...foundEx, targetWeight, targetReps, setsCount }`) in `launchDynamicWorkout()` and `selectSwapExercise()`.

---

### `HIGH-11` — Workout Engine Data Corruption: `+5kg` vs `+2.5kg` Mismatch, Misclassified `finishSession()`, Corrupted Manual Weight Display & Broken Injury Guardrails
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:6427-6428` vs `6476-6477` (`+5.0kg` banner vs `+2.5kg` saved)
  - `js/workout-engine.js:6589` (`finishSession()` records stale `currentPreset`)
  - `js/workout-engine.js:2303, 2315-2317` (`saveManualWeight()` double-unit corruption & stale BF%)
  - `js/workout-engine.js:2529` (`dips_chair` instead of `weighted_dips`; missing elbow/wrist guardrails)
  - `js/telemetry.js:1334-1338` (`analyzeAthleteInjury()` silently maps unrecognized injury text to `knees`)
- **Root Cause:**
  1. `logSet()` announces `+5.0kg` overload progression in the UI banner (`6427-6428`), but actually persists `+2.5kg` (`6476-6477`, matching `backend/main.py:444`).
  2. `finishSession()` (`6589`) tags completed sessions with `currentPreset` (defaults to `'gym'`) regardless of whether the user launched Option B (KB/Conditioning) or Option C (Recovery Flush), misclassifying recovery sessions as Heavy Barbell Strength in history and weekly pattern balance.
  3. `saveManualWeight()` (`2315-2317`) formats `#vitalScale` and `#vitalScaleSub` with appended units (`17.1% BF (-2.42kg)% BF`) when `index.html:227-236` already renders adjacent unit labels, and skips recalculating `body_fat_pct` from `lean_mass_kg` when the BF input is left blank (`2303`).
  4. `generateWorkoutFromGearAndGoal()` (`2529`) filters out non-existent ID `dips_chair` instead of `weighted_dips` for shoulder injuries, and neither generator filters elbow/wrist-aggravating movements when `athleteInjuries.elbows` or `athleteInjuries.wrists` is true.
  5. `analyzeAthleteInjury()` (`js/telemetry.js:1334-1338`) falls through to `knees = true` for any unrecognized symptom description (e.g., `"sore hamstring"` or `"neck stiffness"`).
- **Reproduction / Verification Steps:**
  1. Hit target reps on all sets of a lift -> observe `+5.0kg` banner while saved prescription only increases `+2.5kg`.
  2. Launch Option C (Recovery Flush) and finish -> inspect `localStorage.pulse_session_history` -> logged as `'gym'`.
  3. Type `"stiff neck"` in Injury Coach -> observe `knees` injury toggled ON.
- **Proposed Atomic Fix:**
  1. Align `js/workout-engine.js:6427-6428` banner calculation with the `+2.5kg` persisted increment.
  2. Track `activeSessionMeta = { archetypeKey, title, optionId }` at workout launch and persist it in `finishSession()`.
  3. Fix `saveManualWeight()` to write bare numeric values matching `index.html:227-236` and recalculate `bf = ((w - lbm) / w) * 100` when BF input is empty.
  4. Fix `dips_chair` -> `weighted_dips`, add elbow/wrist exclusion lists in both generators, and return a clear `"No specific joint matched — toggle affected joints manually"` message instead of defaulting to `knees`.

---

### `HIGH-12` — Cross-Stack UTC vs `Europe/London` Timezone Drift Causes Midnight Date Offsets
- **Exact File Path & Line Numbers:**
  - `backend/db.py:95, 127, 182, 238, 254, 280, 316` (naive `datetime.now()` / server UTC)
  - `backend/renpho_sync_service.py:65-67` (naive `datetime.fromtimestamp()` / `datetime.now()`)
  - `backend/garmin_sync_service.py` vs `backend/mnd_sync_service.py` (use `ZoneInfo("Europe/London")`)
  - `js/workout-engine.js:3631, 4498` & `js/telemetry.js:1776` (`new Date().toISOString().split('T')[0]` UTC date)
- **Root Cause:** Railway containers run in `UTC`, while `garmin_sync_service.py` and `mnd_sync_service.py` explicitly use `Europe/London` (BST = UTC+1 in summer). `backend/db.py` and `renpho_sync_service.py` use naive `datetime.now()`, and frontend date checks in `js/workout-engine.js:3631,4498` and `js/telemetry.js:1776` use `.toISOString().split('T')[0]` (UTC). During BST between 00:00–00:59 UK time (or for any non-UTC user), hydration queries (`db.get_hydration_total(today_str)`), Renpho timestamps (2 date mismatches already confirmed in `backend/renpho_seed.json`), and frontend "isToday" activity matching disagree by 1 full day.
- **Reproduction / Verification Steps:**
  1. Run with `TZ=UTC` at `23:30 UTC` during BST (`00:30` UK next day): `mnd_sync_service.uk_today_str()` returns day `D+1`, while `db.log_hydration()` timestamps day `D` and JS `.toISOString().split('T')[0]` checks day `D`.
- **Proposed Atomic Fix:**
  1. Introduce a shared `uk_now()` / `uk_today_str()` helper in `backend/time_utils.py` and use it consistently across `db.py`, `main.py`, `renpho_sync_service.py`, `garmin_sync_service.py`, and `mnd_sync_service.py`.
  2. Replace `.toISOString().split('T')[0]` in `js/*.js` with a shared local-date formatter (`getLocalDateStr()`).

---

### `HIGH-13` — Multiple Frontend `localStorage`-Only Nutrition Writes Never Sync to Backend & Quick Log Corrupts Macros
- **Exact File Path & Line Numbers:**
  - `js/fuel-engine.js:1656-1815` (MND paste/override & meal edits)
  - `js/fuel-engine.js:1905-1963` (`saveQuickLog()`)
  - `js/fuel-engine.js:1691-1697` vs `index.html:1942` (`parseMndPastedText()` regex fails on its own placeholder format)
- **Root Cause:**
  1. Quick Log (`saveQuickLog()`), MND manual override, and inline meal edits only mutate `localStorage.pulse_mnd_data` and DOM — they never POST to the backend and are silently overwritten on the next 5-minute sync or page reload.
  2. `saveQuickLog()` (`js/fuel-engine.js:1905-1963`) assigns **all non-protein calories to fat (`carbs = 0`)**, distorting macro splits and carb targets.
  3. `parseMndPastedText()` (`js/fuel-engine.js:1691-1697`) cannot parse the exact example string shown in the textarea placeholder at `index.html:1942`.
- **Reproduction / Verification Steps:**
  1. Open Quick Log -> log 500 kcal, 30g protein -> inspect macros -> carbs stay `0g` and ~42g fat is added.
  2. Copy the placeholder text from `index.html:1942` into the MND Paste modal and click Parse -> yields `0` or misparsed values.
  3. Reload after Quick Log -> backend `live_state.json` overwrites the manual entry.
- **Proposed Atomic Fix:**
  1. Add optional carbs/fat inputs (or balanced macro estimation) to Quick Log and add a `POST /api/mnd/manual` backend endpoint that persists manual meal entries alongside cloud MND data for the current date.
  2. Align `parseMndPastedText()` regex patterns with the `index.html:1942` placeholder format and add unit test cases.

---

### `HIGH-14` — Stale Committed Build Mirrors (`public/`, `dist/`, `.vercel/output/static/`) Diverge From Root Source
- **Exact File Path & Line Numbers:**
  - `build.js:1-94`
  - `public/*`, `dist/*`, `.vercel/output/static/*` vs root `index.html`, `js/*.js`, `css/styles.css`, `backend/static/*`
  - `public/vercel.json:1-46` vs `vercel.json:1-4`
- **Root Cause:** `public/`, `dist/`, and `.vercel/output/static/` are tracked in git and contain outdated copies of `index.html`, `js/*.js`, and `css/styles.css` that differ from root and `backend/static/`. Meanwhile, `build.js` copies root assets into `public/`, `dist/`, and `.vercel/output/static/`, **but never updates `backend/static/`**. Deploying via Vercel or `backend/Dockerfile` risks serving completely mismatched frontend/backend versions.
- **Reproduction / Verification Steps:**
  1. Run `diff -q index.html public/index.html` and `diff -q js/workout-engine.js dist/js/workout-engine.js` -> files differ.
  2. Inspect `build.js` -> zero references to `backend/static`.
- **Proposed Atomic Fix:**
  1. Stop tracking generated build output directories (`dist/`, `.vercel/`, `public/`) in git (add to `.gitignore`) and generate them strictly at build time.
  2. Update `build.js` (or Railway's single root `Dockerfile`) so frontend assets are always sourced from a single canonical root directory.

---

## MEDIUM Issues

### `MED-01` — Fabricated Synthetic Charts & Sparklines Displayed as Real Biometric Data
- **Exact File Path & Line Numbers:**
  - `js/charts.js:731-753` (synthetic sine-wave 30-day body-composition curve)
  - `js/charts.js:1107-1117` (synthetic W1–W3 strength progression bars when `< 4` logs exist)
  - `js/telemetry.js:1838-1855` (synthetic readiness/HRV sparklines)
- **Root Cause:** When `/api/renpho/history` or `/api/strength/history` returns fewer than 2–4 points (or fails), the chart code manufactures smooth sine/cosine curves (`Math.sin(i * 0.8) * 0.04`) and fake historical weeks with no visual disclaimer, misleading the athlete into thinking real trends exist.
- **Reproduction / Verification Steps:**
  1. Block `/api/renpho/history` in DevTools -> Body composition chart still renders a plausible 30-day sine-wave trend with zero "Sample/Unavailable" indicator.
- **Proposed Atomic Fix:** Render an explicit empty/insufficient-data state (e.g., `"Need ≥ 2 weigh-ins for trend"`) or plot only real recorded data points without synthetic interpolation.

---

### `MED-02` — Diet Strategy & Fasting Protocol Controls Broken / Reset on Every Reload
- **Exact File Path & Line Numbers:**
  - `js/fuel-engine.js:1965-1982` (`selectDietStrategy()`)
  - `js/telemetry.js:2588-2610, 2650` (`setFastingProtocol()`, `pulse_fasting_protocol` write-only)
  - `js/fuel-engine.js:1180-1240` (fasting timer `running = true` with no active `setInterval`)
- **Root Cause:** `selectDietStrategy()` switches panel visibility without updating the strategy badge or recalculating macro targets. `setFastingProtocol()` writes `localStorage.setItem('pulse_fasting_protocol', key)` (`js/telemetry.js:2608`), which is **never read back anywhere**, and boot initialization at `js/telemetry.js:2650` unconditionally calls `setFastingProtocol('16_8')`, erasing the user's choice on every reload while never updating fasting timer hours.
- **Reproduction / Verification Steps:**
  1. Select `18:6` fasting protocol -> reload page -> resets to `16:8`.
  2. Switch diet strategy -> daily carb/fat targets remain unchanged.
- **Proposed Atomic Fix:** Read `localStorage.getItem('pulse_fasting_protocol') || '16_8'` on boot, sync fasting window hours + active timer interval, and invoke `calculateDailyTargets()` inside `selectDietStrategy()`.

---

### `MED-03` — Renpho Scale Label Always Prints `(Synced Today)` & Unguarded Type Conversions
- **Exact File Path & Line Numbers:**
  - `js/telemetry.js:2313, 2320-2335`
- **Root Cause:** Line `2313` hardcodes `` `${r.body_fat_pct.toFixed(1)}% Body Fat (Synced Today)` `` regardless of `r.last_synced` (even when the scale data is 5 days stale, as in `live_state.json` `2026-11-14`). Additionally, `.toFixed(1)` throws `TypeError` if `r.weight_kg` or `r.body_fat_pct` is a string/null, and `if (r.fat_to_lose_kg)` skips rendering `0.0kg` when goal weight is reached.
- **Reproduction / Verification Steps:**
  1. Load `live_state.json` (Renpho date `2026-11-14`) on `2026-11-19` -> UI still says `(Synced Today)`.
  2. Set `renpho.fat_to_lose_kg = 0` -> UI leaves stale fallback text instead of `0.0kg`.
- **Proposed Atomic Fix:** Format relative sync age from `r.last_synced` (e.g., `Synced Today` vs `Synced 14 Nov`), wrap numeric reads in `Number(...)` with `Number.isFinite()`, and check `r.fat_to_lose_kg != null`.

---

### `MED-04` — Same-Day Workout Banner Deduplicates Strictly by Rounded Calories
- **Exact File Path & Line Numbers:**
  - `js/telemetry.js:2233-2235`
- **Root Cause:** Banner deduplication collapses two distinct same-day workouts whenever `Math.round(a.calories) === Math.round(b.calories)` (e.g., two 250 kcal walk/skip sessions on the same day), silently dropping the second workout from the Today banner.
- **Reproduction / Verification Steps:**
  1. Include two distinct Garmin activities today with different IDs (`101`, `102`) both burning `250` kcal -> only one renders in the Today workout banner.
- **Proposed Atomic Fix:** Deduplicate by canonical `String(act.id)` first, and only apply calorie proximity deduplication when one item lacks a real Garmin ID (manual/bridge entry).

---

### `MED-05` — `switchTab('train')` Overwrites User's Manually Selected Archetype Highlight
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:6645-6649`
- **Root Cause:** Navigating back to the `Train` tab unconditionally invokes `renderTodayTrainingRecommendations()`, which resets dynamic archetype button labels and active highlights back to the readiness verdict's default archetype even if the user explicitly switched to another archetype tab.
- **Reproduction / Verification Steps:**
  1. On Train tab, click a secondary archetype -> switch to Fuel tab -> switch back to Train tab -> selection reverts to default verdict archetype.
- **Proposed Atomic Fix:** Preserve `currentArchetypeKey` when re-entering `Train` unless readiness data has changed since last render.

---

### `MED-06` — Premature Body-Composition Plateau Banner Fires Before History Loads
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:3808-3811`
- **Root Cause:** The plateau banner condition evaluates `if (fatToLose > 1.0)` synchronously before `/api/renpho/history` resolves to confirm an actual multi-week stall, falsely alerting the user to a fat-loss plateau on every boot.
- **Reproduction / Verification Steps:**
  1. Load page with `fatToLose = 2.42` while losing weight rapidly -> plateau warning still renders.
- **Proposed Atomic Fix:** Gate the plateau banner on actual 14-day weight delta from `/api/renpho/history` (e.g., `deltaKg > -0.2` over ≥ 14 days with ≥ 4 weigh-ins).

---

### `MED-07` — Unwritten `pulse_strength_history` & Unread `pulse_tomorrow_plan` / `pulse_sleep_score_override` Orphan `localStorage` Keys
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:2600` (`pulse_strength_history` read-only — never written anywhere)
  - `js/workout-engine.js:3311` (`pulse_tomorrow_plan` write-only — never read anywhere)
  - `js/workout-engine.js:6173` (`pulse_sleep_score_override` write-only — reader uses `pulse_sleep_score_override_obj`)
- **Root Cause:** `renderWeeklyPatternBalance()` (`js/workout-engine.js:2600`) reads `pulse_strength_history`, which no code path ever writes (actual sessions are stored in `pulse_session_history`), so weekly movement-pattern balance never reflects logged strength sessions. Similarly, saving "Tomorrow's Plan" (`3311`) stores `pulse_tomorrow_plan`, which is never read on the next day.
- **Reproduction / Verification Steps:**
  1. Log a full strength session -> check `localStorage.getItem('pulse_strength_history')` -> `null`.
  2. Pick a tomorrow workout plan -> reload -> `pulse_tomorrow_plan` is never consulted.
- **Proposed Atomic Fix:** Source `renderWeeklyPatternBalance()` from `pulse_session_history` + `/api/strength/history`, read `pulse_tomorrow_plan` during next-day initialization (with date key), and remove the redundant `pulse_sleep_score_override` write.

---

### `MED-08` — `gearConfig` Getter Property `dumbbells` Causes Duplicate Gear Enumeration
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:257-270, 2499`
- **Root Cause:** `gearConfig` defines an enumerable getter `dumbbells` aliasing `adjustable_dumbbells`. `Object.keys(gearConfig)` (`2499`) enumerates both keys, double-counting available gear and injecting duplicate references during preset evaluation.
- **Reproduction / Verification Steps:**
  1. Inspect `Object.keys(gearConfig).filter(k => gearConfig[k])` -> includes both `adjustable_dumbbells` and `dumbbells`.
- **Proposed Atomic Fix:** Define `dumbbells` via `Object.defineProperty(gearConfig, 'dumbbells', { enumerable: false, get() { return this.adjustable_dumbbells; } })`.

---

### `MED-09` — Telemetry Override Sets `oauth_date` & Uses Blocking `window.prompt()` Dialogs
- **Exact File Path & Line Numbers:**
  - `backend/main.py:490-493`
  - `js/workout-engine.js:6153, 6205, 6259`
- **Root Cause:** Overriding `body_battery` via `POST /api/telemetry/override` sets `garmin["oauth_date"] = target_date` (`backend/main.py:493`), which tricks `mnd_sync_service.py:832-835` into believing direct Garmin OAuth synced today and suppresses all MND Garmin bridge metrics (steps, sleep, activities) for the rest of the day. On the frontend, all three telemetry overrides use synchronous `window.prompt()` dialogs, which are blocked/broken in installed iOS/Android standalone PWAs.
- **Reproduction / Verification Steps:**
  1. Override Body Battery before Garmin sync -> trigger MND sync -> MND Garmin bridge steps/activities are ignored.
  2. Tap Sleep/BB/Readiness override in iOS standalone PWA -> `window.prompt()` fails or feels broken.
- **Proposed Atomic Fix:** Remove `garmin["oauth_date"] = target_date` from `backend/main.py:493` (rely solely on `body_battery_manual_date`) and replace `window.prompt()` with an inline numeric modal.

---

### `MED-10` — Responsive Layout, Accessibility & Modal UX Defects (`440px` Cap, `user-scalable=no`, Missing Backdrop Close & Scroll Traps)
- **Exact File Path & Line Numbers:**
  - `index.html:5` (`maximum-scale=1.0, user-scalable=no` blocks pinch-to-zoom)
  - `css/styles.css:155, 159-172, 1697` (`user-select: none` on body; desktop hard-capped at `440px`)
  - `css/styles.css:1132-1135` (`.set-log-row.missed` class emitted by JS has no CSS styling)
  - `css/styles.css:1757-1766` (`.modal-card` lacks base `max-height: 90vh; overflow-y: auto;`)
  - `css/styles.css:1242-1249, 2021` (nested scroll containers + global `*::-webkit-scrollbar { display: none; }`)
  - `index.html:1579, 1732, 1772, 1825, 1868, 1919, 1995` (7 modals missing backdrop click-to-close)
- **Root Cause:** Mobile pinch-to-zoom is disabled (WCAG 1.4.4 violation), text cannot be copied anywhere on desktop/mobile (`user-select: none`), tall modals overflow off-screen on short viewports (`< 680px` height) because `.modal-card` has no scroll constraint, 7 of 15 modals cannot be dismissed by clicking the backdrop or pressing `Escape`, and there is no `@media (prefers-reduced-motion: reduce)` handling or responsive tablet/desktop layout above `440px`.
- **Reproduction / Verification Steps:**
  1. Open `#mndSyncModal` or `#syncModal` on a 375×667 viewport -> bottom buttons clip off-screen without scroll.
  2. Click dark backdrop outside `#syncModal` (`index.html:1579`) -> modal stays stuck open.
- **Proposed Atomic Fix:**
  1. Remove `maximum-scale=1.0, user-scalable=no` from `index.html:5`; limit `user-select: none` to interactive controls only.
  2. Add `max-height: 88vh; overflow-y: auto;` to `.modal-card`, add `.set-log-row.missed` styling, and attach backdrop click + `Escape` close listeners to all 15 `.modal-overlay` modals.
  3. Add `@media (min-width: 900px)` multi-column container layout and `@media (prefers-reduced-motion: reduce)` overrides.

---

### `MED-11` — Stale Hardcoded Athlete Copy & `478` Active-Calorie Fallback on Zero-Burn Mornings
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:2913-3079, 4084-4100` (`activeBurn || 478` injects fake 478 kcal burn on 0 kcal mornings)
  - `js/telemetry.js:1359-1360, 1432, 1472` (hardcoded Nov 17 athlete injury/telemetry copy)
  - `index.html:227-265, 680, 995-1035` (hardcoded athlete biometrics, static SVG trends, `2.4L Water • 32g Fiber`)
- **Root Cause:** Multiple UI components and readiness calculators use `||` fallback operators against hardcoded snapshot numbers (`478` active kcal, `97.7kg`, `17.1%`, `2.4L Water`). On fresh mornings when `active_calories` is legitimately `0`, `0 || 478` evaluates to `478`, inflating calorie budgets and workout intensity recommendations.
- **Reproduction / Verification Steps:**
  1. Set `state.garmin.active_calories = 0` -> inspect Fuel/Train readiness cards -> renders `478` kcal active burn.
- **Proposed Atomic Fix:** Replace truthy `||` numeric fallbacks with nullish coalescing (`?? 0`) and render explicit loading skeletons until `/api/live_state` resolves.

---

### `MED-12` — Hardcoded Year Check (`2026`) & Hardcoded Activity IDs Break Permanently on 2027-01-01
- **Exact File Path & Line Numbers:**
  - `js/telemetry.js:773` (`act.date.includes('2026')`)
  - `js/telemetry.js:796, 2149` (hardcoded Garmin/bridge activity IDs `'99202611170'`, `'25109482110'`, etc.)
- **Root Cause:** Date parsing at `js/telemetry.js:773` explicitly checks `act.date.includes('2026')`. Starting January 1, 2027, every ISO activity date (`2027-01-01`) will fail this check and lose its raw date metadata. Lines `796` and `2149` also contain one-off hardcoded historical activity IDs for suppression/enrichment.
- **Reproduction / Verification Steps:**
  1. Pass `{ date: "2027-01-01 07:30:00" }` to the date parser at `js/telemetry.js:773` -> returns `null`.
- **Proposed Atomic Fix:** Replace `act.date.includes('2026')` with `/^\d{4}-\d{2}-\d{2}/.test(act.date)` and move any activity suppression logic to generic `source === 'garmin_via_mnd_bridge'` metadata checks.

---

### `MED-13` — 29 Dead/Orphaned `getElementById()` Calls & No Frontend Global Error Boundary
- **Exact File Path & Line Numbers:**
  - `js/workout-engine.js:2267-2269, 2470-2471, 2506-2519, 2572-2574, 5470-5471, 5992-5995`
  - `js/telemetry.js:622, 629, 1570-1573, 1585-1587, 1753, 2014, 2069, 2074, 2079, 2412, 2422`
  - `index.html` & `js/*.js` (zero `window.onerror` / `unhandledrejection` handlers)
- **Root Cause:** 29 distinct element IDs referenced via `document.getElementById(...)` across `js/telemetry.js`, `js/fuel-engine.js`, and `js/workout-engine.js` (e.g., `#aiRecTitle`, `#aiRecList`, `#coachBriefingBody`, `#exerciseCue`, `#exerciseWhy`, `#fuelBurnNum`, `#fuelGarminBurn`, `#fuelCalTarget`, `#fuelStrategyTitle`, `#todayGoalTitle`, `#vitalRhr`, `#vRhr`, `#vitalBurn`, `#vitalBurnSub`) no longer exist in `index.html`. While most are null-guarded (producing silent no-op UI updates), there is also no global `window.addEventListener('error')` or `unhandledrejection` handler to surface runtime crashes (like `CRIT-06`'s `#opt_custom` crash) to the user.
- **Reproduction / Verification Steps:**
  1. Check Appendix C below for the complete verified list of all 29 missing DOM IDs and exact line numbers.
- **Proposed Atomic Fix:** Reconcile or prune obsolete DOM bindings (wiring `#exerciseCue`, `#exerciseWhy`, `#vitalRhr`, and `#fuelGarminBurn` to real elements where intended) and install a lightweight global error toast/banner via `window.addEventListener('error', ...)` and `window.addEventListener('unhandledrejection', ...)`.

---

## LOW Issues

### `LOW-01` — Unanchored `.gitignore` Patterns Hide Tracked Backend Filenames
- **Exact File Path & Line Numbers:** `.gitignore:38-41`
- **Root Cause:** Patterns `server.py`, `garmin_sync_service.py`, `mnd_sync_service.py`, and `benefits_engine.py` lack a leading `/` anchor, so git ignores untracked files or re-creations with those names inside `backend/` or subdirectories.
- **Reproduction / Verification Steps:** Run `git check-ignore -v backend/mnd_sync_service.py` -> matches `.gitignore:40`.
- **Proposed Atomic Fix:** Anchor root-only ignores with a leading slash (`/server.py`, `/garmin_sync_service.py`, etc.) or remove obsolete root entries.

### `LOW-02` — Hardcoded Developer Machine Paths in Backend Defaults
- **Exact File Path & Line Numbers:**
  - `backend/garmin_sync_service.py:16-17, 25, 37-39` (`/shared/user/.gemini/...`, `/home/antigravity/...`)
  - `backend/mnd_sync_service.py:16, 22` (`/shared/user/.gemini/mnd_tokens`)
  - `backend/renpho_sync_service.py:10` (`/home/antigravity/.gemini/renpho_creds.json`)
- **Root Cause:** Developer-environment absolute paths are baked into runtime fallback chains.
- **Reproduction / Verification Steps:** `grep -rn "/shared/user\|/home/antigravity" backend/`.
- **Proposed Atomic Fix:** Derive all runtime directories strictly from `DATA_DIR` / explicit env vars with a clean relative fallback (`./data`).

### `LOW-03` — Missing `.env.example` & Unpinned Python Dependency Ranges
- **Exact File Path & Line Numbers:** Repo root (no `.env.example`), `backend/requirements.txt:1-9`
- **Root Cause:** None of the 10+ backend environment variables are documented in a `.env.example` file, and `backend/requirements.txt` uses unpinned `>=` ranges (`fastapi>=0.110.0`, `garminconnect>=0.2.18`, `renpho-py>=1.3.1`), exposing Railway rebuilds to sudden upstream breaking changes. Also `python-dotenv` (`requirements.txt:6`) is installed but never imported (`load_dotenv()` is never called in `backend/main.py`).
- **Reproduction / Verification Steps:** Inspect `backend/requirements.txt` and search `backend/*.py` for `dotenv` -> 0 matches.
- **Proposed Atomic Fix:** Add `.env.example`, call `load_dotenv()` at the top of `backend/main.py` for local development, and pin exact tested versions (`==`) in `backend/requirements.txt`.

### `LOW-04` — Duplicate Dynamic Modal Injection Fallback in `workout-engine.js` Diverges From `index.html`
- **Exact File Path & Line Numbers:** `js/workout-engine.js:5568-5633` vs `index.html:2052-2110`
- **Root Cause:** `ensureWorkoutModalsInDom()` duplicates HTML for `#swapExerciseModal` and `#editLoadModal` that already exist in `index.html`, with subtle drift (`#editLoadReps` is `type="number"` in `index.html:2101` vs `type="text"` in `js/workout-engine.js:5622`).
- **Reproduction / Verification Steps:** Compare `index.html:2101` and `js/workout-engine.js:5622`.
- **Proposed Atomic Fix:** Keep one canonical modal markup in `index.html` (with `type="text"` on `#editLoadReps`) and delete the redundant DOM injector.

### `LOW-05` — Unbounded `pulse_recent_activities` & `pulse_session_history` Growth in `localStorage`
- **Exact File Path & Line Numbers:** `js/telemetry.js:638-643`, `js/workout-engine.js:6585-6600`
- **Root Cause:** Arrays stored in `localStorage` (`pulse_session_history`, `pulse_daily_biometrics_history`, `pulse_recent_activities`) grow without pruning/cap, eventually risking `QuotaExceededError` on iOS Safari (~5 MB limit).
- **Reproduction / Verification Steps:** Inspect `localStorage.setItem('pulse_session_history', ...)` — no `.slice(0, N)` retention cap.
- **Proposed Atomic Fix:** Cap client-side caches (e.g., last 90 sessions / 60 days) and wrap `localStorage.setItem` in a safe helper handling `QuotaExceededError`.

### `LOW-06` — `print()` Used Instead of Structured Logging in Sync Services
- **Exact File Path & Line Numbers:** `backend/garmin_sync_service.py`, `backend/mnd_sync_service.py`, `backend/renpho_sync_service.py`
- **Root Cause:** `backend/main.py` uses Python `logging`, whereas the three sync services mix raw `print(...)` calls without timestamps or log levels, making Railway log filtering and error alerting unreliable.
- **Reproduction / Verification Steps:** `grep -c "print(" backend/*_sync_service.py`.
- **Proposed Atomic Fix:** Replace `print()` calls with module-level `logger = logging.getLogger(__name__)`.

### `LOW-07` — Redundant `POST /api/renpho/sync` / `GET /api/live_state` Dual Boot Sequence
- **Exact File Path & Line Numbers:** `js/telemetry.js:2460-2570`
- **Root Cause:** On initial page boot, `loadLiveState()` triggers `GET /api/live_state`, `GET /api/garmin/export_token`, `GET /api/renpho/history?days=14`, `GET /api/renpho/sync` (hitting live Renpho cloud!), plus `+1500ms` `POST /api/garmin/sync` — firing external third-party cloud logins on every single page load.
- **Reproduction / Verification Steps:** Open Network tab and reload the page once -> observe immediate `/api/renpho/sync` and `/api/garmin/sync` calls.
- **Proposed Atomic Fix:** Boot purely from `GET /api/live_state` + `GET /api/renpho/history`; rely on the backend cron (or explicit user Sync button) for third-party cloud pulls.

---

## Appendix A — Frontend-to-Backend API Endpoint Cross-Reference Matrix

| Frontend Caller | Method & Path | Backend Route (`backend/main.py`) | Status / Finding |
|---|---|---|---|
| `js/telemetry.js:2461` | `GET /api/live_state` | `L184: GET /api/live_state` | ✅ Matched (unauthenticated; `CRIT-02`, `CRIT-03`) |
| `js/telemetry.js:2468` | `GET ./live_state.json?t=...` | **None** | ⚠️ 404 fallback in Docker/Railway (`HIGH-07`) |
| `js/telemetry.js:6,192,2517` | `GET /api/garmin/export_token` | `L193: GET /api/garmin/export_token` | 🔴 Unauthenticated OAuth token leak (`CRIT-02`) |
| `js/telemetry.js:154,442` | `POST /api/garmin/sync` | `L200-201: GET/POST /api/garmin/sync` | 🟠 Rate-limit storm + false-positive catch (`HIGH-04`, `HIGH-05`) |
| `js/telemetry.js:538` | `POST /api/garmin/submit_mfa` | `L255: POST /api/garmin/submit_mfa` | 🔴 Returns raw OAuth tokens (`CRIT-02`) |
| `js/telemetry.js:2495` | `POST /api/garmin/restore_session` | `L278: POST /api/garmin/restore_session` | 🔴 Unauthenticated token injection/echo (`CRIT-02`) |
| `js/fuel-engine.js:1401` | `GET /api/mnd/status` | `L304: GET /api/mnd/status` | 🔴 Leaks email unauthenticated (`CRIT-02`) |
| `js/fuel-engine.js:1443` | `POST /api/mnd/login` | **MISSING (404)** | 🔴 Broken login modal (`CRIT-05`) |
| `js/fuel-engine.js:1553` | `POST /api/mnd/sync` | `L308-309: GET/POST /api/mnd/sync` | 🟠 3.5s abort vs 127s sync + wrong key `data.mnd` (`HIGH-05`) |
| `js/telemetry.js:436,2560` | `GET /api/renpho/sync` | `L324-325: GET/POST /api/renpho/sync` | 🟠 State-mutating GET on every page boot (`HIGH-07`, `LOW-07`) |
| `js/workout-engine.js:2331` | `POST /api/renpho/manual` | `L335: POST /api/renpho/manual` | 🟠 Skips SQLite + `ZeroDivisionError` (`HIGH-06`) |
| `js/charts.js:721`, `js/telemetry.js:2537` | `GET /api/renpho/history` | `L376: GET /api/renpho/history` | 🟠 3× duplicate fetch on boot (`HIGH-09`) |
| `js/charts.js:1009` | `GET /api/strength/history` | `L385: GET /api/strength/history` | 🟠 3× duplicate fetch on boot (`HIGH-09`) |
| `js/fuel-engine.js:1864` | `POST /api/hydration/add` | `L394: POST /api/hydration/add` | 🟠 Wiped every 5 min by MND sync (`HIGH-01`) |
| `js/state.js:217,277` | `POST /api/sync_set` | `L422: POST /api/sync_set` | 🔴 Checks `data.status === 'success'` vs `data.success`; 422 on `"Body"` (`CRIT-05`) |
| `js/state.js:304` | `POST /api/sync_session` | **MISSING (404)** | 🔴 Session summaries never saved to backend (`CRIT-05`) |
| `js/telemetry.js:646` | `POST /api/sync_activity` | **MISSING (404)** | 🔴 Manual activities never saved to backend (`CRIT-05`) |
| `js/telemetry.js:752` | `POST /api/annotate_activity` | `L558: POST /api/annotate_activity` | ✅ Matched (unauthenticated; RMW race `CRIT-03`) |
| `js/telemetry.js:1267,1399,1499` | `POST /api/athlete/injuries` | `L461: POST /api/athlete/injuries` | ✅ Matched (unauthenticated; RMW race `CRIT-03`) |
| `js/workout-engine.js:6187,6239,6300` | `POST /api/telemetry/override` | `L468: POST /api/telemetry/override` | 🟡 Body battery override sets `oauth_date` (`MED-09`) |
| `js/workout-engine.js:6131` | `POST /api/prescription/override` | `L518: POST /api/prescription/override` | 🔴 `422` when string reps (`"30s"`) sent (`CRIT-05`) |
| `js/workout-engine.js:609` | `POST /api/preferences/exercises` | `L541: POST /api/preferences/exercises` | ✅ Matched (unauthenticated; RMW race `CRIT-03`) |
| *(Backend only)* | `POST /api/live_state` | `L188: POST /api/live_state` | 🔴 Unauthenticated arbitrary state overwrite (`CRIT-02`) |
| *(Backend only)* | `GET /api/health` | `L176: GET /api/health` | 🟠 Unused in `railway.json` (`HIGH-07`) |

---

## Appendix B — Environment Variables & Hardcoded Secrets Audit

| Variable | Referenced In | Default / Fallback | Status |
|---|---|---|---|
| `PORT` | `Dockerfile:18,21`, `backend/Dockerfile:14,17`, `railway.json:8`, `backend/railway.json:7`, `backend/Procfile:1` | `8080` in Docker/Procfile; **none** in `railway.json` | ⚠️ Inconsistent across configs (`HIGH-07`) |
| `DATA_DIR` | `backend/db.py:10-13` | `/data` if exists else `backend/` | ✅ Good pattern, but ignored by `LIVE_STATE_PATH` & `MND_TOKEN_DIR` (`CRIT-04`) |
| `LIVE_STATE_PATH` | `backend/main.py:51`, `garmin_sync_service.py:40`, `mnd_sync_service.py:25`, `renpho_sync_service.py:15` | Repo root or `backend/live_state.json` (**never checks `/data`**) | 🔴 Ephemeral on Railway (`CRIT-04`) |
| `ARTIFACT_LIVE_STATE_PATH` | `garmin_sync_service.py:41`, `mnd_sync_service.py:26` | `LIVE_STATE_PATH` | 🟡 Unnecessary dual-write target (`CRIT-03`) |
| `GARMIN_TOKEN_DIR` | `garmin_sync_service.py:12-13` | `/data/garmin_tokens` if `/data` exists, else dev/tmp path | 🟡 Hardcoded `/shared/user/.gemini` fallback (`LOW-02`) |
| `GARMIN_TOKENS_JSON` | `garmin_sync_service.py:30-34,152-153,186` | None | ⚠️ Not documented in `.env.example` (`LOW-03`) |
| `MND_TOKEN_DIR` | `mnd_sync_service.py:16` | `/tmp/mnd_tokens` (ephemeral!) | 🔴 Wiped every Railway restart (`CRIT-04`) |
| `MND_USERNAME` / `MND_PASSWORD` | `mnd_sync_service.py:63-64` | Falls back to `RENPHO_EMAIL`/`RENPHO_PASSWORD` -> **hardcoded plaintext creds** | 🔴 Hardcoded plaintext password (`CRIT-01`) |
| `RENPHO_EMAIL` / `RENPHO_PASSWORD` | `mnd_sync_service.py:73`, `renpho_sync_service.py:18-20` | **Hardcoded `'greg.putt@gmail.com'` / `'He11o12345'`** | 🔴 Hardcoded plaintext password (`CRIT-01`) |
| `RENPHO_CREDS_FILE` | `renpho_sync_service.py:10` | `/home/antigravity/.gemini/renpho_creds.json` | 🟡 Hardcoded dev path (`LOW-02`) |

---

## Appendix C — Missing DOM IDs, Orphaned `localStorage` Keys & Modal Audit

### Missing `getElementById()` Targets (29 Static IDs Absent From `index.html`)
`#aiRecBadge` (`workout-engine.js:2506,2515`), `#aiRecGearCount` (`2572`), `#aiRecList` (`2574`), `#aiRecSummary` (`2267,2512,2519`), `#aiRecTitle` (`2508,2517`), `#coachBriefingBody` (`telemetry.js:1753`), `#customExName` / `#customExSets` / `#customExReps` / `#customExWeight` (`workout-engine.js:5992-5995`), `#editLoadWeightInput` / `#editLoadRepsInput` (`workout-engine.js:6058-6059,6089-6090` — safely fallback-chained behind `#editLoadWeight`/`#editLoadReps`), `#exerciseCue` (`5470`), `#exerciseWhy` (`5471`), `#fuelBurnNum` (`telemetry.js:629,2079`), `#fuelCalTarget` (`2422`), `#fuelGarminBurn` (`629,2079`), `#fuelStrategyDesc` (`1587`), `#fuelStrategyTitle` (`1585`), `#gearTriggerSub` (`workout-engine.js:2471`), `#gearTriggerTitle` (`2470`), `#rationaleArrow` (`2268`), `#rationaleToggleText` (`2269`), `#todayGoalSub` (`telemetry.js:1571`), `#todayGoalTitle` (`1570`), `#vRhr` (`2014`), `#vitalRhr` (`2014`), `#vitalBurn` (`fuel-engine.js:288,441`, `telemetry.js:622,1573,2069,2412`), `#vitalBurnSub` (`telemetry.js:2074`).  
**Dynamic ID Crash:** `#opt_custom` (`js/telemetry.js:1207 -> 1591`) — unguarded null dereference (`CRIT-06`).

### Orphaned `localStorage` Keys
| Key | Reads | Writes | Issue |
|---|---|---|---|
| `pulse_strength_history` | `1` (`js/workout-engine.js:2600`) | `0` | Read-only; weekly pattern balance never populates (`MED-07`) |
| `pulse_tomorrow_plan` | `0` | `1` (`js/workout-engine.js:3311`) | Write-only; tomorrow's selected plan is ignored (`MED-07`) |
| `pulse_fasting_protocol` | `0` | `1` (`js/telemetry.js:2608`) | Write-only; reset to `'16_8'` on every boot (`MED-02`) |
| `pulse_sleep_score_override` | `0` | `1` (`js/workout-engine.js:6173`) | Write-only legacy key; reader uses `pulse_sleep_score_override_obj` (`MED-07`) |

### Modal Defect Summary (15 Modals in `index.html`)
- **Invisible on open:** `#sessionSummaryModal` (`index.html:2113`) — JS toggles `.active` instead of `.open` (`CRIT-06`).
- **Unreachable (zero UI trigger):** `#weightModal` (`index.html:1069`) (`CRIT-06`).
- **Missing backdrop click-to-close (7 modals):** `#syncModal` (`1579`), `#annotateModal` (`1732`), `#rationaleModal` (`1772`), `#quickLogModal` (`1825`), `#mndConnectModal` (`1868`), `#mndSyncModal` (`1919`), `#mndLogModal` (`1995`) (`MED-10`).
