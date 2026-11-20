    window.BAKED_LIVE_STATE = {
      last_synced: null,
      date: null,
      athlete: { name: "Athlete", age: 45, height_cm: 190.0, weight_kg: null, body_fat_pct: null, target_body_fat_pct: 15.0, lean_mass_kg: null, muscle_mass_kg: null, fat_to_lose_kg: null, target_weight_kg: null },
      garmin: { device: "Garmin Wearable", today_activities: [], recent_activities: [], steps: 0, active_calories: 0 },
      renpho: {},
      nutrition: { calorie_target: 2092, deficit: 350, protein_target_g: 200, carbs_target_g: 251, fat_target_g: 80 },
      strength_prescriptions: {},
      mnd_meals: {
        breakfast: { name: "Breakfast", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
        lunch: { name: "Lunch", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
        dinner: { name: "Dinner", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
        snacks: { name: "Snacks & Hydration", time: "", calories: 0, protein: 0, carbs: 0, fat: 0, items: [] }
      },
      mnd_logged: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0, water_l: 0.0 },
      mnd_history: { window_days: 0, days: [] },
      injuries: { lumbar: false, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false, notes: "" }
    };
    try {
      const _cachedLiveRaw = localStorage.getItem('pulse_cached_live_state');
      if (_cachedLiveRaw) {
        const _cachedLiveParsed = JSON.parse(_cachedLiveRaw);
        if (_cachedLiveParsed && typeof _cachedLiveParsed === 'object' && !Array.isArray(_cachedLiveParsed)) {
          const _now = new Date();
          const _todayIso = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
          if (_cachedLiveParsed.date && _cachedLiveParsed.date !== _todayIso) {
            const _cachedGarmin = (_cachedLiveParsed.garmin && typeof _cachedLiveParsed.garmin === 'object') ? _cachedLiveParsed.garmin : {};
            window.BAKED_LIVE_STATE = {
              ...window.BAKED_LIVE_STATE,
              last_synced: _cachedLiveParsed.last_synced || null,
              date: _todayIso,
              athlete: (_cachedLiveParsed.athlete && typeof _cachedLiveParsed.athlete === 'object') ? _cachedLiveParsed.athlete : window.BAKED_LIVE_STATE.athlete,
              renpho: (_cachedLiveParsed.renpho && typeof _cachedLiveParsed.renpho === 'object') ? _cachedLiveParsed.renpho : window.BAKED_LIVE_STATE.renpho,
              nutrition: (_cachedLiveParsed.nutrition && typeof _cachedLiveParsed.nutrition === 'object') ? _cachedLiveParsed.nutrition : window.BAKED_LIVE_STATE.nutrition,
              strength_prescriptions: (_cachedLiveParsed.strength_prescriptions && typeof _cachedLiveParsed.strength_prescriptions === 'object') ? _cachedLiveParsed.strength_prescriptions : window.BAKED_LIVE_STATE.strength_prescriptions,
              mnd_history: (_cachedLiveParsed.mnd_history && typeof _cachedLiveParsed.mnd_history === 'object') ? _cachedLiveParsed.mnd_history : window.BAKED_LIVE_STATE.mnd_history,
              injuries: (_cachedLiveParsed.injuries && typeof _cachedLiveParsed.injuries === 'object') ? _cachedLiveParsed.injuries : window.BAKED_LIVE_STATE.injuries,
              garmin: {
                ...window.BAKED_LIVE_STATE.garmin,
                ..._cachedGarmin,
                steps: 0,
                active_calories: 0,
                today_activities: [],
                sleep_score: null,
                sleep_duration: null,
                body_battery: null,
                training_readiness: null
              },
              mnd_meals: window.BAKED_LIVE_STATE.mnd_meals,
              mnd_logged: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0, water_l: 0.0 }
            };
          } else {
            window.BAKED_LIVE_STATE = { ...window.BAKED_LIVE_STATE, ..._cachedLiveParsed };
          }
        }
      }
    } catch (e) {}
    window.athleteProfile = {
      weightKg: 98.0,
      bodyFatPct: 17.0,
      leanMassKg: 81.0,
      targetBfPct: 15.0,
      targetWeightKg: 95.3,
      fatToLoseKg: 2.7,
      restingHr: 48,
      sleepScore: 80,
      readiness: 78
    };

    // Security utilities: HTML escaping (XSS mitigation) & legacy token cleanup
    function escapeHtml(value) {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    window.escapeHtml = escapeHtml;
    window.escapeAttr = escapeHtml;

    try {
      localStorage.removeItem('pulse_garmin_tokens_backup');
    } catch (e) {}

    window._pulseAuthDismissedAt = 0;
    window._pulseAuthPromptInFlight = null;
    async function ensurePulseApiAuth() {
      if (window._pulseAuthPromptInFlight) return window._pulseAuthPromptInFlight;
      window._pulseAuthPromptInFlight = (async () => {
        try {
          const statusRes = await fetch('/api/auth/status', { cache: 'no-store' });
          if (statusRes.ok) {
            const st = await statusRes.json();
            if (!st.auth_required || st.authenticated) {
              window._pulseAuthDismissedAt = 0;
              return true;
            }
          }
          const modal = document.getElementById('pulseAuthModal');
          const inputEl = document.getElementById('pulseAuthSecretInput');
          const errEl = document.getElementById('pulseAuthError');
          const submitBtn = document.getElementById('pulseAuthSubmitBtn');
          const cancelBtn = document.getElementById('pulseAuthCancelBtn');

          if (!modal || !inputEl || !submitBtn || !cancelBtn) {
            const secret = window.prompt('Enter your Pulse API Access Key to unlock this session:');
            if (!secret || !secret.trim()) {
              window._pulseAuthDismissedAt = Date.now();
              return false;
            }
            const loginRes = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ secret: secret.trim() })
            });
            if (loginRes.ok) {
              window._pulseAuthDismissedAt = 0;
              if (typeof flushOfflineQueue === 'function') setTimeout(() => flushOfflineQueue(), 50);
              return true;
            }
            return false;
          }

          return await new Promise((resolve) => {
            let settled = false;
            const setErr = (msg) => {
              if (!errEl) return;
              if (msg) {
                errEl.textContent = msg;
                errEl.style.display = 'block';
              } else {
                errEl.textContent = '';
                errEl.style.display = 'none';
              }
            };
            const cleanup = () => {
              submitBtn.removeEventListener('click', onSubmit);
              cancelBtn.removeEventListener('click', onCancel);
              inputEl.removeEventListener('keydown', onKeyDown);
            };
            const finish = (ok) => {
              if (settled) return;
              settled = true;
              cleanup();
              submitBtn.disabled = false;
              cancelBtn.disabled = false;
              setErr('');
              modal.classList.remove('open');
              if (ok) {
                window._pulseAuthDismissedAt = 0;
                if (typeof flushOfflineQueue === 'function') setTimeout(() => flushOfflineQueue(), 50);
              } else {
                window._pulseAuthDismissedAt = Date.now();
              }
              resolve(ok);
            };
            const onCancel = () => finish(false);
            const onSubmit = async () => {
              const secret = (inputEl.value || '').trim();
              if (!secret) {
                setErr('Please enter your Pulse API Access Key.');
                inputEl.focus();
                return;
              }
              setErr('');
              submitBtn.disabled = true;
              cancelBtn.disabled = true;
              try {
                const loginRes = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ secret })
                });
                if (loginRes.ok) {
                  finish(true);
                } else {
                  submitBtn.disabled = false;
                  cancelBtn.disabled = false;
                  setErr('Invalid access key — please try again.');
                  inputEl.value = '';
                  inputEl.focus();
                }
              } catch (err) {
                submitBtn.disabled = false;
                cancelBtn.disabled = false;
                setErr('Connection failed — please try again.');
                inputEl.focus();
              }
            };
            const onKeyDown = (ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                onSubmit();
              }
            };

            inputEl.value = '';
            setErr('');
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            submitBtn.addEventListener('click', onSubmit);
            cancelBtn.addEventListener('click', onCancel);
            inputEl.addEventListener('keydown', onKeyDown);
            modal.classList.add('open');
            setTimeout(() => inputEl.focus(), 30);
          });
        } catch (e) {
          return false;
        } finally {
          window._pulseAuthPromptInFlight = null;
        }
      })();
      return window._pulseAuthPromptInFlight;
    }
    window.ensurePulseApiAuth = ensurePulseApiAuth;

    async function pulseApiFetch(url, options = {}) {
      const {
        timeoutMs = 0,
        promptAuthOn401 = true,
        _skipAuthRetry = false,
        ...rawFetchOpts
      } = (options || {});

      const doSingleFetch = async () => {
        const fetchOpts = { ...rawFetchOpts };
        let timerId = null;
        let controller = null;
        if (timeoutMs > 0 && !fetchOpts.signal && typeof AbortController !== 'undefined') {
          controller = new AbortController();
          fetchOpts.signal = controller.signal;
          timerId = setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
          return await fetch(url, fetchOpts);
        } finally {
          if (timerId) clearTimeout(timerId);
        }
      };

      const res = await doSingleFetch();
      if (res && res.status === 401 && !_skipAuthRetry && promptAuthOn401 !== false) {
        const dismissedRecently = window._pulseAuthDismissedAt && (Date.now() - window._pulseAuthDismissedAt) < 60000;
        if (!dismissedRecently && typeof window.ensurePulseApiAuth === 'function') {
          const authed = await window.ensurePulseApiAuth();
          if (authed) {
            return await pulseApiFetch(url, { ...options, _skipAuthRetry: true });
          }
        }
      }
      return res;
    }
    window.pulseApiFetch = pulseApiFetch;

    window.userInteracted = false;
    document.addEventListener('pointerdown', () => { window.userInteracted = true; }, { once: true });
    let globalAudioCtx = null;
    function getAudioContext() {
      try {
        if (!globalAudioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) globalAudioCtx = new AudioContextClass();
        }
        if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
          globalAudioCtx.resume().catch(() => {});
        }
        return globalAudioCtx;
      } catch(e) {
        return null;
      }
    }

    function beep(freq = 880, dur = 0.12) {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + dur);
      } catch(e) {}
      // Haptic pulse for gym noise / headphones
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(40); } catch(e) {}
      }
    }

    function pulseHaptic(pattern = 25) {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(pattern); } catch(e) {}
      }
    }
    window.pulseHaptic = pulseHaptic;

    // CANONICAL ACTIVE BURN ACCESSORS (Replaces broken #vitalBurn DOM scraping)
    function getTodayInAppBurn(garminOverride) {
      let inAppBurn = 0;
      try {
        const now = new Date();
        const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const rawBurn = localStorage.getItem('pulse_inapp_burn_today');
        if (rawBurn) {
          const parsed = JSON.parse(rawBurn);
          if (parsed && parsed.date === todayIso) {
            inAppBurn = Number(parsed.calories !== undefined ? parsed.calories : parsed.kcal) || 0;
          }
        }
      } catch(e) {}

      // Prevent double-counting if Garmin OAuth already measured a Strength activity today
      try {
        const g = garminOverride || (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) || null;
        if (g && g.source === 'garmin_oauth') {
          const todayActs = Array.isArray(g.today_activities) ? g.today_activities : [];
          const hasGarminStrength = todayActs.some(a => {
            const name = (a.name || '').toLowerCase();
            const key = (a.activity_type_key || '').toLowerCase();
            return name.includes('strength') || key.includes('strength');
          });
          if (hasGarminStrength) inAppBurn = 0;
        }
      } catch(e) {}
      return Math.max(0, Math.round(inAppBurn));
    }

    function getTodayActiveBurn(stateOverride) {
      const st = stateOverride || (typeof window !== 'undefined' ? window.BAKED_LIVE_STATE : null) || {};
      const g = st.garmin || null;
      const baseGarminBurn = (g && g.active_calories !== undefined && g.active_calories !== null)
        ? (Number(g.active_calories) || 0)
        : 0;
      return Math.max(0, Math.round(baseGarminBurn + getTodayInAppBurn(g)));
    }
    if (typeof window !== 'undefined') {
      window.getTodayInAppBurn = getTodayInAppBurn;
      window.getTodayActiveBurn = getTodayActiveBurn;
    }

    // SCREEN WAKE LOCK API (Prevents phone sleeping during active intervals/rest)
    let screenWakeLock = null;
    let _wakeLockDesired = false;
    async function requestWakeLock() {
      _wakeLockDesired = true;
      try {
        if ('wakeLock' in navigator) {
          if (screenWakeLock && !screenWakeLock.released) return;
          screenWakeLock = await navigator.wakeLock.request('screen');
          if (screenWakeLock && typeof screenWakeLock.addEventListener === 'function') {
            screenWakeLock.addEventListener('release', () => {
              screenWakeLock = null;
            });
          }
        }
      } catch(e) {}
    }
    function releaseWakeLock() {
      _wakeLockDesired = false;
      if (screenWakeLock) {
        try { screenWakeLock.release(); } catch(e) {}
        screenWakeLock = null;
      }
    }
    function hasActivePulseTimer() {
      return Boolean(
        (typeof restTimerInterval !== 'undefined' && restTimerInterval) ||
        (typeof tRunning !== 'undefined' && tRunning) ||
        (typeof inlineTimerState !== 'undefined' && inlineTimerState && inlineTimerState.running)
      );
    }
    function releaseWakeLockIfIdle() {
      if (!hasActivePulseTimer()) releaseWakeLock();
    }
    if (typeof window !== 'undefined') {
      window.requestWakeLock = requestWakeLock;
      window.releaseWakeLock = releaseWakeLock;
      window.hasActivePulseTimer = hasActivePulseTimer;
      window.releaseWakeLockIfIdle = releaseWakeLockIfIdle;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && _wakeLockDesired && !screenWakeLock) {
          requestWakeLock();
        }
      });
    }

    // ==================== VOICE COACHING PROMPTS (Web Speech API) ====================
    let voicePromptsEnabled = true;
    let cachedNaturalVoice = null;

    function getPreferredNaturalVoice() {
      if (cachedNaturalVoice) return cachedNaturalVoice;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
      try {
        const voices = window.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return null;

        // Priority 1: Cloud/network voices for en-GB or en-US (Google's neural Android voices)
        const p1 = voices.find(v => v.localService === false && /^en[-_](gb|us)/i.test(v.lang));
        if (p1) { cachedNaturalVoice = p1; return p1; }

        // Priority 2: Explicit natural/neural/network/wavenet/online/google English voices
        const p2 = voices.find(v => /natural|neural|network|wavenet|online|google/i.test(v.name) && /^en/i.test(v.lang));
        if (p2) { cachedNaturalVoice = p2; return p2; }

        // Do NOT cache Priority 3/4/fallback so onvoiceschanged can upgrade to network/neural voices once loaded
        // Priority 3: High-quality named English voices
        const p3 = voices.find(v => /samantha|daniel|serena|arthur|martha|aria|jenny|sonia|ryan|libby/i.test(v.name) && /^en/i.test(v.lang));
        if (p3) return p3;

        // Priority 4: Any en-GB or en-US voice not matching /espeak|compact|x-.*-local/i
        const p4 = voices.find(v => /^en[-_](gb|us)/i.test(v.lang) && !/espeak|compact|x-.*-local/i.test(v.name));
        if (p4) return p4;

        // Fallback: any en voice (or first available) without caching
        const fallback = voices.find(v => /^en/i.test(v.lang)) || voices[0];
        if (fallback) return fallback;
      } catch(e) {}
      return null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        cachedNaturalVoice = null;
        getPreferredNaturalVoice();
      };
    }

    function toggleVoicePrompts() {
      voicePromptsEnabled = !voicePromptsEnabled;
      beep(700, 0.08);
      const iconEl = document.getElementById('hdrVoiceIcon');
      const txtEl = document.getElementById('hdrVoiceTxt');
      const chipEl = document.getElementById('btnVoiceToggle');
      if (iconEl) iconEl.innerText = voicePromptsEnabled ? '🔊' : '🔇';
      if (txtEl) txtEl.innerText = voicePromptsEnabled ? 'VOICE' : 'MUTED';
      if (chipEl) chipEl.style.opacity = voicePromptsEnabled ? '1.0' : '0.6';
      showToast(voicePromptsEnabled ? '🔊 Voice coaching cues: ACTIVATED' : '🔇 Voice coaching cues: MUTED');
      if (voicePromptsEnabled) {
        speak("Voice cues active.");
      }
    }

    function speak(text, cancelPrior = false) {
      if (!voicePromptsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        if (cancelPrior) window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const naturalVoice = getPreferredNaturalVoice();
        if (naturalVoice) utter.voice = naturalVoice;
        utter.lang = (naturalVoice && naturalVoice.lang) ? naturalVoice.lang : 'en-GB';
        utter.rate = 1.03;
        utter.pitch = 1.02;
        utter.volume = 1.0;
        window.speechSynthesis.speak(utter);
      } catch(e) {}
    }

    function getLocalDateStr(dateObj = new Date()) {
      const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    window.getLocalDateStr = getLocalDateStr;

    // Global Frontend Error Boundary & Universal Modal UX (Escape + Backdrop Close)
    if (typeof window !== 'undefined' && !window._pulseGlobalGuardsInstalled) {
      window._pulseGlobalGuardsInstalled = true;
      window.addEventListener('error', (ev) => {
        console.error('[PULSE Runtime Error]', ev.message || ev.error);
        if (typeof showToast === 'function' && ev.message && !String(ev.message).includes('ResizeObserver')) {
          const src = ev.filename ? String(ev.filename).split('/').pop().split('?')[0] : '';
          const loc = src && ev.lineno ? ` (${src}:${ev.lineno})` : '';
          const msg = String(ev.message).replace(/^Uncaught\s+/i, '').slice(0, 90);
          showToast(`⚠️ ${msg}${loc}`);
        }
      });
      window.addEventListener('unhandledrejection', (ev) => {
        console.error('[PULSE Unhandled Promise Rejection]', ev.reason);
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          document.querySelectorAll('.modal-overlay.open').forEach((m) => {
            if (m.id !== 'pulseAuthModal') m.classList.remove('open');
          });
        }
      });
      document.addEventListener('click', (ev) => {
        const target = ev.target;
        if (target && target.classList && target.classList.contains('modal-overlay') && target.classList.contains('open')) {
          if (target.id !== 'pulseAuthModal') target.classList.remove('open');
        }
      });
    }

    // ==================== LOCAL STORAGE SESSION PERSISTENCE ====================
    let sessionLoggedSets = {};

    function saveActiveSessionToLocalStorage() {
      try {
        const payload = {
          date: getLocalDateStr(),
          preset: currentPreset,
          goal: currentGoalKey,
          currentExIdx: currentExIdx,
          plan: activeWorkoutPlan,
          sets: sessionLoggedSets,
          timestamp: Date.now()
        };
        localStorage.setItem('pulse_active_session', JSON.stringify(payload));
        const badge = document.getElementById('saveStatusIndicator');
        if (badge) badge.innerText = '💾 Auto-Saved';
      } catch(e) {}
    }

    function restoreActiveSessionFromLocalStorage() {
      try {
        const raw = localStorage.getItem('pulse_active_session');
        if (!raw) return false;
        const session = JSON.parse(raw);
        const todayStr = getLocalDateStr();
        if (session.date === todayStr && session.sets && Object.keys(session.sets).length > 0) {
          sessionLoggedSets = session.sets;
          if (session.currentExIdx !== undefined) currentExIdx = session.currentExIdx;
          showToast('🔄 Restored in-progress workout session');
          return true;
        }
      } catch(e) {}
      return false;
    }

    function resetActiveSession() {
      sessionLoggedSets = {};
      localStorage.removeItem('pulse_active_session');
      renderCurrentExercise();
      beep(450, 0.1);
      showToast('Workout session reset to fresh state');
      speak('Workout reset.');
    }

    // ==================== BI-DIRECTIONAL BACKEND SYNC & UNIVERSAL OFFLINE WRITE QUEUE ====================
    const PULSE_OFFLINE_QUEUE_KEY = 'pulse_offline_write_queue';
    const PULSE_LEGACY_SET_QUEUE_KEY = 'pulse_offline_set_queue';
    let _offlineFlushInFlight = false;
    let _offlineFlushPending = false;

    function _makeQueueItemId() {
      return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function _readOfflineQueue() {
      let queue = [];
      try {
        const raw = localStorage.getItem(PULSE_OFFLINE_QUEUE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) queue = parsed.filter(Boolean);
        }
      } catch (e) {}
      try {
        const legacyRaw = localStorage.getItem(PULSE_LEGACY_SET_QUEUE_KEY);
        if (legacyRaw) {
          const legacyParsed = JSON.parse(legacyRaw);
          if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
            legacyParsed.forEach((item) => {
              if (!item || typeof item !== 'object') return;
              queue.push({
                id: item.id || _makeQueueItemId(),
                endpoint: '/api/sync_set',
                method: 'POST',
                body: {
                  exercise_id: item.exercise_id,
                  target_weight: item.target_weight,
                  target_reps: item.target_reps,
                  logged_weight: item.logged_weight,
                  logged_reps: item.logged_reps
                },
                queued_at: item.queued_at || Date.now()
              });
            });
            localStorage.setItem(PULSE_OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-200)));
          }
          localStorage.removeItem(PULSE_LEGACY_SET_QUEUE_KEY);
        }
      } catch (e) {}
      return queue;
    }

    function enqueueOfflineWrite(endpoint, body, method = 'POST') {
      try {
        const queue = _readOfflineQueue();
        queue.push({
          id: _makeQueueItemId(),
          endpoint: endpoint,
          method: method || 'POST',
          body: body,
          queued_at: Date.now()
        });
        const capped = queue.slice(-200);
        localStorage.setItem(PULSE_OFFLINE_QUEUE_KEY, JSON.stringify(capped));
        const syncBadge = document.getElementById('saveStatusIndicator');
        if (syncBadge) syncBadge.innerText = `⏳ Queued (${capped.length})`;
        return capped.length;
      } catch (e) {
        return 0;
      }
    }
    window.enqueueOfflineWrite = enqueueOfflineWrite;

    function queueOfflineSet(payload) {
      return enqueueOfflineWrite('/api/sync_set', {
        exercise_id: payload.exercise_id,
        target_weight: payload.target_weight,
        target_reps: payload.target_reps,
        logged_weight: payload.logged_weight,
        logged_reps: payload.logged_reps
      }, 'POST');
    }
    window.queueOfflineSet = queueOfflineSet;

    async function flushOfflineQueue() {
      if (_offlineFlushInFlight) {
        _offlineFlushPending = true;
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const batch = _readOfflineQueue();
      if (!Array.isArray(batch) || batch.length === 0) return;

      _offlineFlushInFlight = true;
      const doneIds = new Set();
      let anyAttempted = false;

      try {
        for (const item of batch) {
          if (!item || !item.endpoint) {
            if (item && item.id) doneIds.add(item.id);
            continue;
          }
          anyAttempted = true;
          try {
            const res = await pulseApiFetch(item.endpoint, {
              method: item.method || 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.body || {}),
              timeoutMs: 4000,
              promptAuthOn401: false
            });
            if (res && (res.ok || res.status === 400 || res.status === 422)) {
              if (item.id) doneIds.add(item.id);
            }
          } catch (err) {
            // Retain failed transient item in queue
          }
        }

        const latestQueue = _readOfflineQueue();
        const remaining = latestQueue.filter((it) => it && !doneIds.has(it.id));

        if (remaining.length > 0) {
          localStorage.setItem(PULSE_OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
          const syncBadge = document.getElementById('saveStatusIndicator');
          if (syncBadge && anyAttempted) syncBadge.innerText = `⏳ Queued (${remaining.length})`;
        } else {
          localStorage.removeItem(PULSE_OFFLINE_QUEUE_KEY);
          const syncBadge = document.getElementById('saveStatusIndicator');
          if (syncBadge) syncBadge.innerText = '✓ Queue Synced';
          console.log('✓ Successfully flushed offline write queue to backend');
        }
      } catch (e) {
        console.log('Offline queue flush notice:', e.message);
      } finally {
        _offlineFlushInFlight = false;
        if (_offlineFlushPending) {
          _offlineFlushPending = false;
          setTimeout(() => flushOfflineQueue(), 50);
        }
      }
    }
    window.flushOfflineQueue = flushOfflineQueue;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { flushOfflineQueue(); });
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => { flushOfflineQueue(); });
      } else {
        flushOfflineQueue();
      }
    }

    async function syncSetToBackend(exId, targetW, targetR, loggedW, loggedR) {
      const payload = {
        exercise_id: exId,
        target_weight: targetW,
        target_reps: targetR,
        logged_weight: loggedW,
        logged_reps: loggedR
      };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineWrite('/api/sync_set', payload, 'POST');
        if (typeof showToast === 'function') showToast('Offline — set queued for cloud sync');
        return;
      }

      try {
        const res = await pulseApiFetch('/api/sync_set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs: 4000,
          promptAuthOn401: true
        });
        if (res && res.ok) {
          const data = await res.json();
          if ((data.success || data.status === 'success') && data.result) {
            const syncBadge = document.getElementById('saveStatusIndicator');
            if (syncBadge) syncBadge.innerText = '✓ Synced to Engine';
            console.log('✓ Synced set to StrengthAutoregulationEngine:', data.result);
          }
        } else {
          enqueueOfflineWrite('/api/sync_set', payload, 'POST');
          if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
        }
      } catch (e) {
        enqueueOfflineWrite('/api/sync_set', payload, 'POST');
        if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
        console.log('Local backend offline/remote. Set queued in pulse_offline_write_queue LocalStorage.');
      }
    }

    async function syncSessionToBackend(summary) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineWrite('/api/sync_session', summary, 'POST');
        return;
      }
      try {
        const res = await pulseApiFetch('/api/sync_session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(summary),
          timeoutMs: 4000,
          promptAuthOn401: true
        });
        if (!res || !res.ok) {
          enqueueOfflineWrite('/api/sync_session', summary, 'POST');
        }
      } catch (e) {
        enqueueOfflineWrite('/api/sync_session', summary, 'POST');
      }
    }

    // ATHLETE GOALS DATABASE
    const athleteGoals = {
      recomp: {
        id: "recomp",
        title: "15.0% Body Fat Recomposition",
        badge: "15.0% BF",
        sub: "Target: 96.92 kg • Fat to lose: 2.93 kg • 200g Protein Anchor",
        calories: 2092,
        deficit: -350,
        protein: 200,
        carbs: 251,
        fat: 80,
        strategyTitle: "Strategy: 15% Body Fat Recomposition",
        strategyDesc: "Preserving 82.38 kg Lean Body Mass with a controlled 350 kcal deficit. As training volume increases, Garmin active calories dynamically expand the daily calorie runway."
      },
      aerobic: {
        id: "aerobic",
        title: "Aerobic Engine & Zone 2 Caloric Expansion",
        badge: "ZONE 2 ENGINE",
        sub: "Target: 45m Daily Incline Walk / Ruck • Expand Daily Runway to 2,800+ kcal",
        calories: 2200,
        deficit: -350,
        protein: 200,
        carbs: 280,
        fat: 75,
        strategyTitle: "Strategy: Mitochondrial Density & Caloric Runway Expansion",
        strategyDesc: "Maximizing fat oxidation in Zone 2 (HR 105-120 bpm) to burn fat without elevating cortisol, joint fatigue, or systemic hunger."
      },
      pushups: {
        id: "pushups",
        title: "30 Unbroken Push-ups Milestone",
        badge: "30 PUSH-UPS",
        sub: "Target: 30 Consecutive Clean Reps • High Volume Push Progression",
        calories: 2442,
        deficit: 0,
        protein: 195,
        carbs: 360,
        fat: 75,
        strategyTitle: "Strategy: Push-Up Hypertrophy & Work Capacity",
        strategyDesc: "Iso-caloric intake (2,442 kcal) with elevated protein (195g) to accelerate tricep and anterior deltoid recovery between high-frequency push sessions."
      },
      rdl: {
        id: "rdl",
        title: "140kg Barbell RDL Strength PR",
        badge: "140kg RDL",
        sub: "Target: 140kg × 6 Reps • Posterior Chain Power & Glute Lockout",
        calories: 2592,
        deficit: 150,
        protein: 190,
        carbs: 380,
        fat: 80,
        strategyTitle: "Strategy: Heavy Strength CNS Priming",
        strategyDesc: "Slight 150 kcal surplus to support high central nervous system recruitment and tendon adaptation during heavy posterior loading."
      },
      work_capacity: {
        id: "work_capacity",
        title: "Zone 2 & Work Capacity Engine",
        badge: "WORK CAPACITY",
        sub: "Target: High Lactate Threshold • Speed Skipping & Slam Ball Power",
        calories: 2350,
        deficit: -100,
        protein: 185,
        carbs: 370,
        fat: 70,
        strategyTitle: "Strategy: Anaerobic Glycolytic Replenishment",
        strategyDesc: "Elevated carbohydrates (370g) for rapid muscular glycogen resynthesis between high-intensity athletic conditioning intervals."
      }
    };

    let athleteInjuries = {
      lumbar: false,
      shoulders: false,
      knees: false,
      elbows: false,
      wrists: false,
      ankles: false,
      notes: ''
    };

    let currentGoalKey = 'recomp';
    let currentPreset = 'gym';
    let currentTrainView = 'prescribed';

