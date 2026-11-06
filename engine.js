/* ============================================================
   TAVERN TOUR — Moteur de règles (pur, sans DOM)
   Fonctionne dans le navigateur (window.TT_ENGINE) et dans Node
   (module.exports) pour les simulations.
   ============================================================ */
(function (global) {
  'use strict';

  const CFG = global.TT_CONFIG || (typeof require !== 'undefined' ? require('./config.js') : null);
  const { RULES, GROUPS, BOARD, CARDS, PLAYER_COLORS } = CFG;
  const N = BOARD.length;
  const OWNABLE = new Set(['property', 'station', 'utility']);

  const isOwnable = (i) => OWNABLE.has(BOARD[i].type);

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newTurn() {
    return { step: 'roll', doubles: 0, dice: null, isDouble: false, debt: null, offer: null, rolledThisTurn: false, lastPay: null, buyoutPrice: null };
  }

  function createGame(playerDefs, opts, rng, now) {
    rng = rng || Math.random;
    now = now || Date.now();
    opts = opts || {};
    const durationMs = (opts.durationMin || RULES.defaultDurationMin) * 60 * 1000;
    const players = playerDefs.slice(0, RULES.maxPlayers).map((p, i) => ({
      name: p.name || `Joueur ${i + 1}`,
      token: p.token || '🐟',
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      isBot: !!p.isBot,
      peerId: p.peerId || null,
      connected: p.isBot ? true : (p.connected !== false),
      cash: RULES.startCash,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      laps: 0,
      bankrupt: false,
    }));
    const state = {
      phase: 'playing',
      players,
      tiles: BOARD.map((t) => (OWNABLE.has(t.type) ? { owner: null, houses: 0 } : null)),
      current: 0,
      turn: newTurn(),
      championship: null,
      deck: shuffle(CARDS.map((_, i) => i), rng),
      deckPos: 0,
      log: [],
      events: [],
      startedAt: now,
      durationMs,
      endsAt: now + durationMs,
      remainingMs: durationMs,
      ranking: null,
      turnCount: 1,
    };
    log(state, `La partie commence ! ${players[0].name} ouvre le bal.`);
    return state;
  }

  function log(state, text, kind) {
    state.log.push({ t: text, k: kind || 'info', n: state.turnCount });
    if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
  }
  const ev = (state, e) => state.events.push(e);
  const fmt = (n) => n.toLocaleString('fr-FR');

  // ---------- Valeurs ----------
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
    let v = BOARD[i].price;
    if (BOARD[i].type === 'property') v += levelCost(i, 0, t.houses);
    return v;
  }
  function buyoutPrice(state, i) { return tileValue(state, i) * RULES.buyoutMult; }
  function canBuyout(state, pIdx, i) {
    const b = BOARD[i]; const t = state.tiles[i];
    return b.type === 'property' && t.owner !== null && t.owner !== pIdx && t.houses < HOTEL && !state.players[t.owner].bankrupt && state.players[pIdx].cash >= buyoutPrice(state, i);
  }
  // Options d'achat d'une case libre : terrain nu ou niveaux de taverne 1..4.
  function buyOptions(state, pIdx, i) {
    const b = BOARD[i]; const p = state.players[pIdx];
    if (b.type !== 'property') return [{ houses: 0, cost: b.price, locked: false, affordable: p.cash >= b.price }];
    const out = [];
    for (let h = 0; h <= RULES.maxHouses; h++) {
      const cost = b.price + levelCost(i, 0, h);
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
      const cost = stepCost(i, HOTEL);
      return [{ houses: HOTEL, cost, locked: false, affordable: p.cash >= cost }];
    }
    for (let h = t.houses + 1; h <= RULES.maxHouses; h++) {
      const cost = levelCost(i, t.houses, h);
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
    const t = state.tiles[i];
    if (BOARD[i].type === 'property' && t.houses > 0) return Math.floor(stepCost(i, t.houses) * RULES.sellRatio);
    return Math.floor(BOARD[i].price * RULES.sellRatio);
  }
  function computeRent(state, i, diceSum) {
    const b = BOARD[i];
    const t = state.tiles[i];
    const owner = t.owner;
    if (b.type === 'property') {
      let r = b.rents[t.houses];
      if (t.houses === 0 && ownsGroup(state, owner, b.group)) r *= 2;
      if (state.championship && state.championship.tile === i) r *= state.championship.mult;
      return r;
    }
    if (b.type === 'station') return RULES.stationRents[countOwned(state, owner, 'station') - 1];
    if (b.type === 'utility') {
      const n = countOwned(state, owner, 'utility');
      return (diceSum || 7) * RULES.utilityMult[n - 1];
    }
    return 0;
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

  // ---------- Argent ----------
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

  // ---------- Déplacements ----------
  function sendToJail(state, pIdx) {
    const p = state.players[pIdx];
    ev(state, { type: 'move', player: pIdx, from: p.pos, to: 10, teleport: true });
    p.pos = 10;
    p.inJail = true;
    p.jailTurns = 0;
    state.turn.isDouble = false; // pas de relance
    ev(state, { type: 'jail', player: pIdx });
    log(state, `${p.name} échoue sur l’Île perdue !`, 'warn');
    state.turn.step = 'done';
  }

  function moveTo(state, pIdx, to, opts) {
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
        // on passe par la Taverne
        p.cash += RULES.salary;
        p.laps++;
        ev(state, { type: 'salary', player: pIdx, amount: RULES.salary });
        log(state, `${p.name} passe par la Taverne et reçoit ${fmt(RULES.salary)}.`, 'ok');
      }
      ev(state, { type: 'move', player: pIdx, from, to, steps, backward: !!opts.backward });
    }
    p.pos = to;
    landOn(state, pIdx, opts.diceSum);
  }

  function landOn(state, pIdx, diceSum) {
    const p = state.players[pIdx];
    const i = p.pos;
    const b = BOARD[i];
    const t = state.tiles[i];
    switch (b.type) {
      case 'property':
      case 'station':
      case 'utility': {
        if (t.owner === null) {
          if (p.cash >= b.price) {
            state.turn.step = 'buy';
            state.turn.offer = i;
            log(state, `${p.name} arrive sur ${b.name} (libre, ${fmt(b.price)}).`);
          } else {
            log(state, `${p.name} arrive sur ${b.name} mais n’a pas de quoi l’acheter.`);
            finishStep(state);
          }
        } else if (t.owner === pIdx) {
          if (canBuild(state, pIdx, i)) {
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
          const rent = computeRent(state, i, diceSum);
          log(state, `${p.name} tombe chez ${owner.name} (${b.name}) : loyer ${fmt(rent)}.`, 'rent');
          if (pay(state, pIdx, rent, t.owner, `Loyer ${b.name}`)) {
            if (canBuyout(state, pIdx, i)) {
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
        drawCard(state, pIdx);
        break;
      case 'jail':
        sendToJail(state, pIdx);
        break;
      case 'championship':
        if (championshipTargets(state, pIdx).length && p.cash >= RULES.championshipFee) {
          state.turn.step = 'championship';
          log(state, `${p.name} peut organiser les Championnats (${fmt(RULES.championshipFee)}).`);
        } else {
          log(state, `${p.name} assiste aux Championnats du monde.`);
          finishStep(state);
        }
        break;
      case 'worldtour':
        if (teleportTargets(state, pIdx).length && p.cash >= RULES.worldTourFee) {
          state.turn.step = 'teleport';
          log(state, `${p.name} ouvre le Portail du Tour du monde (${fmt(RULES.worldTourFee)}).`);
        } else {
          log(state, `${p.name} contemple le Portail.`);
          finishStep(state);
        }
        break;
      default:
        log(state, `${p.name} fait halte à la Taverne.`);
        finishStep(state);
    }
  }

  function drawCard(state, pIdx) {
    const p = state.players[pIdx];
    if (state.deckPos >= state.deck.length) {
      state.deck = shuffle(state.deck, Math.random);
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
        moveTo(state, pIdx, card.tile, {});
        break;
      case 'moveBack':
        moveTo(state, pIdx, (p.pos - card.steps + N) % N, { backward: true });
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
        moveTo(state, pIdx, to, {});
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
    if (t.isDouble && !p.inJail && t.doubles < 3) {
      t.step = 'roll';
      t.isDouble = false;
      log(state, `Double ! ${p.name} rejoue.`, 'ok');
    } else {
      t.step = 'done';
    }
  }

  function rollDice(rng) {
    return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
  }

  // ---------- Fin de partie ----------
  function endGame(state, reason) {
    state.phase = 'ended';
    state.remainingMs = 0;
    const ranking = state.players
      .map((p, i) => ({ idx: i, name: p.name, token: p.token, color: p.color, worth: netWorth(state, i), cash: p.cash, bankrupt: p.bankrupt, props: state.tiles.filter((t) => t && t.owner === i).length }))
      .sort((a, b) => (a.bankrupt !== b.bankrupt ? (a.bankrupt ? 1 : -1) : b.worth - a.worth));
    state.ranking = ranking;
    state.endReason = reason;
    log(state, `Fin de partie : ${ranking[0].name} l’emporte avec ${fmt(ranking[0].worth)} !`, 'ok');
    ev(state, { type: 'gameover' });
  }

  function nextTurn(state, now) {
    now = now || Date.now();
    if (state.phase !== 'playing') return;
    if (now >= state.endsAt) { endGame(state, 'time'); return; }
    const a = alive(state);
    if (a.length <= 1) { endGame(state, 'bankrupt'); return; }
    let i = state.current;
    do { i = (i + 1) % state.players.length; } while (state.players[i].bankrupt);
    state.current = i;
    state.turnCount++;
    state.turn = newTurn();
    const p = state.players[i];
    if (p.inJail) state.turn.step = 'jail';
    log(state, `— Au tour de ${p.name}${p.inJail ? ' (naufragé sur l’Île perdue)' : ''}.`, 'turn');
  }

  function bankrupt(state, pIdx) {
    const p = state.players[pIdx];
    const d = state.turn.debt;
    const to = d && typeof d.to === 'number' ? d.to : null;
    // tout l'argent et les propriétés vont au créancier (ou à la banque)
    if (to !== null) state.players[to].cash += p.cash;
    p.cash = 0;
    for (let i = 0; i < N; i++) {
      const t = state.tiles[i];
      if (t && t.owner === pIdx) {
        if (to !== null) { t.owner = to; }
        else { t.owner = null; t.houses = 0; }
        if (state.championship && state.championship.tile === i && to === null) state.championship = null;
      }
    }
    p.bankrupt = true;
    p.inJail = false;
    state.turn.debt = null;
    ev(state, { type: 'bankrupt', player: pIdx });
    log(state, `${p.name} fait faillite${to !== null ? ` au profit de ${state.players[to].name}` : ''} !`, 'warn');
    if (alive(state).length <= 1) endGame(state, 'bankrupt');
    else nextTurn(state);
  }

  // ---------- Actions ----------
  const ERR = (m) => ({ ok: false, error: m });
  const OK = { ok: true };

  function apply(state, pIdx, action, rng, now) {
    rng = rng || Math.random;
    now = now || Date.now();
    state.events = [];
    if (state.phase !== 'playing') return ERR('La partie est terminée.');
    const p = state.players[pIdx];
    const t = state.turn;
    if (p.bankrupt) return ERR('Joueur en faillite.');
    if (pIdx !== state.current) return ERR('Ce n’est pas votre tour.');

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
          log(state, `Trois doubles ! ${p.name} est envoyé sur l’Île perdue.`, 'warn');
          sendToJail(state, pIdx);
          return OK;
        }
        moveTo(state, pIdx, (p.pos + d[0] + d[1]) % N, { diceSum: d[0] + d[1] });
        return OK;
      }
      case 'jailPay': {
        if (t.step !== 'jail') return ERR('Vous n’êtes pas sur l’Île perdue.');
        if (p.cash < RULES.jailFee) return ERR('Pas assez d’or.');
        p.cash -= RULES.jailFee;
        p.inJail = false;
        t.step = 'roll';
        log(state, `${p.name} paie ${fmt(RULES.jailFee)} et quitte l’Île perdue.`);
        return OK;
      }
      case 'jailCard': {
        if (t.step !== 'jail') return ERR('Vous n’êtes pas sur l’Île perdue.');
        if (p.jailCards <= 0) return ERR('Aucune carte de sortie.');
        p.jailCards--;
        p.inJail = false;
        t.step = 'roll';
        log(state, `${p.name} utilise une carte et quitte l’Île perdue.`);
        return OK;
      }
      case 'jailRoll': {
        if (t.step !== 'jail') return ERR('Vous n’êtes pas sur l’Île perdue.');
        const d = rollDice(rng);
        t.dice = d;
        t.rolledThisTurn = true;
        ev(state, { type: 'dice', player: pIdx, dice: d });
        if (d[0] === d[1]) {
          p.inJail = false;
          t.isDouble = false;
          log(state, `${p.name} fait un double (${d[0]}+${d[1]}) et s’échappe de l’Île perdue !`, 'ok');
          moveTo(state, pIdx, (p.pos + d[0] + d[1]) % N, { diceSum: d[0] + d[1] });
        } else {
          p.jailTurns++;
          if (p.jailTurns >= RULES.jailMaxTurns) {
            p.inJail = false;
            log(state, `${p.name} lance ${d[0]}+${d[1]} : troisième essai, un bateau le récupère enfin.`);
            moveTo(state, pIdx, (p.pos + d[0] + d[1]) % N, { diceSum: d[0] + d[1] });
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
        if (b.type === 'property' && ownsGroup(state, pIdx, b.group)) log(state, `${p.name} contrôle tous les ${GROUPS[b.group].label}s : loyers doublés !`, 'ok');
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
        if (ownsGroup(state, pIdx, BOARD[i].group)) log(state, `${p.name} contrôle tous les ${GROUPS[BOARD[i].group].label}s : loyers doublés !`, 'ok');
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
        moveTo(state, pIdx, i, {});
        return OK;
      }
      case 'skipTeleport': {
        if (t.step !== 'teleport') return ERR('Pas de portail ouvert.');
        log(state, `${p.name} referme le Portail.`);
        finishStep(state);
        return OK;
      }
      case 'championship': {
        if (t.step !== 'championship') return ERR('Pas de Championnats à organiser.');
        const i = action.tile;
        if (!championshipTargets(state, pIdx).includes(i)) return ERR('Case invalide.');
        if (p.cash < RULES.championshipFee) return ERR('Pas assez d’or.');
        p.cash -= RULES.championshipFee;
        const prev = state.championship;
        const mult = Math.min(RULES.championshipMaxMult, prev ? prev.mult + 1 : 2);
        state.championship = { tile: i, mult };
        ev(state, { type: 'championship', tile: i, mult });
        log(state, `${p.name} organise les Championnats sur ${BOARD[i].name} : loyer x${mult} !`, 'ok');
        finishStep(state);
        return OK;
      }
      case 'skipChampionship': {
        if (t.step !== 'championship') return ERR('Pas de Championnats à organiser.');
        finishStep(state);
        return OK;
      }
      case 'sell': {
        const i = action.tile;
        if (!isOwnable(i) || state.tiles[i].owner !== pIdx) return ERR('Ce n’est pas à vous.');
        if (!['roll', 'done', 'debt', 'jail', 'buy', 'build', 'buyout'].includes(t.step)) return ERR('Impossible de vendre maintenant.');
        const tile = state.tiles[i];
        const v = sellValue(state, i);
        if (BOARD[i].type === 'property' && tile.houses > 0) {
          const wasGolden = tile.houses === HOTEL;
          tile.houses--;
          log(state, `${p.name} revend ${wasGolden ? 'le serviteur doré' : `Taverne ${tile.houses + 1}`} sur ${BOARD[i].name} (+${fmt(v)}).`);
        } else {
          tile.owner = null;
          tile.houses = 0;
          if (state.championship && state.championship.tile === i) state.championship = null;
          log(state, `${p.name} revend ${BOARD[i].name} à la banque (+${fmt(v)}).`);
        }
        p.cash += v;
        ev(state, { type: 'sell', player: pIdx, tile: i });
        if (t.step === 'debt') settleDebt(state, pIdx);
        return OK;
      }
      case 'declareBankrupt': {
        if (t.step !== 'debt') return ERR('Vous n’avez pas de dette.');
        if (p.cash + liquidationValue(state, pIdx) >= t.debt.amount) return ERR('Vous pouvez encore vendre pour payer.');
        bankrupt(state, pIdx);
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
  function tick(state, now) {
    now = now || Date.now();
    if (state.phase !== 'playing') return false;
    state.remainingMs = Math.max(0, state.endsAt - now);
    if (now >= state.endsAt) {
      state.events = [];
      endGame(state, 'time');
      return true;
    }
    return false;
  }

  // ---------- Bot ----------
  function botAction(state, pIdx) {
    const p = state.players[pIdx];
    const t = state.turn;
    const reserve = 150000;
    switch (t.step) {
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
    createGame, apply, tick, botAction, computeRent, netWorth, liquidationValue, sellValue, tileValue,
    teleportTargets, championshipTargets, canBuild, canBuyout, buyoutPrice, buyOptions, buildOptions, levelCost, stepCost, HOTEL,
    ownsGroup, countOwned, houseCost, isOwnable, alive, fmt, N,
  };
  global.TT_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
