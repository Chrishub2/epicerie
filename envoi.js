// =====================================================================
// Envoi vers la base par paquets, sans qu'un élément refusé bloque les autres.
// (Incident du 2026-11-16 : un seul prix refusé faisait échouer le paquet de 200 → plus aucune synchro.)
// Module pur : `envoyer(lot)` fait l'appel réseau et retourne l'erreur (ou null). Testable sans réseau.
// =====================================================================

/**
 * @param {Array<{_k: string}>} lignes      éléments à envoyer
 * @param {(lot) => Promise<object|null>} envoyer  retourne null si accepté ; une erreur sinon.
 *        Erreur avec `code` = refus de la base (règle, sécurité…) ; sans `code` = réseau.
 * @param {Set<string>} dejaRefuses         clés refusées au dernier envoi : essayées une à une, à part
 * @returns {Promise<Array<{k, erreur, quand}>>} les éléments refusés (le reste est passé)
 * @throws  l'erreur réseau : tout sera renvoyé plus tard, tel quel
 */
export async function envoyerParPaquets(lignes, envoyer, dejaRefuses = new Set(), taille = 200) {
  const suspects = lignes.filter((l) => dejaRefuses.has(l._k));
  const normaux = lignes.filter((l) => !dejaRefuses.has(l._k));
  for (let i = 0; i < normaux.length; i += taille) {
    const lot = normaux.slice(i, i + taille);
    const error = await envoyer(lot);
    if (!error) continue;
    if (!error.code) throw error;   // réseau
    suspects.push(...lot);          // refus dans ce paquet : on cherche lequel, un par un
  }
  const refuses = [];
  for (const l of suspects) {
    const error = await envoyer([l]);
    if (!error) continue;
    if (!error.code) throw error;
    refuses.push({ k: l._k, erreur: error.message, quand: new Date().toISOString() });
  }
  return refuses;
}

// ---------------------------------------------------------------------
// Lecture par paquets (v145). Incident du 2026-11-23 : l'extension écrit souvent des dizaines de prix à la
// MÊME heure ; l'ancienne synchro reprenait « après la dernière heure reçue », donc un paquet coupé au milieu
// d'un tel groupe faisait sauter le reste pour toujours. On reprend maintenant après (heure, type, id).
// ---------------------------------------------------------------------

/** Filtre PostgREST « après le curseur » : heure plus récente, ou même heure et (type, id) plus loin. */
export function filtreApres(c) {
  const q = (v) => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `maj.gt.${q(c.maj)},and(maj.eq.${q(c.maj)},type.gt.${q(c.type)}),and(maj.eq.${q(c.maj)},type.eq.${q(c.type)},id.gt.${q(c.id)})`;
}

/** Même ordre que la base : heure, puis type, puis id. */
export function apresCurseur(l, c) {
  if (!c) return true;
  if (l.maj !== c.maj) return l.maj > c.maj;
  if (l.type !== c.type) return l.type > c.type;
  return l.id > c.id;
}

/**
 * Lit tout ce qui suit `curseur`, paquet par paquet. `lire(curseur, taille)` fait l'appel réseau et
 * retourne { data, error } (lignes triées par heure, type, id). `surPaquet(lignes, curseur)` reçoit chaque paquet
 * et le curseur atteint. Retourne false si une lecture échoue (le curseur reste au dernier paquet réussi).
 */
export async function lireParPaquets(lire, curseur, surPaquet, taille = 1000) {
  let c = curseur;
  for (;;) {
    const { data, error } = await lire(c, taille);
    if (error) return false;
    if (!data?.length) return true;
    const d = data[data.length - 1];
    c = { maj: d.maj, type: d.type, id: d.id };
    surPaquet(data, c);
    if (data.length < taille) return true;
  }
}
