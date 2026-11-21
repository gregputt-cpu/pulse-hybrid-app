# EGM Phase 3: AI Injury Diagnostics & Triage Module — Zero-Bias Goldfish Audit & Locked Final Specification

**Phases:** Phase 3 (`/egm-review` Zero-Bias GOLDFISH Audit → `/egm-resolve` ELEPHANT Spec Lock)  
**Target Module:** AI Injury Diagnostics & Triage Module  
**Prior Documents:** [`diagnostics_concepts_brief.md`](./diagnostics_concepts_brief.md) · [`diagnostics_design_draft.md`](./diagnostics_design_draft.md)  
**Status:** SPEC LOCKED — Ready for Phase 4 Controlled Implementation

---

## Part I: Zero-Bias GOLDFISH Audit Report (`/egm-review`)

Audited strictly against the live repository state across all 5 EGM review vectors (1. Ambiguity & Missing Details, 2. Edge Cases & Failure Modes, 3. Data Consistency & State Drift, 4. UI, Colour Suitability & WCAG AA/AAA Accessibility, 5. Implementation & Security Friction). All 18 findings are graded strictly by severity.

### `[Critical]` Findings

1. **[Backend Schema Validation & Chronic Invariant Gap]** `backend/main.py:1558-1582` (`POST /api/athlete/injuries`)  
   - **Defect:** `_INJURY_ALLOWED_KEYS` currently accepts only `("lumbar", "shoulders", "knees", "elbows", "wrists", "ankles", "notes", "assessment")`. Any new `chronic_profile`, `active_constraints`, `last_diagnostic_summary`, or `updated_at_ms` keys would be silently dropped (`L1568`), and blindly allowing arbitrary nested dicts without size/type validation risks `live_state.json` bloat or corrupt boolean/permanent state drift.  
   - **Concrete Fix:** Extend `_INJURY_ALLOWED_KEYS` in `backend/main.py` to include `chronic_profile`, `active_constraints`, `last_diagnostic_summary`, and `updated_at_ms` via a strict `_sanitize_injuries_payload()` helper enforcing: per-joint structural bounds, plain strings truncated cleanly, `last_diagnostic_summary <= 4,096` serialized bytes, and invariant enforcement where any `chronic_profile[joint]["permanent"] == True` guarantees `cleaned[joint] = True`.

2. **[Frontend/Cloud Injury Merge & State Drift Race]** `js/telemetry.js:2866-2869` (`applyLiveStateToDom`) & `js/telemetry.js:1395-1410, 1556-1571, 1681-1708`  
   - **Defect:** `applyLiveStateToDom()` performs a shallow merge `{ ...athleteInjuries, ...state.injuries }` whenever `!hasPendingInjuries`. If a `/api/athlete/injuries` POST is in flight, or if the cloud payload clears a joint boolean back to `false` without clearing stale client `active_constraints[joint]` keys (or vice versa), local and cloud injury states diverge silently.  
   - **Concrete Fix:** Add `updated_at_ms` epoch tracking to `athleteInjuries`, maintain a client `_injuriesSyncInFlight` counter alongside `hasPendingInjuries`, replace shallow spread with `normalizeAthleteInjuries()` (preserving active `chronic_profile` invariants and pruning orphaned `active_constraints` where `injuries[j] === false`), and adopt server state only when `serverTs >= localTs` and no write is queued/in-flight.

3. **[Injury Adaptor Filter & Verdict Gaps]** `js/workout-verdict.js:53-162` (`isExerciseContraindicated`, `applyJointSafeSwaps`) & `js/workout-verdict.js:1726-1960` (`computeTodayWorkoutVerdict`)  
   - **Defect:**  
     1. `applyJointSafeSwaps()` (`js/workout-verdict.js:137-140`) only inspects `JOINT_CONTRAINDICATIONS[d]` to construct `domains` for `[🛡️ X-Safe Swap]`. Exercises blocked exclusively by `movement_restrictions` or `restricted_exercise_ids` produce an empty `domains = []` and malformed `[🛡️ -Safe Swap]` rationale prefix, and `pickSafeReplacement([])` receives no preferred safe swap list.  
     2. `computeTodayWorkoutVerdict()` does not inspect `athleteInjuries.last_diagnostic_summary.triage_level === 'red_seek_care'` (`rest_recommended: true`), allowing a high Garmin Readiness score to keep recommending Option A heavy barbell strength despite a red-flag rest triage.  
     3. `JOINT_CONTRAINDICATIONS.knees` (`js/workout-verdict.js:14`) lists `'kb_goblet_lunge'`, which is absent from the 54-exercise `getAllExercises()` catalog in `js/workout-catalog.js`.  
   - **Concrete Fix:** Extract `getContraindicatingDomains(exOrId, injuries)` in `js/workout-verdict.js` inspecting (a) `JOINT_CONTRAINDICATIONS`, (b) `MOVEMENT_RESTRICTION_EXERCISES`, and (c) `active_constraints[d].restricted_exercise_ids`; use it identically in both `isExerciseContraindicated()` and `applyJointSafeSwaps()`. Preserve `'kb_goblet_lunge'` as a documented legacy alias in both frontend and backend parity tables. Wire red-flag `rest_recommended` into `computeTodayWorkoutVerdict()` to override `mode = 'rest_day'`, `archetypeKey = 'option_c'`, and protective warning banner when acute red-flag constraints are active.

