// =====================================================================
// Lecteur de code-barres + secours par photo
// Cascade : ① catalogue local → ② Open Food Facts → ③ saisie / photo.
// (③ épiceries.ca, sites des bannières et recherche web : ajoutés par les
//  agents quand la base partagée sera branchée.)
// =====================================================================
import * as S from './store.js';
import { $, esc, ouvrirModale, fermerModale, quandFermee, toast, aujourdhui } from './ui.js';
import { analyserFormat, analyserOffre } from './normalise.js';
import { assurerArticle, ajouterALaListe, rayonParDefaut } from './app.js';

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
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => formats.includes(f)) });
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

/** Ouvre le lecteur. surArticle(article) est appelé pour chaque produit reconnu et confirmé. */
export function ouvrirScan(surArticle) {
  ouvrirModale('Code-barres', `
    <video class="scan" id="video" playsinline muted></video>
    <p class="doux" id="etatScan">Démarrage de la caméra…</p>
    <label class="rang doux"><input type="checkbox" id="rafale" style="width:auto"> Mode rafale (scanner plusieurs produits d'affilée)</label>
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
      rechercher(code, $('#resultat', c), surArticle, () => $('#rafale', c).checked);
    };
    $('#okCode', c).onclick = () => traiter($('#codeManuel', c).value);
    quandFermee(() => { arret?.(); arret = null; });
    try {
      arret = await demarrerCamera($('#video', c), traiter);
      etat.textContent = 'Vise le code-barres.';
    } catch (err) {
      etat.textContent = 'Caméra indisponible (permission refusée ou navigateur non compatible). Tape le code ou prends une photo.';
    }
  });
}

async function rechercher(code, zone, surArticle, enRafale) {
  const e = S.get();
  // ① catalogue
  const local = e.articles.find((a) => a.codes?.includes(code));
  if (local) {
    surArticle(local);
    zone.innerHTML = `<div class="alerte vert">✓ ${esc(local.nom)} (déjà au catalogue)</div>`;
    return;
  }
  zone.innerHTML = `<p class="doux">Recherche du produit ${esc(code)}…</p>`;
  // ② Open Food Facts
  let p = null;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name_fr,product_name,brands,quantity,categories_tags,nutriscore_grade`);
    const j = await r.json();
    if (j.status === 1 && j.product) p = j.product;
  } catch { /* hors ligne */ }

  const nomPropose = p ? (p.product_name_fr || p.product_name || '') : '';
  const fmt = p?.quantity ? normaliserQuantite(p.quantity) : '';
  const rayonId = p ? devinerRayon(p.categories_tags || []) : rayonParDefaut();
  zone.innerHTML = `
    ${p ? `<div class="alerte vert">Trouvé sur Open Food Facts${p.nutriscore_grade && p.nutriscore_grade.length === 1 ? ` · Nutri-Score ${esc(p.nutriscore_grade.toUpperCase())}` : ''}</div>`
        : `<div class="alerte ambre">Produit inconnu (code ${esc(code)}). Tape le nom ou prends une photo.</div>`}
    <div class="champ"><label>Nom (en français, à ta façon)</label><input id="sNom" value="${esc(nomPropose)}" list="sCat"></div>
    <datalist id="sCat">${e.articles.map((a) => `<option value="${esc(a.nom)}">`).join('')}</datalist>
    <div class="rang"><div class="champ grandir"><label>Marque</label><input id="sMarque" value="${esc(p?.brands?.split(',')[0] || '')}"></div>
      <div class="champ grandir"><label>Format</label><input id="sFormat" value="${esc(fmt)}" placeholder="454 g"></div></div>
    <p class="doux">Si le nom correspond à un article de ton catalogue, le code y sera simplement rattaché.</p>
    <div class="rang envelopper"><button class="btn" id="sOk">Ajouter à la liste</button>
      <button class="btn sec" id="sPhoto">📷 Photo du produit</button></div>`;
  zone.querySelector('#sOk').onclick = () => {
    const nom = zone.querySelector('#sNom').value.trim();
    if (!nom) { toast('Entre un nom'); return; }
    const format = zone.querySelector('#sFormat').value.trim();
    const f = analyserFormat(format);
    const a = assurerArticle(nom, { rayonId, format, uniteRef: f?.base || 'unite', marque: zone.querySelector('#sMarque').value.trim(),
      nutriscore: p?.nutriscore_grade?.length === 1 ? p.nutriscore_grade : null });
    S.maj((x) => { const ar = x.articles.find((i) => i.id === a.id); ar.codes = [...new Set([...(ar.codes || []), code])]; });
    surArticle(a);
    zone.innerHTML = `<div class="alerte vert">✓ ${esc(a.nom)} ajouté${enRafale() ? ' — scanne le suivant' : ''}</div>`;
    if (!enRafale()) setTimeout(fermerModale, 700);
  };
  zone.querySelector('#sPhoto').onclick = () => { fermerModale(); photoProduit(null, code); };
}

function normaliserQuantite(q) {
  // « 454g » → « 454 g » ; garde tel quel si non reconnu
  const m = String(q).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl|lb|oz)\b/i);
  return m ? `${m[1]} ${m[2].replace(/^l$/i, 'L').replace(/^ml$/i, 'mL')}` : String(q);
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
