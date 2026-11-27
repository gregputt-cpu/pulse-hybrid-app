'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');

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

class MockClassList {
  constructor(initial = []) { this._set = new Set(initial); }
  add(...c) { c.forEach(x => x && this._set.add(String(x))); }
  remove(...c) { c.forEach(x => x && this._set.delete(String(x))); }
  contains(c) { return this._set.has(String(c)); }
  toggle(c, f) {
    const s = String(c);
    if (f !== undefined) { f ? this._set.add(s) : this._set.delete(s); }
    else if (this._set.has(s)) this._set.delete(s);
    else this._set.add(s);
    return this._set.has(s);
  }
}

function createMockElement(tagName, id, elementsById) {
  const el = {
    tagName: String(tagName || 'div').toUpperCase(),
    id: id || '',
    _innerHTML: '',
    _innerText: '',
    value: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    classList: new MockClassList(),
    attributes: new Map(),
    setAttribute(k, v) { this.attributes.set(k, String(v)); },
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    closest(sel) {
      if (sel === '.set-log-row') return this._rowEl || el;
      return null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) { el._innerHTML = String(v ?? ''); if (el._innerHTML === '') el.children = []; }
  });
  Object.defineProperty(el, 'innerText', {
    get() { return el._innerText; },
    set(v) { el._innerText = String(v ?? ''); }
  });
  if (id && elementsById) elementsById.set(id, el);
  return el;
}

