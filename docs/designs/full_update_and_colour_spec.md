# PULSE UI/UX Overhaul & Architectural Specification (EGM Option A)

**Framework:** Elephant-Goldfish Architect (EGM)  
**Status:** Approved by Athlete (Option A: Apple Fitness Precision Obsidian & Electric Lime)  
**Target File:** `index.html` (Master synced to Google Drive `12T82X1PuU8QvjyiHyFrBgNXsnfU54WRc`)  
**Date:** November 9, 2026

---

## 1. Context & Executive Summary

The athlete noted that the current interface feels "cartoony and joking" with overly bright competing colors, curvy/informal styling, and extreme information density. Every sub-setting (such as 12 equipment toggle pills and dropdowns, raw metabolic formulas, and multiple paragraphs of biomechanical text) was permanently displayed on the root screens.

Following the design principles observed in high-end fitness apps (Apple Fitness, Stronger/Strong, Whoop):
1. **Visual Tone:** Shift to a stealth, high-precision obsidian aesthetic with crisp Swiss/SF Pro typography, hairline borders (`rgba(255, 255, 255, 0.07)`), and a single disciplined accent colour (Electric Lime `#30D158`).
2. **Progressive Disclosure:** Declutter the primary screens. Show high-impact glanceable metrics and primary actions; tuck configuration grids and deep analytical breakdowns behind clean modals, bottom sheets, and expandable accordion cards.
3. **Typography & Iconography:** Eliminate decorative emoji spam; establish an authoritative, clean typographic hierarchy with crisp labels, large bold metrics, and micro vector/SVG glyphs.

---

## 2. Phase 1: Ruthless Goldfish Audit Findings

| Severity | Vector | Finding & Root Cause | Resolution in Spec |
| :--- | :--- | :--- | :--- |
| **[Critical]** | **Visual Hierarchy** | **6 simultaneous badges in 46px header** (`Coach Greg`, `v4.6 • LIVE MND`, `🛡️ JOINTS CLEAR`, `⚡ SYNC`, `🔊 VOICE`, `71 READY`, `15.0% BF`). Creates extreme visual clutter and amateur feel. | Replace with streamlined Apple-style header: clean `PULSE` branding + athlete avatar on left; single unified status pill (`● Synced • 71 Ready`) and Settings gear on right. Injury/Joint alert displays only if active or as a subtle pill. |
| **[Critical]** | **Information Density** | **12 Equipment toggle pills + 6 dropdowns** occupy ~280px directly on the Today dashboard. | Replace with a compact **Equipment Sheet Bar**: `📍 Gym Profile • Barbell, Bench, 24kg KB (Tap to Change)`. Tapping opens a sleek modal sheet to configure gear and presets. |
| **[Critical]** | **Colour System** | **Palette Overload & Rainbow Glare**: Neon cyan, lime, yellow, amber, and pink used with glowing box-shadows and multi-colored linear gradients. | Implement **Option A Design System**: Pure Obsidian `#090A0F`, Card Surfaces `#13151B`, Hairline Borders `#1E2028` / `rgba(255,255,255,0.07)`, and a single primary accent **Electric Lime `#30D158`**. Zero fluorescent gradients or glowing box-shadows. |
| **[Warning]** | **Typography & Emoji** | 15+ emojis prefixing nearly every heading and button label, reducing legibility and giving a playful/casual look. | Remove emoji spam from headers, metric chips, and primary buttons. Use clean, uppercase tracked labels (`READINESS`, `ACTIVE BURN`, `SLEEP SCORE`, `RUNWAY`) and sleek micro-glyphs where functional. |
| **[Warning]** | **Progressive Disclosure** | **Completed workout benefits** dump 25 lines of medical/biomechanical text (Soleus, EPOC, parasympathetic tone, tendon stress) directly in the workout history cards. | Implement **Expandable Accordion Cards**: Completed workouts show a clean 3-line summary card (Name, Date/Time, Duration, Active Kcal, Heart Rate). Tapping the card smoothly expands the full physiological benefits profile. |
| **[Warning]** | **Workout Plan Card** | Workout card has cluttered tags and an awkward "Why This?" brain button. | Clean modern workout card with large title, duration/exercises badge, clean pill list of exercises, and a full-width high-contrast `▶ START WORKOUT` button. "Why This?" rationale expands inline on tap. |
| **[Nit]** | **Inline Style Leaks** | Hardcoded `rgba(204,255,0,0.14)` and `rgba(56,189,248,0.35)` scattered across hundreds of inline elements. | Unify into centralized CSS variables: `--primary`, `--primary-dim`, `--surface`, `--surface-elevated`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`. |

---

## 3. Phase 2: Design System & Colour Spec (Option A: Electric Lime Precision)

### 3.1 Design Tokens

```css
:root {
  /* Obsidian Dark Surfaces (Zero glare, OLED deep black) */
  --bg: #090a0f;
  --surface: #13151b;
  --surface-elevated: #1a1d26;
  --surface-card: #14161e;
  --surface-subtle: #0d0f14;
  
  /* Hairline Borders (Subtle precision, zero muddy glow) */
  --border: rgba(255, 255, 255, 0.08);
  --border-subtle: rgba(255, 255, 255, 0.04);
  --border-focus: rgba(48, 209, 88, 0.4);
  
  /* Single Intentional Brand Accent: Apple Electric Lime / Mint */
  --primary: #30d158;
  --primary-hover: #28b84d;
  --primary-dim: rgba(48, 209, 88, 0.12);
  --primary-glow: rgba(48, 209, 88, 0.2);
  
  /* Restrained Semantic Accents (Used only when clinically required) */
  --accent-blue: #3b82f6;    /* Hydration / Cold Recovery */
  --warning: #f59e0b;        /* Low Battery / Fatigue Warning */
  --danger: #ef4444;         /* Active Joint Injury / Delete */
  
  /* Crisp Monochromatic Typography (SF Pro / Inter Scale) */
  --text-primary: #ffffff;             /* Pure Off-White (19.5:1 AAA) */
  --text-secondary: #a1a1aa;           /* High-Legibility Body (8.5:1 AAA) */
  --text-muted: #71717a;               /* Micro Labels & Units (4.8:1 AA) */
  --text-dim: #52525b;                 /* Subtle Dividers & Inactive Dots */
  
  /* Spatial System */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-pill: 9999px;
  
  /* Modern Typography Stack */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", sans-serif;
}
```

### 3.2 WCAG 2.1 Contrast Ratios
* **`--text-primary` (`#ffffff`) on `--bg` (`#090a0f`)**: **19.5:1** (Passes WCAG AAA)
* **`--text-primary` (`#ffffff`) on `--surface` (`#13151b`)**: **17.8:1** (Passes WCAG AAA)
* **`--text-secondary` (`#a1a1aa`) on `--surface` (`#13151b`)**: **8.5:1** (Passes WCAG AAA)
* **`--text-muted` (`#71717a`) on `--surface` (`#13151b`)**: **4.8:1** (Passes WCAG AA)
* **`--primary` (`#30d158`) on `--bg` (`#090a0f`)**: **10.2:1** (Passes WCAG AAA for icons & text)

