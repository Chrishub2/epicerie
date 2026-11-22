// =====================================================================
// Recherche chez tes bannières (maquette recherche-bannieres-v1, approuvée le 2026-11-22)
// Ajout d'un produit inconnu → le téléphone dépose une demande (objet « recherche ») ; l'extension Chrome de
// l'ordinateur cherche sur chaque site (IGA, Metro, Super C, Maxi, Provigo, Walmart, Costco, Tigre Géant, Jean Coutu)
// et écrit ce qu'elle trouve dans la demande ; le téléphone l'affiche en direct.
// Choisir un produit → fiche créée + un prix par bannière qui vend le même produit (même format, même nom).
// Dans le doute, on ne rattache pas : un produit sans format ou au nom trop différent reste à part.
// =====================================================================
import { analyserFormat, formatLisible } from './normalise.js';
import { MARQUES } from './marques.js';

export const ORDRE = ['iga', 'metro', 'super_c', 'maxi', 'provigo', 'walmart', 'costco', 'tigre_geant', 'jean_coutu'];
export const ETATS_FINAUX = ['fait', 'rien', 'bloque', 'erreur'];
export const SOURCE = 'site_banniere';
export const GARDER_JOURS = 7;   // les demandes plus vieilles sont retirées du téléphone

export function nouvelleRecherche(q, id, maintenant = new Date()) {
  return { id, q: String(q).trim().slice(0, 120), le: maintenant.toISOString(), etat: 'attente', bannieres: {} };
}

/** Recherches à retirer (plus de 7 jours). */
export function aRetirer(recherches, maintenant = Date.now()) {
  return (recherches || []).filter((r) => !(maintenant - Date.parse(r.le) < GARDER_JOURS * 86400000)).map((r) => r.id);
}

/** { fait, total, etats: { iga: 'fait'|'rien'|'bloque'|'erreur'|'attente' } } */
export function avancement(r) {
  const etats = Object.fromEntries(ORDRE.map((b) => [b, r?.bannieres?.[b]?.etat || 'attente']));
  return { fait: ORDRE.filter((b) => ETATS_FINAUX.includes(etats[b])).length, total: ORDRE.length, etats };
}

const sansAcc = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
const RE_TAILLE = /\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|ml|l|lb|oz|un|unites?|pqt)\b/g;
const VIDES = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'd', 'l', 'et', 'a', 'au', 'aux', 'en', 'pot', 'pots', 'format']);
/** Mots qui comptent dans un nom (sans accents, sans format ni petits mots). */
export function mots(nom) {
  return new Set(sansAcc(nom).replace(RE_TAILLE, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((m) => m.length >= 2 && !VIDES.has(m)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}
/** Clé de format comparable : « kg:1 », « ml:4000 » ; null si inconnu. */
export function cleFormat(f) {
  const x = analyserFormat(f);
  return x && x.base && x.total ? `${x.base}:${Math.round(x.total * 1000) / 1000}` : null;
}

/** Marque en tête du nom : liste connue, sinon premier mot tout en majuscules (« KRAFT Beurre… »). */
export function separerMarque(nom) {
  const n = String(nom || '').trim();
  const m = MARQUES.find((x) => sansAcc(n).startsWith(`${sansAcc(x)} `));
  if (m) return { marque: m, nom: n.slice(m.length).trim() };
  const mot = n.split(/\s+/)[0] || '';
  if (mot.length >= 3 && /^[A-ZÀ-Ý&'-]+$/.test(mot) && mot !== mot.toLowerCase()) {
    return { marque: mot.charAt(0) + mot.slice(1).toLowerCase(), nom: n.slice(mot.length).trim() };
  }
  return { marque: '', nom: n };
}

/**
 * Produits de toutes les bannières, regroupés quand c'est le même : même code-barres, ou même format ET noms
 * presque identiques (au moins 75 % de mots communs). Une bannière n'apparaît qu'une fois par groupe.
 * → [{ nom, format, cleFormat, offres: [{ banniere, prix, regulier, url, local, code, nom }], meilleur }]
 */
export function regrouper(r, seuil = 0.75) {
  const groupes = [];
  for (const b of ORDRE) {
    for (const p of r?.bannieres?.[b]?.produits || []) {
      const cf = cleFormat(p.format || p.nom);
      const ms = mots(p.nom);
      const g = groupes.find((x) => !x.offres.some((o) => o.banniere === b)
        && ((p.code && x.codes.has(p.code)) || (cf && x.cleFormat === cf && jaccard(ms, x.mots) >= seuil)));
      const offre = { banniere: b, prix: p.prix, regulier: p.regulier || null, url: p.url || null, local: !!p.local, code: p.code || null, nom: p.nom };
      if (g) { g.offres.push(offre); if (p.code) g.codes.add(p.code); if (!g.image && p.image) g.image = p.image; }
      else groupes.push({ nom: p.nom, format: p.format || '', cleFormat: cf, mots: ms, codes: new Set(p.code ? [p.code] : []), image: p.image || null, offres: [offre] });
    }
  }
  for (const g of groupes) g.meilleur = g.offres.reduce((a, o) => (o.prix < a.prix ? o : a), g.offres[0]);
  // Plus de bannières d'abord (le produit le plus courant), puis le moins cher ; l'ordre des sites départage
  return groupes.sort((a, b) => b.offres.length - a.offres.length || a.meilleur.prix - b.meilleur.prix)
    .map(({ mots: _m, codes, ...g }) => ({ ...g, codes: [...codes] }));
}

const prixTexte = (v) => `${Number(v).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/** Prix à ajouter à la fiche : un par bannière du groupe (ajout seulement, comme tous les prix). */
export function prixDuGroupe(g, articleId, jour = new Date().toISOString().slice(0, 10)) {
  return g.offres.map((o) => ({
    articleId, banniere: o.banniere, offre: prixTexte(o.prix), prixNum: o.prix,
    prixRegulier: o.regulier && o.regulier > o.prix ? o.regulier : null,
    format: g.format ? formatLisible(g.format) : null,
    type: o.regulier && o.regulier > o.prix ? 'circulaire' : 'regulier', fin: null,
    source: SOURCE, observeLe: jour, nomProduit: o.nom, url: o.url,
  }));
}

/** Fiche créée à partir d'un groupe (nom sans marque ni format, marque séparée quand on la reconnaît). */
export function ficheDuGroupe(g) {
  // La marque reconnue dans le nom d'UNE des bannières (« KRAFT Beurre… » chez Metro) sert pour toutes (« Kraft Beurre… » chez IGA)
  const marque = [g.nom, ...g.offres.map((o) => o.nom)].map((n) => separerMarque(n).marque).find(Boolean) || '';
  const nom = marque && sansAcc(g.nom).startsWith(`${sansAcc(marque)} `) ? g.nom.slice(marque.length).trim() : g.nom;
  const sansFormat = nom.replace(RE_TAILLE_AFFICHE, '').replace(/[,\s]+$/, '').trim() || nom;
  const f = analyserFormat(g.format);
  return {
    nom: sansFormat.replace(/^./, (c) => c.toUpperCase()), marque,
    format: g.format ? formatLisible(g.format) : '', uniteRef: f?.base || 'unite',
    local: g.offres.some((o) => o.local), imageUrl: g.image || null,
    codes: g.codes.length === 1 ? [...g.codes] : [],   // deux codes différents dans le groupe : dans le doute, aucun
  };
}
const RE_TAILLE_AFFICHE = /\s*\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|ml|l|lb|oz)\b/gi;
