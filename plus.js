// =====================================================================
// Onglet PLUS : cartes fidélité, points, rabais perso, catalogue, photos,
// sauvegarde.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, toast, joursRestants, aujourdhui } from './ui.js';
import { PROGRAMMES } from './demo-data.js';
import { prendrePhoto, lireTexte, analyserRecu } from './ocr.js';

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
  const e = S.get();
  const menu = [
    ['recus', '🧾', 'Mes reçus', `${(e.recus || []).length} reçu(s) · prends-les en photo après l'épicerie`],
    ['cartes', '💳', 'Cartes fidélité & points', `${e.cartes.length} carte(s)`],
    ['rabais', '🏷️', 'Mes rabais personnels', `${e.rabaisPerso.filter((r) => r.actif).length} actif(s)`],
    ['catalogue', '📚', 'Catalogue de mes articles', `${e.articles.length} articles`],
    ['photos', '🖼️', 'Photos', `${e.photos.length} photo(s)`],
    ['sauvegarde', '💾', 'Sauvegarde et mode démo', 'Exporter, importer, réinitialiser'],
  ];
  v.innerHTML = menu.map(([k, ic, t, s]) => `<button class="carte rang" data-s="${k}" style="width:100%;text-align:left;font:inherit;color:inherit">
    <span style="font-size:24px">${ic}</span><span class="grandir"><b>${t}</b><div class="doux">${s}</div></span><span>›</span></button>`).join('')
    + `<p class="doux">À venir : vérification automatique de chaque ligne de reçu contre les prix attendus, économies par bannière/semaine/mois, cycles de rabais, rappels de produits.</p>`;
  $$('[data-s]', v).forEach((b) => b.onclick = () => { section = b.dataset.s; vuePlus(v); });
}

const retour = () => `<button class="btn sec" id="retour" style="margin-bottom:10px">‹ Retour</button>`;
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