4. **[Client Request Timeout, Cancelation & Proxy Rate-Limit Bypass]** `js/state.js:626-662` (`pulseApiFetch`) & `backend/main.py:473-477` (`_get_client_ip`)  
   - **Defect:** Gemini REST call timeout is `(4.0, 14.0)` (up to ~18s including fallback/JSON parsing), so omitting `timeoutMs >= 22000` or falling back to default short `fetch` timeouts aborts valid AI responses prematurely; repeated taps without `AbortController` create stale out-of-order reports. On the backend, `_get_client_ip()` trusts a raw first `x-forwarded-for` header alone, making IP-only rate limiting trivial to spoof, and lacks an overall Gemini API quota fuse.  
   - **Concrete Fix:** In `js/diagnostics.js`, wrap `POST /api/diagnostics/analyze` with an explicit module-level `AbortController`, cancel any prior in-flight analysis before starting a new one, pass `timeoutMs: 22000` to `pulseApiFetch` (keeping `promptAuthOn401: true` so auth retry works without losing the draft). On `backend/main.py`, key the 12-request / 10-minute diagnostics limiter by `(client_ip, session_cookie_hash)` AND add a global 60 calls/hour Gemini upstream circuit-breaker fuse returning deterministic fallback when exceeded.

5. **[WCAG AA/AAA Contrast Failures on Crimson Tokens & Accent Buttons]** `css/styles.css:43-52`  
   - **Defect:** Contrast verification proves `#ef4444` (`--crimson`) text on `crimson-glow-on-surface` yields only **4.25:1** (FAIL WCAG AA 4.5:1 normal text), white (`#ffffff`) text on `--crimson` background yields only **3.76:1** (FAIL WCAG AA), and `--text-dim` (`#64748b`) yields **3.74–4.00:1** on dark surfaces (FAIL WCAG AA).  
   - **Concrete Fix:** Enforce strict token pairings in `css/styles.css`: use `--crimson-text (#fca5a5)` for all red-flag/error text (**8.43:1** on `crimson-glow`, **10.04:1** on `--surface`), `var(--bg)` (`#06080e`) for text on solid `--primary` (**13.02:1**), `--emerald` (**7.89:1**), and `--amber` (**9.32:1**) buttons, `rgba(239,68,68,0.18)` + `var(--crimson)` border + `var(--crimson-text)` label for danger/stop buttons (**8.43:1**), and ban `var(--text-dim)` from all text elements.

6. **[Legacy Assessment Card Test & Compatibility Breakage]** `tests/test_v61_frontend.js:1293-1305` & `js/telemetry.js:1578-1666` (`renderAssessmentResultCard`)  
   - **Defect:** Replacing `renderAssessmentResultCard(data)` with a `DiagnosticReport`-only renderer would break `tests/test_v61_frontend.js` Test [8], which invokes `renderAssessmentResultCard({ statusTitle, swapPrescription, rootCauseText, banned, safe, decompression })` and asserts `&lt;svg onload=alert(1)&gt;Swap&lt;/svg&gt;` and `&lt;b onclick=x&gt;Cause&lt;/b&gt;` in `#injuryAssessmentResult`.  
   - **Concrete Fix:** Preserve `renderAssessmentResultCard(data)` with dual-shape detection: when passed a v2 `DiagnosticReport` (`data.probable_causes` or `data.adaptor_handoff !== undefined`), render the new structured report card; otherwise render the backward-compatible sanitized legacy assessment card. Also fix `telemetry.js:1513-1530` plain-text strings (removing raw `<strong>` tags before escaping).

