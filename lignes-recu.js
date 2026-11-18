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
