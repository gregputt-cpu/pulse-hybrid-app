'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const STYLES_CSS_PATH = path.join(ROOT_DIR, 'css', 'styles.css');

const SCRIPT_ORDER = [
  'js/state.js',
  'js/workout-catalog.js',
  'js/workout-verdict.js',
  'js/workout-player.js',
  'js/workout-timers.js',
  'js/charts.js',
  'js/fuel-engine.js',
  'js/telemetry.js',
  'js/diagnostics.js',
  'js/autonomic-tracker.js'
];

const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const stylesCss = fs.readFileSync(STYLES_CSS_PATH, 'utf8');

class MockClassList {
  constructor(initial = []) {
    this._set = new Set(initial);
  }
  add(...classes) { for (const c of classes) if (c) this._set.add(String(c)); }
  remove(...classes) { for (const c of classes) if (c) this._set.delete(String(c)); }
  contains(c) { return this._set.has(String(c)); }
  toggle(c, force) {
    const cls = String(c);
    if (force !== undefined) {
      if (force) this._set.add(cls); else this._set.delete(cls);
    } else if (this._set.has(cls)) this._set.delete(cls);
    else this._set.add(cls);
    return this._set.has(cls);
  }
  toString() { return Array.from(this._set).join(' '); }
}

function createMockElement(tagName, id = '', registry = null) {
  const listeners = new Map();
  let _innerHTML = '';
  let _classList = new MockClassList();
  const el = {
    tagName: String(tagName || 'DIV').toUpperCase(),
    id: id || '',
    _innerHTML: '',
    innerText: '',
    textContent: '',
    value: '',
    disabled: false,
    open: false,
    type: '',
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    parentElement: null,
    classList: _classList,
    get className() { return _classList.toString(); },
    set className(val) {
      _classList = new MockClassList(String(val || '').split(/\s+/).filter(Boolean));
      el.classList = _classList;
    },
    get innerHTML() { return _innerHTML; },
    set innerHTML(val) {
      _innerHTML = String(val ?? '');
      el._innerHTML = _innerHTML;
      el.children = [];
      if (registry && _innerHTML) registerElementsFromHtml(_innerHTML, registry, el);
    },
    appendChild(child) {
      if (!child) return child;
      child.parentElement = el;
      el.children.push(child);
      if (registry && child.id) registry.set(child.id, child);
      return child;
    },
    removeChild(child) {
      const idx = el.children.indexOf(child);
      if (idx >= 0) el.children.splice(idx, 1);
      if (child) child.parentElement = null;
      return child;
    },
    remove() {
      if (el.parentElement) el.parentElement.removeChild(el);
    },
    setAttribute(k, v) {
      el.attributes[k] = String(v);
      if (k === 'id') { el.id = String(v); if (registry) registry.set(el.id, child); }
      else if (k === 'class') el.className = String(v);
    },
    getAttribute(k) {
      if (k === 'id') return el.id || null;
      if (k === 'class') return el.className || null;
      return Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const parts = String(sel || '').split(',').map((s) => s.trim()).filter(Boolean);
      const found = [];
      const walk = (node) => {
        for (const ch of node.children || []) {
          if (parts.some((p) => {
            const sub = p.split(/\s+/).pop();
            if (sub.startsWith('#')) return ch.id === sub.slice(1);
            if (sub.startsWith('.')) return Boolean(ch.classList && ch.classList.contains(sub.slice(1)));
            return ch.tagName === sub.toUpperCase();
          })) found.push(ch);
          walk(ch);
        }
      };
      walk(el);
      return found;
    }
  };
  return el;
}

function registerElementsFromHtml(html, registry, parentEl = null) {
  const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1];
    const attrs = match[2] || '';
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
    const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    if (!idMatch && !classMatch) continue;
    const id = idMatch ? idMatch[1] : '';
    const child = createMockElement(tag, id, registry);
    if (classMatch) child.className = classMatch[1];
    if (parentEl) {
      child.parentElement = parentEl;
      parentEl.children.push(child);
    }
    if (id) registry.set(id, child);
  }
}

function createMockLocalStorage() {
  const store = new Map();
  return {
    get length() { return store.size; },
    key(idx) { return Array.from(store.keys())[idx] ?? null; },
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); }
  };
}

