'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const STYLES_CSS_PATH = path.join(ROOT_DIR, 'css', 'styles.css');
const SW_JS_PATH = path.join(ROOT_DIR, 'sw.js');

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
const swJsCode = fs.readFileSync(SW_JS_PATH, 'utf8');

// ==================== MOCK INFRASTRUCTURE ====================
class MockClassList {
  constructor(initial = []) {
    this._set = new Set(initial);
  }
  add(...classes) {
    for (const c of classes) {
      if (c) this._set.add(String(c));
    }
  }
  remove(...classes) {
    for (const c of classes) {
      if (c) this._set.delete(String(c));
    }
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
    checked: false,
    disabled: false,
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
      if (registry && _innerHTML) {
        registerElementsFromHtml(_innerHTML, registry, el);
      }
    },
    appendChild(child) {
      if (!child) return child;
      child.parentElement = el;
      el.children.push(child);
      if (registry) {
        if (child.id) registry.set(child.id, child);
        if (child._innerHTML) registerElementsFromHtml(child._innerHTML, registry, child);
      }
      return child;
    },
    removeChild(child) {
      const idx = el.children.indexOf(child);
      if (idx >= 0) el.children.splice(idx, 1);
      if (child) child.parentElement = null;
      return child;
    },
    setAttribute(k, v) {
      el.attributes[k] = String(v);
      if (k === 'id') {
        el.id = String(v);
        if (registry) registry.set(el.id, el);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'value') {
        el.value = String(v);
      }
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
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const arr = listeners.get(evt && evt.type) || [];
      for (const fn of arr.slice()) fn(evt);
    },
    closest(selector) {
      let cur = el;
      const sel = String(selector || '').trim();
      while (cur) {
        if (sel.startsWith('.')) {
          if (cur.classList && cur.classList.contains(sel.slice(1))) return cur;
        } else if (sel.startsWith('#')) {
          if (cur.id === sel.slice(1)) return cur;
        } else if (cur.tagName === sel.toUpperCase()) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      if (!sel) return null;
      if (sel.startsWith('#')) return registry ? (registry.get(sel.slice(1)) || null) : null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    blur() {},
    click() {
      el.dispatchEvent({ type: 'click', target: el });
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
    if (!idMatch) continue;
    const id = idMatch[1];
    const child = createMockElement(tag, id, registry);
    const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    if (classMatch) child.className = classMatch[1];
    const valMatch = attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
    if (valMatch) child.value = valMatch[1];
    if (parentEl) child.parentElement = parentEl;
    registry.set(id, child);
  }
}

function createMockLocalStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(idx) {
      return Array.from(store.keys())[idx] ?? null;
    },
    getItem(k) {
      const key = String(k);
      return store.has(key) ? store.get(key) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    }
  };
}

function createMockCaches() {
  const stores = new Map(); // cacheName -> Map<url, Response>
  function makeCacheObj(map) {
    return {
      async addAll(urls) {
        for (const u of urls) {
          const fullUrl = u.startsWith('http') ? u : `https://pulse.local${u.startsWith('/') ? '' : '/'}${u}`;
          map.set(fullUrl, makeMockResponse('', { status: 200 }));
        }
      },
      async put(req, res) {
        const url = typeof req === 'string' ? req : req.url;
        const fullUrl = url.startsWith('http') ? url : `https://pulse.local${url.startsWith('/') ? '' : '/'}${url}`;
        map.set(fullUrl, res);
      },
      async match(req, opts = {}) {
        const url = typeof req === 'string' ? req : req.url;
        const fullUrl = url.startsWith('http') ? url : `https://pulse.local${url.startsWith('/') ? '' : '/'}${url}`;
        if (map.has(fullUrl)) return map.get(fullUrl);
        if (opts && opts.ignoreSearch) {
          const base = fullUrl.split('?')[0];
          for (const [k, v] of map.entries()) {
            if (k.split('?')[0] === base) return v;
          }
        }
        return undefined;
      },
      async delete(req) {
        const url = typeof req === 'string' ? req : req.url;
        const fullUrl = url.startsWith('http') ? url : `https://pulse.local${url.startsWith('/') ? '' : '/'}${url}`;
        return map.delete(fullUrl);
      },
      async keys() {
        return Array.from(map.keys()).map((u) => ({ url: u }));
      }
    };
  }
  return {
    _stores: stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return makeCacheObj(stores.get(name));
    },
    async keys() {
      return Array.from(stores.keys());
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(req, opts = {}) {
      for (const map of stores.values()) {
        const hit = await makeCacheObj(map).match(req, opts);
        if (hit) return hit;
      }
      return undefined;
    }
  };
}

