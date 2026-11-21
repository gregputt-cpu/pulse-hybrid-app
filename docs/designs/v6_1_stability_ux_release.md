# PULSE v6.1 Release — Daily Sync Accuracy, Gym Floor Reliability & Mobile UX

*   **Author:** Greg Putt
*   **Status:** Reviewed — Ready for Implementation
*   **Date:** 2026-11-20

--------------------------------------------------------------------------------

## Overview

PULSE `v6.0` shipped the modular 4-file workout engine split, `esbuild` minification, Adaptive TDEE, ACWR, Macro Gap Closer, Focus Mode, and cross-device preference sync. A subsequent full-codebase audit surfaced runtime bugs, data-sync precedence inversions, state-drift races, mobile contrast failures, and layout traps that degrade daily syncs, workout logging, and nutrition accuracy.

Release `v6.1` (Daily Fixes Scope) resolves those daily-impacting defects across three workstreams:

1.  **Workstream A — Sync Reliability & Data Accuracy:** Repair Garmin OAuth/profile recovery and isolate OAuth vs. MND bridge timestamps, preserve manual workouts and nutrition overlays across upstream pulls and throttled backfills, enforce 3-way scale weight precedence with segmented bio-impedance state, eliminate UK midnight rollover leaks, unify SQLite and JSON state storage, and enforce idempotency plus edge-case analytics and container shutdown guarantees.
2.  **Workstream B — Gym Floor, Workouts & Timers:** Repair `[object Object]` recovery text, movement-pattern classification, full session restoration across browser reloads, null-readiness guards, pre-slice joint-safe injury substitutions across all 6 joint domains, `"2x"` single-dumbbell load parsing, warmup PR/deload isolation, the `2.5 kg` deload floor for sub-`20 kg` lifts, Plate Calculator updates across all set rows, inline/AMRAP timer lifecycles, and deduplicated in-app calorie burn tracking.
3.  **Workstream C — Mobile Readability & Layout Polish:** Upgrade low-contrast buttons, badges, Zone 1 labels, alerts, sparklines, and empty accordions to WCAG `2.1` AA/AAA contrast via CSS tokens and classes; align `.floating-rest-pill` markup and touch targets; exit Focus Mode automatically on History; eliminate redundant renders collapsing `<details>` accordions; and resolve `360 px` overflows, SVG clipping, `#appToast` layering, and desktop alignment.

### Glossary

*   **Daily Fixes Scope (Workstreams A, B, C):** Bounded `v6.1` scope covering Sync Reliability & Data Accuracy (**A**), Gym Floor, Workouts & Timers (**B**), and Mobile Readability & Layout Polish (**C**), excluding enterprise multi-user hardening and new feature additions.
*   **TDEE / Adaptive TDEE:** Total Daily Energy Expenditure estimated via 14-day weight regression and SQLite nutrition rows (`compute_adaptive_tdee`).
*   **ACWR:** Acute-to-Chronic Workload Ratio comparing 7-day acute workout load against 28-day chronic weekly average (`compute_acwr_overreaching`).
*   **BF% / LBM / MA:** Body Fat percentage / Lean Body Mass (`weight_kg * (1 - body_fat_pct / 100)`) / 7-day Moving Average.
*   **P / C / F:** Protein, Carbohydrates, and Fat measured in grams (`g`).
*   **Focus Mode:** Full-viewport active-workout mode triggered by `body.workout-focus-mode` (`css/styles.css:2462-2476`), hiding header chrome and bottom navigation.
*   **Macro Gap Closer:** Fuel-tab recommendation card (`#macroGapCloserCard`) suggesting meals/snacks fitted to remaining daily calories and protein.
*   **`api_auth_and_cache_middleware`:** Signed-cookie and bearer-token middleware guarding all `/api/*` endpoints (reads and writes) in `backend/main.py`.
*   **Fuel Goals & Diet Strategies:** Preset nutrition anchors in `backend/analytics_service.py:26-32` (`recomp`: `2092 kcal / 200 g protein`; `aerobic`: `2200 kcal / 200 g protein`; `pushups`: `2442 kcal / 195 g protein`; `rdl`: `2592 kcal / 190 g protein`; `work_capacity`: `2350 kcal / 185 g protein`; `custom`: Pro Dial or custom anchor), paired with macro strategies (`balanced`, `lowcarb`, `carbcycle` [`high` | `mod` | `low`], `fasting`, `custom`).
*   **Notation & Legacy Identifiers:** **SQLite DB** refers to `backend/db.py` (`pulse.db`), whereas **DB** in exercise IDs/labels (`db_press`, `2x22.5kg`) means **Dumbbell**. Legacy helper `getEgmWorkoutBreakdown` retains its symbol name for call-site compatibility.
*   **`v6.2` Feature Roadmap:** Net-new coaching features deferred beyond `v6.1`.

## The Problem

