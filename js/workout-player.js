    // ==================== INLINE CONDITIONING & TIME-BASED ENGINE (INTERVAL / EMOM / AMRAP / STEADY / FOR TIME) ====================
    const PULSE_COND_PROG_KEY = 'pulse_conditioning_progression';
    const PULSE_COND_HIST_KEY = 'pulse_conditioning_history';

    let inlineTimerState = {
      exId: null,
      format: 'interval',
      phase: 'work', // 'work' | 'rest' | 'amrap' | 'emom' | 'steady' | 'for_time'
      workSec: 45,
      restSec: 15,
      rounds: 6,
      currentRound: 1,
      durationSec: 600,
      secsLeft: 45,
      elapsedSec: 0,
      amrapRounds: 0,
      lastTickMs: 0,
      running: false,
      intervalId: null
    };

    function stopInlineTimer() {
      if (inlineTimerState.intervalId) {
        clearInterval(inlineTimerState.intervalId);
        inlineTimerState.intervalId = null;
      }
      inlineTimerState.running = false;
      inlineTimerState.lastTickMs = 0;
      if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
    }

    function _readConditioningProgressionMap() {
      try {
        const rawProg = localStorage.getItem(PULSE_COND_PROG_KEY);
        if (rawProg) {
          const parsedProg = JSON.parse(rawProg);
          if (parsedProg && typeof parsedProg === 'object' && !Array.isArray(parsedProg)) {
            return parsedProg;
          }
        }
        // One-time migration if legacy plain Object was stored in pulse_conditioning_history
        const rawHist = localStorage.getItem(PULSE_COND_HIST_KEY);
        if (rawHist) {
          const parsedHist = JSON.parse(rawHist);
          if (parsedHist && typeof parsedHist === 'object' && !Array.isArray(parsedHist)) {
            localStorage.setItem(PULSE_COND_PROG_KEY, JSON.stringify(parsedHist));
            return parsedHist;
          }
        }
      } catch(e) {}
      return {};
    }

    function _readConditioningHistoryArray() {
      try {
        const raw = localStorage.getItem(PULSE_COND_HIST_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
          try {
            if (!localStorage.getItem(PULSE_COND_PROG_KEY)) {
              localStorage.setItem(PULSE_COND_PROG_KEY, JSON.stringify(parsed));
            }
          } catch(e) {}
          const converted = Object.entries(parsed)
            .filter(([, v]) => v && typeof v === 'object' && (v.date || v.lastDate))
            .map(([k, v]) => ({
              exId: k,
              name: v.name || k,
              date: v.date || v.lastDate,
              mode: v.format || v.mode || 'interval',
              format: v.format || v.mode || 'interval',
              rounds: v.roundsCompleted || v.amrapRounds || v.nextRounds || 1,
              amrapRounds: v.amrapRounds || v.roundsCompleted || 0,
              duration_min: v.totalSeconds ? Math.max(1, Math.round(v.totalSeconds / 60)) : Math.max(1, Math.round((v.durationSec || 600) / 60)),
              sub_title: v.name || 'Conditioning'
            }));
          localStorage.setItem(PULSE_COND_HIST_KEY, JSON.stringify(converted));
          return converted;
        }
      } catch(e) {}
      return [];
    }

    function _appendConditioningHistoryEntry(entry) {
      try {
        const arr = _readConditioningHistoryArray();
        arr.unshift(entry);
        localStorage.setItem(PULSE_COND_HIST_KEY, JSON.stringify(arr.slice(0, 50)));
      } catch(e) {}
    }

    function getConditioningProgression(exId) {
      try {
        const map = _readConditioningProgressionMap();
        return map[exId] || null;
      } catch(e) { return null; }
    }

    function saveConditioningProgression(exId, entry) {
      try {
        const map = _readConditioningProgressionMap();
        map[exId] = entry;
        localStorage.setItem(PULSE_COND_PROG_KEY, JSON.stringify(map));
        if (typeof syncClientPreferencesToCloud === 'function') {
          syncClientPreferencesToCloud('conditioning_progression');
        }
      } catch(e) {}
    }

    function getExerciseFormatConfig(ex) {
      if (!ex) return { isTimed: false, format: 'strength' };
      const id = String(ex.id || '');
      const repStr = String(ex.targetReps || '');
      const prog = getConditioningProgression(id);

      if (ex.format === 'interval' || id.includes('rope') || id.includes('tabata')) {
        const wSec = (prog && prog.workSec) ? prog.workSec : (ex.workSec || 45);
        const rSec = (prog && prog.restSec !== undefined) ? prog.restSec : (ex.restSec !== undefined ? ex.restSec : 15);
        const rnds = (prog && prog.nextRounds) ? prog.nextRounds : (ex.rounds || ex.setsCount || 6);
        return { isTimed: true, format: 'interval', workSec: wSec, restSec: rSec, rounds: rnds, label: `${rnds} Rounds × ${wSec}s Work / ${rSec}s Rest` };
      }
      if (ex.format === 'emom' || id.includes('emom')) {
        const rnds = (prog && prog.nextRounds) ? prog.nextRounds : (ex.rounds || ex.setsCount || 10);
        return { isTimed: true, format: 'emom', workSec: 60, restSec: 0, rounds: rnds, label: `${rnds}-Min EMOM (60s Rounds)` };
      }
      if (ex.format === 'kb_flow' || id.startsWith('kb_flow_')) {
        const dur = (prog && prog.durationSec) ? prog.durationSec : (ex.durationSec || 1800);
        const mins = Math.round(dur / 60);
        return { isTimed: true, format: 'kb_flow', durationSec: dur, rounds: 1, prevRounds: prog ? prog.amrapRounds : null, label: `${mins}:00 KB Flow AMRAP (${ex.flowSteps ? ex.flowSteps.length : 9} Moves)` };
      }
      if (ex.format === 'amrap' || id.includes('amrap')) {
        const dur = (prog && prog.durationSec) ? prog.durationSec : (ex.durationSec || 600);
        const mins = Math.round(dur / 60);
        return { isTimed: true, format: 'amrap', durationSec: dur, rounds: 1, prevRounds: prog ? prog.amrapRounds : null, label: `${mins}:00 AMRAP (As Many Rounds As Possible)` };
      }
      if (ex.format === 'for_time' || id.includes('for_time')) {
        const dur = ex.durationSec || 720;
        const mins = Math.round(dur / 60);
        return { isTimed: true, format: 'for_time', durationSec: dur, rounds: ex.rounds || 3, prevSec: prog ? prog.elapsedSec : null, label: `For Time (${mins}m Cap • ${ex.rounds || 3} Rounds)` };
      }
      if (ex.format === 'steady' || id.includes('zone2') || id.includes('walk') || id.includes('hold') || id.includes('carry') || id.includes('stretch') || id.includes('openers') || /^\d+\s*(s|sec|m|min)$/i.test(repStr.trim())) {
        let sec = 45;
        const mMin = repStr.match(/(\d+)\s*(?:m|min)/i);
        const mSec = repStr.match(/(\d+)\s*(?:s|sec)/i);
        if (mMin) sec = parseInt(mMin[1], 10) * 60;
        else if (mSec) sec = parseInt(mSec[1], 10);
        else if (id.includes('zone2') || id.includes('walk')) sec = 1500;
        const rnds = ex.setsCount || 1;
        const restS = parseRestSeconds(ex.rest || '45s');
        const disp = sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec}s`;
        return { isTimed: true, format: 'steady', workSec: sec, restSec: rnds > 1 ? restS : 0, rounds: rnds, label: rnds > 1 ? `${rnds} Sets × ${disp} Hold/Carry` : `${disp} Continuous Steady` };
      }
      return { isTimed: false, format: 'strength' };
    }

    function initInlineTimerForExercise(ex, fmt) {
      if (inlineTimerState.exId === ex.id && inlineTimerState.format === fmt.format) return;
      stopInlineTimer();
      let savedIntermission = 'none_rest';
      try { savedIntermission = localStorage.getItem('pulse_kb_intermission') || 'none_rest'; } catch(e) {}
      inlineTimerState = {
        exId: ex.id,
        format: fmt.format,
        phase: (fmt.format === 'amrap' || fmt.format === 'kb_flow') ? fmt.format : (fmt.format === 'emom' ? 'emom' : (fmt.format === 'for_time' ? 'for_time' : 'work')),
        workSec: fmt.workSec || 45,
        restSec: fmt.restSec || 0,
        rounds: fmt.rounds || 1,
        currentRound: 1,
        durationSec: fmt.durationSec || (fmt.workSec || 60),
        secsLeft: (fmt.format === 'amrap' || fmt.format === 'kb_flow') ? (fmt.durationSec || (fmt.format === 'kb_flow' ? 1800 : 600)) : (fmt.format === 'for_time' ? 0 : (fmt.workSec || 45)),
        elapsedSec: 0,
        amrapRounds: 0,
        intermissionMode: savedIntermission,
        inIntermission: false,
        flowStepIdx: 0,
        activeFlowStepIdx: 0,
        running: false,
        intervalId: null
      };
    }

    function formatClockMMSS(sec) {
      const s = Math.max(0, Math.round(sec));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    function parseFlowStepString(rawStep) {
      const str = String(rawStep || '').trim();
      const match = str.match(/^(\d+(?:-\d+)+|\d+s|\d+m|\d+)\s+(.+)$/i);
      if (match) {
        const rawQty = match[1];
        let restName = match[2].trim();
        let repsBadge = '';
        let numericReps = 0;

        if (rawQty.includes('-')) {
          const parts = rawQty.split('-').map(n => parseInt(n, 10)).filter(n => !isNaN(n));
          repsBadge = parts.length >= 2 ? `${parts[0]}→${parts[parts.length - 1]} LADDER` : `${rawQty} REPS`;
          numericReps = parts.reduce((acc, v) => acc + v, 0);
        } else if (/s$/i.test(rawQty)) {
          repsBadge = rawQty.toUpperCase();
        } else if (/m$/i.test(rawQty)) {
          repsBadge = rawQty;
        } else {
          repsBadge = `× ${rawQty}`;
          numericReps = parseInt(rawQty, 10) || 0;
        }

        let sideBadge = '';
        const sideMatch = restName.match(/\s*\((L|R|Left|Right|Each Side|Odd Min|Even Min)\)\s*$/i);
        if (sideMatch) {
          const token = sideMatch[1].toUpperCase();
          if (token === 'L' || token === 'LEFT') sideBadge = 'LEFT';
          else if (token === 'R' || token === 'RIGHT') sideBadge = 'RIGHT';
          else sideBadge = token;
          restName = restName.slice(0, sideMatch.index).trim();
        }

        return { repsBadge, moveName: restName, sideBadge, numericReps, rawStep: str };
      }

      return { repsBadge: 'FLOW', moveName: str, sideBadge: '', numericReps: 0, rawStep: str };
    }
    window.parseFlowStepString = parseFlowStepString;

    function setInlineCondFlowStep(exId, idx) {
      const ex = activeWorkoutPlan[currentExIdx] || getAllExercises().find(e => e.id === exId);
      const flowSteps = (ex && Array.isArray(ex.flowSteps)) ? ex.flowSteps : [];
      const totalSteps = flowSteps.length || 1;
      const nextIdx = ((idx % totalSteps) + totalSteps) % totalSteps;
      inlineTimerState.activeFlowStepIdx = nextIdx;
      inlineTimerState.flowStepIdx = nextIdx;
      if (ex) renderCurrentExercise();
      if (flowSteps[nextIdx]) {
        const parsed = parseFlowStepString(flowSteps[nextIdx]);
        speak(`Move ${nextIdx + 1}: ${flowSteps[nextIdx].replace(/\(L\)/gi, 'Left').replace(/\(R\)/gi, 'Right')}`);
      }
      beep(580, 0.04);
    }
    window.setInlineCondFlowStep = setInlineCondFlowStep;

    function advanceInlineCondFlowStep(exId, delta) {
      const ex = activeWorkoutPlan[currentExIdx] || getAllExercises().find(e => e.id === exId);
      const flowSteps = (ex && Array.isArray(ex.flowSteps)) ? ex.flowSteps : [];
      const totalSteps = flowSteps.length;
      if (!totalSteps) return;
      const cur = inlineTimerState.activeFlowStepIdx !== undefined
        ? inlineTimerState.activeFlowStepIdx
        : (inlineTimerState.flowStepIdx || 0);
      const nextIdx = ((cur + (delta || 1)) % totalSteps + totalSteps) % totalSteps;
      inlineTimerState.activeFlowStepIdx = nextIdx;
      inlineTimerState.flowStepIdx = nextIdx;
      renderCurrentExercise();
      const rawStep = flowSteps[nextIdx];
      if (rawStep) {
        speak(`Move ${nextIdx + 1}: ${rawStep.replace(/\(L\)/gi, 'Left').replace(/\(R\)/gi, 'Right')}`);
      }
      if (typeof pulseHaptic === 'function') pulseHaptic([15]);
      beep(660, 0.05);
    }
    window.advanceInlineCondFlowStep = advanceInlineCondFlowStep;

    function renderInlineConditioningPlayer(ex, fmt) {
      const container = document.getElementById('setRows');
      if (!container) return;
      const st = inlineTimerState;
      const isLogged = Boolean(sessionLoggedSets[`${ex.id}_1`]?.logged);

      let phaseLabel = '';
      let phaseColor = 'var(--primary)';
      if (st.format === 'kb_flow') {
        if (st.inIntermission) {
          phaseLabel = st.intermissionMode === 'none_rest'
            ? `🔵 INTERMISSION • PASSIVE REST (60s)`
            : `🔁 INTERMISSION • ${st.intermissionMode.toUpperCase()}`;
          phaseColor = '#38bdf8';
        } else {
          phaseLabel = `🌊 ${ex.handMode === '1h' ? '1H' : '2H'} KB FLOW AMRAP • ${st.amrapRounds} ROUNDS`;
          phaseColor = 'var(--primary)';
        }
      } else if (st.format === 'interval') {
        phaseLabel = st.phase === 'work'
          ? `🟢 WORK • ROUND ${st.currentRound} OF ${st.rounds}`
          : `🔵 REST • NEXT: ROUND ${Math.min(st.rounds, st.currentRound + 1)}`;
        phaseColor = st.phase === 'work' ? '#10b981' : '#38bdf8';
      } else if (st.format === 'emom') {
        phaseLabel = `⏱ EMOM • MINUTE ${st.currentRound} OF ${st.rounds}`;
        phaseColor = 'var(--primary)';
      } else if (st.format === 'amrap') {
        phaseLabel = `🔥 AMRAP • ${st.amrapRounds} ROUNDS COMPLETED`;
        phaseColor = '#f59e0b';
      } else if (st.format === 'for_time') {
        phaseLabel = `🏁 FOR TIME • ${st.amrapRounds}/${st.rounds} ROUNDS`;
        phaseColor = '#a78bfa';
      } else {
        phaseLabel = st.phase === 'rest'
          ? `🔵 REST • SET ${st.currentRound} DONE`
          : (st.rounds > 1 ? `🟢 HOLD / WORK • SET ${st.currentRound} OF ${st.rounds}` : `🟢 STEADY STATE • ${formatClockMMSS(st.workSec)}`);
        phaseColor = st.phase === 'rest' ? '#38bdf8' : '#10b981';
      }

      let presetsHtml = '';
      if (st.format === 'kb_flow') {
        const minsList = [15, 20, 30, 40];
        presetsHtml = minsList.map(m => {
          const active = Math.round(st.durationSec / 60) === m;
          return `<button type="button" onclick="setInlinePreset('kb_flow', ${m}, 0, ${m})" style="flex:1; padding:5px 4px; font-size:10.5px; font-weight:800; border-radius:6px; cursor:pointer; border:1px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.12)'}; background:${active ? 'var(--primary)' : 'rgba(255,255,255,0.04)'}; color:${active ? '#000' : 'var(--text-secondary)'};">${m} min</button>`;
        }).join('');
      } else if (st.format === 'interval') {
        const opts = [
          { label: '30/15 × 6', w: 30, r: 15, n: 6 },
          { label: '45/15 × 6', w: 45, r: 15, n: 6 },
          { label: '90/30 × 4', w: 90, r: 30, n: 4 },
          { label: '20/10 Tabata', w: 20, r: 10, n: 8 }
        ];
        presetsHtml = opts.map(o => {
          const active = st.workSec === o.w && st.restSec === o.r && st.rounds === o.n;
          return `<button type="button" onclick="setInlinePreset('interval', ${o.w}, ${o.r}, ${o.n})" style="flex:1; min-width:72px; padding:5px 4px; font-size:10px; font-weight:800; border-radius:6px; cursor:pointer; border:1px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.12)'}; background:${active ? 'var(--primary)' : 'rgba(255,255,255,0.04)'}; color:${active ? '#000' : 'var(--text-secondary)'};">${o.label}</button>`;
        }).join('');
      } else if (st.format === 'amrap' || st.format === 'emom' || st.format === 'for_time') {
        const minsList = [8, 10, 12, 15];
        presetsHtml = minsList.map(m => {
          const active = st.format === 'emom' ? (st.rounds === m) : (Math.round(st.durationSec / 60) === m);
          return `<button type="button" onclick="setInlinePreset('${st.format}', ${m}, 0, ${m})" style="flex:1; padding:5px 4px; font-size:10.5px; font-weight:800; border-radius:6px; cursor:pointer; border:1px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.12)'}; background:${active ? 'var(--primary)' : 'rgba(255,255,255,0.04)'}; color:${active ? '#000' : 'var(--text-secondary)'};">${m} min</button>`;
        }).join('');
      } else {
        const durations = st.workSec >= 300 ? [
          { label: '15m', sec: 900 }, { label: '25m', sec: 1500 }, { label: '35m', sec: 2100 }, { label: '45m', sec: 2700 }
        ] : [
          { label: '30s', sec: 30 }, { label: '45s', sec: 45 }, { label: '60s', sec: 60 }, { label: '90s', sec: 90 }
        ];
        presetsHtml = durations.map(d => {
          const active = st.workSec === d.sec;
          return `<button type="button" onclick="setInlinePreset('steady', ${d.sec}, ${st.restSec}, ${st.rounds})" style="flex:1; padding:5px 4px; font-size:10.5px; font-weight:800; border-radius:6px; cursor:pointer; border:1px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.12)'}; background:${active ? 'var(--primary)' : 'rgba(255,255,255,0.04)'}; color:${active ? '#000' : 'var(--text-secondary)'};">${d.label}</button>`;
        }).join('');
      }

      // Build Ultra-Compact Zero-Scroll Flow Movement Grid & Integrated Timer + Live Spotlight Dock
      const flowSteps = Array.isArray(ex.flowSteps) ? ex.flowSteps : [];
      const bellKg = parseInt(String(ex.targetWeight || '20kg'), 10) || 20;
      const kbRepsRd = ex.kbRepsPerRound || 45;

      const renderSidePill = (sideBadge) => {
        if (!sideBadge) return '';
        const isLeft = sideBadge === 'LEFT';
        const isRight = sideBadge === 'RIGHT';
        const shortLabel = isLeft ? '(L)' : (isRight ? '(R)' : sideBadge);
        const bg = isLeft ? 'rgba(245,158,11,0.18)' : (isRight ? 'rgba(0,229,255,0.18)' : 'rgba(168,85,247,0.18)');
        const col = isLeft ? '#fbbf24' : (isRight ? '#38bdf8' : '#c084fc');
        const bdr = isLeft ? 'rgba(245,158,11,0.45)' : (isRight ? 'rgba(0,229,255,0.45)' : 'rgba(168,85,247,0.45)');
        return `<span style="font-size:9.5px; font-weight:900; padding:1px 4px; border-radius:4px; background:${bg}; border:1px solid ${bdr}; color:${col}; flex-shrink:0;">${shortLabel}</span>`;
      };

      const hasRoundCounter = (st.format === 'kb_flow' || st.format === 'amrap' || st.format === 'for_time');
      const escExId = escapeHtml(ex.id);
      const roundBtnHtml = hasRoundCounter ? `
<button type="button" data-ex-id="${escExId}" onclick="logInlineCondRound(this.dataset.exId)" style="padding:5px 9px; font-size:11px; font-weight:900; background:var(--primary); color:#000; border:none; border-radius:7px; cursor:pointer; white-space:nowrap;">+1 Rd (${st.amrapRounds})</button>
        ${st.amrapRounds > 0 ? `<button type="button" onclick="stepInlineRound(-1)" title="Subtract round" style="padding:4px 6px; font-size:11px; font-weight:800; border-radius:6px; border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06); color:#fff; cursor:pointer;">−</button>` : ''}
      ` : '';

      let spotlightLineHtml = '';
      let flowGridHtml = '';
      let sumNumericReps = 0;

      if (flowSteps.length > 0) {
        const parsedSteps = flowSteps.map(step => parseFlowStepString(step));
        const rawActiveIdx = st.activeFlowStepIdx !== undefined ? st.activeFlowStepIdx : (st.flowStepIdx || 0);
        const currIdx = ((rawActiveIdx % flowSteps.length) + flowSteps.length) % flowSteps.length;
        const currParsed = parsedSteps[currIdx];
        const nextIdx = (currIdx + 1) % flowSteps.length;
        const nextParsed = parsedSteps[nextIdx];

        sumNumericReps = parsedSteps.reduce((acc, p) => acc + (p.numericReps || 0), 0);

        spotlightLineHtml = `
<div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; padding-top:5px; border-top:1px solid rgba(0,245,212,0.22);">
<div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; min-width:0; flex:1;">
<span style="font-size:10px; font-weight:900; color:var(--teal, #00f5d4); letter-spacing:0.04em;">NOW (${currIdx + 1}/${flowSteps.length}):</span>
<strong style="font-size:13.5px; color:#fff; font-weight:900;">${escapeHtml(currParsed.moveName)}</strong>
              ${renderSidePill(currParsed.sideBadge)}
<span style="font-size:12px; font-weight:900; font-family:'JetBrains Mono',monospace; padding:2px 7px; border-radius:5px; background:rgba(0,245,212,0.2); border:1.5px solid var(--teal, #00f5d4); color:var(--teal, #00f5d4);">${escapeHtml(currParsed.repsBadge)}</span>
<span style="font-size:10.5px; font-weight:700; color:#94a3b8; white-space:nowrap;">
<span style="color:#38bdf8; font-weight:800;">UP NEXT ➔</span> #${nextIdx + 1} ${escapeHtml(nextParsed.moveName)} (${escapeHtml(nextParsed.repsBadge)})
</span>
</div>
<button type="button" data-ex-id="${escExId}" onclick="advanceInlineCondFlowStep(this.dataset.exId, 1)" style="padding:4px 9px; font-size:11px; font-weight:800; border-radius:7px; background:rgba(0,245,212,0.18); border:1px solid var(--teal, #00f5d4); color:var(--teal, #00f5d4); cursor:pointer; white-space:nowrap; flex-shrink:0;">
              Next ➔
</button>
</div>
        `;

        const ladderRowsHtml = parsedSteps.map((p, idx) => {
          const isCurrent = idx === currIdx;
          const isDone = idx < currIdx;
          const stepNumBg = isCurrent
            ? 'background:var(--teal, #00f5d4); color:#041318; border:1px solid var(--teal, #00f5d4); box-shadow:0 0 8px rgba(0,245,212,0.45);'
            : (isDone
              ? 'background:rgba(16,185,129,0.22); color:#34d399; border:1px solid rgba(16,185,129,0.45);'
              : 'background:rgba(255,255,255,0.07); color:#94a3b8; border:1px solid rgba(255,255,255,0.14);');
          const rowBg = isCurrent
            ? 'background:linear-gradient(90deg, rgba(0,245,212,0.2) 0%, rgba(0,229,255,0.08) 100%); border:1.5px solid var(--teal, #00f5d4); box-shadow:0 0 10px rgba(0,245,212,0.15);'
            : (isDone
              ? 'background:rgba(16,185,129,0.07); border:1px solid rgba(16,185,129,0.24);'
              : 'background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.1);');
          const repPillStyle = isCurrent
            ? 'background:rgba(0,245,212,0.22); border:1.5px solid var(--teal, #00f5d4); color:var(--teal, #00f5d4);'
            : (isDone
              ? 'background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.35); color:#6ee7b7;'
              : 'background:rgba(0,229,255,0.1); border:1px solid rgba(0,229,255,0.28); color:#7dd3fc;');

          return `
<button type="button" data-ex-id="${escExId}" data-step-idx="${idx}" onclick="setInlineCondFlowStep(this.dataset.exId, Number(this.dataset.stepIdx))" style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:5px 9px; border-radius:7px; cursor:pointer; text-align:left; transition:all 0.12s ease; min-width:0; ${rowBg}">
<div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1;">
<span style="width:18px; height:18px; border-radius:5px; display:inline-flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:900; font-family:'JetBrains Mono',monospace; flex-shrink:0; ${stepNumBg}">${isDone ? '✓' : (idx + 1)}</span>
<span style="font-size:13px; font-weight:800; color:#f8fafc; line-height:1.2;">${escapeHtml(p.moveName)}</span>
                ${renderSidePill(p.sideBadge)}
</div>
<span style="font-size:12px; font-weight:900; font-family:'JetBrains Mono',monospace; padding:2px 7px; border-radius:5px; white-space:nowrap; flex-shrink:0; ${repPillStyle}">${escapeHtml(p.repsBadge)}</span>
</button>
          `;
        }).join('');

        flowGridHtml = `
<div style="display:grid; grid-template-columns:1fr; gap:4px;">
            ${ladderRowsHtml}
</div>
        `;
      }

      const totalRepsRd = ex.repsPerRound || sumNumericReps || kbRepsRd;
      const totalTonnage = (st.format === 'kb_flow') ? (st.amrapRounds * kbRepsRd * bellKg) : 0;
      const totalReps = st.amrapRounds * totalRepsRd;

      const intermissionBanner = (st.format === 'kb_flow' && st.inIntermission) ? `
<div style="background:rgba(56,189,248,0.14); border:1.5px solid rgba(56,189,248,0.5); border-radius:8px; padding:6px 9px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
<div style="font-size:11px; font-weight:800; color:#7dd3fc;">
            ${st.intermissionMode === 'none_rest' ? '🧘 Rest Window (60s) — Shake Out Grip' : `🔁 Intermission: Complete ${st.intermissionMode}`}
</div>
<button type="button" onclick="finishKbFlowIntermission()" style="padding:4px 9px; font-size:10.5px; font-weight:900; border-radius:6px; border:none; background:#38bdf8; color:#000; cursor:pointer;">✓ Start Next Flow Round</button>
</div>
      ` : '';

      let drawerExtraControlsHtml = '';
      if (st.format === 'kb_flow') {
        const weightPills = [16, 20, 24, 32].map(w => {
          const active = bellKg === w;
          return `<button type="button" onclick="setKbFlowWeight('${w}kg')" style="padding:3px 8px; font-size:10px; font-weight:800; border-radius:5px; cursor:pointer; border:1px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.14)'}; background:${active ? 'var(--primary)' : 'rgba(255,255,255,0.04)'}; color:${active ? '#000' : 'var(--text-secondary)'};">${w}kg</button>`;
        }).join('');

        const intermissionOpts = [
          { id: 'none_rest', label: '🧘 Rest Only (60s)' },
          { id: '20 Mountain Climbers', label: '🧗 20 Mountain Climbers' },
          { id: '15 Air Squats', label: '🦵 15 Air Squats' },
          { id: '10 Burpees', label: '🔥 10 Burpees' },
          { id: '30s Hollow / Plank', label: '🧱 30s Hollow / Plank' },
          { id: '45s Boxer Bounce', label: '⚡ 45s Boxer Bounce' },
          { id: '10 Push-Ups', label: '💪 10 Push-Ups' }
        ];
        const intermissionPills = intermissionOpts.map(opt => {
          const active = st.intermissionMode === opt.id;
          return `<button type="button" onclick="setKbFlowIntermission('${opt.id}')" style="padding:3px 6px; font-size:10px; font-weight:700; border-radius:5px; cursor:pointer; border:1px solid ${active ? '#38bdf8' : 'rgba(255,255,255,0.12)'}; background:${active ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.03)'}; color:${active ? '#fff' : 'var(--text-muted)'};">${opt.label}</button>`;
        }).join('');

        drawerExtraControlsHtml = `
<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
<span style="font-size:10.5px; font-weight:800; color:var(--text-secondary);">🔔 Bell Weight:</span>
<div style="display:flex; gap:4px;">${weightPills}</div>
</div>
<div>
<div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Between-Round Intermission:</div>
<div style="display:flex; flex-wrap:wrap; gap:4px;">${intermissionPills}</div>
</div>
        `;
      }

      const whyText = ex.rationale || ex.why || 'Selected for target metabolic & biomechanical conditioning.';
      const drawerSummaryText = st.format === 'kb_flow'
        ? `⚙️ Flow Setup (Bell: ${bellKg}kg • ${Math.round(st.durationSec / 60)}m • Intermission: ${st.intermissionMode === 'none_rest' ? 'Rest 60s' : st.intermissionMode}) & Coaching Cues`
        : `⚙️ Timer Presets (${st.format.toUpperCase()}) & Coaching Cues`;

      const bottomStatusText = st.format === 'kb_flow'
        ? `${st.amrapRounds} Rds • ${totalReps.toLocaleString()} reps • ${totalTonnage.toLocaleString()}kg tonnage`
        : ((st.format === 'amrap' || st.format === 'for_time')
          ? `${st.amrapRounds} Rds completed • ${totalReps > 0 ? totalReps + ' reps' : 'Auto-logs stimulus'}`
          : ((fmt.prevRounds !== null && fmt.prevRounds !== undefined)
            ? `Prev benchmark: ${fmt.prevRounds} rds`
            : `Goldfish Timer • Auto-logs session`));

      const playerHtml = `
<div style="background:rgba(3,12,20,0.78); border:1.5px solid rgba(0,245,212,0.35); border-radius:10px; padding:7px 8px; display:flex; flex-direction:column; gap:6px;">
<div style="background:linear-gradient(135deg, rgba(0,245,212,0.14) 0%, rgba(16,185,129,0.09) 100%); border:1px solid rgba(0,245,212,0.42); border-radius:8px; padding:7px 9px; display:flex; flex-direction:column; gap:5px;">
<div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
<div id="inlineTimerDigits" style="font-size:24px; font-weight:900; font-family:var(--font-mono); color:#fff; letter-spacing:-0.03em; line-height:1;">${formatClockMMSS(st.secsLeft)}</div>
<button type="button" onclick="toggleInlineTimer()" style="padding:5px 10px; border-radius:7px; border:none; background:${st.running ? '#f59e0b' : 'var(--primary)'}; color:#000; font-size:11px; font-weight:900; cursor:pointer;">${st.running ? '⏸' : '▶ Start'}</button>
<button type="button" onclick="resetInlineTimer()" title="Reset timer" style="padding:5px 7px; border-radius:7px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.06); color:#fff; font-size:11px; font-weight:800; cursor:pointer;">↺</button>
                ${(st.format === 'interval' || st.format === 'emom' || st.rounds > 1) ? `<button type="button" onclick="skipInlinePhase()" title="Next phase" style="padding:5px 7px; border-radius:7px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.06); color:#fff; font-size:11px; font-weight:800; cursor:pointer;">⏭</button>` : ''}
                ${roundBtnHtml}
</div>
<span id="inlineTimerPhaseBadge" style="font-size:10px; font-weight:800; color:${phaseColor}; letter-spacing:0.03em; text-transform:uppercase;">${phaseLabel}</span>
</div>
            ${spotlightLineHtml}
</div>
          ${flowGridHtml}
          ${intermissionBanner}
<details data-details-key="inline_conditioning_drill" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.09); border-radius:7px; padding:5px 8px;">
<summary style="font-size:10.5px; font-weight:800; color:#cbd5e1; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center; gap:6px;">
<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${drawerSummaryText}</span>
<span style="font-size:10px; color:var(--primary); flex-shrink:0;">▼</span>
</summary>
<div style="margin-top:7px; padding-top:7px; border-top:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; gap:7px; font-size:11px;">
<div>
<div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Duration / Interval Presets:</div>
<div style="display:flex; gap:4px; flex-wrap:wrap;">${presetsHtml}</div>
</div>
              ${drawerExtraControlsHtml}
