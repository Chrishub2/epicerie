// =====================================================================
// Fiche produit de la Console : construit les données d'une fiche à partir des VRAIES données
// (objets Supabase : article + prix), au format attendu par la page fiche (maquette v112).
// Port en JavaScript de l'instantané des 10 produits (construire_reels.py, 21 nov.) : mêmes règles.
// Lecture seule : rien n'est écrit.
// =====================================================================

import { definirCaracteristique, definirRemplacement } from '../choix.js';
import { codeSaisi } from '../produits.js';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SRC = { circulaire: 'Circulaire', flipp: 'Circulaire', epiceries_ca: 'En ligne', recu: 'Reçu', photo: 'Vu en magasin', manuel: 'Vu en magasin' };
const LB = 0.45359;
// Marques fréquentes, reconnues au début ou au milieu du nom lu (complétées par les marques de la fiche)
import { MARQUES } from '../marques.js';
export { MARQUES };

/** « 4,99 $ » → [4.99, ''] ; « 1,99 $/lb » → [1.99, 'lb'] ; illisible → [null, '']. */
export function prixDe(o) {
  const m = String(o || '').match(/^\s*(\d+[.,]?\d*)\s*\$\s*(\/\s*(lb|kg))?/);
  return m ? [Number(m[1].replace(',', '.')), m[3] || ''] : [null, ''];
}

/** Quantité dans l'unité de comparaison (kg, L ou rouleaux) lue dans un texte ; null si inconnue ou ambiguë. */
export function quantite(texte, unite) {
  const t = String(texte || '').toLowerCase().replace(/,/g, '.');
  if (unite === 'u') {
    const vals = new Set([...t.matchAll(/(\d+)\s*rouleaux|rouleaux\s*(\d+)|paq\.\s*de\s*(\d+)/g)].map((m) => Number(m[1] || m[2] || m[3])));
    return vals.size === 1 ? [...vals][0] : null;
  }
  const vals = new Set([...t.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|lb|l|ml)\b/g)].map(([, n, u]) => {
    const x = Number(n);
    return Math.round({ kg: x, g: x / 1000, lb: x * LB, l: x, ml: x / 1000 }[u] * 10000) / 10000;
  }));
  return vals.size === 1 ? [...vals][0] : null;
}

// Texte comparable : minuscules, sans accents, « 2 % » = « 2% », espaces simples
const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*%/g, '%').replace(/\s+/g, ' ').trim();
const slug = (t) => normal(t).replace(/[^a-z0-9%]+/g, '-').replace(/%/g, '').replace(/^-|-$/g, '');
/** Valeurs de sorte du référentiel (« salé, non salé ») ; « selon… » n'est pas une valeur. */
export const valeursSorte = (txt) => String(txt || '').split(/,\s+/)   /* « 3,25 % » reste entier */.map((v) => v.trim().replace(/…$/, '').trim()).filter((v) => v && !/^selon/i.test(v));
// Sortes enregistrées en code sans accents (correspondance) qui ne sont pas dans les valeurs du référentiel : leur nom écrit
const LIBELLES_SORTE = {
  'ble-entier': 'blé entier', desossee: 'désossée', 'flocons-de-mais-givres': 'flocons de maïs givrés', '100-pur': '100 % pur',
  'melange-pour-sauce': 'mélange pour sauce', mais: 'maïs', rape: 'râpé', 'en-des': 'en dés', legumes: 'légumes', 'nacho-epice': 'nacho épicé',
  etuve: 'étuvé', assaisonne: 'assaisonné', 'soda-sales': 'soda salés', 'melon-d-eau-pomme': 'melon d’eau et pomme', regulier: 'régulier',
  reguliere: 'régulière', 'sans-sel-ajoute': 'sans sel ajouté', 'carres-de-mais': 'carrés de maïs', proteine: 'protéiné', gaufre: 'gaufré',
  'a-l-ancienne': 'à l’ancienne', fume: 'fumé', sale: 'salé', 'non-sale': 'non salé',
};
/** Étiquette de la sorte enregistrée : « sale » → « salé » (valeurs du référentiel, sinon nom écrit connu, sinon tirets → espaces). */
export function etiquetteSorte(ref, valeurs) {
  if (!ref || ref === 'a-preciser') return null;
  return valeurs.find((v) => slug(v) === slug(ref)) || LIBELLES_SORTE[ref] || String(ref).replace(/-/g, ' ');
}
/**
 * La sorte de la fiche est-elle dite dans le nom lu ? (Chris, 21 nov. : salé et non salé sont deux produits ;
 * sans précision = doute → à confirmer, jamais classé tout seul.)
 * Rend null si c'est bien la sorte, sinon la raison (à confirmer).
 */
