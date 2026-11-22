// =====================================================================
// Lecteur de code-barres + secours par photo
// Cascade : ① catalogue local → ② Open Food Facts → ③ saisie / photo.
// (③ épiceries.ca, sites des bannières et recherche web : ajoutés par les
//  agents quand la base partagée sera branchée.)
// =====================================================================
import * as S from './store.js';
import { $, esc, argent, ouvrirModale, fermerModale, quandFermee, toast, aujourdhui, nomBanniere, brancherSelecteurProduit } from './ui.js';
import { parCodeBarres, actualiserArticle, MAGASINS_EC } from './epiceries.js';
import { analyserFormat, analyserOffre, formatLisible, gtinVariantes, infoUnite } from './normalise.js';

// Bases ouvertes interrogées dans l'ordre (aliments → beauté/pharmacie → autres produits).
const BASES = [
  ['Open Food Facts', 'https://world.openfoodfacts.org'],
  ['Open Beauty Facts', 'https://world.openbeautyfacts.org'],
  ['Open Products Facts', 'https://world.openproductsfacts.org'],
];
const CHAMPS = 'product_name_fr,product_name,product_name_en,brands,quantity,product_quantity,product_quantity_unit,categories_tags,nutriscore_grade,'
  + 'labels_tags,origins_tags,manufacturing_places,allergens_tags,image_front_url,image_url';

const ALLERGENES_FR = { milk: 'lait', gluten: 'gluten', eggs: 'œufs', nuts: 'noix', peanuts: 'arachides', soybeans: 'soja', fish: 'poisson',
  crustaceans: 'crustacés', molluscs: 'mollusques', 'sesame-seeds': 'sésame', mustard: 'moutarde', celery: 'céleri',
  'sulphur-dioxide-and-sulphites': 'sulfites', lupin: 'lupin' };

/** Format d'un produit Open Food Facts : le texte « quantity » s'il est lisible, sinon la quantité chiffrée (product_quantity + unité). */
function formatOFF(p) {
  const texte = p?.quantity ? normaliserQuantite(p.quantity) : '';
  if (texte && analyserFormat(texte)) return texte;
  const q = Number(p?.product_quantity), u = String(p?.product_quantity_unit || '').toLowerCase();
  if (q > 0 && /^(g|kg|ml|cl|l)$/.test(u)) return formatLisible(`${q} ${u}`);
  return texte;
}

// Unités offertes dans le menu « Format » (toutes reconnues par le normalisateur de prix),
// suivies des unités créées par Chris (S.get().unitesPerso).
const UNITES_FORMAT = ['g', 'kg', 'mL', 'L', 'lb', 'oz', 'unités', 'rouleaux', 'sachets', 'capsules', 'œufs', 'douzaine'];
const NOUVELLE_UNITE = '__nouvelle__';
function unitesDisponibles() {
  const perso = (S.get().unitesPerso || []).filter((u) => !UNITES_FORMAT.some((b) => b.toLowerCase() === u.toLowerCase()));
  return [...UNITES_FORMAT, ...perso];
}

/** « 454 g » → { qte: '454', unite: 'g' } ; « 12 x 355 ml » → { qte: '12 x 355', unite: 'mL' }. Illisible → tout dans qte. */
function separerFormat(txt) {
  const s = String(txt || '').trim();
  const m = s.match(/^(\d[\d.,\s]*(?:\s*[x×]\s*\d[\d.,]*)?)\s*([^\d\s].*)$/i);
  if (!m) return { qte: s, unite: '' };
  const brute = m[2].trim();
  const connue = unitesDisponibles().find((u) => u.toLowerCase() === brute.toLowerCase());
  return { qte: m[1].trim(), unite: connue || brute };
}

/** Raison de douter d'une nouvelle unité (ou '' si elle a l'air correcte). */
function douteUnite(nom) {
  if (/\d/.test(nom)) return 'contient des chiffres (le nombre va dans la case de gauche)';
  if (/[^a-zà-ÿœ.\s'’-]/i.test(nom)) return 'contient des symboles inhabituels';
  if (nom.length > 20) return 'est très long pour une unité';
  if (nom.replace(/[.\s]/g, '').length < 2) return 'est très court';
  const info = infoUnite(nom);
  if (info) return `est déjà connue du calcul des prix (même chose que ${info.base === 'kg' ? 'g / kg' : info.base === 'l' ? 'mL / L' : 'unités'})`;
  return '';
}

/** Ce qu'Open Food Facts nous dit en plus : produit du Québec, bio, allergènes. */
function detailsOFF(p) {
  if (!p) return { quebec: false, bio: false, allergenes: [] };
  // Les étiquettes arrivent parfois telles que tapées (« en:Aliments du Québec ») : minuscules, sans accents.
  const simple = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const labels = simple((p.labels_tags || []).join(' '));
  const quebec = /quebec/.test(`${labels} ${simple((p.origins_tags || []).join(' '))} ${simple(p.manufacturing_places)}`);
  const bio = /organic|biologique|(^|[:\s-])bio\b|ecocert/.test(labels);
  const allergenes = [...new Set((p.allergens_tags || []).map((t) => { const k = t.replace(/^\w+:/, ''); return ALLERGENES_FR[k] || k.replace(/-/g, ' '); }))];
  return { quebec, bio, allergenes };
}

/** Ligne de résumé pour l'écran du scan. */
function resumeDetails(d) {
  const morceaux = [d.quebec && '🍁 Produit du Québec', d.bio && '🌱 Bio', d.allergenes.length && `⚠️ Allergènes : ${d.allergenes.join(', ')}`].filter(Boolean);
  return morceaux.length ? `<div class="alerte">${morceaux.map(esc).join(' · ')}</div>` : '';
}

/** Applique ces détails à un article (ne retire jamais un 🍁 mis à la main). */
function appliquerDetails(ar, d) {
  if (d.quebec) ar.local = true;
  if (d.bio) ar.bio = true;
  if (d.allergenes.length) ar.allergenes = d.allergenes;
}
import { assurerArticle, ajouterALaListe, rayonParDefaut, trouverArticle, brancherRayon, texteBoutonRayon } from './app.js';
import * as P from './produits.js';
import { DICO_ATTRIBUTS, attributDe, definirCaracteristique, caracteristiquesDuCode, REMPLACEMENTS, REMPLACEMENT_DEFAUT, definirRemplacement } from './choix.js';
import { ajouterNomsAlt } from './noms.js';
import { BANNIERES } from './demo-data.js';
import { photoMaisonPermise, marquerPhotoEnvoyee } from './visuels.js';

// Maquette lecteur v1 : chaque champ dit d'où vient sa valeur
const SOURCE = { code: 'du code', auto: 'auto', toi: 'à toi' };
const TITRE_SOURCE = { code: 'Lu en ligne avec le code-barres', auto: 'Déduit par l’app', toi: 'Rien ne le remplit : à toi' };
const src = (k) => `<span class="src ${k}" title="${TITRE_SOURCE[k]}">${SOURCE[k]}</span>`;

const ZXING_URL = 'https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
let arret = null;      // fonction qui coupe la caméra
let dernier = { code: '', t: 0 };

function bip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); o.frequency.value = 1200; o.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.08);
  } catch { /* silencieux */ }
  navigator.vibrate?.(60);
}

