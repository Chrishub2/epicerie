// =====================================================================
// Accents manquants (demande de Chris, 23 nov. 2026) : une recherche doit trouver les produits même
// si on tape « tourtiere ». Dans l'app, toutes les comparaisons se font déjà sans accents ; mais les sites
// des bannières reçoivent le texte tel quel, et certains ne trouvent rien sans l'accent.
// Avant l'envoi, on remet donc les accents des mots qu'on connaît (référentiel, noms alternatifs, fiches).
// Un mot dont l'accent est ambigu (« a » / « à », « ou » / « où ») reste tel que tapé.
// Module pur.
// =====================================================================

const sansAcc = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MOTS = /[\p{L}'’-]+/gu;

/** Vocabulaire : mot sans accents → sa forme accentuée (seulement si elle est unique et a vraiment un accent). */
export function vocabulaire(noms) {
  const formes = new Map();
  for (const n of noms || []) {
    for (const m of String(n || '').toLowerCase().match(MOTS) || []) {
      const k = sansAcc(m);
      if (k === m) { if (!formes.has(k)) formes.set(k, new Set()); formes.get(k).add(m); continue; }   // la forme sans accent existe aussi
      if (!formes.has(k)) formes.set(k, new Set());
      formes.get(k).add(m);
    }
  }
  const vocab = new Map();
  for (const [k, s] of formes) if (s.size === 1 && [...s][0] !== k) vocab.set(k, [...s][0]);
  // Noms entiers (« pate chinois » → « pâté chinois », même si « pate » seul est ambigu : pâte ou pâté)
  vocab.noms = new Map();
  const doublons = new Set();
  for (const n of noms || []) {
    const k = sansAcc(n).trim();
    if (!k || k === String(n).toLowerCase().trim()) continue;
    if (vocab.noms.has(k) && vocab.noms.get(k) !== String(n).toLowerCase().trim()) doublons.add(k);
    vocab.noms.set(k, String(n).toLowerCase().trim());
  }
  for (const k of doublons) vocab.noms.delete(k);
  return vocab;
}

/** « tourtiere a la viande » → « tourtière a la viande » : les mots tapés sans accent qu'on connaît retrouvent le leur. */
export function restaurerAccents(texte, vocab) {
  if (!vocab?.size && !vocab?.noms?.size) return String(texte || '');
  const t = String(texte || '').trim();
  const entier = vocab.noms?.get(t.toLowerCase());
  if (entier && sansAcc(t) === t.toLowerCase()) return /^[A-Z]/.test(t) ? entier[0].toUpperCase() + entier.slice(1) : entier;
  return String(texte || '').replace(MOTS, (m) => {
    if (sansAcc(m) !== m.toLowerCase()) return m;            // déjà accentué : on n'y touche pas
    const f = vocab.get(m.toLowerCase());
    if (!f) return m;
    return m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? f[0].toUpperCase() + f.slice(1) : f;   // garde la majuscule tapée
  });
}