export function raisonSorte(nomLu, etiquette, valeurs) {
  if (!etiquette || !nomLu) return null;
  let t = normal(nomLu);
  // Sorte hors des valeurs du référentiel (ex. « désossée » pour une coupe) : on vérifie seulement qu'elle est dite
  const connue = valeurs.some((v) => slug(v) === slug(etiquette));
  const autres = (connue ? valeurs : []).filter((v) => slug(v) !== slug(etiquette)).sort((a, b) => b.length - a.length).filter((v) => {
    const n = normal(v); if (!t.includes(n)) return false;
    t = t.split(n).join(' | ');   // « non salé » retiré avant de chercher « salé »
    return true;
  });
  const dite = t.includes(normal(etiquette));
  if (autres.length && dite) return `Offre double (${etiquette} ou ${autres.join(' ou ')}) : vérifier laquelle`;
  if (autres.length) return `Autre sorte : ${autres.join(', ')} (pas ${etiquette})`;
  if (!dite) return `Sorte non précisée : ${etiquette} ?`;
  return null;
}

/**
 * Lien de la source d'un prix (Chris, 21 nov.) :
 *  - en ligne (épiceries.ca) : la page du produit chez l'épicier ;
 *  - circulaire ou Flipp : la circulaire en ligne de la bannière, SEULEMENT tant que le rabais dure
 *    (les images des pages lues sont effacées après lecture ; après la fin, la circulaire en ligne est celle d'une autre semaine) ;
 *  - reçu, vu en magasin : aucun lien.
 */
export function lienSource(p, opts = {}) {
  if (p.source === 'epiceries_ca') return p.lienMarchand || p.url || null;
  if (p.source === 'circulaire' || p.source === 'flipp') {
    const auj = opts.aujourdhui || new Date().toISOString().slice(0, 10);
    const url = opts.circulaires?.[p.banniere];
    return url && p.fin && p.fin >= auj ? url : null;
  }
  return null;
}

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Marque reconnue dans le nom lu, sinon celle de la fiche, sinon « Sans marque » (remplacée plus loin par le nom). */
export function marqueDe(np, art, marques = MARQUES) {
  const n = String(np || '').toLowerCase();
  for (const m of marques) {
    const b = m.toLowerCase();
    if (n.startsWith(b) || ` ${n} `.includes(` ${b} `)) return m.replace('Maple Leaf Prime', 'Maple Leaf');
  }
  return art.marque || 'Sans marque';
}

/** « 2026-11-21 » → « 21 nov. » */
export const jour = (d) => (d ? `${Number(d.slice(8, 10))} ${MOIS[Number(d.slice(5, 7)) - 1]}` : '');
const estMajuscules = (s) => s === s.toUpperCase() && /[A-ZÀ-Ý]/.test(s);
const capitaliser = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Données de la fiche d'un article.
 * art : data de l'objet article (avec id) ; prix : data des objets prix de cet article.
 * opts : { ref: { generiques }, corr: correspondance.json, dispo: Set des images, base: dossier des images,
 *          nomRayon, depuis: 'AAAA-MM-JJ' (prix plus anciens ignorés, sauf prix annulés) }
 */
