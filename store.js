// =====================================================================
// Couche de stockage — MODE DÉMO
// Données : localStorage de CE téléphone (pas de partage entre téléphones).
// Photos : IndexedDB. À la phase « Supabase », seul ce fichier change :
// mêmes fonctions, mais lecture/écriture dans la base partagée + temps réel.
// =====================================================================
import { etatDemo, MAGASINS_REELS, CODES_POSTAUX_REELS } from './demo-data.js';
import { normaliserProduits, migrerV3 } from './produits.js';

/** Met à niveau des données enregistrées par une version précédente, sans rien perdre. */
function migrer(e) {
  if ((e.version || 1) < 2) {
    // v2 : vraies adresses des succursales et bons codes postaux (Beloeil = J3G, Varennes = J3X).
    for (const r of MAGASINS_REELS) {
      const m = e.magasins.find((x) => x.id === r.id);
      if (m && !m.adresse) Object.assign(m, { nom: r.nom, adresse: r.adresse, lat: r.lat, lng: r.lng, codePostal: r.codePostal });
      if (!m && !e.magasins.some((x) => x.nom === r.nom)) e.magasins.push({ ...r });
    }
    for (const c of CODES_POSTAUX_REELS) if (!e.codesPostaux.some((x) => x.code === c.code)) e.codesPostaux.push({ ...c });
    e.codesPostaux = e.codesPostaux.filter((c) => c.code !== 'Varennes' || e.magasins.some((m) => m.codePostal === 'Varennes'));
    const j3h = e.codesPostaux.find((c) => c.code === 'J3H'); if (j3h) j3h.libelle = 'Mont-Saint-Hilaire';
    e.alertesMasquees ||= [];
    e.version = 2;
  }
  if (e.version < 3) {
    // v3 : structure produit → variantes. Copie de sécurité AVANT (bouton « Revenir à avant » dans Sauvegarde).
    try { localStorage.setItem(CLE_AVANT_V3, JSON.stringify({ date: new Date().toISOString(), etat: e })); } catch { /* espace plein : la migration n'efface rien de toute façon */ }
    migrerV3(e);
  }
  if (e.version < 4) {
    // v4 : Provigo (Boucherville) et Walmart (Saint-Bruno) ajoutés avec l'accord de Chris — seulement s'ils manquent.
    for (const id of ['m9', 'm10']) {
      const r = MAGASINS_REELS.find((x) => x.id === id);
      if (r && !e.magasins.some((x) => x.id === r.id || x.nom === r.nom || x.adresse === r.adresse)) e.magasins.push({ ...r });
    }
    for (const c of CODES_POSTAUX_REELS) if (!e.codesPostaux.some((x) => x.code === c.code)) e.codesPostaux.push({ ...c });
    e.version = 4;
  }
  return e;
}

/** Copie des données telles qu'avant la migration v3 (gardée 30 jours). */
const CLE_AVANT_V3 = 'epicerie-avant-v3';
export function copieAvantV3() {
  try {
    const c = JSON.parse(localStorage.getItem(CLE_AVANT_V3));
    if (!c?.etat) return null;
    if (Date.now() - new Date(c.date).getTime() > 30 * 864e5) { localStorage.removeItem(CLE_AVANT_V3); return null; }
    return c;
  } catch { return null; }
}

const CLE = 'epicerie-demo-v1';
/** Vrai quand la dernière sauvegarde sur ce téléphone a échoué (mémoire du navigateur pleine). */
export let memoirePleine = false;
let etat = null;
const abonnes = new Set();

