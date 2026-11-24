// =====================================================================
// v151 — Plan d'achats (maquette journal/maquettes/plan-achats-v1.html, écran ①) : fonctions pures.
// - resumePlan : ce que la carte « Ton plan » affiche à partir d'un résultat d'optimiser() (comparer.js).
// - aRacheter : produits qui reviennent dans tes reçus à intervalle régulier (hypothèse, jamais avant 3 achats).
// - nombreEmballages : combien d'emballages prendre quand le format vendu diffère de ce que tu veux.
// =====================================================================
import { analyserFormat } from './normalise.js';

const jours = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const plusJours = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Résumé d'un plan : total, magasins (du plus gros montant au plus petit), articles sans prix, fraîcheur des prix,
 * économie sur les prix réguliers et rabais qui finissent bientôt.
 * @param r résultat d'optimiser (arrets, total, affect [{ l, a, choix: { cle, cout, offre } }])
 * @param lignes toutes les lignes à acheter [{ l, a }]
 * @param auj « AAAA-MM-JJ »
 */
export function resumePlan(r, lignes, auj) {
  if (!r) return null;
  const pris = new Set(r.affect.map((x) => x.l.id));
  const magasins = new Map();
  let economie = 0, recents = 0, moyens = 0, sansDate = 0, finBientot = 0;
  for (const x of r.affect) {
    const m = magasins.get(x.choix.cle) || { cle: x.choix.cle, n: 0, total: 0 };
    m.n++; m.total += x.choix.cout; magasins.set(x.choix.cle, m);
    const o = x.choix.offre;
    if (o.economie) economie += o.economie * (x.l.quantite || 1);
    if (o.age == null) sansDate++; else if (o.age <= 14) recents++; else moyens++;
    if (o.fin && jours(auj, String(o.fin).slice(0, 10)) <= 1 && jours(auj, String(o.fin).slice(0, 10)) >= 0) finBientot++;
  }
  return {
    arrets: r.arrets,
    total: r.total,
    magasins: [...magasins.values()].sort((a, b) => b.total - a.total),
    avecPrix: pris.size,
    nbLignes: lignes.length,
    sansPrix: lignes.filter((x) => !pris.has(x.l.id)).map((x) => x.a),
    economie, recents, moyens, sansDate, finBientot,
  };
}

/**
 * Produits à racheter bientôt, d'après les reçus et l'historique des achats (v152) : au moins `min` jours d'achat différents (règle du projet :
 * une prédiction est une hypothèse avec n, jamais avant 3 observations). Intervalle = médiane des écarts.
 * Retenu si le prochain achat probable tombe d'ici `horizon` jours et que le produit n'est pas déjà sur la liste.
 * → [{ articleId, n, intervalle, dernier, prochain }] du plus pressé au moins pressé.
 */
export function aRacheter(recus, liste, auj, { min = 3, horizon = 2, achats = [] } = {}) {
  const dates = new Map();
  for (const r of recus || []) {
    const d = String(r.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    for (const l of r.lignes || []) if (l.articleId) (dates.get(l.articleId) || dates.set(l.articleId, new Set()).get(l.articleId)).add(d);
  }
  // v152 : l'historique des achats (« Retirer les achetés ») compte aussi ; même jour qu'un reçu = un seul achat
  for (const x of achats || []) {
    const d = String(x.date || '').slice(0, 10);
    if (x.articleId && /^\d{4}-\d{2}-\d{2}$/.test(d)) (dates.get(x.articleId) || dates.set(x.articleId, new Set()).get(x.articleId)).add(d);
  }
  const surListe = new Set((liste || []).filter((l) => !l.coche).map((l) => l.articleId));
  const out = [];
  for (const [articleId, s] of dates) {
    if (s.size < min || surListe.has(articleId)) continue;
    const ds = [...s].sort();
    const ecarts = ds.slice(1).map((d, i) => jours(ds[i], d)).sort((a, b) => a - b);
    const intervalle = ecarts[Math.floor((ecarts.length - 1) / 2)];
    if (!(intervalle > 0)) continue;
    const dernier = ds.at(-1);
    const prochain = plusJours(dernier, intervalle);
    if (jours(auj, prochain) <= horizon) out.push({ articleId, n: ds.length, intervalle, dernier, prochain });
  }
  return out.sort((a, b) => a.prochain.localeCompare(b.prochain));
}

/**
 * Nombre d'emballages à prendre pour couvrir le besoin (comparer.js besoinDe) avec l'offre choisie.
 * besoin : nombre dans l'unité de la fiche (kg, L ou unités) ou { poids, base } ; null si on ne sait pas.
 * → { n, format } ou null (format vendu inconnu, ou unités différentes).
 */
export function nombreEmballages(besoin, offre, uniteRef) {
  if (besoin == null || !offre) return null;
  const f = analyserFormat(offre.formatVendu || offre.format);
  if (!f || !(f.total > 0)) return null;
  const voulu = typeof besoin === 'object' ? besoin.poids : besoin;
  const base = typeof besoin === 'object' ? besoin.base : uniteRef;
  if (f.base !== base || !(voulu > 0)) return null;
  return { n: Math.max(1, Math.ceil(voulu / f.total - 1e-6)), format: offre.formatVendu || offre.format };
}
