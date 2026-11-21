# EGM Phase 1: AI Injury Diagnostics & Triage Module — Concepts Brief

**Phase:** Phase 1 (`/egm-brainstorm` — ELEPHANT Codebase Mapping)  
**Target Module:** AI Injury Diagnostics & Triage Module  
**Repository:** `c:\Projects\my-fitness-app\project-handoff`  
**Status:** Read-Only Codebase Mapping Complete (No Production Code Modified)

---

## 1. Executive Summary & Architecture Snapshot

PULSE ("Hybrid Athlete OS") is a mobile-first PWA backed by a FastAPI server and lightweight local persistence:

- **Frontend Stack:** Vanilla JavaScript, semantic HTML, and CSS custom properties served from root (`index.html`, `css/styles.css`, `sw.js`, `manifest.json`) with 8 ordered `<script>` modules in `index.html:2179-2186`:
  1. `js/state.js` (1,401 lines — globals, `BAKED_LIVE_STATE`, preferences sync, offline write queue, auth modal, audio/speech synthesis, session persistence)
  2. `js/workout-catalog.js` (1,616 lines — `gearConfig`, `presetProfiles`, `dailyArchetypes`, `masterExercises`, `todayWorkoutOptions`)
  3. `js/workout-verdict.js` (2,739 lines — readiness verdict engine, `JOINT_CONTRAINDICATIONS`, `JOINT_SAFE_SWAPS`, `applyJointSafeSwaps()`, daily workout selection)
  4. `js/workout-player.js` (active workout player & inline logging)
  5. `js/workout-timers.js` (rest & EMOM/AMRAP timers)
  6. `js/charts.js` (SVG charts & Garmin strength set decoding)
  7. `js/fuel-engine.js` (nutrition runway & MND integration)
  8. `js/telemetry.js` (3,785 lines — Garmin/Renpho/MND DOM hydration, `#injuryModal` controller, `injuryRules`, `analyzeAthleteInjury()`, `saveInjuries()`)
- **Build & Packaging (`build.js`):** Minifies `css/` and `js/` via `esbuild` (`target: 'es2020'`) and copies static assets into `.vercel/output/static`, `dist/`, `public/`, and `backend/static/`.
  - **Measured Minified Bundle Size (`backend/static/{css,js}`):** **597,949 B (583.9 KB) raw / 158,978 B (155.3 KB) gzip6**.
  - **Architectural Implication:** Keep new frontend Diagnostics code compact (~8–12 KB raw / ~3 KB gzip) in a dedicated `js/diagnostics.js` module, offloading 14–30 day context aggregation, biomechanical look-up tables, clinical red-flag guardrails, and LLM orchestration onto the FastAPI backend.
- **Backend Stack:**
  - `backend/main.py` (1,944 lines): FastAPI application, HMAC cookie session auth middleware (`api_auth_and_cache_middleware`, `L159-187`), Garmin/MND/Renpho sync orchestration, and telemetry endpoints.
  - `backend/db.py` (807 lines): SQLite (`pulse.db` in `DATA_DIR`, WAL mode, 10s busy timeout).
  - `backend/state_store.py` (230 lines): Atomic JSON persistence (`live_state.json` + `.bak` recovery + reentrant thread lock + POSIX `flock` via `state_store.state_lock`).
  - `backend/analytics_service.py` (703 lines): Adaptive TDEE, ACWR overreaching (`compute_acwr_overreaching`), sync freshness, and preference merging.

---

## 2. Workout History, Strength, Biometrics & Profile Data Stores

All contextual signals required for injury triage already exist across SQLite (`pulse.db`) and `live_state.json`:

### 2.1 Workout & Movement Exposure Stores
1. **SQLite `workout_sessions`** (`backend/db.py:121-131`):
   - Columns: `id, timestamp, preset, goal, exercises_completed, sets_logged, calories, payload_json`.
   - Writer: `POST /api/sync_session` (`backend/main.py:1432-1471`) → `db.log_workout_session()` (`backend/db.py:502-522`).
   - Reader: `db.get_workout_sessions(days=35, conn=...)` (`backend/db.py:679-717`).
   - Note: `live_state.json` also caches today's `session_history` (up to 50 entries) and `last_workout_session`.
