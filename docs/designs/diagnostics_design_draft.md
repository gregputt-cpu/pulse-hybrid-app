# EGM Phase 2: AI Injury Diagnostics & Triage Module — Architecture Design Draft

**Phase:** Phase 2 (`/egm-draft` — Formal Architecture Specification)  
**Target Module:** AI Injury Diagnostics & Triage Module  
**Companion Concepts Brief:** [`docs/designs/diagnostics_concepts_brief.md`](./diagnostics_concepts_brief.md)  
**Status:** Draft Ready for User Gate Confirmation (Do NOT Implement Until Phase 3 Spec Lock)

---

## 1. Context Aggregator Pipeline (`backend/diagnostics_context.py` + `backend/exercise_biomechanics.py`)

Before invoking AI synthesis or deterministic triage, `build_diagnostic_context(symptom_input, live_state, window_days=21)` assembles a deterministic, compact biomechanical snapshot from SQLite and `live_state.json`.

### 1.1 Exact Data Queries
Using a single SQLite connection via `with closing(db.get_connection()) as conn:` plus the caller's atomic `load_live_state()` snapshot, with `window_days` clamped to `[14, 30]` (default `21`):

1. **In-App Workout Sessions:** `db.get_workout_sessions(days=window_days, conn=conn)` → timestamp, preset, goal, exercises completed, sets logged, calories, exercise IDs/payload.
2. **Manual Activity Logs:** `db.get_manual_activities(days=window_days, conn=conn)` → id, timestamp, name, sub_title, duration_min, calories, avg_hr, max_hr.
3. **Working Strength Sets:** `db.get_strength_history(days=window_days)` (excludes warmups via `COALESCE(is_warmup, 0) = 0`) → `exercise_id, weight, reps, e1rm, timestamp`.
4. **Strength PR Baselines:** `db.get_strength_pr_map(conn=conn)` merged with `live_state["strength_prescriptions"]`.
5. **Biometrics & Overreaching Window:** `db.get_daily_biometrics(days=max(window_days, 28), conn=conn)` + `live_state["garmin"]` (`sleep_score, sleep_duration, resting_hr, body_battery, training_readiness, steps, active_calories`).
6. **Body Composition:** `db.get_renpho_history(days=window_days, conn=conn)` + `live_state["athlete"]` / `live_state["renpho"]` (`weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, water_pct`).
7. **Nutrition Context:** `db.get_daily_nutrition(days=14, conn=conn)` + `live_state["nutrition"]` (`calorie_target, deficit, protein_target_g`).
8. **User Preferences (`kv_store`):** `db.get_kv("client_preferences_v1")` → `goal_key`, `equipment_profile`, `conditioning_progression`.
9. **Recent Diagnostic Assessments:** `db.get_recent_diagnostic_assessments(limit=3, conn=conn)` (from new `diagnostic_assessments` table) for longitudinal continuity without looping raw history.
10. **Live Garmin Activities & Injury Profile:** `live_state["garmin"]["today_activities"]`, `live_state["garmin"]["recent_activities"]`, and `live_state["injuries"]` (including `chronic_profile` and `active_constraints`).

### 1.2 Unified Deduplication & Biomechanical Enrichment
- **Activity Deduplication:** Applies the exact source precedence established in `analytics_service.compute_acwr_overreaching()`:
  - Filter out synthetic `"Daily Steps"` entries from `garmin_via_mnd_bridge`.
  - Deduplicate same-day activities within `<= 15.0 kcal` and `<= 7200s (2h)` preserving **Garmin OAuth (`2`) > Manual Activity (`1`) > Workout Session (`0`)**.
- **Exercise & Activity Biomechanical Mapping (`backend/exercise_biomechanics.py`):**
  - `EXERCISE_BIOMECHANICS`: Dictionary covering all **54** catalog exercises and **8** movement families from `js/workout-catalog.js`, storing `{ id, name, family, primary_muscles, secondary_muscles, stressed_joints, joint_load_weights, kinetic_chain, impact_level, axial_load, safe_alternatives }`.
  - `classify_activity_biomechanics(name, sub_title, activity_type_key)`: Deterministic keyword classifier mapping Garmin/manual sessions (e.g., running/jogging, jump rope/skipping, kettlebell snatch/swing/clean, cycling/spin, walking/ruck/incline, HIIT/circuit, barbell strength, rowing, swimming, mobility/yoga) to stressed joints, kinetic chains, and ballistic/impact classifications.

