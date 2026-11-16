// =====================================================================
// Console — recherche automatique (sources gratuites, sans IA) : épiceries.ca + Open Food Facts.
// Pour un produit incomplet, trouve des candidats et en tire des PROPOSITIONS (format, marque,
// photo, code-barres, rayon, lien de prix) avec une confiance. Rien n'est appliqué ici :
// la console les montre et Chris choisit.
// Politesse envers les sources : appels l'un après l'autre, pauses, Open Food Facts ≤ 8 recherches / minute.
// =====================================================================
import { analyserFormat, formatLisible, gtinValide } from '../normalise.js';
import { memeFormat } from '../produits.js';

const API_EC = 'https://epiceries.ca/api';
const PAUSE_EC = 400;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'a', 'au', 'aux', 'et', 'en', 'l', 'd', 'pour', 'avec', 'sans']);
const mots = (s) => sansAccents(s).replace(/\d+([.,]\d+)?\s*(x\s*\d+\s*)?(kg|g|mg|ml|l|lb|oz|un)?\b/g, ' ')
  .replace(/[^a-z0-9%]+/g, ' ').split(' ').filter((m) => m.length > 1 && !MOTS_VIDES.has(m));

async function appelEC(params) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${API_EC}?${new URLSearchParams(params)}`, { signal: ctrl.signal });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error?.message || 'épiceries.ca');
    return j.data;
  } finally { clearTimeout(minuterie); }
}

// Catégories épiceries.ca → nos rayons. COPIE de app/epiceries.js (REGLES_RAYON) : garder les deux pareilles.
const REGLES_RAYON = [
  [/surgel|crème glacée/i, 'Surgelés'],
  [/légume|legume|fruit(?!s de mer)|salade|fines herbes|noix/i, 'Fruits et légumes'],
  [/poulet|dinde|boeuf|bœuf|porc|jambon|bacon|saucisse|viande|poisson|fruits de mer|substituts de viande/i, 'Viandes et poissons'],
  [/biscuit|craquelin|croustille|chips|bonbon|chocolat/i, 'Collations et biscuits'],
  [/soins|hygi|beauté|bébé|bebe/i, 'Hygiène et pharmacie'],
  [/ménager|menager|détergent|detergent|lessive|vaisselle/i, "Produits d'entretien"],
  [/lait|crème|creme|oeuf|œuf|beurre|fromage|yogourt|^désserts|trempette/i, 'Produits laitiers et œufs'],
  [/pain|bagel|croissant|muffins anglais|tortilla|gâteau/i, 'Boulangerie'],
  [/céréale|cereale|déjeuner|dejeuner|miel|sirop|tartinade/i, 'Céréales et déjeuner'],
  [/\bjus\b|café|cafe|\bthés?\b|boisson|\beaux?\b|bière|\bvins?\b/i, 'Boissons'],
  [/pâte|nouille|riz|couscous|haricot|lentille|conserve|cuisson|mets|huile|vinaigre|condiment|sauce|épice|assaisonnement|soupe/i, 'Épicerie (conserves, pâtes, riz)'],
];
let categories = null;
async function nomCategorie(id) {
  if (!id) return null;
  if (!categories) {
    try { categories = JSON.parse(localStorage.getItem('ec-categories') || 'null'); } catch { categories = null; }
    if (!categories) {
      try { const d = await appelEC({ endpoint: 'categories' }); categories = Object.fromEntries(d.categories.map((c) => [c.id, c.name])); } catch { categories = {}; }
      try { localStorage.setItem('ec-categories', JSON.stringify(categories)); } catch { /* plein */ }
    }
  }
  return categories[id] || null;
}
function rayonPour(nomCat, rayons) {
  if (!nomCat) return null;
  for (const [re, nom] of REGLES_RAYON) if (re.test(nomCat)) return rayons.find((r) => r.nom === nom) || null;
  return null;
}

/**
 * Ressemblance 0..1 entre le produit et un candidat : mots en commun / tous les mots (des deux côtés),
 * la marque du candidat ne compte pas comme mot « en trop ». Bonus si même marque ou même format.
 * Ex. « Pennes » vs « Pennes biologiques » = 0,5 (un mot de plus = un autre produit possible).
 */
function score(a, nom, marque, taille) {
  const marqueMots = new Set(mots(marque));
  const ma = new Set(mots(a.nom).filter((m) => !marqueMots.has(m) || !a.marque));
  const mc = new Set(mots(nom).filter((m) => !marqueMots.has(m)));
  if (!ma.size || !mc.size) return 0;
  const communs = [...ma].filter((m) => mc.has(m) || marqueMots.has(m)).length;
  const union = new Set([...ma, ...mc]).size;
  let s = communs / union;
  if (a.marque && marque && sansAccents(marque).includes(sansAccents(a.marque))) s += 0.15;
  if (a.format && taille && memeFormat(a.format, taille)) s += 0.15;
  return Math.max(0, Math.min(0.95, Math.round(s * 100) / 100));
}

/** Format écrit dans le nom (« Pennes de 400 g », « Jus 1,75 L ») : la source la plus sûre. */
export function formatDansLeNom(nom) {
  const m = String(nom || '').match(/(\d+\s*x\s*)?\d+([.,]\d+)?\s*(kg|g|mg|ml|l|lb|oz)(?![a-zà-ÿ])/i);
  return m && analyserFormat(m[0]) ? formatLisible(m[0]) : null;
}

/** Requêtes de plus en plus larges : nom complet, sans format, premier mot. */
function requetes(a) {
  const brut = String(a.nom || '').trim();
  const sansFormat = brut.replace(/\b\d+([.,]\d+)?\s*(x\s*\d+\s*)?(kg|g|ml|l|lb|oz)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([brut, sansFormat, mots(brut).slice(0, 2).join(' '), mots(brut)[0]].filter((q) => q && q.length >= 3))];
}

const appelsOFF = [];
async function rechercheOFF(q) {
  const maintenant = Date.now();
  while (appelsOFF.length && maintenant - appelsOFF[0] > 60000) appelsOFF.shift();
  if (appelsOFF.length >= 8) return { produits: [], limite: true };
  appelsOFF.push(maintenant);
  // Même service que l'app téléphone (accepté depuis un navigateur) ; produits vendus au Canada
  const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=15`
    + '&tagtype_0=countries&tag_contains_0=contains&tag_0=canada&fields=code,product_name_fr,product_name,brands,quantity,image_front_small_url,image_front_url');
  const texte = await r.text();
  if (!r.ok || texte.trimStart().startsWith('<')) throw new Error('service temporairement indisponible, réessaie plus tard');
  const j = JSON.parse(texte);
  return { produits: j.products || [], limite: false };
}

