/* ============================================================
   MenuVerde — Service Worker v1.0
   Strategia:
   · UI (index.html, manifest.json): Cache-first + aggiornamento in background
   · Font Google / librerie CDN: Cache-first (stale-while-revalidate)
   · API Anthropic (api.anthropic.com): Network-only — richiede sempre connessione
   · Fallback offline: mostra pagina offline.html se non disponibile in cache
   ============================================================ */

const CACHE_NAME    = 'menuverde-v1';
const OFFLINE_URL   = './offline.html';

// Asset da pre-cachare all'installazione
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  // Font Google (verranno cachati al primo accesso con la strategia stale-while-revalidate)
];

// Domini che vanno sempre in rete (mai cachati)
const NETWORK_ONLY_HOSTS = [
  'api.anthropic.com',
];

// Domini CDN da cachare
const CACHE_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

// ── Install: pre-cacha gli asset essenziali ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching asset essenziali');
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: rimuove cache vecchie ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Rimuovo cache obsoleta:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: strategia per tipo di risorsa ────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API Anthropic → sempre rete, mai cache
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Font e CDN → stale-while-revalidate (usa cache, aggiorna in background)
  if (CACHE_CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 3. Navigazione (HTML) → network-first con fallback offline
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(event.request));
    return;
  }

  // 4. Tutto il resto (CSS inline, icone ecc.) → cache-first
  event.respondWith(cacheFirst(event.request));
});

// ── Strategie ────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Risorsa non disponibile offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  // Aggiorna in background indipendentemente
  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => {});
  return cached || networkPromise;
}

async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}

// ── Messaggio per forzare aggiornamento ──────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