### `[Warning]` Findings

7. **[SQLite Connection Reuse Signature Gap]** `backend/db.py:407, 478` (`get_strength_history`, `get_kv`)  
   - **Defect:** Unlike `get_workout_sessions(days, conn=None)`, `get_strength_history()` and `get_kv()` open independent SQLite connections, preventing single-connection aggregation in `diagnostics_context.py`.  
   - **Concrete Fix:** Add optional `conn: Optional[sqlite3.Connection] = None` using `with _managed_conn(conn) as active_conn:` to both functions, preserving full backward compatibility.

8. **[Modal Close Mic Leak & WebView `structuredClone` Gap]** `js/state.js:933-945`, `js/telemetry.js:1370`  
   - **Defect:** Global `Escape` and `.modal-overlay` click handlers in `js/state.js` remove `.open` directly without calling `closeInjuryModal()` or `stopVoiceDictation()`, leaving `SpeechRecognition` active if a user dismisses `#injuryModal` via Escape or backdrop tap; `structuredClone()` also lacks guaranteed availability in older Android WebViews/test VM sandboxes, and dictation lacks a max-duration timeout.  
   - **Concrete Fix:** Invoke `if (typeof window.stopVoiceDictation === 'function') window.stopVoiceDictation(true)` both inside `closeInjuryModal()` AND whenever `#injuryModal` closes via Escape/backdrop in `js/state.js`, on `visibilitychange` (`hidden`), and `beforeunload`. Add a 45-second max dictation timeout calling `recognition.stop()` and use `recognition.abort()` on teardown. Use `JSON.parse(JSON.stringify(athleteInjuries))` for Undo snapshots.

9. **[Cross-Injury Contraindicated Swap Leak in `recommended_swaps`]** `docs/designs/diagnostics_design_draft.md` §2.3 & §4.3  
   - **Defect:** If a user already has chronic `shoulders` active and reports a new `knees` injury, returning static `JOINT_SAFE_SWAPS["knees"]` without intersecting against *existing* active/chronic injuries could recommend an upper-body/overhead movement unsafe for their shoulders.  
   - **Concrete Fix:** Inside `diagnostics_safety.py:enforce_safety_invariants()`, compute `recommended_swaps` against the **union** of `existing_active_and_chronic_joints ∪ new_affected_joints` (falling back to `JOINT_MOBILITY_FALLBACKS`), and pass through `applyJointSafeSwaps()` on the frontend.

10. **[Vague Limb Inputs, Clarification Loop & Red-Flag Precedence]** `docs/designs/diagnostics_design_draft.md` §5.2  
    - **Defect:** Inputs like `"my leg hurts"` or `"arm is sore"` are `> 8` meaningful chars but too anatomically ambiguous to bind cleanly to `knees` vs `ankles` vs `lumbar` or `shoulders` vs `elbows`. Also, running vague-input checks before red-flag checks could trap urgent complaints like `"chest pain"` or `"numb leg"` inside clarification prompts, and un-capped clarification could loop infinitely.  
    - **Concrete Fix:** In `diagnostics_safety.py`, execute `evaluate_red_flags()` **first** (`"chest pain"`, `"numb leg"`, `"cant bear weight"`, `pain >= 8` acute immediately emit `red_seek_care`, bypassing clarification). Recognize ambiguous limb terms (`leg`, `arm`, `back` without upper/lower) as clarification triggers yielding region-specific quick chips (`Knee / Patella`, `Hamstring / Posterior Thigh`, `Calf / Achilles`). Enforce a strict **1-round clarification cap**: when `clarification_context` is non-empty, synthesize best-effort triage and NEVER return `needs_clarification: true` a second time.

11. **[Set-Suffixed Key Normalization for `workout_sessions.payload_json.details`]** `js/telemetry.js` / `tests/test_v61_frontend.js:1318-1319`  
    - **Defect:** `workout_sessions` `payload_json.details` records logged sets under set-indexed keys like `barbell_rdl_1`, `barbell_rdl_2` alongside IDs ending in valid numbers like `emom_hybrid_10`, `amrap_hybrid_10`, `kb_flow_2h_pyramid_1_5`. Naive digit stripping corrupts real catalog IDs.  
    - **Concrete Fix:** Implement `normalize_exercise_id(raw_id)` in `backend/exercise_biomechanics.py` returning exact matches in `EXERCISE_BIOMECHANICS` first, and otherwise stripping only a single trailing `_\d+$` when the stem exists in `EXERCISE_BIOMECHANICS` (or matches a known `kb_flow_*` prefix).

