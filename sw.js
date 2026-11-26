const CACHE_VERSION = 'inktex-studio-v6';
const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];
const CDN_CORE_URLS = [
  'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/contrib/mhchem.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/contrib/copy-tex.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.5.0/dist/purify.min.js',
  'https://unpkg.com/lucide@1.79.0/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
];
const CACHEABLE_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.cdnfonts.com'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.allSettled(APP_SHELL_URLS.map((url) => cache.add(url)));
    await Promise.allSettled(
      CDN_CORE_URLS.map(async (url) => {
        try {
          const req = new Request(url, { mode: 'cors' });
          const res = await fetch(req);
          if (res && res.ok) await cache.put(url, res);
        } catch (e) {
          // Non-fatal: CDN assets will still be cached lazily on first fetch
        }
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('inktex-studio-') && k !== CACHE_VERSION)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isSameOrigin = url.origin === self.location.origin;

  // 1. Same-origin HTML navigations: Network-First (updates ./index.html immediately when online; offline cache fallback)
  if (isSameOrigin && req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') {
          await cache.put('./index.html', res.clone());
        }
        return res;
      } catch (e) {
        const cached = await cache.match('./index.html') || await cache.match('./') || await cache.match(req, { ignoreSearch: true });
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2. Other same-origin assets (manifest.json, icônes SVG/PNG): Stale-While-Revalidate
  if (isSameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then(async (res) => {
          if (res && res.ok && res.type === 'basic') {
            await cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }
      const networkRes = await networkPromise;
      return networkRes || new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
    return;
  }

  // 2. Versioned CDN libraries, KaTeX 0.19.1 fonts & Google Fonts: Cache-First with background fill
  if (CACHEABLE_CDN_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
  }
});
