// =====================================================================
// Secteurs de magasinage — partagé par l'app (onglet Magasins) et la console (Magasins et références).
// Un secteur est un code postal (« J3H ») ou une VILLE (« Mont-Saint-Hilaire ») : une ville couvre toutes
// ses succursales, peu importe leur code postal. Fonctions pures, testées par tests/magasins.test.mjs.
// =====================================================================
import { BANNIERES } from './demo-data.js';

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nomBan = (b) => BANNIERES[b]?.nom || b;

export const estFsa = (c) => /^[A-Z]\d[A-Z]$/i.test(String(c || ''));
export const fsaDe = (adr) => (String(adr || '').match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i) || [''])[0].toUpperCase().slice(0, 3);

/** Saisie « Mont-Saint-Hilaire » ou « J3H » → secteur { code, libelle } ; une ville garde son nom tel quel. */
export function secteurDe(saisie) {
  const t = String(saisie ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const f = t.match(/^([A-Z]\d[A-Z])(\s?\d[A-Z]\d)?\b\s*(.*)$/i);
  if (f) return { code: f[1].toUpperCase(), libelle: f[3] || f[1].toUpperCase() };
  const ville = t.replace(/(^|[\s-])\p{Ll}/gu, (x) => x.toUpperCase());
  return { code: ville, libelle: ville };
}

/** Ville d'une adresse : « 2020 Bd …, Varennes, QC J3X 1N9 » ou « 580 Wilfrid Laurier, St-Hilaire J3H 0R9 ». */
export function villeAdresse(adr) {
  const parts = String(adr || '').split(',').map((x) => x.trim()).filter(Boolean);
  const i = parts.findIndex((x) => /^(QC|Qu[ée]bec)\b/i.test(x));
  if (i > 0) return parts[i - 1];
  const dernier = parts.length > 1 ? parts[parts.length - 1] : '';
  return dernier.replace(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i, '').replace(/\b(QC|Qu[ée]bec)\b/i, '').trim();
}

/** Deux noms de ville identiques ? (accents, tirets et « St- » / « Saint- » ignorés) */
export function memeVille(a, b) {
  const n = (x) => sansAccents(x).replace(/\bste?[-\s.]/g, (m) => (m.startsWith('ste') ? 'sainte-' : 'saint-')).replace(/[^a-z]/g, '');
  return !!a && !!b && n(a) === n(b);
}

/** La succursale fait-elle partie du secteur ? Code postal : même code ; ville : même ville (adresse, sinon nom). */
export function enSecteur(m, c) {
  if (estFsa(c.code)) return String(m.codePostal || '').toUpperCase() === c.code.toUpperCase();
  const ville = villeAdresse(m.adresse) || String(m.nom || '').replace(new RegExp(`^${nomBan(m.banniere)}\\s*`, 'i'), '');
  return memeVille(ville, c.code) || memeVille(ville, c.libelle);
}

