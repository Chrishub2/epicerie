// =====================================================================
// Reçus : vérification (complet ? lisible ?), aperçu du reçu entier,
// rapprochement avec la liste d'épicerie et compléments en ligne.
//
// Règles du projet : les reçus et les prix observés sont en AJOUT seulement ;
// rien n'est inventé (une ligne non reconnue reste « non reliée »).
// =====================================================================
import * as S from './store.js';
import { esc, argent, nomBanniere, offresArticle } from './ui.js';
import { gtinVariantes, chiffreControle, analyserFormat, formatLisible, normaliser } from './normalise.js';

const TOLERANCE = 0.02; // $ : en deçà, c'est le bon prix

/**
 * Prix affiché dans l'app AVANT l'achat (on ignore les prix venant des reçus) :
 * celui de la bannière du reçu si on l'a, sinon le meilleur ailleurs.
 */
function prixAttendu(a, banniere) {
  const offres = offresArticle(a).filter((o) => o.source !== 'recu' && !o.perso && o.pu != null);
  const ici = offres.filter((o) => o.banniere === banniere).sort((x, y) => x.pu - y.pu)[0];
  const o = ici || offres[0];
  return o ? { pu: o.pu, uniteRef: o.uniteRef, prixArticle: o.prixArticle, banniere: o.banniere, offre: o.offre, type: o.type,
    fin: o.fin || null, source: o.source, observeLe: o.observeLe || null, ailleurs: !ici } : null;
}

/** « Prix affichés dans l'app » envoyés à l'IA pour qu'elle explique les écarts. */
export function attendusListe() {
  const e = S.get();
  const vus = new Set();
  return e.liste.flatMap((l) => {
    const a = e.articles.find((x) => x.id === l.articleId);
    if (!a || vus.has(a.id)) return [];
    vus.add(a.id);
    const parBanniere = {};
    offresArticle(a).filter((o) => o.source !== 'recu' && !o.perso && o.pu != null)
      .forEach((o) => { if (!parBanniere[o.banniere] || o.pu < parBanniere[o.banniere].pu) parBanniere[o.banniere] = o; });
    const t = Object.values(parBanniere).map((o) => `${nomBanniere(o.banniere)} ${o.offre}${o.format ? ` (${o.format})` : ''}${o.type === 'circulaire' ? ` rabais${o.fin ? ` jusqu'au ${o.fin}` : ''}` : ''}`);
    return t.length ? [`${a.nom}${a.format ? ` [${a.format}]` : ''} : ${t.join(' ; ')}`.slice(0, 200)] : [];
  });
}

