    function getLocalDateStr(dateObj = new Date()) {
      const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
      const safe = isNaN(d.getTime()) ? new Date() : d;
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/London',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(safe);
      } catch (e) {
        return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, '0')}-${String(safe.getDate()).padStart(2, '0')}`;
      }
    }
    if (typeof window !== 'undefined') window.getLocalDateStr = getLocalDateStr;

    let _appToastTimer = null;
    function showToast(msg, options = {}) {
      const opts = (options && typeof options === 'object') ? options : {};
      const el = typeof document !== 'undefined' ? document.getElementById('appToast') : null;
      if (!el) return;
      if (_appToastTimer) {
        clearTimeout(_appToastTimer);
        _appToastTimer = null;
      }
      el.querySelectorAll('.toast-action-btn, .toast-msg').forEach((n) => n.remove());
      el.textContent = '';

      const msgSpan = document.createElement('span');
      msgSpan.className = 'toast-msg';
      msgSpan.textContent = String(msg || '');
      el.appendChild(msgSpan);

      if (opts.actionLabel && typeof opts.onAction === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action-btn';
        btn.textContent = String(opts.actionLabel);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          try { opts.onAction(ev); } catch (e) {}
          el.classList.remove('show');
        });
        el.appendChild(btn);
      }

      el.classList.add('show');
      const dur = opts.durationMs !== undefined ? Number(opts.durationMs) : 2800;
      if (dur !== 0) {
        _appToastTimer = setTimeout(() => {
          el.classList.remove('show');
          _appToastTimer = null;
        }, (Number.isFinite(dur) && dur > 0) ? dur : 2800);
      }
    }
    if (typeof window !== 'undefined') window.showToast = showToast;

    function _withPreservedDetails(fn) {
      const openState = new Map();
      if (typeof document !== 'undefined' && document.querySelectorAll) {
        document.querySelectorAll('details[data-details-key]').forEach((d) => {
          const k = d.getAttribute('data-details-key');
          if (k) openState.set(k, Boolean(d.open));
        });
      }
      try {
        return typeof fn === 'function' ? fn() : undefined;
      } finally {
        if (typeof document !== 'undefined' && document.querySelectorAll && openState.size > 0) {
          document.querySelectorAll('details[data-details-key]').forEach((d) => {
            const k = d.getAttribute('data-details-key');
            if (k && openState.has(k)) d.open = openState.get(k);
          });
        }
      }
    }
    if (typeof window !== 'undefined') window._withPreservedDetails = _withPreservedDetails;

    window.BAKED_LIVE_STATE = {
      last_synced: null,
      date: null,
      athlete: { name: "Athlete", age: null, height_cm: null, weight_kg: null, body_fat_pct: null, target_body_fat_pct: 15.0, lean_mass_kg: null, muscle_mass_kg: null, fat_to_lose_kg: null, target_weight_kg: null },
      garmin: { device: "Garmin Wearable", today_activities: [], recent_activities: [], steps: 0, active_calories: 0 },
      renpho: {},
      nutrition: { base_calorie_target: 2092, calorie_target: 2092, deficit: 350, base_protein_target_g: 200, protein_target_g: 200, carbs_target_g: 200, fat_target_g: 55 },
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
      const _todayIso = getLocalDateStr();
      const _cachedBurnRaw = localStorage.getItem('pulse_inapp_burn_today');
      if (_cachedBurnRaw) {
        try {
          const _parsedBurn = JSON.parse(_cachedBurnRaw);
          if (Array.isArray(_parsedBurn)) {
            const _keptBurn = _parsedBurn.filter((it) => it && typeof it === 'object' && it.date === _todayIso);
            if (_keptBurn.length > 0) localStorage.setItem('pulse_inapp_burn_today', JSON.stringify(_keptBurn));
            else localStorage.removeItem('pulse_inapp_burn_today');
          } else if (_parsedBurn && typeof _parsedBurn === 'object' && _parsedBurn.date !== _todayIso) {
            localStorage.removeItem('pulse_inapp_burn_today');
          }
        } catch (be) {}
      }
      const _cachedLiveRaw = localStorage.getItem('pulse_cached_live_state');
      if (_cachedLiveRaw) {
        const _cachedLiveParsed = JSON.parse(_cachedLiveRaw);
        if (_cachedLiveParsed && typeof _cachedLiveParsed === 'object' && !Array.isArray(_cachedLiveParsed)) {
          if (_cachedLiveParsed.date && _cachedLiveParsed.date !== _todayIso) {
            const _cachedGarmin = (_cachedLiveParsed.garmin && typeof _cachedLiveParsed.garmin === 'object') ? _cachedLiveParsed.garmin : {};
            const _prevNut = (_cachedLiveParsed.nutrition && typeof _cachedLiveParsed.nutrition === 'object') ? _cachedLiveParsed.nutrition : window.BAKED_LIVE_STATE.nutrition;
            const _baseCal = Number(_prevNut.base_calorie_target || _prevNut.calorie_target || 2092) || 2092;
            const _baseProt = Number(_prevNut.base_protein_target_g || _prevNut.protein_target_g || 200) || 200;
            window.BAKED_LIVE_STATE = {
              ...window.BAKED_LIVE_STATE,
              last_synced: _cachedLiveParsed.last_synced || null,
              date: _todayIso,
              athlete: (_cachedLiveParsed.athlete && typeof _cachedLiveParsed.athlete === 'object') ? _cachedLiveParsed.athlete : window.BAKED_LIVE_STATE.athlete,
              renpho: (_cachedLiveParsed.renpho && typeof _cachedLiveParsed.renpho === 'object') ? _cachedLiveParsed.renpho : window.BAKED_LIVE_STATE.renpho,
              nutrition: {
                ..._prevNut,
                base_calorie_target: _baseCal,
                calorie_target: _baseCal,
                calories_remaining: _baseCal,
                base_protein_target_g: _baseProt,
                protein_target_g: _baseProt,
                protein_remaining: _baseProt,
                flex_active: null
              },
              strength_prescriptions: (_cachedLiveParsed.strength_prescriptions && typeof _cachedLiveParsed.strength_prescriptions === 'object') ? _cachedLiveParsed.strength_prescriptions : window.BAKED_LIVE_STATE.strength_prescriptions,
              mnd_history: (_cachedLiveParsed.mnd_history && typeof _cachedLiveParsed.mnd_history === 'object') ? _cachedLiveParsed.mnd_history : window.BAKED_LIVE_STATE.mnd_history,
              injuries: (_cachedLiveParsed.injuries && typeof _cachedLiveParsed.injuries === 'object') ? _cachedLiveParsed.injuries : window.BAKED_LIVE_STATE.injuries,
              garmin: {
                ...window.BAKED_LIVE_STATE.garmin,
                ..._cachedGarmin,
                steps: 0,
                active_calories: 0,
                inapp_burn_today: 0,
                today_activities: [],
                sleep_score: null,
                sleep_duration: null,
                body_battery: null,
                training_readiness: null,
                mnd_logged: null,
                mnd_meals: null,
                oauth_date: null,
                oauth_failed_at: null
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
    window.PULSE_ANALYTICS_SUMMARY = null;
    window._pulsePrefTimers = {};

    const PULSE_PREF_MAP = {
      goal_key: { lsKey: 'pulse_current_goal', json: false },
      custom_goal_macros: { lsKey: 'pulse_custom_goal_macros', json: true },
      diet_strategy: { lsKey: 'pulse_diet_strategy', json: false },
      carb_cycle_level: { lsKey: 'pulse_carb_cycle_level', json: false },
      fasting_protocol: { lsKey: 'pulse_fasting_protocol', json: false },
      fasting_timer_state: { lsKey: 'pulse_fasting_timer_state', json: true },
      equipment_profile: { lsKey: 'pulse_equipment_profile', json: true },
      conditioning_progression: { lsKey: 'pulse_conditioning_progression', json: true },
      pro_dial_macros: { lsKey: 'pulse_pro_dial_macros', json: true }
    };
    const PULSE_PREF_TIMESTAMPS_KEY = 'pulse_pref_timestamps_v1';

    function _readPrefTimestamps() {
      try {
        const raw = localStorage.getItem(PULSE_PREF_TIMESTAMPS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        }
      } catch (e) {}
      return {};
    }

    function _writePrefTimestamps(map) {
      try {
        localStorage.setItem(PULSE_PREF_TIMESTAMPS_KEY, JSON.stringify(map || {}));
      } catch (e) {}
    }

    function _readLocalPrefValue(key) {
      const spec = PULSE_PREF_MAP[key];
      if (!spec) return undefined;
      try {
        const raw = localStorage.getItem(spec.lsKey);
        if (raw === null || raw === undefined) return undefined;
        return spec.json ? JSON.parse(raw) : raw;
      } catch (e) {
        return undefined;
      }
    }

    function _writeLocalPrefValue(key, val) {
      const spec = PULSE_PREF_MAP[key];
      if (!spec || val === undefined || val === null) return;
      try {
        localStorage.setItem(spec.lsKey, spec.json ? JSON.stringify(val) : String(val));
      } catch (e) {}
    }

    function _getQueuedPrefKeys() {
      const queued = new Set();
      try {
        const queue = _readOfflineQueue();
        queue.forEach((it) => {
          if (it && it.endpoint === '/api/preferences/state' && it.body && it.body.fields && typeof it.body.fields === 'object') {
            Object.keys(it.body.fields).forEach((k) => queued.add(k));
          }
        });
      } catch (e) {}
      return queued;
    }

    function _applyHydratedPrefToUi(key, val, opts = { fromBoot: true }) {
      const callOpts = (opts && typeof opts === 'object') ? { fromBoot: true, ...opts } : { fromBoot: true };
      try {
        if (key === 'custom_goal_macros' && typeof setCustomGoalMacros === 'function') {
          setCustomGoalMacros(val, callOpts);
        } else if (key === 'goal_key' && typeof selectGoal === 'function') {
          selectGoal(val, callOpts);
        } else if (key === 'pro_dial_macros') {
          if (val && typeof val === 'object') {
            const pSlider = typeof document !== 'undefined' ? document.getElementById('sliderProtein') : null;
            const fSlider = typeof document !== 'undefined' ? document.getElementById('sliderFat') : null;
            if (pSlider && val.protein !== undefined) pSlider.value = String(val.protein);
            if (fSlider && val.fat_pct !== undefined) fSlider.value = String(val.fat_pct);
            if (typeof updateProDial === 'function') updateProDial(callOpts);
            if (typeof renderMyNetDiaryEngine === 'function') renderMyNetDiaryEngine();
          }
        } else if (key === 'diet_strategy' && typeof selectDietStrategy === 'function') {
          selectDietStrategy(val, callOpts);
        } else if (key === 'carb_cycle_level' && typeof setCarbCycleLevel === 'function') {
          setCarbCycleLevel(val, callOpts);
        } else if (key === 'fasting_protocol' && typeof setFastingProtocol === 'function') {
          setFastingProtocol(val, callOpts);
        } else if (key === 'fasting_timer_state' && typeof initFastingTimer === 'function') {
          initFastingTimer();
        } else if (key === 'equipment_profile' && typeof applyEquipmentProfile === 'function') {
          applyEquipmentProfile(val, callOpts);
        } else if (key === 'conditioning_progression' && typeof renderCurrentExercise === 'function') {
          renderCurrentExercise();
        }
      } catch (e) {}
    }

    let _pendingPrefFields = {};
    let _prefDebounceTimer = null;
    let _prefFlushChain = Promise.resolve(null);

    async function _flushPendingPrefPatch(immediateFields = null) {
      const runFlush = async () => {
        const patchFields = immediateFields ? { ..._pendingPrefFields, ...immediateFields } : { ..._pendingPrefFields };
        _pendingPrefFields = {};
        const keys = Object.keys(patchFields);
        if (keys.length === 0) return null;

        const payload = { fields: patchFields };
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          enqueueOfflineWrite('/api/preferences/state', payload, 'POST');
          return null;
        }

        try {
          const res = await pulseApiFetch('/api/preferences/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeoutMs: 4000,
            promptAuthOn401: false
          });
          if (!res || !res.ok) {
            if (_shouldQueueOfflineResponse(res)) {
              enqueueOfflineWrite('/api/preferences/state', payload, 'POST');
            }
            return null;
          }
          const data = await res.json();
          const serverFields = (data && data.preferences && data.preferences.fields) ? data.preferences.fields : {};
          const resolutions = (data && data.field_resolutions) ? data.field_resolutions : {};
          const tsMap = _readPrefTimestamps();
          let anyUpdated = false;
          Object.entries(resolutions).forEach(([k, status]) => {
            if (status === 'server_newer' && serverFields[k] && serverFields[k].value !== undefined) {
              _writeLocalPrefValue(k, serverFields[k].value);
              tsMap[k] = Number(serverFields[k].updated_at_ms) || Date.now();
              _applyHydratedPrefToUi(k, serverFields[k].value, { fromBoot: true });
              anyUpdated = true;
            }
          });
          if (anyUpdated) _writePrefTimestamps(tsMap);
          return data;
        } catch (e) {
          enqueueOfflineWrite('/api/preferences/state', payload, 'POST');
          return null;
        }
      };
      _prefFlushChain = _prefFlushChain.then(runFlush, runFlush);
      return _prefFlushChain;
    }

    function syncClientPreferencesToCloud(fieldKeyOrMap, immediate = false) {
      const tsMap = _readPrefTimestamps();
      const nowMs = Date.now();
      const patch = {};

      if (typeof fieldKeyOrMap === 'string') {
        if (PULSE_PREF_MAP[fieldKeyOrMap]) {
          const val = _readLocalPrefValue(fieldKeyOrMap);
          if (val !== undefined) {
            tsMap[fieldKeyOrMap] = nowMs;
            patch[fieldKeyOrMap] = { value: val, updated_at_ms: nowMs };
          }
        }
      } else if (fieldKeyOrMap && typeof fieldKeyOrMap === 'object') {
        Object.entries(fieldKeyOrMap).forEach(([k, v]) => {
          if (!PULSE_PREF_MAP[k] || v === undefined) return;
          if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value') && Object.prototype.hasOwnProperty.call(v, 'updated_at_ms')) {
            patch[k] = { value: v.value, updated_at_ms: Number(v.updated_at_ms) || nowMs };
            tsMap[k] = patch[k].updated_at_ms;
          } else {
            _writeLocalPrefValue(k, v);
            tsMap[k] = nowMs;
            patch[k] = { value: v, updated_at_ms: nowMs };
          }
        });
      }

      if (Object.keys(patch).length === 0) return Promise.resolve(null);
      _writePrefTimestamps(tsMap);

      if (immediate) {
        if (_prefDebounceTimer) {
          clearTimeout(_prefDebounceTimer);
          _prefDebounceTimer = null;
        }
        return _flushPendingPrefPatch(patch);
      }
      Object.assign(_pendingPrefFields, patch);
      if (_prefDebounceTimer) clearTimeout(_prefDebounceTimer);
      _prefDebounceTimer = setTimeout(() => {
        _prefDebounceTimer = null;
        _flushPendingPrefPatch();
      }, 800);
      return Promise.resolve(null);
    }
    window.syncClientPreferencesToCloud = syncClientPreferencesToCloud;

    async function hydrateClientPreferencesFromCloud() {
      const queuedKeys = _getQueuedPrefKeys();
      try {
        const res = await pulseApiFetch('/api/preferences/state', {
          cache: 'no-store',
          timeoutMs: 5000,
          promptAuthOn401: false
        });
        if (!res || !res.ok) return null;
        const data = await res.json();
        const serverFields = (data && data.preferences && data.preferences.fields) ? data.preferences.fields : {};
        const tsMap = _readPrefTimestamps();
        const locallyNewer = {};
        let tsChanged = false;

        // Apply custom_goal_macros before goal_key and pro_dial_macros before diet_strategy
        const orderedKeys = [
          'custom_goal_macros',
          'pro_dial_macros',
          ...Object.keys(PULSE_PREF_MAP).filter((k) => k !== 'custom_goal_macros' && k !== 'pro_dial_macros')
        ];

        const nowMs = Date.now();
        orderedKeys.forEach((k) => {
          if (queuedKeys.has(k) || Object.prototype.hasOwnProperty.call(_pendingPrefFields, k)) return;
          const srv = serverFields[k];
          const srvTs = (srv && typeof srv === 'object') ? (Number(srv.updated_at_ms) || 0) : 0;
          const localVal = _readLocalPrefValue(k);
          const localTs = Number(tsMap[k]) || 0;

          if (srv && srv.value !== undefined && (srvTs > localTs || localVal === undefined)) {
            _writeLocalPrefValue(k, srv.value);
            tsMap[k] = srvTs || nowMs;
            tsChanged = true;
            _applyHydratedPrefToUi(k, srv.value, { fromBoot: true });
          } else if (localVal !== undefined && (localTs > srvTs || (srv === undefined && localTs === 0))) {
            const effTs = localTs > 0 ? localTs : nowMs;
            tsMap[k] = effTs;
            tsChanged = true;
            locallyNewer[k] = { value: localVal, updated_at_ms: effTs };
          }
        });

        if (tsChanged) _writePrefTimestamps(tsMap);
        if (Object.keys(locallyNewer).length > 0) {
          syncClientPreferencesToCloud(locallyNewer, true);
        }
        return data;
      } catch (e) {
        return null;
      }
    }
    window.hydrateClientPreferencesFromCloud = hydrateClientPreferencesFromCloud;

    function _purgeClientTelemetryCaches() {
      try {
        localStorage.removeItem('pulse_cached_live_state');
        localStorage.removeItem('pulse_analytics_summary_cache');
        localStorage.removeItem('pulse_garmin_today_backup');
      } catch (e) {}
      try {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'PULSE_PURGE_API_CACHE' });
        }
      } catch (e) {}
      try {
        if (typeof caches !== 'undefined' && caches.keys) {
          caches.keys().then((keys) =>
            Promise.all(
              keys.map((k) =>
                caches.open(k).then((cache) =>
                  cache.keys().then((reqs) =>
                    Promise.all(
                      reqs
                        .filter((r) => {
                          try { return new URL(r.url).pathname.startsWith('/api/'); } catch (e) { return false; }
                        })
                        .map((r) => cache.delete(r))
                    )
                  )
                )
              )
            )
          ).catch(() => {});
        }
      } catch (e) {}
    }

    async function logoutPulseSession() {
      _purgeClientTelemetryCaches();
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      if (typeof showToast === 'function') showToast('Signed out — local cache cleared');
    }
    window.logoutPulseSession = logoutPulseSession;

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
            _purgeClientTelemetryCaches();
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
              if (typeof hydrateClientPreferencesFromCloud === 'function') setTimeout(() => hydrateClientPreferencesFromCloud(), 100);
              if (typeof fetchAnalyticsSummary === 'function') setTimeout(() => fetchAnalyticsSummary(true), 150);
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
                if (typeof hydrateClientPreferencesFromCloud === 'function') setTimeout(() => hydrateClientPreferencesFromCloud(), 100);
                if (typeof fetchAnalyticsSummary === 'function') setTimeout(() => fetchAnalyticsSummary(true), 150);
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
    function _readTodayInAppBurnEntries(todayIsoOverride) {
      const todayIso = todayIsoOverride || getLocalDateStr();
      try {
        const rawBurn = localStorage.getItem('pulse_inapp_burn_today');
        if (!rawBurn) return [];
        const parsed = JSON.parse(rawBurn);
        if (Array.isArray(parsed)) {
          return parsed.filter((it) => it && typeof it === 'object' && it.date === todayIso && (Number(it.calories) || 0) > 0);
        }
        if (parsed && typeof parsed === 'object' && parsed.date === todayIso) {
          const c = Number(parsed.calories !== undefined ? parsed.calories : parsed.kcal) || 0;
          if (c > 0) {
            return [{ id: parsed.id || `legacy_${todayIso}`, date: todayIso, calories: c, kind: parsed.kind || 'legacy' }];
          }
        }
      } catch (e) {}
      return [];
    }

    function _appendInAppBurnEntry(idOrObj, calories, kind = 'conditioning', dateStr = null) {
      let id = idOrObj;
      let rawCals = calories;
      let rawKind = kind;
      let rawDate = dateStr;
      if (idOrObj && typeof idOrObj === 'object' && !Array.isArray(idOrObj)) {
        id = idOrObj.id;
        rawCals = idOrObj.calories;
        rawKind = idOrObj.kind || 'conditioning';
        rawDate = idOrObj.date || null;
      }
      const cals = Math.max(0, Math.round(Number(rawCals) || 0));
      if (cals <= 0) return [];
      const todayIso = rawDate || getLocalDateStr();
      const entryId = String(id || _makeQueueItemId());
      const entries = _readTodayInAppBurnEntries(todayIso);
      const rec = { id: entryId, date: todayIso, calories: cals, kind: String(rawKind || 'conditioning') };
      const idx = entries.findIndex((it) => String(it.id) === entryId);
      if (idx >= 0) entries[idx] = rec;
      else entries.push(rec);
      try {
        localStorage.setItem('pulse_inapp_burn_today', JSON.stringify(entries));
      } catch (e) {}
      return entries;
    }

    function getTodayInAppBurn(garminOverride) {
      let inAppBurn = 0;
      const todayIso = getLocalDateStr();
      const entries = _readTodayInAppBurnEntries(todayIso);

      try {
        const g = garminOverride || (window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin) || null;
        const todayActs = (g && Array.isArray(g.today_activities)) ? g.today_activities : [];
        const syncedIds = new Set();
        todayActs.forEach((a) => {
          if (!a || typeof a !== 'object') return;
          if (a.id !== undefined && a.id !== null) syncedIds.add(String(a.id));
          if (a.client_event_id !== undefined && a.client_event_id !== null) syncedIds.add(String(a.client_event_id));
        });
        const hasGarminStrength = Boolean(
          g && g.source === 'garmin_oauth' && todayActs.some((a) => {
            const name = (a.name || '').toLowerCase();
            const key = (a.activity_type_key || '').toLowerCase();
            return name.includes('strength') || key.includes('strength');
          })
        );
        entries.forEach((entry) => {
          if (syncedIds.has(String(entry.id))) return;
          if (hasGarminStrength && (entry.kind === 'strength' || entry.kind === 'legacy')) return;
          inAppBurn += Number(entry.calories) || 0;
        });
      } catch (e) {}
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
      window._appendInAppBurnEntry = _appendInAppBurnEntry;
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
            if (m.id !== 'pulseAuthModal') {
              m.classList.remove('open');
              if (m.id === 'injuryModal') {
                if (typeof window.stopVoiceDictation === 'function') window.stopVoiceDictation(true);
                if (typeof window.cancelPendingDiagnostics === 'function') window.cancelPendingDiagnostics();
              }
            }
          });
        }
      });
      document.addEventListener('click', (ev) => {
        const target = ev.target;
        if (target && target.classList && target.classList.contains('modal-overlay') && target.classList.contains('open')) {
          if (target.id !== 'pulseAuthModal') {
            target.classList.remove('open');
            if (target.id === 'injuryModal') {
              if (typeof window.stopVoiceDictation === 'function') window.stopVoiceDictation(true);
              if (typeof window.cancelPendingDiagnostics === 'function') window.cancelPendingDiagnostics();
            }
          }
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
          currentArchetypeKey: typeof currentArchetypeKey !== 'undefined' ? currentArchetypeKey : null,
          currentSessionFocus: typeof currentSessionFocus !== 'undefined' ? currentSessionFocus : null,
          kbSubMode: typeof kbSubMode !== 'undefined' ? kbSubMode : null,
          activeSessionMeta: typeof activeSessionMeta !== 'undefined' ? activeSessionMeta : null,
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
        if (session && session.date === todayStr && Array.isArray(session.plan) && session.plan.length > 0) {
          const cleanPlan = session.plan.filter((item) => item && typeof item === 'object' && item.id);
          if (cleanPlan.length === 0) {
            try { localStorage.removeItem('pulse_active_session'); } catch (rmErr) {}
            return false;
          }
          let restoredPlan = cleanPlan;
          if (typeof applyJointSafeSwaps === 'function') {
            const gear = (typeof gearConfig !== 'undefined') ? gearConfig : null;
            restoredPlan = applyJointSafeSwaps(cleanPlan, cleanPlan.length, athleteInjuries, gear);
          }
          if (!Array.isArray(restoredPlan) || restoredPlan.length === 0) {
            try { localStorage.removeItem('pulse_active_session'); } catch (rmErr) {}
            return false;
          }
          activeWorkoutPlan = restoredPlan;
          sessionLoggedSets = (session.sets && typeof session.sets === 'object' && !Array.isArray(session.sets)) ? session.sets : {};
          if (session.preset) currentPreset = session.preset;
          if (session.goal) currentGoalKey = session.goal;
          if (session.currentArchetypeKey && typeof currentArchetypeKey !== 'undefined') currentArchetypeKey = session.currentArchetypeKey;
          if (session.currentSessionFocus !== undefined && typeof currentSessionFocus !== 'undefined') currentSessionFocus = session.currentSessionFocus;
          if (session.kbSubMode && typeof kbSubMode !== 'undefined') kbSubMode = session.kbSubMode;
          if (session.activeSessionMeta !== undefined && typeof activeSessionMeta !== 'undefined') activeSessionMeta = session.activeSessionMeta;
          const rawIdx = Number(session.currentExIdx);
          currentExIdx = Number.isFinite(rawIdx) ? Math.max(0, Math.min(Math.round(rawIdx), activeWorkoutPlan.length - 1)) : 0;
          if (typeof window !== 'undefined') window._userManualArchetype = true;
          showToast('🔄 Restored in-progress workout session');
          return true;
        }
      } catch(e) {}
      return false;
    }

    function readTodayExerciseSwaps() {
      const todayIso = getLocalDateStr();
      try {
        const raw = localStorage.getItem('pulse_today_exercise_swaps');
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.date && parsed.date === todayIso && parsed.swaps && typeof parsed.swaps === 'object') {
            return parsed.swaps;
          }
          if (!parsed.date) {
            localStorage.removeItem('pulse_today_exercise_swaps');
            return {};
          }
          if (parsed.date !== todayIso) {
            localStorage.removeItem('pulse_today_exercise_swaps');
            return {};
          }
        }
      } catch (e) {}
      return {};
    }

    function writeTodayExerciseSwaps(swapsMap) {
      try {
        localStorage.setItem('pulse_today_exercise_swaps', JSON.stringify({
          date: getLocalDateStr(),
          swaps: (swapsMap && typeof swapsMap === 'object') ? swapsMap : {}
        }));
      } catch (e) {}
    }
    if (typeof window !== 'undefined') {
      window.readTodayExerciseSwaps = readTodayExerciseSwaps;
      window.writeTodayExerciseSwaps = writeTodayExerciseSwaps;
    }

    function resetActiveSession() {
      if (typeof stopInlineTimer === 'function') stopInlineTimer();
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
    const PULSE_QUEUE_TTL_MS = 72 * 3600 * 1000;
    const PULSE_QUEUE_MAX_ATTEMPTS = 10;
    let _offlineFlushInFlight = false;
    let _offlineFlushPending = false;

    function _shouldQueueOfflineResponse(res) {
      if (!res) return true;
      if (res.ok) return false;
      const st = Number(res.status) || 0;
      return st === 0 || st >= 500 || st === 401 || st === 408 || st === 429;
    }
    if (typeof window !== 'undefined') window._shouldQueueOfflineResponse = _shouldQueueOfflineResponse;

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
              const qId = item.id || _makeQueueItemId();
              queue.push({
                id: qId,
                endpoint: '/api/sync_set',
                method: 'POST',
                body: {
                  exercise_id: item.exercise_id,
                  target_weight: item.target_weight,
                  target_reps: item.target_reps,
                  logged_weight: item.logged_weight,
                  logged_reps: item.logged_reps,
                  client_event_id: qId,
                  client_date: getLocalDateStr()
                },
                queued_at: item.queued_at || Date.now(),
                attempts: Number(item.attempts) || 0
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
        const itemId = _makeQueueItemId();
        const preparedBody = (body && typeof body === 'object' && !Array.isArray(body)) ? { ...body } : {};
        if (endpoint !== '/api/preferences/state') {
          if (!preparedBody.client_event_id && !preparedBody.id) {
            preparedBody.client_event_id = itemId;
          }
          if (!preparedBody.date && !preparedBody.client_date) {
            preparedBody.client_date = getLocalDateStr();
          }
        }
        queue.push({
          id: itemId,
          endpoint: endpoint,
          method: method || 'POST',
          body: preparedBody,
          queued_at: Date.now(),
          attempts: 0
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
        logged_reps: payload.logged_reps,
        client_event_id: payload.client_event_id
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
      const updatedAttempts = new Map();
      let anyAttempted = false;
      const nowMs = Date.now();

      try {
        for (const item of batch) {
          if (!item || !item.endpoint) {
            if (item && item.id) doneIds.add(item.id);
            continue;
          }
          const queuedAt = Number(item.queued_at) || 0;
          const prevAttempts = Number(item.attempts) || 0;
          if ((queuedAt > 0 && (nowMs - queuedAt) > PULSE_QUEUE_TTL_MS) || prevAttempts >= PULSE_QUEUE_MAX_ATTEMPTS) {
            if (item.id) doneIds.add(item.id);
            continue;
          }
          anyAttempted = true;
          const nextAttempts = prevAttempts + 1;
          updatedAttempts.set(item.id, nextAttempts);
          try {
            const res = await pulseApiFetch(item.endpoint, {
              method: item.method || 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.body || {}),
              timeoutMs: 4000,
              promptAuthOn401: false
            });
            if (!res) break;
            if (res.ok) {
              if (item.id) doneIds.add(item.id);
            } else if (res.status === 401 || res.status === 0) {
              break;
            } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
              if (item.id) doneIds.add(item.id);
            } else if (nextAttempts >= PULSE_QUEUE_MAX_ATTEMPTS) {
              if (item.id) doneIds.add(item.id);
            }
          } catch (err) {
            // Network dropout / abort: stop loop immediately instead of exhausting remaining queue items
            break;
          }
        }

        const latestQueue = _readOfflineQueue();
        const remaining = latestQueue
          .filter((it) => it && !doneIds.has(it.id))
          .map((it) => (updatedAttempts.has(it.id) ? { ...it, attempts: updatedAttempts.get(it.id) } : it));

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

    async function syncSetToBackend(exId, targetW, targetR, loggedW, loggedR, opts = {}) {
      const eventId = _makeQueueItemId();
      const payload = {
        exercise_id: exId,
        target_weight: targetW,
        target_reps: targetR,
        logged_weight: loggedW,
        logged_reps: loggedR,
        client_event_id: eventId,
        client_date: getLocalDateStr()
      };
      if (opts && typeof opts.isWarmup === 'boolean') {
        payload.is_warmup = opts.isWarmup;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineWrite('/api/sync_set', payload, 'POST');
        if (typeof showToast === 'function') showToast('Offline — set queued for cloud sync');
        return { ok: false, queued: true };
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
            return { ok: true, result: data.result };
          }
          return { ok: true, result: data && data.result ? data.result : null };
        }
        if (!_shouldQueueOfflineResponse(res)) {
          if (typeof showToast === 'function') showToast('Invalid set values — check weight & reps');
          return { ok: false, queued: false, status: res ? res.status : 0 };
        }
        enqueueOfflineWrite('/api/sync_set', payload, 'POST');
        if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
        return { ok: false, queued: true };
      } catch (e) {
        enqueueOfflineWrite('/api/sync_set', payload, 'POST');
        if (typeof showToast === 'function') showToast('Saved locally — queued for cloud sync');
        console.log('Local backend offline/remote. Set queued in pulse_offline_write_queue LocalStorage.');
        return { ok: false, queued: true };
      }
    }

    async function syncSessionToBackend(summary) {
      const payload = (summary && typeof summary === 'object') ? { ...summary } : {};
      if (!payload.client_event_id && !payload.id) payload.client_event_id = _makeQueueItemId();
      if (!payload.date && !payload.client_date) payload.client_date = getLocalDateStr();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineWrite('/api/sync_session', payload, 'POST');
        return;
      }
      try {
        const res = await pulseApiFetch('/api/sync_session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs: 4000,
          promptAuthOn401: true
        });
        if (!res || (!res.ok && _shouldQueueOfflineResponse(res))) {
          enqueueOfflineWrite('/api/sync_session', payload, 'POST');
        }
      } catch (e) {
        enqueueOfflineWrite('/api/sync_session', payload, 'POST');
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
      notes: '',
      chronic_profile: {},
      active_constraints: {},
      last_diagnostic_summary: null,
      updated_at_ms: 0
    };

    let currentGoalKey = 'recomp';
    let currentPreset = 'gym';
    let currentTrainView = 'prescribed';

