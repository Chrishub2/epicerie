// Outils partagés : échappement, fenêtre modale, calculs de prix.
import { normaliser, libelleUnitaire, classer, analyserFormat, comparerParPoids, prixComparable, formatLisible, marquerDouteux, minimumOffre } from './normalise.js';
import { get, generation } from './store.js';
import { BANNIERES } from './demo-data.js';
import { prixEnVigueur, etatPrix, agePrix, prixDuJour } from './rabais.js';
import { jourQuebec } from './couverture-circulaires.js';
import { trouveParNomOuMarque, estNomBio } from './noms.js';
import { enfantsGenerique } from './arbre-recherche.js';
import { familleDe } from './visuels.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const argent = (x) => x == null || !isFinite(x) ? '—'
  : x.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
/** v150 : texte d'une offre pour l'affichage ; une offre enregistrée en nombre seul (« 13.29 », sites anglais) → « 13,29 $ ». */
export const texteOffre = (offre) => (/^\s*\d+(?:[.,]\d+)?\s*$/.test(String(offre ?? '')) ? argent(Number(String(offre).replace(',', '.'))) : (offre ?? ''));

export function aujourdhui() { return new Date().toISOString().slice(0, 10); }

/** Jours restants avant une date (0 = aujourd'hui, négatif = passé). */
export function joursRestants(date) {
  if (!date) return null;
  const a = new Date(aujourdhui() + 'T00:00:00'), b = new Date(date + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export function libelleFin(fin) {
  const j = joursRestants(fin);
  if (j == null) return '';
  if (j < 0) return 'terminé';
  if (j === 0) return "finit aujourd'hui";
  if (j === 1) return 'finit demain';
  return `finit dans ${j} j`;
}

export function nomBanniere(b) { return BANNIERES[b]?.nom || b; }
export function puce(b) { return `<i class="ban" style="background:${BANNIERES[b]?.couleur || '#999'}"></i>`; }

// Pastille aux couleurs de la bannière, qui remplace son nom (style inspiré, pas le logo officiel).
const LOGOS = { iga: 'IGA', super_c: 'SUPER C', metro: 'metro', maxi: 'maxi', costco: 'COSTCO', jean_coutu: 'Jean Coutu', provigo: 'provigo', walmart: 'Walmart ✱', voila: 'voilà', instacart: '🥕 instacart',
  // v141 : pastilles construites pour les bannières qui n'en avaient pas (mêmes règles : couleurs de la bannière, jamais le logo officiel)
  tigre_geant: 'Tigre Géant', uniprix: 'uniprix', uniprix_sante: 'uniprix santé', familiprix_clinique: 'Familiprix Clinique',
  familiprix_extra: 'Familiprix Extra', pharmaprix: 'PHARMAPRIX', canadian_tire: 'CANADIAN TIRE' };
export function logo(b) {
  return LOGOS[b] ? `<span class="logo logo-${b}" title="${esc(nomBanniere(b))}">${LOGOS[b]}</span>` : esc(nomBanniere(b));
}
/** Logo + ville(s) : « [IGA] Beloeil, Varennes ». */
export function logoVille(b) {
  const villes = [...new Set(magasinsActifs(b).map(villeMagasin).filter(Boolean))];
  return `${logo(b)}${villes.length ? ` <span class="ville">${esc(villes.join(', '))}</span>` : ''}`;
}
/** v141 — Villes sous la pastille d'une colonne : une par ville où la bannière a UNE succursale active ;
 *  deux succursales de la même bannière dans une ville → cette ville n'est pas nommée (elle ne dirait pas laquelle). */
export function villesColonne(b) {
  const n = new Map();
  for (const m of magasinsActifs(b)) { const v = villeMagasin(m); if (v) n.set(v, (n.get(v) || 0) + 1); }
  return [...n].filter(([, k]) => k === 1).map(([v]) => v);
}

/** Logo + nom de la succursale sans la bannière : « [IGA] Extra Varennes ». */
export function logoMagasin(m) {
  const reste = m.nom.replace(new RegExp(`^${nomBanniere(m.banniere).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '');
  return `${logo(m.banniere)} <span>${esc(reste || villeMagasin(m))}</span>`;
}

// ---------------------------------------------------------------------
// Apparence : « clair », « sombre » ou « selon le téléphone » (gardé sur cet appareil)
// ---------------------------------------------------------------------
export function themeActuel() { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } }
export function appliquerTheme(t = themeActuel()) {
  try { localStorage.setItem('theme', t); } catch { /* navigation privée */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t === 'sombre' ? 'dark' : 'light');
}

/** Ville d'une succursale (champ ville, sinon tirée de l'adresse « …, Ville, QC … »). */
export function villeMagasin(m) {
  if (m.ville) return m.ville;
  const parts = String(m.adresse || '').split(',').map((s) => s.trim());
  const i = parts.findIndex((p) => /^QC\b/i.test(p));
  return i > 0 ? parts[i - 1] : '';
}

/** Succursales actives (cochées « à considérer ») d'une bannière. */
export function magasinsActifs(banniere) {
  return get().magasins.filter((m) => m.banniere === banniere && m.actif !== false);
}

/** « IGA · Beloeil » ou « IGA · Beloeil, Varennes » (plusieurs succursales actives). */
export function nomBanniereVille(b) {
  const villes = [...new Set(magasinsActifs(b).map(villeMagasin).filter(Boolean))];
  return villes.length ? `${nomBanniere(b)} · ${villes.join(', ')}` : nomBanniere(b);
}

/** Une bannière est considérée si au moins une de ses succursales est active. */
export function banniereActive(b) { return magasinsActifs(b).length > 0; }

// ---------------------------------------------------------------------
// Fenêtre modale
// ---------------------------------------------------------------------
const dlg = () => $('#modale');
/** opts.image : URL d'une image affichée devant le titre. */
export function ouvrirModale(titre, html, apres, opts = {}) {
  $('#modaleTitre').innerHTML = `${opts.image ? `<img src="${esc(opts.image)}" alt="" class="vignette" style="vertical-align:middle;margin-right:8px">` : ''}${esc(titre)}`;
  $('#modaleCorps').innerHTML = html;
  if (!dlg().open) dlg().showModal();
  document.documentElement.classList.add('modale-ouverte'); // la page derrière ne défile plus avec la fiche
  apres?.($('#modaleCorps'));
}
let surFermeture = null;
// Appelé une seule fois par fermeture (bouton ✕, fermerModale ou touche Échap via l'événement « close »)
function apresFermeture() { document.documentElement.classList.remove('modale-ouverte'); const f = surFermeture; surFermeture = null; f?.(); }
export function fermerModale() { if (dlg().open) dlg().close(); apresFermeture(); }
export function quandFermee(fn) { surFermeture = fn; }
// iPhone : le pincement passe outre touch-action ; on l'arrête par ses événements « gesture » tant qu'une fenêtre est ouverte
// (demande de Chris : l'écran zoomait en confirmant les lignes d'un reçu). Ailleurs dans l'app, le zoom reste permis.
const bloquerZoom = (ev) => { if (document.documentElement.classList.contains('modale-ouverte')) ev.preventDefault(); };
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, bloquerZoom, { passive: false });
document.addEventListener('DOMContentLoaded', () => {
  $('#modaleFermer').onclick = fermerModale;
  dlg().addEventListener('close', apresFermeture); // secours : certains navigateurs ne le déclenchent pas
});

// ---------------------------------------------------------------------
// Sélecteur de produit : ta liste d'épicerie d'abord, puis le catalogue (A→Z),
// avec recherche et « Créer ». Remplace les <datalist>, qui ne s'ouvrent pas au toucher sur mobile.
// ---------------------------------------------------------------------
let panneauOuvert = null;
/**
 * Touche `bouton` → ouvre/ferme `panneau` (un seul ouvert à la fois). surChoix(nom) reçoit le nom choisi
 * ('' pour « aucun produit », si opts.aucun). opts.aucun (défaut true), opts.texteAucun.
 */
export function brancherSelecteurProduit(bouton, panneau, surChoix, opts = {}) {
  const { aucun = true, texteAucun = '— aucun produit —' } = opts;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fermer = (p) => { if (p) { p.hidden = true; p.innerHTML = ''; } if (panneauOuvert === p) panneauOuvert = null; };
  const opt = (nom, cls = 'sec', texte = esc(nom)) => `<button type="button" class="btn ${cls}" data-pick="${esc(nom)}" style="width:100%;text-align:left;margin-top:4px">${texte}</button>`;
  const remplir = (res, q) => {
    const e = get();
    const surListe = new Set(e.liste.map((l) => l.articleId));
    const tri = (a, b) => a.nom.localeCompare(b.nom, 'fr');
    const t = norm(q.trim());
    const f = (a) => trouveParNomOuMarque(a, q.trim());   // par nom de produit ou par marque
    const l1 = e.articles.filter((a) => surListe.has(a.id) && f(a)).sort(tri);
    const l2 = e.articles.filter((a) => !surListe.has(a.id) && f(a)).sort(tri);
    const existe = t && e.articles.some((a) => norm(a.nom) === t);
    res.innerHTML = `${aucun ? opt('', 'sec', esc(texteAucun)) : ''}
      ${t && !existe ? opt(q.trim(), '', `➕ Créer « ${esc(q.trim())} »`) : ''}
      ${l1.length ? `<div class="doux" style="font-size:12px;margin-top:8px">🛒 Sur ta liste d'épicerie</div>${l1.map((a) => opt(a.nom)).join('')}` : ''}
      ${l2.length ? `<div class="doux" style="font-size:12px;margin-top:8px">📦 Catalogue</div>${l2.map((a) => opt(a.nom)).join('')}` : ''}
      ${!l1.length && !l2.length && !t ? '<p class="doux">Ton catalogue est vide : tape un nom pour créer le produit.</p>' : ''}`;
  };
  bouton.onclick = (ev) => {
    ev.preventDefault();
    const ouvert = panneauOuvert === panneau && !panneau.hidden;
    fermer(panneauOuvert);
    if (ouvert) return;
    panneauOuvert = panneau;
    panneau.hidden = false;
    panneau.innerHTML = `<input class="selFiltre" placeholder="🔎 Produit ou marque, ou un nouveau nom…" style="margin-top:6px;width:100%"><div class="selRes" style="max-height:45vh;overflow-y:auto"></div>`;
    const inp = panneau.querySelector('.selFiltre'), res = panneau.querySelector('.selRes');
    remplir(res, '');
    inp.oninput = () => remplir(res, inp.value);
    panneau.onclick = (e2) => { const o = e2.target.closest('[data-pick]'); if (o) { e2.preventDefault(); fermer(panneau); surChoix(o.dataset.pick); } };
    panneau.scrollIntoView({ block: 'nearest' });
  };
}

/**
 * Sélecteur de rayon tactile : touche `bouton` → panneau avec recherche, rayons A→Z (l'actuel coché)
 * et « ➕ Créer « … » » quand le nom tapé n'existe pas. surChoix({ id }) ou surChoix({ nom }) (nouveau rayon).
 * actuel() : id du rayon actuel (relu à chaque ouverture).
 */
export function brancherSelecteurRayon(bouton, panneau, actuel, surChoix) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const fermer = (p) => { if (p) { p.hidden = true; p.innerHTML = ''; } if (panneauOuvert === p) panneauOuvert = null; };
  const remplir = (res, q) => {
    const e = get();
    const t = norm(q);
    const id = actuel();
    const compte = (rid) => e.articles.filter((a) => a.rayonId === rid).length;
    const rayons = [...e.rayons].filter((r) => !t || norm(r.nom).includes(t)).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    const existe = t && e.rayons.some((r) => norm(r.nom) === t);
    // Rayons existants d'abord (Entrée choisit le premier) ; « Créer » à la fin si le nom tapé n'existe pas
    res.innerHTML = `${rayons.map((r) => `<button type="button" class="btn ${r.id === id ? '' : 'sec'}" data-rayon="${r.id}" style="width:100%;text-align:left;margin-top:4px">${r.id === id ? '✓ ' : ''}${esc(r.nom)} <span class="doux" style="font-size:12px">(${compte(r.id)})</span></button>`).join('')}
      ${t && !existe ? `<button type="button" class="btn" data-nouveau="${esc(q.trim())}" style="width:100%;text-align:left;margin-top:8px">➕ Créer le rayon « ${esc(q.trim())} »</button>` : ''}
      ${!rayons.length && !t ? '<p class="doux">Aucun rayon : tape un nom pour en créer un.</p>' : ''}`;
  };
  bouton.onclick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const ouvert = panneauOuvert === panneau && !panneau.hidden;
    fermer(panneauOuvert);
    if (ouvert) return;
    panneauOuvert = panneau;
    panneau.hidden = false;
    panneau.innerHTML = `<input class="selFiltre" placeholder="🔎 Chercher un rayon ou taper un nouveau nom…" style="margin-top:6px;width:100%"><div class="selRes" style="max-height:45vh;overflow-y:auto"></div>`;
    const inp = panneau.querySelector('.selFiltre'), res = panneau.querySelector('.selRes');
    remplir(res, '');
    inp.oninput = () => remplir(res, inp.value);
    inp.onkeydown = (k) => { if (k.key === 'Enter') { k.preventDefault(); res.querySelector('[data-nouveau],[data-rayon]')?.click(); } };
    panneau.onclick = (e2) => {
      const o = e2.target.closest('[data-rayon],[data-nouveau]');
      if (!o) return;
      e2.preventDefault(); e2.stopPropagation();
      fermer(panneau);
      surChoix(o.dataset.rayon ? { id: o.dataset.rayon } : { nom: o.dataset.nouveau });
    };
    panneau.scrollIntoView({ block: 'nearest' });
  };
}

// ---------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------
function rabaisPersoActifs() {
  const e = get();
  return e.rabaisPerso.filter((r) => r.actif && (r.expiration === '' || r.expiration == null || joursRestants(r.expiration) >= 0));
}

/**
 * Toutes les offres d'un article, normalisées et triées du moins cher au plus cher.
 * - seulement les bannières dont au moins une succursale est « à considérer » ;
 * - si l'article est exclusif à une bannière (ex. Kirkland → Costco), seulement celle-là ;
 * - ajoute une ligne « prix effectif » pour chaque magasin avec un rabais perso actif ;
 * - economie = prix régulier − prix courant quand le produit est en rabais.
 */
// v149 (audit R1) : prix rangés par produit une seule fois par état, au lieu de parcourir tous les prix
// pour chaque produit affiché. Refait si l'état est sauvegardé, ou si le tableau des prix change.
let indexPrix = { gen: -1, ref: null, n: -1, parArticle: new Map() };
function prixDeLArticle(e, id) {
  const gen = generation();
  if (indexPrix.gen !== gen || indexPrix.ref !== e.prix || indexPrix.n !== e.prix.length) {
    const parArticle = new Map();
    for (const p of e.prix) (parArticle.get(p.articleId) || parArticle.set(p.articleId, []).get(p.articleId)).push(p);
    indexPrix = { gen, ref: e.prix, n: e.prix.length, parArticle };
  }
  return indexPrix.parArticle.get(id) || [];
}

export function offresArticle(article, { avecAnciens = false } = {}) {
  const e = get();
  // Fiche générique (niveau 1 ou 2, recherche-niveaux-v2) : ses offres sont celles de ses fiches dessous,
  // comparées au kg / L, rabais inclus ; le produit exact derrière chaque prix est nommé.
  if (article?.estGenerique) {
    const nommer = (x) => (l) => ({ ...l, articleEnfant: x.id, produitOffre: l.produitOffre || [[x.marque, x.nom].filter(Boolean).join(' '), formatLisible(l.format || x.format)].filter(Boolean).join(' · ') });
    const enfants = enfantsGenerique(article, e.articles, familleDe);
    const lignesGen = enfants.flatMap((x) => offresArticle(x).map(nommer(x)));
    // v140 : plus ses propres prix (son nom cherché chez les bannières : le moins cher de chacune, toutes sortes)
    const propres = offresArticle({ ...article, estGenerique: false }).map((l) => ({ ...l, produitOffre: l.produitOffre || l.nomProduit || '' }));
    const classees = classerLignes([...lignesGen, ...propres]);
    if (!avecAnciens) return classees;
    const extras = [...enfants.flatMap((x) => offresArticle(x, { avecAnciens: true }).filter((l) => l.etat !== 'courant').map(nommer(x))),
      ...offresArticle({ ...article, estGenerique: false }, { avecAnciens: true }).filter((l) => l.etat !== 'courant')];
    return [...classees, ...extras];
  }
  const lignes = [];
  // Toutes les marques/formats du produit sont comparées au kg / L ; une variante retirée ne compte plus
  const variantes = new Map((article.variantes || []).map((v) => [v.id, v]));
  const auj = jourQuebec();
  for (const p0 of prixDeLArticle(e, article.id)) {
    // Rabais fini (date de fin passée, ou 7 jours après avoir été vu) : prix régulier s'il est connu, sinon l'offre ne compte plus
    const p = prixEnVigueur(p0, auj);
    if (!p) continue;
    if (p.enAttente) continue; // photo pas encore lue (hors ligne)
    if (p.annule) continue;    // prix d'une association de reçu corrigée
    if (!banniereActive(p.banniere)) continue;
    if (article.exclusif && p.banniere !== article.exclusif) continue;
    // v150 (spec S14, validation du 2026-11-24) : le bio est un produit à part — un prix nommé « … biologique » ne compte
    // pas pour une fiche non bio (vu : « Oignons jaunes biologiques » d'IGA comparés aux oignons jaunes)
    if (!article.bio && estNomBio(p.nomProduit)) continue;
    const v = variantes.get(p.varianteId);
    if (v?.retiree) continue;
    // Format du prix, sinon celui de SA variante (pas celui de la fiche : 2 kg ≠ 900 g)
    const fmt = p.format || v?.format || article.format;
    let n = normaliser(p.offre, fmt, article.uniteRef);
    // Produit compté à l'unité : poids ou volume du contenant (sert à comparer des casseaux de 255 g et de 680 g)
    const fc = article.uniteRef === 'unite' ? analyserFormat(fmt) : null;
    const contenu = fc && fc.base !== 'unite' ? { base: fc.base, total: fc.total } : null;
    // Format illisible mais prix unitaire fourni par la source (épiceries.ca) dans la bonne unité
    if (n.erreur && p.uniteSource && p.uniteSource.unite === article.uniteRef) {
      n = { prixUnitaire: p.uniteSource.pu, uniteRef: article.uniteRef, prixArticle: null };
    }
    const economie = p.prixRegulier && p.prixNum && p.prixRegulier > p.prixNum + 0.004 ? p.prixRegulier - p.prixNum : null;
    // v147 : démo jamais compté ; « à venir » et « ancien » (> 60 j ou sans date) hors calcul
    let etat = etatPrix(p, auj);
    // v150 : en mode découverte (pas encore de foyer), les prix d'exemple sont les seuls prix : on les montre (pastille
    // « démo ») pour que la 1re ouverture donne un vrai résultat. Dans un foyer réel, ils ne comptent jamais (v147).
    if (etat === 'demo') { if (e.demo !== true) continue; etat = 'courant'; }
    lignes.push({ ...p, pu: n.prixUnitaire ?? null, prixArticle: n.prixArticle ?? null, uniteRef: n.uniteRef || article.uniteRef, erreur: n.erreur, economie,
      contenu, produitOffre: produitDeLOffre(article, p, v), formatVendu: fmt || '', etat, age: agePrix(p, auj),
      ...(minimumOffre(p.offre, p.conditions, p.prixRegulier) || {}) });
  }
  // v147 (règle de Chris) : par bannière et variante, seulement le prix d'aujourd'hui (le plus récent ;
  // un rabais encore valide plus bas passe devant). Les autres restent dans l'historique et le record.
  const courantes = lignes.filter((l) => l.etat === 'courant');
  comparerParPoids(courantes);
  const plusieursVariantes = (article.variantes || []).filter((x) => !x.retiree).length > 1;
  const cleGroupe = (l) => `${l.banniere}|${plusieursVariantes ? l.varianteId || '' : ''}`;
  const groupes = new Map();
  for (const l of courantes) (groupes.get(cleGroupe(l)) || groupes.set(cleGroupe(l), []).get(cleGroupe(l))).push(l);
  const gardees = [...groupes.values()].map((g) => prixDuJour(g, prixComparable));
  // Prix sans aucun équivalent courant (même bannière et variante) : montrés en gris dans la fiche, jamais comptés
  const extras = avecAnciens ? lignes.filter((l) => l.etat === 'aVenir' || (l.etat === 'ancien' && !groupes.has(cleGroupe(l))))
    .map((l) => ({ ...l, classe: l.etat === 'aVenir' ? 'avenir' : 'ancien' })) : [];
  lignes.length = 0;
  for (const l of gardees) { delete l.pc; delete l.pcUnite; }   // recalculé sur les prix gardés seulement
  lignes.push(...gardees);
  // Contenants de poids différents : on compare au kg (ou au L), l'affichage reste à l'unité
  comparerParPoids(lignes);
  const cmp = (l) => prixComparable(l) ?? Infinity;
  for (const r of rabaisPersoActifs()) {
    const m = e.magasins.find((x) => x.id === r.magasinId);
    if (!m || m.actif === false) continue;
    const base = lignes.filter((l) => l.banniere === m.banniere && !l.perso && l.pu != null).sort((a, b) => cmp(a) - cmp(b))[0];
    if (!base) continue;
    const k = 1 - r.pct / 100;
    lignes.push({ ...base, perso: true, magasinNom: m.nom, pu: base.pu * k, prixArticle: base.prixArticle == null ? null : base.prixArticle * k,
      ...(base.pc !== undefined ? { pc: base.pc == null ? null : base.pc * k } : {}),
      persoPct: r.pct, persoPlafond: Number(r.plafond) || null,
      rabaisTexte: `−${r.pct} % perso${r.plafond ? ` (sur ${r.plafond} $)` : ''}` });
  }
  const classees = classerLignes(lignes);
  return extras.length ? [...classees, ...extras] : classees;
}

/** Trie les offres du moins cher au plus cher (prix comparable) et les colore (vert = meilleur, rouge = le plus cher). */
function classerLignes(lignes) {
  marquerDouteux(lignes);
  const cmp = (l) => prixComparable(l) ?? Infinity;
  // Les prix douteux passent après tous les autres : ils ne sont jamais « le moins cher ».
  // v150 (validation du 2026-11-24) : pareil pour un prix marqué « à vérifier » (essuie-tout à 9,99 $ « 1,24 L » recommandé).
  const suspect = (l) => (l.douteux || l.aVerifier ? 1 : 0);
  lignes.sort((a, b) => suspect(a) - suspect(b) || cmp(a) - cmp(b) || (a.pu ?? Infinity) - (b.pu ?? Infinity));
  const avecPrix = lignes.filter((l) => prixComparable(l) != null && !suspect(l));
  const meilleur = avecPrix.length ? prixComparable(avecPrix[0]) : null;
  const pire = avecPrix.length > 1 ? prixComparable(avecPrix[avecPrix.length - 1]) : null;
  lignes.forEach((l) => {
    const c = prixComparable(l);
    l.classe = classer(c, meilleur);
    if (pire != null && c === pire && pire > meilleur) l.classe = 'cher'; // rouge = le plus cher
    if (suspect(l)) l.classe = 'douteux';
  });
  return lignes;
}

/**
 * Quelle marque/format est derrière ce prix (seulement si le produit en a plusieurs) :
 * le nom du produit chez la bannière (épiceries.ca) ou la variante (« Tilda · 2 kg »).
 */
function produitDeLOffre(article, p, v) {
  if ((p.source === 'flipp' || p.source === 'circulaire') && p.nomProduit) return p.nomProduit; // lu dans une circulaire : montrer le produit exact
  const actives = (article.variantes || []).filter((x) => !x.retiree);
  if (actives.length < 2) return '';
  if (p.nomProduit) return p.nomProduit;
  return v ? [v.marque, v.nom, v.format].filter(Boolean).join(' · ') : '';
}

export function meilleureOffre(article) { return offresArticle(article).find((l) => l.pu != null) || null; }

/** Nom affiché d'une offre : « IGA Extra Varennes » (rabais perso) ou « IGA · Beloeil ». */
export function nomOffre(o) { return o.magasinNom || nomBanniereVille(o.banniere); }

export { libelleUnitaire };

/** Petite notification en bas d'écran, avec ✕ pour la fermer.
 *  Courte (« Lait ajouté ») : disparaît seule après 2,6 s. Longue : reste jusqu'au ✕ (demande de Chris, 23 nov. 2026 : pas le temps de la lire). */
export function toast(msg) {
  let pile = document.getElementById('pileNotes');
  if (!pile) {
    pile = document.createElement('div');
    pile.id = 'pileNotes';
    pile.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:50;display:flex;flex-direction:column;gap:6px;width:max-content;max-width:92vw';
    document.body.appendChild(pile);
  }
  const t = document.createElement('div');
  t.setAttribute('role', 'status');
  t.style.cssText = 'display:flex;align-items:flex-start;gap:6px;background:#1d2320;color:#fff;padding:8px 6px 8px 14px;border-radius:10px;font-size:14px;line-height:1.35;box-shadow:0 4px 14px rgba(0,0,0,.3)';
  const texte = document.createElement('span');
  texte.textContent = msg;
  texte.style.cssText = 'flex:1;padding-top:3px';
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '✕';
  x.setAttribute('aria-label', 'Fermer la note');
  x.style.cssText = 'flex:none;width:32px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.15);color:#fff;font-size:15px;cursor:pointer';
  x.onclick = () => t.remove();
  t.append(texte, x);
  pile.appendChild(t);
  while (pile.children.length > 3) pile.firstChild.remove();
  if (String(msg).length <= 40) setTimeout(() => t.remove(), 2600);
}
