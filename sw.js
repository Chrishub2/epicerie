// Service worker : l'app fonctionne hors ligne en magasin.
const CACHE = 'epicerie-v5';
const FICHIERS = ['./', 'index.html', 'app.js', 'normalise.js', 'store.js', 'demo-data.js',
  'ui.js', 'comparer.js', 'epiceries.js', 'ocr.js', 'scan.js', 'recettes.js', 'plus.js', 'manifest.webmanifest', 'icone.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});
// Réseau d'abord (pour avoir la dernière version), cache en secours.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copie = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copie));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
