// =====================================================================
// Console : « Mise à jour disponible — Oui / Non », comme sur le téléphone.
// La console n'a pas de service worker : Chrome garde ses fichiers en mémoire (jusqu'à ~10 min
// après une publication). On compare donc chaque fichier chargé (console.js, console.css, modules…)
// avec la version en ligne ; s'il diffère, on propose de mettre à jour.
// - Oui : les fichiers sont retéléchargés (sans la mémoire de Chrome) puis la page se recharge.
//         Les modifications de la console sont déjà enregistrées dans la base au fil de l'eau.
// - Non : la question revient seulement si une version encore plus récente est publiée.
// Vérifié au lancement, au retour dans l'onglet et toutes les 10 minutes.
// =====================================================================
const DELAI = 10 * 60 * 1000;
let enCours = false, affichee = false, refusee = null;

/** Fichiers de la console chargés par cette page (même site) : la page elle-même, scripts et styles. */
function fichiersCharges() {
  const nav = performance.getEntriesByType('navigation')[0];
  // Seulement ce que la page a chargé elle-même (pas nos propres vérifications par fetch), une fois par fichier
  const res = performance.getEntriesByType('resource')
    .filter((r) => r.name.startsWith(location.origin) && /\.(m?js|css)(\?|$)/.test(r.name) && !['fetch', 'xmlhttprequest', 'beacon'].includes(r.initiatorType));
  const vus = new Map();
  for (const f of [{ url: location.href.split('#')[0], taille: nav?.decodedBodySize }, ...res.map((r) => ({ url: r.name, taille: r.decodedBodySize }))]) {
    if (f.taille > 0 && !vus.has(f.url)) vus.set(f.url, f); // taille inconnue (0) : on ne peut pas comparer
  }
  return [...vus.values()];
}

/** Numéro de version publié (« v62 »), lu dans sw.js. null si introuvable. */
async function versionEnLigne(cache = 'no-store') {
  try {
    const t = await (await fetch(new URL('../sw.js', import.meta.url), { cache })).text();
    return t.match(/epicerie-(v\d+)/)?.[1] || null;
  } catch { return null; }
}

/** true si au moins un fichier chargé diffère de celui en ligne. */
async function perimee() {
  for (const f of fichiersCharges()) {
    try {
      const r = await fetch(f.url, { cache: 'no-store' });
      if (!r.ok) continue;
      if ((await r.arrayBuffer()).byteLength !== f.taille) return true;
    } catch { /* hors ligne : on réessaiera */ }
  }
  return false;
}

async function verifier() {
  if (enCours || affichee || document.visibilityState !== 'visible') return;
  enCours = true;
  try {
    if (!(await perimee())) return;
    const v = await versionEnLigne();
    if (refusee && refusee === (v || 'inconnue')) return;
    proposer(v);
  } finally { enCours = false; }
}

function proposer(version) {
  affichee = true;
  const voile = document.createElement('div');
  voile.className = 'voile';
  voile.innerHTML = `<div class="modale" role="dialog" aria-modal="true" aria-labelledby="majTitre" style="width:min(460px,94vw);text-align:center">
    <div class="corps-m">
      <div style="font-size:30px">🔄</div>
      <h2 id="majTitre" style="text-transform:none;letter-spacing:0;color:var(--texte);font-size:18px;margin:6px 0">Mise à jour disponible</h2>
      ${version ? `<p><b>${version}</b></p>` : ''}
      <p>Une nouvelle version de la console est publiée. Mettre à jour maintenant ?</p>
      <p class="muet" style="font-size:12px">Tes modifications sont déjà enregistrées dans la base.</p>
    </div>
    <div class="pied-m" style="justify-content:center"><button class="btn principal" id="majOui">Oui</button><button class="btn" id="majNon">Non</button></div></div>`;
  document.body.append(voile);
  voile.querySelector('#majOui').focus();
  voile.querySelector('#majOui').onclick = async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Mise à jour…';
    // Retélécharge chaque fichier en remplaçant la copie gardée par Chrome, puis recharge la page
    await Promise.all(fichiersCharges().map((f) => fetch(f.url, { cache: 'reload' }).catch(() => null)));
    location.reload();
  };
  voile.querySelector('#majNon').onclick = () => { refusee = version || 'inconnue'; affichee = false; voile.remove(); };
}

/** Version affichée en haut à gauche, à côté de « Console Épicerie » (ex. « v62 »). */
async function afficherVersion() {
  // Même mémoire de Chrome que les fichiers de la page : le numéro correspond à la version affichée
  const v = await versionEnLigne('default');
  const marque = document.querySelector('.barre .marque');
  if (!v || !marque) return;
  let el = marque.querySelector('.version-console');
  if (!el) {
    el = document.createElement('span');
    el.className = 'version-console';
    el.title = 'Version de la console (même numéro que l\'app des téléphones)';
    el.style.cssText = 'font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--texte-3);border:1px solid var(--trait);border-radius:4px;padding:1px 5px;white-space:nowrap;flex:none';
    marque.querySelector('.nom')?.style.setProperty('white-space', 'nowrap'); // le nom reste sur une ligne
    marque.append(el);
  }
  el.textContent = v;
}

export function surveillerMisesAJourConsole() {
  afficherVersion();
  setTimeout(verifier, 5000); // après le chargement complet (les modules sont tous dans la liste)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier(); });
  setInterval(verifier, DELAI);
}