export function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    const lu = brut ? JSON.parse(brut) : null;
    const versionLue = lu?.version || 1;
    // v115 (accord de Chris, 2026-11-22) : la copie d'avant la migration v3 prenait la moitié de la mémoire du
    // navigateur (≈ 1,9 million de caractères) ; une fois la migration faite, elle est retirée. Tes données sont en ligne.
    if (versionLue >= 3) try { localStorage.removeItem(CLE_AVANT_V3); } catch { /* rien à faire */ }
    etat = lu ? migrer(lu) : etatDemo();
    // Migration faite : on l'enregistre tout de suite (sinon elle serait refaite à chaque ouverture)
    // (essai séparé : un échec ici ne doit JAMAIS faire tomber dans le cas « données de démo » plus bas)
    if (lu && etat.version !== versionLue) {
      try { normaliserProduits(etat); localStorage.setItem(CLE, JSON.stringify(etat)); } catch (err) { console.warn('Migration non enregistrée', err); }
    }
  } catch {
    etat = etatDemo();
  }
  try { normaliserProduits(etat); } catch { /* sans effet sur l'affichage en v31 */ }
  return etat;
}

export function get() { return etat || charger(); }


export function sauver() {
  // Garde la structure produit → variantes cohérente après chaque modification,
  // une synchro (téléphone encore en v30), un import ou une réinitialisation.
  try { normaliserProduits(etat); } catch (e) { console.warn('Variantes', e); }
  try { localStorage.setItem(CLE, JSON.stringify(etat)); memoirePleine = false; } catch (e) {
    console.warn('Sauvegarde impossible', e);
    // Signalé une fois par ouverture de l'app (app.js affiche l'avertissement)
    if (!memoirePleine) { memoirePleine = true; try { window.dispatchEvent(new CustomEvent('epicerie:memoire-pleine')); } catch { /* hors navigateur */ } }
  }
  abonnes.forEach((f) => f(etat));
}

/** Modifie l'état puis sauvegarde : maj(e => { e.liste.push(...) }) */
export function maj(fn) { fn(etat); sauver(); }

export function abonner(fn) { abonnes.add(fn); return () => abonnes.delete(fn); }

export function reinitialiser() { etat = etatDemo(); sauver(); }

export function exporter() { return JSON.stringify(etat, null, 2); }

export function importer(json) {
  const e = JSON.parse(json);
  if (!e || !Array.isArray(e.articles) || !Array.isArray(e.liste)) throw new Error('Fichier non reconnu');
  etat = e; sauver();
}

export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------
// Photos (IndexedDB)
// ---------------------------------------------------------------------
function ouvrirDB() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('epicerie-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

export async function enregistrerPhoto(blob) {
  const id = uid('ph');
  const db = await ouvrirDB();
  await new Promise((ok, ko) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, id);
    tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
  });
  return id;
}

async function lirePhotoLocale(id) {
  const db = await ouvrirDB();
  return new Promise((ok, ko) => {
    const r = db.transaction('photos').objectStore('photos').get(id);
    r.onsuccess = () => ok(r.result || null); r.onerror = () => ko(r.error);
  });
}

// Photo absente du téléphone (retirée pour libérer l'espace, ou prise par l'autre
// membre du foyer) : on la redemande à la base partagée, puis on la garde en cache.
let telechargeur = null;
export function brancherTelechargement(fn) { telechargeur = fn; }

export async function lirePhoto(id) {
  const locale = await lirePhotoLocale(id);
  if (locale || !telechargeur) return locale;
  const blob = await telechargeur(id).catch(() => null);
  if (blob) await enregistrerPhotoSous(id, blob);
  return blob;
}

export async function photoLocaleExiste(id) { return !!(await lirePhotoLocale(id)); }

export async function enregistrerPhotoSous(id, blob) {
  const db = await ouvrirDB();
  await new Promise((ok, ko) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, id);
    tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
  });
}

/** Retire une photo du téléphone seulement (elle reste dans la base partagée). */
export async function supprimerPhotoLocale(id) {
  const db = await ouvrirDB();
  await new Promise((ok, ko) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = ok; tx.onerror = () => ko(tx.error);
  });
}

/** Réduit une photo à ~1280 px (JPEG) pour économiser l'espace. */
export async function compresser(fichier, max = 1280) {
  const img = await createImageBitmap(fichier);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
}
