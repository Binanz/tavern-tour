/* ============================================================
   TAVERN TOUR — Configuration du plateau et des règles
   ------------------------------------------------------------
   Modifie librement les noms (name / short), les types (group),
   les prix et les cartes Chance ici. Les montants sont en or.
   Noms des serviteurs : pool Battlegrounds actuel, version FR.
   ============================================================ */
(function (global) {
  'use strict';

  const RULES = {
    startCash: 2000000,        // argent de départ (comme Business Tour)
    salary: 200000,            // reçu en passant par la Taverne (Départ)
    jailFee: 100000,           // pour quitter l'Île perdue
    jailMaxTurns: 3,           // tours max sur l'Île perdue avant sortie forcée
    championshipFee: 50000,    // organiser les Championnats sur une de ses cases
    championshipMaxMult: 10,   // multiplicateur de loyer max (x2 -> x10)
    worldTourFee: 50000,       // voyager (toujours vers l'avant) vers une case libre ou à soi
    taxA: 200000,              // Impôt (case 4)
    taxB: 100000,              // Taxe de luxe (case 38)
    sellRatio: 0.5,            // revente à la banque = 50 % de la valeur
    buyoutMult: 2,             // racheter la case d'un adversaire = 2x ce qu'il a investi
    hotelCostMult: 2,          // l'hôtel coûte 2 maisons
    maxHouses: 3,              // 3 maisons, puis l'hôtel (niveau 4)
    lockedHousesBeforeLap: 3,  // la 3e maison n'est disponible qu'après un passage par la Taverne
    tradeTimeoutMs: 45000,     // délai de réponse à une proposition d'échange
    durationsMin: [10, 15, 20, 30],
    defaultDurationMin: 20,
    maxPlayers: 4,
    utilityMult: [10000, 25000], // loyer Services = dés x 10 000 (1 possédé) ou x 25 000 (2 possédés)
    stationRents: [50000, 100000, 200000, 400000],
  };

  // Les 8 types de serviteurs (= groupes de couleur). L'ordre suit le plateau.
  const GROUPS = {
    mech:      { label: 'Méca',        color: '#8d6e4b', houseCost: 30000 },
    murloc:    { label: 'Murloc',      color: '#2eb8d8', houseCost: 50000 },
    beast:     { label: 'Bête',        color: '#c2457d', houseCost: 80000 },
    pirate:    { label: 'Pirate',      color: '#e38a1f', houseCost: 100000 },
    quilboar:  { label: 'Huran',       color: '#c8302a', houseCost: 120000 },
    demon:     { label: 'Démon',       color: '#e3c021', houseCost: 140000 },
    elemental: { label: 'Élémentaire', color: '#2f9e5b', houseCost: 160000 },
    dragon:    { label: 'Dragon',      color: '#3457c4', houseCost: 200000 },
  };

  // Loyers : terrain nu, 1, 2, 3 maisons, hôtel — en multiples du prix.
  const RENT_MULT = [0.2, 0.5, 1.0, 1.8, 3.0];
  const rents = (price) => RENT_MULT.map((m) => Math.round((price * m) / 1000) * 1000);

  const P = (name, group, price, short) => ({ type: 'property', name, short: short || name, group, price, rents: rents(price) });
  const S = (name, short) => ({ type: 'station', name, short: short || name, price: 200000 });
  const U = (name) => ({ type: 'utility', name, short: name, price: 150000 });

  // 40 cases, sens horaire en partant de la Taverne (coin bas-droit).
  const BOARD = [
    { type: 'start', name: 'La Taverne', sub: 'Départ' },                                  // 0
    P('Rob’aria', 'mech', 60000),                                                           // 1
    { type: 'chance', name: 'Chance' },                                                     // 2
    P('Tireur de câble', 'mech', 60000),                                                    // 3
    { type: 'tax', name: 'Impôt de Bob', amount: RULES.taxA },                              // 4
    S('Brann Barbe-de-Bronze', 'Brann'),                                                    // 5
    P('Éclaireur véloce', 'murloc', 100000),                                                // 6
    { type: 'chance', name: 'Chance' },                                                     // 7
    P('Bourbissa', 'murloc', 100000),                                                       // 8
    P('Secrétaileron comptable', 'murloc', 120000, 'Secrétaileron'),                        // 9
    { type: 'jail', name: "L'Île perdue", sub: 'Naufragé' },                                // 10
    P('Scarabée des forêts', 'beast', 140000, 'Scarabée'),                                  // 11
    U('Sombre Don'),                                                                        // 12
    P('Louveteau', 'beast', 140000),                                                        // 13
    P('Goldrinn, le grand loup', 'beast', 160000, 'Goldrinn'),                              // 14
    S('Enchanteresse drakkari', 'Drakkari'),                                                // 15
    P('Artiste des mers du Sud', 'pirate', 180000, 'Artiste des mers'),                     // 16
    { type: 'chance', name: 'Chance' },                                                     // 17
    P('Partenaire de pillage', 'pirate', 180000, 'Partenaire de pillage'),                  // 18
    P('Eudora, maîtresse d’équipage', 'pirate', 200000, 'Eudora'),                          // 19
    { type: 'championship', name: 'Championnats', sub: 'du monde' },                        // 20
    P('Géomancienne de Tranchebauge', 'quilboar', 220000, 'Géomancienne'),                  // 21
    { type: 'chance', name: 'Chance' },                                                     // 22
    P('Pionnier huran', 'quilboar', 220000),                                                // 23
    P('Géomage Roogug', 'quilboar', 240000, 'Roogug'),                                      // 24
    S('Titus Vaillefendre', 'Titus'),                                                       // 25
    P('Tisse-colère', 'demon', 260000),                                                     // 26
    P('Malchezaar, prince du rythme', 'demon', 260000, 'Malchezaar'),                       // 27
    U('Bibelot'),                                                                           // 28
    P('Tichondrius', 'demon', 280000),                                                      // 29
    { type: 'worldtour', name: 'Tour du monde', sub: 'Portail' },                            // 30
    P('Modeleur de boules de neige', 'elemental', 300000, 'Modeleur de neige'),             // 31
    P('Ichoron le protecteur', 'elemental', 300000, 'Ichoron'),                             // 32
    { type: 'chance', name: 'Chance' },                                                     // 33
    P('Tempête déchaînée', 'elemental', 320000, 'Tempête'),                                 // 34
    S('Leeroy le Téméraire', 'Leeroy'),                                                     // 35
    { type: 'chance', name: 'Chance' },                                                     // 36
    P('Mère des couvées héroïque', 'dragon', 350000, 'Mère des couvées'),                   // 37
    { type: 'tax', name: 'Taxe de luxe', amount: RULES.taxB },                              // 38
    P('Kalecgos, Aspect des Arcanes', 'dragon', 400000, 'Kalecgos'),                        // 39
  ];

  // Cartes Chance. kinds : money, moveTo, moveBack, jail, jailCard, nearestStation,
  // perHouse (payer par maison/hôtel), collectEach, payEach.
  const CARDS = [
    { text: 'Bob vous paie une tournée ! Recevez 150 000.', kind: 'money', amount: 150000 },
    { text: 'Vous gagnez la LAN HSBG. Recevez 100 000.', kind: 'money', amount: 100000 },
    { text: 'Un bibelot cassé à rembourser. Payez 50 000.', kind: 'money', amount: -50000 },
    { text: 'Taxe sur les pièces d’or : payez 100 000.', kind: 'money', amount: -100000 },
    { text: 'Dividende du Marché noir : recevez 50 000.', kind: 'money', amount: 50000 },
    { text: 'Rafraîchissement ! Avancez jusqu’à la Taverne et recevez 200 000.', kind: 'moveTo', tile: 0 },
    { text: 'Naufrage ! Allez directement sur l’Île perdue, sans passer par la Taverne.', kind: 'jail' },
    { text: 'Vous reculez de 3 cases.', kind: 'moveBack', steps: 3 },
    { text: 'Avancez jusqu’au serviteur neutre le plus proche (Brann, Drakkari, Titus ou Leeroy).', kind: 'nearestStation' },
    { text: "Avancez jusqu’au Ravageur d'obsidienne.", kind: 'moveTo', tile: 39 },
    { text: 'Avancez jusqu’à Bourbissa. Si vous passez par la Taverne, recevez 200 000.', kind: 'moveTo', tile: 6 },
    { text: "Avancez jusqu’à l'accro de la gemme. Si vous passez par la Taverne, recevez 200 000.", kind: 'moveTo', tile: 21 },
    { text: 'Allez aux Championnats du monde.', kind: 'moveTo', tile: 20 },
    { text: 'Sortez gratuitement de l’Île perdue. Cette carte se conserve.', kind: 'jailCard' },
    { text: 'Réparations de la taverne : payez 25 000 par maison et 100 000 par hôtel.', kind: 'perHouse', house: 25000, hotel: 100000 },
    { text: 'C’est votre anniversaire ! Chaque joueur vous donne 50 000.', kind: 'collectEach', amount: 50000 },
    { text: 'Vous offrez la tournée : donnez 30 000 à chaque joueur.', kind: 'payEach', amount: 30000 },
    { text: 'Triple ! Recevez 75 000.', kind: 'money', amount: 75000 },
  ];

  // Pions disponibles
  const TOKENS = ['🐟', '🐺', '👹', '🐉', '⚙️', '🏴‍☠️', '🐗', '🔥'];
  const PLAYER_COLORS = ['#f2c14e', '#5fd0ff', '#ff6b8a', '#7ddf64'];

  const CONFIG = { RULES, GROUPS, BOARD, CARDS, TOKENS, PLAYER_COLORS };
  global.TT_CONFIG = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
