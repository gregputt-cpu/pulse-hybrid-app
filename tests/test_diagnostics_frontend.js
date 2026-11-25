'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const STYLES_CSS_PATH = path.join(ROOT_DIR, 'css', 'styles.css');
const VERCEL_CFG_PATH = path.join(ROOT_DIR, '.vercel', 'output', 'config.json');

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
  add(...classes) {
    for (const c of classes) if (c) this._set.add(String(c));
  }
  remove(...classes) {
    for (const c of classes) if (c) this._set.delete(String(c));
  }
  contains(c) {
    return this._set.has(String(c));
  }
  toggle(c, force) {
    const cls = String(c);
    if (force !== undefined) {
      if (force) this._set.add(cls);
      else this._set.delete(cls);
    } else if (this._set.has(cls)) {
      this._set.delete(cls);
    } else {
      this._set.add(cls);
    }
    return this._set.has(cls);
  }
  toString() {
    return Array.from(this._set).join(' ');
  }
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
    get className() {
      return _classList.toString();
    },
    set className(val) {
      _classList = new MockClassList(String(val || '').split(/\s+/).filter(Boolean));
      el.classList = _classList;
    },
    get innerHTML() {
      return _innerHTML;
    },
    set innerHTML(val) {
      _innerHTML = String(val ?? '');
      el._innerHTML = _innerHTML;
      el.children = [];
      if (registry && _innerHTML) {
        registerElementsFromHtml(_innerHTML, registry, el);
      }
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
      if (k === 'id') {
        el.id = String(v);
        if (registry) registry.set(el.id, el);
      } else if (k === 'class') {
        el.className = String(v);
      }
    },
    getAttribute(k) {
      if (k === 'id') return el.id || null;
      if (k === 'class') return el.className || null;
      return Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null;
    },
    removeAttribute(k) {
      delete el.attributes[k];
      if (k === 'style') el.style = {};
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent(evt) {
      const arr = listeners.get(evt && evt.type) || [];
      for (const fn of arr.slice()) fn(evt);
    },
    querySelector(sel) {
      const all = el.querySelectorAll(sel);
      return all.length > 0 ? all[0] : null;
    },
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
          })) {
            found.push(ch);
          }
          walk(ch);
        }
      };
      walk(el);
      return found;
    },
    focus() {},
    blur() {},
    click() {
      el.dispatchEvent({ type: 'click', target: el, stopPropagation() {} });
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
  const headersMap = new Map();
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headersMap.set(k.toLowerCase(), String(v));
  }
  const textBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headersMap.get(String(k).toLowerCase()) || null },
    async json() { return JSON.parse(textBody); },
    async text() { return textBody; }
  };
}