<div style="color:#e2e8f0; line-height:1.35;"><strong style="color:var(--primary);">Coaching Cue:</strong> ${escapeHtml(ex.cue || '')}</div>
<div style="color:var(--text-secondary); line-height:1.35;"><strong>Why Selected:</strong> ${escapeHtml(whyText)}</div>
<div style="display:flex; gap:6px;">
<button type="button" onclick="openSwapModal('swap')" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.16); color:#fff; border-radius:6px; padding:4px 8px; font-size:10.5px; font-weight:700; cursor:pointer; flex:1;">⇄ Swap Session</button>
<button type="button" onclick="openEditLoadModalForActive()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.16); color:#fff; border-radius:6px; padding:4px 8px; font-size:10.5px; font-weight:700; cursor:pointer; flex:1;">✎ Edit Bell / Target</button>
</div>
</div>
</details>
<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; padding:2px 2px 0;">
<span style="font-size:10.5px; font-weight:800; color:#94a3b8;">${bottomStatusText}</span>
<button type="button" data-ex-id="${escExId}" onclick="completeInlineConditioning(this.dataset.exId)" style="padding:5px 11px; border-radius:7px; background:${isLogged ? '#10b981' : 'rgba(16,185,129,0.22)'}; border:1px solid rgba(16,185,129,0.55); color:${isLogged ? '#000' : '#34d399'}; font-size:11px; font-weight:900; cursor:pointer; white-space:nowrap;">
              ${isLogged ? '✓ Session Logged' : '✓ Complete & Log Session'}
