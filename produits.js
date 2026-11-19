// =====================================================================
// Structure produit → variantes (plan « structure à 4 niveaux », étape v31)
//
//   Rayon (niveau 1) → Produit = l'article (niveau 2, ce qui va sur la liste)
//   → Variantes (niveaux 3 + 4 : marque + format exact + codes-barres).
//
// v31 = fondations, AUCUN changement visible :
//  - chaque article reçoit `variantes` (1 variante créée à partir de la fiche actuelle) ;
//  - les anciens champs de l'article (marque, format, codes, photo, liens…) restent
//    la référence pendant la transition : la variante préférée en est le miroir,
//    recalculé à chaque sauvegarde (y compris après une synchro venant d'un
//    téléphone encore en v30) ;
//  - prix, achats et lignes de reçus reliés reçoivent `varianteId`.
// Module pur : dépend seulement de normalise.js (store.js l'importe).
// =====================================================================
import { analyserFormat } from './normalise.js';

/** Champs copiés de l'article vers sa variante préférée (l'article reste la référence en v31). */
const CHAMPS_MIROIR = ['marque', 'format', 'imageUrl', 'nutriscore', 'liens', 'local', 'bio', 'allergenes', 'offVerifie', 'majPrix'];

const nouvelId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pareil = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
const copie = (x) => (x == null || typeof x !== 'object' ? x : JSON.parse(JSON.stringify(x)));

/** La variante habituelle d'un produit (ou la première). */
export function variantePref(a) {
  const vs = a?.variantes || [];
  return vs.find((v) => v.id === a.variantePreferee && !v.retiree) || vs.find((v) => !v.retiree) || vs[0] || null;
}

/** Tous les codes-barres d'un produit (toutes variantes). */
export function codesDe(a) {
  return [...new Set([...(a?.codes || []), ...(a?.variantes || []).flatMap((v) => v.codes || [])])];
}

/** Retrouve { article, variante } à partir d'un code-barres (une des variantes GTIN). */
export function varianteParCode(e, codes) {
  const liste = Array.isArray(codes) ? codes : [codes];
  for (const a of e.articles || []) {
    for (const v of variantesActives(a)) if (v.codes?.some((c) => liste.includes(c))) return { article: a, variante: v };
  }
  return null;
}

/**
 * Garantit la structure produit → variantes sur tout l'état. Idempotente et rapide :
 * ne modifie que ce qui manque ou a changé. Retourne le nombre d'objets modifiés.
 */
export function normaliserProduits(e) {
  let n = 0;
  const prefDe = new Map();
  for (const a of e.articles || []) {
    let change = false;
    if (!Array.isArray(a.variantes) || !a.variantes.length) {
      a.variantes = [{ id: nouvelId(), marque: '', nom: '', format: '', codes: [], alias: [] }];
      change = true;
    }
    let v = variantePref(a);
    if (a.variantePreferee !== v.id) { a.variantePreferee = v.id; change = true; }
    for (const c of CHAMPS_MIROIR) {
      if (!pareil(v[c], a[c])) {
        if (a[c] === undefined) delete v[c]; else v[c] = copie(a[c]);
        change = true;
      }
    }
    // Codes : ceux de l'article qui n'appartiennent pas déjà à une autre variante
    const autres = new Set(a.variantes.filter((x) => x !== v).flatMap((x) => x.codes || []));
    const codes = (a.codes || []).filter((c) => !autres.has(c));
    if (!pareil(v.codes, codes)) { v.codes = codes; change = true; }
    v.alias ||= [];
    if (change) n++;
    prefDe.set(a.id, v.id);
  }
  // Rattache prix, achats et lignes de reçus à la variante (seulement s'il en manque une valide)
  const ids = new Map((e.articles || []).map((a) => [a.id, new Set(a.variantes.map((v) => v.id))]));
  const valide = (articleId, varianteId) => ids.get(articleId)?.has(varianteId);
  // fige : un prix est un historique (la base refuse de le modifier) → sa variante n'est jamais réécrite
  const rattacher = (o, fige = false) => {
    if (!o?.articleId || !prefDe.has(o.articleId)) return false;
    if (o.varianteId && (fige || valide(o.articleId, o.varianteId))) return false;
    o.varianteId = prefDe.get(o.articleId);
    return true;
  };
  for (const p of e.prix || []) if (rattacher(p, true)) n++;
  for (const x of e.achats || []) if (rattacher(x)) n++;
  for (const r of e.recus || []) {
    let change = false;
    for (const l of r.lignes || []) if (rattacher(l)) change = true;
    if (change) n++;
  }
  return n;
}

