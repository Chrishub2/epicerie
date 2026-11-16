// =====================================================================
// Console — données FICTIVES pour la maquette C1 (jamais envoyées nulle part).
// Même structure que l'app téléphone : rayons, articles (produit générique)
// avec variantes (marque + format + codes + alias), prix (offre texte), photos.
// Générateur déterministe (graine fixe) + anomalies plantées volontairement
// pour exercer les règles de qualité.
// =====================================================================
import { chiffreControle, analyserFormat } from '../normalise.js';
import { normaliserProduits } from '../produits.js';

function graine(s) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const RAYONS = [
  'Fruits et légumes', 'Boulangerie', 'Viandes et poissons', 'Produits laitiers et œufs',
  'Épicerie (conserves, pâtes, riz)', 'Céréales et déjeuner', 'Collations et biscuits',
  'Boissons', 'Surgelés', "Produits d'entretien", 'Hygiène et pharmacie', 'Divers',
];

// [rayon, type générique, qualificatifs A, qualificatifs B, unité de comparaison, formats, marques]
const TYPES = [
  [3, 'Lait', ['écrémé', '1 %', '2 %', '3,25 %', 'sans lactose 2 %', 'au chocolat 1 %'], ['', 'biologique', 'microfiltré'], 'l', ['1 L', '2 L', '4 L'], ['Natrel', 'Québon', 'Lactantia', 'Sealtest', 'Selection', 'Sans Nom']],
  [3, 'Yogourt', ['grec nature', 'grec vanille', 'nature', 'fraise', 'bleuets', 'pêche', 'probiotique'], ['0 %', '2 %', '5 %', ''], 'kg', ['650 g', '750 g', '16 x 100 g', '8 x 100 g'], ['Liberté', 'Oikos', 'Danone', 'Iögo', 'Compliments', 'Le Choix du Président']],
  [3, 'Fromage', ['cheddar doux', 'cheddar fort', 'mozzarella', 'brie', 'suisse', 'en grains', 'parmesan râpé', 'cottage'], ['', 'allégé', 'tranché'], 'kg', ['200 g', '400 g', '700 g', '1 kg'], ['Black Diamond', 'Saputo', 'Cracker Barrel', 'Perron', 'Kirkland', 'Selection']],
  [3, 'Œufs', ['gros', 'extra-gros', 'moyens', 'oméga-3', 'de poules en liberté', 'bruns'], [''], 'unite', ['12 œufs', '18 œufs', '30 œufs'], ['Burnbrae', 'Nutri', 'Selection', 'Kirkland', 'Sans Nom']],
  [3, 'Beurre', ['salé', 'non salé', 'demi-sel', 'tartinable'], ['', 'biologique'], 'kg', ['454 g', '250 g', '4 x 454 g'], ['Lactantia', 'Natrel', 'Gay Lea', 'Selection', 'Kirkland']],
  [5, 'Pâtes', ['spaghetti', 'penne', 'fusilli', 'linguine', 'macaroni', 'rotini', 'lasagne', 'farfalle'], ['', 'blé entier', 'sans gluten'], 'kg', ['454 g', '900 g', '375 g'], ['Catelli', 'Barilla', 'Primo', 'Compliments', 'Sans Nom', 'Selection']],
  [5, 'Riz', ['basmati', 'jasmin', 'blanc à grain long', 'brun', 'arborio', 'sauvage'], ['', 'étuvé'], 'kg', ['900 g', '2 kg', '8 kg'], ['Uncle Ben\'s', 'Dainty', 'Tilda', 'Kirkland', 'Sans Nom']],
  [5, 'Tomates', ['en dés', 'broyées', 'entières', 'pâte de'], ['', 'sans sel ajouté', 'italiennes'], 'l', ['796 mL', '156 mL', '6 x 796 mL'], ['Aylmer', 'Primo', 'Unico', 'Compliments', 'Selection']],
  [5, 'Soupe', ['poulet et nouilles', 'tomate', 'légumes', 'bœuf et orge', 'crème de champignons', 'pois'], ['', 'faible en sodium'], 'l', ['540 mL', '900 mL', '284 mL'], ['Campbell\'s', 'Habitant', 'Lipton', 'Compliments']],
  [6, 'Céréales', ['flocons de maïs', 'avoine grillée', 'granola', 'son de blé', 'riz soufflé', 'muesli'], ['', 'au miel', 'aux fruits'], 'kg', ['340 g', '525 g', '750 g', '1,3 kg'], ['Kellogg\'s', 'Cheerios', 'Quaker', 'Post', 'Kirkland', 'Selection']],
  [6, 'Café', ['moulu mi-noir', 'moulu corsé', 'en grains', 'instantané', 'en capsules', 'décaféiné moulu'], [''], 'kg', ['300 g', '925 g', '1,13 kg', '1,4 kg'], ['Van Houtte', 'Nabob', 'Maxwell House', 'Kirkland', 'Lavazza', 'Tim Hortons']],
  [6, 'Gruau', ['à cuisson rapide', 'instantané érable', 'à l\'ancienne', 'pommes cannelle'], [''], 'kg', ['1 kg', '430 g', '2,5 kg'], ['Quaker', 'Robin Hood', 'Selection', 'Sans Nom']],
  [7, 'Biscuits', ['aux brisures de chocolat', 'à l\'avoine', 'sandwich vanille', 'graham', 'au beurre', 'Petit Beurre'], ['', 'format familial'], 'kg', ['300 g', '600 g', '1 kg'], ['Christie', 'Dare', 'Leclerc', 'Voortman', 'Selection']],
  [7, 'Croustilles', ['nature', 'BBQ', 'sel et vinaigre', 'crème sure et oignon', 'ketchup', 'cuites au four'], [''], 'kg', ['200 g', '235 g', '1,1 kg'], ['Yum Yum', 'Lay\'s', 'Humpty Dumpty', 'Ruffles', 'Kirkland']],
  [8, 'Jus', ['d\'orange', 'de pomme', 'de raisin', 'de canneberge', 'de légumes', 'd\'orange sans pulpe'], ['', 'sans sucre ajouté'], 'l', ['1,75 L', '2,63 L', '6 x 200 mL'], ['Oasis', 'Tropicana', 'Rougemont', 'Allen\'s', 'Kirkland', 'Compliments']],
  [8, 'Eau', ['pétillante', 'de source', 'pétillante citron', 'pétillante pamplemousse'], [''], 'l', ['12 x 355 mL', '24 x 500 mL', '1,5 L'], ['Montellier', 'Eska', 'Perrier', 'Naya', 'Kirkland']],
  [8, 'Thé', ['noir orange pekoe', 'vert', 'tisane camomille', 'Earl Grey', 'chai'], [''], 'unite', ['72 sachets', '20 sachets', '144 sachets'], ['Tetley', 'Red Rose', 'Lipton', 'Twinings', 'Salada']],
  [9, 'Légumes surgelés', ['petits pois', 'maïs', 'macédoine', 'brocoli', 'haricots verts', 'mélange asiatique'], ['', 'biologique'], 'kg', ['750 g', '1 kg', '2,5 kg'], ['Arctic Gardens', 'Green Giant', 'Selection', 'Kirkland']],
  [9, 'Pizza surgelée', ['pepperoni', 'toute garnie', 'quatre fromages', 'hawaïenne', 'végétarienne'], ['croûte mince', 'croûte levée'], 'unite', ['1 unité', '2 unités'], ['Delissio', 'McCain', 'Dr. Oetker', 'Selection']],
  [2, 'Pain', ['blanc tranché', 'de blé entier', 'multigrain', 'de seigle', 'baguette', 'pita', 'tortillas'], ['', 'sans gluten'], 'kg', ['675 g', '600 g', '450 g'], ['POM', 'Gadoua', 'Bon Matin', 'Villaggio', 'Dempster\'s', 'Première Moisson']],
  [1, 'Pommes', ['McIntosh', 'Gala', 'Honeycrisp', 'Cortland', 'Spartan'], ['', 'du Québec'], 'kg', ['1,36 kg', '2,27 kg', '1 kg'], ['', 'Les Vergers Lafrance', 'Sans Nom']],
  [1, 'Oignons', ['jaunes', 'rouges', 'espagnols', 'verts'], [''], 'kg', ['1,36 kg', '2,27 kg', '1 kg'], ['', 'Sans Nom']],
  [1, 'Pommes de terre', ['jaunes', 'rouges', 'Russet', 'grelots'], [''], 'kg', ['4,54 kg', '2,27 kg', '680 g'], ['', 'Sans Nom']],
  [4, 'Poulet', ['poitrines', 'cuisses désossées', 'haut de cuisses', 'ailes', 'haché'], ['', 'de grain'], 'kg', ['1 kg', '1,5 kg', '2 kg'], ['Olymel', 'Maple Leaf', 'Exceldor', 'Kirkland', 'Selection']],
  [4, 'Bœuf haché', ['maigre', 'mi-maigre', 'extra-maigre'], [''], 'kg', ['454 g', '1 kg', '2,4 kg'], ['', 'Kirkland', 'Selection']],
  [4, 'Saumon', ['de l\'Atlantique filets', 'fumé', 'sockeye sauvage'], [''], 'kg', ['454 g', '1,36 kg', '200 g'], ['', 'Kirkland', 'Highliner']],
  [10, 'Papier hygiénique', ['double épaisseur', 'triple épaisseur', 'ultra doux'], [''], 'unite', ['12 rouleaux', '24 rouleaux', '30 rouleaux'], ['Cascades', 'Royale', 'Charmin', 'Kirkland', 'Selection']],
  [10, 'Détergent à lessive', ['liquide', 'en capsules', 'en poudre', 'sans parfum'], ['', 'HE'], 'unite', ['42 capsules', '72 brassées', '90 brassées'], ['Tide', 'Gain', 'La Parisienne', 'Kirkland', 'Arm & Hammer']],
  [10, 'Savon à vaisselle', ['citron', 'original', 'sans parfum'], [''], 'l', ['740 mL', '1,2 L'], ['Sunlight', 'Dawn', 'Palmolive', 'Selection']],
  [11, 'Dentifrice', ['blancheur', 'protection caries', 'sensibilité', 'menthe'], [''], 'l', ['100 mL', '2 x 100 mL'], ['Colgate', 'Crest', 'Sensodyne', 'Aquafresh']],
  [11, 'Shampooing', ['cheveux secs', 'antipelliculaire', 'volume', '2 en 1'], [''], 'l', ['400 mL', '700 mL', '1 L'], ['Dove', 'Pantene', 'Head & Shoulders', 'Garnier']],
];