function chargerScript(src) {
  return new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Chargement ZXing impossible'));
    document.head.appendChild(s);
  });
}

async function demarrerCamera(video, surCode) {
  // 1) API native (Android / Chrome)
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('ean_13')) {
        // itf = caisses Costco (ITF-14), code_128 = certaines étiquettes de gros formats
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'].filter((f) => formats.includes(f)) });
        const flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = flux; await video.play();
        let actif = true;
        const boucle = async () => {
          if (!actif) return;
          try { const r = await det.detect(video); if (r[0]) surCode(r[0].rawValue); } catch { /* image pas prête */ }
          setTimeout(boucle, 200);
        };
        boucle();
        return () => { actif = false; flux.getTracks().forEach((t) => t.stop()); };
      }
    } catch { /* on passe au secours */ }
  }
  // 2) Secours ZXing (iPhone / Safari)
  await chargerScript(ZXING_URL);
  const lecteur = new window.ZXingBrowser.BrowserMultiFormatReader();
  const ctrl = await lecteur.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res) surCode(res.getText()); });
  return () => ctrl.stop();
}

/** Ouvre la caméra et rend le premier code-barres lu (ou tapé) ; null si on ferme la fenêtre. */
export function lireCode(titre = 'Scanner un code-barres') {
  return new Promise((ok) => {
    let fini = false;
    const fin = (code) => { if (fini) return; fini = true; arret?.(); arret = null; quandFermee(null); ok(code); };
    ouvrirModale(titre, `<video class="scan" id="video" playsinline muted></video>
      <p class="doux" id="etatScan">Démarrage de la caméra…</p>
      <div class="rang" style="margin-top:8px"><input id="codeManuel" inputmode="numeric" placeholder="ou tape le code (8 à 14 chiffres)"><button class="btn sec" id="okCode">OK</button></div>`, async (c) => {
      const traiter = (code) => {
        code = String(code).replace(/\D/g, '');
        if (!/^\d{8,14}$/.test(code)) { toast('Code invalide'); return; }
        bip(); fin(code);
      };
      $('#okCode', c).onclick = () => traiter($('#codeManuel', c).value);
      quandFermee(() => fin(null));
      try {
        const stop = await demarrerCamera($('#video', c), traiter);
        if (fini) stop(); else { arret = stop; $('#etatScan', c).textContent = ''; }
      } catch {
        $('#etatScan', c).textContent = 'Caméra indisponible : tape le code sous l\'image.';
      }
    });
  });
}

/** Ouvre le lecteur. surArticle(article) est appelé pour chaque produit reconnu et confirmé. */
/**
 * Ouvre le lecteur. surArticle(article) est appelé pour chaque produit reconnu et confirmé.
 * opts.cibleId : on scanne POUR un article existant → ses champs sont remplis (nom, marque,
 * format, catégorie, photo officielle, code, vrais prix) au lieu de créer un autre article.
 */
export function ouvrirScan(surArticle, opts = {}) {
  ouvrirModale(opts.cibleId ? 'Scanner pour remplir la fiche' : opts.inventaire ? 'Scanner mes produits' : 'Code-barres', `
    ${opts.inventaire ? '<p class="doux" style="margin-top:0">Fais le tour de tes produits : rien n\'est ajouté à ta liste d\'épicerie. Pour un produit inconnu, choisis sa fiche (▾) ou garde le nom proposé pour en créer une.</p>' : ''}
    <video class="scan" id="video" playsinline muted></video>
    <p class="doux" id="etatScan">Démarrage de la caméra…</p>
    <label class="rang" style="justify-content:flex-end;font-size:16px;font-weight:600;margin-top:6px;text-align:right">Mode rafale (scanner plusieurs produits d'affilée) <input type="checkbox" id="rafale" style="width:30px;height:30px;margin:0" ${opts.inventaire ? 'checked' : ''}></label>
    <div class="rang" style="margin-top:8px"><input id="codeManuel" inputmode="numeric" placeholder="ou tape le code (8 à 14 chiffres)"><button class="btn sec" id="okCode">OK</button></div>
    <div id="resultat" style="margin-top:10px"></div>`, async (c) => {
    const etat = $('#etatScan', c);
    const traiter = (code) => {
      code = String(code).replace(/\D/g, '');
      if (!/^\d{8,14}$/.test(code)) { toast('Code invalide'); return; }
      const now = Date.now();
      if (code === dernier.code && now - dernier.t < 3000) return; // anti-doublon
      dernier = { code, t: now }; bip();
      if (!$('#rafale', c).checked) { arret?.(); arret = null; etat.textContent = `Code ${code}`; }
      rechercher(code, $('#resultat', c), surArticle, () => $('#rafale', c).checked, opts.cibleId, opts.libelleOk);
    };
    $('#okCode', c).onclick = () => traiter($('#codeManuel', c).value);
    quandFermee(() => { arret?.(); arret = null; opts.surFin?.(); });
    try {
      arret = await demarrerCamera($('#video', c), traiter);
      etat.textContent = '';
    } catch (err) {
      etat.textContent = 'Caméra indisponible (permission refusée ou navigateur non compatible). Tape le code ou prends une photo.';
    }
  });
}

/**
 * Rafraîchit les fiches qui ont un code-barres avec Open Food Facts : 🍁 Québec, bio, allergènes,
 * et format / marque / photo / Nutri-Score seulement s'ils manquent (ce que tu as écrit n'est jamais remplacé).
 * Une fiche vérifiée il y a moins de 30 jours est sautée (sauf opts.tout). Environ 1 requête par seconde
 * pour rester sous la limite d'Open Food Facts. etat(texte) reçoit la progression.
 */