</button>
</div>
</div>
      `;
      const applyHtml = () => { container.innerHTML = playerHtml; };
      if (typeof _withPreservedDetails === 'function') {
        _withPreservedDetails(applyHtml);
      } else {
        applyHtml();
      }
    }

    function setKbFlowWeight(weightStr) {
      const ex = activeWorkoutPlan[currentExIdx];
      if (!ex) return;
      ex.targetWeight = weightStr;
      renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      const tEl = document.getElementById('exTarget');
      if (tEl) tEl.innerText = `Prescribed: ${ex.targetReps || '30m AMRAP'} @ ${weightStr}`;
      beep(680, 0.05);
    }
    window.setKbFlowWeight = setKbFlowWeight;

    function setKbFlowIntermission(mode) {
      inlineTimerState.intermissionMode = mode;
      try { localStorage.setItem('pulse_kb_intermission', mode); } catch(e) {}
      const ex = activeWorkoutPlan[currentExIdx];
      if (ex) renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      beep(620, 0.05);
    }
    window.setKbFlowIntermission = setKbFlowIntermission;

    function toggleKbFlowStep(idx) {
      setInlineCondFlowStep(inlineTimerState.exId, idx);
    }
    window.toggleKbFlowStep = toggleKbFlowStep;

    function logInlineCondRound(exId) {
      inlineTimerState.amrapRounds = (inlineTimerState.amrapRounds || 0) + 1;
      inlineTimerState.activeFlowStepIdx = 0;
      inlineTimerState.flowStepIdx = 0;
      if (inlineTimerState.format === 'kb_flow') {
        inlineTimerState.inIntermission = true;
        if (inlineTimerState.intermissionMode === 'none_rest' && typeof startRestCountdown === 'function') {
          startRestCountdown(60, 'Next KB Flow Round');
        }
      }
      const ex = activeWorkoutPlan[currentExIdx] || getAllExercises().find(e => e.id === exId);
      if (ex) renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      if (typeof pulseHaptic === 'function') pulseHaptic([20, 35, 20]);
      beep(880, 0.12);
    }
    window.logInlineCondRound = logInlineCondRound;

    function completeKbFlowRound() {
      logInlineCondRound(inlineTimerState.exId);
    }
    window.completeKbFlowRound = completeKbFlowRound;

    function finishKbFlowIntermission() {
      inlineTimerState.inIntermission = false;
      inlineTimerState.activeFlowStepIdx = 0;
      inlineTimerState.flowStepIdx = 0;
      const ex = activeWorkoutPlan[currentExIdx];
      if (ex) renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      beep(780, 0.08);
    }
    window.finishKbFlowIntermission = finishKbFlowIntermission;

    function setInlinePreset(format, val1, val2, val3) {
      stopInlineTimer();
      const ex = activeWorkoutPlan[currentExIdx];
      if (!ex) return;
      if (format === 'interval') {
        inlineTimerState.workSec = val1;
        inlineTimerState.restSec = val2;
        inlineTimerState.rounds = val3;
        inlineTimerState.phase = 'work';
        inlineTimerState.currentRound = 1;
        inlineTimerState.secsLeft = val1;
      } else if (format === 'emom') {
        inlineTimerState.workSec = 60;
        inlineTimerState.rounds = val1;
        inlineTimerState.currentRound = 1;
        inlineTimerState.phase = 'emom';
        inlineTimerState.secsLeft = 60;
      } else if (format === 'amrap' || format === 'kb_flow') {
        inlineTimerState.durationSec = val1 * 60;
        inlineTimerState.secsLeft = val1 * 60;
        inlineTimerState.amrapRounds = 0;
        inlineTimerState.inIntermission = false;
      } else if (format === 'for_time') {
        inlineTimerState.durationSec = val1 * 60;
        inlineTimerState.secsLeft = 0;
        inlineTimerState.amrapRounds = 0;
      } else {
        inlineTimerState.workSec = val1;
        inlineTimerState.restSec = val2;
        inlineTimerState.rounds = val3;
        inlineTimerState.currentRound = 1;
        inlineTimerState.phase = 'work';
        inlineTimerState.secsLeft = val1;
      }
      inlineTimerState.elapsedSec = 0;
      renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      beep(650, 0.05);
    }

    function stepInlineRound(delta) {
      inlineTimerState.amrapRounds = Math.max(0, inlineTimerState.amrapRounds + delta);
      if (delta > 0) {
        inlineTimerState.activeFlowStepIdx = 0;
        inlineTimerState.flowStepIdx = 0;
      }
      const ex = activeWorkoutPlan[currentExIdx];
      if (ex) renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      beep(780, 0.05);
    }

    function resetInlineTimer() {
      stopInlineTimer();
      const ex = activeWorkoutPlan[currentExIdx];
      if (!ex) return;
      inlineTimerState.currentRound = 1;
      inlineTimerState.elapsedSec = 0;
      inlineTimerState.activeFlowStepIdx = 0;
      inlineTimerState.flowStepIdx = 0;
      if (inlineTimerState.format === 'amrap' || inlineTimerState.format === 'kb_flow') {
        inlineTimerState.secsLeft = inlineTimerState.durationSec;
        inlineTimerState.inIntermission = false;
      } else if (inlineTimerState.format === 'for_time') {
        inlineTimerState.secsLeft = 0;
      } else {
        inlineTimerState.phase = inlineTimerState.format === 'emom' ? 'emom' : 'work';
        inlineTimerState.secsLeft = inlineTimerState.workSec;
      }
      renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      beep(450, 0.06);
    }

    function skipInlinePhase() {
      const ex = activeWorkoutPlan[currentExIdx];
      if (!ex) return;
      if (inlineTimerState.format === 'interval' || inlineTimerState.format === 'steady') {
        if (inlineTimerState.phase === 'work' && inlineTimerState.restSec > 0 && inlineTimerState.currentRound < inlineTimerState.rounds) {
          inlineTimerState.phase = 'rest';
          inlineTimerState.secsLeft = inlineTimerState.restSec;
        } else if (inlineTimerState.currentRound < inlineTimerState.rounds) {
          inlineTimerState.currentRound++;
          inlineTimerState.phase = 'work';
          inlineTimerState.secsLeft = inlineTimerState.workSec;
        } else {
          stopInlineTimer();
          completeInlineConditioning(ex.id);
          return;
        }
      } else if (inlineTimerState.format === 'emom') {
        if (inlineTimerState.currentRound < inlineTimerState.rounds) {
          inlineTimerState.currentRound++;
          inlineTimerState.secsLeft = 60;
        } else {
          stopInlineTimer();
          completeInlineConditioning(ex.id);
          return;
        }
      }
      renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      beep(700, 0.08);
    }

    function _stepInlineTimerSeconds(deltaSec, isCatchUp) {
      const ex = activeWorkoutPlan[currentExIdx];
      const st = inlineTimerState;
      const steps = Math.max(0, Math.floor(deltaSec));
      if (st.format === 'for_time' && steps > 0 && st.running) {
        st.elapsedSec += steps;
        if (st.elapsedSec >= st.durationSec) {
          st.secsLeft = st.durationSec;
          stopInlineTimer();
          beep(900, 0.25);
          speak("Time cap reached.");
          completeInlineConditioning(ex ? ex.id : st.exId);
          return;
        }
        st.secsLeft = st.elapsedSec;
      } else {
        if ((st.format === 'amrap' || st.format === 'kb_flow') && steps > 0 && st.running) {
          const applied = Math.min(steps, st.secsLeft);
          st.elapsedSec += applied;
          st.secsLeft -= applied;
          if (st.secsLeft <= 0) {
            st.secsLeft = 0;
            stopInlineTimer();
            beep(950, 0.3);
            speak("Time complete!");
            completeInlineConditioning(ex ? ex.id : st.exId);
            return;
          }
        } else {
          for (let i = 0; i < steps; i++) {
            if (!st.running) return;
            st.elapsedSec++;
            st.secsLeft--;
            if (st.secsLeft <= 0) {
              const isFinalStep = (i === steps - 1);
              if (st.format === 'interval' || (st.format === 'steady' && st.rounds > 1)) {
                if (st.phase === 'work' && st.restSec > 0 && st.currentRound < st.rounds) {
                  st.phase = 'rest';
                  st.secsLeft = st.restSec;
                  if (isFinalStep || !isCatchUp) { beep(520, 0.18); speak("Rest."); }
                } else if (st.currentRound < st.rounds) {
                  st.currentRound++;
                  st.phase = 'work';
                  st.secsLeft = st.workSec;
                  if (isFinalStep || !isCatchUp) { beep(880, 0.18); speak(`Round ${st.currentRound}. Work!`); }
                } else {
                  stopInlineTimer();
                  beep(950, 0.3);
                  speak("Conditioning block complete!");
                  completeInlineConditioning(ex ? ex.id : st.exId);
                  return;
                }
              } else if (st.format === 'emom') {
                if (st.currentRound < st.rounds) {
                  st.currentRound++;
                  st.secsLeft = 60;
                  if (isFinalStep || !isCatchUp) { beep(880, 0.18); speak(`Minute ${st.currentRound}.`); }
                } else {
                  stopInlineTimer();
                  beep(950, 0.3);
                  speak("EMOM complete!");
                  completeInlineConditioning(ex ? ex.id : st.exId);
                  return;
                }
              } else {
                stopInlineTimer();
                beep(950, 0.3);
                speak("Time complete!");
                completeInlineConditioning(ex ? ex.id : st.exId);
                return;
              }
            }
          }
        }
      }
      const badgeEl = document.getElementById('inlineTimerPhaseBadge');
      if (badgeEl) {
        if (st.format === 'interval' || (st.format === 'steady' && st.rounds > 1)) {
          badgeEl.innerText = st.phase === 'rest'
            ? `REST • R${st.currentRound}/${st.rounds}`
            : `WORK • R${st.currentRound}/${st.rounds}`;
          badgeEl.style.color = st.phase === 'rest' ? '#f59e0b' : '#22c55e';
        } else if (st.format === 'emom') {
          badgeEl.innerText = `MIN ${st.currentRound}/${st.rounds}`;
          badgeEl.style.color = '#00e5ff';
        }
      }
      const digitsEl = document.getElementById('inlineTimerDigits');
      if (digitsEl) digitsEl.innerText = formatClockMMSS(st.secsLeft);
    }

    function _tickInlineTimerFromClock() {
      const st = inlineTimerState;
      if (!st.running) return;
      const nowMs = Date.now();
      if (!st.lastTickMs) st.lastTickMs = nowMs;
      const deltaSec = Math.floor((nowMs - st.lastTickMs) / 1000);
      if (deltaSec > 0) {
        st.lastTickMs += deltaSec * 1000;
        _stepInlineTimerSeconds(deltaSec, deltaSec > 3);
      }
    }

    function toggleInlineTimer() {
      const ex = activeWorkoutPlan[currentExIdx];
      if (!ex) return;
      if (inlineTimerState.running) {
        _tickInlineTimerFromClock();
        stopInlineTimer();
        renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
        return;
      }
      const isResume = inlineTimerState.elapsedSec > 0 || inlineTimerState.currentRound > 1 || inlineTimerState.phase === 'rest';
      inlineTimerState.running = true;
      inlineTimerState.lastTickMs = Date.now();
      requestWakeLock();
      beep(880, 0.1);
      if (isResume) {
        if (inlineTimerState.format === 'interval' || (inlineTimerState.format === 'steady' && inlineTimerState.rounds > 1)) {
          speak(inlineTimerState.phase === 'rest'
            ? `Resuming rest, round ${inlineTimerState.currentRound}.`
            : `Resuming round ${inlineTimerState.currentRound}. Work!`);
        } else if (inlineTimerState.format === 'emom') {
          speak(`Resuming minute ${inlineTimerState.currentRound}.`);
        } else {
          speak("Resuming timer.");
        }
      } else {
        if (inlineTimerState.format === 'interval') speak("Work! Let's go!");
        else if (inlineTimerState.format === 'emom') speak("Minute 1. Go!");
        else if (inlineTimerState.format === 'amrap') speak("AMRAP started.");
        else if (inlineTimerState.format === 'kb_flow') speak("Kettlebell flow AMRAP started.");
      }

      inlineTimerState.intervalId = setInterval(_tickInlineTimerFromClock, 250);
      renderInlineConditioningPlayer(ex, getExerciseFormatConfig(ex));
      const badgeEl = document.getElementById('inlineTimerPhaseBadge');
      if (badgeEl && (inlineTimerState.format === 'interval' || inlineTimerState.format === 'emom')) {
        if (inlineTimerState.format === 'emom') {
          badgeEl.innerText = `⏱ EMOM • MINUTE ${inlineTimerState.currentRound} OF ${inlineTimerState.rounds}`;
        } else if (inlineTimerState.phase === 'rest') {
          badgeEl.innerText = `🔵 REST • ROUND ${inlineTimerState.currentRound} OF ${inlineTimerState.rounds}`;
        } else {
          badgeEl.innerText = `🟢 WORK • ROUND ${inlineTimerState.currentRound} OF ${inlineTimerState.rounds}`;
        }
      }
    }

    function completeInlineConditioning(exId) {
      stopInlineTimer();
      const ex = activeWorkoutPlan[currentExIdx] || getAllExercises().find(e => e.id === exId);
      const st = inlineTimerState;
      const totalDurationSec = st.elapsedSec > 10 ? st.elapsedSec : ((st.format === 'amrap' || st.format === 'kb_flow') ? st.durationSec : (st.workSec + st.restSec) * st.rounds);
      const estBurn = Math.max(25, Math.round((totalDurationSec / 60) * 10.5));
      const bellKg = parseInt(String((ex && ex.targetWeight) || '20kg'), 10) || 20;
      const kbRepsRd = (ex && ex.kbRepsPerRound) ? ex.kbRepsPerRound : 45;
      const totalTonnageKg = st.format === 'kb_flow' ? (st.amrapRounds * kbRepsRd * bellKg) : 0;

      sessionLoggedSets[`${exId}_1`] = {
        exercise_id: exId,
        weight: ex ? (ex.targetWeight || 'Body') : 'Body',
        reps: st.format === 'kb_flow' ? `${st.amrapRounds} rds (${totalTonnageKg}kg)` : (st.format === 'amrap' ? `${st.amrapRounds} rds` : formatClockMMSS(totalDurationSec)),
        logged: true,
        status: 'hit',
        format: st.format,
        durationSec: totalDurationSec,
        estBurn
      };

      // Elephant Progression: advance rounds or record AMRAP/For-Time benchmark
      let nextMsg = '';
      const nowIso = new Date().toISOString();
      if (st.format === 'interval' || st.format === 'emom') {
        const nextRounds = Math.min(16, st.rounds + 1);
        saveConditioningProgression(exId, { workSec: st.workSec, restSec: st.restSec, nextRounds, lastDate: nowIso });
        nextMsg = `Conditioning density hit (${st.rounds} rounds, ~${estBurn} kcal). Next session progresses to ${nextRounds} rounds.`;
      } else if (st.format === 'amrap') {
        saveConditioningProgression(exId, { durationSec: st.durationSec, amrapRounds: st.amrapRounds, lastDate: nowIso });
        nextMsg = `AMRAP logged: ${st.amrapRounds} rounds in ${Math.round(st.durationSec / 60)}m (~${estBurn} kcal). Beat ${st.amrapRounds} next time.`;
      } else if (st.format === 'kb_flow') {
        const intermissionLabel = st.intermissionMode === 'none_rest' ? 'Rest Only (60s)' : (st.intermissionMode || 'Rest Only');
        saveConditioningProgression(exId, {
          durationSec: st.durationSec,
          amrapRounds: st.amrapRounds,
          intermissionMode: st.intermissionMode,
          bellWeight: ex ? ex.targetWeight : '20kg',
          totalTonnageKg,
          name: ex ? ex.name : 'KB Flow AMRAP',
          format: 'kb_flow',
          roundsCompleted: st.amrapRounds,
          totalSeconds: totalDurationSec,
          date: nowIso,
          lastDate: nowIso
        });
        nextMsg = `KB Flow logged: ${st.amrapRounds} rounds (${totalTonnageKg.toLocaleString()} kg tonnage) in ${Math.round(st.durationSec / 60)}m • ${intermissionLabel} (~${estBurn} kcal). Beat ${st.amrapRounds} next time.`;
      } else if (st.format === 'for_time') {
        saveConditioningProgression(exId, { elapsedSec: totalDurationSec, lastDate: nowIso });
        nextMsg = `For-Time benchmark logged: ${formatClockMMSS(totalDurationSec)} (~${estBurn} kcal).`;
      } else {
        nextMsg = `Timed block logged (${formatClockMMSS(totalDurationSec)}, ~${estBurn} kcal).`;
      }

      _appendConditioningHistoryEntry({
        exId: exId,
        name: ex ? ex.name : (st.format || 'Conditioning'),
        date: nowIso,
        mode: st.format,
        format: st.format,
        rounds: (st.format === 'kb_flow' || st.format === 'amrap') ? st.amrapRounds : st.rounds,
        amrapRounds: st.amrapRounds,
        duration_min: Math.max(1, Math.round(totalDurationSec / 60)),
        calories: estBurn,
        sub_title: ex ? ex.name : 'Conditioning'
      });

      saveActiveSessionToLocalStorage();
      const banner = document.getElementById('autoregBanner');
      const tag = document.getElementById('autoregTag');
      const msg = document.getElementById('autoregMessage');
      const e1rmEl = document.getElementById('e1rmMetric');
      if (banner && tag && msg) {
        banner.classList.add('active');
        tag.innerText = '✓ CONDITIONING PROGRESS LOGGED';
        msg.innerText = nextMsg;
        if (e1rmEl) e1rmEl.innerText = `~${estBurn} kcal`;
      }
      if (ex) renderCurrentExercise();
      if (typeof pulseHaptic === 'function') pulseHaptic([35, 50, 35, 50, 60]);
      showToast(`✓ Logged ${ex ? ex.name : 'Conditioning'}`);
      openSessionSummaryModal({
        title: ex ? ex.name : 'Conditioning Block',
        format: st.format,
        durationSec: totalDurationSec,
        rounds: st.format === 'kb_flow' || st.format === 'amrap' ? st.amrapRounds : st.rounds,
        tonnageKg: totalTonnageKg,
        estBurn,
        note: nextMsg
      });
    }

    function openSessionSummaryModal(opts = {}) {
      const modal = document.getElementById('sessionSummaryModal');
      const card = document.getElementById('sessionSummaryCard');
      if (!modal || !card) return;
      const mins = Math.max(1, Math.round((opts.durationSec || 0) / 60));
      const tonnage = Number(opts.tonnageKg || 0);
      const rounds = opts.rounds !== undefined ? opts.rounds : '--';
      const estBurn = opts.estBurn || 0;
      card.innerHTML = `
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
<span style="font-size:10.5px; font-weight:800; letter-spacing:0.08em; color:#00e5ff; text-transform:uppercase;">🏆 Session Complete</span>
<span onclick="closeSessionSummaryModal()" style="cursor:pointer; color:var(--text-muted); font-size:16px; padding:2px 6px;">✕</span>
</div>
<div style="font-size:16px; font-weight:800; color:#fff; line-height:1.25; margin-bottom:12px;">${escapeHtml(opts.title || 'Workout Logged')}</div>
<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:12px;">
<div style="background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; padding:9px 10px;">
<div style="font-size:10px; color:var(--text-muted); font-weight:700;">DURATION</div>
<div style="font-size:20px; font-weight:800; color:#fff; font-family:var(--font-mono);">${mins}m</div>
</div>
<div style="background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; padding:9px 10px;">
<div style="font-size:10px; color:var(--text-muted); font-weight:700;">ROUNDS</div>
<div style="font-size:20px; font-weight:800; color:#00e5ff; font-family:var(--font-mono);">${escapeHtml(rounds)}</div>
</div>
<div style="background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; padding:9px 10px;">
<div style="font-size:10px; color:var(--text-muted); font-weight:700;">TONNAGE</div>
<div style="font-size:20px; font-weight:800; color:#a855f7; font-family:var(--font-mono);">${tonnage > 0 ? tonnage.toLocaleString() + 'kg' : 'Body'}</div>
</div>
<div style="background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; padding:9px 10px;">
<div style="font-size:10px; color:var(--text-muted); font-weight:700;">EST. BURN</div>
<div style="font-size:20px; font-weight:800; color:#10b981; font-family:var(--font-mono);">~${estBurn} kcal</div>
</div>
</div>
<div style="font-size:11.5px; color:#cbd5e1; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.2); border-radius:8px; padding:8px 10px; line-height:1.4; margin-bottom:12px;">
          ${escapeHtml(opts.note || 'Saved to PULSE conditioning history & ready for Garmin activity auto-pairing.')}