/** Compare le prix payé (ligne de reçu) au prix affiché ; explique l'écart avec des règles simples + l'IA. */
function comparerPrix(l, ar, att, r) {
  const offre = offreLigne(l);
  const date = r.date || r.cree.slice(0, 10);
  const base = { recuId: r.id, date, banniere: r.banniere, offrePayee: offre, explicationIA: l.explicationPrix || null };
  if (!offre) return { ...base, statut: 'inconnu' };
  const np = normaliser(offre, ar.format, ar.uniteRef);
  let paye = null, attendu = null, unite = '';
  if (att && l.poids && np.prixUnitaire != null) {           // produit pesé : on compare au kg
    paye = np.prixUnitaire; attendu = att.pu; unite = att.uniteRef === 'kg' ? '/kg' : att.uniteRef === 'l' ? '/L' : '';
  } else if (att && att.prixArticle != null) {               // à l'unité : prix d'un article
    paye = ((Number(l.prix) || 0) - (Number(l.rabais) || 0)) / (Number(l.quantite) || 1); attendu = att.prixArticle;
  } else if (att && np.prixUnitaire != null) {               // sinon : au kg / L / unité
    paye = np.prixUnitaire; attendu = att.pu; unite = att.uniteRef === 'kg' ? '/kg' : att.uniteRef === 'l' ? '/L' : '/unité';
  }
  if (paye == null) {
    const p = ((Number(l.prix) || 0) - (Number(l.rabais) || 0)) / (Number(l.quantite) || 1);
    return { ...base, statut: 'inconnu', paye: p, explication: ['Aucun prix n\'était affiché dans l\'app pour comparer.'] };
  }
  const ecart = paye - attendu;
  const statut = Math.abs(ecart) <= TOLERANCE ? 'ok' : ecart < 0 ? 'moins' : 'plus';
  const raisons = [];
  if (statut !== 'ok') {
    if (att.ailleurs) raisons.push(`Le prix affiché vient de ${nomBanniere(att.banniere)}, pas de ${nomBanniere(r.banniere)}.`);
    if (att.type === 'circulaire' && att.fin && att.fin < date) raisons.push(`Le rabais affiché se terminait le ${att.fin}.`);
    else if (att.type === 'circulaire' && statut === 'plus') raisons.push('Le prix affiché était un prix en rabais : il n\'a peut-être pas été appliqué à la caisse.');
    const fL = analyserFormat(l.format), fA = analyserFormat(ar.format);
    if (fL && fA && fL.base === fA.base && Math.abs(fL.total - fA.total) / fA.total > 0.05) raisons.push(`Format sur la facture (${formatLisible(l.format)}) différent de ta fiche (${formatLisible(ar.format)}).`);
    if (l.rabais) raisons.push(`Un rabais de ${argent(l.rabais)} a été appliqué à la caisse.`);
    if (att.source === 'epiceries_ca') raisons.push('Le prix affiché vient d\'épiceries.ca (en ligne) : il peut différer de ta succursale.');
    if (att.source === 'demo') raisons.push('Le prix affiché était un prix de démonstration.');
    if (statut === 'plus' && !att.ailleurs) raisons.push('Si le prix à la caisse dépasse le prix affiché en magasin, la Politique d\'exactitude des prix s\'applique : article gratuit jusqu\'à 15 $, sinon 15 $ de rabais. Garde ton reçu.');
  }
  return { ...base, statut, paye, attendu, ecart, unite, offreAffichee: att.offre, banniereAffichee: att.banniere, explication: raisons };
}

const ECART_MAX = 0.10; // $ d'écart toléré entre la somme des lignes et le sous-total

/** Noms des articles à acheter (envoyés à l'IA pour relier les lignes du reçu). */
export function nomsListe() {
  const e = S.get();
  return [...new Set(e.liste.map((l) => e.articles.find((a) => a.id === l.articleId)?.nom).filter(Boolean))];
}

/**
 * Verdict sur un reçu lu : { ok, problemes[], resume }.
 * Combine l'avis de l'IA et des contrôles chiffrés (somme des lignes vs sous-total).
 */
export function verifierRecu(r) {
  const problemes = [];
  if (r.source !== 'ia') {
    return { ok: false, incertain: true, problemes: ['Lecture approximative sur le téléphone (IA non connectée) : je ne peux pas confirmer que le reçu est complet.'], resume: '' };
  }
  const v = r.verification || {};
  if (v.complet === false) problemes.push(...(v.problemes?.length ? v.problemes : ['Le reçu semble incomplet.']));
  else if (v.problemes?.length) problemes.push(...v.problemes);
  if (v.lisible === false && !problemes.length) problemes.push('Certaines lignes sont illisibles.');
  const lignes = r.lignes || [];
  if (!lignes.length) problemes.push('Aucun produit lu.');
  if (r.total == null) problemes.push('Le total n\'est pas visible : il manque probablement le bas du reçu.');
  const somme = lignes.reduce((s, l) => s + (Number(l.prix) || 0), 0);
  const rabais = lignes.reduce((s, l) => s + (Number(l.rabais) || 0), 0);
  let concorde = null;
  if (r.sousTotal != null && lignes.length) {
    concorde = Math.abs(somme - r.sousTotal) <= ECART_MAX || Math.abs(somme - rabais - r.sousTotal) <= ECART_MAX;
    if (!concorde) problemes.push(`La somme des produits lus (${argent(somme - rabais)}) ne correspond pas au sous-total imprimé (${argent(r.sousTotal)}) : une section manque ou une ligne est mal lue.`);
  }
  const nbQte = lignes.reduce((s, l) => s + (l.poids ? 1 : Number(l.quantite) || 1), 0);
  const ok = !problemes.length && v.complet !== false && v.lisible !== false;
  const resume = `${lignes.length} produit(s) lu(s)${r.nombreArticles != null ? ` (le reçu en annonce ${r.nombreArticles}${Math.round(nbQte) !== r.nombreArticles ? ` ; j'en compte ${Math.round(nbQte)} avec les quantités` : ''})` : ''}`
    + `${r.total != null ? ` · total ${argent(r.total)}` : ''}${concorde ? ' · la somme des lignes concorde avec le sous-total' : ''}.`;
  return { ok, problemes: [...new Set(problemes)], resume };
}

