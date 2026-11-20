// Der Host führt das Spiel: verwaltet Plätze (lokal, online, Bot), steuert Bots
// und schickt jedem Spieler nur seine eigene Sicht.
'use strict';

const BOT_NAMES = ['Anna', 'Ben', 'Clara', 'David', 'Emma', 'Felix'];
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 3;

class HostController {
  constructor({ name, speed, dealerRule, onView, onLobby }) {
    this.speed = speed;
    this.dealerRule = dealerRule;
    this.onView = onView;
    this.onLobby = onLobby;
    this.seats = [{ name, kind: 'local' }]; // kind: local | remote | bot
    this.game = null;
    this.event = null;
    this.ready = new Set();
    this.timers = new Set();
    this.botTimer = null;
    this.peer = null;
    this.code = null;
    this.destroyed = false;
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  destroy() {
    this.destroyed = true;
    this.timers.forEach(clearTimeout);
    clearInterval(this.heartbeat);
    if (this.peer) this.peer.destroy();
  }

  // ---------- Netzwerk ----------
  attachPeer(peer, code) {
    this.peer = peer;
    this.code = code;
    // Heartbeat: hart geschlossene Tabs erkennt WebRTC sonst nicht zuverlässig.
    this.heartbeat = setInterval(() => {
      for (const s of this.seats) {
        if (s.kind !== 'remote' || !s.conn) continue;
        const conn = s.conn;
        if (Date.now() - conn.lastSeen > HEARTBEAT_TIMEOUT) {
          this.removeRemote(conn);
          conn.close();
        } else {
          try { conn.send({ t: 'ping' }); } catch (e) { /* egal */ }
        }
      }
    }, HEARTBEAT_INTERVAL);
    peer.on('connection', conn => {
      conn.lastSeen = Date.now();
      conn.on('data', msg => {
        conn.lastSeen = Date.now();
        if (!msg || typeof msg !== 'object' || msg.t === 'ping') return;
        if (msg.t === 'join') this.addRemote(conn, String(msg.name || 'Gast').trim().slice(0, 16) || 'Gast');
        else {
          const i = this.seats.findIndex(s => s.conn === conn);
          if (i >= 0) this.handleAction(i, msg);
        }
      });
      conn.on('close', () => this.removeRemote(conn));
      conn.on('error', () => this.removeRemote(conn));
    });
    peer.on('disconnected', () => { if (!this.destroyed) peer.reconnect(); });
  }

  sendTo(i, msg) {
    const s = this.seats[i];
    if (s.kind === 'remote' && s.conn && s.conn.open) {
      try { s.conn.send(msg); } catch (e) { /* Verbindung weg – close-Event räumt auf */ }
    }
  }

  reject(conn, msg) {
    try { conn.send({ t: 'error', msg }); } catch (e) { /* egal */ }
    setTimeout(() => conn.close(), 500);
  }

  uniqueName(name) {
    let n = name, k = 2;
    while (this.seats.some(s => s.name === n)) n = `${name} ${k++}`;
    return n;
  }

  addRemote(conn, name) {
    if (this.seats.some(s => s.conn === conn)) return;
    if (this.game) {
      // Wiedereinstieg: Platz mit gleichem Namen, den gerade ein Bot vertritt
      const i = this.seats.findIndex(s => s.kind === 'bot' && s.wasHuman && s.name === name);
      if (i < 0) return this.reject(conn, 'Das Spiel läuft bereits.');
      Object.assign(this.seats[i], { kind: 'remote', conn });
      this.event = { kind: 'rejoin', seat: i };
      this.push();
      return;
    }
    if (this.seats.length >= MAX_PLAYERS) return this.reject(conn, 'Der Raum ist voll.');
    this.seats.push({ name: this.uniqueName(name), kind: 'remote', conn });
    this.syncLobby();
  }

  removeRemote(conn) {
    const i = this.seats.findIndex(s => s.conn === conn);
    if (i < 0) return;
    const s = this.seats[i];
    s.conn = null;
    if (!this.game) {
      this.seats.splice(i, 1);
      this.syncLobby();
      return;
    }
    s.kind = 'bot';
    s.wasHuman = true;
    this.event = { kind: 'left', seat: i };
    this.push();
    this.step();
  }

  // ---------- Lobby ----------
  lobbyInfo() {
    return {
      code: this.code,
      players: this.seats.map(s => ({ name: s.name, bot: s.kind === 'bot' })),
    };
  }

  syncLobby() {
    const lobby = this.lobbyInfo();
    this.seats.forEach((s, i) => {
      if (s.kind === 'local') this.onLobby(lobby, i);
      else this.sendTo(i, { t: 'lobby', lobby, you: i });
    });
  }

  addBot() {
    if (this.game || this.seats.length >= MAX_PLAYERS) return;
    const name = BOT_NAMES.find(b => !this.seats.some(s => s.name === b)) || this.uniqueName('Bot');
    this.seats.push({ name, kind: 'bot' });
    this.syncLobby();
  }

  removeBot() {
    if (this.game) return;
    for (let i = this.seats.length - 1; i > 0; i--) {
      if (this.seats[i].kind === 'bot') { this.seats.splice(i, 1); break; }
    }
    this.syncLobby();
  }

  // ---------- Spiel ----------
  start() {
    if (this.seats.length < MIN_PLAYERS) return;
    this.game = new WizardGame({ names: this.seats.map(s => s.name), dealerRule: this.dealerRule });
    this.beginRound();
  }

  beginRound() {
    const g = this.game;
    this.ready.clear();
    g.startRound();
    this.event = { kind: 'deal', seat: g.dealer };
    this.push();
    this.later(() => this.step(), this.speed.bot);
  }

  push() {
    const seats = this.seats.map(s => ({ bot: s.kind === 'bot' }));
    this.seats.forEach((s, i) => {
      if (s.kind === 'bot') return;
      const view = this.game.viewFor(i);
      Object.assign(view, { event: this.event, ready: [...this.ready], seats, code: this.code });
      if (s.kind === 'local') this.onView(view, i);
      else this.sendTo(i, { t: 'state', view, you: i });
    });
  }

  isBot(i) { return this.seats[i].kind === 'bot'; }

  // Lässt einen Bot handeln, falls er dran ist.
  step() {
    const g = this.game;
    clearTimeout(this.botTimer);
    const phase = g.phase;
    const seat = phase === 'choose-trump' ? g.dealer : g.current;
    const stillValid = () => g.phase === phase && (phase === 'choose-trump' ? g.dealer : g.current) === seat && this.isBot(seat);

    if (phase === 'choose-trump' && this.isBot(seat)) {
      this.botTimer = this.later(() => {
        if (!stillValid()) return;
        const suit = AI.chooseTrump(g);
        g.chooseTrump(suit);
        this.event = { kind: 'trump', seat, suit };
        this.push();
        this.step();
      }, this.speed.bot);
    } else if (phase === 'bidding' && this.isBot(seat)) {
      this.botTimer = this.later(() => {
        if (!stillValid()) return;
        const value = AI.chooseBid(g);
        g.placeBid(value);
        this.event = { kind: 'bid', seat, value };
        this.push();
        this.step();
      }, this.speed.bot);
    } else if (phase === 'playing' && this.isBot(seat)) {
      this.botTimer = this.later(() => {
        if (!stillValid()) return;
        g.playCard(AI.chooseCard(g).id);
        this.afterPlay();
      }, this.speed.bot);
    } else if (phase === 'round-complete') {
      this.checkReady();
    }
  }

  afterPlay() {
    const g = this.game;
    this.event = null;
    this.push();
    if (g.phase === 'trick-complete') {
      this.later(() => {
        g.finishTrick();
        this.push();
        this.step();
      }, this.speed.trick);
    } else {
      this.step();
    }
  }

  checkReady() {
    if (this.game.phase !== 'round-complete') return;
    if (this.seats.every((s, i) => s.kind === 'bot' || this.ready.has(i))) this.beginRound();
  }

  // Aktionen von Menschen (lokal oder online). Ungültiges wird ignoriert.
  handleAction(seat, msg) {
    const g = this.game;
    if (!g) return;
    try {
      switch (msg.t) {
        case 'bid':
          if (g.phase !== 'bidding' || g.current !== seat) return;
          g.placeBid(msg.v);
          this.event = { kind: 'bid', seat, value: msg.v };
          this.push();
          this.step();
          break;
        case 'play':
          if (g.phase !== 'playing' || g.current !== seat) return;
          g.playCard(msg.id);
          this.afterPlay();
          break;
        case 'trump':
          if (g.phase !== 'choose-trump' || g.dealer !== seat) return;
          g.chooseTrump(msg.suit);
          this.event = { kind: 'trump', seat, suit: msg.suit };
          this.push();
          this.step();
          break;
        case 'ready':
          if (g.phase !== 'round-complete') return;
          this.ready.add(seat);
          this.push();
          this.checkReady();
          break;
        case 'restart':
          if (this.seats[seat].kind === 'local' && g.phase === 'game-over') this.start();
          break;
      }
    } catch (e) {
      console.warn('Ungültige Aktion', seat, msg, e);
    }
  }
}
