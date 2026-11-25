# PULSE v6.6 — Paroxysmal Episode ("Funny Turns") & Illness Recovery Tracker Specification

**Document Status:** Phase 2 Draft (Resolving 100% of Phase 1 Goldfish Audit `[Critical]` & `[Warning]` Findings)  
**Target Codebase:** `pulse-hybrid-app` (`c:\Projects\my-fitness-app\project-handoff`)  
**Release Target:** `v6.6` (`pulse-hybrid-v6.6-20261125`)  
**Primary Authoritative Modules:** `backend/db.py`, `backend/autonomic_service.py`, `backend/garmin_sync_service.py`, `backend/analytics_service.py`, `backend/main.py`, `css/styles.css`, `js/autonomic-tracker.js`, `js/workout-verdict.js`, `js/fuel-engine.js`, `js/telemetry.js`, `index.html`

---

## Phase 1 — Goldfish Audit Checklist (Verified Against Existing Codebase)

1. **`[Critical]` Discarded Garmin Intraday Stress, Heart Rate & Sleep-Stress Series** (`backend/garmin_sync_service.py:467-648`, `backend/db.py:146-155`):
   - *Finding:* `garmin_sync_service.py` calls `client.get_stress_data(target_date_str)`, `client.get_sleep_data(target_date_str)`, and `client.get_hrv_data(target_date_str)`, yet discards `stressValuesArray`, `dailySleepDTO.avgSleepStress` / `sleepStress` / `sleepStartTimestampGMT` / `sleepEndTimestampGMT` / stage durations, and `hrvSummary.baseline` (`lowUpper`, `balancedLow`, `balancedUpper`). `client.get_heart_rates(target_date_str)` is not called at all. Furthermore, `daily_biometrics` only persists `(date_str, sleep_score, resting_hr, body_battery, training_readiness, source, updated_at)` and no intraday table exists.
   - *Resolution:* Extend `daily_biometrics` idempotently via `ALTER TABLE` migration, add `garmin_intraday_telemetry` SQLite table (`stress_json`, `hr_json`, `sleep_stress_json`), call `get_heart_rates`, and persist extracted overnight sleep stress/stages and HRV baseline bounds on every Garmin sync.

2. **`[Critical]` Delayed Garmin Sync Race & Cross-Midnight Snapshot Drift** (`backend/garmin_sync_service.py`, `backend/main.py` 5-min APScheduler):
   - *Finding:* Fenix 8 data syncs intermittently via Bluetooth → Garmin Connect → PULSE (5-min background loop). An acute episode captured live will not yet have `[onset - 60m .. onset + 60m]` (especially post-onset recovery samples), and episodes near midnight (`23:00–23:59` or `00:00–01:00` UK) span two Garmin calendar date buckets.
   - *Resolution:* Persist `biometric_snapshot_status` (`pending` | `partial` | `complete`), query `[onset_date - 1d, onset_date, onset_date + 1d]` intraday series converted cleanly to canonical UK epoch ms, fetch yesterday's intraday on demand during sync if an incomplete episode falls on yesterday/near midnight, and run automatic backfill + hybrid recovery completion on every Garmin sync.

3. **`[Critical]` Garmin Sentinel Stress Values (`-1` Unmeasured / `-2` Activity) & Logged Workout False Positives** (`backend/garmin_sync_service.py`):
   - *Finding:* Garmin `stressValuesArray` encodes `-1` (off-wrist/unmeasurable) and `-2` (physical activity/movement). Raw inclusion corrupts mean sleep stress, breaks 4h streaks, or fires false Level 2 / Acute Spike warnings during legitimate workouts.
   - *Resolution:* Strictly strip negative sentinel values (`val < 0` or non-finite), mask all logged Garmin & manual workout intervals (`±5 min` buffer), require explicit valid-sample coverage floors (`>= 30%` and `>= 6` valid samples for sleep; `>= 50%` for Level 2 daytime window), and bridge brief sensor gaps `<= 15 min` without false-resetting streaks while breaking on gaps `> 15 min`.

4. **`[Critical]` CSS Zero-Hex Regression Invariant & WCAG AA/AAA Low-Cognitive-Load Safety** (`css/styles.css`, `tests/test_diagnostics_frontend.js:713-716`, `tests/test_v61_frontend.js:2584-2587`, `tests/test_v60_frontend.js:653`):
   - *Finding:* Automated regression checks fail if ANY `#hex` color literal appears anywhere in `css/styles.css` after `/* INJURY DIAGNOSTICS & ADAPTOR TOKENS (ZERO HARDCODED HEX) */`, or if `var(--text-dim)` appears in `index.html`. Additionally, during dizziness, vertigo, visual distortion, dissociation, or brain fog, users require `>= 7:1` AAA contrast, `>= 48px` touch targets, calm semantic color separation, and zero strobing/flashing UI.
   - *Resolution:* Declare all new autonomic & illness semantic palette tokens strictly inside `:root { ... }` (`css/styles.css:7-58`) and use ONLY `var(--...)` and `rgba(...)` in appended CSS rules. Ensure `>= 12:1` AAA text contrast on all state banners, `>= 48px` buttons/chips, zero flashing animations, and `@media (prefers-reduced-motion: reduce)` support.

