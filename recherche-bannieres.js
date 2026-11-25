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

/**
 * v161 — Demandes déjà appliquées (vérification, générique) ou choisies (nom inconnu) : les produits trouvés ne
 * servent plus et prenaient ≈ 1,3 million de caractères sur le téléphone (« Mémoire du téléphone pleine »).
 * Ils sont retirés du téléphone seulement : marquée `allege`, la demande n'est plus renvoyée (sync.js),
 * la base en ligne garde la version complète. → nombre de demandes allégées
 */
export function alleger(recherches) {
  let n = 0;
  for (const r of recherches || []) {
    if (!r || r.allege || !(r.choixLe || (r.but !== 'nom' && r.appliqueLe))) continue;
    for (const b of Object.values(r.bannieres || {})) if (b && typeof b === 'object') delete b.produits;
    r.allege = true; n++;
  }
  return n;
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
  // Marque en majuscules, en entier (v122 : « BLACK DIAMOND » → « Black Diamond », pas seulement « Black »)
  const majuscules = n.match(/^(?:[A-ZÀ-Ý][A-ZÀ-Ý&'’.-]*\s+)*[A-ZÀ-Ý][A-ZÀ-Ý&'’.-]*(?=\s|$)/);
  const bloc = majuscules ? majuscules[0] : '';
  if (bloc.replace(/[^A-ZÀ-Ý]/g, '').length >= 3 && bloc !== n) {
    const joli = bloc.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return { marque: joli, nom: n.slice(bloc.length).trim() };
  }
  return { marque: '', nom: n };
}

// Mentions de site sans intérêt dans un nom (v122, demande de Chris : « je n'ai pas besoin de voir ça »)
const RE_MENTIONS = /^(?:(?:pr[ée]par[ée]\s+au\s+(?:canada|qu[ée]bec)|prepared\s+in\s+canada|produit\s+du\s+qu[ée]bec|product\s+of\s+canada|sponsoris[ée]e?|sponsored|commandit[ée]e?|promo|nouveau|new)\s*[.:,-]?\s*)+/i;
const RE_PRIX_UNITAIRE = /,?\s*(?:environ\s*)?\$?\s*\d+(?:[.,]\d+)?\s*\$?\s*\/\s*\d*(?:[.,]\d+)?\s*(?:100\s*)?(?:g|kg|ml|l|lb|un|ea)\b/gi;

/**
 * Nom d'un produit trouvé sur un site, présenté proprement : sans « Préparé au Canada », « Commandité »,
 * « Sponsorisé », ni prix au 100 g ; marque en entier à part ; format à part.
 * → { marque, nom, format }
 */
export function presenter(p, marquesVues = []) {
  const brut = String(p?.nom || '').replace(RE_PRIX_UNITAIRE, ' ').replace(/\s+/g, ' ').trim();
  const sansMention = brut.replace(RE_MENTIONS, '').trim();
  let { marque, nom } = separerMarque(sansMention);
  // Marque écrite en casse normale (« Black Diamond Ficello… » chez IGA) : reconnue si un autre site l'a écrite en majuscules
  if (!marque) {
    const m = [...marquesVues].sort((a, b) => b.length - a.length).find((x) => sansAcc(sansMention).startsWith(`${sansAcc(x)} `));
    if (m) { marque = m; nom = sansMention.slice(m.length).trim(); }
  }
  // Format : celui écrit dans le nom ; un « 100 g » ou « 1 kg » qui vient du prix au 100 g / au kg ne compte pas
  const compte = brut.match(/\b(\d+)\s*(unités?|bâtonnets|un|ct)\b/i);
  const taille = brut.match(RE_TAILLE_AFFICHE);
  let format = p?.format ? formatLisible(p.format) : '';
  if (format && !taille) format = compte ? `${compte[1]} ${compte[2].toLowerCase()}` : '';
  const sansFormat = nom.replace(RE_TAILLE_AFFICHE, '').replace(/\s*\b\d+\s*(?:unités?|un|bâtonnets|ct)\b/gi, '').replace(/[,.\s]+$/, '').trim() || nom;
  return { marque, nom: sansFormat.replace(/^./, (c) => c.toUpperCase()), format };
}

/** Marques en majuscules vues dans une demande (servent à reconnaître la même marque écrite autrement ailleurs). */
export function marquesDeLaDemande(r) {
  const s = new Set([...MARQUES, ...MARQUES_SITES]);
  for (const b of ORDRE) for (const p of produitsDe(r, b)) { const m = separerMarque(String(p.nom || '').replace(RE_MENTIONS, '').trim()).marque; if (m) s.add(m); }
  return s;
}

// v141 — Format lu par erreur dans un prix unitaire (« 7,54 $ … $1.29/100g » → « 100 g » ; tourtière Walmart à 75 $/kg).
// L'extension 1.14.2 ne le fait plus ; les recherches déjà reçues sont corrigées à la lecture : format recalculé du prix unitaire.
const RE_FMT_G = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lb|oz)\b/gi;
const cleFmt = (q, u) => `${Number(String(q).replace(',', '.'))}${u.toLowerCase()}`;
export function corrigerFormat(p) {
  const f = String(p?.format || '').match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lb|oz)$/i);
  if (!f || !p?.texte) return p;
  const voulu = cleFmt(f[1], f[2]);
  const libre = [], apresBarre = [];
  for (const t of [String(p.nom || ''), String(p.texte)]) {
    for (const m of t.matchAll(RE_FMT_G)) (/\/\s*\$?\s*$/.test(t.slice(Math.max(0, m.index - 3), m.index)) ? apresBarre : libre).push(cleFmt(m[1], m[2]));
  }
  if (libre.includes(voulu) || !apresBarre.includes(voulu)) return p;   // le format est vraiment écrit sur la tuile
  const pu = String(p.texte).match(/\$?\s*(\d+(?:[.,]\d+)?)\s*\$?\s*\/\s*(100\s*g|100\s*ml|kg|l)\b/i);
  const v = pu && Number(pu[1].replace(',', '.'));
  if (!v || !p.prix) return { ...p, format: '' };
  const u = pu[2].replace(/\s+/g, '').toLowerCase();
  const q = u.startsWith('100') ? Math.round((p.prix / v) * 100) : Math.round((p.prix / v) * 1000);
  return { ...p, format: `${q} ${u === '100ml' || u === 'l' ? 'ml' : 'g'}` };
}
const corriges = new WeakMap();
/** Produits trouvés chez une bannière, formats corrigés (mémorisé par liste). */
export function produitsDe(r, b) {
  const liste = r?.bannieres?.[b]?.produits;
  if (!liste) return [];
  if (!corriges.has(liste)) corriges.set(liste, liste.map(corrigerFormat));
  return corriges.get(liste);
}