// ---------------------------------------------------------------------
// Gestion des variantes (v32 : section « Marques et formats » de la fiche).
// Règle de transition : l'article reste la référence pour sa variante préférée,
// et `a.codes` contient TOUS les codes du produit (le scan les trouve tous).
// ---------------------------------------------------------------------
const nettoyerCodes = (codes) => [...new Set((codes || []).map((c) => String(c).replace(/\D/g, '')).filter((c) => c.length >= 8))];

/** Ajoute une variante (marque, nom, format, codes) ; retourne-la. */
export function ajouterVariante(a, { marque = '', nom = '', format = '', codes = [] } = {}) {
  const v = { id: nouvelId(), marque: marque.trim(), nom: nom.trim(), format: format.trim(), codes: nettoyerCodes(codes), alias: [] };
  a.variantes = [...(a.variantes || []), v];
  a.codes = [...new Set([...(a.codes || []), ...v.codes])];
  return v;
}

/** Modifie une variante. La préférée est écrite dans l'article (sa référence), les autres directement. */
export function modifierVariante(a, vid, { marque, nom, format, codes }) {
  const v = a.variantes?.find((x) => x.id === vid);
  if (!v) return;
  const pref = variantePref(a) === v;
  const cible = pref ? a : v;
  if (marque !== undefined) cible.marque = marque.trim();
  if (format !== undefined) cible.format = format.trim();
  if (nom !== undefined) v.nom = nom.trim();
  if (codes !== undefined) {
    const nouveaux = nettoyerCodes(codes);
    const anciens = new Set(v.codes || []);
    a.codes = [...new Set([...(a.codes || []).filter((c) => !anciens.has(c)), ...nouveaux])];
    if (!pref) v.codes = nouveaux;
  }
}

/** Variantes affichées (les retirées sont gardées pour l'historique des prix, mais cachées). */
export function variantesActives(a) { return (a?.variantes || []).filter((v) => !v.retiree); }

/**
 * Retire une variante (jamais la préférée ni la dernière). Elle est archivée, pas effacée :
 * ses prix restent rattachés à elle (historique) au lieu d'être attribués à une autre marque/format.
 * Ses codes quittent le produit.
 */
export function retirerVariante(a, vid) {
  const v = a.variantes?.find((x) => x.id === vid);
  if (!v || v.retiree || variantesActives(a).length < 2 || variantePref(a) === v) return false;
  const codes = new Set(v.codes || []);
  a.codes = (a.codes || []).filter((c) => !codes.has(c));
  v.codes = [];
  v.retiree = true;
  return true;
}

/** Fait d'une variante la préférée : sa marque, son format et sa photo deviennent ceux de la fiche. */
export function choisirPreferee(a, vid) {
  const v = a.variantes?.find((x) => x.id === vid);
  if (!v || v.retiree || variantePref(a) === v) return;
  a.marque = v.marque || '';
  if (v.format) a.format = v.format;
  if (v.imageUrl) a.imageUrl = v.imageUrl;
  if (v.nutriscore) a.nutriscore = v.nutriscore; else delete a.nutriscore;
  a.variantePreferee = v.id;
}

/** Libellé court d'une variante : « Tilda · Riz basmati pur · 2 kg ». */
export function libelleVariante(v) {
  return [v.marque, v.nom, v.format].filter(Boolean).join(' · ') || 'Sans marque ni format';
}

// ---------------------------------------------------------------------
// Fusion des doublons et séparation (v33)
// ---------------------------------------------------------------------

/** Tous les objets de l'état qui pointent vers un produit (articleId). */
function references(e) {
  return [
    ...(e.liste || []), ...(e.prix || []), ...(e.achats || []), ...(e.photos || []), ...(e.releves || []),
    ...(e.recettes || []).flatMap((r) => r.ingredients || []),
    ...(e.recus || []).flatMap((r) => r.lignes || []),
  ];
}

/** Ce que la fusion va déplacer (pour l'aperçu avant de confirmer). */
export function apercuFusion(e, sourceIds) {
  const ids = new Set(sourceIds);
  const refs = references(e).filter((o) => ids.has(o.articleId));
  const sources = (e.articles || []).filter((a) => ids.has(a.id));
  return {
    variantes: sources.reduce((n, a) => n + variantesActives(a).length, 0),
    prix: (e.prix || []).filter((p) => ids.has(p.articleId) && !p.annule).length, // seuls les prix actifs suivent
    lignesListe: (e.liste || []).filter((l) => ids.has(l.articleId)).length,
    autres: refs.length,
  };
}

