// =====================================================================
// Épicerie — application principale (mode démo)
// =====================================================================
import { estFsa, secteurDe, memeVille, enSecteur } from './secteurs.js';
import { appliquerRegistre } from './bannieres-registre.js';
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, offresArticle, meilleureOffre, libelleUnitaire,
  libelleFin, joursRestants, nomBanniere, puce, toast, nomOffre, villeMagasin, logo, logoVille, logoMagasin, brancherSelecteurRayon, banniereActive, magasinsActifs } from './ui.js';
import { BANNIERES, BANNIERES_MAGASIN } from './demo-data.js';
import { analyserOffre, analyserFormat, formatLisible, gtinVariantes, normaliser } from './normalise.js';
import { ouvrirScan, photoProduit } from './scan.js';
import { vueRecettes } from './recettes.js';
import { vuePlus, afficherPhoto, allerASection, nouveauRecu, ouvrirReleve, ouvrirDetailRecu } from './plus.js';
import { vueComparaison, tableauOffres, nomCle, coutPour, cleOffre } from './comparer.js';
import { ouvrirLiaison, actualiserArticle, actualiserTout, afficherHistorique, rechercherSouple } from './epiceries.js';
import { lirePrixPhoto, brancherIA } from './ocr.js';
import * as Sync from './sync.js';
import { surveillerMisesAJour } from './maj.js';

surveillerMisesAJour(); // « Mise à jour disponible — Oui / Non »
import { ouvrirListeManuscrite, photoEnMagasin, identifierArticle, remplacerArticle } from './manuscrit.js';
import { ajouterTache, traiterFile, nbEnAttente } from './attente.js';
import { htmlVerdictListe, htmlDernierAchat, htmlAchats } from './recu.js';
import * as P from './produits.js';
import { jourQuebec } from './couverture-circulaires.js';
import { chargerVisuels, photoDe } from './visuels.js';

let onglet = 'liste';
let filtreMagasin = 'tous'; // filtre de la liste après « Utiliser cette répartition »

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
S.charger();

/**
 * Bandeau d'état sous l'en-tête : seulement quand quelque chose cloche (envoi refusé, hors ligne).
 * Plus de nom ni de note « données gardées sur ce téléphone » (demande de Chris, 2026-11-18).
 */
function majEntete() {
  const st = Sync.etatSync();
  const b = $('#bandeauDemo');
  b.onclick = null;
  b.classList.remove('ok');
  b.classList.remove('cache');
  if (st.foyer && st.enLigne && (st.refuses.length || st.erreurEnvoi)) {
    // Ne jamais afficher « synchronisé » quand un envoi échoue (incident du 2026-11-16)
    b.textContent = st.refuses.length
      ? `⚠ ${st.refuses.length} élément(s) refusé(s) par la base · le reste est synchronisé · touche pour le détail`
      : '⚠ Envoi en attente : la base n\'a pas répondu · nouvel essai au prochain changement · touche pour le détail';
    b.onclick = () => toast(st.refuses.length
      ? st.refuses.slice(0, 3).map((r) => `${r.k} : ${r.erreur}`).join(' · ')
      : `Dernière erreur : ${st.erreurEnvoi}`);
  } else if (st.foyer && !st.enLigne) {
    b.textContent = '📵 Hors ligne : tes changements seront envoyés au retour du réseau';
  } else {
    b.textContent = '';
    b.classList.add('cache');
  }
}

$$('#onglets button').forEach((b) => b.onclick = () => { onglet = b.dataset.onglet; rendre(); });
S.abonner(() => rendre());
Sync.surChangement((st) => {
  // Arrivée par le lien « mot de passe oublié » : on ouvre directement l'écran du nouveau mot de passe
  if (st.recuperation && onglet !== 'plus') { allerOnglet('plus', { section: 'foyer' }); return; }
  rendre();
});
queueMicrotask(rendre); // après l'évaluation complète du module
chargerVisuels().then(() => rendre()); // photos par niveau (catégorie → sorte) pour les fiches sans vraie photo
setTimeout(async () => {
  await Sync.initialiser().catch(() => {});   // connexion + partage (si déjà connecté)
  brancherIA(Sync.lireAvecIA);                // l'IA lit les photos quand le foyer est connecté
  await traiterFile().catch(() => {});        // photos prises hors ligne
  await actualiserTout().catch(() => {});     // vrais prix des produits liés (max 1 fois / 12 h)
}, 300);

// (Geste « tirer l'écran vers le bas = tout mettre à jour » retiré en v72 : il se déclenchait
//  en glissant dans la liste et relançait, un par un, les prix de TOUS les produits liés.
//  Les prix se mettent quand même à jour seuls au démarrage — actualiserTout, max 1 fois / 12 h.)

