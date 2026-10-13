const CACHE = 'contador-soja-v6';

const SHELL_PATHS = [
  './',
  './index.html',
  './placa.js',
  './placas/placa-24.json',
  './vendor/js-aruco2/cv.js',
  './vendor/js-aruco2/aruco.js',
  './vendor/js-aruco2/aruco_4x4_1000.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icon.svg',
];

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
  // Rede primeiro (versao nova chega na hora); sem internet, usa a copia guardada.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.status === 200) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
