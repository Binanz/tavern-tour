import { N, $, fmt, STEP_MS, app } from '../runtime.js';
import { SFX } from '../audio.js';

export function createAnimations({ positionAllPawns, showChanceCard, showEnd }) {
  // Effets visuels
  function floatMoney(x, y, amount, big) {
    const el = document.createElement('div');
    el.className = 'fx-money ' + (amount >= 0 ? 'gain' : 'loss') + (big ? ' big' : '');
    el.textContent = (amount >= 0 ? '+' : '−') + fmt(Math.abs(amount));
    x = Math.min(window.innerWidth - 90, Math.max(90, x)); y = Math.max(70, y);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
  function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function flashTile(i, kind) {
    const el = $('board').querySelector(`.tile[data-i="${i}"]`); if (!el) return;
    el.classList.remove('land', 'bad', 'good'); void el.offsetWidth;
    el.classList.add('land'); if (kind) el.classList.add(kind);
    setTimeout(() => el.classList.remove('land', 'bad', 'good'), 850);
  }
  function flashCard(pIdx, kind) {
    const card = $('players').children[pIdx]; if (!card) return;
    card.classList.remove('flash-gain', 'flash-loss'); void card.offsetWidth; card.classList.add('flash-' + kind);
    const cash = card.querySelector('.pc-cash'); if (cash) { cash.classList.remove('bump'); void cash.offsetWidth; cash.classList.add('bump'); }
  }
  // Montre la variation d'or d'un joueur : sur sa carte, sur son pion, et un son.
  function showMoneyDelta(pIdx, delta) {
    if (!delta) return;
    const card = $('players').children[pIdx];
    const big = Math.abs(delta) >= 200000;
    if (card) { const c = centerOf(card.querySelector('.pc-cash') || card); floatMoney(c.x, c.y - 10, delta, big); flashCard(pIdx, delta > 0 ? 'gain' : 'loss'); }
    const pawn = $('pawn' + pIdx);
    if (pawn) { const c = centerOf(pawn); floatMoney(c.x, c.y - 18, delta, false); }
    const mine = pIdx === app.myIdx;
    if (mine) (delta > 0 ? SFX.gain : SFX.loss)(big); else SFX.soft();
  }
  function showTurnOverlay() {
    const o = $('turnOverlay'); o.hidden = false;
    const inner = o.querySelector('.to-inner'); inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = '';
    clearTimeout(showTurnOverlay._t); showTurnOverlay._t = setTimeout(() => (o.hidden = true), 1850);
    SFX.turn();
  }

  // file d'animation des pions
  function enqueueMove(ev) {
    const i = ev.player;
    app.pawnQueue[i].push(ev);
    if (!app.pawnBusy[i]) runPawnQueue(i);
  }
  function runPawnQueue(i) {
    const ev = app.pawnQueue[i].shift();
    if (!ev) { app.pawnBusy[i] = false; positionAllPawns(); return; }
    app.pawnBusy[i] = true;
    if (ev.teleport || ev.steps === undefined) {
      app.displayedPos[i] = ev.to; positionAllPawns(); flashTile(ev.to); SFX.land();
      setTimeout(() => runPawnQueue(i), 350);
      return;
    }
    let remaining = ev.steps;
    const dir = ev.backward ? -1 : 1;
    const stepFn = () => {
      if (remaining <= 0) { flashTile(app.displayedPos[i]); SFX.land(); setTimeout(() => runPawnQueue(i), 120); return; }
      app.displayedPos[i] = (app.displayedPos[i] + dir + N) % N; remaining--;
      positionAllPawns(); SFX.step();
      setTimeout(stepFn, STEP_MS);
    };
    stepFn();
  }

  function animateDice(d) {
    const d1 = $('die1'), d2 = $('die2');
    d1.classList.add('rolling'); d2.classList.add('rolling'); SFX.dice();
    let n = 0;
    const iv = setInterval(() => {
      d1.firstElementChild.textContent = 1 + Math.floor(Math.random() * 6);
      d2.firstElementChild.textContent = 1 + Math.floor(Math.random() * 6);
      if (++n >= 6) { clearInterval(iv); d1.classList.remove('rolling'); d2.classList.remove('rolling'); d1.firstElementChild.textContent = d[0]; d2.firstElementChild.textContent = d[1]; }
    }, 90);
  }

  function processEvents(s) {
    let delay = 0;
    const pendingSalaries = [];
    for (const ev of s.events || []) {
      if (ev.type === 'dice') { animateDice(ev.dice); delay += 650; }
      if (ev.type === 'move') {
        const moveStart = delay;
        setTimeout(() => enqueueMove(ev), delay);
        const moveDuration = ev.teleport || ev.steps === undefined ? 450 : ev.steps * STEP_MS + 250;
        pendingSalaries.splice(0).forEach((salary) => {
          const at = ev.teleport || ev.steps === undefined ? moveDuration : Math.min(ev.steps, salary.atStep || ev.steps) * STEP_MS + 30;
          setTimeout(() => { showMoneyDelta(salary.player, salary.amount); flashTile(0, 'good'); }, moveStart + at);
        });
        delay += moveDuration;
      }
      if (ev.type === 'card') { setTimeout(() => showChanceCard(ev.text), delay); delay += 2600; }
      if (ev.type === 'salary') pendingSalaries.push(ev);
      if (ev.type === 'pay') { const e2 = ev; setTimeout(() => { if (typeof e2.to === 'number' && s.players[e2.to]) flashTile(s.players[e2.from].pos, 'bad'); }, delay); }
      if (ev.type === 'buy' || ev.type === 'build') { const tl = ev.tile; setTimeout(() => flashTile(tl, 'good'), delay); }
      if (ev.type === 'buyout') { const tl = ev.tile; setTimeout(() => { flashTile(tl, 'good'); SFX.card(); }, delay); }
      if (ev.type === 'jail' || ev.type === 'bankrupt') setTimeout(SFX.bad, delay);
      if (ev.type === 'gameover') setTimeout(() => { showEnd(); SFX.win(); }, delay + 300);
    }
    return delay;
  }


  return { showMoneyDelta, showTurnOverlay, processEvents };
}