2. **SQLite `strength_logs`** (`backend/db.py:92-104`):
   - Columns: `id, timestamp, exercise_id, weight, reps, e1rm, is_warmup`.
   - Reader: `db.get_strength_history(days=30)` (`backend/db.py:407-435`) and `db.get_strength_pr_map()` (`backend/db.py:762-789`), filtering strictly for working sets (`COALESCE(is_warmup, 0) = 0`).
   - HTTP Endpoint: `GET /api/strength/history?days=30` (`backend/main.py:1235-1242`).
3. **SQLite `manual_activities`** (`backend/db.py:133-144`):
   - Columns: `id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr, payload_json`.
   - Writer: `POST /api/sync_activity` (`backend/main.py:1474-1555`) → `db.log_manual_activity()` (`backend/db.py:525-554`).
   - Reader: `db.get_manual_activities(days=35, conn=...)` (`backend/db.py:720-759`).
4. **Garmin Cloud Activities (`live_state.json`)**:
   - Served via `GET /api/live_state` (`backend/main.py:519-521`) and hydrated on frontend in `js/telemetry.js:2670-2758`.
   - Fields inside `state["garmin"]["today_activities"]` and `state["garmin"]["recent_activities"]` (capped at 100): `id, name, sub_title, date, duration_min, calories, avg_hr, max_hr, aerobic_te, anaerobic_te, activity_type_key, total_sets, total_reps, exercise_sets, steps, distance_miles, source`.
5. **Cross-Source Deduplication Precedence (`backend/analytics_service.py:353-435`):**
   - `compute_acwr_overreaching()` excludes synthetic `"Daily Steps"` MND bridge entries (`src == "garmin_via_mnd_bridge" and "daily steps" in nm`) and deduplicates same-day sessions within `<= 15.0 kcal` and `<= 7200s (2h)` using strict source priority: **Garmin OAuth (`2`) > Manual Activity (`1`) > Workout Session (`0`)**. The Diagnostics Context Aggregator must reuse this exact precedence rule.

### 2.2 Biometrics, Recovery, Body Composition & Preferences
- **Recovery & Biometrics:**
  - Historical table: `db.get_daily_biometrics(days=28, conn=...)` (`backend/db.py:647-660`) → `date_str, sleep_score, resting_hr, body_battery, training_readiness, source`.
  - Live snapshot: `state["garmin"]` (`sleep_score, sleep_duration, resting_hr, body_battery, training_readiness, steps, active_calories`).
- **ACWR & Overreaching:** `analytics_service.compute_acwr_overreaching()` (`backend/analytics_service.py:325-520`) computes 7-day acute load, 28-day chronic weekly average, ACWR ratio, `status` (`"calibrating" | "optimal" | "caution" | "deload_recommended"`), and `fatigued_markers` (`Sleep <68`, `Battery <35%`, `RHR >= baseline + 4 bpm`). Exposed together via `GET /api/analytics/summary` (`backend/main.py:1873-1880`).
- **Body Composition:** `state["athlete"]` & `state["renpho"]` (`weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct`) + `db.get_renpho_history(days=21)` (`backend/db.py:311-383`).
- **Nutrition Runway:** `state["nutrition"]` (`calorie_target, deficit, protein_target_g`) + `db.get_daily_nutrition(days=21)` (`backend/db.py:663-676`).
- **User Preferences (`kv_store`):** `db.get_kv("client_preferences_v1")` (`backend/main.py:1883-1897`) stores `goal_key, equipment_profile, conditioning_progression`.

---

## 3. Exercise Library & Biomechanical Mapping Gap

