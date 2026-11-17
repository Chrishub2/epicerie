// =====================================================================
// Codes PLU des fruits et légumes (liste officielle IFPS → plu.json, généré par mcp/plu.py).
// 4 chiffres (3000-4999) : produit conventionnel ; 9 + PLU (5 chiffres) : le même, BIO.
// Les codes 3170-3229 sont propres à chaque épicerie : absents de plu.json, donc jamais nommés.
// =====================================================================
let liste = null;

/** « 4011 » → { plu: '4011', bio: false } ; « 94011 » → { plu: '4011', bio: true } ; sinon null. */
export function analyserPlu(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length === 5 && c[0] === '9' && +c.slice(1) >= 3000 && +c.slice(1) <= 4999) return { plu: c.slice(1), bio: true };
  if (c.length === 4 && +c >= 3000 && +c <= 4999) return { plu: c, bio: false };
  return null;
}

async function charger() {
  if (!liste) {
    try { liste = await (await fetch(new URL('./plu.json', import.meta.url))).json(); } catch { liste = {}; }
  }
  return liste;
}

/** Fiche officielle d'un PLU : { plu, bio, produit, variete, nom } ; null si ce n'est pas un PLU connu. */
export async function infosPlu(code) {
  const a = analyserPlu(code);
  if (!a) return null;
  const r = (await charger())[a.plu];
  if (!r) return null;
  const [produit, variete] = r;
  return { ...a, produit, variete, nom: `${produit} ${variete}`.trim() + (a.bio ? ' (bio)' : '') };
}
