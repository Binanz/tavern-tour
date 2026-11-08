import { E, $, app, RULES, TOKENS } from './runtime.js';
import { SFX } from './audio.js';
import { toast, closeModal } from './ui/helpers.js';

export function createSession({ shuffledBotNames, setNetStatus, onState }) {
  // Lancement et boucle de jeu (hôte / local)
  function startGame() {
    const L = app.lobby;
    const players = L.players.map((p) => ({ name: p.name, token: p.token, isBot: p.isBot, peerId: p.peerId }));
    if (L.fillBots) {
      const botNames = shuffledBotNames(players.map((player) => player.name), RULES.maxPlayers - players.length);
      let k = 0;
      while (players.length < RULES.maxPlayers) {
        const token = TOKENS.find((t) => !players.some((p) => p.token === t));
        players.push({ name: botNames[k++], token, isBot: true });
      }
    }
    if (players.length < 2) { toast('Il faut au moins 2 joueurs (ou cochez « compléter avec des bots »).'); return; }
    L.players = players.map((player) => ({ ...player }));
    L.started = true;
    launch(players, L.durationMin);
  }

  function launch(players, durationMin) {
    $('brandHome').disabled = true;
    document.querySelector('.topbar').classList.remove('game-ended');
    app.selectedTile = null;
    app.state = E.createGame(players, { powers: !!(app.lobby && app.lobby.powers), durationMin, anomaly: app.lobby ? app.lobby.anomaly : 'none' });
    app.displayedPos = app.state.players.map(() => 0);
    app.prevCash = null; app.prevCurrent = -1; app.prevTurnCount = 0;
    app.pawnQueue = app.state.players.map(() => []);
    app.pawnBusy = app.state.players.map(() => false);
    clearInterval(app.tickTimer);
    app.tickTimer = setInterval(hostTick, 1000);
    afterChange();
  }

  function hostTick() {
    if (!app.state || app.mode === 'client') return;
    if (E.tick(app.state, Date.now())) afterChange();
    else app.sync = E.readClock(app.state, Date.now());
  }

  function dispatch(idx, action, from) {
    if (!app.state || app.mode === 'client') return { ok: false, error: 'Seul l’hôte peut appliquer une action.' };
    const res = E.apply(app.state, idx, action, Math.random, Date.now());
    if (!res.ok) {
      if (from === 'me') { toast(res.error); SFX.bad(); }
      else if (from) app.net.sendTo(from, { type: 'error', msg: res.error });
      return res;
    }
    afterChange();
    return res;
  }

  function afterChange() {
    const s = app.state;
    if (!s || app.mode === 'client') return;
    const now = Date.now();
    E.refreshClock(s, now);
    app.sync = E.readClock(s, now);
    if (app.mode === 'host' && app.net) {
      s.players.forEach((p, i) => { if (p.peerId && p.peerId !== 'host') app.net.sendTo(p.peerId, { type: 'state', state: s, yourIdx: i }); });
    }
    onState();
    scheduleBot();
    scheduleAutoEnd();
  }

  function receiveState(state, yourIdx) {
    if (app.mode !== 'client') return;
    app.state = state;
    app.myIdx = state.players.findIndex((p) => p.peerId === app.net.peer.id);
    if (app.myIdx < 0) app.myIdx = yourIdx != null ? yourIdx : 0;
    app.sync = { ...E.readClock(state, Date.now()), remainingMs: state.remainingMs };
    onState();
  }

  function changeController(idx, command) {
    if (!app.state || app.mode !== 'host') return { ok: false, error: 'Seul l’hôte peut changer un joueur.' };
    const result = E.changeController(app.state, idx, command);
    if (!result.ok || !result.changed) return result;
    const player = app.state.players[idx];
    app.lobby.players[idx] = { name: player.name, token: player.token, isBot: player.isBot, peerId: player.peerId };
    afterChange();
    return result;
  }

  // Fin de tour automatique : plus de bouton, le tour passe tout seul après les animations.
  function scheduleAutoEnd() {
    clearTimeout(app.autoEndTimer);
    const s = app.state;
    if (!s || s.phase !== 'playing' || s.turn.step !== 'done') return;
    const p = s.players[s.current];
    if (p.isBot) return; // géré par scheduleBot
    app.autoEndTimer = setTimeout(() => { if (app.state === s && s.turn.step === 'done') dispatch(s.current, { type: 'endTurn' }, null); }, app.animDelay + 1700);
  }
  function scheduleBot() {
    clearTimeout(app.botTimer);
    const s = app.state;
    if (!s || s.phase !== 'playing') return;
    const p = s.players[s.current];
    if (!p.isBot) return;
    const a = E.botAction(s, s.current);
    if (!a) return;
    const base = { orderRoll: 1300, roll: 1300, jailRoll: 1300, endTurn: 1100, sell: 800, buy: 1200, build: 1200, auctionBid: 800, auctionPass: 600 }[a.type] || 1000;
    app.botTimer = setTimeout(() => dispatch(s.current, a, null), base + app.animDelay);
  }

  function act(action) {
    if (!app.state || app.animating) return;
    if (app.mode === 'client') app.net.sendHost({ type: 'action', action });
    else dispatch(app.myIdx, action, 'me');
  }

  function returnHome() {
    if (!app.state || app.state.phase !== 'ended') return;
    closeModal();
    clearTimeout(app.botTimer); clearTimeout(app.actionTimer); clearTimeout(app.autoEndTimer);
    clearInterval(app.tickTimer);
    clearTimeout(app.hostLostTimer);
    if (app.net) app.net.destroy();
    app.net = null; app.mode = null; app.lobby = null; app.state = null;
    app.gameShown = false;
    app.displayedPos = []; app.pawnQueue = []; app.pawnBusy = [];
    app.prevCash = null; app.prevCurrent = -1; app.prevTurnCount = 0;
    app.sync = { remainingMs: RULES.defaultDurationMin * 60000, at: Date.now() };
    $('timer').textContent = `${String(RULES.defaultDurationMin).padStart(2, '0')}:00`;
    $('timer').classList.remove('urgent');
    $('screen-game').hidden = true;
    $('screen-home').hidden = false;
    $('brandHome').disabled = true;
    document.querySelector('.topbar').classList.remove('game-ended');
    $('roomChip').hidden = true;
    $('lobbyPanel').hidden = true;
    $('modesPanel').hidden = false;
    $('btnSaveLobbyProfile').hidden = true;
    $('lobbyProfileHint').textContent = '';
    $('tokenPicker').querySelectorAll('.token-btn').forEach((button) => { button.disabled = false; });
    $('btnHost').disabled = false; $('btnJoin').disabled = false;
    $('anomalySelect').disabled = false;
    $('powersEnabled').disabled = false;
    setNetStatus('');
  }


  return { startGame, launch, dispatch, afterChange, act, returnHome, receiveState, changeController };
}
