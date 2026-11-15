// =====================================================================
// Liste écrite à la main → liste d'épicerie
// ① photo de la liste ② lecture (sur le téléphone ; l'IA la remplacera plus tard)
// ③ tu corriges le texte ④ article par article :
//    - déjà acheté / connu → ajouté tout seul
//    - inconnu → je cherche chez les bannières (prix, format, photo) → tu choisis ou dis non
//    - non → ajout manuel (nom) ou on laisse tomber
// Plus : photo en magasin d'un article sans référence (remplace l'image, lit le prix,
// et peut le cocher comme mis au panier).
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, toast, nomBanniere, puce, logo, meilleureOffre } from './ui.js';
import { prendrePhoto, lireTexte, lireEtiquette, lireListeIA, miniature } from './ocr.js';
import { rechercherSouple, actualiserArticle, MAGASINS_EC, puDepuisEC } from './epiceries.js';
import { normaliser, formatLisible, analyserFormat, analyserOffre } from './normalise.js';
import { ajouterTache } from './attente.js';

/** « 2 lait 2% », « - beurre », « ☐ 3 x yogourt » → { quantite, nom }. */
export function analyserLigne(l) {
  const t = l.replace(/^[\s☐☑✓✔□■•\-*–·>]+/, '').replace(/^\d+[.)]\s+/, '').replace(/\s*\(\?\)\s*$/, '').replace(/\s+/g, ' ').trim();
  if (t.length < 2) return null;
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:x\s*)?(.{2,})$/i);
  return m ? { quantite: Number(m[1].replace(',', '.')), nom: m[2].trim() } : { quantite: 1, nom: t };
}

/** Assez de lettres pour être un mot écrit (et pas une rature lue de travers). */
function plausible(nom) {
  const lettres = (nom.match(/[a-zà-ÿ]/gi) || []).length;
  return lettres >= 2 && lettres / nom.replace(/\s/g, '').length >= 0.6;
}

// ---------------------------------------------------------------------
// ①–③ Photo, lecture, correction
// ---------------------------------------------------------------------
export async function ouvrirListeManuscrite() {
  const blob = await prendrePhoto();
  if (!blob) return;
  const photoId = await S.enregistrerPhoto(blob);
  S.maj((x) => x.photos.push({ id: photoId, type: 'liste', articleId: null, date: new Date().toISOString(), prise_par: x.utilisateur, note: 'Liste écrite à la main' }));
  ouvrirModale('Liste écrite à la main', `
    <img src="${URL.createObjectURL(blob)}" alt="" style="width:100%;max-height:34vh;object-fit:contain;border-radius:8px;background:#000">
    <p class="doux" id="lmEtat">Lecture…</p>
    <label class="doux">Un article par ligne — corrige ce qui a été mal lu :</label>
    <textarea id="lmTexte" style="min-height:160px" placeholder="2 lait&#10;beurre&#10;bananes"></textarea>
    <button class="btn" id="lmSuivant" style="width:100%;margin-top:8px">Continuer →</button>`, async (c) => {
    $('#lmSuivant', c).onclick = () => {
      const lignes = $('#lmTexte', c).value.split('\n').map(analyserLigne).filter(Boolean);
      if (!lignes.length) { toast('Écris au moins un article'); return; }
      assistant(lignes);
    };
    if (!navigator.onLine) { $('#lmEtat', c).textContent = '📵 Pas de réseau : tape les articles (la photo est gardée).'; return; }
    try {
      // ① l'IA (Claude) si le foyer est connecté : fiable sur l'écriture à la main
      const ia = await lireListeIA(blob, (m) => { $('#lmEtat', c).textContent = m; });
      if (ia) {
        $('#lmTexte', c).value = ia.map((x) => `${x.quantite !== 1 ? `${x.quantite} ` : ''}${x.nom}${x.certain ? '' : ' (?)'}`).join('\n');
        const doutes = ia.filter((x) => !x.certain).length;
        $('#lmEtat', c).innerHTML = `✓ ${ia.length} article(s) lu(s) par l'IA${doutes ? ` — <b>${doutes} marqué(s) (?)</b> : écriture difficile, vérifie-les` : ''}.`;
        return;
      }
      // ② sinon, lecture sur le téléphone
      const texte = await lireTexte(blob, (m) => { $('#lmEtat', c).textContent = m; });
      const lignes = texte.split('\n').map(analyserLigne).filter((x) => x && plausible(x.nom));
      $('#lmTexte', c).value = lignes.map((x) => (x.quantite !== 1 ? `${x.quantite} ` : '') + x.nom).join('\n');
      $('#lmEtat', c).innerHTML = `✓ ${lignes.length} ligne(s) lue(s). <b>L'écriture à la main est difficile à lire sur le téléphone : vérifie chaque ligne.</b>`;
    } catch {
      $('#lmEtat', c).textContent = 'Lecture impossible : tape les articles.';
    }
  });
}

