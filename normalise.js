// =====================================================================
// Moteur de normalisation des prix — Épicerie
// Ramène tout prix affiché (« 2/5 $ », « 1,99 $/lb », « 12 x 355 mL »…)
// à une unité de référence : $/kg, $/L ou $/unité.
// Fonctions pures, sans dépendance : utilisées par l'app ET par les tests.
// =====================================================================

const LB_EN_KG = 0.45359237;
const OZ_EN_G = 28.349523125;

// Facteurs vers l'unité de base (kg, l, unite).
const UNITES = {
  // masse → kg
  mg: ['kg', 1e-6], g: ['kg', 0.001], gr: ['kg', 0.001], kg: ['kg', 1],
  lb: ['kg', LB_EN_KG], lbs: ['kg', LB_EN_KG], livre: ['kg', LB_EN_KG], livres: ['kg', LB_EN_KG],
  oz: ['kg', OZ_EN_G / 1000],
  '100g': ['kg', 0.1], '100 g': ['kg', 0.1],
  // volume → l
  ml: ['l', 0.001], cl: ['l', 0.01], dl: ['l', 0.1], l: ['l', 1], litre: ['l', 1], litres: ['l', 1],
  '100ml': ['l', 0.1], '100 ml': ['l', 0.1],
  // comptes → unite
  un: ['unite', 1], unite: ['unite', 1], unité: ['unite', 1], unités: ['unite', 1], unites: ['unite', 1],
  ch: ['unite', 1], 'ch.': ['unite', 1], chacun: ['unite', 1], pqt: ['unite', 1], paquet: ['unite', 1],
  rouleau: ['unite', 1], rouleaux: ['unite', 1], brassée: ['unite', 1], brassées: ['unite', 1],
  sachet: ['unite', 1], sachets: ['unite', 1], capsule: ['unite', 1], capsules: ['unite', 1],
  oeuf: ['unite', 1], oeufs: ['unite', 1], œuf: ['unite', 1], œufs: ['unite', 1],
  douzaine: ['unite', 12], dz: ['unite', 12],
};

/** Convertit « 4,99 » ou « 4.99 » en nombre. */
export function nombre(txt) {
  if (txt == null) return NaN;
  return parseFloat(String(txt).replace(/\s/g, '').replace(',', '.'));
}

function cleUnite(u) {
  return String(u || '').trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
}

/** Infos d'une unité : { base: 'kg'|'l'|'unite', facteur } ou null. */
export function infoUnite(u) {
  const k = cleUnite(u);
  const v = UNITES[k] ?? UNITES[k.replace(/\s/g, '')];
  return v ? { base: v[0], facteur: v[1] } : null;
}

/**
 * Analyse un format de produit.
 * « 454 g », « 4 L », « 12 x 355 mL », « 6 × 100 g », « 24 rouleaux », « 1,36 kg »
 * → { quantite, base, total (dans l'unité de base) }
 */
export function analyserFormat(txt) {
  if (!txt) return null;
  const s = String(txt).toLowerCase().replace(/×/g, 'x').replace(/,/g, '.').trim();
  // Multipack : « 12 x 355 ml »
  let m = s.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*([a-zéèœ.]+)$/i);
  if (m) {
    const n = +m[1], q = +m[2], info = infoUnite(m[3]);
    if (!info) return null;
    return { quantite: n * q, unite: m[3], base: info.base, total: n * q * info.facteur, nbUnites: n };
  }
  m = s.match(/^(\d+(?:\.\d+)?)\s*([a-zéèœ. ]+)$/i);
  if (m) {
    const q = +m[1], info = infoUnite(m[2]);
    if (!info) return null;
    return { quantite: q, unite: m[2].trim(), base: info.base, total: q * info.facteur };
  }
  return null;
}

/**
 * Analyse le texte d'une offre.
 * « 2/5 $ », « 2 pour 5,00 $ », « 3 / 10$ », « 4,99 $ », « 4,99 $ ch. »,
 * « 1,99 $/lb », « 4,39 $ / kg », « 0,99 $/100 g »
 * → { prix, quantite, parUnite?: { base, facteur } }
 *   prix = montant payé pour `quantite` articles, ou par unité de poids/volume si parUnite.
 */
