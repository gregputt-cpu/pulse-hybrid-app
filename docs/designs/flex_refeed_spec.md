# PULSE — Telemetry-Backed Earned Flex & Planned Banking Engine Specification

**Target Version:** Next Minor Feature (`v6.4` candidate)  
**Status:** Architecture Specification (Awaiting Implementation Confirmation)  
**Authoritative Anchors:** `backend/analytics_service.py`, `backend/main.py`, `backend/db.py`, `js/fuel-engine.js`, `js/telemetry.js`, `js/state.js`, `index.html`, `css/styles.css`

---

## 1. Objective & Scope

Replace the concept of an untracked "cheat day" with a **two-mode, telemetry-backed Flex & Refeed Engine** that protects weekly fat-loss/recomposition trajectory while giving the athlete predictable, guilt-free psychological rewards and glycogen/recovery support:

1. **Mode A — Earned Flex / Refeed Auto-Unlock (Reactive):** Continuously audits logged MyNetDiary nutrition days, adaptive/computed TDEE, Renpho weight slope, Garmin active burn, and ACWR fatigue markers to unlock a **Flex Snack**, **Flex Meal**, or **Maintenance Refeed Day** when adherence and/or physiological need warrant it.
2. **Mode B — Planned Weekend / Event Banking (Proactive):** Allows the athlete to schedule an upcoming social/reward day (1–7 days ahead) with a chosen calorie boost (`+200` to `+800 kcal`), trimming daily baseline targets slightly ahead of time while locking the daily protein floor and counting only verified logged days toward the bank.

Both modes share a single persistence layer in SQLite (`kv_store`), attach directly to the existing `GET /api/analytics/summary` payload (zero extra startup requests), apply to today's calorie/macro targets inside `recalculate_nutrition()`, and activate a **48-Hour Post-Refeed Scale Shield** after substantial flex/refeed meals so glycogen water fluctuations do not trigger false alarms.

---

## 2. Exact Rules & Eligibility Math

All date windows evaluate in UK time (`Europe/London` via `time_utils.uk_now()` / `uk_today_str()`). Yesterday (`today - 1 day`) and earlier are treated as completed days; `today` is evaluated for real-time burn/claim status without counting an incomplete morning log against the athlete's adherence streak.

### 2.1 Valid Logged Day vs. Unlogged Day Rule

- **Valid Completed Log (`is_logged_day`):** Calories `>= 800 kcal` from merged `mnd_history.days` + authoritative SQLite `daily_nutrition_logs` rows (exact same source-of-truth priority as `compute_adaptive_tdee()` in `backend/analytics_service.py`).
- **Unlogged / Sparse Day (`< 800 kcal`):** Treated strictly as **`neutral / untracked`**.
  - **Invariants:** Unlogged days **never** add deficit credit to the weekly bank, **never** satisfy clean-day streak thresholds, and **never** mint banked calories under Planned Banking. (For Planned Banking, an unlogged intermediate day resets the required daily deduction across remaining future days up to the `200 kcal/day` safe deduction cap.)

### 2.2 Clean Day Rule & Reference Maintenance (`tdee_ref`)

- **Reference Maintenance (`tdee_ref`):**
  1. If `adaptive_tdee["status"] == "ready"` and `estimated_tdee` is finite → `tdee_ref = adaptive_tdee["estimated_tdee"]`.
  2. Else if `state["nutrition"].get("tdee")` is finite and `>= 1400` → `tdee_ref = int(round(state["nutrition"]["tdee"]))`.
  3. Else → `tdee_ref = base_calorie_target + max(0, nutrition.deficit or 350)`.
- **Historical Day Ceiling (`daily_ceiling_d`):**
  - Since historical days already include exercise variability inside `tdee_ref` (when `adaptive_tdee` is `ready`) or stored daily `calorie_target`, compute `daily_ceiling_d = base_calorie_target + scheduled_adjustment_d + 100` (includes a `+100 kcal` practical variance tolerance; when per-day Garmin active burn is unavailable historically, compare against `tdee_ref - 150` if `base_calorie_target` appears below resting-day target, bounded cleanly by `min(base_calorie_target + 250, tdee_ref - 100)` when losing).
