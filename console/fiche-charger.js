// =====================================================================
// Fiche produit de la Console — VRAIES données, avec enregistrement (étape 2).
// Même connexion que l'app et la Console (session partagée sur ce site).
// Lit les objets du foyer, construit chaque fiche (fiche-donnees.js) et affiche celle demandée (?id=…).
// Enregistré avec « Enregistrer » (jamais en silence) : famille, sorte, code, caractéristiques, noms,
// confirmations et avertissements ignorés de la Santé, remplacement accepté.
// Chaque écriture passe par ecrire_objet : contrôle de version (refus si le produit a changé ailleurs) et historique.
// Les prix ne sont jamais modifiés ici (ajout seulement, par règle de la base).
// =====================================================================
import { SourceSupabase, construireEtat, differences } from './source.js';
import { construireFiche, appliquerFiche } from './fiche-donnees.js';
import { remplacementDe } from '../choix.js';
import { BANNIERES } from '../demo-data.js';

const $ = (id) => document.getElementById(id);
const copie = (o) => JSON.parse(JSON.stringify(o));
const afficherEtat = (texte) => {
  if (texte == null) { document.documentElement.removeAttribute('data-etat-fiche'); return; }
  document.documentElement.dataset.etatFiche = 'message';
  $('etatFiche').innerHTML = texte;
};
const json = (f) => fetch(`../visuels/${f}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
// Fenêtre des prix montrés : 45 jours (le plus récent par bannière et par produit lu)
const depuis = () => new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
const NOMS_CHAMPS = { sorte: 'sorte', seulChez: 'seulement chez', annulesVus: 'prix annulés vus', santeIgnores: 'avertissements ignorés', plu: 'PLU', codes: 'code-barres',
  caracteristiques: 'caractéristiques', nomEn: 'nom anglais', nomsAlt: 'noms alternatifs', nomsAltEn: 'noms anglais', liensDecides: 'liens confirmés ou refusés', generique: 'famille', generiqueNom: 'famille (nouvelle)', remplacement: 'remplacement' };

const src = new SourceSupabase();
let E = null, opts = null, personne = '', courant = null;   // courant = { id, version, base, genIdDepart }
const prixDe = (id) => E.prix.filter((p) => p.articleId === id);
const rayons = () => new Map(E.rayons.map((r) => [r.id, r.nom]));

function construire(a) {
  REELS[a.id] = construireFiche(a, prixDe(a.id), { ...opts, nomRayon: rayons().get(a.rayonId) || '' });
}

// ---------- Familles : le référentiel complet (avec identifiant) + celles créées dans la page
const CREEES = [];
window.FAMILLES_REF = () => {
  const g = opts?.ref?.generiques || {};
  const l = Object.entries(g).map(([id, r]) => ({ id, gen: r[2], cat: r[0], sc: r[1], en: '' }));
  if (P.genNouveau && P.gen && !l.some((f) => f.gen === P.gen)) l.unshift({ gen: P.gen, cat: P.cat, sc: P.sc, en: '' });
  return [...l, ...CREEES];
};
// « Créer la famille » de la page pousse dans FAMILLES_CREEES : on la relaie
if (typeof FAMILLES_CREEES !== 'undefined') {
  const push = FAMILLES_CREEES.push.bind(FAMILLES_CREEES);
  FAMILLES_CREEES.push = (...f) => { CREEES.push(...f); return push(...f); };
}

// ---------- État de la page ← données du produit
function initialiser(a) {
  const r = REELS[a.id];
  P.genId = r.genId; P.genNouveau = !r.genId && !!a.generiqueNom;
  const c = conf();
  Object.assign(c, { sorte: '', code: '', seul: !!a.seulChez, annulesVus: !!a.annulesVus, ignores: copie(a.santeIgnores || {}) });
  carac.clear();
  for (const [k, v] of Object.entries(a.caracteristiques || {})) if (DICO.some((d) => d.k === k && d.vals.includes(v))) carac.set(k, v);
  etat.alias = { fr: [...(a.nomsAlt || [])], en: [...(a.nomsAltEn || [])] };
  $('fNomEn').value = a.nomEn || '';
  etat.rempl = remplacementDe(a, personne);
  $('fRempl').value = etat.rempl; $('remplDefaut').hidden = etat.rempl !== 'sorte';
  courant = { id: a.id, version: a._version ?? null, base: copie(a), genIdDepart: r.genId };
  rendCarac(); rendAlias(); tout();
  majBarre();
}

// ---------- Données du produit ← état de la page
function lireFiche() {
  const c = conf(), ban = [...new Set(VAR.map((v) => v.ban))];
  return appliquerFiche(courant.base, {
    sorte: c.sorte, seulChez: c.seul && ban.length === 1 ? ban[0] : (c.seul ? courant.base.seulChez : null),
    annulesVus: c.annulesVus, ignores: c.ignores, code: c.code,
    caracs: [...carac], nomEn: $('fNomEn').value, alias: etat.alias,
    genId: P.genId, genIdDepart: courant.genIdDepart, genNouveau: P.genNouveau, genNom: P.gen, rempl: $('fRempl').value,
    liens: LIENS.map((l) => ({ id: l.id, statut: l.statut })),
  }, personne);
}

// ---------- Barre « Enregistrer »
const barre = document.createElement('div');
barre.id = 'barreSauver';
barre.setAttribute('role', 'region'); barre.setAttribute('aria-label', 'Changements à enregistrer');
barre.innerHTML = '<span id="bsTexte"></span><span class="bs-actions"><button type="button" class="btn" id="bsAnnuler">Annuler</button><button type="button" class="btn bs-ok" id="bsOk">Enregistrer</button></span>';
barre.hidden = true;
const style = document.createElement('style');
style.textContent = `#barreSauver { position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom, 0px)); translate: -50% 0; z-index: 50; display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
  max-width: calc(100vw - 32px); padding: 10px 14px; border-radius: 10px; background: var(--surface, #1e252b); border: 1px solid var(--trait-fort, #445); box-shadow: 0 8px 28px rgba(0,0,0,.35); font-size: 14px; }
#barreSauver .bs-actions { display: flex; gap: 8px; }
#barreSauver .bs-ok { background: var(--etiquette, #e9c46a); color: var(--etiquette-texte, #111); font-weight: 600; }
#barreSauver[data-etat="erreur"] #bsTexte { color: var(--erreur, #ff8a8a); }
#barreSauver[data-etat="ok"] #bsTexte { color: var(--ok, #5fd69c); }
#bsEntete { font: inherit; font-size: 13px; font-weight: 600; padding: 4px 12px; border-radius: 6px; cursor: pointer; white-space: nowrap;
  background: var(--etiquette, #e9c46a); color: var(--etiquette-texte, #111); border: 1px solid transparent; }
#bsEntete:disabled { cursor: default; background: transparent; color: var(--texte-3, #8a94a0); border-color: var(--trait, #333c44); font-weight: 500; }`;
document.head.appendChild(style);
document.body.appendChild(barre);
// Bouton toujours visible dans l'en-tête, à côté du menu des produits (gris quand il n'y a rien à enregistrer)
const boutonEntete = document.createElement('button');
boutonEntete.type = 'button'; boutonEntete.id = 'bsEntete'; boutonEntete.disabled = true;
boutonEntete.textContent = '💾 Enregistrer';
$('choixProduit').closest('label').after(boutonEntete);
boutonEntete.onclick = () => $('bsOk').click();

let ecriture = false;
function changements() {
  if (!courant) return { liste: [], erreur: null, data: null };
  const { data, erreur } = lireFiche();
  if (erreur) return { liste: [], erreur, data: null };
  return { liste: differences(courant.base, data, 20), erreur: null, data };
}
function majBarre(message, type) {
  if (ecriture) return;
  const ch = changements();
  if (message) { boutonEntete.disabled = true; barre.dataset.etat = type; $('bsTexte').textContent = message; barre.hidden = false; $('bsOk').hidden = $('bsAnnuler').hidden = type === 'ok'; return; }
  delete barre.dataset.etat;
  if (ch.erreur) { boutonEntete.disabled = true; boutonEntete.title = ch.erreur; barre.dataset.etat = 'erreur'; $('bsTexte').textContent = ch.erreur; $('bsOk').hidden = true; $('bsAnnuler').hidden = false; barre.hidden = false; return; }
  barre.hidden = !ch.liste.length;
  $('bsOk').hidden = $('bsAnnuler').hidden = false;
  const noms = [...new Set(ch.liste.map((x) => NOMS_CHAMPS[x.champ] || x.champ))];
  $('bsTexte').textContent = `${noms.length} changement${noms.length > 1 ? 's' : ''} : ${noms.join(', ')}`;
  boutonEntete.disabled = !noms.length;
  boutonEntete.textContent = noms.length ? `💾 Enregistrer (${noms.length})` : '💾 Enregistrer';
  boutonEntete.title = noms.length ? `À enregistrer : ${noms.join(', ')}` : 'Aucun changement à enregistrer';
}
// Après chaque geste dans la page (les gestionnaires de la page passent d'abord)
['change', 'click', 'input', 'keydown'].forEach((t) => document.addEventListener(t, (ev) => { if (!barre.contains(ev.target) && ev.target !== boutonEntete) setTimeout(() => majBarre(), 0); }));

$('bsAnnuler').onclick = () => { const a = E.articles.find((x) => x.id === courant.id); chargerProduit(a.id); };
$('bsOk').onclick = async () => {
  const ch = changements();
  if (!ch.data || !ch.liste.length) return;
  ecriture = true; $('bsOk').disabled = true; $('bsTexte').textContent = 'Enregistrement…';
  try {
    const v = await src.ecrire('article', courant.id, ch.data, courant.version, 'console');
    // Le produit enregistré devient la nouvelle base (version incluse) ; la fiche est reconstruite avec lui
    const i = E.articles.findIndex((x) => x.id === courant.id);
    const a = { ...ch.data };
    Object.defineProperty(a, '_version', { value: v ?? (courant.version ?? 0) + 1, enumerable: false, writable: true });
    E.articles[i] = a;
    construire(a);
    ecriture = false; $('bsOk').disabled = false;
    chargerProduit(a.id);
    majBarre(`Enregistré : ${[...new Set(ch.liste.map((x) => NOMS_CHAMPS[x.champ] || x.champ))].join(', ')}.`, 'ok');
    setTimeout(() => majBarre(), 3500);
  } catch (err) {
    ecriture = false; $('bsOk').disabled = false;
    majBarre(err.conflit ? 'Ce produit a été modifié ailleurs (app ou Console) depuis l’ouverture de la fiche. Recharge la page pour voir sa dernière version, puis refais tes changements.'
      : `Pas enregistré : ${String(err.message || err)}`, 'erreur');
  }
};

// chargerProduit de la page : on garde l'état du produit et on prévient avant de perdre des changements
const chargerPage = window.chargerProduit;
window.chargerProduit = (cle) => {
  if (courant && cle !== courant.id && changements().liste.length && !confirm('Tes changements à ce produit ne sont pas enregistrés. Les abandonner ?')) {
    $('choixProduit').value = courant.id; return;
  }
  chargerPage(cle);
  const a = E?.articles.find((x) => x.id === cle);
  if (a) {
    // Tes ✓ / ✗ déjà enregistrés : dans l'historique des liens, avec « Annuler »
    for (const l of LIENS.filter((x) => x.statut)) HIST.push({ type: l.statut, txt: `${BAN[l.ban]?.nom || l.ban} « ${l.lu} » → ${P.gen} · ${l.sorte}`,
      d: `${l.decide?.le || ''} · ${l.decide?.par || ''}`, lienId: l.id, varId: l.statut === 'ok' ? 'l-' + l.id : null });
    rendLiens(); tout();
    initialiser(a);
    history.replaceState(null, '', `?id=${encodeURIComponent(cle)}`);
  }
};
addEventListener('beforeunload', (ev) => { if (courant && changements().liste.length) { ev.preventDefault(); ev.returnValue = ''; } });

async function demarrer() {
  let session;
  try { session = await src.connecter(); } catch { afficherEtat('Connexion impossible. Vérifie ton réseau, puis recharge la page.'); return; }
  if (!session) { afficherEtat('Connecte-toi d’abord dans la <a href="./">Console</a> (même compte que l’app), puis reviens à cette fiche.'); return; }
  try {
    if (!(await src.chargerFoyer())) { afficherEtat('Ce compte n’a pas de foyer.'); return; }
    personne = src.membres.find((m) => m.user_id === session.user.id)?.nom_affiche || '';
    afficherEtat('Chargement de tes produits…');
    E = construireEtat(await src.chargerObjets((n) => afficherEtat(`Chargement de tes produits… ${n.toLocaleString('fr-CA')} objets`)), src.membres);
    const [ref, corr, index] = await Promise.all([json('referentiel.json'), json('correspondance.json'), json('index.json')]);
    opts = { ref, corr: corr || {}, dispo: new Set(index || []), base: '../visuels/', depuis: depuis(),
      // Circulaire en ligne de chaque bannière (lien de la source « Circulaire » pendant le rabais)
      circulaires: Object.fromEntries(Object.entries(BANNIERES).filter(([, b]) => b.circulaire).map(([k, b]) => [k, b.circulaire])) };
    lireFamilles(await src.chargerFamilles());
    for (const a of E.articles) { try { construire(a); } catch (err) { console.warn('Fiche non construite :', a.id, err); } }
    for (const [k, b] of Object.entries(BANNIERES)) if (!BAN[k]) BAN[k] = { nom: b.nom, c: '#8d99ae' };
    for (const r of Object.values(REELS)) for (const v of [...r.var, ...r.liens]) if (v.ban && !BAN[v.ban]) BAN[v.ban] = { nom: v.ban, c: '#8d99ae' };
    const tri = Object.values(REELS).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    $('choixProduit').innerHTML = tri.map((r) => `<option value="${r.cle}">${r.nom.replace(/[<&"]/g, '')}</option>`).join('');
    const voulu = new URLSearchParams(location.search).get('id');
    const cle = REELS[voulu] ? voulu : tri[0]?.cle;
    if (!cle) { afficherEtat('Aucun produit dans ton catalogue.'); return; }
    window.chargerProduit(cle);
    afficherEtat(null);
  } catch (err) {
    afficherEtat(`Lecture impossible : ${String(err?.message || err).replace(/[<&]/g, '')}. Recharge la page.`);
  }
}

// ---------- Niveau Sorte par famille (v104) : séparé (Pomme → Gala → marques) ou dans le nom (Beurre salé → marques)
// Enregistré tout de suite dans un objet « famille » (id = identifiant du référentiel, ou « nom:… » pour une famille créée).
const versionsFamille = {};
const idFamille = (cle) => (/^CAT-\d/.test(cle) || cle.startsWith('nom:') ? cle : 'nom:' + cle);
function lireFamilles(lignes) {
  for (const l of lignes) {
    versionsFamille[l.id] = { version: l.version, data: l.data || {} };
    if (typeof l.data?.sorteSeparee === 'boolean') SORTE_SEPAREE[l.id.startsWith('nom:') ? l.id.slice(4) : l.id] = l.data.sorteSeparee;
  }
}
window.quandNiveauSorte = async (cle, val) => {
  const id = idFamille(cle), avant = versionsFamille[id];
  const data = { ...(avant?.data || {}), nom: P.gen, sorteSeparee: val, le: new Date().toISOString().slice(0, 10), par: personne };
  try {
    const v = await src.ecrire('famille', id, data, avant?.version ?? null, 'console');
    versionsFamille[id] = { version: v, data };
    majBarre(`Enregistré pour toute la famille « ${P.gen} » : ${val ? 'la sorte a son propre niveau' : 'la sorte est dans le nom du niveau 3'}.`, 'ok');
  } catch (err) {
    SORTE_SEPAREE[cle] = !val; tout();
    majBarre(err.conflit ? 'Ce réglage a été changé ailleurs : recharge la page, puis recommence.' : `Réglage non enregistré : ${err.message}`, 'erreur');
  }
};

// Accès pour les essais (aperçu sans connexion) : on injecte des données sans toucher à la base
window.__fiche = { initialiserAvec(e, o, nom = 'Chris', familles = []) { E = e; opts = o; personne = nom; lireFamilles(familles); for (const a of E.articles) construire(a); }, changements, lireFiche,
  ecrireAvec(fn) { src.ecrire = fn; } };
if (!new URLSearchParams(location.search).has('essai')) demarrer();
