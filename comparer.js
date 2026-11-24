// =====================================================================
// Onglet COMPARER : vue tableau (aliments × bannières), vue détail,
// « Créer mes listes » (le moins cher en N arrêts max, avec bannières
// forcées ou ignorées) et préparation des paniers en ligne.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, offresArticle, libelleUnitaire, libelleFin, joursRestants, nomBanniere, nomBanniereVille,
  banniereActive, nomOffre, puce, toast, logo, logoVille, logoMagasin } from './ui.js';
import { BANNIERES, BANNIERES_MAGASIN } from './demo-data.js';
import { analyserFormat, formatLisible, prixComparable } from './normalise.js';
import { photoDe } from './visuels.js';

let vue = 'tableau';      // 'tableau' | 'details' | 'online' | 'econo'
let portee = 'liste';     // 'liste' | 'tout'
let maxArrets = 2;
let nbSitesEnLigne = 1;

// ---------------------------------------------------------------------
// Commande en ligne (liens vérifiés le 2026-11-15 dans un vrai navigateur).
// Un lien https ouvre l'app du magasin si elle est installée et prend ces liens en charge.
// `prixDe` : bannière dont on utilise les prix pour ce site.
// ---------------------------------------------------------------------
export const EN_LIGNE = {
  voila: { nom: 'Voilà (IGA)', prixDe: 'iga', site: 'https://voila.ca/', recherche: (q) => `https://voila.ca/search?q=${encodeURIComponent(q)}`, note: 'Épicerie en ligne d\'IGA. Prix d\'IGA en magasin à titre indicatif.' },
  metro: { nom: 'Metro', prixDe: 'metro', site: 'https://www.metro.ca/epicerie-en-ligne', recherche: (q) => `https://www.metro.ca/epicerie-en-ligne/recherche?filter=${encodeURIComponent(q)}`, note: 'App Metro.' },
  maxi: { nom: 'Maxi (PC Express)', prixDe: 'maxi', site: 'https://www.maxi.ca/fr', recherche: (q) => `https://www.maxi.ca/fr/search?search-bar=${encodeURIComponent(q)}`, note: 'App PC Express.' },
  // L'épicerie Costco en ligne passe par Instacart : on l'affiche comme tel.
  costco: { nom: 'Costco via Instacart', logo: 'instacart', prixDe: 'costco', site: 'https://www.instacart.ca/store/costco', recherche: (q) => `https://www.instacart.ca/store/costco/s?k=${encodeURIComponent(q)}`, note: 'Costco via Instacart : plus cher qu\'en entrepôt (prix affichés = prix d\'entrepôt, à titre indicatif).' },
  jean_coutu: { nom: 'Jean Coutu', prixDe: 'jean_coutu', site: 'https://www.jeancoutu.com/', recherche: (q) => `https://www.jeancoutu.com/magasiner/recherche?filter=${encodeURIComponent(q)}`, note: 'Boutique en ligne (choix limité).' },
  instacart: { nom: 'Instacart', prixDe: null, site: 'https://www.instacart.ca/', recherche: (q) => `https://www.instacart.ca/store/s?k=${encodeURIComponent(q)}`, note: '⚠️ Prix souvent plus élevés qu\'en magasin + frais.' },
};
const SITE_DE_BANNIERE = Object.fromEntries(Object.entries(EN_LIGNE).filter(([, s]) => s.prixDe).map(([k, s]) => [s.prixDe, k]));

/** Clé d'un « arrêt » : bannière, ou magasin précis quand un rabais perso s'applique. */
export const cleOffre = (o) => (o.perso ? 'perso:' + o.magasinNom : o.banniere);
export const nomCle = (k) => (k.startsWith('perso:') ? k.slice(6) : nomBanniereVille(k));
const banniereDeCle = (k) => {
  if (!k.startsWith('perso:')) return k;
  return S.get().magasins.find((m) => m.nom === k.slice(6))?.banniere || 'iga';
};

// ---------------------------------------------------------------------
// Tableau des offres d'un article (fiche + vue détail)
// ---------------------------------------------------------------------
/** v147 : pastille d'un prix hors calcul (ancien ou à venir). */
function pastilleEtat(l) {
  if (l.etat === 'aVenir') return `<span class="pastille ambre">à venir · dès le ${esc(String(l.debut).slice(0, 10))}</span>`;
  if (l.etat === 'ancien') return `<span class="pastille">${l.age != null ? `vu il y a ${l.age} j` : 'date inconnue'} · à revérifier</span>`;
  return '';
}