// ---------------------------------------------------------------------
// ④ Assistant, un article à la fois
// ---------------------------------------------------------------------
const sansAccents = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Article déjà acheté ou connu qui correspond au mot écrit (plus souvent acheté d'abord). */
function trouverReference(nom) {
  const e = S.get();
  const n = sansAccents(nom).replace(/s\b/g, '');
  const score = (a) => (e.achats || []).filter((x) => x.articleId === a.id).length + e.liste.filter((l) => l.articleId === a.id).length;
  const candidats = e.articles.filter((a) => {
    const an = sansAccents(a.nom).replace(/s\b/g, '');
    return an === n || an.startsWith(n) || n.startsWith(an) || (n.length >= 4 && an.includes(n));
  });
  return candidats.sort((a, b) => score(b) - score(a))[0] || null;
}

/** Traite une liste de lignes { quantite, nom } (utilisé après la photo ; l'IA l'utilisera aussi). */
export async function assistant(lignes) {
  const app = await import('./app.js');
  const bilan = { auto: [], choisis: [], manuels: [], ignores: [] };
  let i = 0;

  const suivant = () => {
    if (i >= lignes.length) return fin();
    const { quantite, nom } = lignes[i];
    const ref = trouverReference(nom);
    if (ref) { app.ajouterALaListe(ref.id, quantite); bilan.auto.push(ref.nom); i++; return suivant(); }
    question(quantite, nom);
  };

  const entete = () => `<div class="doux" style="margin-bottom:6px">Article ${i + 1} sur ${lignes.length}${bilan.auto.length ? ` · ${bilan.auto.length} déjà reconnu(s) et ajouté(s)` : ''}</div>`;

  // Pas de référence : on propose de chercher chez les bannières
  const question = (quantite, nom) => {
    ouvrirModale(`« ${nom} »`, `${entete()}
      <p>Je ne trouve pas ce produit dans ton historique. Je cherche son prix et son format chez les bannières ?</p>
      <div class="rang"><button class="btn grandir" id="aOui">🔎 Oui, chercher</button><button class="btn sec grandir" id="aNon">Non</button></div>`, (c) => {
      $('#aOui', c).onclick = () => chercher(quantite, nom);
      $('#aNon', c).onclick = () => manuel(quantite, nom);
    });
  };

  const chercher = (quantite, nom) => {
    ouvrirModale(`« ${nom} »`, `${entete()}<div id="aRes"><p class="doux">Recherche chez Maxi, IGA, Super C et Metro…</p></div>
      <button class="btn sec" id="aAucun" style="width:100%;margin-top:8px">Aucun ne convient</button>`, async (c) => {
      $('#aAucun', c).onclick = () => manuel(quantite, nom);
      let res = [];
      try { res = await rechercherSouple(nom); } catch { /* hors ligne */ }
      if (!res.length) { $('#aRes', c).innerHTML = `<p class="doux">${navigator.onLine ? 'Aucun produit trouvé.' : '📵 Pas de réseau.'}</p>`; return; }
      // Prix au kg / L pour comparer, et couleurs vert (moins cher) / rouge (plus cher)
      const base = (() => { const n = { kg: 0, l: 0, unite: 0 }; res.forEach((r) => { const f = analyserFormat(r.size); if (f) n[f.base]++; }); return Object.entries(n).sort((a, b) => b[1] - a[1])[0][0]; })();
      const pus = res.map((r) => normaliser(r.price, r.size, base).prixUnitaire ?? (puDepuisEC(r.unitPrice)?.unite === base ? puDepuisEC(r.unitPrice).pu : null));
      const connus = pus.filter((x) => x != null); const min = Math.min(...connus), max = Math.max(...connus);
      const ref = base === 'kg' ? '$/kg' : base === 'l' ? '$/L' : '$/unité';
      $('#aRes', c).innerHTML = `<p class="doux">Touche le produit qui correspond (il sera ajouté à ta liste) :</p>` + res.slice(0, 12).map((r, k) => {
        const pu = pus[k]; const coul = pu == null || connus.length < 2 ? '' : pu <= min + 1e-9 ? 'vert' : pu >= max - 1e-9 ? 'rouge' : '';
        return `<button class="item res-choix ${coul ? 'res-' + coul : ''}" data-k="${k}" style="width:100%;text-align:left;font:inherit;color:inherit">
          ${r.image ? `<img class="vignette" src="${esc(r.image)}" alt="">` : '<span class="vignette"></span>'}
          <div class="grandir"><div class="nom" style="font-weight:500">${esc(r.name)}</div>
            <div class="info">${esc(r.brand || '')}${r.size ? ` · ${esc(formatLisible(r.size))}` : ''}</div>
            <div class="info">${MAGASINS_EC[r.store] ? logo(MAGASINS_EC[r.store]) : esc(r.store)} ${argent(r.price)}${r.discounted ? ' <span class="pastille ambre">rabais</span>' : ''}</div></div>
          ${pu != null ? `<div class="pu-res ${coul}">${pu.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br><span class="doux">${ref}</span></div>` : ''}</button>`;
      }).join('');
      $$('[data-k]', c).forEach((b) => b.onclick = async () => {
        const r = res[Number(b.dataset.k)];
        const f = analyserFormat(r.size);
        const a = { id: S.uid('a'), nom: nom.replace(/^./, (x) => x.toUpperCase()), rayonId: app.rayonParDefaut(), uniteRef: f?.base || 'unite',
          format: r.size ? formatLisible(r.size) : '', local: false, codes: [], marque: r.brand || '', imageUrl: r.image || null,
          liens: [{ id: r.id, nom: [r.brand, r.name].filter(Boolean).join(' '), size: r.size, image: r.image }] };
        S.maj((x) => x.articles.push(a));
        app.ajouterALaListe(a.id, quantite);
        bilan.choisis.push(a.nom);
        actualiserArticle(a.id, { force: true }); // prix réels + rayon, en arrière-plan
        i++; suivant();
      });
    });
  };

  // Non / aucun ne convient : ajout manuel ou on laisse tomber
  const manuel = (quantite, nom) => {
    ouvrirModale(`« ${nom} »`, `${entete()}
      <p>L'ajouter quand même à ta liste, sous le nom de ton choix ? (Tu pourras le photographier en magasin pour lui donner une photo et un prix.)</p>
      <input id="aNom" value="${esc(nom)}">
      <div class="rang" style="margin-top:8px"><button class="btn grandir" id="aAjout">Ajouter</button><button class="btn sec grandir" id="aJeter">Laisser tomber</button></div>`, (c) => {
      $('#aAjout', c).onclick = () => {
        const n = $('#aNom', c).value.trim(); if (!n) return;
        // Nom tapé à la main : correspondance exacte seulement (sinon on crée un nouvel article)
        let a = S.get().articles.find((x) => sansAccents(x.nom) === sansAccents(n));
        if (!a) {
          a = { id: S.uid('a'), nom: n.replace(/^./, (x) => x.toUpperCase()), rayonId: app.rayonParDefaut(), uniteRef: 'unite', format: '', local: false, codes: [] };
          S.maj((x) => x.articles.push(a));
        }
        app.ajouterALaListe(a.id, quantite); bilan.manuels.push(a.nom);
        i++; suivant();
      };
      $('#aJeter', c).onclick = () => { bilan.ignores.push(nom); i++; suivant(); };
    });
  };

  const fin = () => {
    ouvrirModale('Liste ajoutée', `
      ${bilan.auto.length ? `<p>✓ <b>${bilan.auto.length}</b> reconnu(s) dans ton historique : ${bilan.auto.map(esc).join(', ')}</p>` : ''}
      ${bilan.choisis.length ? `<p>🔎 <b>${bilan.choisis.length}</b> trouvé(s) chez les bannières : ${bilan.choisis.map(esc).join(', ')}</p>` : ''}
      ${bilan.manuels.length ? `<p>✎ <b>${bilan.manuels.length}</b> ajouté(s) à la main : ${bilan.manuels.map(esc).join(', ')} <span class="doux">— photographie-les en magasin (📷 sur la ligne).</span></p>` : ''}
      ${bilan.ignores.length ? `<p class="doux">Laissé(s) tombé(s) : ${bilan.ignores.map(esc).join(', ')}</p>` : ''}
      <button class="btn" id="aFini" style="width:100%">Voir ma liste</button>`, (c) => { $('#aFini', c).onclick = fermerModale; });
  };

  suivant();
}

// ---------------------------------------------------------------------
// Photo en magasin d'un article sans référence
// ---------------------------------------------------------------------
export async function photoEnMagasin(articleId, ligneId) {
  const blob = await prendrePhoto();
  if (!blob) return;
  const e = S.get();
  const a = e.articles.find((x) => x.id === articleId);
  const photoId = await S.enregistrerPhoto(blob);
  const mini = await miniature(blob);
  S.maj((x) => {
    const ar = x.articles.find((y) => y.id === articleId); if (ar) ar.imageUrl = mini; // la photo prend la place de l'image
    x.photos.push({ id: photoId, type: 'produit', articleId, date: new Date().toISOString(), prise_par: x.utilisateur, note: 'Photo en magasin' });
  });
  const mags = e.magasins.filter((m) => m.actif !== false);
  const l = e.liste.find((x) => x.id === ligneId);
  const magDefaut = l?.magasinCible && !l.magasinCible.startsWith('perso:') ? mags.find((m) => m.banniere === l.magasinCible)?.id
    : e.magasinCourant !== 'defaut' ? e.magasinCourant : mags[0]?.id;
  ouvrirModale(a.nom, `
    <img src="${mini}" alt="" style="display:block;margin:0 auto 8px;width:140px;border-radius:8px">
    <div class="champ"><label>Magasin</label><select id="pmMag">${mags.map((m) => `<option value="${m.id}" ${m.id === magDefaut ? 'selected' : ''}>${esc(m.nom)}</option>`).join('')}</select></div>
    <div class="rang"><div class="champ grandir"><label>Prix sur l'étiquette</label><input id="pmOffre" placeholder="4,99 $ (facultatif)"></div>
      <div class="champ grandir"><label>Format</label><input id="pmFormat" value="${esc(a.format || '')}" placeholder="454 g"></div></div>
    <p class="doux" id="pmEtat">${navigator.onLine ? 'Lecture du prix…' : '📵 Pas de réseau : laisse le prix vide, il sera lu au retour du réseau.'}</p>
    <label class="item" style="cursor:pointer"><input type="checkbox" id="pmPanier" checked><div class="grandir"><div class="nom">Je suis en magasin : cocher comme mis au panier</div></div></label>
    <button class="btn" id="pmOk" style="width:100%;margin-top:8px">Enregistrer</button>`, async (c) => {
    $('#pmOk', c).onclick = () => {
      const mag = mags.find((m) => m.id === $('#pmMag', c).value);
      const offre = $('#pmOffre', c).value.trim();
      const format = $('#pmFormat', c).value.trim();
      if (offre && !analyserOffre(offre)) { toast('Prix illisible : ex. 4,99 $ ou 2/5 $'); return; }
      const pid = S.uid('p');
      S.maj((x) => {
        const ar = x.articles.find((y) => y.id === articleId);
        if (ar && format && !ar.format) { ar.format = format; const f = analyserFormat(format); if (f) ar.uniteRef = f.base; }
        if (mag) x.prix.push({ id: pid, articleId, banniere: mag.banniere, magasinId: mag.id, offre, format: format || ar?.format, type: 'regulier', fin: null,
          source: 'photo', photoId, enAttente: !offre, observeLe: new Date().toISOString().slice(0, 10) });
        if ($('#pmPanier', c).checked) { const li = x.liste.find((y) => y.id === ligneId); if (li) { li.coche = true; li.cocheLe = new Date().toISOString(); } }
      });
      if (!offre && mag) ajouterTache({ type: 'prix', prixId: pid, photoId });
      fermerModale(); toast($('#pmPanier', c).checked ? `${a.nom} : photo gardée et mis au panier ✓` : `${a.nom} : photo gardée`);
    };
    if (!navigator.onLine) return;
    try {
      const lu = await lireEtiquette(blob, (m) => { $('#pmEtat', c).textContent = m; });
      if (lu.offre && !$('#pmOffre', c).value) $('#pmOffre', c).value = lu.offre;
      if (lu.format && !$('#pmFormat', c).value) $('#pmFormat', c).value = lu.format;
      $('#pmEtat', c).textContent = lu.offre ? `✓ Lu : ${lu.offre} — vérifie.` : 'Prix non lu sur la photo : écris-le si tu veux (facultatif).';
    } catch { $('#pmEtat', c).textContent = 'Lecture impossible : écris le prix si tu veux.'; }
  });
}
