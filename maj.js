// =====================================================================
// Mises à jour de l'app : quand une nouvelle version est prête, une fenêtre
// demande « Mettre à jour maintenant ? Oui / Non ».
// - Oui : la nouvelle version s'active et l'app se recharge (tes données restent).
// - Non : tu gardes la version actuelle ; la question revient au prochain lancement.
// On vérifie au lancement, au retour dans l'app, et toutes les 30 minutes.
// =====================================================================
let affichee = false;

export function surveillerMisesAJour() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Une version attend déjà (téléchargée lors d'une visite précédente)
    if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nouveau = reg.installing;
      nouveau?.addEventListener('statechange', () => {
        // « installed » + une version déjà en service = c'est une MISE À JOUR (pas la 1re installation)
        if (nouveau.state === 'installed' && navigator.serviceWorker.controller) proposer(nouveau);
      });
    });
    const verifier = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier(); });
    setInterval(verifier, 30 * 60 * 1000);
  }).catch(() => {});

  // La nouvelle version a pris le relais : on recharge une seule fois
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recharge) return; recharge = true; location.reload();
  });
}

function proposer(travailleur) {
  if (affichee) return;
  affichee = true;
  const fond = document.createElement('div');
  fond.className = 'maj-fond';
  fond.innerHTML = `<div class="maj-boite" role="dialog" aria-modal="true" aria-labelledby="majTitre">
      <div style="font-size:30px">🔄</div>
      <h2 id="majTitre">Mise à jour disponible</h2>
      <p>Une nouvelle version de l'app est prête. Mettre à jour maintenant ?</p>
      <p class="doux">Tes données restent sur le téléphone et dans ton foyer.</p>
      <div class="rang"><button class="btn grandir" id="majOui">Oui</button><button class="btn sec grandir" id="majNon">Non</button></div>
    </div>`;
  document.body.appendChild(fond);
  fond.querySelector('#majOui').onclick = () => {
    fond.querySelector('#majOui').textContent = 'Mise à jour…';
    travailleur.postMessage({ type: 'ACTIVER' });
  };
  fond.querySelector('#majNon').onclick = () => { fond.remove(); };
}
