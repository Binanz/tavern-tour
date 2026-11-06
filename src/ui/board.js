import { E, N, $, fmt, app, LEVEL_LABELS, BOARD, GROUPS } from '../runtime.js';
import { closeModal, esc, groupColor, typeLabel, ICONS, shortName, fmtShort } from './helpers.js';

export function createBoard({ onTileClick }) {
  // Rendu
  function showGame() {
    if (app.gameShown) return;
    app.gameShown = true;
    $('screen-home').hidden = true;
    $('screen-game').hidden = false;
    if (app.lobby && app.lobby.code) { $('roomChip').hidden = false; $('roomCodeTop').textContent = app.lobby.code; }
    buildBoard();
    if (!app.displayedPos.length) {
      app.displayedPos = app.state.players.map((p) => p.pos);
      app.pawnQueue = app.state.players.map(() => []);
      app.pawnBusy = app.state.players.map(() => false);
    }
    buildPawns();
    requestAnimationFrame(positionAllPawns);
    closeModal();
  }

  function gridPos(i) {
    if (i <= 8) return { col: 9 - i, row: 9, side: 'bottom' };
    if (i <= 15) return { col: 1, row: 17 - i, side: 'left' };
    if (i <= 24) return { col: i - 15, row: 1, side: 'top' };
    return { col: 9, row: i - 23, side: 'right' };
  }

  const OWNABLE_TYPES = new Set(['property', 'station']);
  function buildBoard() {
    if (app.boardBuilt) return;
    app.boardBuilt = true;
    const board = $('board');
    for (let i = 0; i < N; i++) {
      const b = BOARD[i];
      const g = gridPos(i);
      const el = document.createElement('div');
      const corner = [0, 8, 16, 24].includes(i);
      el.className = `tile side-${g.side} type-${b.type}${corner ? ' corner' : ''}`;
      el.style.gridColumn = g.col; el.style.gridRow = g.row;
      el.dataset.i = i;
      if (b.type === 'property') el.style.setProperty('--g', GROUPS[b.group].color);
      let body = '';
      if (b.type === 'property') body = `<div class="band"></div><div class="body"><div class="name">${esc(shortName(i))}</div><div class="houses"></div><div class="price">${fmt(b.price)}</div></div>`;
      else if (b.type === 'station') body = `<div class="body"><div class="ico">${ICONS.station}</div><div class="name">${esc(shortName(i))}</div><div class="price">${fmt(b.price)}</div></div>`;
      else if (b.type === 'chance') body = `<div class="body"><div class="ico">?</div><div class="name">Chance</div></div>`;
      else if (b.type === 'tax') body = `<div class="body"><div class="ico">${ICONS.tax}</div><div class="name">${esc(b.name)}</div><div class="price">${fmt(b.amount)}</div></div>`;
      else if (b.type === 'blank') body = `<div class="body"><div class="ico">—</div><div class="name">${esc(b.name || 'Sans type')}</div></div>`;
      else body = `<div class="body"><div class="ico">${ICONS[b.type]}</div><div class="name">${esc(b.name)}</div>${b.sub ? `<div class="sub">${esc(b.sub)}</div>` : ''}</div>`;
      el.innerHTML = body + (OWNABLE_TYPES.has(b.type) ? '<div class="owner-pin" hidden><span class="owner-line"></span><span class="owner-bubble"><span></span></span></div>' : '');
      el.title = b.name;
      el.onclick = () => onTileClick(i);
      board.appendChild(el);
    }
  }

  function buildPawns() {
    const wrap = $('pawns'); wrap.innerHTML = '';
    app.state.players.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'pawn'; el.id = 'pawn' + i; el.style.setProperty('--pc', p.color);
      el.innerHTML = `<span>${p.token}</span>`; el.title = p.name;
      el.classList.add('notrans');
      wrap.appendChild(el);
      setTimeout(() => el.classList.remove('notrans'), 400);
    });
  }

  function positionAllPawns() { app.state && app.state.players.forEach((_, i) => positionPawn(i)); }
  function positionPawn(i) {
    const el = $('pawn' + i); if (!el) return;
    const pos = app.displayedPos[i];
    const tile = $('board').querySelector(`.tile[data-i="${pos}"]`); if (!tile) return;
    const br = $('board').getBoundingClientRect(), tr = tile.getBoundingClientRect();
    const here = app.displayedPos.map((p, k) => (p === pos && !app.state.players[k].bankrupt ? k : -1)).filter((k) => k >= 0);
    const k = here.indexOf(i), n = here.length;
    const w = el.offsetWidth || 24;
    let dx = 0, dy = 0;
    if (n > 1) { dx = (k % 2 === 0 ? -0.55 : 0.55) * w; dy = (k < 2 ? -0.45 : 0.45) * w; if (n === 2) dy = 0; }
    const x = tr.left - br.left + tr.width / 2 - w / 2 + dx;
    const y = tr.top - br.top + tr.height / 2 - w / 2 + dy;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.classList.toggle('active', app.state.current === i && app.state.phase === 'playing');
    el.classList.toggle('bankrupt', !!app.state.players[i].bankrupt);
  }

  function renderPlayers() {
    const s = app.state;
    const wrap = $('players'); wrap.innerHTML = '';
    const order = s.turnOrder || s.players.map((_, i) => i);
    order.forEach((i) => {
      const p = s.players[i];
      const card = document.createElement('div');
      card.className = 'player-card' + (s.current === i && s.phase === 'playing' ? ' current' : '') + (p.bankrupt ? ' bankrupt' : '');
      card.style.setProperty('--pc', p.color);
      const props = s.tiles.map((t, k) => (t && t.owner === i ? k : -1)).filter((k) => k >= 0);
      const chips = props.map((k) => `<span class="chip ${BOARD[k].type}" style="--g:${groupColor(k)}" title="${esc(BOARD[k].name)} — ${BOARD[k].type === 'property' ? LEVEL_LABELS[s.tiles[k].houses] : typeLabel(k)}">${s.tiles[k].houses ? `<i>${s.tiles[k].houses === E.HOTEL ? 'D' : s.tiles[k].houses}</i>` : ''}</span>`).join('');
      const meta = [p.inJail ? 'Île perdue' : BOARD[p.pos].name, p.jailCards ? `${p.jailCards} carte${p.jailCards > 1 ? 's' : ''} de sortie` : ''].filter(Boolean).join(' · ');
      card.innerHTML = `
        <div class="pc-tok">${p.token}</div>
        <div><div class="pc-name">${esc(p.name)}${i === app.myIdx ? '<span class="you">Vous</span>' : ''}${p.isBot ? `<span class="bot">${p.connected === false ? 'Bot (déco)' : 'Bot'}</span>` : ''}</div><div class="pc-meta">${p.bankrupt ? 'Faillite' : esc(meta)}</div></div>
        <div><div class="pc-cash">${fmt(p.cash)}</div><div class="pc-worth">Fortune ${fmt(E.netWorth(s, i))}</div></div>
        <div class="pc-coins" title="Or en caisse : une pièce d’or = 250 000, une pièce d’argent = 50 000">${coinStacks(p.cash)}</div>
        <div class="pc-props">${chips}</div>`;
      if (s.powers) {
        const inventory = document.createElement('div');
        inventory.className = 'player-powers';
        inventory.textContent = 'Pouvoirs : ' + (p.inventory.map(id => window.TT_CONFIG.POWERS[id].name).join(' · ') || 'aucun') + (p.insurance ? ' • protection loyer active' : '') + (p.buildDiscount ? ' • permis actif' : '');
        card.appendChild(inventory);
      }
      wrap.appendChild(card);
    });
  }

  function coinStacks(cash) {
    if (cash <= 0) return '<span class="empty">Caisse vide</span>';
    const gold = Math.min(40, Math.floor(cash / 250000));
    const silver = Math.min(4, Math.floor((cash % 250000) / 50000));
    let html = '';
    for (let k = 0; k < gold; k += 5) html += `<div class="stack">${'<span class="coin"></span>'.repeat(Math.min(5, gold - k))}</div>`;
    if (silver) html += `<div class="stack">${'<span class="coin silver"></span>'.repeat(silver)}</div>`;
    return html;
  }

  function renderTiles() {
    const s = app.state;
    const me = app.myIdx, myTurn = s.current === me && s.phase === 'playing';
    const step = s.turn.step;
    let highlights = null, sellMode = false;
    app.selectMode = null;
    if (myTurn && step === 'teleport') { highlights = new Set(E.teleportTargets(s, me)); app.selectMode = 'teleport'; }
    else if (myTurn && step === 'championship') { highlights = new Set(E.championshipTargets(s, me)); app.selectMode = 'championship'; }
    else if (myTurn && step === 'debt') { highlights = new Set(s.tiles.map((t, k) => (t && t.owner === me ? k : -1)).filter((k) => k >= 0)); sellMode = true; }
    $('board').querySelectorAll('.tile').forEach((el) => {
      const i = +el.dataset.i;
      const t = s.tiles[i];
      el.classList.toggle('auctioning', !!(s.auction && s.auction.tiles[s.auction.cursor] === i));
      if (t) {
        const owned = t.owner !== null;
        el.style.setProperty('--oc', owned ? s.players[t.owner].color : 'transparent');
        const golden = t.houses === E.HOTEL;
        el.classList.toggle('golden', golden);
        el.classList.toggle('owned', owned);
        const pin = el.querySelector('.owner-pin');
        if (pin) {
          pin.hidden = !owned;
          if (owned) {
            pin.style.setProperty('--oc', s.players[t.owner].color);
            pin.querySelector('.owner-bubble span').textContent = s.players[t.owner].token;
            pin.title = `Propriété de ${s.players[t.owner].name}`;
          }
        }
        const h = el.querySelector('.houses');
        if (h) h.innerHTML = golden
          ? '<span class="golden-mark" title="Serviteur doré">Doré</span>'
          : t.houses > 0 ? `<span class="tavern-mark" title="Taverne ${t.houses}">T${t.houses}</span>` : '';
        const pr = el.querySelector('.price');
        if (pr) { if (owned) { pr.textContent = 'Loyer ' + fmtShort(E.computeRent(s, i, 7)); pr.classList.add('rent'); } else { pr.textContent = fmt(E.landPrice(s, i)); pr.classList.remove('rent'); } }
      }
      let champ = el.querySelector('.champ');
      if (s.championship && s.championship.tile === i) { if (!champ) { champ = document.createElement('div'); champ.className = 'champ'; el.appendChild(champ); } champ.textContent = '🏆'; champ.title = `Championnats : loyer x${s.championship.mult}`; }
      else if (champ) champ.remove();
      const cursed = !!(s.anomaly && s.anomaly.cursedTiles.includes(i));
      el.classList.toggle('cursed', cursed);
      el.title = BOARD[i].name + (cursed ? ' — Maudite : terrain −25 %, loyers ×2' : '');
      let festival = el.querySelector('.festival');
      if (s.festivalTiles && s.festivalTiles.includes(i)) {
        if (!festival) { festival = document.createElement('div'); festival.className = 'festival'; el.appendChild(festival); }
        festival.textContent = '🎪'; festival.title = 'Festival : loyer x2';
      } else if (festival) festival.remove();
      el.classList.toggle('highlight', !!(highlights && highlights.has(i)));
      el.classList.toggle('sell', sellMode && !!(highlights && highlights.has(i)));
      el.classList.toggle('dimmed', !!(highlights && !highlights.has(i)));
    });
    const cn = $('champNote');
    if (s.championship) { cn.hidden = false; cn.textContent = `🏆 Championnats sur ${BOARD[s.championship.tile].name} — loyer x${s.championship.mult}`; } else cn.hidden = true;
  }

  function renderLog() {
    const s = app.state; const el = $('log');
    el.innerHTML = s.log.map((l) => `<div class="l ${l.k}">${esc(l.t)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }


  return { showGame, buildPawns, positionAllPawns, renderPlayers, renderTiles, renderLog };
}