- **Clean Day (`is_clean_day`):**
  - `is_logged_day == True` (`calories >= 800`) **AND**
  - `calories <= daily_ceiling_d` **AND**
  - `protein_g >= round(0.85 * protein_target_g)` (85% of protein anchor; prevents low-calorie/low-protein junk days from earning rewards).
- **Rolling Adherent Deficit (`banked_7d_kcal`):**
  - Over completed days `[today - 7 .. today - 1]` where `is_logged_day == True`:
    $$\text{day\_delta}_d = \max(-500,\; tdee\_ref - \text{calories}_d)$$
  - Clamped per day at `tdee_ref - 800` max deficit credit and `-500` overshoot floor so one partial/noisy day neither artificially inflates nor completely wipes a 6-day block, while surplus days legitimately reduce `banked_7d_kcal = max(0, sum(day_delta))`.

### 2.3 The 3-Tier Earned Reward Ladder

Evaluated highest-tier-first (`refeed_day` → `flex_meal` → `flex_snack`), subject to cooldowns in `flex_refeed_history_v1` and Planned Banking exclusions (§2.4):

| Tier | Mode Key | Calorie Boost Rule | Unlock Criteria | Macro Bias & Guardrails | Cooldown |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Flex Snack** | `flex_snack` | `+200` to `+300 kcal` *(default `+250 kcal`, scaled by available weekly bank headroom)* | (`clean_days_5d >= 3`) **OR** (`garmin.active_calories >= 500` **AND** `clean_days_7d >= 3`) | `protein_target_g` locked; bonus allocated ~75% carbs / 25% fat. Does **not** trigger 48h Scale Shield. | **2 days** since any Flex Snack; **3 days** since any Flex Meal / Refeed. |
| **2. Flex Meal** | `flex_meal` | `+400` to `+650 kcal`, capped so `target <= tdee_ref + 150` | (`clean_days_7d >= 5` **AND** `logged_days_7d >= 5` **AND** `banked_7d_kcal >= 1750`) **AND** (if `adaptive_tdee.status == "ready"`: `weight_trend_kg_per_week <= -0.10`) | `protein_target_g` locked; ~65% carbs / 35% fat split of bonus calories. Triggers **48h Scale Shield**. | **5 days** since last Flex Meal, Planned Flex, or Refeed Day. |
| **3. Structured Refeed Day** | `refeed_day` | Raise today's target to `max(normal_target + 300, min(normal_target + 600, tdee_ref))` *(eat at true Maintenance `TDEE + 0`)* | (`clean_days_14d >= 10`) **AND** (`weight_trend_kg_per_week <= -0.65` **OR** `overreaching.status in ("caution", "deload_recommended")` **OR** `len(overreaching.fatigued_markers) >= 1`) | `protein_target_g` locked; **high-carb / moderate-fat bias** (80% carbs / 20% fat of added kcal) for glycogen + leptin recovery. Triggers **48h Scale Shield**. | **12 days** since last Refeed Day (and `>= 5 days` since last Flex Meal). |

### 2.4 Planned Weekend / Event Banking (`flex_bank_plan_v1`)

1. **Plan Creation (`POST /api/fuel/flex/plan`):**
   - **Target Date (`target_date`):** Must be strictly **`today + 1 day` through `today + 7 days`** (UK ISO `YYYY-MM-DD`). UI offers 1-tap chips for upcoming **Fri**, **Sat**, **Sun**, plus a custom date picker within the 7-day window.
   - **Target Reward Boost (`target_kcal`):** Integer `200..800 kcal` (presets: **`+400 kcal` Snack/Dessert**, **`+550 kcal` Flex Meal**, **`+700 kcal` Night Out**).
   - **Optional Label (`label`):** Stripped/plain text `0..40` chars (e.g., `"Saturday Pizza Night"`, escaped via `escapeHtml()` on every DOM render).
2. **Pre-Bank Deduction Math (`save_days`):**
   - `save_days` spans `[plan_start_date .. target_date - 1]` (only active savings days prior to the event; if created mid-day, includes `today` if `mnd_logged.calories <= normal_target - daily_deduction` or begins today cleanly as Day 1).
   - **Raw Daily Trim:** `raw_trim = round(target_kcal / max(1, save_days_remaining))`
   - **Hard Safety Caps:**
     - `daily_deduction = min(200, raw_trim)` (never crash-cuts more than `200 kcal/day`).
     - Effective day target **`>= max(1600, protein_target_g * 4 + 600)` kcal/day** so dietary fat and minimum carbs are never squeezed below physiological floors (`actual_deduction_today` shrinks automatically if base target is near the floor).
     - **`protein_target_g` is NEVER reduced** by banking deductions; deductions come 60% from carbs and 40% from fat above the 40g fat floor.
