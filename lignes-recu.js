// =====================================================================
// Calculs sur les lignes d'un reçu (sans dépendance : testable avec node).
//
// 1) Rabais : selon l'enseigne, le montant imprimé d'un produit est déjà réduit
//    (le rabais n'est qu'une « économie » affichée) ou le rabais est une ligne
//    soustraite. On le déduit des totaux du reçu, pas d'une supposition.
// 2) Pesée : un produit pesé lu comme « quantité 1,325 » est 1,325 kg.
// =====================================================================

const TOLERANCE = 0.10; // $ entre la somme des lignes et le montant imprimé
const num = (x) => Number(x) || 0;

/** Ce que la somme des lignes doit donner : le sous-total imprimé, sinon le total moins les taxes. */
export function cibleLignes(r) {
  if (r?.sousTotal != null) return num(r.sousTotal);
  if (r?.total != null && (r.tps != null || r.tvq != null)) return Math.round((num(r.total) - num(r.tps) - num(r.tvq)) * 100) / 100;
  return null;
}

/**
 * Les prix lus incluent-ils déjà les rabais ?
 *  'net'  : somme des prix = montant imprimé → le rabais est seulement affiché (déjà déduit) ;
 *  'brut' : somme des prix − rabais = montant imprimé → le rabais est soustrait ;
 *  null   : aucun rabais, ou impossible de trancher.
 * Sans montant imprimé, on se fie à l'IA (rabaisDejaDeduit) si elle est unanime.
 */
export function modeRabais(r) {
  const lignes = r?.lignes || [];
  const avecRabais = lignes.filter((l) => num(l.rabais) > 0);
  if (!avecRabais.length) return null;
  const cible = cibleLignes(r);
  if (cible != null) {
    const somme = lignes.reduce((s, l) => s + num(l.prix), 0);
    const rabais = avecRabais.reduce((s, l) => s + num(l.rabais), 0);
    const net = Math.abs(somme - cible) <= TOLERANCE, brut = Math.abs(somme - rabais - cible) <= TOLERANCE;
    if (net && !brut) return 'net';
    if (brut && !net) return 'brut';
  }
  const avis = new Set(avecRabais.map((l) => l.rabaisDejaDeduit));
  if (avis.size === 1 && avis.has(true)) return 'net';
  if (avis.size === 1 && avis.has(false)) return 'brut';
  return null;
}

/** Montant réellement payé pour la ligne (toutes unités). Mode inconnu : le rabais est soustrait (comme avant). */
export function montantNet(l, mode) {
  return mode === 'net' ? num(l.prix) : num(l.prix) - num(l.rabais);
}

/**
 * Pesée de la ligne : { qte, unite: 'kg'|'lb', deduite } ou null.
 * Lue dans « poids » (« 0,754 kg @ 4,39 $/kg »), sinon déduite d'une quantité non entière (1,325 → kg).
 */
export function pesee(l) {
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|lb)\b/i.exec(String(l?.poids || ''));
  if (m) return { qte: Number(m[1].replace(',', '.')), unite: m[2].toLowerCase(), deduite: false };
  const q = Number(l?.quantite);
  if (isFinite(q) && q > 0 && !Number.isInteger(q)) return { qte: q, unite: 'kg', deduite: true };
  return null;
}

export const estPese = (l) => !!(l?.poids || pesee(l));

/** Nombre d'articles (pour la caisse) : une pesée compte pour 1. */
export const nbArticles = (l) => (estPese(l) ? 1 : num(l.quantite) || 1);

/** Prix payé d'un article (non pesé) : montant net ÷ quantité. */
export const prixParArticle = (l, mode) => montantNet(l, mode) / (num(l.quantite) || 1);

const virgule = (x) => x.toFixed(2).replace('.', ',');

// Lignes qui ne sont pas des produits : ni reliées au catalogue, ni comptées « non reliées ».
const NATURES = [
  ['consigne', /^\+?\s*(d[eé]p(?:[oô]t)?|consignes?)\b/i],              // « +DEP ALUM », « DÉPÔT », « CONSIGNE »
  ['consigne', /\bd[eé]p(?:[oô]t)?\s+(alum|pet|verre|plast|can|bout)/i],
  ['coupon', /^(coupons?|bon de r[eé]duction)\b/i],
  ['sac', /^sacs?\b|\bsacs? (plastique|r[eé]utilisables?|papier)\b/i],
  ['frais', /^([eé]co-?frais|frais (environnement|[eé]co|de service))\b/i],
];

