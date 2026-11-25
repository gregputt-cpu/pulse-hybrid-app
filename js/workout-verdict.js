    const JOINT_CONTRAINDICATIONS = {
      lumbar: new Set([
        'barbell_squat', 'barbell_rdl', 'barbell_zercher_squat', 'barbell_z_press', 'barbell_pendlay_row',
        'kb_heavy_rdl', 'kb_swings', 'kb_front_rack_squat', 'slam_ball_slams',
        'for_time_kb_chipper', 'emom_hybrid_10', 'amrap_hybrid_10'
      ]),
      shoulders: new Set([
        'weighted_dips', 'bench_dips', 'barbell_z_press', 'barbell_bench_press',
        'kb_clean_and_strict_press', 'half_kneeling_kb_press', 'pike_pushups'
      ]),
      knees: new Set([
        'barbell_squat', 'barbell_zercher_squat', 'kb_front_rack_squat', 'goblet_squat', 'split_squat',
        'box_step_ups', 'speed_rope_intervals', 'emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper',
        'kb_goblet_lunge'
      ]),
      elbows: new Set([
        'weighted_dips', 'bench_dips', 'kb_clean_and_strict_press', 'barbell_floor_press',
        'narrow_pushups', 'pushups_renegade', 'slam_ball_slams'
      ]),
      wrists: new Set([
        'pushups_renegade', 'narrow_pushups', 'incline_pushups', 'pike_pushups', 'plank_shoulder_taps',
        'weighted_dips', 'bench_dips', 'kb_clean_and_strict_press', 'kb_front_rack_squat',
        'barbell_zercher_squat', 'emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper'
      ]),
      ankles: new Set([
        'speed_rope_intervals', 'box_step_ups', 'farmers_walk', 'kb_suitcase_carry', 'split_squat',
        'barbell_squat', 'single_leg_rdl', 'emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper'
      ])
    };

    const JOINT_SAFE_SWAPS = {
      lumbar: ['glute_bridge_hold', 'hip_thrust_weighted', 'inverted_row', 'db_press', 'zone2_flush', 'deadbug_hold', 'thoracic_openers'],
      shoulders: ['barbell_floor_press', 'db_close_grip_press', 'band_pull_aparts', 'glute_bridge_hold', 'deadbug_hold', 'zone2_flush'],
      knees: ['knee_tke', 'glute_bridge_hold', 'hip_thrust_weighted', 'zone2_flush', 'deadbug_hold'],
      elbows: ['glute_bridge_hold', 'hip_thrust_weighted', 'zone2_flush', 'deadbug_hold', 'thoracic_openers'],
      wrists: ['barbell_floor_press', 'glute_bridge_hold', 'hip_thrust_weighted', 'deadbug_hold', 'zone2_flush'],
      ankles: ['zone2_flush', 'glute_bridge_hold', 'hip_thrust_weighted', 'deadbug_hold', 'thoracic_openers']
    };

    const JOINT_MOBILITY_FALLBACKS = ['deadbug_hold', 'glute_bridge_hold', 'zone2_flush', 'thoracic_openers'];

    const MOVEMENT_RESTRICTION_EXERCISES = {
      axial_spinal_loading: new Set(['barbell_squat', 'barbell_zercher_squat', 'barbell_z_press', 'barbell_pendlay_row', 'kb_front_rack_squat', 'farmers_walk', 'kb_suitcase_carry']),
      deep_hip_hinge: new Set(['barbell_rdl', 'kb_heavy_rdl', 'db_rdl', 'single_leg_rdl', 'kb_swings', 'slam_ball_slams', 'barbell_pendlay_row', 'kb_gorilla_row', 'for_time_kb_chipper', 'emom_hybrid_10', 'amrap_hybrid_10']),
      overhead_pressing: new Set(['barbell_z_press', 'kb_clean_and_strict_press', 'half_kneeling_kb_press', 'pike_pushups']),
      deep_horizontal_push: new Set(['weighted_dips', 'bench_dips', 'barbell_bench_press', 'pushups_renegade', 'narrow_pushups', 'incline_pushups']),
      deep_knee_flexion: new Set(['barbell_squat', 'barbell_zercher_squat', 'kb_front_rack_squat', 'goblet_squat', 'split_squat', 'box_step_ups', 'kb_goblet_lunge']),
      ballistic_impact: new Set(['speed_rope_intervals', 'tabata_rope_core', 'kb_swings', 'slam_ball_slams', 'emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper']),
      terminal_elbow_lockout: new Set(['weighted_dips', 'bench_dips', 'barbell_bench_press', 'barbell_floor_press', 'kb_clean_and_strict_press', 'half_kneeling_kb_press', 'narrow_pushups', 'pushups_renegade', 'pike_pushups']),
      wrist_extension_load: new Set(['pushups_renegade', 'narrow_pushups', 'incline_pushups', 'pike_pushups', 'plank_shoulder_taps', 'weighted_dips', 'bench_dips', 'kb_clean_and_strict_press', 'kb_front_rack_squat', 'barbell_zercher_squat']),
      heavy_grip_pull: new Set(['barbell_rdl', 'kb_heavy_rdl', 'db_rdl', 'barbell_pendlay_row', 'kb_gorilla_row', 'db_single_arm_row', 'inverted_row', 'farmers_walk', 'kb_suitcase_carry']),
      explosive_calf_achilles: new Set(['speed_rope_intervals', 'tabata_rope_core', 'box_step_ups', 'split_squat', 'emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper'])
    };

    function _hasRequiredGearForExercise(ex, gear) {
      if (!ex || !Array.isArray(ex.requiredGear) || ex.requiredGear.length === 0) return true;
      if (!gear || typeof gear !== 'object') return true;
      for (const rawKey of ex.requiredGear) {
        const gKey = rawKey === 'dumbbells' ? 'db' : rawKey;
        const entry = gear[gKey];
        if (!entry || (!entry.active && !entry.has)) return false;
      }
      return true;
    }

    function getContraindicatingDomains(exOrId, injuries) {
      const inj = injuries || (typeof athleteInjuries !== 'undefined' ? athleteInjuries : null);
      if (!inj || typeof inj !== 'object') return [];
      const exId = typeof exOrId === 'string' ? exOrId : (exOrId && exOrId.id ? exOrId.id : '');
      if (!exId) return [];
      const isKbFlow = exId.startsWith('kb_flow_2h_') || exId.startsWith('kb_flow_1h_');
      const constraintsMap = (inj.active_constraints && typeof inj.active_constraints === 'object') ? inj.active_constraints : null;
      const domains = [];
      for (const domain of Object.keys(JOINT_CONTRAINDICATIONS)) {
        if (!inj[domain]) continue;
        let blocked = isKbFlow || JOINT_CONTRAINDICATIONS[domain].has(exId);
        if (!blocked && constraintsMap && constraintsMap[domain] && typeof constraintsMap[domain] === 'object') {
          const c = constraintsMap[domain];
          if (Array.isArray(c.restricted_exercise_ids) && c.restricted_exercise_ids.includes(exId)) {
            blocked = true;
          } else if (Array.isArray(c.movement_restrictions)) {
            for (const restr of c.movement_restrictions) {
              const rSet = MOVEMENT_RESTRICTION_EXERCISES[restr];
              if (rSet && rSet.has(exId)) {
                blocked = true;
                break;
              }
            }
          }
        }
        if (blocked) domains.push(domain);
      }
      return domains;
    }

    function isExerciseContraindicated(exOrId, injuries) {
      return getContraindicatingDomains(exOrId, injuries).length > 0;
    }

    function applyJointSafeSwaps(candidateList, targetCount = 5, injuries = null, gear = null) {
      if (!Array.isArray(candidateList)) return [];
      const inj = injuries || (typeof athleteInjuries !== 'undefined' ? athleteInjuries : {});
      const gCfg = gear || (typeof gearConfig !== 'undefined' ? gearConfig : null);
      const allEx = (typeof getAllExercises === 'function')
        ? getAllExercises()
        : (typeof masterExercises !== 'undefined' ? masterExercises : []);
      const isIdMode = candidateList.length > 0 && typeof candidateList[0] === 'string';
      const usedIds = new Set();
      const result = [];

      const findExObj = (item) => {
        if (!item) return null;
        if (typeof item === 'string') return allEx.find(e => e.id === item) || { id: item, requiredGear: [] };
        return item;
      };

      const pickSafeReplacement = (triggeringDomains) => {
        const preferredOrder = [];
        triggeringDomains.forEach((d) => {
          (JOINT_SAFE_SWAPS[d] || []).forEach((sid) => {
            if (!preferredOrder.includes(sid)) preferredOrder.push(sid);
          });
        });
        const tryPool = (requireGear) => {
          for (const sid of preferredOrder) {
            if (usedIds.has(sid)) continue;
            const cand = allEx.find(e => e.id === sid);
            if (!cand) continue;
            if (isExerciseContraindicated(cand, inj)) continue;
            if (requireGear && !_hasRequiredGearForExercise(cand, gCfg)) continue;
            return cand;
          }
          for (const fid of JOINT_MOBILITY_FALLBACKS) {
            if (usedIds.has(fid)) continue;
            const cand = allEx.find(e => e.id === fid) || { id: fid, name: fid, family: 'mobility', setsCount: 3, rest: '60s', requiredGear: [] };
            if (isExerciseContraindicated(cand, inj)) continue;
            if (requireGear && !_hasRequiredGearForExercise(cand, gCfg)) continue;
            return cand;
          }
          return null;
        };
        return tryPool(true) || tryPool(false);
      };

      const formatItem = (exObj, originalItem, swapReason) => {
        if (isIdMode) return exObj.id;
        if (originalItem && typeof originalItem === 'object' && originalItem.id === exObj.id) {
          return originalItem;
        }
        const rx = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad(exObj.id, exObj) : null;
        return {
          ...exObj,
          targetWeight: rx ? rx.weight : (typeof exObj.getBaseWeight === 'function' ? exObj.getBaseWeight() : (exObj.targetWeight ?? 'Body')),
          targetReps: rx ? rx.reps : (typeof exObj.getBaseReps === 'function' ? exObj.getBaseReps() : (exObj.targetReps ?? 8)),
          rationale: swapReason ? `${swapReason} ${exObj.rationale || ''}`.trim() : (exObj.rationale || '')
        };
      };

      for (const item of candidateList) {
        const ex = findExObj(item);
        if (!ex || !ex.id) continue;
        const bad = isExerciseContraindicated(ex, inj);
        if (!bad && !usedIds.has(ex.id)) {
          usedIds.add(ex.id);
          result.push(formatItem(ex, item, null));
          continue;
        }
        if (bad) {
          const domains = getContraindicatingDomains(ex, inj);
          const replacement = pickSafeReplacement(domains);
          if (replacement && !usedIds.has(replacement.id)) {
            usedIds.add(replacement.id);
            const tag = `[🛡️ ${domains.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join('/')}-Safe Swap]`;
            result.push(formatItem(replacement, item, tag));
          }
        }
      }

      if (result.length === 0) {
        for (const fid of JOINT_MOBILITY_FALLBACKS) {
          if (usedIds.has(fid)) continue;
          const cand = allEx.find(e => e.id === fid) || { id: fid, name: fid, family: 'mobility', setsCount: 3, rest: '60s', requiredGear: [] };
          if (!isExerciseContraindicated(cand, inj)) {
            usedIds.add(cand.id);
            result.push(isIdMode ? cand.id : formatItem(cand, null, '[🛡️ Joint-Safe Mobility]'));
          }
        }
      }

      return (typeof targetCount === 'number' && targetCount > 0) ? result.slice(0, targetCount) : result;
    }

    if (typeof window !== 'undefined') {
      window.getContraindicatingDomains = getContraindicatingDomains;
      window.MOVEMENT_RESTRICTION_EXERCISES = MOVEMENT_RESTRICTION_EXERCISES;
      window.isExerciseContraindicated = isExerciseContraindicated;
      window.applyJointSafeSwaps = applyJointSafeSwaps;
    }

    function loadDailyArchetype(key) {
      if (typeof stopInlineTimer === 'function') stopInlineTimer();
      currentArchetypeKey = key || 'option_a';
      const kbSubMode = getKbSubMode();
      const verdict = (typeof computeTodayWorkoutVerdict === 'function') ? computeTodayWorkoutVerdict() : null;
      const todayGearMode = (typeof getTodayGearMode === 'function') ? getTodayGearMode() : 'gym';
      const todayTimeMode = (typeof getTodayTimeMode === 'function') ? getTodayTimeMode() : '45m';
      const targetCount = todayTimeMode === '20m' ? 3 : 5;

      const exerciseMatrix = {
        liss_cardio: {
          option_a: ['barbell_bench_press', 'barbell_pendlay_row', 'deadbug_hold'],
          option_kb: ['kb_swings', 'kb_suitcase_carry', 'zone2_flush', 'deadbug_hold'],
          option_b: ['speed_rope_intervals', 'emom_hybrid_10', 'amrap_hybrid_10', 'zone2_flush'],
          option_c: ['zone2_flush', 'knee_tke', 'glute_bridge_hold', 'thoracic_openers', 'deadbug_hold']
        },
        lower_hinge: {
          option_a: ['barbell_squat', 'barbell_rdl', 'barbell_zercher_squat', 'kb_suitcase_carry', 'deadbug_hold'],
          option_kb: ['kb_front_rack_squat', 'kb_heavy_rdl', 'kb_swings', 'kb_suitcase_carry', 'deadbug_hold'],
          option_b: ['emom_hybrid_10', 'speed_rope_intervals', 'amrap_hybrid_10', 'for_time_kb_chipper', 'deadbug_hold'],
          option_c: ['zone2_flush', 'knee_tke', 'glute_bridge_hold', 'deadbug_hold', 'couch_stretch_flow']
        },
        upper_push_pull: {
          option_a: ['barbell_bench_press', 'barbell_pendlay_row', 'weighted_dips', 'barbell_z_press', 'deadbug_hold'],
          option_kb: ['kb_clean_and_strict_press', 'kb_goblet_floor_press', 'kb_gorilla_row', 'pushups_renegade', 'kb_suitcase_carry'],
          option_b: ['pushups_renegade', 'narrow_pushups', 'tabata_rope_core', 'amrap_hybrid_10', 'deadbug_hold'],
          option_c: ['zone2_flush', 'thoracic_openers', 'deadbug_hold', 'knee_tke']
        },
        mobility_stretch: {
          option_c: ['thoracic_openers', 'couch_stretch_flow', 'glute_bridge_hold', 'deadbug_hold'],
          option_a: ['barbell_squat', 'barbell_bench_press', 'deadbug_hold'],
          option_kb: ['kb_swings', 'kb_suitcase_carry', 'deadbug_hold'],
          option_b: ['pushups_renegade', 'speed_rope_intervals', 'deadbug_hold']
        },
        rest_day: {
          option_c: ['thoracic_openers', 'couch_stretch_flow', 'glute_bridge_hold', 'deadbug_hold'],
          option_a: ['barbell_squat', 'barbell_bench_press', 'deadbug_hold'],
          option_kb: ['kb_swings', 'kb_suitcase_carry', 'deadbug_hold'],
          option_b: ['pushups_renegade', 'speed_rope_intervals', 'deadbug_hold']
        },
        full_body_strength: {
          option_a: ['barbell_squat', 'barbell_bench_press', 'barbell_rdl', 'barbell_pendlay_row', 'barbell_z_press'],
          option_kb: ['kb_front_rack_squat', 'kb_clean_and_strict_press', 'kb_heavy_rdl', 'kb_gorilla_row', 'kb_suitcase_carry'],
          option_b: ['kb_swings', 'db_press', 'slam_ball_slams', 'pushups_renegade', 'speed_rope_intervals'],
          option_c: ['zone2_flush', 'knee_tke', 'glute_bridge_hold', 'deadbug_hold']
        }
      };

      const focusMode = (verdict && verdict.mode && exerciseMatrix[verdict.mode]) ? verdict.mode : 'full_body_strength';
      const matrixForMode = exerciseMatrix[focusMode] || exerciseMatrix.full_body_strength;
      let rawExIds = matrixForMode[currentArchetypeKey] || matrixForMode.option_a || ['zone2_flush', 'knee_tke', 'deadbug_hold'];

      if (currentArchetypeKey === 'option_kb') {
        if (kbSubMode === 'flow_2h') {
          rawExIds = ['kb_flow_2h_out_about', 'kb_flow_2h_tactical_upper', 'kb_flow_2h_gladiator_post', 'kb_flow_2h_pyramid_1_5'];
        } else if (kbSubMode === 'flow_1h') {
          rawExIds = ['kb_flow_1h_armor_chain', 'kb_flow_1h_viking_warrior', 'kb_flow_1h_dan_john_grind', 'kb_flow_1h_combat_core'];
        }
      } else if (currentArchetypeKey === 'option_b') {
        if (focusMode === 'liss_cardio' || focusMode === 'mobility_stretch' || focusMode === 'rest_day') {
          rawExIds = ['zone2_flush', 'speed_rope_intervals', 'emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper'];
        } else {
          rawExIds = ['emom_hybrid_10', 'amrap_hybrid_10', 'for_time_kb_chipper', 'speed_rope_intervals', 'zone2_flush'];
        }
      }

      const preferredIds = rawExIds.map((origExId, idx) => resolvePreferredExerciseId(origExId, null, `${currentArchetypeKey}_${idx}`));
      const safeExIds = applyJointSafeSwaps(preferredIds, targetCount, athleteInjuries, typeof gearConfig !== 'undefined' ? gearConfig : null);

      const allExercises = getAllExercises();

      activeWorkoutPlan = safeExIds.map((finalExId) => {
        const found = allExercises.find(e => e.id === finalExId);
        let ex = found ? { ...found } : {
          id: finalExId,
          name: finalExId.replace(/_/g, ' ').toUpperCase(),
          family: 'functional',
          setsCount: 3,
          rest: '75s',
          cue: '',
          rationale: ''
        };

        let modified = { ...ex };
        if (typeof getPrescribedLoad === 'function') {
          const rx = getPrescribedLoad(ex.id, ex);
          modified.targetWeight = rx.weight;
          modified.targetReps = rx.reps;
        } else {
          modified.targetWeight = typeof ex.getBaseWeight === 'function' ? ex.getBaseWeight() : (ex.targetWeight !== undefined ? ex.targetWeight : 'Body');
          modified.targetReps = typeof ex.getBaseReps === 'function' ? ex.getBaseReps() : (ex.targetReps !== undefined ? ex.targetReps : 8);
        }

        if (currentArchetypeKey === 'option_kb' && ex.format !== 'kb_flow' && Array.isArray(ex.requiredGear) && ex.requiredGear.includes('kb') && typeof gearConfig !== 'undefined' && gearConfig.kb && gearConfig.kb.weight) {
          modified.targetWeight = gearConfig.kb.weight;
        }

        if (isExerciseContraindicated(finalExId, athleteInjuries)) {
          modified.rationale = `[🛡️ Joint-Safe Selection] ${modified.rationale || ''}`.trim();
        }
        return modified;
      });

      currentExIdx = 0;

      const badgeEl = document.getElementById('wPlanBadge');
      if (badgeEl) {
        const optionLabel = (verdict && verdict.optionLabels && verdict.optionLabels[currentArchetypeKey])
          ? verdict.optionLabels[currentArchetypeKey].replace(/⭐\s*/g, '')
          : (dailyArchetypes[currentArchetypeKey] ? dailyArchetypes[currentArchetypeKey].title : currentArchetypeKey.toUpperCase());
        badgeEl.innerText = optionLabel.toUpperCase();
      }

      ['option_a', 'option_kb', 'option_b', 'option_c'].forEach(k => {
        const btn = document.getElementById(`btnArchetype_${k}`);
        if (btn) {
          if (k === currentArchetypeKey) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });

      const kbSubBar = document.getElementById('kbSubModeBar');
      if (kbSubBar) {
        kbSubBar.style.display = currentArchetypeKey === 'option_kb' ? 'grid' : 'none';
        ['flow_2h', 'flow_1h', 'grinds'].forEach(m => {
          const sb = document.getElementById(`btnKbSub_${m}`);
          if (sb) {
            if (m === kbSubMode) sb.classList.add('active');
            else sb.classList.remove('active');
          }
        });
      }

      const gearStatusEl = document.getElementById('trainGearStatus');
      if (gearStatusEl) {
        if (currentArchetypeKey === 'option_kb') {
          const kbModeDesc = kbSubMode === 'flow_2h' ? '2H KB Flow (30m AMRAP)' : (kbSubMode === 'flow_1h' ? '1H KB Flow (30m AMRAP)' : `Heavy KB (${(typeof gearConfig !== 'undefined' && gearConfig.kb && gearConfig.kb.weight) || '24–32kg'})`);
          gearStatusEl.innerText = kbModeDesc;
        }
        else if (currentArchetypeKey === 'option_a') gearStatusEl.innerText = "Barbell & Dip Station";
        else if (currentArchetypeKey === 'option_b') gearStatusEl.innerText = "Pick 1 Session (Zone 2, Rope, EMOM, AMRAP)";
        else gearStatusEl.innerText = "Bodyweight & Incline Cadence";
      }

      renderCurrentExercise();
    }

    function loadPreset(key) {
      loadDailyArchetype(key);
    }

    function launchArchetypeSession(key) {
      loadDailyArchetype(key);
      switchTab('train');
      switchTrainView('prescribed');
      requestWakeLock();
      beep(750, 0.08);
      const cueMap = {
        option_a: "Option A Barbell Strength loaded. Let's work!",
        option_kb: "Option KB Heavy Kettlebell Strength loaded. Let's work!",
        option_b: "Option B Hybrid Work Capacity loaded. Let's get it!",
        option_c: "Option C Aerobic Flush and Prehab loaded."
      };
      speak(cueMap[key] || "Workout session loaded. Let's work!");
    }


    // ==================== DYNAMIC WEIGHT & REP PROGRESSION HELPER ====================
    function getPrescribedLoad(exId, ex) {
      let rxMap = {};
      try {
        const raw = localStorage.getItem('pulse_strength_prescriptions');
        if (raw) rxMap = JSON.parse(raw) || {};
      } catch(e) {}

      const bakedMap = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.strength_prescriptions) || {};
      const localRx = rxMap[exId] || null;
      const bakedRx = bakedMap[exId] || null;
      const parseTs = (obj) => {
        if (!obj) return 0;
        const rawTs = obj.last_updated || obj.updated_at || 0;
        const ms = typeof rawTs === 'number' ? rawTs : Date.parse(String(rawTs));
        return Number.isFinite(ms) ? ms : 0;
      };
      let rx = {};
      if (localRx && bakedRx) {
        rx = parseTs(bakedRx) > parseTs(localRx) ? bakedRx : localRx;
      } else {
        rx = localRx || bakedRx || {};
      }

      const weight = rx.weight ?? rx.last_logged_weight ?? (ex && typeof ex.getBaseWeight === 'function' ? ex.getBaseWeight() : (ex?.targetWeight ?? 'Body'));
      const reps = rx.reps ?? rx.last_logged_reps ?? (ex && typeof ex.getBaseReps === 'function' ? ex.getBaseReps() : (ex?.targetReps ?? 8));

      return {
        weight,
        reps,
        lastWeight: rx.last_logged_weight,
        lastReps: rx.last_logged_reps
      };
    }

    // ==================== 48-HOUR MUSCLE-GROUP FATIGUE ROTATION ====================
    function getFatiguedPatterns48h() {
      const fatigued = {
        hinge: false,
        h_push: false,
        h_pull: false,
        v_push: false,
        knee_dom: false
      };

      const now = Date.now();
      const cutoff48h = now - (48 * 60 * 60 * 1000);

      // 1. Inspect in-app pulse_session_history
      try {
        const histRaw = localStorage.getItem('pulse_session_history');
        if (histRaw) {
          const sessions = JSON.parse(histRaw);
          if (Array.isArray(sessions)) {
            sessions.forEach(s => {
              if (!s || !s.date) return;
              const sTime = new Date(s.date).getTime();
              if (isNaN(sTime) || sTime < cutoff48h) return;

              // Inspect details (sessionLoggedSets)
              if (s.details && typeof s.details === 'object') {
                Object.values(s.details).forEach(set => {
                  const exId = String((set && set.exercise_id) || '');
                  const me = getAllExercises().find(e => e.id === exId);
                  const fam = me ? me.family : '';
                  if (exId.includes('rdl') || exId.includes('swing') || fam === 'hip_hinge') fatigued.hinge = true;
                  if (exId.includes('press') || exId.includes('dip') || fam === 'horizontal_push') fatigued.h_push = true;
                  if (exId.includes('row') || fam === 'pull') fatigued.h_pull = true;
                  if (exId.includes('z_press') || fam === 'vertical_push') fatigued.v_push = true;
                  if (exId.includes('squat') || exId.includes('lunge') || fam === 'squat') fatigued.knee_dom = true;
                });
              }

              // Check preset/exercisesCompleted fallback
              if (s.preset === 'gym') {
                fatigued.hinge = true;
                fatigued.h_push = true;
              }
            });
          }
        }
      } catch(e) {}

      // 2. Inspect Garmin recentActivitiesData (last 48 hours)
      const acts = (typeof recentActivitiesData !== 'undefined' && Array.isArray(recentActivitiesData)) ? recentActivitiesData : [];
      acts.forEach(act => {
        if (!act) return;
        let actTime = 0;
        if (act.rawDate) {
          actTime = new Date(String(act.rawDate).replace(' ', 'T')).getTime();
        } else if (act.date) {
          actTime = new Date(String(act.date).replace(' ', 'T')).getTime();
        }
        if (isNaN(actTime) || actTime === 0) {
          if (act.isToday || (typeof act.date === 'string' && act.date.toLowerCase().includes('today'))) {
            actTime = now;
          }
        }
        if (actTime && actTime < cutoff48h) return;

        const text = `${act.name || ''} ${act.subTitle || act.sub_title || ''}`.toLowerCase();
        const duration = act.durationMin || act.duration_min || 0;
        const steps = act.steps || 0;

        // Garmin running, plyometrics, high-step (>12,000 steps), or cardio > 45 min
        if (
          text.includes('run') ||
          text.includes('plyo') ||
          text.includes('skip') ||
          text.includes('jump') ||
          steps > 12000 ||
          ((text.includes('cardio') || text.includes('walk') || text.includes('hiit')) && duration >= 45)
        ) {
          fatigued.knee_dom = true;
        }

        if (/swing|rdl|deadlift|hinge|snatch|clean/.test(text)) fatigued.hinge = true;
        if (/bench|floor press|pushup|push-up|dip/.test(text)) fatigued.h_push = true;
        if (/z-press|overhead|strict press|shoulder press/.test(text)) fatigued.v_push = true;
        if (/row|pullup|pull-up|chin|lat/.test(text)) fatigued.h_pull = true;
        if (/squat|lunge|thruster|goblet/.test(text)) fatigued.knee_dom = true;

        if (text.includes('strength') || text.includes('weight')) {
          if (text.includes('upper') || text.includes('push')) fatigued.h_push = true;
          if (text.includes('pull') || text.includes('back')) fatigued.h_pull = true;
          if (text.includes('leg') || text.includes('squat')) fatigued.knee_dom = true;
          if (text.includes('hinge') || text.includes('deadlift')) fatigued.hinge = true;
        }
      });

      return fatigued;
    }

    function getRotatedExercisesForOption(opt) {
      if (!opt) return { exerciseIds: [], rotationNote: null };
      const f = getFatiguedPatterns48h();

      let ids = [];
      let note = null;

      if (opt.id === 'bb_upper_hinge' && (f.hinge || f.h_push)) {
        if (!f.knee_dom) {
          ids = ["barbell_squat", "barbell_pendlay_row", "barbell_z_press", "kb_suitcase_carry", "deadbug_hold"];
          note = "Rotated for 48h muscle recovery (Fresh Squat, Pull, Overhead & Core)";
        } else {
          ids = ["barbell_pendlay_row", "barbell_z_press", "glute_bridge_hold", "kb_suitcase_carry", "deadbug_hold"];
          note = "Rotated for 48h muscle recovery (Fresh Pull, Overhead & Core)";
        }
      } else if (opt.id === 'bb_squat_press' && f.knee_dom) {
        ids = ["barbell_rdl", "barbell_bench_press", "barbell_pendlay_row", "weighted_dips"];
        note = "Rotated: Knee extensors rested (Posterior & Bench Press focus)";
      } else {
        ids = opt.exerciseIds ? [...opt.exerciseIds] : [];
        note = null;
      }

      const resolvedIds = ids.map(id => resolvePreferredExerciseId(id));
      return {
        exerciseIds: resolvedIds,
        rotationNote: note
      };
    }



    function _saveEquipmentProfile(opts = {}) {
      const payload = {
        preset: currentPreset || 'gym',
        focus: typeof currentSessionFocus !== 'undefined' ? currentSessionFocus : 'strength',
        gear: JSON.parse(JSON.stringify(gearConfig || {}))
      };
      try {
        localStorage.setItem('pulse_equipment_profile', JSON.stringify(payload));
      } catch (e) {}
      if (!(opts && opts.fromBoot) && typeof syncClientPreferencesToCloud === 'function') {
        syncClientPreferencesToCloud({ equipment_profile: payload });
      }
      return payload;
    }

    function applyEquipmentProfile(profile, opts = {}) {
      if (!profile || typeof profile !== 'object') return;
      if (profile.gear && typeof profile.gear === 'object') {
        Object.keys(profile.gear).forEach((k) => {
          if (!gearConfig[k]) return;
          const entry = profile.gear[k];
          if (entry && typeof entry === 'object') {
            gearConfig[k].active = Boolean(entry.active);
            const el = document.getElementById(`gear_${k}`);
            if (el) {
              el.classList.toggle('checked', gearConfig[k].active);
            }
            if (entry.weight !== undefined && entry.weight !== null) {
              gearConfig[k].weight = entry.weight;
              const sel = document.getElementById(`select_${k}`);
              if (sel) sel.value = entry.weight;
            }
          }
        });
      }
      if (profile.preset) {
        currentPreset = String(profile.preset);
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        const formattedKey = currentPreset === 'kb_heavy'
          ? 'Kb_heavy'
          : (currentPreset.charAt(0).toUpperCase() + currentPreset.slice(1));
        const presetBtn = document.getElementById(`preset${formattedKey}`);
        if (presetBtn) presetBtn.classList.add('active');
      }
      if (profile.focus && typeof setSessionFocus === 'function') {
        setSessionFocus(profile.focus, { fromBoot: true });
      }
      updateEquipmentTriggerSummary();
      generateWorkoutFromGearAndGoal();
      _saveEquipmentProfile({ fromBoot: Boolean(opts && opts.fromBoot) });
    }
    if (typeof window !== 'undefined') {
      window.applyEquipmentProfile = applyEquipmentProfile;
    }

    function toggleGear(gearKey) {
      gearConfig[gearKey].active = !gearConfig[gearKey].active;
      const el = document.getElementById(`gear_${gearKey}`);
      if (gearConfig[gearKey].active) el.classList.add('checked');
      else el.classList.remove('checked');
      beep(650, 0.05);

      currentPreset = 'custom';
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      const customBtn = document.getElementById('presetCustom');
      if (customBtn) customBtn.classList.add('active');
      generateWorkoutFromGearAndGoal();
      _saveEquipmentProfile();
    }

    function updateGearWeight(gearKey, weightVal) {
      gearConfig[gearKey].weight = weightVal;
      if (!gearConfig[gearKey].active) {
        gearConfig[gearKey].active = true;
        const gEl = document.getElementById(`gear_${gearKey}`);
        if (gEl) gEl.classList.add('checked');
      }
      beep(700, 0.06);

      currentPreset = 'custom';
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      const customBtn = document.getElementById('presetCustom');
      if (customBtn) customBtn.classList.add('active');
      generateWorkoutFromGearAndGoal();
      _saveEquipmentProfile();
      showToast(`Set ${gearKey.toUpperCase()} weight to ${weightVal}`);
    }

    function applyPreset(presetKey, opts = {}) {
      currentPreset = presetKey;
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      const formattedKey = presetKey === 'kb_heavy' ? 'Kb_heavy' : (presetKey.charAt(0).toUpperCase() + presetKey.slice(1));
      const presetBtn = document.getElementById(`preset${formattedKey}`);
      if (presetBtn) presetBtn.classList.add('active');

      const profile = presetProfiles[presetKey];
      if (profile && profile.gear) {
        Object.keys(profile.gear).forEach(k => {
          gearConfig[k].active = profile.gear[k];
          const el = document.getElementById(`gear_${k}`);
          if (el) {
            if (gearConfig[k].active) el.classList.add('checked');
            else el.classList.remove('checked');
          }
        });

        if (profile.weights) {
          Object.keys(profile.weights).forEach(k => {
            gearConfig[k].weight = profile.weights[k];
            const sel = document.getElementById(`select_${k}`);
            if (sel) sel.value = profile.weights[k];
          });
        }
      }

      if (presetKey === 'kb_heavy') {
        try { localStorage.setItem('pulse_tomorrow_gear', 'kb_heavy'); } catch(e) {}
        if (!(opts && opts.fromBoot)) loadDailyArchetype('option_kb');
      }

      if (!(opts && opts.fromBoot)) beep(780, 0.08);
      generateWorkoutFromGearAndGoal();
      _saveEquipmentProfile(opts);
      if (!(opts && opts.fromBoot) && window.userInteracted) showToast(`Loaded ${presetKey === 'kb_heavy' ? 'HEAVY KETTLEBELL' : presetKey.toUpperCase()} equipment profile`);
    }

    
    // UI ACCORDION & MODAL PROGRESSIVE DISCLOSURE HELPERS
    function toggleBenefitAccordion(actId) {
      const body = document.getElementById('benefit_body_' + actId);
      const arrow = document.getElementById('arrow_' + actId);
      if (!body) return;
      const isHidden = body.style.display === 'none' || !body.style.display;
      body.style.display = isHidden ? 'flex' : 'none';
      if (arrow) {
        if (isHidden) arrow.classList.add('open');
        else arrow.classList.remove('open');
      }
      beep(650, 0.04);
    }

    function openEquipmentModal(caller) {
      const modal = document.getElementById('equipmentModal');
      if (modal) {
        modal.dataset.caller = caller || 'today';
        modal.classList.add('open');
      }
      beep(720, 0.05);
    }

    function closeEquipmentModal() {
      const modal = document.getElementById('equipmentModal');
      if (modal) modal.classList.remove('open');
      updateEquipmentTriggerSummary();
      beep(620, 0.04);
    }

    let currentSessionFocus = 'strength';
    function setSessionFocus(focusKey, opts = {}) {
      currentSessionFocus = focusKey;
      ['strength', 'capacity', 'flush'].forEach(k => {
        const btn = document.getElementById(`focusBtn_${k}`);
        if (btn) {
          if (k === focusKey) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      const badge = document.getElementById('focusIndicatorBadge');
      if (badge) {
        const labels = {
          strength: 'HEAVY STRENGTH',
          capacity: 'WORK CAPACITY',
          flush: 'RECOVERY FLUSH'
        };
        badge.innerText = labels[focusKey] || 'HEAVY STRENGTH';
      }
      _saveEquipmentProfile(opts);
      if (!(opts && opts.fromBoot)) beep(700, 0.04);
    }

    function applyCustomEquipmentAndGenerate() {
      const modal = document.getElementById('equipmentModal');
      if (modal) modal.classList.remove('open');

      const isTomorrow = modal && modal.dataset.caller === 'tomorrow';
      const focus = currentSessionFocus || 'strength';

      const hasBarbell = gearConfig.barbell && gearConfig.barbell.active;
      const hasKb = gearConfig.kb && gearConfig.kb.active;

      if (!hasBarbell && hasKb && focus === 'strength') {
        currentPreset = 'kb_heavy';
        try { localStorage.setItem('pulse_tomorrow_gear', 'kb_heavy'); } catch(e) {}
        loadDailyArchetype('option_kb');
        showToast(`✓ Generated Heavy Kettlebell Strength workout (${(gearConfig.kb && gearConfig.kb.weight) || '24–32kg'})!`);
      } else {
        if (!hasBarbell && hasKb) {
          try { localStorage.setItem('pulse_tomorrow_gear', 'kb_heavy'); } catch(e) {}
        } else if (hasBarbell) {
          try { localStorage.setItem('pulse_tomorrow_gear', 'gym'); } catch(e) {}
        }
        currentPreset = 'custom';
        generateWorkoutFromGearAndGoal();
        showToast(`✓ Generated Custom ${focus.toUpperCase()} workout based on selected equipment!`);
      }

      // Autoregulate volume from live Garmin telemetry (same inputs as Options A/B/C)
      let readiness = null, sleepScore = null;
      try {
        const g = window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin;
        if (g && g.training_readiness != null && Number.isFinite(Number(g.training_readiness))) readiness = Number(g.training_readiness);
        if (g && g.sleep_score != null && Number.isFinite(Number(g.sleep_score))) sleepScore = Number(g.sleep_score);
      } catch(e) {}
      if ((readiness != null && Number.isFinite(readiness) && readiness < 60) || (sleepScore != null && Number.isFinite(sleepScore) && sleepScore < 60)) {
        activeWorkoutPlan = activeWorkoutPlan.map(ex => ({
          ...ex,
          setsCount: Math.max(2, (ex.setsCount || 3) - 1),
          rationale: `[Autoregulated: Readiness ${readiness ?? '--'} / Sleep ${sleepScore ?? '--'} → −1 set] ` + (ex.rationale || '')
        }));
      }

      const gearStatusEl = document.getElementById('trainGearStatus');
      if (gearStatusEl) {
        const names = [];
        if (hasBarbell) names.push('Barbell');
        if (hasKb) names.push(`KB ${(gearConfig.kb && gearConfig.kb.weight) || ''}`.trim());
        if (gearConfig.db && gearConfig.db.active) names.push(`DB ${gearConfig.db.weight}`);
        if (gearConfig.slamball && gearConfig.slamball.active) names.push('Slam Ball');
        if (gearConfig.sandbag && gearConfig.sandbag.active) names.push('Sandbag');
        gearStatusEl.innerText = names.length ? names.join(', ') : 'Bodyweight';
      }
      currentExIdx = 0;
      renderCurrentExercise();
      if (!isTomorrow) {
        switchTab('train');
        switchTrainView('prescribed');
      }

      updateEquipmentTriggerSummary();
      _saveEquipmentProfile();
      renderTodayTrainingRecommendations();
      beep(880, 0.12);
    }

    function updateEquipmentTriggerSummary() {
      const titleEl = document.getElementById('gearTriggerTitle');
      const subEl = document.getElementById('gearTriggerSub');
      if (!titleEl || !subEl) return;

      const pKey = currentPreset || 'gym';
      titleEl.innerText = `Equipment Setup • ${pKey.toUpperCase()} Profile`;

      const activeNames = [];
      const labelMap = {
        barbell: 'Barbell', bench: 'Bench', dipbar: 'Dip Bar',
        db: `DB (${(gearConfig.db && gearConfig.db.weight) || '22.5kg'})`,
        kb: `KB (${(gearConfig.kb && gearConfig.kb.weight) || '24kg'})`,
        slamball: `Slam Ball (${(gearConfig.slamball && gearConfig.slamball.weight) || '10kg'})`,
        sandbag: `Sandbag (${(gearConfig.sandbag && gearConfig.sandbag.weight) || '15kg'})`,
        ropes: 'Battle Ropes', speedrope: 'Speed Rope', lowceiling: 'Studio Ceiling Safe'
      };
      Object.keys(gearConfig).forEach(k => {
        if (gearConfig[k] && gearConfig[k].active && labelMap[k]) {
          activeNames.push(labelMap[k]);
        }
      });
      subEl.innerText = activeNames.slice(0, 4).join(', ') + (activeNames.length > 4 ? ` +${activeNames.length - 4} more` : '');
    }

function generateWorkoutFromGearAndGoal() {
      const goal = athleteGoals[currentGoalKey];
      const profile = presetProfiles[currentPreset] || presetProfiles.custom;

      if (currentPreset === 'custom') {
        const activeItems = Object.keys(gearConfig).filter(k => gearConfig[k].active);
        const weightNotes = [];
        if (gearConfig.kb.active) weightNotes.push(`${gearConfig.kb.weight} KB`);
        if (gearConfig.slamball.active) weightNotes.push(`${gearConfig.slamball.weight} Slam Ball`);
        if (gearConfig.db.active) weightNotes.push(`${gearConfig.db.weight} DBs`);
        if (gearConfig.sandbag.active) weightNotes.push(`${gearConfig.sandbag.weight} Sandbag`);

        const badgeEl = document.getElementById('aiRecBadge');
        if (badgeEl) badgeEl.innerText = "TIER 1 • CUSTOM HYBRID SETUP";
        const titleEl = document.getElementById('aiRecTitle');
        if (titleEl) titleEl.innerText = gearConfig.barbell.active 
          ? "Custom Barbell & Hybrid Strength" 
          : "Custom Functional Conditioning Session";
        const sumEl = document.getElementById('aiRecSummary');
        if (sumEl) sumEl.innerText = `Tailored for Readiness 80 using: ${activeItems.join(', ')} (${weightNotes.join(', ') || 'bodyweight'}). Calibrated to hit your ${goal ? goal.title : 'Target'}.`;
      } else {
        const badgeEl = document.getElementById('aiRecBadge');
        if (badgeEl) badgeEl.innerText = profile.badge;
        const titleEl = document.getElementById('aiRecTitle');
        if (titleEl) titleEl.innerText = profile.title;
        const sumEl = document.getElementById('aiRecSummary');
        if (sumEl) sumEl.innerText = profile.summary;
      }

      const allCatalog = (typeof getAllExercises === 'function') ? getAllExercises() : masterExercises;
      let filtered = allCatalog.filter(ex => {
        if (!_hasRequiredGearForExercise(ex, gearConfig)) return false;
        return !isExerciseContraindicated(ex, athleteInjuries);
      });

      const focusKey = (typeof currentSessionFocus !== 'undefined' && currentSessionFocus) || 'strength';
      const scoreEx = (ex) => {
        let s = Array.isArray(ex.goals) && ex.goals.includes(currentGoalKey) ? 1 : 0;
        if (focusKey === 'strength') {
          if (Array.isArray(ex.goals) && ex.goals.includes('kb_strength')) s += 3;
          if (['hip_hinge','horizontal_push','vertical_push','pull','squat'].includes(ex.family) && ex.family !== 'cardio') s += 1;
          if (ex.family === 'cardio') s -= 3;
        } else if (focusKey === 'capacity') {
          if (Array.isArray(ex.goals) && ex.goals.includes('work_capacity')) s += 3;
          if (ex.family === 'cardio') s += 1;
        } else if (focusKey === 'flush') {
          if (ex.family === 'cardio' || ex.family === 'core_carry') s += 3;
          if (ex.id === 'pushups_renegade') s += 1;
        }
        return s;
      };
      filtered.sort((a, b) => scoreEx(b) - scoreEx(a));

      // Family-balanced pool before joint-safe swap & slice
      const picked = [];
      const seenFam = new Set();
      filtered.forEach(ex => { if (!seenFam.has(ex.family)) { picked.push(ex); seenFam.add(ex.family); } });
      filtered.forEach(ex => { if (!picked.includes(ex)) picked.push(ex); });

      const baseCandidates = picked.map(ex => {
        const rx = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad(ex.id, ex) : null;
        return {
          ...ex,
          targetWeight: rx ? rx.weight : (typeof ex.getBaseWeight === 'function' ? ex.getBaseWeight() : (ex.targetWeight ?? 'Body')),
          targetReps: rx ? rx.reps : (typeof ex.getBaseReps === 'function' ? ex.getBaseReps() : (ex.targetReps ?? 8))
        };
      });
      activeWorkoutPlan = applyJointSafeSwaps(baseCandidates, 5, athleteInjuries, gearConfig);

      const gcEl = document.getElementById('aiRecGearCount');
      if (gcEl) gcEl.innerText = `${activeWorkoutPlan.length} Exercises Loaded`;
      const listEl = document.getElementById('aiRecList');
      if (listEl) {
        listEl.innerHTML = '';
        activeWorkoutPlan.forEach(ex => {
          const chip = document.createElement('div');
          chip.className = 'workout-rec-chip';
          const weightTag = typeof ex.targetWeight === 'number' ? `${ex.targetWeight}kg` : ex.targetWeight;
          chip.innerText = `${ex.name.split('(')[0].trim()} (${weightTag} × ${ex.targetReps})`;
          listEl.appendChild(chip);
        });
      }

      const wpEl = document.getElementById('wPlanBadge');
      if (wpEl) wpEl.innerText = profile.title.toUpperCase();
      currentExIdx = 0;
      updateEquipmentTriggerSummary();
    }

    function renderWeeklyPatternBalance() {
      const el = document.getElementById('weeklyPatternBalance');
      if (!el) return;
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const counts = { Hinge: 0, Squat: 0, Push: 0, Pull: 0, Conditioning: 0 };

      const classifyExId = (exId, sets) => {
        const id = String(exId || '').toLowerCase();
        if (id.includes('rdl') || id.includes('hinge') || id.includes('swing') || id.includes('bridge')) counts.Hinge += sets;
        else if (id.includes('squat') || id.includes('lunge')) counts.Squat += sets;
        else if (id.includes('press') || id.includes('dip') || id.includes('push')) counts.Push += sets;
        else if (id.includes('row') || id.includes('pull')) counts.Pull += sets;
        else counts.Conditioning += sets;
      };

      try {
        const rawSess = localStorage.getItem('pulse_session_history');
        if (rawSess) {
          const sessions = JSON.parse(rawSess);
          if (Array.isArray(sessions)) {
            sessions.forEach(s => {
              const dt = s && s.date ? new Date(s.date).getTime() : 0;
              if (!dt || isNaN(dt) || (now - dt) > sevenDaysMs) return;
              if (s.details && typeof s.details === 'object') {
                const allEx = (typeof getAllExercises === 'function') ? getAllExercises() : [];
                Object.entries(s.details).forEach(([k, setObj]) => {
                  const exId = (setObj && typeof setObj === 'object' && setObj.exercise_id)
                    ? setObj.exercise_id
                    : ((allEx.find(e => e && e.id && k.startsWith(e.id + '_'))?.id) || k.replace(/_\d+$/, ''));
                  classifyExId(exId, 1);
                });
              }
            });
          }
        }
      } catch(e) {}

      try {
        const rawStr = localStorage.getItem('pulse_strength_history');
        if (rawStr) {
          const map = JSON.parse(rawStr);
          Object.entries(map).forEach(([exId, entry]) => {
            const dt = entry && (entry.lastDate || entry.date) ? new Date(entry.lastDate || entry.date).getTime() : now;
            if (!isNaN(dt) && (now - dt) > sevenDaysMs) return;
            const sets = Number(entry.sets || entry.setsCount || 3);
            classifyExId(exId, sets);
          });
        }
      } catch(e) {}

      const _seenCondTimestamps = new Set();
      const _addCondEntries = (raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
          ? parsed
          : (parsed && typeof parsed === 'object' ? Object.values(parsed) : []);
        list.forEach(entry => {
          if (!entry || typeof entry !== 'object') return;
          const stamp = String(entry.lastDate || entry.date || '');
          const dt = stamp ? new Date(stamp).getTime() : 0;
          if (!dt || (now - dt) > sevenDaysMs) return;
          const dedupKey = `${stamp}_${entry.format || entry.mode || ''}`;
          if (_seenCondTimestamps.has(dedupKey)) return;
          _seenCondTimestamps.add(dedupKey);
          counts.Conditioning += Math.max(1, Number(entry.amrapRounds || entry.roundsCompleted || entry.rounds || 2));
        });
      };
      try { _addCondEntries(localStorage.getItem('pulse_conditioning_history')); } catch(e) {}
      try { _addCondEntries(localStorage.getItem('pulse_conditioning_progression')); } catch(e) {}

      const acts = Array.isArray(recentActivitiesData) ? recentActivitiesData : [];
      acts.forEach(a => {
        if (!a) return;
        const dt = new Date(String(a.rawDate || a.date || '').replace(' ', 'T')).getTime();
        if (!isNaN(dt) && (now - dt) <= sevenDaysMs) {
          const nm = String(`${a.name || ''} ${a.subTitle || a.sub_title || ''}`).toLowerCase();
          if (typeof parseWorkoutNoteDetails === 'function') {
            const p = parseWorkoutNoteDetails(nm, a);
            const setsToAdd = p.sets || 3;
            let matchedPattern = false;
            if (p.hasHinge) { counts.Hinge += setsToAdd; matchedPattern = true; }
            if (p.hasSquat) { counts.Squat += setsToAdd; matchedPattern = true; }
            if (p.hasPush) { counts.Push += setsToAdd; matchedPattern = true; }
            if (p.hasPull) { counts.Pull += setsToAdd; matchedPattern = true; }
            if (p.hasBodyCombat) {
              counts.Conditioning += Math.max(3, setsToAdd);
              if (p.isCombatUpper) counts.Push += 1;
              if (p.isCombatLower) counts.Squat += 1;
              matchedPattern = true;
            } else if (p.hasJumpRope || !nm.includes('strength')) {
              counts.Conditioning += 2;
            } else if (!matchedPattern && nm.includes('strength')) {
              counts.Push += 2; counts.Pull += 2; counts.Hinge += 2;
            }
          } else {
            if (nm.includes('strength')) { counts.Push += 2; counts.Pull += 2; counts.Hinge += 2; }
            else counts.Conditioning += 2;
          }
        }
      });

      const targets = { Hinge: 8, Squat: 8, Push: 10, Pull: 10, Conditioning: 6 };
      const colors = { Hinge: '#f59e0b', Squat: '#00e5ff', Push: '#ec4899', Pull: '#8b5cf6', Conditioning: '#10b981' };

      const barsHtml = Object.keys(counts).map(k => {
        const pct = Math.min(100, Math.round((counts[k] / targets[k]) * 100));
        return `
<div style="display:flex; align-items:center; gap:8px; font-size:10.5px;">
<span style="width:82px; font-weight:700; color:var(--text-secondary);">${k}</span>
<div style="flex:1; height:6px; background:rgba(255,255,255,0.06); border-radius:999px; overflow:hidden;">
<div style="width:${pct}%; height:100%; background:${colors[k]}; border-radius:999px;"></div>
</div>
<span style="width:42px; text-align:right; font-family:var(--font-mono); font-weight:700; color:#fff;">${counts[k]}/${targets[k]}</span>
</div>
        `;
      }).join('');

      el.innerHTML = `
<div style="background:rgba(15,23,42,0.85); border:1px solid var(--border); border-radius:12px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:7px;">
<strong style="font-size:11.5px; color:#fff;">⚖️ 7-Day Movement Pattern Balance</strong>
<span style="font-size:10px; color:var(--text-muted);">Sets / Blocks vs Target</span>
</div>
<div style="display:flex; flex-direction:column; gap:5px;">${barsHtml}</div>
</div>
      `;
    }
    window.renderWeeklyPatternBalance = renderWeeklyPatternBalance;

    // WORKOUT TAB SUBVIEW SWITCHER (Prescribed vs Completed History)
    function switchTrainView(viewKey) {
      currentTrainView = viewKey;
      if (viewKey !== 'prescribed' && typeof _exitWorkoutFocusMode === 'function') {
        _exitWorkoutFocusMode();
      }
      document.querySelectorAll('.train-subview-nav .btn-subview').forEach(b => b.classList.remove('active'));
      const balEl = document.getElementById('weeklyPatternBalance');
      if (viewKey === 'prescribed') {
        const bp = document.getElementById('btnTrainPrescribed');
        if (bp) bp.classList.add('active');
        const vp = document.getElementById('trainViewPrescribed');
        if (vp) vp.style.display = 'flex';
        const vh = document.getElementById('trainViewHistory');
        if (vh) vh.style.display = 'none';
        if (balEl) balEl.style.display = 'none';
        const tb = document.getElementById('trainHistoryToolbar');
        if (tb) tb.style.display = 'none';
        renderCurrentExercise();
      } else {
        const bh = document.getElementById('btnTrainHistory');
        if (bh) bh.classList.add('active');
        const vp = document.getElementById('trainViewPrescribed');
        if (vp) vp.style.display = 'none';
        const vh = document.getElementById('trainViewHistory');
        if (vh) vh.style.display = 'flex';
        if (balEl) {
          balEl.style.display = 'block';
          renderWeeklyPatternBalance();
        }
        const tb = document.getElementById('trainHistoryToolbar');
        if (tb) tb.style.display = 'flex';
        renderHistoryList();
      }
      beep(550, 0.04);
    }


    // ==================== TODAY SCREEN POST-WORKOUT RECOVERY & NEXT-DAY ENGINE ====================
    function getTodayCompletedWorkout() {
      const now = new Date();
      const todayIsoDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const todayStr = now.toDateString();

      // 1. Check in-app logged session history strictly for TODAY
      let inAppTodaySessions = [];
      try {
        const rawSessions = localStorage.getItem('pulse_session_history');
        if (rawSessions) {
          const sessions = JSON.parse(rawSessions);
          if (Array.isArray(sessions) && sessions.length > 0) {
            inAppTodaySessions = sessions.filter(s => {
              if (!s || !s.date) return false;
              const d = new Date(s.date);
              return !isNaN(d.getTime()) && d.toDateString() === todayStr;
            });
          }
        }
      } catch(e) {}

      // 2. Check today_activities or recentActivitiesData for any workout completed TODAY (Garmin fēnix 8)
      const actsToCheck = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && Array.isArray(window.BAKED_LIVE_STATE.garmin.today_activities) && window.BAKED_LIVE_STATE.garmin.today_activities.length > 0)
        ? window.BAKED_LIVE_STATE.garmin.today_activities
        : (Array.isArray(recentActivitiesData) ? recentActivitiesData : []);

      if (Array.isArray(actsToCheck)) {
        const isBridgeAct = (a) => a && (
          a.source === 'garmin_via_mnd_bridge' ||
          String(a.id || '').startsWith('990') ||
          String(a.id || '').startsWith('9920') ||
          a.name === 'Active Conditioning' ||
          a.name === 'Daily Steps & Movement' ||
          a.name === 'Hybrid Conditioning & Steps'
        );
        const hasRealToday = actsToCheck.some(a => !isBridgeAct(a));
        const todayActs = actsToCheck.filter(a => {
          if (!a) return false;
          if (hasRealToday && isBridgeAct(a)) return false;
          const isRealWorkout = (Number(a.duration_min || a.durationMin || 0) >= 10) || (Number(a.calories || 0) >= 80);
          if (!isRealWorkout) return false;
          if (a.date && String(a.date).startsWith(todayIsoDate)) return true;
          const fmt = (typeof formatActivityDisplay === 'function') ? formatActivityDisplay(a) : { isToday: false };
          return fmt.isToday;
        });
        if (todayActs.length > 0) {
          const totalCalsToday = todayActs.reduce((sum, a) => sum + Number(a.calories || a.workout_calories || 0), 0);
          const totalDurToday = todayActs.reduce((sum, a) => sum + Number(a.durationMin || a.duration_min || 0), 0);
          const sessionCount = todayActs.length;
          const hasFullStrength = todayActs.some(a => {
            const label = `${a.name || ''} ${a.sub_title || ''} ${a.subTitle || ''}`.toLowerCase();
            return (label.includes('strength') || label.includes('barbell') || label.includes('kettlebell')) && Number(a.calories || 0) >= 300;
          });
          const primaryAct = todayActs[0];
          const isStr = todayActs.some(a => `${a.name || ''} ${a.sub_title || ''} ${a.subTitle || ''}`.toLowerCase().includes('strength'));
          let manualDone = false;
          try {
            manualDone = localStorage.getItem('pulse_strength_done_today') === 'true' && localStorage.getItem('pulse_workout_completed_date') === todayIsoDate;
          } catch(e) {}
          const sessionTitles = todayActs.map(a => a.sub_title || a.subTitle || a.name || 'Session');
          const combinedTitle = sessionTitles.length > 1
            ? sessionTitles.slice(0, 2).join(' + ') + (sessionTitles.length > 2 ? ` (+${sessionTitles.length - 2} more)` : '')
            : (sessionTitles[0] || 'Completed Workout Session');
          return {
            title: combinedTitle,
            sessionCount,
            sessionSummaries: todayActs.map(a => ({
              title: a.sub_title || a.subTitle || a.name || 'Session',
              calories: Math.round(Number(a.calories || a.workout_calories || 0)),
              durationMin: Math.round(Number(a.durationMin || a.duration_min || 0))
            })),
            durationMin: Math.round(totalDurToday || primaryAct.durationMin || primaryAct.duration_min || 30),
            calories: Math.round(totalCalsToday || primaryAct.calories || 250),
            recoveryHours: isStr ? 48 : 24,
            recoveryPill: isStr ? '⏳ 24–48h Recovery Window • In Progress' : '⚡ Aerobic Recovery • In Progress',
            isStrength: isStr || hasFullStrength,
            isLightOrNonStrength: !manualDone && sessionCount === 1 && (!hasFullStrength || totalCalsToday < 300),
            manualComplete: manualDone,
            source: 'Garmin fēnix 8 Sync',
            completedAt: primaryAct.rawDate || primaryAct.date
          };
        }
      }

      if (inAppTodaySessions.length > 0) {
        const found = inAppTodaySessions[0];
        const cals = inAppTodaySessions.reduce((s, x) => s + Number(x.calories || 320), 0);
        const dur = inAppTodaySessions.reduce((s, x) => s + Number(x.durationMin || 45), 0);
        const sessionCount = inAppTodaySessions.length;
        return {
          title: found.preset === 'gym' ? 'Option A: Heavy Barbell Strength & Hinge' : (found.preset === 'combat' ? 'Option B: Hybrid Work Capacity Circuit' : 'Option C: Active Recovery & Zone 2 Flush'),
          sessionCount,
          durationMin: dur,
          calories: cals,
          recoveryHours: 48,
          recoveryPill: '⏳ 24–48h Recovery Window • In Progress',
          isStrength: found.preset === 'gym',
          isLightOrNonStrength: sessionCount === 1 && (cals < 300 || found.preset !== 'gym'),
          manualComplete: false,
          source: 'In-App Workout Player',
          completedAt: found.date
        };
      }

      // 3. User manual completion flag (strictly scoped to today's date)
      try {
        const manualFlag = localStorage.getItem('pulse_strength_done_today');
        const manualDate = localStorage.getItem('pulse_workout_completed_date');
        if (manualFlag === 'true' && manualDate === todayIsoDate) {
          return {
            title: 'Option A: Heavy Barbell Strength & Hinge',
            durationMin: 45,
            calories: 320,
            recoveryHours: 48,
            recoveryPill: '⏳ 24–48h Recovery Window • In Progress',
            isStrength: true,
            isLightOrNonStrength: false,
            manualComplete: true,
            source: 'Manually Logged Today',
            completedAt: todayIsoDate
          };
        }
      } catch(e) {}

      return null;
    }

    // ==================== NEXT-DAY AUTOREGULATION & PREVIEW ENGINE ====================
    window.tomorrowSleepScenario = window.tomorrowSleepScenario || 'good';
    window.setTomorrowSleepScenario = function(scen) {
      window.tomorrowSleepScenario = scen;
      if (typeof renderTodayTrainingRecommendations === 'function') renderTodayTrainingRecommendations();
      if (typeof pulseHaptic === 'function') pulseHaptic(15);
    };

    function generateTomorrowRecommendation(completedToday) {
      const acts = Array.isArray(recentActivitiesData) ? recentActivitiesData.filter(Boolean) : [];
      const scen = window.tomorrowSleepScenario || 'good';

      let sleepScore = (window.athleteProfile && window.athleteProfile.sleepScore != null && Number.isFinite(Number(window.athleteProfile.sleepScore)))
        ? Number(window.athleteProfile.sleepScore)
        : null;
      let readiness = (window.athleteProfile && window.athleteProfile.readiness != null && Number.isFinite(Number(window.athleteProfile.readiness)))
        ? Number(window.athleteProfile.readiness)
        : null;
      let restingHr = (window.athleteProfile && window.athleteProfile.restingHr != null && Number.isFinite(Number(window.athleteProfile.restingHr)))
        ? Number(window.athleteProfile.restingHr)
        : null;
      let hrvStatus = "Balanced (Optimal Parasympathetic Rebound)";
      let scaleWeight = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.weightKg)) && Number(window.athleteProfile.weightKg) > 0)
        ? Number(window.athleteProfile.weightKg)
        : null;
      let bodyFatPct = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.bodyFatPct)) && Number(window.athleteProfile.bodyFatPct) > 0)
        ? Number(window.athleteProfile.bodyFatPct)
        : null;
      let leanMass = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0)
        ? Number(window.athleteProfile.leanMassKg)
        : null;
      let fatToLose = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.fatToLoseKg)))
        ? Number(window.athleteProfile.fatToLoseKg)
        : null;
      let targetWeight = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.targetWeightKg)) && Number(window.athleteProfile.targetWeightKg) > 0)
        ? Number(window.athleteProfile.targetWeightKg)
        : null;

      if (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) {
        const g = window.BAKED_LIVE_STATE.garmin;
        if (g.sleep_score != null && Number.isFinite(Number(g.sleep_score))) sleepScore = Number(g.sleep_score);
        if (g.training_readiness != null && Number.isFinite(Number(g.training_readiness))) readiness = Number(g.training_readiness);
        if (g.resting_hr != null && Number.isFinite(Number(g.resting_hr))) restingHr = Number(g.resting_hr);
        if (g.readiness_feedback) hrvStatus = g.readiness_feedback;
      }
      if (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.renpho) {
        const r = window.BAKED_LIVE_STATE.renpho;
        if (r.weight_kg != null && Number.isFinite(Number(r.weight_kg)) && Number(r.weight_kg) > 0) scaleWeight = Number(r.weight_kg);
        if (r.body_fat_pct != null && Number.isFinite(Number(r.body_fat_pct)) && Number(r.body_fat_pct) > 0) bodyFatPct = Number(r.body_fat_pct);
        if (r.lean_mass_kg != null && Number.isFinite(Number(r.lean_mass_kg)) && Number(r.lean_mass_kg) > 0) leanMass = Number(r.lean_mass_kg);
        if (r.fat_to_lose_kg != null && Number.isFinite(Number(r.fat_to_lose_kg))) fatToLose = Number(r.fat_to_lose_kg);
        if (r.target_weight_at_15pct != null && Number.isFinite(Number(r.target_weight_at_15pct)) && Number(r.target_weight_at_15pct) > 0) targetWeight = Number(r.target_weight_at_15pct);
      }
      const scaleWtStr = scaleWeight !== null ? `${scaleWeight.toFixed(1)} kg` : '-- kg';
      const bfPctStr = bodyFatPct !== null ? `${bodyFatPct.toFixed(1)}%` : '--%';
      const leanMassStr = leanMass !== null ? `${leanMass.toFixed(2)} kg` : 'your lean muscle mass';
      const fatToLoseStr = fatToLose !== null ? `${fatToLose.toFixed(2)} kg` : '-- kg';
      const targetWtStr = targetWeight !== null ? `${targetWeight.toFixed(2)} kg` : '-- kg';

      const todayIso = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
      const todayAct = (todayIso ? acts.find(a => String(a.rawDate || a.date || '').startsWith(todayIso) || a.isToday) : null) || null;
      const latestAct = todayAct || acts[0] || null;
      const actLabelRaw = (todayAct && (todayAct.subTitle || todayAct.sub_title || todayAct.name))
        || (latestAct && (latestAct.subTitle || latestAct.sub_title || latestAct.name))
        || '';
      const todaySessionDesc = (completedToday && completedToday.title)
        ? `today's ${escapeHtml(completedToday.title)}${completedToday.calories ? ` (${completedToday.calories} kcal)` : ''}`
        : (todayAct
          ? `today's ${escapeHtml(actLabelRaw)}`
          : (latestAct ? `your recent ${escapeHtml(actLabelRaw)}` : 'your recent training volume'));
      const curBb = window.BAKED_LIVE_STATE?.garmin?.body_battery;
      const batteryPhrase = (curBb !== undefined && curBb !== null) ? `${curBb}%` : 'current levels';

      const todayText = `${completedToday?.title || ''} ${actLabelRaw}`.toLowerCase();
      const fatigued = (typeof getFatiguedPatterns48h === 'function') ? getFatiguedPatterns48h() : { hinge: false, h_push: false, h_pull: false, v_push: false, knee_dom: false };
      const didSkipAndSwings = /skip|jump/.test(todayText) && /swing|kb|kettlebell/.test(todayText);
      const isLowerHeavy = todayText.includes('squat') || todayText.includes('option a') || todayText.includes('barbell') || todayText.includes('strength');

      let latestAvgHr = 128;
      if (latestAct && (latestAct.avgHr || latestAct.avg_hr)) latestAvgHr = latestAct.avgHr || latestAct.avg_hr;

      let tomorrowGear = null;
      try { tomorrowGear = localStorage.getItem('pulse_tomorrow_gear'); } catch(e) {}
      const kbW = escapeHtml((typeof gearConfig !== 'undefined' && gearConfig && gearConfig.kb && gearConfig.kb.weight) || '24kg');

      const rxSquat = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('barbell_squat', getAllExercises().find(e => e.id === 'barbell_squat')) : { weight: 100, reps: 8 };
      const rxBench = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('barbell_bench_press', getAllExercises().find(e => e.id === 'barbell_bench_press')) : { weight: 65, reps: 8 };
      const rxRdl = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('barbell_rdl', getAllExercises().find(e => e.id === 'barbell_rdl')) : { weight: 70, reps: 8 };
      const rxRow = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('barbell_pendlay_row', getAllExercises().find(e => e.id === 'barbell_pendlay_row')) : { weight: 85, reps: 8 };
      const rxZPress = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('barbell_z_press', getAllExercises().find(e => e.id === 'barbell_z_press')) : { weight: 45, reps: 10 };
      const fmtLoad = (w) => (typeof w === 'number' ? `${w}kg` : `${w}`);

      // SCENARIO 3: POOR SLEEP (<65)
      if (scen === 'poor') {
        return {
          presetKey: 'option_c',
          title: 'Option C: 20-Min Zone 2 Incline Walk & Thoracic/Hip Mobility Reset',
          subtitle: 'Cortisol Control, Lower-Body Flush & Zero CNS Debt',
          durationMin: 25,
          calories: 140,
          estMorningBattery: '<50%',
          estReadiness: '~55',
          fatigueImpact: '0h CNS Debt',
          equipment: 'Bodyweight, Foam Roller & Resistance Band',
          badge: 'POOR SLEEP CONTINGENCY (<65)',
          summary: `If tonight's sleep score drops below 65 (Morning Battery <50%, Readiness <58), avoid heavy axial spinal compression. A 20-minute Zone 2 walk + hip/ankle mobility lowers cortisol to protect all ${leanMassStr} in your 350 kcal deficit while flushing residual soreness after ${todaySessionDesc}.`,
          reasoning: [
            {
              title: 'Cortisol & Lean Mass Protection',
              desc: `Under poor sleep (<65), heavy barbell loading spikes cortisol and catabolic breakdown in a caloric deficit. Zone 2 locomotion oxidizes pure fat without taxing your sympathetic nervous system.`
            },
            {
              title: 'Achilles & Posterior Chain Flush',
              desc: `Promotes synovial fluid circulation and gentle blood flow to calves, Achilles tendons, and hamstrings following ${todaySessionDesc}.`
            },
            {
              title: 'Autonomic Parasympathetic Reset',
              desc: `Keeps heart rate strictly under 110 bpm so your Body Battery rebounds for a heavy compound session the following day.`
            },
            {
              title: 'Deficit Runway Alignment',
              desc: `Adds ~140 kcal of clean NEAT expenditure while keeping hunger hormones (ghrelin) suppressed at ${scaleWtStr} (${bfPctStr} BF → 15.0% goal).`
            }
          ],
          blueprint: [
            { name: 'Zone 2 Brisk Walk / Incline Treadmill', prescription: '20 min @ 100–112 bpm', cue: 'Nasal breathing only, relaxed shoulders, smooth heel-to-toe cadence.' },
            { name: 'Eccentric Calf & Achilles Wall Stretch', prescription: '2 × 45s/side (30s rest)', cue: 'Bent-knee soleus + straight-knee gastrocnemius decompression.' },
            { name: '90/90 Hip & Hamstring Flossing', prescription: '2 × 10 reps/side', cue: 'Restore posterior hip capsule glide and lumbar freedom.' },
            { name: 'Deadbug Isometric Core Reset', prescription: '3 × 30s hold', cue: 'Press lower back flat into floor, slow diaphragmatic exhales.' }
          ],
          alternative: {
            presetKey: 'option_kb',
            title: 'Option KB: Light Kettlebell Technique (2 Sets Only)',
            desc: 'If you wake up feeling better than expected, perform 2 light sets of KB Strict Press & Rows at 3–4 RIR.'
          }
        };
      }

      // SCENARIO 2: MODERATE SLEEP (65–79)
      if (scen === 'moderate') {
        return {
          presetKey: 'option_kb',
          title: 'Option KB: 28-Min Controlled Upper-Biased Kettlebell Grinds',
          subtitle: 'Strict Press, Floor Press, Gorilla Rows & Suitcase Carry (No Ballistic Hinging)',
          durationMin: 28,
          calories: 280,
          estMorningBattery: '~65%',
          estReadiness: '~68',
          fatigueImpact: 'Moderate CNS',
          equipment: `Single Heavy Kettlebell (${kbW})`,
          badge: 'MODERATE SLEEP FORECAST (65–79)',
          summary: `Assuming moderate sleep (Score 65–79, Morning Battery ~65%, Readiness ~68), skip heavy spinal barbell loading and ballistic swings. Focus on controlled ${kbW} Kettlebell Upper Push/Pull grinds (Strict Press, Floor Press, Rows) alongside your recovery after ${todaySessionDesc}.`,
          reasoning: [
            {
              title: 'Kinetic Chain Rotation (Upper Push/Pull Focus)',
              desc: `Accounting for ${todaySessionDesc}${didSkipAndSwings || fatigued.hinge ? ', which taxed your calves, Achilles, and posterior chain,' : ','} tomorrow's controlled ${kbW} KB grinds target your chest, shoulders, lats, and core stability.`
            },
            {
              title: 'Zero Spinal Axial Compression',
              desc: `With moderate readiness (~68), unilateral kettlebell pressing and rowing stimulate high motor-unit recruitment to protect ${leanMassStr} without heavy barbell CNS drain.`
            },
            {
              title: 'Controlled Heart Rate Zone',
              desc: `75-second rest intervals keep HR in the 110–128 bpm hypertrophy/strength zone rather than adding glycolytic fatigue.`
            },
            {
              title: 'Deficit Runway Alignment',
              desc: `Burns ~280 active kcal to widen your nutrition runway at ${scaleWtStr} (${bfPctStr} BF) while preserving upper-body muscle fullness.`
            }
          ],
          blueprint: [
            { name: 'KB Single-Arm Strict Overhead Press', prescription: `4 × 6/side @ ${kbW} (75s rest)`, cue: 'Brace core and glutes tight; press vertically with zero leg drive.' },
            { name: 'KB Single-Arm Floor Press', prescription: `4 × 10/side @ ${kbW} (75s rest)`, cue: 'Pause triceps on floor for 1s to eliminate elastic bounce; drive hard.' },
            { name: 'KB Gorilla / Single-Arm Row', prescription: `4 × 10/side @ ${kbW} (75s rest)`, cue: 'Hinge lightly, pull bell to hip pocket, 1s lat squeeze at top.' },
            { name: 'Floor Push-ups (Tempo 3-0-1)', prescription: '3 × 15 @ Bodyweight (60s rest)', cue: '3-second eccentric lowering; full scapular protraction at lockout.' },
            { name: 'KB Suitcase Anti-Rotation Carry', prescription: `3 × 45s/side @ ${kbW} (60s rest)`, cue: 'Walk tall, ribs stacked over pelvis, resist lateral tilt.' }
          ],
          alternative: {
            presetKey: 'option_c',
            title: 'Option C: 20-Min Zone 2 Walk & Mobility',
            desc: 'If calves or hamstrings feel stiff on warm-up, pivot to an easy 20-min outdoor walk.'
          }
        };
      }

      // SCENARIO 1: GOOD SLEEP (80+)
      if (tomorrowGear === 'kb_heavy') {
        const lowerFatigued = isLowerHeavy || didSkipAndSwings || fatigued.hinge;
        return {
          presetKey: 'option_kb',
          title: 'Option KB: Heavy Kettlebell Strength (Upper Push/Pull Priority)',
          subtitle: lowerFatigued ? 'Upper-Biased Press, Floor Press, Row & Carry (Hinge Volume Reduced)' : 'Press, Hinge, Row & Carry — Full-Body Tension',
          durationMin: 40,
          calories: 340,
          estMorningBattery: '~85%',
          estReadiness: '~82',
          fatigueImpact: lowerFatigued ? 'Low Posterior Load' : 'Moderate CNS',
          equipment: `Single Heavy Kettlebell (${kbW})`,
          badge: 'ASSUMING GOOD SLEEP (80+) • HEAVY KB',
          summary: `Assuming a restorative night's sleep (Sleep ~82+, Morning Battery ~85%), your CNS will be fresh tomorrow. ${lowerFatigued ? `Because ${todaySessionDesc} loaded your lower/posterior kinetic chain while keeping Upper Push & Pull fresh,` : `With recovery clear after ${todaySessionDesc},`} tomorrow prioritizes heavy unilateral ${kbW} KB Pressing, Floor Pressing, and Rows.`,
          reasoning: [
            {
              title: 'Musculoskeletal Load Management',
              desc: lowerFatigued
                ? `Accounting for ${todaySessionDesc}, posterior chain fatigue is managed by biasing tomorrow toward strict press, floor press, and gorilla rows while reducing RDL volume.`
                : `Posterior chain is recovered. Heavy KB RDLs (4 × 10) plus unilateral press and row cover every major movement pattern without barbell spinal compression.`
            },
            {
              title: 'Heart Rate & Cardiovascular Load',
              desc: `Recent sessions averaged <strong>${latestAvgHr} bpm</strong>. 75s rest periods keep this session in a strength zone (~105–125 bpm) rather than a conditioning zone.`
            },
            {
              title: 'Projected Morning Readiness (~82)',
              desc: `With 7.5–8h of restorative sleep tonight, Morning Body Battery projects to <strong>~85%</strong> and Readiness to <strong>~82</strong> — cleared for heavy sets at 1–2 RIR.`
            },
            {
              title: 'Deficit Runway Alignment',
              desc: `At ${scaleWtStr} / ${bfPctStr} BF with ${fatToLoseStr} to reach 15% (${targetWtStr}), heavy tension preserves ${leanMassStr} while in a 350 kcal deficit.`
            }
          ],
          blueprint: [
            { name: 'KB Single-Arm Clean & Strict Press', prescription: `4 × 6/side @ ${kbW} (75s)`, cue: 'Clean to rack, strict press, no leg drive; brace and squeeze glutes.' },
            { name: 'KB Single-Arm Floor Press', prescription: `4 × 10/side @ ${kbW} (75s)`, cue: 'Pause with elbow on floor, press straight up, wrist stacked.' },
            { name: 'KB Gorilla / Single-Arm Row', prescription: `4 × 10/side @ ${kbW} (75s)`, cue: 'Flat back, elbow to hip, 1s squeeze at top.' },
            { name: 'KB Romanian Deadlift (Controlled)', prescription: `${lowerFatigued ? 2 : 4} × 10 @ ${kbW} (75s)`, cue: 'Hips back, bell close to legs, 3s lowering, spare lower back.' },
            { name: 'KB Suitcase Carry / March', prescription: `3 × 45s/side @ ${kbW} (60s)`, cue: 'Tall posture, shoulders level, resist the lean.' }
          ],
          alternative: {
            presetKey: 'option_c',
            title: 'Option C: Incline Cadence Flush & Prehab',
            desc: 'If readiness or sleep drops below 70, swap to Zone 2 walking + prehab.'
          }
        };
      }

      if (didSkipAndSwings) {
        return {
          presetKey: 'option_a',
          title: 'Option A: Upper Push/Pull Priority + Compound Strength',
          subtitle: 'Heavy Bench Press, Pendlay Rows & Overhead Z-Press (Posterior Hinge Spared)',
          durationMin: 42,
          calories: 345,
          estMorningBattery: '~85%',
          estReadiness: '~82',
          fatigueImpact: 'Upper Prime • Hinge Spared',
          equipment: 'Barbell, Squat Rack & Bench',
          badge: 'ASSUMING GOOD SLEEP (80+) • OPTIMAL PAIRING',
          summary: `Assuming a restorative night's sleep (Sleep ~82+, Morning Battery recharged to ~85%), your CNS will be fresh tomorrow. Because ${todaySessionDesc} loaded your calves, Achilles, and ballistic hip hinge while leaving your <strong>Upper Body Push & Pull 100% fresh</strong>, tomorrow is ideal for <strong>Heavy Barbell Bench Press (${fmtLoad(rxBench.weight)} × ${rxBench.reps}) & Pendlay Rows (${fmtLoad(rxRow.weight)} × ${rxRow.reps})</strong>, plus controlled squats or reduced RDL volume.`,
          reasoning: [
            {
              title: '100% Fresh Upper Push & Pull Kinetic Chains',
              desc: `Because ${todaySessionDesc} taxed the Achilles tendon complex, calves, and posterior chain, your <strong>Pectorals, Deltoids, Triceps, and Lats have minimal local fatigue</strong> and are primed for peak barbell loading.`
            },
            {
              title: 'Autoregulated Lower-Body Volume Adjustment',
              desc: `Since ballistic hinging already delivered potent posterior stimulus, tomorrow places <strong>Flat Bench Press (${fmtLoad(rxBench.weight)})</strong> and <strong>Pendlay Rows (${fmtLoad(rxRow.weight)})</strong> first, keeps Back Squats controlled, and trims RDL volume to 2 controlled sets so hamstrings don't overreach.`
            },
            {
              title: 'Sleep & CNS Rebound Projection',
              desc: `Assuming 7.5–8h of quality sleep tonight (Sleep Score ~82+), your Body Battery will rebound from ${batteryPhrase} back to <strong>~85%</strong> with Readiness <strong>~82</strong> — optimal for high-threshold motor unit recruitment.`
            },
            {
              title: 'Lean Mass Anchor in Deficit',
              desc: `At <strong>${scaleWtStr} (${bfPctStr} BF)</strong> with <strong>${fatToLoseStr}</strong> to reach your 15.0% goal (${targetWtStr}), heavy upper-body compound tension anchors <strong>${leanMassStr}</strong>.`
            }
          ],
          blueprint: [
            { name: 'Barbell Flat Bench Press (Primary Push)', prescription: `4 × ${rxBench.reps} @ ${fmtLoad(rxBench.weight)} (90s rest)`, cue: '100% fresh chest/triceps — retract scapulae, drive feet into floor, explosive press.' },
            { name: 'Barbell Pendlay Row (Primary Pull)', prescription: `4 × ${rxRow.reps} @ ${fmtLoad(rxRow.weight)} (90s rest)`, cue: 'Dead-stop from floor each rep, brace core to protect posterior chain.' },
            { name: 'Barbell Overhead / Z-Press', prescription: `3 × ${rxZPress.reps} @ ${fmtLoad(rxZPress.weight)} (75s rest)`, cue: 'Strict vertical deltoid & triceps press; zero lower-back arch.' },
            { name: 'Barbell Back Squat (Calf/Ankle Check)', prescription: `3 × ${rxSquat.reps} @ ${fmtLoad(rxSquat.weight)} (120s rest)`, cue: 'Perform 3 crisp sets if calves feel bouncy after plyometric work; stop at 2 RIR.' },
            { name: 'Barbell RDL (Reduced Hinge Volume)', prescription: `2 × ${rxRdl.reps} @ ${fmtLoad(rxRdl.weight)} (90s rest)`, cue: 'Capped at 2 sets since ballistic hinging already stimulated hamstrings.' }
          ],
          alternative: {
            presetKey: 'option_kb',
            title: `Option KB: Heavy ${kbW} Kettlebell Upper Session`,
            desc: `If training away from the barbell rack tomorrow, tap Moderate or Change Gear for ${kbW} KB Strict Press & Rows.`
          }
        };
      }

      if (isLowerHeavy) {
        return {
          presetKey: 'option_b',
          title: 'Option B: Hybrid Work Capacity & Upper Core Circuit',
          subtitle: 'Rotational Torso, Kettlebell Dynamics & Dumbbell Floor Density',
          durationMin: 32,
          calories: 385,
          estMorningBattery: '~85%',
          estReadiness: '~82',
          fatigueImpact: 'Low CNS Debt (0h)',
          equipment: 'Kettlebells (24–32kg), Dumbbells & Speed Rope',
          badge: 'ASSUMING GOOD SLEEP (80+) • AUTOREGULATED',
          summary: 'Rotates mechanical stress away from lower prime movers into dynamic core torque and upper-body pushing, sustaining your 350 kcal daily deficit without joint strain.',
          reasoning: [
            {
              title: 'Musculoskeletal & Biomechanical Shield',
              desc: `Today delivered peak mechanical tension to your lower body. These motor units require <strong>24–48 hours for myofibrillar remodeling</strong>. Option B rotates load to rotational core and upper body pushing.`
            },
            {
              title: 'Heart Rate & Cardiovascular Conditioning',
              desc: `Your recent workout telemetry logged controlled average HR (${latestAvgHr} bpm). Tomorrow's interval circuit will tap Zone 2–3 conditioning (target 125–138 bpm).`
            },
            {
              title: 'Projected Morning Recovery',
              desc: `Assuming Sleep Score <strong>80+</strong> and Morning Battery <strong>~85%</strong>, your autonomic nervous system is cleared to handle dynamic work capacity tomorrow.`
            },
            {
              title: 'Deficit Runway Alignment',
              desc: `At <strong>${scaleWtStr}</strong> and <strong>${bfPctStr} body fat</strong>, you are <strong>${fatToLoseStr}</strong> away from 15.0% (${targetWtStr} target).`
            }
          ],
          blueprint: [
            { name: 'Dumbbell Chest Floor Press', prescription: '4 × 10 @ 2×22kg (75s rest)', cue: 'Pause briefly on floor to eliminate momentum; explosive concentric press.' },
            { name: 'Kettlebell Single-Arm Gorilla Row', prescription: '4 × 10/side @ 24kg (60s rest)', cue: 'Brace core, drive elbow to hip.' },
            { name: 'Rotational Slam Ball Slams', prescription: '4 × 12 @ 10–15kg (45s rest)', cue: 'Full overhead extension, drive ball into floor with core torque.' },
            { name: 'Floor Push-ups (Tempo 3-0-1)', prescription: '3 × 18 @ Bodyweight (60s rest)', cue: '3-second lowering tempo, screw hands into floor.' },
            { name: 'Kettlebell Suitcase Carry', prescription: '3 × 45s/side @ 24kg (60s rest)', cue: 'Tall posture, anti-rotation oblique brace.' }
          ],
          alternative: {
            presetKey: 'option_c',
            title: 'Option C: Incline Cadence Flush & Prehab',
            desc: 'If morning readiness or sleep drops below 75, pivot to Zone 2 walking & knee prehab (0h CNS debt).'
          }
        };
      }

      return {
        presetKey: 'option_a',
        title: 'Option A: Heavy Barbell Squat, Bench & Hinge',
        subtitle: 'Full-Body Compound Mechanical Tension (Squat Rack & Bench)',
        durationMin: 45,
        calories: 340,
        estMorningBattery: '~85%',
        estReadiness: '~82',
        fatigueImpact: 'High Mechanical Tension',
        equipment: 'Barbell, Squat Rack & Bench',
        badge: 'ASSUMING GOOD SLEEP (80+) • TARGET',
        summary: `Assuming good sleep tonight (Sleep ~82+, Morning Battery ~85%), tomorrow delivers heavy compound mechanical tension across Squat, Bench Press, RDL, and Row, anchoring ${leanMassStr}.`,
        reasoning: [
          {
            title: 'High Mechanical Tension Required',
            desc: `To protect <strong>${leanMassStr}</strong> in your 350 kcal deficit, tomorrow delivers high mechanical load to quads, chest, lats, and posterior chain.`
          },
          {
            title: 'Heart Rate & Cardiac EPOC',
            desc: `Tomorrow's compound strength format utilizes 90–120s rest intervals, keeping heart rate controlled while taxing muscular motor units directly.`
          },
          {
            title: 'Projected Sleep & CNS Priming',
            desc: `Assuming an <strong>80+ Sleep Score</strong> and <strong>~85% Morning Battery</strong>, your central nervous system will be primed for heavy compound lifting.`
          },
          {
            title: 'Deficit Runway Alignment',
            desc: `Anchors ${leanMassStr} while driving the ${fatToLoseStr} fat loss toward 15.0%.`
          }
        ],
        blueprint: [
          { name: 'Barbell Back Squat', prescription: `4 × ${rxSquat.reps} @ ${fmtLoad(rxSquat.weight)} (120s rest)`, cue: 'Unrack from squat rack, chest up, knees track over toes, drive through midfoot.' },
          { name: 'Barbell Flat Bench Press', prescription: `4 × ${rxBench.reps} @ ${fmtLoad(rxBench.weight)} (90s rest)`, cue: 'Shoulder blades retracted on bench, leg drive, touch lower sternum.' },
          { name: 'Barbell Romanian Deadlift (RDL)', prescription: `4 × ${rxRdl.reps} @ ${fmtLoad(rxRdl.weight)} (90s rest)`, cue: 'Hips back, neutral spine, explosive glute lockout.' },
          { name: 'Barbell Pendlay Row', prescription: `4 × ${rxRow.reps} @ ${fmtLoad(rxRow.weight)} (90s rest)`, cue: 'Dead-stop from floor each rep, strict horizontal torso.' },
          { name: 'Barbell Overhead / Z-Press', prescription: `3 × ${rxZPress.reps} @ ${fmtLoad(rxZPress.weight)} (60s rest)`, cue: 'Strict overhead deltoid press; core braced tight.' }
        ],
        alternative: {
          presetKey: 'option_c',
          title: 'Option C: Active Recovery & Synovial Restoration',
          desc: 'Light 25-min outdoor recovery walk + banded joint restoration if joints require deload.'
        }
      };
    }

    function renderTomorrowPreviewCard(completedToday) {
      const rec = generateTomorrowRecommendation(completedToday);
      const scen = window.tomorrowSleepScenario || 'good';
      const pillStyle = (active, colorHex, bgRgba, borderRgba) => active
        ? `flex:1; padding:6px 8px; border-radius:7px; font-size:10.5px; font-weight:800; background:${bgRgba}; border:1.5px solid ${borderRgba}; color:${colorHex}; cursor:pointer; text-align:center;`
        : `flex:1; padding:6px 8px; border-radius:7px; font-size:10.5px; font-weight:700; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); color:var(--text-muted); cursor:pointer; text-align:center;`;

      return `
        
<div id="tomorrowForecastCard" class="card" style="padding:16px; margin-top:10px; margin-bottom:12px; background:var(--surface-card, #14161e); border:1px solid rgba(0,229,255,0.28); border-radius:14px; position:relative; box-shadow:0 4px 20px rgba(0,0,0,0.35);">
          
          
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:11px; font-weight:800; color:#00e5ff; letter-spacing:0.05em; text-transform:uppercase;">
                🌙 TOMORROW'S TRAINING FORECAST
</span>
</div>
<span style="background:var(--primary-dim, rgba(48,209,88,0.12)); border:1px solid rgba(48,209,88,0.3); color:var(--primary, #30d158); font-size:9.5px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.04em;">
              ${rec.badge}
</span>
</div>

          
<div style="display:flex; gap:6px; margin-bottom:10px;">
<button type="button" onclick="setTomorrowSleepScenario('good')" style="${pillStyle(scen === 'good', '#30d158', 'rgba(48,209,88,0.15)', 'rgba(48,209,88,0.5)')}">
              🟢 Good Sleep (80+)
</button>
<button type="button" onclick="setTomorrowSleepScenario('moderate')" style="${pillStyle(scen === 'moderate', '#fbbf24', 'rgba(251,191,36,0.15)', 'rgba(251,191,36,0.5)')}">
              🟡 Moderate (65–79)
</button>
<button type="button" onclick="setTomorrowSleepScenario('poor')" style="${pillStyle(scen === 'poor', '#f87171', 'rgba(248,113,113,0.15)', 'rgba(248,113,113,0.5)')}">
              🔴 Poor (&lt;65)
</button>
</div>

          
<div style="font-size:16px; font-weight:800; color:#fff; font-family:var(--font-sans); line-height:1.3; margin-top:2px;">
            ${rec.title}
</div>
<div style="font-size:11.5px; color:var(--text-muted); margin-top:3px;">
            ${rec.subtitle} • ${rec.equipment}
</div>

          
<div onclick="openEquipmentModal('tomorrow')" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.25); border-radius:8px; cursor:pointer;">
<span style="font-size:11px; color:var(--text-secondary);">Equipment: <strong style="color:#fff;">${rec.equipment}</strong></span>
<span style="font-size:11px; font-weight:800; color:var(--primary); white-space:nowrap;">Change Gear ⚙</span>
</div>

          
<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-top:10px;">
<div style="background:#1a1d26; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:7px 4px; text-align:center;">
<div style="font-size:12.5px; font-weight:800; color:#00e5ff;">${rec.estMorningBattery || '~85%'}</div>
<div style="font-size:9px; font-weight:600; color:var(--text-muted); text-transform:uppercase;">Est. Morning Battery</div>
</div>
<div style="background:#1a1d26; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:7px 4px; text-align:center;">
<div style="font-size:12.5px; font-weight:800; color:#10b981;">${rec.estReadiness || '~82'}</div>
<div style="font-size:9px; font-weight:600; color:var(--text-muted); text-transform:uppercase;">Est. Readiness</div>
</div>
<div style="background:#1a1d26; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:7px 4px; text-align:center;">
<div style="font-size:12.5px; font-weight:800; color:var(--primary, #30d158);">~${rec.calories} kcal</div>
<div style="font-size:9px; font-weight:600; color:var(--text-muted); text-transform:uppercase;">Target Burn (${rec.durationMin}m)</div>
</div>
</div>

          
<div style="margin-top:10px; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; font-size:11.5px; color:#d4d4d8; line-height:1.45;">
            ${rec.summary}
</div>

          
<details style="margin-top:8px; background:#0d0f14; border:1px solid rgba(255,255,255,0.06); border-radius:9px; overflow:hidden;">
<summary style="font-size:11px; font-weight:700; color:var(--text-secondary); padding:9px 12px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>🔬 View Physiological Rationale & Wearable Biometrics (4 Factors)</span>
<span style="font-size:11px; color:var(--text-muted);">▾</span>
</summary>
<div style="padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-top:1px solid rgba(255,255,255,0.05); font-size:11px; line-height:1.45;">
              ${rec.reasoning.map((r, i) => `
<div style="border-left:2px solid ${i === 0 ? 'var(--primary, #30d158)' : (i === 1 ? '#38bdf8' : (i === 2 ? '#a78bfa' : '#f59e0b'))}; padding-left:8px;">
<div style="font-weight:700; color:#fff; text-transform:uppercase; font-size:10.5px; letter-spacing:0.03em;">
                    ${i+1}. ${r.title}
</div>
<div style="color:#a1a1aa; margin-top:2px;">
                    ${r.desc}
</div>
</div>
              `).join('')}
</div>
</details>

          
<details style="margin-top:6px; background:#0d0f14; border:1px solid rgba(255,255,255,0.06); border-radius:9px; overflow:hidden;">
<summary style="font-size:11px; font-weight:700; color:var(--text-secondary); padding:9px 12px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>📋 View Prescribed Movement Blueprint (${rec.blueprint.length} Drills)</span>
<span style="font-size:11px; color:var(--text-muted);">▾</span>
</summary>
<div style="padding:10px 12px; display:flex; flex-direction:column; gap:7px; border-top:1px solid rgba(255,255,255,0.05);">
              ${rec.blueprint.map((b, i) => `
<div style="border-bottom:1px solid rgba(255,255,255,0.04); padding-bottom:5px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; font-size:11.5px;">
<span style="color:#fff; font-weight:700;">${i+1}. ${b.name}</span>
<span style="color:var(--primary, #30d158); font-weight:800;">${b.prescription}</span>
</div>
<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">Cue: ${b.cue}</div>
</div>
              `).join('')}
</div>
</details>

          
<div style="margin-top:12px; display:flex; flex-direction:column; gap:6px;">
<div style="display:flex; gap:8px; flex-wrap:wrap;">
<button class="btn-action-primary" onclick="setTomorrowTargetPlan('${rec.presetKey}')" style="flex:2; min-width:170px; height:40px; font-size:11.5px; font-weight:800; background:var(--primary, #30d158); color:#000; border-radius:8px; border:none; display:flex; align-items:center; justify-content:center; gap:6px; letter-spacing:0.03em; cursor:pointer;">
                LOCK & PRE-LOAD FOR TOMORROW ➔
</button>
<button class="btn-action-primary" onclick="loadDailyArchetype('${rec.presetKey}'); switchTab('train');" style="flex:1; min-width:140px; height:40px; font-size:11px; font-weight:700; background:rgba(0,229,255,0.1); border:1px solid rgba(0,229,255,0.3); color:#00e5ff; border-radius:8px; display:flex; align-items:center; justify-content:center; gap:5px; cursor:pointer;">
                Preview in Workout Tab ➔
</button>
</div>
<div style="font-size:10.5px; color:var(--text-muted); text-align:center; margin-top:2px;">
              Contingency: <em>${rec.alternative.title}</em> (${rec.alternative.desc})
</div>
</div>

</div>
      `;
    }

    function setTomorrowTargetPlan(presetKey) {
      try {
        localStorage.setItem('pulse_tomorrow_plan', presetKey);
      } catch(e) {}
      beep(880, 0.15);
      const lockLabels = { option_a: "Option A (Barbell Strength)", option_kb: "Option KB (Heavy Kettlebell)", option_b: "Option B (Work Capacity)", option_c: "Option C (Recovery Flush)" };
      showToast("Locked " + (lockLabels[presetKey] || presetKey) + " as tomorrow focus.");
    }

    // ==================== CONTEXT STATE & PILL CONTROLS ====================
    function getTodayFeeling() {
      try { return localStorage.getItem('pulse_today_feeling') || 'normal'; } catch(e) { return 'normal'; }
    }
    function getTodayGearMode() {
      try { return localStorage.getItem('pulse_today_gear') || 'gym'; } catch(e) { return 'gym'; }
    }
    function getTodayTimeMode() {
      try { return localStorage.getItem('pulse_today_time') || '45m'; } catch(e) { return '45m'; }
    }
    function setTodayContext(key, val) {
      try {
        if (key === 'feeling' || key === 'pulse_today_feeling') localStorage.setItem('pulse_today_feeling', val);
        if (key === 'gear' || key === 'pulse_today_gear') localStorage.setItem('pulse_today_gear', val);
        if (key === 'time' || key === 'pulse_today_time') localStorage.setItem('pulse_today_time', val);
      } catch(e) {}
      if (typeof renderTodayTrainingRecommendations === 'function') {
        renderTodayTrainingRecommendations();
      }
      if (typeof computeTodayWorkoutVerdict === 'function') {
        const v = computeTodayWorkoutVerdict();
        if (typeof updateArchetypeStarBadge === 'function') {
          updateArchetypeStarBadge(v.archetypeKey, v.optionLabels);
        }
        if (typeof loadDailyArchetype === 'function') {
          loadDailyArchetype(currentArchetypeKey || v.archetypeKey);
        }
      }
    }

    // ==================== DYNAMIC TODAY WORKOUT VERDICT & AUTOREGULATION ====================
    function updateArchetypeStarBadge(activeKey, optionLabels) {
      const archetypes = [
        { key: 'option_a', defaultLabel: 'Option A (BB)' },
        { key: 'option_kb', defaultLabel: 'Option KB' },
        { key: 'option_b', defaultLabel: 'Option B (Work)' },
        { key: 'option_c', defaultLabel: 'Option C (Flush)' }
      ];

      archetypes.forEach(arch => {
        const btn = document.getElementById(`btnArchetype_${arch.key}`);
        if (btn) {
          const rawLabel = (optionLabels && optionLabels[arch.key]) ? optionLabels[arch.key] : arch.defaultLabel;
          const cleanLabel = rawLabel.replace(/^⭐\s*/, '');

          if (arch.key === activeKey) {
            btn.innerHTML = `⭐ ${cleanLabel}`;
            btn.style.color = "var(--primary)";
            btn.style.fontWeight = "700";
            btn.classList.add('active');
          } else {
            btn.innerHTML = cleanLabel;
            btn.style.color = "";
            btn.style.fontWeight = "";
            btn.classList.remove('active');
          }
        }
      });
    }

    function computeTodayWorkoutVerdict() {
      let sleepScore = 82;
      let sleepDuration = "7h 34m";
      let readiness = 80;
      let restingHr = null;
      let bodyBattery = 72;
      let activeCaloriesToday = 0;

      if (window.athleteProfile) {
        if (window.athleteProfile.sleepScore != null && Number.isFinite(Number(window.athleteProfile.sleepScore))) sleepScore = Number(window.athleteProfile.sleepScore);
        if (window.athleteProfile.sleepDuration != null) sleepDuration = window.athleteProfile.sleepDuration;
        if (window.athleteProfile.readiness != null && Number.isFinite(Number(window.athleteProfile.readiness))) readiness = Number(window.athleteProfile.readiness);
        if (window.athleteProfile.restingHr != null && Number.isFinite(Number(window.athleteProfile.restingHr))) restingHr = Number(window.athleteProfile.restingHr);
      }

      if (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) {
        const g = window.BAKED_LIVE_STATE.garmin;
        if (g.sleep_score !== undefined && g.sleep_score !== null && Number.isFinite(Number(g.sleep_score))) sleepScore = Number(g.sleep_score);
        if (g.sleep_duration !== undefined && g.sleep_duration !== null) sleepDuration = g.sleep_duration;
        if (g.training_readiness !== undefined && g.training_readiness !== null && Number.isFinite(Number(g.training_readiness))) readiness = Number(g.training_readiness);
        if (g.resting_hr !== undefined && g.resting_hr !== null && Number.isFinite(Number(g.resting_hr))) restingHr = Number(g.resting_hr);
        if (g.body_battery !== undefined && g.body_battery !== null && Number.isFinite(Number(g.body_battery))) bodyBattery = Number(g.body_battery);
        if (g.active_calories !== undefined && g.active_calories !== null && Number.isFinite(Number(g.active_calories))) activeCaloriesToday = Number(g.active_calories);
      }

      // Gather activities
      let acts = [];
      if (typeof recentActivitiesData !== 'undefined' && Array.isArray(recentActivitiesData) && recentActivitiesData.length > 0) {
        acts = recentActivitiesData;
      } else if (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && Array.isArray(window.BAKED_LIVE_STATE.garmin.recent_activities)) {
        acts = window.BAKED_LIVE_STATE.garmin.recent_activities;
      }

      const todayIsoStr = (typeof getLocalDateStr === 'function')
        ? getLocalDateStr()
        : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
      const [ty, tm, td] = todayIsoStr.split('-').map(Number);
      const todayDateObj = new Date(ty, tm - 1, td);
      const oneDayMs = 24 * 60 * 60 * 1000;

      const actDayMap = {};
      let burn72h = 0;
      let workoutsLast4Days = 0;
      let todayLogged = false;

      acts.forEach(a => {
        if (!a) return;
        const dateStr = a.rawDate || a.date || '';
        let actDate = null;
        if (dateStr) {
          const parsed = new Date(String(dateStr).replace(' ', 'T'));
          if (!isNaN(parsed.getTime())) {
            actDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
          }
        }
        if (!actDate) {
          if (a.isToday || (typeof a.date === 'string' && a.date.toLowerCase().includes('today'))) {
            actDate = todayDateObj;
          } else {
            return;
          }
        }

        const diffDays = Math.round((todayDateObj.getTime() - actDate.getTime()) / oneDayMs);
        const cal = a.calories || a.workout_calories || 0;

        if (diffDays >= 0 && diffDays < 3) {
          burn72h += cal;
        }
        if (diffDays >= 0 && diffDays < 4) {
          workoutsLast4Days++;
        }
        if (diffDays === 0) {
          todayLogged = true;
        }

        if (diffDays >= 0) {
          actDayMap[diffDays] = (actDayMap[diffDays] || 0) + 1;
        }
      });

      let consecutiveDays = 0;
      const startOffset = actDayMap[0] ? 0 : (actDayMap[1] ? 1 : null);
      if (startOffset !== null) {
        let check = startOffset;
        while (actDayMap[check]) {
          consecutiveDays++;
          check++;
        }
      }

      if (activeCaloriesToday === 0 && actDayMap[0]) {
        acts.forEach(a => {
          if (a && (a.isToday || (a.rawDate && String(a.rawDate).startsWith(todayIsoStr)))) {
            activeCaloriesToday += (a.calories || 0);
          }
        });
      }

      const fatigued = (typeof getFatiguedPatterns48h === 'function')
        ? getFatiguedPatterns48h()
        : { hinge: false, h_push: false, h_pull: false, v_push: false, knee_dom: false };

      const todayFeeling = getTodayFeeling();
      const todayGearMode = getTodayGearMode();
      const todayTimeMode = getTodayTimeMode();

      let effectiveReadiness = readiness;
      let effectiveBodyBattery = bodyBattery;

      if (todayFeeling === 'fresh') {
        effectiveReadiness = Math.min(100, readiness + 12);
        effectiveBodyBattery = Math.min(100, bodyBattery + 15);
      } else if (todayFeeling === 'beat_up') {
        effectiveReadiness = Math.max(0, readiness - 15);
        effectiveBodyBattery = Math.max(0, bodyBattery - 15);
      }

      // Priority order for mode
      let mode = 'full_body_strength';
      if (effectiveReadiness < 50 || effectiveBodyBattery < 35 || (sleepScore < 58 && consecutiveDays >= 3)) {
        mode = 'rest_day';
      } else if ((effectiveBodyBattery < 55 || consecutiveDays >= 3) && sleepScore >= 72) {
        mode = 'liss_cardio';
      } else if ((effectiveReadiness >= 50 && effectiveReadiness <= 62) || (sleepScore < 68 && consecutiveDays >= 2)) {
        mode = 'mobility_stretch';
      } else if ((fatigued.h_push || fatigued.h_pull) && (!fatigued.hinge && !fatigued.knee_dom)) {
        mode = 'lower_hinge';
      } else if ((fatigued.hinge || fatigued.knee_dom) && (!fatigued.h_push && !fatigued.h_pull)) {
        mode = 'upper_push_pull';
      } else {
        mode = 'full_body_strength';
      }

      const _hasActiveInjuryJoint = typeof athleteInjuries !== 'undefined' && athleteInjuries
        && ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles'].some((k) => Boolean(athleteInjuries[k]));
      const _isRedFlagRest = Boolean(
        _hasActiveInjuryJoint
        && athleteInjuries.last_diagnostic_summary
        && athleteInjuries.last_diagnostic_summary.triage_level === 'red_seek_care'
      );
      if (_isRedFlagRest) {
        mode = 'rest_day';
      }

      const _autonomicState = (typeof window !== 'undefined' && window.PULSE_ANALYTICS_SUMMARY && window.PULSE_ANALYTICS_SUMMARY.autonomic)
        ? window.PULSE_ANALYTICS_SUMMARY.autonomic
        : null;
      const _illnessToday = Boolean(_autonomicState && _autonomicState.illness && _autonomicState.illness.active_today);
      const _postIllnessRamp = Boolean(!_illnessToday && _autonomicState && _autonomicState.illness && _autonomicState.illness.post_illness_ramp_active);
      const _autonomicHighAlert = Boolean(
        _autonomicState && (
          Number(_autonomicState.alert_level || 0) >= 2 ||
          _autonomicState.system_state === 'ACUTE_EPISODE' ||
          _autonomicState.system_state === 'POST_EPISODE_RECOVERY'
        )
      );
      if (_illnessToday) {
        mode = 'rest_day';
      } else if (_postIllnessRamp && mode !== 'rest_day') {
        mode = 'liss_cardio';
      }

      const muscleStatus = {
        upperPush: fatigued.h_push ? 'Fatigued (48h volume)' : 'Fresh & Primed',
        upperPull: fatigued.h_pull ? 'Fatigued (48h volume)' : 'Fresh & Primed',
        lowerHinge: (fatigued.hinge || fatigued.knee_dom) ? 'Fatigued (48h volume)' : 'Fresh & Primed',
        cns: (effectiveReadiness < 65 || effectiveBodyBattery < 50 || consecutiveDays >= 3) ? 'Autonomic Debt' : 'Fully Recovered'
      };

      let archetypeKey = 'option_a';
      let optionLabels = {};
      let badge = '';
      let title = '';
      let goldfishReason = '';
      let isRest = false;
      let ctaText = 'Start Workout ➔';
      let optionId = 'bb_upper_hinge';

      const gearTitleMap = {
        gym: 'Barbell & Heavy Station',
        kb: 'Heavy Kettlebell Complex',
        bodyweight: 'Work Capacity & Bodyweight'
      };

      if (mode === 'rest_day') {
        archetypeKey = 'option_c';
        optionId = 'mobility_stretch';
        optionLabels = {
          option_a: 'Barbell Deload',
          option_kb: 'Light KB Flow',
          option_b: 'Work Capacity',
          option_c: '⭐ Rest & Walk'
        };
        badge = '🛌 REST DAY RECOMMENDED';
        title = 'Full Rest & Parasympathetic Recovery';
        goldfishReason = `Accumulated autonomic debt with ${consecutiveDays} consecutive training days (Readiness ${effectiveReadiness}, Battery ${effectiveBodyBattery}%). Prioritize deep sleep (${sleepScore}), clean hydration, and myofibrillar repair.`;
        ctaText = '✓ Log Rest Day';
        isRest = true;
        if (_isRedFlagRest) {
          badge = '🚨 CLINICAL REST ADVISED';
          title = 'Protective Rest & Medical Evaluation';
          goldfishReason = 'Red-flag biomechanical triage active: ' + (athleteInjuries.last_diagnostic_summary.summary_headline || 'Pause aggravating training and seek clinical evaluation.');
          ctaText = '🛡️ Review Triage';
        }
        if (_illnessToday) {
          badge = '🤒 ILLNESS RECOVERY MODE';
          title = 'Rest & Immune Recovery (No Hard Training)';
          goldfishReason = 'Illness Recovery Mode is active today. Skip strenuous loading, eat at Maintenance (protein locked), hydrate, and prioritize sleep until symptoms resolve.';
          ctaText = '🤒 Manage Sick Log';
        }
      } else if (mode === 'liss_cardio') {
        archetypeKey = 'option_c';
        optionId = 'recovery_flush_walk';
        optionLabels = {
          option_a: 'Option A (BB)',
          option_kb: 'Option KB',
          option_b: 'Option B (Work)',
          option_c: '⭐ Zone 2 Flush'
        };
        badge = _postIllnessRamp ? '🛡️ POST-ILLNESS RETURN RAMP' : '🚶 ZONE 2 LISS RECOMMENDED';
        title = _postIllnessRamp ? 'Day-1 Gentle Flush & Mobility (75% Cap)' : 'Zone 2 Aerobic Engine & Flush';
        goldfishReason = _postIllnessRamp
          ? 'First day back after illness: keep exertion gentle (Zone 2 flush / mobility, ~75% volume cap) and avoid solo high-intensity pushing while autonomic baseline stabilizes.'
          : `Sleep restored (${sleepScore}, ${sleepDuration}) but cumulative workload (${consecutiveDays} consecutive days, Battery ${effectiveBodyBattery}%) favors low CNS aerobic work. Flushes metabolic waste without joint shear.`;
        ctaText = 'Open Recommended Workouts →';
        isRest = false;
      } else if (mode === 'mobility_stretch') {
        archetypeKey = 'option_c';
        optionId = 'mobility_stretch';
        optionLabels = {
          option_a: 'Barbell Deload',
          option_kb: 'KB Mobility',
          option_b: 'Core Capacity',
          option_c: '⭐ Mobility Flow'
        };
        badge = '🧘 MOBILITY & STRETCH RECOMMENDED';
        title = 'Thoracic & Hip Mobility Reset';
        goldfishReason = `Moderate recovery debt detected (Readiness ${effectiveReadiness}, Sleep ${sleepScore}). 20 minutes of joint decompression restores range of motion and clears connective tissue stiffness.`;
        ctaText = 'Open Recommended Workouts →';
        isRest = false;
      } else if (mode === 'lower_hinge') {
        archetypeKey = todayGearMode === 'kb' ? 'option_kb' : (todayGearMode === 'bodyweight' ? 'option_b' : 'option_a');
        optionId = todayGearMode === 'kb' ? 'kb_complex' : (todayGearMode === 'bodyweight' ? 'hybrid_work_capacity' : 'bb_upper_hinge');
        optionLabels = {
          option_a: 'Lower/Hinge (BB)',
          option_kb: 'KB Lower/Core',
          option_b: 'Work Capacity',
          option_c: 'LISS Flush'
        };
        badge = '🦵 LOWER & HINGE RECOMMENDED';
        title = `Lower Posterior Chain & Hinge (${gearTitleMap[todayGearMode] || 'Gym'})`;
        goldfishReason = `Upper pushing and pulling volume fatigued from past 48h. Posterior chain and knee-friendly hinges are fresh, primed, and cleared for mechanical loading.`;
        ctaText = 'Open Recommended Workouts →';
        isRest = false;
      } else if (mode === 'upper_push_pull') {
        archetypeKey = todayGearMode === 'kb' ? 'option_kb' : (todayGearMode === 'bodyweight' ? 'option_b' : 'option_a');
        optionId = todayGearMode === 'kb' ? 'kb_complex' : (todayGearMode === 'bodyweight' ? 'hybrid_work_capacity' : 'bb_upper_hinge');
        optionLabels = {
          option_a: 'Upper Push/Pull',
          option_kb: 'KB Upper Tension',
          option_b: 'Push-Up Density',
          option_c: 'Joint Flush'
        };
        badge = '💪 UPPER PUSH & PULL RECOMMENDED';
        title = `Upper Body Push & Pull (${gearTitleMap[todayGearMode] || 'Gym'})`;
        goldfishReason = `Lower body and hinge patterns carrying 48h fatigue. Upper pectorals, lats, and triceps are primed for high myofibrillar tension.`;
        ctaText = 'Open Recommended Workouts →';
        isRest = false;
      } else {
        // full_body_strength
        archetypeKey = todayGearMode === 'kb' ? 'option_kb' : (todayGearMode === 'bodyweight' ? 'option_b' : 'option_a');
        optionId = todayGearMode === 'kb' ? 'kb_complex' : (todayGearMode === 'bodyweight' ? 'hybrid_work_capacity' : 'bb_upper_hinge');
        optionLabels = {
          option_a: 'Barbell Option A',
          option_kb: 'Option KB',
          option_b: 'Work Capacity',
          option_c: 'LISS Flush'
        };
        badge = todayGearMode === 'kb' ? '⭐ HEAVY KETTLEBELL RECOMMENDED' : (todayGearMode === 'bodyweight' ? '⭐ WORK CAPACITY RECOMMENDED' : '⭐ HEAVY BARBELL RECOMMENDED');
        title = `Full Body Strength & Muscle Anchor (${gearTitleMap[todayGearMode] || 'Gym'})`;
        goldfishReason = `High systemic readiness (${effectiveReadiness}), solid body battery (${effectiveBodyBattery}%), and quality rest (${sleepScore}, ${sleepDuration}). Fully cleared for peak mechanical tension.`;
        ctaText = 'Open Recommended Workouts →';
        isRest = false;
      }

      const stepsToday = Number((window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && window.BAKED_LIVE_STATE.garmin.steps) || 0);
      const stepGoal = 12000;
      const stepsRemaining = Math.max(0, stepGoal - stepsToday);
      const stepPct = Math.min(100, Math.round((stepsToday / stepGoal) * 100));

      // 14-day Renpho plateau detection
      let isPlateaued = false;
      let weightDeltaKg = 0;
      let bfDeltaPct = 0;
      let trendDays = 0;
      const rawHist = Array.isArray(window.PULSE_RENPHO_HISTORY) ? window.PULSE_RENPHO_HISTORY : [];
      const cutoff14Ts = Math.floor(Date.now() / 1000) - (14 * 86400);
      const hist = rawHist.filter(r => r && (!r.timestamp || Number(r.timestamp) >= cutoff14Ts));
      if (hist.length >= 2) {
        const sorted = hist.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const tsDiffDays = ((last.timestamp || 0) - (first.timestamp || 0)) / 86400;
        trendDays = Math.round(tsDiffDays);
        if (first.weight_kg && last.weight_kg) {
          weightDeltaKg = Number((last.weight_kg - first.weight_kg).toFixed(2));
        }
        if (first.body_fat_pct && last.body_fat_pct) {
          bfDeltaPct = Number((last.body_fat_pct - first.body_fat_pct).toFixed(2));
        }
        if (tsDiffDays >= 10 && hist.length >= 4 && (weightDeltaKg >= -0.2 && bfDeltaPct >= -0.2)) {
          isPlateaued = true;
        }
      }

      const baseCalTarget = Number(
        (typeof myNetDiaryData !== 'undefined' && myNetDiaryData?.targets?.calories) ||
        window.BAKED_LIVE_STATE?.nutrition?.calorie_target ||
        2437
      );
      const consumedCals = Number((typeof myNetDiaryData !== 'undefined' && myNetDiaryData?.totals?.calories) || 0);
      const tighterCalTarget = Math.max(1850, baseCalTarget - 250);

      // Second-Session ("Room for More") evaluation
      const completedCheck = (typeof getTodayCompletedWorkout === 'function') ? getTodayCompletedWorkout() : null;
      const roomForMore = Boolean(
        !_illnessToday &&
        !_postIllnessRamp &&
        !_autonomicHighAlert &&
        completedCheck &&
        completedCheck.isLightOrNonStrength &&
        todayFeeling !== 'beat_up' &&
        effectiveBodyBattery >= 50 &&
        effectiveReadiness >= 55
      );
      if (_autonomicHighAlert && !_illnessToday) {
        goldfishReason = `${goldfishReason} ⚠️ Autonomic alert/recovery active — avoid solo high-risk physical exertion until normalized.`.trim();
      }

      let secondSession = null;
      if (roomForMore) {
        if (!completedCheck.isStrength && todayGearMode !== 'bodyweight') {
          const secArch = todayGearMode === 'kb' ? 'option_kb' : 'option_a';
          secondSession = {
            archetypeKey: secArch,
            title: todayGearMode === 'kb' ? 'Heavy Kettlebell Strength Block' : 'Focused Barbell Strength & Hinge',
            durationMin: todayTimeMode === '20m' ? 25 : 35,
            targetBurn: 290,
            reason: `Your morning session (${completedCheck.calories} kcal) was light cardio/movement, leaving ${stepsRemaining.toLocaleString()} steps to your 12,000 target and high recovery (${effectiveBodyBattery}% Battery, ${effectiveReadiness} Readiness). Adding focused resistance drives muscle retention and afterburn.`
          };
        } else if (stepsRemaining >= 4000) {
          secondSession = {
            archetypeKey: 'option_b',
            title: 'Work Capacity + Zone 2 Step Finisher',
            durationMin: 30,
            targetBurn: 280,
            reason: `Your morning session (${completedCheck.calories} kcal) left ${stepsRemaining.toLocaleString()} steps to hit 12,000 today. A brisk 30m Zone 2 / conditioning finisher adds ~3,500–4,000 steps and ~280 kcal without CNS overload.`
          };
        } else {
          secondSession = {
            archetypeKey: 'option_b',
            title: '20–30m Conditioning / Kettlebell Finisher',
            durationMin: 25,
            targetBurn: 260,
            reason: `With ${effectiveBodyBattery}% Body Battery remaining and a light ${completedCheck.calories} kcal morning session, a crisp conditioning finisher widens today's caloric deficit cleanly.`
          };
        }
      }

      return {
        mode,
        archetypeKey: roomForMore && secondSession ? secondSession.archetypeKey : archetypeKey,
        recommendedArchetype: roomForMore && secondSession ? secondSession.archetypeKey : archetypeKey,
        optionId,
        badge,
        title,
        goldfishReason,
        ctaText,
        isRest,
        sleepScore,
        sleepDuration,
        readiness,
        effectiveReadiness,
        bodyBattery,
        effectiveBodyBattery,
        restingHr,
        activeCaloriesToday,
        consecutiveDays,
        burn72h,
        workoutsLast4Days,
        todayLogged,
        muscleStatus,
        optionLabels,
        todayFeeling,
        todayGearMode,
        todayTimeMode,
        stepsToday,
        stepGoal,
        stepsRemaining,
        stepPct,
        isPlateaued,
        weightDeltaKg,
        bfDeltaPct,
        trendDays,
        baseCalTarget,
        consumedCals,
        tighterCalTarget,
        roomForMore,
        secondSession
      };
    }

    function renderTodayTrainingRecommendations() {
      const slot = document.getElementById('todayTrainingDynamicSlot');
      const dot = document.getElementById('todayTrainingDot');
      const hdrText = document.getElementById('todayTrainingHeaderText');
      if (!slot) return;

      const verdict = computeTodayWorkoutVerdict();
      if (typeof updateArchetypeStarBadge === 'function') {
        updateArchetypeStarBadge(verdict.archetypeKey, verdict.optionLabels);
      }
      if (!window._userManualArchetype && typeof loadDailyArchetype === 'function' && currentArchetypeKey !== verdict.archetypeKey) {
        loadDailyArchetype(verdict.archetypeKey);
      }

      const completed = (typeof getTodayCompletedWorkout === 'function') ? getTodayCompletedWorkout() : null;

      if (dot) {
        dot.style.background = completed ? 'var(--primary, #30d158)' : 'var(--primary)';
        dot.style.boxShadow = 'none';
      }
      if (hdrText) {
        if (completed) {
          hdrText.innerText = "TODAY'S TRAINING COMPLETE";
          hdrText.style.color = "var(--primary, #30d158)";
        } else {
          hdrText.innerText = "TODAY'S TRAINING RECOMMENDATIONS";
          hdrText.style.color = "var(--text-muted)";
        }
      }

      let scaleWeight = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.weightKg)) && Number(window.athleteProfile.weightKg) > 0)
        ? Number(window.athleteProfile.weightKg)
        : null;
      let bodyFatPct = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.bodyFatPct)) && Number(window.athleteProfile.bodyFatPct) > 0)
        ? Number(window.athleteProfile.bodyFatPct)
        : null;
      let leanMass = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)) && Number(window.athleteProfile.leanMassKg) > 0)
        ? Number(window.athleteProfile.leanMassKg)
        : null;
      let fatToLose = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.fatToLoseKg)))
        ? Number(window.athleteProfile.fatToLoseKg)
        : null;
      let targetWeight = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.targetWeightKg)) && Number(window.athleteProfile.targetWeightKg) > 0)
        ? Number(window.athleteProfile.targetWeightKg)
        : null;

      if (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.renpho) {
        const r = window.BAKED_LIVE_STATE.renpho;
        if (r.weight_kg != null && Number.isFinite(Number(r.weight_kg)) && Number(r.weight_kg) > 0) scaleWeight = Number(r.weight_kg);
        if (r.body_fat_pct != null && Number.isFinite(Number(r.body_fat_pct)) && Number(r.body_fat_pct) > 0) bodyFatPct = Number(r.body_fat_pct);
        if (r.lean_mass_kg != null && Number.isFinite(Number(r.lean_mass_kg)) && Number(r.lean_mass_kg) > 0) leanMass = Number(r.lean_mass_kg);
        if (r.fat_to_lose_kg != null && Number.isFinite(Number(r.fat_to_lose_kg))) fatToLose = Number(r.fat_to_lose_kg);
        if (r.target_weight_at_15pct != null && Number.isFinite(Number(r.target_weight_at_15pct)) && Number(r.target_weight_at_15pct) > 0) targetWeight = Number(r.target_weight_at_15pct);
      }

      // Compact context pill strips
      const f = verdict.todayFeeling;
      const g = verdict.todayGearMode;
      const t = verdict.todayTimeMode;

      const pillActiveStyle = "background:var(--primary); color:#000; font-weight:800; border-color:var(--primary);";
      const pillInactiveStyle = "background:rgba(255,255,255,0.05); color:var(--text-secondary); border-color:rgba(255,255,255,0.12);";

      const contextPillsHtml = `
<div style="margin-bottom:12px; display:flex; flex-direction:column; gap:6px;">
          
<div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:2px;">
<button type="button" class="header-pill-btn" onclick="setTodayContext('feeling', 'fresh')" style="flex:1; min-height:30px; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; ${f === 'fresh' ? pillActiveStyle : pillInactiveStyle}">
              ⚡ Feeling Fresh
</button>
<button type="button" class="header-pill-btn" onclick="setTodayContext('feeling', 'normal')" style="flex:1; min-height:30px; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; ${f === 'normal' ? pillActiveStyle : pillInactiveStyle}">
              ⚖️ As Metrics Say
</button>
<button type="button" class="header-pill-btn" onclick="setTodayContext('feeling', 'beat_up')" style="flex:1; min-height:30px; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; ${f === 'beat_up' ? pillActiveStyle : pillInactiveStyle}">
              🪫 Beat Up
</button>
</div>

          
<div style="display:flex; gap:6px; align-items:center; overflow-x:auto; padding-bottom:2px;">
<button type="button" class="header-pill-btn" onclick="setTodayContext('gear', 'gym')" style="flex:1; min-height:30px; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; ${g === 'gym' ? pillActiveStyle : pillInactiveStyle}">
              🏋️ Gym
</button>
<button type="button" class="header-pill-btn" onclick="setTodayContext('gear', 'kb')" style="flex:1; min-height:30px; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; ${g === 'kb' ? pillActiveStyle : pillInactiveStyle}">
              🔔 KB
</button>
<button type="button" class="header-pill-btn" onclick="setTodayContext('gear', 'bodyweight')" style="flex:1; min-height:30px; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap; ${g === 'bodyweight' ? pillActiveStyle : pillInactiveStyle}">
              🤸 Bodyweight
</button>
<div style="width:1px; height:18px; background:rgba(255,255,255,0.15); margin:0 2px;"></div>
<button type="button" class="header-pill-btn" onclick="setTodayContext('time', '20m')" style="min-height:30px; font-size:11px; padding:4px 10px; border-radius:6px; cursor:pointer; white-space:nowrap; ${t === '20m' ? pillActiveStyle : pillInactiveStyle}">
              ⏱ 20m
</button>
<button type="button" class="header-pill-btn" onclick="setTodayContext('time', '45m')" style="min-height:30px; font-size:11px; padding:4px 10px; border-radius:6px; cursor:pointer; white-space:nowrap; ${t === '45m' ? pillActiveStyle : pillInactiveStyle}">
              ⏱ 45m
</button>
</div>
</div>
      `;

      // Collapsed Elephant Accordion
      const elephantAccordionHtml = `
<details style="margin-top:12px; background:#0d0f14; border:1px solid rgba(255,255,255,0.06); border-radius:10px; overflow:hidden;">
<summary style="font-size:11.5px; font-weight:700; color:var(--text-secondary); padding:10px 12px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>🔬 View Full Biometrics, 72h Load & Muscle Recovery Map</span>
<span style="font-size:11.5px; color:var(--text-muted);">▾</span>
</summary>
<div style="padding:10px 12px; font-size:11px; color:#a1a1aa; line-height:1.5; border-top:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:6px;">
<div>• <strong>Biometrics:</strong> Sleep ${verdict.sleepScore} (${verdict.sleepDuration}) • Body Battery ${verdict.bodyBattery}% • Readiness ${verdict.readiness} • RHR ${verdict.restingHr != null ? `${verdict.restingHr} bpm` : '--'}</div>
<div>• <strong>Cumulative Workload:</strong> ${verdict.consecutiveDays} consecutive training days • ~${verdict.burn72h} kcal burned across last 72 hours (${verdict.workoutsLast4Days} workouts in 4 days) • Today active burn: ${verdict.activeCaloriesToday} kcal</div>
<div style="background:rgba(255,255,255,0.02); padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.04); margin-top:2px;">
<div style="font-weight:700; color:#fff; margin-bottom:3px; text-transform:uppercase; font-size:10px; letter-spacing:0.04em;">Muscle Recovery Map:</div>
<div>• Upper Push: <strong style="color:${verdict.muscleStatus.upperPush.includes('Fatigued') ? '#f59e0b' : 'var(--primary)'};">${verdict.muscleStatus.upperPush}</strong></div>
<div>• Upper Pull: <strong style="color:${verdict.muscleStatus.upperPull.includes('Fatigued') ? '#f59e0b' : 'var(--primary)'};">${verdict.muscleStatus.upperPull}</strong></div>
<div>• Lower & Hinge: <strong style="color:${verdict.muscleStatus.lowerHinge.includes('Fatigued') ? '#f59e0b' : 'var(--primary)'};">${verdict.muscleStatus.lowerHinge}</strong></div>
<div>• CNS Recovery: <strong style="color:${verdict.muscleStatus.cns.includes('Debt') ? '#ef4444' : 'var(--primary)'};">${verdict.muscleStatus.cns}</strong></div>
</div>
<div>• <strong>Body Recomp Target:</strong> Current ${scaleWeight != null ? scaleWeight : '--'} kg (${bodyFatPct != null ? bodyFatPct : '--'}% BF) ➔ Goal ${targetWeight != null ? targetWeight : '--'} kg (15.0% BF, ${fatToLose != null ? fatToLose : '--'} kg fat to lose, ${leanMass != null ? leanMass : '--'} kg lean mass preserved)</div>
<div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
<button type="button" class="header-pill-btn" onclick="openEquipmentModal('today')" style="padding:4px 10px; font-size:10.5px; background:rgba(0,229,255,0.08); border:1px solid rgba(0,229,255,0.3); color:var(--primary); font-weight:700; cursor:pointer;">
                ⚙ Tailor Equipment
</button>
<button type="button" class="header-pill-btn" onclick="toggleWorkoutCompleteManual(true)" style="padding:4px 10px; font-size:10.5px; background:rgba(48,209,88,0.12); border:1px solid rgba(48,209,88,0.3); color:var(--primary); font-weight:700; cursor:pointer;">
                ✓ Mark Complete
</button>
</div>
</div>
</details>
      `;

      // 7-Day Recomp Ledger computation (Elephant depth, Goldfish 3-metric glance)
      const now7 = Date.now();
      const sevenDaysMs = 7 * 24 * 3600 * 1000;
      const allRecentActs = (typeof recentActivitiesData !== 'undefined' && Array.isArray(recentActivitiesData) && recentActivitiesData.length > 0)
        ? recentActivitiesData
        : ((window.BAKED_LIVE_STATE?.garmin?.recent_activities) || []);
      const acts7d = allRecentActs.filter(a => {
        if (!a) return false;
        const rawD = a.rawDate || a.date || '';
        const t = new Date(String(rawD).replace(' ', 'T')).getTime();
        return !isNaN(t) && (now7 - t) <= sevenDaysMs && (now7 - t) >= -86400000;
      });
      const totalActiveBurn7d = acts7d.reduce((s, a) => s + Number(a.calories || 0), 0);
      const avgActiveBurn7d = Math.round(totalActiveBurn7d / 7);
      let strengthSessions7d = acts7d.filter(a => /strength|barbell|kettlebell/i.test(`${a.name || ''} ${a.subTitle || a.sub_title || ''} ${a.activity_type_key || ''}`)).length;
      try {
        const localSess = JSON.parse(localStorage.getItem('pulse_session_history') || '[]');
        if (Array.isArray(localSess)) {
          const inAppStr7d = localSess.filter(s => s && s.preset === 'gym' && s.date && (now7 - new Date(s.date).getTime()) <= sevenDaysMs).length;
          strengthSessions7d = Math.max(strengthSessions7d, inAppStr7d);
        }
      } catch(e) {}
      const targetDeficit = Number(window.BAKED_LIVE_STATE?.nutrition?.deficit || 350);
      const weeklyFatLossEstG = Math.round(((targetDeficit + Math.round(avgActiveBurn7d * 0.25)) * 7) / 7.7);

      const stepBarHtml = `
<div style="margin-top:10px; padding:9px 11px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:9px;">
<div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; margin-bottom:5px;">
<span style="color:var(--text-secondary); font-weight:700;">👣 Daily Total Steps: <strong style="color:#fff;">${verdict.stepsToday.toLocaleString()}</strong> / 12,000</span>
<span style="color:${verdict.stepsRemaining === 0 ? '#10b981' : 'var(--primary)'}; font-weight:800;">
              ${verdict.stepsRemaining === 0 ? '✓ 12k Goal Hit' : `${verdict.stepsRemaining.toLocaleString()} left`}
</span>
</div>
<div style="width:100%; height:5px; background:rgba(255,255,255,0.07); border-radius:999px; overflow:hidden;">
<div style="width:${verdict.stepPct}%; height:100%; background:linear-gradient(90deg, #00F0FF, #3B82F6); border-radius:999px;"></div>
</div>
          
<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-top:8px; padding-top:7px; border-top:1px solid rgba(255,255,255,0.06); text-align:center;">
<div>
<div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">7d Active Burn</div>
<div style="font-size:11.5px; font-weight:800; color:var(--primary); margin-top:1px;">${totalActiveBurn7d.toLocaleString()} kcal <span style="font-size:9.5px; color:var(--text-muted);">(${avgActiveBurn7d}/d)</span></div>
</div>
<div>
<div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">7d Strength</div>
<div style="font-size:11.5px; font-weight:800; color:${strengthSessions7d >= 3 ? '#10b981' : '#fbbf24'}; margin-top:1px;">${strengthSessions7d} / 3 Sessions</div>
</div>
<div>
<div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">7d Deficit Pace</div>
<div style="font-size:11.5px; font-weight:800; color:#c4b5fd; margin-top:1px;">-${targetDeficit}/d (~${weeklyFatLossEstG}g/wk)</div>
</div>
</div>
</div>
      `;

      function renderIntradayAndEveningCloseoutHtml(v, comp) {
        let ukHour = 12;
        try {
          ukHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }).format(new Date()));
        } catch(e) {}

        const morningBb = (v.sleepScore || 93) >= 90
          ? 100
          : Math.min(100, Math.round((v.sleepScore || 93) * 1.05));
        const currBb = Number(v.bodyBattery || 64);
        const bbDrain = Math.max(1, morningBb - currBb);
        const activeBurn = Number(v.activeCaloriesToday ?? (comp ? comp.calories : 0) ?? 0);
        const kcalPerBbPt = Math.round((activeBurn / bbDrain) * 10) / 10;
        const cleanLoad = kcalPerBbPt >= 8 || bbDrain <= 45;

        const mndTotals = (typeof myNetDiaryData !== 'undefined' && myNetDiaryData && myNetDiaryData.totals) ? myNetDiaryData.totals : {};
        const remCals = Math.max(0, Math.round((v.baseCalTarget || 2570) - (v.consumedCals || Number(mndTotals.calories || 0) || 0)));
        const loggedP = Math.round(Number(mndTotals.protein || 0));
        const remP = Math.max(0, 200 - loggedP);
        const loggedF = Math.round(Number(mndTotals.fat || 0));
        const remF = Math.max(0, 75 - loggedF);
        const estTomorrowReadiness = Math.min(95, Math.round(currBb * 0.45 + 55));
        const isEvening = ukHour >= 17;

        const goldfishLine = isEvening
          ? `🌙 EVENING RECOVERY CLOSE-OUT • ${remP}g Protein &amp; ${remF}g Healthy Fat left • Est. Tomorrow Readiness ~${estTomorrowReadiness}`
          : `🔋 INTRADAY BATTERY PACE: ${morningBb}% ➔ ${currBb}% (-${bbDrain} pts for ${activeBurn} active kcal • ${kcalPerBbPt} kcal/pt)`;

        const statusBadge = isEvening
          ? `<span style="font-size:9.5px; font-weight:800; padding:2px 7px; border-radius:5px; background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.4); color:#c4b5fd;">${remCals} kcal runway</span>`
          : `<span style="font-size:9.5px; font-weight:800; padding:2px 7px; border-radius:5px; background:${cleanLoad ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.16)'}; border:1px solid ${cleanLoad ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.38)'}; color:${cleanLoad ? '#10b981' : '#fbbf24'};">${cleanLoad ? '✅ Clean Autonomic Load' : '⚠️ Elevated Non-Training Stress'}</span>`;

        return `
<div style="margin-top:10px; background:rgba(15,23,42,0.65); border:1px solid rgba(56,189,248,0.22); border-radius:10px; padding:9px 11px;">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<div style="font-size:10.5px; font-weight:800; color:${isEvening ? '#c4b5fd' : '#38bdf8'}; line-height:1.35;">
                ${goldfishLine}
</div>
              ${statusBadge}
</div>
<details style="margin-top:7px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.06); border-radius:7px; overflow:hidden;">
<summary style="font-size:10.5px; font-weight:700; color:var(--text-secondary); padding:6px 9px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>🔬 View Intraday Autonomic Drain &amp; Pre-Sleep Close-Out Protocol</span>
<span style="color:var(--text-muted);">▾</span>
</summary>
<div style="padding:8px 10px; border-top:1px solid rgba(255,255,255,0.06); font-size:11px; color:#cbd5e1; line-height:1.45; display:flex; flex-direction:column; gap:5px;">
<div>• <strong>Autonomic Drain Efficiency:</strong> <strong>-${bbDrain}%</strong> Body Battery (${morningBb}% ➔ ${currBb}%) vs <strong>${activeBurn} active kcal</strong> + <strong>${Number(v.stepsToday || 0).toLocaleString()} steps</strong> = <strong>${kcalPerBbPt} kcal/pt</strong> (${cleanLoad ? 'High Metabolic Efficiency / Low Non-Training Stress' : 'Elevated sympathetic stress outside training'}).</div>
<div>• <strong>Pre-Sleep Macro Close-Out:</strong> <strong>${remP}g protein</strong> (${loggedP}g / 200g) &amp; <strong>${remF}g healthy fat</strong> (${loggedF}g / 75g) remaining within <strong>${remCals} kcal</strong> remaining runway.</div>
<div>• <strong>Evening Checklist:</strong> Cut off heavy hydration &amp; screens 90m pre-bed, take magnesium/electrolytes with final protein-rich feed, and target 7.5–8h sleep to rebound Body Battery toward ~${Math.min(100, currBb + 34)}% (est. tomorrow Readiness ~<strong>${estTomorrowReadiness}</strong>).</div>
</div>
</details>
</div>
        `;
      }

      function renderWeeklyExecutiveBriefHtml(v, sw, bfPct, tw, ftl, lm, burn7d, avgBurn7d, strSessions7d, wkFatLossG) {
        const mndHist = (typeof myNetDiaryData !== 'undefined' && myNetDiaryData && myNetDiaryData.history) ? myNetDiaryData.history : {};
        const avg7d = (mndHist && mndHist.averages_7d)
          ? mndHist.averages_7d
          : { calories: 2544, protein: 259, fat: 64.4, fiber: 39.9 };

        let strengthActs = 0, strengthCals = 0;
        let combatCondActs = 0, combatCondCals = 0;
        let walkActs = 0, walkCals = 0;
        let totalDur7d = 0;

        acts7d.forEach(a => {
          if (!a) return;
          const nm = `${a.name || ''} ${a.subTitle || a.sub_title || ''} ${a.activity_type_key || ''}`.toLowerCase();
          const c = Number(a.calories || 0);
          totalDur7d += Number(a.durationMin || a.duration_min || 0);
          const p = (typeof parseWorkoutNoteDetails === 'function') ? parseWorkoutNoteDetails(nm, a) : {};
          if (/strength|barbell|lift|gym/i.test(nm) && !p.hasBodyCombat && !p.hasJumpRope) {
            strengthActs += 1;
            strengthCals += c;
          } else if (/walk|stroll|hike|ruck/i.test(nm)) {
            walkActs += 1;
            walkCals += c;
          } else {
            combatCondActs += 1;
            combatCondCals += c;
          }
        });

        const fatToLoseNum = (ftl != null && Number.isFinite(Number(ftl))) ? Number(ftl) : null;
        const wkLossKg = Math.max(0.25, wkFatLossG / 1000);
        const estWeeks = fatToLoseNum !== null ? Math.max(2, Math.round((fatToLoseNum * 1000) / Math.max(250, wkFatLossG))) : null;
        const cumDeficitKcal = fatToLoseNum !== null ? Math.round(fatToLoseNum * 7700) : null;
        const swStr = (sw != null && Number.isFinite(Number(sw))) ? `${sw}` : '--';
        const bfStr = (bfPct != null && Number.isFinite(Number(bfPct))) ? `${bfPct}` : '--';
        const lmStr = (lm != null && Number.isFinite(Number(lm))) ? `${lm}` : '--';
        const twStr = (tw != null && Number.isFinite(Number(tw))) ? `${tw}` : '--';
        const ftlStr = fatToLoseNum !== null ? `${fatToLoseNum.toFixed(2)}kg to 15.0%` : 'Pending scan';
        const wholeFoodPct = Math.round(Number(mndHist.whole_food_pct || 86));

        return `
<div class="card" style="margin-top:12px; padding:12px 14px; background:#111520; border:1px solid rgba(0,229,255,0.22); border-radius:12px;">
            
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:9px;">
<div style="font-size:11px; font-weight:800; color:#fff; letter-spacing:0.05em;">
                📈 7-DAY EXECUTIVE HYBRID BRIEF
</div>
<span style="font-size:10px; font-weight:800; color:#10b981; background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35); padding:2px 8px; border-radius:5px;">
                ${estWeeks !== null ? `On Pace: ~${wkLossKg.toFixed(2)} kg/wk ➔ 15.0% BF in ~${estWeeks} wks` : `Pace: ~${wkLossKg.toFixed(2)} kg/wk • Pending Scan`}
</span>
</div>

            
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:7px;">
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:7px 9px;">
<div style="font-size:9.5px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Scale (Measured)</div>
<div style="font-size:12px; font-weight:800; color:#fff; margin-top:2px;">${swStr}kg • ${bfStr}% BF</div>
<div style="font-size:10px; color:var(--cyan); margin-top:1px;">${ftlStr}</div>
</div>
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:7px 9px;">
<div style="font-size:9.5px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">7d Training</div>
<div style="font-size:12px; font-weight:800; color:#fff; margin-top:2px;">${strSessions7d}/3 Strength • ${acts7d.length} Total</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:1px;">${Math.round(totalDur7d)}m active time</div>
</div>
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:7px 9px;">
<div style="font-size:9.5px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">7d Active Burn</div>
<div style="font-size:12px; font-weight:800; color:var(--primary); margin-top:2px;">${burn7d.toLocaleString()} kcal</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:1px;">${avgBurn7d}/d avg</div>
</div>
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:7px 9px;">
<div style="font-size:9.5px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">7d Nutrition</div>
<div style="font-size:11.5px; font-weight:800; color:#c4b5fd; margin-top:2px;">${Math.round(avg7d.protein)}g P • ${Math.round(avg7d.fat)}g F • ${Math.round(avg7d.fiber)}g Fib</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:1px;">${Math.round(avg7d.calories).toLocaleString()} kcal/d avg</div>
</div>
</div>

            
<details style="margin-top:9px; background:#0b0e16; border:1px solid rgba(255,255,255,0.06); border-radius:8px; overflow:hidden;">
<summary style="font-size:11px; font-weight:700; color:var(--cyan); padding:8px 11px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>🐘 Expand Full 7-Day Recomp, Modality &amp; Micronutrient Ledger</span>
<span style="color:var(--text-muted);">▾</span>
</summary>
<div style="padding:10px 12px; border-top:1px solid rgba(255,255,255,0.05); font-size:11px; color:#cbd5e1; line-height:1.5; display:flex; flex-direction:column; gap:7px;">
<div>
<strong style="color:#fff;">1. Body Composition &amp; Scale Trajectory (Measured Only):</strong>
                  Scale weight <strong>${swStr} kg</strong> • Scale-measured body fat <strong>${bfStr}%</strong> • Lean mass <strong>${lmStr} kg</strong> • Target weight at 15.0% BF: <strong>${twStr} kg</strong> • Remaining fat to lose: <strong>${fatToLoseNum !== null ? fatToLoseNum.toFixed(2) : '--'} kg</strong>${cumDeficitKcal !== null ? ` (~<strong>${cumDeficitKcal.toLocaleString()} kcal</strong> cumulative deficit)` : ''}.
</div>
<div>
<strong style="color:#fff;">2. 7-Day Modality Mix (${acts7d.length} sessions • ${Math.round(totalDur7d)}m):</strong>
                  Barbell/Strength: <strong>${strengthActs}</strong> sessions (${strengthCals.toLocaleString()} kcal) • Body Combat / Jump Rope / KB Conditioning: <strong>${combatCondActs}</strong> sessions (${combatCondCals.toLocaleString()} kcal) • Walking / Steps: <strong>${walkActs}</strong> sessions (${walkCals.toLocaleString()} kcal).
</div>
<div>
<strong style="color:#fff;">3. 7-Day Nutrition vs. Targets:</strong>
                  Protein <strong>${Math.round(avg7d.protein)}g</strong> vs 200g target • Fat <strong>${Number(avg7d.fat).toFixed(1)}g</strong> vs 80g floor (add flaxseed/nuts or oily fish on lower-fat days to protect endocrine recovery) • Fiber <strong>${Number(avg7d.fiber).toFixed(1)}g</strong> vs 35g target • Whole-Food Ratio <strong>~${wholeFoodPct}%</strong>.
</div>
</div>
</details>
</div>
        `;
      }

      const intradayEveningHtml = renderIntradayAndEveningCloseoutHtml(verdict, completed);
      const weeklyExecutiveBriefHtml = renderWeeklyExecutiveBriefHtml(
        verdict,
        scaleWeight,
        bodyFatPct,
        targetWeight,
        fatToLose,
        leanMass,
        totalActiveBurn7d,
        avgActiveBurn7d,
        strengthSessions7d,
        weeklyFatLossEstG
      );

      const sessCount = completed ? (completed.sessionCount || 1) : 0;
      const bonusOptionLabel = sessCount >= 2
        ? (verdict.stepsRemaining >= 2000 ? `Top up ${verdict.stepsRemaining.toLocaleString()} steps (15–20m walk)` : 'Optional 15m core / mobility flush')
        : (verdict.stepsRemaining >= 3500 ? 'Add 30–40m brisk walk or second session' : 'Add 25m strength / KB finisher');
      const bonusKcalVal = sessCount >= 2 ? (verdict.stepsRemaining >= 2000 ? 150 : 120) : (verdict.secondSession ? verdict.secondSession.targetBurn : 280);

      const plateauDualHtml = (verdict.isPlateaued || verdict.roomForMore) ? `
<div style="margin-top:10px; padding:10px; background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.25); border-radius:10px;">
<div style="font-size:10.5px; font-weight:800; color:#fbbf24; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">
            ⚖️ ${verdict.trendDays >= 3 ? `Weight/BF Plateau (${verdict.weightDeltaKg >= 0 ? '+' : ''}${verdict.weightDeltaKg}kg over ${verdict.trendDays}d)` : `Goal Runway (${scaleWeight}kg / ${bodyFatPct}% → 15.0%)`} • Pick Your Lever
</div>
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
<div style="background:rgba(0,229,255,0.07); border:1px solid rgba(0,229,255,0.25); border-radius:8px; padding:8px;">
<div style="font-size:10px; font-weight:800; color:var(--primary); text-transform:uppercase;">Option 1: Burn More</div>
<div style="font-size:11.5px; font-weight:700; color:#fff; margin-top:2px;">+${bonusKcalVal} kcal Output</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:2px; line-height:1.35;">${bonusOptionLabel}</div>
<button type="button" onclick="openWorkoutTabFromVerdict()" style="margin-top:6px; width:100%; padding:5px 6px; font-size:10.5px; font-weight:800; background:var(--primary); color:#000; border:none; border-radius:5px; cursor:pointer;">${sessCount >= 2 ? 'Bonus Finisher ➔' : 'Open Session ➔'}</button>
</div>
<div style="background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.28); border-radius:8px; padding:8px;">
<div style="font-size:10px; font-weight:800; color:#c4b5fd; text-transform:uppercase;">Option 2: Eat Less</div>
<div style="font-size:11.5px; font-weight:700; color:#fff; margin-top:2px;">Cap ~${verdict.tighterCalTarget.toLocaleString()} kcal</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:2px; line-height:1.35;">-250 kcal tighter today (${verdict.consumedCals.toLocaleString()} logged so far)</div>
<button type="button" onclick="switchTab('fuel')" style="margin-top:6px; width:100%; padding:5px 6px; font-size:10.5px; font-weight:800; background:rgba(139,92,246,0.25); color:#fff; border:1px solid rgba(139,92,246,0.45); border-radius:5px; cursor:pointer;">Check Fuel Tab ➔</button>
</div>
</div>
</div>
      ` : '';

      if (completed && verdict.roomForMore && verdict.secondSession) {
        if (hdrText) {
          hdrText.innerText = "TODAY'S TRAINING • ROOM FOR MORE";
          hdrText.style.color = "var(--primary)";
        }
        const sec = verdict.secondSession;
        slot.innerHTML = `
          ${contextPillsHtml}

          
<div class="card" style="padding:15px; margin-bottom:12px; background:var(--surface-card, #14161e); border:1px solid rgba(0,229,255,0.4); border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.35);">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10px; font-weight:800; color:#000; background:var(--primary); padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.04em;">
                ⚡ LIGHT AM (${completed.calories} kcal) • ROOM FOR MORE
</span>
<span style="font-size:10.5px; color:var(--text-muted);">
<span onclick="openSleepOverridePrompt()" style="cursor:pointer; text-decoration:underline dotted; color:var(--text-secondary);" title="Tap to override Sleep Score">Sleep ${verdict.sleepScore} ✎</span> • Battery ${verdict.bodyBattery}% • Readiness ${verdict.readiness}
</span>
</div>

<div style="font-size:16px; font-weight:800; color:#fff; margin-top:8px; font-family:var(--font-sans);">
              Second Session: ${escapeHtml(sec.title)}
</div>

<div style="font-size:12px; color:#d4d4d8; line-height:1.45; margin-top:5px;">
              ${sec.reason}
</div>

            ${stepBarHtml}
            ${intradayEveningHtml}
            ${plateauDualHtml}

<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
<button class="btn-action-primary" onclick="openWorkoutTabFromVerdict()" style="flex:2; min-width:190px; height:44px; font-size:12.5px; font-weight:800; background:var(--primary); color:#000; box-shadow:0 0 15px rgba(0,229,255,0.25); cursor:pointer;">
                ▶ Open Second Session (~${sec.durationMin}m) ➔
</button>
<button class="btn-action-primary" onclick="viewCompletedWorkoutBreakdown()" style="flex:1; min-width:120px; height:44px; font-size:11.5px; font-weight:700; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; cursor:pointer;">
                AM Log (${completed.calories})
</button>
</div>

<div style="text-align:center; margin-top:10px;">
<span style="font-size:10.5px; color:var(--text-muted); text-decoration:underline; cursor:pointer;" onclick="toggleWorkoutCompleteManual(true)">
                ✓ I'm Done for Today (Mark Complete)
</span>
</div>
</div>

          ${typeof renderTomorrowPreviewCard === 'function' ? renderTomorrowPreviewCard(completed) : ''}
          ${elephantAccordionHtml}
          ${weeklyExecutiveBriefHtml}
        `;
      } else if (completed) {
        const proteinTarget = (window.BAKED_LIVE_STATE?.nutrition?.protein_target_g) || 200;
        const badgeLabel = sessCount >= 2
          ? `✓ ${sessCount} SESSIONS LOGGED TODAY (${completed.calories} KCAL)`
          : `✓ TODAY'S TRAINING COMPLETE`;
        if (hdrText) {
          hdrText.innerText = sessCount >= 2 ? `TODAY'S TRAINING • ${sessCount} SESSIONS COMPLETE` : "TODAY'S TRAINING COMPLETE";
          hdrText.style.color = "var(--primary, #30d158)";
        }

        const sessionChipsHtml = (Array.isArray(completed.sessionSummaries) && completed.sessionSummaries.length > 1)
          ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
              ${completed.sessionSummaries.map((s, idx) => `
<span style="font-size:10.5px; font-weight:700; color:${idx === 0 ? 'var(--primary)' : 'var(--cyan)'}; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); padding:3px 8px; border-radius:6px;">
                  Session ${idx + 1}: ${escapeHtml(s.title)} (${s.durationMin}m • ${s.calories} kcal)
</span>
              `).join('')}
</div>`
          : '';

        slot.innerHTML = `
          ${contextPillsHtml}

          
<div class="card" style="padding:15px; margin-bottom:12px; background:var(--surface-card, #14161e); border:1px solid rgba(48,209,88,0.35); border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.35);">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10px; font-weight:800; color:var(--primary, #30d158); background:rgba(48,209,88,0.12); border:1px solid rgba(48,209,88,0.3); padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.04em;">
                ${badgeLabel}
</span>
<span style="font-size:10.5px; color:var(--text-muted);">
<span onclick="openSleepOverridePrompt()" style="cursor:pointer; text-decoration:underline dotted; color:var(--text-secondary);" title="Tap to override Sleep Score">Sleep ${verdict.sleepScore} ✎</span> • Battery ${verdict.bodyBattery}% • Readiness ${verdict.readiness}
</span>
</div>

<div style="font-size:16px; font-weight:800; color:#fff; margin-top:8px; font-family:var(--font-sans);">
              ${escapeHtml(completed.title || 'Completed Session')}
</div>

            ${sessionChipsHtml}

<div style="font-size:12px; color:#d4d4d8; line-height:1.45; margin-top:6px;">
              You've completed <strong>${sessCount} ${sessCount === 1 ? 'session' : 'sessions'}</strong> totaling <strong>${completed.durationMin || 45}m</strong> (<strong>${completed.calories || 320} kcal</strong> active burn) today. Lock in your ${proteinTarget}g protein anchor and recovery so lean mass rebuilds cleanly.
</div>

            ${stepBarHtml}
            ${intradayEveningHtml}
            ${plateauDualHtml}

<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
<button class="btn-action-primary" onclick="viewCompletedWorkoutBreakdown()" style="flex:1; min-width:160px; height:42px; font-size:12px; font-weight:700; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; display:inline-flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                View Logged Sessions (${sessCount}) ➔
</button>
<button class="btn-action-primary" onclick="document.getElementById('tomorrowForecastCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });" style="flex:1; min-width:180px; height:42px; font-size:12px; font-weight:700; background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.3); color:var(--primary); display:inline-flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                Open Tomorrow's Focus ➔
</button>
</div>

<div style="text-align:center; margin-top:10px;">
<span style="font-size:10.5px; color:var(--text-muted); text-decoration:underline; cursor:pointer;" onclick="toggleWorkoutCompleteManual(false)">
                ↺ Log Another Session
</span>
</div>
</div>

          ${typeof renderTomorrowPreviewCard === 'function' ? renderTomorrowPreviewCard(completed) : ''}
          ${elephantAccordionHtml}
          ${weeklyExecutiveBriefHtml}
        `;
      } else {
        // NOT completed
        const ctaButtonsHtml = verdict.isRest
          ? `
<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
<button class="btn-action-primary" onclick="toggleWorkoutCompleteManual(true)" style="flex:1; min-width:160px; height:42px; font-size:12px; font-weight:800; background:var(--primary); color:#000; cursor:pointer;">
                ✓ Log Rest Day
</button>
<button class="btn-action-primary" onclick="openWorkoutTabFromVerdict()" style="flex:1; min-width:160px; font-size:12px; font-weight:700; background:rgba(255,255,255,0.08); color:#fff; border:1px solid rgba(255,255,255,0.12); cursor:pointer;">
                Open Recovery Options →
</button>
</div>
          `
          : `
<button class="btn-action-primary" onclick="openWorkoutTabFromVerdict()" style="height:44px; font-size:13px; font-weight:800; width:100%; margin-top:12px; background:var(--primary); color:#000; box-shadow:0 0 15px rgba(0,229,255,0.25); cursor:pointer;">
<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Open Recommended Workouts →
</button>
          `;

        slot.innerHTML = `
          ${contextPillsHtml}

          
<div class="card" style="padding:15px; margin-bottom:12px; background:var(--surface-card, #14161e); border:1px solid rgba(0,229,255,0.3); border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.35);">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10px; font-weight:800; color:var(--primary); background:var(--primary-dim); padding:3px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.04em;">
                ${verdict.badge}
</span>
<span style="font-size:10.5px; color:var(--text-muted);">
<span onclick="openSleepOverridePrompt()" style="cursor:pointer; text-decoration:underline dotted; color:var(--text-secondary);" title="Tap to override Sleep Score">Sleep ${verdict.sleepScore} ✎</span> • <span onclick="openBodyBatteryOverridePrompt()" style="cursor:pointer; text-decoration:underline dotted; color:var(--text-secondary);" title="Tap to override Body Battery">Battery ${verdict.bodyBattery}% ✎</span> • <span onclick="openReadinessOverridePrompt()" style="cursor:pointer; text-decoration:underline dotted; color:var(--text-secondary);" title="Tap to override Training Readiness">Readiness ${verdict.readiness} ✎</span>
</span>
</div>

<div style="font-size:16px; font-weight:800; color:#fff; margin-top:8px; font-family:var(--font-sans);">
              ${verdict.title}
</div>
            
<div style="font-size:12px; color:#d4d4d8; line-height:1.45; margin-top:5px;">
              ${verdict.goldfishReason}
</div>

            ${stepBarHtml}
            ${intradayEveningHtml}
            ${plateauDualHtml}
            ${ctaButtonsHtml}
</div>

          ${elephantAccordionHtml}
          ${weeklyExecutiveBriefHtml}
        `;
      }
    }

    function openWorkoutTabFromVerdict() {
      const verdict = computeTodayWorkoutVerdict();
      switchTab('train');
      switchTrainView('prescribed');
      loadDailyArchetype(verdict.archetypeKey);
      window._userManualArchetype = true;
      updateArchetypeStarBadge(verdict.archetypeKey, verdict.optionLabels);
      requestWakeLock();
      beep(750, 0.08);
      speak((verdict.title || "Workout") + " loaded. Let's work!");
    }

    function launchDynamicWorkout(optionId) {
      const opt = todayWorkoutOptions.find(o => o.id === optionId) || todayWorkoutOptions[0];
      if (!opt) return;
      const rotatedInfo = (typeof getRotatedExercisesForOption === 'function') ? getRotatedExercisesForOption(opt) : { exerciseIds: opt.exerciseIds, rotationNote: null };
      const rawExerciseIds = rotatedInfo.exerciseIds || opt.exerciseIds || [];
      const preferredIds = rawExerciseIds.map((origExId, idx) => resolvePreferredExerciseId(origExId, null, `${opt.id}_${idx}`));
      const activeExerciseIds = (typeof applyJointSafeSwaps === 'function')
        ? applyJointSafeSwaps(preferredIds, preferredIds.length, typeof athleteInjuries !== 'undefined' ? athleteInjuries : {}, typeof gearConfig !== 'undefined' ? gearConfig : null)
        : preferredIds;

      activeWorkoutPlan = activeExerciseIds.map((exId) => {
        const ex = getAllExercises().find(e => e.id === exId) || { id: exId, name: exId, family: "functional", setsCount: 3, rest: "60s" };
        const rx = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad(exId, ex) : { weight: (typeof ex.getBaseWeight === 'function' ? ex.getBaseWeight() : 'Body'), reps: (typeof ex.getBaseReps === 'function' ? ex.getBaseReps() : 8) };
        const targetW = rx.weight;
        const targetR = rx.reps;
        return {
          ...ex,
          id: ex.id,
          name: ex.name,
          family: ex.family,
          targetWeight: targetW,
          targetReps: targetR,
          setsCount: ex.setsCount || 3,
          rest: ex.rest || "75s",
          cue: ex.cue || "",
          rationale: ex.rationale || ""
        };
      });
      window.activeSessionMeta = {
        id: opt.id,
        title: opt.title,
        preset: opt.preset || currentPreset,
        goal: opt.goal || (typeof currentGoalKey !== 'undefined' ? currentGoalKey : 'recomp')
      };
      currentExIdx = 0;
      const badgeEl = document.getElementById('wPlanBadge');
      if (badgeEl) badgeEl.innerText = opt.title.toUpperCase();
      switchTab('train');
      switchTrainView('prescribed');
      requestWakeLock();
      beep(750, 0.08);
      speak(opt.title + " loaded. Let's work!");
      renderCurrentExercise();
      saveActiveSessionToLocalStorage();
    }

    function startTodayOption(optId) {
      launchDynamicWorkout(optId);
    }

    function toggleWorkoutCompleteManual(isComplete) {
      const todayIsoDate = typeof getLocalDateStr === 'function' ? getLocalDateStr() : new Date().toISOString().split('T')[0];
      try {
        if (isComplete) {
          localStorage.setItem('pulse_strength_done_today', 'true');
          localStorage.setItem('pulse_workout_completed_date', todayIsoDate);
        } else {
          localStorage.setItem('pulse_strength_done_today', 'false');
          localStorage.removeItem('pulse_workout_completed_date');
        }
      } catch(e) {}
      beep(isComplete ? 880 : 600, 0.1);
      showToast(isComplete ? "Today's session marked complete. Next-day recommendation generated." : 'Reopened pre-workout prescription mode.');
      renderTodayTrainingRecommendations();
    }
function viewCompletedWorkoutBreakdown() {
      switchTab('train');
      switchTrainView('history');
      setTimeout(() => {
        const firstAct = recentActivitiesData[0];
        if (firstAct) {
          const body = document.getElementById('benefit_body_' + firstAct.id);
          const arrow = document.getElementById('arrow_' + firstAct.id);
          if (body) {
            body.style.display = 'flex';
            if (arrow) arrow.classList.add('open');
            body.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }, 120);
    }

