// =====================================================================
// Calendrier de l'en-tête (2026-11-20, demandé par Chris ; même règles que la maquette de la fiche produit v98-v99).
// Module PUR : rend le HTML ; aucune dépendance au store.
//  - 2 rangées de 7 jours, chacune commence un dimanche (cette semaine et la suivante) ;
//  - lettre du jour au-dessus de chaque colonne (D L M M J V S) ;
//  - samedi et dimanche plus foncés ; aujourd'hui en jaune transparent avec un cadre jaune ;
//  - trait gras entre mercredi et jeudi : les rabais des circulaires vont normalement du jeudi au mercredi ;
//  - mois du premier dimanche à gauche, mois du dernier samedi à droite.
// =====================================================================

const LETTRES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/** Les 14 jours affichés : du dimanche de la semaine de `maintenant` au samedi de la semaine suivante. */
export function joursCalendrier(maintenant = new Date()) {
  const auj = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  const debut = new Date(auj); debut.setDate(auj.getDate() - auj.getDay());
  return Array.from({ length: 14 }, (_, i) => { const d = new Date(debut); d.setDate(debut.getDate() + i); return d; });
}

/** HTML du calendrier. court : mois abrégés (« nov. ») pour un écran étroit. */
export function calendrierHtml(maintenant = new Date(), { court = false } = {}) {
  const jours = joursCalendrier(maintenant);
  const auj = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate()).toDateString();
  const mois = (d) => d.toLocaleDateString('fr-CA', { month: court ? 'short' : 'long' });
  const long = (d) => d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lettres = LETTRES.map((l, c) => `<span class="cal-l${c === 0 || c === 6 ? ' fds' : ''}" style="grid-column:${c + 1};grid-row:1">${l}</span>`).join('');
  const cases = jours.map((d, i) => {
    const c = i % 7, cls = ['cal-j', c === 0 || c === 6 ? 'fds' : '', d.toDateString() === auj ? 'auj' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}" style="grid-column:${c + 1};grid-row:${Math.floor(i / 7) + 2}" title="${long(d)}">${d.getDate()}</span>`;
  }).join('');
  return `<span class="cal-m">${mois(jours[0])}</span><div class="cal-g">${lettres}${cases}`
    + '<span class="cal-coupure" style="grid-column:5;grid-row:1 / 4" title="Les rabais des circulaires vont normalement du jeudi au mercredi"></span></div>'
    + `<span class="cal-m">${mois(jours[13])}</span>`;
}