function createDiagHarness(options = {}) {
  const elementsById = new Map();
  const rootMock = createMockElement('div', '__root__', elementsById);
  registerElementsFromHtml(indexHtml, elementsById, rootMock);

  const docListeners = new Map();
  const winListeners = new Map();
  const bodyEl = createMockElement('body', 'body', elementsById);

  const documentMock = {
    body: bodyEl,
    readyState: 'complete',
    visibilityState: 'visible',
    getElementById(id) {
      if (elementsById.has(id)) return elementsById.get(id);
      const fallback = createMockElement('div', id, elementsById);
      elementsById.set(id, fallback);
      return fallback;
    },
    createElement(tag) {
      return createMockElement(tag, '', elementsById);
    },
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
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      for (const fn of (docListeners.get(evt.type) || []).slice()) fn(evt);
    }
  };

  const localStorageMock = createMockLocalStorage();
  const navigatorMock = { onLine: true, language: 'en-GB', vibrate() {} };
  const fetchCalls = [];
  let fetchHandler = async () => makeMockResponse({ success: true }, { status: 200 });

  const activeTimeouts = new Map();
  const activeIntervals = new Map();
  let nextTimerId = 1;
  const mockSetTimeout = (fn, delay = 0) => {
    const id = nextTimerId++;
    const h = setTimeout(() => { if (typeof fn === 'function') fn(); }, Math.min(Number(delay) || 0, 50));
    if (typeof h.unref === 'function') h.unref();
    activeTimeouts.set(id, h);
    return id;
  };
  const mockClearTimeout = (id) => {
    const h = activeTimeouts.get(id);
    if (h) { clearTimeout(h); activeTimeouts.delete(id); }
  };
  const mockSetInterval = (fn, delay = 250) => {
    const id = nextTimerId++;
    const h = setInterval(() => { if (typeof fn === 'function') fn(); }, Math.max(25, Number(delay) || 250));
    if (typeof h.unref === 'function') h.unref();
    activeIntervals.set(id, h);
    return id;
  };
  const mockClearInterval = (id) => {
    const h = activeIntervals.get(id);
    if (h) { clearInterval(h); activeIntervals.delete(id); }
  };

  let speechCancelCount = 0;
  const voiceInstances = [];

  class MockSpeechRecognition {
    constructor() {
      this.lang = '';
      this.continuous = true;
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.started = false;
      this.stopped = false;
      this.aborted = false;
      voiceInstances.push(this);
    }
    start() { this.started = true; }
    stop() {
      this.stopped = true;
      if (typeof this.onend === 'function') this.onend();
    }
    abort() {
      this.aborted = true;
      if (typeof this.onend === 'function') this.onend();
    }
  }

  class MockAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }

  class MockEvent {
    constructor(type) { this.type = type; }
  }

  const ctx = {
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, RegExp, Map, Set, Promise, Error, Intl,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, AbortController,
    Event: MockEvent,
    Response: (b, i) => makeMockResponse(b, i),
    document: documentMock,
    localStorage: localStorageMock,
    navigator: navigatorMock,
    isSecureContext: true,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: String(url), opts: init });
      return fetchHandler(String(url), init);
    },
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    speechSynthesis: {
      speak() {},
      cancel() { speechCancelCount++; },
      getVoices() { return []; }
    },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    setTimeout: mockSetTimeout,
    clearTimeout: mockClearTimeout,
    setInterval: mockSetInterval,
    clearInterval: mockClearInterval,
    location: { protocol: 'https:', search: '', hash: '', href: 'https://pulse.local/', origin: 'https://pulse.local', pathname: '/', reload() {} },
    addEventListener(type, fn) { if (!winListeners.has(type)) winListeners.set(type, []); winListeners.get(type).push(fn); },
    matchMedia() { return { matches: false, addEventListener() {} }; }
  };
  if (options.withVoice !== false) {
    ctx.SpeechRecognition = MockSpeechRecognition;
  }
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
    navigator: navigatorMock,
    fetchCalls,
    voiceInstances,
    getSpeechCancelCount: () => speechCancelCount,
    setFetchHandler: (fn) => { fetchHandler = fn; },
    eval: (code) => vm.runInContext(code, ctx),
    cleanup() {
      for (const h of activeTimeouts.values()) clearTimeout(h);
      for (const h of activeIntervals.values()) clearInterval(h);
    }
  };
}

