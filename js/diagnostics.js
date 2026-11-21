    // ==================== AI INJURY DIAGNOSTICS, VOICE DICTATION & ADAPTOR BRIDGE ====================
    let _diagInputMode = 'text';
    let _diagTranscriptEdited = false;
    let _diagTranscriptCaptured = false;
    let _diagProgrammaticInput = false;
    let _diagPainSeverity = null;
    let _diagOnsetType = 'unknown';

    let _voiceState = 'idle'; // 'idle' | 'listening'
    let _voiceRec = null;
    let _voiceTimeoutId = null;
    let _diagAbortCtrl = null;
    let _diagLifecycleBound = false;

    const _DIAG_JOINTS = ['lumbar', 'shoulders', 'knees', 'elbows', 'wrists', 'ankles'];
    const _DIAG_JOINT_LABELS = {
      lumbar: 'Lower Back / Lumbar',
      shoulders: 'Shoulder / Rotator',
      knees: 'Knee / Patellar',
      elbows: 'Elbow / Tendon',
      wrists: 'Wrist / Forearm',
      ankles: 'Ankle / Achilles'
    };

    function _escDiag(v) {
      return (typeof escapeHtml === 'function') ? escapeHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _setDiagInputMode(mode, edited = false) {
      _diagInputMode = mode || 'text';
      _diagTranscriptEdited = Boolean(edited);
      _diagTranscriptCaptured = (_diagInputMode === 'voice' || _diagInputMode === 'voice_edited');
    }

    function _isVoiceRecognitionSupported() {
      if (typeof window === 'undefined') return false;
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
      return Boolean(Rec && window.isSecureContext !== false);
    }

    function _renderVoiceUi() {
      const btn = typeof document !== 'undefined' ? document.getElementById('btnDiagVoiceMic') : null;
      const interimEl = typeof document !== 'undefined' ? document.getElementById('diagVoiceInterim') : null;
      const supported = _isVoiceRecognitionSupported();
      if (btn) {
        btn.disabled = !supported;
        btn.setAttribute('aria-disabled', supported ? 'false' : 'true');
        btn.setAttribute('aria-pressed', _voiceState === 'listening' ? 'true' : 'false');
        btn.classList.toggle('is-listening', _voiceState === 'listening');
        const labelEl = btn.querySelector('.diag-mic-label');
        if (labelEl) {
          labelEl.textContent = _voiceState === 'listening' ? 'Stop Dictation' : (supported ? 'Dictate' : 'Mic N/A');
        }
      }
      if (interimEl) {
        interimEl.style.display = _voiceState === 'listening' ? 'flex' : 'none';
      }
    }

    function _setVoiceStatus(msg, tone = 'muted') {
      const el = typeof document !== 'undefined' ? document.getElementById('diagVoiceStatus') : null;
      if (!el) return;
      if (!msg) {
        el.style.display = 'none';
        el.textContent = '';
        el.className = 'diag-voice-status';
        return;
      }
      el.style.display = 'block';
      el.textContent = String(msg);
      el.className = `diag-voice-status tone-${tone}`;
    }

    function initDiagnosticsUi() {
      const notesEl = typeof document !== 'undefined' ? document.getElementById('injuryNotesInput') : null;
      if (notesEl && !notesEl._diagBound) {
        notesEl._diagBound = true;
        notesEl.addEventListener('input', () => {
          if (_diagProgrammaticInput) return;
          if (_diagInputMode === 'voice' || _diagTranscriptCaptured) {
            _diagInputMode = 'voice_edited';
            _diagTranscriptEdited = true;
          } else if (_diagInputMode === 'chip') {
            _diagInputMode = 'text';
          }
        });
      }
      if (!_diagLifecycleBound && typeof document !== 'undefined' && typeof window !== 'undefined') {
        _diagLifecycleBound = true;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') stopVoiceDictation(true);
        });
        window.addEventListener('beforeunload', () => {
          stopVoiceDictation(true);
        });
      }
      if (!_isVoiceRecognitionSupported()) {
        _setVoiceStatus('Voice dictation unavailable here — type symptoms or tap a chip.', 'muted');
      }
      _renderVoiceUi();
      renderChronicProfileControls();
    }

    function stopVoiceDictation(abortNow = false) {
      if (_voiceTimeoutId) {
        clearTimeout(_voiceTimeoutId);
        _voiceTimeoutId = null;
      }
      const rec = _voiceRec;
      _voiceRec = null;
      _voiceState = 'idle';
      if (rec) {
        try {
          if (abortNow && typeof rec.abort === 'function') rec.abort();
          else if (typeof rec.stop === 'function') rec.stop();
        } catch (e) {}
      }
      const interimTxt = typeof document !== 'undefined' ? document.getElementById('diagVoiceInterimText') : null;
      if (interimTxt) interimTxt.textContent = '';
      _renderVoiceUi();
    }

    function startVoiceDictation() {
      if (!_isVoiceRecognitionSupported()) {
        _setVoiceStatus('Voice dictation unsupported in this browser — type symptoms below.', 'muted');
        _renderVoiceUi();
        return;
      }
      stopVoiceDictation(true);
      try {
        if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
          window.speechSynthesis.cancel();
        }
      } catch (e) {}

      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      let rec;
      try {
        rec = new SpeechRec();
      } catch (e) {
        _setVoiceStatus('Could not initialize speech recognizer — type symptoms below.', 'warn');
        return;
      }
      const navLang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : '';
      rec.lang = /^en/i.test(navLang) ? navLang : 'en-GB';
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      _voiceRec = rec;
      _voiceState = 'listening';
      _renderVoiceUi();
      _setVoiceStatus('Listening… describe joint, side, and triggering exercise.', 'info');

      _voiceTimeoutId = setTimeout(() => {
        if (_voiceRec === rec) stopVoiceDictation(false);
      }, 45000);

      rec.onresult = (ev) => {
        if (_voiceRec !== rec) return;
        let interim = '';
        let finalChunk = '';
        const resList = (ev && ev.results) ? ev.results : [];
        for (let i = (ev && typeof ev.resultIndex === 'number' ? ev.resultIndex : 0); i < resList.length; i++) {
          const item = resList[i];
          const txt = (item && item[0] && item[0].transcript) ? String(item[0].transcript).trim() : '';
          if (!txt) continue;
          if (item.isFinal) finalChunk += (finalChunk ? ' ' : '') + txt;
          else interim += (interim ? ' ' : '') + txt;
        }
        const interimEl = document.getElementById('diagVoiceInterimText');
        if (interimEl) interimEl.textContent = interim || 'Listening…';
        if (finalChunk) {
          const notesEl = document.getElementById('injuryNotesInput');
          if (notesEl) {
            const cur = String(notesEl.value || '').trim();
            notesEl.value = cur ? `${cur} ${finalChunk}` : finalChunk;
            _diagProgrammaticInput = true;
            try {
              notesEl.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (e) {}
            _diagProgrammaticInput = false;
            try { notesEl.focus(); } catch (e) {}
          }
          _diagInputMode = _diagTranscriptEdited ? 'voice_edited' : 'voice';
          _diagTranscriptCaptured = true;
          _setVoiceStatus('Voice captured — review or edit before running triage.', 'ok');
        }
      };

      rec.onerror = (ev) => {
        const code = (ev && ev.error) ? String(ev.error) : 'error';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          _setVoiceStatus('Microphone access denied — allow mic in browser settings or type below.', 'warn');
        } else if (code === 'no-speech') {
          _setVoiceStatus('No speech detected — tap Dictate again or type your symptoms.', 'muted');
        } else if (code === 'aborted') {
          // Normal user/modal teardown
        } else {
          _setVoiceStatus('Voice input interrupted (' + code + ') — edit or type below.', 'warn');
        }
        stopVoiceDictation(true);
      };

      rec.onend = () => {
        if (_voiceRec === rec) {
          if (_voiceTimeoutId) {
            clearTimeout(_voiceTimeoutId);
            _voiceTimeoutId = null;
          }
          _voiceRec = null;
          _voiceState = 'idle';
          const interimEl = document.getElementById('diagVoiceInterimText');
          if (interimEl) interimEl.textContent = '';
          _renderVoiceUi();
        }
      };

      try {
        rec.start();
      } catch (e) {
        _setVoiceStatus('Microphone start failed — type your symptoms below.', 'warn');
        stopVoiceDictation(true);
      }
    }

    function toggleVoiceDictation() {
      if (_voiceState === 'listening') stopVoiceDictation(false);
      else startVoiceDictation();
    }

    function setDiagPain(val) {
      _diagPainSeverity = (val === _diagPainSeverity) ? null : val;
      if (typeof document !== 'undefined') {
        document.querySelectorAll('#diagPainRow .diag-pill-btn').forEach((b) => {
          const bVal = b.dataset.pain ? Number(b.dataset.pain) : null;
          b.classList.toggle('active', bVal === _diagPainSeverity);
        });
      }
    }

    function setDiagOnset(val) {
      _diagOnsetType = (val === _diagOnsetType) ? 'unknown' : (val || 'unknown');
      if (typeof document !== 'undefined') {
        document.querySelectorAll('#diagOnsetRow .diag-pill-btn').forEach((b) => {
          b.classList.toggle('active', (b.dataset.onset || 'unknown') === _diagOnsetType);
        });
      }
    }

    function cancelPendingDiagnostics() {
      if (_diagAbortCtrl) {
        try { _diagAbortCtrl.abort(); } catch (e) {}
        _diagAbortCtrl = null;
      }
    }

    function _setAnalyzeBusy(busy) {
      const btn = typeof document !== 'undefined' ? document.getElementById('btnAnalyzeInjury') : null;
      if (!btn) return;
      btn.disabled = Boolean(busy);
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
      btn.innerHTML = busy
        ? '<span>⏳</span> ANALYZING BIOMECHANICS &amp; LOAD HISTORY...'
        : '<span>⚡</span> ANALYZE BIOMECHANICS &amp; TRIAGE';
    }

    function buildOfflineBasicTriageReport(symptomPayload, reason = 'offline') {
      const text = String((symptomPayload && symptomPayload.raw_text) || '').trim();
      const tLow = text.toLowerCase();
      const urgent = /\b(numb|tingl\w*|radiat\w*|popped|audible\s+pop|can'?t\s+bear\s+weight|chest\s+pain|fever|hot\s+joint|lock\w*)\b/i.test(text)
        || (Number(symptomPayload && symptomPayload.pain_severity) >= 8 && symptomPayload.onset_type === 'sudden_acute');

      const matchedJoints = [];
      if (/knee|patell|meniscus|quad|lunge|squat|stairs/.test(tLow)) matchedJoints.push('knees');
      if (/back|lumbar|spine|erector|disc|hinge|l4|l5|sciatic/.test(tLow)) matchedJoints.push('lumbar');
      if (/shoulder|rotator|imping|dip|overhead|deltoid|ac joint/.test(tLow)) matchedJoints.push('shoulders');
      if (/elbow|tricep|epicondyl|tendonitis|forearm/.test(tLow)) matchedJoints.push('elbows');
      if (/wrist|carpal|pushup|grip/.test(tLow)) matchedJoints.push('wrists');
      if (/ankle|achilles|calf|soleus|plantar|heel|jump/.test(tLow)) matchedJoints.push('ankles');

      const regionMap = {
        knees: 'knee', lumbar: 'lumbar_lower_back', shoulders: 'shoulder',
        elbows: 'elbow', wrists: 'wrist_hand', ankles: 'ankle_achilles'
      };
      const primaryJoint = matchedJoints[0] || null;
      const primaryRegion = primaryJoint ? regionMap[primaryJoint] : 'other_unspecified';
      const triage = urgent ? 'red_seek_care' : (matchedJoints.length ? 'amber_deload' : 'green_modify');
      const severity = urgent ? 'severe' : (Number(symptomPayload && symptomPayload.pain_severity) <= 3 ? 'mild' : 'moderate');

      if (!urgent && matchedJoints.length === 0) {
        return {
          assessment_id: 'offline_' + Date.now(),
          generated_at: new Date().toISOString(),
          engine: 'offline_basic',
          _isOffline: true,
          fallback_reason: reason,
          needs_clarification: true,
          clarification_questions: [{
            id: 'q_offline_region',
            prompt: 'Which area is hurting most?',
            quick_options: ['Knee', 'Lower back', 'Shoulder']
          }],
          summary_headline: 'Offline clarification needed: select the affected joint to apply safe workout swaps.',
          anatomical_region: 'other_unspecified',
          laterality: 'unspecified',
          severity: 'mild',
          triage_level: 'green_modify',
          red_flags: { triggered: false, deterministic_override: false, flags: [], clinical_action: 'Select an affected joint.', training_clearance: 'modified_allowed' },
          probable_causes: [],
          load_correlations: [],
          recovery_context: { history_availability: 'empty', workouts_analyzed: 0, window_days: 21, acwr: null, acwr_status: 'offline', fatigued_markers: [], data_gap_note: 'Cloud history unavailable offline.' },
          action_plan: { immediate_relief_protocol: ['Avoid movements reproducing >3/10 sharp pain.'], load_management_guidance: 'Select joint below or tap an option above.', recovery_horizon_hours: '24–72 hours', return_to_load_criteria: ['Pain-free movement check'] },
          clinical_disclaimer: 'Offline biomechanical preview only — not a medical diagnosis.',
          adaptor_handoff: null
        };
      }

      const rulesObj = (typeof injuryRules !== 'undefined' && primaryJoint && injuryRules[primaryJoint]) ? injuryRules[primaryJoint] : null;
      return {
        assessment_id: 'offline_' + Date.now(),
        generated_at: new Date().toISOString(),
        engine: 'offline_basic',
        _isOffline: true,
        fallback_reason: reason,
        needs_clarification: false,
        clarification_questions: [],
        summary_headline: urgent
          ? 'URGENT OFFLINE TRIAGE: Stop aggravating load & seek clinical evaluation'
          : `Offline Triage: ${rulesObj ? rulesObj.title : 'Local Joint Deload Recommended'}`,
        anatomical_region: primaryRegion,
        laterality: symptomPayload.laterality_hint && symptomPayload.laterality_hint !== 'unknown' ? symptomPayload.laterality_hint : 'unspecified',
        severity,
        triage_level: triage,
        red_flags: {
          triggered: urgent,
          deterministic_override: urgent,
          flags: urgent ? ['Red-flag keyword or severe acute pain detected offline'] : [],
          clinical_action: urgent ? 'Stop loaded training immediately and consult a clinician.' : 'No urgent red-flag terms detected offline.',
          training_clearance: urgent ? 'stop_and_evaluate' : 'deload_only'
        },
        probable_causes: [{
          rank: 1,
          label: rulesObj ? rulesObj.title : 'Localized Mechanical Overload',
          likelihood: 'high',
          confidence_pct: 68,
          mechanism: rulesObj ? rulesObj.swap : 'Local mechanical strain around the symptomatic joint.',
          supporting_evidence: ['Evaluated offline using local symptom keywords & injury rules.']
        }],
        load_correlations: [],
        recovery_context: {
          history_availability: 'sparse',
          workouts_analyzed: 0,
          window_days: 21,
          acwr: null,
          acwr_status: 'offline',
          fatigued_markers: [],
          data_gap_note: 'Full 14–30 day cloud workout correlation unavailable while offline.'
        },
        action_plan: {
          immediate_relief_protocol: rulesObj && rulesObj.decompression ? [rulesObj.decompression] : ['Gentle pain-free mobility & rest from aggravating movements.'],
          load_management_guidance: rulesObj ? rulesObj.swap : 'Deload aggravating joint patterns.',
          recovery_horizon_hours: urgent ? 'Seek medical clearance first' : '48–72 hours',
          return_to_load_criteria: ['Minimal morning stiffness and pain <= 2/10 under bodyweight warmup.']
        },
        clinical_disclaimer: 'Offline biomechanical preview only — not a medical diagnosis.',
        adaptor_handoff: {
          assessment_id: 'offline_' + Date.now(),
          affected_joints: matchedJoints,
          anatomical_region: primaryRegion,
          laterality: symptomPayload.laterality_hint && symptomPayload.laterality_hint !== 'unknown' ? symptomPayload.laterality_hint : 'unspecified',
          severity,
          triage_level: triage,
          movement_restrictions: [],
          restricted_exercise_ids: [],
          recommended_swaps: ['glute_bridge_hold', 'zone2_flush', 'deadbug_hold'],
          rest_recommended: urgent,
          merge_mode: 'additive',
          summary_note: text.slice(0, 240),
          expires_hint_hours: urgent ? 168 : 72
        }
      };
    }

    async function runInjuryDiagnostics(clarificationAnswers = null) {
      stopVoiceDictation(false);
      const inputEl = typeof document !== 'undefined' ? document.getElementById('injuryNotesInput') : null;
      const rawText = (inputEl ? inputEl.value : '').trim();
      if (!rawText) {
        if (typeof showToast === 'function') showToast('⚠️ Please describe or dictate your symptoms first');
        if (typeof beep === 'function') beep(300, 0.08);
        return null;
      }

      const priorReport = (typeof window !== 'undefined') ? window._currentDiagnosticReport : null;
      const payload = {
        raw_text: rawText.slice(0, 2000),
        input_mode: _diagInputMode,
        transcript_edited: _diagTranscriptEdited,
        pain_severity: _diagPainSeverity,
        onset_type: _diagOnsetType,
        laterality_hint: 'unknown',
        context_window_days: 21,
        client_date: (typeof getLocalDateStr === 'function') ? getLocalDateStr() : undefined,
        clarification_context: (Array.isArray(clarificationAnswers) && clarificationAnswers.length > 0 && priorReport && priorReport.assessment_id)
          ? { prior_assessment_id: String(priorReport.assessment_id), answers: clarificationAnswers.slice(0, 3) }
          : null
      };

      const resEl = document.getElementById('injuryAssessmentResult');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const offRep = buildOfflineBasicTriageReport(payload, 'navigator_offline');
        if (typeof window !== 'undefined') window._currentDiagnosticReport = offRep;
        renderDiagnosticReportCard(offRep);
        return offRep;
      }

      cancelPendingDiagnostics();
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      _diagAbortCtrl = ctrl;
      _setAnalyzeBusy(true);

      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/diagnostics/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl ? ctrl.signal : undefined,
          timeoutMs: 22000,
          promptAuthOn401: true
        });
        if (_diagAbortCtrl !== ctrl) return null;

        if (!res) throw new Error('Network unavailable');
        if (res.status === 401) {
          if (resEl) {
            resEl.style.display = 'block';
            resEl.innerHTML = '<div class="diag-status-warn">🔐 Sign in required — enter your PULSE key and tap Analyze again (your notes are preserved).</div>';
          }
          return null;
        }
        if (res.status === 422) {
          if (resEl) {
            resEl.style.display = 'block';
            resEl.innerHTML = '<div class="diag-status-warn">⚠️ Please check your symptom text (must be 1–2000 characters) and try again.</div>';
          }
          return null;
        }
        if (res.status === 429) {
          const retryHdr = (res.headers && typeof res.headers.get === 'function') ? res.headers.get('Retry-After') : null;
          const offRep = buildOfflineBasicTriageReport(payload, retryHdr ? `rate_limited_${retryHdr}s` : 'rate_limited');
          if (typeof window !== 'undefined') window._currentDiagnosticReport = offRep;
          renderDiagnosticReportCard(offRep, `Cloud AI limit reached${retryHdr ? ' (retry in ' + retryHdr + 's)' : ''} — showing offline biomechanical preview.`);
          return offRep;
        }
        if (!res.ok) {
          throw new Error('HTTP_' + res.status);
        }

        const report = await res.json();
        if (typeof window !== 'undefined') window._currentDiagnosticReport = report;
        renderDiagnosticReportCard(report);
        if (typeof beep === 'function') beep(840, 0.08);
        return report;
      } catch (err) {
        if (err && err.name === 'AbortError' && _diagAbortCtrl !== ctrl) return null;
        const offRep = buildOfflineBasicTriageReport(payload, (err && err.name === 'AbortError') ? 'timeout' : 'network_error');
        if (typeof window !== 'undefined') window._currentDiagnosticReport = offRep;
        renderDiagnosticReportCard(offRep);
        return offRep;
      } finally {
        if (_diagAbortCtrl === ctrl) _diagAbortCtrl = null;
        _setAnalyzeBusy(false);
      }
    }

    function renderDiagnosticSummaryBanner(summary) {
      const container = typeof document !== 'undefined' ? document.getElementById('injuryAssessmentResult') : null;
      if (!container || !summary) return;
      container.style.display = 'block';
      const toneClass = summary.triage_level === 'red_seek_care'
        ? 'diag-badge-red'
        : (summary.triage_level === 'green_modify' ? 'diag-badge-green' : 'diag-badge-amber');
      container.innerHTML = `
<div class="card diag-report-card">
<div class="diag-report-top">
<span class="diag-badge ${toneClass}">${_escDiag(String(summary.triage_level || 'amber_deload').replace(/_/g, ' ').toUpperCase())}</span>
<span class="diag-meta-ts">Last Applied Triage</span>
</div>
<div class="diag-headline">${_escDiag(summary.summary_headline || 'Applied biomechanical restrictions active')}</div>
</div>
      `;
    }

    function renderDiagnosticReportCard(report, noticeBanner = '') {
      const container = typeof document !== 'undefined' ? document.getElementById('injuryAssessmentResult') : null;
      if (!container || !report) return;
      container.style.display = 'block';

      const triage = report.triage_level || 'amber_deload';
      const badgeCls = triage === 'red_seek_care' ? 'diag-badge-red' : (triage === 'green_modify' ? 'diag-badge-green' : 'diag-badge-amber');
      const triageTxt = triage === 'red_seek_care' ? '🚨 STOP & EVALUATE' : (triage === 'green_modify' ? '🟢 MODIFIED TRAINING OK' : '⚠️ LOCAL DELOAD');
      const engineTxt = report.engine === 'ai' ? 'AI SYNTHESIS' : (report.engine === 'offline_basic' ? 'OFFLINE BASIC' : 'BIOMECH ENGINE');

      let bodyHtml = '';
      if (noticeBanner) {
        bodyHtml += `<div class="diag-status-warn">${_escDiag(noticeBanner)}</div>`;
      }

      if (report.needs_clarification) {
        const qsHtml = (report.clarification_questions || []).map((q) => {
          const opts = (q.quick_options || []).map((opt) =>
            `<button type="button" class="diag-clar-chip" data-clar-opt="${_escDiag(opt)}" onclick="runInjuryDiagnostics([this.dataset.clarOpt])">${_escDiag(opt)}</button>`
          ).join('');
          return `<div class="diag-clar-block"><div class="diag-clar-prompt">${_escDiag(q.prompt)}</div><div class="diag-clar-opts">${opts}</div></div>`;
        }).join('');
        bodyHtml += `
<div class="diag-headline">${_escDiag(report.summary_headline)}</div>
<div class="diag-clar-list">${qsHtml}</div>
        `;
      } else {
        const rf = report.red_flags || {};
        if (rf.triggered) {
          const flagsHtml = (rf.flags || []).map((f) => `<li>${_escDiag(f)}</li>`).join('');
          bodyHtml += `
<div class="diag-red-flag-banner" role="alert">
<div class="diag-red-flag-title">🚨 RED-FLAG SAFETY TRIAGE</div>
<div class="diag-red-flag-action">${_escDiag(rf.clinical_action || '')}</div>
${flagsHtml ? `<ul class="diag-red-flag-list">${flagsHtml}</ul>` : ''}
</div>
          `;
        }

        const causesHtml = (report.probable_causes || []).map((c) => `
<div class="diag-cause-item">
<div class="diag-cause-hdr">
<span class="diag-cause-rank">#${_escDiag(c.rank)} ${_escDiag(c.label)}</span>
<span class="diag-cause-conf">${_escDiag(c.confidence_pct)}% · ${_escDiag(String(c.likelihood || '').toUpperCase())}</span>
</div>
<div class="diag-cause-mech">${_escDiag(c.mechanism)}</div>
</div>
        `).join('');

        const rc = report.recovery_context || {};
        const corrs = report.load_correlations || [];
        let corrHtml = '';
        if (corrs.length > 0) {
          corrHtml = corrs.map((lc) => `
<div class="diag-corr-row">
<span class="diag-corr-date">${_escDiag(lc.date)}</span>
<strong class="diag-corr-name">${_escDiag(lc.activity_or_exercise)}</strong>
<span class="diag-corr-note">${_escDiag(lc.correlation_note)}</span>
</div>
          `).join('');
        } else {
          corrHtml = `<div class="diag-data-gap">${_escDiag(rc.data_gap_note || 'No recent aggravating session spikes detected in synced history.')}</div>`;
        }

        const ap = report.action_plan || {};
        const reliefHtml = (ap.immediate_relief_protocol || []).map((s) => `<li>${_escDiag(s)}</li>`).join('');
        const returnHtml = (ap.return_to_load_criteria || []).map((s) => `<li>${_escDiag(s)}</li>`).join('');

        let handoffHtml = '';
        if (report.adaptor_handoff) {
          const h = report.adaptor_handoff;
          const jointsStr = (h.affected_joints || []).map((j) => _escDiag(j.toUpperCase())).join(', ') || 'GENERAL';
          const restrStr = (h.movement_restrictions || []).map((r) => _escDiag(String(r).replace(/_/g, ' '))).join(', ') || 'targeted volume modification';
          const swapsStr = (h.recommended_swaps || []).map((s) => _escDiag(s.replace(/_/g, ' '))).join(', ');
          handoffHtml = `
<div class="diag-handoff-box">
<div class="diag-handoff-meta">
<strong>Injury Adaptor Target:</strong> ${_escDiag(jointsStr)} (${_escDiag(h.severity)}) · <strong>Preserve Chronic/Other Joints:</strong> Yes (Additive)
</div>
<div class="diag-handoff-sub">Restrict: ${_escDiag(restrStr)}${swapsStr ? ' · Safe Swaps: ' + _escDiag(swapsStr) : ''}</div>
<button type="button" class="btn-action-primary diag-apply-btn" id="btnApplyDiagHandoff" onclick="applyDiagnosticHandoff()">
<span>🛡️</span> Apply Restrictions to Injury Adaptor
</button>
</div>
          `;
        }

        bodyHtml += `
<div class="diag-headline">${_escDiag(report.summary_headline)}</div>
<div class="diag-section-title">Probable Biomechanical Causes</div>
<div class="diag-causes-list">${causesHtml}</div>
<div class="diag-section-title">Load &amp; Movement Correlations (${_escDiag(rc.workouts_analyzed ?? 0)} workouts · ${_escDiag(rc.window_days ?? 21)}d · ACWR ${_escDiag(rc.acwr ?? '--')})</div>
<div class="diag-corr-list">${corrHtml}</div>
<details data-details-key="diag_relief_protocol" class="diag-details">
<summary class="diag-details-summary">
<span>📐 Relief Protocol &amp; Return-to-Load Criteria (${_escDiag(ap.recovery_horizon_hours || '48h')})</span>
<span>▾</span>
</summary>
<div class="diag-details-body">
<div>${_escDiag(ap.load_management_guidance || '')}</div>
${reliefHtml ? `<ul class="diag-proto-list">${reliefHtml}</ul>` : ''}
${returnHtml ? `<div class="diag-sub-heading">Return-to-Load Criteria:</div><ul class="diag-proto-list">${returnHtml}</ul>` : ''}
</div>
</details>
${handoffHtml}
        `;
      }

      container.innerHTML = `
<div class="card diag-report-card ${triage === 'red_seek_care' ? 'is-red-flag' : ''}">
<div class="diag-report-top">
<span class="diag-badge ${badgeCls}">${triageTxt}</span>
<span class="diag-engine-pill">${engineTxt}</span>
</div>
${bodyHtml}
<div class="diag-disclaimer">${_escDiag(report.clinical_disclaimer || '')}</div>
</div>
      `;
    }

    async function applyDiagnosticHandoff(reportOverride = null) {
      const report = reportOverride || (typeof window !== 'undefined' ? window._currentDiagnosticReport : null);
      if (!report || !report.adaptor_handoff) return false;
      const h = report.adaptor_handoff;

      const normFn = (typeof window.normalizeAthleteInjuries === 'function')
        ? window.normalizeAthleteInjuries
        : ((x) => x);
      const prevSnapshot = JSON.parse(JSON.stringify(normFn(athleteInjuries)));
      const next = normFn(JSON.parse(JSON.stringify(athleteInjuries)));
      const nowIso = new Date().toISOString();

      (h.affected_joints || []).forEach((j) => {
        if (!_DIAG_JOINTS.includes(j)) return;
        next[j] = true;
        next.active_constraints[j] = {
          severity: h.severity || report.severity || 'moderate',
          source: 'diagnostic',
          laterality: h.laterality || report.laterality || 'unspecified',
          anatomical_region: h.anatomical_region || report.anatomical_region || 'other_unspecified',
          movement_restrictions: Array.isArray(h.movement_restrictions) ? h.movement_restrictions.slice(0, 10) : [],
          restricted_exercise_ids: Array.isArray(h.restricted_exercise_ids) ? h.restricted_exercise_ids.slice(0, 25) : [],
          assessment_id: h.assessment_id || report.assessment_id || null,
          applied_at: nowIso,
          expires_hint_hours: Number(h.expires_hint_hours) || 72
        };
      });

      next.last_diagnostic_summary = {
        assessment_id: String(report.assessment_id || h.assessment_id || ''),
        generated_at: String(report.generated_at || nowIso),
        summary_headline: String(report.summary_headline || h.summary_note || '').slice(0, 300),
        anatomical_region: String(h.anatomical_region || report.anatomical_region || 'other_unspecified'),
        severity: String(h.severity || report.severity || 'moderate'),
        triage_level: String(h.triage_level || report.triage_level || 'amber_deload'),
        affected_joints: Array.isArray(h.affected_joints) ? h.affected_joints.slice(0, 6) : []
      };

      const noteLine = String(h.summary_note || report.summary_headline || '').trim().slice(0, 240);
      if (noteLine && !String(next.notes || '').includes(noteLine)) {
        next.notes = (next.notes ? `${next.notes.trim()} | ${noteLine}` : noteLine).slice(0, 2000);
      }
      next.updated_at_ms = Date.now();
      athleteInjuries = normFn(next);

      _syncModalAndWorkoutsAfterMutation(Boolean(h.rest_recommended));

      const applyBtn = typeof document !== 'undefined' ? document.getElementById('btnApplyDiagHandoff') : null;
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.innerHTML = '<span>✓</span> Restrictions Applied to Injury Adaptor';
      }

      await _persistInjuriesMerged();

      if (report.assessment_id && !report._isOffline && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        try {
          const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
          Promise.resolve(fetcher(`/api/diagnostics/${encodeURIComponent(report.assessment_id)}/apply`, { method: 'POST' })).catch(() => {});
        } catch (e) {}
      }

      if (typeof beep === 'function') beep(880, 0.12);
      if (typeof showToast === 'function') {
        showToast('🛡️ Diagnostic restrictions applied to Injury Adaptor', {
          actionLabel: 'Undo',
          durationMs: 6000,
          onAction: () => revertDiagnosticHandoff(prevSnapshot)
        });
      }
      return true;
    }

    async function revertDiagnosticHandoff(prevSnapshot) {
      if (!prevSnapshot) return false;
      const normFn = (typeof window.normalizeAthleteInjuries === 'function')
        ? window.normalizeAthleteInjuries
        : ((x) => x);
      const restored = normFn(prevSnapshot);
      restored.updated_at_ms = Date.now();
      athleteInjuries = normFn(restored);
      _syncModalAndWorkoutsAfterMutation(false);
      await _persistInjuriesMerged();
      const applyBtn = typeof document !== 'undefined' ? document.getElementById('btnApplyDiagHandoff') : null;
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.innerHTML = '<span>🛡️</span> Apply Restrictions to Injury Adaptor';
      }
      if (typeof showToast === 'function') showToast('↩️ Reverted last diagnostic restriction update');
      return true;
    }

    function _syncModalAndWorkoutsAfterMutation(restRecommended) {
      _DIAG_JOINTS.forEach((k) => {
        const btn = typeof document !== 'undefined' ? document.getElementById('inj_btn_' + k) : null;
        if (btn) {
          btn.classList.toggle('active', Boolean(athleteInjuries[k]));
          btn.classList.toggle('chronic-active', Boolean(athleteInjuries.chronic_profile && athleteInjuries.chronic_profile[k] && athleteInjuries.chronic_profile[k].permanent));
        }
      });
      if (typeof renderInjuryRules === 'function') renderInjuryRules();
      renderChronicProfileControls();
      if (typeof updateInjuryBadge === 'function') updateInjuryBadge();
      if (typeof renderTodayWorkoutVerdict === 'function') {
        try { renderTodayWorkoutVerdict(); } catch (e) {}
      }
      if (typeof loadDailyArchetype === 'function') {
        const targetArch = restRecommended ? 'option_c' : ((typeof currentArchetypeKey !== 'undefined' && currentArchetypeKey) || 'option_a');
        loadDailyArchetype(targetArch);
      }
      if (typeof renderCurrentExercise === 'function') {
        try { renderCurrentExercise(); } catch (e) {}
      }
    }

    async function _persistInjuriesMerged() {
      try {
        localStorage.setItem('pulse_athlete_injuries', JSON.stringify(athleteInjuries));
      } catch (e) {}
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
        }
        return;
      }
      if (typeof window._incrementInjuriesSync === 'function') window._incrementInjuriesSync();
      try {
        const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
        const res = await fetcher('/api/athlete/injuries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteInjuries)
        });
        const shouldQueue = (typeof _shouldQueueOfflineResponse === 'function')
          ? _shouldQueueOfflineResponse(res)
          : (!res || res.status >= 500 || res.status === 0);
        if ((!res || !res.ok) && shouldQueue && typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
        }
      } catch (e) {
        if (typeof enqueueOfflineWrite === 'function') {
          enqueueOfflineWrite('/api/athlete/injuries', athleteInjuries, 'POST');
        }
      } finally {
        if (typeof window._decrementInjuriesSync === 'function') window._decrementInjuriesSync();
      }
    }

    function renderChronicProfileControls() {
      const box = typeof document !== 'undefined' ? document.getElementById('diagChronicList') : null;
      if (!box) return;
      const cp = (typeof athleteInjuries !== 'undefined' && athleteInjuries && athleteInjuries.chronic_profile) || {};
      box.innerHTML = _DIAG_JOINTS.map((k) => {
        const active = Boolean(cp[k] && cp[k].permanent);
        return `<button type="button" class="diag-chronic-btn${active ? ' active' : ''}" data-joint="${k}" aria-pressed="${active ? 'true' : 'false'}" onclick="toggleChronicJoint('${k}')">${active ? '🔒' : '○'} ${_escDiag(_DIAG_JOINT_LABELS[k] || k)}</button>`;
      }).join('');
    }

    async function toggleChronicJoint(jointKey) {
      if (!_DIAG_JOINTS.includes(jointKey)) return;
      const normFn = (typeof window.normalizeAthleteInjuries === 'function')
        ? window.normalizeAthleteInjuries
        : ((x) => x);
      const next = normFn(JSON.parse(JSON.stringify(athleteInjuries)));
      if (next.chronic_profile && next.chronic_profile[jointKey] && next.chronic_profile[jointKey].permanent) {
        delete next.chronic_profile[jointKey];
        if (!next.active_constraints || !next.active_constraints[jointKey]) {
          next[jointKey] = false;
        }
      } else {
        next.chronic_profile[jointKey] = {
          permanent: true,
          label: _DIAG_JOINT_LABELS[jointKey] || jointKey,
          laterality: 'unspecified',
          notes: 'Permanent sensitivity lock'
        };
        next[jointKey] = true;
      }
      next.updated_at_ms = Date.now();
      athleteInjuries = normFn(next);
      _syncModalAndWorkoutsAfterMutation(false);
      await _persistInjuriesMerged();
      if (typeof showToast === 'function') {
        const locked = Boolean(athleteInjuries.chronic_profile && athleteInjuries.chronic_profile[jointKey]);
        showToast(locked ? `🔒 Marked ${jointKey} as permanent sensitivity` : `🔓 Removed permanent lock on ${jointKey}`);
      }
    }

    if (typeof window !== 'undefined') {
      window.initDiagnosticsUi = initDiagnosticsUi;
      window.toggleVoiceDictation = toggleVoiceDictation;
      window.stopVoiceDictation = stopVoiceDictation;
      window.cancelPendingDiagnostics = cancelPendingDiagnostics;
      window.setDiagPain = setDiagPain;
      window.setDiagOnset = setDiagOnset;
      window._setDiagInputMode = _setDiagInputMode;
      window.runInjuryDiagnostics = runInjuryDiagnostics;
      window.renderDiagnosticReportCard = renderDiagnosticReportCard;
      window.renderDiagnosticSummaryBanner = renderDiagnosticSummaryBanner;
      window.applyDiagnosticHandoff = applyDiagnosticHandoff;
      window.revertDiagnosticHandoff = revertDiagnosticHandoff;
      window.renderChronicProfileControls = renderChronicProfileControls;
      window.toggleChronicJoint = toggleChronicJoint;
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initDiagnosticsUi());
      } else {
        try { initDiagnosticsUi(); } catch (e) {}
      }
    }
