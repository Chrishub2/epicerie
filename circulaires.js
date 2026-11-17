// =====================================================================
// Circulaires de la semaine (app v55) — même écran dans l'app (Plus → Circulaires) et dans la console.
// Chris charge ses captures (images ou PDF) par bannière dans un BROUILLON partagé du foyer,
// puis touche « Envoyer ». Le serveur (fonction lire-circulaires) lit, relie et écrit les rabais sûrs ;
// les douteux reviennent ici, « À valider ». Spec : journal/SPEC-circulaires.md
// Aucune écriture directe : envoi, décisions et annulations passent par les fonctions de la base
// (envoyer_lot, decider_offre, annuler_offre, annuler_lot) — mêmes règles pour le téléphone et la console.
// =====================================================================

/** Sources de circulaires (même liste que le serveur : supabase/functions/lire-circulaires/rapprochement.js). */
export const SOURCES_CIRC = [
  { id: 'super_c', nom: 'Super C', banniere: 'super_c', auto: true },
  { id: 'maxi', nom: 'Maxi', banniere: 'maxi', auto: true, note: 'Plusieurs circulaires possibles' },
  { id: 'choix_president', nom: 'Le Choix du Président', banniere: 'maxi', note: 'Prix appliqués à Maxi' },
  { id: 'iga', nom: 'IGA', banniere: 'iga', auto: true },
  { id: 'metro', nom: 'Metro', banniere: 'metro', auto: true },
  { id: 'walmart', nom: 'Walmart', banniere: 'walmart', auto: true },
  { id: 'costco', nom: 'Costco', banniere: 'costco' },
  { id: 'tigre_geant', nom: 'Tigre Géant', banniere: 'tigre_geant' },
  { id: 'jean_coutu', nom: 'Jean Coutu', banniere: 'jean_coutu' },
  { id: 'uniprix', nom: 'Uniprix', banniere: 'uniprix' },
  { id: 'uniprix_sante', nom: 'Uniprix Santé', banniere: 'uniprix_sante' },
  { id: 'familiprix_clinique', nom: 'Familiprix Clinique', banniere: 'familiprix_clinique' },
  { id: 'familiprix_extra', nom: 'Familiprix Extra', banniere: 'familiprix_extra' },
  { id: 'pharmaprix', nom: 'Pharmaprix', banniere: 'pharmaprix' },
  { id: 'canadian_tire', nom: 'Canadian Tire', banniere: 'canadian_tire', note: 'Électroménagers seulement' },
];
const SOURCE = Object.fromEntries(SOURCES_CIRC.map((s) => [s.id, s]));
const BUCKET = 'circulaires';
const LARGEUR_MAX = 1600;        // px : assez pour lire les petits prix, sans gaspiller
const RATIO_MAX = 2.2;           // capture plus haute : coupée en morceaux
const CHEVAUCHEMENT = 0.08;      // morceaux qui se chevauchent (les doublons sont écartés par le serveur)
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dateCourte = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) : '');
const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) : '');
const argent = (x) => `${Number(x || 0).toFixed(2).replace('.', ',')} $`;
const nomSource = (id) => SOURCE[id]?.nom || id;

// ---------------------------------------------------------------------
// Données (Supabase) — utilisables par l'app et la console
// ---------------------------------------------------------------------
export async function compterAValider(sb, foyer) {
  if (!sb || !foyer) return 0;
  const { count } = await sb.from('offres_circulaires').select('id', { count: 'exact', head: true }).eq('foyer_id', foyer).eq('statut', 'a_valider');
  return count || 0;
}

async function brouillon(sb, foyer) {
  const { data } = await sb.from('lots_circulaires').select('*').eq('foyer_id', foyer).eq('statut', 'brouillon').maybeSingle();
  if (data) return data;
  const { data: cree, error } = await sb.from('lots_circulaires').insert({ foyer_id: foyer }).select().single();
  if (error) {   // l'autre appareil vient peut-être de le créer
    const { data: x } = await sb.from('lots_circulaires').select('*').eq('foyer_id', foyer).eq('statut', 'brouillon').maybeSingle();
    if (x) return x;
    throw new Error(error.message);
  }
  return cree;
}

