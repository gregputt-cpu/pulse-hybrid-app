// PULSE • Hybrid Athlete OS Service Worker
const CACHE_NAME = 'pulse-hybrid-v6.5-20261122';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css?v=6.5',
  '/js/state.js?v=6.5',
  '/js/workout-catalog.js?v=6.5',
  '/js/workout-verdict.js?v=6.5',
  '/js/workout-player.js?v=6.5',
  '/js/workout-timers.js?v=6.5',
  '/js/charts.js?v=6.5',
  '/js/fuel-engine.js?v=6.5',
  '/js/telemetry.js?v=6.5',
  '/js/diagnostics.js?v=6.5',
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
  event.waitUntil(Promise.resolve(self.clients.claim()).catch(() => {}));
});

self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (data.type === 'PULSE_PURGE_API_CACHE') {
    const purgePromise = caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) =>
          caches.open(k).then((cache) =>
            cache.keys().then((requests) =>
              Promise.all(
                requests
                  .filter((req) => {
                    try {
                      return new URL(req.url).pathname.startsWith('/api/');
                    } catch (e) {
                      return false;
                    }
                  })
                  .map((req) => cache.delete(req))
              )
            )
          )
        )
      )
    );
    if (event.waitUntil) event.waitUntil(purgePromise);
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  // 1. Network-first for dynamic API telemetry (cache read-only snapshot endpoints on 200; never cache preferences)
  if (url.pathname.startsWith('/api/')) {
    const shouldCacheApi =
      url.pathname === '/api/live_state' ||
      url.pathname === '/api/analytics/summary' ||
      url.pathname.startsWith('/api/renpho/history') ||
      url.pathname.startsWith('/api/strength/history');

    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && shouldCacheApi) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
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

  // 2. Navigation & HTML: Network-first with normalized /index.html fallback
  if (
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')
  ) {
    const cacheKey = (url.pathname === '/' && url.search) ? '/index.html' : event.request;
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => caches.match(cacheKey).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 3. Versioned JS/CSS (?v=): Cache-first with network fallback
  if (url.searchParams.has('v') && (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/'))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() =>
            caches.match(event.request, { ignoreSearch: true })
              .then((r) => r || new Response('', { status: 503, statusText: 'Offline' }))
          );
      })
    );
    return;
  }

  // 4. All other same-origin static assets (icons, manifest): Network-first with cache fallback
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
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