/** Affiche les sections l'une sous l'autre (le reçu entier) dans conteneur. */
export async function apercuEntier(sources, conteneur) {
  conteneur.innerHTML = '';
  conteneur.className = 'recu-entier';
  for (const [i, s] of sources.entries()) {
    const blob = s instanceof Blob ? s : await S.lirePhoto(s);
    if (!blob) continue;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = `Section ${i + 1}`;
    conteneur.appendChild(img);
  }
}

/** Variantes d'un code imprimé sur un reçu (souvent sans chiffre de contrôle). */
function variantesRecu(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length < 6) return [];
  const v = new Set(gtinVariantes(c));
  if (c.length === 11 || c.length === 12) gtinVariantes(c + chiffreControle(c)).forEach((x) => v.add(x));
  return [...v];
}

const simple = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Article dont le nom ressemble au texte d'une ligne de reçu (abréviations : « BEUR SAL » ≈ « Beurre salé »).
 * Chaque mot (3+ lettres) de l'article doit commencer comme un mot de la ligne, ou l'inverse.
 * Articles de la liste d'abord ; le reste du catalogue seulement si tous les mots concordent.
 */
function parNom(texte, e) {
  const mots = (s) => simple(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((m) => m.length >= 3);
  const ligne = mots(texte);
  if (!ligne.length) return null;
  const pareil = (m) => ligne.some((t) => (t.length >= 3 && m.startsWith(t)) || t.startsWith(m));
  const score = (a) => { const ms = mots(a.nom); return ms.length ? ms.filter(pareil).length / ms.length : 0; };
  const surListe = new Set(e.liste.map((l) => l.articleId));
  let meilleur = null, max = 0;
  for (const a of e.articles) {
    const s = score(a);
    const seuil = surListe.has(a.id) ? 0.6 : 1;
    if (s >= seuil && s + (surListe.has(a.id) ? 0.01 : 0) > max) { max = s + (surListe.has(a.id) ? 0.01 : 0); meilleur = a; }
  }
  return meilleur;
}

/** Relit un reçu enregistré avec l'IA (nouvelle lecture : codes, liens avec la liste, vérification). */
export async function relireRecu(recuId) {
  const { lireRecu, iaDisponible } = await import('./ocr.js');
  if (!iaDisponible()) throw new Error('IA indisponible : connecte-toi à ton foyer (Plus → Mon foyer) et au réseau.');
  const r = (S.get().recus || []).find((x) => x.id === recuId);
  const blobs = [];
  for (const id of r?.photoIds || [r?.photoId]) { const b = id && await S.lirePhoto(id); if (b) blobs.push(b); }
  if (!blobs.length) throw new Error('Photos du reçu introuvables sur ce téléphone.');
  const lu = await lireRecu(blobs, undefined, nomsListe(), attendusListe());
  if (lu.source !== 'ia') throw new Error('La lecture par l\'IA a échoué. Réessaie dans un instant.');
  S.maj((x) => { const rc = x.recus.find((y) => y.id === recuId); if (rc) { Object.assign(rc, lu, { statut: 'lu', relu: new Date().toISOString() }); delete rc.applique; delete rc.bilan; } });
  return lu;
}

/** Prix d'une ligne en texte d'offre (« 4,99 $ » ou « 4,39 $/kg »). */
function offreLigne(l) {
  const m = /([\d]+[.,]\d{2})\s*\$?\s*\/\s*(kg|lb)/i.exec(l.poids || '');
  if (m) return `${m[1].replace('.', ',')} $/${m[2].toLowerCase()}`;
  const net = (Number(l.prix) || 0) - (Number(l.rabais) || 0);
  const q = Number(l.quantite) || 1;
  if (net <= 0) return null;
  return `${(net / q).toFixed(2).replace('.', ',')} $`;
}

/**
 * Relie chaque ligne du reçu à un article (liste puis code-barres), enregistre le prix payé,
 * coche l'article acheté et complète les fiches (code, marque, format, photo) par une recherche en ligne.
 * etat(msg) suit l'avancement. Retourne un bilan.
 */
export async function appliquerRecu(recuId, etat = () => {}) {
  const e = S.get();
  const r = (e.recus || []).find((x) => x.id === recuId);
  if (!r || (r.applique && r.bilan?.relies)) return null; // déjà appliqué avec succès
  const mag = e.magasins.find((m) => m.banniere === r.banniere && r.magasin && simple(r.magasin).includes(simple(m.nom).split(' ').pop()))
    || e.magasins.find((m) => m.banniere === r.banniere);
  const date = r.date || r.cree.slice(0, 10);
  const bilan = { relies: 0, coches: 0, prix: 0, completes: 0, nonRelies: 0, bonPrix: 0, ecarts: 0 };
  const lignesListe = new Set(e.liste.map((x) => x.id)); // articles de la liste au moment du reçu
  const relies = new Set();
  const { infosCode } = await import('./scan.js');

  for (const [i, l] of (r.lignes || []).entries()) {
    etat(`Produit ${i + 1}/${r.lignes.length}…`);
    const codes = variantesRecu(l.code);
    const etatNow = S.get();
    // ① par le nom de la liste (relié par l'IA), ② par code-barres dans tout le catalogue
    let a = l.articleListe && etatNow.articles.find((x) => simple(x.nom) === simple(l.articleListe)
      && etatNow.liste.some((li) => li.articleId === x.id));
    if (!a && codes.length) a = etatNow.articles.find((x) => x.codes?.some((c) => codes.includes(c)));
    // ③ secours : par ressemblance de nom (reçu lu sans IA, ou ancienne lecture)
    if (!a) a = parNom(`${l.nomClair || ''} ${l.libelle || ''}`, etatNow);
    // Recherche en ligne : complète la fiche reliée ou documente la ligne non reliée
    let info = null;
    const manque = a && (!a.imageUrl || !a.format || !a.marque);
    if (codes.length && (manque || !a) && navigator.onLine) {
      try { info = await infosCode(codes[0]); } catch { info = null; }
    }
    if (!a) {
      bilan.nonRelies++;
      S.maj((x) => {
        const ln = x.recus.find((y) => y.id === recuId)?.lignes?.[i];
        if (ln && info) Object.assign(ln, { nomEnLigne: info.nom || null, imageUrl: info.image || null, formatEnLigne: info.format || null });
      });
      continue;
    }
    bilan.relies++;
    relies.add(a.id);
    const offre = offreLigne(l);
    const verdict = comparerPrix(l, S.get().articles.find((y) => y.id === a.id) || a, prixAttendu(a, r.banniere), r); // avant d'ajouter le prix payé
    if (verdict.statut === 'ok' || verdict.statut === 'moins') bilan.bonPrix++;
    if (verdict.statut === 'plus') bilan.ecarts++;
    let coche = false, complete = false;
    S.maj((x) => {
      const ar = x.articles.find((y) => y.id === a.id);
      if (!ar) return;
      if (codes.length) ar.codes = [...new Set([...(ar.codes || []), ...codes])];
      const fmt = l.format || info?.format;
      if (!ar.format && fmt) { ar.format = formatLisible(fmt) || fmt; const f = analyserFormat(ar.format); if (f) ar.uniteRef = f.base; complete = true; }
      if (!ar.marque && (l.marque || info?.marque)) { ar.marque = l.marque || info.marque; complete = true; }
      if (!ar.imageUrl && info?.image) { ar.imageUrl = info.image; complete = true; }
      if (info?.ecp && !(ar.liens || []).some((k) => k.id === info.ec.id)) {
        ar.liens = [...(ar.liens || []), { id: info.ec.id, nom: [info.ecp.brand, info.ecp.name].filter(Boolean).join(' '), size: info.ecp.size, image: info.ecp.image }];
      }
      if (offre && r.banniere && !x.prix.some((p) => p.recuId === recuId && p.articleId === ar.id)) {
        x.prix.push({ id: S.uid('p'), articleId: ar.id, banniere: r.banniere, magasinId: mag?.id, offre, format: ar.format,
          type: l.rabais ? 'circulaire' : 'regulier', fin: null, source: 'recu', recuId, observeLe: date });
      }
      const li = x.liste.find((y) => y.articleId === ar.id && !y.coche);
      if (li) { li.coche = true; li.cocheLe = new Date().toISOString(); coche = true; }
      x.liste.filter((y) => y.articleId === ar.id && lignesListe.has(y.id)).forEach((y) => { y.recu = verdict; });
      ar.dernierAchat = verdict;
      const ln = x.recus.find((y) => y.id === recuId)?.lignes?.[i];
      if (ln) ln.articleId = ar.id;
    });
    if (offre && r.banniere) bilan.prix++;
    if (coche) bilan.coches++;
    if (complete) bilan.completes++;
  }
  // Articles de la liste absents de cette facture (sans effacer un achat confirmé par une autre facture)
  S.maj((x) => {
    x.liste.filter((y) => lignesListe.has(y.id) && !relies.has(y.articleId) && (!y.recu || y.recu.absent))
      .forEach((y) => { y.recu = { recuId, date, banniere: r.banniere, absent: true }; });
  });
  S.maj((x) => { const rc = x.recus.find((y) => y.id === recuId); if (rc) { rc.applique = new Date().toISOString(); rc.bilan = bilan; } });
  return bilan;
}

/** Articles reliés à ce reçu sans photo ou sans lien avec les bannières : [{ articleId, q, libelle }]. */
export async function aCompleter(recuId) {
  const { MAGASINS_EC } = await import('./epiceries.js');
  const e = S.get();
  const r = (e.recus || []).find((x) => x.id === recuId);
  const vus = new Set();
  return (r?.lignes || []).flatMap((l) => {
    const a = l.articleId && e.articles.find((x) => x.id === l.articleId);
    if (!a || vus.has(a.id)) return [];
    vus.add(a.id);
    if (a.exclusif && !Object.values(MAGASINS_EC).includes(a.exclusif)) return []; // ex. Costco : pas couvert
    if (a.imageUrl && a.liens?.length) return [];
    const marque = l.marque || a.marque;
    return [{ articleId: a.id, q: marque ? `${marque} ${a.nom}` : a.nom, essais: [marque && `${marque} ${a.nom}`, a.nom, l.nomClair], libelle: a.nom }];
  });
}

/**
 * Pour chaque article à compléter, ouvre la recherche par nom chez les bannières (épiceries.ca).
 * Rien n'est lié sans ton toucher sur « Lier la sélection » ; « Plus tard » passe au suivant.
 */
export async function completerFiches(recuId, fin) {
  const { ouvrirLiaison } = await import('./epiceries.js');
  const file = await aCompleter(recuId);
  let i = 0;
  const suivant = () => {
    const x = file[i++];
    if (!x) { fin?.(); return; }
    ouvrirLiaison(x.articleId, suivant, { auto: true, sansCoche: true, q: x.q, essais: x.essais, etape: `Fiche ${i}/${file.length} — ${x.libelle} : touche le bon produit, puis « Lier la sélection »`, passer: suivant });
  };
  suivant();
  return file.length;
}

export const texteBilan = (b) => b ? `${b.relies} produit(s) relié(s) à ton catalogue · ${b.coches} coché(s) sur la liste · ${b.prix} prix payé(s) enregistré(s)${b.bonPrix != null ? ` · ${b.bonPrix} au bon prix` : ''}${b.ecarts ? ` · ⚠️ ${b.ecarts} payé(s) plus cher` : ''} · ${b.completes} fiche(s) complétée(s)${b.nonRelies ? ` · ${b.nonRelies} non relié(s)` : ''}` : '';

const dateCourte = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) : '');