</div>
<button type="button" onclick="closeSessionSummaryModal()" class="btn-action-primary" style="width:100%; margin:0;">✓ Done</button>
      `;
      modal.classList.add('open');
    }
    window.openSessionSummaryModal = openSessionSummaryModal;

    function closeSessionSummaryModal() {
      const modal = document.getElementById('sessionSummaryModal');
      if (modal) modal.classList.remove('open');
    }
    window.closeSessionSummaryModal = closeSessionSummaryModal;

    function computeBarbellPlatesPerSide(totalKg, barKg = 20) {
      const total = typeof totalKg === 'number'
        ? totalKg
        : parseFloat(String(totalKg || '').toLowerCase().replace(/kg/g, '').trim());
      if (!Number.isFinite(total) || total <= 0) {
        return { valid: false, belowBar: false, barKg, plates: [], remainder: 0, label: '' };
      }
      if (total < barKg) {
        return { valid: false, belowBar: true, barKg, plates: [], remainder: 0, label: `Below ${barKg}kg bar` };
      }
      if (Math.abs(total - barKg) < 0.01) {
        return { valid: true, belowBar: false, barOnly: true, barKg, plates: [], remainder: 0, label: `Bar only (${barKg}kg)` };
      }
      let perSide = (total - barKg) / 2.0;
      const plates = [];
      const available = [20, 15, 10, 5, 2.5, 1.25];
      for (const p of available) {
        while (perSide + 1e-6 >= p) {
          plates.push(p);
          perSide -= p;
        }
      }
      const rem = Math.round(perSide * 100) / 100;
      const plateText = plates.join(' + ');
      const remSuffix = rem > 0.05 ? ` (+${rem}kg/side rem)` : '';
      return {
        valid: true,
        belowBar: false,
        barOnly: false,
        barKg,
        plates,
        remainder: rem,
        label: `[${plateText}] kg/side on ${barKg}kg bar${remSuffix}`
      };
    }

    function _isBarbellPlateEligible(ex) {
      if (!ex || !Array.isArray(ex.requiredGear) || !ex.requiredGear.includes('barbell')) return false;
      const nm = String(ex.name || '');
      if (/\b(dumbbell|db|kettlebell|kb|bodyweight|band)\b/i.test(nm)) return false;
      return true;
    }

    function _updatePlateCalcForExercise(ex, weightOverride = null) {
      const el = document.getElementById('exPlateCalcRow');
      if (!el) return;
      if (!_isBarbellPlateEligible(ex)) {
        el.style.display = 'none';
        el.innerText = '';
        return;
      }
      const rawW = weightOverride !== null ? weightOverride : ex.targetWeight;
      const strW = String(rawW ?? '').trim();
      if (/^(body|bw|bodyweight)/i.test(strW) || /2\s*[×x]/i.test(strW)) {
        el.style.display = 'none';
        el.innerText = '';
        return;
      }
      const calc = computeBarbellPlatesPerSide(rawW, 20);
      if (calc.belowBar) {
        el.innerText = `Plates: Below ${calc.barKg}kg bar`;
        el.style.display = 'block';
        return;
      }
      if (!calc.valid) {
        el.style.display = 'none';
        el.innerText = '';
        return;
      }
      el.innerText = `Plates: ${calc.label}`;
      el.style.display = 'block';
    }

    function stepSetInput(exIdx, setNum, field, delta) {
      if (field === 'weight') {
        const wEl = document.getElementById(`wIn_${exIdx}_${setNum}`);
        if (!wEl) return;
        const raw = String(wEl.value || '').trim();
        const hasPrefix2x = /^2\s*[×x]\s*/i.test(raw);
        const hasKg = /kg$/i.test(raw);
        const stripped = raw.replace(/^2\s*[×x]\s*/i, '').replace(/kg$/i, '').trim();
        if (!/^\d+(?:\.\d+)?$/.test(stripped)) return;
        const nextVal = Math.max(0, Math.round((parseFloat(stripped) + Number(delta || 0)) * 10) / 10);
        wEl.value = hasPrefix2x ? `2×${nextVal}${hasKg ? 'kg' : ''}` : `${nextVal}${hasKg ? 'kg' : ''}`;
        if (typeof beep === 'function') beep(520, 0.04);
        if (typeof pulseHaptic === 'function') pulseHaptic(10);
        if (typeof activeWorkoutPlan !== 'undefined' && activeWorkoutPlan[exIdx]) {
          _updatePlateCalcForExercise(activeWorkoutPlan[exIdx], nextVal);
        }
      } else if (field === 'reps') {
        const rEl = document.getElementById(`rIn_${exIdx}_${setNum}`);
        if (!rEl) return;
        const cur = parseInt(String(rEl.value || '').trim(), 10);
        if (isNaN(cur)) return;
        rEl.value = Math.max(0, cur + Number(delta || 0));
        if (typeof beep === 'function') beep(520, 0.04);
        if (typeof pulseHaptic === 'function') pulseHaptic(10);
      }
    }

    function toggleWorkoutFocusMode() {
      if (typeof document === 'undefined' || !document.body) return;
      const active = document.body.classList.toggle('workout-focus-mode');
      const btn = document.getElementById('btnWorkoutFocusMode');
      if (btn) btn.innerText = active ? 'Focus On' : 'Focus Mode';
      if (typeof beep === 'function') beep(650, 0.04);
    }

    function _renderPrBadgeSlot(isPr, e1rmVal = null) {
      const slot = document.getElementById('prBadgeSlot');
      if (!slot) return;
      if (!isPr) {
        slot.innerHTML = '';
        return;
      }
      const label = e1rmVal ? `NEW e1RM PR (${e1rmVal}kg)` : 'NEW e1RM PR';
      slot.innerHTML = `<span class="pr-badge">${escapeHtml(label)}</span>`;
    }

    function _getWarmupCountForExercise(ex) {
      if (!ex) return 0;
      let maxLoggedWu = 0;
      if (typeof sessionLoggedSets === 'object' && sessionLoggedSets) {
        const prefix = `${ex.id}_wu`;
        Object.keys(sessionLoggedSets).forEach((k) => {
          if (!k.startsWith(prefix)) return;
          const idx = parseInt(k.slice(prefix.length), 10);
          if (!isNaN(idx) && idx > maxLoggedWu) maxLoggedWu = idx;
        });
      }
      return Math.min(3, Math.max(Number(ex.warmupSetsCount || 0), maxLoggedWu));
    }

    function _defaultWarmupWeightForExercise(ex, wuIdx) {
      const cleanW = _coerceSetWeightNumber(ex ? ex.targetWeight : 0);
      if (isNaN(cleanW) || cleanW <= 0 || /^(body|bw)/i.test(String(ex?.targetWeight || ''))) {
        return 'Body';
      }
      if (wuIdx <= 1) {
        if (cleanW >= 40) return 20;
        return Math.max(2.5, Math.round((cleanW * 0.5) / 2.5) * 2.5);
      }
      return Math.max(2.5, Math.round((cleanW * 0.65) / 2.5) * 2.5);
    }

    function addWarmupSetForCurrentExercise() {
      if (!Array.isArray(activeWorkoutPlan) || !activeWorkoutPlan[currentExIdx]) return;
      const ex = activeWorkoutPlan[currentExIdx];
      const cur = _getWarmupCountForExercise(ex);
      if (cur >= 3) {
        if (typeof showToast === 'function') showToast('Max 3 warm-up sets per exercise');
        return;
      }
      ex.warmupSetsCount = cur + 1;
      renderCurrentExercise();
      saveActiveSessionToLocalStorage();
      if (typeof beep === 'function') beep(620, 0.05);
    }

    function logWarmupSet(btn, wuIdx, exId, targetW, targetR) {
      const row = btn.closest('.set-log-row');
      const parsedTargetW = _coerceSetWeightNumber(targetW);
      const numTargetW = (!isNaN(parsedTargetW) && parsedTargetW >= 0) ? parsedTargetW : 0;

      const wEl = document.getElementById(`wIn_${currentExIdx}_wu${wuIdx}`);
      const rEl = document.getElementById(`rIn_${currentExIdx}_wu${wuIdx}`);
      const parsedW = _coerceSetWeightNumber(wEl ? wEl.value : 0);
      const loggedW = (!isNaN(parsedW) && parsedW >= 0) ? parsedW : 0;
      const parsedR = parseInt(rEl ? rEl.value : '8', 10);
      const loggedR = (!isNaN(parsedR) && parsedR >= 0) ? parsedR : 8;

      btn.classList.add('done');
      btn.innerText = '✓ Logged';
      if (row) {
        row.classList.remove('missed');
        row.classList.add('logged');
      }

      const warmupE1RM = calcE1RM(loggedW, loggedR);
      const banner = document.getElementById('autoregBanner');
      const tag = document.getElementById('autoregTag');
      const msg = document.getElementById('autoregMessage');
      const metric = document.getElementById('e1rmMetric');
      const transfer = document.getElementById('transferMessage');
      if (banner) banner.classList.add('active');
      if (metric) metric.innerText = loggedW > 0 ? `Warmup: ${loggedW}kg × ${loggedR} (e1RM ${warmupE1RM}kg)` : `Warmup: BW × ${loggedR}`;
      if (tag) {
        tag.innerText = '🔥 WARMUP SET RECORDED';
        tag.style.color = 'var(--amber)';
      }
      if (msg) msg.innerText = `Warmup ${wuIdx} logged (${loggedW > 0 ? `${loggedW}kg` : 'BW'} × ${loggedR}). Excluded from PR ceilings and double-progression.`;
      if (transfer) transfer.innerText = `➔ Tissue Readiness: Progressive ramp prepares joints and CNS for working sets.`;
      _renderPrBadgeSlot(false);

      sessionLoggedSets[`${exId}_wu${wuIdx}`] = {
        exercise_id: exId,
        set_num: 0,
        warmup_num: wuIdx,
        weight: loggedW,
        reps: loggedR,
        target_w: numTargetW,
        target_r: targetR,
        logged: true,
        is_warmup: true,
        explicit_warmup: true,
        status: 'warmup',
        e1rm: warmupE1RM,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      saveActiveSessionToLocalStorage();
      Promise.resolve(syncSetToBackend(exId, numTargetW, targetR, loggedW, loggedR, { isWarmup: true })).catch(() => {});
      if (typeof beep === 'function') beep(640, 0.08);
      const activeExObj = activeWorkoutPlan[currentExIdx];
      startRestCountdown(Math.min(60, parseRestSeconds(activeExObj && activeExObj.rest)), 'Set 1');
    }

    if (typeof window !== 'undefined') {
      window.addWarmupSetForCurrentExercise = addWarmupSetForCurrentExercise;
      window.logWarmupSet = logWarmupSet;
    }

    // EXERCISE STEPPER & AUTOREGULATION LOGGING
    function renderCurrentExercise() {
      if (!Array.isArray(activeWorkoutPlan) || activeWorkoutPlan.length === 0) return;

      const rawIdx = Number(currentExIdx);
      if (!Number.isInteger(rawIdx) || rawIdx < 0 || rawIdx >= activeWorkoutPlan.length || !activeWorkoutPlan[rawIdx] || typeof activeWorkoutPlan[rawIdx] !== 'object') {
        const firstValidIdx = activeWorkoutPlan.findIndex((item) => item && typeof item === 'object');
        if (firstValidIdx < 0) return;
        currentExIdx = firstValidIdx;
      }

      _renderPrBadgeSlot(false);
      const isPickOneMenu = (currentArchetypeKey === 'option_b') || (
        currentArchetypeKey === 'option_kb' &&
        getKbSubMode() !== 'grinds' &&
        !(typeof window !== 'undefined' && window._activePlanIsFallbackSequence) &&
        activeWorkoutPlan.some(item => item && (item.format === 'kb_flow' || String(item.id || '').startsWith('kb_flow_')))
      );
      const ex = activeWorkoutPlan[currentExIdx];
      const fmt = getExerciseFormatConfig(ex);
      if (inlineTimerState && inlineTimerState.exId && inlineTimerState.exId !== ex.id) {
        stopInlineTimer();
      }
      const isFlowOrCond = Boolean(fmt && (fmt.isTimed || (fmt.format && fmt.format !== 'strength' && fmt.format !== 'standard_sets')));

      const stepperHdr = document.getElementById('exerciseStepperHeader');
      if (stepperHdr) {
        if (isFlowOrCond) {
          stepperHdr.style.display = 'none';
        } else if (isPickOneMenu) {
          stepperHdr.style.display = 'block';
          stepperHdr.innerText = currentArchetypeKey === 'option_b'
            ? `🎯 Pick 1 Conditioning / Aerobic Session (${activeWorkoutPlan.length} Options):`
            : `🎯 Pick 1 Standalone 30-Min KB Flow (${activeWorkoutPlan.length} Options):`;
        } else {
          stepperHdr.style.display = 'none';
        }
      }

      const shortPillLabels = {
        zone2_flush: '🚶 20m Zone 2',
        speed_rope_intervals: '🪢 6m Speed Rope',
        emom_hybrid_10: '⚡ 10m EMOM',
        amrap_hybrid_10: '🔥 10m AMRAP',
        for_time_kb_chipper: '🏁 12m Chipper',
        kb_flow_2h_out_about: '🌊 Out & About (9)',
        kb_flow_2h_tactical_upper: '💪 Tactical Upper',
        kb_flow_2h_gladiator_post: '🛡️ Gladiator Hinge',
        kb_flow_2h_pyramid_1_5: '📐 1-to-5 Pyramid',
        kb_flow_1h_armor_chain: '⚡ Armor Chain',
        kb_flow_1h_viking_warrior: '⚔️ Viking Warrior',
        kb_flow_1h_dan_john_grind: '🏋️ Dan John Grind',
        kb_flow_1h_combat_core: '🥊 Combat Core'
      };

      const stepperEl = document.getElementById('exerciseStepperPills');
      if (stepperEl) {
        stepperEl.style.padding = isFlowOrCond ? '1px 0 4px' : '2px 0 6px';
        stepperEl.innerHTML = activeWorkoutPlan.map((exItem, idx) => {
          if (!exItem || typeof exItem !== 'object') return '';
          const isActive = idx === currentExIdx;
          const isSkipped = !!exItem.skipped;
          let isDone = false;
          if (!isSkipped) {
            let loggedCount = 0;
            for (let s = 1; s <= (exItem.setsCount || 1); s++) {
              if (sessionLoggedSets[`${exItem.id}_${s}`]?.logged) loggedCount++;
            }
            if (loggedCount > 0) isDone = true;
          }
          let icon = '';
          if (isSkipped) icon = ' ⏭';
          else if (isDone) icon = ' ✓';

          const shortName = shortPillLabels[exItem.id] || (`${idx + 1}. ` + String(exItem.name || '').split('(')[0].replace(/^Barbell\s+|^Heavy\s+Kettlebell\s+|^Kettlebell\s+/i, '').trim().slice(0, 14));
          const bg = isActive ? 'var(--primary)' : (isDone ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.05)');
          const col = isActive ? '#000' : (isDone ? '#10b981' : 'var(--text-secondary)');
          const bdr = isActive ? 'var(--primary)' : (isDone ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.12)');
          return `<button type="button" onclick="jumpToExercise(${idx})" title="${escapeHtml(exItem.name)}" style="flex-shrink:0; padding:4px 8px; font-size:10.5px; font-weight:800; border-radius:7px; border:1px solid ${bdr}; background:${bg}; color:${col}; cursor:pointer; white-space:nowrap;">${escapeHtml(shortName)}${icon}</button>`;
        }).join('');
      }

      if (!restTimerInterval) {
        restSecs = parseRestSeconds(ex.rest || '60s');
        updateRestDisplay();
      }

      document.getElementById('stepCounter').innerText = isPickOneMenu
        ? `Pick 1 • Option ${currentExIdx + 1}/${activeWorkoutPlan.length}`
        : `Exercise ${currentExIdx + 1} of ${activeWorkoutPlan.length}`;
      const exNameEl = document.getElementById('exName');
      if (exNameEl) {
        exNameEl.innerText = ex.name || 'Exercise';
        exNameEl.style.fontSize = isFlowOrCond ? '15px' : '';
      }
      const targetPillEl = document.querySelector('#trainViewPrescribed .ex-target-pill');
      if (targetPillEl) {
        targetPillEl.style.marginBottom = isFlowOrCond ? '4px' : '';
        targetPillEl.style.padding = isFlowOrCond ? '3px 8px' : '';
      }
      
      const familyNames = {
        hip_hinge: "Hip Hinge (Posterior)",
        horizontal_push: "Horizontal Push (Chest/Triceps)",
        squat: "Knee Dominant / Quad",
        pull: "Horizontal Pull (Back/Lats)",
        vertical_push: "Vertical Push (Delts/Core)",
        cardio: "Metabolic / Agility",
        core_carry: "Loaded Carry (Anti-Lateral Core)"
      };
      document.getElementById('movementFamilyTag').innerText = familyNames[ex.family] || "Functional";

      const wLabel = typeof ex.targetWeight === 'number' ? `${ex.targetWeight}kg` : ex.targetWeight;
      document.getElementById('exTarget').innerText = fmt.isTimed
        ? `Prescribed: ${fmt.label}`
        : `Prescribed: ${ex.setsCount} Sets × ${ex.targetReps} Reps @ ${wLabel}`;
      document.getElementById('exRestTarget').innerText = fmt.isTimed ? `Format: ${fmt.format.toUpperCase()}` : `Rest: ${ex.rest || '60s'}`;

      const cueEl = document.getElementById('exCue') || document.getElementById('exerciseCue');
      const whyEl = document.getElementById('exRationale') || document.getElementById('exerciseWhy');
      const actionRowEl = document.getElementById('exActionBtnsRow');
      const restBarEl = document.querySelector('#trainViewPrescribed .rest-bar-box');
      const whyText = ex.rationale || ex.why || 'Selected for target biomechanical recruitment.';
      const isKbGrindsMode = (currentArchetypeKey === 'option_kb' && typeof getKbSubMode === 'function' && getKbSubMode() === 'grinds');
      const kbQuickSwitchBanner = isKbGrindsMode ? `