export function construireFiche(art, prix, opts = {}) {
  const aid = art.id;
  // Famille et sorte enregistrées sur le produit (fiche, étape 2) d'abord ; sinon la correspondance des visuels
  const c0 = opts.corr?.[aid] || {};
  const c = { g: art.generique || c0.g, s: art.sorte || c0.s };
  const g = c.g || '';
  const r = (g && opts.ref?.generiques?.[g]) || [opts.nomRayon || '', '', art.generiqueNom || art.nom, 'Sorte', ''];
  const valeurs = valeursSorte(r[4]);
  const etiquette = etiquetteSorte(c.s, valeurs);   // « sale » → « salé »
  const u = { kg: 'kg', l: 'l', unite: 'u' }[art.uniteRef || 'kg'] || 'kg';
  const depuis = opts.depuis || '0000';
  const marques = [...new Set([art.marque, ...(art.variantes || []).filter((v) => !v.retiree).map((v) => v.marque), ...MARQUES].filter(Boolean))]
    .sort((a, b) => b.length - a.length);   // la plus longue d'abord (« Maple Leaf Prime » avant « Maple Leaf »)
  const img = (k) => (k && opts.dispo?.has(k) ? `${opts.base || ''}${k}.jpg` : '');
  const var_ = [], liens = [], liensAnnules = [], vus = new Set();
  let annules = 0;
  const tries = prix.filter((p) => p.articleId === aid && p.source !== 'demo').sort((a, b) => String(b.observeLe || '').localeCompare(String(a.observeLe || '')));
  for (const p of tries) {
    const le = p.observeLe || '';
    if (p.annule) {
      annules++;
      const ca = `${p.banniere}|annule`;
      if (!vus.has(ca) && le >= depuis) {
        vus.add(ca);
        const [montant] = prixDe(p.offre);
        if (montant != null) {
          const ff = p.format || '?', fa = art.format || '?';
          liensAnnules.push({ id: 'l' + p.id, raison: `Prix annulé (${p.annuleRaison || 'sans raison notée'})${ff.replace(/ /g, '') !== fa.replace(/ /g, '') ? ` : format ${ff} ≠ ${fa} de la fiche` : ''}`,
            ban: p.banniere, lu: p.nomProduit || art.nom, sorte: marqueDe(p.nomProduit, art, marques), marque: p.nomProduit || '', fmt: p.format || '?',
            kg: quantite(p.format || '', u), prix: montant, unite: 'ch', reg: null, fin: null, local: false, date: jour(le), annule: true });
        }
      }
      continue;
    }
    if (le < depuis) continue;
    const np = p.nomProduit || '';
    const cle = `${p.banniere}|${np || p.format || ''}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const [montant, par] = prixDe(p.offre);
    if (montant == null) continue;
    const reg = p.prixRegulier ? Number(p.prixRegulier) : null;
    const src = SRC[p.source] || 'Circulaire';
    let m = marqueDe(np, art, marques);
    let detail = np || `${art.marque || ''} ${art.nom}`.trim();
    if (estMajuscules(detail)) detail = capitaliser(detail);   // « POITRINES DE POULET FRAIS » → « Poitrines de poulet frais »
    if (m === 'Sans marque') { m = detail; detail = '—'; }       // sans marque : le nom du produit, écrit une seule fois
    else {
      const reste = detail.replace(new RegExp(`(?<![\\p{L}\\d])${echapper(m)}(?![\\p{L}\\d])`, 'giu'), '').replace(/\s{2,}/g, ' ').replace(/^[\s\-·,]+|[\s\-·,]+$/g, '');
      detail = reste ? reste.charAt(0).toUpperCase() + reste.slice(1) : '—';   // la marque n'est pas répétée devant le nom
    }
    const base = { id: p.id, sorte: m, marque: detail, ban: p.banniere, reg, fin: p.fin || null, local: !!art.local && src === 'Reçu',
      src, date: jour(le), vu: le || null, photo: true, code: !!(art.codes?.length || art.plu?.length), lien: lienSource(p, opts) };
    let raison = null, v;
    if (par === 'lb') v = { ...base, fmt: 'Au poids', prix: montant, unite: 'lb' };
    else if (par === 'kg') v = { ...base, fmt: 'Au poids (prix au kg)', prix: montant, unite: 'ch', kg: 1 };
    else {
      let q = u !== 'u' ? quantite(`${p.format || ''} ${np}`, u) : quantite(np, u);
      if (q == null && u !== 'u') q = quantite(p.format || '', u);
      if (q == null) {
        raison = `Format inconnu ou ambigu : impossible de comparer ${{ kg: 'au kg', l: 'au litre', u: 'au rouleau' }[u]}`;
        v = { ...base, fmt: p.format || '?', prix: montant, unite: 'ch' };
      } else {
        const fq = { kg: q >= 1 ? `${q} kg` : `${Math.round(q * 1000)} g`, l: `${q} L`, u: `${q} rouleaux` }[u];
        v = { ...base, fmt: fq, prix: montant, unite: 'ch', kg: q };
      }
    }
    const bas = np.toLowerCase();
    if (bas.includes('trempette')) raison = 'Produit différent : trempette, pas du fromage à la crème';
    if (bas.includes('en grains')) raison = raison || (bas.includes('moulu') ? 'Offre double (moulu ou en grains) : vérifier lequel' : 'État différent : café en grains, pas moulu');
    // S15 + Chris (21 nov.) : la sorte doit être DITE dans le nom lu ; sinon doute → à confirmer (toutes les familles)
    raison = raison || raisonSorte(np, etiquette, valeurs);
    // Ta décision (✓ / ✗) enregistrée dans le produit : un ✓ fait compter le prix, un ✗ le garde hors de la fiche
    const dec = art.liensDecides?.['l' + p.id];
    if (raison) {
      const lien = { id: 'l' + p.id, raison, ban: v.ban, lu: np || detail, sorte: v.sorte, marque: v.marque, fmt: v.fmt, kg: v.kg ?? null, prix: v.prix,
        unite: v.unite, reg: v.reg, fin: v.fin, local: v.local, date: v.date };
      if (dec?.d === 'ok' || dec?.d === 'non') { lien.statut = dec.d; lien.decide = dec; }
      liens.push(lien);
      if (dec?.d === 'ok') var_.push({ ...v, id: 'l-' + lien.id, src: v.src });
    } else var_.push(v);
  }
  if (!var_.length) liens.push(...liensAnnules);   // prix annulés montrés seulement s'il ne reste aucun prix valide
  for (const l of liens) if (l.sorte === 'Sans marque') { const n = l.lu || art.nom; l.sorte = estMajuscules(n) ? capitaliser(n) : n; l.marque = '—'; }
  const favoris = var_.filter((v) => v.src === 'Reçu' || (art.marque && v.sorte === art.marque)).slice(0, 2).map((v) => v.id);
  const catId = g.slice(0, 7), scId = g.slice(0, 13), sorteCle = c.s || null;
  return {
    cle: aid, nom: art.nom, genId: g || null, gen: art.generiqueNom && !art.generique ? art.generiqueNom : (r[2] || art.nom), cat: r[0], sc: r[1], sorteAttr: r[3] || 'Sorte', valeursTypiques: r[4] || '',
    sorteRef: etiquette || sorteCle, unite: u, rayon: opts.nomRayon || '', nomEn: art.nomEn || '', nomsAlt: art.nomsAlt || [], nomsAltEn: art.nomsAltEn || [],
    format: art.format || '', marqueFiche: art.marque || '', annules,
    img: { cat: img(catId), sc: img(scId), gen: img(g), sorte: sorteCle ? img(`${g}~${sorteCle}`) : '' },
    codesFiche: [...(art.plu || []).map((x) => `PLU ${x}`), ...[...new Set(art.codes || [])].slice(0, 2)],
    var: var_, liens, favoris, sortes: [...new Set(var_.map((v) => v.sorte))].sort(),
  };
}


/**
 * Étape 2 : ce que tu as changé dans la fiche → nouvelles données du produit (la base n'est pas touchée ici).
 * base : données actuelles du produit ; f : état de la fiche :
 *  { sorte, seulChez, annulesVus, ignores, code, caracs: [[clé, valeur]], nomEn, alias: { fr, en },
 *    genId, genNom, genNouveau, rempl }   personne : nom du membre (règle de remplacement « pour toi »).
 * Rend { data, erreur } ; erreur (ex. code bio dans une fiche non bio) = rien à enregistrer tant que ce n'est pas corrigé.
 */
export function appliquerFiche(base, f, personne) {
  const d = JSON.parse(JSON.stringify(base));
  const vide = (v) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  // Vide : on retire le champ, sauf s'il était déjà vide dans la base (ex. nomsAlt: []) — pas de faux changement
  const mettre = (k, v) => { if (!vide(v)) d[k] = v; else if (!vide(base[k])) delete d[k]; };
  if (f.sorte) d.sorte = f.sorte;
  mettre('seulChez', f.seulChez || null);
  mettre('annulesVus', !!f.annulesVus);
  mettre('santeIgnores', f.ignores ? { ...f.ignores } : null);
  if (f.code) {
    const r = codeSaisi(String(f.code).replace(/^PLU\s*/i, ''), d);
    if (r.erreur) return { data: null, erreur: r.erreur };
    if (r.plu) d.plu = [...new Set([...(d.plu || []), r.plu])];
    else d.codes = [...new Set([...(d.codes || []), r.code])];
  }
  delete d.caracteristiques;
  for (const [k, v] of f.caracs || []) definirCaracteristique(d, k, v);   // valeurs hors dictionnaire refusées
  mettre('nomEn', (f.nomEn || '').trim());
  mettre('nomsAlt', f.alias?.fr || []);
  mettre('nomsAltEn', f.alias?.en || []);
  if (f.genNouveau && f.genNom) { delete d.generique; d.generiqueNom = f.genNom; }    // famille créée : en attente du référentiel
  else if (f.genId && f.genId !== (base.generique || f.genIdDepart)) { d.generique = f.genId; delete d.generiqueNom; }
  if (f.rempl) definirRemplacement(d, personne, f.rempl);
  // Liens ✓ / ✗ : seulement ceux décidés ; une décision inchangée garde sa date et son auteur
  if (f.liens) {
    const avant = base.liensDecides || {}, apres = {};
    const quand = f.aujourdhui || new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
    for (const l of f.liens) if (l.statut === 'ok' || l.statut === 'non') apres[l.id] = avant[l.id]?.d === l.statut ? avant[l.id] : { d: l.statut, le: quand, par: personne };
    mettre('liensDecides', apres);
  }
  // Noms corrigés des produits vendus (✎ Nom, v106) : { idPrix: { marque, lu } } ; le prix lu, lui, ne change jamais
  if (f.nomsProduits) mettre('nomsProduits', Object.keys(f.nomsProduits).length ? f.nomsProduits : null);
  return { data: d, erreur: null };
}