5. **`[Critical]` Incomplete Recovery State Machine & Offline Capture During Cognitive Impairment** (`js/state.js:1071-1250`):
   - *Finding:* Requiring continuous internet connectivity or strictly waiting for Garmin stress `<= 25` would fail during cellular dead zones, dissociative brain fog, or flat watch battery (state deadlock in `POST_EPISODE_RECOVERY`).
   - *Resolution:* Define an unambiguous 5-state machine (`IDLE` → `VULNERABILITY_ALERT` → `ACUTE_EPISODE` → `POST_EPISODE_RECOVERY` → `RESOLVED`), 1-tap onset logging with `client_event_id` idempotency (`db.claim_idempotency_key`), optimistic localStorage persistence (`pulse_autonomic_cache`) + `enqueueOfflineWrite()` background replay, and hybrid resolution (auto-resolves when BOTH user marks normal AND Garmin stress `<= 25` for `>= 15m`, plus an explicit user override action when wearable telemetry is unavailable/stale).

6. **`[Warning]` Illness Days Corrupt Adaptive TDEE, Fuel Targets, Scale Psychology & Training Verdicts** (`backend/analytics_service.py:202-324,600-691`, `js/workout-verdict.js:1757-2136`):
   - *Finding:* Currently there is no way to log sick days (live or backdated like Mon/Tue/Wed). Sick-day cravings/maintenance eating or illness-driven water shifts depress 14-day `compute_adaptive_tdee()`, leave Fuel pinned to an aggressive deficit, prescribe heavy workouts, and omit illness from episode trigger analytics.
   - *Resolution:* Add `illness_logs` table with backdate & severity support, exclude illness dates (+1 day rebound) from `compute_adaptive_tdee()`, shift `recalculate_nutrition()` to Maintenance (`tdee_ref`, protein anchor locked, Planned Bank paused) while ill, extend `compute_flex_refeed_status()` 48h Scale Shield after illness clears, override `computeTodayWorkoutVerdict()` to Illness Recovery Rest (`rest_day`) when ill and a 1-day Return-to-Training Ramp (`option_c` flush) on day +1 post-illness, and correlate illness days automatically with episodes.

7. **`[Warning]` CORS Method Restriction & Alert/Spike Notification Fatigue** (`backend/main.py:162`):
   - *Finding:* FastAPI CORS `allow_methods` is strictly `["GET", "POST", "OPTIONS"]`. Also, 60-second frontend polling would re-open dismissed spike prompts.
   - *Resolution:* All new API endpoints use strictly `GET` and `POST` (including `/api/health/episodes/update` and `/api/health/episodes/delete`). Acute spike detections deduplicate per 30-minute window and persist user dismissal timestamps in `kv_store`.

8. **`[Warning]` Ambiguous Rolling-Baseline Math, CSV Formula Injection & VM Test Harness Coupling** (`tests/test_*.js`):
   - *Finding:* Rolling HRV baseline requires clear sample minimums; free-text user notes exported to CSV risk formula injection (`=`, `+`, `-`, `@`); all 3 frontend VM suites declare an explicit `SCRIPT_ORDER` array and assert asset version tags.
   - *Resolution:* Explicitly define 7-day rolling HRV math (`>= 3` prior valid nights excluding today; fallback to Garmin `hrv_baseline_low` or `LOW`/`POOR`), neutralize leading formula chars in CSV serializer, and update `index.html`, `sw.js`, `manifest.json`, and `SCRIPT_ORDER`/version checks in `tests/test_v60_frontend.js`, `tests/test_v61_frontend.js`, and `tests/test_diagnostics_frontend.js`.

9. **`[Nit]` Header Real Estate at 360px & Canonical UK Timestamps**:
   - *Finding:* Narrow mobile viewports (`360px`) leave limited header pill width. Also UTC vs local ISO strings must never shift calendar bucketing.
   - *Resolution:* Keep the `#autonomicStatusBadge` header pill compact (`>= 380px` full label, `<= 380px` crisp label), and canonicalize all timestamps to `Europe/London` ISO-8601 via `backend/time_utils.py`.

---

## 1. Context, Clinical Disclaimer & Non-Diagnostic Boundaries

### 1.1 Non-Diagnostic Boundary Statement
The **Paroxysmal Episode & Autonomic Instability Tracker** is a structured self-monitoring and biometric correlation tool designed to help the athlete and their clinicians review objective timelines alongside Garmin Fēnix 8 wearable data and illness history. **It is NOT a medical device and does NOT diagnose, rule out, treat, or predict medical emergencies, seizures, cardiac arrhythmias, syncope, or psychiatric conditions.** All alerts and risk scores represent algorithmic pattern heuristics over consumer wearable signals. Any sudden blackout/loss of consciousness, prolonged confusion, chest pain, or worsening neurological symptoms requires prompt clinical evaluation (GP / A&E / 111 / 999 as appropriate).

