// =====================================================================
// Recettes → liste d'épicerie
// Photo (gardée) + ingrédients collés ou tapés → liste à cocher → ajout.
// La lecture automatique de la photo sera faite par l'agent lecteur-photos
// quand la base partagée sera branchée.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, meilleureOffre, toast } from './ui.js';
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

export function vueRecettes(v) {
  const e = S.get();
  let html = `<button class="btn" id="nouvRecette" style="width:100%;margin-bottom:12px">+ Nouvelle recette (photo ou texte)</button>`;
  if (!e.recettes.length) html += `<div class="vide">Aucune recette. Prends une photo d'une recette ou colle ses ingrédients : tu choisiras ce qu'il faut acheter.</div>`;
  for (const r of e.recettes) {
    const cout = r.ingredients.reduce((t, i) => {
      const a = e.articles.find((x) => x.id === i.articleId);
      const o = a && meilleureOffre(a);
      return t + (o?.prixArticle || 0);
    }, 0);
    html += `<div class="carte" data-r="${r.id}"><div class="rang"><b class="grandir">${esc(r.titre)}</b>${r.photoId ? '<span>📷</span>' : ''}</div>
      <div class="doux">${r.ingredients.length} ingrédients · coût estimé ~${argent(cout)} (articles entiers, meilleurs prix connus)</div>
      <div class="rang envelopper" style="margin-top:8px"><button class="btn" data-ajout>Choisir et ajouter à la liste</button>
      ${r.photoId ? '<button class="btn sec" data-photo>Photo</button>' : ''}${r.url ? `<a class="btn sec" style="text-decoration:none" href="${esc(r.url)}" target="_blank" rel="noopener">Lien</a>` : ''}
      <button class="btn danger" data-sup>Supprimer</button></div></div>`;
  }
  v.innerHTML = html;
  $('#nouvRecette').onclick = () => editeur();
  $$('[data-r]', v).forEach((el) => {
    const r = e.recettes.find((x) => x.id === el.dataset.r);
    el.querySelector('[data-ajout]').onclick = () => choisir(r);
    el.querySelector('[data-photo]')?.addEventListener('click', () => ouvrirModale(r.titre, '<div id="ph"></div>', (c) => afficherPhoto({ id: r.photoId, type: 'recette', note: r.titre }, $('#ph', c), true)));
    el.querySelector('[data-sup]').onclick = () => { if (confirm(`Supprimer la recette « ${r.titre} » ?`)) S.maj((x) => { x.recettes = x.recettes.filter((y) => y.id !== r.id); }); };
  });
}

function editeur() {
  let photoId = null;
  ouvrirModale('Nouvelle recette', `
    <div class="champ"><label>Titre</label><input id="rTitre" placeholder="ex. Chili de Maman"></div>
    <div class="champ"><label>Lien web (facultatif)</label><input id="rUrl" type="url" placeholder="https://…"></div>
    <div class="rang" style="margin-bottom:10px"><button class="btn sec" id="rPhoto">📷 Photo de la recette</button><span class="doux" id="rPhotoEtat"></span></div>
    <div class="champ"><label>Ingrédients (une ligne par ingrédient — colle-les ou tape-les)</label>
      <textarea id="rIng" placeholder="500 g de bœuf haché&#10;1 oignon, haché&#10;2 boîtes de tomates en dés&#10;1 c. à soupe de chili"></textarea></div>
    <p class="doux">La lecture automatique des ingrédients sur la photo arrivera avec l'agent lecteur-photos (base partagée). La photo est déjà gardée avec la recette.</p>
    <button class="btn" id="rAnalyser">Analyser les ingrédients →</button>`, (c) => {
    $('#rPhoto', c).onclick = () => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.capture = 'environment';
      i.onchange = async () => {
        const f = i.files?.[0]; if (!f) return;
        photoId = await S.enregistrerPhoto(await S.compresser(f, 1800));
        $('#rPhotoEtat', c).textContent = '✓ photo gardée';
      };
      i.click();
    };
    $('#rAnalyser', c).onclick = () => {
      const titre = $('#rTitre', c).value.trim() || 'Recette sans titre';
      const ingredients = $('#rIng', c).value.split('\n').map(analyserIngredient).filter(Boolean)
        .map((i) => ({ ...i, articleId: correspondance(i.nom)?.id || null }));
      if (!ingredients.length) { toast('Ajoute au moins un ingrédient'); return; }
      const r = { id: S.uid('rc'), titre, url: $('#rUrl', c).value.trim(), photoId, ingredients, creeLe: new Date().toISOString() };
      S.maj((x) => {
        x.recettes.unshift(r);
        if (photoId) x.photos.push({ id: photoId, type: 'recette', articleId: null, date: r.creeLe, prise_par: x.utilisateur, note: titre });
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
