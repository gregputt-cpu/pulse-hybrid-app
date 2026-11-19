// PULSE • Hybrid Athlete OS Service Worker
const CACHE_NAME = 'pulse-hybrid-v5.34-20261119';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css?v=5.32',
  '/js/state.js?v=5.33',
  '/js/workout-engine.js?v=5.33',
  '/js/charts.js?v=5.33',
  '/js/fuel-engine.js?v=5.33',
  '/js/telemetry.js?v=5.33',
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
  const url = new URL(event.request.url);

  // 1. Network-first for dynamic API telemetry
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
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

  // 2. Navigation / HTML / JS / CSS / Icons: Network-first with offline cache fallback (ensures immediate updates on reload)
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.json') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png')) {
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

  // 3. Stale-while-revalidate for static assets (icons, manifest)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
