// =====================================================================
// Noms de bannières pour les circulaires — UNE seule liste d'équivalences, partagée par :
//  - l'extension Flipp (copie identique extension-flipp/enseignes-circulaires.js, vérifiée par un test) ;
//  - l'agent d'envoi (agents/envoi_logique.py relit le bloc JSON ci-dessous) ;
//  - l'app (au besoin).
// But : « giant-tiger » → Tigre Géant, « president-s-choice » → Le Choix du Président, « Familiprix » → Familiprix Extra.
// Comparaison sans accents ni casse, en mots entiers ; l'équivalence la plus longue gagne
// (« Uniprix Santé » → uniprix_sante, pas uniprix). Les id et noms suivent SOURCES_CIRC (app/circulaires.js).
// Le bloc entre JSON-DEBUT et JSON-FIN doit rester du JSON valide (l'agent Python le lit tel quel).
// =====================================================================

export const ENSEIGNES = /* JSON-DEBUT */[
  { "id": "super_c", "nom": "Super C", "alias": ["super c"] },
  { "id": "maxi", "nom": "Maxi", "alias": ["maxi", "maxi et cie", "maxi cie"] },
  { "id": "choix_president", "nom": "Le Choix du Président", "alias": ["choix du president", "president s choice", "presidents choice"] },
  { "id": "iga", "nom": "IGA", "alias": ["iga", "iga extra"] },
  { "id": "metro", "nom": "Metro", "alias": ["metro", "metro plus"] },
  { "id": "walmart", "nom": "Walmart", "alias": ["walmart"] },
  { "id": "costco", "nom": "Costco", "alias": ["costco", "costco wholesale"] },
  { "id": "tigre_geant", "nom": "Tigre Géant", "alias": ["tigre geant", "giant tiger"] },
  { "id": "jean_coutu", "nom": "Jean Coutu", "alias": ["jean coutu"] },
  { "id": "uniprix", "nom": "Uniprix", "alias": ["uniprix"] },
  { "id": "uniprix_sante", "nom": "Uniprix Santé", "alias": ["uniprix sante"] },
  { "id": "familiprix_clinique", "nom": "Familiprix Clinique", "alias": ["familiprix clinique"] },
  { "id": "familiprix_extra", "nom": "Familiprix Extra", "alias": ["familiprix extra", "familiprix"] },
  { "id": "pharmaprix", "nom": "Pharmaprix", "alias": ["pharmaprix", "shoppers drug mart"] },
  { "id": "canadian_tire", "nom": "Canadian Tire", "alias": ["canadian tire"] },
  { "id": "provigo", "nom": "Provigo", "alias": ["provigo"] }
]/* JSON-FIN */;

/** « Président's Choice™ & Cie » → « president s choice et cie » (sans accents, minuscules, mots séparés par une espace). */
export function motsSimples(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' et ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Source d'une enseigne ou d'un nom de circulaire (« giant-tiger », « Metro Quebec », « Familiprix Extra Holiday… »).
 * → { id, nom } ou null. Mots entiers ; l'équivalence la plus longue gagne.
 */
export function sourceDe(texte, enseignes = ENSEIGNES) {
  const t = ` ${motsSimples(texte)} `;
  let meilleur = null, longueur = 0;
  for (const e of enseignes) {
    for (const a of [e.nom, ...(e.alias || [])]) {
      const m = motsSimples(a);
      if (m && t.includes(` ${m} `) && m.length > longueur) { meilleur = e; longueur = m.length; }
    }
  }
  return meilleur ? { id: meilleur.id, nom: meilleur.nom } : null;
}
