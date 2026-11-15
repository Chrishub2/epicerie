// =====================================================================
// Recettes → liste d'épicerie
// Photo des ingrédients (lue sur le téléphone) → nom, photo du plat, livre →
// liste à cocher → ajout. Recettes regroupées par livre.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, meilleureOffre, toast } from './ui.js';
import { prendrePhoto, lireTexte } from './ocr.js';
import { trouverArticle, assurerArticle, ajouterALaListe, sansAccents } from './app.js';
import { afficherPhoto } from './plus.js';

const GARDE_MANGER = ['sel', 'poivre', 'eau', 'huile', "huile d'olive", 'sucre', 'farine', 'bicarbonate', 'poudre a pate', 'epices'];
const UNITES = '(?:tasses?|t\\.|c\\.\\s?à\\s?(?:soupe|s\\.|thé|t\\.)|c\\.à\\.s\\.?|c\\.à\\.t\\.?|cuill(?:è|e)res?\\s+à\\s+(?:soupe|thé|café)|ml|l|cl|g|kg|lb|oz|gousses?|boîtes?|conserves?|pincées?|tranches?|paquets?|bottes?|feuilles?)';
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/** « 2 c. à soupe d'huile d'olive » → { quantite: 2, unite: 'c. à soupe', nom: "huile d'olive" } */
export function analyserIngredient(ligne) {
  let s = ligne.replace(/^\s*\d+[.)]\s+/, '') // numérotation « 1. » ou « 1) »
    .replace(/^[\s•\-*–·]+/, '').trim();
  if (!s) return null;
  for (const [f, v] of Object.entries(FRACTIONS)) s = s.replace(f, ` ${v}`);
  s = s.trim();
  // L'unité doit être un mot complet (« g » ne doit pas avaler « gousses »).
  const re = new RegExp(`^(\\d+(?:[.,]\\d+)?(?:\\s+\\d/\\d)?|\\d/\\d)?\\s*${'(' + UNITES + '(?![a-zà-ÿ]))?'}\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i');
  const m = s.match(re);
  let q = null;
  if (m?.[1]) {
    const parts = m[1].trim().split(/\s+/);
    q = parts.reduce((t, p) => t + (p.includes('/') ? Number(p.split('/')[0]) / Number(p.split('/')[1]) : Number(p.replace(',', '.'))), 0);
  }
  const nom = (m?.[3] || s).replace(/\(.*?\)/g, '').split(',')[0].trim();
  return { quantite: q, unite: m?.[2]?.trim() || '', nom, brut: ligne.trim() };
}

function correspondance(nom) {
  const direct = trouverArticle(nom);
  if (direct) return direct;
  const n = sansAccents(nom);
  return S.get().articles.find((a) => {
    const an = sansAccents(a.nom);
    return n.includes(an) || an.split(' ').every((w) => w.length > 2 && n.includes(w.replace(/s$/, '')));
  }) || null;
}

function coutRecette(r) {
  const e = S.get();
  return r.ingredients.reduce((t, i) => {
    const a = e.articles.find((x) => x.id === i.articleId);
    const o = a && meilleureOffre(a);
    return t + (o?.prixArticle || 0);
  }, 0);
}

/** Recettes regroupées par livre (« Sans livre » à la fin). */
export function vueRecettes(v) {
  const e = S.get();
  const livres = e.livres || [];
  let html = `<button class="btn" id="nouvRecette" style="width:100%;margin-bottom:12px">📷 Nouvelle recette</button>`;
  if (!e.recettes.length) html += `<div class="vide">Aucune recette. Photographie la liste d'ingrédients d'une recette : je la lis, puis tu choisis quoi acheter.</div>`;
  const groupes = [...livres.map((l) => ({ livre: l, recettes: e.recettes.filter((r) => r.livreId === l.id) })),
    { livre: null, recettes: e.recettes.filter((r) => !r.livreId || !livres.some((l) => l.id === r.livreId)) }]
    .filter((g) => g.recettes.length);
  for (const g of groupes) {
    html += `<details class="groupe-livre" open><summary><span class="grandir">📖 ${esc(g.livre ? g.livre.nom : 'Sans livre')}</span><span class="doux">${g.recettes.length} recette(s)</span></summary>
      ${g.recettes.map((r) => `<div class="item recette" data-r="${r.id}">
        ${r.photoPlatId || r.photoId ? `<div class="vignettes vig-recette" data-ph="${r.photoPlatId || r.photoId}"></div>` : '<span class="vignette" style="display:grid;place-items:center">🍲</span>'}
        <div class="grandir"><div class="nom">${esc(r.titre)}</div>
          <div class="info">${r.ingredients.length} ingrédients · ~${argent(coutRecette(r))}</div></div>
        <button class="btn" data-ajout style="padding:6px 10px">+ Liste</button>
        <button class="icone" data-edit aria-label="Modifier">✎</button></div>`).join('')}</details>`;
  }
  v.innerHTML = html;
  $('#nouvRecette').onclick = () => editeur();
  $$('[data-ph]', v).forEach((el) => afficherPhoto({ id: el.dataset.ph, type: 'recette', note: '' }, el));
  $$('[data-r]', v).forEach((el) => {
    const r = e.recettes.find((x) => x.id === el.dataset.r);
    el.querySelector('[data-ajout]').onclick = () => choisir(r);
    el.querySelector('[data-edit]').onclick = () => editeur(r);
  });
}

/** Lit une photo et rend le texte (ou null hors ligne / échec). */
async function lirePhotoTexte(blob, zone) {
  if (!navigator.onLine) { zone.textContent = '📵 Pas de réseau : la photo est gardée, tu pourras la faire lire plus tard (✎ sur la recette).'; return null; }
  try { return await lireTexte(blob, (m) => { zone.textContent = m; }); } catch { zone.textContent = 'Lecture impossible ; tu peux taper le texte.'; return null; }
}

/**
 * Créer ou modifier une recette :
 * ① photo des ingrédients (lue automatiquement) ② nom (modifiable) ③ photo du plat (facultatif)
 * ④ livre (au choix, ou photo de la couverture) ⑤ choix des ingrédients à acheter.
 */
function editeur(existante = null) {
  const e = S.get();
  const livres = e.livres || [];
  const r = existante ? { ...existante } : { id: S.uid('rc'), titre: '', ingredients: [], creeLe: new Date().toISOString() };
  ouvrirModale(existante ? 'Modifier la recette' : 'Nouvelle recette', `
    <div class="etape"><b>1. Ingrédients</b>
      <button class="btn" id="rPhotoIngr" style="width:100%;margin:6px 0">📷 Photographier la liste d'ingrédients</button>
      <div class="doux" id="rEtat"></div>
      <textarea id="rIng" placeholder="Ou tape-les : 500 g de bœuf haché&#10;1 oignon, haché&#10;2 boîtes de tomates en dés">${esc(r.texteIngredients || r.ingredients.map((i) => i.brut).join('\n'))}</textarea></div>
    <div class="etape"><b>2. Nom de la recette</b>
      <input id="rTitre" value="${esc(r.titre)}" placeholder="Lu sur la photo, ou tape-le"></div>
    <div class="etape"><b>3. Photo du plat</b> <span class="doux">(facultatif)</span>
      <div class="rang" style="margin-top:6px"><button class="btn sec" id="rPhotoPlat">🍽️ Photo du plat</button><span class="doux" id="rPlatEtat">${r.photoPlatId ? '✓ photo gardée' : ''}</span></div></div>
    <div class="etape"><b>4. Livre</b> <span class="doux">(s'il y a lieu)</span>
      <select id="rLivre" style="margin-top:6px"><option value="">— Aucun livre —</option>${livres.map((l) => `<option value="${l.id}" ${r.livreId === l.id ? 'selected' : ''}>${esc(l.nom)}</option>`).join('')}<option value="+">+ Nouveau livre…</option></select>
      <div class="rang cache" id="rNouveauLivre" style="margin-top:6px"><input id="rLivreNom" class="grandir" placeholder="Nom du livre"><button class="btn sec" id="rCouverture">📷 Couverture</button></div>
      <div class="doux" id="rLivreEtat"></div></div>
    <button class="btn" id="rSuivant" style="width:100%;margin-top:8px">Choisir les ingrédients à acheter →</button>
    ${existante ? '<button class="btn danger" id="rSup" style="width:100%;margin-top:8px">Supprimer la recette</button>' : ''}`, (c) => {
    // ① Ingrédients par photo
    $('#rPhotoIngr', c).onclick = async () => {
      const blob = await prendrePhoto(); if (!blob) return;
      r.photoId = await S.enregistrerPhoto(blob);
      const texte = await lirePhotoTexte(blob, $('#rEtat', c));
      if (!texte) return;
      const lignes = texte.split('\n').map((l) => l.trim()).filter(Boolean);
      // Le titre est souvent la 1re ligne qui ne commence pas par une quantité
      const titre = lignes.find((l) => !/^[\d½¼¾•\-*]/.test(l) && l.length > 3 && !/ingr[ée]dient/i.test(l));
      const ingr = lignes.filter((l) => l !== titre && !/^ingr[ée]dients?:?$/i.test(l));
      $('#rIng', c).value = ingr.join('\n');
      if (titre && !$('#rTitre', c).value) $('#rTitre', c).value = titre.replace(/\s+/g, ' ');
      $('#rEtat', c).textContent = `✓ ${ingr.length} ligne(s) lue(s) — vérifie et corrige au besoin.`;
    };
    // ③ Photo du plat
    $('#rPhotoPlat', c).onclick = async () => {
      const blob = await prendrePhoto(); if (!blob) return;
      r.photoPlatId = await S.enregistrerPhoto(blob);
      $('#rPlatEtat', c).textContent = '✓ photo gardée';
    };
    // ④ Livre : existant, nouveau tapé, ou lu sur la couverture
    $('#rLivre', c).onchange = () => $('#rNouveauLivre', c).classList.toggle('cache', $('#rLivre', c).value !== '+');
    $('#rCouverture', c).onclick = async () => {
      const blob = await prendrePhoto(); if (!blob) return;
      r.photoLivreId = await S.enregistrerPhoto(blob);
      const texte = await lirePhotoTexte(blob, $('#rLivreEtat', c));
      if (!texte) return;
      const nom = texte.split('\n').map((l) => l.trim()).filter((l) => /[a-zà-ÿ]{3,}/i.test(l)).sort((a, b) => b.length - a.length)[0] || '';
      $('#rLivreNom', c).value = nom.replace(/\s+/g, ' ').slice(0, 80);
      $('#rLivreEtat', c).textContent = nom ? '✓ Titre lu sur la couverture — corrige-le au besoin.' : 'Titre non lu : tape-le.';
    };
    $('#rSup', c)?.addEventListener('click', () => {
      if (confirm(`Supprimer la recette « ${r.titre} » ?`)) { S.maj((x) => { x.recettes = x.recettes.filter((y) => y.id !== r.id); }); fermerModale(); }
    });
    // ⑤ Enregistrer et choisir les ingrédients
    $('#rSuivant', c).onclick = () => {
      const texte = $('#rIng', c).value;
      const ingredients = texte.split('\n').map(analyserIngredient).filter(Boolean)
        .map((i) => ({ ...i, articleId: correspondance(i.nom)?.id || null }));
      if (!ingredients.length) { toast('Ajoute au moins un ingrédient (photo ou texte)'); return; }
      r.titre = $('#rTitre', c).value.trim() || 'Recette sans titre';
      r.ingredients = ingredients; r.texteIngredients = texte;
      let livreId = $('#rLivre', c).value;
      S.maj((x) => {
        x.livres ||= [];
        if (livreId === '+') {
          const nom = $('#rLivreNom', c).value.trim();
          const exist = nom && x.livres.find((l) => sansAccents(l.nom) === sansAccents(nom)); // même livre → même groupe
          livreId = exist ? exist.id : nom ? S.uid('lv') : '';
          if (nom && !exist) x.livres.push({ id: livreId, nom, photoId: r.photoLivreId || null });
        }
        r.livreId = livreId || null;
        const i = x.recettes.findIndex((y) => y.id === r.id);
        if (i >= 0) x.recettes[i] = r; else x.recettes.unshift(r);
        for (const [pid, type] of [[r.photoId, 'recette'], [r.photoPlatId, 'recette'], [r.photoLivreId, 'livre']]) {
          if (pid && !x.photos.some((p) => p.id === pid)) x.photos.push({ id: pid, type, articleId: null, date: new Date().toISOString(), prise_par: x.utilisateur, note: r.titre });
        }
      });
      choisir(r);
    };
  });
}

/** Liste à cocher des ingrédients → ajout à la liste (fusion si déjà présent). */
function choisir(r) {
  const e = S.get();
  const dejaDansListe = (id) => id && e.liste.some((l) => l.articleId === id && !l.coche);
  ouvrirModale(r.titre, `
    <p class="doux">Coche ce qu'il faut acheter. Le garde-manger (sel, huile…) et ce qui est déjà dans ta liste sont décochés.</p>
    <div id="ings">${r.ingredients.map((i, k) => {
      const a = e.articles.find((x) => x.id === i.articleId);
      const garde = GARDE_MANGER.includes(sansAccents(i.nom));
      const deja = dejaDansListe(i.articleId);
      return `<label class="item" style="cursor:pointer">
        <input type="checkbox" data-k="${k}" ${garde || deja ? '' : 'checked'}>
        <div class="grandir"><div class="nom">${esc(a ? a.nom : i.nom)}</div>
        <div class="info">${esc(i.brut)}${a ? ' · au catalogue' : ' · nouvel article'}${deja ? ' · <b>déjà dans la liste</b>' : ''}</div></div></label>`;
    }).join('')}</div>
    <button class="btn" id="ajSel" style="width:100%;margin-top:8px">Ajouter la sélection</button>`, (c) => {
    $('#ajSel', c).onclick = () => {
      let n = 0, f = 0;
      for (const cb of $$('[data-k]', c)) {
        if (!cb.checked) continue;
        const i = r.ingredients[Number(cb.dataset.k)];
        const a = i.articleId ? S.get().articles.find((x) => x.id === i.articleId) : assurerArticle(i.nom);
        const note = `${i.quantite ? i.quantite.toLocaleString('fr-CA', { maximumFractionDigits: 2 }) + ' ' : ''}${i.unite} pour ${r.titre}`.trim();
        const existe = S.get().liste.find((l) => l.articleId === a.id && !l.coche);
        if (existe) {
          S.maj((x) => { const l = x.liste.find((y) => y.id === existe.id); l.recettes = [...new Set([...(l.recettes || []), r.titre])]; l.note = [l.note, note].filter(Boolean).join(' ; '); });
          f++;
        } else { ajouterALaListe(a.id, 1, { recette: r.titre, note }); }
        n++;
        if (!i.articleId) S.maj((x) => { const rr = x.recettes.find((y) => y.id === r.id); if (rr) rr.ingredients[Number(cb.dataset.k)].articleId = a.id; });
      }
      fermerModale(); toast(`${n} ingrédient(s) ajouté(s)${f ? `, ${f} fusionné(s) avec la liste` : ''}`);
    };
  });
}
