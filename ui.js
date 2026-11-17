// Outils partagés : échappement, fenêtre modale, calculs de prix.
import { normaliser, libelleUnitaire, classer } from './normalise.js';
import { get } from './store.js';
import { BANNIERES } from './demo-data.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const argent = (x) => x == null || !isFinite(x) ? '—'
  : x.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

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
const LOGOS = { iga: 'IGA', super_c: 'SUPER C', metro: 'metro', maxi: 'maxi', costco: 'COSTCO', jean_coutu: 'Jean Coutu', provigo: 'provigo', walmart: 'Walmart ✱', voila: 'voilà', instacart: '🥕 instacart' };
export function logo(b) {
  return LOGOS[b] ? `<span class="logo logo-${b}" title="${esc(nomBanniere(b))}">${LOGOS[b]}</span>` : esc(nomBanniere(b));
}
/** Logo + ville(s) : « [IGA] Beloeil, Varennes ». */
export function logoVille(b) {
  const villes = [...new Set(magasinsActifs(b).map(villeMagasin).filter(Boolean))];
  return `${logo(b)}${villes.length ? ` <span class="ville">${esc(villes.join(', '))}</span>` : ''}`;
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
  apres?.($('#modaleCorps'));
}
let surFermeture = null;
// Appelé une seule fois par fermeture (bouton ✕, fermerModale ou touche Échap via l'événement « close »)
function apresFermeture() { const f = surFermeture; surFermeture = null; f?.(); }
export function fermerModale() { if (dlg().open) dlg().close(); apresFermeture(); }
export function quandFermee(fn) { surFermeture = fn; }
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
    const f = (a) => !t || norm(a.nom).includes(t) || norm(a.marque).includes(t);
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
    panneau.innerHTML = `<input class="selFiltre" placeholder="🔎 Chercher ou taper un nouveau nom…" style="margin-top:6px;width:100%"><div class="selRes" style="max-height:45vh;overflow-y:auto"></div>`;
    const inp = panneau.querySelector('.selFiltre'), res = panneau.querySelector('.selRes');
    remplir(res, '');
    inp.oninput = () => remplir(res, inp.value);
    panneau.onclick = (e2) => { const o = e2.target.closest('[data-pick]'); if (o) { e2.preventDefault(); fermer(panneau); surChoix(o.dataset.pick); } };
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
export function offresArticle(article) {
  const e = get();
  const lignes = [];
  // Toutes les marques/formats du produit sont comparées au kg / L ; une variante retirée ne compte plus
  const variantes = new Map((article.variantes || []).map((v) => [v.id, v]));
  for (const p of e.prix.filter((x) => x.articleId === article.id)) {
    if (p.fin && joursRestants(p.fin) < 0) continue;
    if (p.enAttente) continue; // photo pas encore lue (hors ligne)
    if (p.annule) continue;    // prix d'une association de reçu corrigée
    if (!banniereActive(p.banniere)) continue;
    if (article.exclusif && p.banniere !== article.exclusif) continue;
    const v = variantes.get(p.varianteId);
    if (v?.retiree) continue;
    // Format du prix, sinon celui de SA variante (pas celui de la fiche : 2 kg ≠ 900 g)
    let n = normaliser(p.offre, p.format || v?.format || article.format, article.uniteRef);
    // Format illisible mais prix unitaire fourni par la source (épiceries.ca) dans la bonne unité
    if (n.erreur && p.uniteSource && p.uniteSource.unite === article.uniteRef) {
      n = { prixUnitaire: p.uniteSource.pu, uniteRef: article.uniteRef, prixArticle: null };
    }
    const economie = p.prixRegulier && p.prixNum && p.prixRegulier > p.prixNum + 0.004 ? p.prixRegulier - p.prixNum : null;
    lignes.push({ ...p, pu: n.prixUnitaire ?? null, prixArticle: n.prixArticle ?? null, uniteRef: n.uniteRef || article.uniteRef, erreur: n.erreur, economie,
      produitOffre: produitDeLOffre(article, p, v) });
  }
  for (const r of rabaisPersoActifs()) {
    const m = e.magasins.find((x) => x.id === r.magasinId);
    if (!m || m.actif === false) continue;
    const base = lignes.filter((l) => l.banniere === m.banniere && !l.perso && l.pu != null).sort((a, b) => a.pu - b.pu)[0];
    if (!base) continue;
    const k = 1 - r.pct / 100;
    lignes.push({ ...base, perso: true, magasinNom: m.nom, pu: base.pu * k, prixArticle: base.prixArticle == null ? null : base.prixArticle * k,
      rabaisTexte: `−${r.pct} % perso${r.plafond ? ` (sur ${r.plafond} $)` : ''}` });
  }
  lignes.sort((a, b) => (a.pu ?? Infinity) - (b.pu ?? Infinity));
  const avecPrix = lignes.filter((l) => l.pu != null);
  const meilleur = avecPrix[0]?.pu ?? null;
  const pire = avecPrix.length > 1 ? avecPrix[avecPrix.length - 1].pu : null;
  lignes.forEach((l) => {
    l.classe = classer(l.pu, meilleur);
    if (pire != null && l.pu === pire && pire > meilleur) l.classe = 'cher'; // rouge = le plus cher
  });
  return lignes;
}

/**
 * Quelle marque/format est derrière ce prix (seulement si le produit en a plusieurs) :
 * le nom du produit chez la bannière (épiceries.ca) ou la variante (« Tilda · 2 kg »).
 */
function produitDeLOffre(article, p, v) {
  if (p.source === 'flipp' && p.nomProduit) return p.nomProduit; // trouvé par la récolte : montrer le produit exact
  const actives = (article.variantes || []).filter((x) => !x.retiree);
  if (actives.length < 2) return '';
  if (p.nomProduit) return p.nomProduit;
  return v ? [v.marque, v.nom, v.format].filter(Boolean).join(' · ') : '';
}

export function meilleureOffre(article) { return offresArticle(article).find((l) => l.pu != null) || null; }

/** Nom affiché d'une offre : « IGA Extra Varennes » (rabais perso) ou « IGA · Beloeil ». */
export function nomOffre(o) { return o.magasinNom || nomBanniereVille(o.banniere); }

export { libelleUnitaire };

/** Petite notification en bas d'écran. */
export function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#1d2320;color:#fff;padding:8px 14px;border-radius:10px;z-index:50;font-size:14px;max-width:90vw';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
