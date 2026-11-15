// =====================================================================
// DONNÉES DE DÉMONSTRATION — PRIX FICTIFS
// Servent uniquement à tester l'interface. Les vrais prix viendront des
// agents (Flipp / reebee, épiceries.ca, sites des bannières) à la phase 3.
// Succursales : noms génériques, adresses à confirmer par Chris.
// =====================================================================

const jour = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const BANNIERES = {
  iga: { nom: 'IGA', couleur: '#d6001c' },
  super_c: { nom: 'Super C', couleur: '#e30613' },
  metro: { nom: 'Metro', couleur: '#003da5' },
  maxi: { nom: 'Maxi', couleur: '#ffcc00' },
  costco: { nom: 'Costco', couleur: '#005daa' },
  jean_coutu: { nom: 'Jean Coutu', couleur: '#0072ce' },
};

export const PROGRAMMES = {
  pc_optimum: 'PC Optimum (Maxi)',
  metro_moi: 'Metro & moi (Metro, Super C)',
  scene_plus: 'Scène+ (IGA)',
  jean_coutu: 'Jean Coutu',
  costco: 'Costco (abonnement)',
};

export function etatDemo() {
  const rayons = [
    'Fruits et légumes', 'Boulangerie', 'Viandes et poissons', 'Produits laitiers et œufs',
    'Épicerie (conserves, pâtes, riz)', 'Céréales et déjeuner', 'Collations et biscuits',
    'Boissons', 'Surgelés', "Produits d'entretien", 'Hygiène et pharmacie', 'Divers',
  ].map((nom, i) => ({ id: 'r' + (i + 1), nom }));
  const R = Object.fromEntries(rayons.map((r) => [r.nom, r.id]));

  const articles = [
    { id: 'a1', nom: 'Beurre salé', rayonId: R['Produits laitiers et œufs'], uniteRef: 'kg', format: '454 g', local: true },
    { id: 'a2', nom: 'Lait 2 %', rayonId: R['Produits laitiers et œufs'], uniteRef: 'l', format: '4 L', local: true },
    { id: 'a3', nom: 'Œufs gros', rayonId: R['Produits laitiers et œufs'], uniteRef: 'unite', format: '12 œufs', local: true },
    { id: 'a4', nom: 'Poitrines de poulet', rayonId: R['Viandes et poissons'], uniteRef: 'kg', format: '1 kg', local: true },
    { id: 'a5', nom: 'Bananes', rayonId: R['Fruits et légumes'], uniteRef: 'kg', format: '1 kg', local: false },
    { id: 'a6', nom: 'Pâtes spaghetti', rayonId: R['Épicerie (conserves, pâtes, riz)'], uniteRef: 'kg', format: '900 g', local: false },
    { id: 'a7', nom: 'Café moulu', rayonId: R['Céréales et déjeuner'], uniteRef: 'kg', format: '925 g', local: false },
    { id: 'a8', nom: 'Papier hygiénique', rayonId: R["Produits d'entretien"], uniteRef: 'unite', format: '24 rouleaux', local: false },
    { id: 'a9', nom: 'Yogourt grec nature', rayonId: R['Produits laitiers et œufs'], uniteRef: 'kg', format: '750 g', local: true },
    { id: 'a10', nom: 'Pain de blé entier', rayonId: R['Boulangerie'], uniteRef: 'kg', format: '675 g', local: true },
    { id: 'a11', nom: 'Eau pétillante', rayonId: R['Boissons'], uniteRef: 'l', format: '12 x 355 mL', local: false },
    { id: 'a12', nom: 'Oignons jaunes', rayonId: R['Fruits et légumes'], uniteRef: 'kg', format: '1,36 kg', local: true },
  ].map((a) => ({ codes: [], ...a }));

  // offre = texte tel qu'affiché ; format = format du produit chez cette bannière.
  const P = (articleId, banniere, offre, format, type = 'regulier', fin = null, extra = {}) =>
    ({ articleId, banniere, offre, format, type, fin, source: 'demo', ...extra });
  const prix = [
    P('a1', 'iga', '5,99 $', '454 g'), P('a1', 'super_c', '4,99 $', '454 g', 'circulaire', jour(1)),
    P('a1', 'metro', '6,29 $', '454 g'), P('a1', 'maxi', '5,49 $', '454 g'), P('a1', 'costco', '17,99 $', '4 x 454 g'),
    P('a2', 'iga', '6,79 $', '4 L'), P('a2', 'super_c', '6,49 $', '4 L'), P('a2', 'metro', '6,89 $', '4 L'),
    P('a2', 'maxi', '6,49 $', '4 L'), P('a2', 'costco', '6,19 $', '4 L'),
    P('a3', 'iga', '4,49 $', '12 œufs'), P('a3', 'maxi', '4,29 $', '12 œufs'), P('a3', 'costco', '9,99 $', '30 œufs'),
    P('a3', 'super_c', '4,19 $', '12 œufs', 'circulaire', jour(5)),
    P('a4', 'iga', '6,99 $/lb', null, 'circulaire', jour(2)), P('a4', 'metro', '17,61 $/kg', null),
    P('a4', 'maxi', '15,41 $/kg', null), P('a4', 'costco', '13,99 $/kg', null), P('a4', 'super_c', '5,99 $/lb', null),
    P('a5', 'iga', '0,79 $/lb', null), P('a5', 'super_c', '0,69 $/lb', null, 'circulaire', jour(5)),
    P('a5', 'maxi', '1,72 $/kg', null), P('a5', 'metro', '0,89 $/lb', null), P('a5', 'costco', '2,49 $', '1,36 kg'),
    P('a6', 'iga', '2/5 $', '900 g', 'circulaire', jour(0)), P('a6', 'super_c', '1,99 $', '900 g'),
    P('a6', 'metro', '3,49 $', '900 g'), P('a6', 'maxi', '2,29 $', '900 g'),
    P('a7', 'iga', '14,99 $', '925 g'), P('a7', 'metro', '11,99 $', '925 g', 'circulaire', jour(2)),
    P('a7', 'maxi', '13,49 $', '925 g'), P('a7', 'costco', '24,99 $', '1,36 kg'),
    P('a7', 'jean_coutu', '12,99 $', '925 g', 'fidelite', jour(5), { bonus: '+ 500 pts' }),
    P('a8', 'iga', '15,99 $', '24 rouleaux'), P('a8', 'maxi', '13,99 $', '24 rouleaux'),
    P('a8', 'costco', '24,99 $', '40 rouleaux'), P('a8', 'jean_coutu', '14,99 $', '24 rouleaux', 'circulaire', jour(5)),
    P('a9', 'iga', '6,49 $', '750 g'), P('a9', 'metro', '5,99 $', '750 g', 'circulaire', jour(2)),
    P('a9', 'maxi', '6,29 $', '750 g'), P('a9', 'super_c', '6,19 $', '750 g'),
    P('a10', 'iga', '4,29 $', '675 g'), P('a10', 'super_c', '2/6 $', '675 g'), P('a10', 'metro', '4,49 $', '675 g'),
    P('a10', 'maxi', '3,49 $', '675 g'),
    P('a11', 'iga', '7,99 $', '12 x 355 mL'), P('a11', 'costco', '8,99 $', '24 x 355 mL'),
    P('a11', 'maxi', '6,99 $', '12 x 355 mL', 'circulaire', jour(5)), P('a11', 'jean_coutu', '7,49 $', '12 x 355 mL'),
    P('a12', 'iga', '2,99 $', '1,36 kg'), P('a12', 'super_c', '2,49 $', '1,36 kg'), P('a12', 'maxi', '2,79 $', '1,36 kg'),
  ];

  const magasins = [
    { id: 'm1', banniere: 'iga', nom: 'IGA Beloeil', codePostal: 'J3H', adresse: '' },
    { id: 'm2', banniere: 'super_c', nom: 'Super C Beloeil', codePostal: 'J3H', adresse: '' },
    { id: 'm3', banniere: 'metro', nom: 'Metro Mont-Saint-Hilaire', codePostal: 'J3H', adresse: '' },
    { id: 'm4', banniere: 'maxi', nom: 'Maxi Beloeil', codePostal: 'J3H', adresse: '' },
    { id: 'm5', banniere: 'jean_coutu', nom: 'Jean Coutu Beloeil', codePostal: 'J3H', adresse: '' },
    { id: 'm6', banniere: 'costco', nom: 'Costco Boucherville', codePostal: 'J3H', adresse: '' },
    { id: 'm7', banniere: 'iga', nom: 'IGA Varennes', codePostal: 'Varennes', adresse: '' },
  ];

  return {
    version: 1,
    demo: true,
    utilisateur: 'Chris',
    membres: ['Chris', 'Partenaire'],
    magasinCourant: 'defaut',
    codesPostaux: [
      { code: 'J3H', libelle: 'Beloeil / Mont-Saint-Hilaire' },
      { code: 'Varennes', libelle: 'Varennes (code postal à confirmer)' },
    ],
    magasins,
    rayons,
    ordreRayons: {},
    articles,
    prix,
    liste: [
      { id: 'l1', articleId: 'a1', quantite: 1, coche: false, mode: 'personne', ajoutePar: 'Chris' },
      { id: 'l2', articleId: 'a2', quantite: 2, coche: false, mode: 'personne', ajoutePar: 'Partenaire' },
      { id: 'l3', articleId: 'a5', quantite: 1, coche: false, mode: 'personne', ajoutePar: 'Chris' },
      { id: 'l4', articleId: 'a7', quantite: 1, coche: false, mode: 'personne', ajoutePar: 'Chris' },
      { id: 'l5', articleId: 'a6', quantite: 2, coche: false, mode: 'personne', ajoutePar: 'Partenaire' },
    ],
    cartes: [],
    points: [],
    rabaisPerso: [
      { id: 'rp1', magasinId: 'm7', description: '10 % sur les premiers 150 $', pct: 10, plafond: 150, expiration: '', actif: true },
    ],
    recettes: [],
    photos: [],
  };
}
