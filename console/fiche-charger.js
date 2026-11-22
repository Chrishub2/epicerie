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
  caracteristiques: 'caractéristiques', nomEn: 'nom anglais', nomsAlt: 'noms alternatifs', nomsAltEn: 'noms anglais', liensDecides: 'liens confirmés ou refusés', nomsProduits: 'noms des produits vendus', generique: 'famille', generiqueNom: 'famille (nouvelle)', remplacement: 'remplacement' };

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
    nomsProduits: nomsAEnregistrer(),
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
    // Copies déjà faites (« ✓ Copié dans … », « ✓ Copie à classer », « ✓ Vient de … ») et noms corrigés (✎)
    for (const k of Object.keys(COPIES)) delete COPIES[k];
    for (const k of Object.keys(NOMS)) delete NOMS[k];
    for (const v of VAR) {
      const p = E.prix.find((x) => x.id === idPrix(v.id));
      const c = E.prix.find((x) => x.copieDe && x.copieDe === idPrix(v.id));
      if (c) COPIES[v.id] = c.articleId ? `Copié dans ${E.articles.find((x) => x.id === c.articleId)?.nom || 'une autre fiche'}` : 'Copie à classer';
      if (p?.copieDe) {   // prix lui-même copié d'une autre fiche : pas de bouton vers sa fiche d'origine
        const orig = E.prix.find((x) => x.id === p.copieDe);
        COPIES[v.id] = `Vient de ${E.articles.find((x) => x.id === orig?.articleId)?.nom || 'une autre fiche'}`;
      }
      const n = a.nomsProduits?.[idPrix(v.id)] || p?.nomCorrige;
      if (n) NOMS[v.id] = { marque: n.marque ?? v.sorte, lu: n.lu ?? v.marque };
    }
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
    majAClasser();
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