export function rendre() {
  appliquerRegistre(S.get().bannieres);   // bannières ajoutées depuis Flipp : disponibles dans Magasins
  majEntete();
  $$('#onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === onglet));
  document.body.classList.toggle('onglet-liste', onglet === 'liste');
  if (onglet !== 'liste') { masquerSuggestions(); $('#champAjout').classList.remove('ouvert'); montrerPuces(); }
  const v = $('#vue');
  if (onglet === 'liste') vueListe(v);
  else if (onglet === 'comparer') vueComparaison(v, rendre);
  else if (onglet === 'recettes') vueRecettes(v);
  else if (onglet === 'magasins') vueMagasins(v);
  else vuePlus(v);
}

// Bandeau « rabais de circulaire à valider » : retiré le 2026-11-17 (Chris ne valide pas à la main).
// Les rabais sûrs s'enregistrent seuls ; les incertains restent facultatifs dans Plus → Circulaires.
function majBandeauCirc() {
  const z = $('#bandeauCirc');
  if (z) z.innerHTML = '';
}

// ---------------------------------------------------------------------
// Outils catalogue / liste
// ---------------------------------------------------------------------
export const sansAccents = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function trouverArticle(nom) {
  const n = sansAccents(nom);
  const e = S.get();
  return e.articles.find((a) => sansAccents(a.nom) === n)
    || e.articles.find((a) => n.length >= 4 && (sansAccents(a.nom).startsWith(n) || n.startsWith(sansAccents(a.nom))));
}

export function rayonParDefaut() {
  const e = S.get();
  return (e.rayons.find((r) => r.nom === 'Divers') || e.rayons[e.rayons.length - 1]).id;
}

/** Crée l'article s'il n'existe pas. Retourne l'article. */
export function assurerArticle(nom, extra = {}) {
  let a = trouverArticle(nom);
  if (a) return a;
  a = { id: S.uid('a'), nom: nom.trim().replace(/^./, (c) => c.toUpperCase()), rayonId: rayonParDefaut(),
    uniteRef: 'unite', format: '', local: false, codes: [], ...extra };
  S.maj((e) => e.articles.push(a));
  return a;
}

/** Ajoute à la liste (fusionne si déjà présent et non coché). */
export function ajouterALaListe(articleId, quantite = 1, extra = {}) {
  let fusion = false;
  S.maj((e) => {
    const ex = e.liste.find((l) => l.articleId === articleId && !l.coche);
    if (ex) {
      ex.quantite += quantite; fusion = true;
      if (extra.recette) ex.recettes = [...new Set([...(ex.recettes || []), extra.recette])];
    } else {
      e.liste.push({ id: S.uid('l'), articleId, quantite, coche: false, mode: 'personne', ajoutePar: e.utilisateur, cree: new Date().toISOString(),
        recettes: extra.recette ? [extra.recette] : [], note: extra.note || '' });
    }
  });
  return fusion;
}

/**
 * Après un ajout par le champ « Ajouter » (ou le lecteur) : un cadre entoure la rangée du produit, le reste
 * de l'écran est foncé puis s'éclaircit jusqu'à disparaître. Rangée hors de l'écran → on y défile d'abord.
 * À appeler juste après l'ajout : le cadre se pose une fois la liste redessinée.
 */
export function montrerAjout(articleId) {
  setTimeout(() => {
    if (onglet !== 'liste') return;
    const l = S.get().liste.find((x) => x.articleId === articleId && !x.coche);
    const el = l && ($(`#vue tr.pl[data-l="${l.id}"]`) || $(`#vue .item-liste[data-id="${l.id}"]`));
    if (!el) return;   // pas affiché ici (ex. Mode Magasin d'une autre bannière)
    // Zone vraiment visible : sous l'entête (et la tête des colonnes en Prépa.), au-dessus de la barre du bas
    const haut = Math.max($('#entete').getBoundingClientRect().bottom, $('#vue .prep-tete')?.getBoundingClientRect().bottom || 0);
    const nav = $('#onglets');
    const bas = innerHeight - (nav && !nav.classList.contains('masquee') ? nav.offsetHeight : 0);
    const r = el.getBoundingClientRect();
    const visible = r.top >= haut && r.bottom <= bas;
    // Défilement en douceur fait à la main (le « smooth » du navigateur n'est pas fiable partout)
    if (!visible) {
      const de = scrollY, vers = Math.max(0, scrollY + r.top - (haut + bas) / 2 + r.height / 2), t0 = performance.now();
      const pas = (t) => {
        const k = Math.min(1, Math.max(0, (t - t0) / 400));
        window.scrollTo(0, de + (vers - de) * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(pas);
      };
      requestAnimationFrame(pas);
    }
    setTimeout(() => {
      const ici = ($(`#vue tr.pl[data-l="${l.id}"]`) || $(`#vue .item-liste[data-id="${l.id}"]`))?.getBoundingClientRect();
      if (!ici) return;
      const cadre = document.createElement('div');
      cadre.className = 'cadre-ajout';
      const g = Math.max(ici.left, 4), d = Math.min(ici.right, innerWidth - 4);
      Object.assign(cadre.style, { top: `${ici.top - 3}px`, left: `${g - 3}px`, width: `${d - g + 6}px`, height: `${ici.height + 6}px` });
      document.body.append(cadre);
      cadre.addEventListener('animationend', () => cadre.remove());
      setTimeout(() => cadre.remove(), 3000); // filet si l'animation est coupée
    }, visible ? 0 : 450);
  }, 60);
}

// --- + / − sur un article de la liste (Prépa. et Mode Magasin) ---
// Retrait : anneau qui se vide (compte à rebours) autour d'un « − », même esprit que l'anneau « trouvés »
const SVG_SABLIER = '<svg class="sablier" viewBox="0 0 24 24" aria-label="Retrait en cours"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="3"/><circle class="rebours" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" pathLength="100" stroke-dasharray="100" transform="rotate(-90 12 12)"/><path d="M8 12h8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const ligneDe = (id) => $(`#vue tr.pl[data-l="${id}"]`) || $(`#vue .item-liste[data-id="${id}"]`);
const chiffreDe = (id) => ligneDe(id)?.querySelector('.p-qte, .qte b');

/** Un de plus / un de moins. À 1, « − » retire le produit (compte à rebours), puis la liste se referme. */
function changerQuantite(id, delta) {
  const l = S.get().liste.find((i) => i.id === id);
  if (!l) return;
  if (delta < 0 && l.quantite <= 1) { retirerAnime(id); return; }
  S.maj((x) => { const li = x.liste.find((i) => i.id === id); if (li) li.quantite = Math.max(1, li.quantite + delta); });
  // Le chiffre sur la photo s'allume comme le cadre d'un ajout, puis s'éteint
  setTimeout(() => {
    const c = chiffreDe(id);
    if (!c) return;
    c.classList.remove('qte-flash'); void c.offsetWidth; c.classList.add('qte-flash');
  }, 0);
}

/** Compte à rebours sur le chiffre → la rangée se vide → elle disparaît et les rangées du dessous remontent. */
function retirerAnime(id) {
  const rangee = ligneDe(id);
  if (!rangee || rangee.dataset.retrait) return;
  rangee.dataset.retrait = '1';
  const c = chiffreDe(id);
  if (c) { c.innerHTML = SVG_SABLIER; c.classList.add('en-retrait'); }
  setTimeout(() => {
    ligneDe(id)?.classList.add('se-vide');   // l'espace reste, le contenu s'efface
    setTimeout(() => {
      // Positions avant le retrait (rangées, en-têtes de rayon), pour faire glisser ce qui est dessous
      const cle = (e) => e.dataset.l || e.dataset.id || `t:${e.textContent.trim().slice(0, 60)}`;
      const quoi = '#vue .prep-defile tr, #vue .item-liste, #vue .rayon > h3, #vue .rayon > button, #vue > .btn';
      const avant = new Map($$(quoi).map((e) => [cle(e), e.getBoundingClientRect().top]));
      S.maj((x) => { x.liste = x.liste.filter((i) => i.id !== id); });
      for (const e of $$(quoi)) {
        const dy = (avant.get(cle(e)) ?? NaN) - e.getBoundingClientRect().top;
        if (!(dy > 0.5)) continue;
        e.style.transition = 'none';
        e.style.transform = `translateY(${dy}px)`;
        void e.offsetWidth;
        e.style.transition = 'transform .38s cubic-bezier(.2,.8,.2,1)';
        e.style.transform = '';
        e.addEventListener('transitionend', () => { e.style.transition = ''; }, { once: true });
      }
    }, 260);
  }, 850);
}

function ordreRayons(magasinId = S.get().magasinCourant) {
  const e = S.get();
  const sauve = e.ordreRayons[magasinId] || e.rayons.map((r) => r.id);
  const ids = sauve.filter((id) => e.rayons.some((r) => r.id === id));
  e.rayons.forEach((r) => { if (!ids.includes(r.id)) ids.push(r.id); });
  return ids.map((id) => e.rayons.find((r) => r.id === id));
}

// ---------------------------------------------------------------------
// Onglet LISTE
// ---------------------------------------------------------------------
/**
 * Alertes de la liste. Chacune a :
 *  - une clé (pour le « x » : masquée tant que la situation ne change pas) ;
 *  - une action (toucher l'alerte amène à l'endroit où agir).
 */
function alertesListe() {
  const e = S.get();
  const masquees = new Set(e.alertesMasquees || []);
  const out = [];
  for (const l of e.liste.filter((x) => !x.coche)) {
    const a = e.articles.find((x) => x.id === l.articleId);
    if (!a) continue;
    const m = meilleureOffre(a);
    const j = joursRestants(m?.fin);
    if (m && m.type !== 'regulier' && j != null && j <= 2 && j >= 0) {
      out.push({ cle: `fin:${a.id}:${m.banniere}:${m.fin}`, classe: 'ambre', action: `fiche:${a.id}:${l.id}`,
        html: `⏰ <b>${esc(a.nom)}</b> : rabais ${esc(nomOffre(m))} ${libelleFin(m.fin)} (${esc(m.offre)}).` });
    }
  }
  for (const r of e.rabaisPerso.filter((x) => x.actif)) {
    const mag = e.magasins.find((m) => m.id === r.magasinId);
    const j = joursRestants(r.expiration);
    const action = `rabais:${r.id}`;
    if (!r.expiration) out.push({ cle: `rpdate:${r.id}`, classe: 'ambre', action, html: `📅 Entre la date d'expiration du rabais <b>${esc(mag?.nom || '')}</b> (${esc(r.description)}).` });
    else if (j < 0) out.push({ cle: `rpexp:${r.id}:${r.expiration}`, classe: 'rouge', action, html: `Le rabais ${esc(mag?.nom || '')} est expiré.` });
    else if (j <= 7) out.push({ cle: `rp7:${r.id}:${r.expiration}`, classe: 'ambre', action, html: `📅 Rabais ${esc(mag?.nom || '')} (${esc(r.description)}) : expire dans ${j} j.` });
  }
  // Alertes synchronisées (ex. circulaires envoyées en retard par l'agent) : OK → lue sur tous les appareils
  for (const a of (e.alertes || []).filter((x) => !x.lue)) {
    out.push({ cle: `alerte:${a.id}`, classe: 'rouge', action: `alerte:${a.id}`, html: `📰 <b>${esc(a.titre)}</b> — ${esc(a.message)} <u>OK</u>` });
  }
  const attente = nbEnAttente();
  if (attente) out.push({ cle: `attente:${attente}`, classe: 'ambre', action: 'attente', html: `⏳ ${attente} photo(s) en attente de lecture (réseau). Tire l'écran vers le bas ou touche ici pour réessayer.` });
  return out.filter((x) => !masquees.has(x.cle)).map((x) =>
    `<div class="alerte ${x.classe} alerte-action" data-action="${esc(x.action)}" role="link" tabindex="0">
       <span class="grandir">${x.html}</span><button class="fermer-alerte" data-masquer="${esc(x.cle)}" aria-label="Masquer">✕</button></div>`).join('');
}

/** Exécute l'action d'une alerte. */
function agir(action) {
  const [type, id, extra] = action.split(':');
  if (type === 'attente') { toast('Nouvel essai…'); traiterFile().then(() => rendre()); return; }
  if (type === 'alerte') {
    S.maj((e) => { const a = (e.alertes || []).find((x) => x.id === id); if (a) a.lue = true; });
    rendre(); return;
  }
  if (type === 'fiche') ficheArticle(id, extra);
  if (type === 'rabais') {
    allerOnglet('plus', { section: 'rabais' });
    requestAnimationFrame(() => {
      const champ = document.querySelector(`[data-r="${CSS.escape(id)}"] [data-exp]`);
      if (!champ) return;
      champ.closest('.carte').scrollIntoView({ block: 'center' });
      champ.focus();
      try { champ.showPicker?.(); } catch { /* certains navigateurs refusent sans geste direct */ }
    });
  }
}

/** Change d'onglet depuis un autre module (ex. après une répartition). */
export function allerOnglet(nom, { section, filtre } = {}) {
  onglet = nom;
  if (section) allerASection(section);
  if (filtre) filtreMagasin = filtre;
  window.scrollTo(0, 0);
  rendre();
}

/** « super_c » ou « perso:IGA Varennes » → la succursale correspondante (celle dont l'ordre est enregistré en priorité). */
function magasinDeCle(cle) {
  const e = S.get();
  if (!cle || cle === 'tous' || cle === 'aucun') return null;
  if (cle.startsWith('perso:')) return e.magasins.find((m) => m.nom === cle.slice(6)) || null;
  const mags = e.magasins.filter((m) => m.banniere === cle);
  return mags.find((m) => e.ordreRayons[m.id]) || mags[0] || null;
}

const replies = new Set(); // groupes de magasins repliés (vue « Tout »)

/**
 * Une ligne de la liste en mode épicerie. Hauteur fixe (toutes les cartes égales) :
 * nom (1 ligne) · prix sur l'étiquette + format + marque (1 ligne) · notes et avertissements (2 lignes au plus).
 * Le détail complet est dans la fiche. Cocher ne déplace pas la ligne : elle reste à sa place, barrée.
 */
function htmlItem(l, a) {
  // Article placé dans un magasin (Prépa.) : on montre le prix de CE magasin, sinon le meilleur prix.
  const k = l.magasinCible;
  const m = (k && offresArticle(a).find((o) => o.pu != null && cleOffre(o) === k)) || meilleureOffre(a);
  // Prix tel qu'affiché sur l'étagère (« 3,99 $ », « 2/5,00 $ ») pour comparer d'un coup d'œil
  const etiquette = m ? (m.offre || (m.prixArticle != null ? argent(m.prixArticle) : '')) : '';
  const promo = m && (m.economie || m.perso || (m.type && m.type !== 'regulier'));
  const prix = m
    ? `<b class="ep-pp ${promo ? 'promo' : ''}">${esc(etiquette) || '?'}</b>${m.economie && m.prixRegulier ? ` <s class="doux">${argent(m.prixRegulier)}</s>` : ''}`
    : '<b class="ep-pp" style="color:var(--doux)">Prix inconnu</b>';
  const details = [formatLisible(m?.format || a.format), a.marque].filter(Boolean).map(esc);
  if (m?.pu != null) details.push(`<span class="doux">${puCourt(m.pu, m.uniteRef)}</span>`);

  // Notes et avertissements, du plus important au moins important (2 lignes au plus)
  const notes = [];
  if (l.indisponible) notes.push(`<span class="doux">🚫 Pas disponible${l.indisponible.le ? ` (${esc(new Date(`${l.indisponible.le}T12:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }))})` : ''} — garde le doigt 3 s pour le remettre</span>`);
  const verdict = htmlVerdictListe(l.recu);
  if (verdict) notes.push(verdict.replace('<div class="item-recu', '<span class="item-recu').replace(/<\/div>$/, '</span>'));
  if (a.rappel) notes.push('<span class="ep-alerte">⚠️ Rappel ou avis sur ce produit</span>');
  if (l.note) notes.push(`<span>📝 ${esc(l.note)}</span>`);
  if (m?.produitOffre) notes.push(`<span>Prendre : <b>${esc(m.produitOffre)}</b></span>`);
  if (m?.perso) notes.push(`<span class="ep-promo">${esc(m.rabaisTexte || 'rabais perso')}</span>`);
  const max = m ? maxParClient(m) : null;
  if (max) notes.push(`<span class="ep-alerte">${max} max par client</span>`);
  else if (m?.conditions) notes.push(`<span class="ep-alerte">${esc(m.conditions)}</span>`);
  if (m?.economie) notes.push(`<span class="ep-promo">Rabais −${argent(m.economie)}${m.fin ? ` · ${libelleFin(m.fin)}` : ''}</span>`);
  if (a.exclusif) notes.push(`<span>${esc(nomBanniere(a.exclusif))} seulement</span>`);

  const teinte = l.recu?.absent ? '' : l.recu?.statut === 'plus' ? 'recu-ecart' : (l.recu?.statut === 'ok' || l.recu?.statut === 'moins') ? 'recu-ok' : '';
  return `<div class="item item-liste ep ${teinte} ${l.coche ? 'coche' : ''} ${l.indisponible ? 'indisponible' : ''}" data-id="${l.id}">
    <input type="checkbox" ${l.coche ? 'checked' : ''} aria-label="Dans le panier">
    <div class="ep-photo" data-fiche="${a.id}">${photoDe(a) ? `<img src="${esc(photoDe(a))}" alt="">` : '<span aria-hidden="true">📦</span>'}</div>
    <div class="grandir ep-txt" data-fiche="${a.id}">
      <div class="nom ep-nom">${esc(a.nom)}${a.local ? ' <span title="Produit local (Québec)">🍁</span>' : ''}</div>
      <div class="ep-prix">${prix}${details.length ? ` · ${details.join(' · ')}` : ''}</div>
      <div class="ep-note">${notes.join(' · ')}</div>
    </div>
    ${!m && !a.liens?.length && !l.coche ? `<button class="icone photo-mag" data-photomag="${a.id}" title="Identifier ce produit (code-barres, photo)" aria-label="Identifier le produit">🔎</button>` : ''}
    <div class="qte"><button data-q="-1">−</button><b>${l.quantite}</b><button data-q="1">+</button></div>
  </div>`;
}

/**
 * Appui long (3 s) sur une carte de la liste → action(). Une barre se remplit sous la carte pendant l'appui.
 * Annulé si le doigt bouge (défilement) ou se lève avant. Le toucher qui suit l'appui n'ouvre pas la fiche.
 */
const DUREE_APPUI = 3000;
function brancherAppuiLong(el, action) {
  let minuterie = null, depart = null, avale = false;
  const annuler = () => { clearTimeout(minuterie); minuterie = null; el.classList.remove('appui'); };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0 || ev.target.closest('input, button')) return; // case « dans le panier », − / +
    depart = { x: ev.clientX, y: ev.clientY };
    el.classList.add('appui');
    minuterie = setTimeout(() => {
      minuterie = null; el.classList.remove('appui'); avale = true;
      navigator.vibrate?.(40);
      action();
    }, DUREE_APPUI);
  });
  el.addEventListener('pointermove', (ev) => {
    if (minuterie && depart && Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y) > 10) annuler();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, () => { if (minuterie) annuler(); }));
  el.addEventListener('contextmenu', (ev) => ev.preventDefault()); // pas de menu du navigateur pendant l'appui
  el.addEventListener('click', (ev) => { if (avale) { avale = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
}

/** Fenêtre d'options après un appui long : retirer de la liste, pas disponible (ou remettre). */
function optionsArticleListe(ligneId) {
  const e = S.get();
  const l = e.liste.find((x) => x.id === ligneId);
  const a = l && e.articles.find((x) => x.id === l.articleId);
  if (!l || !a) return;
  try { localStorage.setItem('astuce-appui-long', '1'); } catch { /* navigation privée */ }
  ouvrirModale(a.nom, `
    ${l.indisponible
      ? '<button class="btn" id="oRemettre" style="width:100%;margin-bottom:8px">↩︎ Remettre dans la liste (disponible)</button>'
      : '<button class="btn" id="oIndispo" style="width:100%;margin-bottom:8px">🚫 Pas disponible</button>'}
    <div class="champ" style="margin-bottom:8px"><label>Rayon</label>
      <button type="button" class="btn sec" id="oRayon" style="width:100%;text-align:left">${esc(texteBoutonRayon(a.rayonId))}</button>
      <div id="oRayonPanneau" hidden></div></div>
    <button class="btn danger" id="oRetirer" style="width:100%;margin-bottom:8px">🗑 Retirer de la liste</button>
    <button class="btn sec" id="oAnnuler" style="width:100%">Annuler</button>
    <p class="doux" style="margin-top:8px">« Pas disponible » : l'article reste sur ta liste, regroupé à la fin, pour l'acheter ailleurs ou plus tard.</p>`, (c) => {
    $('#oIndispo', c)?.addEventListener('click', () => {
      S.maj((x) => { const li = x.liste.find((y) => y.id === ligneId); if (li) { li.indisponible = { le: new Date().toISOString().slice(0, 10), par: x.utilisateur }; li.coche = false; } });
      fermerModale(); toast(`${a.nom} : pas disponible`);
    });
    $('#oRemettre', c)?.addEventListener('click', () => {
      S.maj((x) => { const li = x.liste.find((y) => y.id === ligneId); if (li) delete li.indisponible; });
      fermerModale(); toast(`${a.nom} remis dans la liste`);
    });
    brancherRayon($('#oRayon', c), $('#oRayonPanneau', c), () => S.get().articles.find((x) => x.id === a.id)?.rayonId,
      (rid) => { placerDansRayon(a.id, rid); fermerModale(); });
    $('#oRetirer', c).onclick = () => { S.maj((x) => { x.liste = x.liste.filter((y) => y.id !== ligneId); }); fermerModale(); toast(`${a.nom} retiré de la liste`); };
    $('#oAnnuler', c).onclick = () => fermerModale();
  });
}

/** Sections par rayon (dans l'ordre et les regroupements du magasin). */
function htmlRayons(items, magId) {
  let html = '';
  for (const g of groupesRayons(magId)) {
    // Les articles « pas disponibles » sont regroupés à la fin de la liste
    const dans = items.filter(({ l, a }) => a && !l.indisponible && g.ids.includes(a.rayonId));
    if (!dans.length) continue;
    const classer = g.ids.includes(rayonParDefaut()) && dans.some(({ a }) => a.rayonId === rayonParDefaut())
      ? ' <button class="btn sec" data-classer style="padding:2px 10px;font-size:13px;float:right">🗂 Classer</button>' : '';
    html += `<section class="rayon"><h3>${esc(g.nom)} <span class="doux">(${dans.length})</span>${classer}</h3>${dans.map(({ l, a }) => htmlItem(l, a)).join('')}</section>`;
  }
  return html;
}

/** Nom d'un groupe de magasin avec son logo : « [IGA] Extra Varennes » ou « [Super C] Beloeil ». */
function logoCle(k) {
  if (k === 'aucun') return '<b>Non assigné</b>';
  if (k.startsWith('perso:')) { const m = S.get().magasins.find((x) => x.nom === k.slice(6)); return m ? logoMagasin(m) : esc(k.slice(6)); }
  return logoVille(k);
}

// ---------------------------------------------------------------------
// Liste — PRÉPARATION : tableau article × bannière (maquette v16 validée par Chris le 2026-11-18).
// Le mode épicerie (liste par magasin, cases à cocher) viendra ensuite : htmlItem / htmlRayons restent pour lui.
// ---------------------------------------------------------------------
const PREF_PHOTO = 'liste.photo';   // colonne produit réduite à la photo (ce téléphone)
const PREF_SEULE = 'liste.seule';   // liste des produits seulement, sans colonnes de prix (ce téléphone)
const lirePref = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const ecrirePref = (k, oui) => { try { localStorage.setItem(k, oui ? '1' : '0'); } catch { /* navigation privée */ } };

/** Bannières en colonnes : celles dont au moins une succursale est « à considérer ». */
/**
 * Bannières affichées (puces et colonnes) : actives ET avec une circulaire en cours, c.-à-d. au moins un
 * rabais de circulaire non annulé, commencé et pas encore fini. Aucune n'en a (données vides, démo) → toutes les actives.
 */
function banColonnes() {
  const actives = BANNIERES_MAGASIN.filter((b) => banniereActive(b));
  const auj = jourQuebec(); // date du Québec (pas UTC : une circulaire finie « ce soir » reste jusqu'à minuit)
  const avecCirc = new Set((S.get().prix || [])
    .filter((p) => p.type === 'circulaire' && !p.annule && p.fin && p.fin >= auj && (!p.debut || p.debut <= auj))
    .map((p) => p.banniere));
  const cols = actives.filter((b) => avecCirc.has(b));
  return cols.length ? cols : actives;
}

/** Une offre affichée comme rabais (en couleur dans la case) : circulaire, économie sur le régulier ou rabais perso. */
const estRabais = (o) => !!(o.perso || o.economie || (o.type && o.type !== 'regulier'));

/**
 * Parmi les bannières retenues, seulement celles qui ont au moins un rabais sur un article de la liste.
 * Aucune n'en a → on garde toutes les bannières retenues (sinon le tableau serait vide).
 */
function banAvecRabaisListe(base, articles) {
  const avec = new Set();
  for (const a of articles) for (const o of offresArticle(a)) if (o.pu != null && estRabais(o)) avec.add(o.banniere);
  const cols = base.filter((b) => avec.has(b));
  return cols.length ? cols : base;
}

/** Clé d'arrêt → bannière (« perso:IGA Extra Varennes » → iga). */
function banDeCle(cle) {
  if (!cle || cle === 'aucun') return null;
  if (cle.startsWith('perso:')) return S.get().magasins.find((m) => m.nom === cle.slice(6))?.banniere || null;
  return cle;
}

/** « Limite de 3 par client », « max. 4 »… dans les conditions d'une offre → 3, 4. */
function maxParClient(o) {
  const m = String(o?.conditions || '').match(/(?:max(?:imum)?\.?|limite(?:\s+de)?)\D{0,12}(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

/** Prix unitaire court pour une case : « 1,52 $/kg », « 2,99 $/u ». */
const puCourt = (pu, u) => {
  const t = libelleUnitaire(pu, u).split(' · ')[0].replace('$/unité', '$/u');
  const i = t.indexOf('/');
  // L'unité (« /kg », « /u ») en plus pâle : l'œil s'arrête sur le prix
  return i > 0 ? `${esc(t.slice(0, i))}<span class="pu-u">${esc(t.slice(i))}</span>` : esc(t);
};

/** Une rangée : offres par bannière (la moins chère de chacune), bannière choisie et son offre. */
function rangeeListe(l, a, cols) {
  // Seulement les bannières affichées (déjà triées du moins cher au plus cher)
  const offres = offresArticle(a).filter((o) => o.pu != null && cols.includes(o.banniere));
  const parBan = {};
  for (const o of offres) if (!parBan[o.banniere]) parBan[o.banniere] = o;
  const choisie = banDeCle(l.magasinCible);
  const ban = choisie && parBan[choisie] ? choisie : offres[0]?.banniere || null;
  return { l, a, parBan, ban, offre: ban ? parBan[ban] : null };
}

/** Contenu d'une case de prix : prix unitaire (rabais en couleur), régulier barré ou rabais perso dessous. */
function htmlPrixCase(o, u, { avecMax = true } = {}) {
  const promo = estRabais(o);
  const max = avecMax ? maxParClient(o) : null;
  const dessous = o.perso
    ? `<span class="prg perso">${esc((o.rabaisTexte || '').match(/−\s*\d+\s*%/)?.[0] || 'perso')}</span>`
    : `<span class="prg">${o.economie && o.prixNum ? argent(o.pu * o.prixRegulier / o.prixNum) : ''}</span>`;
  return `${max ? `<span class="pmax">${max} max</span>` : ''}<span class="pp ${promo ? 'promo' : ''}">${puCourt(o.pu, o.uniteRef || u)}</span>${dessous}`;
}

const SVG_ETIQ = '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8.6V2.2a.7.7 0 0 1 .7-.7h6.4l6 6a1 1 0 0 1 0 1.4l-5.2 5.2a1 1 0 0 1-1.4 0z" fill="currentColor"/><circle cx="5" cy="5" r="1.4" fill="#d7f7e4"/></svg>';
const SVG_RAPPEL = '<svg class="p-rappel" viewBox="0 0 18 16" role="img" aria-label="Rappel ou avis sur ce produit"><path d="M9 1 17 15H1z" fill="#ffd54f" stroke="#8a5a00" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 6v4" stroke="#412402" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="12.4" r=".9" fill="#412402"/></svg>';

function htmlRangee(r, cols, seule) {
  const { l, a } = r;
  const u = r.offre?.uniteRef || a.uniteRef;
  const sous = [formatLisible(a.format), a.marque].filter(Boolean);
  let h = `<tr class="pl ${l.indisponible ? 'indisponible' : ''}" data-l="${l.id}"><td class="pc"><div class="p-art">
    <div class="p-photo" data-fiche="${a.id}">${photoDe(a) ? `<img src="${esc(photoDe(a))}" alt="">` : '<span aria-hidden="true">📦</span>'}${a.rappel ? SVG_RAPPEL : ''}<span class="p-qte">${l.quantite}</span></div>
    <div class="p-txt" data-fiche="${a.id}"><div class="p-nom">${esc(a.nom)}${a.local ? ' <span title="Produit local (Québec)">🍁</span>' : ''}</div>${
      sous.length ? `<div class="p-sous">${esc(sous.join(' · '))}</div>` : ''}</div>
    <div class="p-pm"><button data-q="1" aria-label="Un de plus">+</button><button data-q="-1" aria-label="Un de moins">−</button></div></div></td>`;
  if (seule) return `${h}</tr>`;
  h += `<td class="p-dealc">${r.offre ? htmlPrixCase(r.offre, u, { avecMax: false }) : ''}</td>`;
  h += cols.map((b) => {
    const o = r.parBan[b];
    return `<td>${o ? `<button class="pcel ${b === r.ban ? 'sel' : ''}" data-cle="${esc(cleOffre(o))}" aria-label="Acheter chez ${esc(nomBanniere(b))}">${htmlPrixCase(o, u)}</button>` : ''}</td>`;
  }).join('');
  return `${h}<td></td></tr>`;
}

// ---------------------------------------------------------------------
// Prépa. → interrupteur « Liste » : rangées enrichies (maquette v3 validée par Chris le 2026-11-20).
// Bilan des arrêts en haut, groupement par rayon ou par magasin, écart avec ailleurs, record de prix.
// ---------------------------------------------------------------------
const PREF_GROUPE = 'liste.groupe';   // « rayon » ou « magasin » (ce téléphone)
const SEUIL_ARRET = 8;                // $ d'écart à partir duquel un 2e arrêt vaut la peine (valeur par défaut de la SPEC)

/** Meilleur prix unitaire jamais observé (toutes dates, prix annulés exclus ; le rabais perso n'est pas un prix observé). */
function recordPrix(a) {
  const variantes = new Map((a.variantes || []).map((v) => [v.id, v]));
  let rec = null, max = null;
  for (const p of S.get().prix) {
    if (p.articleId !== a.id || p.annule || p.enAttente) continue;
    const n = normaliser(p.offre, p.format || variantes.get(p.varianteId)?.format || a.format, a.uniteRef);
    const pu = n.prixUnitaire ?? (p.uniteSource?.unite === a.uniteRef ? p.uniteSource.pu : null);
    if (pu == null) continue;
    if (max == null || pu > max) max = pu;
    if (!rec || pu < rec.pu - 0.0005) rec = { pu, banniere: p.banniere, quand: p.observeLe || p.debut || p.fin || '', uniteRef: n.uniteRef || a.uniteRef };
  }
  return rec ? { ...rec, max } : null;
}

/** Étiquette du record pour une rangée : ★ si le prix actuel égale le plus bas jamais vu (et qu'on l'a déjà vu plus cher). */
function etatRecord(r) {
  const o = r.offre, rec = recordPrix(r.a);
  if (!o || !rec) return null;
  // Rabais perso : on compare le prix d'étagère (le −10 % s'ajoute à n'importe quel prix)
  const pu = o.perso ? offresArticle(r.a).find((x) => !x.perso && x.banniere === o.banniere && x.pu != null)?.pu ?? o.pu : o.pu;
  if (pu <= rec.pu + 0.005 && rec.max > rec.pu + 0.01) return { top: true };
  if (pu <= rec.pu + 0.005) return null;   // un seul prix connu : pas de record à montrer
  const d = rec.quand ? new Date(`${rec.quand.slice(0, 10)}T12:00`) : null;
  const mois = d && !isNaN(d) ? d.toLocaleDateString('fr-CA', { month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) : '';
  return { top: false, texte: `Record : ${libelleUnitaire(rec.pu, rec.uniteRef).split(' · ')[0].replace('$/unité', '$/u')} · ${nomBanniere(rec.banniere)}${mois ? `, ${mois}` : ''}` };
}

function htmlRangeeListe(r, { groupe, rec }) {
  const { l, a, offre: o } = r;
  const sous = [formatLisible(o?.format || a.format), a.marque].filter(Boolean);
  const etiquette = o ? (o.offre || (o.prixArticle != null ? argent(o.prixArticle) : '')) : '';
  const cout = o ? coutPour(l, a, cleOffre(o)) : null;
  const ch = [];
  if (rec?.top) ch.push(['rec top', '★ Meilleur prix jamais vu']);
  else if (rec) ch.push(['rec', rec.texte]);
  if (l.indisponible) ch.push(['no', '🚫 Pas disponible']);
  if (a.rappel) ch.push(['al', '⚠️ Rappel ou avis']);
  if (o?.economie) {
    const j = joursRestants(o.fin);
    ch.push([j != null && j <= 1 ? 'ur' : 'ok', `−${argent(o.economie)}${o.fin ? ` · ${libelleFin(o.fin)}` : ''}`]);
  }
  if (o?.perso) ch.push(['ok', (o.rabaisTexte || 'rabais perso').split(' (')[0]]);
  const max = o ? maxParClient(o) : null;
  if (max) ch.push(['wa', `${max} max`]);
  if (o?.produitOffre) ch.push(['no', `Prendre : ${o.produitOffre}`]);
  if (l.note) ch.push(['no', `📝 ${l.note}`]);
  if (l.recettes?.length) ch.push(['no', `Recette : ${l.recettes[0]}`]);
  if (!o) ch.push(['no', 'Prix inconnu · touche la photo']);
  // Écart avec la bannière affichée la moins chère après celle-ci
  if (o && cout != null) {
    const alt = Object.values(r.parBan).filter((x) => x.banniere !== o.banniere)
      .map((x) => ({ b: x.banniere, c: coutPour(l, a, cleOffre(x)) })).filter((x) => x.c != null).sort((x, y) => x.c - y.c)[0];
    if (alt) {
      const d = alt.c - cout;
      if (Math.abs(d) >= 0.005) ch.push([d < 0 ? 'wa' : 'no', `${nomBanniere(alt.b)} ${d < 0 ? '−' : '+'}${argent(Math.abs(d))}`]);
    }
  }
  return `<tr class="pl ls ${l.indisponible ? 'indisponible' : ''}" data-l="${l.id}"><td class="pc"><div class="ls-r">
    <div class="p-photo" data-fiche="${a.id}">${photoDe(a) ? `<img src="${esc(photoDe(a))}" alt="">` : '<span aria-hidden="true">📦</span>'}${a.rappel ? SVG_RAPPEL : ''}<span class="p-qte">${l.quantite}</span></div>
    <div class="ls-tx" data-fiche="${a.id}">
      <div class="ls-nom">${esc(a.nom)}${a.local ? ' <span title="Produit local (Québec)">🍁</span>' : ''}${sous.length ? ` <span class="ls-sous">· ${esc(sous.join(' · '))}</span>` : ''}</div>
      <div class="ls-prix">${o ? `${groupe === 'rayon' ? logo(o.banniere) : ''}<b class="ls-pp ${estRabais(o) ? 'promo' : ''}">${esc(etiquette) || '?'}</b>${
        o.economie && o.prixRegulier ? `<s>${argent(o.prixRegulier)}</s>` : ''}${o.pu != null ? `<span class="ls-pu">${puCourt(o.pu, o.uniteRef)}</span>` : ''}` : ''}</div>
      <div class="ls-ch">${ch.map(([c, t]) => `<span class="lch ${c}">${esc(t)}</span>`).join('')}</div>
    </div>
    <div class="ls-d"><b class="ls-tot">${cout != null ? argent(cout) : '—'}</b><div class="ls-pm"><button data-q="-1" aria-label="Un de moins">−</button><button data-q="1" aria-label="Un de plus">+</button></div></div>
  </div></td></tr>`;
}

/** Bilan en haut du mode Liste : arrêts, total, économie, coût d'un seul arrêt, records. */
function htmlBilanListe(rangees, { total, ecoTot, recs }) {
  const avecPrix = rangees.filter((r) => r.offre && !r.l.indisponible);
  const arrets = new Set(avecPrix.map((r) => r.ban)).size;
  const nRec = [...recs.values()].filter((x) => x?.top).length;
  // Tout au même endroit : pour chaque bannière, ce qui y est offert à son prix, le reste là où il est choisi
  let seul = null;
  if (arrets > 1) {
    const bans = new Set(avecPrix.flatMap((r) => Object.keys(r.parBan)));
    for (const b of bans) {
      let t = 0, manque = 0;
      for (const r of avecPrix) {
        const o = r.parBan[b];
        const c = o ? coutPour(r.l, r.a, cleOffre(o)) : null;
        if (c == null) { manque++; t += coutPour(r.l, r.a, cleOffre(r.offre)) || 0; } else t += c;
      }
      if (!seul || t < seul.t) seul = { b, t, manque };
    }
  }
  const ecart = seul ? seul.t - total : 0;
  return `<tr class="ls-bilan"><td><div class="bil">
    <div class="bil-l"><span><b>${arrets} arrêt${arrets > 1 ? 's' : ''}</b> · ${rangees.length} article${rangees.length > 1 ? 's' : ''}</span><b>${argent(total)}</b></div>
    ${seul ? `<div class="bil-l bil-doux"><span>Tout chez ${esc(nomBanniere(seul.b))} : ${argent(seul.t)} (+${argent(Math.max(0, ecart))})${seul.manque ? ` · ${seul.manque} absent${seul.manque > 1 ? 's' : ''}` : ''}</span>${ecoTot > 0.004 ? `<span class="bil-eco">−${argent(ecoTot)} économisés</span>` : ''}</div>`
      : ecoTot > 0.004 ? `<div class="bil-l bil-doux"><span></span><span class="bil-eco">−${argent(ecoTot)} économisés</span></div>` : ''}
    ${seul || nRec ? `<div class="bil-l bil-doux">${seul ? `<span class="${ecart >= SEUIL_ARRET ? 'bil-ok' : 'bil-wa'}">${ecart >= SEUIL_ARRET ? `Le 2e arrêt vaut la peine (seuil ${SEUIL_ARRET} $)` : `Moins de ${SEUIL_ARRET} $ d'écart : un seul arrêt suffit peut-être`}</span>` : '<span></span>'}${nRec ? `<span class="bil-rec">★ ${nRec} record${nRec > 1 ? 's' : ''}</span>` : ''}</div>` : ''}
  </div></td></tr>`;
}

// ---------------------------------------------------------------------
// Liste — MODE ÉPICERIE (une puce par bannière) : seulement les articles dont la bannière choisie en
// Préparation est celle-ci. Les choix restent modifiables : on revient à « Prépa. » à tout moment.
// ---------------------------------------------------------------------
const PREF_MODE = 'liste.mode';   // « prep » ou une bannière (ce téléphone)
function modeListe(cols) {
  let m = 'prep';
  try { m = localStorage.getItem(PREF_MODE) || 'prep'; } catch { /* navigation privée */ }
  return m === 'prep' || cols.includes(m) ? m : 'prep';
}

const etatAnneau = new Map();    // bannière → dernier % « trouvés » affiché
const eclatJusqua = new Map();   // bannière → fin de l'animation d'éclat (ms)

function vueEpicerie(v, b, toutes) {
  const e = S.get();
  const ici = toutes.filter((r) => r.ban === b);
  const aPrendre = ici.filter((r) => !r.l.coche && !r.l.indisponible);
  const panier = ici.filter((r) => r.l.coche);
  const indispos = ici.filter((r) => !r.l.coche && r.l.indisponible);
  const sansPrix = toutes.filter((r) => !r.ban && !r.l.coche && !r.l.indisponible);
  const nom = esc(nomBanniere(b));

  // Ordre des rayons de la succursale de cette bannière (sinon l'ordre par défaut)
  const mag = magasinsActifs(b).find((m) => m.id === e.magasinCourant) || magasinsActifs(b)[0];
  const ordreId = mag && e.ordreRayons?.[mag.id] ? mag.id : 'defaut';
  const divers = rayonParDefaut();
  const rayonDe = (a) => (e.rayons.some((r) => r.id === a.rayonId) ? a.rayonId : divers);
  const parRayons = (rs) => {
    let h = '';
    for (const g of groupesRayons(ordreId)) {
      const dans = rs.filter((r) => g.ids.includes(rayonDe(r.a)));
      if (dans.length) h += `<section class="rayon"><h3>${esc(g.nom)} <span class="doux">(${dans.length})</span></h3>${dans.map((r) => htmlItem(r.l, r.a)).join('')}</section>`;
    }
    return h;
  };

  let h = '';
  // Tout trouvé : pas de message, c'est l'anneau « trouvés » qui passe au vert flash
  if (!aPrendre.length && !panier.length) {
    h += `<div class="vide">Rien à acheter chez ${nom}. Dans « Prépa. », touche un prix de la colonne ${nom} pour y placer un article.</div>`;
  }
  h += parRayons(aPrendre);
  if (sansPrix.length) h += `<section class="rayon"><h3>Sans prix connu <span class="doux">(${sansPrix.length})</span> <span class="doux" style="font-size:12px;font-weight:400">— à prendre où tu les trouves</span></h3>${sansPrix.map((r) => htmlItem(r.l, r.a)).join('')}</section>`;
  if (indispos.length) h += `<section class="rayon"><h3>🚫 Pas disponible <span class="doux">(${indispos.length})</span></h3>${indispos.map((r) => htmlItem(r.l, r.a)).join('')}</section>`;
  if (panier.length) {
    h += `<section class="rayon"><h3>🛒 Dans le panier <span class="doux">(${panier.length})</span></h3>${panier.map((r) => htmlItem(r.l, r.a)).join('')}</section>`;
    h += `<button class="btn sec" id="btnVider" style="width:100%;margin-top:8px">Retirer les ${panier.length} article(s) acheté(s)</button>`;
  }
  h += '<button class="btn sec" id="btnRecu" style="width:100%;margin-top:8px">🧾 Photographier mon reçu</button>';
  // Anneau « trouvés / total » (articles de cette bannière déjà dans le panier), à droite du premier rayon
  if (ici.length) {
    const pct = Math.round((panier.length / ici.length) * 100);
    // Passage à 100 % : petite animation d'éclat (1,2 s), gardée si la liste est redessinée pendant ce temps
    const avant = etatAnneau.get(b);
    if (pct === 100 && avant != null && avant < 100) eclatJusqua.set(b, Date.now() + 1200);
    etatAnneau.set(b, pct);
    const resteEclat = (eclatJusqua.get(b) || 0) - Date.now();
    const eclat = pct === 100 && resteEclat > 0 ? ` eclat" style="--p:${pct};--retard:${resteEclat - 1200}ms` : `" style="--p:${pct}`;
    const anneau = `<span class="ratio-trouves ${pct === 100 ? 'complet' : ''}${eclat}" title="Trouvés : ${panier.length} sur ${ici.length}">`
      + `<span class="rt-anneau"><span><b>${panier.length}</b><i>/${ici.length}</i></span><span class="rt-lib">trouvé${panier.length > 1 ? 's' : ''}</span></span></span>`;
    h = h.includes('</h3>') ? h.replace('</h3>', `${anneau}</h3>`) : anneau + h;
  }
  v.innerHTML = h;

  const ids = new Set(panier.map((r) => r.l.id));
  $('#btnVider', v)?.addEventListener('click', () => S.maj((x) => { x.liste = x.liste.filter((l) => !ids.has(l.id)); }));
  $('#btnRecu', v).onclick = () => nouveauRecu();
  $$('.item-liste', v).forEach((el) => brancherAppuiLong(el, () => optionsArticleListe(el.dataset.id)));
  $$('.item-liste', v).forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('input').onchange = (ev) => S.maj((x) => {
      const l = x.liste.find((i) => i.id === id);
      if (l) { l.coche = ev.target.checked; l.cocheLe = ev.target.checked ? new Date().toISOString() : null; }
    });
    el.querySelectorAll('[data-q]').forEach((bt) => bt.onclick = () => changerQuantite(id, Number(bt.dataset.q)));
    el.querySelectorAll('[data-fiche]').forEach((f) => f.onclick = () => ficheArticle(f.dataset.fiche, id));
    el.querySelector('[data-photomag]')?.addEventListener('click', (ev) => { ev.stopPropagation(); identifierArticle(ev.currentTarget.dataset.photomag, id); });
  });
}

function vueListe(v) {
  const e = S.get();
  const photo = lirePref(PREF_PHOTO);
  const seule = lirePref(PREF_SEULE);
  const lignes = e.liste.map((l) => ({ l, a: e.articles.find((x) => x.id === l.articleId) })).filter((x) => x.a);
  // Colonnes : bannières avec une circulaire en cours ET au moins un rabais sur un article de la liste
  const cols = banAvecRabaisListe(banColonnes(), lignes.map((x) => x.a));
  const toutes = lignes.map(({ l, a }) => rangeeListe(l, a, cols));
  // Préparation : ce qui reste à acheter (les articles déjà « dans le panier » sont dans le mode épicerie)
  const rangees = toutes.filter((r) => !r.l.coche);

  // Totaux : par bannière (au-dessus du logo), économies (dessous) et total de l'épicerie (en-tête)
  const tot = {}, eco = {};
  let total = 0;
  for (const r of rangees) {
    if (!r.offre || r.l.indisponible) continue;
    const c = coutPour(r.l, r.a, cleOffre(r.offre));
    if (c != null) { total += c; tot[r.ban] = (tot[r.ban] || 0) + c; }
    if (r.offre.economie) eco[r.ban] = (eco[r.ban] || 0) + r.offre.economie * r.l.quantite;
  }
  const mode = modeListe(cols);
  // Total en haut + économie totale dessous (en magasin : celles de la bannière choisie seulement)
  const montant = mode !== 'prep' ? argent(tot[mode] || 0) : rangees.length ? argent(total) : '';
  const ecoTot = mode !== 'prep' ? eco[mode] || 0 : Object.values(eco).reduce((s, x) => s + x, 0);
  $('#totalListe').innerHTML = montant ? `<span>${montant}</span>${ecoTot > 0.004 ? `<span class="tl-eco" title="Économie totale">${SVG_ETIQ}−${argent(ecoTot)}</span>` : ''}` : '';
  $('#pucesMag').innerHTML = `<button class="${mode === 'prep' ? 'actif' : ''}" data-mode="prep">Prépa.</button>`
    + cols.map((b) => `<button class="${mode === b ? 'actif' : ''}" data-mode="${b}">${esc(nomBanniere(b))}</button>`).join('');
  $$('#pucesMag [data-mode]').forEach((b) => b.onclick = () => {
    if (b.dataset.mode === mode) return;
    try { localStorage.setItem(PREF_MODE, b.dataset.mode); } catch { /* navigation privée */ }
    rendre();
    window.scrollTo(0, 0);
  });
  // Une bannière choisie = on magasine : titre « Mode Magasin » sous les puces
  const titre = $('#modeMagasin');
  titre.hidden = mode === 'prep';
  if (mode !== 'prep') titre.innerHTML = `<span class="mm-titre">Mode Magasin</span><span class="mm-ban">chez ${esc(nomBanniere(mode))}</span>`;
  if (mode !== 'prep') { montrerPuces(); vueEpicerie(v, mode, toutes); return; }

  if (!rangees.length) {
    v.innerHTML = '<div class="vide">Ta liste est vide. Ajoute un produit en haut à droite ou scanne un code-barres.</div>';
    return;
  }

  const nCol = seule ? 1 : cols.length + 3;
  const bascule = (id, lib, on) => `<label class="bascule"><span class="interrupteur"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span><span class="lib">${lib}</span></label>`;
  // Largeur fixe : sans largeur de tableau, le navigateur élargit la colonne produit au nom le plus long
  const largeur = (photo ? 52 : 172) + 72 + cols.length * 72 + 40;
  // Deux tableaux de mêmes colonnes : la tête (bannières, totaux) flotte en haut pendant le défilement,
  // le corps défile dessous ; leurs défilements horizontaux restent synchronisés.
  const ouvrirTable = () => `<table class="prep-t"${seule ? '' : ` style="width:${largeur}px"`}>${seule ? ''
    : `<colgroup><col style="width:${photo ? 52 : 172}px"><col style="width:72px">${cols.map(() => '<col style="width:72px">').join('')}<col style="width:40px"></colgroup>`}`;
  let h = `<div class="prep ${photo ? 'photo' : ''} ${seule ? 'seule' : ''}"><div class="prep-tete">${ouvrirTable()}`;
  // Les deux interrupteurs restent toujours à leur place (Photo s'applique quand Liste est désactivée)
  // À droite des interrupteurs : nombre d'articles sur la liste (Prépa. = ceux qui restent à acheter)
  const nb = `<div class="p-nb" title="${rangees.length} article(s) sur la liste"><b>${rangees.length}</b><span>article${rangees.length > 1 ? 's' : ''}</span></div>`;
  h += `<thead><tr><th class="pc"><div class="pc-tete"><div class="bascules">${bascule('bPhoto', 'Photo', photo)}${bascule('bListe', 'Liste', seule)}</div>${nb}</div></th>`;
  if (!seule) {
    h += '<th><button class="p-deal" id="btnDeal" title="Tout au meilleur prix">Deal</button></th>';
    h += cols.map((b) => `<th><div class="p-tot">${tot[b] ? argent(tot[b]) : ''}</div>${logo(b)}<div class="p-eco">${eco[b] > 0.004 ? `−${argent(eco[b])}` : ''}</div></th>`).join('');
    h += '<th><button class="p-ajban" id="btnAjBan" aria-label="Ajouter une bannière">+</button></th>';
  }
  h += `</tr></thead></table></div><div class="prep-defile">${ouvrirTable()}<tbody>`;

  // Mode Liste : bilan des arrêts, puis bascule « Par rayon / Par magasin »
  let groupe = 'rayon';
  try { groupe = localStorage.getItem(PREF_GROUPE) === 'magasin' ? 'magasin' : 'rayon'; } catch { /* navigation privée */ }
  const recs = seule ? new Map(rangees.map((r) => [r.l.id, etatRecord(r)])) : null;
  const coutDe = (r) => (r.offre && !r.l.indisponible ? coutPour(r.l, r.a, cleOffre(r.offre)) || 0 : 0);
  const sousTotal = (rs) => { const t = rs.reduce((s, r) => s + coutDe(r), 0); return seule && t ? `<span class="pr-st">${argent(t)}</span>` : ''; };
  const rangeeHtml = (r) => (seule ? htmlRangeeListe(r, { groupe, rec: recs.get(r.l.id) }) : htmlRangee(r, cols, seule));
  if (seule) {
    const ecoTot = Object.values(eco).reduce((s, x) => s + x, 0);
    h += htmlBilanListe(rangees, { total, ecoTot, recs });
    h += `<tr class="ls-seg"><td><div class="seg-gr"><button data-groupe="rayon" class="${groupe === 'rayon' ? 'on' : ''}">Par rayon</button><button data-groupe="magasin" class="${groupe === 'magasin' ? 'on' : ''}">Par magasin</button></div></td></tr>`;
  }

  if (seule && groupe === 'magasin') {
    // Un groupe par arrêt (bannière choisie), du plus gros montant au plus petit ; « Sans prix » à la fin
    const parBan = new Map();
    for (const r of rangees) { const k = r.offre ? r.ban : ''; if (!parBan.has(k)) parBan.set(k, []); parBan.get(k).push(r); }
    const cles = [...parBan.keys()].sort((x, y) => (x === '') - (y === '') || parBan.get(y).reduce((s, r) => s + coutDe(r), 0) - parBan.get(x).reduce((s, r) => s + coutDe(r), 0));
    for (const k of cles) {
      const dans = parBan.get(k);
      h += `<tr class="pr"><td colspan="${nCol}"><span class="pr-nom"><span>${k ? logo(k) : 'Sans prix connu'} · ${dans.length}</span>${sousTotal(dans)}</span></td></tr>`;
      h += dans.map(rangeeHtml).join('');
    }
  } else {
    // Rayons dans l'ordre standard (« Ordre par défaut ») ; bande compacte sur toute la largeur
    const divers = rayonParDefaut();
    const rayonDe = (a) => (e.rayons.some((r) => r.id === a.rayonId) ? a.rayonId : divers);
    for (const g of groupesRayons('defaut')) {
      const dans = rangees.filter((r) => g.ids.includes(rayonDe(r.a)));
      if (!dans.length) continue;
      const classer = g.ids.includes(divers) && dans.some((r) => rayonDe(r.a) === divers) ? '<button data-classer>🗂 Classer</button>' : '';
      h += `<tr class="pr"><td colspan="${nCol}"><span class="pr-nom"><span data-reorg title="Changer l'ordre des rayons">${esc(g.nom)} · ${dans.length}</span>${classer}${sousTotal(dans)}</span></td></tr>`;
      h += dans.map(rangeeHtml).join('');
    }
  }
  h += '</tbody></table></div></div>';
  // Le tableau est redessiné à chaque changement (ex. prix mis à jour un à un au démarrage) :
  // on garde la position du défilement de côté, sinon il revient au début toutes les secondes.
  const xAvant = $('.prep-defile', v)?.scrollLeft || 0;
  v.innerHTML = h;

  // Glisser la tête ou le corps de côté : l'autre suit
  const tete = $('.prep-tete', v), corps = $('.prep-defile', v);
  if (xAvant) { corps.scrollLeft = xAvant; tete.scrollLeft = corps.scrollLeft; }
  corps.addEventListener('scroll', () => { if (tete.scrollLeft !== corps.scrollLeft) tete.scrollLeft = corps.scrollLeft; }, { passive: true });
  tete.addEventListener('scroll', () => { if (corps.scrollLeft !== tete.scrollLeft) corps.scrollLeft = tete.scrollLeft; }, { passive: true });
  majHautEntete();

  $('#bPhoto', v)?.addEventListener('change', (ev) => { ecrirePref(PREF_PHOTO, ev.target.checked); rendre(); });
  $('#bListe', v)?.addEventListener('change', (ev) => { ecrirePref(PREF_SEULE, ev.target.checked); rendre(); });
  $$('[data-groupe]', v).forEach((b) => b.onclick = () => {
    try { localStorage.setItem(PREF_GROUPE, b.dataset.groupe); } catch { /* navigation privée */ }
    rendre();
  });
  $('#btnDeal', v)?.addEventListener('click', () => {
    // Meilleur prix parmi les bannières affichées (r.offre sans choix = la moins chère d'entre elles)
    const cles = Object.fromEntries(rangees.map((r) => { const m = Object.values(r.parBan).sort((x, y) => x.pu - y.pu)[0]; return [r.l.id, m ? cleOffre(m) : null]; }));
    S.maj((x) => x.liste.forEach((li) => { if (cles[li.id]) li.magasinCible = cles[li.id]; }));
    toast('Tout au meilleur prix');
  });
  $('#btnAjBan', v)?.addEventListener('click', () => allerOnglet('magasins'));
  $$('[data-reorg]', v).forEach((b) => b.onclick = () => ouvrirReorg('defaut'));
  $$('[data-classer]', v).forEach((b) => b.onclick = () => classerSansRayon());

  $$('tr.pl', v).forEach((tr) => {
    const id = tr.dataset.l;
    // Toucher la photo ou le nom → fiche ; garder le doigt 3 s sur la photo → retirer / pas disponible / rayon
    tr.querySelector('.pc').addEventListener('click', (ev) => {
      const f = ev.target.closest('[data-fiche]');
      if (f) ficheArticle(f.dataset.fiche, id);
    });
    brancherAppuiLong(tr.querySelector('.p-photo'), () => optionsArticleListe(id));
    tr.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => changerQuantite(id, Number(b.dataset.q)));
    tr.querySelectorAll('.pcel[data-cle]').forEach((b) => b.onclick = () => S.maj((x) => {
      const l = x.liste.find((i) => i.id === id);
      if (l) l.magasinCible = b.dataset.cle;
    }));
  });
}

// --- En-tête de la liste : branché une seule fois (il n'est pas redessiné) ---

/** Hauteur visible de l'en-tête → la tête de colonnes de Prépa. flotte juste dessous (corrigée du zoom d'affichage). */
function majHautEntete() {
  const z = Number($('#vue').style.zoom) || 1;
  $('#vue').style.setProperty('--haut-entete', `${$('#entete').offsetHeight / z}px`);
}

/**
 * Prépa. : les puces (Prépa., IGA, Super C…) disparaissent en descendant et reviennent en remontant.
 * L'espace qu'elles occupaient est rendu en marge sous l'en-tête : la page ne saute pas pendant le défilement.
 */
function cacherPuces() {
  const en = $('#entete');
  if (en.classList.contains('puces-masquees')) return;
  const avant = en.offsetHeight;
  en.classList.add('puces-masquees');
  en.style.marginBottom = `${avant - en.offsetHeight}px`;
  majHautEntete();
}
function montrerPuces() {
  const en = $('#entete');
  if (!en.classList.contains('puces-masquees')) return;
  en.classList.remove('puces-masquees');
  en.style.marginBottom = '';
  majHautEntete();
}

function terminerSaisie() {
  const saisie = $('#saisie');
  saisie.value = '';
  masquerSuggestions();
  $('#champAjout').classList.remove('ouvert');
  saisie.blur();
}

(() => {
  const saisie = $('#saisie'), champ = $('#champAjout'), zone = $('#suggestions');
  // Quitter le champ sans ✓ (ni Entrée) et sans toucher une proposition = abandon : le texte est effacé.
  // Pendant la recherche en ligne lancée par ✓, le texte reste (la recherche s'en sert).
  const abandonner = () => {
    champ.classList.remove('ouvert');
    masquerSuggestions();
    if (!champ.classList.contains('charge')) saisie.value = '';
  };
  // Le champ s'élargit par-dessus l'en-tête quand on écrit, puis reprend sa place
  saisie.addEventListener('focus', () => champ.classList.add('ouvert'));
  saisie.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === saisie) return;
    abandonner();
  }, 150));
  // Toucher une suggestion ou ✓ ne fait pas perdre le focus au champ (sinon la liste se fermerait avant le toucher)
  zone.addEventListener('pointerdown', (ev) => ev.preventDefault());
  $('#btnEntree').addEventListener('pointerdown', (ev) => ev.preventDefault());
  $('#btnEntree').addEventListener('click', () => valider());
  saisie.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') valider();
    if (ev.key === 'Escape') terminerSaisie();
  });
  // Autocomplétion : le nom du produit le plus probable se complète dans le champ (partie sélectionnée)
  saisie.addEventListener('input', (ev) => {
    const trouves = suggerer(saisie.value);
    if (!ev.inputType?.startsWith('insert') || !trouves.length) return;
    const m = saisie.value.match(/^(\d+(?:[.,]\d+)?\s*(?:x\s*)?)?(.*)$/i);
    const avant = m[1] || '', tape = m[2];
    const nom = trouves[0].nom;
    if (tape.length < 2 || nom.length <= tape.length || !sansAccents(nom).startsWith(sansAccents(tape))) return;
    saisie.value = avant + tape + nom.slice(tape.length);
    saisie.setSelectionRange(avant.length + tape.length, saisie.value.length);
  });
  // Toucher ailleurs que dans l'en-tête : le champ reprend sa place et les propositions se ferment
  document.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('header') || !champ.classList.contains('ouvert')) return;
    abandonner();
  });
  $('#btnScan').onclick = () => ouvrirScan((a) => { ajouterALaListe(a.id); toast(`${a.nom} ajouté`); montrerAjout(a.id); });

  // Barre d'onglets du bas : cachée en descendant, revient dès qu'on remonte
  let yPrec = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, nav = $('#onglets');
    if (y > yPrec + 6 && y > 40) nav.classList.add('masquee');
    else if (y < yPrec - 6 || y <= 40) nav.classList.remove('masquee');
    // Prépa. seulement : les puces suivent la barre du bas (en magasin, elles restent visibles)
    const prep = document.body.classList.contains('onglet-liste') && $('#vue .prep');
    if (prep && y > yPrec + 6 && y > 40) cacherPuces();
    else if (!prep || y < yPrec - 6 || y <= 40) montrerPuces();
    yPrec = y;
  }, { passive: true });

  // Taille d'affichage : 100 % = curseur en bas ; on monte pour réduire (jusqu'à 60 %). L'en-tête ne change pas.
  const boite = $('#zoomVue'), curseur = $('#zoomCurseur');
  let delai = null;
  const appliquer = (p) => { $('#vue').style.zoom = p === 100 ? '' : String(p / 100); $('#zoomValeur').textContent = `${p} %`; majHautEntete(); };
  const recacher = () => { clearTimeout(delai); delai = setTimeout(() => boite.classList.remove('ouvert'), 2500); };
  let p = 100;
  try { p = Math.min(100, Math.max(60, Number(localStorage.getItem('zoom-vue')) || 100)); } catch { /* navigation privée */ }
  curseur.value = String(100 - p);
  appliquer(p);
  $('#zoomPoignee').onclick = () => { boite.classList.add('ouvert'); recacher(); };
  curseur.addEventListener('input', () => {
    const val = 100 - Number(curseur.value);
    appliquer(val);
    try { localStorage.setItem('zoom-vue', String(val)); } catch { /* navigation privée */ }
    recacher();
  });
})();

/** « 2 lait, beurre et café » → [{ quantite: 2, nom: 'lait' }, …] */
function decouperSaisie(txt) {
  return txt.split(/,|\bet\b|;/i).map((s) => s.trim()).filter(Boolean).map((m) => {
    const r = m.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s*)?(.+)$/i);
    return { quantite: r ? Number(r[1].replace(',', '.')) : 1, nom: r ? r[2] : m };
  });
}

/**
 * ✓ : produit connu → ajouté. Un seul produit inconnu → recherche en ligne silencieuse (icône de chargement) :
 * des produits trouvés → proposés ; rien → ajouté tel quel. Plusieurs produits ou hors ligne → ajoutés tels quels.
 */
async function valider() {
  const saisie = $('#saisie'), champ = $('#champAjout');
  const brut = saisie.value.trim();
  if (!brut || champ.classList.contains('charge')) return;
  const morceaux = decouperSaisie(brut);
  const seul = morceaux.length === 1 && !trouverArticle(morceaux[0].nom) ? morceaux[0] : null;
  if (!seul || !navigator.onLine) { terminerSaisie(); ajouterTexte(brut); return; }
  masquerSuggestions();
  champ.classList.add('charge');
  let res = [];
  try { res = await rechercherSouple(seul.nom); } catch { res = []; }
  champ.classList.remove('charge');
  if (saisie.value.trim() !== brut) return; // le texte a changé pendant la recherche
  const vus = new Set();
  const props = res.filter((r) => {
    const k = sansAccents(`${r.brand || ''} ${r.name} ${r.size || ''}`);
    if (vus.has(k)) return false;
    vus.add(k); return true;
  }).slice(0, 6);
  if (!props.length) { terminerSaisie(); ajouterTexte(brut); return; }
  const zone = $('#suggestions');
  zone.innerHTML = props.map((r, i) => `<button class="sugg" data-enligne="${i}">${r.image ? `<img class="vignette petite" src="${esc(r.image)}" alt="">` : '<span class="vignette petite"></span>'}
      <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">${esc(r.name)}</span>
      <span class="doux une-ligne" style="display:block;font-size:12px">${esc([r.brand, r.size ? formatLisible(r.size) : ''].filter(Boolean).join(' · '))}</span></span></button>`).join('')
    + `<button class="sugg" data-telquel="1"><span class="vignette petite" style="display:grid;place-items:center">＋</span><span class="grandir une-ligne">Garder « ${esc(brut)} » tel quel</span></button>`;
  zone.classList.remove('cache');
  champ.classList.add('ouvert'); // le clavier a pu se fermer pendant la recherche : le champ reste ouvert avec les propositions
  $$('[data-enligne]', zone).forEach((b) => b.onclick = () => { terminerSaisie(); ajouterDepuisEnLigne(props[Number(b.dataset.enligne)], seul.quantite); });
  $('[data-telquel]', zone).onclick = () => { terminerSaisie(); ajouterTexte(brut); };
}

/** Produit trouvé en ligne (épiceries.ca) → fiche remplie (nom, marque, format, photo, lien) + ses prix en arrière-plan. */
function ajouterDepuisEnLigne(r, quantite = 1) {
  let a = S.get().articles.find((x) => (x.liens || []).some((li) => li.id === r.id));
  if (!a) {
    const f = analyserFormat(r.size);
    a = { id: S.uid('a'), nom: String(r.name || '').trim().replace(/^./, (c) => c.toUpperCase()), marque: r.brand || '',
      rayonId: rayonParDefaut(), uniteRef: f?.base || 'unite', format: r.size ? formatLisible(r.size) : '', local: false, codes: [],
      imageUrl: r.image || null, liens: [{ id: r.id, nom: [r.brand, r.name].filter(Boolean).join(' '), size: r.size, image: r.image }] };
    const nouveau = a;
    S.maj((e) => e.articles.push(nouveau));
  }
  ajouterALaListe(a.id, quantite);
  toast(`${a.nom} ajouté`);
  montrerAjout(a.id);
  actualiserArticle(a.id, { force: true }).then(() => rendre()).catch(() => { /* hors ligne : les prix viendront plus tard */ });
}

// --- Saisie : d'abord ta base (articles déjà achetés / au catalogue) ---
function masquerSuggestions() { $('#suggestions')?.classList.add('cache'); }

// Idées Open Food Facts pendant la saisie : produits vendus au Canada, regroupés par nom.
// Limite d'Open Food Facts ≈ 10 recherches/min : attente de 500 ms après la frappe, cache, et 8 appels/min au plus.
const cacheOFF = new Map();
const appelsOFF = [];
let minuterieOFF = null;
function suggererOFF(q, txt) {
  clearTimeout(minuterieOFF);
  minuterieOFF = setTimeout(async () => {
    if (!navigator.onLine || sansAccents($('#saisie')?.value || '').indexOf(q) < 0) return;
    let idees = cacheOFF.get(q);
    if (!idees) {
      const maintenant = Date.now();
      while (appelsOFF.length && maintenant - appelsOFF[0] > 60000) appelsOFF.shift();
      if (appelsOFF.length >= 8) return;
      appelsOFF.push(maintenant);
      try {
        const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=20`
          + '&tagtype_0=countries&tag_contains_0=contains&tag_0=canada&fields=product_name_fr,product_name,brands,quantity,image_front_small_url');
        const j = await r.json();
        // Regroupe par nom générique (« Riz basmati ») avec quelques marques/formats en exemple
        const groupes = new Map();
        for (const p of j.products || []) {
          const nom = String(p.product_name_fr || p.product_name || '').trim();
          if (!nom || !sansAccents(nom).includes(q)) continue;
          const k = sansAccents(nom);
          const g = groupes.get(k) || { nom: nom.replace(/^./, (c) => c.toUpperCase()), exemples: [], image: p.image_front_small_url || '' };
          const ex = [p.brands?.split(',')[0]?.trim(), p.quantity].filter(Boolean).join(' ');
          if (ex && g.exemples.length < 3 && !g.exemples.includes(ex)) g.exemples.push(ex);
          groupes.set(k, g);
        }
        // On n'affiche pas ce que ton catalogue a déjà
        idees = [...groupes.values()].filter((g) => !trouverArticle(g.nom)).slice(0, 4);
        cacheOFF.set(q, idees);
      } catch { return; }
    }
    const boite = $('#suggOFF');
    if (!boite || !idees.length) return;
    $('#suggestions').classList.remove('cache'); // rien dans ton catalogue, mais des idées : on les montre
    boite.innerHTML = `<div class="doux" style="font-size:12px;padding:6px 8px 2px">💡 Idées (Open Food Facts, Canada)</div>` + idees.map((g, i) =>
      `<button class="sugg" data-off="${i}">${g.image ? `<img class="vignette petite" src="${esc(g.image)}" alt="">` : '<span class="vignette petite"></span>'}
        <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">${esc(g.nom)}</span>
        ${g.exemples.length ? `<span class="doux une-ligne" style="display:block;font-size:12px">ex. ${esc(g.exemples.join(' · '))}</span>` : ''}</span></button>`).join('');
    $$('[data-off]', boite).forEach((b) => b.onclick = () => {
      const r = txt.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s*)?/i);
      const g = idees[Number(b.dataset.off)];
      terminerSaisie();
      ajouterTexte(`${r ? r[0] : ''}${g.nom}`, { forcerNouveau: true, image: g.image || null });
    });
  }, 500);
}