/**
 * Cherche un produit et retourne { candidats, propositions, notes }.
 * propositions : [{ champ, valeur, texte, confiance, source, lien }] — seulement pour les champs MANQUANTS.
 * besoins : Set des champs utiles ('format','marque','imageUrl','codes','rayonId','liens').
 */
export async function chercherProduit(a, { rayons, besoins, avecOFF = false }) {
  const notes = [];
  let ec = [];
  for (const q of requetes(a)) {
    try { ec = (await appelEC({ endpoint: 'search', q, limit: 30 })).results || []; } catch (err) { notes.push(`épiceries.ca : ${err.message}`); ec = []; }
    await pause(PAUSE_EC);
    if (ec.length) break;
  }
  const candidats = ec.map((r) => ({ source: 'épiceries.ca', id: r.id, nom: r.name, marque: r.brand || '', taille: r.size || '', image: r.image || '', categorie: r.category, url: r.url, magasin: r.store,
    confiance: score(a, r.name, r.brand, r.size) })).sort((x, y) => y.confiance - x.confiance);
  let off = [];
  if (avecOFF || (besoins.has('codes'))) {
    try {
      const { produits, limite } = await rechercheOFF(requetes(a)[1] || a.nom);
      if (limite) notes.push('Open Food Facts : limite de 8 recherches par minute atteinte, réessaie dans une minute pour les codes-barres.');
      off = produits.filter((p) => gtinValide(String(p.code || ''))).map((p) => ({ source: 'Open Food Facts', code: String(p.code), nom: p.product_name_fr || p.product_name || '',
        marque: String(p.brands || '').split(',')[0].trim(), taille: p.quantity || '', image: p.image_front_url || p.image_front_small_url || '',
        url: `https://world.openfoodfacts.org/product/${p.code}`, confiance: score(a, p.product_name_fr || p.product_name, String(p.brands || '').split(',')[0], p.quantity) }))
        .sort((x, y) => y.confiance - x.confiance);
    } catch (err) { notes.push(`Open Food Facts : ${err.message}`); }
  }
  const meilleur = (liste, cond) => liste.find((c) => c.confiance >= 0.5 && cond(c));
  const propositions = [];
  // plafond : un produit existe souvent en plusieurs formats ; sans indice de format, on ne coche pas d'office (≤ 0,7)
  const ajouter = (champ, valeur, texte, c, ajust = 0, plafond = 0.95) => propositions.push({ champ, valeur, texte, confiance: Math.max(0, Math.min(plafond, c.confiance + ajust)), source: c.source, lien: c.url, candidat: c.nom + (c.marque ? ` · ${c.marque}` : '') + (c.taille ? ` · ${c.taille}` : '') });
  if (besoins.has('format')) {
    const dansNom = formatDansLeNom(a.nom);
    if (dansNom) propositions.push({ champ: 'format', valeur: dansNom, texte: dansNom, confiance: 0.95, source: 'nom du produit', lien: null, candidat: a.nom });
    else { const c = meilleur([...candidats, ...off], (x) => analyserFormat(x.taille)); if (c) ajouter('format', formatLisible(c.taille), formatLisible(c.taille), c, -0.05, 0.7); }
  }
  if (besoins.has('marque')) { const c = meilleur([...candidats, ...off], (x) => x.marque); if (c) ajouter('marque', c.marque, c.marque, c, -0.05); }
  if (besoins.has('imageUrl')) { const c = meilleur([...candidats, ...off], (x) => x.image); if (c) ajouter('imageUrl', c.image, 'photo du produit', c, -0.1); }
  if (besoins.has('codes')) {
    const formatConnu = a.format || formatDansLeNom(a.nom);
    const c = meilleur(off, (x) => x.code && (!formatConnu || !x.taille || memeFormat(formatConnu, x.taille))) || meilleur(off, (x) => x.code);
    if (c) ajouter('codes', [...new Set([...(a.codes || []), c.code])], `${c.code}${c.taille ? ' (' + c.taille + ')' : ''}`, c, -0.1, formatConnu && c.taille && memeFormat(formatConnu, c.taille) ? 0.95 : 0.7);
  }
  if (besoins.has('rayonId')) {
    const c = meilleur(candidats, (x) => x.categorie);
    if (c) { const nomCat = await nomCategorie(c.categorie); const r = rayonPour(nomCat, rayons); if (r && r.id !== a.rayonId) propositions.push({ champ: 'rayonId', valeur: r.id, texte: `${r.nom} (catégorie « ${nomCat} »)`, confiance: Math.min(0.95, c.confiance), source: c.source, lien: c.url, candidat: c.nom }); }
  }
  if (besoins.has('liens')) {
    const c = meilleur(candidats, (x) => x.id && !(a.liens || []).some((l) => l.id === x.id));
    if (c) ajouter('liens', [...(a.liens || []), { id: c.id, nom: [c.marque, c.nom].filter(Boolean).join(' '), size: c.taille || null, image: c.image || null }], `lien épiceries.ca : ${c.nom}${c.taille ? ' · ' + c.taille : ''} (le téléphone ira chercher les prix)`, c, -0.1);
  }
  return { candidats: candidats.slice(0, 5), off: off.slice(0, 3), propositions, notes };
}

/** Champs utiles selon la règle de la boîte (plus tous les autres champs manquants du produit). */
export function besoinsPour(a, code) {
  const b = new Set();
  if (!analyserFormat(a.format)) b.add('format');
  if (!String(a.marque || '').trim()) b.add('marque');
  if (!a.imageUrl) b.add('imageUrl');
  if (!(a.codes || []).length) b.add('codes');
  if (!(a.liens || []).length) b.add('liens');
  if (code === 'rayon_divers') b.add('rayonId');
  return b;
}