12. **[Inline Hardcoded Hex Cleanup Inside Existing `#injuryModal`]** `index.html:1506-1546`, `js/telemetry.js:1727-1761`  
    - **Defect:** `#injuryModal` and `updateInjuryBadge()` currently contain inline hex styles (`#00f0ff`, `#3b82f6`, `#8b5cf6`, `#050914`, `#cbd5e1`, `#fca5a5`, `#14161e`). Leaving them violates zero-hardcoded-hex UI consistency.  
    - **Concrete Fix:** Replace all inline colors inside `#injuryModal` and `updateInjuryBadge()` with semantic CSS classes in `css/styles.css` referencing `:root` tokens exclusively.

13. **[Bundle Size Budget & Service Worker / Test Manifest Sync]** `build.js`, `sw.js`, `tests/test_v61_frontend.js:13-22, 1962`  
    - **Defect:** Adding `js/diagnostics.js` increases raw bundle size (~598 KB baseline) and requires syncing `sw.js` `STATIC_ASSETS` & `CACHE_NAME`, `index.html` script tags, AND `tests/test_v61_frontend.js` `SCRIPT_ORDER` and cache-name assertion (`L1962`).  
    - **Concrete Fix:** Keep `js/diagnostics.js` crisp and compact (<= 14 KB raw unminified / <= 4 KB minified), keep all static data tables on the Python backend, bump `CACHE_NAME` consistently to `pulse-hybrid-v6.2-20261121` across `sw.js`, `index.html?v=6.2`, `manifest.json?v=6.2`, and `tests/test_v61_frontend.js`.

14. **[Vercel Deployment `Permissions-Policy` Header Gap]** `build.js:87-110` & `backend/main.py:159-187`  
    - **Defect:** Adding `Permissions-Policy: microphone=(self)` only in FastAPI (`backend/main.py`) would omit the header when static HTML is served via Vercel Build Output API (`.vercel/output/config.json` generated by `build.js`).  
    - **Concrete Fix:** Emit `Permissions-Policy: microphone=(self)` in BOTH `backend/main.py` (`api_auth_and_cache_middleware` on HTML routes) AND `.vercel/output/config.json` route headers inside `build.js`.

### `[Nit]` Findings

15. **[Accessibility ARIA Roles for Modal & Live Triage Regions]** `index.html:1492`  
    - **Defect:** `#injuryModal` lacks `role="dialog" aria-modal="true" aria-labelledby="injuryModalTitle"`, and status/interim/result containers lack `aria-live="polite"` / `role="alert"`.  
    - **Concrete Fix:** Add full dialog semantics, descriptive `aria-label` on icon-only close/mic buttons, `aria-pressed` state on `#btnDiagVoiceMic`, `aria-live="polite"` on `#diagVoiceInterim`, and `role="alert"` on red-flag banners.

16. **[Gemini v1beta `responseSchema` Flattening]**  
    - **Defect:** Gemini REST `responseSchema` rejects Pydantic's `$defs` / `$ref` / `additionalProperties` JSON Schema keywords on nested models.  
    - **Concrete Fix:** Author an explicit flat OpenAPI-3.0-compatible `GEMINI_RESPONSE_SCHEMA` dict in `backend/diagnostics_ai.py` without `$defs`/`$ref` while validating decoded responses through Pydantic v2 `DiagnosticReportModel`.

17. **[Explicit `revertDiagnosticHandoff` Contract]**  
    - **Defect:** Design draft referenced `revertDiagnosticHandoff(prevSnapshot)` in Toast `onAction` without defining its exact implementation steps.  
    - **Concrete Fix:** Lock `revertDiagnosticHandoff(prevSnapshot)` in Part II §4.3: restores `athleteInjuries`, writes `localStorage`, posts `/api/athlete/injuries` (with offline queue fallback), updates modal toggles/`renderInjuryRules()`/`updateInjuryBadge()`/`loadDailyArchetype()`, and confirms via toast.