function makeMockResponse(bodyObj, init = {}) {
  const status = init.status !== undefined ? init.status : 200;
  const ok = status >= 200 && status < 300;
  const textBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj ?? {});
  const headers = init.headers || {};
  return {
    ok,
    status,
    statusText: init.statusText || (ok ? 'OK' : 'Error'),
    headers,
    async json() {
      return typeof bodyObj === 'string' ? JSON.parse(bodyObj) : bodyObj;
    },
    async text() {
      return textBody;
    },
    clone() {
      return makeMockResponse(typeof bodyObj === 'string' ? bodyObj : JSON.parse(textBody), {
        status,
        statusText: this.statusText,
        headers: { ...headers }
      });
    }
  };
}

function createAppHarness() {
  const elementsById = new Map();

  // Pre-populate all static IDs from index.html
  const staticIdRegex = /\bid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = staticIdRegex.exec(indexHtml)) !== null) {
    const id = m[1];
    if (!elementsById.has(id)) {
      const el = createMockElement('div', id, elementsById);
      if (id.startsWith('tab-')) el.classList.add('tab-panel');
      if (id.startsWith('nav-')) el.classList.add('nav-btn');
      elementsById.set(id, el);
    }
  }

  // Ensure dynamic workout/player test elements exist cleanly up front
  const ensureIds = [
    'wIn_0_1', 'rIn_0_1', 'autoregBanner', 'autoregTag', 'autoregMessage',
    'e1rmMetric', 'transferMessage', 'prBadgeSlot', 'restDigits', 'restNextCue',
    'floatingRestPill', 'floatingRestDigits', 'floatingRestNext', 'saveStatusIndicator',
    'exPlateCalcRow', 'btnWorkoutFocusMode', 'syncFreshnessStrip', 'macroGapCloserCard'
  ];
  for (const id of ensureIds) {
    if (!elementsById.has(id)) {
      elementsById.set(id, createMockElement('div', id, elementsById));
    }
  }

  const bodyEl = createMockElement('body', '', elementsById);
  const htmlEl = createMockElement('html', '', elementsById);
  const restBarBoxEl = createMockElement('div', '', elementsById);
  restBarBoxEl.classList.add('rest-bar-box');
  const exTargetPillEl = createMockElement('div', '', elementsById);
  exTargetPillEl.classList.add('ex-target-pill');

  const tabPanels = ['tab-today', 'tab-train', 'tab-health', 'tab-fuel', 'tab-body']
    .map((id) => elementsById.get(id))
    .filter(Boolean);
  const navBtns = ['nav-today', 'nav-train', 'nav-health', 'nav-fuel', 'nav-body']
    .map((id) => elementsById.get(id))
    .filter(Boolean);

  const docListeners = new Map();
  const documentMock = {
    readyState: 'loading',
    visibilityState: 'hidden',
    body: bodyEl,
    documentElement: htmlEl,
    createElement(tag) {
      return createMockElement(tag, '', elementsById);
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(sel) {
      if (sel === '#trainViewPrescribed .rest-bar-box') return restBarBoxEl;
      if (sel === '#trainViewPrescribed .ex-target-pill') return exTargetPillEl;
      if (sel && sel.startsWith('#') && !sel.includes(' ')) {
        return elementsById.get(sel.slice(1)) || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.tab-panel') return tabPanels;
      if (sel === '.nav-btn') return navBtns;
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = docListeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
  };

  const localStorageMock = createMockLocalStorage();
  const cachesMock = createMockCaches();

  const swPostMessages = [];
  const navigatorMock = {
    onLine: true,
    vibrate: () => {},
    serviceWorker: {
      controller: {
        postMessage(msg) {
          swPostMessages.push(msg);
        }
      }
    }
  };

  let fetchCalls = [];
  let fetchHandler = async () => makeMockResponse({ success: true }, { status: 200 });
  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return fetchHandler(String(url), options);
  };

  // Tracked deterministic timers that unref so Node exits cleanly
  let nextTimerId = 1;
  const activeTimeouts = new Map();
  const activeIntervals = new Map();

  function mockSetTimeout(fn, delay = 0, ...args) {
    const id = nextTimerId++;
    const handle = setTimeout(() => {
      activeTimeouts.delete(id);
      if (typeof fn === 'function') fn(...args);
    }, Math.min(Number(delay) || 0, 50));
    if (typeof handle.unref === 'function') handle.unref();
    activeTimeouts.set(id, handle);
    return id;
  }
  function mockClearTimeout(id) {
    const handle = activeTimeouts.get(id);
    if (handle) {
      clearTimeout(handle);
      activeTimeouts.delete(id);
    }
  }
  function mockSetInterval(fn, delay = 250, ...args) {
    const id = nextTimerId++;
    const handle = setInterval(() => {
      if (typeof fn === 'function') fn(...args);
    }, Math.max(25, Number(delay) || 250));
    if (typeof handle.unref === 'function') handle.unref();
    activeIntervals.set(id, handle);
    return id;
  }
  function mockClearInterval(id) {
    const handle = activeIntervals.get(id);
    if (handle) {
      clearInterval(handle);
      activeIntervals.delete(id);
    }
  }
  function cleanupTimers() {
    for (const h of activeTimeouts.values()) clearTimeout(h);
    activeTimeouts.clear();
    for (const h of activeIntervals.values()) clearInterval(h);
    activeIntervals.clear();
  }

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    resume() {
      return Promise.resolve();
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {}
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}
      };
    }
  }

  const winListeners = new Map();
  const context = {
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    URLSearchParams,
    AbortController,
    Response: function (body, init) {
      return makeMockResponse(body, init);
    },
    document: documentMock,
    localStorage: localStorageMock,
    navigator: navigatorMock,
    caches: cachesMock,
    fetch: fetchMock,
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    speechSynthesis: {
      speak() {},
      cancel() {},
      getVoices() { return []; }
    },
    SpeechSynthesisUtterance: function (text) {
      this.text = text;
    },
    setTimeout: mockSetTimeout,
    clearTimeout: mockClearTimeout,
    setInterval: mockSetInterval,
    clearInterval: mockClearInterval,
    location: { search: '', href: 'https://pulse.local/', origin: 'https://pulse.local', pathname: '/' },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = winListeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    matchMedia() {
      return { matches: false, addEventListener() {} };
    },
    requestAnimationFrame(cb) {
      return mockSetTimeout(cb, 0);
    },
    cancelAnimationFrame(id) {
      mockClearTimeout(id);
    }
  };
  context.window = context;
  context.globalThis = context;
  context.self = context;

  vm.createContext(context);
  for (const relPath of SCRIPT_ORDER) {
    const absPath = path.join(ROOT_DIR, relPath);
    const code = fs.readFileSync(absPath, 'utf8');
    vm.runInContext(code, context, { filename: relPath });
  }

  return {
    ctx: context,
    document: documentMock,
    elementsById,
    restBarBoxEl,
    localStorage: localStorageMock,
    navigator: navigatorMock,
    caches: cachesMock,
    swPostMessages,
    eval(code) {
      return vm.runInContext(code, context);
    },
    setFetchHandler(fn) {
      fetchHandler = fn;
    },
    getFetchCalls() {
      return fetchCalls;
    },
    clearFetchCalls() {
      fetchCalls = [];
    },
    cleanupTimers
  };
}