export async function rafraichirFiches(etat = () => {}, opts = {}) {
  const limite = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const aFaire = S.get().articles.filter((a) => a.codes?.length && (opts.tout || !a.offVerifie || a.offVerifie < limite));
  const bilan = { verifies: 0, trouves: 0, enrichis: 0, total: aFaire.length };
  for (const [n, a] of aFaire.entries()) {
    etat(`${n + 1}/${aFaire.length} · ${a.nom}`);
    let p = null;
    // Les codes 12-13 chiffres d'abord (ce qu'Open Food Facts connaît), 4 essais max par fiche
    const codes = [...a.codes].sort((x, y) => Math.abs(x.length - 13) - Math.abs(y.length - 13)).slice(0, 4);
    for (const c of codes) {
      try {
        const r = await fetch(`${BASES[0][1]}/api/v2/product/${c}.json?fields=${CHAMPS}`);
        const j = await r.json();
        if (j.status === 1 && j.product) p = j.product;
      } catch { /* hors ligne ou limite atteinte : on passe */ }
      await new Promise((ok) => setTimeout(ok, 700)); // ~85 requêtes/minute max
      if (p) break;
    }
    bilan.verifies++;
    let change = false;
    S.maj((x) => {
      const ar = x.articles.find((i) => i.id === a.id);
      if (!ar) return;
      ar.offVerifie = aujourdhui();
      if (!p) return;
      bilan.trouves++;
      const avant = JSON.stringify([ar.local, ar.bio, ar.allergenes, ar.format, ar.marque, ar.imageUrl, ar.nutriscore]);
      appliquerDetails(ar, detailsOFF(p));
      const fmt = formatOFF(p);
      if (!ar.format && fmt) { ar.format = fmt; const f = analyserFormat(fmt); if (f) ar.uniteRef = f.base; }
      if (!ar.marque && p.brands) ar.marque = p.brands.split(',')[0].trim();
      if (!ar.imageUrl && (p.image_front_url || p.image_url)) ar.imageUrl = p.image_front_url || p.image_url;
      if (!ar.nutriscore && p.nutriscore_grade?.length === 1) ar.nutriscore = p.nutriscore_grade;
      change = avant !== JSON.stringify([ar.local, ar.bio, ar.allergenes, ar.format, ar.marque, ar.imageUrl, ar.nutriscore]);
    });
    if (change) bilan.enrichis++;
  }
  return bilan;
}

/** Infos d'un code-barres (bases ouvertes + épiceries.ca), sans interface. null si inconnu. */
export async function infosCode(code) {
  const variantes = gtinVariantes(code);
  const [trouve, ec] = await Promise.all([chercherEnLigne(variantes), parCodeBarres(variantes).catch(() => null)]);
  const p = trouve?.p || null, ecp = ec?.product || null;
  if (!p && !ecp) return null;
  return { nom: p ? (p.product_name_fr || p.product_name || '') : (ecp?.name || ''), marque: p?.brands?.split(',')[0]?.trim() || ecp?.brand || '',
    format: formatOFF(p) || (ecp?.size ? formatLisible(ecp.size) : ''),
    image: p?.image_front_url || p?.image_url || ecp?.image || '', details: detailsOFF(p), ec, ecp, variantes };
}

async function chercherEnLigne(variantes) {
  for (const [nomBase, url] of BASES) {
    for (const v of variantes) {
      try {
        const r = await fetch(`${url}/api/v2/product/${v}.json?fields=${CHAMPS}`);
        const j = await r.json();
        if (j.status === 1 && j.product && (j.product.product_name_fr || j.product.product_name)) return { p: j.product, source: nomBase };
      } catch { /* hors ligne ou base indisponible */ }
    }
  }
  return null;
}

