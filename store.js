// =====================================================================
// Couche de stockage — MODE DÉMO
// Données : localStorage de CE téléphone (pas de partage entre téléphones).
// Photos : IndexedDB. À la phase « Supabase », seul ce fichier change :
// mêmes fonctions, mais lecture/écriture dans la base partagée + temps réel.
// =====================================================================
import { etatDemo, MAGASINS_REELS, CODES_POSTAUX_REELS } from './demo-data.js';

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
  return e;
}

const CLE = 'epicerie-demo-v1';
let etat = null;
const abonnes = new Set();

export function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    etat = brut ? migrer(JSON.parse(brut)) : etatDemo();
  } catch {
    etat = etatDemo();
  }
  return etat;
}

export function get() { return etat || charger(); }

export function sauver() {
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) { console.warn('Sauvegarde impossible', e); }
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

export async function lirePhoto(id) {
  const db = await ouvrirDB();
  return new Promise((ok, ko) => {
    const r = db.transaction('photos').objectStore('photos').get(id);
    r.onsuccess = () => ok(r.result || null); r.onerror = () => ko(r.error);
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