/** Nature d'une ligne de reçu : 'consigne' | 'coupon' | 'sac' | 'frais' | 'produit'. */
export function natureLigne(l) {
  const t = String(l?.libelle || '').trim();
  for (const [n, re] of NATURES) if (re.test(t)) return n;
  return 'produit';
}

/** Consigne de chaque produit : { index du produit: montant } (au Québec, la consigne suit la boisson). */
export function consignes(lignes = []) {
  const out = {};
  let dernier = -1;
  lignes.forEach((l, i) => {
    const n = natureLigne(l);
    if (n === 'produit') dernier = i;
    else if (n === 'consigne' && dernier >= 0) out[dernier] = Math.round(((out[dernier] || 0) + num(l.prix)) * 100) / 100;
  });
  return out;
}

/**
 * Relecture d'un reçu : reporte sur les nouvelles lignes les associations faites à la main
 * (y compris « aucun produit »), en retrouvant chaque ligne par son libellé et son prix.
 * Une ancienne ligne ne sert qu'une fois (deux « OASIS JUS POMME » restent deux lignes).
 * Modifie `nouvelles` ; retourne le nombre d'associations reportées.
 */
export function reporterAssociations(anciennes = [], nouvelles = []) {
  const cle = (l) => `${String(l?.libelle || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${Math.round(num(l?.prix) * 100)}`;
  const dispo = new Map();
  for (const l of anciennes) if (l?.manuel) dispo.set(cle(l), [...(dispo.get(cle(l)) || []), l]);
  let n = 0;
  for (const l of nouvelles) {
    const a = dispo.get(cle(l))?.shift();
    if (!a) continue;
    l.articleId = a.articleId || null;
    l.manuel = true;
    if (a.varianteId) l.varianteId = a.varianteId; else delete l.varianteId;
    n++;
  }
  return n;
}

/** Liens jugés sûrs : fait à la main, code-barres, PLU, nom déjà confirmé chez cette bannière. */
export const LIENS_SURS = ['manuel', 'code', 'plu', 'alias']; // « liste » (IA), « base », « nom », « ancien » : à vérifier

/**
 * État d'une ligne pour l'écran du reçu :
 *  'ok' ✓ (lien sûr) · 'verifier' ! (lien deviné : liste lue par l'IA, ressemblance de nom, ou ancien lien sans source)
 *  'aucun' ✗ (aucune association) · 'hors' (consigne, coupon, sac, ou « aucun produit » choisi à la main).
 */
export function etatLigne(l) {
  if (l?.manuel) return l.articleId ? 'ok' : 'hors';
  if (natureLigne(l) !== 'produit') return 'hors';
  if (!l?.articleId) return 'aucun';
  return LIENS_SURS.includes(l.lien) ? 'ok' : 'verifier';
}

const motsDe = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((m) => m.length >= 3);

/** Part (0 à 1) des mots de `a` retrouvés dans `b`, en début de mot (« crack » ≈ « cracker »). */
export function ressemblance(a, b) {
  const ma = motsDe(a), mb = motsDe(b);
  if (!ma.length || !mb.length) return 0;
  return ma.filter((m) => mb.some((t) => m.startsWith(t) || t.startsWith(m))).length / ma.length;
}

/** Ressemblance dans les deux sens (la plus faible) : évite « Bar-b-q » ≈ « Cracker Barrel ». */
export const ressemblanceMutuelle = (a, b) => Math.min(ressemblance(a, b), ressemblance(b, a));

