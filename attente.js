// =====================================================================
// File d'attente hors ligne
// Tout ce qui demande le réseau (lire une photo d'étiquette ou de reçu, chercher
// des prix) est noté ici. Sans réseau, rien n'est perdu : c'est repris tout seul
// au retour du réseau, au lancement de l'app ou quand tu tires l'écran vers le bas.
// =====================================================================
import * as S from './store.js';
import { toast } from './ui.js';
import { lireTexte, analyserEtiquette, analyserRecu } from './ocr.js';

let enCours = false;

/** Ajoute un travail : { type: 'recu' | 'prix' | 'releve', ...données }. Lance le traitement si possible. */
export function ajouterTache(tache) {
  S.maj((e) => { (e.fileAttente ||= []).push({ id: S.uid('t'), cree: new Date().toISOString(), essais: 0, ...tache }); });
  return traiterFile();
}

export function nbEnAttente() { return (S.get().fileAttente || []).length; }

/** Traite la file, un travail à la fois. Retourne le nombre de travaux terminés. */
export async function traiterFile() {
  if (enCours || !navigator.onLine) return 0;
  enCours = true;
  let faits = 0;
  try {
    for (const t of [...(S.get().fileAttente || [])]) {
      if (!navigator.onLine) break;
      try {
        await executer(t);
        S.maj((e) => { e.fileAttente = e.fileAttente.filter((x) => x.id !== t.id); });
        faits++;
      } catch {
        S.maj((e) => { const x = e.fileAttente.find((y) => y.id === t.id); if (x) x.essais++; });
      }
    }
  } finally { enCours = false; }
  if (faits) toast(`${faits} photo(s) lue(s) et mise(s) à jour`);
  return faits;
}

async function texteDesPhotos(ids) {
  let texte = '';
  for (const id of ids) {
    const blob = await S.lirePhoto(id);
    if (blob) texte += (await lireTexte(blob)) + '\n';
  }
  return texte;
}

async function executer(t) {
  if (t.type === 'recu') {
    const texte = await texteDesPhotos(t.photoIds);
    const r = analyserRecu(texte);
    S.maj((e) => { const rc = (e.recus || []).find((y) => y.id === t.recuId); if (rc) Object.assign(rc, r, { texte, statut: 'lu' }); });
  } else if (t.type === 'prix') {
    const texte = await texteDesPhotos([t.photoId]);
    const lu = analyserEtiquette(texte);
    S.maj((e) => {
      const p = e.prix.find((y) => y.id === t.prixId);
      if (!p) return;
      if (lu.offre) p.offre = lu.offre;
      if (lu.format && !p.format) p.format = lu.format;
      if (lu.rabais) p.type = 'circulaire';
      p.aVerifier = true; p.enAttente = false;
    });
  } else if (t.type === 'releve') {
    const texte = await texteDesPhotos([t.photoId]);
    const lu = analyserEtiquette(texte);
    S.maj((e) => {
      const r = (e.releves || []).find((y) => y.id === t.releveId);
      if (r) Object.assign(r, { offre: r.offre || lu.offre, format: r.format || lu.format, rabais: lu.rabais, nomLu: devinerNom(texte), texte, statut: 'lu' });
    });
  }
}

/** Nom probable sur une étiquette : la plus longue ligne de lettres (sans prix ni code). */
export function devinerNom(texte) {
  return (texte.split('\n').map((l) => l.trim())
    .filter((l) => /[a-zà-ÿ]{3,}/i.test(l) && !/\$|\d{2}[,.]\d{2}|rég|prix|unit/i.test(l))
    .sort((a, b) => b.length - a.length)[0] || '').replace(/\s+/g, ' ').slice(0, 60);
}

// Reprise automatique au retour du réseau
window.addEventListener('online', () => { toast('Réseau retrouvé — mise à jour…'); traiterFile(); });
