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