/**
 * Fusionne des produits dans `cibleId` : leurs variantes (avec leurs prix, codes et alias)
 * deviennent des variantes de la cible ; tout ce qui les pointait pointe vers la cible ;
 * deux lignes de liste non cochées du même produit sont additionnées. Les sources sont retirées.
 * Prix : la base les garde en AJOUT SEULEMENT (une modification est refusée). Chaque prix actif est donc
 * recopié sur la cible (copieDe) et l'original est annulé par ajout de clés (annule, annuleRaison 'fusion',
 * remplacePar). Exception : un prix encore en attente de lecture (photo hors ligne) est simplement déplacé,
 * ce que la base permet. Même méthode que la console (v63).
 */
export function fusionner(e, cibleId, sourceIds) {
  const cible = e.articles.find((a) => a.id === cibleId);
  const ids = new Set(sourceIds.filter((id) => id !== cibleId));
  const sources = e.articles.filter((a) => ids.has(a.id));
  if (!cible || !sources.length) return false;
  for (const s of sources) {
    // Variantes : on garde leurs identifiants (les prix et reçus restent bien rattachés)
    cible.variantes = [...(cible.variantes || []), ...(s.variantes || [])];
    cible.codes = [...new Set([...(cible.codes || []), ...(s.codes || [])])];
    const liens = [...(cible.liens || [])];
    for (const li of s.liens || []) if (!liens.some((x) => x.id === li.id)) liens.push(li);
    if (liens.length) cible.liens = liens;
    if (s.local) cible.local = true;
    if (!cible.imageUrl && s.imageUrl) cible.imageUrl = s.imageUrl;
  }
  const copies = [];
  for (const p of e.prix || []) {
    if (!ids.has(p.articleId) || p.annule) continue;
    if (p.enAttente) { p.articleId = cibleId; continue; }
    const id = 'pf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    copies.push({ ...JSON.parse(JSON.stringify(p)), id, articleId: cibleId, copieDe: p.id });
    Object.assign(p, { annule: true, annuleRaison: 'fusion', remplacePar: id });
  }
  if (copies.length) e.prix.push(...copies);
  const prix = new Set(e.prix || []);
  for (const o of references(e)) if (ids.has(o.articleId) && !prix.has(o)) o.articleId = cibleId; // les prix sont traités au-dessus
  // Lignes de liste en double (non cochées) → une seule, quantités additionnées
  const vues = new Map();
  e.liste = (e.liste || []).filter((l) => {
    if (l.articleId !== cibleId || l.coche) return true;
    const premiere = vues.get(cibleId);
    if (!premiere) { vues.set(cibleId, l); return true; }
    premiere.quantite = (Number(premiere.quantite) || 1) + (Number(l.quantite) || 1);
    return false;
  });
  e.articles = e.articles.filter((a) => !ids.has(a.id));
  return true;
}

/**
 * Sépare une variante en produit à part (l'inverse d'une fusion faite par erreur).
 * Ses prix, achats et lignes de reçus la suivent. Retourne le nouveau produit.
 */
export function separerVariante(e, articleId, vid, nom, nouvelArticleId) {
  const a = e.articles.find((x) => x.id === articleId);
  const v = a?.variantes?.find((x) => x.id === vid);
  if (!a || !v || v.retiree || variantesActives(a).length < 2 || variantePref(a) === v) return null;
  const codes = new Set(v.codes || []);
  a.codes = (a.codes || []).filter((c) => !codes.has(c));
  a.variantes = a.variantes.filter((x) => x !== v);
  const n = { id: nouvelArticleId, nom: nom.trim() || `${a.nom} (${libelleVariante(v)})`, rayonId: a.rayonId, rayonManuel: a.rayonManuel,
    uniteRef: a.uniteRef, marque: v.marque || '', format: v.format || '', codes: [...codes], local: !!v.local,
    imageUrl: v.imageUrl || null, variantes: [v], variantePreferee: v.id };
  for (const c of ['nutriscore', 'bio', 'allergenes']) if (v[c] !== undefined) n[c] = copie(v[c]);
  e.articles.push(n);
  for (const o of [...(e.prix || []), ...(e.achats || []), ...(e.recus || []).flatMap((r) => r.lignes || [])]) {
    if (o.articleId === articleId && o.varianteId === vid) o.articleId = n.id;
  }
  return n;
}