/** Deux mots presque pareils : un préfixe, ou une lettre d'écart (« Ficelo » ≈ « Ficello », « gauffre » ≈ « gaufre »). */
function procheMot(m, v) {
  if (v === m || v.startsWith(m)) return true;
  if (m.length < 5) return false;
  const a = m, b = v.slice(0, m.length + 1);
  // distance d'édition ≤ 1 (préfixe du mot du site de même longueur ± 1)
  for (const cible of [b, b.slice(0, a.length), b.slice(0, a.length - 1)]) {
    if (Math.abs(cible.length - a.length) > 1) continue;
    let i = 0, j = 0, ecarts = 0;
    while (i < a.length && j < cible.length) {
      if (a[i] === cible[j]) { i++; j++; continue; }
      if (++ecarts > 1) break;
      if (a.length > cible.length) i++; else if (a.length < cible.length) j++; else { i++; j++; }
    }
    if (ecarts + (a.length - i) + (cible.length - j) <= 1) return true;
  }
  return false;
}
const singulier = (m) => m.replace(/[sx]$/, '');

/** Le produit trouvé parle-t-il de ce que Chris a écrit ? (tous ses mots, au pluriel ou à une lettre près) — écarte le bruit (paprika pour « poivron »). */
export function pertinent(p, q) {
  const voulus = [...mots(q)].map(singulier);
  const vus = [...mots(String(p?.nom || '').replace(RE_MENTIONS, ''))].map(singulier);
  // Prix lu qui n'est que la consigne (« Cocktail Dole …, Cons. 1,20 $/emb » à 1,20 $) : écarté
  const cons = String(p?.nom || '').match(/cons\.\s*(\d+[.,]\d+)\s*\$/i);
  if (cons && Math.abs(Number(cons[1].replace(',', '.')) - p.prix) < 0.005) return false;
  return voulus.length > 0 && voulus.every((m) => vus.some((v) => procheMot(m, v)));
}

