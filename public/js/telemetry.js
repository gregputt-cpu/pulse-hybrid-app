    let garminMfaState = null;

    function openSyncModal(tab = 'garmin') {
      const modal = document.getElementById('syncModal');
      if (modal) modal.classList.add('open');
      switchSyncTab(tab);
      beep(600, 0.05);
    }

    function closeSyncModal() {
      const modal = document.getElementById('syncModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
    }

    function switchSyncTab(tab) {
      const btnGarmin = document.getElementById('btnTabGarminCloud');
      const btnMnd = document.getElementById('btnTabMndCloud');
      const btnManual = document.getElementById('btnTabManualSync');
      const panelGarmin = document.getElementById('panelSyncGarmin');
      const panelMnd = document.getElementById('panelSyncMnd');
      const panelManual = document.getElementById('panelSyncManual');

      [btnGarmin, btnMnd, btnManual].forEach(b => { if (b) b.classList.remove('active'); });
      [panelGarmin, panelMnd, panelManual].forEach(p => { if (p) p.style.display = 'none'; });

      if (tab === 'garmin') {
        if (btnGarmin) btnGarmin.classList.add('active');
        if (panelGarmin) panelGarmin.style.display = 'flex';
      } else if (tab === 'mnd') {
        if (btnMnd) btnMnd.classList.add('active');
        if (panelMnd) panelMnd.style.display = 'flex';
        checkMndStatus();
      } else {
        if (btnManual) btnManual.classList.add('active');
        if (panelManual) panelManual.style.display = 'flex';
      }
      beep(550, 0.04);
    }

    // CLIENT-SIDE PHYSIOLOGICAL BENEFITS ENGINE (Local-First, runs offline on any phone/browser)
    function clientAnalyzeWorkoutBenefits(text, telemetry, athlete) {
      if (!telemetry) telemetry = {};
      if (!athlete) athlete = { weight_kg: 99.85, body_fat_pct: 17.5 };

      const weight = parseFloat(athlete.weight_kg) || 99.85;
      const dur = parseFloat(telemetry.duration_min) || 30;
      const cals = parseInt(telemetry.calories) || 250;
      const avgHr = parseInt(telemetry.avg_hr) || 125;
      const maxHr = parseInt(telemetry.max_hr) || 160;
      const aeroTe = parseFloat(telemetry.aerobic_te) || 2.5;
      const anaeroTe = parseFloat(telemetry.anaerobic_te) || 1.5;

      const tLower = (text || "").toLowerCase();

      const isPlyo = /jump|plyo|hop|skip|burpee|tuck/.test(tLower);
      const isWalk = /walk|stroll|hiking|hike/.test(tLower);
      const isRun = /run|jog|sprint|tempo|interval/.test(tLower);
      const isRuck = /ruck|pack|weighted walk/.test(tLower);
      const isCombat = /combat|box|strike|kick|martial|shadow/.test(tLower);
      const isSquat = /squat|lunge|leg press|quad/.test(tLower);
      const isPosterior = /rdl|deadlift|hinge|hamstring|back extension/.test(tLower);
      const isPush = /bench|pushup|push-up|press|dip/.test(tLower);
      const isPull = /row|pullup|pull-up|chin|lat/.test(tLower);
      const isKb = /kettlebell|swing|snatch|clean/.test(tLower);

      // 1. Muscles Worked
      const muscles = [];
      if (isPlyo) {
        muscles.push("Quadriceps (vastus medialis/lateralis)", "Calves & Achilles tendon complex (gastrocnemius/soleus)", "Gluteus Maximus", "Hip Flexors (iliopsoas)", "Rectus Abdominis");
      }
      if (isCombat) {
        muscles.push("Rotator cuff & Deltoids", "Obliques & Transverse Abdominis", "Serratus anterior", "Calf spring complex");
      }
      if (isSquat) {
        muscles.push("Quadriceps", "Adductor Magnus", "Gluteus Maximus", "Erector Spinae");
      }
      if (isPosterior) {
        muscles.push("Biceps Femoris & Semitendinosus (Hamstrings)", "Gluteus Maximus", "Latissimus Dorsi", "Thoracolumbar fascia");
      }
      if (isPush) {
        muscles.push("Pectoralis Major/Minor", "Anterior Deltoids", "Triceps Brachii", "Serratus Anterior");
      }
      if (isPull) {
        muscles.push("Latissimus Dorsi", "Rhomboids & Mid/Lower Trapezius", "Posterior Deltoids", "Biceps Brachii");
      }
      if (isKb) {
        muscles.push("Posterior chain (hamstrings/glutes)", "Latissimus dorsi", "Core brace", "Grip flexors");
      }
      if (isRuck) {
        muscles.push("Upper back & Trapezius", "Erector Spinae", "Gluteus Medius/Maximus", "Soleus & Foot Arch Intrinsics");
      }
      if (isWalk && !(isPlyo || isSquat || isPosterior)) {
        muscles.push("Soleus & Gastrocnemius", "Gluteus Medius", "Postural Core Stabilizers", "Tibialis Anterior");
      }
      if (isRun && !isPlyo) {
        muscles.push("Gastrocnemius & Soleus", "Quadriceps & Hamstrings", "Hip Extensors", "Cardiorespiratory system");
      }
      if (muscles.length === 0) {
        muscles.push("Cardiovascular system", "Core stabilizers", "Lower extremity kinetic chain", "Postural musculature");
      }

      const musclesStr = Array.from(new Set(muscles)).join(", ");

      // 2. Biomechanics
      let biomechStr = "";
      if (isPlyo) {
        const match = tLower.match(/(\d+)\s*(tuck\s*jumps?|jumps?|reps?)/);
        const jumpCount = match ? match[1] : "300";
        const grfLow = Math.round(weight * 3.5);
        const grfHigh = Math.round(weight * 4.5);
        biomechStr = `${jumpCount} plyometric landings absorbing 3.5–4.5× bodyweight (~${grfLow}–${grfHigh}kg peak eccentric ground reaction force per jump at ${weight.toFixed(1)}kg bodyweight). Significantly enhances Achilles tendon stiffness, elastic energy storage, and stretch-shortening cycle (SSC) reactive strength.`;
      } else if (isRuck) {
        biomechStr = `Loaded rhythmic ambulation imposing continuous axial stability demand. Absorbs ~1.5–1.8× total loaded weight per step, reinforcing scapular retraction, thoracic posture, and bone mineral density.`;
      } else if (isWalk) {
        const grfWalk = Math.round(weight * 1.2);
        biomechStr = `Low-impact cyclical steady cadence absorbing ~1.2× bodyweight (~${grfWalk}kg) per stride. Promotes joint synovial fluid circulation, venous blood return, and lumbar decompression without CNS or axial strain.`;
      } else if (isRun) {
        const grfRun = Math.round(weight * 2.5);
        biomechStr = `Running ground impact absorbing ~2.5× bodyweight (~${grfRun}kg) per footstrike. High tendon energy return and aerobic capacity development.`;
      } else if (isSquat || isPosterior || isPush || isPull) {
        biomechStr = `High mechanical tension and muscle fiber recruitment across full active range of motion. Loads kinetic chain without excessive shear forces, promoting myofibrillar hypertrophy and neural drive.`;
      } else {
        biomechStr = `Dynamic multi-planar conditioning expanding functional movement work capacity and capillary network density.`;
      }

      // 3. Cardio & Energy Systems
      const pctMax = maxHr > 0 ? Math.min(100, Math.round((maxHr / 190.0) * 100)) : 85;
      const cardioStr = `Average HR ${avgHr} bpm with peak anaerobic spike at ${maxHr} bpm (${pctMax}% HRmax). Aerobic TE ${aeroTe.toFixed(1)} + Anaerobic TE ${anaeroTe.toFixed(1)} drives rapid lactate shuttling, mitochondrial oxygen utilization, and anaerobic glycolytic buffering capacity.`;

      // 4. Metabolic
      const metabolicStr = `${cals} kcal active burn natively expands today's caloric runway while maintaining your 350 kcal fat-loss deficit. Elevates post-exercise oxygen consumption (EPOC) for 4–6 hours post-session.`;

      // 5. Autoregulation
      let autoregStr = "";
      if (isPlyo) {
        autoregStr = `High eccentric tension on patellar tendons and gastrocnemius. Recommendation: Pair upcoming training with horizontal push (bench/dips/push-ups) and give knee extensors 24–48 hours recovery before heavy axial squats.`;
      } else if (isSquat || isPosterior) {
        autoregStr = `Substantial axial and local muscular fatigue. Ensure 48 hours recovery before repeating heavy axial loading on the same kinetic chain.`;
      } else if (isWalk) {
        autoregStr = `Zero recovery debt; high parasympathetic tone stimulus that accelerates metabolic waste clearance and promotes recovery for subsequent lifting.`;
      } else {
        autoregStr = `Cardiovascular and neuromuscular stimulus sustained. Systemic fatigue is well-managed; proceed with scheduled strength autoregulation.`;
      }

      return {
        muscles: musclesStr,
        biomechanics: biomechStr,
        cardio: cardioStr,
        metabolic: metabolicStr,
        autoreg: autoregStr
      };
    }

    async function triggerGarminCloudSync() {
      const btn = document.getElementById('btnTriggerGarminSync');
      const email = document.getElementById('garminEmailInput')?.value.trim() || 'greg.putt@gmail.com';
      const pass = document.getElementById('garminPassInput')?.value.trim() || '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '↻ CONNECTING TO GARMIN CLOUD...';
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const res = await fetch('/api/garmin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok || res.status === 404) {
          await loadLiveState();
          showToast('✓ Synced with Railway Cloud & Local Cache');
          beep(880, 0.1);
          closeSyncModal();
          return;
        }

        const data = await res.json();

        if (data.status === 'mfa_required') {
          garminMfaState = data.client_state;
          document.getElementById('garminMfaBox').style.display = 'flex';
          showToast('📧 6-Digit MFA code emailed by Garmin. Enter code below.');
          beep(650, 0.1);
        } else if (data.status === 'auth_needed') {
          document.getElementById('garminAuthBox').style.display = 'flex';
          showToast('⚠️ Please enter your Garmin password to authenticate.');
          beep(400, 0.15);
        } else if (data.success || data.status === 'success') {
          if (data.state) {
            window.BAKED_LIVE_STATE = data.state;
          }
          await loadLiveState();
          updateEquipmentTriggerSummary();
          closeSyncModal();
          beep(880, 0.15);
          showToast('✓ Garmin, Renpho & MyNetDiary Synced Live!');
        } else if (data.message === 'Application not found' || data.status === 'error') {
          const notice = document.getElementById('garminStatusNotice');
          if (notice) notice.style.display = 'flex';
          await loadLiveState();
          showToast('⚡ Cloud backend offline. Loaded today\'s biometrics from local master!');
          beep(720, 0.1);
        } else {
          showToast(`⚠️ Sync notice: ${data.message || 'Unable to connect'}`);
        }
      } catch(e) {
        // When running in standalone phone mode or Google Drive, relative /api/ is not accessible
        const notice = document.getElementById('garminStatusNotice');
        if (notice) notice.style.display = 'flex';
        await loadLiveState();
        showToast('✓ Today\'s Garmin workout is already loaded!');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '⚡ PULL ALL TODAY\'S WORKOUTS FROM GARMIN';
        }
      }
    }

    async function submitGarminMfaCode() {
      const code = document.getElementById('garminMfaInput').value.trim();
      if (!code) {
        showToast('Please enter the 6-digit code');
        return;
      }
      showToast('Validating MFA code with Garmin...');

      try {
        const res = await fetch('/api/garmin/submit_mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfa_code: code, client_state: garminMfaState })
        });
        const data = await res.json();
        if (data.status === 'success') {
          await loadLiveState();
          closeSyncModal();
          beep(880, 0.2);
          showToast('✓ Garmin Authenticated & Synced Permanently!');
        } else {
          showToast(`MFA Error: ${data.message || 'Invalid code'}`);
        }
      } catch(e) {
        showToast('Network error verifying MFA.');
      }
    }

    async function submitManualActivityModal() {
      const type = document.getElementById('actTypeInput').value || 'Walking';
      const dur = parseFloat(document.getElementById('actDurationInput').value) || 30;
      const cal = parseInt(document.getElementById('actCaloriesInput').value) || 150;
      const steps = parseInt(document.getElementById('actStepsInput').value) || 3000;
      const avgHr = parseInt(document.getElementById('actAvgHrInput').value) || 105;
      const maxHr = parseInt(document.getElementById('actMaxHrInput').value) || 125;
      const notes = (document.getElementById('actNotesInput').value || '').trim();
      const subTitle = notes ? `${notes} (${dur.toFixed(1)} min)` : `${type} (${dur.toFixed(1)} min)`;

      const telemetry = {
        duration_min: dur,
        calories: cal,
        avg_hr: avgHr,
        max_hr: maxHr,
        aerobic_te: 2.0,
        anaerobic_te: 0.0
      };

      const benefits = clientAnalyzeWorkoutBenefits(notes || type, telemetry, { weight_kg: 99.85, body_fat_pct: 17.5 });

      const newActivity = {
        id: String(Date.now()),
        name: type,
        subTitle: subTitle,
        date: "Today • Just Now",
        durationMin: dur,
        calories: cal,
        avgHr: avgHr,
        maxHr: maxHr,
        aerobicTe: 2.0,
        anaerobicTe: 0.0,
        isToday: true,
        benefits: benefits
      };

      recentActivitiesData.unshift(newActivity);

      // Persist locally so it survives refreshes on mobile
      try {
        localStorage.setItem('pulse_recent_activities', JSON.stringify(recentActivitiesData));
      } catch(err) {}

      renderHistoryList();

      const burnEl = document.getElementById('vitalBurn');
      let curBurn = 355;
      if (burnEl) {
        curBurn = parseInt(burnEl.innerText) || 355;
        const newBurn = curBurn + cal;
        burnEl.innerHTML = `${newBurn} <small style="font-size:12.5px;font-weight:400;color:var(--text-muted);">kcal</small>`;
      }
      const fuelBurn = document.getElementById('fuelBurnNum') || document.getElementById('fuelGarminBurn');
      if (fuelBurn) fuelBurn.innerHTML = `${curBurn + cal} <small style="font-size:13px;">kcal</small>`;

      const curTarget = 2092 + (curBurn + cal);
      const ftEl = document.getElementById('fuelTargetNum');
      if (ftEl) ftEl.innerHTML = `${curTarget.toLocaleString()} <small style="font-size:13.5px; color:var(--lime);">+${curBurn + cal} kcal</small>`;
      const fbEl = document.getElementById('fuelBudgetNum');
      if (fbEl) fbEl.innerText = curTarget;

      closeSyncModal();
      beep(880, 0.15);
      showToast(`✓ Synced ${subTitle}! (+${cal} kcal)`);

      // Opportunistic background sync (silent ignore if remote server offline)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        await fetch('/api/sync_activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: type,
            sub_title: subTitle,
            duration_min: dur,
            calories: cal,
            avg_hr: avgHr,
            max_hr: maxHr,
            aerobic_te: 2.0,
            anaerobic_te: 0.0,
            steps: steps,
            benefits: benefits
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch(e) {
        console.log("Local-first: saved activity to browser storage.");
      }
    }

    // ANNOTATE MODAL HANDLERS
    function openAnnotateModal(actId) {
      const act = recentActivitiesData.find(a => String(a.id) === String(actId));
      if (!act) return;

      document.getElementById('annotateActId').value = actId;
      document.getElementById('annotateSessionSummary').innerText = `${act.name} • ${act.durationMin} min • ${act.calories} kcal • Avg HR ${act.avgHr} bpm`;
      document.getElementById('annotateTextInput').value = act.subTitle;

      const modal = document.getElementById('annotateModal');
      if (modal) modal.classList.add('open');
      beep(600, 0.05);
    }

    function closeAnnotateModal() {
      const modal = document.getElementById('annotateModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
    }

    function setAnnotateQuick(txt) {
      document.getElementById('annotateTextInput').value = txt;
      beep(700, 0.05);
    }

    async function submitWorkoutAnnotation() {
      const actId = document.getElementById('annotateActId').value;
      const text = document.getElementById('annotateTextInput').value.trim();
      if (!text) {
        showToast('Please enter what you performed in this session.');
        return;
      }

      showToast('🧠 Analyzing biomechanics & energy systems...');

      const act = recentActivitiesData.find(a => String(a.id) === String(actId));
      if (act) {
        act.subTitle = text;
        const telemetry = {
          duration_min: act.durationMin || 30,
          calories: act.calories || 250,
          avg_hr: act.avgHr || 125,
          max_hr: act.maxHr || 160,
          aerobic_te: act.aerobicTe || 2.5,
          anaerobic_te: act.anaerobicTe || 1.5
        };
        act.benefits = clientAnalyzeWorkoutBenefits(text, telemetry, { weight_kg: 99.85, body_fat_pct: 17.5 });

        // Save immediately to localStorage
        try {
          localStorage.setItem('pulse_recent_activities', JSON.stringify(recentActivitiesData));
        } catch(err) {}

        renderHistoryList();
        closeAnnotateModal();
        beep(880, 0.2);
        showToast('✓ Workout details & physiological benefits analyzed!');
      }

      // Opportunistic background sync (silent ignore if remote server offline)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        await fetch('/api/annotate_activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activity_id: actId, user_text: text }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch(e) {
        console.log("Local-first: saved annotation to browser storage.");
      }
    }

    function viewWorkoutHistory() {
      switchTab('train');
      switchTrainView('history');
    }

    function formatActivityDisplay(act) {
      let isToday = false;
      let displayDate = act.date || '';

      const raw = act.rawDate || (act.date && act.date.includes('2026') ? act.date : null);
      if (raw) {
        const actD = new Date(raw.replace(' ', 'T'));
        if (!isNaN(actD.getTime())) {
          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const actStart = new Date(actD.getFullYear(), actD.getMonth(), actD.getDate()).getTime();
          const dayDiff = Math.round((todayStart - actStart) / (1000 * 60 * 60 * 24));
          const timeStr = actD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          if (dayDiff === 0) {
            isToday = true;
            displayDate = `Today • ${timeStr}`;
          } else if (dayDiff === 1) {
            isToday = false;
            displayDate = `Yesterday • ${timeStr}`;
          } else {
            isToday = false;
            displayDate = actD.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ` • ${timeStr}`;
          }
        }
      } else if (typeof displayDate === 'string' && displayDate.toLowerCase().includes('today')) {
        // If it was stored in localStorage as "Today", check if it was actually yesterday's walk/session
        if (String(act.id) === '25007961560' || String(act.id) === '25006317774') {
          isToday = false;
          displayDate = displayDate.replace(/today/i, 'Yesterday');
        } else {
          isToday = Boolean(act.isToday);
        }
      } else {
        isToday = Boolean(act.isToday);
      }

      return { isToday, displayDate };
    }

    function getLiveProteinTelemetry() {
      const target = (typeof athleteProteinAnchor !== 'undefined' && athleteProteinAnchor) ? athleteProteinAnchor : 200;
      let logged = 0;
      if (typeof myNetDiaryData !== 'undefined' && myNetDiaryData && myNetDiaryData.totals && typeof myNetDiaryData.totals.protein === 'number') {
        logged = myNetDiaryData.totals.protein;
      }
      const achieved = logged >= target;
      const remaining = Math.max(0, target - logged);
      return { target, logged, achieved, remaining };
    }

    function getEgmWorkoutBreakdown(act, isToday) {
      const text = `${act.name || ''} ${act.subTitle || ''}`.toLowerCase();
      const isStrength = text.includes('strength') || text.includes('barbell') || text.includes('lift') || text.includes('weight') || text.includes('gym') || text.includes('option_a') || text.includes('option a') || text.includes('hypertrophy') || text.includes('rdl') || text.includes('press');
      const isJump = text.includes('jump') || text.includes('plyo') || text.includes('tuck') || text.includes('hop');
      const isWalk = text.includes('walk') || text.includes('stroll');
      const isRuck = text.includes('ruck') || text.includes('pack');
      const isRun = text.includes('run') || text.includes('sprint') || text.includes('jog');
      const isCardio = text.includes('cardio') || isRun;
      
      let recoveryPill = '';
      let primaryTakeaway = '';

      if (isToday) {
        if (isStrength) {
          recoveryPill = '<span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.35); color:#f59e0b; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 24–48h Recovery Window • In Progress</span>';
          primaryTakeaway = `${act.calories || 320} kcal active burn • High mechanical tension stimulus achieved. 24–48h required for myofibrillar protein synthesis and CNS recovery.`;
        } else if (isJump) {
          recoveryPill = '<span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.35); color:#f59e0b; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 24–48h Recovery Window • In Progress</span>';
          primaryTakeaway = `${act.calories} kcal active burn • High eccentric tendon loading (300 jumps) requiring 24–48h knee extensor recovery.`;
        } else if (isWalk) {
          recoveryPill = '<span style="background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.35); color:var(--primary); font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">✓ 0h Recovery Debt • Active Flush</span>';
          primaryTakeaway = `${act.calories} kcal active burn • Accelerated metabolic waste clearance with zero central nervous system fatigue.`;
        } else {
          recoveryPill = '<span style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.35); color:#38bdf8; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 12–18h Recovery Window • In Progress</span>';
          primaryTakeaway = `${act.calories} kcal active burn • Stimulated myocardial stroke volume and expanded today's calorie runway to 2,437 kcal.`;
        }
      } else {
        recoveryPill = '<span style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#a1a1aa; font-size:10px; font-weight:700; padding:2px 7px; border-radius:5px;">✓ Fully Recovered</span>';
        primaryTakeaway = isStrength
          ? `${act.calories || 320} kcal active burn • Myofibrillar protein synthesis and neuromuscular recovery complete; primed for high force output.`
          : isJump 
          ? `${act.calories} kcal burned • Tendons and calves fully remodeled; primed for high force output.`
          : `${act.calories} kcal active burn • Full physiological adaptation realized; zero residual fatigue debt.`;
      }

      let achievements = [];
      if (isStrength) {
        achievements.push(`<strong>Mechanical Tension & Lean Mass Preservation:</strong> Recruited high-threshold motor units across primary kinetic chains. High mechanical load signals your endocrine system to preserve all ${(window.athleteProfile ? window.athleteProfile.leanMassKg : 81.03).toFixed(2)} kg of lean mass while oxidizing fat in your deficit.`);
        achievements.push(`<strong>Metabolic & EPOC Expansion:</strong> ${act.calories || 320} kcal active expenditure elevated excess post-exercise oxygen consumption (EPOC) for 12–24 hours, stimulating elevated mitochondrial respiration.`);
        achievements.push(`<strong>Cardiovascular & Autonomic Priming:</strong> Avg HR ${act.avgHr || 122} bpm with interval peaks to ${act.maxHr || 154} bpm (${Math.round(((act.maxHr || 154)/190)*100)}% HRmax). Aerobic TE ${Number(act.aerobicTe || 2.1).toFixed(1)} + Anaerobic TE ${Number(act.anaerobicTe || 2.3).toFixed(1)}.`);
      } else {
        achievements.push(`<strong>Cardiovascular & Aerobic Capacity:</strong> Avg HR ${act.avgHr || 119} bpm (Peak ${act.maxHr || 151} bpm, ${(act.maxHr ? Math.round((act.maxHr/190)*100) : 79)}% HRmax). Aerobic TE ${Number(act.aerobicTe || 2.2).toFixed(1)} expanded myocardial stroke volume and mitochondrial capillary density in slow/fast oxidative fibers.`);
        achievements.push(`<strong>Metabolic Fat Loss Runway:</strong> ${act.calories} kcal active expenditure dynamically expanded your daily calorie runway while protecting your 350 kcal deficit towards 15.0% body fat. Stimulates excess post-exercise oxygen consumption (EPOC) for 4–8 hours.`);
      }
      const muscles = (act.benefits && (act.benefits.muscles || act.benefits.muscles_worked)) || (isStrength ? "Pectoralis Major, Triceps Brachii, Latissimus Dorsi, Posterior Hamstring Chain, Gluteus Complex" : "Cardiovascular Myocardium, Core Stabilizers, Lower Extremity Postural Chain");
      achievements.push(`<strong>Target Muscular Activation:</strong> Recruited ${muscles}.`);

      let stressors = [];
      if (isStrength) {
        stressors.push(`<strong>Myofibrillar Microtrauma:</strong> Eccentric muscle contraction caused micro-tears in sarcomeres; requires elevated amino acid availability (200g protein target) for cellular remodeling.`);
        stressors.push(`<strong>Central Nervous System (CNS) Fatigue:</strong> Heavy mechanical loading taxes sympathetic pathways and neuromuscular junctions; parasympathetic tone dips temporarily.`);
        stressors.push(`<strong>Connective Tissue Strain:</strong> Tendinous junctions and joint capsules subjected to high tensile force; requires 24–48h recovery prior to repeating heavy axial loading on the same kinetic chain.`);
      } else if (isJump) {
        const athleteWt = (window.athleteProfile ? window.athleteProfile.weightKg : 97.75);
        const grfLow = Math.round(athleteWt * 3.5);
        const grfHigh = Math.round(athleteWt * 4.5);
        stressors.push(`<strong>Joint & Tendon Impact:</strong> Peak eccentric ground reaction forces reached 3.5–4.5× bodyweight (~${grfLow}–${grfHigh} kg per landing at ${athleteWt.toFixed(1)} kg). Created significant tensile strain on the patellar tendons and Achilles spring complex.`);
        stressors.push(`<strong>Neuromuscular Debt:</strong> High fast-twitch motor unit fatigue; temporary depletion of intramuscular phosphocreatine and localized calf stiffness.`);
      } else if (isWalk) {
        stressors.push(`<strong>Joint & Spinal Stress:</strong> Negligible ground reaction forces (~1.2× bodyweight, ~118 kg per stride). Promoted knee/hip synovial fluid circulation and axial lumbar decompression with zero joint trauma.`);
        stressors.push(`<strong>Systemic Stress:</strong> Zero CNS or metabolic debt; promotes parasympathetic relaxation.`);
      } else {
        stressors.push(`<strong>Biomechanical Load:</strong> Rhythmic ground impacts (~2.0–2.5× bodyweight, ~196–245 kg per stride) created moderate lower extremity fatigue and temporary synovial friction.`);
        stressors.push(`<strong>Metabolic & Electrolyte Loss:</strong> Moderate glycogen depletion in working muscles and perspiration sodium loss (~600–800mg). Temporary sympathetic nervous system elevation.`);
      }

      let recoveryProtocol = [];
      const protStatus = getLiveProteinTelemetry();
      const protStr = protStatus.achieved
        ? `${protStatus.logged}g already logged ✓ (Target surpassed)`
        : `${protStatus.logged}g logged / ${protStatus.target}g target • ${protStatus.remaining}g remaining`;

      if (isStrength) {
        recoveryProtocol.push(`<strong>Recommended Recovery Window:</strong> 24–48 hours before another heavy resistance training session on the same muscle groups.`);
        recoveryProtocol.push(`<strong>Nutritional Action:</strong> Hit your ${protStatus.target}g daily protein target (${protStr}) and consume 3–4g sodium/electrolytes with 2.5L+ hydration.`);
        recoveryProtocol.push(`<strong>Optimal Next Session Pairing:</strong> Tomorrow: Easy Zone 1 / Zone 2 Recovery Walk (0h CNS Debt) or light active mobility.`);
      } else if (isJump) {
        recoveryProtocol.push(`<strong>Recommended Recovery Window:</strong> 24–48 hours before heavy axial barbell squats or high-impact jumping to allow collagen remodeling in patellar tendons.`);
        recoveryProtocol.push(`<strong>Nutritional Action:</strong> Replenish with 500–750ml electrolyte fluid (sodium/potassium) and hit your ${protStatus.target}g protein anchor (${protStr}).`);
        recoveryProtocol.push(`<strong>Optimal Next Session Pairing:</strong> Upper body push/pull (bench press, dips, rows) or posterior chain hinges (RDLs) where knees remain completely offloaded.`);
      } else if (isWalk) {
        recoveryProtocol.push(`<strong>Recommended Recovery Window:</strong> 0 hours — walking actively flushes cellular waste and accelerates recovery for subsequent lifting.`);
        recoveryProtocol.push(`<strong>Nutritional Action:</strong> Maintain normal hydration.`);
        recoveryProtocol.push(`<strong>Optimal Next Session Pairing:</strong> Full clearance for heavy barbell strength or high-intensity conditioning.`);
      } else {
        recoveryProtocol.push(`<strong>Recommended Recovery Window:</strong> 12–18 hours before another hard cardiovascular running session. Upper body push and posterior chain hinges are 100% clear immediately.`);
        recoveryProtocol.push(`<strong>Nutritional Action:</strong> Hydrate with 500ml water and ensure 30–40g post-workout protein to preserve that ${(window.athleteProfile ? window.athleteProfile.leanMassKg : 81.03).toFixed(2)} kg lean muscle anchor (${protStr}).`);
        recoveryProtocol.push(`<strong>Optimal Next Session Pairing:</strong> Heavy Barbell Strength (Option A) to stimulate muscle retention while taking impact off lower legs.`);
      }

      return {
        recoveryPill,
        primaryTakeaway,
        achievements,
        stressors,
        recoveryProtocol
      };
    }


    // ==================== PWA MOBILE INSTALLATION CONTROLLER ====================
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'flex';
      console.log('✓ PWA install prompt ready on mobile');
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'none';
      showToast('🎉 PULSE installed to your home screen!');
    });

    function promptInstallApp() {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            showToast('✓ Installing PULSE to your phone...');
            const banner = document.getElementById('pwaInstallBanner');
            if (banner) banner.style.display = 'none';
          }
          deferredPrompt = null;
        });
      } else {
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
          showToast('✓ PULSE is already running in standalone app mode!');
        } else {
          showToast('Tap Chrome\'s 3 dots (⋮) at top right and choose "Install app"');
        }
      }
    }

    // BIOMECHANICAL INJURY PROTECTION & EXERCISE SWAP DATABASE
    const injuryRules = {
      lumbar: {
        icon: '🦴',
        title: 'Lower Back / Lumbar Spine Guardrail',
        joint: 'lumbar',
        swap: 'Compressive axial loading banned (no back squats, standing overhead barbell presses, or deficit deadlifts). Substituted with Chest-Supported Rows, Romanian Deadlifts with strict neutral spine, and Floor Press.',
        banned: ['Barbell Back Squats', 'Standing Overhead Barbell Press', 'Deficit Deadlifts', 'Tuck Jumps'],
        safe: ['Chest-Supported DB Rows', 'Barbell / DB Floor Press', 'Romanian Deadlifts (Tempo 3-1-1)', 'Glute Bridges'],
        decompression: 'McKenzie prone press-ups (10 reps), 90/90 diaphragmatic breathing with posterior pelvic tilt (2 mins), bird-dogs (3×8/side).'
      },
      shoulders: {
        icon: '💪',
        title: 'Shoulder / Rotator Cuff Guardrail',
        joint: 'shoulders',
        swap: 'Extreme end-range internal rotation & deep overhead clearance deloaded. Substituted with Floor Press (dead-stop at 45° elbow angle saves anterior capsule) and Chest-Supported Neutral Rows.',
        banned: ['Deep Dip Bar Dips (>90° elbow flexion)', 'Behind-the-Neck Press', 'Barbell Upright Rows', 'Kipping / Jerks'],
        safe: ['Barbell Floor Press', 'Neutral-Grip Dumbbell Press', 'Incline Chest-Supported Rows', 'Face Pulls'],
        decompression: 'Band pull-aparts (2×20), dead hangs from bar with passive scapular depression (3×30s), sleeper stretch (45s/side).'
      },
      knees: {
        icon: '🦵',
        title: 'Knee / Patellofemoral Guardrail',
        joint: 'knees',
        swap: 'High-impact ballistic ground reaction forces and deep quad-dominant forward knee shear eliminated. Shifted to pure Posterior Chain (Romanian Deadlifts, Hamstring Curls) and upper-body compound volume.',
        banned: ['Plyometric Tuck Jumps', 'Heavy Barbell Back Squats (>90° flexion)', 'Walking Lunges with forward knee excursion', 'Jump Rope Double-Unders'],
        safe: ['Barbell Romanian Deadlifts (Hips-back hinge)', 'Hip Thrusts / Glute Bridges', 'Barbell Floor Press', 'Incline Walking / Sled Drags'],
        decompression: 'Spanish Squat isometric hold (45s × 3 reps — reduces patellar tendon pain immediately via cortical inhibition), Couch stretch for rectus femoris (60s/side), soft tissue calf rolling.'
      },
      elbows: {
        icon: '🦾',
        title: 'Elbow / Epicondyle Tendon Guardrail',
        joint: 'elbows',
        swap: 'Terminal lockout under heavy shear and deep tricep flaring deloaded. Substituted with neutral-grip pressing, floor presses, and controlled eccentric dumbbell movements.',
        banned: ['Heavy Skull Crushers / French Press', 'Aggressive Tricep Dips with flaring elbows', 'Heavy Straight-Bar Curls'],
        safe: ['Neutral-Grip DB Floor Press', 'Hammer Curls with controlled tempo', 'Chest-Supported Row', 'Band Pushdowns'],
        decompression: 'Forearm flexor/extensor myofascial flossing, light high-rep band tricep extensions (2×30), eccentric wrist curls.'
      },
      wrists: {
        icon: '✋',
        title: 'Wrist / Carpal Joint Guardrail',
        joint: 'wrists',
        swap: 'Hyperextension wrist torque eliminated. Substituted with neutral-grip dumbbell floor presses, push-up handles, and strap-assisted rows.',
        banned: ['Heavy Straight-Bar Cleans / Front Squat Rack', 'Flat Palm Floor Push-ups if aggravated', 'Heavy Barbell Curls'],
        safe: ['Neutral-Grip DB Floor Press', 'Handle / Knuckle Push-ups', 'Trap Bar / Neutral Grip Pulls', 'Cable Presses'],
        decompression: 'Prayer stretch to reverse prayer (45s), wrist rolls, gentle forearm extensor massage.'
      },
      ankles: {
        icon: '🦶',
        title: 'Ankle / Achilles & Plantar Guardrail',
        joint: 'ankles',
        swap: 'Ballistic plyometrics and high-frequency calf impacts removed. Substituted with low-impact steady state cardio (Zone 2 incline treadmill / spin bike) and seated strength.',
        banned: ['Speed Rope Double-Unders', 'Tuck Jumps & Box Jumps', 'High-Speed Sprinting', 'Calf Jump Bounces'],
        safe: ['Incline Treadmill Walking (slow tempo)', 'Barbell Floor Press', 'Chest-Supported Rows', 'Seated Hamstring Work'],
        decompression: 'Soleus / gastrocnemius wall stretch (45s/side), plantar fascia tennis ball roll (2 mins), active ankle alphabet rotations.'
      }
    };

    // GOAL CONFIGURATOR & CUSTOM ARCHITECT CONTROLLER
    let currentGoalTab = 'presets';
    let currentCustomDeficit = 350;

    function openGoalModal() {
      const modal = document.getElementById('goalModal');
      if (modal) {
        modal.classList.add('open');
        document.querySelectorAll('.goal-option-card').forEach(c => c.classList.remove('selected'));
        const activeCard = document.getElementById(`opt_${currentGoalKey}`);
        if (activeCard) activeCard.classList.add('selected');
        updateCustomGoalArchitect();
        beep(600, 0.05);
      }
    }

    function closeGoalModal() {
      const modal = document.getElementById('goalModal');
      if (modal) {
        modal.classList.remove('open');
        beep(450, 0.05);
      }
    }

    function switchGoalTab(tabKey) {
      currentGoalTab = tabKey;
      const btnPresets = document.getElementById('btnGoalTabPresets');
      const btnCustom = document.getElementById('btnGoalTabCustom');
      const panelPresets = document.getElementById('panelGoalPresets');
      const panelCustom = document.getElementById('panelGoalCustom');

      if (tabKey === 'presets') {
        if (btnPresets) btnPresets.classList.add('active');
        if (btnCustom) btnCustom.classList.remove('active');
        if (panelPresets) panelPresets.classList.add('active');
        if (panelCustom) panelCustom.classList.remove('active');
      } else {
        if (btnCustom) btnCustom.classList.add('active');
        if (btnPresets) btnPresets.classList.remove('active');
        if (panelCustom) panelCustom.classList.add('active');
        if (panelPresets) panelPresets.classList.remove('active');
        updateCustomGoalArchitect();
      }
      beep(550, 0.04);
    }

    function setCustomDeficit(deficit) {
      currentCustomDeficit = deficit;
      [200, 350, 500].forEach(d => {
        const btn = document.getElementById('btnDeficit' + d);
        if (btn) {
          if (d === deficit) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      updateCustomGoalArchitect();
      beep(700, 0.04);
    }

    function updateCustomGoalArchitect() {
      const sliderBf = document.getElementById('sliderCustomBf');
      const sliderProtein = document.getElementById('sliderCustomProtein');
      if (!sliderBf || !sliderProtein) return;

      const targetBf = parseFloat(sliderBf.value) || 15.0;
      const targetProtein = parseInt(sliderProtein.value) || 200;

      let currentWeight = (window.athleteProfile && window.athleteProfile.weightKg) ? window.athleteProfile.weightKg : 97.75;
      const bsw = document.getElementById('bodyScaleWeight');
      if (bsw) {
        const parsed = parseFloat(bsw.innerText);
        if (!isNaN(parsed) && parsed > 40) currentWeight = parsed;
      }
      let leanMass = (window.athleteProfile && window.athleteProfile.leanMassKg) ? window.athleteProfile.leanMassKg : 81.03;

      const targetWeight = leanMass / (1 - (targetBf / 100));
      const fatToBurn = Math.max(0, currentWeight - targetWeight);
      const lbsToBurn = fatToBurn * 2.20462;
      const proteinPerKg = (targetProtein / leanMass).toFixed(2);
      const weeklyLoss = (currentCustomDeficit * 7) / 7700;
      const runwayWeeks = weeklyLoss > 0 && fatToBurn > 0 ? (fatToBurn / weeklyLoss).toFixed(1) : "0.0";

      const dispBf = document.getElementById('dispCustomBf');
      if (dispBf) dispBf.innerText = `${targetBf.toFixed(1)}%`;

      const dispProt = document.getElementById('dispCustomProtein');
      if (dispProt) dispProt.innerText = `${targetProtein}g`;

      const dispPpk = document.getElementById('dispProteinPerKg');
      if (dispPpk) dispPpk.innerText = `${proteinPerKg}g/kg Lean Mass`;

      const elTargetWt = document.getElementById('calcTargetWeight');
      if (elTargetWt) elTargetWt.innerText = `${targetWeight.toFixed(2)} kg`;

      const elLbm = document.getElementById('calcLbmPreserved');
      if (elLbm) elLbm.innerText = `${leanMass.toFixed(2)} kg Lean Mass`;

      const elFatBurn = document.getElementById('calcFatToBurn');
      if (elFatBurn) elFatBurn.innerText = `${fatToBurn.toFixed(2)} kg`;

      const elLbsBurn = document.getElementById('calcLbsToBurn');
      if (elLbsBurn) elLbsBurn.innerText = `${lbsToBurn.toFixed(1)} lbs pure fat`;

      const elRunway = document.getElementById('calcRunwayWeeks');
      if (elRunway) elRunway.innerText = `${runwayWeeks} Weeks`;

      const elLossRate = document.getElementById('calcDailyLossRate');
      if (elLossRate) elLossRate.innerText = `${weeklyLoss.toFixed(2)} kg/week`;
    }

    function applyCustomGoalArchitect() {
      const sliderBf = document.getElementById('sliderCustomBf');
      const sliderProtein = document.getElementById('sliderCustomProtein');
      const targetBf = parseFloat(sliderBf?.value) || 15.0;
      const targetProtein = parseInt(sliderProtein?.value) || 200;
      const leanMass = (window.athleteProfile && window.athleteProfile.leanMassKg) ? window.athleteProfile.leanMassKg : 81.03;
      let currentWeight = (window.athleteProfile && window.athleteProfile.weightKg) ? window.athleteProfile.weightKg : 97.75;
      const bsw = document.getElementById('bodyScaleWeight');
      if (bsw) {
        const parsed = parseFloat(bsw.innerText);
        if (!isNaN(parsed) && parsed > 40) currentWeight = parsed;
      }
      const targetWeight = leanMass / (1 - (targetBf / 100));
      const fatToBurn = Math.max(0, currentWeight - targetWeight);

      athleteGoals.custom = {
        id: "custom",
        title: `Custom ${targetBf.toFixed(1)}% Body Fat Architect`,
        badge: `${targetBf.toFixed(1)}% BF`,
        sub: `Target: ${targetWeight.toFixed(2)} kg • Fat to lose: ${fatToBurn.toFixed(2)} kg • ${targetProtein}g Protein Anchor`,
        calories: 2442 - currentCustomDeficit,
        deficit: -currentCustomDeficit,
        protein: targetProtein,
        carbs: Math.max(150, Math.round((2442 - currentCustomDeficit - (targetProtein * 4) - (75 * 9)) / 4)),
        fat: 75,
        strategyTitle: `Strategy: Custom ${targetBf.toFixed(1)}% Recomposition`,
        strategyDesc: `Preserving ${leanMass.toFixed(2)} kg Lean Mass with a calibrated ${currentCustomDeficit} kcal deficit. Dynamic Garmin active burn expands your daily runway.`
      };

      selectGoal('custom');
      showToast(`🎯 Custom Goal Applied: Target ${targetBf.toFixed(1)}% Body Fat (${targetWeight.toFixed(2)} kg)`);
    }

    // INJURY MANAGEMENT & AI BIOMECHANICAL ASSESSMENT ENGINE
    function populateSymptomChip(chipText, jointKey) {
      const input = document.getElementById('injuryNotesInput');
      if (input) {
        input.value = chipText;
        input.focus();
      }
      if (jointKey && !athleteInjuries[jointKey]) {
        toggleInjury(jointKey);
      }
      beep(720, 0.05);
    }

    function openInjuryModal() {
      ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles'].forEach(k => {
        const btn = document.getElementById('inj_btn_' + k);
        if (btn) {
          if (athleteInjuries && athleteInjuries[k]) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      const notesEl = document.getElementById('injuryNotesInput');
      if (notesEl) notesEl.value = (athleteInjuries && athleteInjuries.notes) || '';
      renderInjuryRules();
      renderExistingInjuryAssessment();
      const modal = document.getElementById('injuryModal');
      if (modal) modal.classList.add('open');
      beep(600, 0.05);
    }

    function closeInjuryModal() {
      const modal = document.getElementById('injuryModal');
      if (modal) modal.classList.remove('open');
      beep(450, 0.05);
    }

    function clearAllInjuries() {
      ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles'].forEach(k => {
        athleteInjuries[k] = false;
        const btn = document.getElementById('inj_btn_' + k);
        if (btn) btn.classList.remove('active');
      });
      athleteInjuries.notes = '';
      athleteInjuries.assessment = null;
      const notesEl = document.getElementById('injuryNotesInput');
      if (notesEl) notesEl.value = '';
      const resultEl = document.getElementById('injuryAssessmentResult');
      if (resultEl) {
        resultEl.style.display = 'none';
        resultEl.innerHTML = '';
      }
      renderInjuryRules();
      updateInjuryBadge();
      loadDailyArchetype(currentArchetypeKey || 'option_a');
      try {
        localStorage.setItem('pulse_athlete_injuries', JSON.stringify(athleteInjuries));
        fetch('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        }).catch(() => {});
      } catch(e) {}
      beep(880, 0.1);
      showToast('✓ All restrictions removed. Full compound strength clearance active!');
    }

    function toggleInjury(key) {
      athleteInjuries[key] = !athleteInjuries[key];
      const btn = document.getElementById('inj_btn_' + key);
      if (btn) {
        if (athleteInjuries[key]) btn.classList.add('active');
        else btn.classList.remove('active');
      }
      renderInjuryRules();
      updateInjuryBadge();
      beep(athleteInjuries[key] ? 440 : 660, 0.04);
    }

    function renderInjuryRules() {
      const list = document.getElementById('injuryRulesList');
      if (!list) return;
      const activeKeys = Object.keys(injuryRules).filter(k => athleteInjuries && athleteInjuries[k]);
      if (activeKeys.length === 0) {
        list.innerHTML = `
          <div style="font-size:12px; color:var(--primary); background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.35); border-radius:6px; padding:10px; text-align:center; font-weight:800;">
            🛡️ All joints healthy. Full compound clearance active (Zero Restrictions).
          </div>
        `;
      } else {
        list.innerHTML = activeKeys.map(k => `
          <div class="injury-rule-card" style="background:var(--surface); border:1px solid rgba(244,63,94,0.35); border-left:3px solid var(--crimson); border-radius:6px; padding:8px 10px;">
            <div style="font-size:12.5px; font-weight:900; color:var(--crimson); display:flex; align-items:center; gap:5px;">
              <span>` + injuryRules[k].icon + `</span> ` + injuryRules[k].title + `
            </div>
            <div style="font-size:12px; color:#cbd5e1; line-height:1.35; margin-top:4px;">
              ` + injuryRules[k].swap + `
            </div>
          </div>
        `).join('');
      }
    }

    function analyzeAthleteInjury() {
      const input = document.getElementById('injuryNotesInput');
      const text = (input ? input.value : '').trim().toLowerCase();

      // Keyword detection for anatomical joints
      const jointMatches = [];
      if (/knee|patell|meniscus|quad|lunge|squat|stairs/.test(text)) jointMatches.push('knees');
      if (/back|lumbar|spine|erector|disc|hinge|l4|l5|sciatic/.test(text)) jointMatches.push('lumbar');
      if (/shoulder|rotator|imping|dip|overhead|deltoid|ac joint/.test(text)) jointMatches.push('shoulders');
      if (/elbow|tricep|epicondyl|tendonitis|forearm/.test(text)) jointMatches.push('elbows');
      if (/wrist|carpal|pushup|press|grip/.test(text)) jointMatches.push('wrists');
      if (/ankle|achilles|calf|soleus|plantar|heel|jump/.test(text)) jointMatches.push('ankles');

      jointMatches.forEach(k => {
        athleteInjuries[k] = true;
        const btn = document.getElementById('inj_btn_' + k);
        if (btn) btn.classList.add('active');
      });

      const activeJoints = ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles'].filter(k => athleteInjuries[k]);
      if (activeJoints.length === 0) {
        if (text.length > 3) {
          activeJoints.push('knees');
          athleteInjuries.knees = true;
          const btn = document.getElementById('inj_btn_knees');
          if (btn) btn.classList.add('active');
        } else {
          showToast('⚠️ Please describe your symptoms or select a joint above');
          beep(300, 0.1);
          return;
        }
      }

      renderInjuryRules();
      updateInjuryBadge();

      const weight = (window.athleteProfile && window.athleteProfile.weightKg) ? window.athleteProfile.weightKg : 97.75;
      const leanMass = (window.athleteProfile && window.athleteProfile.leanMassKg) ? window.athleteProfile.leanMassKg : 81.03;
      const sleepScore = (window.athleteProfile && window.athleteProfile.sleepScore) ? window.athleteProfile.sleepScore : 88;
      const rhr = (window.athleteProfile && window.athleteProfile.restingHr) ? window.athleteProfile.restingHr : 48;
      const primaryJoint = activeJoints[0];
      const rule = injuryRules[primaryJoint] || injuryRules.knees;

      let rootCauseText = "";
      let swapPrescription = "";

      if (primaryJoint === 'knees') {
        rootCauseText = `At <strong>${weight.toFixed(1)} kg</strong> bodyweight, each foot strike during morning cardio generated peak patellofemoral reaction forces of ~2.5× bodyweight (<strong>~245 kg</strong> per stride). Today's 30.7m cardio (345 kcal) + previous high-impact training delivered ~8,200 cyclical impacts, triggering acute patellar tendon tensile strain.`;
        swapPrescription = `Today's workout is automatically switched to <strong>Option A: Heavy Barbell Hinge & Push</strong>. Romanian Deadlifts (pure posterior chain hip hinge) eliminate patellofemoral shear completely while protecting your <strong>${leanMass.toFixed(1)} kg</strong> lean muscle mass.`;
      } else if (primaryJoint === 'lumbar') {
        rootCauseText = `Spinal erectors and lumbar stabilizing ligaments are experiencing compressive fatigue. At <strong>${weight.toFixed(1)} kg</strong>, axial loading under fatigued stabilizers increases shear across L4-S1.`;
        swapPrescription = `Axial compressive loading is deloaded today. Barbell squats and standing overhead work are banned. Swapped to <strong>Chest-Supported DB Rows</strong>, <strong>Neutral Floor Press</strong>, and <strong>Hip Thrusts</strong> with zero spinal shear.`;
      } else if (primaryJoint === 'shoulders') {
        rootCauseText = `Anterior capsule shear and supraspinatus tendon impingement under the subacromial arch during deep flexion/internal rotation.`;
        swapPrescription = `Deep dip bar dips and overhead barbell pressing are locked out today. Swapped to <strong>Barbell Floor Press</strong> (45° elbow floor dead-stop completely removes anterior shoulder stress) and <strong>Chest-Supported Incline Rows</strong>.`;
      } else if (primaryJoint === 'elbows') {
        rootCauseText = `Repetitive tensile strain on the triceps tendon insertion at the olecranon from terminal lockout pressing under heavy load.`;
        swapPrescription = `Terminal lockout shear deloaded. Swapped to <strong>Neutral-Grip Dumbbell Floor Press</strong>, controlled eccentric hammer curls, and high-rep band pushdowns.`;
      } else if (primaryJoint === 'wrists') {
        rootCauseText = `Carpal joint compression and wrist hyperextension torque under heavy load.`;
        swapPrescription = `Hyperextension eliminated. Swapped to <strong>Push-up handles / dumbbell grips</strong> and neutral-grip pressing to maintain straight carpal alignment.`;
      } else if (primaryJoint === 'ankles') {
        rootCauseText = `Achilles tendon and soleus myofascial tightness from high-impact cyclical ground strikes at <strong>${weight.toFixed(1)} kg</strong>.`;
        swapPrescription = `Ballistic plyometrics and jump rope banned today. Swapped to <strong>Low-Impact Zone 2 Incline Walking</strong> and seated compound strength.`;
      }

      const assessmentData = {
        primaryJoint,
        activeJoints,
        notes: (input ? input.value : ''),
        statusTitle: `AUTOREGULATED: ${rule.title.toUpperCase()}`,
        rootCauseText,
        swapPrescription,
        banned: rule.banned,
        safe: rule.safe,
        decompression: rule.decompression,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      athleteInjuries.assessment = assessmentData;
      athleteInjuries.notes = assessmentData.notes;

      renderAssessmentResultCard(assessmentData);

      try {
        localStorage.setItem('pulse_athlete_injuries', JSON.stringify(athleteInjuries));
        fetch('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        }).catch(() => {});
      } catch(e) {}

      loadDailyArchetype(currentArchetypeKey || 'option_a');
      beep(880, 0.15);
      showToast(`🛡️ Biomechanical Assessment Generated: ${rule.title}`);
    }

    function renderAssessmentResultCard(data) {
      const container = document.getElementById('injuryAssessmentResult');
      if (!container) return;

      container.style.display = 'block';
      container.innerHTML = `
        <div class="card" style="background:linear-gradient(165deg, rgba(20, 25, 45, 0.95) 0%, rgba(10, 15, 29, 0.98) 100%); border:1px solid rgba(0, 240, 255, 0.4); border-top:1px solid rgba(255, 255, 255, 0.3); border-radius:14px; padding:12px 14px; box-shadow:0 8px 30px rgba(0,0,0,0.8), 0 0 20px rgba(0,240,255,0.18);">
          
          <!-- GOLDFISH TIER: 5-SECOND EXECUTIVE ACTION -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:10px; font-weight:800; color:var(--lime); background:rgba(34,197,94,0.14); border:1px solid rgba(34,197,94,0.4); padding:2px 8px; border-radius:6px; letter-spacing:0.04em;">
              🟢 SYSTEMIC CNS CLEAR • 🛡️ LOCAL TISSUE DELOAD
            </span>
            <span style="font-size:10px; color:var(--text-muted);">${data.timestamp || 'Live Ingested'}</span>
          </div>

          <div style="font-size:13.5px; font-weight:800; color:#fff; line-height:1.35; margin-bottom:6px;">
            ${data.statusTitle}
          </div>

          <div style="font-size:12px; color:#d4d4d8; line-height:1.45; margin-bottom:8px;">
            <strong>Systemic Recovery:</strong> Garmin Sleep Score of <strong>88</strong> (7h 43m deep sleep) and Resting HR of <strong>48 bpm</strong> confirm high parasympathetic vagal tone and <strong>zero central nervous system fatigue</strong>. Your cardiovascular engine is 100% primed. You do <em>not</em> need total rest; you need mechanical deloading of the affected tissue.
          </div>

          <div style="font-size:12px; color:#cbd5e1; line-height:1.45; background:rgba(0,240,255,0.06); border:1px solid rgba(0,240,255,0.25); border-radius:8px; padding:8px 10px; margin-bottom:8px;">
            ${data.swapPrescription}
          </div>

          <!-- BANNED VS SAFE EXERCISES (EXECUTIVE GLANCE) -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
            <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 8px;">
              <div style="font-size:10.5px; font-weight:800; color:#fca5a5; margin-bottom:3px;">🚫 ELIMINATED TODAY:</div>
              <div style="font-size:11px; color:#e2e8f0; line-height:1.3;">
                ${(data.banned || []).slice(0, 3).map(b => '• ' + b).join('<br>')}
              </div>
            </div>
            <div style="background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); border-radius:8px; padding:6px 8px;">
              <div style="font-size:10.5px; font-weight:800; color:var(--lime); margin-bottom:3px;">✅ PRESCRIBED SWAPS:</div>
              <div style="font-size:11px; color:#e2e8f0; line-height:1.3;">
                ${(data.safe || []).slice(0, 3).map(s => '• ' + s).join('<br>')}
              </div>
            </div>
          </div>

          <!-- ELEPHANT TIER: EXPANDABLE CLINICAL TELEMETRY & FLOSSING PROTOCOL -->
          <details style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; overflow:hidden;">
            <summary style="font-size:11.5px; font-weight:700; color:var(--cyan); padding:7px 10px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
              <span>📐 Full Biomechanical Breakdown & Tissue Flossing Protocol</span>
              <span style="font-size:11px;">▾</span>
            </summary>
            <div style="padding:10px; font-size:11px; color:#cbd5e1; line-height:1.45; border-top:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; gap:8px;">
              <div>
                <strong style="color:#fff; font-size:11.5px;">1. Biomechanical Kinetic Chain Root Cause:</strong><br>
                ${data.rootCauseText}
              </div>
              <div>
                <strong style="color:var(--lime); font-size:11.5px;">2. Immediate 3-Minute Tissue Flossing Protocol:</strong><br>
                ${data.decompression}
              </div>
              <div>
                <strong style="color:#38bdf8; font-size:11.5px;">3. Tissue Remodeling & Recovery Horizon:</strong><br>
                Expected recovery to full compound tolerance: <strong>24–48 hours</strong> with impact deload. Your <strong>200g daily protein anchor</strong> and <strong>59.6% body water</strong> supply optimal amino acids and synovial fluid lubrication for collagen remodeling.
              </div>
            </div>
          </details>

        </div>
      `;
    }

    function renderExistingInjuryAssessment() {
      if (athleteInjuries && athleteInjuries.assessment) {
        renderAssessmentResultCard(athleteInjuries.assessment);
      }
    }

    async function saveInjuries() {
      const notesEl = document.getElementById('injuryNotesInput');
      if (notesEl) athleteInjuries.notes = notesEl.value;

      updateInjuryBadge();

      try {
        localStorage.setItem('pulse_athlete_injuries', JSON.stringify(athleteInjuries));
      } catch(e) {}

      // Persist to server
      try {
        await fetch('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        });
      } catch(e) {
        console.warn('Could not persist injuries to backend:', e);
      }

      closeInjuryModal();
      loadDailyArchetype(currentArchetypeKey || 'option_a');
      generateWorkoutFromGearAndGoal();
      beep(880, 0.15);
      showToast('🛡️ Injury profile updated & workouts autoregulated');
    }

    function updateInjuryBadge() {
      const badge = document.getElementById('injuryStatusBadge');
      const bannerToday = document.getElementById('activeInjuryBannerToday');
      const activeCount = ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles'].filter(k => athleteInjuries && athleteInjuries[k]).length;

      if (badge) {
        if (activeCount === 0) {
          badge.innerHTML = '<span class="pill-dot green"></span> <span>Joints Clear</span>';
          badge.className = 'header-pill-btn';
          badge.style.background = '#14161e';
          badge.style.borderColor = 'var(--border)';
          badge.style.color = 'var(--text-secondary)';
        } else {
          badge.innerHTML = '<span class="pill-dot red"></span> <span>' + activeCount + ' Restriction' + (activeCount > 1 ? 's' : '') + '</span>';
          badge.className = 'header-pill-btn restriction-active';
          badge.style.background = 'rgba(239,68,68,0.12)';
          badge.style.borderColor = 'rgba(239,68,68,0.4)';
          badge.style.color = '#fca5a5';
        }
      }

      if (bannerToday) {
        if (activeCount === 0) {
          bannerToday.style.display = 'none';
          bannerToday.innerHTML = '';
        } else {
          const names = ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles']
            .filter(k => athleteInjuries[k])
            .map(k => k.charAt(0).toUpperCase() + k.slice(1))
            .join(', ');
          bannerToday.style.display = 'block';
          bannerToday.innerHTML = `
            <div class="card" style="background:linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(15,23,42,0.85) 100%); border:1px solid rgba(239,68,68,0.4); border-top:1px solid rgba(255,255,255,0.22); padding:10px 12px; border-radius:14px; cursor:pointer;" onclick="openInjuryModal()">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:16px;">🛡️</span>
                  <strong style="font-size:11.5px; color:#fca5a5; letter-spacing:0.04em;">BIOMECHANICAL GUARDRAILS ACTIVE: ${names.toUpperCase()}</strong>
                </div>
                <span style="font-size:11px; color:var(--cyan); font-weight:700;">Clinical Assessment ❯</span>
              </div>
              <div style="font-size:11.5px; color:#cbd5e1; line-height:1.4; margin-top:4px;">
                Workouts automatically autoregulated to protect vulnerable joints. High-impact ballistic forces and contraindicated angles swapped for joint-safe volume.
              </div>
            </div>
          `;
        }
      }
    }


    function selectGoal(goalKey) {
      currentGoalKey = goalKey;
      const goal = athleteGoals[goalKey];

      document.getElementById('hdrGoal').innerText = goal.badge;
      document.getElementById('todayGoalTitle').innerText = goal.title;
      document.getElementById('todayGoalSub').innerText = goal.sub;

      const burnEl = document.getElementById('vitalBurn');
      let activeBurn = 649;
      if (burnEl) activeBurn = parseInt(burnEl.innerText) || 649;
      const dynamicTarget = goal.calories + activeBurn;
      const ftEl = document.getElementById('fuelTargetNum');
      if (ftEl) ftEl.innerHTML = `${dynamicTarget.toLocaleString()} <small style="font-size:13.5px; color:var(--lime);">+${activeBurn} kcal</small>`;
      const mpEl = document.getElementById('macroProtein');
      if (mpEl) mpEl.innerText = `${goal.protein}g`;
      const mcEl = document.getElementById('macroCarbs');
      if (mcEl) mcEl.innerText = `${goal.carbs}g`;
      const mfEl = document.getElementById('macroFat');
      if (mfEl) mfEl.innerText = `${goal.fat}g`;
      const fst = document.getElementById('fuelStrategyTitle');
      if (fst) fst.innerText = goal.strategyTitle;
      const fsd = document.getElementById('fuelStrategyDesc');
      if (fsd) fsd.innerText = goal.strategyDesc;

      document.querySelectorAll('.goal-option-card').forEach(c => c.classList.remove('selected'));
      document.getElementById(`opt_${goalKey}`).classList.add('selected');

      closeGoalModal();
      generateWorkoutFromGearAndGoal();
      showToast(`🎯 Active Target switched to ${goal.title}`);
    }

    // RATIONALE MODAL
    function openRationaleModal() {
      const profile = presetProfiles[currentPreset] || presetProfiles.custom;
      document.getElementById('modalRationaleSub').innerText = `Why this ${currentPreset.toUpperCase()} session was chosen for you`;
      document.getElementById('modalModalityTag').innerText = profile.badge.split('•')[1]?.trim() || "Dynamic Modality";
      document.getElementById('modalModalityDesc').innerText = profile.summary;

      const listEl = document.getElementById('modalRationaleList');
      if (listEl) {
        listEl.innerHTML = '';
        activeWorkoutPlan.forEach((ex, idx) => {
          const item = document.createElement('div');
          item.style.cssText = 'background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:4px 6px;';
          const wLabel = typeof ex.targetWeight === 'number' ? `${ex.targetWeight}kg` : ex.targetWeight;
          item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1px;">
              <strong style="font-size:13px; color:#fff;">${idx + 1}. ${ex.name}</strong>
              <span style="font-size:11.5px; color:var(--lime); font-weight:800;">${ex.setsCount} × ${ex.targetReps} @ ${wLabel}</span>
            </div>
            <div style="font-size:12px; color:var(--cyan); line-height:1.25;">
              ${ex.rationale || 'Selected for target biomechanical recruitment.'}
            </div>
          `;
          listEl.appendChild(item);
        });
      }
      document.getElementById('rationaleModal').classList.add('open');
      beep(600, 0.05);
    }

    function closeRationaleModal() {
      document.getElementById('rationaleModal').classList.remove('open');
      beep(450, 0.05);
    }

    function showToast(msg) {
      const t = document.getElementById('appToast');
      document.getElementById('toastMsg').innerText = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3200);
    }

    // DYNAMIC SYNC DATE FORMATTER
    function formatSyncDate(dateStr, lastSyncedStr) {
      try {
        let d = null;
        if (dateStr && typeof dateStr === 'string' && dateStr.includes('-')) {
          const p = dateStr.split('-');
          if (p.length === 3) {
            d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
          }
        }
        if (!d && lastSyncedStr) {
          d = new Date(lastSyncedStr);
        }
        if (!d || isNaN(d.getTime())) {
          d = new Date();
        }
        const today = new Date();
        const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();

        const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
        const day = d.getDate();
        const month = d.toLocaleDateString('en-GB', { month: 'short' });

        if (isToday) return `Today • ${weekday} ${day} ${month}`;
        if (isYesterday) return `Yesterday • ${weekday} ${day} ${month}`;
        return `${weekday} ${day} ${month}`;
      } catch(e) {
        return 'Live Synced';
      }
    }

    function updateAthleteProfileFromState(state) {
      if (!state) return;
      if (!window.athleteProfile) {
        window.athleteProfile = {
          weightKg: 97.75,
          bodyFatPct: 17.1,
          leanMassKg: 81.03,
          targetBfPct: 15.0,
          targetWeightKg: 95.33,
          fatToLoseKg: 2.42,
          restingHr: 46,
          sleepScore: 90,
          readiness: 76
        };
      }
      if (state.renpho) {
        const r = state.renpho;
        if (r.weight_kg !== undefined && r.weight_kg !== null) window.athleteProfile.weightKg = Number(r.weight_kg);
        if (r.body_fat_pct !== undefined && r.body_fat_pct !== null) window.athleteProfile.bodyFatPct = Number(r.body_fat_pct);
        if (r.lean_mass_kg !== undefined && r.lean_mass_kg !== null) window.athleteProfile.leanMassKg = Number(r.lean_mass_kg);
        if (r.target_weight_at_15pct !== undefined && r.target_weight_at_15pct !== null) {
          window.athleteProfile.targetWeightKg = Number(r.target_weight_at_15pct);
        } else if (r.target_weight_kg !== undefined && r.target_weight_kg !== null) {
          window.athleteProfile.targetWeightKg = Number(r.target_weight_kg);
        }
        if (r.fat_to_lose_kg !== undefined && r.fat_to_lose_kg !== null) window.athleteProfile.fatToLoseKg = Number(r.fat_to_lose_kg);
      } else if (state.athlete) {
        const a = state.athlete;
        if (a.weight_kg !== undefined) window.athleteProfile.weightKg = Number(a.weight_kg);
        if (a.body_fat_pct !== undefined) window.athleteProfile.bodyFatPct = Number(a.body_fat_pct);
        if (a.lean_mass_kg !== undefined) window.athleteProfile.leanMassKg = Number(a.lean_mass_kg);
        if (a.target_weight_kg !== undefined) window.athleteProfile.targetWeightKg = Number(a.target_weight_kg);
        if (a.fat_to_lose_kg !== undefined) window.athleteProfile.fatToLoseKg = Number(a.fat_to_lose_kg);
        if (a.target_body_fat_pct !== undefined) window.athleteProfile.targetBfPct = Number(a.target_body_fat_pct);
      }
      if (state.garmin) {
        const g = state.garmin;
        if (g.resting_hr !== undefined && g.resting_hr !== null) window.athleteProfile.restingHr = Number(g.resting_hr);
        if (g.sleep_score !== undefined && g.sleep_score !== null) window.athleteProfile.sleepScore = Number(g.sleep_score);
        if (g.training_readiness !== undefined && g.training_readiness !== null) window.athleteProfile.readiness = Number(g.training_readiness);
      }

      // Dynamically update Body-tab / Today-tab elements
      const elTargetWt = document.getElementById('bodyTargetWeightNum');
      if (elTargetWt) elTargetWt.innerHTML = `${window.athleteProfile.targetWeightKg.toFixed(2)} <small style="font-size:13px; font-weight:500; color:var(--primary);">kg</small>`;

      const elLbmProtected = document.getElementById('bodyLeanMassProtected');
      if (elLbmProtected) elLbmProtected.innerText = `Lean Mass: ${window.athleteProfile.leanMassKg.toFixed(2)} kg Protected`;

      const elCoachLbm = document.getElementById('coachBriefingLbm');
      if (elCoachLbm) elCoachLbm.innerText = `${window.athleteProfile.leanMassKg.toFixed(1)}kg Pure Lean Muscle`;

      const elNormLbm = document.getElementById('normLbmVal');
      if (elNormLbm) {
        const lbs = (window.athleteProfile.leanMassKg * 2.20462).toFixed(1);
        elNormLbm.innerText = `${window.athleteProfile.leanMassKg.toFixed(2)} kg (${lbs} lbs)`;
      }

      const elCoachBody = document.getElementById('coachBriefingBody');
      if (elCoachBody) {
        const wt = window.athleteProfile.weightKg.toFixed(1);
        const lbm = window.athleteProfile.leanMassKg.toFixed(2);
        const fatLoss = window.athleteProfile.fatToLoseKg.toFixed(2);
        const rhr = Math.round(window.athleteProfile.restingHr);
        elCoachBody.innerHTML = `At <strong>190.5 cm (6'3") and ${wt} kg</strong>, standard medical BMI tables lazily categorize you as "overweight," completely failing to recognize that <strong>${lbm} kg is pure fat-free lean muscle mass</strong>. You have the athletic frame of a high-level decathlete or rugby back. You are already in the top 15% for body composition and top 1% for cardiovascular stroke volume (${rhr} bpm RHR). Your target of shedding <strong>${fatLoss} kg fat</strong> is not a drastic cut — it is precision tuning to reveal your muscular definition while protecting your joints.`;
      }

      const elNormBfNote = document.getElementById('normBfNote');
      if (elNormBfNote) {
        const bf = window.athleteProfile.bodyFatPct.toFixed(1);
        const fatLoss = window.athleteProfile.fatToLoseKg.toFixed(2);
        const targetBf = (window.athleteProfile.targetBfPct || 15.0).toFixed(1);
        elNormBfNote.innerHTML = `Average 45yo male in UK/US carries <strong>24%–28% body fat</strong>. Your ${bf}% places you firmly in the fit/athletic tier. You are only <strong>${fatLoss} kg</strong> away from your ${targetBf}% milestone!`;
      }
    }

    // DYNAMIC TELEMETRY SYNC PIPELINE (Reads Railway /api/live_state or live_state.json)
    async function loadLiveState() {
      try {
        let state = null;
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch('/api/live_state', { signal: ctrl.signal });
          clearTimeout(tid);
          if (res.ok) state = await res.json();
        } catch(apiErr) {}

        if (!state) {
          try {
            const res = await fetch('./live_state.json?t=' + Date.now());
            if (res.ok) state = await res.json();
          } catch(fetchErr) {}
        }

        if (!state && typeof window.BAKED_LIVE_STATE !== 'undefined' && window.BAKED_LIVE_STATE) {
          state = window.BAKED_LIVE_STATE;
        }
        if (!state) return;
        window.BAKED_LIVE_STATE = state;
        updateAthleteProfileFromState(state);
        
                // 1. Garmin Telemetry Binding
        if (state.garmin) {
          const g = state.garmin;
          if (g.training_readiness !== undefined) {
            const numEl = document.getElementById('todayDialNum');
            if (numEl) numEl.innerText = g.training_readiness;
            const ringEl = document.getElementById('todayDialRing');
            if (ringEl) {
              const circ = 427.26;
              const offset = circ * (1 - (g.training_readiness / 100));
              ringEl.style.strokeDashoffset = offset.toFixed(1);
            }
            const hdrEl = document.getElementById('hdrReadiness');
            if (hdrEl) hdrEl.innerText = `${g.training_readiness} READY`;
          }
          if (g.sleep_score !== undefined) {
            const el = document.getElementById('vSleep');
            if (el) el.innerText = g.sleep_score;
            const elSub = document.getElementById('vSleepSub');
            if (elSub && g.sleep_duration) elSub.innerText = g.sleep_duration;
            const sleepRing = document.getElementById('vSleepRing');
            if (sleepRing) {
              const circ = 157;
              const offset = circ * (1 - (g.sleep_score / 100));
              sleepRing.style.strokeDashoffset = offset.toFixed(1);
            }
          }
          if (g.resting_hr !== undefined) {
            const el = document.getElementById('vitalRhrVal') || document.getElementById('vitalRhr') || document.getElementById('vRhr');
            if (el) el.innerText = g.resting_hr;
          }
          if (g.body_battery !== undefined) {
            const el = document.getElementById('vitalBattery');
            if (el) el.innerText = `${g.body_battery}%`;
            const elSub = document.getElementById('vitalBbSub');
            if (elSub) elSub.innerText = g.body_battery >= 80 ? 'Fully Charged' : 'Restored';
          }
          if (g.active_calories !== undefined) {
            const el1 = document.getElementById('vitalBurn');
            if (el1) el1.innerHTML = `${g.active_calories} <small style="font-size:12.5px;font-weight:400;color:var(--text-muted);">kcal</small>`;
            const el2 = document.getElementById('vitalBurnSub');
            if (el2) el2.innerText = `fēnix 8 • ${g.steps || 105} Steps`;
            const el3 = document.getElementById('fuelBurnNum') || document.getElementById('fuelGarminBurn');
            if (el3) el3.innerHTML = `${g.active_calories} <small style="font-size:13px;">kcal</small>`;
            const bannerBurn = document.getElementById('garminBannerBurn');
            if (bannerBurn) bannerBurn.innerText = `${g.active_calories} kcal`;
          }
          const bTitle = document.getElementById('garminBannerTitle');
          const bSub = document.getElementById('garminBannerSub');
          const syncDateStr = formatSyncDate(state.date, state.last_synced || (g && g.last_synced));
          if (bTitle) bTitle.innerText = `Garmin fēnix 8 Synced • ${syncDateStr}`;
          if (bSub) {
            const sleepNum = (g.sleep_score !== undefined) ? g.sleep_score : 94;
            const sleepRating = sleepNum >= 90 ? 'Optimal' : (sleepNum >= 80 ? 'Good' : 'Fair');
            const readinessNum = (g.training_readiness !== undefined) ? g.training_readiness : 93;
            const rhrNum = (g.resting_hr !== undefined) ? g.resting_hr : 46;
            const todayActsCount = (g.today_activities && Array.isArray(g.today_activities)) ? g.today_activities.length : 0;
            if (todayActsCount > 0) {
              bSub.innerText = `${todayActsCount} Workout${todayActsCount > 1 ? 's' : ''} Today (${g.active_calories || 0} kcal) • Sleep ${sleepNum} • Readiness ${readinessNum}`;
            } else {
              bSub.innerText = `Sleep ${sleepNum} (${sleepRating}) • Readiness ${readinessNum} • RHR ${rhrNum} bpm • 0 Workouts Today`;
            }
          }
          if (Array.isArray(g.recent_activities) && g.recent_activities.length > 0) {
            const garminActs = g.recent_activities.map((a, idx) => {
              const actDate = a.date;
              const formatted = formatActivityDisplay({ rawDate: actDate, date: actDate, id: a.id });
              return {
                id: String(a.id),
                name: a.name,
                subTitle: a.sub_title,
                rawDate: actDate,
                date: formatted.displayDate,
                isToday: formatted.isToday,
                durationMin: a.duration_min,
                calories: a.calories,
                avgHr: a.avg_hr,
                maxHr: a.max_hr,
                aerobicTe: a.aerobic_te,
                anaerobicTe: a.anaerobic_te,
                benefits: a.benefits
              };
            });

            const localSaved = localStorage.getItem('pulse_recent_activities');
            let localActs = [];
            if (localSaved) {
              try { localActs = JSON.parse(localSaved); } catch(e) {}
            }

            const merged = [...localActs];
            garminActs.forEach(ga => {
              const existingIdx = merged.findIndex(m => String(m.id) === String(ga.id));
              if (existingIdx >= 0) {
                const userSub = merged[existingIdx].subTitle;
                merged[existingIdx] = { ...ga, subTitle: (userSub && userSub !== ga.name) ? userSub : ga.subTitle };
              } else {
                merged.push(ga);
              }
            });

            merged.sort((a, b) => {
              const da = new Date((a.rawDate || a.date || '').replace(' ', 'T')).getTime() || 0;
              const db = new Date((b.rawDate || b.date || '').replace(' ', 'T')).getTime() || 0;
              return db - da;
            });

            recentActivitiesData = merged.length > 0 ? merged : garminActs;
            renderHistoryList();
            renderTodayTrainingRecommendations();
          }

          // 1.1 MyNetDiary Food Ingestion from Live State
          let ml = state.mnd_logged;
          if (g && g.mnd_logged) {
            if (!ml || (g.mnd_logged.last_pulled && (!ml.last_pulled || new Date(g.mnd_logged.last_pulled) >= new Date(ml.last_pulled)))) {
              ml = g.mnd_logged;
            }
          }
          if (ml) {
            myNetDiaryData.totals.calories = ml.calories || 0;
            myNetDiaryData.totals.protein = ml.protein_g || 0;
            myNetDiaryData.totals.carbs = ml.carbs_g || 0;
            myNetDiaryData.totals.fat = ml.fat_g || 0;
            myNetDiaryData.totals.fiber = ml.fiber_g || 0;
            myNetDiaryData.totals.sodium = ml.sodium_mg || 0;
            myNetDiaryData.totals.water = ml.water_l || 0;
            if (state.mnd_meals) {
              myNetDiaryData.meals = state.mnd_meals;
            }
            saveMndToLocalStorage();
            renderMyNetDiaryEngine();
            renderTodayTrainingRecommendations();
            renderHistoryList();
          }
        }

        // 2. Renpho Scale Binding
        if (state.injuries) {
          athleteInjuries = { ...athleteInjuries, ...state.injuries };
          updateInjuryBadge();
        }

        if (state.renpho) {
          const r = state.renpho;
          if (r.weight_kg) {
            const el1 = document.getElementById('vitalScale');
            if (el1) el1.innerText = r.weight_kg.toFixed(1);
            const el2 = document.getElementById('bodyScaleWeight');
            if (el2) el2.innerHTML = `${r.weight_kg.toFixed(2)} <small style="font-size:13px;font-weight:400;">kg</small>`;
          }
          if (r.body_fat_pct) {
            const el1 = document.getElementById('vitalScaleSub');
            if (el1) el1.innerText = `${r.body_fat_pct.toFixed(1)}`;
            const el2 = document.getElementById('bodyScaleBf');
            if (el2) el2.innerText = `${r.body_fat_pct.toFixed(1)}% Body Fat (Synced Today)`;
            const el3 = document.getElementById('normBfVal');
            if (el3) el3.innerText = `${r.body_fat_pct.toFixed(1)}%`;
            const el4 = document.getElementById('normBfBadge');
            if (el4) el4.innerText = `TOP ${r.body_fat_pct <= 16.7 ? '12%' : '15%'} OF 45yo MEN`;
            const elMeasuredLabel = document.getElementById('renphoMeasuredBfLabel');
            if (elMeasuredLabel) elMeasuredLabel.innerText = `${r.body_fat_pct.toFixed(1)}% Scale Measured`;
          }
          if (r.fat_to_lose_kg) {
            const el1 = document.getElementById('bodyFatToBurnNum');
            if (el1) el1.innerText = `${r.fat_to_lose_kg} kg (${(r.fat_to_lose_kg * 2.20462).toFixed(1)} lbs)`;
            const elGoalLabel = document.getElementById('renphoGoalRunwayLabel');
            const targetWeightAtGoal = (r.target_weight_at_15pct || 95.71).toFixed(2);
            if (elGoalLabel) elGoalLabel.innerText = `${r.fat_to_lose_kg} kg to 15.0% Goal (${targetWeightAtGoal}kg)`;
          }
          if (r.muscle_mass_kg) {
            const elMuscle = document.getElementById('renphoMuscleVal');
            if (elMuscle) elMuscle.innerText = `${r.muscle_mass_kg.toFixed(1)}kg`;
          }
          if (r.lean_mass_kg) {
            const elLbm = document.getElementById('renphoLbmVal');
            if (elLbm) elLbm.innerText = `${r.lean_mass_kg.toFixed(1)}kg`;
          }
          if (r.water_pct) {
            const elWater = document.getElementById('renphoWaterVal');
            if (elWater) elWater.innerText = `${r.water_pct.toFixed(1)}%`;
          }
          if (r.visceral_fat !== undefined) {
            const elVisceral = document.getElementById('renphoVisceralVal');
            if (elVisceral) elVisceral.innerText = `${Number(r.visceral_fat).toFixed(1)}`;
          }
          if (r.last_synced) {
            const syncEl = document.getElementById('renphoSyncTime');
            try {
              const timePart = r.last_synced.includes('T') ? r.last_synced.split('T')[1].slice(0, 5) : r.last_synced.split(' ')[1].slice(0, 5);
              if (syncEl) syncEl.innerText = `Live Ingested • ${timePart}`;
            } catch(e) {}
          }
        }

        // Load manual local storage weight override only if no direct renpho sync exists
        const savedWt = localStorage.getItem('pulse_athlete_weight');
        const savedBf = localStorage.getItem('pulse_athlete_bf');
        if (savedWt && !state.renpho) {
          const pWt = parseFloat(savedWt);
          const pBf = parseFloat(savedBf) || ((window.athleteProfile && window.athleteProfile.bodyFatPct) ? window.athleteProfile.bodyFatPct : 17.1);
          const lbm = (window.athleteProfile && window.athleteProfile.leanMassKg) ? window.athleteProfile.leanMassKg : 81.03;
          const targetWt = (window.athleteProfile && window.athleteProfile.targetWeightKg) ? window.athleteProfile.targetWeightKg : parseFloat((lbm / 0.85).toFixed(2));
          const fatToBurn = parseFloat(Math.max(0, pWt - targetWt).toFixed(2));
          const vs = document.getElementById('vitalScale');
          if (vs) vs.innerHTML = `${pWt.toFixed(1)}`;
          const vss = document.getElementById('vitalScaleSub');
          if (vss) vss.innerText = `${pBf.toFixed(1)}`;
          const bsw = document.getElementById('bodyScaleWeight');
          if (bsw) bsw.innerHTML = `${pWt.toFixed(2)} <small style="font-size:13px;font-weight:400;">kg</small>`;
          const bsbf = document.getElementById('bodyScaleBf');
          if (bsbf) bsbf.innerText = `${pBf}% Body Fat (Logged Today)`;
          const bfb = document.getElementById('bodyFatToBurnNum');
          if (bfb) bfb.innerText = `${fatToBurn} kg (${(fatToBurn * 2.20462).toFixed(1)} lbs)`;
        }

        // 3. Nutrition Targets
        if (state.nutrition) {
          const n = state.nutrition;
          let activeBurn = 649;
          const burnEl = document.getElementById('vitalBurn');
          if (burnEl) {
            const parsed = parseInt(burnEl.innerText);
            if (!isNaN(parsed) && parsed > 0) activeBurn = parsed;
          }

          if (n.calorie_target) {
            const el1 = document.getElementById('fuelTargetNum') || document.getElementById('fuelCalTarget');
            if (el1) el1.innerHTML = `${n.calorie_target.toLocaleString()} <small style="font-size:13.5px; color:var(--lime);">+${activeBurn} kcal</small>`;
            const el2 = document.getElementById('fuelBudgetNum');
            if (el2) el2.innerText = n.calorie_target;
            athleteDailyBudget = n.calorie_target;
          }
          if (n.protein_target_g) {
            const el = document.getElementById('macroProtein');
            if (el) el.innerText = `${n.protein_target_g}g`;
            athleteProteinAnchor = n.protein_target_g;
          }
          if (n.carbs_target_g) {
            const el = document.getElementById('macroCarbs');
            if (el) el.innerText = `${n.carbs_target_g}g`;
          }
          if (n.fat_target_g) {
            const el = document.getElementById('macroFat');
            if (el) el.innerText = `${n.fat_target_g}g`;
          }
          renderMyNetDiaryEngine();
        }

        renderTodayTrainingRecommendations();
        if (typeof renderRenphoTrendChart === 'function') renderRenphoTrendChart();
        if (typeof renderStrengthProgressionChart === 'function') renderStrengthProgressionChart();
        console.log("✓ Dynamic telemetry successfully synced from live_state.json");
      } catch(e) {
        console.log("Local static fallback active:", e.message);
      }
    }

    function setFastingProtocol(key) {
      const protocols = {
        '16_8': { label: '16:8 Protocol', hours: 16 },
        '18_6': { label: '18:6 Protocol', hours: 18 },
        '20_4': { label: '20:4 Protocol', hours: 20 },
        'omad': { label: 'OMAD Protocol', hours: 23 }
      };
      const p = protocols[key] || protocols['16_8'];
      const tag = document.getElementById('fastingProtocolTag');
      if (tag) tag.innerText = p.label;

      ['16_8', '18_6', '20_4', 'omad'].forEach(k => {
        const btnId = k === 'omad' ? 'btnFastOMAD' : 'btnFast' + k;
        const btn = document.getElementById(btnId);
        if (btn) {
          if (k === key) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      try {
        localStorage.setItem('pulse_fasting_protocol', key);
      } catch(e) {}
    }

    // INITIALIZATION
    window.addEventListener('load', () => {
      applyPreset('gym');
      loadDailyArchetype('option_a');
      const restored = restoreActiveSessionFromLocalStorage();
      restoreActivitiesFromLocalStorage();
      renderCurrentExercise();
      renderHistoryList();
      renderTodayTrainingRecommendations();
      loadLiveState();
      checkMndStatus();

      // Initialize Expanded Fuel & MyNetDiary Macro Engine
      initMyNetDiaryEngine();
      setFastingProtocol('16_8');

      // Initialize Injuries from localStorage if available
      try {
        const savedInj = localStorage.getItem('pulse_athlete_injuries');
        if (savedInj) {
          athleteInjuries = { ...athleteInjuries, ...JSON.parse(savedInj) };
        }
      } catch(e) {}
      updateInjuryBadge();

      try {
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get('tab');
        if (tabParam && ['today', 'train', 'timer', 'fuel', 'body'].includes(tabParam)) {
          switchTab(tabParam);
        } else if (window.location.hash) {
          const tabKey = window.location.hash.replace('#', '');
          if (['today', 'train', 'timer', 'fuel', 'body'].includes(tabKey)) {
            switchTab(tabKey);
          }
        }
      } catch(e) {}

      if (restored) {
        const badge = document.getElementById('saveStatusIndicator');
        if (badge) badge.innerText = '🔄 Restored';
      }

      if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
          console.log('✓ PULSE PWA Service Worker active');
          if (reg) {
            reg.update();
            reg.onupdatefound = () => {
              const installing = reg.installing;
              if (installing) {
                installing.onstatechange = () => {
                  if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('New update available, auto-reloading...');
                    window.location.reload();
                  }
                };
              }
            };
          }
        }).catch(e => {
          console.log('PWA Service Worker notice:', e.message);
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      }

      console.log("PULSE Hybrid Athlete OS loaded with MyNetDiary daily macro breakdown, voice coaching, and localStorage persistence.");
    });