18. **[Server-Side Markup Sanitizer Before Persistence]**  
    - **Defect:** Relying only on LLM prompting to avoid `<strong>` or Markdown formatting inside `DiagnosticReport` strings can leave stray HTML tags in persisted `diagnostic_assessments` rows.  
    - **Concrete Fix:** Run `strip_markup()` in `backend/diagnostics_safety.py` recursively across all string fields of `DiagnosticReport` before returning or persisting to SQLite.

---

## Part II: Locked Final Architecture Specification (`/egm-resolve` — ELEPHANT Mode)

This specification locks 100% of all backend, frontend, schema, voice, safety, adaptor-bridge, and UI contracts for Phase 4 implementation.

### 1. Context Aggregator & Biomechanics Pipeline

#### 1.1 `backend/exercise_biomechanics.py`
- Encodes `EXERCISE_BIOMECHANICS` for all **54** catalog exercises in `js/workout-catalog.js:getAllExercises()` matching exact `family` (`hip_hinge`, `horizontal_push`, `squat`, `pull`, `vertical_push`, `cardio`, `core_carry`, `mobility`), `name`, `primary_muscles`, `secondary_muscles`, `stressed_joints` (subset of `ALL_ADAPTOR_JOINTS`), `kinetic_chain`, `movement_tags`, `impact_level` (`low|moderate|high`), and `axial_load` (`none|low|moderate|high`).
- Defines `ALL_ADAPTOR_JOINTS = ("lumbar", "shoulders", "knees", "elbows", "wrists", "ankles")`, `MOVEMENT_RESTRICTIONS`, `ANATOMICAL_REGIONS`, and `REGION_TO_ADAPTOR_MAP`.
- Mirrors `JOINT_CONTRAINDICATIONS` (noting `'kb_goblet_lunge'` as a documented legacy alias), `JOINT_SAFE_SWAPS`, `JOINT_MOBILITY_FALLBACKS`, and defines `MOVEMENT_RESTRICTION_EXERCISES` kept in exact parity with `js/workout-verdict.js`.
- Provides `normalize_exercise_id(raw_id: str) -> str`: exact match in `EXERCISE_BIOMECHANICS` first, else strip single trailing `_\d+$` set suffix only if stem matches `EXERCISE_BIOMECHANICS` or `kb_flow_*`.
- Provides `classify_activity_biomechanics(name, sub_title="", activity_type_key="")` mapping external Garmin/manual workouts (`running`, `skipping/jump rope`, `kettlebell/snatch/swing`, `cycling`, `walking/ruck`, `HIIT/combat/circuit`, `strength/barbell`, `rowing`, `swimming`, `yoga/mobility`) to stressed joints, kinetic chain, and impact profile.
- Provides `compute_safe_swaps_for_injuries(active_joints, movement_restrictions=())` returning safe catalog IDs free of contraindications across all supplied joints and restrictions (falling back to non-contraindicated `JOINT_MOBILITY_FALLBACKS`).

#### 1.2 `backend/db.py` Extensions
- Update `get_strength_history(days: int = 30, conn: Optional[sqlite3.Connection] = None)` and `get_kv(key: str, conn: Optional[sqlite3.Connection] = None)` to accept optional `conn` via `_managed_conn(conn)`.
- Add table in `_init_db_unlocked()`:
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
- Implement `save_diagnostic_assessment(record, conn=None)` (inserts row and prunes oldest rows beyond 50), `get_recent_diagnostic_assessments(limit=10, conn=None)`, `get_diagnostic_assessment(assessment_id, conn=None)`, and `mark_diagnostic_applied(assessment_id, conn=None) -> bool`.

#### 1.3 `backend/diagnostics_context.py`
- `build_diagnostic_context(symptom_input, live_state, window_days=21, candidate_region=None)`:
  - Clamps `window_days` to `[14, 30]`.
  - Uses a single `with closing(db.get_connection()) as conn:` block to read: `workout_sessions`, `manual_activities`, `strength_history` (working sets only), `strength_pr_map`, `daily_biometrics(days=max(window_days, 28))`, `renpho_history`, `daily_nutrition(days=14)`, `client_preferences_v1`, and `recent_diagnostic_assessments(limit=3)`, alongside `live_state["garmin"]`, `athlete`, `renpho`, `nutrition`, `strength_prescriptions`, and `injuries`.
  - Deduplicates unified workouts using `Garmin OAuth (2) > Manual (1) > Workout Session (0)` (excluding `"Daily Steps"` bridge records; same-day `<= 15 kcal` & `<= 7200s`), enriching each with `stressed_joints` & `impact_level`, and extracting normalized `exercise_ids` from `workout_sessions.payload.details` and Garmin `exercise_sets`.
  - Computes deterministically in Python: `acwr` (via `analytics_service.compute_acwr_overreaching`), `strength_exposure[:15]` (7d vs prev-7d set volume delta, max weight, e1RM, stressed joints), `joint_load_7d_vs_prev_7d` across all 6 adaptor domains, `consecutive_training_days`, `history_availability` (`rich|sparse|empty`), `biometrics_summary`, `injury_context` (chronic + active flags/notes), and `exercise_library_subset[:25]`.
  - Enforces hard JSON size budget **`<= 15,500` chars (`<= 4,500` tokens)** by trimming oldest `recent_workouts` beyond the cap while preserving aggregates.