// Marques maison et courantes des sites (pour séparer « Sans Nom », « Oasis »… quand le site les écrit en casse normale)
const MARQUES_SITES = ['Le Choix du Président', 'Sans Nom', 'Compliments', 'Selection', 'Irresistibles', 'Great Value', 'Our Finest', 'Kirkland Signature',
  'Black Diamond', 'Saputo', 'Oasis', 'Kraft', 'Dole', 'Tre Stelle', 'P’tit Québec', "P'tit Québec", 'Catelli', 'Heinz', 'Natrel', 'Québon', 'Lactantia',
  'Liberté', 'Danone', 'Activia', 'iögo', 'Yoplait', 'Kellogg’s', "Kellogg's", 'Quaker', 'Christie', 'Dempster’s', "Dempster's", 'POM', 'Gadoua', 'Mieux-Être', 'Dora'];

/** Le produit est-il CE générique (le mot cherché vient en tête du nom, marque retirée) ? « Fraises locales » oui, « Crème glacée à la fraise » non. */
export function enTete(p, q, marquesVues = []) {
  const v = presenter(p, marquesVues);
  const tete = [...mots(v.nom)].map(singulier)[0];
  const premier = [...mots(q)].map(singulier)[0];
  return !!tete && !!premier && procheMot(premier, tete);
}

/**
 * v122 — choix « générique » : pour chaque bannière, le moins cher des produits pertinents (le prix à l'étiquette ;
 * au kg / L quand les formats le permettent). → [{ banniere, produit, prix, regulier, prixUnitaire }] trié du moins cher.
 */
export function moinsCherParBanniere(r, q) {
  const vues = marquesDeLaDemande(r);
  const out = [];
  for (const b of ORDRE) {
    const cands = (produitsDe(r, b)).filter((p) => pertinent(p, q) && (mots(q).size >= 2 || enTete(p, q, vues)))
      .map((p) => ({ banniere: b, produit: p, vue: presenter(p, vues), prix: p.prix, regulier: p.regulier || null, prixUnitaire: prixUnitaire(p) }));
    if (!cands.length) continue;
    cands.sort(comparerPrix);
    out.push(cands[0]);
  }
  return out.sort((a, b) => a.prix - b.prix);
}

/** Prix au kg / L quand le format le permet, sinon null. */
function prixUnitaire(p) {
  const f = analyserFormat(p.format || '');
  return f && f.total && (f.base === 'kg' || f.base === 'l') ? p.prix / f.total : null;
}
/** Du moins cher au plus cher : au kg / L quand les deux le permettent (même unité), sinon le prix à l'étiquette. */
function comparerPrix(a, b) {
  const fa = analyserFormat(a.produit?.format || ''), fb = analyserFormat(b.produit?.format || '');
  if (a.prixUnitaire != null && b.prixUnitaire != null && fa?.base === fb?.base) return a.prixUnitaire - b.prixUnitaire;
  return a.prix - b.prix;
}

/**
 * v122 — liste des choix de la fenêtre : produits pertinents regroupés (même produit chez plusieurs bannières),
 * présentés proprement (nom, marque, format en entier) et triés du moins cher au plus cher.
 */
export function choixPresentes(r, q) {
  const vues = marquesDeLaDemande(r);
  const filtre = { ...r, bannieres: Object.fromEntries(ORDRE.map((b) => [b, { ...(r?.bannieres?.[b] || {}), produits: (produitsDe(r, b)).filter((p) => pertinent(p, q)) }])) };
  return regrouper(filtre).map((g) => ({ ...g, vue: presenter({ nom: g.nom, format: g.format }, vues),
    offres: [...g.offres].sort((x, y) => x.prix - y.prix) }))
    .sort((a, b) => a.meilleur.prix - b.meilleur.prix);
}

/**
 * Produits de toutes les bannières, regroupés quand c'est le même : même code-barres, ou même format ET noms
 * presque identiques (au moins 75 % de mots communs). Une bannière n'apparaît qu'une fois par groupe.
 * → [{ nom, format, cleFormat, offres: [{ banniere, prix, regulier, url, local, code, nom }], meilleur }]
 */
