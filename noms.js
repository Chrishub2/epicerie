// =====================================================================
// Noms des produits : singulier automatique et noms alternatifs (FR / EN).
// Décidé avec Chris le 2026-11-20 (maquette fiche produit v77-v79).
// Module PUR, sans dépendance : utilisable par l'app, la console et les tests.
//
// Champs lus sur une fiche (tous facultatifs sauf `nom`) :
//   nom        nom générique français (un seul)       ex. « Pomme »
//   nomEn      nom générique anglais (un seul)         ex. « Apple »
//   nomsAlt    noms alternatifs français (plusieurs)   ex. ["patate"] pour Pomme de terre
//   nomsAltEn  noms alternatifs anglais (plusieurs)
// =====================================================================

export const sansAccents = (s) => String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Mots qui finissent par s, x ou z mais sont déjà au singulier (sans accents : on compare après sansAccents)
const INVAR_FR = new Set(['ananas', 'mais', 'riz', 'noix', 'pois', 'radis', 'jus', 'anchois', 'cassis', 'fois', 'gras', 'bois', 'tapas',
  'couscous', 'hummus', 'houmous', 'nachos', 'chips', 'frais', 'gros', 'doux', 'roux', 'epais', 'anglais', 'francais', 'japonais',
  'chinois', 'pres', 'sous', 'sans', 'avec', 'dans', 'plus', 'tres', 'aux', 'nez', 'prix', 'croix', 'choix', 'souris', 'pastis', 'anis', 'colis', 'cheerios', 'doritos', 'oreos', 'flakes']);
const LIENS_FR = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'a', 'au', 'aux', 'en', 'et', 'ou', 'sans', 'avec', 'pour', 'sur']);

function singulierMotFr(m) {
  const b = sansAccents(m);
  if (b.length <= 3 || INVAR_FR.has(b) || LIENS_FR.has(b)) return m;
  const r = (n, s) => m.slice(0, m.length - n) + s;
  if (/[^o]us$/.test(b)) return m;            // malus, cactus, humus : déjà au singulier
  if (/eaux$/.test(b)) return r(1, '');        // poireaux → poireau, gâteaux → gâteau
  if (/(ou|eu)x$/.test(b)) return r(1, '');    // choux → chou
  if (/aux$/.test(b)) return r(3, 'al');       // végétaux → végétal
  if (/[^s]s$/.test(b)) return r(1, '');       // pommes → pomme
  return m;
}

const INVAR_EN = new Set(['hummus', 'asparagus', 'couscous', 'molasses', 'swiss', 'citrus', 'grits', 'oats', 'series', 'species', 'news',
  'chips', 'nachos', 'tapas', 'cress', 'bass', 'glass', 'grass', 'lettuce', 'rice', 'is', 'as', 'this', 'its', 'plus', 'gas', 'less', 'mixed', 'swiss']);
const LIENS_EN = new Set(['of', 'and', 'or', 'with', 'without', 'in', 'for', 'the', 'a', 'an']);

function singulierMotEn(m) {
  const b = m.toLowerCase();
  if (b.length <= 3 || INVAR_EN.has(b) || LIENS_EN.has(b)) return m;
  const r = (n, s) => m.slice(0, m.length - n) + s;
  if (/ies$/.test(b)) return r(3, 'y');                  // berries → berry
  if (/(loa|lea|hal|cal)ves$/.test(b)) return r(3, 'f'); // leaves → leaf
  if (/(o|ch|sh|x|ss)es$/.test(b)) return r(2, '');      // tomatoes → tomato, peaches → peach
  if (/[^s]s$/.test(b)) return r(1, '');                 // apples → apple
  return m;
}