/** Suggestions pendant la frappe (ton catalogue, puis idées Open Food Facts). Rien trouvé → rien d'affiché. Retourne les produits trouvés. */
function suggerer(txt) {
  const zone = $('#suggestions');
  const q = sansAccents(txt.replace(/^\d+(?:[.,]\d+)?\s*(?:x\s*)?/i, ''));
  if (!zone || q.length < 2) { masquerSuggestions(); return []; }
  const e = S.get();
  const achats = (id) => e.liste.filter((l) => l.articleId === id).length + (e.achats?.filter((x) => x.articleId === id).length || 0);
  // Produits d'abord : nom, marque ou n'importe laquelle de leurs marques/formats (taper « tilda » trouve « Riz basmati blanc »)
  const pertinence = (a) => {
    const n = sansAccents(a.nom);
    if (n.startsWith(q)) return 3;
    if (n.split(/[^a-z0-9]+/).some((m) => m.startsWith(q))) return 2;
    if (n.includes(q)) return 1;
    const parVariante = P.variantesActives(a).find((v) => sansAccents(`${v.marque || ''} ${v.nom || ''}`).includes(q));
    return parVariante || sansAccents(a.marque || '').includes(q) ? 0.5 : 0;
  };
  const trouves = e.articles.map((a) => ({ a, p: pertinence(a) })).filter((x) => x.p > 0)
    .sort((x, y) => y.p - x.p || achats(y.a.id) - achats(x.a.id) || x.a.nom.localeCompare(y.a.nom, 'fr')).slice(0, 6).map((x) => x.a);
  zone.innerHTML = trouves.map((a) => {
    const m = meilleureOffre(a);
    const nbV = P.variantesActives(a).length;
    const detail = m
      ? `${m.produitOffre ? `Moins cher : ${esc(m.produitOffre)}` : esc(formatLisible(a.format) || '')} · ${esc(nomOffre(m))}`
      : `${esc(formatLisible(a.format) || '')}${nbV > 1 ? ` · ${nbV} marques/formats` : ''}`;
    return `<button class="sugg" data-sugg="${a.id}">${photoDe(a) ? `<img class="vignette petite" src="${esc(photoDe(a))}" alt="">` : '<span class="vignette petite"></span>'}
      <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">${esc(a.nom)}</span>
        ${detail.replace(/^ · /, '') ? `<span class="doux une-ligne" style="display:block;font-size:12px">${detail.replace(/^ · /, '')}</span>` : ''}</span>
      <span class="doux">${m ? esc(libelleUnitaire(m.pu, m.uniteRef).split(' · ')[0]) : ''}</span></button>`;
  }).join('') + '<div id="suggOFF"></div>';
  zone.classList.toggle('cache', !trouves.length); // rien dans ton catalogue → rien d'affiché (sauf idées OFF plus bas)
  // Peu de résultats dans ton catalogue : idées tirées d'Open Food Facts (produits vendus au Canada)
  if (trouves.length < 3 && q.length >= 3) suggererOFF(q, txt);
  $$('[data-sugg]', zone).forEach((b) => b.onclick = () => {
    const r = txt.match(/^(\d+(?:[.,]\d+)?)/);
    ajouterALaListe(b.dataset.sugg, r ? Number(r[1].replace(',', '.')) : 1);
    terminerSaisie();
    toast(`${S.get().articles.find((a) => a.id === b.dataset.sugg).nom} ajouté`);
    montrerAjout(b.dataset.sugg);
  });
  return trouves;
}