---

### 2. Data Schemas & API Endpoints

- **`SymptomInputModel` (`POST /api/diagnostics/analyze`):**
  - `raw_text`: `str` (`min_length=1, max_length=2000`, stripped non-empty)
  - `input_mode`: `"text" | "voice" | "voice_edited" | "chip"` (default `"text"`)
  - `transcript_edited`: `bool = False`
  - `pain_severity`: `Optional[int]` (`1..10`)
  - `onset_type`: `"sudden_acute" | "gradual_overuse" | "post_workout" | "chronic_flare" | "unknown"` (default `"unknown"`)
  - `laterality_hint`: `"left" | "right" | "bilateral" | "midline" | "unknown"` (default `"unknown"`)
  - `context_window_days`: `int = 21` (clamped `14..30`)
  - `clarification_context`: `Optional[{ prior_assessment_id: str, answers: List[str] }]` (`answers` max 3, each <= 200 chars)
  - `client_date`: `Optional[str]` (`YYYY-MM-DD`)
- **`DiagnosticReportModel` & `AdaptorHandoffModel`:** Matches exact interface in [`diagnostics_design_draft.md`](./diagnostics_design_draft.md) §2.2–2.3, with all text fields plain-text sanitized (`strip_markup`).
- **Hardened `POST /api/athlete/injuries` (`backend/main.py`):**
  - `_INJURY_ALLOWED_KEYS = set(_INJURY_JOINT_KEYS) | {"notes", "assessment", "chronic_profile", "active_constraints", "last_diagnostic_summary", "updated_at_ms"}`
  - `_sanitize_injuries_payload(payload)` enforces boolean joints, `notes[:2000]`, non-negative integer `updated_at_ms`, `chronic_profile` (only valid joints + `{ permanent: bool, label: str[:120], laterality: str[:20], notes: str[:300] }`), `active_constraints` (valid joints + typed metadata), `last_diagnostic_summary` (valid scalar fields + JSON byte length `<= 4096`), and invariant: if `chronic_profile[j]["permanent"]` is truthy then `cleaned[j] = True`. Total payload `<= 65,536` bytes.
- **Endpoints:**
  - `POST /api/diagnostics/analyze` → validates input, runs `analyze_athlete_symptoms`, persists record to `diagnostic_assessments` (read-only on `live_state.json`!), returns `DiagnosticReport` (HTTP 200).
  - `GET /api/diagnostics/history?limit=10` → returns recent assessments (`limit` clamped `1..25`).
  - `POST /api/diagnostics/{assessment_id}/apply` → sets `applied_to_adaptor = 1, applied_at = uk_now().isoformat()`, returns 404 if missing.
  - Rate limit on `/api/diagnostics/analyze`: **12 requests / 10 minutes** per `(client_ip_resolved, session_hash)` -> HTTP 429 with `Retry-After` header. Global Gemini upstream fuse: **60 calls / hour** (falls back smoothly to deterministic engine without error).

---

### 3. Safety Engine & Gemini REST Wrapper

