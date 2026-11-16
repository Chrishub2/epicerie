// =====================================================================
// Console — règles de qualité (déterministes, sans IA, sans coût).
// Produit une liste de PROBLÈMES ; chacun peut porter une PROPOSITION de correction.
// Rien n'est appliqué ici : la console demande toujours la confirmation de Chris.
// Réutilise la logique de l'app : gtinValide, analyserFormat, normaliser, completude, codesDe.
// =====================================================================
import { gtinValide, chiffreControle, analyserFormat, normaliser } from '../normalise.js';
import { completude, codesDe, variantesActives } from '../produits.js';

/** Priorités (1 = critique … 5 = enrichissement). */
export const PRIORITES = {
  1: { nom: 'Critique', court: 'P1' },
  2: { nom: 'Incohérence', court: 'P2' },
  3: { nom: 'Manquant', court: 'P3' },
  4: { nom: 'Doublon possible', court: 'P4' },
  5: { nom: 'Enrichissement', court: 'P5' },
};

/** Règles : code → { priorite, titre, explication }. */
export const REGLES = {
  gtin_invalide: { priorite: 1, titre: 'Code-barres invalide', explication: 'Le chiffre de contrôle ne correspond pas : le scan ne trouvera jamais ce produit.' },
  code_partage: { priorite: 1, titre: 'Même code sur 2 produits', explication: 'Un code-barres doit désigner une seule variante. Le scan choisit au hasard entre les deux.' },
  format_unite: { priorite: 1, titre: 'Format ≠ unité de comparaison', explication: 'Le prix au kg / L / unité calculé est faux, et les comparaisons entre magasins aussi.' },
  prix_aberrant: { priorite: 1, titre: 'Prix suspect', explication: 'Ce prix unitaire s\'écarte fortement de la médiane du produit (virgule mal lue ?).' },
  doublon_probable: { priorite: 2, titre: 'Doublon probable', explication: 'Même nom une fois la marque retirée, même rayon.' },
  rayon_divers: { priorite: 3, titre: 'Rayon « Divers »', explication: 'Le produit n\'est pas classé : il apparaît en fin de liste au magasin.' },
  format_manquant: { priorite: 3, titre: 'Format manquant', explication: 'Sans format, impossible de calculer un prix comparable.' },
  marque_manquante: { priorite: 3, titre: 'Marque manquante', explication: 'La marque aide à relier les reçus et le scan à la bonne variante.' },
  code_manquant: { priorite: 3, titre: 'Code-barres manquant', explication: 'Le produit ne sera pas reconnu au scan.' },
  photo_manquante: { priorite: 3, titre: 'Photo manquante', explication: 'Une photo aide à retrouver le produit en magasin.' },
  prix_manquant: { priorite: 3, titre: 'Aucun vrai prix', explication: 'Aucun prix observé : le produit ne peut pas être comparé.' },
  doublon_possible: { priorite: 4, titre: 'Doublon possible', explication: 'Noms identiques à un pluriel ou des accents près.' },
  nom_a_normaliser: { priorite: 5, titre: 'Nom à normaliser', explication: 'Espaces en trop ou tout en majuscules.' },
};

/** Seuil de confiance pour l'application en lot (réglable dans la console). */
export const SEUIL_LOT = 0.9;

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mots = (s) => sansAccents(s).replace(/[^a-z0-9%,]+/g, ' ').trim().split(' ').filter(Boolean);
const singulier = (m) => (m.length > 3 ? m.replace(/[sx]$/, '') : m);

/** Nom normalisé : espaces uniques, sans espaces aux bouts ; TOUT MAJUSCULES → Majuscule initiale. */
export function nomNormalise(nom) {
  let n = String(nom || '').replace(/\s+/g, ' ').trim();
  if (n.length > 3 && n === n.toUpperCase() && /[A-ZÀ-Ý]/.test(n)) n = n.charAt(0) + n.slice(1).toLowerCase();
  if (n && n.charAt(0) !== n.charAt(0).toUpperCase()) n = n.charAt(0).toUpperCase() + n.slice(1);
  return n;
}