3. **Anti-Ghost Banking (Earned Progress Tracking):**
   - Each completed day `d` in `[plan_start_date .. min(yesterday, target_date - 1)]` credits **only** if `is_logged_day == True`:
     $$\text{credit}_d = \max(0,\; \min(\text{daily\_deduction} + 100,\; \text{normal\_target\_d} - \text{calories}_d))$$
   - `actual_banked_kcal = sum(credit_d)` across completed logged savings days (plus pro-rata live projection if today is logged and below trimmed ceiling).
   - On `target_date`, `planned_unlock_kcal` equals `max(200, min(target_kcal, actual_banked_kcal))` if `actual_banked_kcal >= 200` (if `0` logged days were banked, `planned_flex` does not unlock full `+700 kcal`; instead displays remaining banked amount or suggests smaller snack / rollover).
4. **Anti-Double-Dipping Invariant:**
   - While a `flex_bank_plan_v1` (`status == "active"`) exists before `target_date`:
     - **Earned `flex_meal` unlocks are paused** (status explains `"Saving +550 kcal for Sat • Earned Flex Meal paused to prevent double-dipping"`).
     - `flex_snack` remains disabled unless an explicit high-burn day (`>= 700 active_calories`) has surplus headroom beyond the daily bank target.
     - **Emergency Physiological Override:** `refeed_day` CAN still surface if `adaptive_tdee.weight_trend_kg_per_week <= -0.75` AND `len(fatigued_markers) >= 2` (health/LBM preservation takes precedence over scheduling).
   - Redeeming a planned flex (`POST /api/fuel/flex/claim` with `mode = "planned_flex"`) clears/marks the plan `claimed`, applies `nutrition.flex_active` for today, writes an entry to `flex_refeed_history_v1`, and enforces the standard **5-day Flex Meal cooldown**.
   - Expired plans (`target_date < today` without claim) auto-transition to `expired` read-state so deductions stop cleanly at UK midnight.

### 2.5 48-Hour Post-Refeed Scale Shield

- **Trigger Window:** `0 <= hours_since_claim <= 48` for any historical claim in `flex_refeed_history_v1` where `mode in ("flex_meal", "refeed_day", "planned_flex")` (explicitly **excluded** for `flex_snack` `200–300 kcal` boosts).
- **Behavior:**
  - Attaches `scale_shield: { active: True, claim_mode, claimed_at, hours_remaining, note }` inside `analytics_summary.flex_refeed`.
  - Renders an Aurora cyber-blue/violet calm banner in `#postRefeedScaleShield` on the **Body** tab and a subtle pill badge on the **Today** tab's Renpho card (`"🛡 Glycogen Shield • 34h"`), clarifying: *"Expected +0.5–1.2 kg water & muscle glycogen retention for 24–48h after your Flex/Refeed — normal hydration physics, not fat gain."*
  - Dismissed automatically when `hours_since_claim > 48` or if the claim is undone on the same day.

---

## 3. Data Schemas & Persistence

Zero SQLite schema migrations required; uses the existing thread-safe `kv_store` (`db.get_kv` / `db.set_kv` in `backend/db.py`) alongside existing `daily_nutrition_logs`, `daily_biometrics`, `renpho_history`, and `live_state.json`.

### 3.1 SQLite `kv_store` Keys

1. **`flex_refeed_history_v1`** (JSON array of objects, FIFO-capped at **30** most recent records):
```json
[
  {
    "claim_id": "flx_20261121_a8f31c",
    "date_str": "2026-11-21",
    "claimed_at": "2026-11-21T18:10:00+00:00",
    "mode": "flex_meal",
    "bonus_kcal": 550,
    "carb_share": 0.65,
    "fat_share": 0.35,
    "triggers_scale_shield": true,
    "plan_id": null,
    "source": "earned"
  }
]
```

