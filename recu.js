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
import * as P from './produits.js';
import { BANNIERES } from './demo-data.js';
import { analyserPlu, infosPlu } from './plu.js';
import { enfantsGenerique } from './arbre-recherche.js';
import { familleDe } from './visuels.js';

/** Une ligne de liste couvre-t-elle cette fiche ? La sienne, ou une ligne générique (niveau 1 ou 2, v117) dont elle est une fiche dessous. */
function ligneCouvre(etat, ligne, articleId) {
  if (ligne.articleId === articleId) return true;
  const g = etat.articles.find((a) => a.id === ligne.articleId);
  return !!g?.estGenerique && enfantsGenerique(g, etat.articles, familleDe).some((a) => a.id === articleId);
}
/**
 * Deux notes d'une ligne du reçu (demande de Chris, 25 nov. 2026) :
 * fiche = la fiche produit reliée (ou null) ; liste = 'coche' (article de ta liste coché par ce reçu),
 * 'achete' (article de ta liste déjà retiré comme acheté chez cette bannière, à ±1 jour), 'non' (pas sur ta liste).
 */
export function notesLigne(etat, r, l) {
  const fiche = l?.articleId ? etat.articles.find((a) => a.id === l.articleId) || null : null;
  if (!fiche) return { fiche: null, liste: 'non' };
  const coche = (etat.liste || []).some((y) => y.recu?.recuId === r.id && !y.recu.absent && ligneCouvre(etat, y, fiche.id));
  if (coche) return { fiche, liste: 'coche' };
  const jour = (d) => (d ? Date.parse(`${String(d).slice(0, 10)}T12:00Z`) / 864e5 : NaN);
  const dR = jour(r.date || r.cree);
  const achete = (etat.achats || []).some((ac) => (!r.banniere || ac.banniere === r.banniere)
    && Math.abs(jour(ac.date) - dR) <= 1 && ligneCouvre(etat, ac, fiche.id));
  return { fiche, liste: achete ? 'achete' : 'non' };
}

/** HTML des deux notes (📦 Fiche, 🛒 Liste) sous une ligne du reçu. */
export function htmlNotesLigne(etat, r, l) {
  const { fiche, liste } = notesLigne(etat, r, l);
  const f = fiche ? `<span class="rc-ok">✓</span> ${esc(fiche.nom)}${fiche.marque ? ` · ${esc(fiche.marque)}` : ''}` : '<span class="rc-non">✗</span> aucune fiche';
  const li = liste === 'coche' ? '<span class="rc-ok">✓</span> coché sur ta liste'
    : liste === 'achete' ? '<span class="rc-ok">✓</span> acheté (retiré de ta liste)'
    : fiche ? '— pas sur ta liste' : '<span class="rc-non">✗</span> rien de coché';
  return `<span class="rc-notes"><span>📦 Fiche : ${f}</span><span>🛒 Liste : ${li}</span></span>`;
}

import { modeRabais, prixParArticle, offreLigne, estPese, pesee, nbArticles, cibleLignes, natureLigne, consignes, reporterAssociations, etatLigne,
  texteFiche, indexBase, achatsDuProduit, resumeAchats, soustrait, scoresAssociation, decisionAssociation } from './lignes-recu.js';

const TOLERANCE = 0.02; // $ : en deçà, c'est le bon prix

/**
 * Prix affiché dans l'app AVANT l'achat (on ignore les prix venant des reçus) :
 * celui de la bannière du reçu si on l'a, sinon le meilleur ailleurs.
 */
function prixAttendu(a, banniere, varianteId) {
  const toutes = offresArticle(a).filter((o) => o.source !== 'recu' && !o.perso && o.pu != null);
  // La même marque/format d'abord ; sinon une autre, comparée seulement au kg / L (pas « par article »)
  const memes = varianteId ? toutes.filter((o) => o.varianteId === varianteId) : toutes;
  const autreVariante = !memes.length && !!varianteId;
  const offres = memes.length ? memes : toutes;
  const ici = offres.filter((o) => o.banniere === banniere).sort((x, y) => x.pu - y.pu)[0];
  const o = ici || offres[0];
  return o ? { pu: o.pu, uniteRef: o.uniteRef, prixArticle: autreVariante ? null : o.prixArticle, format: o.format || null, banniere: o.banniere, offre: o.offre, type: o.type,
    fin: o.fin || null, source: o.source, observeLe: o.observeLe || null, ailleurs: !ici, autreVariante, produitAffiche: o.produitOffre || '',
    preuve: preuveDe(o) } : null;
}