/** Image ou PDF → pages JPEG prêtes à lire (largeur ≤ 1600 px ; capture très haute coupée en morceaux). */
export async function preparerFichier(fichier, progres = () => {}) {
  if (fichier.type === 'application/pdf' || /\.pdf$/i.test(fichier.name)) {
    const pdfjs = await chargerPdfjs();
    const doc = await pdfjs.getDocument({ data: await fichier.arrayBuffer() }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      progres(`PDF : page ${i}/${doc.numPages}`);
      const page = await doc.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, LARGEUR_MAX / v1.width) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      // intent « print » : rendu complet sans attendre l'affichage (requestAnimationFrame), même onglet en arrière-plan
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
      out.push(...await decouper(c, c.width, c.height));
    }
    return out;
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(`Image illisible : ${fichier.name}`)); i.src = url; });
    return await decouper(img, img.naturalWidth, img.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}

async function decouper(source, w, h) {
  const k = Math.min(1, LARGEUR_MAX / w);
  const W = Math.round(w * k), H = Math.round(h * k);
  const hauteur = Math.round(W * 2);
  const morceaux = [];
  if (H / W <= RATIO_MAX) morceaux.push([0, H]);
  else {
    // Morceaux de même hauteur, répartis également, qui se chevauchent d'au moins 8 % (pas de mince bande à la fin)
    const n = Math.ceil((H - hauteur) / (hauteur * (1 - CHEVAUCHEMENT))) + 1;
    const pas = (H - hauteur) / (n - 1);
    for (let i = 0; i < n; i++) morceaux.push([Math.round(i * pas), hauteur]);
  }
  const out = [];
  for (const [y, hh] of morceaux) {
    const c = document.createElement('canvas');
    c.width = W; c.height = hh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, hh);
    ctx.drawImage(source, 0, y / k, w, hh / k, 0, 0, W, hh);
    out.push(await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85)));
  }
  return out;
}

let pdfjsPromesse = null;
function chargerPdfjs() {
  pdfjsPromesse ||= new Promise((ok, ko) => {
    if (window.pdfjsLib) return ok(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = PDFJS;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(window.pdfjsLib); };
    s.onerror = () => { pdfjsPromesse = null; ko(new Error('Lecteur PDF indisponible (réseau ?)')); };
    document.head.appendChild(s);
  });
  return pdfjsPromesse;
}