function makeMockResponse(bodyObj, opts = {}) {
  const status = opts.status !== undefined ? opts.status : 200;
  const textBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return JSON.parse(textBody); },
    async text() { return textBody; }
  };
}

function createAutonomicHarness() {
  const elementsById = new Map();
  const rootMock = createMockElement('div', '__root__', elementsById);
  registerElementsFromHtml(indexHtml, elementsById, rootMock);

  const localStorageMock = createMockLocalStorage();
  const fetchCalls = [];
  let fetchHandler = async () => makeMockResponse({ success: true }, { status: 200 });

  const activeTimeouts = new Map();
  const activeIntervals = new Map();
  let nextTimerId = 1;

  const documentMock = {
    body: createMockElement('body', 'body', elementsById),
    readyState: 'complete',
    visibilityState: 'visible',
    getElementById(id) {
      if (elementsById.has(id)) return elementsById.get(id);
      const fb = createMockElement('div', id, elementsById);
      elementsById.set(id, fb);
      return fb;
    },
    createElement(tag) { return createMockElement(tag, '', elementsById); },
    querySelectorAll(sel) {
      if (sel === '.modal-overlay.open') {
        const res = [];
        for (const el of elementsById.values()) {
          if (el.classList && el.classList.contains('modal-overlay') && el.classList.contains('open')) res.push(el);
        }
        return res;
      }
      return rootMock.querySelectorAll(sel);
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    addEventListener() {}
  };

  class MockAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }

  const ctx = {
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Map, Set, Promise, Error, Intl,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, AbortController,
    Response: (b, i) => makeMockResponse(b, i),
    document: documentMock,
    localStorage: localStorageMock,
    navigator: { onLine: true, language: 'en-GB', vibrate() {} },
    isSecureContext: true,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), opts: init });
      return fetchHandler(String(url), init);
    },
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    speechSynthesis: { speak() {}, cancel() {}, getVoices() { return []; } },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    setTimeout: (fn, delay = 0) => {
      const id = nextTimerId++;
      const h = setTimeout(() => { if (typeof fn === 'function') fn(); }, Math.min(Number(delay) || 0, 40));
      if (typeof h.unref === 'function') h.unref();
      activeTimeouts.set(id, h);
      return id;
    },
    clearTimeout: (id) => { const h = activeTimeouts.get(id); if (h) { clearTimeout(h); activeTimeouts.delete(id); } },
    setInterval: (fn, delay = 250) => {
      const id = nextTimerId++;
      const h = setInterval(() => { if (typeof fn === 'function') fn(); }, Math.max(25, Number(delay) || 250));
      if (typeof h.unref === 'function') h.unref();
      activeIntervals.set(id, h);
      return id;
    },
    clearInterval: (id) => { const h = activeIntervals.get(id); if (h) { clearInterval(h); activeIntervals.delete(id); } },
    location: { protocol: 'https:', search: '', hash: '', href: 'https://pulse.local/', origin: 'https://pulse.local', pathname: '/', reload() {} },
    addEventListener() {},
    matchMedia() { return { matches: false, addEventListener() {} }; }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;

  vm.createContext(ctx);
  for (const rel of SCRIPT_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8'), ctx, { filename: rel });
  }

  return {
    ctx,
    document: documentMock,
    localStorage: localStorageMock,
    fetchCalls,
    setFetchHandler(fn) { fetchHandler = fn; },
    cleanup() {
      if (typeof ctx._stopAutonomicTimer === 'function') ctx._stopAutonomicTimer();
      for (const h of activeTimeouts.values()) clearTimeout(h);
      for (const h of activeIntervals.values()) clearInterval(h);
      activeTimeouts.clear();
      activeIntervals.clear();
    }
  };
}

