// =====================================================================
// Service worker : l'app fonctionne hors ligne, et les mises à jour se font
// avec ton accord.
// - Les fichiers de l'app sont servis depuis le cache de la version installée.
// - Une nouvelle version (CACHE ci-dessous changé) se télécharge en arrière-plan,
//   puis ATTEND : l'app affiche « Mise à jour disponible — Oui / Non ».
// - Oui → l'app envoie « ACTIVER » → la nouvelle version prend le relais → rechargement.
// À CHAQUE PUBLICATION : changer le numéro de CACHE (sinon aucune mise à jour n'est proposée).
// =====================================================================
const CACHE = 'epicerie-v162';
const FICHIERS = ['./', 'index.html', 'app.js', 'normalise.js', 'store.js', 'produits.js', 'marques.js', 'recherche-bannieres.js', 'arbre-recherche.js', 'couverture.js', 'couverture-circulaires.js', 'demo-data.js',
  'ui.js', 'rabais.js', 'noms.js', 'calendrier.js', 'choix.js', 'comparer.js', 'circulaires.js', 'epiceries.js', 'ocr.js', 'camera.js', 'recu.js', 'lignes-recu.js', 'plu.js', 'plu.json', 'attente.js', 'manuscrit.js', 'sync.js', 'config.js',
  'retouche.js', 'maj.js', 'secteurs.js', 'bannieres-registre.js', 'scan.js', 'recettes.js', 'ingredients.js', 'lecons.js', 'plus.js', 'envoi.js', 'manifest.webmanifest', 'icone.svg',
  'visuels.js', 'visuels/index.json', 'visuels/correspondance.json', 'visuels/referentiel.json', 'visuels/noms-alternatifs.json', 'rattacher.js', 'visuels/rayons-par-defaut.json', 'rayons-defaut.js', 'position-aide.js', 'accents.js', 'plan.js', 'bilan.js',
  'icone-192.png', 'icone-512.png', 'apple-touch-icon.png',
  // Skins (même liste que FICHIERS_SKINS dans skins/skins.js)
  'skins/skins.js', 'skins/pro.css', 'skins/etiquette.css', 'skins/ludique.css', 'skins/potager.css', 'skins/doux.css',
  'skins/party.css', 'skins/futuriste.css', 'skins/metal.css', 'skins/electro.css', 'skins/musique.css', 'skins/sport.css', 'skins/pleinjour.css'];

self.addEventListener('install', (e) => {
  // On télécharge toute la nouvelle version en contournant le cache du navigateur.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FICHIERS.map((f) =>
    fetch(new Request(f, { cache: 'reload' })).then((r) => { if (!r.ok) throw new Error(f); return c.put(f, r); })))
    // Photos par niveau (visuels/index.json) : mises en cache aussi, mais une image manquante ne bloque pas la mise à jour.
    .then(() => c.match('visuels/index.json')).then((r) => (r ? r.json() : []))
    .then((cles) => Promise.all(cles.map((k) => fetch(`visuels/${k}.jpg`).then((r) => (r.ok ? c.put(`visuels/${k}.jpg`, r) : null)).catch(() => null))))));
  // Pas de skipWaiting ici : on attend ton « Oui ».
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'ACTIVER') self.skipWaiting();
  if (e.data?.type === 'VERSION') e.source?.postMessage({ type: 'VERSION', version: CACHE });
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});

// Fichiers de l'app : depuis le cache de la version installée (rapide, et hors ligne).
// Ce qui n'y est pas (ex. autres sites, base de données) : réseau normal.
// Console ordinateur (console/) : TOUT ce qu'elle charge vient du réseau, y compris les fichiers partagés avec l'app
// (produits.js, normalise.js…). Sinon elle mélangeait sa page à jour avec le calcul de l'ancienne version restée en cache
// (ex. complétude 3/5 au lieu de 3/4 en v111). Hors ligne seulement : la copie en cache.
const deLaConsole = async (e, url) => {
  if (url.pathname.includes('/console/')) return true;
  const client = e.clientId ? await self.clients.get(e.clientId) : null;
  return !!client?.url && new URL(client.url).pathname.includes('/console/');
};
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (await deLaConsole(e, url)) {
      try {
        return await fetch(e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' }));
      } catch (err) {
        const copie = await c.match(e.request, { ignoreSearch: true });
        if (copie) return copie;
        throw err;
      }
    }
    // Téléphone : fichiers de la version installée (rapide, et hors ligne) ; page inconnue → l'app
    const trouve = (await c.match(e.request, { ignoreSearch: true }))
      || (e.request.mode === 'navigate' ? await c.match('./') : null);
    return trouve || fetch(e.request);
  })());
});
