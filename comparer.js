// =====================================================================
// Onglet COMPARER : vue cartes, vue tableau (aliments × bannières),
// création de listes « le moins cher en N arrêts max », commande en ligne.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, offresArticle, libelleUnitaire, libelleFin, joursRestants, nomBanniere, puce, toast } from './ui.js';
import { BANNIERES } from './demo-data.js';
import { analyserFormat, formatLisible } from './normalise.js';

let vue = 'tableau';      // 'tableau' | 'cartes'
let portee = 'liste';     // 'liste' | 'tout'
let maxArrets = 2;
let banniereEnLigne = 'maxi';

// Commande en ligne. Les liens https ouvrent l'app de la bannière si elle est
// installée et prend ces liens en charge ; sinon, le site. Liens à valider.
export const EN_LIGNE = {
  iga: { site: 'https://www.iga.net/fr', recherche: (q) => `https://www.iga.net/fr/search?k=${encodeURIComponent(q)}`, note: 'App IGA' },
  metro: { site: 'https://www.metro.ca/epicerie-en-ligne', recherche: (q) => `https://www.metro.ca/epicerie-en-ligne/recherche?filter=${encodeURIComponent(q)}`, note: 'App Metro' },
  maxi: { site: 'https://www.maxi.ca/fr', recherche: (q) => `https://www.maxi.ca/fr/search?search-bar=${encodeURIComponent(q)}`, note: 'App PC Express' },
  costco: { site: 'https://www.costco.ca/?lang=fr-CA', recherche: (q) => `https://www.costco.ca/CatalogSearch?keyword=${encodeURIComponent(q)}&lang=fr-CA`, note: 'Épicerie le jour même via Instacart' },
  jean_coutu: { site: 'https://www.jeancoutu.com', recherche: (q) => `https://www.jeancoutu.com/recherche/?k=${encodeURIComponent(q)}`, note: 'Boutique en ligne (choix limité)' },
  super_c: { site: 'https://www.superc.ca', recherche: (q) => `https://www.superc.ca/recherche?filter=${encodeURIComponent(q)}`, note: 'Pas de commande en ligne connue (à vérifier)', sansCommande: true },
  instacart: { site: 'https://www.instacart.ca', recherche: (q) => `https://www.instacart.ca/store/s?k=${encodeURIComponent(q)}`, note: '⚠️ Prix souvent plus élevés qu\'en magasin + frais' },
};

/** Clé d'un « arrêt » : bannière, ou magasin précis quand un rabais perso s'applique. */
export const cleOffre = (o) => (o.perso ? 'perso:' + o.magasinNom : o.banniere);
export const nomCle = (k) => (k.startsWith('perso:') ? k.slice(6) : nomBanniere(k));
const banniereDeCle = (k) => {
  if (!k.startsWith('perso:')) return k;
  return S.get().magasins.find((m) => m.nom === k.slice(6))?.banniere || 'iga';
};

// ---------------------------------------------------------------------
// Tableau des offres d'un article (fiche + vue cartes)
// ---------------------------------------------------------------------
export function tableauOffres(a, { avecManquants = false } = {}) {
  const lignes = offresArticle(a);
  const presentes = new Set(lignes.map((l) => l.banniere));
  const manquantes = avecManquants ? Object.keys(BANNIERES).filter((b) => !presentes.has(b)) : [];
  if (!lignes.length && !manquantes.length) return `<p class="doux">Aucun prix connu pour l'instant.</p>`;
  return `<table class="comp">${lignes.map((l) => `
    <tr class="${l.classe}">
      <td>${puce(l.banniere)}<b>${esc(l.magasinNom || nomBanniere(l.banniere))}</b>
        <div class="doux">${esc(l.offre)}${l.format ? ` · ${esc(formatLisible(l.format))}` : ''}</div>
        <div>${l.type === 'circulaire' ? '<span class="pastille ambre">circulaire</span>' : ''}${l.type === 'fidelite' ? '<span class="pastille vert">fidélité</span>' : ''}${l.bonus ? `<span class="pastille vert">${esc(l.bonus)}</span>` : ''}${l.perso ? `<span class="pastille vert">${esc(l.rabaisTexte)}</span>` : ''}${l.local ? '<span class="pastille">🍁 local</span>' : ''}${l.fin ? `<span class="pastille ${joursRestants(l.fin) <= 2 ? 'ambre' : ''}">${libelleFin(l.fin)}</span>` : ''}${l.source === 'photo' ? '<span class="pastille">📷 vu en magasin</span>' : ''}${l.source === 'manuel' ? '<span class="pastille">saisi</span>' : ''}</div>
        ${l.erreur ? `<div class="doux" style="color:var(--rouge)">${esc(l.erreur)}</div>` : ''}
      </td>
      <td class="pu">${puHtml(l)}${l.prixArticle != null ? `<div class="doux">${argent(l.prixArticle)} / article</div>` : ''}</td>
    </tr>`).join('')}
    ${manquantes.map((b) => `<tr><td>${puce(b)}<b>${esc(nomBanniere(b))}</b><div class="doux">Prix inconnu</div></td>
      <td class="pu"><button class="btn sec" data-ajprix="${b}" style="padding:4px 10px">+ prix</button></td></tr>`).join('')}
  </table>
  <p class="doux">Vert = meilleur prix · ambre = moins de 5 % d'écart. Prix ramenés à la même unité.</p>`;
}

