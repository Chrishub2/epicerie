// =====================================================================
// Couverture des circulaires : courante / suivante par source.
// Module PUR, sans dépendance : partagé par l'app, la console (circulaires.js)
// et l'extension Flipp (qui en garde une copie). Mêmes règles que
// agents/envoi_logique.couverture :
//  - courante : debut ≤ aujourd'hui ≤ fin, la circulaire qui a le plus de rabais ;
//  - suivante : debut > aujourd'hui, la plus proche, puis celle qui a le plus de rabais.
// Aujourd'hui = date à l'heure du Québec (America/Toronto).
// =====================================================================

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « AAAA-MM-JJ » de `date` à l'heure du Québec. */
export function jourQuebec(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * offres : lignes { source, debut, fin } NON groupées (une par rabais) ; dates AAAA-MM-JJ.
 * sources : [{ id, nom }] (ordre conservé). Retourne [{ id, nom, courante, suivante }],
 * où courante / suivante = { debut, fin, rabais } ou null.
 */
export function couverture(offres, sources, aujourdhui) {
  const comptes = new Map();   // "source|debut|fin" → { source, debut, fin, n }
  for (const o of offres || []) {
    if (!o?.debut || !o?.fin) continue;
    const k = `${o.source}|${o.debut}|${o.fin}`;
    const g = comptes.get(k);
    if (g) g.n++; else comptes.set(k, { source: o.source, debut: o.debut, fin: o.fin, n: 1 });
  }
  const groupes = [...comptes.values()];
  const fmt = (o) => (o ? { debut: o.debut, fin: o.fin, rabais: o.n } : null);
  return sources.map((s) => {
    const siennes = groupes.filter((o) => o.source === s.id);
    let cour = null, suiv = null;
    for (const o of siennes) {
      if (o.debut <= aujourdhui && aujourdhui <= o.fin) { if (!cour || o.n > cour.n) cour = o; }
      else if (o.debut > aujourdhui) {
        if (!suiv || o.debut < suiv.debut || (o.debut === suiv.debut && o.n > suiv.n)) suiv = o;
      }
    }
    return { id: s.id, nom: s.nom, courante: fmt(cour), suivante: fmt(suiv) };
  });
}

/** « 19 au 25 nov. » ou « 29 oct. au 4 nov. ». */
export function periode(debut, fin) {
  const [, m1, j1] = debut.split('-').map(Number);
  const [, m2, j2] = fin.split('-').map(Number);
  return m1 === m2 ? `${j1} au ${j2} ${MOIS[m2 - 1]}` : `${j1} ${MOIS[m1 - 1]} au ${j2} ${MOIS[m2 - 1]}`;
}

/** Contenu d'une case : ✓ (bulle : dates et nombre de rabais) ou ✗. */
export function celluleHtml(c) {
  if (!c) return '<span class="cv-non" title="Pas dans ta base">✗</span>';
  return `<span class="cv-oui" title="${esc(`${periode(c.debut, c.fin)} · ${c.rabais} rabais`)}">✓</span>`;
}

/** Tableau Bannière / Courante / Suivante, une ligne par source. */
export function tableauHtml(lignes) {
  return `<table class="cv-table"><thead><tr><th scope="col">Bannière</th><th scope="col">Courante</th><th scope="col">Suivante</th></tr></thead><tbody>${
    (lignes || []).map((l) => `<tr><td>${esc(l.nom)}</td><td>${celluleHtml(l.courante)}</td><td>${celluleHtml(l.suivante)}</td></tr>`).join('')
  }</tbody></table>`;
}