// --- Catalogue --------------------------------------------------------
function vueCatalogue(v) {
  const e = S.get();
  const parRayon = e.rayons.map((r) => ({ r, arts: e.articles.filter((a) => a.rayonId === r.id).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')) }))
    .filter((x) => x.arts.length);
  v.innerHTML = retour() + `<p class="doux">Touche un article pour modifier son nom, son rayon, son unité de comparaison ou son format.</p>`
    + parRayon.map(({ r, arts }) => `<section class="rayon"><h3>${esc(r.nom)}</h3>${arts.map((a) =>
      `<div class="item" data-a="${a.id}" style="cursor:pointer"><div class="grandir"><div class="nom">${esc(a.nom)} ${a.local ? '🍁' : ''}</div>
       <div class="info">${esc(a.format || 'format ?')} · comparé au ${a.uniteRef === 'unite' ? 'prix unitaire' : a.uniteRef}${a.codes?.length ? ' · ▥' : ''}</div></div></div>`).join('')}</section>`).join('');
  brancherRetour(v);
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

// --- Reçus ------------------------------------------------------------
/** Prend un reçu en photo, le lit (sur le téléphone) et l'enregistre. Exporté pour le bouton de la liste. */
export async function nouveauRecu() {
  const blob = await prendrePhoto();
  if (!blob) return;
  const photoId = await S.enregistrerPhoto(blob);
  const id = S.uid('rc');
  S.maj((x) => {
    (x.recus ||= []).unshift({ id, photoId, cree: new Date().toISOString(), statut: 'lecture', par: x.utilisateur });
    x.photos.push({ id: photoId, type: 'recu', articleId: null, date: new Date().toISOString(), prise_par: x.utilisateur, note: 'Reçu' });
  });
  toast('Reçu enregistré — lecture en cours…');
  try {
    const texte = await lireTexte(blob, () => {});
    const r = analyserRecu(texte);
    S.maj((x) => { const rc = x.recus.find((y) => y.id === id); Object.assign(rc, r, { texte, statut: 'lu' }); });
    toast(`Reçu lu${r.total ? ` : total ${argent(r.total)}` : ''} — vérifie-le dans Plus → Mes reçus`);
  } catch {
    S.maj((x) => { const rc = x.recus.find((y) => y.id === id); rc.statut = 'à lire'; });
    toast('Reçu gardé ; la lecture n\'a pas pu se faire (hors ligne ?)');
  }
}

function vueRecus(v) {
  const e = S.get();
  const recus = e.recus || [];
  v.innerHTML = retour() + `<button class="btn" id="nouvRecu" style="width:100%;margin-bottom:10px">📷 Photographier un reçu</button>
    <p class="doux">Le reçu est lu sur ton téléphone (magasin, date, total, lignes). La lecture peut se tromper : touche un reçu pour voir la photo et le détail. Prochaine étape : comparer chaque ligne aux prix attendus et à ta liste.</p>`
    + (recus.length ? recus.map((r) => `<div class="carte" data-recu="${r.id}" style="cursor:pointer"><div class="rang">
        <b class="grandir">${r.banniere ? esc(PROGRAMMES_NOMS[r.banniere] || r.banniere) : 'Magasin ?'} · ${esc(r.date || r.cree.slice(0, 10))}</b><b>${r.total != null ? argent(r.total) : ''}</b></div>
        <div class="doux">${r.statut === 'lecture' ? 'Lecture en cours…' : r.statut === 'à lire' ? 'Pas encore lu' : `${(r.lignes || []).length} ligne(s) lue(s)`} · par ${esc(r.par || '')}</div></div>`).join('')
      : '<div class="vide">Aucun reçu. Après l\'épicerie, prends ton reçu en photo.</div>');
  brancherRetour(v);
  $('#nouvRecu', v).onclick = nouveauRecu;
  $$('[data-recu]', v).forEach((el) => el.onclick = () => {
    const r = recus.find((x) => x.id === el.dataset.recu);
    ouvrirModale('Reçu', `<div id="rcPhoto" class="vignettes" style="grid-template-columns:1fr"></div>
      <table class="comp">${(r.lignes || []).map((l) => `<tr><td>${esc(l.libelle)}</td><td class="pu">${argent(l.prix)}</td></tr>`).join('') || '<tr><td class="doux">Aucune ligne reconnue.</td></tr>'}
      ${r.total != null ? `<tr><td><b>Total</b></td><td class="pu">${argent(r.total)}</td></tr>` : ''}</table>
      <details style="margin-top:8px"><summary class="doux">Texte lu</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(r.texte || '')}</pre></details>
      <button class="btn danger" id="supRecu" style="margin-top:10px">Supprimer ce reçu</button>`, (c) => {
      afficherPhoto({ id: r.photoId, type: 'recu', note: 'Touche pour partager' }, $('#rcPhoto', c), true);
      $('#supRecu', c).onclick = () => { if (confirm('Supprimer ce reçu ?')) { S.maj((x) => { x.recus = x.recus.filter((y) => y.id !== r.id); }); fermerModale(); } };
    });
  });
}

const PROGRAMMES_NOMS = { iga: 'IGA', super_c: 'Super C', metro: 'Metro', maxi: 'Maxi', costco: 'Costco', jean_coutu: 'Jean Coutu' };

// --- Sauvegarde -------------------------------------------------------
function vueSauvegarde(v) {
  v.innerHTML = retour() + `<div class="carte"><h2>Exporter / importer</h2>
      <p class="doux">Copie de sécurité de tes données (sans les photos). Elle contient tes numéros de carte : garde-la en lieu sûr.</p>
      <div class="rang envelopper"><button class="btn" id="exp">Exporter</button><button class="btn sec" id="imp">Importer</button></div></div>
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
  $('#reinit', v).onclick = () => { if (confirm('Effacer tes données de démo sur ce téléphone et remettre les exemples ?')) { S.reinitialiser(); toast('Démo réinitialisée'); } };
}
