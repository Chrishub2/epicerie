// =====================================================================
// Spec du schéma v1.1 (journal/SPEC-schema-produits.md, S8 à S12) — règles pures, sans écran.
// - Meilleurs choix (S10) : trois classements indépendants (le moins cher de tous,
//   ta variante habituelle ★, le substitut accepté).
// - Remplacement accepté (S11) : par personne et par produit.
// - Caractéristiques (S8, S9) : attributs à la carte, valeurs du dictionnaire seulement.
// - Explication d'un lien de circulaire (S12) : une ligne, jamais de pourcentage.
// Tant que les « sortes » n'existent pas dans l'app, une marque/un format (variante) tient lieu de sorte.
// =====================================================================

export const REMPLACEMENTS = [
  { k: 'identique', nom: 'Identique seulement' },
  { k: 'marque', nom: 'Autre marque acceptée' },
  { k: 'sorte', nom: 'Autre sorte acceptée' },
  { k: 'toute', nom: 'Toute variante acceptée' },
];
export const REMPLACEMENT_DEFAUT = 'sorte';

/** Règle de remplacement de cette personne pour ce produit (défaut : autre sorte acceptée). */
export function remplacementDe(article, personne) {
  const r = article?.remplacement?.[personne || 'moi'];
  return REMPLACEMENTS.some((x) => x.k === r) ? r : REMPLACEMENT_DEFAUT;
}
/** Change la règle de cette personne ; le défaut n'est pas stocké. */
export function definirRemplacement(article, personne, regle) {
  if (!REMPLACEMENTS.some((x) => x.k === regle)) return;
  const cle = personne || 'moi';
  const r = { ...(article.remplacement || {}) };
  if (regle === REMPLACEMENT_DEFAUT) delete r[cle]; else r[cle] = regle;
  if (Object.keys(r).length) article.remplacement = r; else delete article.remplacement;
}

/**
 * Trois classements sur les offres d'un produit (lignes d'offresArticle : { pu, varianteId, … }).
 * prefId : la variante habituelle ★ ; une offre sans variante compte pour elle (c'est le format de la fiche).
 * variantes : [{ id, marque }] pour la règle « autre marque ».
 * Rend [{ libs: [...], offre|null, vide, ecart }] ; un même prix n'apparaît qu'une fois, avec plusieurs étiquettes.
 */
export function meilleursChoix(offres, { prefId = null, variantes = [], regle = REMPLACEMENT_DEFAUT } = {}) {
  const avec = (offres || []).filter((o) => o.pu != null).sort((a, b) => a.pu - b.pu);
  const estPref = (o) => !o.varianteId || o.varianteId === prefId;
  const marqueDe = (id) => (variantes.find((v) => v.id === id)?.marque || '').trim().toLowerCase();
  const marquePref = marqueDe(prefId);
  const tous = avec[0] || null;
  const pref = avec.find(estPref) || null;
  const subs = regle === 'identique' ? [] : avec.filter((o) => !estPref(o)
    && (regle !== 'marque' || marqueDe(o.varianteId) !== marquePref));
  const sub = subs[0] || null;
  const rangs = [];
  const ajouter = (o, lib, vide) => {
    if (!o) { rangs.push({ libs: [lib], offre: null, vide }); return; }
    const deja = rangs.find((r) => r.offre === o);
    if (deja) deja.libs.push(lib); else rangs.push({ libs: [lib], offre: o, vide: null });
  };
  ajouter(tous, 'Le moins cher de tous', 'Aucun prix');
  ajouter(pref, 'Ta variante habituelle ★', 'Aucun prix pour ta variante habituelle');
  ajouter(sub, 'Substitut accepté', regle === 'identique' ? 'Aucun : tu veux le même produit' : 'Aucun substitut avec un prix');
  for (const r of rangs) r.ecart = r.offre && tous && r.offre.pu > tous.pu + 1e-9 ? r.offre.pu - tous.pu : null;
  return rangs;
}

