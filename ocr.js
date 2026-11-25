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

// ---------------------------------------------------------------------
// Lecture « intelligente » : l'IA (Claude) d'abord si le foyer est connecté,
// sinon la lecture sur le téléphone (Tesseract). Même résultat pour l'appelant.
// ---------------------------------------------------------------------
let lecteurIA = null;
/** Branché par sync.js une fois connecté : fn(type, blobs) → données ou null. */
export function brancherIA(fn) { lecteurIA = fn; }

async function essayerIA(type, blobs, etat, extra) {
  if (!lecteurIA) return null;
  etat?.('Lecture par l\'IA…');
  return lecteurIA(type, blobs, extra).catch(() => null);
}

/** L'IA peut-elle lire maintenant (foyer connecté + réseau) ? */
export const iaDisponible = () => !!lecteurIA && navigator.onLine;

/** Étiquette de prix → { offre, format, rabais, nom, source }. */
export async function lireEtiquette(blob, etat) {
  const r = await essayerIA('etiquette', [blob], etat);
  if (r) return { offre: r.prix_affiche || null, format: r.format ? formatLisible(r.format) : null, rabais: !!r.en_rabais,
    nom: [r.marque, r.produit].filter(Boolean).join(' ') || null, source: 'ia' };
  const texte = await lireTexte(blob, etat);
  return { ...analyserEtiquette(texte), nom: null, texte, source: 'ocr' };
}

/** Reçu (1 ou plusieurs photos) → { banniere, date, total, lignes:[{libelle, prix, code…}], verification, … }. liste = noms à relier. */
export async function lireRecu(blobs, etat, liste = [], attendus = []) {
  const r = await essayerIA('recu', blobs, etat, { ...(liste.length ? { liste } : {}), ...(attendus.length ? { attendus } : {}) });
  // « autre » : l'enseigne peut être plus récente que la fonction IA déployée (ex. Provigo, Walmart) → on la reconnaît dans le nom du magasin
  const t = (s) => (s == null || String(s).trim() === '' ? null : s); // texte absent : « "" » (IA) → null
  if (r) return { banniere: r.banniere && r.banniere !== 'autre' ? r.banniere : (ENSEIGNES.find(([re]) => re.test(`${r.magasin || ''} ${r.adresse || ''}`))?.[1] || null), magasin: t(r.magasin), adresse: t(r.adresse), telephone: t(r.telephone),
    date: t(r.date), heure: t(r.heure), caisse: t(r.caisse), caissier: t(r.caissier), transaction: t(r.transaction),
    nombreArticles: r.nombre_articles, sousTotal: r.sous_total, total: r.total, tps: r.tps, tvq: r.tvq, economies: r.economies,
    modePaiement: t(r.mode_paiement), programmeFidelite: t(r.programme_fidelite), pointsGagnes: r.points_gagnes, soldePoints: r.solde_points,
    autres: r.autres || [], verification: r.verification || null, source: 'ia',
    lignes: (r.lignes || []).map((l) => ({ libelle: l.libelle, nomClair: t(l.nom_clair), marque: t(l.marque), format: t(l.format),
      code: l.code_barres ? String(l.code_barres).replace(/\D/g, '') || null : null, quantite: l.quantite, poids: t(l.poids),
      prixUnitaire: l.prix_unitaire, prix: l.prix_total, rabais: l.rabais, rabaisSoustrait: l.rabais_soustrait ?? null, rabaisDejaDeduit: l.rabais_deja_deduit ?? null, taxable: t(l.taxable), articleListe: t(l.article_liste), explicationPrix: t(l.explication_prix) })) };
  let texte = '';
  for (const b of blobs) texte += (await lireTexte(b, etat)) + '\n';
  return { ...analyserRecu(texte), texte, source: 'ocr' };
}

/** Liste écrite à la main → [{ quantite, nom, certain }] ou null si l'IA n'est pas disponible. */
export async function lireListeIA(blob, etat) {
  const r = await essayerIA('liste', [blob], etat);
  return r ? r.articles.map((a) => ({ quantite: a.quantite || 1, nom: a.nom, certain: a.certain })) : null;
}

/** Recette → { titre, portions, lignes:[texte] } ou null si l'IA n'est pas disponible. */
export async function lireRecetteIA(blob, etat, lecons = []) {
  // v159 : tes corrections passées (« ligne imprimée → bon nom ») accompagnent la photo
  const r = await essayerIA('recette', [blob], etat, lecons.length ? { lecons } : undefined);
  // v157 : on garde aussi ce que l'IA a compris (nom à acheter, quantité, unité, facultatif, format du magasin)
  return r ? { titre: r.titre, portions: r.portions, lignes: r.ingredients.map((i) => i.texte), ingredients: r.ingredients } : null;
}

/** Photo d'un emballage → { nom, marque, format, code_barres } ou null (IA indisponible). */
export async function lireProduitIA(blob, etat) {
  const r = await essayerIA('produit', [blob], etat);
  return r ? { ...r, format: r.format ? formatLisible(r.format) : null } : null;
}

/** Couverture de livre → « Titre — Auteur » ; IA d'abord, sinon la plus longue ligne lue. */
export async function lireTitreLivre(blob, etat) {
  const r = await essayerIA('livre', [blob], etat);
  if (r?.titre) return { titre: r.titre, auteur: r.auteur || null, source: 'ia' };
  const texte = await lireTexte(blob, etat);
  const titre = texte.split('\n').map((l) => l.trim()).filter((l) => /[a-zà-ÿ]{3,}/i.test(l)).sort((a, b) => b.length - a.length)[0] || '';
  return { titre: titre.replace(/\s+/g, ' ').slice(0, 80), auteur: null, source: 'ocr' };
}

/** Petite image (data URL, ~160 px) à afficher comme photo d'un produit. */
export async function miniature(blob, taille = 160) {
  const img = await createImageBitmap(blob);
  const k = taille / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
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
    cb({ photoId, ...(await lireEtiquette(blob, etat)) });
  } catch (e) {
    etat(''); toast(e.message || 'Lecture impossible'); cb({ photoId, texte: '' });
  }
}

// ---------------------------------------------------------------------
// Reçus
// ---------------------------------------------------------------------
// Walmart d'abord : « Walmart Supercentre » contient « Superc » ; Super C exige un mot complet (« SUPER C », « SuperC »)
const ENSEIGNES = [[/wal-?mart/i, 'walmart'], [/provigo/i, 'provigo'], [/super\s*c\b/i, 'super_c'], [/\bmaxi\b/i, 'maxi'], [/\bmetro\b/i, 'metro'], [/\biga\b/i, 'iga'],
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
