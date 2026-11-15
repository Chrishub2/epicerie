// =====================================================================
// Épicerie — application principale (mode démo)
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, offresArticle, meilleureOffre, libelleUnitaire,
  libelleFin, joursRestants, nomBanniere, puce, toast } from './ui.js';
import { BANNIERES } from './demo-data.js';
import { analyserOffre, formatLisible } from './normalise.js';
import { ouvrirScan, photoProduit } from './scan.js';
import { vueRecettes } from './recettes.js';
import { vuePlus, afficherPhoto, allerASection } from './plus.js';
import { vueComparaison, tableauOffres, nomCle } from './comparer.js';
import { ouvrirLiaison, actualiserArticle, actualiserTout, afficherHistorique } from './epiceries.js';

let onglet = 'liste';
let filtreMagasin = 'tous'; // filtre de la liste après « Utiliser cette répartition »

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
S.charger();
const e0 = S.get();
const choix = $('#choixMembre');
choix.innerHTML = e0.membres.map((m) => `<option ${m === e0.utilisateur ? 'selected' : ''}>${esc(m)}</option>`).join('');
choix.onchange = () => S.maj((e) => { e.utilisateur = choix.value; });

$$('#onglets button').forEach((b) => b.onclick = () => { onglet = b.dataset.onglet; rendre(); });
S.abonner(() => rendre());
queueMicrotask(rendre); // après l'évaluation complète du module
setTimeout(() => actualiserTout().catch(() => {}), 1500); // vrais prix des produits liés (max 1 fois / 12 h)

export function rendre() {
  $$('#onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === onglet));
  const v = $('#vue');
  if (onglet === 'liste') vueListe(v);
  else if (onglet === 'comparer') vueComparaison(v, rendre);
  else if (onglet === 'recettes') vueRecettes(v);
  else if (onglet === 'magasins') vueMagasins(v);
  else vuePlus(v);
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
      e.liste.push({ id: S.uid('l'), articleId, quantite, coche: false, mode: 'personne', ajoutePar: e.utilisateur,
        recettes: extra.recette ? [extra.recette] : [], note: extra.note || '' });
    }
  });
  return fusion;
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
        html: `⏰ <b>${esc(a.nom)}</b> : rabais ${esc(m.magasinNom || nomBanniere(m.banniere))} ${libelleFin(m.fin)} (${esc(m.offre)}).` });
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
  return out.filter((x) => !masquees.has(x.cle)).map((x) =>
    `<div class="alerte ${x.classe} alerte-action" data-action="${esc(x.action)}" role="link" tabindex="0">
       <span class="grandir">${x.html}</span><button class="fermer-alerte" data-masquer="${esc(x.cle)}" aria-label="Masquer">✕</button></div>`).join('');
}

