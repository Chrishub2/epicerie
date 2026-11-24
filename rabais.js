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

// ---------------------------------------------------------------------
// v147 (audit du 2026-11-23, règles de Chris) — le « prix d'aujourd'hui » d'une bannière
//  - un prix régulier vu il y a plus de 60 jours (ou sans date) est « ancien » : gris, hors calcul ;
//  - un rabais qui commence plus tard est « à venir » : pas compté avant sa date de début ;
//  - un prix de démonstration n'est jamais compté ;
//  - par bannière (et variante), le prix le plus récent gagne ; un rabais encore valide plus bas passe devant.
// ---------------------------------------------------------------------
export const FENETRE_PRIX_JOURS = 60;

/** Date où le prix a été vu (« AAAA-MM-JJ ») : observeLe, sinon début du rabais ; null si inconnue. */
export function dateDuPrix(p) {
  const d = String(p?.observeLe || p?.debut || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function joursEntre(de, a) {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 864e5);
}

/**
 * État d'un prix aujourd'hui, à appliquer APRÈS prixEnVigueur :
 * 'demo' | 'aVenir' | 'ancien' | 'courant'.
 * Sans date : un rabais avec une date de fin encore valide reste courant ; tout le reste est ancien.
 */
export function etatPrix(p, auj, fenetre = FENETRE_PRIX_JOURS) {
  if (!p) return 'ancien';
  if (p.source === 'demo') return 'demo';
  const debut = String(p.debut || '').slice(0, 10);
  if (debut && debut > auj) return 'aVenir';
  const d = dateDuPrix(p);
  if (!d) return estRabaisPrix(p) && p.fin && p.fin >= auj ? 'courant' : 'ancien';
  return joursEntre(d, auj) > fenetre ? 'ancien' : 'courant';
}

/** Âge d'un prix en jours (null si date inconnue). */
export function agePrix(p, auj) {
  const d = dateDuPrix(p);
  return d ? joursEntre(d, auj) : null;
}

/**
 * Parmi les prix courants d'une même bannière (et variante) : celui d'aujourd'hui.
 * `valeur(l)` = prix comparable (au kg / L / unité). Le plus récent gagne (à date égale : le dernier arrivé) ;
 * un rabais encore valide plus bas que lui passe devant. Rend null si la liste est vide.
 */
export function prixDuJour(lignes, valeur) {
  if (!lignes.length) return null;
  const tri = lignes.map((l, i) => ({ l, i, d: dateDuPrix(l) || '' }))
    .sort((a, b) => b.d.localeCompare(a.d) || b.i - a.i);
  let choix = tri[0].l, vc = valeur(choix);
  for (const { l } of tri.slice(1)) {
    const v = valeur(l);
    if (estRabaisPrix(l) && v != null && (vc == null || v < vc - 1e-9)) { choix = l; vc = v; }
  }
  return choix;
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
