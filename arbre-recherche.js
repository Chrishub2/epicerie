// =====================================================================
// Recherche dans TA base, en arborescence (maquette recherche-niveaux-v2, accord de Chris 2026-11-22)
//
//   Niveau 1 = générique du référentiel v3 (« Lait »)
//   Niveau 2 = sorte de ce générique (« Lait 2 % »)
//   Niveau 3 = tes fiches (« Lactantia Lait partiellement écrémé 2 % · 4 L »)
//
// Seulement ce qui est déjà dans ta base : un générique ou une sorte n'apparaît que si au moins une de tes fiches
// y est rattachée (rattacher.js / correspondance.json). Aucune recherche en ligne ici.
// Module pur : les fonctions qui dépendent de l'app (famille d'une fiche, pertinence d'un nom) sont passées en paramètre.
// =====================================================================
import { slugSorte } from './rattacher.js';

const sansAcc = (t) => String(t || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Pertinence d'un nom pour le texte tapé : 3 = commence par, 2 = un mot commence par, 1 = contient, 0 = non. */
export function pertinenceTexte(nom, q) {
  const n = sansAcc(nom);
  if (!q || !n) return 0;
  if (n.startsWith(q)) return 3;
  if (n.split(/[^a-z0-9]+/).some((m) => m && m.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

/** Libellé d'une sorte à partir de son code (« 2 » → « 2 % », « non-sale » → « non salé ») grâce aux valeurs typiques du référentiel. */
export function libelleSorte(code, ligneRef) {
  if (!code) return '';
  const valeurs = String(ligneRef?.[4] || '').split(',').map((v) => v.trim()).filter(Boolean);
  return valeurs.find((v) => slugSorte(v) === code) || code.replace(/-/g, ' ');
}

/** Nom affiché d'un niveau 2 : « Lait » + « 2 % » → « Lait 2 % ». */
export const nomNiveau2 = (nomGen, libelle) => `${nomGen} ${libelle}`.trim();

/**
 * Arborescence pour le texte tapé.
 * @param articles  fiches de ta base (les fiches « génériques » créées par l'app sont reconnues par estGenerique)
 * @param texte     ce que Chris a tapé (sans la quantité)
 * @param o.famille (a) → { g, s } | null
 * @param o.referentiel { id: [catégorie, sous-catégorie, générique, attribut, valeurs typiques] }
 * @param o.alternatifs { id: { fr: [], en: [] } }
 * @param o.pertinenceFiche (a, texte) → nombre (0 = ne correspond pas)
 * @param o.poids (a) → nombre (achats, présence sur la liste) pour départager
 * @param o.max nombre maximum de rangées
 * @returns [{ niveau: 1|2|3, nom, g, s, articles: [fiches dessous], article?: fiche (niveau 3), generiqueId?: fiche générique existante }]
 */
export function construireArbre(articles, texte, o) {
  const q = sansAcc(texte);
  if (q.length < 2) return [];
  const ref = o.referentiel || {}, alt = o.alternatifs || {};
  const poids = o.poids || (() => 0);
  const max = o.max || 14;
  const fiches = (articles || []).filter((a) => !a.estGenerique);
  const generiques = (articles || []).filter((a) => a.estGenerique);
  const ficheGen = (g, s) => generiques.find((a) => a.generique === g && (a.sorte || null) === (s || null)) || null;

  // Regroupe tes fiches par générique, puis par sorte (null = sans sorte)
  const parGen = new Map();
  const orphelines = [];
  for (const a of fiches) {
    const f = o.famille(a);
    if (!f?.g || !ref[f.g]) { orphelines.push(a); continue; }
    if (!parGen.has(f.g)) parGen.set(f.g, new Map());
    const parSorte = parGen.get(f.g);
    const s = f.s || null;
    if (!parSorte.has(s)) parSorte.set(s, []);
    parSorte.get(s).push(a);
  }

  const pertGen = (g) => {
    const r = ref[g];
    return Math.max(pertinenceTexte(r[2], q), ...[...(alt[g]?.fr || []), ...(alt[g]?.en || [])].map((n) => pertinenceTexte(n, q) && 1.5));
  };
  const pertFiche = (a) => o.pertinenceFiche(a, texte) || 0;
  const tri = (x, y) => y.p - x.p || y.w - x.w || x.nom.localeCompare(y.nom, 'fr');

  const blocs = [];
  for (const [g, parSorte] of parGen) {
    const nomGen = ref[g][2];
    const pg = pertGen(g);
    const sortes = [];
    let meilleure = pg;
    for (const [s, liste] of parSorte) {
      const libelle = libelleSorte(s, ref[g]);
      const ps = s ? pertinenceTexte(nomNiveau2(nomGen, libelle), q) || pertinenceTexte(libelle, q) : 0;
      // Générique ou sorte touché : toutes ses fiches ; sinon, seulement les fiches qui correspondent
      const gardees = liste.map((a) => ({ a, p: pertFiche(a), w: poids(a), nom: a.nom }))
        .filter((x) => pg || ps || x.p > 0).sort(tri);
      if (!gardees.length) continue;
      const p = Math.max(ps, ...gardees.map((x) => x.p));
      meilleure = Math.max(meilleure, p);
      sortes.push({ s, libelle, p, w: gardees.reduce((t, x) => t + x.w, 0), nom: libelle, fiches: gardees.map((x) => x.a) });
    }
    if (!sortes.length) continue;
    sortes.sort((x, y) => (x.s === null) - (y.s === null) || tri(x, y));
    blocs.push({ g, nomGen, p: meilleure, gen: pg, w: sortes.reduce((t, x) => t + x.w, 0), nom: nomGen, sortes });
  }
  // Le générique dont le NOM correspond passe devant ceux qui ne sont là que par une de leurs fiches
  blocs.sort((x, y) => y.gen - x.gen || tri(x, y));

  const rangees = [];
  for (const b of blocs) {
    const tous = b.sortes.flatMap((x) => x.fiches);
    rangees.push({ niveau: 1, nom: b.nomGen, g: b.g, s: null, articles: tous, generiqueId: ficheGen(b.g, null)?.id || null });
    for (const so of b.sortes) {
      if (so.s) rangees.push({ niveau: 2, nom: nomNiveau2(b.nomGen, so.libelle), g: b.g, s: so.s, articles: so.fiches, generiqueId: ficheGen(b.g, so.s)?.id || null });
      for (const a of so.fiches) rangees.push({ niveau: 3, nom: a.nom, g: b.g, s: so.s, articles: [a], article: a, sousSorte: !!so.s });
    }
  }
  // Fiches sans famille du référentiel : niveau 3 seules, à la fin
  orphelines.map((a) => ({ a, p: pertFiche(a), w: poids(a), nom: a.nom })).filter((x) => x.p > 0).sort(tri)
    .forEach((x) => rangees.push({ niveau: 3, nom: x.a.nom, g: null, s: null, articles: [x.a], article: x.a, orpheline: true }));
  return rangees.slice(0, max);
}

/**
 * Fiche « générique » (niveau 1 ou 2) à mettre sur la liste : elle n'a pas de marque ; son prix est le moins cher
 * de ses fiches dessous (ui.js, offresArticle). Retourne la fiche à créer (sans l'ajouter à la base).
 */
export function nouvelleFicheGenerique(rangee, id) {
  const enfants = rangee.articles || [];
  const compte = (cle) => {
    const n = new Map();
    for (const a of enfants) if (a[cle]) n.set(a[cle], (n.get(a[cle]) || 0) + 1);
    return [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  };
  return { id, nom: rangee.nom, estGenerique: true, generique: rangee.g, sorte: rangee.s || null,
    rayonId: compte('rayonId'), uniteRef: compte('uniteRef') || 'unite', format: '', local: false, codes: [] };
}

/** Fiches dessous une fiche générique (mêmes générique et sorte ; toutes les sortes pour un niveau 1), dans la même unité. */
export function enfantsGenerique(gen, articles, famille) {
  return (articles || []).filter((a) => {
    if (a.estGenerique || a.id === gen.id) return false;
    const f = famille(a);
    return f?.g === gen.generique && (!gen.sorte || (f.s || null) === gen.sorte) && (a.uniteRef || 'unite') === (gen.uniteRef || 'unite');
  });
}