function makeSampleReport(overrides = {}) {
  return {
    assessment_id: 'diag-uuid-123',
    generated_at: '2026-11-21T07:10:00+00:00',
    engine: 'ai',
    model_id: 'gemini-2.5-flash',
    fallback_reason: null,
    needs_clarification: false,
    clarification_questions: [],
    summary_headline: 'Right Knee Patellar Overload (Moderate)',
    anatomical_region: 'knee',
    laterality: 'right',
    severity: 'moderate',
    triage_level: 'amber_deload',
    red_flags: {
      triggered: false,
      deterministic_override: false,
      flags: [],
      clinical_action: 'No red flags detected.',
      training_clearance: 'deload_only'
    },
    probable_causes: [{
      rank: 1,
      label: 'Patellar Tendon Overload',
      likelihood: 'high',
      confidence_pct: 78,
      mechanism: 'Cumulative impact volume triggered anterior knee tendon sensitivity.',
      supporting_evidence: ['Jump rope intervals yesterday']
    }],
    load_correlations: [{
      date: '2026-11-20',
      activity_or_exercise: 'Speed Rope Intervals',
      source: 'garmin',
      stress_vector: 'knees load · high impact',
      correlation_note: 'Ballistic plyometrics loaded patellar tendon.'
    }],
    recovery_context: {
      history_availability: 'rich',
      workouts_analyzed: 8,
      window_days: 21,
      acwr: 1.32,
      acwr_status: 'caution',
      fatigued_markers: [],
      data_gap_note: null
    },
    action_plan: {
      immediate_relief_protocol: ['Spanish squat isometric 3 x 45s'],
      load_management_guidance: 'Avoid deep knee flexion and ballistic impacts.',
      recovery_horizon_hours: '48-72 hours',
      return_to_load_criteria: ['Pain-free stairs']
    },
    clinical_disclaimer: 'Educational biomechanical triage only — not a medical diagnosis.',
    adaptor_handoff: {
      assessment_id: 'diag-uuid-123',
      affected_joints: ['knees'],
      anatomical_region: 'knee',
      laterality: 'right',
      severity: 'moderate',
      triage_level: 'amber_deload',
      movement_restrictions: ['deep_knee_flexion', 'ballistic_impact'],
      restricted_exercise_ids: ['barbell_squat'],
      recommended_swaps: ['glute_bridge_hold', 'zone2_flush'],
      rest_recommended: false,
      merge_mode: 'additive',
      summary_note: 'Right Knee Patellar Overload',
      expires_hint_hours: 72
    },
    ...overrides
  };
}

