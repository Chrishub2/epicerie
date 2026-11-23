// =====================================================================
// Rayon par défaut d'une fiche, d'après sa famille (produit générique du référentiel v3)
// Le référentiel dit CE QU'EST le produit ; le rayon dit OÙ il est. La table (visuels/rayons-par-defaut.json)
// donne un rayon par générique, validée par Chris le 23 nov. 2026 (journal/referentiel/rayons-valides.json).
// Règles : on ne range que les fiches encore dans « Divers » (ou dans un rayon disparu), jamais celles que
// Chris a classées à la main (rayonManuel) ; une famille trouvée automatiquement est revérifiée avant
// (« dans le doute, on ne range pas ») ; un rayon de la table absent du foyer est créé au premier besoin.
// Module pur : la famille et la vérification sont passées en paramètre.
// =====================================================================

export const cleRayon = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Id du rayon « Divers » du foyer (ou null). */
export function idDivers(rayons) { return (rayons || []).find((r) => cleRayon(r.nom) === 'divers')?.id || null; }

/**
 * Fiches à ranger : [{ id, rayon }] où rayon est le NOM du rayon de la table. Ne modifie rien.
 * @param famille (a) → { g } | null
 * @param verifier (a, g) → true si une famille trouvée automatiquement (a.familleAuto) est confirmée par le nom
 */
export function aRanger(articles, rayons, table, famille, verifier = () => true) {
  if (!table?.generiques || !table?.rayons) return [];
  const ids = new Set((rayons || []).map((r) => r.id)), divers = idDivers(rayons), res = [];
  for (const a of articles || []) {
    if (!a?.id || a.rayonManuel) continue;
    if (a.rayonId && ids.has(a.rayonId) && a.rayonId !== divers) continue;   // déjà rangée ailleurs : on n'y touche pas
    const f = famille(a);
    if (!f?.g) continue;
    if (a.familleAuto && a.generique === f.g && !verifier(a, f.g)) continue;
    const nom = table.rayons[table.generiques[f.g]];
    if (!nom || cleRayon(nom) === 'divers') continue;
    res.push({ id: a.id, rayon: nom });
  }
  return res;
}

/**
 * Applique le rangement dans l'état : crée les rayons manquants (par nom, sans tenir compte des accents),
 * puis range les fiches. rayonAuto = date, pour reconnaître (et défaire) un rangement automatique.
 * Renvoie le nombre de fiches rangées.
 */
export function appliquerRangement(e, liste, uid, jour = new Date().toISOString().slice(0, 10)) {
  if (!liste?.length) return 0;
  const parNom = new Map(e.rayons.map((r) => [cleRayon(r.nom), r.id]));
  const par = new Map(liste.map((l) => [l.id, l.rayon]));
  let n = 0;
  for (const a of e.articles) {
    const nom = par.get(a.id);
    if (!nom) continue;
    let id = parNom.get(cleRayon(nom));
    if (!id) { id = uid('r'); e.rayons.push({ id, nom }); parNom.set(cleRayon(nom), id); }
    a.rayonId = id; a.rayonAuto = jour; n++;
  }
  return n;
}
