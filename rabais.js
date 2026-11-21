// =====================================================================
// Fin des rabais (décidé avec Chris le 2026-11-20, maquette fiche produit v71).
// Module PUR, sans dépendance au DOM ni au store.
//  1. Un rabais dont la date de fin est passée ne compte plus.
//  2. Un rabais SANS date de fin dure 7 jours après la date où il a été vu
//     (durée habituelle d'une circulaire).
//  3. À la fin d'un rabais, si le prix régulier est connu, on garde l'offre
//     à ce prix régulier au lieu de la retirer (la bannière reste comparée).
// Les dates sont des « AAAA-MM-JJ » à l'heure du Québec.
// =====================================================================

export const DUREE_RABAIS_JOURS = 7;

function plusJours(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Le prix est-il un rabais (circulaire, spécial) ou plus bas que son régulier connu ? */
export function estRabaisPrix(p) {
  if (!p) return false;
  if (p.type && p.type !== 'regulier') return true;
  return p.prixRegulier != null && p.prixNum != null && p.prixRegulier > p.prixNum + 0.004;
}

/** Dernier jour où le rabais compte : sa date de fin, sinon 7 jours après la date où il a été vu ; null si ce n'est pas un rabais. */
export function finRabais(p) {
  if (!p) return null;
  if (p.fin) return p.fin;
  if (!estRabaisPrix(p) || !p.observeLe) return null;
  return plusJours(String(p.observeLe).slice(0, 10), DUREE_RABAIS_JOURS);
}

/**
 * Le prix tel qu'il compte aujourd'hui (`auj` = « AAAA-MM-JJ ») :
 *  - le prix lui-même s'il est régulier ou si son rabais court encore ;
 *  - une copie au prix régulier (type 'regulier', rabaisFiniLe) si le rabais est fini et le régulier connu ;
 *  - null si le rabais est fini et qu'on ne connaît pas le régulier.
 */
export function prixEnVigueur(p, auj) {
  const fin = finRabais(p);
  if (!fin || fin >= auj) return p;
  if (!(p.prixRegulier > 0)) return null;
  const suffixe = (/\$\s*(\/\s*(?:100\s*g|100\s*ml|kg|lb|ml|l))\b/i.exec(String(p.offre ?? ''))?.[1] || '').replace(/\s+/g, '');
  const texte = p.prixRegulier.toFixed(2).replace('.', ',');
  const k = p.prixNum > 0 ? p.prixRegulier / p.prixNum : null;
  return {
    ...p,
    type: 'regulier',
    offre: suffixe ? `${texte} $${suffixe}` : p.prixRegulier,
    prixNum: p.prixRegulier,
    prixRegulier: null,
    fin: null,
    uniteSource: p.uniteSource && k ? { ...p.uniteSource, pu: p.uniteSource.pu * k } : null,
    rabaisFiniLe: fin,
  };
}
