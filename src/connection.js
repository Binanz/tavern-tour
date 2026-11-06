import { $, app, RULES, TOKENS } from './runtime.js';
import { SFX } from './audio.js';
import { toast, openModal, closeModal, esc } from './ui/helpers.js';

export function createConnection({ setNetStatus, showLobby, applyLobbyProfile, broadcastLobby, publicLobby, leaveLobby, dispatch, afterChange, onState }) {
  // Messages reçus par l'hôte
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
      if (L.started) {
        const available = app.state && app.state.phase === 'playing'
          ? app.state.players.map((player, index) => ({ player, index })).filter(({ player }) => player.isBot && !player.bankrupt)
          : [];
        if (!available.length) {
          app.net.sendTo(from, { type: 'rejected', reason: 'Aucun bot ne peut être remplacé dans cette partie.' });
          return;
        }
        app.pendingClaims[from] = true;
        app.net.sendTo(from, {
          type: 'claimOptions',
          lobby: publicLobby(),
          players: available.map(({ player, index }) => ({ index, name: player.name, token: player.token })),
        });
        return;
      }
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
    if (msg.type === 'claimPlayer') {
      if (!app.pendingClaims[from]) return;
      delete app.pendingClaims[from];
      const idx = Number(msg.index);
      const player = Number.isInteger(idx) && app.state && app.state.players[idx];
      if (!app.lobby || !app.lobby.started || !app.state || app.state.phase !== 'playing' || !player || !player.isBot || player.bankrupt) {
        app.net.sendTo(from, { type: 'rejected', reason: 'Ce bot ne peut plus être remplacé. Rejoignez à nouveau la partie pour actualiser les choix.' });
        return;
      }
      player.isBot = false;
      player.connected = true;
      player.peerId = from;
      app.lobby.players[idx] = { name: player.name, token: player.token, isBot: false, peerId: from };
      app.state.log.push({ t: `${player.name} rejoint la partie et remplace un bot.`, k: 'info', n: app.state.turnCount });
      afterChange();
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
    delete app.pendingClaims[id];
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

  // Messages reçus par l'invité
  function clientOnMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    clearTimeout(app.hostLostTimer); app.hostLostTimer = null;
    app.lastHostSeen = Date.now();
    if (msg.type === 'ping') { app.net.sendHost({ type: 'pong' }); return; }
    switch (msg.type) {
      case 'claimOptions':
        app.lobby = msg.lobby;
        setNetStatus('');
        showTakeoverOptions(msg.players);
        break;
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
        onState();
        break;
      case 'error': toast(msg.msg); SFX.bad(); break;
      case 'rejected':
        closeModal();
        setNetStatus(msg.reason, true); $('btnJoin').disabled = false; app.net.destroy(); app.net = null; app.mode = null; app.lobby = null;
        break;
    }
  }
  function showTakeoverOptions(players) {
    const options = Array.isArray(players) ? players : [];
    const choices = options.map((player) => `<button class="btn takeover-choice" data-claim-index="${player.index}"><span class="takeover-token">${esc(player.token)}</span><span>${esc(player.name)}</span><small>Remplacer ce bot</small></button>`).join('');
    const card = openModal(`<h2>Choisir votre joueur</h2><p>La partie est déjà en cours. Choisissez un bot à remplacer ; les joueurs réels ne peuvent pas être remplacés.</p><div class="takeover-choices">${choices}</div><div class="btn-row"><button class="btn ghost" id="cancelTakeover">Annuler</button></div>`, { noClose: true });
    card.querySelectorAll('[data-claim-index]').forEach((button) => {
      button.onclick = () => {
        card.querySelectorAll('[data-claim-index]').forEach((choice) => { choice.disabled = true; });
        button.textContent = 'Connexion au joueur…';
        app.net.sendHost({ type: 'claimPlayer', index: Number(button.dataset.claimIndex) });
      };
    });
    card.querySelector('#cancelTakeover').onclick = () => { closeModal(); leaveLobby(); };
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
    openModal(`<h2>Connexion perdue</h2><p>L’hôte a quitté la partie ou la connexion a été coupée. Si l’hôte revient, rejoignez à nouveau avec le code de la salle.</p><div class="btn-row"><button class="btn primary" onclick="location.reload()">Retour à l’accueil</button></div>`, { noClose: true });
  }


  function startHeartbeat() {
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
  }

  return { hostOnMessage, onPeerLeft, clientOnMessage, scheduleHostLost, startHeartbeat };
}