- **Frontend Catalog (`js/workout-catalog.js` & `js/workout-verdict.js`):**
  - Scans show **61 unique IDs** across `js/workout-catalog.js` comprising **54 distinct exercise definitions** (in `dailyArchetypes` + `masterExercises`) and **7 template options** (`todayWorkoutOptions`: `bb_upper_hinge`, `bb_squat_press`, `kb_complex`, `hybrid_work_capacity`, `joint_friendly_hypertrophy`, `recovery_flush_walk`, `mobility_stretch`).
  - Movement families (8): `hip_hinge`, `horizontal_push`, `pull`, `vertical_push`, `core_carry`, `cardio`, `squat`, `mobility`.
  - Contraindications & Swaps (`js/workout-verdict.js:1-40`): `JOINT_CONTRAINDICATIONS` (Sets keyed by the 6 joint domains), `JOINT_SAFE_SWAPS` (per-domain safe replacement lists), and `JOINT_MOBILITY_FALLBACKS` (`['deadbug_hold', 'glute_bridge_hold', 'zone2_flush', 'thoracic_openers']`).
  - Injury rule descriptions & prehab (`js/telemetry.js:1081-1136`): `injuryRules` covering the same 6 domains (`lumbar`, `shoulders`, `knees`, `elbows`, `wrists`, `ankles`).
- **Identified Mapping Gap:**
  - The Python backend currently has **zero awareness** of the exercise catalog, joint stress vectors, kinetic chains, or primary/secondary musculature. It cannot translate a `strength_logs.exercise_id` (e.g., `barbell_squat`, `kb_clean_and_strict_press`) or a Garmin activity title (e.g., `"Jump Rope"`, `"Kettlebell Snatch"`) into overloaded anatomical tissues or kinetic chains.
- **Architectural Solution Concept:**
  - Create `backend/exercise_biomechanics.py` encoding all 54 exercise definitions (joint stress vectors, primary/secondary muscle groups, kinetic chain, movement pattern, impact/axial-load profile) plus a deterministic keyword classifier for external Garmin/manual activities, verified against `js/workout-catalog.js` and `js/workout-verdict.js` by automated parity tests.

---

## 4. Existing Injury Adaptor — Schema, Persistence, Entry Points & Deficiencies

### 4.1 Current Schema & Persistence
- **Frontend State (`js/state.js:1388-1396`, `live_state.json:53-61`):**
  ```js
  let athleteInjuries = {
    lumbar: false, shoulders: false, knees: false,
    elbows: false, wrists: false, ankles: false,
    notes: ''
  };
  ```
  (Runtime also attaches a dynamic `assessment` object when `analyzeAthleteInjury()` runs.)
- **Backend Endpoint (`POST /api/athlete/injuries`, `backend/main.py:1558-1582`):**
  - `_INJURY_JOINT_KEYS = ("lumbar", "shoulders", "knees", "elbows", "wrists", "ankles")`
  - `_INJURY_ALLOWED_KEYS = set(_INJURY_JOINT_KEYS) | {"notes", "assessment"}`
  - Enforces JSON finite validation, 65,536-byte payload cap, `notes` sliced to 2,000 chars, atomic write via `state_store.state_lock(LIVE_STATE_PATH)` into `state["injuries"]`.
- **Client Sync & Offline Queue:**
  - Local cache: `localStorage['pulse_athlete_injuries']` (`js/telemetry.js:1395, 1556, 1681, 3289`).
  - Offline queueing: `enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST')` (`js/state.js:1109`).
  - Cloud hydration race guard (`js/telemetry.js:2524, 2866-2869`): `applyLiveStateToDom` skips overwriting `athleteInjuries` from `state.injuries` if `!hasPendingInjuries` is false.

### 4.2 Entry Points & Workout Adaptor Consumers
- **UI Modal & Triggers:**
  - `#injuryModal` (`index.html:1492-1591`) opened via `openInjuryModal()` (`js/telemetry.js:1353`) from header badge `#injuryStatusBadge` (`index.html:70`), `#activeInjuryBannerToday` (`js/telemetry.js:1750`), and Body/Settings cards (`index.html:1045, 1301`).
- **4 Workout Adaptation Call Sites:**
  1. `loadDailyArchetype()` (`js/workout-verdict.js:236`)
  2. `generateWorkoutFromGearAndGoal()` (`js/workout-verdict.js:802, 837`)
  3. `launchDynamicWorkout()` (`js/workout-verdict.js:2664-2666`)
  4. `restoreActiveSessionFromLocalStorage()` (`js/state.js:987-990`)
  - All 4 route through `isExerciseContraindicated(exOrId, injuries)` (`js/workout-verdict.js:53-66`) and `applyJointSafeSwaps(candidateList, targetCount, injuries, gear)` (`js/workout-verdict.js:68-162`).

