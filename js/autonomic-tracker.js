// ==================== PAROXYSMAL EPISODE ("FUNNY TURNS") & ILLNESS TRACKER ====================
(function () {
  'use strict';

  const AUTONOMIC_CACHE_KEY = 'pulse_autonomic_cache_v1';
  const SYMPTOM_CATALOG_DEFAULT = [
    { key: 'dizziness_vertigo', label: 'Dizziness / Vertigo' },
    { key: 'lightheaded_presyncope', label: 'Lightheadedness / Presyncope' },
    { key: 'dissociation', label: 'Dissociation / Detachment' },
    { key: 'confusion_brain_fog', label: 'Confusion / Brain Fog' },
    { key: 'impending_doom', label: 'Impending Doom / Adrenaline' },
    { key: 'visual_changes', label: 'Visual Changes' },
    { key: 'blackout', label: 'Blackout / Loss of Consciousness' }
  ];
  const TRIGGER_CATALOG_DEFAULT = [
    { key: 'standing_quickly', label: 'Standing Up Quickly' },
    { key: 'driving', label: 'Driving (ID. Buzz)' },
    { key: 'fasted_state', label: 'Fasted State' },
    { key: 'post_exercise', label: 'Post-Exercise' },
    { key: 'poor_sleep', label: 'Poor Sleep' },
    { key: 'high_workload', label: 'High Workload / Screen' },
    { key: 'illness_infection', label: 'Illness / Infection' },
    { key: 'dehydration_heat', label: 'Dehydration / Heat' },
    { key: 'caffeine_stimulant', label: 'Caffeine / Stimulant' }
  ];
  const ILLNESS_SYMPTOMS_DEFAULT = [
    { key: 'fever_chills', label: 'Fever / Chills' },
    { key: 'fatigue_malaise', label: 'Deep Fatigue / Malaise' },
    { key: 'respiratory_sinus', label: 'Respiratory / Sinus' },
    { key: 'gi_nausea', label: 'GI Upset / Nausea' },
    { key: 'headache_aches', label: 'Headache / Body Aches' },
    { key: 'elevated_rhr_stress', label: 'High RHR / Poor Sleep' }
  ];

  let _activeSubview = 'capture';
  let _draftSymptoms = new Set();
  let _draftTriggers = new Set();
  let _draftSeverity = 'moderate';
  let _draftNotes = '';
  let _draftSyncedEpId = null;

  let _backdateOpen = false;
  let _bdSymptoms = new Set();
  let _bdTriggers = new Set();

  let _illnessSelectedDate = '';
  let _illnessSeverity = 'moderate';
  let _illnessSymptoms = new Set();
  let _illnessNotes = '';

  let _timerHandle = null;
  let _actionInFlight = false;

  function _esc(val) {
    if (typeof escapeHtml === 'function') return escapeHtml(val);
    return String(val === null || val === undefined ? '' : val)
      .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function _todayUkIso() {
    if (typeof getLocalDateStr === 'function') return getLocalDateStr();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _nowLocalDateTimeInput() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function _dateOffsetIso(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function _shortDayLabel(dateIso) {
    const parts = String(dateIso || '').split('-').map(Number);
    if (parts.length !== 3) return dateIso;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const today = _todayUkIso();
    if (dateIso === today) return 'Today';
    const yest = _dateOffsetIso(1);
    if (dateIso === yest) return 'Yest';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  }

  function _formatElapsed(isoStr) {
    const ms = Date.parse(String(isoStr || ''));
    if (!Number.isFinite(ms)) return '00:00';
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    const hrs = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  function _formatClockUk(isoStr) {
    if (!isoStr) return '--';
    const ms = Date.parse(String(isoStr));
    if (!Number.isFinite(ms)) return String(isoStr).slice(0, 16);
    const d = new Date(ms);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function _defaultAutonomic() {
    return {
      evaluated_at: null,
      date_str: _todayUkIso(),
      system_state: 'IDLE',
      alert_level: 0,
      safety_banner: {
        active: false,
        level: 0,
        tone: 'calm',
        title: 'Autonomic Baseline Calm',
        reasons: [],
        advisory: 'Autonomic metrics within normal baseline.',
        avoid_driving: false,
        avoid_solo_exertion: false
      },
      level1: { active: false, triggers: [], sleep_avg_stress: null, hrv_last_night: null, hrv_7d_baseline: null },
      level2: { active: false, current_streak_mins: 0, max_streak_mins: 0 },
      acute_spike: null,
      active_episode: null,
      illness: {
        active_today: false,
        today_log: null,
        current_streak_days: 0,
        last_illness_date: null,
        days_since_illness_ended: null,
        post_illness_ramp_active: false,
        recovery_scale_shield: { active: false, hours_remaining: 0, note: '' },
        recent_logs: []
      },
      patterns: {
        total_episodes: 0,
        count_7d: 0,
        count_30d: 0,
        acute_duration_stats: { count: 0, avg: null, median: null, min: null, max: null },
        total_recovery_stats: { count: 0, avg: null, median: null, min: null, max: null },
        top_symptoms: [],
        top_triggers: [],
        illness_co_occurrence_pct: 0,
        time_of_day: [],
        pathway_counts: [],
        prodrome_comparison: {},
        prodromal_risk: { score: 0, level: 'low', label: 'Low / Calm Autonomic Baseline', drivers: [] }
      },
      recent_episodes: [],
      symptom_catalog: SYMPTOM_CATALOG_DEFAULT,
      trigger_catalog: TRIGGER_CATALOG_DEFAULT,
      illness_symptom_catalog: ILLNESS_SYMPTOMS_DEFAULT,
      clinical_disclaimer: 'Self-monitoring & Garmin biometric correlation record only. Non-diagnostic.'
    };
  }

  function getAutonomicSummary() {
    if (typeof window !== 'undefined' && window.PULSE_ANALYTICS_SUMMARY && window.PULSE_ANALYTICS_SUMMARY.autonomic) {
      return window.PULSE_ANALYTICS_SUMMARY.autonomic;
    }
    try {
      const raw = localStorage.getItem(AUTONOMIC_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.system_state) {
          if (!window.PULSE_ANALYTICS_SUMMARY || typeof window.PULSE_ANALYTICS_SUMMARY !== 'object') {
            window.PULSE_ANALYTICS_SUMMARY = {};
          }
          window.PULSE_ANALYTICS_SUMMARY.autonomic = parsed;
          return parsed;
        }
      }
    } catch (e) {}
    return _defaultAutonomic();
  }

  function _saveAutonomicSummary(autonomicObj, stateObj, flexObj) {
    if (!autonomicObj || typeof autonomicObj !== 'object') return;
    if (typeof window !== 'undefined') {
      if (!window.PULSE_ANALYTICS_SUMMARY || typeof window.PULSE_ANALYTICS_SUMMARY !== 'object') {
        window.PULSE_ANALYTICS_SUMMARY = {};
      }
      window.PULSE_ANALYTICS_SUMMARY.autonomic = autonomicObj;
      if (flexObj) window.PULSE_ANALYTICS_SUMMARY.flex_refeed = flexObj;
    }
    try {
      localStorage.setItem(AUTONOMIC_CACHE_KEY, JSON.stringify(autonomicObj));
      if (window.PULSE_ANALYTICS_SUMMARY) {
        localStorage.setItem('pulse_analytics_summary_cache', JSON.stringify(window.PULSE_ANALYTICS_SUMMARY));
      }
    } catch (e) {}

    if (stateObj && typeof applyLiveStateToDom === 'function') {
      applyLiveStateToDom(stateObj);
    }
    renderAutonomicUi();
    if (typeof renderTodayTrainingRecommendations === 'function') {
      try { renderTodayTrainingRecommendations(); } catch (e) {}
    }
    if (typeof renderFlexRefeedCard === 'function' && window.PULSE_ANALYTICS_SUMMARY) {
      try { renderFlexRefeedCard(window.PULSE_ANALYTICS_SUMMARY); } catch (e) {}
    }
    if (typeof renderPostRefeedScaleShield === 'function' && window.PULSE_ANALYTICS_SUMMARY) {
      try { renderPostRefeedScaleShield(window.PULSE_ANALYTICS_SUMMARY); } catch (e) {}
    }
  }

  function _syncDraftFromActiveEpisode(ep) {
    if (!ep) {
      _draftSyncedEpId = null;
      return;
    }
    if (_draftSyncedEpId === ep.id) return;
    _draftSyncedEpId = ep.id;
    _draftSymptoms = new Set(Array.isArray(ep.symptoms) ? ep.symptoms : []);
    _draftTriggers = new Set(Array.isArray(ep.triggers) ? ep.triggers : []);
    _draftSeverity = ep.severity || 'moderate';
    _draftNotes = ep.notes || '';
  }

  function _stopTimer() {
    if (_timerHandle) {
      clearInterval(_timerHandle);
      _timerHandle = null;
    }
  }

  function _ensureTimerRunning() {
    const auto = getAutonomicSummary();
    const ep = auto.active_episode;
    const healthTab = typeof document !== 'undefined' ? document.getElementById('tab-health') : null;
    const healthOpen = Boolean(healthTab && healthTab.classList && healthTab.classList.contains('active'));
    if (ep && (ep.state === 'ACUTE_EPISODE' || ep.state === 'POST_EPISODE_RECOVERY')) {
      if (!_timerHandle && (healthOpen || ep.state === 'ACUTE_EPISODE')) {
        _timerHandle = setInterval(() => {
          const curAuto = getAutonomicSummary();
          const curEp = curAuto.active_episode;
          if (!curEp) {
            _stopTimer();
            return;
          }
          const digits = document.getElementById('autonomicLiveTimerDigits');
          if (digits) digits.innerText = _formatElapsed(curEp.onset_time);
          const qText = document.getElementById('autonomicQuickEpisodeLabel');
          if (qText) qText.innerText = `Turn Active (${_formatElapsed(curEp.onset_time)})`;
        }, 1000);
      }
    } else {
      _stopTimer();
    }
  }

  function renderHeaderPill(auto) {
    const dot = document.getElementById('autonomicPillDot');
    const txt = document.getElementById('autonomicPillText');
    const navDot = document.getElementById('navHealthDot');

    const ep = auto.active_episode;
    const ill = auto.illness || {};
    const lvl = Number(auto.alert_level || 0);

    let stateColor = 'teal';
    let label = 'Calm';
    let showNavDot = false;

    if (ep && ep.state === 'ACUTE_EPISODE') {
      stateColor = 'red';
      label = 'Turn Active';
      showNavDot = true;
    } else if (ep && ep.state === 'POST_EPISODE_RECOVERY') {
      stateColor = 'amber';
      label = 'Recovering';
      showNavDot = true;
    } else if (lvl >= 2) {
      stateColor = 'red';
      label = 'Level 2 Alert';
      showNavDot = true;
    } else if (lvl === 1) {
      stateColor = 'amber';
      label = 'Level 1 Alert';
      showNavDot = true;
    } else if (ill.active_today) {
      stateColor = 'violet';
      label = 'Sick Mode';
      showNavDot = true;
    }

    if (dot && txt) {
      dot.className = 'pill-dot';
      dot.classList.add(stateColor);
      txt.innerText = label;
    }
    if (navDot) {
      navDot.className = 'nav-health-dot';
      if (showNavDot) {
        navDot.classList.add(stateColor);
        navDot.style.display = 'block';
      } else {
        navDot.style.display = 'none';
      }
    }
  }

  function renderTodayBanners(auto) {
    const safetyEl = document.getElementById('autonomicSafetyBanner');
    const spikeEl = document.getElementById('autonomicSpikeBanner');
    const illEl = document.getElementById('illnessStatusBannerToday');

    const sb = auto.safety_banner || {};
    const ep = auto.active_episode;
    const ill = auto.illness || {};

    if (safetyEl) {
      if (sb.active) {
        const toneCls = sb.tone === 'red' ? 'tone-red' : 'tone-amber';
        const reasons = Array.isArray(sb.reasons) ? sb.reasons : [];
        const ctaHtml = ep
          ? `
            <button type="button" class="autonomic-tap-btn ${ep.state === 'ACUTE_EPISODE' ? 'is-acute' : 'is-recovery'}" onclick="openAutonomicModal('capture')">⏱ Open Episode Tracker</button>
            <button type="button" class="autonomic-tap-btn is-calm" onclick="endEpisodeNow('${_esc(ep.id)}')">⏹ End Episode Now</button>
          `
          : `<button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow()">⚡ Log Funny Turn Now (1-Tap)</button>`;
        safetyEl.style.display = 'block';
        safetyEl.innerHTML = `
          <div class="autonomic-safety-banner ${toneCls}" role="alert" aria-live="polite">
            <div class="autonomic-safety-title">
              <span>${sb.level >= 2 ? '🚨' : '⚠️'} ${_esc(sb.title || 'Autonomic Safety Alert')}</span>
              <span class="autonomic-risk-pill">${sb.level >= 2 ? 'LEVEL 2' : 'LEVEL 1'}</span>
            </div>
            ${reasons.length ? `<div class="autonomic-safety-copy">${reasons.map((r) => `• ${_esc(r)}`).join('<br>')}</div>` : ''}
            <div class="autonomic-safety-copy"><strong>Do Not Drive (Volkswagen ID. Buzz) or train solo high-risk</strong> until autonomic metrics normalize and symptoms clear.</div>
            <div class="autonomic-safety-actions">
              ${ctaHtml}
            </div>
          </div>
        `;
      } else {
        safetyEl.style.display = 'none';
        safetyEl.innerHTML = '';
      }
    }

    const sp = auto.acute_spike;
    if (spikeEl) {
      if (sp && sp.detected && (!ep || ep.state !== 'ACUTE_EPISODE')) {
        spikeEl.style.display = 'block';
        spikeEl.innerHTML = `
          <div class="autonomic-spike-banner" role="alert">
            <div class="autonomic-safety-title">
              <span>📈 Unprovoked Biometric Spike Detected</span>
              <span>${_esc(_formatClockUk(sp.spike_time))}</span>
            </div>
            <div class="autonomic-safety-copy">${_esc(sp.reason || 'Garmin detected sudden stress or HR deviation outside workouts.')} Are you having a funny turn?</div>
            <div class="autonomic-safety-actions" style="display:grid; grid-template-columns:2fr 1fr; gap:8px;">
              <button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow(${Number(sp.spike_ts_ms) || 0}, true)">⚡ Yes — Capture Episode</button>
              <button type="button" class="autonomic-tap-btn is-outline" onclick="dismissAutonomicSpike(${Number(sp.spike_ts_ms) || 0})">Dismiss</button>
            </div>
          </div>
        `;
      } else {
        spikeEl.style.display = 'none';
        spikeEl.innerHTML = '';
      }
    }

    if (illEl) {
      if (ill.active_today) {
        const tLog = ill.today_log || {};
        illEl.style.display = 'block';
        illEl.innerHTML = `
          <div class="illness-today-banner">
            <div class="autonomic-safety-title">
              <span>🤒 Illness Recovery Mode Active (Day ${Math.max(1, Number(ill.current_streak_days || 1))})</span>
              <span>${_esc(String(tLog.severity || 'moderate').toUpperCase())}</span>
            </div>
            <div class="autonomic-safety-copy">Maintenance Fuel &amp; Rest Mode active • Protein locked • Sick days excluded from 14d Adaptive TDEE.</div>
            <div class="autonomic-safety-actions">
              <button type="button" class="autonomic-tap-btn is-illness" onclick="openAutonomicModal('illness')">Manage Sick Log &amp; Backdate Days</button>
            </div>
          </div>
        `;
      } else if (ill.post_illness_ramp_active) {
        illEl.style.display = 'block';
        illEl.innerHTML = `
          <div class="illness-today-banner">
            <div class="autonomic-safety-title">
              <span>🛡️ Day-1 Post-Illness Return Ramp</span>
              <span>48h Scale Shield</span>
            </div>
            <div class="autonomic-safety-copy">First day back after illness: training capped to gentle flush &amp; scale fluctuations protected by 48h Recovery Shield.</div>
            <div class="autonomic-safety-actions">
              <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('illness')">View Illness Log</button>
            </div>
          </div>
        `;
      } else {
        illEl.style.display = 'none';
        illEl.innerHTML = '';
      }
    }
  }

  function renderBodySummaryCard(auto) {
    const card = document.getElementById('autonomicBodySummaryCard');
    if (!card) return;
    const pat = auto.patterns || {};
    const risk = pat.prodromal_risk || { level: 'low', label: 'Low Baseline', score: 0, drivers: [] };
    const lvl1 = auto.level1 || {};
    const lvl2 = auto.level2 || {};
    const recStats = pat.total_recovery_stats || {};
    const riskCls = risk.level === 'high' ? 'risk-high' : (risk.level === 'elevated' ? 'risk-elevated' : 'risk-low');

    card.style.display = 'block';
    card.innerHTML = `
      <div class="autonomic-risk-card ${riskCls}">
        <div class="autonomic-safety-title">
          <span>🛡️ Autonomic &amp; Illness Tracker</span>
          <span class="autonomic-risk-pill">${_esc(String(risk.level || 'low').toUpperCase())} • ${Number(risk.score || 0)}</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">${_esc(risk.label || '')}</div>
        <div class="autonomic-stat-grid cols-3" style="margin-top:8px;">
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">Episodes (30d)</div>
            <div class="autonomic-stat-val">${Number(pat.count_30d || 0)}</div>
          </div>
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">Avg Rec Lag</div>
            <div class="autonomic-stat-val">${recStats.avg !== null && recStats.avg !== undefined ? `${Math.round(Number(recStats.avg))}m` : '--'}</div>
          </div>
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">4h Stress Streak</div>
            <div class="autonomic-stat-val">${Number(lvl2.max_streak_mins || 0)}m</div>
          </div>
        </div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:6px;">
          Sleep Stress Avg: <strong>${lvl1.sleep_avg_stress != null ? lvl1.sleep_avg_stress : '--'}</strong> • HRV Night: <strong>${lvl1.hrv_last_night != null ? `${lvl1.hrv_last_night}ms` : '--'}</strong> (7d Base: ${lvl1.hrv_7d_baseline != null ? `${lvl1.hrv_7d_baseline}ms` : '--'})
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
          <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('patterns')">📊 Patterns &amp; Risk</button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('export')">🩺 Clinical Export</button>
        </div>
      </div>
    `;
  }

  function _renderCaptureSubview(auto) {
    const container = document.getElementById('autonomicViewCapture');
    if (!container) return;

    const ep = auto.active_episode;
    const symCat = Array.isArray(auto.symptom_catalog) && auto.symptom_catalog.length ? auto.symptom_catalog : SYMPTOM_CATALOG_DEFAULT;
    const trigCat = Array.isArray(auto.trigger_catalog) && auto.trigger_catalog.length ? auto.trigger_catalog : TRIGGER_CATALOG_DEFAULT;

    if (ep && (ep.state === 'ACUTE_EPISODE' || ep.state === 'POST_EPISODE_RECOVERY')) {
      _syncDraftFromActiveEpisode(ep);
      const isAcute = ep.state === 'ACUTE_EPISODE';
      const userDone = Boolean(ep.user_recovered_at);
      const bioDone = Boolean(ep.biometric_recovered_at);

      const actionButtons = isAcute
        ? `
          <button type="button" class="autonomic-tap-btn is-recovery" onclick="updateActiveEpisode('mark_acute_end')">
            ⏸ Acute Peak Ended (Start Recovery Timer)
          </button>
          <button type="button" class="autonomic-tap-btn is-calm" onclick="updateActiveEpisode('confirm_resolved_override')">
            ⏹ End &amp; Close Episode Now
          </button>
        `
        : `
          ${!userDone
            ? `<button type="button" class="autonomic-tap-btn is-recovery" onclick="updateActiveEpisode('mark_user_recovered')">✓ I Feel Normal (Wait for Garmin Stress ≤25)</button>`
            : `<div class="autonomic-safety-copy" style="width:100%;">✓ Marked normal (${_esc(_formatClockUk(ep.user_recovered_at))}) — waiting for Garmin stress ≤25, or close immediately below:</div>`}
          <button type="button" class="autonomic-tap-btn is-calm" onclick="updateActiveEpisode('confirm_resolved_override')">
            ⏹ End &amp; Close Episode Now
          </button>
        `;

      container.innerHTML = `
        <div class="autonomic-timer-hero">
          <div style="font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-secondary);">
            ${isAcute ? 'ACUTE EPISODE IN PROGRESS' : 'POST-EPISODE RECOVERY TIMER'}
          </div>
          <div id="autonomicLiveTimerDigits" class="autonomic-timer-digits">${_esc(_formatElapsed(ep.onset_time))}</div>
          <div style="font-size:12px; color:var(--text-secondary);">Started ${_esc(_formatClockUk(ep.onset_time))}</div>

          <div class="autonomic-hybrid-status-row">
            <div class="autonomic-hybrid-badge ${!isAcute ? 'is-done' : ''}">
              ${!isAcute ? '✓' : '⏳'} Acute Ended${ep.acute_duration_mins != null ? ` (${ep.acute_duration_mins}m)` : ''}
            </div>
            <div class="autonomic-hybrid-badge ${userDone ? 'is-done' : ''}">
              ${userDone ? '✓' : '○'} Feel Normal
            </div>
            <div class="autonomic-hybrid-badge ${bioDone ? 'is-done' : ''}">
              ${bioDone ? '✓' : '○'} Garmin Stress ≤25
            </div>
          </div>

          <div class="autonomic-safety-actions is-stacked" style="margin-top:10px;">
            ${actionButtons}
          </div>
        </div>

        <div class="autonomic-safety-banner tone-amber" style="margin-top:10px;">
          <div class="autonomic-safety-copy"><strong>Do NOT drive (Volkswagen ID. Buzz)</strong> or perform solo high-risk exertion until full recovery completes.</div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Severity</label>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            ${['mild', 'moderate', 'severe'].map((sv) => `
              <button type="button" class="autonomic-chip ${_draftSeverity === sv ? 'is-selected' : ''}" onclick="setActiveDraftSeverity('${sv}')">
                <span class="autonomic-chip-check">${_draftSeverity === sv ? '✓' : ''}</span>
                <span>${sv.toUpperCase()}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Symptoms Experienced (Tap All That Apply)</label>
          <div class="autonomic-chip-grid">
            ${symCat.map((s) => {
              const sel = _draftSymptoms.has(s.key);
              return `
                <button type="button" class="autonomic-chip ${sel ? 'is-selected' : ''}" onclick="toggleEpisodeDraftSymptom('${_esc(s.key)}')">
                  <span class="autonomic-chip-check">${sel ? '✓' : ''}</span>
                  <span>${_esc(s.label)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Context &amp; Triggers</label>
          <div class="autonomic-chip-grid">
            ${trigCat.map((t) => {
              const sel = _draftTriggers.has(t.key);
              return `
                <button type="button" class="autonomic-chip ${sel ? 'is-selected' : ''}" onclick="toggleEpisodeDraftTrigger('${_esc(t.key)}')">
                  <span class="autonomic-chip-check">${sel ? '✓' : ''}</span>
                  <span>${_esc(t.label)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label" for="epDraftNotesInput">Notes (Optional)</label>
          <textarea id="epDraftNotesInput" class="autonomic-input" rows="2" placeholder="What happened right before, posture, food, warning aura..." oninput="setActiveDraftNotes(this.value)">${_esc(_draftNotes)}</textarea>
        </div>

        <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="autonomic-tap-btn is-calm" onclick="saveActiveEpisodeDetails()">✓ Save Symptoms &amp; Notes</button>
          <button type="button" class="autonomic-tap-btn is-danger-ghost" onclick="deleteLoggedEpisode('${_esc(ep.id)}')">🗑️ Delete / Discard This Episode</button>
        </div>
      `;
      return;
    }

    const ill = auto.illness || {};
    const illnessNote = ill.active_today
      ? '<div class="autonomic-safety-copy" style="margin-top:6px;">🤒 Active illness will automatically link to any logged episode today.</div>'
      : '';
    const recentEps = (Array.isArray(auto.recent_episodes) ? auto.recent_episodes : []).slice(0, 5);

    container.innerHTML = `
      <div class="autonomic-risk-card risk-low" style="text-align:left;">
        <div class="autonomic-safety-title">
          <span>⚡ Immediate Capture</span>
          <span>1-Tap</span>
        </div>
        <div class="autonomic-safety-copy">Experiencing dizziness, presyncope, dissociation, visual shift, or dread? Tap once to timestamp onset immediately; fill in symptoms once clear.</div>
        ${illnessNote}
        <div style="margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow()">
            ⚡ I'm Having a Funny Turn Now
          </button>
        </div>
      </div>

      <div style="margin-top:12px;">
        <button type="button" class="autonomic-tap-btn is-outline" onclick="toggleBackdateEpisodeForm()">
          ${_backdateOpen ? '▲ Hide Past / Backdated Episode Form' : '🕒 Log Past / Backdated Funny Turn'}
        </button>
      </div>

      ${_backdateOpen ? `
        <div class="autonomic-episode-card" style="margin-top:10px;">
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label class="autonomic-label" for="bdOnsetTime">Episode Start (Date &amp; Time)</label>
              <input id="bdOnsetTime" type="datetime-local" class="autonomic-input" value="${_esc(_nowLocalDateTimeInput())}">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div>
                <label class="autonomic-label" for="bdAcuteMins">Acute Peak (mins)</label>
                <input id="bdAcuteMins" type="number" min="0" max="600" class="autonomic-input" value="10" placeholder="10">
              </div>
              <div>
                <label class="autonomic-label" for="bdRecoveryMins">Full Normal (mins)</label>
                <input id="bdRecoveryMins" type="number" min="0" max="1440" class="autonomic-input" value="45" placeholder="45">
              </div>
            </div>
            <div>
              <label class="autonomic-label">Symptoms</label>
              <div class="autonomic-chip-grid">
                ${symCat.map((s) => {
                  const sel = _bdSymptoms.has(s.key);
                  return `
                    <button type="button" class="autonomic-chip ${sel ? 'is-selected' : ''}" onclick="toggleBackdateSymptom('${_esc(s.key)}')">
                      <span class="autonomic-chip-check">${sel ? '✓' : ''}</span>
                      <span>${_esc(s.label)}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
            <div>
              <label class="autonomic-label">Triggers / Context</label>
              <div class="autonomic-chip-grid">
                ${trigCat.map((t) => {
                  const sel = _bdTriggers.has(t.key);
                  return `
                    <button type="button" class="autonomic-chip ${sel ? 'is-selected' : ''}" onclick="toggleBackdateTrigger('${_esc(t.key)}')">
                      <span class="autonomic-chip-check">${sel ? '✓' : ''}</span>
                      <span>${_esc(t.label)}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
            <div>
              <label class="autonomic-label" for="bdSeverity">Severity</label>
              <select id="bdSeverity" class="autonomic-input">
                <option value="mild">Mild</option>
                <option value="moderate" selected>Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </div>
            <div>
              <label class="autonomic-label" for="bdNotes">Notes</label>
              <textarea id="bdNotes" class="autonomic-input" rows="2" placeholder="Context, warning signs, posture..."></textarea>
            </div>
            <button type="button" class="autonomic-tap-btn is-calm" onclick="submitBackdatedEpisode()">✓ Save Past Episode &amp; Attach ±60m Garmin Data</button>
          </div>
        </div>
      ` : ''}

      ${recentEps.length ? `
        <div style="margin-top:14px;">
          <label class="autonomic-label">Recent Logged Episodes (${recentEps.length})</label>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${recentEps.map((rEp) => `
              <div class="autonomic-episode-card">
                <div class="autonomic-episode-head">
                  <div>
                    <strong style="font-size:13px; color:var(--text);">${_esc(_formatClockUk(rEp.onset_time))}</strong>
                    <div style="font-size:11px; color:var(--text-secondary);">
                      ${_esc(rEp.state)} • ${_esc(String(rEp.severity || 'moderate').toUpperCase())}
                      ${rEp.total_recovery_duration_mins != null ? ` • ${rEp.total_recovery_duration_mins}m` : ''}
                    </div>
                  </div>
                  <div class="autonomic-ep-actions">
                    ${rEp.state !== 'RESOLVED' ? `<button type="button" class="autonomic-mini-btn is-calm" onclick="endEpisodeNow('${_esc(rEp.id)}')">⏹ End Now</button>` : ''}
                    <button type="button" class="autonomic-mini-btn is-danger" onclick="deleteLoggedEpisode('${_esc(rEp.id)}')">🗑️ Delete</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  }

  function _renderIllnessSubview(auto) {
    const container = document.getElementById('autonomicViewIllness');
    if (!container) return;

    const ill = auto.illness || {};
    const logs = Array.isArray(ill.recent_logs) ? ill.recent_logs : [];
    const loggedMap = {};
    logs.forEach((l) => { if (l && l.date_str) loggedMap[l.date_str] = l; });

    const todayIso = _todayUkIso();
    if (!_illnessSelectedDate) _illnessSelectedDate = todayIso;
    const selectedLog = loggedMap[_illnessSelectedDate] || null;
    if (selectedLog && _illnessSymptoms.size === 0 && !_illnessNotes) {
      _illnessSeverity = selectedLog.severity || 'moderate';
      _illnessNotes = selectedLog.notes || '';
      _illnessSymptoms = new Set(Array.isArray(selectedLog.symptoms) ? selectedLog.symptoms : []);
    }

    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      last7.push(_dateOffsetIso(i));
    }
    const symCat = Array.isArray(auto.illness_symptom_catalog) && auto.illness_symptom_catalog.length ? auto.illness_symptom_catalog : ILLNESS_SYMPTOMS_DEFAULT;

    container.innerHTML = `
      <div class="illness-today-banner">
        <div class="autonomic-safety-title">
          <span>🤒 Illness &amp; Sick-Day Mode</span>
          <span>${ill.active_today ? `Active (Day ${Math.max(1, Number(ill.current_streak_days || 1))})` : 'Not Sick Today'}</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">
          Logging illness days shifts today's Fuel to <strong>Maintenance (Protein Locked)</strong>, swaps training to <strong>Rest</strong>, excludes sick days (+1d rebound) from <strong>14d Adaptive TDEE</strong>, activates a <strong>48h Recovery Scale Shield</strong> after clearing, and links illness to episode patterns.
        </div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          ${ill.active_today
            ? `<button type="button" class="autonomic-tap-btn is-calm" onclick="saveIllnessLog('${todayIso}', 'clear')">✓ I'm Better Today (Clear Today)</button>`
            : `<button type="button" class="autonomic-tap-btn is-illness" onclick="saveIllnessLog('${todayIso}', 'active')">🤒 Mark Today as Sick</button>`}
        </div>
      </div>

      <div style="margin-top:12px;">
        <label class="autonomic-label">Quick Backdate / Toggle Recent Days (e.g. Mon / Tue / Wed)</label>
        <div class="autonomic-day-strip">
          ${last7.map((dStr) => {
            const isSick = Boolean(loggedMap[dStr]);
            const isSel = _illnessSelectedDate === dStr;
            return `
              <button type="button" class="autonomic-day-chip ${isSick ? 'is-sick' : ''} ${isSel ? 'is-selected' : ''}" onclick="selectIllnessDate('${dStr}')">
                <span>${_esc(_shortDayLabel(dStr))}</span>
                <span>${isSick ? '🤒 Sick' : 'Clear'}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <div class="autonomic-episode-card" style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <strong style="font-size:13px; color:var(--text);">Selected Date: ${_esc(_illnessSelectedDate)}</strong>
            <div style="font-size:11.5px; color:var(--text-secondary);">${selectedLog ? `Currently Logged (${_esc(selectedLog.severity)})` : 'Not marked as ill'}</div>
          </div>
          <input type="date" id="illnessDateInput" class="autonomic-input" style="width:auto;" max="${todayIso}" value="${_esc(_illnessSelectedDate)}" onchange="selectIllnessDate(this.value)">
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label">Illness Severity</label>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            ${['mild', 'moderate', 'severe'].map((sv) => `
              <button type="button" class="autonomic-chip ${_illnessSeverity === sv ? 'is-selected' : ''}" onclick="setIllnessSeverity('${sv}')">
                <span class="autonomic-chip-check">${_illnessSeverity === sv ? '✓' : ''}</span>
                <span>${sv.toUpperCase()}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label">Symptoms</label>
          <div class="autonomic-chip-grid">
            ${symCat.map((s) => {
              const sel = _illnessSymptoms.has(s.key);
              return `
                <button type="button" class="autonomic-chip ${sel ? 'is-selected' : ''}" onclick="toggleIllnessSymptom('${_esc(s.key)}')">
                  <span class="autonomic-chip-check">${sel ? '✓' : ''}</span>
                  <span>${_esc(s.label)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label" for="illnessNotesInput">Notes (Cravings, Fever, Recovery)</label>
          <textarea id="illnessNotesInput" class="autonomic-input" rows="2" placeholder="e.g. Viral malaise, strong cravings, resting..." oninput="setIllnessNotes(this.value)">${_esc(_illnessNotes)}</textarea>
        </div>

        <div style="display:grid; grid-template-columns:2fr 1fr; gap:8px; margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-illness" onclick="saveIllnessLog('${_esc(_illnessSelectedDate)}', 'active')">✓ Save Sick Day</button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="saveIllnessLog('${_esc(_illnessSelectedDate)}', 'clear')">Clear Day</button>
        </div>
      </div>
    `;
  }

  function _renderSparkRow(series, maxScale) {
    if (!Array.isArray(series) || series.length === 0) return '<div style="font-size:11px; color:var(--text-secondary);">Waiting for Garmin watch sync...</div>';
    const bars = series.slice(0, 32).map((pt) => {
      const v = Number(pt.v || 0);
      const hPct = Math.max(12, Math.min(100, Math.round((v / maxScale) * 100)));
      const cls = v >= 75 ? 'is-high' : (v > 25 ? 'is-mid' : 'is-low');
      return `<div class="autonomic-spark-bar ${cls}" style="height:${hPct}%;" title="${_esc(`${pt.offset_m}m: ${v}`)}"></div>`;
    }).join('');
    return `<div class="autonomic-spark-row">${bars}</div>`;
  }

  function _renderPatternsSubview(auto) {
    const container = document.getElementById('autonomicViewPatterns');
    if (!container) return;

    const pat = auto.patterns || {};
    const risk = pat.prodromal_risk || { level: 'low', label: 'Low Baseline', score: 0, drivers: [] };
    const drivers = Array.isArray(risk.drivers) ? risk.drivers : [];
    const lvl1 = auto.level1 || {};
    const lvl2 = auto.level2 || {};
    const acuteStats = pat.acute_duration_stats || {};
    const recStats = pat.total_recovery_stats || {};
    const topSyms = Array.isArray(pat.top_symptoms) ? pat.top_symptoms : [];
    const topTrigs = Array.isArray(pat.top_triggers) ? pat.top_triggers : [];
    const comp = pat.prodrome_comparison || {};
    const eps = Array.isArray(auto.recent_episodes) ? auto.recent_episodes : [];
    const riskCls = risk.level === 'high' ? 'risk-high' : (risk.level === 'elevated' ? 'risk-elevated' : 'risk-low');

    container.innerHTML = `
      <div class="autonomic-risk-card ${riskCls}">
        <div class="autonomic-safety-title">
          <span>🎯 Heading Toward Episode Risk</span>
          <span class="autonomic-risk-pill">${_esc(String(risk.level || 'low').toUpperCase())} (${Number(risk.score || 0)}/100)</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">${_esc(risk.label || '')}</div>
        ${drivers.length ? `
          <div class="autonomic-driver-list">
            ${drivers.map((d) => `<div class="autonomic-driver-item">• ${_esc(d)}</div>`).join('')}
          </div>
        ` : `<div class="autonomic-driver-item" style="margin-top:6px;">No active prodromal red flags detected on current telemetry.</div>`}
      </div>

      <div class="autonomic-stat-grid cols-3" style="margin-top:10px;">
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Sleep Stress</div>
          <div class="autonomic-stat-val">${lvl1.sleep_avg_stress != null ? lvl1.sleep_avg_stress : '--'}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Rest ≤25</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Overnight HRV</div>
          <div class="autonomic-stat-val">${lvl1.hrv_last_night != null ? `${lvl1.hrv_last_night}ms` : '--'}</div>
          <div style="font-size:10px; color:var(--text-secondary);">7d: ${lvl1.hrv_7d_baseline != null ? `${lvl1.hrv_7d_baseline}ms` : '--'}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Day &gt;25 Streak</div>
          <div class="autonomic-stat-val">${Number(lvl2.max_streak_mins || 0)}m</div>
          <div style="font-size:10px; color:var(--text-secondary);">Alert ≥240m</div>
        </div>
      </div>

      <div class="autonomic-stat-grid cols-3" style="margin-top:8px;">
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Total Logged</div>
          <div class="autonomic-stat-val">${Number(pat.total_episodes || 0)}</div>
          <div style="font-size:10px; color:var(--text-secondary);">7d: ${Number(pat.count_7d || 0)} • 30d: ${Number(pat.count_30d || 0)}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Avg Acute Peak</div>
          <div class="autonomic-stat-val">${acuteStats.avg != null ? `${Math.round(Number(acuteStats.avg))}m` : '--'}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Med: ${acuteStats.median != null ? `${Math.round(Number(acuteStats.median))}m` : '--'}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Avg Full Lag</div>
          <div class="autonomic-stat-val">${recStats.avg != null ? `${Math.round(Number(recStats.avg))}m` : '--'}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Med: ${recStats.median != null ? `${Math.round(Number(recStats.median))}m` : '--'}</div>
        </div>
      </div>

      <div class="autonomic-episode-card" style="margin-top:10px;">
        <div style="font-size:12px; font-weight:800; color:var(--text);">Pre-Episode vs Normal Day Biometrics</div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px; line-height:1.5;">
          Prior-Night HRV: Ep days <strong>${comp.episode_days_avg_hrv != null ? `${comp.episode_days_avg_hrv}ms` : '--'}</strong> vs Baseline <strong>${comp.baseline_days_avg_hrv != null ? `${comp.baseline_days_avg_hrv}ms` : '--'}</strong><br>
          Sleep Stress Avg: Ep days <strong>${comp.episode_days_avg_sleep_stress != null ? comp.episode_days_avg_sleep_stress : '--'}</strong> vs Baseline <strong>${comp.baseline_days_avg_sleep_stress != null ? comp.baseline_days_avg_sleep_stress : '--'}</strong><br>
          Illness Co-Occurrence: <strong>${Number(pat.illness_co_occurrence_pct || 0)}%</strong> of episodes overlapped sick days
        </div>
      </div>

      ${(topSyms.length || topTrigs.length) ? `
        <div class="autonomic-stat-grid cols-2" style="margin-top:10px;">
          <div class="autonomic-episode-card">
            <div style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:4px;">Top Symptoms</div>
            ${topSyms.slice(0, 5).map((s) => `<div style="font-size:11.5px; color:var(--text-secondary);">• ${_esc(s.label)} (${s.count}, ${s.pct}%)</div>`).join('') || '<div style="font-size:11.5px; color:var(--text-secondary);">None logged yet</div>'}
          </div>
          <div class="autonomic-episode-card">
            <div style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:4px;">Top Triggers</div>
            ${topTrigs.slice(0, 5).map((t) => `<div style="font-size:11.5px; color:var(--text-secondary);">• ${_esc(t.label)} (${t.count}, ${t.pct}%)</div>`).join('') || '<div style="font-size:11.5px; color:var(--text-secondary);">None logged yet</div>'}
          </div>
        </div>
      ` : ''}

      <div style="margin-top:12px;">
        <label class="autonomic-label">Episode Timeline &amp; ±60m Garmin Snapshots (${eps.length})</label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${eps.length ? eps.map((ep) => {
            const snap = ep.biometric_snapshot || {};
            const st = snap.stress || {};
            const hr = snap.hr || {};
            return `
              <div class="autonomic-episode-card">
                <div class="autonomic-episode-head">
                  <div>
                    <strong style="font-size:13px; color:var(--text);">${_esc(_formatClockUk(ep.onset_time))}</strong>
                    <div style="font-size:11px; color:var(--text-secondary);">
                      ${_esc(ep.state)} • ${_esc(String(ep.severity || 'moderate').toUpperCase())}
                      ${ep.acute_duration_mins != null ? ` • Peak ${ep.acute_duration_mins}m` : ''}
                      ${ep.total_recovery_duration_mins != null ? ` • Recovery ${ep.total_recovery_duration_mins}m` : ''}
                      ${ep.illness_active ? ' • 🤒 Sick' : ''}
                    </div>
                  </div>
                  <div class="autonomic-ep-actions">
                    ${ep.state !== 'RESOLVED' ? `<button type="button" class="autonomic-mini-btn is-calm" onclick="endEpisodeNow('${_esc(ep.id)}')">⏹ End Now</button>` : ''}
                    <button type="button" class="autonomic-mini-btn is-danger" onclick="deleteLoggedEpisode('${_esc(ep.id)}')">🗑️ Delete</button>
                  </div>
                </div>
                <div class="autonomic-tag-list" style="margin-top:6px;">
                  ${(ep.symptoms || []).map((s) => `<span class="autonomic-tag">${_esc(s.replace(/_/g, ' '))}</span>`).join('')}
                  ${(ep.triggers || []).map((t) => `<span class="autonomic-tag">${_esc(t.replace(/_/g, ' '))}</span>`).join('')}
                </div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:6px;">
                  Snapshot (${_esc(ep.biometric_snapshot_status || 'pending')}): Peak Stress <strong>${st.peak != null ? st.peak : '--'}</strong> • Peak HR <strong>${hr.peak != null ? `${hr.peak} bpm` : '--'}</strong> • Prior HRV <strong>${snap.prior_night_hrv != null ? `${snap.prior_night_hrv}ms` : '--'}</strong>
                </div>
                ${_renderSparkRow(st.series, 100)}
                ${ep.notes ? `<div style="font-size:11.5px; color:var(--text); margin-top:5px;">"${_esc(ep.notes)}"</div>` : ''}
              </div>
            `;
          }).join('') : '<div class="autonomic-episode-card" style="font-size:12px; color:var(--text-secondary);">No funny turns logged yet. Tap Capture to log live or backdate prior turns.</div>'}
        </div>
      </div>
    `;
  }

  function _renderExportSubview(auto) {
    const container = document.getElementById('autonomicViewExport');
    if (!container) return;

    const pathways = Array.isArray(auto.differential_pathways) ? auto.differential_pathways : [];
    const pat = auto.patterns || {};

    container.innerHTML = `
      <div class="autonomic-disclaimer-box">
        <strong>Non-Diagnostic Clinical Review Notice:</strong><br>
        ${_esc(auto.clinical_disclaimer || 'Self-monitoring record only — review with GP / Neurology / Cardiology.')}
      </div>

      <div class="autonomic-episode-card" style="margin-top:10px;">
        <div style="font-size:13px; font-weight:800; color:var(--text);">One-Click Clinician Exports</div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px;">
          Includes ${Number(pat.total_episodes || 0)} logged episode(s), recovery lag durations, illness overlap, and ±60 minute Fenix 8 Stress, Heart Rate &amp; prior-night HRV telemetry formatted for GP, Neurology (ambulatory EEG/MRI), and Cardiology (Holter/tilt-table).
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-calm" onclick="openClinicalReportPrintView()">
            🖨 Open Clinical Summary / Save PDF
          </button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="downloadAutonomicCsv()">
            ⬇ Download Clinical CSV Spreadsheet
          </button>
        </div>
      </div>

      <div style="margin-top:12px;">
        <label class="autonomic-label">Four Differential Pathways Monitored (Open Differential)</label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${pathways.map((pw) => `
            <div class="autonomic-episode-card">
              <strong style="font-size:12.5px; color:var(--text);">${_esc(pw.label)}</strong>
              <div style="font-size:11.5px; color:var(--text-secondary); margin-top:3px;">${_esc(pw.summary)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderAutonomicUi(summaryOverride) {
    if (summaryOverride && summaryOverride.autonomic && typeof window !== 'undefined') {
      if (!window.PULSE_ANALYTICS_SUMMARY || typeof window.PULSE_ANALYTICS_SUMMARY !== 'object') {
        window.PULSE_ANALYTICS_SUMMARY = {};
      }
      window.PULSE_ANALYTICS_SUMMARY.autonomic = summaryOverride.autonomic;
      try { localStorage.setItem(AUTONOMIC_CACHE_KEY, JSON.stringify(summaryOverride.autonomic)); } catch (e) {}
    }

    const auto = getAutonomicSummary();
    renderHeaderPill(auto);
    renderTodayBanners(auto);
    renderBodySummaryCard(auto);

    if (_activeSubview === 'capture') _renderCaptureSubview(auto);
    else if (_activeSubview === 'illness') _renderIllnessSubview(auto);
    else if (_activeSubview === 'patterns') _renderPatternsSubview(auto);
    else if (_activeSubview === 'export') _renderExportSubview(auto);

    _ensureTimerRunning();
  }

  function switchAutonomicView(viewKey) {
    const valid = ['capture', 'illness', 'patterns', 'export'];
    _activeSubview = valid.includes(viewKey) ? viewKey : 'capture';

    valid.forEach((k) => {
      const btn = document.getElementById(`btnAutonomicView_${k}`);
      const panel = document.getElementById(`autonomicView${k.charAt(0).toUpperCase()}${k.slice(1)}`);
      if (btn && btn.classList) btn.classList.toggle('active', k === _activeSubview);
      if (panel && panel.classList) panel.classList.toggle('active', k === _activeSubview);
    });
    renderAutonomicUi();
  }

  function openAutonomicModal(viewKey) {
    if (typeof switchTab === 'function') {
      switchTab('health');
    } else {
      const tab = document.getElementById('tab-health');
      const nav = document.getElementById('nav-health');
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      if (tab && tab.classList) tab.classList.add('active');
      if (nav && nav.classList) nav.classList.add('active');
    }
    if (viewKey) switchAutonomicView(viewKey);
    else renderAutonomicUi();
    if (typeof pulseHaptic === 'function') pulseHaptic(20);
  }

  function closeAutonomicModal() {
    if (typeof switchTab === 'function') switchTab('today');
    _ensureTimerRunning();
  }

  function _localIsoNow() {
    return new Date().toISOString();
  }

  async function _postWithOfflineFallback(endpoint, payload, optimisticMutator) {
    let shouldQueue = false;
    try {
      const fetcher = typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch;
      const res = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: 6000
      });
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.autonomic) {
          _saveAutonomicSummary(data.autonomic, data.state || null, data.flex_refeed || null);
        }
        return data;
      }
      if (typeof window._shouldQueueOfflineResponse === 'function') {
        shouldQueue = window._shouldQueueOfflineResponse(res);
      } else {
        shouldQueue = !res || res.status === 0 || res.status >= 500 || res.status === 401;
      }
    } catch (e) {
      shouldQueue = true;
    }

    if (shouldQueue) {
      if (typeof window.enqueueOfflineWrite === 'function') {
        window.enqueueOfflineWrite(endpoint, payload, 'POST');
      }
      if (typeof optimisticMutator === 'function') {
        const cur = JSON.parse(JSON.stringify(getAutonomicSummary()));
        optimisticMutator(cur);
        _saveAutonomicSummary(cur, null, null);
      }
      if (typeof showToast === 'function') {
        showToast('Saved locally offline — will sync automatically when online');
      }
    }
    return null;
  }

  async function startAcuteEpisodeNow(spikeTsMs = 0, spikeAutoDetected = false) {
    if (_actionInFlight) return;
    _actionInFlight = true;
    try {
      const nowMs = Date.now();
      const onsetIso = spikeTsMs && Number(spikeTsMs) > 0 ? new Date(Number(spikeTsMs)).toISOString() : _localIsoNow();
      const epId = `ep_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
      const clientEvt = `evt_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        id: epId,
        onset_time: onsetIso,
        severity: 'moderate',
        symptoms: [],
        triggers: [],
        spike_auto_detected: Boolean(spikeAutoDetected),
        client_event_id: clientEvt
      };

      await _postWithOfflineFallback('/api/health/episodes', payload, (cur) => {
        const ep = {
          id: epId,
          client_event_id: clientEvt,
          state: 'ACUTE_EPISODE',
          onset_time: onsetIso,
          date_str: _todayUkIso(),
          acute_peak_end_time: null,
          full_recovery_time: null,
          user_recovered_at: null,
          biometric_recovered_at: null,
          severity: 'moderate',
          symptoms: [],
          triggers: cur.illness && cur.illness.active_today ? ['illness_infection'] : [],
          illness_active: Boolean(cur.illness && cur.illness.active_today),
          notes: '',
          biometric_snapshot_status: 'pending'
        };
        cur.active_episode = ep;
        cur.system_state = 'ACUTE_EPISODE';
        cur.alert_level = 2;
        cur.safety_banner = {
          active: true,
          level: 2,
          tone: 'red',
          title: 'ACTIVE EPISODE TRACKING',
          reasons: ['Acute episode capture started (offline queue active)'],
          advisory: 'Avoid driving (Volkswagen ID. Buzz) or solo exertion until recovered.',
          avoid_driving: true,
          avoid_solo_exertion: true
        };
        cur.recent_episodes = [ep].concat(cur.recent_episodes || []);
      });
      _draftSyncedEpId = null;
      openAutonomicModal('capture');
      if (typeof showToast === 'function') showToast('⚡ Episode capture started — rest safely');
    } finally {
      _actionInFlight = false;
    }
  }

  async function updateActiveEpisode(action) {
    const auto = getAutonomicSummary();
    const ep = auto.active_episode;
    if (!ep) return;
    const nowIso = _localIsoNow();
    const payload = {
      id: ep.id,
      client_event_id: ep.client_event_id || undefined,
      action,
      timestamp: nowIso,
      symptoms: Array.from(_draftSymptoms),
      triggers: Array.from(_draftTriggers),
      severity: _draftSeverity,
      notes: _draftNotes
    };

    await _postWithOfflineFallback('/api/health/episodes/update', payload, (cur) => {
      const target = cur.active_episode;
      if (!target) return;
      target.symptoms = payload.symptoms;
      target.triggers = payload.triggers;
      target.severity = payload.severity;
      target.notes = payload.notes;
      if (action === 'mark_acute_end') {
        target.acute_peak_end_time = nowIso;
        target.state = 'POST_EPISODE_RECOVERY';
        cur.system_state = 'POST_EPISODE_RECOVERY';
      } else if (action === 'mark_user_recovered') {
        target.user_recovered_at = nowIso;
        if (!target.acute_peak_end_time) target.acute_peak_end_time = nowIso;
        target.state = 'POST_EPISODE_RECOVERY';
        cur.system_state = 'POST_EPISODE_RECOVERY';
      } else if (action === 'confirm_resolved_override') {
        if (!target.acute_peak_end_time) target.acute_peak_end_time = nowIso;
        target.user_recovered_at = target.user_recovered_at || nowIso;
        target.full_recovery_time = nowIso;
        target.state = 'RESOLVED';
        cur.active_episode = null;
        cur.system_state = (cur.level1 && cur.level1.active) || (cur.level2 && cur.level2.active) ? 'VULNERABILITY_ALERT' : 'IDLE';
        cur.safety_banner.active = cur.system_state === 'VULNERABILITY_ALERT';
      }
      cur.recent_episodes = (cur.recent_episodes || []).map((r) => (r.id === target.id ? target : r));
    });
    if (action === 'confirm_resolved_override') {
      _draftSyncedEpId = null;
      _stopTimer();
      if (typeof showToast === 'function') showToast('✓ Episode ended & resolved');
    } else if (action === 'mark_acute_end') {
      if (typeof showToast === 'function') showToast('✓ Acute peak marked ended — recovery timer active');
    } else if (action === 'mark_user_recovered') {
      if (typeof showToast === 'function') showToast('✓ Feeling normal logged — tap End & Close Episode Now to finish immediately');
    }
  }

  async function endEpisodeNow(epId) {
    const auto = getAutonomicSummary();
    const targetId = epId || (auto.active_episode && auto.active_episode.id);
    if (!targetId) return;
    const nowIso = _localIsoNow();
    const payload = {
      id: targetId,
      action: 'confirm_resolved_override',
      timestamp: nowIso
    };
    await _postWithOfflineFallback('/api/health/episodes/update', payload, (cur) => {
      if (cur.active_episode && cur.active_episode.id === targetId) {
        cur.active_episode = null;
        cur.system_state = (cur.level1 && cur.level1.active) || (cur.level2 && cur.level2.active) ? 'VULNERABILITY_ALERT' : 'IDLE';
        cur.safety_banner.active = cur.system_state === 'VULNERABILITY_ALERT';
      }
      cur.recent_episodes = (cur.recent_episodes || []).map((r) => {
        if (r.id !== targetId) return r;
        return {
          ...r,
          acute_peak_end_time: r.acute_peak_end_time || nowIso,
          user_recovered_at: r.user_recovered_at || nowIso,
          full_recovery_time: nowIso,
          state: 'RESOLVED'
        };
      });
    });
    _draftSyncedEpId = null;
    _stopTimer();
    if (typeof showToast === 'function') showToast('✓ Episode ended & resolved');
  }

  function saveActiveEpisodeDetails() {
    return updateActiveEpisode('edit_details').then(() => {
      if (typeof showToast === 'function') showToast('✓ Episode symptoms & triggers saved');
    });
  }

  function toggleEpisodeDraftSymptom(key) {
    if (_draftSymptoms.has(key)) _draftSymptoms.delete(key);
    else _draftSymptoms.add(key);
    _renderCaptureSubview(getAutonomicSummary());
  }

  function toggleEpisodeDraftTrigger(key) {
    if (_draftTriggers.has(key)) _draftTriggers.delete(key);
    else _draftTriggers.add(key);
    _renderCaptureSubview(getAutonomicSummary());
  }

  function setActiveDraftSeverity(sev) {
    _draftSeverity = sev;
    _renderCaptureSubview(getAutonomicSummary());
  }

  function setActiveDraftNotes(val) {
    _draftNotes = String(val || '');
  }

  function toggleBackdateEpisodeForm() {
    _backdateOpen = !_backdateOpen;
    _renderCaptureSubview(getAutonomicSummary());
  }

  function toggleBackdateSymptom(key) {
    if (_bdSymptoms.has(key)) _bdSymptoms.delete(key);
    else _bdSymptoms.add(key);
    _renderCaptureSubview(getAutonomicSummary());
  }

  function toggleBackdateTrigger(key) {
    if (_bdTriggers.has(key)) _bdTriggers.delete(key);
    else _bdTriggers.add(key);
    _renderCaptureSubview(getAutonomicSummary());
  }

  async function submitBackdatedEpisode() {
    const onsetRaw = (document.getElementById('bdOnsetTime') || {}).value;
    const acuteMins = Math.max(0, Number((document.getElementById('bdAcuteMins') || {}).value || 0));
    const recMins = Math.max(0, Number((document.getElementById('bdRecoveryMins') || {}).value || 0));
    const sev = (document.getElementById('bdSeverity') || {}).value || 'moderate';
    const notes = (document.getElementById('bdNotes') || {}).value || '';

    const onsetDate = onsetRaw ? new Date(onsetRaw) : new Date();
    const onsetMs = Number.isFinite(onsetDate.getTime()) ? onsetDate.getTime() : Date.now();
    const acuteEndIso = acuteMins > 0 ? new Date(onsetMs + acuteMins * 60000).toISOString() : null;
    const fullRecIso = recMins > 0 ? new Date(onsetMs + recMins * 60000).toISOString() : null;

    const nowMs = Date.now();
    const epId = `ep_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id: epId,
      onset_time: new Date(onsetMs).toISOString(),
      acute_peak_end_time: acuteEndIso,
      full_recovery_time: fullRecIso,
      severity: sev,
      symptoms: Array.from(_bdSymptoms),
      triggers: Array.from(_bdTriggers),
      notes,
      client_event_id: `evt_${nowMs}_${Math.random().toString(36).slice(2, 8)}`
    };

    await _postWithOfflineFallback('/api/health/episodes', payload, (cur) => {
      const ep = {
        ...payload,
        date_str: payload.onset_time.slice(0, 10),
        state: fullRecIso ? 'RESOLVED' : (acuteEndIso ? 'POST_EPISODE_RECOVERY' : 'ACUTE_EPISODE'),
        acute_duration_mins: acuteMins || null,
        total_recovery_duration_mins: recMins || null,
        biometric_snapshot_status: 'pending'
      };
      cur.recent_episodes = [ep].concat(cur.recent_episodes || []);
    });
    _backdateOpen = false;
    _bdSymptoms.clear();
    _bdTriggers.clear();
    switchAutonomicView('patterns');
    if (typeof showToast === 'function') showToast('✓ Past episode saved with Garmin snapshot');
  }

  async function deleteLoggedEpisode(epId) {
    if (!epId) return;
    await _postWithOfflineFallback('/api/health/episodes/delete', { id: epId }, (cur) => {
      cur.recent_episodes = (cur.recent_episodes || []).filter((e) => e.id !== epId);
      if (cur.active_episode && cur.active_episode.id === epId) {
        cur.active_episode = null;
        cur.system_state = (cur.level1 && cur.level1.active) || (cur.level2 && cur.level2.active) ? 'VULNERABILITY_ALERT' : 'IDLE';
        if (cur.safety_banner) {
          cur.safety_banner.active = cur.system_state === 'VULNERABILITY_ALERT';
        }
      }
    });
    _draftSyncedEpId = null;
    _stopTimer();
    if (typeof showToast === 'function') showToast('🗑️ Episode deleted');
  }

  async function dismissAutonomicSpike(spikeTsMs) {
    await _postWithOfflineFallback('/api/health/autonomic/dismiss-spike', { spike_ts_ms: Number(spikeTsMs) || Date.now() }, (cur) => {
      cur.acute_spike = null;
    });
  }

  function selectIllnessDate(dateStr) {
    _illnessSelectedDate = String(dateStr || _todayUkIso()).slice(0, 10);
    const auto = getAutonomicSummary();
    const logs = (auto.illness && Array.isArray(auto.illness.recent_logs)) ? auto.illness.recent_logs : [];
    const found = logs.find((l) => l.date_str === _illnessSelectedDate);
    if (found) {
      _illnessSeverity = found.severity || 'moderate';
      _illnessNotes = found.notes || '';
      _illnessSymptoms = new Set(Array.isArray(found.symptoms) ? found.symptoms : []);
    } else {
      _illnessSeverity = 'moderate';
      _illnessNotes = '';
      _illnessSymptoms = new Set();
    }
    _renderIllnessSubview(auto);
  }

  function setIllnessSeverity(sev) {
    _illnessSeverity = sev;
    _renderIllnessSubview(getAutonomicSummary());
  }

  function toggleIllnessSymptom(key) {
    if (_illnessSymptoms.has(key)) _illnessSymptoms.delete(key);
    else _illnessSymptoms.add(key);
    _renderIllnessSubview(getAutonomicSummary());
  }

  function setIllnessNotes(val) {
    _illnessNotes = String(val || '');
  }

  async function saveIllnessLog(dateStr, status = 'active') {
    const dKey = String(dateStr || _illnessSelectedDate || _todayUkIso()).slice(0, 10);
    const payload = {
      date_str: dKey,
      status,
      severity: _illnessSeverity,
      symptoms: Array.from(_illnessSymptoms),
      notes: _illnessNotes
    };

    await _postWithOfflineFallback('/api/health/illness', payload, (cur) => {
      if (!cur.illness) cur.illness = { active_today: false, recent_logs: [] };
      const logs = Array.isArray(cur.illness.recent_logs) ? cur.illness.recent_logs.filter((l) => l.date_str !== dKey) : [];
      if (status !== 'clear') {
        logs.unshift({ date_str: dKey, status, severity: _illnessSeverity, symptoms: payload.symptoms, notes: _illnessNotes });
      }
      cur.illness.recent_logs = logs;
      if (dKey === _todayUkIso()) {
        cur.illness.active_today = status !== 'clear';
      }
    });
    if (typeof fetchAnalyticsSummary === 'function') {
      try { await fetchAnalyticsSummary(true); } catch (e) {}
    }
    if (typeof showToast === 'function') {
      showToast(status === 'clear' ? `✓ Cleared sick log for ${dKey}` : `🤒 Saved Sick Day (${dKey})`);
    }
  }

  async function downloadAutonomicCsv() {
    try {
      const fetcher = typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch;
      const res = await fetcher('/api/health/episodes/export?format=csv', { timeoutMs: 8000 });
      if (res && res.ok) {
        const csvText = await res.text();
        _triggerTextDownload('pulse-clinical-episodes.csv', csvText, 'text/csv;charset=utf-8');
        if (typeof showToast === 'function') showToast('⬇ Clinical CSV downloaded');
        return;
      }
    } catch (e) {}

    // Offline local CSV fallback
    const eps = getAutonomicSummary().recent_episodes || [];
    const rows = [['episode_id', 'date_uk', 'onset_time_uk', 'state', 'severity', 'acute_mins', 'recovery_mins', 'symptoms', 'triggers', 'notes']];
    eps.forEach((ep) => {
      rows.push([
        ep.id,
        ep.date_str,
        ep.onset_time,
        ep.state,
        ep.severity,
        ep.acute_duration_mins ?? '',
        ep.total_recovery_duration_mins ?? '',
        (ep.symptoms || []).join('; '),
        (ep.triggers || []).join('; '),
        String(ep.notes || '').replace(/"/g, '""')
      ]);
    });
    const body = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    _triggerTextDownload('pulse-clinical-episodes-offline.csv', body, 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('⬇ Offline Clinical CSV downloaded');
  }

  function _triggerTextDownload(filename, content, mimeType) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || !URL || typeof URL.createObjectURL !== 'function') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
  }

  function buildClinicalReportHtml(reportData) {
    const data = reportData || {};
    const pat = data.patterns || {};
    const acute = pat.acute_duration_stats || {};
    const rec = pat.total_recovery_stats || {};
    const eps = Array.isArray(data.episodes) ? data.episodes : (data.recent_episodes || []);
    const illLogs = Array.isArray(data.illness_logs) ? data.illness_logs : ((data.illness && data.illness.recent_logs) || []);
    const disclaimer = data.clinical_disclaimer || 'Self-monitoring & Garmin biometric correlation record only. Non-diagnostic.';

    const episodeRows = eps.map((ep) => {
      const snap = ep.biometric_snapshot || {};
      const st = snap.stress || {};
      const hr = snap.hr || {};
      const syms = (ep.symptoms || []).map((s) => _esc(s.replace(/_/g, ' '))).join(', ') || 'None recorded';
      const trigs = (ep.triggers || []).map((t) => _esc(t.replace(/_/g, ' '))).join(', ') || 'None recorded';
      return `
        <tr>
          <td><strong>${_esc(_formatClockUk(ep.onset_time))}</strong><br><small>${_esc(ep.severity || 'moderate')}${ep.illness_active ? ' • Sick day' : ''}</small></td>
          <td>Peak: ${ep.acute_duration_mins != null ? `${ep.acute_duration_mins}m` : '--'}<br>Full Rec: ${ep.total_recovery_duration_mins != null ? `${ep.total_recovery_duration_mins}m` : '--'}</td>
          <td>${syms}</td>
          <td>${trigs}</td>
          <td>Stress: Pre ${st.pre_avg ?? '--'} / Peak ${st.peak ?? '--'} / Post ${st.post_avg ?? '--'}<br>HR: Pre ${hr.pre_avg ?? '--'} / Peak ${hr.peak ?? '--'} / Post ${hr.post_avg ?? '--'} bpm<br>Prior HRV: ${snap.prior_night_hrv ?? '--'}ms • Sleep Stress: ${snap.prior_night_sleep_stress ?? '--'}</td>
          <td>${_esc(ep.notes || '')}</td>
        </tr>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PULSE Clinical Autonomic &amp; Paroxysmal Episode Report</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 28px; line-height: 1.45; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #374151; font-size: 12px; margin-bottom: 14px; }
  .disclaimer { border: 1.5px solid #b45309; background: #fffbeb; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  .box { border: 1px solid #d1d5db; padding: 10px; border-radius: 6px; }
  .box .lbl { font-size: 11px; color: #4b5563; text-transform: uppercase; font-weight: bold; }
  .box .val { font-size: 18px; font-weight: bold; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th, td { border: 1px solid #d1d5db; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: bold; }
  @media print { .no-print { display: none; } body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:14px;">
    <button onclick="window.print()" style="padding:10px 16px; font-weight:bold; cursor:pointer;">🖨 Print / Save as PDF</button>
  </div>
  <h1>PULSE — Paroxysmal Episode &amp; Autonomic Clinical Summary</h1>
  <div class="meta">Generated: ${_esc(_formatClockUk(data.generated_at || _localIsoNow()))} • Review Context: GP / Neurology (Ambulatory EEG / MRI) / Cardiology (Holter / Tilt-Table)</div>
  <div class="disclaimer"><strong>Non-Diagnostic Scope:</strong> ${_esc(disclaimer)} Routine 20–40 min resting surface EEG was normal; differential tracking covers Autonomic Dysregulation, Paroxysmal Focal Neurological Signaling, Transient Perfusion/Orthostatic Shifts, and Metabolic/Fuel/Illness Load Triggers.</div>
  <div class="grid">
    <div class="box"><div class="lbl">Total Episodes</div><div class="val">${Number(pat.total_episodes || eps.length || 0)}</div></div>
    <div class="box"><div class="lbl">Avg Acute Peak</div><div class="val">${acute.avg != null ? `${Math.round(Number(acute.avg))} min` : '--'}</div></div>
    <div class="box"><div class="lbl">Avg Full Recovery</div><div class="val">${rec.avg != null ? `${Math.round(Number(rec.avg))} min` : '--'}</div></div>
    <div class="box"><div class="lbl">Sick Days Logged</div><div class="val">${illLogs.length}</div></div>
  </div>
  <h3>Paroxysmal Episode Timeline &amp; ±60 Minute Garmin Telemetry</h3>
  <table>
    <thead>
      <tr>
        <th>Onset &amp; Severity</th>
        <th>Durations</th>
        <th>Symptoms</th>
        <th>Triggers / Context</th>
        <th>±60m Fenix 8 Biometrics</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>${episodeRows || '<tr><td colspan="6">No episodes recorded.</td></tr>'}</tbody>
  </table>
  ${illLogs.length ? `
    <h3 style="margin-top:18px;">Logged Illness / Intercurrent Infection Days</h3>
    <table>
      <thead><tr><th>Date</th><th>Status &amp; Severity</th><th>Symptoms</th><th>Notes</th></tr></thead>
      <tbody>${illLogs.map((l) => `<tr><td>${_esc(l.date_str)}</td><td>${_esc(l.status)} (${_esc(l.severity)})</td><td>${_esc((l.symptoms || []).join(', '))}</td><td>${_esc(l.notes || '')}</td></tr>`).join('')}</tbody>
    </table>
  ` : ''}
</body>
</html>`;
  }

  async function openClinicalReportPrintView() {
    let payload = null;
    try {
      const fetcher = typeof pulseApiFetch === 'function' ? pulseApiFetch : fetch;
      const res = await fetcher('/api/health/episodes/export?format=json', { timeoutMs: 8000 });
      if (res && res.ok) payload = await res.json();
    } catch (e) {}
    if (!payload) {
      const auto = getAutonomicSummary();
      payload = {
        generated_at: _localIsoNow(),
        clinical_disclaimer: auto.clinical_disclaimer,
        patterns: auto.patterns,
        illness_logs: (auto.illness && auto.illness.recent_logs) || [],
        episodes: auto.recent_episodes || []
      };
    }
    const html = buildClinicalReportHtml(payload);
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      const win = window.open('', '_blank', 'noopener');
      if (win && win.document) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        return html;
      }
    }
    _triggerTextDownload('pulse-clinical-report.html', html, 'text/html;charset=utf-8');
    return html;
  }

  if (typeof window !== 'undefined') {
    window.getAutonomicSummary = getAutonomicSummary;
    window.renderAutonomicUi = renderAutonomicUi;
    window.openAutonomicModal = openAutonomicModal;
    window.openHealthTab = openAutonomicModal;
    window.closeAutonomicModal = closeAutonomicModal;
    window.switchAutonomicView = switchAutonomicView;
    window.startAcuteEpisodeNow = startAcuteEpisodeNow;
    window.endEpisodeNow = endEpisodeNow;
    window.updateActiveEpisode = updateActiveEpisode;
    window.saveActiveEpisodeDetails = saveActiveEpisodeDetails;
    window.toggleEpisodeDraftSymptom = toggleEpisodeDraftSymptom;
    window.toggleEpisodeDraftTrigger = toggleEpisodeDraftTrigger;
    window.setActiveDraftSeverity = setActiveDraftSeverity;
    window.setActiveDraftNotes = setActiveDraftNotes;
    window.toggleBackdateEpisodeForm = toggleBackdateEpisodeForm;
    window.toggleBackdateSymptom = toggleBackdateSymptom;
    window.toggleBackdateTrigger = toggleBackdateTrigger;
    window.submitBackdatedEpisode = submitBackdatedEpisode;
    window.deleteLoggedEpisode = deleteLoggedEpisode;
    window.dismissAutonomicSpike = dismissAutonomicSpike;
    window.selectIllnessDate = selectIllnessDate;
    window.setIllnessSeverity = setIllnessSeverity;
    window.toggleIllnessSymptom = toggleIllnessSymptom;
    window.setIllnessNotes = setIllnessNotes;
    window.saveIllnessLog = saveIllnessLog;
    window.downloadAutonomicCsv = downloadAutonomicCsv;
    window.openClinicalReportPrintView = openClinicalReportPrintView;
    window.buildClinicalReportHtml = buildClinicalReportHtml;
    window._stopAutonomicTimer = _stopTimer;
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
      try { renderAutonomicUi(); } catch (e) {}
    }, { once: true });
  }
})();