const mediane = (t) => { const s = [...t].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Prix unitaires d'un produit : [{ p, pu }] (illisibles ignorés). Mis en cache par (format, unité, nb de prix). */
const cachePU = new Map();
export function prixUnitaires(e, a, prixParArticle) {
  const liste = prixParArticle.get(a.id) || [];
  const cle = `${a.uniteRef}|${a.format}|${liste.length}`;
  const c = cachePU.get(a.id);
  if (c && c.cle === cle) return c.val;
  const val = liste.map((p) => {
    const n = normaliser(p.offre, p.format || a.format, a.uniteRef);
    return { p, pu: n.erreur ? null : n.prixUnitaire };
  }).filter((x) => x.pu != null && x.pu > 0);
  cachePU.set(a.id, { cle, val });
  return val;
}

/**
 * Analyse complète. Retourne { problemes, parArticle: Map(id → problèmes), stats }.
 * `ignores` : Set des clés (code + cibles) que Chris a rejetées ou marquées « pas un problème ».
 */
export function analyser(e, ignores = new Set()) {
  const t0 = performance.now();
  const problemes = [];
  const rayonDe = new Map((e.rayons || []).map((r) => [r.id, r]));
  const prixParArticle = new Map();
  for (const p of e.prix || []) { if (!p.annule) (prixParArticle.get(p.articleId) || prixParArticle.set(p.articleId, []).get(p.articleId)).push(p); }

  const ajouter = (code, cibles, extra) => {
    const cle = code + ':' + cibles.join('+');
    if (ignores.has(cle)) return;
    const r = REGLES[code];
    problemes.push({ cle, code, priorite: r.priorite, titre: r.titre, cibles, confiance: 1, correction: null, ...extra });
  };

  // Rayon le plus fréquent pour le premier mot du nom (pour proposer un rayon aux « Divers »)
  const divers = (e.rayons || []).find((r) => /^divers$/i.test(r.nom));
  const votes = new Map();
  for (const a of e.articles) {
    if (!a.rayonId || a.rayonId === divers?.id) continue;
    const k = singulier(mots(a.nom)[0] || '');
    const v = votes.get(k) || new Map(); v.set(a.rayonId, (v.get(a.rayonId) || 0) + 1); votes.set(k, v);
  }

  // Index des codes → produits
  const parCode = new Map();
  for (const a of e.articles) for (const c of codesDe(a)) (parCode.get(c) || parCode.set(c, []).get(c)).push(a);

  for (const a of e.articles) {
    // --- Codes invalides
    for (const c of codesDe(a)) {
      if (c.length >= 8 && !gtinValide(c)) {
        const corrige = c.slice(0, -1) + chiffreControle(c.slice(0, -1));
        ajouter('gtin_invalide', [a.id], {
          probleme: `${c} : chiffre de contrôle ${c.slice(-1)}, attendu ${corrige.slice(-1)}`,
          raison: 'Calcul GS1 du dernier chiffre. Le dernier chiffre a peut-être été mal saisi, mais une autre position peut aussi être fautive.',
          confiance: 0.55, impact: 'Le scan de ce produit recommencera à fonctionner si la correction est juste.',
          correction: { articleId: a.id, type: 'code', avant: c, apres: corrige, texte: `${c} → ${corrige}` },
        });
      }
    }
    // --- Format ≠ unité de comparaison
    const f = analyserFormat(a.format);
    if (f && a.uniteRef && f.base !== a.uniteRef) {
      ajouter('format_unite', [a.id], {
        probleme: `Format « ${a.format} » (${f.base === 'unite' ? 'unités' : f.base === 'kg' ? 'poids' : 'volume'}) comparé ${a.uniteRef === 'kg' ? 'au kg' : a.uniteRef === 'l' ? 'au litre' : 'à l\'unité'}`,
        raison: 'L\'unité du format lisible devrait être l\'unité de comparaison.',
        confiance: 0.92, impact: 'Les prix comparables de ce produit seront recalculés.',
        correction: { articleId: a.id, type: 'champ', champ: 'uniteRef', avant: a.uniteRef, apres: f.base, texte: `Comparer ${f.base === 'kg' ? 'au kg' : f.base === 'l' ? 'au litre' : 'à l\'unité'}` },
      });
    }
    // --- Prix aberrants (n ≥ 3)
    const pus = prixUnitaires(e, a, prixParArticle);
    if (pus.length >= 3) {
      const med = mediane(pus.map((x) => x.pu));
      for (const x of pus) {
        const ratio = x.pu / med;
        if (ratio > 2.5 || ratio < 0.4) {
          ajouter('prix_aberrant', [a.id], {
            probleme: `${x.p.offre} chez ${x.p.banniere} le ${x.p.observeLe} : ${ratio.toFixed(1).replace('.', ',')} × la médiane (n = ${pus.length})`,
            raison: `Médiane ${med.toFixed(2).replace('.', ',')} $/${a.uniteRef === 'unite' ? 'unité' : a.uniteRef}. Les prix sont en ajout seulement : on ne les modifie pas, on les vérifie.`,
            confiance: Math.min(0.95, 0.55 + pus.length * 0.05), impact: 'Fausse le meilleur prix et les économies calculées.',
            prixId: x.p.id,
          });
        }
      }
    }
    // --- Données manquantes (les 6 critères de l'app)
    const comp = completude(a, { prix: prixParArticle.get(a.id) || [], rayons: e.rayons }); // e réduit : évite de parcourir tous les prix pour chaque produit
    for (const m of comp.manquants) {
      if (m.cle === 'rayon') {
        const v = votes.get(singulier(mots(a.nom)[0] || ''));
        let correction = null, confiance = 0.5;
        if (v) {
          const tot = [...v.values()].reduce((s, n) => s + n, 0);
          const [rid, n] = [...v.entries()].sort((x, y) => y[1] - x[1])[0];
          confiance = Math.round((n / tot) * 100) / 100;
          correction = { articleId: a.id, type: 'champ', champ: 'rayonId', avant: a.rayonId, apres: rid, texte: `→ ${rayonDe.get(rid)?.nom}` };
          ajouter('rayon_divers', [a.id], { probleme: 'Classé dans « Divers »', raison: `${n} produit(s) sur ${tot} qui commencent par « ${mots(a.nom)[0]} » sont dans « ${rayonDe.get(rid)?.nom} ».`, confiance, correction, impact: 'Le produit se range au bon endroit dans la liste, en magasin.' });
        } else ajouter('rayon_divers', [a.id], { probleme: 'Classé dans « Divers »', raison: 'Aucun produit semblable déjà classé.', confiance });
      } else if (m.cle === 'format') {
        const autre = variantesActives(a).find((v) => analyserFormat(v.format));
        ajouter('format_manquant', [a.id], {
          probleme: 'Aucun format lisible', confiance: autre ? 0.8 : 1,
          raison: autre ? `Une autre variante (${autre.marque || 'sans marque'}) a le format « ${autre.format} ».` : 'À lire sur l\'emballage ou par scan.',
          correction: autre ? { articleId: a.id, type: 'champ', champ: 'format', avant: a.format, apres: autre.format, texte: `→ ${autre.format}` } : null,
        });
      } else if (m.cle === 'marque') {
        const autre = variantesActives(a).find((v) => String(v.marque || '').trim());
        ajouter('marque_manquante', [a.id], {
          probleme: 'Aucune marque', confiance: autre ? 0.75 : 1,
          raison: autre ? `Une autre variante est de marque « ${autre.marque} ».` : 'Produit sans marque (vrac, fruits) ou marque à saisir.',
          correction: autre ? { articleId: a.id, type: 'champ', champ: 'marque', avant: a.marque, apres: autre.marque, texte: `→ ${autre.marque}` } : null,
        });
      } else if (m.cle === 'code') ajouter('code_manquant', [a.id], { probleme: 'Aucun code-barres', raison: 'Scanner le produit au prochain passage.' });
      else if (m.cle === 'photo') ajouter('photo_manquante', [a.id], { probleme: 'Aucune photo', raison: 'Photo officielle (Open Food Facts) ou photo en magasin.' });
      else if (m.cle === 'prix') ajouter('prix_manquant', [a.id], { probleme: 'Aucun prix réel observé', raison: 'Lier à épiceries.ca ou attendre un reçu.' });
    }
    // --- Nom à normaliser
    const nn = nomNormalise(a.nom);
    if (nn !== a.nom) {
      ajouter('nom_a_normaliser', [a.id], {
        probleme: `« ${a.nom} »`, raison: 'Espaces en trop, majuscules ou minuscule initiale.', confiance: 0.97,
        impact: 'Recherche et tri plus fiables.', correction: { articleId: a.id, type: 'champ', champ: 'nom', avant: a.nom, apres: nn, texte: `→ « ${nn} »` },
      });
    }
  }

  // --- Codes partagés
  for (const [c, arts] of parCode) {
    const ids = [...new Set(arts.map((a) => a.id))];
    if (ids.length > 1) ajouter('code_partage', ids.sort(), {
      probleme: `${c} : ${arts.map((a) => `« ${a.nom.trim()} »`).join(' et ')}`,
      raison: 'Si c\'est le même produit : fusionner. Sinon : retirer le code de la mauvaise fiche.', confiance: 0.95,
      impact: 'Le scan et les reçus seront reliés au bon produit.',
    });
  }

  // --- Doublons (blocage par clé : coût linéaire, pas de comparaison de toutes les paires)
  const parCle = new Map(), parCleSouple = new Map();
  for (const a of e.articles) {
    const marques = new Set(variantesActives(a).flatMap((v) => mots(v.marque)).concat(mots(a.marque)));
    const m = mots(a.nom).filter((x) => !marques.has(x));
    const cle = a.rayonId + '|' + [...new Set(m)].sort().join(' ');
    (parCle.get(cle) || parCle.set(cle, []).get(cle)).push(a);
    const souple = a.rayonId + '|' + [...new Set(m.map(singulier))].sort().join(' ');
    (parCleSouple.get(souple) || parCleSouple.set(souple, []).get(souple)).push(a);
  }
  const pasDoublon = (x, y) => (x.pasDoublon || []).includes(y.id) || (y.pasDoublon || []).includes(x.id);
  const vus = new Set();
  for (const groupe of parCle.values()) {
    if (groupe.length < 2) continue;
    const g = groupe.filter((x, i) => !groupe.some((y, j) => j !== i && pasDoublon(x, y)));
    if (g.length < 2) continue;
    const ids = g.map((a) => a.id).sort();
    ids.forEach((id) => vus.add(id));
    const memeFormat = new Set(g.map((a) => analyserFormat(a.format)?.total ?? a.format)).size === 1;
    ajouter('doublon_probable', ids, {
      probleme: g.map((a) => `« ${a.nom.trim()} »`).join(' · '),
      raison: `Même nom sans la marque, même rayon${memeFormat ? ', même format' : ', formats différents (peut-être des variantes d\'un même produit)'}.`,
      confiance: memeFormat ? 0.88 : 0.72, impact: 'À comparer puis fusionner : prix, codes et reçus seront regroupés.',
    });
  }
  for (const groupe of parCleSouple.values()) {
    const g = groupe.filter((a) => !vus.has(a.id));
    if (g.length < 2 || g.some((x) => g.some((y) => x !== y && pasDoublon(x, y)))) continue;
    ajouter('doublon_possible', g.map((a) => a.id).sort(), {
      probleme: g.map((a) => `« ${a.nom.trim()} »`).join(' · '),
      raison: 'Noms identiques à un pluriel ou des accents près.', confiance: 0.65,
      impact: 'À comparer avant toute fusion.',
    });
  }

  const parArticle = new Map();
  for (const p of problemes) for (const id of p.cibles) (parArticle.get(id) || parArticle.set(id, []).get(id)).push(p);
  problemes.sort((x, y) => x.priorite - y.priorite || y.confiance - x.confiance);
  return { problemes, parArticle, prixParArticle, duree: Math.round(performance.now() - t0) };
}

/** Meilleur prix unitaire récent (≤ 120 jours) : { pu, banniere } ou null. */
export function meilleurPrix(e, a, prixParArticle) {
  const limite = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  let best = null;
  for (const x of prixUnitaires(e, a, prixParArticle)) {
    if ((x.p.observeLe || '') < limite) continue;
    if (!best || x.pu < best.pu) best = { pu: x.pu, banniere: x.p.banniere };
  }
  return best;
}