#### 3.1 `backend/diagnostics_safety.py`
1. **Execution Order Guarantee:** `evaluate_red_flags(raw_text, pain_severity, onset_type)` runs **BEFORE** vague-input / clarification logic. Any neurological deficit, structural pop/locking/inability to bear weight, cardiopulmonary/systemic fever/swelling, or severe acute trauma (`pain_severity >= 8` + acute indicators) immediately forces `red_flags.triggered = True`, `deterministic_override = True`, `triage_level = "red_seek_care"`, `training_clearance = "stop_and_evaluate"`, `adaptor_handoff.rest_recommended = True`, and never triggers clarification.
2. **Clarification Logic & 1-Round Cap:** Vague inputs (`< 8` alpha chars, missing anatomical region, or ambiguous limb words `"leg"` / `"arm"` / `"back"` without upper/lower discriminator) trigger `needs_clarification = True`, `adaptor_handoff = None`, and up to 3 targeted quick-option chips—UNLESS `clarification_context` is already provided (1-round max cap).
3. **Post-Synthesis Guardrails (`enforce_safety_invariants`):**
   - Recursively calls `strip_markup()` on all strings in the report.
   - Re-applies deterministic red-flag overrides (cannot be downgraded by AI output).
   - Validates `adaptor_handoff.affected_joints`, `movement_restrictions`, and `restricted_exercise_ids` against catalog constants.
   - Filters `adaptor_handoff.recommended_swaps` through `compute_safe_swaps_for_injuries(existing_active_and_chronic_joints | affected_joints, movement_restrictions)` so chronic/pre-existing injuries are never contradicted.
   - Ensures mandatory `clinical_disclaimer`.

#### 3.2 `backend/diagnostics_ai.py`
- **Gemini REST Call:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` using header `x-goog-api-key: {GEMINI_API_KEY}` (default model `gemini-2.5-flash` via `GEMINI_DIAGNOSTICS_MODEL`), `temperature: 0.2`, `responseMimeType: "application/json"`, flattened `GEMINI_RESPONSE_SCHEMA` (no `$defs`/`$ref`), `timeout=(4.0, 14.0)`.
- **Prompt Injection Defense:** System instruction restricts output strictly to non-diagnostic biomechanical triage grounded only in verified records inside `<athlete_context_json>`, treating `<athlete_symptom_input>` strictly as untrusted data.
- **Deterministic Fallback (`DeterministicDiagnosticsEngine`):** Produces complete schema-valid `DiagnosticReport` grounded in `context_bundle` whenever `GEMINI_API_KEY` is absent, upstream quota fuse trips, network/timeout occurs, HTTP != 200, or Pydantic validation fails.

---

### 4. Voice Dictation (`js/diagnostics.js`) & `Permissions-Policy`

- **Dual Header Emission:** `Permissions-Policy: microphone=(self)` on HTML responses in `backend/main.py` middleware AND in `.vercel/output/config.json` generated by `build.js`.
- **Voice Config:** `SpeechRecognition || webkitSpeechRecognition` gated by `window.isSecureContext !== false`; `continuous = false`, `interimResults = true`, `maxAlternatives = 1`, `lang = /^en/i.test(navigator.language) ? navigator.language : 'en-GB'`.
- **Audio Collision & 45s Safety Cap:** Cancels `window.speechSynthesis` before `.start()`, suppresses `beep()` for 150ms, starts a 45,000ms auto-stop timer.
- **Mandatory Edit Review:** Streams interim tokens into `#diagVoiceInterim` (`aria-live="polite"`); final transcript appends to `#injuryNotesInput.value`, fires `'input'`, focuses textarea, and sets `input_mode = 'voice'` (`'voice_edited'` once edited). Never auto-submits.
- **Zero-Leak Teardown:** `stopVoiceDictation(true)` aborts active recognition and clears timers on `closeInjuryModal()`, Escape/backdrop modal dismissal in `js/state.js`, `visibilitychange` (`hidden`), and `beforeunload`.
- **In-Flight Analysis Abort:** Stores current `AbortController`; aborts prior fetch if re-clicked; uses `pulseApiFetch(..., { timeoutMs: 22000, promptAuthOn401: true })`.

---

### 5. Injury Adaptor Bridge & Verdict Protection

