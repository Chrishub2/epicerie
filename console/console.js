// =====================================================================
// Console Épicerie — étape C4 : VRAIES données (Supabase), modifications enregistrées avec contrôle de version.
// Mode démo (?demo) : données FICTIVES en mémoire, modifiables, rien n'est envoyé.
// Réutilise la logique de l'app téléphone (../app/normalise.js, ../app/produits.js).
// =====================================================================
import { genererEtat } from './donnees.js';
import { analyser, REGLES, PRIORITES, SEUIL_LOT, meilleurPrix, prixUnitaires, nomNormalise } from './qualite.js';
import { TableVirtuelle } from './table.js';
import { gtinValide, formatLisible, libelleUnitaire, analyserFormat } from '../normalise.js';
import { normaliserProduits, variantesActives, variantePref, completude, codesDe, fusionner, apercuFusion } from '../produits.js';
import { SourceSupabase, construireEtat, differences, COLLECTIONS } from './source.js';

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nf = (n) => Number(n).toLocaleString('fr-CA');
const pct = (x) => Math.round(x * 100) + ' %';
const dateCourte = (iso) => iso ? new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
const heure = (iso) => new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
const BANNIERES = { iga: 'IGA', super_c: 'Super C', metro: 'Metro', maxi: 'Maxi', costco: 'Costco', jean_coutu: 'Jean Coutu', provigo: 'Provigo', walmart: 'Walmart' };
const UNITES = { kg: 'kg', l: 'L', unite: 'unité' };

// ---------------------------------------------------------------------
// Préférences (par ordinateur, sans importance si elles se perdent)
// ---------------------------------------------------------------------
const prefs = (() => { try { return JSON.parse(localStorage.getItem('console-prefs')) || {}; } catch { return {}; } })();
function sauverPrefs() { try { localStorage.setItem('console-prefs', JSON.stringify(prefs)); } catch { /* navigation privée */ } }

// ---------------------------------------------------------------------
// État
// ---------------------------------------------------------------------
const MODE = new URLSearchParams(location.search).has('demo') ? 'fictif' : 'reel';
const etatVide = () => ({ rayons: [], articles: [], prix: [], photos: [], recus: [], liste: [] });
let E = etatVide();
let source = null;                   // SourceSupabase (mode réel)
let histoBase = [];                  // historique lu dans la base (objets_historique)
const synchro = { etat: MODE === 'reel' ? 'connexion' : 'fictif', texte: MODE === 'reel' ? 'Connexion…' : 'Données fictives · rien n\'est envoyé' };
const ignores = new Set();           // problèmes rejetés / « pas un problème » (clé)
const historique = [];               // { id, quand, articleId, champ, avant, apres, source, lot }
let A = analyser(E, ignores);
let index = null;                    // recherche
const ui = {
  vue: 'tdb', articleOuvert: null, selection: new Set(),
  filtre: { texte: '', rayon: '', etat: 'tous', grouper: false, tri: null },
  boite: { regle: 'gtin_invalide', selection: new Set(), texte: '' },
  comparer: [], cibleFusion: null, edition: null,
};
const articleParId = () => new Map(E.articles.map((a) => [a.id, a]));
let ARTS = articleParId();
const rayonNom = (id) => E.rayons.find((r) => r.id === id)?.nom || '—';

function reanalyser() {
  normaliserProduits(E);
  ARTS = articleParId();
  A = analyser(E, ignores);
  index = null;
}

// ---------------------------------------------------------------------
// Petits rendus réutilisés
// ---------------------------------------------------------------------
function vignette(a, grande = false) {
  const lettres = (a.nom || '?').trim().split(/\s+/).slice(0, 2).map((m) => m[0]).join('').toUpperCase();
  if (!a.imageUrl) return `<span class="vignette vide${grande ? ' grande' : ''}" title="Aucune photo">${grande ? '📷' : ''}</span>`;
  if (!String(a.imageUrl).startsWith('fictif:')) return `<img class="vignette image${grande ? ' grande' : ''}" src="${esc(a.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('casse')">`;
  const h = (parseInt(String(a.rayonId).slice(1), 10) * 47) % 360;
  return `<span class="vignette${grande ? ' grande' : ''}" style="background:hsl(${h} 38% 38%)" title="Photo (fictive)">${esc(lettres)}</span>`;
}
function jauge(n, total = 6) {
  let b = '';
  for (let i = 0; i < total; i++) b += `<i class="${i < n ? 'plein' : ''}"></i>`;
  return `<span class="jauge" data-n="${n}" title="${n}/${total} données de base">${b}</span><span class="n">${n}/${total}</span>`;
}
function prios(liste) {
  if (!liste?.length) return '<span class="discret">—</span>';
  const c = {}; for (const p of liste) c[p.priorite] = (c[p.priorite] || 0) + 1;
  return '<span class="prios">' + Object.keys(c).sort().map((k) => `<span class="prio p${k}" title="${PRIORITES[k].nom}">${c[k] > 1 ? c[k] + '×' : ''}P${k}</span>`).join('') + '</span>';
}
function confiance(x) {
  if (x == null) return '';
  const cl = x >= SEUIL_LOT ? 'haute' : x >= 0.7 ? 'moyenne' : '';
  return `<span class="confiance ${cl}" title="Confiance ${pct(x)}"><span class="barre-c"><i style="width:${x * 100}%"></i></span><span class="mono">${pct(x)}</span></span>`;
}
const nomCourt = (a) => esc((a?.nom || '').trim());