function puHtml(l) {
  const t = libelleUnitaire(l.pu, l.uniteRef).split(' · ');
  return `${esc(t[0])}${t[1] ? `<br><span class="doux">${esc(t[1])}</span>` : ''}`;
}

// ---------------------------------------------------------------------
// Optimiseur : le moins cher avec au plus N arrêts
// ---------------------------------------------------------------------
function lignesListe() {
  const e = S.get();
  return e.liste.filter((l) => !l.coche).map((l) => ({ l, a: e.articles.find((x) => x.id === l.articleId) })).filter((x) => x.a);
}

/** Pour chaque ligne : coût par arrêt (prix unitaire × quantité voulue). */
function options() {
  return lignesListe().map(({ l, a }) => {
    const f = analyserFormat(a.format);
    const besoin = f && f.base === a.uniteRef ? f.total * l.quantite : null;
    const parCle = {};
    for (const o of offresArticle(a)) {
      if (o.pu == null) continue;
      const cout = besoin != null ? o.pu * besoin : (o.prixArticle != null ? o.prixArticle * l.quantite : null);
      if (cout == null) continue;
      const k = cleOffre(o);
      if (!(k in parCle) || cout < parCle[k].cout) parCle[k] = { cout, offre: o };
    }
    return { l, a, parCle };
  });
}

function combinaisons(cles, k, debut = 0, acc = [], out = []) {
  if (acc.length === k) { out.push([...acc]); return out; }
  for (let i = debut; i < cles.length; i++) { acc.push(cles[i]); combinaisons(cles, k, i + 1, acc, out); acc.pop(); }
  return out;
}

/** Meilleure combinaison de magasins pour chaque nombre d'arrêts de 1 à max. */
export function optimiser(max) {
  const opts = options();
  const cles = [...new Set(opts.flatMap((o) => Object.keys(o.parCle)))];
  const sansPrix = opts.filter((o) => !Object.keys(o.parCle).length);
  const resultats = [];
  for (let k = 1; k <= Math.min(max, cles.length); k++) {
    let meilleur = null;
    for (const combo of combinaisons(cles, k)) {
      let total = 0, manquants = 0; const affect = [];
      for (const o of opts) {
        if (!Object.keys(o.parCle).length) continue;
        let best = null;
        for (const c of combo) if (o.parCle[c] && (!best || o.parCle[c].cout < best.cout)) best = { cle: c, ...o.parCle[c] };
        if (best) { total += best.cout; affect.push({ ...o, choix: best }); } else manquants++;
      }
      // un arrêt inutilisé ne compte pas : on l'ignore
      const utilises = new Set(affect.map((x) => x.choix.cle));
      if (utilises.size < k) continue;
      if (!meilleur || manquants < meilleur.manquants || (manquants === meilleur.manquants && total < meilleur.total - 1e-9)) {
        meilleur = { arrets: k, combo, total, manquants, affect };
      }
    }
    if (meilleur) resultats.push(meilleur);
  }
  return { resultats, sansPrix, nb: opts.length };
}

function appliquer(res) {
  S.maj((e) => {
    for (const l of e.liste) { if (!l.coche) { l.magasinCible = null; } }
    for (const x of res.affect) {
      const l = e.liste.find((i) => i.id === x.l.id);
      if (l) l.magasinCible = x.choix.cle;
    }
  });
  // On ouvre la liste filtrée sur le 1er magasin, dans l'ordre de ses rayons.
  import('./app.js').then((m) => m.allerOnglet('liste', { filtre: res.combo[0] }));
  toast(`Liste répartie sur ${res.arrets} magasin(s). Touche un magasin en haut de la liste pour voir sa partie.`);
}

