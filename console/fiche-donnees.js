// =====================================================================
// Fiche produit de la Console : construit les données d'une fiche à partir des VRAIES données
// (objets Supabase : article + prix), au format attendu par la page fiche (maquette v112).
// Port en JavaScript de l'instantané des 10 produits (construire_reels.py, 21 nov.) : mêmes règles.
// Lecture seule : rien n'est écrit.
// =====================================================================

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SRC = { circulaire: 'Circulaire', flipp: 'Circulaire', epiceries_ca: 'En ligne', recu: 'Reçu', photo: 'Vu en magasin', manuel: 'Vu en magasin' };
const LB = 0.45359;
// Marques fréquentes, reconnues au début ou au milieu du nom lu (complétées par les marques de la fiche)
export const MARQUES = ['Maple Leaf Prime', 'Maple Leaf', 'Maxwell House', 'Giant Value', 'Gay Lea', 'Liberté', 'Lactantia', 'Président', 'Villaggio', 'Olymel', 'Nabob',
  'Irrésistible', 'Cashmere', 'Selection', 'Cascades', 'Savvy', 'Royale', 'Philadelphia', 'Dainty', 'Kimora', 'PC', 'Natrel', 'Québon', 'Sélection', 'Compliments', 'Kirkland'];

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
  const c = opts.corr?.[aid] || {};
  const g = c.g || '';
  const r = (g && opts.ref?.generiques?.[g]) || [opts.nomRayon || '', '', art.nom, 'Sorte', ''];
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
      src, date: jour(le), vu: le || null, photo: true, code: !!(art.codes?.length || art.plu?.length) };
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
    // S15 : la teneur en gras est la sorte ; un prix dont le nom ne la dit pas ne se compare pas (dans le doute, on ne rattache pas)
    if (/teneur/i.test(r[3]) && c.s && np && !bas.includes(String(c.s).toLowerCase())) raison = raison || `Teneur non indiquée : ${(r[2] || art.nom).toLowerCase()} ${c.s} % ?`;
    if (raison) liens.push({ id: 'l' + p.id, raison, ban: v.ban, lu: np || detail, sorte: v.sorte, marque: v.marque, fmt: v.fmt, kg: v.kg ?? null, prix: v.prix,
      unite: v.unite, reg: v.reg, fin: v.fin, local: v.local, date: v.date });
    else var_.push(v);
  }
  if (!var_.length) liens.push(...liensAnnules);   // prix annulés montrés seulement s'il ne reste aucun prix valide
  for (const l of liens) if (l.sorte === 'Sans marque') { const n = l.lu || art.nom; l.sorte = estMajuscules(n) ? capitaliser(n) : n; l.marque = '—'; }
  const favoris = var_.filter((v) => v.src === 'Reçu' || (art.marque && v.sorte === art.marque)).slice(0, 2).map((v) => v.id);
  const catId = g.slice(0, 7), scId = g.slice(0, 13), sorteRef = c.s || null;
  return {
    cle: aid, nom: art.nom, gen: r[2] || art.nom, cat: r[0], sc: r[1], sorteAttr: r[3] || 'Sorte', valeursTypiques: r[4] || '',
    sorteRef, unite: u, rayon: opts.nomRayon || '', nomEn: art.nomEn || '', nomsAlt: art.nomsAlt || [],
    format: art.format || '', marqueFiche: art.marque || '', annules,
    img: { cat: img(catId), sc: img(scId), gen: img(g), sorte: sorteRef ? img(`${g}~${sorteRef}`) : '' },
    codesFiche: [...(art.plu || []).map((x) => `PLU ${x}`), ...[...new Set(art.codes || [])].slice(0, 2)],
    var: var_, liens, favoris, sortes: [...new Set(var_.map((v) => v.sorte))].sort(),
  };
}
