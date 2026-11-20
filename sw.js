// PULSE • Hybrid Athlete OS Service Worker
const CACHE_NAME = 'pulse-hybrid-v5.38-20261120';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css?v=5.32',
  '/js/state.js?v=5.38',
  '/js/workout-engine.js?v=5.38',
  '/js/charts.js?v=5.38',
  '/js/fuel-engine.js?v=5.38',
  '/js/telemetry.js?v=5.38',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Network-first for dynamic API telemetry (cache read-only snapshot endpoints on 200)
  if (url.pathname.startsWith('/api/')) {
    const shouldCacheApi =
      url.pathname === '/api/live_state' ||
      url.pathname.startsWith('/api/renpho/history') ||
      url.pathname.startsWith('/api/strength/history') ||
      url.pathname === '/api/mnd/status';

    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && shouldCacheApi) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached || new Response(
              JSON.stringify({ success: false, offline: true, error: 'Backend offline' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
    );
    return;
  }

  // 2. Navigation & HTML only: Network-first with /index.html fallback
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 3. All other same-origin GET static assets (.js, .css, .json, .svg, .png): Network-first without HTML fallback
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request)
          .then((r) => r || caches.match(event.request, { ignoreSearch: true }))
          .then((r) => r || new Response('', { status: 503, statusText: 'Offline' }))
      )
  );
});