/**
 * « 2 lait, beurre et café » → plusieurs ajouts, sans fenêtre ni étape affichée.
 * Article déjà dans ta base → ajouté. Nouveau → créé avec la description telle quelle
 * (la recherche en ligne se fait avant, dans valider(), pour un produit seul).
 */
function ajouterTexte(txt, { forcerNouveau = false, image = null } = {}) {
  const noms = [];
  let dernier = null;
  for (const { quantite, nom } of decouperSaisie(txt)) {
    const existant = forcerNouveau ? S.get().articles.find((a) => sansAccents(a.nom) === sansAccents(nom)) : trouverArticle(nom);
    const a = existant || creerArticle(nom, image);
    ajouterALaListe(a.id, quantite);
    noms.push(a.nom);
    dernier = a.id;
  }
  if (noms.length) toast(`Ajouté : ${noms.join(', ')}`);
  if (dernier) montrerAjout(dernier);   // plusieurs produits : le cadre va sur le dernier
}

function creerArticle(nom, image = null) {
  const a = { id: S.uid('a'), nom: nom.trim().replace(/^./, (c) => c.toUpperCase()), rayonId: rayonParDefaut(),
    uniteRef: 'unite', format: '', local: false, codes: [], ...(image ? { imageUrl: image } : {}) };
  if (/kirkland/i.test(nom)) a.exclusif = 'costco';
  S.maj((e) => e.articles.push(a));
  return a;
}

