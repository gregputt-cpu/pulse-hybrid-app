    let restTimerInterval = null;
    let restSecs = 90;
    let restEndTimeMs = 0;
    let restLastCueSec = 0;


    function _setRestBarActive(isActive) {
      const box = document.querySelector('#trainViewPrescribed .rest-bar-box');
      if (box) box.classList.toggle('rest-active', Boolean(isActive));
    }

    function _exitWorkoutFocusMode() {
      if (typeof document === 'undefined') return;
      if (document.body) document.body.classList.remove('workout-focus-mode');
      const btn = document.getElementById('btnWorkoutFocusMode');
      if (btn) btn.innerText = 'Focus Mode';
    }

    function _tickRestTimer() {
      if (!restTimerInterval || !restEndTimeMs) return;
      const remaining = Math.max(0, Math.ceil((restEndTimeMs - Date.now()) / 1000));
      const jumped = (restLastCueSec - remaining) > 3;
      const crossed = (thresh) => restLastCueSec > thresh && remaining <= thresh;

      if (!jumped && remaining > 0) {
        if (crossed(30)) {
          speak("30 seconds remaining.");
        } else if (crossed(10)) {
          speak("10 seconds. Get ready.");
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else if (crossed(3)) {
          speak("3");
        } else if (crossed(2)) {
          speak("2");
        } else if (crossed(1)) {
          speak("1");
        }
      }

      restLastCueSec = remaining;
      restSecs = remaining;

      if (remaining <= 0) {
        clearInterval(restTimerInterval);
        restTimerInterval = null;
        restEndTimeMs = 0;
        const pill = document.getElementById('floatingRestPill');
        if (pill) pill.classList.remove('active');
        _setRestBarActive(false);
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
        beep(1046, 0.2);
        speak("Rest complete! Set time, let's go!");
        showToast('⚡ Rest complete! Time for the next set!');
        if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
      }
      updateRestDisplay();
    }

    function startRestCountdown(seconds, nextCue) {
      clearInterval(restTimerInterval);
      restTimerInterval = null;
      const cleanSecs = Math.max(0, Number(seconds) || 0);
      restSecs = cleanSecs;
      restEndTimeMs = Date.now() + cleanSecs * 1000;
      restLastCueSec = cleanSecs + 1;
      const elCue = document.getElementById('restNextCue');
      if (elCue) elCue.innerText = `Next: ${nextCue}`;
      const floatingPill = document.getElementById('floatingRestPill');
      if (floatingPill) floatingPill.classList.add('active');
      _setRestBarActive(cleanSecs > 0);
      const floatingNext = document.getElementById('floatingRestNext');
      if (floatingNext) floatingNext.innerText = nextCue || '';
      updateRestDisplay();
      requestWakeLock();
      speak(`Rest started. ${cleanSecs} seconds on the clock.`, true);

      restTimerInterval = setInterval(_tickRestTimer, 250);
    }

    function updateRestDisplay() {
      const m = Math.floor(restSecs / 60);
      const s = restSecs % 60;
      const formatted = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      const elDigits = document.getElementById('restDigits');
      if (elDigits) elDigits.innerText = formatted;
      const floatingDigits = document.getElementById('floatingRestDigits');
      if (floatingDigits) floatingDigits.innerText = formatted;
    }

    function addRest(sec) {
      const addMs = Number(sec) || 0;
      if (restTimerInterval && restEndTimeMs) {
        restEndTimeMs += addMs * 1000;
        restSecs = Math.max(0, Math.ceil((restEndTimeMs - Date.now()) / 1000));
        restLastCueSec = restSecs + 1;
      } else {
        restSecs = Math.max(0, restSecs + addMs);
      }
      updateRestDisplay();
      speak(`Added ${sec} seconds.`);
      beep(600, 0.05);
    }

    function skipRest() {
      restSecs = 0;
      restEndTimeMs = 0;
      clearInterval(restTimerInterval);
      restTimerInterval = null;
      const pill = document.getElementById('floatingRestPill');
      if (pill) pill.classList.remove('active');
      _setRestBarActive(false);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      beep(1046, 0.2);
      updateRestDisplay();
      if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
      showToast('Rest skipped. Ready for next set!');
      speak("Rest skipped. Let's work!");
    }

    function finishSession() {
      if (typeof stopInlineTimer === 'function') stopInlineTimer();
      // Immediately stop and hide rest timer
      if (restTimerInterval && typeof skipRest === 'function') skipRest();
      _setRestBarActive(false);
      _exitWorkoutFocusMode();
      clearInterval(restTimerInterval);
      restTimerInterval = null;
      restEndTimeMs = 0;
      restSecs = 0;
      const fp = document.getElementById('floatingRestPill');
      if (fp) fp.classList.remove('active');

      beep(880, 0.2);
      setTimeout(() => beep(1100, 0.3), 150);
      speak("Outstanding session! Workout saved to training history.");
      
      const setsLoggedCount = Object.keys(sessionLoggedSets).length;
      const totalPlannedSets = activeWorkoutPlan.reduce((acc, ex) => acc + (ex.setsCount || 3), 0) || 15;
      const sessionCalories = Math.max(80, Math.round(setsLoggedCount * 16 + activeWorkoutPlan.length * 10));
      const sessionEventId = (typeof _makeQueueItemId === 'function') ? _makeQueueItemId() : `${Date.now()}`;

      const sessionMeta = window.activeSessionMeta || {};
      const summary = {
        id: sessionEventId,
        client_event_id: sessionEventId,
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
        title: sessionMeta.title || (document.getElementById('wPlanBadge')?.innerText || '').trim() || 'Hybrid Training Session',
        preset: sessionMeta.preset || currentPreset,
        goal: sessionMeta.goal || currentGoalKey,
        exercisesCompleted: activeWorkoutPlan.length,
        setsLogged: setsLoggedCount,
        calories: sessionCalories,
        details: sessionLoggedSets
      };

      try {
        const histRaw = localStorage.getItem('pulse_session_history') || '[]';
        const hist = JSON.parse(histRaw);
        hist.unshift(summary);
        localStorage.setItem('pulse_session_history', JSON.stringify(hist.slice(0, 30)));
      } catch(e) {}

      syncSessionToBackend(summary);
      localStorage.removeItem('pulse_active_session');
      sessionLoggedSets = {};

      showToast(`🏆 Workout logged! Autoregulation state saved. ~${sessionCalories} kcal added to today's fuel budget!`);
      try {
        const _iso = (typeof getLocalDateStr === 'function')
          ? getLocalDateStr()
          : `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
        localStorage.setItem('pulse_strength_done_today', 'true');
        localStorage.setItem('pulse_workout_completed_date', _iso);

        if (typeof _appendInAppBurnEntry === 'function') {
          _appendInAppBurnEntry({
            id: sessionEventId,
            date: _iso,
            calories: sessionCalories,
            kind: 'strength'
          });
        } else {
          localStorage.setItem('pulse_inapp_burn_today', JSON.stringify([
            { id: sessionEventId, date: _iso, calories: sessionCalories, kind: 'strength' }
          ]));
        }
      } catch(e) {}
      renderTodayTrainingRecommendations();
      if (typeof renderMyNetDiaryEngine === 'function') renderMyNetDiaryEngine();
      if (typeof applyLiveStateToDom === 'function' && window.BAKED_LIVE_STATE) applyLiveStateToDom(window.BAKED_LIVE_STATE);
      switchTab('fuel');
    }

    // TAB MANAGEMENT
    function switchTab(key) {
      if (key === 'timer') {
        switchTab('train');
        if (typeof switchTrainView === 'function') switchTrainView('timer');
        return;
      }
      if (key !== 'train') _exitWorkoutFocusMode();
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

      const targetP = document.getElementById(`tab-${key}`);
      const targetB = document.getElementById(`nav-${key}`);
      if (targetP) targetP.classList.add('active');
      if (targetB) targetB.classList.add('active');
      beep(550, 0.04);

      if (key === 'train' && typeof updateArchetypeStarBadge === 'function' && typeof computeTodayWorkoutVerdict === 'function') {
        try {
          if (typeof currentArchetypeKey === 'undefined' || !currentArchetypeKey) {
            updateArchetypeStarBadge(computeTodayWorkoutVerdict().archetypeKey);
          }
        } catch(e) {}
      }
      if (key === 'health' && typeof renderAutonomicUi === 'function') {
        try { renderAutonomicUi(); } catch(e) {}
      }
    }

    // TIMER TAB (Wall-Clock Resynchronized)
    let tMode = 'skip';
    let tSeconds = 45;
    let tInterval = null;
    let tRunning = false;
    let tRounds = 0;
    let isWorkPhase = true;
    let tLastTickMs = 0;

    function _setTimerToggleVisualState(isRunning) {
      const toggleBtn = document.getElementById('btnTimerToggle');
      if (!toggleBtn) return;
      toggleBtn.classList.toggle('timer-running', Boolean(isRunning));
      toggleBtn.classList.toggle('timer-paused', !isRunning);
    }

    function setTimerMode(m) {
      tMode = m;
      ['Skip', 'Amrap', 'Stop'].forEach(k => document.getElementById(`tm${k}`).classList.remove('active'));
      const map = { skip: 'tmSkip', amrap: 'tmAmrap', stopwatch: 'tmStop' };
      document.getElementById(map[m]).classList.add('active');
      resetTimer();

      if (m === 'skip') {
        tSeconds = 45;
        document.getElementById('timerPhase').innerText = '🟢 WORK INTERVAL 1 OF 6';
        document.getElementById('timerSubLabel').innerText = 'Stay light on balls of feet • Fast wrist rotation';
      } else if (m === 'amrap') {
        tSeconds = 600;
        document.getElementById('timerPhase').innerText = '🔥 10-MINUTE AMRAP';
        document.getElementById('timerSubLabel').innerText = 'As many quality rounds as possible';
      } else {
        tSeconds = 0;
        document.getElementById('timerPhase').innerText = '⏱️ STOPWATCH MODE';
        document.getElementById('timerSubLabel').innerText = 'Continuous elapsed time';
      }
      updateTimerUI();
      beep(650, 0.05);
    }

    function stepMainTimerSeconds(deltaSec, isCatchUp = false) {
      const steps = Math.max(0, Math.floor(deltaSec));
      if (tMode === 'stopwatch' && tRunning) {
        tSeconds += steps;
        updateTimerUI();
        return;
      }
      for (let i = 0; i < steps; i++) {
        if (!tRunning) return;
        const isLastStep = (i === steps - 1);
        tSeconds--;
        if (!isCatchUp) {
          if (tMode === 'skip' && isWorkPhase && tSeconds === 20) {
            speak("20 seconds remaining.");
          } else if (tSeconds === 5) {
            speak("5, 4, 3, 2, 1");
            if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          }
        }
        if (tSeconds <= 0) {
          if (tMode === 'skip') {
            isWorkPhase = !isWorkPhase;
            if (isWorkPhase) {
              tRounds++;
              if (tRounds >= 6) {
                clearInterval(tInterval);
                tInterval = null;
                tRunning = false;
                tLastTickMs = 0;
                tSeconds = 0;
                const playIcon = document.getElementById('timerPlayIcon');
                const playText = document.getElementById('timerPlayText');
                if (playIcon) playIcon.innerText = '▶';
                if (playText) playText.innerText = 'START';
                _setTimerToggleVisualState(false);
                const phaseEl = document.getElementById('timerPhase');
                if (phaseEl) {
                  phaseEl.innerText = '🏆 6 OF 6 ROUNDS COMPLETE!';
                  phaseEl.style.color = 'var(--lime)';
                }
                const rdEl = document.getElementById('roundsDisplay');
                if (rdEl) rdEl.innerText = `${tRounds} Rounds Done`;
                beep(950, 0.45);
                speak("6 rounds complete! Outstanding interval work!");
                if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
                showToast('🏆 6-Round Skip Interval Complete!');
                if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
                updateTimerUI();
                return;
              }
              tSeconds = 45;
              const phaseEl = document.getElementById('timerPhase');
              if (phaseEl) {
                phaseEl.innerText = `🟢 WORK INTERVAL ${tRounds + 1} OF 6`;
                phaseEl.style.color = 'var(--lime)';
              }
              if (isLastStep || !isCatchUp) {
                beep(880, 0.4);
                speak(`Work interval round ${tRounds + 1}. Let's go!`);
                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
              }
            } else {
              if (tRounds + 1 >= 6) {
                tRounds = 6;
                clearInterval(tInterval);
                tInterval = null;
                tRunning = false;
                tLastTickMs = 0;
                tSeconds = 0;
                const playIcon = document.getElementById('timerPlayIcon');
                const playText = document.getElementById('timerPlayText');
                if (playIcon) playIcon.innerText = '▶';
                if (playText) playText.innerText = 'START';
                _setTimerToggleVisualState(false);
                const phaseEl = document.getElementById('timerPhase');
                if (phaseEl) {
                  phaseEl.innerText = '🏆 6 OF 6 ROUNDS COMPLETE!';
                  phaseEl.style.color = 'var(--lime)';
                }
                const rdEl = document.getElementById('roundsDisplay');
                if (rdEl) rdEl.innerText = `${tRounds} Rounds Done`;
                beep(950, 0.45);
                speak("6 rounds complete! Outstanding interval work!");
                if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
                showToast('🏆 6-Round Skip Interval Complete!');
                if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
                updateTimerUI();
                return;
              }
              tSeconds = 15;
              const phaseEl = document.getElementById('timerPhase');
              if (phaseEl) {
                phaseEl.innerText = '🟡 REST INTERVAL (15s)';
                phaseEl.style.color = 'var(--amber)';
              }
              if (isLastStep || !isCatchUp) {
                beep(520, 0.3);
                speak("Rest interval! 15 seconds.");
                if (navigator.vibrate) navigator.vibrate([150, 60, 150]);
              }
            }
            const rdEl = document.getElementById('roundsDisplay');
            if (rdEl) rdEl.innerText = `${tRounds} Rounds Done`;
          } else {
            clearInterval(tInterval);
            tInterval = null;
            tRunning = false;
            tLastTickMs = 0;
            tSeconds = 0;
            const playIcon = document.getElementById('timerPlayIcon');
            const playText = document.getElementById('timerPlayText');
            if (playIcon) playIcon.innerText = '▶';
            if (playText) playText.innerText = 'START';
            _setTimerToggleVisualState(false);
            beep(880, 0.5);
            speak("AMRAP complete! Fantastic work.");
            if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
            showToast('🏆 AMRAP Interval Complete!');
            if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
            updateTimerUI();
            return;
          }
        }
      }
      updateTimerUI();
    }

    function _tickMainTimerFromClock() {
      if (!tRunning) return;
      const nowMs = Date.now();
      if (!tLastTickMs) tLastTickMs = nowMs;
      const deltaSec = Math.floor((nowMs - tLastTickMs) / 1000);
      if (deltaSec > 0) {
        tLastTickMs += deltaSec * 1000;
        stepMainTimerSeconds(deltaSec, deltaSec > 3);
      }
    }

    function toggleTimer() {
      if (!tRunning) {
        tRunning = true;
        tLastTickMs = Date.now();
        document.getElementById('timerPlayIcon').innerText = '⏸';
        document.getElementById('timerPlayText').innerText = 'PAUSE';
        _setTimerToggleVisualState(true);
        beep(750, 0.15);
        requestWakeLock();

        if (tMode === 'skip') {
          speak(isWorkPhase ? "Speed rope interval started. 45 seconds work!" : "Rest interval started.", true);
        } else if (tMode === 'amrap') {
          speak("10 minute AMRAP started. Max rounds!", true);
        } else {
          speak("Stopwatch started.", true);
        }

        tInterval = setInterval(_tickMainTimerFromClock, 250);
      } else {
        _tickMainTimerFromClock();
        tRunning = false;
        tLastTickMs = 0;
        clearInterval(tInterval);
        tInterval = null;
        document.getElementById('timerPlayIcon').innerText = '▶';
        document.getElementById('timerPlayText').innerText = 'RESUME';
        _setTimerToggleVisualState(false);
        if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
        speak("Paused.");
        beep(500, 0.1);
      }
    }

    function resetTimer() {
      tRunning = false;
      tLastTickMs = 0;
      clearInterval(tInterval);
      tInterval = null;
      tRounds = 0;
      isWorkPhase = true;
      const playIcon = document.getElementById('timerPlayIcon');
      const playText = document.getElementById('timerPlayText');
      if (playIcon) playIcon.innerText = '▶';
      if (playText) playText.innerText = 'START';
      _setTimerToggleVisualState(false);
      const rdEl = document.getElementById('roundsDisplay');
      if (rdEl) rdEl.innerText = '0 Rounds Done';
      const phaseEl = document.getElementById('timerPhase');
      if (tMode === 'skip') {
        tSeconds = 45;
        if (phaseEl) {
          phaseEl.innerText = '🟢 WORK INTERVAL 1 OF 6';
          phaseEl.style.color = 'var(--lime)';
        }
      } else if (tMode === 'amrap') {
        tSeconds = 600;
        if (phaseEl) {
          phaseEl.innerText = '🔥 10-MINUTE AMRAP';
          phaseEl.style.color = 'var(--cyan)';
        }
      } else {
        tSeconds = 0;
        if (phaseEl) {
          phaseEl.innerText = '⏱️ STOPWATCH READY';
          phaseEl.style.color = 'var(--text-muted)';
        }
      }
      if (typeof releaseWakeLockIfIdle === 'function') releaseWakeLockIfIdle();
      updateTimerUI();
      beep(450, 0.05);
    }

    function updateTimerUI() {
      const m = Math.floor(tSeconds / 60);
      const s = tSeconds % 60;
      document.getElementById('bigTimerDigits').innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function stepRound(delta) {
      tRounds = Math.max(0, tRounds + delta);
      document.getElementById('roundsDisplay').innerText = `${tRounds} Rounds Done`;
      beep(600, 0.08);
    }

    function logTimerSession() {
      const rounds = Math.max(1, parseInt(tRounds, 10) || 1);
      const modeLabel = (tMode === 'amrap') ? 'AMRAP' : ((tMode === 'skip') ? 'Intervals / Skip' : 'EMOM / Conditioning');
      let durationMin = 10;
      if (tMode === 'amrap') {
        durationMin = Math.max(1, Math.round((600 - (tSeconds || 0)) / 60) || 10);
      } else if (tMode === 'skip') {
        durationMin = Math.max(1, Math.round(rounds * 1.5));
      } else {
        durationMin = Math.max(1, Math.round((tSeconds || 0) / 60) || Math.max(5, rounds * 2));
      }
      const estCalories = Math.max(50, Math.round(durationMin * 10 + rounds * 10));
      const now = new Date();
      const isoDate = (typeof getLocalDateStr === 'function')
        ? getLocalDateStr(now)
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const subTitle = `${modeLabel} • ${rounds} Rounds (${durationMin}m)`;
      const baseEventId = (typeof _makeQueueItemId === 'function') ? _makeQueueItemId() : `${Date.now()}`;
      const actEventId = `${baseEventId}_act`;
      const sessEventId = `${baseEventId}_sess`;

      // 1. Persist to pulse_conditioning_history (Array schema)
      _appendConditioningHistoryEntry({
        date: now.toISOString(),
        mode: tMode,
        rounds: rounds,
        duration_min: durationMin,
        calories: estCalories,
        sub_title: subTitle
      });

      // 2. Update date-scoped pulse_inapp_burn_today
      try {
        if (typeof _appendInAppBurnEntry === 'function') {
          _appendInAppBurnEntry({
            id: actEventId,
            date: isoDate,
            calories: estCalories,
            kind: 'conditioning'
          });
        } else {
          localStorage.setItem('pulse_inapp_burn_today', JSON.stringify([
            { id: actEventId, date: isoDate, calories: estCalories, kind: 'conditioning' }
          ]));
        }
      } catch(e) {}

      // 3. Append to recentActivitiesData + localStorage + refresh UI
      const newActivity = {
        id: actEventId,
        client_event_id: actEventId,
        name: 'Conditioning',
        subTitle: subTitle,
        sub_title: subTitle,
        date: `${isoDate} ${now.toTimeString().slice(0, 8)}`,
        durationMin: durationMin,
        duration_min: durationMin,
        calories: estCalories,
        avgHr: 145,
        maxHr: 170,
        aerobicTe: 2.6,
        anaerobicTe: 1.8,
        source: 'manual_app_entry'
      };
      if (typeof recentActivitiesData !== 'undefined' && Array.isArray(recentActivitiesData)) {
        recentActivitiesData.unshift(newActivity);
        try {
          localStorage.setItem('pulse_recent_activities', JSON.stringify(recentActivitiesData));
        } catch(e) {}
        if (typeof renderHistoryList === 'function') renderHistoryList();
      }
      if (typeof renderMyNetDiaryEngine === 'function') renderMyNetDiaryEngine();
      if (typeof renderTodayTrainingRecommendations === 'function') renderTodayTrainingRecommendations();
      if (typeof loadLiveState === 'function') loadLiveState({ silent: true });

      // 4. Sync to backend (/api/sync_activity & /api/sync_session via pulseApiFetch + offline queue)
      const actPayload = {
        id: actEventId,
        client_event_id: actEventId,
        client_date: isoDate,
        name: 'Conditioning',
        sub_title: subTitle,
        duration_min: durationMin,
        calories: estCalories,
        avg_hr: 145,
        max_hr: 170,
        aerobic_te: 2.6,
        anaerobic_te: 1.8
      };
      (async () => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/sync_activity', actPayload, 'POST');
          return;
        }
        try {
          const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch)('/api/sync_activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(actPayload),
            timeoutMs: 4000
          });
          if (!res || !res.ok) {
            const shouldQueue = (typeof _shouldQueueOfflineResponse === 'function')
              ? _shouldQueueOfflineResponse(res)
              : (!res || res.status >= 500 || res.status === 0);
            if (shouldQueue && typeof enqueueOfflineWrite === 'function') {
              enqueueOfflineWrite('/api/sync_activity', actPayload, 'POST');
            }
          }
        } catch(e) {
          if (typeof enqueueOfflineWrite === 'function') enqueueOfflineWrite('/api/sync_activity', actPayload, 'POST');
        }
      })();
      if (typeof syncSessionToBackend === 'function') {
        syncSessionToBackend({
          id: sessEventId,
          client_event_id: sessEventId,
          date: now.toISOString(),
          preset: `timer_${tMode}`,
          goal: typeof currentGoalKey !== 'undefined' ? currentGoalKey : 'recomp',
          exercisesCompleted: 1,
          setsLogged: rounds,
          calories: estCalories,
          details: { mode: tMode, rounds: rounds, duration_min: durationMin }
        });
      }

      beep(880, 0.2);
      showToast(`✓ Logged ${rounds} rounds (${estCalories} kcal) to training history!`);
      switchTab('fuel');
    }

    if (typeof document !== 'undefined' && !window._pulseTimerVisibilityHooked) {
      window._pulseTimerVisibilityHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (typeof _tickRestTimer === 'function') _tickRestTimer();
          if (typeof _tickMainTimerFromClock === 'function') _tickMainTimerFromClock();
          if (typeof _tickInlineTimerFromClock === 'function') _tickInlineTimerFromClock();
        }
      });
    }

    // EXPOSE TO WINDOW FOR INLINE ONCLICK HANDLERS
    window.setTodayWorkoutFilter = setTodayWorkoutFilter;
    window.launchDynamicWorkout = launchDynamicWorkout;
    window.jumpToExercise = jumpToExercise;
    window.skipCurrentExercise = skipCurrentExercise;
    window.openSwapModal = openSwapModal;
    window.closeSwapModal = closeSwapModal;
    window.openEditLoadModal = openEditLoadModal;
    window.openEditLoadModalForActive = openEditLoadModalForActive;
    window.closeEditLoadModal = closeEditLoadModal;
    window.saveEditLoadModal = saveEditLoadModal;
    window.startTodayOption = startTodayOption;
    window.loadPreset = loadPreset;
    window.renderSwapOptions = renderSwapOptions;
    window.selectSwapExercise = selectSwapExercise;
    window.addCustomExerciseMidWorkout = addCustomExerciseMidWorkout;
    window.renderTodayTrainingRecommendations = renderTodayTrainingRecommendations;
    window.masterExercises = masterExercises;
    window.todayWorkoutOptions = todayWorkoutOptions;
    window.getPrescribedLoad = getPrescribedLoad;
    window.getFatiguedPatterns48h = getFatiguedPatterns48h;
    window.getRotatedExercisesForOption = getRotatedExercisesForOption;
    window.updateArchetypeStarBadge = updateArchetypeStarBadge;
    window.computeTodayWorkoutVerdict = computeTodayWorkoutVerdict;
    window.loadDailyArchetype = loadDailyArchetype;
    window.setTodayContext = setTodayContext;
    window.openWorkoutTabFromVerdict = openWorkoutTabFromVerdict;
    window.getTodayFeeling = getTodayFeeling;
    window.getTodayGearMode = getTodayGearMode;
    window.getTodayTimeMode = getTodayTimeMode;

    // WORKOUT ENGINE PREFERENCES & CUSTOM LIBRARY EXPOSES
    window.parseRestSeconds = parseRestSeconds;
    window.getAllExercises = getAllExercises;
    window.getCustomExercises = getCustomExercises;
    window.saveCustomExercise = saveCustomExercise;
    window.createCustomExerciseObj = createCustomExerciseObj;
    window.createAndSwapCustomExercise = createAndSwapCustomExercise;
    window.updateCustomSwapRationalePreview = updateCustomSwapRationalePreview;
    window.hideCurrentExerciseFromModal = hideCurrentExerciseFromModal;
    window.unhideAllExercises = unhideAllExercises;
    window.resolvePreferredExerciseId = resolvePreferredExerciseId;
    window.getPermanentSwaps = getPermanentSwaps;
    window.savePermanentSwap = savePermanentSwap;
    window.removePermanentSwap = removePermanentSwap;
    window.getHiddenExercises = getHiddenExercises;
    window.addHiddenExercise = addHiddenExercise;
    window.getConditioningProgression = getConditioningProgression;
    window.saveConditioningProgression = saveConditioningProgression;
    window.stepMainTimerSeconds = stepMainTimerSeconds;
    window._stepInlineTimerSeconds = _stepInlineTimerSeconds;
    window._tickRestTimer = _tickRestTimer;
    window._tickMainTimerFromClock = _tickMainTimerFromClock;
    window._tickInlineTimerFromClock = _tickInlineTimerFromClock;
    if (typeof computeBarbellPlatesPerSide === 'function') window.computeBarbellPlatesPerSide = computeBarbellPlatesPerSide;
    if (typeof stepSetInput === 'function') window.stepSetInput = stepSetInput;
    if (typeof toggleWorkoutFocusMode === 'function') window.toggleWorkoutFocusMode = toggleWorkoutFocusMode;
    if (typeof applyPreset === 'function') window.applyPreset = applyPreset;
    if (typeof setSessionFocus === 'function') window.setSessionFocus = setSessionFocus;
    if (typeof toggleGear === 'function') window.toggleGear = toggleGear;
    if (typeof updateGearWeight === 'function') window.updateGearWeight = updateGearWeight;
    if (typeof applyCustomEquipmentAndGenerate === 'function') window.applyCustomEquipmentAndGenerate = applyCustomEquipmentAndGenerate;
    if (typeof switchTab === 'function') window.switchTab = switchTab;
    if (typeof finishSession === 'function') window.finishSession = finishSession;



