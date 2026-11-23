// =====================================================================
// Appareil photo des reçus : plein écran, sans cadre ni zone ombrée (demande de Chris, 22 nov. 2026 :
// le cadre coupait les bords du reçu). Une ou plusieurs photos (reçu long = plusieurs sections,
// de haut en bas). L'image complète de la caméra est gardée. Secours : appareil photo du téléphone.
// =====================================================================
import { toast } from './ui.js';
import { prendrePhoto } from './ocr.js';

/** Ouvre la caméra ; résout avec un tableau de photos (Blob), dans l'ordre, ou [] si annulé. */
export function photographierRecu() {
  return new Promise(async (ok) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      // Secours : une photo à la fois avec l'appareil du téléphone
      const b = await prendrePhoto(); ok(b ? [b] : []); return;
    }
    let flux;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch {
      toast('Caméra non autorisée : j\'ouvre l\'appareil photo du téléphone.');
      const b = await prendrePhoto(); ok(b ? [b] : []); return;
    }
    const photos = [];
    const ecran = document.createElement('div');
    ecran.className = 'camera-recu';
    ecran.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="cadre-jaune"><div class="cam-raccord" hidden><img alt=""><em>Aligne ici le bas de la photo précédente</em></div><span>Tout le reçu doit paraître à l'écran</span></div>
      <div class="cam-haut"><b id="camCompte">Section 1</b><span class="doux-blanc">Reçu long : prends le haut, puis la suite.</span></div>
      <div class="cam-bas">
        <button class="cam-btn sec" id="camAnnuler">Annuler</button>
        <button class="cam-declencheur" id="camPrendre" aria-label="Prendre la photo"></button>
        <button class="cam-btn" id="camFini" disabled>Terminer</button>
      </div>`;
    document.body.appendChild(ecran);
    const video = ecran.querySelector('video');
    // iPhone : il faut ces propriétés ET un play() explicite, sinon l'image reste noire
    video.muted = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    video.srcObject = flux;
    const demarrer = () => video.play().catch(() => {});
    demarrer();
    let ferme = false;
    const fermer = (res) => { ferme = true; const ri = ecran.querySelector('.cam-raccord img'); if (ri?.src) URL.revokeObjectURL(ri.src); flux.getTracks().forEach((t) => t.stop()); ecran.remove(); ok(res); };

    // Toujours noir après 4 s : on propose l'appareil photo du téléphone
    setTimeout(() => {
      if (ferme || video.videoWidth) return;
      const secours = document.createElement('div');
      secours.className = 'cam-secours';
      secours.innerHTML = `<p>La caméra ne s'affiche pas.</p>
        <button class="cam-btn" id="camReessayer">Réessayer</button>
        <button class="cam-btn" id="camTel">📷 Utiliser l'appareil photo du téléphone</button>`;
      ecran.appendChild(secours);
      secours.querySelector('#camReessayer').onclick = () => { demarrer(); if (video.videoWidth) secours.remove(); };
      secours.querySelector('#camTel').onclick = async () => {
        flux.getTracks().forEach((t) => t.stop());
        ecran.style.display = 'none';
        const b = await prendrePhoto();
        if (b) photos.push(b);
        fermer(photos);
      };
    }, 4000);

    ecran.querySelector('#camAnnuler').onclick = () => fermer([]);
    ecran.querySelector('#camFini').onclick = () => fermer(photos);
    ecran.querySelector('#camPrendre').onclick = async () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) { demarrer(); toast('La caméra démarre… réessaie dans un instant.'); return; }
      // Image complète de la caméra : rien n'est coupé
      const c = document.createElement('canvas');
      c.width = vw; c.height = vh;
      c.getContext('2d').drawImage(video, 0, 0, vw, vh);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
      photos.push(blob);
      navigator.vibrate?.(40);
      // Raccord : le bas de cette photo s'affiche en haut du cadre pour aligner la suivante (chevauchement)
      const raccord = ecran.querySelector('.cam-raccord'), img = raccord.querySelector('img');
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      raccord.hidden = false;
      ecran.querySelector('.cadre-jaune > span').hidden = true; // le raccord a sa propre consigne
      ecran.querySelector('#camCompte').textContent = `${photos.length} section(s) — section ${photos.length + 1} ?`;
      ecran.querySelector('#camFini').disabled = false;
      ecran.querySelector('#camFini').textContent = `Terminer (${photos.length})`;
      ecran.classList.add('flash'); setTimeout(() => ecran.classList.remove('flash'), 150);
    };
  });
}
