// =====================================================================
// Appareil photo des reçus : cadre JAUNE vertical pour centrer le reçu,
// une ou plusieurs photos (reçu long = plusieurs sections, de haut en bas).
// Seule la zone dans le cadre est gardée. Secours : appareil photo du téléphone.
// =====================================================================
import { toast } from './ui.js';
import { prendrePhoto } from './ocr.js';

const CADRE = { largeur: 0.62, hauteur: 0.86 }; // proportion de l'image (reçu = long et étroit)

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
      <div class="cadre-jaune"><span>Centre le reçu dans le cadre jaune</span></div>
      <div class="cam-haut"><b id="camCompte">Section 1</b><span class="doux-blanc">Reçu long : prends le haut, puis la suite.</span></div>
      <div class="cam-bas">
        <button class="cam-btn sec" id="camAnnuler">Annuler</button>
        <button class="cam-declencheur" id="camPrendre" aria-label="Prendre la photo"></button>
        <button class="cam-btn" id="camFini" disabled>Terminer</button>
      </div>`;
    document.body.appendChild(ecran);
    const video = ecran.querySelector('video');
    video.srcObject = flux;
    const fermer = (res) => { flux.getTracks().forEach((t) => t.stop()); ecran.remove(); ok(res); };

    ecran.querySelector('#camAnnuler').onclick = () => fermer([]);
    ecran.querySelector('#camFini').onclick = () => fermer(photos);
    ecran.querySelector('#camPrendre').onclick = async () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) return;
      // La vidéo remplit l'écran (object-fit: cover) : on retrouve la zone du cadre dans l'image réelle
      const ew = ecran.clientWidth, eh = ecran.clientHeight;
      const k = Math.max(ew / vw, eh / vh);
      const dx = (vw * k - ew) / 2, dy = (vh * k - eh) / 2;
      const cw = ew * CADRE.largeur, ch = eh * CADRE.hauteur;
      const cx = (ew - cw) / 2, cy = (eh - ch) / 2;
      const sx = (cx + dx) / k, sy = (cy + dy) / k, sw = cw / k, sh = ch / k;
      const c = document.createElement('canvas');
      c.width = Math.round(sw); c.height = Math.round(sh);
      c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
      photos.push(blob);
      navigator.vibrate?.(40);
      ecran.querySelector('#camCompte').textContent = `${photos.length} section(s) — section ${photos.length + 1} ?`;
      ecran.querySelector('#camFini').disabled = false;
      ecran.querySelector('#camFini').textContent = `Terminer (${photos.length})`;
      ecran.classList.add('flash'); setTimeout(() => ecran.classList.remove('flash'), 150);
    };
  });
}