function note(texte, action) {
  const n = document.createElement('div');
  n.className = 'note';
  n.innerHTML = `<span>${texte}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action.libelle; b.onclick = () => { action.faire(); n.remove(); }; n.append(b); }
  $('#notes').append(n);
  setTimeout(() => n.remove(), 6000);
}

// ---------------------------------------------------------------------
// Modifications (mode démo seulement) + historique
// ---------------------------------------------------------------------
/** Mode réel : rien ne s'écrit avant l'étape C4. Retourne true (et prévient) si l'action doit être bloquée. */
/** Mode réel : la fusion reste bloquée (elle déplace des prix, protégés en ajout seulement) — étape C5. */
function lectureSeule(action = '') {
  if (MODE !== 'reel' || action !== 'fusion') return false;
  note('Fusionner de vraies fiches arrive à l\'étape C5 : la fusion déplace des prix, qui sont protégés. En attendant : « Pas des doublons », ou corrige les fiches une à une.');
  return true;
}
let nLot = 0;
/** Applique une modification d'un champ. Retourne l'entrée d'historique. */
function modifier(articleId, champ, apres, source = 'console', lot = null) {
  const a = ARTS.get(articleId);
  if (!a) return null;
  let avant;
  if (champ === 'code') {
    // apres = { avant: code, apres: code } : remplace dans le produit et ses variantes
    avant = apres.avant;
    const nouveau = apres.apres;
    a.codes = (a.codes || []).map((c) => (c === avant ? nouveau : c));
    for (const v of a.variantes || []) v.codes = (v.codes || []).map((c) => (c === avant ? nouveau : c));
    apres = nouveau;
  } else {
    avant = a[champ];
    if (apres === '' && champ !== 'nom') delete a[champ]; else a[champ] = apres;
  }
  a.maj = new Date().toISOString(); a.majPar = 'Chris (console)';
  const h = { id: historique.length + 1, quand: a.maj, articleId, nom: a.nom, champ, avant, apres, source, lot };
  historique.unshift(h);
  aPersister(articleId, source === 'restauration' ? 'restauration' : 'console');
  return h;
}
function restaurer(h) {
  if (lectureSeule()) return;
  if (h.champ === 'fusion') { annulerFusion(h); return; }
  if (h.champ === 'code') modifier(h.articleId, 'code', { avant: h.apres, apres: h.avant }, 'restauration');
  else modifier(h.articleId, h.champ, h.avant ?? '', 'restauration');
  h.restauree = true;
  reanalyser(); rendre();
  note(`Valeur restaurée sur « ${esc((ARTS.get(h.articleId)?.nom || h.nom).trim())} »`);
}
function libelleChamp(c) { return { nom: 'Nom', marque: 'Marque', format: 'Format', uniteRef: 'Unité de comparaison', rayonId: 'Rayon', code: 'Code-barres', fusion: 'Fusion', pasDoublon: 'Pas un doublon' }[c] || c; }
function valeurLisible(champ, v) {
  if (v == null || v === '') return '<span class="discret">(vide)</span>';
  if (champ === 'rayonId') return esc(rayonNom(v));
  if (champ === 'uniteRef') return esc(UNITES[v] || v);
  if (champ === 'code') return `<span class="mono">${esc(v)}</span>`;
  return esc(v);
}
function majSynchro() {
  if (MODE === 'reel') {
    $('#synchro').dataset.etat = synchro.etat;
    $('#synchroTexte').textContent = synchro.texte;
    $('#synchro').title = 'Vraies données (Supabase). Chaque modification est enregistrée avec contrôle de version et historique. Clic : réessayer un envoi en échec.';
    return;
  }
  const n = historique.length;
  $('#synchro').dataset.etat = n ? 'local' : 'fictif';
  $('#synchroTexte').textContent = n ? `${n} modification${n > 1 ? 's' : ''} en mémoire · démo, rien n'est envoyé` : 'Données fictives · rien n\'est envoyé';
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------
const VUES = [
  ['Données', [['tdb', '◧', 'Tableau de bord'], ['catalogue', '▤', 'Catalogue'], ['boite', '⚑', 'Boîte de résolution'], ['comparer', '⇄', 'Comparateur'], ['historique', '↺', 'Historique']]],
  ['Référentiel', [['marques', '®', 'Marques', 'C3'], ['rayons', '▦', 'Rayons et types', 'C3'], ['codes', '▥', 'Codes UPC / EAN / PLU', 'C3'], ['magasins', '⌂', 'Magasins et références', 'C3']]],
  ['Activité', [['prix', '$', 'Prix et achats', 'C3'], ['recus', '🧾', 'Reçus', 'C3'], ['medias', '▣', 'Images et médias', 'C7']]],
  ['Système', [['ia', '✦', 'Assistant IA', 'C6'], ['synchro', '⇅', 'Synchronisation', 'C4'], ['admin', '⛁', 'Base de données', 'C2'], ['reglages', '⚙', 'Réglages', 'C3']]],
];
const PREVU = {
  marques: 'Liste des marques, produits par marque, fusion de marques écrites différemment (« Selection » / « Sélection »).',
  rayons: 'Catégories → types de produits, glisser-déposer pour reclasser en lot.',
  codes: 'Tous les codes-barres, validité GS1, codes orphelins ou partagés, PLU des fruits et légumes.',
  magasins: 'Bannières, succursales et références marchand (noms imprimés sur les reçus, liens épiceries.ca).',
  prix: 'Historique des prix par produit et par bannière, prix suspects, économies.',
  recus: 'Tous les reçus, lignes non reliées, écarts de caisse.',
  medias: 'Galerie, miniatures, doublons d\'images, images sans produit, basse résolution (stockage Supabase).',
  ia: 'Analyse par lots avec Claude, coûts mesurés, propositions à approuver. En attendant : le copilote ✦ (version règles).',
  synchro: 'État de la synchronisation avec les téléphones, conflits à résoudre, journal des erreurs.',
  admin: 'Santé de la base, sauvegardes, migrations (db/console-v1.sql installé le 2026-11-16, 14/14).',
  reglages: 'Seuil de confiance pour le lot, colonnes par défaut, vues enregistrées.',
};
function rendreNav() {
  const nP1 = A.problemes.filter((p) => p.priorite === 1).length;
  const comptes = { catalogue: nf(E.articles.length), boite: nf(A.problemes.length), comparer: ui.comparer.length || '', historique: (MODE === 'reel' ? histoBase.length : historique.length) || '' };
  $('#nav').innerHTML = VUES.map(([titre, items]) => `<h3>${titre}</h3>` + items.map(([id, ico, lib, etape]) =>
    `<a href="#/${id}" data-vue="${id}" class="${etape ? 'prevu' : ''}" ${ui.vue === id ? 'aria-current="page"' : ''} title="${esc(lib)}${etape ? ' — prévu à l\'étape ' + etape : ''}">
      <span class="ico">${ico}</span><span class="lib">${lib}</span>
      <span class="compte ${id === 'boite' && nP1 ? 'p1' : ''}">${etape || comptes[id] || ''}</span></a>`).join('')).join('');
}
function aller(vue) { location.hash = '#/' + vue; }
window.addEventListener('hashchange', () => { const v = location.hash.slice(2) || 'tdb'; ui.vue = v; rendre(); });

// ---------------------------------------------------------------------
// Rendu général
// ---------------------------------------------------------------------
let tableCourante = null;
function rendre() {
  rendreNav();
  majSynchro();
  const t = $('#travail');
  tableCourante = null;
  if (ui.vue === 'tdb') vueTdb(t);
  else if (ui.vue === 'catalogue') vueCatalogue(t);
  else if (ui.vue === 'boite') vueBoite(t);
  else if (ui.vue === 'comparer') vueComparer(t);
  else if (ui.vue === 'historique') vueHistorique(t);
  else vuePrevue(t, ui.vue);
  rendreDetail();
}

// ---------------------------------------------------------------------
// Tableau de bord — santé des données
// ---------------------------------------------------------------------
function vueTdb(t) {
  const variantes = E.articles.flatMap((a) => variantesActives(a));
  const commerciaux = new Set(E.articles.flatMap((a) => variantesActives(a).filter((v) => String(v.marque || '').trim()).map((v) => a.id + '|' + sansAccents(v.marque))));
  const marques = new Set(variantes.map((v) => sansAccents(v.marque)).filter(Boolean));
  const codes = new Set(E.articles.flatMap(codesDe));
  const alias = variantes.reduce((s, v) => s + (v.alias?.length || 0), 0);
  const applicables = A.problemes.filter((p) => p.correction && p.confiance >= SEUIL_LOT).length;
  const histo = [0, 0, 0, 0, 0, 0, 0];
  for (const a of E.articles) histo[completude(a, { prix: A.prixParArticle.get(a.id) || [], rayons: E.rayons }).ok]++;
  const completes = histo[6];
  const parRegle = Object.entries(REGLES).map(([code, r]) => ({ code, r, n: A.problemes.filter((p) => p.code === code).length }));
  const maxR = Math.max(...parRegle.map((x) => x.n), 1);
  const tuiles = [
    ['Types de produits', E.articles.length, 'catalogue'], ['Produits commerciaux', commerciaux.size, null, 'Calculés : type + marque (seulement les variantes qui ont une marque)'],
    ['SKU (variantes)', variantes.length], ['Marques', marques.size], ['Codes-barres', codes.size], ['Rayons', E.rayons.length],
    ['Images', E.articles.filter((a) => a.imageUrl).length], ['Références marchand', alias, null, 'Noms imprimés sur les reçus'],
    ['Prix observés', E.prix.length], ['Problèmes ouverts', A.problemes.length, 'boite'], ['Corrections prêtes', applicables, 'boite', `Confiance ≥ ${pct(SEUIL_LOT)}`],
    ['Fiches complètes', pct(completes / E.articles.length), 'catalogue'],
  ];
  t.innerHTML = `
    <div class="entete-vue"><h1>Santé des données</h1><span class="muet">${MODE === 'reel' ? `Foyer « ${esc(source?.foyer?.nom || '')} » · ${nf(E.articles.length)} produits` : `${nf(E.articles.length)} produits fictifs`} · analyse en ${A.duree} ms</span></div>
    <div class="defile">
      <div class="tuiles">${tuiles.map(([l, v, vue, aide]) => `<div class="tuile ${vue ? 'cliquable' : ''}" ${vue ? `data-aller="${vue}"` : ''} title="${aide || ''}"><div class="v">${typeof v === 'number' ? nf(v) : v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="colonnes-tdb">
        <section class="panneau"><h2>Problèmes par règle</h2><div class="barres-h">
          ${parRegle.map(({ code, r, n }) => `<a href="#/boite" data-regle="${code}"><span class="prio p${r.priorite}">P${r.priorite}</span>${r.titre}</a>
            <span class="b"><i style="width:${(n / maxR) * 100}%;background:var(--p${r.priorite})"></i></span><span class="mono num" style="text-align:right">${nf(n)}</span>`).join('')}
        </div></section>
        <section class="panneau"><h2>Complétude des fiches (6 données de base)</h2>
          <div class="histo">${histo.map((n, i) => `<div class="col" title="${nf(n)} fiche(s) à ${i}/6"><span>${nf(n)}</span><i style="height:${(n / Math.max(...histo)) * 100}%"></i><span>${i}/6</span></div>`).join('')}</div>
          <p class="muet" style="margin:10px 0 0">Format lisible, marque, code-barres, photo, vrai prix, rayon autre que Divers — mêmes critères que le catalogue du téléphone.</p>
        </section>
        <section class="panneau"><h2>Dernières modifications</h2>
          ${MODE === 'reel' ? (histoBase.length ? `<ul class="chrono">${histoBase.slice(0, 8).map(ligneHistoBase).join('')}</ul>` : '<p class="muet">Aucune modification enregistrée depuis l\'installation de l\'historique (C2).</p>')
            : historique.length ? `<ul class="chrono">${historique.slice(0, 8).map(ligneHistorique).join('')}</ul>` : '<p class="muet">Aucune modification pour l\'instant. Ouvre la boîte de résolution pour commencer.</p>'}
        </section>
      </div>
    </div>`;
  t.querySelectorAll('[data-aller]').forEach((x) => x.onclick = () => aller(x.dataset.aller));
  t.querySelectorAll('[data-regle]').forEach((x) => x.onclick = () => { ui.boite.regle = x.dataset.regle; ui.boite.selection.clear(); });
  brancherHistorique(t);
}

// ---------------------------------------------------------------------
// Catalogue — table dense, filtres, sélection, édition en ligne, lot
// ---------------------------------------------------------------------
const COLONNES = [
  { cle: 'sel', titre: '', largeur: 34, rendu: (a) => `<input type="checkbox" class="case" data-sel ${ui.selection.has(a.id) ? 'checked' : ''} aria-label="Sélectionner">` },
  { cle: 'img', titre: '', largeur: 40, rendu: (a) => vignette(a) },
  { cle: 'nom', titre: 'Produit (type)', largeur: 240, souple: true, tri: true, edit: 'texte', rendu: (a) => celluleEdit(a, 'nom') ?? `${esc(a.nom)}` },
  { cle: 'marque', titre: 'Marque ★', largeur: 150, tri: true, edit: 'texte', rendu: (a) => celluleEdit(a, 'marque') ?? (a.marque ? esc(a.marque) : '<span class="discret">—</span>') },
  { cle: 'format', titre: 'Format', largeur: 110, tri: true, edit: 'texte', rendu: (a) => celluleEdit(a, 'format') ?? (a.format ? esc(formatLisible(a.format)) : '<span class="discret">—</span>') },
  { cle: 'uniteRef', titre: 'Comparé', largeur: 76, tri: true, edit: 'unite', rendu: (a) => celluleEdit(a, 'uniteRef') ?? `au ${UNITES[a.uniteRef] || '?'}` },
  { cle: 'rayonId', titre: 'Rayon', largeur: 175, tri: true, edit: 'rayon', rendu: (a) => celluleEdit(a, 'rayonId') ?? esc(rayonNom(a.rayonId)) },
  { cle: 'sku', titre: 'SKU', largeur: 56, tri: true, aligne: 'right', rendu: (a) => `<span class="mono">${variantesActives(a).length}</span>` },
  { cle: 'codes', titre: 'Codes', largeur: 60, tri: true, aligne: 'right', rendu: (a) => { const c = codesDe(a); const ko = c.filter((x) => !gtinValide(x)).length; return `<span class="mono" style="${ko ? 'color:var(--erreur)' : ''}">${c.length}${ko ? ' ✕' : ''}</span>`; } },
  { cle: 'comp', titre: 'Complétude', largeur: 110, tri: true, rendu: (a) => jauge(compDe(a).ok) },
  { cle: 'prix', titre: 'Meilleur prix (120 j)', largeur: 150, tri: true, rendu: (a) => { const m = meilleurPrix(E, a, A.prixParArticle); return m ? `<span class="mono num">${libelleUnitaire(m.pu, a.uniteRef).split(' · ')[0]}</span> <span class="discret">${BANNIERES[m.banniere]}</span>` : '<span class="discret">—</span>'; } },
  { cle: 'pb', titre: 'Problèmes', largeur: 120, tri: true, rendu: (a) => prios(A.parArticle.get(a.id)) },
  { cle: 'maj', titre: 'Modifié', largeur: 96, tri: true, rendu: (a) => `<span class="muet">${dateCourte(a.maj)}</span>` },
];
for (const c of COLONNES) if (prefs.largeurs?.[c.cle]) c.largeur = prefs.largeurs[c.cle];
const cacheComp = new Map();
function compDe(a) {
  const k = a.id + '|' + a.maj + '|' + (A.prixParArticle.get(a.id)?.length || 0) + '|' + a.rayonId + a.format + a.marque + (a.codes || []).join() + a.imageUrl;
  const c = cacheComp.get(a.id);
  if (c?.k === k) return c.v;
  const v = completude(a, { prix: A.prixParArticle.get(a.id) || [], rayons: E.rayons });
  cacheComp.set(a.id, { k, v });
  return v;
}
function celluleEdit(a, champ) {
  if (ui.edition?.id !== a.id || ui.edition.champ !== champ) return null;
  if (champ === 'rayonId') return `<select class="cellule-edit" data-edit>${E.rayons.map((r) => `<option value="${r.id}" ${r.id === a.rayonId ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select>`;
  if (champ === 'uniteRef') return `<select class="cellule-edit" data-edit>${Object.entries(UNITES).map(([k, l]) => `<option value="${k}" ${k === a.uniteRef ? 'selected' : ''}>au ${l}</option>`).join('')}</select>`;
  return `<input class="cellule-edit" data-edit value="${esc(a[champ] || '')}">`;
}

function articlesFiltres() {
  const f = ui.filtre;
  const q = sansAccents(f.texte).trim();
  let liste = E.articles.filter((a) => {
    if (f.rayon && a.rayonId !== f.rayon) return false;
    if (f.etat === 'acompleter' && compDe(a).ok === 6) return false;
    if (f.etat === 'probleme' && !A.parArticle.get(a.id)?.length) return false;
    if (f.etat === 'p1' && !A.parArticle.get(a.id)?.some((p) => p.priorite === 1)) return false;
    if (f.etat === 'selection' && !ui.selection.has(a.id)) return false;
    if (q) {
      const txt = sansAccents([a.nom, a.marque, a.id, ...codesDe(a), ...variantesActives(a).map((v) => v.marque)].join(' '));
      if (!q.split(/\s+/).every((m) => txt.includes(m))) return false;
    }
    return true;
  });
  if (f.tri) {
    const val = {
      nom: (a) => sansAccents(a.nom).trim(), marque: (a) => sansAccents(a.marque), format: (a) => analyserFormat(a.format)?.total ?? -1,
      uniteRef: (a) => a.uniteRef, rayonId: (a) => rayonNom(a.rayonId), sku: (a) => variantesActives(a).length, codes: (a) => codesDe(a).length,
      comp: (a) => compDe(a).ok, prix: (a) => meilleurPrix(E, a, A.prixParArticle)?.pu ?? Infinity,
      pb: (a) => -(A.parArticle.get(a.id) || []).reduce((s, p) => s + (6 - p.priorite) ** 2, 0), maj: (a) => a.maj || '',
    }[f.tri.cle];
    liste.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * f.tri.sens; });
  }
  if (f.grouper) {
    const groupes = new Map();
    for (const a of liste) (groupes.get(a.rayonId) || groupes.set(a.rayonId, []).get(a.rayonId)).push(a);
    liste = [...groupes.entries()].sort((x, y) => rayonNom(x[0]).localeCompare(rayonNom(y[0]), 'fr')).flatMap(([rid, as]) => [{ groupe: rayonNom(rid), n: as.length }, ...as]);
  }
  return liste;
}

function vueCatalogue(t) {
  const f = ui.filtre;
  const etats = [['tous', 'Tous'], ['acompleter', 'À compléter'], ['probleme', 'Avec problème'], ['p1', 'Critiques'], ['selection', 'Sélection']];
  t.innerHTML = `
    <div class="entete-vue"><h1>Catalogue</h1><span class="muet" id="compteCat"></span></div>
    <div class="outils">
      <input class="champ" id="filtreTexte" placeholder="Filtrer : nom, marque, code, id…" value="${esc(f.texte)}" aria-label="Filtrer">
      <select class="champ" id="filtreRayon" aria-label="Rayon"><option value="">Tous les rayons</option>${E.rayons.map((r) => `<option value="${r.id}" ${r.id === f.rayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select>
      ${etats.map(([k, l]) => `<button class="puce" data-etat="${k}" aria-pressed="${f.etat === k}">${l}</button>`).join('')}
      <span style="flex:1"></span>
      <button class="puce" id="grouper" aria-pressed="${f.grouper}">Grouper par rayon</button>
      <button class="puce" id="colonnes">Colonnes</button>
    </div>
    <div class="selection" id="barreSel"></div>
    <div id="hoteTable" style="flex:1;min-height:0;display:flex"></div>`;
  const tv = new TableVirtuelle($('#hoteTable', t), {
    colonnes: COLONNES, cle: (a) => a.id, vide: 'Aucun produit ne correspond. Retire un filtre pour élargir.',
    classes: (a) => (ui.selection.has(a.id) ? 'choisie' : '') + (ui.articleOuvert === a.id ? ' focus' : ''),
    rendreGroupe: (g) => `${esc(g.groupe)} <span class="mono discret" style="font-weight:400">${g.n}</span>`,
    surTri: (tri) => { f.tri = tri; remplir(); },
    surLargeur: (c) => { (prefs.largeurs ||= {})[c.cle] = c.largeur; sauverPrefs(); },
    surClic: (a, i, ev) => {
      if (a.groupe) return;
      if (ev.target.matches('[data-sel]')) { basculerSel(a.id, ev.shiftKey ? i : null); return; }
      if (ev.target.closest('[data-edit]')) return;
      tv.focusI = i;
      if (ui.articleOuvert === a.id) fermerDetail(); else ouvrirArticle(a.id); // re-cliquer la ligne referme la fiche
    },
    surDouble: (a, i, ev) => {
      const col = ev.target.closest('[data-col]')?.dataset.col;
      const c = COLONNES.find((x) => x.cle === col);
      if (a.groupe || !c?.edit) return;
      editerCellule(a.id, col);
    },
  });
  tv.tri = f.tri;
  tv.construireTete();
  tableCourante = tv;
  let dernierClic = null;
  function basculerSel(id, iShift) {
    if (iShift != null && dernierClic != null) {
      const [d, fin] = [Math.min(dernierClic, iShift), Math.max(dernierClic, iShift)];
      for (let k = d; k <= fin; k++) if (!tv.items[k].groupe) ui.selection.add(tv.items[k].id);
    } else if (ui.selection.has(id)) ui.selection.delete(id); else ui.selection.add(id);
    dernierClic = iShift ?? tv.items.findIndex((x) => x.id === id);
    tv.rafraichir(); barreSelection();
  }
  function remplir() {
    const liste = articlesFiltres();
    tv.donnees(liste);
    const n = liste.filter((x) => !x.groupe).length;
    $('#compteCat').textContent = `${nf(n)} sur ${nf(E.articles.length)} produits`;
    barreSelection();
  }
  ui.remplirCatalogue = remplir;
  remplir();
  if (ui.articleOuvert) tv.focusParId(ui.articleOuvert);
  let minuterie;
  $('#filtreTexte').oninput = (ev) => { clearTimeout(minuterie); minuterie = setTimeout(() => { f.texte = ev.target.value; remplir(); }, 120); };
  $('#filtreRayon').onchange = (ev) => { f.rayon = ev.target.value; remplir(); };
  t.querySelectorAll('[data-etat]').forEach((b) => b.onclick = () => { f.etat = b.dataset.etat; vueCatalogue(t); });
  $('#grouper').onclick = () => { f.grouper = !f.grouper; vueCatalogue(t); };
  $('#colonnes').onclick = choisirColonnes;
  // Édition en ligne
  $('#hoteTable').addEventListener('keydown', (ev) => {
    const ch = ev.target.closest('[data-edit]');
    if (!ch) return;
    if (ev.key === 'Enter') { ev.preventDefault(); validerEdition(ch.value); }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); ui.edition = null; tv.rafraichir(); }
  });
  $('#hoteTable').addEventListener('change', (ev) => { if (ev.target.matches('select[data-edit]')) validerEdition(ev.target.value); });
  $('#hoteTable').addEventListener('focusout', (ev) => { if (ev.target.matches('input[data-edit]') && ui.edition) validerEdition(ev.target.value); });
}

function editerCellule(id, champ) {
  if (lectureSeule()) return;
  ui.edition = { id, champ };
  tableCourante?.rafraichir();
  const ch = tableCourante?.ligneDom(id)?.querySelector('[data-edit]');
  ch?.focus(); ch?.select?.();
  if (ch?.tagName === 'SELECT') { try { ch.showPicker?.(); } catch { /* navigateur sans showPicker : le menu reste visible, un clic l'ouvre */ } }
}
function validerEdition(valeur) {
  const ed = ui.edition; ui.edition = null;
  if (!ed) return;
  const a = ARTS.get(ed.id);
  const v = typeof valeur === 'string' ? (ed.champ === 'nom' ? valeur.replace(/\s+/g, ' ').trim() : valeur.trim()) : valeur;
  if (ed.champ === 'nom' && !v) { note('Le nom ne peut pas être vide.'); tableCourante?.rafraichir(); return; }
  if ((a[ed.champ] ?? '') === v) { tableCourante?.rafraichir(); return; }
  const h = modifier(ed.id, ed.champ, v);
  reanalyser();
  ui.remplirCatalogue?.();
  rendreNav(); majSynchro(); rendreDetail();
  tableCourante?.ligneDom(ed.id)?.classList.add('flash');
  note(`${libelleChamp(ed.champ)} modifié`, { libelle: 'Annuler', faire: () => restaurer(h) });
}

function barreSelection() {
  const b = $('#barreSel');
  if (!b) return;
  const n = ui.selection.size;
  b.classList.toggle('visible', n > 0);
  if (!n) { b.innerHTML = ''; return; }
  b.innerHTML = `<strong>${nf(n)} sélectionné${n > 1 ? 's' : ''}</strong>
    <button class="btn petit" data-lot="rayonId">Changer le rayon…</button>
    <button class="btn petit" data-lot="marque">Changer la marque…</button>
    <button class="btn petit" data-lot="uniteRef">Changer l'unité de comparaison…</button>
    <button class="btn petit" id="lotComparer" ${n < 2 || n > 4 ? 'disabled title="Choisis 2 à 4 produits"' : ''}>⇄ Comparer</button>
    <button class="btn petit" id="lotExport">Exporter CSV</button>
    <button class="btn petit danger" id="lotSupprimer">🗑 Supprimer…</button>
    <span style="flex:1"></span><button class="btn petit" id="lotVider">Tout désélectionner</button>`;
  b.querySelectorAll('[data-lot]').forEach((x) => x.onclick = () => modifierEnLot(x.dataset.lot));
  $('#lotComparer').onclick = () => { ui.comparer = [...ui.selection]; ui.cibleFusion = ui.comparer[0]; aller('comparer'); };
  $('#lotVider').onclick = () => { ui.selection.clear(); tableCourante?.rafraichir(); barreSelection(); };
  $('#lotExport').onclick = exporterCsv;
  $('#lotSupprimer').onclick = () => supprimerProduits([...ui.selection]);
}

function exporterCsv() {
  const lignes = [['id', 'nom', 'marque', 'format', 'unite', 'rayon', 'codes', 'completude']];
  for (const id of ui.selection) { const a = ARTS.get(id); lignes.push([a.id, a.nom.trim(), a.marque || '', a.format || '', a.uniteRef, rayonNom(a.rayonId), codesDe(a).join(' '), compDe(a).ok + '/6']); }
  const csv = '﻿' + lignes.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const lien = Object.assign(document.createElement('a'), { href: url, download: `catalogue-selection-${new Date().toISOString().slice(0, 10)}.csv` });
  lien.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  note(`${ui.selection.size} ligne(s) exportée(s) en CSV`);
}

/** Modification en lot : choix de la valeur → aperçu avant/après → une seule confirmation. */
function modifierEnLot(champ) {
  if (lectureSeule()) return;
  const ids = [...ui.selection];
  const champSaisie = champ === 'rayonId'
    ? `<select class="champ" id="valLot">${E.rayons.map((r) => `<option value="${r.id}">${esc(r.nom)}</option>`).join('')}</select>`
    : champ === 'uniteRef' ? `<select class="champ" id="valLot">${Object.entries(UNITES).map(([k, l]) => `<option value="${k}">au ${l}</option>`).join('')}</select>`
    : '<input class="champ" id="valLot" placeholder="Nouvelle marque" style="width:280px">';
  const m = modale(`${libelleChamp(champ)} — ${ids.length} produit(s)`, `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><label>Nouvelle valeur</label>${champSaisie}</div>
    <div id="apercuLot"></div>`, [
    ['Annuler', 'fermer'],
    ['Appliquer', 'principal', () => {
      const v = $('#valLot').value.trim();
      if (champ === 'marque' && !v) { note('Écris une marque.'); return false; }
      const lot = ++nLot;
      let n = 0;
      for (const id of ids) if ((ARTS.get(id)[champ] ?? '') !== v) { modifier(id, champ, v, 'console', lot); n++; }
      reanalyser(); rendre();
      note(`${n} produit(s) modifié(s)`, { libelle: 'Annuler le lot', faire: () => annulerLot(lot) });
    }],
  ]);
  const apercu = () => {
    const v = $('#valLot', m).value.trim();
    const changes = ids.map((id) => ARTS.get(id)).filter((a) => (a[champ] ?? '') !== v);
    $('#apercuLot', m).innerHTML = `<p class="muet">${changes.length} changement(s), ${ids.length - changes.length} déjà à cette valeur. Chaque changement sera dans l'historique et pourra être restauré.</p>
      <table class="mini-table avant-apres"><tr><th>Produit</th><th>Avant</th><th>Après</th></tr>
      ${changes.slice(0, 200).map((a) => `<tr><td>${nomCourt(a)}</td><td class="av">${valeurLisible(champ, a[champ])}</td><td class="ap">${valeurLisible(champ, v)}</td></tr>`).join('')}</table>
      ${changes.length > 200 ? `<p class="discret">… et ${changes.length - 200} autres.</p>` : ''}`;
  };
  $('#valLot', m).addEventListener('input', apercu); $('#valLot', m).addEventListener('change', apercu);
  apercu();
  $('#valLot', m).focus();
}
function annulerLot(lot) {
  if (lectureSeule()) return;
  const entrees = historique.filter((h) => h.lot === lot && !h.restauree);
  for (const h of entrees) { if (h.champ === 'code') modifier(h.articleId, 'code', { avant: h.apres, apres: h.avant }, 'restauration'); else modifier(h.articleId, h.champ, h.avant ?? '', 'restauration'); h.restauree = true; }
  reanalyser(); rendre();
  note(`${entrees.length} modification(s) annulée(s)`);
}

function choisirColonnes() {
  const m = modale('Colonnes affichées', `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">${COLONNES.filter((c) => c.titre).map((c) => `<label><input type="checkbox" class="case" data-c="${c.cle}" ${c.cache ? '' : 'checked'}> ${c.titre}</label>`).join('')}</div>`, [['Fermer', 'fermer']]);
  m.querySelectorAll('[data-c]').forEach((x) => x.onchange = () => {
    const c = COLONNES.find((y) => y.cle === x.dataset.c); c.cache = !x.checked;
    prefs.cachees = COLONNES.filter((y) => y.cache).map((y) => y.cle); sauverPrefs();
    if (tableCourante) { tableCourante.construireTete(); tableCourante.rafraichir(); }
  });
}
for (const k of prefs.cachees || []) { const c = COLONNES.find((x) => x.cle === k); if (c) c.cache = true; }

// ---------------------------------------------------------------------
// Panneau de détail
// ---------------------------------------------------------------------
function ouvrirArticle(id) {
  ui.articleOuvert = id;
  $('#detail').hidden = false;
  appliquerLargeurDetail();
  rendreDetail();
  tableCourante?.rafraichir();
}
function fermerDetail() {
  ui.articleOuvert = null; $('#detail').hidden = true;
  $('#coque').style.setProperty('--detail', '0px');
  tableCourante?.rafraichir();
}
function appliquerLargeurDetail() {
  // Espace disponible pour tableau + fiche (sans la navigation ni le copilote quand il est en colonne)
  const nav = $('#nav').offsetWidth || 232;
  const cop = !$('#copilote').hidden && innerWidth > 1700 ? 380 : 0;
  const dispo = innerWidth - nav - cop;
  // ~38 % pour la fiche (30-40 % visé) ; largeur choisie à la main gardée, mais jamais plus de 55 %
  const l = Math.round(Math.max(380, Math.min(prefs.detail || Math.min(1200, dispo * 0.38), dispo * 0.55)));
  $('#coque').style.setProperty('--detail', ui.articleOuvert ? l + 'px' : '0px');
}
addEventListener('resize', () => appliquerLargeurDetail());

function rendreDetail() {
  const a = ARTS.get(ui.articleOuvert);
  const zone = $('#detailContenu');
  if (!a) { if (ui.articleOuvert) fermerDetail(); return; }
  const comp = compDe(a);
  const pbs = A.parArticle.get(a.id) || [];
  const vs = variantesActives(a);
  const pref = variantePref(a);
  // Produits commerciaux (calculés) : variantes regroupées par marque
  const pc = new Map();
  for (const v of vs) { const k = String(v.marque || '').trim() || 'Sans marque'; (pc.get(k) || pc.set(k, []).get(k)).push(v); }
  const pus = prixUnitaires(E, a, A.prixParArticle);
  const parBan = new Map();
  for (const x of pus) (parBan.get(x.p.banniere) || parBan.set(x.p.banniere, []).get(x.p.banniere)).push(x);
  const tousPu = pus.map((x) => x.pu);
  const [minPu, maxPu] = [Math.min(...tousPu), Math.max(...tousPu)];
  const hist = MODE === 'reel' ? histoBase.filter((h) => h.type === 'article' && h.id === a.id) : historique.filter((h) => h.articleId === a.id);
  const champ = (cle, label, valeur, type) => `<label>${label}</label><div class="valeur editable" data-champ="${cle}" data-type="${type}" tabindex="0" title="Cliquer pour modifier">${valeur || '<span class="vide">vide</span>'}</div>`;
  zone.innerHTML = `
    <div class="tete-detail">
      ${vignette(a, true)}
      <div style="min-width:0;flex:1">
        <div class="fil"><b>${esc(rayonNom(a.rayonId))}</b> › type de produit</div>
        <h1>${esc(a.nom)}</h1>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center">
          ${jauge(comp.ok)} ${a.local ? '<span class="badge ok">🍁 Québec</span>' : ''} ${a.bio ? '<span class="badge ok">Bio</span>' : ''}
          <span class="badge mono">${a.id}</span><span class="discret">modifié ${dateCourte(a.maj)} par ${esc(a.majPar || '—')}</span>
        </div>
      </div>
      <button class="btn petit danger" id="supprimerFiche" title="Supprimer ce produit du catalogue">🗑 Supprimer</button>
      <button class="bouton-icone" id="fermerDetail" title="Fermer (Échap)">✕</button>
    </div>
    <div class="sections">
    ${pbs.length ? `<section class="section large"><h3>Problèmes <span class="n">${pbs.length}</span></h3>${pbs.map(carteProbleme).join('')}</section>` : ''}
    <section class="section"><h3>Fiche</h3>
      <div class="grille-champs">
        ${champ('nom', 'Nom', esc(a.nom), 'texte')}
        ${champ('marque', 'Marque ★', esc(a.marque || ''), 'texte')}
        ${champ('format', 'Format ★', a.format ? `${esc(a.format)} <span class="discret">${esc(formatLisible(a.format) !== a.format ? '= ' + formatLisible(a.format) : '')}</span>` : '', 'texte')}
        ${champ('uniteRef', 'Comparé', 'au ' + (UNITES[a.uniteRef] || '?'), 'unite')}
        ${champ('rayonId', 'Rayon', esc(rayonNom(a.rayonId)), 'rayon')}
        <label>Manque</label><div class="valeur">${comp.manquants.length ? comp.manquants.map((m) => `<span class="badge alerte">${m.icone} ${m.texte}</span>`).join(' ') : '<span class="badge ok">Rien</span>'}</div>
      </div>
      <p class="discret" style="margin:8px 0 0;font-size:12px">★ = variante habituelle. Pendant la transition, la fiche est la référence et la variante ★ en est le miroir (même règle que le téléphone).</p>
    </section>
    <section class="section"><h3>Produits commerciaux → SKU <span class="n">${pc.size} · ${vs.length}</span></h3>
      <table class="mini-table">
        <tr><th>Format</th><th>Codes-barres</th><th>Noms sur les reçus</th></tr>
        ${[...pc.entries()].map(([marque, liste]) => `<tr class="groupe-pc"><td colspan="3">${esc(marque)} <span class="discret" style="font-weight:400">· ${esc(a.nom.trim())}</span></td></tr>` +
          liste.map((v) => `<tr><td>${v === pref ? '★ ' : ''}${esc(v.format || '—')}</td>
            <td>${(v.codes || []).map((c) => `<div class="code ${gtinValide(c) ? 'ok' : 'ko'}">${c}</div>`).join('') || '<span class="discret">—</span>'}</td>
            <td>${(v.alias || []).map((x) => `<span class="alias" title="${BANNIERES[x.banniere] || x.banniere}">${esc(BANNIERES[x.banniere] || x.banniere)} · ${esc(x.libelle)}</span>`).join('') || '<span class="discret">—</span>'}</td></tr>`).join('')).join('')}
      </table>
    </section>
    <section class="section"><h3>Prix comparables <span class="n">n = ${pus.length}</span></h3>
      ${pus.length ? `<div class="etincelles">${[...parBan.entries()].map(([ban, xs]) => {
        xs.sort((x, y) => (x.p.observeLe < y.p.observeLe ? -1 : 1));
        const dernier = xs[xs.length - 1];
        return `<span>${BANNIERES[ban] || ban}</span>${etincelle(xs, minPu, maxPu)}<span class="mono num" style="text-align:right">${libelleUnitaire(dernier.pu, a.uniteRef).split(' · ')[0]}</span><span class="discret mono">×${xs.length}</span>`;
      }).join('')}</div><p class="discret" style="font-size:12px;margin:8px 0 0">Prix ramenés au ${UNITES[a.uniteRef]} avec le normalisateur de l'app. Points rouges : prix suspects.</p>` : '<p class="muet">Aucun prix observé.</p>'}
    </section>
    <section class="section"><h3>Historique <span class="n">${hist.length}</span></h3>
      ${hist.length ? `<ul class="chrono">${hist.map(MODE === 'reel' ? ligneHistoBase : ligneHistorique).join('')}</ul>` : `<p class="muet">${MODE === 'reel' ? 'Aucune modification de ce produit depuis l\'installation de l\'historique (C2).' : 'Aucune modification depuis l\'ouverture de la console.'}</p>`}
    </section>
    </div>`;
  $('#fermerDetail').onclick = fermerDetail;
  $('#supprimerFiche').onclick = () => supprimerProduits([a.id]);
  brancherProblemes(zone);
  brancherHistorique(zone);
  zone.querySelectorAll('.valeur.editable').forEach((el) => {
    const go = () => editerChampDetail(el, a);
    el.onclick = go; el.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } };
  });
}

function etincelle(xs, min, max) {
  const t1 = Date.now(), t0 = t1 - 365 * 864e5; // les 12 derniers mois
  const sx = (d) => ((Date.parse(d) - t0) / (t1 - t0)) * 100;
  const sy = (pu) => (max === min ? 11 : 20 - ((pu - min) / (max - min)) * 18);
  const pts = xs.map((x) => `${sx(x.p.observeLe).toFixed(1)},${sy(x.pu).toFixed(1)}`).join(' ');
  const susp = new Set((A.parArticle.get(xs[0]?.p.articleId) || []).filter((p) => p.code === 'prix_aberrant').map((p) => p.prixId));
  return `<svg viewBox="0 0 100 22" preserveAspectRatio="none" role="img" aria-label="Évolution du prix"><polyline points="${pts}" fill="none" stroke="var(--texte-3)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    ${xs.map((x) => `<circle cx="${sx(x.p.observeLe).toFixed(1)}" cy="${sy(x.pu).toFixed(1)}" r="${susp.has(x.p.id) ? 2.4 : 1.4}" fill="${susp.has(x.p.id) ? 'var(--erreur)' : 'var(--etiquette)'}" vector-effect="non-scaling-stroke"><title>${x.p.observeLe} · ${esc(x.p.offre)} · ${x.p.source}</title></circle>`).join('')}</svg>`;
}

function editerChampDetail(el, a) {
  if (lectureSeule()) return;
  const champ = el.dataset.champ, type = el.dataset.type;
  if (el.querySelector('[data-edit]')) return;
  const ctl = type === 'rayon' ? `<select class="cellule-edit" data-edit>${E.rayons.map((r) => `<option value="${r.id}" ${r.id === a.rayonId ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select>`
    : type === 'unite' ? `<select class="cellule-edit" data-edit>${Object.entries(UNITES).map(([k, l]) => `<option value="${k}" ${k === a.uniteRef ? 'selected' : ''}>au ${l}</option>`).join('')}</select>`
    : `<input class="cellule-edit" data-edit value="${esc(a[champ] || '')}">`;
  el.innerHTML = ctl;
  const c = el.firstElementChild; c.focus(); c.select?.();
  if (c.tagName === 'SELECT') { try { c.showPicker?.(); } catch { /* le menu reste visible, un clic l'ouvre */ } }
  let fini = false;
  const valider = () => {
    if (fini) return; fini = true;
    const v = champ === 'nom' ? c.value.replace(/\s+/g, ' ').trim() : c.value.trim();
    if (champ === 'nom' && !v) { note('Le nom ne peut pas être vide.'); rendreDetail(); return; }
    if ((a[champ] ?? '') === v) { rendreDetail(); return; }
    const h = modifier(a.id, champ, v);
    reanalyser(); rendreNav(); majSynchro(); rendreDetail(); ui.remplirCatalogue && ui.vue === 'catalogue' && ui.remplirCatalogue();
    if (ui.vue === 'boite') vueBoite($('#travail')); // le problème corrigé disparaît de la liste
    note(`${libelleChamp(champ)} modifié`, { libelle: 'Annuler', faire: () => restaurer(h) });
  };
  c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); valider(); } if (ev.key === 'Escape') { ev.stopPropagation(); fini = true; rendreDetail(); } });
  c.addEventListener('blur', valider);
  if (c.tagName === 'SELECT') c.addEventListener('change', valider);
}

// ---------------------------------------------------------------------
// Problèmes : carte, actions (appliquer / ignorer / comparer)
// ---------------------------------------------------------------------
function carteProbleme(p) {
  const peutLot = p.correction && p.confiance >= SEUIL_LOT;
  return `<div class="carte-probleme" data-cle="${esc(p.cle)}">
    <div class="haut"><span class="prio p${p.priorite}">P${p.priorite}</span><strong>${esc(p.titre)}</strong><span style="flex:1"></span>${confiance(p.confiance)}</div>
    <div>${esc(p.probleme)}</div>
    ${p.raison ? `<div class="muet" style="font-size:12px;margin-top:3px">${esc(p.raison)}</div>` : ''}
    ${p.correction ? `<div class="proposition"><span class="badge ia">Proposé</span>${esc(p.correction.texte)}${p.impact ? `<span class="discret" style="margin-left:auto">${esc(p.impact)}</span>` : ''}</div>` : (p.impact ? `<div class="discret" style="font-size:12px;margin-top:4px">${esc(p.impact)}</div>` : '')}
    <div class="actions">
      ${p.correction ? `<button class="btn petit principal" data-act="appliquer">${peutLot ? 'Appliquer' : 'Appliquer quand même'}</button>` : ''}
      ${!p.correction && CHAMP_A_CORRIGER[p.code] ? '<button class="btn petit" data-act="corriger">✎ Corriger</button>' : ''}
      ${p.cibles.length > 1 ? '<button class="btn petit" data-act="comparer">⇄ Comparer</button>' : ''}
      ${p.code === 'prix_aberrant' ? '<button class="btn petit" data-act="ouvrir">Voir les prix</button>' : ''}
      <button class="btn petit" data-act="ignorer" title="Ne plus afficher ce problème">${p.cibles.length > 1 ? 'Pas des doublons' : 'Pas un problème'}</button>
    </div></div>`;
}
const problemeParCle = (cle) => A.problemes.find((p) => p.cle === cle);
function brancherProblemes(zone) {
  zone.querySelectorAll('.carte-probleme [data-act]').forEach((b) => b.onclick = () => {
    const p = problemeParCle(b.closest('.carte-probleme').dataset.cle);
    if (!p) return;
    actionProbleme(p, b.dataset.act);
  });
}
function actionProbleme(p, act) {
  if ((act === 'appliquer' || (act === 'ignorer' && p.cibles.length > 1 && /doublon/.test(p.code))) && lectureSeule()) return;
  if (act === 'appliquer') {
    const h = appliquerCorrection(p);
    reanalyser(); rendre();
    note(`Corrigé : ${esc(p.titre.toLowerCase())}`, h && { libelle: 'Annuler', faire: () => restaurer(h) });
  } else if (act === 'ignorer') {
    if (p.cibles.length > 1 && /doublon/.test(p.code)) {
      for (const id of p.cibles) { const a = ARTS.get(id); a.pasDoublon = [...new Set([...(a.pasDoublon || []), ...p.cibles.filter((x) => x !== id)])]; aPersister(id); }
      historique.unshift({ id: historique.length + 1, quand: new Date().toISOString(), articleId: p.cibles[0], nom: ARTS.get(p.cibles[0]).nom, champ: 'pasDoublon', avant: null, apres: p.cibles.join(' + '), source: 'console' });
    } else ignores.add(p.cle);
    reanalyser(); rendre();
    note('Problème écarté');
  } else if (act === 'comparer') {
    ui.comparer = [...p.cibles]; ui.cibleFusion = p.cibles[0]; aller('comparer');
  } else if (act === 'ouvrir') ouvrirArticle(p.cibles[0]);
  else if (act === 'corriger') corrigerChamp(p.cibles[0], CHAMP_A_CORRIGER[p.code]);
}
/** Problèmes qu'on corrige à la main dans la console : règle → champ de la fiche. Les autres (code, photo, prix) se font au téléphone. */
const CHAMP_A_CORRIGER = { format_manquant: 'format', marque_manquante: 'marque', rayon_divers: 'rayonId', nom_a_normaliser: 'nom', format_unite: 'uniteRef' };
function corrigerChamp(id, champ) {
  if (!champ) { ouvrirArticle(id); return; }
  if (ui.articleOuvert !== id) ouvrirArticle(id);
  const el = $(`#detailContenu .valeur.editable[data-champ="${champ}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  editerChampDetail(el, ARTS.get(id));
}
function appliquerCorrection(p, lot = null) {
  const c = p.correction;
  if (!c) return null;
  if (c.type === 'code') return modifier(c.articleId, 'code', { avant: c.avant, apres: c.apres }, 'regle', lot);
  return modifier(c.articleId, c.champ, c.apres, 'regle', lot);
}

// ---------------------------------------------------------------------
// Boîte de résolution
// ---------------------------------------------------------------------
function vueBoite(t) {
  const b = ui.boite;
  const compte = (code) => A.problemes.filter((p) => p.code === code).length;
  const parPrio = [1, 2, 3, 4, 5].map((k) => [k, Object.entries(REGLES).filter(([, r]) => r.priorite === k)]);
  if (!REGLES[b.regle]) b.regle = 'gtin_invalide';
  const r = REGLES[b.regle];
  t.innerHTML = `
    <div class="entete-vue"><h1>Boîte de résolution</h1><span class="muet">${nf(A.problemes.length)} problèmes ouverts · rien n'est corrigé sans ton accord</span></div>
    <div class="boite">
      <div class="regles">${parPrio.map(([k, regles]) => `<h3>${PRIORITES[k].court} · ${PRIORITES[k].nom}</h3>` + regles.map(([code, rr]) =>
        `<button data-regle="${code}" aria-pressed="${code === b.regle}"><span class="prio p${rr.priorite}">P${rr.priorite}</span>${rr.titre}<span class="n">${nf(compte(code))}</span></button>`).join('')).join('')}</div>
      <div class="liste-problemes">
        <div class="explication"><strong>${esc(r.titre)}.</strong> ${esc(r.explication)}</div>
        <div class="outils">
          <input class="champ" id="filtreBoite" placeholder="Filtrer ces problèmes…" value="${esc(b.texte)}" style="width:180px">
          <button class="puce" id="toutCocher">Cocher les corrections ≥ ${pct(SEUIL_LOT)}</button>
          <span style="flex:1"></span>
          <span class="muet" id="compteSelBoite"></span>
          <button class="btn principal" id="appliquerLot" disabled>Appliquer la sélection…</button>
          <button class="btn" id="ignorerLot" disabled>Écarter la sélection</button>
        </div>
        <div id="hoteBoite" style="flex:1;min-height:0;display:flex"></div>
      </div>
    </div>`;
  t.querySelectorAll('[data-regle]').forEach((x) => x.onclick = () => { b.regle = x.dataset.regle; b.selection.clear(); vueBoite(t); });
  const cols = [
    { cle: 'sel', titre: '', largeur: 34, rendu: (p) => `<input type="checkbox" class="case" data-sel ${b.selection.has(p.cle) ? 'checked' : ''} aria-label="Sélectionner">` },
    { cle: 'act', titre: 'Action', largeur: 168, rendu: (p) => `${p.correction ? '<button class="btn petit principal" data-act="appliquer" title="Appliquer la correction proposée">✓ Appliquer</button> ' : ''}${!p.correction && CHAMP_A_CORRIGER[p.code] ? '<button class="btn petit" data-act="corriger" title="Ouvrir la fiche sur ce champ">✎ Corriger</button> ' : ''}${p.cibles.length > 1 ? '<button class="btn petit" data-act="comparer" title="Comparer">⇄</button> ' : ''}<button class="btn petit" data-act="ignorer" title="Écarter ce problème">✕</button>` },
    { cle: 'prod', titre: 'Produit(s)', largeur: 200, souple: true, rendu: (p) => p.cibles.map((id) => nomCourt(ARTS.get(id))).join(' <span class="discret">·</span> ') },
    { cle: 'pb', titre: 'Problème', largeur: 280, rendu: (p) => esc(p.probleme) },
    { cle: 'corr', titre: 'Correction proposée', largeur: 200, rendu: (p) => (p.correction ? `<span class="badge ia">Proposé</span> ${esc(p.correction.texte)}` : `<span class="discret">${p.cibles.length > 1 ? 'À comparer' : CHAMP_A_CORRIGER[p.code] ? 'À corriger (✎)' : 'Au téléphone (scan, photo, prix)'}</span>`) },
    { cle: 'conf', titre: 'Confiance', largeur: 100, rendu: (p) => confiance(p.confiance) },
  ];
  const tv = new TableVirtuelle($('#hoteBoite', t), {
    colonnes: cols, cle: (p) => p.cle, vide: 'Aucun problème de ce type. 👍',
    classes: (p) => (b.selection.has(p.cle) ? 'choisie' : ''),
    surClic: (p, i, ev) => {
      if (ev.target.matches('[data-sel]')) { if (b.selection.has(p.cle)) b.selection.delete(p.cle); else b.selection.add(p.cle); tv.rafraichir(); majBoutons(); return; }
      const act = ev.target.closest('[data-act]')?.dataset.act;
      tv.focusI = i;
      if (act) { actionProbleme(p, act); return; }
      if (ui.articleOuvert === p.cibles[0]) fermerDetail(); else ouvrirArticle(p.cibles[0]); // re-cliquer referme la fiche
    },
  });
  tableCourante = tv;
  const liste = () => {
    const q = sansAccents(b.texte);
    return A.problemes.filter((p) => p.code === b.regle && (!q || sansAccents(p.probleme + ' ' + p.cibles.map((id) => ARTS.get(id)?.nom).join(' ')).includes(q)));
  };
  const majBoutons = () => {
    const sel = liste().filter((p) => b.selection.has(p.cle));
    const app = sel.filter((p) => p.correction);
    $('#compteSelBoite').textContent = sel.length ? `${sel.length} coché(s) · ${app.length} avec correction` : '';
    $('#appliquerLot').disabled = !app.length;
    $('#ignorerLot').disabled = !sel.length;
  };
  tv.donnees(liste());
  majBoutons();
  ui.actionFocus = (act) => { const p = tv.items[tv.focusI]; if (p) actionProbleme(p, act); };
  $('#filtreBoite').oninput = (ev) => { b.texte = ev.target.value; tv.donnees(liste()); majBoutons(); };
  $('#toutCocher').onclick = () => {
    const ok = liste().filter((p) => p.correction && p.confiance >= SEUIL_LOT);
    ok.forEach((p) => b.selection.add(p.cle)); tv.rafraichir(); majBoutons();
    if (!ok.length) note(`Aucune correction de ce type n'atteint ${pct(SEUIL_LOT)} : vérifie-les une à une.`);
  };
  $('#ignorerLot').onclick = () => {
    const sel = liste().filter((p) => b.selection.has(p.cle));
    sel.forEach((p) => ignores.add(p.cle)); b.selection.clear();
    reanalyser(); rendre(); note(`${sel.length} problème(s) écarté(s)`);
  };
  $('#appliquerLot').onclick = () => {
    if (lectureSeule()) return;
    const sel = liste().filter((p) => b.selection.has(p.cle) && p.correction);
    const sous = sel.filter((p) => p.confiance < SEUIL_LOT);
    modale(`Appliquer ${sel.length} correction(s)`, `
      ${sous.length ? `<p class="badge alerte" style="height:auto;padding:6px 8px;margin-bottom:10px">${sous.length} correction(s) sous le seuil de ${pct(SEUIL_LOT)} : elles seront exclues du lot. Applique-les une à une après vérification.</p>` : ''}
      <table class="mini-table avant-apres"><tr><th>Produit</th><th>Champ</th><th>Avant</th><th>Après</th><th>Confiance</th></tr>
      ${sel.filter((p) => p.confiance >= SEUIL_LOT).slice(0, 300).map((p) => { const c = p.correction; const ch = c.type === 'code' ? 'code' : c.champ; return `<tr><td>${nomCourt(ARTS.get(c.articleId))}</td><td>${libelleChamp(ch)}</td><td class="av">${valeurLisible(ch, c.avant)}</td><td class="ap">${valeurLisible(ch, c.apres)}</td><td>${confiance(p.confiance)}</td></tr>`; }).join('')}
      </table>`, [
      ['Annuler', 'fermer'],
      ['Appliquer', 'principal', () => {
        const lot = ++nLot;
        const ok = sel.filter((p) => p.confiance >= SEUIL_LOT);
        ok.forEach((p) => appliquerCorrection(p, lot));
        b.selection.clear(); reanalyser(); rendre();
        note(`${ok.length} correction(s) appliquée(s)`, { libelle: 'Annuler le lot', faire: () => annulerLot(lot) });
      }],
    ]);
  };
}

// ---------------------------------------------------------------------
// Comparateur côte à côte + fusion avec aperçu
// ---------------------------------------------------------------------
function vueComparer(t) {
  const arts = ui.comparer.map((id) => ARTS.get(id)).filter(Boolean);
  if (arts.length < 2) {
    t.innerHTML = `<div class="entete-vue"><h1>Comparateur</h1></div><div class="placeholder"><div class="boite-p"><h2 style="margin-bottom:8px">Choisis 2 à 4 produits</h2><p>Coche-les dans le catalogue puis « ⇄ Comparer », ou ouvre un doublon dans la boîte de résolution.</p><button class="btn principal" id="versBoite">Voir les doublons probables</button></div></div>`;
    $('#versBoite').onclick = () => { ui.boite.regle = 'doublon_probable'; aller('boite'); };
    return;
  }
  if (!arts.some((a) => a.id === ui.cibleFusion)) ui.cibleFusion = arts[0].id;
  const lignes = [
    ['Photo', (a) => vignette(a, true)],
    ['Nom', (a) => esc(a.nom)],
    ['Marque ★', (a) => esc(a.marque || '—')],
    ['Rayon', (a) => esc(rayonNom(a.rayonId))],
    ['Format ★', (a) => esc(formatLisible(a.format) || '—')],
    ['Comparé', (a) => 'au ' + UNITES[a.uniteRef]],
    ['Variantes', (a) => variantesActives(a).map((v) => `${esc(v.marque || 'sans marque')} · ${esc(v.format || '—')}`).join('<br>')],
    ['Codes-barres', (a) => codesDe(a).map((c) => `<span class="code ${gtinValide(c) ? 'ok' : 'ko'}">${c}</span>`).join('<br>') || '—'],
    ['Noms sur reçus', (a) => variantesActives(a).flatMap((v) => v.alias || []).map((x) => `<span class="alias">${esc(x.libelle)}</span>`).join('') || '—'],
    ['Meilleur prix', (a) => { const m = meilleurPrix(E, a, A.prixParArticle); return m ? `${libelleUnitaire(m.pu, a.uniteRef).split(' · ')[0]} · ${BANNIERES[m.banniere]}` : '—'; }],
    ['Prix observés', (a) => String(A.prixParArticle.get(a.id)?.length || 0)],
    ['Complétude', (a) => jauge(compDe(a).ok)],
    ['Problèmes', (a) => prios(A.parArticle.get(a.id))],
  ];
  const cellule = (f, a) => f(a);
  const differe = (f) => new Set(arts.map((a) => cellule(f, a).replace(/<[^>]+>/g, ''))).size > 1;
  const ap = apercuFusion(E, arts.filter((a) => a.id !== ui.cibleFusion).map((a) => a.id));
  t.innerHTML = `
    <div class="entete-vue"><h1>Comparateur</h1><span class="muet">${arts.length} produits · les différences sont surlignées</span>
      <span style="flex:1"></span><button class="btn" id="viderComp">Vider</button></div>
    <div class="comparateur">
      <div class="grille-comp" style="--n:${arts.length}">
        <div class="lib">Garder</div>${arts.map((a) => `<div class="tete-col ${a.id === ui.cibleFusion ? 'cible-fusion' : ''}"><label><input type="radio" name="cible" value="${a.id}" ${a.id === ui.cibleFusion ? 'checked' : ''}> <strong>Fiche à garder</strong></label><span class="mono discret">${a.id}</span></div>`).join('')}
        ${lignes.map(([l, f]) => { const d = differe(f); return `<div class="lib">${l}</div>${arts.map((a) => `<div class="${d && l !== 'Photo' ? 'diff' : ''}">${cellule(f, a)}</div>`).join('')}`; }).join('')}
      </div>
      <div class="panneau" style="margin-top:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:280px"><h2 style="margin-bottom:6px">Aperçu de la fusion</h2>
          <span class="muet">La fiche « ${nomCourt(ARTS.get(ui.cibleFusion))} » reçoit <b>${ap.variantes}</b> variante(s), <b>${ap.prix}</b> prix et <b>${ap.autres}</b> autre(s) référence(s) (liste, reçus, photos). Les autres fiches sont retirées. Les prix ne sont jamais effacés.</span></div>
        <button class="btn" id="pasDoublons">Pas des doublons</button>
        <button class="btn principal" id="fusionner">Fusionner dans la fiche gardée…</button>
      </div>
    </div>`;
  t.querySelectorAll('input[name="cible"]').forEach((x) => x.onchange = () => { ui.cibleFusion = x.value; vueComparer(t); });
  $('#viderComp').onclick = () => { ui.comparer = []; vueComparer(t); rendreNav(); };
  $('#pasDoublons').onclick = () => {
    if (lectureSeule()) return;
    for (const a of arts) { a.pasDoublon = [...new Set([...(a.pasDoublon || []), ...arts.filter((x) => x !== a).map((x) => x.id)])]; aPersister(a.id); }
    historique.unshift({ id: historique.length + 1, quand: new Date().toISOString(), articleId: arts[0].id, nom: arts[0].nom, champ: 'pasDoublon', avant: null, apres: arts.map((a) => a.id).join(' + '), source: 'console' });
    reanalyser(); ui.comparer = []; aller('boite'); note('Marqués comme produits différents : ils ne seront plus proposés.');
  };
  $('#fusionner').onclick = () => lectureSeule('fusion') || modale('Confirmer la fusion', `<p>Fusionner ${arts.length - 1} fiche(s) dans « <b>${nomCourt(ARTS.get(ui.cibleFusion))}</b> » ?</p>
    <p class="muet">Maquette : la fusion utilise la même fonction que le téléphone (<span class="mono">fusionner</span>). Elle peut être annulée tant que c'est la dernière opération. En phase 4, chaque fiche retirée reste dans l'historique de la base.</p>`, [
    ['Annuler', 'fermer'],
    ['Fusionner', 'principal', () => {
      const instantane = structuredClone({ articles: E.articles, prix: E.prix, liste: E.liste, photos: E.photos, recus: E.recus });
      const sources = arts.filter((a) => a.id !== ui.cibleFusion).map((a) => a.id);
      fusionner(E, ui.cibleFusion, sources);
      historique.unshift({ id: historique.length + 1, quand: new Date().toISOString(), articleId: ui.cibleFusion, nom: ARTS.get(ui.cibleFusion).nom, champ: 'fusion', avant: sources.join(' + '), apres: ui.cibleFusion, source: 'console', instantane, n: historique.length });
      reanalyser(); const cible = ui.cibleFusion; ui.comparer = []; ouvrirArticle(cible); aller('catalogue');
      note(`${sources.length} fiche(s) fusionnée(s)`, { libelle: 'Annuler', faire: () => annulerFusion(historique.find((h) => h.champ === 'fusion' && h.apres === cible && !h.restauree)) });
    }],
  ]);
}
function annulerFusion(h) {
  if (!h?.instantane) return;
  if (historique[0] !== h) { note('Annulation impossible : d\'autres modifications ont suivi. (En phase 4 : restauration depuis l\'historique de la base.)'); return; }
  Object.assign(E, h.instantane); h.restauree = true; h.instantane = null;
  reanalyser(); rendre(); note('Fusion annulée');
}

// ---------------------------------------------------------------------
// Historique (journal de la session)
// ---------------------------------------------------------------------
function ligneHistorique(h) {
  const desc = h.champ === 'fusion' ? `fusion de ${esc(h.avant)} → ${esc(h.apres)}`
    : h.champ === 'pasDoublon' ? `pas des doublons : ${esc(h.apres)}`
    : `${libelleChamp(h.champ)} : <span class="avant">${valeurLisible(h.champ, h.avant)}</span> → <span class="apres">${valeurLisible(h.champ, h.apres)}</span>`;
  const src = { console: 'toi (console)', regle: 'règle approuvée', restauration: 'restauration' }[h.source] || h.source;
  const peut = !h.restauree && h.source !== 'restauration' && h.champ !== 'pasDoublon' && (h.champ !== 'fusion' || h.instantane);
  return `<li class="console"><div><b>${esc((h.nom || '').trim())}</b> <span class="discret">· ${heure(h.quand)} · ${src}${h.lot ? ' · lot ' + h.lot : ''}</span></div>
    <div>${desc}</div>${peut ? `<button class="btn petit" data-restaurer="${h.id}" style="margin-top:4px">↺ Restaurer l'ancienne valeur</button>` : h.restauree ? '<span class="discret">restaurée</span>' : ''}</li>`;
}
function brancherHistorique(zone) {
  zone.querySelectorAll('[data-annuler-base]').forEach((b) => b.onclick = () => revenirAvant(+b.dataset.annulerBase));
  zone.querySelectorAll('[data-restaurer-produit]').forEach((b) => b.onclick = () => restaurerProduit(+b.dataset.restaurerProduit));
  zone.querySelectorAll('[data-restaurer]').forEach((b) => b.onclick = () => restaurer(historique.find((h) => h.id === +b.dataset.restaurer)));
}
/** Ligne d'historique lue dans la base : qui, quand, d'où, et les champs changés. */
function ligneHistoBase(h) {
  const nom = h.type === 'article' ? (ARTS.get(h.id)?.nom || (h.data || h.data_avant)?.nom || h.id) : `${h.type} · ${h.id}`;
  const src = { telephone: 'téléphone', console: 'console', ia: 'IA', restauration: 'restauration' }[h.source] || h.source;
  const op = { insert: 'création', update: 'modification', delete: 'suppression' }[h.operation] || h.operation;
  const diffs = h.operation === 'update' ? differences(h.data_avant, h.data) : [];
  return `<li class="${h.source === 'console' ? 'console' : ''}"><div><b>${esc(String(nom).trim())}</b> <span class="discret">· ${dateCourte(h.quand)} ${heure(h.quand)} · ${op} · ${esc(src)} · ${esc(source?.nomMembre(h.par) || '')} · v${h.version}</span></div>
    ${diffs.map((d) => `<div>${esc(d.champ)} : <span class="avant">${esc(d.avant)}</span> → <span class="apres">${esc(d.apres)}</span></div>`).join('')}
    ${h.type === 'article' && h.supprime ? `<div class="muet">🗑 produit supprimé du catalogue</div>${!ARTS.get(h.id) && h.data ? `<button class="btn petit" data-restaurer-produit="${h.hid}" style="margin-top:4px">↺ Restaurer ce produit</button>` : ''}`
      : h.type === 'article' && h.operation === 'update' && h.data_avant && ARTS.get(h.id) ? `<button class="btn petit" data-annuler-base="${h.hid}" style="margin-top:4px">↺ Revenir à avant ce changement</button>` : ''}</li>`;
}
function vueHistorique(t) {
  if (MODE === 'reel') {
    t.innerHTML = `<div class="entete-vue"><h1>Historique</h1><span class="muet">${histoBase.length} dernière(s) modification(s) enregistrée(s) par la base · téléphone et console · « Revenir à avant » annule un changement</span></div>
      <div class="defile">${histoBase.length ? `<ul class="chrono" style="max-width:1100px">${histoBase.map(ligneHistoBase).join('')}</ul>` : '<div class="placeholder"><div class="boite-p">Aucune modification depuis l\'installation de l\'historique (C2).<br><span class="muet">Coche un article sur le téléphone : il apparaît ici en quelques secondes.</span></div></div>'}</div>`;
    brancherHistorique(t);
    return;
  }
  t.innerHTML = `<div class="entete-vue"><h1>Historique</h1><span class="muet">${historique.length} modification(s) dans cette session · ancienne valeur, nouvelle valeur, auteur, heure</span></div>
    <div class="defile">${historique.length ? `<ul class="chrono" style="max-width:900px">${historique.map(ligneHistorique).join('')}</ul>` : '<div class="placeholder"><div class="boite-p">Aucune modification pour l\'instant.<br><span class="muet">En phase 4, cette vue lira <span class="mono">objets_historique</span> : toutes les modifications, du téléphone comme de la console.</span></div></div>'}</div>`;
  brancherHistorique(t);
}

function vuePrevue(t, id) {
  const item = VUES.flatMap(([, x]) => x).find((x) => x[0] === id);
  t.innerHTML = `<div class="entete-vue"><h1>${esc(item?.[2] || 'Vue')}</h1><span class="badge">Prévu à l'étape ${item?.[3] || '—'}</span></div>
    <div class="placeholder"><div class="boite-p"><p>${esc(PREVU[id] || '')}</p><p class="muet">La maquette C1 valide la navigation, le catalogue, la boîte de résolution et le comparateur. Cette vue arrive à l'étape indiquée (feuille de route dans console/ARCHITECTURE.md).</p></div></div>`;
}

// ---------------------------------------------------------------------
// Modale
// ---------------------------------------------------------------------
function modale(titre, corps, boutons) {
  const v = document.createElement('div');
  v.className = 'voile';
  v.innerHTML = `<div class="modale" role="dialog" aria-modal="true" aria-label="${esc(titre)}"><div class="tete-m"><h2 style="text-transform:none;letter-spacing:0;color:var(--texte);font-size:17px">${esc(titre)}</h2></div><div class="corps-m">${corps}</div><div class="pied-m"></div></div>`;
  const pied = v.querySelector('.pied-m');
  const fermer = () => v.remove();
  for (const [lib, style, f] of boutons) {
    const b = document.createElement('button');
    b.className = 'btn' + (style === 'principal' ? ' principal' : '');
    b.textContent = lib;
    b.onclick = () => { if (style === 'fermer') return fermer(); if (f?.() !== false) fermer(); };
    pied.append(b);
  }
  v.addEventListener('mousedown', (ev) => { if (ev.target === v) fermer(); });
  v.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); fermer(); } });
  document.body.append(v);
  (v.querySelector('input,select') || pied.lastElementChild).focus();
  return v;
}