<div style="margin-bottom:6px; padding:6px 9px; border-radius:8px; background:rgba(0,245,212,0.08); border:1px solid rgba(0,245,212,0.3); display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; font-size:11px; color:#cbd5e1;">
<span>Looking for a continuous KB Flow chain?</span>
<span style="display:inline-flex; gap:5px;">
<button type="button" onclick="setKbSubMode('flow_2h')" style="padding:3px 8px; font-size:10.5px; font-weight:800; border-radius:6px; border:1px solid var(--teal, #00f5d4); background:rgba(0,245,212,0.16); color:var(--teal, #00f5d4); cursor:pointer;">🌊 Switch to 2H Flow</button>
<button type="button" onclick="setKbSubMode('flow_1h')" style="padding:3px 8px; font-size:10.5px; font-weight:800; border-radius:6px; border:1px solid #38bdf8; background:rgba(56,189,248,0.16); color:#7dd3fc; cursor:pointer;">🔥 Switch to 1H Flow</button>
</span>
</div>
      ` : '';

      const swapBannerEl = document.getElementById('exJointSwapBanner');
      if (swapBannerEl) {
        const planBanner = (typeof window !== 'undefined') ? window._activePlanRestrictionBanner : null;
        const perExSwap = ex && ex.jointSwapInfo ? ex.jointSwapInfo : null;
        if ((planBanner && planBanner.message) || perExSwap) {
          const parts = [];
          if (planBanner && planBanner.message) {
            const switchBtn = (planBanner.type === 'flow_filtered')
              ? `<button type="button" onclick="setKbSubMode('grinds')" style="padding:3px 8px; font-size:10.5px; font-weight:800; border-radius:6px; border:1px solid rgba(0,229,255,0.4); background:rgba(0,229,255,0.14); color:#00e5ff; cursor:pointer; white-space:nowrap;">🏋️ Switch to Heavy Grinds</button>`
              : '';
            parts.push(`<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;"><span>${escapeHtml(planBanner.message)}</span>${switchBtn}</div>`);
          }
          if (perExSwap) {
            const domainText = (typeof _formatJointDomainList === 'function')
              ? _formatJointDomainList(perExSwap.domains)
              : (Array.isArray(perExSwap.domains) ? perExSwap.domains.join(' / ') : 'Joint');
            parts.push(`<div>🛡️ Adapted for ${escapeHtml(domainText)} restriction • Replaced ${escapeHtml(perExSwap.replacedName || perExSwap.replacedId)}</div>`);
          }
          swapBannerEl.innerHTML = parts.join('');
          swapBannerEl.style.display = 'block';
        } else {
          swapBannerEl.innerHTML = '';
          swapBannerEl.style.display = 'none';
        }
      }

      if (isFlowOrCond) {
        if (cueEl) cueEl.style.display = 'none';
        if (actionRowEl) actionRowEl.style.display = 'none';
        if (whyEl) whyEl.style.display = 'none';
        if (restBarEl) restBarEl.style.display = 'none';
      } else {
        if (cueEl) {
          cueEl.style.display = '';
          cueEl.innerText = `Cue: ${ex.cue}`;
        }
        if (actionRowEl) actionRowEl.style.display = 'flex';
        if (whyEl) {
          whyEl.style.display = '';
          whyEl.innerHTML = `${kbQuickSwitchBanner}<strong>Why Selected:</strong> ${escapeHtml(whyText)}`;
        }
        if (restBarEl) restBarEl.style.display = '';
      }
      document.getElementById('autoregBanner').classList.remove('active');

      const plateEl = document.getElementById('exPlateCalcRow');
      if (fmt.isTimed) {
        if (plateEl) {
          plateEl.style.display = 'none';
          plateEl.innerText = '';
        }
      } else {
        _updatePlateCalcForExercise(ex);
      }

      const setRowsContainer = document.getElementById('setRows');
      setRowsContainer.style.maxHeight = 'none';
      setRowsContainer.style.overflowY = 'visible';
      setRowsContainer.innerHTML = '';

      const wuToolbarEl = document.getElementById('setWarmupToolbar');
      if (fmt.isTimed) {
        if (wuToolbarEl) {
          wuToolbarEl.style.display = 'none';
          wuToolbarEl.innerHTML = '';
        }
        initInlineTimerForExercise(ex, fmt);
        renderInlineConditioningPlayer(ex, fmt);
        return;
      }

      const cleanWeightNumBase = typeof ex.targetWeight === 'number'
        ? ex.targetWeight
        : parseFloat(String(ex.targetWeight).replace(/^2\s*[×x]\s*/i, '').replace(/kg$/i, '')) || 0;
      const targetRepsNum = typeof ex.targetReps === 'number' ? ex.targetReps : 8;
      const escAttrFnTop = (typeof escapeAttr === 'function') ? escapeAttr : escapeHtml;

      const wuCount = _getWarmupCountForExercise(ex);
      if (wuToolbarEl) {
        wuToolbarEl.style.display = 'flex';
        wuToolbarEl.innerHTML = `
<span style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">${wuCount > 0 ? `${wuCount} Warm-up + ${ex.setsCount} Working` : `${ex.setsCount} Working Sets`}</span>
<button type="button" id="btnAddWarmupSet" onclick="addWarmupSetForCurrentExercise()" style="padding:4px 9px; border-radius:6px; border:1px solid rgba(245,158,11,0.45); background:rgba(245,158,11,0.12); color:#fbbf24; font-size:11px; font-weight:800; cursor:pointer;">+ Warm-up Set</button>
        `;
      }

      for (let wu = 1; wu <= wuCount; wu++) {
        const wuKey = `${ex.id}_wu${wu}`;
        const savedWu = sessionLoggedSets[wuKey];
        const isWuLogged = Boolean(savedWu && savedWu.logged);
        const wuDefaultW = _defaultWarmupWeightForExercise(ex, wu);
        const displayWuW = savedWu ? savedWu.weight : wuDefaultW;
        const displayWuR = savedWu ? savedWu.reps : 8;
        const wuWIsNum = (typeof displayWuW === 'number' && Number.isFinite(displayWuW)) || /^(\s*2\s*[×x]\s*)?\d+(?:\.\d+)?(\s*kg)?$/i.test(String(displayWuW ?? '').trim());
        const wuRow = document.createElement('div');
        wuRow.className = `set-log-row ${isWuLogged ? 'logged' : ''}`;
        wuRow.id = `setRow_${currentExIdx}_wu${wu}`;
        wuRow.style.borderColor = 'rgba(245,158,11,0.38)';
        wuRow.innerHTML = `
<span class="set-idx" style="color:#fbbf24;">🔥 WU ${wu}</span>
<div class="set-inputs">
<div class="set-input-group">
              ${wuWIsNum ? `<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, 'wu${wu}', 'weight', -2.5)" title="-2.5 kg">−</button>` : ''}
<input type="text" inputmode="decimal" class="set-input-box" value="${escapeHtml(displayWuW)}" id="wIn_${currentExIdx}_wu${wu}" oninput="_updatePlateCalcForExercise(activeWorkoutPlan[${currentExIdx}], this.value)">
              ${wuWIsNum ? `<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, 'wu${wu}', 'weight', 2.5)" title="+2.5 kg">+</button>` : ''}
<span style="font-size:12px;color:var(--text-muted);">${typeof wuDefaultW === 'number' ? 'kg' : ''} ×</span>
</div>
<div class="set-input-group">
<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, 'wu${wu}', 'reps', -1)" title="-1 rep">−</button>
<input type="number" inputmode="numeric" class="set-input-box" value="${escapeHtml(displayWuR)}" id="rIn_${currentExIdx}_wu${wu}">
<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, 'wu${wu}', 'reps', 1)" title="+1 rep">+</button>
<span style="font-size:12px;color:var(--text-muted);">reps</span>
</div>
</div>
<button type="button" class="btn-log-set ${isWuLogged ? 'done' : ''}" data-wu-num="${wu}" data-ex-id="${escAttrFnTop(ex.id)}" data-target-w="${cleanWeightNumBase}" data-target-r="${targetRepsNum}" onclick="logWarmupSet(this, Number(this.dataset.wuNum), this.dataset.exId, Number(this.dataset.targetW), Number(this.dataset.targetR))">${isWuLogged ? '✓ Logged' : '✓ Log WU'}</button>
        `;
        setRowsContainer.appendChild(wuRow);
      }

      for (let s = 1; s <= ex.setsCount; s++) {
        const row = document.createElement('div');
        const setKey = `${ex.id}_${s}`;
        const saved = sessionLoggedSets[setKey];
        const isLogged = saved && saved.logged;
        const isMissed = saved && saved.status === 'missed';
        
        row.className = `set-log-row ${isLogged ? (isMissed ? 'missed' : 'logged') : ''}`;
        row.id = `setRow_${currentExIdx}_${s}`;
        
        const cleanWeightNum = typeof ex.targetWeight === 'number'
          ? ex.targetWeight
          : parseFloat(String(ex.targetWeight).replace(/^2\s*[×x]\s*/i, '').replace(/kg$/i, '')) || 0;
        const displayW = saved ? saved.weight : ex.targetWeight;
        const displayR = saved ? saved.reps : (typeof ex.targetReps === 'number' ? ex.targetReps : 10);
        const weightIsNumeric = (typeof displayW === 'number' && Number.isFinite(displayW)) || /^(\s*2\s*[×x]\s*)?\d+(?:\.\d+)?(\s*kg)?$/i.test(String(displayW ?? '').trim());
        const repsIsNumeric = !isNaN(parseInt(String(displayR ?? ''), 10));
        const escAttrFn = (typeof escapeAttr === 'function') ? escapeAttr : escapeHtml;

        row.innerHTML = `
