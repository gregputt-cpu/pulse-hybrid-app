# PULSE v6.0 Release — UX Readability, Adaptive Coaching, Cross-Device Sync & Modular Build

*   **Author:** Greg Putt
*   **Status:** Reviewed — Ready for Implementation
*   **Date:** 2026-11-20

--------------------------------------------------------------------------------

## Overview

PULSE v5.38 resolved previously identified data-sync race conditions, authentication gaps, and XSS issues. Release v6.0 delivers four focused upgrades across the existing FastAPI, SQLite, vanilla-JS, and Progressive Web App (PWA) stack:

1. UI contrast compliance, single-handed workout controls, neutral loading states, and per-source sync visibility.
2. Telemetry-driven coaching insights computed from existing workout, nutrition, strength, and scale logs.
3. Conflict-safe cross-device preference synchronization with offline replay.
4. Frontend module splitting, build-time minification, HTTP compression, and immutable asset caching.

## The Problem

Athletes using PULSE encounter four workflow and delivery gaps:

*   **Low-Contrast Tokens and Small Tap Targets:** Several dark-mode foreground tokens (`--text-muted` `#64748b` at `3.74:1` and `--text-dim` `#475569` at `2.35:1` on `#131822` cards) fail WCAG 2.1 AA contrast (`>= 4.5:1` for small text). Positive status badges share the `#00e5ff` primary cyan token with neutral interactive buttons. Set-log controls are `28px` tall without weight/rep steppers, secondary panels clutter the active set view, static HTML flashes old personal values before hydration, and users must open the Sync modal to check when Garmin Connect, Renpho, or MyNetDiary (MND) last pulled data.
*   **Underutilized Historical Telemetry:** PULSE already persists scale weigh-ins (`renpho_history`), strength set records (`strength_logs`), sessions (`workout_sessions`, `manual_activities`), hydration (`hydration_logs`), and nutrition totals (`mnd_history`), but does not track server-side resting biometric history (`sleep_score`, `resting_hr`, `body_battery`), estimate Adaptive TDEE (Total Daily Energy Expenditure), detect live e1RM (estimated 1-rep max) personal records, surface Acute-to-Chronic Workload Ratio (ACWR) fatigue warnings, calculate barbell plate loading per side, or propose 1-tap foods to close daily protein and calorie gaps.
*   **Browser-Local Preference State:** Active goals, custom macro baselines, diet strategy, carb-cycling level, fasting protocol, running fasting timer timestamps, and gym equipment settings exist only in browser `localStorage` or in-memory variables, while backend sync jobs hardcode `2,092 kcal` / `200g protein` defaults and MND scheduled pulls overwrite app-logged meals every 5 minutes.
*   **Unminified Monolith Delivery:** The frontend serves `js/workout-engine.js` (`~371 KB`, 7,201 lines) as one unminified script (`~755 KB` total JS + CSS across the app), FastAPI disables HTTP caching on `.js`/`.css` assets (`no-store`) and omits response compression, and `Dockerfile` overwrites `backend/static/` with unminified root directories during container builds.

## Goals

*   **WCAG 2.1 AA Contrast and Visual Separation:** Raise `--text-muted` to `#8b9db5` (`6.42:1` on `#131822`), move all small text labels off `--text-dim` (`>= 4.5:1`), raise `--text-secondary` to `#cbd5e1` (`11.97:1`), and use `--emerald` / `--success` (`#10b981`, `7.01:1`) exclusively for goal-hit, fresh-sync, logged-set, and PR badges while keeping `--primary` (`#00e5ff`) for interactive accents.
*   **Single-Handed Gym UX and Source Visibility:** Expand set-logging and `+/-` stepper controls to `>= 44px` touch targets arranged to fit `360px` mobile viewports without horizontal overflow, add Focus Mode (hiding secondary navigation/accordions and suppressing duplicate floating rest pills), replace all hardcoded HTML/JS placeholder metrics with neutral `--` / `Pending sync` defaults, and render a 3-source Sync Freshness Strip (Garmin, Renpho, MyNetDiary) on the Today tab.
*   **Data-Backed Coaching Intelligence:** Deliver four telemetry upgrades via `backend/analytics_service.py` (`GET /api/analytics/summary`), live e1RM PR checking on `POST /api/sync_set`, a barbell plate-per-side calculator, and an Evening Macro & Protein Gap Closer backed by additive same-day meal overlay protection across MND background pulls.
*   **Cross-Device Preference Sync:** Persist and merge allowlisted preferences (goal key, custom goal macros, diet strategy, carb-cycling level, fasting protocol, fasting timer state, equipment profile, and conditioning progression) in SQLite `kv_store` with per-field timestamps (`updated_at_ms`), synced nutrition target anchors, and offline-queue fallback.
*   **Modular Build, Container Parity, and Cache Efficiency:** Partition `js/workout-engine.js` into 4 ordered classic scripts by functional ownership, add AST-based `esbuild` non-bundling minification in `build.js`, use a 2-stage `Dockerfile` so container builds match source, register FastAPI `GZipMiddleware` outermost, and reduce JS + CSS payload from `~755 KB` uncompressed to `<= 420 KB` minified on disk and from `~195 KB` gzipped to `<= 140 KB` gzipped over HTTP.

## Non-Goals

*   Encrypting or modifying Garmin Connect / MyNetDiary credential storage (`credentials.json`) or `garth` (Garmin OAuth token library) files (intentionally kept out of scope for credential continuity).
*   Migrating the frontend to React, Vite, TypeScript, or ES Modules (`type="module"`), which would break existing inline HTML handlers, shared global script scope, and Node `vm.runInContext` test harnesses.
*   Replacing SQLite or `live_state.json` with PostgreSQL or Redis.
*   Adding paid external nutrition or LLM APIs, or building native iOS/Android binaries.

## Open Questions

None open. Sparse-data thresholds (TDEE minimum weigh-ins/days/span; ACWR minimum training span), stale sync intervals, and conflict-resolution rules are specified below and return calibration progress counts with `null` estimates when history is sparse.

## Critical User Journeys (CUJs)

### CUJ 1: Active Gym Set Logging with Focus Mode, Plate Calculator, Steppers & PR Badge

*   **Given:** The athlete starts a barbell session (exercises tagged with barbell gear in `workout-player`, excluding dumbbell/kettlebell/bodyweight movements) prescribed at `95kg × 5`, with a stored all-time `e1RM` baseline (`weight * (1 + reps / 30)`) of `110.0 kg`.
*   **When:** The athlete activates **Focus Mode**, reads the plate chip below the target pill (`[20 + 15 + 2.5] kg/side on 20kg bar`), taps `+2.5` twice to adjust weight to `100kg`, and logs `5` reps via the `>= 44px` Log button.
*   **Then:** Non-essential tabs, bottom navigation, and `#floatingRestPill` are hidden while the rest countdown bar pins sticky when active; `logSet()` immediately updates row state, displays the optimistic `NEW e1RM PR` badge (`116.7 kg`), and starts the rest timer; and `POST /api/sync_set` persists the set and reconciles `is_pr: true` when confirmed.

### CUJ 2: Per-Source Sync Freshness Diagnosis on Today Dashboard

*   **Given:** Garmin OAuth synced 12 minutes ago, Renpho cloud polled 20 minutes ago (latest scale weigh-in 2 days ago), and MND last pulled 9 hours ago (`> 360 min` stale threshold).
*   **When:** The athlete opens the Today tab and inspects the Sync Freshness Strip above the Readiness ring.
*   **Then:** Garmin (`12m ago`) and Renpho (`Polled 20m ago • Weighed 2d ago`) show emerald status dots, MND renders an amber stale chip (`9h ago`), tapping Garmin or MND opens the Sync modal to that source's tab, and tapping Renpho opens the Scale Weigh-In modal (`openWeightModal()`).

### CUJ 3: Weekly Adaptive TDEE and ACWR Overreaching Check-In