### 1.2 Differential Physiological Pathways (Open Clinical Lens)
Routine resting surface EEG (20–40 min) returned normal. PULSE keeps tracking neutral and structured across four differential pathways without asserting causation:
1. **`autonomic_dysregulation` — Autonomic Nervous System Dysregulation:** Sympathetic hyperarousal, impaired parasympathetic braking (low nocturnal HRV, elevated resting/sleeping stress), post-viral/illness dysautonomia.
2. **`paroxysmal_focal_neuro` — Paroxysmal Focal Neurological Signaling:** Brief deep temporal/insular/limbic episodes (déjà vu/dissociation, rising adrenaline/impending doom, visual distortion, brain fog, brief blackout) often missed on short interictal scalp EEGs and relevant for ambulatory EEG / Neurology review.
3. **`perfusion_orthostatic` — Transient Cerebral Perfusion / Orthostatic Shifts:** Delayed baroreceptor/BP compensation on postural transition, dehydration, post-exertional vasodilation, or vagal surge (relevant for Cardiology Holter / tilt-table review).
4. **`metabolic_fuel_load` — Metabolic / Fueling & Load Triggers:** Fasted high-intensity output, sleep deprivation, cumulative systemic load, or intercurrent febrile/viral illness lowering autonomic seizure/syncope threshold.

### 1.3 Operational Driving & Solo-Exertion Safety Policy
Whenever Alert Level 1, Alert Level 2, `ACUTE_EPISODE`, or `POST_EPISODE_RECOVERY` is active, PULSE displays a high-contrast safety notice advising against **driving (Volkswagen ID. Buzz)** and **solo high-risk physical exertion** (e.g., heavy solo barbell lifts, swimming/open water, ladder/height work) until autonomic metrics and symptoms have normalized. *(Note: Safety copy contains zero PII regex triggers such as weight/height/email tokens.)*

---

## 2. Database Schema & State Machine

### 2.1 SQLite Schema (`backend/db.py`)

#### A. Idempotent Migration on `daily_biometrics`
Preserve existing columns `(date_str PRIMARY KEY, sleep_score, resting_hr, body_battery, training_readiness, source, updated_at)` and idempotently add (via `PRAGMA table_info(daily_biometrics)`):
- `hrv_last_night REAL`
- `hrv_weekly_avg REAL`
- `hrv_status TEXT`
- `hrv_baseline_low REAL`
- `avg_stress REAL`
- `sleep_avg_stress REAL`
- `sleep_start_ts INTEGER` (epoch ms GMT/UTC)
- `sleep_end_ts INTEGER` (epoch ms GMT/UTC)
- `deep_sleep_sec INTEGER`
- `rem_sleep_sec INTEGER`
- `light_sleep_sec INTEGER`
- `awake_sleep_sec INTEGER`

#### B. New Table: `garmin_intraday_telemetry`
```sql
CREATE TABLE IF NOT EXISTS garmin_intraday_telemetry (
    date_str TEXT PRIMARY KEY,
    stress_json TEXT,
    hr_json TEXT,
    sleep_stress_json TEXT,
    synced_at TEXT NOT NULL
);
```
- Stores normalized `[[ts_ms, int_val], ...]` arrays sorted by `ts_ms`. Pruned automatically to trailing 30 days on write to keep SQLite compact.

#### C. New Table: `illness_logs`
```sql
CREATE TABLE IF NOT EXISTS illness_logs (
    date_str TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    severity TEXT NOT NULL DEFAULT 'moderate',
    symptoms_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_illness_date ON illness_logs(date_str DESC);
```

#### D. New Table: `paroxysmal_episodes`
```sql
CREATE TABLE IF NOT EXISTS paroxysmal_episodes (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    onset_time TEXT NOT NULL,
    date_str TEXT NOT NULL,
    acute_peak_end_time TEXT,
    full_recovery_time TEXT,
    user_recovered_at TEXT,
    biometric_recovered_at TEXT,
    acute_duration_mins INTEGER,
    total_recovery_duration_mins INTEGER,
    severity TEXT NOT NULL DEFAULT 'moderate',
    symptoms_json TEXT NOT NULL DEFAULT '[]',
    triggers_json TEXT NOT NULL DEFAULT '[]',
    pathway_tags_json TEXT NOT NULL DEFAULT '[]',
    illness_active INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    biometric_snapshot_json TEXT,
    biometric_snapshot_status TEXT NOT NULL DEFAULT 'pending',
    spike_auto_detected INTEGER NOT NULL DEFAULT 0,
    client_event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paroxysmal_onset ON paroxysmal_episodes(onset_time DESC);
CREATE INDEX IF NOT EXISTS idx_paroxysmal_date ON paroxysmal_episodes(date_str DESC);
CREATE INDEX IF NOT EXISTS idx_paroxysmal_client_evt ON paroxysmal_episodes(client_event_id);
```