async function rechercher(code, zone, surArticle, enRafale, cibleId, libelleOk = 'Ajouter à la liste') {
  const e = S.get();
  const variantes = gtinVariantes(code);
  // ① catalogue (toutes les variantes : UPC/EAN, caisse ITF-14)
  const local = e.articles.find((a) => a.codes?.some((c) => variantes.includes(c)));
  if (local && local.id !== cibleId) {
    surArticle(local);
    // Déjà connu : hors rafale, on ferme tout de suite sans message (le produit est ajouté par surArticle)
    if (enRafale()) zone.innerHTML = `<div class="alerte vert">✓ ${esc(local.nom)} (déjà au catalogue)</div>`;
    else if (zone.isConnected) fermerModale();
    return;
  }
  zone.innerHTML = `<p class="doux">Recherche du produit ${esc(code)}${code.length === 14 ? ' (code de caisse, je cherche aussi le produit à l\'unité)' : ''}…</p>`;
  // ② bases ouvertes (fiche produit) + épiceries.ca (vrais prix), en parallèle
  const [trouve, ec] = await Promise.all([chercherEnLigne(variantes), parCodeBarres(variantes).catch(() => null)]);
  const p = trouve?.p || null;
  const ecp = ec?.product || null;

  const nomPropose = p ? (p.product_name_fr || p.product_name || '') : (ecp?.name || '');
  const fmt = formatOFF(p) || (ecp?.size ? formatLisible(ecp.size) : '');
  const details = detailsOFF(p);
  const fmtSep = separerFormat(fmt);
  // Rayon proposé (deviné, ou celui choisi à la main sur la fiche visée) ; modifiable dans le formulaire
  const cible = cibleId ? S.get().articles.find((x) => x.id === cibleId) : null;
  let rayonId = cible?.rayonManuel ? cible.rayonId : p ? devinerRayon(p.categories_tags || []) : (cible?.rayonId || rayonParDefaut());
  let rayonChoisi = false;
  let image = p?.image_front_url || p?.image_url || ecp?.image || '';
  // Lecteur principal : « Sauvegarder » (fiche seulement) et « Sauvegarder + ajouter à la liste »
  const deuxBoutons = !cibleId && libelleOk === 'Ajouter à la liste';
  let maPhotoId = null; // photo prise dans le formulaire, sans le fermer
  let maPhotoBlob = null; // option B : aussi envoyée au PC comme « ta photo » (mise à nos standards)
  zone.innerHTML = `
    ${ecp ? `<div class="alerte vert">💲 Prix réels trouvés sur épiceries.ca (${esc(argent(ecp.price))} chez ${esc(MAGASINS_EC[ecp.store] ? nomBanniere(MAGASINS_EC[ecp.store]) : ecp.store)}) — ils seront ajoutés.</div>` : ''}
    ${p || ecp ? `<div class="alerte vert">Trouvé sur ${esc(trouve?.source || 'épiceries.ca')}${p?.nutriscore_grade && p.nutriscore_grade.length === 1 ? ` · Nutri-Score ${esc(p.nutriscore_grade.toUpperCase())}` : ''}</div>
          ${resumeDetails(details)}
          ${image ? `<img src="${esc(image)}" alt="" style="display:block;max-height:160px;max-width:100%;margin:0 auto 8px;border-radius:8px;background:#fff">` : ''}`
        : `<div class="alerte ambre">Produit inconnu dans les bases ouvertes (code ${esc(code)}). Fréquent pour les produits Kirkland/Costco. Tape le nom ou prends une photo : le code sera retenu pour la prochaine fois.</div>`}
    ${cibleId ? '' : `<div class="legende-src">Source de chaque champ : ${src('code')} ${src('auto')} ${src('toi')}</div>`}
    <div class="champ"><label>Nom (en français, à ta façon) ${cibleId ? '' : src(nomPropose ? 'code' : 'toi')}</label><input id="sNom" value="${esc(nomPropose)}" placeholder="[Texte]">
      ${cibleId ? '' : '<button type="button" class="btn sec" id="sChoix" style="width:100%;margin-top:6px;text-align:left">📚 C\'est un produit de ma liste ou de mon catalogue ▾</button><div id="sPanneau" hidden></div>'}</div>
    <div class="champ"><label>Marque ${cibleId ? '' : src(p?.brands || ecp?.brand ? 'code' : 'toi')}</label><input id="sMarque" value="${esc(p?.brands?.split(',')[0] || ecp?.brand || '')}" placeholder="[Texte]"></div>
    <div class="champ"><label>Format ${cibleId ? '' : src(fmt ? 'code' : 'toi')}</label><div class="rang"><input id="sQte" class="grandir" inputmode="decimal" value="${esc(fmtSep.qte)}" placeholder="[Nombre]">
      <select id="sUnite" class="grandir"></select></div>
      <div id="sNouvU" hidden><div class="rang" style="margin-top:6px"><input id="sUniteNom" class="grandir" placeholder="[Texte]"><button type="button" class="btn sec" id="sUniteOk">Sauvegarder</button></div></div></div>
    <div class="champ"><label>Rayon ${cibleId ? '' : src('auto')}</label><button type="button" class="btn sec" id="sRayon" style="width:100%;text-align:left">${esc(texteBoutonRayon(rayonId))}</button><div id="sRayonPanneau" hidden></div></div>
    <div id="sVar"></div>
    ${cibleId ? '' : champsFiche({ p, details, fmt, nomPropose })}
    <p class="doux">${cibleId ? 'Vérifie au besoin, puis remplis la fiche : nom, marque, format, catégorie, photo et prix seront mis à jour.' : 'Si le nom correspond à un article de ton catalogue, le code y sera simplement rattaché.'}</p>
    ${image ? '' : '<div id="sPhotos" class="champ"><label>Photo du produit</label><p class="doux">Recherche de photos en ligne…</p></div>'}
    <div id="sMaPhoto" class="champ" hidden><label>Ta photo (jointe à la fiche à la sauvegarde)</label>
      <img id="sMaPhotoImg" alt="" style="display:block;max-height:160px;max-width:100%;margin:0 auto;border-radius:8px;background:#000"></div>
    <button type="button" class="btn sec" id="sPhoto" style="width:100%">📷 Ajouter une photo</button>
    ${deuxBoutons
      ? `<div style="display:grid;gap:8px;margin-top:10px"><button class="btn" id="sOk">💾 Sauvegarder + ajouter à la liste</button>
         <button class="btn sec" id="sSauver">💾 Sauvegarder seulement</button></div>`
      : `<div class="rang envelopper" style="margin-top:10px"><button class="btn" id="sOk">${cibleId ? '✓ Remplir la fiche' : esc(libelleOk)}</button></div>`}`;
  // Relier à une fiche existante : le nom choisi rattache le code à cette fiche (pas de doublon)
  // Produit déjà au catalogue : ce code est-il une variante existante ou une nouvelle marque/format ?
  const val = (id) => zone.querySelector(id).value.trim();
  // Format = nombre + unité (menu). « Créer une unité… » en dernier : sauvegardée pour les prochaines fois.
  const selU = zone.querySelector('#sUnite');
  const remplirUnites = (choisie) => {
    const liste = unitesDisponibles();
    if (choisie && !liste.some((u) => u.toLowerCase() === choisie.toLowerCase())) liste.push(choisie);
    selU.innerHTML = `<option value="">[Unité]</option>${liste.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}<option value="${NOUVELLE_UNITE}">➕ Créer une unité…</option>`;
    selU.value = liste.find((u) => u.toLowerCase() === String(choisie || '').toLowerCase()) || '';
  };
  remplirUnites(fmtSep.unite);
  let uniteAvant = selU.value;
  selU.addEventListener('change', () => {
    const boite = zone.querySelector('#sNouvU');
    if (selU.value === NOUVELLE_UNITE) { boite.hidden = false; zone.querySelector('#sUniteNom').focus(); return; }
    boite.hidden = true; uniteAvant = selU.value;
  });
  zone.querySelector('#sUniteOk').onclick = () => {
    const nom = val('#sUniteNom').replace(/\s+/g, ' ');
    if (!nom) { toast('Entre le nom de l\'unité'); return; }
    const existe = unitesDisponibles().find((u) => u.toLowerCase() === nom.toLowerCase());
    if (!existe) {
      const doute = douteUnite(nom);
      if (doute && !confirm(`« ${nom} » ${doute}.\n\nEst-ce que ça fait vraiment du sens comme unité ?`)) return;
      S.maj((x) => { x.unitesPerso = [...(x.unitesPerso || []), nom]; });
      toast(`Unité « ${nom} » sauvegardée`);
    }
    remplirUnites(existe || nom);
    uniteAvant = selU.value;
    zone.querySelector('#sNouvU').hidden = true;
    zone.querySelector('#sUniteNom').value = '';
    majVar();
  };
  const lireFormat = () => {
    const q = val('#sQte'), u = selU.value === NOUVELLE_UNITE ? uniteAvant : selU.value;
    return q ? `${q} ${u}`.trim() : '';
  };
  const majVar = () => {
    const boite = zone.querySelector('#sVar');
    const ex = !cibleId && val('#sNom') ? trouverArticle(val('#sNom')) : null;
    if (!ex) { boite.innerHTML = ''; return; }
    const reco = P.varianteDeLAchat(ex, { codes: variantes, marque: val('#sMarque'), format: lireFormat() });
    const coche = reco.nouvelle ? 'nouveau' : reco.variante?.id;
    const nouveau = [val('#sMarque'), lireFormat()].filter(Boolean).join(' · ') || 'à préciser dans la fiche';
    boite.innerHTML = `<div class="carte" style="padding:8px;margin:0 0 8px"><b>« ${esc(ex.nom)} » est déjà au catalogue.</b> <span class="doux">Ce code-barres est :</span>
      ${P.variantesActives(ex).map((v) => `<label class="rang" style="margin-top:4px"><input type="radio" name="sVar" value="${v.id}" ${v.id === coche ? 'checked' : ''} style="width:auto">
        <span>${v === P.variantePref(ex) ? '★ ' : ''}${esc(P.libelleVariante(v, ex))}</span></label>`).join('')}
      <label class="rang" style="margin-top:4px"><input type="radio" name="sVar" value="nouveau" ${coche === 'nouveau' ? 'checked' : ''} style="width:auto">
        <span>➕ Une nouvelle marque/format : ${esc(nouveau)}</span></label></div>`;
  };
  const choix = zone.querySelector('#sChoix');
  if (choix) brancherSelecteurProduit(choix, zone.querySelector('#sPanneau'), (nom) => {
    zone.querySelector('#sNom').value = nom;
    choix.textContent = `📚 Fiche choisie : ${nom} ▾`;
    majVar();
  }, { aucun: false });
  ['#sNom', '#sMarque', '#sQte', '#sUnite'].forEach((id) => zone.querySelector(id).addEventListener('change', majVar));
  majVar();
  brancherRayon(zone.querySelector('#sRayon'), zone.querySelector('#sRayonPanneau'), () => rayonId, (id) => { rayonId = id; rayonChoisi = true; });
  const fiche = cibleId ? null : brancherChampsFiche(zone, { p, details, lireFormat, val });
  // La photo prise dans le formulaire est rattachée à la fiche (comme « 📷 Photo du produit » le faisait)
  const joindrePhoto = (articleId) => {
    if (!maPhotoId) return;
    S.maj((x) => { x.photos.push({ id: maPhotoId, type: 'produit', articleId, date: new Date().toISOString(), prise_par: x.utilisateur, note: '' }); });
    // Option B : ta photo, en dernier recours (jamais à la place d'une photo de la marque) ; ignorée si pas connecté
    if (maPhotoBlob && photoMaisonPermise(articleId)) import('./sync.js').then((Sync) => Sync.envoyerPhotoCollee(articleId, maPhotoBlob, '', 'maison'))
      .then((r) => { if (r?.ok) marquerPhotoEnvoyee(articleId, '', 'maison'); }).catch(() => {});
  };
  const sauver = (ajouter) => {
    const nom = zone.querySelector('#sNom').value.trim();
    if (!nom) { toast('Entre un nom'); return; }
    const format = lireFormat();
    const f = analyserFormat(format);
    if (cibleId) { remplirFiche(cibleId, { nom, format, f, marque: zone.querySelector('#sMarque').value.trim(), image, rayonId, rayonChoisi, p, ec, ecp, variantes, details });
      joindrePhoto(cibleId);
      surArticle(S.get().articles.find((x) => x.id === cibleId)); fermerModale(); return; }
    const prixVu = fiche?.lirePrix();
    if (prixVu?.erreur) { toast(prixVu.erreur); return; }
    const existait = !!trouverArticle(nom);
    const choixVar = zone.querySelector('[name="sVar"]:checked')?.value || null;
    const a = assurerArticle(nom, { rayonId, ...(rayonChoisi ? { rayonManuel: true } : {}), format, uniteRef: f?.base || 'unite', marque: zone.querySelector('#sMarque').value.trim(),
      nutriscore: p?.nutriscore_grade?.length === 1 ? p.nutriscore_grade : null, imageUrl: image });
    // Produit déjà au catalogue : le rayon choisi à la main lui est appliqué
    if (rayonChoisi && a.rayonId !== rayonId) S.maj((x) => { const ar = x.articles.find((i) => i.id === a.id); if (ar) { ar.rayonId = rayonId; ar.rayonManuel = true; } });
    const lierLiens = (ar) => {
      if (ecp && !(ar.liens || []).some((l) => l.id === ec.id)) {
        ar.liens = [...(ar.liens || []), { id: ec.id, nom: [ecp.brand, ecp.name].filter(Boolean).join(' '), size: ecp.size, image: ecp.image }];
      }
    };
    // Autre marque/format d'un produit existant (pas sa variante ★) : on range le code dans la bonne variante
    const pref = P.variantePref(S.get().articles.find((i) => i.id === a.id));
    if (choixVar && choixVar !== pref?.id) {
      const marque = zone.querySelector('#sMarque').value.trim();
      S.maj((x) => {
        const ar = x.articles.find((i) => i.id === a.id);
        let v;
        if (choixVar === 'nouveau') v = P.ajouterVariante(ar, { marque, format, codes: variantes });
        else {
          v = ar.variantes.find((i) => i.id === choixVar);
          P.modifierVariante(ar, v.id, { codes: [...(v.codes || []), ...variantes] });
          if (!v.format && format) v.format = format;
          if (!v.marque && marque) v.marque = marque;
        }
        if (image && !v.imageUrl) v.imageUrl = image;
        if (p?.nutriscore_grade?.length === 1 && !v.nutriscore) v.nutriscore = p.nutriscore_grade;
        appliquerDetails(v, details);
        appliquerDetails(ar, details);
        lierLiens(ar);
        fiche?.appliquer(ar, x, !existait, prixVu, v.id);
      });
      if (ecp) actualiserArticle(a.id, { force: true });
      joindrePhoto(a.id);
      if (ajouter) surArticle(a);
      zone.innerHTML = `<div class="alerte vert">✓ ${esc(a.nom)} — ${choixVar === 'nouveau' ? 'nouvelle marque/format ajoutée' : 'code rangé dans sa marque/format'}${ajouter ? '' : ' (sauvegardé, pas ajouté à la liste)'}${enRafale() ? ' — scanne le suivant' : ''}</div>`;
      if (!enRafale()) setTimeout(fermerModale, 900);
      return;
    }
    S.maj((x) => {
      const ar = x.articles.find((i) => i.id === a.id);
      ar.codes = [...new Set([...(ar.codes || []), ...variantes])];
      appliquerDetails(ar, details); // 🍁 Québec, bio, allergènes (Open Food Facts)
      if (image && !ar.imageUrl) ar.imageUrl = image; // photo officielle du produit
      // Fiche existante : on complète seulement ce qui manque
      if (!ar.format && f) { ar.format = format; ar.uniteRef = f.base; }
      const marque = zone.querySelector('#sMarque').value.trim();
      if (!ar.marque && marque) ar.marque = marque;
      if (/kirkland/i.test(`${ar.marque || ''} ${ar.nom}`) && !ar.exclusif) ar.exclusif = 'costco'; // Kirkland = Costco seulement
      lierLiens(ar);
      fiche?.appliquer(ar, x, !existait, prixVu, null);
    });
    if (ecp) actualiserArticle(a.id, { force: true });
    joindrePhoto(a.id);
    if (ajouter) surArticle(a);
    zone.innerHTML = `<div class="alerte vert">✓ ${esc(a.nom)} ${!ajouter ? 'sauvegardé (pas ajouté à la liste)' : libelleOk === 'Ajouter à la liste' ? 'ajouté' : 'enregistré'}${enRafale() ? ' — scanne le suivant' : ''}</div>`;
    if (!enRafale()) setTimeout(fermerModale, 700);
  };
  zone.querySelector('#sOk').onclick = () => sauver(true);
  zone.querySelector('#sSauver')?.addEventListener('click', () => sauver(false));
  // Photo prise sans quitter le formulaire : rien de ce qui est rempli n'est perdu
  zone.querySelector('#sPhoto').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
    input.onchange = async () => {
      const fichier = input.files?.[0]; if (!fichier) return;
      // Sauvegarde bloquée le temps d'enregistrer la photo (sinon elle ne serait pas jointe)
      const boutons = [zone.querySelector('#sOk'), zone.querySelector('#sSauver')].filter(Boolean);
      boutons.forEach((b) => { b.disabled = true; });
      zone.querySelector('#sPhoto').textContent = '📷 Enregistrement de la photo…';
      const blob = await S.compresser(fichier);
      maPhotoId = await S.enregistrerPhoto(blob);
      maPhotoBlob = blob;
      boutons.forEach((b) => { b.disabled = false; });
      zone.querySelector('#sMaPhotoImg').src = URL.createObjectURL(blob);
      zone.querySelector('#sMaPhoto').hidden = false;
      zone.querySelector('#sPhoto').textContent = '📷 Reprendre la photo';
    };
    input.click();
  };

  // Pas de photo dans les bases : on en cherche en ligne et tu choisis la bonne
  if (!image) {
    proposerPhotos(code, nomPropose, zone, (url) => { image = url; });
  }
}