| Workstream | Observed Failure | Primary Location |
| :--- | :--- | :--- |
| **A (Sync)** | `garminconnect==0.3.2` leaves `display_name = None` after MFA and fails `.client.profile.get`; outages zero scalar metrics and empty `today_activities`; OAuth syncs drop `manual_app_entry` workouts. | [backend/garmin_sync_service.py](file:///c:/Projects/my-fitness-app/project-handoff/backend/garmin_sync_service.py) |
| **A (Sync)** | MND bridge freezes metrics at `0`, advances `oauth`-sensitive `last_synced`; 5-minute backfill sends ~4,900 requests/day and overwrites `app_logged_meals` / SQLite manual rows; stale weigh-ins block today's weigh-ins (`backend/mnd_sync_service.py:1331-1383`); socks-on `null` BF% leaves stale DOM metrics. | [backend/mnd_sync_service.py](file:///c:/Projects/my-fitness-app/project-handoff/backend/mnd_sync_service.py), [backend/renpho_sync_service.py](file:///c:/Projects/my-fitness-app/project-handoff/backend/renpho_sync_service.py), [backend/main.py](file:///c:/Projects/my-fitness-app/project-handoff/backend/main.py) |
| **A (Sync)** | Split `DATA_DIR` logic writes git-tracked `live_state.json` / dual `pulse.db` files; offline `/api/mnd/manual` snack/delete replays overwrite newer cloud meals; midnight rollover leaks `garmin.mnd_logged` and active burn; dual macro engines drift across polls. | [backend/state_store.py](file:///c:/Projects/my-fitness-app/project-handoff/backend/state_store.py), [backend/db.py](file:///c:/Projects/my-fitness-app/project-handoff/backend/db.py), [js/state.js](file:///c:/Projects/my-fitness-app/project-handoff/js/state.js), [js/fuel-engine.js](file:///c:/Projects/my-fitness-app/project-handoff/js/fuel-engine.js) |
| **B (Gym)** | `k.split('_')[0]` misclassifies exercises; `[object Object]` renders in recovery copy; reloads drop `activeWorkoutPlan`; `null < 60` deloads readiness; `20m` lumbar slicing returns `[]`; warmups overwrite `e1RM`/deloads; `20 kg` floor doubles `10 kg` deloads; `2x` fails on `"2x"`; `inAppBurn` double-counts. | [js/workout-verdict.js](file:///c:/Projects/my-fitness-app/project-handoff/js/workout-verdict.js), [js/workout-player.js](file:///c:/Projects/my-fitness-app/project-handoff/js/workout-player.js), [js/workout-timers.js](file:///c:/Projects/my-fitness-app/project-handoff/js/workout-timers.js), [js/telemetry.js](file:///c:/Projects/my-fitness-app/project-handoff/js/telemetry.js) |
| **C (UX)** | `#btnTimerToggle` fails at `1.54:1`; ACWR/alert crimson text fails at `3.90:1`; `.floating-rest-pill` HTML/CSS mismatch; Focus Mode History leaves a `62 px` `.bottom-nav` padding space (`css/styles.css:2472`); `#appToast` sits behind modals and blocks interactive clicks; poll renders collapse `<details>`; `360 px` viewports clip headers/charts. | [css/styles.css](file:///c:/Projects/my-fitness-app/project-handoff/css/styles.css), [index.html](file:///c:/Projects/my-fitness-app/project-handoff/index.html), [js/charts.js](file:///c:/Projects/my-fitness-app/project-handoff/js/charts.js), [sw.js](file:///c:/Projects/my-fitness-app/project-handoff/sw.js) |

## Goals

*   **Single-Authority Sync & Storage Integrity:** Preserve manual workouts, `app_logged_meals`, and `source='manual'` rows across syncs; isolate OAuth (`oauth_last_synced`) from MND bridge (`bridge_last_synced`); enforce one 3-source scale precedence table with segmented bio-impedance state; derive identical integer macro targets on server and client; run all SQLite helpers via `contextlib.closing(get_connection())` in one canonical data directory; enforce scoped idempotency across event-logged mutators; reject non-finite numbers (`allow_nan=False`); and handle `SIGTERM` via PID 1 `exec uvicorn`.
*   **Reliable Session, Set, Timer & Goal Execution:** Classify movement patterns via catalog IDs; restore active plans unconditionally on same-day refresh with injury re-validation; substitute contraindicated exercises (including conditioning complexes) *before* slicing to `targetCount`; isolate warmups in SQLite `strength_logs` and runtime PR/deload logic; parse `"2x"` / `"2×"` uniformly across catalog, UI, and API; fix Plate Calculator `< 20 kg` feedback and sets 1–4; and deduplicate `pulse_inapp_burn_today` across `finishSession()`, `submitManualActivityModal()`, and `logTimerSession()`.
*   **Readable `360 px`-to-Desktop Interface:** Achieve WCAG `2.1` AA/AAA contrast across timers, badges, alerts, charts, macro pills, and placeholders; align `.floating-rest-pill` (`>= 36 px`) and `#appToast` (`z-index: 100000`, interactive `.toast-action-btn`); exit Focus Mode directly into History; preserve `<details data-details-key>` across single-pass renders and `60 s` freshness ticks; remove inline layout overrides so `360 px` viewports never overflow horizontally; and center desktop `680 px` nav / `440 px` modals.

## Non-Goals (Explicitly Deferred to `v6.2`+)

*   Enterprise / multi-user security hardening: `X-Forwarded-For` proxy-trust refactoring, `/api/auth/login` IP rate-limiter eviction, server-side session nonce revocation on v2 cookies, fail-closed non-Railway deploy defaults, `401` CORS middleware reordering, encrypting `credentials.json` / Garmin tokens, or non-root `Dockerfile` UID setup.
*   Comprehensive screen-reader accessibility overhaul: full `aria-*` / `role=` instrumentation across all 17 modals/tabs, modal focus trapping, converting legacy `<div/span onclick>` controls, `<label for>` binding across all 47 form fields, semantic `<h1>`-`<h6>` restructuring, `:focus-visible` overhaul, or migrating all inline `style="..."` attributes out of HTML/JS.
*   Automated coaching features on the **`v6.2` Feature Roadmap**: `1-Tap Adaptive TDEE Target Calibration`, `Server-Backed Movement Volume Coach`, `Barbell Warm-Up Ramp`, `Personal 14-Day Biometric Z-Scores`, and `Post-Workout Recovery Bridge`.

## Open Questions

None open. All fix contracts, precedence tables, equations, fallback bounds, CSS tokens, and verification gates are specified below.

--------------------------------------------------------------------------------

## Critical User Journeys (CUJs)

### CUJ 1: Reliable Morning & Midday Garmin / MND / Renpho Sync

*   **Given:** The athlete authenticates Garmin (`garminconnect==0.3.2`), logs an in-app workout via `POST /api/sync_activity`, logs a Macro Gap Closer snack (`POST /api/mnd/manual` with `logged_item`), and records a Renpho weigh-in (with or without socks-on bio-impedance `null` fields).
*   **When:** Garmin syncs, hits a transient outage or midday token expiry; 5-minute MND pulls run alongside background history backfill; and Renpho polls or saves a manual weigh-in.
*   **Then:**
    *   Garmin populates `display_name`, clears `oauth_failed_at`, stamps `oauth_last_synced`, retains `manual_app_entry` workouts, and updates only succeeded domains (aborting without wiping metrics if all 5 upstream calls fail).
    *   Expired Garmin OAuth shifts daily telemetry deterministically to `mnd_bridge` (advancing `bridge_last_synced` only, leaving `oauth_last_synced` untouched).
    *   MND backfill runs at `<= 1` pass per `7200 s`, aborts on auth failure, and preserves `app_logged_meals` plus `source='manual'` nutrition rows.
    *   Weight updates follow the 3-way `{manual_scale_entry, renpho_direct_cloud, live_mynetdiary_weight}` precedence table while preserving valid `lean_mass_kg`, or render `"Pending scan"` / `"--"` when unseeded.

### CUJ 2: Midnight Rollover, Goal Switching & Offline Write Survival

*   **Given:** Browser `localStorage` holds yesterday's cached `/api/live_state` (`garmin.mnd_logged`, prior `active_calories`), the athlete switches Fuel goals or diet strategies (`pushups`, `lowcarb`, `carbcycle`, `fasting`, or `custom` Pro Dial), and logs a Macro Gap Closer snack or manual Readiness override while offline.
*   **When:** The app boots on the new UK calendar day, receives 2-minute `/api/live_state` polls while offline writes wait in `pulse_offline_write_queue`, and later reconnects.
*   **Then:**
    *   Both frontend and backend UK date rollovers clear `garmin.mnd_logged`, `garmin.mnd_meals`, `state.mnd_logged`, `state.mnd_meals`, and stale active burn, resetting `nutrition.calorie_target` to `base_calorie_target`.
    *   Server and client compute identical integer macro targets via `compute_macro_targets()` / `computeMacroTargets()`.
    *   Offline Macro Gap Closer adds/deletes replay as delta commands (`logged_item` / `remove_item`) via `_compose_mnd_with_overlays()` against `mnd_cloud_*` + `app_deleted_meals` + `app_logged_meals` without erasing cloud meals.
    *   All 5 event-logged mutating routes (`/api/sync_activity`, `/api/mnd/manual`, `/api/sync_set`, `/api/sync_session`, `/api/hydration/add`) deduplicate scoped `client_event_id` retries, overwrite-by-date/LWW endpoints remain idempotent, and non-retryable `4xx` queue items drop without stalling valid writes.

### CUJ 3: Mid-Workout Reload, Injury Safety, Timers & Live PRs

*   **Given:** Injury guardrails (e.g., `lumbar`) are active in `athleteInjuries`, the athlete selects `20m` `lower_hinge`, `option_kb`, or `option_b` workouts, logs a `40 kg` warmup set on an `80 kg` prescription before logging working sets / `"2x22.5kg"` sets, runs an inline conditioning drill, and refreshes or finishes an AMRAP timer session.
*   **When:** Workout generation executes, sets log, inline timers run across UI updates, and sessions finish.
*   **Then:**
    *   Pre-slice joint-safe swaps replace contraindicated exercises and conditioning complexes for active gear and all 6 joint flags before slicing to `targetCount`, and page reload restores `activeWorkoutPlan` (even with 0 logged sets) with guardrails re-applied.
    *   Warmup sets (`logged_w < 0.75 * target_w`) log with `is_warmup = 1` without mutating working weights, deload state, `#prBadgeSlot`, or higher PR ceilings; `10 kg` deloads drop to `8.5 kg` and `"2x22.5kg"` parses as `22.5 kg` on catalog, client, and server.
    *   Inline timers persist across same-`ex.id` re-renders, stop when changing exercises, and reset `#btnTimerToggle` state classes when AMRAP completes.
    *   Weekly Pattern Balance classifies via `exercise_id`, `[object Object]` recovery text resolves to real Bench/Row weights, and `finishSession()` / `logTimerSession()` / `submitManualActivityModal()` update tagged `pulse_inapp_burn_today` arrays without double-counting.

### CUJ 4: High-Contrast `360 px` Gym & Desktop UX

*   **Given:** The athlete uses PULSE on a `360 px` phone during workouts (including Focus Mode and modals) and on `>= 900 px` desktop screens.
*   **When:** Timer states toggle, ACWR/auth/injury warnings display, `.floating-rest-pill` runs, History opens from Focus Mode, `#appToast` fires inside an open modal, or background polls run.
*   **Then:**
    *   All modified buttons, badges, Zone 1 chart labels, sparklines, placeholders, and empty accordions meet WCAG `2.1` AA/AAA contrast (`>= 4.5:1` / `>= 7.0:1`).
    *   `.floating-rest-pill` renders its indicator, `#floatingRestNext`, `#floatingRestDigits`, and `36 px` wrapping buttons within `360 px` width; clicking History exits Focus Mode without leaving bottom padding; and `#appToast` floats at `z-index: 100000` with clickable `.toast-action-btn`.
    *   Open `<details data-details-key>` accordions remain expanded across background polls and `60 s` freshness updates, SVG text renders at `>= 12.5 px` inside widened viewBox margins, `360 px` grids wrap without horizontal scroll, and desktop `.bottom-nav` (`680 px`) and `.modal-card` (`<= 440 px`) align centered.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

```text
+-------------------------------------------------------------------------+
|                   Mobile / Desktop PWA (v6.1 Classic JS)                |
|  css/styles.css (AA/AAA tokens, Focus Mode, 360px wrap, desktop 680px)  |
|  window 'load' -> single-pass DOM sync + 60 s freshness strip tick      |
|  Offline Queue (maxAttempts=10, 4xx drop, fast abort, client_date/id)   |
|  Service Worker (sw.js: pulse-hybrid-v6.1-20261120, /sw.js bypassed)    |
+------------------------------------+------------------------------------+
                                     | HTTPS + GZip (200-only immutable)
                                     v
+-------------------------------------------------------------------------+
|                    FastAPI Backend (backend/main.py)                    |
|  GZipMiddleware (outer) -> api_auth (200-only immutable) | exec uvicorn |
|  Single-Flight Syncs + Null/Inf-Safe Validators (allow_nan=False)       |
+------------------+----------------------------------+-------------------+
                   |                                  |
                   v                                  v
+----------------------------------+  +-----------------------------------+
| Store (backend/state_store.py)   |  | SQLite WAL (backend/db.py)        |
| - $DATA_DIR -> /data -> ./data   |  | - closing(get_connection())       |
| - allow_nan=False + .bak heal    |  | - lifespan + lazy init WAL        |
| - os.replace 3x retry + flock    |  | - kv_store idem + is_warmup col   |
+----------------------------------+  +-----------------------------------+
```

### Key Fix Groups & Architecture Contracts

1.  **Canonical Storage, Connection Safety & Leaf Lock Ordering:**
    *   `backend/state_store.py` `get_data_dir()` resolves `DATA_DIR -> /data -> <backend>/data` universally; unused `ARTIFACT_LIVE_STATE_PATH` and `mirror_paths` scaffolding are deleted.
    *   `backend/db.py` `get_connection()` stays a raw `sqlite3.Connection` wrapped internally in `contextlib.closing()`, initialized explicitly by FastAPI `lifespan` + lazy `_ensure_initialized()`.
    *   Global lock order across MND sync and storage is strictly acyclic: `(_sync_lock | _history_backfill_lock) -> state_store.state_lock() -> _history_cache_lock` (leaf file-cache lock only, zero HTTP requests or `state_lock()` inside `_history_cache_lock`).
2.  **Single-Source Truth for Sync Channels, Macros & Overlay Edits:**
    *   `garmin.oauth_last_synced` updates solely on OAuth success while `mnd_bridge` writes `bridge_last_synced`, protecting client manual overrides and sync freshness telemetry.
    *   `state["renpho"]` splits Weight (`weight_kg`, `weight_synced_at`, `weight_source`) from Bio-Impedance (`body_fat_pct`, `lean_mass_kg`, `bio_synced_at`) under an explicit precedence matrix.
    *   Server (`backend/analytics_service.py`) and client (`js/fuel-engine.js`) execute identical `compute_macro_targets()` equations including `pro_dial_macros` and `goal_key`.
    *   `backend/mnd_sync_service.py` retains raw `mnd_cloud_logged`/`mnd_cloud_meals` separately from `app_logged_meals` + `app_deleted_meals` via `_compose_mnd_with_overlays()` so Gap Closer item adds/deletes replay without overwriting newer cloud meals or triggering `'manual'` lockouts.
3.  **Deterministic Workout Execution, Injury Swaps & Single-Pass Responsive UI:**
    *   `applyJointSafeSwaps()` runs across all 6 `athleteInjuries` keys, active `gearConfig`, and `kb_flow_*` prefixes *before* slicing to `targetCount`; warmup sets (`< 0.75 * target_w`) carry `is_warmup = 1` and never alter strength prescriptions; `"2x"` weights parse identically on catalog, UI, and server; `pulse_inapp_burn_today` stores `{ id, date, calories, kind }` events across all workout completion paths.
    *   Top-level toast/splash/date helpers, clickable `#appToast` (`z-index: 100000`), CSS state-class contrast tokens, Focus Mode cleanup, `sw.js` `v6.1` alignment, `<details data-details-key>` preservation, CSS class extraction from inline `index.html` grids, and widened SVG margins complete mobile stabilization.

## Alternatives Considered

### Alternative A: Rewrite Frontend State Into a Reactive Virtual-DOM Framework

*   **Pros:** Replaces manual DOM reconciliation and `<details>` preservation structurally.
*   **Cons:** Breaks inline HTML event handlers and requires rewriting all 8 JS modules and existing Node `vm` test harnesses.
*   **Reason for Rejection:** Deduplicating `applyLiveStateToDom()` render passes, separating the `60 s` freshness tick, and restoring `<details>` state via `data-details-key` fixes accordion collapses within the existing architecture.

### Alternative B: Migrate `live_state.json` Completely Into SQLite Columns in `v6.1`

*   **Pros:** Eliminates JSON snapshot vs. relational row coordination.
*   **Cons:** Forces rewrites across every live-state endpoint and offline seed hydration path in a scoped stability release.
*   **Reason for Rejection:** Enforcing `flock` + 3x `os.replace()` retry, `closing(get_connection())`, `allow_nan=False`, raw `mnd_cloud_*` vs overlay separation, and `preserve_manual`/`overwrite_nulls` parameters stabilizes both stores while keeping `/api/live_state` contracts backward-compatible.

--------------------------------------------------------------------------------

## Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Lock inversion during MND backfill + foreground overlay writes | Thread deadlock or API stalls during upstream HTTP timeouts | Keep `_history_cache_lock` strictly a leaf lock around `mnd_history_cache.json` disk I/O; perform all upstream HTTP calls outside locks; enforce `(_sync_lock \| _history_backfill_lock) -> state_lock() -> _history_cache_lock`. |
| `allow_nan=False` raising `500` on a pre-existing float or legacy payload | State write failure on save | Sanitize numeric inputs recursively via `_reject_non_finite_json()` (`not isinstance(v, bool) and math.isfinite(v)`) *before* mutating `state`; retain `.bak` auto-recovery on corrupt reads. |
| Removing `backend/renpho_seed.json` auto-seed leaves cold SQLite empty | Empty chart on fresh install | `backend/renpho_sync_service.py` `get_history()` already backfills SQLite from Renpho cloud on empty history (`:174-180`); `js/charts.js` renders `< 2 points` fallback UI until synced. |
| Multi-joint injury flags + equipment filter exhausting candidate swaps | Empty `activeWorkoutPlan` in `20m` mode | Route all generators through `applyJointSafeSwaps()` with safe bodyweight mobility fallback relaxation (`deadbug_hold`, `glute_bridge_hold`, `zone2_flush`, `thoracic_openers`) evaluated against ALL active injury flags and active gear. |
| `.dockerignore` accidentally excluding `package-lock.json` | Railway Stage 1 `npm ci` failure | Do not add un-scoped `*.lock`; scope exclusions strictly to `backend/*.lock`, `*.json.lock`, `*.db.lock`, and SQLite WAL sidecars (`*.sqlite-wal`, `*.sqlite-shm`). |
| Existing `tests/test_v60_*` assertions conflicting with `v6.1` fixes | False regression failures | Update `tests/test_v60_backend.py` (`weight=600 kg, reps=5 -> HTTP 422`) and `tests/test_v60_frontend.js` (`v6.1` asset URLs, SW `claim()` wrapper) explicitly within Target Scope, leaving all remaining `tests/test_v60_backend.py` and `tests/test_v60_frontend.js` assertions unmodified. |

--------------------------------------------------------------------------------

## Non-Functional Requirements

### Security & Privacy (`v6.1` Scope Only)

*   Escape all dynamic string rendering in HTML injections (`act.subTitle`, `swapPrescription`, `rootCauseText`, user weights, custom history names) via unified `js/state.js` `escapeHtml()`, deleting duplicate `escapeAuditHtml()`.
*   Write MND `credentials.json` and Garmin token files atomically with `0o600` permissions; exclude seeds, tokens, credentials, backups, and env files in `.dockerignore` while preserving `package-lock.json`.
*   Reject non-finite floats and boolean masquerading in FastAPI numeric/JSON validators prior to JSON serialization (`allow_nan=False`).
*   Strip all hardcoded personal body constants (`190.5 cm`, `6'3"`, `45yo`, `97.70`, `97.75`, `80.99`, `81.03`, `81.0`, `98.4`, `99.85`) and email placeholder (`your@email.com`) outside test fixtures, verified by automated `Select-String` gate in Phase 5.

### Accessibility (`WCAG 2.1 AA/AAA`)

| UI Element / Token | Foreground / Background | Contrast Ratio | Source |
| :--- | :--- | :--- | :--- |
| `#btnTimerToggle` (Paused / Idle, `.timer-paused`) | `#06080e` on `--lime` (`#00e5ff`) | `13.02:1` (AAA) | `css/styles.css`, `index.html:503`, `js/workout-timers.js` |
| `#btnTimerToggle.timer-running` | `#06080e` on `--cyan` (`#38bdf8`) | `9.35:1` (AAA) | `css/styles.css`, `js/workout-timers.js` |
| `--crimson-text` (`ACWR`, `.skip:hover`, `.injury-rule-card`, `.macro-rem-item.fats`, `#pulseAuthError`, `#telemetryOverrideErr`) | `#fca5a5` on `#3a212a` (`--crimson-glow` over `#131822`) / `#131822` / `#0c1017` | `7.73:1` (AAA) / `9.37:1` (AAA) / `10.04:1` (AAA) | `css/styles.css:2168, 2201`, `index.html:2133, 2151`, `js/telemetry.js:1350, 2238` |
| `--violet-text` (Body Battery sparkline & delta) | `#c084fc` on `#131822` | `6.73:1` (AA / Large AAA) | `css/styles.css`, `js/telemetry.js:2011, 2032` |
| `--text-muted` / `#8b9db5` (placeholders, Chart Z1, `.macro-rem-divider`) | `#8b9db5` on `#131822` / `#0c1017` | `6.42:1` (AA) / `6.88:1` (AA) | `css/styles.css:2210`, `js/charts.js:28, 77` |
| `.floating-rest-pill .rest-pill-btn` touch target | `>= 36 px` height, `8px 12px` padding | `>= 36 px` touch height | `css/styles.css:2137` |

### Performance & Latency

*   **Asset Budget:** Built static bundle under `backend/static/{css,js}` must remain `<= 614,400` bytes (`600 KiB` minified) and `<= 159,744` bytes (`156 KiB` GZip level-6 transfer).
*   **Upstream Backfill Cap:** MND history backfill executes at most once every `7200 s` (2 hours), caches zero-calorie past days for `12 h`, and aborts immediately on auth failure.
*   **UI Render Loop:** `applyLiveStateToDom()` invokes `renderMyNetDiaryEngine()`, `renderTodayTrainingRecommendations()`, and `renderHistoryList()` once per pass; `renderSyncFreshnessStrip()` ticks every `60 s` from `window.BAKED_LIVE_STATE` without rebuilding `<details>` accordions.

### Rollout & Rollback

*   **State File Inventory:**
    *   `live_state.json` (repo root): immutable Docker image seed (`Dockerfile:21`).
    *   `backend/live_state.json`: local fallback seed checked by `backend/state_store.py:19-21` if root seed is absent.
    *   `backend/data/live_state.json` (or `$DATA_DIR/live_state.json` / `/data/live_state.json`): sole mutable runtime snapshot created/seeded via `DEFAULT_STATE_PATH` when missing/corrupt.
    *   Legacy untracked `backend/pulse.db` on developer machines should be inspected/archived outside git after migrating any needed local rows to `backend/data/pulse.db`; `backend/renpho_seed.json` stays excluded from containers.
*   **Cache & Compatibility:** Incrementing `CACHE_NAME` to `'pulse-hybrid-v6.1-20261120'` and asset `?v=6.1` parameters forces deterministic client asset invalidation on reload without clearing persisted workouts, queued offline writes, or SQLite history.
*   **Rollback:** Reverting the `v6.1` commit restores `v6.0` because additive `live_state.json` keys (`oauth_last_synced`, `bridge_last_synced`, `weight_synced_at`, `bio_synced_at`, `mnd_cloud_logged`, `app_deleted_meals`), `strength_logs.is_warmup`, and `kv_store` `idem:*` entries are ignored as unrecognized keys/columns by `v6.0` readers.

--------------------------------------------------------------------------------

## Additional Resources

*   Baseline `v6.0` Release Architecture: [docs/designs/v6_0_pulse_release.md](file:///c:/Projects/my-fitness-app/project-handoff/docs/designs/v6_0_pulse_release.md)
*   Existing Backend & Frontend Regression Suites: [tests/test_v60_backend.py](file:///c:/Projects/my-fitness-app/project-handoff/tests/test_v60_backend.py), [tests/test_v60_frontend.js](file:///c:/Projects/my-fitness-app/project-handoff/tests/test_v60_frontend.js)

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Scope & File Boundary

*   **Create:**
    *   `tests/test_v61_backend.py` — Isolated temporary-directory ASGI test suite covering all Phase 1 storage, sync, analytics, and route contracts.
    *   `tests/test_v61_frontend.js` — Node `vm` test suite covering all Phase 2–4 JS logic, offline queue, injury swaps, contrast tokens, Service Worker, and HTML/CSS contracts.
*   **Modify:**
    *   Container & Python dependencies: `backend/requirements.txt`, `Dockerfile`, `.dockerignore`
    *   Backend core & storage: `backend/time_utils.py`, `backend/state_store.py`, `backend/db.py`
    *   Backend sync services: `backend/garmin_sync_service.py`, `backend/mnd_sync_service.py`, `backend/renpho_sync_service.py`
    *   Backend analytics, benefits & API: `backend/analytics_service.py`, `backend/benefits_engine.py`, `backend/main.py`
    *   Seed snapshots: `live_state.json`, `backend/live_state.json`
    *   Frontend shell & PWA: `sw.js`, `manifest.json`, `css/styles.css`, `index.html`
    *   Frontend runtime modules: `js/state.js`, `js/workout-catalog.js`, `js/workout-verdict.js`, `js/workout-player.js`, `js/workout-timers.js`, `js/charts.js`, `js/fuel-engine.js`, `js/telemetry.js`
    *   Generated output bundles via `npm run build` (`build.js` unmodified): `backend/static/*`, `dist/*`, `public/*`, `.vercel/output/static/*`
    *   Existing regression updates: `tests/test_v60_backend.py` (`weight=600 kg, reps=5 -> HTTP 422`), `tests/test_v60_frontend.js` (`?v=6.1` asset URLs, `CACHE_NAME` `v6.1`, SW `claim()` wrapper)

### Phase 1: Backend Sync Reliability, Data Accuracy & Railway Stability

#### 1.1 Infrastructure, Config & Core Storage (`backend/requirements.txt`, `Dockerfile`, `.dockerignore`, `backend/time_utils.py`, `backend/state_store.py`, `backend/db.py`)
*   **`backend/requirements.txt`, `Dockerfile` & `.dockerignore`:**
    1. Pin `garminconnect==0.3.2` and `apscheduler>=3.10.4,<4.0`; remove `; sys_platform == "win32"` from `tzdata>=2024.1` so `python:3.11-slim` includes `Europe/London` timezone data.
    2. Update `Dockerfile:26` to `CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]` so PID 1 receives `SIGTERM` on Railway shutdown; Stage 1 (`node:20-slim AS assets`) runs `node build.js` inside Docker and Stage 2 copies `/app/backend/static`.
    3. Add to `.dockerignore`: `backend/static/`, `backend/renpho_seed.json`, `garmin_tokens/`, `mnd_tokens/`, `**/garmin_tokens/`, `**/mnd_tokens/`, `token_*.json`, `*.pkl`, `renpho_creds.json`, `.env.*`, `*.bak*`, `backend/*.lock`, `*.json.lock`, `*.db.lock`, `*.sqlite-wal`, `*.sqlite-shm` (preserving `package-lock.json` for `Dockerfile:3,6`; `.env.example` unmodified).
*   **`backend/time_utils.py` & Timestamp Consolidation:**
    1. Update `uk_timestamp_str(ts=None)` to detect millisecond epochs (`abs(ts_f) > 1e11`, dividing by `1000.0`).
    2. Host one canonical `parse_uk_ts(ts_val)` parser in `backend/time_utils.py` (rejecting `isinstance(ts_val, bool)`), aliasing `backend/db.py` `_parse_uk_ts` and `backend/analytics_service.py` `parse_uk_datetime` to it.
    3. Delete duplicate `uk_today_str`/`uk_now` in `backend/mnd_sync_service.py:19-23` and nested `_parse_ts_ms`/`_fmt_london_iso` in `backend/garmin_sync_service.py`; route both sync modules plus the 7 `ZoneInfo("Europe/London")` calls in `backend/main.py` (`:317, :534, :665, :753, :878, :901, :1023`) through `backend/time_utils.py`.
*   **`backend/state_store.py`:**
    1. Make `get_data_dir() -> str` the single resolver returning `DATA_DIR` (if stripped string is non-empty), else `"/data"` (if directory exists), else `os.path.join(BACKEND_DIR, "data")`; remove `get_data_dir() is None` branches in `backend/state_store.py:212`, `backend/garmin_sync_service.py:15-21`, `backend/mnd_sync_service.py:25-31`, `backend/renpho_sync_service.py:14`, and `backend/db.py:13-17`.
    2. Delete unused `ARTIFACT_LIVE_STATE_PATH` (`backend/garmin_sync_service.py:41`, `backend/mnd_sync_service.py:48, :1404-1407`), `mirror_paths`, and `backend_copy` mirroring (`backend/state_store.py:185, :192, :211-223`).
    3. Reject non-finite floats during serialization via `json.dump(data, tmp, indent=2, allow_nan=False)` (`backend/state_store.py:140`), paired with `not isinstance(v, bool)` checks in FastAPI/Pydantic numeric validators.
    4. Harden `state_lock(path)` context manager: acquire `_PROCESS_LOCK` (`threading.RLock()`), acquire `fcntl.flock(fd, LOCK_EX)` on POSIX when `fcntl` is available (log error and raise `RuntimeError` if locking fails—never run unlocked), omit Windows `msvcrt.locking`, and wrap `os.replace()` (`backend/state_store.py:143`) in `for delay in (0.05, 0.1, 0.2, None)` retrying `PermissionError` before raising `OSError`.
    5. Define `.bak` healing precedence: `load_live_state()` checks `getsize > 0` and valid JSON dict, falling back to `bak_path` and atomically rewriting `target` under `state_lock()`; `ensure_live_state_seeded()` checks `target` validity first, then `bak_path` **before** read-only `DEFAULT_STATE_PATH` seeds.
*   **`backend/db.py`:**
    1. Set `DATA_DIR = state_store.get_data_dir()`; remove module-import `init_db()` (`:267`) and duplicate `import json` (`:266`). Invoke `db.init_db()` in FastAPI `lifespan` startup and call an idempotent `_ensure_initialized()` inside DB helpers for standalone execution.
    2. Keep `get_connection()` returning a raw `sqlite3.Connection` (`PRAGMA busy_timeout=10000`, `PRAGMA synchronous=NORMAL`), moving `PRAGMA journal_mode=WAL` to `_init_db_unlocked()`. Wrap internally opened connections in `_init_db_unlocked()` (`:44`), internal DB helpers (`:273-723`), and `backend/analytics_service.py:401` (`conn is None`) via `contextlib.closing(get_connection())` + `try / conn.commit() / except: conn.rollback(); raise`.
    3. Delete the obsolete `backend/renpho_seed.json` auto-seed block (`backend/db.py:140-156`).
    4. Add `is_warmup INTEGER DEFAULT 0` to `strength_logs` (created in `_init_db_unlocked()` `CREATE TABLE` and migrated idempotently via `PRAGMA table_info(strength_logs)` `ALTER TABLE`). Update `log_strength_set(..., is_warmup: bool = False)` and filter `WHERE COALESCE(is_warmup, 0) = 0` inside `get_strength_pr_map()`, `get_exercise_best_e1rm()`, and `get_strength_history()`.
    5. In `_insert_renpho_records`, divide millisecond timestamps (`abs(ts) > 1e11`) by `1000.0`; when `ts` is missing and `localCreatedAt` is present, parse `localCreatedAt` as UTC+08:00 (`Asia/Shanghai`, Renpho scale server timezone) and convert to `Europe/London` ISO (skipping rows with neither valid `ts` nor valid `localCreatedAt`).
    6. In `get_renpho_history(days=...)`, average non-null numeric fields per UK calendar date first, then compute `[date - 6d, date]` 7-day calendar rolling averages. Guard JSON parsing in `get_workout_sessions()` (`:632-637`) and `get_manual_activities()` (`:668-673`) with logger warning and corrupt-row skip, skip malformed input records on `upsert_renpho_measurements()`, validate dict serialization on `log_workout_session()`, keep Python `time_utils.parse_uk_ts()` cutoff filtering, and sort `get_strength_history` in Python via `(time_utils.parse_uk_ts(ts) or datetime.min)`.
    7. Scope `upsert_daily_biometrics(..., overwrite_nulls: bool = False)` to overwrite nullable biometric columns with `None` *only* when the existing SQLite row has `source == 'mnd_estimated'`, add `preserve_manual: bool = False` on `upsert_daily_nutrition()`, and add scoped `claim_idempotency_key(scope: str, event_id: str) -> bool` using `INSERT OR IGNORE INTO kv_store (key, value, updated_at) VALUES ('idem:' || ? || ':' || ?, '1', ?)` returning `cursor.rowcount == 1`.

#### 1.2 Third-Party Sync Services (`backend/garmin_sync_service.py`, `backend/mnd_sync_service.py`, `backend/renpho_sync_service.py`)
*   **`backend/garmin_sync_service.py`:**
    1. Protect `self.client` and `self.pending_login_state` with `self._client_lock = threading.RLock()`. Add `_ensure_display_name(client)` calling `client.client.connectapi("/userprofile-service/socialProfile")` when `not getattr(client, "display_name", None)` at the end of `get_client()`, `login_with_credentials()`, and `submit_mfa()`. Remove unused `client.client.profile` (`:158`). Never fall back to `client.client.loads(tok)` inside `_try_load_token_str()` after an auth error; normalize `GARMIN_TOKENS_JSON` inside `get_client()` (removing import-time `:34-38` `os.environ` mutation); write tokens atomically with `0o600` (removing double `_persist_tokens()` at `:589`, keeping `:963`).
    2. In `is_auth_error(exc)` (`:280`), check `isinstance(exc, GarminConnectAuthenticationError)` first and invoke `is_auth_error()` inside the 4 unguarded `except` blocks (`:519, :676, :695, :716`). Clear `garmin_state['oauth_failed_at'] = None` on successful `login_with_credentials()`, `submit_mfa()`, or OAuth `sync_today()`.
    3. Track all 5 upstream endpoint booleans (`summary_ok`, `activities_ok`, `sleep_ok`, `readiness_ok`, `bb_ok` — `True` whenever the call succeeds without raising, including valid empty `{}` / `[]` responses). If all 5 fail, stamp `garmin_state['oauth_failed_at'] = now_iso` on auth failure, leave `self._last_sync_ts` (`:244`) unchanged, and return `{"success": False, "requires_auth": auth_failed, "error": ...}` without overwriting today's metrics. On partial success, update only succeeded domains while preserving existing same-day metrics for failed domains. Bypass the `180 s` throttle (`:236`) whenever `target_date_str != state.get('garmin', {}).get('oauth_date')`.
    4. On UK date rollover (`:782-789`), resolve `prev_garmin_date = garmin_state.get('metrics_date') or garmin_state.get('oauth_date') or prev_date`, pop `distance_miles`, `active_minutes`, `resting_hr`, `body_battery_debug`, **`mnd_logged`**, and **`mnd_meals`** from `garmin_state`, clear stale `state['mnd_logged']`, `state['mnd_meals']`, `state['mnd_cloud_logged']`, `state['mnd_cloud_meals']`, and `state['app_deleted_meals']`, and call `recalculate_nutrition()`.
    5. Stamp `garmin_state['oauth_last_synced'] = now_iso` alongside `last_synced = now_iso` and advance `self._last_sync_ts = time.time()` when `>= 1` upstream call succeeds.
    6. Retain today's `manual_app_entry` workouts, subtract `bmrCalories` when embedded in summary active burn before adding `manual_today_burn`, and deduplicate watch vs manual workouts when `abs(watch.calories - manual.calories) <= 15` AND `(abs(watch_dt - manual_dt) <= 7200 s or either lacks clock time)`. Respect `*_manual_date == target_date_str` overrides; preserve benefits via local `custom_note` (`existing.get('user_notes') or db.get_kv(f"activity_note_{act_id}")`) when `existing and existing.get('benefits') and (not custom_note or custom_note == existing.get('sub_title'))`; pass finite `weight_kg` (`> 0`) into `benefits_engine.generate_benefits()` at `:644` and `:914`; sort readiness via `time_utils.parse_uk_ts()`; cap `recent_activities[:100]`; call `db.upsert_daily_biometrics(..., overwrite_nulls=True)`.
*   **`backend/mnd_sync_service.py`:**
    *   *Locking & Throttled Backfill:*
        * Initialize `self._sync_lock`, `self._history_backfill_lock`, `self._history_cache_lock`, and `self._last_backfill_ts = 0.0` in `__init__()`, enforcing acyclic lock order `(_sync_lock | _history_backfill_lock) -> state_store.state_lock() -> _history_cache_lock` where `_history_cache_lock` wraps *only* in-process `mnd_history_cache.json` read/write.
        * Acquire `self._sync_lock` in `fetch_today_data()`, throttle `fetch_multi_day_history()` backfill to `>= 7200 s`, abort on `ensure_authenticated()` failure (`:677`), fetch missing days unlocked over HTTP before acquiring `_history_cache_lock`, cache `0 kcal` past days for `12 h`, and update `cache[target_date_str]` + `averages_10d` (`logged_days[-10:]` with `calories > 0`) from `merged_state['mnd_logged']`/`merged_state['mnd_meals']` after `_update_live_state_locked()` returns (`:788-790`).
    *   *Raw Cloud vs. Overlays:* Store raw upstream MND snapshot in `state['mnd_cloud_logged']` and `state['mnd_cloud_meals']` (assigning item IDs `sha1(f"{cat}|{norm_name}|{cals}|{p}|{occurrence_idx}")[:12]` at `:966` where `norm_name = re.sub(r"\s+", " ", name.strip().lower())`) before composing overlays via `_compose_mnd_with_overlays(cloud_totals, cloud_meals, app_logged, app_deleted)`. Deduplicate cross-category app items by `item.id` or `(norm_name, int(cals), int(protein))`; pass `preserve_manual=True` in both `:1295` and backfill (`exclude today_str`); preserve today's `state['mnd_logged']`/`state['mnd_meals']` during background polls (`force=False`) if today's SQLite nutrition row has `source == 'manual'`.
    *   *Rollover, Nullable Guards & MND Bridge:* Mirror UK rollover cleanup inside `_update_live_state_locked()` (`:1102-1109`), popping `distance_miles`, `active_minutes`, `resting_hr`, `body_battery_debug`, `mnd_logged`, and `mnd_meals` from `garmin_state` plus stale `state['mnd_*']` / `state['app_deleted_meals']`. Guard nullable MND fields (`mealTypeName`, `isinstance(ex_json, dict)`, `analysis_data`, date regexes with `(?:^|\D)0?{target_day}(?:\D|$)` at `:1322`), stamp `'date': today_str` onto `mnd_payload` (`:1274`), fix `active_calories or 0` (`:1395`), and when `not has_live_garmin_oauth` (`mnd_bridge`), stamp `bridge_last_synced=now_iso` & `last_synced=now_iso` (never `oauth_last_synced`), preserve non-zero metrics over `0`/`None` MND values, add retained `manual_app_entry` burn, and write SQLite biometrics with `source='mnd_estimated'`.
    *   *Weight, Hydration, Credentials & Cache Bounds:* Require `\b(lb|lbs|pounds?)\b` before lb-to-kg conversion, remove `97.70`/`80.99` fallbacks (`:1363-1365`), never stamp `uk_now()` onto undated weights, enforce `max(mnd_water, db_hydration_l, manual_nutrition_water_l)` (`manual_nutrition_water_l` from existing `mnd_logged['water_l']` when today's DB row has `source == 'manual'`), cap `recent_activities[:100]`, prune `mnd_history_cache` > `90` days, write `credentials.json` (`0o600`), and keep `'updated_at'` in `get_credentials()`.
*   **Segmented Scale Channels, 3-Way Weight Precedence Table & `backend/renpho_sync_service.py`:**
    1. Segment `state["renpho"]` into Weight (`weight_kg`, `weight_synced_at`, `weight_source`, `last_synced`) and Bio-Impedance (`body_fat_pct`, `lean_mass_kg`, `bio_synced_at`, secondary scale metrics). Implement `_opt_float`/`_opt_int` (reject `weight <= 0`, returning `None` on omitted bio-impedance fields—zero `17.1`/`2096`/`46`/`80.99` defaults) and sort via `(m.get('timeStamp') or 0)`.
    2. On any weight-only reading (`manual_scale_entry`, socks-on Renpho `body_fat_pct is None`, or today MND weigh-in): inspect finite `existing_lbm` (`< weight_kg`) from `state["renpho"]` or `state["athlete"]`; when valid, preserve `existing_lbm` and `bio_synced_at` and compute `body_fat_pct`, `target_weight_at_15pct`, and `fat_to_lose_kg` (preserving valid prior secondary metrics when present and leaving missing ones `None`); when unseeded/invalid, set all four derived fields (`body_fat_pct`, `lean_mass_kg`, `target_weight_at_15pct`, `fat_to_lose_kg`) to `None`.
    3. **Scale Weight Precedence Table (`time_utils.parse_uk_ts()` on `weight_synced_at or last_synced` vs. candidate timestamp):**
       | Existing `weight_source` | Incoming Source | Resolution Rule |
       | :--- | :--- | :--- |
       | `manual_scale_entry` | `renpho_direct_cloud` | Full parsed UK datetime comparison; keep `manual_scale_entry` unless cloud reading is strictly newer (`>`). Ties retain `manual_scale_entry`. |
       | `renpho_direct_cloud` or `manual_scale_entry` | `live_mynetdiary_weight` | Same-day or newer existing weight (`existing_weight_date >= today_str`): retain existing; update only when `is_today_weighin` is true AND `existing_weight_date < today_str`. Undated MND weights never write. |
       | `live_mynetdiary_weight` (or undated/empty) | `renpho_direct_cloud` | `renpho_direct_cloud` wins unless `live_mynetdiary_weight` has a strictly newer parsed UK datetime (`>`). |
       | `renpho_direct_cloud` | `renpho_direct_cloud` | Full parsed UK datetime comparison (`incoming >= existing`); strictly older (`<`) returns `"preserved_newer": True, "state": state`. |
       | Any existing source | `/api/renpho/manual` (`manual_scale_entry`) | Stamps `uk_now()` and wins for today's weight; rejects unless valid `(20, 300) kg`. |
    4. In `backend/renpho_sync_service.py`: use `threading.RLock()` for `_sync_lock` and acquire in `get_history()` (`get_client(force_refresh=True)` retry on cloud fallback); add `self._error_until = 0.0` (`+300 s` on error; `not force` inside `3600 s` normal or `_error_until` returns `{"success": True, "throttled": True, "state": state}`); set `"requires_auth": True` on auth error and advance `_last_sync_ts` only after `save_live_state()` succeeds.

#### 1.3 Analytics, Benefits, Seed Files & FastAPI Routes (`backend/analytics_service.py`, `backend/benefits_engine.py`, `backend/main.py`, `live_state.json`, `backend/live_state.json`)
*   **`backend/analytics_service.py`:**
    1. **Canonical Macro Target Equations (`compute_macro_targets`):** Signature `compute_macro_targets(base_calories, active_calories, base_protein, diet_strategy="balanced", carb_cycle_level="mod", custom_goal_macros=None, pro_dial_macros=None, goal_key=None)` returning exact integer tuple/dict `(calorie_target, protein_target_g, carbs_target_g, fat_target_g)`:
       * `calorie_target = round(base_calories + max(0.0, active_calories))`
       * `protein_target_g`: if `diet_strategy == "custom"` and `pro_dial_macros` has finite non-bool `protein > 0`, use `round(pro_dial_macros["protein"])`; else if `goal_key == "custom"` and `custom_goal_macros` has valid positive `protein`, use `round(custom_goal_macros["protein"])`; else `round(base_protein)`.
       * `rem_cals = max(0, calorie_target - protein_target_g * 4)`
       * Custom `fat_pct` fallback: validate/clamp numeric `fat_pct` to `[15, 65]`, defaulting to `30` if `pro_dial_macros` is missing/invalid.
       | Diet Strategy | Carb Equation (`carbs_target_g`) | Fat Equation (`fat_target_g`) | Minimum Clamps |
       | :--- | :--- | :--- | :--- |
       | `balanced` | `round((rem_cals * 0.62) / 4)` | `round((rem_cals * 0.38) / 9)` | `carbs >= 50`, `fat >= 30` |
       | `lowcarb` | `75` | `round(max(0, rem_cals - 75 * 4) / 9)` | `fat >= 40` |
       | `carbcycle` | `{'high': 300, 'mod': 200, 'low': 80}[lvl]` (default `'mod'`) | `round(max(0, rem_cals - carbs * 4) / 9)` | `fat >= 30` |
       | `fasting` | `round((rem_cals * 0.55) / 4)` | `round((rem_cals * 0.45) / 9)` | `carbs >= 50`, `fat >= 35` |
       | `custom` (`fat_pct` in `[15, 65]`) | `round((calorie_target - protein_target_g * 4 - calorie_target * (fat_pct / 100)) / 4)` | `round((calorie_target * (fat_pct / 100)) / 9)` | `carbs >= 20`, `fat >= 20` |
       Add `"pro_dial_macros"` (`{ "protein": int, "fat_pct": int }`) to `ALLOWED_PREF_KEYS`.
    2. Update `compute_sync_freshness()` (`:59-74`) to read `garmin_obj.get("oauth_last_synced") or garmin_obj.get("last_synced")` (`180 min`) and `renpho_obj.get("weight_synced_at") or renpho_obj.get("last_synced")`.
    3. In `compute_adaptive_tdee()`: seed from `mnd_history`, then process SQLite `nutrition_rows` unconditionally (deleting date `d` if authoritative SQLite row has `< 800 kcal`), guard `math.isfinite()`, and clamp `valid_fuel` to `<= min(today_date - timedelta(days=1), sorted_w_dates[-1])` when `sorted_w_dates` is non-empty (`today_date - 1d` when empty).
    4. In `compute_acwr_overreaching()`:
       * Track `has_time = bool(dt and (dt.hour or dt.minute or dt.second))` so date-only activities deduplicate against same-day sessions while preserving distinct timed sessions (`abs(dt1 - dt2) > 7200 s` or `abs(load1 - load2) > 15`).
       * Compute `span_days = (today_date - min_28d_date).days + 1` over `[today - 27d, today]` and exclude `resting_hr <= 25` from baseline RHR.
       * Ignore `garmin_live` biometrics only when `metrics_date` or `last_synced` is present AND `parse_uk_datetime(ts).date() < today_date - timedelta(days=1)` (leaving undated `tests/test_v60_backend.py:421-434` fixtures intact), and ignore `latest_bio` when `date_str` is older than 2 calendar days.
       * Format `fatigued_markers` from Sleep (`< 68`), Battery (`< 35`), and RHR (`>= baseline + 4`); emit `"7-day training load exceeded 1.45x your 28-day chronic baseline; schedule a reduced-volume deload session."` when `acwr >= 1.45` and `not fatigued_markers`.
    5. In `merge_preferences_v1()`, enforce per-field LWW schema (`inc_ts >= srv_ts`) and clamp incoming clocks to `min(inc_ts, now_ms + 60_000)`.
*   **`backend/benefits_engine.py`:** Default `PhysiologicalBenefitsEngine.__init__(self, athlete_weight_kg=None)`, use `\b` word-boundary regexes (`r'\b(kb|kettlebell)\b'`, `r'\b(run|jog|sprint)\b'`, etc.), check `is_ruck` before `is_walk`, check `is not None` in `analyze_workout()`, emit bodyweight-relative phrasing (`"3.5-4.5x bodyweight"`, `"~1.2x bodyweight"`, `"2.5-3.0x bodyweight"`) across `is_jump`, `is_walk`, and `is_run` whenever `weight_kg is None` (zero `99.85 kg` fallback), omit `({peak_pct}% estimated HRmax)` (or peak clause) when `max_hr <= 0`, and deduplicate `muscles` preserving order.
*   **`backend/main.py` & Seed Baseline Alignment:**
    1. *Lifecycle & Pydantic Request Schemas:* Register FastAPI `lifespan` (`db.init_db()` on startup, `scheduler.shutdown(wait=True)` on shutdown). Explicitly add `client_date: Optional[str] = None` to `ManualMndPayload`, `HydrationPayload`, `TelemetryOverridePayload`, and `ActivitySyncPayload`, and `client_event_id: Optional[str] = None` / `id: Optional[str] = None` to `SetLogPayload`, `ActivitySyncPayload`, `HydrationPayload`, and `ManualMndPayload`. Use attribute access (`payload.date or payload.client_date`) on Pydantic models and `.get()` only on dict `sync_session`.
    2. *Validation (`HTTP 422`) & Coercion Matrix:* Run ALL validation before claiming idempotency keys:
       * Reject booleans (`isinstance(v, bool)`) and non-finite numbers via recursive `_reject_non_finite_json()` on `Dict[str, Any]` payloads (`sync_session`, `/api/athlete/injuries`) and field validators on `duration_min`, `calories`, `avg_hr`, `max_hr`, `steps`, `distance_miles`, `aerobic_te`, `anaerobic_te`, `sugar_g`, and `sat_fat_g` (`>= 0`) prior to mutating `state`.
       * Date slice `[:10]` must match `YYYY-MM-DD` and satisfy `<= uk_today_str()` (`422` on malformed/future).
       * Scale weight (`/api/renpho/manual`): require `(20, 300) kg`. Strength `/api/sync_set` & `/api/prescription/override`: strip `/^2\s*[×x]\s*/i` and trailing `kg` in `_coerce_weight_kg()` (`:780`); allow `[0, 500] kg` and `"Body"`/`"BW"`/`"bodyweight"` (`0.0`); reject unparseable weights (or `/api/sync_set` reps outside `[0, 200]`; `/api/prescription/override` allows `^\d+s$|^Max$|^\d+-\d+$` target reps) with HTTP `422`. Validate `pro_dial_macros` in `ClientPreferencesPayload._validate_fields` (`protein` in `[50, 400]`, `fat_pct` in `[15, 65]`, non-bool finite) while keeping `ConfigDict(extra="forbid")`.
    3. *Macro Helpers & Seeds:* Extract `recalculate_nutrition(state, date_str)` calling `analytics_service.compute_macro_targets()` (reading `client_preferences_v1`); invoke it inside `garmin_sync_service.py`, `mnd_sync_service.py`, `/api/mnd/manual` (`:620-627`), `/api/preferences/state`, and `:955` (fixing `garmin.get("mnd_logged") or {}`). Align `live_state.json` & `backend/live_state.json` (`base_calorie_target: 2092`, `base_protein_target_g: 200`, `carbs_target_g: 200`, `fat_target_g: 55`, `deficit: 350`, neutral `null` athlete weight/BF/age/height defaults; remove `98.4`/`17.1` from `backend/main.py:1125`).
    4. *Scale, Set, Override & Warmup Isolation:*
       * In `/api/renpho/manual` (`:654-690`), stamp `weight_source = 'manual_scale_entry'` and `weight_synced_at`, compute valid `existing_lbm` math (or set BF%, LBM, target weight, and `fat_to_lose_kg` to `None`), and pass `"sinew": muscle_mass_kg` (`None` when absent) / `"water": water_pct` (`None` when absent) into `db.upsert_renpho_measurements()`.
       * In `/api/sync_set` (`:812-865`, where `sp` is `state["strength_prescriptions"][ex_name]`): evaluate warmups (`target_w > 0 and logged_w > 0 and logged_w < 0.75 * target_w`) *before* mutating `sp`, log via `db.log_strength_set(..., is_warmup=True)`, and return `{"success": True, "status": "success", "result": {"status": "warmup", "e1rm": e1rm, "is_pr": False, "prev_best_e1rm": prev_best}}`.
       * On working sets, compute `best_e1rm`, `deload_w = min(w, max(2.5, round((w * 0.85) / 2.5) * 2.5))`, and stamp `sp["last_updated"] = uk_now().isoformat()` (also stamp `item["last_updated"]` in `/api/prescription/override` `:1078`).
    5. *Scoped Idempotency Across the 5 Event-Logged Mutators:* When non-empty `client_event_id` (or `id`) is present after `422` validation: on `/api/sync_activity`, hold `state_lock()`, call `db.claim_idempotency_key("sync_activity", event_id)`, store `entry["id"] = str(event_id)` + `entry["client_event_id"]`, and on replay return `200 { "success": True, "duplicate": True, "state": current_state }` without SQLite write, list insert, `active_calories` addition, or `recalculate_nutrition()`. On `/api/mnd/manual`, `/api/sync_set`, `/api/sync_session`, and `/api/hydration/add`, claim scoped `db.claim_idempotency_key(route, event_id)` inside `state_lock()` and return `200 { "success": True, "duplicate": True, "state": current_state }` on replay (omit claiming when no ID is supplied).
    6. *Delta vs. Snapshot `/api/mnd/manual` & Past-Date SQLite Write-Through:*
       * `ManualMndPayload`: optional `totals`, `remove_item` (`{ id?: str, meal_category: str, name: str, cals: int, p: int, c?: int, f?: int }`), `logged_item`, and `client_event_id`.
       * Delta additions & deletions (`logged_item` or `remove_item`): assign `f"app_{uuid4().hex[:10]}"` when `logged_item.id` is absent (`:583`). On `remove_item`, remove 1 matching item from `app_logged_meals[date_str]` first; if not found, append 1 tombstone `{ id, sig: [norm_name, cals, p], category, deleted_at }` to `state["app_deleted_meals"][date_str]` (pruned `< yesterday_str`).
       * Cloud baseline composition: if `mnd_cloud_logged` is unpopulated and `payload.totals` is sent, bootstrap `mnd_cloud_*` from `payload.totals - logged_item` (add) or `payload.totals + remove_item` (delete); run `_compose_mnd_with_overlays()` and write `mnd_logged["source"] = "mnd_overlay"` (or `"live_mynetdiary_cloud"` when cloud exists) with SQLite `source = "mnd_overlay"`.
       * Snapshot override (`totals` with neither `logged_item` nor `remove_item`, from `saveMndSyncTotals()`): overwrite `mnd_logged`/`mnd_meals` directly and write SQLite `source = "manual"`.
       * Past dates (`date_str < today_uk`) across `/api/mnd/manual`, `/api/hydration/add`, `/api/telemetry/override`, `/api/sync_session`, and `/api/sync_activity`: write strictly to SQLite without touching today's `live_state`; past-date `/api/mnd/manual` updates `mnd_history_cache` and `state["mnd_history"]["days"]` (`state_lock() -> _history_cache_lock`).
    7. *Preferences, Sync Proxies & Benefits Call Sites:*
       * Wrap `get_kv -> merge_preferences_v1 -> set_kv -> recalculate_nutrition()` in `POST /api/preferences/state` (`:1214-1262`, bumping field cap `:1175` from `8` to `9`) inside `state_lock()`, running `recalculate_nutrition()` whenever any of `("goal_key", "custom_goal_macros", "diet_strategy", "carb_cycle_level", "pro_dial_macros")` is `"accepted"`.
       * Gate `Cache-Control: immutable` on `response.status_code == 200` (`:170`); on `/api/garmin/sync` (`:385-419`), preserve `200` MND bridge fallback (`isinstance(res, dict) and res.get("success") is False`), returning HTTP `502` (`{ "success": False, "upstream_auth_required": bool, "error": ... }`, never `401`) when both Garmin + MND fallback fail or when `/api/mnd/sync` / `/api/renpho/sync` fails (`run_scheduled_sync()` handles failed dicts without raising).
       * Pass live `weight_kg` into `benefits_engine.generate_benefits()` (`backend/main.py:915`) and `analyze_workout()` (`backend/main.py:1140`).

**Phase 1 Checkpoint:** Run `.venv/Scripts/python.exe -m py_compile backend/*.py` and execute isolated `tests/test_v60_backend.py` + `tests/test_v61_backend.py` covering lock ordering, `.bak` healing, `422` validation, warmup isolation (`is_warmup=1`), 3-way scale precedence, delta vs. snapshot `/api/mnd/manual`, scoped idempotent retries, and sync mocks prior to Phase 2 frontend changes.

--------------------------------------------------------------------------------

### Phase 2: Frontend State, Rollover, Preference Sync & Offline Queue (`js/state.js`, `js/fuel-engine.js`, `js/telemetry.js`, `js/workout-timers.js`, `js/workout-verdict.js`, `js/charts.js`, `sw.js`)

#### 2.1 Canonical UK Date, Safe HTML & Clickable `#appToast` (`js/state.js`, `js/fuel-engine.js`, `js/telemetry.js`, `js/workout-timers.js`, `js/workout-verdict.js`)
*   Move `showToast(msg, options = {})` into `js/state.js` rendering inside `#appToast` (`index.html:2174`, never `#toast`); remove any prior action button before rendering `{ actionLabel, onAction, durationMs }` inside `<button type="button" class="toast-action-btn">`, skipping auto-hide timeout when `durationMs === 0`.
*   Consolidate `getLocalDateStr(d = new Date())` (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' })`) across `js/state.js`, `js/fuel-engine.js`, `js/telemetry.js`, `js/workout-verdict.js`, and `js/workout-timers.js` (`:167, :484`); delete `escapeAuditHtml()` (`js/fuel-engine.js:453-461`) in favor of `escapeHtml()`; guard `new Date(s.date)` with `!isNaN(d.getTime())` inside `getMatchedPulseSessionForGarmin()` (`js/telemetry.js:69`) so invalid dates never throw `RangeError` during downstream date formatting.
*   In `js/state.js:38-51` midnight rollover, clear `garmin.mnd_logged`, `garmin.mnd_meals`, `garmin.oauth_date`, and `garmin.oauth_failed_at` to `null`, set `garmin.inapp_burn_today` and `garmin.active_calories` to `0`, reset `nutrition.calorie_target = nutrition.base_calorie_target`, and evict stale prior-date entries in `pulse_inapp_burn_today`. In `js/telemetry.js:2696`, enforce `ml && (ml.date ? ml.date === todayIso : state.date === todayIso)`.

#### 2.2 Active Session Restoration, Swap Scoping & Unified Offline Queue (`js/state.js`, `js/workout-verdict.js`, `js/telemetry.js`, `js/fuel-engine.js`)
*   Persist `currentArchetypeKey`, `currentSessionFocus`, `kbSubMode`, and `activeSessionMeta` in `saveActiveSessionToLocalStorage()` (`js/state.js:782`); in `restoreActiveSessionFromLocalStorage()` (`:803-807`), restore whenever `session.date === todayStr && Array.isArray(session.plan) && session.plan.length > 0` (removing the `Object.keys(session.sets).length > 0` gate), clamp `currentExIdx` to `[0, activeWorkoutPlan.length - 1]`, and set `window._userManualArchetype = true`; remove obsolete `pulse_tomorrow_plan` auto-boot loading so `setTomorrowTargetPlan()` does not overwrite an active today session, and scope `pulse_today_exercise_swaps` to `{ date }`.
*   Update `enqueueOfflineWrite()` / `flushOfflineQueue()` (`js/state.js:870-961`):
    * Attach `client_event_id` (`_makeQueueItemId()`) and `client_date: getLocalDateStr()` on body where absent (omitting both on `/api/preferences/state` to preserve `ConfigDict(extra="forbid")`), track `attempts` and `ttl` (`72 h`), drop `400–499` (excluding `401`, `408`, `429`), fast-abort on `401` or `status === 0`, and cap at `attempts >= 10`.
    * Extract `_shouldQueueOfflineResponse(res)` (`status === 0 || >= 500 || 401 || 408 || 429`) across all 9 offline mutators (including `saveManualWeight` `/api/renpho/manual`, `saveInjuries` `/api/athlete/injuries`, and `navigator.onLine === false` in `quickAddHydration`).

#### 2.3 Single-Formula Macro Parity, Tagged `pulse_inapp_burn_today` & Poll Protection (`js/state.js`, `js/fuel-engine.js`, `js/telemetry.js`, `js/workout-timers.js`)
*   Implement `computeMacroTargets(...)` (including `goal_key` parameter) in `js/fuel-engine.js` producing identical rounded integers to `backend/analytics_service.py` across `balanced`, `lowcarb`, `carbcycle`, `fasting`, and `custom` Pro Dial (`fat_pct` clamped `[15, 65]`, default `30`). Invoke inside `selectGoal()`, `applyCustomGoalArchitect()`, `selectDietStrategy()`, `setCarbCycleLevel()`, `updateProDial()`, `applyCustomProDial()`, and `renderMyNetDiaryEngine()` (`2092` remains only the `'recomp'` anchor; remove `|| 2437` in `js/fuel-engine.js:2149, :2169`). Update `applyCustomProDial()` (`js/fuel-engine.js:2164`) to persist `diet_strategy: 'custom'` and `pro_dial_macros: { protein, fat_pct }` into `localStorage['pulse_pro_dial_macros']` and sync via `syncClientPreferencesToCloud()`.
*   Register `pro_dial_macros: { lsKey: 'pulse_pro_dial_macros', json: true }` inside `PULSE_PREF_MAP` (`js/state.js:72-81`), place `pro_dial_macros` before `diet_strategy` inside `orderedKeys` (`:265-268`), handle `key === 'pro_dial_macros'` inside `_applyHydratedPrefToUi()` (`:134-154`, updating `#sliderProtein`/`#sliderFat` + `updateProDial()` + `renderMyNetDiaryEngine()` without re-uploading when `opts.fromBoot`), and restore it at boot (`js/telemetry.js:3058-3077`). Queue preference writes on `401` in `_flushPendingPrefPatch()`, protect `_pendingPrefFields` in `hydrateClientPreferencesFromCloud()`, upload local prefs missing on server when `localTs === 0`, and serialize immediate vs debounced flushes.
*   Standardize `localStorage['pulse_inapp_burn_today']` as `[{ id, date, calories, kind }]` (`kind: 'strength' | 'conditioning' | 'manual' | 'legacy'`) managed by shared `_appendInAppBurnEntry()` in `js/state.js`. Invoke it inside `finishSession()` (`js/workout-timers.js:182`), `submitManualActivityModal()` (`js/telemetry.js:596`, removing direct mutation of `window.BAKED_LIVE_STATE.garmin.active_calories` and applying `res.state` at `:626`), and `logTimerSession()` (`js/workout-timers.js:498`, generating distinct `${baseEventId}_act` and `${baseEventId}_sess` event IDs for `/api/sync_activity` and `/api/sync_session`). In `getTodayInAppBurn(garmin)` (`js/state.js:594-608`), sum today's entries matching neither `a.id` nor `a.client_event_id` in `garmin.today_activities`, applying `hasGarminStrength` suppression solely to `kind === 'strength'` or `'legacy'`.
*   Stamp `updated_at_ms: Date.now()` onto `pulse_*_override_obj` inside `TELEMETRY_OVERRIDE_CONFIGS` (`js/telemetry.js:3326, :3370, :3421`). In `applyLiveStateToDom()` (`:2344-2374, :2695-2746`): replace `!isLiveGarminOauthToday` with `oauthMs = Date.parse(state.garmin.oauth_last_synced || '') || 0` (expiring overrides only when `obj.date !== todayIso` or `(oauthMs > 0 && Number(obj.updated_at_ms || 0) <= oauthMs)`), skip overwriting `athleteInjuries` when `/api/athlete/injuries` is queued, skip overwriting `myNetDiaryData` when `/api/mnd/manual` is pending, and sum `/api/hydration/add` queued deltas where `(item.body.client_date || item.body.date) === todayIso`.

#### 2.4 Single-Pass Rendering, Scale Null Display & Service Worker (`js/telemetry.js`, `js/charts.js`, `js/fuel-engine.js`, `js/state.js`, `sw.js`)
*   Keep `js/charts.js` self-contained (removing duplicate `renderHistoryList()` call at `js/charts.js:1284-1285`); move `window.dismissBootSplash` and `window.forcePulseAppReload` outside `window.addEventListener('load', ...)` (`js/telemetry.js:3005`) to top-level scope, guarding `forcePulseAppReload()` with `navigator.onLine !== false`.
*   Skip pre-fetch `applyLiveStateToDom(window.BAKED_LIVE_STATE)` during `loadLiveState({ silent: true })` polls; remove duplicate internal calls inside `applyLiveStateToDom()` (`js/telemetry.js:2621-2622, :2732-2738, :2896, :2901`) so each renderer runs once per pass; share one `60 s` poll throttle between `visibilitychange` and `focus`; preserve `<details open>` via shared `_withPreservedDetails()` across these explicit `data-details-key` targets:
    `train_strength_progression` (`index.html:443`), `fuel_budget_math` (`:562`), `fuel_hydration` (`:685`), `fuel_diet_strategy` (`:730`), `body_coach_briefing` (`:892`), `body_renpho_trend` (`:911`), `body_population_norms` (`:923`), `injury_biomech_breakdown` (`js/telemetry.js:1553`), and `inline_conditioning_drill` (`js/workout-player.js`).
*   Preserve `summary.sync_freshness` precomputed ages inside `renderSyncFreshnessStrip(summary, fallbackState)` (`tests/test_v60_frontend.js:849-858`); update `_deriveFallbackFreshness()` to prioritize `oauth_last_synced || last_synced` and `weight_synced_at || last_synced`; invoke `renderSyncFreshnessStrip(null, window.BAKED_LIVE_STATE)` on a standalone `60 s` interval without rebuilding `<details>` accordions.
*   In `js/fuel-engine.js` & `js/telemetry.js`:
    * Convert `_appendSnackAndSync()` (`js/fuel-engine.js:1623`, stamping item `id`) and `deleteMndMealItem()` (`:1742`, coercing `Number(...) || 0` and omitting `totals` / passing `totals: null`) to delta payloads; preserve `sugar_g`/`sat_fat_g` in `saveMndSyncTotals()`; display `+X kcal over budget` in `renderMacroGapCloser()` when `remCals <= 0` or `withinBudget` is empty; derive audit pills from `histDays`.
    * Return `{ ok, upstreamAuthRequired, error }` from `triggerGarminCloudSync()` (`promptAuthOn401: false`, retaining MND bridge fallback) and `triggerMndAutoPull()` so `syncBothGarminAndMnd()` shows explicit partial-failure copy; update `applyLiveStateToDom()` (`js/telemetry.js:2758-2867`) & `saveManualWeight()` (`:3202-3209`, removing `81.03`) to clear `#vitalScaleSub`, `#bodyScaleBf`, `#bodyFatToBurnNum`, and `#renphoGoalRunwayLabel` to `"--"` / `"Pending scan"` when `body_fat_pct == null`.
*   In `sw.js`: bump `CACHE_NAME = 'pulse-hybrid-v6.1-20261120'`; update all `STATIC_ASSETS` (`:6-18` CSS + 8 JS files + icons) to `?v=6.1`; return early for `url.pathname === '/sw.js'`; wrap `event.waitUntil(Promise.resolve(self.clients.claim()).catch(() => {}))` (`:40`) so synchronous mocks resolve without throwing; wrap `cache.put()` in `.catch(() => {})`; normalize `/?tab=*` fallback key to `'/index.html'`. In `js/telemetry.js:3157`, defer `window.location.reload()` on `controllerchange` when active timer/sets exist, calling interactive `showToast(...)` with `durationMs: 0`.

**Phase 2 Checkpoint:** Run `node --check` on `js/{state,fuel-engine,telemetry,workout-timers,workout-verdict,charts}.js` + `sw.js`, and verify rollover, macro parity, queue retry/drop rules, `pro_dial_macros` sync, `inAppBurn` dedup, `<details>` persistence, and SW mock lifecycle via `tests/test_v60_frontend.js` & `tests/test_v61_frontend.js`.

--------------------------------------------------------------------------------

### Phase 3: Workout Engine, Timers, Charts & XSS Hygiene (`js/telemetry.js`, `js/fuel-engine.js`, `js/workout-catalog.js`, `js/workout-verdict.js`, `js/workout-player.js`, `js/workout-timers.js`, `js/charts.js`)

#### 3.1 Recovery Copy, PII Removal & XSS Escaping (`js/telemetry.js`, `js/fuel-engine.js`, `js/workout-verdict.js`)
*   Fix `[object Object]` (`js/telemetry.js:938-948`) by looking up `'barbell_bench_press'` and `'barbell_pendlay_row'` via `getAllExercises()` and formatting `rx.weight` as a string.
*   Read `window.athleteProfile` inside `clientAnalyzeWorkoutBenefits` (omitting weight-specific claims when `null`; updating callers at `js/telemetry.js:247, :249, :568, :693` to remove `{ weight_kg: 99.85, body_fat_pct: 17.5 }`), consolidate duplicate `isBridgeAct` (`:2529, :2646`), and `escapeHtml()` `act.subTitle`, `swapPrescription`, and `rootCauseText` (`:827, :849, :1533-1561`).
*   Strip all remaining personal body constants explicitly per location: remove `190.5 cm (6'3")` copy at `js/telemetry.js:1906`, replace `:1918, :1920` with neutral `"Average adult range is 24%-28% body fat; sync Renpho scale telemetry to track progress toward your target milestone."`, remove `45yo` from `#normBfBadge` (`:2795`), replace unseeded `97.75`/`81.03` fallbacks in Goal Architect (`js/telemetry.js:1142, :1148, :1222-1223`) with `null` -> `"--"` placeholders, remove `'81.0'` LBM fallback (`js/fuel-engine.js:439`), and replace unseeded `97.9`/`97.7`/`17.1`/`80.99`/`2.62`/`2.42`/`95.28`/`94`/`93`/`46` fallbacks in `js/workout-verdict.js:1050-1058, :2142-2146` with `null` -> `"--"` pending-sync UI.

#### 3.2 Pattern Classification, Pre-Slice Joint-Safe Swaps & Focus Mode Exit (`js/workout-verdict.js`, `js/telemetry.js`)
*   Fix `renderWeeklyPatternBalance()` (`js/workout-verdict.js:777-782`) by iterating `Object.entries(s.details).forEach(([k, setObj]) => ...)` and resolving via `setObj?.exercise_id || allEx.find(e => k.startsWith(e.id + '_'))?.id || k.replace(/_\d+$/, '')`.
*   Fix `applyCustomEquipmentAndGenerate()` (`:594-603`) and `generateTomorrowRecommendation()` (`:1062-1064`) using `!= null && Number.isFinite(...)` so `null` readiness never triggers deloads.
*   Extract shared `applyJointSafeSwaps(candidateIds, targetCount, athleteInjuries, gearConfig)` and `isExerciseContraindicated(ex, athleteInjuries)` across `{ lumbar, shoulders, knees, elbows, wrists, ankles }`:
    *   *Resolution & Gear Normalization:* Resolve the full pool (`matrixForMode`, `option_kb` `flow_2h`/`flow_1h`, `option_b`) first; match `'kb_flow_2h_*'` / `'kb_flow_1h_*'` by `.startsWith()`; map `requiredGear: ['dumbbells']` (`js/workout-catalog.js:1331-1500`) to `gearConfig.db?.has`; pick the first candidate in `Prioritized Safe Swap IDs` safe across ALL active injuries, matching active `gearConfig`, and absent from `plan` (relaxing to deduplicated bodyweight mobility IDs `['deadbug_hold', 'glute_bridge_hold', 'zone2_flush', 'thoracic_openers']` if exhausted so `20m` or 5-exercise multi-injury plans remain non-empty); run `.slice(0, targetCount)` *after* swaps; and guard `js/workout-verdict.js:93` so `gearConfig.kb.weight` applies only when `ex.requiredGear?.includes('kb')`.
    | Injury Domain | Contraindicated Catalog IDs | Prioritized Safe Swap IDs |
    | :--- | :--- | :--- |
    | `lumbar` | `barbell_squat`, `barbell_rdl`, `barbell_zercher_squat`, `barbell_z_press`, `barbell_pendlay_row`, `kb_heavy_rdl`, `kb_swings`, `kb_front_rack_squat`, `slam_ball_slams`, `for_time_kb_chipper`, `emom_hybrid_10`, `amrap_hybrid_10`, `kb_flow_2h_*`, `kb_flow_1h_*` | `glute_bridge_hold`, `hip_thrust_weighted`, `inverted_row`, `db_press`, `zone2_flush`, `deadbug_hold`, `thoracic_openers` |
    | `shoulders` | `weighted_dips`, `bench_dips`, `barbell_z_press`, `barbell_bench_press`, `kb_clean_and_strict_press`, `half_kneeling_kb_press`, `pike_pushups`, `kb_flow_2h_*`, `kb_flow_1h_*` | `barbell_floor_press`, `db_close_grip_press`, `band_pull_aparts`, `glute_bridge_hold`, `deadbug_hold`, `zone2_flush` |
    | `knees` | `barbell_squat`, `barbell_zercher_squat`, `kb_front_rack_squat`, `goblet_squat`, `split_squat`, `box_step_ups`, `speed_rope_intervals`, `emom_hybrid_10`, `amrap_hybrid_10`, `for_time_kb_chipper`, `kb_flow_2h_*`, `kb_flow_1h_*` | `knee_tke`, `glute_bridge_hold`, `hip_thrust_weighted`, `zone2_flush`, `deadbug_hold` |
    | `elbows` | `weighted_dips`, `bench_dips`, `kb_clean_and_strict_press`, `barbell_floor_press`, `narrow_pushups`, `pushups_renegade`, `slam_ball_slams`, `kb_flow_2h_*`, `kb_flow_1h_*` | `glute_bridge_hold`, `hip_thrust_weighted`, `zone2_flush`, `deadbug_hold`, `thoracic_openers` |
    | `wrists` | `pushups_renegade`, `narrow_pushups`, `incline_pushups`, `pike_pushups`, `plank_shoulder_taps`, `weighted_dips`, `bench_dips`, `kb_clean_and_strict_press`, `kb_front_rack_squat`, `barbell_zercher_squat`, `emom_hybrid_10`, `amrap_hybrid_10`, `for_time_kb_chipper`, `kb_flow_2h_*`, `kb_flow_1h_*` | `barbell_floor_press`, `glute_bridge_hold`, `hip_thrust_weighted`, `deadbug_hold`, `zone2_flush` |
    | `ankles` | `speed_rope_intervals`, `box_step_ups`, `farmers_walk`, `kb_suitcase_carry`, `split_squat`, `barbell_squat`, `single_leg_rdl`, `emom_hybrid_10`, `amrap_hybrid_10`, `for_time_kb_chipper`, `kb_flow_2h_*`, `kb_flow_1h_*` | `zone2_flush`, `glute_bridge_hold`, `hip_thrust_weighted`, `deadbug_hold`, `thoracic_openers` |
    *   Route `loadDailyArchetype()`, `generateWorkoutFromGearAndGoal()`, `launchDynamicWorkout()`, Today preview cards, and restored `activeWorkoutPlan` through `applyJointSafeSwaps()`, and remove the redundant overwrite at `js/telemetry.js:1614` (calling `renderCurrentExercise()` instead).
*   Fix `switchTrainView(viewKey)` (`js/workout-verdict.js:882-907`): call `_exitWorkoutFocusMode()` when `viewKey !== 'prescribed'` and scope `.active` removal to `.train-subview-nav .btn-subview`. Skip unparseable activity dates in `computeTodayWorkoutVerdict()` (`:1806`), and `escapeHtml()` user weights / `gearConfig.kb.weight`.

#### 3.3 Inline Timers, `logSet()`, Plate Calculator & Conditioning Logger (`js/workout-catalog.js`, `js/workout-player.js`, `js/workout-timers.js`, `js/workout-verdict.js`)
*   **Inline Timer & Catalog (`js/workout-catalog.js`, `js/workout-player.js`):** Update `js/workout-catalog.js:748` (`db_press` `.replace(/^2\s*[×x]\s*/i, '')`). Preserve `inlineTimerState` across `renderCurrentExercise()` / `renderInlineConditioningPlayer()` on the *same* `ex.id`; call `stopInlineTimer()` inside `finishSession()`, `loadDailyArchetype()`, `resetActiveSession()`, and when switching to a *different* `ex.id`. Capture/restore `<details open>` via `_withPreservedDetails()`, and update `_tickInlineTimerFromClock()` (`js/workout-player.js:781-790`) via arithmetic `(nowMs - lastTickMs)` catchup.
*   **Set Logging & Prescription Authority (`js/workout-player.js:1231, :1902-2080` & `js/workout-verdict.js:220-239`):**
    1. Coerce BOTH `loggedW` and `targetW` via `.replace(/^2\s*[×x]\s*/i, '')` (`:1231, :1905`) so `"2x22.5kg"` parses as `22.5 kg` single-dumbbell mass without doubling `e1RM`.
    2. Define `isBodyweight = (loggedW === 0) || !targetW || targetW <= 0 || /^(body|bw)/i.test(String(ex?.targetWeight || ''))`. Check warmup gate (`targetW > 0 && !isBodyweight && loggedW > 0 && loggedW < 0.75 * targetW`) *before* calling `_renderPrBadgeSlot(false)` (`:1933`): log warmup to `sessionLoggedSets`, post `syncSetToBackend()`, show `"WARMUP SET RECORDED"`, and return early (and inside the async `.then()` at `:1969`, guard `if (res.result.status === 'warmup') return;` before `_renderPrBadgeSlot(...)` and before merging into `pulse_strength_prescriptions`).
    3. On working sets: emit `+1 rep` target copy for `isBodyweight` instead of `+2.5 kg` microload copy; compute `deloadW = Math.min(loggedW, Math.max(2.5, Math.round((loggedW * 0.85) / 2.5) * 2.5))` (`:1974`); set next-exercise cue on `setNum >= ex.setsCount`; guard optimistic PR checks with `priorBest > 0` where `priorBest = Math.max(sumPr, bakedPr, lastE1rm)` (`sumPr = PULSE_ANALYTICS_SUMMARY?.strength_prs?.[exId]?.e1rm`, `bakedPr = BAKED_LIVE_STATE?.strength_prescriptions?.[exId]?.e1rm`, `lastE1rm = existing?.e1rm || existing?.last_e1rm || 0`); increment `window._pulsePrReqSeq` to drop stale async responses; pass `{ force: true }` to `renderStrengthProgressionChart()`.
    4. In `getPrescribedLoad()` (`js/workout-verdict.js:220-239`), compare `Date.parse(rx.last_updated || rx.updated_at || 0)` vs `Date.parse(baked.last_updated || baked.updated_at || 0)`; stamp `last_updated` alongside `updated_at` in `saveEditLoadModal()` (`js/workout-player.js:1825`); and merge `res.result` into `pulse_strength_prescriptions` on `/api/sync_set` success for working sets.
*   **Plate Calculator (`js/workout-player.js:953-1035, :1243`, `barKg = 20`):** Keep `valid: false, belowBar: total > 0 && total < barKg` in `computeBarbellPlatesPerSide()`; render `"Plates: Below 20kg bar"` when `calc.belowBar`; format fractional remainders as `(+${rem}kg/side rem)`; remove `setNum === 1` checks (`:1030, :1243`) so sets 1–4 update `#exPlateCalcRow` on `oninput` and `stepSetInput()`; preserve trailing `kg` on non-`2x` inputs in `stepSetInput()`.
*   **Main Conditioning Timer (`js/workout-timers.js`):** Toggle `.timer-running` / `.timer-paused` classes on `#btnTimerToggle` and reset `#timerPlayIcon` / `#timerPlayText` in `setTimerMode()` and when AMRAP completes (`:355`); invoke `skipRest()` in `finishSession()` only when `restTimerInterval` is active; compute stopwatch catchup in O(1); announce current round/phase via `speak()` + `#inlineTimerPhaseBadge` on inline timer resume; replace obsolete `calculateDailyTargets()` in `logTimerSession()` (`:534`) with `_appendInAppBurnEntry()`, `renderMyNetDiaryEngine()`, `renderTodayTrainingRecommendations()`, and `loadLiveState({ silent: true })` (without overwriting existing `localStorage['pulse_inapp_burn_today']` entries on background refresh).

#### 3.4 Charts & History Hygiene (`js/charts.js`)
*   Normalize `r.timestamp` (`val < 1e11 ? val * 1000 : val`) in both chronological sorting (`:804-805`) and point mapping (`:811`); display fallback card whenever `points.length < 2` (`:824`); coerce `Number(realTail[0].e1rm || baselineE1rm)` (`:1160`).
*   Support both snake_case (`duration_min`, `avg_hr`, `max_hr`, `sub_title`) and camelCase fields in `getGarminHrZoneBreakdown()` and `generateHrSvgChart()` (`:42-45, :90-92`); unify baseline lift weights via `getAllExercises()`; `escapeHtml()` custom activity names/subtitles in `renderHistoryList()` (`:471-512`).

**Phase 3 Checkpoint:** Verify zero JS syntax errors (`node --check`) and pass `tests/test_v61_frontend.js` assertions covering `[object Object]`, Pattern Balance, all 6 injury domains + `20m` complexes + `dumbbells` gear, inline timer preservation, warmup isolation, `"2x"` catalog/UI parsing, Plate Calculator `< 20 kg`/sets 1–4, `escapeHtml()`, and chart normalization.

--------------------------------------------------------------------------------

### Phase 4: Mobile Readability, Contrast & Layout Fixes (`css/styles.css`, `index.html`, `manifest.json`, `js/workout-timers.js`, `js/telemetry.js`, `js/charts.js`, `js/fuel-engine.js`)

#### 4.1 Token Additions & Contrast Remediations (`css/styles.css`, `index.html`, `js/workout-timers.js`, `js/telemetry.js`, `js/charts.js`, `js/fuel-engine.js`)
*   Add CSS tokens & baseline accessibility rules to `css/styles.css`:
    *   `--crimson-text: #fca5a5;`, `--violet-text: #c084fc;`, `input::placeholder, textarea::placeholder { color: var(--text-muted); opacity: 1; }`, `button:disabled, input:disabled { opacity: 0.45; cursor: not-allowed; }`.
    *   `#btnTimerToggle { background: var(--lime); color: #06080e; }`, `#btnTimerToggle.timer-running { background: var(--cyan); color: #06080e; }`, `#btnTimerToggle.timer-paused { background: var(--lime); color: #06080e; }`. Add initial `timer-paused` class on `index.html:503`, and replace all 5 `.style.background` writes in `js/workout-timers.js:284, :324, :391, :412, :431` with `.classList.toggle('timer-running', ...)` / `.classList.toggle('timer-paused', ...)`.
    *   Update ACWR deload text (`js/telemetry.js:2238-2272`), `.injury-rule-card` titles (`js/telemetry.js:1350`), `#telemetryOverrideErr` (`index.html:2133`), `#pulseAuthError` (`index.html:2151`), `.macro-remaining-pill .macro-rem-item.fats` (`css/styles.css:2201`), and `.floating-rest-pill .rest-pill-btn.skip:hover` (`css/styles.css:2168`) to `var(--crimson-text)`.
    *   Switch `.macro-rem-divider` (`css/styles.css:2210`) to `var(--text-muted)` and `Z1` zone color (`js/charts.js:28, :77`) to `'#8b9db5'` (keeping `${z.color}66` / `${z.color}88` CSS valid at `:260, :636`); fix `.pill-dot.green` (`css/styles.css:278`) to `var(--success)`; change `#macroProteinSub` (`index.html:611`) to `var(--text-secondary)`; replace `mealCard.style.opacity = '0.65'` (`js/fuel-engine.js:362`) with `border-color: rgba(139, 157, 181, 0.22)` at `opacity: 1`; switch Body Battery sparkline (`js/telemetry.js:2011, :2032`) to `var(--violet-text)`.

#### 4.2 Rest Pill, Focus Mode, Toast Stacking & Responsive Layout (`css/styles.css`, `index.html`, `manifest.json`, `js/charts.js`, `js/fuel-engine.js`, `js/telemetry.js`)
*   Replace `index.html:2165-2171` with exact class-aligned `.floating-rest-pill` structure:
    ```html
    <div class="floating-rest-pill" id="floatingRestPill">
      <div class="rest-pill-label"><span class="rest-pill-indicator"></span><span id="floatingRestNext">Next</span></div>
      <div class="rest-pill-time"><span id="floatingRestDigits">01:30</span></div>
      <div class="rest-pill-actions"><button type="button" class="rest-pill-btn" onclick="adjustRestTime(30)">+30s</button><button type="button" class="rest-pill-btn skip" onclick="skipRest()">Skip</button></div>
    </div>
    ```
    Enforce `min-height: 36px; padding: 8px 12px;` on `.rest-pill-btn` and `max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center;` below `400 px` on `.floating-rest-pill`.
*   Add `body.workout-focus-mode .app-main { padding-bottom: env(safe-area-inset-bottom, 0px); }` (`css/styles.css:2472`).
*   Desktop (`>= 900 px`): add `.bottom-nav { max-width: 680px; }` inside `@media (min-width: 900px)` and default `max-width: 440px;` on `.modal-card` (`css/styles.css:1787`).
*   Toast layering & interactivity (`css/styles.css:1817-1845`): keep `z-index: 100000; top: calc(56px + env(safe-area-inset-top, 0px)); pointer-events: none;` and style `.toast.show button.toast-action-btn` with `pointer-events: auto; min-height: 32px; padding: 4px 10px;` so interactive `#appToast` actions remain clickable over open modals (`z-index: 9999`).
*   Extract inline grids/bars from `index.html` into CSS classes (`360 px` wrapping without inline specificity overrides):
    *   Assign `.renpho-pillar-grid` (`index.html:248`, `4-col -> repeat(2, 1fr)` under `400 px`), `.archetype-switcher-grid` (`index.html:351`, `4-col -> repeat(2, 1fr)` under `400 px`), `.gear-preset-btns` (`index.html:1121`, removing inline `grid-template-columns:repeat(5, 1fr)`, defaulting `5-col -> repeat(3, 1fr)` under `400 px`), `.fuel-action-bar` (`index.html:522`, `flex-wrap: wrap; gap: 6px;`), `.train-header-row` (`index.html:365`, `flex-wrap: wrap; gap: 8px;`), `@media (max-width: 400px)` `.app-header` (hiding `#headerAthleteSub` and tightening pill padding), and 10-day Fat Floor (`js/fuel-engine.js:732`) `minmax(0, 1fr)`.
*   Lift SVG `<text>` `font-size` inside `js/charts.js` (`generateHrSvgChart()` and `renderRenphoTrendChart()` only) from `7.5–9 px` to `>= 12.5 px` while widening margins (`generateHrSvgChart` `viewBox="0 0 360 130"`: `padL = 42, padT = 26, padB = 28`; Renpho `30-day` `viewBox="0 0 380 180"`: `padL = 50, padR = 54, padT = 24, padB = 28`) so labels do not clip.
*   Remove nested overflow on `.history-scroll-box` (`height: auto; max-height: none; overflow: visible;`); add `id="fuelBaseActiveSub"` (`index.html:539`) updating `"Base <X> + <Y> Active"` and `#fuelCalcDeficit` (`"-350 kcal"` from `liveState.nutrition.deficit ?? 350`) inside `renderMyNetDiaryEngine()`; update `"Completed Log & Benefits (<N>)"` on `#btnTrainHistory` (`index.html:333`) inside `renderHistoryList()`.
*   Cleanse non-fixture PII placeholders in `index.html`: `:933` (`Adult Benchmarks`), `:1466` (`-- g/kg Lean Mass`), `:1631` (`placeholder="Garmin email address"`), and `:1903` (`placeholder="Email or username"`). Bump `?v=6.0` -> `?v=6.1` across `index.html:7-9, :18` + `<script>` tags, bump display label at `index.html:48, :1267` (`v6.0` -> `v6.1`), and bump `manifest.json` icons (`?v=5.15` -> `?v=6.1`). Run `npm run build` (`node build.js`).

**Phase 4 Checkpoint:** Run `npm run build`, inspect minified/GZip sizes (`<= 600 KiB` / `<= 156 KiB`), verify `tests/test_v61_frontend.js` CSS/HTML/contrast/SVG/mobile checks and PII scan (`0` matches).

--------------------------------------------------------------------------------

### Phase 5: Verification Plan

1.  **Build, Static Hygiene & Bundle Budget:**
    *   Run `npm run build`; verify `backend/static/{css,js}` minified bytes `<= 614,400` (`600 KiB`) and GZip level-6 transfer `<= 159,744` (`156 KiB`).
    *   Verify syntax via `node --check` on `js/*.js`, `sw.js`, `build.js`, and `tests/*.js`, plus `.venv/Scripts/python.exe -m py_compile` on `backend/*.py` and `tests/*.py`.
    *   Run PII & credential scan (`Select-String` across `index.html`, `sw.js`, `manifest.json`, `live_state.json`, `backend/live_state.json`, `js/*.js`, `backend/*.py` for `'190\.5|6'\''3"|45yo|97\.70|97\.75|80\.99|81\.03|81\.0|98\.4|99\.85|@.*\.com|GARMIN_TOKENS(?!_JSON)|renpho_creds(?!\.json)'` -> `0` matches).
    *   Inspect `Dockerfile` (`exec uvicorn`, two-stage build) and `.dockerignore` (verifying `backend/*.lock` leaves `package-lock.json` included while excluding tokens, seeds, and host `backend/static/`).
2.  **`v6.1` Backend Suite (`tests/test_v61_backend.py` via `.venv/Scripts/python.exe tests/test_v61_backend.py`):**
    *   *Test Isolation Preamble:* Replicate the pre-import `TemporaryDirectory` setup from `tests/test_v60_backend.py:18-58` (`DATA_DIR`, `LIVE_STATE_PATH`, `GARMIN_TOKEN_DIR`, `MND_TOKEN_DIR`, `PULSE_API_SECRET`) before importing `backend.*` so `backend/data/` is never touched.
    *   *Storage & DB Recovery:* `state_store.get_data_dir()` resolves unset/`""` to `<backend>/data`; no `ARTIFACT_LIVE_STATE_PATH` writes occur; `db.get_connection()` returns raw `sqlite3.Connection` while internal helpers close connections via `closing()`; `db.init_db()` runs via `lifespan`/lazy init; `backend/renpho_seed.json` auto-seed is removed; `os.replace()` retries 3x on `PermissionError`; `.bak` heals missing, 0-byte, and corrupt primary files; recursive `_reject_non_finite_json()` + `422` validation enforce per-route bounds (`(20, 300) kg` scale, `[0, 500] kg` sets).
    *   *Renpho & Time Helpers:* `_insert_renpho_records` converts UTC+08:00 `localCreatedAt` to UK ISO; `get_renpho_history()` averages same-day readings over 7 calendar days; `time_utils.parse_uk_ts()` serves as the single shared parser; `get_workout_sessions()` / `get_manual_activities()` log and skip corrupt `payload_json`.
    *   *Garmin Sync:* Mocked `0.3.2` `display_name` populates on MFA; `oauth_failed_at` clears on re-auth; partial outage retains failed domains and full outage leaves `_last_sync_ts` unchanged; rollover clears `garmin_state['mnd_logged']` & `garmin_state['mnd_meals']` in both sync services; `oauth_last_synced` isolates from `bridge_last_synced`.
    *   *MND & Renpho Syncs:* Leaf `_history_cache_lock` stays deadlock-free; backfill throttles `>= 7200 s` and aborts on auth failure; `preserve_manual=True` protects SQLite and scheduler state; `overwrite_nulls=True` clears only `source == 'mnd_estimated'` columns; 3-way scale precedence holds; socks-on `null` BF% preserves valid LBM or sets all 4 derived fields to `None`; `/api/renpho/manual` handles `None` LBM without error and persists `None` for missing `sinew`/`water`.
    *   *Seeds, Macros & Benefits:* Seeds declare `2092/200/200/55`; `compute_macro_targets()` matches across all 5 strategies (`[15, 65]` Pro Dial via `pro_dial_macros`); `backend/benefits_engine.py` regexes exclude `"kickbox"`->`kb`/`"crunch"`->`run`, prioritize `is_ruck`, omit `99.85 kg` when `weight_kg is None`, and deduplicate muscles.
    *   *Routes, Analytics & Idempotency:* `/api/sync_set` parses `"2x22.5kg"` as `22.5 kg`, logs warmups with `is_warmup=1` without altering `sp` or PR ceilings, and drops `10 kg` deloads to `8.5 kg`; `/api/mnd/manual` runs `_compose_mnd_with_overlays()` vs snapshot `source='manual'`; past-date SQLite routing covers all 5 past-date routes + `mnd_history_cache` update; `/api/garmin/sync` bridge fallback & `/api/{garmin,mnd,renpho}/sync` `502` responses succeed; ACWR/TDEE edge cases and scoped `client_event_id` deduplication across all 5 event-logged routes pass after `422` validation.
3.  **`v6.1` Frontend & Full Regression Suite (`node tests/test_v61_frontend.js`, `node tests/test_v60_frontend.js`, `.venv/Scripts/python.exe tests/test_v60_backend.py`):**
    *   *Rollover, Macros, Queue & Burn:* Midnight rollover clears `garmin.mnd_logged`, resets `nutrition.calorie_target`, and drops prior-date burn; `computeMacroTargets()` matches Python outputs; `pro_dial_macros` syncs via `PULSE_PREF_MAP`; offline queue omits extra keys on `/api/preferences/state`, routes all 9 callers via `_shouldQueueOfflineResponse`, drops non-retryable `4xx`, and fast-aborts on `401`; `mnd_bridge` preserves timestamped `pulse_*_override_obj` and queued `athleteInjuries`; `finishSession()`, `submitManualActivityModal()`, and `logTimerSession()` share array `pulse_inapp_burn_today` (`_act`/`_sess`) without double-counting; `restoreActiveSessionFromLocalStorage()` restores `activeWorkoutPlan` with `0` sets and re-applies `athleteInjuries`.
    *   *Workout Engine, Injuries & Timers:* `[object Object]` resolved; `renderWeeklyPatternBalance()` classifies `barbell_rdl_1` -> `Hinge`; `null` readiness never deloads; `applyJointSafeSwaps()` covers all 6 injury domains + `kb_flow_*` prefixes + `dumbbells` gear prior to slicing; inline timers stop on exercise change and persist on same-`ex.id` re-renders; `logSet()` coerces `"2x"` on both `targetW` & `loggedW`, skips async `_renderPrBadgeSlot` on warmups, and honors `last_updated` prescriptions; `js/workout-catalog.js:748` parses `"2x"`; Plate Calculator handles `< 20 kg` (`belowBar`) and updates sets 1–4.
    *   *UI, Contrast, Charts & SW:* Contrast and UI checks verify `#btnTimerToggle`, `--crimson-text`, `--violet-text`, `.injury-rule-card`, `#telemetryOverrideErr`, `#pulseAuthError`, `.macro-rem-item.fats`, `#appToast` (`z-index: 100000` + clickable `.toast-action-btn`), `.floating-rest-pill` classes (`>= 36 px` + wrap), `switchTrainView('history')` exiting Focus Mode, `<details data-details-key>` survival across polls/`60 s` freshness ticks, `renderSyncFreshnessStrip` summary precedence, `charts.js` `'#8b9db5'` + timestamp normalization + `escapeHtml()` + widened SVG margins, `360 px` extracted CSS classes / `>= 900 px` desktop constraints, and `sw.js` `v6.1` + `/sw.js` bypass + deferred `controllerchange` refresh toast.
    *   *Full Suite Run:* Execute all 4 suites (`.venv/Scripts/python.exe tests/test_v60_backend.py`, `.venv/Scripts/python.exe tests/test_v61_backend.py`, `node tests/test_v60_frontend.js`, `node tests/test_v61_frontend.js`) with zero failures and zero skipped assertions.