### 2.2 Deterministic 5-State Recovery Machine

States represent the live autonomic lifecycle across system alerts and active episodes:

| State | Entry Condition | UI & Safety Behavior | Exit / Next State |
| :--- | :--- | :--- | :--- |
| `IDLE` | No Level 1/2 alert and no unresolved episode | Calm Teal status badge; 1-tap capture ready | → `VULNERABILITY_ALERT` if Level 1/2 triggers<br>→ `ACUTE_EPISODE` on 1-tap live capture<br>→ `POST_EPISODE_RECOVERY` on past/ended capture |
| `VULNERABILITY_ALERT` | Level 1 (Amber) or Level 2 (Amber/Red) active, no unresolved episode | Prominent Safety Banner (do not drive ID. Buzz / no solo high-risk exertion) | → `IDLE` when Level 1 & Level 2 both clear<br>→ `ACUTE_EPISODE` on 1-tap capture |
| `ACUTE_EPISODE` | User taps **"Start Funny Turn"** (live) or Spike Capture accepted (`acute_peak_end_time == NULL`) | Large live elapsed timer, calm high-contrast symptom/trigger chips, `Acute Peak Subsided` CTA, driving safety banner | → `POST_EPISODE_RECOVERY` when `mark_acute_end` sets `acute_peak_end_time`<br>→ `RESOLVED` only if user overrides full resolution explicitly |
| `POST_EPISODE_RECOVERY` | `acute_peak_end_time != NULL` and `full_recovery_time == NULL` | Hybrid Recovery tracker: shows BOTH `User Feels Normal` status AND `Garmin Stress <= 25` status + driving caution + `Confirm Resolved (Wearable Offline)` escape hatch | → `RESOLVED` when (`user_recovered_at != NULL` AND `biometric_recovered_at != NULL`) OR `confirm_resolved_override` is invoked |
| `RESOLVED` (Transient episode record; System returns to `VULNERABILITY_ALERT` if alerts remain active, else `IDLE`) | `full_recovery_time` populated; `total_recovery_duration_mins = round((full_recovery_time - onset_time) / 60s)` | Episode archived in timeline & pattern analytics with `±60m` biometric snapshot (`pending`/`partial`/`complete`) | Historical record; editable/deletable anytime |

**Anti-Deadlock Rule:** If the user taps **"I Feel Back to Normal"** (`mark_user_recovered`) and Garmin telemetry is missing, stale (`> 2h`), or unmeasurable (`-1`), the UI surfaces an unmistakable secondary button **"Wearable Offline — Mark Fully Resolved Now"** (`confirm_resolved_override`) so an episode never remains permanently stuck in `POST_EPISODE_RECOVERY`. Whenever Garmin syncs fresh post-peak data showing `stress <= 25` for `>= 15` consecutive minutes AND `user_recovered_at` is already set, `backfill_episode_snapshots()` automatically transitions the episode to `RESOLVED` and sets `full_recovery_time = max(user_recovered_at, biometric_recovered_at)`.

---

## 3. Biometric Threshold Formulas, Pattern Engine & Illness Integration

### 3.1 Signal Hygiene (Negative Sentinels, Schema Polymorphism & Workout Masking)
1. **Garmin Intraday Normalization:** Normalize both array entries `[ts, val]` and dict entries `{startGMT|timestamp|ts, value|stressLevel|heartRate}` cleanly. Convert epoch seconds (`< 1e12`) to milliseconds (`int(ts * 1000)`) and ISO timestamps via canonical UTC/UK epoch conversion.
2. **Valid Stress Filtering:** From Garmin `stressValuesArray` (`[[ts_ms, val], ...]`), discard any sample where `ts_ms <= 0`, `val is None`, `isinstance(val, bool)`, `not math.isfinite(val)`, or `val < 0` (Garmin encodes `-1` unmeasured and `-2` motion/activity) or `val > 100`.
3. **Valid HR Filtering:** From `get_heart_rates` (`heartRateValues`), keep only finite integers `25 <= bpm <= 240`.
4. **Workout Exclusion Intervals:** Collect all intervals from `live_state["garmin"]["today_activities"]`, `recent_activities`, and `db.get_manual_activities(days=3)`:
   - For each activity with parseable `date` (`startTimeLocal` in UK time) and `duration_min > 0`, add `[start_ms - 5*60*1000, start_ms + duration_min*60*1000 + 5*60*1000]`.
   - Exclude all stress and HR samples falling inside any workout interval when evaluating resting Level 2 sustained load or Acute Spikes.

