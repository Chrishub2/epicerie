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

/** Remplace la liste des photos pro (lignes { article_id, source_url } venues de Supabase). */
export function definirPhotosPro(lignes) {
  if (!Array.isArray(lignes)) return;
  pro = new Map(lignes.filter((l) => l?.article_id && l?.source_url).map((l) => [l.article_id, l.source_url]));
  try { localStorage.setItem(CLE_PRO, JSON.stringify([...pro])); } catch { /* stockage indisponible */ }
}

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

/** Adresse de la photo à afficher : photo pro approuvée, sinon la photo de la fiche, sinon l'image héritée, sinon ''. */
export function photoDe(a) {
  if (a?.id && pro.has(a.id)) return pro.get(a.id);
  if (a?.imageUrl) return a.imageUrl;
  const k = cleVisuel(a);
  return k ? `${BASE}${k}.jpg` : '';
}