// ---------------------------------------------------------------------
// Maquette lecteur v1 : tous les champs de la fiche dans le formulaire « nouveau produit »
// (comparer au, noms, caractéristiques, local, bannière, remplacement, prix vu).
// Fiche nouvelle : tout est appliqué. Fiche existante : on complète seulement ce qui manque.
// ---------------------------------------------------------------------
function champsFiche({ p, details, fmt, nomPropose }) {
  const e = S.get();
  const f = analyserFormat(fmt);
  const nomEn = p?.product_name_en || '';
  const kirkland = /kirkland/i.test(`${p?.brands || ''} ${nomPropose}`);
  const bans = Object.entries(BANNIERES).filter(([, b]) => !b.enLigneSeulement);
  const mags = (e.magasins || []).filter((m) => m.actif !== false);
  const nutri = p?.nutriscore_grade?.length === 1 ? p.nutriscore_grade.toUpperCase() : '';
  return `
    <h3 class="sous-titre">Comparaison et recherche</h3>
    <div class="rang">
      <div class="champ grandir"><label for="sComp">Comparer au ${src(f ? 'auto' : 'toi')}</label><select id="sComp">
        ${[['kg', '$/kg'], ['l', '$/L'], ['unite', '$/unité']].map(([k, t]) => `<option value="${k}" ${(f?.base || 'unite') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="champ grandir"><label for="sLocal">Local 🍁 ${src(details.quebec ? 'code' : 'auto')}</label><select id="sLocal"><option value="1" ${details.quebec ? 'selected' : ''}>Oui</option><option value="0" ${details.quebec ? '' : 'selected'}>Non</option></select></div>
    </div>
    <div class="rang">
      <div class="champ grandir"><label for="sNomEn">Nom anglais ${src(nomEn ? 'code' : 'toi')}</label><input id="sNomEn" value="${esc(nomEn)}" placeholder="ex. milk" lang="en"></div>
      <div class="champ grandir"><label for="sAlias">Nom alternatif ${src('toi')}</label><input id="sAlias" placeholder="ex. lait 2 %"></div>
    </div>
    ${details.bio ? '<div class="alerte vert" id="sBio">🌱 Produit biologique : le bio est un produit à part (jamais comparé au non bio). <button type="button" class="btn sec" id="sBioNom" style="padding:4px 9px;margin-top:6px">Nommer « … biologique »</button></div>' : ''}
    <h3 class="sous-titre">Caractéristiques</h3>
    <div id="sCarac" class="carac"></div>
    <details id="sCaracAjouter"><summary class="btn sec" style="display:inline-block">+ Ajouter une caractéristique</summary><div id="sCaracCorps" style="margin-top:8px"></div></details>
    ${details.allergenes.length || nutri ? `<p class="doux" style="margin:6px 0 0">Lu aussi avec le code : ${[details.allergenes.length && `allergènes ${details.allergenes.join(', ')}`, nutri && `Nutri-Score ${nutri}`].filter(Boolean).map(esc).join(' · ')}.</p>` : ''}
    <h3 class="sous-titre">Pour toi</h3>
    <div class="rang">
      <div class="champ grandir"><label for="sExclusif">Vendu seulement chez ${kirkland ? src('auto') : ''}</label><select id="sExclusif"><option value="">— Toutes les bannières —</option>
        ${bans.map(([k, b]) => `<option value="${k}" ${kirkland && k === 'costco' ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select></div>
      <div class="champ grandir"><label for="sRempl">Remplacement accepté <span class="pastille">pour toi seulement</span></label><select id="sRempl">
        ${REMPLACEMENTS.map((x) => `<option value="${x.k}" ${x.k === REMPLACEMENT_DEFAUT ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></div>
    </div>
    <details id="sPrixVu" class="carte" style="margin:10px 0 0;padding:8px 10px"><summary><b>💲 Prix vu</b> <span class="doux">(tu es au magasin ?)</span></summary>
      <div class="rang" style="margin-top:8px"><div class="champ grandir"><label for="sPBan">Magasin</label><select id="sPBan">${mags.map((m) => `<option value="${esc(m.banniere)}" data-mag="${esc(m.id)}">${esc(m.nom)}</option>`).join('')}</select></div>
        <div class="champ grandir"><label for="sPOffre">Prix affiché</label><input id="sPOffre" placeholder="4,99 $ · 2/5 $"></div></div>
      <div class="rang"><div class="champ grandir"><label for="sPType">Type</label><select id="sPType"><option value="regulier">Prix régulier</option><option value="circulaire">Circulaire / rabais</option></select></div>
        <div class="champ grandir"><label for="sPFin">Fin du rabais</label><input id="sPFin" type="date"></div></div>
    </details>`;
}

function brancherChampsFiche(zone, { p, details, lireFormat, val }) {
  const q = (id) => zone.querySelector(id);
  const caracs = new Map(caracteristiquesDuCode(p, details.quebec));
  let compTouche = false;
  q('#sComp').addEventListener('change', () => { compTouche = true; });
  // « Comparer au » suit le format tant que tu n'y as pas touché
  const suivreFormat = () => { if (compTouche) return; const f = analyserFormat(lireFormat()); if (f) q('#sComp').value = f.base; };
  ['#sQte', '#sUnite'].forEach((id) => q(id).addEventListener('change', suivreFormat));
  q('#sBioNom')?.addEventListener('click', () => {
    const n = q('#sNom'); if (n.value.trim() && !/biologique/i.test(n.value)) n.value = `${n.value.trim()} biologique`;
    n.dispatchEvent(new Event('change'));
  });
  const rendre = (nouvel = '') => {
    q('#sCarac').innerHTML = caracs.size ? [...caracs].map(([k, v]) => { const d = attributDe(k);
      return `<div class="carac-rang"><span class="doux">${esc(d.nom)}</span><select data-scarac="${k}" aria-label="${esc(d.nom)}">${d.vals.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <button type="button" class="icone" data-scarac-retirer="${k}" aria-label="Retirer ${esc(d.nom)}">✕</button></div>`; }).join('')
      : '<p class="doux" style="margin:2px 0">Aucune lue avec le code. Ce n’est pas un problème : ajoute seulement ce qui distingue le produit.</p>';
    const libres = DICO_ATTRIBUTS.filter((d) => !caracs.has(d.k)), nouv = attributDe(nouvel);
    q('#sCaracAjouter').hidden = !libres.length;
    q('#sCaracCorps').innerHTML = `<div class="rang envelopper"><select id="sCaracAjout" aria-label="Ajouter une caractéristique"><option value="">Choisir…</option>${libres.map((d) => `<option value="${d.k}" ${d.k === nouvel ? 'selected' : ''}>${esc(d.nom)}</option>`).join('')}</select>
      ${nouv ? `<select id="sCaracValeur" aria-label="Valeur de ${esc(nouv.nom)}"><option value="">Choisir la valeur…</option>${nouv.vals.map((x) => `<option>${esc(x)}</option>`).join('')}</select>` : ''}</div>`;
  };
  rendre();
  // Écouteurs sur les éléments du formulaire (recréés à chaque scan), jamais sur `zone` (réutilisée en rafale)
  q('#sCarac').addEventListener('change', (ev) => { const t = ev.target; if (t.dataset.scarac) caracs.set(t.dataset.scarac, t.value); });
  q('#sCarac').addEventListener('click', (ev) => { const b = ev.target.closest('[data-scarac-retirer]'); if (b) { caracs.delete(b.dataset.scaracRetirer); rendre(); } });
  q('#sCaracCorps').addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'sCaracAjout') rendre(t.value);
    else if (t.id === 'sCaracValeur' && t.value) { caracs.set(q('#sCaracAjout').value, t.value); rendre(); }
  });
  return {
    /** Prix vu : null si rien tapé ; { erreur } si illisible. */
    lirePrix() {
      const offre = val('#sPOffre');
      if (!offre) return null;
      if (!analyserOffre(offre)) return { erreur: 'Prix vu illisible : ex. 4,99 $, 2/5 $ ou 1,99 $/lb' };
      const opt = q('#sPBan').selectedOptions[0];
      return { offre, banniere: q('#sPBan').value, magasinId: opt?.dataset.mag, type: q('#sPType').value, fin: q('#sPFin').value || null };
    },
    /** Applique les champs à la fiche (appelé dans S.maj). neuve = fiche créée par ce scan. */
    appliquer(ar, x, neuve, prixVu, varianteId) {
      if (neuve) ar.uniteRef = q('#sComp').value;
      if (q('#sLocal').value === '1') ar.local = true; else if (neuve) ar.local = false;
      const nomEn = val('#sNomEn'); if (nomEn && (neuve || !ar.nomEn)) ar.nomEn = nomEn;
      const alias = val('#sAlias'); if (alias) ar.nomsAlt = ajouterNomsAlt(ar.nomsAlt, alias, ar.nom);
      for (const [k, v] of caracs) if (neuve || !ar.caracteristiques?.[k]) definirCaracteristique(ar, k, v);
      const excl = q('#sExclusif').value; if (excl && (neuve || !ar.exclusif)) ar.exclusif = excl;
      const rempl = q('#sRempl').value; if (neuve || rempl !== REMPLACEMENT_DEFAUT) definirRemplacement(ar, x.utilisateur, rempl);
      if (prixVu) x.prix.push({ id: S.uid('p'), articleId: ar.id, ...(varianteId ? { varianteId } : {}), banniere: prixVu.banniere, magasinId: prixVu.magasinId,
        offre: prixVu.offre, format: lireFormat() || ar.format, type: prixVu.type, fin: prixVu.fin, source: 'manuel', observeLe: new Date().toISOString().slice(0, 10) });
    },
  };
}

/**
 * Cherche des photos pour un produit sans image :
 *  ① base de codes-barres UPCitemdb (via la fonction Supabase ; nom et marque utiles, photos parfois fausses)
 *  ② recherche par nom chez les bannières (épiceries.ca)
 * Rien n'est choisi automatiquement : tu touches la photo qui correspond.
 */
async function proposerPhotos(code, nomPropose, zone, choisir) {
  const boite = zone.querySelector('#sPhotos');
  if (!boite) return;
  if (!navigator.onLine) { boite.querySelector('p').textContent = '📵 Pas de réseau : prends une photo du produit (📷).'; return; }
  const candidats = [];
  const Sync = await import('./sync.js');
  const upc = code ? await Sync.chercherCode(code) : null;
  if (upc) {
    // Le nom de la base de codes aide quand Open Food Facts ne connaissait pas le produit
    const champNom = zone.querySelector('#sNom'), champMarque = zone.querySelector('#sMarque');
    if (champNom && !champNom.value && upc.titre) champNom.value = upc.titre;
    if (champMarque && !champMarque.value && upc.marque) champMarque.value = upc.marque;
    upc.images.forEach((u) => candidats.push({ url: u.replace(/^http:/, 'https:'), source: 'Base de codes-barres' }));
  }
  const nom = zone.querySelector('#sNom')?.value || nomPropose || upc?.titre;
  if (nom) {
    try {
      const { rechercherSouple } = await import('./epiceries.js');
      const vues = new Set(candidats.map((c) => c.url));
      (await rechercherSouple(nom)).filter((r) => r.image && !vues.has(r.image) && vues.add(r.image)).slice(0, 6)
        .forEach((r) => candidats.push({ url: r.image, source: [r.brand, r.name].filter(Boolean).join(' ') }));
    } catch { /* recherche indisponible */ }
  }
  // Relancer avec le nom tapé (utile si le nom était vide ou mal deviné)
  const relancer = '<button class="btn sec" id="sRelance">🔎 Chercher des photos avec ce nom</button>';
  const brancherRelance = () => {
    const b = boite.querySelector('#sRelance');
    if (b) b.onclick = (ev) => {
      ev.preventDefault();
      boite.innerHTML = '<label>Photo du produit</label><p class="doux">Recherche de photos en ligne…</p>';
      choisir('');
      proposerPhotos(null, '', zone, choisir);
    };
  };
  if (!candidats.length) {
    boite.innerHTML = `<label>Photo du produit</label><p class="doux">Aucune photo trouvée en ligne. Corrige le nom puis relance, ou prends-en une avec 📷.</p>${relancer}`;
    brancherRelance();
    return;
  }
  boite.innerHTML = `<label>Photo du produit — touche celle qui correspond</label>
    <div class="grille-photos">${candidats.map((c, i) => `<button class="choix-photo" data-i="${i}" title="${esc(c.source)}">
      <img src="${esc(c.url)}" alt="" loading="lazy" onerror="this.closest('button').remove()"><span class="une-ligne">${esc(c.source)}</span></button>`).join('')}</div>
    <p class="doux">Vérifie bien : les photos trouvées en ligne ne sont pas toujours le bon produit. Sans choix, aucune photo n'est ajoutée.</p>${relancer}`;
  brancherRelance();
  boite.querySelectorAll('[data-i]').forEach((b) => b.onclick = (ev) => {
    ev.preventDefault();
    boite.querySelectorAll('[data-i]').forEach((x) => x.classList.toggle('actif', x === b));
    choisir(candidats[Number(b.dataset.i)].url);
  });
}

/** Remplit un article existant avec tout ce que le code-barres a permis de trouver. */
function remplirFiche(id, { nom, format, f, marque, image, rayonId, rayonChoisi, p, ec, ecp, variantes, details }) {
  S.maj((x) => {
    const ar = x.articles.find((i) => i.id === id);
    if (!ar) return;
    ar.nom = nom;
    if (marque) ar.marque = marque;
    if (format) { ar.format = format; if (f) ar.uniteRef = f.base; }
    if (image) ar.imageUrl = image; // la photo officielle remplace l'ancienne
    if (p?.nutriscore_grade?.length === 1) ar.nutriscore = p.nutriscore_grade;
    if (details) appliquerDetails(ar, details);
    if (rayonChoisi) { ar.rayonId = rayonId; ar.rayonManuel = true; }        // choisi dans le formulaire
    else if (!ar.rayonManuel && p) ar.rayonId = rayonId; // une catégorie choisie à la main n'est jamais changée
    ar.codes = [...new Set([...(ar.codes || []), ...variantes])];
    if (/kirkland/i.test(`${marque || ''} ${nom}`) && !ar.exclusif) ar.exclusif = 'costco';
    if (ecp && !(ar.liens || []).some((l) => l.id === ec.id)) {
      ar.liens = [...(ar.liens || []), { id: ec.id, nom: [ecp.brand, ecp.name].filter(Boolean).join(' '), size: ecp.size, image: ecp.image }];
    }
  });
  if (ecp) actualiserArticle(id, { force: true });
  toast(`Fiche remplie : ${nom}${ecp ? ' — prix en cours de récupération' : ''}`);
}

function normaliserQuantite(q) {
  // « 54000g » → « 54 kg », « 2 x 1.5L » → « 2 × 1,5 L (3 L) » ; garde tel quel si non reconnu
  const s = String(q);
  const multi = s.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl|lb|oz)\b/i);
  if (multi) return formatLisible(`${multi[1]} x ${multi[2]} ${multi[3]}`);
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl|lb|oz)\b/i);
  return m ? formatLisible(`${m[1]} ${m[2]}`) : s;
}

function devinerRayon(tags) {
  const e = S.get();
  const t = tags.join(' ');
  const regles = [
    [/dairies|cheeses|yogurts|milks|butters|eggs/, 'Produits laitiers'],
    [/beverages|waters|sodas|juices/, 'Boissons'],
    [/meats|poultry|fishes|seafood/, 'Viandes'],
    [/fruits|vegetables/, 'Fruits et légumes'],
    [/breads|bakery/, 'Boulangerie'],
    [/breakfast|cereals|coffees|teas/, 'Céréales'],
    [/biscuits|snacks|chips|chocolates|candies/, 'Collations'],
    [/frozen/, 'Surgelés'],
    [/pastas|rices|canned|sauces|condiments|groceries/, 'Épicerie'],
  ];
  for (const [re, debut] of regles) {
    if (re.test(t)) { const r = e.rayons.find((x) => x.nom.startsWith(debut)); if (r) return r.id; }
  }
  return rayonParDefaut();
}

// ---------------------------------------------------------------------
// Photo d'un produit (nouvelle fiche, ou photo + prix pour un article existant)
// ---------------------------------------------------------------------
export function photoProduit(articleId = null, code = null) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    const blob = await S.compresser(f);
    const photoId = await S.enregistrerPhoto(blob);
    const url = URL.createObjectURL(blob);
    const e = S.get();
    const art = articleId ? e.articles.find((a) => a.id === articleId) : null;
    ouvrirModale(art ? `Photo — ${art.nom}` : 'Nouveau produit (photo)', `
      <img src="${url}" alt="" style="width:100%;border-radius:10px;max-height:40vh;object-fit:contain;background:#000">
      ${art ? '' : `<p class="doux">L'identification automatique (lecture de la marque, du nom et du format, puis 3 suggestions) arrivera avec l'agent lecteur-photos, quand la base partagée sera branchée. En attendant, tape le nom : la photo reste attachée au produit.</p>
      <div class="champ"><label>Nom</label><input id="pNom" list="pCat"></div>
      <datalist id="pCat">${e.articles.map((a) => `<option value="${esc(a.nom)}">`).join('')}</datalist>
      <div class="champ"><label>Format</label><input id="pFormat" placeholder="454 g"></div>`}
      <div class="rang"><div class="champ grandir"><label>Prix vu (facultatif)</label><input id="pPrix" placeholder="4,99 $ ou 2/5 $ ou 1,99 $/lb"></div>
        <div class="champ grandir"><label>Magasin</label><select id="pMag"><option value="">—</option>${e.magasins.map((m) => `<option value="${m.id}">${esc(m.nom)}</option>`).join('')}</select></div></div>
      <button class="btn" id="pOk">Enregistrer</button>`, (c) => {
      $('#pOk', c).onclick = () => {
        let a = art;
        if (!a) {
          const nom = $('#pNom', c).value.trim(); if (!nom) { toast('Entre un nom'); return; }
          const format = $('#pFormat', c).value.trim();
          a = assurerArticle(nom, { format, uniteRef: analyserFormat(format)?.base || 'unite' });
          ajouterALaListe(a.id);
        }
        const prixTxt = $('#pPrix', c).value.trim();
        const mag = e.magasins.find((m) => m.id === $('#pMag', c).value);
        if (prixTxt && !analyserOffre(prixTxt)) { toast('Prix illisible : ex. 4,99 $ ou 2/5 $'); return; }
        S.maj((x) => {
          x.photos.push({ id: photoId, type: 'produit', articleId: a.id, date: new Date().toISOString(), prise_par: x.utilisateur, note: prixTxt });
          if (code) { const ar = x.articles.find((i) => i.id === a.id); ar.codes = [...new Set([...(ar.codes || []), code])]; }
          if (prixTxt && mag) x.prix.push({ articleId: a.id, banniere: mag.banniere, magasinNom: undefined, offre: prixTxt,
            format: a.format, type: 'regulier', fin: null, source: 'photo', observeLe: aujourdhui(), photoId });
        });
        fermerModale(); toast('Photo enregistrée');
      };
    });
  };
  input.click();
}