async function flushMicrotasks(ticks = 30) {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ==================== TEST SUITE ====================
async function runAllTests() {
  // [1] WCAG AA Contrast Math & Token Hygiene
  {
    const rootMatch = stylesCss.match(/:root\s*\{([\s\S]*?)\}/);
    assert(rootMatch, ':root block must exist in css/styles.css');
    const rootBlock = rootMatch[1];

    function parseVar(name) {
      const m = rootBlock.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
      assert(m, `CSS variable ${name} must be defined in :root`);
      return m[1].trim();
    }

    const bg = parseVar('--bg');
    const surface = parseVar('--surface');
    const surfaceElevated = parseVar('--surface-elevated');
    const textSecondary = parseVar('--text-secondary');
    const textMuted = parseVar('--text-muted');
    const textDim = parseVar('--text-dim');
    const primary = parseVar('--primary');
    const success = parseVar('--success');

    assert.strictEqual(surface.toLowerCase(), '#0c1017');
    assert.strictEqual(surfaceElevated.toLowerCase(), '#131822');
    assert(bg && textDim, '--bg and --text-dim must be defined');

    function hexToRgb(hex) {
      const clean = hex.replace('#', '').trim();
      assert(/^[0-9a-fA-F]{6}$/.test(clean), `Expected 6-digit hex color, got ${hex}`);
      return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16)
      ];
    }

    function relLuminance(hex) {
      const [r, g, b] = hexToRgb(hex).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(hex1, hex2) {
      const l1 = relLuminance(hex1);
      const l2 = relLuminance(hex2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    assert(contrastRatio(textSecondary, '#131822') >= 4.5, '--text-secondary vs #131822 must be >= 4.5');
    assert(contrastRatio(textSecondary, '#0c1017') >= 4.5, '--text-secondary vs #0c1017 must be >= 4.5');
    assert(contrastRatio(textMuted, '#131822') >= 4.5, '--text-muted vs #131822 must be >= 4.5');
    assert(contrastRatio(textMuted, '#0c1017') >= 4.5, '--text-muted vs #0c1017 must be >= 4.5');

    assert(success && success.startsWith('#'), '--success must exist');
    assert.notStrictEqual(success.toLowerCase(), primary.toLowerCase(), '--success must differ from --primary');
    assert.strictEqual(indexHtml.includes('var(--text-dim)'), false, 'index.html must have zero occurrences of var(--text-dim)');

    console.log('PASS [1] WCAG AA Contrast Math & Token Hygiene');
  }

  const app = createAppHarness();
  try {
    // [2] Barbell Plate Calculator
    {
      const calc95 = app.ctx.computeBarbellPlatesPerSide(95, 20);
      assert.strictEqual(calc95.valid, true);
      assert.strictEqual(calc95.barOnly, false);
      assert.deepStrictEqual(Array.from(calc95.plates), [20, 15, 2.5]);

      const calc20 = app.ctx.computeBarbellPlatesPerSide(20, 20);
      assert.strictEqual(calc20.valid, true);
      assert.strictEqual(calc20.barOnly, true);
      assert.deepStrictEqual(Array.from(calc20.plates), []);
      assert(calc20.label.includes('Bar only'), `Expected "Bar only" in label, got ${calc20.label}`);

      assert.strictEqual(app.ctx._isBarbellPlateEligible({ name: 'Barbell Bent-Over Pendlay Row', requiredGear: ['barbell'] }), true);
      assert.strictEqual(app.ctx._isBarbellPlateEligible({ name: 'Dumbbell Chest Press', requiredGear: ['db'] }), false);
      assert.strictEqual(app.ctx._isBarbellPlateEligible({ name: 'Kettlebell Floor Press', requiredGear: ['barbell', 'kb'] }), false);

      const plateRow = app.document.getElementById('exPlateCalcRow');
      app.ctx._updatePlateCalcForExercise({ name: 'Barbell Floor Press', requiredGear: ['barbell'], targetWeight: 95 });
      assert.strictEqual(plateRow.style.display, 'block');
      assert(plateRow.innerText.includes('20 + 15 + 2.5'), `Unexpected plate text: ${plateRow.innerText}`);

      app.ctx._updatePlateCalcForExercise({ name: 'Dumbbell Chest Press', requiredGear: ['db'], targetWeight: 22.5 });
      assert.strictEqual(plateRow.style.display, 'none');

      app.ctx._updatePlateCalcForExercise({ name: 'Kettlebell Floor Press', requiredGear: ['kb'], targetWeight: 24 });
      assert.strictEqual(plateRow.style.display, 'none');

      app.ctx._updatePlateCalcForExercise({ name: 'Push-Ups', requiredGear: ['bodyweight'], targetWeight: 'Body' });
      assert.strictEqual(plateRow.style.display, 'none');

      console.log('PASS [2] Barbell Plate Calculator');
    }

    // [3] stepSetInput Precision Steppers
    {
      app.eval(`
        activeWorkoutPlan = [{
          id: 'barbell_floor_press',
          name: 'Barbell Floor Press',
          targetWeight: 60,
          targetReps: 8,
          setsCount: 3,
          rest: '90s',
          requiredGear: ['barbell']
        }];
        currentExIdx = 0;
      `);

      const wEl = app.document.getElementById('wIn_0_1');
      const rEl = app.document.getElementById('rIn_0_1');

      wEl.value = '60';
      app.ctx.stepSetInput(0, 1, 'weight', 2.5);
      assert.strictEqual(String(wEl.value), '62.5');
      app.ctx.stepSetInput(0, 1, 'weight', -5);
      assert.strictEqual(String(wEl.value), '57.5');

      wEl.value = '2×22.5kg';
      app.ctx.stepSetInput(0, 1, 'weight', 2.5);
      assert.strictEqual(String(wEl.value), '2×25kg');

      wEl.value = 'Body';
      app.ctx.stepSetInput(0, 1, 'weight', 2.5);
      assert.strictEqual(String(wEl.value), 'Body');

      rEl.value = '8';
      app.ctx.stepSetInput(0, 1, 'reps', 1);
      assert.strictEqual(String(rEl.value), '9');

      rEl.value = 'AMRAP';
      app.ctx.stepSetInput(0, 1, 'reps', 1);
      assert.strictEqual(String(rEl.value), 'AMRAP');

      console.log('PASS [3] stepSetInput Precision Steppers');
    }

    // [4] Workout Focus Mode Lifecycle & CSS
    {
      assert(stylesCss.includes('body.workout-focus-mode #floatingRestPill'), 'CSS missing body.workout-focus-mode #floatingRestPill rule');
      assert(stylesCss.includes('body.workout-focus-mode .rest-bar-box.rest-active'), 'CSS missing body.workout-focus-mode .rest-bar-box.rest-active rule');

      const focusBtn = app.document.getElementById('btnWorkoutFocusMode');
      app.document.body.classList.remove('workout-focus-mode');

      app.ctx.toggleWorkoutFocusMode();
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), true);
      assert.strictEqual(focusBtn.innerText, 'Focus On');

      app.ctx.toggleWorkoutFocusMode();
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), false);
      assert.strictEqual(focusBtn.innerText, 'Focus Mode');

      app.ctx.toggleWorkoutFocusMode();
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), true);
      app.ctx.switchTab('today');
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), false);

      app.ctx.toggleWorkoutFocusMode();
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), true);
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      app.ctx.finishSession();
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), false);

      console.log('PASS [4] Workout Focus Mode Lifecycle & CSS');
    }

    // [5] logSet() Synchronous + Async PR Badge Reconciliation
    {
      app.eval(`
        window.PULSE_ANALYTICS_SUMMARY = { strength_prs: { barbell_floor_press: { e1rm: 80.0 } } };
        window.BAKED_LIVE_STATE.strength_prescriptions = { barbell_floor_press: { weight: 65, reps: 6, e1rm: 80.0 } };
        activeWorkoutPlan = [{
          id: 'barbell_floor_press',
          name: 'Barbell Floor Press',
          targetWeight: 65,
          targetReps: 6,
          setsCount: 3,
          rest: '90s',
          requiredGear: ['barbell']
        }];
        currentExIdx = 0;
        sessionLoggedSets = {};
      `);

      const prSlot = app.document.getElementById('prBadgeSlot');
      const wEl = app.document.getElementById('wIn_0_1');
      const rEl = app.document.getElementById('rIn_0_1');
      wEl.value = '70';
      rEl.value = '8';

      const rowMock = app.document.createElement('div');
      rowMock.className = 'set-log-row';
      const btnMock = app.document.createElement('button');
      rowMock.appendChild(btnMock);

      // Case A: backend confirms PR
      app.setFetchHandler(async (url) => {
        if (url.includes('/api/sync_set')) {
          return makeMockResponse({ success: true, result: { is_pr: true, e1rm: 88.7 } }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });

      app.ctx.logSet(btnMock, 1, 'barbell_floor_press', 65, 6);
      assert(prSlot.innerHTML.includes('pr-badge'), 'Synchronous PR badge should render immediately');
      assert(prSlot.innerHTML.includes('88.7'), 'Synchronous PR badge should show 88.7');
      await flushMicrotasks();
      assert(prSlot.innerHTML.includes('pr-badge'), 'Confirmed PR badge should remain after microtasks');

      // Case B: reset floor to 80.0, backend returns is_pr: false
      app.eval(`
        localStorage.removeItem('pulse_strength_prescriptions');
        window.PULSE_ANALYTICS_SUMMARY = { strength_prs: { barbell_floor_press: { e1rm: 80.0 } } };
        window.BAKED_LIVE_STATE.strength_prescriptions = { barbell_floor_press: { weight: 65, reps: 6, e1rm: 80.0 } };
      `);
      app.setFetchHandler(async (url) => {
        if (url.includes('/api/sync_set')) {
          return makeMockResponse({ success: true, result: { is_pr: false, e1rm: 88.7 } }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });

      app.ctx.logSet(btnMock, 1, 'barbell_floor_press', 65, 6);
      assert(prSlot.innerHTML.includes('pr-badge'), 'Optimistic PR badge should appear synchronously');
      await flushMicrotasks();
      assert.strictEqual(prSlot.innerHTML, '', 'Backend is_pr=false should clear optimistic PR badge');

      // Switching exercises via renderCurrentExercise() clears #prBadgeSlot.innerHTML
      prSlot.innerHTML = '<span class="pr-badge">TEMP</span>';
      app.ctx.renderCurrentExercise();
      assert.strictEqual(prSlot.innerHTML, '', 'renderCurrentExercise() must clear #prBadgeSlot');

      console.log('PASS [5] logSet() Synchronous + Async PR Badge Reconciliation');
    }

    // [6] Sync Freshness Strip Routing & Display
    {
      const strip = app.document.getElementById('syncFreshnessStrip');
      const fallbackState = {
        garmin: { last_synced: null },
        renpho: { last_synced: null, last_checked: null },
        mnd_logged: { last_synced: null }
      };

      app.ctx.renderSyncFreshnessStrip(null, fallbackState);
      assert.strictEqual((strip.innerHTML.match(/class="sync-chip /g) || []).length, 3);
      assert(strip.innerHTML.includes("openSyncModal('garmin')"));
      assert(strip.innerHTML.includes('openWeightModal()'));
      assert(strip.innerHTML.includes("openSyncModal('mnd')"));

      app.ctx.renderSyncFreshnessStrip({
        sync_freshness: {
          garmin: { age_minutes: 10, stale: false },
          renpho: { last_checked: '2026-11-20T10:00:00Z', age_minutes: 5, stale: false, weigh_in_age_hours: 48 },
          mnd: { age_minutes: 400, stale: true }
        }
      }, fallbackState);

      assert(strip.innerHTML.includes('5m ago'), 'Renpho chip should show poll age 5m ago');
      assert(strip.innerHTML.includes('2d ago'), 'Renpho chip should show weigh-in age 2d ago');
      assert(strip.innerHTML.includes("sync-chip fresh\" onclick=\"openSyncModal('garmin')\""));
      assert(strip.innerHTML.includes('sync-chip fresh" onclick="openWeightModal()"'));
      assert(strip.innerHTML.includes("sync-chip stale\" onclick=\"openSyncModal('mnd')\""));

      console.log('PASS [6] Sync Freshness Strip Routing & Display');
    }

    // [7] Macro Gap Closer (renderMacroGapCloser & logMacroGapCombo)
    {
      const card = app.document.getElementById('macroGapCloserCard');

      app.ctx.renderMacroGapCloser(2100, 1750, 200, 140);
      assert.strictEqual((card.innerHTML.match(/class="gap-closer-row"/g) || []).length, 3);
      assert(card.innerHTML.includes('logMacroGapCombo('));

      app.ctx.renderMacroGapCloser(2100, 1750, 200, 205);
      assert(card.innerHTML.includes('Protein target met — prioritize hydration/fiber.'));

      app.ctx.renderMacroGapCloser(2100, 2200, 200, 150);
      const comboIds = [...card.innerHTML.matchAll(/data-combo-id="([^"]+)"/g)].map((m) => m[1]);
      assert.strictEqual(comboIds.length, 3);
      const comboMap = new Map(app.eval('MACRO_GAP_COMBOS').map((c) => [c.id, c]));
      for (const cid of comboIds) {
        const item = comboMap.get(cid);
        assert(item && item.cals < 200, `Expected combo ${cid} to be < 200 kcal`);
      }

      // Reset myNetDiaryData and mock fetch for /api/mnd/manual
      app.eval(`
        myNetDiaryData = {
          date: '2026-11-20',
          totals: _createEmptyMndTotals(),
          history: DEFAULT_MND_10D_HISTORY,
          meals: _createEmptyMndMeals()
        };
      `);
      app.clearFetchCalls();
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));

      app.ctx.logMacroGapCombo('casein_milk');
      await flushMicrotasks();

      const snacksItems = app.eval('myNetDiaryData.meals.snacks.items');
      assert(snacksItems.some((it) => it.name === 'Casein Shake + Skim Milk'), 'Snacks should contain Casein Shake + Skim Milk');
      assert.strictEqual(app.eval('myNetDiaryData.totals.calories'), 230);
      assert.strictEqual(app.eval('myNetDiaryData.totals.protein'), 34);

      const mndCalls = app.getFetchCalls().filter((c) => c.url.includes('/api/mnd/manual'));
      assert.strictEqual(mndCalls.length, 1, 'Expected POST /api/mnd/manual call');
      const sentBody = JSON.parse(mndCalls[0].options.body);
      assert.strictEqual(sentBody.meal_category, 'snacks');
      assert.strictEqual(sentBody.logged_item.name, 'Casein Shake + Skim Milk');

      console.log('PASS [7] Macro Gap Closer (renderMacroGapCloser & logMacroGapCombo)');
    }

    // [8] Cloud Preference Sync & Queue-Safe Hydration
    {
      app.localStorage.clear();
      app.localStorage.setItem('pulse_current_goal', 'aerobic');
      app.clearFetchCalls();
      app.setFetchHandler(async () => makeMockResponse({ success: true, preferences: { fields: {} }, field_resolutions: {} }, { status: 200 }));

      await app.ctx.syncClientPreferencesToCloud('goal_key', true);
      const tsMapRaw = app.localStorage.getItem('pulse_pref_timestamps_v1');
      assert(tsMapRaw, 'pulse_pref_timestamps_v1 must be written');
      const tsMap = JSON.parse(tsMapRaw);
      assert(typeof tsMap.goal_key === 'number' && tsMap.goal_key > 0);

      const prefPostCalls = app.getFetchCalls().filter((c) => c.url.includes('/api/preferences/state') && c.options.method === 'POST');
      assert.strictEqual(prefPostCalls.length, 1);

      // Queue-safe hydration check
      app.localStorage.setItem('pulse_offline_write_queue', JSON.stringify([
        {
          id: 'q1',
          endpoint: '/api/preferences/state',
          method: 'POST',
          body: { fields: { goal_key: { value: 'aerobic', updated_at_ms: 200 } } },
          queuedAt: 200
        }
      ]));
      app.localStorage.setItem('pulse_current_goal', 'aerobic');
      app.localStorage.setItem('pulse_diet_strategy', 'balanced');
      app.localStorage.setItem('pulse_pref_timestamps_v1', JSON.stringify({ goal_key: 100, diet_strategy: 100 }));

      app.setFetchHandler(async (url) => {
        if (url.includes('/api/preferences/state')) {
          return makeMockResponse({
            success: true,
            preferences: {
              fields: {
                goal_key: { value: 'recomp', updated_at_ms: 999999 },
                diet_strategy: { value: 'lowcarb', updated_at_ms: 50000 }
              }
            }
          }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });

      await app.ctx.hydrateClientPreferencesFromCloud();
      assert.strictEqual(app.localStorage.getItem('pulse_current_goal'), 'aerobic', 'Queued goal_key must not be overwritten');
      assert.strictEqual(app.localStorage.getItem('pulse_diet_strategy'), 'lowcarb', 'Unqueued older diet_strategy should hydrate');

      console.log('PASS [8] Cloud Preference Sync & Queue-Safe Hydration');
    }

    // [9] Service Worker (sw.js) & logoutPulseSession
    {
      const swCaches = createMockCaches();
      const swListeners = new Map();
      let swFetchImpl = async (req) => makeMockResponse({ ok: true }, { status: 200 });
      let skipWaitingCalled = false;
      let clientsClaimCalled = false;

      const swContext = {
        console,
        URL,
        Promise,
        JSON,
        caches: swCaches,
        Response: function (body, init) {
          return makeMockResponse(body, init);
        },
        fetch: (req, opts) => swFetchImpl(req, opts),
        self: null
      };
      swContext.self = {
        location: { origin: 'https://pulse.local' },
        addEventListener(type, fn) {
          if (!swListeners.has(type)) swListeners.set(type, []);
          swListeners.get(type).push(fn);
        },
        skipWaiting() {
          skipWaitingCalled = true;
        },
        clients: {
          claim() {
            clientsClaimCalled = true;
          }
        }
      };
      vm.createContext(swContext);
      vm.runInContext(swJsCode, swContext, { filename: 'sw.js' });

      assert.strictEqual(vm.runInContext('CACHE_NAME', swContext), 'pulse-hybrid-v6.8-20261125');

      // Run install event
      const installPromises = [];
      for (const fn of swListeners.get('install') || []) {
        fn({ waitUntil: (p) => installPromises.push(p) });
      }
      await Promise.all(installPromises);
      assert.strictEqual(skipWaitingCalled, true);

      // Run activate event and verify safe clients.claim() wrapper
      assert(
        swJsCode.includes('Promise.resolve(self.clients.claim()).catch(() => {})'),
        'sw.js must wrap self.clients.claim() with Promise.resolve(...).catch(() => {})'
      );
      const activatePromises = [];
      for (const fn of swListeners.get('activate') || []) {
        fn({ waitUntil: (p) => activatePromises.push(p) });
      }
      await Promise.all(activatePromises);
      assert.strictEqual(clientsClaimCalled, true);

      const cacheMap = swCaches._stores.get('pulse-hybrid-v6.8-20261125');
      assert(cacheMap, 'Cache bucket must exist after install');
      for (const asset of [
        '/js/workout-catalog.js?v=6.8',
        '/js/workout-verdict.js?v=6.8',
        '/js/workout-player.js?v=6.8',
        '/js/workout-timers.js?v=6.8',
        '/js/diagnostics.js?v=6.8',
        '/js/autonomic-tracker.js?v=6.8'
      ]) {
        assert(cacheMap.has(`https://pulse.local${asset}`), `STATIC_ASSETS missing ${asset}`);
      }

      // Cache-First check for /js/state.js?v=6.8
      let swNetworkHits = 0;
      swFetchImpl = async () => {
        swNetworkHits++;
        return makeMockResponse('network', { status: 200 });
      };
      let respondedPromise = null;
      for (const fn of swListeners.get('fetch') || []) {
        fn({
          request: { method: 'GET', url: 'https://pulse.local/js/state.js?v=6.8', mode: 'no-cors' },
          respondWith: (p) => { respondedPromise = p; }
        });
      }
      await respondedPromise;
      assert.strictEqual(swNetworkHits, 0, 'Cached /js/state.js?v=6.8 must be served Cache-First without network hit');

      // /api/preferences/state must NOT be cached, while /api/analytics/summary MUST be cached
      swFetchImpl = async () => makeMockResponse({ ok: true }, { status: 200 });

      for (const fn of swListeners.get('fetch') || []) {
        fn({
          request: { method: 'GET', url: 'https://pulse.local/api/preferences/state', mode: 'cors' },
          respondWith: (p) => { respondedPromise = p; }
        });
      }
      await respondedPromise;
      await flushMicrotasks();
      assert.strictEqual(cacheMap.has('https://pulse.local/api/preferences/state'), false, '/api/preferences/state must NEVER be cached');

      for (const fn of swListeners.get('fetch') || []) {
        fn({
          request: { method: 'GET', url: 'https://pulse.local/api/analytics/summary', mode: 'cors' },
          respondWith: (p) => { respondedPromise = p; }
        });
      }
      await respondedPromise;
      await flushMicrotasks();
      assert.strictEqual(cacheMap.has('https://pulse.local/api/analytics/summary'), true, '/api/analytics/summary 200 must be cached');

      // Fire PULSE_PURGE_API_CACHE message event
      const msgPromises = [];
      for (const fn of swListeners.get('message') || []) {
        fn({
          data: { type: 'PULSE_PURGE_API_CACHE' },
          waitUntil: (p) => msgPromises.push(p)
        });
      }
      await Promise.all(msgPromises);
      assert.strictEqual(cacheMap.has('https://pulse.local/api/analytics/summary'), false, 'PULSE_PURGE_API_CACHE must delete /api/analytics/summary');
      assert.strictEqual(cacheMap.has('https://pulse.local/js/state.js?v=6.8'), true, 'PULSE_PURGE_API_CACHE must preserve /js/state.js?v=6.8');

      // Back in app context: verify logoutPulseSession()
      app.localStorage.setItem('pulse_cached_live_state', '{"a":1}');
      app.localStorage.setItem('pulse_analytics_summary_cache', '{"b":2}');
      app.localStorage.setItem('pulse_garmin_today_backup', '{"c":3}');
      app.swPostMessages.length = 0;
      app.clearFetchCalls();
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));

      await app.ctx.logoutPulseSession();
      assert.strictEqual(app.localStorage.getItem('pulse_cached_live_state'), null);
      assert.strictEqual(app.localStorage.getItem('pulse_analytics_summary_cache'), null);
      assert.strictEqual(app.localStorage.getItem('pulse_garmin_today_backup'), null);
      assert(app.swPostMessages.some((m) => m && m.type === 'PULSE_PURGE_API_CACHE'), 'Expected PULSE_PURGE_API_CACHE postMessage');
      assert(app.getFetchCalls().some((c) => c.url.includes('/api/auth/logout') && c.options.method === 'POST'), 'Expected POST /api/auth/logout');

      console.log('PASS [9] Service Worker (sw.js) & logoutPulseSession');
    }
  } finally {
    app.cleanupTimers();
  }
}

runAllTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exitCode = 1;
});
