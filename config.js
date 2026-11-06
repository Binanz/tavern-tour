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
    sellRatio: 0.75,           // revente d'une propriété entière = 75 % de l'investissement total
    turnDurationMs: 30000,     // durée de jeu par tour
    auctionMinBid: 10000,      // enchère minimale et incrément minimal
    buyoutMult: 1.25,          // racheter une propriété = 125 % de sa valeur d'achat
    hotelCostMult: 2,          // le serviteur doré coûte 2 niveaux de taverne
    maxHouses: 4,              // 4 niveaux de taverne, puis le serviteur doré
    lockedHousesBeforeLap: 4,  // la Taverne 4 est disponible après un passage par la Taverne
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

  // Loyers : index 0 réservé aux cases sans taverne; achats possibles du niveau 1 au serviteur doré.
  const RENT_MULT = [0.2, 0.5, 1.0, 1.8, 3.0, 5.0];
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
    { type: 'tax', name: 'Impôt de la taverne', amount: RULES.taxA },                       // 4
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
  // perHouse (payer par niveau de taverne/serviteur doré), collectEach, payEach.
  const CARDS = [
    { text: 'La taverne vous paie une tournée ! Recevez 150 000.', kind: 'money', amount: 150000 },
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
    { text: 'Réparations de la taverne : payez 25 000 par niveau de taverne et 100 000 par serviteur doré.', kind: 'perHouse', house: 25000, hotel: 100000 },
    { text: 'C’est votre anniversaire ! Chaque joueur vous donne 50 000.', kind: 'collectEach', amount: 50000 },
    { text: 'Vous offrez la tournée : donnez 30 000 à chaque joueur.', kind: 'payEach', amount: 30000 },
    { text: 'Triple ! Recevez 75 000.', kind: 'money', amount: 75000 },
  ];

  // Pions disponibles
  const TOKENS = ['🐟', '🐺', '👹', '🐉', '⚙️', '🏴‍☠️', '🐗', '🔥'];
  const PLAYER_COLORS = ['#f2c14e', '#5fd0ff', '#ff6b8a', '#7ddf64'];
  const BOT_NAMES = [
    'Aubépine', 'Braise-Lune', 'Capitaine Chardon', 'Dame Poussière', 'Flammegrise', 'Givre-Pic',
    'Grommelune', 'Lanterne', 'Moussebarbe', 'Nacre', 'Orageux', 'Petit Tonnerre', 'Quenouille',
    'Rochebrune', 'Sifflevent', 'Tante Brindille', 'Vieux Grincheux', 'Zéphyr', 'Brume-des-Bois',
    'Cœur-de-Chêne', 'Doux-Sabot', 'Épine Noire', 'Fanal', 'Grain-de-Sel', 'Hibou-Roux',
    'Iris des Brumes', 'Jaspe', 'Korrigan', 'Lune Rousse', 'Mistral', 'Noisette', 'Ocre',
    'Pavot', 'Roncevive', 'Sureau', 'Tison',
  ];

  function applyContent(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Le fichier doit contenir un objet JSON.');
    if (data.boardNames !== undefined) {
      if (!data.boardNames || typeof data.boardNames !== 'object' || Array.isArray(data.boardNames)) throw new Error('boardNames doit être un objet indexé par numéro de case.');
      Object.entries(data.boardNames).forEach(([key, value]) => {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= BOARD.length || typeof value !== 'string' || !value.trim() || value.length > 100) {
          throw new Error(`Nom de case invalide à l’index ${key}.`);
        }
      });
    }
    if (data.cardTexts !== undefined && (!Array.isArray(data.cardTexts) || data.cardTexts.length !== CARDS.length || data.cardTexts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 500))) {
      throw new Error(`cardTexts doit contenir exactement ${CARDS.length} textes non vides.`);
    }
    if (data.botNames !== undefined && (!Array.isArray(data.botNames) || data.botNames.length < RULES.maxPlayers - 1 || data.botNames.some((name) => typeof name !== 'string' || !name.trim() || name.length > 40) || new Set(data.botNames.map((name) => typeof name === 'string' ? name.trim().toLocaleLowerCase() : '')).size !== data.botNames.length)) {
      throw new Error(`botNames doit contenir au moins ${RULES.maxPlayers - 1} noms uniques et non vides.`);
    }
    if (data.boardNames) {
      Object.entries(data.boardNames).forEach(([key, value]) => {
        const tile = BOARD[Number(key)];
        tile.name = value.trim();
        tile.short = value.trim();
      });
    }
    if (data.cardTexts) CARDS.forEach((card, i) => { card.text = data.cardTexts[i].trim(); });
    if (data.botNames) {
      BOT_NAMES.splice(0, BOT_NAMES.length, ...data.botNames.map((name) => name.trim()));
    }
  }

  const CONFIG = { RULES, GROUPS, BOARD, CARDS, TOKENS, PLAYER_COLORS, BOT_NAMES, applyContent };
  if (typeof global.localStorage !== 'undefined') {
    try {
      const savedContent = global.localStorage.getItem('tavern-tour-content-v1');
      if (savedContent) applyContent(JSON.parse(savedContent));
    } catch (error) {
      console.error('Impossible de charger le fichier de contenu enregistré.', error);
    }
  }
  global.TT_CONFIG = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
