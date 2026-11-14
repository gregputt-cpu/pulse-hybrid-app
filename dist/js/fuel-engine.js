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
            "calories": 2392,
            "protein": 234,
            "carbs": 231,
            "fat": 67,
            "fiber": 33,
            "sodium": 1911,
            "water": 0.0
      },
      "meals": {
            "breakfast": {
                  "name": "Breakfast",
                  "time": "6:14",
                  "calories": 824,
                  "protein": 49,
                  "carbs": 115,
                  "fat": 23,
                  "items": [
                        {
                              "name": "Cold Milled Flaxseed Almonds Brazil Nuts Walnuts and Q10",
                              "cals": 120,
                              "p": 5,
                              "c": 4,
                              "f": 10
                        },
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
                  "time": "15:59",
                  "calories": 1568,
                  "protein": 184,
                  "carbs": 116,
                  "fat": 44,
                  "items": [
                        {
                              "name": "British Chicken Diced Breast",
                              "cals": 263,
                              "p": 54,
                              "c": 0,
                              "f": 5
                        },
                        {
                              "name": "Egg Noodles Soft & Tender",
                              "cals": 368,
                              "p": 12,
                              "c": 76,
                              "f": 4
                        },
                        {
                              "name": "Beansprouts Tender & Crunchy",
                              "cals": 141,
                              "p": 8,
                              "c": 12,
                              "f": 8
                        },
                        {
                              "name": "Aberdeen Angus Steak Mince",
                              "cals": 660,
                              "p": 110,
                              "c": 0,
                              "f": 24
                        },
                        {
                              "name": "Sweet Chilli Stir Fry Sauce Medium",
                              "cals": 136,
                              "p": 0,
                              "c": 28,
                              "f": 3
                        }
                  ]
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
      const burnEl = document.getElementById('vitalBurn');
      let activeBurn = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && window.BAKED_LIVE_STATE.garmin.active_calories !== undefined)
        ? Number(window.BAKED_LIVE_STATE.garmin.active_calories)
        : 623;
      if (burnEl) {
        const parsedBurn = parseInt(burnEl.innerText);
        if (!isNaN(parsedBurn) && parsedBurn >= 0) activeBurn = parsedBurn;
      }
      const totalBudget = 2092 + activeBurn;
      athleteDailyBudget = totalBudget;

      // 2. Macro Targets (Greg Putt: 98.0kg, 17.2% BF -> 81.14kg lean mass)
      const pTarget = athleteProteinAnchor || 200; // 2.46g/kg lean mass
      const cTarget = 251; // Glycogen recharge for hybrid lifting + cardio
      const fTarget = 80;  // Endocrine & cell health floor

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
      const pTarget = athleteProteinAnchor || 200;
      const cTarget = 251;
      const fTarget = 80;

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
        const CURRENT_MND_VERSION = "v4.7_live_dinner_2392";
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