// ---------------------------------------------------------------------
// Vue
// ---------------------------------------------------------------------
export function vueComparaison(v, rendre) {
  const e = S.get();
  const articles = portee === 'liste'
    ? [...new Set(lignesListe().map((x) => x.a.id))].map((id) => e.articles.find((a) => a.id === id))
    : [...e.articles].sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));

  let html = `<div class="rang envelopper barre-collante">
      <button class="btn ${portee === 'liste' ? '' : 'sec'}" data-portee="liste">Ma liste</button>
      <button class="btn ${portee === 'tout' ? '' : 'sec'}" data-portee="tout">Tout le catalogue</button>
      <span class="grandir"></span>
      <button class="btn ${vue === 'tableau' ? '' : 'sec'}" data-vue="tableau">▦ Tableau</button>
      <button class="btn ${vue === 'cartes' ? '' : 'sec'}" data-vue="cartes">☰ Détail</button></div>`;

  // --- Créer mes listes ---
  const opt = optimiser(maxArrets);
  if (opt.nb) {
    const un = opt.resultats[0];
    html += `<div class="carte"><h2>Créer mes listes : le moins cher</h2>
      <div class="rang"><label class="doux grandir">Nombre d'arrêts maximum</label>
        <select id="maxArrets" style="width:auto">${[1, 2, 3, 4].map((n) => `<option ${n === maxArrets ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${opt.resultats.map((r) => {
        const eco = un && r !== un ? un.total - r.total : 0;
        const parMag = {};
        r.affect.forEach((x) => (parMag[x.choix.cle] ??= []).push(x));
        return `<div class="carte" style="margin:10px 0 0;background:var(--gris-fond)">
          <div class="total"><span>${r.arrets} arrêt${r.arrets > 1 ? 's' : ''} : ${r.combo.map((k) => esc(nomCle(k))).join(' + ')}</span><span>${argent(r.total)}</span></div>
          ${eco > 0.005 ? `<div class="doux">Économie de <b>${argent(eco)}</b> par rapport à 1 arrêt</div>` : ''}
          ${r.manquants ? `<div class="doux" style="color:var(--ambre)">${r.manquants} article(s) sans prix dans ces magasins</div>` : ''}
          ${Object.entries(parMag).map(([k, xs]) => `<div style="margin-top:6px">${puce(banniereDeCle(k))}<b>${esc(nomCle(k))}</b> — ${argent(xs.reduce((t, x) => t + x.choix.cout, 0))}
            <ul class="liste-arret">${xs.map((x) => `<li><span>${x.l.quantite > 1 ? `${x.l.quantite} × ` : ''}${esc(x.a.nom)}</span>
              <span class="doux">${esc(x.choix.offre.offre)}${x.choix.offre.perso ? ' −' + esc(x.choix.offre.rabaisTexte.replace(/^−/, '').split(' (')[0]) : ''}</span></li>`).join('')}</ul></div>`).join('')}
          <button class="btn" data-appliquer="${r.arrets}" style="margin-top:8px">Utiliser cette répartition</button></div>`;
      }).join('')}
      ${opt.sansPrix.length ? `<p class="doux">Sans prix connu : ${opt.sansPrix.map((o) => esc(o.a.nom)).join(', ')}. Touche l'article pour ajouter un prix vu.</p>` : ''}
      <p class="doux">Coût = prix unitaire × ta quantité habituelle (les gros formats Costco sont ramenés à ton format), avant taxes. Le plafond du rabais perso n'est pas suivi article par article.</p></div>`;
  }

  // --- Prix ---
  if (!articles.length) html += `<div class="vide">Rien à comparer.</div>`;
  else if (vue === 'tableau') html += matrice(articles);
  else for (const a of articles) {
    html += `<div class="carte" data-art="${a.id}" style="cursor:pointer"><h3 class="rang">${a.imageUrl ? `<img class="vignette" src="${esc(a.imageUrl)}" alt="">` : ''}<span class="grandir">${esc(a.nom)} ${a.local ? '🍁' : ''} <span class="doux">· comparé au ${a.uniteRef === 'unite' ? 'prix unitaire' : a.uniteRef === 'kg' ? 'kilo' : 'litre'}</span></span></h3>${tableauOffres(a)}</div>`;
  }

  // --- Commande en ligne ---
  if (lignesListe().length) html += blocEnLigne();
  v.innerHTML = html;

  $$('[data-portee]', v).forEach((b) => b.onclick = () => { portee = b.dataset.portee; rendre(); });
  $$('[data-vue]', v).forEach((b) => b.onclick = () => { vue = b.dataset.vue; rendre(); });
  $('#maxArrets', v)?.addEventListener('change', (ev) => { maxArrets = Number(ev.target.value); rendre(); });
  $$('[data-appliquer]', v).forEach((b) => b.onclick = () => appliquer(opt.resultats.find((r) => r.arrets === Number(b.dataset.appliquer))));
  $$('[data-art]', v).forEach((el) => el.onclick = () => import('./app.js').then((m) => m.ficheArticle(el.dataset.art)));
  brancherEnLigne(v, rendre);
}