*   **Given:** Server SQLite tables contain `>= 4` weigh-ins spanning `>= 6` days in the last 14 days and `>= 5` completed prior-day nutrition logs (`>= 800 kcal`, excluding today's partial intake), plus `>= 14` days of training sessions and daily resting biometrics. A second account has 2 days of records.
*   **When:** The frontend fetches `GET /api/analytics/summary` on boot (throttled across polls), and the athlete opens the Body or Today tab.
*   **Then:** The mature account displays estimated maintenance TDEE (OLS weight-slope regression), average prior-day intake, weight trend (`kg/wk`), ACWR (`acute_7d / chronic_weekly_avg` normalized by observed weeks), and an `optimal`, `caution`, or `deload_recommended` status badge (rendering `#todayOverreachBanner` on Today when fatigued). The new account shows `"Calibrating (2/4 weigh-ins, 2/5 fuel days, 1.0/6d span)"` with `null` TDEE and ACWR estimates.

### CUJ 4: 1-Tap Evening Macro & Protein Gap Closer

*   **Given:** Evening totals stand at `1,650 kcal` and `135g protein` against a canonical `2,200 kcal` / `200g protein` budget (`550 kcal` and `65g protein` remaining).
*   **When:** The athlete opens the Fuel tab, inspects the Evening Gap Closer card below `#nutritionQualityAuditCard`, and clicks **Log** on `"0% Greek Yogurt + Whey Isolate"` (`280 kcal`, `46g protein`, `18g carbs`, `3g fat`).
*   **Then:** `myNetDiaryData.meals.snacks` and daily totals update to `1,930 kcal` / `181g protein`, `POST /api/mnd/manual` saves the snack into the date-scoped `app_logged_meals` overlay, and subsequent 5-minute MND scheduled pulls preserve that snack additively unless already synced from MyNetDiary cloud.

### CUJ 5: Cross-Device Preference Sync & Offline Recovery

*   **Given:** On mobile while offline, the athlete switches goal to `aerobic` (queuing the field update in `pulse_offline_write_queue`); concurrently on desktop online, the athlete sets `fasting_protocol` to `18_6`.
*   **When:** Mobile reconnects, flushes the queued per-field patch via `POST /api/preferences/state`, and desktop reloads.
*   **Then:** The backend merges each field independently by its field-level `updated_at_ms` (`200 OK`), keeping mobile's `goal_key: "aerobic"` alongside desktop's `fasting_protocol: "18_6"`, updates backend `nutrition` targets so sync services do not revert to `2,092 kcal`, and both clients hydrate matching UI and macro targets without overwriting queued local changes.

### CUJ 6: Cold Mobile PWA Boot After Modular Split & Minification

*   **Given:** Service Worker `pulse-hybrid-v6.0-20261120` is active, 2-stage Docker/build pipelines serve `esbuild`-minified `?v=6.0` assets into `backend/static/`, and `GZipMiddleware` wraps FastAPI outermost.
*   **When:** Mobile loads `/index.html` over cellular data, later switches to airplane mode, and finally signs out via `POST /api/auth/logout`.
*   **Then:** Boot loads GZip-compressed minified scripts (`<= 156 KB` total JS + CSS transfer) into global scope (`STATIC_ASSETS` Cache-First for `?v=6.0`, Network-First for `/index.html` and `/api/live_state` + `/api/analytics/summary`), operates offline from cache, and purges `/api/*` CacheStorage entries plus sensitive `localStorage` snapshots on logout.

## Technical Plan (Architecture)

```text
+-------------------------------------------------------------------------+
|                        Mobile / Desktop Browser PWA                     |
|  index.html (v6.0) + css/styles.css (WCAG AA tokens + Focus Mode)       |
|  Ordered Classic Scripts:                                               |
|    state.js -> workout-catalog.js -> workout-verdict.js                 |
|    -> workout-player.js -> workout-timers.js                            |
|    -> charts.js -> fuel-engine.js -> telemetry.js                       |
|  Service Worker (sw.js: pulse-hybrid-v6.0-20261120)                     |
+------------------------------------+------------------------------------+
                                     | HTTPS + Cookie v2 Auth + GZip
                                     v
+-------------------------------------------------------------------------+
|                    FastAPI Backend (backend/main.py)                    |
|  GZipMiddleware (outermost) -> api_auth_and_cache_middleware            |
|  Thin HTTP Routes delegating to analytics_service.py & sync services:   |
|  - GET  /api/live_state              - GET  /api/analytics/summary      |
|  - POST /api/mnd/manual (+overlay)   - GET/POST /api/preferences/state  |
|  - /api/garmin|renpho|mnd/sync       - POST /api/sync_set (+is_pr)      |
+------------------+----------------------------------+-------------------+
                   |                                  |
                   v                                  v
+----------------------------------+  +-----------------------------------+
| JSON Store (live_state.json+.bak)|  | SQLite WAL (backend/db.py)        |
| - active telemetry & meals       |  | - renpho_history & strength_logs  |
| - app_logged_meals (by date)     |  | - workout_sessions                |
| - strength_prescriptions         |  | - manual_activities               |
| - locked via state_store         |  | - daily_biometrics                |
|                                  |  | - daily_nutrition_logs            |
|                                  |  | - hydration_logs                  |
|                                  |  | - kv_store (client_preferences_v1)|
+----------------------------------+  +-----------------------------------+
```

### Architectural Components & Responsibilities

1. **Analytics & Historical Stores (`backend/db.py`, `backend/analytics_service.py`, `backend/main.py`):**
   *   **Daily Biometrics & Nutrition Logs:** Additive SQLite tables (`daily_biometrics` and `daily_nutrition_logs`) record resting HR, sleep score, body battery, readiness, and completed daily nutrition totals whenever Garmin, Renpho, or MND syncs or manual entries run—preserving history across midnight `.pop()` cleanups and `10d` `mnd_history_cache.json` caps.
   *   **Adaptive TDEE & ACWR Engine:** Isolated in `backend/analytics_service.py` and exposed on `GET /api/analytics/summary`. Adaptive TDEE uses linear regression (OLS) over 14-day Renpho weigh-ins paired against completed prior days (`date < today`) in `daily_nutrition_logs`. ACWR aggregates distinct workout sessions across `workout_sessions`, `manual_activities`, and non-bridge `garmin.recent_activities`, normalizing chronic weekly load by actual observed history span (`2–4` weeks) and cross-checking 7d resting biometric deltas from `daily_biometrics`.
   *   **Independent Source Freshness:** Garmin (`garmin.last_synced` + `garmin_sync_mode`), Renpho (`renpho.last_checked` poll timestamp distinct from `renpho.last_synced` weigh-in timestamp), and MND (`mnd_logged.last_pulled` / `mnd_last_synced`, with no fallback to generic `state["last_synced"]`) are reported as tz-aware `Europe/London` ages and staleness flags.
   *   **Live e1RM PR Checking:** `POST /api/sync_set` compares incoming weighted sets against `max(db.strength_logs, strength_prescriptions baseline)` before insertion and returns deterministic `is_pr`, `prev_best_e1rm`, and `e1rm` fields while guarding against invalid/typo outliers.

2. **Cross-Device Preference Authority & MND Meal Overlay (`backend/analytics_service.py`, `backend/mnd_sync_service.py`, `js/state.js`):**
   *   `client_preferences_v1` in SQLite `kv_store` uses **per-field** `{ value, updated_at_ms }` reconciliation for allowlisted settings (`goal_key`, `custom_goal_macros`, `diet_strategy`, `carb_cycle_level`, `fasting_protocol`, `fasting_timer_state`, `equipment_profile`, `conditioning_progression`), returning `200 OK` with server-merged canonical values so offline replay queues never stall on `409`. Append-only conditioning workout history remains on `/api/sync_activity` + `/api/sync_session`.
   *   Synced goal calorie/protein anchors write through to `state["nutrition"]` so MND/Garmin scheduled jobs respect the active goal (`aerobic`, `pushups`, `rdl`, `work_capacity`, `custom`, `recomp`).
   *   Same-day manual meals (`POST /api/mnd/manual` and Gap Closer snacks) persist in a date-scoped `app_logged_meals` map merged additively across 5-minute MND pulls unless already matched in cloud MND items.

3. **Gym-Floor UI, Contrast & Feature Modules (`css/styles.css`, `index.html`, `js/workout-*.js`, `js/fuel-engine.js`, `js/telemetry.js`):**
   *   CSS updates raise `--text-secondary` (`#cbd5e1`) and `--text-muted` (`#8b9db5`) above `4.5:1` AA on card and base surfaces, preserve `--emerald` (`#10b981`) for semantic positive badges (`--success`), switch small `#475569` text spans in `index.html` to `--text-muted`, and neutralize all hardcoded HTML/JS placeholders (`id="coachBriefingBody"` added, `window.athleteProfile` anonymized).
   *   Workout Player renders stacked responsive set rows (`>= 44px` Log and `+/-` stepper buttons fitting `360px` viewports), barbell plate chips gated via `requiredGear` (`>= 20kg`, excluding DB/KB/BW), optimistic synchronous PR display with async reconciliation, and Focus Mode (hiding `.bottom-nav`, secondary accordions, and `#floatingRestPill` while pinning `.rest-bar-box` during active rest).
   *   Fuel Tab renders `#macroGapCloserCard` with 10 static whole-food/supplement combos filtered to remaining calorie/protein targets using a shared `_appendSnackAndSync()` helper.
   *   Telemetry controller (`js/telemetry.js`) renders the Freshness Strip, Adaptive TDEE card, ACWR card, and `#todayOverreachBanner`, eliminates redundant 2-minute chart/Renpho boot fetches, and handles `{ fromBoot: true }` guards across preference hydration.

4. **Module Split, Build Pipeline & Caching (`js/workout-*.js`, `build.js`, `Dockerfile`, `sw.js`, `backend/main.py`):**
   *   `js/workout-engine.js` splits by domain responsibility into 4 ordered classic scripts (`workout-catalog.js`, `workout-verdict.js`, `workout-player.js`, `workout-timers.js`), relocating shell modals (`saveManualWeight`, `openQuickSettingsModal`, telemetry override configs) into `js/telemetry.js`.
   *   `build.js` cleans target `css/` and `js/` directories, excludes `README.md` and `live_state.json`, and minifies assets with non-bundling `esbuild.transformSync`. A 2-stage `Dockerfile` executes `npm run build` during container builds so Railway and Vercel stay synchronized.
   *   FastAPI serves `?v=6.0` JS/CSS with long-lived immutable cache headers + `GZipMiddleware` (keeping HTML, `sw.js`, and `/api/*` at `no-store`); `sw.js` (`pulse-hybrid-v6.0-20261120`) uses Cache-First for `STATIC_ASSETS`, Network-First for HTML and `/api/live_state` + `/api/analytics/summary`, skips caching mutable `/api/preferences/state`, and clears cached `/api/*` data + telemetry snapshots on logout/`401`.

## Alternatives Considered

### Alternative A: Client-Side Analytics Computation Across Existing History Endpoints

*   **Pros:** No new backend summary endpoint required.
*   **Cons:** Forces mobile clients to pull multiple 14–30 day history payloads on boot, leaves resting biometric trends unavailable across devices, and duplicates OLS/ACWR sparse-data guards in browser JS.
*   **Reason for Rejection:** Computing longitudinal analytics in `backend/analytics_service.py` under one `GET /api/analytics/summary` route avoids repeated client downloads and produces identical results across devices.

### Alternative B: Normalized Relational Tables Per Preference Field

*   **Pros:** Column-level SQL schema constraints per setting.
*   **Cons:** Adds multiple schema migrations and CRUD routes for low-churn key-value settings.
*   **Reason for Rejection:** Reusing SQLite `kv_store` (`client_preferences_v1`) with Pydantic allowlisting and a 64 KB payload limit handles structured preference maps with minimal backend surface area.

### Alternative C: Whole-Document LWW Timestamp vs. Per-Field Timestamp Reconciliation for `client_preferences_v1`

*   **Pros:** Simpler single integer comparison on the server.
*   **Cons:** Overwrites unrelated settings across offline/online devices (e.g., an offline equipment toggle overwritten by a newer goal change, or vice versa) and stalls `flushOfflineQueue()` if rejected with `409`.
*   **Reason for Rejection:** Per-field `{ value, updated_at_ms }` merging inside `kv_store` plus HTTP `200` canonical merge responses eliminates cross-domain data loss and queue deadlocks with negligible JSON overhead.

### Alternative D: Direct Write-Through on `/api/mnd/manual` Without Meal Overlay vs. Date-Scoped `app_logged_meals` Overlay

*   **Pros:** No extra reconciliation code in `mnd_sync_service.py`.
*   **Cons:** APScheduler executes read-only `mnd_service.fetch_today_data()` every 5 minutes and overwrites `mnd_logged`/`mnd_meals`, erasing Gap Closer or Quick Log entries before the user finishes their day.
*   **Reason for Rejection:** Maintaining a date-scoped `app_logged_meals` overlay re-applied additively across MND pulls (until matching items sync from MND cloud) prevents silent data loss without breaking MND cloud pulls.

### Alternative E: Relying on `live_state.json` Pruning vs. Additive SQLite History Tables for Biometrics & Nutrition

*   **Pros:** Zero new SQLite tables in `backend/db.py`.
*   **Cons:** `garmin_sync_service.py` and `mnd_sync_service.py` purge prior-day biometrics at midnight rollover, and `mnd_history_cache.json` caps at 10 days (with `/tmp` fallback) while ignoring `/api/mnd/manual`.
*   **Reason for Rejection:** Adding lightweight `daily_biometrics` and `daily_nutrition_logs` tables in SQLite provides durable 28-day storage for both automated syncs and manual logs.

### Alternative F: ES Modules (`type="module"`) + Vite/Webpack Rewrite vs. Ordered Classic Script Split + `esbuild.transformSync`

*   **Pros:** Native module bundling and tree-shaking.
*   **Cons:** Breaks existing HTML `onclick="..."` handlers, global `window` script contracts, and `vm.runInContext` test suites without rewriting the UI layer.
*   **Reason for Rejection:** Splitting `js/workout-engine.js` into 4 ordered classic scripts and applying non-bundling `esbuild.transformSync` reaches the `<= 140 KB` gzipped target without rewriting HTML bindings or test runners.

### Alternative G: Custom Regex Minifier vs. `esbuild` Build Dependency

*   **Pros:** Zero `package.json` `devDependencies`.
*   **Cons:** Regex strippers risk breaking template literals, regular-expression literals, URLs, and automatic semicolon insertion across JS files.
*   **Reason for Rejection:** Using `esbuild` solely as a build-time devDependency (with copy fallback when absent) provides AST-level minification without adding runtime dependencies.

### Alternative H: Replacing Electric Cyber Blue Theme with Electric Lime (`#30D158`)

*   **Pros:** Matches an earlier standalone theme draft (`full_update_and_colour_spec.md`).
*   **Cons:** Requires replacing `#00e5ff` SVG gradients, dials, and borders across shipped `v5.x` components.
*   **Reason for Rejection:** Preserving `#00e5ff` as `--primary` while isolating `#10b981` (`--emerald` / `--success`) for positive completion/PR/freshness states resolves color ambiguity with lower UI churn.

--------------------------------------------------------------------------------

## Risks & Mitigations

| Risk / Failure Mode | Impact | Mitigation in v6.0 |
| :--- | :--- | :--- |
| **APScheduler 5-min MND pull overwrites Gap Closer / Quick Log meals** | Logged evening protein/calorie items disappear within 5 minutes. | Persist PULSE additions in date-scoped `app_logged_meals`; `mnd_sync_service.py` merges unmatched same-day overlay items after every MND pull. |
| **ACWR false deload alarms on days 14–27 or timer double-counting** | Early-stage or timer-heavy athletes receive false deload warnings. | Normalize chronic weekly load by `min(28.0, max(14.0, span_days)) / 7.0`, exclude `"Daily Steps & Movement"` bridge entries, and deduplicate overlapping timer/`manual_activities`/`recent_activities` sessions. |
| **Sparse-data / same-day partial MND intake skewing Adaptive TDEE** | Incomplete afternoon meals or 6-day water swings produce noisy TDEE estimates. | Exclude today's date (`date < today_str`), average multiple same-day weigh-ins prior to OLS slope regression, require `>= 4` weigh-ins / `>= 6d` span / `>= 5` fuel days, and clamp estimates to `[1400, 4500]` kcal. |
| **Device clock skew & boot overwrite during cross-device preference sync** | Offline edits rejected or overwritten on boot. | Use per-field `{ value, updated_at_ms }` reconciliation (`>=` accepts equal/newer), skip overwriting locally queued fields during boot hydration, return `200 OK` on merges, and apply `{ fromBoot: true }` guards to all boot initializers. |
| **Stale `backend/static/` assets in Railway container or offline cache leak** | Docker serves outdated JS/CSS or retains `/api/*` health data after logout. | 2-stage `Dockerfile` executes `npm run build` inside Stage 1; logout and `401` handlers purge CacheStorage `/api/*` entries and cached telemetry keys in `localStorage`. |
| **Global scope TDZ errors or stale hardcoded placeholders across split files** | Missing handler on `onclick` or flash of old metrics. | Order classic scripts deterministically (`state -> workout-catalog -> workout-verdict -> workout-player -> workout-timers -> charts -> fuel-engine -> telemetry`), verify zero parse-time cross-script calls, and purge all hardcoded HTML/JS baselines in favor of `--`. |

--------------------------------------------------------------------------------

## Non-Functional Requirements

### Security & Privacy

*   **Auth Boundary:** `GET /api/analytics/summary`, `GET /api/preferences/state`, and `POST /api/preferences/state` live under `/api/` and are protected by `api_auth_and_cache_middleware` (`v2` HMAC cookie / `PULSE_API_SECRET`).
*   **Input Validation & Storage Bounds:** `/api/preferences/state` enforces a 64 KB cap (`_validate_payload_size`), Pydantic `extra="forbid"` allowlisted preference keys, string length limits (`<= 40` chars on enum keys), and sanity bounds on weight logging (`<= 500 kg` for live PR records).
*   **XSS, Cache Logout Purge & Seed Hygiene:** Dynamic food names, exercise titles, and PR banners pass through `escapeHtml()` / `escapeAttr()`. `sw.js` skips caching mutable `/api/preferences/state`, and client logout (`logoutPulseSession` / `401`) purges CacheStorage `/api/*` responses plus `pulse_cached_live_state` / `pulse_analytics_summary_cache`. Static `live_state.json` exclusion in `build.js` stays active to exclude personal metrics from public static bundles.

### Accessibility (WCAG 2.1 AA)

Contrast ratios measured across both card surface `#131822` and base surface `#0c1017`:

| Token | v5.38 Hex | v6.0 Hex | Ratio on `#0c1017` | Ratio on `#131822` | Usage & Target Standard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text` | `#ffffff` | `#ffffff` | **19.05:1** | **17.77:1** | Primary headings & values (WCAG AAA) |
| `--text-secondary` | `#94a3b8` | `#cbd5e1` | **12.83:1** | **11.97:1** | Body prose & secondary labels (WCAG AAA) |
| `--text-muted` | `#64748b` (FAIL `4.00/3.74`) | `#8b9db5` | **6.88:1** | **6.42:1** | Micro labels, units, metadata (WCAG AA `>= 4.5:1`) |
| `--text-dim` | `#475569` (FAIL `2.51/2.35`) | `#64748b` | **4.00:1** | **3.74:1** | Non-text UI dividers & structural borders only (`>= 3:1`) |
| `--primary` | `#00e5ff` | `#00e5ff` | **12.39:1** | **11.56:1** | Primary interactive controls (`13.65:1` black-on-cyan) |
| `--emerald` / `--success` | `#10b981` | `#10b981` | **7.51:1** | **7.01:1** | PR badges, fresh indicators, goal-hit pills (`8.28:1` black-on-emerald) |

*   All active set-logging buttons, `+/-` steppers, and Focus Mode toggle buttons enforce `min-height: 44px` with `>= 8px` inter-button spacing inside a responsive layout fitting `360px` mobile screens without horizontal overflow.

### Performance & Latency

*   `GET /api/analytics/summary` executes batched SQLite reads inside a single connection context (`< 80ms` p95 for up to 50,000 rows).
*   Frontend Payload Targets:
    *   **Uncompressed JS + CSS:** `781 KB` raw (v5.38) / `844 KB` raw (v6.0) → `<= 600 KB` minified on disk (v6.0, `>= 30%` reduction before compression while preserving non-bundled classic scripts).
    *   **GZip HTTP Transfer:** `188 KB` gzipped unminified (v6.0 raw) → `<= 156 KB` gzipped minified (v6.0, `>= 81%` reduction vs uncompressed raw and `>= 17%` vs unminified gzipped).
    *   Versioned `?v=6.0` CSS/JS assets use immutable browser + SW caching so returning boots avoid re-downloading unchanged scripts.

### Rollout & Rollback

*   Additive SQLite tables (`daily_biometrics`, `daily_nutrition_logs`), optional JSON fields (`app_logged_meals`, `renpho.last_checked`), and `kv_store` key (`client_preferences_v1`) require zero destructive table migrations.
*   Rolling back to `v5.38` restores prior application code without database repair (`client_preferences_v1`, `daily_biometrics`, `daily_nutrition_logs`, and `mnd_last_synced` remain inert in storage).

--------------------------------------------------------------------------------

### Additional Resources

*   Prior design reference (palette context): [full_update_and_colour_spec.md](./full_update_and_colour_spec.md)
*   Backend persistence & API: [backend/db.py](../../backend/db.py), [backend/main.py](../../backend/main.py)
*   Build, container & SW: [build.js](../../build.js), [Dockerfile](../../Dockerfile), [sw.js](../../sw.js)
*   Core frontend modules: [js/state.js](../../js/state.js), [js/workout-engine.js](../../js/workout-engine.js), [js/fuel-engine.js](../../js/fuel-engine.js), [js/telemetry.js](../../js/telemetry.js), [js/charts.js](../../js/charts.js)

--------------------------------------------------------------------------------

## Detailed Implementation Plan

All schemas, file boundaries, API contracts, edge cases, and tests are specified below. Execute Phases 1–5 strictly in order within the listed Target Scope.

### Target Scope & File Boundary

*   **Create:**
    *   `backend/analytics_service.py` (Adaptive TDEE, ACWR overreaching, source freshness, per-field preference merge)
    *   `js/workout-catalog.js` (activities store, `parseRestSeconds`, custom/swap/hide library, `masterExercises`, `todayWorkoutOptions`)
    *   `js/workout-verdict.js` (`getPrescribedLoad`, equipment profile/gear modal handlers, 48h rotation, weekly balance, forecast, verdict, `loadDailyArchetype`, `launchDynamicWorkout`)
    *   `js/workout-player.js` (inline conditioning progression/player, `renderCurrentExercise`, plate calculator, `stepSetInput`, Focus Mode toggle, modals, `logSet` + PR reconciliation)
    *   `js/workout-timers.js` (wall-clock rest/main/inline timers, `finishSession`, `switchTab` Focus Mode reset, timer catch-up `visibilitychange` hook, window exports)
    *   `.dockerignore` (exclude `.git/`, `.venv/`, `node_modules/`, `backend/data/`, `*.db*`, `tests/`)
    *   `tests/test_v60_backend.py` (automated backend verification suite)
    *   `tests/test_v60_frontend.js` (automated Node `vm` verification suite)
*   **Modify:**
    *   `backend/db.py`
    *   `backend/garmin_sync_service.py`
    *   `backend/mnd_sync_service.py`
    *   `backend/renpho_sync_service.py`
    *   `backend/main.py`
    *   `package.json`, `package-lock.json`
    *   `.gitignore`
    *   `build.js`
    *   `Dockerfile`
    *   `sw.js`
    *   `css/styles.css`
    *   `index.html`
    *   `js/state.js`
    *   `js/fuel-engine.js`
    *   `js/charts.js`
    *   `js/telemetry.js`
    *   Build output mirror directories regenerated by `npm run build`: `backend/static/*`, `dist/*`, `public/*`, `.vercel/output/static/*`
    *   Existing verification harnesses (for modular script paths): `C:/Users/Greg/.gemini/antigravity/brain/edad9b97-644d-4c24-b483-7fc125c27d21/scratch/verify_pwa_v535.js`, `C:/Users/Greg/.gemini/antigravity/brain/edad9b97-644d-4c24-b483-7fc125c27d21/scratch/test_tiers12_frontend.js`, `C:/Users/Greg/.gemini/antigravity/brain/edad9b97-644d-4c24-b483-7fc125c27d21/scratch/test_tiers12_backend.py`, and `C:/Users/Greg/.gemini/antigravity/brain/edad9b97-644d-4c24-b483-7fc125c27d21/scratch/test_sync_rollover.py`
*   **Delete:**
    *   `js/workout-engine.js` (plus stale legacy copies in build output directories via `build.js`)

---

### Phase 1: Backend Persistence, Analytics Service, Meal Overlay, Live PRs & Per-Field Preference Sync

#### 1.1 `backend/db.py` (Modify)
*   **Proposed Changes:**
    1. In `_init_db_unlocked()`, add two additive tables with indexes:
       *   `daily_biometrics (date_str TEXT PRIMARY KEY, sleep_score INTEGER, resting_hr INTEGER, body_battery INTEGER, training_readiness INTEGER, source TEXT, updated_at TEXT)`
       *   `daily_nutrition_logs (date_str TEXT PRIMARY KEY, calories INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER, source TEXT, updated_at TEXT)`
    2. Add read/write helpers reusing `get_connection()`:
       *   `upsert_daily_biometrics(date_str: str, sleep_score: Optional[int] = None, resting_hr: Optional[int] = None, body_battery: Optional[int] = None, training_readiness: Optional[int] = None, source: str = "garmin") -> None` (merges non-`None` columns via `COALESCE(excluded.col, daily_biometrics.col)`).
       *   `upsert_daily_nutrition(date_str: str, calories: int, protein_g: int, carbs_g: int, fat_g: int, source: str = "mnd") -> None`.
       *   `get_daily_biometrics(days: int = 28) -> List[Dict[str, Any]]` and `get_daily_nutrition(days: int = 21) -> List[Dict[str, Any]]` sorted `date_str ASC`.
       *   `get_workout_sessions(days: int = 35) -> List[Dict[str, Any]]`: Reads rows from `workout_sessions`, parses `timestamp` in Python (`datetime.fromisoformat`, normalizing naive strings to `Europe/London` and handling trailing `Z` as UTC converted to `Europe/London`), filters in Python to `uk_now() - timedelta(days=days)`, and returns dicts with `id`, `date_str` (`YYYY-MM-DD` UK), `timestamp`, `preset`, `goal`, `exercises_completed`, `sets_logged`, `calories`, and `payload` (defaulting invalid JSON in `payload_json` to `{}`).
       *   `get_manual_activities(days: int = 35) -> List[Dict[str, Any]]`: Same Python timezone-normalized filter over `manual_activities`, returning `id`, `date_str`, `timestamp`, `name`, `duration_min`, `calories`, and `payload` (`{}` fallback).
       *   `get_strength_pr_map() -> Dict[str, Dict[str, Any]]`: Queries `strength_logs` where `weight > 0 AND reps > 0 AND e1rm IS NOT NULL AND e1rm > 0`, selecting highest `e1rm` per `exercise_id` (tie-breaking on latest `id DESC`).
       *   `get_exercise_best_e1rm(exercise_id: str) -> Optional[float]`: Returns `MAX(e1rm)` from `strength_logs` for `exercise_id` where `weight > 0 AND reps > 0 AND e1rm > 0`.

#### 1.2 Sync Services Timestamp & History Updates (`backend/garmin_sync_service.py`, `backend/mnd_sync_service.py`, `backend/renpho_sync_service.py`) (Modify)
*   **Proposed Changes:**
    1. **`backend/garmin_sync_service.py`:** Inside locked live-state save, set `garmin_state["last_synced"] = now_london_iso`, `garmin_state["garmin_sync_mode"] = "oauth"`, read active calorie/protein target anchors from `state.get("nutrition", {})` (`base_calorie_target` / `base_protein_target_g`, defaulting `2092` / `200` when unset) instead of unconditionally resetting non-`recomp` goals to `2092`, and call `db.upsert_daily_biometrics(target_date_str, sleep_score=..., resting_hr=..., body_battery=..., training_readiness=..., source="garmin_oauth")`.
    2. **`backend/renpho_sync_service.py`:** Record `renpho["last_checked"] = uk_now().isoformat()` on every `sync_latest()` check (even when no newer scale weigh-in exists), preserving weigh-in measurement timestamp in `renpho["last_synced"]`.
    3. **`backend/mnd_sync_service.py`:**
       *   In `fetch_today_data()` / `_schedule_history_backfill()`, hydrate up to 14 days from `mnd_history_cache.json` and call `db.upsert_daily_nutrition(...)` for each fetched historical date plus today.
       *   In `_update_live_state_locked()`: set `state["mnd_last_synced"] = uk_now().isoformat()`; preserve `garmin_sync_mode = "mnd_bridge"` without overwriting `garmin.last_synced` when falling back to bridge metrics; compute nutrition targets from `base_calorie_target` / `base_protein_target_g` when present; and **reconcile `state.get("app_logged_meals", {}).get(today_str, [])` additively**: for each app-logged meal item whose signature (`normalized_name + round(cals) + round(p)`) does not already appear in fetched cloud `mnd_meals[cat].items`, append it to `meals[cat].items` and add its `calories`, `protein`, `carbs`, `fat` onto `totals` and `meals[cat]`. Prune `app_logged_meals` keys older than `yesterday` before saving.

#### 1.3 `backend/analytics_service.py` (Create)
*   **Proposed Changes:**
    1. `parse_uk_datetime(ts_str: Optional[str]) -> Optional[datetime]`: Parses ISO-8601 (`Z` or `+HH:MM`), or `%Y-%m-%d %H:%M:%S` / `%Y-%m-%d`, returning `Europe/London` tz-aware `datetime` (or `None`).
    2. `compute_sync_freshness(state: Dict[str, Any], now_uk: Optional[datetime] = None) -> Dict[str, Any]`:
       *   `garmin`: reads `state["garmin"].get("last_synced")` (plus `mode = state["garmin"].get("garmin_sync_mode") or state["garmin"].get("source")`), stale threshold `180` minutes.
       *   `renpho`: reads `poll_ts = state["renpho"].get("last_checked")` (null if never checked via `sync_latest`) with stale threshold `720` minutes (12h), alongside `weigh_in_at = state["renpho"].get("last_synced")` and `weigh_in_age_hours`.
       *   `mnd`: reads `state.get("mnd_last_synced") or (state.get("mnd_logged") or {}).get("last_pulled")` — **no** fallback to top-level `state["last_synced"]` — stale threshold `360` minutes.
       *   Clamp `age_minutes = max(0, int((now_uk - dt).total_seconds() // 60))`. Each entry returns `{ "last_synced": ..., "age_minutes": ..., "stale": bool }`.
    3. `compute_adaptive_tdee(state: Dict[str, Any], renpho_rows: List[Dict[str, Any]], nutrition_rows: List[Dict[str, Any]], today_str: str) -> Dict[str, Any]`:
       *   Group valid 14-day weigh-ins (`timestamp` within `[today - 14d, today]`, `weight_kg > 0`) by `YYYY-MM-DD` (UK date) taking each day's average `weight_kg`. Compute `weigh_ins_count = len(daily_weights)` and `span_days = (max_date - min_date).days` (`0` if `< 2` days).
       *   Combine `nutrition_rows` and `state.get("mnd_history", {}).get("days", [])` (deduped by date, SQLite row prioritized when present), keeping **completed prior days only** (`date_str < today_str` and `date_str >= min_renpho_date - 2d` and `calories >= 800`) up to last 14 unique dates.
       *   If `weigh_ins_count < 4` or `span_days < 6` or `len(valid_fuel_days) < 5`: return `{"status": "insufficient_data", "weigh_ins_count": weigh_ins_count, "weigh_ins_required": 4, "fuel_days_count": len(valid_fuel_days), "fuel_days_required": 5, "span_days": span_days, "span_days_required": 6, "estimated_tdee": None, "avg_intake_kcal": None, "weight_trend_kg_per_week": None, "recommended_recomp_target": None}`.
       *   Compute OLS linear regression over `x_i = (date_i - min_date).days`, `y_i = daily_weight_kg`. Guard zero `x` variance (`sum((x - mean_x)^2) == 0`) by returning `insufficient_data`. Compute `avg_intake_kcal = round(mean(valid_fuel_days))`, `raw_tdee = avg_intake_kcal - (slope * 7700.0)`, `estimated_tdee = int(round(max(1400.0, min(4500.0, raw_tdee))))`, and return `status: "ready"` including all count/span/slope/target fields (`recommended_recomp_target = max(1500, estimated_tdee - 350)`).
    4. `compute_acwr_overreaching(state: Dict[str, Any], sessions: List[Dict[str, Any]], manual_acts: List[Dict[str, Any]], bio_rows: List[Dict[str, Any]], today_str: str) -> Dict[str, Any]`:
       *   Collect workout load records across `sessions`, `manual_acts`, and `state.get("garmin", {}).get("recent_activities", [])`.
       *   Filter out synthetic bridge step summaries (`source == "garmin_via_mnd_bridge"` and `"daily steps"` in `name.lower()`).
       *   Compute session load as `float(calories)` when `> 0`, else `float(duration_min) * 6.0`. Deduplicate double-writes by grouping sessions sharing the same UK `date_str` when `abs(cal_a - cal_b) <= 15` and timestamps (when parseable) are within 120 minutes, keeping Garmin HR-derived calories when present (preserving distinct same-day workouts such as morning run + evening lifting).
       *   Determine `min_act_date` across loaded activities; compute `span_days = (today_date - min_act_date).days` (or `0` if empty). Sum `acute_7d` over `(today - 6d .. today)` and `total_28d` over `(today - 27d .. today)`. Compute `effective_weeks = min(28.0, max(14.0, float(span_days))) / 7.0` and `chronic_weekly_avg = total_28d / effective_weeks`.
       *   If `span_days < 14` or `chronic_weekly_avg <= 0`: return `status: "calibrating"`, `acwr: None`, `acute_7d_load`, `chronic_weekly_avg`, `span_days`, `reason: "Requires 14+ days of workout history to establish an ACWR baseline."`.
       *   Compute `acwr = round(acute_7d / chronic_weekly_avg, 2)`. Cross-check latest resting telemetry (`sleep_score`, `body_battery`, `resting_hr` compared against baseline mean over prior `bio_rows` when `len >= 5`, using `is not None` guards: fatigued if `sleep_score is not None and sleep_score < 68` or `body_battery is not None and body_battery < 35` or `(resting_hr is not None and baseline_rhr is not None and resting_hr >= baseline_rhr + 4)`).
       *   Emit `deload_recommended` (`acwr >= 1.45` or (`acwr >= 1.30` and fatigued), `reason: "7-day training load spiked well above your 28-day baseline with recovery strain markers; prioritize recovery or Zone 2 flush."`), `caution` (`acwr >= 1.25`, `reason: "7-day workload is climbing rapidly above chronic capacity; monitor sleep and bar speed closely."`), or `optimal` (`reason: "Training load is within the productive progression corridor."`).
    5. `build_analytics_summary(state: Dict[str, Any]) -> Dict[str, Any]`: Reads `renpho_history(21)`, `workout_sessions(35)`, `manual_activities(35)`, `daily_nutrition(21)`, `daily_biometrics(28)`, and `strength_pr_map` using one shared database connection batch; floors `strength_prs` with `state.get("strength_prescriptions", {})` numeric `e1rm` baselines; returns `{ "adaptive_tdee": ..., "overreaching": ..., "sync_freshness": ..., "strength_prs": ..., "renpho_history_30d_hint": ... }`.
    6. `merge_preferences_v1(stored: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]`:
       *   Expects top-level `"fields": { key: { "value": ..., "updated_at_ms": int } }` for allowlisted keys (`goal_key`, `custom_goal_macros`, `diet_strategy`, `carb_cycle_level`, `fasting_protocol`, `fasting_timer_state`, `equipment_profile`, `conditioning_progression`). Coerces absent `updated_at_ms` to `0` (`now_ms` when incoming lacks it). For each field in `incoming.fields`: compares `int(inc_ts or 0) >= int(srv_ts or 0)` — accepts newer or equal per field and preserves newer server values independently for all other fields, tracking `field_resolutions: { key: "accepted" | "server_newer" }`. Computes aggregate `updated_at_ms = max(all field timestamps)`. Returns merged document + `field_resolutions`.

#### 1.4 `backend/main.py` (Modify)
*   **Proposed Changes:**
    1. Register `app.add_middleware(GZipMiddleware, minimum_size=500)` **after** `@app.middleware("http") def api_auth_and_cache_middleware(...)` (so `GZipMiddleware` executes outermost in Starlette LIFO order). Inside `api_auth_and_cache_middleware`, when `path.startswith(("/css/", "/js/"))` and `"v" in request.query_params`, set `Cache-Control: public, max-age=31536000, immutable` instead of `no-store`; keep `/`, `.html`, `sw.js`, `.json`, and `/api/*` at `no-cache, no-store, must-revalidate`.
    2. In `manual_mnd_entry()` (`POST /api/mnd/manual`): reuse `now_uk` to set `state["mnd_last_synced"] = now_uk.isoformat()`; accept optional `payload.logged_item` (or `meal_category` + item dict) to append into `state.setdefault("app_logged_meals", {}).setdefault(date_str, [])`; compute calorie/protein targets using synced `base_calorie_target` / `base_protein_target_g`; and call `db.upsert_daily_nutrition(date_str, cals, prot, carbs, fat, source="manual")`.
    3. In `sync_set()` (`POST /api/sync_set`): unconditionally initialize `sp["is_pr"] = False` and `sp["prev_best_e1rm"] = None` before numeric parsing; only when `w is not None and r is not None and 0 < w <= 500 and r > 0`: query `db_best = db.get_exercise_best_e1rm(payload.exercise_id)`, set `prev_best_e1rm = max(v for v in (db_best, sp.get("e1rm")) if v is not None)` when any prior baseline exists, compute `is_pr = bool(prev_best_e1rm is None or e1rm > prev_best_e1rm)`, store `sp["prev_best_e1rm"]`, `sp["is_pr"]`, and call `db.log_strength_set(...)`. Return `result = sp` (`result["is_pr"]`, `result["e1rm"]`, `result["prev_best_e1rm"]`).
    4. In `override_telemetry()` (`POST /api/telemetry/override`): also call `db.upsert_daily_biometrics(target_date, ...)` so manual biometric overrides persist to SQLite history.
    5. Add `GET /api/analytics/summary`: delegates to `analytics_service.build_analytics_summary(load_live_state())`.
    6. Add `ClientPreferencesPayload` (`model_config = ConfigDict(extra="forbid")`, `fields: Dict[str, PreferenceFieldEntry]`, plus allowlisted scalar key validation <= 8 keys and string lengths <= 40 on enum keys), `GET /api/preferences/state` (returns `{"preferences": parsed_or_empty}`), and `POST /api/preferences/state` (`_validate_payload_size(payload.model_dump(), 65536)`, calls `analytics_service.merge_preferences_v1`, persists via `db.set_kv("client_preferences_v1", ...)`, syncs active goal calorie/protein anchor to `state["nutrition"]` inside `state_lock` when `goal_key` or `custom_goal_macros` updates, and returns HTTP `200` `{"success": True, "preferences": merged, "field_resolutions": resolutions}`).

**Phase 1 Checkpoint:** `.venv/Scripts/python.exe -m py_compile backend/db.py backend/analytics_service.py backend/garmin_sync_service.py backend/mnd_sync_service.py backend/renpho_sync_service.py backend/main.py` exits `0`.

---

### Phase 2: Modular Split of `js/workout-engine.js`, Build Pipeline, Container Parity & SW Caching

#### 2.1 Split `js/workout-engine.js` by Functional Ownership (Create 4 Modules + Delete Monolith)
*   Before any UI edits to workout player/verdict features, partition `js/workout-engine.js` along verified function ownership into 4 sequential classic scripts (`index.html` script order preserves shared globals with zero top-level cross-file parse execution):
    1. **`js/workout-catalog.js`:** Activity restoration (`restoreActivitiesFromLocalStorage`), `masterExercises`, `todayWorkoutOptions`, `parseRestSeconds`, custom/swap/hidden exercise CRUD helpers.
    2. **`js/workout-verdict.js`:** `getPrescribedLoad`, equipment state & modal handlers (`gearConfig`, `toggleGear`, `updateGearWeight`, `applyPreset`, `openEquipmentModal`, `closeEquipmentModal`, `setSessionFocus`, `applyCustomEquipmentAndGenerate`), 48h muscle-group fatigue rotation, `renderWeeklyPatternBalance`, `generateTomorrowRecommendation`, today workout verdict (`computeTodayWorkoutVerdict`), `loadDailyArchetype`, `launchDynamicWorkout`.
    3. **`js/workout-player.js`:** Inline conditioning progression/player (`renderInlineConditioningPlayer`, KB flow controls), `renderCurrentExercise`, swap/load-edit/session-summary modals, set logging (`logSet`).
    4. **`js/workout-timers.js`:** Shared timer variables (`restTimerInterval`, `restSecs`, `restEndTimeMs`, `mainTimer*`, `inlineCondTimer*`) and wall-clock timer functions, `finishSession`, `switchTab`, `visibilitychange` timer catch-up hook, and global `window.*` bindings.
*   Re-home non-workout app shell handlers out of `workout-engine.js` into `js/telemetry.js`: `openWeightModal`/`saveManualWeight`, `openQuickSettingsModal`, `TELEMETRY_OVERRIDE_CONFIGS` & telemetry override prompts (`openSleepOverridePrompt`, `openBodyBatteryOverridePrompt`, `openReadinessOverridePrompt`, `submitTelemetryOverrideModal`).
*   Delete `js/workout-engine.js`.

#### 2.2 `package.json`, `.gitignore`, `.dockerignore`, `build.js`, `Dockerfile` & `sw.js` (Modify / Create)
*   **`package.json` & `package-lock.json`:** Add `"devDependencies": { "esbuild": "^0.25.0" }`, run `npm install --no-audit --no-fund`, commit updated `package.json` and `package-lock.json`.
*   **`.gitignore`:** Append `node_modules/`, `dist/`, `public/`, `.vercel/` (regenerate `backend/static/` via `npm run build` while Dockerfile Stage 1 rebuilds from root sources).
*   **`.dockerignore` (Create):** Exclude `.git/`, `.venv/`, `node_modules/`, `backend/data/`, `*.db*`, `dist/`, `public/`, `.vercel/`, `tests/`.
*   **`build.js`:**
    *   Remove `'README.md'` from `assets`.
    *   Empty/recreate `css/` and `js/` subdirectories in `[staticDir, distDir, publicDir, backendStaticDir]` prior to copying so deleted `workout-engine.js` and future renames never linger; delete `live_state.json` from all 4 output dirs.
    *   Load `esbuild` optionally; minify `.js` files via `esbuild.transformSync(code, { loader: 'js', minify: true, target: 'es2020' })` (with `bundle: false` and NO `format` wrapper so global `let`/`const`/functions stay top-level) and `.css` files via `loader: 'css', minify: true`; gracefully fall back to raw copy if `esbuild` is missing.
*   **`Dockerfile`:** Convert to a 2-stage build:
    *   Stage 1 (`FROM node:20-slim AS assets`): copy `package.json`, `package-lock.json`, `build.js`, `index.html`, `sw.js`, `manifest.json`, `icon*`, `css/`, `js/`; run `npm ci --no-audit --no-fund && node build.js`.
    *   Stage 2 (`FROM python:3.11-slim`): install `requirements.txt`, `COPY backend/ ./`, `COPY --from=assets /app/backend/static ./static`, `COPY live_state.json ./live_state.json`.
*   **`sw.js`:**
    *   Bump `CACHE_NAME = 'pulse-hybrid-v6.0-20261120'`.
    *   Update `STATIC_ASSETS` (exact existing array symbol) to list `css/styles.css?v=6.0`, `js/state.js?v=6.0`, `js/workout-catalog.js?v=6.0`, `js/workout-verdict.js?v=6.0`, `js/workout-player.js?v=6.0`, `js/workout-timers.js?v=6.0`, `js/charts.js?v=6.0`, `js/fuel-engine.js?v=6.0`, `js/telemetry.js?v=6.0` (remove `workout-engine.js`).
    *   Use **Cache-First (with network fallback)** for `url.searchParams.has('v')` same-origin `STATIC_ASSETS`, keep **Network-First (`{ cache: 'no-store' }`)** for `/`, `/index.html`, `/sw.js`, and read-only telemetry endpoints, update `shouldCacheApi` (exact symbol) to `['/api/live_state', '/api/analytics/summary', '/api/renpho/history', '/api/strength/history']` (do **not** cache `/api/preferences/state`), and listen for `message` `{ type: 'PULSE_PURGE_API_CACHE' }` to delete `/api/*` CacheStorage entries on logout.

**Phase 2 Checkpoint:** `node build.js` and `node --check` pass on all 4 split `workout-*.js` files, `sw.js`, and `build.js`; `backend/static/js/workout-engine.js` does not exist.

---

### Phase 3: WCAG Tokens, Focus Mode Styling, Placeholder Cleanup & Per-Field Preference Bridge

#### 3.1 `css/styles.css` (Modify)
*   **Proposed Changes:**
    1. Update `:root` typography and semantic success tokens (preserving `--primary: #00e5ff` and existing `--lime` references on dials and timers):
       *   `--success: #10b981;` (`--success-glow: rgba(16, 185, 129, 0.18);`, matching existing `--emerald: #10b981`)
       *   `--text-secondary: #cbd5e1;` (`11.97:1` on `#131822`)
       *   `--text-muted: #8b9db5;` (`6.42:1` on `#131822`)
       *   `--text-dim: #64748b;` (`3.74:1` on `#131822`, structural borders/icons only)
    2. Upgrade `.btn-log-set` (`min-height: 44px; min-width: 72px; padding: 8px 12px;`) and add `.set-log-row` responsive 2-row flex/grid wrapping with `.set-stepper-btn` (`min-width: 32px; min-height: 44px; gap: 8px;`) and `.set-input-box` (`height: 44px; width: 52px;`) verified to fit inside a `360px` mobile width without horizontal overflow. Update `.set-log-row.logged` to `--success`.
    3. Add `.sync-freshness-strip`, `.sync-chip`, `.sync-chip.fresh` (`var(--success)`), `.sync-chip.stale` (`var(--amber)`), `.plate-calc-pill`, `.pr-badge` (`var(--success)`), and `.rest-bar-box.rest-active`.
    4. Add `body.workout-focus-mode` rules:
       *   `display: none !important;` on `.bottom-nav`, `#floatingRestPill`, `#headerAthleteSub`, `#exerciseStepperHeader`, `#exerciseStepperPills`, `#exRationale`, `#tab-train details.fuel-accordion`.
       *   `body.workout-focus-mode .rest-bar-box.rest-active { position: sticky; bottom: 8px; z-index: 25; box-shadow: 0 6px 24px rgba(0,0,0,0.7); }`.

#### 3.2 `index.html` (Modify)
*   **Proposed Changes:**
    1. Replace every remaining hardcoded personal/telemetry value across `#tab-today` (Readiness ring/sub, Sleep, Battery, RHR, Renpho weight/BF/muscle/lean mass/water/visceral/goal labels, Daily Fuel strip), `#tab-train` (`e1RM`, rest text defaults), `#tab-fuel` (budget/target/logged/remaining hero cards, macro progress bars, hidden `mnd*` elements, coach advice placeholder), `#tab-body` (Scale vs Target comparison, Norms section, un-ID'd `98.77 kg`/`53.4 kg`/`Rating 10`/`59.8%` metrics + SVG labels by adding explicit element IDs `bodyAvg7dWeightVal`, `bodySkeletalMuscleVal`, `bodyVisceralVal`, `bodyWaterPctVal`), and Modals (Injury modal `"Coach Greg"` / `88 Sleep` / `48 bpm` / `98.0 kg`, Rationale modal defaults, MND filesystem path hint) with neutral `--` / `Pending sync` / `0` values. Add `id="coachBriefingBody"` to the Coach Reality Briefing body container (`index.html:895`).
    2. Replace `color:var(--text-dim)` on readable small text spans (timer phase descriptions and movement tag chips) with `color:var(--text-muted)`.
    3. Insert new containers with exact DOM anchors:
       *   `<div id="syncFreshnessStrip" class="sync-freshness-strip"></div>` at top of `#tab-today`.
       *   `<div id="todayOverreachBanner" style="display:none;"></div>` immediately before `#todayTrainingContainer`.
       *   `<button type="button" id="btnWorkoutFocusMode" ... onclick="toggleWorkoutFocusMode()">Focus Mode</button>` inside `.train-header-row`.
       *   `<div id="exPlateCalcRow" class="plate-calc-pill" style="display:none;"></div>` immediately below `.ex-target-pill` inside `.exercise-box`.
       *   `<span id="prBadgeSlot"></span>` inside `#autoregBanner` header row.
       *   `<div id="macroGapCloserCard"></div>` immediately below `#nutritionQualityAuditCard` in `#tab-fuel`.
       *   `<div id="adaptiveTdeeCard" class="card"></div>` and `<div id="acwrDeloadCard" class="card"></div>` immediately below `#biometricSparklinesCard` in `#tab-body`.
    4. Replace `./js/workout-engine.js?v=5.38` with the 4 ordered `?v=6.0` scripts (`workout-catalog.js`, `workout-verdict.js`, `workout-player.js`, `workout-timers.js`), update CSS/JS query parameters to `?v=6.0`, and update header/settings version strings to `v6.0`.

#### 3.3 `js/state.js` (Modify)
*   **Proposed Changes:**
    1. Neutralize hardcoded biometric numbers in `window.athleteProfile` (`weightKg: null`, `bodyFatPct: null`, `leanMassKg: null`, etc. instead of `98.0 / 17.0 / 81.0`).
    2. Initialize `window.PULSE_ANALYTICS_SUMMARY = null;` and `window._pulsePrefTimers = {};`.
    3. Define allowlisted local preference keys (`pulse_current_goal`, `pulse_custom_goal_macros`, `pulse_diet_strategy`, `pulse_carb_cycle_level`, `pulse_fasting_protocol`, `pulse_fasting_timer_state`, `pulse_equipment_profile`, `pulse_conditioning_progression`) alongside per-field timestamps stored in `localStorage['pulse_pref_timestamps_v1']`.
    4. Implement `syncClientPreferencesToCloud(fieldKeyOrMap, immediate = false)`: writes field value + `Date.now()` timestamp into `pulse_pref_timestamps_v1`, debounces 800ms (coalescing rapid clicks), sends `{ fields: { key: { value, updated_at_ms } } }` to `POST /api/preferences/state` via `pulseApiFetch` (skipping queued fields), enqueues `enqueueOfflineWrite('/api/preferences/state', ...)` on network/`>= 500` failure, and reconciles any `server_newer` field returned in `preferences.fields`.
    5. Implement `hydrateClientPreferencesFromCloud()`: reads queued endpoints in `pulse_offline_write_queue` first (skipping any preference key with a pending offline mutation until flush completes), fetches `GET /api/preferences/state` (`promptAuthOn401: false`), merges per-field where `server_ts > local_ts` (updating `localStorage` and calling UI refresh hooks `{ fromBoot: true }` across `selectGoal`, `setCustomGoalMacros`, `selectDietStrategy`, `setCarbCycleLevel`, `setFastingProtocol`, `applyEquipmentProfile`, `initFastingTimer`, and `renderCurrentExercise()`), and pushes any locally newer fields back to the server.
    6. Update `logoutPulseSession()` / `401` unlock reset to message `navigator.serviceWorker.controller?.postMessage({ type: 'PULSE_PURGE_API_CACHE' })` and remove `pulse_cached_live_state` / `pulse_analytics_summary_cache`.
    7. Update `syncSetToBackend(exerciseId, targetWeight, targetReps, loggedWeight, loggedReps)` to return `{ ok: true, result: data.result }` on HTTP 200, or `{ ok: false, queued: true }` when offline/queued, so `workout-player.js` can reconcile PR responses.

**Phase 3 Checkpoint:** `node --check js/state.js` exits `0`; contrast ratios for updated tokens verify `>= 4.5:1` on `#131822` and `#0c1017`; `.set-log-row` layout verified within `360px`.

---

### Phase 4: Coaching UI Implementation (`workout-*`, `fuel-engine.js`, `telemetry.js`, `charts.js`)

#### 4.1 `js/workout-verdict.js` & `js/workout-timers.js` (Modify)
*   **Proposed Changes:**
    1. In `js/workout-verdict.js`: persist `pulse_equipment_profile` (`{ preset, focus, gear }`) whenever `toggleGear`, `updateGearWeight`, `applyPreset(presetKey, opts = {})`, `setSessionFocus(focusKey, opts = {})`, or `applyCustomEquipmentAndGenerate()` runs (skipping `syncClientPreferencesToCloud` when `opts.fromBoot === true`); define `applyEquipmentProfile(profile, opts = {})` helper; drive 14-day plateau detection from `window.PULSE_ANALYTICS_SUMMARY?.adaptive_tdee` or cached 30d Renpho data rather than requiring a duplicate `days=14` fetch.
    2. In `js/workout-timers.js`: toggle `.rest-bar-box.rest-active` when `startRestCountdown` starts and `skipRest` / `_tickRestTimer` ends; exit Focus Mode and reset `#btnWorkoutFocusMode` label to `Focus Mode` inside both `finishSession()` and `switchTab(key)` whenever leaving `'train'`. Keep conditional wake-lock / timer catch-up inside `visibilitychange`.

#### 4.2 `js/workout-player.js` (Modify)
*   **Proposed Changes:**
    1. Implement `computeBarbellPlatesPerSide(totalKg, barKg = 20)`: returns `{ valid: false }` if non-numeric or `< barKg`; otherwise decomposes `(totalKg - barKg) / 2` greedily across `[20, 15, 10, 5, 2.5, 1.25]` with remainder flag.
    2. Gate barbell UI in `renderCurrentExercise()`: show `#exPlateCalcRow` below `.ex-target-pill` only when `Array.isArray(ex.requiredGear) && ex.requiredGear.includes('barbell')` AND `!/\b(dumbbell|db|kettlebell|kb|bodyweight|band)\b/i.test(ex.name)` AND numeric target load `>= 20` (displays `"Bar only (20kg)"` at `20kg`, plates list for `> 20kg`; `hidden` otherwise). Clear `#prBadgeSlot` on every exercise render.
    3. Render `.set-stepper-btn` (`-` / `+`) beside numeric weights (`stepSetInput(exIdx, setNum, 'weight', ±2.5)`) and reps (`±1`), stripping `'2×'`/`'kg'` (retaining `'2×'` prefix if present, hiding weight steppers for `'Body'` / range text strings), calling `beep(520, 0.04)` + `pulseHaptic(10)`, and refreshing `#exPlateCalcRow` live on weight input/step changes for set 1.
    4. Implement `toggleWorkoutFocusMode()`: toggles `body.classList.toggle('workout-focus-mode')`, syncs `#btnWorkoutFocusMode` label (`Focus On` / `Focus Mode`).
    5. Keep `logSet()` synchronous: clear `#prBadgeSlot`, check optimistic PR against `max(PULSE_ANALYTICS_SUMMARY?.strength_prs?.[exId]?.e1rm, BAKED_LIVE_STATE?.strength_prescriptions?.[exId]?.e1rm)` when `loggedW > 0 && loggedR > 0`, update local `strength_prs[exId]` & render `<span class="pr-badge">NEW e1RM PR</span>` when exceeded, start rest countdown immediately, then handle `syncSetToBackend(...).then((res) => ...)` updating `#prBadgeSlot` **only if** `activeWorkoutPlan[currentExIdx]?.id === exId`.
    6. Hook `saveConditioningProgression` to call `syncClientPreferencesToCloud('conditioning_progression')`, avoiding any cloud sync call inside read-time `_readConditioningHistoryArray()` migration.

#### 4.3 `js/fuel-engine.js` (Modify)
*   **Proposed Changes:**
    1. Define all 10 `MACRO_GAP_COMBOS` items completely (`{ id, name, cals, p, c, f }`), including:
       *   `whey_isolate`: `{ cals: 120, p: 27, c: 2, f: 1 }`
       *   `prawns_rice_cakes`: `{ cals: 160, p: 28, c: 11, f: 1 }`
       *   `protein_pudding`: `{ cals: 150, p: 20, c: 12, f: 2 }`
       *   `egg_whites_oats`: `{ cals: 180, p: 26, c: 14, f: 2 }`
       *   `cottage_berries`: `{ cals: 190, p: 24, c: 16, f: 3 }`
       *   `casein_milk`: `{ cals: 230, p: 34, c: 18, f: 2 }`
       *   `tuna_crackerbread`: `{ cals: 240, p: 32, c: 19, f: 4 }`
       *   `chicken_rice_cakes`: `{ cals: 250, p: 38, c: 20, f: 2 }`
       *   `greek_yogurt_whey`: `{ cals: 280, p: 46, c: 18, f: 3 }`
       *   `double_whey_oats`: `{ cals: 390, p: 54, c: 34, f: 4 }`
    2. Extract shared `_appendSnackAndSync(name, cals, p, c, f, itemId = null)` modeled after `submitMndMealItem()`, sending explicit item metadata to `POST /api/mnd/manual` (`app_logged_meals` overlay) alongside `totals` and `meals`, reused by `submitMndMealItem()`, `submitQuickLog()`, and `logMacroGapCombo(comboId)`.
    3. Implement `renderMacroGapCloser()` inside `renderMyNetDiaryEngine()`: reads `remCals = Math.round(totalBudget - cals)` and `remProt = Math.round((myNetDiaryData.targets?.protein || athleteProteinAnchor || 200) - prot)`; if `remProt <= 0` renders `"Protein target met — prioritize hydration/fiber."`; if `remCals <= 0` selects lowest-calorie high-protein combo under `200 kcal`; otherwise filters `item.cals <= remCals + 60` (falling back to top-3 protein-per-calorie combos if empty), sorts descending by `(Math.min(item.p, remProt) / item.cals, item.p)` and renders top 3 cards with `escapeHtml` + `<button data-combo-id="...">`.
    4. Persist `localStorage.setItem('pulse_carb_cycle_level', level)` and add `opts = {}` (`fromBoot`) to `setCarbCycleLevel(level, opts = {})`; call `syncClientPreferencesToCloud(...)` on non-boot edits in `selectDietStrategy`, `setCarbCycleLevel`, `toggleFastingTimer`, and `resetFastingTimer`.

#### 4.4 `js/telemetry.js` & `js/charts.js` (Modify)
*   **Proposed Changes:**
    1. In `js/telemetry.js`: implement `renderSyncFreshnessStrip(summary, state)` (`Garmin -> openSyncModal('garmin')`, `Renpho -> openWeightModal()`, `MND -> openSyncModal('mnd')`, distinguishing Renpho poll status from weigh-in age and handling `summary === null` gracefully via `state` timestamps), `renderAdaptiveTdeeCard(summary)` (rendering `span_days` + counts when `insufficient_data`, OLS stats when `ready`, offline placeholder when `summary === null`), and `renderAcwrDeloadCard(summary)` + `#todayOverreachBanner` (`caution` / `deload_recommended` banners).
    2. Implement `fetchAnalyticsSummary(force = false)` (throttled `>= 60s` across background 2-minute polls, forced after manual weight/MND/Garmin sync or `logSet` PR updates); remove the duplicate `/api/renpho/history?days=14` boot fetch (have `charts.js` populate `window.PULSE_RENPHO_HISTORY` when fetching 30d history, and stop calling `/api/renpho/history?days=30` & `/api/strength/history?days=30` inside every 2-minute poll unless invalidated).
    3. Add `opts = {}` (`fromBoot`) to `setFastingProtocol(key, opts = {})` and call `applyEquipmentProfile(savedProfile, { fromBoot: true })` instead of unconditional `applyPreset('gym')` in `window.load`; call `hydrateClientPreferencesFromCloud()` after initial state load and immediately after modal login succeeds (`js/state.js` unlock callback); populate `coachBriefingBody` and Body-tab extra tile IDs (`bodyAvg7dWeightVal`, `bodySkeletalMuscleVal`, `bodyVisceralVal`, `bodyWaterPctVal`) inside `applyLiveStateToDom()` and `renderRenphoTrendChart()`.

**Phase 4 Checkpoint:** `node --check` passes on all 8 frontend JS files; zero undefined inline `onclick` symbols.

---

### Phase 5: Verification Plan

1. **Syntax & Static Hygiene:**
   *   `node --check js/state.js js/workout-catalog.js js/workout-verdict.js js/workout-player.js js/workout-timers.js js/charts.js js/fuel-engine.js js/telemetry.js sw.js build.js`
   *   `.venv/Scripts/python.exe -m py_compile backend/db.py backend/analytics_service.py backend/garmin_sync_service.py backend/mnd_sync_service.py backend/renpho_sync_service.py backend/main.py`
   *   PII & placeholder scan (`Select-String -Path index.html,sw.js,build.js,live_state.json,backend/live_state.json,js/*.js,backend/*.py -Pattern "Greg\.putt@gmail\.com|He11o12345|gregputt|ghp_|Coach Greg|/shared/user"` -> zero matches; verify `#tab-today`, `#tab-fuel`, `#tab-body` HTML contains `--` / `0` initial placeholders only).
2. **Build, Bundle Transfer & Docker Parity Check:**
   *   Run `npm run build` (`node build.js`). Verify `backend/static/js/workout-engine.js`, `dist/js/workout-engine.js`, `public/js/workout-engine.js`, and `.vercel/output/static/js/workout-engine.js` do **not** exist.
   *   Measure compressed bundle size in Python (`sum(len(gzip.compress(f.read_bytes(), compresslevel=6)) for f in backend/static/{css,js} files) <= 159744` bytes / `156 KB`, and total uncompressed `<= 614400` bytes / `600 KB`).
3. **Backend Test Suite (`tests/test_v60_backend.py` + `test_tiers12_backend.py` + `test_sync_rollover.py`):**
   *   Update `C:/Users/Greg/.gemini/antigravity/brain/edad9b97-644d-4c24-b483-7fc125c27d21/scratch/test_tiers12_backend.py` line 268 (`workout-engine.js` -> 4 split `workout-*.js` files) and run both existing suites (`--with-http`).
   *   `tests/test_v60_backend.py` tests against isolated temp `DATA_DIR`:
       *   `daily_biometrics` & `daily_nutrition_logs` persistence across midnight rollover.
       *   `GET /api/analytics/summary` sparse (`insufficient_data`, `calibrating`, `span_days`) vs ready cases (deterministic OLS TDEE slope excluding today's partial intake; ACWR normalized across days 14–27; duplicate dual-write session exclusion vs two-a-day preservation; bridge card exclusion).
       *   Per-source freshness accuracy (`mnd_last_synced` / `last_pulled` without Garmin spoofing; `renpho.last_checked` vs weigh-in `last_synced`).
       *   `app_logged_meals` additive survival across simulated MND `fetch_today_data()` overwrite.
       *   `POST /api/sync_set` PR checking before insertion (`is_pr` `True` vs `False`, cold-start `strength_prescriptions` floor, `w=0` / `w>500` guards, unconditional `is_pr` reset).
       *   `GET`/`POST /api/preferences/state` per-field LWW merge (`200 OK` partial acceptance/rejection without `409`), `422` validation on unknown keys / `> 65536` bytes, synced goal nutrition target update.
       *   FastAPI `GZipMiddleware` (`Accept-Encoding: gzip` returns `Content-Encoding: gzip` and immutable `Cache-Control` on `?v=6.0` JS/CSS).
4. **Frontend Test Suite (`tests/test_v60_frontend.js` + `verify_pwa_v535.js` + `test_tiers12_frontend.js`):**
   *   Update `verify_pwa_v535.js` and `test_tiers12_frontend.js` script load lists from `workout-engine.js` to the 4 ordered `workout-*.js` scripts and confirm 100% pass.
   *   `tests/test_v60_frontend.js` asserts: WCAG AA contrast math (`#131822` and `#0c1017`, `--text-muted >= 4.5:1`, zero `--text-dim` on readable spans, `--success !== --primary`); barbell plate calculator (`95kg` -> `[20, 15, 2.5]`, `20kg` -> bar only, DB/KB exercises hidden); `stepSetInput` numeric + `'2×22.5kg'` + `'Body'` handling; Focus Mode body class toggle, `#floatingRestPill` suppression, and reset on `finishSession()`/`switchTab()`; synchronous + async `logSet()` PR badge rendering & clearing; Sync Freshness Strip routing (`Renpho -> openWeightModal()`); `renderMacroGapCloser()` 1-tap combo log & `remCals <= 0` handling; `syncClientPreferencesToCloud()` & queue-safe `hydrateClientPreferencesFromCloud()`; and SW logout purge + `?v=6.0` Cache-First rules.

--------------------------------------------------------------------------------

*Drafted with EGM*
