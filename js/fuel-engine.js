    // ==================== ELEPHANT-GOLDFISH ADAPTIVE FUEL & RUNWAY ENGINE ====================
    let athleteDailyBudget = 2741;
    let athleteProteinAnchor = 200;
    let dailyLoggedCalories = 0;
    let dailyLoggedProtein = 0;
    let dailyLoggedMealsList = [];
    let activeDietStrategy = 'balanced';
    let currentCarbCycleLevel = 'high';
    let currentFastingProtocol = '16_8';
    let fastingTimerSeconds = 14 * 3600 + 25 * 60; // 14h 25m initial
    let fastingTimerRunning = true;
    let fastingTimerInterval = null;
    let solverProteinTarget = 45;
    let activeRetailStore = 'tesco';

    // ==================== MYNETDIARY ENGINE STATE & DATA STORE ====================
    let myNetDiaryData = {
      "totals": {
            "calories": 2300,
            "protein": 216,
            "carbs": 296,
            "fat": 46,
            "fiber": 49,
            "sodium": 2574,
            "water": 0.0
      },
      "meals": {
            "breakfast": {
                  "name": "Breakfast",
                  "time": "6:24",
                  "calories": 2300,
                  "protein": 216,
                  "carbs": 296,
                  "fat": 46,
                  "items": [
                        {
                              "name": "Old Fashioned Jumbo Oats",
                              "cals": 563,
                              "p": 16,
                              "c": 104,
                              "f": 12
                        },
                        {
                              "name": "Snickers Impact Whey Isolate",
                              "cals": 141,
                              "p": 28,
                              "c": 7,
                              "f": 1
                        },
                        {
                              "name": "Protein Cheese Bar",
                              "cals": 284,
                              "p": 41,
                              "c": 4,
                              "f": 12
                        },
                        {
                              "name": "Chicken Tikka Salad",
                              "cals": 486,
                              "p": 42,
                              "c": 64,
                              "f": 11
                        },
                        {
                              "name": "Fat Free Authentic Luxury Greek Yogurt",
                              "cals": 328,
                              "p": 49,
                              "c": 30,
                              "f": 2
                        },
                        {
                              "name": "Raw Protein Flap Jack Chocolate Brownie",
                              "cals": 498,
                              "p": 40,
                              "c": 87,
                              "f": 8
                        }
                  ]
            },
            "lunch": {
                  "name": "Lunch",
                  "time": "12:45",
                  "calories": 0,
                  "protein": 0,
                  "carbs": 0,
                  "fat": 0,
                  "items": []
            },
            "dinner": {
                  "name": "Dinner",
                  "time": "Pending",
                  "calories": 0,
                  "protein": 0,
                  "carbs": 0,
                  "fat": 0,
                  "items": []
            },
            "snacks": {
                  "name": "Snacks & Hydration",
                  "time": "15:15",
                  "calories": 0,
                  "protein": 0,
                  "carbs": 0,
                  "fat": 0,
                  "items": []
            }
      }
};

    // ==================== MYNETDIARY ENGINE & MACRO BREAKDOWN ====================
    function initMyNetDiaryEngine() {
      restoreMndFromLocalStorage();
      renderMyNetDiaryEngine();
    }

    function renderMyNetDiaryEngine() {
      // 1. Resolve Dynamic Daily Calorie Target
      let inAppBurn = 0;
      try {
        const _now = new Date();
        const _todayIso = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
        const rawBurn = localStorage.getItem('pulse_inapp_burn_today');
        if (rawBurn) {
          const parsed = JSON.parse(rawBurn);
          if (parsed && parsed.date === _todayIso) {
            inAppBurn = Number(parsed.calories) || 0;
          }
        }
      } catch(e) {}

      // Prevent double-counting pulse_inapp_burn_today if Garmin OAuth already measured Strength activity
      try {
        const g = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) ? window.BAKED_LIVE_STATE.garmin : null;
        if (g && g.source === 'garmin_oauth') {
          const todayActs = Array.isArray(g.today_activities) ? g.today_activities : [];
          const hasGarminStrength = todayActs.some(a => {
            const name = (a.name || '').toLowerCase();
            const key = (a.activity_type_key || '').toLowerCase();
            return name.includes('strength') || key.includes('strength');
          });
          if (hasGarminStrength) {
            inAppBurn = 0;
          }
        }
      } catch(e) {}

      const baseGarminBurn = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && window.BAKED_LIVE_STATE.garmin.active_calories !== undefined)
        ? Number(window.BAKED_LIVE_STATE.garmin.active_calories)
        : 623;

      let activeBurn = baseGarminBurn + inAppBurn;
      const burnEl = document.getElementById('vitalBurn');
      if (burnEl) {
        const parsedBurn = parseInt(burnEl.innerText);
        if (!isNaN(parsedBurn) && parsedBurn >= 0) {
          activeBurn = parsedBurn;
        }
      }
      const totalBudget = 2092 + activeBurn;
      athleteDailyBudget = totalBudget;

      const ftEl = document.getElementById('fuelTargetNum');
      if (ftEl) ftEl.innerHTML = `${totalBudget.toLocaleString()} <small style="font-size:13.5px; color:var(--lime);">+${activeBurn} kcal</small>`;
      const fbEl = document.getElementById('fuelBudgetNum');
      if (fbEl) fbEl.innerText = totalBudget;

      // 2. Macro Targets (Greg Putt: 98.0kg, 17.2% BF -> 81.14kg lean mass)
      const pTarget = (myNetDiaryData.targets && myNetDiaryData.targets.protein) || athleteProteinAnchor || 200; // 2.46g/kg lean mass
      const cTarget = (myNetDiaryData.targets && myNetDiaryData.targets.carbs) || 251; // Glycogen recharge for hybrid lifting + cardio
      const fTarget = (myNetDiaryData.targets && myNetDiaryData.targets.fat) || 80;  // Endocrine & cell health floor

      // Current Consumed Totals
      if (!myNetDiaryData.totals) {
        myNetDiaryData.totals = { calories: 824, protein: 49, carbs: 115, fat: 23, fiber: 19, sodium: 275, water: 0.0 };
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

      // 5. Micronutrients Strip
      const elFiber = document.getElementById('mndFiberVal');
      if (elFiber) elFiber.innerText = `${myNetDiaryData.totals.fiber || 0}g`;

      const elSodium = document.getElementById('mndSodiumVal');
      if (elSodium) elSodium.innerText = `${(myNetDiaryData.totals.sodium || 0).toLocaleString()}mg`;

      const elWater = document.getElementById('mndWaterVal');
      if (elWater) elWater.innerText = `${myNetDiaryData.totals.water || 0}L`;

      // Update #todayMacroRemainingPill element (Goldfish 3-second glance pill on Today tab)
      const macroPill = document.getElementById('todayMacroRemainingPill');
      if (macroPill) {
        if (prot >= pTarget) {
          macroPill.innerText = `${calsLeft.toLocaleString()} kcal • ✓ P Met • C: ${carbsLeft}g • F: ${fatsLeft}g`;
        } else {
          macroPill.innerText = `${calsLeft.toLocaleString()} kcal • P: ${protLeft}g • C: ${carbsLeft}g • F: ${fatsLeft}g left`;
        }
      }

      // 6. Chronological Meal Stream
      renderMndMealStream();

      // 7. Autoregulation Coach Advice
      updateMndCoachAdvice(calsLeft, protLeft, carbsLeft, fatsLeft, totalBudget);

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

      // 8. Synchronize Runway UI
      dailyLoggedCalories = cals;
      dailyLoggedProtein = prot;
      updateRunwayUI();
    }

    function updateRunwayUI() {
      const burnEl = document.getElementById('vitalBurn');
      let activeBurn = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && window.BAKED_LIVE_STATE.garmin.active_calories !== undefined)
        ? Number(window.BAKED_LIVE_STATE.garmin.active_calories)
        : 623;
      if (burnEl) {
        const parsed = parseInt(burnEl.innerText);
        if (!isNaN(parsed) && parsed >= 0) activeBurn = parsed;
      }
      const totalBudget = 2092 + activeBurn;
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
      const pct = Math.min(100, Math.round((cals / totalBudget) * 100));

      const ftEl = document.getElementById('fuelTargetNum');
      if (ftEl) ftEl.innerHTML = `${totalBudget.toLocaleString()} <span style="font-size:12px; color:var(--text-muted); font-weight:500;">+${activeBurn} active</span>`;

      const frEl = document.getElementById('fuelRemainingNum');
      if (frEl) {
        if (diff <= 0) {
          frEl.innerHTML = `0 <span style="font-size:13px; font-weight:600; color:#ff9f0a;">kcal</span>`;
        } else {
          frEl.innerHTML = `${remainingCals.toLocaleString()} <span style="font-size:13px; font-weight:600; color:var(--primary);">kcal</span>`;
        }
      }

      const fcText = document.getElementById('fuelConsumedText');
      if (fcText) fcText.innerText = `${cals.toLocaleString()} kcal`;

      const ipPct = document.getElementById('intakeProgressPercent');
      if (ipPct) {
        if (diff <= 0) {
          ipPct.innerHTML = `<span style="color:#ff9f0a; font-weight:700;">100% (Target Reached • At Maintenance)</span>`;
        } else {
          ipPct.innerText = `${pct}% (${remainingCals.toLocaleString()} kcal Runway)`;
        }
      }

      const barIntake = document.getElementById('barIntakeConsumed');
      if (barIntake) {
        barIntake.style.width = `${pct}%`;
        barIntake.style.background = diff <= 0 ? 'linear-gradient(90deg, #ff9f0a, #f97316)' : 'linear-gradient(90deg, #00F0FF 0%, #3B82F6 60%, #A855F7 100%)';
        barIntake.style.boxShadow = diff <= 0 ? '0 0 12px rgba(255, 159, 10, 0.5)' : '0 0 12px rgba(0, 240, 255, 0.5)';
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

      const mp = document.getElementById('macroProtein');
      if (mp) mp.innerText = `${pTarget}g`;
      const mpSub = document.getElementById('macroProteinSub');
      if (mpSub) {
        const pPct = Math.round((prot / pTarget) * 100);
        mpSub.innerText = prot >= pTarget ? `${prot}g (${pPct}%) • Anchor Met (+${prot - pTarget}g)` : `${prot}g / ${pTarget}g (${pPct}%)`;
      }

      const mc = document.getElementById('macroCarbs');
      if (mc) mc.innerText = `${cTarget}g`;
      const mcSub = document.getElementById('macroCarbsSub');
      if (mcSub) {
        const netCarbs = fiber > 0 ? Math.max(0, carbs - fiber) : carbs;
        mcSub.innerText = fiber > 0 
          ? `${netCarbs}g net (${carbs}g) • ${Math.max(0, cTarget - carbs)}g Left` 
          : `${carbs}g • ${Math.max(0, cTarget - carbs)}g Left`;
      }

      const mf = document.getElementById('macroFat');
      if (mf) mf.innerText = `${fTarget}g`;
      const mfSub = document.getElementById('macroFatSub');
      if (mfSub) mfSub.innerText = `${fats}g • ${Math.max(0, fTarget - fats)}g Left`;

      const barP = document.getElementById('barProtein');
      if (barP) barP.style.width = `${Math.min(100, Math.round((prot / pTarget) * 100))}%`;
      const barC = document.getElementById('barCarbs');
      if (barC) barC.style.width = `${Math.min(100, Math.round((carbs / cTarget) * 100))}%`;
      const barF = document.getElementById('barFat');
      if (barF) barF.style.width = `${Math.min(100, Math.round((fats / fTarget) * 100))}%`;

      // Update Progressive Disclosure Math Drawer
      const elBmr = document.getElementById('fuelCalcBmr');
      if (elBmr) elBmr.innerText = '2,101 kcal';
      const elBurn = document.getElementById('fuelCalcBurn');
      if (elBurn) elBurn.innerText = `+${activeBurn} kcal`;
      const elTarget = document.getElementById('fuelCalcTarget');
      if (elTarget) elTarget.innerText = `= ${totalBudget.toLocaleString()} kcal`;
      const elConsumed = document.getElementById('fuelCalcConsumed');
      if (elConsumed) elConsumed.innerText = `-${cals.toLocaleString()} kcal`;
      const elRem = document.getElementById('fuelCalcRemaining');
      if (elRem) {
        if (diff <= 0) {
          elRem.innerHTML = `<span style="color:#ff9f0a;">= 0 kcal (At Maintenance)</span>`;
        } else {
          elRem.innerHTML = `= ${remainingCals.toLocaleString()} kcal`;
        }
      }
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

        const hasItems = meal.items && meal.items.length > 0;
        if (hasItems) loggedCount++;

        const mealCard = document.createElement('div');
        mealCard.className = 'meal-card-accordion';
        if (mKey === 'dinner' && !hasItems) {
          mealCard.style.opacity = '0.65';
        }

        let itemsHtml = '';
        if (hasItems) {
          itemsHtml = meal.items.map((item, itemIdx) => `
            <div class="mnd-item-row" style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04); font-size:12px;">
              <span style="color:#FFFFFF; font-weight:500;">${item.name}</span>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="color:var(--text-muted); font-size:11px;">${item.cals} kcal</span>
                <span style="color:var(--primary); font-weight:700; font-size:11px;">${item.p}g P</span>
                <span style="color:var(--text-muted); cursor:pointer; font-size:11px; padding:2px 4px; border-radius:3px;" title="Remove food item" onclick="event.stopPropagation(); deleteMndMealItem('${mKey}', ${itemIdx})">✕</span>
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

        const isInitiallyOpen = hasItems ? 'flex' : 'none';
        const chevronRot = hasItems ? 'rotate(180deg)' : 'rotate(0deg)';

        mealCard.innerHTML = `
          <div class="meal-card-header" onclick="toggleMealAccordion(this)">
            <div style="display:flex; align-items:center; gap:7px;">
              <span class="accordion-chevron" style="transform:${chevronRot}; font-size:10px;">▼</span>
              <strong style="color:#fff; font-size:12.5px; font-weight:700;">${meal.name}</strong>
              <span style="font-size:11px; color:var(--text-muted);">${meal.time ? '• ' + meal.time : ''}</span>
            </div>
            <div style="display:flex; gap:5px; align-items:center;">
              <span class="macro-pill" style="color:var(--primary); font-weight:700; background:rgba(0,229,255,0.12); padding:2px 6px; border-radius:4px; font-size:11px;">${meal.protein}g P</span>
              <span class="macro-pill" style="color:#fff; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; font-size:11px;">${meal.calories} kcal</span>
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
    }

    function toggleMealAccordion(headerEl) {
      const body = headerEl.nextElementSibling;
      const chevron = headerEl.querySelector('.accordion-chevron');
      if (body) {
        if (body.style.display === 'none') {
          body.style.display = 'flex';
          if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
          body.style.display = 'none';
          if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
      }
    }

    function updateMndCoachAdvice(calsLeft, protLeft, carbsLeft, fatsLeft, totalBudget) {
      const el = document.getElementById('mndCoachAdvice');
      if (!el) return;

      const cals = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.calories) || 0;
      const prot = (myNetDiaryData && myNetDiaryData.totals && myNetDiaryData.totals.protein) || 0;
      let advice = '';

      if (cals >= totalBudget && prot >= 200) {
        advice = `<strong>✓ Muscle Protected & Fuel Banked!</strong> You logged <strong>${cals.toLocaleString()} kcal</strong> and <strong>${prot}g protein</strong> today (crushing your 200g anchor by +${prot - 200}g). You've matched your active maintenance expenditure (~2,738 kcal), preserving all 81.1kg of lean muscle without gaining fat. Hydrate well tonight for tomorrow's strength lifting session!`;
      } else if (protLeft > 0) {
        advice = `You have <strong>${calsLeft.toLocaleString()} kcal</strong> and <strong>${protLeft}g of protein</strong> left to reach your daily anchor. Aim for lean protein (chicken breast, egg whites, or 5% mince) to protect muscle while continuing to burn fat toward your 15% goal.`;
      } else {
        advice = `<strong>✓ Protein Goal Reached!</strong> You've locked in your 200g protein anchor to protect all 81.1kg of muscle. You have <strong>${calsLeft.toLocaleString()} kcal</strong> of room remaining today. Keep your evening meal or snack clean and drink plenty of water before tomorrow's strength workout.`;
      }

      el.innerHTML = advice;
    }

    function escapeAuditHtml(str) {
      return String(str || '').replace(/[&<>"']/g, s => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[s]));
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

      if (allItems.length === 0 && cals <= 0) {
        auditEl.innerHTML = `
          <div class="card" style="padding:14px; border-radius:12px; background:var(--surface); border:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <strong style="color:#fff; font-size:12px; letter-spacing:0.05em; text-transform:uppercase;">🧬 Nutritional Quality &amp; Micronutrient Audit</strong>
              <span style="font-size:10.5px; color:var(--text-muted); padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.05);">Awaiting Food Logs</span>
            </div>
            <div style="font-size:11.5px; color:var(--text-secondary); margin-top:8px;">Sync MyNetDiary or log meals to audit healthy fats, whole-food density, tendon micronutrients, and glycemic load.</div>
          </div>
        `;
        return;
      }

      // 1. Healthy Fats, Omega-3 & Hormonal Floor
      const healthyFatRx = /salmon|mackerel|sardine|trout|anchov|egg|avocado|olive oil|extra virgin|walnut|almond|macadamia|chia|flax|peanut butter|almond butter|cheese|steak|beef/i;
      const ultraLowFatRx = /fat free|0%|isolate|breast/i;
      const fatSources = allItems.filter(it => healthyFatRx.test(it.name)).map(it => it.name);
      const ultraLowFatChoices = allItems.filter(it => ultraLowFatRx.test(it.name)).map(it => it.name);

      const safeFTarget = fTarget > 0 ? fTarget : 80;
      const fatPct = Math.round((f / safeFTarget) * 100);
      const fatCalPct = cals > 0 ? Math.round(((f * 9) / cals) * 100) : 0;

      let fatBadgeText, fatBadgeColor, fatBarColor, fatBody;
      if (f < 55) {
        fatBadgeText = `⚠️ LOW FAT FLOOR (${f}g / ${safeFTarget}g • ${fatCalPct}% kcal)`;
        fatBadgeColor = '#f59e0b';
        fatBarColor = 'linear-gradient(90deg, #ef4444, #f59e0b)';
        const lowFatNote = ultraLowFatChoices.length > 0
          ? ` Selecting <strong>${escapeAuditHtml(ultraLowFatChoices.slice(0, 2).join(' + '))}</strong> kept dietary fat low.`
          : '';
        fatBody = `At 98.4kg, dropping below the <strong>60–65g</strong> fat floor restricts testosterone/endocrine synthesis, joint lubrication, and fat-soluble vitamin (A, D, E, K) absorption.${lowFatNote}`;
      } else if (f <= safeFTarget + 15) {
        fatBadgeText = `✅ OPTIMAL LIPID PROFILE (${f}g / ${safeFTarget}g)`;
        fatBadgeColor = '#10b981';
        fatBarColor = 'linear-gradient(90deg, #10b981, #34d399)';
        fatBody = `Dietary fat covers <strong>${fatCalPct}%</strong> of calories (${fatSources.length} lipid source${fatSources.length === 1 ? '' : 's'} detected), supporting endocrine health and joint recovery.`;
      } else {
        fatBadgeText = `⚠️ HIGH FAT LOAD (${f}g / ${safeFTarget}g)`;
        fatBadgeColor = '#f59e0b';
        fatBarColor = 'linear-gradient(90deg, #f59e0b, #f97316)';
        fatBody = `Fat intake sits at <strong>${fatCalPct}%</strong> of daily energy (+${f - safeFTarget}g over target). Trim added oils/cheese slightly to protect your caloric deficit.`;
      }

      // 2. Whole-Food vs. Processed / Bar & Supplement Reliance
      const processedRx = /flap\s*jack|protein bar|cheese bar|\bbar\b|whey|isolate|powder|shake|cookie|brownie|crisp|sweet|candy|chocolate|syrup|sauce|noodle|processed/i;
      const wholeFoodGuardRx = /\b(oats|chicken|salad|yogurt|beef|steak|eggs|fruit|veg)\b/i;

      const processedItems = allItems.filter(it => {
        if (processedRx.test(it.name)) return true;
        if (wholeFoodGuardRx.test(it.name)) return false;
        return false;
      });

      const procCals = processedItems.reduce((sum, it) => sum + it.cals, 0);
      const procProtein = processedItems.reduce((sum, it) => sum + it.p, 0);
      const procCarbs = processedItems.reduce((sum, it) => sum + it.c, 0);
      const procCalPct = cals > 0 ? Math.min(100, Math.round((procCals / cals) * 100)) : 0;
      const wholeCalPct = Math.max(0, 100 - procCalPct);

      let procBadgeText, procBadgeColor, procBarColor, procBody;
      const procNamesPreview = processedItems.map(it => `<strong>${escapeAuditHtml(it.name)}</strong>`).join(' + ');
      const highCarbBar = processedItems.find(it => it.c >= 50);
      if (procCalPct >= 35) {
        procBadgeText = `⚠️ ${procCalPct}% PACKAGED / BARS (${procCals} kcal)`;
        procBadgeColor = '#f59e0b';
        procBarColor = 'linear-gradient(90deg, #f59e0b, #fb923c)';
        procBody = `${procNamesPreview} supply <strong>${procCals} kcal</strong> &amp; <strong>${Math.round(procProtein)}g P</strong> today.${highCarbBar ? ` Watch out for maltitol/glucose syrups, emulsifiers &amp; hidden sugars in ${escapeAuditHtml(highCarbBar.name)} (${highCarbBar.c}g carbs in 1 hit).` : ' Watch out for sugar alcohols, emulsifiers &amp; low micronutrient density.'}`;
      } else if (procCalPct >= 20) {
        procBadgeText = `ℹ️ ${wholeCalPct}% WHOLE FOODS / ${procCalPct}% SUPPLEMENTS`;
        procBadgeColor = '#38bdf8';
        procBarColor = 'linear-gradient(90deg, #38bdf8, #00e5ff)';
        procBody = `<strong>${wholeCalPct}%</strong> of calories come from whole foods (${processedItems.length} packaged/supplement item${processedItems.length === 1 ? '' : 's'}: ${procCals} kcal, ${Math.round(procProtein)}g P). Solid convenience balance.`;
      } else {
        procBadgeText = `✅ ${wholeCalPct}% WHOLE-FOOD DENSITY`;
        procBadgeColor = '#10b981';
        procBarColor = 'linear-gradient(90deg, #10b981, #00e5ff)';
        procBody = `<strong>${wholeCalPct}%</strong> of today's energy comes from minimally processed whole foods (${procCals} kcal from bars/powders), maximizing micronutrient bioavailability.`;
      }

      // 3. Vitamin C, Collagen & Micronutrient Diversity (Fruit / Veg / Citrus / Berries)
      const vitCAnyRx = /berr|blueberr|strawberr|raspberr|blackberr|orange|citrus|lemon|lime|kiwi|pepper|capsicum|broccoli|spinach|kale|tomato|apple|banana|mango|pineapple|fruit|veg|greens|salad/i;
      const vitCPowerRx = /kiwi|berr|blueberr|strawberr|raspberr|blackberr|orange|citrus|pepper|capsicum|broccoli/i;
      const vitCAnyItems = allItems.filter(it => vitCAnyRx.test(it.name));
      const vitCPowerItems = allItems.filter(it => vitCPowerRx.test(it.name));
      const garnishItems = vitCAnyItems.filter(it => !vitCPowerRx.test(it.name));

      const vitCPct = Math.min(100, Math.round((vitCPowerItems.length / 2) * 100));
      let vitCBadgeText, vitCBadgeColor, vitCBarColor, vitCBody;
      if (vitCPowerItems.length === 0) {
        vitCBadgeText = `⚠️ LOW VITAMIN C & POLYPHENOLS`;
        vitCBadgeColor = '#f59e0b';
        vitCBarColor = 'linear-gradient(90deg, #ef4444, #f59e0b)';
        const garnishNote = garnishItems.length > 0
          ? ` Only garnish/mixed salad logged (${escapeAuditHtml(garnishItems.map(x => x.name).join(', '))}).`
          : '';
        vitCBody = `Zero whole fruit, berries, citrus, kiwi, or bell peppers logged today.${garnishNote} Vitamin C (50–200mg) is a mandatory cofactor for pro-collagen synthesis in your Achilles &amp; patellar tendons after skipping (2,185 jumps) and heavy KB swings, and boosts non-heme iron absorption from Jumbo Oats.`;
      } else if (vitCPowerItems.length === 1) {
        vitCBadgeText = `ℹ️ MODERATE MICRONUTRIENTS (1 source)`;
        vitCBadgeColor = '#38bdf8';
        vitCBarColor = 'linear-gradient(90deg, #38bdf8, #00e5ff)';
        vitCBody = `1 high-Vitamin-C source logged (<strong>${escapeAuditHtml(vitCPowerItems[0].name)}</strong>). Add a second berry or citrus serving to maximize tendon collagen repair &amp; antioxidant recovery.`;
      } else {
        vitCBadgeText = `✅ HIGH VITAMIN C & ANTIOXIDANTS`;
        vitCBadgeColor = '#10b981';
        vitCBarColor = 'linear-gradient(90deg, #10b981, #34d399)';
        vitCBody = `${vitCPowerItems.length} Vitamin-C &amp; polyphenol powerhouses logged (${escapeAuditHtml(vitCPowerItems.map(x => x.name).slice(0, 3).join(', '))}), driving collagen cross-linking and post-training oxidative recovery.`;
      }

      // 4. Refined Sugar, Glycemic Load & Gut Fiber
      const loggedSugar = Number(totals && (totals.sugar_g !== undefined ? totals.sugar_g : totals.sugar)) || 0;
      const sweetCarbRx = /flap\s*jack|brownie|snickers|sweet|chocolate|sugar|honey|syrup|jam|yogurt/i;
      const estSweetCarbs = allItems
        .filter(it => sweetCarbRx.test(it.name))
        .reduce((sum, it) => sum + Math.round(it.c * (/yogurt/i.test(it.name) ? 0.55 : 0.45)), 0);
      const effectiveSugar = loggedSugar > 0 ? Math.round(loggedSugar) : estSweetCarbs;
      const sugarLabel = loggedSugar > 0 ? `${effectiveSugar}g logged` : `~${effectiveSugar}g est.`;
      const maxSingleCarbItem = allItems.reduce((best, it) => (!best || it.c > best.c ? it : best), null);
      const bigProcessedCarbHit = allItems.find(it => processedRx.test(it.name) && it.c >= 50) || (maxSingleCarbItem && maxSingleCarbItem.c >= 80 && processedRx.test(maxSingleCarbItem.name) ? maxSingleCarbItem : null);

      const fiberPct = Math.min(100, Math.round((fiber / 35) * 100));
      let glyBadgeText, glyBadgeColor, glyBarColor, glyBody;
      if (bigProcessedCarbHit) {
        glyBadgeText = fiber >= 30 ? `⚠️ HIGH-GI HIT • ${fiber}g FIBER` : `⚠️ HIGH GLYCEMIC SPIKE`;
        glyBadgeColor = '#f59e0b';
        glyBarColor = 'linear-gradient(90deg, #10b981, #f59e0b)';
        glyBody = `Gut fiber is strong at <strong>${fiber}g</strong> (vs 30–40g target), but <strong>${escapeAuditHtml(bigProcessedCarbHit.name)}</strong> delivers <strong>${bigProcessedCarbHit.c}g carbs</strong> in a single processed hit (sugar load ${sugarLabel}), driving a sharper insulin/glycemic spike.`;
      } else if (fiber >= 30) {
        glyBadgeText = `✅ GUT FIBER ${fiber}g • STEADY GL`;
        glyBadgeColor = '#10b981';
        glyBarColor = 'linear-gradient(90deg, #10b981, #00e5ff)';
        glyBody = `<strong>${fiber}g dietary fiber</strong> hits the 30–40g microbiome target while estimated sugar stays controlled (${sugarLabel}), blunting glycemic spikes.`;
      } else {
        glyBadgeText = `⚠️ LOW FIBER (${fiber}g / 30g+)`;
        glyBadgeColor = '#f59e0b';
        glyBarColor = 'linear-gradient(90deg, #ef4444, #f59e0b)';
        glyBody = `Only <strong>${fiber}g fiber</strong> logged so far (sugar ${sugarLabel}). Add oats, chia/flax, berries, or fibrous greens to hit 30–40g for gut motility and satiety.`;
      }

      // Smart Food Additions & Swaps for Next Shop / Tomorrow
      const fatDeficit = Math.max(0, 75 - f);
      const hasFatFreeYogurt = allItems.some(it => /fat free.*yogurt|0%.*yogurt|greek yogurt/i.test(it.name));
      const hasSalad = allItems.some(it => /salad|tikka/i.test(it.name));
      const hasOats = allItems.some(it => /oats/i.test(it.name));
      const flapjackItem = allItems.find(it => /flap\s*jack|brownie|protein bar/i.test(it.name));

      const rec1 = fatDeficit > 0
        ? `<strong>1. Fix the Fat &amp; Omega-3 Gap (+${fatDeficit}g Fat needed):</strong> ${hasFatFreeYogurt ? 'Swap <code>Fat Free Greek Yogurt</code> for <strong>5% Greek Yogurt</strong>, or add' : 'Add'} <strong>2–3 whole eggs / ½ avocado / 25g walnuts or pumpkin seeds / 1 tbsp extra-virgin olive oil</strong>${hasSalad ? ' to your Chicken Tikka Salad' : ''}, or have <strong>salmon/mackerel</strong> 2x/week for EPA/DHA joint recovery.`
        : `<strong>1. Maintain Omega-3 Lipid Quality:</strong> Fat target is covered (<strong>${f}g</strong>). Prioritize wild <strong>salmon/mackerel</strong>, walnuts, and extra-virgin olive oil to keep inflammation low.`;

      const rec2 = vitCPowerItems.length < 2
        ? `<strong>2. Add a Vitamin C &amp; Berry/Citrus Hit for Tendon Collagen:</strong> Add <strong>80g blueberries/strawberries</strong> into your${hasOats ? ' morning <strong>Jumbo Oats</strong> or Greek Yogurt' : ' breakfast'}, or eat <strong>1 kiwi / 1 orange / sliced red bell peppers</strong> with lunch. This directly fuels tendon collagen repair after skipping &amp; kettlebells.`
        : `<strong>2. Keep Micronutrient Variety High:</strong> Great Vitamin C &amp; polyphenol coverage today — rotate colourful berries, kiwi, and bell peppers to sustain tendon collagen turnover.`;

      const rec3 = flapjackItem
        ? `<strong>3. Upgrade the Flapjack / Bar Slot (${flapjackItem.c}g C in ${escapeAuditHtml(flapjackItem.name)}):</strong> You got <strong>${Math.round(procProtein)}g</strong> protein (<strong>${procCalPct}%</strong> of calories) from ${processedItems.length} bars/powders today. Keep the <code>Whey Isolate</code> post-workout, but consider swapping <code>${escapeAuditHtml(flapjackItem.name)} (${flapjackItem.cals} kcal, ${flapjackItem.c}g C)</code> for <strong>1 banana + 20g dark chocolate (85%) or 30g mixed nuts + cottage cheese/biltong</strong> to cut emulsifiers and sugar alcohols.`
        : (processedItems.length >= 2
          ? `<strong>3. Reduce Supplement &amp; Bar Reliance (${procCalPct}% kcal):</strong> Replace 1 processed bar/powder slot with <strong>cottage cheese, biltong, or whole eggs + fruit</strong> to boost micronutrients and lower emulsifier load.`
          : `<strong>3. Whole-Food Density Locked In (${wholeCalPct}%):</strong> Minimal reliance on packaged bars today. Keep evening nutrition anchored on lean whole-food protein + fibrous veg.`);

      auditEl.innerHTML = `
        <div class="card" style="padding:14px; border-radius:14px; background:linear-gradient(165deg, rgba(12,18,30,0.96), rgba(8,12,20,0.98)); border:1px solid rgba(0,229,255,0.28); box-shadow:0 8px 24px rgba(0,0,0,0.35);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:7px;">
              <span style="font-size:15px;">🧬</span>
              <strong style="color:#fff; font-size:12px; text-transform:uppercase; letter-spacing:0.06em; font-weight:800;">NUTRITIONAL QUALITY &amp; MICRONUTRIENT AUDIT</strong>
            </div>
            <span style="font-size:10.5px; font-weight:800; color:var(--primary); background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.35); padding:3px 9px; border-radius:999px; letter-spacing:0.02em;">
              Whole-Food Score: ${wholeCalPct}% • Fat Floor: ${f}g/${safeFTarget}g
            </span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:10px;">
            <!-- Pillar 1: Healthy Fats & Omega-3s -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:11px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:10.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">1. Healthy Fats &amp; Omega-3s</span>
                <span style="font-size:10px; font-weight:800; color:${fatBadgeColor}; background:rgba(255,255,255,0.05); border:1px solid ${fatBadgeColor}55; padding:2px 7px; border-radius:6px;">${fatBadgeText}</span>
              </div>
              <div style="height:5px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden; margin-bottom:7px;">
                <div style="width:${Math.min(100, fatPct)}%; height:100%; background:${fatBarColor};"></div>
              </div>
              <div style="font-size:11.5px; color:var(--text-secondary); line-height:1.45;">${fatBody}</div>
            </div>

            <!-- Pillar 2: Whole Food vs. Processed/Bars -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:11px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:10.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">2. Whole Food vs. Bars</span>
                <span style="font-size:10px; font-weight:800; color:${procBadgeColor}; background:rgba(255,255,255,0.05); border:1px solid ${procBadgeColor}55; padding:2px 7px; border-radius:6px;">${procBadgeText}</span>
              </div>
              <div style="height:5px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden; margin-bottom:7px;">
                <div style="width:${wholeCalPct}%; height:100%; background:${procBarColor};"></div>
              </div>
              <div style="font-size:11.5px; color:var(--text-secondary); line-height:1.45;">${procBody}</div>
            </div>

            <!-- Pillar 3: Vitamin C & Tendon Micronutrients -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:11px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:10.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">3. Vitamin C &amp; Tendon Repair</span>
                <span style="font-size:10px; font-weight:800; color:${vitCBadgeColor}; background:rgba(255,255,255,0.05); border:1px solid ${vitCBadgeColor}55; padding:2px 7px; border-radius:6px;">${vitCBadgeText}</span>
              </div>
              <div style="height:5px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden; margin-bottom:7px;">
                <div style="width:${Math.max(10, vitCPct)}%; height:100%; background:${vitCBarColor};"></div>
              </div>
              <div style="font-size:11.5px; color:var(--text-secondary); line-height:1.45;">${vitCBody}</div>
            </div>

            <!-- Pillar 4: Fiber & Glycemic Load -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:11px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:10.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">4. Fiber &amp; Glycemic Load</span>
                <span style="font-size:10px; font-weight:800; color:${glyBadgeColor}; background:rgba(255,255,255,0.05); border:1px solid ${glyBadgeColor}55; padding:2px 7px; border-radius:6px;">${glyBadgeText}</span>
              </div>
              <div style="height:5px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden; margin-bottom:7px;">
                <div style="width:${fiberPct}%; height:100%; background:${glyBarColor};"></div>
              </div>
              <div style="font-size:11.5px; color:var(--text-secondary); line-height:1.45;">${glyBody}</div>
            </div>
          </div>

          <div style="margin-top:12px; padding:11px 12px; border-radius:10px; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.2);">
            <div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:7px;">
              🛒 Smart Food Additions &amp; Swaps for Your Next Shop / Tomorrow
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:11.5px; color:var(--text-secondary); line-height:1.45;">
              <div>${rec1}</div>
              <div>${rec2}</div>
              <div>${rec3}</div>
            </div>
          </div>
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
      const savedUser = localStorage.getItem('pulse_mnd_user') || 'greg.putt@gmail.com';
      if (loginUser && !loginUser.value) {
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
      const t = (myNetDiaryData && myNetDiaryData.totals) ? myNetDiaryData.totals : { calories: 824, protein: 49 };
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
          panelText.innerHTML = `🟢 Connected as <strong style="color:var(--primary);">${userLabel}</strong> • ${calsStr} kcal Synced`;
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
      const savedUser = localStorage.getItem('pulse_mnd_user') || 'greg.putt@gmail.com';
      const loginUser = document.getElementById('mndLoginUser');
      if (loginUser && savedUser && !loginUser.value) {
        loginUser.value = savedUser;
      }

      updateMndStatusBadgesUI(savedUser || 'GREG.PUTT', Boolean(savedUser));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2200);
        const res = await fetch('/api/mnd/status', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return;
        const data = await res.json();

        if (data.configured || data.has_cached_session) {
          const u = data.username || savedUser || 'greg.putt@gmail.com';
          localStorage.setItem('pulse_mnd_user', u);
          updateMndStatusBadgesUI(u, true);
          if (loginUser && u) loginUser.value = u;
        }
      } catch(e) {
        // Offline / local mode: local status already applied
      }
    }

    async function submitMndLogin() {
      const user = document.getElementById('mndLoginUser')?.value.trim() || 'greg.putt@gmail.com';
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch('/api/mnd/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: user, password: pass }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok || res.status === 404) {
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
          if (msg) msg.innerHTML = `<span style="color:var(--amber); font-weight:700;">⚠️ ${err}</span>`;
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
          water: parseFloat(totals.water !== undefined ? totals.water : totals.water_l) || 0.0
        };
      }

      const meals = data.meals || (raw.state && raw.state.mnd_meals);
      if (meals && typeof meals === 'object') {
        myNetDiaryData.meals = meals;
      }

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      const savedUser = localStorage.getItem('pulse_mnd_user') || 'greg.putt@gmail.com';
      updateMndStatusBadgesUI(savedUser, true);
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch('/api/mnd/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok || res.status === 404) {
          throw new Error('Cloud backend offline');
        }

        const data = await res.json();

        if (data.status === 'auth_needed' || data.requires_auth) {
          const syncMod = document.getElementById('syncModal');
          if (syncMod) syncMod.classList.remove('open');
          initMyNetDiaryEngine();
          openMndSyncModal();
          showToast('✓ Today\'s Synced Log Loaded • Tap "☁️ Cloud Account" to link live login');
          beep(720, 0.12);
        } else if (data.status === 'success' || data.success) {
          const payload = data.totals ? data : (data.data || data.sync_data || data);
          applyMndSyncData(payload);
          checkMndStatus();
          closeSyncModal();
          beep(880, 0.2);
          const t = payload.totals || {};
          const cals = t.calories || 0;
          const prot = t.protein || 0;
          const mealCount = Object.keys(payload.meals || {}).length;
          speak(`MyNetDiary synchronized. ${cals} calories, ${prot} grams protein across ${mealCount} meal blocks.`);
          showToast(`✓ Ingested: ${cals} kcal • ${prot}g P • ${mealCount} meals`);
        } else {
          const syncMod = document.getElementById('syncModal');
          if (syncMod) syncMod.classList.remove('open');
          openMndSyncModal();
          showToast(`✓ Loaded Synced Totals (${myNetDiaryData.totals.calories} kcal • ${myNetDiaryData.totals.protein}g P)`);
        }
      } catch(e) {
        // Fallback: re-synchronize local/master MyNetDiary data
        const syncMod = document.getElementById('syncModal');
        if (syncMod) syncMod.classList.remove('open');
        initMyNetDiaryEngine();
        renderMyNetDiaryEngine();
        const savedUser = localStorage.getItem('pulse_mnd_user') || 'greg.putt@gmail.com';
        updateMndStatusBadgesUI(savedUser, true);
        beep(880, 0.2);
        const cals = myNetDiaryData.totals.calories || 824;
        const prot = myNetDiaryData.totals.protein || 49;
        speak(`MyNetDiary synchronized. ${cals} calories and ${prot} grams protein active.`);
        showToast(`✓ Synced from MyNetDiary: ${cals.toLocaleString()} kcal • ${prot}g P`);
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
      await triggerGarminCloudSync();
      await triggerMndAutoPull();
      showToast('✓ Dual-Sync complete! Garmin & MyNetDiary updated.');
    }

    function openMndSyncModal() {
      const syncMod = document.getElementById('syncModal');
      if (syncMod) syncMod.classList.remove('open');
      const connMod = document.getElementById('mndConnectModal');
      if (connMod) connMod.classList.remove('open');

      const t = (myNetDiaryData && myNetDiaryData.totals) ? myNetDiaryData.totals : {};
      const elCals = document.getElementById('mndInputCals'); if (elCals) elCals.value = t.calories ?? 824;
      const elProt = document.getElementById('mndInputProtein'); if (elProt) elProt.value = t.protein ?? 49;
      const elCarbs = document.getElementById('mndInputCarbs'); if (elCarbs) elCarbs.value = t.carbs ?? 115;
      const elFat = document.getElementById('mndInputFat'); if (elFat) elFat.value = t.fat ?? 23;
      const elFiber = document.getElementById('mndInputFiber'); if (elFiber) elFiber.value = t.fiber ?? 19;
      const elSodium = document.getElementById('mndInputSodium'); if (elSodium) elSodium.value = t.sodium ?? 275;
      const elWater = document.getElementById('mndInputWater'); if (elWater) elWater.value = t.water ?? 0.0;
      const elPaste = document.getElementById('mndPasteInput'); if (elPaste) elPaste.value = '';

      const bannerText = document.getElementById('mndBannerSummaryText');
      if (bannerText) {
        bannerText.innerText = `${(t.calories ?? 824).toLocaleString()} kcal • ${t.protein ?? 49}g P • ${(t.water ?? 0.0)}L Water`;
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

    function saveMndSyncTotals() {
      const cals = parseInt(document.getElementById('mndInputCals')?.value) || 0;
      const prot = parseInt(document.getElementById('mndInputProtein')?.value) || 0;
      const carbs = parseInt(document.getElementById('mndInputCarbs')?.value) || 0;
      const fat = parseInt(document.getElementById('mndInputFat')?.value) || 0;
      const fiber = parseInt(document.getElementById('mndInputFiber')?.value) || 0;
      const sodium = parseInt(document.getElementById('mndInputSodium')?.value) || 0;
      const water = parseFloat(document.getElementById('mndInputWater')?.value) || 0.0;

      myNetDiaryData.totals = {
        calories: cals,
        protein: prot,
        carbs: carbs,
        fat: fat,
        fiber: fiber,
        sodium: sodium,
        water: water
      };

      saveMndToLocalStorage();
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

      const calsMatch = txt.match(/(?:cals?|calories?|energy)\s*[:=]?\s*([0-9,]+)/i);
      const protMatch = txt.match(/(?:protein|prot|p)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const carbsMatch = txt.match(/(?:carbs?|carbohydrates?|c)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const fatMatch = txt.match(/(?:fats?|fat|f)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const fiberMatch = txt.match(/(?:fiber|fibre)\s*[:=]?\s*([0-9,]+)\s*g?/i);
      const sodiumMatch = txt.match(/(?:sodium|salt)\s*[:=]?\s*([0-9,]+)\s*(?:mg)?/i);
      const waterMatch = txt.match(/(?:water|fluid)\s*[:=]?\s*([0-9.]+)\s*(?:l|litres?)?/i);

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

    function openMndLogModal() {
      const n = document.getElementById('mndItemName'); if (n) n.value = '';
      const c = document.getElementById('mndItemCals'); if (c) c.value = '';
      const p = document.getElementById('mndItemProtein'); if (p) p.value = '';
      const cb = document.getElementById('mndItemCarbs'); if (cb) cb.value = '';
      const f = document.getElementById('mndItemFat'); if (f) f.value = '';

      const modal = document.getElementById('mndLogModal');
      if (modal) modal.classList.add('open');
      beep(600, 0.05);
    }

    function closeMndLogModal() {
      const modal = document.getElementById('mndLogModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
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

      if (!myNetDiaryData.meals) myNetDiaryData.meals = {};
      if (!myNetDiaryData.meals[cat]) {
        myNetDiaryData.meals[cat] = { name: cat, time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), calories: 0, protein: 0, carbs: 0, fat: 0, items: [] };
      }

      myNetDiaryData.meals[cat].items.push({ name, cals, p: prot, c: carbs, f: fat });
      myNetDiaryData.meals[cat].calories += cals;
      myNetDiaryData.meals[cat].protein += prot;
      myNetDiaryData.meals[cat].carbs += carbs;
      myNetDiaryData.meals[cat].fat += fat;

      myNetDiaryData.totals.calories += cals;
      myNetDiaryData.totals.protein += prot;
      myNetDiaryData.totals.carbs += carbs;
      myNetDiaryData.totals.fat += fat;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      closeMndLogModal();

      beep(880, 0.15);
      speak(`Logged ${name} to ${cat}. ${prot} grams of protein recorded.`);
      showToast(`✓ Logged ${name} to ${cat.toUpperCase()}`);
    }

    function deleteMndMealItem(mealKey, itemIdx) {
      const meal = myNetDiaryData.meals && myNetDiaryData.meals[mealKey];
      if (!meal || !meal.items || !meal.items[itemIdx]) return;

      const item = meal.items[itemIdx];
      meal.calories = Math.max(0, meal.calories - item.cals);
      meal.protein = Math.max(0, meal.protein - item.p);
      meal.carbs = Math.max(0, meal.carbs - item.c);
      meal.fat = Math.max(0, meal.fat - item.f);

      myNetDiaryData.totals.calories = Math.max(0, myNetDiaryData.totals.calories - item.cals);
      myNetDiaryData.totals.protein = Math.max(0, myNetDiaryData.totals.protein - item.p);
      myNetDiaryData.totals.carbs = Math.max(0, myNetDiaryData.totals.carbs - item.c);
      myNetDiaryData.totals.fat = Math.max(0, myNetDiaryData.totals.fat - item.f);

      meal.items.splice(itemIdx, 1);

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();

      beep(500, 0.05);
      showToast(`Removed ${item.name}`);
    }

    // ==================== PERSISTENCE & LOCALSTORAGE ====================
    function saveMndToLocalStorage() {
      try {
        localStorage.setItem('pulse_mnd_data', JSON.stringify(myNetDiaryData));
      } catch(e) {}
    }

    function restoreMndFromLocalStorage() {
      try {
        const CURRENT_MND_VERSION = "v5.23_nov17_audit";
        if (localStorage.getItem('pulse_mnd_version') !== CURRENT_MND_VERSION) {
          localStorage.removeItem('pulse_mnd_data');
          localStorage.setItem('pulse_mnd_version', CURRENT_MND_VERSION);
          saveMndToLocalStorage();
          return;
        }
        const raw = localStorage.getItem('pulse_mnd_data');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.totals && parsed.meals) {
            myNetDiaryData = parsed;
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

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();

      try {
        await fetch('/api/hydration/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount_ml: amountMl })
        });
      } catch(e) {
        console.warn('Hydration offline log sync notice:', e);
      }

      showToast(`✓ +${amountMl}ml Hydration Logged`);
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

      const carbs = 0;
      const fat = Math.max(0, Math.round((cals - prot * 4) / 9));

      if (!myNetDiaryData.meals) myNetDiaryData.meals = {};
      if (!myNetDiaryData.meals.snacks) {
        myNetDiaryData.meals.snacks = {
          name: 'Snacks & Hydration',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          items: []
        };
      }
      if (!Array.isArray(myNetDiaryData.meals.snacks.items)) {
        myNetDiaryData.meals.snacks.items = [];
      }

      myNetDiaryData.meals.snacks.items.push({
        name: desc,
        cals: cals,
        p: prot,
        c: carbs,
        f: fat
      });

      myNetDiaryData.meals.snacks.calories = (myNetDiaryData.meals.snacks.calories || 0) + cals;
      myNetDiaryData.meals.snacks.protein = (myNetDiaryData.meals.snacks.protein || 0) + prot;
      myNetDiaryData.meals.snacks.carbs = (myNetDiaryData.meals.snacks.carbs || 0) + carbs;
      myNetDiaryData.meals.snacks.fat = (myNetDiaryData.meals.snacks.fat || 0) + fat;

      if (!myNetDiaryData.totals) {
        myNetDiaryData.totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, water: 0.0 };
      }
      myNetDiaryData.totals.calories = (myNetDiaryData.totals.calories || 0) + cals;
      myNetDiaryData.totals.protein = (myNetDiaryData.totals.protein || 0) + prot;
      myNetDiaryData.totals.carbs = (myNetDiaryData.totals.carbs || 0) + carbs;
      myNetDiaryData.totals.fat = (myNetDiaryData.totals.fat || 0) + fat;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
      closeQuickLogModal();

      if (typeof showToast === 'function') {
        showToast(`✓ Quick logged ${cals} kcal • ${prot}g P`);
      }
    }

    function selectDietStrategy(key) {
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
    }

    function setCarbCycleLevel(level) {
      currentCarbCycleLevel = level;
      const levelBtns = {
        'high': 'btnCcHigh',
        'mod': 'btnCcMod',
        'low': 'btnCcLow'
      };
      Object.entries(levelBtns).forEach(([k, btnId]) => {
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.toggle('active', k === level);
      });

      if (!myNetDiaryData.targets) {
        myNetDiaryData.targets = {
          calories: athleteDailyBudget || 2437,
          protein: athleteProteinAnchor || 200,
          carbs: 251,
          fat: 80
        };
      }

      const carbMap = { high: 300, mod: 200, low: 80 };
      myNetDiaryData.targets.carbs = carbMap[level] !== undefined ? carbMap[level] : 200;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();
    }

    function updateFastingTimerDisplay() {
      const d = document.getElementById('fastingTimerDisplay');
      if (d) {
        const h = Math.floor(fastingTimerSeconds / 3600);
        const m = Math.floor((fastingTimerSeconds % 3600) / 60);
        d.innerText = `${h}h ${m}m`;
      }
      const btn = document.getElementById('btnToggleFastTimer');
      if (btn) btn.innerText = fastingTimerRunning ? 'Running' : 'Paused';
    }

    function toggleFastingTimer() {
      fastingTimerRunning = !fastingTimerRunning;
      if (fastingTimerRunning) {
        if (!fastingTimerInterval) {
          fastingTimerInterval = setInterval(() => {
            fastingTimerSeconds++;
            updateFastingTimerDisplay();
          }, 1000);
        }
      } else {
        if (fastingTimerInterval) {
          clearInterval(fastingTimerInterval);
          fastingTimerInterval = null;
        }
      }
      updateFastingTimerDisplay();
    }

    function resetFastingTimer() {
      fastingTimerSeconds = 0;
      updateFastingTimerDisplay();
    }

    function updateProDial() {
      const pSlider = document.getElementById('sliderProtein');
      const fSlider = document.getElementById('sliderFat');
      const prot = parseInt(pSlider ? pSlider.value : 200) || 200;
      const fatPct = parseInt(fSlider ? fSlider.value : 30) || 30;
      const cals = (myNetDiaryData.targets && myNetDiaryData.targets.calories) || athleteDailyBudget || 2437;

      const protValEl = document.getElementById('sliderValProtein');
      const fatValEl = document.getElementById('sliderValFat');
      const dialCalsEl = document.getElementById('proDialCals');
      const carbsValEl = document.getElementById('sliderValCarbs');

      if (protValEl) protValEl.innerText = `${prot}g`;
      if (fatValEl) fatValEl.innerText = `${fatPct}%`;
      if (dialCalsEl) dialCalsEl.innerText = `${cals.toLocaleString()} kcal`;

      const carbs = Math.max(20, Math.round((cals - prot * 4 - cals * (fatPct / 100)) / 4));
      if (carbsValEl) carbsValEl.innerText = `${carbs}g`;
    }

    function applyCustomProDial() {
      const pSlider = document.getElementById('sliderProtein');
      const fSlider = document.getElementById('sliderFat');
      const prot = parseInt(pSlider ? pSlider.value : 200) || 200;
      const fatPct = parseInt(fSlider ? fSlider.value : 30) || 30;
      const cals = (myNetDiaryData.targets && myNetDiaryData.targets.calories) || athleteDailyBudget || 2437;
      const carbs = Math.max(20, Math.round((cals - prot * 4 - cals * (fatPct / 100)) / 4));
      const fatGrams = Math.max(20, Math.round((cals * (fatPct / 100)) / 9));

      if (!myNetDiaryData.targets) myNetDiaryData.targets = {};
      myNetDiaryData.targets.calories = cals;
      myNetDiaryData.targets.protein = prot;
      myNetDiaryData.targets.carbs = carbs;
      myNetDiaryData.targets.fat = fatGrams;
      athleteProteinAnchor = prot;

      saveMndToLocalStorage();
      renderMyNetDiaryEngine();

      if (typeof showToast === 'function') {
        showToast(`✓ Targets Updated: ${prot}g P • ${carbs}g C • ${fatGrams}g F`);
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