2. **`flex_bank_plan_v1`** (JSON object or `null`):
```json
{
  "plan_id": "fbp_20261116_c912e0",
  "status": "active",
  "created_date": "2026-11-16",
  "start_date": "2026-11-16",
  "target_date": "2026-11-21",
  "target_kcal": 600,
  "label": "Saturday Pizza Night",
  "daily_deduction_cap": 120,
  "updated_at": "2026-11-16T09:00:00+00:00"
}
```

### 3.2 `GET /api/analytics/summary` Extension (`flex_refeed` Block)

Attached directly inside `analytics_service.build_analytics_summary(state)` alongside `adaptive_tdee`, `overreaching`, `sync_freshness`, and `strength_prs`:

```json
{
  "adaptive_tdee": { "...": "..." },
  "overreaching": { "...": "..." },
  "sync_freshness": { "...": "..." },
  "strength_prs": { "...": "..." },
  "flex_refeed": {
    "date": "2026-11-21",
    "status": "unlocked",
    "recommended_mode": "flex_meal",
    "eligible_modes": ["flex_snack", "flex_meal"],
    "suggested_bonus_kcal": 550,
    "tdee_ref": 2740,
    "streak": {
      "logged_days_7d": 6,
      "clean_days_5d": 4,
      "clean_days_7d": 5,
      "clean_days_14d": 9,
      "banked_7d_kcal": 2040,
      "day_chips": [
        { "date": "2026-11-15", "state": "clean", "calories": 2110, "protein_g": 205 },
        { "date": "2026-11-16", "state": "unlogged", "calories": 0, "protein_g": 0 }
      ]
    },
    "cooldown": {
      "flex_snack_days_left": 0,
      "flex_meal_days_left": 0,
      "refeed_day_days_left": 0,
      "last_claim": null
    },
    "active_today": {
      "active": false,
      "claim_id": null,
      "mode": null,
      "bonus_kcal": 0,
      "deduction_kcal": 0
    },
    "planned_bank": {
      "active": false,
      "plan_id": null,
      "target_date": null,
      "label": null,
      "target_kcal": 0,
      "actual_banked_kcal": 0,
      "daily_deduction_today": 0,
      "days_remaining": 0,
      "ready_to_redeem": false
    },
    "scale_shield": {
      "active": false,
      "claim_mode": null,
      "hours_remaining": 0,
      "note": ""
    },
    "reason": "5/7 clean logged days and ~2,040 kcal weekly deficit banked — Flex Meal (+550 kcal) unlocked with protein anchor locked."
  }
}
```
*Note on `status` enum:* `"claimed_today"` | `"banking_in_progress"` | `"unlocked"` | `"cooldown"` | `"building"` | `"insufficient_data"`.

### 3.3 `live_state.json` `nutrition` Overlay (`nutrition.flex_active`)

Applied inside `analytics_service.recalculate_nutrition(state, date_str, pref_fields=...)` whenever today has either an active claim in `flex_refeed_history_v1` OR an active `flex_bank_plan_v1` deduction/unlock:

```json
"nutrition": {
  "base_calorie_target": 2092,
  "calorie_target": 2642,
  "protein_target_g": 200,
  "carbs_target_g": 290,
  "fat_target_g": 76,
  "flex_active": {
    "date": "2026-11-21",
    "type": "claim",
    "mode": "flex_meal",
    "adjustment_kcal": 550,
    "carb_delta_g": 89,
    "fat_delta_g": 21,
    "label": "Flex Meal (+550 kcal)",
    "claim_id": "flx_20261121_a8f31c"
  }
}
```
When Planned Banking is actively trimming pre-event days, `"type": "bank_deduction"` and `"adjustment_kcal": -daily_deduction_today` (keeping `protein_target_g` untouched, applying remaining reduction across carbs/fat above floors, and maintaining exact calorie sum consistency). When `state.date` rolls over to the next UK date, `compute_active_flex_delta(today_uk)` ignores prior-date claims automatically.

### 3.4 Write Endpoints (`backend/main.py`)

All routes pass through `api_auth_and_cache_middleware` (authenticated) and execute under `state_store.state_lock(LIVE_STATE_PATH)`.