// ---------- Copier un produit vendu (v105-v106) : le prix est copié (jamais modifié), seuls les noms changent.
// La copie est un NOUVEAU prix (copieDe = l'original, nomCorrige = ses noms) : dans une fiche existante ou nouvelle (lien confirmé ✓),
// ou « à classer » (sans fiche, en attente : la base permet de la rattacher plus tard). Les noms corrigés ICI partent avec « Enregistrer ».
const idPrix = (varId) => String(varId).replace(/^l-l/, '');
const uid = (pre) => pre + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const slugSorte = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const memeNom = (a, b) => (a?.marque || '') === (b?.marque || '') && (a?.lu || '') === (b?.lu || '');
// Noms à garder dans la fiche : ceux de la base (prix plus anciens compris), puis ceux de la page s'ils diffèrent du nom de départ
function nomsAEnregistrer() {
  const r = copie(courant?.base?.nomsProduits || {});
  for (const v of VAR) {
    const pid = idPrix(v.id), p = E?.prix.find((x) => x.id === pid);
    const depart = p?.nomCorrige ? { marque: p.nomCorrige.marque ?? v.sorte, lu: p.nomCorrige.lu ?? v.marque } : { marque: v.sorte, lu: v.marque };
    if (NOMS[v.id] && !memeNom(NOMS[v.id], depart)) r[pid] = { marque: NOMS[v.id].marque, lu: NOMS[v.id].lu };
    else delete r[pid];
  }
  return r;
}
window.quandNomProduit = () => majBarre();
function lienOk(art, prixId, quand) { art.liensDecides = { ...(art.liensDecides || {}), ['l' + prixId]: { d: 'ok', le: quand, par: personne } }; }
window.quandCopiePrix = async (v, cible, noms = {}) => {
  const p = E.prix.find((x) => x.id === idPrix(v.id));
  const echec = (msg) => { delete COPIES[v.id]; rendVariantes(); majBarre(msg, 'erreur'); };
  if (!p) return echec('Prix introuvable : recharge la page, puis recommence.');
  const quand = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  const nouveau = { ...copie(p), id: uid('p'), copieDe: p.id, nomCorrige: noms.copie || null };
  for (const k of ['annule', 'annuleRaison', 'aVerifier']) delete nouveau[k];
  try {
    let art = null, version = null, texte;
    if (cible === 'aucune') {
      Object.assign(nouveau, { articleId: null, varianteId: null, enAttente: true, aClasser: true });
      texte = 'Copie gardée « à classer » (bouton 📥 en haut pour la rattacher)';
    } else {
      if (cible.startsWith('nouvelle:')) {
        const nom = cible.slice(9).trim() || P.gen, base = courant.base, vid = uid('v');
        const reste = normT(nom).startsWith(normT(P.gen) + ' ') ? nom.slice(P.gen.length).trim() : '';
        art = copie({ id: uid('a'), nom, codes: [], local: !!base.local, format: base.format || '', rayonId: base.rayonId, uniteRef: base.uniteRef,
          generique: P.genId || undefined, generiqueNom: P.genId ? undefined : P.gen, sorte: reste ? slugSorte(reste) : undefined,
          variantes: [{ id: vid, nom: '', alias: [], codes: [], local: !!base.local, format: base.format || '' }], variantePreferee: vid });
      } else {
        const ex = E.articles.find((x) => x.id === cible);
        art = copie(ex); version = ex?._version ?? null;
      }
      Object.assign(nouveau, { articleId: art.id, varianteId: art.variantePreferee || art.variantes?.[0]?.id || null });
      lienOk(art, nouveau.id, quand);   // la copie compte tout de suite dans la fiche cible
      const va = await src.ecrire('article', art.id, art, version, 'console');
      Object.defineProperty(art, '_version', { value: va ?? (version ?? 0) + 1, enumerable: false, writable: true });
      const i = E.articles.findIndex((x) => x.id === art.id);
      if (i >= 0) E.articles[i] = art; else E.articles.push(art);
      texte = `Copié dans « ${art.nom} »${version == null ? ' (nouvelle fiche)' : ''}`;
    }
    await src.ecrire('prix', nouveau.id, nouveau, null, 'console');
    E.prix.push(nouveau);
    if (art) {
      construire(art);
      if (![...$('choixProduit').options].some((o) => o.value === art.id)) $('choixProduit').add(new Option(art.nom, art.id));
    }
    majAClasser();
    rendVariantes();
    majBarre(`${texte}. L'original reste ici${changements().liste.length ? ' — pense à enregistrer le nom corrigé ici' : ''}.`, 'ok');
    setTimeout(() => majBarre(), 4000);
  } catch (err) {
    echec(err.conflit ? 'Cette fiche a été modifiée ailleurs : recharge la page, puis recommence.' : `Copie non faite : ${String(err.message || err)}`);
  }
};

