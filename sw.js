const CACHE = 'contador-soja-v1';

const SHELL_PATHS = [
  './',
  './index.html',
  './contagem.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icon.svg',
];

// Resolve to full absolute URLs using the SW's own location as base
const SHELL_URLS = new Set(SHELL_PATHS.map(p => new URL(p, self.location).href));

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL_PATHS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  if (SHELL_URLS.has(e.request.url)) {
    // App shell: cache-first
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
      })
    );
  } else {
    // Tudo mais (fontes, etc.): network-first, cai no cache se offline
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.status === 200) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