/** Ligne du haut de l'encadré de la liste : « payé le bon prix ? » selon la facture. */
export function htmlVerdictListe(v) {
  if (!v) return '';
  const ou = `${v.banniere ? nomBanniere(v.banniere) + ', ' : ''}${dateCourte(v.date)}`;
  if (v.absent) return `<div class="item-recu doux">🧾 Pas sur la facture (${esc(ou)})</div>`;
  const p = (x) => `${argent(x)}${v.unite || ''}`;
  if (v.statut === 'ok') return `<div class="item-recu ok">🧾 ✓ Bon prix selon la facture : ${p(v.paye)} (${esc(ou)})</div>`;
  if (v.statut === 'moins') return `<div class="item-recu ok">🧾 ✓ Payé moins cher : ${p(v.paye)} au lieu de ${p(v.attendu)} (${esc(ou)})</div>`;
  if (v.statut === 'plus') return `<div class="item-recu ecart">🧾 ⚠️ Payé ${p(v.paye)} au lieu de ${p(v.attendu)} (+${argent(v.ecart)}) — touche pour comprendre</div>`;
  return `<div class="item-recu doux">🧾 Payé ${v.paye != null ? argent(v.paye) : esc(v.offrePayee || '?')} (${esc(ou)}) — aucun prix affiché pour comparer</div>`;
}

