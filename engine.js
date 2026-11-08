// Moteur de règles, sans DOM. Tourne dans le navigateur (window.TT_ENGINE) et dans Node (sim.js).
(function (global) {
  'use strict';

  const CFG = global.TT_CONFIG || (typeof require !== 'undefined' ? require('./config.js') : null);
  const { RULES, GROUPS, BOARD, CARDS, PLAYER_COLORS } = CFG;
  const N = BOARD.length;
  const JAIL_TILE = BOARD.findIndex((tile) => tile.type === 'jail');
  // Lus à chaque usage : les noms de cases peuvent être remplacés par content.json après le chargement du moteur.
  const jailName = () => BOARD[JAIL_TILE].name;
  const shadowGiftName = () => BOARD.find((tile) => tile.type === 'championship').name;
  const portalName = () => BOARD.find((tile) => tile.type === 'worldtour').name;
  const OWNABLE = new Set(['property', 'station']);
  const WINNING_LINES = [[1, 7], [9, 15], [17, 23], [25, 31]];

  const isOwnable = (i) => OWNABLE.has(BOARD[i].type);

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function drawFestivalTiles(rng) {
    const families = new Map();
    BOARD.forEach((tile, i) => {
      if (!OWNABLE.has(tile.type)) return;
      const family = tile.type === 'property' ? tile.group : 'station';
      if (!families.has(family)) families.set(family, []);
      families.get(family).push(i);
    });
    return shuffle(Array.from(families.values()), rng)
      .slice(0, 3)
      .map((tiles) => tiles[Math.floor(rng() * tiles.length)]);
  }

  function newTurn() {
    return { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, rolledThisTurn: false, lastPay: null, buyoutPrice: null };
  }

  function createGame(playerDefs, opts, rng, now) {
    rng = rng || Math.random;
    now = now == null ? Date.now() : now;
    opts = opts || {};
    const durationMs = (opts.durationMin || RULES.defaultDurationMin) * 60 * 1000;
    const players = playerDefs.slice(0, RULES.maxPlayers).map((p, i) => ({
      name: p.name || `Joueur ${i + 1}`,
      token: p.token || '🐟',
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      isBot: !!p.isBot,
      peerId: p.peerId || null,
      connected: p.isBot ? true : (p.connected !== false),
      inventory: [], insurance: 0, buildDiscount: 0, rerollReady: false, movementAdjust: 0,
      cash: RULES.startCash,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      worldTourPending: false,
      laps: 0,
      bankrupt: false,
    }));
    const state = {
      phase: 'playing',
      players,
      tiles: BOARD.map((t) => (OWNABLE.has(t.type) ? { owner: null, houses: 0 } : null)),
      festivalTiles: drawFestivalTiles(rng),
      current: 0,
      turn: { ...newTurn(), step: 'order' },
      ordering: { pending: players.map((_, i) => i), rolls: players.map(() => null), round: 1 },
      turnOrder: players.map((_, i) => i),
      championship: null,
      deck: shuffle(CARDS.map((_, i) => i), rng),
      deckPos: 0,
      log: [],
      events: [],
      startedAt: null,
      durationMs,
      endsAt: null,
      turnEndsAt: null,
      auction: null,
      remainingMs: durationMs,
      ranking: null,
      turnCount: 0,
    };
    state.powers = opts.powers ? { rareSeen: [] } : null;
    state.anomaly = null;
    if (opts.anomaly && opts.anomaly !== 'none') {
      const ids = Object.keys(CFG.ANOMALIES);
      const id = opts.anomaly === 'random' ? ids[Math.floor(rng() * ids.length)] : opts.anomaly;
      if (!CFG.ANOMALIES[id]) throw new Error('Anomalie inconnue.');
      state.anomaly = { id, randomState: Math.floor(rng() * 4294967296) || 1, cursedTiles: [] };
      if (id === 'cursed') state.anomaly.cursedTiles = shuffle(BOARD.map((b, i) => b.type === 'property' ? i : -1).filter(i => i >= 0), rng).slice(0, 3);
      log(state, 'Anomalie — ' + CFG.ANOMALIES[id].name + ' : ' + CFG.ANOMALIES[id].description, 'info');
    }
    log(state, 'Chaque joueur lance les dés pour déterminer l’ordre de passage.');
    log(state, `Festival de Sombrelune : ${state.festivalTiles.map((i) => BOARD[i].name).join(', ')} ont leur loyer doublé jusqu’à la fin de la partie.`, 'ok');
    if (state.powers) log(state, 'Bonus de la Taverne : à chaque passage, choisissez le salaire ou un pouvoir. Deux pouvoirs en réserve, un utilisé par tour ; légendaires uniques dès leur apparition.');
    return state;
  }

  function log(state, text, kind) {
    state.log.push({ t: text, k: kind || 'info', n: state.turnCount });
    if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
  }
  const ev = (state, e) => state.events.push(e);
  const fmt = (n) => n.toLocaleString('fr-FR');

  // Valeurs
  function ownsGroup(state, pIdx, group) {
    for (let i = 0; i < N; i++) {
      if (BOARD[i].type === 'property' && BOARD[i].group === group && state.tiles[i].owner !== pIdx) return false;
    }
    return true;
  }
  function countOwned(state, pIdx, type) {
    let c = 0;
    for (let i = 0; i < N; i++) if (BOARD[i].type === type && state.tiles[i].owner === pIdx) c++;
    return c;
  }
  function houseCost(i) {
    return GROUPS[BOARD[i].group].houseCost;
  }
  const HOTEL = RULES.maxHouses + 1; // niveau serviteur doré
  // Le serviteur doré remplace le niveau de taverne suivant et coûte davantage.
  function stepCost(i, h) { return h === HOTEL ? houseCost(i) * RULES.hotelCostMult : houseCost(i); }
  // Coût cumulé des niveaux de taverne et du serviteur doré.
  function levelCost(i, fromH, toH) { let c = 0; for (let h = fromH + 1; h <= toH; h++) c += stepCost(i, h); return c; }
  function tileValue(state, i) {
    const t = state.tiles[i];
    if (!t || t.owner === null) return 0;
    let v = landPrice(state, i);
    if (BOARD[i].type === 'property') v += levelCost(i, 0, t.houses);
    return v;
  }
  function landPrice(state, i) {
    return Math.round(BOARD[i].price * (state.anomaly && state.anomaly.cursedTiles.includes(i) ? 0.75 : 1));
  }
  function buyoutPrice(state, i) { return tileValue(state, i) * RULES.buyoutMult; }
  function canBuyout(state, pIdx, i) {
    const b = BOARD[i]; const t = state.tiles[i];
    return !!t && b.type === 'property' && t.owner !== null && t.owner !== pIdx && t.houses < HOTEL && !state.players[t.owner].bankrupt && state.players[pIdx].cash >= buyoutPrice(state, i);
  }
  // Un achat commence à la Taverne 1 : une case nue n'est pas un niveau de jeu.
  function buyOptions(state, pIdx, i) {
    const b = BOARD[i]; const p = state.players[pIdx];
    if (b.type !== 'property') return [{ houses: 0, cost: b.price, locked: false, affordable: p.cash >= b.price }];
    const out = [];
    for (let h = 1; h <= RULES.maxHouses; h++) {
      const cost = landPrice(state, i) + levelCost(i, 0, h);
      const locked = h >= RULES.lockedHousesBeforeLap && p.laps < 1;
      out.push({ houses: h, cost, locked, affordable: p.cash >= cost });
    }
    return out;
  }
  // Options de construction sur sa propre case.
  function buildOptions(state, pIdx, i) {
    const b = BOARD[i]; const t = state.tiles[i]; const p = state.players[pIdx];
    if (b.type !== 'property' || t.owner !== pIdx || t.houses >= HOTEL) return [];
    const out = [];
    if (t.houses >= RULES.maxHouses) {
      const cost = Math.max(0, stepCost(i, HOTEL) - (state.powers ? p.buildDiscount : 0));
      return [{ houses: HOTEL, cost, locked: false, affordable: p.cash >= cost }];
    }
    for (let h = t.houses + 1; h <= RULES.maxHouses; h++) {
      const cost = Math.max(0, levelCost(i, t.houses, h) - (state.powers ? p.buildDiscount : 0));
      out.push({ houses: h, cost, locked: h >= RULES.lockedHousesBeforeLap && p.laps < 1, affordable: p.cash >= cost });
    }
    return out;
  }
  function netWorth(state, pIdx) {
    const p = state.players[pIdx];
    if (p.bankrupt) return 0;
    let v = p.cash;
    for (let i = 0; i < N; i++) if (state.tiles[i] && state.tiles[i].owner === pIdx) v += tileValue(state, i);
    return v;
  }
  function liquidationValue(state, pIdx) {
    let v = 0;
    for (let i = 0; i < N; i++) if (state.tiles[i] && state.tiles[i].owner === pIdx) v += Math.floor(tileValue(state, i) * RULES.sellRatio);
    return v;
  }
  function sellValue(state, i) {
    return Math.floor(tileValue(state, i) * RULES.sellRatio);
  }
  function computeRent(state, i, diceSum) {
    const b = BOARD[i];
    const t = state.tiles[i];
    const owner = t.owner;
    let rent = 0;
    if (b.type === 'property') {
      rent = b.rents[t.houses];
      if (ownsGroup(state, owner, b.group)) rent *= 2;
      if (state.championship && state.championship.tile === i) rent *= state.championship.mult;
    } else if (b.type === 'station') {
      rent = RULES.stationRents[countOwned(state, owner, 'station') - 1];
    }
    if (state.festivalTiles && state.festivalTiles.includes(i)) rent *= 2;
    if (state.anomaly && state.anomaly.cursedTiles.includes(i)) rent *= 2;
    return rent;
  }
  function canBuild(state, pIdx, i) {
    return buildOptions(state, pIdx, i).some((o) => o.affordable && !o.locked);
  }
  function teleportTargets(state, pIdx) {
    const out = [];
    for (let i = 0; i < N; i++) {
      if (!isOwnable(i)) continue;
      const o = state.tiles[i].owner;
      if (o === null || o === pIdx) out.push(i);
    }
    return out;
  }
  function championshipTargets(state, pIdx) {
    const out = [];
    for (let i = 0; i < N; i++) if (BOARD[i].type === 'property' && state.tiles[i].owner === pIdx) out.push(i);
    return out;
  }
  function alive(state) {
    return state.players.map((p, i) => (p.bankrupt ? -1 : i)).filter((i) => i >= 0);
  }

  // Argent
  // Retourne true si payé, false si le joueur passe en dette.
  function pay(state, pIdx, amount, toIdx, reason) {
    const p = state.players[pIdx];
    if (amount <= 0) return true;
    if (p.cash >= amount) {
      p.cash -= amount;
      if (toIdx !== null && toIdx !== undefined && toIdx !== 'split') state.players[toIdx].cash += amount;
      if (toIdx === 'split') {
        const others = alive(state).filter((i) => i !== pIdx);
        others.forEach((i) => (state.players[i].cash += Math.floor(amount / others.length)));
      }
      ev(state, { type: 'pay', from: pIdx, to: toIdx, amount, reason: reason || '' });
      state.turn.lastPay = { from: pIdx, to: toIdx === undefined ? null : toIdx, amount, reason: reason || '', tile: p.pos };
      return true;
    }
    state.turn.debt = { amount, to: toIdx === undefined ? null : toIdx, reason: reason || '' };
    state.turn.step = 'debt';
    log(state, `${p.name} doit ${fmt(amount)} mais n’a que ${fmt(p.cash)} : il faut vendre !`, 'warn');
    return false;
  }
  function settleDebt(state, pIdx) {
    const d = state.turn.debt;
    const p = state.players[pIdx];
    if (!d || p.cash < d.amount) return false;
    state.turn.debt = null;
    pay(state, pIdx, d.amount, d.to, d.reason);
    log(state, `${p.name} règle sa dette de ${fmt(d.amount)}.`, 'ok');
    finishStep(state);
    return true;
  }

  // Déplacements
  function sendToJail(state, pIdx) {
    const p = state.players[pIdx];
    ev(state, { type: 'move', player: pIdx, from: p.pos, to: JAIL_TILE, teleport: true });
    p.pos = JAIL_TILE;
    p.inJail = true;
    p.jailTurns = 0;
    state.turn.isDouble = false; // pas de relance
    ev(state, { type: 'jail', player: pIdx });
    log(state, `${p.name} échoue à ${jailName()} !`, 'warn');
    state.turn.step = 'done';
  }

  function moveTo(state, pIdx, to, opts, rng) {
    opts = opts || {};
    const p = state.players[pIdx];
    const from = p.pos;
    if (opts.teleport) {
      ev(state, { type: 'move', player: pIdx, from, to, teleport: true });
    } else {
      const forward = opts.backward ? -1 : 1;
      let steps = forward > 0 ? (to - from + N) % N : (from - to + N) % N;
      if (steps === 0) steps = N;
      if (!opts.backward && to <= from) {
        const salary = RULES.salary * (to === 0 ? 2 : 1);
        p.laps++;
        if (state.powers) {
          if (!state.turn.tavernRewardUsed) {
            state.turn.tavernRewardUsed = true;
            state.turn.tavernChoice = { salary, extra: to === 0 ? RULES.salary : 0, offers: offerPowers(state, rng || Math.random), diceSum: opts.diceSum };
          }
        } else {
          p.cash += salary;
          const startStep = (N - from) % N || N;
          ev(state, { type: 'salary', player: pIdx, amount: salary, atStep: startStep });
          log(state, to === 0
            ? `${p.name} tombe sur la Taverne et reçoit ${fmt(salary)} (gain doublé).`
            : `${p.name} passe par la Taverne et reçoit ${fmt(salary)}.`, 'ok');
        }
      }
      ev(state, { type: 'move', player: pIdx, from, to, steps, backward: !!opts.backward });
    }
    p.pos = to;
    if (state.turn.tavernChoice) {
      state.turn.step = 'tavernChoice';
      log(state, p.name + ' choisit sa récompense de Taverne.');
      return;
    }
    landOn(state, pIdx, opts.diceSum, rng);
  }

  function landOn(state, pIdx, diceSum, rng) {
    const p = state.players[pIdx];
    const i = p.pos;
    const b = BOARD[i];
    const t = state.tiles[i];
    switch (b.type) {
      case 'property':
      case 'station':
      {
        if (t.owner === null) {
          if (state.turn.expired) {
            log(state, `${p.name} arrive sur ${b.name} mais son temps est écoulé : il ne peut pas l’acheter.`, 'warn');
            finishStep(state);
          } else if (p.cash >= landPrice(state, i)) {
            state.turn.step = 'buy';
            state.turn.offer = i;
            log(state, `${p.name} arrive sur ${b.name} (libre, ${fmt(landPrice(state, i))}).`);
          } else {
            log(state, `${p.name} arrive sur ${b.name} mais n’a pas de quoi l’acheter.`);
            finishStep(state);
          }
        } else if (t.owner === pIdx) {
          if (!state.turn.expired && canBuild(state, pIdx, i)) {
            state.turn.step = 'build';
            state.turn.offer = i;
            log(state, `${p.name} est chez lui sur ${b.name} : construire ?`);
          } else {
            log(state, `${p.name} se repose sur ${b.name}.`);
            finishStep(state);
          }
        } else {
          const owner = state.players[t.owner];
          if (owner.bankrupt) { finishStep(state); break; }
          let rent = computeRent(state, i, diceSum);
          if (state.powers && p.insurance > 0) {
            const covered = Math.min(rent, p.insurance);
            owner.cash += covered;
            rent -= covered;
            p.insurance = 0;
            log(state, 'La banque couvre ' + fmt(covered) + ' du loyer de ' + p.name + '.', 'ok');
          }
          log(state, `${p.name} tombe chez ${owner.name} (${b.name}) : loyer ${fmt(rent)}.`, 'rent');
          if (pay(state, pIdx, rent, t.owner, `Loyer ${b.name}`)) {
            if (!state.turn.expired && canBuyout(state, pIdx, i)) {
              state.turn.step = 'buyout';
              state.turn.offer = i;
              state.turn.buyoutPrice = buyoutPrice(state, i);
              log(state, `${p.name} peut racheter ${b.name} à ${owner.name} pour ${fmt(state.turn.buyoutPrice)}.`);
            } else finishStep(state);
          }
        }
        break;
      }
      case 'tax':
        log(state, `${p.name} paie ${b.name} : ${fmt(b.amount)}.`, 'warn');
        if (pay(state, pIdx, b.amount, null, b.name)) finishStep(state);
        break;
      case 'chance':
        drawCard(state, pIdx, rng);
        break;
      case 'jail':
        sendToJail(state, pIdx);
        break;
      case 'championship':
        if (!state.turn.expired && championshipTargets(state, pIdx).length && p.cash >= RULES.championshipFee) {
          state.turn.step = 'championship';
          log(state, `${p.name} peut utiliser le ${shadowGiftName()} (${fmt(RULES.championshipFee)}).`);
        } else {
          log(state, `${p.name} découvre le ${shadowGiftName()}.`);
          finishStep(state);
        }
        break;
      case 'worldtour':
        p.worldTourPending = true;
        log(state, `${p.name} active le ${portalName()} pour son prochain tour.`);
        finishStep(state);
        break;
      default:
        log(state, `${p.name} fait halte à la Taverne.`);
        finishStep(state);
    }
  }

  function drawCard(state, pIdx, rng) {
    rng = rng || Math.random;
    const p = state.players[pIdx];
    if (state.deckPos >= state.deck.length) {
      state.deck = shuffle(state.deck, rng);
      state.deckPos = 0;
    }
    const card = CARDS[state.deck[state.deckPos++]];
    ev(state, { type: 'card', player: pIdx, text: card.text });
    log(state, `Chance pour ${p.name} : « ${card.text} »`, 'card');
    switch (card.kind) {
      case 'money':
        if (card.amount >= 0) { p.cash += card.amount; finishStep(state); }
        else if (pay(state, pIdx, -card.amount, null, 'Carte Chance')) finishStep(state);
        break;
      case 'moveTo':
        moveTo(state, pIdx, card.tile, {}, rng);
        break;
      case 'moveBack':
        moveTo(state, pIdx, (p.pos - card.steps + N) % N, { backward: true }, rng);
        break;
      case 'jail':
        sendToJail(state, pIdx);
        break;
      case 'jailCard':
        p.jailCards++;
        finishStep(state);
        break;
      case 'nearestStation': {
        let to = p.pos;
        for (let k = 1; k <= N; k++) {
          const j = (p.pos + k) % N;
          if (BOARD[j].type === 'station') { to = j; break; }
        }
        moveTo(state, pIdx, to, {}, rng);
        break;
      }
      case 'perHouse': {
        let total = 0;
        for (let i = 0; i < N; i++) {
          const t = state.tiles[i];
          if (t && t.owner === pIdx && BOARD[i].type === 'property') total += t.houses === HOTEL ? card.hotel : t.houses * card.house;
        }
        if (total === 0 || pay(state, pIdx, total, null, 'Réparations')) finishStep(state);
        break;
      }
      case 'collectEach': {
        alive(state).forEach((i) => {
          if (i === pIdx) return;
          const give = Math.min(card.amount, state.players[i].cash);
          state.players[i].cash -= give;
          p.cash += give;
        });
        finishStep(state);
        break;
      }
      case 'payEach': {
        const others = alive(state).filter((i) => i !== pIdx).length;
        if (others === 0 || pay(state, pIdx, card.amount * others, 'split', 'Tournée générale')) finishStep(state);
        break;
      }
      default:
        finishStep(state);
    }
  }

  // Fin d’une résolution : relance si double, sinon fin de tour disponible.
  function finishStep(state) {
    const t = state.turn;
    const p = state.players[state.current];
    t.offer = null; t.buyoutPrice = null;
    if (t.isDouble && !p.inJail && t.doubles < 3 && !t.expired) {
      t.step = 'roll';
      t.isDouble = false;
      log(state, `Double ! ${p.name} rejoue.`, 'ok');
    } else {
      if (t.isDouble && t.expired && !p.inJail) log(state, `Double, mais le temps de ${p.name} est écoulé : le joueur suivant joue à sa place.`, 'warn');
      t.step = 'done';
    }
  }

  function offerPowers(state, rng) {
    const commons = Object.keys(CFG.POWERS).filter(id => !CFG.POWERS[id].rare);
    const first = commons[Math.floor(rng() * commons.length)];
    const rares = Object.keys(CFG.POWERS).filter(id => CFG.POWERS[id].rare && !state.powers.rareSeen.includes(id));
    if (rares.length && rng() < CFG.POWER_RULES.legendaryChance) {
      const rare = rares[Math.floor(rng() * rares.length)];
      state.powers.rareSeen.push(rare); // Retiré dès l’offre, même si elle est refusée.
      log(state, CFG.POWERS[rare].name + " apparaît : cet exemplaire légendaire ne sera plus proposé de la partie.", "warn");
      return [first, rare];
    }
    const rest = commons.filter(id => id !== first);
    return [first, rest[Math.floor(rng() * rest.length)]];
  }

  function powerTargets(state, pIdx, id) {
    return state.tiles.map((tile, i) => {
      if (!tile || BOARD[i].type !== 'property') return -1;
      if (id === 'annihilation' && tile.owner !== null && tile.owner !== pIdx && !state.players[tile.owner].bankrupt) return i;
      if (id === 'goldenGift' && tile.owner === pIdx && tile.houses < HOTEL) return i;
      return -1;
    }).filter(i => i >= 0);
  }

  function previewOrResolve(state, pIdx, dice, rng) {
    if (state.powers && state.players[pIdx].rerollReady) {
      state.turn.pendingDice = dice;
      state.turn.step = 'rerollChoice';
      return;
    }
    resolveDice(state, pIdx, dice, rng);
  }

  function resolveDice(state, pIdx, d, rng) {
    const t = state.turn, p = state.players[pIdx];
    t.dice = d;
    t.rolledThisTurn = true;
    t.isDouble = d[0] === d[1];
    if (t.isDouble) t.doubles++;
    ev(state, { type: 'dice', player: pIdx, dice: d });
    log(state, p.name + ' lance ' + d.join(' + ') + (t.isDouble ? ' (double).' : '.'));
    if (t.doubles >= 3) { sendToJail(state, pIdx); return; }
    const steps = d[0] + d[1] + (state.powers ? p.movementAdjust : 0);
    p.movementAdjust = 0;
    moveTo(state, pIdx, (p.pos + steps) % N, { diceSum: d[0] + d[1] }, rng);
  }

  function rollDice(rng) {
    return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
  }

  // Fin de partie
  function endGame(state, reason, winnerIdx, winReason) {
    state.phase = 'ended';
    state.remainingMs = 0;
    const ranking = state.players
      .map((p, i) => ({ idx: i, name: p.name, token: p.token, color: p.color, worth: netWorth(state, i), cash: p.cash, bankrupt: p.bankrupt, props: state.tiles.filter((t) => t && t.owner === i).length }))
      .sort((a, b) => (a.idx === winnerIdx ? -1 : b.idx === winnerIdx ? 1 : a.bankrupt !== b.bankrupt ? (a.bankrupt ? 1 : -1) : b.worth - a.worth));
    state.ranking = ranking;
    state.endReason = reason;
    state.winnerIdx = winnerIdx == null ? ranking[0].idx : winnerIdx;
    state.winReason = winReason || null;
    const winner = state.players[state.winnerIdx];
    log(state, `Fin de partie : ${winner.name} l’emporte${winReason ? ` (${winReason})` : ` avec ${fmt(ranking[0].worth)}`} !`, 'ok');
    ev(state, { type: 'gameover', winner: state.winnerIdx, reason: winReason || reason });
  }

  function victoryReason(state, pIdx) {
    if (state.players[pIdx].bankrupt) return null;
    if (countOwned(state, pIdx, 'station') === BOARD.filter((tile) => tile.type === 'station').length) return 'les quatre cartes neutres';
    if (WINNING_LINES.some(([from, to]) => {
      const line = [];
      for (let i = from; i <= to; i++) if (isOwnable(i)) line.push(i);
      return line.length > 0 && line.every((i) => state.tiles[i].owner === pIdx);
    })) return 'toutes les cases achetables d’une ligne';
    if (Object.keys(GROUPS).filter((group) => ownsGroup(state, pIdx, group)).length >= 3) return 'trois monopoles';
    return null;
  }

  function checkVictory(state, pIdx) {
    const reason = victoryReason(state, pIdx);
    if (!reason) return false;
    endGame(state, 'victory', pIdx, reason);
    return true;
  }

  function nextTurn(state, now) {
    now = now == null ? Date.now() : now;
    if (state.phase !== 'playing') return;
    if (now >= state.endsAt) { endGame(state, 'time'); return; }
    const a = alive(state);
    if (a.length <= 1) { endGame(state, 'bankrupt'); return; }
    const orderPos = state.turnOrder.indexOf(state.current);
    let orderIndex = orderPos;
    do {
      orderIndex = (orderIndex + 1) % state.turnOrder.length;
    } while (state.players[state.turnOrder[orderIndex]].bankrupt);
    const i = state.turnOrder[orderIndex];
    if (orderIndex <= orderPos && state.anomaly && state.anomaly.id === 'festival') {
      const anomaly = state.anomaly;
      const festivalRng = () => {
        anomaly.randomState = (Math.imul(anomaly.randomState, 1664525) + 1013904223) >>> 0;
        return anomaly.randomState / 4294967296;
      };
      state.festivalTiles = drawFestivalTiles(festivalRng);
      log(state, 'Le Festival se déplace : ' + state.festivalTiles.map(tile => BOARD[tile].name).join(', '), 'ok');
    }
    state.current = i;
    state.turnCount++;
    state.turn = newTurn();
    state.turnEndsAt = now + RULES.turnDurationMs;
    const p = state.players[i];
    log(state, `— Au tour de ${p.name}${p.inJail ? ` (à ${jailName()})` : ''}.`, 'turn');
    if (p.inJail) state.turn.step = 'jail';
    else if (p.worldTourPending) {
      p.worldTourPending = false;
      if (teleportTargets(state, i).length && p.cash >= RULES.worldTourFee) {
        state.turn.step = 'teleport';
        log(state, `${p.name} utilise son tour pour voyager avec le Portail (${fmt(RULES.worldTourFee)}).`);
      } else {
        state.turn.step = 'done';
        log(state, `${p.name} ne peut pas utiliser le Portail : aucun trajet possible ou pas assez d’or.`);
      }
    }
  }

  function auctionBidders(state) {
    return state.auction.order.filter((i) => !state.auction.passed.includes(i) && !state.players[i].bankrupt);
  }
  function beginAuction(state, pIdx, now) {
    const tiles = state.tiles.map((tile, i) => tile && tile.owner === pIdx ? i : -1).filter((i) => i >= 0);
    if (!tiles.length) { nextTurn(state, now); return; }
    const order = [];
    const start = state.turnOrder.indexOf(pIdx);
    for (let offset = 1; offset <= state.turnOrder.length; offset++) {
      const bidder = state.turnOrder[(start + offset) % state.turnOrder.length];
      if (!state.players[bidder].bankrupt) order.push(bidder);
    }
    if (!order.length) { nextTurn(state, now); return; }
    state.auction = { owner: pIdx, tiles, cursor: 0, order, passed: [], highestBid: 0, highestBidder: null, current: order[0], returnTo: pIdx };
    state.current = order[0];
    state.turn = newTurn();
    state.turn.step = 'auction';
    state.turnEndsAt = now + RULES.turnDurationMs;
    log(state, `${state.players[pIdx].name} met ses propriétés aux enchères, niveaux de taverne inclus.`, 'warn');
    logAuctionLot(state);
  }
  function logAuctionLot(state) {
    const a = state.auction;
    const i = a.tiles[a.cursor];
    log(state, `Enchères pour ${BOARD[i].name} (${fmt(tileValue(state, i))} investis), appartenant à ${state.players[a.owner].name}.`);
  }
  function finishAuctionLot(state, now) {
    const a = state.auction;
    const i = a.tiles[a.cursor];
    const owner = state.players[a.owner];
    if (a.highestBidder !== null) {
      const winner = state.players[a.highestBidder];
      const recovery = Math.floor(a.highestBid / 2);
      winner.cash -= a.highestBid;
      owner.cash += recovery;
      state.tiles[i].owner = a.highestBidder;
      log(state, `${winner.name} remporte ${BOARD[i].name} avec ses niveaux pour ${fmt(a.highestBid)}. ${owner.name} récupère ${fmt(recovery)} (50 %).`, 'ok');
      ev(state, { type: 'auctionWin', player: a.highestBidder, tile: i, amount: a.highestBid, recovery });
    } else {
      state.tiles[i].owner = null;
      state.tiles[i].houses = 0;
      if (state.championship && state.championship.tile === i) state.championship = null;
      log(state, `Aucune enchère pour ${BOARD[i].name} : la propriété retourne à la banque.`);
      ev(state, { type: 'auctionUnsold', tile: i });
    }
    a.cursor++;
    if (a.cursor < a.tiles.length) {
      a.passed = [];
      a.highestBid = 0;
      a.highestBidder = null;
      a.current = a.order[0];
      state.current = a.current;
      state.turn = newTurn();
      state.turn.step = 'auction';
      state.turnEndsAt = now + RULES.turnDurationMs;
      logAuctionLot(state);
      return;
    }
    const returnTo = a.returnTo;
    state.auction = null;
    state.current = returnTo;
    state.turn = newTurn();
    for (let i = 0; i < state.players.length; i++) if (checkVictory(state, i)) return;
    nextTurn(state, now);
  }
  function advanceAuction(state, now) {
    const a = state.auction;
    const bidders = auctionBidders(state);
    if (!bidders.length || (bidders.length === 1 && bidders[0] === a.highestBidder)) {
      finishAuctionLot(state, now);
      return;
    }
    const at = a.order.indexOf(a.current);
    for (let offset = 1; offset <= a.order.length; offset++) {
      const bidder = a.order[(at + offset) % a.order.length];
      if (bidders.includes(bidder)) {
        a.current = bidder;
        state.current = bidder;
        state.turn = newTurn();
        state.turn.step = 'auction';
        state.turnEndsAt = now + RULES.turnDurationMs;
        log(state, `Au tour de ${state.players[bidder].name} d’enchérir ou de passer.`);
        return;
      }
    }
  }
  function auctionAction(state, pIdx, action, now) {
    const a = state.auction;
    if (!a || state.turn.step !== 'auction' || pIdx !== a.current) return ERR('Ce n’est pas à vous d’enchérir.');
    if (action.type === 'auctionPass') {
      a.passed.push(pIdx);
      log(state, `${state.players[pIdx].name} passe son tour d’enchères.`);
    } else {
      const amount = action.amount;
      const minimum = a.highestBidder === null ? RULES.auctionMinBid : a.highestBid + RULES.auctionMinBid;
      if (!Number.isSafeInteger(amount) || amount < minimum) return ERR(`L’enchère minimale est de ${fmt(minimum)}.`);
      if (amount > state.players[pIdx].cash) return ERR('Vous n’avez pas assez d’or pour cette enchère.');
      a.highestBid = amount;
      a.highestBidder = pIdx;
      log(state, `${state.players[pIdx].name} propose ${fmt(amount)} pour ${BOARD[a.tiles[a.cursor]].name}.`, 'rent');
    }
    advanceAuction(state, now);
    return OK;
  }
  function bankrupt(state, pIdx, now) {
    const p = state.players[pIdx];
    const d = state.turn.debt;
    const to = d && typeof d.to === 'number' ? d.to : null;
    // Le solde va au créancier ; les propriétés seront vendues aux enchères.
    if (to !== null) state.players[to].cash += p.cash;
    p.cash = 0;
    p.bankrupt = true;
    p.inJail = false;
    state.turn.debt = null;
    ev(state, { type: 'bankrupt', player: pIdx });
    log(state, `${p.name} fait faillite${to !== null ? ` au profit de ${state.players[to].name}` : ''} !`, 'warn');
    beginAuction(state, pIdx, now == null ? Date.now() : now);
  }

  // Actions
  const ERR = (m) => ({ ok: false, error: m });
  const OK = { ok: true };

  // Transitions réservées à la session hôte, jamais aux actions des joueurs.
  function changeController(state, pIdx, command) {
    const p = Number.isInteger(pIdx) && state.players[pIdx];
    if (!p || !command) return ERR('Joueur introuvable.');
    if (command.type === 'disconnect') {
      if (p.isBot) return { ok: true, changed: false };
      p.isBot = true;
      p.connected = false;
      state.events = [];
      log(state, `${p.name} s’est déconnecté : un bot prend le relais.`, 'warn');
      return { ok: true, changed: true };
    }
    const peerId = command.peerId;
    if (typeof peerId !== 'string' || !peerId) return ERR('Connexion invalide.');
    if (command.type === 'reconnect') {
      if (p.peerId !== peerId) return ERR('Cette place appartient à une autre connexion.');
      const wasBot = p.isBot;
      p.isBot = false;
      p.connected = true;
      state.events = [];
      if (wasBot) log(state, `${p.name} est de retour dans la partie.`);
      return { ok: true, changed: true };
    }
    if (command.type === 'claim') {
      if (state.phase !== 'playing' || !p.isBot || p.bankrupt) return ERR('Ce bot ne peut plus être remplacé.');
      if (state.players.some((player, i) => i !== pIdx && player.peerId === peerId)) return ERR('Cette connexion contrôle déjà un joueur.');
      p.isBot = false;
      p.connected = true;
      p.peerId = peerId;
      state.events = [];
      log(state, `${p.name} rejoint la partie et remplace un bot.`);
      return { ok: true, changed: true };
    }
    return ERR('Changement de contrôleur inconnu.');
  }

  // Le rendu lit une horloge dérivée ; seul l’hôte rafraîchit l’état publié.
  function readClock(state, now) {
    now = now == null ? Date.now() : now;
    return {
      remainingMs: state.ordering ? state.durationMs : Math.max(0, state.endsAt - now),
      turnRemainingMs: state.ordering ? RULES.turnDurationMs : Math.max(0, state.turnEndsAt - now),
      at: now,
    };
  }

  function refreshClock(state, now) {
    state.remainingMs = readClock(state, now).remainingMs;
  }

  function apply(state, pIdx, action, rng, now) {
    rng = rng || Math.random;
    now = now == null ? Date.now() : now;
    if (!Number.isInteger(pIdx) || !state.players[pIdx]) return ERR('Joueur introuvable.');
    if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') return ERR('Action invalide.');
    state.events = [];
    if (state.phase !== 'playing') return ERR('La partie est terminée.');
    if (!state.ordering && state.endsAt != null && now >= state.endsAt) {
      state.events = [];
      endGame(state, 'time');
      return OK;
    }
    const p = state.players[pIdx];
    const t = state.turn;
    if (p.bankrupt) return ERR('Joueur en faillite.');
    if (pIdx !== state.current) return ERR('Ce n’est pas votre tour.');
    if (state.auction) return auctionAction(state, pIdx, action, now);

    if (state.ordering) {
      if (action.type !== 'orderRoll' || t.step !== 'order') return ERR('Lancez les dés pour déterminer l’ordre de passage.');
      const d = rollDice(rng);
      state.ordering.rolls[pIdx] = { dice: d, total: d[0] + d[1] };
      ev(state, { type: 'dice', player: pIdx, dice: d });
      log(state, `${p.name} lance ${d[0]} + ${d[1]} : ${d[0] + d[1]} au total.`);

      state.ordering.pending.shift();
      if (state.ordering.pending.length) {
        state.current = state.ordering.pending[0];
        return OK;
      }

      const tiedPlayers = [];
      const scoreGroups = new Map();
      state.ordering.rolls.forEach((roll, i) => {
        const group = scoreGroups.get(roll.total) || [];
        group.push(i);
        scoreGroups.set(roll.total, group);
      });
      for (const group of scoreGroups.values()) if (group.length > 1) tiedPlayers.push(...group);
      if (tiedPlayers.length) {
        state.ordering.round++;
        state.ordering.pending = tiedPlayers.sort((a, b) => a - b);
        state.current = state.ordering.pending[0];
        log(state, `Égalité : ${state.ordering.pending.map((i) => state.players[i].name).join(', ')}. Ces joueurs relancent les dés.`);
        return OK;
      }

      state.turnOrder = state.ordering.rolls
        .map((roll, i) => ({ i, total: roll.total }))
        .sort((a, b) => b.total - a.total)
        .map(({ i }) => i);
      state.current = state.turnOrder[0];
      state.ordering = null;
      state.turn = newTurn();
      state.turnCount = 1;
      state.startedAt = now == null ? Date.now() : now;
      state.endsAt = state.startedAt + state.durationMs;
      state.turnEndsAt = state.startedAt + RULES.turnDurationMs;
      state.remainingMs = state.durationMs;
      log(state, `Ordre de passage : ${state.turnOrder.map((i) => state.players[i].name).join(' → ')}.`);
      log(state, `La partie commence ! ${state.players[state.current].name} ouvre le bal.`);
      return OK;
    }

    switch (action.type) {
      case 'roll': {
        if (t.step !== 'roll') return ERR('Impossible de lancer les dés maintenant.');
        const d = rollDice(rng);
        t.dice = d;
        t.rolledThisTurn = true;
        t.isDouble = d[0] === d[1];
        if (t.isDouble) t.doubles++;
        ev(state, { type: 'dice', player: pIdx, dice: d });
        log(state, `${p.name} lance ${d[0]} + ${d[1]}${t.isDouble ? ' (double)' : ''}.`);
        if (t.doubles >= 3) {
          log(state, `Trois doubles ! ${p.name} est envoyé à ${jailName()}.`, 'warn');
          sendToJail(state, pIdx);
          return OK;
        }
        if (state.anomaly && state.anomaly.id === 'destiny') {
          t.rollChoices = [...d, 1 + Math.floor(rng() * 6)];
          t.step = 'diceChoice';
          log(state, p.name + ' choisit deux dés parmi ' + t.rollChoices.join(', ') + '.');
          return OK;
        }
        previewOrResolve(state, pIdx, d, rng);
        return OK;
      }
      
      case 'chooseDice': {
        const indices = action.indices;
        if (t.step !== 'diceChoice' || !Array.isArray(indices) || indices.length !== 2 || indices[0] === indices[1] || indices.some(i => !Number.isInteger(i) || i < 0 || i > 2)) return ERR('Choisissez deux dés différents.');
        const d = indices.map(i => t.rollChoices[i]);
        t.rollChoices = null;
        previewOrResolve(state, pIdx, d, rng);
        return OK;
      }
      case 'chooseTavern': {
        if (!state.powers || t.step !== 'tavernChoice' || !t.tavernChoice) return ERR('Aucune récompense à choisir.');
        const choice = t.tavernChoice;
        if (action.reward !== 'cash' && (!choice.offers.includes(action.reward) || p.inventory.length >= CFG.POWER_RULES.maxInventory)) return ERR('Bonus indisponible ou réserve pleine.');
        t.tavernChoice = null;
        if (action.reward === 'cash') {
          p.cash += choice.salary;
          log(state, p.name + ' choisit ' + fmt(choice.salary) + ' or.', 'ok');
        } else {
          p.cash += choice.extra;
          p.inventory.push(action.reward);
          log(state, p.name + ' récupère ' + CFG.POWERS[action.reward].name + (CFG.POWERS[action.reward].rare ? ' — LÉGENDAIRE UNIQUE !' : '.') , 'ok');
        }
        landOn(state, pIdx, choice.diceSum, rng);
        return OK;
      }
      case 'usePower': {
        if (!state.powers || t.step !== 'roll' || t.powerUsed) return ERR('Un pouvoir maximum par tour, avant un lancer.');
        const index = action.index;
        if (!Number.isInteger(index) || index < 0 || index >= p.inventory.length) return ERR('Pouvoir introuvable.');
        const id = p.inventory[index];
        const targets = powerTargets(state, pIdx, id);
        if (id === 'annihilation' || id === 'goldenGift') {
          if (!targets.includes(action.tile)) return ERR('Choisissez une propriété valide.');
        }
        if ((id === 'shield' || id === 'rentSkip') && p.insurance > 0) return ERR('Une protection est déjà active.');
        if (id === 'permit' && p.buildDiscount > 0) return ERR('Un permis est déjà actif.');
        if (id === 'reroll' && p.rerollReady) return ERR('Une seconde chance est déjà active.');
        if (id === 'step' && ![-1, 1].includes(action.delta)) return ERR('Choisissez +1 ou −1.');
        if (id === 'shield') p.insurance = 200000;
        if (id === 'rentSkip') p.insurance = Number.MAX_SAFE_INTEGER;
        if (id === 'reroll') p.rerollReady = true;
        if (id === 'permit') p.buildDiscount = 150000;
        if (id === 'step') p.movementAdjust = action.delta;
        if (id === 'annihilation') {
          state.tiles[action.tile].owner = null;
          state.tiles[action.tile].houses = 0;
          if (state.championship && state.championship.tile === action.tile) state.championship = null;
        }
        if (id === 'goldenGift') state.tiles[action.tile].houses = HOTEL;
        p.inventory.splice(index, 1);
        t.powerUsed = true;
        log(state, p.name + ' utilise ' + CFG.POWERS[id].name + (['annihilation', 'goldenGift'].includes(id) ? ' sur ' + BOARD[action.tile].name : '') + '.', 'warn');
        return OK;
      }
      case 'keepDice':
      case 'rerollDice': {
        if (t.step !== 'rerollChoice' || !t.pendingDice) return ERR('Aucun lancer à confirmer.');
        const d = action.type === 'rerollDice' ? rollDice(rng) : t.pendingDice;
        t.pendingDice = null;
        p.rerollReady = false;
        // En Dé du destin, une relance redonne un choix de trois dés.
        if (action.type === 'rerollDice' && state.anomaly && state.anomaly.id === 'destiny') {
          t.rollChoices = [...d, 1 + Math.floor(rng() * 6)];
          t.step = 'diceChoice';
        } else resolveDice(state, pIdx, d, rng);
        return OK;
      }
      case 'jailPay': {
        if (t.step !== 'jail') return ERR(`Vous n’êtes pas à ${jailName()}.`);
        if (p.cash < RULES.jailFee) return ERR('Pas assez d’or.');
        p.cash -= RULES.jailFee;
        p.inJail = false;
        t.step = 'roll';
        log(state, `${p.name} paie ${fmt(RULES.jailFee)} et quitte ${jailName()}.`);
        return OK;
      }
      case 'jailCard': {
        if (t.step !== 'jail') return ERR(`Vous n’êtes pas à ${jailName()}.`);
        if (p.jailCards <= 0) return ERR('Aucune carte de sortie.');
        p.jailCards--;
        p.inJail = false;
        t.step = 'roll';
        log(state, `${p.name} utilise une carte et quitte ${jailName()}.`);
        return OK;
      }
      case 'jailRoll': {
        if (t.step !== 'jail') return ERR(`Vous n’êtes pas à ${jailName()}.`);
        const d = rollDice(rng);
        t.dice = d;
        t.rolledThisTurn = true;
        ev(state, { type: 'dice', player: pIdx, dice: d });
        if (d[0] === d[1]) {
          p.inJail = false;
          t.isDouble = false;
          log(state, `${p.name} fait un double (${d[0]}+${d[1]}) et s’échappe de ${jailName()} !`, 'ok');
          moveTo(state, pIdx, (p.pos + d[0] + d[1]) % N, { diceSum: d[0] + d[1] }, rng);
        } else {
          p.jailTurns++;
          if (p.jailTurns >= RULES.jailMaxTurns) {
            p.inJail = false;
            log(state, `${p.name} lance ${d[0]}+${d[1]} : troisième essai, un bateau le récupère enfin.`);
            moveTo(state, pIdx, (p.pos + d[0] + d[1]) % N, { diceSum: d[0] + d[1] }, rng);
          } else {
            log(state, `${p.name} lance ${d[0]}+${d[1]} : toujours naufragé (${p.jailTurns}/${RULES.jailMaxTurns}).`);
            t.step = 'done';
          }
        }
        return OK;
      }
      case 'buy': {
        if (t.step !== 'buy') return ERR('Rien à acheter.');
        const i = t.offer;
        const b = BOARD[i];
        const h = b.type === 'property' ? (action.houses | 0) : 0;
        const opt = buyOptions(state, pIdx, i).find((o) => o.houses === h);
        if (!opt) return ERR('Niveau invalide.');
        if (opt.locked) return ERR('Ce niveau se débloque après un passage par la Taverne.');
        if (!opt.affordable) return ERR('Pas assez d’or.');
        p.cash -= opt.cost;
        state.tiles[i].owner = pIdx;
        state.tiles[i].houses = h;
        ev(state, { type: 'buy', player: pIdx, tile: i, houses: h });
        log(state, `${p.name} achète ${b.name}${h ? ` au niveau ${h === HOTEL ? 'Serviteur doré' : `Taverne ${h}`}` : ''} pour ${fmt(opt.cost)}.`, 'ok');
        if (b.type === 'property' && ownsGroup(state, pIdx, b.group)) log(state, `${p.name} contrôle tous les ${GROUPS[b.group].label}s : loyers doublés à tous les niveaux !`, 'ok');
        if (checkVictory(state, pIdx)) return OK;
        finishStep(state);
        return OK;
      }
      case 'skipBuy': {
        if (t.step !== 'buy') return ERR('Rien à refuser.');
        log(state, `${p.name} laisse ${BOARD[t.offer].name} libre.`);
        finishStep(state);
        return OK;
      }
      case 'build': {
        if (t.step !== 'build') return ERR('Impossible de construire maintenant.');
        const i = t.offer;
        const target = action.houses == null ? state.tiles[i].houses + 1 : (action.houses | 0);
        const opt = buildOptions(state, pIdx, i).find((o) => o.houses === target);
        if (!opt) return ERR('Niveau invalide.');
        if (opt.locked) return ERR('Ce niveau se débloque après un passage par la Taverne.');
        if (!opt.affordable) return ERR('Pas assez d’or.');
        const before = state.tiles[i].houses;
        p.cash -= opt.cost;
        if (state.powers) p.buildDiscount = 0;
        state.tiles[i].houses = target;
        ev(state, { type: 'build', player: pIdx, tile: i, houses: target });
        log(state, `${p.name} améliore ${BOARD[i].name} : ${target === HOTEL ? 'Serviteur doré' : `Taverne ${target}`} (${fmt(opt.cost)}).`, 'ok');
        finishStep(state);
        return OK;
      }
      case 'buyout': {
        if (t.step !== 'buyout') return ERR('Rien à racheter.');
        const i = t.offer;
        if (!canBuyout(state, pIdx, i)) return ERR('Rachat impossible.');
        const price = buyoutPrice(state, i);
        const prev = state.tiles[i].owner;
        p.cash -= price;
        state.players[prev].cash += price;
        state.tiles[i].owner = pIdx;
        ev(state, { type: 'pay', from: pIdx, to: prev, amount: price, reason: 'Rachat' });
        ev(state, { type: 'buyout', player: pIdx, from: prev, tile: i });
        t.lastPay = { from: pIdx, to: prev, amount: price, reason: `Rachat de ${BOARD[i].name}`, tile: i };
        log(state, `${p.name} rachète ${BOARD[i].name} à ${state.players[prev].name} pour ${fmt(price)} !`, 'ok');
        if (BOARD[i].type === 'property' && ownsGroup(state, pIdx, BOARD[i].group)) log(state, `${p.name} contrôle tous les ${GROUPS[BOARD[i].group].label}s : loyers doublés à tous les niveaux !`, 'ok');
        if (checkVictory(state, pIdx)) return OK;
        finishStep(state);
        return OK;
      }
      case 'skipBuyout': {
        if (t.step !== 'buyout') return ERR('Rien à racheter.');
        finishStep(state);
        return OK;
      }
      case 'skipBuild': {
        if (t.step !== 'build') return ERR('Rien à construire.');
        finishStep(state);
        return OK;
      }
      case 'teleport': {
        if (t.step !== 'teleport') return ERR('Pas de portail ouvert.');
        const i = action.tile;
        if (!teleportTargets(state, pIdx).includes(i)) return ERR('Destination invalide.');
        if (p.cash < RULES.worldTourFee) return ERR('Pas assez d’or.');
        p.cash -= RULES.worldTourFee;
        log(state, `${p.name} paie ${fmt(RULES.worldTourFee)} et voyage vers ${BOARD[i].name}.`);
        moveTo(state, pIdx, i, {}, rng);
        return OK;
      }
      case 'skipTeleport': {
        if (t.step !== 'teleport') return ERR('Pas de portail ouvert.');
        log(state, `${p.name} referme le Portail.`);
        finishStep(state);
        return OK;
      }
      case 'championship': {
        if (t.step !== 'championship') return ERR(`Pas de ${shadowGiftName()} à utiliser.`);
        const i = action.tile;
        if (!championshipTargets(state, pIdx).includes(i)) return ERR('Case invalide.');
        if (p.cash < RULES.championshipFee) return ERR('Pas assez d’or.');
        p.cash -= RULES.championshipFee;
        const prev = state.championship;
        const mult = Math.min(RULES.championshipMaxMult, prev ? prev.mult + 1 : 2);
        state.championship = { tile: i, mult };
        ev(state, { type: 'championship', tile: i, mult });
        log(state, `${p.name} utilise le ${shadowGiftName()} sur ${BOARD[i].name} : loyer x${mult} !`, 'ok');
        finishStep(state);
        return OK;
      }
      case 'skipChampionship': {
        if (t.step !== 'championship') return ERR(`Pas de ${shadowGiftName()} à utiliser.`);
        finishStep(state);
        return OK;
      }
      case 'sell': {
        const i = action.tile;
        if (!isOwnable(i) || state.tiles[i].owner !== pIdx) return ERR('Ce n’est pas à vous.');
        if (!['roll', 'done', 'debt', 'jail', 'buy', 'build', 'buyout'].includes(t.step)) return ERR('Impossible de vendre maintenant.');
        const tile = state.tiles[i];
        const v = sellValue(state, i);
        const levels = BOARD[i].type === 'property' && tile.houses > 0 ? ` avec ${tile.houses === HOTEL ? 'son Serviteur doré' : `sa Taverne ${tile.houses}`}` : '';
        tile.owner = null;
        tile.houses = 0;
        if (state.championship && state.championship.tile === i) state.championship = null;
        log(state, `${p.name} revend ${BOARD[i].name}${levels} à la banque (+${fmt(v)}, 75 % de l’investissement).`);
        p.cash += v;
        ev(state, { type: 'sell', player: pIdx, tile: i, amount: v });
        if (t.step === 'debt') settleDebt(state, pIdx);
        return OK;
      }
      case 'declareBankrupt': {
        if (t.step !== 'debt') return ERR('Vous n’avez pas de dette.');
        if (p.cash + liquidationValue(state, pIdx) >= t.debt.amount) return ERR('Vous pouvez encore vendre pour payer.');
        bankrupt(state, pIdx, now);
        return OK;
      }
      case 'endTurn': {
        if (t.step !== 'done') return ERR('Terminez d’abord votre action.');
        nextTurn(state, now);
        return OK;
      }
      default:
        return ERR('Action inconnue.');
    }
  }

  // Chrono : à appeler régulièrement côté hôte.
  function tick(state, now, rng) {
    rng = rng || Math.random;
    now = now == null ? Date.now() : now;
    if (state.phase !== 'playing' || state.ordering) return false;
    refreshClock(state, now);
    if (now >= state.endsAt) {
      state.events = [];
      endGame(state, 'time');
      return true;
    }
    if (state.turnEndsAt != null && now >= state.turnEndsAt) {
      state.events = [];
      if (!state.auction && (state.turn.step === 'roll' || state.turn.step === 'jail')) {
        // Temps écoulé : les dés sont lancés quand même, mais sans achat ni construction, et sans rejouer sur un double.
        const pIdx = state.current;
        state.turn.expired = true;
        log(state, `Le temps de ${state.players[pIdx].name} est écoulé : les dés sont lancés automatiquement.`, 'warn');
        apply(state, pIdx, { type: state.turn.step === 'jail' ? 'jailRoll' : 'roll' }, rng, now);
        if (state.phase === 'playing' && !state.auction && state.turn.step === 'done') nextTurn(state, now);
      } else if (['diceChoice', 'tavernChoice', 'rerollChoice'].includes(state.turn.step)) {
        apply(state, state.current, state.turn.step === 'tavernChoice' ? { type: 'chooseTavern', reward: 'cash' } : botAction(state, state.current), rng, now);
      } else if (state.auction) {
        log(state, `${state.players[state.current].name} n’a pas enchéri à temps : il passe.`, 'warn');
        auctionAction(state, state.current, { type: 'auctionPass' }, now);
      } else if (state.turn.step === 'debt') {
        const pIdx = state.current;
        const debt = state.turn.debt;
        log(state, `${state.players[pIdx].name} n’a pas réglé sa dette à temps.`, 'warn');
        while (state.phase === 'playing' && state.turn.step === 'debt') {
          if (state.players[pIdx].cash + liquidationValue(state, pIdx) < debt.amount) {
            bankrupt(state, pIdx, now);
            break;
          }
          let tile = -1;
          let value = Infinity;
          state.tiles.forEach((owned, i) => {
            if (owned && owned.owner === pIdx && sellValue(state, i) < value) {
              tile = i;
              value = sellValue(state, i);
            }
          });
          if (tile < 0) { bankrupt(state, pIdx, now); break; }
          apply(state, pIdx, { type: 'sell', tile }, rng, now);
        }
        if (state.phase === 'playing' && !state.auction) nextTurn(state, now);
      } else {
        const pIdx = state.current;
        if (!state.turn.expired) log(state, `${state.players[pIdx].name} n’a pas terminé son tour à temps.`, 'warn');
        nextTurn(state, now);
      }
      return true;
    }
    return false;
  }

  // Bot
  function botAction(state, pIdx) {
    const p = state.players[pIdx];
    const t = state.turn;
    const reserve = 150000;
    if (state.ordering) return { type: 'orderRoll' };
    if (state.auction && state.auction.current === pIdx) {
      const a = state.auction;
      const minimum = a.highestBidder === null ? RULES.auctionMinBid : a.highestBid + RULES.auctionMinBid;
      const limit = Math.floor(tileValue(state, a.tiles[a.cursor]) * 0.75 / RULES.auctionMinBid) * RULES.auctionMinBid;
      if (p.cash >= minimum && limit >= minimum && a.highestBid < limit) {
        // Surenchère par paliers (≈ 15 % de la valeur max) au lieu de +10 000 à chaque tour : les enchères restent courtes.
        const unit = RULES.auctionMinBid;
        const step = Math.max(unit, Math.round(limit * 0.15 / unit) * unit);
        const opening = Math.max(minimum, Math.round(limit * 0.4 / unit) * unit);
        const target = a.highestBidder === null ? opening : a.highestBid + step;
        return { type: 'auctionBid', amount: Math.min(limit, p.cash, Math.max(minimum, target)) };
      }
      return { type: 'auctionPass' };
    }
    if (state.powers && t.step === 'roll' && !t.powerUsed) {
      for (let index = 0; index < p.inventory.length; index++) {
        const id = p.inventory[index];
        if ((id === 'shield' || id === 'rentSkip') && !p.insurance) return { type: 'usePower', index };
        if (id === 'reroll' && !p.rerollReady) return { type: 'usePower', index };
        if (id === 'permit' && !p.buildDiscount) return { type: 'usePower', index };
        if (id === 'step') return { type: 'usePower', index, delta: 1 };
        const targets = powerTargets(state, pIdx, id);
        if (targets.length) return { type: 'usePower', index, tile: targets.sort((a,b) => tileValue(state,b) - tileValue(state,a))[0] };
      }
    }
    switch (t.step) {
      case 'tavernChoice': {
        const rare = t.tavernChoice.offers.find(id => CFG.POWERS[id].rare);
        return { type: 'chooseTavern', reward: p.inventory.length < CFG.POWER_RULES.maxInventory && (rare || p.cash > 500000) ? rare || t.tavernChoice.offers[0] : 'cash' };
      }
      case 'rerollChoice': return { type: t.pendingDice[0] + t.pendingDice[1] < 6 ? 'rerollDice' : 'keepDice' };
      case 'diceChoice': {
        const indices = [0, 1, 2].sort((a, b) => t.rollChoices[b] - t.rollChoices[a]).slice(0, 2);
        return { type: 'chooseDice', indices };
      }
      case 'roll': return { type: 'roll' };
      case 'jail':
        if (p.jailCards > 0) return { type: 'jailCard' };
        if (p.cash >= RULES.jailFee + 400000) return { type: 'jailPay' };
        return { type: 'jailRoll' };
      case 'buy': {
        const b = BOARD[t.offer];
        const after = p.cash - b.price;
        let want = after >= reserve;
        if (b.type === 'property') {
          const mine = BOARD.filter((x, i) => x.type === 'property' && x.group === b.group && state.tiles[i].owner === pIdx).length;
          if (mine > 0 && after >= 0) want = true;
        }
        if (!want) return { type: 'skipBuy' };
        // le plus haut niveau qui laisse une réserve confortable
        const opts = buyOptions(state, pIdx, t.offer).filter((o) => o.affordable && !o.locked);
        if (!opts.length) return { type: 'skipBuy' };
        let best = opts[0];
        for (const o of opts) if (p.cash - o.cost >= reserve + 150000) best = o;
        return { type: 'buy', houses: best.houses };
      }
      case 'build': {
        const opts = buildOptions(state, pIdx, t.offer).filter((o) => o.affordable && !o.locked && p.cash - o.cost >= reserve + 100000);
        if (!opts.length) return { type: 'skipBuild' };
        return { type: 'build', houses: opts[opts.length - 1].houses };
      }
      case 'buyout': {
        const i = t.offer; const price = t.buyoutPrice || buyoutPrice(state, i);
        const mine = BOARD.filter((x, k) => x.type === 'property' && x.group === BOARD[i].group && state.tiles[k].owner === pIdx).length;
        const total = BOARD.filter((x) => x.type === 'property' && x.group === BOARD[i].group).length;
        const completes = mine === total - 1;
        const want = p.cash - price >= reserve && (completes || price <= BOARD[i].price * 2.2 && p.cash - price >= 800000);
        return { type: want ? 'buyout' : 'skipBuyout' };
      }
      case 'teleport': {
        const targets = teleportTargets(state, pIdx);
        const cashAfterFee = p.cash - RULES.worldTourFee;
        let best = null, bestScore = -1;
        for (const i of targets) {
          const tl = state.tiles[i];
          let score = -1;
          if (tl.owner === null && BOARD[i].price <= cashAfterFee - reserve) score = BOARD[i].price;
          else if (tl.owner === pIdx && BOARD[i].type === 'property' && tl.houses < HOTEL && cashAfterFee - stepCost(i, tl.houses + 1) >= reserve) score = BOARD[i].rents[tl.houses + 1] / 2;
          if (score > bestScore) { bestScore = score; best = i; }
        }
        return best !== null && bestScore > 0 ? { type: 'teleport', tile: best } : { type: 'skipTeleport' };
      }
      case 'championship': {
        const targets = championshipTargets(state, pIdx);
        if (!targets.length || p.cash < RULES.championshipFee + reserve) return { type: 'skipChampionship' };
        let best = targets[0], bestRent = -1;
        for (const i of targets) {
          const r = BOARD[i].rents[state.tiles[i].houses];
          if (r > bestRent) { bestRent = r; best = i; }
        }
        return { type: 'championship', tile: best };
      }
      case 'debt': {
        if (p.cash + liquidationValue(state, pIdx) < t.debt.amount) return { type: 'declareBankrupt' };
        // Vendre les niveaux de taverne les moins chers en premier.
        let best = null, bestV = Infinity;
        for (let i = 0; i < N; i++) {
          const tl = state.tiles[i];
          if (!tl || tl.owner !== pIdx) continue;
          const v = sellValue(state, i) + (tl.houses > 0 ? -1 : 0);
          if (v < bestV) { bestV = v; best = i; }
        }
        return { type: 'sell', tile: best };
      }
      case 'done': return { type: 'endTurn' };
    }
    return null;
  }

  const ENGINE = {
    changeController, readClock, refreshClock, landPrice, powerTargets,
    createGame, apply, tick, botAction, computeRent, netWorth, liquidationValue, sellValue, tileValue,
    teleportTargets, championshipTargets, canBuild, canBuyout, buyoutPrice, buyOptions, buildOptions, levelCost, stepCost, HOTEL,
    ownsGroup, countOwned, houseCost, isOwnable, alive, fmt, N,
  };
  global.TT_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