const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'a', 'au', 'aux', 'en', 'l', 'd', 'pour', 'avec', 'sans']);
const simplifier = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Mots significatifs d'un nom, sans la marque ni les formats (« 2 kg », « 500ml »…). */
function mots(a) {
  const marque = new Set(simplifier(a.marque).split(/[^a-z0-9]+/).filter(Boolean));
  return new Set(simplifier(a.nom).replace(/\d+(?:[.,]\d+)?\s*(kg|g|mg|l|ml|cl|lb|oz|x)\b/g, ' ')
    // Les chiffres comptent (lait 2 % ≠ lait 3,25 %) ; les mots d'une lettre non
    .split(/[^a-z0-9]+/).filter((m) => m && !MOTS_VIDES.has(m) && !marque.has(m) && (m.length > 1 || /\d/.test(m)))
    .map((m) => m.replace(/s$/, '')));
}

/**
 * Paires de produits qui sont probablement le même (à confirmer par toi) :
 * même code-barres, ou mêmes mots une fois la marque et le format enlevés.
 * Ex. « Lait 2 % » (marque —) et « Natrel lait 2% » (marque Natrel).
 */
export function doublonsProbables(e, max = 12) {
  const arts = (e.articles || []).map((a) => ({ a, m: mots(a), c: new Set(codesDe(a)) }));
  const paires = [];
  for (let i = 0; i < arts.length; i++) {
    for (let j = i + 1; j < arts.length; j++) {
      const x = arts[i], y = arts[j];
      let raison = null;
      if ([...x.c].some((c) => y.c.has(c))) raison = 'même code-barres';
      else if (x.m.size && y.m.size) {
        const communs = [...x.m].filter((m) => y.m.has(m)).length;
        const petit = Math.min(x.m.size, y.m.size), union = new Set([...x.m, ...y.m]).size;
        // Un nom contenu dans l'autre (au plus 1 mot de plus), ou 60 % de mots en commun
        if ((communs === petit && union - petit <= 1) || communs / union >= 0.6) raison = 'noms semblables';
      }
      if (raison && !(x.a.pasDoublon || []).includes(y.a.id) && !(y.a.pasDoublon || []).includes(x.a.id)) paires.push({ a: x.a, b: y.a, raison });
    }
  }
  return paires.sort((p, q) => (p.raison === q.raison ? 0 : p.raison === 'même code-barres' ? -1 : 1)).slice(0, max);
}

// ---------------------------------------------------------------------
// Achat → variante exacte (v34 : scan et reçus)
// ---------------------------------------------------------------------
const normAlias = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

/** Produit + variante d'après le nom imprimé sur un reçu de cette bannière (appris lors des reçus précédents). */
export function varianteParAlias(e, banniere, libelle) {
  const lib = normAlias(libelle);
  if (!banniere || !lib) return null;
  for (const a of e.articles || []) {
    for (const v of variantesActives(a)) if (v.alias?.some((x) => x.banniere === banniere && x.libelle === lib)) return { article: a, variante: v };
  }
  return null;
}

/** Retient « RIZ BASM 2KG » chez Maxi → cette variante (un même nom n'appartient qu'à une variante). */
export function retenirAlias(e, articleId, vid, banniere, libelle) {
  const lib = normAlias(libelle);
  if (!banniere || !lib) return;
  for (const a of e.articles || []) {
    for (const v of a.variantes || []) {
      const garde = a.id === articleId && v.id === vid;
      v.alias = (v.alias || []).filter((x) => garde || !(x.banniere === banniere && x.libelle === lib));
      if (garde && !v.alias.some((x) => x.banniere === banniere && x.libelle === lib)) v.alias.push({ banniere, libelle: lib });
    }
  }
}

export const memeFormat = (f1, f2) => {
  const a = analyserFormat(f1), b = analyserFormat(f2);
  return !!(a && b && a.base === b.base && Math.abs(a.total - b.total) / Math.max(a.total, b.total) < 0.03);
};
export const memeMarque = (m1, m2) => {
  const a = simplifier(m1), b = simplifier(m2);
  return !a || !b || a.includes(b) || b.includes(a);
};

/**
 * Quelle variante du produit `a` correspond à cet achat ? Par ordre de certitude :
 * code-barres → nom déjà vu sur un reçu de cette bannière → même marque et même format.
 * Sinon : si l'achat a un code-barres inconnu alors que le produit a déjà des variantes avec code,
 * c'est une autre marque/format → { nouvelle: { marque, format, codes } } (à créer) ; sinon la ★.
 */
