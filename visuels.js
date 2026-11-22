// =====================================================================
// Photos par niveau (journal/SPEC-photos-niveaux.md)
// Ordre : photo pro approuvée (photos_pro) → photo de la fiche → image héritée de son niveau.
// Une fiche sans vraie photo hérite de l'image de son niveau le plus précis :
//   vraie photo (imageUrl) → sorte → générique → sous-catégorie → catégorie.
// Les images générées sont dans visuels/<clé>.jpg (fond blanc, 200 px) ;
// visuels/index.json liste les clés présentes, visuels/correspondance.json
// relie chaque fiche au référentiel v3 (pont en attendant la migration du schéma).
// =====================================================================

// Adresse du dossier visuels/ à côté de ce module : marche depuis l'app ET la console (app/console/).
const BASE = new URL('visuels/', import.meta.url).href;

// Photos professionnelles approuvées (photos_pro) : articleId → adresse de la photo studio.
// Gardées dans le navigateur pour l'affichage hors ligne et au démarrage.
const CLE_PRO = 'epicerie.photosPro';
let pro = new Map(lirePro());
function lirePro() { try { return JSON.parse(localStorage.getItem(CLE_PRO)) || []; } catch { return []; } }

// État des photos collées (a_traiter, a_detourer) et lien de la page, par fiche
let etatsPro = new Map();

/** Remplace la liste des photos pro (lignes { article_id, source_url, statut?, page_url? } venues de Supabase). */
export function definirPhotosPro(lignes) {
  if (!Array.isArray(lignes)) return;
  const ok = (l) => l?.article_id && l?.source_url && (!l.statut || l.statut === 'approuvee');
  pro = new Map(lignes.filter(ok).map((l) => [l.article_id, l.source_url]));
  etatsPro = new Map(lignes.filter((l) => l?.article_id).map((l) => [l.article_id, { statut: l.statut || 'approuvee', page: l.page_url || '', source: l.source_type || '' }]));
  try { localStorage.setItem(CLE_PRO, JSON.stringify([...pro])); } catch { /* stockage indisponible */ }
}
/** { statut, page, source } de la photo d'une fiche, ou null. Statut : approuvee · a_traiter · a_detourer ; source : marque · epicier · chris · maison. */
export function etatPhotoPro(articleId) { return etatsPro.get(articleId) || null; }
/** Après un envoi : la fiche passe « en préparation » tout de suite, sans attendre la prochaine lecture. */
export function marquerPhotoEnvoyee(articleId, page, source = 'chris') { etatsPro.set(articleId, { statut: 'a_traiter', page: page || '', source }); }
/** Option B (21 nov.) : ta photo ne remplace jamais une photo de la marque, de l'épicier ou collée par Chris (en place ou en préparation). */
export function photoMaisonPermise(articleId) { const et = etatsPro.get(articleId); return !et || et.source === 'maison'; }

let presentes = null;   // Set des clés d'images disponibles
let correspondance = {}; // articleId → { g: 'CAT-001-SC-01-P-001', s: 'gala' | null }

/** Charge les deux fichiers (une fois). Sans réseau ni cache : on garde les vraies photos seulement. */
export async function chargerVisuels() {
  try {
    const [i, c] = await Promise.all([
      fetch(BASE + 'index.json').then((r) => r.json()),
      fetch(BASE + 'correspondance.json').then((r) => r.json()),
    ]);
    presentes = new Set(i);
    correspondance = c || {};
  } catch { /* hors ligne avant la première mise en cache : rien d'hérité */ }
}

/** Niveaux du plus précis au plus général, pour une correspondance { g, s }. */
export function niveaux(m) {
  if (!m?.g) return [];
  const g = m.g;
  return [m.s ? `${g}~${m.s}` : null, g, g.replace(/-P-\d+$/, ''), g.replace(/-SC-\d+-P-\d+$/, '')].filter(Boolean);
}

/** Clé de l'image héritée la plus précise qui existe, ou null. */
export function cleVisuel(a, corr = correspondance, dispo = presentes) {
  if (!a || !dispo) return null;
  return niveaux(corr[a.id]).find((k) => dispo.has(k)) || null;
}

/** Marques différentes d'une fiche (variantes actives ; sinon la marque de la fiche). */
export function marquesDe(a) {
  const vs = (a?.variantes || []).filter((v) => !v.retiree);
  const liste = vs.length ? vs.map((v) => v.marque) : [a?.marque];
  return [...new Set(liste.map((m) => String(m || '').trim().toLowerCase()).filter(Boolean))];
}

/**
 * Photo de la marque pour la liste : photo PRO APPROUVÉE seulement (table photos_pro, règle « photos pro seulement »).
 * Une photo Open Food Facts, de la base de codes-barres ou prise au téléphone ne compte pas (décision de Chris, 21 nov.).
 */
function photoMarque(a) {
  return (a?.id && pro.get(a.id)) || '';
}

/**
 * Photo d'une rangée de la liste d'épicerie (règle de Chris, 21 nov.) :
 * - une seule marque (ou aucune) → photo pro de la marque, sinon l'image héritée (sorte → générique → sous-cat. → cat.) ;
 * - 2 marques et plus → image du niveau 3 (produit générique), sinon les autres niveaux, sinon la photo pro ;
 * - rien du tout → '' (la liste affiche le « ? »).
 */
export function photoListe(a, corr = correspondance, dispo = presentes) {
  if (!a) return '';
  const url = (k) => `${BASE}${k}.jpg`;
  const marque = photoMarque(a);
  if (marquesDe(a).length < 2) {
    if (marque) return marque;
    const k = cleVisuel(a, corr, dispo);
    return k ? url(k) : '';
  }
  const nivs = niveaux(corr[a.id]);
  const g = corr[a.id]?.g;
  const ordre = g ? [g, ...nivs.filter((k) => k !== g)] : nivs;
  const k = dispo ? ordre.find((x) => dispo.has(x)) : null;
  return k ? url(k) : marque;
}

/** « ? » stylé (fond blanc) pour une rangée de la liste sans aucune photo. */
export const PHOTO_VIDE = '<span class="photo-q" role="img" aria-label="Aucune photo">?</span>';

/** Adresse de la photo à afficher : photo pro approuvée, sinon la photo de la fiche, sinon l'image héritée, sinon ''. */
export function photoDe(a) {
  if (a?.id && pro.has(a.id)) return pro.get(a.id);
  if (a?.imageUrl) return a.imageUrl;
  const k = cleVisuel(a);
  return k ? `${BASE}${k}.jpg` : '';
}
