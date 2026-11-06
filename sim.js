// Simulation Node : parties complètes entre 4 bots + vérification d'invariants.
// Usage : node sim.js [nbParties]
const CFG = require('./config.js');
const E = require('./engine.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(state, ctx) {
  const total = state.players.reduce((s, p) => s + p.cash, 0);
  state.players.forEach((p, i) => {
    if (p.cash < 0) throw new Error(`cash négatif joueur ${i} (${ctx})`);
    if (p.pos < 0 || p.pos >= E.N) throw new Error(`position invalide (${ctx})`);
    if (p.bankrupt && state.tiles.some((t, tile) => t && t.owner === i && (!state.auction || state.auction.owner !== i || !state.auction.tiles.slice(state.auction.cursor).includes(tile)))) {
      throw new Error(`joueur en faillite possède une case hors enchères (${ctx})`);
    }
  });
  state.tiles.forEach((t, i) => {
    if (!t) return;
    if (t.houses < 0 || t.houses > E.HOTEL) throw new Error(`niveau de taverne invalide case ${i} (${ctx})`);
    if (t.owner !== null && CFG.BOARD[i].type !== 'property' && t.houses !== 0) throw new Error(`niveau sur une gare (${ctx})`);
  });
  if (!isFinite(total)) throw new Error('total NaN');
}

function createStartedGame(players, opts, now) {
  const state = E.createGame(players, opts, mulberry32(42), now);
  const diceByPlayer = [[0.99, 0.99], [0.8, 0.8], [0.6, 0.6], [0.4, 0.4]];
  while (state.ordering) {
    const dice = diceByPlayer[state.current];
    let roll = 0;
    const result = E.apply(state, state.current, { type: 'orderRoll' }, () => dice[roll++], now || Date.now());
    if (!result.ok) throw new Error('tirage de l’ordre refusé: ' + result.error);
  }
  return state;
}