export function tableauOffres(a, { avecManquants = false } = {}) {
  const lignes = offresArticle(a, { avecAnciens: true });
  const presentes = new Set(lignes.map((l) => l.banniere));
  const manquantes = avecManquants ? BANNIERES_MAGASIN.filter((b) => !presentes.has(b) && banniereActive(b) && (!a.exclusif || a.exclusif === b)) : [];
  if (!lignes.length && !manquantes.length) return `<p class="doux">Aucun prix connu pour l'instant.</p>`;
  return `<table class="comp">${lignes.map((l) => `
    <tr class="${l.classe}">
      <td>${l.perso ? logoCleHtml(cleOffre(l)) : logoVille(l.banniere)}
        ${l.produitOffre ? `<div style="font-size:13px"><b>${esc(l.produitOffre)}</b></div>` : ''}
        <div class="doux">${esc(l.offre)}${l.economie ? ` <b style="color:var(--vert)">(−${argent(l.economie)})</b>` : ''}${l.format ? ` · ${esc(formatLisible(l.format))}` : ''}</div>
        <div>${pastilleEtat(l)}${l.type === 'circulaire' ? '<span class="pastille ambre">rabais</span>' : ''}${l.prixRegulier ? `<span class="pastille">rég. ${argent(l.prixRegulier)}</span>` : ''}${l.type === 'fidelite' ? '<span class="pastille vert">fidélité</span>' : ''}${l.bonus ? `<span class="pastille vert">${esc(l.bonus)}</span>` : ''}${l.perso ? `<span class="pastille vert">${esc(l.rabaisTexte)}</span>` : ''}${l.fin ? `<span class="pastille ${joursRestants(l.fin) <= 2 ? 'ambre' : ''}">${libelleFin(l.fin)}</span>` : ''}${l.source === 'photo' ? '<span class="pastille">📷 vu en magasin</span>' : ''}${l.aVerifier ? '<span class="pastille ambre">lu sur photo : à vérifier</span>' : ''}${l.source === 'manuel' ? '<span class="pastille">saisi</span>' : ''}${l.source === 'flipp' ? '<span class="pastille" title="Trouvé automatiquement dans la circulaire (Flipp) : vérifie le produit">📰 circulaire</span>' : ''}${l.source === 'circulaire' ? `<span class="pastille" title="Lu dans une circulaire que tu as envoyée">📰 circulaire</span>${l.conditions ? `<span class="pastille ambre">${esc(l.conditions)}</span>` : ''}` : ''}${l.source === 'demo' ? '<span class="pastille">démo</span>' : ''}</div>
        ${l.erreur ? `<div class="doux" style="color:var(--rouge)">${esc(l.erreur)}</div>` : ''}
        ${htmlPreuveRabais(l)}
      </td>
      <td class="pu">${puHtml(l)}${l.prixArticle != null ? `<div class="doux">${argent(l.prixArticle)} / article</div>` : ''}</td>
    </tr>`).join('')}
    ${manquantes.map((b) => `<tr><td>${logoVille(b)}<div class="doux">Prix inconnu</div></td>
      <td class="pu"><button class="btn sec" data-ajprix="${b}" style="padding:4px 10px">+ prix</button></td></tr>`).join('')}
  </table>
  <p class="doux">Vert = le moins cher · rouge = le plus cher · ambre = moins de 5 % d'écart. (−x $) = économie sur le prix régulier.${lignes.some((l) => l.etat && l.etat !== 'courant') ? ' Gris = prix vu il y a plus de 60 jours ou pas encore commencé : pas compté.' : ''}</p>`;
}

/**
 * Rabais (circulaire, prix barré, rabais perso…) : liens vers la donnée qui le prouve.
 * - circulaire lue : la page de la circulaire (image privée ; lien signé posé par brancherPreuves) + la circulaire officielle ;
 * - épiceries.ca : le produit sur le site de la bannière + sa fiche et son historique sur épiceries.ca.
 */
