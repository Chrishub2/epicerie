// =====================================================================
// Épicerie — application principale (mode démo)
// =====================================================================
import { estFsa, secteurDe, memeVille, enSecteur } from './secteurs.js';
import { appliquerRegistre } from './bannieres-registre.js';
import * as S from './store.js';
import { $, $$, esc, argent, texteOffre, ouvrirModale, fermerModale, offresArticle, meilleureOffre, libelleUnitaire,
  libelleFin, joursRestants, nomBanniere, puce, toast, nomOffre, villeMagasin, logo, logoVille, logoMagasin, brancherSelecteurRayon, banniereActive, magasinsActifs, villesColonne } from './ui.js';
import { BANNIERES, BANNIERES_MAGASIN } from './demo-data.js';
import { analyserOffre, analyserFormat, formatLisible, gtinVariantes, normaliser, prixComparable } from './normalise.js';
import { ouvrirScan, photoProduit } from './scan.js';
import { vueRecettes } from './recettes.js';
import { analyserIngredient } from './ingredients.js';
import { memeNom, pertinenceNoms } from './noms.js';
import { calendrierHtml } from './calendrier.js';
import { REMPLACEMENTS, REMPLACEMENT_DEFAUT, remplacementDe, definirRemplacement, meilleursChoix, DICO_ATTRIBUTS, attributDe, caracteristiques, definirCaracteristique, retirerCaracteristique } from './choix.js';
import { vuePlus, afficherPhoto, allerASection, nouveauRecu, ouvrirReleve, ouvrirDetailRecu } from './plus.js';
import { vueComparaison, tableauOffres, nomCle, coutPour, cleOffre, optimiser, besoinDe } from './comparer.js';
import { resumePlan, aRacheter, nombreEmballages } from './plan.js';
import { lignesAchat, derniereVisite, bilanVisite, economiesMois } from './bilan.js';
import { ouvrirLiaison, actualiserArticle, actualiserTout, afficherHistorique } from './epiceries.js';
import * as RB from './recherche-bannieres.js';
import { lirePrixPhoto, brancherIA } from './ocr.js';
import * as Sync from './sync.js';
import { surveillerMisesAJour } from './maj.js';

surveillerMisesAJour(); // « Mise à jour disponible — Oui / Non »
import { ouvrirListeManuscrite, photoEnMagasin, identifierArticle, remplacerArticle } from './manuscrit.js';
import { ajouterTache, traiterFile, nbEnAttente } from './attente.js';
import { htmlVerdictListe, htmlDernierAchat, htmlAchats } from './recu.js';
import * as P from './produits.js';
import { jourQuebec } from './couverture-circulaires.js';
import { aRelier, appliquerFamilles, rattacher } from './rattacher.js';
import { aRanger, appliquerRangement } from './rayons-defaut.js';
import { appareil, etapesPosition, messagePosition } from './position-aide.js';
import { vocabulaire, restaurerAccents } from './accents.js';
import { construireArbre, nouvelleFicheGenerique, enfantsGenerique } from './arbre-recherche.js';
import { chargerVisuels, sourcesRattachement, familleDe, photoDe, photoListe, PHOTO_VIDE, definirPhotosPro, aPhotoPro, etatPhotoPro, marquerPhotoEnvoyee, photoMaisonPermise } from './visuels.js';