/**
 * Sections de la liste pour un magasin : les rayons dans l'ordre du magasin,
 * avec les rayons « joints » regroupés sous une même section (ex. Laitiers + Œufs).
 */
function groupesRayons(magId) {
  const e = S.get();
  const joints = new Set(e.rayonsJoints?.[magId] || []);
  const groupes = [];
  for (const r of ordreRayons(magId)) {
    if (joints.has(r.id) && groupes.length) { const g = groupes[groupes.length - 1]; g.ids.push(r.id); g.nom += ' · ' + r.nom; }
    else groupes.push({ ids: [r.id], nom: r.nom });
  }
  return groupes;
}


// --- Réorganiser les rayons (glisser-déposer tactile) -----------------
function ouvrirReorg(magId) {
  const e = S.get();
  const cible = magId || e.magasinCourant; // l'ordre est enregistré pour CE magasin et réutilisé à chaque visite
  const nomMag = cible === 'defaut' ? 'ordre par défaut' : e.magasins.find((m) => m.id === cible)?.nom;
  const joints = () => new Set(S.get().rayonsJoints?.[cible] || []);
  const rendreListe = () => { const j = joints(); return ordreRayons(cible).map((r, i) =>
    `<li data-r="${r.id}" class="${j.has(r.id) && i ? 'joint' : ''}"><span class="poignee" aria-hidden="true">≡</span><span class="grandir">${esc(r.nom)}</span>
     ${i ? `<button class="icone" data-joindre="${r.id}" title="${j.has(r.id) ? 'Séparer du rayon du dessus' : 'Regrouper avec le rayon du dessus'}" aria-label="Regrouper">${j.has(r.id) ? '⛓' : '🔗'}</button>` : ''}
     <button class="icone" data-mv="-1" aria-label="Monter">▲</button><button class="icone" data-mv="1" aria-label="Descendre">▼</button></li>`).join(''); };
  ouvrirModale('Ordre des rayons', `<p class="doux">Pour : <b>${esc(nomMag)}</b> (gardé pour ce magasin). Glisse ≡ ou utilise ▲▼ pour suivre ton parcours. 🔗 regroupe un rayon avec celui du dessus en une seule section ; ⛓ les sépare.</p>
    <ul class="reorg" id="reorg">${rendreListe()}</ul>
    <div class="rang" style="margin-top:10px"><input id="nouveauRayon" placeholder="Nouveau rayon"><button class="btn sec" id="ajRayon">Ajouter</button></div>
    <button class="btn sec" id="reorgGerer" style="width:100%;margin-top:8px">⚙️ Gérer les catégories (supprimer…)</button>
    <button class="btn" id="reorgOk" style="width:100%;margin-top:10px">✓ Terminé</button>`, (c) => {
    $('#reorgOk', c).onclick = fermerModale;
    $('#reorgGerer', c).onclick = () => gererCategories(() => ouvrirReorg(magId));
    const ul = $('#reorg', c);
    const corps = $('#modaleCorps');
    const sauver = () => S.maj((x) => { x.ordreRayons[cible] = $$('li', ul).map((li) => li.dataset.r); });
    // Réaffiche en gardant la position de défilement, et fait clignoter le rayon touché (confirmation visuelle)
    const reafficher = (idTouche) => {
      const y = corps.scrollTop;
      ul.innerHTML = rendreListe(); brancher(); corps.scrollTop = y;
      const li = idTouche && ul.querySelector(`li[data-r="${CSS.escape(idTouche)}"]`);
      if (li) { li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 700); }
    };
    const brancher = () => {
      $$('[data-joindre]', ul).forEach((b) => b.onclick = () => {
        S.maj((x) => {
          x.rayonsJoints ||= {};
          const s = new Set(x.rayonsJoints[cible] || []);
          s.has(b.dataset.joindre) ? s.delete(b.dataset.joindre) : s.add(b.dataset.joindre);
          x.rayonsJoints[cible] = [...s];
          x.ordreRayons[cible] = $$('li', ul).map((li) => li.dataset.r);
        });
        reafficher(b.dataset.joindre);
      });
      $$('[data-mv]', ul).forEach((b) => b.onclick = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const li = b.closest('li'); const d = Number(b.dataset.mv);
        if (d < 0 && li.previousElementSibling) ul.insertBefore(li, li.previousElementSibling);
        if (d > 0 && li.nextElementSibling) ul.insertBefore(li.nextElementSibling, li);
        sauver(); reafficher(li.dataset.r);
      });
      // Glisser au doigt : événements tactiles (fiables sur iPhone) + souris
      $$('.poignee', ul).forEach((p) => {
        const li = p.closest('li');
        const deplacer = (y) => {
          const sous = [...ul.children].find((x) => { const r = x.getBoundingClientRect(); return x !== li && y > r.top && y < r.bottom; });
          if (!sous) return;
          const box = sous.getBoundingClientRect();
          ul.insertBefore(li, y < box.top + box.height / 2 ? sous : sous.nextElementSibling);
        };
        const fin = () => { li.classList.remove('glisse'); sauver(); reafficher(li.dataset.r); };
        p.addEventListener('touchstart', (ev) => { ev.preventDefault(); li.classList.add('glisse'); }, { passive: false });
        p.addEventListener('touchmove', (ev) => { ev.preventDefault(); deplacer(ev.touches[0].clientY); }, { passive: false });
        p.addEventListener('touchend', fin);
        p.onmousedown = (ev) => {
          ev.preventDefault(); li.classList.add('glisse');
          const mv = (m) => deplacer(m.clientY);
          const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); fin(); };
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        };
      });
    };
    brancher();
    $('#ajRayon', c).onclick = () => {
      const nom = $('#nouveauRayon', c).value.trim(); if (!nom) return;
      S.maj((x) => x.rayons.push({ id: S.uid('r'), nom }));
      ul.innerHTML = rendreListe(); brancher(); $('#nouveauRayon', c).value = '';
    };
  });
}