- **`normalizeAthleteInjuries(raw)`:** Canonicalizes `{ lumbar, shoulders, knees, elbows, wrists, ankles, notes, assessment, chronic_profile, active_constraints, last_diagnostic_summary, updated_at_ms }`; enforces `chronic_profile[j].permanent === true -> obj[j] = true` and prunes orphaned `active_constraints[j]` where `obj[j] === false`.
- **Safe Cloud Merge (`js/telemetry.js:applyLiveStateToDom`):** Only adopts `state.injuries` when `!hasPendingInjuries && !_injuriesSyncInFlight && Number(state.injuries.updated_at_ms || 0) >= Number(athleteInjuries.updated_at_ms || 0)`, followed by `normalizeAthleteInjuries()`.
- **Contraindication & Swap Engine (`js/workout-verdict.js`):**
  - `MOVEMENT_RESTRICTION_EXERCISES` map aligned identically with `backend/exercise_biomechanics.py`.
  - `getContraindicatingDomains(exOrId, injuries)` evaluates `JOINT_CONTRAINDICATIONS`, `MOVEMENT_RESTRICTION_EXERCISES` (for any active `active_constraints[d].movement_restrictions`), and `active_constraints[d].restricted_exercise_ids`.
  - Both `isExerciseContraindicated()` and `applyJointSafeSwaps()` use `getContraindicatingDomains()`, fixing empty `[🛡️ -Safe Swap]` tags and ensuring `recommended_swaps` honors existing chronic constraints.
  - `computeTodayWorkoutVerdict()` checks `athleteInjuries?.last_diagnostic_summary?.triage_level === 'red_seek_care'` (+ corresponding active joint flag), overriding `mode = 'rest_day'`, `archetypeKey = 'option_c'`, `isRest = true`, and red-flag recovery messaging.
- **One-Click Additive Handoff (`applyDiagnosticHandoff(report)`) & Undo (`revertDiagnosticHandoff(prevSnapshot)`):**
  - Snapshots `prevSnapshot = JSON.parse(JSON.stringify(athleteInjuries))`.
  - Additive merge: preserves existing active joints and `chronic_profile`; enables all `handoff.affected_joints`, populates `active_constraints[joint]` and `last_diagnostic_summary`, appends plain-text summary to `notes`, stamps `updated_at_ms = Date.now()`.
  - Saves locally + POSTs `/api/athlete/injuries` (with offline queue fallback) + fires best-effort `POST /api/diagnostics/{id}/apply`.
  - Refreshes `#inj_btn_*` + chronic badges, `renderInjuryRules()`, `updateInjuryBadge()`, `loadDailyArchetype()`, `renderCurrentExercise()`.
  - Toast Undo button calls `revertDiagnosticHandoff(prevSnapshot)` restoring exact pre-handoff local/cloud state and UI.
- **Chronic Preservation on Clear:** `clearAllInjuries()` clears acute constraints and untoggles non-permanent joints while keeping every `chronic_profile[j].permanent === true` joint active (`athleteInjuries[j] = true`) unless explicitly removed in the Chronic Profile panel.
- **Offline Basic Triage Preview:** When `navigator.onLine === false` or network fails, `js/diagnostics.js` runs compact client offline triage using `injuryRules` + client red-flag keywords with explicit one-click handoff (never mutating silently and never queueing `/api/diagnostics/analyze` into `pulse_offline_write_queue`).

---

### 6. UI Architecture & WCAG AA/AAA Verified Token Spec (`css/styles.css` & `index.html`)

- Zero hardcoded hex literals inside `#injuryModal`, `updateInjuryBadge()`, or `js/diagnostics.js`.
- Verified Contrast Pairings (`>= 4.5:1` AA normal text, `>= 44px` touch targets):
  - Modal dialog: `role="dialog" aria-modal="true" aria-labelledby="injuryModalTitle"`; cards on `var(--surface-card)` / `var(--surface-elevated)`, `1px solid var(--border)`.
  - Triage severity badges & alerts:
    - `green_modify`: `var(--emerald-glow)` fill, `var(--emerald)` text (**5.72:1 AA**) & border.
    - `amber_deload`: `var(--amber-glow)` fill, `var(--amber)` text (**6.55:1 AA**) & border.
    - `red_seek_care` / error / red buttons: `var(--crimson-glow)` fill, `var(--crimson)` border, **`var(--crimson-text)` (`#fca5a5`) text (8.43:1 AAA)** — NEVER `var(--crimson)` for small text and NEVER white text on solid `#ef4444`.
  - Primary CTAs (`#btnAnalyzeInjury`, `#btnApplyDiagHandoff`): `var(--primary)` background with `var(--bg)` dark text (**13.02:1 AAA**).
  - Muted metadata: `var(--text-muted)` on dark surfaces (**6.42–7.23:1 AA+**); `var(--text-dim)` never used for text.
- **Bundle & SW Target:** `js/diagnostics.js` kept modular (`<= 14 KB` raw), added to `index.html?v=6.2`, `sw.js` (`CACHE_NAME = 'pulse-hybrid-v6.2-20261121'`), `manifest.json?v=6.2`, and `tests/test_v61_frontend.js` `SCRIPT_ORDER`.
