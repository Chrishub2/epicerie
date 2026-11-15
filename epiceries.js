// =====================================================================
// Vrais prix — API publique d'épiceries.ca
// Doc : https://epiceries.ca/developers — lecture seule, sans clé, CORS ouvert.
// Conditions : usage raisonnable (cache, pas de rafales), attribuer la source.
// Couvre Maxi, IGA, Super C, Metro (+ Provigo, Walmart, ignorés : hors mandat).
// Ne couvre PAS Costco ni Jean Coutu → photo, saisie, reçus.
// =====================================================================
import * as S from './store.js';
import { $, $$, esc, argent, ouvrirModale, fermerModale, toast, nomBanniere, puce } from './ui.js';
import { normaliser, analyserFormat, formatLisible } from './normalise.js';

const API = 'https://epiceries.ca/api';
export const MAGASINS_EC = { maxi: 'maxi', iga: 'iga', superc: 'super_c', metro: 'metro' };
const DELAI_MAJ_MS = 12 * 3600 * 1000;  // on ne redemande pas un produit plus d'une fois aux 12 h
const PAUSE_MS = 400;                    // pas de rafales

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function appel(params) {
  const r = await fetch(`${API}?${new URLSearchParams(params)}`);
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.error?.message || 'Erreur épiceries.ca'); e.code = j.error?.code; throw e; }
  return j.data;
}

export const rechercher = (q) => appel({ endpoint: 'search', q, limit: 40 }).then((d) => d.results);

/**
 * Recherche souple : la recherche d'épiceries.ca est stricte (« lait 2% 4 l » → rien).
 * On essaie la phrase complète, puis sans formats ni chiffres, puis le 1er mot ;
 * ensuite on met en premier les produits du même format que l'article.
 */
export async function rechercherSouple(q, formatPrefere) {
  const sansFormat = q.replace(/\d+([.,]\d+)?\s*(x\s*\d+\s*)?(kg|g|ml|l|lb|oz)?(?![a-zà-ÿ])/gi, ' ')
    .replace(/%/g, ' ').replace(/\s+/g, ' ').trim();
  // « lait 2% 4 l » → « lait 2% » (on garde le %) → « lait »
  const sansTaille = q.replace(/\d+([.,]\d+)?\s*(x\s*\d+\s*)?(kg|g|ml|l|lb|oz)(?![a-zà-ÿ])/gi, ' ').replace(/\s+/g, ' ').trim();
  const essais = [...new Set([q, sansTaille, sansFormat, sansFormat.split(' ')[0]].filter((s) => s && s.length >= 2))];
  let res = [];
  for (const e of essais) {
    try { res = await rechercher(e); } catch { res = []; }
    if (res.length) break;
    await pause(PAUSE_MS);
  }
  const cible = analyserFormat(formatPrefere);
  const proche = (r) => {
    const f = analyserFormat(r.size);
    if (!cible || !f || f.base !== cible.base) return 2;
    return Math.abs(f.total - cible.total) / cible.total < 0.05 ? 0 : 1;
  };
  const nos = (r) => (MAGASINS_EC[r.store] ? 0 : 1);
  return res.map((r, i) => ({ r, i })).sort((a, b) => proche(a.r) - proche(b.r) || nos(a.r) - nos(b.r) || a.i - b.i).map((x) => x.r);
}

const AUTRES = { provigo: 'Provigo', walmart: 'Walmart' };
const nomMagasinEC = (s) => (MAGASINS_EC[s] ? nomBanniere(MAGASINS_EC[s]) : AUTRES[s] || s);
export const produit = (id) => appel({ endpoint: 'product', id });
export const historique = (id) => appel({ endpoint: 'history', id, limit: 300 });

/** Code-barres → produit épiceries.ca (essaie les variantes UPC/EAN). null si inconnu. */
export async function parCodeBarres(variantes) {
  for (const code of variantes) {
    try { return await appel({ endpoint: 'barcode', code }); } catch (e) { if (e.code !== 'not_found') return null; }
  }
  return null;
}

