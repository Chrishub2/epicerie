// =====================================================================
// Circulaires de la semaine (app v55) — même écran dans l'app (Plus → Circulaires) et dans la console.
// Chris charge ses captures (images ou PDF) par bannière dans un BROUILLON partagé du foyer,
// puis touche « Envoyer ». Le lot passe « en attente de lecture » : la lecture se fait sur le PC, quand Chris
// dit « lis mes circulaires » à Claude (abonnement, 0 $ d'API) ; les rabais sûrs sont écrits, les douteux
// reviennent ici, « À valider ». Spec : journal/SPEC-circulaires.md, journal/SPEC-lecture-claude-code.md
// Aucune écriture directe : envoi, décisions et annulations passent par les fonctions de la base
// (envoyer_lot, decider_offre, annuler_offre, annuler_lot) — mêmes règles pour le téléphone et la console.
// =====================================================================
import { couverture, tableauHtml, jourQuebec } from './couverture-circulaires.js';

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
  { id: 'provigo', nom: 'Provigo', banniere: 'provigo' },
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

/** Nom lisible d'une bannière (la première source qui la porte : maxi → « Maxi »). */
export function nomBanniere(b) {
  return SOURCES_CIRC.find((s) => s.banniere === b)?.nom || b;
}

/** Clé d'un lien appris : « banniere|nom_cle|article ». */
export const cleLien = (l) => `${l.banniere}|${l.nom_cle}|${l.article_id}`;

/**
 * Liens appris à confirmer (spec : journal/SPEC-apprentissage-liens.md, § 3).
 * appris : lignes de appris_circulaires ; offres : { banniere, nom_cle, nom, cree_le } ; articles : catalogue.
 * Garde origine 'auto', confirme null, decision 'lien' ; nom = dernier rabais de ce nom_cle et bannière, sinon nom_cle.
 * dejaTraites : Set de cleLien déjà confirmés ou refusés pendant la session (la base peut encore les renvoyer un moment).
 * Rend [{ banniere, nom_cle, article_id, format, nom, banniereNom, produit, libelle }], les plus récents d'abord.
 */
export function liensAConfirmer(appris, offres, articles, dejaTraites = null) {
  const dernier = new Map();
  for (const o of offres || []) {
    const k = `${o.banniere}|${o.nom_cle}`, d = dernier.get(k);
    if (o.nom && (!d || String(o.cree_le || '') > String(d.cree_le || ''))) dernier.set(k, o);
  }
  const parId = new Map((articles || []).map((a) => [a.id, a]));
  return (appris || [])
    .filter((l) => l.origine === 'auto' && l.confirme === null && l.decision === 'lien' && !dejaTraites?.has(cleLien(l)))
    .sort((a, b) => String(b.maj || '').localeCompare(String(a.maj || '')))
    .map((l) => {
      const nom = dernier.get(`${l.banniere}|${l.nom_cle}`)?.nom || l.nom_cle;
      const banniereNom = nomBanniere(l.banniere);
      const produit = parId.get(l.article_id)?.nom || `produit introuvable (${l.article_id})`;
      const libelle = `${nom} (${banniereNom}) → ${produit}${l.format ? ` · ${l.format}` : ''}`;
      return { banniere: l.banniere, nom_cle: l.nom_cle, article_id: l.article_id, format: l.format || null, nom, banniereNom, produit, libelle };
    });
}

// ---------------------------------------------------------------------
// Données (Supabase) — utilisables par l'app et la console
// ---------------------------------------------------------------------
export async function compterAValider(sb, foyer) {
  if (!sb || !foyer) return 0;
  const { count } = await sb.from('offres_circulaires').select('id', { count: 'exact', head: true }).eq('foyer_id', foyer).eq('statut', 'a_valider');
  return count || 0;
}