// ---------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------
const CSS = `
.circ { --c-fond: var(--carte, #fff); --c-texte: var(--texte, #1d2320); --c-doux: var(--doux, #66706a); --c-trait: #e3e6e1;
  --c-accent: var(--accent, #1f7a4d); --c-accent-texte: #fff; --c-alerte: #c96a12; --c-erreur: #c0392b; --c-fond2: var(--fond, #f5f6f3);
  display: grid; gap: 14px; color: var(--c-texte); }
.circ[data-hote="app"] { --c-trait: var(--ligne, #e3e6e1); }
.circ[data-hote="console"] { --c-fond: var(--surface); --c-doux: var(--texte-2); --c-trait: var(--trait); --c-accent: var(--etiquette);
  --c-accent-texte: var(--etiquette-texte); --c-alerte: var(--alerte); --c-erreur: var(--erreur); --c-fond2: var(--surface-2);
  max-width: 1100px; padding: 16px; overflow-y: auto; height: 100%; align-content: start; }
.circ h2 { font-size: 17px; margin: 0; }
.circ h3 { font-size: 15px; margin: 0; }
.circ .c-doux { color: var(--c-doux); font-size: 13px; }
.circ .c-bloc { background: var(--c-fond); border: 1px solid var(--c-trait); border-radius: 10px; padding: 12px; display: grid; gap: 10px; }
.circ .c-rang { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.circ .c-grandir { flex: 1; min-width: 0; }
.circ .c-btn { font: inherit; font-size: 14px; border-radius: 8px; padding: 7px 12px; border: 1px solid var(--c-trait); background: var(--c-fond); color: var(--c-texte); cursor: pointer; }
.circ .c-btn.p { background: var(--c-accent); border-color: var(--c-accent); color: var(--c-accent-texte); font-weight: 600; }
.circ .c-btn.d { color: var(--c-erreur); }
.circ .c-btn:disabled { opacity: .45; cursor: default; }
.circ .c-btn:focus-visible, .circ input:focus-visible, .circ select:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 1px; }
.circ .c-sources { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.circ .c-source { border: 1px solid var(--c-trait); border-radius: 10px; padding: 10px; display: grid; gap: 8px; background: var(--c-fond); }
.circ .c-source.plein { border-color: var(--c-accent); }
.circ .c-pastille { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--c-trait); color: var(--c-doux); white-space: nowrap; }
.circ .c-pastille.a { border-color: var(--c-alerte); color: var(--c-alerte); }
.circ .c-vignettes { display: flex; flex-wrap: wrap; gap: 6px; }
.circ .c-vig { position: relative; width: 56px; height: 76px; border-radius: 6px; overflow: hidden; border: 1px solid var(--c-trait); background: var(--c-fond2); }
.circ .c-vig img { width: 100%; height: 100%; object-fit: cover; display: block; }
.circ .c-vig button { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; cursor: pointer; padding: 0; }
.circ .c-circ { display: grid; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--c-trait); }
.circ .c-offre { border: 1px solid var(--c-trait); border-radius: 10px; padding: 10px; display: grid; gap: 8px; background: var(--c-fond); }
.circ .c-offre.auto { border-left: 4px solid var(--c-accent); }
.circ .c-offre b { font-weight: 600; }
.circ .c-prix { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
.circ select, .circ input[type=text], .circ input[type=search] { font: inherit; font-size: 14px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--c-trait); background: var(--c-fond); color: var(--c-texte); max-width: 100%; }
.circ .c-choix { display: grid; gap: 4px; max-height: 240px; overflow-y: auto; }
.circ .c-choix button { text-align: left; }
.circ .c-barre { height: 6px; border-radius: 3px; background: var(--c-fond2); overflow: hidden; }
.circ .c-barre i { display: block; height: 100%; background: var(--c-accent); }
.circ table { border-collapse: collapse; width: 100%; font-size: 13px; }
.circ td { padding: 6px 4px; border-top: 1px solid var(--c-trait); vertical-align: top; }
.circ .c-tableau { overflow-x: auto; }
.circ .c-confirmer { border: 1px solid var(--c-erreur); border-radius: 8px; padding: 8px; display: grid; gap: 6px; }
.circ input[type=checkbox] { width: 18px; height: 18px; flex: none; }
`;