function htmlPreuveRabais(l) {
  const rabais = l.economie || l.perso || (l.type && l.type !== 'regulier');
  if (!rabais) return '';
  const lien = (url, texte, attrs = '') => `<a href="${esc(url)}" target="_blank" rel="noopener"${attrs}>${texte}</a>`;
  const ban = esc(nomBanniere(l.banniere));
  const liens = [];
  if (l.offreCirculaire) liens.push(lien(BANNIERES[l.banniere]?.circulaire || '#', '📰 Page de la circulaire', ` data-offrecirc="${esc(l.offreCirculaire)}"`));
  if (l.lienMarchand) liens.push(lien(l.lienMarchand, `🌐 Site de ${ban}`));
  if (l.url) liens.push(lien(l.url, l.source === 'epiceries_ca' ? '📈 épiceries.ca' : '🔗 Source'));
  if (!l.offreCirculaire && (l.type === 'circulaire' || l.source === 'flipp') && BANNIERES[l.banniere]?.circulaire) liens.push(lien(BANNIERES[l.banniere].circulaire, `📰 Circulaire ${ban}`));
  if (l.perso) liens.push(`<span class="doux">Rabais perso : ta carte ${ban}</span>`);
  if (l.source === 'photo') liens.push('<span class="doux">📷 Photo de l\'étiquette (📈 Historique)</span>');
  if (!liens.length) liens.push('<span class="doux">Aucune source en ligne pour ce rabais</span>');
  return `<div class="preuve-rabais"><span class="doux">Preuve :</span>${liens.join('')}</div>`;
}

function puHtml(l) {
  const t = libelleUnitaire(l.pu, l.uniteRef).split(' · ');
  return `${esc(t[0])}${t[1] ? `<br><span class="doux">${esc(t[1])}</span>` : ''}`;
}

// ---------------------------------------------------------------------
// Optimiseur : le moins cher avec au plus N arrêts
// ---------------------------------------------------------------------
function lignesListe() {
  const e = S.get();
  return e.liste.filter((l) => !l.coche).map((l) => ({ l, a: e.articles.find((x) => x.id === l.articleId) })).filter((x) => x.a);
}

/** Pour chaque ligne : coût par arrêt (prix unitaire × quantité voulue). */
function options(cleAutorisee = () => true) {
  return lignesListe().map(({ l, a }) => {
    const offres = offresArticle(a);
    const besoin = besoinDe(a, l, offres);
    const parCle = {};
    for (const o of offres) {
      if (o.pu == null) continue;
      const k = cleOffre(o);
      if (!cleAutorisee(k)) continue;
      const cout = coutOffre(o, l, besoin);
      if (cout == null) continue;
      if (!(k in parCle) || cout < parCle[k].cout) parCle[k] = { cout, offre: o };
    }
    return { l, a, parCle };
  });
}

/**
 * v147 — Quantité de produit voulue (dans l'unité de comparaison de la fiche) : format de la fiche, sinon de sa variante
 * préférée, sinon celui de l'offre la mieux classée. Toutes les bannières sont ainsi chiffrées pour la même quantité
 * (avant : une fiche sans format comparait des emballages de tailles différentes). null si rien n'est lisible.
 */
export function besoinDe(a, l, offres = offresArticle(a)) {
  const pref = (a.variantes || []).find((v) => v.id === a.variantePreferee && !v.retiree);
  for (const fmt of [a.format, pref?.format, offres.find((o) => o.pu != null && !o.douteux)?.format]) {
    const f = analyserFormat(fmt);
    if (f && f.base === a.uniteRef) return f.total * l.quantite;
  }
  return null;
}

/**
 * Coût d'une offre pour une ligne de liste. v147 (règle de Chris) : « N pour X $ » vaut à l'unité, sauf condition
 * « min. » / « ou X $ l'unité » : sous le minimum, prix d'un seul article (ou offre inaccessible si on ne le connaît pas).
 */
export function coutOffre(o, l, besoin) {
  if (o.minimum && l.quantite < o.minimum) return o.prixSeul != null ? o.prixSeul * l.quantite : null;
  return besoin != null ? o.pu * besoin : (o.prixArticle != null ? o.prixArticle * l.quantite : null);
}

/** Coût d'une ligne de liste dans un « arrêt » donné (bannière ou magasin à rabais perso). null si pas de prix. */
export function coutPour(l, a, cle) {
  const offres = offresArticle(a);
  const besoin = besoinDe(a, l, offres);
  let min = null;
  for (const o of offres) {
    if (o.pu == null || cleOffre(o) !== cle) continue;
    const c = coutOffre(o, l, besoin);
    if (c != null && (min == null || c < min)) min = c;
  }
  return min;
}

function combinaisons(cles, k, debut = 0, acc = [], out = []) {
  if (acc.length === k) { out.push([...acc]); return out; }
  for (let i = debut; i < cles.length; i++) { acc.push(cles[i]); combinaisons(cles, k, i + 1, acc, out); acc.pop(); }
  return out;
}

/**
 * Meilleure combinaison de magasins pour chaque nombre d'arrêts jusqu'à max.
 * forcees : arrêts obligatoires ; ignorees : arrêts exclus de ce calcul.
 */