### 3.2 Alert Level 1 — Elevated Autonomic Baseline (Amber Warning)
Evaluated per morning/day from latest overnight sleep & HRV metrics:
- **Criterion A (Overnight Sleep Stress Fail-to-Rest):**
  - Source priority: `garmin_intraday_telemetry.sleep_stress_json` for `target_date_str`, else daytime `stress_json` clipped to `[sleep_start_ts, sleep_end_ts]` (filtering `< 0`).
  - Coverage gate: Require `>= 6` valid (`>= 0`) samples and valid coverage `>= 30%` of sleep duration (when sleep timestamps exist). If below gate, sleep stress trigger does not fire (`data_quality = "insufficient"`).
  - Fallback metric: if `sleep_stress_json` absent, inspect `daily_biometrics.sleep_avg_stress`.
  - **Trigger Condition:** Valid sleep stress mean `>= 30.0` **OR** (`pct_samples_30_plus >= 55%` AND `pct_samples_rest_0_25 < 25%`), indicating overnight autonomic stress stayed elevated in the `30–50+` zone rather than dropping into Rest (`0–25`).
- **Criterion B (Overnight HRV Drop Below Rolling 7-Day Baseline):**
  - Collect up to 7 valid `hrv_last_night` values from prior days `[target_date - 7d .. target_date - 1d]`.
  - If `>= 3` prior nights exist: `rolling_7d_baseline = mean(prior_hrv_vals)`, and `threshold_ms = max(hrv_baseline_low or 0.0, rolling_7d_baseline * 0.88)`.
  - Else if `hrv_baseline_low` is available from Garmin `hrvSummary.baseline`: `threshold_ms = hrv_baseline_low`, `rolling_7d_baseline = hrv_baseline_low`.
  - **Trigger Condition:** (`today_hrv is not None` AND `threshold_ms > 0` AND `today_hrv < threshold_ms`) **OR** (`today_hrv_status.upper() in ("LOW", "POOR")` AND (`today_hrv` unavailable OR `rolling_7d_baseline` unavailable OR `today_hrv < rolling_7d_baseline`)).
- **Level 1 Active:** True when Criterion A **OR** Criterion B triggers.

### 3.3 Alert Level 2 — Sustained Sympathetic Load (Amber/Red Warning)
Evaluated continuously across today's daytime stress timeline:
- Daytime window start: `max(sleep_end_ts or today_0600_ms, today_0500_ms)`.
- Filter sorted today `stress_json`: keep only `ts >= daytime_start_ms` AND outside all logged `workout_intervals_ms`.
- Walk consecutive valid (`>= 0`) non-workout samples chronologically:
  - Maintain current high-stress streak `[streak_start_ms, last_high_ms]` while `val > 25`:
    - If gap since `last_valid_ts > 15 * 60 * 1000` ms (sensor off-wrist / long workout gap > 15m): reset streak to break across unmeasured voids rather than fabricating 4 hours from 2 sparse points. Gaps `<= 15 min` bridge cleanly without false-resetting.
    - If `val <= 25`: start/advance a `recovery_dip_streak` starting at that sample; only reset the sympathetic streak once recovery (`<= 25`) is sustained for `>= 6 * 60 * 1000` ms (two consecutive 3-min Garmin epochs `<= 25`), filtering single-point noise.
  - Track `valid_coverage_pct` inside the qualifying streak window (valid samples / expected 3-min buckets `>= 50%` and `>= 40` valid samples).
- **Trigger Condition:** Current or peak qualifying daytime non-workout sympathetic streak `duration_mins >= 240` (`4+` hours) with coverage gate met.

### 3.4 Acute Episode Spike Detection
Scans the trailing 3 hours (`now_ms - 3h .. now_ms`) excluding all logged workouts and respecting `dismissed_before_ms`:
1. **Unprovoked Stress Surge:** Non-workout valid stress `>= 75` for `>= 6` consecutive minutes (or single peak `>= 85` accompanied by adjacent sample `>= 70`).
2. **Abrupt Unprovoked Heart Rate Deviation:** Non-workout HR sample `>= 105 bpm` AND `>= resting_median_30m + 30 bpm` (where `resting_median_30m` is computed from `>= 5` valid non-workout HR samples in `[t - 35m .. t - 5m]`).
- Deduplicate spikes within the same 30-minute window; if spike timestamp `> dismissed_before_ms` and no `ACUTE_EPISODE` is currently active, surface a low-friction **"1-Tap Episode Capture"** prompt.

### 3.5 `±60 Minute` Biometric Snapshot & Backfill Engine
- For each episode `onset_time`:
  - Window: `[onset_ms - 60*60*1000, onset_ms + 60*60*1000]`.
  - Load `garmin_intraday_telemetry` across `[onset_date - 1d, onset_date, onset_date + 1d]` (handles midnight boundaries deterministically).
  - Filter valid Stress (`>= 0`), valid HR (`> 0`), downsample to `<= 45` chronological `{t, offset_m, v}` points per stream for responsive charts & printable report tables, and compute summary stats:
    - `pre_stress_avg`, `peak_stress`, `post_stress_avg`, `stress_sample_count`
    - `pre_hr_avg`, `peak_hr`, `post_hr_avg`, `hr_sample_count`
    - `prior_night_hrv`, `prior_night_sleep_stress`, `resting_hr`, `body_battery`
  - **Snapshot Status:**
    - `'complete'` if `now_ms >= onset_ms + 60*60*1000` AND (`post_stress_samples >= 5` or `post_hr_samples >= 5`) with sample timestamps extending `>= onset + 45m`.
    - `'partial'` if at least 1 valid stress or HR sample exists inside `[onset - 60m, onset + 60m]`.
    - `'pending'` otherwise.
