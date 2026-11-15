// =====================================================================
// Retouche automatique des photos de plats et de couvertures de livres.
// On corrige seulement la prise de vue : éclairage, contraste, balance des
// couleurs, saturation légère, cadrage au centre. On ne modifie JAMAIS le contenu
// (rien n'est ajouté, effacé ou déplacé) : le plat ou le livre reste reconnaissable.
// L'original est gardé : on peut toujours revenir en arrière.
// =====================================================================

/** Percentile d'un histogramme (256 cases) pour une fraction 0..1 des pixels. */
function percentile(hist, total, frac) {
  let cumul = 0;
  for (let i = 0; i < 256; i++) { cumul += hist[i]; if (cumul >= total * frac) return i; }
  return 255;
}

/**
 * @param {Blob} blob photo d'origine
 * @param {{ type: 'plat' | 'livre', taille?: number }} opts
 *   plat  : cadrage carré au centre (léger), couleurs un peu plus vives
 *   livre : cadrage portrait 3:4 au centre (léger), contraste un peu plus franc
 * @returns {Promise<Blob>} photo retouchée (JPEG)
 */
export async function retoucher(blob, { type = 'plat', taille = 1280 } = {}) {
  const img = await createImageBitmap(blob);
  // 1) Cadrage léger : on retire au plus ~8 % des bords pour recentrer le sujet
  const ratio = type === 'livre' ? 3 / 4 : 1;
  let sw = img.width, sh = img.height;
  if (sw / sh > ratio) sw = Math.max(sh * ratio, img.width * 0.84); else sh = Math.max(sw / ratio, img.height * 0.84);
  sw = Math.min(sw, img.width); sh = Math.min(sh, img.height);
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  const k = Math.min(1, taille / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);

  // 2) Mesures : histogrammes par canal et moyenne (balance des blancs « monde gris »)
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data, n = p.length / 4;
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < p.length; i += 4) { hr[p[i]]++; hg[p[i + 1]]++; hb[p[i + 2]]++; sr += p[i]; sg += p[i + 1]; sb += p[i + 2]; }
  const moy = (sr + sg + sb) / (3 * n);
  // Balance des blancs adoucie (à 50 %, et limitée) pour corriger un éclairage jaune/bleu sans dénaturer
  const gain = (s) => Math.min(1.25, Math.max(0.8, 1 + ((moy / (s / n)) - 1) * 0.5));
  const gr = gain(sr), gg = gain(sg), gb = gain(sb);
  // Étirement du contraste : 0,5 % des pixels les plus sombres → noir, 0,5 % les plus clairs → blanc
  const bas = Math.min(percentile(hr, n, 0.005) * gr, percentile(hg, n, 0.005) * gg, percentile(hb, n, 0.005) * gb);
  const haut = Math.max(percentile(hr, n, 0.995) * gr, percentile(hg, n, 0.995) * gg, percentile(hb, n, 0.995) * gb);
  const etendue = Math.max(40, haut - bas); // jamais d'étirement extrême sur une photo très terne
  // Éclaircir doucement une photo sombre (gamma), sans toucher une photo déjà bien exposée
  const gamma = moy < 100 ? 0.85 : moy > 170 ? 1.08 : 1;
  const sat = type === 'plat' ? 1.12 : 1.05;
  const lut = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256 * 4; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v / 4 - bas) / etendue)), gamma);

  // 3) Application : balance, contraste, gamma, puis saturation légère
  for (let i = 0; i < p.length; i += 4) {
    let r = lut[Math.min(1023, Math.round(p[i] * gr * 4))];
    let g = lut[Math.min(1023, Math.round(p[i + 1] * gg * 4))];
    let b = lut[Math.min(1023, Math.round(p[i + 2] * gb * 4))];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    p[i] = l + (r - l) * sat; p[i + 1] = l + (g - l) * sat; p[i + 2] = l + (b - l) * sat;
  }
  ctx.putImageData(data, 0, 0);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.88));
}