export function optimiser(max, { forcees = [], ignorees = [], cleAutorisee } = {}) {
  const opts = options((k) => !ignorees.includes(k) && (!cleAutorisee || cleAutorisee(k)));
  const cles = [...new Set(opts.flatMap((o) => Object.keys(o.parCle)))];
  const forcesValides = forcees.filter((k) => !ignorees.includes(k) && (!cleAutorisee || cleAutorisee(k)));
  const libres = cles.filter((k) => !forcesValides.includes(k));
  const sansPrix = opts.filter((o) => !Object.keys(o.parCle).length);
  const resultats = [];
  for (let k = Math.max(1, forcesValides.length); k <= Math.min(max, libres.length + forcesValides.length); k++) {
    let meilleur = null;
    for (const reste of combinaisons(libres, k - forcesValides.length)) {
      const combo = [...forcesValides, ...reste];
      let total = 0, manquants = 0; const affect = [];
      for (const o of opts) {
        if (!Object.keys(o.parCle).length) continue;
        let best = null;
        for (const c of combo) if (o.parCle[c] && (!best || o.parCle[c].cout < best.cout)) best = { cle: c, ...o.parCle[c] };
        if (best) { total += best.cout; affect.push({ ...o, choix: best }); } else manquants++;
      }
      // Un arrêt choisi librement mais inutile ne compte pas (un arrêt forcé, lui, est gardé).
      const utilises = new Set(affect.map((x) => x.choix.cle));
      if (reste.some((c) => !utilises.has(c))) continue;
      if (!meilleur || manquants < meilleur.manquants || (manquants === meilleur.manquants && total < meilleur.total - 1e-9)) {
        meilleur = { arrets: k, combo, total, manquants, affect };
      }
    }
    if (meilleur) resultats.push(meilleur);
  }
  return { resultats, sansPrix, nb: opts.length, cles };
}

function appliquer(res) {
  S.maj((e) => {
    for (const l of e.liste) { if (!l.coche) { l.magasinCible = null; } }
    for (const x of res.affect) {
      const l = e.liste.find((i) => i.id === x.l.id);
      if (l) l.magasinCible = x.choix.cle;
    }
  });
  // On ouvre la liste filtrée sur le 1er magasin, dans l'ordre de ses rayons.
  import('./app.js').then((m) => m.allerOnglet('liste', { filtre: res.affect[0]?.choix.cle || res.combo[0] }));
  toast(`Liste répartie sur ${res.arrets} magasin(s). Touche un magasin en haut de la liste pour voir sa partie.`);
}

/** Petite photo du produit (ou un emplacement vide pour garder l'alignement). */
const vignette = (a) => (photoDe(a) ? `<img class="vignette mini" src="${esc(photoDe(a))}" alt="">` : '<span class="vignette mini"></span>');

function blocResultat(r, un, avecBouton, attr = 'data-appliquer') {
  const eco = un && r !== un ? un.total - r.total : 0;
  const parMag = {};
  r.affect.forEach((x) => (parMag[x.choix.cle] ??= []).push(x));
  return `<div class="carte" style="margin:10px 0 0;background:var(--gris-fond)">
    <div class="total"><span>${r.arrets} arrêt${r.arrets > 1 ? 's' : ''}</span><span>${argent(r.total)}</span></div>
    ${eco > 0.005 ? `<div class="doux">Économie de <b>${argent(eco)}</b> par rapport à 1 arrêt</div>` : ''}
    ${r.manquants ? `<div class="doux" style="color:var(--ambre)">${r.manquants} article(s) sans prix dans ces magasins</div>` : ''}
    ${Object.entries(parMag).map(([k, xs]) => `<div style="margin-top:8px">${logoCleHtml(k)} — <b>${argent(xs.reduce((t, x) => t + x.choix.cout, 0))}</b>
      <ul class="liste-arret">${xs.map((x) => `<li><span class="rang" style="gap:6px">${vignette(x.a)}${x.l.quantite > 1 ? `${x.l.quantite} × ` : ''}${esc(x.a.nom)}</span>
        <span class="doux">${esc(x.choix.offre.offre)}${x.choix.offre.perso ? ' −' + esc(x.choix.offre.rabaisTexte.replace(/^−/, '').split(' (')[0]) : ''}</span></li>`).join('')}</ul></div>`).join('')}
    ${avecBouton ? `<button class="btn" ${attr}="${r.arrets}" style="margin-top:8px">Utiliser cette répartition</button>` : ''}</div>`;
}

