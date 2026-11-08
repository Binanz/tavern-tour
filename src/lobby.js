import { $, app, Net, makeCode, RULES, TOKENS, BOT_NAMES } from './runtime.js';
import { SFX } from './audio.js';
import { toast, esc } from './ui/helpers.js';

export function createLobby({ hostOnMessage, onPeerLeft, clientOnMessage, scheduleHostLost, startGame, launch, returnHome, positionAllPawns, showRules }) {
  // Accueil / lobby
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
    $('powersEnabled').onchange = () => {
      if (app.lobby && app.mode === 'host' && !app.lobby.started) { app.lobby.powers = $('powersEnabled').checked; broadcastLobby(); }
    };
    $('anomalySelect').onchange = () => {
      if (app.lobby && app.mode === 'host' && !app.lobby.started) { app.lobby.anomaly = $('anomalySelect').value; broadcastLobby(); }
    };
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
    window.addEventListener('resize', () => { if (app.state) positionAllPawns(); });
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
  function randomBotName(excluded) {
    const [name] = shuffledBotNames(excluded, 1);
    return name || BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  }
  function readMe() {
    const n = $('nameInput').value.trim();
    const excluded = app.lobby ? app.lobby.players.map((player) => player.name) : [];
    app.me.name = n || randomBotName(excluded);
    if (!n) $('nameInput').value = app.me.name;
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
    app.lobby = { code, players: [{ name: app.me.name, token: app.me.token, isBot: false, peerId: 'host' }], powers: !!$('powersEnabled').checked, anomaly: $('anomalySelect').value || 'none', durationMin: +$('durationSelect').value, fillBots: $('fillBots').checked, started: false };
    app.myIdx = 0;
    app.net = new Net({
      onReady: () => { setNetStatus(''); showLobby(); },
      onJoin: () => {},
      onLeave: (id) => onPeerLeft(id),
      onMessage: (from, msg) => hostOnMessage(from, msg),
      onError: (msg) => { setNetStatus(msg, true); $('btnHost').disabled = false; },
    });
    try { app.net.host(code); } catch (e) { setNetStatus(e.message, true); $('btnHost').disabled = false; app.mode = null; }
  }

  function joinGame() {
    const code = $('joinCode').value.trim().toUpperCase();
    readMe();
    if (code.length < 4) { toast('Entrez le code de la salle.'); return; }
    setNetStatus('Connexion à la salle ' + code + '…');
    $('btnJoin').disabled = true;
    app.mode = 'client';
    app.net = new Net({
      onReady: () => {
        app.lastHostSeen = Date.now();
        app.clientPeerId = app.net.peer.id;
        setNetStatus('Connecté, en attente de l’hôte…');
        app.net.sendHost({ type: 'hello', name: app.me.name, token: app.me.token });
      },
      onMessage: (from, msg) => clientOnMessage(msg),
      onHostLost: () => scheduleHostLost(),
      onError: (msg) => {
        setNetStatus(msg, true); $('btnJoin').disabled = false;
        app.net && app.net.destroy(); app.net = null; app.mode = null;
      },
    });
    try { app.net.join(code); }
    catch (e) {
      setNetStatus(e.message, true); $('btnJoin').disabled = false; app.mode = null; app.net = null;
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
    app.lobby = { code: null, players, powers: !!$('powersEnabled').checked, anomaly: $('anomalySelect').value || 'none', durationMin: +$('durationSelect').value, fillBots: false, started: true };
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
    $('anomalySelect').value = L.anomaly || 'none';
    $('anomalySelect').disabled = !isHost;
    $('powersEnabled').checked = !!L.powers;
    $('powersEnabled').disabled = !isHost;
    $('anomalyHint').textContent = L.anomaly && L.anomaly !== 'none' ? 'Anomalie : ' + (L.anomaly === 'random' ? 'tirage au lancement' : window.TT_CONFIG.ANOMALIES[L.anomaly].description) : 'Mode classique — aucune anomalie.';
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
    const requested = String(requestedName || '').trim().slice(0, 40);
    let name = requested || randomBotName(L.players.filter((_, i) => i !== idx).map((p) => p.name));
    if (L.players.some((p, i) => i !== idx && p.name.toLowerCase() === name.toLowerCase())) {
      const base = name.slice(0, 37);
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
      $('nameInput').value = player.name;
    }
  }
  function broadcastLobby() {
    renderLobby();
    if (app.mode !== 'host' || !app.net) return;
    app.lobby.players.forEach((p, i) => { if (p.peerId && p.peerId !== 'host') app.net.sendTo(p.peerId, { type: 'lobby', lobby: publicLobby(), yourIdx: i }); });
  }
  const publicLobby = () => ({ code: app.lobby.code, players: app.lobby.players.map((p) => ({ name: p.name, token: p.token, isBot: p.isBot })), powers: !!app.lobby.powers, anomaly: app.lobby.anomaly || 'none', durationMin: app.lobby.durationMin, fillBots: app.lobby.fillBots, started: app.lobby.started });

  function leaveLobby() {
    $('anomalySelect').disabled = false;
    $('powersEnabled').disabled = false;
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


  return { shuffledBotNames, setNetStatus, showLobby, applyLobbyProfile, broadcastLobby, publicLobby, leaveLobby, initHome };
}
