// =====================================================================
// Lecture d'une ligne d'ingrédient de recette (sans DOM : testée par tests/ingredients.test.mjs)
// v157 (2026-11-25) : la quantité peut venir APRÈS le nom, comme dans les livres de Chris
//   (« Tortiglionis secs 500 ml (2 tasses) », « Maïs en crème 1 boîte de 540 ml ») ;
//   « Facultatif : » retiré du nom ; le format du magasin (« boîte de 540 ml ») gardé à part.
// =====================================================================

const UNITES = '(?:tasses?|t\\.|c\\.\\s?à\\s?(?:soupe|s\\.|thé|t\\.)|c\\.à\\.s\\.?|c\\.à\\.t\\.?|cuill(?:è|e)res?\\s+à\\s+(?:soupe|thé|café)|ml|l|cl|g|kg|lb|oz|gousses?|boîtes?|conserves?|pincées?|tranches?|paquets?|bottes?|feuilles?|sacs?|pots?|bouteilles?)';
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const NOMBRE = '(\\d+(?:[.,]\\d+)?(?:\\s+\\d/\\d)?|\\d/\\d)';
const CONTENANT = /^(?:boîtes?|conserves?|paquets?|sacs?|pots?|bouteilles?)$/i;
const MESURE = '\\d+(?:[.,]\\d+)?\\s*(?:ml|l|cl|g|kg|lb|oz)';

const nombre = (t) => t.trim().split(/\s+/)
  .reduce((s, p) => s + (p.includes('/') ? Number(p.split('/')[0]) / Number(p.split('/')[1]) : Number(p.replace(',', '.'))), 0);

/**
 * « 2 c. à soupe d'huile d'olive » → { quantite: 2, unite: 'c. à soupe', nom: "huile d'olive", format: '', facultatif: false, brut }
 * « Maïs en crème 1 boîte de 540 ml » → { quantite: 1, unite: 'boîte', nom: 'Maïs en crème', format: '540 ml', … }
 */
export function analyserIngredient(ligne) {
  let s = String(ligne || '').replace(/^\s*\d+[.)]\s+/, '') // numérotation « 1. » ou « 1) »
    .replace(/^[\s•\-*–·]+/, '').trim();
  if (!s) return null;
  let facultatif = false;
  s = s.replace(/^(?:facultatif|optionnel|au go[uû]t)\s*[:–-]\s*/i, () => { facultatif = true; return ''; });
  if (/\((?:facultatif|optionnel)\)/i.test(s)) facultatif = true;
  for (const [f, v] of Object.entries(FRACTIONS)) s = s.replaceAll(f, ` ${v}`);
  s = s.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();   // équivalences « (2 tasses) », « (facultatif) »
  if (!s) return null;
  // ① Quantité AVANT le nom. L'unité doit être un mot complet (« g » ne doit pas avaler « gousses »).
  const avant = s.match(new RegExp(`^${NOMBRE}\\s*(${UNITES}(?![a-zà-ÿ]))?\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'));
  if (avant?.[1]) {
    return { quantite: nombre(avant[1]), unite: avant[2]?.trim() || '', nom: nettoyerNom(avant[3]), format: '', facultatif, brut: String(ligne).trim() };
  }
  // ② Quantité APRÈS le nom : « Cari 10 ml », « Lait de coco 0.5 boîte de 400 ml »
  const apres = s.match(new RegExp(`^(.*?[a-zà-ÿ’'])\\s+${NOMBRE}\\s*(${UNITES}(?![a-zà-ÿ]))?(?:\\s+(?:de|d['’])\\s*(${MESURE}))?\\s*$`, 'i'));
  if (apres) {
    const unite = apres[3]?.trim() || '';
    return { quantite: nombre(apres[2]), unite, nom: nettoyerNom(apres[1]),
      format: apres[4] ? apres[4].replace(/\s+/g, ' ') : '', facultatif, brut: String(ligne).trim() };
  }
  return { quantite: null, unite: '', nom: nettoyerNom(s), format: '', facultatif, brut: String(ligne).trim() };
}

/** Garde l'aliment : sans ce qui suit la virgule (« oignon, haché » → « oignon »). */
function nettoyerNom(n) {
  return String(n || '').split(',')[0].replace(/\s+/g, ' ').trim();
}

/**
 * v160 — Tous les mots de la fiche (3 lettres et plus) sont des MOTS ENTIERS de l'ingrédient (pluriel accepté).
 * Avant : simple « contient », et « Bœuf haché » tombait sur la fiche « Œufs » (« bœuf » contient « œuf »).
 */
export function motsContenus(nomFiche, nomIngredient) {
  const mots = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe')
    .split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.replace(/(?<=..)[sx]$/, ''));
  const ing = new Set(mots(nomIngredient));
  const fiche = mots(nomFiche).filter((w) => w.length > 2);
  return fiche.length > 0 && fiche.every((w) => ing.has(w));
}

/** Unité qui est un contenant du magasin (boîte, paquet…) : utile pour la quantité à acheter. */
export const estContenant = (u) => CONTENANT.test(String(u || '').trim());

/** Assez de lettres pour être du vrai texte (et pas « — ä ÿ »). */
export function lisible(l) {
  const lettres = (l.match(/[a-zà-ÿ]/gi) || []).length;
  return lettres >= 3 && lettres / l.replace(/\s/g, '').length >= 0.6;
}

const MOTS_PREPARATION = /minute|portion|pr[ée]paration|cuisson|cuire|chauff|m[ée]lang|ajouter|incorpor|servir|r[ée]server|[ée]tape|four\b|po[êe]le|feu (doux|moyen|vif)|jusqu|pendant|remuer|verser|égoutter|egoutter|fondu/i;
const UNITE_RECETTE = /\b(\d|½|¼|¾)|\b(tasses?|c\.|cuill|ml|g|kg|lb|oz|gousses?|bo[îi]tes?|pinc[ée]es?|tranches?|paquets?|bottes?|feuilles?)\b/i;

/** Ligne qui ressemble à un ingrédient (pas une instruction, pas du charabia). */
export function ligneIngredient(l) {
  const t = l.replace(/^[\s•\-*–·]+/, '').trim();
  if (t.length < 3 || t.length > 60 || !lisible(t)) return false;
  if (/^ingr[ée]dients?|^pr[ée]paration/i.test(t)) return false;
  if (MOTS_PREPARATION.test(t)) return false;
  return UNITE_RECETTE.test(t) || t.split(/\s+/).length <= 4;
}

/**
 * v157 — Ce que l'IA a lu (nom, quantité, unité, facultatif, format) remplace la relecture maison, ligne par ligne.
 * lus : [{ texte, nom, quantite, unite, facultatif?, format_magasin? }]. Une ligne retouchée à la main n'a plus de
 * correspondance exacte : elle est relue par analyserIngredient.
 */
export function ingredientsDuTexte(texte, lus = []) {
  const parTexte = new Map(lus.filter((x) => x && x.texte && x.nom).map((x) => [x.texte.trim(), x]));
  return String(texte || '').split('\n').map((ligne) => {
    const ia = parTexte.get(ligne.trim());
    if (!ia) return analyserIngredient(ligne);
    const nom = nettoyerNom(String(ia.nom).replace(/^(?:facultatif|optionnel)\s*[:–-]\s*/i, ''));
    if (!nom) return analyserIngredient(ligne);
    return { quantite: ia.quantite ?? null, unite: ia.unite || '', nom, format: ia.format_magasin || '',
      facultatif: !!ia.facultatif, brut: ligne.trim() };
  }).filter(Boolean);
}