/** Offres de circulaires encore utiles (fin ≥ hier, heure du Québec) : lignes { source, debut, fin }, par pages de 1 000. */
async function offresDates(sb, foyer) {
  const [a, m, j] = jourQuebec().split('-').map(Number);
  const hier = new Date(Date.UTC(a, m - 1, j - 1)).toISOString().slice(0, 10);
  const out = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await sb.from('offres_circulaires').select('source,debut,fin').eq('foyer_id', foyer)
      .not('debut', 'is', null).gte('fin', hier).order('id').range(debut, debut + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
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
.circ .c-couv summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.circ .c-liens summary { cursor: pointer; }
.circ .c-liens summary h2 { display: inline; }
.circ .c-lien { padding-top: 8px; border-top: 1px solid var(--c-trait); }
.circ .c-lien .c-btn { min-width: 40px; }
.circ .c-couv .cv-table { max-width: 420px; margin-top: 6px; }
.circ .c-couv th { text-align: left; font-weight: 600; padding: 4px; color: var(--c-doux); }
.circ .c-couv th + th, .circ .c-couv td + td { text-align: center; }
.circ .c-couv td { padding: 4px; }
.circ .c-couv .cv-oui { color: var(--c-accent); font-weight: 700; cursor: help; }
.circ .c-couv .cv-non { color: var(--c-doux); }
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
  const etat = { lot: null, pages: [], urls: new Map(), lots: [], aValider: [], autres: [], filtreAutres: '', minuterie: null, occupe: '', offresDates: null, couvOuverte: true, liens: null, liensOuverts: true, liensTraites: new Set(), offresTraitees: new Set() };
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
      const [pages, lots, aval, dates, liens] = await Promise.all([
        sb.from('pages_circulaires').select('*').eq('lot_id', etat.lot.id).order('source').order('circulaire').order('ordre'),
        sb.from('lots_circulaires').select('*').eq('foyer_id', foyer).neq('statut', 'brouillon').order('cree_le', { ascending: false }).limit(6),
        sb.from('offres_circulaires').select('*').eq('foyer_id', foyer).eq('statut', 'a_valider').order('cree_le').limit(300),
        offresDates(sb, foyer).catch(() => null),   // couverture : facultative, n'empêche pas le reste
        chargerLiens(),                              // liens appris : facultatifs (null si la base n'est pas prête)
      ]);
      etat.offresDates = dates;
      etat.liens = liens && liens.filter((l) => !etat.liensTraites.has(cleLien(l)));   // clic pendant ce chargement
      etat.pages = pages.data || [];
      etat.lots = lots.data || [];
      etat.aValider = (aval.data || []).filter((o) => !etat.offresTraitees.has(o.id));   // clic pendant ce chargement
      const derniers = etat.lots.filter((l) => l.statut === 'termine').slice(0, 2).map((l) => l.id);
      etat.autres = derniers.length
        ? ((await sb.from('offres_circulaires').select('*').in('lot_id', derniers).eq('statut', 'autre').order('nom').limit(800)).data || []).filter((o) => !etat.offresTraitees.has(o.id)) : [];
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

  /** Liens appris à confirmer. null si la requête échoue (ex. colonnes origine/confirme pas encore créées) : la section ne s'affiche pas. */
  async function chargerLiens() {
    try {
      const { data, error } = await sb.from('appris_circulaires').select('banniere,nom_cle,article_id,decision,format,n,maj,origine,confirme')
        .eq('foyer_id', foyer).eq('origine', 'auto').is('confirme', null).eq('decision', 'lien').order('maj', { ascending: false }).limit(300);
      if (error || !data) return null;
      let offres = [];
      const cles = [...new Set(data.map((l) => l.nom_cle))];
      if (cles.length) {
        const r = await sb.from('offres_circulaires').select('banniere,nom_cle,nom,cree_le').eq('foyer_id', foyer).in('nom_cle', cles)
          .order('cree_le', { ascending: false }).limit(1000);
        offres = r.data || [];   // facultatif : sinon, on montre le nom_cle
      }
      return liensAConfirmer(data, offres, opts.articles?.() || [], etat.liensTraites);
    } catch { return null; }
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
          La lecture se fait quand tu le demandes à Claude sur le PC (« lis mes circulaires »). Le brouillon est partagé : tu peux commencer sur le téléphone et finir à l'ordinateur. « auto » : la bannière a aussi des prix automatiques (épiceries.ca).</p>
        ${etat.occupe ? `<p class="c-doux">⏳ ${esc(etat.occupe)}</p>` : ''}
        ${blocCouverture()}
        <div class="c-sources">${SOURCES_CIRC.map(carteSource).join('')}</div>
      </div>
      ${blocAValider()}
      ${blocLiens()}
      ${blocLots()}
      ${blocAutres()}`;
    brancher();
  }

  /** Tableau courante / suivante (✓ : la circulaire est dans ta base ; la bulle donne les dates et le nombre de rabais). */
  function blocCouverture() {
    if (!etat.offresDates) return '';
    return `<details class="c-couv" ${etat.couvOuverte ? 'open' : ''}><summary>Couverture : courante / suivante</summary>
      ${tableauHtml(couverture(etat.offresDates, SOURCES_CIRC, jourQuebec()))}</details>`;
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
      <div class="c-rang"><h2 class="c-grandir">🔎 ${etat.aValider.length} rabais incertains <span class="c-doux" style="font-weight:400">(facultatif)</span></h2>
        <button class="c-btn" data-valider-sel>Valider la sélection</button></div>
      <p class="c-doux">Les rabais <b>sûrs</b> sont déjà enregistrés automatiquement. Ceux-ci sont incertains : ils ne sont <b>pas</b> enregistrés, et tu peux les ignorer.
        Si tu en valides un, je retiens le lien pour les prochaines circulaires. « Pas ce produit » m'apprend à ne plus le proposer.${auto ? ` ${auto} coché(s) d'avance.` : ''}</p>
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

  /** Liens appris tout seuls par la lecture : déjà utilisés, Chris les confirme (✓) ou les défait pour l'avenir (✗). */
  function blocLiens() {
    if (!etat.liens?.length) return '';
    return `<details class="c-bloc c-liens" ${etat.liensOuverts ? 'open' : ''}><summary><h2>🧠 Liens appris à confirmer (${etat.liens.length})</h2></summary>
      <p class="c-doux">La lecture a appris ces liens toute seule et s'en sert déjà. ✓ : c'est bien ce produit. ✗ : je défais le lien pour l'avenir (les prix déjà écrits restent).</p>
      ${etat.liens.map((l) => `<div class="c-rang c-lien" data-banniere="${esc(l.banniere)}" data-nom-cle="${esc(l.nom_cle)}" data-article="${esc(l.article_id)}">
        <span class="c-grandir">${esc(l.libelle)}</span>
        <button type="button" class="c-btn p" data-confirmer-lien="1" aria-label="Confirmer le lien" title="Confirmer le lien">✓</button>
        <button type="button" class="c-btn d" data-confirmer-lien="0" aria-label="Refuser le lien (les prix déjà écrits restent)" title="Refuser le lien (les prix déjà écrits restent)">✗</button>
      </div>`).join('')}
    </details>`;
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
      } else if (l.statut === 'en_attente') {
        corps = '<div class="c-doux">En attente : Claude Code le lira quand tu le demanderas (« lis mes circulaires »).</div>';
      } else corps = '<div class="c-doux">Annulé : ses prix sont marqués « annulés » (rien n\'est supprimé).</div>';
      return `<div class="c-circ" data-lot="${l.id}"><div class="c-rang"><b class="c-grandir">${esc(dateCourte(l.envoye_le || l.cree_le))} ${esc(heure(l.envoye_le || l.cree_le))}</b>
        <span class="c-pastille">${{ en_attente: 'en attente de lecture', envoye: 'en cours', termine: 'terminé', annule: 'annulé' }[l.statut] || l.statut}</span>
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
    racine.querySelector('.c-couv')?.addEventListener('toggle', (ev) => { etat.couvOuverte = ev.currentTarget.open; });
    racine.querySelector('.c-liens')?.addEventListener('toggle', (ev) => { etat.liensOuverts = ev.currentTarget.open; });
    racine.querySelectorAll('[data-confirmer-lien]').forEach((b) => b.onclick = () => confirmerLien(b.closest('.c-lien'), b.dataset.confirmerLien === '1'));
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
    const { data, error } = await sb.rpc('envoyer_lot', { p_lot: etat.lot.id, p_attendre: true });
    etat.occupe = '';
    if (error) { message(`Envoi refusé : ${error.message}`); rendre(); return; }
    message(`Envoyé : ${data} page(s). Elles seront lues quand tu diras « lis mes circulaires » à Claude sur le PC.`);
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
    etat.offresTraitees.add(id);   // dès le clic : un rechargement en vol ne la fait pas revenir
    const { error } = await sb.rpc('decider_offre', { p_offre: id, p_decision: decision, p_article: article, p_format: format, p_source: source });
    if (error && !/déjà traité/.test(error.message)) { etat.offresTraitees.delete(id); message(`Refusé : ${error.message}`); carte.querySelectorAll('button').forEach((b) => { b.disabled = false; }); return false; }
    etat.aValider = etat.aValider.filter((o) => o.id !== id);
    if (!silencieux) { message({ valider: 'Rabais enregistré', refuser: 'Noté : ce n\'est pas ce produit', ignorer: 'Ignoré' }[decision]); rendre(); opts.apresChangement?.(); }
    return true;
  }

  async function confirmerLien(ligne, ok) {
    const { banniere, nomCle, article } = ligne.dataset;
    const cle = cleLien({ banniere, nom_cle: nomCle, article_id: article });
    if (etat.liensTraites.has(cle)) return;
    etat.liensTraites.add(cle);   // dès le clic : un rechargement en vol ne le fait pas revenir (pas de ✓ puis ✗)
    ligne.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const { error } = await sb.rpc('confirmer_lien', { p_banniere: banniere, p_nom_cle: nomCle, p_article: article, p_ok: ok });
    if (error) {
      etat.liensTraites.delete(cle);
      message(`Refusé : ${error.message}`); ligne.querySelectorAll('button').forEach((b) => { b.disabled = false; }); return;
    }
    etat.liens = (etat.liens || []).filter((l) => cleLien(l) !== cle);
    message(ok ? 'Lien confirmé' : 'Lien défait pour l\'avenir (les prix déjà écrits restent)');
    rendre(); opts.apresChangement?.();
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
    etat.offresTraitees.add(id);
    const { error } = await sb.rpc('decider_offre', { p_offre: id, p_decision: 'valider', p_article: articleId, p_format: null, p_source: source });
    if (error && !/déjà traité/.test(error.message)) { etat.offresTraitees.delete(id); message(`Refusé : ${error.message}`); return; }
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
