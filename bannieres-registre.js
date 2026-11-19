// =====================================================================
// Registre de bannières (extension Flipp 1.5) : les bannières vues dans les favoris Flipp et ajoutées à ta base
// (objets « banniere », écrits par l'hôte de l'extension) deviennent des bannières DISPONIBLES dans Magasins
// (téléphone et console) : on peut leur ajouter une succursale. Elles n'apparaissent PAS d'elles-mêmes dans la
// liste d'épicerie : comme les autres bannières, leurs prix n'y comptent qu'avec une succursale active.
// Les objets du registre qui ne portent qu'un réglage (« prise ») d'une bannière connue ne changent rien ici.
// =====================================================================
import { BANNIERES } from './demo-data.js';

const PALETTE = ['#00838f', '#6d4c41', '#5e35b1', '#c0ca33', '#d81b60', '#3949ab', '#00897b', '#f4511e'];

/** Couleur stable tirée de l'identifiant (même bannière → même couleur sur tous les appareils). */
export function couleurDe(id) {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Ajoute à BANNIERES (en mémoire) les bannières du registre qui n'y sont pas. Les bannières de l'app ne sont jamais
 * modifiées. Une bannière retirée du registre disparaît de la liste au prochain appel. → nombre de bannières ajoutées.
 */
export function appliquerRegistre(registre, cible = BANNIERES) {
  const vus = new Set();
  for (const b of registre || []) {
    if (!b || b.supprime || !/^[a-z0-9_]{2,40}$/.test(String(b.id || '')) || !String(b.nom || '').trim()) continue;
    if (cible[b.id] && !cible[b.id].registre) continue;   // bannière de l'app : intouchable
    cible[b.id] = { nom: String(b.nom).trim(), couleur: b.couleur || couleurDe(b.id), registre: true, epicerie: b.epicerie === true };
    vus.add(b.id);
  }
  for (const [id, b] of Object.entries(cible)) if (b && b.registre && !vus.has(id)) delete cible[id];
  return vus.size;
}