/** Tableau : une ligne par aliment, une colonne par bannière, le moins cher en surbrillance. */
function matrice(articles) {
  const offres = articles.map((a) => ({ a, os: offresArticle(a) }));
  const cles = [...new Set(offres.flatMap(({ os }) => os.filter((o) => o.pu != null).map(cleOffre)))];
  const ordre = Object.keys(BANNIERES);
  cles.sort((x, y) => ordre.indexOf(banniereDeCle(x)) - ordre.indexOf(banniereDeCle(y)) || x.localeCompare(y));
  return `<div class="tableau-wrap"><table class="matrice">
    <thead><tr><th>Aliment</th>${cles.map((k) => `<th>${puce(banniereDeCle(k))}${esc(nomCle(k))}${k.startsWith('perso:') ? '<div class="doux">rabais perso</div>' : ''}</th>`).join('')}</tr></thead>
    <tbody>${offres.map(({ a, os }) => {
      const parCle = {};
      for (const o of os) { if (o.pu == null) continue; const k = cleOffre(o); if (!parCle[k] || o.pu < parCle[k].pu) parCle[k] = o; }
      return `<tr><th data-art="${a.id}">${a.imageUrl ? `<img class="vignette petite" src="${esc(a.imageUrl)}" alt="" style="float:right;margin-left:4px">` : ''}${esc(a.nom)}${a.local ? ' 🍁' : ''}<div class="doux">${esc(formatLisible(a.format) || '')}</div></th>${cles.map((k) => {
        const o = parCle[k];
        if (!o) return '<td class="vide-cel">—</td>';
        const affiche = o.perso && o.prixArticle != null ? argent(o.prixArticle) : o.offre;
        const prix = affiche + (o.format ? ` / ${formatLisible(o.format)}` : '');
        return `<td class="${o.classe}"><b>${esc(prix)}</b>${o.perso ? `<div class="doux">${esc(o.offre)} ${esc(o.rabaisTexte.split(' (')[0])}</div>` : ''}<div>${esc(libelleUnitaire(o.pu, o.uniteRef).split(' · ')[0])}</div>${o.fin ? `<div class="doux">${libelleFin(o.fin)}</div>` : ''}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div>
    <p class="doux">Surligné vert = le moins cher (au même format) · ambre = moins de 5 % d'écart. Glisse le tableau vers la gauche pour voir toutes les bannières. Touche un aliment pour sa fiche.</p>`;
}

function blocEnLigne() {
  const e = S.get();
  const b = EN_LIGNE[banniereEnLigne];
  const toutes = lignesListe();
  const assignes = toutes.filter(({ l }) => l.magasinCible && banniereDeCle(l.magasinCible) === banniereEnLigne);
  const items = assignes.length ? assignes : toutes;
  return `<div class="carte"><h2>Préparer un panier en ligne</h2>
    <div class="rang"><select id="bannEnLigne" class="grandir">${Object.keys(EN_LIGNE).map((k) => `<option value="${k}" ${k === banniereEnLigne ? 'selected' : ''}>${k === 'instacart' ? 'Instacart' : esc(nomBanniere(k))}</option>`).join('')}</select>
      <a class="btn" href="${b.site}" target="_blank" rel="noopener" style="text-decoration:none">Ouvrir l'app / le site</a></div>
    <p class="doux">${esc(b.note)}. ${assignes.length ? `${assignes.length} article(s) que la répartition a placés ici.` : 'Toute la liste (aucune répartition appliquée pour cette bannière).'} Tu te connectes et tu confirmes toi-même.</p>
    ${b.sansCommande ? '' : items.map(({ l, a }) => `<div class="rang" style="padding:6px 0;border-top:1px solid var(--ligne)">
      <span class="grandir une-ligne">${l.quantite} × ${esc(a.nom)}${a.format ? ` <span class="doux">${esc(formatLisible(a.format))}</span>` : ''}</span>
      <a href="${b.recherche(a.nom)}" target="_blank" rel="noopener" style="white-space:nowrap">Chercher ›</a></div>`).join('')}
    <button class="btn sec" id="copierListe" style="margin-top:8px">Copier cette liste</button></div>`;
}

function brancherEnLigne(v, rendre) {
  const sel = $('#bannEnLigne', v);
  if (!sel) return;
  sel.onchange = () => { banniereEnLigne = sel.value; rendre(); };
  $('#copierListe', v).onclick = async () => {
    const toutes = lignesListe();
    const assignes = toutes.filter(({ l }) => l.magasinCible && banniereDeCle(l.magasinCible) === banniereEnLigne);
    const txt = (assignes.length ? assignes : toutes).map(({ l, a }) => `${l.quantite} × ${a.nom}${a.format ? ` (${formatLisible(a.format)})` : ''}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Liste copiée — colle-la dans l\'app'); } catch { toast('Copie impossible'); }
  };
}
