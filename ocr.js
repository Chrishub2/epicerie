// =====================================================================
// Lecture de photos (étiquettes de prix, reçus) — directement sur le téléphone
// Moteur : Tesseract.js (OCR libre), chargé seulement au besoin (~quelques Mo,
// gardé en cache ensuite). Aucune image n'est envoyée à un serveur.
// La lecture peut se tromper : les champs sont toujours à vérifier.
// =====================================================================
import * as S from './store.js';
import { toast } from './ui.js';
import { formatLisible } from './normalise.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let worker = null;

function chargerScript(src) {
  return new Promise((ok, ko) => {
    if (window.Tesseract) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Lecteur de texte indisponible (hors ligne ?)'));
    document.head.appendChild(s);
  });
}

/** Texte lu sur une image. etat(msg) reçoit l'avancement. */
export async function lireTexte(blob, etat = () => {}) {
  etat('Préparation du lecteur (la 1re fois, quelques secondes)…');
  await chargerScript(TESSERACT);
  if (!worker) worker = await window.Tesseract.createWorker('fra');
  etat('Lecture de la photo…');
  const { data } = await worker.recognize(blob);
  return data.text || '';
}

/** Ouvre l'appareil photo et rend le fichier compressé (ou null). */
export function prendrePhoto() {
  return new Promise((ok) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.capture = 'environment';
    i.onchange = async () => { const f = i.files?.[0]; ok(f ? await S.compresser(f, 1800) : null); };
    i.click();
  });
}

const PRIX = /(\d{1,3})[,.](\d{2})\s*\$?/g;

/**
 * Étiquette de prix → { offre, format, rabais }.
 * Reconnaît « 2/5 $ », « 1,99 $/lb », « 4,39 $/kg », « 4,99 $ » (et « 4 99 » en exposant).
 */
export function analyserEtiquette(texte) {
  const t = texte.replace(/ /g, ' ').replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
  const rabais = /rabais|économ|econom|spécial|special|aubaine|prix réduit|sauvez/i.test(t);
  let offre = null;
  let m = t.match(/\b(\d{1,2})\s*(?:\/|pour)\s*(\d{1,3}(?:[,.]\d{2})?)\s*\$/i);
  if (m) offre = `${m[1]}/${m[2].replace('.', ',')} $`;
  if (!offre) {
    // Prix principal : premier prix qui n'est pas un prix unitaire (« … $/100 g ») ni un prix régulier
    for (const p of t.matchAll(PRIX)) {
      const apres = t.slice(p.index + p[0].length, p.index + p[0].length + 12);
      const avant = t.slice(Math.max(0, p.index - 14), p.index);
      if (/^\s*\//.test(apres) || /r[ée]g/i.test(avant)) continue;
      offre = `${p[1]},${p[2]} $`; break;
    }
  }
  if (!offre) {
    // Vendu au poids (aucun prix fixe) : « 6,99 $/lb », « 15,41 $/kg », « 0,99 $/100 g » (vrac)
    m = t.match(/(\d{1,3}[,.]\d{2})\s*\$?\s*\/\s*(lb|kg|100\s?g)/i);
    if (m) offre = `${m[1].replace('.', ',')} $/${m[2].replace(/\s+/g, ' ').toLowerCase()}`;
  }
  if (!offre) { m = t.match(/\b(\d{1,2})\s?(\d{2})\s*\$/); if (m) offre = `${m[1]},${m[2]} $`; } // « 4 99 $ » (exposant)
  const f = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  const format = f ? formatLisible(`${f[1].replace(',', '.')} ${f[2]}`) : null;
  return { offre, format, rabais };
}

/** Photo d'une étiquette → cb({ photoId, offre, format, rabais, texte }). */
export async function lirePrixPhoto(cb, zoneEtat) {
  const blob = await prendrePhoto();
  if (!blob) return;
  const photoId = await S.enregistrerPhoto(blob);
  const etat = (m) => { if (zoneEtat) zoneEtat.textContent = m; };
  try {
    const texte = await lireTexte(blob, etat);
    cb({ photoId, texte, ...analyserEtiquette(texte) });
  } catch (e) {
    etat(''); toast(e.message || 'Lecture impossible'); cb({ photoId, texte: '' });
  }
}

// ---------------------------------------------------------------------
// Reçus
// ---------------------------------------------------------------------
const ENSEIGNES = [[/super\s*c/i, 'super_c'], [/\bmaxi\b/i, 'maxi'], [/\bmetro\b/i, 'metro'], [/\biga\b/i, 'iga'],
  [/costco/i, 'costco'], [/jean\s*coutu/i, 'jean_coutu']];

/** Reçu → { banniere, date, total, lignes:[{ libelle, prix }] } (au mieux ; à vérifier). */
export function analyserRecu(texte) {
  const t = texte.replace(/ /g, ' ');
  const banniere = ENSEIGNES.find(([re]) => re.test(t))?.[1] || null;
  const d = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/) || t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  let date = null;
  if (d) date = d[1].length === 4 ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`
    : `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  const tot = [...t.matchAll(/total[^\n\d]{0,20}(\d{1,4}[,.]\d{2})/gi)].pop();
  const total = tot ? Number(tot[1].replace(',', '.')) : null;
  const lignes = [];
  for (const l of t.split('\n')) {
    const m = l.match(/^(.{3,}?)\s+(-?\d{1,3}[,.]\d{2})\s*[A-Z$]{0,3}\s*$/);
    if (!m || /total|tps|tvq|taxe|monnaie|comptant|visa|master|débit|debit|change|solde/i.test(m[1])) continue;
    lignes.push({ libelle: m[1].trim(), prix: Number(m[2].replace(',', '.')) });
  }
  return { banniere, date, total, lignes };
}