### 1.3 Pre-Computed Deterministic Signals
All quantitative metrics are calculated in Python so the LLM never performs arithmetic or invents metrics:

- **`acwr`:** Verbatim output from `analytics_service.compute_acwr_overreaching(...)` (`status`, `acwr`, `acute_7d_load`, `chronic_weekly_avg`, `span_days`, `fatigued_markers`, `reason`).
- **`strength_exposure` (top 15 by recency/sets):** Per `exercise_id`: `{ exercise_id, name, family, sessions_count, sets_7d, sets_prev_7d, volume_delta_pct, max_weight_kg, latest_e1rm, last_performed_date, stressed_joints }`.
- **`joint_load_7d_vs_prev_7d`:** Exposure counters for all 6 adaptor domains (`lumbar, shoulders, knees, elbows, wrists, ankles`) across days `0–6` vs. days `7–13`, including computed spike ratio (`sets_or_sessions_7d / max(1, prev_7d)`).
- **`consecutive_training_days`:** Integer streak ending today or yesterday.
- **`history_availability`:** `"rich"` (`>= 5` deduplicated workouts in window), `"sparse"` (`1..4` workouts), or `"empty"` (`0` workouts and `0` strength sets).

### 1.4 Context Window Cap & Prompt Fencing
- **Budget Enforcement:** Hard cap **`<= 4,500 tokens` (`<= 15,500` serialized JSON characters)**:
  - Array limits: `recent_workouts[:25]`, `strength_exposure[:15]`, `exercise_library_subset[:25]` (strictly filtered to exercises performed in the window OR matching candidate region swaps), `prior_diagnostics[:3]`.
  - Progressive trimmer drops oldest `recent_workouts` entries first if `len(json.dumps(context_bundle)) > 15500`, preserving `acwr`, `joint_load_7d_vs_prev_7d`, `biometrics`, and active injuries.
- **Prompt Injection Defense:**
  - System instruction locks the model into a non-diagnostic sports-medicine biomechanical triage role, prohibits medication/NSAID dosing or clinical diagnosis claims, and mandates citing ONLY verified dates, exercises, and activities present inside `<athlete_context_json>`.
  - Athlete free-text input is serialized strictly inside `<athlete_symptom_input>` delimiters with an explicit system rule treating its contents as untrusted athlete symptom text (never executable instructions).

---

## 2. Data Schemas

The frontend has no TypeScript compilation step (bundled via `build.js`), so the TypeScript interfaces below define the canonical wire contract enforced at runtime by **Pydantic v2** models on the backend (`responseJsonSchema` + `model_validate`) and JSDoc/defensive checks on the frontend.

### 2.1 `SymptomInput` (Request to `POST /api/diagnostics/analyze`)
```ts
export interface SymptomInput {
  raw_text: string; // Required, trimmed, 1..2000 chars
  input_mode: "text" | "voice" | "voice_edited" | "chip";
  transcript_edited?: boolean;
  pain_severity?: number | null; // Optional integer 1..10
  onset_type?: "sudden_acute" | "gradual_overuse" | "post_workout" | "chronic_flare" | "unknown";
  laterality_hint?: "left" | "right" | "bilateral" | "midline" | "unknown";
  context_window_days?: number; // Integer 14..30, default 21
  clarification_context?: {
    prior_assessment_id: string;
    answers: string[]; // Max 3 short answers
  } | null;
  client_date?: string; // Optional YYYY-MM-DD
}
```

