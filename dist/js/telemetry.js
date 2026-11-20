    let garminMfaState = null;

    function getMatchedPulseSessionForGarmin(act) {
      if (!act) return null;
      const actName = (act.name || '').toLowerCase();
      const actKey = (act.activity_type_key || '').toLowerCase();
      const actSub = (act.subTitle || act.sub_title || '').toLowerCase();
      const isWalkOrRun = actName.includes('walk') || actKey.includes('walk') || actName.includes('running') || actKey.includes('running');
      if (isWalkOrRun) return null;

      const isStrength = actName.includes('strength') || actKey.includes('strength') || actSub.includes('strength');
      const isCardio = actName.includes('cardio') || actKey.includes('cardio') || actName.includes('hiit') || actSub.includes('cardio');
      const isExplicitCombatOrCardio = /body\s*combat|combat|cardio|warm-?up|skip|jump\s*rope|hiit|track/i.test(`${actName} ${actSub} ${act.user_notes || ''}`);
      if (!isStrength && !isCardio && !isExplicitCombatOrCardio) return null;

      let actDateStr = '';
      let actTimeMs = 0;
      const raw = act.rawDate || act.date || '';
      if (typeof raw === 'string') {
        const parsedT = new Date(raw.replace(' ', 'T')).getTime();
        if (!isNaN(parsedT)) actTimeMs = parsedT;
        const m = raw.match(/\d{4}-\d{2}-\d{2}/);
        if (m) {
          actDateStr = m[0];
        } else if (raw.toLowerCase().includes('today') || act.isToday) {
          actDateStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
        }
      }
      if (!actDateStr && act.isToday) {
        actDateStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
      }

      try {
        const candidates = [];
        const histRaw = localStorage.getItem('pulse_session_history');
        if (histRaw) {
          const history = JSON.parse(histRaw);
          if (Array.isArray(history)) {
            history.forEach(s => { if (s && s.date) candidates.push({ ...s, _kind: 'session' }); });
          }
        }
        const condRaw = localStorage.getItem('pulse_conditioning_history');
        if (condRaw) {
          const condHist = JSON.parse(condRaw);
          const condArr = Array.isArray(condHist)
            ? condHist
            : (condHist && typeof condHist === 'object' ? Object.values(condHist) : []);
          condArr.forEach(c => {
            if (c && c.date) {
              candidates.push({
                date: c.date,
                title: `${c.name || 'Conditioning'} (${(c.format || 'interval').toUpperCase()} • ${c.roundsCompleted || c.rounds || 1} rds)`,
                preset: 'combat',
                setsLogged: c.roundsCompleted || c.rounds || 1,
                conditioningDrill: c,
                _kind: 'conditioning'
              });
            }
          });
        }
        if (candidates.length === 0) return null;

        const sameDay = candidates.filter(s => {
          let sDateStr = '';
          const sm = String(s.date).match(/\d{4}-\d{2}-\d{2}/);
          if (sm) {
            sDateStr = sm[0];
          } else {
            const sd = new Date(s.date);
            if (!isNaN(sd.getTime())) {
              sDateStr = `${sd.getFullYear()}-${String(sd.getMonth()+1).padStart(2,'0')}-${String(sd.getDate()).padStart(2,'0')}`;
            }
          }
          return sDateStr && actDateStr && sDateStr === actDateStr;
        });

        if (sameDay.length === 0) return null;

        // Filter by modality FIRST so strength never matches cardio/combat workouts
        let modalitySameDay = [];
        if (isStrength && !isExplicitCombatOrCardio) {
          modalitySameDay = sameDay.filter(s => s._kind === 'session' && s.preset !== 'combat');
        } else if (isCardio || isExplicitCombatOrCardio) {
          modalitySameDay = sameDay.filter(s => s._kind === 'conditioning' || s.preset === 'combat');
        } else {
          return null;
        }

        if (modalitySameDay.length === 0) return null;

        // Pick the closest timestamp within 2 hours from modalitySameDay
        if (actTimeMs > 0) {
          let best = null;
          let bestDiff = Infinity;
          modalitySameDay.forEach(s => {
            const st = new Date(s.date).getTime();
            if (!isNaN(st)) {
              const diff = Math.abs(st - actTimeMs);
              if (diff < bestDiff) {
                bestDiff = diff;
                best = s;
              }
            }
          });
          if (best && bestDiff <= 2 * 3600 * 1000) return best;
        }

        return modalitySameDay[0] || null;
      } catch(e) {
        return null;
      }
    }
    window.getMatchedPulseSessionForGarmin = getMatchedPulseSessionForGarmin;

    function renderCompletedWorkouts(activities) {
      if (typeof renderHistoryList === 'function') {
        return renderHistoryList();
      }
    }
    window.renderCompletedWorkouts = renderCompletedWorkouts;

    async function triggerSilentGarminSync() {
      if (window._silentGarminSyncInFlight) return;
      window._silentGarminSyncInFlight = true;
      window._lastDirectGarminSyncMs = Date.now();
      try {
        const headerBtn = document.getElementById('btnHeaderSync');
        const headerSpan = headerBtn ? headerBtn.querySelector('span:last-child') : null;
        if (headerSpan) headerSpan.innerText = 'Syncing...';
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/garmin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          promptAuthOn401: false
        });
        if (res && res.ok) {
          const data = await res.json();
          if (data && data.state) {
            window.BAKED_LIVE_STATE = data.state;
            applyLiveStateToDom(data.state);
            renderGarminSyncNotice(data.state);
          }
        }
        if (headerSpan) headerSpan.innerText = 'Synced';
      } catch (e) {
        const headerBtn = document.getElementById('btnHeaderSync');
        const headerSpan = headerBtn ? headerBtn.querySelector('span:last-child') : null;
        if (headerSpan) headerSpan.innerText = 'Synced';
      } finally {
        window._silentGarminSyncInFlight = false;
      }
    }
    window.triggerSilentGarminSync = triggerSilentGarminSync;

    function openSyncModal(tab = 'garmin') {
      const modal = document.getElementById('syncModal');
      if (modal) modal.classList.add('open');
      switchSyncTab(tab);
      renderGarminSyncNotice(window.BAKED_LIVE_STATE);
      loadLiveState();
      if ((Date.now() - (window._lastDirectGarminSyncMs || 0)) > 60 * 1000) {
        triggerSilentGarminSync();
      }
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

    // WORKOUT ANNOTATION INTELLIGENCE PARSER (Extracts sets, reps, load, tonnage & movement patterns)
    function parseWorkoutNoteDetails(text, act) {
      const t = String(text || '').toLowerCase();
      const lower = t;
      const srMatch = t.match(/(\d+)\s*(?:sets?\s*(?:of|x|×)\s*|x|×)\s*(\d+)/i);
      const sets = srMatch ? parseInt(srMatch[1], 10) : 0;
      const reps = srMatch ? parseInt(srMatch[2], 10) : 0;
      const totalReps = (sets && reps) ? sets * reps : 0;

      const wtMatch = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
      const weightKg = wtMatch ? parseFloat(wtMatch[1]) : 0;
      const tonnageKg = (totalReps && weightKg) ? Math.round(totalReps * weightKg) : 0;

      const hasKbSwing = /swing|snatch|clean/.test(t);
      const hasHinge = /swing|rdl|deadlift|hinge|snatch|clean|good morning/.test(t);
      const hasSquat = /squat|lunge|split squat|thruster|goblet/.test(t);
      const hasPush = /bench|press|pushup|push-up|dip/.test(t);
      const hasPull = /row|pullup|pull-up|chin|lat|curl/.test(t);
      const hasJumpRope = /jump\s*rope|skip|double\s*under/.test(t) || Boolean(act && act.activity_type_key === 'jump_rope');

      const hasBodyCombat = /body\s*combat|les\s*mills|muay\s*thai|kickbox|shadow\s*box|combat\s*track|karate|taekwondo|boxing/i.test(lower);
      const isCombatWarmup = hasBodyCombat && /warm-?up|track\s*1\b|track\s*2\b/i.test(lower);
      const isCombatLower = hasBodyCombat && /lower\s*body|kick|muay\s*thai|track\s*4|track\s*6|track\s*7/i.test(lower);
      const isCombatUpper = hasBodyCombat && /upper\s*body|punch|jab|cross|hook|track\s*3|track\s*5|track\s*8/i.test(lower);

      return {
        sets,
        reps,
        totalReps,
        weightKg,
        tonnageKg,
        hasKbSwing,
        hasHinge,
        hasSquat,
        hasPush,
        hasPull,
        hasJumpRope,
        hasBodyCombat,
        isCombatWarmup,
        isCombatLower,
        isCombatUpper
      };
    }
    window.parseWorkoutNoteDetails = parseWorkoutNoteDetails;

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

    function renderGarminSyncNotice(state) {
      const notice = document.getElementById('garminStatusNotice');
      if (!notice) return;
      const g = (state && state.garmin) || (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) || {};
      const acts = Array.isArray(g.today_activities) ? g.today_activities : [];
      const totalBurn = acts.reduce((s, a) => s + Number(a.calories || 0), 0) || Number(g.active_calories || 0);
      const steps = Number(g.steps || 0);
      if (acts.length === 0) {
        notice.innerHTML = `
          <div style="font-size:12.5px; font-weight:800; color:var(--primary);">✓ Cloud Sync Active (${steps.toLocaleString()} steps • ${totalBurn} kcal)</div>
          <div style="font-size:11.5px; color:var(--text-muted); line-height:1.35;">No dedicated workouts logged on Garmin today yet.</div>
        `;
        return;
      }
      const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v ?? ''));
      const rowsHtml = acts.map((a, idx) => {
        const title = a.sub_title || a.subTitle || a.name || 'Workout';
        const dur = Number(a.duration_min || a.durationMin || 0).toFixed(1);
        const cals = Number(a.calories || 0);
        const hrVal = a.avg_hr || a.avgHr;
        const hr = hrVal ? ` • Avg HR ${esc(hrVal)} bpm` : '';
        const color = idx === 0 ? 'var(--primary)' : 'var(--cyan)';
        return `<div style="font-size:11.5px; font-weight:700; color:${color}; background:rgba(0,0,0,0.3); padding:5px 7px; border-radius:4px;">⚡ ${esc(title)} (${esc(dur)} min) • ${esc(cals)} kcal${hr}</div>`;
      }).join('');
      notice.innerHTML = `
        <div style="font-size:12.5px; font-weight:800; color:var(--primary);">✓ Cloud Sync Active (${esc(totalBurn)} kcal • ${esc(steps.toLocaleString())} steps)</div>
        <div style="font-size:11.5px; color:#fff; line-height:1.35;">${acts.length} workout${acts.length > 1 ? 's' : ''} recorded today on your Garmin watch:</div>
        <div style="display:flex; flex-direction:column; gap:4px;">${rowsHtml}</div>
        <button class="btn-action-primary" style="height:32px; font-size:12px; background:var(--primary); color:#000; font-weight:800; margin-top:3px;" data-acts-count="${acts.length}" data-total-burn="${esc(totalBurn)}" onclick="acknowledgeGarminSyncNotice(this)">
          ✓ View Ingested Workouts (${esc(totalBurn)} kcal)
        </button>
      `;
    }

    function acknowledgeGarminSyncNotice(btnEl) {
      const cnt = btnEl ? Number(btnEl.getAttribute('data-acts-count') || 0) : 0;
      const burn = btnEl ? Number(btnEl.getAttribute('data-total-burn') || 0) : 0;
      loadLiveState();
      closeSyncModal();
      if (cnt > 0) {
        showToast(`✓ ${cnt} Garmin Workout${cnt > 1 ? 's' : ''} Loaded (${burn} kcal)!`);
      }
    }
    window.acknowledgeGarminSyncNotice = acknowledgeGarminSyncNotice;

    async function triggerGarminCloudSync() {
      const btn = document.getElementById('btnTriggerGarminSync');
      const email = document.getElementById('garminEmailInput')?.value.trim() || '';
      const pass = document.getElementById('garminPassInput')?.value.trim() || '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '↻ CONNECTING TO GARMIN CLOUD...';
      }

      const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
      // Best-effort Renpho cloud sync so clicking Sync always pulls latest weigh-in
      fetcher('/api/renpho/sync', { method: 'POST', promptAuthOn401: false }).catch(() => {});

      try {
        const res = await fetcher('/api/garmin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass }),
          timeoutMs: 25000,
          promptAuthOn401: true
        });

        if (!res.ok || res.status === 404) {
          await loadLiveState();
          renderGarminSyncNotice(window.BAKED_LIVE_STATE);
          showToast(`⚠️ Garmin cloud sync failed (HTTP ${res.status}) — showing cached telemetry`);
          beep(400, 0.14);
          return;
        }

        const data = await res.json();

        if (data.status === 'mfa_required' || data.needs_mfa) {
          garminMfaState = data.client_state;
          document.getElementById('garminMfaBox').style.display = 'flex';
          document.getElementById('garminMfaInput')?.focus();
          showToast('📧 6-Digit MFA code emailed by Garmin. Enter code below.');
          beep(650, 0.1);
        } else if (data.status === 'auth_needed') {
          document.getElementById('garminAuthBox').style.display = 'flex';
          showToast('⚠️ Please enter your Garmin password to authenticate.');
          beep(400, 0.15);
        } else if (data.success || data.status === 'success') {
          if (data.state) {
            window.BAKED_LIVE_STATE = data.state;
            applyLiveStateToDom(data.state);
          }
          await loadLiveState();
          renderGarminSyncNotice(window.BAKED_LIVE_STATE);
          const notice = document.getElementById('garminStatusNotice');
          if (notice) notice.style.display = 'flex';
          updateEquipmentTriggerSummary();

          if (data.garmin_error) {
            const authBox = document.getElementById('garminAuthBox');
            if (authBox) authBox.style.display = 'flex';
            const passInput = document.getElementById('garminPassInput');
            if (passInput) passInput.focus();
            beep(420, 0.15);
            showToast('⚠️ Garmin session expired — MND synced, but enter Garmin password to pull live Body Battery.');
          } else {
            const passEl = document.getElementById('garminPassInput');
            if (passEl) passEl.value = '';
            const mfaEl = document.getElementById('garminMfaInput');
            if (mfaEl) mfaEl.value = '';
            closeSyncModal();
            beep(880, 0.15);
            showToast('✓ Garmin, Renpho & MyNetDiary Synced Live!');
          }
        } else if (data.message === 'Application not found' || data.status === 'error') {
          await loadLiveState();
          renderGarminSyncNotice(window.BAKED_LIVE_STATE);
          const notice = document.getElementById('garminStatusNotice');
          if (notice) notice.style.display = 'flex';
          showToast(`⚠️ Cloud backend error (${data.message || data.error || 'offline'}) — showing cached telemetry`);
          beep(420, 0.14);
        } else {
          showToast(`⚠️ Sync notice: ${data.error || data.message || 'Unable to connect'}`);
        }
      } catch(e) {
        await loadLiveState();
        renderGarminSyncNotice(window.BAKED_LIVE_STATE);
        const notice = document.getElementById('garminStatusNotice');
        if (notice) notice.style.display = 'flex';
        const reason = e && e.name === 'AbortError' ? 'timed out' : 'offline';
        showToast(`⚠️ Garmin sync ${reason} — showing cached telemetry`);
        beep(400, 0.14);
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
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/garmin/submit_mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfa_code: code, client_state: garminMfaState }),
          promptAuthOn401: true
        });
        if (!res || !res.ok) {
          showToast(`MFA Error (HTTP ${res ? res.status : 'offline'})`);
          return;
        }
        const data = await res.json();
        if (data.success || data.status === 'success') {
          if (data.state) {
            window.BAKED_LIVE_STATE = data.state;
            applyLiveStateToDom(data.state);
          }
          const passEl = document.getElementById('garminPassInput');
          if (passEl) passEl.value = '';
          const mfaEl = document.getElementById('garminMfaInput');
          if (mfaEl) mfaEl.value = '';
          const mfaBox = document.getElementById('garminMfaBox');
          if (mfaBox) mfaBox.style.display = 'none';
          await loadLiveState();
          renderGarminSyncNotice(window.BAKED_LIVE_STATE);
          closeSyncModal();
          beep(880, 0.2);
          showToast('✓ Garmin Authenticated & Synced Permanently!');
        } else {
          showToast(`MFA Error: ${data.error || data.message || 'Invalid code'}`);
        }
      } catch(e) {
        showToast('Network error verifying MFA.');
      }
    }
    window.submitGarminMfaCode = submitGarminMfaCode;
    window.submitGarminMfa = submitGarminMfaCode;

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
        localStorage.setItem('pulse_recent_activities', JSON.stringify(recentActivitiesData.slice(0, 60)));
      } catch(err) {}

      renderHistoryList();

      window.BAKED_LIVE_STATE = window.BAKED_LIVE_STATE || {};
      window.BAKED_LIVE_STATE.garmin = window.BAKED_LIVE_STATE.garmin || {};
      window.BAKED_LIVE_STATE.garmin.active_calories = (Number(window.BAKED_LIVE_STATE.garmin.active_calories) || 0) + cal;
      const newBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn() : window.BAKED_LIVE_STATE.garmin.active_calories;
      const fuelBurn = document.getElementById('fuelBurnNum') || document.getElementById('fuelGarminBurn');
      if (fuelBurn) fuelBurn.innerHTML = `${newBurn} <small style="font-size:13px;">kcal</small>`;

      const curTarget = (typeof getCanonicalDailyCalorieTarget === 'function') ? getCanonicalDailyCalorieTarget() : (2092 + newBurn);
      const ftEl = document.getElementById('fuelTargetNum');
      if (ftEl) ftEl.innerHTML = `${curTarget.toLocaleString()} <small style="font-size:13.5px; color:var(--lime);">+${newBurn} kcal</small>`;
      const fbEl = document.getElementById('fuelBudgetNum');
      if (fbEl) fbEl.innerText = curTarget;

      closeSyncModal();
      beep(880, 0.15);
      showToast(`✓ Synced ${subTitle}! (+${cal} kcal)`);

      // Background sync with offline replay queue fallback
      const actPayload = {
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
      };
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/sync_activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(actPayload),
          timeoutMs: 4000
        });
        if (!res || !res.ok) {
          if (typeof enqueueOfflineWrite === 'function' && (!res || res.status >= 500 || res.status === 0)) {
            enqueueOfflineWrite('/api/sync_activity', actPayload, 'POST');
          }
        }
      } catch(e) {
        if (typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/sync_activity', actPayload, 'POST');
        }
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
        act.sub_title = text;
        act.user_notes = text;
        const telemetry = {
          duration_min: act.durationMin || 30,
          calories: act.calories || 250,
          avg_hr: act.avgHr || 125,
          max_hr: act.maxHr || 160,
          aerobic_te: act.aerobicTe || 2.5,
          anaerobic_te: act.anaerobicTe || 1.5
        };
        act.benefits = clientAnalyzeWorkoutBenefits(text, telemetry, { weight_kg: 99.85, body_fat_pct: 17.5 });

        if (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) {
          ['today_activities', 'recent_activities'].forEach(lstKey => {
            const arr = window.BAKED_LIVE_STATE.garmin[lstKey];
            if (Array.isArray(arr)) {
              arr.forEach(a => {
                if (String(a.id) === String(actId)) {
                  a.sub_title = text;
                  a.subTitle = text;
                  a.user_notes = text;
                  a.benefits = act.benefits;
                }
              });
            }
          });
        }

        // Save immediately to localStorage
        try {
          localStorage.setItem('pulse_recent_activities', JSON.stringify(recentActivitiesData.slice(0, 60)));
        } catch(err) {}

        renderHistoryList();
        if (typeof renderTodayTrainingRecommendations === 'function') renderTodayTrainingRecommendations();
        if (typeof renderWeeklyPatternBalance === 'function') renderWeeklyPatternBalance();
        closeAnnotateModal();
        beep(880, 0.2);
        showToast('✓ Workout details & physiological benefits analyzed!');
      }

      // Background sync with offline replay queue fallback
      const annPayload = { activity_id: actId, user_text: text };
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/annotate_activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(annPayload),
          timeoutMs: 4000
        });
        if (!res || !res.ok) {
          if (typeof enqueueOfflineWrite === 'function' && (!res || res.status >= 500 || res.status === 0)) {
            enqueueOfflineWrite('/api/annotate_activity', annPayload, 'POST');
          }
        }
      } catch(e) {
        if (typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/annotate_activity', annPayload, 'POST');
        }
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

      const raw = act.rawDate || (act.date && /^\d{4}-\d{2}-\d{2}/.test(String(act.date)) ? act.date : null);
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
      const rawText = `${act.name || ''} ${act.subTitle || act.sub_title || ''}`;
      const text = rawText.toLowerCase();
      const parsed = parseWorkoutNoteDetails(rawText, act);
      const isHybridPlyoStrength = parsed.hasJumpRope && (parsed.hasKbSwing || parsed.hasHinge || parsed.hasSquat || parsed.hasPush || parsed.hasPull);
      const isBodyCombat = parsed.hasBodyCombat;
      const isStrength = text.includes('strength') || text.includes('barbell') || text.includes('lift') || text.includes('weight') || text.includes('gym') || text.includes('option_a') || text.includes('option a') || text.includes('hypertrophy') || text.includes('rdl') || text.includes('press') || parsed.hasHinge || parsed.hasSquat || parsed.hasPush || parsed.hasPull;
      const isJump = text.includes('jump') || text.includes('plyo') || text.includes('tuck') || text.includes('hop') || parsed.hasJumpRope;
      const isWalk = text.includes('walk') || text.includes('stroll');
      const isRuck = text.includes('ruck') || text.includes('pack');
      const isRun = text.includes('run') || text.includes('sprint') || text.includes('jog');
      const isCardio = text.includes('cardio') || isRun;

      const skipCountStr = act.total_reps ? `${Number(act.total_reps).toLocaleString()} skips` : (text.includes('300') ? '300 jumps' : 'high-cadence plyo');
      const customNoteSummary = (parsed.sets && parsed.reps)
        ? `${parsed.sets}×${parsed.reps}${parsed.weightKg ? ` @ ${parsed.weightKg}kg` : ''} (${parsed.totalReps} total reps${parsed.tonnageKg ? ` • ${parsed.tonnageKg.toLocaleString()} kg volume` : ''})`
        : '';

      let recoveryPill = '';
      let primaryTakeaway = '';

      if (isToday) {
        if (isBodyCombat) {
          recoveryPill = '<span style="background:rgba(0,229,255,0.14); border:1px solid rgba(245,158,11,0.45); color:#38bdf8; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">🥊 Body Combat Conditioning • 12–18h Rotational &amp; Guard Recovery</span>';
          primaryTakeaway = `${act.calories} kcal active burn • High-velocity martial arts striking, rotational core torque &amp; dynamic guard/footwork conditioning (${act.subTitle || act.sub_title}).`;
        } else if (isHybridPlyoStrength) {
          recoveryPill = '<span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.35); color:#f59e0b; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 24–48h Posterior & Calf Recovery • Upper Body Fresh</span>';
          primaryTakeaway = `${act.calories} kcal active burn • ${act.total_reps ? Number(act.total_reps).toLocaleString() + ' Jump Rope skips + ' : ''}${parsed.sets && parsed.reps ? `${parsed.sets}×${parsed.reps}` : 'Ballistic'} ${parsed.weightKg ? `@ ${parsed.weightKg}kg ` : ''}KB Swings${parsed.totalReps ? ` (${parsed.totalReps} ballistic hinges${parsed.tonnageKg ? ` • ${parsed.tonnageKg.toLocaleString()} kg volume` : ''})` : ''}. Combines elastic Achilles/calf plyometrics with explosive posterior-chain hip power.`;
        } else if (isStrength) {
          recoveryPill = '<span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.35); color:#f59e0b; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 24–48h Recovery Window • In Progress</span>';
          primaryTakeaway = `${act.calories || 320} kcal active burn • ${customNoteSummary ? `Logged ${customNoteSummary} • ` : ''}High mechanical tension stimulus achieved. 24–48h required for myofibrillar protein synthesis and CNS recovery.`;
        } else if (isJump) {
          recoveryPill = '<span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.35); color:#f59e0b; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 24–48h Recovery Window • In Progress</span>';
          primaryTakeaway = `${act.calories} kcal active burn • High eccentric tendon loading (${skipCountStr}) requiring 24–48h calf/Achilles & knee extensor recovery.`;
        } else if (isWalk) {
          recoveryPill = '<span style="background:rgba(0,229,255,0.12); border:1px solid rgba(0,229,255,0.35); color:var(--primary); font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">✓ 0h Recovery Debt • Active Flush</span>';
          primaryTakeaway = `${act.calories} kcal active burn • Accelerated metabolic waste clearance with zero central nervous system fatigue.`;
        } else {
          recoveryPill = '<span style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.35); color:#38bdf8; font-size:10px; font-weight:800; padding:2px 7px; border-radius:5px;">⏳ 12–18h Recovery Window • In Progress</span>';
          primaryTakeaway = `${act.calories} kcal active burn • ${customNoteSummary ? `${customNoteSummary} • ` : ''}Stimulated myocardial stroke volume and expanded today's calorie runway.`;
        }
      } else {
        recoveryPill = isBodyCombat
          ? '<span style="background:rgba(0,229,255,0.10); border:1px solid rgba(245,158,11,0.35); color:#38bdf8; font-size:10px; font-weight:700; padding:2px 7px; border-radius:5px;">🥊 Body Combat Conditioning • ✓ Recovered</span>'
          : '<span style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#a1a1aa; font-size:10px; font-weight:700; padding:2px 7px; border-radius:5px;">✓ Fully Recovered</span>';
        primaryTakeaway = isBodyCombat
          ? `${act.calories} kcal active burn • High-velocity martial arts striking, rotational core torque &amp; dynamic guard/footwork conditioning (${act.subTitle || act.sub_title}).`
          : isHybridPlyoStrength
          ? `${act.calories} kcal active burn • ${act.total_reps ? Number(act.total_reps).toLocaleString() + ' skips + ' : ''}${customNoteSummary || 'KB Swings'} fully remodeled; primed for high force output.`
          : isStrength
          ? `${act.calories || 320} kcal active burn • ${customNoteSummary ? `${customNoteSummary} • ` : ''}Myofibrillar protein synthesis and neuromuscular recovery complete; primed for high force output.`
          : isJump 
          ? `${act.calories} kcal burned (${skipCountStr}) • Tendons and calves fully remodeled; primed for high force output.`
          : `${act.calories} kcal active burn • Full physiological adaptation realized; zero residual fatigue debt.`;
      }

      let achievements = [];
      const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v ?? ''));
      const prof = (typeof window !== 'undefined' && window.athleteProfile) ? window.athleteProfile : {};
      const liveState = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const safeSubTitle = esc(act.subTitle || act.sub_title || act.name || '');
      const safeCustomNote = esc(customNoteSummary);
      const lbmNum = (Number.isFinite(Number(prof.leanMassKg)) && Number(prof.leanMassKg) > 0) ? Number(prof.leanMassKg) : null;
      const lbmLabel = lbmNum !== null ? `${lbmNum.toFixed(2)} kg lean mass` : 'lean muscle mass';
      const protAnchor = (liveState.nutrition && Number(liveState.nutrition.protein_target_g) > 0) ? Number(liveState.nutrition.protein_target_g) : 200;

      if (isBodyCombat) {
        achievements.push(`<strong>High-Velocity Striking &amp; Rotational Core Power:</strong> Rapid kinetic-chain force transfer from rear-foot pivot through pelvic rotation to anterior deltoid/serratus punch extension and hip-flexor kick chambers.`);
        achievements.push(`<strong>Cardiovascular &amp; Glycolytic Conditioning:</strong> Avg HR ${esc(act.avgHr || '--')} bpm (Peak ${esc(act.maxHr || '--')} bpm). Repeated striking combinations drive VO2 stroke volume and lactate clearance without axial spinal compression.`);
        achievements.push(`<strong>Target Muscular Activation:</strong> Anterior/Lateral Deltoids (Boxer Guard), Serratus Anterior, External/Internal Obliques, Iliopsoas (Hip Flexors), Gastrocnemius/Soleus (Dynamic Footwork).`);
      } else if (isHybridPlyoStrength) {
        const setsN = Number(parsed.sets || 5);
        const repsN = Number(parsed.reps || 12);
        const totalRepsN = Number(parsed.totalReps || (setsN * repsN));
        const maxHrVal = Number(act.maxHr || 0);
        const hrMaxStr = maxHrVal > 0 ? ` (${Math.round((maxHrVal / 190) * 100)}% HRmax)` : '';
        achievements.push(`<strong>Ballistic Posterior-Chain & Hip Hinge Output:</strong> Completed ${setsN} sets × ${repsN} reps (${totalRepsN} total reps${parsed.weightKg ? ` @ ${parsed.weightKg}kg = ${(parsed.tonnageKg || 0).toLocaleString()} kg ballistic load` : ''}), recruiting gluteus maximus, hamstrings, latissimus dorsi, and spinal erectors alongside ${act.total_reps ? Number(act.total_reps).toLocaleString() + ' jump rope skips' : 'cardio intervals'}.`);
        achievements.push(`<strong>Cardiovascular & Autonomic Priming:</strong> Avg HR ${esc(act.avgHr || '--')} bpm with interval peaks to ${esc(act.maxHr || '--')} bpm${hrMaxStr}. Aerobic TE ${Number(act.aerobicTe || 0).toFixed(1)} + Anaerobic TE ${Number(act.anaerobicTe || 0).toFixed(1)} drove both mitochondrial density and fast-twitch glycolytic power.`);
        achievements.push(`<strong>Metabolic & Lean Mass Preservation:</strong> ${esc(act.calories || 0)} kcal active expenditure expanded today's calorie runway while high-velocity KB hip extension signaled retention of your ${lbmLabel}.`);
      } else if (isStrength) {
        if (customNoteSummary) {
          achievements.push(`<strong>Annotated Volume & Tonnage:</strong> Logged ${safeCustomNote} (${safeSubTitle}), delivering targeted mechanical tension.`);
        }
        achievements.push(`<strong>Mechanical Tension & Lean Mass Preservation:</strong> Recruited high-threshold motor units across primary kinetic chains. High mechanical load signals your endocrine system to preserve ${lbmLabel} while oxidizing fat in your deficit.`);
        achievements.push(`<strong>Metabolic & EPOC Expansion:</strong> ${esc(act.calories || 0)} kcal active expenditure elevated excess post-exercise oxygen consumption (EPOC) for 12–24 hours, stimulating elevated mitochondrial respiration.`);
        const maxHrVal = Number(act.maxHr || 0);
        const hrMaxStr = maxHrVal > 0 ? ` (${Math.round((maxHrVal / 190) * 100)}% HRmax)` : '';
        achievements.push(`<strong>Cardiovascular & Autonomic Priming:</strong> Avg HR ${esc(act.avgHr || '--')} bpm with interval peaks to ${esc(act.maxHr || '--')} bpm${hrMaxStr}. Aerobic TE ${Number(act.aerobicTe || 0).toFixed(1)} + Anaerobic TE ${Number(act.anaerobicTe || 0).toFixed(1)}.`);
      } else {
        if (customNoteSummary) {
          achievements.push(`<strong>Session Breakdown:</strong> Completed ${safeCustomNote} (${safeSubTitle}).`);
        }
        const maxHrVal = Number(act.maxHr || 0);
        const hrPctStr = maxHrVal > 0 ? `, ${Math.round((maxHrVal / 190) * 100)}% HRmax` : '';
        achievements.push(`<strong>Cardiovascular & Aerobic Capacity:</strong> Avg HR ${esc(act.avgHr || '--')} bpm (Peak ${esc(act.maxHr || '--')} bpm${hrPctStr}). Aerobic TE ${Number(act.aerobicTe || 0).toFixed(1)} expanded myocardial stroke volume and mitochondrial capillary density in slow/fast oxidative fibers.`);
        achievements.push(`<strong>Metabolic Fat Loss Runway:</strong> ${esc(act.calories || 0)} kcal active expenditure dynamically expanded your daily calorie runway while protecting your ${(liveState.nutrition && Number(liveState.nutrition.deficit)) || 350} kcal deficit towards 15.0% body fat. Stimulates excess post-exercise oxygen consumption (EPOC) for 4–8 hours.`);
      }
      if (!isBodyCombat) {
        const musclesRaw = (act.benefits && (act.benefits.muscles || act.benefits.muscles_worked)) || (isHybridPlyoStrength ? "Gluteus Maximus, Biceps Femoris & Semitendinosus (Hamstrings), Calves & Achilles Tendon Complex, Latissimus Dorsi, Core Brace" : (isStrength ? "Pectoralis Major, Triceps Brachii, Latissimus Dorsi, Posterior Hamstring Chain, Gluteus Complex" : "Cardiovascular Myocardium, Core Stabilizers, Lower Extremity Postural Chain"));
        achievements.push(`<strong>Target Muscular Activation:</strong> Recruited ${esc(musclesRaw)}.`);
      }

      let stressors = [];
      const athleteWt = (Number.isFinite(Number(prof.weightKg)) && Number(prof.weightKg) > 0) ? Number(prof.weightKg) : null;
      if (isBodyCombat) {
        stressors.push(`<strong>Shoulder Guard &amp; Rotational Oblique Endurance:</strong> Sustained isometric guard elevation and high-speed punch retraction create localized anterior deltoid and scapular stabilizer fatigue.`);
        stressors.push(`<strong>Dynamic Footwork &amp; Hip-Flexor Load:</strong> High-cadence directional agility and kick deceleration load the calves and iliopsoas with low-to-moderate joint shear.`);
      } else if (isHybridPlyoStrength) {
        const grfLabel = athleteWt ? ` (~${Math.round(athleteWt * 3.5)}–${Math.round(athleteWt * 4.5)} kg peak ground force)` : '';
        const repsLabel = parsed.totalReps || (parsed.sets && parsed.reps ? parsed.sets * parsed.reps : 'ballistic');
        stressors.push(`<strong>Dual Plyometric + Ballistic Hinge Load:</strong> ${act.total_reps ? Number(act.total_reps).toLocaleString() + ' elastic skips' : 'Jump rope intervals'}${grfLabel} taxed the Achilles/patellar tendons, while ${repsLabel} ${parsed.weightKg ? parsed.weightKg + 'kg ' : ''}KB swings loaded eccentric hamstring deceleration and lumbar erectors.`);
        stressors.push(`<strong>Targeted Local Fatigue (Upper Body Spared):</strong> Calves, ankles, and posterior hip hinge absorbed high mechanical work, whereas horizontal push (chest/shoulders/triceps) and upper-back pulling remain un-fatigued.`);
      } else if (isStrength) {
        stressors.push(`<strong>Myofibrillar Microtrauma:</strong> Eccentric muscle contraction caused micro-tears in sarcomeres; requires elevated amino acid availability (${protAnchor}g protein target) for cellular remodeling.`);
        stressors.push(`<strong>Central Nervous System (CNS) Fatigue:</strong> Heavy mechanical loading taxes sympathetic pathways and neuromuscular junctions; parasympathetic tone dips temporarily.`);
        stressors.push(`<strong>Connective Tissue Strain:</strong> Tendinous junctions and joint capsules subjected to high tensile force; requires 24–48h recovery prior to repeating heavy axial loading on the same kinetic chain.`);
      } else if (isJump) {
        const grfLabel = athleteWt ? ` (~${Math.round(athleteWt * 3.5)}–${Math.round(athleteWt * 4.5)} kg per landing at ${athleteWt.toFixed(1)} kg)` : '';
        stressors.push(`<strong>Joint & Tendon Impact:</strong> Peak eccentric ground reaction forces reached 3.5–4.5× bodyweight${grfLabel} across ${esc(skipCountStr)}. Created significant tensile strain on the patellar tendons and Achilles spring complex.`);
        stressors.push(`<strong>Neuromuscular Debt:</strong> High fast-twitch motor unit fatigue; temporary depletion of intramuscular phosphocreatine and localized calf stiffness.`);
      } else if (isWalk) {
        const walkForce = athleteWt ? ` (~1.2× bodyweight, ~${Math.round(athleteWt * 1.2)} kg per stride)` : ' (~1.2× bodyweight)';
        stressors.push(`<strong>Joint & Spinal Stress:</strong> Negligible ground reaction forces${walkForce}. Promoted knee/hip synovial fluid circulation and axial lumbar decompression with zero joint trauma.`);
        stressors.push(`<strong>Systemic Stress:</strong> Zero CNS or metabolic debt; promotes parasympathetic relaxation.`);
      } else {
        const modForce = athleteWt ? ` (~2.0–2.5× bodyweight, ~${Math.round(athleteWt * 2.0)}–${Math.round(athleteWt * 2.5)} kg per stride)` : ' (~2.0–2.5× bodyweight)';
        stressors.push(`<strong>Biomechanical Load:</strong> Rhythmic ground impacts${modForce} created moderate lower extremity fatigue and temporary synovial friction.`);
        stressors.push(`<strong>Metabolic & Electrolyte Loss:</strong> Moderate glycogen depletion in working muscles and perspiration sodium loss (~600–800mg). Temporary sympathetic nervous system elevation.`);
      }

      let recoveryProtocol = [];
      const protStatus = getLiveProteinTelemetry();
      const protStr = protStatus.achieved
        ? `${protStatus.logged}g already logged ✓ (Target surpassed)`
        : `${protStatus.logged}g logged / ${protStatus.target}g target • ${protStatus.remaining}g remaining`;
      const benchPrescribed = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('Barbell Bench Press', '70kg') : 'prescribed Bench';
      const rowPrescribed = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad('Pendlay Row', 'prescribed Row') : 'prescribed Row';
      const kbSwingsDone = (parsed.sets && parsed.reps) ? (parsed.sets * parsed.reps) : (parsed.totalReps || 'your');

      if (isBodyCombat) {
        recoveryProtocol.push(`<strong>Optimal Strength Pairing:</strong> Because Body Combat uses high-velocity unloaded striking, it pairs ideally as a warm-up or metabolic bookend around heavy low-rep Barbell Strength (` + (isToday ? `like your ${esc(benchPrescribed)} Bench &amp; ${esc(rowPrescribed)} Row block today` : `Bench/Squat/Row`) + `).`);
        recoveryProtocol.push(`<strong>Nutritional &amp; Guard Recovery:</strong> Hit your ${protStatus.target}g daily protein target (${protStr}) and replenish electrolytes to restore deltoid/oblique endurance.`);
      } else if (isHybridPlyoStrength) {
        recoveryProtocol.push(`<strong>Kinetic Chain Recovery Status:</strong> Calves/Achilles and posterior hip hinge (hamstrings/glutes) were loaded today (allow 24–36h before high-volume ballistic hinging), while <strong>Upper Push (Bench/Overhead)</strong> and <strong>Upper Pull (Rows)</strong> remain <strong>100% fresh for tomorrow</strong>.`);
        recoveryProtocol.push(`<strong>Nutritional Action:</strong> Hit your ${protStatus.target}g daily protein target (${protStr}) and replenish electrolytes to support tendon collagen synthesis and hamstring remodeling.`);
        recoveryProtocol.push(`<strong>Optimal Tomorrow Pairing (Assuming Good Sleep):</strong> Heavy Upper Push/Pull Priority (Barbell Bench Press ${esc(benchPrescribed)} × 8, Pendlay Rows ${esc(rowPrescribed)} × 8, Z-Press) + Back Squats if calves feel fresh (keep RDL volume light since ${esc(kbSwingsDone)} ballistic KB swings already hit the hinge pattern).`);
      } else if (isStrength) {
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
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        fetcher('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        }).then(res => {
          if ((!res || !res.ok) && typeof enqueueOfflineWrite === 'function' && (!res || res.status >= 500 || res.status === 0)) {
            enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
          }
        }).catch(() => {
          if (typeof enqueueOfflineWrite === 'function') {
            enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
          }
        });
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
        showToast(text.length > 0
          ? '⚠️ Joint not recognized from notes — tap the affected joint chip above'
          : '⚠️ Please describe your symptoms or select a joint above');
        beep(300, 0.1);
        return;
      }

      renderInjuryRules();
      updateInjuryBadge();

      const prof = (typeof window !== 'undefined' && window.athleteProfile) ? window.athleteProfile : {};
      const liveState = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const g = liveState.garmin || {};
      const r = liveState.renpho || {};
      const weight = Number.isFinite(Number(prof.weightKg)) ? Number(prof.weightKg) : (Number.isFinite(Number(r.weight_kg)) ? Number(r.weight_kg) : null);
      const leanMass = Number.isFinite(Number(prof.leanMassKg)) ? Number(prof.leanMassKg) : (Number.isFinite(Number(r.lean_mass_kg)) ? Number(r.lean_mass_kg) : null);
      const sleepScore = Number.isFinite(Number(prof.sleepScore)) ? Number(prof.sleepScore) : (g.sleep_score != null ? Number(g.sleep_score) : null);
      const rhr = Number.isFinite(Number(prof.restingHr)) ? Number(prof.restingHr) : (g.resting_hr != null ? Number(g.resting_hr) : null);
      const sleepDurStr = g.sleep_duration || g.sleep_duration_str || null;
      const waterPct = (r.water_pct != null && Number.isFinite(Number(r.water_pct))) ? Number(r.water_pct) : null;
      const protTarget = (liveState.nutrition && Number(liveState.nutrition.protein_target_g) > 0) ? Number(liveState.nutrition.protein_target_g) : 200;
      const todayActs = Array.isArray(g.today_activities) ? g.today_activities : [];
      const recentActs = Array.isArray(g.recent_activities) ? g.recent_activities : [];
      const latestAct = todayActs[0] || recentActs[0] || null;
      const actDur = latestAct ? Number(latestAct.duration_min || latestAct.durationMin || 0) : 0;
      const actCal = latestAct ? Number(latestAct.calories || 0) : 0;
      const actSummaryStr = (latestAct && (actDur > 0 || actCal > 0))
        ? `Recent ${actDur > 0 ? actDur.toFixed(1) + 'm ' : ''}${(typeof escapeHtml === 'function' ? escapeHtml(latestAct.name || 'session') : (latestAct.name || 'session'))}${actCal > 0 ? ' (' + actCal + ' kcal)' : ''} plus cumulative impact load contributed to patellar tendon tensile strain.`
        : `Cumulative lower-limb impact and ground-reaction loading contributed to acute patellar tendon tensile strain.`;

      const wtLabel = weight !== null ? `At <strong>${weight.toFixed(1)} kg</strong> bodyweight` : `At current bodyweight`;
      const peakForceLabel = weight !== null ? ` (~<strong>${Math.round(weight * 2.5)} kg</strong> per stride)` : '';
      const leanLabel = leanMass !== null ? `<strong>${leanMass.toFixed(1)} kg</strong> lean muscle mass` : `lean muscle mass`;

      const primaryJoint = activeJoints[0];
      const rule = injuryRules[primaryJoint] || injuryRules.knees;

      let rootCauseText = "";
      let swapPrescription = "";

      if (primaryJoint === 'knees') {
        rootCauseText = `${wtLabel}, foot strikes during upright cardio generate peak patellofemoral reaction forces of ~2.5× bodyweight${peakForceLabel}. ${actSummaryStr}`;
        swapPrescription = `Today's workout is automatically switched to <strong>Option A: Heavy Barbell Hinge & Push</strong>. Romanian Deadlifts (pure posterior chain hip hinge) eliminate patellofemoral shear completely while protecting your ${leanLabel}.`;
      } else if (primaryJoint === 'lumbar') {
        rootCauseText = `Spinal erectors and lumbar stabilizing ligaments are experiencing compressive fatigue. ${wtLabel}, axial loading under fatigued stabilizers increases shear across L4-S1.`;
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
        rootCauseText = `Achilles tendon and soleus myofascial tightness from high-impact cyclical ground strikes${weight !== null ? ' at <strong>' + weight.toFixed(1) + ' kg</strong>' : ''}.`;
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
        sleepScore,
        sleepDurStr,
        rhr,
        protTarget,
        waterPct,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      athleteInjuries.assessment = assessmentData;
      athleteInjuries.notes = assessmentData.notes;

      renderAssessmentResultCard(assessmentData);

      try {
        localStorage.setItem('pulse_athlete_injuries', JSON.stringify(athleteInjuries));
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        fetcher('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        }).then(res => {
          if ((!res || !res.ok) && typeof enqueueOfflineWrite === 'function' && (!res || res.status >= 500 || res.status === 0)) {
            enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
          }
        }).catch(() => {
          if (typeof enqueueOfflineWrite === 'function') {
            enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
          }
        });
      } catch(e) {}

      loadDailyArchetype(currentArchetypeKey || 'option_a');
      beep(880, 0.15);
      showToast(`🛡️ Biomechanical Assessment Generated: ${rule.title}`);
    }

    function renderAssessmentResultCard(data) {
      const container = document.getElementById('injuryAssessmentResult');
      if (!container || !data) return;

      const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v ?? ''));
      const liveState = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
      const g = liveState.garmin || {};
      const r = liveState.renpho || {};
      const liveSleep = data.sleepScore != null ? data.sleepScore : (g.sleep_score != null ? Number(g.sleep_score) : null);
      const liveSleepDur = data.sleepDurStr || g.sleep_duration || null;
      const liveRhr = data.rhr != null ? data.rhr : (g.resting_hr != null ? Number(g.resting_hr) : null);
      const liveProt = data.protTarget || (liveState.nutrition && Number(liveState.nutrition.protein_target_g)) || 200;
      const liveWater = data.waterPct != null ? data.waterPct : (r.water_pct != null ? Number(r.water_pct) : null);

      const sleepSummary = liveSleep !== null
        ? `Garmin Sleep Score of <strong>${esc(liveSleep)}</strong>${liveSleepDur ? ' (' + esc(liveSleepDur) + ')' : ''}`
        : `Latest Garmin sleep telemetry`;
      const rhrSummary = liveRhr !== null
        ? `and Resting HR of <strong>${esc(liveRhr)} bpm</strong>`
        : `and cardiac readiness trends`;
      const waterSummary = liveWater !== null
        ? `and <strong>${esc(liveWater.toFixed(1))}% body water</strong>`
        : `and daily hydration targets`;

      container.style.display = 'block';
      container.innerHTML = `
        <div class="card" style="background:linear-gradient(165deg, rgba(20, 25, 45, 0.95) 0%, rgba(10, 15, 29, 0.98) 100%); border:1px solid rgba(0, 240, 255, 0.4); border-top:1px solid rgba(255, 255, 255, 0.3); border-radius:14px; padding:12px 14px; box-shadow:0 8px 30px rgba(0,0,0,0.8), 0 0 20px rgba(0,240,255,0.18);">
          
          <!-- GOLDFISH TIER: 5-SECOND EXECUTIVE ACTION -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:10px; font-weight:800; color:var(--lime); background:rgba(34,197,94,0.14); border:1px solid rgba(34,197,94,0.4); padding:2px 8px; border-radius:6px; letter-spacing:0.04em;">
              🟢 SYSTEMIC CNS CLEAR • 🛡️ LOCAL TISSUE DELOAD
            </span>
            <span style="font-size:10px; color:var(--text-muted);">${esc(data.timestamp || 'Live Ingested')}</span>
          </div>

          <div style="font-size:13.5px; font-weight:800; color:#fff; line-height:1.35; margin-bottom:6px;">
            ${esc(data.statusTitle)}
          </div>

          <div style="font-size:12px; color:#d4d4d8; line-height:1.45; margin-bottom:8px;">
            <strong>Systemic Recovery:</strong> ${sleepSummary} ${rhrSummary} guide today's local mechanical load limits. Your systemic conditioning stays active; you do <em>not</em> need total rest, only targeted mechanical deloading of the affected tissue.
          </div>

          <div style="font-size:12px; color:#cbd5e1; line-height:1.45; background:rgba(0,240,255,0.06); border:1px solid rgba(0,240,255,0.25); border-radius:8px; padding:8px 10px; margin-bottom:8px;">
            ${data.swapPrescription}
          </div>

          <!-- BANNED VS SAFE EXERCISES (EXECUTIVE GLANCE) -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
            <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 8px;">
              <div style="font-size:10.5px; font-weight:800; color:#fca5a5; margin-bottom:3px;">🚫 ELIMINATED TODAY:</div>
              <div style="font-size:11px; color:#e2e8f0; line-height:1.3;">
                ${(data.banned || []).slice(0, 3).map(b => '• ' + esc(b)).join('<br>')}
              </div>
            </div>
            <div style="background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); border-radius:8px; padding:6px 8px;">
              <div style="font-size:10.5px; font-weight:800; color:var(--lime); margin-bottom:3px;">✅ PRESCRIBED SWAPS:</div>
              <div style="font-size:11px; color:#e2e8f0; line-height:1.3;">
                ${(data.safe || []).slice(0, 3).map(s => '• ' + esc(s)).join('<br>')}
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
                ${esc(data.decompression)}
              </div>
              <div>
                <strong style="color:#38bdf8; font-size:11.5px;">3. Tissue Remodeling & Recovery Horizon:</strong><br>
                Expected recovery to full compound tolerance: <strong>24–48 hours</strong> with impact deload. Your <strong>${esc(liveProt)}g daily protein anchor</strong> ${waterSummary} supply amino acids and synovial support for collagen remodeling.
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

      // Persist to server with offline queue fallback
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        });
        if ((!res || !res.ok) && typeof enqueueOfflineWrite === 'function' && (!res || res.status >= 500 || res.status === 0)) {
          enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
        }
      } catch(e) {
        if (typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
        }
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


    function selectGoal(goalKey, opts = {}) {
      const resolvedKey = (typeof athleteGoals !== 'undefined' && athleteGoals[goalKey]) ? goalKey : 'recomp';
      currentGoalKey = resolvedKey;
      const goal = (typeof athleteGoals !== 'undefined') ? athleteGoals[resolvedKey] : null;
      if (!goal) return;

      const hdrGoalEl = document.getElementById('hdrGoal');
      if (hdrGoalEl) hdrGoalEl.innerText = goal.badge;
      const todayGoalTitleEl = document.getElementById('todayGoalTitle');
      if (todayGoalTitleEl) todayGoalTitleEl.innerText = goal.title;
      const todayGoalSubEl = document.getElementById('todayGoalSub');
      if (todayGoalSubEl) todayGoalSubEl.innerText = goal.sub;

      const activeBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn() : 0;
      const dynamicTarget = (typeof getCanonicalDailyCalorieTarget === 'function')
        ? getCanonicalDailyCalorieTarget()
        : (goal.calories + activeBurn);
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
      const optEl = document.getElementById(`opt_${resolvedKey}`);
      if (optEl) optEl.classList.add('selected');

      try {
        localStorage.setItem('pulse_current_goal', resolvedKey);
      } catch(e) {}

      if (typeof renderMyNetDiaryEngine === 'function') renderMyNetDiaryEngine();
      if (!(opts && opts.fromBoot)) {
        if (typeof closeGoalModal === 'function') closeGoalModal();
        if (typeof generateWorkoutFromGearAndGoal === 'function') generateWorkoutFromGearAndGoal();
        if (typeof showToast === 'function') showToast(`🎯 Active Target switched to ${goal.title}`);
      }
    }

    // RATIONALE MODAL
    function openRationaleModal() {
      const esc = (typeof escapeHtml === 'function') ? escapeHtml : (v => String(v ?? ''));
      const profile = presetProfiles[currentPreset] || presetProfiles.custom;
      const subEl = document.getElementById('modalRationaleSub');
      if (subEl) subEl.innerText = `Why this ${currentPreset.toUpperCase()} session was chosen for you`;
      const tagEl = document.getElementById('modalModalityTag');
      if (tagEl) tagEl.innerText = profile.badge.split('•')[1]?.trim() || "Dynamic Modality";
      const descEl = document.getElementById('modalModalityDesc');
      if (descEl) descEl.innerText = profile.summary;

      const listEl = document.getElementById('modalRationaleList');
      if (listEl) {
        listEl.innerHTML = '';
        activeWorkoutPlan.forEach((ex, idx) => {
          const item = document.createElement('div');
          item.style.cssText = 'background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:4px 6px;';
          const wLabel = typeof ex.targetWeight === 'number' ? `${ex.targetWeight}kg` : ex.targetWeight;
          item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1px;">
              <strong style="font-size:13px; color:#fff;">${idx + 1}. ${esc(ex.name)}</strong>
              <span style="font-size:11.5px; color:var(--lime); font-weight:800;">${esc(ex.setsCount)} × ${esc(ex.targetReps)} @ ${esc(wLabel)}</span>
            </div>
            <div style="font-size:12px; color:var(--cyan); line-height:1.25;">
              ${esc(ex.rationale || 'Selected for target biomechanical recruitment.')}
            </div>
          `;
          listEl.appendChild(item);
        });
      }
      const modalEl = document.getElementById('rationaleModal');
      if (modalEl) modalEl.classList.add('open');
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
          weightKg: null,
          bodyFatPct: null,
          leanMassKg: null,
          targetBfPct: 15.0,
          targetWeightKg: null,
          fatToLoseKg: null,
          restingHr: null,
          sleepScore: null,
          readiness: null
        };
      }
      if (state.athlete) {
        const a = state.athlete;
        if (a.weight_kg != null) window.athleteProfile.weightKg = Number(a.weight_kg);
        if (a.body_fat_pct != null) window.athleteProfile.bodyFatPct = Number(a.body_fat_pct);
        if (a.lean_mass_kg != null) window.athleteProfile.leanMassKg = Number(a.lean_mass_kg);
        if (a.target_weight_kg != null) window.athleteProfile.targetWeightKg = Number(a.target_weight_kg);
        if (a.fat_to_lose_kg != null) window.athleteProfile.fatToLoseKg = Number(a.fat_to_lose_kg);
        if (a.target_body_fat_pct != null) window.athleteProfile.targetBfPct = Number(a.target_body_fat_pct);
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
      }
      if (state.garmin) {
        const g = state.garmin;
        if (g.resting_hr !== undefined && g.resting_hr !== null) window.athleteProfile.restingHr = Number(g.resting_hr);
        if (g.sleep_score !== undefined && g.sleep_score !== null) window.athleteProfile.sleepScore = Number(g.sleep_score);
        if (g.training_readiness !== undefined && g.training_readiness !== null) window.athleteProfile.readiness = Number(g.training_readiness);
      }

      // Check if manual weigh-in was saved today and renpho data is older
      const todayIso = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
      const manualScaleDate = localStorage.getItem('pulse_manual_scale_date');
      const savedWt = localStorage.getItem('pulse_athlete_weight');
      const savedBf = localStorage.getItem('pulse_athlete_bf');
      const isManualToday = manualScaleDate === todayIso;
      const renphoLastSynced = (state && state.renpho && state.renpho.last_synced) ? String(state.renpho.last_synced).slice(0, 10) : '';
      const renphoIsOlder = !renphoLastSynced || renphoLastSynced < todayIso;

      if (isManualToday && renphoIsOlder && savedWt) {
        const pWt = parseFloat(savedWt);
        const pBf = parseFloat(savedBf) || window.athleteProfile.bodyFatPct;
        const lbm = Number.isFinite(Number(window.athleteProfile.leanMassKg)) ? Number(window.athleteProfile.leanMassKg) : (Number.isFinite(pWt) && Number.isFinite(pBf) ? parseFloat((pWt * (1 - pBf / 100)).toFixed(2)) : null);
        const targetWt = Number.isFinite(Number(window.athleteProfile.targetWeightKg))
          ? Number(window.athleteProfile.targetWeightKg)
          : (lbm !== null ? parseFloat((lbm / 0.85).toFixed(2)) : null);
        const fatToBurn = (targetWt !== null && Number.isFinite(pWt)) ? parseFloat(Math.max(0, pWt - targetWt).toFixed(2)) : null;
        if (Number.isFinite(pWt)) window.athleteProfile.weightKg = pWt;
        if (Number.isFinite(pBf)) window.athleteProfile.bodyFatPct = pBf;
        if (lbm !== null) window.athleteProfile.leanMassKg = lbm;
        if (targetWt !== null) window.athleteProfile.targetWeightKg = targetWt;
        if (fatToBurn !== null) window.athleteProfile.fatToLoseKg = fatToBurn;
      }

      const prof = window.athleteProfile;
      const hasWt = Number.isFinite(Number(prof.weightKg)) && Number(prof.weightKg) > 0;
      const hasBf = Number.isFinite(Number(prof.bodyFatPct)) && Number(prof.bodyFatPct) > 0;
      const hasLbm = Number.isFinite(Number(prof.leanMassKg)) && Number(prof.leanMassKg) > 0;
      const hasTargetWt = Number.isFinite(Number(prof.targetWeightKg)) && Number(prof.targetWeightKg) > 0;
      const hasFatLoss = Number.isFinite(Number(prof.fatToLoseKg)) && Number(prof.fatToLoseKg) >= 0;
      const hasRhr = Number.isFinite(Number(prof.restingHr)) && Number(prof.restingHr) > 0;

      // Dynamically update Body-tab / Today-tab elements
      const elTargetWt = document.getElementById('bodyTargetWeightNum');
      if (elTargetWt) elTargetWt.innerHTML = hasTargetWt ? `${Number(prof.targetWeightKg).toFixed(2)} <small style="font-size:13px; font-weight:500; color:var(--primary);">kg</small>` : `-- <small style="font-size:13px; font-weight:500; color:var(--primary);">kg</small>`;

      const elLbmProtected = document.getElementById('bodyLeanMassProtected');
      if (elLbmProtected) elLbmProtected.innerText = hasLbm ? `Lean Mass: ${Number(prof.leanMassKg).toFixed(2)} kg Protected` : 'Lean Mass: Pending Sync';

      const elCoachLbm = document.getElementById('coachBriefingLbm');
      if (elCoachLbm) elCoachLbm.innerText = hasLbm ? `${Number(prof.leanMassKg).toFixed(1)}kg Pure Lean Muscle` : 'Lean Muscle Mass';

      const elNormLbm = document.getElementById('normLbmVal');
      if (elNormLbm) {
        if (hasLbm) {
          const lbmN = Number(prof.leanMassKg);
          const lbs = (lbmN * 2.20462).toFixed(1);
          elNormLbm.innerText = `${lbmN.toFixed(2)} kg (${lbs} lbs)`;
        } else {
          elNormLbm.innerText = '--';
        }
      }

      const elCoachBody = document.getElementById('coachBriefingBody');
      if (elCoachBody) {
        if (hasWt && hasLbm) {
          const wt = Number(prof.weightKg).toFixed(1);
          const lbm = Number(prof.leanMassKg).toFixed(2);
          const fatLoss = hasFatLoss ? Number(prof.fatToLoseKg).toFixed(2) : '--';
          const rhr = hasRhr ? Math.round(Number(prof.restingHr)) : '--';
          elCoachBody.innerHTML = `At <strong>190.5 cm (6'3") and ${wt} kg</strong>, standard medical BMI tables lazily categorize you as "overweight," completely failing to recognize that <strong>${lbm} kg is pure fat-free lean muscle mass</strong>. You have the athletic frame of a high-level decathlete or rugby back. You are already in the top 15% for body composition and top 1% for cardiovascular stroke volume (${rhr} bpm RHR). Your target of shedding <strong>${fatLoss} kg fat</strong> is not a drastic cut — it is precision tuning to reveal your muscular definition while protecting your joints.`;
        } else {
          elCoachBody.innerText = 'Sync Renpho scale and Garmin telemetry to unlock personalized lean-mass & cardiovascular composition analysis.';
        }
      }

      const elNormBfNote = document.getElementById('normBfNote');
      if (elNormBfNote) {
        const targetBf = (Number.isFinite(Number(prof.targetBfPct)) ? Number(prof.targetBfPct) : 15.0).toFixed(1);
        if (hasBf && hasFatLoss) {
          const bf = Number(prof.bodyFatPct).toFixed(1);
          const fatLoss = Number(prof.fatToLoseKg).toFixed(2);
          elNormBfNote.innerHTML = `Average 45yo male in UK/US carries <strong>24%–28% body fat</strong>. Your ${bf}% places you firmly in the fit/athletic tier. You are only <strong>${fatLoss} kg</strong> away from your ${targetBf}% milestone!`;
        } else {
          elNormBfNote.innerHTML = `Average 45yo male in UK/US carries <strong>24%–28% body fat</strong>. Sync Renpho telemetry to track distance to your ${targetBf}% milestone.`;
        }
      }
    }

    function recordDailyBiometricSnapshot(state) {
      if (!state) return;
      try {
        const g = state.garmin || {};
        const r = state.renpho || {};
        const dateStr = state.date || (typeof getLocalDateStr === 'function' ? getLocalDateStr() : new Date().toISOString().split('T')[0]);
        const raw = localStorage.getItem('pulse_daily_biometrics_history');
        const list = raw ? JSON.parse(raw) : [];
        const entry = {
          date: dateStr,
          body_battery: g.body_battery !== undefined ? Number(g.body_battery) : null,
          resting_hr: g.resting_hr !== undefined ? Number(g.resting_hr) : null,
          sleep_score: g.sleep_score !== undefined ? Number(g.sleep_score) : null,
          readiness: g.training_readiness !== undefined ? Number(g.training_readiness) : null,
          weight_kg: r.weight_kg !== undefined ? Number(r.weight_kg) : null
        };
        const idx = list.findIndex(item => item.date === dateStr);
        if (idx >= 0) list[idx] = { ...list[idx], ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null)) };
        else list.push(entry);
        list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        localStorage.setItem('pulse_daily_biometrics_history', JSON.stringify(list.slice(-14)));
      } catch(e) {}
    }

    function buildSparklineSvg(values, color) {
      const clean = values.filter(v => typeof v === 'number' && !isNaN(v));
      if (clean.length < 2) {
        return `<svg viewBox="0 0 100 28" style="width:100%; height:28px; overflow:visible;"><line x1="2" y1="14" x2="98" y2="14" stroke="${color}" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.5"/></svg>`;
      }
      const min = Math.min(...clean);
      const max = Math.max(...clean);
      const span = (max - min) || 1;
      const pts = clean.map((v, i) => {
        const x = 4 + (i / (clean.length - 1)) * 92;
        const y = 24 - ((v - min) / span) * 18;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      const lastPt = pts[pts.length - 1].split(',');
      const areaPts = `4,26 ${pts.join(' ')} 96,26`;
      return `<svg viewBox="0 0 100 28" style="width:100%; height:28px; overflow:visible;">
        <polygon points="${areaPts}" fill="${color}" opacity="0.12" />
        <polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(' ')}" />
        <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3.2" fill="${color}" />
      </svg>`;
    }

    function renderBiometricSparklines() {
      const cards = [
        document.getElementById('todayBiometricSparklinesCard'),
        document.getElementById('biometricSparklinesCard')
      ].filter(Boolean);
      if (cards.length === 0) return;

      let hist = [];
      try {
        const raw = localStorage.getItem('pulse_daily_biometrics_history');
        if (raw) hist = JSON.parse(raw);
      } catch(e) {}
      if (!Array.isArray(hist)) hist = [];

      const g = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) || {};
      const r = (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.renpho) || {};
      const curBb = (g.body_battery != null && Number.isFinite(Number(g.body_battery))) ? Number(g.body_battery) : null;
      const curRhr = (g.resting_hr != null && Number.isFinite(Number(g.resting_hr))) ? Number(g.resting_hr) : null;
      const curSleep = (g.sleep_score != null && Number.isFinite(Number(g.sleep_score))) ? Number(g.sleep_score) : null;
      const curWt = (r.weight_kg != null && Number.isFinite(Number(r.weight_kg))) ? Number(r.weight_kg) : null;

      const todayKey = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().slice(0, 10);
      const liveEntry = {
        date: todayKey,
        body_battery: curBb,
        resting_hr: curRhr,
        sleep_score: curSleep,
        weight_kg: curWt
      };
      if (hist.length === 0) {
        hist = [liveEntry];
      } else if (hist[hist.length - 1].date === todayKey) {
        hist[hist.length - 1] = { ...hist[hist.length - 1], ...liveEntry };
      } else {
        hist.push(liveEntry);
      }

      const recent7 = hist.slice(-7);

      const metrics = [
        { key: 'body_battery', label: 'Body Battery', unit: '%', color: '#a855f7' },
        { key: 'resting_hr', label: 'Resting HR', unit: ' bpm', color: '#f97316' },
        { key: 'sleep_score', label: 'Sleep Score', unit: '', color: '#00e5ff' },
        { key: 'weight_kg', label: 'Scale Weight', unit: ' kg', color: '#10b981' }
      ];

      const tilesHtml = metrics.map(m => {
        const vals = recent7.map(d => d[m.key]).filter(v => typeof v === 'number' && !isNaN(v));
        const latest = vals.length ? vals[vals.length - 1] : '--';
        const first = vals.length >= 2 ? vals[0] : null;
        const delta = (typeof latest === 'number' && typeof first === 'number') ? +(latest - first).toFixed(1) : null;
        const deltaStr = delta === null ? '7d' : (delta > 0 ? `+${delta}${m.unit}` : `${delta}${m.unit}`);
        return `
          <div style="background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; padding:8px 10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
              <span style="font-size:10.5px; font-weight:700; color:var(--text-muted);">${m.label}</span>
              <span style="font-size:11.5px; font-weight:800; color:#fff;">${latest}${latest !== '--' ? m.unit : ''}</span>
            </div>
            ${buildSparklineSvg(vals, m.color)}
            <div style="font-size:9.5px; color:var(--text-secondary); margin-top:2px; display:flex; justify-content:space-between;">
              <span>7-day trend</span>
              <span style="color:${m.color}; font-weight:700;">${deltaStr}</span>
            </div>
          </div>
        `;
      }).join('');

      const html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="font-size:11.5px; color:#fff; letter-spacing:0.02em;">📈 7-DAY BIOMETRIC SPARKLINES</strong>
          <span style="font-size:10px; color:var(--cyan); font-weight:700;">Live 7d Curve</span>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">${tilesHtml}</div>
      `;
      cards.forEach(c => { c.innerHTML = html; });
    }
    window.renderBiometricSparklines = renderBiometricSparklines;

    function applyLiveStateToDom(state) {
      if (!state) return;
      if (state.garmin) {
        try {
          const _now = new Date();
          const todayIso = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
          const isLiveGarminOauthToday = state.garmin.source === 'garmin_oauth' && state.garmin.oauth_date === todayIso;
          if (!isLiveGarminOauthToday) {
            const bbOverrideRaw = localStorage.getItem('pulse_body_battery_override_obj');
            if (bbOverrideRaw) {
              const bbObj = JSON.parse(bbOverrideRaw);
              if (bbObj && bbObj.date === todayIso && bbObj.value !== undefined) {
                state.garmin.body_battery = Number(bbObj.value);
                state.garmin.body_battery_manual_date = todayIso;
              }
            }
            const trOverrideRaw = localStorage.getItem('pulse_readiness_override_obj');
            if (trOverrideRaw) {
              const trObj = JSON.parse(trOverrideRaw);
              if (trObj && trObj.date === todayIso && trObj.value !== undefined) {
                state.garmin.training_readiness = Number(trObj.value);
                state.garmin.readiness_manual_date = todayIso;
              }
            }
          } else {
            localStorage.removeItem('pulse_body_battery_override_obj');
            localStorage.removeItem('pulse_readiness_override_obj');
          }
          const sleepOverrideRaw = localStorage.getItem('pulse_sleep_score_override_obj');
          if (sleepOverrideRaw && !isLiveGarminOauthToday) {
            const sleepObj = JSON.parse(sleepOverrideRaw);
            if (sleepObj && sleepObj.date === todayIso && sleepObj.value !== undefined) {
              state.garmin.sleep_score = Number(sleepObj.value);
              state.garmin.sleep_score_manual_date = todayIso;
              state.garmin.sleep_score_source = 'manual_override';
            }
          }
          if (state.garmin.sleep_score_source === 'garmin_oauth' && state.date === todayIso) {
            localStorage.setItem('pulse_garmin_today_backup', JSON.stringify({ date: todayIso, garmin: state.garmin }));
          }
        } catch(e) {}
      }
      window.BAKED_LIVE_STATE = state;
      try {
        if (state && state.last_synced) {
          localStorage.setItem('pulse_cached_live_state', JSON.stringify(state));
        }
      } catch(e) {}
      recordDailyBiometricSnapshot(state);
      renderBiometricSparklines();
      updateAthleteProfileFromState(state);
      
      // 1. Garmin Telemetry Binding
      if (state.garmin) {
        const g = state.garmin;
        const _isLowStepSyntheticBridge = (a) => {
          if (!a) return false;
          const isBridge = a.source === 'garmin_via_mnd_bridge' || String(a.id || '').startsWith('9920');
          return isBridge && Number(a.steps || 0) < 500 && a.name === 'Active Conditioning';
        };
        if (Array.isArray(g.today_activities)) {
          g.today_activities = g.today_activities.filter(a => !_isLowStepSyntheticBridge(a));
        }
        if (Array.isArray(g.recent_activities)) {
          g.recent_activities = g.recent_activities.filter(a => !_isLowStepSyntheticBridge(a));
        }
        const _todayActsNow = Array.isArray(g.today_activities) ? g.today_activities : [];
        if (_todayActsNow.length === 0 && Number(g.steps || 0) < 500 && g.source !== 'garmin_oauth') {
          g.active_calories = 0;
        }
        if (g.training_readiness !== undefined && g.training_readiness !== null) {
          const numEl = document.getElementById('todayDialNum');
          if (numEl && String(numEl.innerText).trim() !== String(g.training_readiness)) {
            numEl.innerText = g.training_readiness;
          }
          const ringEl = document.getElementById('todayDialRing');
          if (ringEl) {
            const circ = 427.26;
            const offset = (circ * (1 - (g.training_readiness / 100))).toFixed(1);
            if (ringEl.style.strokeDashoffset !== offset) {
              ringEl.style.strokeDashoffset = offset;
            }
          }
          const subEl = document.getElementById('todayDialSub');
          if (subEl) {
            const subText = g.training_readiness >= 85 ? 'Optimal Readiness' : (g.training_readiness >= 75 ? 'High Readiness' : (g.training_readiness >= 60 ? 'Moderate Readiness' : 'Recovery Focus'));
            if (subEl.innerText !== subText) subEl.innerText = subText;
          }
          const hdrEl = document.getElementById('hdrReadiness');
          if (hdrEl) {
            const hdrText = `${g.training_readiness} READY`;
            if (hdrEl.innerText !== hdrText) hdrEl.innerText = hdrText;
          }
        } else if (g.source === 'garmin_oauth') {
          const numEl = document.getElementById('todayDialNum');
          if (numEl && numEl.innerText !== '—') numEl.innerText = '—';
          const ringEl = document.getElementById('todayDialRing');
          if (ringEl && ringEl.style.strokeDashoffset !== '427.26') {
            ringEl.style.strokeDashoffset = '427.26';
          }
          const subEl = document.getElementById('todayDialSub');
          if (subEl && subEl.innerText !== 'Awaiting Sync') subEl.innerText = 'Awaiting Sync';
          const hdrEl = document.getElementById('hdrReadiness');
          if (hdrEl && hdrEl.innerText !== 'SYNCING') hdrEl.innerText = 'SYNCING';
        }
        if (g.sleep_score !== undefined && g.sleep_score !== null) {
          const el = document.getElementById('vSleep');
          if (el && String(el.innerText).trim() !== String(g.sleep_score)) {
            el.innerText = g.sleep_score;
          }
          const elSub = document.getElementById('vSleepSub');
          if (elSub && g.sleep_duration && elSub.innerText !== g.sleep_duration) {
            elSub.innerText = g.sleep_duration;
          }
          const sleepRing = document.getElementById('vSleepRing');
          if (sleepRing) {
            const circ = 157;
            const offset = (circ * (1 - (g.sleep_score / 100))).toFixed(1);
            if (sleepRing.style.strokeDashoffset !== offset) {
              sleepRing.style.strokeDashoffset = offset;
            }
          }
        } else if (g.source === 'garmin_oauth') {
          const el = document.getElementById('vSleep');
          if (el && el.innerText !== '—') el.innerText = '—';
          const elSub = document.getElementById('vSleepSub');
          if (elSub && elSub.innerText !== 'Awaiting Sync') elSub.innerText = 'Awaiting Sync';
          const sleepRing = document.getElementById('vSleepRing');
          if (sleepRing && sleepRing.style.strokeDashoffset !== '157') {
            sleepRing.style.strokeDashoffset = '157';
          }
        }
        if (g.resting_hr !== undefined && g.resting_hr !== null) {
          const el = document.getElementById('vitalRhrVal') || document.getElementById('vitalRhr') || document.getElementById('vRhr');
          if (el && String(el.innerText).trim() !== String(g.resting_hr)) {
            el.innerText = g.resting_hr;
          }
        }
        if (g.body_battery !== undefined && g.body_battery !== null) {
          const el = document.getElementById('vitalBattery');
          const bbText = `${g.body_battery}%`;
          if (el && el.innerText !== bbText) {
            el.innerText = bbText;
          }
          const bbRing = document.getElementById('vitalBatteryRing');
          if (bbRing) {
            const circ = 157;
            const offset = (circ * (1 - (g.body_battery / 100))).toFixed(1);
            if (bbRing.style.strokeDashoffset !== offset) {
              bbRing.style.strokeDashoffset = offset;
            }
          }
          const elSub = document.getElementById('vitalBbSub');
          if (elSub) {
            const bbSubText = g.body_battery >= 85 ? 'Fully Charged' : (g.body_battery >= 65 ? 'Charged' : (g.body_battery >= 35 ? 'Moderate' : 'Low / Drained'));
            if (elSub.innerText !== bbSubText) elSub.innerText = bbSubText;
          }
        }
        if ((g.active_calories !== undefined && g.active_calories !== null) || (g.steps !== undefined && g.steps !== null)) {
          const el2 = document.getElementById('vitalBurnSub');
          if (el2) {
            const desiredText = `fēnix 8 • ${g.steps ?? 0} Steps`;
            if (el2.innerText !== desiredText) el2.innerText = desiredText;
          }
          if (g.active_calories !== undefined && g.active_calories !== null) {
            const totalActiveBurn = (typeof getTodayActiveBurn === 'function')
              ? getTodayActiveBurn({ garmin: g })
              : (Number(g.active_calories) || 0);
            const el3 = document.getElementById('fuelBurnNum') || document.getElementById('fuelGarminBurn');
            if (el3) {
              const desiredHtml = `${totalActiveBurn} <small style="font-size:13px;">kcal</small>`;
              if (el3.innerHTML !== desiredHtml) el3.innerHTML = desiredHtml;
            }
            const bannerBurn = document.getElementById('garminBannerBurn');
            if (bannerBurn) {
              const desiredText = `${totalActiveBurn} kcal`;
              if (bannerBurn.innerText !== desiredText) bannerBurn.innerText = desiredText;
            }
          }
        }
        const bTitle = document.getElementById('garminBannerTitle');
        const bSub = document.getElementById('garminBannerSub');
        const syncDateStr = formatSyncDate(state.date, state.last_synced || (g && g.last_synced));
        if (bTitle) {
          const desiredTitle = `Garmin fēnix 8 Synced • ${syncDateStr}`;
          if (bTitle.innerText !== desiredTitle) bTitle.innerText = desiredTitle;
        }
        const rawGarminActs = (Array.isArray(g.recent_activities) && g.recent_activities.length > 0)
          ? g.recent_activities
          : (Array.isArray(g.today_activities) ? g.today_activities : []);
        if (rawGarminActs.length > 0) {
          const isBridgeAct = (a) => a && (
            a.source === 'garmin_via_mnd_bridge' ||
            String(a.id || '').startsWith('990') ||
            String(a.id || '').startsWith('9920') ||
            a.name === 'Active Conditioning' ||
            a.name === 'Daily Steps & Movement' ||
            a.name === 'Hybrid Conditioning & Steps'
          );
          const hasRealOAuthActs = g.source === 'garmin_oauth' || rawGarminActs.some(a => !isBridgeAct(a));
          const garminActs = rawGarminActs
            .filter(a => a && !_isLowStepSyntheticBridge(a) && (!hasRealOAuthActs || !isBridgeAct(a)))
            .map((a) => {
              const actDate = a.date;
              const formatted = formatActivityDisplay({ rawDate: actDate, date: actDate, id: a.id });
              return {
                id: String(a.id),
                name: a.name,
                subTitle: a.sub_title || a.subTitle,
                rawDate: actDate,
                date: formatted.displayDate,
                isToday: formatted.isToday,
                durationMin: a.duration_min || a.durationMin,
                calories: a.calories,
                avgHr: a.avg_hr || a.avgHr,
                maxHr: a.max_hr || a.maxHr,
                aerobicTe: a.aerobic_te ?? a.aerobicTe,
                anaerobicTe: a.anaerobic_te ?? a.anaerobicTe,
                benefits: a.benefits,
                activity_type_key: a.activity_type_key,
                total_sets: a.total_sets,
                total_reps: a.total_reps,
                exercise_sets: a.exercise_sets,
                hr_samples: a.hr_samples,
                hr_zones: a.hr_zones,
                steps: a.steps,
                distance_miles: a.distance_miles,
                source: a.source
              };
            });

          const localSaved = localStorage.getItem('pulse_recent_activities');
          let localActs = [];
          if (localSaved) {
            try { localActs = JSON.parse(localSaved); } catch(e) {}
          }
          if (Array.isArray(localActs)) {
            localActs = localActs.filter(a => {
              if (!a || typeof a !== 'object') return false;
              const sid = String(a && a.id);
              if (sid === '99202611170' || sid === '992026111701' || sid === '992026111702' || sid === '25109482110' || sid === '9920261118') return false;
              if (_isLowStepSyntheticBridge(a)) return false;
              if (hasRealOAuthActs && isBridgeAct(a)) return false;
              const aDatePrefix = String(a.rawDate || a.date || '').slice(0, 10);
              const aCals = Number(a.calories || a.workout_calories || 0);
              const isDupOfGarmin = garminActs.some(ga => {
                if (String(ga.id) === sid) return false;
                const gaDatePrefix = String(ga.rawDate || ga.date || '').slice(0, 10);
                const sameDay = (aDatePrefix && gaDatePrefix && aDatePrefix === gaDatePrefix) || (a.isToday && ga.isToday);
                if (!sameDay) return false;
                const gaCals = Number(ga.calories || 0);
                const calsClose = aCals > 0 && gaCals > 0 && Math.abs(aCals - gaCals) <= 15;
                if (!calsClose) return false;
                const aName = String(a.name || a.activity_type_key || '').toLowerCase();
                const gaName = String(ga.name || ga.activity_type_key || '').toLowerCase();
                return !aName || !gaName || aName.includes(gaName) || gaName.includes(aName) || Math.abs(aCals - gaCals) <= 5;
              });
              if (isDupOfGarmin) return false;
              return true;
            });
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
            const da = new Date(String((a && (a.rawDate || a.date)) || '').replace(' ', 'T')).getTime() || 0;
            const db = new Date(String((b && (b.rawDate || b.date)) || '').replace(' ', 'T')).getTime() || 0;
            return db - da;
          });

          recentActivitiesData = merged.length > 0 ? merged : garminActs;
          try {
            localStorage.setItem('pulse_recent_activities', JSON.stringify(recentActivitiesData.slice(0, 60)));
          } catch(e) {}
          renderHistoryList();
          renderTodayTrainingRecommendations();
        }
        if (bSub) {
          const sleepNum = (g.sleep_score !== undefined && g.sleep_score !== null) ? g.sleep_score : '—';
          const sleepRating = typeof sleepNum === 'number' ? (sleepNum >= 90 ? 'Optimal' : (sleepNum >= 80 ? 'Good' : 'Fair')) : 'Awaiting Sync';
          const readinessNum = (g.training_readiness !== undefined && g.training_readiness !== null) ? g.training_readiness : '—';
          const rhrNum = (g.resting_hr !== undefined && g.resting_hr !== null) ? g.resting_hr : '—';
          const completedToday = (typeof getTodayCompletedWorkout === 'function') ? getTodayCompletedWorkout() : null;
          let todayActsCount = 0;
          let displayKcal = g.active_calories || 0;
          if (completedToday) {
            todayActsCount = completedToday.sessionCount || 1;
            displayKcal = completedToday.calories || (g.active_calories || 0);
          } else {
            const _now = new Date();
            const todayIsoDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
            const rawTodayActs = (g.today_activities && Array.isArray(g.today_activities)) ? g.today_activities : [];
            const rawRecentActs = (g.recent_activities && Array.isArray(g.recent_activities)) ? g.recent_activities : [];
            const combinedActs = [...rawTodayActs];
            rawRecentActs.forEach(ra => {
              if (!combinedActs.some(ta => String(ta.id) === String(ra.id))) {
                combinedActs.push(ra);
              }
            });
            const isBridgeAct = (a) => a && (
              a.source === 'garmin_via_mnd_bridge' ||
              String(a.id || '').startsWith('990') ||
              String(a.id || '').startsWith('9920') ||
              a.name === 'Active Conditioning' ||
              a.name === 'Daily Steps & Movement' ||
              a.name === 'Hybrid Conditioning & Steps'
            );
            const hasRealTodayAct = combinedActs.some(a => String(a.date || a.rawDate || '').startsWith(todayIsoDate) && !isBridgeAct(a));
            const seenTodayIds = new Set();
            const seenFallbackCals = new Set();
            const filteredTodayActs = combinedActs.filter(a => {
              if (_isLowStepSyntheticBridge(a)) return false;
              const actDateStr = String(a.date || a.rawDate || '');
              if (!actDateStr.startsWith(todayIsoDate)) return false;
              if (hasRealTodayAct && isBridgeAct(a)) return false;
              const name = String(a.name || '');
              if (name.includes('Daily Steps & Movement')) return false;
              const duration = Number(a.duration_min || a.durationMin || 0);
              const cals = Number(a.calories || a.workout_calories || 0);
              if (duration < 10 && cals < 80) return false;
              const actIdKey = a.id != null ? String(a.id) : '';
              if (actIdKey) {
                if (seenTodayIds.has(actIdKey)) return false;
                seenTodayIds.add(actIdKey);
                if (!isBridgeAct(a) && !String(a.source || '').includes('manual')) {
                  return true;
                }
              }
              const roundedCals = Math.round(cals);
              if (roundedCals > 0 && seenFallbackCals.has(roundedCals)) return false;
              if (roundedCals > 0) seenFallbackCals.add(roundedCals);
              return true;
            });
            todayActsCount = filteredTodayActs.length;
            const todayWorkoutCals = filteredTodayActs.reduce((s, a) => s + Number(a.calories || a.workout_calories || 0), 0);
            displayKcal = todayWorkoutCals > 0 ? todayWorkoutCals : (g.active_calories || 0);
          }
          let desiredSub = '';
          if (todayActsCount > 0) {
            desiredSub = `${todayActsCount} Workout${todayActsCount > 1 ? 's' : ''} Today (${displayKcal} kcal) • Sleep ${sleepNum} • Readiness ${readinessNum}`;
          } else {
            desiredSub = `Sleep ${sleepNum} (${sleepRating}) • Readiness ${readinessNum} • RHR ${rhrNum} bpm • 0 Workouts Today`;
          }
          if (bSub.innerText !== desiredSub) bSub.innerText = desiredSub;
        }
      }

      // 1.1 MyNetDiary Food Ingestion from Live State (independent of state.garmin)
      {
        const gMnd = state.garmin && state.garmin.mnd_logged ? state.garmin.mnd_logged : null;
        let ml = state.mnd_logged;
        if (gMnd) {
          if (!ml || (gMnd.last_pulled && (!ml.last_pulled || new Date(gMnd.last_pulled) >= new Date(ml.last_pulled)))) {
            ml = gMnd;
          }
        }
        const mndHist = state.mnd_history || (state.garmin && state.garmin.mnd_history) || null;
        const mndMeals = state.mnd_meals || (state.garmin && state.garmin.mnd_meals) || null;
        if (ml) {
          myNetDiaryData.totals.calories = ml.calories || 0;
          myNetDiaryData.totals.protein = ml.protein_g || 0;
          myNetDiaryData.totals.carbs = ml.carbs_g || 0;
          myNetDiaryData.totals.fat = ml.fat_g || 0;
          myNetDiaryData.totals.fiber = ml.fiber_g || 0;
          myNetDiaryData.totals.sodium = ml.sodium_mg || 0;
          myNetDiaryData.totals.water = ml.water_l || 0;
          const hydVal = Number(ml.water_l || 0).toFixed(1);
          const fibVal = Math.round(Number(ml.fiber_g || 0));
          const todayHydEl = document.getElementById('todayHydrationVal');
          if (todayHydEl) todayHydEl.innerText = `${hydVal}L`;
          const mndWaterEl = document.getElementById('mndWaterVal');
          if (mndWaterEl) mndWaterEl.innerText = `${hydVal}L`;
          const mndFiberEl = document.getElementById('mndFiberVal');
          if (mndFiberEl) mndFiberEl.innerText = `${fibVal}g`;
          const fuelHydSum = document.getElementById('fuelHydrationSummary');
          if (fuelHydSum) fuelHydSum.innerText = `${hydVal}L Water • ${fibVal}g Fiber`;
          if (ml.sugar_g !== undefined) myNetDiaryData.totals.sugar_g = ml.sugar_g;
          if (ml.sat_fat_g !== undefined) myNetDiaryData.totals.sat_fat_g = ml.sat_fat_g;
          if (mndMeals) {
            myNetDiaryData.meals = mndMeals;
          }
          if (mndHist && Array.isArray(mndHist.days) && mndHist.days.length > 0) {
            myNetDiaryData.history = mndHist;
          }
          saveMndToLocalStorage();
          renderMyNetDiaryEngine();
          renderTodayTrainingRecommendations();
          renderHistoryList();
        } else if (mndHist && Array.isArray(mndHist.days) && mndHist.days.length > 0) {
          myNetDiaryData.history = mndHist;
          saveMndToLocalStorage();
          renderMyNetDiaryEngine();
        }
      }

      // 2. Renpho Scale Binding
      if (state.injuries) {
        athleteInjuries = { ...athleteInjuries, ...state.injuries };
        updateInjuryBadge();
      }

      const _nowScale = new Date();
      const todayIsoScale = `${_nowScale.getFullYear()}-${String(_nowScale.getMonth() + 1).padStart(2, '0')}-${String(_nowScale.getDate()).padStart(2, '0')}`;
      const manualScaleDate = localStorage.getItem('pulse_manual_scale_date');
      const savedWt = localStorage.getItem('pulse_athlete_weight');
      const savedBf = localStorage.getItem('pulse_athlete_bf');
      const isManualToday = manualScaleDate === todayIsoScale;
      const renphoLastSynced = (state && state.renpho && state.renpho.last_synced) ? String(state.renpho.last_synced).slice(0, 10) : '';
      const renphoIsOlder = !renphoLastSynced || renphoLastSynced < todayIsoScale;
      const manualOverrideActive = isManualToday && renphoIsOlder && !!savedWt;

      if (state.renpho) {
        const r = state.renpho;
        const rWeight = Number(r.weight_kg);
        const rBf = Number(r.body_fat_pct);
        const rFatLose = r.fat_to_lose_kg != null ? Number(r.fat_to_lose_kg) : NaN;
        const rMuscle = Number(r.muscle_mass_kg);
        const rLbm = Number(r.lean_mass_kg);
        const rWater = Number(r.water_pct);
        const rVisceral = r.visceral_fat != null ? Number(r.visceral_fat) : NaN;

        let renphoSyncAgeLabel = 'Synced';
        if (r.last_synced) {
          try {
            const dPart = String(r.last_synced).replace('T', ' ').split(' ')[0];
            if (dPart === todayIsoScale) {
              renphoSyncAgeLabel = 'Synced Today';
            } else {
              const formatted = (typeof formatSyncDate === 'function') ? formatSyncDate(dPart, r.last_synced) : dPart;
              renphoSyncAgeLabel = `Synced ${formatted}`;
            }
          } catch (e) {}
        }

        if (Number.isFinite(rWeight) && rWeight > 0 && !manualOverrideActive) {
          const el1 = document.getElementById('vitalScale');
          if (el1) el1.innerText = Number(rWeight.toFixed(2)).toString().includes('.') ? Number(rWeight.toFixed(2)).toString() : rWeight.toFixed(1);
          const el2 = document.getElementById('bodyScaleWeight');
          if (el2) el2.innerHTML = `${rWeight.toFixed(2)} <small style="font-size:13px;font-weight:400;">kg</small>`;
        }
        if (Number.isFinite(rBf) && rBf > 0 && !manualOverrideActive) {
          const el1 = document.getElementById('vitalScaleSub');
          if (el1) el1.innerText = `${rBf.toFixed(1)}`;
          const el2 = document.getElementById('bodyScaleBf');
          if (el2) el2.innerText = `${rBf.toFixed(1)}% Body Fat (${renphoSyncAgeLabel})`;
          const el3 = document.getElementById('normBfVal');
          if (el3) el3.innerText = `${rBf.toFixed(1)}%`;
          const el4 = document.getElementById('normBfBadge');
          if (el4) el4.innerText = `TOP ${rBf <= 16.7 ? '12%' : '15%'} OF 45yo MEN`;
          const elMeasuredLabel = document.getElementById('renphoMeasuredBfLabel');
          if (elMeasuredLabel) elMeasuredLabel.innerText = `${rBf.toFixed(1)}% Scale Measured`;
        }
        if (Number.isFinite(rFatLose) && rFatLose >= 0 && !manualOverrideActive) {
          const el1 = document.getElementById('bodyFatToBurnNum');
          if (el1) el1.innerText = `${rFatLose.toFixed(2)} kg (${(rFatLose * 2.20462).toFixed(1)} lbs)`;
          const elGoalLabel = document.getElementById('renphoGoalRunwayLabel');
          const targetWtNum = Number(r.target_weight_at_15pct);
          const goalWtSuffix = (Number.isFinite(targetWtNum) && targetWtNum > 0) ? ` (${targetWtNum.toFixed(2)}kg)` : '';
          if (elGoalLabel) elGoalLabel.innerText = `${rFatLose.toFixed(2)} kg to 15.0% Goal${goalWtSuffix}`;
        }
        if (Number.isFinite(rMuscle) && rMuscle > 0) {
          const elMuscle = document.getElementById('renphoMuscleVal');
          if (elMuscle) elMuscle.innerText = `${rMuscle.toFixed(1)}kg`;
        }
        if (Number.isFinite(rLbm) && rLbm > 0) {
          const elLbm = document.getElementById('renphoLbmVal');
          if (elLbm) elLbm.innerText = `${rLbm.toFixed(1)}kg`;
        }
        if (Number.isFinite(rWater) && rWater > 0) {
          const elWater = document.getElementById('renphoWaterVal');
          if (elWater) elWater.innerText = `${rWater.toFixed(1)}%`;
        }
        if (Number.isFinite(rVisceral)) {
          const elVisceral = document.getElementById('renphoVisceralVal');
          if (elVisceral) elVisceral.innerText = `${rVisceral.toFixed(1)}`;
        }
        if (r.last_synced) {
          const syncEl = document.getElementById('renphoSyncTime');
          try {
            const parts = String(r.last_synced).replace('T', ' ').split(' ');
            const datePart = parts[0];
            const timePart = (parts[1] || '').slice(0, 5);
            const dateLabel = formatSyncDate(datePart, r.last_synced);
            if (syncEl) syncEl.innerText = `${dateLabel} • ${timePart}`;
          } catch(e) {}
        }
      }

      // Load manual local storage weight override if no renpho sync exists OR if manual weigh-in today is newer than renpho sync
      if (savedWt && (!state.renpho || (isManualToday && renphoIsOlder))) {
        const pWt = parseFloat(savedWt);
        const pBfRaw = parseFloat(savedBf);
        const pBf = Number.isFinite(pBfRaw) ? pBfRaw : ((window.athleteProfile && Number.isFinite(Number(window.athleteProfile.bodyFatPct))) ? Number(window.athleteProfile.bodyFatPct) : null);
        const lbm = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.leanMassKg)))
          ? Number(window.athleteProfile.leanMassKg)
          : (Number.isFinite(pWt) && pBf !== null ? parseFloat((pWt * (1 - pBf / 100)).toFixed(2)) : null);
        const targetWt = (window.athleteProfile && Number.isFinite(Number(window.athleteProfile.targetWeightKg)))
          ? Number(window.athleteProfile.targetWeightKg)
          : (lbm !== null ? parseFloat((lbm / 0.85).toFixed(2)) : null);
        const fatToBurn = (targetWt !== null && Number.isFinite(pWt)) ? parseFloat(Math.max(0, pWt - targetWt).toFixed(2)) : null;
        const vs = document.getElementById('vitalScale');
        if (vs && Number.isFinite(pWt)) vs.innerHTML = `${pWt.toFixed(1)}`;
        const vss = document.getElementById('vitalScaleSub');
        if (vss) vss.innerText = pBf !== null ? `${pBf.toFixed(1)}` : '--';
        const bsw = document.getElementById('bodyScaleWeight');
        if (bsw && Number.isFinite(pWt)) bsw.innerHTML = `${pWt.toFixed(2)} <small style="font-size:13px;font-weight:400;">kg</small>`;
        const bsbf = document.getElementById('bodyScaleBf');
        if (bsbf) bsbf.innerText = pBf !== null ? `${pBf}% Body Fat (Logged Today)` : 'Body Fat Pending Sync';
        const bfb = document.getElementById('bodyFatToBurnNum');
        if (bfb) bfb.innerText = fatToBurn !== null ? `${fatToBurn} kg (${(fatToBurn * 2.20462).toFixed(1)} lbs)` : '--';
        const elGoalLabel = document.getElementById('renphoGoalRunwayLabel');
        if (elGoalLabel) elGoalLabel.innerText = (fatToBurn !== null && targetWt !== null) ? `${fatToBurn} kg to 15.0% Goal (${targetWt.toFixed(2)}kg)` : '15.0% Goal Runway';
        const elMeasuredLabel = document.getElementById('renphoMeasuredBfLabel');
        if (elMeasuredLabel) elMeasuredLabel.innerText = pBf !== null ? `${pBf.toFixed(1)}% Scale Measured` : '--';
      }

      // 3. Nutrition Targets
      if (state.nutrition) {
        const n = state.nutrition;
        const inAppBurn = (typeof getTodayInAppBurn === 'function') ? getTodayInAppBurn(state.garmin) : 0;
        const activeBurn = (typeof getTodayActiveBurn === 'function') ? getTodayActiveBurn(state) : inAppBurn;

        const calorieTarget = (n.calorie_target || 2092) + inAppBurn;
        if (n.calorie_target) {
          const el1 = document.getElementById('fuelTargetNum') || document.getElementById('fuelCalTarget');
          if (el1) el1.innerHTML = `${calorieTarget.toLocaleString()} <small style="font-size:13.5px; color:var(--lime);">+${activeBurn} kcal</small>`;
          const el2 = document.getElementById('fuelBudgetNum');
          if (el2) el2.innerText = calorieTarget;
          athleteDailyBudget = calorieTarget;
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
    }

    // DYNAMIC TELEMETRY SYNC PIPELINE (Reads Railway /api/live_state)
    async function loadLiveState(options = {}) {
      const silent = Boolean(options && options.silent);
      // Synchronously apply local/baked state first to prevent any startup flash
      if (typeof window.BAKED_LIVE_STATE !== 'undefined' && window.BAKED_LIVE_STATE) {
        applyLiveStateToDom(window.BAKED_LIVE_STATE);
      }

      try {
        let state = null;
        try {
          const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
          const res = await fetcher('/api/live_state', {
            timeoutMs: 10000,
            cache: 'no-store',
            promptAuthOn401: !silent
          });
          if (res && res.ok) state = await res.json();
        } catch(apiErr) {}

        if (!state && typeof window.BAKED_LIVE_STATE !== 'undefined' && window.BAKED_LIVE_STATE) {
          state = window.BAKED_LIVE_STATE;
        }
        if (!state) return;

        try {
          const todayIso = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
          if (!window._garminSessionRestored) {
            window._garminSessionRestored = true;
            const todayBackupRaw = localStorage.getItem('pulse_garmin_today_backup');
            let todayGarminBackup = null;
            if (todayBackupRaw) {
              try {
                const parsed = JSON.parse(todayBackupRaw);
                if (parsed && parsed.date === todayIso && parsed.garmin) {
                  todayGarminBackup = parsed.garmin;
                }
              } catch(e) {}
            }
            if (todayGarminBackup) {
              const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
              fetcher('/api/garmin/restore_session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  garmin_state: todayGarminBackup,
                  date: todayIso
                }),
                promptAuthOn401: false
              })
                .then(r => (r && r.ok) ? r.json() : null)
                .then(resData => {
                  if (resData && resData.state) {
                    applyLiveStateToDom(resData.state);
                  }
                })
                .catch(() => {});
            }
          }
        } catch(e) {}
        
        applyLiveStateToDom(state);
        console.log("✓ Dynamic telemetry successfully synced from /api/live_state");

        // Non-blocking 14-day Renpho trend fetch for plateau & goal-trajectory coaching
        if (!window._renphoHistoryFetched) {
          window._renphoHistoryFetched = true;
          const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
          fetcher('/api/renpho/history?days=14', { promptAuthOn401: false })
            .then(res => (res && res.ok) ? res.json() : null)
            .then(data => {
              const hist = Array.isArray(data) ? data : (data && Array.isArray(data.history) ? data.history : []);
              if (hist.length > 0) {
                window.PULSE_RENPHO_HISTORY = hist;
                if (typeof renderTodayTrainingRecommendations === 'function') {
                  renderTodayTrainingRecommendations();
                }
              }
            })
            .catch(() => {});
        }

      } catch(e) {
        console.log("Local cache fallback active:", e.message);
      }
    }

    function setFastingProtocol(key) {
      const protocols = {
        '16_8': { label: '16:8 Protocol', hours: 16 },
        '18_6': { label: '18:6 Protocol', hours: 18 },
        '20_4': { label: '20:4 Protocol', hours: 20 },
        'omad': { label: 'OMAD Protocol', hours: 23 }
      };
      const resolvedKey = protocols[key] ? key : '16_8';
      const p = protocols[resolvedKey];
      window.activeFastingProtocolHours = p.hours;
      const tag = document.getElementById('fastingProtocolTag');
      if (tag) tag.innerText = p.label;

      ['16_8', '18_6', '20_4', 'omad'].forEach(k => {
        const btnId = k === 'omad' ? 'btnFastOMAD' : 'btnFast' + k;
        const btn = document.getElementById(btnId);
        if (btn) {
          if (k === resolvedKey) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      try {
        localStorage.setItem('pulse_fasting_protocol', resolvedKey);
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

      // Backend APScheduler handles upstream Garmin/MND/Renpho sync; frontend polls read-only /api/live_state
      setInterval(() => {
        if (document.visibilityState === 'visible') {
          loadLiveState({ silent: true });
        }
      }, 2 * 60 * 1000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          loadLiveState({ silent: true });
        }
      });

      window.addEventListener('focus', () => {
        if (Date.now() - (window._lastLiveStatePollMs || 0) > 60 * 1000) {
          window._lastLiveStatePollMs = Date.now();
          loadLiveState({ silent: true });
        }
      });

      // Initialize Expanded Fuel & MyNetDiary Macro Engine
      initMyNetDiaryEngine();
      try {
        const savedGoal = localStorage.getItem('pulse_current_goal');
        if (savedGoal && typeof selectGoal === 'function') {
          selectGoal(savedGoal, { fromBoot: true });
        }
        const savedFast = localStorage.getItem('pulse_fasting_protocol') || '16_8';
        setFastingProtocol(savedFast);
        const savedDiet = localStorage.getItem('pulse_diet_strategy');
        if (savedDiet && typeof selectDietStrategy === 'function') {
          selectDietStrategy(savedDiet, { fromBoot: true });
        }
      } catch (e) {
        setFastingProtocol('16_8');
      }

      // Initialize Injuries from localStorage if available
      try {
        const savedInj = localStorage.getItem('pulse_athlete_injuries');
        if (savedInj) {
          athleteInjuries = { ...athleteInjuries, ...JSON.parse(savedInj) };
        }
      } catch(e) {}
      updateInjuryBadge();

      window.dismissBootSplash = function() {
        const el = document.getElementById('pulseBootSplash');
        if (el) el.classList.add('boot-splash-hidden');
      };
      setTimeout(window.dismissBootSplash, 1650);
      renderBiometricSparklines();

      try {
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get('tab');
        const kbParam = urlParams.get('kb');
        if (tabParam && ['today', 'train', 'timer', 'fuel', 'body'].includes(tabParam)) {
          switchTab(tabParam);
          if (tabParam === 'train' && kbParam && ['flow_2h', 'flow_1h', 'grinds'].includes(kbParam) && typeof setKbSubMode === 'function') {
            setKbSubMode(kbParam);
          }
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
            window._pulseSwReg = reg;
            reg.update();
            reg.onupdatefound = () => {
              const installing = reg.installing;
              if (installing) {
                installing.onstatechange = () => {
                  if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('New update available in background.');
                  }
                };
              }
            };
          }
        }).catch(e => {
          console.log('PWA Service Worker notice:', e.message);
        });

        let lastSwCheckTs = 0;
        const checkSwUpdate = () => {
          const nowTs = Date.now();
          if (nowTs - lastSwCheckTs < 30000) return;
          lastSwCheckTs = nowTs;
          if (window._pulseSwReg) {
            window._pulseSwReg.update().catch(() => {});
          }
        };
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkSwUpdate();
        });
        window.addEventListener('pageshow', (ev) => {
          if (ev.persisted) checkSwUpdate();
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      }

      window.forcePulseAppReload = async function() {
        if (typeof showToast === 'function') {
          showToast('Checking for latest PULSE update...');
        }
        try {
          if (window._pulseSwReg) {
            await window._pulseSwReg.update();
          }
        } catch (e) {}
        try {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch (e) {}
        window.location.reload();
      };

      console.log("PULSE Hybrid Athlete OS loaded with MyNetDiary daily macro breakdown, voice coaching, and localStorage persistence.");
    });