let onglet = 'liste';
let filtreMagasin = 'tous'; // filtre de la liste après « Utiliser cette répartition »

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
await S.demarrer();   // v133 : données dans IndexedDB (déménagées de localStorage au premier démarrage)

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
// Calendrier de l'en-tête : 2 semaines, aujourd'hui en jaune ; se met à jour au fil des heures (le jour, puis la semaine, avancent seuls)
const rendCalendrier = () => { const c = $('#calEntete'); if (c) c.innerHTML = calendrierHtml(new Date(), { court: innerWidth < 560 }); };
rendCalendrier();
setInterval(rendCalendrier, 15 * 60 * 1000);
addEventListener('resize', rendCalendrier);
chargerVisuels().then(() => { rendre(); relierFamilles(); }); // photos par niveau (catégorie → sorte) pour les fiches sans vraie photo
// Nouvelles fiches (app, autre téléphone, reçus, MCP) : reliées au référentiel dès qu'elles arrivent, si le nom ne laisse aucun doute
// (seulement après la première récupération de la base : on n'écrit jamais par-dessus une fiche pas encore à jour)
let reliageprevu = false, syncFaite = false;
function relierFamilles() {
  const src = sourcesRattachement();
  if (!src || !syncFaite) return;
  const liens = aRelier(S.get().articles, src.generiques, src.corr, src.alternatifs);
  if (liens.length) S.maj((e) => appliquerFamilles(e.articles, liens));
  // Fiches encore dans Divers : rangées dans le rayon de leur famille (table validée par Chris) ;
  // une famille trouvée automatiquement est revérifiée par le nom, jamais une fiche classée à la main.
  const e = S.get();
  const verifier = (a, g) => rattacher(a.nom, src.generiques, src.alternatifs)?.g === g;
  const aMettre = aRanger(e.articles, e.rayons, src.rayonsDefaut, (a) => familleDe(a), verifier);
  if (aMettre.length) S.maj((x) => appliquerRangement(x, aMettre, S.uid));
}
S.abonner(() => { if (!reliageprevu) { reliageprevu = true; setTimeout(() => { reliageprevu = false; relierFamilles(); }, 0); } });
setTimeout(async () => {
  await Sync.initialiser().catch(() => {});   // connexion + partage (si déjà connecté)
  syncFaite = true; relierFamilles();         // nouvelles fiches → famille du référentiel
  Sync.photosPro().then((l) => { if (l) { definirPhotosPro(l); rendre(); } }); // photos studio approuvées
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
// Les rabais sûrs s'enregistrent seuls ; les incertains ne sont plus montrés au téléphone (v155), seulement dans la console.
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
    || e.articles.find((a) => memeNom(a, nom)) // pluriel, nom anglais ou nom alternatif (« patates » → Pomme de terre)
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
  lancerVerifications(articleId);   // v118 : prix revérifiés chez les bannières (au plus une fois par semaine de circulaires)
  return fusion;
}

// --- v118 : vérification des prix à l'ajout (maquette recherche-niveaux-v2) ---
/** Fiches à vérifier pour une fiche ajoutée : elle-même, ou toutes ses fiches dessous si c'est un niveau 1 ou 2. */
function fichesAVerifier(a) {
  const e = S.get();
  return a?.estGenerique ? enfantsGenerique(a, e.articles, familleDe) : a ? [a] : [];
}

/** v140 — Mode essai (Plus → Sauvegarde, ce téléphone) : les prix sont revérifiés à CHAQUE ajout, même déjà vérifiés depuis jeudi. */
const CLE_ESSAI = 'essai.verifierChaqueAjout';
function modeEssai() { try { return localStorage.getItem(CLE_ESSAI) === '1'; } catch { return false; } }

/** Dépose une demande par fiche pas encore vérifiée depuis jeudi (et sans demande en cours). Rien hors connexion au foyer. */
function lancerVerifications(articleId) {
  if (!Sync.estPret()) return;
  const e = S.get();
  const jour = jourQuebec();
  const essai = modeEssai();
  const a = e.articles.find((x) => x.id === articleId);
  const aFaire = (x) => (essai || !RB.verifieCetteSemaine(x, jour)) && !RB.verificationOuverte(e.recherches, x.id);
  const nouvelles = fichesAVerifier(a).filter(aFaire)
    .map((x) => ({ ...RB.nouvelleRecherche(RB.requeteFiche(x), S.uid('rch')), articleId: x.id, but: 'verif' }))
    .filter((r) => r.q.length >= 2);
  // v140 : une fiche famille (« Tourtière », niveau 1 ou 2) cherche aussi SON nom : le moins cher de chaque bannière,
  // toutes sortes confondues (avant, seules ses fiches dessous étaient vérifiées : une seule tourtière, une seule bannière)
  if (a?.estGenerique && aFaire(a)) {
    const q = restaurerAccents(a.nom, vocabAccents());
    if (q.length >= 2) nouvelles.push({ ...RB.nouvelleRecherche(q, S.uid('rch')), articleId: a.id, but: 'generique' });
  }
  if (!nouvelles.length) return;
  S.maj((x) => {
    const vieilles = new Set(RB.aRetirer(x.recherches));
    x.recherches = [...(x.recherches || []).filter((r) => !vieilles.has(r.id)), ...nouvelles];
  });
}

/** Les bannières ont répondu : relevés datés ajoutés à la fiche (même produit seulement), fiche marquée vérifiée. */
let applicationPrevue = false;
function appliquerVerifications() {
  const e = S.get();
  const prets = RB.aAppliquer(e.recherches);
  if (!prets.length) return;
  const changements = [];
  let nPrix = 0;
  S.maj((x) => {
    const ids = new Set(x.prix.map((p) => p.id));
    for (const r0 of prets) {
      const r = x.recherches.find((y) => y.id === r0.id);
      const fiche = x.articles.find((a) => a.id === r.articleId);
      r.appliqueLe = new Date().toISOString();
      if (!fiche) continue;
      const codes = P.codesDe(fiche).flatMap(gtinVariantes);
      const res = RB.prixVerification(r, fiche, x.prix, codes);
      for (const p of res.prix) if (!ids.has(p.id)) { x.prix.push(p); ids.add(p.id); nPrix++; }
      if (r.etat === 'fait') fiche.prixVerifieLe = jourQuebec();
      res.changements.forEach((c) => changements.push({ ...c, nom: fiche.nom }));
    }
  });
  if (changements.length) toast(`Prix régulier changé : ${changements.slice(0, 3).map((c) => `${c.nom} chez ${nomBanniere(c.banniere)} ${argent(c.avant)} → ${argent(c.apres)}`).join(' · ')} (noté dans l'historique)`);
  else if (nPrix) toast(`Prix vérifiés chez les bannières · ${nPrix} relevé${nPrix > 1 ? 's' : ''} ajouté${nPrix > 1 ? 's' : ''}`);
}
S.abonner(() => { if (!applicationPrevue) { applicationPrevue = true; setTimeout(() => { applicationPrevue = false; appliquerVerifications(); deciderNomsInconnus(); appliquerGeneriques(); reparerFichesRecette(); }, 0); } });

/** v140 — Fiche famille : les bannières ont répondu pour son nom → le moins cher de chacune devient un prix de la fiche. */
function appliquerGeneriques() {
  const e = S.get();
  for (const r of RB.generiquesPrets(e.recherches)) {
    const fiche = e.articles.find((a) => a.id === r.articleId);
    const offres = fiche ? RB.moinsCherParBanniere(r, fiche.nom) : [];
    if (offres.length) garderNomGenerique(r.id, offres, { famille: true });
    S.maj((x) => { const y = x.recherches.find((z) => z.id === r.id); if (y) { y.appliqueLe = new Date().toISOString(); if (!offres.length) { y.choix = 'aucun'; y.choixLe = y.appliqueLe; } } });
  }
}

// --- v120 : nom inconnu (« Mon nom tel quel ») — choisir dans la liste ou garder ton nom ---
/** Bannières répondues pour un nom inconnu : rien → sans prix ; nom exact unique → rattaché ; sinon fenêtre (ouverte une fois, puis au toucher). */
function deciderNomsInconnus() {
  const e = S.get();
  for (const r of RB.choixEnAttente(e.recherches)) {
    const fiche = e.articles.find((a) => a.id === r.articleId);
    if (!fiche) { S.maj((x) => { const y = x.recherches.find((z) => z.id === r.id); if (y) { y.choix = 'aucun'; y.choixLe = new Date().toISOString(); } }); continue; }
    if (r.choixAttendu) continue;   // fenêtre déjà proposée : on attend ton choix
    const d = RB.decisionNom(r, fiche.nom);
    if (d.choix === 'aucun') {
      S.maj((x) => { const y = x.recherches.find((z) => z.id === r.id); y.choix = 'aucun'; y.choixLe = new Date().toISOString(); });
      toast(`Rien trouvé chez les bannières pour « ${fiche.nom} » : il reste dans Prépa, sans prix proposé.`);
    } else if (d.choix === 'auto') {
      choisirProduitNom(r.id, d.groupe, true);
    } else if (d.choix === 'generique') {
      garderNomGenerique(r.id, d.offres);
    } else {
      S.maj((x) => { const y = x.recherches.find((z) => z.id === r.id); y.choixAttendu = true; });
      if (!document.hidden && !document.documentElement.classList.contains('modale-ouverte')) ouvrirChoixNom(r.id);
    }
  }
}

/** Le produit choisi complète ta fiche (nom, marque, format, photo, code sûr) et ajoute un prix par bannière qui le vend. */
function choisirProduitNom(rechId, g, auto = false) {
  const e = S.get();
  const r = e.recherches.find((x) => x.id === rechId);
  const fiche = r && e.articles.find((a) => a.id === r.articleId);
  if (!fiche) return;
  const maj = RB.completerFiche(fiche, g);
  // Un code-barres déjà sur une AUTRE fiche n'est pas copié (dans le doute, on ne rattache pas)
  const ailleurs = new Set(e.articles.filter((a) => a.id !== fiche.id).flatMap((a) => P.codesDe(a)));
  maj.codes = maj.codes.filter((c) => !ailleurs.has(c));
  const prix = RB.prixDuGroupe(g, fiche.id, jourQuebec(), (b) => `px-${rechId}-${b}`);
  S.maj((x) => {
    const ar = x.articles.find((a) => a.id === fiche.id);
    Object.assign(ar, maj, { prixVerifieLe: jourQuebec() });
    const ids = new Set(x.prix.map((p) => p.id));
    prix.forEach((p) => { if (!ids.has(p.id)) x.prix.push(p); });
    const y = x.recherches.find((z) => z.id === rechId);
    y.choix = auto ? 'auto' : 'produit'; y.choixLe = new Date().toISOString();
  });
  toast(`${auto ? 'Trouvé tel quel' : 'Choisi'} : ${maj.nom} · prix de ${prix.length} bannière${prix.length > 1 ? 's' : ''}`);
}

/** v138 — Ton nom est générique (« Tourtière ») : la fiche le garde tel quel, sans marque ni format,
 *  et reçoit le moins cher de chaque bannière (chaque prix garde le produit et le format vraiment vendus). */
function garderNomGenerique(rechId, offres, { famille = false } = {}) {
  const e = S.get();
  const r = e.recherches.find((x) => x.id === rechId);
  const fiche = r && e.articles.find((a) => a.id === r.articleId);
  if (!fiche) return;
  const prix = RB.prixGenerique(offres, fiche.id, jourQuebec(), (b) => `px-${rechId}-${b}`);
  S.maj((x) => {
    const ar = x.articles.find((a) => a.id === fiche.id);
    // Une fiche famille garde son unité (celle du référentiel) ; une fiche à ton nom prend celle des produits trouvés
    Object.assign(ar, famille ? { prixVerifieLe: jourQuebec() } : { uniteRef: RB.uniteGenerique(offres), prixVerifieLe: jourQuebec() });
    const ids = new Set(x.prix.map((p) => p.id));
    prix.forEach((p) => { if (!ids.has(p.id)) x.prix.push(p); });
    const y = x.recherches.find((z) => z.id === rechId);
    y.choix = 'generique'; y.choixLe = new Date().toISOString();
  });
  toast(`${fiche.nom} : toutes sortes · le moins cher chez ${prix.length} bannière${prix.length > 1 ? 's' : ''}`);
}

/** Fenêtre « Ton nom ne correspond pas tout à fait » (maquette recherche-niveaux-v2, moment 6). */
function ouvrirChoixNom(rechId) {
  const e = S.get();
  const r = e.recherches.find((x) => x.id === rechId);
  const fiche = r && e.articles.find((a) => a.id === r.articleId);
  if (!fiche) return;
  const groupes = RB.choixPresentes(r, fiche.nom).slice(0, 8);   // v138 : seulement les produits qui parlent de ton nom
  ouvrirModale('Ton nom ne correspond pas tout à fait', `<p class="doux">J'ai trouvé ceci chez les bannières pour « ${esc(fiche.nom)} ». Choisis le bon, ou garde ton nom.</p>
    ${groupes.map((g, i) => `<button class="sugg" data-choix="${i}" style="border:1px solid var(--ligne);border-radius:10px;margin-top:6px">${g.image ? `<img class="vignette petite" src="${esc(g.image)}" alt="">` : '<span class="vignette petite"></span>'}
      <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">${esc(g.nom)}</span>
      <span class="doux une-ligne" style="display:block;font-size:12px">${esc([g.format ? formatLisible(g.format) : '', g.offres.map((o) => nomBanniere(o.banniere)).join(', ')].filter(Boolean).join(' · '))}</span></span>
      <span class="sugg-px">${esc(argent(g.meilleur.prix))}<small>${esc(nomBanniere(g.meilleur.banniere))}</small></span></button>`).join('')}
    <button class="btn sec" id="choixGarder" style="width:100%;margin-top:10px">Garder « ${esc(fiche.nom)} » sans référence</button>
    <p class="doux" style="font-size:12px;margin-top:6px">Sans référence : ton produit reste dans Prépa, sans prix proposé. C'est la limite du système.</p>`, (c) => {
    $$('[data-choix]', c).forEach((b) => b.onclick = () => { fermerModale(); choisirProduitNom(rechId, groupes[Number(b.dataset.choix)]); });
    $('#choixGarder', c).onclick = () => {
      S.maj((x) => { const y = x.recherches.find((z) => z.id === rechId); y.choix = 'garde'; y.choixLe = new Date().toISOString(); });
      fermerModale(); toast(`« ${fiche.nom} » gardé tel quel, sans prix proposé`);
    };
  });
  // Fermer sans choisir : le point ambre reste sur la photo, la fenêtre revient au toucher
}

/** Choix encore à faire pour cette fiche (point ambre sur la photo ; toucher le produit ouvre la fenêtre). */
const choixNomDe = (articleId) => (S.get().recherches || []).find((r) => r.but === 'nom' && r.articleId === articleId && r.choixAttendu && !r.choixLe) || null;

/** Panier qui tourne sur la photo : une vérification ou une recherche de cette fiche (ou de ses fiches dessous) est en cours. */
function panierQuiTourne(a) {
  const e = S.get();
  if (!(e.recherches || []).length) return '';
  if (choixNomDe(a.id)) return '<span class="point-choix" title="Les bannières ont répondu : touche pour choisir"></span>';
  const ids = new Set(a.estGenerique ? [a.id, ...fichesAVerifier(a).map((x) => x.id)] : [a.id]);   // v140 : la fiche famille cherche aussi son nom
  const ouvertes = (e.recherches || []).filter((r) => ids.has(r.articleId) && !r.appliqueLe && r.etat !== 'fait'
    && RB.verificationOuverte(e.recherches, r.articleId));
  if (!ouvertes.length) return '';
  // v121 : le panier TOURNE seulement quand une bannière a commencé à répondre ; en file d'attente, il reste immobile
  const cherche = ouvertes.some((r) => Object.keys(r.bannieres || {}).length > 0);
  // v138 : même panier que l'extension (🛒 sur rond foncé) ; seul l'anneau vert tourne, le panier reste immobile
  const panier = '<span class="pt-rond"><span class="pt-anneau"></span><span class="pt-chariot" aria-hidden="true">🛒</span></span>';
  return cherche ? `<span class="panier-tourne" title="Je cherche chez les bannières">${panier}</span>`
    : `<span class="panier-tourne attente" title="En attente de recherche chez les bannières">${panier}</span>`;
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
  // v122 : sans le rabais perso d'une seule succursale (10 % d'IGA Varennes), comme dans Prépa
  const m = (k && offresArticle(a).find((o) => o.pu != null && !o.perso && cleOffre(o) === k))
    || offresArticle(a).find((o) => o.pu != null && !o.perso) || meilleureOffre(a);
  // Prix tel qu'affiché sur l'étagère (« 3,99 $ », « 2/5,00 $ ») pour comparer d'un coup d'œil
  const etiquette = m ? (texteOffre(m.offre) || (m.prixArticle != null ? argent(m.prixArticle) : '')) : '';
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
  // v151 (maquette plan-achats-v1, écran ②) : combien d'emballages prendre quand le format vendu diffère
  const emb = m ? nombreEmballages(besoinDe(a, l), m, a.uniteRef) : null;
  const fmtVoulu = formatLisible(a.format);
  const memeFormat = (() => { const x = analyserFormat(emb?.format), y = analyserFormat(a.format); return !!(x && y && x.base === y.base && Math.abs(x.total - y.total) < 1e-9); })();
  const embTexte = emb && (emb.n !== (l.quantite || 1) || (fmtVoulu && !memeFormat))
    ? `${emb.n} × ${formatLisible(emb.format) || emb.format}` : '';
  if (m?.produitOffre || embTexte) notes.push(`<span>Prendre : <b>${esc([embTexte, m?.produitOffre].filter(Boolean).join(' · '))}</b>${
    embTexte && fmtVoulu ? ` <span class="doux">(tu veux ${l.quantite > 1 ? `${l.quantite} × ` : ''}${esc(fmtVoulu)})</span>` : ''}</span>`);
  if (m?.perso) notes.push(`<span class="ep-promo">${esc(m.rabaisTexte || 'rabais perso')}</span>`);
  const max = m ? maxParClient(m) : null;
  if (max) notes.push(`<span class="ep-alerte">${max} max par client</span>`);
  else if (m?.conditions) notes.push(`<span class="ep-alerte">${esc(m.conditions)}</span>`);
  if (m?.economie) notes.push(`<span class="ep-promo">Rabais −${argent(m.economie)}${m.fin ? ` · ${libelleFin(m.fin)}` : ''}</span>`);
  if (a.exclusif) notes.push(`<span>${esc(nomBanniere(a.exclusif))} seulement</span>`);

  const teinte = l.recu?.absent ? '' : l.recu?.statut === 'plus' ? 'recu-ecart' : (l.recu?.statut === 'ok' || l.recu?.statut === 'moins') ? 'recu-ok' : '';
  return `<div class="item item-liste ep ${teinte} ${l.coche ? 'coche' : ''} ${l.indisponible ? 'indisponible' : ''}" data-id="${l.id}">
    <input type="checkbox" ${l.coche ? 'checked' : ''} aria-label="Dans le panier">
    <div class="ep-photo" data-fiche="${a.id}">${photoListe(a) ? `<img src="${esc(photoListe(a))}" alt="">` : PHOTO_VIDE}${panierQuiTourne(a)}</div>
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
  for (const a of articles) for (const o of offresArticle(a)) if (o.pu != null && !o.perso && estRabais(o)) avec.add(o.banniere);
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
  // Seulement les bannières affichées (déjà triées du moins cher au plus cher).
  // v122 (demande de Chris) : jamais le rabais perso d'UNE succursale (10 % d'IGA Varennes) dans Prépa — la colonne IGA
  // vaut pour tous les IGA (Saint-Hilaire n'a pas ce 10 %). Il reste dans Plus → rabais perso et dans Comparer.
  const offres = offresArticle(a).filter((o) => o.pu != null && !o.perso && cols.includes(o.banniere));
  const parBan = {};
  for (const o of offres) if (!parBan[o.banniere]) parBan[o.banniere] = o;
  const choisie = banDeCle(l.magasinCible);
  const ban = choisie && parBan[choisie] ? choisie : offres[0]?.banniere || null;
  return { l, a, parBan, ban, offre: ban ? parBan[ban] : null };
}

/** Contenu d'une case de prix : prix unitaire (rabais en couleur), régulier barré ou rabais perso dessous. */
function htmlPrixCase(o, u, { avecMax = true, vendu = false } = {}) {
  const promo = estRabais(o);
  const max = avecMax ? maxParClient(o) : null;
  // v139 (maquette prepa-colonnes-v1) : 3e ligne = le prix et le format vraiment vendus
  const fv = vendu ? prixFormatVendu(o) : '';
  const dessous = o.perso
    ? `<span class="prg perso">${esc((o.rabaisTexte || '').match(/−\s*\d+\s*%/)?.[0] || 'perso')}</span>`
    : o.economie && o.prixNum ? `<span class="prg">${argent(o.pu * o.prixRegulier / o.prixNum)}</span>`
    : `<span class="prg${o.pc != null ? ' pkg' : ''}">${o.pc != null ? puCourt(o.pc, o.pcUnite) : ''}</span>`;   // contenants de poids différents : prix au kg dessous (c'est lui qui compare)
  // v141 : prix démesuré par rapport aux autres bannières → ⚠ « à vérifier » (jamais retenu comme le moins cher)
  const doute = o.douteux ? `<span class="pdoute" title="Prix inhabituel : ${String(o.douteux).replace('.', ',')} fois la médiane des autres bannières. À vérifier (format mal lu ?)">⚠</span>`
    : o.aVerifier ? '<span class="pdoute" title="Prix marqué « à vérifier » (lecture incertaine) : jamais retenu comme le moins cher">⚠</span>' : '';   // v150
  // v147 : « N pour X $ » avec minimum (« ou 4 $ l'unité ») → rappel « min N »
  const mini = o.minimum ? `<span class="pmax" title="${o.prixSeul != null ? `Sous ${o.minimum} : ${argent(o.prixSeul)} l'unité` : `Seulement à l'achat de ${o.minimum}`}">min ${o.minimum}</span>` : '';
  return `${doute}${max ? `<span class="pmax">${max} max</span>` : ''}${mini}<span class="pp ${promo ? 'promo' : ''}${o.douteux || o.aVerifier ? ' douteux' : ''}">${puCourt(o.pu, o.uniteRef || u)}</span>${dessous}${
    fv ? `<span class="pfv">${esc(fv)}</span>` : ''}`;
}

/** « 6,49 $ · 585 g » ; un prix déjà au poids (« 0,69 $/lb ») reste seul : le format de la fiche n'y ajouterait que de la confusion. */
function prixFormatVendu(o) {
  if (o?.offre == null || o.offre === '') return '';
  if (/\/\s*(?:lb|kg|100\s*g|g|l|ml)\b/i.test(o.offre)) return o.offre;
  // v150 : offre enregistrée en nombre seul (« 13.29 », sites en anglais) → « 13,29 $ » comme les autres
  const offre = texteOffre(o.offre);
  return [offre, o.formatVendu ? formatLisible(o.formatVendu) : ''].filter(Boolean).join(' · ');
}

// v139 — Fenêtre photo : toucher une case de bannière la choisit et montre le produit vendu ; toucher à côté la ferme
let bulleProduit = null;
function fermerBulleProduit() { bulleProduit?.remove(); bulleProduit = null; }
function ouvrirBulleProduit(btn, a, o) {
  fermerBulleProduit();
  // photo du produit vendu, sinon celle de ta fiche ; v147 : jamais une icône du site (cœur .svg)
  const photos = [o.image, photoListe(a)].filter((u) => u && !/\.svg(?:[?#]|$)/i.test(u));
  const nom = o.nomProduit || o.produitOffre || [a.marque, a.nom].filter(Boolean).join(' ');
  const b = document.createElement('div');
  b.className = 'bulle-produit';
  b.setAttribute('role', 'dialog');
  b.setAttribute('aria-label', 'Produit vendu');
  // Règle de Chris (v141) : photo pas encore là et en chargement → le panier qui tourne à sa place
  b.innerHTML = `${photos.length ? `<div class="bp-photo"><span class="panier-tourne bp-attente"><span class="pt-rond"><span class="pt-anneau"></span><span class="pt-chariot" aria-hidden="true">🛒</span></span></span><img alt="" hidden></div>` : ''}<b>${esc(nom)}</b>
    <small>${esc([prixFormatVendu(o), estRabais(o) ? 'en rabais' : ''].filter(Boolean).join(' · '))}</small>
    ${o.douteux ? `<small class="bp-doute">⚠ Prix inhabituel (${String(o.douteux).replace('.', ',')} fois les autres) : à vérifier</small>` : ''}
    <span class="bp-ban">${esc(nomBanniere(o.banniere))}</span>
    ${o.id && !o.perso ? '<div class="bp-retirer"><button type="button" class="bp-r1">Retirer ce prix</button></div>' : ''}`;
  document.body.appendChild(b);
  bulleProduit = b;
  // v142 (demande de Chris) : retirer UN prix qu'il sait faux. Deux touchers (confirmation dans la fenêtre).
  // Le prix est annulé (annule + raison), pas effacé : il sort de tous les calculs et reste dans l'historique.
  const zone = b.querySelector('.bp-retirer');
  if (zone) zone.querySelector('.bp-r1').onclick = () => {
    zone.innerHTML = `<small>Retirer ce prix de ${esc(nomBanniere(o.banniere))} ? Il ne comptera plus nulle part.</small>
      <div class="rang" style="gap:6px;margin-top:4px"><button type="button" class="bp-oui">Oui, retirer</button><button type="button" class="bp-non">Annuler</button></div>`;
    zone.querySelector('.bp-non').onclick = () => fermerBulleProduit();
    zone.querySelector('.bp-oui').onclick = () => {
      S.maj((x) => {
        const p = x.prix.find((y) => y.id === o.id);
        if (p) { p.annule = true; p.annuleRaison = 'retiré à la main (prix faux)'; p.annuleLe = new Date().toISOString(); }
      });
      fermerBulleProduit();
      toast(`Prix retiré : ${texteOffre(o.offre)} chez ${nomBanniere(o.banniere)}`);
    };
  };
  if (photos.length) {
    const img = b.querySelector('img'), attente = b.querySelector('.bp-attente');
    let i = 0;
    img.onload = () => { attente.remove(); img.hidden = false; };
    img.onerror = () => { if (++i < photos.length) img.src = photos[i]; else { attente.remove(); b.querySelector('.bp-photo').remove(); } };
    img.src = photos[0];
  }
  // Posée sous la case (au-dessus s'il manque de place), dans la page : elle suit le défilement et reste
  // ouverte jusqu'à ce que tu touches à côté
  const r = btn.getBoundingClientRect(), L = b.offsetWidth, H = 260, m = 8;
  const gauche = Math.min(Math.max(m, r.left + r.width / 2 - L / 2), innerWidth - L - m);
  const haut = r.bottom + 6 + H < innerHeight - m ? r.bottom + 6 : Math.max(m, r.top - 6 - H);
  b.style.left = `${gauche + scrollX}px`; b.style.top = `${haut + scrollY}px`;
}
document.addEventListener('pointerdown', (ev) => { if (bulleProduit && !ev.target.closest('.bulle-produit, .pcel')) fermerBulleProduit(); }, true);

const SVG_ETIQ = '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8.6V2.2a.7.7 0 0 1 .7-.7h6.4l6 6a1 1 0 0 1 0 1.4l-5.2 5.2a1 1 0 0 1-1.4 0z" fill="currentColor"/><circle cx="5" cy="5" r="1.4" fill="#d7f7e4"/></svg>';
const SVG_RAPPEL = '<svg class="p-rappel" viewBox="0 0 18 16" role="img" aria-label="Rappel ou avis sur ce produit"><path d="M9 1 17 15H1z" fill="#ffd54f" stroke="#8a5a00" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 6v4" stroke="#412402" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="12.4" r=".9" fill="#412402"/></svg>';

function htmlRangee(r, cols, seule) {
  const { l, a } = r;
  const u = r.offre?.uniteRef || a.uniteRef;
  const sous = [formatLisible(a.format), a.marque].filter(Boolean);
  let h = `<tr class="pl ${l.indisponible ? 'indisponible' : ''}" data-l="${l.id}"><td class="pc"><div class="p-art">
    <div class="p-photo" data-fiche="${a.id}">${photoListe(a) ? `<img src="${esc(photoListe(a))}" alt="">` : PHOTO_VIDE}${a.rappel ? SVG_RAPPEL : ''}${panierQuiTourne(a)}<span class="p-qte">${l.quantite}</span></div>
    <div class="p-txt" data-fiche="${a.id}"><div class="p-nom">${esc(a.nom)}${a.local ? ' <span title="Produit local (Québec)">🍁</span>' : ''}</div>${
      sous.length ? `<div class="p-sous">${esc(sous.join(' · '))}</div>` : ''}</div>
    <div class="p-pm"><button data-q="1" aria-label="Un de plus">+</button><button data-q="-1" aria-label="Un de moins">−</button></div></div></td>`;
  if (seule) return `${h}</tr>`;
  h += `<td class="p-dealc">${r.offre ? htmlPrixCase(r.offre, u, { avecMax: false }) : ''}</td>`;
  h += cols.map((b) => {
    const o = r.parBan[b];
    return `<td>${o ? `<button class="pcel ${b === r.ban ? 'sel' : ''}" data-cle="${esc(cleOffre(o))}" aria-label="Acheter chez ${esc(nomBanniere(b))}">${htmlPrixCase(o, u, { vendu: true })}</button>` : ''}</td>`;
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
  const etiquette = o ? (texteOffre(o.offre) || (o.prixArticle != null ? argent(o.prixArticle) : '')) : '';
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
    <div class="p-photo" data-fiche="${a.id}">${photoListe(a) ? `<img src="${esc(photoListe(a))}" alt="">` : PHOTO_VIDE}${a.rappel ? SVG_RAPPEL : ''}${panierQuiTourne(a)}<span class="p-qte">${l.quantite}</span></div>
    <div class="ls-tx" data-fiche="${a.id}">
      <div class="ls-nom">${esc(a.nom)}${a.local ? ' <span title="Produit local (Québec)">🍁</span>' : ''}${sous.length ? ` <span class="ls-sous">· ${esc(sous.join(' · '))}</span>` : ''}</div>
      <div class="ls-prix">${o ? `${groupe === 'rayon' ? logo(o.banniere) : ''}<b class="ls-pp ${estRabais(o) ? 'promo' : ''}">${esc(etiquette) || '?'}</b>${
        o.economie && o.prixRegulier ? `<s>${argent(o.prixRegulier)}</s>` : ''}${o.pu != null ? `<span class="ls-pu">${puCourt(o.pu, o.uniteRef)}</span>` : ''}` : ''}</div>
      <div class="ls-ch">${ch.map(([c, t]) => `<span class="lch ${c}">${esc(t)}</span>`).join('')}</div>
    </div>
    <div class="ls-d"><b class="ls-tot">${cout != null ? argent(cout) : '—'}</b><div class="ls-pm"><button data-q="-1" aria-label="Un de moins">−</button><button data-q="1" aria-label="Un de plus">+</button></div></div>
  </div></td></tr>`;
}

// ---------------------------------------------------------------------
// v152 — Bilan après l'achat (maquette plan-achats-v1, écran ③) : en haut de Prépa pendant 7 jours après une visite
// (« Retirer les achetés » en mode Magasin) : prévu ↔ payé (reçu), économisé, articles pas achetés, économies du mois.
// ---------------------------------------------------------------------
const PREF_BILAN_FERME = 'bilan.ferme';   // visite dont le bilan a été fermé (ce téléphone)
const dateCourte = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
const nomMois = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-CA', { month: 'long' });

/** Économies du mois en cours (réelles d'après les reçus ; visites sans reçu : estimées à part). Ligne ou ''. */
function htmlEconomiesMois() {
  const e = S.get();
  const auj = jourQuebec();
  const m = economiesMois(e.recus, e.achats, auj.slice(0, 7));
  if (!(m.reel > 0.004) && !(m.estime > 0.004)) return '';
  const mois = nomMois(auj);
  return `<div class="plan-l plan-mois"><span>${mois.charAt(0).toUpperCase() + mois.slice(1)} : <b class="plan-vert">−${argent(m.reel)}</b> économisés<br><span class="doux">d'après ${m.nRecus} reçu${m.nRecus > 1 ? 's' : ''}${m.parBanniere.length > 1 ? ` · ${m.parBanniere.map((x) => `${esc(nomBanniere(x.banniere))} −${argent(x.total)}`).join(' · ')}` : ''}${
    m.estime > 0.004 ? ` · + environ −${argent(m.estime)} estimés (${m.nVisitesEstimees} visite${m.nVisitesEstimees > 1 ? 's' : ''} sans reçu)` : ''}</span></span></div>`;
}

function htmlBilanVisite() {
  const e = S.get();
  const v = derniereVisite(e.achats);
  if (!v) return '';
  const auj = jourQuebec();
  const age = Math.round((Date.parse(`${auj}T12:00:00Z`) - Date.parse(`${v.date}T12:00:00Z`)) / 86400000);
  let ferme = null;
  try { ferme = localStorage.getItem(PREF_BILAN_FERME); } catch { /* navigation privée */ }
  if (age > 7 || ferme === v.visite) return '';
  const b = bilanVisite(e.achats, e.recus, e.liste, v);
  const noms = (ids) => ids.map((id) => e.articles.find((a) => a.id === id)?.nom).filter(Boolean);
  const restants = noms(b.restants);
  const ecart = b.recu?.paye != null && b.prevu > 0 ? b.recu.paye - b.prevu : null;
  return `<div class="plan plan-bilan">
    <div class="plan-tete"><span><b>Bilan · ${esc(nomBanniere(b.banniere))} ${esc(dateCourte(b.date))}</b></span><button type="button" class="plan-replier" id="bilanFermer" aria-label="Fermer le bilan">✕</button></div>
    <div class="plan-l"><span>Prévu (ta liste, ${b.n} article${b.n > 1 ? 's' : ''}${b.sansPrix ? `, dont ${b.sansPrix} sans prix` : ''})</span><b>${argent(b.prevu)}</b></div>
    ${b.recu ? `<div class="plan-l"><span>Payé <span class="doux">(reçu du ${esc(dateCourte(b.recu.date))}, tout compris)</span></span><b>${argent(b.recu.paye)}</b></div>
      ${b.recu.economise > 0.004 ? `<div class="plan-l"><span>Économisé <span class="doux">(rabais du reçu)</span></span><b class="plan-vert">−${argent(b.recu.economise)}</b></div>` : ''}
      ${ecart != null && ecart > 0.5 ? `<div class="doux">Le reçu compte ${argent(ecart)} de plus que ta liste (articles hors liste, taxes, consignes).</div>` : ''}
      <button type="button" class="btn sec plan-utiliser-sec" id="bilanRecu" data-recu="${esc(b.recu.id)}">Voir le reçu et sa vérification</button>`
    : `${b.economiePrevue > 0.004 ? `<div class="plan-l"><span>Économie prévue <span class="doux">(rabais de ta liste)</span></span><b class="plan-vert">−${argent(b.economiePrevue)}</b></div>` : ''}
      <button type="button" class="btn sec plan-utiliser-sec" id="bilanPhoto" data-ban="${esc(b.banniere)}">📷 Photographier le reçu</button><div class="doux">pour voir le payé et l'économisé réels</div>`}
    ${restants.length ? `<div class="plan-l plan-wa"><span>Pas achetés chez ${esc(nomBanniere(b.banniere))} : ${esc(restants.slice(0, 3).join(', '))}${restants.length > 3 ? ` et ${restants.length - 3} autre${restants.length > 4 ? 's' : ''}` : ''}<br><span class="doux">gardés sur ta liste pour la prochaine fois</span></span></div>` : ''}
    ${htmlEconomiesMois()}
  </div>`;
}

function brancherBilan(v) {
  $('#bilanFermer', v)?.addEventListener('click', () => {
    const d = derniereVisite(S.get().achats);
    try { if (d) localStorage.setItem(PREF_BILAN_FERME, d.visite); } catch { /* navigation privée */ }
    rendre();
  });
  $('#bilanRecu', v)?.addEventListener('click', (ev) => ouvrirDetailRecu(ev.currentTarget.dataset.recu));
  $('#bilanPhoto', v)?.addEventListener('click', (ev) => nouveauRecu({ banniere: ev.currentTarget.dataset.ban }));
}

// ---------------------------------------------------------------------
// v151 — Carte « Ton plan » en haut de Prépa (maquette journal/maquettes/plan-achats-v1.html, écran ①) :
// où aller, combien, en 1, 2 ou 3 magasins (parmi les bannières affichées), articles sans prix, fraîcheur des prix,
// économie, et « à racheter » tiré des reçus (hypothèse avec n ≥ 3). « Utiliser ce plan » place chaque article.
// ---------------------------------------------------------------------
const PREF_PLAN_ARRETS = 'plan.arrets';   // 1, 2 ou 3 (ce téléphone)
const PREF_PLAN_REPLIE = 'plan.replie';   // carte réduite à une ligne (ce téléphone)
const PREF_RACHAT_PLUS_TARD = 'plan.rachat.plusTard';   // jour où « Plus tard » a été touché
let planCourant = null;   // dernier plan affiché (pour « Utiliser ce plan »)

function arretsVoulus() {
  try { const n = Number(localStorage.getItem(PREF_PLAN_ARRETS)); return [1, 2, 3].includes(n) ? n : 2; } catch { return 2; }
}

function htmlPlan(cols, rangees) {
  planCourant = null;
  if (!rangees.length || !cols.length) return '';
  const e = S.get();
  const auj = jourQuebec();
  const voulu = arretsVoulus();
  const opt = optimiser(Math.min(3, cols.length), { cleAutorisee: (k) => cols.includes(k) });
  const r = opt.resultats.find((x) => x.arrets === voulu) || opt.resultats.at(-1) || null;
  const lignes = rangees.map(({ l, a }) => ({ l, a }));   // mêmes lignes que l'optimiseur (non cochées)
  const plan = resumePlan(r, lignes, auj);
  // Rachats : produits revenus dans au moins 3 reçus (jours différents), pas déjà sur la liste
  let plusTard = null;
  try { plusTard = localStorage.getItem(PREF_RACHAT_PLUS_TARD); } catch { /* navigation privée */ }
  const rachats = (plusTard === auj ? [] : aRacheter(e.recus, e.liste, auj, { achats: e.achats }))
    .map((x) => ({ ...x, a: e.articles.find((a) => a.id === x.articleId) })).filter((x) => x.a).slice(0, 3);
  if (!plan && !rachats.length) return '';
  planCourant = r;
  let replie = false;
  try { replie = localStorage.getItem(PREF_PLAN_REPLIE) === '1'; } catch { /* navigation privée */ }
  const utilise = !!r && r.affect.length > 0 && r.affect.every((x) => x.l.magasinCible === x.choix.cle);
  const nArrets = r ? new Set(r.affect.map((x) => x.choix.cle)).size : 0;
  if (replie) {
    return `<div class="plan plan-replie"><button type="button" class="plan-ouvrir" id="planOuvrir">${plan
      ? `<span>Ton plan : <b>${argent(plan.total)}</b> en ${nArrets} magasin${nArrets > 1 ? 's' : ''}${utilise ? ' · ✓ utilisé' : ''}</span>` : '<span>Ton plan</span>'}<span class="doux">▾</span></button></div>`;
  }
  // Prix ⚠ écartés parmi les articles de la liste (démesurés ou « à vérifier »), dans les bannières affichées
  const suspects = lignes.reduce((t, { a }) => t + offresArticle(a).filter((o) => cols.includes(o.banniere) && (o.douteux || o.aVerifier)).length, 0);
  let h = '<div class="plan">';
  if (plan) {
    const choix = [1, 2, 3].filter((n) => n <= cols.length)
      .map((n) => `<button type="button" data-plan-arrets="${n}" class="${n === voulu ? 'on' : ''}">${n} magasin${n > 1 ? 's' : ''}</button>`).join('');
    // Articles hors du plan : vendus ailleurs (dans une autre bannière affichée), ou sans aucun prix connu
    const vendusAilleurs = (a) => offresArticle(a).some((o) => o.pu != null && cols.includes(o.banniere));
    const ailleurs = plan.sansPrix.filter(vendusAilleurs), aucun = plan.sansPrix.filter((a) => !vendusAilleurs(a));
    // Ce que coûteraient ces articles au moins cher dans les autres bannières affichées (le total du haut les compte)
    const coutAilleurs = rangees.filter((x) => ailleurs.includes(x.a)).reduce((t, { l, a }) => {
      const c = cols.map((b) => coutPour(l, a, b)).filter((x) => x != null).sort((x, y) => x - y)[0];
      return t + (c || 0);
    }, 0);
    const listeNoms = (as) => (as.length ? esc(as.slice(0, 3).map((a) => a.nom).join(', ')) + (as.length > 3 ? ` et ${as.length - 3} autre${as.length > 4 ? 's' : ''}` : '') : '');
    h += `<div class="plan-tete"><span class="doux">Ton plan le moins cher</span><button type="button" class="plan-replier" id="planReplier" aria-label="Réduire la carte">▴</button></div>
      <div class="plan-choix">${choix}</div>
      <div class="plan-total">${argent(plan.total)}</div>
      <div class="doux">${plan.avecPrix} article${plan.avecPrix > 1 ? 's' : ''} sur ${plan.nbLignes} dans ce${nArrets > 1 ? 's' : ''} magasin${nArrets > 1 ? 's' : ''} · avant taxes</div>
      ${plan.magasins.map((m) => `<div class="plan-l"><span>${logo(m.cle)} <span class="doux">${m.n} article${m.n > 1 ? 's' : ''}</span></span><b>${argent(m.total)}</b></div>`).join('')}
      ${listeNoms(ailleurs) ? `<div class="plan-l plan-wa"><span>${nArrets === 1 && plan.magasins[0] ? `Pas chez ${esc(nomBanniere(plan.magasins[0].cle))}` : "Pas dans ces magasins"} : ${listeNoms(ailleurs)}</span>${coutAilleurs > 0 ? `<span>≈ ${argent(coutAilleurs)} ailleurs</span>` : ''}</div>` : ''}
      ${listeNoms(aucun) ? `<div class="plan-l plan-wa"><span>Sans prix connu : ${listeNoms(aucun)}</span></div>` : ''}
      <div class="plan-pills">${plan.recents ? `<span class="pill v">✓ ${plan.recents} prix de moins de 14 j</span>` : ''}${plan.moyens ? `<span class="pill">${plan.moyens} prix de 15 à 60 j</span>` : ''}${suspects ? `<span class="pill a">⚠ ${suspects} prix douteux écarté${suspects > 1 ? 's' : ''}</span>` : ''}</div>
      ${plan.economie > 0.004 ? `<div class="plan-l plan-eco"><span>Économie avec ce plan<br><span class="doux">sur les prix réguliers${plan.finBientot ? ` · ${plan.finBientot} rabais fini${plan.finBientot > 1 ? 'ssent' : 't'} d'ici demain` : ''}</span></span><b>−${argent(plan.economie)}</b></div>` : ''}
      ${utilise ? '<div class="plan-ok">✓ Plan utilisé : chaque article est placé dans son magasin</div>' : '<button type="button" class="btn plan-utiliser" id="planUtiliser">Utiliser ce plan</button>'}`;
  }
  if (!htmlBilanVisite()) h += htmlEconomiesMois();   // v152 : sinon, elles sont dans le bilan
  if (rachats.length) {
    h += `<div class="plan-rachat"><div class="doux">À racheter bientôt (d'après tes reçus)</div>
      ${rachats.map((x) => `<div class="plan-l"><span>${esc(x.a.nom)}</span><span class="doux">tous les ${x.intervalle} j environ (n = ${x.n})</span></div>`).join('')}
      <div class="plan-btns"><button type="button" class="btn sec" id="planRacheter" data-ids="${esc(rachats.map((x) => x.a.id).join(','))}">+ Ajouter ${rachats.length > 1 ? `les ${rachats.length}` : 'à la liste'}</button><button type="button" class="btn sec" id="planPlusTard">Plus tard</button></div></div>`;
  }
  return h + '</div>';
}

function brancherPlan(v) {
  $$('[data-plan-arrets]', v).forEach((b) => b.onclick = () => {
    try { localStorage.setItem(PREF_PLAN_ARRETS, b.dataset.planArrets); } catch { /* navigation privée */ }
    rendre();
  });
  const replier = (oui) => { try { localStorage.setItem(PREF_PLAN_REPLIE, oui ? '1' : '0'); } catch { /* navigation privée */ } rendre(); };
  $('#planReplier', v)?.addEventListener('click', () => replier(true));
  $('#planOuvrir', v)?.addEventListener('click', () => replier(false));
  $('#planUtiliser', v)?.addEventListener('click', () => {
    const r = planCourant;
    if (!r) return;
    const cles = new Map(r.affect.map((x) => [x.l.id, x.choix.cle]));
    S.maj((x) => x.liste.forEach((li) => { if (cles.has(li.id)) li.magasinCible = cles.get(li.id); }));
    const n = new Set(cles.values()).size;
    toast(`Plan utilisé : ${n} magasin${n > 1 ? 's' : ''}, ${argent(r.total)}`);
  });
  $('#planRacheter', v)?.addEventListener('click', (ev) => {
    const ids = ev.currentTarget.dataset.ids.split(',').filter(Boolean);
    ids.forEach((id) => ajouterALaListe(id));
    toast(`${ids.length} produit${ids.length > 1 ? 's' : ''} ajouté${ids.length > 1 ? 's' : ''} à la liste`);
  });
  $('#planPlusTard', v)?.addEventListener('click', () => {
    try { localStorage.setItem(PREF_RACHAT_PLUS_TARD, jourQuebec()); } catch { /* navigation privée */ }
    rendre();
  });
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
// Le choix est aussi gardé ici : si la mémoire du téléphone est pleine (localStorage refuse d'écrire),
// la puce touchée reste quand même choisie jusqu'à la fermeture de l'app.
let modeChoisi = null;
window.addEventListener('epicerie:memoire-pleine', () => toast('Mémoire du téléphone pleine : il n\'enregistre plus tes changements sur place. Ils partent en ligne si tu es connecté.'));
function modeListe(cols) {
  let m = modeChoisi || 'prep';
  if (!modeChoisi) try { m = localStorage.getItem(PREF_MODE) || 'prep'; } catch { /* navigation privée */ }
  return m === 'prep' || cols.includes(m) ? m : 'prep';
}

const etatAnneau = new Map();    // bannière → dernier % « trouvés » affiché
const eclatJusqua = new Map();   // bannière → fin de l'animation d'éclat (ms)

/** Coché pendant la visite en cours (moins de 12 h) : reste affiché, barré, dans « Dans le panier ». */
const VISITE_MS = 12 * 3600 * 1000;
const cocheCetteVisite = (l) => !!l.coche && Date.now() - Date.parse(l.cocheLe || '') < VISITE_MS;

function vueEpicerie(v, b, toutes) {
  const e = S.get();
  // Exactement les choix de Prépa. pour cette bannière (case choisie, sinon la moins chère) — pas plus, pas moins.
  // Les articles cochés lors d'une visite précédente ne reviennent pas ; ceux sans prix restent dans Prépa.
  const ici = toutes.filter((r) => r.ban === b && (!r.l.coche || cocheCetteVisite(r.l)));
  const aPrendre = ici.filter((r) => !r.l.coche && !r.l.indisponible);
  const panier = ici.filter((r) => r.l.coche);
  const indispos = ici.filter((r) => !r.l.coche && r.l.indisponible);
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
  // v152 : les articles retirés vont dans l'historique des achats (bilan, économies du mois, « à racheter »)
  $('#btnVider', v)?.addEventListener('click', () => {
    const lignes = panier.map((r) => ({ l: r.l, a: r.a, cout: r.offre ? coutPour(r.l, r.a, cleOffre(r.offre)) : null,
      economie: r.offre?.economie ? r.offre.economie * (r.l.quantite || 1) : 0 }));
    const achats = lignesAchat(lignes, b, jourQuebec(), () => S.uid('ac'));
    S.maj((x) => { (x.achats ||= []).push(...achats); x.liste = x.liste.filter((l) => !ids.has(l.id)); });
    try { localStorage.removeItem(PREF_BILAN_FERME); } catch { /* navigation privée */ }
    toast(`Visite chez ${nomBanniere(b)} enregistrée (${achats.length} article${achats.length > 1 ? 's' : ''}) : ton bilan est en haut de Prépa.`);
  });
  // v120 : le reçu photographié ici ne parle que des produits cochés chez CETTE bannière
  $('#btnRecu', v).onclick = () => nouveauRecu({ banniere: b, ids: panier.map((r) => r.l.id) });
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
    modeChoisi = b.dataset.mode;
    try { localStorage.setItem(PREF_MODE, b.dataset.mode); } catch { /* mémoire pleine ou navigation privée : gardé en mémoire vive */ }
    rendre();
    window.scrollTo(0, 0);
  });
  // Une bannière choisie = on magasine : titre « Mode Magasin » sous les puces
  const titre = $('#modeMagasin');
  titre.hidden = mode === 'prep';
  if (mode !== 'prep') titre.innerHTML = `<span class="mm-titre">Mode Magasin</span><span class="mm-ban">chez ${esc(nomBanniere(mode))}</span>`;
  if (mode !== 'prep') { montrerPuces(); vueEpicerie(v, mode, toutes); return; }

  if (!rangees.length) {
    v.innerHTML = htmlBilanVisite() + '<div class="vide">Ta liste est vide. Ajoute un produit en haut à droite ou scanne un code-barres.</div>';
    brancherBilan(v);
    return;
  }

  const nCol = seule ? 1 : cols.length + 3;
  const bascule = (id, lib, on) => `<label class="bascule"><span class="interrupteur"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span><span class="lib">${lib}</span></label>`;
  // Largeur fixe : sans largeur de tableau, le navigateur élargit la colonne produit au nom le plus long
  // v141 : colonnes de bannière 72 → 86 px (« 9,99 $ · 850 g » en entier)
  const LC = 86;
  const largeur = (photo ? 52 : 184) + 72 + cols.length * LC + 40;
  // Deux tableaux de mêmes colonnes : la tête (bannières, totaux) flotte en haut pendant le défilement,
  // le corps défile dessous ; leurs défilements horizontaux restent synchronisés.
  const ouvrirTable = () => `<table class="prep-t"${seule ? '' : ` style="width:${largeur}px"`}>${seule ? ''
    : `<colgroup><col style="width:${photo ? 52 : 184}px"><col style="width:72px">${cols.map(() => `<col style="width:${LC}px">`).join('')}<col style="width:40px"></colgroup>`}`;
  let h = htmlBilanVisite() + htmlPlan(cols, rangees) + `<div class="prep ${photo ? 'photo' : ''} ${seule ? 'seule' : ''}"><div class="prep-tete">${ouvrirTable()}`;
  // Les deux interrupteurs restent toujours à leur place (Photo s'applique quand Liste est désactivée)
  // À droite des interrupteurs : nombre d'articles sur la liste (Prépa. = ceux qui restent à acheter)
  const nb = `<div class="p-nb" title="${rangees.length} article(s) sur la liste"><b>${rangees.length}</b><span>article${rangees.length > 1 ? 's' : ''}</span></div>`;
  h += `<thead><tr><th class="pc"><div class="pc-tete"><div class="bascules">${bascule('bPhoto', 'Photo', photo)}${bascule('bListe', 'Liste', seule)}</div>${nb}</div></th>`;
  if (!seule) {
    h += '<th><button class="p-deal" id="btnDeal" title="Tout au meilleur prix">Deal</button></th>';
    // v141 : ville(s) sous la pastille, sauf une ville où la bannière a deux succursales
    h += cols.map((b) => { const vs = villesColonne(b); return `<th><div class="p-tot">${tot[b] ? argent(tot[b]) : ''}</div>${logo(b)}${
      vs.length ? `<span class="ville-col" title="${esc(vs.join(', '))}">${esc(vs.join(', '))}</span>` : ''}<div class="p-eco">${eco[b] > 0.004 ? `−${argent(eco[b])}` : ''}</div></th>`; }).join('');
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
    // v150 : un prix ⚠ (démesuré ou « à vérifier ») passe après les autres, comme partout ailleurs
    const suspect = (x) => (x.douteux || x.aVerifier ? 1 : 0);
    const cles = Object.fromEntries(rangees.map((r) => { const m = Object.values(r.parBan).sort((x, y) => suspect(x) - suspect(y) || (prixComparable(x) ?? Infinity) - (prixComparable(y) ?? Infinity))[0]; return [r.l.id, m ? cleOffre(m) : null]; }));
    S.maj((x) => x.liste.forEach((li) => { if (cles[li.id]) li.magasinCible = cles[li.id]; }));
    toast('Tout au meilleur prix');
  });
  $('#btnAjBan', v)?.addEventListener('click', () => allerOnglet('magasins'));
  brancherPlan(v);
  brancherBilan(v);
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
    tr.querySelectorAll('.pcel[data-cle]').forEach((b) => b.onclick = () => {
      const cle = b.dataset.cle;
      S.maj((x) => {
        const l = x.liste.find((i) => i.id === id);
        if (l) l.magasinCible = cle;
      });
      // La liste est redessinée : la fenêtre s'accroche à la case une fois en place
      setTimeout(() => {
        const l = S.get().liste.find((i) => i.id === id), a = l && S.get().articles.find((x) => x.id === l.articleId);
        const o = a && offresArticle(a).find((x) => cleOffre(x) === cle);
        const btn = [...document.querySelectorAll(`tr.pl[data-l="${CSS.escape(id)}"] .pcel[data-cle]`)].find((x) => x.dataset.cle === cle);
        if (o && btn) ouvrirBulleProduit(btn, a, o);
      }, 30);
    });
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
  arreterRechercheVue();
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
  // Sortir sans rien ajouter : « ← » dans le champ, toucher le voile, ou le bouton Retour du téléphone
  const fermerBtn = $('#btnFermerSaisie'), voile = $('#voileSaisie');
  fermerBtn.addEventListener('pointerdown', (ev) => ev.preventDefault());
  fermerBtn.addEventListener('click', () => terminerSaisie());
  // Le voile garde le toucher pour lui (sinon le doigt tomberait sur la liste dessous une fois le voile retiré)
  voile.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  voile.addEventListener('click', () => terminerSaisie());
  // Champ ouvert : voile sur le reste de l'écran + une étape d'historique, pour que Retour ferme le champ au lieu de quitter
  new MutationObserver(() => {
    const ouvert = champ.classList.contains('ouvert');
    document.body.classList.toggle('saisie-active', ouvert);
    if (ouvert && !history.state?.saisie) history.pushState({ saisie: true }, '');
    if (!ouvert && history.state?.saisie) history.back();
  }).observe(champ, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', () => { if (champ.classList.contains('ouvert')) terminerSaisie(); });
  // Le champ s'élargit par-dessus l'en-tête quand on écrit, puis reprend sa place
  saisie.addEventListener('focus', () => { champ.classList.add('ouvert'); clavierCache(false); });
  saisie.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === saisie) return;
    if (document.body.classList.contains('clavier-cache')) return;   // clavier caché par la flèche : le champ reste ouvert
    abandonner();
  }, 150));
  // Flèche du clavier (v117) : ⌄ cache le clavier (les propositions restent) ; ⌃, ou toucher le champ, le ramène
  const btnClavier = $('#btnClavier');
  function clavierCache(oui) {
    document.body.classList.toggle('clavier-cache', oui);
    btnClavier.textContent = oui ? '⌃' : '⌄';
    btnClavier.setAttribute('aria-label', oui ? 'Ramener le clavier' : 'Cacher le clavier');
  }
  btnClavier.addEventListener('pointerdown', (ev) => ev.preventDefault());   // le champ garde le focus jusqu'au clic
  btnClavier.addEventListener('click', () => {
    if (document.body.classList.contains('clavier-cache')) saisie.focus();
    else { clavierCache(true); saisie.blur(); }
  });
  new MutationObserver(() => { if (!champ.classList.contains('ouvert')) clavierCache(false); })
    .observe(champ, { attributes: true, attributeFilter: ['class'] });
  // Hauteur du clavier (visualViewport) : la flèche se colle au-dessus, les propositions s'arrêtent avant
  const vv = window.visualViewport;
  const majClavier = () => {
    const bas = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    document.documentElement.style.setProperty('--clavier-bas', `${Math.round(bas)}px`);
    document.documentElement.style.setProperty('--vue-haut', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
  };
  vv?.addEventListener('resize', majClavier); vv?.addEventListener('scroll', majClavier); majClavier();
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
    if (ev.target.closest('header') || ev.target.closest('#btnClavier') || !champ.classList.contains('ouvert')) return;
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
 * ✓ (maquette recherche-niveaux-v2) : rien n'est cherché en ligne avant l'ajout.
 * Produit(s) connu(s) → ajoutés. Un seul nom inconnu → « Mon nom tel quel » : ajouté tout de suite dans Prépa,
 * et la recherche chez tes bannières part en arrière-plan.
 */
async function valider() {
  const saisie = $('#saisie');
  const brut = saisie.value.trim();
  if (!brut) return;
  const morceaux = decouperSaisie(brut);
  const seul = morceaux.length === 1 && !trouverArticle(morceaux[0].nom);
  terminerSaisie();
  if (seul) ajouterTelQuel(brut); else ajouterTexte(brut);
}


// Vocabulaire des accents : noms du référentiel, leurs noms alternatifs français et les noms de tes fiches (recalculé si ça change)
let vocabCache = null, vocabCle = '';
function vocabAccents() {
  const src = sourcesRattachement(), e = S.get();
  const cle = `${src ? 1 : 0}:${e.articles.length}`;
  if (vocabCache && vocabCle === cle) return vocabCache;
  const noms = [...e.articles.map((a) => a.nom)];
  if (src) {
    for (const r of Object.values(src.generiques)) noms.push(r[2]);
    for (const alt of Object.values(src.alternatifs || {})) noms.push(...(alt.fr || []));
  }
  vocabCache = vocabulaire(noms); vocabCle = cle;
  return vocabCache;
}

// --- Recherche chez tes bannières (maquette recherche-bannieres-v1) ---
let rechercheVue = null;   // { id, desabonner } : la demande affichée sous le champ, redessinée quand l'ordinateur répond
function arreterRechercheVue() { rechercheVue?.desabonner(); rechercheVue = null; }

/** v157 — Fiche neuve venue d'une recette : même recherche « nom » que le champ « Ajouter » (choix proposé ou « toutes sortes »). */
export function rechercherNouvelle(a) { return a ? deposerRecherche(a.nom, a.id) : null; }

/**
 * v157 — Réparation, une fois par session : fiches de recette sur la liste créées avant v157 (nom avec la quantité,
 * « Tortiglionis secs 500 ml »), sans code ni aucun prix, jamais cherchées par leur nom → nom relu, puis recherche « nom ».
 */
let reparationFaite = false;
async function reparerFichesRecette() {
  if (reparationFaite || !Sync.estPret() || !S.get().articles.length) return;
  reparationFaite = true;
  // v157 (leçon du 2026-11-25) : la mise à jour recharge la page ; sans tirer d'abord la base, la 2e page ne voyait
  // pas les recherches déposées par la 1re (pas encore enregistrées) et les déposait une 2e fois.
  try { await Sync.tirer(); } catch { reparationFaite = false; return; }
  const e = S.get();
  const avecPrix = new Set(e.prix.map((p) => p.articleId));
  const parNom = new Set((e.recherches || []).filter((r) => r.but === 'nom').map((r) => r.articleId));
  const ids = new Set(e.liste.filter((l) => !l.coche && (l.recettes || []).length).map((l) => l.articleId));
  const aReparer = e.articles.filter((a) => ids.has(a.id) && !a.estGenerique && !P.codesDe(a).length && !avecPrix.has(a.id) && !parNom.has(a.id));
  for (const a of aReparer) {
    const nom = analyserIngredient(a.nom)?.nom;
    if (nom && nom.length >= 2 && nom !== a.nom) {
      const propre = nom.replace(/^./, (c) => c.toUpperCase());
      S.maj((x) => { const y = x.articles.find((z) => z.id === a.id); if (y) y.nom = propre; });
    }
    rechercherNouvelle(S.get().articles.find((z) => z.id === a.id));
  }
}

/** Dépose la demande (synchronisée vers l'ordinateur) ; null si le téléphone n'est pas relié à ton foyer. */
function deposerRecherche(q, articleId = null) {
  if (!Sync.estPret()) return null;
  // v138 : accents manquants remis avant l'envoi (« tourtiere » → « tourtière ») ; certains sites ne trouvent rien sans eux
  q = restaurerAccents(q, vocabAccents());
  const r = { ...RB.nouvelleRecherche(q, S.uid('rch')), ...(articleId ? { articleId, but: 'nom' } : {}) };   // articleId : la fiche à compléter
  S.maj((e) => {
    const vieilles = new Set(RB.aRetirer(e.recherches));
    e.recherches = (e.recherches || []).filter((x) => !vieilles.has(x.id));
    e.recherches.push(r);
  });
  return r;
}

function suivreRecherche(id, quantite) {
  arreterRechercheVue();
  let avant = null;
  const dessiner = () => {
    const boite = $('#rbZone');
    const r = (S.get().recherches || []).find((x) => x.id === id);
    if (!boite || !r) return;
    const empreinte = JSON.stringify(r.bannieres || {});
    if (empreinte === avant) return;
    avant = empreinte;
    // v138 : seulement les produits qui parlent de ce que tu as écrit ; en tête, « toutes sortes » (le moins cher de chaque bannière)
    const groupes = RB.choixPresentes(r, r.q).slice(0, 8);
    const gen = groupes.length >= 2 ? RB.moinsCherParBanniere(r, r.q) : [];
    boite.innerHTML = htmlRechercheBannieres(r, groupes, gen);
    $$('[data-rb]', boite).forEach((b) => b.onclick = () => { terminerSaisie(); ajouterDepuisBannieres(groupes[Number(b.dataset.rb)], quantite); });
    const bg = $('[data-rbgen]', boite);
    if (bg) bg.onclick = () => { terminerSaisie(); ajouterGeneriqueDepuisBannieres(r.q, gen, quantite); };
  };
  rechercheVue = { id, desabonner: S.abonner(dessiner) };
  dessiner();
  // « Ton ordinateur ne répond pas encore » : redessiné une fois après 90 s si rien n'est venu
  setTimeout(() => { if (rechercheVue?.id === id) { avant = null; dessiner(); } }, 90000);
}

function htmlRechercheBannieres(r, groupes, gen = []) {
  const av = RB.avancement(r);
  const trouve = RB.ORDRE.filter((b) => av.etats[b] === 'fait').length;
  // Roue qui tourne : la recherche de cette bannière est en cours (ou attend l'ordinateur)
  const ROUE = '<i class="rb-roue" aria-hidden="true"></i>';
  const icones = { attente: ROUE, fait: '✓', rien: '—', bloque: '⚠', erreur: '⚠' };
  const titres = { attente: 'recherche…', fait: 'trouvé', rien: 'rien trouvé', bloque: 'le site demande une vérification', erreur: 'erreur' };
  const silence = !av.fait && Date.now() - Date.parse(r.le) > 80000;
  const chip = (o) => `<span class="rb-chip${o.regulier ? ' r' : ''}">${esc(nomBanniere(o.banniere))} ${esc(argent(o.prix))}${o.regulier ? ' · rabais' : ''}</span>`;
  return `<div class="rb-titre"><span>Chez tes bannières · ton Chrome</span><span>${av.fait < av.total ? `${ROUE} recherche… ${av.fait} sur ${av.total}` : `${trouve} sur ${av.total}`}</span></div>
    <div class="rb-etats">${RB.ORDRE.map((b) => `<span class="rb-e ${av.etats[b]}" title="${esc(titres[av.etats[b]])}">${icones[av.etats[b]]} ${esc(nomBanniere(b))}</span>`).join('')}</div>
    ${silence ? '<div class="rb-note">Ton ordinateur n\'a pas encore répondu : la recherche se fera dès que Chrome y sera ouvert.</div>' : ''}
    ${gen.length ? `<button class="sugg" data-rbgen="1"><span class="vignette petite" style="display:grid;place-items:center;font-size:20px">🛒</span>
        <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">${esc(r.q.replace(/^./, (c) => c.toUpperCase()))} · toutes sortes</span>
        <span class="doux une-ligne" style="display:block;font-size:12px">Le moins cher de chaque bannière · ${gen.length} bannière${gen.length > 1 ? 's' : ''}</span>
        <span class="rb-chips">${gen.map((o) => chip(o)).join('')}</span></span>
        <span class="rb-px">${esc(argent(gen[0].prix))}<small>${esc(nomBanniere(gen[0].banniere))}</small></span></button>` : ''}
    ${groupes.map((g, i) => {
      const m = g.meilleur;
      return `<button class="sugg" data-rb="${i}">${g.image ? `<img class="vignette petite" src="${esc(g.image)}" alt="">` : '<span class="vignette petite"></span>'}
        <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">${esc(g.nom)}</span>
        <span class="doux une-ligne" style="display:block;font-size:12px">${esc([g.format, `${g.offres.length} bannière${g.offres.length > 1 ? 's' : ''}`].filter(Boolean).join(' · '))}</span>
        <span class="rb-chips">${g.offres.map(chip).join('')}</span></span>
        <span class="rb-px">${esc(argent(m.prix))}<small>${esc(nomBanniere(m.banniere))}${m.regulier ? `, rég. ${esc(argent(m.regulier))}` : ''}</small></span></button>`;
    }).join('')}`;
}

/** Produit choisi chez les bannières → fiche (ou fiche existante au même code-barres) + un prix par bannière. */
function ajouterDepuisBannieres(g, quantite = 1) {
  const f = RB.ficheDuGroupe(g);
  const codes = f.codes.flatMap(gtinVariantes);
  let a = codes.length ? S.get().articles.find((x) => (x.codes || []).some((c) => codes.includes(c))) : null;
  if (!a) {
    a = { id: S.uid('a'), nom: f.nom, marque: f.marque, rayonId: rayonParDefaut(), uniteRef: f.uniteRef, format: f.format,
      local: f.local, codes, imageUrl: f.imageUrl };
    const nouveau = a;
    S.maj((e) => e.articles.push(nouveau));
  }
  const prix = RB.prixDuGroupe(g, a.id);
  S.maj((e) => e.prix.push(...prix));
  ajouterALaListe(a.id, quantite);
  toast(`${a.nom} ajouté · prix de ${prix.length} bannière${prix.length > 1 ? 's' : ''}`);
  montrerAjout(a.id);
}

/** v138 — « Toutes sortes » : fiche à ton nom (sans marque ni format) + le moins cher de chaque bannière. */
function ajouterGeneriqueDepuisBannieres(q, offres, quantite = 1) {
  const a = assurerArticle(q, { uniteRef: RB.uniteGenerique(offres) });
  const prix = RB.prixGenerique(offres, a.id, jourQuebec());
  S.maj((e) => {
    e.prix.push(...prix);
    const ar = e.articles.find((x) => x.id === a.id);
    if (ar) ar.prixVerifieLe = jourQuebec();
  });
  ajouterALaListe(a.id, quantite);
  toast(`${a.nom} (toutes sortes) ajouté · le moins cher chez ${prix.length} bannière${prix.length > 1 ? 's' : ''}`);
  montrerAjout(a.id);
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


/**
 * Suggestions pendant la frappe (maquette recherche-niveaux-v2) : TA BASE seulement, en arborescence
 * niveau 1 (générique) → niveau 2 (sorte) → niveau 3 (tes fiches), puis « Mon nom tel quel ».
 * Aucune recherche en ligne ici : la vérification des prix se fait une fois le produit ajouté.
 * Retourne [{ nom }] (le premier sert à compléter le mot dans le champ).
 */
function suggerer(txt) {
  const zone = $('#suggestions');
  const tapeNom = txt.replace(/^\d+(?:[.,]\d+)?\s*(?:x\s*)?/i, '');
  const q = sansAccents(tapeNom);
  if (!zone || q.length < 2) { masquerSuggestions(); return []; }
  const e = S.get();
  const src = sourcesRattachement();
  const achats = (id) => e.liste.filter((l) => l.articleId === id).length + (e.achats?.filter((x) => x.articleId === id).length || 0);
  const pertFiche = (a) => {
    const pn = pertinenceNoms(a, tapeNom);
    if (pn) return pn;
    return P.variantesActives(a).some((v) => sansAccents(`${v.marque || ''} ${v.nom || ''}`).includes(q)) || sansAccents(a.marque || '').includes(q) ? 0.5 : 0;
  };
  const rangees = construireArbre(e.articles, tapeNom, { famille: (a) => familleDe(a), referentiel: src?.generiques || {},
    alternatifs: src?.alternatifs || {}, pertinenceFiche: pertFiche, poids: (a) => achats(a.id), max: 14 });
  const quantite = () => { const r = txt.match(/^(\d+(?:[.,]\d+)?)/); return r ? Number(r[1].replace(',', '.')) : 1; };
  // Prix d'une rangée : le moins cher connu (au kg / L, rabais inclus) parmi ses fiches
  const prixRangee = (r) => {
    const offres = r.articles.map((a) => meilleureOffre(a)).filter((m) => m?.pu != null);
    const unite = offres[0]?.uniteRef;
    return offres.filter((m) => m.uniteRef === unite).sort((x, y) => x.pu - y.pu)[0] || null;
  };
  const exact = e.articles.some((a) => sansAccents(a.nom) === q) || rangees.some((r) => sansAccents(r.nom) === q);
  zone.innerHTML = (rangees.length ? '<div class="rb-titre"><span>Dans ta base</span><span>derniers prix connus</span></div>' : '')
    + rangees.map((r, i) => {
      const m = prixRangee(r);
      const n = r.articles.length;
      const a = r.article;
      const photo = a ? photoDe(a) : photoDe({ generique: r.g, sorte: r.s });
      const detail = r.niveau === 1 ? `Toutes sortes · ${n} produit${n > 1 ? 's' : ''}`
        : r.niveau === 2 ? `Toutes marques · ${n} produit${n > 1 ? 's' : ''}`
        : [a.marque, formatLisible(a.format)].filter(Boolean).join(' · ') || (m ? nomOffre(m) : '');
      const decale = r.niveau === 3 && r.orpheline ? 0 : r.niveau === 3 ? (r.sousSorte ? 2 : 1) : r.niveau - 1;
      return `<button class="sugg arbre d${decale}" data-arbre="${i}"><span class="niv n${r.niveau}" title="Niveau ${r.niveau}">${r.niveau}</span>
        ${photo ? `<img class="vignette petite" src="${esc(photo)}" alt="">` : '<span class="vignette petite"></span>'}
        <span class="grandir" style="min-width:0"><span class="sugg-nom">${esc(r.nom)}</span>
        ${detail ? `<span class="doux sugg-detail">${esc(detail)}</span>` : ''}</span>
        <span class="doux sugg-px">${m ? `${esc(libelleUnitaire(m.pu, m.uniteRef).split(' · ')[0])}${String(nomOffre(m)).split(' · ').map((x) => `<small>${esc(x)}</small>`).join('')}` : ''}</span></button>`;
    }).join('')
    + (exact ? '' : `<button class="sugg arbre tel-quel" data-telquel="1"><span class="niv">✎</span><span class="vignette petite" style="display:grid;place-items:center">＋</span>
      <span class="grandir" style="min-width:0"><span class="une-ligne" style="display:block">Mon nom tel quel : « ${esc(tapeNom.trim())} »</span>
      <span class="doux une-ligne" style="display:block;font-size:12px">l'ajouter dans Prépa, puis chercher chez les bannières</span></span></button>`);
  zone.classList.remove('cache');
  $$('[data-arbre]', zone).forEach((b) => b.onclick = () => {
    const r = rangees[Number(b.dataset.arbre)];
    terminerSaisie();
    let id = r.article?.id || r.generiqueId;
    if (!id) {   // niveau 1 ou 2 choisi pour la première fois : fiche générique (son prix = le moins cher de ses fiches)
      const g = nouvelleFicheGenerique(r, S.uid('a'));
      S.maj((x) => x.articles.push(g));
      id = g.id;
    }
    ajouterALaListe(id, quantite());
    toast(`${S.get().articles.find((a) => a.id === id).nom} ajouté`);
    montrerAjout(id);
  });
  const tq = $('[data-telquel]', zone);
  if (tq) tq.onclick = () => { terminerSaisie(); ajouterTelQuel(txt); };
  return rangees.map((r) => ({ nom: r.nom }));
}

/** « Mon nom tel quel » : fiche à ce nom (existante au même nom, sinon nouvelle) ajoutée tout de suite ; une nouvelle fiche
 *  lance la recherche chez tes bannières (l'ordinateur répond en arrière-plan). */
function ajouterTelQuel(txt) {
  const { quantite, nom } = decouperSaisie(txt)[0] || {};
  if (!nom) return;
  const existant = S.get().articles.find((a) => sansAccents(a.nom) === sansAccents(nom));
  const a = existant || creerArticle(nom);
  if (!existant) deposerRecherche(nom, a.id);
  ajouterALaListe(a.id, quantite);
  toast(`${a.nom} ajouté`);
  montrerAjout(a.id);
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
        <div class="grandir"><div class="nom">${esc(P.libelleVariante(v, a))}</div>
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

// --- Spec v1.1 : Meilleurs choix (S10), Remplacement accepté (S11), Caractéristiques (S8) ---
function htmlMeilleursChoix(a) {
  const regle = remplacementDe(a, S.get().utilisateur);
  const rangs = meilleursChoix(offresArticle(a), { prefId: P.variantePref(a)?.id || null, variantes: P.variantesActives(a), regle });
  if (rangs.every((r) => !r.offre)) return '';
  return `<h3>Meilleurs choix <span class="doux">· ${esc(REMPLACEMENTS.find((x) => x.k === regle).nom.toLowerCase())}</span></h3>
    <div class="mc">${rangs.map((r) => `<div class="mc-rang${r.offre ? '' : ' mc-vide'}">
      <div class="mc-lib">${r.libs.map((x) => `<b>${esc(x)}</b>`).join('')}</div>
      ${r.offre ? `<div class="mc-quoi">${r.offre.produitOffre ? `${logo(r.offre.banniere)} <span class="doux">${esc(r.offre.produitOffre)}</span>` : logoVille(r.offre.banniere)}</div>
      <div class="mc-prix${r.offre.economie ? ' rabais' : ''}">${esc(libelleUnitaire(r.offre.pu, r.offre.uniteRef).split(' · ')[0])}${r.ecart ? `<small>+${esc(argent(r.ecart))} de plus</small>` : ''}</div>`
        : `<div class="mc-quoi doux">${esc(r.vide)}</div>`}
    </div>`).join('')}</div>`;
}
// Maquette fiche v107 : les caractéristiques ajoutées sont toujours visibles ; le repliable sert seulement à en ajouter.
// Aucune n'est obligatoire et une absente n'est jamais « à compléter » (spec v1.3, S8 et S15).
function htmlCaracListe(a) {
  const liste = caracteristiques(a);
  return liste.length ? `<div class="carac-titre">Caractéristiques</div>${liste.map((c) => `<div class="carac-rang"><span class="doux">${esc(c.nom)}</span>
      <select data-carac="${c.k}" aria-label="${esc(c.nom)}">${attributDe(c.k).vals.map((v) => `<option ${v === c.valeur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <button class="icone" data-carac-retirer="${c.k}" title="Retirer ${esc(c.nom)}" aria-label="Retirer ${esc(c.nom)}">✕</button></div>`).join('')}` : '';
}
function htmlCaracAjout(a, nouvel = '') {
  const libres = DICO_ATTRIBUTS.filter((d) => !a.caracteristiques?.[d.k]);
  const nouv = attributDe(nouvel);
  return libres.length ? `<div class="rang envelopper"><select id="caracAjout" aria-label="Ajouter une caractéristique"><option value="">Choisir…</option>${libres.map((d) => `<option value="${d.k}" ${d.k === nouvel ? 'selected' : ''}>${esc(d.nom)}</option>`).join('')}</select>
      ${nouv ? `<select id="caracValeur" aria-label="Valeur de ${esc(nouv.nom)}"><option value="">Choisir la valeur…</option>${nouv.vals.map((v) => `<option>${esc(v)}</option>`).join('')}</select>` : ''}</div>` : '';
}
function brancherCaracteristiques(c, articleId) {
  const boite = $('#fCarac', c);
  if (!boite) return;
  const article = () => S.get().articles.find((x) => x.id === articleId);
  const redessiner = (nouvel = '') => {
    const a = article(); if (!a) return;
    $('#fCaracListe', c).innerHTML = htmlCaracListe(a);
    const ajout = htmlCaracAjout(a, nouvel);
    $('#fCaracCorps', c).innerHTML = ajout;
    $('#fCaracAjouter', c).hidden = !ajout;
  };
  const changer = (fn) => S.maj((x) => { const ar = x.articles.find((i) => i.id === articleId); if (ar) fn(ar); });
  boite.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.carac) changer((ar) => definirCaracteristique(ar, t.dataset.carac, t.value));
    else if (t.id === 'caracAjout') redessiner(t.value);
    else if (t.id === 'caracValeur' && t.value) { const k = $('#caracAjout', c).value; changer((ar) => definirCaracteristique(ar, k, t.value)); redessiner(); }
  });
  boite.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-carac-retirer]');
    if (b) { changer((ar) => retirerCaracteristique(ar, b.dataset.caracRetirer)); redessiner(); }
  });
  $('#fRempl', c)?.addEventListener('change', (ev) => {
    changer((ar) => definirRemplacement(ar, S.get().utilisateur, ev.target.value));
    const a = article();
    $('#fRemplDefaut', c).hidden = ev.target.value !== REMPLACEMENT_DEFAUT;
    if (a) $('#fChoix', c).innerHTML = htmlMeilleursChoix(a);
  });
}

// --- Photo du produit (maquette fiche v102) ---------------------------------
// Le lien ouvre la page du fabricant ou de l'épicier ; Chris colle l'image ; « Enregistrer » l'envoie « à traiter ».
// L'agent du PC retire le fond, met au carré 512 sur blanc pur, retouche doucement, puis la range.
const ETATS_PHOTO = { a_traiter: 'En préparation : l’ordinateur retire le fond et la met à nos standards.',
  a_detourer: 'En préparation : le fond n’est pas uni, le détourage se fait à part.', approuvee: 'Photo pro en place.' };
const ETAT_MAISON = 'Ta photo, mise à nos standards. Colle une photo de la marque ou de l’épicier pour la remplacer.';
function htmlPhotoProduit(a) {
  const et = etatPhotoPro(a.id);
  const lien = a.lienPhoto || et?.page || '';
  return `<h3 style="margin-top:14px">Photo du produit</h3>
    <div class="champ"><label for="fLienPhoto">Lien de la photo</label>
      <div class="rang"><input id="fLienPhoto" class="grandir" type="url" inputmode="url" value="${esc(lien)}" placeholder="Page du produit (fabricant ou épicier)">
      <a class="btn sec" id="fOuvrirLien" href="${esc(lien || '#')}" target="_blank" rel="noopener" style="padding:6px 10px">Ouvrir ↗</a></div></div>
    <div class="coller" id="fColler" tabindex="0" role="button" aria-label="Coller une image ou choisir une photo">Colle l’image ici (Ctrl+V)<br>ou touche pour choisir une photo</div>
    <input type="file" id="fCollerFichier" accept="image/*" hidden>
    <button type="button" class="btn sec" id="fMaPhoto" style="width:100%;margin-top:6px">📷 Pas de photo de la marque ? Prends la tienne</button>
    <input type="file" id="fMaPhotoFichier" accept="image/*" capture="environment" hidden>
    <div class="doux" id="fEtatPhoto" style="margin-top:4px">${et ? esc(et.statut === 'approuvee' && et.source === 'maison' ? ETAT_MAISON : ETATS_PHOTO[et.statut] || '') : ''}</div>`;
}
/** Branche la zone de collage ; rend une fonction qui donne l'image en attente (Blob) ou null, et .maison() : vrai si c'est ta photo. */
function brancherPhotoProduit(c, articleId) {
  let image = null, maison = false;
  const zone = $('#fColler', c), etat = $('#fEtatPhoto', c);
  if (!zone) return () => null;
  const prendre = (f) => {
    if (!f || !f.type?.startsWith('image/')) return;
    image = f; maison = false;
    const url = URL.createObjectURL(f);
    zone.innerHTML = `<img src="${url}" alt="Image collée">`;
    etat.textContent = 'Image prête : touche Enregistrer pour l’envoyer.';
  };
  // Option B : ta photo, en dernier recours ; mise à nos standards (fond retiré, carré blanc) avant d'être affichée
  $('#fMaPhoto', c).onclick = () => {
    if (!photoMaisonPermise(articleId)) { etat.textContent = 'Ce produit a déjà une photo de la marque ou de l’épicier : ta photo ne la remplace pas.'; return; }
    $('#fMaPhotoFichier', c).click();
  };
  $('#fMaPhotoFichier', c).onchange = (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    prendre(f); maison = true;
    etat.textContent = 'Ta photo est prête : touche Enregistrer. Conseil : de face, sur un comptoir uni, sans reflet.';
  };
  zone.onclick = () => $('#fCollerFichier', c).click();
  zone.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#fCollerFichier', c).click(); } };
  $('#fCollerFichier', c).onchange = (ev) => prendre(ev.target.files[0]);
  zone.ondragover = (ev) => { ev.preventDefault(); zone.classList.add('actif'); };
  zone.ondragleave = () => zone.classList.remove('actif');
  zone.ondrop = (ev) => { ev.preventDefault(); zone.classList.remove('actif'); prendre(ev.dataTransfer.files[0]); };
  c.addEventListener('paste', (ev) => {
    const f = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (f) { ev.preventDefault(); prendre(f); }
  });
  $('#fLienPhoto', c).oninput = (ev) => { $('#fOuvrirLien', c).href = ev.target.value.trim() || '#'; };
  $('#fOuvrirLien', c).onclick = (ev) => { if (!$('#fLienPhoto', c).value.trim()) ev.preventDefault(); };
  const lire = () => image;
  lire.maison = () => maison;
  return lire;
}

// --- Maquette fiche v104 : confirmer soi-même ce qui ne l'est pas -------------------
const BANNIERES_FICHE = () => Object.keys(BANNIERES).filter((b) => banniereActive(b));
function htmlAConfirmer(a, e) {
  const k = P.aConfirmer(a, e, BANNIERES_FICHE());
  const sansCode = !P.codesDe(a).length && !a.plu?.length;
  const parts = [];
  if (k.seul) parts.push(`<label class="conf"><input type="checkbox" data-conf-seul="${esc(k.seul)}"> C'est normal : je l'achète seulement chez ${esc(nomBanniere(k.seul))}</label>`);
  if (k.sansPrix.length) parts.push(`<details class="conf"><summary>Aucun prix chez ${k.sansPrix.length} bannière(s) : coche celles qui ne vendent pas ce produit</summary>
    ${k.sansPrix.map((b) => `<label class="conf"><input type="checkbox" data-conf-exclure="${esc(b)}"> ${esc(nomBanniere(b))}</label>`).join('')}</details>`);
  if (k.exclues.length) parts.push(`<div class="doux conf">Ne vendent pas : ${k.exclues.map((b) => esc(nomBanniere(b))).join(', ')} <a href="#" data-conf-exclure-annuler>Annuler</a></div>`);
  if (sansCode) parts.push(`<div class="rang conf"><input id="fConfCode" class="grandir" inputmode="numeric" placeholder="PLU (4011) ou code-barres" aria-label="PLU ou code-barres"><button class="btn sec" id="fConfCodeOk" style="padding:5px 10px">Ajouter</button></div><div class="doux" id="fConfCodeMsg"></div>`);
  return parts.length ? `<div class="conf-bloc">${parts.join('')}</div>` : '';
}
function brancherAConfirmer(c, articleId, rouvrir) {
  const changer = (fn, msg) => { S.maj((x) => { const ar = x.articles.find((i) => i.id === articleId); if (ar) fn(ar); }); if (msg) toast(msg); rouvrir(); };
  // S16 : ignorer un avertissement pour ce produit (historique + Rétablir)
  $$('[data-ignorer]', c).forEach((l) => { l.onclick = (ev) => { ev.preventDefault();
    const quand = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }), par = S.get().utilisateur || '';
    changer((ar) => { ar.santeIgnores = { ...(ar.santeIgnores || {}), [l.dataset.ignorer]: { le: quand, par } }; }, 'Ignoré pour ce produit : voir l’historique pour le rétablir'); }; });
  $$('[data-retablir]', c).forEach((l) => { l.onclick = (ev) => { ev.preventDefault();
    changer((ar) => { const g = { ...(ar.santeIgnores || {}) }; delete g[l.dataset.retablir]; if (Object.keys(g).length) ar.santeIgnores = g; else delete ar.santeIgnores; }, 'Rétabli'); }; });
  $$('[data-conf-seul]', c).forEach((i) => { i.onchange = () => changer((ar) => { ar.seulChez = i.dataset.confSeul; }, 'Noté : un seul magasin pour ce produit'); });
  $$('[data-conf-exclure]', c).forEach((i) => { i.onchange = () => changer((ar) => { ar.pasVenduChez = [...new Set([...(ar.pasVenduChez || []), i.dataset.confExclure])]; }); });
  $('[data-conf-exclure-annuler]', c)?.addEventListener('click', (ev) => { ev.preventDefault(); changer((ar) => { delete ar.pasVenduChez; }); });
  $('#fConfCodeOk', c)?.addEventListener('click', () => {
    const a = S.get().articles.find((x) => x.id === articleId);
    const r = P.codeSaisi($('#fConfCode', c).value, a);
    if (r.erreur) { $('#fConfCodeMsg', c).textContent = r.erreur; return; }
    if (r.code) {
      const ailleurs = P.varianteParCode(S.get(), r.code);
      if (ailleurs && ailleurs.article.id !== articleId) { $('#fConfCodeMsg', c).textContent = `Ce code appartient déjà à « ${ailleurs.article.nom} »`; return; }
    }
    changer((ar) => { if (r.plu) ar.plu = [...new Set([...(ar.plu || []), r.plu])]; else ar.codes = [...new Set([...(ar.codes || []), ...gtinVariantes(r.code)])]; },
      r.plu ? `PLU ${r.plu} ajouté` : 'Code-barres ajouté');
  });
}

// --- Fiche article ----------------------------------------------------
export function ficheArticle(articleId, ligneId) {
  const choix = choixNomDe(articleId);   // v120 : les bannières ont répondu pour ton nom → d'abord le choix
  if (choix) { ouvrirChoixNom(choix.id); return; }
  const e = S.get();
  const a = e.articles.find((x) => x.id === articleId);
  if (!a) return;
  const l = e.liste.find((x) => x.id === ligneId);
  const photos = e.photos.filter((p) => p.articleId === a.id);
  ouvrirModale(a.nom, `
    ${a.exclusif ? `<div class="alerte ambre">Vendu seulement chez <b>${esc(nomBanniere(a.exclusif))}</b> : les autres bannières sont ignorées pour ce produit.</div>` : ''}
    <button class="btn ${a.codes?.length ? 'sec' : ''}" id="fScan" style="width:100%;margin-bottom:10px">▥ Scanner le code-barres</button>
    <p class="doux" style="margin:-4px 0 10px">Remplit la fiche : nom, marque, format, catégorie, photo et prix.</p>
    ${(() => { const c = P.completude(a, e, { nomBanniere, photo: (x) => aPhotoPro(x.id) }); const k = htmlAConfirmer(a, e);
      // S16 : chaque avertissement peut être ignoré pour ce produit ; il va dans l'historique (replié), d'où on le rétablit
      const ign = (cle, texte) => `<a href="#" class="ignorer" data-ignorer="${esc(cle)}" data-texte="${esc(texte)}" title="Ne plus compter ce point pour ce produit">Ignorer</a>`;
      const histo = c.ignorees.length ? `<details class="histo-ign"><summary>Historique · ${c.ignorees.length} ignoré${c.ignorees.length > 1 ? 's' : ''}</summary>
        ${c.ignorees.map((x) => `<div class="ign-ligne"><s>${esc(x.texte)}</s> <span class="doux">· ignoré le ${esc(x.le || '')}${x.par ? ` par ${esc(x.par)}` : ''}</span> <a href="#" data-retablir="${esc(x.cle)}">Rétablir</a></div>`).join('')}</details>` : '';
      return c.manquants.length || c.alertes.length || k
      ? `<div class="alerte ambre" style="margin-bottom:10px">${c.manquants.length || c.alertes.length ? `À compléter (${c.ok}/${c.total}) : ${c.manquants.map((m) => `${m.icone} ${esc(m.texte)} ${ign(m.cle, `${m.icone} ${m.texte} manquant`)}`).join(' · ')}${c.alertes.map((t) => `<br>⚠️ ${esc(t)} ${ign(P.cleAvert(t), t)}`).join('')}` : ''}${k}${histo}</div>`
      : histo ? `<div class="doux" style="margin-bottom:10px">${histo}</div>` : ''; })()}
    ${htmlDernierAchat(l?.recu?.absent ? null : (l?.recu || a.dernierAchat), a.id)}
    ${l?.recu?.absent ? `<div class="alerte" style="margin-bottom:10px">🧾 Ce produit n'est pas sur la facture du ${esc(l.recu.date || '')}${l.recu.banniere ? ` (${esc(nomBanniere(l.recu.banniere))})` : ''}.</div>` : ''}
    ${htmlAchats(a.id)}
    <div id="fChoix">${htmlMeilleursChoix(a)}</div>
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
    ${(() => { const r = remplacementDe(a, e.utilisateur); return `<div class="champ"><label for="fRempl">Remplacement accepté <span class="doux" id="fRemplDefaut" ${r === REMPLACEMENT_DEFAUT ? '' : 'hidden'}>(défaut)</span> <span class="pastille">pour toi seulement</span></label>
      <select id="fRempl">${REMPLACEMENTS.map((x) => `<option value="${x.k}" ${x.k === r ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></div>`; })()}
    <div id="fCarac" class="carac"><div id="fCaracListe">${htmlCaracListe(a)}</div>
      ${(() => { const ajout = htmlCaracAjout(a); return `<details id="fCaracAjouter" ${ajout ? '' : 'hidden'}><summary class="btn sec" style="display:inline-block">+ Ajouter une caractéristique</summary>
      <div id="fCaracCorps" style="margin-top:8px">${ajout}</div></details>`; })()}</div>
    ${l ? `
    <div class="champ"><label>Note</label><input id="fNote" value="${esc(l.note || '')}" placeholder="ex. sans lactose, gros format"></div>` : ''}
    ${l ? `<div class="doux">Ajouté à la liste par <b>${esc(l.ajoutePar || '?')}</b>${l.cree ? ` le ${esc(new Date(l.cree).toLocaleDateString('fr-CA'))}` : ''}</div>` : ''}
    ${a.codes?.length
      ? `<div class="doux">Codes-barres : ${a.codes.map(esc).join(', ')}${a.codeSource === 'en ligne' ? ' <span class="pastille ambre">trouvé en ligne — vérifie en scannant le produit</span>' : ''}</div>`
      : `<div class="alerte" style="margin-top:8px">▥ <b>Pas de code-barres pour ce produit.</b> ${a.codesProposes?.length ? 'Codes possibles trouvés en ligne (vérifie la marque et le format) :' : a.codeCherche ? 'Rien de sûr trouvé en ligne.' : ''} Tu peux aussi le scanner (bouton ▥ en haut).
          ${(a.codesProposes || []).map((h) => `<button class="btn sec" data-code="${esc(h.code)}" style="width:100%;margin-top:6px;text-align:left">+ ${esc(h.code)} — ${esc([h.marque, h.nom, h.format].filter(Boolean).join(' · '))}</button>`).join('')}</div>`}
    ${htmlPhotoProduit(a)}
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
    const imageCollee = brancherPhotoProduit(c, a.id);
    $('#fSauver', c).onclick = () => {
      const lienPhoto = $('#fLienPhoto', c)?.value.trim() || '';
      const image = imageCollee();
      if (image) {
        const source = imageCollee.maison() ? 'maison' : 'chris';
        Sync.envoyerPhotoCollee(a.id, image, lienPhoto, source).then((r) => {
          if (r.ok) { marquerPhotoEnvoyee(a.id, lienPhoto, source); toast('Photo envoyée : l’ordinateur la prépare'); }
          else toast(`Photo non envoyée : ${r.erreur}`);
        });
      }
      S.maj((x) => {
        const ar = x.articles.find((i) => i.id === a.id);
        ar.nom = $('#fNom', c).value.trim() || ar.nom; ar.uniteRef = $('#fUnite', c).value;
        // Rayon changé à la main → verrouillé : l'app ne le modifiera plus jamais automatiquement
        const rv = $('#fRayon', c).value;
        if (rv !== '+' && rv !== ar.rayonId) { ar.rayonId = rv; ar.rayonManuel = true; }
        ar.format = $('#fFormat', c).value.trim(); ar.local = $('#fLocal', c).value === '1';
        ar.exclusif = $('#fExclusif', c).value || null;
        if (lienPhoto) ar.lienPhoto = lienPhoto; else delete ar.lienPhoto;
        const li = x.liste.find((i) => i.id === ligneId);
        if (li) li.note = $('#fNote', c).value.trim();
      });
      fermerModale(); toast('Enregistré');
    };
    $('#fPhoto', c).onclick = () => photoProduit(a.id);
    brancherCaracteristiques(c, a.id);
    brancherAConfirmer(c, a.id, () => ficheArticle(articleId, ligneId));
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

// --- Maquette magasins-v2 (accord de Chris, 23 nov. 2026) ---
// Tri « Par proximité » / « Par bannière » ; ✕ = retirer de ma liste (m.retire : la base garde ses prix et continue
// d'en noter) ; « Ajouter un magasin » : bannière tapée → succursales à moins de 100 km (OpenStreetMap), de la plus
// proche à la plus loin ; Secteurs tout en bas.
const CLE_TRI_MAG = 'epicerie.triMagasins', CLE_ORIGINE_MAG = 'epicerie.origineMagasins';
const rechMag = { txt: '', saisie: null, res: [], montres: 10, message: '' };
const lireLocal = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const ecrireLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sans effet */ } };
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) return null;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const km = (d) => (d == null ? '' : `${d.toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`);

/** Point de départ des distances : ma position (si choisie) sinon le premier secteur, situé une fois (gardé sur ce téléphone). */
async function origineMagasins() {
  const o = lireLocal(CLE_ORIGINE_MAG);
  const s = S.get().codesPostaux[0];
  if (o?.mode === 'position' || (o && s && o.cle === s.code)) return o;
  if (!s) return null;
  try {
    const p = new URLSearchParams({ q: `${s.libelle || s.code}, Québec, Canada`, format: 'jsonv2', limit: 1, countrycodes: 'ca' });
    const j = await (await fetch(`https://nominatim.openstreetmap.org/search?${p}`)).json();
    if (!j[0]) return null;
    const n = { mode: 'secteur', cle: s.code, nom: estFsa(s.code) ? `${s.libelle} (${s.code})` : (s.libelle || s.code), lat: Number(j[0].lat), lng: Number(j[0].lon) };
    ecrireLocal(CLE_ORIGINE_MAG, n);
    return n;
  } catch { return null; }
}

function vueMagasins(v) {
  const e = S.get();
  const tri = lireLocal(CLE_TRI_MAG) === 'banniere' ? 'banniere' : 'proximite';
  const orig = lireLocal(CLE_ORIGINE_MAG);
  const mags = e.magasins.filter((m) => !m.retire).map((m) => ({ m, d: distanceKm(orig, m) }));
  const parDistance = (a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || a.m.nom.localeCompare(b.m.nom);
  mags.sort(parDistance);
  const ligne = ({ m, d }) => {
    const rp = e.rabaisPerso.find((r) => r.magasinId === m.id && r.actif);
    const actif = m.actif !== false;
    const sous = [km(d), villeMagasin(m), actif ? '' : 'ignoré'].filter(Boolean).join(' · ');
    return `<div class="mag-ligne ${actif ? '' : 'inactif'}">
      <label class="interrupteur" title="${actif ? 'Considéré dans les comparaisons' : 'Ignoré (pas supprimé)'}"><input type="checkbox" data-actif="${m.id}" ${actif ? 'checked' : ''}><span></span></label>
      <button class="grandir nom-mag" data-magfiche="${m.id}"><span class="une-ligne" style="display:block">${logoMagasin(m)}${rp ? ' <span class="pastille vert">%</span>' : ''}</span>${sous ? `<small class="doux mag-sous">${esc(sous)}</small>` : ''}</button>
      <button class="btn-releve" data-releve="${m.id}" aria-label="Relevé de prix">🏷️</button>
      <button class="btn-retirer-mag" data-retirermag="${m.id}" aria-label="Retirer de ma liste">✕</button></div>`;
  };
  let liste = '';
  if (tri === 'banniere') {
    const groupes = new Map();
    for (const x of mags) { const k = x.m.banniere || '?'; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(x); }
    for (const [k, g] of groupes) liste += `<h3 class="titre-cp">${esc(nomBanniere(k))} (${g.length})</h3>${g.map(ligne).join('')}`;
  } else liste = mags.map(ligne).join('');
  v.innerHTML = `<h2 style="margin-top:0">Mes magasins</h2>
    <div class="seg-tri" role="group" aria-label="Affichage"><button data-tri="proximite" class="${tri === 'proximite' ? 'actif' : ''}">Par proximité</button><button data-tri="banniere" class="${tri === 'banniere' ? 'actif' : ''}">Par bannière</button></div>
    <div class="mag-ligne" style="margin-bottom:6px">
      <label class="interrupteur" title="Distances depuis ma position"><input type="checkbox" id="mMaPosition" ${orig?.mode === 'position' ? 'checked' : ''}><span></span></label>
      <label for="mMaPosition" class="grandir" style="cursor:pointer">📍 Ma position<small class="doux mag-sous" style="display:block">${orig?.mode === 'position' ? 'Distances depuis où tu es' : `Distances depuis ${esc(orig?.nom || 'ton premier secteur')}`}</small></label></div>
    ${liste || '<p class="doux">Aucun magasin. Ajoute-en un plus bas.</p>'}
    <h3 class="titre-cp" style="margin-top:22px">Ajouter un magasin</h3>
    <div class="carte">
      <div class="rang"><input id="mBan" class="grandir" placeholder="Bannière (ex. IGA, Maxi, Costco)" autocomplete="off"><button class="btn" id="mChercher">Chercher</button></div>
      <div class="doux" id="mAutour" style="font-size:13px;margin-top:8px"></div>
      <div id="mResultats"></div></div>
    <div class="carte"><h2>Secteurs</h2>
      <div>${e.codesPostaux.map((c) => `<span class="pastille" style="font-size:13px;padding:4px 10px">${estFsa(c.code) ? `${esc(c.code)} · ${esc(c.libelle)}` : esc(c.libelle || c.code)} <a href="#" data-supcp="${esc(c.code)}" aria-label="Retirer">✕</a></span>`).join(' ')}</div>
      <div class="rang" style="margin-top:8px"><input id="cpCode" class="grandir" placeholder="Ville ou code postal (ex. Beloeil, J3X)"><button class="btn sec" id="cpAjout">Ajouter</button></div></div>`;

  // Point de départ : affiché, et situé au besoin (première fois) ; les distances apparaissent alors
  const autour = () => {
    const o = lireLocal(CLE_ORIGINE_MAG);
    $('#mAutour', v).textContent = `Autour de ${o ? (o.mode === 'position' ? 'ma position' : o.nom) : 'ton premier secteur'}, 100 km`;
    // Interrupteur 📍 Ma position : ON = distances depuis où tu es ; OFF = depuis ton secteur.
    // S'il n'obtient pas la position (refus, délai), il revient à OFF.
    const interr = $('#mMaPosition', v);
    const localiser = () => {
      if (!navigator.geolocation) { toast('Position non disponible sur ce téléphone'); interr.checked = false; return; }
      interr.disabled = true;
      navigator.geolocation.getCurrentPosition((p) => { fermerModale(); ecrireLocal(CLE_ORIGINE_MAG, { mode: 'position', nom: 'ma position', lat: p.coords.latitude, lng: p.coords.longitude }); vueMagasins(v); },
        (err) => {
          interr.disabled = false; interr.checked = false;
          const m = messagePosition(err);
          if (!m.refus) { toast(m.note); return; }
          // Refus retenu par le navigateur : il ne redemandera plus ; on dit où le redonner selon l'appareil
          const etapes = etapesPosition(appareil(navigator.userAgent, navigator.maxTouchPoints));
          ouvrirModale('Position bloquée', `<p class="doux" style="margin-top:0">Tu as refusé l’accès une fois : ton téléphone s’en souvient et ne redemande plus. Aucune page web ne peut ouvrir les Réglages pour toi ; voici où le changer :</p>
            <ol style="padding-left:20px;display:grid;gap:8px;margin:12px 0">${etapes.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
            <div class="rang" style="gap:8px"><button class="btn" id="posReessayer">Réessayer</button><button class="btn sec" id="posSecteur">Garder mon secteur</button></div>`, (c) => {
            $('#posReessayer', c).onclick = () => localiser();
            $('#posSecteur', c).onclick = () => fermerModale();
          });
        }, { maximumAge: 600000, timeout: 15000 });
    };
    interr.onchange = () => {
      if (interr.checked) { localiser(); return; }
      try { localStorage.removeItem(CLE_ORIGINE_MAG); } catch { /* rien */ }
      origineMagasins().then(() => vueMagasins(v));
    };
  };
  autour();
  if (!orig) origineMagasins().then((o) => { if (o && document.body.contains(v)) vueMagasins(v); });
  completerCoordonnees();

  $$('[data-tri]', v).forEach((b) => b.onclick = () => { ecrireLocal(CLE_TRI_MAG, b.dataset.tri); vueMagasins(v); });
  $('#cpAjout', v).onclick = () => {
    const s = secteurDe($('#cpCode', v).value); if (!s) return;
    if (e.codesPostaux.some((c) => c.code === s.code || (!estFsa(c.code) && memeVille(c.code, s.code)))) { toast('Déjà là'); return; }
    S.maj((x) => x.codesPostaux.push(s));
  };
  $$('[data-supcp]', v).forEach((a) => a.onclick = (ev) => {
    ev.preventDefault();
    S.maj((x) => { x.codesPostaux = x.codesPostaux.filter((c) => c.code !== a.dataset.supcp); });
  });
  $$('[data-releve]', v).forEach((b) => b.onclick = () => { ouvrirReleve(b.dataset.releve); allerOnglet('plus'); });
  $$('[data-actif]', v).forEach((i) => i.onchange = () => S.maj((x) => { x.magasins.find((m) => m.id === i.dataset.actif).actif = i.checked; }));
  $$('[data-magfiche]', v).forEach((b) => b.onclick = () => ficheMagasin(b.dataset.magfiche));
  $$('[data-retirermag]', v).forEach((b) => b.onclick = () => retirerMagasin(b.dataset.retirermag));

  // Recherche par bannière (OpenStreetMap), de la plus proche à la plus loin, 100 km.
  // Gardée entre deux affichages (un ajout redessine l'écran) dans rechMag.
  const montrer = () => {
    const { res, montres } = rechMag;
    const zone = document.getElementById('mResultats');
    if (!zone) return;
    const actuels = S.get().magasins.filter((m) => !m.retire);
    zone.innerHTML = res.slice(0, montres).map((r, i) => {
      const deja = actuels.some((m) => (distanceKm(m, r) ?? 99) < 0.15);
      return `<div class="mag-res"><div class="mag-km">${r.d == null ? '' : esc(r.d.toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}<small>km</small></div>
        <div class="grandir" style="min-width:0"><b>${esc(r.nom)}</b><div class="doux" style="font-size:13px">${esc(r.adresse || 'adresse complétée à l’ajout')}</div></div>
        ${deja ? '<span class="mag-deja">✓ Dans ma liste</span>' : `<button class="btn sec" data-ajmag="${i}">Ajouter</button>`}</div>`;
    }).join('')
      + (res.length ? `<p class="doux" style="font-size:13px;margin:8px 0 0">${res.length} à moins de 100 km · ${Math.min(montres, res.length)} plus proches${res.length > montres ? ' · <a href="#" id="mPlus">Voir 10 de plus</a>' : ''}</p>` : '');
    const plus = $('#mPlus', zone);
    if (plus) plus.onclick = (ev) => { ev.preventDefault(); rechMag.montres += 10; montrer(); };
    $$('[data-ajmag]', zone).forEach((b) => b.onclick = async () => { b.disabled = true; await ajouterSuccursale(res[Number(b.dataset.ajmag)]); montrer(); });
  };
  // Message d'état (recherche en cours, rien trouvé…) gardé dans rechMag : il survit à un nouvel affichage de l'écran
  const message = (html) => { rechMag.message = html; const z = document.getElementById('mResultats'); if (z) z.innerHTML = html; };
  const chercher = async () => {
    const txt = ($('#mBan') || $('#mBan', v)).value.trim();
    if (!txt) { toast('Écris une bannière (ex. IGA)'); return; }
    Object.assign(rechMag, { txt, saisie: txt, res: [], montres: 10 });
    message('<p class="doux">Recherche… (jusqu’à 30 secondes)</p>');
    const o = lireLocal(CLE_ORIGINE_MAG) || await origineMagasins();
    if (!o) { message('<p class="doux">Je n’arrive pas à situer ton secteur. Touche « 📍 Ma position ».</p>'); return; }
    let res;
    try { res = await succursalesProches(txt, o); } catch { res = null; }
    if (rechMag.txt !== txt) return;   // une autre recherche a été lancée entre-temps
    if (res == null) { message('<p class="doux">La carte (OpenStreetMap) est saturée en ce moment. Réessaie dans quelques minutes.</p>'); return; }
    if (!res.length) { message(`<p class="doux">Aucun « ${esc(txt)} » à moins de 100 km. Vérifie l’orthographe (ex. Super C, Maxi).</p>`); return; }
    rechMag.message = '';
    rechMag.res = res;
    montrer();
  };
  $('#mChercher', v).onclick = chercher;
  $('#mBan', v).onkeydown = (ev) => { if (ev.key === 'Enter') chercher(); };
  $('#mBan', v).oninput = () => { rechMag.saisie = $('#mBan', v).value; };
  if (rechMag.saisie) $('#mBan', v).value = rechMag.saisie;
  if (rechMag.message) $('#mResultats', v).innerHTML = rechMag.message;
  else if (rechMag.res.length) montrer();
}

/** Clé de bannière connue (« iga », « super_c »…) d'après le texte tapé, sinon une clé simple. */
function cleBanniere(txt) {
  const t = sansAccents(txt).replace(/[^a-z0-9]+/g, ' ').trim();
  const k = Object.keys(BANNIERES).find((x) => sansAccents(BANNIERES[x].nom).replace(/[^a-z0-9]+/g, ' ').trim() === t)
    || Object.keys(BANNIERES).find((x) => sansAccents(BANNIERES[x].nom).startsWith(t));
  return k || t.replace(/\s+/g, '_');
}

/** Succursales d'une bannière à moins de 100 km du point de départ (OpenStreetMap / Overpass, lecture seule). */
async function succursalesProches(txt, o) {
  const motif = txt.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
  const autour = `(around:100000,${o.lat},${o.lng})`;
  const requete = `[out:json][timeout:25];(nwr["shop"]["name"~"^${motif}",i]${autour};nwr["shop"]["brand"~"^${motif}",i]${autour};`
    + `nwr["amenity"="pharmacy"]["name"~"^${motif}",i]${autour};nwr["amenity"="pharmacy"]["brand"~"^${motif}",i]${autour};);out center tags;`;
  // Serveur principal, puis un miroir (12 s chacun au plus) ; sinon, recherche de secours par Nominatim
  let j = null;
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    const arret = new AbortController();
    const minut = setTimeout(() => arret.abort(), 12000);
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: requete }), signal: arret.signal });
      if (r.ok) { j = await r.json(); break; }
    } catch { /* serveur suivant */ } finally { clearTimeout(minut); }
  }
  if (!j) return succursalesNominatim(txt, o);   // Overpass saturé : recherche de secours
  const vus = new Set();
  return (j.elements || []).map((x) => {
    const c = x.center || x, t = x.tags || {};
    const ville = t['addr:city'] || '';
    const cp = String(t['addr:postcode'] || '').toUpperCase();
    const rue = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const adresse = rue || ville ? [rue, ville, cp ? `QC ${cp}` : 'QC'].filter(Boolean).join(', ') : '';
    const nom = [t.brand || t.name || txt, ville].filter(Boolean).join(' ');
    return { nom: t.name && ville && !sansAccents(t.name).includes(sansAccents(ville)) ? `${t.name} ${ville}` : (t.name || nom), adresse, ville, fsa: cp.slice(0, 3), lat: c.lat, lng: c.lon, d: distanceKm(o, { lat: c.lat, lng: c.lon }), cle: cleBanniere(txt) };
  }).filter((x) => x.lat != null && x.d != null && x.d <= 100)
    .filter((x) => { const k = `${x.lat.toFixed(4)},${x.lng.toFixed(4)}`; if (vus.has(k)) return false; vus.add(k); return true; })
    .sort((a, b) => a.d - b.d);
}

/** Secours quand Overpass est saturé : Nominatim, en 3 cercles de plus en plus grands (≈ 20, 50 et 100 km) pour avoir
 *  d'abord les plus proches (Nominatim rend au plus 40 résultats par requête). 1 requête par seconde, règle d'OpenStreetMap. */
async function succursalesNominatim(txt, o) {
  const cle = sansAccents(txt).replace(/\s/g, '');
  const vus = new Map();
  for (const [i, delta] of [0.2, 0.5, 1.3].entries()) {
    if (i) await new Promise((ok) => setTimeout(ok, 1100));
    const dLng = delta * 1.4;
    const p = new URLSearchParams({ q: txt, format: 'jsonv2', addressdetails: 1, limit: 40, countrycodes: 'ca', bounded: 1,
      viewbox: `${o.lng - dLng},${o.lat + delta},${o.lng + dLng},${o.lat - delta}` });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
    if (!r.ok) { if (vus.size) break; throw new Error('Carte indisponible'); }
    for (const x of await r.json()) {
      if (!sansAccents(x.name || '').replace(/\s/g, '').startsWith(cle)) continue;
      const a = x.address || {};
      const ville = a.city || a.town || a.village || a.municipality || '';
      const cp = String(a.postcode || '').toUpperCase();
      const lat = Number(x.lat), lng = Number(x.lon);
      const d = distanceKm(o, { lat, lng });
      if (d == null || d > 100) continue;
      const adresse = [[a.house_number, a.road].filter(Boolean).join(' '), ville, cp ? `QC ${cp}` : 'QC'].filter(Boolean).join(', ');
      vus.set(`${lat.toFixed(4)},${lng.toFixed(4)}`, { nom: ville && !sansAccents(x.name).includes(sansAccents(ville)) ? `${x.name} ${ville}` : x.name, adresse, ville, fsa: cp.slice(0, 3), lat, lng, d, cle: cleBanniere(txt) });
    }
  }
  return [...vus.values()].sort((a, b) => a.d - b.d);
}

/** Adresse d'un point (OpenStreetMap Nominatim, 1 requête). */
async function adresseDe(lat, lng) {
  try {
    const p = new URLSearchParams({ lat, lon: lng, format: 'jsonv2', addressdetails: 1, zoom: 18 });
    const a = (await (await fetch(`https://nominatim.openstreetmap.org/reverse?${p}`)).json()).address || {};
    const ville = a.city || a.town || a.village || a.municipality || '';
    const cp = String(a.postcode || '').toUpperCase();
    return { ville, fsa: cp.slice(0, 3), adresse: [[a.house_number, a.road].filter(Boolean).join(' '), ville, cp ? `QC ${cp}` : 'QC'].filter(Boolean).join(', ') };
  } catch { return null; }
}

/** Ajoute (ou remet) une succursale trouvée dans ma liste. Un magasin retiré au même endroit est simplement remis : ses prix le suivent. */
async function ajouterSuccursale(r) {
  const retire = S.get().magasins.find((m) => m.retire && (distanceKm(m, r) ?? 99) < 0.15);
  if (retire) {
    S.maj((x) => { const m = x.magasins.find((y) => y.id === retire.id); m.retire = false; m.actif = true; });
    toast(`${retire.nom} remis dans ta liste`);
    return;
  }
  if (!r.ville || !r.adresse) { const a = await adresseDe(r.lat, r.lng); if (a) Object.assign(r, { ville: r.ville || a.ville, fsa: r.fsa || a.fsa, adresse: r.adresse || a.adresse }); }
  const nomBan = BANNIERES[r.cle]?.nom || r.nom.split(' ')[0];
  const nom = `${nomBan} ${r.ville || ''}`.trim();
  S.maj((x) => { x.magasins.push({ id: S.uid('m'), banniere: r.cle, nom, codePostal: r.fsa || '', adresse: r.adresse || '', ville: r.ville || '', lat: r.lat, lng: r.lng }); });
  toast(`${nom} ajouté`);
}

/** Retirer de ma liste : le magasin n'apparaît plus et n'est plus comparé, mais ses prix et reçus restent et la base continue d'en noter. */
function retirerMagasin(id) {
  const m = S.get().magasins.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`Retirer ${m.nom} de ma liste ?

Il n’apparaîtra plus dans tes magasins ni tes comparaisons. Ses prix et reçus restent dans ta base, et la base continue de noter ses prix. Tu peux le rajouter avec la recherche.`)) return;
  S.maj((x) => { const y = x.magasins.find((z) => z.id === id); y.retire = true; y.actif = false; });
  toast(`${m.nom} retiré de ta liste`);
}

/** Magasins sans coordonnées (ajoutés à la main) : situés par leur adresse, un à la fois (1 requête / s, règle d'OpenStreetMap). */
let coordEnCours = false;
const coordEssayes = new Set();   // une seule tentative par magasin et par ouverture de l'app
async function completerCoordonnees() {
  if (coordEnCours) return;
  coordEnCours = true;
  try {
    const sans = S.get().magasins.filter((m) => !m.retire && m.lat == null && m.adresse && !coordEssayes.has(m.id)).slice(0, 5);
    for (const m of sans) {
      coordEssayes.add(m.id);
      const p = new URLSearchParams({ q: m.adresse, format: 'jsonv2', limit: 1, countrycodes: 'ca' });
      const j = await (await fetch(`https://nominatim.openstreetmap.org/search?${p}`)).json().catch(() => []);
      if (j[0]) S.maj((x) => { const y = x.magasins.find((z) => z.id === m.id); if (y && y.lat == null) { y.lat = Number(j[0].lat); y.lng = Number(j[0].lon); } });
      await new Promise((ok) => setTimeout(ok, 1100));
    }
  } catch { /* hors ligne : on réessaiera */ } finally { coordEnCours = false; }
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
    <button class="btn danger" id="mfSup" style="width:100%">✕ Retirer de ma liste</button>
    <p class="doux">Pour seulement l'ignorer dans les comparaisons, utilise plutôt l'interrupteur dans la liste des magasins.</p>`, (c) => {
    $('#mfAdr', c).onchange = () => S.maj((x) => { x.magasins.find((y) => y.id === m.id).adresse = $('#mfAdr', c).value.trim(); });
    $('#mfReleve', c).onclick = () => { fermerModale(); ouvrirReleve(m.id); allerOnglet('plus'); };
    $('#mfSup', c).onclick = () => { fermerModale(); retirerMagasin(m.id); };
  });
}