export function regrouper(r, seuil = 0.75) {
  const groupes = [];
  for (const b of ORDRE) {
    for (const p of produitsDe(r, b)) {
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

/** Prix à ajouter à la fiche : un par bannière du groupe (ajout seulement, comme tous les prix).
 *  Chaque prix a son identifiant (sans lui, la synchro ne peut pas l'envoyer — corrigé en v118). */
export function prixDuGroupe(g, articleId, jour = new Date().toISOString().slice(0, 10), nouvelId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  return g.offres.map((o) => ({
    id: nouvelId(o.banniere), articleId, banniere: o.banniere, offre: prixTexte(o.prix), prixNum: o.prix,
    prixRegulier: o.regulier && o.regulier > o.prix ? o.regulier : null,
    format: g.format ? formatLisible(g.format) : null,
    type: o.regulier && o.regulier > o.prix ? 'circulaire' : 'regulier', fin: null,
    source: SOURCE, observeLe: jour, nomProduit: o.nom, url: o.url, image: g.image || null,
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

// =====================================================================
// v118 — Vérification des prix à l'ajout (maquette recherche-niveaux-v2, accord de Chris 2026-11-22)
// Ajouter un produit à la liste → ses prix sont revérifiés chez les 9 bannières, au plus une fois par semaine
// de circulaires (du jeudi au mercredi). Chaque relevé est daté et ajouté (jamais modifié) ; un prix régulier
// qui change est signalé (regulierAvant). Dans le doute (nom ou format qui ne colle pas), rien n'est rattaché.
// =====================================================================

/** Premier jour (jeudi) de la semaine de circulaires qui contient ce jour (AAAA-MM-JJ). */
export function debutSemaine(jour) {
  const d = new Date(`${jour}T12:00:00Z`);
  const recul = (d.getUTCDay() - 4 + 7) % 7;   // jeudi = 4
  d.setUTCDate(d.getUTCDate() - recul);
  return d.toISOString().slice(0, 10);
}

/** Prix encore bons ? Vérifiés depuis le dernier jeudi → on ne refait pas la recherche. */
export const verifieCetteSemaine = (a, jour) => !!a?.prixVerifieLe && a.prixVerifieLe >= debutSemaine(jour);

/** Texte cherché sur les sites pour une fiche : marque + nom + format (« Kraft Beurre d'arachide crémeux 1 kg »). */
export function requeteFiche(a) {
  const nom = String(a?.nom || '').trim();
  const marque = String(a?.marque || '').trim();
  const avecMarque = marque && !sansAcc(nom).includes(sansAcc(marque)) ? `${marque} ${nom}` : nom;
  const fmt = a?.format && !RE_TAILLE.test(sansAcc(avecMarque)) ? ` ${formatLisible(a.format)}` : '';
  RE_TAILLE.lastIndex = 0;
  return `${avecMarque}${fmt}`.replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Mots qui CHANGENT le produit : présents sur le site mais absents de ta fiche → ce n'est pas le même
// (essai réel du 2026-11-22 : « Lactantia 2 % » rattaché par erreur à « Lactantia 2 % sans lactose »).
const DISTINCTIFS = new Set(['sans', 'lactose', 'non', 'chocolat', 'chocolate', 'bio', 'biologique', 'organic', 'croquant', 'crunchy',
  'naturel', 'natural', 'leger', 'light', 'allege', 'reduit', 'faible', 'decafeine', 'decaf', 'vanille', 'vanilla', 'fraise', 'fraises',
  'framboise', 'bleuet', 'bleuets', 'cerise', 'peche', 'mangue', 'citron', 'erable', 'miel', 'epice', 'epicee', 'piquant', 'fume',
  'ultra', 'extra', 'double', 'zero', 'diete', 'diet', 'proteine', 'proteines', 'protein', 'grec', 'greek', 'enrichi', 'omega',
  'gluten', 'vegan', 'vegetalien', 'mini', 'jumbo', 'saveur', 'aromatise']);
// Mots sans importance quand ils sont en trop sur le site (provenance, emballage)
const BRUIT = new Set(['mg', 'prepare', 'quebec', 'canada', 'produit', 'origine', 'carton', 'bouteille', 'sac', 'boite', 'paquet', 'emballage', 'ch', 'chacun']);
/** Mots stricts : comme mots(), mais les pourcentages comptent (« 2 % » → « 2pct ») et le prix unitaire est retiré. */
export function motsStricts(nom) {
  const t = sansAcc(nom).replace(/,?\s*\d+(?:[.,]\d+)?\s*\$\s*\/\s*\d*\s*(?:g|kg|ml|l|un)\b/g, ' ')
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, (m, n) => ` ${n.replace(',', '.')}pct `)
    .replace(/[ūû]/g, 'u');
  const out = new Set();
  for (const m of t.replace(RE_TAILLE, ' ').replace(/[^a-z0-9. ]/g, ' ').split(/\s+/)) {
    const x = m.replace(/^\.+|\.+$/g, '');
    if (/^\d+(?:\.\d+)?pct$/.test(x)) out.add(x);
    else if (x.length >= 2 && !VIDES.has(x) && !/^\d/.test(x)) out.add(x.replace(/\./g, ''));
  }
  return out;
}

/**
 * Le même produit que la fiche, parmi les résultats d'UNE bannière, ou null (dans le doute).
 * Même code-barres → oui. Sinon : même format, tous les mots de la fiche (marque et pourcentage compris),
 * aucun mot qui change le produit (sans lactose, chocolat, bio, léger, non salé…) absent de la fiche,
 * et peu de mots en trop (2 au plus ; 4 pour une fiche sans marque, où la marque du site s'ajoute).
 * Fiche sans marque (« Lait 2 % 4 L ») → le moins cher qui remplit ces conditions. Deux candidats de prix
 * différents pour une fiche AVEC marque → dans le doute, aucun.
 */
export function memeProduit(fiche, produits, codes = []) {
  const parCode = (produits || []).find((p) => p.code && codes.includes(p.code));
  if (parCode) return parCode;
  const cf = cleFormat(fiche?.format);
  if (!cf) return null;
  const voulus = new Set([...motsStricts(`${fiche.marque || ''} ${fiche.nom || ''}`)].filter((m) => !BRUIT.has(m)));
  if (![...voulus].some((m) => !m.endsWith('pct'))) return null;
  const maxTrop = fiche.marque ? 2 : 4;
  const ok = (produits || []).filter((p) => {
    if (cleFormat(p.format || p.nom) !== cf) return false;
    const ms = motsStricts(p.nom);
    if (![...voulus].every((m) => ms.has(m))) return false;
    const trop = [...ms].filter((m) => !voulus.has(m) && !BRUIT.has(m));
    if (trop.some((m) => DISTINCTIFS.has(m))) return false;
    if (trop.some((m) => m.endsWith('pct'))) return false;   // 1 % ≠ 2 %, même si la fiche n'en dit rien
    return trop.length <= maxTrop;
  });
  if (!ok.length) return null;
  ok.sort((x, y) => x.prix - y.prix);
  if (fiche.marque && ok.length > 1 && ok.some((p) => p.prix !== ok[0].prix)) return null;
  return ok[0];
}

/** Dernier prix régulier connu d'une fiche chez une bannière (prix déjà enregistrés, du plus récent au plus vieux). */
export function dernierRegulier(prix, articleId, banniere) {
  const l = (prix || []).filter((p) => p.articleId === articleId && p.banniere === banniere && !p.annule && !p.perso)
    .map((p) => ({ jour: String(p.observeLe || '').slice(0, 10), r: p.prixRegulier || (p.type === 'regulier' ? p.prixNum : null) }))
    .filter((x) => x.r && x.jour).sort((a, b) => (a.jour < b.jour ? 1 : -1));
  return l[0]?.r ?? null;
}

/**
 * Prix à ajouter après une vérification : un relevé daté par bannière où le même produit a été trouvé.
 * Identifiant fixe (recherche + bannière) : appliqué deux fois (deux téléphones), c'est le même prix.
 * → { prix: [...], changements: [{ banniere, avant, apres }] }
 */
export function prixVerification(r, fiche, prixExistants = [], codes = []) {
  const prix = [], changements = [];
  for (const b of ORDRE) {
    const res = r?.bannieres?.[b];
    if (res?.etat !== 'fait') continue;
    const p = memeProduit(fiche, produitsDe(r, b), codes);
    if (!p) continue;
    const rabais = p.regulier && p.regulier > p.prix;
    const regulier = rabais ? p.regulier : p.prix;
    const avant = dernierRegulier(prixExistants, fiche.id, b);
    const change = avant != null && Math.abs(avant - regulier) > 0.009;
    if (change) changements.push({ banniere: b, avant, apres: regulier });
    prix.push({
      id: `px-${r.id}-${b}`, articleId: fiche.id, banniere: b, offre: prixTexte(p.prix), prixNum: p.prix,
      prixRegulier: rabais ? p.regulier : null, format: p.format ? formatLisible(p.format) : (fiche.format || null),
      type: rabais ? 'circulaire' : 'regulier', fin: null, source: SOURCE,
      observeLe: String(res.le || r.finiLe || r.le).slice(0, 10), nomProduit: p.nom, url: p.url || null, image: p.image || null,
      ...(change ? { regulierAvant: avant } : {}),
    });
  }
  return { prix, changements };
}

/** Demande de vérification encore ouverte pour cette fiche (déposée, pas encore appliquée, moins de 24 h). */
export function verificationOuverte(recherches, articleId, maintenant = Date.now()) {
  return (recherches || []).some((r) => r.articleId === articleId && !r.appliqueLe && r.etat !== 'annule'
    && maintenant - Date.parse(r.le) < 24 * 3600000);
}

/** v163 — Une recherche de cette fiche tourne VRAIMENT encore (pas finie, pas appliquée ni choisie, moins de 24 h). */
export function rechercheEnCours(recherches, articleId, maintenant = Date.now()) {
  return (recherches || []).some((r) => r.articleId === articleId && r.etat !== 'fait' && r.etat !== 'annule'
    && !r.appliqueLe && !r.choixLe && maintenant - Date.parse(r.le) < 24 * 3600000);
}

/** Demandes terminées (ou de plus de 24 h) à appliquer à leur fiche. */
export function aAppliquer(recherches, maintenant = Date.now()) {
  return (recherches || []).filter((r) => r.but === 'verif' && r.articleId && !r.appliqueLe
    && (r.etat === 'fait' || maintenant - Date.parse(r.le) >= 24 * 3600000));
}

// =====================================================================
// v120 — Nom inconnu (« Mon nom tel quel ») : quand les bannières ont répondu
//  - rien trouvé → la fiche reste à ton nom, sans prix proposé (limite du système) ;
//  - UN produit dont le nom est exactement le tien (mêmes mots) → rattaché sans rien demander ;
//  - sinon → fenêtre « choisis dans la liste, ou garde ton nom sans référence ».
// =====================================================================

/** v140 — Demandes « générique » (fiche famille : son nom cherché chez les bannières) terminées, pas encore appliquées. */
export const generiquesPrets = (recherches, maintenant = Date.now()) => (recherches || []).filter((r) => r.but === 'generique' && r.articleId
  && !r.appliqueLe && (r.etat === 'fait' || maintenant - Date.parse(r.le) >= 24 * 3600000));

/** v162 — La dernière demande « nom » de cette fiche n'a rien trouvé (choix 'aucun') → cette demande, sinon null. */
export function rienTrouve(recherches, articleId) {
  const l = (recherches || []).filter((r) => r.but === 'nom' && r.articleId === articleId).sort((a, b) => (a.le < b.le ? 1 : -1));
  return l[0]?.choix === 'aucun' ? l[0] : null;
}

// Mots qui décrivent le produit sans le nommer : souvent absents des noms des sites (« Tortiglionis secs », « Cheddar jaune râpé »)
const DESCRIPTIFS = new Set(['sec', 'secs', 'seche', 'seches', 'frais', 'fraiche', 'fraiches', 'jaune', 'jaunes', 'blanc', 'blancs', 'blanche', 'blanches',
  'rape', 'rapee', 'rapes', 'rapees', 'hache', 'hachee', 'haches', 'hachees', 'tranche', 'tranchee', 'tranches', 'tranchees', 'mi-maigre', 'maigre',
  'moyen', 'moyenne', 'moyens', 'gros', 'grosse', 'grosses', 'petit', 'petite', 'petits', 'petites', 'fort', 'doux', 'douce', 'nature', 'entier', 'entiere',
  'cuit', 'cuite', 'cuits', 'cuites', 'cru', 'crue', 'crus', 'crues', 'surgele', 'surgeles', 'surgelee', 'surgelees']);
/** v162 — Noms à proposer quand rien n'est trouvé : sans les mots qui décrivent, au singulier, 2 au plus. */
export function nomsProposes(nom) {
  const motsNom = String(nom || '').trim().split(/\s+/).filter(Boolean);
  const simple = (m) => sansAcc(m).replace(/[^a-z-]/g, '');
  const sing = (m) => (m.length > 4 && /[sx]$/i.test(m) && !/ss$/i.test(m) ? m.slice(0, -1) : m);
  const sansDesc = motsNom.filter((m, i) => i === 0 || !DESCRIPTIFS.has(simple(m)));
  const cap = (t) => t.replace(/^./, (c) => c.toUpperCase());
  const cands = [sansDesc.map(sing).join(' '), sansDesc.join(' ')].map(cap);   // pas le 1er mot seul : « Lait de coco » ≠ « Lait »
  const vus = new Set([sansAcc(nom).trim()]);
  return cands.filter((c) => c.length >= 2 && !vus.has(sansAcc(c)) && vus.add(sansAcc(c))).slice(0, 3);
}

/** Demandes « nom » terminées dont le choix n'est pas encore fait. */
export const choixEnAttente = (recherches) => (recherches || []).filter((r) => r.but === 'nom' && r.articleId && r.etat === 'fait' && !r.choixLe);

/**
 * Décision automatique : { choix: 'aucun' } | { choix: 'auto', groupe } | { choix: 'generique', offres } | { choix: 'fenetre', groupes }.
 * v138 (demande de Chris, « tourtière ») : le nom écrit est un nom GÉNÉRIQUE, plusieurs variantes sont possibles.
 * - un seul produit pertinent → rattaché tel quel (auto) ;
 * - plusieurs produits qui SONT ce générique (le mot en tête) → la fiche garde ton nom, et chaque bannière
 *   donne son moins cher (au kg / L quand les formats le permettent) ;
 * - seulement des produits qui le CONTIENNENT (« crème glacée à la fraise » pour « fraise ») → fenêtre de choix.
 */
export function decisionNom(r, nomFiche) {
  const groupes = choixPresentes(r, nomFiche);
  if (!groupes.length) return { choix: 'aucun' };
  if (groupes.length === 1) return { choix: 'auto', groupe: groupes[0] };
  const offres = moinsCherParBanniere(r, nomFiche);
  if (offres.length) return { choix: 'generique', offres };
  return { choix: 'fenetre', groupes: groupes.slice(0, 8) };
}

/** Prix d'une fiche générique : un par bannière, chacun avec le produit et le format vraiment vendus (ajout seulement). */
export function prixGenerique(offres, articleId, jour = new Date().toISOString().slice(0, 10), nouvelId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  return offres.map((o) => ({
    id: nouvelId(o.banniere), articleId, banniere: o.banniere, offre: prixTexte(o.prix), prixNum: o.prix,
    prixRegulier: o.regulier && o.regulier > o.prix ? o.regulier : null,
    format: o.produit?.format ? formatLisible(o.produit.format) : null,
    type: o.regulier && o.regulier > o.prix ? 'circulaire' : 'regulier', fin: null,
    source: SOURCE, observeLe: jour, nomProduit: o.produit?.nom || '', url: o.produit?.url || null, image: o.produit?.image || null,
  }));
}

/** Unité de comparaison d'une fiche générique : kg ou L si tous les produits retenus le permettent, sinon à l'unité. */
export function uniteGenerique(offres) {
  const bases = new Set(offres.map((o) => analyserFormat(o.produit?.format || '')?.base || 'unite'));
  return bases.size === 1 ? [...bases][0] : 'unite';
}

/** Ce qui change dans ta fiche quand tu choisis un produit : nom, marque, format, photo… (le code-barres seulement s'il est sûr). */
export function completerFiche(fiche, g) {
  const f = ficheDuGroupe(g);
  return { nom: f.nom || fiche.nom, marque: f.marque || fiche.marque || '', format: f.format || fiche.format || '',
    uniteRef: f.uniteRef || fiche.uniteRef || 'unite', local: f.local || !!fiche.local,
    ...(f.imageUrl && !fiche.imageUrl ? { imageUrl: f.imageUrl } : {}),
    codes: [...new Set([...(fiche.codes || []), ...f.codes])] };
}