1. **`POST /api/fuel/flex/claim`**
   - **Request (`FlexClaimPayload`, `ConfigDict(extra="forbid")`):**
     ```json
     { "mode": "flex_meal", "bonus_kcal": 550, "client_event_id": "uuid-optional" }
     ```
     `mode` ∈ `{"flex_snack", "flex_meal", "refeed_day", "planned_flex"}`; optional `bonus_kcal` clamped strictly to the eligible tier ceiling (or computed default if omitted).
   - **Server Checks:**
     - Idempotency via `db.claim_idempotency_key("fuel_flex_claim", client_event_id)` if supplied.
     - Recomputes `compute_flex_refeed_status()` server-side inside `state_lock`: rejects ineligible mode or active same-day claim with **HTTP `409 Conflict`** and clear `detail`.
     - Persists to `flex_refeed_history_v1` (FIFO cap 30), marks active `flex_bank_plan_v1` as `claimed` if `mode == "planned_flex"`, calls `analytics_service.recalculate_nutrition(state, uk_today_str())`, calls `save_live_state(state)`, and returns updated `{ "success": true, "claim": ..., "flex_refeed": ..., "state": state }`.

2. **`POST /api/fuel/flex/undo`**
   - **Request (`FlexUndoPayload`, `ConfigDict(extra="forbid")`):** `{ "claim_id": "flx_..." }` *(optional; defaults to today's active claim)*.
   - **Behavior:** Removes **only** a claim whose `date_str == uk_today_str()`, restores `flex_bank_plan_v1.status` back to `"active"` if it was claimed today by that `plan_id` and `target_date >= today_uk`, calls `recalculate_nutrition()`, saves `live_state.json`, and returns `{ "success": true, "removed_claim_id": ..., "flex_refeed": ..., "state": state }`. Prior-date claims return **HTTP `409`** (immutable history).

3. **`POST /api/fuel/flex/plan`**
   - **Request (`FlexPlanPayload`, `ConfigDict(extra="forbid")`):**
     ```json
     { "action": "upsert", "target_date": "2026-11-28", "target_kcal": 600, "label": "Saturday Pizza" }
     ```
     or `{ "action": "cancel" }`.
   - **Validation (`422`):** `target_date` validated `YYYY-MM-DD` within `[today + 1 .. today + 7]` UK days; `target_kcal` finite integer `200..800`; `label` sanitized with `diagnostics_safety.strip_markup()` and capped `<= 40` chars. Cannot overwrite or create a plan targeting today if an active claim already exists today (`409`).
   - **Side Effects:** Writes/clears `flex_bank_plan_v1`, runs `recalculate_nutrition()` + `save_live_state(state)`, and returns `{ "success": true, "flex_refeed": ..., "state": state }`.

---

## 4. Backend & Frontend Integration Points

### 4.1 Backend Files

- **`backend/analytics_service.py`:**
  - Add `compute_active_flex_delta(state, nutrition_rows=None, renpho_rows=None, sessions=None, manual_acts=None, bio_rows=None, today_str=None, conn=None)` *(or share pre-fetched rows when called from `build_analytics_summary()`)* and `compute_flex_refeed_status(...)` reusing existing `db.get_kv(..., conn=conn)`, `db.get_daily_nutrition(..., conn=conn)`, `compute_adaptive_tdee()`, and `compute_acwr_overreaching()`.
  - Integrate active flex/bank delta cleanly inside `recalculate_nutrition(state, date_str, pref_fields=...)` right after `compute_macro_targets(...)` (adjusting `calorie_target`, `carbs_target_g`, `fat_target_g`, updating `calories_remaining`, keeping `protein_target_g` locked, and setting `nutrition["flex_active"]`).
  - Attach `"flex_refeed": compute_flex_refeed_status(...)` inside `build_analytics_summary(state)`.
- **`backend/main.py`:**
  - Add Pydantic payloads `FlexClaimPayload`, `FlexUndoPayload`, `FlexPlanPayload` using `ConfigDict(extra="forbid")` and `_reject_bool_nonfinite`.
  - Add routes `POST /api/fuel/flex/claim`, `POST /api/fuel/flex/undo`, `POST /api/fuel/flex/plan`.
  - Ensure all existing `recalculate_nutrition()` call sites (`sync_garmin`, `mnd/sync`, `mnd/manual`, `sync_activity`, `preferences/state`) automatically preserve/apply any active daily flex boost or bank deduction!

### 4.2 Frontend Files

- **`index.html`:**
  - Inside `<main id="tab-fuel">` immediately after the Daily Fuel Coach card and before `<div id="nutritionQualityAuditCard">` (`index.html:664`): insert **`<div id="flexRefeedCard" style="margin-bottom: 14px;"></div>`**.
  - Inside `<main id="tab-body">` immediately after the Row 1 Renpho card and before `<div id="biometricSparklinesCard">` (`index.html:886`): insert **`<div id="postRefeedScaleShield"></div>`**.
  - Inside `#tab-today` Renpho card (`index.html:223`): reserve an inline optional badge slot **`<span id="todayScaleShieldPill" class="scale-shield-pill" style="display:none;"></span>`** (updated cleanly without disturbing `#vitalScale` / `#renphoSyncTime`).
- **`css/styles.css`:**
  - Add `.flex-refeed-card`, `.flex-streak-strip`, `.flex-day-chip`, `.flex-bank-drawer`, and `.scale-shield-banner` strictly using CSS variables (`--surface`, `--surface-elevated`, `--surface-card`, `--border`, `--border-bright`, `--primary`, `--primary-dim`, `--emerald`, `--emerald-glow`, `--amber`, `--amber-glow`, `--violet-text`, `--crimson-text`, `--text`, `--text-secondary`, `--text-muted`, `--bg`) with **zero hardcoded hex leaks** and full WCAG AA contrast parity (`color: var(--bg)` on solid `--primary` / `--emerald` / `--amber` buttons).
- **`js/state.js`:**
  - In `window.BAKED_LIVE_STATE` UK midnight rollover block (`js/state.js:127-135`), explicitly reset `flex_active: null` inside rolled-over `nutrition` so yesterday's claimed boost never lingers locally after midnight, and add any local active flex offset clean-up.
- **`js/fuel-engine.js`:**
  - Update `_resolveComputedFuelTargets()` & `getCanonicalDailyCalorieTarget()` (`js/fuel-engine.js:134-183`): ensure local client-side diet/goal switches reflect `(state.nutrition.flex_active.adjustment_kcal || 0)` accurately and never wipe an active same-day flex/bank adjustment on `selectGoal()` or `selectDietStrategy()`.
  - Update `#fuelBaseActiveSub` (`updateRunwayUI()` lines 366-369) and the `📐 How your budget is calculated` math drawer when `flex_active` is active (e.g., `Base 2,092 + 320 Active + 550 Flex Meal`).
  - Implement:
    - `renderFlexRefeedCard(summary)` — renders status pill (`Earned`, `Banking`, `Claimed`, `Building`), 7-day clean-day dot strip (clean = `var(--emerald)`, over = `var(--amber)`, unlogged = muted dash), weekly banked deficit, tier recommendation & explanation, 1-tap **Use Flex Snack / Flex Meal / Refeed Today** CTA (or **Undo Today's Flex** when claimed today), and collapsible **Plan Weekend / Event Bank** controls (Fri/Sat/Sun quick chips + date input, `+400` / `+550` / `+700` preset chips, optional label, Save / Cancel).
    - `renderPostRefeedScaleShield(summary)` — renders `#postRefeedScaleShield` on Body tab and `#todayScaleShieldPill` on Today tab when `scale_shield.active === true`.
    - Async action handlers `claimFlexRefeed(mode, bonusKcal)`, `undoFlexRefeed()`, `saveFlexBankPlan()`, `cancelFlexBankPlan()` using `pulseApiFetch` (online-required for server lock consistency, showing toast guidance if offline rather than blindly faking an eligibility claim), then updating `window.BAKED_LIVE_STATE`, `window.PULSE_ANALYTICS_SUMMARY`, `applyLiveStateToDom()`, and `renderMyNetDiaryEngine()`.
- **`js/telemetry.js`:**
  - Inside `fetchAnalyticsSummary()` (`js/telemetry.js:2759-2796`—cached hydration, live fetch success, and catch fallback), invoke:
    - `if (typeof renderFlexRefeedCard === 'function') renderFlexRefeedCard(summary);`
    - `if (typeof renderPostRefeedScaleShield === 'function') renderPostRefeedScaleShield(summary);`
  - Expose `window.renderFlexRefeedCard`, `window.renderPostRefeedScaleShield`, `window.claimFlexRefeed`, `window.undoFlexRefeed`, `window.saveFlexBankPlan`, `window.cancelFlexBankPlan`.

---

## 5. Edge Cases, Guardrails & Verification Plan

### 5.1 Edge Cases & Safety Guardrails

1. **Unlogged Days / Holiday Gaps:** `< 800 kcal` days are marked `"unlogged"` and excluded from both clean-day streak credits and banked calorie sums.
2. **Stale / Missing Analytics Summary:** When `PULSE_ANALYTICS_SUMMARY` is `null` or `flex_refeed.status == "insufficient_data"`, card renders a calm calibrating message (`"Log 3+ MyNetDiary days to unlock Earned Flex tracking"`) with no phantom CTA buttons.
3. **Offline Behavior:** Claim/Undo/Plan mutations require connectivity (`navigator.onLine !== false`) because eligibility and cooldown invariants live on Railway SQLite; if offline, show a crisp toast (`"Reconnect to claim or schedule Flex budgets"`) instead of risking split-brain math.
4. **Double-Tap / Race Protection:** Claim buttons lock/disable while request is in flight (`client_event_id` idempotency on `/claim`), and `POST /claim` rejects duplicate same-day claims (`409 Conflict`).
5. **UK Midnight Rollover:** Prior-date `flex_active` overlays are ignored server-side when computing today's `recalculate_nutrition()` and cleared client-side in `js/state.js` on `date !== _todayIso`.
6. **Custom Label XSS Safety:** All custom bank labels (`Saturday Pizza Night`, etc.) are sanitized via `strip_markup()` on the backend and escaped with `escapeHtml()` on the frontend.

### 5.2 Verification Plan (To Run on Implementation)

- **Backend Suite (`tests/test_flex_refeed_backend.py`):**
  1. **Unlogged Day Isolation:** Verify `<800 kcal` days earn `0` banked deficit and `0` bank-plan credit.
  2. **3-Tier Eligibility & Cooldowns:** Verify Tier 1 (`3/5` or heavy burn `>=500` + `3/7`), Tier 2 (`5/7` + `>=1750` deficit + negative/absent upward slope), Tier 3 (`10/14` + fast loss `<-0.65` or ACWR `caution`/fatigue), and `409` rejection on cooldown violation or double same-day claim.
  3. **Planned Banking & Anti-Double-Dipping:** Verify daily trim caps (`<=200 kcal/day`), calorie floor protection (`>= max(1600, protein*4+600)`), protein anchor invariance, pause of Earned Flex Meal while active plan exists, redemption linking, and same-day undo restoration.
  4. **Scale Shield Window:** Verify `scale_shield.active == True` for 48h after `flex_meal` / `refeed_day` / `planned_flex`, `False` after `flex_snack`, and `False` after 48h or same-day undo.
  5. **Recalculate Integration & Schema Bounds:** Verify `POST /api/mnd/manual` and `POST /api/preferences/state` preserve active flex adjustments and strict `422` validation rejects malformed dates, negative kcal, booleans, and HTML in labels.
- **Frontend Suite (`tests/test_v61_frontend.js` or `tests/test_flex_refeed_frontend.js`):**
  1. `renderFlexRefeedCard()` renders all states (`unlocked`, `banking_in_progress`, `claimed_today`, `cooldown`, `building`) and escapes hostile `<img onerror=...>` labels.
  2. `renderPostRefeedScaleShield()` shows/hides `#postRefeedScaleShield` and `#todayScaleShieldPill` properly.
  3. UK midnight rollover in `js/state.js` clears stale `nutrition.flex_active`.
  4. `getCanonicalDailyCalorieTarget()` and `applyLiveStateToDom()` reflect `+550 kcal` claimed boost or `-120 kcal` banking trim without overwriting `protein_target_g`.
  5. CSS token audit confirms zero hardcoded hex colors in newly added Flex/Shield rules and WCAG AA contrast compliance.
- **End-to-End Build Verification:** Run `node --check`, `npm run build` (syncing `.vercel/output/`, `dist/`, `public/`, `backend/static/`), and all backend + frontend test suites.