const BANNIERES = ['iga', 'super_c', 'metro', 'maxi', 'costco', 'jean_coutu', 'provigo', 'walmart'];
const PRIX_BASE = { l: 2.2, kg: 9, unite: 0.9 };

/** Code UPC-A valide (12 chiffres) à partir d'un nombre. */
function upc(n) {
  const base = '0' + String(n).padStart(10, '0').slice(-10);
  return base + chiffreControle(base);
}

/** État fictif : { rayons, articles, prix, photos, recus, liste, ... } — structure de l'app. */
export function genererEtat(nbProduits = 5000, s = 4242) {
  const r = graine(s);
  const pick = (t) => t[Math.floor(r() * t.length)];
  const rayons = RAYONS.map((nom, i) => ({ id: 'r' + (i + 1), nom }));
  const articles = [];
  const prix = [];
  const photos = [];
  let nCode = 1000;
  const jour = (j) => new Date(Date.UTC(2026, 10, 15) - j * 864e5).toISOString().slice(0, 10);

  // Combinaisons type × qualificatifs, mélangées
  const combos = [];
  for (const [ri, type, qa, qb, unite, formats, marques] of TYPES) {
    for (const a of qa) for (const b of qb) combos.push({ ri, nom: [type, a, b].filter(Boolean).join(' ').replace(/^Tomates pâte de/, 'Pâte de tomates'), unite, formats, marques });
  }
  let tour = 0;
  while (articles.length < nbProduits) {
    for (const c of combos) {
      if (articles.length >= nbProduits) break;
      const id = 'a' + (articles.length + 1);
      // Au-delà du premier tour : variantes de gamme (format, région) pour atteindre le volume
      const suffixe = tour === 0 ? '' : ' ' + ['format club', 'édition limitée', 'recette originale', 'familial', 'portion individuelle', 'léger', 'extra', 'du terroir'][(tour - 1) % 8] + (tour > 8 ? ' ' + Math.ceil(tour / 8) : '');
      const nbVar = 1 + Math.floor(r() * 3.2);
      const variantes = [];
      for (let k = 0; k < nbVar; k++) {
        const marque = pick(c.marques);
        const format = pick(c.formats);
        variantes.push({ id: `${id}v${k + 1}`, marque, nom: '', format, codes: r() < 0.88 ? [upc(nCode++)] : [], alias: [] });
      }
      const pref = variantes[0];
      const a = {
        id, nom: c.nom + suffixe, rayonId: 'r' + (c.ri + 1), uniteRef: c.unite,
        marque: pref.marque, format: pref.format, codes: [...new Set(variantes.flatMap((v) => v.codes))],
        variantes, variantePreferee: pref.id, local: r() < 0.3, bio: /biologique/.test(c.nom),
        imageUrl: r() < 0.82 ? `fictif:${id}` : undefined,
        maj: new Date(Date.UTC(2026, 10, 15) - Math.floor(r() * 120) * 864e5).toISOString(),
        majPar: r() < 0.7 ? 'Chris' : 'Partenaire',
      };
      if (!a.marque && c.marques.some(Boolean)) a.marque = '';
      // Alias de reçus sur ~40 % des variantes
      for (const v of variantes) {
        if (r() < 0.4) v.alias.push({ banniere: pick(BANNIERES), libelle: (v.marque.slice(0, 4) + ' ' + c.nom.split(' ').slice(0, 2).map((m) => m.slice(0, 5)).join(' ') + ' ' + v.format.replace(/\s/g, '')).toUpperCase().trim() });
      }
      articles.push(a);
      // Prix : 1 à 5 bannières, 1 à 4 observations chacune
      const base = PRIX_BASE[c.unite] * (0.6 + r() * 1.4);
      const nbBan = 1 + Math.floor(r() * 5);
      for (let b = 0; b < nbBan; b++) {
        const ban = BANNIERES[(b + articles.length) % BANNIERES.length];
        const v = pick(variantes);
        const n = 1 + Math.floor(r() * 4);
        for (let o = 0; o < n; o++) {
          const total = estimeTotal(v.format);
          const p = Math.max(0.79, base * total * (0.85 + r() * 0.3) * (ban === 'costco' ? 0.88 : 1));
          const circ = r() < 0.25;
          prix.push({
            id: `p${prix.length + 1}`, articleId: id, varianteId: v.id, banniere: ban,
            offre: circ && r() < 0.4 ? `2/${(p * 1.7).toFixed(2).replace('.', ',')} $` : `${(circ ? p * 0.8 : p).toFixed(2).replace('.', ',')} $`,
            format: v.format, type: circ ? 'circulaire' : 'regulier', source: pick(['recu', 'web', 'web', 'photo', 'manuel']),
            observeLe: jour(Math.floor(r() * 360)),
          });
        }
      }
      if (a.imageUrl && r() < 0.15) photos.push({ id: 'ph' + photos.length, type: 'produit', articleId: id, date: jour(Math.floor(r() * 200)), prise_par: 'Chris', note: 'Photo du produit' });
    }
    tour++;
  }

  // ---- Anomalies plantées (pour la boîte de résolution) ----
  const au = () => articles[Math.floor(r() * articles.length)];
  for (let i = 0; i < nbProduits * 0.03; i++) { // code-barres avec mauvais chiffre de contrôle
    const a = au(); const v = a.variantes[0];
    if (!v.codes.length) continue;
    const c = v.codes[0]; const faux = c.slice(0, -1) + ((+c.slice(-1) + 3) % 10);
    v.codes = [faux]; a.codes = [...new Set([faux, ...a.codes.filter((x) => x !== c)])];
  }
  for (let i = 0; i < nbProduits * 0.01; i++) { // même code sur 2 produits
    const a = au(), b = au();
    if (a === b || !a.codes.length) continue;
    b.codes = [...new Set([...b.codes, a.codes[0]])];
    b.variantes[b.variantes.length - 1].codes = [...new Set([...(b.variantes[b.variantes.length - 1].codes || []), a.codes[0]])];
  }
  for (const a of articles) {
    const x = r();
    if (x < 0.06) { a.format = ''; a.variantes[0].format = ''; }
    else if (x < 0.08) { a.uniteRef = a.uniteRef === 'kg' ? 'unite' : 'kg'; } // format ≠ unité de comparaison
    if (r() < 0.08) { a.marque = ''; a.variantes[0].marque = ''; }
    if (r() < 0.04) a.rayonId = 'r12'; // Divers
    if (r() < 0.025) a.nom = a.nom.toUpperCase() + '  '; // nom à normaliser
    else if (r() < 0.02) a.nom = '  ' + a.nom.toLowerCase().replace(/ /g, '  ');
  }
  for (let i = 0; i < nbProduits * 0.02; i++) { // quasi-doublons (nom + marque)
    const a = au();
    const id = 'a' + (articles.length + 1);
    const v = { id: id + 'v1', marque: a.marque, nom: '', format: a.format, codes: [], alias: [] };
    // Une fois sur deux : nom + marque ; sinon pluriel et accents perdus (saisie rapide au téléphone)
    const nom = i % 2 ? (a.nom.trim() + (a.marque ? ' ' + a.marque : '')).replace(/\s+/g, ' ')
      : a.nom.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(\S+?)s?(\s|$)/, '$1s$2');
    articles.push({ id, nom, rayonId: a.rayonId, uniteRef: a.uniteRef, marque: a.marque, format: a.format, codes: [], variantes: [v], variantePreferee: v.id, maj: a.maj, majPar: 'Partenaire' });
  }
  for (let i = 0; i < prix.length * 0.005; i++) { // prix aberrant (×10 : virgule mal placée)
    const p = prix[Math.floor(r() * prix.length)];
    p.offre = p.offre.replace(/(\d+),(\d)(\d) \$/, (m, a, b, c) => `${a}${b},${c}0 $`);
  }

  const etat = { demo: true, fictif: true, version: 4, rayons, articles, prix, photos, recus: [], liste: [], magasins: [], codesPostaux: [] };
  normaliserProduits(etat); // même règle que le téléphone (miroir ★ ↔ fiche)
  return etat;
}

function estimeTotal(format) {
  return analyserFormat(format)?.total || 1;
}
