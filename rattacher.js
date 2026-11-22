// =====================================================================
// Rattachement automatique d'une fiche au référentiel v3 (famille + sorte)
// Pour les fiches créées après la correspondance faite d'avance (visuels/correspondance.json) :
// le nom de la fiche est comparé aux 514 produits génériques du référentiel (visuels/referentiel.json).
// Règle « dans le doute, on ne rattache pas » : tous les mots du générique doivent être dans le nom,
// et si deux génériques différents arrivent à égalité, la fiche reste sans famille.
// =====================================================================

// Mots sans valeur pour reconnaître un produit (articles, prépositions, formats)
const VIDES = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'a', 'au', 'aux', 'en', 'et', 'pour', 'avec', 'un', 'une',
  'g', 'kg', 'mg', 'ml', 'l', 'lb', 'oz', 'un', 'x', 'paquet', 'pot', 'pots', 'sac', 'chacun', 'format']);

/** « Pâtes Œufs 2 % » → ['pate', 'oeuf'] : minuscules, sans accents, au singulier, sans chiffres ni mots vides. */
export function mots(t) {
  const s = String(t || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ');
  return s.split(' ').filter((m) => m && !/^\d/.test(m) && !VIDES.has(m)).map((m) => (m.length > 3 ? m.replace(/[sx]$/, '') : m));
}

/** Code de sorte sans accents, comme dans la correspondance (« Blé entier » → « ble-entier »). */
export const slugSorte = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9%]+/g, '-').replace(/%/g, '').replace(/^-+|-+$/g, '');

const contient = (sac, cherches) => cherches.length > 0 && cherches.every((m) => sac.has(m));

/**
 * Famille du référentiel pour un nom de fiche : { g: 'CAT-006-SC-01-P-003', s: 'ble-entier' | null } ou null (dans le doute).
 * generiques : { id: [catégorie, sous-catégorie, générique, attribut, valeurs typiques] } (referentiel.json).
 */
export function rattacher(nom, generiques) {
  const liste = mots(nom), sac = new Set(liste);
  if (!sac.size || !generiques) return null;
  const [h0, h1] = liste;   // mot principal : le premier du nom (« Pesto de basilic » est un pesto, pas du basilic)
  let meilleur = null, score = 0, egalite = false;
  for (const [id, r] of Object.entries(generiques)) {
    const m = mots(r[2]);
    if (!contient(sac, m)) continue;
    // Le générique commence par le mot principal ; un premier mot qui nomme la catégorie (« Pâtes spaghetti ») cède la place au suivant.
    const classe = new Set([...mots(r[0]), ...mots(r[1])]);
    const tetes = classe.has(h0) && h1 ? [h0, h1] : [h0];
    if (!tetes.includes(m[0])) continue;
    const sc = m.join(' ').length;   // le générique le plus précis gagne (« Riz basmati » avant « Riz »)
    if (sc > score) { meilleur = id; score = sc; egalite = false; } else if (sc === score && id !== meilleur) egalite = true;
  }
  if (!meilleur || egalite) return null;
  // Sorte : UNE valeur typique présente dans le nom (« non salé » l'emporte sur « salé » qu'il contient) ;
  // deux valeurs distinctes (« écrémé » et « 2 % ») → pas de sorte, dans le doute.
  const gen = new Set(mots(generiques[meilleur][2])), sacS = new Set(motsSorte(nom));
  const valeurs = String(generiques[meilleur][4] || '').split(/,(?!\d)|;/).map((v) => v.replace(/…|\.\.\./g, '').trim())
    .filter((v) => v && !/^selon\b/i.test(v));
  let trouvees = valeurs.map((v) => ({ v, m: motsSorte(v) })).filter((x) => x.m.length && x.m.every((w) => sacS.has(w)) && !x.m.every((w) => gen.has(w)));
  trouvees = trouvees.filter((x) => !trouvees.some((y) => y !== x && y.m.length > x.m.length && x.m.every((w) => y.m.includes(w))));
  return { g: meilleur, s: trouvees.length === 1 ? slugSorte(trouvees[0].v) : null };
}

const dejaVus = new Map();   // nom → résultat (null compris) : un nom non reconnu n'est pas recalculé à chaque rendu

/**
 * Fiches à relier : sans famille enregistrée (generique / generiqueNom), absentes de la correspondance faite d'avance,
 * et reconnues sans doute. Renvoie [{ id, g, s }] ; ne modifie rien.
 */
export function aRelier(articles, generiques, corr = {}) {
  if (!generiques) return [];
  const res = [];
  for (const a of articles || []) {
    if (!a?.id || !a.nom || a.generique || a.generiqueNom || corr[a.id]) continue;
    if (!dejaVus.has(a.nom)) dejaVus.set(a.nom, rattacher(a.nom, generiques));
    const r = dejaVus.get(a.nom);
    if (r) res.push({ id: a.id, ...r });
  }
  return res;
}

/** Inscrit la famille trouvée dans les fiches (même champs que la Console) ; familleAuto = date, pour la reconnaître. */
export function appliquerFamilles(articles, liens, jour = new Date().toISOString().slice(0, 10)) {
  const par = new Map(liens.map((l) => [l.id, l]));
  for (const a of articles || []) {
    const l = par.get(a.id);
    if (!l) continue;
    a.generique = l.g;
    if (l.s) a.sorte = l.s;
    a.familleAuto = jour;
  }
}

// Mots pour les sortes : comme mots(), mais « 2 % » et « 3,25 % » restent (→ « 2pc », « 3-25pc »)
function motsSorte(t) {
  const s = String(t || '').replace(/(\d+)[,.](\d+)\s*%/g, '$1-$2pc').replace(/(\d+)\s*%/g, '$1pc');
  return mots(s.replace(/(\d+)-(\d+)pc/g, 'p$1x$2pc').replace(/\b(\d+)pc/g, 'p$1pc'));
}
