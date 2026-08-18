/* ==========================================================================
   Undercover — service worker
   Cache complet à l'installation : l'app fonctionne hors-ligne dès la 2e visite
   (et même dès la 1re, une fois l'installation du worker terminée).
   ========================================================================== */

var CACHE_NAME = 'undercover-v1.5.0';

var ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'words.js',
  'manifest.json',
  'icons/logo-undercover.png',
  'icons/logo-civil.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE_NAME ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache d'abord : les ressources sont statiques et versionnées par CACHE_NAME.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;

      return fetch(request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function () {
          // Hors-ligne et hors cache : on renvoie la page principale pour les navigations.
          if (request.mode === 'navigate') return caches.match('index.html');
          return new Response('', { status: 504, statusText: 'Hors ligne' });
        });
    })
  );
});