// --- Caractéristiques (attributs à la carte) ---------------------------------
const OUI_NON = ['oui', 'non', 'inconnu', 'non applicable'];
export const DICO_ATTRIBUTS = [
  { k: 'etat', nom: 'État', vals: ['frais', 'congelé', 'séché', 'en conserve', 'réfrigéré'] },
  { k: 'presentation', nom: 'Présentation', vals: ['entier', 'tranché', 'en morceaux', 'haché', 'râpé', 'désossé', 'avec os', 'individuel', 'grand contenant'] },
  { k: 'provenance', nom: 'Provenance', vals: ['Québec', 'Canada', 'importé', 'inconnu'] },
  { k: 'bio', nom: 'Biologique', vals: OUI_NON },
  { k: 'couleur', nom: 'Couleur', vals: ['rouge', 'vert', 'jaune', 'orange', 'mélangé'] },
  { k: 'calibre', nom: 'Calibre', vals: ['petit', 'moyen', 'gros', 'extra-gros'] },
  { k: 'intensite', nom: 'Intensité', vals: ['doux', 'moyen', 'fort', 'extra-fort'] },
  { k: 'coupe', nom: 'Coupe', vals: ['maigre', 'mi-maigre', 'extra-maigre'] },
  // Spec v1.3 (S15) : pas de « Matières grasses » — la teneur en gras change la comparaison, c'est donc la sorte du lait, pas une caractéristique
  { k: 'sans_gluten', nom: 'Sans gluten', vals: OUI_NON },
  { k: 'sans_lactose', nom: 'Sans lactose', vals: OUI_NON },
  { k: 'grade', nom: 'Grade', vals: ['Canada Fancy', 'Canada no 1', 'catégorie A'] },
];
export const attributDe = (k) => DICO_ATTRIBUTS.find((d) => d.k === k) || null;

/** Ajoute ou change une caractéristique ; refusée (false) si l'attribut ou la valeur n'est pas au dictionnaire. */
export function definirCaracteristique(article, k, valeur) {
  const a = attributDe(k);
  if (!a || !a.vals.includes(valeur)) return false;
  article.caracteristiques = { ...(article.caracteristiques || {}), [k]: valeur };
  return true;
}
export function retirerCaracteristique(article, k) {
  if (!article.caracteristiques) return;
  const c = { ...article.caracteristiques }; delete c[k];
  if (Object.keys(c).length) article.caracteristiques = c; else delete article.caracteristiques;
}
/**
 * Maquette lecteur v1 : caractéristiques lisibles avec le code-barres (Open Food Facts).
 * p = produit OFF (origins_tags, labels_tags), quebec = produit du Québec déjà détecté.
 * Rend [[clé, valeur], …] ; seulement ce qui est clairement écrit (jamais « non » deviné).
 */
export function caracteristiquesDuCode(p, quebec = false) {
  if (!p) return [];
  const simple = (l) => (l || []).join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const origines = simple(p.origins_tags), labels = simple(p.labels_tags);
  const out = [];
  if (quebec) out.push(['provenance', 'Québec']);
  else if (/canada/.test(origines)) out.push(['provenance', 'Canada']);
  else if (origines.trim()) out.push(['provenance', 'importé']);
  if (/gluten-free|no-gluten|sans-gluten/.test(labels)) out.push(['sans_gluten', 'oui']);
  if (/lactose-free|no-lactose|sans-lactose/.test(labels)) out.push(['sans_lactose', 'oui']);
  return out;
}

/** Caractéristiques valides seulement (une valeur hors dictionnaire est ignorée). */
export function caracteristiques(article) {
  return Object.entries(article?.caracteristiques || {})
    .filter(([k, v]) => attributDe(k)?.vals.includes(v))
    .map(([k, v]) => ({ k, nom: attributDe(k).nom, valeur: v }));
}

// --- Explication d'un lien de circulaire (S12) --------------------------------
const cle = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * Pourquoi l'agent a rattaché cette offre à ce produit, en une ligne.
 * lien : { format, n } (appris_circulaires) ; article : { nom, format, variantes }.
 */
export function raisonLien(lien, article) {
  if (!article) return 'Produit introuvable dans ton catalogue : à refuser';
  const morceaux = ['Nom reconnu'];
  const f = cle(lien?.format);
  if (f) {
    const formats = [article.format, ...(article.variantes || []).filter((v) => !v.retiree).map((v) => v.format)].map(cle).filter(Boolean);
    morceaux.push(formats.includes(f) ? `même format (${lien.format}) qu’un produit de la fiche` : `format ${lien.format}, absent de la fiche : vérifie`);
  } else morceaux.push('format non indiqué');
  if (lien?.n > 1) morceaux.push(`vu ${lien.n} fois`);
  return morceaux.join(' · ');
}
