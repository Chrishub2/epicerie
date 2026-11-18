// =====================================================================
// Onglet PLUS : cartes fidélité, points, rabais perso, catalogue, photos,
// sauvegarde.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, toast, joursRestants, aujourdhui, themeActuel, appliquerTheme, logoMagasin, brancherSelecteurProduit } from './ui.js';
import { PROGRAMMES } from './demo-data.js';
import { SKINS, skinActuel, htmlChoixSkin, brancherChoixSkin } from './skins/skins.js';
import { photographierRecu } from './camera.js';
import { prendrePhoto } from './ocr.js';
import { analyserOffre, analyserFormat } from './normalise.js';
import { ajouterTache } from './attente.js';
import * as Sync from './sync.js';
import * as P from './produits.js';
import { monterCirculaires } from './circulaires.js';
import { natureLigne } from './lignes-recu.js';

const JSBARCODE = 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js';
const VALEUR_POINT = { pc_optimum: 0.001, scene_plus: 0.01, metro_moi: 0.01 }; // $ par point (indicatif, à valider)
let section = null;
export function allerASection(s) { section = s; }

export function vuePlus(v) {
  if (section === 'cartes') return vueCartes(v);
  if (section === 'rabais') return vueRabais(v);
  if (section === 'catalogue') return vueCatalogue(v);
  if (section === 'photos') return vuePhotos(v);
  if (section === 'sauvegarde') return vueSauvegarde(v);
  if (section === 'recus') return vueRecus(v);
  if (section === 'releve') return vueReleve(v);
  if (section === 'apparence') return vueApparence(v);
  if (section === 'foyer') return vueFoyer(v);
  if (section === 'circulaires') return vueCirculaires(v);
  const e = S.get();
  const st = Sync.etatSync();
  const menu = [
    ['circulaires', '📰', 'Circulaires de la semaine', 'Charge tes captures par bannière, puis envoie : les rabais sont lus pour toi'],
    ['foyer', '👪', 'Mon foyer et partage', st.foyer ? `Partagé · ${st.membres.length} membre(s)` : st.connecte ? 'Connecté — crée ou joins ton foyer' : 'Connecte-toi pour partager la liste et activer l\'IA'],
    ['releve', '🏷️', 'Relevé de prix en magasin', 'Photographie des étiquettes pour ton inventaire de prix, sans rien acheter'],
    ['recus', '🧾', 'Mes reçus', `${(e.recus || []).length} reçu(s) · prends-les en photo après l'épicerie`],
    ['cartes', '💳', 'Cartes fidélité & points', `${e.cartes.length} carte(s)`],
    ['rabais', '🏷️', 'Mes rabais personnels', `${e.rabaisPerso.filter((r) => r.actif).length} actif(s)`],
    ['catalogue', '📚', 'Catalogue de mes articles', `${e.articles.length} articles`],
    ['photos', '🖼️', 'Photos', `${e.photos.length} photo(s)`],
    ['apparence', '🎨', 'Apparence (skins)', `${SKINS.find((s) => s.id === skinActuel())?.nom || 'Classique'} · ${{ auto: 'selon le téléphone', clair: 'clair', sombre: 'sombre' }[themeActuel()]}`],
    ['sauvegarde', '💾', 'Sauvegarde et mode démo', 'Exporter, importer, réinitialiser'],
  ];
  v.innerHTML = menu.map(([k, ic, t, s]) => `<button class="carte rang" data-s="${k}" style="width:100%;text-align:left;font:inherit;color:inherit">
    <span style="font-size:24px">${ic}</span><span class="grandir"><b>${t}</b><div class="doux">${s}</div></span><span>›</span></button>`).join('')
    + `<p class="doux">À venir : vérification automatique de chaque ligne de reçu contre les prix attendus, économies par bannière/semaine/mois, cycles de rabais, rappels de produits.</p>`;
  $$('[data-s]', v).forEach((b) => b.onclick = () => { section = b.dataset.s; vuePlus(v); });
  // Version installée sur ce téléphone
  v.insertAdjacentHTML('beforeend', '<p class="doux" id="versionApp" style="text-align:center"></p>');
  import('./maj.js').then((m) => m.versionActuelle()).then((ver) => { const p = $('#versionApp', v); if (p && ver) p.textContent = `Version de l'app : ${ver}`; });
}

const retour = () => `<button class="btn sec" id="retour" style="margin-bottom:10px">‹ Retour</button>`;

// --- Circulaires de la semaine (même écran que la console : circulaires.js) ---
let circulairesMontees = null;
function vueCirculaires(v) {
  circulairesMontees?.arreter();
  v.innerHTML = retour() + '<div id="zoneCirc"></div>';
  brancherRetour(v);
  const st = Sync.etatSync();
  circulairesMontees = monterCirculaires($('#zoneCirc', v), {
    sb: Sync.estPret() ? Sync.client() : null, foyer: st.foyer?.id || null, articles: () => S.get().articles,
    hote: 'app', source: 'telephone', message: toast,
    succursale: (b) => S.get().magasins.some((m) => m.banniere === b && m.actif !== false),
  });
}
function brancherRetour(v) { $('#retour', v).onclick = () => { section = null; vuePlus(v); }; }