function runGame(seed, durationMin, verbose) {
  const rng = mulberry32(seed);
  let now = 1000;
  const players = [
    { name: 'Bot Test', token: '🐟', isBot: true },
    { name: 'Bot Bran', token: '🐺', isBot: true },
    { name: 'Bot Titus', token: '👹', isBot: true },
    { name: 'Bot Nomi', token: '🔥', isBot: true },
  ];
  const state = E.createGame(players, { durationMin }, rng, now);
  let actions = 0;
  const stepCounts = {};
  while (state.phase === 'playing') {
    now += 4000; // ~4 s par action simulée
    if (E.tick(state, now)) {
      if (state.phase !== 'playing') break;
      checkInvariants(state, `seed ${seed} timeout`);
      continue;
    }
    const idx = state.current;
    const a = E.botAction(state, idx);
    if (!a) throw new Error(`bot sans action à l'étape ${state.turn.step}`);
    stepCounts[state.turn.step] = (stepCounts[state.turn.step] || 0) + 1;
    const res = E.apply(state, idx, a, rng, now);
    if (!res.ok) throw new Error(`action refusée: ${JSON.stringify(a)} à l'étape ${state.turn.step}: ${res.error}`);
    checkInvariants(state, `seed ${seed} action ${actions}`);
    actions++;
    if (actions > 20000) throw new Error('boucle infinie ?');
  }
  if (verbose) {
    console.log(`seed ${seed}: ${actions} actions, ${state.turnCount} tours, fin=${state.endReason}`);
    state.ranking.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} — ${E.fmt(r.worth)} (cash ${E.fmt(r.cash)}, ${r.props} cases${r.bankrupt ? ', FAILLITE' : ''})`));
    console.log('  étapes:', JSON.stringify(stepCounts));
    console.log('  derniers logs:'); state.log.slice(-6).forEach((l) => console.log('   ', l.t));
  }
  return { state, actions, stepCounts };
}

const n = parseInt(process.argv[2] || '30', 10);
let bankrupts = 0, timeEnds = 0, totalTurns = 0;
const agg = {};
for (let s = 1; s <= n; s++) {
  const { state, stepCounts } = runGame(s, 20, s <= 2);
  if (state.endReason === 'bankrupt') bankrupts++; else timeEnds++;
  totalTurns += state.turnCount;
  for (const k in stepCounts) agg[k] = (agg[k] || 0) + stepCounts[k];
}
console.log(`\n${n} parties OK — fins par chrono: ${timeEnds}, par faillite: ${bankrupts}, tours moyens: ${(totalTurns / n).toFixed(1)}`);
console.log('étapes cumulées:', JSON.stringify(agg));

// Tests ciblés de règles
(function unitTests() {
  const rng = mulberry32(42);
  const RULES = CFG.RULES;
  const tile = { mother: 29, kalecgos: 31, stations: [4, 14, 18, 25] };
  const sideTiles = CFG.BOARD.filter((_, i) => ![0, 8, 16, 24].includes(i));
  const sideRanges = [[1, 7], [9, 15], [17, 23], [25, 31]];
  const expectedRoute = [
    'start', 'property:mech', 'property:mech', 'property:mech', 'station',
    'property:murloc', 'property:murloc', 'property:murloc', 'jail',
    'property:beast', 'property:beast', 'property:beast', 'chance',
    'property:pirate', 'station', 'property:pirate', 'championship',
    'property:quilboar', 'station', 'property:quilboar', 'chance',
    'property:demon', 'property:demon', 'property:demon', 'worldtour',
    'station', 'property:elemental', 'property:elemental', 'chance',
    'property:dragon', 'tax', 'property:dragon',
  ];
  if (CFG.BOARD.map((t) => t.type === 'property' ? `${t.type}:${t.group}` : t.type).join(',') !== expectedRoute.join(',')) {
    throw new Error('l’ordre des cases ne correspond pas au plan demandé');
  }
  const expectedGroupCounts = { mech: 3, murloc: 3, beast: 3, pirate: 2, quilboar: 2, demon: 3, elemental: 2, dragon: 2 };
  if (Object.entries(expectedGroupCounts).some(([group, count]) => CFG.BOARD.filter((t) => t.type === 'property' && t.group === group).length !== count)) {
    throw new Error('le nombre de serviteurs par groupe ne correspond pas au plan demandé');
  }
  if (CFG.BOARD.length !== 32 || sideTiles.filter((t) => t.type === 'property').length !== 20 || sideTiles.filter((t) => t.type === 'station').length !== 4
    || sideTiles.filter((t) => t.type === 'chance').length !== 3 || sideTiles.filter((t) => t.type === 'tax').length !== 1) {
    throw new Error('le plateau doit avoir 32 cases et respecter la répartition prévue des cases latérales');
  }
  if (sideRanges.some(([from, to]) => CFG.BOARD.slice(from, to + 1).filter((t) => t.type === 'station').length !== 1)
    || sideTiles.filter((t) => t.type === 'property' || t.type === 'station').length !== 24) {
    throw new Error('chaque côté doit avoir exactement un serviteur neutre, et le plateau doit proposer 24 serviteurs au total');
  }
  tile.stations.forEach((i) => {
    const emptyGame = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
    emptyGame.tiles[i].owner = 1;
    if (E.canBuyout(emptyGame, 0, i)) throw new Error(`le serviteur neutre ${i} ne peut pas être racheté`);
  });
  if (CFG.BOARD.some((tile) => tile.type === 'property' && tile.rents.length !== E.HOTEL + 1)) throw new Error('chaque propriété doit avoir un loyer pour chaque niveau');
  const orderGame = E.createGame([{ name: 'A' }, { name: 'B' }], {}, rng, 1000);
  const orderDuration = orderGame.remainingMs;
  if (E.tick(orderGame, 100000000) || orderGame.remainingMs !== orderDuration) throw new Error('le chrono ne doit pas démarrer pendant le tirage de l’ordre');
  E.apply(orderGame, 0, { type: 'orderRoll' }, () => 0, 1000);
  E.apply(orderGame, 1, { type: 'orderRoll' }, () => 0, 1000);
  if (!orderGame.ordering || orderGame.ordering.round !== 2 || orderGame.ordering.pending.join(',') !== '0,1') throw new Error('les joueurs à égalité doivent relancer');
  E.apply(orderGame, 0, { type: 'orderRoll' }, (() => { const values = [0.99, 0.99]; return () => values.shift(); })(), 1500);
  E.apply(orderGame, 1, { type: 'orderRoll' }, (() => { const values = [0, 0.2]; return () => values.shift(); })(), 2000);
  if (orderGame.ordering || orderGame.turnOrder.join(',') !== '0,1' || orderGame.current !== 0 || orderGame.startedAt !== 2000) throw new Error('résolution de l’ordre de passage incorrecte');
  orderGame.turn.step = 'done';
  E.apply(orderGame, 0, { type: 'endTurn' }, rng, 3000);
  if (orderGame.current !== 1) throw new Error('le tour suivant ne respecte pas l’ordre déterminé');
  const st = createStartedGame([{ name: 'A' }, { name: 'B' }], { durationMin: 20 }, 0);
  st.tiles[tile.kalecgos].owner = 1; st.tiles[tile.kalecgos].houses = E.HOTEL;
  st.tiles[tile.mother].owner = 1;
  st.players[0].cash = 500000; st.players[0].pos = 30;
  const r = E.apply(st, 0, { type: 'roll' }, () => 0.0, 1000); // 1+1 => Taverne => salaire
  if (!r.ok) throw new Error(r.error);
  if (st.players[0].cash !== 700000) throw new Error('salaire non reçu: ' + st.players[0].cash);
  if (st.players[0].laps !== 1) throw new Error('tour de plateau non compté');
  if (st.turn.step !== 'roll') throw new Error('double devrait permettre de rejouer: ' + st.turn.step);
  const nearestServant = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
  nearestServant.deck = [8];
  nearestServant.players[0].pos = 10;
  E.apply(nearestServant, 0, { type: 'roll' }, () => 0, 0);
  if (nearestServant.players[0].pos !== 14 || nearestServant.turn.step !== 'buy') throw new Error('la carte du serviteur neutre le plus proche doit avancer sur la prochaine case de serviteur neutre');
  st.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  st.players[0].pos = 28; st.players[0].cash = 10000;
  E.apply(st, 0, { type: 'roll' }, () => 0.0, 1000); // 1+1 => case taxe -> dette
  if (st.turn.step !== 'debt') throw new Error('dette attendue, step=' + st.turn.step);
  const rb = E.apply(st, 0, { type: 'declareBankrupt' }, rng, 1000);
  if (!rb.ok) throw new Error(rb.error);
  if (st.phase !== 'ended') throw new Error('la partie devrait être finie (1 survivant)');
  if (st.ranking[0].name !== 'B') throw new Error('B devrait gagner');

  // Loyers : groupe complet doublé + championnat ; serviteurs neutres
  const s2 = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
  s2.tiles[tile.mother].owner = 1; s2.tiles[tile.kalecgos].owner = 1;
  if (E.computeRent(s2, tile.mother, 7) !== CFG.BOARD[tile.mother].rents[0] * 2) throw new Error('loyer doublé attendu');
  s2.championship = { tile: tile.mother, mult: 3 };
  if (E.computeRent(s2, tile.mother, 7) !== CFG.BOARD[tile.mother].rents[0] * 6) throw new Error('championnat x3 attendu');
  s2.tiles[21].owner = 1; s2.tiles[22].owner = 1; s2.tiles[23].owner = 1;
  if (E.computeRent(s2, 21) !== CFG.BOARD[21].rents[0] * 2) throw new Error('loyer de groupe complet attendu pour les serviteurs de type F');
  s2.tiles[tile.stations[0]].owner = 1; s2.tiles[tile.stations[1]].owner = 1;
  if (E.computeRent(s2, tile.stations[0]) !== RULES.stationRents[1]) throw new Error('loyer de 2 serviteurs neutres attendu');
  if (E.apply(s2, 1, { type: 'roll' }, rng, 0).ok) throw new Error('B ne doit pas pouvoir jouer');
  const stationPurchase = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
  stationPurchase.players[0].pos = 2;
  E.apply(stationPurchase, 0, { type: 'roll' }, () => 0, 0);
  if (stationPurchase.turn.step !== 'buy' || E.buyOptions(stationPurchase, 0, tile.stations[0])[0].houses !== 0) throw new Error('le serviteur neutre doit être achetable sans niveau');
  if (!E.apply(stationPurchase, 0, { type: 'buy' }, rng, 0).ok || stationPurchase.tiles[tile.stations[0]].owner !== 0) throw new Error('achat du serviteur neutre refusé');

  // Achat à plusieurs niveaux : seule Taverne 4 est verrouillée avant un tour de plateau
  const s3 = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
  s3.players[0].pos = tile.mother; // 1+1 => Kalecgos libre
  E.apply(s3, 0, { type: 'roll' }, () => 0.0, 0);
  if (s3.turn.step !== 'buy') throw new Error('achat attendu');
  if (E.buyOptions(s3, 0, tile.kalecgos).find((option) => option.houses === 3).locked) throw new Error('Taverne 3 devrait être disponible au premier tour');
  if (!E.buyOptions(s3, 0, tile.kalecgos).find((option) => option.houses === 4).locked) throw new Error('Taverne 4 devrait être verrouillée au premier tour');
  if (E.apply(s3, 0, { type: 'buy', houses: 4 }, rng, 0).ok) throw new Error('achat de Taverne 4 accepté au premier tour');
  const hc = CFG.GROUPS.dragon.houseCost;
  const purchaseOptions = E.buyOptions(s3, 0, tile.kalecgos);
  if (purchaseOptions.map((option) => option.houses).join(',') !== '1,2,3,4') throw new Error('achat doit commencer à Taverne 1');
  if (E.apply(s3, 0, { type: 'buy', houses: 0 }, rng, 0).ok) throw new Error('achat sans taverne accepté');
  if (!E.apply(s3, 0, { type: 'buy', houses: 2 }, rng, 0).ok) throw new Error('achat avec 2 Tavernes refusé');
  if (s3.players[0].cash !== 2000000 - 400000 - 2 * hc) throw new Error('prix achat 2 Tavernes incorrect: ' + s3.players[0].cash);
  if (s3.tiles[tile.kalecgos].houses !== 2) throw new Error('Taverne 2 attendue');
  if (E.tileValue(s3, tile.kalecgos) !== 400000 + 2 * hc) throw new Error('valeur case incorrecte');
  // Rachat par B : loyer puis rachat à 125 % de la valeur ; Serviteur doré non rachetable
  s3.current = 1; s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = tile.mother; s3.players[1].cash = 3000000;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0); // tombe sur Kalecgos (Taverne 2)
  const rent = CFG.BOARD[tile.kalecgos].rents[2];
  if (s3.turn.lastPay.amount !== rent) throw new Error('loyer Taverne 2 attendu: ' + JSON.stringify(s3.turn.lastPay));
  if (s3.turn.step !== 'buyout') throw new Error('étape rachat attendue, step=' + s3.turn.step);
  const price = Math.round((400000 + 2 * hc) * 1.25);
  if (s3.turn.buyoutPrice !== price) throw new Error('prix de rachat incorrect');
  const cashA = s3.players[0].cash, cashB = s3.players[1].cash;
  if (!E.apply(s3, 1, { type: 'buyout' }, rng, 0).ok) throw new Error('rachat refusé');
  if (s3.tiles[tile.kalecgos].owner !== 1 || s3.tiles[tile.kalecgos].houses !== 2) throw new Error('rachat : propriétaire/niveau incorrects');
  if (s3.players[0].cash !== cashA + price || s3.players[1].cash !== cashB - price) throw new Error('rachat : transfert incorrect');
  // Construction : niveaux 3 et 4 verrouillés avant un tour ; Serviteur doré après Taverne 4
  s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = tile.mother;
  if (E.buildOptions(s3, 1, tile.kalecgos).find((o) => o.houses === 3).locked || !E.buildOptions(s3, 1, tile.kalecgos).find((o) => o.houses === 4).locked) throw new Error('seule Taverne 4 doit être verrouillée avant un tour');
  s3.players[1].laps = 1;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0);
  if (s3.turn.step !== 'build') throw new Error('construction attendue, step=' + s3.turn.step);
  if (!E.apply(s3, 1, { type: 'build', houses: 3 }, rng, 0).ok) throw new Error('Taverne 3 refusée après un tour');
  s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = tile.mother;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0);
  if (!E.apply(s3, 1, { type: 'build', houses: 4 }, rng, 0).ok) throw new Error('Taverne 4 refusée après un tour');
  if (s3.tiles[tile.kalecgos].houses !== 4 || E.computeRent(s3, tile.kalecgos, 7) !== CFG.BOARD[tile.kalecgos].rents[4]) throw new Error('niveau ou loyer Taverne 4 incorrect');
  s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = tile.mother;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0);
  const opts = E.buildOptions(s3, 1, tile.kalecgos);
  if (opts.length !== 1 || opts[0].houses !== E.HOTEL || opts[0].cost !== hc * RULES.hotelCostMult) throw new Error('option Serviteur doré attendue: ' + JSON.stringify(opts));
  if (!E.apply(s3, 1, { type: 'build', houses: E.HOTEL }, rng, 0).ok) throw new Error('Serviteur doré refusé');
  if (E.canBuyout(s3, 0, tile.kalecgos)) throw new Error('un Serviteur doré ne doit pas être rachetable');
  if (E.computeRent(s3, tile.kalecgos, 7) !== CFG.BOARD[tile.kalecgos].rents[E.HOTEL]) throw new Error('loyer Serviteur doré attendu');
  // La vente d'une propriété entière inclut toutes ses tavernes.
  s3.current = 1; s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  const before = s3.players[1].cash;
  const invested = E.tileValue(s3, tile.kalecgos);
  if (!E.apply(s3, 1, { type: 'sell', tile: tile.kalecgos }, rng, 0).ok) throw new Error('revente refusée');
  if (s3.players[1].cash - before !== Math.floor(invested * 0.75) || s3.tiles[tile.kalecgos].owner !== null || s3.tiles[tile.kalecgos].houses !== 0) throw new Error('vente complète du Serviteur doré incorrecte');

  const s5 = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
  s5.players[0].pos = tile.mother;
  E.apply(s5, 0, { type: 'roll' }, () => 0.0, 0);
  if (!E.apply(s5, 0, { type: 'buy', houses: 1 }, rng, 0).ok) throw new Error('achat Taverne 1 refusé');
  const resaleBefore = s5.players[0].cash;
  if (!E.apply(s5, 0, { type: 'sell', tile: tile.kalecgos }, rng, 0).ok) throw new Error('revente Taverne 1 refusée');
  if (s5.tiles[tile.kalecgos].owner !== null || s5.tiles[tile.kalecgos].houses !== 0 || s5.players[0].cash - resaleBefore !== Math.floor((CFG.BOARD[tile.kalecgos].price + hc) * 0.75)) throw new Error('revente Taverne 1 doit rapporter 75 % de l’investissement');

  const timed = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, Date.now());
  const next = timed.turnOrder.find((i) => i !== timed.current);
  if (timed.turnEndsAt - timed.startedAt !== RULES.turnDurationMs) throw new Error('chaque tour doit commencer avec 30 secondes');
  if (E.tick(timed, timed.turnEndsAt - 1) || timed.current === next) throw new Error('le tour ne doit pas expirer avant 30 secondes');
  if (!E.tick(timed, timed.turnEndsAt) || timed.current !== next) throw new Error('le tour doit passer automatiquement après 30 secondes');

  const timedDebt = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, Date.now());
  timedDebt.tiles[tile.kalecgos] = { owner: timedDebt.current, houses: 2 };
  timedDebt.turn = { step: 'debt', debt: { amount: 2100000, to: null, reason: 'test' }, offer: null, lastPay: null };
  const debtPlayer = timedDebt.current;
  const debtBefore = timedDebt.players[debtPlayer].cash;
  const debtSale = E.sellValue(timedDebt, tile.kalecgos);
  const debtDeadline = timedDebt.turnEndsAt;
  if (!E.tick(timedDebt, debtDeadline) || timedDebt.turn.step === 'debt' || timedDebt.tiles[tile.kalecgos].owner !== null) throw new Error('une dette doit être réglée par vente forcée à expiration du tour');
  if (timedDebt.players[debtPlayer].cash !== debtBefore + debtSale - 2100000) throw new Error('la vente forcée doit créditer 75 % de l’investissement');

  const s6 = createStartedGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], {}, Date.now());
  s6.tiles[tile.kalecgos] = { owner: 0, houses: 2 };
  s6.tiles[tile.mother] = { owner: 0, houses: 1 };
  s6.current = 0;
  s6.turn = { step: 'debt', debt: { amount: 100000000, to: null, reason: 'test' }, offer: null, lastPay: null };
  if (!E.apply(s6, 0, { type: 'declareBankrupt' }, rng, Date.now()).ok || !s6.auction) throw new Error('la faillite doit lancer les enchères');
  const firstLot = s6.auction.tiles[0];
  const secondLot = s6.auction.tiles[1];
  const winner = s6.auction.current;
  if (!E.apply(s6, winner, { type: 'auctionBid', amount: RULES.auctionMinBid }, rng, Date.now()).ok) throw new Error('enchère minimale refusée');
  const secondBidder = s6.auction.current;
  if (secondBidder === winner || !E.apply(s6, secondBidder, { type: 'auctionPass' }, rng, Date.now()).ok) throw new Error('le second joueur doit pouvoir passer');
  if (s6.tiles[firstLot].owner !== winner || s6.tiles[firstLot].houses !== (firstLot === tile.kalecgos ? 2 : 1) || s6.players[0].cash !== Math.floor(RULES.auctionMinBid / 2)) throw new Error('l’enchère doit inclure les niveaux et reverser 50 % au joueur en faillite');
  while (s6.auction) {
    const bidder = s6.auction.current;
    if (!E.apply(s6, bidder, { type: 'auctionPass' }, rng, Date.now()).ok) throw new Error('passage d’enchère refusé');
  }
  if (s6.tiles[secondLot].owner !== null || s6.tiles[secondLot].houses !== 0) throw new Error('une propriété sans enchère doit retourner à la banque');

  // Tour du monde : il remplace le prochain tour, sans lancer les dés.
  const s4 = createStartedGame([{ name: 'A' }, { name: 'B' }], {}, 0);
  const traveler = s4.current;
  const other = s4.turnOrder.find((i) => i !== traveler);
  s4.players[traveler].pos = 21;
  let worldTourDie = 0;
  if (!E.apply(s4, traveler, { type: 'roll' }, () => [0, 0.2][worldTourDie++], 0).ok) throw new Error('lancer vers le Tour du monde refusé');
  if (!s4.players[traveler].worldTourPending || s4.turn.step !== 'done') throw new Error('le Tour du monde doit être réservé au prochain tour');
  if (!E.apply(s4, traveler, { type: 'endTurn' }, rng, 0).ok || s4.current !== other) throw new Error('fin du tour précédent refusée');
  s4.turn.step = 'done';
  if (!E.apply(s4, other, { type: 'endTurn' }, rng, 0).ok || s4.current !== traveler) throw new Error('retour au joueur du Tour du monde refusé');
  if (s4.turn.step !== 'teleport' || s4.players[traveler].worldTourPending) throw new Error('le prochain tour doit commencer par le Portail, sans lancer de dés');
  if (E.apply(s4, traveler, { type: 'roll' }, rng, 0).ok) throw new Error('le joueur ne doit pas pouvoir lancer les dés pendant son Tour du monde');
  const c0 = s4.players[traveler].cash;
  if (!E.apply(s4, traveler, { type: 'teleport', tile: 1 }, rng, 0).ok) throw new Error('voyage refusé');
  if (s4.players[traveler].pos !== 1 || s4.players[traveler].laps !== 1) throw new Error('voyage : position/tour incorrects');
  if (s4.players[traveler].cash !== c0 - RULES.worldTourFee + RULES.salary) throw new Error('voyage : salaire attendu');
  const mv = s4.events.find((e) => e.type === 'move');
  if (!mv || mv.teleport || mv.steps !== 9) throw new Error('le voyage doit avancer de 9 cases: ' + JSON.stringify(mv));

  console.log('Tests unitaires OK');
})();