/** Petit message en bas de l'écran (console : l'app a déjà le sien). */
function toastSimple(texte) {
  let t = document.getElementById('circ-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'circ-toast'; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;max-width:min(560px,90vw);padding:10px 16px;border-radius:8px;background:#1d2320;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = texte; t.style.opacity = '1';
  clearTimeout(t._m); t._m = setTimeout(() => { t.style.opacity = '0'; }, 3500);
}

/**
 * Monte l'écran dans `conteneur`.
 * opts : { sb, foyer, articles: () => [...], hote: 'app'|'console', source: 'telephone'|'console', message(texte), apresChangement() }
 */
export function monterCirculaires(conteneur, opts) {
  if (!document.getElementById('circ-css')) {
    const st = document.createElement('style'); st.id = 'circ-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const { sb, foyer, hote = 'app', source = 'telephone' } = opts;
  const message = opts.message || toastSimple;
  const articles = () => (opts.articles?.() || []).filter((a) => !a.supprime);
  const etat = { lot: null, pages: [], urls: new Map(), lots: [], aValider: [], autres: [], filtreAutres: '', minuterie: null, occupe: '' };
  conteneur.innerHTML = `<div class="circ" data-hote="${hote}"><p class="c-doux">Chargement des circulaires…</p></div>`;
  const racine = conteneur.firstElementChild;
  if (!sb || !foyer) {
    racine.innerHTML = '<div class="c-bloc"><h2>Circulaires de la semaine</h2><p class="c-doux">Connecte-toi à ton foyer (Plus → Mon foyer et partage) pour charger et envoyer des circulaires.</p></div>';
    return { arreter() {} };
  }
  let arrete = false;

  async function charger() {
    try {
      etat.lot = await brouillon(sb, foyer);
      const [pages, lots, aval] = await Promise.all([
        sb.from('pages_circulaires').select('*').eq('lot_id', etat.lot.id).order('source').order('circulaire').order('ordre'),
        sb.from('lots_circulaires').select('*').eq('foyer_id', foyer).neq('statut', 'brouillon').order('cree_le', { ascending: false }).limit(6),
        sb.from('offres_circulaires').select('*').eq('foyer_id', foyer).eq('statut', 'a_valider').order('cree_le').limit(300),
      ]);
      etat.pages = pages.data || [];
      etat.lots = lots.data || [];
      etat.aValider = aval.data || [];
      const derniers = etat.lots.filter((l) => l.statut === 'termine').slice(0, 2).map((l) => l.id);
      etat.autres = derniers.length
        ? ((await sb.from('offres_circulaires').select('*').in('lot_id', derniers).eq('statut', 'autre').order('nom').limit(800)).data || []) : [];
      // Avancement des lots en cours
      for (const l of etat.lots.filter((x) => x.statut === 'envoye')) {
        const { data } = await sb.from('pages_circulaires').select('statut').eq('lot_id', l.id);
        l._pages = data || [];
      }
      await vignettes();
    } catch (err) { message(`Circulaires : ${err.message}`); }
    if (!arrete) rendre();
    planifier();
  }

  async function vignettes() {
    const manquants = etat.pages.filter((p) => p.chemin && !etat.urls.has(p.id));
    if (!manquants.length) return;
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(manquants.map((p) => p.chemin), 3600);
    (data || []).forEach((d, i) => { if (d.signedUrl) etat.urls.set(manquants[i].id, d.signedUrl); });
  }

  function planifier() {
    clearTimeout(etat.minuterie);
    if (arrete || !racine.isConnected) return;   // écran quitté : on arrête de rafraîchir
    const enCours = etat.lots.some((l) => l.statut === 'envoye');
    etat.minuterie = setTimeout(() => { if (!arrete && !etat.occupe) charger(); else planifier(); }, enCours ? 4000 : 30000);
  }

  // --- Rendu -----------------------------------------------------------
  function rendre() {
    const n = etat.pages.length;
    racine.innerHTML = `
      <div class="c-bloc">
        <div class="c-rang"><h2 class="c-grandir">📰 Circulaires de la semaine</h2>
          <button class="c-btn p" data-envoyer ${n && !etat.occupe ? '' : 'disabled'}>Envoyer ${n ? `(${n} page${n > 1 ? 's' : ''})` : ''}</button></div>
        <p class="c-doux">Charge tes captures d'écran, PDF ou photos de circulaires, bannière par bannière, puis touche <b>Envoyer</b>.
          Le brouillon est partagé : tu peux commencer sur le téléphone et finir à l'ordinateur. « auto » : la bannière a aussi des prix automatiques (épiceries.ca).</p>
        ${etat.occupe ? `<p class="c-doux">⏳ ${esc(etat.occupe)}</p>` : ''}
        <div class="c-sources">${SOURCES_CIRC.map(carteSource).join('')}</div>
      </div>
      ${blocAValider()}
      ${blocLots()}
      ${blocAutres()}`;
    brancher();
  }

  function carteSource(s) {
    const pages = etat.pages.filter((p) => p.source === s.id);
    const nbCirc = Math.max(1, ...pages.map((p) => p.circulaire), etat[`plus_${s.id}`] || 1);
    const groupes = Array.from({ length: nbCirc }, (_, i) => i + 1);
    return `<div class="c-source ${pages.length ? 'plein' : ''}">
      <div class="c-rang"><b class="c-grandir">${esc(s.nom)}</b>${s.auto ? '<span class="c-pastille" title="Prix aussi récoltés automatiquement par épiceries.ca">auto</span>' : ''}
        ${s.note ? `<span class="c-pastille a">${esc(s.note)}</span>` : ''}
        ${opts.succursale && !opts.succursale(s.banniere) ? '<span class="c-pastille a" title="Ses prix ne s\'afficheront dans Comparer qu\'après l\'ajout d\'une succursale (onglet Magasins)">sans succursale</span>' : ''}</div>
      ${groupes.map((g) => {
        const pg = pages.filter((p) => p.circulaire === g);
        return `<div class="c-circ">
          ${nbCirc > 1 ? `<span class="c-doux">Circulaire ${g}</span>` : ''}
          ${pg.length ? `<div class="c-vignettes">${pg.map((p) => `<div class="c-vig">${etat.urls.get(p.id) ? `<img src="${esc(etat.urls.get(p.id))}" alt="Page ${p.ordre}" loading="lazy">` : ''}
            <button type="button" data-retirer="${p.id}" aria-label="Retirer cette page">✕</button></div>`).join('')}</div>` : ''}
          <label class="c-btn" style="text-align:center">📷 Charger${pg.length ? ' d\'autres pages' : ''}
            <input type="file" accept="image/*,application/pdf" multiple hidden data-charger="${s.id}" data-circ="${g}"></label>
        </div>`;
      }).join('')}
      <button type="button" class="c-btn" data-autre="${s.id}">+ Autre circulaire ${esc(s.nom)}</button>
    </div>`;
  }

  function blocAValider() {
    if (!etat.aValider.length) return '';
    const auto = etat.aValider.filter((o) => o.auto).length;
    return `<div class="c-bloc" id="cAValider">
      <div class="c-rang"><h2 class="c-grandir">⚠ ${etat.aValider.length} rabais à valider</h2>
        <button class="c-btn p" data-valider-sel>Valider la sélection</button></div>
      <p class="c-doux">Les rabais cochés sont ceux que les règles jugent sûrs (période de rodage : je mesure ma précision avant de les écrire seul).
        Vérifie le produit, puis valide. « Pas ce produit » m'apprend à ne plus le proposer. ${auto ? `${auto} coché(s) d'avance.` : ''}</p>
      ${etat.aValider.map(carteOffre).join('')}
    </div>`;
  }

  function carteOffre(o) {
    const nom = [o.marque, o.nom].filter(Boolean).join(' ');
    const cands = o.candidats || [];
    return `<div class="c-offre ${o.auto ? 'auto' : ''}" data-offre="${o.id}">
      <div class="c-rang">
        <input type="checkbox" data-coche ${o.auto ? 'checked' : ''} aria-label="Sélectionner">
        <span class="c-grandir"><b>${esc(nom)}</b>${o.format ? ` · ${esc(o.format)}` : ''}
          <div class="c-doux">${esc(nomSource(o.source))}${o.fin ? ` · jusqu'au ${esc(dateCourte(o.fin + 'T12:00'))}` : ''}${o.conditions ? ` · <b>${esc(o.conditions)}</b>` : ''}</div></span>
        <span class="c-prix">${esc(o.offre)}</span>
      </div>
      ${o.raison ? `<div class="c-doux">${esc(o.raison)}</div>` : ''}
      <div class="c-rang">
        <select data-produit aria-label="Produit">${cands.length ? '' : '<option value="">— choisis le produit —</option>'}
          ${cands.map((c) => `<option value="${esc(c.id)}" ${c.id === o.article_id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
          <option value="__chercher">🔎 Autre produit du catalogue…</option></select>
        <input type="text" data-format value="${esc(o.format_retenu || o.format || '')}" placeholder="Format (ex. 454 g)" aria-label="Format" style="width:130px">
      </div>
      <div class="c-choix" data-recherche hidden></div>
      <div class="c-rang">
        <button class="c-btn p" data-decider="valider">✓ Valider</button>
        <button class="c-btn" data-decider="refuser" ${o.article_id ? '' : 'disabled'} title="Ce n'est pas ce produit : je ne le proposerai plus">✕ Pas ce produit</button>
        <button class="c-btn" data-decider="ignorer">Ignorer</button>
      </div>
    </div>`;
  }

  function blocLots() {
    if (!etat.lots.length) return '';
    return `<div class="c-bloc"><h2>Envois récents</h2>${etat.lots.map((l) => {
      const b = l.bilan || {};
      let corps = '';
      if (l.statut === 'envoye') {
        const total = (l._pages || []).length, faites = (l._pages || []).filter((p) => !['a_lire', 'en_lecture'].includes(p.statut)).length;
        corps = `<div class="c-doux">Lecture en cours : page ${faites}/${total}…</div><div class="c-barre"><i style="width:${total ? Math.round(100 * faites / total) : 0}%"></i></div>`;
      } else if (l.statut === 'termine') {
        corps = `<div class="c-doux">${b.lues ?? 0}/${b.pages ?? 0} pages lues${b.illisibles ? ` · ${b.illisibles} illisible(s) à reprendre` : ''}${b.erreurs ? ` · ${b.erreurs} en erreur` : ''}
          · <b>${b.ecrits ?? 0}</b> écrits · <b>${b.a_valider ?? 0}</b> à valider · ${b.autres ?? 0} autres · coût ${argent(l.cout)}</div>`;
      } else corps = '<div class="c-doux">Annulé : ses prix sont marqués « annulés » (rien n\'est supprimé).</div>';
      return `<div class="c-circ" data-lot="${l.id}"><div class="c-rang"><b class="c-grandir">${esc(dateCourte(l.envoye_le || l.cree_le))} ${esc(heure(l.envoye_le || l.cree_le))}</b>
        <span class="c-pastille">${{ envoye: 'en cours', termine: 'terminé', annule: 'annulé' }[l.statut] || l.statut}</span>
        ${l.statut !== 'annule' ? '<button class="c-btn d" data-annuler-lot>Annuler ce lot</button>' : ''}</div>${corps}</div>`;
    }).join('')}</div>`;
  }

  function blocAutres() {
    if (!etat.autres.length) return '';
    const t = sansAccents(etat.filtreAutres);
    const liste = etat.autres.filter((o) => !t || sansAccents(`${o.marque || ''} ${o.nom} ${nomSource(o.source)}`).includes(t));
    return `<div class="c-bloc"><div class="c-rang"><h2 class="c-grandir">Autres rabais vus (${etat.autres.length})</h2>
        <input type="search" id="cFiltreAutres" placeholder="🔎 Filtrer" value="${esc(etat.filtreAutres)}" aria-label="Filtrer les autres rabais"></div>
      <p class="c-doux">Produits en rabais qui ne sont pas dans ton catalogue. « Relier » : c'est un de tes produits (je le retiendrai).</p>
      <div class="c-tableau"><table><tbody>${liste.slice(0, 150).map((o) => `<tr data-offre="${o.id}">
        <td>${esc(nomSource(o.source))}</td><td><b>${esc([o.marque, o.nom].filter(Boolean).join(' '))}</b>${o.format ? ` · ${esc(o.format)}` : ''}${o.conditions ? `<div class="c-doux">${esc(o.conditions)}</div>` : ''}</td>
        <td class="c-prix">${esc(o.offre)}</td><td><button class="c-btn" data-relier>Relier</button><div class="c-choix" data-recherche hidden></div></td></tr>`).join('')}</tbody></table></div>
      ${liste.length > 150 ? `<p class="c-doux">${liste.length - 150} de plus : affine le filtre.</p>` : ''}</div>`;
  }

  // --- Actions ---------------------------------------------------------
  function brancher() {
    racine.querySelectorAll('[data-charger]').forEach((inp) => inp.onchange = () => charger_(inp.dataset.charger, Number(inp.dataset.circ), [...inp.files]));
    racine.querySelectorAll('[data-retirer]').forEach((b) => b.onclick = () => retirer(b.dataset.retirer));
    racine.querySelectorAll('[data-autre]').forEach((b) => b.onclick = () => {
      const s = b.dataset.autre, max = Math.max(1, ...etat.pages.filter((p) => p.source === s).map((p) => p.circulaire), etat[`plus_${s}`] || 1);
      etat[`plus_${s}`] = max + 1; rendre();
    });
    racine.querySelector('[data-envoyer]')?.addEventListener('click', envoyer);
    racine.querySelector('[data-valider-sel]')?.addEventListener('click', validerSelection);
    racine.querySelectorAll('.c-offre').forEach((carte) => {
      const sel = carte.querySelector('[data-produit]');
      let avant = sel.value;
      sel.onchange = () => {
        if (sel.value !== '__chercher') { avant = sel.value; return; }
        sel.value = avant;   // en attendant le choix
        ouvrirRecherche(carte, (a) => { ajouterOption(sel, a); avant = a.id; });
      };
      carte.querySelectorAll('[data-decider]').forEach((b) => b.onclick = () => decider(carte, b.dataset.decider));
    });
    racine.querySelectorAll('[data-relier]').forEach((b) => b.onclick = () => {
      const tr = b.closest('tr');
      ouvrirRecherche(tr, (a) => relier(tr.dataset.offre, a.id));
    });
    racine.querySelectorAll('[data-annuler-lot]').forEach((b) => b.onclick = () => confirmerAnnulation(b.closest('[data-lot]')));
    const f = racine.querySelector('#cFiltreAutres');
    if (f) f.oninput = () => { etat.filtreAutres = f.value; const pos = f.selectionStart; rendre(); const g = racine.querySelector('#cFiltreAutres'); g.focus(); g.setSelectionRange(pos, pos); };
  }

  function ajouterOption(sel, a) {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = [a.nom, a.marque, a.format].filter(Boolean).join(' · ');
    sel.insertBefore(opt, sel.firstChild); sel.value = a.id;
  }

  function ouvrirRecherche(zone, choisir) {
    const panneau = zone.querySelector('[data-recherche]');
    panneau.hidden = false;
    panneau.innerHTML = '<input type="search" placeholder="🔎 Chercher dans ton catalogue" aria-label="Chercher un produit"><div class="c-choix"></div>';
    const inp = panneau.querySelector('input'), res = panneau.querySelector('.c-choix');
    const remplir = () => {
      const t = sansAccents(inp.value.trim());
      const l = articles().filter((a) => !t || sansAccents(`${a.nom} ${a.marque || ''}`).includes(t))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).slice(0, 40);
      res.innerHTML = l.map((a) => `<button type="button" class="c-btn" data-a="${esc(a.id)}">${esc([a.nom, a.marque, a.format].filter(Boolean).join(' · '))}</button>`).join('')
        || '<p class="c-doux">Aucun produit. Crée-le d\'abord dans le catalogue.</p>';
      res.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { const a = articles().find((x) => x.id === b.dataset.a); panneau.hidden = true; panneau.innerHTML = ''; choisir(a); });
    };
    inp.oninput = remplir; remplir(); inp.focus();
  }

  async function charger_(sourceId, circ, fichiers) {
    if (!fichiers.length) return;
    const s = SOURCE[sourceId];
    let ordre = Math.max(0, ...etat.pages.filter((p) => p.source === sourceId && p.circulaire === circ).map((p) => p.ordre));
    let n = 0;
    try {
      for (const f of fichiers) {
        etat.occupe = `Préparation de ${f.name}…`; rendre();
        const blobs = await preparerFichier(f, (t) => { etat.occupe = t; rendre(); });
        for (const blob of blobs) {
          if (etat.pages.length >= 60) throw new Error('Maximum 60 pages par envoi : envoie ce lot, puis continue.');
          etat.occupe = `Envoi de la page ${++n} (${s.nom})…`; rendre();
          const id = crypto.randomUUID();
          const chemin = `${foyer}/${etat.lot.id}/${id}.jpg`;
          const up = await sb.storage.from(BUCKET).upload(chemin, blob, { contentType: 'image/jpeg', upsert: false });
          if (up.error) throw new Error(`stockage : ${up.error.message}`);
          const { data, error } = await sb.from('pages_circulaires').insert({ id, lot_id: etat.lot.id, foyer_id: foyer, source: sourceId,
            banniere: s.banniere, circulaire: circ, ordre: ++ordre, chemin }).select().single();
          if (error) { await sb.storage.from(BUCKET).remove([chemin]); throw new Error(error.message); }
          etat.pages.push(data);
          etat.urls.set(id, URL.createObjectURL(blob));
        }
      }
      message(`${n} page(s) ajoutée(s) à ${s.nom}`);
    } catch (err) { message(`Chargement interrompu : ${err.message}`); }
    etat.occupe = ''; rendre();
  }

  async function retirer(id) {
    const p = etat.pages.find((x) => x.id === id);
    if (!p) return;
    const { error } = await sb.from('pages_circulaires').delete().eq('id', id);
    if (error) { message(`Impossible de retirer : ${error.message}`); return; }
    if (p.chemin) await sb.storage.from(BUCKET).remove([p.chemin]);
    etat.pages = etat.pages.filter((x) => x.id !== id);
    rendre();
  }

  async function envoyer() {
    etat.occupe = 'Envoi…'; rendre();
    const { data, error } = await sb.rpc('envoyer_lot', { p_lot: etat.lot.id });
    etat.occupe = '';
    if (error) { message(`Envoi refusé : ${error.message}`); rendre(); return; }
    message(`Envoyé : ${data} page(s). La lecture continue même si tu fermes l'app.`);
    etat.pages = []; etat.urls.clear();
    Object.keys(etat).filter((k) => k.startsWith('plus_')).forEach((k) => delete etat[k]);
    await charger();
  }

  async function decider(carte, decision, silencieux = false) {
    const id = carte.dataset.offre;
    const v = carte.querySelector('[data-produit]')?.value;
    const article = v && v !== '__chercher' ? v : null;
    const format = carte.querySelector('[data-format]')?.value.trim() || null;
    if (decision === 'valider' && !article) { message('Choisis le produit d\'abord.'); return false; }
    carte.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const { error } = await sb.rpc('decider_offre', { p_offre: id, p_decision: decision, p_article: article, p_format: format, p_source: source });
    if (error) { message(`Refusé : ${error.message}`); carte.querySelectorAll('button').forEach((b) => { b.disabled = false; }); return false; }
    etat.aValider = etat.aValider.filter((o) => o.id !== id);
    if (!silencieux) { message({ valider: 'Rabais enregistré', refuser: 'Noté : ce n\'est pas ce produit', ignorer: 'Ignoré' }[decision]); rendre(); opts.apresChangement?.(); }
    return true;
  }

  async function validerSelection() {
    const cartes = [...racine.querySelectorAll('.c-offre')].filter((c) => c.querySelector('[data-coche]')?.checked);
    if (!cartes.length) { message('Coche au moins un rabais.'); return; }
    let ok = 0;
    for (const c of cartes) if (await decider(c, 'valider', true)) ok++;
    message(`${ok} rabais enregistré(s)`);
    rendre(); opts.apresChangement?.();
  }

  async function relier(id, articleId) {
    const { error } = await sb.rpc('decider_offre', { p_offre: id, p_decision: 'valider', p_article: articleId, p_format: null, p_source: source });
    if (error) { message(`Refusé : ${error.message}`); return; }
    etat.autres = etat.autres.filter((o) => o.id !== id);
    message('Relié : rabais enregistré, et je m\'en souviendrai.');
    rendre(); opts.apresChangement?.();
  }

  function confirmerAnnulation(bloc) {
    if (bloc.querySelector('.c-confirmer')) return;
    bloc.insertAdjacentHTML('beforeend', `<div class="c-confirmer"><span>Annuler ce lot ? Ses prix déjà écrits seront marqués « annulés » (rien n'est supprimé) et ses rabais à valider seront ignorés.</span>
      <div class="c-rang"><button class="c-btn d" data-oui>Oui, annuler le lot</button><button class="c-btn" data-non>Non</button></div></div>`);
    bloc.querySelector('[data-non]').onclick = () => bloc.querySelector('.c-confirmer').remove();
    bloc.querySelector('[data-oui]').onclick = async () => {
      const { data, error } = await sb.rpc('annuler_lot', { p_lot: bloc.dataset.lot, p_source: source });
      if (error) { message(`Refusé : ${error.message}`); return; }
      message(`Lot annulé (${data} prix marqué(s) « annulés »)`);
      await charger(); opts.apresChangement?.();
    };
  }

  charger();
  return { arreter() { arrete = true; clearTimeout(etat.minuterie); }, recharger: charger };
}