// ---------- 📥 À classer : les copies sans fiche ; on choisit leur fiche (rattachement permis par la base tant qu'elles sont en attente)
const boutonAClasser = document.createElement('button');
boutonAClasser.type = 'button'; boutonAClasser.id = 'bsAClasser'; boutonAClasser.hidden = true;
boutonEntete.after(boutonAClasser);
const boiteAClasser = document.createElement('div');
boiteAClasser.id = 'boiteAClasser'; boiteAClasser.hidden = true;
boiteAClasser.setAttribute('role', 'dialog'); boiteAClasser.setAttribute('aria-label', 'Copies à classer');
document.body.appendChild(boiteAClasser);
style.textContent += `
#bsAClasser { font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 6px; cursor: pointer; margin-left: 6px; white-space: nowrap;
  background: transparent; color: var(--texte, #e8e8e8); border: 1px solid var(--etiquette, #e9c46a); }
#boiteAClasser { position: fixed; top: 64px; right: max(16px, env(safe-area-inset-right, 0px)); z-index: 60; width: min(560px, calc(100vw - 32px)); max-height: 70vh; overflow: auto;
  padding: 12px 14px; border-radius: 10px; background: var(--surface, #1e252b); border: 1px solid var(--trait-fort, #445); box-shadow: 0 10px 30px rgba(0,0,0,.4); font-size: 13px; display: grid; gap: 10px; }
#boiteAClasser .ac-ligne { display: grid; gap: 6px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--trait, #333c44); }
#boiteAClasser .ac-act { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
#boiteAClasser select { font: inherit; font-size: 13px; padding: 4px 8px; border-radius: 6px; flex: 1 1 220px; min-width: 0; }
#boiteAClasser .ac-titre { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }`;
const aClasser = () => (E?.prix || []).filter((p) => p.aClasser && p.enAttente && !p.articleId);
function majAClasser() {
  const n = aClasser().length;
  boutonAClasser.hidden = !n;
  boutonAClasser.textContent = `📥 À classer (${n})`;
  if (!n) boiteAClasser.hidden = true;
  if (!boiteAClasser.hidden) rendAClasser();
}
function rendAClasser() {
  const fiches = [...E.articles].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const opt = fiches.map((a) => `<option value="${a.id}">${esc(a.nom)}</option>`).join('');
  boiteAClasser.innerHTML = `<div class="ac-titre"><span>Copies à classer</span><button type="button" class="btn" data-ac-fermer>Fermer</button></div>` +
    aClasser().map((p) => { const n = p.nomCorrige || {}; return `<div class="ac-ligne">
      <div><b>${esc(n.marque || '')}</b> ${esc(n.lu || p.nomProduit || '')}</div>
      <div class="ex">${esc(p.offre || '')} · ${esc(BAN[p.banniere]?.nom || p.banniere || '')} · ${esc(p.format || '')} · lu : « ${esc(p.nomProduit || '')} »</div>
      <div class="ac-act"><select data-ac-cible="${p.id}" aria-label="Fiche où classer">${opt}</select><button type="button" class="btn bs-ok" data-ac-ok="${p.id}">Classer</button></div></div>`; }).join('');
}
boutonAClasser.onclick = () => { boiteAClasser.hidden = !boiteAClasser.hidden; if (!boiteAClasser.hidden) rendAClasser(); };
boiteAClasser.addEventListener('click', async (e) => {
  if (e.target.closest('[data-ac-fermer]')) { boiteAClasser.hidden = true; return; }
  const b = e.target.closest('[data-ac-ok]'); if (!b) return;
  const p = E.prix.find((x) => x.id === b.dataset.acOk), cible = boiteAClasser.querySelector(`[data-ac-cible="${p.id}"]`).value;
  const ex = E.articles.find((x) => x.id === cible); if (!p || !ex) return;
  b.disabled = true;
  try {
    const art = copie(ex), version = ex._version ?? null;
    lienOk(art, p.id, new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }));
    const va = await src.ecrire('article', art.id, art, version, 'console');
    Object.defineProperty(art, '_version', { value: va ?? (version ?? 0) + 1, enumerable: false, writable: true });
    E.articles[E.articles.indexOf(ex)] = art;
    // Rattachement : la copie en attente reçoit sa fiche (seul changement permis à un prix, tant qu'il est en attente)
    const vp = E.prix.indexOf(p), nv = { ...copie(p), articleId: art.id, varianteId: art.variantePreferee || art.variantes?.[0]?.id || null, enAttente: false, aClasser: false };
    await src.ecrire('prix', p.id, nv, p._version ?? 1, 'console');
    E.prix[vp] = nv;
    construire(art);
    majAClasser();
    if (courant?.id === art.id) chargerProduit(art.id);
    majBarre(`Classé dans « ${art.nom} ».`, 'ok'); setTimeout(() => majBarre(), 3500);
  } catch (err) {
    b.disabled = false;
    majBarre(err.conflit ? 'Cette fiche a été modifiée ailleurs : recharge la page, puis recommence.' : `Pas classé : ${String(err.message || err)}`, 'erreur');
  }
});

// Accès pour les essais (aperçu sans connexion) : on injecte des données sans toucher à la base
window.__fiche = { initialiserAvec(e, o, nom = 'Chris', familles = []) { E = e; opts = o; personne = nom; lireFamilles(familles); for (const a of E.articles) construire(a); majAClasser(); }, changements, lireFiche,
  ecrireAvec(fn) { src.ecrire = fn; } };
if (!new URLSearchParams(location.search).has('essai')) demarrer();