- Backfilled automatically whenever Garmin sync finishes (`garmin_sync_service.py`) or episode updates occur.

### 3.6 Pattern Analysis & Prodromal Risk Trajectory ("Heading for Another Episode")
`compute_episode_patterns()` computes:
- Frequency (7d, 30d, total), acute duration stats (avg/median/min/max min), full recovery lag stats (avg/median/min/max min).
- Symptom counts & percentages, trigger counts & percentages (including automatic `illness_infection` correlation), time-of-day distribution (Morning/Midday/Afternoon/Evening/Night), differential pathway tag counts.
- Pre-episode autonomic comparison: average prior-night HRV & sleep stress on episode days vs. non-episode days.
- **Current Vulnerability / Heading-Toward-Episode Trajectory (`low` | `elevated` | `high`, score `0–100`):**
  - Additive weighted drivers (transparent list shown to user):
    - `+35`: Level 2 Sustained Sympathetic Load active (`>= 240m` daytime stress `> 25`)
    - `+25`: Level 1 Overnight Autonomic Baseline elevated (sleeping stress `>= 30` or HRV below 7d baseline)
    - `+20`: Intercurrent Illness active today or within 48h
    - `+15`: Recent episode within past 48 hours (post-ictal/autonomic cluster window)
    - `+15`: Poor overnight sleep (`sleep_score < 65`) or acute unprovoked biometric spike detected
  - Classification: `high` (`score >= 50`), `elevated` (`score >= 25`), `low` (`< 25`).

### 3.7 Illness Logging & Full-System Recovery Coupling
- `POST /api/health/illness` supports logging or updating any date (`YYYY-MM-DD`, e.g., Monday, Tuesday, Wednesday) with `status` (`'active'` | `'recovering'` | `'clear'`), `severity` (`'mild'` | `'moderate'` | `'severe'`), `symptoms`, `notes`.
- **When `active_today == True`:**
  1. **Nutrition / Fuel (`backend/analytics_service.py:recalculate_nutrition`):** Raises daily `calorie_target` to Maintenance (`max(base_target, round(tdee_ref))`), locks `protein_target_g` (tissue sparing), pauses Planned Flex Bank daily deductions while ill, recalculates `carbs_target_g` / `fat_target_g`, sets `nutrition.illness_active = True`.
  2. **Workout Verdict (`js/workout-verdict.js`):** Forces `mode = 'rest_day'`, `archetypeKey = 'option_c'`, `isRest = true`, `roomForMore = false`, `badge = '🤒 ILLNESS RECOVERY MODE'`.
  3. **Adaptive TDEE (`backend/analytics_service.py:compute_adaptive_tdee`):** Excludes all active/recovering illness dates **plus +1 post-illness water/glycogen rebound day** (`excluded_tdee_dates`) from the 14-day regression so sick-day eating & inflammation never distort metabolic rate estimates.
- **When Illness Clears (Day +1 and up to 48h after `last_illness_end_date`):**
  1. **48h Post-Illness Scale Shield:** Surfaced through `flex_refeed.scale_shield` (`claim_mode: "illness_recovery"`) in `#postRefeedScaleShield` and `#todayScaleShieldPill`.
  2. **Day-1 Return-to-Training Ramp:** On the calendar day immediately after `last_illness_end_date`, `workout-verdict.js` caps training to `liss_cardio` / `option_c` (`🛡️ POST-ILLNESS RETURN RAMP — Gentle Flush & Mobility, 75% Cap`).

---

## 4. Accessible Colour Token & Low-Cognitive-Load UI Spec

### 4.1 Verified `:root` Palette Tokens (`css/styles.css:7-58` ONLY)
All hex definitions live exclusively in `:root`. All appended CSS rules use strictly `var(--...)` and `rgba(...)` (Zero-Hex invariant compliant).

