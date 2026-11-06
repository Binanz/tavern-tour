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
    if (p.pos < 0 || p.pos >= 40) throw new Error(`position invalide (${ctx})`);
    if (p.bankrupt && state.tiles.some((t) => t && t.owner === i)) throw new Error(`joueur en faillite possède encore des cases (${ctx})`);
  });
  state.tiles.forEach((t, i) => {
    if (!t) return;
    if (t.houses < 0 || t.houses > E.HOTEL) throw new Error(`maisons invalides case ${i} (${ctx})`);
    if (t.owner !== null && CFG.BOARD[i].type !== 'property' && t.houses !== 0) throw new Error(`maisons sur une gare (${ctx})`);
  });
  if (!isFinite(total)) throw new Error('total NaN');
}

function runGame(seed, durationMin, verbose) {
  const rng = mulberry32(seed);
  let now = 1000;
  const players = [
    { name: 'Bot Murky', token: '🐟', isBot: true },
    { name: 'Bot Bran', token: '🐺', isBot: true },
    { name: 'Bot Titus', token: '👹', isBot: true },
    { name: 'Bot Nomi', token: '🔥', isBot: true },
  ];
  const state = E.createGame(players, { durationMin }, rng, now);
  let actions = 0;
  const stepCounts = {};
  while (state.phase === 'playing') {
    now += 4000; // ~4 s par action simulée
    if (E.tick(state, now)) break;
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
  const st = E.createGame([{ name: 'A' }, { name: 'B' }], { durationMin: 20 }, rng, 0);
  st.tiles[39].owner = 1; st.tiles[39].houses = E.HOTEL;
  st.tiles[37].owner = 1;
  st.players[0].cash = 500000; st.players[0].pos = 38;
  const r = E.apply(st, 0, { type: 'roll' }, () => 0.0, 1000); // 1+1 => Taverne => salaire
  if (!r.ok) throw new Error(r.error);
  if (st.players[0].cash !== 700000) throw new Error('salaire non reçu: ' + st.players[0].cash);
  if (st.players[0].laps !== 1) throw new Error('tour de plateau non compté');
  if (st.turn.step !== 'roll') throw new Error('double devrait permettre de rejouer: ' + st.turn.step);
  st.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  st.players[0].pos = 36; st.players[0].cash = 10000;
  E.apply(st, 0, { type: 'roll' }, () => 0.0, 1000); // 1+1 => 38 taxe de luxe -> dette
  if (st.turn.step !== 'debt') throw new Error('dette attendue, step=' + st.turn.step);
  const rb = E.apply(st, 0, { type: 'declareBankrupt' }, rng, 1000);
  if (!rb.ok) throw new Error(rb.error);
  if (st.phase !== 'ended') throw new Error('la partie devrait être finie (1 survivant)');
  if (st.ranking[0].name !== 'B') throw new Error('B devrait gagner');

  // Loyers : groupe complet doublé + championnat ; gares ; services
  const s2 = E.createGame([{ name: 'A' }, { name: 'B' }], {}, rng, 0);
  s2.tiles[37].owner = 1; s2.tiles[39].owner = 1;
  if (E.computeRent(s2, 37, 7) !== CFG.BOARD[37].rents[0] * 2) throw new Error('loyer doublé attendu');
  s2.championship = { tile: 37, mult: 3 };
  if (E.computeRent(s2, 37, 7) !== CFG.BOARD[37].rents[0] * 6) throw new Error('championnat x3 attendu');
  s2.tiles[5].owner = 1; s2.tiles[15].owner = 1;
  if (E.computeRent(s2, 5) !== RULES.stationRents[1]) throw new Error('loyer 2 gares attendu');
  s2.tiles[12].owner = 1;
  if (E.computeRent(s2, 12, 9) !== 9 * RULES.utilityMult[0]) throw new Error('loyer service attendu');
  if (E.apply(s2, 1, { type: 'roll' }, rng, 0).ok) throw new Error('B ne doit pas pouvoir jouer');

  // Achat à plusieurs niveaux : 3e maison verrouillée avant un tour de plateau
  const s3 = E.createGame([{ name: 'A' }, { name: 'B' }], {}, rng, 0);
  s3.players[0].pos = 37; // 1+1 => 39 Kalecgos libre
  E.apply(s3, 0, { type: 'roll' }, () => 0.0, 0);
  if (s3.turn.step !== 'buy') throw new Error('achat attendu');
  if (E.apply(s3, 0, { type: 'buy', houses: 3 }, rng, 0).ok) throw new Error('3 maisons devraient être verrouillées au premier tour');
  const hc = CFG.GROUPS.dragon.houseCost;
  if (!E.apply(s3, 0, { type: 'buy', houses: 2 }, rng, 0).ok) throw new Error('achat avec 2 maisons refusé');
  if (s3.players[0].cash !== 2000000 - 400000 - 2 * hc) throw new Error('prix achat 2 maisons incorrect: ' + s3.players[0].cash);
  if (s3.tiles[39].houses !== 2) throw new Error('2 maisons attendues');
  if (E.tileValue(s3, 39) !== 400000 + 2 * hc) throw new Error('valeur case incorrecte');
  // Rachat par B : loyer puis rachat 2x la valeur ; hôtel non rachetable
  s3.current = 1; s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = 37; s3.players[1].cash = 3000000;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0); // tombe sur Kalecgos (2 maisons)
  const rent = CFG.BOARD[39].rents[2];
  if (s3.turn.lastPay.amount !== rent) throw new Error('loyer 2 maisons attendu: ' + JSON.stringify(s3.turn.lastPay));
  if (s3.turn.step !== 'buyout') throw new Error('étape rachat attendue, step=' + s3.turn.step);
  const price = (400000 + 2 * hc) * RULES.buyoutMult;
  if (s3.turn.buyoutPrice !== price) throw new Error('prix de rachat incorrect');
  const cashA = s3.players[0].cash, cashB = s3.players[1].cash;
  if (!E.apply(s3, 1, { type: 'buyout' }, rng, 0).ok) throw new Error('rachat refusé');
  if (s3.tiles[39].owner !== 1 || s3.tiles[39].houses !== 2) throw new Error('rachat : propriétaire/maisons incorrects');
  if (s3.players[0].cash !== cashA + price || s3.players[1].cash !== cashB - price) throw new Error('rachat : transfert incorrect');
  // Construction : B retombe chez lui, 3e maison verrouillée (laps 0) ; après un tour, 3 puis hôtel
  s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = 37;
  if (!E.buildOptions(s3, 1, 39)[0].locked || E.canBuild(s3, 1, 39)) throw new Error('3e maison verrouillée attendue avant un tour');
  s3.players[1].laps = 1;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0);
  if (s3.turn.step !== 'build') throw new Error('construction attendue, step=' + s3.turn.step);
  if (!E.apply(s3, 1, { type: 'build', houses: 3 }, rng, 0).ok) throw new Error('3e maison refusée après un tour');
  s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  s3.players[1].pos = 37;
  E.apply(s3, 1, { type: 'roll' }, () => 0.0, 0);
  const opts = E.buildOptions(s3, 1, 39);
  if (opts.length !== 1 || opts[0].houses !== E.HOTEL || opts[0].cost !== hc * RULES.hotelCostMult) throw new Error('option hôtel attendue: ' + JSON.stringify(opts));
  if (!E.apply(s3, 1, { type: 'build', houses: E.HOTEL }, rng, 0).ok) throw new Error('hôtel refusé');
  if (E.canBuyout(s3, 0, 39)) throw new Error('un hôtel ne doit pas être rachetable');
  if (E.computeRent(s3, 39, 7) !== CFG.BOARD[39].rents[E.HOTEL]) throw new Error('loyer hôtel attendu');
  // Revente de l'hôtel = coût hôtel / 2
  s3.current = 1; s3.turn = { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, lastPay: null };
  const before = s3.players[1].cash;
  if (!E.apply(s3, 1, { type: 'sell', tile: 39 }, rng, 0).ok) throw new Error('revente refusée');
  if (s3.players[1].cash - before !== hc * RULES.hotelCostMult * RULES.sellRatio || s3.tiles[39].houses !== 3) throw new Error('revente hôtel incorrecte');

  // Tour du monde : toujours vers l'avant, salaire en passant par la Taverne
  const s4 = E.createGame([{ name: 'A' }, { name: 'B' }], {}, rng, 0);
  s4.players[0].pos = 30; s4.turn.step = 'teleport';
  const c0 = s4.players[0].cash;
  if (!E.apply(s4, 0, { type: 'teleport', tile: 1 }, rng, 0).ok) throw new Error('voyage refusé');
  if (s4.players[0].pos !== 1 || s4.players[0].laps !== 1) throw new Error('voyage : position/tour incorrects');
  if (s4.players[0].cash !== c0 - RULES.worldTourFee + RULES.salary) throw new Error('voyage : salaire attendu');
  const mv = s4.events.find((e) => e.type === 'move');
  if (!mv || mv.teleport || mv.steps !== 11) throw new Error('le voyage doit avancer de 11 cases: ' + JSON.stringify(mv));

  // Échanges
  const s5 = E.createGame([{ name: 'A' }, { name: 'B', isBot: true }], {}, rng, 0);
  s5.tiles[1].owner = 0; s5.tiles[3].owner = 1;
  if (E.apply(s5, 0, { type: 'tradeOffer', to: 1, give: { tiles: [1], cash: 0 }, get: { tiles: [3], cash: 0 } }, rng, 0).ok !== true) throw new Error('proposition refusée');
  if (E.apply(s5, 0, { type: 'roll' }, rng, 0).ok) throw new Error('on ne doit pas lancer pendant un échange');
  if (E.apply(s5, 0, { type: 'tradeAccept' }, rng, 0).ok) throw new Error('A ne peut pas accepter son propre échange');
  const resp = E.botTradeResponse(s5, 1);
  if (!resp) throw new Error('le bot doit répondre');
  if (!E.apply(s5, 1, { type: 'tradeDecline' }, rng, 0).ok) throw new Error('refus impossible');
  if (s5.trade) throw new Error('échange toujours en cours');
  E.apply(s5, 0, { type: 'tradeOffer', to: 1, give: { tiles: [1], cash: 100000 }, get: { tiles: [3], cash: 0 } }, rng, 0);
  if (!E.apply(s5, 1, { type: 'tradeAccept' }, rng, 0).ok) throw new Error('acceptation impossible');
  if (s5.tiles[1].owner !== 1 || s5.tiles[3].owner !== 0 || s5.players[0].cash !== 1900000 || s5.players[1].cash !== 2100000) throw new Error('échange mal appliqué');
  // Échange cadeau gratuit évalué par le bot : accepté
  E.apply(s5, 0, { type: 'tradeOffer', to: 1, give: { tiles: [], cash: 50000 }, get: { tiles: [], cash: 0 } }, rng, 0);
  if (E.botTradeResponse(s5, 1).type !== 'tradeAccept') throw new Error('le bot devrait accepter un cadeau');
  console.log('Tests unitaires OK');
})();
