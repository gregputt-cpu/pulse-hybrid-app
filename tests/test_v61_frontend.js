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

function _matchesSimpleSelector(el, sel) {
  const s = String(sel || '').trim();
  if (!s) return false;
  if (s.startsWith('#')) return el.id === s.slice(1);
  if (s.startsWith('.')) return Boolean(el.classList && el.classList.contains(s.slice(1)));
  if (s.includes('[')) {
    const m = s.match(/^([a-zA-Z0-9-]+)?\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (m) {
      const tagOk = !m[1] || el.tagName === m[1].toUpperCase();
      const attrVal = el.getAttribute(m[2]);
      if (!tagOk) return false;
      if (m[3] !== undefined) return attrVal === m[3];
      return attrVal !== null;
    }
  }
  return el.tagName === s.toUpperCase();
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
        if (_matchesSimpleSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      const all = el.querySelectorAll(sel);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(sel) {
      const parts = String(sel || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return [];
      const found = [];
      const walk = (node) => {
        for (const child of node.children || []) {
          if (parts.some((p) => _matchesSimpleSelector(child, p))) {
            found.push(child);
          }
          walk(child);
        }
      };
      walk(el);
      if (found.length === 0 && parts.length === 1 && parts[0].startsWith('#') && registry) {
        const byId = registry.get(parts[0].slice(1));
        if (byId) return [byId];
      }
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
    const valMatch = attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
    const detailsMatch = attrs.match(/\bdata-details-key\s*=\s*["']([^"']+)["']/i);
    if (!idMatch && !classMatch && !detailsMatch) continue;
    const id = idMatch ? idMatch[1] : '';
    const child = createMockElement(tag, id, registry);
    if (classMatch) child.className = classMatch[1];
    if (valMatch) child.value = valMatch[1];
    if (detailsMatch) child.setAttribute('data-details-key', detailsMatch[1]);
    if (parentEl) {
      child.parentElement = parentEl;
      parentEl.children.push(child);
    }
    if (id) registry.set(id, child);
  }
}

function createMockLocalStorage(initial = null) {
  const store = new Map();
  if (initial && typeof initial === 'object') {
    for (const [k, v] of Object.entries(initial)) {
      store.set(String(k), String(v));
    }
  }
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

function createMockCaches() {
  const stores = new Map();
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

function createAppHarness(opts = {}) {
  const elementsById = new Map();

  // Pre-populate all static IDs from index.html
  const staticTagRegex = /<([a-zA-Z0-9-]+)([^>]*\bid\s*=\s*["'][^"']+["'][^>]*)>/g;
  let m;
  while ((m = staticTagRegex.exec(indexHtml)) !== null) {
    const tag = m[1];
    const attrs = m[2] || '';
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (!elementsById.has(id)) {
      const el = createMockElement(tag, id, elementsById);
      const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
      if (classMatch) el.className = classMatch[1];
      const valMatch = attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
      if (valMatch) el.value = valMatch[1];
      if (id.startsWith('tab-')) el.classList.add('tab-panel');
      if (id.startsWith('nav-')) el.classList.add('nav-btn');
      elementsById.set(id, el);
    }
  }

  // Ensure dynamic workout/player test elements exist cleanly up front
  const ensureIds = [
    'wIn_0_1', 'wIn_0_2', 'wIn_0_3', 'wIn_0_4',
    'rIn_0_1', 'rIn_0_2', 'rIn_0_3', 'rIn_0_4',
    'autoregBanner', 'autoregTag', 'autoregMessage',
    'e1rmMetric', 'transferMessage', 'prBadgeSlot', 'restDigits', 'restNextCue',
    'floatingRestPill', 'floatingRestDigits', 'floatingRestNext', 'saveStatusIndicator',
    'exPlateCalcRow', 'btnWorkoutFocusMode', 'syncFreshnessStrip', 'macroGapCloserCard',
    'weeklyPatternBalance', 'telemetryOverrideErr', 'pulseAuthError', 'fuelBaseActiveSub',
    'sliderProtein', 'sliderFat', 'sliderValProtein', 'sliderValFat', 'proDialCals', 'sliderValCarbs',
    'renphoTrendChartContainer', 'strengthProgressionContainer', 'assessmentResultCard'
  ];
  for (const id of ensureIds) {
    if (!elementsById.has(id)) {
      elementsById.set(id, createMockElement('div', id, elementsById));
    }
  }

  // Populate <details data-details-key="..."> elements from index.html
  const detailsEls = [];
  const detailsMap = new Map();
  const detailsRegex = /<details\b([^>]*)>/g;
  let dm;
  while ((dm = detailsRegex.exec(indexHtml)) !== null) {
    const attrs = dm[1] || '';
    const keyMatch = attrs.match(/\bdata-details-key\s*=\s*["']([^"']+)["']/i);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    const det = createMockElement('details', '', elementsById);
    det.setAttribute('data-details-key', key);
    det.open = /\bopen\b/i.test(attrs);
    detailsEls.push(det);
    detailsMap.set(key, det);
  }

  // Train subview buttons + an unrelated .btn-subview outside .train-subview-nav
  const btnTrainPrescribed = elementsById.get('btnTrainPrescribed');
  const btnTrainHistory = elementsById.get('btnTrainHistory');
  const trainSubviewBtns = [btnTrainPrescribed, btnTrainHistory].filter(Boolean);
  for (const b of trainSubviewBtns) b.classList.add('btn-subview');
  const unrelatedSubviewBtn = createMockElement('button', 'unrelatedSubviewBtn', elementsById);
  unrelatedSubviewBtn.classList.add('btn-subview', 'active');

  const bodyEl = createMockElement('body', '', elementsById);
  const htmlEl = createMockElement('html', '', elementsById);
  const restBarBoxEl = createMockElement('div', '', elementsById);
  restBarBoxEl.classList.add('rest-bar-box');
  const exTargetPillEl = createMockElement('div', '', elementsById);
  exTargetPillEl.classList.add('ex-target-pill');
  const bodyCardEl = createMockElement('div', '', elementsById);
  bodyCardEl.classList.add('card');

  const tabPanels = ['tab-today', 'tab-train', 'tab-health', 'tab-fuel', 'tab-body']
    .map((id) => elementsById.get(id))
    .filter(Boolean);
  const navBtns = ['nav-today', 'nav-train', 'nav-health', 'nav-fuel', 'nav-body']
    .map((id) => elementsById.get(id))
    .filter(Boolean);
  const goalOptionCards = ['opt_recomp', 'opt_lean_cut', 'opt_surplus', 'opt_custom']
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
      if (sel === '#tab-body .card' || sel === '.card') return bodyCardEl;
      if (sel && sel.startsWith('#') && !sel.includes(' ')) {
        return elementsById.get(sel.slice(1)) || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.tab-panel') return tabPanels;
      if (sel === '.nav-btn') return navBtns;
      if (sel === '.train-subview-nav .btn-subview') return trainSubviewBtns;
      if (sel === '.goal-option-card') return goalOptionCards;
      if (sel === 'details[data-details-key]') {
        const dynamicDetails = [];
        for (const el of elementsById.values()) {
          if (!el || !el.querySelectorAll) continue;
          for (const d of el.querySelectorAll('details[data-details-key]')) {
            if (!detailsEls.includes(d)) dynamicDetails.push(d);
          }
        }
        return [...detailsEls, ...dynamicDetails];
      }
      if (sel === '.modal-overlay.open') {
        const openModals = [];
        for (const el of elementsById.values()) {
          if (el.classList && el.classList.contains('modal-overlay') && el.classList.contains('open')) {
            openModals.push(el);
          }
        }
        return openModals;
      }
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

  const localStorageMock = createMockLocalStorage(opts.preInitLocalStorage || null);
  const cachesMock = createMockCaches();

  const swPostMessages = [];
  const swEventListeners = new Map();
  let swUpdateCalls = 0;
  const navigatorMock = {
    onLine: opts.onLine !== undefined ? opts.onLine : true,
    vibrate: () => {},
    serviceWorker: {
      controller: {
        postMessage(msg) {
          swPostMessages.push(msg);
        }
      },
      async register() {
        return {
          async update() {
            swUpdateCalls++;
          },
          installing: null,
          onupdatefound: null
        };
      },
      addEventListener(type, fn) {
        if (!swEventListeners.has(type)) swEventListeners.set(type, []);
        swEventListeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = swEventListeners.get(type);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      }
    }
  };

  let fetchCalls = [];
  let fetchHandler = async () => makeMockResponse({ success: true }, { status: 200 });
  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return fetchHandler(String(url), options);
  };

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

  let reloadCount = 0;
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
    Intl,
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
    location: {
      protocol: 'https:',
      search: opts.search || '',
      hash: '',
      href: 'https://pulse.local/',
      origin: 'https://pulse.local',
      pathname: '/',
      reload() {
        reloadCount++;
      }
    },
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
    detailsEls,
    detailsMap,
    unrelatedSubviewBtn,
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
    getReloadCount() {
      return reloadCount;
    },
    resetReloadCount() {
      reloadCount = 0;
    },
    getSwUpdateCalls() {
      return swUpdateCalls;
    },
    triggerWindowEvent(type, evt = {}) {
      for (const fn of (winListeners.get(type) || []).slice()) {
        fn(evt);
      }
    },
    triggerSwEvent(type, evt = {}) {
      for (const fn of (swEventListeners.get(type) || []).slice()) {
        fn(evt);
      }
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

function getTodayUkIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function plain(val) {
  return JSON.parse(JSON.stringify(val));
}

// ==================== TEST SUITE ====================
async function runAllTests() {
  const todayIso = getTodayUkIso();

  // [1] UK Midnight Rollover (js/state.js)
  {
    const staleDate = '2020-01-01';
    const rolloverApp = createAppHarness({
      preInitLocalStorage: {
        pulse_cached_live_state: JSON.stringify({
          date: staleDate,
          last_synced: `${staleDate}T22:00:00Z`,
          athlete: { weight_kg: 80.5 },
          nutrition: {
            base_calorie_target: 2092,
            calorie_target: 2650,
            base_protein_target_g: 200,
            protein_target_g: 210
          },
          garmin: {
            source: 'garmin_oauth',
            steps: 9400,
            active_calories: 558,
            inapp_burn_today: 240,
            today_activities: [{ id: 'old1' }],
            sleep_score: 88,
            training_readiness: 79,
            mnd_logged: { calories: 1900, date: staleDate },
            mnd_meals: { breakfast: { calories: 500, items: [{ name: 'Eggs' }] } },
            oauth_date: staleDate,
            oauth_failed_at: `${staleDate}T12:00:00Z`
          }
        }),
        pulse_inapp_burn_today: JSON.stringify([
          { id: 'old_entry', date: staleDate, calories: 300, kind: 'strength' },
          { id: 'today_entry', date: todayIso, calories: 180, kind: 'conditioning' }
        ])
      }
    });
    try {
      const baked = rolloverApp.eval('window.BAKED_LIVE_STATE');
      assert.strictEqual(baked.date, todayIso, 'Rollover must advance BAKED_LIVE_STATE.date to today UK ISO');
      assert.strictEqual(baked.garmin.mnd_logged, null, 'Rollover must clear garmin.mnd_logged');
      assert.strictEqual(baked.garmin.mnd_meals, null, 'Rollover must clear garmin.mnd_meals');
      assert.strictEqual(baked.garmin.oauth_date, null, 'Rollover must clear garmin.oauth_date');
      assert.strictEqual(baked.garmin.oauth_failed_at, null, 'Rollover must clear garmin.oauth_failed_at');
      assert.strictEqual(baked.garmin.steps, 0);
      assert.strictEqual(baked.garmin.active_calories, 0);
      assert.deepStrictEqual(Array.from(baked.garmin.today_activities), []);
      assert.strictEqual(baked.nutrition.calorie_target, 2092, 'Rollover must reset calorie_target to base_calorie_target');
      assert.strictEqual(baked.nutrition.protein_target_g, 200);

      const keptBurn = JSON.parse(rolloverApp.localStorage.getItem('pulse_inapp_burn_today'));
      assert.strictEqual(keptBurn.length, 1, 'Prior-date entries in pulse_inapp_burn_today must be dropped');
      assert.strictEqual(keptBurn[0].id, 'today_entry');
    } finally {
      rolloverApp.cleanupTimers();
    }

    // Legacy object format on prior date must also be removed on rollover
    const legacyBurnApp = createAppHarness({
      preInitLocalStorage: {
        pulse_inapp_burn_today: JSON.stringify({ date: staleDate, calories: 250 })
      }
    });
    try {
      assert.strictEqual(legacyBurnApp.localStorage.getItem('pulse_inapp_burn_today'), null);
    } finally {
      legacyBurnApp.cleanupTimers();
    }

    console.log('PASS [1] UK Midnight Rollover (state.js)');
  }

  const app = createAppHarness();
  try {
    // [2] computeMacroTargets() Parity & Live Goal/Strategy Recomputation
    {
      // Balanced: base 2092 + 0 active, 200P -> remCals = 1292 -> C=round(1292*0.62/4)=200, F=round(1292*0.38/9)=55
      const bal = plain(app.ctx.computeMacroTargets({
        baseCalories: 2092, activeCalories: 0, baseProtein: 200, dietStrategy: 'balanced'
      }));
      assert.deepStrictEqual(bal, { calorie_target: 2092, protein_target_g: 200, carbs_target_g: 200, fat_target_g: 55 });

      // Low-carb: 75g carbs, remCals = 2400 - 800 = 1600 -> F = round((1600-300)/9) = 144
      const lc = plain(app.ctx.computeMacroTargets({
        baseCalories: 2100, activeCalories: 300, baseProtein: 200, dietStrategy: 'lowcarb'
      }));
      assert.deepStrictEqual(lc, { calorie_target: 2400, protein_target_g: 200, carbs_target_g: 75, fat_target_g: 144 });

      // Carb cycling: high=300, mod=200, low=80
      const ccHigh = plain(app.ctx.computeMacroTargets({
        baseCalories: 2200, activeCalories: 300, baseProtein: 200, dietStrategy: 'carbcycle', carbCycleLevel: 'high'
      }));
      assert.deepStrictEqual(ccHigh, { calorie_target: 2500, protein_target_g: 200, carbs_target_g: 300, fat_target_g: 56 });
      const ccMod = plain(app.ctx.computeMacroTargets({
        baseCalories: 2200, activeCalories: 300, baseProtein: 200, dietStrategy: 'carbcycle', carbCycleLevel: 'mod'
      }));
      assert.deepStrictEqual(ccMod, { calorie_target: 2500, protein_target_g: 200, carbs_target_g: 200, fat_target_g: 100 });
      const ccLow = plain(app.ctx.computeMacroTargets({
        baseCalories: 2200, activeCalories: 300, baseProtein: 200, dietStrategy: 'carbcycle', carbCycleLevel: 'low'
      }));
      assert.deepStrictEqual(ccLow, { calorie_target: 2500, protein_target_g: 200, carbs_target_g: 80, fat_target_g: 153 });

      // Fasting: 55% carbs / 45% fat of remCals
      const fast = plain(app.ctx.computeMacroTargets({
        baseCalories: 2092, activeCalories: 0, baseProtein: 200, dietStrategy: 'fasting'
      }));
      assert.deepStrictEqual(fast, { calorie_target: 2092, protein_target_g: 200, carbs_target_g: 178, fat_target_g: 65 });

      // Custom Pro Dial: fat_pct clamped [15, 65], default 30
      const pdDefault = plain(app.ctx.computeMacroTargets({
        baseCalories: 2000, activeCalories: 0, baseProtein: 180, dietStrategy: 'custom', proDialMacros: { protein: 180 }
      }));
      // fat_pct=30 => fat=round(600/9)=67, carbs=round((2000-720-600)/4)=170
      assert.deepStrictEqual(pdDefault, { calorie_target: 2000, protein_target_g: 180, carbs_target_g: 170, fat_target_g: 67 });

      const pdClampLow = plain(app.ctx.computeMacroTargets({
        baseCalories: 2000, activeCalories: 0, baseProtein: 180, dietStrategy: 'custom', proDialMacros: { protein: 180, fat_pct: 5 }
      }));
      // clamped to 15 => fat=round(300/9)=33, carbs=round((2000-720-300)/4)=245
      assert.deepStrictEqual(pdClampLow, { calorie_target: 2000, protein_target_g: 180, carbs_target_g: 245, fat_target_g: 33 });

      const pdClampHigh = plain(app.ctx.computeMacroTargets({
        baseCalories: 2000, activeCalories: 0, baseProtein: 180, dietStrategy: 'custom', proDialMacros: { protein: 180, fat_pct: 90 }
      }));
      // clamped to 65 => fat=round(1300/9)=144, carbs=max(20, round((2000-720-1300)/4))=20
      assert.deepStrictEqual(pdClampHigh, { calorie_target: 2000, protein_target_g: 180, carbs_target_g: 20, fat_target_g: 144 });

      // Live target recomputation across selectGoal / selectDietStrategy / setCarbCycleLevel / applyCustomProDial (no stale 2437)
      app.localStorage.clear();
      app.eval(`
        window.BAKED_LIVE_STATE.date = '${todayIso}';
        window.BAKED_LIVE_STATE.garmin = { active_calories: 0, today_activities: [] };
        window.BAKED_LIVE_STATE.nutrition = { base_calorie_target: 2092, calorie_target: 2092, base_protein_target_g: 200, protein_target_g: 200 };
      `);
      app.setFetchHandler(async () => makeMockResponse({ success: true, preferences: { fields: {} }, field_resolutions: {} }, { status: 200 }));

      app.ctx.selectGoal('recomp');
      assert.notStrictEqual(app.eval('myNetDiaryData.targets.calories'), 2437);
      assert.strictEqual(app.eval('myNetDiaryData.targets.calories'), 2092);

      app.ctx.selectDietStrategy('lowcarb');
      assert.strictEqual(app.eval('myNetDiaryData.targets.carbs'), 75);

      app.ctx.selectDietStrategy('carbcycle');
      app.ctx.setCarbCycleLevel('high');
      assert.strictEqual(app.eval('myNetDiaryData.targets.carbs'), 300);

      app.document.getElementById('sliderProtein').value = '190';
      app.document.getElementById('sliderFat').value = '35';
      app.ctx.applyCustomProDial();
      const expectedPd = app.ctx.computeMacroTargets({
        baseCalories: 2092, activeCalories: 0, baseProtein: 200, dietStrategy: 'custom', proDialMacros: { protein: 190, fat_pct: 35 }
      });
      assert.strictEqual(app.eval('myNetDiaryData.targets.protein'), expectedPd.protein_target_g);
      assert.strictEqual(app.eval('myNetDiaryData.targets.carbs'), expectedPd.carbs_target_g);
      assert.strictEqual(app.eval('myNetDiaryData.targets.fat'), expectedPd.fat_target_g);
      assert.notStrictEqual(app.eval('myNetDiaryData.targets.calories'), 2437);

      await flushMicrotasks();
      console.log('PASS [2] computeMacroTargets() Parity & Live Target Recomputation');
    }

    // [3] pro_dial_macros Cloud Sync, Hydration Order & _pendingPrefFields Protection
    {
      app.localStorage.clear();
      app.eval('if (_prefDebounceTimer) { clearTimeout(_prefDebounceTimer); _prefDebounceTimer = null; } _pendingPrefFields = {};');
      const prefMap = app.eval('PULSE_PREF_MAP');
      assert(prefMap.pro_dial_macros, 'PULSE_PREF_MAP must contain pro_dial_macros');
      assert.strictEqual(prefMap.pro_dial_macros.lsKey, 'pulse_pro_dial_macros');
      assert.strictEqual(prefMap.pro_dial_macros.json, true);

      // Protect _pendingPrefFields during hydrateClientPreferencesFromCloud
      app.localStorage.setItem('pulse_diet_strategy', 'balanced');
      app.localStorage.setItem('pulse_pro_dial_macros', JSON.stringify({ protein: 215, fat_pct: 28 }));
      app.ctx.syncClientPreferencesToCloud('diet_strategy', false); // puts diet_strategy in _pendingPrefFields
      assert(Object.prototype.hasOwnProperty.call(app.eval('_pendingPrefFields'), 'diet_strategy'));

      app.setFetchHandler(async (url) => {
        if (url.includes('/api/preferences/state')) {
          return makeMockResponse({
            success: true,
            preferences: {
              fields: {
                diet_strategy: { value: 'lowcarb', updated_at_ms: Date.now() + 999999 },
                pro_dial_macros: { value: { protein: 230, fat_pct: 25 }, updated_at_ms: Date.now() + 999999 }
              }
            }
          }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });

      await app.ctx.hydrateClientPreferencesFromCloud();
      assert.strictEqual(app.localStorage.getItem('pulse_diet_strategy'), 'balanced', '_pendingPrefFields must protect diet_strategy');
      assert.strictEqual(app.document.getElementById('sliderProtein').value, '230');
      assert.strictEqual(app.document.getElementById('sliderFat').value, '25');
      assert.deepStrictEqual(JSON.parse(app.localStorage.getItem('pulse_pro_dial_macros')), { protein: 230, fat_pct: 25 });

      // Clear pending debounce timer
      app.eval('if (_prefDebounceTimer) { clearTimeout(_prefDebounceTimer); _prefDebounceTimer = null; } _pendingPrefFields = {};');

      // Verify pro_dial_macros hydrates BEFORE diet_strategy when both arrive from cloud
      app.localStorage.clear();
      app.document.getElementById('sliderProtein').value = '200';
      app.document.getElementById('sliderFat').value = '30';
      app.setFetchHandler(async (url) => {
        if (url.includes('/api/preferences/state')) {
          return makeMockResponse({
            success: true,
            preferences: {
              fields: {
                diet_strategy: { value: 'custom', updated_at_ms: 5000 },
                pro_dial_macros: { value: { protein: 225, fat_pct: 20 }, updated_at_ms: 5000 }
              }
            }
          }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });
      await app.ctx.hydrateClientPreferencesFromCloud();
      assert.strictEqual(app.document.getElementById('sliderProtein').value, '225');
      assert.strictEqual(app.document.getElementById('sliderFat').value, '20');
      assert.strictEqual(app.eval('activeDietStrategy'), 'custom');

      console.log('PASS [3] pro_dial_macros Cloud Sync, Hydration Order & _pendingPrefFields Protection');
    }

    // [4] Offline Queue Rules & Offline Callers (Hydration, Weight, Injuries)
    {
      app.localStorage.clear();
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse(null), true);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 0 }), true);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 500 }), true);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 401 }), true);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 408 }), true);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 429 }), true);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 400 }), false);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: false, status: 422 }), false);
      assert.strictEqual(app.ctx._shouldQueueOfflineResponse({ ok: true, status: 200 }), false);

      // Enqueue /api/preferences/state omits client_event_id and client_date
      app.ctx.enqueueOfflineWrite('/api/preferences/state', { fields: { goal_key: { value: 'recomp', updated_at_ms: 1 } } }, 'POST');
      app.ctx.enqueueOfflineWrite('/api/hydration/add', { amount_ml: 500 }, 'POST');
      const q1 = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue'));
      assert.strictEqual(q1.length, 2);
      assert.strictEqual(q1[0].body.client_event_id, undefined, '/api/preferences/state must omit client_event_id');
      assert.strictEqual(q1[0].body.client_date, undefined, '/api/preferences/state must omit client_date');
      assert(q1[1].body.client_event_id, 'Non-pref write must include client_event_id');
      assert.strictEqual(q1[1].body.client_date, todayIso, 'Non-pref write must include client_date');

      // TTL (>72h), attempts cap (>=10), non-retryable 400 & 422 drop, fast-abort on 401 and 0
      const nowMs = Date.now();
      app.localStorage.setItem('pulse_offline_write_queue', JSON.stringify([
        { id: 'expired_ttl', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 100 }, queued_at: nowMs - (73 * 3600 * 1000), attempts: 0 },
        { id: 'max_attempts', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 100 }, queued_at: nowMs, attempts: 10 },
        { id: 'drop_400', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 100 }, queued_at: nowMs, attempts: 0 },
        { id: 'drop_422', endpoint: '/api/sync_set', method: 'POST', body: { weight: 600 }, queued_at: nowMs, attempts: 0 },
        { id: 'abort_401', endpoint: '/api/renpho/manual', method: 'POST', body: { weight_kg: 80 }, queued_at: nowMs, attempts: 0 },
        { id: 'after_abort', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 250 }, queued_at: nowMs, attempts: 0 }
      ]));
      const flushedEndpoints = [];
      app.setFetchHandler(async (url, opts) => {
        flushedEndpoints.push(url);
        if (url.includes('/api/hydration/add')) return makeMockResponse({ error: 'bad' }, { status: 400 });
        if (url.includes('/api/sync_set')) return makeMockResponse({ error: 'unprocessable' }, { status: 422 });
        if (url.includes('/api/renpho/manual')) return makeMockResponse({ error: 'unauth' }, { status: 401 });
        return makeMockResponse({ success: true }, { status: 200 });
      });
      await app.ctx.flushOfflineQueue();
      assert.strictEqual(flushedEndpoints.length, 3, 'Must abort on 401 and NOT send after_abort');
      const remAfter401 = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue'));
      assert.deepStrictEqual(remAfter401.map((x) => x.id), ['abort_401', 'after_abort']);
      assert.strictEqual(remAfter401[0].attempts, 1);
      assert.strictEqual(remAfter401[1].attempts, 0);

      // Fast-abort on status 0
      app.setFetchHandler(async () => makeMockResponse({}, { status: 0 }));
      await app.ctx.flushOfflineQueue();
      const remAfter0 = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue'));
      assert.strictEqual(remAfter0.length, 2);
      assert.strictEqual(remAfter0[0].attempts, 2);
      assert.strictEqual(remAfter0[1].attempts, 0);

      // Verify offline handling on quickAddHydration, saveManualWeight, saveInjuries
      app.localStorage.clear();
      app.navigator.onLine = false;
      await app.ctx.quickAddHydration(500);
      app.document.getElementById('inputManualWeight').value = '80.5';
      app.document.getElementById('inputManualBf').value = '17.0';
      app.ctx.saveManualWeight();
      app.eval('athleteInjuries = { lumbar: true, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false, notes: "test" };');
      await app.ctx.saveInjuries();
      const offlineQ = JSON.parse(app.localStorage.getItem('pulse_offline_write_queue'));
      assert.deepStrictEqual(
        offlineQ.map((x) => x.endpoint),
        ['/api/hydration/add', '/api/renpho/manual', '/api/athlete/injuries']
      );
      app.navigator.onLine = true;

      console.log('PASS [4] Offline Queue Rules & Offline Callers');
    }

    // [5] applyLiveStateToDom() Overrides, Queue Protection, ml.date & null Body Fat
    {
      app.localStorage.clear();
      const nowMs = Date.now();
      // Preserve override when updated_at_ms > oauth_last_synced; expire when <= oauth_last_synced or stale date
      app.localStorage.setItem('pulse_body_battery_override_obj', JSON.stringify({ value: 88, date: todayIso, updated_at_ms: nowMs + 60000 }));
      app.localStorage.setItem('pulse_readiness_override_obj', JSON.stringify({ value: 91, date: todayIso, updated_at_ms: nowMs - 60000 }));
      app.localStorage.setItem('pulse_sleep_score_override_obj', JSON.stringify({ value: 85, date: '2020-01-01', updated_at_ms: nowMs + 60000 }));

      // Queue /api/athlete/injuries, /api/mnd/manual, and /api/hydration/add (today + yesterday)
      app.localStorage.setItem('pulse_offline_write_queue', JSON.stringify([
        { id: 'inj1', endpoint: '/api/athlete/injuries', method: 'POST', body: { lumbar: true }, queued_at: nowMs, attempts: 0 },
        { id: 'mnd1', endpoint: '/api/mnd/manual', method: 'POST', body: { calories: 500 }, queued_at: nowMs, attempts: 0 },
        { id: 'hyd_today', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 500, client_date: todayIso }, queued_at: nowMs, attempts: 0 },
        { id: 'hyd_old', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 750, client_date: '2020-01-01' }, queued_at: nowMs, attempts: 0 }
      ]));

      app.eval(`
        athleteInjuries = { lumbar: true, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false, notes: 'keep' };
        myNetDiaryData.totals = { calories: 999, protein: 99, carbs: 80, fat: 30, fiber: 15, sodium: 500, water: 1.5 };
      `);

      app.ctx.applyLiveStateToDom({
        date: todayIso,
        last_synced: new Date(nowMs).toISOString(),
        garmin: {
          source: 'garmin_oauth',
          oauth_last_synced: new Date(nowMs).toISOString(),
          body_battery: 50,
          training_readiness: 60,
          sleep_score: 70,
          steps: 1000,
          active_calories: 100
        },
        injuries: { lumbar: false, shoulders: true },
        mnd_logged: { date: todayIso, calories: 1500, protein_g: 150, carbs_g: 120, fat_g: 40, water_l: 1.0 },
        renpho: { weight_kg: 80.2, body_fat_pct: null, fat_to_lose_kg: null, last_synced: new Date(nowMs).toISOString() }
      });

      assert.strictEqual(app.eval('window.BAKED_LIVE_STATE.garmin.body_battery'), 88, 'Newer override must be preserved');
      assert.strictEqual(app.eval('window.BAKED_LIVE_STATE.garmin.training_readiness'), 60, 'Older override must expire on newer oauth_last_synced');
      assert.strictEqual(app.localStorage.getItem('pulse_readiness_override_obj'), null);
      assert.strictEqual(app.eval('window.BAKED_LIVE_STATE.garmin.sleep_score'), 70, 'Stale date override must expire');
      assert.strictEqual(app.localStorage.getItem('pulse_sleep_score_override_obj'), null);

      assert.strictEqual(app.eval('athleteInjuries.lumbar'), true, 'Queued /api/athlete/injuries must protect athleteInjuries');
      assert.strictEqual(app.eval('athleteInjuries.shoulders'), false);
      assert.strictEqual(app.eval('myNetDiaryData.totals.calories'), 999, 'Queued /api/mnd/manual must protect myNetDiaryData');

      // Null body_fat_pct clears DOM fields cleanly
      assert.strictEqual(app.document.getElementById('vitalScaleSub').innerText, '--');
      assert.strictEqual(app.document.getElementById('bodyScaleBf').innerText, 'Pending scan');
      assert.strictEqual(app.document.getElementById('bodyFatToBurnNum').innerText, '--');
      assert.strictEqual(app.document.getElementById('renphoGoalRunwayLabel').innerText, 'Pending scan');

      // Now remove /api/mnd/manual from queue; verify queued hydration delta adds ONLY today's 0.5L and stale ml.date is ignored
      app.localStorage.setItem('pulse_offline_write_queue', JSON.stringify([
        { id: 'hyd_today', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 500, client_date: todayIso }, queued_at: nowMs, attempts: 0 },
        { id: 'hyd_old', endpoint: '/api/hydration/add', method: 'POST', body: { amount_ml: 750, client_date: '2020-01-01' }, queued_at: nowMs, attempts: 0 }
      ]));
      app.ctx.applyLiveStateToDom({
        date: todayIso,
        mnd_logged: { date: '2020-01-01', calories: 2222, protein_g: 180, water_l: 3.0 }
      });
      assert.strictEqual(app.eval('myNetDiaryData.totals.calories'), 999, 'Stale ml.date must NOT overwrite myNetDiaryData');

      app.ctx.applyLiveStateToDom({
        date: todayIso,
        mnd_logged: { date: todayIso, calories: 1400, protein_g: 140, carbs_g: 100, fat_g: 45, fiber_g: 20, sodium_mg: 1200, water_l: 1.25 }
      });
      assert.strictEqual(app.eval('myNetDiaryData.totals.calories'), 1400);
      assert.strictEqual(app.eval('myNetDiaryData.totals.water'), 1.75, 'Must add today queued hydration delta (+0.5L) to 1.25L');

      console.log('PASS [5] applyLiveStateToDom() Overrides, Queue Protection, ml.date & Null BF%');
    }

    // [6] Array pulse_inapp_burn_today Deduplication & Garmin Strength Suppression
    {
      app.localStorage.clear();
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      app.eval(`
        window.BAKED_LIVE_STATE.date = '${todayIso}';
        window.BAKED_LIVE_STATE.garmin = { source: 'mnd_bridge', active_calories: 100, today_activities: [] };
        activeWorkoutPlan = [{ id: 'barbell_squat', name: 'Barbell Squat', targetWeight: 100, targetReps: 8, setsCount: 3, rest: '90s' }];
        sessionLoggedSets = { barbell_squat_1: { logged: true }, barbell_squat_2: { logged: true } };
        recentActivitiesData = [];
      `);

      // 1) finishSession() appends 'strength' entry
      app.ctx.finishSession();
      let burnArr = JSON.parse(app.localStorage.getItem('pulse_inapp_burn_today') || '[]');
      assert(Array.isArray(burnArr) && burnArr.length === 1, 'finishSession() must append to array pulse_inapp_burn_today');
      assert.strictEqual(burnArr[0].kind, 'strength');
      const strengthId = burnArr[0].id;
      const strengthCal = burnArr[0].calories;

      // 2) submitManualActivityModal() appends 'manual' entry
      app.document.getElementById('actTypeInput').value = 'Walking';
      app.document.getElementById('actDurationInput').value = '30';
      app.document.getElementById('actCaloriesInput').value = '160';
      app.document.getElementById('actStepsInput').value = '3000';
      app.document.getElementById('actAvgHrInput').value = '105';
      app.document.getElementById('actMaxHrInput').value = '122';
      app.document.getElementById('actNotesInput').value = 'Evening walk';
      await app.ctx.submitManualActivityModal();

      burnArr = JSON.parse(app.localStorage.getItem('pulse_inapp_burn_today') || '[]');
      assert.strictEqual(burnArr.length, 2);
      const manualEntry = burnArr.find((e) => e.kind === 'manual');
      assert(manualEntry && manualEntry.calories === 160);

      // 3) logTimerSession() appends 'conditioning' entry with _act / _sess IDs
      app.eval(`tMode = 'amrap'; tSeconds = 120; tRounds = 4;`);
      app.clearFetchCalls();
      app.ctx.logTimerSession();
      await flushMicrotasks();

      const timerActCall = app.getFetchCalls().find((c) => c.url.includes('/api/sync_activity'));
      const timerSessCall = app.getFetchCalls().find((c) => c.url.includes('/api/sync_session'));
      assert(timerActCall && timerSessCall, 'logTimerSession() must post to /api/sync_activity and /api/sync_session');
      const timerActBody = JSON.parse(timerActCall.options.body);
      const timerSessBody = JSON.parse(timerSessCall.options.body);
      assert(String(timerActBody.client_event_id).endsWith('_act'));
      assert(String(timerSessBody.client_event_id).endsWith('_sess'));

      burnArr = JSON.parse(app.localStorage.getItem('pulse_inapp_burn_today') || '[]');
      assert.strictEqual(burnArr.length, 3);
      const condEntry = burnArr.find((e) => e.kind === 'conditioning');
      assert(condEntry && condEntry.id === timerActBody.client_event_id);

      // All 3 count before Garmin sync matches
      assert.strictEqual(
        app.ctx.getTodayInAppBurn({ source: 'mnd_bridge', today_activities: [] }),
        strengthCal + 160 + condEntry.calories
      );

      // Deduplicate matching client_event_id / id
      assert.strictEqual(
        app.ctx.getTodayInAppBurn({
          source: 'mnd_bridge',
          today_activities: [{ id: 'g1', client_event_id: manualEntry.id, name: 'Walking' }, { id: condEntry.id, name: 'Conditioning' }]
        }),
        strengthCal,
        'Matching id / client_event_id must be deduplicated without double-counting'
      );

      // hasGarminStrength suppresses only 'strength' and 'legacy', preserving 'manual' and 'conditioning'
      app.ctx._appendInAppBurnEntry('legacy_1', 77, 'legacy', todayIso);
      assert.strictEqual(
        app.ctx.getTodayInAppBurn({
          source: 'garmin_oauth',
          today_activities: [{ id: 'g_str', name: 'Strength Training', activity_type_key: 'strength_training' }]
        }),
        160 + condEntry.calories,
        'hasGarminStrength must suppress strength + legacy while keeping manual + conditioning'
      );

      console.log('PASS [6] Array pulse_inapp_burn_today Deduplication & Garmin Suppression');
    }

    // [7] restoreActiveSessionFromLocalStorage() & readTodayExerciseSwaps()
    {
      app.localStorage.clear();
      app.eval(`
        window._userManualArchetype = false;
        athleteInjuries = { lumbar: true, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false };
      `);
      app.localStorage.setItem('pulse_active_session', JSON.stringify({
        date: todayIso,
        preset: 'gym',
        goal: 'recomp',
        currentExIdx: 0,
        plan: [
          { id: 'barbell_squat', name: 'Barbell Squat', targetWeight: 100, targetReps: 8, setsCount: 3, rest: '90s' },
          { id: 'barbell_bench_press', name: 'Barbell Bench Press', targetWeight: 65, targetReps: 8, setsCount: 3, rest: '90s' }
        ],
        sets: {} // 0 logged sets
      }));

      const restored = app.ctx.restoreActiveSessionFromLocalStorage();
      assert.strictEqual(restored, true, 'Must restore activeWorkoutPlan even with 0 logged sets');
      assert.strictEqual(app.eval('window._userManualArchetype'), true, 'Must set window._userManualArchetype = true');
      const restoredPlan = app.eval('activeWorkoutPlan');
      assert.strictEqual(restoredPlan.length, 2);
      assert.notStrictEqual(restoredPlan[0].id, 'barbell_squat', 'Restored session must re-apply athleteInjuries via applyJointSafeSwaps()');

      // readTodayExerciseSwaps drops stale-date and undated swaps
      app.localStorage.setItem('pulse_today_exercise_swaps', JSON.stringify({ swaps: { option_a_0: 'db_press' } }));
      assert.deepStrictEqual(plain(app.ctx.readTodayExerciseSwaps()), {});
      assert.strictEqual(app.localStorage.getItem('pulse_today_exercise_swaps'), null, 'Undated swaps must be removed');

      app.localStorage.setItem('pulse_today_exercise_swaps', JSON.stringify({ date: '2020-01-01', swaps: { option_a_0: 'db_press' } }));
      assert.deepStrictEqual(plain(app.ctx.readTodayExerciseSwaps()), {});
      assert.strictEqual(app.localStorage.getItem('pulse_today_exercise_swaps'), null, 'Stale-date swaps must be removed');

      app.ctx.writeTodayExerciseSwaps({ option_a_0: 'db_press' });
      assert.deepStrictEqual(plain(app.ctx.readTodayExerciseSwaps()), { option_a_0: 'db_press' });

      console.log('PASS [7] restoreActiveSessionFromLocalStorage() & readTodayExerciseSwaps()');
    }

    // [8] [object Object] Resolution & escapeHtml() in getEgmWorkoutBreakdown & Assessment Card
    {
      app.localStorage.clear();
      app.eval(`
        window.BAKED_LIVE_STATE.strength_prescriptions = {};
        athleteInjuries = { lumbar: false, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false };
      `);
      const egm = app.ctx.getEgmWorkoutBreakdown({
        id: 'act_xss',
        name: 'Body Combat',
        subTitle: '<img src=x onerror=alert(1)>',
        calories: 320,
        avgHr: 140,
        maxHr: 170
      }, true);
      const joined = [egm.recoveryPill, egm.primaryTakeaway, ...egm.achievements, ...egm.stressors, ...egm.recoveryProtocol].join(' ');
      assert.strictEqual(joined.includes('[object Object]'), false, 'getEgmWorkoutBreakdown must never emit [object Object]');
      assert.strictEqual(joined.includes('<img src=x'), false, 'act.subTitle must be HTML-escaped');
      assert(joined.includes('&lt;img src=x onerror=alert(1)&gt;'));
      assert(joined.includes('Bench') && joined.includes('Row') && joined.includes('kg'));

      app.ctx.renderAssessmentResultCard({
        statusTitle: 'Check <script>x</script>',
        swapPrescription: '<svg onload=alert(1)>Swap</svg>',
        rootCauseText: '<b onclick=x>Cause</b>',
        banned: ['<img src=x>'],
        safe: ['Safe'],
        decompression: 'Hang'
      });
      const cardHtml = app.document.getElementById('injuryAssessmentResult').innerHTML;
      assert.strictEqual(cardHtml.includes('<svg onload'), false);
      assert.strictEqual(cardHtml.includes('<b onclick'), false);
      assert(cardHtml.includes('&lt;svg onload=alert(1)&gt;Swap&lt;/svg&gt;'));
      assert(cardHtml.includes('&lt;b onclick=x&gt;Cause&lt;/b&gt;'));

      console.log('PASS [8] [object Object] Resolution & escapeHtml() in Telemetry Cards');
    }

    // [9] renderWeeklyPatternBalance() Classifies barbell_rdl_1 -> Hinge
    {
      app.localStorage.clear();
      app.eval('recentActivitiesData = [];');
      app.localStorage.setItem('pulse_session_history', JSON.stringify([
        {
          date: new Date().toISOString(),
          details: {
            barbell_rdl_1: { logged: true, weight: 70, reps: 8 },
            barbell_rdl_2: { logged: true, weight: 70, reps: 8 }
          }
        }
      ]));
      app.ctx.renderWeeklyPatternBalance();
      const html = app.document.getElementById('weeklyPatternBalance').innerHTML;
      assert(html.includes('Hinge') && html.includes('2/8'), `Expected Hinge 2/8 in pattern balance, got: ${html}`);
      assert(html.includes('Conditioning') && html.includes('0/6'), 'barbell_rdl_1 must NOT fall into Conditioning');

      console.log('PASS [9] renderWeeklyPatternBalance() Classifies barbell_rdl_1 -> Hinge');
    }

    // [10] null Readiness Never Triggers Deloads
    {
      app.localStorage.clear();
      app.eval(`
        window.BAKED_LIVE_STATE.garmin = { training_readiness: null, sleep_score: null };
        window.athleteProfile = { readiness: null, sleepScore: null, weightKg: 80, bodyFatPct: 18, leanMassKg: 65.6 };
        athleteInjuries = { lumbar: false, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false };
        gearConfig.barbell.active = true;
        currentSessionFocus = 'strength';
      `);
      app.ctx.applyCustomEquipmentAndGenerate();
      const plan = app.eval('activeWorkoutPlan');
      assert(plan.length > 0);
      assert(
        plan.every((ex) => !String(ex.rationale || '').includes('Autoregulated:')),
        'null readiness/sleep must NEVER trigger -1 set deload in applyCustomEquipmentAndGenerate()'
      );

      app.eval("window.tomorrowSleepScenario = 'good';");
      const rec = app.ctx.generateTomorrowRecommendation(null);
      assert.strictEqual(rec.presetKey, 'option_a', 'null readiness with good scenario must NOT deload to option_c');

      console.log('PASS [10] null Readiness Never Triggers Deloads');
    }

    // [11] applyJointSafeSwaps() & isExerciseContraindicated() All 6 Domains, kb_flow_*, dumbbells, Slicing & Fallback
    {
      // All 6 domains
      const domainProbes = {
        lumbar: 'barbell_squat',
        shoulders: 'barbell_bench_press',
        knees: 'goblet_squat',
        elbows: 'barbell_floor_press',
        wrists: 'narrow_pushups',
        ankles: 'speed_rope_intervals'
      };
      for (const [domain, exId] of Object.entries(domainProbes)) {
        const inj = { lumbar: false, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false, [domain]: true };
        assert.strictEqual(app.ctx.isExerciseContraindicated(exId, inj), true, `${exId} must be contraindicated for ${domain}`);
        assert.strictEqual(app.ctx.isExerciseContraindicated('kb_flow_2h_out_about', inj), true, `kb_flow_2h_* must be contraindicated for ${domain}`);
        assert.strictEqual(app.ctx.isExerciseContraindicated('kb_flow_1h_armor_chain', inj), true, `kb_flow_1h_* must be contraindicated for ${domain}`);
        const swapped = app.ctx.applyJointSafeSwaps([exId, 'deadbug_hold'], 5, inj, app.eval('gearConfig'));
        assert(!swapped.includes(exId), `Swapped list must exclude ${exId} for ${domain}`);
      }

      // Normalize requiredGear: ['dumbbells'] -> gearConfig.db
      const dbOnlyGear = {
        barbell: { active: false }, bench: { active: false }, dipbar: { active: false },
        db: { active: false, weight: '2×20kg' }, kb: { active: false },
        slamball: { active: false }, sandbag: { active: false }, ropes: { active: false }, speedrope: { active: false }
      };
      assert.strictEqual(app.ctx._hasRequiredGearForExercise({ id: 'test_db', requiredGear: ['dumbbells'] }, dbOnlyGear), false);
      dbOnlyGear.db.active = true;
      assert.strictEqual(app.ctx._hasRequiredGearForExercise({ id: 'test_db', requiredGear: ['dumbbells'] }, dbOnlyGear), true);

      // Swap BEFORE slicing 20m (3) and 45m (5) plans
      app.localStorage.setItem('pulse_today_time', '20m');
      app.eval('athleteInjuries = { lumbar: true, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false };');
      app.ctx.loadDailyArchetype('option_a');
      const plan20 = app.eval('activeWorkoutPlan');
      assert.strictEqual(plan20.length, 3, '20m plan must slice to 3 exercises after swapping');
      assert(plan20.every((ex) => !app.ctx.isExerciseContraindicated(ex, app.eval('athleteInjuries'))), '20m plan must contain zero contraindicated exercises');

      app.localStorage.setItem('pulse_today_time', '45m');
      app.ctx.loadDailyArchetype('option_a');
      const plan45 = app.eval('activeWorkoutPlan');
      assert.strictEqual(plan45.length, 5, '45m plan must slice to 5 exercises after swapping');
      assert(plan45.every((ex) => !app.ctx.isExerciseContraindicated(ex, app.eval('athleteInjuries'))), '45m plan must contain zero contraindicated exercises');

      // Fallback to mobility exercises when all 6 domains are injured
      const allInj = { lumbar: true, shoulders: true, knees: true, elbows: true, wrists: true, ankles: true };
      const fallbackRes = app.ctx.applyJointSafeSwaps(['barbell_squat', 'weighted_dips', 'speed_rope_intervals'], 5, allInj, dbOnlyGear);
      assert(fallbackRes.length > 0, 'Must fall back to mobility exercises when heavily constrained');
      assert(
        fallbackRes.some((id) => ['deadbug_hold', 'glute_bridge_hold', 'zone2_flush', 'thoracic_openers'].includes(id)),
        `Expected mobility fallback, got ${JSON.stringify(fallbackRes)}`
      );

      // Reset injuries & time mode
      app.eval('athleteInjuries = { lumbar: false, shoulders: false, knees: false, elbows: false, wrists: false, ankles: false };');
      console.log('PASS [11] applyJointSafeSwaps() & isExerciseContraindicated()');
    }

    // [12] inlineTimerState Lifecycle, Persistence & Arithmetic Catchup
    {
      app.localStorage.clear();
      app.eval(`
        activeWorkoutPlan = [
          { id: 'emom_hybrid_10', name: '10m EMOM', format: 'emom', rounds: 10, setsCount: 10, rest: '0s' },
          { id: 'barbell_squat', name: 'Barbell Squat', targetWeight: 100, targetReps: 8, setsCount: 3, rest: '90s' }
        ];
        currentExIdx = 0;
      `);
      app.ctx.renderCurrentExercise();
      app.ctx.toggleInlineTimer();
      assert.strictEqual(app.eval('inlineTimerState.running'), true);

      // Persist on same-ex.id re-render
      app.eval('inlineTimerState.elapsedSec = 25; inlineTimerState.secsLeft = 35;');
      app.ctx.renderCurrentExercise();
      assert.strictEqual(app.eval('inlineTimerState.running'), true, 'Same-ex.id re-render must preserve running inlineTimerState');
      assert.strictEqual(app.eval('inlineTimerState.elapsedSec'), 25);

      // Arithmetic catchup for EMOM (step 120s => +2 minutes => currentRound=3, secsLeft=35)
      app.eval('_stepInlineTimerSeconds(120, true)');
      assert.strictEqual(app.eval('inlineTimerState.currentRound'), 3);
      assert.strictEqual(app.eval('inlineTimerState.secsLeft'), 35);

      // Arithmetic catchup for AMRAP (O(1) math)
      app.eval(`
        stopInlineTimer();
        inlineTimerState = { exId: 'amrap_hybrid_10', format: 'amrap', phase: 'amrap', durationSec: 600, secsLeft: 600, elapsedSec: 0, amrapRounds: 0, running: true, intervalId: null };
        _stepInlineTimerSeconds(450, true);
      `);
      assert.strictEqual(app.eval('inlineTimerState.elapsedSec'), 450);
      assert.strictEqual(app.eval('inlineTimerState.secsLeft'), 150);

      // Stops when switching exercises
      app.eval('currentExIdx = 1;');
      app.ctx.renderCurrentExercise();
      assert.strictEqual(app.eval('inlineTimerState.running'), false, 'Switching exercise must stop inlineTimerState');

      // Stops on finishSession(), loadDailyArchetype(), resetActiveSession()
      app.eval('currentExIdx = 0;');
      app.ctx.renderCurrentExercise();
      app.ctx.toggleInlineTimer();
      assert.strictEqual(app.eval('inlineTimerState.running'), true);
      app.ctx.resetActiveSession();
      assert.strictEqual(app.eval('inlineTimerState.running'), false, 'resetActiveSession() must stop inlineTimerState');

      app.ctx.toggleInlineTimer();
      assert.strictEqual(app.eval('inlineTimerState.running'), true);
      app.ctx.loadDailyArchetype('option_a');
      assert.strictEqual(app.eval('inlineTimerState.running'), false, 'loadDailyArchetype() must stop inlineTimerState');

      app.eval(`
        activeWorkoutPlan = [{ id: 'emom_hybrid_10', name: '10m EMOM', format: 'emom', rounds: 10, setsCount: 10, rest: '0s' }];
        currentExIdx = 0;
      `);
      app.ctx.renderCurrentExercise();
      app.ctx.toggleInlineTimer();
      assert.strictEqual(app.eval('inlineTimerState.running'), true);
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      app.ctx.finishSession();
      assert.strictEqual(app.eval('inlineTimerState.running'), false, 'finishSession() must stop inlineTimerState');

      console.log('PASS [12] inlineTimerState Lifecycle, Persistence & Arithmetic Catchup');
    }

    // [13] logSet() Coercion, Bodyweight Copy, Warmups, PR Guards, Deload, saveEditLoadModal & db_press
    {
      app.localStorage.clear();
      // db_press getBaseReps strips "2×" in workout-catalog.js (so 2×22.5kg -> w=22 -> 8 reps, 2×16kg -> 12, 2×10kg -> 18)
      const dbPressEx = app.eval("masterExercises.find(e => e.id === 'db_press')");
      app.eval("gearConfig.db.weight = '2×22.5kg';");
      assert.strictEqual(dbPressEx.getBaseReps(), 8, 'db_press must strip 2× prefix before parseInt');
      app.eval("gearConfig.db.weight = '2×16kg';");
      assert.strictEqual(dbPressEx.getBaseReps(), 12);
      app.eval("gearConfig.db.weight = '2×10kg';");
      assert.strictEqual(dbPressEx.getBaseReps(), 18);
      app.eval("gearConfig.db.weight = '2×22.5kg';");

      app.eval(`
        window.PULSE_ANALYTICS_SUMMARY = { strength_prs: { db_press: { e1rm: 30 } } };
        window.BAKED_LIVE_STATE.strength_prescriptions = { db_press: { weight: 22.5, reps: 8, e1rm: 30 } };
        activeWorkoutPlan = [{ id: 'db_press', name: 'DB Press', targetWeight: '2x22.5kg', targetReps: 8, setsCount: 3, rest: '75s', requiredGear: ['db'] }];
        currentExIdx = 0;
        sessionLoggedSets = {};
      `);
      const wEl = app.document.getElementById('wIn_0_1');
      const rEl = app.document.getElementById('rIn_0_1');
      const rowMock = app.document.createElement('div');
      rowMock.className = 'set-log-row';
      const btnMock = app.document.createElement('button');
      rowMock.appendChild(btnMock);

      // Coerces "2x22.5kg" on BOTH targetW and loggedW
      wEl.value = '2x22.5kg';
      rEl.value = '8';
      app.clearFetchCalls();
      app.setFetchHandler(async () => makeMockResponse({ success: true, result: { is_pr: false, e1rm: 28.5 } }, { status: 200 }));
      app.ctx.logSet(btnMock, 1, 'db_press', '2x22.5kg', 8);
      await flushMicrotasks();
      assert.strictEqual(app.eval("sessionLoggedSets['db_press_1'].weight"), 22.5);
      assert.strictEqual(app.eval("sessionLoggedSets['db_press_1'].target_w"), 22.5);

      // Warmup gating (< 0.75 * targetW) BEFORE _renderPrBadgeSlot & ignores 'warmup' async result
      app.eval(`
        activeWorkoutPlan = [{ id: 'barbell_squat', name: 'Barbell Squat', targetWeight: 100, targetReps: 8, setsCount: 3, rest: '120s', requiredGear: ['barbell'] }];
        currentExIdx = 0;
        sessionLoggedSets = {};
        localStorage.removeItem('pulse_strength_prescriptions');
      `);
      app.document.getElementById('prBadgeSlot').innerHTML = '';
      wEl.value = '60'; // 60 < 75
      rEl.value = '10';
      app.setFetchHandler(async () => makeMockResponse({ success: true, result: { status: 'warmup', is_pr: true, e1rm: 999 } }, { status: 200 }));
      app.ctx.logSet(btnMock, 1, 'barbell_squat', 100, 8);
      assert.strictEqual(app.document.getElementById('prBadgeSlot').innerHTML, '', 'Warmup must NOT render PR badge');
      assert.strictEqual(app.eval("sessionLoggedSets['barbell_squat_1'].is_warmup"), true);
      await flushMicrotasks();
      assert.strictEqual(app.document.getElementById('prBadgeSlot').innerHTML, '', 'Warmup async result must be ignored');
      assert.strictEqual(app.localStorage.getItem('pulse_strength_prescriptions'), null, 'Warmup must NOT mutate prescriptions');

      // Bodyweight +1 rep copy
      app.eval(`
        activeWorkoutPlan = [{ id: 'pushups_renegade', name: 'Push-Ups', targetWeight: 'Body', targetReps: 15, setsCount: 3, rest: '60s', requiredGear: ['bodyweight'] }];
        currentExIdx = 0;
        sessionLoggedSets = {};
      `);
      wEl.value = 'Body';
      rEl.value = '15';
      app.ctx.logSet(btnMock, 1, 'pushups_renegade', 0, 15);
      assert(app.document.getElementById('autoregMessage').innerText.includes('+1 rep (16 reps)'));

      // Optimistic PR guard: priorBest === 0 must NOT render optimistic PR; stale _pulsePrReqSeq ignored
      app.eval(`
        window.PULSE_ANALYTICS_SUMMARY = { strength_prs: {} };
        window.BAKED_LIVE_STATE.strength_prescriptions = {};
        activeWorkoutPlan = [{ id: 'barbell_rdl', name: 'Barbell RDL', targetWeight: 100, targetReps: 8, setsCount: 3, rest: '90s', requiredGear: ['barbell'] }];
        currentExIdx = 0;
        sessionLoggedSets = {};
        localStorage.removeItem('pulse_strength_prescriptions');
      `);
      app.document.getElementById('prBadgeSlot').innerHTML = '';
      let resolveFirstPr;
      let syncSetCount = 0;
      app.setFetchHandler(async (url) => {
        if (url.includes('/api/sync_set')) {
          syncSetCount++;
          if (syncSetCount === 1) {
            return new Promise((res) => { resolveFirstPr = res; });
          }
          return makeMockResponse({ success: true, result: { is_pr: false, e1rm: 110 } }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });
      wEl.value = '100';
      rEl.value = '10';
      app.ctx.logSet(btnMock, 1, 'barbell_rdl', 100, 8);
      assert.strictEqual(app.document.getElementById('prBadgeSlot').innerHTML, '', 'priorBest === 0 must NOT show optimistic PR');
      // Fire second request incrementing _pulsePrReqSeq before first resolves
      app.ctx.logSet(btnMock, 1, 'barbell_rdl', 100, 8);
      await flushMicrotasks();
      resolveFirstPr(makeMockResponse({ success: true, result: { is_pr: true, e1rm: 999 } }, { status: 200 }));
      await flushMicrotasks();
      assert.strictEqual(app.document.getElementById('prBadgeSlot').innerHTML, '', 'Stale _pulsePrReqSeq response must be ignored');

      // deloadW math (10kg -> 7.5kg via 2.5kg rounding, 100kg -> 85kg)
      app.eval(`
        activeWorkoutPlan = [{ id: 'barbell_z_press', name: 'Barbell Z-Press', targetWeight: 10, targetReps: 10, setsCount: 3, rest: '60s', requiredGear: ['barbell'] }];
        currentExIdx = 0;
        sessionLoggedSets = {};
      `);
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      wEl.value = '10';
      rEl.value = '3'; // severe underperformance
      app.ctx.logSet(btnMock, 1, 'barbell_z_press', 10, 10);
      assert(app.document.getElementById('autoregTag').innerText.includes('7.5kg'), '10kg deload rounds cleanly to 7.5kg');

      // saveEditLoadModal() stamps last_updated & getPrescribedLoad() honors last_updated
      app.eval(`
        editLoadContext = { exId: 'barbell_squat', optId: null, exIdx: 0 };
        window.BAKED_LIVE_STATE.strength_prescriptions = {
          barbell_squat: { weight: 105, reps: 6, last_updated: '2020-01-01T00:00:00.000Z' }
        };
      `);
      app.document.getElementById('editLoadWeight').value = '112.5';
      app.document.getElementById('editLoadReps').value = '5';
      app.ctx.saveEditLoadModal();
      const savedRxMap = JSON.parse(app.localStorage.getItem('pulse_strength_prescriptions'));
      assert(savedRxMap.barbell_squat.last_updated, 'saveEditLoadModal() must stamp last_updated');
      // Make baked newer than local and verify getPrescribedLoad picks newer
      app.eval(`
        window.BAKED_LIVE_STATE.strength_prescriptions.barbell_squat = {
          weight: 120, reps: 4, last_updated: '2099-01-01T00:00:00.000Z'
        };
      `);
      const newerRx = app.ctx.getPrescribedLoad('barbell_squat');
      assert.strictEqual(newerRx.weight, 120, 'getPrescribedLoad() must prefer strictly newer last_updated');
      // Make local newer than baked
      app.eval(`
        window.BAKED_LIVE_STATE.strength_prescriptions.barbell_squat.last_updated = '2020-01-01T00:00:00.000Z';
      `);
      const localNewerRx = app.ctx.getPrescribedLoad('barbell_squat');
      assert.strictEqual(localNewerRx.weight, 112.5);

      console.log('PASS [13] logSet(), saveEditLoadModal(), getPrescribedLoad() & db_press');
    }

    // [14] Plate Calculator (<20kg, Remainders, Sets 1-4, Trailing kg)
    {
      const below = app.ctx.computeBarbellPlatesPerSide(15, 20);
      assert.strictEqual(below.valid, false);
      assert.strictEqual(below.belowBar, true);
      assert.strictEqual(below.label, 'Below 20kg bar');

      const rem = app.ctx.computeBarbellPlatesPerSide(23, 20);
      assert.strictEqual(rem.valid, true);
      assert.strictEqual(rem.remainder, 0.25);
      assert(rem.label.includes('(+0.25kg/side rem)'), `Expected remainder suffix, got: ${rem.label}`);

      const plateRow = app.document.getElementById('exPlateCalcRow');
      app.ctx._updatePlateCalcForExercise({ name: 'Barbell Squat', requiredGear: ['barbell'], targetWeight: 15 });
      assert.strictEqual(plateRow.style.display, 'block');
      assert.strictEqual(plateRow.innerText, 'Plates: Below 20kg bar');

      // Render 4 sets and verify sets 1-4 have oninput plate calc + stepSetInput preserves trailing kg
      app.eval(`
        activeWorkoutPlan = [{ id: 'barbell_squat', name: 'Barbell Squat', targetWeight: 60, targetReps: 8, setsCount: 4, rest: '90s', requiredGear: ['barbell'] }];
        currentExIdx = 0;
        sessionLoggedSets = {};
      `);
      app.ctx.renderCurrentExercise();
      const setRowsEl = app.document.getElementById('setRows');
      assert.strictEqual(setRowsEl.children.length, 4, 'Expected 4 set rows rendered');
      const setRowsHtml = setRowsEl.children.map((c) => c.innerHTML).join('\n');
      for (let s = 1; s <= 4; s++) {
        assert(setRowsHtml.includes(`id="wIn_0_${s}"`), `Missing wIn_0_${s}`);
        assert(setRowsHtml.includes(`oninput="_updatePlateCalcForExercise(activeWorkoutPlan[0], this.value)"`), 'Missing oninput plate calc hook');
      }

      const w4 = app.document.getElementById('wIn_0_4');
      w4.value = '60kg';
      app.ctx.stepSetInput(0, 4, 'weight', 2.5);
      assert.strictEqual(w4.value, '62.5kg', 'stepSetInput must preserve trailing kg');
      assert(plateRow.innerText.includes('20 + 1.25'), 'stepSetInput on set 4 must update plate calculator');

      console.log('PASS [14] Plate Calculator (<20kg, Remainders, Sets 1-4, Trailing kg)');
    }

    // [15] finishSession() Rest Guard, Main Timer Classes, Stopwatch O(1) & logTimerSession()
    {
      // finishSession skips rest ONLY if restTimerInterval active
      app.eval('restTimerInterval = null;');
      const toastEl = app.document.getElementById('appToast');
      toastEl.innerHTML = '';
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      app.ctx.finishSession();
      const toastTxt15 = toastEl.children.map((c) => c.textContent).join(' ');
      assert.strictEqual(toastTxt15.includes('Rest skipped'), false);

      // Main timer toggle classes + AMRAP completion reset + O(1) stopwatch
      const btnToggle = app.document.getElementById('btnTimerToggle');
      app.ctx.setTimerMode('amrap');
      assert.strictEqual(btnToggle.classList.contains('timer-paused'), true);
      assert.strictEqual(btnToggle.classList.contains('timer-running'), false);

      app.ctx.toggleTimer();
      assert.strictEqual(btnToggle.classList.contains('timer-running'), true);
      assert.strictEqual(btnToggle.classList.contains('timer-paused'), false);
      assert.strictEqual(app.document.getElementById('timerPlayIcon').innerText, '⏸');
      assert.strictEqual(app.document.getElementById('timerPlayText').innerText, 'PAUSE');

      // AMRAP completion resets play icon/text & classes
      app.eval('tSeconds = 1; stepMainTimerSeconds(1, false);');
      assert.strictEqual(app.eval('tRunning'), false);
      assert.strictEqual(btnToggle.classList.contains('timer-paused'), true);
      assert.strictEqual(btnToggle.classList.contains('timer-running'), false);
      assert.strictEqual(app.document.getElementById('timerPlayIcon').innerText, '▶');
      assert.strictEqual(app.document.getElementById('timerPlayText').innerText, 'START');

      // Stopwatch O(1)
      app.ctx.setTimerMode('stopwatch');
      app.ctx.toggleTimer();
      app.eval('stepMainTimerSeconds(3600, true);');
      assert.strictEqual(app.eval('tSeconds'), 3600);
      assert.strictEqual(app.document.getElementById('bigTimerDigits').innerText, '60:00');
      app.ctx.resetTimer();

      // logTimerSession calls renderMyNetDiaryEngine, NOT obsolete calculateDailyTargets
      assert.strictEqual(typeof app.ctx.calculateDailyTargets, 'undefined');
      const timersCode = fs.readFileSync(path.join(ROOT_DIR, 'js/workout-timers.js'), 'utf8');
      assert.strictEqual(timersCode.includes('calculateDailyTargets'), false);
      let mndRenderCalls = 0;
      app.eval('const __origRenderMnd = renderMyNetDiaryEngine; renderMyNetDiaryEngine = () => { __mndCalls++; };');
      app.ctx.__mndCalls = 0;
      app.eval('renderMyNetDiaryEngine = () => { window.__mndCalls++; };');
      app.ctx.logTimerSession();
      assert(app.ctx.__mndCalls >= 1, 'logTimerSession() must call renderMyNetDiaryEngine()');
      app.eval('renderMyNetDiaryEngine = __origRenderMnd;');

      console.log('PASS [15] finishSession() Rest Guard, Main Timer Classes, Stopwatch O(1) & logTimerSession()');
    }

    // [16] css/styles.css Tokens, Contrast & Responsive Rules
    {
      const rootMatch = stylesCss.match(/:root\s*\{([\s\S]*?)\}/);
      assert(rootMatch, ':root block missing');
      const rootBlock = rootMatch[1];
      const parseVar = (name) => {
        const m = rootBlock.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
        assert(m, `Missing CSS variable ${name}`);
        return m[1].trim();
      };
      const crimsonText = parseVar('--crimson-text');
      const violetText = parseVar('--violet-text');
      const hexToRgb = (hex) => {
        const c = hex.replace('#', '').trim();
        return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
      };
      const lum = (hex) => {
        const [r, g, b] = hexToRgb(hex).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const cr = (h1, h2) => (Math.max(lum(h1), lum(h2)) + 0.05) / (Math.min(lum(h1), lum(h2)) + 0.05);
      assert(cr(crimsonText, '#131822') >= 4.5, '--crimson-text must pass WCAG AA on #131822');
      assert(cr(violetText, '#131822') >= 4.5, '--violet-text must pass WCAG AA on #131822');

      const requiredCssPatterns = [
        /#btnTimerToggle\.timer-running\s*\{/,
        /#btnTimerToggle\.timer-paused\s*\{/,
        /\.toast\s*\{[\s\S]*?z-index:\s*100000;/,
        /\.toast\.show\s+button\.toast-action-btn\s*\{[\s\S]*?pointer-events:\s*auto;/,
        /\.floating-rest-pill\s+\.rest-pill-btn\s*\{[\s\S]*?min-height:\s*36px;/,
        /@media\s*\(max-width:\s*400px\)[\s\S]*?\.floating-rest-pill\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
        /body\.workout-focus-mode\s+\.app-main\s*\{/,
        /@media\s*\(min-width:\s*900px\)[\s\S]*?\.bottom-nav\s*\{/,
        /\.modal-card\s*\{[\s\S]*?max-width:\s*440px;/,
        /\.injury-rule-card\s*\{/,
        /\.macro-remaining-pill\s+\.macro-rem-item\.fats\s*\{[\s\S]*?var\(--crimson-text\)/,
        /\.renpho-pillar-grid\s*\{/,
        /\.archetype-switcher-grid\s*\{/,
        /\.gear-preset-btns\s*\{/,
        /\.fuel-action-bar\s*\{/,
        /\.train-header-row\s*\{/,
        /\.history-scroll-box\s*\{/
      ];
      for (const rx of requiredCssPatterns) {
        assert(rx.test(stylesCss), `css/styles.css missing expected rule matching ${rx}`);
      }

      console.log('PASS [16] css/styles.css Tokens, Contrast & Responsive Rules');
    }

    // [17] index.html Attributes, Classes, Versions & 0 PII Placeholders
    {
      const expectedDetailsKeys = [
        'train_strength_progression',
        'fuel_budget_math',
        'fuel_hydration',
        'fuel_diet_strategy',
        'body_coach_briefing',
        'body_renpho_trend',
        'body_population_norms'
      ];
      for (const k of expectedDetailsKeys) {
        assert(indexHtml.includes(`data-details-key="${k}"`), `index.html missing data-details-key="${k}"`);
      }
      assert(indexHtml.includes('class="floating-rest-pill" id="floatingRestPill"'));
      assert(indexHtml.includes('class="rest-pill-label"'));
      assert(indexHtml.includes('class="rest-pill-indicator"'));
      assert(indexHtml.includes('class="rest-pill-time"'));
      assert(indexHtml.includes('class="rest-pill-actions"'));
      assert(indexHtml.includes('class="rest-pill-btn"'));
      assert(indexHtml.includes('id="fuelBaseActiveSub"'));
      assert(/id="btnTimerToggle"[^>]*class="[^"]*timer-paused/.test(indexHtml) || /class="[^"]*timer-paused[^"]*"[^>]*id="btnTimerToggle"/.test(indexHtml));
      assert(/id="telemetryOverrideErr"[^>]*var\(--crimson-text\)/.test(indexHtml));
      assert(/id="pulseAuthError"[^>]*var\(--crimson-text\)/.test(indexHtml));

      for (const s of SCRIPT_ORDER) {
        assert(indexHtml.includes(`./${s}?v=6.12`), `index.html missing ./${s}?v=6.12`);
      }
      assert(indexHtml.includes('./css/styles.css?v=6.12'));
      assert(indexHtml.includes('HYBRID ATHLETE OS • v6.12'), 'index.html boot splash must display v6.12');
      assert(indexHtml.includes('Hybrid Athlete OS • v6.12'), 'index.html Settings modal must display v6.12');
      assert.strictEqual(/Hybrid Athlete OS • v6\.1\b/.test(indexHtml), false, 'index.html must not contain stale v6.1 label');

      const piiRegex = /190\.5|6'3"|45yo|97\.70|97\.75|80\.99|81\.03|81\.0|98\.4|99\.85|@[^\s"']+\.com|GARMIN_TOKENS(?!_JSON)|renpho_creds(?!\.json)/;
      assert.strictEqual(piiRegex.test(indexHtml), false, 'index.html must contain 0 PII placeholders');

      console.log('PASS [17] index.html Attributes, Classes, Versions & 0 PII');
    }

    // [18] switchTrainView('history') Focus Mode Exit & Scoped .active
    {
      app.document.body.classList.add('workout-focus-mode');
      app.unrelatedSubviewBtn.classList.add('active');
      app.ctx.switchTrainView('history');
      assert.strictEqual(app.document.body.classList.contains('workout-focus-mode'), false, 'switchTrainView("history") must exit Focus Mode');
      assert.strictEqual(app.document.getElementById('btnTrainHistory').classList.contains('active'), true);
      assert.strictEqual(app.document.getElementById('btnTrainPrescribed').classList.contains('active'), false);
      assert.strictEqual(app.unrelatedSubviewBtn.classList.contains('active'), true, 'Unrelated .btn-subview outside .train-subview-nav must keep .active');

      console.log('PASS [18] switchTrainView("history") Focus Mode Exit & Scoped .active');
    }

    // [19] <details data-details-key> Survival & renderSyncFreshnessStrip
    {
      app.detailsMap.get('fuel_budget_math').open = true;
      app.detailsMap.get('body_coach_briefing').open = false;

      app.ctx.applyLiveStateToDom({
        date: todayIso,
        last_synced: new Date().toISOString(),
        garmin: { steps: 2000, active_calories: 120 },
        mnd_logged: { date: todayIso, calories: 1200, protein_g: 120, carbs_g: 100, fat_g: 40, water_l: 1.5 }
      });
      assert.strictEqual(app.detailsMap.get('fuel_budget_math').open, true, 'applyLiveStateToDom must preserve open <details>');
      assert.strictEqual(app.detailsMap.get('body_coach_briefing').open, false);

      // renderInlineConditioningPlayer preserves open <details>
      app.eval(`
        activeWorkoutPlan = [{ id: 'kb_flow_2h_out_about', name: 'Out & About', format: 'kb_flow', durationSec: 1800, flowSteps: ['5 Swing', '5 Clean'] }];
        currentExIdx = 0;
      `);
      app.ctx.renderInlineConditioningPlayer(app.eval('activeWorkoutPlan[0]'), app.ctx.getExerciseFormatConfig(app.eval('activeWorkoutPlan[0]')));
      assert.strictEqual(app.detailsMap.get('fuel_budget_math').open, true);

      // renderSyncFreshnessStrip summary precedence
      const strip = app.document.getElementById('syncFreshnessStrip');
      app.ctx.renderSyncFreshnessStrip({
        sync_freshness: {
          garmin: { age_minutes: 12, stale: false },
          renpho: { last_checked: '2026-11-20T10:00:00Z', age_minutes: 4, stale: false, weigh_in_age_hours: 24 },
          mnd: { age_minutes: 600, stale: true }
        }
      }, { garmin: {}, renpho: {}, mnd_logged: {} });
      assert(strip.innerHTML.includes('12m ago'));
      assert(strip.innerHTML.includes('4m ago'));
      assert(strip.innerHTML.includes('1d ago'));
      assert(strip.innerHTML.includes('sync-chip stale'));

      console.log('PASS [19] <details data-details-key> Survival & renderSyncFreshnessStrip');
    }

    // [20] charts.js: Z1 Color, Snake/Camel HR, escapeHtml, Renpho Normalization, Strength Baseline & SVG Margins
    {
      // Z1 color #8b9db5 (both real hr_zones and synthetic)
      const zReal = app.ctx.getGarminHrZoneBreakdown({ hr_zones: { z1: 60, z2: 120, z3: 60, z4: 0, z5: 0 } });
      assert.strictEqual(zReal.zones.find((z) => z.num === 1).color, '#8b9db5');
      const zSynth = app.ctx.getGarminHrZoneBreakdown({ duration_min: 30, avg_hr: 110, max_hr: 135, name: 'Walk' });
      assert.strictEqual(zSynth.zones.find((z) => z.num === 1).color, '#8b9db5');

      // Snake_case & camelCase HR fields in renderHistoryList + escapeHtml + #btnTrainHistory count
      app.eval(`
        recentActivitiesData = [
          { id: 'snake1', name: '<b>Run</b>', sub_title: '<script>xss</script>', duration_min: 35, calories: 310, avg_hr: 142, max_hr: 168, aerobic_te: 3.1, anaerobic_te: 1.2 },
          { id: 'camel1', name: 'Strength', subTitle: 'Upper', durationMin: 45, calories: 280, avgHr: 118, maxHr: 148, aerobicTe: 2.2, anaerobicTe: 0.9 }
        ];
      `);
      app.ctx.renderHistoryList();
      const histBox = app.document.getElementById('trainViewHistory');
      const histHtml = histBox.children.map((c) => c.innerHTML).join('\n');
      assert.strictEqual(app.document.getElementById('btnTrainHistory').innerText, 'History (2)');
      assert.strictEqual(histHtml.includes('<script>xss</script>'), false);
      assert(histHtml.includes('&lt;script&gt;xss&lt;/script&gt;'));
      assert(histHtml.includes('142') && histHtml.includes('168') && histHtml.includes('35 min'));
      assert(histHtml.includes('118') && histHtml.includes('148') && histHtml.includes('45 min'));

      // SVG font-size >= 12.5 and padL/padR margins in HR SVG
      const hrSvg = app.ctx.generateHrSvgChart({ id: 'hr1', duration_min: 30, avg_hr: 130, max_hr: 165 });
      const hrFontSizes = [...hrSvg.matchAll(/font-size="([0-9.]+)"/g)].map((x) => Number(x[1]));
      assert(hrFontSizes.length > 0 && hrFontSizes.every((s) => s >= 12.5), `HR SVG font sizes must be >= 12.5, got ${hrFontSizes}`);

      // renderRenphoTrendChart: <2 points fallback + timestamp normalization (seconds < 1e11 vs ms) + widened padL/padR
      app.setFetchHandler(async (url) => {
        if (url.includes('/api/renpho/history')) {
          return makeMockResponse([{ timestamp: 1700000000, body_fat_pct: 18.0, lean_mass_kg: 65.0, weight_kg: 80.0 }], { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });
      await app.ctx.renderRenphoTrendChart({ force: true });
      assert(app.document.getElementById('renphoTrendChartContainer').innerHTML.includes('Need ≥ 2 weigh-ins'));

      app.setFetchHandler(async (url) => {
        if (url.includes('/api/renpho/history')) {
          return makeMockResponse([
            { timestamp: 1700000000, body_fat_pct: 18.5, lean_mass_kg: 65.0, weight_kg: 80.5 }, // seconds (<1e11)
            { timestamp: 1700604800000, body_fat_pct: 18.1, lean_mass_kg: 65.1, weight_kg: 80.1 } // ms (>1e11)
          ], { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });
      await app.ctx.renderRenphoTrendChart({ force: true });
      const renphoHtml = app.document.getElementById('renphoTrendChartContainer').innerHTML;
      assert(renphoHtml.includes('30-DAY RENPHO TREND'));
      assert(renphoHtml.includes('Fat Velocity:'));
      const renphoFontSizes = [...renphoHtml.matchAll(/font-size="([0-9.]+)"/g)].map((x) => Number(x[1]));
      assert(renphoFontSizes.every((s) => s >= 12.5), `Renpho SVG font sizes must be >= 12.5, got ${renphoFontSizes}`);
      const chartsCode = fs.readFileSync(path.join(ROOT_DIR, 'js/charts.js'), 'utf8');
      assert(/const padL = 50;[\s\S]*?const padR = 54;/.test(chartsCode), 'Renpho chart must have widened padL=50, padR=54');

      // renderStrengthProgressionChart: getAllExercises() baseline alignment & single-point coercion
      app.eval('window.BAKED_LIVE_STATE.strength_prescriptions = {};');
      app.setFetchHandler(async (url) => {
        if (url.includes('/api/strength/history')) {
          return makeMockResponse({
            exercises: {
              barbell_squat: [{ weight: 100, reps: 8, e1rm: 126.7 }]
            }
          }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });
      await app.ctx.renderStrengthProgressionChart({ force: true });
      const strHtml = app.document.getElementById('strengthProgressionContainer').innerHTML;
      assert(strHtml.includes('Barbell Back Squat') && strHtml.includes('126.7'));
      assert(strHtml.includes('Barbell Floor Press') && strHtml.includes('95kg × 6'));

      // No duplicate renderHistoryList() inside initPulseCharts()
      const initMatch = chartsCode.match(/function initPulseCharts\s*\(\)\s*\{([\s\S]*?)\n\}/);
      assert(initMatch && !initMatch[1].includes('renderHistoryList'), 'initPulseCharts() must NOT duplicate renderHistoryList()');

      console.log('PASS [20] charts.js Normalization, Escaping, SVG Margins & Single-Point Coercion');
    }

    // [21] sw.js Lifecycle & Top-level dismissBootSplash / forcePulseAppReload / controllerchange Toast
    {
      const swCaches = createMockCaches();
      const swListeners = new Map();
      let swFetchImpl = async () => makeMockResponse({ ok: true }, { status: 200 });

      const swContext = {
        console, URL, Promise, JSON, caches: swCaches,
        Response: (body, init) => makeMockResponse(body, init),
        fetch: (req, opts) => swFetchImpl(req, opts),
        self: null
      };
      swContext.self = {
        location: { origin: 'https://pulse.local' },
        addEventListener(type, fn) {
          if (!swListeners.has(type)) swListeners.set(type, []);
          swListeners.get(type).push(fn);
        },
        skipWaiting() {},
        clients: { claim() {} }
      };
      vm.createContext(swContext);
      vm.runInContext(swJsCode, swContext, { filename: 'sw.js' });

      assert.strictEqual(vm.runInContext('CACHE_NAME', swContext), 'pulse-hybrid-v6.12-20261128');
      assert(swJsCode.includes('Promise.resolve(self.clients.claim()).catch(() => {})'));
      assert(swJsCode.includes('.catch(() => {})'), 'cache.put() must have .catch()');

      const installPromises = [];
      for (const fn of swListeners.get('install') || []) fn({ waitUntil: (p) => installPromises.push(p) });
      await Promise.all(installPromises);

      // /sw.js bypasses respondWith
      let swHandled = false;
      for (const fn of swListeners.get('fetch') || []) {
        fn({
          request: { method: 'GET', url: 'https://pulse.local/sw.js', mode: 'same-origin' },
          respondWith: () => { swHandled = true; }
        });
      }
      assert.strictEqual(swHandled, false, '/sw.js fetch must be bypassed');

      // /?tab=fuel caches under /index.html
      let navRespPromise = null;
      swFetchImpl = async () => makeMockResponse('<html>ok</html>', { status: 200 });
      for (const fn of swListeners.get('fetch') || []) {
        fn({
          request: { method: 'GET', url: 'https://pulse.local/?tab=fuel', mode: 'navigate' },
          respondWith: (p) => { navRespPromise = p; }
        });
      }
      await navRespPromise;
      await flushMicrotasks();
      const cacheBucket = swCaches._stores.get('pulse-hybrid-v6.12-20261128');
      assert.strictEqual(cacheBucket.has('https://pulse.local/index.html'), true, '/?tab=fuel must cache under /index.html');

      // Top-level dismissBootSplash & forcePulseAppReload
      assert.strictEqual(typeof app.ctx.dismissBootSplash, 'function');
      assert.strictEqual(typeof app.ctx.forcePulseAppReload, 'function');
      const splashEl = app.document.getElementById('pulseBootSplash');
      splashEl.classList.remove('boot-splash-hidden');
      app.ctx.dismissBootSplash();
      assert.strictEqual(splashEl.classList.contains('boot-splash-hidden'), true);

      // Offline guard on forcePulseAppReload
      app.resetReloadCount();
      app.navigator.onLine = false;
      await app.ctx.forcePulseAppReload();
      assert.strictEqual(app.getReloadCount(), 0, 'forcePulseAppReload offline must NOT reload');
      const offlineToastTxt = app.document.getElementById('appToast').children.map((c) => c.textContent).join(' ');
      assert(offlineToastTxt.includes('Offline'));
      app.navigator.onLine = true;

      // Trigger window load to attach controllerchange listener, then test deferred toast when timer/sets active
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      app.triggerWindowEvent('load');
      await flushMicrotasks();

      app.resetReloadCount();
      app.eval('sessionLoggedSets = { barbell_squat_1: { logged: true } };');
      app.document.getElementById('appToast').innerHTML = '';
      app.triggerSwEvent('controllerchange');
      assert.strictEqual(app.getReloadCount(), 0, 'controllerchange with active sets must defer reload');
      const toastTxt = app.document.getElementById('appToast').children.map((c) => c.textContent).join(' ');
      assert(toastTxt.includes('App update ready'), 'Expected deferred update toast');
      assert(toastTxt.includes('Reload now'), 'Expected Reload now action button');

      console.log('PASS [21] sw.js Lifecycle, dismissBootSplash, forcePulseAppReload & controllerchange Toast');
    }

    // [22] Template-Literal HTML-Tag Integrity Regression Check
    {
      const jsDir = path.join(ROOT_DIR, 'js');
      const corruptedOpenRx = /^(iv|pan|trong|utton|etails|ummary|vg|efs|inearGradient|top|ine|ext|ath|ircle|olygon|olyline|ption|nput|abel|elect)(?=[ >\/])/;
      const corruptedCloseRx = /^(div|span|strong|button|details|summary|svg|defs|linearGradient|select|label)>/;
      for (const fname of fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
        const fileLines = fs.readFileSync(path.join(jsDir, fname), 'utf8').split(/\r?\n/);
        fileLines.forEach((line, idx) => {
          assert.strictEqual(
            corruptedOpenRx.test(line) || corruptedCloseRx.test(line),
            false,
            `Corrupted truncated HTML tag in js/${fname}:${idx + 1}: ${line.slice(0, 60)}`
          );
        });
      }
      console.log('PASS [22] Template-Literal HTML-Tag Integrity Regression Check');
    }

    // [23] 1-to-1 Garmin-to-Pulse Workout Pairing & Multi-Workout Disambiguation
    {
      app.localStorage.clear();
      const kbFinishIso = new Date(2026, 10, 21, 7, 55, 10, 0).toISOString();
      const sessFinishIso = new Date(2026, 10, 21, 7, 55, 40, 0).toISOString();
      const eveningKbFinishIso = new Date(2026, 10, 21, 18, 0, 0, 0).toISOString();

      // 1. Exact bug scenario: 2 Garmin recordings (Cardio warm-up + HIIT KB Flow) + 1 Pulse KB Flow
      app.localStorage.setItem('pulse_conditioning_history', JSON.stringify([
        {
          exId: 'kb_flow_1h_combat_core',
          name: '1H Rotational Combat & Core (5L → 5R)',
          date: kbFinishIso,
          mode: 'kb_flow',
          format: 'kb_flow',
          rounds: 8,
          amrapRounds: 8,
          duration_min: 30,
          calories: 345,
          sub_title: '1H Rotational Combat & Core (5L → 5R)'
        }
      ]));

      app.eval(`
        recentActivitiesData = [
          {
            id: 'garmin_cardio_1',
            name: 'Indoor_cardio',
            activity_type_key: 'indoor_cardio',
            sub_title: 'Cardio',
            subTitle: 'Cardio',
            rawDate: '2026-11-21 07:10:00',
            date: '2026-11-21 07:10:00',
            duration_min: 12,
            durationMin: 12,
            calories: 115,
            avg_hr: 118,
            max_hr: 142,
            aerobic_te: 1.5,
            anaerobic_te: 0.4,
            source: 'garmin_oauth'
          },
          {
            id: 'garmin_hiit_2',
            name: 'Hiit',
            activity_type_key: 'hiit',
            sub_title: 'HIIT',
            subTitle: 'HIIT',
            rawDate: '2026-11-21 07:25:00',
            date: '2026-11-21 07:25:00',
            duration_min: 30,
            durationMin: 30,
            calories: 370,
            avg_hr: 146,
            max_hr: 171,
            aerobic_te: 3.1,
            anaerobic_te: 2.2,
            source: 'garmin_oauth'
          }
        ];
      `);

      app.ctx.renderHistoryList();
      const histBox1 = app.document.getElementById('trainViewHistory');
      assert.strictEqual(histBox1.children.length, 2, 'Expected 2 rendered workout cards');
      const cardWarmupHtml = histBox1.children[0].innerHTML;
      const cardHiitHtml = histBox1.children[1].innerHTML;
      const allCardsHtml1 = `${cardWarmupHtml}\n${cardHiitHtml}`;
      const matchBadgeCount1 = (allCardsHtml1.match(/MATCHED WITH PULSE/g) || []).length;
      assert.strictEqual(matchBadgeCount1, 1, `MATCHED WITH PULSE must appear exactly once, got ${matchBadgeCount1}`);
      assert.strictEqual(cardWarmupHtml.includes('MATCHED WITH PULSE'), false, 'Warm-up Cardio card must NOT be matched with KB Flow');
      assert(cardHiitHtml.includes('MATCHED WITH PULSE'), 'Garmin HIIT card must receive MATCHED WITH PULSE');
      assert(cardHiitHtml.includes('1H Rotational Combat &amp; Core') || cardHiitHtml.includes('1H Rotational Combat & Core'), 'HIIT title should reflect 1H Rotational Combat & Core');
      assert(cardHiitHtml.includes('(Garmin HIIT)'), 'HIIT generic title should promote matched Pulse title with (Garmin HIIT)');

      // 2. Annotated warm-up isolation (even when HIIT card is absent)
      const isolatedWarmup = {
        id: 'garmin_warmup_only',
        name: 'Indoor_cardio',
        activity_type_key: 'indoor_cardio',
        sub_title: 'Warm-up: skipping and 2 warm-up tracks from Body Combat',
        subTitle: 'Warm-up: skipping and 2 warm-up tracks from Body Combat',
        user_notes: 'Warm-up: skipping and 2 warm-up tracks from Body Combat',
        rawDate: '2026-11-21 07:10:00',
        date: '2026-11-21 07:10:00',
        duration_min: 12,
        calories: 115,
        source: 'garmin_oauth'
      };
      assert.strictEqual(app.ctx.getMatchedPulseSessionForGarmin(isolatedWarmup, [isolatedWarmup]), null, 'Annotated skipping/Body Combat warm-up must NEVER match KB Flow even alone');

      // 3. Collapsed duplicate pulse_conditioning_history + pulse_session_history
      app.localStorage.setItem('pulse_session_history', JSON.stringify([
        {
          id: 'sess_kb_1',
          client_event_id: 'sess_kb_1',
          date: sessFinishIso,
          title: 'OPTION KB: 1H FLOW (30M)',
          preset: 'custom',
          calories: 345,
          details: {
            kb_flow_1h_combat_core_1: {
              exercise_id: 'kb_flow_1h_combat_core',
              weight: '20kg',
              reps: '8 rds (7200kg)',
              logged: true,
              format: 'kb_flow',
              durationSec: 1800,
              estBurn: 345
            }
          }
        }
      ]));
      app.ctx.renderHistoryList();
      const histBox3 = app.document.getElementById('trainViewHistory');
      assert.strictEqual(histBox3.children[0].innerHTML.includes('MATCHED WITH PULSE'), false, 'Warm-up must remain unmatched when both conditioning and session history exist for same workout');
      assert.strictEqual(histBox3.children[1].innerHTML.includes('MATCHED WITH PULSE'), true, 'HIIT card must still be the sole matched card');

      // 4. Time-window enforcement (> 2h separation must never match)
      app.localStorage.setItem('pulse_session_history', '[]');
      app.localStorage.setItem('pulse_conditioning_history', JSON.stringify([
        {
          exId: 'kb_flow_1h_combat_core',
          name: '1H Rotational Combat & Core (5L → 5R)',
          date: eveningKbFinishIso,
          mode: 'kb_flow',
          format: 'kb_flow',
          rounds: 7,
          duration_min: 30,
          calories: 320
        }
      ]));
      const morningOnly = {
        id: 'garmin_morning_gap',
        name: 'Hiit',
        activity_type_key: 'hiit',
        sub_title: 'HIIT',
        rawDate: '2026-11-21 07:00:00',
        date: '2026-11-21 07:00:00',
        duration_min: 15,
        calories: 160,
        source: 'garmin_oauth'
      };
      assert.strictEqual(app.ctx.getMatchedPulseSessionForGarmin(morningOnly, [morningOnly]), null, 'Activity > 2h away from Pulse session must NOT match');

      // 5. Manual app entry exclusion & footer label
      app.localStorage.setItem('pulse_conditioning_history', JSON.stringify([
        {
          exId: 'kb_flow_1h_combat_core',
          name: '1H Rotational Combat & Core (5L → 5R)',
          date: kbFinishIso,
          mode: 'kb_flow',
          format: 'kb_flow',
          rounds: 8,
          duration_min: 30,
          calories: 345
        }
      ]));
      const manualAct = {
        id: 'manual_123',
        name: 'Conditioning',
        sub_title: 'HIIT • 8 Rounds (30m)',
        rawDate: '2026-11-21 07:25:00',
        date: '2026-11-21 07:25:00',
        duration_min: 30,
        calories: 345,
        source: 'manual_app_entry'
      };
      app.eval(`recentActivitiesData = [${JSON.stringify(manualAct)}];`);
      assert.strictEqual(app.ctx.buildGarminPulseMatchMap([manualAct]).size, 0, 'manual_app_entry must never be matched as a Garmin recording');
      app.ctx.renderHistoryList();
      const manualCardHtml = app.document.getElementById('trainViewHistory').children[0].innerHTML;
      assert(manualCardHtml.includes('Pulse Logged Entry • ID: manual_123'), 'manual_app_entry footer must show Pulse Logged Entry instead of Garmin Telemetry');

      // 6. Manual 1-tap unlinkGarminPulseMatch & linkGarminPulseMatch
      app.eval(`
        recentActivitiesData = [
          {
            id: 'garmin_cardio_1',
            name: 'Indoor_cardio',
            activity_type_key: 'indoor_cardio',
            sub_title: 'Cardio',
            rawDate: '2026-11-21 07:10:00',
            date: '2026-11-21 07:10:00',
            duration_min: 12,
            calories: 115,
            source: 'garmin_oauth'
          },
          {
            id: 'garmin_hiit_2',
            name: 'Hiit',
            activity_type_key: 'hiit',
            sub_title: 'HIIT',
            rawDate: '2026-11-21 07:25:00',
            date: '2026-11-21 07:25:00',
            duration_min: 30,
            calories: 370,
            source: 'garmin_oauth'
          }
        ];
      `);
      app.ctx.unlinkGarminPulseMatch('garmin_hiit_2');
      const unlinkedBox = app.document.getElementById('trainViewHistory');
      const unlinkedHtmlAll = unlinkedBox.children.map((c) => c.innerHTML).join('\n');
      assert.strictEqual((unlinkedHtmlAll.match(/MATCHED WITH PULSE/g) || []).length, 0, 'Unlinking HIIT card must yield 0 matches (must not cascade to Cardio card)');
      assert(unlinkedBox.children[1].innerHTML.includes('Link Pulse'), 'Unlinked HIIT card must render Link Pulse button when unclaimed same-day Pulse workout exists');

      const linkKey = `cond:kb_flow_1h_combat_core:${kbFinishIso}`;
      app.ctx.linkGarminPulseMatch('garmin_hiit_2', linkKey);
      const relinkedBox = app.document.getElementById('trainViewHistory');
      assert.strictEqual(relinkedBox.children[0].innerHTML.includes('MATCHED WITH PULSE'), false, 'Cardio card must stay unmatched after re-linking HIIT');
      assert.strictEqual(relinkedBox.children[1].innerHTML.includes('MATCHED WITH PULSE'), true, 'HIIT card must be matched again after linkGarminPulseMatch');

      app.localStorage.clear();
      app.eval('recentActivitiesData = [];');
      console.log('PASS [23] 1-to-1 Garmin-to-Pulse Workout Pairing & Multi-Workout Disambiguation');
    }

    // [24] Out-of-Bounds currentExIdx, Corrupt v5.38 Session Recovery & Boot Splash Safety
    {
      app.localStorage.clear();

      // 1. Out-of-bounds currentExIdx (e.g. saved idx 3 / 99 on 2-item plan) clamps to 0 instead of throwing undefined.rest
      app.eval(`
        activeWorkoutPlan = [
          { id: 'barbell_squat', name: 'Barbell Back Squat', setsCount: 3, targetReps: 8, targetWeight: 80, family: 'squat', rest: '90s' },
          { id: 'barbell_bench_press', name: 'Barbell Bench Press', setsCount: 3, targetReps: 8, targetWeight: 70, family: 'horizontal_push', rest: '90s' }
        ];
        currentExIdx = 3;
      `);
      app.ctx.renderCurrentExercise();
      assert.strictEqual(app.eval('currentExIdx'), 0, 'Out-of-bounds currentExIdx=3 must clamp to 0');
      app.eval('currentExIdx = 99;');
      app.ctx.renderCurrentExercise();
      assert.strictEqual(app.eval('currentExIdx'), 0, 'Out-of-bounds currentExIdx=99 must clamp to 0');

      // 2. Null slot at index 0 + missing rest field jumps to index 1 and renders cleanly
      app.eval(`
        activeWorkoutPlan = [
          null,
          { id: 'barbell_squat', name: 'Barbell Back Squat', setsCount: 3, targetReps: 8, targetWeight: 80, family: 'squat' }
        ];
        currentExIdx = 0;
      `);
      app.ctx.renderCurrentExercise();
      assert.strictEqual(app.eval('currentExIdx'), 1, 'Null entry at index 0 must advance currentExIdx to valid index 1');
      assert.strictEqual(app.document.getElementById('exRestTarget').innerText, 'Rest: 60s', 'Missing ex.rest must safely default to 60s');

      // 3. Corrupt legacy pulse_active_session ([null, {}]) removes bad session, preserves activeWorkoutPlan, returns false
      const todayIso24 = app.ctx.getLocalDateStr();
      app.localStorage.setItem('pulse_active_session', JSON.stringify({
        date: todayIso24,
        currentExIdx: 3,
        plan: [null, {}]
      }));
      const restoredBad = app.ctx.restoreActiveSessionFromLocalStorage();
      assert.strictEqual(restoredBad, false, 'Corrupt plan [null, {}] must return false');
      assert.strictEqual(app.localStorage.getItem('pulse_active_session'), null, 'Corrupt pulse_active_session must be removed from localStorage');
      assert.strictEqual(app.eval('activeWorkoutPlan.length'), 2, 'Existing activeWorkoutPlan must remain intact when corrupt session is rejected');

      // 4. js/telemetry.js schedules dismissBootSplash BEFORE renderCurrentExercise inside load handler
      const telemetrySrc = fs.readFileSync(path.join(ROOT_DIR, 'js', 'telemetry.js'), 'utf8');
      const loadStart = telemetrySrc.indexOf("window.addEventListener('load'");
      const splashPos = telemetrySrc.indexOf('setTimeout(window.dismissBootSplash, 1650)', loadStart);
      const renderExPos = telemetrySrc.indexOf('renderCurrentExercise();', loadStart);
      assert(loadStart >= 0 && splashPos > loadStart && renderExPos > splashPos, 'setTimeout(window.dismissBootSplash, 1650) must be scheduled before renderCurrentExercise() on load');

      app.localStorage.clear();
      console.log('PASS [24] Out-of-Bounds currentExIdx, Corrupt v5.38 Session Recovery & Boot Splash Safety');
    }

    // [25] Nutrition Quality Audit startMonth ReferenceError & loadLiveState Pre-Fetch Resilience
    {
      app.localStorage.clear();
      const totals25 = { calories: 2150, protein: 195, carbs: 210, fat: 64, fiber: 34, sodium: 1800, water: 2.5 };
      const meals25 = {
        breakfast: { items: [{ name: 'Jumbo Oats', cals: 300, p: 10, c: 54, f: 5 }] },
        lunch: { items: [{ name: 'Chicken Salad', cals: 500, p: 55, c: 20, f: 15 }] },
        dinner: { items: [] },
        snacks: { items: [] }
      };

      // 1a. Single-month multi-day flax history must render without ReferenceError and format "(Nov 12, 15)"
      app.eval(`
        window.nutritionAuditWindowMode = '10d';
        window.BAKED_LIVE_STATE.date = '2026-11-16';
        myNetDiaryData.history = {
          days: [
            { date: '2026-11-12', calories: 2100, protein: 190, carbs: 200, fat: 72, fiber: 35, items: [{ name: 'Cold Milled Flaxseed/Almonds', cals: 150, p: 5, c: 3, f: 13 }] },
            { date: '2026-11-14', calories: 2050, protein: 185, carbs: 195, fat: 52, fiber: 30, items: [{ name: 'Chicken Breast', cals: 400, p: 60, c: 0, f: 8 }] },
            { date: '2026-11-15', calories: 2200, protein: 195, carbs: 215, fat: 74, fiber: 36, items: [{ name: 'Walnuts & Flaxseed Mix', cals: 160, p: 4, c: 3, f: 14 }] },
            { date: '2026-11-16', calories: 2150, protein: 195, carbs: 210, fat: 64, fiber: 34, items: [{ name: 'Jumbo Oats', cals: 300, p: 10, c: 54, f: 5 }] }
          ]
        };
      `);
      app.ctx.renderNutritionQualityAudit(totals25, meals25, 2150, 195, 210, 64, 34, 1800, 2.5, 2200, 195, 220, 75);
      const auditHtmlSingle = app.document.getElementById('nutritionQualityAuditCard').innerHTML;
      assert(auditHtmlSingle.includes('(Nov 12, 15)'), `Single-month flax dates must include "(Nov 12, 15)", got: ${auditHtmlSingle.slice(0, 500)}`);

      // 1b. Cross-month flax history must include full month labels "(Oct 30, Nov 2)"
      app.eval(`
        window.nutritionAuditWindowMode = '10d';
        window.BAKED_LIVE_STATE.date = '2026-11-03';
        myNetDiaryData.history = {
          days: [
            { date: '2026-10-30', calories: 2100, protein: 190, carbs: 200, fat: 72, fiber: 35, items: [{ name: 'Cold Milled Flaxseed/Almonds', cals: 150, p: 5, c: 3, f: 13 }] },
            { date: '2026-11-02', calories: 2200, protein: 195, carbs: 215, fat: 74, fiber: 36, items: [{ name: 'Walnuts & Flaxseed Mix', cals: 160, p: 4, c: 3, f: 14 }] },
            { date: '2026-11-03', calories: 2150, protein: 195, carbs: 210, fat: 64, fiber: 34, items: [{ name: 'Jumbo Oats', cals: 300, p: 10, c: 54, f: 5 }] }
          ]
        };
      `);
      app.ctx.renderNutritionQualityAudit(totals25, meals25, 2150, 195, 210, 64, 34, 1800, 2.5, 2200, 195, 220, 75);
      const auditHtmlCross = app.document.getElementById('nutritionQualityAuditCard').innerHTML;
      assert(auditHtmlCross.includes('(Oct 30, Nov 2)'), `Cross-month flax dates must include "(Oct 30, Nov 2)"`);

      // 2. loadLiveState() must STILL call /api/live_state even if pre-fetch render step fails
      app.clearFetchCalls();
      let liveStateFetched = false;
      app.setFetchHandler(async (url) => {
        if (String(url).includes('/api/live_state')) {
          liveStateFetched = true;
          return makeMockResponse({ date: todayIso, last_synced: `${todayIso}T11:00:00Z`, garmin: { training_readiness: 80 } }, { status: 200 });
        }
        return makeMockResponse({ success: true }, { status: 200 });
      });
      app.eval(`
        window.__origRecordDailyBiometricSnapshot25 = recordDailyBiometricSnapshot;
        window.__origRenderMyNetDiaryEngine25 = renderMyNetDiaryEngine;
        let _snapCalls25 = 0;
        recordDailyBiometricSnapshot = function() {
          _snapCalls25++;
          if (_snapCalls25 === 1) throw new Error('Simulated pre-fetch DOM/storage error');
        };
        renderMyNetDiaryEngine = function() {
          throw new Error('Simulated MND render error');
        };
      `);
      try {
        await app.ctx.loadLiveState({ silent: false });
      } finally {
        app.eval(`
          if (window.__origRecordDailyBiometricSnapshot25) recordDailyBiometricSnapshot = window.__origRecordDailyBiometricSnapshot25;
          if (window.__origRenderMyNetDiaryEngine25) renderMyNetDiaryEngine = window.__origRenderMyNetDiaryEngine25;
          delete window.__origRecordDailyBiometricSnapshot25;
          delete window.__origRenderMyNetDiaryEngine25;
        `);
      }
      assert.strictEqual(liveStateFetched, true, 'loadLiveState() must still fetch /api/live_state even when pre-fetch applyLiveStateToDom throws');
      assert(app.getFetchCalls().some((c) => String(c.url).includes('/api/live_state')), 'Fetch log must include /api/live_state');

      app.localStorage.clear();
      console.log('PASS [25] Nutrition Quality Audit startMonth Fix & loadLiveState Pre-Fetch Resilience');
    }

    // [26] Earned Flex & Planned Banking UI, XSS Escaping, Scale Shield, Targets Parity & Rollover
    {
      app.localStorage.clear();

      // 1. Unlocked Flex Meal state
      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'unlocked',
          recommended_mode: 'flex_meal',
          eligible_modes: ['flex_snack', 'flex_meal'],
          tier_bonuses: { flex_snack: 250, flex_meal: 550 },
          suggested_bonus_kcal: 550,
          tdee_ref: 2740,
          streak: {
            clean_days_7d: 5,
            banked_7d_kcal: 1950,
            day_chips: [{ date: todayIso, state: 'clean', calories: 2100, protein_g: 205 }]
          },
          active_today: { active: false, bonus_kcal: 0, deduction_kcal: 0 },
          planned_bank: { active: false },
          scale_shield: { active: false },
          reason: '5/7 clean logged days — Flex Meal unlocked.'
        }
      });
      const flexHtmlUnlocked = app.document.getElementById('flexRefeedCard').innerHTML;
      assert(flexHtmlUnlocked.includes('Flex Meal Earned'));
      assert(flexHtmlUnlocked.includes('Use Flex Meal (+550 kcal)'));

      // 2. Banking In Progress with hostile XSS label escaped
      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'banking_in_progress',
          recommended_mode: null,
          eligible_modes: [],
          tier_bonuses: {},
          tdee_ref: 2740,
          streak: { clean_days_7d: 3, banked_7d_kcal: 900, day_chips: [] },
          active_today: { active: false, bonus_kcal: 0, deduction_kcal: 120 },
          planned_bank: {
            active: true,
            target_date: todayIso,
            target_kcal: 600,
            actual_banked_kcal: 240,
            daily_deduction_today: 120,
            days_remaining: 3,
            label: '<img src=x onerror=alert(1)>Sat Pizza'
          },
          scale_shield: { active: false },
          reason: 'Banking active.'
        }
      });
      const flexHtmlBank = app.document.getElementById('flexRefeedCard').innerHTML;
      assert.strictEqual(flexHtmlBank.includes('<img src=x'), false, 'Planned bank label must be HTML-escaped');
      assert(flexHtmlBank.includes('&lt;img src=x onerror=alert(1)&gt;Sat Pizza'));
      assert(flexHtmlBank.includes('Banking 3d left'));
      assert(flexHtmlBank.includes('Cancel Plan'));

      // 3. Claimed Today & Cooldown & Building states
      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'claimed_today',
          recommended_mode: 'flex_meal',
          tier_bonuses: {},
          tdee_ref: 2740,
          streak: { clean_days_7d: 5, banked_7d_kcal: 1950, day_chips: [] },
          active_today: { active: true, claim_id: 'flx_1', mode: 'flex_meal', bonus_kcal: 550 },
          planned_bank: { active: false },
          scale_shield: { active: true, claim_mode: 'flex_meal', hours_remaining: 48, note: 'Glycogen retention notice' },
          reason: 'Active today.'
        }
      });
      assert(app.document.getElementById('flexRefeedCard').innerHTML.includes('Undo Today'));

      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'cooldown',
          tier_bonuses: {},
          tdee_ref: 2740,
          streak: { clean_days_7d: 5, banked_7d_kcal: 1950, day_chips: [] },
          active_today: { active: false },
          planned_bank: { active: false },
          scale_shield: { active: false },
          reason: 'Cooldown active.'
        }
      });
      assert(app.document.getElementById('flexRefeedCard').innerHTML.includes('Cooldown'));

      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'building',
          tier_bonuses: {},
          tdee_ref: 2740,
          streak: { clean_days_7d: 1, banked_7d_kcal: 350, day_chips: [] },
          active_today: { active: false },
          planned_bank: { active: false },
          scale_shield: { active: false },
          reason: 'Building streak.'
        }
      });
      assert(app.document.getElementById('flexRefeedCard').innerHTML.includes('Building'));

      // 4. 48-hour Scale Shield visibility
      app.ctx.renderPostRefeedScaleShield({
        flex_refeed: {
          scale_shield: {
            active: true,
            claim_mode: 'flex_meal',
            hours_remaining: 36,
            note: 'Expected +0.5–1.2 kg water retention.'
          }
        }
      });
      assert(app.document.getElementById('postRefeedScaleShield').innerHTML.includes('Scale Shield Active'));
      assert.strictEqual(app.document.getElementById('todayScaleShieldPill').style.display, 'inline-block');
      assert(app.document.getElementById('todayScaleShieldPill').innerText.includes('36h'));

      app.ctx.renderPostRefeedScaleShield({ flex_refeed: { scale_shield: { active: false } } });
      assert.strictEqual(app.document.getElementById('postRefeedScaleShield').innerHTML, '');
      assert.strictEqual(app.document.getElementById('todayScaleShieldPill').style.display, 'none');

      // 5. Target parity: active +550 boost and -120 banking trim keep protein_target_g locked
      app.eval(`
        window.BAKED_LIVE_STATE.date = '${todayIso}';
        window.BAKED_LIVE_STATE.garmin = { active_calories: 0, today_activities: [] };
        window.BAKED_LIVE_STATE.nutrition = {
          base_calorie_target: 2092,
          calorie_target: 2642,
          base_protein_target_g: 200,
          protein_target_g: 200,
          flex_active: { date: '${todayIso}', type: 'claim', mode: 'flex_meal', adjustment_kcal: 550, carb_delta_g: 89, fat_delta_g: 21, label: 'Flex Meal (+550 kcal)' }
        };
      `);
      assert.strictEqual(app.ctx.getCanonicalDailyCalorieTarget(), 2642);
      const targetsBoost = app.ctx._resolveComputedFuelTargets({ goalKey: 'recomp', dietStrategy: 'balanced' });
      assert.strictEqual(targetsBoost.calorie_target, 2642);
      assert.strictEqual(targetsBoost.protein_target_g, 200, 'Protein anchor must remain locked on Flex Meal boost');

      app.eval(`
        window.BAKED_LIVE_STATE.nutrition = {
          base_calorie_target: 2092,
          calorie_target: 1972,
          base_protein_target_g: 200,
          protein_target_g: 200,
          flex_active: { date: '${todayIso}', type: 'bank_deduction', mode: 'planned_bank', adjustment_kcal: -120, carb_delta_g: -18, fat_delta_g: -5, label: 'Banking -120 kcal' }
        };
      `);
      assert.strictEqual(app.ctx.getCanonicalDailyCalorieTarget(), 1972);
      const targetsBank = app.ctx._resolveComputedFuelTargets({ goalKey: 'recomp', dietStrategy: 'balanced' });
      assert.strictEqual(targetsBank.calorie_target, 1972);
      assert.strictEqual(targetsBank.protein_target_g, 200, 'Protein anchor must remain locked on Banking deduction');

      // 6. UK midnight rollover must clear stale flex_active
      const staleFlexApp = createAppHarness({
        preInitLocalStorage: {
          pulse_cached_live_state: JSON.stringify({
            date: '2020-01-01',
            nutrition: {
              base_calorie_target: 2092,
              calorie_target: 2642,
              base_protein_target_g: 200,
              protein_target_g: 200,
              flex_active: { date: '2020-01-01', adjustment_kcal: 550 }
            }
          })
        }
      });
      try {
        const rolledNut = staleFlexApp.eval('window.BAKED_LIVE_STATE.nutrition');
        assert.strictEqual(rolledNut.flex_active, null, 'UK midnight rollover must clear stale nutrition.flex_active');
        assert.strictEqual(rolledNut.calorie_target, 2092);
      } finally {
        staleFlexApp.cleanupTimers();
      }

      // 7. Zero hardcoded hex in new Flex & Scale Shield CSS section
      const flexCssStart = stylesCss.indexOf('/* ==================== FLEX, REFEED & SCALE SHIELD TOKENS');
      assert(flexCssStart > 0, 'Expected Flex CSS tokens section in css/styles.css');
      const flexCss = stylesCss.slice(flexCssStart);
      assert.strictEqual(/#[0-9a-fA-F]{3,8}\b/.test(flexCss), false, 'New Flex/Shield CSS must contain zero hardcoded hex colors');

      app.localStorage.clear();
      console.log('PASS [26] Earned Flex & Planned Banking UI, XSS, Scale Shield, Parity & Rollover');
    }

    // [27] Fuel Tab 3-Subview Consolidation, Action-First Macros, Multi-Metric Chart & Dynamic Strategy Copy
    {
      app.localStorage.clear();

      // 1. Subview switcher isolation from Train subviews
      const btnTrainHist = app.document.getElementById('btnTrainHistory');
      const btnTrainPres = app.document.getElementById('btnTrainPrescribed');
      btnTrainHist.classList.add('active');
      btnTrainPres.classList.remove('active');

      app.ctx.switchFuelView('trends');
      assert.strictEqual(app.document.getElementById('btnFuelTrends').classList.contains('active'), true);
      assert.strictEqual(app.document.getElementById('fuelViewTrends').classList.contains('active'), true);
      assert.strictEqual(app.document.getElementById('fuelViewToday').classList.contains('active'), false);
      assert.strictEqual(btnTrainHist.classList.contains('active'), true, 'switchFuelView must not alter .train-subview-nav buttons');

      app.ctx.switchFuelView('plan');
      assert.strictEqual(app.document.getElementById('btnFuelPlan').classList.contains('active'), true);
      assert.strictEqual(app.document.getElementById('fuelViewPlan').classList.contains('active'), true);
      assert.strictEqual(app.document.getElementById('fuelViewTrends').classList.contains('active'), false);

      app.ctx.switchFuelView('today');
      assert.strictEqual(app.document.getElementById('btnFuelToday').classList.contains('active'), true);
      assert.strictEqual(app.document.getElementById('fuelViewToday').classList.contains('active'), true);

      // 2. Action-first macro mode (remaining default <-> consumed toggle + persistence)
      app.eval(`
        fuelMacroDisplayMode = 'remaining';
        window.BAKED_LIVE_STATE.date = '${todayIso}';
        window.BAKED_LIVE_STATE.garmin = { active_calories: 0, today_activities: [] };
        window.BAKED_LIVE_STATE.nutrition = { base_calorie_target: 2092, calorie_target: 2092, base_protein_target_g: 200, protein_target_g: 200 };
        myNetDiaryData = {
          date: '${todayIso}',
          targets: { calories: 2092, protein: 200, carbs: 200, fat: 65 },
          totals: { calories: 1450, protein: 145, carbs: 140, fat: 40, fiber: 28, sodium: 1650, water: 1.5 },
          history: DEFAULT_MND_10D_HISTORY,
          meals: {
            breakfast: { name: 'Breakfast', time: '08:00', calories: 550, protein: 45, carbs: 60, fat: 15, items: [{ name: 'Jumbo Oats', cals: 300, p: 10, c: 54, f: 5 }] },
            lunch: { name: 'Lunch', time: '13:00', calories: 900, protein: 100, carbs: 80, fat: 25, items: [{ name: 'Chicken Breast', cals: 400, p: 70, c: 0, f: 8 }] },
            dinner: { name: 'Dinner', time: 'Pending', calories: 0, protein: 0, carbs: 0, fat: 0, items: [] },
            snacks: { name: 'Snacks & Hydration', time: 'Pending', calories: 0, protein: 0, carbs: 0, fat: 0, items: [] }
          }
        };
      `);
      app.ctx.renderMyNetDiaryEngine();
      assert.strictEqual(app.document.getElementById('macroProtein').innerText, '55g left');
      assert.strictEqual(app.document.getElementById('fuelMicroWaterVal').innerText, '1.5L');
      assert.strictEqual(app.document.getElementById('fuelMicroFiberVal').innerText, '28g');
      assert.strictEqual(app.document.getElementById('fuelMicroSodiumVal').innerText, '1,650mg');

      app.ctx.toggleFuelMacroDisplayMode();
      assert.strictEqual(app.localStorage.getItem('pulse_fuel_macro_mode'), 'consumed');
      assert.strictEqual(app.document.getElementById('macroProtein').innerText, '145g');
      app.ctx.toggleFuelMacroDisplayMode();
      assert.strictEqual(app.localStorage.getItem('pulse_fuel_macro_mode'), 'remaining');

      app.eval('myNetDiaryData.totals.protein = 205;');
      app.ctx.updateRunwayUI();
      assert.strictEqual(app.document.getElementById('macroProtein').innerText, '✓ Met');

      // Inline hydration update
      app.setFetchHandler(async () => makeMockResponse({ success: true }, { status: 200 }));
      await app.ctx.quickAddHydration(500);
      assert.strictEqual(app.document.getElementById('fuelMicroWaterVal').innerText, '2.0L');

      // 3. Conditional Today Flex Banner
      const flexBanner = app.document.getElementById('fuelTodayFlexBanner');
      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'unlocked',
          recommended_mode: 'flex_meal',
          tier_bonuses: { flex_meal: 550 },
          streak: { clean_days_7d: 5, banked_7d_kcal: 1900, day_chips: [] },
          active_today: { active: false },
          planned_bank: { active: false }
        }
      });
      assert.strictEqual(flexBanner.style.display, 'block');
      assert(flexBanner.innerHTML.includes('Flex Meal Earned (+550 kcal)'));

      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'banking_in_progress',
          streak: { clean_days_7d: 3, banked_7d_kcal: 800, day_chips: [] },
          active_today: { active: false },
          planned_bank: { active: true, target_date: todayIso, target_kcal: 600, actual_banked_kcal: 240, daily_deduction_today: 120, days_remaining: 3, label: '<b>Night</b>' }
        }
      });
      assert.strictEqual(flexBanner.style.display, 'block');
      assert.strictEqual(flexBanner.innerHTML.includes('<b>Night</b>'), false);
      assert(flexBanner.innerHTML.includes('&lt;b&gt;Night&lt;/b&gt;'));

      app.ctx.renderFlexRefeedCard({
        flex_refeed: {
          date: todayIso,
          status: 'building',
          streak: { clean_days_7d: 1, banked_7d_kcal: 200, day_chips: [] },
          active_today: { active: false },
          planned_bank: { active: false }
        }
      });
      assert.strictEqual(flexBanner.style.display, 'none');
      assert.strictEqual(flexBanner.innerHTML, '');

      // 4. Collapsed-by-default meals + open-slot persistence + Expand/Collapse All
      const streamEl = app.document.getElementById('mndMealsStreamContainer');
      app.eval('_openMealSlots.clear();');
      app.ctx.renderMndMealStream();
      assert.strictEqual(streamEl.children.length, 4);
      assert.strictEqual(streamEl.children[0].classList.contains('is-open'), false, 'Logged breakfast must default collapsed');
      assert(streamEl.children[0].innerHTML.includes('style="display:none;"'));

      const firstHeader = streamEl.children[0].querySelector('.meal-card-header');
      app.ctx.toggleMealAccordion(firstHeader);
      assert.strictEqual(streamEl.children[0].classList.contains('is-open'), true);
      app.ctx.renderMndMealStream();
      assert.strictEqual(streamEl.children[0].classList.contains('is-open'), true, 'Open meal slot must persist across re-renders');

      app.ctx.toggleAllMealAccordions();
      assert.strictEqual(streamEl.children[1].classList.contains('is-open'), true, 'Expand All must open all logged meals');
      assert.strictEqual(app.document.getElementById('btnToggleAllMeals').innerText, 'Collapse All');
      app.ctx.toggleAllMealAccordions();
      assert.strictEqual(streamEl.children[0].classList.contains('is-open'), false, 'Collapse All must collapse logged meals');
      assert.strictEqual(app.document.getElementById('btnToggleAllMeals').innerText, 'Expand All');

      // 5. Interactive multi-metric chart, comparison table, 2x2 scorecard & clean copy
      app.eval(`
        window.nutritionAuditWindowMode = '10d';
        window.BAKED_LIVE_STATE.date = '2026-11-16';
        myNetDiaryData.history = {
          days: [
            { date: '2026-11-12', calories: 2100, protein: 190, carbs: 200, fat: 72, fiber: 35, items: [{ name: 'Cold Milled Flaxseed/Almonds', cals: 150, p: 5, c: 3, f: 13 }] },
            { date: '2026-11-15', calories: 2200, protein: 195, carbs: 215, fat: 74, fiber: 36, items: [{ name: 'Walnuts & Flaxseed Mix', cals: 160, p: 4, c: 3, f: 14 }] },
            { date: '2026-11-16', calories: 2150, protein: 195, carbs: 210, fat: 64, fiber: 34, items: [{ name: 'Jumbo Oats', cals: 300, p: 10, c: 54, f: 5 }] }
          ]
        };
      `);
      app.ctx.setNutritionChartMetric('protein');
      app.ctx.selectNutritionChartDay('2026-11-12');
      const auditHtml = app.document.getElementById('nutritionQualityAuditCard').innerHTML;
      assert(auditHtml.includes('fuel-compare-table'), 'Trends view must render comparison table');
      assert(auditHtml.includes('fuel-scorecard-grid'), 'Trends view must render 2x2 KPI scorecard');
      assert(auditHtml.includes('Anchor 200g'), 'Protein metric chart must render Anchor target line');
      assert(auditHtml.includes('Nov 12:'), 'Selected day inspector must reflect Nov 12');
      assert(auditHtml.includes('(Nov 12, 15)'), 'Detailed notes drawer must preserve flax dates');
      assert.strictEqual(auditHtml.includes('Nov 8'), false, 'Audit copy must not contain hardcoded Nov 8');

      // 6. Dynamic strategy copy & badge sync
      app.ctx.selectDietStrategy('lowcarb');
      assert.strictEqual(app.document.getElementById('dietStrategyBadge').innerText, 'LOW CARB');
      assert.strictEqual(app.document.getElementById('dietLowCarbCarbs').innerText, '75g');

      app.localStorage.clear();
      console.log('PASS [27] Fuel Tab 3-Subview Consolidation, Action-First Macros, Multi-Metric Chart & Dynamic Strategy Copy');
    }

    // [28] Today <-> Workout Consistency, KB Sub-Mode Alignment & Joint-Safe Banners
    {
      app.localStorage.clear();
      app.eval(`
        window.BAKED_LIVE_STATE = window.BAKED_LIVE_STATE || {};
        window.BAKED_LIVE_STATE.garmin = { training_readiness: 88, body_battery: 92, sleep_score: 83, sleep_duration: '8h 19m', steps: 176 };
        window.PULSE_ANALYTICS_SUMMARY = {};
        window._userManualArchetype = false;
        window._userManualKbSubMode = false;
        recentActivitiesData = [];
        athleteInjuries = normalizeAthleteInjuries({ lumbar: false, shoulders: false, knees: false, elbows: true, wrists: false, ankles: false });
      `);
      app.ctx.setTodayContext('gear', 'kb');
      app.ctx.setTodayContext('time', '45m');

      const verdict = app.ctx.computeTodayWorkoutVerdict();
      assert.strictEqual(verdict.archetypeKey, 'option_kb');
      assert.strictEqual(verdict.recommendedKbSubMode, 'grinds');
      assert.deepStrictEqual(Array.from(verdict.activeRestrictionJoints), ['elbows']);
      assert.strictEqual(verdict.goldfishReason.includes('Fully cleared'), false, 'Today copy must reflect active restriction guardrail');

      app.ctx.openWorkoutTabFromVerdict();
      assert.strictEqual(app.localStorage.getItem('pulse_kb_submode'), 'grinds', 'openWorkoutTabFromVerdict must align Option KB to grinds');
      const grindPlan = app.eval('activeWorkoutPlan');
      assert.strictEqual(grindPlan.length, 5, 'Option KB grinds 45m plan should load 5 exercises');
      assert(
        grindPlan.every((ex) => !['glute_bridge_hold', 'zone2_flush', 'deadbug_hold', 'thoracic_openers'].includes(ex.id)),
        `Option KB grinds must use KB-safe exercises rather than rehab drills, got ${JSON.stringify(grindPlan.map((e) => e.id))}`
      );
      const swappedIdx = grindPlan.findIndex((ex) => ex && ex.jointSwapInfo);
      assert(swappedIdx >= 0, 'Swapped press exercise must retain jointSwapInfo');
      app.ctx.jumpToExercise(swappedIdx);
      const swapBanner = app.document.getElementById('exJointSwapBanner');
      assert.strictEqual(swapBanner.style.display, 'block');
      assert(swapBanner.innerHTML.includes('Elbow'), `Swap banner must mention Elbow restriction, got ${swapBanner.innerHTML}`);

      // Switching to 2H Flow keeps elbow-safe Gladiator Posterior flow without rehab padding
      app.ctx.setKbSubMode('flow_2h');
      const flow2hPlan = app.eval('activeWorkoutPlan');
      assert(flow2hPlan.some((ex) => ex.id === 'kb_flow_2h_gladiator_post'), '2H Flow should retain elbow-safe Gladiator Posterior flow');
      assert(flow2hPlan.every((ex) => ex.format === 'kb_flow'), '2H Flow menu must not mix in non-flow rehab cards');
      assert.strictEqual(app.document.getElementById('exJointSwapBanner').style.display, 'block');

      // Switching to 1H Flow (all 4 elbow-contraindicated) falls back cleanly to non-Pick-1 KB Grinds
      app.ctx.setKbSubMode('flow_1h');
      const flow1hFallback = app.eval('activeWorkoutPlan');
      assert.strictEqual(flow1hFallback.length, 5);
      assert(flow1hFallback.every((ex) => ex.format !== 'kb_flow'));
      assert(app.document.getElementById('stepCounter').innerText.startsWith('Exercise 1 of '), 'Fallback sequence must not display Pick 1 header');
      assert(app.document.getElementById('trainGearStatus').innerText.includes('Restricted'));
      assert.strictEqual(app.document.getElementById('exJointSwapBanner').style.display, 'block');

      app.eval('athleteInjuries = normalizeAthleteInjuries({});');
      app.localStorage.clear();
      console.log('PASS [28] Today <-> Workout Consistency, KB Sub-Mode Alignment & Joint-Safe Banners');
    }
  } finally {
    app.cleanupTimers();
  }
}

runAllTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exitCode = 1;
});
