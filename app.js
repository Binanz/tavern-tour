/* ============================================================
   TAVERN TOUR — interface, animations, orchestration réseau
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.TT_CONFIG;
  const E = window.TT_ENGINE;
  const { Net, makeCode } = window.TT_NET;
  const { BOARD, GROUPS, RULES, TOKENS, BOT_NAMES } = CFG;
  const N = BOARD.length;
  const SAVE_KEY = 'tavern-tour-active-game-v1';
  const $ = (id) => document.getElementById(id);
  const fmt = E.fmt;
  const STEP_MS = 170;

  const app = {
    mode: null, net: null,
    me: { name: '', token: TOKENS[0] },
    myIdx: 0,
    lobby: null,
    state: null,
    botTimer: null, tickTimer: null, actionTimer: null,
    sync: { remainingMs: RULES.defaultDurationMin * 60000, at: Date.now() },
    muted: false,
    displayedPos: [], pawnQueue: [], pawnBusy: [],
    selectMode: null,
    boardBuilt: false,
    gameShown: false,
    lastLogLen: 0,
    lastSeen: {}, lastHostSeen: null,
    prevCash: null, prevCurrent: -1, prevTurnCount: 0, autoEndTimer: null,
    hostLostTimer: null, hostLostShown: false,
    clientPeerId: null,
  };
  const LEVEL_LABELS = ['Sans taverne', 'Taverne 1', 'Taverne 2', 'Taverne 3', 'Taverne 4', 'Serviteur doré'];

  // Battement de cœur : détecte les déconnexions que WebRTC ne signale pas vite.
  setInterval(() => {
    if (!app.net) return;
    const now = Date.now();
    if (app.mode === 'host') {
      app.net.broadcast({ type: 'ping' });
      for (const id of Object.keys(app.lastSeen)) {
        if (now - app.lastSeen[id] > 10000) { delete app.lastSeen[id]; app.net.kick(id); onPeerLeft(id); }
      }
    } else if (app.mode === 'client' && app.lastHostSeen && now - app.lastHostSeen > 12000) scheduleHostLost();
  }, 3000);

  // ============================================================
  // Sons (procéduraux, Web Audio)
  // ============================================================
  let actx = null;
  function audio() {
    if (app.muted) return null;
    try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { return null; }
    return actx;
  }
  function tone(freq, dur, type, vol, when) {
    const ctx = audio(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    const t0 = ctx.currentTime + (when || 0);
    g.gain.setValueAtTime(vol || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur);
  }
  const SFX = {
    step: () => tone(520, 0.05, 'triangle', 0.06),
    coin: () => { tone(1046, 0.12, 'sine', 0.12); tone(1568, 0.25, 'sine', 0.1, 0.07); },
    pay: () => { tone(330, 0.15, 'sawtooth', 0.06); tone(220, 0.25, 'sawtooth', 0.06, 0.1); },
    card: () => { tone(660, 0.08, 'triangle', 0.08); tone(880, 0.12, 'triangle', 0.08, 0.08); tone(1100, 0.2, 'triangle', 0.08, 0.16); },
    dice: () => {
      const ctx = audio(); if (!ctx) return;
      for (let i = 0; i < 6; i++) tone(200 + Math.random() * 400, 0.04, 'square', 0.04, i * 0.09);
    },
    bad: () => { tone(160, 0.3, 'sawtooth', 0.08); tone(120, 0.4, 'sawtooth', 0.08, 0.15); },
    win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.1, i * 0.12)); },
    // gain d'or : cascade de pièces ; perte : coup sourd + pièces qui tombent
    gain: (big) => { const n = big ? 6 : 3; for (let i = 0; i < n; i++) { tone(1200 + i * 180, 0.1, 'sine', 0.1, i * 0.06); tone(1800 + i * 200, 0.18, 'triangle', 0.05, i * 0.06 + 0.03); } },
    loss: (big) => { tone(110, 0.35, 'sawtooth', big ? 0.14 : 0.09); tone(80, 0.5, 'triangle', big ? 0.14 : 0.08, 0.05); for (let i = 0; i < (big ? 4 : 2); i++) tone(900 - i * 120, 0.08, 'square', 0.03, 0.25 + i * 0.07); },
    turn: () => { tone(660, 0.12, 'triangle', 0.12); tone(880, 0.14, 'triangle', 0.12, 0.12); tone(1320, 0.4, 'sine', 0.12, 0.24); },
    soft: () => tone(700, 0.08, 'sine', 0.04),
    land: () => { tone(300, 0.08, 'triangle', 0.08); tone(420, 0.12, 'triangle', 0.06, 0.04); },
  };

  // ============================================================
  // Utilitaires UI
  // ============================================================
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms || 2600);
  }
  function openModal(html, opts) {
    opts = opts || {};
    const m = $('modal'), c = $('modalCard');
    c.innerHTML = html + (opts.noClose ? '' : '<button class="btn small ghost close" data-close>✕</button>');
    m.hidden = false;
    m.onclick = (e) => { if (e.target === m && !opts.noClose) closeModal(); };
    c.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
    return c;
  }
  function closeModal() { $('modal').hidden = true; clearTimeout(openModal._auto); }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const groupColor = (i) => (BOARD[i].type === 'property' ? GROUPS[BOARD[i].group].color : BOARD[i].type === 'station' ? '#8b8b8b' : '#5c88a8');
  const typeLabel = (i) => (BOARD[i].type === 'property' ? GROUPS[BOARD[i].group].label : BOARD[i].type === 'station' ? 'Serviteur neutre' : 'Service');
  const ICONS = { start: '🍺', jail: '🏝️', championship: '🏆', worldtour: '🌀', tax: '💰', station: '🛡️', utility: '🔮', chance: '?' };
  const shortName = (i) => BOARD[i].short || BOARD[i].name;
  // format compact pour les cases : 540 k, 1,05 M
  const fmtShort = (n) => (n >= 1e6 ? (Math.round(n / 10000) / 100).toLocaleString('fr-FR') + ' M' : Math.round(n / 1000).toLocaleString('fr-FR') + ' k');

  // ---- effets visuels : nombres flottants, flashs ----
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

  // ============================================================
  // Accueil / lobby
  // ============================================================
  function initHome() {
    const picker = $('tokenPicker');
    TOKENS.forEach((tk, i) => {
      const b = document.createElement('button');
      b.className = 'token-btn'; b.type = 'button'; b.textContent = tk; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', TOKENS[i] === app.me.token ? 'true' : 'false');
      b.onclick = () => {
        app.me.token = tk;
        picker.querySelectorAll('.token-btn').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
        if (app.lobby && !app.lobby.started) $('lobbyProfileHint').textContent = '';
        SFX.step();
      };
      picker.appendChild(b);
    });
    const dsel = $('durationSelect');
    RULES.durationsMin.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = `${m} min`; if (m === RULES.defaultDurationMin) o.selected = true; dsel.appendChild(o); });
    dsel.onchange = () => { if (app.lobby) { app.lobby.durationMin = +dsel.value; broadcastLobby(); } };
    $('fillBots').onchange = () => { if (app.lobby) { app.lobby.fillBots = $('fillBots').checked; broadcastLobby(); } };

    $('btnHost').onclick = hostGame;
    $('btnJoin').onclick = joinGame;
    $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
    $('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('btnLocal').onclick = localGame;
    $('btnStart').onclick = startGame;
    $('btnLeaveLobby').onclick = leaveLobby;
    $('btnSaveLobbyProfile').onclick = saveLobbyProfile;
    $('nameInput').addEventListener('input', () => { if (app.lobby && !app.lobby.started) $('lobbyProfileHint').textContent = ''; });
    $('btnCopy').onclick = copyCode;
    $('btnRules').onclick = showRules;
    $('brandHome').onclick = returnHome;
    $('btnMute').onclick = () => { app.muted = !app.muted; $('btnMute').setAttribute('aria-pressed', String(app.muted)); if (!app.muted) SFX.coin(); };
    $('btnResume').onclick = resumeSavedGame;
    $('btnDiscardResume').onclick = () => { clearSavedSession(); $('resumePanel').hidden = true; };
    $('btnImportContent').onclick = () => $('contentFile').click();
    $('contentFile').onchange = async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const content = JSON.parse(await file.text());
        CFG.applyContent(content);
        localStorage.setItem('tavern-tour-content-v1', JSON.stringify(content));
        location.reload();
      } catch (error) {
        console.error('Impossible d’importer le fichier de contenu.', error);
        toast(`Import impossible : ${error.message || 'fichier invalide'}`);
      } finally {
        event.target.value = '';
      }
    };
    const saved = readSavedSession();
    if (saved) {
      $('resumePanel').hidden = false;
      $('resumeHint').textContent = saved.mode === 'client'
        ? `Partie en ligne ${saved.lobby && saved.lobby.code ? `(${saved.lobby.code})` : ''} sauvegardée sur cet appareil.`
        : 'Une partie sauvegardée est disponible sur cet appareil.';
    }
    window.addEventListener('resize', () => { if (app.state) positionAllPawns(); });
    window.addEventListener('beforeunload', saveSession);
  }

  function readSavedSession() {
    let raw;
    try { raw = localStorage.getItem(SAVE_KEY); }
    catch (error) { console.error('Impossible de lire la sauvegarde de la partie.', error); return null; }
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw);
      if (!saved || !['local', 'host', 'client'].includes(saved.mode) || !saved.state || !Array.isArray(saved.state.players) || saved.state.phase !== 'playing') {
        throw new Error('format de sauvegarde invalide');
      }
      if (!Number.isInteger(saved.myIdx) || saved.myIdx < 0 || saved.myIdx >= saved.state.players.length) throw new Error('index de joueur invalide');
      if (saved.mode !== 'local' && (!saved.lobby || !saved.lobby.code)) throw new Error('code de salle manquant');
      if (saved.mode === 'client' && !saved.peerId) throw new Error('identifiant de reconnexion manquant');
      return saved;
    } catch (error) {
      console.error('La sauvegarde de partie est invalide.', error);
      clearSavedSession();
      return null;
    }
  }
  function saveSession() {
    if (!app.state || app.state.phase !== 'playing') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        mode: app.mode, state: app.state, lobby: app.lobby, myIdx: app.myIdx,
        me: app.me, peerId: app.net && app.net.peer ? app.net.peer.id : app.clientPeerId,
      }));
    } catch (error) {
      console.error('Impossible de sauvegarder la partie.', error);
      if (!document.hidden) toast('La sauvegarde automatique a échoué.');
    }
  }
  function clearSavedSession() {
    try { localStorage.removeItem(SAVE_KEY); }
    catch (error) { console.error('Impossible de supprimer la sauvegarde de partie.', error); }
  }
  function shuffledBotNames(excluded, count) {
    const used = new Set(excluded.map((name) => name.toLocaleLowerCase()));
    const available = BOT_NAMES.filter((name) => !used.has(name.toLocaleLowerCase()));
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }
    return available.slice(0, count);
  }
  function resumeSavedGame() {
    const saved = readSavedSession();
    if (!saved) { $('resumePanel').hidden = true; toast('Aucune sauvegarde de partie valide.'); return; }
    app.me = saved.me || app.me;
    $('nameInput').value = app.me.name || '';
    $('tokenPicker').querySelectorAll('.token-btn').forEach((button, i) => button.setAttribute('aria-checked', String(TOKENS[i] === app.me.token)));
    app.mode = saved.mode;
    app.lobby = saved.lobby || null;
    app.state = saved.state;
    app.state.events = [];
    app.myIdx = Number.isInteger(saved.myIdx) ? saved.myIdx : 0;
    app.clientPeerId = saved.peerId || null;
    app.gameShown = false;
    app.displayedPos = app.state.players.map((player) => player.pos);
    app.pawnQueue = app.state.players.map(() => []);
    app.pawnBusy = app.state.players.map(() => false);
    app.prevCash = null; app.prevCurrent = -1; app.prevTurnCount = 0;
    app.lastSeen = {}; app.hostLostShown = false;
    clearInterval(app.tickTimer);
    clearTimeout(app.botTimer); clearTimeout(app.actionTimer); clearTimeout(app.autoEndTimer);
    $('resumePanel').hidden = true;

    if (app.mode === 'client') {
      joinGame(saved);
      return;
    }
    if (app.mode === 'host') {
      if (!app.lobby || !app.lobby.code) { toast('La sauvegarde de l’hôte ne contient pas de code de salle.'); return; }
      app.lobby.started = true;
      app.net = new Net({
        onReady: () => { setNetStatus(''); resumeRunningGame(); },
        onLeave: (id) => onPeerLeft(id),
        onMessage: (from, msg) => hostOnMessage(from, msg),
        onError: (msg) => {
          setNetStatus(msg, true);
          if (app.net) app.net.destroy();
          app.net = null; app.mode = null;
          $('resumePanel').hidden = false;
        },
      });
      try { app.net.host(app.lobby.code); }
      catch (error) { setNetStatus(error.message, true); app.net = null; app.mode = null; $('resumePanel').hidden = false; }
      return;
    }
    resumeRunningGame();
  }
  function resumeRunningGame() {
    $('brandHome').disabled = true;
    document.querySelector('.topbar').classList.remove('game-ended');
    app.state.events = [];
    app.state.turnEndsAt = app.state.turnEndsAt || Date.now() + RULES.turnDurationMs;
    app.sync = {
      remainingMs: app.state.remainingMs,
      turnRemainingMs: Math.max(0, app.state.turnEndsAt - Date.now()),
      at: Date.now(),
    };
    app.tickTimer = setInterval(hostTick, 1000);
    afterChange();
  }

  function readMe() {
    const n = $('nameInput').value.trim();
    app.me.name = n || 'Aventurier';
    return app.me;
  }
  function setNetStatus(msg, isError) {
    const el = $('netStatus'); el.hidden = !msg; el.textContent = msg || ''; el.style.color = isError ? '#ffb3a7' : 'var(--cream-dim)';
  }

  function hostGame() {
    readMe();
    setNetStatus('Création de la salle…');
    $('btnHost').disabled = true;
    const code = makeCode(5);
    app.mode = 'host';
    app.lobby = { code, players: [{ name: app.me.name, token: app.me.token, isBot: false, peerId: 'host' }], durationMin: +$('durationSelect').value, fillBots: $('fillBots').checked, started: false };
    app.myIdx = 0;
    app.net = new Net({
      onReady: () => { setNetStatus(''); showLobby(); },
      onJoin: () => {},
      onLeave: (id) => onPeerLeft(id),
      onMessage: (from, msg) => hostOnMessage(from, msg),
      onError: (msg) => { setNetStatus(msg, true); $('btnHost').disabled = false; if (!app.lobby || !app.lobby.started) { /* reste à l'accueil */ } },
    });
    try { app.net.host(code); } catch (e) { setNetStatus(e.message, true); $('btnHost').disabled = false; app.mode = null; }
  }

  function joinGame(options) {
    const resume = !!options;
    const code = resume ? String(options.code || '').trim().toUpperCase() : $('joinCode').value.trim().toUpperCase();
    const resumePeerId = resume ? options.peerId || null : null;
    readMe();
    if (code.length < 4) { toast('Entrez le code de la salle.'); return; }
    setNetStatus('Connexion à la salle ' + code + '…');
    $('btnJoin').disabled = true;
    app.mode = 'client';
    app.net = new Net({
      onReady: () => {
        app.lastHostSeen = Date.now();
        app.clientPeerId = app.net.peer.id;
        if (resume) {
          try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...options, peerId: app.clientPeerId })); }
          catch (error) { console.error('Impossible de mettre à jour la sauvegarde de partie.', error); }
        }
        setNetStatus('Connecté, en attente de l’hôte…');
        app.net.sendHost({ type: 'hello', name: app.me.name, token: app.me.token });
      },
      onMessage: (from, msg) => clientOnMessage(msg),
      onHostLost: () => scheduleHostLost(),
      onError: (msg) => {
        setNetStatus(msg, true); $('btnJoin').disabled = false;
        app.net && app.net.destroy(); app.net = null; app.mode = null;
        if (resume) $('resumePanel').hidden = false;
      },
    });
    try { app.net.join(code, resumePeerId); }
    catch (e) {
      setNetStatus(e.message, true); $('btnJoin').disabled = false; app.mode = null;
      if (resume) { app.net = null; $('resumePanel').hidden = false; }
    }
  }

  function localGame() {
    readMe();
    const nb = +$('localBots').value;
    app.mode = 'local';
    app.myIdx = 0;
    const players = [{ name: app.me.name, token: app.me.token, isBot: false }];
    const botNames = shuffledBotNames([app.me.name], nb);
    const freeTokens = TOKENS.filter((t) => t !== app.me.token);
    for (let i = 0; i < nb; i++) players.push({ name: botNames[i], token: freeTokens[i], isBot: true });
    app.lobby = { code: null, players, durationMin: +$('durationSelect').value, fillBots: false, started: true };
    launch(players, app.lobby.durationMin);
  }

  function showLobby() {
    $('modesPanel').hidden = true;
    $('lobbyPanel').hidden = false;
    $('btnSaveLobbyProfile').hidden = false;
    renderLobby();
  }
  function renderLobby() {
    const L = app.lobby; if (!L) return;
    const isHost = app.mode === 'host';
    $('roomCode').textContent = L.code || '—';
    $('lobbyHint').textContent = isHost ? 'Partagez ce code à vos amis (4 joueurs max).' : 'Vous êtes connecté. L’hôte lancera la partie.';
    $('lobbyOptions').hidden = !isHost;
    $('btnStart').hidden = !isHost;
    $('waitHost').hidden = isHost;
    $('durationSelect').value = L.durationMin;
    $('fillBots').checked = L.fillBots;
    renderLobbyProfile();
    const ul = $('seats'); ul.innerHTML = '';
    for (let i = 0; i < RULES.maxPlayers; i++) {
      const p = L.players[i];
      const li = document.createElement('li');
      if (p) {
        li.className = 'seat' + (i === app.myIdx ? ' me' : '');
        li.innerHTML = `<span class="tok">${p.token}</span><span class="who">${esc(p.name)}</span><span class="tag">${p.isBot ? 'Bot' : i === 0 ? 'Hôte' : 'Joueur'}</span>`;
      } else {
        li.className = 'seat empty';
        li.innerHTML = `<span class="tok">·</span><span class="who muted">Place libre</span><span class="tag">${L.fillBots ? 'Bot au lancement' : 'Vide'}</span>`;
      }
      ul.appendChild(li);
    }
    $('btnStart').disabled = !(L.players.length >= 2 || L.fillBots);
  }
  function renderLobbyProfile() {
    const L = app.lobby; const player = L && L.players[app.myIdx];
    if (!player) return;
    const nameInput = $('nameInput');
    if (document.activeElement !== nameInput) nameInput.value = player.name;
    const picker = $('tokenPicker');
    picker.querySelectorAll('.token-btn').forEach((b, i) => {
      const token = TOKENS[i];
      b.disabled = L.players.some((p, i) => i !== app.myIdx && p.token === token);
      b.setAttribute('aria-checked', String(token === app.me.token));
    });
  }
  function saveLobbyProfile() {
    if (!app.lobby || app.lobby.started) return;
    const name = $('nameInput').value;
    if (app.mode === 'host') {
      applyLobbyProfile(app.myIdx, name, app.me.token);
      broadcastLobby();
      $('lobbyProfileHint').textContent = 'Profil enregistré.';
    } else if (app.mode === 'client' && app.net) {
      app.net.sendHost({ type: 'profile', name, token: app.me.token });
      $('lobbyProfileHint').textContent = 'Mise à jour envoyée…';
    }
  }
  function applyLobbyProfile(idx, requestedName, requestedToken) {
    const L = app.lobby; const player = L && L.players[idx];
    if (!player) return;
    let name = String(requestedName || '').trim().slice(0, 16) || 'Aventurier';
    if (L.players.some((p, i) => i !== idx && p.name.toLowerCase() === name.toLowerCase())) {
      const base = name.slice(0, 13);
      let suffix = 2;
      while (L.players.some((p, i) => i !== idx && p.name.toLowerCase() === `${base} ${suffix}`.toLowerCase())) suffix++;
      name = `${base} ${suffix}`;
    }
    const tokenTaken = L.players.some((p, i) => i !== idx && p.token === requestedToken);
    player.name = name;
    if (TOKENS.includes(requestedToken) && !tokenTaken) player.token = requestedToken;
    if (idx === app.myIdx) {
      app.me.name = player.name;
      app.me.token = player.token;
    }
  }
  function broadcastLobby() {
    renderLobby();
    if (app.mode !== 'host' || !app.net) return;
    app.lobby.players.forEach((p, i) => { if (p.peerId && p.peerId !== 'host') app.net.sendTo(p.peerId, { type: 'lobby', lobby: publicLobby(), yourIdx: i }); });
  }
  const publicLobby = () => ({ code: app.lobby.code, players: app.lobby.players.map((p) => ({ name: p.name, token: p.token, isBot: p.isBot })), durationMin: app.lobby.durationMin, fillBots: app.lobby.fillBots, started: app.lobby.started });

  function leaveLobby() {
    clearTimeout(app.hostLostTimer); app.hostLostTimer = null;
    if (app.net) app.net.destroy();
    app.net = null; app.mode = null; app.lobby = null;
    $('btnSaveLobbyProfile').hidden = true;
    $('lobbyProfileHint').textContent = '';
    $('tokenPicker').querySelectorAll('.token-btn').forEach((button) => { button.disabled = false; });
    $('lobbyPanel').hidden = true; $('modesPanel').hidden = false; $('btnHost').disabled = false; $('btnJoin').disabled = false; setNetStatus('');
  }
  function copyCode() {
    const code = app.lobby && app.lobby.code; if (!code) return;
    const done = () => toast('Code copié : ' + code);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => toast('Code : ' + code));
    else toast('Code : ' + code);
  }

  // --- messages côté hôte ---
  function hostOnMessage(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    app.lastSeen[from] = Date.now();
    if (msg.type === 'pong') return;
    if (msg.type === 'hello') {
      const L = app.lobby;
      const existing = L.players.findIndex((p) => p.peerId === from);
      if (existing >= 0) {
        if (L.started && app.state) {
          const player = app.state.players[existing];
          if (player) {
            const wasBot = player.isBot;
            player.isBot = false;
            player.connected = true;
            L.players[existing].isBot = false;
            app.lastSeen[from] = Date.now();
            if (wasBot) app.state.log.push({ t: `${player.name} est de retour dans la partie.`, k: 'info', n: app.state.turnCount });
            afterChange();
          } else app.net.sendTo(from, { type: 'rejected', reason: 'Impossible de restaurer votre place dans cette partie.' });
        } else app.net.sendTo(from, { type: 'lobby', lobby: publicLobby(), yourIdx: existing });
        return;
      }
      if (L.started) { app.net.sendTo(from, { type: 'rejected', reason: 'La partie a déjà commencé.' }); return; }
      if (L.players.length >= RULES.maxPlayers) { app.net.sendTo(from, { type: 'rejected', reason: 'La salle est pleine (4 joueurs).' }); return; }
      let name = String(msg.name || 'Invité').slice(0, 16);
      if (L.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name += ' ' + (L.players.length + 1);
      let token = TOKENS.includes(msg.token) ? msg.token : TOKENS[L.players.length];
      if (L.players.some((p) => p.token === token)) token = TOKENS.find((t) => !L.players.some((p) => p.token === t)) || token;
      L.players.push({ name, token, isBot: false, peerId: from });
      broadcastLobby();
      SFX.coin();
      return;
    }
    if (msg.type === 'profile' && app.lobby && !app.lobby.started) {
      const idx = app.lobby.players.findIndex((p) => p.peerId === from);
      if (idx > 0) {
        applyLobbyProfile(idx, msg.name, msg.token);
        broadcastLobby();
      }
      return;
    }
    if (msg.type === 'action' && app.state) {
      const idx = app.state.players.findIndex((p) => p.peerId === from);
      if (idx < 0) return;
      dispatch(idx, msg.action, from);
    }
  }
  function onPeerLeft(id) {
    delete app.lastSeen[id];
    if (!app.lobby) return;
    if (!app.lobby.started) {
      const i = app.lobby.players.findIndex((p) => p.peerId === id);
      if (i > 0) { app.lobby.players.splice(i, 1); broadcastLobby(); toast('Un joueur a quitté la salle.'); }
      return;
    }
    if (app.state) {
      const i = app.state.players.findIndex((p) => p.peerId === id);
      if (i >= 0 && !app.state.players[i].isBot) {
        app.state.players[i].isBot = true; app.state.players[i].connected = false;
        app.state.log.push({ t: `${app.state.players[i].name} s’est déconnecté : un bot prend le relais.`, k: 'warn', n: app.state.turnCount });
        app.state.events = [];
        afterChange();
      }
    }
  }

  // --- messages côté invité ---
  function clientOnMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    clearTimeout(app.hostLostTimer); app.hostLostTimer = null;
    app.lastHostSeen = Date.now();
    if (msg.type === 'ping') { app.net.sendHost({ type: 'pong' }); return; }
    switch (msg.type) {
      case 'lobby':
        app.lobby = msg.lobby; app.myIdx = msg.yourIdx; setNetStatus('');
        app.me.name = app.lobby.players[app.myIdx].name;
        app.me.token = app.lobby.players[app.myIdx].token;
        $('lobbyProfileHint').textContent = 'Profil enregistré.';
        if (!app.gameShown) showLobby();
        break;
      case 'state':
        app.state = msg.state; app.myIdx = app.state.players.findIndex((p) => p.peerId === app.net.peer.id);
        if (app.myIdx < 0) app.myIdx = msg.yourIdx != null ? msg.yourIdx : 0;
        if (app.state.phase === 'playing') saveSession();
        else clearSavedSession();
        onState();
        break;
      case 'error': toast(msg.msg); SFX.bad(); break;
      case 'rejected':
        setNetStatus(msg.reason, true); $('btnJoin').disabled = false; app.net.destroy(); app.net = null; app.mode = null;
        if (app.state && !app.gameShown) $('resumePanel').hidden = false;
        break;
    }
  }
  function scheduleHostLost() {
    if (app.hostLostShown || app.hostLostTimer || app.mode !== 'client') return;
    const lastSeen = app.lastHostSeen;
    app.hostLostTimer = setTimeout(() => {
      app.hostLostTimer = null;
      if (app.mode === 'client' && app.net && app.lastHostSeen === lastSeen) hostLost();
    }, 20000);
  }
  function hostLost() {
    if (app.hostLostShown) return;
    app.hostLostShown = true;
    openModal(`<h2>Connexion perdue</h2><p>L’hôte a quitté la partie ou la connexion a été coupée. Votre sauvegarde reste disponible sur cet appareil. Vous pourrez reprendre la partie si l’hôte revient.</p><div class="btn-row"><button class="btn primary" onclick="location.reload()">Retour à l’accueil</button></div>`, { noClose: true });
  }

  // ============================================================
  // Lancement et boucle de jeu (hôte / local)
  // ============================================================
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
    L.started = true;
    launch(players, L.durationMin);
  }

  function launch(players, durationMin) {
    $('brandHome').disabled = true;
    document.querySelector('.topbar').classList.remove('game-ended');
    app.state = E.createGame(players, { durationMin });
    app.state.players.forEach((p, i) => { if (players[i].peerId) p.peerId = players[i].peerId; });
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
    else {     app.sync = {
      remainingMs: app.state.remainingMs,
      turnRemainingMs: Math.max(0, app.state.turnEndsAt - Date.now()),
      at: Date.now(),
    }; }
  }

  function dispatch(idx, action, from) {
    const res = E.apply(app.state, idx, action, Math.random, Date.now());
    if (!res.ok) {
      if (from === 'me') { toast(res.error); SFX.bad(); }
      else if (from) app.net.sendTo(from, { type: 'error', msg: res.error });
      return;
    }
    afterChange();
  }

  function afterChange() {
    const s = app.state;
    s.remainingMs = s.ordering ? s.durationMs : Math.max(0, s.endsAt - Date.now());
    if (!s.ordering && s.turnEndsAt == null) s.turnEndsAt = Date.now() + RULES.turnDurationMs;
    if (s.phase === 'playing') saveSession();
    else clearSavedSession();
    if (app.mode === 'host' && app.net) {
      s.players.forEach((p, i) => { if (p.peerId && p.peerId !== 'host') app.net.sendTo(p.peerId, { type: 'state', state: s, yourIdx: i }); });
    }
    onState();
    scheduleBot();
    scheduleAutoEnd();
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
    const base = { orderRoll: 1300, roll: 1300, jailRoll: 1300, endTurn: 1100, sell: 800, buy: 1200, build: 1200 }[a.type] || 1000;
    app.botTimer = setTimeout(() => dispatch(s.current, a, null), base + app.animDelay);
  }

  function act(action) {
    if (!app.state) return;
    if (app.mode === 'client') app.net.sendHost({ type: 'action', action });
    else dispatch(app.myIdx, action, 'me');
  }

  // ============================================================
  // Rendu
  // ============================================================
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
    if (i <= 10) return { col: 11 - i, row: 11, side: 'bottom' };
    if (i <= 20) return { col: 1, row: 11 - (i - 10), side: 'left' };
    if (i <= 30) return { col: 1 + (i - 20), row: 1, side: 'top' };
    return { col: 11, row: 1 + (i - 30), side: 'right' };
  }

  const OWNABLE_TYPES = new Set(['property', 'station', 'utility']);
  function buildBoard() {
    if (app.boardBuilt) return;
    app.boardBuilt = true;
    const board = $('board');
    for (let i = 0; i < N; i++) {
      const b = BOARD[i];
      const g = gridPos(i);
      const el = document.createElement('div');
      const corner = i % 10 === 0;
      el.className = `tile side-${g.side} type-${b.type}${corner ? ' corner' : ''}`;
      el.style.gridColumn = g.col; el.style.gridRow = g.row;
      el.dataset.i = i;
      if (b.type === 'property') el.style.setProperty('--g', GROUPS[b.group].color);
      let body = '';
      if (b.type === 'property') body = `<div class="band"></div><div class="body"><div class="name">${esc(shortName(i))}</div><div class="houses"></div><div class="price">${fmt(b.price)}</div></div>`;
      else if (b.type === 'station' || b.type === 'utility') body = `<div class="body"><div class="ico">${ICONS[b.type]}</div><div class="name">${esc(shortName(i))}</div><div class="price">${fmt(b.price)}</div></div>`;
      else if (b.type === 'chance') body = `<div class="body"><div class="ico">?</div><div class="name">Chance</div></div>`;
      else if (b.type === 'tax') body = `<div class="body"><div class="ico">${ICONS.tax}</div><div class="name">${esc(b.name)}</div><div class="price">${fmt(b.amount)}</div></div>`;
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
    for (const ev of s.events || []) {
      if (ev.type === 'dice') { animateDice(ev.dice); delay += 650; }
      if (ev.type === 'move') {
        setTimeout(() => enqueueMove(ev), delay);
        delay += ev.teleport || ev.steps === undefined ? 450 : ev.steps * STEP_MS + 250;
      }
      if (ev.type === 'card') { setTimeout(() => showChanceCard(ev.text), delay); delay += 2600; }
      if (ev.type === 'salary') { const amt = ev.amount, pl = ev.player; setTimeout(() => { showMoneyDelta(pl, amt); flashTile(0, 'good'); }, Math.max(0, delay - 200)); }
      if (ev.type === 'pay') { const e2 = ev; setTimeout(() => { if (typeof e2.to === 'number' && s.players[e2.to]) flashTile(s.players[e2.from].pos, 'bad'); }, delay); }
      if (ev.type === 'buy' || ev.type === 'build') { const tl = ev.tile; setTimeout(() => flashTile(tl, 'good'), delay); }
      if (ev.type === 'buyout') { const tl = ev.tile; setTimeout(() => { flashTile(tl, 'good'); SFX.card(); }, delay); }
      if (ev.type === 'jail' || ev.type === 'bankrupt') setTimeout(SFX.bad, delay);
      if (ev.type === 'gameover') setTimeout(() => { showEnd(); SFX.win(); }, delay + 300);
    }
    return delay;
  }

  function onState() {
    const s = app.state; if (!s) return;
    showGame();
    if (app.displayedPos.length !== s.players.length) { app.displayedPos = s.players.map((p) => p.pos); app.pawnQueue = s.players.map(() => []); app.pawnBusy = s.players.map(() => false); buildPawns(); }
    if (!s.ordering && s.turnEndsAt == null) s.turnEndsAt = Date.now() + RULES.turnDurationMs;
    app.sync = {
      remainingMs: s.remainingMs,
      turnRemainingMs: s.ordering ? RULES.turnDurationMs : Math.max(0, s.turnEndsAt - Date.now()),
      at: Date.now(),
    };
    app.animDelay = processEvents(s);
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
    renderPlayers(); renderTiles(); renderLog(); renderTimer();
    clearTimeout(app.actionTimer);
    renderActions(true);
    app.actionTimer = setTimeout(() => renderActions(false), app.animDelay);
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
  setInterval(() => { if (app.state) renderTimer(); }, 250);

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
      const chips = props.map((k) => `<span class="chip ${BOARD[k].type}" style="--g:${groupColor(k)}" title="${esc(BOARD[k].name)} — ${LEVEL_LABELS[s.tiles[k].houses]}">${s.tiles[k].houses ? `<i>${s.tiles[k].houses === E.HOTEL ? 'D' : s.tiles[k].houses}</i>` : ''}</span>`).join('');
      const meta = [p.inJail ? 'Île perdue' : BOARD[p.pos].name, p.jailCards ? `${p.jailCards} carte${p.jailCards > 1 ? 's' : ''} de sortie` : ''].filter(Boolean).join(' · ');
      card.innerHTML = `
        <div class="pc-tok">${p.token}</div>
        <div><div class="pc-name">${esc(p.name)}${i === app.myIdx ? '<span class="you">Vous</span>' : ''}${p.isBot ? `<span class="bot">${p.connected === false ? 'Bot (déco)' : 'Bot'}</span>` : ''}</div><div class="pc-meta">${p.bankrupt ? 'Faillite' : esc(meta)}</div></div>
        <div><div class="pc-cash">${fmt(p.cash)}</div><div class="pc-worth">Fortune ${fmt(E.netWorth(s, i))}</div></div>
        <div class="pc-coins" title="Or en caisse : une pièce d’or = 250 000, une pièce d’argent = 50 000">${coinStacks(p.cash)}</div>
        <div class="pc-props">${chips}</div>`;
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
        if (pr) { if (owned) { pr.textContent = 'Loyer ' + fmtShort(E.computeRent(s, i, 7)); pr.classList.add('rent'); } else { pr.textContent = fmt(BOARD[i].price); pr.classList.remove('rent'); } }
      }
      let champ = el.querySelector('.champ');
      if (s.championship && s.championship.tile === i) { if (!champ) { champ = document.createElement('div'); champ.className = 'champ'; el.appendChild(champ); } champ.textContent = '🏆'; champ.title = `Championnats : loyer x${s.championship.mult}`; }
      else if (champ) champ.remove();
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

  function offerCardHTML(i, extra) {
    const b = BOARD[i]; const t = app.state.tiles[i];
    let rentLine = '';
    if (b.type === 'property') rentLine = `Loyer actuel ${fmt(E.computeRent({ ...app.state, tiles: app.state.tiles.map((x, k) => (k === i ? { owner: t.owner === null ? app.myIdx : t.owner, houses: t.houses } : x)) }, i, 7))}${t.owner !== null ? ` · ${LEVEL_LABELS[t.houses]}` : ''}`;
    else if (b.type === 'station') rentLine = `Loyer ${fmt(RULES.stationRents[0])} → ${fmt(RULES.stationRents[3])} selon le nombre de serviteurs neutres`;
    else rentLine = `Loyer = dés x ${fmt(RULES.utilityMult[0])} (x ${fmt(RULES.utilityMult[1])} avec les deux)`;
    return `<div class="offer-card" style="--g:${groupColor(i)}"><div class="oc-band">${esc(b.name)}</div><div class="oc-body"><div class="oc-type">${typeLabel(i)}</div><div class="oc-price">${fmt(b.price)}</div><div class="oc-rent">${rentLine}</div>${extra || ''}</div></div>`;
  }

  function payNoteHTML(s, lp) {
    if (!lp) return '';
    const me = app.myIdx;
    const from = s.players[lp.from]; const to = typeof lp.to === 'number' ? s.players[lp.to] : null;
    const toName = to ? to.name : lp.to === 'split' ? 'les autres joueurs' : 'la banque';
    if (lp.from === me) return `<div class="pay-note">Vous payez ${fmt(lp.amount)} à ${esc(toName)}<small>${esc(lp.reason)}</small></div>`;
    if (to && lp.to === me) return `<div class="pay-note gain">${esc(from.name)} vous paie ${fmt(lp.amount)}<small>${esc(lp.reason)}</small></div>`;
    return `<div class="pay-note" style="color:var(--cream)">${esc(from.name)} paie ${fmt(lp.amount)} à ${esc(toName)}<small>${esc(lp.reason)}</small></div>`;
  }
  function levelButtons(opts, i, kind) {
    const b = BOARD[i];
    return `<div class="levels">${opts.map((o) => {
      const name = o.houses === 0 ? 'Achat' : LEVEL_LABELS[o.houses];
      const pips = o.houses === E.HOTEL ? '<i class="gold"></i>' : '<i></i>'.repeat(o.houses);
      const rentNow = b.type === 'property' ? b.rents[o.houses] : null;
      const hint = o.locked ? 'Après un passage par la Taverne' : !o.affordable ? 'Pas assez d’or' : rentNow !== null ? `Loyer ${fmt(rentNow)}${o.houses === E.HOTEL ? ' · imprenable' : ''}` : '';
      return `<button class="lvl${o.locked ? ' locked' : ''}" data-houses="${o.houses}" ${o.locked || !o.affordable ? 'disabled' : ''} title="${hint}"><span class="lv-name">${name}</span><span class="lv-houses">${pips}</span><span class="lv-cost">${fmt(o.cost)}</span><span class="lv-rent">${hint}</span></button>`;
    }).join('')}</div>`;
  }

  function renderActions(pending) {
    const s = app.state; const el = $('actions'); const banner = $('turnBanner');
    const me = app.myIdx; const p = s.players[s.current]; const t = s.turn;
    const meP = s.players[me];
    const myTurn = s.current === me && s.phase === 'playing';
    if (s.phase === 'ended') { banner.innerHTML = 'Partie terminée'; banner.classList.remove('mine'); el.innerHTML = `<div class="btn-row"><button class="btn primary" id="btnShowEnd">Voir le classement</button></div>`; $('btnShowEnd').onclick = showEnd; return; }
    if (s.ordering) {
      banner.innerHTML = `Définition de l’ordre · manche ${s.ordering.round}`;
      banner.classList.toggle('mine', myTurn);
      const results = s.players.map((player, i) => {
        const roll = s.ordering.rolls[i];
        const score = roll ? `${roll.dice[0]} + ${roll.dice[1]} <b>= ${roll.total}</b>` : 'À lancer';
        return `<div class="order-result${s.current === i ? ' rolling' : ''}"><span>${player.token} ${esc(player.name)}</span><span>${score}</span></div>`;
      }).join('');
      const prompt = pending
        ? `<div class="prompt muted">${esc(p.name)} lance les dés…</div>`
        : myTurn
          ? `<div class="prompt">Lancez les dés pour déterminer l’ordre de passage.<small>En cas d’égalité, les joueurs concernés relancent.</small></div><button class="btn primary big" data-act="orderRoll">🎲 Lancer les dés</button>`
          : `<div class="prompt muted">${esc(p.name)}${p.isBot ? ' (bot)' : ''} lance les dés…</div>`;
      el.innerHTML = `<div class="order-results">${results}</div>${prompt}`;
      el.querySelectorAll('[data-act]').forEach((button) => (button.onclick = () => { act({ type: button.dataset.act }); }));
      return;
    }
    if (s.auction) {
      const auction = s.auction;
      const tile = auction.tiles[auction.cursor];
      const bidder = s.players[auction.current];
      banner.innerHTML = `${myTurn ? 'Enchères : à vous, ' : 'Enchères : '}<b>${esc(bidder.name)}</b>`;
      banner.classList.toggle('mine', myTurn);
      if (!myTurn) {
        el.innerHTML = `<div class="offer-card" style="--g:${groupColor(tile)}"><div class="oc-band">${esc(BOARD[tile].name)}</div><div class="oc-body"><div class="oc-type">${BOARD[tile].type === 'property' ? LEVEL_LABELS[s.tiles[tile].houses] : typeLabel(tile)}</div><div class="oc-price">Investissement : ${fmt(E.tileValue(s, tile))}</div><div class="oc-rent">Enchère actuelle : ${auction.highestBid ? fmt(auction.highestBid) + ' · ' + esc(s.players[auction.highestBidder].name) : 'aucune'}</div></div></div>
          <div class="prompt muted">${esc(bidder.name)} propose une enchère ou passe…</div>`;
        return;
      }
      if (pending) { el.innerHTML = '<div class="prompt muted">…</div>'; return; }
      const minimum = auction.highestBidder === null ? RULES.auctionMinBid : auction.highestBid + RULES.auctionMinBid;
      const suggested = Math.min(meP.cash, minimum);
      el.innerHTML = `<div class="offer-card" style="--g:${groupColor(tile)}"><div class="oc-band">${esc(BOARD[tile].name)}</div><div class="oc-body"><div class="oc-type">${BOARD[tile].type === 'property' ? LEVEL_LABELS[s.tiles[tile].houses] : typeLabel(tile)}</div><div class="oc-price">Investissement total : ${fmt(E.tileValue(s, tile))}</div><div class="oc-rent">Enchère actuelle : ${auction.highestBid ? fmt(auction.highestBid) + ' · ' + esc(s.players[auction.highestBidder].name) : 'aucune'}</div></div></div>
        <div class="prompt">Vous pouvez enchérir pour cette case et ses niveaux ou passer.<small>Enchère minimale : ${fmt(minimum)}. Le meilleur enchérisseur paie son offre.</small></div>
        <div class="auction-actions"><label class="field"><span>Votre enchère</span><input id="auctionBidAmount" type="number" min="${minimum}" max="${meP.cash}" step="${RULES.auctionMinBid}" value="${suggested >= minimum ? suggested : minimum}" ${meP.cash < minimum ? 'disabled' : ''} /></label>
        <button class="btn primary" id="btnAuctionBid" ${meP.cash < minimum ? 'disabled' : ''}>Enchérir</button><button class="btn" data-act="auctionPass">Passer</button></div>`;
      const input = $('auctionBidAmount');
      const bidButton = $('btnAuctionBid');
      if (bidButton) bidButton.onclick = () => {
        const amount = input.valueAsNumber;
        if (!Number.isSafeInteger(amount) || amount > meP.cash) { toast('Entrez une enchère entière que vous pouvez payer.'); return; }
        act({ type: 'auctionBid', amount });
      };
      el.querySelectorAll('[data-act]').forEach((button) => (button.onclick = () => act({ type: button.dataset.act })));
      return;
    }
    banner.innerHTML = myTurn ? `À vous de jouer, <b>${esc(p.name)}</b>` : `Au tour de <b>${esc(p.name)}</b>${p.isBot ? ' (bot)' : ''}`;
    banner.classList.toggle('mine', myTurn);
    if (pending) { el.innerHTML = `<div class="prompt muted">…</div>`; return; }
    const lastPay = t.lastPay && (['done', 'buyout', 'debt'].includes(t.step) || (t.step === 'roll' && t.rolledThisTurn)) ? t.lastPay : null;
    if (!myTurn) {
      const what = { roll: 'lance les dés', jail: 'est naufragé sur l’Île perdue', buy: `hésite à acheter ${t.offer != null ? BOARD[t.offer].name : ''}`, build: 'envisage de construire', buyout: `peut racheter ${t.offer != null ? BOARD[t.offer].name : ''}`, teleport: 'choisit une destination', championship: 'organise les Championnats', debt: 'doit vendre pour payer sa dette', auction: 'participe aux enchères', done: 'termine son tour' }[t.step] || '';
      el.innerHTML = `${payNoteHTML(s, lastPay)}<div class="prompt muted">${esc(p.name)} ${what}…<small>Cliquez sur une case pour voir ses loyers.</small></div>`;
      return;
    }
    let html = '';
    switch (t.step) {
      case 'roll': {
        html = `<div class="prompt">${t.doubles > 0 ? 'Double ! Relancez les dés.' : 'Lancez les dés.'}<small>Votre tour dure 30 secondes. Cliquez sur une de vos propriétés pour vendre la case entière à 75 % de l’investissement.</small></div>
          <button class="btn primary big" data-act="roll">🎲 Lancer les dés</button>`;
        break;
      }
      case 'jail':
        html = `<div class="prompt">Vous êtes naufragé sur l’Île perdue.<small>Essai ${meP.jailTurns + 1}/${RULES.jailMaxTurns} : faites un double pour partir, ou payez ${fmt(RULES.jailFee)}.</small></div>
          <div class="btn-row"><button class="btn primary" data-act="jailRoll">🎲 Tenter un double</button><button class="btn" data-act="jailPay" ${meP.cash < RULES.jailFee ? 'disabled' : ''}>Payer ${fmt(RULES.jailFee)}</button>${meP.jailCards > 0 ? '<button class="btn" data-act="jailCard">Utiliser une carte de sortie</button>' : ''}</div>`;
        break;
      case 'buy': {
        const i = t.offer; const opts = E.buyOptions(s, me, i);
        html = `${offerCardHTML(i)}<div class="prompt" style="font-size:1em">Acheter ${esc(BOARD[i].name)}${BOARD[i].type === 'property' ? ' — choisissez le niveau' : ''} :</div>${levelButtons(opts, i, 'buy')}<div class="btn-row"><button class="btn" data-act="skipBuy">Passer</button></div>`;
        break;
      }
      case 'build': {
        const i = t.offer; const h = s.tiles[i].houses; const opts = E.buildOptions(s, me, i);
        html = `${offerCardHTML(i)}<div class="prompt" style="font-size:1em">Vous êtes chez vous (${LEVEL_LABELS[h]}) — améliorer ?</div>${levelButtons(opts, i, 'build')}<div class="btn-row"><button class="btn" data-act="skipBuild">Passer</button></div>`;
        break;
      }
      case 'buyout': {
        const i = t.offer; const owner = s.players[s.tiles[i].owner]; const price = t.buyoutPrice || E.buyoutPrice(s, i);
        html = `${payNoteHTML(s, lastPay)}${offerCardHTML(i)}<div class="prompt" style="font-size:1em">Racheter ${esc(BOARD[i].name)} à <b style="color:${owner.color}">${esc(owner.name)}</b> ?<small>125 % du prix d’achat initial (${fmt(E.tileValue(s, i))}). L’or lui est versé, les niveaux restent.</small></div>
          <div class="btn-row"><button class="btn primary" data-act="buyout" ${meP.cash < price ? 'disabled' : ''}>Racheter — ${fmt(price)}</button><button class="btn" data-act="skipBuyout">Passer</button></div>`;
        break;
      }
      case 'teleport':
        html = `<div class="prompt">Le Portail s’ouvre ! Choisissez sur le plateau une case libre ou à vous.<small>Coût ${fmt(RULES.worldTourFee)}. Vous avancez toujours vers l’avant : passer par la Taverne rapporte ${fmt(RULES.salary)}.</small></div><div class="btn-row"><button class="btn" data-act="skipTeleport">Refermer le Portail</button></div>`;
        break;
      case 'championship': {
        const next = Math.min(RULES.championshipMaxMult, s.championship ? s.championship.mult + 1 : 2);
        html = `<div class="prompt">Organisez les Championnats sur une de vos cases (en surbrillance).<small>Coût ${fmt(RULES.championshipFee)} — le loyer y sera multiplié par ${next}.</small></div><div class="btn-row"><button class="btn" data-act="skipChampionship">Passer</button></div>`;
        break;
      }
      case 'debt': {
        const d = t.debt; const to = typeof d.to === 'number' ? s.players[d.to].name : d.to === 'split' ? 'aux autres joueurs' : 'à la banque';
        const canCover = meP.cash + E.liquidationValue(s, me) >= d.amount;
        html = `<div class="prompt">Vous devez <b>${fmt(d.amount)}</b> ${typeof d.to === 'number' ? 'à ' + esc(to) : to}.<small>Il vous manque ${fmt(d.amount - meP.cash)}. Cliquez sur vos propriétés en rouge pour vendre la case entière, niveaux de taverne inclus, à 75 % de l’investissement.</small></div>
          <div class="btn-row"><button class="btn danger" data-act="declareBankrupt" ${canCover ? 'disabled title="Vous pouvez encore vendre pour payer"' : ''}>Déclarer faillite</button></div>`;
        break;
      }
      case 'done':
        html = `${payNoteHTML(s, lastPay)}<div class="prompt muted">Tour terminé.<small>Le tour passe au joueur suivant…</small></div>`;
        break;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => { act({ type: b.dataset.act }); }));
    el.querySelectorAll('.lvl[data-houses]').forEach((b) => (b.onclick = () => { act({ type: t.step === 'buy' ? 'buy' : 'build', houses: +b.dataset.houses }); }));
  }

  // ============================================================
  // Interactions plateau
  // ============================================================
  function onTileClick(i) {
    const s = app.state; if (!s) return;
    const me = app.myIdx; const myTurn = s.current === me && s.phase === 'playing';
    const b = BOARD[i]; const t = s.tiles[i];
    if (myTurn && app.selectMode === 'teleport' && E.teleportTargets(s, me).includes(i)) {
      const c = openModal(`<h2>Voyager vers ${esc(b.name)} ?</h2><p>Le Portail vous y dépose pour ${fmt(RULES.worldTourFee)}. ${t.owner === null ? 'La case est libre : vous pourrez l’acheter.' : 'C’est chez vous : vous pourrez y construire.'}</p><div class="btn-row"><button class="btn primary" id="okTp">Voyager</button><button class="btn" data-close>Annuler</button></div>`);
      c.querySelector('#okTp').onclick = () => { closeModal(); act({ type: 'teleport', tile: i }); };
      return;
    }
    if (myTurn && app.selectMode === 'championship' && E.championshipTargets(s, me).includes(i)) {
      const next = Math.min(RULES.championshipMaxMult, s.championship ? s.championship.mult + 1 : 2);
      const c = openModal(`<h2>Championnats sur ${esc(b.name)} ?</h2><p>Pour ${fmt(RULES.championshipFee)}, le loyer de cette case sera multiplié par ${next} (loyer actuel ${fmt(E.computeRent(s, i, 7))} → ${fmt(E.computeRent({ ...s, championship: null }, i, 7) * next)}).</p><div class="btn-row"><button class="btn primary" id="okCh">Organiser</button><button class="btn" data-close>Annuler</button></div>`);
      c.querySelector('#okCh').onclick = () => { closeModal(); act({ type: 'championship', tile: i }); };
      return;
    }
    showTileSheet(i);
  }

  function showTileSheet(i) {
    const s = app.state; const b = BOARD[i]; const t = s.tiles[i]; const me = app.myIdx;
    const myTurn = s.current === me && s.phase === 'playing';
    let html = `<div class="prop-sheet"><div class="ps-head" style="--g:${groupColor(i)}">${esc(b.name)}</div>`;
    if (b.type === 'property') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      html += `<p>${GROUPS[b.group].label} · Prix ${fmt(b.price)} · Niveau de taverne ${fmt(GROUPS[b.group].houseCost)} · Serviteur doré ${fmt(GROUPS[b.group].houseCost * RULES.hotelCostMult)}<br>${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Libre'}${s.championship && s.championship.tile === i ? ` · 🏆 Championnats x${s.championship.mult}` : ''}</p>`;
      html += '<table>' + b.rents.map((r, k) => k === 0 ? '' : `<tr class="${owner && t.houses === k ? 'now' : ''}"><td>${LEVEL_LABELS[k]} <small class="muted">(+${fmt(E.levelCost(i, 0, k))})</small></td><td>${fmt(r)}</td></tr>`).join('') + '</table>';
      if (owner && t.owner !== me) html += `<p>${t.houses === E.HOTEL ? 'Serviteur doré : cette case ne peut pas être rachetée.' : `Rachat possible en y tombant : <b>${fmt(E.buyoutPrice(s, i))}</b> (125 % du prix d’achat initial de ${esc(owner.name)}).`}</p>`;
    } else if (b.type === 'station') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      html += `<p>Serviteur neutre · Prix ${fmt(b.price)}<br>${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Libre'}</p><table>${RULES.stationRents.map((r, k) => `<tr class="${owner && E.countOwned(s, t.owner, 'station') === k + 1 ? 'now' : ''}"><td>${k + 1} serviteur${k ? 's' : ''} neutre${k ? 's' : ''}</td><td>${fmt(r)}</td></tr>`).join('')}</table>`;
    } else if (b.type === 'utility') {
      const owner = t.owner !== null ? s.players[t.owner] : null;
      html += `<p>Service · Prix ${fmt(b.price)}<br>${owner ? `Propriétaire : <b style="color:${owner.color}">${esc(owner.name)}</b>` : 'Libre'}</p><table><tr><td>1 service</td><td>dés x ${fmt(RULES.utilityMult[0])}</td></tr><tr><td>2 services</td><td>dés x ${fmt(RULES.utilityMult[1])}</td></tr></table>`;
    } else {
      const desc = {
        start: `Recevez ${fmt(RULES.salary)} à chaque passage.`,
        jail: `Naufragé ! Payez ${fmt(RULES.jailFee)} ou faites un double pour repartir (3 essais max). On y arrive en tombant dessus, par une carte Chance ou après 3 doubles.`,
        championship: `Pour ${fmt(RULES.championshipFee)}, organisez les Championnats sur une de vos cases : son loyer est multiplié (x2, puis x3… jusqu’à x${RULES.championshipMaxMult}). Un seul lieu à la fois sur le plateau.`,
        worldtour: `Pour ${fmt(RULES.worldTourFee)}, le Portail vous emmène (toujours vers l’avant) sur n’importe quelle case libre ou à vous. Passer par la Taverne rapporte ${fmt(RULES.salary)}.`,
        tax: `Payez ${fmt(b.amount)} à la banque.`,
        chance: 'Tirez une carte Chance : bonne ou mauvaise surprise.',
      }[b.type];
      html += `<p>${desc}</p>`;
    }
    html += '</div>';
    if (t && t.owner === me && myTurn && ['roll', 'debt', 'jail', 'buy', 'build', 'buyout'].includes(s.turn.step)) {
      const v = E.sellValue(s, i);
      const levels = b.type === 'property' && t.houses > 0 ? ` et ${t.houses === E.HOTEL ? 'son Serviteur doré' : `sa Taverne ${t.houses}`}` : '';
      html += `<p class="muted">Vente de la case entière${levels} : 75 % de l’investissement total.</p><div class="btn-row" style="margin-top:14px"><button class="btn danger" id="sellBtn">Vendre toute la propriété — +${fmt(v)}</button></div>`;
    }
    const c = openModal(html);
    const sb = c.querySelector('#sellBtn');
    if (sb) sb.onclick = () => { closeModal(); act({ type: 'sell', tile: i }); };
  }

  function showChanceCard(text) {
    SFX.card();
    openModal(`<div class="chance-card"><div class="big">?</div><h2>Carte Chance</h2><p>${esc(text)}</p><div class="btn-row"><button class="btn primary" data-close>OK</button></div></div>`);
    clearTimeout(openModal._auto);
    openModal._auto = setTimeout(() => { if (!$('modal').hidden && $('modalCard').querySelector('.chance-card')) closeModal(); }, 2500);
  }

  function showEnd() {
    const s = app.state; if (!s || !s.ranking) return;
    $('brandHome').disabled = false;
    document.querySelector('.topbar').classList.add('game-ended');
    const isHost = app.mode !== 'client';
    const reason = s.endReason === 'time' ? 'Le chrono a sonné !' : 'Tous les adversaires ont fait faillite !';
    const list = s.ranking.map((r, k) => `<li><span class="rk">${k + 1}</span><span class="tk">${r.token}</span><span class="nm">${esc(r.name)}${r.bankrupt ? '<small>Faillite</small>' : `<small>${r.props} case${r.props > 1 ? 's' : ''} · ${fmt(r.cash)} en or</small>`}</span><span class="wt">${r.bankrupt ? '—' : fmt(r.worth)}</span></li>`).join('');
    openModal(`<h2>🏆 ${esc(s.ranking[0].name)} remporte la taverne !</h2><p>${reason} Classement à la fortune totale (or + valeur des cases et constructions).</p><ul class="ranking">${list}</ul>
      <div class="btn-row">${isHost ? '<button class="btn primary" id="againBtn">Rejouer avec les mêmes joueurs</button>' : '<p class="muted">L’hôte peut relancer une partie.</p>'}<button class="btn" data-close>Fermer</button></div>`);
    const ab = $('againBtn');
    if (ab) ab.onclick = () => { closeModal(); const players = s.players.map((p) => ({ name: p.name, token: p.token, isBot: p.isBot, peerId: p.peerId })); launch(players, app.lobby ? app.lobby.durationMin : RULES.defaultDurationMin); };
  }

  function returnHome() {
    if (!app.state || app.state.phase !== 'ended') return;
    closeModal();
    clearSavedSession();
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
    setNetStatus('');
  }

  function showRules() {
    openModal(`<div class="rules"><h2>Règles de la taverne</h2>
      <h3>But</h3><ul><li>Quand le chrono sonne, le joueur le plus riche gagne : or + valeur des cases et constructions.</li><li>La partie s’arrête aussi si tous les autres joueurs font faillite.</li></ul>
      <h3>Tour de jeu</h3><ul><li>Au début, chacun lance les dés pour déterminer l’ordre de passage ; les égalités sont départagées par un nouveau lancer.</li><li>Chaque tour dure 30 secondes, indiqué par la mèche du pétard. Le tour passe automatiquement à l’expiration.</li><li>Lancez les dés, avancez. Un double fait rejouer ; trois doubles d’affilée envoient sur l’Île perdue.</li><li><b>Case libre</b> : achetez-la directement avec une Taverne de niveau 1 à 4. Seule la Taverne 4 est bloquée jusqu’à un premier passage par la Taverne.</li><li><b>Case à vous</b> : améliorez-la jusqu’à Taverne 4, puis en Serviteur doré, pour le loyer maximal. Le Serviteur doré rend la case imprenable.</li><li><b>Case adverse</b> : payez le loyer, puis vous pouvez la <b>racheter</b> pour 125 % de sa valeur d’achat (sauf Serviteur doré). L’or lui est versé et les niveaux restent.</li><li>Passage par la Taverne : +${fmt(RULES.salary)}.</li></ul>
      <h3>Cases spéciales</h3><ul><li><b>Chance</b> : tirez une carte (gains, pertes, déplacements, carte de sortie…).</li><li><b>Île perdue</b> : payez ${fmt(RULES.jailFee)} ou faites un double pour partir (3 essais).</li><li><b>Championnats</b> : pour ${fmt(RULES.championshipFee)}, le loyer d’une de vos cases est multiplié (x2, x3… jusqu’à x${RULES.championshipMaxMult}).</li><li><b>Tour du monde</b> : pour ${fmt(RULES.worldTourFee)}, voyagez vers l’avant jusqu’à une case libre ou à vous ; si vous passez par la Taverne, vous touchez les ${fmt(RULES.salary)}.</li><li><b>Serviteurs neutres</b> (Brann, Drakkari, Titus, Leeroy) : loyer de ${fmt(RULES.stationRents[0])} à ${fmt(RULES.stationRents[3])} selon le nombre possédé. Ni niveaux de taverne ni rachat.</li><li><b>Services</b> (Sombre Don, Bibelot) : loyer = dés x ${fmt(RULES.utilityMult[0])}, ou x ${fmt(RULES.utilityMult[1])} avec les deux.</li></ul>
      <h3>Dettes</h3><ul><li>En cas de dette, vous pouvez vendre une propriété entière avec tous ses niveaux à la banque pour 75 % du montant total investi.</li><li>En cas de faillite, chaque propriété et ses niveaux sont mis aux enchères entre les joueurs restants. Le joueur en faillite récupère 50 % du prix adjugé.</li></ul>
      <div class="btn-row" style="margin-top:16px"><button class="btn primary" data-close>Compris</button></div></div>`);
  }

  // ============================================================
  initHome();
  window.TT_DEBUG = Object.assign(app, { dispatch, afterChange, E });
})();