### 2.2 `DiagnosticReport` (Response from `POST /api/diagnostics/analyze`)
```ts
export type AnatomicalRegion =
  | "cervical_neck"
  | "thoracic_upper_back"
  | "lumbar_lower_back"
  | "shoulder"
  | "elbow"
  | "wrist_hand"
  | "hip_glute"
  | "groin_adductor"
  | "hamstring"
  | "quadriceps"
  | "knee"
  | "calf_shin"
  | "ankle_achilles"
  | "foot_plantar"
  | "chest_rib"
  | "other_unspecified";

export type Laterality = "left" | "right" | "bilateral" | "midline" | "unspecified";
export type SeverityLevel = "mild" | "moderate" | "severe";
export type TriageLevel = "green_modify" | "amber_deload" | "red_seek_care";
export type TrainingClearance = "modified_allowed" | "deload_only" | "stop_and_evaluate";

export interface DiagnosticReport {
  assessment_id: string; // UUIDv4
  generated_at: string; // UK ISO-8601 timestamp
  engine: "ai" | "deterministic_fallback";
  model_id?: string | null;
  fallback_reason?: string | null;

  needs_clarification: boolean;
  clarification_questions: Array<{
    id: string;
    prompt: string;
    quick_options: string[];
  }>; // Up to 3 questions when input lacks anatomical/symptom specificity

  summary_headline: string; // Plain text ONLY (never HTML)
  anatomical_region: AnatomicalRegion;
  laterality: Laterality;
  severity: SeverityLevel;
  triage_level: TriageLevel;

  red_flags: {
    triggered: boolean;
    deterministic_override: boolean;
    flags: string[];
    clinical_action: string;
    training_clearance: TrainingClearance;
  };

  probable_causes: Array<{
    rank: 1 | 2 | 3;
    label: string;
    likelihood: "high" | "moderate" | "low";
    confidence_pct: number; // 0..100
    mechanism: string;
    supporting_evidence: string[];
  }>; // 1..3 items when needs_clarification === false

  load_correlations: Array<{
    date: string;
    activity_or_exercise: string;
    source: "garmin" | "strength_log" | "workout_session" | "manual" | "acwr_biometrics";
    stress_vector: string;
    correlation_note: string;
  }>; // Empty array + recovery_context.data_gap_note when history is empty

  recovery_context: {
    history_availability: "rich" | "sparse" | "empty";
    workouts_analyzed: number;
    window_days: number;
    acwr: number | null;
    acwr_status: string;
    fatigued_markers: string[];
    data_gap_note: string | null;
  };

  action_plan: {
    immediate_relief_protocol: string[];
    load_management_guidance: string;
    recovery_horizon_hours: string;
    return_to_load_criteria: string[];
  };

  clinical_disclaimer: string;
  adaptor_handoff: AdaptorHandoffPayload | null; // null when needs_clarification === true
}
```

### 2.3 `AdaptorHandoffPayload`
```ts
export type AdaptorJoint = "lumbar" | "shoulders" | "knees" | "elbows" | "wrists" | "ankles";

export type MovementRestriction =
  | "axial_spinal_loading"
  | "deep_hip_hinge"
  | "overhead_pressing"
  | "deep_horizontal_push"
  | "deep_knee_flexion"
  | "ballistic_impact"
  | "terminal_elbow_lockout"
  | "wrist_extension_load"
  | "heavy_grip_pull"
  | "explosive_calf_achilles";

export interface AdaptorHandoffPayload {
  assessment_id: string;
  affected_joints: AdaptorJoint[];
  anatomical_region: AnatomicalRegion;
  laterality: Laterality;
  severity: SeverityLevel;
  triage_level: TriageLevel;
  movement_restrictions: MovementRestriction[];
  restricted_exercise_ids: string[]; // Validated catalog IDs beyond default joint rules
  recommended_swaps: string[]; // Safe catalog exercise IDs
  rest_recommended: boolean;
  merge_mode: "additive"; // Invariant: preserves unrelated & permanent constraints
  summary_note: string; // Plain text summary attached to athleteInjuries.notes
  expires_hint_hours: number; // e.g. 48 | 72 | 168
}
```

### 2.4 Backward-Compatible Extension to `athleteInjuries` / `state["injuries"]`
- Existing top-level keys (`lumbar, shoulders, knees, elbows, wrists, ankles, notes, assessment`) remain intact so all existing code and tests stay 100% compatible.
- `backend/main.py:1559` `_INJURY_ALLOWED_KEYS` adds 3 optional keys (strictly capped `< 4 KB` combined for `last_diagnostic_summary` / constraint maps):
  - `chronic_profile`: `{ [joint in AdaptorJoint]?: { permanent: true, label: string, laterality: Laterality, notes: string } }`
  - `active_constraints`: `{ [joint in AdaptorJoint]?: { severity: SeverityLevel, source: "diagnostic" | "manual" | "chronic", laterality: Laterality, anatomical_region: AnatomicalRegion, movement_restrictions: MovementRestriction[], restricted_exercise_ids: string[], assessment_id?: string, applied_at: string, expires_hint_hours?: number } }`
  - `last_diagnostic_summary`: `{ assessment_id: string, generated_at: string, summary_headline: string, anatomical_region: AnatomicalRegion, severity: SeverityLevel, triage_level: TriageLevel, affected_joints: AdaptorJoint[] } | null`

