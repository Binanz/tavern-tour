// Plateau et règles. Les montants sont en or.
// Noms des serviteurs : pool Battlegrounds actuel, version FR.
(function (global) {
  'use strict';

  const RULES = {
    startCash: 2000000,        // argent de départ (comme Business Tour)
    salary: 200000,            // reçu en passant par la Taverne (Départ)
    jailFee: 100000,           // pour quitter A. F. KAH
    jailMaxTurns: 3,           // tours max à A. F. KAH avant sortie forcée
    championshipFee: 50000,    // utiliser le Sombre Don sur un de ses serviteurs
    championshipMaxMult: 10,   // multiplicateur de loyer max (x2 -> x10)
    worldTourFee: 50000,       // voyager (toujours vers l'avant) vers une case libre ou à soi
    taxA: 200000,              // Impôt
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
  // 32 cases : 4 angles et 7 cases sur chacun des côtés.
  const BOARD = [
    { type: 'start', name: 'La Taverne', sub: 'Départ' },                                    // 0
    P('Rob’aria', 'mech', 60000),                                                            // 1
    P('Tireur de câble', 'mech', 60000),                                                     // 2
    P('Sneed', 'mech', 80000),                                                              // 3
    S('Brann Barbe-de-Bronze', 'Brann'),                                                    // 4
    P('Éclaireur véloce', 'murloc', 100000),                                                 // 5
    P('Bourbissa', 'murloc', 100000),                                                        // 6
    P('Secrétaileron comptable', 'murloc', 120000, 'Secrétaileron'),                        // 7
    { type: 'jail', name: 'A. F. KAH', sub: 'Héros perdu' },                                 // 8
    P('Scarabée des forêts', 'beast', 140000, 'Scarabée'),                                  // 9
    P('Goldrinn, le grand loup', 'beast', 160000, 'Goldrinn'),                              // 10
    P('Louveteau', 'beast', 180000),                                                        // 11
    { type: 'chance', name: 'Chance' },                                                      // 12
    P('Artiste des mers du Sud', 'pirate', 180000, 'Artiste des mers'),                     // 13
    S('Enchanteresse drakkari', 'Drakkari'),                                                 // 14
    P('Eudora, maîtresse d’équipage', 'pirate', 200000, 'Eudora'),                          // 15
    { type: 'championship', name: 'Sombre Don', sub: 'du Sombrelune' },                      // 16
    P('Géomancienne de Tranchebauge', 'quilboar', 220000, 'Géomancienne'),                  // 17
    S('Titus Vaillefendre', 'Titus'),                                                       // 18
    P('Géomage Roogug', 'quilboar', 240000, 'Roogug'),                                      // 19
    { type: 'chance', name: 'Chance' },                                                      // 20
    P('Tisse-colère', 'demon', 260000),                                                      // 21
    P('Tichondrius', 'demon', 280000),                                                      // 22
    P('Malchezaar, prince du rythme', 'demon', 300000, 'Malchezaar'),                       // 23
    { type: 'worldtour', name: 'Portail chronodistordu', sub: 'Voyage dans le temps' },      // 24
    S('Leeroy le Téméraire', 'Leeroy'),                                                      // 25
    P('Modeleur de boules de neige', 'elemental', 300000, 'Modeleur de neige'),             // 26
    P('Ichoron le protecteur', 'elemental', 300000, 'Ichoron'),                             // 27
    { type: 'chance', name: 'Chance' },                                                      // 28
    P('Mère des couvées héroïque', 'dragon', 350000, 'Mère des couvées'),                   // 29
    { type: 'tax', name: 'Impôt de la taverne', amount: RULES.taxA },                       // 30
    P('Kalecgos, Aspect des Arcanes', 'dragon', 400000, 'Kalecgos'),                        // 31
  ];

  // Cartes Chance. kinds : money, moveTo, moveBack, jail, jailCard, nearestStation,
  // perHouse (payer par niveau de taverne/serviteur doré), collectEach, payEach.
  const CARDS = [
    { text: 'La taverne vous paie une tournée ! Recevez 150 000.', kind: 'money', amount: 150000 },
    { text: 'Vous gagnez la LAN HSBG. Recevez 100 000.', kind: 'money', amount: 100000 },
    { text: 'Une chope cassée à rembourser. Payez 50 000.', kind: 'money', amount: -50000 },
    { text: 'Taxe sur les pièces d’or : payez 100 000.', kind: 'money', amount: -100000 },
    { text: 'Dividende du Marché noir : recevez 50 000.', kind: 'money', amount: 50000 },
    { text: 'Rafraîchissement ! Avancez jusqu’à la Taverne et recevez 400 000 (gain doublé).', kind: 'moveTo', tile: 0 },
    { text: 'Vous êtes perdu dans le temps ! Allez directement sur A. F. KAH, sans passer par la Taverne.', kind: 'jail' },
    { text: 'Vous reculez de 3 cases.', kind: 'moveBack', steps: 3 },
    { text: 'Avancez jusqu’au serviteur neutre le plus proche (Brann, Drakkari, Titus ou Leeroy).', kind: 'nearestStation' },
    { text: 'Avancez jusqu’à Kalecgos. Si vous passez par la Taverne, recevez 200 000.', kind: 'moveTo', tile: 31 },
    { text: 'Avancez jusqu’à Éclaireur véloce. Si vous passez par la Taverne, recevez 200 000.', kind: 'moveTo', tile: 5 },
    { text: 'Avancez jusqu’à la Géomancienne de Tranchebauge. Si vous passez par la Taverne, recevez 200 000.', kind: 'moveTo', tile: 17 },
    { text: 'Rendez-vous au Sombre Don.', kind: 'moveTo', tile: 16 },
    { text: 'A. F. KAH vous libère. Cette carte se conserve.', kind: 'jailCard' },
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

  const ANOMALIES = {
    festival: { name: "Festival itinérant", description: "Les trois cases Festival changent à chaque tour de table." },
    cursed: { name: "Terres maudites", description: "Trois terrains coûtent 25 % moins cher à l’achat (terrain seul), mais leurs loyers sont doublés. Les constructions gardent leur prix." },
    destiny: { name: "Dé du destin", description: "Hors prison et ordre de passage, lancez trois dés et choisissez les deux à garder. Seuls ces deux dés comptent pour les doubles." },
  };

  const POWER_RULES = { maxInventory: 2, legendaryChance: 0.05 };
  const POWERS = {
    shield: { name: 'Bouclier de Bob', description: 'La banque couvre jusqu’à 200 000 or de votre prochain loyer. Le propriétaire reçoit son loyer complet.', rare: false },
    reroll: { name: 'Seconde chance', description: 'Au prochain lancer, regardez les dés puis gardez-les ou relancez une fois.', rare: false },
    step: { name: 'Coup de pouce', description: 'Ajoutez ou retirez 1 au prochain déplacement aux dés. Les doubles ne changent pas.', rare: false },
    permit: { name: 'Permis de construire', description: 'Économisez jusqu’à 150 000 or sur une prochaine amélioration (hors achat initial).', rare: false },
    rentSkip: { name: 'Tournée légendaire', description: 'La banque paie intégralement votre prochain loyer, sans plafond.', rare: true },
    annihilation: { name: 'Anéantissement', description: 'Renvoyez à la banque une propriété adverse et toutes ses constructions, même dorées. Aucun remboursement.', rare: true },
    goldenGift: { name: 'Toucher de Midas', description: 'Transformez gratuitement une de vos propriétés en serviteur doré.', rare: true },
  };

  const CONFIG = { POWER_RULES, POWERS, ANOMALIES, RULES, GROUPS, BOARD, CARDS, TOKENS, PLAYER_COLORS, BOT_NAMES, applyContent };
  if (typeof global.localStorage !== 'undefined') {
    try {
      const currentKey = 'tavern-tour-content-v4';
      let savedContent = global.localStorage.getItem(currentKey);
      if (!savedContent) {
        const v3Content = global.localStorage.getItem('tavern-tour-content-v3');
        const v2Content = global.localStorage.getItem('tavern-tour-content-v2');
        const v1Content = v2Content ? null : global.localStorage.getItem('tavern-tour-content-v1');
        const previousContent = v3Content || v2Content || v1Content;
        if (previousContent) {
          const legacy = JSON.parse(previousContent);
          if (legacy.boardNames) {
            if (v1Content) {
              const oldToNew = [0, 1, null, 2, null, 4, 5, 12, 6, 7, 8, 9, null, 10, 11, 14, 13, null, null, 15, 16, 17, 20, null, 19, 18, 21, 22, null, 23, 24, 26, 27, null, null, 25, 28, 29, 30, 31];
              legacy.boardNames = Object.fromEntries(Object.entries(legacy.boardNames).filter(([index]) => oldToNew[Number(index)] !== undefined && oldToNew[Number(index)] !== null).map(([index, name]) => [oldToNew[Number(index)], name]));
            }
            const names = { ...legacy.boardNames };
            const replaceDefault = (index, oldName, fallback) => {
              if (names[index] === oldName || names[index] === 'Sans type') names[index] = fallback;
            };
            replaceDefault('3', 'Brann Barbe-de-Bronze', 'Sneed');
            replaceDefault('7', 'Enchanteresse drakkari', 'Secrétaileron comptable');
            replaceDefault('11', 'Titus Vaillefendre', 'Louveteau');
            replaceDefault('23', 'Leeroy le Téméraire', 'Malchezaar, prince du rythme');
            if (names['3'] === undefined) names['3'] = 'Sneed';
            if (names['7'] === undefined) names['7'] = 'Secrétaileron comptable';
            if (names['11'] === undefined) names['11'] = 'Louveteau';
            if (names['23'] === undefined) names['23'] = 'Malchezaar, prince du rythme';
            if (!names['4'] || names['4'] === 'Sans type') names['4'] = 'Brann Barbe-de-Bronze';
            if (!names['14'] || names['14'] === 'Sans type') names['14'] = 'Enchanteresse drakkari';
            if (!names['18'] || names['18'] === 'Sans type') names['18'] = 'Titus Vaillefendre';
            if (!names['25'] || names['25'] === 'Sans type') names['25'] = 'Leeroy le Téméraire';
            const renameDefault = (index, oldName, newName) => {
              if (names[index] === oldName) names[index] = newName;
            };
            renameDefault('8', "L'Île perdue", 'A. F. KAH');
            renameDefault('16', 'Championnats', 'Sombre Don');
            renameDefault('24', 'Tour du monde', 'Portail chronodistordu');
            legacy.boardNames = names;
          }
          if (legacy.cardTexts && legacy.cardTexts[8] === 'Avancez jusqu’au serviteur le plus proche.') {
            legacy.cardTexts[8] = 'Avancez jusqu’au serviteur neutre le plus proche (Brann, Drakkari, Titus ou Leeroy).';
          }
          if (legacy.cardTexts && legacy.cardTexts[5] === 'Rafraîchissement ! Avancez jusqu’à la Taverne et recevez 200 000.') {
            legacy.cardTexts[5] = 'Rafraîchissement ! Avancez jusqu’à la Taverne et recevez 400 000 (gain doublé).';
          }
          if (legacy.cardTexts) {
            legacy.cardTexts = legacy.cardTexts.map((text) => text
              .replaceAll("l’Île perdue", 'A. F. KAH')
              .replaceAll("L’Île perdue", 'A. F. KAH')
              .replaceAll('aux Championnats du monde', 'au Sombre Don'));
          }
          savedContent = JSON.stringify(legacy);
          global.localStorage.setItem(currentKey, savedContent);
        }
      }
      if (savedContent) applyContent(JSON.parse(savedContent));
    } catch (error) {
      console.error('Impossible de charger le fichier de contenu enregistré.', error);
    }
  }
  global.TT_CONFIG = CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