// ---------------------------------------------------------------------
// Palette de recherche globale (Ctrl K)
// ---------------------------------------------------------------------
function construireIndex() {
  index = E.articles.map((a) => ({ a, txt: sansAccents([a.nom, a.marque, a.id, ...codesDe(a), ...variantesActives(a).flatMap((v) => [v.marque, ...(v.alias || []).map((x) => x.libelle)]), rayonNom(a.rayonId)].join(' ')) }));
}
function ouvrirPalette() {
  if (document.querySelector('.palette')) return;
  if (!index) construireIndex();
  const v = document.createElement('div');
  v.className = 'voile';
  v.innerHTML = `<div class="modale palette" role="dialog" aria-label="Recherche"><input placeholder="Produit, code-barres, marque, rayon, nom de reçu, problème…" aria-label="Rechercher"><div class="resultats" role="listbox"></div></div>`;
  document.body.append(v);
  const input = v.querySelector('input'), zone = v.querySelector('.resultats');
  let res = [], sel = 0;
  const fermer = () => v.remove();
  const choisir = (r) => { fermer(); r.faire(); };
  const chercher = () => {
    const q = sansAccents(input.value).trim();
    const mots = q.split(/\s+/).filter(Boolean);
    const vues = VUES.flatMap(([, x]) => x).filter((x) => !q || sansAccents(x[2]).includes(q)).slice(0, q ? 4 : 5)
      .map((x) => ({ groupe: 'Aller à', html: `<span class="ico">${x[1]}</span> ${x[2]}`, type: x[3] ? 'étape ' + x[3] : 'vue', faire: () => aller(x[0]) }));
    const regles = Object.entries(REGLES).filter(([, r]) => q && sansAccents(r.titre).includes(q)).map(([code, r]) => ({ groupe: 'Problèmes', html: `<span class="prio p${r.priorite}">P${r.priorite}</span> ${r.titre}`, type: nf(A.problemes.filter((p) => p.code === code).length), faire: () => { ui.boite.regle = code; aller('boite'); } }));
    const prods = !mots.length ? [] : index.filter((x) => mots.every((m) => x.txt.includes(m))).slice(0, 40).map(({ a }) => ({
      groupe: 'Produits', html: `${vignette(a)} <span>${esc(a.nom)}</span> <span class="discret">${esc(a.marque || '')} · ${esc(formatLisible(a.format) || '')}</span>`,
      type: `${prios(A.parArticle.get(a.id))} <span class="mono">${a.id}</span>`, faire: () => { aller('catalogue'); ouvrirArticle(a.id); setTimeout(() => tableCourante?.focusParId(a.id), 30); },
    }));
    res = [...prods, ...regles, ...vues]; sel = 0;
    let g = '';
    zone.innerHTML = res.map((r, i) => { const h = r.groupe !== g ? `<h3>${r.groupe}</h3>` : ''; g = r.groupe; return `${h}<div class="res" role="option" data-i="${i}" aria-selected="${i === sel}">${r.html}<span class="type">${r.type}</span></div>`; }).join('') || '<div class="res muet">Rien trouvé. Essaie un code-barres, une marque ou un mot du nom.</div>';
  };
  const majSel = () => zone.querySelectorAll('.res[data-i]').forEach((el) => { el.setAttribute('aria-selected', +el.dataset.i === sel); if (+el.dataset.i === sel) el.scrollIntoView({ block: 'nearest' }); });
  input.oninput = chercher;
  input.onkeydown = (ev) => {
    if (ev.key === 'ArrowDown') { sel = Math.min(res.length - 1, sel + 1); majSel(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = Math.max(0, sel - 1); majSel(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && res[sel]) choisir(res[sel]);
    else if (ev.key === 'Escape') { ev.stopPropagation(); fermer(); }
  };
  zone.onclick = (ev) => { const r = ev.target.closest('[data-i]'); if (r) choisir(res[+r.dataset.i]); };
  v.addEventListener('mousedown', (ev) => { if (ev.target === v) fermer(); });
  chercher(); input.focus();
}

// ---------------------------------------------------------------------
// Copilote (version règles : comprend quelques demandes ; l'IA arrive à l'étape C6)
// ---------------------------------------------------------------------
const INTENTIONS = [
  [/sans format|format manquant|format/, 'format_manquant'], [/code.*invalide|invalide|gtin|chiffre de contr/, 'gtin_invalide'],
  [/meme code|même code|code partag/, 'code_partage'], [/prix (suspect|aberrant|bizarre)|suspect/, 'prix_aberrant'],
  [/sans marque|marque manquante/, 'marque_manquante'], [/divers|non class|sans rayon/, 'rayon_divers'],
  [/sans photo|photo/, 'photo_manquante'], [/unite|unité/, 'format_unite'], [/normalis|majuscule|espace/, 'nom_a_normaliser'],
];
function rendreCopilote() {
  const c = $('#copilote');
  c.innerHTML = `<div class="tete-c"><span style="color:var(--ia)">✦</span><strong>Copilote</strong><span class="badge">règles · IA en C6</span><span style="flex:1"></span><button class="bouton-icone" id="fermerCop" title="Fermer (])">✕</button></div>
    <div class="fil-c" id="filCop"><div class="bulle">Demande-moi une liste de produits à corriger. Pour l'instant je comprends des demandes simples (version règles, sans IA ni coût). À l'étape C6, Claude comprendra des demandes libres et fera des propositions à approuver.</div>
      ${['Trouve tous les produits dont le format est manquant', 'Identifie les doublons potentiels du riz basmati', 'Montre les codes-barres invalides', 'Quels prix sont suspects ?'].map((s) => `<button class="suggestion-c">${s}</button>`).join('')}</div>
    <form id="formCop"><input class="champ" id="entreeCop" placeholder="Ex. produits sans marque dans les surgelés" aria-label="Demande au copilote"><button class="btn ia">Envoyer</button></form>`;
  $('#fermerCop').onclick = basculerCopilote;
  c.querySelectorAll('.suggestion-c').forEach((b) => b.onclick = () => demander(b.textContent));
  $('#formCop').onsubmit = (ev) => { ev.preventDefault(); const v = $('#entreeCop').value.trim(); if (v) { demander(v); $('#entreeCop').value = ''; } };
}
function demander(texte) {
  const fil = $('#filCop');
  fil.insertAdjacentHTML('beforeend', `<div class="bulle moi">${esc(texte)}</div>`);
  const q = sansAccents(texte);
  // « doublons du riz basmati » → doublons + filtre
  const sujet = (q.match(/\b(?:du|de la|de l'|des|de)\s+(.+?)\s*\??$/) || [])[1]?.replace(/^(produits?|les?)\s+/, '');
  let reponse;
  if (/doublon/.test(q)) {
    const n1 = A.problemes.filter((p) => /doublon/.test(p.code) && (!sujet || p.cibles.some((id) => sansAccents(ARTS.get(id)?.nom).includes(sujet))));
    ui.boite.regle = n1.some((p) => p.code === 'doublon_probable') || !n1.length ? 'doublon_probable' : 'doublon_possible';
    ui.boite.texte = sujet || ''; aller('boite');
    reponse = `${n1.length} doublon(s) ${sujet ? `pour « ${esc(sujet)} »` : ''} (probables et possibles). J'ai ouvert la boîte de résolution, filtrée. Compare avant de fusionner.`;
  } else {
    const it = INTENTIONS.find(([re]) => re.test(q));
    if (it) {
      const rayon = E.rayons.find((r) => q.includes(sansAccents(r.nom).split(/[ (]/)[0]));
      ui.boite.regle = it[1]; ui.boite.texte = ''; aller('boite');
      const n = A.problemes.filter((p) => p.code === it[1]).length;
      reponse = `${nf(n)} produit(s) : « ${REGLES[it[1]].titre} ». Ouvert dans la boîte de résolution.${rayon ? ' (Le filtre par rayon arrivera avec l\'IA.)' : ''}`;
    } else {
      ui.filtre.texte = texte; ui.filtre.etat = 'tous'; aller('catalogue');
      const n = articlesFiltres().length;
      reponse = `Je n'ai pas reconnu de règle : j'ai cherché « ${esc(texte)} » dans le catalogue (${nf(n)} résultat(s)).`;
    }
  }
  fil.insertAdjacentHTML('beforeend', `<div class="bulle">${reponse}</div>`);
  fil.scrollTop = fil.scrollHeight;
}
function basculerCopilote() {
  const c = $('#copilote');
  c.hidden = !c.hidden;
  prefs.copilote = !c.hidden; sauverPrefs();
  $('#basculeCopilote').setAttribute('aria-pressed', !c.hidden);
  $('#coque').style.setProperty('--copilote', c.hidden ? '0px' : '380px');
  appliquerLargeurDetail();
  if (!c.hidden) { if (!c.innerHTML) rendreCopilote(); setTimeout(() => $('#entreeCop')?.focus(), 0); }
}

// ---------------------------------------------------------------------
// Aide, thème, densité, panneau redimensionnable
// ---------------------------------------------------------------------
function aide() {
  modale('Raccourcis clavier', `<div class="aide-touches">
    ${[['Ctrl K  ou  /', 'Rechercher partout'], ['j / k  ou  ↓ / ↑', 'Ligne suivante / précédente'], ['Entrée', 'Ouvrir la fiche'], ['x  ou  Espace', 'Cocher la ligne'], ['e', 'Modifier le nom (catalogue)'],
      ['a / r', 'Appliquer / écarter le problème (boîte)'], ['c', 'Comparer la sélection'], ['g puis c / b / d', 'Aller au catalogue / à la boîte / au tableau de bord'], [']', 'Copilote'], ['[', 'Fermer la fiche'], ['Échap', 'Fermer'], ['?', 'Cette aide']]
      .map(([k, l]) => `<span>${k.split('  ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</span><span>${l}</span>`).join('')}</div>`, [['Fermer', 'fermer']]);
}
$('#theme').onclick = () => { const t = document.documentElement.dataset.theme === 'clair' ? 'sombre' : 'clair'; document.documentElement.dataset.theme = t; prefs.theme = t; sauverPrefs(); };
$('#densite').onclick = () => {
  const ordre = ['compacte', 'normale', 'aeree'];
  const d = ordre[(ordre.indexOf(document.documentElement.dataset.densite || 'normale') + 1) % 3];
  document.documentElement.dataset.densite = d; prefs.densite = d; sauverPrefs();
  note(`Densité : ${{ compacte: 'compacte (28 px)', normale: 'normale (32 px)', aeree: 'aérée (40 px)' }[d]}`);
  tableCourante?.donnees(tableCourante.items);
};
$('#basculeCopilote').onclick = basculerCopilote;
$('#aide').onclick = aide;
$('#ouvrirPalette').onclick = ouvrirPalette;
$('#poigneeDetail').onmousedown = (ev) => {
  ev.preventDefault();
  const x0 = ev.clientX, l0 = $('#detail').offsetWidth;
  const bouger = (e) => { prefs.detail = Math.max(360, Math.min(innerWidth * 0.6, l0 - (e.clientX - x0))); appliquerLargeurDetail(); };
  const fin = () => { removeEventListener('mousemove', bouger); removeEventListener('mouseup', fin); sauverPrefs(); };
  addEventListener('mousemove', bouger); addEventListener('mouseup', fin);
};

let prefixeG = false;
document.addEventListener('keydown', (ev) => {
  const saisie = ev.target.closest?.('input, select, textarea');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ouvrirPalette(); return; }
  if (ev.key === 'Escape') {
    if (document.querySelector('.voile')) return;
    if (ui.articleOuvert) { fermerDetail(); return; }
  }
  if (saisie || document.querySelector('.voile') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const tv = tableCourante;
  if (prefixeG) {
    prefixeG = false;
    const dest = { c: 'catalogue', b: 'boite', d: 'tdb', h: 'historique' }[ev.key];
    if (dest) { aller(dest); ev.preventDefault(); }
    return;
  }
  switch (ev.key) {
    case '/': ev.preventDefault(); ouvrirPalette(); break;
    case '?': aide(); break;
    case 'g': prefixeG = true; setTimeout(() => (prefixeG = false), 1200); break;
    case ']': basculerCopilote(); break;
    case '[': fermerDetail(); break;
    case 'j': case 'ArrowDown': if (tv) { ev.preventDefault(); tv.focus(tv.focusI + 1); } break;
    case 'k': case 'ArrowUp': if (tv) { ev.preventDefault(); tv.focus(tv.focusI - 1); } break;
    case 'Enter': { const it = tv?.items[tv.focusI]; if (it && !it.groupe) ouvrirArticle(it.cibles ? it.cibles[0] : it.id); break; }
    case 'x': case ' ': {
      const it = tv?.items[tv.focusI];
      if (!it || it.groupe) break;
      ev.preventDefault();
      const s = ui.vue === 'boite' ? ui.boite.selection : ui.selection;
      const k = it.cle && ui.vue === 'boite' ? it.cle : it.id;
      if (s.has(k)) s.delete(k); else s.add(k);
      tv.rafraichir(); if (ui.vue === 'catalogue') barreSelection(); else if (ui.vue === 'boite') vueBoite($('#travail'));
      break;
    }
    case 'e': { const it = tv?.items[tv.focusI]; if (ui.vue === 'catalogue' && it && !it.groupe) { ev.preventDefault(); editerCellule(it.id, 'nom'); } break; }
    case 'a': if (ui.vue === 'boite') ui.actionFocus?.('appliquer'); break;
    case 'r': if (ui.vue === 'boite') ui.actionFocus?.('ignorer'); break;
    case 'c': if (ui.selection.size >= 2 && ui.selection.size <= 4) { ui.comparer = [...ui.selection]; aller('comparer'); } break;
  }
});

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
ui.vue = location.hash.slice(2) || 'tdb';
if (prefs.copilote && innerWidth > 1300) basculerCopilote();
window.__console = { E: () => E, A: () => A, ui, historique, histoBase: () => histoBase, mode: MODE, recevoir: (l) => recevoir(l) }; // inspection pendant les tests
// Tests en local seulement : brancher une fausse base (même interface que SourceSupabase). Inactif en ligne.
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__console.tester = async (faux) => { source = faux; await chargerTout(); };
demarrer();

async function demarrer() {
  if (MODE === 'fictif') { E = genererEtat(5000); reanalyser(); rendre(); return; }
  rendreNav(); majSynchro();
  ecranAttente('Connexion à ta base…');
  try {
    source = new SourceSupabase();
    const session = await source.connecter();
    if (!session) { ecranConnexion(); return; }
    await chargerTout();
  } catch (err) {
    console.warn(err);
    etatSynchro('erreur', 'Base injoignable');
    ecranAttente(`Impossible de joindre la base : ${esc(err.message || err)}. Vérifie ta connexion Internet, puis recharge la page.`, true);
  }
}

async function chargerTout() {
  ecranAttente('Lecture de ton foyer…');
  const foyer = await source.chargerFoyer();
  if (!foyer) { ecranAttente('Ce compte n\'a pas encore de foyer. Crée-le ou joins-le dans l\'app téléphone (Plus → Mon foyer et partage).', true); etatSynchro('erreur', 'Aucun foyer'); return; }
  const lignes = await source.chargerObjets((n) => ecranAttente(`Lecture de ton foyer… ${n} élément(s)`));
  E = construireEtat(lignes, source.membres);
  try { histoBase = await source.chargerHistorique(); } catch (err) { console.warn('Historique', err); histoBase = []; }
  reanalyser();
  etatSynchro('ok', `Vraies données · « ${foyer.nom} »`);
  rendre();
  source.ecouter(recevoir, (statut) => {
    if (statut === 'SUBSCRIBED' && !attente.size) etatSynchro('ok', `Vraies données · « ${foyer.nom} » · temps réel actif`);
    else if (statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT') etatSynchro('erreur', 'Temps réel interrompu · recharge la page');
  });
}

function etatSynchro(etat, texte) { synchro.etat = etat; synchro.texte = texte; majSynchro(); }

// ---------------------------------------------------------------------
// Écriture dans la base (étape C4) : un produit modifié est envoyé en entier avec sa version.
// La base refuse si le produit a changé ailleurs entre-temps (conflit) → rien n'est écrasé en silence.
// ---------------------------------------------------------------------
const attente = new Map();        // articleId → source ('console' | 'restauration')
const mesEcritures = new Set();   // `${id}:${version}` écrits par cette console (écho temps réel silencieux)
let enEcriture = false, minuterieEcrire = null;
function aPersister(id, src = 'console') {
  if (MODE !== 'reel' || !source?.foyer) return;
  if (attente.get(id) !== 'restauration') attente.set(id, src);
  clearTimeout(minuterieEcrire);
  minuterieEcrire = setTimeout(ecrireAttente, 80);
  etatSynchro('local', `Enregistrement… ${attente.size} produit(s)`);
}
async function ecrireAttente() {
  if (enEcriture) { minuterieEcrire = setTimeout(ecrireAttente, 250); return; }
  enEcriture = true;
  const echecs = [], conflits = [];
  let n = 0;
  try {
    for (const [id, src] of [...attente]) {
      const a = ARTS.get(id);
      if (!a) { attente.delete(id); continue; }
      try {
        const v = await source.ecrire('article', id, a, a._version ?? null, src);
        a._version = v; a._base = JSON.parse(JSON.stringify(a)); mesEcritures.add(`${id}:${v}`); attente.delete(id); n++;
      } catch (err) {
        if (err.conflit) { attente.delete(id); conflits.push(id); } else echecs.push(err);
      }
    }
  } finally { enEcriture = false; }
  if (echecs.length) etatSynchro('erreur', `${attente.size} modification(s) non enregistrée(s) · ${echecs[0].message} · clique ici pour réessayer`);
  else if (n) etatSynchro('ok', `Enregistré dans ta base · ${n} produit(s) · ${heure(new Date().toISOString())}`);
  try { histoBase = await source.chargerHistorique(); } catch { /* garde l'ancien */ }
  rendreNav();
  if (ui.vue === 'historique' || ui.vue === 'tdb') rendre(); else rendreDetail();
  for (const id of conflits) await resoudreConflit(id);
}
$('#synchro').onclick = () => { if (MODE === 'reel' && attente.size) ecrireAttente(); };

/** Remplace en mémoire un produit par sa version de la base. */
function remplacerParBase(l) {
  const neuf = l && !l.supprime ? construireEtat([l], source.membres).articles[0] : null;
  const i = E.articles.findIndex((x) => x.id === (l?.id));
  if (i >= 0) { if (neuf) E.articles[i] = neuf; else E.articles.splice(i, 1); }
}

/** Champs que J'AI changés depuis la dernière version connue de la base (variantes : recalculées, jamais imposées). */
function mesChamps(a, mienne) {
  const base = a?._base || {};
  return [...new Set([...Object.keys(base), ...Object.keys(mienne)])]
    .filter((k) => !['variantes', 'variantePreferee'].includes(k) && JSON.stringify(base[k]) !== JSON.stringify(mienne[k]));
}

/** Conflit : le produit a changé ailleurs (téléphone). On montre les deux versions ; Chris choisit. */
async function resoudreConflit(id) {
  const a0 = ARTS.get(id);
  const mienne = JSON.parse(JSON.stringify(a0 || {}));
  const miens = mesChamps(a0, mienne);
  let l;
  try { l = await source.relire('article', id); } catch (err) { note(`Conflit sur ${esc(id)} : impossible de relire la base (${esc(err.message)}).`); return; }
  remplacerParBase(l);
  reanalyser(); rendre();
  if (!l || l.supprime) { note(`« ${esc(mienne.nom || id)} » a été retiré sur un autre appareil : ta modification n'a pas été enregistrée.`); return; }
  const diffs = differences(l.data, mienne, 12);
  etatSynchro('erreur', 'Conflit à régler : un produit a changé sur un autre appareil');
  modale('Conflit : produit modifié ailleurs', `
    <p>« <b>${esc(String(l.data.nom || id).trim())}</b> » a été modifié sur un autre appareil (v${l.version}) pendant que tu le changeais ici.
    <b>Ta modification n'a pas été enregistrée</b> ; la console affiche maintenant la version de la base.</p>
    ${diffs.length ? `<table class="mini-table avant-apres"><tr><th>Champ</th><th>Dans la base</th><th>Ta version</th></tr>
      ${diffs.map((d) => `<tr><td>${esc(d.champ)}</td><td class="av">${esc(d.avant)}</td><td class="ap">${esc(d.apres)}</td></tr>`).join('')}</table>` : '<p class="muet">Aucune différence de contenu : rien à faire.</p>'}`, [
    ['Garder la version de la base', 'fermer'],
    ...(diffs.length ? [['Remplacer par ma version', '', () => {
      const a = ARTS.get(id); if (!a) return;
      for (const k of Object.keys(a)) delete a[k];
      Object.assign(a, mienne);                // garde _version de la base (non énumérable) → nouvelle écriture contrôlée
      reanalyser(); rendre(); aPersister(id);
    }]] : []),
    ...(diffs.length && miens.length ? [[`Garder les deux : appliquer seulement mes changements (${miens.join(', ')})`, 'principal', () => {
      const a = ARTS.get(id); if (!a) return;
      for (const k of miens) { if (mienne[k] === undefined) delete a[k]; else a[k] = JSON.parse(JSON.stringify(mienne[k])); }
      reanalyser(); rendre(); aPersister(id);   // normaliserProduits recalcule la variante ★ à partir de la fiche
    }]] : []),
  ]);
}

/**
 * Supprimer des produits du catalogue — même règle que le téléphone (fiche produit → « Supprimer du catalogue ») :
 * le produit est retiré du catalogue ET de la liste, les recettes ne le pointent plus, son historique de prix est GARDÉ.
 * Dans la base : suppression douce (supprime = true), visible dans l'historique et restaurable.
 */
function supprimerProduits(ids) {
  const arts = ids.map((id) => ARTS.get(id)).filter(Boolean);
  if (!arts.length) return;
  const set = new Set(arts.map((a) => a.id));
  const lignes = (E.liste || []).filter((l) => set.has(l.articleId));
  const recettes = (E.recettes || []).filter((r) => (r.ingredients || []).some((i) => set.has(i.articleId)));
  const nPrix = (E.prix || []).filter((p) => set.has(p.articleId)).length;
  modale(`Supprimer ${arts.length} produit(s) du catalogue`, `
    <table class="mini-table"><tr><th>Produit</th><th>Rayon</th><th>Prix gardés</th></tr>
      ${arts.slice(0, 100).map((a) => `<tr><td>${nomCourt(a)}</td><td>${esc(rayonNom(a.rayonId))}</td><td class="mono">${(A.prixParArticle.get(a.id) || []).length}</td></tr>`).join('')}</table>
    ${arts.length > 100 ? `<p class="discret">… et ${arts.length - 100} autres.</p>` : ''}
    <ul style="margin:12px 0 0;padding-left:18px">
      <li>Retirés de la <b>liste</b> : ${lignes.length} ligne(s).</li>
      <li>Recettes qui ne pointeront plus vers ces produits : ${recettes.length}.</li>
      <li><b>Historique des prix gardé</b> : ${nPrix} prix (jamais effacés).</li>
      <li>${MODE === 'reel' ? 'Restaurable depuis l\'<b>Historique</b> de la console (« Restaurer ce produit »). Les lignes de liste ne reviennent pas toutes seules.' : 'Démo : rien n\'est envoyé.'}</li>
    </ul>`, [
    ['Annuler', 'fermer'],
    [`Supprimer ${arts.length} produit(s)`, 'principal', () => { executerSuppression(arts, lignes, recettes); }],
  ]);
}
async function executerSuppression(arts, lignes, recettes) {
  const set = new Set(arts.map((a) => a.id));
  const retirerLocal = (idsArts, idsLignes) => {
    E.articles = E.articles.filter((a) => !idsArts.has(a.id));
    E.liste = (E.liste || []).filter((l) => !idsLignes.has(l.id));
    for (const r of recettes) for (const i of r.ingredients || []) if (idsArts.has(i.articleId)) i.articleId = null;
    for (const id of idsArts) { ui.selection.delete(id); if (ui.articleOuvert === id) fermerDetail(); }
    reanalyser(); rendre();
  };
  if (MODE !== 'reel') { retirerLocal(set, new Set(lignes.map((l) => l.id))); note(`${arts.length} produit(s) supprimé(s) (démo)`); return; }
  etatSynchro('local', `Suppression… ${arts.length} produit(s)`);
  const faits = new Set(), lignesFaites = new Set(), problemes = [];
  const ecrireSupp = async (type, o, supprime) => {
    try { const v = await source.ecrire(type, o.id, o, o._version ?? null, 'console', supprime); o._version = v; mesEcritures.add(`${o.id}:${v}`); return true; }
    catch (err) { problemes.push(`${type} ${o.nom || o.id} : ${err.conflit ? 'modifié ailleurs entre-temps' : err.message}`); return false; }
  };
  for (const a of arts) if (await ecrireSupp('article', a, true)) faits.add(a.id);
  for (const l of lignes) if (faits.has(l.articleId) && await ecrireSupp('liste', l, true)) lignesFaites.add(l.id);
  for (const r of recettes) {
    const copie = JSON.parse(JSON.stringify(r));
    for (const i of copie.ingredients || []) if (faits.has(i.articleId)) i.articleId = null;
    Object.defineProperty(copie, '_version', { value: r._version, writable: true });
    if (await ecrireSupp('recette', copie, false)) r._version = copie._version;
  }
  retirerLocal(faits, lignesFaites);
  try { histoBase = await source.chargerHistorique(); } catch { /* garde l'ancien */ }
  rendre();
  if (problemes.length) {
    etatSynchro('erreur', `${problemes.length} élément(s) non supprimé(s) · voir le détail`);
    modale('Suppression incomplète', `<p>${faits.size} produit(s) supprimé(s). Pas fait :</p><ul>${problemes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="muet">Recharge la page puis réessaie : la console relira la dernière version.</p>`, [['Fermer', 'fermer']]);
  } else {
    etatSynchro('ok', `Supprimé · ${faits.size} produit(s) · ${heure(new Date().toISOString())}`);
    note(`${faits.size} produit(s) supprimé(s) du catalogue · restaurable depuis l'Historique`);
  }
}

/** Restaure un produit supprimé (nouvelle version, supprime = false). */
async function restaurerProduit(hid) {
  const h = histoBase.find((x) => x.hid === hid);
  if (!h?.data || MODE !== 'reel') return;
  try {
    const l = await source.relire('article', h.id);
    if (!l) { note('Produit introuvable dans la base.'); return; }
    if (!l.supprime) { note('Ce produit est déjà dans le catalogue.'); return; }
    const v = await source.ecrire('article', h.id, l.data, l.version, 'restauration', false);
    mesEcritures.add(`${h.id}:${v}`);
    const neuf = construireEtat([{ ...l, version: v, supprime: false }], source.membres).articles[0];
    if (neuf && !ARTS.get(h.id)) E.articles.push(neuf);
    try { histoBase = await source.chargerHistorique(); } catch { /* garde l'ancien */ }
    reanalyser(); rendre();
    etatSynchro('ok', `Restauré · ${heure(new Date().toISOString())}`);
    note(`« ${esc(String(l.data.nom || h.id).trim())} » est de retour dans le catalogue (pas sur la liste).`);
  } catch (err) { note(`Restauration impossible : ${esc(err.message)}`); }
}

/** « Revenir à avant ce changement » : réécrit la valeur d'avant (nouvelle version, rien n'est effacé). */
function revenirAvant(hid) {
  const h = histoBase.find((x) => x.hid === hid);
  const a = h && ARTS.get(h.id);
  if (!h?.data_avant || !a) return;
  const diffs = differences(a, h.data_avant, 12);
  if (!diffs.length) { note('Ce produit a déjà ces valeurs.'); return; }
  modale('Revenir à avant ce changement', `<p>« <b>${esc(String(a.nom).trim())}</b> » reprendra les valeurs d'avant le changement du ${dateCourte(h.quand)} à ${heure(h.quand)}.
    Rien n'est effacé : c'est une nouvelle version, elle aussi dans l'historique.</p>
    <table class="mini-table avant-apres"><tr><th>Champ</th><th>Maintenant</th><th>Après</th></tr>
    ${diffs.map((d) => `<tr><td>${esc(d.champ)}</td><td class="av">${esc(d.avant)}</td><td class="ap">${esc(d.apres)}</td></tr>`).join('')}</table>`, [
    ['Annuler', 'fermer'],
    ['Revenir à avant', 'principal', () => {
      const avant = JSON.parse(JSON.stringify(h.data_avant));
      for (const k of Object.keys(a)) delete a[k];
      Object.assign(a, avant);
      reanalyser(); rendre(); aPersister(a.id, 'restauration');
    }],
  ]);
}

/** Changement reçu en temps réel (téléphone ou autre) : mis à jour en mémoire, puis réaffiché. */
let minuterieRecu = null;
const recusTR = new Set();
function recevoir(l) {
  const coll = COLLECTIONS[l.type];
  if (!coll || l.type === 'carte' || l.type === 'point') return;
  if (l.type === 'article' && attente.has(l.id)) return; // notre envoi suivra (et détectera le conflit s'il y en a un)
  const echo = mesEcritures.has(`${l.id}:${l.version}`);
  const neuf = construireEtat([{ ...l, supprime: false }], source?.membres || [])[coll]?.[0];
  const liste = (E[coll] ||= []);
  const cle = (o) => String(l.type === 'cp' ? o.code : o.id);
  const i = liste.findIndex((o) => cle(o) === l.id);
  if (l.supprime) { if (i >= 0) liste.splice(i, 1); }
  else if (neuf) { if (i >= 0) liste[i] = neuf; else liste.push(neuf); }
  if (!echo) recusTR.add(l.id);
  clearTimeout(minuterieRecu);
  minuterieRecu = setTimeout(appliquerRecus, 400);
}
async function appliquerRecus() {
  {
    // Une modification est en cours (menu ou champ ouvert, fenêtre) : on attend qu'elle soit finie,
    // sinon le réaffichage refermerait le menu sous la souris (vu le 2026-11-16 pendant la synchro du téléphone).
    if (document.activeElement?.matches?.('[data-edit]') || document.querySelector('.voile')) { minuterieRecu = setTimeout(appliquerRecus, 700); return; }
    try { if (source?.foyer) histoBase = await source.chargerHistorique(); } catch { /* garde l'ancien */ }
    reanalyser();
    if (ui.vue === 'catalogue' && ui.remplirCatalogue) { ui.remplirCatalogue(); rendreNav(); rendreDetail(); } else rendre();
    for (const id of recusTR) tableCourante?.ligneDom(id)?.classList.add('flash');
    if (recusTR.size) note(`${recusTR.size} changement(s) reçu(s) d'un autre appareil`);
    recusTR.clear();
    if (!attente.size && synchro.etat !== 'erreur') etatSynchro('ok', `Vraies données · « ${source?.foyer?.nom || ''} » · à jour ${heure(new Date().toISOString())}`);
  }
}

function ecranAttente(message, erreur = false) {
  $('#travail').innerHTML = `<div class="placeholder"><div class="boite-p">${erreur ? '' : '<div class="tourne" aria-hidden="true"></div>'}<p>${message}</p>
    ${erreur ? '<p><a href="?demo">Voir la démo (données fictives)</a></p>' : ''}</div></div>`;
}

/** Connexion : même compte que l'app téléphone. Le mot de passe est saisi par Chris et n'est conservé nulle part par la console. */
function ecranConnexion(message = '') {
  etatSynchro('connexion', 'Non connecté');
  $('#travail').innerHTML = `<div class="placeholder"><form class="boite-p connexion" id="formConnexion" autocomplete="on">
      <h2 style="margin-bottom:6px">Connexion à ton foyer</h2>
      <p class="muet">Même compte que l'app téléphone. Chaque modification est enregistrée dans ta base, avec historique.</p>
      <label>Courriel<input class="champ" type="email" name="email" autocomplete="username" required></label>
      <label>Mot de passe<input class="champ" type="password" name="password" autocomplete="current-password" required></label>
      ${message ? `<p class="erreur">${esc(message)}</p>` : ''}
      <button class="btn principal" type="submit">Se connecter</button>
      <p class="discret">Mot de passe oublié : passe par l'app téléphone (Plus → Mon foyer et partage). · <a href="?demo">Voir la démo</a></p>
    </form></div>`;
  $('#formConnexion').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    ev.target.querySelector('button').disabled = true;
    try { await source.seConnecter(String(f.get('email')).trim(), String(f.get('password'))); await chargerTout(); }
    catch (err) { ecranConnexion(/invalid/i.test(err.message) ? 'Courriel ou mot de passe incorrect.' : err.message); }
  };
  $('#formConnexion input').focus();
}