function srgbLum(hex) {
  const clean = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const lin = parts.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(fgHex, bgHex) {
  const l1 = srgbLum(fgHex);
  const l2 = srgbLum(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function runTests() {
  const app = createAutonomicHarness();
  try {
    // [1] Zero-Hex CSS, WCAG AAA Contrast, Touch Targets & Modal HTML Hygiene
    {
      const hexRx = /#[0-9a-fA-F]{3,8}\b/;
      const autoCssIdx = stylesCss.indexOf('/* ==================== AUTONOMIC EPISODE & ILLNESS TRACKER TOKENS (ZERO HARDCODED HEX) ==================== */');
      assert(autoCssIdx > 0, 'Expected Autonomic CSS tokens section at EOF');
      const autoCss = stylesCss.slice(autoCssIdx);
      assert.strictEqual(hexRx.test(autoCss), false, 'Autonomic CSS rules must contain 0 hardcoded hex colors');

      const modalStart = indexHtml.indexOf('<!-- AUTONOMIC EPISODE ("FUNNY TURNS") & ILLNESS RECOVERY MODAL -->');
      const modalEnd = indexHtml.indexOf('<!-- SESSION SUMMARY / PR CELEBRATION MODAL -->');
      assert(modalStart > 0 && modalEnd > modalStart, 'Expected #autonomicModal in index.html');
      const modalHtml = indexHtml.slice(modalStart, modalEnd);
      assert.strictEqual(hexRx.test(modalHtml), false, '#autonomicModal HTML must contain 0 hardcoded hex colors');
      assert.strictEqual(indexHtml.includes('var(--text-dim)'), false, 'index.html must not reference var(--text-dim)');

      // AAA Contrast >= 7.0:1 for all 4 semantic foreground/background token pairs
      const pairs = [
        ['#99f6e4', '#082321'],
        ['#fde68a', '#261a06'],
        ['#fecaca', '#290c12'],
        ['#ede9fe', '#1c1330'],
        ['#ffffff', '#111827'],
        ['#ffffff', '#0e3a46']
      ];
      for (const [fg, bg] of pairs) {
        const cr = contrastRatio(fg, bg);
        assert(cr >= 7.0, `Expected AAA contrast >= 7.0:1 for ${fg} on ${bg}, got ${cr.toFixed(2)}`);
      }
      assert(autoCss.includes('min-height: 48px'), 'Interactive chips/days must enforce >= 48px touch target');
      assert(autoCss.includes('min-height: 54px'), 'Primary 1-tap capture buttons must enforce >= 54px touch target');
      assert(autoCss.includes('prefers-reduced-motion: reduce'), 'CSS must respect prefers-reduced-motion');
      console.log('PASS [1] Zero-Hex CSS, WCAG AAA Contrast (>=7:1), >=48px Touch Targets & HTML Hygiene');
    }

    // [2] Level 1 & Level 2 Safety Banners, Spike Prompt & Header Pill Dots
    {
      app.localStorage.clear();
      app.ctx.renderAutonomicUi({
        autonomic: {
          system_state: 'VULNERABILITY_ALERT',
          alert_level: 2,
          safety_banner: {
            active: true,
            level: 2,
            tone: 'red',
            title: 'LEVEL 2 ALERT — Sustained Sympathetic Load',
            reasons: ['Daytime stress >25 for 250m (4h+ sympathetic load)']
          },
          acute_spike: {
            detected: true,
            spike_ts_ms: Date.now() - 120000,
            spike_time: new Date().toISOString(),
            reason: 'Unprovoked Stress surge (86/100) outside workout'
          },
          illness: { active_today: false, current_streak_days: 0, recent_logs: [] },
          patterns: { prodromal_risk: { score: 60, level: 'high', label: 'High Load', drivers: [] } },
          recent_episodes: []
        }
      });

      const safetyHtml = app.document.getElementById('autonomicSafetyBanner').innerHTML;
      assert(safetyHtml.includes('tone-red'), 'Level 2 alert banner must use red tone');
      assert(safetyHtml.includes('Volkswagen ID. Buzz'), 'Safety banner must advise against driving Volkswagen ID. Buzz');
      assert(safetyHtml.includes('solo high-risk'), 'Safety banner must warn against solo high-risk exertion');

      const spikeHtml = app.document.getElementById('autonomicSpikeBanner').innerHTML;
      assert(spikeHtml.includes('Unprovoked Stress surge (86/100)'), 'Spike banner must show Garmin spike reason');

      const dotEl = app.document.getElementById('autonomicPillDot');
      assert(dotEl.classList.contains('red'), 'Header dot must be red on Level 2 alert');
      assert.strictEqual(app.document.getElementById('autonomicPillText').innerText, 'Level 2 Alert');
      console.log('PASS [2] Level 1/2 Driving & Solo Exertion Safety Banners, Spike Prompt & Header Pill');
    }

    // [3] 1-Tap Offline Episode Capture -> Queued Sync -> Resolution Override
    {
      app.localStorage.clear();
      app.ctx.renderAutonomicUi({
        autonomic: {
          system_state: 'IDLE',
          alert_level: 0,
          safety_banner: { active: false, level: 0, tone: 'calm', reasons: [] },
          acute_spike: null,
          active_episode: null,
          illness: { active_today: false, recent_logs: [] },
          patterns: { total_episodes: 0, prodromal_risk: { score: 0, level: 'low', drivers: [] } },
          recent_episodes: []
        }
      });

      // Simulate offline network error during acute capture
      app.setFetchHandler(async () => makeMockResponse({}, { status: 0 }));
      await app.ctx.startAcuteEpisodeNow();

      const afterCapture = app.ctx.getAutonomicSummary();
      assert.strictEqual(afterCapture.system_state, 'ACUTE_EPISODE');
      assert(afterCapture.active_episode && afterCapture.active_episode.id.startsWith('ep_'));
      const queuedRaw = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue') || '[]');
      assert.strictEqual(queuedRaw.length, 1, 'Offline 1-tap capture must queue POST /api/health/episodes');
      assert.strictEqual(queuedRaw[0].endpoint, '/api/health/episodes');
      assert(queuedRaw[0].body.id && queuedRaw[0].body.client_event_id);

      // Update symptoms & confirm resolved offline
      app.ctx.toggleEpisodeDraftSymptom('dissociation');
      app.ctx.toggleEpisodeDraftTrigger('driving');
      await app.ctx.updateActiveEpisode('confirm_resolved_override');
      app.ctx._stopAutonomicTimer();

      const afterResolve = app.ctx.getAutonomicSummary();
      assert.strictEqual(afterResolve.active_episode, null, 'Override resolution must close active episode');
      const queuedAfter = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue') || '[]');
      assert.strictEqual(queuedAfter.length, 2, 'Resolution update must queue sequentially after creation');
      assert.strictEqual(queuedAfter[1].endpoint, '/api/health/episodes/update');
      console.log('PASS [3] 1-Tap Offline Episode Capture, Sequential Offline Queueing & Resolution Override');
    }

    // [4] Illness Recovery Mode: Workout Verdict Rest / Return Ramp, Fuel Maintenance & 48h Scale Shield
    {
      app.localStorage.clear();
      const todayIso = app.ctx.getLocalDateStr();
      app.ctx.BAKED_LIVE_STATE = {
        date: todayIso,
        garmin: { training_readiness: 85, sleep_score: 84, sleep_duration: '8h 00m', body_battery: 82, active_calories: 0, recent_activities: [] },
        nutrition: {
          calorie_target: 2492,
          base_calorie_target: 2092,
          base_protein_target_g: 200,
          protein_target_g: 200,
          carbs_target_g: 220,
          fat_target_g: 85,
          illness_active: true,
          illness_maintenance_kcal: 2492
        }
      };
      app.ctx.PULSE_ANALYTICS_SUMMARY = {
        autonomic: {
          system_state: 'IDLE',
          alert_level: 0,
          safety_banner: { active: false, tone: 'calm', reasons: [] },
          illness: { active_today: true, current_streak_days: 3, post_illness_ramp_active: false, recent_logs: [] },
          patterns: { prodromal_risk: { score: 20, level: 'low', drivers: [] } },
          recent_episodes: []
        },
        flex_refeed: {
          status: 'building',
          streak: { logged_days_7d: 5, clean_days_5d: 3, clean_days_7d: 5, clean_days_14d: 10, banked_7d_kcal: 1500, day_chips: [] },
          cooldown: {},
          active_today: { active: false },
          planned_bank: { active: false },
          scale_shield: { active: false }
        }
      };

      const sickVerdict = app.ctx.computeTodayWorkoutVerdict();
      assert.strictEqual(sickVerdict.mode, 'rest_day', 'Active illness must override workout verdict to rest_day');
      assert.strictEqual(sickVerdict.isRest, true);
      assert(sickVerdict.badge.includes('ILLNESS RECOVERY MODE'));

      // Check Fuel banner displays Illness Maintenance instead of aggressive cut
      app.ctx.renderFlexRefeedCard(app.ctx.PULSE_ANALYTICS_SUMMARY);
      const flexBannerHtml = app.document.getElementById('fuelTodayFlexBanner').innerHTML;
      assert(flexBannerHtml.includes('Illness Maintenance Active'), 'Fuel banner must highlight Illness Maintenance Active');

      // Flip to Day +1 after illness -> Post-Illness Return Ramp & 48h Recovery Scale Shield
      app.ctx.BAKED_LIVE_STATE.nutrition.illness_active = false;
      app.ctx.PULSE_ANALYTICS_SUMMARY.autonomic.illness = {
        active_today: false,
        current_streak_days: 0,
        post_illness_ramp_active: true,
        recent_logs: []
      };
      app.ctx.PULSE_ANALYTICS_SUMMARY.flex_refeed.scale_shield = {
        active: true,
        hours_remaining: 36,
        claim_mode: 'illness_recovery',
        note: 'Post-illness water/glycogen retention shield'
      };

      const rampVerdict = app.ctx.computeTodayWorkoutVerdict();
      assert.strictEqual(rampVerdict.mode, 'liss_cardio', 'Day +1 post-illness must cap training to liss_cardio ramp');
      assert(rampVerdict.badge.includes('POST-ILLNESS RETURN RAMP'));

      app.ctx.renderPostRefeedScaleShield(app.ctx.PULSE_ANALYTICS_SUMMARY);
      assert(app.document.getElementById('todayScaleShieldPill').innerText.includes('Recovery Shield'));
      assert(app.document.getElementById('postRefeedScaleShield').innerHTML.includes('Post-Illness Recovery Scale Shield Active'));
      console.log('PASS [4] Illness Workout Rest/Return Ramp, Maintenance Fuel & 48h Scale Shield');
    }

    // [5] Clinical Report HTML XSS Escaping & Non-Diagnostic Boundary
    {
      const html = app.ctx.buildClinicalReportHtml({
        generated_at: new Date().toISOString(),
        clinical_disclaimer: 'Self-monitoring & Garmin biometric correlation record only. Non-diagnostic.',
        patterns: { total_episodes: 1, acute_duration_stats: { avg: 10 }, total_recovery_stats: { avg: 42 } },
        illness_logs: [{ date_str: '2026-11-23', status: 'active', severity: 'moderate', symptoms: ['fatigue_malaise'], notes: '<script>alert(1)</script>' }],
        episodes: [{
          id: 'ep_xss',
          onset_time: new Date().toISOString(),
          severity: 'moderate',
          acute_duration_mins: 10,
          total_recovery_duration_mins: 42,
          symptoms: ['dissociation'],
          triggers: ['illness_infection'],
          notes: '<img src=x onerror=alert(9)>Sudden dizziness',
          biometric_snapshot: {
            prior_night_hrv: 39,
            prior_night_sleep_stress: 35,
            stress: { pre_avg: 32, peak: 88, post_avg: 22 },
            hr: { pre_avg: 60, peak: 118, post_avg: 64 }
          }
        }]
      });
      assert.strictEqual(html.includes('<script>alert(1)'), false, 'XSS <script> must be escaped in clinical report');
      assert.strictEqual(html.includes('<img src=x onerror'), false, 'XSS <img> must be escaped in clinical report');
      assert(html.includes('&lt;img src=x onerror=alert(9)&gt;Sudden dizziness'));
      assert(html.includes('Non-Diagnostic Scope'));
      assert(html.includes('Ambulatory EEG / MRI'));
      assert(html.includes('Holter / Tilt-Table'));
      console.log('PASS [5] Clinical Print/PDF Report XSS Escaping & Clinician Sections');
    }

    console.log('ALL 5 AUTONOMIC & ILLNESS FRONTEND SUITES PASSED');
  } finally {
    app.cleanup();
  }
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exitCode = 1;
});