### 2.5 New SQLite Table `diagnostic_assessments` (`backend/db.py`)
```sql
CREATE TABLE IF NOT EXISTS diagnostic_assessments (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    date_str TEXT NOT NULL,
    input_mode TEXT,
    raw_text TEXT NOT NULL,
    anatomical_region TEXT,
    severity TEXT,
    triage_level TEXT,
    engine TEXT,
    affected_joints_json TEXT,
    report_json TEXT NOT NULL,
    applied_to_adaptor INTEGER DEFAULT 0,
    applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostic_assessments(created_at DESC);
```
- **Retention & Query:** Keep the newest 50 rows on write; expose `GET /api/diagnostics/history?limit=10` and `POST /api/diagnostics/{assessment_id}/apply` to record explicit one-click handoff acceptance.

---

## 3. Voice Dictation & Fallback Mechanics (`js/diagnostics.js`)

### 3.1 Feature Detection & State Machine
- **Detection:**
  ```js
  const SpeechRec = (typeof window !== 'undefined')
    ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
    : null;
  const isVoiceSupported = Boolean(SpeechRec && window.isSecureContext !== false);
  ```
- **States:** `idle` → `listening` → `stopped` (with recoverable `error` or `unsupported` UI state).
- **Exact Recognition Configuration (Cross-Browser Mobile Safe):**
  - `recognition.lang = (navigator.language && /^en/i.test(navigator.language)) ? navigator.language : 'en-GB'`
  - `recognition.continuous = false` (mandatory for Android Chrome & iOS Safari stability — avoids duplicate overlapping final result bursts on mobile browsers).
  - `recognition.interimResults = true`
  - `recognition.maxAlternatives = 1`
- **TTS / Audio Collision Guard:** Before `recognition.start()`, cancel any active speech synthesis (`if (window.speechSynthesis) window.speechSynthesis.cancel()`) and suppress `beep()` playback for 150ms so confirmation tones are not captured by the microphone.

### 3.2 Live Transcript Capture & Mandatory Pre-Submission Edit Flow
1. While `listening`, interim tokens stream into a dedicated live preview container (`#diagVoiceInterim`) with a pulsing `var(--crimson)` indicator and accessible `"Stop"` control (`aria-pressed="true"`).
2. On finalized phrase (`result.isFinal`), append the transcript with a single space to `#injuryNotesInput.value`, dispatch a synthetic `'input'` event, set `diagInputMode = 'voice'`, focus `#injuryNotesInput`, and display an inline helper hint: `"Voice captured — review or edit before running triage."`
3. If the athlete modifies `#injuryNotesInput` after voice capture, switch `diagInputMode = 'voice_edited'` and `transcriptEdited = true`.
4. **No Auto-Submit Invariant:** Stopping dictation or reaching `onend` **never** submits `POST /api/diagnostics/analyze` automatically; the athlete retains full control to fix anatomy/side errors (e.g., `"left"` vs `"right"` knee) before pressing Analyze.

### 3.3 Resource Cleanup Guarantees
`stopVoiceDictation()` executes automatically in all teardown paths:
- Inside `closeInjuryModal()` (`js/telemetry.js:1370`)
- Inside global `Escape` and modal backdrop click close handlers (`js/state.js:933-945`)
- On `document` `visibilitychange` when `document.visibilityState === 'hidden'`
- On `window` `beforeunload`

### 3.4 Compatibility, Permissions Header & Error Fallback Matrix
- **Server Header:** Update `api_auth_and_cache_middleware` (`backend/main.py:159-187`) to emit `Permissions-Policy: microphone=(self)` on HTML document responses so PWA/mobile wrappers permit self-origin microphone capture.
- **Error Handling Matrix:**
  - `Unsupported browser / non-HTTPS`: Hide or disable mic control (`aria-disabled="true"`), display subtle muted note (`"Voice dictation unavailable here — type or tap a symptom chip"`).
  - `not-allowed` / `service-not-allowed`: Non-blocking amber inline alert with site-permission hint; textarea & chips remain 100% functional.
  - `no-speech`: Friendly muted hint (`"No speech detected — tap mic again or type your symptoms"`).
  - `audio-capture` / `network` / `aborted`: Reset cleanly to `idle` without losing any existing text in `#injuryNotesInput`.

---