### 4.3 Critical Deficiencies in Existing Injury Module
1. **Uncontrolled Auto-Mutation (`analyzeAthleteInjury`, `js/telemetry.js:1451-1576`):** Uses brittle regex keyword matching across 6 joints, reads only `todayActs[0] || recentActs[0]` (single latest activity), performs zero clinical red-flag screening, and **immediately mutates `athleteInjuries[k] = true`, saves to `localStorage`, posts to `/api/athlete/injuries`, and reloads `loadDailyArchetype()`** without user review or explicit handoff confirmation.
2. **No Permanent vs. Acute Constraint Separation:** `clearAllInjuries()` (`js/telemetry.js:1376`) resets all 6 joint flags unconditionally, wiping any chronic/permanent injury sensitivities alongside temporary diagnostic restrictions.
3. **HTML Escaping Bug (`js/telemetry.js:1502-1530, 1623, 1651`):** `analyzeAthleteInjury()` embeds literal `<strong>...</strong>` tags inside `rootCauseText` and `swapPrescription`, and `renderAssessmentResultCard()` subsequently runs `${esc(data.swapPrescription)}` and `${esc(data.rootCauseText)}`, rendering raw `&lt;strong&gt;` markup on screen.
4. **Coarse Binary Filtering:** The adaptor only supports 6 whole-joint booleans without distinguishing movement-pattern subsets (e.g., sparing deep hip hinge vs. all lumbar exercises) or severity/rest triage.

---

## 5. Voice/Audio Capabilities, Permissions & Service Worker

- **Existing Audio Surface:** `js/state.js` implements Web Speech **Synthesis** (`window.speechSynthesis`, `speak()`, `getPreferredNaturalVoice()`, `toggleVoicePrompts()` at `L847-916`) and Web Audio API tone feedback (`beep()` at `L666-701`).
- **Speech-to-Text Gap:** Neither `SpeechRecognition` / `webkitSpeechRecognition` nor `MediaRecorder` / microphone permission handling exists anywhere in the repository.
- **Permissions Header Check:** Neither `backend/main.py` nor `vercel.json` currently emits a `Permissions-Policy` header. Adding `Permissions-Policy: microphone=(self)` on HTML document responses in `backend/main.py` middleware prevents restrictive defaults in embedded/proxy environments while scoping mic capture strictly to self-origin.
- **Service Worker (`sw.js:71-105`):** Only intercepts `event.request.method === 'GET'`, so `POST /api/diagnostics/analyze` and `POST /api/athlete/injuries` naturally bypass the SW cache. In Phase 4, any new `js/diagnostics.js` asset must be added to `STATIC_ASSETS`, versioned (`?v=...`) in `index.html`, and `CACHE_NAME` bumped.

---

## 6. UI Theme Tokens & Styling Surface

- **Design System (`css/styles.css:7-58` — Aerospace Obsidian Dark Mode):**
  - **Surfaces & Borders:** `--bg (#06080e)`, `--surface (#0c1017)`, `--surface-elevated (#131822)`, `--surface-card (#0f141f)`, `--surface-subtle (#080b12)`, `--border (rgba(0, 229, 255, 0.12))`, `--border-bright (rgba(0, 229, 255, 0.28))`, `--border-subtle (rgba(255, 255, 255, 0.05))`, `--border-focus (rgba(0, 229, 255, 0.6))`.
  - **Brand & Semantic Accents:** `--primary (#00e5ff)`, `--primary-dim`, `--primary-bright (#67e8f9)`, `--cyan (#38bdf8)`, `--emerald / --success (#10b981)`, `--amber (#f59e0b)`, `--amber-glow`, `--crimson (#ef4444)`, `--crimson-text (#fca5a5)`, `--crimson-glow`, `--violet-text (#c084fc)`.
  - **Typography:** `--text (#ffffff)`, `--text-secondary (#cbd5e1)`, `--text-muted (#8b9db5)`, `--text-dim (#64748b — borders/non-text only)`, `--font-display`, `--font-mono`, `--font-sans`.
