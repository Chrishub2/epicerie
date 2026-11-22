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

/** Prix à ajouter à la fiche : un par bannière du groupe (ajout seulement, comme tous les prix).
 *  Chaque prix a son identifiant (sans lui, la synchro ne peut pas l'envoyer — corrigé en v118). */
export function prixDuGroupe(g, articleId, jour = new Date().toISOString().slice(0, 10), nouvelId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  return g.offres.map((o) => ({
    id: nouvelId(o.banniere), articleId, banniere: o.banniere, offre: prixTexte(o.prix), prixNum: o.prix,
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
    const p = memeProduit(fiche, res.produits, codes);
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
      observeLe: String(res.le || r.finiLe || r.le).slice(0, 10), nomProduit: p.nom, url: p.url || null,
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

/** Demandes « nom » terminées dont le choix n'est pas encore fait. */
export const choixEnAttente = (recherches) => (recherches || []).filter((r) => r.but === 'nom' && r.articleId && r.etat === 'fait' && !r.choixLe);

/** Décision automatique : { choix: 'aucun' } | { choix: 'auto', groupe } | { choix: 'fenetre', groupes }. */
export function decisionNom(r, nomFiche) {
  const groupes = regrouper(r).slice(0, 8);
  if (!groupes.length) return { choix: 'aucun' };
  const voulus = [...mots(nomFiche)].sort().join(' ');
  const exacts = groupes.filter((g) => {
    const f = ficheDuGroupe(g);
    return [...mots(`${f.marque} ${f.nom}`)].sort().join(' ') === voulus || [...mots(f.nom)].sort().join(' ') === voulus;
  });
  if (exacts.length === 1) return { choix: 'auto', groupe: exacts[0] };
  return { choix: 'fenetre', groupes };
}

/** Ce qui change dans ta fiche quand tu choisis un produit : nom, marque, format, photo… (le code-barres seulement s'il est sûr). */
export function completerFiche(fiche, g) {
  const f = ficheDuGroupe(g);
  return { nom: f.nom || fiche.nom, marque: f.marque || fiche.marque || '', format: f.format || fiche.format || '',
    uniteRef: f.uniteRef || fiche.uniteRef || 'unite', local: f.local || !!fiche.local,
    ...(f.imageUrl && !fiche.imageUrl ? { imageUrl: f.imageUrl } : {}),
    codes: [...new Set([...(fiche.codes || []), ...f.codes])] };
}