const prixTexte = (p) => `${Number(p).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/** unitPrice d'épiceries.ca → { pu, unite } dans nos unités ($/kg, $/L, $/unité). */
export function puDepuisEC(u) {
  if (!u || u.value == null) return null;
  if (u.unit === '100 g') return { pu: u.value * 10, unite: 'kg' };
  if (u.unit === '100 ml') return { pu: u.value * 10, unite: 'l' };
  if (u.unit === 'unité') return { pu: u.value, unite: 'unite' };
  return null;
}

// ---------------------------------------------------------------------
// Catégories épiceries.ca → nos rayons (seulement si le rayon n'a pas été choisi à la main)
// ---------------------------------------------------------------------
let categories = null;
async function nomCategorie(id) {
  if (!id) return null;
  if (!categories) {
    try { categories = JSON.parse(localStorage.getItem('ec-categories') || 'null'); } catch { categories = null; }
    if (!categories) {
      try {
        const d = await appel({ endpoint: 'categories' });
        categories = Object.fromEntries(d.categories.map((c) => [c.id, c.name]));
        try { localStorage.setItem('ec-categories', JSON.stringify(categories)); } catch { /* plein */ }
      } catch { categories = {}; }
    }
  }
  return categories[id] || null;
}

// Ordre important : « surgelés » avant tout (ex. « Viande et fruits de mer surgelés »).
// Couvre les 71 catégories d'épiceries.ca (liste lue le 2026-11-15).
const REGLES_RAYON = [
  [/surgel|crème glacée/i, 'Surgelés'],
  [/légume|legume|fruit(?!s de mer)|salade|fines herbes|noix/i, 'Fruits et légumes'],
  [/poulet|dinde|boeuf|bœuf|porc|jambon|bacon|saucisse|viande|poisson|fruits de mer|substituts de viande/i, 'Viandes et poissons'],
  [/biscuit|craquelin|croustille|chips|bonbon|chocolat/i, 'Collations et biscuits'],
  [/soins|hygi|beauté|bébé|bebe/i, 'Hygiène et pharmacie'],
  [/ménager|menager|détergent|detergent|lessive|vaisselle/i, "Produits d'entretien"],
  [/lait|crème|creme|oeuf|œuf|beurre|fromage|yogourt|^désserts|trempette/i, 'Produits laitiers et œufs'],
  [/pain|bagel|croissant|muffins anglais|tortilla|gâteau/i, 'Boulangerie'],
  [/céréale|cereale|déjeuner|dejeuner|miel|sirop|tartinade/i, 'Céréales et déjeuner'],
  [/\bjus\b|café|cafe|\bthés?\b|boisson|\beaux?\b|bière|\bvins?\b/i, 'Boissons'],
  [/pâte|nouille|riz|couscous|haricot|lentille|conserve|cuisson|mets|huile|vinaigre|condiment|sauce|épice|assaisonnement|soupe/i, 'Épicerie (conserves, pâtes, riz)'],
];
export function rayonPourCategorie(nom) {
  if (!nom) return null;
  const e = S.get();
  for (const [re, rayon] of REGLES_RAYON) {
    if (re.test(nom)) return e.rayons.find((r) => r.nom === rayon)?.id || null;
  }
  return null;
}

/** Prix régulier = dernier prix SANS rabais observé dans ce magasin (historique). */
async function prixReguliers(id) {
  const out = {};
  try {
    const h = await appel({ endpoint: 'history', id, limit: 60 });
    for (const p of h.history || []) if (!p.discounted) out[p.store] = p.price; // du plus ancien au plus récent
  } catch { /* pas d'historique */ }
  return out;
}

/** Remplace les prix épiceries.ca (et les prix de démo) d'un article par les prix actuels. */
export async function actualiserArticle(articleId, { force = false } = {}) {
  const a = S.get().articles.find((x) => x.id === articleId);
  if (!a?.liens?.length) return 0;
  if (!force && a.majPrix && Date.now() - new Date(a.majPrix).getTime() < DELAI_MAJ_MS) return 0;
  const nouveaux = [];
  let image = null, categorie = null;
  for (const lien of a.liens) {
    try {
      const d = await produit(lien.id);
      image ||= d.image;
      categorie ||= d.category;
      const enRabais = (d.prices || []).some((p) => p.discounted);
      const reguliers = enRabais ? (await pause(PAUSE_MS), await prixReguliers(d.id)) : {};
      for (const p of d.prices || []) {
        const ban = MAGASINS_EC[p.store];
        if (!ban) continue;
        nouveaux.push({ articleId, banniere: ban, offre: prixTexte(p.price), prixNum: p.price,
          prixRegulier: p.discounted ? reguliers[p.store] || null : null, format: p.size || d.size || null,
          type: p.discounted ? 'circulaire' : 'regulier', fin: null, source: 'epiceries_ca', observeLe: (p.date || '').slice(0, 10),
          lienId: d.id, nomProduit: [d.brand, d.name].filter(Boolean).join(' '), uniteSource: puDepuisEC(p.unitPrice), url: d.url, lienMarchand: p.link });
      }
    } catch { /* produit retiré ou réseau : on garde les anciens prix de ce lien */ }
    await pause(PAUSE_MS);
  }
  const rayonAuto = rayonPourCategorie(await nomCategorie(categorie));
  S.maj((e) => {
    const ar = e.articles.find((x) => x.id === articleId);
    if (!ar) return;
    const liensOk = new Set(nouveaux.map((n) => n.lienId));
    e.prix = e.prix.filter((p) => !(p.articleId === articleId && (p.source === 'demo' || (p.source === 'epiceries_ca' && liensOk.has(p.lienId)))));
    e.prix.push(...nouveaux);
    ar.majPrix = new Date().toISOString();
    if (image && !ar.imageUrl) ar.imageUrl = image;
    if (rayonAuto && !ar.rayonManuel) ar.rayonId = rayonAuto; // un rayon choisi à la main n'est jamais modifié
  });
  return nouveaux.length;
}

/** Au démarrage : met à jour, une à une, les fiches liées dont les prix ont plus de 12 h. */
export async function actualiserTout() {
  const ids = S.get().articles.filter((a) => a.liens?.length).map((a) => a.id);
  let n = 0;
  for (const id of ids) n += await actualiserArticle(id);
  if (n) toast(`Prix mis à jour (${n}) — source : épiceries.ca`);
}

// ---------------------------------------------------------------------
// Liaison : article générique ↔ un ou plusieurs produits réels
// ---------------------------------------------------------------------
/**
 * opts.auto : ouverte automatiquement après un ajout par texte → le résultat
 * le plus pertinent est présélectionné ; un toucher sur « Lier » suffit.
 */
export function ouvrirLiaison(articleId, apres, opts = {}) {
  const a = S.get().articles.find((x) => x.id === articleId);
  if (a.exclusif && !Object.values(MAGASINS_EC).includes(a.exclusif)) { // ex. Costco : pas couvert par épiceries.ca
    toast(`${a.nom} est vendu seulement chez ${nomBanniere(a.exclusif)} : pas de prix en ligne pour cette bannière.`);
    return;
  }
  ouvrirModale(`Vrais prix — ${a.nom}`, `
    <p class="doux">${opts.auto ? 'Voici les produits trouvés pour ta saisie. ' : ''}Coche le ou les produits qui correspondent (un par magasin si les marques diffèrent, ex. Natrel chez IGA, Québon chez Maxi). <span style="color:var(--vert)">Vert</span> = le moins cher au kg/L, <span style="color:var(--rouge)">rouge</span> = le plus cher. Source : épiceries.ca (Maxi, IGA, Super C, Metro).</p>
    <div class="rang"><input id="ecQ" class="grandir" value="${esc(a.nom)}${a.marque ? ' ' + esc(a.marque) : ''}"><button class="btn" id="ecGo">Chercher</button></div>
    <div id="ecRes" style="margin-top:10px"><p class="doux">Recherche…</p></div>
    <div class="rang" style="margin-top:8px"><button class="btn grandir" id="ecLier" disabled>Lier la sélection</button>${opts.auto ? '<button class="btn sec" id="ecPasser">Plus tard</button>' : ''}</div>`, (c) => {
    let resultats = [];
    const deja = new Set((a.liens || []).map((l) => l.id));
    const lancer = async (premier = false) => {
      $('#ecRes', c).innerHTML = '<p class="doux">Recherche…</p>';
      try {
        resultats = await rechercherSouple($('#ecQ', c).value.trim(), a.format);
        // Couleur par prix au kg / L / unité. Article sans format (saisie libre) : on compare
        // dans l'unité la plus fréquente parmi les résultats (souvent le kg ou le L).
        let base = a.format ? a.uniteRef : null;
        if (!base) {
          const n = { kg: 0, l: 0, unite: 0 };
          resultats.forEach((r) => { const f = analyserFormat(r.size); if (f) n[f.base]++; });
          base = Object.entries(n).sort((x, y) => y[1] - x[1])[0][1] ? Object.entries(n).sort((x, y) => y[1] - x[1])[0][0] : 'unite';
        }
        const pus = resultats.map((r) => {
          const n = normaliser(r.price, r.size, base);
          if (n.prixUnitaire != null) return n.prixUnitaire;
          const u = puDepuisEC(r.unitPrice);
          return u && u.unite === base ? u.pu : null;
        });
        const connus = pus.filter((x) => x != null);
        const min = Math.min(...connus), max = Math.max(...connus);
        const ref = base === 'kg' ? '$/kg' : base === 'l' ? '$/L' : '$/unité';
        $('#ecRes', c).innerHTML = resultats.length ? resultats.map((r, i) => {
          const pu = pus[i];
          const coul = pu == null || connus.length < 2 ? '' : pu <= min + 1e-9 ? 'vert' : pu >= max - 1e-9 ? 'rouge' : '';
          const coche = deja.has(r.id) || (premier && opts.auto && !deja.size && i === 0);
          return `<label class="item ${coul ? 'res-' + coul : ''}" style="cursor:pointer">
            <input type="checkbox" data-i="${i}" ${coche ? 'checked' : ''}>
            ${r.image ? `<img class="vignette" src="${esc(r.image)}" alt="">` : ''}
            <div class="grandir"><div class="nom" style="font-weight:500">${esc(r.name)}</div>
              <div class="info">${esc(r.brand || '')}${r.size ? ` · ${esc(formatLisible(r.size))}` : ''}</div>
              <div class="info">${MAGASINS_EC[r.store] ? puce(MAGASINS_EC[r.store]) : ''}moins cher : ${esc(nomMagasinEC(r.store))} ${argent(r.price)}${r.discounted ? ' · <span class="pastille ambre">rabais</span>' : ''}</div></div>
            ${pu != null ? `<div class="pu-res ${coul}">${pu.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br><span class="doux">${ref}</span></div>` : ''}
          </label>`;
        }).join('') : '<p class="doux">Aucun résultat. Essaie un mot plus simple (ex. « beurre » au lieu de « beurre salé 454 g »).</p>';
        $('#ecLier', c).disabled = !resultats.length;
      } catch {
        $('#ecRes', c).innerHTML = '<p class="doux">épiceries.ca ne répond pas (hors ligne ?). Réessaie plus tard.</p>';
      }
    };
    $('#ecGo', c).onclick = () => lancer();
    $('#ecQ', c).onkeydown = (ev) => { if (ev.key === 'Enter') lancer(); };
    $('#ecPasser', c)?.addEventListener('click', () => { fermerModale(); });
    $('#ecLier', c).onclick = async () => {
      const choisis = $$('[data-i]', c).filter((x) => x.checked).map((x) => resultats[Number(x.dataset.i)]);
      const gardes = (a.liens || []).filter((l) => !resultats.some((r) => r.id === l.id)); // liens hors de cette recherche
      S.maj((e) => {
        const ar = e.articles.find((x) => x.id === articleId);
        ar.liens = [...gardes, ...choisis.map((r) => ({ id: r.id, nom: [r.brand, r.name].filter(Boolean).join(' '), size: r.size, image: r.image }))];
        e.prix = e.prix.filter((p) => !(p.articleId === articleId && p.source === 'epiceries_ca' && !ar.liens.some((l) => l.id === p.lienId)));
        if (!ar.imageUrl && choisis[0]?.image) ar.imageUrl = choisis[0].image;
        if (!ar.format && choisis[0]?.size) { ar.format = formatLisible(choisis[0].size); const f = analyserFormat(choisis[0].size); if (f) ar.uniteRef = f.base; }
      });
      $('#ecLier', c).disabled = true; $('#ecLier', c).textContent = 'Récupération des prix…';
      const n = await actualiserArticle(articleId, { force: true });
      toast(n ? `${n} prix récupérés` : 'Aucun prix dans tes bannières pour ces produits');
      if (apres) apres(); else fermerModale();
    };
    lancer(true);
  });
}

// ---------------------------------------------------------------------
// Historique des prix (graphique SVG, prix ramenés à l'unité de l'article)
// ---------------------------------------------------------------------
const COULEURS = { iga: '#d6001c', super_c: '#f08c00', metro: '#1c5fd6', maxi: '#c9a800', costco: '#005daa', jean_coutu: '#6a3fb5' };

export async function afficherHistorique(article, zone) {
  zone.innerHTML = '<p class="doux">Chargement de l\'historique…</p>';
  const points = [];
  // Relevés gardés dans l'app (photo, saisie, reçus)
  for (const p of S.get().prix.filter((x) => x.articleId === article.id && x.observeLe && x.source !== 'epiceries_ca' && x.source !== 'demo')) {
    const n = normaliser(p.offre, p.format || article.format, article.uniteRef);
    if (n.prixUnitaire != null) points.push({ ban: p.banniere, t: new Date(p.observeLe).getTime(), pu: n.prixUnitaire, rabais: p.type !== 'regulier', src: p.source });
  }
  // Historique épiceries.ca
  for (const lien of article.liens || []) {
    try {
      const h = await historique(lien.id);
      for (const p of h.history || []) {
        const ban = MAGASINS_EC[p.store];
        if (!ban) continue;
        let pu = normaliser(p.price, p.size || lien.size || article.format, article.uniteRef).prixUnitaire;
        if (pu == null) { const u = puDepuisEC(p.unitPrice); if (u && u.unite === article.uniteRef) pu = u.pu; }
        if (pu != null) points.push({ ban, t: p.timestamp * 1000, pu, rabais: p.discounted, src: 'epiceries_ca', lien: lien.id });
      }
    } catch { /* ignoré */ }
    await pause(PAUSE_MS);
  }
  if (!points.length) {
    zone.innerHTML = `<p class="doux">Pas encore d'historique. ${article.liens?.length ? '' : 'Lie ce produit à épiceries.ca (bouton « Trouver les vrais prix ») pour voir des mois d\'historique, ou ajoute des prix vus en magasin.'}</p>`;
    return;
  }
  points.sort((a, b) => a.t - b.t);
  const unite = article.uniteRef === 'kg' ? '$/kg' : article.uniteRef === 'l' ? '$/L' : '$/unité';
  // Plusieurs produits liés dans un même magasin (ex. Natrel et Purefilter chez Maxi) :
  // chaque jour, on garde le meilleur prix ; « actuel » = meilleur des derniers prix de chaque produit.
  const parBan = {}, dernierParProduit = {};
  for (const p of points) {
    const jour = new Date(p.t).toISOString().slice(0, 10);
    const serie = (parBan[p.ban] ??= new Map());
    const ex = serie.get(jour);
    if (!ex || p.pu < ex.pu) serie.set(jour, { ...p, t: new Date(jour).getTime() });
    dernierParProduit[`${p.ban}|${p.lien || p.src}`] = p.pu;
  }
  for (const ban of Object.keys(parBan)) parBan[ban] = [...parBan[ban].values()].sort((a, b) => a.t - b.t);
  const actuel = (ban) => Math.min(...Object.entries(dernierParProduit).filter(([k]) => k.startsWith(ban + '|')).map(([, v]) => v));

  // Graphique
  const W = 340, H = 170, G = 38, B = 22;
  const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const vals = Object.values(parBan).flat().map((p) => p.pu); const vmin = Math.min(...vals), vmax = Math.max(...vals);
  const pad = (vmax - vmin) * 0.1 || vmax * 0.1 || 1;
  const lo = vmin - pad, hi = vmax + pad;
  const x = (t) => G + (t1 === t0 ? (W - G) / 2 : ((t - t0) / (t1 - t0)) * (W - G - 6));
  const y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - B - 6);
  const f = (v) => v.toLocaleString('fr-CA', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const date = (t) => new Date(t).toLocaleDateString('fr-CA', { month: 'short', year: '2-digit' });
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Historique des prix" style="font-size:10px">
    <line x1="${G}" y1="${H - B}" x2="${W}" y2="${H - B}" stroke="currentColor" opacity=".2"/>
    <text x="0" y="${y(hi - pad) + 3}" fill="currentColor" opacity=".7">${f(vmax)}</text>
    <text x="0" y="${y(lo + pad) + 3}" fill="currentColor" opacity=".7">${f(vmin)}</text>
    <text x="${G}" y="${H - 6}" fill="currentColor" opacity=".7">${date(t0)}</text>
    <text x="${W}" y="${H - 6}" fill="currentColor" opacity=".7" text-anchor="end">${date(t1)}</text>`;
  for (const [ban, ps] of Object.entries(parBan)) {
    const c = COULEURS[ban] || '#888';
    svg += `<polyline fill="none" stroke="${c}" stroke-width="2" points="${ps.map((p) => `${x(p.t).toFixed(1)},${y(p.pu).toFixed(1)}`).join(' ')}"/>`;
    svg += ps.filter((p) => p.rabais).map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.pu).toFixed(1)}" r="3" fill="${c}"><title>${nomBanniere(ban)} ${f(p.pu)} ${unite} (rabais)</title></circle>`).join('');
  }
  svg += '</svg>';

  // Résumé par bannière
  const lignes = Object.entries(parBan).map(([ban, ps]) => {
    const v = ps.map((p) => p.pu); const der = actuel(ban);
    const min = Math.min(...v), max = Math.max(...v);
    const verdict = ps.length >= 3 && der <= min + 1e-9 ? '<span class="pastille vert">prix plancher</span>'
      : ps.length >= 3 && der >= max - 1e-9 && max > min ? '<span class="pastille rouge">au plus haut</span>' : '';
    return `<tr><td>${puce(ban)}${esc(nomBanniere(ban))} <span class="doux">(${ps.length})</span></td><td>${f(der)}</td><td>${f(min)}</td><td>${f(max)}</td><td>${verdict}</td></tr>`;
  }).join('');
  zone.innerHTML = `${svg}
    <div class="doux" style="margin:2px 0 6px">${Object.keys(parBan).map((b) => `<span style="color:${COULEURS[b] || '#888'}">■</span> ${esc(nomBanniere(b))}`).join(' · ')} · points = rabais</div>
    <table class="comp"><tr class="doux"><td>${unite}</td><td>Actuel</td><td>Min</td><td>Max</td><td></td></tr>${lignes}</table>
    <p class="doux">Source : épiceries.ca et tes relevés. « Prix plancher » = le plus bas observé (au moins 3 relevés) — un indice, pas une garantie.</p>`;
}