export function varianteDeLAchat(a, { codes = [], banniere, libelle, marque, format } = {}) {
  const actives = variantesActives(a);
  const parCode = codes.length && actives.find((v) => v.codes?.some((c) => codes.includes(c)));
  if (parCode) return { variante: parCode, raison: 'code' };
  const lib = normAlias(libelle);
  const parAlias = banniere && lib && actives.find((v) => v.alias?.some((x) => x.banniere === banniere && x.libelle === lib));
  if (parAlias) return { variante: parAlias, raison: 'alias' };
  const parFormat = format && actives.find((v) => v.format && memeFormat(v.format, format) && memeMarque(v.marque, marque));
  if (parFormat) return { variante: parFormat, raison: 'format' };
  if (codes.length && actives.some((v) => v.codes?.length)) return { nouvelle: { marque: marque || '', format: format || '', codes }, raison: 'nouveau code' };
  return { variante: variantePref(a), raison: 'habituelle' };
}

// ---------------------------------------------------------------------
// Fiche complète ? (v42 : catalogue)
// ---------------------------------------------------------------------
const estPrixReel = (p) => p.source !== 'demo' && !p.annule && !p.enAttente;
/** Index en une passe : Set des articleId qui ont au moins un vrai prix (pas démo, pas annulé, pas en attente). */
export function articlesAvecPrixReel(prix) {
  const s = new Set();
  for (const p of prix || []) if (estPrixReel(p)) s.add(p.articleId);
  return s;
}
/**
 * Les 6 données de base d'une fiche, et ce qui manque. Une fiche « complète » peut être
 * comparée (format + vrai prix), reconnue au scan et aux reçus (code + marque), et retrouvée (photo, rayon).
 * Retourne { ok, total, manquants:[{cle, icone, texte}], alertes:[texte] }.
 * opts.prixReels (facultatif) : Set d'articleId ayant un vrai prix, de articlesAvecPrixReel(e.prix).
 * À passer quand on évalue tout le catalogue : évite de reparcourir tous les prix pour chaque fiche.
 */
export function completude(a, e, opts = {}) {
  const prixReel = opts.prixReels ? opts.prixReels.has(a.id) : (e.prix || []).some((p) => p.articleId === a.id && estPrixReel(p));
  const rayon = (e.rayons || []).find((r) => r.id === a.rayonId);
  const f = analyserFormat(a.format);
  const criteres = [
    { cle: 'format', icone: '⚖️', texte: 'format', ok: !!f },
    { cle: 'marque', icone: '🏷️', texte: 'marque', ok: !!String(a.marque || '').trim() },
    { cle: 'code', icone: '▥', texte: 'code-barres', ok: codesDe(a).length > 0 || !!a.plu?.length },
    { cle: 'photo', icone: '📷', texte: 'photo', ok: !!a.imageUrl },
    { cle: 'prix', icone: '💲', texte: 'vrai prix', ok: prixReel },
    { cle: 'rayon', icone: '🗂️', texte: 'rayon', ok: !!rayon && !/^divers$/i.test(rayon.nom) },
  ];
  const manquants = criteres.filter((c) => !c.ok).map(({ cle, icone, texte }) => ({ cle, icone, texte }));
  const alertes = [];
  // Format en kg mais comparé à l'unité (ou l'inverse) : les prix au kg seraient faux
  if (f && f.base !== a.uniteRef) alertes.push(`format en ${f.base === 'unite' ? 'unités' : f.base === 'kg' ? 'poids' : 'volume'}, comparé ${a.uniteRef === 'unite' ? 'à l\'unité' : a.uniteRef === 'kg' ? 'au kg' : 'au litre'}`);
  return { ok: criteres.length - manquants.length, total: criteres.length, manquants, alertes };
}

/**
 * Migration v3 (une seule fois) : structure + alias des reçus déjà reliés
 * (« RIZ BASM 2KG » chez Maxi → variante), pour que les prochains reçus se relient seuls.
 */
export function migrerV3(e) {
  normaliserProduits(e);
  for (const r of e.recus || []) {
    if (!r.banniere) continue;
    for (const l of r.lignes || []) {
      if (!l.articleId || !l.libelle) continue;
      const a = e.articles.find((x) => x.id === l.articleId);
      const v = a?.variantes?.find((x) => x.id === l.varianteId) || variantePref(a);
      if (!v) continue;
      const libelle = String(l.libelle).trim().toUpperCase();
      if (!v.alias.some((x) => x.banniere === r.banniere && x.libelle === libelle)) v.alias.push({ banniere: r.banniere, libelle });
    }
  }
  e.version = 3;
  return e;
}
