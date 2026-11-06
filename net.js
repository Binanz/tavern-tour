/* ============================================================
   TAVERN TOUR — couche réseau pair-à-pair (PeerJS / WebRTC)
   L'hôte fait autorité : il reçoit les actions, fait tourner le
   moteur et renvoie l'état complet à tout le monde.
   ============================================================ */
(function (global) {
  'use strict';

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PREFIX = 'tavern-tour-v1-';

  function makeCode(len) {
    let s = '';
    for (let i = 0; i < (len || 5); i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  const peerIdFor = (code) => PREFIX + code.toUpperCase();

  function peerOptions() {
    return {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    };
  }

  function friendlyError(err) {
    const t = (err && err.type) || '';
    if (t === 'peer-unavailable') return 'Aucune salle avec ce code (ou l’hôte est parti).';
    if (t === 'unavailable-id') return 'Ce code est déjà utilisé, réessayez.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Impossible de joindre le serveur de mise en relation. Vérifiez votre connexion.';
    if (t === 'browser-incompatible') return 'Ce navigateur ne supporte pas WebRTC.';
    return (err && err.message) || 'Erreur réseau inconnue.';
  }

  class Net {
    constructor(handlers) {
      this.h = handlers || {};
      this.peer = null;
      this.conns = new Map(); // id -> DataConnection (hôte)
      this.hostConn = null;   // (invité)
      this.role = null;
      this.code = null;
    }

    _ensurePeerLib() {
      if (typeof global.Peer === 'undefined') throw new Error('La bibliothèque réseau n’a pas pu être chargée (bloqueur ? connexion ?).');
    }

    host(code) {
      this._ensurePeerLib();
      this.role = 'host';
      this.code = code;
      const peer = new global.Peer(peerIdFor(code), peerOptions());
      this.peer = peer;
      peer.on('open', () => this.h.onReady && this.h.onReady(code));
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.conns.set(conn.peer, conn);
          conn.on('data', (msg) => this.h.onMessage && this.h.onMessage(conn.peer, msg));
          const onDisconnect = () => {
            if (this.conns.get(conn.peer) !== conn) return;
            this.conns.delete(conn.peer);
            this.h.onLeave && this.h.onLeave(conn.peer);
          };
          conn.on('close', onDisconnect);
          conn.on('error', onDisconnect);
          this.h.onJoin && this.h.onJoin(conn.peer);
        });
      });
      peer.on('error', (err) => this.h.onError && this.h.onError(friendlyError(err), err));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    }

    join(code, peerId) {
      this._ensurePeerLib();
      this.role = 'client';
      this.code = code.toUpperCase();
      const peer = peerId ? new global.Peer(peerId, peerOptions()) : new global.Peer(peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(peerIdFor(this.code), { reliable: true });
        this.hostConn = conn;
        let opened = false;
        const timer = setTimeout(() => { if (!opened) this.h.onError && this.h.onError('Pas de réponse de l’hôte (pare-feu ou réseau trop restrictif ?).'); }, 15000);
        conn.on('open', () => { opened = true; clearTimeout(timer); this.h.onReady && this.h.onReady(this.code); });
        conn.on('data', (msg) => this.h.onMessage && this.h.onMessage('host', msg));
        conn.on('close', () => this.h.onHostLost && this.h.onHostLost());
        conn.on('error', (e) => this.h.onError && this.h.onError(friendlyError(e), e));
      });
      peer.on('error', (err) => this.h.onError && this.h.onError(friendlyError(err), err));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    }

    sendTo(id, msg) {
      const c = this.conns.get(id);
      if (c && c.open) c.send(msg);
    }
    sendHost(msg) {
      if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
    }
    broadcast(msg) {
      for (const c of this.conns.values()) if (c.open) c.send(msg);
    }
    kick(id) {
      const c = this.conns.get(id);
      if (c) { try { c.close(); } catch (e) { /* ignore */ } this.conns.delete(id); }
    }
    destroy() {
      try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
      this.peer = null; this.conns.clear(); this.hostConn = null; this.role = null;
    }
  }

  global.TT_NET = { Net, makeCode };
})(window);