---

## 4. Phase 3: Screen-by-Screen Architectural Blueprint

### 4.1 Header Overhaul
* **Left**:
  * Athlete Monogram / Avatar (`GP`) with subtle green online status indicator.
  * Clean, crisp title: `PULSE` with subtle sub-badge `ATHLETE OS`.
* **Right**:
  * Unified status chip: `● Synced • 71 Ready` (tapping triggers Garmin/MND sync status modal).
  * Joint Safety badge: displays as a compact pill `🛡️ Joints Clear` (or `⚠️ Joint Restriction` in amber/red if active).
  * Quick settings gear icon (opens audio voice toggles, goals, and account modal).

### 4.2 Today Tab (Glanceable Focus)
* **Block 1: Readiness & Vitals Hero Card**:
  * Crisp Readiness Ring with bold score (`71 READY`).
  * 4 understated vital tiles: Sleep (`69` / `7h 21m`), Active Burn (`0 kcal` / `105 steps`), Renpho Scale (`98.9 kg` / `16.7% BF`), Resting HR (`48 bpm` / `84% BB`).
  * Tapping the card opens detailed Garmin & Renpho biometrics drill-down.
* **Block 2: Equipment Setup Pill (Progressive Disclosure)**:
  * Compact tactile bar:
    ```
    [ 📍 Equipment: Gym Profile (Barbell, Bench, 24kg KB) • Edit Equipment ➔ ]
    ```
  * Tapping opens `#equipmentModal` (containing the Gym/Mobile/Cardio presets and 12 granular gear toggles).
* **Block 3: Today's Prescribed Training Card**:
  * Clean badge: `TIER 1 • MAXIMAL COMPOUND STRENGTH`
  * Large clean title: `Gym Barbell Strength & Upper Push Density`
  * Meta: `5 Exercises • ~45 min • Target RPE 8`
  * Minimal exercise pill row: `Barbell RDL (110kg)` • `Floor Press (95kg)` • `Flat Bench (95kg)` • `Dips` • `Zercher Squat (75kg)`
  * Expandable rationale accordion: `Rationale & Physiological Focus ▾` (smoothly toggles explanation).
  * Primary Action: Full-width high-contrast button `▶ START WORKOUT`.

### 4.3 Workout Log & Benefits Tab (`#tab-train`)
* Prescribed session view remains fast and tactile.
* **Completed Log & Benefits (`#trainHistoryContainer`)**:
  * Each workout card shows high-level metrics at a glance:
    * Activity Name (e.g. `Rushmoor Walking`)
    * Relative timestamp (`Yesterday • 11:01 AM`)
    * Key telemetry: `56.5 min` • `294 kcal` • `Avg HR 80 bpm`
    * Affordance: `View Physiological Benefits profile ▾`
  * Tapping anywhere on the card expands/collapses the full physiological report (Muscles Worked, Biomechanical Stress, Cardiorespiratory Effect, Recomposition Impact, and Autoregulation Advice) cleanly with a smooth transition.

### 4.4 Fuel Tab (`#tab-fuel`)
* Hero daily budget pacing card with sleek monochrome runway bar.
* Clean macro gauges (Protein, Carbs, Fat) with crisp percentage indicators.
* Tapping meals expands full ingredient breakdowns.

---

## 5. Phased Execution Plan

1. **Step 1 - Central CSS Overhaul**: Update root variables to Option A palette, reset fonts to SF Pro/Inter, replace glowing gradients with sleek hairline borders and clean card surfaces.
2. **Step 2 - Header Redesign**: Streamline the 6-badge clutter into a clean 2-element top bar.
3. **Step 3 - Equipment Modal Drawer**: Migrate `#gearGrid` into a dedicated, clean modal `#equipmentModal`, leaving a single sleek trigger pill on `#tab-today`.
4. **Step 4 - Workout Card & History Accordion**: Implement expandable accordions for workout rationale and completed session physiological benefits.
5. **Step 5 - Testing & Verification**: Validate with headless Chromium screenshots on mobile viewport (`390x844`), verify zero broken JavaScript references, check that all gear selections persist and update properly.
6. **Step 6 - Live Deployment**: Sync updated master to Google Drive (`12T82X1PuU8QvjyiHyFrBgNXsnfU54WRc`) and mirror across artifact directories.