## 4. Injury Adaptor Bridge

### 4.1 Anatomical Region → Existing 6-Joint Adaptor Mapping

| `anatomical_region` | Mapped `affected_joints` | Default `movement_restrictions` |
|---|---|---|
| `lumbar_lower_back` | `["lumbar"]` | `["axial_spinal_loading", "deep_hip_hinge"]` |
| `thoracic_upper_back` | `["lumbar", "shoulders"]` (`["lumbar"]` if mild/no overhead pain) | `["axial_spinal_loading", "overhead_pressing"]` |
| `cervical_neck` | `["shoulders"]` (+ `"lumbar"` if axial loading noted) | `["overhead_pressing", "axial_spinal_loading"]` |
| `shoulder` | `["shoulders"]` | `["overhead_pressing", "deep_horizontal_push"]` |
| `chest_rib` | `["shoulders"]` | `["deep_horizontal_push"]` |
| `elbow` | `["elbows"]` | `["terminal_elbow_lockout"]` |
| `wrist_hand` | `["wrists"]` | `["wrist_extension_load"]` |
| `knee` | `["knees"]` | `["deep_knee_flexion", "ballistic_impact"]` |
| `quadriceps` | `["knees"]` | `["deep_knee_flexion"]` |
| `hip_glute`, `hamstring`, `groin_adductor` | `["lumbar"]` (+ `"knees"` if squat/lunge pain) | `["deep_hip_hinge"]` (+ `"deep_knee_flexion"` if knee involved) |
| `ankle_achilles`, `calf_shin`, `foot_plantar` | `["ankles"]` | `["ballistic_impact", "explosive_calf_achilles"]` |
| `other_unspecified` | `[]` (sets `needs_clarification: true`) | `[]` |

### 4.2 Movement Restriction Filtering Extension (`js/workout-verdict.js`)
Extend `isExerciseContraindicated(exOrId, injuries)` (`js/workout-verdict.js:53-66`) while preserving 100% backward compatibility with plain boolean flags:
1. Check existing 6-domain sets in `JOINT_CONTRAINDICATIONS[domain]` whenever `inj[domain] === true` (plus `kb_flow_2h_*` / `kb_flow_1h_*` rule).
2. Inspect optional `inj.active_constraints[domain]`:
   - If `restricted_exercise_ids` contains `exId`, return `true`.
   - Map each `movement_restrictions` token via a new `MOVEMENT_RESTRICTION_EXERCISES` lookup in `js/workout-verdict.js` (matching catalog IDs aligned with `backend/exercise_biomechanics.py`).
- Existing 4 consumer sites (`loadDailyArchetype`, `generateWorkoutFromGearAndGoal`, `launchDynamicWorkout`, `restoreActiveSessionFromLocalStorage`) automatically inherit this enhanced filtering through `isExerciseContraindicated()` and `applyJointSafeSwaps()`.

### 4.3 Exact One-Click Handoff Algorithm (`applyDiagnosticHandoff(report)`)
Unlike the legacy `analyzeAthleteInjury()`, **running diagnostics is strictly read-only** until the user explicitly clicks **`🛡️ Apply Restrictions to Injury Adaptor`** (or chooses **`Apply & Load Deloaded Plan`**):

1. **Snapshot for Rollback:** `const prevSnapshot = structuredClone(athleteInjuries);`
2. **Additive Non-Destructive Merge (`merge_mode: "additive"`):**
   - Preserve all existing active `athleteInjuries[j] === true`, every entry inside `athleteInjuries.chronic_profile`, and all unrelated entries in `athleteInjuries.active_constraints`.
   - For each `joint` in `report.adaptor_handoff.affected_joints`:
     - Set `athleteInjuries[joint] = true`.
     - Upsert `athleteInjuries.active_constraints[joint]` with `{ severity, source: 'diagnostic', laterality, anatomical_region, movement_restrictions, restricted_exercise_ids, assessment_id, applied_at, expires_hint_hours }`, keeping any `chronic_profile[joint]` entry intact.
   - Store compact `athleteInjuries.last_diagnostic_summary` and append/update plain-text `athleteInjuries.notes` (never wiping permanent injury notes).
3. **Atomic Persistence:**
   - Persist immediately to `localStorage.setItem('pulse_athlete_injuries', JSON.stringify(athleteInjuries))`.
   - `POST /api/athlete/injuries` via `pulseApiFetch` (falling back to `enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST')` if offline/5xx/network failure).
   - Best-effort `POST /api/diagnostics/{assessment_id}/apply` to record `applied_to_adaptor = 1` in SQLite.