// --- Catégories (rayons) --------------------------------------------------
/** Options du menu des catégories, triées, avec « + Ajouter une catégorie… » à la fin. */
function optionsCategories(selection) {
  const rayons = [...S.get().rayons].sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  return rayons.map((r) => `<option value="${r.id}" ${r.id === selection ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')
    + '<option value="+">+ Ajouter une catégorie…</option>';
}

/** Crée le rayon (ou reprend celui du même nom, sans tenir compte des accents). Retourne son id, ou null. */
export function creerRayon(nom) {
  nom = String(nom || '').trim();
  if (!nom) return null;
  const exist = S.get().rayons.find((r) => sansAccents(r.nom) === sansAccents(nom));
  if (exist) { toast(`« ${exist.nom} » existe déjà`); return exist.id; }
  const id = S.uid('r');
  S.maj((x) => x.rayons.push({ id, nom: nom.replace(/^./, (k) => k.toUpperCase()) }));
  toast(`Rayon « ${nom.replace(/^./, (k) => k.toUpperCase())} » créé`);
  return id;
}

/** Demande un nom et crée la catégorie (ou reprend celle du même nom). Retourne son id, ou null. */
function ajouterCategorie() {
  return creerRayon(prompt('Nom de la nouvelle catégorie :') || '');
}

/** Texte du bouton de rayon : « 🗂 Produits laitiers ▾ ». */
export function texteBoutonRayon(id) {
  return `🗂 ${S.get().rayons.find((r) => r.id === id)?.nom || 'Choisir un rayon'} ▾`;
}

/**
 * Branche le sélecteur de rayon sur `bouton` / `panneau`. actuel() : id du rayon actuel.
 * surId(id) reçoit le rayon choisi (créé au besoin) ; le texte du bouton est mis à jour.
 */
export function brancherRayon(bouton, panneau, actuel, surId) {
  brancherSelecteurRayon(bouton, panneau, actuel, (choix) => {
    const id = choix.id || creerRayon(choix.nom);
    if (!id) return;
    bouton.textContent = texteBoutonRayon(id);
    surId(id);
  });
}

/** Déplace un produit dans un rayon, choisi à la main (l'app ne le changera plus automatiquement). */
function placerDansRayon(articleId, rayonId) {
  S.maj((x) => { const ar = x.articles.find((i) => i.id === articleId); if (ar) { ar.rayonId = rayonId; ar.rayonManuel = true; } });
  const e = S.get();
  toast(`${e.articles.find((a) => a.id === articleId)?.nom || 'Produit'} → ${e.rayons.find((r) => r.id === rayonId)?.nom}`);
}

/** « 🗂 Classer » : chaque produit de la liste rangé dans Divers, avec son sélecteur de rayon. */
function classerSansRayon() {
  const divers = rayonParDefaut();
  const dessiner = () => {
    const e = S.get();
    const lignes = e.liste.filter((l) => !l.coche && e.articles.find((a) => a.id === l.articleId)?.rayonId === divers);
    if (!lignes.length) { fermerModale(); toast('Tout est classé 👍'); return; }
    ouvrirModale(`Classer (${lignes.length})`, `<p class="doux" style="margin-top:0">Ces produits sont dans « ${esc(e.rayons.find((r) => r.id === divers)?.nom || 'Divers')} ». Choisis leur rayon, ou tape un nom pour en créer un.</p>
      ${lignes.map((l) => { const a = e.articles.find((x) => x.id === l.articleId); return `<div class="champ" style="margin-bottom:6px">
        <label>${esc(a.nom)}</label>
        <button type="button" class="btn sec" data-classer-art="${a.id}" style="width:100%;text-align:left">${esc(texteBoutonRayon(a.rayonId))}</button>
        <div data-classer-pan="${a.id}" hidden></div></div>`; }).join('')}
      <button class="btn sec" id="clFini" style="width:100%;margin-top:8px">Terminé</button>`, (c) => {
      $$('[data-classer-art]', c).forEach((b) => {
        const id = b.dataset.classerArt;
        brancherRayon(b, c.querySelector(`[data-classer-pan="${id}"]`), () => S.get().articles.find((a) => a.id === id)?.rayonId,
          (rid) => { placerDansRayon(id, rid); if (rid !== divers) dessiner(); });
      });
      $('#clFini', c).onclick = () => fermerModale();
    });
  };
  dessiner();
}

/** Liste des catégories : nombre de produits, ajout, suppression (avec déplacement des produits). */
function gererCategories(retour) {
  const e = S.get();
  const compte = (id) => e.articles.filter((a) => a.rayonId === id).length;
  ouvrirModale('Catégories', `
    <p class="doux">Une catégorie = un rayon de ta liste. Pour la supprimer, ses produits sont d'abord déplacés dans une autre.</p>
    ${[...e.rayons].sort((x, y) => x.nom.localeCompare(y.nom, 'fr')).map((r) => `<div class="item">
      <div class="grandir"><div class="nom">${esc(r.nom)}</div><div class="info">${compte(r.id)} produit(s)</div></div>
      <button class="icone" data-supcat="${r.id}" aria-label="Supprimer ${esc(r.nom)}">🗑</button></div>`).join('')}
    <button class="btn" id="catAjout" style="width:100%;margin-top:8px">+ Ajouter une catégorie</button>
    ${retour ? '<button class="btn sec" id="catRetour" style="width:100%;margin-top:8px">‹ Retour à la fiche</button>' : ''}`, (c) => {
    $('#catAjout', c).onclick = () => { if (ajouterCategorie()) gererCategories(retour); };
    $('#catRetour', c)?.addEventListener('click', retour);
    $$('[data-supcat]', c).forEach((b) => b.onclick = () => supprimerCategorie(b.dataset.supcat, () => gererCategories(retour)));
  });
}

/** Fenêtre de suppression : choisir où vont les produits, puis supprimer. */
function supprimerCategorie(id, apres) {
  const e = S.get();
  const r = e.rayons.find((x) => x.id === id);
  if (!r) return;
  if (e.rayons.length <= 1) { toast('Il faut garder au moins une catégorie'); return; }
  const produits = e.articles.filter((a) => a.rayonId === id);
  const autres = [...e.rayons].filter((x) => x.id !== id).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  ouvrirModale(`Supprimer « ${r.nom} »`, `
    ${produits.length ? `<p><b>${produits.length} produit(s)</b> sont dans cette catégorie : ${produits.slice(0, 8).map((a) => esc(a.nom)).join(', ')}${produits.length > 8 ? '…' : ''}</p>
      <div class="champ"><label>Les déplacer vers :</label><select id="catCible"><option value="">— Choisis une catégorie —</option>
        ${autres.map((x) => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select></div>`
      : '<p>Cette catégorie est vide.</p>'}
    <div class="rang" style="margin-top:8px"><button class="btn danger grandir" id="catOk">Supprimer</button><button class="btn sec grandir" id="catAnnuler">Annuler</button></div>`, (c) => {
    $('#catAnnuler', c).onclick = apres;
    $('#catOk', c).onclick = () => {
      const cible = produits.length ? $('#catCible', c).value : null;
      if (produits.length && !cible) { toast('Choisis où déplacer les produits'); return; }
      S.maj((x) => {
        x.articles.forEach((a) => { if (a.rayonId === id) { a.rayonId = cible; a.rayonManuel = true; } });
        x.rayons = x.rayons.filter((y) => y.id !== id);
        for (const k of Object.keys(x.ordreRayons || {})) x.ordreRayons[k] = x.ordreRayons[k].filter((y) => y !== id);
        for (const k of Object.keys(x.rayonsJoints || {})) x.rayonsJoints[k] = x.rayonsJoints[k].filter((y) => y !== id);
      });
      toast(`« ${r.nom} » supprimée${produits.length ? ` — ${produits.length} produit(s) déplacé(s)` : ''}`);
      apres();
    };
  });
}

// --- Marques et formats (variantes) d'un produit -------------------------
/** Nombre de vrais codes-barres (un UPC et son EAN « 0… » comptent pour un seul). */
const nbCodes = (codes) => new Set(codes.map((c) => (c.length === 12 ? '0' + c : c))).size;
function htmlVariantes(a) {
  const pref = P.variantePref(a);
  const offres = offresArticle(a).filter((o) => o.pu != null);
  const formulaire = (v = {}) => `<div class="carte" style="margin:6px 0;background:var(--gris-fond)">
    <div class="rang"><div class="champ grandir"><label>Marque</label><input data-vf="marque" value="${esc(v.marque || '')}" placeholder="Tilda"></div>
      <div class="champ grandir"><label>Format</label><input data-vf="format" value="${esc(v.format || '')}" placeholder="2 kg"></div></div>
    <div class="champ"><label>Précision (facultatif)</label><input data-vf="nom" value="${esc(v.nom || '')}" placeholder="ex. grains longs, bio"></div>
    <div class="champ"><label>Code(s)-barres (facultatif, séparés par une virgule)</label><input data-vf="codes" inputmode="numeric" value="${esc((v.codes || []).join(', '))}"></div>
    <div class="rang"><button class="btn" data-vok>✓ Enregistrer</button><button class="btn sec" data-vannule>Annuler</button></div></div>`;
  return `<h3 style="margin-top:14px">Marques et formats</h3>
    <p class="doux" style="margin:0 0 6px">Un même produit peut se vendre en plusieurs marques et formats. ★ = celle que tu achètes d'habitude (son format et sa marque sont ceux de la fiche).</p>
    ${P.variantesActives(a).map((v) => {
      const o = offres.find((x) => x.varianteId === v.id);
      const estPref = v === pref;
      return `<div class="item" data-v="${v.id}" style="align-items:flex-start">
        <button class="icone" data-vpref title="${estPref ? 'Variante habituelle' : 'En faire la variante habituelle'}" aria-label="Variante habituelle">${estPref ? '★' : '☆'}</button>
        <div class="grandir"><div class="nom">${esc(P.libelleVariante(v))}</div>
          <div class="info">${v.codes?.length ? `▥ ${nbCodes(v.codes)} code(s)-barres` : 'sans code-barres'}${o ? ` · ${esc(libelleUnitaire(o.pu, o.uniteRef).split(' · ')[0])} ${esc(nomOffre(o))}` : ''}</div></div>
        <button class="icone" data-vmod title="Modifier" aria-label="Modifier">✏️</button>
        ${!estPref && P.variantesActives(a).length > 1 ? `<button class="icone" data-vsep title="Séparer en produit à part" aria-label="Séparer">↗</button>
          <button class="icone" data-vsup title="Retirer" aria-label="Retirer">🗑</button>` : ''}
      </div><div data-vform="${v.id}" hidden>${formulaire(v)}</div>`;
    }).join('')}
    <button class="btn sec" id="vAjout" style="width:100%;margin-top:6px">+ Ajouter une marque ou un format</button>
    <div data-vform="nouveau" hidden>${formulaire()}</div>`;
}

function brancherVariantes(c, a, rouvrir) {
  const lire = (f) => ({ marque: $('[data-vf="marque"]', f).value, nom: $('[data-vf="nom"]', f).value, format: $('[data-vf="format"]', f).value,
    // Chaque code tapé est gardé sous ses formes UPC/EAN, comme au scan
    codes: [...new Set($('[data-vf="codes"]', f).value.split(/[,;\s]+/).filter(Boolean).flatMap(gtinVariantes))] });
  const basculer = (id) => $$('[data-vform]', c).forEach((f) => { f.hidden = f.dataset.vform !== id || !f.hidden; });
  const modifier = (fn, msg) => { S.maj((x) => { const ar = x.articles.find((i) => i.id === a.id); if (ar) fn(ar); }); toast(msg); rouvrir(); };
  $$('[data-v]', c).forEach((row) => {
    const vid = row.dataset.v;
    $('[data-vpref]', row).onclick = () => modifier((ar) => P.choisirPreferee(ar, vid), 'Variante habituelle changée');
    $('[data-vmod]', row).onclick = () => basculer(vid);
    $('[data-vsep]', row)?.addEventListener('click', () => {
      const v = a.variantes.find((x) => x.id === vid);
      const nom = prompt('Séparer en produit à part (ses prix et codes-barres le suivent). Nom du nouveau produit :', `${a.nom} ${P.libelleVariante(v)}`);
      if (!nom?.trim()) return;
      const nid = S.uid('a');
      S.maj((x) => P.separerVariante(x, a.id, vid, nom, nid));
      toast(`« ${nom.trim()} » est maintenant un produit à part`);
      rouvrir();
    });
    $('[data-vsup]', row)?.addEventListener('click', () => {
      if (confirm('Retirer cette marque / ce format ? Ses codes-barres quittent le produit ; ses prix restent dans l\'historique.')) modifier((ar) => P.retirerVariante(ar, vid), 'Variante retirée');
    });
  });
  $('#vAjout', c).onclick = () => basculer('nouveau');
  $$('[data-vform]', c).forEach((f) => {
    const vid = f.dataset.vform;
    $('[data-vannule]', f).onclick = () => { f.hidden = true; };
    $('[data-vok]', f).onclick = () => {
      const d = lire(f);
      if (!d.marque.trim() && !d.format.trim() && !d.codes.length) { toast('Entre au moins une marque, un format ou un code'); return; }
      const ailleurs = d.codes.map((code) => P.varianteParCode(S.get(), code)).find((r) => r && r.article.id !== a.id);
      if (ailleurs) { toast(`Ce code appartient déjà à « ${ailleurs.article.nom} »`); return; }
      if (vid === 'nouveau') modifier((ar) => P.ajouterVariante(ar, d), 'Marque / format ajouté');
      else modifier((ar) => P.modifierVariante(ar, vid, d), 'Variante modifiée');
    };
  });
}

// --- Fiche article ----------------------------------------------------
export function ficheArticle(articleId, ligneId) {
  const e = S.get();
  const a = e.articles.find((x) => x.id === articleId);
  if (!a) return;
  const l = e.liste.find((x) => x.id === ligneId);
  const photos = e.photos.filter((p) => p.articleId === a.id);
  ouvrirModale(a.nom, `
    ${a.exclusif ? `<div class="alerte ambre">Vendu seulement chez <b>${esc(nomBanniere(a.exclusif))}</b> : les autres bannières sont ignorées pour ce produit.</div>` : ''}
    <button class="btn ${a.codes?.length ? 'sec' : ''}" id="fScan" style="width:100%;margin-bottom:10px">▥ Scanner le code-barres</button>
    <p class="doux" style="margin:-4px 0 10px">Remplit la fiche : nom, marque, format, catégorie, photo et prix.</p>
    ${(() => { const c = P.completude(a, e); return c.manquants.length || c.alertes.length
      ? `<div class="alerte ambre" style="margin-bottom:10px">À compléter (${c.ok}/${c.total}) : ${c.manquants.map((m) => `${m.icone} ${esc(m.texte)}`).join(' · ')}${c.alertes.map((t) => `<br>⚠️ ${esc(t)}`).join('')}</div>` : ''; })()}
    ${htmlDernierAchat(l?.recu?.absent ? null : (l?.recu || a.dernierAchat), a.id)}
    ${l?.recu?.absent ? `<div class="alerte" style="margin-bottom:10px">🧾 Ce produit n'est pas sur la facture du ${esc(l.recu.date || '')}${l.recu.banniere ? ` (${esc(nomBanniere(l.recu.banniere))})` : ''}.</div>` : ''}
    ${htmlAchats(a.id)}
    <h3>Prix par bannière ${a.format ? `<span class="doux">· ton format : ${esc(formatLisible(a.format))}</span>` : ''}</h3>
    ${tableauOffres(a)}
    <div class="carte" style="margin-top:8px;background:var(--gris-fond)">
      <div class="rang"><b class="grandir">Vrais prix (épiceries.ca)</b>${a.liens?.length ? '<button class="btn sec" id="ecMaj" style="padding:5px 10px">↻</button>' : ''}</div>
      ${a.liens?.length ? `<ul class="liste-arret">${a.liens.map((li) => `<li><span>${esc(li.nom)}${li.size ? ` <span class="doux">${esc(formatLisible(li.size))}</span>` : ''}</span><a href="#" data-delien="${esc(li.id)}" aria-label="Retirer">✕</a></li>`).join('')}</ul>
        <div class="doux">Mis à jour : ${a.majPrix ? new Date(a.majPrix).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'jamais'} · Maxi, IGA, Super C, Metro, Provigo, Walmart. Costco et Jean Coutu : prix vus ou reçus.</div>`
        : '<p class="doux" style="margin:4px 0">Pas encore lié : les prix affichés sont fictifs (démo) ou saisis.</p>'}
      <button class="btn" id="ecLiaison" style="margin-top:8px">${a.liens?.length ? '+ Lier un autre produit' : '🔎 Trouver les vrais prix'}</button>
    </div>
    <details id="fHisto" style="margin-top:8px"><summary class="btn sec" style="display:inline-block">📈 Historique des prix</summary><div id="histo" style="margin-top:8px"></div></details>
    <details id="fAjPrix" style="margin-top:8px"><summary class="btn sec" style="display:inline-block">+ Ajouter un prix vu</summary>
      <div class="carte" style="margin-top:8px">
        <button class="btn" id="pPhoto" style="width:100%;margin-bottom:8px">📷 Photo de l'étiquette — je remplis les champs</button>
        <div id="pLecture" class="doux"></div>
        <div class="rang"><div class="champ grandir"><label>Magasin</label><select id="pBan">${e.magasins.filter((m) => m.actif !== false).map((m) => `<option value="${m.banniere}" data-mag="${m.id}">${esc(m.nom)}</option>`).join('')}</select></div>
          <div class="champ grandir"><label>Type</label><select id="pType"><option value="regulier">Prix régulier</option><option value="circulaire">Circulaire / rabais</option></select></div></div>
        <div class="rang"><div class="champ grandir"><label>Prix affiché</label><input id="pOffre" placeholder="4,99 $ · 2/5 $ · 1,99 $/lb"></div>
          <div class="champ grandir"><label>Format</label><input id="pFormat" value="${esc(a.format || '')}" placeholder="454 g"></div></div>
        <div class="champ"><label>Fin du rabais (facultatif)</label><input id="pFin" type="date"></div>
        <button class="btn" id="pAjout">Ajouter ce prix</button></div></details>
    ${htmlVariantes(a)}
    <h3 style="margin-top:14px">Fiche</h3>
    ${a.bio || a.allergenes?.length ? `<p class="doux" style="margin:0 0 8px">${[a.bio && '🌱 Bio', a.allergenes?.length && `⚠️ Allergènes : ${a.allergenes.join(', ')}`].filter(Boolean).map(esc).join(' · ')} <span style="font-size:11px">(Open Food Facts)</span></p>` : ''}
    <div class="champ"><label>Nom</label><input id="fNom" value="${esc(a.nom)}"></div>
    <div class="champ"><label>Rayon ${a.rayonManuel ? '<span class="pastille">choisi par toi</span>' : '<span class="pastille">auto</span>'}</label>
      <div class="rang"><input type="hidden" id="fRayon" value="${esc(a.rayonId)}"><button type="button" class="btn sec grandir" id="fRayonBtn" style="text-align:left">${esc(texteBoutonRayon(a.rayonId))}</button><button class="icone" id="fGererCat" title="Gérer les rayons" aria-label="Gérer les rayons">⚙️</button></div>
      <div id="fRayonPanneau" hidden></div></div>
    <div class="rang">
      <div class="champ grandir"><label>Comparer au</label><select id="fUnite">
        <option value="kg" ${a.uniteRef === 'kg' ? 'selected' : ''}>$/kg</option>
        <option value="l" ${a.uniteRef === 'l' ? 'selected' : ''}>$/L</option>
        <option value="unite" ${a.uniteRef === 'unite' ? 'selected' : ''}>$/unité</option></select></div>
    </div>
    <div class="rang">
      <div class="champ grandir"><label>Format habituel</label><input id="fFormat" value="${esc(a.format || '')}" placeholder="454 g, 4 L, 12 x 355 mL"></div>
      <div class="champ"><label>Local 🍁</label><select id="fLocal"><option value="1" ${a.local ? 'selected' : ''}>Oui</option><option value="0" ${!a.local ? 'selected' : ''}>Non</option></select></div>
    </div>
    <div class="champ"><label>Vendu seulement chez</label><select id="fExclusif"><option value="">— Toutes les bannières —</option>
      ${Object.entries(BANNIERES).filter(([, b]) => !b.enLigneSeulement).map(([k, b]) => `<option value="${k}" ${a.exclusif === k ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select></div>
    ${l ? `
    <div class="champ"><label>Note</label><input id="fNote" value="${esc(l.note || '')}" placeholder="ex. sans lactose, gros format"></div>` : ''}
    ${l ? `<div class="doux">Ajouté à la liste par <b>${esc(l.ajoutePar || '?')}</b>${l.cree ? ` le ${esc(new Date(l.cree).toLocaleDateString('fr-CA'))}` : ''}</div>` : ''}
    ${a.codes?.length
      ? `<div class="doux">Codes-barres : ${a.codes.map(esc).join(', ')}${a.codeSource === 'en ligne' ? ' <span class="pastille ambre">trouvé en ligne — vérifie en scannant le produit</span>' : ''}</div>`
      : `<div class="alerte" style="margin-top:8px">▥ <b>Pas de code-barres pour ce produit.</b> ${a.codesProposes?.length ? 'Codes possibles trouvés en ligne (vérifie la marque et le format) :' : a.codeCherche ? 'Rien de sûr trouvé en ligne.' : ''} Tu peux aussi le scanner (bouton ▥ en haut).
          ${(a.codesProposes || []).map((h) => `<button class="btn sec" data-code="${esc(h.code)}" style="width:100%;margin-top:6px;text-align:left">+ ${esc(h.code)} — ${esc([h.marque, h.nom, h.format].filter(Boolean).join(' · '))}</button>`).join('')}</div>`}
    <h3 style="margin-top:14px">Photos</h3>
    <div class="vignettes" id="fPhotos">${photos.length ? '' : '<span class="doux">Aucune photo.</span>'}</div>
    <div class="rang envelopper" style="margin-top:12px">
      <button class="btn" id="fSauver">Enregistrer</button>
      <button class="btn sec" id="fPhoto">📷 Photo</button>
      <button class="btn sec" id="fScan2">▥ Code-barres</button>
      ${l ? '<button class="btn danger" id="fRetirer">Retirer de la liste</button>' : '<button class="btn sec" id="fAjouter">+ À la liste</button>'}
      <button class="btn danger" id="fSupCat">Supprimer du catalogue</button>
    </div>`, (c) => {
    photos.forEach((p) => afficherPhoto(p, $('#fPhotos', c)));
    // Preuve d'un écart de caisse : la photo de l'étiquette, en grand
    $$('[data-preuve-photo]', c).forEach((el) => afficherPhoto({ id: el.dataset.preuvePhoto, type: 'prix', note: 'Étiquette en magasin' }, el, true));
    $$('[data-code]', c).forEach((b) => b.onclick = () => {
      S.maj((st) => { const ar = st.articles.find((i) => i.id === a.id); ar.codes = [...new Set([...(ar.codes || []), ...gtinVariantes(b.dataset.code)])]; ar.codeSource = 'choisi'; delete ar.codesProposes; });
      toast(`Code ${b.dataset.code} ajouté`); ficheArticle(articleId, ligneId);
    });
    const rouvrir = () => ficheArticle(articleId, ligneId);
    brancherVariantes(c, a, rouvrir);
    $('#ecLiaison', c).onclick = () => ouvrirLiaison(a.id, rouvrir);
    // Preuve des rabais de circulaire : le lien mène à la page exacte où le rabais a été lu (si elle est encore gardée)
    const liensCirc = $$('[data-offrecirc]', c);
    if (liensCirc.length) Sync.pagesDesOffres(liensCirc.map((x) => x.dataset.offrecirc)).then((urls) => urls && liensCirc.forEach((x) => {
      if (urls[x.dataset.offrecirc]) x.href = urls[x.dataset.offrecirc];
      else x.textContent = '📰 Circulaire (page plus gardée)';
    }));
    $('#ecMaj', c)?.addEventListener('click', async () => { toast('Mise à jour…'); await actualiserArticle(a.id, { force: true }); rouvrir(); });
    $$('[data-delien]', c).forEach((x) => x.onclick = (ev) => {
      ev.preventDefault();
      S.maj((st) => {
        const ar = st.articles.find((i) => i.id === a.id);
        ar.liens = ar.liens.filter((li) => li.id !== x.dataset.delien);
        st.prix = st.prix.filter((p) => !(p.articleId === a.id && p.lienId === x.dataset.delien));
      });
      rouvrir();
    });
    $('#fHisto', c).ontoggle = () => { if ($('#fHisto', c).open && !$('#histo', c).dataset.ok) { $('#histo', c).dataset.ok = 1; afficherHistorique(a, $('#histo', c)); } };
    // Rayon : appliqué tout de suite ; taper un nom qui n'existe pas propose de créer le rayon
    brancherRayon($('#fRayonBtn', c), $('#fRayonPanneau', c), () => $('#fRayon', c).value, (id) => {
      $('#fRayon', c).value = id;
      placerDansRayon(a.id, id);
    });
    $('#fGererCat', c).onclick = () => gererCategories(() => ficheArticle(articleId, ligneId));
    $$('[data-ajprix]', c).forEach((b) => b.onclick = () => {
      $('#fAjPrix', c).open = true; $('#pBan', c).value = b.dataset.ajprix; $('#pOffre', c).focus();
    });
    let photoPrixId = null;
    $('#pPhoto', c).onclick = () => lirePrixPhoto((res) => {
      photoPrixId = res.photoId;
      if (res.offre) $('#pOffre', c).value = res.offre;
      if (res.format) $('#pFormat', c).value = res.format;
      if (res.rabais) $('#pType', c).value = 'circulaire';
      $('#pLecture', c).innerHTML = res.offre ? `✓ Lu : <b>${esc(res.offre)}</b>${res.format ? ` · ${esc(res.format)}` : ''}. Vérifie, puis « Ajouter ce prix ».`
        : !navigator.onLine ? '📵 Pas de réseau : touche « Ajouter ce prix » sans rien écrire, la photo sera lue au retour du réseau et le prix se remplira tout seul.'
        : 'Je n\'ai pas pu lire le prix sur la photo : entre-le à la main (la photo est gardée).';
    }, $('#pLecture', c));
    $('#pAjout', c).onclick = () => {
      const offre = $('#pOffre', c).value.trim();
      const plusTard = !offre && photoPrixId; // photo sans lecture (hors ligne) → lue plus tard
      if (!plusTard && !analyserOffre(offre)) { toast('Prix illisible : ex. 4,99 $, 2/5 $ ou 1,99 $/lb'); return; }
      const opt = $('#pBan', c).selectedOptions[0];
      const pid = S.uid('p');
      S.maj((x) => {
        x.prix.push({ id: pid, articleId: a.id, banniere: $('#pBan', c).value, magasinId: opt?.dataset.mag, offre, format: $('#pFormat', c).value.trim() || a.format,
          type: $('#pType', c).value, fin: $('#pFin', c).value || null, source: photoPrixId ? 'photo' : 'manuel', photoId: photoPrixId,
          enAttente: !!plusTard, observeLe: new Date().toISOString().slice(0, 10) });
        if (photoPrixId) x.photos.push({ id: photoPrixId, type: 'prix', articleId: a.id, date: new Date().toISOString(), prise_par: x.utilisateur, note: `${offre || 'à lire'} · ${opt?.textContent || ''}` });
      });
      if (plusTard) ajouterTache({ type: 'prix', prixId: pid, photoId: photoPrixId });
      toast(plusTard ? 'Photo gardée : le prix sera lu au retour du réseau' : 'Prix ajouté'); ficheArticle(articleId, ligneId);
    };
    $('#fSauver', c).onclick = () => {
      S.maj((x) => {
        const ar = x.articles.find((i) => i.id === a.id);
        ar.nom = $('#fNom', c).value.trim() || ar.nom; ar.uniteRef = $('#fUnite', c).value;
        // Rayon changé à la main → verrouillé : l'app ne le modifiera plus jamais automatiquement
        const rv = $('#fRayon', c).value;
        if (rv !== '+' && rv !== ar.rayonId) { ar.rayonId = rv; ar.rayonManuel = true; }
        ar.format = $('#fFormat', c).value.trim(); ar.local = $('#fLocal', c).value === '1';
        ar.exclusif = $('#fExclusif', c).value || null;
        const li = x.liste.find((i) => i.id === ligneId);
        if (li) li.note = $('#fNote', c).value.trim();
      });
      fermerModale(); toast('Enregistré');
    };
    $('#fPhoto', c).onclick = () => photoProduit(a.id);
    // Mes achats : toucher un achat ouvre son reçu
    $$('[data-achat-recu]', c).forEach((li) => { li.onclick = () => ouvrirDetailRecu(li.dataset.achatRecu); });
    // Scan pour CET article : remplit nom, marque, format, catégorie, photo, code et vrais prix
    $('#fScan', c).onclick = () => ouvrirScan((trouve) => {
      if (trouve && trouve.id !== a.id && ligneId) {
        // Ce code-barres appartient déjà à un autre produit du catalogue : on le met à sa place dans la liste
        remplacerArticle(a.id, ligneId, trouve);
        setTimeout(() => ficheArticle(trouve.id, ligneId), 300);
      } else setTimeout(() => ficheArticle(articleId, ligneId), 300);
    }, { cibleId: a.id });
    $('#fScan2', c).onclick = () => $('#fScan', c).click();
    $('#fRetirer', c)?.addEventListener('click', () => { S.maj((x) => { x.liste = x.liste.filter((i) => i.id !== ligneId); }); fermerModale(); });
    $('#fAjouter', c)?.addEventListener('click', () => { ajouterALaListe(a.id); fermerModale(); toast(`${a.nom} ajouté`); });
    $('#fSupCat', c).onclick = () => {
      if (!confirm(`Supprimer « ${a.nom} » du catalogue ?\nIl sera aussi retiré de ta liste. Son historique de prix est gardé.`)) return;
      S.maj((x) => {
        x.articles = x.articles.filter((i) => i.id !== a.id);
        x.liste = x.liste.filter((i) => i.articleId !== a.id);
        x.recettes.forEach((rc) => rc.ingredients.forEach((ing) => { if (ing.articleId === a.id) ing.articleId = null; }));
      });
      fermerModale(); toast(`${a.nom} supprimé du catalogue`);
    };
  }, { image: a.imageUrl });
}

// ---------------------------------------------------------------------
// Onglet MAGASINS
// ---------------------------------------------------------------------
const lienMaps = (m) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.adresse ? `${m.nom}, ${m.adresse}` : m.nom)}`;

function vueMagasins(v) {
  const e = S.get();
  let html = `<h2 style="margin-top:0">Mes magasins</h2>
    <p class="doux" style="margin:0 0 8px">Interrupteur = magasin <b>considéré</b> ou <b>ignoré</b> dans les comparaisons, les listes et les paniers (sans le supprimer). Touche un nom pour l'adresse, l'itinéraire ou le retirer. 🏷️ = relevé de prix dans ce magasin.</p>
    <div class="carte"><h2>Secteurs</h2>
    <p class="doux" style="margin:0 0 6px">Une ville couvre toutes ses succursales, peu importe leur code postal.</p>
    <div>${e.codesPostaux.map((c) => `<span class="pastille" style="font-size:13px;padding:4px 10px">${estFsa(c.code) ? `${esc(c.code)} · ${esc(c.libelle)}` : esc(c.libelle || c.code)} <a href="#" data-supcp="${esc(c.code)}" aria-label="Retirer">✕</a></span>`).join(' ')}</div>
    <div class="rang" style="margin-top:8px"><input id="cpCode" class="grandir" placeholder="Ville ou code postal (ex. Beloeil, J3X)"><button class="btn sec" id="cpAjout">Ajouter</button></div></div>`;

  // Chaque magasin dans UN seul secteur : d'abord sa ville (plus large), sinon son code postal ; les autres à la fin.
  const places = new Set();
  const groupes = e.codesPostaux.map((c) => ({ c, mags: [] }));
  for (const m of e.magasins) {
    const g = groupes.find((x) => !estFsa(x.c.code) && enSecteur(m, x.c)) || groupes.find((x) => enSecteur(m, x.c));
    if (g) { g.mags.push(m); places.add(m.id); }
  }
  const autres = e.magasins.filter((m) => !places.has(m.id));
  if (autres.length) groupes.push({ c: { code: '', libelle: 'Autres magasins' }, mags: autres });
  for (const { c, mags } of groupes) {
    html += `<h3 class="titre-cp">${c.code && estFsa(c.code) ? `${esc(c.code)} — ${esc(c.libelle)}` : esc(c.libelle || c.code)}</h3>`;
    if (!mags.length) html += `<p class="doux">Aucun magasin dans ce secteur.</p>`;
    for (const m of mags) {
      const rp = e.rabaisPerso.find((r) => r.magasinId === m.id && r.actif);
      const actif = m.actif !== false;
      html += `<div class="mag-ligne ${actif ? '' : 'inactif'}">
        <label class="interrupteur" title="${actif ? 'Considéré dans les comparaisons' : 'Ignoré (pas supprimé)'}"><input type="checkbox" data-actif="${m.id}" ${actif ? 'checked' : ''}><span></span></label>
        <button class="grandir une-ligne nom-mag" data-magfiche="${m.id}">${logoMagasin(m)}${rp ? ' <span class="pastille vert">%</span>' : ''} <span class="doux">›</span></button>
        <button class="btn-releve" data-releve="${m.id}" aria-label="Relevé de prix">🏷️</button></div>`;
    }
  }
  html += `<div class="carte"><h2>Trouver une succursale</h2>
    <p class="doux">Choisis la bannière et la ville (ou le code postal) : je cherche les succursales et leurs adresses (OpenStreetMap).</p>
    <div class="rang envelopper">
      <select id="mBan" class="grandir">${Object.entries(BANNIERES).filter(([, b]) => !b.enLigneSeulement).map(([k, b]) => `<option value="${k}">${b.nom}</option>`).join('')}</select>
      <input id="mVille" class="grandir" placeholder="Ville ou code postal (ex. Chambly, J3L)"></div>
    <button class="btn" id="mChercher" style="margin-top:8px">🔎 Chercher</button>
    <div id="mResultats" style="margin-top:8px"></div></div>`;
  v.innerHTML = html;

  $('#cpAjout').onclick = () => {
    const s = secteurDe($('#cpCode').value); if (!s) return;
    if (e.codesPostaux.some((c) => c.code === s.code || (!estFsa(c.code) && memeVille(c.code, s.code)))) { toast('Déjà là'); return; }
    S.maj((x) => x.codesPostaux.push(s));
  };
  $$('[data-supcp]').forEach((a) => a.onclick = (ev) => {
    ev.preventDefault();
    const code = a.dataset.supcp;
    const c = e.codesPostaux.find((x) => x.code === code);
    if (c && e.magasins.some((m) => enSecteur(m, c))) { toast('Retire d\'abord les magasins de ce secteur.'); return; }
    S.maj((x) => { x.codesPostaux = x.codesPostaux.filter((c) => c.code !== code); });
  });
  // Décocher = ne plus considérer ce magasin (comparaisons, listes, paniers) sans le supprimer
  $$('[data-releve]').forEach((b) => b.onclick = () => { ouvrirReleve(b.dataset.releve); allerOnglet('plus'); });
  $$('[data-actif]').forEach((i) => i.onchange = () => S.maj((x) => { x.magasins.find((m) => m.id === i.dataset.actif).actif = i.checked; }));
  $$('[data-magfiche]').forEach((b) => b.onclick = () => ficheMagasin(b.dataset.magfiche));
  $('#mChercher').onclick = async () => {
    const ban = $('#mBan').value, ville = $('#mVille').value.trim();
    if (!ville) { toast('Entre une ville ou un code postal'); return; }
    const zone = $('#mResultats');
    zone.innerHTML = '<p class="doux">Recherche…</p>';
    let res = [];
    try { res = await chercherSuccursales(BANNIERES[ban].nom, ville); } catch { /* réseau */ }
    // Ville demandée (pas un code postal) : on garde celles de cette ville si possible
    const estCode = /^[a-z]\d[a-z]/i.test(ville);
    const memeVille = estCode ? res.filter((r) => r.fsa.toUpperCase() === ville.slice(0, 3).toUpperCase())
      : res.filter((r) => sansAccents(r.ville) === sansAccents(ville));
    const note = res.length && !memeVille.length ? `<p class="doux">Aucune succursale trouvée exactement à ${esc(ville)} ; voici les résultats proches :</p>` : '';
    if (memeVille.length) res = memeVille;
    if (!res.length) { zone.innerHTML = '<p class="doux">Rien trouvé. Essaie une ville voisine ou le nom complet de la ville.</p>'; return; }
    zone.innerHTML = note + res.map((r, i) => `<div class="item"><div class="grandir"><div class="nom">${esc(r.nom)}</div><div class="info">${esc(r.adresse)}</div></div>
      <button class="btn sec" data-ajmag="${i}">Ajouter</button></div>`).join('');
    $$('[data-ajmag]', zone).forEach((b) => b.onclick = () => {
      const r = res[Number(b.dataset.ajmag)];
      if (S.get().magasins.some((m) => m.adresse === r.adresse)) { toast('Déjà dans tes magasins'); return; }
      S.maj((x) => {
        if (!x.codesPostaux.some((c) => c.code === r.fsa)) x.codesPostaux.push({ code: r.fsa, libelle: r.ville || r.fsa });
        x.magasins.push({ id: S.uid('m'), banniere: ban, nom: `${BANNIERES[ban].nom} ${r.ville || ''}`.trim(), codePostal: r.fsa, adresse: r.adresse, lat: r.lat, lng: r.lng });
      });
      toast('Magasin ajouté');
    });
  };
}

/** Détails d'un magasin : adresse, itinéraire, rabais perso, relevé de prix, retrait. */
function ficheMagasin(id) {
  const e = S.get();
  const m = e.magasins.find((x) => x.id === id);
  if (!m) return;
  const rp = e.rabaisPerso.filter((r) => r.magasinId === m.id);
  const nbPrix = e.prix.filter((p) => p.magasinId === m.id).length;
  ouvrirModale(m.nom, `
    <div style="margin-bottom:10px">${logoMagasin(m)}</div>
    <div class="champ"><label>Adresse</label><input id="mfAdr" value="${esc(m.adresse || '')}" placeholder="Adresse"></div>
    <a class="btn" href="${lienMaps(m)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-bottom:8px">🗺️ Itinéraire (Google Maps)</a>
    <button class="btn" id="mfReleve" style="width:100%;margin-bottom:8px">🏷️ Relevé de prix dans ce magasin</button>
    ${rp.length ? `<div class="doux" style="margin-bottom:8px">Rabais perso : ${rp.map((r) => esc(r.description)).join(', ')}</div>` : ''}
    <div class="doux" style="margin-bottom:12px">${nbPrix} prix relevé(s) dans ce magasin.</div>
    <button class="btn danger" id="mfSup" style="width:100%">🗑 Retirer ce magasin</button>
    <p class="doux">Pour seulement l'ignorer dans les comparaisons, utilise plutôt l'interrupteur dans la liste des magasins.</p>`, (c) => {
    $('#mfAdr', c).onchange = () => S.maj((x) => { x.magasins.find((y) => y.id === m.id).adresse = $('#mfAdr', c).value.trim(); });
    $('#mfReleve', c).onclick = () => { fermerModale(); ouvrirReleve(m.id); allerOnglet('plus'); };
    $('#mfSup', c).onclick = () => {
      if (!confirm(`Retirer ${m.nom} de tes magasins ?`)) return;
      S.maj((x) => { x.magasins = x.magasins.filter((y) => y.id !== m.id); x.rabaisPerso = x.rabaisPerso.filter((r) => r.magasinId !== m.id); });
      fermerModale(); toast(`${m.nom} retiré`);
    };
  });
}

/** Succursales d'une bannière près d'une ville / d'un code postal (OpenStreetMap Nominatim, 1 requête). */
async function chercherSuccursales(nomBanniere, ville) {
  const p = new URLSearchParams({ q: `${nomBanniere}, ${ville}, Québec`, format: 'jsonv2', addressdetails: 1, limit: 8, countrycodes: 'ca' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
  const j = await r.json();
  const cle = sansAccents(nomBanniere).replace(/\s/g, '');
  return j.filter((x) => sansAccents(x.name || x.display_name).replace(/\s/g, '').includes(cle)).map((x) => {
    const a = x.address || {};
    const ville2 = a.city || a.town || a.village || a.municipality || '';
    const cp = (a.postcode || '').toUpperCase();
    const adresse = [[a.house_number, a.road].filter(Boolean).join(', '), ville2, cp ? `QC ${cp}` : 'QC'].filter(Boolean).join(', ');
    return { nom: x.name || nomBanniere, adresse, ville: ville2, fsa: cp.slice(0, 3) || ville2 || '?', lat: Number(x.lat), lng: Number(x.lon) };
  });
}