<span class="set-idx">Set ${s}</span>
<div class="set-inputs">
<div class="set-input-group">
              ${weightIsNumeric ? `<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, ${s}, 'weight', -2.5)" title="-2.5 kg">−</button>` : ''}
<input type="text" inputmode="decimal" class="set-input-box" value="${escapeHtml(displayW)}" id="wIn_${currentExIdx}_${s}" oninput="_updatePlateCalcForExercise(activeWorkoutPlan[${currentExIdx}], this.value)">
              ${weightIsNumeric ? `<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, ${s}, 'weight', 2.5)" title="+2.5 kg">+</button>` : ''}
<span style="font-size:12px;color:var(--text-muted);">${typeof ex.targetWeight === 'number' ? 'kg' : ''} ×</span>
</div>
<div class="set-input-group">
              ${repsIsNumeric ? `<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, ${s}, 'reps', -1)" title="-1 rep">−</button>` : ''}
<input type="number" inputmode="numeric" class="set-input-box" value="${escapeHtml(displayR)}" id="rIn_${currentExIdx}_${s}">
              ${repsIsNumeric ? `<button type="button" class="set-stepper-btn" onclick="stepSetInput(${currentExIdx}, ${s}, 'reps', 1)" title="+1 rep">+</button>` : ''}
<span style="font-size:12px;color:var(--text-muted);">reps</span>
</div>
</div>
<button type="button" class="btn-log-set ${isLogged ? 'done' : ''}" data-set-num="${s}" data-ex-id="${escAttrFn(ex.id)}" data-target-w="${cleanWeightNum}" data-target-r="${typeof ex.targetReps === 'number' ? ex.targetReps : 8}" onclick="logSet(this, Number(this.dataset.setNum), this.dataset.exId, Number(this.dataset.targetW), Number(this.dataset.targetR))">${isLogged ? '✓ Logged' : '✓ Log'}</button>
        `;
        setRowsContainer.appendChild(row);
      }
    }

    function jumpToExercise(idx) {
      if (idx >= 0 && idx < activeWorkoutPlan.length) {
        currentExIdx = idx;
        renderCurrentExercise();
        saveActiveSessionToLocalStorage();
        beep(500, 0.05);
      }
    }

    function skipCurrentExercise() {
      if (!Array.isArray(activeWorkoutPlan) || activeWorkoutPlan.length === 0 || !activeWorkoutPlan[currentExIdx]) return;
      activeWorkoutPlan[currentExIdx].skipped = true;
      showToast(`Skipped ${activeWorkoutPlan[currentExIdx].name || 'Exercise'}`);
      if (currentExIdx < activeWorkoutPlan.length - 1) {
        currentExIdx++;
      }
      renderCurrentExercise();
      saveActiveSessionToLocalStorage();
      beep(450, 0.06);
    }

    let swapContext = { mode: 'swap', optId: null, exIdx: null };
    let editLoadContext = { exId: null, optId: null, exIdx: null };

    function ensureWorkoutModalsInDom() {
      if (!document.getElementById('swapExerciseModal')) {
        const swapDiv = document.createElement('div');
        swapDiv.className = 'modal-overlay';
        swapDiv.id = 'swapExerciseModal';
        swapDiv.setAttribute('onclick', 'if(event.target === this) closeSwapModal()');
        swapDiv.innerHTML = `
<div class="modal-card" style="max-width:380px; max-height:85vh; display:flex; flex-direction:column;">
<div style="display:flex; justify-content:space-between; align-items:center;">
<div>
<strong style="font-size:13px; color:#fff;" id="swapModalTitle">⇄ Swap Exercise</strong>
<div style="font-size:11px; color:var(--text-muted);">Choose a replacement or add mid-workout</div>
</div>
<span style="cursor:pointer; color:var(--text-muted); font-size:16px; padding:2px 6px;" onclick="closeSwapModal()">✕</span>
</div>
<div style="margin-top:8px;">
<input id="swapSearchInput" type="text" placeholder="Search exercises (e.g. bench, press, row, rdl)..." oninput="renderSwapOptions()" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:12.5px; padding:6px 10px; border-radius:8px; outline:none; box-sizing:border-box;">
</div>
<div style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
<label style="display:flex; align-items:center; gap:5px; font-size:11px; color:var(--text-secondary); cursor:pointer;">
<input type="checkbox" id="rememberSwapCheckbox" style="accent-color:var(--primary); cursor:pointer;">
<span>Remember swap for future workouts</span>
</label>
<button type="button" id="hideExerciseBtn" onclick="hideCurrentExerciseFromModal()" style="background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; font-size:10.5px; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap;">🚫 Don't recommend current</button>
</div>
<div id="hiddenExercisesBar" style="font-size:10.5px; color:var(--text-muted); margin-top:6px;"></div>
<div id="swapOptionsList" style="display:flex; flex-direction:column; gap:8px; max-height:55vh; overflow-y:auto; margin-top:10px;"></div>
</div>
        `;
        document.body.appendChild(swapDiv);
      }

      if (!document.getElementById('editLoadModal')) {
        const editDiv = document.createElement('div');
        editDiv.className = 'modal-overlay';
        editDiv.id = 'editLoadModal';
        editDiv.setAttribute('onclick', 'if(event.target === this) closeEditLoadModal()');
        editDiv.innerHTML = `
