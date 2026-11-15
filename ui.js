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

// ---------------------------------------------------------------------
// Fenêtre modale
// ---------------------------------------------------------------------
const dlg = () => $('#modale');
export function ouvrirModale(titre, html, apres) {
  $('#modaleTitre').textContent = titre;
  $('#modaleCorps').innerHTML = html;
  if (!dlg().open) dlg().showModal();
  apres?.($('#modaleCorps'));
}
export function fermerModale() { if (dlg().open) dlg().close(); }
let surFermeture = null;
export function quandFermee(fn) { surFermeture = fn; }
document.addEventListener('DOMContentLoaded', () => {
  $('#modaleFermer').onclick = fermerModale;
  dlg().addEventListener('close', () => { const f = surFermeture; surFermeture = null; f?.(); });
});

// ---------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------
function rabaisPersoActifs() {
  const e = get();
  return e.rabaisPerso.filter((r) => r.actif && (r.expiration === '' || r.expiration == null || joursRestants(r.expiration) >= 0));
}

/**
 * Toutes les offres d'un article, normalisées et triées du moins cher au plus cher.
 * Ajoute une ligne « prix effectif » pour chaque magasin avec un rabais perso actif.
 */
export function offresArticle(article) {
  const e = get();
  const lignes = [];
  for (const p of e.prix.filter((x) => x.articleId === article.id)) {
    if (p.fin && joursRestants(p.fin) < 0) continue;
    let n = normaliser(p.offre, p.format || article.format, article.uniteRef);
    // Format illisible mais prix unitaire fourni par la source (épiceries.ca) dans la bonne unité
    if (n.erreur && p.uniteSource && p.uniteSource.unite === article.uniteRef) {
      n = { prixUnitaire: p.uniteSource.pu, uniteRef: article.uniteRef, prixArticle: null };
    }
    lignes.push({ ...p, pu: n.prixUnitaire ?? null, prixArticle: n.prixArticle ?? null, uniteRef: n.uniteRef || article.uniteRef, erreur: n.erreur });
  }
  for (const r of rabaisPersoActifs()) {
    const m = e.magasins.find((x) => x.id === r.magasinId);
    if (!m) continue;
    const base = lignes.filter((l) => l.banniere === m.banniere && !l.perso && l.pu != null).sort((a, b) => a.pu - b.pu)[0];
    if (!base) continue;
    const k = 1 - r.pct / 100;
    lignes.push({ ...base, perso: true, magasinNom: m.nom, pu: base.pu * k, prixArticle: base.prixArticle == null ? null : base.prixArticle * k,
      rabaisTexte: `−${r.pct} % perso${r.plafond ? ` (sur ${r.plafond} $)` : ''}` });
  }
  lignes.sort((a, b) => (a.pu ?? Infinity) - (b.pu ?? Infinity));
  const meilleur = lignes.find((l) => l.pu != null)?.pu ?? null;
  lignes.forEach((l) => { l.classe = classer(l.pu, meilleur); });
  return lignes;
}

export function meilleureOffre(article) { return offresArticle(article).find((l) => l.pu != null) || null; }

export { libelleUnitaire };

/** Petite notification en bas d'écran. */
export function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#1d2320;color:#fff;padding:8px 14px;border-radius:10px;z-index:50;font-size:14px;max-width:90vw';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
