// Choix de « skin » (apparence). Aucun lien avec les données : ne fait que poser
// <html data-skin="..."> et charger les polices du skin. Le choix est gardé sur ce téléphone.
// Ajouter un skin : 1) créer skins/<id>.css (tout préfixé par :root[data-skin="<id>"]),
// 2) l'ajouter dans SKINS ci-dessous, 3) ajouter son <link> dans index.html et son fichier dans sw.js.

const GF = 'https://fonts.googleapis.com/css2?family=';

// apercu : [fond, carte, accent, texte] pour la vignette de choix.
export const SKINS = [
  { id: 'classique', nom: 'Classique', description: "L'apparence d'origine", apercu: ['#f5f6f3', '#ffffff', '#1f7a4d', '#1d2320'], polices: null },
  { id: 'pro', nom: 'Professionnel', description: 'Sobre, prix alignés', apercu: ['#f4f6f8', '#ffffff', '#0e7c66', '#12161c'],
    polices: GF + 'Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap' },
  { id: 'etiquette', nom: 'Étiquette', description: 'Étiquettes de tablette', apercu: ['#d3d7d0', '#ffd60a', '#c8102e', '#111111'],
    polices: GF + 'Archivo+Black&family=Archivo:wght@500;700;800&family=JetBrains+Mono:wght@500;700&display=swap' },
  { id: 'ludique', nom: 'Amusant', description: 'Couleurs franches, gros contours', apercu: ['#ffe45c', '#ffffff', '#ff5a36', '#1a1033'],
    polices: GF + 'Fredoka:wght@500;600;700&family=Nunito:wght@600;700;800&display=swap' },
  { id: 'potager', nom: 'Potager', description: 'Vert sauge et betterave', apercu: ['#eef3ea', '#1f3d2b', '#8e2c55', '#1f3d2b'],
    polices: GF + 'Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,400&family=Manrope:wght@400;500;600;700&display=swap' },
  { id: 'doux', nom: 'Doux', description: 'Pastels, tout en rondeur', apercu: ['#f5f1fa', '#ffe7dc', '#7a5cc9', '#3b3352'],
    polices: GF + 'Quicksand:wght@500;600;700&family=Nunito+Sans:wght@400;600;700&display=swap' },
  { id: 'party', nom: 'Party', description: 'Néons sur fond nuit', apercu: ['#14061f', '#24102f', '#ff2e93', '#c6ff3d'],
    polices: GF + 'Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Space+Mono:wght@400;700&display=swap' },
  { id: 'futuriste', nom: 'Futuriste', description: 'Écran de navigation', apercu: ['#060a18', '#0e1e38', '#5cf2ff', '#ff6ad5'],
    polices: GF + 'Orbitron:wght@500;700;800&family=Chakra+Petch:wght@400;500;600&display=swap' },
  { id: 'metal', nom: 'Métallisé', description: 'Acier brossé et cuivre', apercu: ['#1a1d21', '#2a2e34', '#d9dde1', '#c98a4b'],
    polices: GF + 'Michroma&family=Barlow:wght@400;500;600;700&family=Share+Tech+Mono&display=swap' },
  { id: 'electro', nom: 'Électronique', description: 'Circuit et écran ACL', apercu: ['#0c3a25', '#141614', '#5dff8f', '#a8c49a'],
    polices: GF + 'VT323&family=IBM+Plex+Mono:wght@400;500;600&display=swap' },
  { id: 'musique', nom: 'Musique', description: 'Ta liste en playlist', apercu: ['#0f1e24', '#142830', '#ff7a3d', '#f4ece0'],
    polices: GF + 'Syne:wght@600;800&family=Inter:wght@400;500;600&display=swap' },
  { id: 'sport', nom: 'Sport', description: 'Tableau de pointage', apercu: ['#eef2f6', '#0b1f3a', '#d7263d', '#ffd23f'],
    polices: GF + 'Anton&family=Barlow+Condensed:wght@500;600;700&display=swap' }
];

/** Fichiers à mettre dans le cache hors ligne (sw.js). */
export const FICHIERS_SKINS = ['skins/skins.js', ...SKINS.filter((s) => s.id !== 'classique').map((s) => `skins/${s.id}.css`)];

const CLE = 'epicerie.skin';

export function skinActuel() {
  try { const v = localStorage.getItem(CLE); if (SKINS.some((s) => s.id === v)) return v; } catch {}
  return 'classique';
}

export function appliquerSkin(id) {
  const skin = SKINS.find((s) => s.id === id) || SKINS[0];
  const racine = document.documentElement;
  if (skin.id === 'classique') racine.removeAttribute('data-skin');
  else racine.setAttribute('data-skin', skin.id);
  if (skin.polices && !document.querySelector(`link[data-polices="${skin.id}"]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = skin.polices; l.dataset.polices = skin.id;
    document.head.appendChild(l);
  }
  // Couleur de la barre de l'appareil = fond de l'en-tête du skin.
  const meta = document.querySelector('meta[name="theme-color"]');
  const entete = document.querySelector('header');
  if (meta && entete) {
    let couleur = getComputedStyle(entete).backgroundColor;
    if (/rgba\(.*,\s*0\)$/.test(couleur)) couleur = getComputedStyle(document.body).backgroundColor; // en-tête en dégradé
    meta.content = skin.id === 'classique' ? '#1f7a4d' : couleur;
  }
  try { localStorage.setItem(CLE, skin.id); } catch {}
}

/** Vignettes de choix, prêtes à insérer (écran Plus → Apparence). */
export function htmlChoixSkin() {
  const actuel = skinActuel();
  const tuile = (s) => {
    const [fond, carte, accent, texte] = s.apercu;
    return `<label style="display:flex;flex-direction:column;gap:6px;cursor:pointer">
      <input type="radio" name="skin" value="${s.id}" ${s.id === actuel ? 'checked' : ''} class="cache-radio" style="position:absolute;opacity:0;width:1px;height:1px">
      <span class="tuile-skin" style="display:block;aspect-ratio:3/4;border-radius:12px;background:${fond};padding:10px;border:3px solid ${s.id === actuel ? 'var(--accent)' : 'var(--ligne)'}">
        <span style="display:block;height:14px;width:70%;border-radius:4px;background:${texte}"></span>
        <span style="display:block;height:34px;margin-top:10px;border-radius:6px;background:${carte}"></span>
        <span style="display:block;height:34px;margin-top:6px;border-radius:6px;background:${carte}"></span>
        <span style="display:block;height:12px;width:45%;margin-top:10px;border-radius:999px;background:${accent}"></span>
      </span>
      <span><b>${s.nom}</b><br><span class="doux">${s.description}</span></span>
    </label>`;
  };
  return `<div class="carte"><h2>Apparence</h2>
    <p class="doux">Change seulement le look de l'app sur ce téléphone. Tes listes et tes prix ne bougent pas.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px">${SKINS.map(tuile).join('')}</div></div>`;
}

/** À appeler après avoir inséré htmlChoixSkin() dans la page. */
export function brancherChoixSkin(racine = document) {
  racine.querySelectorAll('input[name="skin"]').forEach((r) => {
    r.addEventListener('change', () => {
      appliquerSkin(r.value);
      racine.querySelectorAll('input[name="skin"]').forEach((x) => {
        x.nextElementSibling.style.borderColor = x.checked ? 'var(--accent)' : 'var(--ligne)';
      });
    });
  });
}