async function runTests() {
  const app = createDiagHarness({ withVoice: true });
  try {
    // [1] Voice Dictation State Machine, Edit Tracking & Leak-Free Teardown
    {
      app.ctx.openInjuryModal();
      const cancelBefore = app.getSpeechCancelCount();
      app.ctx.toggleVoiceDictation();
      assert.strictEqual(app.getSpeechCancelCount(), cancelBefore + 1, 'Must cancel TTS before mic start');
      const rec = app.voiceInstances[app.voiceInstances.length - 1];
      assert.strictEqual(rec.started, true);
      assert.strictEqual(rec.continuous, false);
      assert.strictEqual(rec.interimResults, true);
      assert.strictEqual(app.document.getElementById('btnDiagVoiceMic').classList.contains('is-listening'), true);

      // Interim tokens update preview without touching textarea or calling fetch
      const callsBefore = app.fetchCalls.length;
      rec.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'pain behind left knee' }, isFinal: false }] });
      assert.strictEqual(app.document.getElementById('diagVoiceInterimText').textContent, 'pain behind left knee');
      assert.strictEqual(app.document.getElementById('injuryNotesInput').value, '');

      // Final transcript appends without auto-submit
      rec.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'Pain behind my left knee after swings' }, isFinal: true }] });
      assert.strictEqual(app.document.getElementById('injuryNotesInput').value, 'Pain behind my left knee after swings');
      assert.strictEqual(app.fetchCalls.length, callsBefore, 'Stopping/capturing voice must NEVER auto-submit');

      // Manual edit upgrades input_mode -> voice_edited & transcript_edited = true
      app.document.getElementById('injuryNotesInput').value = 'Pain behind my left knee after heavy swings';
      app.document.getElementById('injuryNotesInput').dispatchEvent({ type: 'input' });
      assert.strictEqual(app.eval('_diagInputMode'), 'voice_edited');
      assert.strictEqual(app.eval('_diagTranscriptEdited'), true);

      // Permission denied error handles gracefully
      app.ctx.toggleVoiceDictation();
      const recErr = app.voiceInstances[app.voiceInstances.length - 1];
      recErr.onerror({ error: 'not-allowed' });
      assert(app.document.getElementById('diagVoiceStatus').textContent.includes('denied'));

      // Teardown on closeInjuryModal, Escape key, backdrop click, visibilitychange
      app.ctx.toggleVoiceDictation();
      const rClose = app.voiceInstances[app.voiceInstances.length - 1];
      app.ctx.closeInjuryModal();
      assert.strictEqual(rClose.aborted, true, 'closeInjuryModal must abort active mic');

      app.ctx.openInjuryModal();
      app.ctx.toggleVoiceDictation();
      const rEsc = app.voiceInstances[app.voiceInstances.length - 1];
      app.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
      assert.strictEqual(rEsc.aborted, true, 'Escape closing injuryModal must abort active mic');

      app.ctx.openInjuryModal();
      app.ctx.toggleVoiceDictation();
      const rBg = app.voiceInstances[app.voiceInstances.length - 1];
      app.document.dispatchEvent({ type: 'click', target: app.document.getElementById('injuryModal') });
      assert.strictEqual(rBg.aborted, true, 'Backdrop closing injuryModal must abort active mic');

      app.ctx.openInjuryModal();
      app.ctx.toggleVoiceDictation();
      const rVis = app.voiceInstances[app.voiceInstances.length - 1];
      app.document.visibilityState = 'hidden';
      app.document.dispatchEvent({ type: 'visibilitychange' });
      assert.strictEqual(rVis.aborted, true, 'Hidden visibility must abort active mic');
      app.document.visibilityState = 'visible';

      console.log('PASS [1] Voice Dictation State Machine, Edit Tracking & Teardown');
    }

    // [2] Unsupported Browser Fallback
    {
      const noVoiceApp = createDiagHarness({ withVoice: false });
      try {
        noVoiceApp.ctx.openInjuryModal();
        const micBtn = noVoiceApp.document.getElementById('btnDiagVoiceMic');
        assert.strictEqual(micBtn.disabled, true);
        assert.strictEqual(micBtn.getAttribute('aria-disabled'), 'true');
        console.log('PASS [2] Unsupported Browser Mic Fallback');
      } finally {
        noVoiceApp.cleanup();
      }
    }

    // [3] Read-Only runInjuryDiagnostics() & timeoutMs: 22000
    {
      let capturedTimeout = null;
      const origPulseFetch = app.ctx.pulseApiFetch;
      app.ctx.pulseApiFetch = async (url, opts) => {
        if (String(url).includes('/api/diagnostics/analyze')) capturedTimeout = opts.timeoutMs;
        return origPulseFetch(url, opts);
      };
      app.eval('athleteInjuries = normalizeAthleteInjuries({});');
      app.document.getElementById('injuryNotesInput').value = 'Right patellar ache after skipping';
      app.setFetchHandler(async () => makeMockResponse(makeSampleReport(), { status: 200 }));

      const rep = await app.ctx.runInjuryDiagnostics();
      assert.strictEqual(capturedTimeout, 22000, 'Expected explicit 22000ms timeout on diagnostics analyze');
      assert.strictEqual(rep.anatomical_region, 'knee');
      assert.strictEqual(app.eval('athleteInjuries.knees'), false, 'Running diagnostics must NOT mutate athleteInjuries before handoff');
      assert(app.document.getElementById('injuryAssessmentResult').innerHTML.includes('btnApplyDiagHandoff'));
      console.log('PASS [3] Read-Only runInjuryDiagnostics() & timeoutMs: 22000');
    }

    // [4] One-Click Additive Handoff, Chronic Preservation, Undo & clearAllInjuries()
    {
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      app.eval('athleteInjuries = normalizeAthleteInjuries({});');
      await app.ctx.toggleChronicJoint('shoulders');
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), true);
      assert.strictEqual(app.eval('athleteInjuries.chronic_profile.shoulders.permanent'), true);

      app.fetchCalls.length = 0;
      const applied = await app.ctx.applyDiagnosticHandoff(makeSampleReport());
      assert.strictEqual(applied, true);
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), true, 'Existing chronic joint preserved');
      assert.strictEqual(app.eval('athleteInjuries.knees'), true, 'Diagnosed joint activated');
      assert.strictEqual(app.eval('athleteInjuries.active_constraints.knees.source'), 'diagnostic');
      assert(app.fetchCalls.some((c) => c.url === '/api/athlete/injuries'));
      assert(app.fetchCalls.some((c) => c.url === '/api/diagnostics/diag-uuid-123/apply'));

      // Toast contains Undo button; capture and invoke Undo -> reverts knees while preserving shoulders
      const undoBtn = app.document.getElementById('appToast').children.find((c) => c.className === 'toast-action-btn');
      assert(undoBtn && undoBtn.textContent === 'Undo', 'Expected Undo action on toast');
      undoBtn.click();
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(app.eval('athleteInjuries.knees'), false, 'Undo must revert newly added knees constraint');
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), true, 'Undo must preserve pre-existing chronic shoulder lock');

      // Re-apply then clearAllInjuries() -> clears acute knees, keeps chronic shoulders!
      await app.ctx.applyDiagnosticHandoff(makeSampleReport());
      app.ctx.clearAllInjuries();
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(app.eval('athleteInjuries.knees'), false, 'clearAllInjuries must clear acute knees');
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), true, 'clearAllInjuries must preserve permanent chronic shoulders');
      console.log('PASS [4] Additive Handoff, Chronic Preservation, Undo & clearAllInjuries()');
    }

    // [5] Movement Restrictions Swap Tagging & Red-Flag Verdict Override
    {
      const inj = {
        lumbar: true,
        shoulders: false,
        knees: false,
        elbows: false,
        wrists: false,
        ankles: false,
        active_constraints: {
          lumbar: {
            movement_restrictions: ['deep_hip_hinge'],
            restricted_exercise_ids: ['inverted_row']
          }
        }
      };
      const doms = app.ctx.getContraindicatingDomains('db_rdl', inj);
      assert.deepStrictEqual(Array.from(doms), ['lumbar'], 'db_rdl should trigger via deep_hip_hinge movement restriction');
      const swappedIds = app.ctx.applyJointSafeSwaps(['db_rdl', 'inverted_row'], 5, inj, null);
      assert(swappedIds.length > 0 && swappedIds.every((id) => id !== 'db_rdl' && id !== 'inverted_row'));
      const swappedObjs = app.ctx.applyJointSafeSwaps([{ id: 'db_rdl', name: 'DB RDL' }, { id: 'inverted_row', name: 'Inverted Row' }], 5, inj, null);
      assert(swappedObjs.length > 0);
      assert(swappedObjs.every((ex) => ex.id !== 'db_rdl' && ex.id !== 'inverted_row'));
      assert(swappedObjs.some((ex) => String(ex.rationale).includes('[🛡️ Lumbar-Safe Swap]')), 'Expected non-empty domain swap tag');

      // Red-flag verdict override
      app.eval(`
        window.BAKED_LIVE_STATE.garmin = { training_readiness: 95, body_battery: 95, sleep_score: 92 };
        athleteInjuries = normalizeAthleteInjuries({
          knees: true,
          last_diagnostic_summary: {
            assessment_id: 'rf1',
            triage_level: 'red_seek_care',
            summary_headline: 'Audible knee pop — clinical review needed'
          }
        });
      `);
      const verdict = app.ctx.computeTodayWorkoutVerdict();
      assert.strictEqual(verdict.archetypeKey, 'option_c');
      assert.strictEqual(verdict.isRest, true);
      assert.strictEqual(verdict.badge, '🚨 CLINICAL REST ADVISED');
      console.log('PASS [5] Movement Restrictions Swap Tagging & Red-Flag Verdict Override');
    }

    // [6] Offline Triage Fallback & Queue Rules
    {
      app.localStorage.clear();
      app.eval('athleteInjuries = normalizeAthleteInjuries({});');
      app.navigator.onLine = false;
      app.document.getElementById('injuryNotesInput').value = 'Left shoulder front impingement pinch on dips';
      const offRep = await app.ctx.runInjuryDiagnostics();
      assert.strictEqual(offRep.engine, 'offline_basic');
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), false, 'Offline triage must not auto-mutate injuries');
      const qBefore = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue') || '[]');
      assert.strictEqual(qBefore.some((x) => String(x.endpoint).includes('/api/diagnostics')), false, 'Diagnostics analyze must never enter offline queue');

      await app.ctx.applyDiagnosticHandoff(offRep);
      const qAfter = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue') || '[]');
      assert.strictEqual(qAfter.some((x) => x.endpoint === '/api/athlete/injuries'), true, 'Offline handoff must enqueue /api/athlete/injuries');
      app.navigator.onLine = true;
      console.log('PASS [6] Offline Basic Triage Fallback & Queue Separation');
    }

    // [7] Stale live_state Race Guard (updated_at_ms)
    {
      app.localStorage.clear();
      const freshTs = Date.now();
      app.eval(`athleteInjuries = normalizeAthleteInjuries({ knees: true, updated_at_ms: ${freshTs}, active_constraints: { knees: { source: 'diagnostic' } } });`);
      app.ctx.applyLiveStateToDom({
        date: app.ctx.getLocalDateStr(),
        injuries: { lumbar: false, knees: false, shoulders: false, updated_at_ms: freshTs - 30000 }
      });
      assert.strictEqual(app.eval('athleteInjuries.knees'), true, 'Older server state must NOT overwrite fresh local handoff');

      app.ctx.applyLiveStateToDom({
        date: app.ctx.getLocalDateStr(),
        injuries: { lumbar: false, knees: false, shoulders: true, updated_at_ms: freshTs + 5000, active_constraints: { knees: { source: 'diagnostic' } } }
      });
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), true, 'Newer server state should adopt cleanly');
      assert.strictEqual(app.eval('athleteInjuries.active_constraints.knees'), undefined, 'Orphaned constraint must prune when joint is false');
      console.log('PASS [7] Stale live_state Race Guard (updated_at_ms)');
    }

    // [8] XSS Escaping of Hostile Markup inside DiagnosticReport
    {
      const xssReport = makeSampleReport({
        summary_headline: '<img src=x onerror=alert(1)>Right Knee',
        probable_causes: [{
          rank: 1,
          label: '<script>alert(1)</script>Overload',
          likelihood: 'high',
          confidence_pct: 80,
          mechanism: '<svg onload=alert(1)>Impact stress',
          supporting_evidence: []
        }],
        clinical_disclaimer: '<b>Disclaimer</b> text'
      });
      app.ctx.renderDiagnosticReportCard(xssReport);
      const html = app.document.getElementById('injuryAssessmentResult').innerHTML;
      assert.strictEqual(html.includes('<img src=x'), false);
      assert.strictEqual(html.includes('<script>alert'), false);
      assert.strictEqual(html.includes('<svg onload'), false);
      assert(html.includes('&lt;img src=x onerror=alert(1)&gt;Right Knee'));
      console.log('PASS [8] XSS Escaping of Hostile Markup inside DiagnosticReport');
    }

    // [9] Zero Hardcoded Hex Leaks & Vercel Permissions-Policy
    {
      const modalStart = indexHtml.indexOf('<!-- INJURY & JOINT SAFETY GUARDRAILS MODAL -->');
      const modalEnd = indexHtml.indexOf('<!-- MANUAL ACTIVITY / WALK SYNC MODAL -->');
      const modalSnippet = indexHtml.slice(modalStart, modalEnd);
      const hexRx = /#[0-9a-fA-F]{3,8}\b/;
      assert.strictEqual(hexRx.test(modalSnippet), false, `Hardcoded hex color found in #injuryModal HTML: ${modalSnippet.match(hexRx)}`);

      const cssIdx = stylesCss.indexOf('/* INJURY DIAGNOSTICS & ADAPTOR TOKENS (ZERO HARDCODED HEX) */');
      assert(cssIdx > 0);
      const diagCss = stylesCss.slice(cssIdx);
      assert.strictEqual(hexRx.test(diagCss), false, `Hardcoded hex color found in new Diagnostics CSS: ${diagCss.match(hexRx)}`);

      const vercelCfg = JSON.parse(fs.readFileSync(VERCEL_CFG_PATH, 'utf8'));
      const permRoute = (vercelCfg.routes || []).find((r) => r.headers && r.headers['Permissions-Policy']);
      assert(permRoute && permRoute.headers['Permissions-Policy'] === 'microphone=(self)', '.vercel/output/config.json missing Permissions-Policy: microphone=(self)');
      console.log('PASS [9] Zero Hardcoded Hex Leaks & Vercel Permissions-Policy Header');
    }

    console.log('ALL 9 DIAGNOSTICS FRONTEND SUITES PASSED');
  } finally {
    app.cleanup();
  }
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exitCode = 1;
});
