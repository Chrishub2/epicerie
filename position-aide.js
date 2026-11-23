// =====================================================================
// Aide quand la position est refusée (📍 Ma position, écran Magasins)
// Un refus est retenu par le navigateur : la page ne peut plus reposer la question, et aucune page web
// ne peut ouvrir les Réglages (Apple et Google le bloquent). On donne donc les étapes exactes selon l'appareil.
// Module pur : l'appareil est déduit du userAgent passé en paramètre.
// =====================================================================

/** Appareil : 'iphone-safari' | 'iphone-chrome' | 'android' | 'ordinateur'. */
export function appareil(ua = '', points = 0) {
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && points > 1);   // iPad récent = « Macintosh » tactile
  if (iOS) return /CriOS|EdgiOS|FxiOS/.test(ua) ? 'iphone-chrome' : 'iphone-safari';
  if (/Android/.test(ua)) return 'android';
  return 'ordinateur';
}

const SITE = 'chrishub2.github.io';

/** Étapes (texte simple, sans HTML) pour redonner l'accès à la position. */
export function etapesPosition(type) {
  switch (type) {
    case 'iphone-safari': return [
      'Ouvre Réglages → Confidentialité et sécurité → Service de localisation : il doit être activé.',
      'Dans la même liste, touche « Sites web Safari » et choisis « Lorsque l’app est active ».',
      `Dans Safari, ouvre ${SITE}/epicerie, touche « aA » à gauche de l’adresse → Réglages du site web → Position → Autoriser.`,
      'Ferme complètement l’app (glisse-la hors des apps récentes), rouvre-la, puis touche Réessayer.',
    ];
    case 'iphone-chrome': return [
      'Ouvre Réglages → Confidentialité et sécurité → Service de localisation : il doit être activé.',
      'Ouvre Réglages → Apps → Chrome → Position et choisis « Lorsque l’app est active ».',
      'Reviens ici et touche Réessayer.',
    ];
    case 'android': return [
      'Touche l’icône à gauche de l’adresse → Autorisations → Position → Autoriser.',
      'Si l’app est installée sur l’écran d’accueil : appui long sur son icône → Infos sur l’appli → Autorisations → Position → Autoriser.',
      'Reviens ici et touche Réessayer.',
    ];
    default: return [
      'Clique sur l’icône à gauche de l’adresse (réglages ou cadenas) → Position → Autoriser.',
      'Recharge la page, puis clique Réessayer.',
    ];
  }
}

/** Message pour une erreur de géolocalisation : refus (code 1) → fenêtre d'aide ; sinon → simple note. */
export function messagePosition(err) {
  return err?.code === 1
    ? { refus: true }
    : { refus: false, note: 'Position introuvable pour l’instant (signal faible ?). Réessaie dans un moment ; je garde ton secteur.' };
}