| Semantic Purpose | Token Name | Hex Value | Contrast vs Surface Pair | WCAG Rating |
| :--- | :--- | :--- | :--- | :--- |
| Calm / Baseline Normal Bg | `--autonomic-calm-bg` | `#082321` | `#99f6e4` on `#082321` = **13.09:1** (`#ffffff` = 16.50:1) | AAA (`>= 7:1`) |
| Calm / Baseline Border & Text | `--autonomic-calm-border` / `--autonomic-calm-text` | `#14b8a6` / `#99f6e4` | High separation from Obsidian `--surface` | AAA (`>= 7:1`) |
| Level 1 Prodromal Amber Bg | `--autonomic-amber-bg` | `#261a06` | `#fde68a` on `#261a06` = **13.68:1** (`#ffffff` = 17.03:1) | AAA (`>= 7:1`) |
| Level 1 Prodromal Border & Text | `--autonomic-amber-border` / `--autonomic-amber-text` | `#f59e0b` / `#fde68a` | `#f59e0b` on `#261a06` = **7.93:1** | AAA (`>= 7:1`) |
| Level 2 / Acute Red Bg | `--autonomic-red-bg` | `#290c12` | `#fecaca` on `#290c12` = **12.56:1** (`#ffffff` = 18.17:1) | AAA (`>= 7:1`) |
| Level 2 / Acute Border & Text | `--autonomic-red-border` / `--autonomic-red-text` | `#f87171` / `#fecaca` | `#f87171` on `#290c12` = **6.57:1** | AA+ / AAA Text |
| Illness Mode Violet Bg | `--illness-bg` | `#1c1330` | `#ede9fe` on `#1c1330` = **14.92:1** (`#ffffff` = 17.72:1) | AAA (`>= 7:1`) |
| Illness Border & Text | `--illness-border` / `--illness-text` | `#a78bfa` / `#ede9fe` | `#a78bfa` on `#1c1330` = **6.51:1** | AA+ / AAA Text |
| Low-Cog Chip Idle / Active Bg | `--autonomic-chip-bg` / `--autonomic-chip-active-bg` | `#111827` / `#0e3a46` | `#ffffff` = **17.74:1** / **12.26:1** | AAA (`>= 7:1`) |
| Elevated Sub-card Surface | `--autonomic-surface-hi` | `#161d2b` | `#ffffff` on `#161d2b` = **16.87:1** | AAA (`>= 7:1`) |

### 4.2 Low-Cognitive-Load Ergonomics (For Vertigo, Dissociation, Visual Distortion, Brain Fog)
- **Touch Targets:** All primary capture buttons (`.autonomic-tap-btn`), symptom checkboxes, trigger chips (`.autonomic-chip`), day selector chips, and recovery lifecycle buttons enforce `min-height: 48px` (`56px` for 1-tap acute capture), generous `10px 12px` padding, and clear active checkmark indicator (`✓`) + solid `2px` border so state never relies on colour alone.
- **Zero Visual Overstimulation:** No blinking, pulsing, or strobing CSS keyframes on alert/episode cards. Respects `@media (prefers-reduced-motion: reduce)`.
- **Navigation Entry Points:**
  1. Compact header pill `#autonomicStatusBadge` next to `#injuryStatusBadge` (opens `#autonomicModal`).
  2. `#autonomicSafetyBanner` & `#autonomicSpikeBanner` & `#illnessStatusBannerToday` & `#autonomicQuickBar` (`⚡ Log Funny Turn` / `🤒 Sick Day`) on Today tab.
  3. `#autonomicBodySummaryCard` on Body tab.

---

## 5. Error Handling, Offline Queueing & Clinical Export Format

### 5.1 API Contract (`backend/main.py` — Strictly `GET` and `POST`)
Consistent with `CORSMiddleware(allow_methods=["GET", "POST", "OPTIONS"])`:
- `GET /api/health/autonomic/status` — Returns full evaluated `autonomic` summary.
- `GET /api/health/episodes` — Query `?days=365`, returns episodes & pattern metrics.
- `POST /api/health/episodes` — Creates live (`ACUTE_EPISODE`) or backdated (`POST_EPISODE_RECOVERY` / `RESOLVED`) episode; honors `client_event_id` idempotency (`db.claim_idempotency_key("paroxysmal_episode", client_event_id)`).
- `POST /api/health/episodes/update` — Actions: `mark_acute_end`, `mark_user_recovered`, `confirm_resolved_override`, `edit_details`. Rejects booleans/non-finite numbers, validates ISO dates in UK TZ.
- `POST /api/health/episodes/delete` — Deletes episode `{id}`.
- `POST /api/health/autonomic/dismiss-spike` — Persists `{spike_ts_ms}` dismissal in `kv_store`.
- `GET /api/health/episodes/export` — `?format=csv` (RFC-4180 CSV download) or `?format=json` (full structured clinical report JSON).
- `GET /api/health/illness` — Returns illness status summary + 90-day logs.
- `POST /api/health/illness` — Upserts/clears (`status="clear"`) illness record for any `date_str` (`YYYY-MM-DD`), recalculates today's nutrition immediately if `date_str == today_str`, returns updated `{illness, state, autonomic, flex_refeed}`.

