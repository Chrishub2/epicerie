// =====================================================================
// Fiche produit de la Console — chargement des VRAIES données (lecture seule).
// Même connexion que l'app et la Console (session partagée sur ce site).
// Lit les objets du foyer, construit chaque fiche (fiche-donnees.js) et affiche celle demandée (?id=…).
// Rien n'est écrit : les choix faits dans la page restent en mémoire.
// =====================================================================
import { SourceSupabase, construireEtat } from './source.js';
import { construireFiche } from './fiche-donnees.js';
import { BANNIERES } from '../demo-data.js';

const etat = (texte) => {
  const el = document.getElementById('etatFiche');
  if (texte == null) { document.documentElement.removeAttribute('data-etat-fiche'); return; }
  document.documentElement.dataset.etatFiche = 'message';
  el.innerHTML = texte;
};
const json = (f) => fetch(`../visuels/${f}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
// Fenêtre des prix montrés : 45 jours (le plus récent par bannière et par produit lu)
const depuis = () => new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);

async function demarrer() {
  const src = new SourceSupabase();
  let session;
  try { session = await src.connecter(); } catch { etat('Connexion impossible. Vérifie ton réseau, puis recharge la page.'); return; }
  if (!session) { etat('Connecte-toi d’abord dans la <a href="./">Console</a> (même compte que l’app), puis reviens à cette fiche.'); return; }
  try {
    if (!(await src.chargerFoyer())) { etat('Ce compte n’a pas de foyer.'); return; }
    etat('Chargement de tes produits…');
    const e = construireEtat(await src.chargerObjets((n) => etat(`Chargement de tes produits… ${n.toLocaleString('fr-CA')} objets`)), src.membres);
    const [ref, corr, index] = await Promise.all([json('referentiel.json'), json('correspondance.json'), json('index.json')]);
    const opts = { ref, corr: corr || {}, dispo: new Set(index || []), base: '../visuels/', depuis: depuis() };
    const prixPar = new Map();
    for (const p of e.prix) { if (!prixPar.has(p.articleId)) prixPar.set(p.articleId, []); prixPar.get(p.articleId).push(p); }
    const rayons = new Map(e.rayons.map((r) => [r.id, r.nom]));
    for (const a of e.articles) {
      try { REELS[a.id] = construireFiche(a, prixPar.get(a.id) || [], { ...opts, nomRayon: rayons.get(a.rayonId) || '' }); }
      catch (err) { console.warn('Fiche non construite :', a.id, err); }
    }
    // Noms des bannières pour toutes celles qui ont des prix
    for (const [k, b] of Object.entries(BANNIERES)) if (!BAN[k]) BAN[k] = { nom: b.nom, c: '#8d99ae' };
    for (const r of Object.values(REELS)) for (const v of [...r.var, ...r.liens]) if (v.ban && !BAN[v.ban]) BAN[v.ban] = { nom: v.ban, c: '#8d99ae' };
    const sel = document.getElementById('choixProduit');
    const tri = Object.values(REELS).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    sel.innerHTML = tri.map((r) => `<option value="${r.cle}">${r.nom.replace(/[<&"]/g, '')}</option>`).join('');
    const voulu = new URLSearchParams(location.search).get('id');
    const cle = REELS[voulu] ? voulu : tri[0]?.cle;
    if (!cle) { etat('Aucun produit dans ton catalogue.'); return; }
    chargerProduit(cle);
    etat(null);
    // Changer de produit garde l'adresse à jour (retour arrière, lien à partager à soi-même)
    sel.addEventListener('change', () => history.replaceState(null, '', `?id=${encodeURIComponent(sel.value)}`));
    document.getElementById('menu')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-produit]'); if (b) history.replaceState(null, '', `?id=${encodeURIComponent(b.dataset.produit)}`);
    });
  } catch (err) {
    etat(`Lecture impossible : ${String(err?.message || err).replace(/[<&]/g, '')}. Recharge la page.`);
  }
}
demarrer();