/** Bloc de la fiche produit : détail du dernier achat et explication de l'écart. */
export function htmlDernierAchat(v) {
  if (!v || v.absent) return '';
  const p = (x) => `${argent(x)}${v.unite || ''}`;
  const titre = v.statut === 'plus' ? '⚠️ Payé plus cher que le prix affiché' : v.statut === 'inconnu' ? '🧾 Dernier achat' : '✓ Payé le bon prix';
  return `<div class="carte" style="margin:0 0 10px;${v.statut === 'plus' ? 'border-color:var(--rouge)' : ''}">
    <b>${titre}</b>
    <table class="comp" style="margin-top:6px">
      <tr><td class="doux">Facture</td><td>${v.banniere ? esc(nomBanniere(v.banniere)) + ' · ' : ''}${esc(dateCourte(v.date))}</td></tr>
      <tr><td class="doux">Payé</td><td><b>${v.paye != null ? p(v.paye) : esc(v.offrePayee || '?')}</b></td></tr>
      ${v.attendu != null ? `<tr><td class="doux">Affiché dans l'app</td><td>${p(v.attendu)}${v.banniereAffichee ? ` (${esc(nomBanniere(v.banniereAffichee))}${v.offreAffichee ? ` · ${esc(v.offreAffichee)}` : ''})` : ''}</td></tr>` : ''}
      ${v.ecart != null && v.statut !== 'ok' ? `<tr><td class="doux">Écart</td><td>${v.ecart > 0 ? '+' : '−'}${argent(Math.abs(v.ecart))}</td></tr>` : ''}
    </table>
    ${v.explicationIA ? `<p style="margin:6px 0 0">🤖 <b>Explication (IA, d'après la facture)</b> : ${esc(v.explicationIA)}</p>` : ''}
    ${v.explication?.length ? `<ul style="margin:6px 0 0;padding-left:18px">${v.explication.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${v.statut === 'plus' && !v.explicationIA && !v.explication?.length ? '<p class="doux" style="margin:6px 0 0">Aucune explication évidente sur la facture : vérifie l\'étiquette en magasin.</p>' : ''}
  </div>`;
}

/** Détail complet d'un reçu (en-tête, lignes, totaux, paiement, fidélité, autres infos). */
export function htmlDetail(r) {
  const e = S.get();
  const champ = (lib, val) => (val != null && val !== '' ? `<tr><td class="doux">${esc(lib)}</td><td>${esc(String(val))}</td></tr>` : '');
  const v = r.statut === 'lu' ? verifierRecu(r) : null;
  const verdict = !v ? '<div class="alerte">⏳ Pas encore lu (en attente du réseau).</div>'
    : v.ok ? `<div class="alerte vert">✅ Reçu complet et bien lu — ${esc(v.resume)}</div>`
    : `<div class="alerte">⚠️ À vérifier : ${v.problemes.map(esc).join(' ')}${v.resume ? `<br><span class="doux">${esc(v.resume)}</span>` : ''}</div>`;
  const lignes = (r.lignes || []).map((l) => {
    const a = l.articleId && e.articles.find((x) => x.id === l.articleId);
    const nom = l.nomClair || l.nomEnLigne || l.libelle;
    return `<tr><td>${a ? '✓ ' : ''}<b>${esc(nom)}</b>${a && simple(a.nom) !== simple(nom) ? ` <span class="doux">→ ${esc(a.nom)}</span>` : ''}
        <div class="doux" style="font-size:12px">${esc(l.libelle)}${l.code ? ` · code ${esc(l.code)}` : ''}${l.marque ? ` · ${esc(l.marque)}` : ''}${l.format || l.formatEnLigne ? ` · ${esc(l.format || l.formatEnLigne)}` : ''}${l.quantite > 1 ? ` · qté ${l.quantite}` : ''}${l.poids ? ` · ${esc(l.poids)}` : ''}${l.taxable ? ` · taxe ${esc(l.taxable)}` : ''}</div></td>
      <td class="pu">${argent(l.prix)}${l.rabais ? `<div style="color:var(--vert);font-size:12px">−${argent(l.rabais)}</div>` : ''}</td></tr>`;
  }).join('');
  return `${verdict}
    ${r.bilan ? `<p class="doux">${esc(texteBilan(r.bilan))}</p>` : ''}
    <details id="rcEntierBloc"><summary><b>Reçu entier (photos)</b></summary><div id="rcEntier"></div></details>
    <h3>Magasin</h3><table class="comp">${champ('Bannière', r.banniere && nomBanniere(r.banniere))}${champ('Succursale', r.magasin)}${champ('Adresse', r.adresse)}${champ('Téléphone', r.telephone)}
      ${champ('Date', r.date)}${champ('Heure', r.heure)}${champ('Caisse', r.caisse)}${champ('Caissier', r.caissier)}${champ('Transaction', r.transaction)}</table>
    <h3>Produits (${(r.lignes || []).length})</h3>
    <table class="comp">${lignes || '<tr><td class="doux">Aucune ligne reconnue.</td></tr>'}</table>
    <h3>Totaux</h3><table class="comp">${champ('Nombre d\'articles', r.nombreArticles)}${champ('Sous-total', r.sousTotal != null ? argent(r.sousTotal) : null)}
      ${champ('TPS', r.tps != null ? argent(r.tps) : null)}${champ('TVQ', r.tvq != null ? argent(r.tvq) : null)}
      ${r.total != null ? `<tr><td><b>Total</b></td><td><b>${argent(r.total)}</b></td></tr>` : ''}${champ('Économies', r.economies != null ? argent(r.economies) : null)}</table>
    <h3>Paiement et fidélité</h3><table class="comp">${champ('Paiement', r.modePaiement)}${champ('Programme', r.programmeFidelite)}
      ${champ('Points gagnés', r.pointsGagnes)}${champ('Solde de points', r.soldePoints)}</table>
    ${r.autres?.length ? `<h3>Autres informations</h3><table class="comp">${r.autres.map((x) => champ(x.libelle, x.valeur)).join('')}</table>` : ''}
    ${r.texte ? `<details style="margin-top:8px"><summary class="doux">Texte lu</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(r.texte)}</pre></details>` : ''}`;
}