// --- Cartes fidélité --------------------------------------------------
function vueCartes(v) {
  const e = S.get();
  v.innerHTML = retour() + `<p class="doux">Les numéros restent sur ce téléphone (et plus tard dans ta base privée). Aucun mot de passe. Les points se mettent à jour à partir de tes reçus ou d'une capture de l'app du magasin.</p>`
    + e.cartes.map((c) => {
      const solde = e.points.filter((p) => p.carteId === c.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      const val = solde && VALEUR_POINT[c.programme] ? solde.solde * VALEUR_POINT[c.programme] : null;
      return `<div class="carte" data-c="${c.id}"><div class="rang"><b class="grandir">${esc(PROGRAMMES[c.programme] || c.programme)}</b><span class="doux">${esc(c.titulaire)}</span></div>
        <div class="doux">N° •••• ${esc(c.numero.slice(-4))}</div>
        <div>${solde ? `<b>${solde.solde.toLocaleString('fr-CA')} points</b>${val != null ? ` ≈ ${argent(val)}` : ''} <span class="doux">au ${esc(solde.date)}</span>` : '<span class="doux">Solde inconnu</span>'}</div>
        <div class="rang envelopper" style="margin-top:8px"><button class="btn" data-montrer>Montrer à la caisse</button>
          <button class="btn sec" data-solde>Mettre à jour les points</button><button class="btn danger" data-sup>Retirer</button></div></div>`;
    }).join('')
    + `<div class="carte"><h2>Ajouter une carte</h2>
      <div class="champ"><select id="cProg">${Object.entries(PROGRAMMES).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></div>
      <div class="champ"><input id="cNum" inputmode="numeric" placeholder="Numéro de carte" autocomplete="off"></div>
      <div class="champ"><select id="cTit">${e.membres.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
      <button class="btn" id="cAjout">Ajouter</button></div>`;
  brancherRetour(v);
  $('#cAjout', v).onclick = () => {
    const numero = $('#cNum', v).value.replace(/\s/g, '');
    if (!/^\d{6,20}$/.test(numero)) { toast('Numéro : 6 à 20 chiffres'); return; }
    S.maj((x) => x.cartes.push({ id: S.uid('c'), programme: $('#cProg', v).value, numero, titulaire: $('#cTit', v).value }));
  };
  $$('[data-c]', v).forEach((el) => {
    const c = e.cartes.find((x) => x.id === el.dataset.c);
    el.querySelector('[data-montrer]').onclick = () => montrerCarte(c);
    el.querySelector('[data-solde]').onclick = () => {
      const s = prompt('Nouveau solde de points :');
      const n = Number(String(s || '').replace(/\s/g, '').replace(',', '.'));
      if (s && isFinite(n)) S.maj((x) => x.points.push({ carteId: c.id, date: aujourdhui(), solde: n, source: 'manuel' }));
    };
    el.querySelector('[data-sup]').onclick = () => { if (confirm('Retirer cette carte ?')) S.maj((x) => { x.cartes = x.cartes.filter((y) => y.id !== c.id); }); };
  });
}

async function montrerCarte(c) {
  ouvrirModale(PROGRAMMES[c.programme] || c.programme, `<div class="code-barre-svg"><svg id="cb"></svg></div>
    <p style="text-align:center;font-size:20px;letter-spacing:2px">${esc(c.numero)}</p><p class="doux" style="text-align:center">Monte la luminosité de l'écran pour le lecteur de la caisse.</p>`, async (corps) => {
    try {
      if (!window.JsBarcode) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = JSBARCODE; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
      window.JsBarcode($('#cb', corps), c.numero, { format: 'CODE128', displayValue: false, height: 90, margin: 0 });
    } catch { $('#cb', corps).outerHTML = '<p class="doux">Code-barres indisponible hors ligne — montre le numéro.</p>'; }
  });
}

// --- Rabais personnels ------------------------------------------------
function vueRabais(v) {
  const e = S.get();
  v.innerHTML = retour() + e.rabaisPerso.map((r) => {
    const m = e.magasins.find((x) => x.id === r.magasinId);
    const j = joursRestants(r.expiration);
    const etat = !r.expiration ? '<span class="pastille ambre">date d\'expiration à entrer</span>'
      : j < 0 ? '<span class="pastille rouge">expiré</span>' : `<span class="pastille ${j <= 7 ? 'ambre' : 'vert'}">expire dans ${j} j</span>`;
    return `<div class="carte" data-r="${r.id}"><b>${esc(m?.nom || 'Magasin retiré')}</b> — ${esc(r.description)}<div>${etat}</div>
      <div class="rang" style="margin-top:8px"><div class="grandir"><label class="doux">Expiration</label><input type="date" data-exp value="${esc(r.expiration || '')}"></div>
        <label class="doux rang"><input type="checkbox" data-actif ${r.actif ? 'checked' : ''} style="width:auto"> actif</label>
        <button class="icone" data-sup aria-label="Retirer">🗑</button></div></div>`;
  }).join('') + `<div class="carte"><h2>Ajouter un rabais</h2>
    <div class="champ"><select id="rMag">${e.magasins.map((m) => `<option value="${m.id}">${esc(m.nom)}</option>`).join('')}</select></div>
    <div class="rang"><div class="champ grandir"><label>Rabais (%)</label><input id="rPct" type="number" inputmode="decimal" value="10"></div>
      <div class="champ grandir"><label>Sur les premiers ($)</label><input id="rPlaf" type="number" inputmode="decimal" placeholder="150"></div></div>
    <div class="champ"><label>Expiration</label><input id="rExp" type="date"></div>
    <button class="btn" id="rAjout">Ajouter</button></div>`;
  brancherRetour(v);
  $$('[data-r]', v).forEach((el) => {
    const id = el.dataset.r;
    el.querySelector('[data-exp]').onchange = (ev) => S.maj((x) => { x.rabaisPerso.find((r) => r.id === id).expiration = ev.target.value; });
    el.querySelector('[data-actif]').onchange = (ev) => S.maj((x) => { x.rabaisPerso.find((r) => r.id === id).actif = ev.target.checked; });
    el.querySelector('[data-sup]').onclick = () => { if (confirm('Retirer ce rabais ?')) S.maj((x) => { x.rabaisPerso = x.rabaisPerso.filter((r) => r.id !== id); }); };
  });
  $('#rAjout', v).onclick = () => {
    const pct = Number($('#rPct', v).value), plafond = Number($('#rPlaf', v).value) || null;
    if (!(pct > 0 && pct < 100)) { toast('Pourcentage invalide'); return; }
    S.maj((x) => x.rabaisPerso.push({ id: S.uid('rp'), magasinId: $('#rMag', v).value, pct, plafond,
      description: `${pct} %${plafond ? ` sur les premiers ${plafond} $` : ''}`, expiration: $('#rExp', v).value, actif: true }));
  };
}

// --- Fusion des doublons (v33) -----------------------------------------
/** Écran de fusion : doublons probables, choix libre, puis confirmation avec aperçu. */
function ouvrirFusion(apres) {
  const e = S.get();
  const paires = P.doublonsProbables(e);
  const tri = [...e.articles].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  ouvrirModale('Fusionner des doublons', `
    <p class="doux" style="margin-top:0">Fusionner = un seul produit sur ta liste, avec chaque marque/format comme variante. Les prix, reçus et codes-barres suivent. Rien n'est fait sans ta confirmation, et une variante peut être séparée plus tard (fiche → Marques et formats → ↗).</p>
    ${paires.length ? `<h3>Doublons probables</h3>${paires.map((p, i) => `<div class="carte" style="padding:8px;margin-bottom:6px">
      <div><b>${esc(p.a.nom)}</b> + <b>${esc(p.b.nom)}</b> <span class="doux">· ${esc(p.raison)}</span></div>
      <div class="rang" style="margin-top:6px"><button class="btn" data-paire="${i}">🔗 Fusionner…</button><button class="btn sec" data-pasdoublon="${i}">Pas un doublon</button></div></div>`).join('')}`
      : '<p class="doux">Aucun doublon évident repéré. Tu peux en choisir toi-même ci-dessous.</p>'}
    <h3>Choisir moi-même</h3>
    <input id="fuFiltre" placeholder="🔎 Chercher un produit…" style="width:100%">
    <div id="fuListe" style="max-height:40vh;overflow-y:auto;margin-top:6px">${tri.map((a) => `<label class="item" data-nomf="${esc(a.nom.toLowerCase())}" style="cursor:pointer">
      <input type="checkbox" data-fu="${a.id}" style="width:auto"><span class="grandir">${esc(a.nom)} <span class="doux">${esc([a.marque, a.format].filter(Boolean).join(' · '))}</span></span></label>`).join('')}</div>
    <button class="btn" id="fuSuite" style="width:100%;margin-top:8px" disabled>Fusionner la sélection…</button>`, (c) => {
    const cases = () => $$('[data-fu]:checked', c).map((x) => x.dataset.fu);
    $('#fuFiltre', c).oninput = (ev) => { const q = ev.target.value.toLowerCase().trim(); $$('[data-nomf]', c).forEach((l) => { l.hidden = q && !l.dataset.nomf.includes(q); }); };
    $('#fuListe', c).onchange = () => { const n = cases().length; $('#fuSuite', c).disabled = n < 2; $('#fuSuite', c).textContent = n < 2 ? 'Fusionner la sélection…' : `Fusionner ces ${n} produits…`; };
    $('#fuSuite', c).onclick = () => confirmerFusion(cases(), apres);
    $$('[data-paire]', c).forEach((b) => b.onclick = () => { const p = paires[Number(b.dataset.paire)]; confirmerFusion([p.a.id, p.b.id], apres); });
    $$('[data-pasdoublon]', c).forEach((b) => b.onclick = () => {
      const p = paires[Number(b.dataset.pasdoublon)];
      S.maj((x) => {
        const a = x.articles.find((y) => y.id === p.a.id), bb = x.articles.find((y) => y.id === p.b.id);
        if (a) a.pasDoublon = [...new Set([...(a.pasDoublon || []), p.b.id])];
        if (bb) bb.pasDoublon = [...new Set([...(bb.pasDoublon || []), p.a.id])];
      });
      ouvrirFusion(apres);
    });
  });
}

/** Étape 2 : quel nom garder, aperçu de ce qui bouge, puis fusion. */
function confirmerFusion(ids, apres) {
  const e = S.get();
  const arts = ids.map((id) => e.articles.find((a) => a.id === id)).filter(Boolean);
  if (arts.length < 2) return;
  // Par défaut : celui qui est sur la liste, sinon celui qui a le plus de prix
  const poids = (a) => (e.liste.some((l) => l.articleId === a.id) ? 1000 : 0) + e.prix.filter((p) => p.articleId === a.id).length;
  const defaut = [...arts].sort((a, b) => poids(b) - poids(a))[0];
  const texteApercu = (cibleId) => {
    const autres = arts.filter((a) => a.id !== cibleId);
    const ap = P.apercuFusion(S.get(), autres.map((a) => a.id));
    return `${autres.map((a) => `« ${esc(a.nom)} »`).join(', ')} ${autres.length > 1 ? 'deviendront des variantes' : 'deviendra une variante'} de ce produit :
      ${ap.variantes} marque(s)/format(s), ${ap.prix} prix, ${ap.lignesListe} ligne(s) de liste (additionnées si en double). ${autres.length > 1 ? 'Ces fiches seront retirées' : 'Cette fiche sera retirée'} du catalogue.`;
  };
  ouvrirModale('Confirmer la fusion', `
    <h3 style="margin-top:0">Garder le nom de :</h3>
    ${arts.map((a) => `<label class="item" style="cursor:pointer"><input type="radio" name="fuCible" value="${a.id}" ${a === defaut ? 'checked' : ''} style="width:auto">
      <span class="grandir">${esc(a.nom)} <span class="doux">${esc([a.marque, a.format].filter(Boolean).join(' · '))}</span></span></label>`).join('')}
    <div class="alerte" id="fuApercu" style="margin-top:8px">${texteApercu(defaut.id)}</div>
    <div class="rang" style="margin-top:8px"><button class="btn" id="fuOk">🔗 Fusionner</button><button class="btn sec" id="fuRetour">‹ Retour</button></div>`, (c) => {
    const cible = () => $('[name="fuCible"]:checked', c).value;
    $$('[name="fuCible"]', c).forEach((r) => r.onchange = () => { $('#fuApercu', c).innerHTML = texteApercu(cible()); });
    $('#fuRetour', c).onclick = () => ouvrirFusion(apres);
    $('#fuOk', c).onclick = () => {
      const cid = cible(), nom = arts.find((a) => a.id === cid).nom;
      S.maj((x) => P.fusionner(x, cid, ids));
      toast(`Fusionné dans « ${nom} » ✓`);
      apres?.();
      ouvrirFusion(apres);
    };
  });
}

// --- Catalogue --------------------------------------------------------
let offProgres = null; // texte de progression du rafraîchissement (survit aux réaffichages)
let filtreCatalogue = 'tous'; // « tous » ou « incomplets »
function vueCatalogue(v) {
  const e = S.get();
  const parRayon = e.rayons.map((r) => ({ r, arts: e.articles.filter((a) => a.rayonId === r.id).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')) }))
    .filter((x) => x.arts.length);
  const avecCode = e.articles.filter((a) => a.codes?.length).length;
  // Données de base de chaque fiche (ce qui manque pour comparer, scanner et relier les reçus)
  const prixReels = P.articlesAvecPrixReel(e.prix); // une passe sur les prix, pas une par fiche
  const comp = new Map(e.articles.map((a) => [a.id, P.completude(a, e, { prixReels })]));
  const nbIncomplets = [...comp.values()].filter((c) => c.manquants.length || c.alertes.length).length;
  v.innerHTML = retour() + `<p class="doux">Touche un article pour modifier son nom, son rayon, son unité de comparaison ou son format.</p>
    <div class="carte"><button class="btn" id="invScan" style="width:100%">▥ Scanner mes produits</button>
      <p class="doux" style="margin:6px 0 0">Pour bâtir ta base à la maison : scanne tes produits un après l'autre. Rien n'est ajouté à ta liste d'épicerie.</p></div>
    <div class="carte"><button class="btn sec" id="offMaj" style="width:100%" ${avecCode && !offProgres ? '' : 'disabled'}>🔄 Rafraîchir mes fiches (Open Food Facts)</button>
      <p class="doux" id="offEtat" style="margin:6px 0 0">${offProgres ? `⏳ ${esc(offProgres)}` : avecCode
        ? `${avecCode} fiche(s) avec code-barres : j'ajoute 🍁 Québec, 🌱 bio et allergènes, et je complète format, marque et photo s'ils manquent. Ce que tu as écrit n'est jamais remplacé.`
        : 'Aucune fiche n\'a encore de code-barres : scanne tes produits (▥) pour pouvoir les rafraîchir.'}</p></div>
    <div class="carte"><button class="btn sec" id="fusion" style="width:100%">🔗 Fusionner des doublons</button>
      <p class="doux" style="margin:6px 0 0">${(() => { const n = P.doublonsProbables(e).length; return n ? `${n} doublon(s) probable(s) repéré(s). ` : ''; })()}Ex. « Lait 2 % » et « Natrel 2 % » → un seul produit avec deux marques.</p></div>
    <div class="carte"><button class="btn sec" id="couverture" style="width:100%">📊 Test de couverture des sources</button>
      <p class="doux" style="margin:6px 0 0">Combien de tes produits scannés sont connus d'Open Food Facts, d'épiceries.ca et d'UPCitemdb, avec la bonne marque et le bon format.</p></div>`
    + `<div class="rang envelopper" style="margin:4px 0 8px">
        <button class="btn ${filtreCatalogue === 'tous' ? '' : 'sec'}" data-fcat="tous" style="padding:6px 10px">Tous (${e.articles.length})</button>
        <button class="btn ${filtreCatalogue === 'incomplets' ? '' : 'sec'}" data-fcat="incomplets" style="padding:6px 10px">⚠️ À compléter (${nbIncomplets})</button></div>
      <p class="doux" style="margin:0 0 8px;font-size:12px">Données de base : ⚖️ format · 🏷️ marque · ▥ code-barres · 📷 photo · 💲 vrai prix · 🗂️ rayon. Touche une fiche pour la compléter (le scan ▥ en remplit la plupart d'un coup).</p>`
    + (filtreCatalogue === 'incomplets' && !nbIncomplets ? '<div class="vide">🎉 Toutes tes fiches ont leurs données de base.</div>' : '')
    + parRayon.map(({ r, arts }) => {
      const visibles = filtreCatalogue === 'incomplets' ? arts.filter((a) => comp.get(a.id).manquants.length || comp.get(a.id).alertes.length) : arts;
      if (!visibles.length) return '';
      return `<section class="rayon"><h3>${esc(r.nom)}</h3>${visibles.map((a) => {
      const nbV = P.variantesActives(a).length;
      const c = comp.get(a.id);
      const niveau = c.ok === c.total && !c.alertes.length ? 'complet' : c.ok >= c.total - 2 ? 'presque' : 'incomplet';
      return `<div class="item" data-a="${a.id}" style="cursor:pointer"><div class="grandir"><div class="nom">${esc(a.nom)} ${a.local ? '🍁' : ''}${a.bio ? ' 🌱' : ''}</div>
       <div class="info">${esc(a.format || 'format ?')} · comparé au ${a.uniteRef === 'unite' ? 'prix unitaire' : a.uniteRef}${a.codes?.length ? ' · ▥' : ''}${nbV > 1 ? ` · ${nbV} marques/formats` : ''}${a.allergenes?.length ? ` · ⚠️ ${esc(a.allergenes.join(', '))}` : ''}</div>
       ${c.manquants.length ? `<div class="info manque">Manque : ${c.manquants.map((m) => `${m.icone} ${esc(m.texte)}`).join(' · ')}</div>` : ''}
       ${c.alertes.map((t) => `<div class="info manque">⚠️ ${esc(t)}</div>`).join('')}</div>
       <span class="score-fiche ${niveau}" title="${c.ok} données de base sur ${c.total}">${niveau === 'complet' ? '✓' : `${c.ok}/${c.total}`}</span></div>`;
    }).join('')}</section>`;
    }).join('');
  brancherRetour(v);
  $$('[data-fcat]', v).forEach((b) => b.onclick = () => { filtreCatalogue = b.dataset.fcat; vueCatalogue(v); });
  $('#couverture', v).onclick = () => import('./couverture.js').then((m) => m.ouvrirCouverture());
  $('#fusion', v).onclick = () => ouvrirFusion(() => { if (section === 'catalogue') vueCatalogue(v); });
  $('#invScan', v).onclick = async () => {
    const { ouvrirScan } = await import('./scan.js');
    const avant = new Set(S.get().articles.map((a) => a.id));
    const vus = new Map(); // id → déjà au catalogue avant la session ?
    ouvrirScan((a) => { if (a) vus.set(a.id, avant.has(a.id)); }, {
      inventaire: true, libelleOk: '✓ Enregistrer la fiche',
      surFin: () => {
        if (vus.size) {
          const relies = [...vus.values()].filter(Boolean).length;
          toast(`▥ ${vus.size} produit(s) scanné(s) · ${relies} relié(s) à une fiche · ${vus.size - relies} nouvelle(s) fiche(s)`);
        }
        if (section === 'catalogue') vueCatalogue(v);
      },
    });
  };
  $('#offMaj', v).onclick = async (ev) => {
    if (!navigator.onLine) { toast('📵 Pas de réseau'); return; }
    ev.target.disabled = true;
    // La vue se redessine à chaque fiche enregistrée : on garde la progression dans offProgres
    const etat = (t) => { offProgres = t; const el = document.getElementById('offEtat'); if (el) el.textContent = `⏳ ${t}`; };
    etat('Démarrage…');
    const { rafraichirFiches } = await import('./scan.js');
    let bilan;
    try {
      bilan = await rafraichirFiches(etat);
      // Tout a été vérifié il y a moins de 30 jours : on offre de forcer
      if (!bilan.total && confirm('Toutes tes fiches ont été vérifiées dans les 30 derniers jours. Tout revérifier quand même ?')) {
        bilan = await rafraichirFiches(etat, { tout: true });
      }
    } finally { offProgres = null; }
    toast(bilan.total ? `✓ ${bilan.verifies} fiche(s) vérifiée(s) · ${bilan.trouves} trouvée(s) · ${bilan.enrichis} enrichie(s)` : 'Rien à rafraîchir');
    vueCatalogue(v);
  };
  $$('[data-a]', v).forEach((el) => el.onclick = () => import('./app.js').then((m) => m.ficheArticle(el.dataset.a)));
}

// --- Photos -----------------------------------------------------------
export async function afficherPhoto(p, conteneur, grande = false) {
  const blob = await S.lirePhoto(p.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const fig = document.createElement('figure');
  fig.innerHTML = `<img src="${url}" alt="" style="${grande ? 'aspect-ratio:auto;max-height:70vh;object-fit:contain' : ''}">
    <figcaption>${esc(p.note || p.type)}</figcaption>`;
  fig.onclick = () => partager(p, blob);
  conteneur.appendChild(fig);
}

async function partager(p, blob) {
  const fichier = new File([blob], `epicerie-${p.type}-${p.id}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [fichier] })) {
    try { await navigator.share({ files: [fichier], title: p.note || 'Photo épicerie' }); } catch { /* annulé */ }
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fichier.name; a.click();
  }
}

function vuePhotos(v) {
  const e = S.get();
  v.innerHTML = retour() + `<p class="doux">Touche une photo pour la partager (texto, courriel…).</p><div class="vignettes" id="galerie"></div>`
    + (e.photos.length ? '' : '<div class="vide">Aucune photo pour l\'instant.</div>');
  brancherRetour(v);
  const g = $('#galerie', v);
  [...e.photos].reverse().forEach((p) => {
    const a = e.articles.find((x) => x.id === p.articleId);
    afficherPhoto({ ...p, note: a ? `${a.nom}${p.note ? ' · ' + p.note : ''}` : p.note }, g);
  });
}

// --- Mon foyer et partage ----------------------------------------------
let courrielEnCours = '';
function vueFoyer(v) {
  const st = Sync.etatSync();
  const e = S.get();
  let html = retour();
  if (!Sync.client()) {
    html += `<div class="carte"><h2>Mon foyer</h2><p class="doux">📵 Pas de réseau : la connexion sera possible au retour du réseau.</p></div>`;
  } else if (st.recuperation) {
    html += `<div class="carte"><h2>Nouveau mot de passe</h2>
      <div class="champ"><label>Nouveau mot de passe (8 caractères ou plus)</label><input id="fNouveauMdp" type="password" autocomplete="new-password"></div>
      <button class="btn" id="fChangerMdp" style="width:100%">Enregistrer</button></div>`;
  } else if (!st.connecte) {
    html += `<div class="carte"><h2>Se connecter</h2>
      <p class="doux">Ta liste sera partagée avec l'autre membre du foyer, en temps réel, et l'IA lira tes photos.</p>
      <div class="champ"><label>Ton courriel</label><input id="fCourriel" type="email" autocomplete="email" value="${esc(courrielEnCours)}" placeholder="toi@exemple.com"></div>
      <div class="champ"><label>Mot de passe</label><input id="fMdp" type="password" autocomplete="current-password" placeholder="8 caractères ou plus"></div>
      <button class="btn" id="fConnecter" style="width:100%">Me connecter</button>
      <div class="rang" style="margin-top:8px"><button class="btn sec grandir" id="fCreerCompte">Créer mon compte</button><button class="btn sec grandir" id="fOubli">Mot de passe oublié</button></div>
      <p class="doux" style="margin-top:8px"><b>Première fois :</b> entre ton courriel, choisis un mot de passe, puis « Créer mon compte ». Clique le lien de confirmation reçu par courriel (il peut s'ouvrir dans Safari, c'est normal), puis reviens ici et touche « Me connecter ».</p></div>`;
  } else if (!st.foyer) {
    html += `<div class="carte"><h2>Créer mon foyer</h2>
      <p class="doux">Connecté : ${esc(st.courriel)}</p>
      <div class="champ"><label>Ton prénom (affiché à l'autre membre)</label><input id="fPrenom" value="${esc(e.utilisateur || '')}"></div>
      <div class="champ"><label>Nom du foyer</label><input id="fNomFoyer" value="Maison"></div>
      <label class="item" style="cursor:pointer"><input type="checkbox" id="fGarder" checked><div class="grandir"><div class="nom">Garder les données de ce téléphone</div>
        <div class="info">Décoche pour partir d'une liste vide, sans les données de démonstration (tes magasins et réglages sont gardés).</div></div></label>
      <button class="btn" id="fCreer" style="width:100%;margin-top:8px">Créer mon foyer</button></div>
      <div class="carte"><h2>Ou joindre un foyer</h2>
      <p class="doux">L'autre membre trouve le code dans Plus → Mon foyer. Les données du foyer remplacent celles de ce téléphone.</p>
      <div class="rang"><input id="fCodeFoyer" class="grandir" placeholder="Code d'invitation"><button class="btn" id="fJoindre">Joindre</button></div></div>
      <button class="btn sec" id="fDeco" style="width:100%">Se déconnecter</button>`;
  } else {
    const derniere = st.dernier ? new Date(st.dernier).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';
    const enLigne = (e.photos || []).filter((p) => p.enLigne).length;
    html += `<div class="carte"><h2>👪 ${esc(st.foyer.nom)}</h2>
      <div class="doux">Membres : ${st.membres.map((m) => `<b>${esc(m.nom_affiche)}</b>`).join(', ')}</div>
      <div class="doux">Dernière synchronisation : ${esc(derniere)} ${st.enLigne ? '' : '· 📵 hors ligne'}</div>
      <h3 style="margin-top:12px">Inviter l'autre membre</h3>
      <div class="rang"><code style="font-size:22px;letter-spacing:2px" class="grandir">${esc(st.foyer.code_invitation)}</code><button class="btn sec" id="fPartager">Partager</button></div>
      <p class="doux">L'autre personne ouvre l'app, crée son compte (courriel + mot de passe), puis entre ce code.</p>
      <button class="btn" id="fSync" style="width:100%;margin-top:6px">🔄 Synchroniser maintenant</button></div>
      <div class="carte"><h2>Photos</h2>
      <p class="doux">${enLigne} photo(s) sauvegardée(s) dans la base. Tu peux les retirer du téléphone pour libérer de l'espace : elles se rechargent au besoin (avec réseau).</p>
      <button class="btn sec" id="fLiberer" style="width:100%">🧹 Libérer l'espace sur ce téléphone</button></div>
      <p class="doux">Connecté : ${esc(st.courriel)}</p>
      <button class="btn sec" id="fDeco" style="width:100%">Se déconnecter</button>`;
  }
  v.innerHTML = html;
  brancherRetour(v);
  // Messages d'erreur de Supabase traduits
  const erreur = (err) => {
    const m = err?.message || String(err);
    const fr = /Invalid login credentials/i.test(m) ? 'Courriel ou mot de passe incorrect'
      : /Email not confirmed/i.test(m) ? 'Confirme d\'abord ton courriel : clique le lien reçu, puis reconnecte-toi'
      : /already registered|already exists/i.test(m) ? 'Ce courriel a déjà un compte : touche « Me connecter »'
      : /Password should be|weak/i.test(m) ? 'Mot de passe trop court ou trop simple (8 caractères ou plus)'
      : /rate limit|too many/i.test(m) ? 'Trop de courriels envoyés : réessaie dans une heure'
      : m;
    toast(fr);
  };
  const lireIdentifiants = () => {
    courrielEnCours = $('#fCourriel', v).value.trim();
    const mdp = $('#fMdp', v).value;
    if (!/\S+@\S+\.\S+/.test(courrielEnCours)) { toast('Courriel invalide'); return null; }
    return mdp;
  };
  $('#fConnecter', v)?.addEventListener('click', async () => {
    const mdp = lireIdentifiants(); if (mdp == null) return;
    if (!mdp) { toast('Entre ton mot de passe'); return; }
    try { await Sync.connecter(courrielEnCours, mdp); courrielEnCours = ''; toast('Connecté ✓'); setTimeout(() => vueFoyer(v), 600); } catch (err) { erreur(err); }
  });
  $('#fCreerCompte', v)?.addEventListener('click', async () => {
    const mdp = lireIdentifiants(); if (mdp == null) return;
    if (mdp.length < 8) { toast('Choisis un mot de passe de 8 caractères ou plus'); return; }
    try {
      const aConfirmer = await Sync.creerCompte(courrielEnCours, mdp);
      toast(aConfirmer ? 'Compte créé : clique le lien reçu par courriel, puis reviens te connecter' : 'Compte créé et connecté ✓');
      vueFoyer(v);
    } catch (err) { erreur(err); }
  });
  $('#fOubli', v)?.addEventListener('click', async () => {
    const mdp = lireIdentifiants(); if (mdp == null) return;
    try { await Sync.motDePasseOublie(courrielEnCours); toast('Courriel envoyé : ouvre le lien pour choisir un nouveau mot de passe'); } catch (err) { erreur(err); }
  });
  $('#fChangerMdp', v)?.addEventListener('click', async () => {
    const mdp = $('#fNouveauMdp', v).value;
    if (mdp.length < 8) { toast('8 caractères ou plus'); return; }
    try { await Sync.changerMotDePasse(mdp); Sync.finRecuperation(); toast('Mot de passe changé ✓'); vueFoyer(v); } catch (err) { erreur(err); }
  });
  $('#fCreer', v)?.addEventListener('click', async () => {
    const prenom = $('#fPrenom', v).value.trim(); if (!prenom) { toast('Indique ton prénom'); return; }
    try { await Sync.creerFoyer($('#fNomFoyer', v).value.trim() || 'Maison', prenom, $('#fGarder', v).checked); toast('Foyer créé ✓'); vueFoyer(v); } catch (err) { erreur(err); }
  });
  $('#fJoindre', v)?.addEventListener('click', async () => {
    const prenom = prompt('Ton prénom (affiché à l\'autre membre) :', e.utilisateur || ''); if (!prenom) return;
    if (!confirm('Les données du foyer vont remplacer celles de ce téléphone. Continuer ?')) return;
    try { await Sync.joindreFoyer($('#fCodeFoyer', v).value, prenom); toast('Foyer joint ✓'); vueFoyer(v); } catch (err) { erreur(err); }
  });
  $('#fPartager', v)?.addEventListener('click', async () => {
    const txt = `Rejoins notre liste d'épicerie : https://chrishub2.github.io/epicerie/ — Plus → Mon foyer → code ${st.foyer.code_invitation}`;
    try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); toast('Invitation copiée'); } } catch { /* annulé */ }
  });
  $('#fSync', v)?.addEventListener('click', async () => { toast('Synchronisation…'); await Sync.synchroniserMaintenant(); vueFoyer(v); toast('À jour ✓'); });
  $('#fLiberer', v)?.addEventListener('click', async () => {
    if (!confirm('Retirer de ce téléphone les photos déjà sauvegardées en ligne ? Elles restent dans la base.')) return;
    const n = await Sync.libererEspacePhotos(); toast(`${n} photo(s) retirée(s) du téléphone`);
  });
  $('#fDeco', v)?.addEventListener('click', async () => { if (confirm('Se déconnecter ? Les données restent sur ce téléphone.')) { await Sync.deconnecter(); vueFoyer(v); } });
}

// --- Apparence --------------------------------------------------------
function vueApparence(v) {
  const t = themeActuel();
  v.innerHTML = retour() + `<div class="carte"><h2>Apparence</h2>
    ${[['auto', 'Selon le téléphone', 'Suit le réglage clair/sombre de ton téléphone'], ['clair', 'Clair', 'Toujours clair'], ['sombre', 'Sombre', 'Toujours sombre']]
      .map(([k, n, d]) => `<label class="item" style="cursor:pointer"><input type="radio" name="theme" value="${k}" ${t === k ? 'checked' : ''}>
        <div class="grandir"><div class="nom">${n}</div><div class="info">${d}</div></div></label>`).join('')}
    <p class="doux">Réglage propre à cet appareil. Certains skins ont leur propre ambiance (toujours clair ou toujours sombre).</p></div>
    ${htmlChoixSkin()}`;
  brancherRetour(v);
  brancherChoixSkin(v);
  $$('input[name=theme]', v).forEach((r) => r.onchange = () => { appliquerTheme(r.value); toast('Apparence changée'); });
}

// --- Relevé de prix en magasin (inventaire) -----------------------------
let magasinReleve = null;
export function ouvrirReleve(magId) { section = 'releve'; if (magId) magasinReleve = magId; }

function vueReleve(v) {
  const e = S.get();
  const mags = e.magasins.filter((m) => m.actif !== false);
  magasinReleve ||= e.magasinCourant !== 'defaut' ? e.magasinCourant : mags[0]?.id;
  const releves = (e.releves || []).filter((r) => r.statut !== 'enregistré');
  const faits = (e.releves || []).filter((r) => r.statut === 'enregistré').length;
  v.innerHTML = retour() + `<div class="carte"><h2>Relevé de prix</h2>
      <p class="doux">Photographie les étiquettes qui t'intéressent : je lis le prix et le format, tu confirmes le produit. Les prix vont dans ton historique, pas dans ta liste. Sans réseau, les photos sont lues plus tard.</p>
      <div class="champ"><label>Magasin</label><select id="rlMag">${mags.map((m) => `<option value="${m.id}" ${m.id === magasinReleve ? 'selected' : ''}>${esc(m.nom)}</option>`).join('')}</select></div>
      <button class="btn" id="rlPhoto" style="width:100%;margin-bottom:8px">📷 Photographier une étiquette</button>
      <button class="btn sec" id="rlScan" style="width:100%">▥ Scanner un code-barres</button>
      ${faits ? `<p class="doux">${faits} prix déjà enregistré(s) par relevé.</p>` : ''}</div>
    <datalist id="rlCat">${e.articles.map((a) => `<option value="${esc(a.nom)}">`).join('')}</datalist>
    ${releves.map((r) => {
      const m = e.magasins.find((x) => x.id === r.magasinId);
      return `<div class="carte" data-rl="${r.id}">
        <div class="rang">${r.photoId ? `<div class="vignettes" style="width:72px;flex:none" data-ph="${r.photoId}"></div>` : (r.imageUrl ? `<img class="vignette" src="${esc(r.imageUrl)}" alt="">` : '<span class="vignette" style="display:grid;place-items:center">▥</span>')}
          <div class="grandir"><div class="doux">${m ? logoMagasin(m) : ''} · ${esc(r.date.slice(0, 10))}</div>
            <div class="doux">${r.statut === 'à lire' ? '⏳ En attente de lecture (réseau)' : r.code ? `▥ Code ${esc(r.code)} — écris le prix de l'étiquette` : r.offre ? '✓ Lu sur la photo — vérifie' : 'Prix non lu : écris-le'}</div></div></div>
        <div class="champ" style="margin-top:6px"><label>Produit</label><input data-nom list="rlCat" value="${esc(r.nom || r.nomLu || '')}" placeholder="ex. Beurre Lactantia"></div>
        <div class="rang"><div class="champ grandir"><label>Prix</label><input data-offre value="${esc(r.offre || '')}" placeholder="4,99 $ · 2/5 $"></div>
          <div class="champ grandir"><label>Format</label><input data-format value="${esc(r.format || '')}" placeholder="454 g"></div></div>
        <label class="doux rang"><input type="checkbox" data-liste style="width:auto"> Ajouter aussi à ma liste</label>
        <div class="rang" style="margin-top:6px"><button class="btn grandir" data-ok>Enregistrer</button><button class="btn danger" data-sup>✕</button></div></div>`;
    }).join('')}`;
  brancherRetour(v);
  $$('[data-ph]', v).forEach((el) => afficherPhoto({ id: el.dataset.ph, type: 'prix', note: '' }, el));
  $('#rlMag', v).onchange = (ev) => { magasinReleve = ev.target.value; };
  $('#rlPhoto', v).onclick = async () => {
    const blob = await prendrePhoto();
    if (!blob) return;
    const photoId = await S.enregistrerPhoto(blob);
    const id = S.uid('rl');
    S.maj((x) => { (x.releves ||= []).unshift({ id, photoId, magasinId: magasinReleve, date: new Date().toISOString(), statut: 'à lire', par: x.utilisateur }); });
    ajouterTache({ type: 'releve', releveId: id, photoId });
  };
  // Par code-barres : le produit est identifié (catalogue, bases ouvertes, épiceries.ca) ; tu écris le prix
  $('#rlScan', v).onclick = async () => {
    const { ouvrirScan } = await import('./scan.js');
    ouvrirScan((a) => {
      if (!a) return;
      S.maj((x) => { (x.releves ||= []).unshift({ id: S.uid('rl'), photoId: null, magasinId: magasinReleve, date: new Date().toISOString(), statut: 'lu',
        nom: a.nom, format: a.format || '', articleId: a.id, imageUrl: a.imageUrl || null, code: (a.codes || [])[0] || '', par: x.utilisateur }); });
      toast(`${a.nom} : écris le prix de l'étiquette`);
    }, { libelleOk: 'Ajouter au relevé' });
  };
  $$('[data-rl]', v).forEach((el) => {
    const r = releves.find((x) => x.id === el.dataset.rl);
    el.querySelector('[data-sup]').onclick = () => S.maj((x) => { x.releves = x.releves.filter((y) => y.id !== r.id); });
    el.querySelector('[data-ok]').onclick = async () => {
      const nom = el.querySelector('[data-nom]').value.trim();
      const offre = el.querySelector('[data-offre]').value.trim();
      const format = el.querySelector('[data-format]').value.trim();
      if (!nom) { toast('Indique le produit'); return; }
      if (!analyserOffre(offre)) { toast('Prix illisible : ex. 4,99 $, 2/5 $ ou 1,99 $/lb'); return; }
      const app = await import('./app.js');
      const a = app.assurerArticle(nom, { format, uniteRef: analyserFormat(format)?.base || 'unite' });
      const m = S.get().magasins.find((y) => y.id === r.magasinId);
      S.maj((x) => {
        x.prix.push({ id: S.uid('p'), articleId: a.id, banniere: m?.banniere, magasinId: r.magasinId, offre, format: format || a.format,
          type: r.rabais ? 'circulaire' : 'regulier', fin: null, source: r.photoId ? 'photo' : 'manuel', photoId: r.photoId || undefined, observeLe: r.date.slice(0, 10) });
        if (r.photoId) x.photos.push({ id: r.photoId, type: 'prix', articleId: a.id, date: r.date, prise_par: r.par, note: `${offre} · ${m?.nom || ''}` });
        const rr = x.releves.find((y) => y.id === r.id); Object.assign(rr, { statut: 'enregistré', nom, offre, format, articleId: a.id });
      });
      if (el.querySelector('[data-liste]').checked) app.ajouterALaListe(a.id);
      toast(`Prix enregistré : ${nom}`);
    };
  });
}

// --- Reçus ------------------------------------------------------------
/**
 * Prend un reçu en photo (1 ou plusieurs sections qui se chevauchent), puis :
 *  - avec l'IA : lecture immédiate, aperçu du reçu entier et verdict (complet ? sinon « reprends ») ;
 *  - sans réseau / sans IA : gardé et lu plus tard (file d'attente).
 * Exporté pour le bouton de la liste.
 */
export async function nouveauRecu() {
  fermerModale(); // la caméra doit passer devant (une fenêtre ouverte la cacherait)
  const blobs = await photographierRecu(); // cadre jaune, 1 ou plusieurs sections
  if (!blobs.length) return;
  const { iaDisponible, lireRecu } = await import('./ocr.js');
  if (!iaDisponible()) {
    const id = await enregistrerRecu(blobs, null);
    toast(navigator.onLine ? `Reçu enregistré (${blobs.length} photo(s)) — lecture en cours…` : 'Reçu gardé — il sera lu et vérifié au retour du réseau');
    await ajouterTache({ type: 'recu', recuId: id, photoIds: S.get().recus.find((r) => r.id === id).photoIds });
    return;
  }
  const R = await import('./recu.js');
  ouvrirModale('Vérification du reçu', `<div id="rvVerdict"><div class="alerte">⏳ Je lis et je vérifie ton reçu (${blobs.length} photo(s))… environ 20 à 40 secondes.</div></div>
    <p class="doux">Le reçu entier, tel que je le vois :</p><div id="rvEntier"></div><div id="rvActions" class="rang envelopper" style="margin-top:10px"></div>`, async (c) => {
    R.apercuEntier(blobs, $('#rvEntier', c));
    const lu = await lireRecu(blobs, undefined, R.nomsListe(), R.attendusListe());
    if (!$('#rvVerdict', c)) return; // fenêtre fermée ou remplacée entre-temps
    const v = R.verifierRecu(lu);
    $('#rvVerdict', c).innerHTML = v.ok
      ? `<div class="alerte vert">✅ <b>Reçu complet et bien lu.</b> ${esc(v.resume)}<br>Je peux prendre l'information.</div>`
      : `<div class="alerte">⚠️ <b>${v.incertain ? 'Je ne peux pas confirmer ce reçu.' : 'Reçu incomplet ou mal lu — reprends les photos.'}</b><ul>${v.problemes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${v.resume ? `<span class="doux">${esc(v.resume)}</span>` : ''}</div>`;
    $('#rvActions', c).innerHTML = v.ok
      ? '<button class="btn" id="rvOk">✓ Enregistrer et remplir ma liste</button><button class="btn sec" id="rvRefaire">📷 Reprendre</button>'
      : '<button class="btn" id="rvRefaire">📷 Reprendre les photos</button><button class="btn sec" id="rvOk">Garder quand même</button>';
    $('#rvRefaire', c).onclick = () => nouveauRecu();
    $('#rvOk', c).onclick = async () => {
      const id = await enregistrerRecu(blobs, lu);
      $('#rvActions', c).innerHTML = '';
      const etat = (m) => { $('#rvVerdict', c).innerHTML = `<div class="alerte">⏳ Je remplis ta liste et je complète les fiches… ${esc(m)}</div>`; };
      const bilan = await R.appliquerRecu(id, etat);
      toast(`Reçu enregistré ✓ ${R.texteBilan(bilan)}`);
      apresApplication(id);
    };
  });
}

/** Après avoir rempli la liste : propose de compléter les fiches sans photo (une à la fois), puis montre le reçu. */
async function apresApplication(id) {
  const R = await import('./recu.js');
  if (navigator.onLine && (await R.aCompleter(id)).length) {
    toast('Complétons les fiches : touche le bon produit pour chacune (ou « Plus tard »).');
    R.completerFiches(id, () => ouvrirDetailRecu(id));
  } else ouvrirDetailRecu(id);
}

/** Association manuelle : pour chaque ligne du reçu, choisis l'article (catalogue) ou tape un nouveau nom. */
function associerRecu(id) {
  const e = S.get();
  const r = e.recus.find((x) => x.id === id);
  const nomDe = (aid) => e.articles.find((a) => a.id === aid)?.nom || '';
  const libelleChoix = (nom) => nom ? `🛒 ${esc(nom)}` : '— aucun produit —';
  ouvrirModale('Associer les produits', `<p class="doux">Pour chaque ligne de la facture, touche la case pour choisir le produit dans ta liste d'épicerie ou ton catalogue (ou tape un nouveau nom pour le créer). Laisse « aucun produit » si ce n'est pas un produit (sac, consigne…). Je recompare ensuite les prix et je cherche le code-barres en ligne.</p>
    ${r.lignes.map((l, i) => natureLigne(l) !== 'produit' && !(l.manuel && l.articleId) ? '' : `<div class="carte" style="padding:8px;margin-bottom:6px">
      <div class="rang"><b class="grandir">${esc(l.nomClair || l.libelle)}</b><b>${argent(l.prix)}</b></div>
      <div class="doux" style="font-size:12px">${esc(l.libelle)}${l.code ? ` · code ${esc(l.code)}` : ''}</div>
      <button type="button" class="btn sec" data-as="${i}" data-nom="${esc(nomDe(l.articleId))}" style="width:100%;margin-top:6px;text-align:left">${libelleChoix(nomDe(l.articleId))} ▾</button>
      <div data-panneau="${i}" hidden></div></div>`).join('')}
    <button class="btn" id="asOk" style="width:100%;margin-top:6px">✓ Enregistrer les associations</button>`, (c) => {
    // Sélecteur commun (ui.js) : liste d'épicerie, puis catalogue, recherche et « Créer »
    $$('[data-as]', c).forEach((b) => brancherSelecteurProduit(b, $(`[data-panneau="${b.dataset.as}"]`, c), (nom) => {
      b.dataset.nom = nom;
      b.innerHTML = `${libelleChoix(nom)} ▾`;
    }));
    $('#asOk', c).onclick = async (ev) => {
      const app = await import('./app.js');
      const choix = {};
      $$('[data-as]', c).forEach((inp) => {
        const i = Number(inp.dataset.as), l = r.lignes[i], nom = (inp.dataset.nom || '').trim();
        let aid = '';
        if (nom) {
          const ex = S.get().articles.find((a) => a.nom.toLowerCase() === nom.toLowerCase());
          aid = ex ? ex.id : app.assurerArticle(nom, { format: l.format || '', uniteRef: analyserFormat(l.format)?.base || 'unite', marque: l.marque || '' }).id;
        }
        if ((l.articleId || '') !== aid || (nom && !l.manuel)) choix[i] = aid;
      });
      if (!Object.keys(choix).length) { fermerModale(); ouvrirDetailRecu(id); return; }
      ev.target.disabled = true;
      const R = await import('./recu.js');
      const bilan = await R.associerManuellement(id, choix, (m) => { ev.target.textContent = `⏳ ${m}`; });
      toast(`Associations enregistrées ✓ ${R.texteBilan(bilan)}`);
      ouvrirDetailRecu(id);
    };
  });
}

/** Enregistre les photos et le reçu (lu ou non). Retourne son id. */
async function enregistrerRecu(blobs, lu) {
  const photoIds = [];
  for (const b of blobs) photoIds.push(await S.enregistrerPhoto(b));
  const id = S.uid('rc');
  const date = new Date().toISOString();
  S.maj((x) => {
    (x.recus ||= []).unshift({ ...(lu || {}), id, photoId: photoIds[0], photoIds, cree: date, statut: lu ? 'lu' : 'à lire', par: x.utilisateur });
    photoIds.forEach((p, i) => x.photos.push({ id: p, type: 'recu', articleId: null, date, prise_par: x.utilisateur, note: `Reçu ${i + 1}/${photoIds.length}` }));
  });
  return id;
}

/** Fenêtre de détail d'un reçu : verdict, reçu entier, toutes les informations lues. */
async function ouvrirDetailRecu(id) {
  const R = await import('./recu.js');
  const r = (S.get().recus || []).find((x) => x.id === id);
  if (!r) return;
  const v = r.statut === 'lu' ? R.verifierRecu(r) : null;
  const nbFiches = (await R.aCompleter(id)).length;
  ouvrirModale('Reçu', `<div class="rang envelopper" style="margin-bottom:10px">
      ${r.statut === 'lu' && r.lignes?.length ? '<button class="btn" id="rcAssocier">🔗 Associer les produits à la main</button>' : ''}
      ${nbFiches ? `<button class="btn sec" id="rcCompleter">🔎 Compléter ${nbFiches} fiche(s) : photo, format, prix</button>` : ''}
      ${r.statut === 'lu' && !(r.applique && r.bilan?.relies) ? '<button class="btn" id="rcAppliquer">Remplir ma liste avec ce reçu</button>' : ''}
      ${r.statut === 'lu' && (!r.verification || r.source !== 'ia' || (r.applique && !r.bilan?.relies)) ? '<button class="btn sec" id="rcRelire">🔄 Relire avec l\'IA</button>' : ''}
      ${v && !v.ok ? '<button class="btn sec" id="rcRefaire">📷 Reprendre ce reçu</button>' : ''}</div>
    ${R.htmlDetail(r)}
    <button class="btn danger" id="supRecu" style="margin-top:14px">Supprimer ce reçu</button>`, (c) => {
    const det = $('#rcEntierBloc', c);
    const montrer = () => { if (det.open && !$('#rcEntier', c).childElementCount) R.apercuEntier(r.photoIds || [r.photoId], $('#rcEntier', c)); };
    det.addEventListener('toggle', montrer);
    if (v && !v.ok) { det.open = true; montrer(); }
    $('#rcAppliquer', c)?.addEventListener('click', async (ev) => {
      ev.target.disabled = true; ev.target.textContent = '⏳ En cours…';
      const bilan = await R.appliquerRecu(r.id, (m) => { ev.target.textContent = `⏳ ${m}`; });
      toast(R.texteBilan(bilan)); apresApplication(r.id);
    });
    $('#rcRelire', c)?.addEventListener('click', async (ev) => {
      ev.target.disabled = true; ev.target.textContent = '⏳ Lecture par l\'IA… (20 à 40 s)';
      try {
        await R.relireRecu(r.id);
        const bilan = await R.appliquerRecu(r.id, (m) => { ev.target.textContent = `⏳ ${m}`; });
        toast(R.texteBilan(bilan));
        apresApplication(r.id);
      } catch (err) { toast(err.message); ouvrirDetailRecu(r.id); }
    });
    $('#rcAssocier', c)?.addEventListener('click', () => associerRecu(r.id));
    $('#rcCompleter', c)?.addEventListener('click', () => R.completerFiches(r.id, () => ouvrirDetailRecu(r.id)));
    $('#rcRefaire', c)?.addEventListener('click', () => nouveauRecu());
    $('#supRecu', c).onclick = () => { if (confirm('Supprimer ce reçu ?')) { S.maj((x) => { x.recus = x.recus.filter((y) => y.id !== r.id); }); fermerModale(); } };
  });
}

function vueRecus(v) {
  const e = S.get();
  const recus = e.recus || [];
  v.innerHTML = retour() + `<button class="btn" id="nouvRecu" style="width:100%;margin-bottom:10px">📷 Photographier un reçu</button>
    <p class="doux">Centre le reçu dans le cadre jaune. Reçu long : prends-le en plusieurs sections, de haut en bas ; le bas de la photo précédente s'affiche en haut du cadre pour que les photos se chevauchent. Je te montre ensuite le reçu entier et je te confirme s'il est complet, sinon je te demande de reprendre.</p>`
    + (recus.length ? recus.map((r) => `<div class="carte" data-recu="${r.id}" style="cursor:pointer"><div class="rang">
        <b class="grandir">${r.banniere ? esc(PROGRAMMES_NOMS[r.banniere] || r.banniere) : 'Magasin ?'} · ${esc(r.date || r.cree.slice(0, 10))}</b><b>${r.total != null ? argent(r.total) : ''}</b></div>
        <div class="doux">${r.statut === 'à lire' ? '⏳ En attente de lecture (réseau)' : `${(r.lignes || []).length} ligne(s) lue(s)${r.verification?.complet === false ? ' · ⚠️ à vérifier' : ''}${r.applique ? ' · ✓ liste remplie' : ''}`} · ${(r.photoIds || [1]).length} photo(s) · par ${esc(r.par || '')}</div></div>`).join('')
      : '<div class="vide">Aucun reçu. Après l\'épicerie, prends ton reçu en photo.</div>');
  brancherRetour(v);
  $('#nouvRecu', v).onclick = nouveauRecu;
  $$('[data-recu]', v).forEach((el) => el.onclick = () => ouvrirDetailRecu(el.dataset.recu));
}

const PROGRAMMES_NOMS = { iga: 'IGA', super_c: 'Super C', metro: 'Metro', maxi: 'Maxi', costco: 'Costco', jean_coutu: 'Jean Coutu', provigo: 'Provigo', walmart: 'Walmart' };

// --- Sauvegarde -------------------------------------------------------
function vueSauvegarde(v) {
  v.innerHTML = retour() + `<div class="carte"><h2>Exporter / importer</h2>
      <p class="doux">Copie de sécurité de tes données (sans les photos). Elle contient tes numéros de carte : garde-la en lieu sûr.</p>
      <div class="rang envelopper"><button class="btn" id="exp">Exporter</button><button class="btn sec" id="imp">Importer</button></div></div>
    ${S.copieAvantV3() ? `<div class="carte"><h2>Copie avant la mise à jour des produits</h2>
      <p class="doux">Faite automatiquement le ${new Date(S.copieAvantV3().date).toLocaleDateString('fr-CA', { dateStyle: 'medium' })}, avant le passage aux variantes (marque + format). Gardée 30 jours. À utiliser seulement si quelque chose semble perdu.</p>
      <button class="btn sec" id="avantV3">↩︎ Revenir à avant</button></div>` : ''}
    <div class="carte"><h2>Mode démo</h2><p class="doux">Remet les données d'exemple (prix fictifs). Tes ajouts seront effacés de ce téléphone.</p>
      <button class="btn danger" id="reinit">Réinitialiser la démo</button></div>`;
  brancherRetour(v);
  $('#exp', v).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([S.exporter()], { type: 'application/json' }));
    a.download = `epicerie-sauvegarde-${aujourdhui()}.json`; a.click();
  };
  $('#imp', v).onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json';
    i.onchange = async () => { try { S.importer(await i.files[0].text()); toast('Données importées'); } catch (err) { toast(err.message); } };
    i.click();
  };
  $('#avantV3', v)?.addEventListener('click', () => {
    if (!confirm('Remettre tes données telles qu\'avant la mise à jour des produits ? Ce que tu as changé depuis sera perdu sur ce téléphone.')) return;
    S.importer(JSON.stringify(S.copieAvantV3().etat));
    toast('Données d\'avant la mise à jour remises');
  });
  $('#reinit', v).onclick = () => { if (confirm('Effacer tes données de démo sur ce téléphone et remettre les exemples ?')) { S.reinitialiser(); toast('Démo réinitialisée'); } };
}