- **Legacy Styling Leaks Observed:**
  - `#injuryModal` (`index.html:1506-1546`) and `renderAssessmentResultCard` (`js/telemetry.js:1604-1660`) currently contain inline styles with raw hex colors (`#00f0ff`, `#3b82f6`, `#8b5cf6`, `#050914`, `#e2e8f0`, `#d4d4d8`). All new Diagnostics UI components must use dedicated CSS classes in `css/styles.css` referencing `:root` tokens exclusively.

---

## 7. AI Service Wrapper Strategy & Context Window Limits

- **Installed Python Dependencies (`backend/requirements.txt`):** `fastapi>=0.110.0`, `uvicorn[standard]>=0.28.0`, `garminconnect==0.3.2`, `requests>=2.31.0`, `apscheduler>=3.10.4,<4.0`, `python-dotenv>=1.0.1`, `pydantic>=2.0.0`, `renpho-py>=1.3.1`, `pycryptodome>=3.15`, `tzdata>=2024.1`. Neither `.env.example` nor `requirements.txt` includes an AI SDK or API key.
- **Selected AI Integration Pattern:**
  - **Zero-dependency Gemini REST Wrapper (`backend/diagnostics_ai.py`):** Uses already-installed `requests>=2.31.0` + `pydantic>=2.0.0` against `POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_DIAGNOSTICS_MODEL}:generateContent` with `x-goog-api-key` HTTP header (never query-string), `generationConfig.responseMimeType = "application/json"`, `responseJsonSchema`, `temperature = 0.2`, and strict timeouts (`connect=4.0s, read=14.0s`).
  - **Configuration:** `GEMINI_API_KEY` (secret, optional) and `GEMINI_DIAGNOSTICS_MODEL` (default `gemini-2.5-flash` for mobile latency SLA, configurable to `gemini-2.5-pro` or successor models without code changes).
  - **Resilient Deterministic Fallback:** Whenever `GEMINI_API_KEY` is unset, upstream returns HTTP 429/5xx, times out, or produces invalid JSON, the backend automatically executes a deterministic biomechanical assessment engine using the exact same aggregated context and `DiagnosticReport` schema.
- **Context Window Budget:**
  - Hard target: **`<= 4,500` input tokens (`<= 15,500` serialized JSON characters)** per diagnostic request:
    - Up to **25** deduplicated workouts (`recent_workouts[:25]`).
    - Up to **15** strength exercise exposure summaries (`strength_exposure[:15]`).
    - Up to **25** contextually relevant `exercise_library` entries (performed exercises + candidate swaps for affected region).
    - Pre-computed 7d vs. 7d joint load deltas, ACWR + fatigue summary, Renpho body composition, nutrition targets, chronic + active injuries, and last 3 diagnostic summaries.

---

## 8. Pre-Existing Workspace Defect Discovered During Codebase Mapping

During read-only inspection of `js/telemetry.js` and verification across `js/*.js`, a critical pre-existing regression from the prior v6.1 template-whitespace trim command was discovered (unrelated to Diagnostics, left untouched per Phase 1–2 docs-only protocol):

- **Affected Files (1,252 lines total):**
  - `js/charts.js`: **333** lines
  - `js/fuel-engine.js`: **212** lines
  - `js/telemetry.js`: **175** lines
  - `js/workout-player.js`: **213** lines
  - `js/workout-verdict.js`: **319** lines
- **Symptom:** Indented HTML tag lines inside ES template literals lost `<` and their first tag character (e.g., `<div` → `iv`, `</div>` → `div>`, `<span` → `pan`, `<details` → `etails`, `<svg` → `vg`, `<strong>` → `trong>`) because PowerShell double-quoted `$1` interpolation expanded `$1` to empty string.
- **Impact:** Breaks live DOM rendering for injury rules/cards (`#injuryRulesList`, `#injuryAssessmentResult`, `#activeInjuryBannerToday`), charts, fuel cards, and workout cards despite passing `node --check`.
- **Recommendation:** Apply a lossless restoration hotfix and add an HTML-tag integrity check to `tests/test_v61_frontend.js` prior to (or alongside) Phase 4 implementation and build verification.
