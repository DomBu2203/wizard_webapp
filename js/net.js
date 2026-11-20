// Online-Verbindung per WebRTC (PeerJS). Der öffentliche PeerJS-Server vermittelt
// nur den Verbindungsaufbau; die Spieldaten laufen direkt zwischen den Browsern.
'use strict';

const PEER_PREFIX = 'wizard-webapp-room-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HEARTBEAT_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 15000;

function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function peerErrorText(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return 'Raum nicht gefunden. Stimmt der Code und ist der Host noch online?';
    case 'unavailable-id': return 'Dieser Raumcode ist gerade vergeben. Bitte nochmal versuchen.';
    case 'browser-incompatible': return 'Dein Browser unterstützt keine WebRTC-Verbindungen.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'Keine Verbindung zum Vermittlungsserver. Bist du online?';
    default: return (err && err.message) || 'Unbekannter Verbindungsfehler.';
  }
}

function peerAvailable() { return typeof Peer !== 'undefined'; }

// Erstellt den Host-Peer. onReady(peer, code) bzw. onError(text).
function createHostPeer(onReady, onError) {
  if (!peerAvailable()) { onError('Die Online-Bibliothek konnte nicht geladen werden. Bist du online?'); return null; }
  const code = randomCode();
  const peer = new Peer(PEER_PREFIX + code, { debug: 0 });
  let opened = false;
  peer.on('open', () => { opened = true; onReady(peer, code); });
  peer.on('error', err => {
    if (!opened) { peer.destroy(); onError(peerErrorText(err)); }
    else console.warn('PeerJS', err);
  });
  return peer;
}

class GuestConnection {
  constructor(code, name, { onMessage, onClose, onError }) {
    this.closed = false;
    this.conn = null;
    let opened = false;
    const fail = text => {
      if (this.closed || opened) return;
      this.destroy();
      onError(text);
    };
    if (!peerAvailable()) { setTimeout(() => onError('Die Online-Bibliothek konnte nicht geladen werden. Bist du online?')); return; }
    this.peer = new Peer({ debug: 0 });
    this.timeout = setTimeout(() => fail('Zeitüberschreitung beim Verbinden.'), 20000);
    this.peer.on('error', err => {
      if (!opened) fail(peerErrorText(err));
      else console.warn('PeerJS', err);
    });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      const lost = () => { if (!this.closed) { this.destroy(); onClose(); } };
      conn.on('open', () => {
        opened = true;
        clearTimeout(this.timeout);
        conn.send({ t: 'join', name });
        this.lastSeen = Date.now();
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastSeen > HEARTBEAT_TIMEOUT) lost();
          else this.send({ t: 'ping' });
        }, HEARTBEAT_INTERVAL);
      });
      conn.on('data', msg => {
        this.lastSeen = Date.now();
        if (!this.closed && msg && msg.t !== 'ping') onMessage(msg);
      });
      conn.on('close', lost);
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    this.closed = true;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    if (this.peer) this.peer.destroy();
  }
}