/** Ramène un nom au singulier, mot par mot (« Pommes de terre » → « Pomme de terre »). langue : 'fr' (défaut) ou 'en'. */
export function singulier(nom, langue = 'fr') {
  const f = langue === 'en' ? singulierMotEn : singulierMotFr;
  let garderPluriel = false, premier = true;
  return String(nom ?? '').split(/(\s+|-|['’])/).map((m) => {
    if (!/^\p{L}+$/u.test(m)) return m;
    const b = sansAccents(m);
    // FR : le mot qui suit « aux / des / les » reste au pluriel (« gâteau aux carottes »)
    // EN : un mot avec majuscule après le premier est une marque ou un nom propre (« Multi Grain Cheerios »)
    const garder = garderPluriel || (langue === 'en' && !premier && /^\p{Lu}/u.test(m));
    garderPluriel = langue !== 'en' && ['aux', 'des', 'les'].includes(b);
    premier = false;
    return garder ? m : f(m);
  }).join('');
}

/** Clé de comparaison : minuscules, sans accents, au singulier. */
export const cleNom = (s, langue = 'fr') => sansAccents(singulier(s, langue));

/** Tous les noms d'une fiche, avec leur langue : générique FR d'abord. */
export function nomsArticle(a) {
  if (!a) return [];
  const l = (t, langue, principal = false) => (t ? [{ t: String(t), langue, principal }] : []);
  return [
    ...l(a.nom, 'fr', true),
    ...(a.nomsAlt || []).flatMap((t) => l(t, 'fr')),
    ...l(a.nomEn, 'en'),
    ...(a.nomsAltEn || []).flatMap((t) => l(t, 'en')),
  ];
}

/** Le texte tapé désigne-t-il exactement un des noms de la fiche (singulier, accents et casse ignorés) ? */
export function memeNom(a, texte) {
  const q = { fr: cleNom(texte, 'fr'), en: cleNom(texte, 'en') };
  return nomsArticle(a).some((x) => cleNom(x.t, x.langue) === q[x.langue]);
}

/**
 * Pertinence d'une fiche pour ce qui est tapé (0 = rien) :
 * 3 un nom commence par le texte (générique), 2,5 (nom alternatif), 2 un mot commence par le texte, 1 le texte est dedans.
 */
export function pertinenceNoms(a, texte) {
  const tape = sansAccents(texte);
  if (!tape) return 0;
  const qs = [...new Set([tape, cleNom(texte, 'fr'), cleNom(texte, 'en')])].filter(Boolean);
  let p = 0;
  for (const x of nomsArticle(a)) {
    const n = sansAccents(x.t), k = cleNom(x.t, x.langue);
    for (const q of qs) {
      if (n.startsWith(q) || k.startsWith(q)) p = Math.max(p, x.principal ? 3 : 2.5);
      else if (n.split(/[^a-z0-9]+/).some((m) => m.startsWith(q)) || k.split(/[^a-z0-9]+/).some((m) => m.startsWith(q))) p = Math.max(p, 2);
      else if (n.includes(q) || k.includes(q)) p = Math.max(p, 1);
    }
  }
  return p;
}

/** Ajoute des noms alternatifs : singulier, sans doublon, jamais le nom générique lui-même. Retourne la nouvelle liste. */
/** Marques connues d'une fiche : sa marque et celles de ses produits vendus (avec leur nom), sans les retirés. */
export function marquesArticle(a) {
  return [a?.marque, ...(a?.variantes || []).filter((v) => !v.retiree).flatMap((v) => [v.marque, v.nom])].filter(Boolean);
}
/** Recherche par nom de produit OU par marque : « tilda » trouve « Riz basmati blanc ». Texte vide = tout. */
export function trouveParNomOuMarque(a, texte) {
  const t = sansAccents(texte).trim();
  if (!t) return true;
  return pertinenceNoms(a, texte) > 0 || marquesArticle(a).some((m) => sansAccents(m).includes(t));
}
/** Texte de recherche d'une fiche (noms + marques), sans accents : pour filtrer une liste déjà affichée. */
export const texteRecherche = (a) => sansAccents([...nomsArticle(a).map((x) => x.t), ...marquesArticle(a)].join(' '));

export function ajouterNomsAlt(liste, texte, generique, langue = 'fr') {
  const out = [...(liste || [])];
  const gen = cleNom(generique, langue);
  for (const brut of String(texte || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const n = singulier(brut, langue);
    const k = cleNom(n, langue);
    if (k === gen || out.some((x) => cleNom(x, langue) === k)) continue;
    out.push(n);
  }
  return out;
}

/** Nom de produit qui dit « bio » (biologique, organic) : sert à ne jamais comparer le bio au non bio (spec S14). */
export function estNomBio(nom) {
  return /(^|[\s,·(\-])(bio|biologiques?|organic|organique)(?=$|[\s,·)\-])/i.test(String(nom || ''));
}
