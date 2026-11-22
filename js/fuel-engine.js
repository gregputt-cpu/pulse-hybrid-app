    // ==================== ELEPHANT-GOLDFISH ADAPTIVE FUEL & RUNWAY ENGINE ====================
    let athleteDailyBudget = 2741;
    let athleteProteinAnchor = 200;
    let dailyLoggedCalories = 0;
    let dailyLoggedProtein = 0;
    let dailyLoggedMealsList = [];
    let activeDietStrategy = 'balanced';
    let currentCarbCycleLevel = 'high';
    const PULSE_FASTING_STORAGE_KEY = 'pulse_fasting_timer_state';
    let currentFastingProtocol = '16_8';
    let fastingTimerState = { running: false, startedAtMs: null, accumulatedSec: 0 };
    let fastingTimerInterval = null;
    let solverProteinTarget = 45;
    let activeRetailStore = 'tesco';
    let activeFuelView = 'today';
    let fuelMacroDisplayMode = 'remaining';
    try {
      const savedMacroMode = localStorage.getItem('pulse_fuel_macro_mode');
      if (savedMacroMode === 'consumed' || savedMacroMode === 'remaining') {
        fuelMacroDisplayMode = savedMacroMode;
      }
    } catch (e) {}
    const _openMealSlots = new Set();

    function switchFuelView(viewKey) {
      const resolved = (viewKey === 'trends' || viewKey === 'plan') ? viewKey : 'today';
      activeFuelView = resolved;
      if (typeof window !== 'undefined') window.activeFuelView = resolved;
      const viewMap = {
        today: ['btnFuelToday', 'fuelViewToday'],
        trends: ['btnFuelTrends', 'fuelViewTrends'],
        plan: ['btnFuelPlan', 'fuelViewPlan']
      };
      Object.entries(viewMap).forEach(([k, [btnId, panelId]]) => {
        const isActive = k === resolved;
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        if (btn) btn.classList.toggle('active', isActive);
        if (panel) panel.classList.toggle('active', isActive);
      });
      if (typeof beep === 'function') beep(520, 0.03);
    }

    function toggleFuelMacroDisplayMode() {
      fuelMacroDisplayMode = fuelMacroDisplayMode === 'remaining' ? 'consumed' : 'remaining';
      try {
        localStorage.setItem('pulse_fuel_macro_mode', fuelMacroDisplayMode);
      } catch (e) {}
      updateRunwayUI();
      if (typeof beep === 'function') beep(560, 0.03);
    }

    function updateDietStrategyCopy() {
      let strat = 'balanced';
      try {
        strat = activeDietStrategy || localStorage.getItem('pulse_diet_strategy') || 'balanced';
      } catch (e) {
        strat = activeDietStrategy || 'balanced';
      }
      const badgeLabels = {
        balanced: 'BALANCED HYBRID',
        lowcarb: 'LOW CARB',
        carbcycle: 'CARB CYCLING',
        fasting: 'FASTING HUB',
        custom: 'PRO-DIAL CUSTOM'
      };
      const badgeEl = document.getElementById('dietStrategyBadge');
      if (badgeEl) badgeEl.innerText = badgeLabels[strat] || 'BALANCED HYBRID';

      const balTargets = _resolveComputedFuelTargets({ dietStrategy: 'balanced' });
      const lcTargets = _resolveComputedFuelTargets({ dietStrategy: 'lowcarb' });
      const elBalProt = document.getElementById('dietBalancedProt');
      if (elBalProt) elBalProt.innerText = `${balTargets.protein_target_g}g`;
      const elBalCarbs = document.getElementById('dietBalancedCarbs');
      if (elBalCarbs) elBalCarbs.innerText = `${balTargets.carbs_target_g}g`;
      const elLcCarbs = document.getElementById('dietLowCarbCarbs');
      if (elLcCarbs) elLcCarbs.innerText = `${lcTargets.carbs_target_g}g`;
      const elLcProt = document.getElementById('dietLowCarbProt');
      if (elLcProt) elLcProt.innerText = `${lcTargets.protein_target_g}g`;
    }

    if (typeof window !== 'undefined') {
      window.activeFuelView = activeFuelView;
      window.switchFuelView = switchFuelView;
      window.toggleFuelMacroDisplayMode = toggleFuelMacroDisplayMode;
      window.updateDietStrategyCopy = updateDietStrategyCopy;
    }

    const DEFAULT_MND_10D_HISTORY = {
      "window_days": 0,
      "start_date": null,
      "end_date": null,
      "averages_10d": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0.0, "fiber": 0.0, "sodium": 0, "sugar_g": 0.0, "sat_fat_g": 0.0 },
      "averages_7d": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0.0, "fiber": 0.0, "sodium": 0, "sugar_g": 0.0, "sat_fat_g": 0.0 },
      "days": []
    };

    function _createEmptyMndMeals() {
      return {
        "breakfast": { "name": "Breakfast", "time": "Pending", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "items": [] },
        "lunch": { "name": "Lunch", "time": "Pending", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "items": [] },
        "dinner": { "name": "Dinner", "time": "Pending", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "items": [] },
        "snacks": { "name": "Snacks & Hydration", "time": "Pending", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "items": [] }
      };
    }

    function _createEmptyMndTotals() {
      return {
        "calories": 0,
        "protein": 0,
        "carbs": 0,
        "fat": 0,
        "fiber": 0,
        "sodium": 0,
        "water": 0.0,
        "sugar_g": 0.0,
        "sat_fat_g": 0.0
      };
    }

    // ==================== MYNETDIARY ENGINE STATE & DATA STORE ====================
    let myNetDiaryData = {
      "date": (typeof getLocalDateStr === 'function' ? getLocalDateStr() : null),
      "totals": _createEmptyMndTotals(),
      "history": DEFAULT_MND_10D_HISTORY,
      "meals": _createEmptyMndMeals()
    };

    function _readFuelJsonPref(lsKey) {
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (e) {}
      return null;
    }

    function computeMacroTargets({
      baseCalories = 2092,
      activeCalories = 0,
      baseProtein = 200,
      dietStrategy = 'balanced',
      carbCycleLevel = 'mod',
      customGoalMacros = null,
      proDialMacros = null,
      goalKey = null
    } = {}) {
      const nBaseCals = Number(baseCalories);
      const bCals = (baseCalories !== null && baseCalories !== undefined && Number.isFinite(nBaseCals) && nBaseCals > 0) ? nBaseCals : 2092;
      const nActCals = Number(activeCalories);
      const aCals = (activeCalories !== null && activeCalories !== undefined && Number.isFinite(nActCals)) ? Math.max(0, nActCals) : 0;
      const nBaseProt = Number(baseProtein);
      const bProt = (baseProtein !== null && baseProtein !== undefined && Number.isFinite(nBaseProt) && nBaseProt > 0) ? nBaseProt : 200;

      const calorieTarget = Math.round(bCals + aCals);

      let proteinTarget = null;
      if (dietStrategy === 'custom' && proDialMacros && typeof proDialMacros === 'object') {
        const pdP = Number(proDialMacros.protein);
        if (Number.isFinite(pdP) && pdP > 0) proteinTarget = Math.round(pdP);
      }
      if (proteinTarget === null && goalKey === 'custom' && customGoalMacros && typeof customGoalMacros === 'object') {
        const cgP = Number(customGoalMacros.protein);
        if (Number.isFinite(cgP) && cgP > 0) proteinTarget = Math.round(cgP);
      }
      if (proteinTarget === null) proteinTarget = Math.round(bProt);

      const remCals = Math.max(0, calorieTarget - proteinTarget * 4);
      const strategy = String(dietStrategy || 'balanced').trim().toLowerCase();

      let carbsG;
      let fatG;
      if (strategy === 'lowcarb') {
        carbsG = 75;
        fatG = Math.max(40, Math.round(Math.max(0, remCals - 75 * 4) / 9));
      } else if (strategy === 'carbcycle') {
        const carbMap = { high: 300, mod: 200, low: 80 };
        const lvl = String(carbCycleLevel || 'mod').trim().toLowerCase();
        carbsG = carbMap[lvl] !== undefined ? carbMap[lvl] : 200;
        fatG = Math.max(30, Math.round(Math.max(0, remCals - carbsG * 4) / 9));
      } else if (strategy === 'fasting') {
        carbsG = Math.max(50, Math.round((remCals * 0.55) / 4));
        fatG = Math.max(35, Math.round((remCals * 0.45) / 9));
      } else if (strategy === 'custom') {
        const rawFp = (proDialMacros && typeof proDialMacros === 'object' && proDialMacros.fat_pct !== undefined && proDialMacros.fat_pct !== null)
          ? Number(proDialMacros.fat_pct)
          : NaN;
        const fatPct = Number.isFinite(rawFp) ? Math.max(15, Math.min(65, rawFp)) : 30;
        fatG = Math.max(20, Math.round((calorieTarget * (fatPct / 100)) / 9));
        carbsG = Math.max(20, Math.round((calorieTarget - proteinTarget * 4 - calorieTarget * (fatPct / 100)) / 4));
      } else {
        carbsG = Math.max(50, Math.round((remCals * 0.62) / 4));
        fatG = Math.max(30, Math.round((remCals * 0.38) / 9));
      }

      return {
        calorie_target: calorieTarget,
        protein_target_g: proteinTarget,
        carbs_target_g: carbsG,
        fat_target_g: fatG
      };
    }
    if (typeof window !== 'undefined') window.computeMacroTargets = computeMacroTargets;

    function _getActiveTodayFlex() {
      const state = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const fa = (state && state.nutrition && state.nutrition.flex_active && typeof state.nutrition.flex_active === 'object')
        ? state.nutrition.flex_active
        : null;
      if (!fa) return null;
      const todayIso = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
      if (fa.date && todayIso && String(fa.date).slice(0, 10) !== todayIso) return null;
      const adj = Number(fa.adjustment_kcal);
      if (!Number.isFinite(adj) || adj === 0) return null;
      return {
        ...fa,
        adjustment_kcal: Math.round(adj),
        carb_delta_g: Math.round(Number(fa.carb_delta_g) || 0),
        fat_delta_g: Math.round(Number(fa.fat_delta_g) || 0)
      };
    }

    function _resolveComputedFuelTargets(overrides = {}) {
      const gKey = overrides.goalKey || ((typeof currentGoalKey !== 'undefined' && currentGoalKey) ? currentGoalKey : 'recomp');
      const goalObj = (typeof athleteGoals !== 'undefined' && athleteGoals && athleteGoals[gKey]) ? athleteGoals[gKey] : null;
      const state = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const n = state.nutrition || {};
      const activeBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn(state) : 0;
      const customGoal = overrides.customGoalMacros !== undefined ? overrides.customGoalMacros : _readFuelJsonPref('pulse_custom_goal_macros');
      const proDial = overrides.proDialMacros !== undefined ? overrides.proDialMacros : _readFuelJsonPref('pulse_pro_dial_macros');
      const baseCals = (overrides.baseCalories !== undefined)
        ? overrides.baseCalories
        : ((Number(n.base_calorie_target) > 0) ? Number(n.base_calorie_target) : ((goalObj && Number(goalObj.calories)) || 2092));
      const baseProt = (overrides.baseProtein !== undefined)
        ? overrides.baseProtein
        : ((Number(n.base_protein_target_g) > 0) ? Number(n.base_protein_target_g) : ((goalObj && Number(goalObj.protein)) || athleteProteinAnchor || 200));
      let strat = overrides.dietStrategy;
      if (!strat) {
        try { strat = activeDietStrategy || localStorage.getItem('pulse_diet_strategy') || 'balanced'; } catch (e) { strat = activeDietStrategy || 'balanced'; }
      }
      let ccLvl = overrides.carbCycleLevel;
      if (!ccLvl) {
        try { ccLvl = currentCarbCycleLevel || localStorage.getItem('pulse_carb_cycle_level') || 'mod'; } catch (e) { ccLvl = currentCarbCycleLevel || 'mod'; }
      }
      const baseRes = computeMacroTargets({
        baseCalories: baseCals,
        activeCalories: activeBurn,
        baseProtein: baseProt,
        dietStrategy: strat,
        carbCycleLevel: ccLvl,
        customGoalMacros: customGoal,
        proDialMacros: proDial,
        goalKey: gKey
      });
      const activeFlex = _getActiveTodayFlex();
      if (activeFlex) {
        return {
          calorie_target: Math.max(1200, baseRes.calorie_target + activeFlex.adjustment_kcal),
          protein_target_g: baseRes.protein_target_g,
          carbs_target_g: Math.max(20, baseRes.carbs_target_g + activeFlex.carb_delta_g),
          fat_target_g: Math.max(20, baseRes.fat_target_g + activeFlex.fat_delta_g)
        };
      }
      return baseRes;
    }

    function getCanonicalDailyCalorieTarget() {
      const state = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const todayIso = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
      const n = state.nutrition || null;
      const inAppBurn = (typeof getTodayInAppBurn === 'function') ? getTodayInAppBurn(state.garmin) : 0;
      if (n && Number(n.calorie_target) > 0 && state.date === todayIso) {
        return Math.max(1200, Math.round(Number(n.calorie_target) + inAppBurn));
      }
      const gKey = (typeof currentGoalKey !== 'undefined' && currentGoalKey) ? currentGoalKey : 'recomp';
      const goalBase = (n && Number(n.base_calorie_target) > 0) ? Number(n.base_calorie_target) : ((typeof athleteGoals !== 'undefined' && athleteGoals && athleteGoals[gKey] && Number(athleteGoals[gKey].calories)) || 2092);
      const activeBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn(state) : inAppBurn;
      const activeFlex = _getActiveTodayFlex();
      const flexAdj = activeFlex ? activeFlex.adjustment_kcal : 0;
      return Math.max(1200, Math.round(goalBase + activeBurn + flexAdj));
    }
    if (typeof window !== 'undefined') {
      window.getCanonicalDailyCalorieTarget = getCanonicalDailyCalorieTarget;
    }

    // ==================== MYNETDIARY ENGINE & MACRO BREAKDOWN ====================
    function initMyNetDiaryEngine() {
      restoreMndFromLocalStorage();
      initFastingTimer();
      renderMyNetDiaryEngine();
    }

    function renderMyNetDiaryEngine() {
      const activeBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn() : 0;
      const computed = _resolveComputedFuelTargets();
      const totalBudget = getCanonicalDailyCalorieTarget();
      athleteDailyBudget = totalBudget;
      athleteProteinAnchor = computed.protein_target_g;
      if (!myNetDiaryData.targets) myNetDiaryData.targets = {};
      myNetDiaryData.targets.calories = totalBudget;
      myNetDiaryData.targets.protein = computed.protein_target_g;
      myNetDiaryData.targets.carbs = computed.carbs_target_g;
      myNetDiaryData.targets.fat = computed.fat_target_g;

      const fbEl = document.getElementById('fuelBudgetNum');
      if (fbEl) fbEl.innerText = totalBudget;

      // 2. Macro Targets
      const pTarget = myNetDiaryData.targets.protein || 200;
      const cTarget = myNetDiaryData.targets.carbs || 200;
      const fTarget = myNetDiaryData.targets.fat || 55;

      // Current Consumed Totals
      if (!myNetDiaryData.totals) {
        myNetDiaryData.totals = _createEmptyMndTotals();
      }
      const cals = myNetDiaryData.totals.calories || 0;
      const prot = myNetDiaryData.totals.protein || 0;
      const carbs = myNetDiaryData.totals.carbs || 0;
      const fats = myNetDiaryData.totals.fat || 0;

      // 3. Update 4 Macro Gauges
      const calsLeft = Math.max(0, totalBudget - cals);
      const protLeft = Math.max(0, pTarget - prot);
      const carbsLeft = Math.max(0, cTarget - carbs);
      const fatsLeft = Math.max(0, fTarget - fats);

      const elCalsVal = document.getElementById('mndCalsVal');
      if (elCalsVal) elCalsVal.innerText = cals.toLocaleString();

      const elCalsTarget = document.getElementById('mndCalsTarget');
      if (elCalsTarget) elCalsTarget.innerText = totalBudget.toLocaleString();

      const elCalsRem = document.getElementById('mndCalsRemainingBadge');
      if (elCalsRem) elCalsRem.innerText = `${calsLeft.toLocaleString()} left`;

      const elBarCals = document.getElementById('mndBarCals');
      if (elBarCals) elBarCals.style.width = `${Math.min(100, Math.round((cals / totalBudget) * 100))}%`;

      const elProtVal = document.getElementById('mndProteinVal');
      if (elProtVal) elProtVal.innerText = prot;

      const elProtRem = document.getElementById('mndProteinRemainingBadge');
      if (elProtRem) {
        if (prot >= pTarget) {
          const surplus = prot - pTarget;
          elProtRem.innerText = surplus > 0 ? `Target Met (+${surplus}g)` : 'Target Met';
        } else {
          elProtRem.innerText = `${protLeft}g left`;
        }
      }

      const elBarProt = document.getElementById('mndBarProtein');
      if (elBarProt) elBarProt.style.width = `${Math.min(100, Math.round((prot / pTarget) * 100))}%`;

      const elCarbsVal = document.getElementById('mndCarbsVal');
      if (elCarbsVal) elCarbsVal.innerText = carbs;

      const elCarbsRem = document.getElementById('mndCarbsRemainingBadge');
      if (elCarbsRem) elCarbsRem.innerText = `${carbsLeft}g left`;

      const elBarCarbs = document.getElementById('mndBarCarbs');
      if (elBarCarbs) elBarCarbs.style.width = `${Math.min(100, Math.round((carbs / cTarget) * 100))}%`;

      const elFatVal = document.getElementById('mndFatVal');
      if (elFatVal) elFatVal.innerText = fats;

      const elFatRem = document.getElementById('mndFatRemainingBadge');
      if (elFatRem) elFatRem.innerText = `${fatsLeft}g left`;

      const elBarFat = document.getElementById('mndBarFat');
      if (elBarFat) elBarFat.style.width = `${Math.min(100, Math.round((fats / fTarget) * 100))}%`;

      // 4. Macro Energy Distribution Split
      const pKcal = prot * 4;
      const cKcal = carbs * 4;
      const fKcal = fats * 9;
      const totalMacroKcal = Math.max(1, pKcal + cKcal + fKcal);

      const pPct = Math.round((pKcal / totalMacroKcal) * 100);
      const cPct = Math.round((cKcal / totalMacroKcal) * 100);
      const fPct = Math.max(0, 100 - pPct - cPct);

      const elMacroText = document.getElementById('mndMacroRatioText');
      if (elMacroText) elMacroText.innerText = `${pPct}% Protein • ${cPct}% Carbs • ${fPct}% Fat`;

      const elSplitP = document.getElementById('mndSplitP');
      if (elSplitP) elSplitP.style.width = `${pPct}%`;

      const elSplitC = document.getElementById('mndSplitC');
      if (elSplitC) elSplitC.style.width = `${cPct}%`;

      const elSplitF = document.getElementById('mndSplitF');
      if (elSplitF) elSplitF.style.width = `${fPct}%`;

      // 5. Micronutrients Strip & Today Inline Micro Strip
      const fiberVal = Math.round(Number(myNetDiaryData.totals.fiber) || 0);
      const sodiumVal = Math.round(Number(myNetDiaryData.totals.sodium) || 0);
      const waterVal = Number(myNetDiaryData.totals.water || 0);
      const waterStr = `${waterVal.toFixed(1)}L`;

      const elFiber = document.getElementById('mndFiberVal');
      if (elFiber) elFiber.innerText = `${fiberVal}g`;

      const elSodium = document.getElementById('mndSodiumVal');
      if (elSodium) elSodium.innerText = `${sodiumVal.toLocaleString()}mg`;

      const elWater = document.getElementById('mndWaterVal');
      if (elWater) elWater.innerText = `${waterVal}L`;

      const elMicroWater = document.getElementById('fuelMicroWaterVal');
      if (elMicroWater) elMicroWater.innerText = waterStr;

      const elMicroFiber = document.getElementById('fuelMicroFiberVal');
      if (elMicroFiber) elMicroFiber.innerText = `${fiberVal}g`;

      const elMicroSodium = document.getElementById('fuelMicroSodiumVal');
      if (elMicroSodium) elMicroSodium.innerText = `${sodiumVal.toLocaleString()}mg`;

      const elHydSum = document.getElementById('fuelHydrationSummary');
      if (elHydSum) elHydSum.innerText = `${waterStr} Water • ${fiberVal}g Fiber`;

      // Update #todayMacroRemainingPill element (Goldfish 3-second glance pill on Today tab)
      const macroPill = document.getElementById('todayMacroRemainingPill');
      if (macroPill) {
        if (prot >= pTarget) {
          macroPill.innerText = `${calsLeft.toLocaleString()} kcal • ✓ P Met • C: ${carbsLeft}g • F: ${fatsLeft}g`;
        } else {
          macroPill.innerText = `${calsLeft.toLocaleString()} kcal • P: ${protLeft}g • C: ${carbsLeft}g • F: ${fatsLeft}g left`;
        }
      }

      // 6. Chronological Meal Stream (Collapsed by default)
      renderMndMealStream();

      // 7. Concise 1-line Coach Status
      updateMndCoachAdvice(calsLeft, protLeft, carbsLeft, fatsLeft, totalBudget);

      // 7.1. Dynamic Strategy Copy
      updateDietStrategyCopy();

      // 7.5. Nutritional Quality, Micronutrient & Food Gap Audit
      renderNutritionQualityAudit(
        myNetDiaryData.totals,
        myNetDiaryData.meals || {},
        cals,
        prot,
        carbs,
        fats,
        myNetDiaryData.totals.fiber || 0,
        myNetDiaryData.totals.sodium || 0,
        myNetDiaryData.totals.water || 0,
        totalBudget,
        pTarget,
        cTarget,
        fTarget
      );

      // 7.6. Evening Macro & Protein Gap Closer
      renderMacroGapCloser(totalBudget, cals, pTarget, prot);

      // 8. Synchronize Runway UI
      dailyLoggedCalories = cals;
      dailyLoggedProtein = prot;
      updateRunwayUI();
    }

    function updateRunwayUI() {
      const activeBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn() : 0;
      const totalBudget = getCanonicalDailyCalorieTarget();
      athleteDailyBudget = totalBudget;
      const cals = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.calories) || 0;
      const prot = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.protein) || 0;
      const carbs = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.carbs) || 0;
      const fats = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.fat) || 0;
      const fiber = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.fiber) || 0;
      const pTarget = (myNetDiaryData.targets && myNetDiaryData.targets.protein) || athleteProteinAnchor || 200;
      const cTarget = (myNetDiaryData.targets && myNetDiaryData.targets.carbs) || 251;
      const fTarget = (myNetDiaryData.targets && myNetDiaryData.targets.fat) || 80;

      const diff = totalBudget - cals;
      const remainingCals = Math.max(0, diff);
      const pct = Math.min(100, Math.round((cals / Math.max(1, totalBudget)) * 100));

      const ftEl = document.getElementById('fuelTargetNum');
      if (ftEl) ftEl.innerHTML = `${totalBudget.toLocaleString()} <span style="font-size:12px; color:var(--text-muted); font-weight:500;">+${activeBurn} active</span>`;
      const liveSt = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const activeFlex = _getActiveTodayFlex();
      const flexAdj = activeFlex ? activeFlex.adjustment_kcal : 0;
      const baseCalsVal = Math.max(0, Math.round(totalBudget - activeBurn - flexAdj));
      const baseActiveSubEl = document.getElementById('fuelBaseActiveSub');
      if (baseActiveSubEl) {
        if (flexAdj > 0) {
          baseActiveSubEl.innerText = `Base ${baseCalsVal.toLocaleString()} + ${activeBurn.toLocaleString()} Active + ${flexAdj.toLocaleString()} Flex`;
        } else if (flexAdj < 0) {
          baseActiveSubEl.innerText = `Base ${baseCalsVal.toLocaleString()} + ${activeBurn.toLocaleString()} Active - ${Math.abs(flexAdj).toLocaleString()} Bank`;
        } else {
          baseActiveSubEl.innerText = `Base ${baseCalsVal.toLocaleString()} + ${activeBurn.toLocaleString()} Active`;
        }
      }

      const frEl = document.getElementById('fuelRemainingNum');
      if (frEl) {
        if (diff <= 0) {
          frEl.innerHTML = `0 <span style="font-size:13px; font-weight:600; color:var(--amber);">kcal</span>`;
        } else {
          frEl.innerHTML = `${remainingCals.toLocaleString()} <span style="font-size:13px; font-weight:600; color:var(--primary);">kcal</span>`;
        }
      }

      const fcText = document.getElementById('fuelConsumedText');
      if (fcText) fcText.innerText = `${cals.toLocaleString()} kcal`;

      const ipPct = document.getElementById('intakeProgressPercent');
      if (ipPct) {
        if (diff <= 0) {
          ipPct.innerHTML = `<span style="color:var(--amber); font-weight:700;">100% (Target Reached • At Maintenance)</span>`;
        } else {
          ipPct.innerText = `${pct}% (${remainingCals.toLocaleString()} kcal Runway)`;
        }
      }

      const barIntake = document.getElementById('barIntakeConsumed');
      if (barIntake) {
        barIntake.style.width = `${pct}%`;
        barIntake.style.background = diff <= 0 ? 'linear-gradient(90deg, var(--amber), var(--crimson-text))' : 'linear-gradient(90deg, var(--primary) 0%, var(--cyan) 60%, var(--violet-text) 100%)';
        barIntake.style.boxShadow = diff <= 0 ? '0 0 12px var(--amber-glow)' : '0 0 12px var(--primary-dim)';
      }

      const pBadge = document.getElementById('proteinRemainingBadge');
      if (pBadge) {
        if (prot >= pTarget) {
          pBadge.innerText = `✓ Protein Anchor Met (${prot}g • +${prot - pTarget}g)`;
          pBadge.style.color = 'var(--primary)';
        } else {
          pBadge.innerText = `${prot}g Consumed • ${pTarget - prot}g Left`;
          pBadge.style.color = '#fff';
        }
      }

      const protLeft = Math.max(0, pTarget - prot);
      const carbsLeft = Math.max(0, cTarget - carbs);
      const fatsLeft = Math.max(0, fTarget - fats);
      const pPct = pTarget > 0 ? Math.round((prot / pTarget) * 100) : 0;
      const netCarbs = fiber > 0 ? Math.max(0, carbs - fiber) : carbs;
      const isRemainingMode = fuelMacroDisplayMode !== 'consumed';

      const hintEl = document.getElementById('fuelMacroModeHint');
      if (hintEl) {
        hintEl.innerText = isRemainingMode ? 'Showing Left • Tap to flip' : 'Showing Eaten • Tap to flip';
      }

      const mp = document.getElementById('macroProtein');
      const mpSub = document.getElementById('macroProteinSub');
      if (mp) {
        if (mp.classList) {
          mp.classList.toggle('is-met', isRemainingMode && prot >= pTarget);
          mp.classList.remove('is-over');
        }
        mp.innerText = isRemainingMode ? (prot >= pTarget ? '✓ Met' : `${protLeft}g left`) : `${prot}g`;
      }
      if (mpSub) {
        mpSub.innerText = isRemainingMode
          ? (prot >= pTarget ? `${prot} / ${pTarget}g (+${prot - pTarget}g)` : `${prot} / ${pTarget}g (${pPct}%)`)
          : (prot >= pTarget ? `✓ Met (/${pTarget}g)` : `${protLeft}g left • /${pTarget}g`);
      }

      const mc = document.getElementById('macroCarbs');
      const mcSub = document.getElementById('macroCarbsSub');
      if (mc) {
        const carbsOver = carbs > cTarget;
        if (mc.classList) {
          mc.classList.remove('is-met');
          mc.classList.toggle('is-over', isRemainingMode && carbsOver);
        }
        mc.innerText = isRemainingMode
          ? (carbsOver ? `+${carbs - cTarget}g over` : `${carbsLeft}g left`)
          : `${carbs}g`;
      }
      if (mcSub) {
        if (isRemainingMode) {
          mcSub.innerText = fiber > 0 ? `${netCarbs}g net • ${carbs}/${cTarget}g` : `${carbs} / ${cTarget}g`;
        } else {
          mcSub.innerText = fiber > 0 ? `${netCarbs}g net • ${carbsLeft}g left` : `${carbsLeft}g left • /${cTarget}g`;
        }
      }

      const mf = document.getElementById('macroFat');
      const mfSub = document.getElementById('macroFatSub');
      if (mf) {
        const fatOver = fats > fTarget;
        if (mf.classList) {
          mf.classList.remove('is-met');
          mf.classList.toggle('is-over', isRemainingMode && fatOver);
        }
        mf.innerText = isRemainingMode
          ? (fatOver ? `+${fats - fTarget}g over` : `${fatsLeft}g left`)
          : `${fats}g`;
      }
      if (mfSub) {
        mfSub.innerText = isRemainingMode ? `${fats} / ${fTarget}g` : `${fatsLeft}g left • /${fTarget}g`;
      }

      const barP = document.getElementById('barProtein');
      if (barP) barP.style.width = `${Math.min(100, Math.round((prot / Math.max(1, pTarget)) * 100))}%`;
      const barC = document.getElementById('barCarbs');
      if (barC) barC.style.width = `${Math.min(100, Math.round((carbs / Math.max(1, cTarget)) * 100))}%`;
      const barF = document.getElementById('barFat');
      if (barF) barF.style.width = `${Math.min(100, Math.round((fats / Math.max(1, fTarget)) * 100))}%`;

      // Update Progressive Disclosure Math Drawer
      const defRaw = (liveSt && liveSt.nutrition && liveSt.nutrition.deficit !== undefined && liveSt.nutrition.deficit !== null)
        ? Number(liveSt.nutrition.deficit) : 350;
      const defNum = Number.isFinite(defRaw) ? Math.round(defRaw) : 350;
      const elBmr = document.getElementById('fuelCalcBmr');
      if (elBmr) elBmr.innerText = `${(baseCalsVal + defNum).toLocaleString()} kcal`;
      const elDeficit = document.getElementById('fuelCalcDeficit');
      if (elDeficit) elDeficit.innerText = defNum >= 0 ? `-${defNum.toLocaleString()} kcal` : `+${Math.abs(defNum).toLocaleString()} kcal`;
      const flexRowEl = document.getElementById('fuelCalcFlexRow');
      const flexLabelEl = document.getElementById('fuelCalcFlexLabel');
      const flexValEl = document.getElementById('fuelCalcFlexVal');
      if (flexRowEl) {
        if (flexAdj !== 0) {
          flexRowEl.style.display = 'flex';
          if (flexLabelEl) flexLabelEl.innerText = (activeFlex && activeFlex.label) || (flexAdj > 0 ? 'Flex Boost' : 'Planned Bank Trim');
          if (flexValEl) {
            flexValEl.innerText = flexAdj > 0 ? `+${flexAdj.toLocaleString()} kcal` : `${flexAdj.toLocaleString()} kcal`;
            flexValEl.style.color = flexAdj > 0 ? 'var(--emerald)' : 'var(--primary-bright)';
          }
        } else {
          flexRowEl.style.display = 'none';
        }
      }
      const elBurn = document.getElementById('fuelCalcBurn');
      if (elBurn) elBurn.innerText = `+${activeBurn} kcal`;
      const elTarget = document.getElementById('fuelCalcTarget');
      if (elTarget) elTarget.innerText = `= ${totalBudget.toLocaleString()} kcal`;
      const elConsumed = document.getElementById('fuelCalcConsumed');
      if (elConsumed) elConsumed.innerText = `-${cals.toLocaleString()} kcal`;
      const elRem = document.getElementById('fuelCalcRemaining');
      if (elRem) {
        if (diff <= 0) {
          elRem.innerHTML = `<span style="color:var(--amber);">= 0 kcal (At Maintenance)</span>`;
        } else {
          elRem.innerHTML = `= ${remainingCals.toLocaleString()} kcal`;
        }
      }
    }

    function _syncToggleAllMealsBtn() {
      const btn = document.getElementById('btnToggleAllMeals');
      if (!btn) return;
      const loggedKeys = ['breakfast', 'lunch', 'snacks', 'dinner'].filter((k) => {
        const m = myNetDiaryData && myNetDiaryData.meals && myNetDiaryData.meals[k];
        return Boolean(m && Array.isArray(m.items) && m.items.length > 0);
      });
      if (loggedKeys.length === 0) {
        btn.innerText = 'Expand All';
        btn.disabled = true;
        return;
      }
      btn.disabled = false;
      const allOpen = loggedKeys.every((k) => _openMealSlots.has(k));
      btn.innerText = allOpen ? 'Collapse All' : 'Expand All';
    }

    function renderMndMealStream() {
      const container = document.getElementById('mndMealsStreamContainer');
      if (!container) return;
      container.innerHTML = '';

      if (!myNetDiaryData.meals) {
        myNetDiaryData.meals = {};
      }

      const mealKeys = ['breakfast', 'lunch', 'snacks', 'dinner'];
      let loggedCount = 0;

      mealKeys.forEach(mKey => {
        const meal = myNetDiaryData.meals[mKey];
        if (!meal) return;

        const hasItems = Boolean(meal.items && meal.items.length > 0);
        if (hasItems) loggedCount++;
        const itemCount = hasItems ? meal.items.length : 0;
        const isOpen = _openMealSlots.has(mKey);

        const mealCard = document.createElement('div');
        mealCard.className = isOpen ? 'meal-card-accordion is-open' : 'meal-card-accordion';
        mealCard.setAttribute('data-meal-key', mKey);
        if (mKey === 'dinner' && !hasItems) {
          mealCard.style.borderColor = 'rgba(139, 157, 181, 0.22)';
        }

        let itemsHtml = '';
        if (hasItems) {
          itemsHtml = meal.items.map((item, itemIdx) => `
<div class="mnd-item-row" style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04); font-size:12px;">
<span style="color:#FFFFFF; font-weight:500;">${escapeHtml(item.name)}</span>
<div style="display:flex; align-items:center; gap:8px;">
<span style="color:var(--text-muted); font-size:11px;">${Number(item.cals) || 0} kcal</span>
<span style="color:var(--primary); font-weight:700; font-size:11px;">${Number(item.p) || 0}g P</span>
<span style="color:var(--text-muted); cursor:pointer; font-size:11px; padding:2px 4px; border-radius:3px;" title="Remove food item" data-meal-key="${escapeHtml(mKey)}" data-item-idx="${itemIdx}" onclick="event.stopPropagation(); deleteMndMealItem(this.dataset.mealKey, Number(this.dataset.itemIdx))">✕</span>
</div>
</div>
          `).join('');
        } else {
          itemsHtml = `
<div style="font-size:11.5px; color:var(--text-muted); padding:6px 0; font-style:italic;">
              ${mKey === 'dinner' ? 'Dinner pending. Auto-syncs when logged in MyNetDiary.' : 'No foods logged for this slot.'}
</div>
          `;
        }

        const isInitiallyOpen = isOpen ? 'flex' : 'none';
        const chevronRot = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        const slotSummary = hasItems ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Pending';

        mealCard.innerHTML = `
<div class="meal-card-header" onclick="toggleMealAccordion(this)">
<div style="display:flex; align-items:center; gap:7px; min-width:0;">
<span class="accordion-chevron" style="transform:${chevronRot}; font-size:10px;">▼</span>
<strong style="color:#fff; font-size:12.5px; font-weight:700;">${escapeHtml(meal.name)}</strong>
<span class="fuel-meal-count-pill">${meal.time ? escapeHtml(meal.time) + ' • ' : ''}${slotSummary}</span>
</div>
<div style="display:flex; gap:5px; align-items:center; flex-shrink:0;">
<span class="macro-pill" style="color:var(--primary); font-weight:700; background:rgba(0,229,255,0.12); padding:2px 6px; border-radius:4px; font-size:11px;">${Number(meal.protein) || 0}g P</span>
<span class="macro-pill" style="color:#fff; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; font-size:11px;">${Number(meal.calories) || 0} kcal</span>
</div>
</div>
<div class="meal-card-body" style="display:${isInitiallyOpen};">
            ${itemsHtml}
</div>
        `;

        container.appendChild(mealCard);
      });

      const countBadge = document.getElementById('mndMealsCountBadge');
      if (countBadge) {
        const pendingCount = 4 - loggedCount;
        countBadge.innerText = `${loggedCount} Logged • ${pendingCount} Pending`;
      }
      _syncToggleAllMealsBtn();
    }

    function toggleMealAccordion(headerEl) {
      if (!headerEl) return;
      const card = headerEl.closest ? headerEl.closest('.meal-card-accordion') : headerEl.parentElement;
      const mKey = card && card.getAttribute ? card.getAttribute('data-meal-key') : null;
      const body = headerEl.nextElementSibling || (card && card.querySelector ? card.querySelector('.meal-card-body') : null);
      const chevron = headerEl.querySelector ? headerEl.querySelector('.accordion-chevron') : null;
      const currentlyOpen = mKey
        ? _openMealSlots.has(mKey)
        : Boolean(body && body.style && body.style.display !== 'none');
      const nextOpen = !currentlyOpen;
      if (mKey) {
        if (nextOpen) _openMealSlots.add(mKey);
        else _openMealSlots.delete(mKey);
      }
      if (card && card.classList) card.classList.toggle('is-open', nextOpen);
      if (body && body.style) body.style.display = nextOpen ? 'flex' : 'none';
      if (chevron && chevron.style) chevron.style.transform = nextOpen ? 'rotate(180deg)' : 'rotate(0deg)';
      _syncToggleAllMealsBtn();
    }

    function toggleAllMealAccordions() {
      const loggedKeys = ['breakfast', 'lunch', 'snacks', 'dinner'].filter((k) => {
        const m = myNetDiaryData && myNetDiaryData.meals && myNetDiaryData.meals[k];
        return Boolean(m && Array.isArray(m.items) && m.items.length > 0);
      });
      if (loggedKeys.length === 0) return;
      const allOpen = loggedKeys.every((k) => _openMealSlots.has(k));
      if (allOpen) {
        loggedKeys.forEach((k) => _openMealSlots.delete(k));
      } else {
        loggedKeys.forEach((k) => _openMealSlots.add(k));
      }
      renderMndMealStream();
    }
    if (typeof window !== 'undefined') {
      window.toggleMealAccordion = toggleMealAccordion;
      window.toggleAllMealAccordions = toggleAllMealAccordions;
    }

    function updateMndCoachAdvice(calsLeft, protLeft, carbsLeft, fatsLeft, totalBudget) {
      const el = document.getElementById('mndCoachAdvice');
      if (!el) return;

      const cals = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.calories) || 0;
      const prot = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.protein) || 0;
      const pTarget = (myNetDiaryData.targets && myNetDiaryData.targets.protein) || athleteProteinAnchor || 200;
      let advice = '';

      if (cals >= totalBudget && prot >= pTarget) {
        advice = `<strong>✓ Fuel banked &amp; ${pTarget}g protein met</strong> — focus on hydration tonight.`;
      } else if (protLeft > 0) {
        advice = `Prioritize lean protein (<strong>${protLeft}g left</strong>) within your <strong>${calsLeft.toLocaleString()} kcal</strong> runway.`;
      } else {
        advice = `<strong>✓ ${pTarget}g protein locked in</strong> — <strong>${calsLeft.toLocaleString()} kcal</strong> clean runway remaining.`;
      }

      el.innerHTML = advice;
    }

    window.nutritionAuditWindowMode = window.nutritionAuditWindowMode || '10d';
    window.nutritionChartMetric = window.nutritionChartMetric || 'calories';
    window.nutritionSelectedDayIso = window.nutritionSelectedDayIso || null;

    window.setNutritionAuditWindow = function(mode) {
      if (mode === '10d' || mode === '7d' || mode === '1d') {
        window.nutritionAuditWindowMode = mode;
        renderMyNetDiaryEngine();
      }
    };

    window.setNutritionChartMetric = function(metric) {
      if (metric === 'calories' || metric === 'protein' || metric === 'fat' || metric === 'fiber') {
        window.nutritionChartMetric = metric;
        renderMyNetDiaryEngine();
      }
    };

    window.selectNutritionChartDay = function(isoDate) {
      if (isoDate) {
        window.nutritionSelectedDayIso = String(isoDate).slice(0, 10);
        renderMyNetDiaryEngine();
      }
    };

    function formatShortAuditDate(isoDate) {
      if (!isoDate) return '';
      const parts = String(isoDate).split('-');
      if (parts.length !== 3) return isoDate;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mIdx = Math.max(0, Math.min(11, parseInt(parts[1], 10) - 1));
      return `${months[mIdx]} ${parseInt(parts[2], 10)}`;
    }

    function getResolvedMndHistory(todayTotals, todayItems) {
      const bakedHist = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.mnd_history)
        ? window.BAKED_LIVE_STATE.mnd_history
        : null;
      const sourceHist = (myNetDiaryData && myNetDiaryData.history && Array.isArray(myNetDiaryData.history.days) && myNetDiaryData.history.days.length > 0)
        ? myNetDiaryData.history
        : (bakedHist && Array.isArray(bakedHist.days) && bakedHist.days.length > 0 ? bakedHist : DEFAULT_MND_10D_HISTORY);

      const days = sourceHist.days.map(d => ({
        ...d,
        items: Array.isArray(d.items) ? d.items.slice() : []
      }));

      const fallbackDate = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
      const activeDate = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.date)
        ? window.BAKED_LIVE_STATE.date
        : (days.length > 0 ? days[days.length - 1].date : fallbackDate);

      if (todayTotals && todayTotals.calories > 0 && days.length > 0) {
        const idx = days.findIndex(d => d.date === activeDate);
        if (idx >= 0) {
          const prev = days[idx];
          days[idx] = {
            ...prev,
            calories: Number(todayTotals.calories) || prev.calories,
            protein: Number(todayTotals.protein) || prev.protein,
            carbs: Number(todayTotals.carbs) || prev.carbs,
            fat: Number(todayTotals.fat) || prev.fat,
            fiber: Number(todayTotals.fiber) || prev.fiber,
            sodium: Number(todayTotals.sodium) || prev.sodium,
            sugar_g: todayTotals.sugar_g !== undefined ? Number(todayTotals.sugar_g) : (prev.sugar_g || 0),
            sat_fat_g: todayTotals.sat_fat_g !== undefined ? Number(todayTotals.sat_fat_g) : (prev.sat_fat_g || 0),
            items: (Array.isArray(todayItems) && todayItems.length > 0) ? todayItems : prev.items
          };
        }
      }
      return days;
    }

    function renderNutritionQualityAudit(totals, meals, cals, p, c, f, fiber, sodium, water, calTarget, pTarget, cTarget, fTarget) {
      const auditEl = document.getElementById('nutritionQualityAuditCard');
      if (!auditEl) return;

      const allItems = [];
      ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(slot => {
        const slotMeals = meals && meals[slot];
        if (slotMeals && Array.isArray(slotMeals.items)) {
          slotMeals.items.forEach(it => {
            if (it && it.name) {
              allItems.push({
                name: String(it.name),
                cals: Number(it.cals) || 0,
                p: Number(it.p) || 0,
                c: Number(it.c) || 0,
                f: Number(it.f) || 0
              });
            }
          });
        }
      });

      const histDays = getResolvedMndHistory(totals, allItems);
      const mode = (window.nutritionAuditWindowMode === '7d' || window.nutritionAuditWindowMode === '1d')
        ? window.nutritionAuditWindowMode
        : '10d';

      const fallbackToday = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : '';
      const endDateStr = histDays.length > 0 ? histDays[histDays.length - 1].date : fallbackToday;
      const endLabel = formatShortAuditDate(endDateStr) || 'Today';
      const startLabel = histDays.length > 0 ? formatShortAuditDate(histDays[0].date) : '';
      const endDayNum = endLabel.split(' ')[1] || '';
      const rangeBadgeLabel = histDays.length > 0
        ? ((startLabel && startLabel.split(' ')[0] === endLabel.split(' ')[0] && endDayNum)
          ? `${startLabel}–${endDayNum}`
          : `${startLabel}–${endLabel}`)
        : 'No history yet';

      const switcherHtml = `
<div class="fuel-window-row">
  <button type="button" class="fuel-window-pill${mode === '10d' ? ' active' : ''}" onclick="setNutritionAuditWindow('10d')">${histDays.length > 0 ? `📊 ${histDays.length}D Baseline` : '📊 10D Baseline'}</button>
  <button type="button" class="fuel-window-pill${mode === '7d' ? ' active' : ''}" onclick="setNutritionAuditWindow('7d')">📅 7 Days</button>
  <button type="button" class="fuel-window-pill${mode === '1d' ? ' active' : ''}" onclick="setNutritionAuditWindow('1d')">📍 Today (${escapeHtml(endLabel)})</button>
</div>
      `;

      const safeFTarget = fTarget > 0 ? fTarget : 80;
      const safeCalTarget = calTarget > 0 ? calTarget : 2100;
      const safePTarget = pTarget > 0 ? pTarget : 200;
      const safeCTarget = cTarget > 0 ? cTarget : 220;

      // ==================== MULTI-DAY ROLLING ENGINE (10-DAY OR 7-DAY) ====================
      if (mode !== '1d' && histDays.length > 0) {
        const windowDays = mode === '7d' ? histDays.slice(-7) : histDays.slice(-10);
        const nDays = windowDays.length;
        const winStart = formatShortAuditDate(windowDays[0].date);
        const winEnd = formatShortAuditDate(windowDays[nDays - 1].date);

        const sumCals = windowDays.reduce((s, d) => s + (Number(d.calories) || 0), 0);
        const sumP = windowDays.reduce((s, d) => s + (Number(d.protein) || 0), 0);
        const sumC = windowDays.reduce((s, d) => s + (Number(d.carbs) || 0), 0);
        const sumF = windowDays.reduce((s, d) => s + (Number(d.fat) || 0), 0);
        const sumFib = windowDays.reduce((s, d) => s + (Number(d.fiber) || 0), 0);
        const sumSug = windowDays.reduce((s, d) => s + (Number(d.sugar_g) || 0), 0);
        const sumSatF = windowDays.reduce((s, d) => s + (Number(d.sat_fat_g) || 0), 0);

        const avgCals = Math.round(sumCals / nDays);
        const avgP = Math.round(sumP / nDays);
        const avgC = Math.round(sumC / nDays);
        const avgF = Number((sumF / nDays).toFixed(1));
        const avgFib = Number((sumFib / nDays).toFixed(1));
        const avgSug = Number((sumSug / nDays).toFixed(1));
        const avgSatF = Number((sumSatF / nDays).toFixed(1));

        // Food group matchers across days
        const flaxMixRx = /flaxseed|walnut|almond|brazil nut|q10/i;
        const oilyFishRx = /salmon|mackerel|sardine|trout|tuna/i;
        const wholeEggRx = /\begg\b/i;
        const eggNoodleRx = /egg\s*noodle/i;
        const berryFruitRx = /blueberr|strawberr|summer fruit|berr|fruit|kiwi|orange|apple|banana/i;
        const vegSaladRx = /mediterranean|roasting vegetables|beansprouts|carrot|salad|lentil|broccoli|spinach/i;
        const processedRx = /flap\s*jack|protein bar|cheese bar|\bbar\b|whey|isolate|powder|shake|cookie|brownie|crisp|sweet|candy|chocolate|syrup|sauce|noodle|processed/i;

        const dayHas = (d, fn) => (d.items || []).some(it => fn(String(it.name || '')));
        const isWholeEggName = (nm) => wholeEggRx.test(nm) && !eggNoodleRx.test(nm);

        const flaxDays = windowDays.filter(d => dayHas(d, nm => flaxMixRx.test(nm)));
        const noFlaxDays = windowDays.filter(d => !dayHas(d, nm => flaxMixRx.test(nm)));
        const fishDays = windowDays.filter(d => dayHas(d, nm => oilyFishRx.test(nm)));
        const eggDays = windowDays.filter(d => dayHas(d, isWholeEggName));
        const berryDays = windowDays.filter(d => dayHas(d, nm => berryFruitRx.test(nm)));
        const vegDays = windowDays.filter(d => dayHas(d, nm => vegSaladRx.test(nm)));

        let trailingFlaxSkip = 0;
        for (let i = windowDays.length - 1; i >= 0; i--) {
          if (!dayHas(windowDays[i], nm => flaxMixRx.test(nm))) trailingFlaxSkip++;
          else break;
        }
        let trailingBerrySkip = 0;
        for (let i = windowDays.length - 1; i >= 0; i--) {
          if (!dayHas(windowDays[i], nm => berryFruitRx.test(nm))) trailingBerrySkip++;
          else break;
        }

        const startMonth = (winStart || '').split(' ')[0] || '';
        const flaxMonths = new Set(flaxDays.map(d => (formatShortAuditDate(d.date) || '').split(' ')[0]).filter(Boolean));
        const flaxDatesDisplay = flaxDays.length === 0
          ? ''
          : (flaxMonths.size === 1 && startMonth && flaxMonths.has(startMonth)
            ? `${startMonth} ${flaxDays.map(d => formatShortAuditDate(d.date).replace(`${startMonth} `, '')).join(', ')}`
            : flaxDays.map(d => formatShortAuditDate(d.date)).join(', '));
        const flaxAvgFat = flaxDays.length > 0
          ? Math.round(flaxDays.reduce((s, d) => s + (Number(d.fat) || 0), 0) / flaxDays.length)
          : 0;
        const recentSkippedFatVals = noFlaxDays.slice(-2).map(d => Number(d.fat) || 0);
        const recentLowMin = recentSkippedFatVals.length > 0 ? Math.min(...recentSkippedFatVals) : 46;
        const recentLowMax = recentSkippedFatVals.length > 0 ? Math.max(...recentSkippedFatVals) : 53;

        let estProcCals = 0;
        let barCount = 0;
        let wheyCount = 0;
        windowDays.forEach(d => {
          const items = d.items || [];
          items.forEach(it => {
            const nm = String(it.name || '');
            if (processedRx.test(nm)) {
              if (/flap\s*jack|cheese bar|protein bar|\bbar\b/i.test(nm)) barCount++;
              if (/whey|isolate/i.test(nm)) wheyCount++;
              if (Number(it.cals) > 0) {
                estProcCals += Number(it.cals);
              } else if (/flap\s*jack/i.test(nm)) {
                estProcCals += 498;
              } else if (/cheese bar/i.test(nm)) {
                estProcCals += 284;
              } else if (/whey|isolate/i.test(nm)) {
                estProcCals += 141;
              } else if (/sauce|syrup/i.test(nm)) {
                estProcCals += 80;
              } else if (/noodle/i.test(nm)) {
                estProcCals += 300;
              } else {
                estProcCals += Math.round((Number(d.calories) || 2400) / Math.max(4, items.length) * 0.65);
              }
            }
          });
        });
        const procCalPct = sumCals > 0 ? Math.min(100, Math.round((estProcCals / sumCals) * 100)) : 0;
        const wholeCalPct = Math.max(0, 100 - procCalPct);

        const medVegCount = windowDays.filter(d => dayHas(d, nm => /mediterranean.*roasting|roasting vegetables/i.test(nm))).length;
        const beansproutCount = windowDays.filter(d => dayHas(d, nm => /beansprout/i.test(nm))).length;
        const carrotHoumousCount = windowDays.filter(d => dayHas(d, nm => /carrot.*houmous/i.test(nm))).length;

        const fatDeficitAvg = Math.max(0, Number((safeFTarget - avgF).toFixed(1)));
        const avgFatPct = Math.min(100, Math.round((avgF / safeFTarget) * 100));
        const satFatSharePct = avgF > 0 ? Math.round((avgSatF / avgF) * 100) : 0;
        const avgFibPct = Math.min(100, Math.round((avgFib / 35) * 100));
        const microDaysCount = windowDays.filter(d => dayHas(d, nm => berryFruitRx.test(nm)) || dayHas(d, nm => vegSaladRx.test(nm))).length;
        const microPct = Math.min(100, Math.round((microDaysCount / nDays) * 100));

        // Interactive Multi-Metric Bar Chart
        const metricMap = {
          calories: {
            label: 'Calories',
            field: 'calories',
            target: safeCalTarget,
            targetLabel: `Target ${safeCalTarget.toLocaleString()}`,
            isOk: (v) => v >= safeCalTarget * 0.75 && v <= safeCalTarget + 150,
            fmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`
          },
          protein: {
            label: 'Protein',
            field: 'protein',
            target: safePTarget,
            targetLabel: `Anchor ${safePTarget}g`,
            isOk: (v) => v >= Math.round(safePTarget * 0.85),
            fmt: (v) => `${Math.round(v)}g`
          },
          fat: {
            label: 'Fat',
            field: 'fat',
            target: 65,
            targetLabel: 'Floor 65g',
            isOk: (v) => v >= 65,
            fmt: (v) => `${Math.round(v)}g`
          },
          fiber: {
            label: 'Fiber',
            field: 'fiber',
            target: 30,
            targetLabel: 'Floor 30g',
            isOk: (v) => v >= 30,
            fmt: (v) => `${Math.round(v)}g`
          }
        };
        const activeMetric = metricMap[window.nutritionChartMetric] ? window.nutritionChartMetric : 'calories';
        const mCfg = metricMap[activeMetric];
        const seriesVals = windowDays.map(d => Number(d[mCfg.field]) || 0);
        const maxScale = Math.max(mCfg.target * 1.15, ...seriesVals, 1);
        const refBottomPx = 18 + Math.max(4, Math.min(52, Math.round((mCfg.target / maxScale) * 52)));

        const hasValidSelection = windowDays.some(d => d.date === window.nutritionSelectedDayIso);
        const selectedIso = hasValidSelection ? window.nutritionSelectedDayIso : endDateStr;
        const selectedDay = windowDays.find(d => d.date === selectedIso) || windowDays[windowDays.length - 1];

        const selTags = [];
        if (dayHas(selectedDay, nm => flaxMixRx.test(nm))) selTags.push('Flax/Nuts');
        if (dayHas(selectedDay, nm => berryFruitRx.test(nm))) selTags.push('Berries');
        if (dayHas(selectedDay, nm => vegSaladRx.test(nm))) selTags.push('Veg');
        if (dayHas(selectedDay, nm => oilyFishRx.test(nm))) selTags.push('Fish');
        if (dayHas(selectedDay, isWholeEggName)) selTags.push('Eggs');

        const chartColsHtml = windowDays.map(d => {
          const val = Number(d[mCfg.field]) || 0;
          const barH = Math.max(6, Math.min(52, Math.round((val / maxScale) * 52)));
          const ok = mCfg.isOk(val);
          const shortD = formatShortAuditDate(d.date).replace(/^[A-Za-z]+\s+/, '');
          const isTodayCol = d.date === endDateStr;
          const isSelCol = d.date === selectedIso;
          return `
<button type="button" class="fuel-chart-col${isTodayCol ? ' is-today' : ''}${isSelCol ? ' is-selected' : ''}" onclick="selectNutritionChartDay('${escapeHtml(d.date)}')" title="${escapeHtml(d.date)}: ${Math.round(Number(d.calories) || 0)} kcal • ${Math.round(Number(d.protein) || 0)}g P">
  <span class="fuel-chart-val">${mCfg.fmt(val)}</span>
  <div class="fuel-chart-bar-wrap">
    <div class="fuel-chart-bar ${ok ? 'is-ok' : 'is-warn'}" style="height:${barH}px;"></div>
  </div>
  <span class="fuel-chart-day-lbl">${escapeHtml(shortD)}</span>
</button>
          `;
        }).join('');

        const chartHtml = `
<div class="fuel-chart-box">
  <div class="fuel-metric-tabs">
    <button type="button" class="fuel-metric-pill${activeMetric === 'calories' ? ' active' : ''}" onclick="setNutritionChartMetric('calories')">Calories</button>
    <button type="button" class="fuel-metric-pill${activeMetric === 'protein' ? ' active' : ''}" onclick="setNutritionChartMetric('protein')">Protein</button>
    <button type="button" class="fuel-metric-pill${activeMetric === 'fat' ? ' active' : ''}" onclick="setNutritionChartMetric('fat')">Fat</button>
    <button type="button" class="fuel-metric-pill${activeMetric === 'fiber' ? ' active' : ''}" onclick="setNutritionChartMetric('fiber')">Fiber</button>
  </div>
  <div class="fuel-chart-plot">
    <div class="fuel-chart-ref-line" style="bottom:${refBottomPx}px;">
      <span class="fuel-chart-ref-label">${escapeHtml(mCfg.targetLabel)}</span>
    </div>
    <div class="fuel-chart-bars" style="grid-template-columns:repeat(${nDays}, minmax(0, 1fr));">
      ${chartColsHtml}
    </div>
  </div>
  <div id="fuelTrendDayInspector" class="fuel-chart-day-inspector">
    <div><strong style="color:var(--text);">${escapeHtml(formatShortAuditDate(selectedDay.date))}:</strong> ${(Math.round(Number(selectedDay.calories) || 0)).toLocaleString()} kcal • ${Math.round(Number(selectedDay.protein) || 0)}g P • ${Math.round(Number(selectedDay.carbs) || 0)}g C • ${Math.round(Number(selectedDay.fat) || 0)}g F • ${Math.round(Number(selectedDay.fiber) || 0)}g Fib</div>
    <div class="fuel-day-tags">${selTags.length > 0 ? selTags.map(t => `<span class="fuel-day-tag">${t}</span>`).join('') : '<span class="fuel-day-tag">Baseline</span>'}</div>
  </div>
</div>
        `;

        // Today vs Rolling Avg Comparison Table
        const fmtDelta = (val, unit = '') => {
          const r = Math.round(val * 10) / 10;
          return `${r >= 0 ? '+' : ''}${r}${unit}`;
        };
        const compareTableHtml = `
<div class="fuel-compare-table-wrap">
  <table class="fuel-compare-table">
    <thead>
      <tr>
        <th>Metric</th>
        <th>Today</th>
        <th>${nDays}d Avg</th>
        <th>Target</th>
        <th>Δ Avg</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Calories</td>
        <td>${Math.round(cals).toLocaleString()}</td>
        <td>${avgCals.toLocaleString()}</td>
        <td>${safeCalTarget.toLocaleString()}</td>
        <td class="${Math.abs(avgCals - safeCalTarget) <= 250 ? 'fuel-delta-ok' : 'fuel-delta-warn'}">${fmtDelta(cals - avgCals)}</td>
      </tr>
      <tr>
        <td>Protein</td>
        <td>${Math.round(p)}g</td>
        <td>${avgP}g</td>
        <td>${safePTarget}g</td>
        <td class="${avgP >= Math.round(safePTarget * 0.85) ? 'fuel-delta-ok' : 'fuel-delta-warn'}">${fmtDelta(p - avgP, 'g')}</td>
      </tr>
      <tr>
        <td>Carbs</td>
        <td>${Math.round(c)}g</td>
        <td>${avgC}g</td>
        <td>${safeCTarget}g</td>
        <td>${fmtDelta(c - avgC, 'g')}</td>
      </tr>
      <tr>
        <td>Fat</td>
        <td>${Math.round(f)}g</td>
        <td>${avgF}g</td>
        <td>${safeFTarget}g</td>
        <td class="${avgF >= 65 ? 'fuel-delta-ok' : 'fuel-delta-warn'}">${fmtDelta(f - avgF, 'g')}</td>
      </tr>
      <tr>
        <td>Fiber</td>
        <td>${Math.round(fiber)}g</td>
        <td>${avgFib}g</td>
        <td>35g</td>
        <td class="${avgFib >= 30 ? 'fuel-delta-ok' : 'fuel-delta-warn'}">${fmtDelta(fiber - avgFib, 'g')}</td>
      </tr>
    </tbody>
  </table>
</div>
        `;

        // 2x2 Quality Scorecard
        const fatTone = avgF < 65 ? 'is-warn' : 'is-ok';
        const procTone = wholeCalPct >= 80 ? 'is-ok' : 'is-info';
        const vitTone = berryDays.length >= Math.ceil(nDays * 0.5) ? 'is-ok' : 'is-info';
        const fibTone = avgFib >= 30 ? 'is-ok' : 'is-warn';

        const scorecardHtml = `
<div class="fuel-scorecard-grid">
  <div class="fuel-score-tile">
    <div class="fuel-score-top">
      <span class="fuel-score-lbl">Fat &amp; Omega-3</span>
      <span class="fuel-score-pill ${fatTone}">${avgF < 65 ? `-${fatDeficitAvg}g` : 'OK'}</span>
    </div>
    <div class="fuel-score-val">${avgF}g<span class="fuel-micro-target"> /${safeFTarget}g</span></div>
    <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${fatTone}" style="width:${avgFatPct}%;"></div></div>
    <div class="fuel-score-sub">Flax ${flaxDays.length}/${nDays}d • Fish ${fishDays.length}/${nDays}d</div>
  </div>
  <div class="fuel-score-tile">
    <div class="fuel-score-top">
      <span class="fuel-score-lbl">Whole Foods</span>
      <span class="fuel-score-pill ${procTone}">${wholeCalPct >= 80 ? 'Elite' : `${procCalPct}% Pkg`}</span>
    </div>
    <div class="fuel-score-val">${wholeCalPct}%</div>
    <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${procTone}" style="width:${wholeCalPct}%;"></div></div>
    <div class="fuel-score-sub">Bars ${barCount}x • Whey ${wheyCount}x</div>
  </div>
  <div class="fuel-score-tile">
    <div class="fuel-score-top">
      <span class="fuel-score-lbl">Produce &amp; Vit C</span>
      <span class="fuel-score-pill ${vitTone}">${berryDays.length}/${nDays}d Berry</span>
    </div>
    <div class="fuel-score-val">${vegDays.length}/${nDays}d<span class="fuel-micro-target"> Veg</span></div>
    <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${vitTone}" style="width:${Math.max(12, microPct)}%;"></div></div>
    <div class="fuel-score-sub">${trailingBerrySkip > 0 ? `No berries last ${trailingBerrySkip}d` : 'Steady Vit C intake'}</div>
  </div>
  <div class="fuel-score-tile">
    <div class="fuel-score-top">
      <span class="fuel-score-lbl">Gut &amp; Sugar</span>
      <span class="fuel-score-pill ${fibTone}">${avgFib >= 30 ? 'Optimal' : 'Low'}</span>
    </div>
    <div class="fuel-score-val">${avgFib}g<span class="fuel-micro-target"> Fib</span></div>
    <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${fibTone}" style="width:${avgFibPct}%;"></div></div>
    <div class="fuel-score-sub">Sug ${avgSug}g • Sat ${avgSatF}g</div>
  </div>
</div>
        `;

        // Crisp 3-bullet action list (no hardcoded Nov 8!)
        const upg1 = avgF < safeFTarget
          ? `Lock in morning Flax/Nuts daily (${flaxDays.length}/${nDays}d logged) to lift ${avgF}g avg toward ${safeFTarget}g.`
          : `Fat floor on target (${avgF}g/day avg across ${flaxDays.length}/${nDays} flax/nut days).`;
        const upg2 = `Oily fish ${fishDays.length}/${nDays}d &amp; whole eggs ${eggDays.length}/${nDays}d — target 2x/wk salmon or mackerel for EPA/DHA.`;
        const upg3 = trailingBerrySkip > 0
          ? `Berries skipped last ${trailingBerrySkip}d — add 80g blueberries/strawberries to oats or yogurt for tendon Vitamin C.`
          : `Strong ${wholeCalPct}% whole-food base (${vegDays.length}/${nDays}d veg) — keep berries rotating daily.`;

        // Detailed Pillar Explanations (collapsed inside drawer; preserves exact flax dates formatting)
        const trailingSkipText = trailingFlaxSkip > 0
          ? ` (skipped last ${trailingFlaxSkip} day${trailingFlaxSkip > 1 ? 's' : ''}, dropping fat to <strong>${recentLowMin}–${recentLowMax}g</strong> on recent days)`
          : '';
        const fatBody = `<strong>Flaxseed/Almonds/Brazil Nuts/Walnuts &amp; Q10</strong> logged <strong>${flaxDays.length}/${nDays} days</strong>${flaxDatesDisplay ? ` (${flaxDatesDisplay})` : ''}${trailingSkipText}. On days with it, fat reaches ~<strong>${flaxAvgFat}g+</strong>/day. <strong>Oily Fish:</strong> <strong>${fishDays.length}/${nDays} days</strong> • <strong>Whole Eggs:</strong> <strong>${eggDays.length}/${nDays} days</strong>.`;
        const procBody = `Across ${nDays} days (<strong>${sumCals.toLocaleString()} kcal</strong> total • <strong>${avgCals.toLocaleString()} kcal/day</strong>, <strong>${avgP}g P/day</strong>), whole foods drive <strong>~${wholeCalPct}%</strong> of energy. Bars (${barCount}x) &amp; Whey (${wheyCount}x) represent <strong>~${procCalPct}%</strong>.`;
        const berryGapNote = trailingBerrySkip > 0
          ? ` (0/${trailingBerrySkip} in last ${trailingBerrySkip} day${trailingBerrySkip > 1 ? 's' : ''})`
          : '';
        const vitCBody = `<strong>Veg &amp; Salad:</strong> <strong>${vegDays.length}/${nDays} days</strong> (Med Roasting Veg ${medVegCount}x, Beansprouts ${beansproutCount}x, Carrot &amp; Houmous ${carrotHoumousCount}x). <strong>Berries &amp; Fruit:</strong> <strong>${berryDays.length}/${nDays} days</strong>${berryGapNote}.`;
        const glyBody = `<strong>${avgFib}g fiber/day</strong> vs 30–40g gut target. Sugar averages <strong>${avgSug}g/day</strong> and saturated fat is <strong>${avgSatF}g/day</strong> (<strong>${satFatSharePct}%</strong> of total fat).`;

        auditEl.innerHTML = `
<div class="fuel-audit-card">
  <div class="fuel-audit-head">
    <div class="fuel-audit-title"><span>🧬</span><span>Trends &amp; Quality Audit</span></div>
    <span class="fuel-audit-range-badge">${escapeHtml(winStart)} → ${escapeHtml(winEnd)}</span>
  </div>
  ${switcherHtml}
  ${chartHtml}
  ${compareTableHtml}
  ${scorecardHtml}
  <div class="fuel-upgrade-box">
    <div class="fuel-upgrade-title">🛒 ${nDays}-Day Trend Upgrades</div>
    <div class="fuel-upgrade-list">
      <div class="fuel-upgrade-row"><span class="fuel-upgrade-tag">Fat</span><span>${upg1}</span></div>
      <div class="fuel-upgrade-row"><span class="fuel-upgrade-tag">Omega-3</span><span>${upg2}</span></div>
      <div class="fuel-upgrade-row"><span class="fuel-upgrade-tag">Vit C</span><span>${upg3}</span></div>
    </div>
  </div>
  <details class="fuel-accordion" data-details-key="fuel_audit_details">
    <summary>
      <span>📋 Detailed Pillar Notes (${nDays}-Day Breakdown)</span>
      <span class="accordion-chevron">▼</span>
    </summary>
    <div class="fuel-accordion-content" style="font-size:11.5px; color:var(--text-secondary); line-height:1.45;">
      <div>${fatBody}</div>
      <div>${procBody}</div>
      <div>${vitCBody}</div>
      <div>${glyBody}</div>
    </div>
  </details>
</div>
        `;
        return;
      }

      if (allItems.length === 0 && cals <= 0) {
        auditEl.innerHTML = `
<div class="fuel-audit-card">
  <div class="fuel-audit-head">
    <div class="fuel-audit-title"><span>🧬</span><span>Trends &amp; Quality Audit</span></div>
    <span class="fuel-audit-range-badge">Awaiting Food Logs</span>
  </div>
  ${switcherHtml}
  <div style="font-size:11.5px; color:var(--text-secondary);">Sync MyNetDiary or log meals to unlock multi-day trend charts, fat floor tracking, and micronutrient audits.</div>
</div>
        `;
        return;
      }

      // ==================== TODAY-ONLY AUDIT VIEW ====================
      const healthyFatRx = /salmon|mackerel|sardine|trout|anchov|egg|avocado|olive oil|extra virgin|walnut|almond|macadamia|chia|flax|peanut butter|almond butter|cheese|steak|beef/i;
      const ultraLowFatRx = /fat free|0%|isolate|breast/i;
      const fatSources = allItems.filter(it => healthyFatRx.test(it.name)).map(it => it.name);
      const ultraLowFatChoices = allItems.filter(it => ultraLowFatRx.test(it.name)).map(it => it.name);
      const fatPct = Math.round((f / safeFTarget) * 100);
      const fatCalPct = cals > 0 ? Math.round(((f * 9) / cals) * 100) : 0;

      let fatStatusPill, fatTone, fatBody;
      if (f < 55) {
        fatStatusPill = 'Low Floor';
        fatTone = 'is-warn';
        const lowFatNote = ultraLowFatChoices.length > 0
          ? ` Selecting <strong>${escapeHtml(ultraLowFatChoices.slice(0, 2).join(' + '))}</strong> kept fat low.`
          : '';
        const curWtKg = (window.athleteProfile && Number(window.athleteProfile.weightKg)) ? `${Number(window.athleteProfile.weightKg).toFixed(1)}kg` : 'your bodyweight';
        fatBody = `At ${curWtKg}, dropping below <strong>60–65g</strong> fat restricts endocrine synthesis &amp; fat-soluble vitamins.${lowFatNote}`;
      } else if (f <= safeFTarget + 15) {
        fatStatusPill = 'Optimal';
        fatTone = 'is-ok';
        fatBody = `Dietary fat covers <strong>${fatCalPct}%</strong> of calories (${fatSources.length} lipid source${fatSources.length === 1 ? '' : 's'} detected).`;
      } else {
        fatStatusPill = 'High';
        fatTone = 'is-warn';
        fatBody = `Fat intake sits at <strong>${fatCalPct}%</strong> of daily energy (+${f - safeFTarget}g over target).`;
      }

      const processedRx = /flap\s*jack|protein bar|cheese bar|\bbar\b|whey|isolate|powder|shake|cookie|brownie|crisp|sweet|candy|chocolate|syrup|sauce|noodle|processed/i;
      const processedItems = allItems.filter(it => processedRx.test(it.name));
      const procCals = processedItems.reduce((sum, it) => sum + it.cals, 0);
      const procProtein = processedItems.reduce((sum, it) => sum + it.p, 0);
      const procCalPct = cals > 0 ? Math.min(100, Math.round((procCals / cals) * 100)) : 0;
      const wholeCalPct = Math.max(0, 100 - procCalPct);

      let procStatusPill, procTone, procBody;
      const procNamesPreview = processedItems.map(it => `<strong>${escapeHtml(it.name)}</strong>`).join(' + ');
      const highCarbBar = processedItems.find(it => it.c >= 50);
      if (procCalPct >= 35) {
        procStatusPill = `${procCalPct}% Pkg`;
        procTone = 'is-warn';
        procBody = `${procNamesPreview} supply <strong>${procCals} kcal</strong> &amp; <strong>${Math.round(procProtein)}g P</strong> today.${highCarbBar ? ` Watch hidden sugars in ${escapeHtml(highCarbBar.name)} (${highCarbBar.c}g C).` : ''}`;
      } else if (procCalPct >= 20) {
        procStatusPill = `${procCalPct}% Supp`;
        procTone = 'is-info';
        procBody = `<strong>${wholeCalPct}%</strong> whole foods (${processedItems.length} packaged item${processedItems.length === 1 ? '' : 's'}: ${procCals} kcal).`;
      } else {
        procStatusPill = 'Dense';
        procTone = 'is-ok';
        procBody = `<strong>${wholeCalPct}%</strong> of today's energy comes from minimally processed whole foods.`;
      }

      const vitCAnyRx = /berr|blueberr|strawberr|raspberr|blackberr|orange|citrus|lemon|lime|kiwi|pepper|capsicum|broccoli|spinach|kale|tomato|apple|banana|mango|pineapple|fruit|veg|greens|salad/i;
      const vitCPowerRx = /kiwi|berr|blueberr|strawberr|raspberr|blackberr|orange|citrus|pepper|capsicum|broccoli/i;
      const vitCAnyItems = allItems.filter(it => vitCAnyRx.test(it.name));
      const vitCPowerItems = allItems.filter(it => vitCPowerRx.test(it.name));
      const garnishItems = vitCAnyItems.filter(it => !vitCPowerRx.test(it.name));
      const vitCPct = Math.min(100, Math.round((vitCPowerItems.length / 2) * 100));

      let vitStatusPill, vitTone, vitCBody;
      if (vitCPowerItems.length === 0) {
        vitStatusPill = '0 Sources';
        vitTone = 'is-warn';
        const garnishNote = garnishItems.length > 0 ? ` Only garnish logged (${escapeHtml(garnishItems.map(x => x.name).join(', '))}).` : '';
        vitCBody = `Zero berries, citrus, kiwi, or peppers logged today.${garnishNote} Vitamin C supports tendon collagen synthesis.`;
      } else if (vitCPowerItems.length === 1) {
        vitStatusPill = '1 Source';
        vitTone = 'is-info';
        vitCBody = `1 Vitamin-C source logged (<strong>${escapeHtml(vitCPowerItems[0].name)}</strong>). Add a second berry or citrus serving.`;
      } else {
        vitStatusPill = 'High';
        vitTone = 'is-ok';
        vitCBody = `${vitCPowerItems.length} Vitamin-C sources logged (${escapeHtml(vitCPowerItems.map(x => x.name).slice(0, 3).join(', '))}).`;
      }

      const loggedSugar = Number(totals && (totals.sugar_g !== undefined ? totals.sugar_g : totals.sugar)) || 0;
      const sweetCarbRx = /flap\s*jack|brownie|snickers|sweet|chocolate|sugar|honey|syrup|jam|yogurt/i;
      const estSweetCarbs = allItems
        .filter(it => sweetCarbRx.test(it.name))
        .reduce((sum, it) => sum + Math.round(it.c * (/yogurt/i.test(it.name) ? 0.55 : 0.45)), 0);
      const effectiveSugar = loggedSugar > 0 ? Math.round(loggedSugar) : estSweetCarbs;
      const sugarLabel = loggedSugar > 0 ? `${effectiveSugar}g` : `~${effectiveSugar}g est.`;
      const maxSingleCarbItem = allItems.reduce((best, it) => (!best || it.c > best.c ? it : best), null);
      const bigProcessedCarbHit = allItems.find(it => processedRx.test(it.name) && it.c >= 50) || (maxSingleCarbItem && maxSingleCarbItem.c >= 80 && processedRx.test(maxSingleCarbItem.name) ? maxSingleCarbItem : null);
      const fiberPct = Math.min(100, Math.round((fiber / 35) * 100));

      let fibStatusPill, fibTone, glyBody;
      if (bigProcessedCarbHit) {
        fibStatusPill = fiber >= 30 ? 'High-GI' : 'Spike';
        fibTone = 'is-warn';
        glyBody = `Fiber is <strong>${fiber}g</strong>, but <strong>${escapeHtml(bigProcessedCarbHit.name)}</strong> packs <strong>${bigProcessedCarbHit.c}g carbs</strong> (sugar ${sugarLabel}).`;
      } else if (fiber >= 30) {
        fibStatusPill = 'Steady';
        fibTone = 'is-ok';
        glyBody = `<strong>${fiber}g fiber</strong> hits the 30–40g target with controlled sugar (${sugarLabel}).`;
      } else {
        fibStatusPill = 'Low';
        fibTone = 'is-warn';
        glyBody = `Only <strong>${fiber}g fiber</strong> logged (sugar ${sugarLabel}). Add oats, flax, berries, or greens toward 30g+.`;
      }

      const fatDeficit = Math.max(0, 75 - f);
      const flapjackItem = allItems.find(it => /flap\s*jack|brownie|protein bar/i.test(it.name));
      const upg1 = fatDeficit > 0
        ? `Add +${fatDeficit}g fat (whole eggs, flaxseed/nuts, ½ avocado, or olive oil) for hormone &amp; joint support.`
        : `Fat target covered (${f}g) — keep favoring salmon, walnuts, and extra-virgin olive oil.`;
      const upg2 = vitCPowerItems.length < 2
        ? `Add 80g berries, 1 kiwi, or bell peppers for tendon Vitamin C &amp; collagen synthesis.`
        : `Strong Vitamin C &amp; polyphenol diversity logged today.`;
      const upg3 = flapjackItem
        ? `Swap <code>${escapeHtml(flapjackItem.name)}</code> (${flapjackItem.c}g C) for banana + nuts or cottage cheese next time.`
        : `Whole-food density locked in (${wholeCalPct}%) — keep dinner anchored on lean protein + veg.`;

      auditEl.innerHTML = `
<div class="fuel-audit-card">
  <div class="fuel-audit-head">
    <div class="fuel-audit-title"><span>🧬</span><span>Today's Quality Audit</span></div>
    <span class="fuel-audit-range-badge">${escapeHtml(endLabel)} • ${wholeCalPct}% Whole</span>
  </div>
  ${switcherHtml}
  <div class="fuel-scorecard-grid">
    <div class="fuel-score-tile">
      <div class="fuel-score-top">
        <span class="fuel-score-lbl">Fat Floor</span>
        <span class="fuel-score-pill ${fatTone}">${fatStatusPill}</span>
      </div>
      <div class="fuel-score-val">${f}g<span class="fuel-micro-target"> /${safeFTarget}g</span></div>
      <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${fatTone}" style="width:${Math.min(100, fatPct)}%;"></div></div>
      <div class="fuel-score-sub">${fatCalPct}% kcal • ${fatSources.length} lipid src</div>
    </div>
    <div class="fuel-score-tile">
      <div class="fuel-score-top">
        <span class="fuel-score-lbl">Whole Foods</span>
        <span class="fuel-score-pill ${procTone}">${procStatusPill}</span>
      </div>
      <div class="fuel-score-val">${wholeCalPct}%</div>
      <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${procTone}" style="width:${wholeCalPct}%;"></div></div>
      <div class="fuel-score-sub">${processedItems.length} packaged (${procCals} kcal)</div>
    </div>
    <div class="fuel-score-tile">
      <div class="fuel-score-top">
        <span class="fuel-score-lbl">Vit C &amp; Tendon</span>
        <span class="fuel-score-pill ${vitTone}">${vitStatusPill}</span>
      </div>
      <div class="fuel-score-val">${vitCPowerItems.length}<span class="fuel-micro-target"> /2 src</span></div>
      <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${vitTone}" style="width:${Math.max(10, vitCPct)}%;"></div></div>
      <div class="fuel-score-sub">Sugar ${sugarLabel}</div>
    </div>
    <div class="fuel-score-tile">
      <div class="fuel-score-top">
        <span class="fuel-score-lbl">Gut Fiber</span>
        <span class="fuel-score-pill ${fibTone}">${fibStatusPill}</span>
      </div>
      <div class="fuel-score-val">${fiber}g<span class="fuel-micro-target"> /35g</span></div>
      <div class="fuel-score-bar-track"><div class="fuel-score-bar-fill ${fibTone}" style="width:${fiberPct}%;"></div></div>
      <div class="fuel-score-sub">${fiber >= 30 ? 'Target met' : `${Math.max(0, 30 - fiber)}g to 30g floor`}</div>
    </div>
  </div>
  <div class="fuel-upgrade-box">
    <div class="fuel-upgrade-title">🛒 Today's Smart Upgrades</div>
    <div class="fuel-upgrade-list">
      <div class="fuel-upgrade-row"><span class="fuel-upgrade-tag">Fat</span><span>${upg1}</span></div>
      <div class="fuel-upgrade-row"><span class="fuel-upgrade-tag">Vit C</span><span>${upg2}</span></div>
      <div class="fuel-upgrade-row"><span class="fuel-upgrade-tag">Swap</span><span>${upg3}</span></div>
    </div>
  </div>
  <details class="fuel-accordion" data-details-key="fuel_audit_details">
    <summary>
      <span>📋 Detailed Pillar Notes (Today)</span>
      <span class="accordion-chevron">▼</span>
    </summary>
    <div class="fuel-accordion-content" style="font-size:11.5px; color:var(--text-secondary); line-height:1.45;">
      <div>${fatBody}</div>
      <div>${procBody}</div>
      <div>${vitCBody}</div>
      <div>${glyBody}</div>
    </div>
  </details>
</div>
      `;
    }

    // ==================== MYNETDIARY CLOUD AUTOMATION CONTROLLER ====================
    function openMndConnectModal() {
      const syncMod = document.getElementById('syncModal');
      if (syncMod) syncMod.classList.remove('open');
      const mndSyncMod = document.getElementById('mndSyncModal');
      if (mndSyncMod) mndSyncMod.classList.remove('open');

      const modal = document.getElementById('mndConnectModal');
      if (modal) modal.classList.add('open');
      const msg = document.getElementById('mndConnectMsg');
      if (msg) msg.innerHTML = '';

      const loginUser = document.getElementById('mndLoginUser');
      const savedUser = localStorage.getItem('pulse_mnd_user') || '';
      if (loginUser && !loginUser.value && savedUser) {
        loginUser.value = savedUser;
      }

      checkMndStatus();
      beep(600, 0.05);
    }

    function closeMndConnectModal() {
      const modal = document.getElementById('mndConnectModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
    }

    function toggleMndPassVisibility() {
      const input = document.getElementById('mndLoginPass');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    }

    function updateMndStatusBadgesUI(userLabel, isLinked) {
      const badge = document.getElementById('mndConnectionStatusBadge');
      const panelText = document.getElementById('mndSyncPanelStatusText');
      const bannerText = document.getElementById('mndBannerSummaryText');
      const t = (myNetDiaryData && myNetDiaryData.totals) ? myNetDiaryData.totals : { calories: 0, protein: 0 };
      const calsStr = (t.calories || 0).toLocaleString();
      const protStr = t.protein || 0;

      if (bannerText) {
        bannerText.innerText = `${calsStr} kcal • ${protStr}g P • ${(t.water || 0.0)}L Water`;
      }

      if (isLinked && userLabel) {
        const shortUser = userLabel.split('@')[0].toUpperCase();
        if (badge) {
          badge.innerText = `🟢 MND: ${shortUser}`;
          badge.style.color = 'var(--primary)';
          badge.style.background = 'rgba(0,229,255,0.14)';
          badge.style.border = '1px solid rgba(0,229,255,0.4)';
        }
        if (panelText) {
          panelText.innerHTML = `🟢 Connected as <strong style="color:var(--primary);">${escapeHtml(userLabel)}</strong> • ${escapeHtml(calsStr)} kcal Synced`;
        }
      } else {
        if (badge) {
          badge.innerText = `🟢 MND SYNC READY`;
          badge.style.color = 'var(--primary)';
          badge.style.background = 'rgba(0,229,255,0.12)';
          badge.style.border = '1px solid rgba(0,229,255,0.35)';
        }
        if (panelText) {
          panelText.innerHTML = `🟢 Ready • <strong style="color:#fff;">${calsStr} kcal & ${protStr}g P</strong> Synced Today`;
        }
      }
    }

    async function checkMndStatus() {
      const savedUser = localStorage.getItem('pulse_mnd_user') || '';
      const loginUser = document.getElementById('mndLoginUser');
      if (loginUser && savedUser && !loginUser.value) {
        loginUser.value = savedUser;
      }

      updateMndStatusBadgesUI(savedUser, Boolean(savedUser));

      try {
        const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)('/api/mnd/status', { timeoutMs: 2200, promptAuthOn401: false });
        if (!res || !res.ok) return;
        const data = await res.json();

        if (data.configured || data.has_cached_session) {
          const u = data.username || savedUser || '';
          if (u) localStorage.setItem('pulse_mnd_user', u);
          updateMndStatusBadgesUI(u, Boolean(u));
          if (loginUser && u) loginUser.value = u;
        }
      } catch(e) {
        // Offline / local mode: local status already applied
      }
    }

    async function submitMndLogin() {
      const user = document.getElementById('mndLoginUser')?.value.trim() || '';
      const pass = document.getElementById('mndLoginPass')?.value.trim();
      const msg = document.getElementById('mndConnectMsg');
      const btn = document.getElementById('btnSubmitMndLogin');

      if (!user || !pass) {
        if (msg) msg.innerHTML = '<span style="color:var(--crimson); font-weight:700;">⚠️ Please enter both your MyNetDiary email and password.</span>';
        showToast('⚠️ Please enter both email and password');
        beep(400, 0.15);
        return;
      }

      try {
        localStorage.setItem('pulse_mnd_user', user);
      } catch(err) {}

      if (btn) {
        btn.disabled = true;
        btn.innerText = '↻ Authenticating...';
      }
      if (msg) msg.innerHTML = '<span style="color:var(--cyan);">Connecting to MyNetDiary cloud service...</span>';

      try {
        const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)('/api/mnd/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: user, password: pass }),
          timeoutMs: 6000
        });
        if (!res || !res.ok || res.status === 404) {
          throw new Error('Cloud backend offline');
        }
        const data = await res.json();

        if (data.status === 'success' || data.success) {
          updateMndStatusBadgesUI(data.username || user, true);
          const syncData = data.sync_data || data.pull_result || data;
          if (syncData && (syncData.totals || syncData.data)) {
            applyMndSyncData(syncData);
          } else {
            renderMyNetDiaryEngine();
          }
          closeMndConnectModal();
          beep(880, 0.2);
          speak(`Connected to MyNetDiary. Synchronizing today's nutrition.`);
          showToast(`✓ MyNetDiary Connected as ${data.username || user}!`);
        } else {
          const err = data.message || data.error || 'Verify MyNetDiary email/password.';
          if (msg) msg.innerHTML = `<span style="color:var(--amber); font-weight:700;">⚠️ ${escapeHtml(err)}</span>`;
          showToast(`⚠️ ${err}`);
          beep(400, 0.2);
        }
      } catch(e) {
        // Backend offline fallback: cache user and open Macro Hub
        updateMndStatusBadgesUI(user, true);
        renderMyNetDiaryEngine();
        closeMndConnectModal();
        beep(720, 0.15);
        showToast(`Linked ${user}. Local mode active — use "📥 Edit" to paste or enter meals.`);
        openMndSyncModal();
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Connect & Pull Today\'s Log';
        }
      }
    }

    function applyMndSyncData(raw) {
      if (!raw) return;
      const data = raw.totals ? raw : (raw.mnd || raw.data || raw.sync_data || raw);

      let totals = data.totals;
      if (!totals && raw.state) {
        const ml = raw.state.mnd_logged || (raw.state.garmin && raw.state.garmin.mnd_logged);
        if (ml) {
          totals = {
            calories: ml.calories,
            protein: ml.protein_g,
            carbs: ml.carbs_g,
            fat: ml.fat_g,
            fiber: ml.fiber_g,
            sodium: ml.sodium_mg,
            water: ml.water_l
          };
        }
      }

      if (totals) {
        myNetDiaryData.totals = {
          calories: parseInt(totals.calories) || 0,
          protein: parseInt(totals.protein !== undefined ? totals.protein : totals.protein_g) || 0,
          carbs: parseInt(totals.carbs !== undefined ? totals.carbs : totals.carbs_g) || 0,
          fat: parseInt(totals.fat !== undefined ? totals.fat : totals.fat_g) || 0,
          fiber: parseInt(totals.fiber !== undefined ? totals.fiber : totals.fiber_g) || 0,
          sodium: parseInt(totals.sodium !== undefined ? totals.sodium : totals.sodium_mg) || 0,
          water: parseFloat(totals.water !== undefined ? totals.water : totals.water_l) || 0.0,
          sugar_g: parseFloat(totals.sugar_g !== undefined ? totals.sugar_g : totals.sugar) || 0.0,
          sat_fat_g: parseFloat(totals.sat_fat_g !== undefined ? totals.sat_fat_g : totals.sat_fat) || 0.0
        };
      }

      const meals = data.meals || (raw.state && raw.state.mnd_meals);
      if (meals && typeof meals === 'object') {
        myNetDiaryData.meals = meals;
      }

      const hist = data.history || raw.history || (raw.state && raw.state.mnd_history);
      if (hist && Array.isArray(hist.days) && hist.days.length > 0) {
        myNetDiaryData.history = hist;
      }

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      const savedUser = localStorage.getItem('pulse_mnd_user') || '';
      updateMndStatusBadgesUI(savedUser, Boolean(savedUser));
    }

    async function triggerMndAutoPull() {
      const btnHdr = document.getElementById('btnMndAutoPull');
      const btnModal = document.getElementById('btnSyncModalPullMnd');

      [btnHdr, btnModal].forEach(b => {
        if (b) {
          b.disabled = true;
          b.innerText = '↻ SYNCING...';
        }
      });

      try {
        const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)('/api/mnd/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          timeoutMs: 20000
        });

        if (!res) {
          throw new Error('Cloud backend offline');
        }

        let data = {};
        try { data = await res.json(); } catch (je) {}

        if (data.status === 'auth_needed' || data.requires_auth || data.upstream_auth_required) {
          const syncMod = document.getElementById('syncModal');
          if (syncMod) syncMod.classList.remove('open');
          initMyNetDiaryEngine();
          openMndSyncModal();
          showToast('⚠️ MyNetDiary login required — tap "☁️ Cloud Account" to reconnect');
          beep(480, 0.14);
          return { ok: false, upstreamAuthRequired: true, error: data.error || 'MyNetDiary login required' };
        }
        if (!res.ok) {
          throw new Error(data.error || `Cloud backend returned HTTP ${res.status}`);
        }

        if (data.status === 'success' || data.success) {
          const payload = data.totals ? data : (data.mnd || data.data || data.sync_data || data);
          applyMndSyncData(payload);
          checkMndStatus();
          if (typeof fetchAnalyticsSummary === 'function') fetchAnalyticsSummary(true);
          closeSyncModal();
          beep(880, 0.2);
          const t = payload.totals || {};
          const cals = t.calories || 0;
          const prot = t.protein || 0;
          const mealCount = Object.keys(payload.meals || {}).length;
          speak(`MyNetDiary synchronized. ${cals} calories, ${prot} grams protein across ${mealCount} meal blocks.`);
          showToast(`✓ Ingested: ${cals} kcal • ${prot}g P • ${mealCount} meals`);
          return { ok: true, upstreamAuthRequired: false, error: null };
        }

        const errMsg = data.error || data.message || 'using cached totals';
        const syncMod = document.getElementById('syncModal');
        if (syncMod) syncMod.classList.remove('open');
        openMndSyncModal();
        showToast(`⚠️ MyNetDiary sync incomplete: ${errMsg}`);
        beep(440, 0.14);
        return { ok: false, upstreamAuthRequired: false, error: errMsg };
      } catch(e) {
        // Fallback: keep local cached log visible, but surface an honest warning
        const syncMod = document.getElementById('syncModal');
        if (syncMod) syncMod.classList.remove('open');
        initMyNetDiaryEngine();
        renderMyNetDiaryEngine();
        const savedUser = localStorage.getItem('pulse_mnd_user') || '';
        updateMndStatusBadgesUI(savedUser, Boolean(savedUser));
        beep(400, 0.16);
        const reason = e && e.name === 'AbortError' ? 'timed out' : (e && e.message ? e.message : 'offline');
        showToast(`⚠️ MyNetDiary sync ${reason} — showing cached log`);
        return { ok: false, upstreamAuthRequired: false, error: reason };
      } finally {
        if (btnHdr) {
          btnHdr.disabled = false;
          btnHdr.innerText = '⚡ Auto-Pull MND';
        }
        if (btnModal) {
          btnModal.disabled = false;
          btnModal.innerText = '⚡ PULL TODAY\'S MYNETDIARY MEALS & MACROS';
        }
      }
    }

    async function syncBothGarminAndMnd() {
      showToast('⚡ Running Dual-Sync: Garmin Workouts + MyNetDiary Food...');
      const gRes = (typeof triggerGarminCloudSync === 'function')
        ? await triggerGarminCloudSync()
        : { ok: false, upstreamAuthRequired: false, error: 'Garmin sync unavailable' };
      const mRes = await triggerMndAutoPull();
      if (gRes && gRes.ok && mRes && mRes.ok) {
        showToast('✓ Dual-Sync complete! Garmin & MyNetDiary updated.');
      } else if (gRes && gRes.ok) {
        showToast(`✓ Garmin synced • ⚠️ MND partial failure: ${(mRes && mRes.error) || 'check credentials'}`);
      } else if (mRes && mRes.ok) {
        showToast(`✓ MND synced • ⚠️ Garmin partial failure: ${(gRes && gRes.error) || 'check Garmin auth'}`);
      } else {
        showToast(`⚠️ Sync failed — Garmin: ${(gRes && gRes.error) || 'error'} • MND: ${(mRes && mRes.error) || 'error'}`);
      }
    }

    function openMndSyncModal() {
      const syncMod = document.getElementById('syncModal');
      if (syncMod) syncMod.classList.remove('open');
      const connMod = document.getElementById('mndConnectModal');
      if (connMod) connMod.classList.remove('open');

      const t = (myNetDiaryData && myNetDiaryData.totals) ? myNetDiaryData.totals : {};
      const elCals = document.getElementById('mndInputCals'); if (elCals) elCals.value = t.calories ?? 0;
      const elProt = document.getElementById('mndInputProtein'); if (elProt) elProt.value = t.protein ?? 0;
      const elCarbs = document.getElementById('mndInputCarbs'); if (elCarbs) elCarbs.value = t.carbs ?? 0;
      const elFat = document.getElementById('mndInputFat'); if (elFat) elFat.value = t.fat ?? 0;
      const elFiber = document.getElementById('mndInputFiber'); if (elFiber) elFiber.value = t.fiber ?? 0;
      const elSodium = document.getElementById('mndInputSodium'); if (elSodium) elSodium.value = t.sodium ?? 0;
      const elWater = document.getElementById('mndInputWater'); if (elWater) elWater.value = t.water ?? 0.0;
      const elPaste = document.getElementById('mndPasteInput'); if (elPaste) elPaste.value = '';

      const bannerText = document.getElementById('mndBannerSummaryText');
      if (bannerText) {
        bannerText.innerText = `${(t.calories ?? 0).toLocaleString()} kcal • ${t.protein ?? 0}g P • ${(t.water ?? 0.0)}L Water`;
      }

      const modal = document.getElementById('mndSyncModal');
      if (modal) modal.classList.add('open');
      beep(600, 0.05);
    }

    function closeMndSyncModal() {
      const modal = document.getElementById('mndSyncModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
    }

    async function syncManualMndToBackend(extra = {}) {
      const hasDelta = Boolean(extra && typeof extra === 'object' && (extra.logged_item || extra.remove_item));
      const basePayload = hasDelta
        ? { date: (typeof getLocalDateStr === 'function' ? getLocalDateStr() : undefined) }
        : {
            totals: myNetDiaryData.totals || {},
            meals: myNetDiaryData.meals || {},
            date: (typeof getLocalDateStr === 'function' ? getLocalDateStr() : undefined)
          };
      const mndPayload = {
        ...basePayload,
        ...(extra && typeof extra === 'object' ? extra : {})
      };
      if (mndPayload.totals === null) delete mndPayload.totals;
      if (mndPayload.meals === null) delete mndPayload.meals;
      if (!mndPayload.client_event_id && !mndPayload.id && typeof _makeQueueItemId === 'function') {
        mndPayload.client_event_id = _makeQueueItemId();
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/mnd/manual', mndPayload, 'POST');
        if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
        return;
      }
      try {
        const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)('/api/mnd/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mndPayload),
          timeoutMs: 5000
        });
        if (res && res.ok) {
          const data = await res.json();
          if (data && data.success && data.state) {
            window.BAKED_LIVE_STATE = data.state;
          }
          if (typeof fetchAnalyticsSummary === 'function') fetchAnalyticsSummary(true);
        } else {
          const shouldQueue = (typeof _shouldQueueOfflineResponse === 'function')
            ? _shouldQueueOfflineResponse(res)
            : (!res || res.status >= 500 || res.status === 0);
          if (shouldQueue && typeof enqueueOfflineWrite === 'function') {
            enqueueOfflineWrite('/api/mnd/manual', mndPayload, 'POST');
            if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
          } else if (!shouldQueue && typeof showToast === 'function') {
            showToast('Invalid nutrition payload — skipped cloud sync');
          }
        }
      } catch (e) {
        if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/mnd/manual', mndPayload, 'POST');
        if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
      }
    }

    function saveMndSyncTotals() {
      const prevTotals = (myNetDiaryData && myNetDiaryData.totals) ? myNetDiaryData.totals : {};
      const cals = parseInt(document.getElementById('mndInputCals')?.value) || 0;
      const prot = parseInt(document.getElementById('mndInputProtein')?.value) || 0;
      const carbs = parseInt(document.getElementById('mndInputCarbs')?.value) || 0;
      const fat = parseInt(document.getElementById('mndInputFat')?.value) || 0;
      const fiber = parseInt(document.getElementById('mndInputFiber')?.value) || 0;
      const sodium = parseInt(document.getElementById('mndInputSodium')?.value) || 0;
      const water = parseFloat(document.getElementById('mndInputWater')?.value) || 0.0;

      myNetDiaryData.totals = {
        ...prevTotals,
        calories: cals,
        protein: prot,
        carbs: carbs,
        fat: fat,
        fiber: fiber,
        sodium: sodium,
        water: water,
        sugar_g: Number(prevTotals.sugar_g) || 0,
        sat_fat_g: Number(prevTotals.sat_fat_g) || 0
      };

      saveMndToLocalStorage();
      syncManualMndToBackend();
      renderMyNetDiaryEngine();
      closeMndSyncModal();

      beep(880, 0.15);
      speak(`MyNetDiary totals updated. ${cals} calories and ${prot} grams of protein recorded.`);
      showToast(`✓ MyNetDiary Totals Synced: ${cals} kcal • ${prot}g P`);
    }

    function parseMndPastedText() {
      const txt = document.getElementById('mndPasteInput')?.value || '';
      if (!txt.trim()) {
        showToast('Please paste MyNetDiary text first');
        return;
      }

      const calsMatch =
        txt.match(/([0-9,]+)\s*(?:k?cals?|calories?)\b/i) ||
        txt.match(/\b(?:cals?|calories?|energy)\s*[:=]?\s*([0-9,]+)/i);
      const protMatch =
        txt.match(/([0-9,]+)\s*g?\s*(?:protein|prot|p)\b/i) ||
        txt.match(/\b(?:protein|prot|p)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const carbsMatch =
        txt.match(/([0-9,]+)\s*g?\s*(?:carbs?|carbohydrates?|c)\b/i) ||
        txt.match(/\b(?:carbs?|carbohydrates?|c)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const fatMatch =
        txt.match(/([0-9,]+)\s*g?\s*(?:fats?|fat|f)\b/i) ||
        txt.match(/\b(?:fats?|fat|f)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const fiberMatch =
        txt.match(/([0-9,]+)\s*g?\s*(?:fiber|fibre)\b/i) ||
        txt.match(/\b(?:fiber|fibre)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const sodiumMatch =
        txt.match(/([0-9,]+)\s*(?:mg)?\s*(?:sodium|salt)\b/i) ||
        txt.match(/\b(?:sodium|salt)\s*[:=]?\s*([0-9,]+)\s*(?:mg)?/i);
      const waterMatch =
        txt.match(/([0-9.]+)\s*(?:l|litres?)\s*(?:water|fluid)?\b/i) ||
        txt.match(/\b(?:water|fluid)\s*[:=]?\s*([0-9.]+)\s*(?:l|litres?)?/i);

      let found = 0;
      if (calsMatch) {
        document.getElementById('mndInputCals').value = parseInt(calsMatch[1].replace(/,/g, ''));
        found++;
      }
      if (protMatch) {
        document.getElementById('mndInputProtein').value = parseInt(protMatch[1].replace(/,/g, ''));
        found++;
      }
      if (carbsMatch) {
        document.getElementById('mndInputCarbs').value = parseInt(carbsMatch[1].replace(/,/g, ''));
        found++;
      }
      if (fatMatch) {
        document.getElementById('mndInputFat').value = parseInt(fatMatch[1].replace(/,/g, ''));
        found++;
      }
      if (fiberMatch) {
        document.getElementById('mndInputFiber').value = parseInt(fiberMatch[1].replace(/,/g, ''));
        found++;
      }
      if (sodiumMatch) {
        document.getElementById('mndInputSodium').value = parseInt(sodiumMatch[1].replace(/,/g, ''));
        found++;
      }
      if (waterMatch) {
        document.getElementById('mndInputWater').value = parseFloat(waterMatch[1]);
        found++;
      }

      if (found > 0) {
        beep(720, 0.1);
        showToast(`✓ Auto-detected ${found} macro metrics from text`);
      } else {
        showToast('Could not parse numbers automatically. Please enter values below.');
      }
    }

    function closeMndLogModal() {
      const modal = document.getElementById('mndLogModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
    }

    const MACRO_GAP_COMBOS = [
      { id: 'whey_isolate', name: 'Whey Isolate Shake (1 Scoop)', cals: 120, p: 27, c: 2, f: 1 },
      { id: 'prawns_rice_cakes', name: 'King Prawns + 2 Rice Cakes', cals: 160, p: 28, c: 11, f: 1 },
      { id: 'protein_pudding', name: 'High-Protein Pudding Cup', cals: 150, p: 20, c: 12, f: 2 },
      { id: 'egg_whites_oats', name: 'Egg White Omelette + Oats', cals: 180, p: 26, c: 14, f: 2 },
      { id: 'cottage_berries', name: '0% Cottage Cheese + Berries', cals: 190, p: 24, c: 16, f: 3 },
      { id: 'casein_milk', name: 'Casein Shake + Skim Milk', cals: 230, p: 34, c: 18, f: 2 },
      { id: 'tuna_crackerbread', name: 'Tuna Chunks + 3 Crispbreads', cals: 240, p: 32, c: 19, f: 4 },
      { id: 'chicken_rice_cakes', name: 'Chicken Breast Slices + 2 Rice Cakes', cals: 250, p: 38, c: 20, f: 2 },
      { id: 'greek_yogurt_whey', name: '0% Greek Yogurt + Whey Isolate', cals: 280, p: 46, c: 18, f: 3 },
      { id: 'double_whey_oats', name: 'Double Whey Isolate + Overnight Oats', cals: 390, p: 54, c: 34, f: 4 }
    ];

    function _appendSnackAndSync(category, name, cals, p, c, f, itemId = null) {
      const cat = ['breakfast', 'lunch', 'dinner', 'snacks'].includes(category) ? category : 'snacks';
      if (!myNetDiaryData.meals) myNetDiaryData.meals = _createEmptyMndMeals();
      if (!myNetDiaryData.meals[cat]) {
        myNetDiaryData.meals[cat] = {
          name: cat === 'snacks' ? 'Snacks & Hydration' : (cat.charAt(0).toUpperCase() + cat.slice(1)),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          items: []
        };
      }
      if (!Array.isArray(myNetDiaryData.meals[cat].items)) {
        myNetDiaryData.meals[cat].items = [];
      }

      const nCals = Math.max(0, Math.round(Number(cals) || 0));
      const nP = Math.max(0, Math.round(Number(p) || 0));
      const nC = Math.max(0, Math.round(Number(c) || 0));
      const nF = Math.max(0, Math.round(Number(f) || 0));

      const entryId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const itemRecord = { id: entryId, name, cals: nCals, p: nP, c: nC, f: nF };
      if (itemId) itemRecord.combo_id = String(itemId);
      myNetDiaryData.meals[cat].items.push(itemRecord);
      myNetDiaryData.meals[cat].calories = (myNetDiaryData.meals[cat].calories || 0) + nCals;
      myNetDiaryData.meals[cat].protein = (myNetDiaryData.meals[cat].protein || 0) + nP;
      myNetDiaryData.meals[cat].carbs = (myNetDiaryData.meals[cat].carbs || 0) + nC;
      myNetDiaryData.meals[cat].fat = (myNetDiaryData.meals[cat].fat || 0) + nF;

      if (!myNetDiaryData.totals) myNetDiaryData.totals = _createEmptyMndTotals();
      myNetDiaryData.totals.calories = (myNetDiaryData.totals.calories || 0) + nCals;
      myNetDiaryData.totals.protein = (myNetDiaryData.totals.protein || 0) + nP;
      myNetDiaryData.totals.carbs = (myNetDiaryData.totals.carbs || 0) + nC;
      myNetDiaryData.totals.fat = (myNetDiaryData.totals.fat || 0) + nF;

      saveMndToLocalStorage();
      syncManualMndToBackend({
        totals: null,
        meals: null,
        meal_category: cat,
        logged_item: { id: entryId, name, cals: nCals, p: nP, c: nC, f: nF }
      });
      renderMyNetDiaryEngine();
    }

    function logMacroGapCombo(comboId) {
      const combo = MACRO_GAP_COMBOS.find((item) => item.id === comboId);
      if (!combo) return;
      _appendSnackAndSync('snacks', combo.name, combo.cals, combo.p, combo.c, combo.f, combo.id);
      if (typeof beep === 'function') beep(880, 0.12);
      if (typeof showToast === 'function') showToast(`✓ Logged ${combo.name} (${combo.cals} kcal • ${combo.p}g P)`);
    }
    if (typeof window !== 'undefined') {
      window.logMacroGapCombo = logMacroGapCombo;
    }

    function renderMacroGapCloser(totalBudget, cals, pTarget, prot) {
      const card = document.getElementById('macroGapCloserCard');
      if (!card) return;
      const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v ?? ''));
      const escAttr = (typeof escapeAttr === 'function') ? escapeAttr : esc;

      const remCals = Math.round((Number(totalBudget) || 0) - (Number(cals) || 0));
      const remProt = Math.round((Number(pTarget) || 0) - (Number(prot) || 0));

      if (remProt <= 0) {
        card.innerHTML = `
<div class="card" style="padding:12px 14px; border-color:rgba(16,185,129,0.4);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
<strong style="font-size:12px; color:var(--success); text-transform:uppercase; letter-spacing:0.05em;">Evening Macro & Protein Gap Closer</strong>
<span style="font-size:11px; font-weight:800; color:var(--success);">Target Met</span>
</div>
<div style="font-size:12px; color:var(--text-secondary); margin-top:6px;">
              Protein target met — prioritize hydration/fiber.
</div>
</div>`;
        return;
      }

      let picks = [];
      let modeHint = `${remProt}g P left • ${remCals > 0 ? remCals + ' kcal runway' : '+' + Math.abs(remCals) + ' kcal over budget'}`;
      if (remCals <= 0) {
        picks = MACRO_GAP_COMBOS
          .filter((item) => item.cals < 200)
          .slice()
          .sort((a, b) => (a.cals - b.cals) || (b.p - a.p))
          .slice(0, 3);
      } else {
        const withinBudget = MACRO_GAP_COMBOS.filter((item) => item.cals <= (remCals + 60));
        const pool = withinBudget.length > 0 ? withinBudget : MACRO_GAP_COMBOS.slice();
        picks = pool
          .slice()
          .sort((a, b) => {
            const effA = Math.min(a.p, remProt) / Math.max(1, a.cals);
            const effB = Math.min(b.p, remProt) / Math.max(1, b.cals);
            if (Math.abs(effB - effA) > 1e-6) return effB - effA;
            return b.p - a.p;
          })
          .slice(0, 3);
        if (withinBudget.length === 0) {
          const minPickCals = picks[0] ? Number(picks[0].cals) || 0 : 0;
          const overBy = Math.max(1, minPickCals - remCals);
          modeHint = `${remProt}g P left • +${overBy} kcal over budget`;
        }
      }

      const rowsHtml = picks.map((item) => `
<div class="gap-closer-row" style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px; background:var(--surface-elevated); border:1px solid var(--border); border-radius:8px; margin-top:6px;">
<div style="min-width:0; flex:1;">
<div style="font-size:12.5px; font-weight:700; color:#fff;">${esc(item.name)}</div>
<div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px;">
              ${item.cals} kcal • <strong style="color:var(--success);">${item.p}g P</strong> • ${item.c}g C • ${item.f}g F
</div>
</div>
<button type="button" class="btn-gap-log" data-combo-id="${escAttr(item.id)}" onclick="logMacroGapCombo(this.dataset.comboId)" style="min-height:44px; min-width:64px; padding:0 12px; border-radius:8px; background:var(--primary); color:#000; font-weight:900; font-size:12px; border:none; cursor:pointer;">+ Log</button>
</div>
      `).join('');

      card.innerHTML = `
<div class="card" style="padding:12px 14px;">
<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
<strong style="font-size:12px; color:var(--primary); text-transform:uppercase; letter-spacing:0.05em;">Evening Macro Gap Closer</strong>
<span style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">${esc(modeHint)}</span>
</div>
          ${rowsHtml}
</div>`;
    }

    function submitMndMealItem() {
      const cat = document.getElementById('mndMealCategory')?.value || 'snacks';
      const name = document.getElementById('mndItemName')?.value.trim();
      const cals = parseInt(document.getElementById('mndItemCals')?.value) || 0;
      const prot = parseInt(document.getElementById('mndItemProtein')?.value) || 0;
      const carbs = parseInt(document.getElementById('mndItemCarbs')?.value) || 0;
      const fat = parseInt(document.getElementById('mndItemFat')?.value) || 0;

      if (!name) {
        showToast('Please enter food description');
        return;
      }

      _appendSnackAndSync(cat, name, cals, prot, carbs, fat);
      closeMndLogModal();

      beep(880, 0.15);
      speak(`Logged ${name} to ${cat}. ${prot} grams of protein recorded.`);
      showToast(`✓ Logged ${name} to ${cat.toUpperCase()}`);
    }

    function deleteMndMealItem(mealKey, itemIdx) {
      const meal = myNetDiaryData.meals && myNetDiaryData.meals[mealKey];
      if (!meal || !meal.items || !meal.items[itemIdx]) return;

      const item = meal.items[itemIdx];
      const rmCals = Number(item.cals) || 0;
      const rmP = Number(item.p) || 0;
      const rmC = Number(item.c) || 0;
      const rmF = Number(item.f) || 0;

      meal.calories = Math.max(0, (Number(meal.calories) || 0) - rmCals);
      meal.protein = Math.max(0, (Number(meal.protein) || 0) - rmP);
      meal.carbs = Math.max(0, (Number(meal.carbs) || 0) - rmC);
      meal.fat = Math.max(0, (Number(meal.fat) || 0) - rmF);

      myNetDiaryData.totals.calories = Math.max(0, (Number(myNetDiaryData.totals.calories) || 0) - rmCals);
      myNetDiaryData.totals.protein = Math.max(0, (Number(myNetDiaryData.totals.protein) || 0) - rmP);
      myNetDiaryData.totals.carbs = Math.max(0, (Number(myNetDiaryData.totals.carbs) || 0) - rmC);
      myNetDiaryData.totals.fat = Math.max(0, (Number(myNetDiaryData.totals.fat) || 0) - rmF);

      meal.items.splice(itemIdx, 1);

      saveMndToLocalStorage();
      syncManualMndToBackend({
        totals: null,
        meals: null,
        meal_category: mealKey,
        remove_item: {
          id: item.id || null,
          meal_category: mealKey,
          name: item.name || '',
          cals: rmCals,
          p: rmP,
          c: rmC,
          f: rmF
        }
      });
      renderMyNetDiaryEngine();

      beep(500, 0.05);
      showToast(`Removed ${item.name}`);
    }

    // ==================== PERSISTENCE & LOCALSTORAGE ====================
    function saveMndToLocalStorage() {
      try {
        const todayStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().split('T')[0];
        if (myNetDiaryData && typeof myNetDiaryData === 'object') {
          myNetDiaryData.date = todayStr;
        }
        localStorage.setItem('pulse_mnd_data', JSON.stringify(myNetDiaryData));
      } catch(e) {}
    }

    function restoreMndFromLocalStorage() {
      try {
        const CURRENT_MND_VERSION = "v5.38_dated_clean";
        const todayStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().split('T')[0];
        if (localStorage.getItem('pulse_mnd_version') !== CURRENT_MND_VERSION) {
          localStorage.removeItem('pulse_mnd_data');
          localStorage.setItem('pulse_mnd_version', CURRENT_MND_VERSION);
          myNetDiaryData.date = todayStr;
          saveMndToLocalStorage();
          return;
        }
        const raw = localStorage.getItem('pulse_mnd_data');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.totals && parsed.meals) {
            if (parsed.date !== todayStr) {
              myNetDiaryData.date = todayStr;
              myNetDiaryData.totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, water: 0.0 };
              myNetDiaryData.meals = {
                breakfast: { name: "Breakfast", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
                lunch: { name: "Lunch", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
                dinner: { name: "Dinner", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
                snacks: { name: "Snacks & Hydration", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] }
              };
              if (parsed.targets && typeof parsed.targets === 'object') {
                myNetDiaryData.targets = parsed.targets;
              }
              if (parsed.history && Array.isArray(parsed.history.days) && parsed.history.days.length > 0) {
                myNetDiaryData.history = parsed.history;
              } else if (typeof window !== 'undefined' && window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.mnd_history) {
                myNetDiaryData.history = window.BAKED_LIVE_STATE.mnd_history;
              }
              saveMndToLocalStorage();
              return;
            }
            myNetDiaryData = parsed;
            if (!myNetDiaryData.history || !Array.isArray(myNetDiaryData.history.days) || myNetDiaryData.history.days.length === 0) {
              myNetDiaryData.history = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.mnd_history)
                ? window.BAKED_LIVE_STATE.mnd_history
                : DEFAULT_MND_10D_HISTORY;
            }
          }
        }
      } catch(e) {}
    }

    async function quickAddHydration(amountMl = 500) {
      if (!myNetDiaryData.totals) {
        myNetDiaryData.totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, water: 0.0 };
      }
      myNetDiaryData.totals.water = Number(((myNetDiaryData.totals.water || 0) + (amountMl / 1000)).toFixed(2));

      const elTodayHydration = document.getElementById('todayHydrationVal');
      if (elTodayHydration) elTodayHydration.innerText = `${myNetDiaryData.totals.water}L`;

      const elMndWater = document.getElementById('mndWaterVal');
      if (elMndWater) elMndWater.innerText = `${myNetDiaryData.totals.water}L`;

      const elMicroWater = document.getElementById('fuelMicroWaterVal');
      if (elMicroWater) elMicroWater.innerText = `${Number(myNetDiaryData.totals.water || 0).toFixed(1)}L`;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();

      const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
      const eventId = (typeof _makeQueueItemId === 'function') ? _makeQueueItemId() : `${Date.now()}`;
      const payload = {
        amount_ml: amountMl,
        client_event_id: eventId,
        client_date: (typeof getLocalDateStr === 'function' ? getLocalDateStr() : undefined)
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/hydration/add', payload, 'POST');
        showToast(`Saved +${amountMl}ml locally — queued for cloud sync`);
        return;
      }
      let syncedOk = false;
      try {
        const res = await fetcher('/api/hydration/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res && res.ok) {
          syncedOk = true;
        } else {
          const shouldQueue = (typeof _shouldQueueOfflineResponse === 'function')
            ? _shouldQueueOfflineResponse(res)
            : (!res || res.status >= 500 || res.status === 0);
          if (shouldQueue && typeof enqueueOfflineWrite === 'function') {
            enqueueOfflineWrite('/api/hydration/add', payload, 'POST');
          }
        }
      } catch(e) {
        console.warn('Hydration offline log sync notice:', e);
        if (typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/hydration/add', payload, 'POST');
        }
      }

      if (syncedOk) {
        showToast(`✓ +${amountMl}ml Hydration Logged`);
      } else {
        showToast(`Saved +${amountMl}ml locally — queued for cloud sync`);
      }
    }

    // ==================== FUEL TAB CONTROLS & QUICK LOG MODAL ====================

    function openQuickLogModal() {
      const modal = document.getElementById('quickLogModal');
      if (modal) modal.classList.add('open');
      const desc = document.getElementById('quickLogDesc');
      const cals = document.getElementById('quickLogCals');
      const prot = document.getElementById('quickLogProtein');
      if (desc) desc.value = '';
      if (cals) cals.value = '';
      if (prot) prot.value = '';
    }

    function closeQuickLogModal() {
      const modal = document.getElementById('quickLogModal');
      if (modal) modal.classList.remove('open');
    }

    function addQuickLogPresets(cals, prot) {
      const desc = document.getElementById('quickLogDesc');
      const calsEl = document.getElementById('quickLogCals');
      const protEl = document.getElementById('quickLogProtein');
      if (desc && !desc.value.trim()) {
        desc.value = 'Quick Protein Intake';
      }
      if (calsEl) calsEl.value = cals;
      if (protEl) protEl.value = prot;
    }

    function submitQuickLog() {
      const descEl = document.getElementById('quickLogDesc');
      const calsEl = document.getElementById('quickLogCals');
      const protEl = document.getElementById('quickLogProtein');

      const desc = (descEl && descEl.value.trim()) || 'Quick Intake';
      const cals = parseInt(calsEl && calsEl.value) || 0;
      const prot = parseInt(protEl && protEl.value) || 0;

      if (cals <= 0 && prot <= 0) return;

      const remCals = Math.max(0, cals - prot * 4);
      const carbs = Math.max(0, Math.round((remCals * 0.65) / 4));
      const fat = Math.max(0, Math.round((remCals * 0.35) / 9));

      _appendSnackAndSync('snacks', desc, cals, prot, carbs, fat);
      closeQuickLogModal();

      if (typeof showToast === 'function') {
        showToast(`✓ Quick logged ${cals} kcal • ${prot}g P`);
      }
    }

    function selectDietStrategy(key, opts = {}) {
      activeDietStrategy = key;
      const strategyMap = {
        'balanced': ['btnDietBalanced', 'panelDietBalanced'],
        'lowcarb': ['btnDietLowCarb', 'panelDietLowCarb'],
        'carbcycle': ['btnDietCarbCycle', 'panelDietCarbCycle'],
        'fasting': ['btnDietFasting', 'panelDietFasting'],
        'custom': ['btnDietCustom', 'panelDietCustom']
      };

      Object.entries(strategyMap).forEach(([sKey, [btnId, panelId]]) => {
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        const isActive = (sKey === key);
        if (btn) btn.classList.toggle('active', isActive);
        if (panel) panel.classList.toggle('active', isActive);
      });

      if (opts && opts.fromBoot === true) {
        updateDietStrategyCopy();
        return;
      }

      try {
        localStorage.setItem('pulse_diet_strategy', key);
      } catch (e) {}

      const computed = _resolveComputedFuelTargets({ dietStrategy: key });
      if (!myNetDiaryData.targets) myNetDiaryData.targets = {};
      myNetDiaryData.targets.calories = computed.calorie_target;
      myNetDiaryData.targets.protein = computed.protein_target_g;
      myNetDiaryData.targets.carbs = computed.carbs_target_g;
      myNetDiaryData.targets.fat = computed.fat_target_g;
      athleteDailyBudget = computed.calorie_target;
      athleteProteinAnchor = computed.protein_target_g;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      updateDietStrategyCopy();
      if (typeof syncClientPreferencesToCloud === 'function') {
        syncClientPreferencesToCloud('diet_strategy');
      }
    }

    function setCarbCycleLevel(level, opts = {}) {
      currentCarbCycleLevel = level;
      try {
        localStorage.setItem('pulse_carb_cycle_level', level);
      } catch (e) {}
      const levelBtns = {
        'high': 'btnCcHigh',
        'mod': 'btnCcMod',
        'low': 'btnCcLow'
      };
      Object.entries(levelBtns).forEach(([k, btnId]) => {
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.toggle('active', k === level);
      });

      const computed = _resolveComputedFuelTargets({ carbCycleLevel: level });
      if (!myNetDiaryData.targets) myNetDiaryData.targets = {};
      myNetDiaryData.targets.calories = computed.calorie_target;
      myNetDiaryData.targets.protein = computed.protein_target_g;
      myNetDiaryData.targets.carbs = computed.carbs_target_g;
      myNetDiaryData.targets.fat = computed.fat_target_g;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      if (!(opts && opts.fromBoot) && typeof syncClientPreferencesToCloud === 'function') {
        syncClientPreferencesToCloud('carb_cycle_level');
      }
    }

    let fastingTimerRunning = false;
    let fastingTimerSeconds = 0;
    let _fastingVisBound = false;

    function _loadFastingState() {
      try {
        const raw = localStorage.getItem(PULSE_FASTING_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            return {
              running: Boolean(parsed.running),
              startedAtMs: (typeof parsed.startedAtMs === 'number' && Number.isFinite(parsed.startedAtMs)) ? parsed.startedAtMs : null,
              accumulatedSec: Math.max(0, Math.floor(Number(parsed.accumulatedSec) || 0))
            };
          }
        }
      } catch (e) {}
      return { running: false, startedAtMs: null, accumulatedSec: 0 };
    }

    function _saveFastingState(st) {
      try {
        localStorage.setItem(PULSE_FASTING_STORAGE_KEY, JSON.stringify({
          running: Boolean(st.running),
          startedAtMs: st.running && st.startedAtMs ? st.startedAtMs : null,
          accumulatedSec: Math.max(0, Math.floor(Number(st.accumulatedSec) || 0))
        }));
      } catch (e) {}
    }

    function getFastingElapsedSeconds(st) {
      const state = st || _loadFastingState();
      let total = Math.max(0, Math.floor(Number(state.accumulatedSec) || 0));
      if (state.running && state.startedAtMs) {
        total += Math.max(0, Math.floor((Date.now() - state.startedAtMs) / 1000));
      }
      return total;
    }

    function updateFastingTimerDisplay() {
      const st = _loadFastingState();
      fastingTimerRunning = st.running;
      fastingTimerSeconds = getFastingElapsedSeconds(st);
      const d = document.getElementById('fastingTimerDisplay');
      if (d) {
        const h = Math.floor(fastingTimerSeconds / 3600);
        const m = Math.floor((fastingTimerSeconds % 3600) / 60);
        d.innerText = `${h}h ${m}m`;
      }
      const btn = document.getElementById('btnToggleFastTimer');
      if (btn) btn.innerText = st.running ? 'Running' : (fastingTimerSeconds > 0 ? 'Paused' : 'Start');
    }

    function _startFastingTicker() {
      if (fastingTimerInterval) {
        clearInterval(fastingTimerInterval);
        fastingTimerInterval = null;
      }
      fastingTimerInterval = setInterval(() => {
        updateFastingTimerDisplay();
      }, 1000);
    }

    function initFastingTimer() {
      const st = _loadFastingState();
      fastingTimerRunning = st.running;
      fastingTimerSeconds = getFastingElapsedSeconds(st);
      if (st.running) {
        _startFastingTicker();
      } else if (fastingTimerInterval) {
        clearInterval(fastingTimerInterval);
        fastingTimerInterval = null;
      }
      if (!_fastingVisBound && typeof document !== 'undefined') {
        _fastingVisBound = true;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            updateFastingTimerDisplay();
          }
        });
      }
      updateFastingTimerDisplay();
    }

    function toggleFastingTimer() {
      const st = _loadFastingState();
      if (st.running) {
        const elapsed = getFastingElapsedSeconds(st);
        const nextSt = { running: false, startedAtMs: null, accumulatedSec: elapsed };
        _saveFastingState(nextSt);
        fastingTimerRunning = false;
        fastingTimerSeconds = elapsed;
        if (fastingTimerInterval) {
          clearInterval(fastingTimerInterval);
          fastingTimerInterval = null;
        }
        if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
      } else {
        const nextSt = { running: true, startedAtMs: Date.now(), accumulatedSec: st.accumulatedSec };
        _saveFastingState(nextSt);
        fastingTimerRunning = true;
        fastingTimerSeconds = st.accumulatedSec;
        _startFastingTicker();
      }
      updateFastingTimerDisplay();
      if (typeof syncClientPreferencesToCloud === 'function') {
        syncClientPreferencesToCloud('fasting_timer_state');
      }
    }

    function resetFastingTimer() {
      if (fastingTimerInterval) {
        clearInterval(fastingTimerInterval);
        fastingTimerInterval = null;
      }
      _saveFastingState({ running: false, startedAtMs: null, accumulatedSec: 0 });
      fastingTimerRunning = false;
      fastingTimerSeconds = 0;
      if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
      updateFastingTimerDisplay();
      if (typeof syncClientPreferencesToCloud === 'function') {
        syncClientPreferencesToCloud('fasting_timer_state');
      }
    }

    if (typeof window !== 'undefined') {
      window.initFastingTimer = initFastingTimer;
      window.toggleFastingTimer = toggleFastingTimer;
      window.resetFastingTimer = resetFastingTimer;
      window.getFastingElapsedSeconds = getFastingElapsedSeconds;
      window.updateFastingTimerDisplay = updateFastingTimerDisplay;
    }

    function updateProDial() {
      const pSlider = document.getElementById('sliderProtein');
      const fSlider = document.getElementById('sliderFat');
      const rawProt = pSlider ? Number(pSlider.value) : 200;
      const prot = Math.max(50, Math.min(400, Number.isFinite(rawProt) && rawProt > 0 ? Math.round(rawProt) : 200));
      const rawFp = fSlider ? Number(fSlider.value) : 30;
      const fatPct = Math.max(15, Math.min(65, Number.isFinite(rawFp) ? Math.round(rawFp) : 30));
      const computed = _resolveComputedFuelTargets({
        dietStrategy: 'custom',
        proDialMacros: { protein: prot, fat_pct: fatPct }
      });

      const protValEl = document.getElementById('sliderValProtein');
      const fatValEl = document.getElementById('sliderValFat');
      const dialCalsEl = document.getElementById('proDialCals');
      const carbsValEl = document.getElementById('sliderValCarbs');

      if (protValEl) protValEl.innerText = `${computed.protein_target_g}g`;
      if (fatValEl) fatValEl.innerText = `${fatPct}%`;
      if (dialCalsEl) dialCalsEl.innerText = `${computed.calorie_target.toLocaleString()} kcal`;
      if (carbsValEl) carbsValEl.innerText = `${computed.carbs_target_g}g`;
    }

    function applyCustomProDial() {
      const pSlider = document.getElementById('sliderProtein');
      const fSlider = document.getElementById('sliderFat');
      const rawProt = pSlider ? Number(pSlider.value) : 200;
      const prot = Math.max(50, Math.min(400, Number.isFinite(rawProt) && rawProt > 0 ? Math.round(rawProt) : 200));
      const rawFp = fSlider ? Number(fSlider.value) : 30;
      const fatPct = Math.max(15, Math.min(65, Number.isFinite(rawFp) ? Math.round(rawFp) : 30));
      const proDialMacros = { protein: prot, fat_pct: fatPct };

      try {
        localStorage.setItem('pulse_pro_dial_macros', JSON.stringify(proDialMacros));
        localStorage.setItem('pulse_diet_strategy', 'custom');
      } catch (e) {}

      selectDietStrategy('custom', { fromBoot: true });
      const computed = _resolveComputedFuelTargets({
        dietStrategy: 'custom',
        proDialMacros
      });

      if (!myNetDiaryData.targets) myNetDiaryData.targets = {};
      myNetDiaryData.targets.calories = computed.calorie_target;
      myNetDiaryData.targets.protein = computed.protein_target_g;
      myNetDiaryData.targets.carbs = computed.carbs_target_g;
      myNetDiaryData.targets.fat = computed.fat_target_g;
      athleteDailyBudget = computed.calorie_target;
      athleteProteinAnchor = computed.protein_target_g;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      if (typeof syncClientPreferencesToCloud === 'function') {
        syncClientPreferencesToCloud({ pro_dial_macros: proDialMacros, diet_strategy: 'custom' }, true);
      }

      if (typeof showToast === 'function') {
        showToast(`✓ Targets Updated: ${computed.protein_target_g}g P • ${computed.carbs_target_g}g C • ${computed.fat_target_g}g F`);
      }
    }

    function refreshLiveNutritionTelemetry() {
      if (typeof triggerMndAutoPull === 'function') {
        triggerMndAutoPull();
      } else if (typeof loadLiveState === 'function') {
        loadLiveState();
      }
      renderMyNetDiaryEngine();
    }

    // ==================== EARNED FLEX, REFEED & PLANNED BANKING UI ====================
    let _flexBankSelectedDate = '';
    let _flexBankSelectedKcal = 550;
    let _flexActionInFlight = false;

    function _escFlex(v) {
      return (typeof escapeHtml === 'function')
        ? escapeHtml(v)
        : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _getNextWeekdayChips(todayIso) {
      const m = String(todayIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const baseDate = m
        ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
        : new Date();
      const targets = [
        { wd: 5, short: 'Fri' },
        { wd: 6, short: 'Sat' },
        { wd: 0, short: 'Sun' }
      ];
      return targets.map((t) => {
        const curWd = baseDate.getUTCDay();
        let diff = (t.wd - curWd + 7) % 7;
        if (diff === 0) diff = 7;
        const dObj = new Date(baseDate.getTime());
        dObj.setUTCDate(dObj.getUTCDate() + diff);
        const iso = dObj.toISOString().slice(0, 10);
        const labelShort = `${t.short} (${formatShortAuditDate(iso)})`;
        return { iso, label: labelShort, diff };
      }).sort((a, b) => a.diff - b.diff);
    }

    function _getFlexDateBounds(todayIso) {
      const m = String(todayIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const base = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date();
      const minD = new Date(base.getTime());
      minD.setUTCDate(minD.getUTCDate() + 1);
      const maxD = new Date(base.getTime());
      maxD.setUTCDate(maxD.getUTCDate() + 7);
      return { minIso: minD.toISOString().slice(0, 10), maxIso: maxD.toISOString().slice(0, 10) };
    }

    function _flexModeCtaLabel(mode, kcal) {
      const k = Number(kcal || 0);
      if (mode === 'planned_flex') return `🎉 Use Planned Flex (+${k} kcal)`;
      if (mode === 'refeed_day') return `⚡ Start Maintenance Refeed (+${k} kcal)`;
      if (mode === 'flex_meal') return `🍽 Use Flex Meal (+${k} kcal)`;
      return `🍫 Use Flex Snack (+${k} kcal)`;
    }

    function selectFlexBankPresetDate(isoDate) {
      _flexBankSelectedDate = String(isoDate || '').slice(0, 10);
      const inp = document.getElementById('flexBankDateInput');
      if (inp) inp.value = _flexBankSelectedDate;
      document.querySelectorAll('.flex-date-preset-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-iso') === _flexBankSelectedDate);
      });
    }

    function selectFlexBankPresetKcal(kcal) {
      const n = Number(kcal);
      if (Number.isFinite(n) && n >= 200 && n <= 800) {
        _flexBankSelectedKcal = Math.round(n);
      }
      document.querySelectorAll('.flex-kcal-preset-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-kcal')) === _flexBankSelectedKcal);
      });
    }

    function _updateFuelTodayFlexBanner(flex) {
      const banner = document.getElementById('fuelTodayFlexBanner');
      if (!banner) return;
      if (!flex) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
      }
      const status = String(flex.status || 'building');
      const activeToday = flex.active_today || {};
      const plan = flex.planned_bank || {};
      const bonuses = flex.tier_bonuses || {};
      const recMode = flex.recommended_mode;
      const recBonus = recMode && bonuses[recMode] ? Number(bonuses[recMode]) : Number(flex.suggested_bonus_kcal || 0);

      let html = '';
      if (status === 'unlocked') {
        const modeTitle = recMode === 'refeed_day'
          ? 'Maintenance Refeed Ready'
          : (recMode === 'planned_flex' ? 'Planned Flex Unlocked' : (recMode === 'flex_meal' ? 'Flex Meal Earned' : 'Flex Snack Earned'));
        html = `<div class="fuel-today-flex-banner tone-unlocked" onclick="switchFuelView('plan')"><span>🎯 ${_escFlex(modeTitle)}${recBonus > 0 ? ` (+${recBonus} kcal)` : ''}</span><span class="fuel-today-flex-cta">Claim →</span></div>`;
      } else if (status === 'claimed_today' || activeToday.active) {
        const bonus = Number(activeToday.bonus_kcal || 0);
        html = `<div class="fuel-today-flex-banner tone-claimed" onclick="switchFuelView('plan')"><span>⚡ Flex Active Today${bonus > 0 ? ` (+${bonus} kcal)` : ''}</span><span class="fuel-today-flex-cta">Manage →</span></div>`;
      } else if (status === 'banking_in_progress' && plan.active) {
        const lbl = _escFlex(plan.label || 'Event Bank');
        const banked = Number(plan.actual_banked_kcal || 0);
        const target = Number(plan.target_kcal || 0);
        const trim = Number(plan.daily_deduction_today || 0);
        html = `<div class="fuel-today-flex-banner tone-banking" onclick="switchFuelView('plan')"><span>📅 Banking -${trim} kcal • ${lbl} (${banked}/${target})</span><span class="fuel-today-flex-cta">View →</span></div>`;
      }

      if (html) {
        banner.style.display = 'block';
        banner.innerHTML = html;
      } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
      }
    }

    function renderFlexRefeedCard(summary) {
      const card = document.getElementById('flexRefeedCard');
      const flex = summary && summary.flex_refeed ? summary.flex_refeed : null;
      _updateFuelTodayFlexBanner(flex);
      if (!card) return;
      if (!flex) {
        card.innerHTML = `
          <div class="flex-refeed-card">
            <div class="flex-header-row">
              <div class="flex-title-wrap"><span>🎯</span><span>Flex &amp; Refeed Engine</span></div>
              <span class="flex-badge">Syncing</span>
            </div>
            <div class="flex-reason-copy">Sync MyNetDiary and Garmin telemetry to calculate your earned Flex &amp; Planned Banking status.</div>
          </div>
        `;
        return;
      }

      const todayIso = flex.date || ((typeof getLocalDateStr === 'function') ? getLocalDateStr() : '');
      const status = String(flex.status || 'building');
      const streak = flex.streak || {};
      const plan = flex.planned_bank || {};
      const activeToday = flex.active_today || {};
      const shield = flex.scale_shield || {};
      const chips = Array.isArray(streak.day_chips) ? streak.day_chips : [];
      const weekdays = _getNextWeekdayChips(todayIso);
      const bounds = _getFlexDateBounds(todayIso);

      if (plan.active && plan.target_date) {
        _flexBankSelectedDate = String(plan.target_date).slice(0, 10);
        if (Number(plan.target_kcal) >= 200) _flexBankSelectedKcal = Math.round(Number(plan.target_kcal));
      } else if (!_flexBankSelectedDate || _flexBankSelectedDate < bounds.minIso || _flexBankSelectedDate > bounds.maxIso) {
        _flexBankSelectedDate = (weekdays.find((w) => w.label.startsWith('Sat')) || weekdays[0] || {}).iso || bounds.minIso;
      }

      let badgeText = 'Building';
      let badgeTone = 'tone-building';
      if (status === 'claimed_today') {
        badgeText = 'Active Today';
        badgeTone = 'tone-claimed';
      } else if (status === 'unlocked') {
        badgeText = flex.recommended_mode === 'refeed_day' ? 'Refeed Ready' : (flex.recommended_mode === 'flex_meal' ? 'Flex Meal Earned' : (flex.recommended_mode === 'planned_flex' ? 'Planned Unlocked' : 'Snack Earned'));
        badgeTone = 'tone-unlocked';
      } else if (status === 'banking_in_progress') {
        badgeText = `Banking ${Number(plan.days_remaining || 0)}d left`;
        badgeTone = 'tone-banking';
      } else if (status === 'cooldown') {
        badgeText = 'Cooldown';
        badgeTone = 'tone-cooldown';
      } else if (status === 'insufficient_data') {
        badgeText = 'Calibrating';
        badgeTone = 'tone-building';
      }

      const chipsHtml = chips.map((ch) => {
        const cls = ch.state === 'clean' ? 'is-clean' : (ch.state === 'over' ? 'is-over' : '');
        const dayNum = String(ch.date || '').slice(8, 10) || '--';
        const titleTxt = ch.state === 'unlogged'
          ? `${ch.date}: Unlogged (<800 kcal)`
          : `${ch.date}: ${ch.calories} kcal • ${ch.protein_g}g P (${ch.state})`;
        return `
          <div class="flex-day-chip ${cls}" title="${_escFlex(titleTxt)}">
            <span class="flex-day-chip-dot"></span>
            <span class="flex-day-chip-lbl">${_escFlex(dayNum)}</span>
          </div>
        `;
      }).join('');

      let ctaHtml = '';
      if (activeToday.active) {
        ctaHtml = `
          <div class="flex-actions-row">
            <button type="button" class="flex-btn-undo" onclick="undoFlexRefeed()">✕ Undo Today's Flex (+${Number(activeToday.bonus_kcal || 0)} kcal)</button>
          </div>
        `;
      } else {
        const elig = Array.isArray(flex.eligible_modes) ? flex.eligible_modes : [];
        const bonuses = flex.tier_bonuses || {};
        const btns = [];
        if (flex.recommended_mode && bonuses[flex.recommended_mode]) {
          const recMode = flex.recommended_mode;
          const recCls = (recMode === 'flex_meal' || recMode === 'planned_flex') ? 'flex-btn-primary is-emerald' : 'flex-btn-primary';
          btns.push(`<button type="button" class="${recCls}" onclick="claimFlexRefeed('${_escFlex(recMode)}', ${Number(bonuses[recMode])})">${_escFlex(_flexModeCtaLabel(recMode, bonuses[recMode]))}</button>`);
        }
        if (elig.includes('flex_snack') && flex.recommended_mode !== 'flex_snack' && bonuses.flex_snack) {
          btns.push(`<button type="button" class="flex-btn-ghost" onclick="claimFlexRefeed('flex_snack', ${Number(bonuses.flex_snack)})">+${Number(bonuses.flex_snack)} Snack</button>`);
        }
        if (btns.length > 0) {
          ctaHtml = `<div class="flex-actions-row">${btns.join('')}</div>`;
        }
      }

      const bankStatusLine = plan.active
        ? `<div class="flex-reason-copy" style="margin-bottom:6px;">Active Plan: <strong>${_escFlex(plan.label || 'Planned Flex')}</strong> on <strong>${_escFlex(plan.target_date)}</strong> • Banked <strong>${Number(plan.actual_banked_kcal || 0)} / ${Number(plan.target_kcal || 0)} kcal</strong> (Trim: -${Number(plan.daily_deduction_today || 0)} kcal today).</div>`
        : '';

      const weekdayBtnsHtml = weekdays.map((w) => {
        const act = w.iso === _flexBankSelectedDate ? 'active' : '';
        return `<button type="button" class="flex-preset-btn flex-date-preset-btn ${act}" data-iso="${_escFlex(w.iso)}" onclick="selectFlexBankPresetDate('${_escFlex(w.iso)}')">${_escFlex(w.label)}</button>`;
      }).join('');

      const kcalBtnsHtml = [400, 550, 700].map((k) => {
        const act = k === _flexBankSelectedKcal ? 'active' : '';
        return `<button type="button" class="flex-preset-btn flex-kcal-preset-btn ${act}" data-kcal="${k}" onclick="selectFlexBankPresetKcal(${k})">+${k} kcal</button>`;
      }).join('');

      const existingPlanLbl = (plan.active && plan.label) ? String(plan.label) : '';
      const cancelBtnHtml = plan.active
        ? `<button type="button" class="flex-btn-undo" onclick="cancelFlexBankPlan()">Cancel Plan</button>`
        : '';

      const midBoxLabel = plan.active ? 'EVENT BANKED' : '7D BANK';
      const midBoxVal = plan.active
        ? `${Number(plan.actual_banked_kcal || 0)}/${Number(plan.target_kcal || 0)}`
        : `${Number(streak.banked_7d_kcal || 0).toLocaleString()} kcal`;
      const rightBoxLabel = shield.active ? 'SCALE SHIELD' : 'EST. MAINT.';
      const rightBoxVal = shield.active ? `${Number(shield.hours_remaining || 0)}h left` : `${Number(flex.tdee_ref || 0).toLocaleString()} kcal`;

      card.innerHTML = `
        <div class="flex-refeed-card">
          <div class="flex-header-row">
            <div class="flex-title-wrap"><span>🎯</span><span>Earned Flex &amp; Planned Banking</span></div>
            <span class="flex-badge ${badgeTone}">${_escFlex(badgeText)}</span>
          </div>
          <div class="flex-stats-grid">
            <div class="flex-stat-box">
              <div class="flex-stat-label">7D CLEAN</div>
              <div class="flex-stat-val">${Number(streak.clean_days_7d || 0)} / 7</div>
            </div>
            <div class="flex-stat-box">
              <div class="flex-stat-label">${midBoxLabel}</div>
              <div class="flex-stat-val">${_escFlex(midBoxVal)}</div>
            </div>
            <div class="flex-stat-box">
              <div class="flex-stat-label">${rightBoxLabel}</div>
              <div class="flex-stat-val">${_escFlex(rightBoxVal)}</div>
            </div>
          </div>
          ${chipsHtml ? `<div class="flex-streak-strip">${chipsHtml}</div>` : ''}
          <div class="flex-reason-copy">${_escFlex(flex.reason || '')}</div>
          ${ctaHtml}
          <details class="flex-bank-drawer" data-details-key="fuel_flex_bank"${plan.active ? ' open' : ''}>
            <summary>
              <span>${plan.active ? `📅 Banking for ${_escFlex(plan.label || 'Event')} (${_escFlex(plan.target_date)})` : '📅 Plan Weekend / Event Bank'}</span>
              <span class="accordion-chevron">▼</span>
            </summary>
            <div class="flex-bank-body">
              ${bankStatusLine}
              <div class="flex-preset-row">${weekdayBtnsHtml}</div>
              <div class="flex-preset-row">${kcalBtnsHtml}</div>
              <div class="flex-input-grid">
                <input id="flexBankDateInput" type="date" class="flex-input" min="${_escFlex(bounds.minIso)}" max="${_escFlex(bounds.maxIso)}" value="${_escFlex(_flexBankSelectedDate)}" onchange="selectFlexBankPresetDate(this.value)" />
                <input id="flexBankLabelInput" type="text" class="flex-input" maxlength="40" placeholder="Event label (e.g. Saturday Pizza)" value="${_escFlex(existingPlanLbl)}" />
              </div>
              <div class="flex-actions-row" style="margin-bottom:0;">
                <button type="button" class="flex-btn-primary" onclick="saveFlexBankPlan()">${plan.active ? 'Update Banking Plan' : 'Save Banking Plan'}</button>
                ${cancelBtnHtml}
              </div>
            </div>
          </details>
        </div>
      `;
    }

    function renderPostRefeedScaleShield(summary) {
      const bannerEl = document.getElementById('postRefeedScaleShield');
      const pillEl = document.getElementById('todayScaleShieldPill');
      const shield = summary && summary.flex_refeed && summary.flex_refeed.scale_shield
        ? summary.flex_refeed.scale_shield
        : null;
      const isActive = Boolean(shield && shield.active);

      if (pillEl) {
        if (isActive) {
          pillEl.style.display = 'inline-block';
          pillEl.innerText = `🛡 Glycogen Shield · ${Number(shield.hours_remaining || 0)}h`;
          pillEl.title = String(shield.note || '');
        } else {
          pillEl.style.display = 'none';
          pillEl.innerText = '';
        }
      }

      if (!bannerEl) return;
      if (!isActive) {
        bannerEl.innerHTML = '';
        return;
      }
      const modeName = shield.claim_mode === 'refeed_day'
        ? 'Maintenance Refeed'
        : (shield.claim_mode === 'planned_flex' ? 'Planned Flex' : 'Flex Meal');
      bannerEl.innerHTML = `
        <div class="scale-shield-banner">
          <div class="scale-shield-title">
            <span>🛡 Post-${_escFlex(modeName)} Scale Shield Active</span>
            <span>${Number(shield.hours_remaining || 0)}h left</span>
          </div>
          <div class="scale-shield-copy">${_escFlex(shield.note || '')}</div>
        </div>
      `;
    }

    function _syncFlexResponseState(data) {
      if (!data || typeof data !== 'object') return;
      if (data.flex_refeed) {
        const nextSummary = { ...(window.PULSE_ANALYTICS_SUMMARY || {}), flex_refeed: data.flex_refeed };
        window.PULSE_ANALYTICS_SUMMARY = nextSummary;
        try { localStorage.setItem('pulse_analytics_summary_cache', JSON.stringify(nextSummary)); } catch (e) {}
      }
      if (data.state && typeof data.state === 'object') {
        if (typeof applyLiveStateToDom === 'function') {
          applyLiveStateToDom(data.state);
        } else {
          window.BAKED_LIVE_STATE = data.state;
          renderMyNetDiaryEngine();
        }
      } else {
        renderMyNetDiaryEngine();
      }
      renderFlexRefeedCard(window.PULSE_ANALYTICS_SUMMARY);
      renderPostRefeedScaleShield(window.PULSE_ANALYTICS_SUMMARY);
    }

    async function claimFlexRefeed(mode, bonusKcal) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof showToast === 'function') showToast('Reconnect to claim or schedule Flex budgets');
        return;
      }
      if (_flexActionInFlight) return;
      _flexActionInFlight = true;
      try {
        const bodyObj = {
          mode: String(mode || '').trim(),
          client_event_id: `flx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        };
        if (bonusKcal !== undefined && bonusKcal !== null && Number.isFinite(Number(bonusKcal))) {
          bodyObj.bonus_kcal = Math.round(Number(bonusKcal));
        }
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/fuel/flex/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
          timeoutMs: 10000
        });
        const data = res ? await res.json().catch(() => ({})) : {};
        if (!res || !res.ok || data.success === false) {
          if (typeof showToast === 'function') showToast(`⚠️ ${data.detail || 'Could not claim Flex boost'}`);
          return;
        }
        _syncFlexResponseState(data);
        if (typeof showToast === 'function') showToast(`✓ ${(data.claim && data.claim.label) || 'Flex boost applied'} — Protein anchor locked`);
      } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Could not reach server for Flex claim');
      } finally {
        _flexActionInFlight = false;
      }
    }

    async function undoFlexRefeed() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof showToast === 'function') showToast('Reconnect to claim or schedule Flex budgets');
        return;
      }
      if (_flexActionInFlight) return;
      _flexActionInFlight = true;
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/fuel/flex/undo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          timeoutMs: 10000
        });
        const data = res ? await res.json().catch(() => ({})) : {};
        if (!res || !res.ok || data.success === false) {
          if (typeof showToast === 'function') showToast(`⚠️ ${data.detail || 'Could not undo today’s Flex claim'}`);
          return;
        }
        _syncFlexResponseState(data);
        if (typeof showToast === 'function') showToast('✓ Today’s Flex boost reverted');
      } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Could not reach server to undo Flex');
      } finally {
        _flexActionInFlight = false;
      }
    }

    async function saveFlexBankPlan() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof showToast === 'function') showToast('Reconnect to claim or schedule Flex budgets');
        return;
      }
      if (_flexActionInFlight) return;
      const dateInp = document.getElementById('flexBankDateInput');
      const labelInp = document.getElementById('flexBankLabelInput');
      const targetDate = (dateInp && dateInp.value) ? String(dateInp.value).trim() : _flexBankSelectedDate;
      const label = (labelInp && labelInp.value) ? String(labelInp.value).trim().slice(0, 40) : '';
      const targetKcal = Math.max(200, Math.min(800, Math.round(Number(_flexBankSelectedKcal) || 550)));
      if (!targetDate) {
        if (typeof showToast === 'function') showToast('⚠️ Pick a target date (1–7 days ahead)');
        return;
      }
      _flexActionInFlight = true;
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/fuel/flex/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upsert',
            target_date: targetDate,
            target_kcal: targetKcal,
            label
          }),
          timeoutMs: 10000
        });
        const data = res ? await res.json().catch(() => ({})) : {};
        if (!res || !res.ok || data.success === false) {
          if (typeof showToast === 'function') showToast(`⚠️ ${data.detail || 'Could not save Banking Plan'}`);
          return;
        }
        _syncFlexResponseState(data);
        if (typeof showToast === 'function') showToast(`✓ Planned Bank active for ${targetDate} (+${targetKcal} kcal)`);
      } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Could not save Banking Plan');
      } finally {
        _flexActionInFlight = false;
      }
    }

    async function cancelFlexBankPlan() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof showToast === 'function') showToast('Reconnect to claim or schedule Flex budgets');
        return;
      }
      if (_flexActionInFlight) return;
      _flexActionInFlight = true;
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/fuel/flex/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
          timeoutMs: 10000
        });
        const data = res ? await res.json().catch(() => ({})) : {};
        if (!res || !res.ok || data.success === false) {
          if (typeof showToast === 'function') showToast(`⚠️ ${data.detail || 'Could not cancel Banking Plan'}`);
          return;
        }
        _syncFlexResponseState(data);
        if (typeof showToast === 'function') showToast('✓ Planned Banking cancelled');
      } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ Could not cancel Banking Plan');
      } finally {
        _flexActionInFlight = false;
      }
    }

    if (typeof window !== 'undefined') {
      window.renderFlexRefeedCard = renderFlexRefeedCard;
      window.renderPostRefeedScaleShield = renderPostRefeedScaleShield;
      window.claimFlexRefeed = claimFlexRefeed;
      window.undoFlexRefeed = undoFlexRefeed;
      window.saveFlexBankPlan = saveFlexBankPlan;
      window.cancelFlexBankPlan = cancelFlexBankPlan;
      window.selectFlexBankPresetDate = selectFlexBankPresetDate;
      window.selectFlexBankPresetKcal = selectFlexBankPresetKcal;
    }