4. **Immediate UI & Workout Refresh Sequence:**
   - Sync `#inj_btn_{joint}` active states inside `#injuryModal` (displaying `CHRONIC` vs. `AI TRIAGE` badges).
   - Call `renderInjuryRules()` (`js/telemetry.js:1427`) and `updateInjuryBadge()` (`js/telemetry.js:1718`).
   - **Red-Flag / Rest Routing:** If `handoff.rest_recommended === true` (`triage_level === "red_seek_care"`), switch active training view cleanly to a protective Recovery/Rest notice (`option_c` mobility or rest-only banner — never loading heavy barbell or ballistic work); otherwise invoke `loadDailyArchetype(currentArchetypeKey || 'option_a')` and `renderCurrentExercise()` so swaps take effect immediately.
   - Trigger `beep(880, 0.12)` and `showToast('🛡️ Diagnostic restrictions applied to Injury Adaptor', { actionLabel: 'Undo', durationMs: 6000, onAction: () => revertDiagnosticHandoff(prevSnapshot) })`.
5. **Permanent Constraint Protection on Clear:**
   - `clearAllInjuries()` (`js/telemetry.js:1376`) changes default action to **"Clear Acute Restrictions"**: removes acute/diagnostic toggles while leaving `chronic_profile` permanent joints active and re-enforced unless explicitly toggled off in the Chronic Profile editor.

---

## 5. Safety, Clinical Red-Flag Triage, Error Handling & UI Tokens

### 5.1 Dual-Layer Red-Flag Triage (`backend/diagnostics_safety.py`)
Every request passes through a deterministic safety classifier *both before and after* LLM synthesis:
- **Red-Flag Trigger Categories:**
  1. *Neurological deficits:* numbness, tingling, pins and needles, radiating shooting pain, foot drop, sudden weakness, saddle anesthesia, bowel/bladder changes.
  2. *Acute structural trauma:* audible pop/snap followed by immediate swelling, inability to bear weight, joint locking/giving way, visible deformity.
  3. *Cardiopulmonary / Systemic:* chest pain/pressure, dizziness/syncope, shortness of breath, fever/chills, hot red swollen joint, unrelenting night pain.
  4. *Severe acute intensity:* `pain_severity >= 8` combined with sudden/acute onset or inability to move through basic range.
- **Hard Server Safety Invariant:** If the deterministic classifier detects any red flag, the backend **forces** `red_flags.triggered = true`, `red_flags.deterministic_override = true`, `triage_level = "red_seek_care"`, `training_clearance = "stop_and_evaluate"`, and `adaptor_handoff.rest_recommended = true` regardless of what the LLM returned.
- **Non-Diagnostic Guardrails:** Responses must never state definitive medical diagnoses ("torn ACL", "herniated disc") or prescribe drug/NSAID dosages, and must always include a visible `clinical_disclaimer`.

### 5.2 Edge Cases, Empty History, Ambiguity & API Resilience
- **Empty Workout History (`0` workouts / sets in window):** Sets `history_availability = "empty"`, `load_correlations = []`, and populates `recovery_context.data_gap_note`. Prompt & schema rules forbid fabricating prior workouts.
- **Vague Symptom Input (`< 8` meaningful chars or no detectable body region/symptom):** Returns HTTP 200 with `needs_clarification: true`, `adaptor_handoff: null`, and up to 3 tappable clarification chips (`quick_options`) so the user can refine in one tap without triggering spurious joint bans.
- **Backend AI Timeout / 429 / 5xx / Invalid JSON / Missing `GEMINI_API_KEY`:** Seamless failover to `DeterministicDiagnosticsEngine` (returns HTTP 200 with `engine: "deterministic_fallback"` and `fallback_reason` using the exact same `DiagnosticReport` schema and aggregated 14–30d context).
- **Client Offline / Unreachable Backend:** Frontend renders a compact local offline triage preview (`engine: "offline_basic"`) built from local `injuryRules` + client red-flag keywords with the same explicit one-click handoff button (never silently mutates `athleteInjuries`; never enqueues `/api/diagnostics/analyze` into `pulse_offline_write_queue`).
- **Rate Limiting:** Sliding window **12 requests / 10 minutes** per client IP on `POST /api/diagnostics/analyze` returning HTTP `429` with `Retry-After` header.
- **Plain-Text XSS Invariant:** All strings in `DiagnosticReport` are strictly plain text (prompted + stripped/validated) and escaped with `escapeHtml()` (`js/state.js:473`) on render, permanently eliminating the legacy raw `<strong>` escaping bug.