function createHarness() {
  const elementsById = new Map();
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const idRe = /\bid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = idRe.exec(html)) !== null) {
    if (!elementsById.has(m[1])) createMockElement('div', m[1], elementsById);
  }
  const storageMap = new Map();
  const localStorage = {
    getItem: k => (storageMap.has(String(k)) ? storageMap.get(String(k)) : null),
    setItem: (k, v) => storageMap.set(String(k), String(v)),
    removeItem: k => storageMap.delete(String(k)),
    clear: () => storageMap.clear()
  };
  const fetchCalls = [];
  let fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { status: 'logged', is_pr: false } }) });

  const documentMock = {
    readyState: 'complete',
    visibilityState: 'visible',
    body: createMockElement('body', '', elementsById),
    documentElement: createMockElement('html', '', elementsById),
    createElement: tag => createMockElement(tag, '', elementsById),
    getElementById: id => elementsById.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const ctx = {
    console,
    Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, Promise, Error,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: documentMock,
    localStorage,
    navigator: { onLine: true, vibrate: () => {} },
    location: { hostname: 'localhost', href: 'http://localhost/', protocol: 'http:' },
    history: { replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchHandler(url, init);
    },
    AudioContext: undefined,
    webkitAudioContext: undefined,
    matchMedia: () => ({ matches: false, addListener: () => {} }),
    IntersectionObserver: undefined
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const rel of SCRIPT_ORDER) {
    vm.runInContext(fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8'), ctx, { filename: rel });
  }
  return {
    ctx,
    document: documentMock,
    localStorage,
    fetchCalls,
    clearFetchCalls: () => { fetchCalls.length = 0; },
    setFetchHandler: fn => { fetchHandler = fn; },
    eval: code => vm.runInContext(code, ctx)
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function buildTodayGarminActivity() {
  const sets = [
    { set_type: 'ACTIVE', reps: null, weight: 20000.0, duration: 60.579 },
    { set_type: 'REST', reps: null, weight: null, duration: 91.401 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 66.364 },
    { set_type: 'REST', reps: null, weight: null, duration: 127.311 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 42.435 },
    { set_type: 'REST', reps: null, weight: null, duration: 120.18 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 43.666 },
    { set_type: 'REST', reps: null, weight: null, duration: 133.613 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 27.375 },
    { set_type: 'REST', reps: null, weight: null, duration: 116.281 },
    { set_type: 'ACTIVE', reps: null, weight: 20000.0, duration: 31.121 },
    { set_type: 'REST', reps: null, weight: null, duration: 96.367 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 38.822 },
    { set_type: 'REST', reps: null, weight: null, duration: 118.387 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 27.236 },
    { set_type: 'REST', reps: null, weight: null, duration: 72.571 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 26.654 },
    { set_type: 'REST', reps: null, weight: null, duration: 78.283 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 28.17 },
    { set_type: 'REST', reps: null, weight: null, duration: 106.464 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 30.392 },
    { set_type: 'REST', reps: null, weight: null, duration: 101.369 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 30.274 },
    { set_type: 'REST', reps: null, weight: null, duration: 102.06 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 26.664 },
    { set_type: 'REST', reps: null, weight: null, duration: 91.356 },
    { set_type: 'ACTIVE', reps: null, weight: 70000.0, duration: 30.916 },
    { set_type: 'REST', reps: null, weight: null, duration: 119.272 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 19.057 },
    { set_type: 'REST', reps: null, weight: null, duration: 90.862 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 16.66 },
    { set_type: 'REST', reps: null, weight: null, duration: 67.114 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 16.72 },
    { set_type: 'REST', reps: null, weight: null, duration: 81.863 },
    { set_type: 'ACTIVE', reps: null, weight: 50000.0, duration: 16.547 },
    { set_type: 'REST', reps: null, weight: null, duration: 3.145 }
  ];
  const noteText = "Strength. Also did 2 warm up body combat tracks before this which weren't recorded on the watch. Top of hamstrings felt very tight on 4th set of squats hence only doing 1 rep.";
  return {
    id: '25212575636',
    name: 'Strength_training',
    activity_type_key: 'strength_training',
    sub_title: noteText,
    subTitle: noteText,
    user_notes: noteText,
    rawDate: '2026-11-27 06:17:28',
    date: '2026-11-27 06:17:28',
    duration_min: 38.3,
    durationMin: 38.3,
    calories: 315,
    avg_hr: 106,
    max_hr: 149,
    aerobic_te: 1.4,
    anaerobic_te: 1.0,
    total_sets: 18,
    total_reps: 119,
    source: 'garmin_oauth',
    exercise_sets: sets
  };
}

function buildTodayPulseSession() {
  return {
    id: '1795762560016_kyyecl',
    client_event_id: '1795762560016_kyyecl',
    date: '2026-11-27T06:56:00.016Z',
    title: 'BARBELL OPTION A',
    preset: 'custom',
    exercisesCompleted: 5,
    setsLogged: 16,
    calories: 306,
    details: {
      barbell_squat_1: { exercise_id: 'barbell_squat', set_num: 1, weight: 70, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:21' },
      barbell_squat_2: { exercise_id: 'barbell_squat', set_num: 2, weight: 70, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:24' },
      barbell_squat_3: { exercise_id: 'barbell_squat', set_num: 3, weight: 70, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:26' },
      barbell_squat_4: { exercise_id: 'barbell_squat', set_num: 4, weight: 70, reps: 1, logged: true, is_warmup: true, status: 'warmup', time: '06:29' },
      barbell_bench_press_1: { exercise_id: 'barbell_bench_press', set_num: 1, weight: 70, reps: 8, logged: true, status: 'logged', time: '06:35' },
      barbell_bench_press_2: { exercise_id: 'barbell_bench_press', set_num: 2, weight: 50, reps: 8, logged: true, is_warmup: true, status: 'warmup', time: '06:36' },
      barbell_bench_press_3: { exercise_id: 'barbell_bench_press', set_num: 3, weight: 50, reps: 8, logged: true, is_warmup: true, status: 'warmup', time: '06:38' },
      barbell_bench_press_4: { exercise_id: 'barbell_bench_press', set_num: 4, weight: 50, reps: 8, logged: true, is_warmup: true, status: 'warmup', time: '06:40' },
      barbell_rdl_1: { exercise_id: 'barbell_rdl', set_num: 1, weight: 70, reps: 6, logged: true, status: 'missed', time: '06:42' },
      barbell_rdl_2: { exercise_id: 'barbell_rdl', set_num: 2, weight: 70, reps: 6, logged: true, status: 'missed', time: '06:44' },
      barbell_rdl_3: { exercise_id: 'barbell_rdl', set_num: 3, weight: 70, reps: 6, logged: true, status: 'missed', time: '06:46' },
      barbell_rdl_4: { exercise_id: 'barbell_rdl', set_num: 4, weight: 70, reps: 6, logged: true, status: 'missed', time: '06:48' },
      barbell_pendlay_row_1: { exercise_id: 'barbell_pendlay_row', set_num: 1, weight: 50, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:51' },
      barbell_pendlay_row_2: { exercise_id: 'barbell_pendlay_row', set_num: 2, weight: 50, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:52' },
      barbell_pendlay_row_3: { exercise_id: 'barbell_pendlay_row', set_num: 3, weight: 50, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:55' },
      barbell_pendlay_row_4: { exercise_id: 'barbell_pendlay_row', set_num: 4, weight: 50, reps: 6, logged: true, is_warmup: true, status: 'warmup', time: '06:55' }
    }
  };
}

async function run() {
  const app = createHarness();

  // [1] Unaligned contiguous-block summary must NOT label 50kg Bench/Row working blocks as warm-up
  const act = buildTodayGarminActivity();
  const decoded = app.ctx.decodeGarminStrengthSets(act);
  assert.strictEqual(decoded.activeCount, 18);
  assert.strictEqual(decoded.workingSummary, '1×20kg warm-up • 4×70kg • 1×20kg warm-up • 4×50kg • 4×70kg • 4×50kg');

  // [2] Full alignment on today's 18 Garmin sets vs 16 Pulse sets
  const sess = buildTodayPulseSession();
  const aligned = app.ctx.alignGarminSetsWithPulse(act, sess);
  assert(aligned, 'alignGarminSetsWithPulse should return alignment');
  assert.strictEqual(aligned.matchedCount, 16, `Expected 16 matched sets, got ${aligned.matchedCount}`);
  assert.strictEqual(aligned.warmupCount, 2, `Expected 2 warm-ups, got ${aligned.warmupCount}`);
  assert.strictEqual(aligned.unmatchedSets.length, 0, 'Expected 0 orphan Garmin sets');
  assert.strictEqual(aligned.unmatchedPulse.length, 0, 'Expected 0 unmatched Pulse sets');

  // G01 -> barbell_squat warmup, G02..G05 -> squat 1..4
  assert.strictEqual(aligned.annotatedSets[0].role, 'warmup');
  assert.strictEqual(aligned.annotatedSets[0].exerciseId, 'barbell_squat');
  assert.strictEqual(aligned.annotatedSets[1].pulseSet.key, 'barbell_squat_1');
  assert.strictEqual(aligned.annotatedSets[4].pulseSet.key, 'barbell_squat_4');
  assert.strictEqual(aligned.annotatedSets[4].pulseSet.reps, 1);

  // G06 -> barbell_bench_press warmup, G07 -> bench_1 with weightMismatch flag
  assert.strictEqual(aligned.annotatedSets[5].role, 'warmup');
  assert.strictEqual(aligned.annotatedSets[5].exerciseId, 'barbell_bench_press');
  assert.strictEqual(aligned.annotatedSets[6].pulseSet.key, 'barbell_bench_press_1');
  assert.strictEqual(aligned.annotatedSets[6].weightMismatch.garminKg, 50);
  assert.strictEqual(aligned.annotatedSets[6].weightMismatch.pulseKg, 70);

  // G11..G14 -> rdl 1..4 (no warmup)
  assert.strictEqual(aligned.annotatedSets[10].pulseSet.key, 'barbell_rdl_1');
  assert.strictEqual(aligned.annotatedSets[13].pulseSet.key, 'barbell_rdl_4');

  // G15..G18 -> pendlay_row 1..4 (late tap at 06:55 aligned cleanly)
  assert.strictEqual(aligned.annotatedSets[14].pulseSet.key, 'barbell_pendlay_row_1');
  assert.strictEqual(aligned.annotatedSets[16].pulseSet.key, 'barbell_pendlay_row_3');
  assert.strictEqual(aligned.annotatedSets[17].pulseSet.key, 'barbell_pendlay_row_4');

  assert.strictEqual(aligned.garminTotalReps, 119);
  assert.strictEqual(aligned.pulseTotalReps, 99);
  assert.strictEqual(aligned.inferredWarmupReps, 20);

  // [3] Per-set Garmin repetitionCount comparison & delta
  const actWithReps = buildTodayGarminActivity();
  const sampleReps = [10, 6, 6, 6, 1, 10, 9, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6];
  let rIdx = 0;
  actWithReps.exercise_sets.forEach(s => {
    if (s.set_type === 'ACTIVE') s.reps = sampleReps[rIdx++];
  });
  const alignedWithReps = app.ctx.alignGarminSetsWithPulse(actWithReps, sess);
  assert.strictEqual(alignedWithReps.annotatedSets[6].reps, 9);
  assert.strictEqual(alignedWithReps.annotatedSets[6].repDelta, 1); // 9 watch vs 8 app
  assert.strictEqual(alignedWithReps.annotatedSets[1].repDelta, 0);

  // [4] Cloud BAKED_LIVE_STATE.session_history merge when localStorage is empty + renderHistoryList HTML
  //     (even with today's exact "warm up body combat tracks" note!)
  app.localStorage.clear();
  app.eval(`
    window.BAKED_LIVE_STATE = { session_history: [${JSON.stringify(sess)}] };
    recentActivitiesData = [${JSON.stringify(actWithReps)}];
  `);
  const egmToday = app.ctx.getEgmWorkoutBreakdown(actWithReps, true);
  assert.strictEqual(egmToday.recoveryPill.includes('Body Combat Conditioning'), false, 'Strength_training with Body Combat warm-up note must NOT be classified as Body Combat Conditioning');
  assert(egmToday.recoveryPill.includes('24–48h Recovery Window'), 'Strength_training must retain Strength recovery pill');

  const matchMap = app.ctx.buildGarminPulseMatchMap([actWithReps]);
  assert.strictEqual(matchMap.has('25212575636'), true, 'Strength_training with warm-up/Body Combat note MUST match BARBELL OPTION A');

  app.ctx.renderHistoryList();
  const histHtml = app.document.getElementById('trainViewHistory').children[0].innerHTML;
  assert(histHtml.includes('MATCHED WITH PULSE'), 'Should match from BAKED_LIVE_STATE.session_history');
  assert(histHtml.includes('16 Matched + 2 Warm-ups'), 'Header should show matched & warm-up counts');
  assert(histHtml.includes('Barbell Back Squat • WARM-UP (G1): 20kg'), 'Should show exercise name directly on G1 warm-up card');
  assert(histHtml.includes('Barbell Flat Bench Press • WARM-UP (G6): 20kg'), 'Should show exercise name directly on G6 warm-up card');
  assert(histHtml.includes('Barbell Back Squat • Set 1 (G2): 70kg × 6r'), 'Should show exercise name directly on working set card');
  assert(histHtml.includes('Watch 50kg vs App 70kg'), 'Should flag Bench Set 1 weight mismatch');
  assert(histHtml.includes('⌚ 9r vs 📱 8r'), 'Should show rep delta when watch reps differ');
  assert(histHtml.includes('⌚ 6r ✓'), 'Should show exact watch rep match');

  // [4b] Backend-enriched exercise_sets renders exercise names & warm-ups even WITHOUT localStorage or session_history!
  const backendEnrichedAct = buildTodayGarminActivity();
  let gIdx = 0;
  const enrichedMeta = [
    { exId: 'barbell_squat', exName: 'Barbell Back Squat', role: 'warmup' },
    { exId: 'barbell_squat', exName: 'Barbell Back Squat', role: 'working', pSet: 1, pW: 70, pR: 6 },
    { exId: 'barbell_squat', exName: 'Barbell Back Squat', role: 'working', pSet: 2, pW: 70, pR: 6 },
    { exId: 'barbell_squat', exName: 'Barbell Back Squat', role: 'working', pSet: 3, pW: 70, pR: 6 },
    { exId: 'barbell_squat', exName: 'Barbell Back Squat', role: 'working', pSet: 4, pW: 70, pR: 1 },
    { exId: 'barbell_bench_press', exName: 'Barbell Bench Press', role: 'warmup' },
    { exId: 'barbell_bench_press', exName: 'Barbell Bench Press', role: 'working', pSet: 1, pW: 70, pR: 8, mismatch: { garmin_kg: 50, pulse_kg: 70 } },
    { exId: 'barbell_bench_press', exName: 'Barbell Bench Press', role: 'working', pSet: 2, pW: 50, pR: 8 },
    { exId: 'barbell_bench_press', exName: 'Barbell Bench Press', role: 'working', pSet: 3, pW: 50, pR: 8 },
    { exId: 'barbell_bench_press', exName: 'Barbell Bench Press', role: 'working', pSet: 4, pW: 50, pR: 8 },
    { exId: 'barbell_rdl', exName: 'Barbell Romanian Deadlift (RDL)', role: 'working', pSet: 1, pW: 70, pR: 6 },
    { exId: 'barbell_rdl', exName: 'Barbell Romanian Deadlift (RDL)', role: 'working', pSet: 2, pW: 70, pR: 6 },
    { exId: 'barbell_rdl', exName: 'Barbell Romanian Deadlift (RDL)', role: 'working', pSet: 3, pW: 70, pR: 6 },
    { exId: 'barbell_rdl', exName: 'Barbell Romanian Deadlift (RDL)', role: 'working', pSet: 4, pW: 70, pR: 6 },
    { exId: 'barbell_pendlay_row', exName: 'Barbell Pendlay Row', role: 'working', pSet: 1, pW: 50, pR: 6 },
    { exId: 'barbell_pendlay_row', exName: 'Barbell Pendlay Row', role: 'working', pSet: 2, pW: 50, pR: 6 },
    { exId: 'barbell_pendlay_row', exName: 'Barbell Pendlay Row', role: 'working', pSet: 3, pW: 50, pR: 6 },
    { exId: 'barbell_pendlay_row', exName: 'Barbell Pendlay Row', role: 'working', pSet: 4, pW: 50, pR: 6 }
  ];
  backendEnrichedAct.exercise_sets.forEach(s => {
    if (s.set_type === 'ACTIVE') {
      const m = enrichedMeta[gIdx++];
      s.exercise_id = m.exId;
      s.exercise_name = m.exName;
      s.role = m.role;
      if (m.role === 'working') {
        s.pulse_set_num = m.pSet;
        s.pulse_weight_kg = m.pW;
        s.pulse_reps = m.pR;
        if (m.mismatch) s.weight_mismatch = m.mismatch;
      }
    }
  });
  app.localStorage.clear();
  app.eval(`
    window.BAKED_LIVE_STATE = {};
    recentActivitiesData = [${JSON.stringify(backendEnrichedAct)}];
  `);
  app.ctx.renderHistoryList();
  const enrichedHistHtml = app.document.getElementById('trainViewHistory').children[0].innerHTML;
  assert(enrichedHistHtml.includes('Barbell Back Squat • WARM-UP (G1): 20kg'), 'Backend-enriched sets must render warm-up exercise name even without session_history');
  assert(enrichedHistHtml.includes('Barbell Pendlay Row • Set 4 (G18): 50kg × 6r'), 'Backend-enriched sets must render working exercise name and reps');
  assert(enrichedHistHtml.includes('~20 warm-up/unlogged reps'), 'Backend-enriched sets must show rep reconciliation');

  // [5] logSet() repeated-set working promotion (Set 1 warmup -> Set 2 at same weight promotes Set 1)
  app.localStorage.clear();
  app.eval(`
    activeWorkoutPlan = [{ id: 'barbell_squat', name: 'Barbell Squat', targetWeight: 100, targetReps: 8, setsCount: 4, rest: '120s', requiredGear: ['barbell'] }];
    currentExIdx = 0;
    sessionLoggedSets = {};
  `);
  const btn1 = app.document.createElement('button');
  const btn2 = app.document.createElement('button');
  const w1 = app.document.getElementById('wIn_0_1') || (() => { const e = app.document.createElement('input'); e.id = 'wIn_0_1'; return e; })();
  const r1 = app.document.getElementById('rIn_0_1') || (() => { const e = app.document.createElement('input'); e.id = 'rIn_0_1'; return e; })();
  const w2 = app.document.getElementById('wIn_0_2') || (() => { const e = app.document.createElement('input'); e.id = 'wIn_0_2'; return e; })();
  const r2 = app.document.getElementById('rIn_0_2') || (() => { const e = app.document.createElement('input'); e.id = 'rIn_0_2'; return e; })();
  app.eval(`
    document.getElementById = (function(orig) {
      const extra = {};
      return function(id) {
        if (id === 'wIn_0_1') return extra[id] || (extra[id] = { value: '70' });
        if (id === 'rIn_0_1') return extra[id] || (extra[id] = { value: '6' });
        if (id === 'wIn_0_2') return extra[id] || (extra[id] = { value: '70' });
        if (id === 'rIn_0_2') return extra[id] || (extra[id] = { value: '6' });
        return orig.call(document, id);
      };
    })(document.getElementById);
  `);
  app.clearFetchCalls();
  app.ctx.logSet(btn1, 1, 'barbell_squat', 100, 8);
  assert.strictEqual(app.eval("sessionLoggedSets['barbell_squat_1'].is_warmup"), true, 'Set 1 alone is provisionally warmup');
  app.ctx.logSet(btn2, 2, 'barbell_squat', 100, 8);
  await flushMicrotasks();
  assert.strictEqual(app.eval("sessionLoggedSets['barbell_squat_1'].is_warmup"), false, 'Set 1 must be promoted to working when Set 2 repeats 70kg');
  assert.strictEqual(app.eval("sessionLoggedSets['barbell_squat_1'].status"), 'missed');
  assert(!app.eval("sessionLoggedSets['barbell_squat_2'].is_warmup"), 'Set 2 must be logged as working');
  const set2Body = JSON.parse(app.fetchCalls[1].init.body);
  assert.strictEqual(set2Body.is_warmup, false, 'Set 2 must explicitly send is_warmup: false to backend');

  console.log('ALL GARMIN SET MATCHING FRONTEND TESTS PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
