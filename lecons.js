// =====================================================================
// v159 — L'IA des recettes apprend des corrections de Chris (maquette apprentissage-recettes-v1, 2026-11-25).
// Une leçon = { id, imprime (ligne imprimée), bon (bon nom à acheter), creeLe, utilisee }.
// Synchronisée avec le foyer (type « lecon »). Les plus récentes sont jointes à la consigne de lecture (lire-photo).
// Sans DOM : testé par tests/lecons.test.mjs.
// =====================================================================

export const MAX_POUR_IA = 40;

/** Clé de comparaison d'une ligne imprimée : sans accents, casse, espaces doublés ni puces. */
export function cleLigne(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^[\s•\-*–·]+/, '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Ajoute (ou remplace) la leçon pour cette ligne. Retourne la nouvelle liste (la plus récente en tête). */
export function ajouterLecon(lecons, imprime, bon, id, maintenant = new Date().toISOString()) {
  const cle = cleLigne(imprime);
  const b = String(bon || '').trim();
  if (!cle || !b) return lecons || [];
  const autres = (lecons || []).filter((l) => cleLigne(l.imprime) !== cle);
  return [{ id, imprime: String(imprime).trim(), bon: b, creeLe: maintenant, utilisee: 0 }, ...autres];
}

/** Les leçons à joindre à la lecture : les plus récentes d'abord, [{ imprime, bon }]. */
export function leconsPourIA(lecons, n = MAX_POUR_IA) {
  return [...(lecons || [])].sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)))
    .slice(0, n).map((l) => ({ imprime: l.imprime, bon: l.bon }));
}

/**
 * Ligne imprimée identique à une leçon → le bon nom remplace celui lu (ta correction gagne sur l'IA).
 * Retourne { ingredients, utilisees: [ids] } ; chaque ingrédient repris porte appris: true.
 */
export function appliquerLecons(ingredients, lecons) {
  const parCle = new Map((lecons || []).map((l) => [cleLigne(l.imprime), l]));
  const utilisees = [];
  const res = (ingredients || []).map((i) => {
    const l = parCle.get(cleLigne(i.brut));
    if (!l) return i;
    utilisees.push(l.id);
    return { ...i, nom: l.bon, appris: true };
  });
  return { ingredients: res, utilisees };
}
