// =====================================================================
// v152 — Bilan après l'achat (maquette journal/maquettes/plan-achats-v1.html, écran ③) : fonctions pures.
// Historique des achats : un objet « achat » (synchronisé, ajout seulement) par article retiré de la liste
// avec « Retirer les achetés » : { id, visite, date, banniere, articleId, varianteId?, nom, quantite, prixPrevu, economiePrevue }.
// - lignesAchat : les objets « achat » d'une visite.
// - bilanVisite : prévu (liste) ↔ payé et économisé (reçu de la même bannière, même jour ou le lendemain).
// - economiesMois : économies du mois — réelles d'après les reçus ; visites sans reçu : estimées (à part).
// =====================================================================

const jours = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const arr = (x) => Math.round(x * 100) / 100;

/** Clé d'une visite : une bannière, un jour. */
export const cleVisite = (banniere, date) => `${banniere}|${date}`;

/**
 * Objets « achat » pour les lignes retirées après une visite.
 * @param lignes [{ l, a, cout, economie }] (cout = coût prévu de la ligne, economie = rabais prévu × quantité)
 * @param uid générateur d'identifiants
 */
export function lignesAchat(lignes, banniere, date, uid) {
  const visite = cleVisite(banniere, date);
  return lignes.map(({ l, a, cout, economie }) => ({
    id: uid(), visite, date, banniere, articleId: a.id, ...(l.varianteId ? { varianteId: l.varianteId } : {}),
    nom: a.nom, quantite: l.quantite || 1,
    prixPrevu: cout != null ? arr(cout) : null, economiePrevue: economie ? arr(economie) : 0,
  }));
}

/**
 * Reçu de cette visite : même bannière, daté du jour de la visite, sinon de la veille ou du lendemain (« Retirer les
 * achetés » touché le lendemain) — mais jamais un reçu daté du jour d'une AUTRE visite de cette bannière.
 */
export function recuDeVisite(recus, banniere, date, autresDates = [], articleIds = null) {
  const pris = new Set(autresDates.filter((d) => d !== date));
  // v152 (vu en simulation) : le reçu doit contenir au moins un des articles de la visite (sinon c'est une autre visite)
  const commun = (r) => !articleIds || (r.lignes || []).some((l) => l.articleId && articleIds.has(l.articleId));
  return (recus || []).filter((r) => r.banniere === banniere && r.date && !pris.has(String(r.date).slice(0, 10))
    && Math.abs(jours(String(r.date).slice(0, 10), date)) <= 1 && commun(r))
    .sort((x, y) => Math.abs(jours(String(x.date).slice(0, 10), date)) - Math.abs(jours(String(y.date).slice(0, 10), date)))[0] || null;
}

/** Jours des visites enregistrées chez une bannière. */
const datesVisites = (achats, banniere) => [...new Set((achats || []).filter((x) => x.banniere === banniere).map((x) => x.date))];

/** Dernière visite enregistrée → { visite, banniere, date } ou null. */
export function derniereVisite(achats) {
  const a = (achats || []).filter((x) => x.visite && x.date).sort((x, y) => y.date.localeCompare(x.date) || String(y.id).localeCompare(String(x.id)))[0];
  return a ? { visite: a.visite, banniere: a.banniere, date: a.date } : null;
}

/**
 * Bilan d'une visite : nombre d'articles, prévu (somme des coûts prévus connus), économie prévue, reçu trouvé
 * (payé = total du reçu, tout compris ; économisé = rabais du reçu), articles prévus chez cette bannière pas achetés.
 */
export function bilanVisite(achats, recus, liste, { visite, banniere, date }) {
  const ici = (achats || []).filter((x) => x.visite === visite);
  const prevu = ici.reduce((t, x) => t + (x.prixPrevu || 0), 0);
  const sansPrix = ici.filter((x) => x.prixPrevu == null).length;
  const r = recuDeVisite(recus, banniere, date, datesVisites(achats, banniere), new Set(ici.map((x) => x.articleId)));
  const restants = (liste || []).filter((l) => !l.coche && (l.magasinCible === banniere)).map((l) => l.articleId);
  return {
    banniere, date, n: ici.length, prevu: arr(prevu), sansPrix,
    economiePrevue: arr(ici.reduce((t, x) => t + (x.economiePrevue || 0), 0)),
    recu: r ? { id: r.id, paye: Number(r.total) || null, economise: Number(r.economies) || 0, date: String(r.date).slice(0, 10) } : null,
    restants,
  };
}

/**
 * Économies d'un mois (« AAAA-MM ») : réelles d'après les reçus (champ economies), par bannière ;
 * plus les visites sans reçu, estimées d'après les rabais prévus (gardées à part, jamais mêlées au réel).
 */
export function economiesMois(recus, achats, mois) {
  const par = new Map();
  let reel = 0, nRecus = 0;
  const visitesAvecRecu = new Set();
  for (const r of recus || []) {
    const d = String(r.date || '').slice(0, 10);
    if (!d.startsWith(mois) || !(Number(r.economies) > 0) && !(Number(r.total) > 0)) continue;
    const e = Number(r.economies) || 0;
    reel += e; nRecus++;
    par.set(r.banniere, (par.get(r.banniere) || 0) + e);
  }
  for (const x of achats || []) {
    if (!x.date?.startsWith(mois) || visitesAvecRecu.has(x.visite)) continue;
    const ids = new Set((achats || []).filter((y) => y.visite === x.visite).map((y) => y.articleId));
    if (recuDeVisite(recus, x.banniere, x.date, datesVisites(achats, x.banniere), ids)) visitesAvecRecu.add(x.visite);
  }
  let estime = 0; const visitesEstimees = new Set();
  for (const x of achats || []) {
    if (!x.date?.startsWith(mois) || visitesAvecRecu.has(x.visite)) continue;
    estime += x.economiePrevue || 0; visitesEstimees.add(x.visite);
  }
  return {
    reel: arr(reel), nRecus, estime: arr(estime), nVisitesEstimees: visitesEstimees.size,
    parBanniere: [...par.entries()].map(([banniere, total]) => ({ banniere, total: arr(total) })).sort((a, b) => b.total - a.total),
  };
}
