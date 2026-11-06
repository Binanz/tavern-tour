import { $, app, RULES } from '../runtime.js';

export function createGameView({ showMoneyDelta, showTurnOverlay, processEvents, showGame, buildPawns, positionAllPawns, renderPlayers, renderTiles, renderLog, renderActions, renderTileInfo, showEnd }) {
  function onState() {
    const s = app.state; if (!s) return;
    showGame();
    if (app.displayedPos.length !== s.players.length) { app.displayedPos = s.players.map((p) => p.pos); app.pawnQueue = s.players.map(() => []); app.pawnBusy = s.players.map(() => false); buildPawns(); }
    app.animDelay = processEvents(s);
    app.animating = app.animDelay > 0;
    // variations d'or (hors salaire déjà affiché pendant le déplacement)
    if (app.prevCash && app.prevCash.length === s.players.length) {
      const salaryFor = {};
      (s.events || []).forEach((e) => { if (e.type === 'salary') salaryFor[e.player] = (salaryFor[e.player] || 0) + e.amount; });
      s.players.forEach((p, i) => {
        const d = p.cash - app.prevCash[i] - (salaryFor[i] || 0);
        if (d) setTimeout(() => showMoneyDelta(i, d), Math.max(0, app.animDelay - 100));
      });
    }
    app.prevCash = s.players.map((p) => p.cash);
    // début de mon tour
    const myTurnNow = !s.ordering && s.current === app.myIdx && s.phase === 'playing';
    if (myTurnNow && (app.prevCurrent !== s.current || app.prevTurnCount !== s.turnCount)) setTimeout(showTurnOverlay, app.animDelay);
    app.prevCurrent = s.current; app.prevTurnCount = s.turnCount;
    const board = $('board'); board.classList.toggle('myturn', myTurnNow); board.style.setProperty('--mycolor', s.players[app.myIdx] ? s.players[app.myIdx].color : '#f3d98b');
    // resynchronise les pions qui ne bougent pas
    s.players.forEach((p, i) => { if (!app.pawnBusy[i] && !app.pawnQueue[i].length && app.displayedPos[i] !== p.pos && !(s.events || []).some((e) => e.type === 'move' && e.player === i)) app.displayedPos[i] = p.pos; });
    positionAllPawns();
    app.selectMode = null;
    renderTimer();
    clearTimeout(app.actionTimer);
    renderActions(true);
    app.actionTimer = setTimeout(() => {
      if (app.state !== s) return;
      app.animating = false;
      renderPlayers(); renderTiles(); renderLog(); renderActions(false);
      if (app.selectedTile === null) app.selectedTile = 0;
      if (renderTileInfo) renderTileInfo(app.selectedTile);
    }, app.animDelay);
    if (s.phase === 'ended' && !(s.events || []).some((e) => e.type === 'gameover')) showEnd();
  }

  function renderTimer() {
    const rem = app.state && app.state.ordering
      ? app.state.remainingMs
      : Math.max(0, app.sync.remainingMs - (Date.now() - app.sync.at));
    const m = Math.floor(rem / 60000), sec = Math.floor((rem % 60000) / 1000);
    const el = $('timer');
    el.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    el.classList.toggle('urgent', rem < 60000 && app.state && app.state.phase === 'playing');
    renderTurnClock();
  }
  function renderTurnClock() {
    const clock = $('turnClock');
    const s = app.state;
    if (!s || s.phase !== 'playing' || s.ordering || s.turnEndsAt == null) { clock.hidden = true; return; }
    clock.hidden = false;
    const remaining = Math.max(0, (app.sync.turnRemainingMs || 0) - (Date.now() - app.sync.at));
    const fraction = Math.min(1, remaining / RULES.turnDurationMs);
    clock.style.setProperty('--fuse-progress', `${Math.round((1 - fraction) * 100)}%`);
    clock.classList.toggle('expired', remaining <= 5000);
    $('turnSeconds').textContent = `${Math.ceil(remaining / 1000)} s`;
    clock.title = `Temps restant au tour de ${s.players[s.current].name}`;
    clock.setAttribute('aria-label', `Temps restant au tour de ${s.players[s.current].name} : ${Math.ceil(remaining / 1000)} secondes`);
  }

  function startDisplayClock() {
    setInterval(() => { if (app.state) renderTimer(); }, 250);
  }

  return { onState, startDisplayClock };
}