export function analyserOffre(txt) {
  if (txt == null) return null;
  const s = String(txt).toLowerCase().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  // « N pour X $ » ou « N/X $ »
  let m = s.match(/^(\d+)\s*(?:pour|\/)\s*(\d+(?:[.,]\d+)?)\s*\$?$/);
  if (m) return { prix: nombre(m[2]), quantite: +m[1] };

  // « X $/lb », « X $ / 100 g », « X$/kg »
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*\$\s*\/\s*([0-9]*\s*[a-zéèœ.]+)$/);
  if (m) {
    const info = infoUnite(m[2]);
    if (info) return { prix: nombre(m[1]), quantite: 1, parUnite: info };
    return null;
  }

  // « X $ », « X $ ch. », « X $ chacun »
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*\$\s*(ch\.?|chacun|l'unité|unité)?$/);
  if (m) return { prix: nombre(m[1]), quantite: 1 };

  // « $X » (format anglais)
  m = s.match(/^\$\s*(\d+(?:[.,]\d+)?)$/);
  if (m) return { prix: nombre(m[1]), quantite: 1 };

  return null;
}

/**
 * Prix normalisé.
 * @param {string} offre  texte de l'offre (ou nombre)
 * @param {string} format format du produit (« 454 g »), optionnel si l'offre est au poids
 * @param {string} uniteRef 'kg' | 'l' | 'unite' (celle de l'article)
 * @returns {{ prixUnitaire, uniteRef, prixArticle } | { erreur }}
 */
export function normaliser(offre, format, uniteRef) {
  const o = typeof offre === 'number' ? { prix: offre, quantite: 1 } : analyserOffre(offre);
  if (!o || !isFinite(o.prix)) return { erreur: `Offre illisible : « ${offre} »` };

  // Offre au poids / volume : « 1,99 $/lb »
  if (o.parUnite) {
    const base = o.parUnite.base;
    if (uniteRef && uniteRef !== base) {
      // ex. bananes à 0,79 $/lb mais comparées à l'unité → besoin du poids moyen
      const f = analyserFormat(format);
      if (uniteRef === 'unite' && f && f.base === base) {
        const prixUnite = (o.prix / o.parUnite.facteur) * f.total;
        return { prixUnitaire: arrondi(prixUnite), uniteRef: 'unite', prixArticle: arrondi(prixUnite) };
      }
      return { erreur: `Unités incompatibles : offre en ${base}, article en ${uniteRef}` };
    }
    const pu = o.prix / o.parUnite.facteur;
    const f = analyserFormat(format);
    const prixArticle = f && f.base === base ? pu * f.total : null;
    return { prixUnitaire: arrondi(pu), uniteRef: base, prixArticle: prixArticle == null ? null : arrondi(prixArticle) };
  }

  const prixArticle = o.prix / o.quantite; // « 2/5 $ » → 2,50 $ l'article
  const f = analyserFormat(format);
  const ref = uniteRef || (f ? f.base : 'unite');

  if (ref === 'unite') {
    // Format compté (« 12 œufs », « 24 rouleaux ») → prix par unité ; sinon prix par article.
    const n = f && f.base === 'unite' ? f.total : (f && f.nbUnites) || 1;
    return { prixUnitaire: arrondi(prixArticle / n), uniteRef: 'unite', prixArticle: arrondi(prixArticle) };
  }
  if (!f) return { erreur: `Format manquant pour calculer le prix au ${ref}` };
  if (f.base !== ref) return { erreur: `Format en ${f.base}, article comparé en ${ref}` };
  return { prixUnitaire: arrondi(prixArticle / f.total), uniteRef: ref, prixArticle: arrondi(prixArticle) };
}

function arrondi(x) { return Math.round(x * 10000) / 10000; }

/** Libellé lisible : « 9,98 $/kg (0,998 $/100 g) » */
export function libelleUnitaire(pu, uniteRef) {
  if (pu == null || !isFinite(pu)) return '—';
  const f = (x, d = 2) => x.toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (uniteRef === 'kg') return `${f(pu)} $/kg · ${f(pu / 10, 3)} $/100 g`;
  if (uniteRef === 'l') return `${f(pu)} $/L · ${f(pu / 10, 3)} $/100 mL`;
  return `${f(pu, pu < 1 ? 3 : 2)} $/unité`;
}

/**
 * Rabais personnel en pourcentage avec plafond d'achat.
 * Ex. 10 % sur les premiers 150 $ : panier de 200 $ → 15 $ de rabais.
 */
export function rabaisPerso(totalPanier, pct, plafond) {
  const base = plafond ? Math.min(totalPanier, plafond) : totalPanier;
  return Math.round(base * pct) / 100;
}

/** Couleur de comparaison : 'meilleur' | 'proche' (≤ seuil %) | 'autre'. */
export function classer(prix, meilleur, seuilPct = 5) {
  if (prix == null || meilleur == null) return 'autre';
  if (Math.abs(prix - meilleur) < 1e-9) return 'meilleur';
  return (prix - meilleur) / meilleur * 100 <= seuilPct ? 'proche' : 'autre';
}