// ---------------------------------------------------------------------
// Vue
// ---------------------------------------------------------------------
/**
 * Quatre affichages, choisis par les boutons d'en-tête (de gauche à droite) :
 * Tableau · Détails · Online (paniers en ligne) · Écono (le moins cher en N arrêts).
 * Chacun n'affiche que ses propres options.
 */
export function vueComparaison(v, rendre) {
  const e = S.get();
  e.optim ||= { forcees: [], ignorees: [] };
  const onglets = [['tableau', '▦ Tableau'], ['details', '☰ Détails'], ['online', '🛒 Online'], ['econo', '💲 Écono']];
  let html = `<div class="sous-onglets barre-collante">${onglets.map(([k, t]) =>
    `<button class="${vue === k ? 'actif' : ''}" data-vue="${k}">${t}</button>`).join('')}</div>`;

  if (vue === 'tableau' || vue === 'details') {
    const articles = portee === 'liste'
      ? [...new Set(lignesListe().map((x) => x.a.id))].map((id) => e.articles.find((a) => a.id === id))
      : [...e.articles].sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    html += `<div class="rang" style="margin-bottom:8px">
      <button class="btn ${portee === 'liste' ? '' : 'sec'}" data-portee="liste" style="padding:6px 10px">Ma liste</button>
      <button class="btn ${portee === 'tout' ? '' : 'sec'}" data-portee="tout" style="padding:6px 10px">Tout le catalogue</button></div>`;
    if (!articles.length) html += `<div class="vide">Rien à comparer.</div>`;
    else if (vue === 'tableau') html += matrice(articles);
    else for (const a of articles) {
      // En-tête identique pour chaque produit : image · nom · format et unité de comparaison
      html += `<div class="carte" data-art="${a.id}" style="cursor:pointer"><div class="cel-produit" style="margin-bottom:8px">${vignetteProduit(a, 48)}
        <div class="grandir"><div class="cel-nom" style="font-size:16px">${esc(a.nom)}${a.local ? ' 🍁' : ''}</div>
        <div class="cel-prix">${esc(formatLisible(a.format) || 'format ?')} · comparé ${a.uniteRef === 'unite' ? 'à l\'unité' : a.uniteRef === 'kg' ? 'au kilo' : 'au litre'}</div></div></div>${tableauOffres(a)}</div>`;
    }
  }

  let opt = null;
  if (vue === 'econo') {
    const { forcees, ignorees } = e.optim;
    opt = optimiser(maxArrets, { forcees, ignorees });
    const toutesCles = [...new Set([...optimiser(1).cles, ...forcees, ...ignorees])];
    if (!opt.nb) html += `<div class="vide">Ta liste est vide.</div>`;
    else html += `<div class="carte"><h2>Le moins cher pour ma liste</h2>
      <div class="rang"><label class="doux grandir">Nombre d'arrêts maximum</label>
        <select id="maxArrets" style="width:auto">${[1, 2, 3, 4].map((n) => `<option ${n === maxArrets ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="doux" style="margin:8px 0 4px">Touche un magasin : <b>★ forcé</b> (toujours un arrêt) → <b>✕ ignoré</b> → normal.</div>
      <div class="rang envelopper">${toutesCles.map((k) => {
        const etat = forcees.includes(k) ? 'forcee' : ignorees.includes(k) ? 'ignoree' : '';
        return `<button class="puce-ban ${etat}" data-cle="${esc(k)}">${etat === 'forcee' ? '★ ' : etat === 'ignoree' ? '✕ ' : ''}${logoCleHtml(k)}</button>`;
      }).join('')}</div>
      <button class="btn sec" id="recalculer" style="margin-top:8px">🔄 Refaire l'optimisation</button></div>
      ${opt.resultats.length ? opt.resultats.map((r) => blocResultat(r, opt.resultats[0], true)).join('')
        : '<p class="doux">Aucune combinaison possible avec ces choix (trop de magasins forcés pour le nombre d\'arrêts ?).</p>'}
      ${opt.sansPrix.length ? `<p class="doux">Sans prix connu : ${opt.sansPrix.map((o) => esc(o.a.nom)).join(', ')}. Touche l'article dans la liste pour trouver ses prix.</p>` : ''}
      <p class="doux">Coût = prix unitaire × ta quantité habituelle (les gros formats Costco sont ramenés à ton format), avant taxes. Le plafond du rabais perso n'est pas suivi article par article.</p>`;
  }

  if (vue === 'online') html += lignesListe().length ? blocEnLigne() : `<div class="vide">Ta liste est vide.</div>`;
  v.innerHTML = html;

  $$('[data-portee]', v).forEach((b) => b.onclick = () => { portee = b.dataset.portee; rendre(); });
  $$('[data-vue]', v).forEach((b) => b.onclick = () => { vue = b.dataset.vue; window.scrollTo(0, 0); rendre(); });
  $('#maxArrets', v)?.addEventListener('change', (ev) => { maxArrets = Number(ev.target.value); rendre(); });
  $$('[data-cle]', v).forEach((b) => b.onclick = () => S.maj((x) => {
    const k = b.dataset.cle; const o = (x.optim ||= { forcees: [], ignorees: [] });
    if (o.forcees.includes(k)) { o.forcees = o.forcees.filter((y) => y !== k); o.ignorees.push(k); }
    else if (o.ignorees.includes(k)) o.ignorees = o.ignorees.filter((y) => y !== k);
    else o.forcees.push(k);
  }));
  $('#recalculer', v)?.addEventListener('click', async () => {
    toast('Mise à jour des prix et nouveau calcul…');
    const m = await import('./epiceries.js'); await m.actualiserTout().catch(() => {});
    rendre();
  });
  $$('[data-appliquer]', v).forEach((b) => b.onclick = () => appliquer(opt.resultats.find((r) => r.arrets === Number(b.dataset.appliquer))));
  $$('[data-art]', v).forEach((el) => el.onclick = () => import('./app.js').then((m) => m.ficheArticle(el.dataset.art)));
  brancherEnLigne(v, rendre);
}

/** Logo + ville (ou succursale à rabais perso) pour une clé d'arrêt. */
export function logoCleHtml(k) {
  if (k.startsWith('perso:')) { const m = S.get().magasins.find((x) => x.nom === k.slice(6)); return m ? logoMagasin(m) : esc(k.slice(6)); }
  return logoVille(k);
}

/** Image du produit, ou sa première lettre dans une case grise (même place pour tous). */
export function vignetteProduit(a, taille = 40) {
  return photoDe(a)
    ? `<img class="vignette-fixe" src="${esc(photoDe(a))}" alt="" style="width:${taille}px;height:${taille}px" onerror="this.removeAttribute('src');this.classList.add('vignette-vide')">`
    : `<span class="vignette-fixe vignette-vide" style="width:${taille}px;height:${taille}px">${esc((a.nom || '?')[0].toUpperCase())}</span>`;
}

/** Colonne « Aliment » : image, nom, puis format et unité de comparaison — toujours au même endroit. */
function celluleProduit(a) {
  const unite = a.uniteRef === 'unite' ? 'à l\'unité' : a.uniteRef === 'kg' ? 'au kg' : 'au litre';
  return `<div class="cel-produit">${vignetteProduit(a, 36)}<div><div class="cel-nom">${esc(a.nom)}${a.local ? ' 🍁' : ''}</div>
    <div class="cel-prix">${esc(formatLisible(a.format) || 'format ?')} · ${unite}</div></div></div>`;
}

/** Tableau : une ligne par aliment, une colonne par bannière ; vert = moins cher, rouge = plus cher. */
function matrice(articles) {
  const offres = articles.map((a) => ({ a, os: offresArticle(a) }));
  const cles = [...new Set(offres.flatMap(({ os }) => os.filter((o) => o.pu != null).map(cleOffre)))];
  const ordre = Object.keys(BANNIERES);
  cles.sort((x, y) => ordre.indexOf(banniereDeCle(x)) - ordre.indexOf(banniereDeCle(y)) || x.localeCompare(y));
  return `<div class="tableau-wrap"><table class="matrice">
    <thead><tr><th>Aliment</th>${cles.map((k) => `<th>${logoCleHtml(k)}${k.startsWith('perso:') ? '<div class="doux">rabais perso</div>' : ''}</th>`).join('')}</tr></thead>
    <tbody>${offres.map(({ a, os }) => {
      const parCle = {};
      for (const o of os) { if (o.pu == null) continue; const k = cleOffre(o); if (!parCle[k] || (prixComparable(o) ?? Infinity) < (prixComparable(parCle[k]) ?? Infinity)) parCle[k] = o; }
      return `<tr><th data-art="${a.id}">${celluleProduit(a)}</th>${cles.map((k) => {
        const o = parCle[k];
        if (!o) return '<td class="vide-cel"><div class="cel-pu">—</div></td>';
        // Toujours les mêmes 3 lignes, dans le même ordre : ① prix comparable (au kg/L/unité) ② prix payé · format ③ rabais / fin
        const affiche = o.perso && o.prixArticle != null ? argent(o.prixArticle) : o.offre;
        const note = [o.economie ? `−${argent(o.economie)}` : '', o.perso ? o.rabaisTexte.split(' (')[0] : '', o.fin ? libelleFin(o.fin) : ''].filter(Boolean).join(' · ');
        return `<td class="${o.classe}"><div class="cel-pu">${esc(libelleUnitaire(o.pu, o.uniteRef).split(' · ')[0])}</div>
          <div class="cel-prix">${esc(affiche)}${o.format ? ` · ${esc(formatLisible(o.format))}` : ''}</div>
          ${o.produitOffre ? `<div class="cel-prix">${esc(o.produitOffre)}</div>` : ''}
          <div class="cel-note">${esc(note) || '&nbsp;'}</div></td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div>
    <p class="doux">Dans chaque case : <b>prix comparable</b> (au kg, au litre ou à l'unité), puis prix et format, puis rabais. Vert = le moins cher · rouge = le plus cher. Glisse le tableau vers la gauche pour voir toutes les bannières.</p>`;
}

// ---------------------------------------------------------------------
// Paniers en ligne : le moins cher sur 1 à 3 sites, liens exacts, aide au remplissage
// ---------------------------------------------------------------------
function lienProduit(siteKey, a) {
  const site = EN_LIGNE[siteKey];
  // Lien exact vers la fiche du produit chez le marchand quand on le connaît (sauf IGA : l'ancien site iga.net renvoie 404)
  const p = site.prixDe && site.prixDe !== 'iga' && S.get().prix.find((x) => x.articleId === a.id && x.banniere === site.prixDe && x.lienMarchand);
  return p ? { url: p.lienMarchand, exact: true } : { url: site.recherche(`${a.marque ? a.marque + ' ' : ''}${a.nom}`), exact: false };
}

function blocEnLigne() {
  const e = S.get();
  const sitesActifs = Object.keys(EN_LIGNE).filter((k) => !EN_LIGNE[k].prixDe || EN_LIGNE[k].prixDe === 'iga' ? true : banniereActive(EN_LIGNE[k].prixDe));
  const autorisee = (k) => !k.startsWith('perso:') && SITE_DE_BANNIERE[k] && sitesActifs.includes(SITE_DE_BANNIERE[k]) && !(e.optim?.ignorees || []).includes(k);
  const opt = optimiser(nbSitesEnLigne, { cleAutorisee: autorisee, forcees: (e.optim?.forcees || []).filter(autorisee) });
  const r = opt.resultats[opt.resultats.length - 1];
  let html = `<div class="carte"><h2>Préparer mes paniers en ligne</h2>
    <div class="rang"><label class="doux grandir">Nombre de sites maximum</label>
      <select id="nbSites" style="width:auto">${[1, 2, 3].map((n) => `<option ${n === nbSitesEnLigne ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <p class="doux">Le moins cher pour ta liste parmi Voilà (IGA), Metro, Maxi, Costco (via Instacart) et Jean Coutu, avec les magasins forcés ou ignorés dans Écono. Super C n'a pas de commande en ligne.</p>`;
  if (!r) {
    html += '<p class="doux">Pas assez de prix connus pour proposer des paniers. Lie tes produits aux vrais prix (fiche → 🔎).</p>';
  } else {
    html += `<div class="total"><span>Total estimé</span><span>${argent(r.total)}</span></div>`;
    const parSite = {};
    r.affect.forEach((x) => (parSite[SITE_DE_BANNIERE[x.choix.cle]] ??= []).push(x));
    for (const [site, xs] of Object.entries(parSite)) {
      const s = EN_LIGNE[site];
      html += `<div class="carte" style="margin:10px 0 0;background:var(--gris-fond)" data-site="${site}">
        <div class="rang"><span class="grandir">${logo(s.logo || (s.prixDe === 'iga' ? 'voila' : s.prixDe))}${s.logo ? ` ${logo(s.prixDe)}` : ''} <b>${argent(xs.reduce((t, x) => t + x.choix.cout, 0))}</b></span>
          <a class="btn" href="${s.site}" target="_blank" rel="noopener" style="text-decoration:none;padding:6px 10px">Ouvrir</a></div>
        <div class="doux">${esc(s.note)}</div>
        ${xs.map((x) => { const lp = lienProduit(site, x.a); return `<div class="rang" style="padding:6px 0;border-top:1px solid var(--ligne)">
          ${vignette(x.a)}<span class="grandir une-ligne">${x.l.quantite} × ${esc(x.a.nom)}${x.a.format ? ` <span class="doux">${esc(formatLisible(x.a.format))}</span>` : ''}</span>
          <a href="${esc(lp.url)}" target="_blank" rel="noopener" style="white-space:nowrap">${lp.exact ? 'Produit ›' : 'Chercher ›'}</a></div>`; }).join('')}
        <div class="rang envelopper" style="margin-top:8px">
          <button class="btn sec" data-copier="${site}">Copier la liste</button>
          <button class="btn sec" data-claude="${site}">🤖 Remplir avec Claude</button></div></div>`;
    }
  }
  // Articles qui ne sont PAS dans ces paniers : on les montre, avec où les trouver en ligne
  const dansPanier = new Set((r?.affect || []).map((x) => x.l.id));
  const manquants = lignesListe().filter(({ l }) => !dansPanier.has(l.id));
  if (manquants.length) {
    html += `<div class="carte manquants" style="margin:10px 0 0">
      <b>⚠️ ${manquants.length} article(s) manquent dans ${nbSitesEnLigne > 1 ? 'ces paniers' : 'ce panier'}</b>
      ${manquants.map(({ l, a }) => {
        const ailleurs = [...new Set(offresArticle(a).filter((o) => o.pu != null && !o.perso && SITE_DE_BANNIERE[o.banniere]).map((o) => SITE_DE_BANNIERE[o.banniere]))]
          .filter((sk) => !r || !Object.keys(r.affect.reduce((m, x) => ({ ...m, [SITE_DE_BANNIERE[x.choix.cle]]: 1 }), {})).includes(sk));
        const ou = ailleurs.length ? `Offert en ligne chez ${ailleurs.map((sk) => logo(EN_LIGNE[sk].logo || (EN_LIGNE[sk].prixDe === 'iga' ? 'voila' : EN_LIGNE[sk].prixDe))).join(' ')}${ailleurs.includes('costco') ? ' <span class="doux">(Costco via Instacart, plus cher qu\'en entrepôt)</span>' : ''} — choisis plus de sites`
          : a.exclusif && !SITE_DE_BANNIERE[a.exclusif] ? `Vendu seulement chez ${esc(nomBanniere(a.exclusif))} (pas en ligne)` : 'Aucun prix en ligne connu';
        return `<div class="rang" style="padding:6px 0;border-top:1px solid var(--ligne)">${vignette(a)}
          <div class="grandir"><div class="une-ligne">${l.quantite} × ${esc(a.nom)}</div><div class="doux" style="font-size:12px">${ou}</div></div></div>`;
      }).join('')}</div>`;
  }
  html += `<p class="doux">🤖 « Remplir avec Claude » copie des instructions : colle-les dans Claude sur ton ordinateur pendant que tu es connecté au site dans Chrome. Claude ajoute les articles au panier et s'arrête <b>avant le paiement</b> ; tu vérifies et tu paies toi-même. Depuis le téléphone, l'app ne peut pas remplir le panier seule (aucun magasin n'offre d'accès pour ça).</p></div>`;
  return html;
}

function brancherEnLigne(v, rendre) {
  $('#nbSites', v)?.addEventListener('change', (ev) => { nbSitesEnLigne = Number(ev.target.value); rendre(); });
  const itemsDuSite = (site) => [...$$(`[data-site="${site}"] .une-ligne`, v)].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
  const liensDuSite = (site) => [...$$(`[data-site="${site}"] a[href]`, v)].slice(1).map((a) => a.href);
  $$('[data-copier]', v).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(itemsDuSite(b.dataset.copier).join('\n')); toast('Liste copiée'); } catch { toast('Copie impossible'); }
  });
  $$('[data-claude]', v).forEach((b) => b.onclick = async () => {
    const site = b.dataset.claude, s = EN_LIGNE[site];
    const items = itemsDuSite(site), liens = liensDuSite(site);
    const txt = `Claude, remplis mon panier sur ${s.nom} (${s.site}). Je suis déjà connecté dans Chrome.\n`
      + `Ajoute ces articles (même produit et même format si possible ; sinon, propose-moi l'équivalent le moins cher au kg/L) :\n`
      + items.map((it, i) => `- ${it}${liens[i] ? ` → ${liens[i]}` : ''}`).join('\n')
      + `\nNe passe PAS la commande et ne paie pas : arrête-toi au panier et fais-moi un résumé (articles, prix, total).`;
    try { await navigator.clipboard.writeText(txt); toast('Instructions copiées — colle-les dans Claude sur ton ordinateur'); } catch { toast('Copie impossible'); }
  });
}