### 5.3 UI Layout & Zero-Hardcoded-Hex Token Compliance
All Diagnostics UI lives inside upgraded `#injuryModal` (`index.html:1492+`) using dedicated CSS classes in `css/styles.css`:
- **UI Flow Inside `#injuryModal`:**
  1. Multimodal Symptom Card: voice dictation mic button + live interim transcript caption bar (`#diagVoiceInterim`) + editable `#injuryNotesInput` + quick symptom chips + optional pain (1–10) & onset selector pills.
  2. Structured Diagnostic Report Card (`#injuryAssessmentResult`): Clinical Disclaimer bar → Red-Flag Triage Banner (when triggered) or Systemic Recovery Summary → Probable Causes (ranked differential cards) → Load & Movement Correlations (linked to synced workouts/exercises) → Relief & Return-to-Load Protocol → **Explicit One-Click Adaptor Handoff Bar** (`Apply Restrictions to Injury Adaptor`).
  3. Manual Joint Toggles & Collapsible **Chronic / Permanent Sensitivities** editor (`chronic_profile`), preserving `CHRONIC` vs. `AI TRIAGE` distinction.
- **Strict CSS Token Mapping (Zero Hardcoded Hex Leaks, WCAG AA >= 4.5:1 Contrast, >= 44px Mobile Touch Targets):**
  - Surfaces & borders: `var(--surface)`, `var(--surface-elevated)`, `var(--surface-card)`, `var(--surface-subtle)`, `var(--border)`, `var(--border-bright)`, `var(--border-focus)`.
  - Brand & triage accents: `var(--primary)` / `var(--cyan)` (diagnostics header/focus), `var(--emerald)` / `var(--success-glow)` (`green_modify`), `var(--amber)` / `var(--amber-glow)` (`amber_deload` & caution alerts), `var(--crimson)` / `var(--crimson-text)` / `var(--crimson-glow)` (`red_seek_care`, recording active dot, banned lists).
  - Text hierarchy: `var(--text)` (`#ffffff`), `var(--text-secondary)` (`#cbd5e1`), `var(--text-muted)` (`#8b9db5`).

---

## 6. Planned File Surface (For Phase 4 Execution After Phase 3 Spec Lock)

- **New Backend Modules:**
  - `backend/exercise_biomechanics.py`
  - `backend/diagnostics_safety.py`
  - `backend/diagnostics_context.py`
  - `backend/diagnostics_ai.py`
- **Modified Backend & Config Files:**
  - `backend/db.py` (add `diagnostic_assessments` table & CRUD helpers)
  - `backend/main.py` (add `POST /api/diagnostics/analyze`, `GET /api/diagnostics/history`, `POST /api/diagnostics/{id}/apply`, extend `_INJURY_ALLOWED_KEYS`, add `Permissions-Policy: microphone=(self)` header)
  - `.env.example` (document optional `GEMINI_API_KEY` & `GEMINI_DIAGNOSTICS_MODEL`)
- **New & Modified Frontend Files:**
  - `js/diagnostics.js` (new — voice dictation controller, API client/offline fallback, structured report renderer, one-click Adaptor handoff + Undo, Chronic profile toggle)
  - `index.html` (upgrade `#injuryModal` structure + include `./js/diagnostics.js`)
  - `css/styles.css` (Diagnostics modal/voice/triage/card/handoff styles strictly using `:root` tokens)
  - `js/telemetry.js` (delegate `analyzeAthleteInjury()`, fix `clearAllInjuries()` chronic preservation, update `renderInjuryRules()` & `updateInjuryBadge()`)
  - `js/workout-verdict.js` (add `MOVEMENT_RESTRICTION_EXERCISES` & extend `isExerciseContraindicated()`)
  - `js/state.js` (stop voice dictation in modal Escape/backdrop close handlers)
  - `sw.js` (add `/js/diagnostics.js` to `STATIC_ASSETS` and bump `CACHE_NAME`)
- **New Automated Verification Suites:**
  - `tests/test_diagnostics_backend.py`
  - `tests/test_diagnostics_frontend.js`