/** Exécute l'action d'une alerte. */
function agir(action) {
  const [type, id, extra] = action.split(':');
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

function vueListe(v) {
  const e = S.get();
  const tous = e.liste.map((l) => ({ l, a: e.articles.find((x) => x.id === l.articleId) }));
  // Filtre par magasin (après une répartition « N arrêts »)
  const cibles = {};
  tous.forEach(({ l }) => { const k = l.magasinCible || 'aucun'; cibles[k] = (cibles[k] || 0) + 1; });
  const avecCibles = Object.keys(cibles).some((k) => k !== 'aucun');
  if (!avecCibles || (filtreMagasin !== 'tous' && !cibles[filtreMagasin])) filtreMagasin = 'tous';
  const items = filtreMagasin === 'tous' ? tous : tous.filter(({ l }) => (l.magasinCible || 'aucun') === filtreMagasin);
  // Filtré sur un magasin : on applique l'ordre de rayons enregistré pour ce magasin.
  const magFiltre = magasinDeCle(filtreMagasin);
  const rayons = ordreRayons(magFiltre?.id || e.magasinCourant);
  const nbCoches = e.liste.filter((l) => l.coche).length;
  const optionsMag = [`<option value="defaut">Ordre par défaut</option>`]
    .concat(e.magasins.map((m) => `<option value="${m.id}" ${e.magasinCourant === m.id ? 'selected' : ''}>${esc(m.nom)}</option>`)).join('');

  let html = `
    <div class="ajout">
      <div class="rang">
        <input id="saisie" class="grandir" list="catalogue" placeholder="Ajouter… (ex. beurre, 2 lait)" autocomplete="off">
        <button class="icone" id="btnVoix" title="Dicter">🎤</button>
        <button class="icone" id="btnScan" title="Code-barres">▥</button>
        <button class="icone" id="btnPhoto" title="Photo d'un produit">📷</button>
      </div>
      <datalist id="catalogue">${e.articles.map((a) => `<option value="${esc(a.nom)}">`).join('')}</datalist>
    </div>
    ${alertesListe()}
    <div class="rang" style="margin:4px 0 6px">
      ${magFiltre ? `<div class="grandir doux">Rayons dans l'ordre de <b>${esc(magFiltre.nom)}</b></div>`
        : `<select id="choixMagasin" class="grandir" aria-label="Ordre des rayons pour quel magasin">${optionsMag}</select>`}
      <button class="btn sec" id="btnReorg">↕ Rayons</button>
    </div>
    ${avecCibles ? `<div class="rang envelopper" style="margin-bottom:6px">${[['tous', `Tout (${tous.length})`],
      ...Object.entries(cibles).map(([k, n]) => [k, `${k === 'aucun' ? 'Non assigné' : nomCle(k)} (${n})`])]
      .map(([k, t]) => `<button class="btn ${filtreMagasin === k ? '' : 'sec'}" data-filtre="${esc(k)}" style="padding:5px 10px;font-size:13px">${esc(t)}</button>`).join('')}</div>` : ''}`;

  if (!items.length) html += `<div class="vide">Ta liste est vide. Ajoute un article, scanne un code-barres ou ajoute une recette.</div>`;

  for (const r of rayons) {
    const dans = items.filter(({ a }) => a && a.rayonId === r.id);
    if (!dans.length) continue;
    html += `<section class="rayon"><h3>${esc(r.nom)} <span class="doux">(${dans.length})</span></h3>`;
    dans.sort((x, y) => x.l.coche - y.l.coche);
    for (const { l, a } of dans) {
      const m = meilleureOffre(a);
      const meilleur = m ? `${puce(m.banniere)}${esc(m.magasinNom || nomBanniere(m.banniere))} · ${esc(libelleUnitaire(m.pu, m.uniteRef).split(' · ')[0])}${m.fin ? ` · ${libelleFin(m.fin)}` : ''}` : 'Prix inconnu — touche pour trouver les vrais prix';
      html += `<div class="item ${l.coche ? 'coche' : ''}" data-id="${l.id}">
        <input type="checkbox" ${l.coche ? 'checked' : ''} aria-label="Acheté">
        ${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" class="vignette" data-fiche="${a.id}">` : ''}
        <div class="grandir" data-fiche="${a.id}" style="cursor:pointer">
          <div class="nom">${esc(a.nom)} ${a.local ? '<span title="Produit local">🍁</span>' : ''} ${l.mode === 'en_ligne' ? '<span class="pastille">en ligne</span>' : ''}${l.magasinCible ? `<span class="pastille vert">${esc(nomCle(l.magasinCible))}</span>` : ''}</div>
          <div class="info">${meilleur}</div>
          <div class="info">${esc(formatLisible(a.format) || '')}${l.ajoutePar ? ` · ajouté par ${esc(l.ajoutePar)}` : ''}${l.recettes?.length ? ` · 🍲 ${l.recettes.length} recette(s)` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</div>
        </div>
        <div class="qte"><button data-q="-1">−</button><b>${l.quantite}</b><button data-q="1">+</button></div>
      </div>`;
    }
    html += `</section>`;
  }
  if (nbCoches) html += `<button class="btn sec" id="btnVider" style="width:100%;margin-top:8px">Retirer les ${nbCoches} article(s) acheté(s)</button>`;
  v.innerHTML = html;

  const saisie = $('#saisie');
  saisie.onkeydown = (ev) => { if (ev.key === 'Enter' && saisie.value.trim()) { ajouterTexte(saisie.value); saisie.value = ''; } };
  $('#btnVoix').onclick = dicter;
  $('#btnScan').onclick = () => ouvrirScan((a) => { ajouterALaListe(a.id); toast(`${a.nom} ajouté`); });
  $('#btnPhoto').onclick = () => photoProduit();
  $('#choixMagasin')?.addEventListener('change', (ev) => S.maj((x) => { x.magasinCourant = ev.target.value; }));
  $('#btnReorg').onclick = () => ouvrirReorg(magFiltre?.id);
  $$('[data-action]', v).forEach((al) => {
    al.onclick = (ev) => { if (!ev.target.closest('[data-masquer]')) agir(al.dataset.action); };
    al.onkeydown = (ev) => { if (ev.key === 'Enter') agir(al.dataset.action); };
  });
  $$('[data-masquer]', v).forEach((b) => b.onclick = () => S.maj((x) => {
    x.alertesMasquees = [...new Set([...(x.alertesMasquees || []), b.dataset.masquer])].slice(-200);
  }));
  $('#btnVider')?.addEventListener('click', () => S.maj((x) => { x.liste = x.liste.filter((l) => !l.coche); }));
  $$('[data-filtre]', v).forEach((b) => b.onclick = () => { filtreMagasin = b.dataset.filtre; rendre(); });

  $$('.item', v).forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('input').onchange = (ev) => S.maj((x) => {
      const l = x.liste.find((i) => i.id === id); l.coche = ev.target.checked; l.cocheLe = ev.target.checked ? new Date().toISOString() : null;
    });
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => S.maj((x) => {
      const l = x.liste.find((i) => i.id === id);
      l.quantite = Math.max(0, l.quantite + Number(b.dataset.q));
      if (l.quantite === 0) x.liste = x.liste.filter((i) => i.id !== id);
    }));
    el.querySelectorAll('[data-fiche]').forEach((f) => f.onclick = () => ficheArticle(f.dataset.fiche, id));
  });
}

/** « 2 lait, beurre et café » → plusieurs ajouts. */
function ajouterTexte(txt) {
  const morceaux = txt.split(/,|\bet\b|;/i).map((s) => s.trim()).filter(Boolean);
  const noms = [];
  for (const m of morceaux) {
    const r = m.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s*)?(.+)$/i);
    const q = r ? Number(r[1].replace(',', '.')) : 1;
    const nom = r ? r[2] : m;
    const existait = !!trouverArticle(nom);
    const a = assurerArticle(nom);
    ajouterALaListe(a.id, q);
    noms.push(existait ? a.nom : `${a.nom} (nouveau, rayon Divers)`);
  }
  toast(`Ajouté : ${noms.join(', ')}`);
}

function dicter() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { toast('Dictée non disponible sur ce navigateur — utilise le micro du clavier.'); return; }
  const r = new R(); r.lang = 'fr-CA'; r.interimResults = false;
  r.onresult = (ev) => ajouterTexte(ev.results[0][0].transcript);
  r.onerror = () => toast('Dictée interrompue');
  r.start(); toast('Parle maintenant…');
}

// --- Réorganiser les rayons (glisser-déposer tactile) -----------------
function ouvrirReorg(magId) {
  const e = S.get();
  const cible = magId || e.magasinCourant; // l'ordre est enregistré pour CE magasin et réutilisé à chaque visite
  const nomMag = cible === 'defaut' ? 'ordre par défaut' : e.magasins.find((m) => m.id === cible)?.nom;
  const rendreListe = () => ordreRayons(cible).map((r) =>
    `<li data-r="${r.id}"><span class="poignee" aria-hidden="true">≡</span><span class="grandir">${esc(r.nom)}</span>
     <button class="icone" data-mv="-1" aria-label="Monter">▲</button><button class="icone" data-mv="1" aria-label="Descendre">▼</button></li>`).join('');
  ouvrirModale('Ordre des rayons', `<p class="doux">Pour : <b>${esc(nomMag)}</b>. Glisse la poignée ≡ (ou utilise ▲▼) pour suivre ton parcours en magasin.</p>
    <ul class="reorg" id="reorg">${rendreListe()}</ul>
    <div class="rang" style="margin-top:10px"><input id="nouveauRayon" placeholder="Nouveau rayon"><button class="btn sec" id="ajRayon">Ajouter</button></div>`, (c) => {
    const ul = $('#reorg', c);
    const sauver = () => S.maj((x) => { x.ordreRayons[cible] = $$('li', ul).map((li) => li.dataset.r); });
    const brancher = () => {
      $$('[data-mv]', ul).forEach((b) => b.onclick = () => {
        const li = b.closest('li'); const d = Number(b.dataset.mv);
        if (d < 0 && li.previousElementSibling) ul.insertBefore(li, li.previousElementSibling);
        if (d > 0 && li.nextElementSibling) ul.insertBefore(li.nextElementSibling, li);
        sauver();
      });
      $$('.poignee', ul).forEach((p) => p.onpointerdown = (ev) => {
        ev.preventDefault();
        const li = p.closest('li'); li.classList.add('glisse'); p.setPointerCapture(ev.pointerId);
        p.onpointermove = (mv) => {
          const sous = document.elementFromPoint(mv.clientX, mv.clientY)?.closest('#reorg li');
          if (!sous || sous === li) return;
          const box = sous.getBoundingClientRect();
          ul.insertBefore(li, mv.clientY < box.top + box.height / 2 ? sous : sous.nextElementSibling);
        };
        p.onpointerup = p.onpointercancel = () => { li.classList.remove('glisse'); p.onpointermove = null; sauver(); };
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

// --- Fiche article ----------------------------------------------------
export function ficheArticle(articleId, ligneId) {
  const e = S.get();
  const a = e.articles.find((x) => x.id === articleId);
  if (!a) return;
  const l = e.liste.find((x) => x.id === ligneId);
  const photos = e.photos.filter((p) => p.articleId === a.id);
  ouvrirModale(a.nom, `
    ${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="Photo du produit" style="display:block;max-height:180px;max-width:100%;margin:0 auto 10px;border-radius:8px;background:#fff">` : ''}
    <h3>Prix par bannière ${a.format ? `<span class="doux">· ton format : ${esc(formatLisible(a.format))}</span>` : ''}</h3>
    ${tableauOffres(a, { avecManquants: true })}
    <div class="carte" style="margin-top:8px;background:var(--gris-fond)">
      <div class="rang"><b class="grandir">Vrais prix (épiceries.ca)</b>${a.liens?.length ? '<button class="btn sec" id="ecMaj" style="padding:5px 10px">↻</button>' : ''}</div>
      ${a.liens?.length ? `<ul class="liste-arret">${a.liens.map((li) => `<li><span>${esc(li.nom)}${li.size ? ` <span class="doux">${esc(formatLisible(li.size))}</span>` : ''}</span><a href="#" data-delien="${esc(li.id)}" aria-label="Retirer">✕</a></li>`).join('')}</ul>
        <div class="doux">Mis à jour : ${a.majPrix ? new Date(a.majPrix).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'jamais'} · Maxi, IGA, Super C, Metro. Costco et Jean Coutu : prix vus ou reçus.</div>`
        : '<p class="doux" style="margin:4px 0">Pas encore lié : les prix affichés sont fictifs (démo) ou saisis.</p>'}
      <button class="btn" id="ecLiaison" style="margin-top:8px">${a.liens?.length ? '+ Lier un autre produit' : '🔎 Trouver les vrais prix'}</button>
    </div>
    <details id="fHisto" style="margin-top:8px"><summary class="btn sec" style="display:inline-block">📈 Historique des prix</summary><div id="histo" style="margin-top:8px"></div></details>
    <details id="fAjPrix" style="margin-top:8px"><summary class="btn sec" style="display:inline-block">+ Ajouter un prix vu</summary>
      <div class="carte" style="margin-top:8px">
        <div class="rang"><div class="champ grandir"><label>Bannière</label><select id="pBan">${Object.entries(BANNIERES).map(([k, b]) => `<option value="${k}">${esc(b.nom)}</option>`).join('')}</select></div>
          <div class="champ grandir"><label>Type</label><select id="pType"><option value="regulier">Prix régulier</option><option value="circulaire">Circulaire / rabais</option></select></div></div>
        <div class="rang"><div class="champ grandir"><label>Prix affiché</label><input id="pOffre" placeholder="4,99 $ · 2/5 $ · 1,99 $/lb"></div>
          <div class="champ grandir"><label>Format</label><input id="pFormat" value="${esc(a.format || '')}" placeholder="454 g"></div></div>
        <div class="champ"><label>Fin du rabais (facultatif)</label><input id="pFin" type="date"></div>
        <button class="btn" id="pAjout">Ajouter ce prix</button></div></details>
    <h3 style="margin-top:14px">Fiche</h3>
    <div class="champ"><label>Nom</label><input id="fNom" value="${esc(a.nom)}"></div>
    <div class="rang">
      <div class="champ grandir"><label>Rayon</label><select id="fRayon">${e.rayons.map((r) => `<option value="${r.id}" ${r.id === a.rayonId ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div>
      <div class="champ grandir"><label>Comparer au</label><select id="fUnite">
        <option value="kg" ${a.uniteRef === 'kg' ? 'selected' : ''}>$/kg</option>
        <option value="l" ${a.uniteRef === 'l' ? 'selected' : ''}>$/L</option>
        <option value="unite" ${a.uniteRef === 'unite' ? 'selected' : ''}>$/unité</option></select></div>
    </div>
    <div class="rang">
      <div class="champ grandir"><label>Format habituel</label><input id="fFormat" value="${esc(a.format || '')}" placeholder="454 g, 4 L, 12 x 355 mL"></div>
      <div class="champ"><label>Local</label><select id="fLocal"><option value="1" ${a.local ? 'selected' : ''}>🍁 Oui</option><option value="0" ${!a.local ? 'selected' : ''}>Non</option></select></div>
    </div>
    ${l ? `<div class="champ"><label>Achat</label><select id="fMode"><option value="personne" ${l.mode !== 'en_ligne' ? 'selected' : ''}>En personne</option><option value="en_ligne" ${l.mode === 'en_ligne' ? 'selected' : ''}>En ligne</option></select></div>
    <div class="champ"><label>Note</label><input id="fNote" value="${esc(l.note || '')}" placeholder="ex. sans lactose, gros format"></div>` : ''}
    <div class="doux">Codes-barres : ${a.codes?.length ? a.codes.map(esc).join(', ') : 'aucun'}</div>
    <h3 style="margin-top:14px">Photos</h3>
    <div class="vignettes" id="fPhotos">${photos.length ? '' : '<span class="doux">Aucune photo.</span>'}</div>
    <div class="rang envelopper" style="margin-top:12px">
      <button class="btn" id="fSauver">Enregistrer</button>
      <button class="btn sec" id="fPhoto">📷 Photo</button>
      ${l ? '<button class="btn danger" id="fRetirer">Retirer de la liste</button>' : '<button class="btn sec" id="fAjouter">+ À la liste</button>'}
    </div>`, (c) => {
    photos.forEach((p) => afficherPhoto(p, $('#fPhotos', c)));
    const rouvrir = () => ficheArticle(articleId, ligneId);
    $('#ecLiaison', c).onclick = () => ouvrirLiaison(a.id, rouvrir);
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
    $$('[data-ajprix]', c).forEach((b) => b.onclick = () => {
      $('#fAjPrix', c).open = true; $('#pBan', c).value = b.dataset.ajprix; $('#pOffre', c).focus();
    });
    $('#pAjout', c).onclick = () => {
      const offre = $('#pOffre', c).value.trim();
      if (!analyserOffre(offre)) { toast('Prix illisible : ex. 4,99 $, 2/5 $ ou 1,99 $/lb'); return; }
      S.maj((x) => x.prix.push({ articleId: a.id, banniere: $('#pBan', c).value, offre, format: $('#pFormat', c).value.trim() || a.format,
        type: $('#pType', c).value, fin: $('#pFin', c).value || null, source: 'manuel', observeLe: new Date().toISOString().slice(0, 10) }));
      toast('Prix ajouté'); ficheArticle(articleId, ligneId);
    };
    $('#fSauver', c).onclick = () => {
      S.maj((x) => {
        const ar = x.articles.find((i) => i.id === a.id);
        ar.nom = $('#fNom', c).value.trim() || ar.nom; ar.rayonId = $('#fRayon', c).value; ar.uniteRef = $('#fUnite', c).value;
        ar.format = $('#fFormat', c).value.trim(); ar.local = $('#fLocal', c).value === '1';
        const li = x.liste.find((i) => i.id === ligneId);
        if (li) { li.mode = $('#fMode', c).value; li.note = $('#fNote', c).value.trim(); }
      });
      fermerModale(); toast('Enregistré');
    };
    $('#fPhoto', c).onclick = () => photoProduit(a.id);
    $('#fRetirer', c)?.addEventListener('click', () => { S.maj((x) => { x.liste = x.liste.filter((i) => i.id !== ligneId); }); fermerModale(); });
    $('#fAjouter', c)?.addEventListener('click', () => { ajouterALaListe(a.id); fermerModale(); toast(`${a.nom} ajouté`); });
  });
}

// ---------------------------------------------------------------------
// Onglet MAGASINS
// ---------------------------------------------------------------------
const lienMaps = (m) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.adresse ? `${m.nom}, ${m.adresse}` : m.nom)}`;

function vueMagasins(v) {
  const e = S.get();
  let html = `<div class="carte"><h2>Codes postaux</h2>
    <div>${e.codesPostaux.map((c) => `<span class="pastille" style="font-size:13px;padding:4px 10px">${esc(c.code)} · ${esc(c.libelle)} <a href="#" data-supcp="${esc(c.code)}" aria-label="Retirer">✕</a></span>`).join(' ')}</div>
    <div class="rang" style="margin-top:8px"><input id="cpCode" placeholder="Code (ex. J3X)" style="max-width:120px"><input id="cpLib" class="grandir" placeholder="Ville"><button class="btn sec" id="cpAjout">Ajouter</button></div></div>`;

  for (const c of e.codesPostaux) {
    const mags = e.magasins.filter((m) => m.codePostal === c.code);
    html += `<h2>${esc(c.code)} — ${esc(c.libelle)}</h2>`;
    if (!mags.length) html += `<p class="doux">Aucun magasin pour ce code postal.</p>`;
    for (const m of mags) {
      const rp = e.rabaisPerso.find((r) => r.magasinId === m.id && r.actif);
      html += `<div class="carte"><div class="rang">${puce(m.banniere)}<b class="grandir">${esc(m.nom)}</b>
          <a class="btn sec" href="${lienMaps(m)}" target="_blank" rel="noopener" style="text-decoration:none">🗺️ Maps</a></div>
        <div class="doux" style="margin:4px 0">${m.adresse ? esc(m.adresse) : 'Adresse à confirmer'}${rp ? ` · <span class="pastille vert">${esc(rp.description)}</span>` : ''}</div>
        <div class="rang"><input data-adr="${m.id}" class="grandir" placeholder="Adresse exacte" value="${esc(m.adresse)}"><button class="icone" data-supmag="${m.id}" aria-label="Retirer">🗑</button></div></div>`;
    }
  }
  html += `<div class="carte"><h2>Trouver une succursale</h2>
    <p class="doux">Choisis la bannière et la ville (ou le code postal) : je cherche les succursales et leurs adresses (OpenStreetMap).</p>
    <div class="rang envelopper">
      <select id="mBan" class="grandir">${Object.entries(BANNIERES).map(([k, b]) => `<option value="${k}">${b.nom}</option>`).join('')}</select>
      <input id="mVille" class="grandir" placeholder="Ville ou code postal (ex. Chambly, J3L)"></div>
    <button class="btn" id="mChercher" style="margin-top:8px">🔎 Chercher</button>
    <div id="mResultats" style="margin-top:8px"></div></div>`;
  v.innerHTML = html;

  $('#cpAjout').onclick = () => {
    const code = $('#cpCode').value.trim().toUpperCase(); if (!code) return;
    if (e.codesPostaux.some((c) => c.code === code)) { toast('Déjà là'); return; }
    S.maj((x) => x.codesPostaux.push({ code, libelle: $('#cpLib').value.trim() || code }));
  };
  $$('[data-supcp]').forEach((a) => a.onclick = (ev) => {
    ev.preventDefault();
    const code = a.dataset.supcp;
    if (e.magasins.some((m) => m.codePostal === code)) { toast('Retire d\'abord les magasins de ce code postal.'); return; }
    S.maj((x) => { x.codesPostaux = x.codesPostaux.filter((c) => c.code !== code); });
  });
  $$('[data-adr]').forEach((i) => i.onchange = () => S.maj((x) => { x.magasins.find((m) => m.id === i.dataset.adr).adresse = i.value.trim(); }));
  $$('[data-supmag]').forEach((b) => b.onclick = () => {
    const m = e.magasins.find((x) => x.id === b.dataset.supmag);
    if (!confirm(`Retirer ${m.nom} ?`)) return;
    S.maj((x) => { x.magasins = x.magasins.filter((y) => y.id !== m.id); x.rabaisPerso = x.rabaisPerso.filter((r) => r.magasinId !== m.id); });
  });
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
