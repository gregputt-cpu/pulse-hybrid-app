    // GARMIN & WORKOUT ACTIVITIES STORE (Hydrated dynamically from localStorage & /api/live_state)
    let recentActivitiesData = [];

    function restoreActivitiesFromLocalStorage() {
      try {
        const CURRENT_ACT_VERSION = "v5.38_clean";
        if (localStorage.getItem('pulse_act_version') !== CURRENT_ACT_VERSION) {
          localStorage.removeItem('pulse_recent_activities');
          localStorage.setItem('pulse_act_version', CURRENT_ACT_VERSION);
          return;
        }
        const saved = localStorage.getItem('pulse_recent_activities');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            recentActivitiesData = parsed;
          }
        }
      } catch(e) {
        console.warn("Could not load activities from localStorage:", e);
      }
    }

    // GRANULAR EQUIPMENT & WEIGHT CONFIGURATION
    let gearConfig = {
      barbell: { active: true },
      bench: { active: true },
      dipbar: { active: true },
      db: { active: true, weight: "2×22.5kg" },
      kb: { active: true, weight: "24kg" },
      slamball: { active: false, weight: "10kg" },
      sandbag: { active: false, weight: "15kg" },
      ropes: { active: false },
      speedrope: { active: true },
      lowceiling: { active: true }
    };
    Object.defineProperty(gearConfig, 'dumbbells', {
      enumerable: false,
      configurable: true,
      get() { return this.db; },
      set(v) { this.db = v; }
    });

    const presetProfiles = {
      gym: {
        badge: "TIER 1 • MAXIMAL COMPOUND STRENGTH",
        title: "Gym Barbell Strength & Upper Push Density",
        summary: "Tailored for Readiness 80. Heavy axial barbell compounds paired with dip bar transfer to accelerate push-up capacity while holding 200g protein recomposition.",
        gear: { barbell: true, bench: true, dipbar: true, db: true, kb: true, slamball: false, sandbag: false, ropes: false, speedrope: true, lowceiling: true },
        weights: { db: "2×22.5kg", kb: "24kg", slamball: "10kg", sandbag: "15kg" }
      },
      kb_heavy: {
        badge: "⭐ TIER 1 • HEAVY KETTLEBELL STRENGTH",
        title: "Heavy Kettlebell Strength & Muscle Anchor",
        summary: `Autoregulated for heavy single kettlebell (24–32kg). Maximal mechanical tension and core anti-rotation to anchor ${(window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0) ? (Number(window.athleteProfile.leanMassKg).toFixed(1) + ' kg ') : ''}lean muscle without barbell axial compression.`,
        gear: { barbell: false, bench: false, dipbar: false, db: false, kb: true, slamball: false, sandbag: false, ropes: false, speedrope: false, lowceiling: true },
        weights: { kb: "24kg" }
      },
      mobile: {
        badge: "TIER 1 • OUTDOOR POWER & UNCONVENTIONAL DENSITY",
        title: "Mobile Van Gym • High-Torque Power Circuit",
        summary: "Tailored for Readiness 80. Explosive battle rope waves, sandbag cleans, and kettlebell power tailored for outdoor park training with high anaerobic density.",
        gear: { barbell: false, bench: false, dipbar: false, db: true, kb: true, slamball: true, sandbag: true, ropes: true, speedrope: true, lowceiling: false },
        weights: { db: "2×16kg", kb: "24kg", slamball: "10kg", sandbag: "15kg" }
      },
      cardio: {
        badge: "TIER 1 • METABOLIC AGILITY & SPEED ENGINE",
        title: "Speed Rope Double-Under & Athletic Conditioning",
        summary: "Tailored for Readiness 80. High-frequency speed skipping intervals paired with rapid slam ball thrusters and tempo push-ups for maximal aerobic-anaerobic power.",
        gear: { barbell: false, bench: false, dipbar: false, db: true, kb: false, slamball: true, sandbag: false, ropes: false, speedrope: true, lowceiling: false },
        weights: { db: "2×5kg", kb: "8kg", slamball: "5kg", sandbag: "10kg" }
      },
      custom: {
        badge: "TIER 1 • CUSTOM HYBRID SETUP",
        title: "Custom Equipment & Weight Session",
        summary: "Tailored for Readiness 80 based on your stipulated equipment and active weight selections."
      }
    };

    // EGM 3-ARCHETYPE DAILY TRAINING MATRIX
    const dailyArchetypes = {
      option_a: {
        key: "option_a",
        title: "Option A: Heavy Barbell Strength & Hinge",
        badge: "⭐ RECOMMENDED • BARBELL HYPERTROPHY",
        summary: `Autoregulated for Readiness 88. Heavy compound mechanical tension on chest, back, and hamstrings to protect ${(window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0) ? (Number(window.athleteProfile.leanMassKg).toFixed(1) + ' kg ') : ''}lean mass.`,
        exercises: [
          {
            id: "barbell_rdl",
            name: "Barbell Romanian Deadlift (RDL)",
            family: "hip_hinge",
            targetWeight: 70,
            targetReps: 8,
            setsCount: 4,
            rest: "90s",
            cue: "Hips back, neutral cervical spine, explosive glute lockout.",
            rationale: "Heavy posterior chain neural tension. Signals maximum myofibrillar retention in a deficit without knee shear."
          },
          {
            id: "barbell_floor_press",
            name: "Barbell Flat / Floor Press",
            family: "horizontal_push",
            targetWeight: 65,
            targetReps: 6,
            setsCount: 4,
            rest: "90s",
            cue: "Controlled eccentric, 45° elbow tuck, explosive concentric press.",
            rationale: "Dead-stop removes elastic stretch reflex to build raw concentric push power; transfers directly to push-up strength."
          },
          {
            id: "weighted_dips",
            name: "Dip Bar Chest & Tricep Dips",
            family: "horizontal_push",
            targetWeight: "Body",
            targetReps: 12,
            setsCount: 3,
            rest: "75s",
            cue: "Slight forward torso lean, full tricep lockout at top.",
            rationale: "High-threshold motor unit recruitment for triceps and pec minor; prime kinetic driver to reach 30 unbroken push-ups."
          },
          {
            id: "barbell_pendlay_row",
            name: "Barbell Bent-Over Pendlay Row",
            family: "pull",
            targetWeight: 85,
            targetReps: 8,
            setsCount: 4,
            rest: "90s",
            cue: "Dead-stop from floor each rep, strict horizontal torso.",
            rationale: "Develops lat density and posterior upper-back stability to balance heavy pressing volume and posture."
          },
          {
            id: "barbell_z_press",
            name: "Floor Seated Barbell Z-Press",
            family: "vertical_push",
            targetWeight: 45,
            targetReps: 10,
            setsCount: 3,
            rest: "60s",
            cue: "Seated with straight legs; strict overhead deltoid power.",
            rationale: "Eliminates leg drive, forcing pure deltoid and core anti-extension. Spares lower back."
          }
        ]
      },
      option_kb: {
        key: "option_kb",
        title: "Option KB: Heavy Kettlebell Strength & Tension",
        badge: "⭐ HEAVY KB STRENGTH • AUTOREGULATED",
        summary: `Autoregulated for heavy single kettlebell (24–32kg). Delivers peak mechanical tension to chest, lats, and posterior chain to preserve ${(window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0) ? (Number(window.athleteProfile.leanMassKg).toFixed(1) + ' kg ') : ''}lean muscle without barbell spinal compression.`,
        exercises: [
          {
            id: "kb_clean_and_strict_press",
            name: "Heavy Kettlebell Single-Arm Clean & Strict Press",
            family: "vertical_push",
            targetWeight: "24-32kg",
            targetReps: 6,
            setsCount: 4,
            rest: "75s",
            cue: "Crush grip the bell, clean smoothly to rack, strict vertical drive without knee dip; brace abdominal wall.",
            rationale: "Unilateral overhead mechanical tension and core anti-lateral flexion. Replaces barbell overhead pressing while protecting ceiling clearance and sparing lower back."
          },
          {
            id: "kb_heavy_rdl",
            name: "Heavy Kettlebell Romanian Deadlift (RDL)",
            family: "hip_hinge",
            targetWeight: "24-32kg",
            targetReps: 10,
            setsCount: 4,
            rest: "75s",
            cue: "Hips push back, neutral spine, explode through glutes and hamstrings to lockout.",
            rationale: `Peak posterior chain tension without barbell axial spine loading. Direct transfer to hamstring remodeling and protecting ${(window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0) ? (Number(window.athleteProfile.leanMassKg).toFixed(1) + ' kg ') : ''}lean mass.`
          },
          {
            id: "kb_goblet_floor_press",
            name: "Heavy Kettlebell Floor Press (Single-Arm / Goblet)",
            family: "horizontal_push",
            targetWeight: "24-32kg",
            targetReps: 10,
            setsCount: 4,
            rest: "75s",
            cue: "Elbow touches floor at 45°, deliberate pause to eliminate momentum, explosive chest and tricep drive.",
            rationale: "Concentric upper-body pushing power. Develops pectorals and triceps directly transferable to push-up unbroken capacity."
          },
          {
            id: "kb_gorilla_row",
            name: "Heavy Kettlebell Gorilla Row (Alternating Dead-Stop)",
            family: "pull",
            targetWeight: "24-32kg",
            targetReps: 8,
            setsCount: 4,
            rest: "75s",
            cue: "Hinged flat back, drive elbow to hip, squeeze lat at apex without torso rotation.",
            rationale: "Dead-stop row recruits lats, rhomboids, and rear delts to stabilize posture and balance pressing volume."
          },
          {
            id: "kb_suitcase_carry",
            name: "Heavy Kettlebell Suitcase Carry / March",
            family: "core_carry",
            targetWeight: "24-32kg",
            targetReps: "45s",
            setsCount: 3,
            rest: "60s",
            cue: "Stand tall, do not tilt shoulders, brace oblique core against asymmetric pull.",
            rationale: "High-torque anti-lateral flexion and grip strength. Transfers directly to hybrid functional resilience."
          }
        ]
      },
      option_b: {
        key: "option_b",
        title: "Option B: Hybrid Work Capacity Circuit",
        badge: "WORK CAPACITY • KB & DB DENSITY",
        summary: "Autoregulated for high metabolic work capacity and rotational core power without heavy spinal axial loading.",
        exercises: [
          {
            id: "kb_swings",
            name: "Kettlebell Two-Hand Swings",
            family: "hip_hinge",
            targetWeight: "24-32kg",
            targetReps: 15,
            setsCount: 4,
            rest: "60s",
            cue: "Violent hip snap, bell floats weightless, glutes contracted.",
            rationale: "Ballistic posterior chain power and explosive hip extension reinforcing athletic conditioning."
          },
          {
            id: "db_press",
            name: "Dumbbell Chest Floor Press",
            family: "horizontal_push",
            targetWeight: "2×22kg",
            targetReps: 10,
            setsCount: 4,
            rest: "75s",
            cue: "Pause on floor to eliminate momentum; explosive press to lockout.",
            rationale: "Independent unilateral stabilizer control. Adapts reps to your chosen dumbbell weight."
          },
          {
            id: "slam_ball_slams",
            name: "Rotational Slam Ball Slams",
            family: "hip_hinge",
            targetWeight: "10-15kg",
            targetReps: 12,
            setsCount: 4,
            rest: "45s",
            cue: "Full overhead extension, drive ball through floor with maximal core torque.",
            rationale: "Triple extension hip hinge into aggressive abdominal flexion without joint impact."
          },
          {
            id: "pushups_renegade",
            name: "Floor Push-ups (Tempo 3-0-1)",
            family: "horizontal_push",
            targetWeight: "Body",
            targetReps: 18,
            setsCount: 3,
            rest: "60s",
            cue: "3 second lowering tempo, screw hands into floor, hollow-body glute squeeze.",
            rationale: "Controlled eccentric tempo builds chest density, core tension, and muscular endurance toward the 30-rep unbroken goal."
          },
          {
            id: "speed_rope_intervals",
            name: "Speed Rope Double-Under Ladder",
            family: "cardio",
            targetWeight: "Rope",
            targetReps: "45s",
            setsCount: 6,
            rest: "15s",
            cue: "Wrists rotate tight near hips, light bounce on balls of feet.",
            rationale: "Calf stiffness, ankle reactivity, and fast-twitch cardiovascular conditioning matching athletic speed-skipping agility."
          }
        ]
      },
      option_c: {
        key: "option_c",
        title: "Option C: Aerobic Flush & Joint Restoration",
        badge: "ACTIVE RECOVERY • PREHAB & FLUSH",
        summary: "Autoregulated to clear metabolic waste from morning cardio, restore knee synovial fluid, and stimulate visceral fat oxidation with 0 CNS debt.",
        exercises: [
          {
            id: "zone2_flush",
            name: "Incline Cadence Walk / Ruck (Zone 2)",
            family: "cardio",
            targetWeight: "Body / Pack",
            targetReps: "20 min",
            setsCount: 1,
            rest: "60s",
            cue: "Nasal breathing only; gentle rhythmic hip and ankle propulsion (HR 105–120 bpm).",
            rationale: "Promotes venous return, clears blood lactate, and stimulates pure mitochondrial fat oxidation."
          },
          {
            id: "knee_tke",
            name: "Banded Terminal Knee Extensions (TKE)",
            family: "squat",
            targetWeight: "Band",
            targetReps: 20,
            setsCount: 3,
            rest: "45s",
            cue: "Loop band behind knee; drive heel down and lock vastus medialis hard.",
            rationale: "Increases knee joint synovial fluid circulation and restores patellar tracking after plyometric loading."
          },
          {
            id: "glute_bridge_hold",
            name: "Glute Bridge Isometric & Walkouts",
            family: "hip_hinge",
            targetWeight: "Body",
            targetReps: 15,
            setsCount: 3,
            rest: "45s",
            cue: "Squeeze glutes hard at top; decompress anterior hip flexors from running.",
            rationale: "Awakens dormant gluteal fibers, stabilizes pelvis, and decompresses lumbar spine."
          },
          {
            id: "deadbug_hold",
            name: "Deadbug Anti-Extension Core Brace",
            family: "pull",
            targetWeight: "Body",
            targetReps: "45s",
            setsCount: 3,
            rest: "45s",
            cue: "Press lumbar spine flat into floor; prevent any lower back arching.",
            rationale: "Deep transverse abdominis activation without spinal flexion or compressive shear."
          }
        ]
      }
    };

    // ==================== REST TIMER HELPER ====================
    function parseRestSeconds(restVal) {
      if (typeof restVal === 'number' && !isNaN(restVal) && restVal > 0) {
        return Math.round(restVal);
      }
      if (!restVal) return 60;
      const s = String(restVal).trim().toLowerCase();
      // Match minutes & seconds like 2 min, 1m 30s, 1m30s, 2m
      const minSecMatch = s.match(/(\d+)\s*(?:m|min)(?:\s*(\d+)\s*(?:s|sec)?)?/);
      if (minSecMatch) {
        const mins = parseInt(minSecMatch[1], 10) || 0;
        const secs = minSecMatch[2] ? (parseInt(minSecMatch[2], 10) || 0) : 0;
        return (mins * 60) + secs;
      }
      // Match seconds like 60s, 75s, 90s, 120s, 90 sec, or pure number string 90
      const secMatch = s.match(/(\d+)\s*(?:s|sec)?/);
      if (secMatch) {
        return parseInt(secMatch[1], 10) || 60;
      }
      return 60;
    }

    // ==================== TODAY EXERCISE SWAPS STORAGE ====================
    function getTodayExerciseSwaps() {
      if (typeof readTodayExerciseSwaps === 'function') {
        return readTodayExerciseSwaps();
      }
      try {
        const raw = localStorage.getItem('pulse_today_exercise_swaps');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.date && parsed.swaps && typeof parsed.swaps === 'object') {
              const todayStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
              return (!todayStr || parsed.date === todayStr) ? parsed.swaps : {};
            }
            if (!parsed.date) return parsed;
          }
        }
      } catch(e) {}
      return {};
    }

    function setTodayExerciseSwap(optId, idx, exId) {
      const swaps = getTodayExerciseSwaps();
      swaps[`${optId}_${idx}`] = exId;
      if (typeof writeTodayExerciseSwaps === 'function') {
        writeTodayExerciseSwaps(swaps);
        return;
      }
      try {
        const todayStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
        localStorage.setItem('pulse_today_exercise_swaps', JSON.stringify(
          todayStr ? { date: todayStr, swaps } : swaps
        ));
      } catch(e) {}
    }

    // ==================== PERSONAL CUSTOM EXERCISES & PREFERENCES ====================
    function getCustomExercises() {
      try {
        const raw = localStorage.getItem('pulse_custom_exercises');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) return list;
        }
      } catch(e) {}
      if (window.BAKED_LIVE_STATE?.exercise_preferences?.custom_exercises && Array.isArray(window.BAKED_LIVE_STATE.exercise_preferences.custom_exercises)) {
        return window.BAKED_LIVE_STATE.exercise_preferences.custom_exercises;
      }
      return [];
    }

    async function syncExercisePreferencesToApi(prefs) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/preferences/exercises', prefs, 'POST');
        return;
      }
      try {
        const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)('/api/preferences/exercises', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
          timeoutMs: 4000
        });
        if (!res || !res.ok) {
          if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/preferences/exercises', prefs, 'POST');
        }
      } catch(e) {
        if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/preferences/exercises', prefs, 'POST');
        console.warn('syncExercisePreferencesToApi queued offline:', e);
      }
    }

    function saveCustomExercise(exObj) {
      if (!exObj || !exObj.id) return;
      const list = getCustomExercises();
      const existingIdx = list.findIndex(e => e.id === exObj.id);
      if (existingIdx >= 0) {
        list[existingIdx] = exObj;
      } else {
        list.push(exObj);
      }
      try {
        localStorage.setItem('pulse_custom_exercises', JSON.stringify(list));
      } catch(e) {}
      if (!window.BAKED_LIVE_STATE) window.BAKED_LIVE_STATE = {};
      if (!window.BAKED_LIVE_STATE.exercise_preferences) window.BAKED_LIVE_STATE.exercise_preferences = {};
      window.BAKED_LIVE_STATE.exercise_preferences.custom_exercises = list;
      syncExercisePreferencesToApi({ custom_exercises: list });
    }

    function createCustomExerciseObj(id, name, family, weight, reps, rest, cue, rationale) {
      return {
        id: id || ('custom_' + Date.now()),
        name: name || 'Custom Exercise',
        family: family || 'horizontal_push',
        targetWeight: weight !== undefined ? weight : 'Body',
        targetReps: reps !== undefined ? reps : 10,
        getBaseWeight: () => weight !== undefined ? weight : 'Body',
        getBaseReps: () => reps !== undefined ? reps : 10,
        setsCount: 3,
        rest: rest || '60s',
        cue: cue || generateAutoCue(name, family),
        rationale: rationale || generateAutoRationale(name, family),
        goals: ["recomp", "work_capacity"],
        requiredGear: []
      };
    }

    function getAllExercises() {
      const base = (typeof masterExercises !== 'undefined') ? masterExercises : [];
      const customs = getCustomExercises().map(e => ({
        ...e,
        getBaseWeight: typeof e.getBaseWeight === 'function' ? e.getBaseWeight : (() => (e.targetWeight !== undefined ? e.targetWeight : 'Body')),
        getBaseReps: typeof e.getBaseReps === 'function' ? e.getBaseReps : (() => (e.targetReps !== undefined ? e.targetReps : 10))
      }));
      return [...base, ...customs];
    }

    function generateAutoRationale(name, family) {
      const display = name || 'Exercise';
      switch (family) {
        case 'horizontal_push':
          return `Targeted anterior mechanical tension for ${display}, developing pectoral and tricep pressing power while protecting the shoulder capsule.`;
        case 'hip_hinge':
          return `Posterior chain recruitment with ${display}, reinforcing hamstring, gluteal, and lumbar motor control under controlled tension.`;
        case 'squat':
          return `Quad-dominant and glute extensor loading with ${display}, building unilateral and bilateral knee-dominant power without joint shear.`;
        case 'pull':
          return `Upper back, rhomboid, and lat hypertrophy with ${display}, maintaining structural shoulder balance against heavy pressing volume.`;
        case 'vertical_push':
          return `Deltoid and upper chest recruitment with strict abdominal anti-extension bracing during ${display}.`;
        case 'cardio':
          return `Mitochondrial biogenesis, work capacity expansion, and athletic conditioning through ${display}.`;
        case 'core_carry':
          return `Anti-lateral flexion, spinal erector endurance, and foundational bracing capacity via ${display}.`;
        case 'mobility':
          return `Active joint decompression and tissue restoration with ${display}, optimizing movement mechanics and relieving local tightness.`;
        case 'functional':
        default:
          return `Functional multi-planar movement development with ${display}, improving kinetic chain transfer and athletic durability.`;
      }
    }

    function generateAutoCue(name, family) {
      switch (family) {
        case 'horizontal_push':
          return "Brace core tightly, control the eccentric descent, drive aggressively through palms to full lockout.";
        case 'hip_hinge':
          return "Hips back like reaching for a wall, neutral spine, snap hips forward into hard glute squeeze.";
        case 'squat':
          return "Chest proud, descend between hips with knees tracking over toes, drive floor away.";
        case 'pull':
          return "Depress shoulders down and back, pull elbows into hips, pause and squeeze scapulae.";
        case 'vertical_push':
          return "Squeeze glutes and brace ribcage down, press vertically without overarching lumbar spine.";
        case 'cardio':
          return "Maintain steady cadence, rhythmic nasal breathing, smooth athletic foot strike.";
        case 'core_carry':
          return "Stand tall with shoulders squared, small controlled heel-to-toe strides, immovable core brace.";
        case 'mobility':
          return "Smooth continuous breathing, gentle movement through end range without sharp pinching.";
        case 'functional':
        default:
          return "Move with strict control, maintain rigid core tension, and prioritize pristine joint alignment.";
      }
    }

    function getPermanentSwaps() {
      try {
        const raw = localStorage.getItem('pulse_permanent_swaps');
        if (raw) return JSON.parse(raw) || {};
      } catch(e) {}
      if (window.BAKED_LIVE_STATE?.exercise_preferences?.permanent_swaps && typeof window.BAKED_LIVE_STATE.exercise_preferences.permanent_swaps === 'object') {
        return window.BAKED_LIVE_STATE.exercise_preferences.permanent_swaps;
      }
      return {};
    }

    function savePermanentSwap(origExId, newExId) {
      if (!origExId || !newExId) return;
      const swaps = getPermanentSwaps();
      swaps[origExId] = newExId;
      try {
        localStorage.setItem('pulse_permanent_swaps', JSON.stringify(swaps));
      } catch(e) {}
      if (!window.BAKED_LIVE_STATE) window.BAKED_LIVE_STATE = {};
      if (!window.BAKED_LIVE_STATE.exercise_preferences) window.BAKED_LIVE_STATE.exercise_preferences = {};
      window.BAKED_LIVE_STATE.exercise_preferences.permanent_swaps = swaps;
      syncExercisePreferencesToApi({ permanent_swaps: swaps });
    }

    function removePermanentSwap(origExId) {
      if (!origExId) return;
      const swaps = getPermanentSwaps();
      if (swaps[origExId]) {
        delete swaps[origExId];
        try {
          localStorage.setItem('pulse_permanent_swaps', JSON.stringify(swaps));
        } catch(e) {}
        if (!window.BAKED_LIVE_STATE) window.BAKED_LIVE_STATE = {};
        if (!window.BAKED_LIVE_STATE.exercise_preferences) window.BAKED_LIVE_STATE.exercise_preferences = {};
        window.BAKED_LIVE_STATE.exercise_preferences.permanent_swaps = swaps;
        syncExercisePreferencesToApi({ permanent_swaps: swaps });
      }
    }

    function getHiddenExercises() {
      try {
        const raw = localStorage.getItem('pulse_hidden_exercises');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) return list;
        }
      } catch(e) {}
      if (window.BAKED_LIVE_STATE?.exercise_preferences?.hidden_exercises && Array.isArray(window.BAKED_LIVE_STATE.exercise_preferences.hidden_exercises)) {
        return window.BAKED_LIVE_STATE.exercise_preferences.hidden_exercises;
      }
      return [];
    }

    function addHiddenExercise(exId) {
      if (!exId) return;
      const list = getHiddenExercises();
      if (!list.includes(exId)) {
        list.push(exId);
        try {
          localStorage.setItem('pulse_hidden_exercises', JSON.stringify(list));
        } catch(e) {}
        if (!window.BAKED_LIVE_STATE) window.BAKED_LIVE_STATE = {};
        if (!window.BAKED_LIVE_STATE.exercise_preferences) window.BAKED_LIVE_STATE.exercise_preferences = {};
        window.BAKED_LIVE_STATE.exercise_preferences.hidden_exercises = list;
        syncExercisePreferencesToApi({ hidden_exercises: list });
      }
    }

    function unhideAllExercises() {
      try {
        localStorage.removeItem('pulse_hidden_exercises');
      } catch(e) {}
      if (window.BAKED_LIVE_STATE?.exercise_preferences) {
        window.BAKED_LIVE_STATE.exercise_preferences.hidden_exercises = [];
      }
      syncExercisePreferencesToApi({ hidden_exercises: [] });
      showToast("Reset all hidden exercises.");
      if (typeof renderTodayTrainingRecommendations === 'function') {
        renderTodayTrainingRecommendations();
      }
      const hiddenBar = document.getElementById('hiddenExercisesBar');
      if (hiddenBar) hiddenBar.innerHTML = '';
      if (typeof renderSwapOptions === 'function') {
        renderSwapOptions();
      }
    }

    function resolvePreferredExerciseId(exId, family = null, todayKey = null) {
      // 1) Check todayKey in getTodayExerciseSwaps()
      if (todayKey) {
        const todaySwaps = getTodayExerciseSwaps();
        if (todaySwaps[todayKey]) {
          return todaySwaps[todayKey];
        }
      }

      // 2) Check getPermanentSwaps()[exId]
      const permSwaps = getPermanentSwaps();
      if (permSwaps[exId]) {
        return permSwaps[exId];
      }

      // 3) If exId is in getHiddenExercises()
      const hidden = getHiddenExercises();
      if (hidden.includes(exId)) {
        const all = getAllExercises();
        let targetFam = family;
        if (!targetFam) {
          const match = all.find(e => e.id === exId);
          if (match && match.family) targetFam = match.family;
        }
        if (targetFam) {
          const nonHidden = all.find(e => e.family === targetFam && !hidden.includes(e.id) && e.id !== exId);
          if (nonHidden) return nonHidden.id;
        }
        return exId;
      }

      // 4) Otherwise return exId
      return exId;
    }

    let currentArchetypeKey = 'option_a';
    window._userManualArchetype = false;
    let activeWorkoutPlan = [];
    let currentExIdx = 0;

    function getKbSubMode() {
      try {
        const saved = localStorage.getItem('pulse_kb_submode');
        if (saved === 'flow_2h' || saved === 'flow_1h' || saved === 'grinds') return saved;
      } catch(e) {}
      return 'flow_2h';
    }

    function setKbSubMode(mode) {
      const valid = (mode === 'flow_2h' || mode === 'flow_1h' || mode === 'grinds') ? mode : 'flow_2h';
      try { localStorage.setItem('pulse_kb_submode', valid); } catch(e) {}
      loadDailyArchetype('option_kb');
    }
    window.setKbSubMode = setKbSubMode;


    // STATE VARIABLES & FILTER CONTROLS
    let todayFilterLocation = 'all'; // 'all' | 'gym' | 'kb' | 'bodyweight'
    let todayFilterFocus = 'auto'; // 'auto' | 'strength' | 'upper' | 'hinge' | 'conditioning' | 'flush'
    let swapModalMode = 'swap'; // 'swap' | 'add'

    function setTodayWorkoutFilter(type, value) {
      if (type === 'location') todayFilterLocation = value;
      else if (type === 'focus') todayFilterFocus = value;
      renderTodayTrainingRecommendations();
    }

    const masterExercises = [
      {
        id: "barbell_rdl",
        name: "Barbell Romanian Deadlift (RDL)",
        family: "hip_hinge",
        requiredGear: ["barbell"],
        getBaseWeight: () => 70,
        getBaseReps: () => 8,
        rest: "90s",
        cue: "Hips back, neutral cervical spine, explosive glute lockout.",
        rationale: "Heavy posterior chain neural tension. Signals maximum myofibrillar retention in a deficit without overhead clearance issues.",
        setsCount: 4,
        goals: ["recomp", "rdl"]
      },
      {
        id: "barbell_floor_press",
        name: "Barbell Floor Press",
        family: "horizontal_push",
        requiredGear: ["barbell"],
        getBaseWeight: () => 95,
        getBaseReps: () => 6,
        rest: "90s",
        cue: "Elbows touch floor softly at 45°; saves shoulders & protects studio floor.",
        rationale: "Dead-stop removes elastic stretch reflex to build raw concentric push power; transfers directly to push-up strength.",
        setsCount: 4,
        goals: ["recomp", "pushups"]
      },
      {
        id: "barbell_bench_press",
        name: "Barbell Flat Bench Press",
        family: "horizontal_push",
        requiredGear: ["barbell", "bench"],
        getBaseWeight: () => 65,
        getBaseReps: () => 8,
        rest: "90s",
        cue: "Shoulder blades retracted, leg drive, touch lower sternum.",
        rationale: "Full-range chest and tricep recruitment. Highest motor-unit recruitment for upper body horizontal push capacity.",
        setsCount: 4,
        goals: ["recomp", "pushups"]
      },
      {
        id: "weighted_dips",
        name: "Dip Bar Chest & Tricep Dips",
        family: "horizontal_push",
        requiredGear: ["dipbar"],
        getBaseWeight: () => "Body",
        getBaseReps: () => 12,
        rest: "75s",
        cue: "Slight forward torso lean, full tricep lockout at top.",
        rationale: "High-threshold motor unit recruitment for triceps and pec minor; prime kinetic driver to reach 30 unbroken push-ups.",
        setsCount: 3,
        goals: ["pushups", "recomp"]
      },
      {
        id: "barbell_zercher_squat",
        name: "Barbell Zercher Squat",
        family: "squat",
        requiredGear: ["barbell"],
        getBaseWeight: () => 75,
        getBaseReps: () => 10,
        rest: "120s",
        cue: "Bar in crook of elbows, upright torso, deep core brace; zero ceiling clearance needed.",
        rationale: "Deep anterior core brace and knee-dominant loading. Eliminates ceiling collision risk while sparing lumbar spine.",
        setsCount: 3,
        goals: ["recomp", "rdl"]
      },
      {
        id: "barbell_pendlay_row",
        name: "Barbell Bent-Over Pendlay Row",
        family: "pull",
        requiredGear: ["barbell"],
        getBaseWeight: () => 85,
        getBaseReps: () => 8,
        rest: "90s",
        cue: "Torso strictly parallel to floor, explosive pull to upper abdomen.",
        rationale: "Dead-stop row develops lat density and posterior upper-back stability to balance heavy pressing volume and posture.",
        setsCount: 4,
        goals: ["recomp", "rdl"]
      },
      {
        id: "barbell_z_press",
        name: "Floor Seated Barbell Z-Press",
        family: "vertical_push",
        requiredGear: ["barbell", "lowceiling"],
        getBaseWeight: () => 45,
        getBaseReps: () => 10,
        rest: "60s",
        cue: "Seated on floor with legs straight; builds strict core & keeps bar safely below ceiling.",
        rationale: "Eliminates leg drive, forcing pure deltoid and core anti-extension. Perfectly stays below studio ceiling height.",
        setsCount: 3,
        goals: ["recomp", "pushups"]
      },
      {
        id: "db_press",
        name: "Dumbbell Chest Floor Press",
        family: "horizontal_push",
        requiredGear: ["db"],
        getBaseWeight: () => gearConfig.db.weight,
        getBaseReps: () => {
          const w = parseInt(String(gearConfig.db.weight || '').replace(/^2\s*[×x]\s*/i, '')) || 22;
          return w <= 10 ? 18 : w <= 16 ? 12 : 8;
        },
        rest: "75s",
        cue: "Palms at 45°, deliberate pause at floor, explosive press to lockout.",
        rationale: "Independent unilateral stabilizer control. Adapts reps to your chosen dumbbell weight.",
        setsCount: 4,
        goals: ["pushups", "recomp"]
      },
      {
        id: "kb_swings",
        name: "Kettlebell Two-Hand Swings",
        family: "hip_hinge",
        requiredGear: ["kb"],
        getBaseWeight: () => gearConfig.kb.weight,
        getBaseReps: () => {
          const w = parseInt(gearConfig.kb.weight) || 24;
          return w <= 12 ? 25 : w <= 20 ? 20 : 15;
        },
        rest: "60s",
        cue: "Violent hip hinge, glute contraction at top, bell floats weightless.",
        rationale: "Ballistic posterior chain power. Rapid hip extension reinforces RDL motor patterns.",
        setsCount: 4,
        goals: ["recomp", "rdl", "work_capacity"]
      },
      {
        id: "slam_ball_slams",
        name: "Rotational Slam Ball Slams",
        family: "hip_hinge",
        requiredGear: ["slamball"],
        getBaseWeight: () => gearConfig.slamball.weight,
        getBaseReps: () => {
          const w = parseInt(gearConfig.slamball.weight) || 10;
          return w <= 5 ? 20 : w <= 10 ? 15 : 12;
        },
        rest: "45s",
        cue: "Full overhead extension, throw through the floor with maximal core torque.",
        rationale: "Triple extension hip hinge into aggressive abdominal flexion. Explosive conditioning power without joint impact.",
        setsCount: 4,
        goals: ["work_capacity", "recomp"]
      },
      {
        id: "speed_rope_intervals",
        name: "Speed Rope Intervals",
        family: "cardio",
        format: "interval",
        workSec: 45,
        restSec: 15,
        rounds: 6,
        requiredGear: ["speedrope"],
        getBaseWeight: () => "Rope",
        getBaseReps: () => "45s",
        rest: "15s",
        cue: "Wrists rotate tight near hips, light bounce on balls of feet. Stay relaxed in shoulders.",
        rationale: "Calf stiffness, Achilles reactivity, and fast-twitch cardiovascular conditioning. Time-based intervals scale density cleanly.",
        setsCount: 6,
        goals: ["work_capacity", "recomp"]
      },
      {
        id: "emom_hybrid_10",
        name: "10-Min Hybrid EMOM (Swings + Rope)",
        family: "cardio",
        format: "emom",
        workSec: 60,
        restSec: 0,
        rounds: 10,
        requiredGear: [],
        getBaseWeight: () => "KB / Rope",
        getBaseReps: () => "10m EMOM",
        rest: "EMOM",
        flowSteps: [
          '12 KB Swings (Odd Min)',
          '10 Push-Ups or 8 Goblet Squats (Even Min)'
        ],
        cue: "Odd Mins: 15 KB Swings (or 15 Air Squats) • Even Mins: 45s Speed Rope (or High Knees). Rest remainder of each minute.",
        rationale: "Every-Minute-On-the-Minute pacing builds aerobic power and repeatable work capacity while capping systemic CNS fatigue.",
        setsCount: 10,
        goals: ["work_capacity", "recomp", "kb_strength"]
      },
      {
        id: "amrap_hybrid_10",
        name: "10-Min Engine AMRAP",
        family: "cardio",
        format: "amrap",
        durationSec: 600,
        rounds: 1,
        requiredGear: [],
        getBaseWeight: () => "Body / KB",
        getBaseReps: () => "10:00 AMRAP",
        rest: "Continuous",
        flowSteps: [
          '10 KB Swings',
          '8 Goblet Squats',
          '6 Push-Ups',
          '10m Bear Crawl / 20s Plank'
        ],
        cue: "Cycle cleanly: 10 KB Swings + 10 Push-Ups + 40 Speed Rope Skips. Log each completed round.",
        rationale: "Continuous density benchmark that tracks total rounds completed over time for measurable metabolic progression.",
        setsCount: 1,
        goals: ["work_capacity", "recomp"]
      },
      {
        id: "tabata_rope_core",
        name: "Tabata Conditioning (20s / 10s × 8)",
        family: "cardio",
        format: "interval",
        workSec: 20,
        restSec: 10,
        rounds: 8,
        requiredGear: [],
        getBaseWeight: () => "Rope / Body",
        getBaseReps: () => "20s/10s",
        rest: "10s",
        cue: "Max crisp effort for 20s (speed rope, mountain climbers, or shadow boxing), 10s nasal reset.",
        rationale: "4-minute VO2max & glycolytic spike with minimal joint wear and high EPOC afterburn.",
        setsCount: 8,
        goals: ["work_capacity", "recomp"]
      },
      {
        id: "for_time_kb_chipper",
        name: "For-Time Conditioning Chipper",
        family: "cardio",
        format: "for_time",
        durationSec: 720,
        rounds: 3,
        requiredGear: [],
        getBaseWeight: () => "KB / Body",
        getBaseReps: () => "3 RFT",
        rest: "For Time",
        flowSteps: [
          '30 KB Swings',
          '25 Goblet Squats',
          '20 Push-Ups',
          '15 1H KB Rows (Each Side)',
          '30 KB Swings'
        ],
        cue: "3 Rounds For Time (12m cap): 20 KB Swings + 15 Goblet Squats + 60s Speed Rope.",
        rationale: "High-output threshold test measuring total completion time as an objective conditioning benchmark.",
        setsCount: 1,
        goals: ["work_capacity", "recomp", "kb_strength"]
      },
      {
        id: "kb_flow_2h_out_about",
        name: "2H Out & About 9-Move Flow (30m AMRAP)",
        family: "cardio",
        format: "kb_flow",
        handMode: "2h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 55,
        kbRepsPerRound: 45,
        flowSteps: [
          "5 Bent-Over Rows",
          "5 Cleans",
          "5 Swings",
          "5 Goblet Squats",
          "5 Bicep Curls",
          "5 OH Tricep Ext",
          "5 Standing Pullovers",
          "10 Hip-to-Halos",
          "10 Push-Ups"
        ],
        cue: "Double-handed unbroken flow: 5 Rows → 5 Cleans → 5 Swings → 5 Goblet Squats → 5 Curls → 5 OH Tricep Ext → 5 Pullovers → 10 Hip-to-Halos → 10 Push-Ups. Then complete your repeating bodyweight intermission (or rest 60s).",
        rationale: "55-rep full-body continuous chain (900 kg KB tonnage/round at 20kg + 10 push-ups) maximizing caloric density, grip endurance, and lean mass retention anywhere.",
        setsCount: 1,
        goals: ["kb_strength", "work_capacity", "recomp", "pushups"]
      },
      {
        id: "kb_flow_2h_tactical_upper",
        name: "2H Tactical Upper & Push-Up Engine Flow",
        family: "cardio",
        format: "kb_flow",
        handMode: "2h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 38,
        kbRepsPerRound: 28,
        flowSteps: [
          "5 Bent-Over Rows",
          "5 Crush Floor Press",
          "5 OH Tricep Ext",
          "5 Crush Bicep Curls",
          "8 Alt Reverse Goblet Lunges",
          "10 Bell-Tap Push-Ups"
        ],
        cue: "Squeeze the bell horns hard on floor press and curls; finish each round with 10 crisp push-ups before your intermission.",
        rationale: "Targets chest, triceps, lats, and push-up endurance without needing a bench or high ceiling.",
        setsCount: 1,
        goals: ["pushups", "kb_strength", "recomp"]
      },
      {
        id: "kb_flow_2h_gladiator_post",
        name: "2H Gladiator Posterior & Trunk Flow",
        family: "cardio",
        format: "kb_flow",
        handMode: "2h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 38,
        kbRepsPerRound: 38,
        flowSteps: [
          "8 Two-Hand Swings",
          "6 Slow KB RDLs",
          "6 Goblet Kang Squats",
          "8 Hip-to-Halos",
          "10 Plank KB Pull-Throughs"
        ],
        cue: "Explosive swings into slow 3-second eccentric RDLs; lock ribs down during halos and pull-throughs.",
        rationale: "Posterior-chain and anti-rotation fat-loss flow sparing shoulders while reinforcing RDL hinge power.",
        setsCount: 1,
        goals: ["rdl", "work_capacity", "recomp"]
      },
      {
        id: "kb_flow_2h_pyramid_1_5",
        name: "2H 1-to-5 Pyramid Ladder Flow",
        family: "cardio",
        format: "kb_flow",
        handMode: "2h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 75,
        kbRepsPerRound: 60,
        flowSteps: [
          "1-2-3-4-5 Bent-Over Rows",
          "1-2-3-4-5 Dead Cleans",
          "1-2-3-4-5 Two-Hand Swings",
          "1-2-3-4-5 Goblet Squats",
          "1-2-3-4-5 Push-Ups"
        ],
        cue: "Do 1 rep of each move, then 2 of each, 3, 4, and 5 (= 1 macro-round of 75 reps) before your intermission.",
        rationale: "Ascending ladder pacing prevents early grip burnout during 30-minute AMRAPs while stacking 75 total reps per round.",
        setsCount: 1,
        goals: ["work_capacity", "recomp", "pushups"]
      },
      {
        id: "kb_flow_1h_armor_chain",
        name: "1H Armor & Athletic Chain (5L → 5R)",
        family: "cardio",
        format: "kb_flow",
        handMode: "1h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 60,
        kbRepsPerRound: 60,
        flowSteps: [
          "5 1H Row (L)",
          "5 1H Clean (L)",
          "5 1H Swing (L)",
          "5 Racked Squat (L)",
          "5 Strict/Push Press (L)",
          "5 OH Reverse Lunge (L)",
          "Switch Hand → Repeat 5R"
        ],
        cue: "Complete all 30 reps on Left without setting the bell down, switch hands via a crisp swing, then complete all 30 reps on Right.",
        rationale: "Unilateral anti-rotation loading challenges obliques, grip, and shoulder stability while keeping heart rate in Zone 3.",
        setsCount: 1,
        goals: ["kb_strength", "work_capacity", "recomp"]
      },
      {
        id: "kb_flow_1h_viking_warrior",
        name: "1H Viking Warrior Conditioning (5L → 5R)",
        family: "cardio",
        format: "kb_flow",
        handMode: "1h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 50,
        kbRepsPerRound: 50,
        flowSteps: [
          "5 1H Swings (L)",
          "5 1H High Pulls (L)",
          "5 Tactical Cleans (L)",
          "5 Push Presses (L)",
          "5 Racked Reverse Lunges (L)",
          "Hand-to-Hand Switch → 5R"
        ],
        cue: "Ballistic hip snap from swings into high pulls and cleans; catch smoothly in the rack before pressing.",
        rationale: "High VO2-max ballistic unilateral chain built for maximum fat oxidation and forearm stamina.",
        setsCount: 1,
        goals: ["work_capacity", "recomp"]
      },
      {
        id: "kb_flow_1h_dan_john_grind",
        name: "1H Dan John Armor + Grind (L → R)",
        family: "cardio",
        format: "kb_flow",
        handMode: "1h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 32,
        kbRepsPerRound: 32,
        flowSteps: [
          "5 1H Gorilla Rows (L)",
          "4 1H Cleans (L)",
          "3 Strict Presses (L)",
          "4 Front Rack Squats (L)",
          "30s Suitcase March (L)",
          "Switch → Repeat Right"
        ],
        cue: "Heavy strict grind sequence; finish each side with a tall-posture 30s suitcase march before switching.",
        rationale: "Gold-standard single-bell hypertrophy and trunk bracing complex for retaining lean mass in a deficit.",
        setsCount: 1,
        goals: ["kb_strength", "recomp"]
      },
      {
        id: "kb_flow_1h_combat_core",
        name: "1H Rotational Combat & Core (5L → 5R)",
        family: "cardio",
        format: "kb_flow",
        handMode: "1h",
        durationSec: 1800,
        defaultWeight: "20kg",
        requiredGear: ["kb"],
        getBaseWeight: () => "20kg",
        getBaseReps: () => "30m AMRAP",
        rest: "Intermission",
        repsPerRound: 56,
        kbRepsPerRound: 48,
        flowSteps: [
          "5 Staggered 1H RDL (L)",
          "5 Clean-to-Thruster (L)",
          "5 Racked Side Bend / Windmill (L)",
          "5 Hand-to-Hand Swings",
          "Repeat L/R + 8 Renegade Row+Push-Ups"
        ],
        cue: "Control the hinge and rotational core tension; keep hips square during the finishing renegade row + push-up combo.",
        rationale: "Rotational athletic core stability paired with push-up density.",
        setsCount: 1,
        goals: ["work_capacity", "recomp", "pushups"]
      },
      {
        id: "pushups_renegade",
        name: "Floor Push-ups (Tempo 3-0-1)",
        family: "horizontal_push",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 18,
        rest: "60s",
        cue: "Hands under shoulders, screw palms into floor, hollow-body glute squeeze.",
        rationale: "Controlled eccentric tempo builds chest density, core tension, and muscular endurance toward the 30-rep unbroken goal.",
        setsCount: 3,
        goals: ["pushups", "recomp", "work_capacity"]
      },
      {
        id: "kb_clean_and_strict_press",
        name: "Heavy Kettlebell Single-Arm Clean & Strict Press",
        family: "vertical_push",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => 6,
        rest: "75s",
        cue: "Crush grip the bell, clean smoothly to rack, strict vertical drive without knee dip; brace abdominal wall.",
        rationale: "Unilateral overhead mechanical tension and core anti-lateral flexion. Replaces barbell overhead pressing while protecting ceiling clearance and sparing lower back.",
        setsCount: 4,
        goals: ["recomp", "pushups", "work_capacity", "kb_strength"]
      },
      {
        id: "kb_heavy_rdl",
        name: "Heavy Kettlebell Romanian Deadlift (RDL)",
        family: "hip_hinge",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "32kg",
        getBaseReps: () => 10,
        rest: "75s",
        cue: "Hips push back, neutral spine, explode through glutes and hamstrings to lockout.",
        rationale: `Peak posterior chain tension without barbell axial spine loading. Direct transfer to hamstring remodeling and protecting ${(window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0) ? (Number(window.athleteProfile.leanMassKg).toFixed(1) + ' kg ') : ''}lean mass.`,
        setsCount: 4,
        goals: ["recomp", "rdl", "kb_strength"]
      },
      {
        id: "kb_goblet_floor_press",
        name: "Heavy Kettlebell Floor Press (Single-Arm / Goblet)",
        family: "horizontal_push",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => 10,
        rest: "75s",
        cue: "Elbow touches floor at 45°, deliberate pause to eliminate momentum, explosive chest and tricep drive.",
        rationale: "Concentric upper-body pushing power. Develops pectorals and triceps directly transferable to push-up unbroken capacity.",
        setsCount: 4,
        goals: ["pushups", "recomp", "kb_strength"]
      },
      {
        id: "kb_gorilla_row",
        name: "Heavy Kettlebell Gorilla Row (Alternating Dead-Stop)",
        family: "pull",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => 8,
        rest: "75s",
        cue: "Hinged flat back, drive elbow to hip, squeeze lat at apex without torso rotation.",
        rationale: "Dead-stop row recruits lats, rhomboids, and rear delts to stabilize posture and balance pressing volume.",
        setsCount: 4,
        goals: ["recomp", "rdl", "kb_strength"]
      },
      {
        id: "kb_front_rack_squat",
        name: "Heavy Kettlebell Front Rack Squat",
        family: "squat",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => 10,
        rest: "90s",
        cue: "Bell held tight in rack, vertical torso, drive knees outward, push floor away through midfoot.",
        rationale: "Anterior core brace and quadricep stimulus without knee shear or spinal compression.",
        setsCount: 3,
        goals: ["recomp", "kb_strength"]
      },
      {
        id: "kb_suitcase_carry",
        name: "Heavy Kettlebell Suitcase Carry / March",
        family: "core_carry",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => "45s",
        rest: "60s",
        cue: "Stand tall, do not tilt shoulders, brace oblique wall against pull.",
        rationale: "High-torque anti-lateral flexion and grip strength. Transfers directly to hybrid functional resilience.",
        setsCount: 3,
        goals: ["work_capacity", "recomp", "kb_strength"]
      },
      {
        id: "barbell_squat",
        name: "Barbell Back Squat",
        family: "squat",
        requiredGear: ["barbell"],
        getBaseWeight: () => 100,
        getBaseReps: () => 8,
        rest: "120s",
        cue: "Chest up, knees track over toes, drive through midfoot.",
        rationale: "Maximal mechanical tension to quadriceps and adductors.",
        setsCount: 4,
        goals: ["recomp", "rdl"]
      },
      {
        id: "zone2_flush",
        name: "Incline Cadence Walk / Ruck (Zone 2)",
        family: "cardio",
        requiredGear: [],
        getBaseWeight: () => "Body / Pack",
        getBaseReps: () => "20 min",
        rest: "60s",
        cue: "Nasal breathing only; gentle rhythmic hip and ankle propulsion (HR 105–120 bpm).",
        rationale: "Promotes venous return, clears blood lactate, and stimulates pure mitochondrial fat oxidation.",
        setsCount: 1,
        goals: ["flush", "work_capacity"]
      },
      {
        id: "knee_tke",
        name: "Banded Terminal Knee Extensions (TKE)",
        family: "squat",
        requiredGear: [],
        getBaseWeight: () => "Band",
        getBaseReps: () => 20,
        rest: "45s",
        cue: "Loop band behind knee; drive heel down and lock vastus medialis hard.",
        rationale: "Increases knee joint synovial fluid circulation and restores patellar tracking after plyometric loading.",
        setsCount: 3,
        goals: ["recomp", "flush"]
      },
      {
        id: "glute_bridge_hold",
        name: "Glute Bridge Isometric & Walkouts",
        family: "hip_hinge",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 15,
        rest: "45s",
        cue: "Squeeze glutes hard at top; decompress anterior hip flexors from running.",
        rationale: "Awakens dormant gluteal fibers, stabilizes pelvis, and decompresses lumbar spine.",
        setsCount: 3,
        goals: ["recomp", "flush"]
      },
      {
        id: "deadbug_hold",
        name: "Deadbug Anti-Extension Core Brace",
        family: "pull",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => "45s",
        rest: "45s",
        cue: "Press lumbar spine flat into floor; prevent any lower back arching.",
        rationale: "Deep transverse abdominis activation without spinal flexion or compressive shear.",
        setsCount: 3,
        goals: ["recomp", "flush"]
      },
      {
        id: "thoracic_openers",
        name: "Side-Lying Thoracic Open Book Rotations",
        family: "mobility",
        requiredGear: [],
        getBaseWeight: () => "Bodyweight",
        getBaseReps: () => "60s",
        rest: "30s",
        cue: "Pin knees together at 90°; rotate thoracic spine and follow top hand with eyes without hips shifting.",
        rationale: "Restores rotational mobility in the mid-spine, unlocks ribcage breathing, and relieves anterior shoulder tension.",
        setsCount: 2,
        goals: ["flush", "recomp"]
      },
      {
        id: "couch_stretch_flow",
        name: "Couch Stretch & Hip Flexor Decompression",
        family: "mobility",
        requiredGear: [],
        getBaseWeight: () => "Bodyweight",
        getBaseReps: () => "60s",
        rest: "30s",
        cue: "Squeeze glute on rear leg; stay tall through torso without hyperextending lumbar spine.",
        rationale: "Lengthens hypertonic psoas and rectus femoris from sitting and high step volume, protecting knees and low back.",
        setsCount: 2,
        goals: ["flush", "recomp"]
      },
      {
        id: "narrow_pushups",
        name: "Narrow / Close-Grip Push-Ups",
        family: "horizontal_push",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 12,
        setsCount: 3,
        rest: "60s",
        cue: "Elbows tucked tight against ribs; drive through palms and lock triceps at peak.",
        rationale: "Tricep-biased horizontal press progression building lockout strength for higher unbroken push-up totals.",
        goals: ["recomp", "pushups"]
      },
      {
        id: "incline_pushups",
        name: "Incline Push-Ups (Hands Elevated)",
        family: "horizontal_push",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 15,
        setsCount: 3,
        rest: "60s",
        cue: "Hands on elevated bench or box; maintain strict hollow plank, touch chest softly.",
        rationale: "Horizontal push regression reducing load percentage to accumulate high clean volume and groove movement mechanics.",
        goals: ["recomp", "pushups"]
      },
      {
        id: "bench_dips",
        name: "Bench / Box Tricep Dips",
        family: "horizontal_push",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 12,
        setsCount: 3,
        rest: "60s",
        cue: "Torso upright, shoulders depressed away from ears, press through heels of hands to lockout.",
        rationale: "Triceps and anterior deltoid regression developing vertical-plane push resilience with scalable lever arm.",
        goals: ["recomp", "pushups"]
      },
      {
        id: "db_close_grip_press",
        name: "Dumbbell Close-Grip Floor Press",
        family: "horizontal_push",
        requiredGear: ["dumbbells"],
        getBaseWeight: () => (gearConfig.dumbbells && gearConfig.dumbbells.weight) || "2×20kg",
        getBaseReps: () => 10,
        setsCount: 3,
        rest: "75s",
        cue: "Keep bells touching and elbows brushing ribcage to floor; press straight up with chest tension.",
        rationale: "Neutral-grip tricep and inner-chest overload sparing shoulder capsule while transferring directly to pushing volume.",
        goals: ["recomp", "pushups"]
      },
      {
        id: "db_rdl",
        name: "Dumbbell Romanian Deadlift (RDL)",
        family: "hip_hinge",
        requiredGear: ["dumbbells"],
        getBaseWeight: () => (gearConfig.dumbbells && gearConfig.dumbbells.weight) || "2×22kg",
        getBaseReps: () => 10,
        setsCount: 4,
        rest: "75s",
        cue: "Hinge at hips, keep dumbbells grazing thighs, squeeze hamstrings and glutes to stand tall.",
        rationale: "Bilateral posterior chain hinge with dumbbells allowing personalized wrist rotation and low lumbar sheer.",
        goals: ["recomp", "rdl"]
      },
      {
        id: "single_leg_rdl",
        name: "Single-Leg KB / DB Romanian Deadlift",
        family: "hip_hinge",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => 8,
        setsCount: 3,
        rest: "60s",
        cue: "Hinge on working hip, kick back leg straight like a pendulum, keep pelvis square to floor.",
        rationale: "Unilateral hip hinge addressing pelvic asymmetry, stabilizing foot arch, and loading hamstrings with zero spinal compression.",
        goals: ["recomp", "rdl"]
      },
      {
        id: "hip_thrust_weighted",
        name: "Barbell / KB Glute Bridge / Hip Thrust",
        family: "hip_hinge",
        requiredGear: ["barbell"],
        getBaseWeight: () => 60,
        getBaseReps: () => 10,
        setsCount: 4,
        rest: "75s",
        cue: "Upper back on bench or box, drive through mid-heels, lock hips at 180° with posterior pelvic tilt.",
        rationale: "Maximum gluteus maximus mechanical tension at shortened peak contraction with minimal knee shear.",
        goals: ["recomp", "rdl"]
      },
      {
        id: "goblet_squat",
        name: "Kettlebell / DB Goblet Squat",
        family: "squat",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "24kg",
        getBaseReps: () => 12,
        setsCount: 3,
        rest: "75s",
        cue: "Hold bell close to chest, vertical spine, spread floor with feet and descend between hips.",
        rationale: "Anterior loaded squat pattern grooving upright torso posture and quadricep hypertrophy without spinal loading.",
        goals: ["recomp", "work_capacity"]
      },
      {
        id: "split_squat",
        name: "Bodyweight / DB Bulgarian Split Squat",
        family: "squat",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 10,
        setsCount: 3,
        rest: "75s",
        cue: "Rear foot on bench/box, descend straight down until front thigh is parallel, push through front heel.",
        rationale: "High unilateral quad and glute recruitment eliminating bilateral compensations while saving lower back.",
        goals: ["recomp", "work_capacity"]
      },
      {
        id: "box_step_ups",
        name: "Controlled Step-Ups",
        family: "squat",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 12,
        setsCount: 3,
        rest: "60s",
        cue: "Drive purely through front foot on box; control 2-second eccentric descent without bouncing off floor.",
        rationale: "Knee-friendly concentric-dominant knee extension building single-leg power and glute medius stability.",
        goals: ["recomp", "flush"]
      },
      {
        id: "db_single_arm_row",
        name: "Single-Arm Dumbbell Row",
        family: "pull",
        requiredGear: ["dumbbells"],
        getBaseWeight: () => (gearConfig.dumbbells && gearConfig.dumbbells.weight) || "22kg",
        getBaseReps: () => 10,
        setsCount: 4,
        rest: "75s",
        cue: "Flat back braced on bench or knee, pull elbow towards hip pocket, pause and squeeze lat at peak.",
        rationale: "Unilateral horizontal pull eliminating lat asymmetry, protecting lumbar spine, and strengthening scapular retractors.",
        goals: ["recomp", "pullups"]
      },
      {
        id: "inverted_row",
        name: "Bodyweight / Bar Inverted Row",
        family: "pull",
        requiredGear: ["barbell"],
        getBaseWeight: () => "Body",
        getBaseReps: () => 10,
        setsCount: 3,
        rest: "60s",
        cue: "Straight rigid plank bodyline, pull sternum to bar, pinch shoulder blades together at top.",
        rationale: "Bodyweight horizontal pull building upper back thickness and rhomboid/rear delt endurance without lumbar loading.",
        goals: ["recomp", "pullups"]
      },
      {
        id: "band_pull_aparts",
        name: "Banded Face Pulls / Pull-Aparts",
        family: "pull",
        requiredGear: [],
        getBaseWeight: () => "Band",
        getBaseReps: () => 15,
        setsCount: 3,
        rest: "45s",
        cue: "Arms locked straight, pull band horizontally across chest until it touches sternum, control return.",
        rationale: "Postural scapular retraction and rotator cuff activation counteracting forward-shoulder posture and bench press volume.",
        goals: ["flush", "recomp"]
      },
      {
        id: "half_kneeling_kb_press",
        name: "Half-Kneeling Single-Arm KB/DB Press",
        family: "vertical_push",
        requiredGear: ["kb"],
        getBaseWeight: () => (gearConfig.kb && gearConfig.kb.weight) || "20kg",
        getBaseReps: () => 8,
        setsCount: 3,
        rest: "60s",
        cue: "Down knee glute squeezed tight, vertical torso, press bell overhead without rib flare or lumbar arch.",
        rationale: "Unilateral vertical pressing enforcing anti-extension core stability and pristine glenohumeral mechanics.",
        goals: ["recomp", "kb_strength"]
      },
      {
        id: "pike_pushups",
        name: "Pike Push-Ups (Shoulder Focus)",
        family: "vertical_push",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 10,
        setsCount: 3,
        rest: "60s",
        cue: "Hips high in inverted V, head moves forward of hands in tripod pattern, press floor away to lockout.",
        rationale: "Bodyweight overhead pressing progression loading anterior deltoids and upper pecs with zero equipment.",
        goals: ["recomp", "pushups"]
      },
      {
        id: "plank_shoulder_taps",
        name: "Hollow Plank Shoulder Taps",
        family: "core_carry",
        requiredGear: [],
        getBaseWeight: () => "Body",
        getBaseReps: () => 20,
        setsCount: 3,
        rest: "45s",
        cue: "Feet slightly wider than hips, tap opposite shoulder without hips rocking or rotating.",
        rationale: "High-level anti-rotational core stability and shoulder girdle endurance essential for athletic carryover.",
        goals: ["recomp", "work_capacity"]
      },
      {
        id: "farmers_walk",
        name: "Heavy Dual Farmer's Walk",
        family: "core_carry",
        requiredGear: ["dumbbells"],
        getBaseWeight: () => (gearConfig.dumbbells && gearConfig.dumbbells.weight) || "2×24kg",
        getBaseReps: () => "45s",
        setsCount: 3,
        rest: "60s",
        cue: "Stand tall, ribcage pinned down, take small brisk heel-to-toe strides with immovable core brace.",
        rationale: "Full-body structural integrity, trapezius overload, and crushing grip work capacity.",
        goals: ["work_capacity", "recomp"]
      }
    ];

    const todayWorkoutOptions = [
      {
        id: "bb_upper_hinge",
        title: "Heavy Barbell Upper & Hinge",
        subtitle: "Upper Push Power & Posterior Chain Hinge (Spares Knees)",
        location: "gym",
        focus: "upper",
        durationMin: 45,
        calories: 320,
        gearLabel: "Barbell, Squat Rack & Bench",
        description: "Maximizes compound mechanical tension across squat, bench, hinge, and row to anchor lean mass.",
        exerciseIds: ["barbell_squat", "barbell_bench_press", "barbell_rdl", "barbell_pendlay_row", "barbell_z_press"]
      },
      {
        id: "bb_squat_press",
        title: "Heavy Barbell Squat & Press",
        subtitle: "Full Body Barbell Mechanical Tension & Anterior Chain",
        location: "gym",
        focus: "hinge",
        durationMin: 45,
        calories: 340,
        gearLabel: "Barbell, Squat Rack & Bench",
        description: "Comprehensive compound barbell loading targeting lower extensor drive and horizontal chest power.",
        exerciseIds: ["barbell_squat", "barbell_bench_press", "barbell_pendlay_row", "barbell_rdl"]
      },
      {
        id: "kb_complex",
        title: "Heavy Single-KB Complex",
        subtitle: "Heavy Kettlebell Upper Tension & Rotational Density",
        location: "kb",
        focus: "strength",
        durationMin: 35,
        calories: 310,
        gearLabel: "Single Heavy Kettlebell (24–32kg)",
        description: "Pure myofibrillar retention without spinal axial loading. Perfect for van/studio setting.",
        exerciseIds: ["kb_clean_and_strict_press", "kb_front_rack_squat", "kb_gorilla_row", "kb_swings"]
      },
      {
        id: "hybrid_work_capacity",
        title: "20-Min Hybrid Work Capacity",
        subtitle: "Metabolic Conditioning & Rotational Agility Ladder",
        location: "kb",
        focus: "conditioning",
        durationMin: 20,
        calories: 280,
        gearLabel: "KB, Slam Ball & Speed Rope",
        description: "High density conditioning maintaining athletic speed skipping and explosive triple extension.",
        exerciseIds: ["speed_rope_intervals", "slam_ball_slams", "kb_swings", "pushups_renegade"]
      },
      {
        id: "joint_friendly_hypertrophy",
        title: "Joint-Friendly Hypertrophy",
        subtitle: "Dumbbell & Kettlebell Upper Body High-Threshold Volume",
        location: "gym",
        focus: "upper",
        durationMin: 35,
        calories: 300,
        gearLabel: "Dumbbells, KB & Dip Bar",
        description: "Spares shoulders and spine with neutral grip and floor pressing while driving upper body hypertrophy.",
        exerciseIds: ["db_press", "weighted_dips", "barbell_pendlay_row", "kb_suitcase_carry"]
      },
      {
        id: "recovery_flush_walk",
        title: "20-Min Recovery Flush Walk",
        subtitle: "Zone 1/2 Walk & Knee Synovial Fluid Restoration",
        location: "bodyweight",
        focus: "flush",
        durationMin: 20,
        calories: 140,
        gearLabel: "Bands & Treadmill / Flat Ground",
        description: "Zero spinal compression. Stimulates lymphatic clearance, venous blood return, and joint prehab.",
        exerciseIds: ["zone2_flush", "knee_tke", "glute_bridge_hold", "deadbug_hold"]
      },
      {
        id: "mobility_stretch",
        title: "15-Min Mobility & Stretch Reset",
        subtitle: "Thoracic Rotation, Hip Flexor Decompression & Nervous System Reset",
        location: "bodyweight",
        focus: "flush",
        durationMin: 15,
        calories: 65,
        gearLabel: "Mat / Bodyweight Only",
        description: "Down-regulates sympathetic nervous system tone, restores hip/thoracic range, and accelerates recovery after consecutive training days.",
        exerciseIds: ["thoracic_openers", "couch_stretch_flow", "glute_bridge_hold", "deadbug_hold"]
      }
    ];