const texteLigne = (l) => `${l?.nomClair || ''} ${l?.libelle || ''} ${l?.marque || ''}`;
const memeLibelle = (a, b) => String(a?.libelle || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b?.libelle || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Lignes du reçu qui peuvent être ce produit (scanné ou photographié), de la plus probable à la moins probable :
 * [{ i, score }]. Une ligne déjà reliée à ce produit vaut 1 ; les lignes « hors produit » et les lignes ✓ d'un
 * autre produit sont écartées.
 */
export function candidatsLignes(lignes = [], { texte = '', articleId = null } = {}) {
  return lignes.map((l, i) => {
    const etat = etatLigne(l);
    if (etat === 'hors') return null;
    if (articleId && l.articleId === articleId) return { i, score: 1 };
    if (etat === 'ok') return null;
    const score = ressemblance(texte, texteLigne(l));
    return score >= 0.34 ? { i, score } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.i - b.i);
}

/**
 * Ligne choisie sans rien demander, seulement si elle se détache nettement (score ≥ 0,6 et 0,25 d'avance),
 * ou si les meilleures sont le même article imprimé deux fois (deux « OASIS JUS POMME »). Sinon null : on demande.
 */
export function choixEvident(c, lignes = []) {
  if (!c.length) return null;
  const [a, b] = c;
  if (a.score < 0.6) return null;
  if (!b || a.score - b.score >= 0.25 || memeLibelle(lignes[a.i], lignes[b.i])) return a.i;
  return null;
}

/** La ligne i et les lignes identiques du même reçu (même libellé, produit) : on les associe ensemble. */
export const lignesIdentiques = (lignes = [], i) => lignes.map((l, j) => j)
  .filter((j) => j === i || (memeLibelle(lignes[j], lignes[i]) && etatLigne(lignes[j]) !== 'hors'));

// ---------------------------------------------------------------------
// Recherche dans ta base : tout ce qu'elle sait de chaque fiche (nom, marque, variantes,
// noms des enseignes vus dans les prix, noms de reçus appris). Elle s'enrichit à chaque
// prix relevé, reçu associé ou code scanné.
// ---------------------------------------------------------------------
const MOTS_VIDES = new Set(['avec', 'pour', 'les', 'des', 'une', 'aux', 'sans', 'and', 'the', 'sur', 'par', 'paquet', 'format', 'emballage']);
const motsUtiles = (s) => motsDe(s).filter((m) => !MOTS_VIDES.has(m));
const pareil = (m, t) => m.startsWith(t) || t.startsWith(m);

/** Texte d'une fiche pour la recherche : nom, marque, variantes, liens, noms vus dans les prix, noms de reçus appris. */
export function texteFiche(a, nomsPrix = []) {
  const v = (a?.variantes || []).flatMap((x) => [x.marque, x.nom, ...(x.alias || []).map((y) => y.libelle)]);
  return [a?.nom, a?.marque, ...v, ...(a?.liens || []).map((l) => l.nom), ...nomsPrix].filter(Boolean).join(' ');
}

/** Prépare la recherche : fiches = [{ id, nom, texte }]. Les mots rares (marques, « Love Crunch ») pèsent plus que « fromage ». */
export function indexBase(fiches = []) {
  const docs = fiches.map((f) => ({ id: f.id, nom: f.nom || '', mots: [...new Set(motsUtiles(f.texte))] }));
  const df = new Map();
  docs.forEach((d) => d.mots.forEach((m) => df.set(m, (df.get(m) || 0) + 1)));
  return { docs, df, n: docs.length };
}

/**
 * Fiche de ta base qui correspond à une ligne de reçu (nom en clair + marque), ou null.
 * Retenue seulement si : score ≥ 0,75 (mots pondérés par leur rareté), au moins 2 mots retrouvés
 * (ou tout le nom de la fiche retrouvé), la marque imprimée retrouvée, et 0,15 d'avance sur la suivante.
 */
export function chercherDansBase(ligne, index) {
  if (!index?.n) return null;
  const requete = [...new Set(motsUtiles(`${ligne?.nomClair || ligne?.libelle || ''} ${ligne?.marque || ''}`))];
  if (!requete.length) return null;
  const marque = motsUtiles(ligne?.marque);
  const poids = requete.map((m) => {
    let d = 0;
    for (const [k, c] of index.df) if (pareil(m, k)) d = Math.max(d, c);
    return d ? 1 + Math.log(index.n / d) : 1; // mot inconnu de ta base : ne prouve rien, pèse peu
  });
  const total = poids.reduce((s, x) => s + x, 0);
  const notes = index.docs.map((d) => {
    const trouve = requete.map((m) => d.mots.some((t) => pareil(m, t)));
    const nb = trouve.filter(Boolean).length;
    const score = trouve.reduce((s, ok, k) => s + (ok ? poids[k] : 0), 0) / total;
    const nomFiche = motsUtiles(d.nom);
    const nomRetrouve = nomFiche.length > 0 && nomFiche.every((m) => requete.some((t) => pareil(m, t)));
    const marqueOk = !marque.length || marque.some((m) => d.mots.some((t) => pareil(m, t)));
    return { id: d.id, score, valide: marqueOk && (nb >= 2 || nomRetrouve) };
  }).filter((x) => x.valide && x.score > 0).sort((a, b) => b.score - a.score);
  const [a, b] = notes;
  if (!a || a.score < 0.75 || (b && a.score - b.score < 0.15)) return null;
  return { id: a.id, score: Math.round(a.score * 100) / 100 };
}

// ---------------------------------------------------------------------
// Historique d'achat d'un produit, tiré des reçus (une seule source : le reçu ; rien n'est recopié).
// ---------------------------------------------------------------------
/**
 * Achats d'un produit : une entrée par ligne de reçu reliée à ce produit, la plus récente d'abord.
 * { recuId, ligne, date, heure, banniere, magasin, transaction, libelle, varianteId, quantite, poids,
 *   paye (montant réellement payé), prixUnitaire (« 4,99 $ » ou « 2,14 $/kg »), economie, consigne, sur, verdict }
 */
export function achatsDuProduit(recus = [], articleId) {
  const out = [];
  for (const r of recus || []) {
    if (!r?.lignes?.length || !articleId) continue;
    const mode = modeRabais(r);
    const cons = consignes(r.lignes);
    r.lignes.forEach((l, i) => {
      if (l.articleId !== articleId || etatLigne(l) === 'hors') return;
      const p = pesee(l);
      out.push({
        recuId: r.id, ligne: i, date: r.date || String(r.cree || '').slice(0, 10) || null, heure: r.heure || null,
        banniere: r.banniere || null, magasin: r.magasin || null, transaction: r.transaction || null,
        libelle: l.libelle, varianteId: l.varianteId || null,
        quantite: p ? null : num(l.quantite) || 1, poids: p ? `${String(p.qte).replace('.', ',')} ${p.unite}` : null,
        paye: Math.round(montantNet(l, mode) * 100) / 100, prixUnitaire: offreLigne(l, mode),
        economie: num(l.rabais), consigne: cons[i] || 0, sur: etatLigne(l) === 'ok', verdict: l.verdict || null,
      });
    });
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.heure || '').localeCompare(String(a.heure || '')));
}

/**
 * Résumé des achats : nombre, total payé, dernière date, et intervalle moyen entre deux dates d'achat.
 * L'intervalle est une hypothèse, donnée seulement avec au moins 3 dates (n affiché).
 */
export function resumeAchats(achats = []) {
  const dates = [...new Set(achats.map((a) => a.date).filter(Boolean))].sort();
  const total = Math.round(achats.reduce((s, a) => s + num(a.paye), 0) * 100) / 100;
  let intervalle = null;
  if (dates.length >= 3) {
    const ecarts = dates.slice(1).map((d, k) => (Date.parse(d) - Date.parse(dates[k])) / 864e5);
    intervalle = Math.round(ecarts.reduce((s, x) => s + x, 0) / ecarts.length);
  }
  return { n: achats.length, nDates: dates.length, total, dernier: dates[dates.length - 1] || null, intervalle };
}

/** Prix payé en texte d'offre : « 4,99 $ » ou « 2,14 $/kg ». null si rien de payé. */
export function offreLigne(l, mode) {
  const taux = /(\d+[.,]\d{2})\s*\$?\s*\/\s*(kg|lb)/i.exec(l?.poids || '');
  if (taux && !num(l.rabais)) return `${taux[1].replace('.', ',')} $/${taux[2].toLowerCase()}`; // tarif imprimé, sans rabais
  const net = montantNet(l, mode);
  if (net <= 0) return null;
  const p = pesee(l);
  if (p?.qte > 0) return `${virgule(net / p.qte)} $/${p.unite}`;
  if (taux) return `${taux[1].replace('.', ',')} $/${taux[2].toLowerCase()}`;
  return `${virgule(prixParArticle(l, mode))} $`;
}