<div class="modal-card" style="max-width:340px;">
<div style="display:flex; justify-content:space-between; align-items:center;">
<div>
<strong style="font-size:13px; color:#fff;" id="editLoadModalTitle">✎ Edit Target Weight & Reps</strong>
<div style="font-size:11px; color:var(--text-muted);" id="editLoadModalSub">Update prescribed load</div>
</div>
<span style="cursor:pointer; color:var(--text-muted); font-size:16px; padding:2px 6px;" onclick="closeEditLoadModal()">✕</span>
</div>
<div id="editLoadExName" style="font-size:13px; font-weight:700; color:#fff; margin-top:8px; margin-bottom:10px; padding:6px 8px; background:rgba(255,255,255,0.04); border-radius:6px; border-left:3px solid var(--primary);"></div>
<div style="display:flex; flex-direction:column; gap:8px;">
<div>
<label style="font-size:11px; color:var(--cyan); display:block; margin-bottom:2px; font-weight:700;">Target Weight (kg or text, e.g. 70, Body, 24kg):</label>
<input type="text" id="editLoadWeight" placeholder="70" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:14px; font-weight:700; padding:6px 8px; border-radius:6px; outline:none; box-sizing:border-box;">
</div>
<div>
<label style="font-size:11px; color:var(--lime); display:block; margin-bottom:2px; font-weight:700;">Target Reps per Set:</label>
<input type="text" id="editLoadReps" placeholder="8" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:14px; font-weight:700; padding:6px 8px; border-radius:6px; outline:none; box-sizing:border-box;">
</div>
<div style="display:flex; gap:6px; margin-top:4px;">
<button type="button" class="btn-action-ghost" style="flex:1; margin:0;" onclick="closeEditLoadModal()">Cancel</button>
<button type="button" class="btn-action-primary" style="flex:2; margin:0;" onclick="saveEditLoadModal()">✓ Save Prescribed Load</button>
</div>
</div>
</div>
        `;
        document.body.appendChild(editDiv);
      }
    }

    function openSwapModal(mode, optId, exIdx) {
      ensureWorkoutModalsInDom();
      swapModalMode = mode || 'swap';
      
      let origExId = null;
      let origExName = '';
      if (swapModalMode === 'today' && optId !== undefined && optId !== null && exIdx !== undefined && exIdx !== null) {
        const swaps = getTodayExerciseSwaps();
        const opt = todayWorkoutOptions.find(o => o.id === optId);
        const arch = dailyArchetypes[optId];
        if (opt) {
          const rotatedInfo = (typeof getRotatedExercisesForOption === 'function') ? getRotatedExercisesForOption(opt) : { exerciseIds: opt.exerciseIds };
          const activeIds = rotatedInfo.exerciseIds || opt.exerciseIds;
          origExId = swaps[`${optId}_${exIdx}`] || activeIds[exIdx];
        } else if (arch && arch.exercises) {
          origExId = swaps[`${optId}_${exIdx}`] || arch.exercises[exIdx]?.id;
        }
      } else {
        const cur = activeWorkoutPlan[exIdx !== undefined ? exIdx : currentExIdx];
        if (cur) origExId = cur.id;
      }

      if (origExId) {
        const found = getAllExercises().find(e => e.id === origExId);
        origExName = found ? found.name : origExId;
      }

      swapContext = {
        mode: swapModalMode,
        optId: optId !== undefined ? optId : null,
        exIdx: exIdx !== undefined ? exIdx : currentExIdx,
        origExId: origExId
      };

      const modal = document.getElementById('swapExerciseModal');
      if (modal) {
        modal.classList.add('open');
        const titleEl = document.getElementById('swapModalTitle');
        if (titleEl) {
          if (swapContext.mode === 'today') titleEl.innerText = '⇄ Swap Exercise for Today';
          else if (swapContext.mode === 'swap') titleEl.innerText = '⇄ Swap Exercise';
          else titleEl.innerText = '+ Add Exercise';
        }

        const rememberCb = document.getElementById('rememberSwapCheckbox');
        if (rememberCb) {
          const permSwaps = getPermanentSwaps();
          rememberCb.checked = !!(origExId && permSwaps[origExId]);
        }

        const hideBtn = document.getElementById('hideExerciseBtn');
        if (hideBtn) {
          if (origExName) {
            hideBtn.innerText = `🚫 Don't recommend ${origExName}`;
            hideBtn.style.display = 'inline-block';
          } else {
            hideBtn.innerText = `🚫 Don't recommend current`;
          }
        }

        const hiddenBar = document.getElementById('hiddenExercisesBar');
        if (hiddenBar) {
          const hidden = getHiddenExercises();
          if (hidden.length > 0) {
            const hiddenNames = hidden.map(hId => {
              const ex = getAllExercises().find(e => e.id === hId);
              return escapeHtml(ex ? ex.name : hId);
            }).join(', ');
            hiddenBar.innerHTML = `Hidden (${hidden.length}): ${hiddenNames} • <a href="javascript:void(0)" onclick="unhideAllExercises()" style="color:var(--primary); text-decoration:underline;">Reset hidden</a>`;
          } else {
            hiddenBar.innerHTML = '';
          }
        }

        const search = document.getElementById('swapSearchInput');
        if (search) { search.value = ''; setTimeout(() => search.focus(), 50); }
        renderSwapOptions();
      }
      beep(700, 0.05);
    }

    function closeSwapModal() {
      const modal = document.getElementById('swapExerciseModal');
      if (modal) modal.classList.remove('open');
      beep(600, 0.04);
    }

    function updateCustomSwapRationalePreview() {
      const searchEl = document.getElementById('swapSearchInput');
      const query = (searchEl ? searchEl.value : '').trim();
      const familyEl = document.getElementById('customSwapFamily');
      const family = familyEl ? familyEl.value : 'horizontal_push';
      const previewEl = document.getElementById('customSwapRationalePreview');
      if (previewEl) {
        previewEl.innerText = generateAutoRationale(query || 'Custom Exercise', family);
      }
    }

    function createAndSwapCustomExercise() {
      const searchEl = document.getElementById('swapSearchInput');
      const query = (searchEl ? searchEl.value : '').trim();
      if (!query) {
        showToast('Please type an exercise name');
        return;
      }
      const familyEl = document.getElementById('customSwapFamily');
      const family = familyEl ? familyEl.value : 'horizontal_push';

      const weightEl = document.getElementById('customSwapWeight');
      const rawWeight = weightEl ? weightEl.value.trim() : 'Body';
      const parsedNumWeight = parseFloat(rawWeight);
      const weight = (!isNaN(parsedNumWeight) && isFinite(rawWeight)) ? parsedNumWeight : (rawWeight || 'Body');

      const repsEl = document.getElementById('customSwapReps');
      const rawReps = repsEl ? repsEl.value.trim() : '12';
      const parsedNumReps = parseInt(rawReps, 10);
      const reps = (!isNaN(parsedNumReps) && String(parsedNumReps) === rawReps) ? parsedNumReps : rawReps;

      const restEl = document.getElementById('customSwapRest');
      const rest = restEl ? restEl.value : '60s';

      const customId = `custom_${Date.now()}`;
      const cue = generateAutoCue(query, family);
      const rationale = generateAutoRationale(query, family);

      const customEx = createCustomExerciseObj(customId, query, family, weight, reps, rest, cue, rationale);
      saveCustomExercise(customEx);
      selectSwapExercise(customId);
    }

    function hideCurrentExerciseFromModal() {
      const origExId = swapContext.origExId;
      if (!origExId) {
        showToast('No exercise selected to hide');
        return;
      }
      addHiddenExercise(origExId);
      const found = getAllExercises().find(e => e.id === origExId);
      const exName = found ? found.name : origExId;
      showToast(`Hidden "${exName}" from recommendations`);

      const hiddenBar = document.getElementById('hiddenExercisesBar');
      if (hiddenBar) {
        const hidden = getHiddenExercises();
        const hiddenNames = hidden.map(hId => {
          const ex = getAllExercises().find(e => e.id === hId);
          return escapeHtml(ex ? ex.name : hId);
        }).join(', ');
        hiddenBar.innerHTML = `Hidden (${hidden.length}): ${hiddenNames} • <a href="javascript:void(0)" onclick="unhideAllExercises()" style="color:var(--primary); text-decoration:underline;">Reset hidden</a>`;
      }

      // Try auto-swapping to a non-hidden exercise of same family if in swap/today mode
      const all = getAllExercises();
      const currentFam = found ? found.family : null;
      const hidden = getHiddenExercises();
      const replacement = all.find(e => e.family === currentFam && !hidden.includes(e.id) && e.id !== origExId);

      if (replacement) {
        selectSwapExercise(replacement.id);
      } else {
        renderSwapOptions();
      }
    }

    function renderSwapOptions() {
      ensureWorkoutModalsInDom();
      const container = document.getElementById('swapOptionsList');
      if (!container) return;
      const searchEl = document.getElementById('swapSearchInput');
      const query = (searchEl ? searchEl.value : '').toLowerCase().trim();

      let currentFamily = '';
      if (swapContext.mode === 'today' && swapContext.optId !== null && swapContext.exIdx !== null) {
        const swaps = getTodayExerciseSwaps();
        const opt = todayWorkoutOptions.find(o => o.id === swapContext.optId);
        const arch = dailyArchetypes[swapContext.optId];
        let exId = null;
        if (opt) {
          const rotatedInfo = (typeof getRotatedExercisesForOption === 'function') ? getRotatedExercisesForOption(opt) : { exerciseIds: opt.exerciseIds };
          const activeIds = rotatedInfo.exerciseIds || opt.exerciseIds;
          exId = swaps[`${swapContext.optId}_${swapContext.exIdx}`] || activeIds[swapContext.exIdx];
        } else if (arch && arch.exercises) {
          exId = swaps[`${swapContext.optId}_${swapContext.exIdx}`] || arch.exercises[swapContext.exIdx]?.id;
        }
        if (exId) {
          const matchEx = getAllExercises().find(e => e.id === exId);
          if (matchEx) currentFamily = matchEx.family || '';
        }
      } else {
        const currentEx = activeWorkoutPlan[swapContext.exIdx !== undefined ? swapContext.exIdx : currentExIdx] || {};
        currentFamily = currentEx.family || '';
      }

      const all = getAllExercises();
      let matches = all.filter(e => {
        if (!query) return true;
        return (e.name && e.name.toLowerCase().includes(query)) ||
               (e.family && e.family.toLowerCase().includes(query)) ||
               (e.id && e.id.toLowerCase().includes(query));
      });

      // Same pattern first
      matches.sort((a, b) => {
        const aSame = (currentFamily && a.family === currentFamily) ? 1 : 0;
        const bSame = (currentFamily && b.family === currentFamily) ? 1 : 0;
        return bSame - aSame;
      });

      let itemsHtml = '';
      if (matches.length === 0) {
        itemsHtml = '<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:12px;">No matching exercises found.</div>';
      } else {
        itemsHtml = matches.map(ex => {
          const isSamePattern = currentFamily && ex.family === currentFamily;
          const rx = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad(ex.id, ex) : { weight: (typeof ex.getBaseWeight === 'function' ? ex.getBaseWeight() : 'Body'), reps: (typeof ex.getBaseReps === 'function' ? ex.getBaseReps() : 8) };
          const targetW = rx.weight;
          const targetR = rx.reps;
          const wStr = typeof targetW === 'number' ? `${targetW}kg` : targetW;

          return `
<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--surface-card, #14161e); border:1px solid rgba(255,255,255,0.06); border-radius:8px; gap:8px;">
<div style="flex:1; min-width:0;">
<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
<span style="font-size:12.5px; font-weight:700; color:#fff;">${escapeHtml(ex.name)}</span>
                  ${isSamePattern ? '<span style="background:rgba(0,240,255,0.14); border:1px solid rgba(0,240,255,0.3); color:var(--primary); font-size:9.5px; font-weight:800; padding:1px 5px; border-radius:4px; letter-spacing:0.04em;">SAME PATTERN</span>' : ''}
</div>
<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                  ${Number(ex.setsCount) || 3} sets × ${escapeHtml(targetR)} reps @ ${escapeHtml(wStr)} • Rest: ${escapeHtml(ex.rest || '60s')}
</div>
</div>
<button type="button" class="btn-action-primary" style="height:32px; font-size:11px; font-weight:700; padding:0 12px; white-space:nowrap;" data-ex-id="${escapeHtml(ex.id)}" onclick="selectSwapExercise(this.dataset.exId)">
                ${swapContext.mode === 'add' ? 'Add +' : 'Swap ⇄'}
</button>
</div>
          `;
        }).join('');
      }

      // Check if query is non-empty and does not match any existing exercise name
      const hasExactMatch = all.some(e => e.name && e.name.toLowerCase() === query);
      let createCardHtml = '';
      if (query && !hasExactMatch) {
        const rawSearchInput = document.getElementById('swapSearchInput');
        const rawQueryText = rawSearchInput ? rawSearchInput.value.trim() : query;
        const defaultFam = currentFamily || 'horizontal_push';
        const initialRationale = generateAutoRationale(rawQueryText, defaultFam);

        createCardHtml = `
<div style="margin-top:10px; padding:12px; background:rgba(0,240,255,0.04); border:1px dashed rgba(0,240,255,0.35); border-radius:8px;">
<div style="font-size:12px; font-weight:800; color:var(--primary); margin-bottom:8px;">
              + Create & Swap "${escapeHtml(rawQueryText)}"
</div>
<div style="display:flex; flex-direction:column; gap:8px;">
<div>
<label style="font-size:10.5px; color:var(--text-muted); display:block; margin-bottom:2px;">Movement Family:</label>
<select id="customSwapFamily" onchange="updateCustomSwapRationalePreview()" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:11.5px; padding:5px 8px; border-radius:6px; outline:none; box-sizing:border-box;">
<option value="horizontal_push" ${defaultFam === 'horizontal_push' ? 'selected' : ''}>Horizontal Push (Chest/Triceps)</option>
<option value="hip_hinge" ${defaultFam === 'hip_hinge' ? 'selected' : ''}>Hip Hinge (Posterior Chain)</option>
<option value="squat" ${defaultFam === 'squat' ? 'selected' : ''}>Knee Dominant / Squat</option>
<option value="pull" ${defaultFam === 'pull' ? 'selected' : ''}>Horizontal Pull (Back/Lats)</option>
<option value="vertical_push" ${defaultFam === 'vertical_push' ? 'selected' : ''}>Vertical Push (Delts/Core)</option>
<option value="cardio" ${defaultFam === 'cardio' ? 'selected' : ''}>Cardio / Conditioning</option>
<option value="core_carry" ${defaultFam === 'core_carry' ? 'selected' : ''}>Core / Loaded Carry</option>
<option value="functional" ${defaultFam === 'functional' ? 'selected' : ''}>Functional / Multi-Planar</option>
</select>
</div>
<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">
<div>
<label style="font-size:10px; color:var(--text-muted); display:block; margin-bottom:2px;">Weight:</label>
<input id="customSwapWeight" type="text" value="Body" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:11.5px; padding:4px 6px; border-radius:6px; outline:none; box-sizing:border-box;">
</div>
<div>
<label style="font-size:10px; color:var(--text-muted); display:block; margin-bottom:2px;">Reps:</label>
<input id="customSwapReps" type="number" value="12" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:11.5px; padding:4px 6px; border-radius:6px; outline:none; box-sizing:border-box;">
</div>
<div>
<label style="font-size:10px; color:var(--text-muted); display:block; margin-bottom:2px;">Rest:</label>
<select id="customSwapRest" style="width:100%; background:var(--surface-elevated); border:1px solid var(--border); color:#fff; font-size:11.5px; padding:4px 4px; border-radius:6px; outline:none; box-sizing:border-box;">
<option value="45s">45s</option>
<option value="60s" selected>60s</option>
<option value="75s">75s</option>
<option value="90s">90s</option>
</select>
</div>
</div>
<div id="customSwapRationalePreview" style="font-size:10.5px; color:#cbd5e1; font-style:italic; padding:6px; background:rgba(255,255,255,0.03); border-radius:6px; line-height:1.35;">
                ${escapeHtml(initialRationale)}
</div>
<button type="button" class="btn-action-primary" style="height:32px; font-size:11.5px; font-weight:800; margin-top:2px;" onclick="createAndSwapCustomExercise()">
                ${swapContext.mode === 'add' ? 'Create & Add +' : 'Create & Swap ⇄'}
</button>
</div>
</div>
        `;
      }

      container.innerHTML = itemsHtml + createCardHtml;
    }

    function selectSwapExercise(exId) {
      const ex = getAllExercises().find(e => e.id === exId) || { id: exId, name: exId, family: "functional", setsCount: 3, rest: "60s" };
      const rx = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad(exId, ex) : { weight: (typeof ex.getBaseWeight === 'function' ? ex.getBaseWeight() : 'Body'), reps: (typeof ex.getBaseReps === 'function' ? ex.getBaseReps() : 8) };
      const targetW = rx.weight;
      const targetR = rx.reps;

      // Handle rememberSwapCheckbox permanent swap preference
      const rememberCb = document.getElementById('rememberSwapCheckbox');
      const origExId = swapContext.origExId;
      if (origExId) {
        if (rememberCb && rememberCb.checked) {
          savePermanentSwap(origExId, exId);
        } else {
          const permSwaps = getPermanentSwaps();
          if (permSwaps[origExId]) {
            removePermanentSwap(origExId);
          }
        }
      }

      const newExItem = {
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

      if (swapContext.mode === 'today') {
        if (swapContext.optId !== null && swapContext.exIdx !== null) {
          setTodayExerciseSwap(swapContext.optId, swapContext.exIdx, exId);
        }
        closeSwapModal();
        showToast(`Swapped to ${ex.name} for Today!`);
        renderTodayTrainingRecommendations();
        beep(750, 0.08);
      } else if (swapContext.mode === 'swap') {
        activeWorkoutPlan[swapContext.exIdx !== undefined ? swapContext.exIdx : currentExIdx] = newExItem;
        closeSwapModal();
        showToast(`Swapped to ${ex.name}`);
        renderCurrentExercise();
        saveActiveSessionToLocalStorage();
        beep(750, 0.08);
      } else {
        activeWorkoutPlan.push(newExItem);
        closeSwapModal();
        showToast(`Added ${ex.name} to routine`);
        renderCurrentExercise();
        saveActiveSessionToLocalStorage();
        beep(750, 0.08);
      }
    }

    function addCustomExerciseMidWorkout() {
      const nameInput = document.getElementById('customExName');
      const setsInput = document.getElementById('customExSets');
      const repsInput = document.getElementById('customExReps');
      const weightInput = document.getElementById('customExWeight');

      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        showToast('Please enter an exercise name');
        return;
      }
      const sets = setsInput ? parseInt(setsInput.value, 10) || 3 : 3;
      const reps = repsInput ? (parseInt(repsInput.value, 10) || repsInput.value || 8) : 8;
      const weightRaw = weightInput ? weightInput.value.trim() : 'Body';
      const weight = !isNaN(parseFloat(weightRaw)) && isFinite(weightRaw) ? parseFloat(weightRaw) : (weightRaw || 'Body');

      const customId = `custom_${Date.now()}`;
      const newExItem = {
        id: customId,
        name: name,
        family: "functional",
        targetWeight: weight,
        targetReps: reps,
        setsCount: sets,
        rest: "60s",
        cue: "Focus on strict form and controlled cadence.",
        rationale: "Custom athlete entry added mid-workout."
      };

      if (typeof swapModalMode !== 'undefined' && swapModalMode === 'swap' && activeWorkoutPlan[currentExIdx]) {
        activeWorkoutPlan[currentExIdx] = newExItem;
        showToast(`Swapped to ${name}`);
      } else {
        activeWorkoutPlan.push(newExItem);
        showToast(`Added ${name} to session`);
      }

      if (nameInput) nameInput.value = '';
      closeSwapModal();
      renderCurrentExercise();
      saveActiveSessionToLocalStorage();
      beep(750, 0.08);
    }

    function openEditLoadModal(exId, optId, exIdx) {
      ensureWorkoutModalsInDom();
      editLoadContext = {
        exId: exId,
        optId: optId || null,
        exIdx: exIdx !== undefined ? exIdx : currentExIdx
      };

      const modal = document.getElementById('editLoadModal');
      if (!modal) return;

      const ex = getAllExercises().find(e => e.id === exId) || { id: exId, name: exId };
      const rx = (typeof getPrescribedLoad === 'function') ? getPrescribedLoad(exId, ex) : { weight: 70, reps: 8 };

      const nameEl = document.getElementById('editLoadExName');
      if (nameEl) nameEl.innerText = `${ex.name}`;

      const titleEl = document.getElementById('editLoadModalTitle');
      if (titleEl) titleEl.innerText = `Edit Prescribed Load: ${ex.name}`;

      const subEl = document.getElementById('editLoadModalSub');
      if (subEl) subEl.innerText = `Update load for ${ex.name}`;

      const weightIn = document.getElementById('editLoadWeight') || document.getElementById('editLoadWeightInput');
      const repsIn = document.getElementById('editLoadReps') || document.getElementById('editLoadRepsInput');

      if (weightIn) weightIn.value = (rx.weight !== undefined && rx.weight !== null) ? rx.weight : 70;
      if (repsIn) repsIn.value = rx.reps || 8;

      modal.classList.add('open');
      if (weightIn) setTimeout(() => weightIn.focus(), 50);
      beep(700, 0.05);
    }

    function openEditLoadModalForActive() {
      if (activeWorkoutPlan.length === 0 || !activeWorkoutPlan[currentExIdx]) return;
      const ex = activeWorkoutPlan[currentExIdx];
      openEditLoadModal(ex.id, null, currentExIdx);
    }

    function closeEditLoadModal() {
      const modal = document.getElementById('editLoadModal');
      if (modal) modal.classList.remove('open');
      beep(600, 0.04);
    }

    function saveEditLoadModal() {
      const exId = editLoadContext.exId || (activeWorkoutPlan[currentExIdx] ? activeWorkoutPlan[currentExIdx].id : null);
      if (!exId) {
        closeEditLoadModal();
        return;
      }
      const ex = getAllExercises().find(e => e.id === exId) || { id: exId, name: exId };

      const weightIn = document.getElementById('editLoadWeight') || document.getElementById('editLoadWeightInput');
      const repsIn = document.getElementById('editLoadReps') || document.getElementById('editLoadRepsInput');

      const rawWeight = weightIn ? weightIn.value.trim() : '';
      const parsedNumWeight = parseFloat(rawWeight);
      const targetWeight = (!isNaN(parsedNumWeight) && isFinite(rawWeight)) ? parsedNumWeight : (rawWeight || 'Body');

      const rawReps = repsIn ? repsIn.value.trim() : '8';
      const parsedNumReps = parseInt(rawReps, 10);
      const targetReps = (!isNaN(parsedNumReps) && String(parsedNumReps) === rawReps) ? parsedNumReps : rawReps;

      // 1. Persist to localStorage 'pulse_strength_prescriptions'
      const nowIso = new Date().toISOString();
      try {
        let rxMap = {};
        const raw = localStorage.getItem('pulse_strength_prescriptions');
        if (raw) rxMap = JSON.parse(raw) || {};
        if (!rxMap[exId]) rxMap[exId] = {};
        rxMap[exId].weight = targetWeight;
        rxMap[exId].reps = targetReps;
        rxMap[exId].updated_at = nowIso;
        rxMap[exId].last_updated = nowIso;
        localStorage.setItem('pulse_strength_prescriptions', JSON.stringify(rxMap));
      } catch(e) {
        console.warn('Could not persist prescription override:', e);
      }

      // 2. Persist to window.BAKED_LIVE_STATE.strength_prescriptions
      window.BAKED_LIVE_STATE = window.BAKED_LIVE_STATE || {};
      window.BAKED_LIVE_STATE.strength_prescriptions = window.BAKED_LIVE_STATE.strength_prescriptions || {};
      window.BAKED_LIVE_STATE.strength_prescriptions[exId] = window.BAKED_LIVE_STATE.strength_prescriptions[exId] || {};
      window.BAKED_LIVE_STATE.strength_prescriptions[exId].weight = targetWeight;
      window.BAKED_LIVE_STATE.strength_prescriptions[exId].reps = targetReps;
      window.BAKED_LIVE_STATE.strength_prescriptions[exId].updated_at = nowIso;
      window.BAKED_LIVE_STATE.strength_prescriptions[exId].last_updated = nowIso;

      // 3. Update active workout plan if editing active exercise
      if (activeWorkoutPlan && activeWorkoutPlan[currentExIdx] && activeWorkoutPlan[currentExIdx].id === exId) {
        activeWorkoutPlan[currentExIdx].targetWeight = targetWeight;
        activeWorkoutPlan[currentExIdx].targetReps = targetReps;
        saveActiveSessionToLocalStorage();
        renderCurrentExercise();
      }

      // 4. Fire POST to /api/prescription/override via pulseApiFetch + offline queue
      const apiBase = (typeof API_BASE !== 'undefined' ? API_BASE : '');
      const rxPayload = { exercise_id: exId, weight: targetWeight, reps: targetReps };
      (async () => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite(`${apiBase}/api/prescription/override`, rxPayload, 'POST');
          return;
        }
        try {
          const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)(`${apiBase}/api/prescription/override`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rxPayload),
            timeoutMs: 4000
          });
          if (!res || !res.ok) {
            const shouldQueue = (typeof _shouldQueueOfflineResponse === 'function')
              ? _shouldQueueOfflineResponse(res)
              : (!res || res.status >= 500 || res.status === 0);
            if (shouldQueue && typeof enqueueOfflineWrite === 'function') {
              enqueueOfflineWrite(`${apiBase}/api/prescription/override`, rxPayload, 'POST');
            }
          }
        } catch(e) {
          if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite(`${apiBase}/api/prescription/override`, rxPayload, 'POST');
        }
      })();

      closeEditLoadModal();
      renderTodayTrainingRecommendations();
      renderCurrentExercise();
      const wDisplay = typeof targetWeight === 'number' ? `${targetWeight}kg` : targetWeight;
      showToast(`✓ Updated ${ex.name}: ${wDisplay} × ${targetReps}`);
      beep(880, 0.1);
    }


    function prevExercise() {
      if (currentExIdx > 0) {
        currentExIdx--;
        renderCurrentExercise();
        saveActiveSessionToLocalStorage();
        beep(500, 0.05);
      }
    }

    function nextExercise() {
      if (currentExIdx < activeWorkoutPlan.length - 1) {
        currentExIdx++;
        renderCurrentExercise();
        saveActiveSessionToLocalStorage();
        beep(500, 0.05);
      }
    }

    function calcE1RM(w, r) {
      if (isNaN(w) || isNaN(r) || r <= 0) return 0;
      return Math.round(w * (1 + (r / 30)) * 10) / 10;
    }


    function _coerceSetWeightNumber(rawVal) {
      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) return rawVal;
      const cleaned = String(rawVal ?? '')
        .toLowerCase()
        .replace(/^2\s*[×x]\s*/i, '')
        .replace(/body(?:weight)?|bw/g, '0')
        .replace(/kg/g, '')
        .trim();
      const num = parseFloat(cleaned);
      return Number.isFinite(num) ? num : NaN;
    }

    function logSet(btn, setNum, exId, targetW, targetR) {
      const row = btn.closest('.set-log-row');
      const activeExObj = (typeof activeWorkoutPlan !== 'undefined' && Array.isArray(activeWorkoutPlan) && activeWorkoutPlan[currentExIdx])
        || (typeof getAllExercises === 'function' ? getAllExercises().find(e => e.id === exId) : null);

      const parsedTargetW = _coerceSetWeightNumber(targetW);
      const numTargetW = (!isNaN(parsedTargetW) && parsedTargetW >= 0) ? parsedTargetW : 0;

      const rawW = document.getElementById(`wIn_${currentExIdx}_${setNum}`).value;
      const parsedW = _coerceSetWeightNumber(rawW);
      const loggedW = (!isNaN(parsedW) && parsedW >= 0) ? parsedW : numTargetW;

      const rawR = document.getElementById(`rIn_${currentExIdx}_${setNum}`).value;
      const parsedR = parseInt(rawR, 10);
      const loggedR = (!isNaN(parsedR) && parsedR >= 0) ? parsedR : (typeof targetR === 'number' ? targetR : 10);

      btn.classList.add('done');
      btn.innerText = 'Logged';

      const isBodyweight = (loggedW === 0) || !numTargetW || numTargetW <= 0 || /^(body|bw)/i.test(String(activeExObj?.targetWeight || ''));
      const belowWarmupThreshold = (numTargetW > 0) && !isBodyweight && (loggedW > 0) && (loggedW < 0.75 * numTargetW);
      const priorSameWeightKeys = [];
      if (belowWarmupThreshold && typeof sessionLoggedSets === 'object' && sessionLoggedSets) {
        Object.keys(sessionLoggedSets).forEach((k) => {
          const prev = sessionLoggedSets[k];
          if (!prev || !prev.logged || prev.explicit_warmup || prev.exercise_id !== exId || Number(prev.set_num) === Number(setNum)) return;
          const prevW = _coerceSetWeightNumber(prev.weight);
          if (!isNaN(prevW) && Math.abs(prevW - loggedW) <= 0.5) {
            priorSameWeightKeys.push(k);
          }
        });
      }
      const isWarmup = belowWarmupThreshold && priorSameWeightKeys.length === 0;

      const banner = document.getElementById('autoregBanner');
      const tag = document.getElementById('autoregTag');
      const msg = document.getElementById('autoregMessage');
      const metric = document.getElementById('e1rmMetric');
      const transfer = document.getElementById('transferMessage');

      if (isWarmup) {
        const warmupE1RM = calcE1RM(loggedW, loggedR);
        row.classList.remove('missed');
        row.classList.add('logged');
        banner.classList.add('active');
        metric.innerText = `Warmup: ${loggedW}kg × ${loggedR} (e1RM ${warmupE1RM}kg)`;
        tag.innerText = '🔥 WARMUP SET RECORDED';
        tag.style.color = 'var(--amber)';
        msg.innerText = `Warmup logged (${loggedW}kg vs ${numTargetW}kg working target). Excluded from PR ceilings and double-progression.`;
        transfer.innerText = `➔ Tissue Readiness: Progressive ramp prepares joints and CNS for working sets.`;

        sessionLoggedSets[`${exId}_${setNum}`] = {
          exercise_id: exId,
          set_num: setNum,
          weight: loggedW,
          reps: loggedR,
          target_w: numTargetW,
          target_r: targetR,
          logged: true,
          is_warmup: true,
          status: 'warmup',
          e1rm: warmupE1RM,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        saveActiveSessionToLocalStorage();
        Promise.resolve(syncSetToBackend(exId, numTargetW, targetR, loggedW, loggedR)).catch(() => {});
        beep(640, 0.08);
        const totalSetsCount = (activeExObj && activeExObj.setsCount) || 3;
        const nextEx = (typeof activeWorkoutPlan !== 'undefined' && Array.isArray(activeWorkoutPlan)) ? activeWorkoutPlan[currentExIdx + 1] : null;
        const nextCue = setNum >= totalSetsCount ? (nextEx ? `Next: ${nextEx.name}` : 'Finish Session') : `Set ${setNum + 1}`;
        startRestCountdown(Math.min(60, parseRestSeconds(activeExObj && activeExObj.rest)), nextCue);
        return;
      }

      const targetE1RM = isBodyweight ? targetR : calcE1RM(numTargetW, targetR);
      const achievedE1RM = isBodyweight ? loggedR : calcE1RM(loggedW, loggedR);
      const diffR = loggedR - targetR;
      const pctDiff = targetE1RM > 0 ? Math.round(((achievedE1RM - targetE1RM) / targetE1RM) * 100) : 0;

      banner.classList.add('active');
      metric.innerText = isBodyweight
        ? `Output: ${loggedR} reps (${diffR >= 0 ? '+' : ''}${diffR})`
        : `e1RM: ${achievedE1RM}kg (${pctDiff >= 0 ? '+' : ''}${pctDiff}%)`;

      _renderPrBadgeSlot(false);
      let existingRxForPr = {};
      try {
        const rawRxPr = localStorage.getItem('pulse_strength_prescriptions');
        if (rawRxPr) existingRxForPr = (JSON.parse(rawRxPr) || {})[exId] || {};
      } catch (e) {}
      if (!isBodyweight && loggedW > 0 && loggedR > 0 && loggedW <= 500) {
        const sumPr = Number(window.PULSE_ANALYTICS_SUMMARY?.strength_prs?.[exId]?.e1rm) || 0;
        const bakedPr = Number(window.BAKED_LIVE_STATE?.strength_prescriptions?.[exId]?.e1rm) || 0;
        const lastE1rm = Number(existingRxForPr.e1rm || existingRxForPr.last_e1rm || 0) || 0;
        const priorBest = Math.max(sumPr, bakedPr, lastE1rm);
        if (priorBest > 0 && achievedE1RM > priorBest) {
          if (window.PULSE_ANALYTICS_SUMMARY && window.PULSE_ANALYTICS_SUMMARY.strength_prs) {
            window.PULSE_ANALYTICS_SUMMARY.strength_prs[exId] = {
              e1rm: achievedE1RM,
              weight: loggedW,
              reps: loggedR
            };
          }
          _renderPrBadgeSlot(true, achievedE1RM);
        }
      }

      if (belowWarmupThreshold && priorSameWeightKeys.length > 0) {
        priorSameWeightKeys.forEach((k) => {
          const prev = sessionLoggedSets[k];
          if (prev && prev.is_warmup) {
            prev.is_warmup = false;
            const prevR = Number(prev.reps || 0);
            prev.status = (prevR < targetR || prevR === 0) ? 'missed' : 'logged';
          }
        });
      }

      sessionLoggedSets[`${exId}_${setNum}`] = {
        exercise_id: exId,
        set_num: setNum,
        weight: loggedW,
        reps: loggedR,
        target_w: numTargetW,
        target_r: targetR,
        logged: true,
        status: (diffR < 0 || loggedR === 0 ? 'missed' : 'logged'),
        e1rm: achievedE1RM,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      saveActiveSessionToLocalStorage();
      window._pulsePrReqSeq = (window._pulsePrReqSeq || 0) + 1;
      const myReqSeq = window._pulsePrReqSeq;
      const syncOpts = belowWarmupThreshold ? { isWarmup: false } : undefined;
      Promise.resolve(syncSetToBackend(exId, numTargetW, targetR, loggedW, loggedR, syncOpts)).then((res) => {
        if (myReqSeq !== window._pulsePrReqSeq) return;
        if (!res || !res.ok || !res.result) return;
        if (res.result.status === 'warmup') return;
        const activeEx = (typeof activeWorkoutPlan !== 'undefined' && Array.isArray(activeWorkoutPlan))
          ? activeWorkoutPlan[currentExIdx]
          : null;
        if (!activeEx || activeEx.id !== exId) return;
        _renderPrBadgeSlot(Boolean(res.result.is_pr), res.result.e1rm || achievedE1RM);
        try {
          const rawRx = localStorage.getItem('pulse_strength_prescriptions');
          const rxMap = rawRx ? (JSON.parse(rawRx) || {}) : {};
          const mergedRx = {
            ...(rxMap[exId] || {}),
            ...(res.result.prescription || {}),
            e1rm: res.result.e1rm || achievedE1RM,
            last_updated: new Date().toISOString()
          };
          rxMap[exId] = mergedRx;
          localStorage.setItem('pulse_strength_prescriptions', JSON.stringify(rxMap));
          if (!window.BAKED_LIVE_STATE) window.BAKED_LIVE_STATE = {};
          if (!window.BAKED_LIVE_STATE.strength_prescriptions) window.BAKED_LIVE_STATE.strength_prescriptions = {};
          window.BAKED_LIVE_STATE.strength_prescriptions[exId] = mergedRx;
        } catch (e) {}
        if (typeof fetchAnalyticsSummary === 'function') fetchAnalyticsSummary(true);
        if (typeof renderStrengthProgressionChart === 'function') renderStrengthProgressionChart({ force: true });
      }).catch(() => {});

      const isSevereUnderperf = (loggedR === 0) || (diffR <= -3) || (targetR > 0 && loggedR <= Math.floor(targetR * 0.65)) || (pctDiff <= -20);
      const deloadW = (!isBodyweight && isSevereUnderperf)
        ? Math.min(loggedW, Math.max(2.5, Math.round((loggedW * 0.85) / 2.5) * 2.5))
        : loggedW;

      if (diffR < 0 || loggedR === 0) {
        row.classList.remove('logged');
        row.classList.add('missed');
        if (isSevereUnderperf && !isBodyweight) {
          tag.innerText = `📉 AUTOREGULATION: DELOAD TRIGGERED (-15% → ${deloadW}kg)`;
          tag.style.color = 'var(--amber)';
          msg.innerText = `Prescribed ${targetR} reps, managed ${loggedR} (${pctDiff}% e1RM). Deloading -15% to ${deloadW}kg × ${targetR} next session to restore bar speed & clean reps.`;
          transfer.innerText = `➔ Strength Transfer: Submaximal reset restores bar speed and joint stability.`;
          beep(440, 0.2);
          speak(`Set recorded. Severe under-performance detected. Deloading next session to ${deloadW} kilograms.`);
        } else {
          tag.innerText = '📉 AUTOREGULATION: UNDER-PERFORMANCE DETECTED';
          tag.style.color = 'var(--amber)';
          const nextRepTarget = Math.max(1, loggedR + 1);
          msg.innerText = loggedR === 0
            ? `Set failed (0 reps recorded). Autoregulating: Reducing target intensity for subsequent sets.`
            : `Prescribed ${targetR} reps, managed ${loggedR}. Autoregulating: Next session holds weight, bridging to ${nextRepTarget} reps before progression.`;
          transfer.innerText = `➔ Strength Transfer: Correlated assistance volume adjusted down.`;
          beep(440, 0.2);
          speak("Set recorded. Autoregulating volume.");
        }
      } else if (diffR === 0) {
        row.classList.remove('missed');
        row.classList.add('logged');
        tag.innerText = '✓ TARGET HIT CLEANLY';
        tag.style.color = 'var(--lime)';
        if (isBodyweight) {
          msg.innerText = `Target hit cleanly (${loggedR}/${targetR} reps). Double progression advances to +1 rep (${loggedR + 1} reps) next session!`;
        } else {
          const nextW = loggedW + 2.5;
          msg.innerText = `Target hit cleanly (${loggedR}/${targetR} reps). Double progression triggers microload +2.5kg ➔ ${nextW}kg next session!`;
        }
        transfer.innerText = `➔ Strength Transfer: Correlated movement strength sustained and primed.`;
        beep(750, 0.1);
        speak(isBodyweight ? "Target hit cleanly! Advancing to plus one rep." : "Target hit cleanly! Double progression microloaded.");
      } else {
        row.classList.remove('missed');
        row.classList.add('logged');
        tag.innerText = '🔥 TARGET EXCEEDED: OVER-PERFORMANCE';
        tag.style.color = 'var(--cyan)';
        if (isBodyweight) {
          msg.innerText = `Crushed target by +${diffR} reps (${loggedR}/${targetR})! Advancing to +1 rep (${loggedR + 1} reps) next session!`;
        } else {
          const nextW = loggedW + 2.5;
          msg.innerText = `Crushed target by +${diffR} reps (${loggedR}/${targetR})! e1RM jumped to ${achievedE1RM}kg. Next session load microloaded +2.5kg ➔ ${nextW}kg!`;
        }
        if (exId.includes('press') || exId.includes('floor')) {
          transfer.innerText = `➔ Strength Transfer: Floor press power scales your unbroken push-up capacity!`;
        } else if (exId.includes('rdl')) {
          transfer.innerText = `➔ Strength Transfer: RDL strength scales your kettlebell swings power output!`;
        } else {
          transfer.innerText = `➔ Strength Transfer: Correlated movement patterns scaled up (+${pctDiff}%).`;
        }
        beep(920, 0.15);
        speak("Target crushed! Extra reps recorded.");
      }

      const restSecsTarget = parseRestSeconds(activeExObj && activeExObj.rest);
      const totalSetsCount = (activeExObj && activeExObj.setsCount) || 3;
      const nextEx = (typeof activeWorkoutPlan !== 'undefined' && Array.isArray(activeWorkoutPlan)) ? activeWorkoutPlan[currentExIdx + 1] : null;
      const nextCue = setNum >= totalSetsCount ? (nextEx ? `Next: ${nextEx.name}` : 'Finish Session') : `Set ${setNum + 1}`;
      startRestCountdown(restSecsTarget, nextCue);

      // Persist logged set AND compute next-session prescription
      try {
        let currentRxMap = {};
        try {
          const raw = localStorage.getItem('pulse_strength_prescriptions');
          if (raw) currentRxMap = JSON.parse(raw) || {};
        } catch(e) {}

        if (!window.BAKED_LIVE_STATE) window.BAKED_LIVE_STATE = {};
        if (!window.BAKED_LIVE_STATE.strength_prescriptions) window.BAKED_LIVE_STATE.strength_prescriptions = {};

        const existing = currentRxMap[exId] || window.BAKED_LIVE_STATE.strength_prescriptions[exId] || {};

        let nextW;
        let nextR;
        let nextStatus = existing.status;

        if (isBodyweight) {
          nextW = 'Body';
          const baseR = typeof targetR === 'number' ? targetR : (typeof existing.reps === 'number' ? existing.reps : 10);
          nextR = loggedR + (diffR >= 0 ? 1 : 0);
          if (nextR < baseR && diffR >= 0) nextR = baseR + 1;
          nextStatus = (diffR >= 0) ? 'progressed' : 'holding';
        } else if (isSevereUnderperf) {
          nextW = deloadW;
          nextR = targetR;
          nextStatus = 'deloaded';
        } else if (diffR < 0) {
          nextW = loggedW;
          nextR = targetR;
          nextStatus = 'holding';
        } else {
          const loadInc = (diffR === 0 ? 2.5 : (diffR > 0 ? 2.5 : 0));
          nextW = Math.round((loggedW + loadInc) * 10) / 10;
          nextR = targetR;
          nextStatus = 'progressed';
        }

        const updatedRx = {
          ...existing,
          weight: nextW,
          reps: nextR,
          status: nextStatus,
          last_logged_weight: loggedW,
          last_logged_reps: loggedR,
          last_e1rm: achievedE1RM,
          last_updated: new Date().toISOString()
        };

        currentRxMap[exId] = updatedRx;
        window.BAKED_LIVE_STATE.strength_prescriptions[exId] = updatedRx;
        localStorage.setItem('pulse_strength_prescriptions', JSON.stringify(currentRxMap));
        if (typeof renderStrengthProgressionChart === 'function') {
          renderStrengthProgressionChart({ force: true });
        }
      } catch(e) {
        console.warn('Could not persist prescription progression:', e);
      }
    }

