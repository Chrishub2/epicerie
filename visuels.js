// =====================================================================
// Photos par niveau (journal/SPEC-photos-niveaux.md)
// Une fiche sans vraie photo hérite de l'image de son niveau le plus précis :
//   vraie photo (imageUrl) → sorte → générique → sous-catégorie → catégorie.
// Les images générées sont dans visuels/<clé>.jpg (fond blanc, 200 px) ;
// visuels/index.json liste les clés présentes, visuels/correspondance.json
// relie chaque fiche au référentiel v3 (pont en attendant la migration du schéma).
// =====================================================================

// Adresse du dossier visuels/ à côté de ce module : marche depuis l'app ET la console (app/console/).
const BASE = new URL('visuels/', import.meta.url).href;

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

/** Adresse de la photo à afficher : la vraie photo d'abord, sinon l'image héritée, sinon ''. */
export function photoDe(a) {
  if (a?.imageUrl) return a.imageUrl;
  const k = cleVisuel(a);
  return k ? `${BASE}${k}.jpg` : '';
}