/** Ce qui permet de prouver le prix affiché à la caisse : où il a été vu, lien ou photo. */
function preuveDe(o) {
  return { prixId: o.id || null, source: o.source || null, type: o.type || null, debut: o.debut || null, fin: o.fin || null, observeLe: o.observeLe || null,
    banniere: o.banniere, magasinNom: o.magasinNom || null, produit: o.produitOffre || o.nomProduit || null, format: o.format || null,
    url: o.url || null, lienMarchand: o.lienMarchand || null, photoId: o.photoId || null, offre: o.offre || null, offreCirculaire: o.offreCirculaire || null };
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

/** Prix au kg écrit dans un texte (« 4,39 $/kg », « 3,49 $/lb », « 0,77 $/100 g ») ; null s'il n'y en a pas. */
export function auKg(texte) {
  const m = /(\d+(?:[.,]\d+)?)\s*\$?\s*\/\s*(kg|lb|100\s*g)\b/i.exec(String(texte || ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.')), u = m[2].toLowerCase().replace(/\s/g, '');
  return u === 'kg' ? v : u === 'lb' ? v / 0.45359237 : v * 10;
}

/**
 * Prix attendu AU KG pour un produit pesé : prix au kg / à la lb affiché, sinon prix d'un sac ÷ son poids (« 3,49 $ · 907 g »).
 * null si le prix affiché n'a pas de poids : il n'est alors pas comparable à une pesée.
 */
export function attenduAuKg(att) {
  if (!att) return null;
  const k = auKg(att.offre);
  if (k != null) return k;
  if (att.uniteRef === 'kg' && att.pu != null) return att.pu;
  const f = analyserFormat(att.format);
  if (f?.base === 'kg' && f.total > 0 && att.prixArticle != null) return att.prixArticle / f.total;
  return null;
}

/** Compare le prix payé (ligne de reçu) au prix affiché ; explique l'écart avec des règles simples + l'IA. */
function comparerPrix(l, ar, att, r, mode = modeRabais(r)) {
  const offre = offreLigne(l, mode);
  const date = r.date || r.cree.slice(0, 10);
  const base = { recuId: r.id, date, banniere: r.banniere, offrePayee: offre, explicationIA: l.explicationPrix || null };
  if (!offre) return { ...base, statut: 'inconnu' };
  const np = normaliser(offre, ar.format, ar.uniteRef);
  let paye = null, attendu = null, unite = '';
  if (att && estPese(l)) {
    // Produit pesé : TOUJOURS au kg, quelle que soit l'unité de la fiche (« Poires » comptées à l'unité, 22 nov. 2026 :
    // le total 5,07 $ pour 1,155 kg était comparé à 3,49 $ « l'article »). Pas de prix au poids affiché → pas comparable.
    // Le vrac se compare au vrac : un prix au kg / à la lb de la même bannière passe avant un sac (« 3,49 $ · 907 g »).
    const vrac = offresArticle(ar).filter((o) => o.source !== 'recu' && !o.perso && o.banniere === r.banniere && auKg(o.offre) != null)
      .sort((x, y) => auKg(x.offre) - auKg(y.offre))[0];
    if (vrac && auKg(att.offre) == null) {
      att = { ...att, offre: vrac.offre, format: vrac.format || null, prixArticle: null, type: vrac.type, fin: vrac.fin || null,
        source: vrac.source, observeLe: vrac.observeLe || null, ailleurs: false, preuve: preuveDe(vrac) };
    }
    const pk = auKg(offre), ak = attenduAuKg(att);
    if (pk != null && ak != null) { paye = pk; attendu = ak; unite = '/kg'; }
  } else if (att && att.prixArticle != null) {               // à l'unité : prix d'un article
    paye = prixParArticle(l, mode); attendu = att.prixArticle;
  } else if (att && np.prixUnitaire != null) {               // sinon : au kg / L / unité
    paye = np.prixUnitaire; attendu = att.pu; unite = att.uniteRef === 'kg' ? '/kg' : att.uniteRef === 'l' ? '/L' : '/unité';
  }
  if (paye == null) {
    const p = estPese(l) ? null : prixParArticle(l, mode);
    const pourquoi = att && estPese(l)
      ? `Le prix affiché dans l'app (${att.offre || argent(att.prixArticle)}) n'indique pas de poids : il ne se compare pas à un produit pesé.`
      : 'Aucun prix n\'était affiché dans l\'app pour comparer.';
    return { ...base, statut: 'inconnu', paye: p, explication: [pourquoi] };
  }
  const ecart = paye - attendu;
  const statut = Math.abs(ecart) <= TOLERANCE ? 'ok' : ecart < 0 ? 'moins' : 'plus';
  const raisons = [];
  if (statut !== 'ok') {
    if (att.autreVariante) raisons.push(`Aucun prix connu pour cette marque/format : comparé au ${unite.replace('/', '') || 'prix unitaire'} avec ${att.produitAffiche || 'une autre marque/format'}.`);
    if (att.ailleurs) raisons.push(`Le prix affiché vient de ${nomBanniere(att.banniere)}, pas de ${nomBanniere(r.banniere)}.`);
    if (att.type === 'circulaire' && att.fin && att.fin < date) raisons.push(`Le rabais affiché se terminait le ${att.fin}.`);
    else if (att.type === 'circulaire' && statut === 'plus') raisons.push('Le prix affiché était un prix en rabais : il n\'a peut-être pas été appliqué à la caisse.');
    const fL = analyserFormat(l.format), fA = analyserFormat(ar.format);
    if (fL && fA && fL.base === fA.base && Math.abs(fL.total - fA.total) / fA.total > 0.05) raisons.push(`Format sur la facture (${formatLisible(l.format)}) différent de ta fiche (${formatLisible(ar.format)}).`);
    if (l.rabais) raisons.push(`Un rabais de ${argent(l.rabais)} a été appliqué à la caisse${mode === 'net' ? ' (déjà déduit du prix imprimé)' : ''}.`);
    if (att.source === 'epiceries_ca') raisons.push('Le prix affiché vient d\'épiceries.ca (en ligne) : il peut différer de ta succursale.');
    if (att.source === 'demo') raisons.push('Le prix affiché était un prix de démonstration.');
    if (statut === 'plus' && !att.ailleurs) raisons.push('Si le prix à la caisse dépasse le prix affiché en magasin, la Politique d\'exactitude des prix s\'applique : article gratuit jusqu\'à 15 $, sinon 15 $ de rabais. Garde ton reçu.');
  }
  return { ...base, statut, paye, attendu, ecart, unite, offreAffichee: att.offre, banniereAffichee: att.banniere, preuve: att.preuve || null, explication: raisons };
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
  const cible = cibleLignes(r); // sous-total imprimé, sinon total − taxes
  const mode = modeRabais(r);
  const sommeMixte = lignes.reduce((s, l) => s + (Number(l.prix) || 0) - soustrait(l), 0);
  // Lecture v11+ : chaque ligne porte rabaisSoustrait → le montant payé est toujours prix − rabaisSoustrait
  const lectureRecente = lignes.some((l) => l.rabaisSoustrait != null);
  // Photos bonnes = haut et bas visibles, lisibles, total lu. Les remarques écrites de l'IA n'entrent pas ici :
  // depuis son contrôle de la somme, elle y décrit aussi un écart de LECTURE (que de nouvelles photos ne règlent pas).
  const photosOk = v.complet !== false && v.lisible !== false && r.total != null && lignes.length > 0;
  let ecart = null;
  if (cible != null && lignes.length) {
    concorde = Math.abs(somme - cible) <= ECART_MAX || Math.abs(somme - rabais - cible) <= ECART_MAX || Math.abs(sommeMixte - cible) <= ECART_MAX;
    if (!concorde) {
      const lu = mode === 'net' ? somme : mode === 'mixte' || (!mode && lectureRecente) ? sommeMixte : somme - rabais;
      ecart = { lu: Math.round(lu * 100) / 100, cible, montant: Math.round((lu - cible) * 100) / 100, suspects: suspectsEcart(lignes, lu - cible) };
      problemes.push(`La somme des produits lus (${argent(lu)}) ne correspond pas au ${r.sousTotal != null ? 'sous-total imprimé' : 'total moins les taxes'} (${argent(cible)}) : écart de ${argent(Math.abs(lu - cible))}.`);
    }
  }
  const nbQte = lignes.reduce((s, l) => s + nbArticles(l), 0);
  const ok = !problemes.length && v.complet !== false && v.lisible !== false;
  const resume = `${lignes.length} produit(s) lu(s)${r.nombreArticles != null ? ` (le reçu en annonce ${r.nombreArticles}${Math.round(nbQte) !== r.nombreArticles ? ` ; j'en compte ${Math.round(nbQte)} avec les quantités` : ''})` : ''}`
    + `${r.total != null ? ` · total ${argent(r.total)}` : ''}${concorde ? ` · la somme des lignes concorde avec le ${r.sousTotal != null ? 'sous-total' : 'total moins les taxes'}` : ''}`
    + `${rabais > 0 ? (mode === 'net' ? ' · rabais déjà déduits des prix imprimés' : mode === 'brut' ? ' · rabais soustraits des prix' : mode === 'mixte' ? ' · rabais déjà déduits, sauf les rabais instantanés soustraits à la caisse' : ' · impossible de confirmer si les rabais sont déjà déduits') : ''}.`;
  // photosOk + ecart : les photos sont bonnes, c'est la LECTURE d'une ou deux lignes qui cloche → reprendre les photos n'aide pas
  return { ok, problemes: [...new Set(problemes)], resume, photosOk: photosOk && !!ecart, ecart };
}

/**
 * Lignes qui expliqueraient l'écart (somme lue − sous-total) : une ligne lue en trop ou oubliée de ce montant,
 * une même ligne recopiée deux fois (zone de chevauchement des photos), un rabais compté à l'envers.
 * Ce sont des pistes à vérifier, pas des corrections.
 */
export function suspectsEcart(lignes, diff) {
  const d = Math.abs(diff), pres = (x) => Math.abs(Math.abs(x) - d) <= 0.02;
  const net = (l) => (Number(l.prix) || 0) - soustrait(l);
  const out = [];
  lignes.forEach((l, i) => {
    const jumelles = lignes.filter((x) => x.libelle === l.libelle && Number(x.prix) === Number(l.prix)).length;
    const deja = lignes.slice(0, i).some((x) => x.libelle === l.libelle && Number(x.prix) === Number(l.prix));
    if (diff > 0 && jumelles > 1 && pres(net(l))) { if (deja) out.push(`« ${l.libelle} » (${argent(net(l))}) est lu ${jumelles} fois : peut-être recopié dans la zone où les photos se chevauchent.`); }
    else if (diff > 0 && pres(net(l))) out.push(`« ${l.libelle} » (${argent(net(l))}) : ligne peut-être lue en trop ou mal lue.`);
    else if (pres(Number(l.rabais) || 0)) out.push(`« ${l.libelle} » : son rabais de ${argent(Number(l.rabais))} est peut-être compté du mauvais côté.`);
    else if (pres(2 * (Number(l.rabais) || 0))) out.push(`« ${l.libelle} » : son rabais de ${argent(Number(l.rabais))} est peut-être compté deux fois.`);
  });
  if (diff < 0 && !out.length) out.push(`Il manque ${argent(d)} : une ligne a peut-être été oubliée ou un montant lu trop bas.`);
  return [...new Set(out)].slice(0, 4);
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

/**
 * Cherche le code-barres d'un article par marque + nom (Open Food Facts).
 * Gardé seulement si UN produit concorde exactement (marque, nom et format) ; sinon les candidats
 * sont proposés dans la fiche (« Ajouter ce code ») et une mention invite à scanner le produit.
 */
export async function trouverCode(articleId, marqueLigne) {
  const a = S.get().articles.find((x) => x.id === articleId);
  if (!a || a.codes?.length) return 'deja';
  const Sync = await import('./sync.js');
  const marque = marqueLigne || a.marque || '';
  const mots = (t) => simple(t).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((m) => m.length >= 3);
  const motsMarque = new Set(mots(marque));
  const cle = mots(a.nom).filter((m) => !motsMarque.has(m));
  const hits = await Sync.chercherCodesEnLigne(cle.join(' ') || a.nom, marque);
  if (hits == null) return 'indisponible';
  const nomOk = (h) => { const t = mots(`${h.nom} ${h.marque}`); return !cle.length || cle.filter((m) => t.some((x) => x.startsWith(m) || m.startsWith(x))).length / cle.length >= 0.5; };
  const marqueOk = (h) => !marque || simple(h.marque).includes(simple(marque));
  const bons = hits.filter((h) => marqueOk(h) && nomOk(h));
  const fA = analyserFormat(a.format);
  const exacts = fA ? bons.filter((h) => { const f = analyserFormat(h.format); return f && f.base === fA.base && Math.abs(f.total - fA.total) / fA.total < 0.03; }) : [];
  S.maj((x) => {
    const ar = x.articles.find((y) => y.id === articleId);
    if (!ar) return;
    if (exacts.length === 1) {
      ar.codes = [...new Set([...(ar.codes || []), ...gtinVariantes(exacts[0].code)])];
      ar.codeSource = 'en ligne'; delete ar.codesProposes;
    } else {
      ar.codesProposes = bons.slice(0, 5); ar.codeCherche = new Date().toISOString();
    }
  });
  return exacts.length === 1 ? 'trouve' : 'propose';
}

/** v143 : prix connus de chaque fiche à la bannière du reçu (actifs, sans ceux tirés de CE reçu) → part « prix » du score. */
function prixConnusA(e, banniere, recuId) {
  const m = new Map();
  (e.prix || []).forEach((p) => {
    if (p.annule || p.enAttente || p.banniere !== banniere || p.recuId === recuId || !p.articleId) return;
    const v = Number(p.prixNum) || Number(String(p.offre || '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]);
    if (v > 0) (m.get(p.articleId) || m.set(p.articleId, []).get(p.articleId)).push(v);
  });
  return m;
}

/** v143 : fiches proposées pour une ligne (30 % et plus, sauf celle reliée seule), calculées à l'ouverture de la ligne. */
export function candidatsPourLigne(r, i) {
  const e = S.get(), l = r?.lignes?.[i];
  if (!l || l.articleId) return [];
  const nomsPrix = new Map();
  (e.prix || []).forEach((p) => { if (p.nomProduit && !p.annule) (nomsPrix.get(p.articleId) || nomsPrix.set(p.articleId, new Set()).get(p.articleId)).add(p.nomProduit); });
  const base = indexBase(e.articles.map((a) => ({ id: a.id, nom: a.nom, texte: texteFiche(a, [...(nomsPrix.get(a.id) || [])]) })));
  return scoresAssociation(l, base, e.articles, prixConnusA(e, r.banniere, r.id), 3, { banniere: r.banniere }).filter((c) => c.pct >= 30)
    .map(({ id, pct, raisons }) => ({ id, pct, raisons }));
}

/** Associe à la main les lignes d'un reçu : choix = { indexLigne: articleId | '' (aucun) }. Puis recompare et complète. */
export async function associerManuellement(recuId, choix, etat) {
  S.maj((x) => {
    const rc = x.recus.find((y) => y.id === recuId);
    Object.entries(choix).forEach(([i, id]) => {
      const ln = rc?.lignes?.[i];
      if (!ln) return;
      const ancien = ln.articleId;
      if (ancien && ancien !== id) {
        // Mauvaise association corrigée : le prix enregistré pour l'ancien article est annulé (gardé, mais ignoré)
        x.prix.filter((p) => p.recuId === recuId && p.articleId === ancien).forEach((p) => { p.annule = true; p.annuleRaison = 'association corrigée à la main'; });
        x.liste.filter((y) => y.articleId === ancien && y.recu?.recuId === recuId).forEach((y) => { delete y.recu; });
      }
      ln.articleId = id || null; ln.manuel = true;
    });
  });
  return appliquerRecu(recuId, etat, { force: true });
}

/**
 * Produit en main (code scanné ou photo) : relie les lignes `indices` du reçu au produit `articleId`
 * et y inscrit le code-barres (il sera ajouté à la fiche, à la bonne marque/format), puis recalcule le reçu.
 */
export async function associerProduit(recuId, indices, articleId, code, etat) {
  if (code) S.maj((x) => { const rc = x.recus.find((y) => y.id === recuId); indices.forEach((i) => { if (rc?.lignes?.[i]) rc.lignes[i].code = code; }); });
  return associerManuellement(recuId, Object.fromEntries(indices.map((i) => [i, articleId])), etat);
}

/** Détail d'une ligne (touchée dans la liste du reçu) : texte imprimé, code, quantité, lien, prix payé. */
export function htmlLigne(r, i) {
  const l = r.lignes?.[i];
  if (!l) return '';
  const e = S.get();
  const a = l.articleId && e.articles.find((x) => x.id === l.articleId);
  const mode = modeRabais(r);
  const cons = consignes(r.lignes)[i];
  const plu = l.code && analyserPlu(l.code);
  const morceaux = [
    `Imprimé : <b>${esc(l.libelle)}</b>`,
    l.code ? (plu ? `PLU ${esc(plu.plu)}${plu.bio ? ' bio' : ''}` : `Code ${esc(l.code)}`) : '',
    [l.marque, l.format || l.formatEnLigne].filter(Boolean).map(esc).join(' · '),
    l.poids ? esc(l.poids) : pesee(l) ? `${String(pesee(l).qte).replace('.', ',')} kg (pesé)` : l.quantite > 1 ? `Quantité ${l.quantite}` : '',
    l.rabais ? (mode === 'net' ? `Économie ${argent(l.rabais)} (déjà déduite)`
      : mode === 'mixte' ? `Économie ${argent(l.rabais)}${soustrait(l) ? ` (dont −${argent(soustrait(l))} à la caisse)` : ' (déjà déduite)'}`
      : `Rabais −${argent(l.rabais)}`) : '',
    cons ? `+ consigne ${argent(cons)}` : '',
  ].filter(Boolean);
  const v = l.verdict || (a?.dernierAchat?.recuId === r.id ? a.dernierAchat : null);
  const etat = etatLigne(l);
  return `<div>${morceaux.join('<br>')}</div>
    ${a ? `<div style="margin-top:4px">${etat === 'ok' ? '✓ Associé' : '! Associé (à vérifier)'} à <b>${esc(a.nom)}</b>${a.marque ? ` · ${esc(a.marque)}` : ''}</div>`
      : etat === 'hors' ? `<div style="margin-top:4px" class="doux">${l.manuel ? 'Mis de côté (« aucun produit »)' : 'Pas un produit'}</div>`
      : '<div style="margin-top:4px">✗ Aucune association</div>'}
    ${v?.statut === 'plus' ? `<div style="color:var(--rouge)">⚠️ Payé ${argent(v.paye)}${v.unite || ''} au lieu de ${argent(v.attendu)}${v.unite || ''}</div>`
      : v?.statut === 'ok' || v?.statut === 'moins' ? `<div style="color:var(--vert)">✓ Bon prix : ${argent(v.paye)}${v.unite || ''}</div>` : ''}`;
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
  S.maj((x) => {
    const rc = x.recus.find((y) => y.id === recuId);
    if (!rc) return;
    const anciennes = rc.lignes || [];
    Object.assign(rc, lu, { statut: 'lu', relu: new Date().toISOString() });
    // Tes associations faites à la main (et tes « aucun produit ») survivent à la relecture
    lu.reportees = reporterAssociations(anciennes, rc.lignes || []);
    delete rc.reportees; delete rc.applique; delete rc.bilan;
  });
  return lu;
}

/**
 * Relie chaque ligne du reçu à un article (liste puis code-barres), enregistre le prix payé,
 * coche l'article acheté et complète les fiches (code, marque, format, photo) par une recherche en ligne.
 * etat(msg) suit l'avancement. Retourne un bilan.
 */
export async function appliquerRecu(recuId, etat = () => {}, opts = {}) {
  const e = S.get();
  const r = (e.recus || []).find((x) => x.id === recuId);
  if (!r || (r.applique && r.bilan?.relies && !opts.force)) return null; // déjà appliqué avec succès
  const mag = e.magasins.find((m) => m.banniere === r.banniere && r.magasin && simple(r.magasin).includes(simple(m.nom).split(' ').pop()))
    || e.magasins.find((m) => m.banniere === r.banniere);
  const date = r.date || r.cree.slice(0, 10);
  const bilan = { relies: 0, coches: 0, prix: 0, completes: 0, nonRelies: 0, bonPrix: 0, ecarts: 0, horsProduits: 0, absents: 0 };
  // Lien avec la liste, choisi à l'enregistrement : { mode: 'panier', ids } = ce reçu correspond au panier ;
  // { mode: 'aucun' } = autre achat, la liste n'est pas touchée ; absent = toute la liste (comme avant)
  const lien = opts.lienListe || r.lienListe || null;
  const lignesListe = new Set(lien?.mode === 'aucun' ? [] : lien?.mode === 'panier' ? lien.ids || [] : e.liste.map((x) => x.id));
  const relies = new Set();
  const mode = modeRabais(r); // prix imprimés déjà rabais déduits ('net') ou non ('brut')
  // Nouvelle application (relecture, correction) : les prix déjà tirés de ce reçu qui ne
  // correspondent plus à une ligne seront annulés (gardés, mais ignorés : ajout seulement).
  const anciens = new Set((e.prix || []).filter((p) => p.recuId === recuId && !p.annule).map((p) => p.id));
  const gardes = new Set();
  const { infosCode } = await import('./scan.js');
  // Ta base, prête pour la recherche : fiches + noms des produits vus dans les prix (épiceries.ca, circulaires…)
  const nomsPrix = new Map();
  (e.prix || []).forEach((p) => { if (p.nomProduit && !p.annule) (nomsPrix.get(p.articleId) || nomsPrix.set(p.articleId, new Set()).get(p.articleId)).add(p.nomProduit); });
  const base = indexBase(e.articles.map((a) => ({ id: a.id, nom: a.nom, texte: texteFiche(a, [...(nomsPrix.get(a.id) || [])]) })));
  const prixConnus = prixConnusA(e, r.banniere, recuId);

  for (const [i, l] of (r.lignes || []).entries()) {
    etat(`Produit ${i + 1}/${r.lignes.length}…`);
    // Consigne, coupon, sac, frais : pas un produit (sauf association faite à la main)
    const nature = natureLigne(l);
    if (nature !== 'produit' && !(l.manuel && l.articleId)) {
      bilan.horsProduits++;
      S.maj((x) => { const ln = x.recus.find((y) => y.id === recuId)?.lignes?.[i]; if (ln) ln.nature = nature; });
      continue;
    }
    const codes = variantesRecu(l.code);
    const pluL = await infosPlu(l.code); // fruit ou légume : code PLU (4 chiffres, 9 + PLU = bio)
    const etatNow = S.get();
    // ① par le nom de la liste (relié par l'IA), ② par code-barres dans tout le catalogue
    // ⓪ association faite à la main (prioritaire)
    let a = l.manuel && l.articleId && etatNow.articles.find((x) => x.id === l.articleId);
    let v = null; // variante exacte (marque + format), quand elle est certaine
    if (l.manuel && !l.articleId) { // « aucun produit » choisi à la main : ce nom de reçu ne doit plus rien relier
      bilan.nonRelies++;
      S.maj((x) => P.retenirAlias(x, null, null, r.banniere, l.libelle));
      continue;
    }
    // Source du lien (écran du reçu : ✓ sûr pour manuel / code / plu / alias, ! à vérifier pour liste / nom)
    let lien = a ? 'manuel' : null;
    const source = (s) => { if (a && !lien) lien = s; };
    // ① code-barres → variante exacte ; ② nom déjà vu sur un reçu de cette bannière (appris)
    if (!a && codes.length) { const t = P.varianteParCode(etatNow, codes); if (t) ({ article: a, variante: v } = t); }
    source('code');
    // ①b code PLU déjà associé à un produit (appris d'un reçu précédent ou ajouté à la main)
    // Spec S14 : le bio est un produit à part — 94011 ne va qu'à une fiche qui porte 94011, jamais à celle du 4011
    if (!a && pluL) a = etatNow.articles.find((x) => (x.plu || []).includes(pluL.bio ? `9${pluL.plu}` : pluL.plu));
    source('plu');
    if (!a) { const t = P.varianteParAlias(etatNow, r.banniere, l.libelle); if (t) ({ article: a, variante: v } = t); }
    source('alias');
    // ③ nom de la liste (relié par l'IA) : à vérifier, et pas appris tant que tu ne l'as pas confirmé
    if (!a) a = l.articleListe && etatNow.articles.find((x) => simple(x.nom) === simple(l.articleListe)
      && etatNow.liste.some((li) => li.articleId === x.id));
    source('liste');
    // ③b v143 — ta base, avec un score de certitude par fiche (nom + marque + prix connu à cette bannière) :
    // ≥ 70 % ET 30 points d'avance : reliée seule (à vérifier) ; 30 % et plus : proposées ; < 30 % : dans le doute
    let candidats = [];
    if (!a) {
      const cands = scoresAssociation(l, base, etatNow.articles, prixConnus, 3, { banniere: r.banniere });
      const d = decisionAssociation(cands);
      if (d.auto) a = etatNow.articles.find((x) => x.id === d.auto.id) || null;
      candidats = d.proposes.filter((c) => !a || c.id !== a.id).map(({ id, pct, raisons }) => ({ id, pct, raisons }));
    }
    source('base');
    // (lien deviné : on ne l'apprend pas comme nom de reçu, pour ne pas répéter une erreur)
    let devine = lien === 'liste' || lien === 'base';
    // Fruit ou légume : nom officiel du PLU ; bio ↔ bio seulement (S14)
    if (!a && pluL) { a = parNom(`${pluL.produit} ${pluL.variete}${pluL.bio ? ' biologique' : ''}`, etatNow); if (a && pluL.bio !== !!a.bio) a = null; devine = !!a; }
    source('nom');
    S.maj((x) => { const ln = x.recus.find((y) => y.id === recuId)?.lignes?.[i]; if (ln) { if (candidats.length && !a) ln.candidats = candidats; else delete ln.candidats; } });
    // ④ lien d'une application précédente (ex. article retiré de la liste depuis) : gardé, mais à vérifier
    if (!a && l.articleId) { a = etatNow.articles.find((x) => x.id === l.articleId) || null; if (a) devine = true; }
    source('ancien');
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
        if (ln) { ln.articleId = null; delete ln.varianteId; delete ln.lien; delete ln.verdict; } // plus de lien (ancien lien périmé effacé)
        if (ln && info) Object.assign(ln, { nomEnLigne: info.nom || null, imageUrl: info.image || null, formatEnLigne: info.format || null });
        if (ln && pluL && !ln.nomEnLigne) ln.nomEnLigne = pluL.nom; // le nom officiel aide à l'associer à la main
      });
      continue;
    }
    bilan.relies++;
    relies.add(a.id);
    const offre = offreLigne(l, mode);
    // Quelle marque/format a été achetée ? (code, nom appris, marque + format… sinon la ★)
    const fmtLigne = l.format || info?.format, marqueLigne = l.marque || info?.marque;
    const artNow = S.get().articles.find((y) => y.id === a.id) || a;
    const choixV = v ? { variante: v } : P.varianteDeLAchat(artNow,
      { codes, banniere: r.banniere, libelle: l.libelle, marque: marqueLigne, format: fmtLigne ? formatLisible(fmtLigne) || fmtLigne : '' });
    // Prix payé comparé au prix affiché de la MÊME marque/format (son format à elle), avant d'ajouter le prix payé
    const vChoisie = choixV.variante;
    const formatAchat = vChoisie?.format || choixV.nouvelle?.format || artNow.format;
    const verdict = comparerPrix(l, { ...artNow, format: formatAchat }, prixAttendu(artNow, r.banniere, vChoisie?.id || (choixV.nouvelle ? 'nouvelle' : null)), r, mode);
    if (verdict.statut === 'ok' || verdict.statut === 'moins') bilan.bonPrix++;
    if (verdict.statut === 'plus') bilan.ecarts++;
    // Pas de code-barres ni sur la facture ni dans la fiche : recherche en ligne (sinon mention dans la fiche)
    const chercheRecent = a.codeCherche && Date.now() - Date.parse(a.codeCherche) < 7 * 864e5;
    if (!codes.length && !a.codes?.length && !pluL && !a.plu?.length && !chercheRecent && navigator.onLine) { etat(`Code-barres de ${a.nom}…`); await trouverCode(a.id, l.marque); }
    let coche = false, complete = false;
    S.maj((x) => {
      const ar = x.articles.find((y) => y.id === a.id);
      if (!ar) return;
      let va;
      if (choixV.nouvelle) { va = P.ajouterVariante(ar, choixV.nouvelle); if (info?.image) va.imageUrl = info.image; complete = true; }
      else va = ar.variantes?.find((y) => y.id === choixV.variante?.id) || P.variantePref(ar);
      const estPref = va === P.variantePref(ar);
      if (codes.length && !choixV.nouvelle) {
        if (estPref) ar.codes = [...new Set([...(ar.codes || []), ...codes])];
        else P.modifierVariante(ar, va.id, { codes: [...(va.codes || []), ...codes] });
      }
      const fmt = fmtLigne;
      if (!estPref) { // autre marque/format : on complète la variante, pas la fiche
        if (!va.format && fmt) { va.format = formatLisible(fmt) || fmt; complete = true; }
        if (!va.marque && marqueLigne) { va.marque = marqueLigne; complete = true; }
        if (!va.imageUrl && info?.image) { va.imageUrl = info.image; complete = true; }
      }
      if (estPref && !ar.format && fmt) { ar.format = formatLisible(fmt) || fmt; const f = analyserFormat(ar.format); if (f) ar.uniteRef = f.base; complete = true; }
      if (estPref && !ar.marque && marqueLigne) { ar.marque = marqueLigne; complete = true; }
      if (estPref && !ar.imageUrl && info?.image) { ar.imageUrl = info.image; complete = true; }
      if (va && !devine) P.retenirAlias(x, ar.id, va.id, r.banniere, l.libelle); // le prochain reçu se reliera seul
      if (pluL && !devine && !(ar.plu || []).includes(pluL.plu)) ar.plu = [...(ar.plu || []), pluL.plu]; // PLU appris (sûr seulement)
      if (info?.details) { if (info.details.quebec) ar.local = true; if (info.details.bio) ar.bio = true; if (info.details.allergenes.length && !ar.allergenes?.length) ar.allergenes = info.details.allergenes; }
      if (info?.ecp && !(ar.liens || []).some((k) => k.id === info.ec.id)) {
        ar.liens = [...(ar.liens || []), { id: info.ec.id, nom: [info.ecp.brand, info.ecp.name].filter(Boolean).join(' '), size: info.ecp.size, image: info.ecp.image }];
      }
      if (offre && r.banniere) {
        // Même prix déjà tiré de ce reçu (application précédente) : on le garde ; sinon on l'ajoute
        const meme = x.prix.find((p) => anciens.has(p.id) && !gardes.has(p.id) && p.articleId === ar.id && p.offre === offre);
        if (meme) gardes.add(meme.id);
        else {
          const id = S.uid('p');
          gardes.add(id);
          x.prix.push({ id, articleId: ar.id, varianteId: va?.id, banniere: r.banniere, magasinId: mag?.id, offre, format: va?.format || ar.format,
            type: l.rabais ? 'circulaire' : 'regulier', fin: null, source: 'recu', recuId, observeLe: date,
            // v149 (audit D6) : prix payé pour 1 article en nombre (pas pour un prix au kg), comme les autres sources
            ...(/^\d+,\d{2} \$$/.test(offre) ? { prixNum: Number(offre.slice(0, -2).replace(',', '.')) } : {}) });
        }
      }
      // Cocher l'article acheté : seulement sans lien choisi (panier : déjà coché ; autre achat : liste intacte)
      const li = !lien && x.liste.find((y) => y.articleId === ar.id && !y.coche);
      if (li) { li.coche = true; li.cocheLe = new Date().toISOString(); coche = true; }
      x.liste.filter((y) => lignesListe.has(y.id) && ligneCouvre(x, y, ar.id)).forEach((y) => { y.recu = verdict; });
      ar.dernierAchat = verdict;
      const ln = x.recus.find((y) => y.id === recuId)?.lignes?.[i];
      if (ln) {
        ln.articleId = ar.id; ln.lien = lien; if (va) ln.varianteId = va.id;
        // v128 : la source du prix prévu est gardée (preuve en lien dans l'écran du reçu ; « chez cette bannière » ou « ailleurs »)
        ln.verdict = { statut: verdict.statut, paye: verdict.paye ?? null, attendu: verdict.attendu ?? null, unite: verdict.unite || '',
          banniere: verdict.banniereAffichee || null, explication: verdict.explication?.length ? verdict.explication : null, preuve: verdict.preuve || null };
      }
    });
    if (offre && r.banniere) bilan.prix++;
    if (coche) bilan.coches++;
    if (complete) bilan.completes++;
  }
  // Articles de la liste absents de cette facture (sans effacer un achat confirmé par une autre facture)
  S.maj((x) => {
    x.liste.filter((y) => lignesListe.has(y.id) && ![...relies].some((id) => ligneCouvre(x, y, id)) && (!y.recu || y.recu.absent))
      .forEach((y) => { y.recu = { recuId, date, banniere: r.banniere, absent: true }; if (lien?.mode === 'panier') bilan.absents++; });
  });
  // Anciens prix de ce reçu qui ne correspondent plus (rabais ou pesée recalculés, ligne changée)
  S.maj((x) => {
    x.prix.filter((p) => anciens.has(p.id) && !gardes.has(p.id) && !p.annule)
      .forEach((p) => { p.annule = true; p.annuleRaison = 'prix du reçu recalculé'; });
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

export const texteBilan = (b) => b ? `${b.relies} produit(s) relié(s) à ton catalogue · ${b.coches} coché(s) sur la liste · ${b.prix} prix payé(s) enregistré(s)${b.bonPrix != null ? ` · ${b.bonPrix} au bon prix` : ''}${b.ecarts ? ` · ⚠️ ${b.ecarts} payé(s) plus cher` : ''} · ${b.completes} fiche(s) complétée(s)${b.nonRelies ? ` · ${b.nonRelies} non relié(s)` : ''}${b.horsProduits ? ` · ${b.horsProduits} consigne(s), coupon(s) ou sac(s) mis à part` : ''}${b.absents ? ` · ⚠️ ${b.absents} article(s) du panier pas sur la facture` : ''}` : '';

const dateCourte = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) : '');

/** Ligne du haut de l'encadré de la liste : « payé le bon prix ? » selon la facture. */
export function htmlVerdictListe(v) {
  if (!v) return '';
  const ou = `${v.banniere ? nomBanniere(v.banniere) + ', ' : ''}${dateCourte(v.date)}`;
  if (v.absent) return `<div class="item-recu ecart">🧾 ! Pas trouvé sur la facture (${esc(ou)})</div>`;
  const p = (x) => `${argent(x)}${v.unite || ''}`;
  if (v.statut === 'ok') return `<div class="item-recu ok">🧾 ✓ Bon prix selon la facture : ${p(v.paye)} (${esc(ou)})</div>`;
  if (v.statut === 'moins') return `<div class="item-recu ok">🧾 ✓ Payé moins cher : ${p(v.paye)} au lieu de ${p(v.attendu)} (${esc(ou)})</div>`;
  if (v.statut === 'plus') return `<div class="item-recu ecart">🧾 ⚠️ Payé ${p(v.paye)} au lieu de ${p(v.attendu)} (+${argent(v.ecart)}) — touche pour comprendre</div>`;
  return `<div class="item-recu doux">🧾 Payé ${v.paye != null ? argent(v.paye) : esc(v.offrePayee || '?')} (${esc(ou)}) — aucun prix affiché pour comparer</div>`;
}

/**
 * Preuve du prix affiché, pour la montrer à la caisse : d'où vient ce prix (photo d'étiquette,
 * circulaire, site de l'enseigne, saisie, démo), avec le lien ou la photo quand on les a.
 * Les anciens verdicts (sans « preuve ») retrouvent le prix par bannière + offre.
 */
function htmlPreuve(v, articleId) {
  let pr = v.preuve;
  if (!pr && articleId && v.banniereAffichee) {
    const p = [...(S.get().prix || [])].reverse().find((x) => x.articleId === articleId && x.banniere === v.banniereAffichee && x.offre === v.offreAffichee);
    if (p) pr = { prixId: p.id, source: p.source, type: p.type, fin: p.fin, observeLe: p.observeLe, banniere: p.banniere, magasinNom: p.magasinNom,
      produit: p.nomProduit, url: p.url, lienMarchand: p.lienMarchand, photoId: p.photoId, offre: p.offre };
  }
  if (!pr) return '';
  const ban = nomBanniere(pr.banniere);
  const quand = pr.observeLe ? ` le ${esc(dateCourte(pr.observeLe))}` : '';
  const lien = (url, texte) => `<a class="btn sec" href="${esc(url)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none;margin-top:6px">${texte}</a>`;
  const morceaux = [];
  if (pr.photoId) morceaux.push(`<p style="margin:4px 0">📷 <b>Photo de l'étiquette</b> prise${quand}${pr.magasinNom ? ` chez ${esc(pr.magasinNom)}` : ''} : c'est ta meilleure preuve à la caisse.</p><div class="vignettes" data-preuve-photo="${esc(pr.photoId)}"></div>`);
  if (pr.type === 'circulaire') {
    morceaux.push(`<p style="margin:4px 0">📰 Prix en <b>circulaire</b> chez ${esc(ban)}${pr.fin ? `, valide jusqu'au ${esc(dateCourte(pr.fin))}` : '.'}</p>`);
    if (BANNIERES[pr.banniere]?.circulaire) morceaux.push(lien(BANNIERES[pr.banniere].circulaire, `📰 Ouvrir la circulaire ${esc(ban)}`));
  }
  if (pr.source === 'epiceries_ca') {
    morceaux.push(`<p style="margin:4px 0">🌐 Prix du <b>site web de ${esc(ban)}</b>${pr.produit ? ` (${esc(pr.produit)})` : ''}, relevé${quand} par épiceries.ca.</p>`);
    if (pr.lienMarchand) morceaux.push(lien(pr.lienMarchand, `🌐 Voir le produit sur le site de ${esc(ban)}`));
    if (pr.url) morceaux.push(lien(pr.url, '📈 Fiche et historique sur épiceries.ca'));
    morceaux.push('<p class="doux" style="margin:4px 0">Attention : la Politique d\'exactitude des prix vise le prix affiché <b>en magasin</b> (étiquette, circulaire). Un prix en ligne peut différer de celui de ta succursale.</p>');
  }
  if (pr.source === 'manuel') morceaux.push(`<p style="margin:4px 0">✍️ Prix <b>saisi à la main</b>${quand} — sans photo, ce n'est pas une preuve : vérifie l'étiquette en magasin.</p>`);
  if (pr.source === 'demo') morceaux.push('<p style="margin:4px 0">🧪 Prix de <b>démonstration</b> : ce n\'est pas une preuve.</p>');
  if (!morceaux.length) morceaux.push(`<p style="margin:4px 0">Prix vu chez ${esc(ban)}${quand}</p>`);
  return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--ligne)"><b>🔎 Preuve du prix affiché</b>${morceaux.join('')}</div>`;
}

/** Fiche produit : « Mes achats », chaque achat avec sa date, son magasin, sa quantité et son prix payé (touche → son reçu). */
export function htmlAchats(articleId) {
  const achats = achatsDuProduit(S.get().recus || [], articleId);
  if (!achats.length) return '';
  const s = resumeAchats(achats);
  const annee = new Date().getFullYear();
  const quand = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', ...(Number(d.slice(0, 4)) !== annee ? { year: 'numeric' } : {}) }) : '?');
  const lignes = achats.map((a) => `<li class="rc-l ${a.sur ? 'ok' : 'verifier'}" data-achat-recu="${esc(a.recuId)}">
      <span class="rc-et ${a.sur ? 'ok' : 'ver'}">${a.sur ? '✓' : '!'}</span>
      <span class="rc-nom">${esc(quand(a.date))} · ${esc(a.banniere ? nomBanniere(a.banniere) : a.magasin || 'Magasin ?')} · ${a.poids ? esc(a.poids) : `×${a.quantite}`}${a.prixUnitaire && (a.poids || a.quantite > 1) ? ` · ${esc(a.prixUnitaire)}` : ''}${a.verdict?.statut === 'plus' ? ' ⚠️' : ''}</span>
      <span class="rc-px">${argent(a.paye)}</span></li>`).join('');
  return `<h3>🧾 Mes achats (${s.n})</h3>
    <p class="doux" style="margin:0 0 4px">Total payé ${argent(s.total)} · dernier achat le ${esc(quand(s.dernier))}${s.intervalle != null ? ` · environ tous les ${s.intervalle} jours (hypothèse, n = ${s.nDates} dates)` : ''}. Touche un achat pour ouvrir son reçu.</p>
    <ul class="rc-liste" style="margin-bottom:10px">${lignes}</ul>`;
}

/** Bloc de la fiche produit : détail du dernier achat et explication de l'écart. */
export function htmlDernierAchat(v, articleId) {
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
    ${v.statut === 'plus' ? htmlPreuve(v, articleId) : ''}
  </div>`;
}

// ---------------------------------------------------------------------
// Écran du reçu (v128, maquette recu-v2 approuvée par Chris le 22 nov. 2026) :
// la facture en un coup d'œil ; « payé plus que le prix affiché ICI » (à réclamer) séparé de
// « moins cher ailleurs » (pour la prochaine fois) ; chaque prix prévu avec sa PREUVE en lien et sa date ;
// le reste regroupé et replié. Les lignes restent touchables (data-ligne) : « C'est le bon produit » / « Changer ».
// ---------------------------------------------------------------------

/** Source du prix prévu d'une ligne : gardée dans le verdict (reçus récents), sinon retrouvée parmi les prix du produit. */
function sourcePrevu(r, l) {
  const vd = l.verdict;
  if (!vd || vd.attendu == null) return null;
  if (vd.preuve) return { ...vd.preuve, banniere: vd.banniere || vd.preuve.banniere };
  const a = l.articleId && S.get().articles.find((x) => x.id === l.articleId);
  if (!a) return null;
  const valeur = (o) => (vd.unite === '/kg' ? auKg(o.offre) : (o.prixArticle ?? o.pu));
  const cands = offresArticle(a).filter((o) => o.source !== 'recu' && !o.perso && valeur(o) != null && Math.abs(valeur(o) - vd.attendu) < 0.011);
  const o = cands.find((x) => x.banniere === r.banniere) || cands[0];
  return o ? { ...preuveDe(o), retrouvee: true } : null;
}

/** Liens de preuve (page de circulaire signée, site de la bannière, épiceries.ca) + date du prix. */
function htmlPreuvePrevu(src, dateAchat) {
  if (!src) return '<div class="rc-vu">Source du prix prévu introuvable.</div>';
  const ban = esc(nomBanniere(src.banniere));
  const lien = (url, texte, attrs = '') => `<a href="${esc(url)}" target="_blank" rel="noopener"${attrs}>${texte}</a>`;
  const liens = [];
  if (src.offreCirculaire) liens.push(lien(BANNIERES[src.banniere]?.circulaire || '#', `📄 Page de la circulaire ${ban}`, ` data-offrecirc="${esc(src.offreCirculaire)}"`));
  else if (src.type === 'circulaire' && BANNIERES[src.banniere]?.circulaire && !src.url) liens.push(lien(BANNIERES[src.banniere].circulaire, `📄 Circulaire ${ban}`));
  if (src.lienMarchand) liens.push(lien(src.lienMarchand, `🔗 Site de ${ban}`));
  if (src.url) liens.push(lien(src.url, src.source === 'epiceries_ca' ? '🔗 épiceries.ca' : src.source === 'site_banniere' ? `🔗 Site de ${ban}` : '🔗 Source'));
  if (src.source === 'photo') liens.push('<span class="rc-vu">📷 Photo de l\'étiquette</span>');
  // Fraîcheur : en vigueur le jour de l'achat, sinon l'âge du relevé
  let vu = '', vieux = false;
  if (src.debut && src.fin && dateAchat && src.debut <= dateAchat && dateAchat <= src.fin) vu = `En vigueur le jour de l'achat (jusqu'au ${dateCourte(src.fin)})`;
  else if (src.observeLe) {
    const jours = dateAchat ? Math.round((Date.parse(dateAchat) - Date.parse(src.observeLe)) / 864e5) : 0;
    vieux = jours > 14;
    vu = `Prix vu le ${dateCourte(src.observeLe)}${jours > 60 ? ' — trop vieux pour s\'y fier' : vieux ? ' — à revérifier' : ''}`;
  }
  return `${liens.length ? `<div class="rc-preuve">${liens.join('')}</div>` : '<div class="rc-vu">Aucune preuve en ligne pour ce prix.</div>'}${vu ? `<div class="rc-vu${vieux ? ' vieux' : ''}">${esc(vu)}</div>` : ''}`;
}

/**
 * Force d'une preuve de prix (Québec) :
 *  'forte'      : photo de l'étiquette en magasin, ou circulaire de cette bannière en vigueur le jour de l'achat (prix affiché / annoncé) ;
 *  'indicative' : site de la bannière (« les prix peuvent varier »), épiceries.ca, saisie, ou relevé de plus de 14 jours.
 */
export function forcePreuve(src, dateAchat) {
  if (!src) return 'indicative';
  if (src.source === 'photo') return 'forte';
  const enVigueur = src.debut && src.fin && dateAchat ? src.debut <= dateAchat && dateAchat <= src.fin : !!(src.fin && dateAchat && src.fin >= dateAchat);
  if ((src.type === 'circulaire' || src.source === 'circulaire' || src.offreCirculaire) && src.source !== 'epiceries_ca' && src.source !== 'site_banniere' && enVigueur) return 'forte';
  return 'indicative';
}

/** Pourquoi une preuve n'est qu'indicative, en mots simples. */
function texteForce(src) {
  if (!src) return 'source introuvable';
  if (src.source === 'site_banniere' || (src.lienMarchand && !src.url)) return 'site web de la bannière';
  if (src.source === 'epiceries_ca') return 'épiceries.ca, un site qui recopie les prix';
  if (src.type === 'circulaire') return 'circulaire qui n\'était plus en vigueur';
  return 'prix noté dans l\'app';
}

/** Montant de l'écart sur la ligne entière (prix × quantité, ou × poids en kg). */
function ecartLigne(l) {
  const vd = l.verdict;
  if (vd?.paye == null || vd.attendu == null) return 0;
  const p = pesee(l);
  const qte = vd.unite === '/kg' && p ? (p.unite === 'lb' ? p.qte * 0.45359237 : p.qte) : (Number(l.quantite) || 1);
  return Math.round((vd.paye - vd.attendu) * qte * 100) / 100;
}

/** Total « à réclamer » d'un reçu : payé plus que le prix affiché de CE magasin, avec preuve forte (même règle que htmlDetail). */
export function aReclamer(r) {
  let t = 0;
  for (const l of r.lignes || []) {
    const et = etatLigne(l);
    if (et === 'hors' || et === 'verifier' || et === 'aucun' || l.verdict?.statut !== 'plus') continue;
    const src = sourcePrevu(r, l);
    if (src && r.banniere && src.banniere && src.banniere !== r.banniere) continue;
    if (forcePreuve(src, r.date) === 'forte') t += ecartLigne(l);
  }
  return Math.round(t * 100) / 100;
}

export function htmlDetail(r) {
  const champ = (lib, val) => (val != null && val !== '' ? `<tr><td class="doux">${esc(lib)}</td><td>${esc(String(val))}</td></tr>` : '');
  const v = r.statut === 'lu' ? verifierRecu(r) : null;
  const cons = consignes(r.lignes || []);
  const NATURE = { consigne: '♻️ Consigne', coupon: '🎟️ Coupon', sac: '🛍️ Sac', frais: '🧾 Frais' };
  const ban = r.banniere ? nomBanniere(r.banniere) : 'ce magasin';
  const deBan = `${/^[aeiouyàâéèêîôû]/i.test(ban) ? 'd’' : 'de '}${esc(ban)}`;   // « d’IGA », « de Metro »
  const pu = (x, u) => `${argent(x)}${u || ''}`;
  const nomDe = (l, i) => {
    const et = etatLigne(l), nat = natureLigne(l);
    const n = et === 'hors' && nat !== 'produit' ? `${NATURE[nat]} · ${l.libelle}` : (l.nomClair || l.nomEnLigne || l.libelle);
    return n + (l.quantite > 1 && !pesee(l) ? ` ×${l.quantite}` : cons[i] ? ' ♻️' : '');
  };
  const sousRabais = (l) => (l.rabais ? (soustrait(l) ? `rabais ${argent(l.rabais)}, dont −${argent(soustrait(l))} à la caisse` : `rabais ${argent(l.rabais)} déjà déduit`) : '');
  const etat = S.get();
  const notes = (l) => (etatLigne(l) === 'hors' && !l.articleId ? '' : htmlNotesLigne(etat, r, l));   // sac, consigne… : pas de notes
  const ligne = (l, i, sous = '', cls = '') => `<li class="rc-l ${etatLigne(l)} ${cls}" data-ligne="${i}"><span class="rc-nom">${esc(nomDe(l, i))}${sous ? `<span class="rc-sous">${sous}</span>` : ''}${notes(l)}</span><span class="rc-px">${argent(l.prix)}</span></li>`;

  // Tri des lignes
  const L = r.lignes || [];
  // Payé plus cher : « à réclamer » seulement avec une preuve FORTE (photo de l'étiquette, circulaire de ce magasin en vigueur) ;
  // un prix de site web (« les prix peuvent varier »), d'épiceries.ca ou trop vieux → « à vérifier en magasin » (demande de Chris, 22 nov. 2026)
  const G = { verifier: [], ici: [], indicatif: [], ailleurs: [], ok: [], moins: [], sans: [], hors: [] };
  L.forEach((l, i) => {
    const et = etatLigne(l), st = l.verdict?.statut;
    if (et === 'hors') G.hors.push(i);
    else if (et === 'verifier' || et === 'aucun') G.verifier.push(i);
    else if (st === 'plus') {
      const src = sourcePrevu(r, l);
      if (src && r.banniere && src.banniere && src.banniere !== r.banniere) G.ailleurs.push(i);
      else (forcePreuve(src, r.date) === 'forte' ? G.ici : G.indicatif).push(i);
    }
    else if (st === 'ok') G.ok.push(i);
    else if (st === 'moins') G.moins.push(i);
    else G.sans.push(i);
  });
  const parEcart = (a, b) => ecartLigne(L[b]) - ecartLigne(L[a]);
  G.ici.sort(parEcart); G.indicatif.sort(parEcart); G.ailleurs.sort(parEcart);
  const totIci = Math.round(G.ici.reduce((s, i) => s + ecartLigne(L[i]), 0) * 100) / 100;
  const totIndicatif = Math.round(G.indicatif.reduce((s, i) => s + ecartLigne(L[i]), 0) * 100) / 100;
  const totAilleurs = Math.round(G.ailleurs.reduce((s, i) => s + ecartLigne(L[i]), 0) * 100) / 100;
  const bansAilleurs = [...new Set(G.ailleurs.map((i) => sourcePrevu(r, L[i])?.banniere).filter(Boolean).map(nomBanniere))];

  // Carte d'un écart (ici : à réclamer ; ailleurs : info pour la prochaine fois)
  // genre : 'ici' (à réclamer, preuve forte) · 'indicatif' (même magasin, prix indicatif) · 'ailleurs'
  const carte = (i, genre) => {
    const ici = genre !== 'ailleurs';
    const l = L[i], vd = l.verdict, src = sourcePrevu(r, l);
    const raisons = (vd.explication || []).filter((x) => !/Politique d'exactitude/.test(x));
    const memeTexte = (x, y) => String(x).replace(/\s/g, '') === String(y).replace(/\s/g, '');
    const offreSrc = src?.offre && !memeTexte(src.offre, pu(vd.attendu, vd.unite)) ? ` · ${esc(src.offre)}${src.format ? ` ${esc(src.format)}` : ''}` : '';
    return `<li class="rc-carte ${genre}" data-ligne="${i}">
      <div class="rc-c1"><span>${esc(nomDe(l, i))}${notes(l)}</span><span class="rc-ecart">${ici ? '+' : '−'}${argent(Math.abs(ecartLigne(l)))}</span></div>
      <dl class="rc-comp">
        <dt>Payé</dt><dd><b>${pu(vd.paye, vd.unite)}</b>${vd.unite || Number(l.quantite) > 1 ? ` <span class="doux">(${argent(l.prix)})</span>` : ''}</dd>
        <dt>${ici ? 'Affiché' : 'Ailleurs'}</dt><dd>${pu(vd.attendu, vd.unite)} <span class="doux">· ${esc(nomBanniere(src?.banniere || vd.banniere || r.banniere))}${offreSrc}</span></dd>
        ${l.rabais ? `<dt>Rabais</dt><dd>${esc(sousRabais(l))}</dd>` : ''}
        <dt>Facture</dt><dd class="doux">${esc(l.libelle)}${l.poids ? ` · ${esc(l.poids)}` : ''}</dd>
      </dl>
      ${raisons.length ? `<div class="rc-pourquoi">${raisons.map(esc).join(' ')}</div>` : ''}
      ${htmlPreuvePrevu(src, r.date)}
      ${genre === 'ici' ? `<div class="rc-droit">Preuve forte : ${src?.source === 'photo' ? 'étiquette photographiée en magasin' : `circulaire ${deBan} en vigueur ce jour-là`}. Politique d'exactitude des prix — article gratuit jusqu'à 15 $. Montre la preuve et ton reçu au service à la clientèle.</div>`
        : genre === 'indicatif' ? `<div class="rc-indicatif">Prix indicatif (${esc(texteForce(src))}) : il peut varier d'une succursale à l'autre. Vérifie l'étiquette en magasin et prends-la en photo : c'est elle qui compte.</div>` : ''}
    </li>`;
  };
  const groupe = (titre, ids, sous) => (ids.length
    ? `<details class="rc-groupe"><summary>${titre}<span class="rc-n">${ids.length}</span></summary><ul class="rc-liste">${ids.map((i) => ligne(L[i], i, sous(L[i]))).join('')}</ul></details>` : '');

  const alerte = !v ? '<div class="alerte">⏳ Pas encore lu (en attente du réseau).</div>'
    : v.ok ? '' : `<div class="alerte">⚠️ À vérifier : ${v.problemes.map(esc).join(' ')}</div>`;
  const date = r.date ? new Date(`${r.date}T12:00`).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const quand = [date, r.heure ? r.heure.replace(':', ' h ') : '', r.nombreArticles != null ? `${r.nombreArticles} articles` : '', r.modePaiement].filter(Boolean);
  return `${alerte}
    <div class="rc-tete">
      <div class="rc-mag">${esc(r.magasin || ban)}</div>
      <div class="rc-quand">${quand.map(esc).join(' · ')}</div>
      <div class="rc-chiffres">
        <div><b>${r.total != null ? argent(r.total) : '—'}</b><span>payé</span></div>
        <div class="vert"><b>${r.economies != null ? argent(r.economies) : '—'}</b><span>économisé</span></div>
        <div class="${totIci > 0 ? 'rouge' : 'vert'}"><b>${argent(totIci)}</b><span>${totIci > 0 ? 'à réclamer (preuve forte)' : 'à réclamer : aucun écart prouvé'}</span></div>
      </div>
      ${totIndicatif > 0 ? `<div class="rc-indicatif-tete">🔎 ${argent(totIndicatif)} de plus que le prix indicatif ${deBan} : à vérifier en magasin</div>` : ''}
      ${totAilleurs > 0 ? `<div class="rc-ailleurs-tete">💡 ${argent(totAilleurs)} de moins ailleurs (${esc(bansAilleurs.join(', '))})</div>` : ''}
    </div>
    ${G.verifier.length ? `<h3 class="rc-h">À vérifier <span class="doux">touche une ligne pour confirmer ou changer le produit</span></h3>
      <ul class="rc-liste">${G.verifier.map((i) => ligne(L[i], i, etatLigne(L[i]) === 'aucun' ? 'Aucun produit associé' : 'Produit à confirmer', 'a-voir')).join('')}</ul>` : ''}
    ${G.ici.length ? `<h3 class="rc-h">Payé plus que le prix affiché chez ${esc(ban)} <span class="doux">à réclamer</span></h3><ul class="rc-liste rc-cartes">${G.ici.map((i) => carte(i, 'ici')).join('')}</ul>` : ''}
    ${G.indicatif.length ? `<h3 class="rc-h">Plus cher que le prix indicatif ${deBan} <span class="doux">à vérifier en magasin</span></h3><ul class="rc-liste rc-cartes">${G.indicatif.map((i) => carte(i, 'indicatif')).join('')}</ul>` : ''}
    ${G.ailleurs.length ? `<h3 class="rc-h">Moins cher ailleurs <span class="doux">pour la prochaine fois</span></h3><ul class="rc-liste rc-cartes">${G.ailleurs.map((i) => carte(i, 'ailleurs')).join('')}</ul>` : ''}
    <h3 class="rc-h">Le reste du reçu</h3>
    ${groupe('✓ Au bon prix', G.ok, (l) => sousRabais(l))}
    ${groupe('↓ Moins cher que prévu', G.moins, (l) => `<span class="rc-vert">${argent(Math.abs(ecartLigne(l)))} de moins que prévu (${pu(l.verdict.attendu, l.verdict.unite)})</span>${l.rabais ? ` · ${sousRabais(l)}` : ''}`)}
    ${groupe('Sans prix pour comparer', G.sans, () => 'Aucun prix connu avant l\'achat')}
    ${groupe('Hors produits', G.hors, () => '')}
    <details id="rcEntierBloc" class="rc-groupe"><summary>🧾 Photos du reçu</summary><div id="rcEntier"></div></details>
    <details class="rc-groupe"><summary>Détails de la facture</summary><div class="rc-details">
      <table class="comp">${champ('Bannière', r.banniere && nomBanniere(r.banniere))}${champ('Succursale', r.magasin)}${champ('Adresse', r.adresse)}${champ('Téléphone', r.telephone)}
      ${champ('Date', r.date)}${champ('Heure', r.heure)}${champ('Caisse', r.caisse)}${champ('Caissier', r.caissier)}${champ('Transaction', r.transaction)}
      ${champ('Nombre d\'articles', r.nombreArticles)}${champ('Sous-total', r.sousTotal != null ? argent(r.sousTotal) : null)}
      ${champ('TPS', r.tps != null ? argent(r.tps) : null)}${champ('TVQ', r.tvq != null ? argent(r.tvq) : null)}${champ('Total', r.total != null ? argent(r.total) : null)}
      ${champ('Économies', r.economies != null ? argent(r.economies) : null)}${champ('Paiement', r.modePaiement)}${champ('Programme', r.programmeFidelite)}
      ${champ('Points gagnés', r.pointsGagnes)}${champ('Solde de points', r.soldePoints)}${(r.autres || []).map((x) => champ(x.libelle, x.valeur)).join('')}</table>
      ${v?.resume ? `<p class="doux">${esc(v.resume)}</p>` : ''}
      ${r.texte ? `<details style="margin-top:8px"><summary class="doux">Texte lu</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(r.texte)}</pre></details>` : ''}</div></details>
    <button class="btn rv-principal" id="rcTermine" style="margin-top:14px">✓ Terminé</button>
    <div class="rv-note">Tes corrections sont déjà enregistrées.</div>`;
}