### 5.2 Offline Capture & Optimistic State (`js/autonomic-tracker.js`)
- On network failure, `5xx`, `0`, `401`, or `429` (checked via `window._shouldQueueOfflineResponse(res)`), episode creation/update and illness writes:
  1. Generate a deterministic validated episode ID (`ep_<timestamp>_<rand>`) and matching `client_event_id`. Backend `POST /api/health/episodes` preserves a valid client-supplied `id` (`^ep_[a-zA-Z0-9_-]{6,64}$`), and `POST /api/health/episodes/update` resolves by `id` OR `client_event_id` so chained offline updates replay seamlessly in FIFO order without 404s.
  2. Immediately update `localStorage('pulse_autonomic_cache')` & in-memory `PULSE_ANALYTICS_SUMMARY.autonomic` so the live timer, safety banner, symptoms, and sick-day UI work cleanly mid-episode offline.
  3. Enqueue onto `window.enqueueOfflineWrite('/api/health/episodes' | '/api/health/episodes/update' | '/api/health/illness', payload, 'POST')`, automatically replayed with server idempotency on reconnect.

**Non-Regression Guarantee:** When `illness_logs` has no active entry for today, `recalculate_nutrition()`, `compute_adaptive_tdee()`, `compute_flex_refeed_status()`, and `computeTodayWorkoutVerdict()` preserve 100% identical outputs to `v6.5`. All `#autonomicModal` HTML uses CSS variables (zero `#hex`), placed cleanly after `#walkSyncModal` so `#injuryModal` test slicing stays untouched.

### 5.3 Clinical Summary Export (CSV & Print/PDF Report)
- **CSV Columns (`pulse-clinical-episodes.csv`):**
  `episode_id, date_uk, onset_time_uk, acute_peak_end_time_uk, full_recovery_time_uk, state, severity, acute_duration_mins, total_recovery_duration_mins, illness_active, symptoms, triggers, differential_pathways, snapshot_status, prior_night_hrv_ms, prior_night_sleep_stress, resting_hr_bpm, body_battery, pre_60m_stress_avg, peak_stress_window, post_60m_stress_avg, pre_60m_hr_avg, peak_hr_window, post_60m_hr_avg, notes`
  - **Formula Injection Guard:** Any string starting with `=`, `+`, `-`, `@`, `\t`, `\r` after whitespace stripping is prefixed with `'`.
- **Print / Save PDF Clinical View (`window.openClinicalReportPrintView`):**
  - Clean high-contrast white paper stylesheet (`@media print` safe), explicit **Non-Diagnostic Self-Monitoring Disclaimer**, **Differential Context Header** (Normal resting 20–40m EEG; structured review for GP / Neurology [ambulatory EEG/MRI] / Cardiology [Holter/tilt-table]), **Summary & Recovery Lag Metrics**, **Illness Timeline**, **Symptom & Trigger Correlations**, and **Per-Episode Clinical Cards** embedding prior-night HRV + `±60 min` Stress/HR telemetry summaries. All interpolated strings strictly passed through `escapeHtml`.

---

## 6. File-by-File Implementation Order
1. `css/styles.css` — `:root` accessible tokens + appended zero-hex autonomic/illness styles.
2. `backend/db.py` — `daily_biometrics` migration + `garmin_intraday_telemetry`, `illness_logs`, `paroxysmal_episodes` tables & CRUD helpers.
3. `backend/autonomic_service.py` — Threshold evaluators, `-1`/`-2` filter, workout mask, snapshot slicer & backfiller, state machine, pattern & prodrome analyzer, CSV serializer.
4. `backend/garmin_sync_service.py` — Persist intraday stress, `get_heart_rates`, sleep stress/stages, HRV baseline, yesterday backfill + call `backfill_episode_snapshots()`.
5. `backend/analytics_service.py` — Illness TDEE exclusion, Illness Maintenance override in `recalculate_nutrition()`, 48h Post-Illness Scale Shield, attach `autonomic` to `build_analytics_summary()`.
6. `backend/main.py` — Register `/api/health/*` `GET`/`POST` endpoints & Pydantic models.
7. `js/autonomic-tracker.js` + hooks in `index.html`, `js/telemetry.js`, `js/workout-verdict.js`, `js/fuel-engine.js`, `sw.js`, `manifest.json` (`v6.6`).
8. Tests (`tests/test_autonomic_backend.py`, `tests/test_autonomic_frontend.js`, update `SCRIPT_ORDER`/version checks in existing JS suites), `npm run build`, and full Python + Node verification.

---

## Phase 3 — Goldfish Spec Lock Sign-Off
- **Verification Verdict:** `LOCKED — 0 [Critical] / 0 [Warning] Open`
- Verified against existing codebase constraints:
  - `:root` token hex literals strictly separated from zero-hex appended CSS section (`test_diagnostics_frontend.js` & `test_v61_frontend.js` safe).
  - Offline chained create + update episode replay guaranteed via deterministic `ep_*` ID + `client_event_id` lookup.
  - Polymorphic Garmin intraday sample formats + `-1`/`-2` sentinels + workout `±5m` masking + cross-midnight `[date - 1d, date, date + 1d]` slicing specified.
  - Strictly `GET`/`POST` endpoints matching FastAPI CORS config.
  - Zero regression to `v6.5` nutrition/training calculations when no illness is active.
