// Oberfläche: Menü, Lobby und Spieltisch. Zeigt immer die Sicht des eigenen Platzes
// und schickt Aktionen an den Host (lokal direkt, online über das Netz).
'use strict';

const SPEEDS = {
  slow: { bot: 1200, trick: 2000 },
  normal: { bot: 700, trick: 1300 },
  fast: { bot: 250, trick: 700 },
};

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (text, cls, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

const app = {
  mode: null,   // 'local' | 'host' | 'guest'
  host: null,   // HostController (local/host)
  guest: null,  // GuestConnection (guest)
  me: 0,
  view: null,
  lobby: null,
  modalKey: null, // 'phase:…' für automatisch geöffnete Dialoge
};

function send(msg) {
  if (app.host) app.host.handleAction(app.me, msg);
  else if (app.guest) app.guest.send(msg);
}

function showScreen(id) {
  for (const s of ['setup', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
}

// ---------- Karten ----------
function cardLabel(c) {
  if (c.type === 'wizard') return 'Zauberer';
  if (c.type === 'jester') return 'Narr';
  return `${SUIT_NAMES[c.suit]} ${c.value}`;
}

function cardEl(c, opts = {}) {
  const cls = c.type === 'num' ? `suit-${c.suit}` : c.type;
  const d = el(opts.button ? 'button' : 'div', `card ${cls}${opts.small ? ' small' : ''}`);
  if (opts.button) d.type = 'button';
  d.title = cardLabel(c);
  d.setAttribute('aria-label', cardLabel(c));
  const v = c.type === 'wizard' ? 'Z' : c.type === 'jester' ? 'N' : String(c.value);
  const face = c.type === 'wizard' ? '★' : c.type === 'jester' ? '☺' : v;
  d.append(el('span', 'corner tl', v), el('span', 'face', face), el('span', 'corner br', v));
  return d;
}

// ---------- Texte ----------
const isMe = i => i === app.me;
const nameOf = (v, i) => v.players[i].name;
const subj = (v, i, du, er) => isMe(i) ? `Du ${du}` : `${nameOf(v, i)} ${er}`;

function eventText(v) {
  const e = v.event;
  if (!e) return '';
  switch (e.kind) {
    case 'deal': return `Runde ${v.round}: ${subj(v, e.seat, 'gibst', 'gibt')} ${v.round} Karte${v.round > 1 ? 'n' : ''}.`;
    case 'trump': return `${subj(v, e.seat, 'wählst', 'wählt')} ${SUIT_NAMES[e.suit]} als Trumpf.`;
    case 'bid': return `${subj(v, e.seat, 'sagst', 'sagt')} ${e.value} an.`;
    case 'left': return `${nameOf(v, e.seat)} hat das Spiel verlassen – ein Bot übernimmt.`;
    case 'rejoin': return `${nameOf(v, e.seat)} ist wieder dabei.`;
    default: return '';
  }
}

function statusText(v) {
  if (v.phase === 'trick-complete') {
    return isMe(v.trickWinner) ? 'Du gewinnst den Stich!' : `${nameOf(v, v.trickWinner)} gewinnt den Stich.`;
  }
  if (v.phase === 'round-complete' || v.phase === 'game-over') return 'Runde beendet.';
  let turn = '';
  if (v.phase === 'choose-trump') {
    turn = isMe(v.dealer) ? 'Ein Zauberer wurde aufgedeckt – wähle die Trumpffarbe.'
      : `Ein Zauberer wurde aufgedeckt – ${nameOf(v, v.dealer)} wählt Trumpf …`;
  } else if (v.phase === 'bidding') {
    turn = isMe(v.current) ? 'Du bist dran: Sage deine Stiche an.' : `${nameOf(v, v.current)} überlegt …`;
  } else if (v.phase === 'playing') {
    turn = isMe(v.current) ? (v.trick.length ? 'Du bist dran: Spiele eine Karte.' : 'Du spielst aus.')
      : `${nameOf(v, v.current)} ist am Zug …`;
  }
  const ev = eventText(v);
  return ev ? `${ev} ${turn}` : turn;
}

// ---------- Spieltisch ----------
function onView(view, me) {
  app.view = view;
  app.me = me;
  showScreen('game');
  render();
}

function render() {
  const v = app.view;
  if (!v) return;
  $('round-label').textContent = `Runde ${v.round} / ${v.totalRounds}`;
  $('room-label').textContent = v.code ? ` · Raum ${v.code}` : '';
  renderTrump(v);
  renderOpponents(v);
  renderTrick(v);
  renderMe(v);
  renderScoreboard(v);
  $('status').textContent = statusText(v);
  $('btn-last-trick').disabled = !v.lastTrick;
  renderPhaseModal(v);
}

function renderTrump(v) {
  const box = $('trump-card');
  box.replaceChildren(v.trumpCard ? cardEl(v.trumpCard, { small: true }) : el('div', 'card small empty', '–'));
  const name = $('trump-name');
  name.className = v.trumpSuit ? `suit-text-${v.trumpSuit}` : '';
  name.textContent = v.phase === 'choose-trump' ? 'wird gewählt…' : v.trumpSuit ? SUIT_NAMES[v.trumpSuit] : 'kein Trumpf';
}

function isActive(v, i) {
  return ((v.phase === 'bidding' || v.phase === 'playing') && v.current === i)
    || (v.phase === 'choose-trump' && v.dealer === i);
}

function seatInfo(v, i) {
  const p = v.players[i];
  const wrap = el('div', 'seat-info');
  const head = el('div', 'seat-name');
  head.append(el('span', null, p.name));
  if (i === v.dealer) head.append(el('span', 'badge', 'Geber'));
  if (app.mode !== 'local' && v.seats && v.seats[i].bot) head.append(el('span', 'badge bot', 'Bot'));
  wrap.append(head);
  const stats = el('div', 'seat-stats');
  stats.innerHTML = `Ansage <b>${p.bid ?? '–'}</b> · Stiche <b>${p.tricks}</b> · <b>${p.score}</b> Pkt`;
  if (p.bid != null && v.phase !== 'bidding') {
    stats.classList.add(p.tricks === p.bid ? 'on-target' : p.tricks > p.bid ? 'over' : 'under');
  }
  wrap.append(stats);
  return wrap;
}

function renderOpponents(v) {
  const box = $('opponents');
  box.replaceChildren();
  for (let k = 1; k < v.n; k++) {
    const i = (app.me + k) % v.n; // im Uhrzeigersinn ab dem linken Nachbarn
    const seat = el('div', 'seat' + (isActive(v, i) ? ' active' : ''));
    seat.append(seatInfo(v, i));
    const backs = el('div', 'backs');
    for (let c = 0; c < v.players[i].handCount; c++) backs.append(el('div', 'card-back'));
    seat.append(backs);
    box.append(seat);
  }
}

function trickSlots(cards, winnerSeat, v, won) {
  return cards.map(t => {
    const slot = el('div', 'trick-slot' + (t.player === winnerSeat ? ' winning' : '') + (won && t.player === winnerSeat ? ' won' : ''));
    slot.append(cardEl(t.card), el('div', 'trick-name', isMe(t.player) ? 'Du' : nameOf(v, t.player)));
    return slot;
  });
}

function renderTrick(v) {
  const box = $('trick');
  const winner = v.trick.length ? v.trick[Rules.winnerIndex(v.trick, v.trumpSuit)].player : -1;
  box.replaceChildren(...trickSlots(v.trick, winner, v, v.phase === 'trick-complete'));
}

function renderMe(v) {
  const info = $('me-info');
  info.replaceChildren(seatInfo(v, app.me));
  info.className = isActive(v, app.me) ? 'active' : '';

  const hand = $('hand');
  hand.replaceChildren();
  const myTurn = v.phase === 'playing' && v.current === app.me;
  const legal = new Set(v.legal);
  for (const c of v.players[app.me].hand || []) {
    const d = cardEl(c, { button: true });
    if (myTurn && legal.has(c.id)) {
      d.classList.add('playable');
      d.addEventListener('click', () => playCard(c.id));
    } else {
      if (myTurn) d.classList.add('disabled');
      d.disabled = true;
    }
    hand.append(d);
  }
  renderBidPanel(v);
}

let acted = false; // verhindert Doppelklicks, bis der nächste Zustand kommt
function playCard(id) {
  if (acted) return;
  acted = true;
  setTimeout(() => { acted = false; }, 400);
  send({ t: 'play', id });
}

function renderBidPanel(v) {
  const panel = $('bid-panel');
  const show = v.phase === 'bidding' && v.current === app.me;
  panel.classList.toggle('hidden', !show);
  if (!show) return;
  panel.replaceChildren(el('div', 'bid-title', 'Wie viele Stiche machst du?'));
  const row = el('div', 'bid-buttons');
  for (let b = 0; b <= v.round; b++) {
    const btn = button(String(b), 'btn bid', () => {
      row.querySelectorAll('button').forEach(x => { x.disabled = true; });
      send({ t: 'bid', v: b });
    });
    if (b === v.forbiddenBid) {
      btn.disabled = true;
      btn.title = 'Geber-Regel: diese Ansage ist nicht erlaubt';
    }
    row.append(btn);
  }
  panel.append(row);
  const sum = v.players.reduce((s, p) => s + (p.bid ?? 0), 0);
  panel.append(el('div', 'bid-hint', `Bisher angesagt: ${sum} von ${v.round} Stichen`));
}

function renderScoreboard(v) {
  const sb = $('scoreboard');
  const table = el('table', 'scores');
  const hr = el('tr');
  hr.append(el('th', null, '#'));
  v.players.forEach(p => hr.append(el('th', null, p.name)));
  const thead = el('thead');
  thead.append(hr);
  const tbody = el('tbody');
  v.history.forEach((row, r) => {
    const tr = el('tr');
    tr.append(el('td', 'rn', String(r + 1)));
    row.forEach(e => {
      const td = el('td', e.delta > 0 ? 'hit' : 'miss');
      td.innerHTML = `<span class="total">${e.score}</span><span class="detail">${e.bid}/${e.tricks}</span>`;
      tr.append(td);
    });
    tbody.append(tr);
  });
  if (v.phase !== 'round-complete' && v.phase !== 'game-over') {
    const tr = el('tr', 'current');
    tr.append(el('td', 'rn', String(v.round)));
    v.players.forEach(p => {
      const td = el('td');
      td.innerHTML = `<span class="detail">${p.bid ?? '–'}/${p.tricks}</span>`;
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  sb.replaceChildren(el('h2', null, 'Punktetafel'), el('div', 'legend', 'Gesamt · Ansage/Stiche'), table,
    button('Schließen', 'btn small close-scores', () => sb.classList.remove('open')));
}

// ---------- Dialoge ----------
function showModal(build, key = null) {
  const box = $('modal-content');
  box.replaceChildren();
  build(box);
  app.modalKey = key;
  const wasHidden = $('modal').classList.contains('hidden');
  $('modal').classList.remove('hidden');
  const btn = box.querySelector('button:not(:disabled)');
  if (btn && wasHidden) btn.focus();
}
function hideModal() {
  $('modal').classList.add('hidden');
  app.modalKey = null;
}

function renderPhaseModal(v) {
  if (v.phase === 'choose-trump' && isMe(v.dealer)) {
    const key = `phase:trump:${v.round}`;
    if (app.modalKey !== key) showModal(box => buildTrumpChoice(box, v), key);
  } else if (v.phase === 'round-complete' || v.phase === 'game-over') {
    showModal(box => buildSummary(box, v), `phase:summary:${v.round}`);
  } else if (app.modalKey && app.modalKey.startsWith('phase:')) {
    hideModal();
  }
}

function buildTrumpChoice(box, v) {
  box.append(el('h2', null, 'Trumpf wählen'), el('p', null, 'Ein Zauberer wurde aufgedeckt. Als Geber bestimmst du die Trumpffarbe.'));
  const row = el('div', 'trump-buttons');
  for (const s of SUITS) {
    row.append(button(SUIT_NAMES[s], `btn suit-btn suit-${s}`, () => {
      row.querySelectorAll('button').forEach(x => { x.disabled = true; });
      send({ t: 'trump', suit: s });
    }));
  }
  const preview = el('div', 'hand-preview');
  (v.players[app.me].hand || []).forEach(c => preview.append(cardEl(c, { small: true })));
  box.append(row, el('p', 'muted', 'Deine Karten:'), preview);
}

function buildSummary(box, v) {
  const over = v.phase === 'game-over';
  const last = v.history[v.history.length - 1];
  const online = app.mode !== 'local';
  const ready = new Set(v.ready);
  box.append(el('h2', null, over ? 'Spielende' : `Runde ${v.round} beendet`));

  const t = el('table', 'summary');
  t.innerHTML = '<thead><tr><th>Spieler</th><th>Ansage</th><th>Stiche</th><th>Runde</th><th>Gesamt</th>'
    + (online && !over ? '<th>Bereit</th>' : '') + '</tr></thead>';
  const tb = el('tbody');
  v.players.forEach((p, i) => {
    const e = last[i];
    const tr = el('tr');
    const cells = [
      [isMe(i) ? `${p.name} (Du)` : p.name], [e.bid], [e.tricks],
      [`${e.delta > 0 ? '+' : ''}${e.delta}`, e.delta > 0 ? 'hit' : 'miss'], [e.score, 'strong'],
    ];
    if (online && !over) cells.push([v.seats[i].bot || ready.has(i) ? '✓' : '…', 'ready']);
    for (const [text, cls] of cells) tr.append(el('td', cls, String(text)));
    tb.append(tr);
  });
  t.append(tb);
  box.append(t);

  const actions = el('div', 'modal-actions');
  if (over) {
    const rank = v.players.map((p, i) => ({ name: isMe(i) ? 'Du' : p.name, score: p.score })).sort((a, b) => b.score - a.score);
    const top = rank[0].score;
    const winners = rank.filter(r => r.score === top).map(r => r.name);
    const text = winners.length > 1 ? `Gleichstand: ${winners.join(', ')} gewinnen!`
      : winners[0] === 'Du' ? `Du gewinnst mit ${top} Punkten!` : `${winners[0]} gewinnt mit ${top} Punkten!`;
    box.append(el('p', 'winner', text));
    const ol = el('ol', 'ranking');
    rank.forEach(r => ol.append(el('li', null, `${r.name} – ${r.score} Punkte`)));
    box.append(ol);
    if (app.host) actions.append(button('Nochmal spielen', 'btn primary', () => send({ t: 'restart' })));
    else box.append(el('p', 'muted', 'Der Host kann eine neue Partie starten.'));
    actions.append(button('Zum Menü', 'btn', leave));
  } else {
    const meReady = ready.has(app.me);
    const label = meReady ? 'Warte auf die anderen …' : online ? 'Bereit für die nächste Runde' : 'Nächste Runde';
    const b = button(label, 'btn primary', () => { b.disabled = true; send({ t: 'ready' }); });
    b.disabled = meReady;
    actions.append(b);
  }
  box.append(actions);
}

function showLastTrick() {
  const v = app.view;
  if (!v || !v.lastTrick) return;
  showModal(box => {
    const w = v.lastTrick.winner;
    box.append(el('h2', null, 'Letzter Stich'), el('p', null, isMe(w) ? 'Gewonnen von dir' : `Gewonnen von ${nameOf(v, w)}`));
    const row = el('div', 'trick-preview');
    row.append(...trickSlots(v.lastTrick.cards, w, v, false));
    const actions = el('div', 'modal-actions');
    actions.append(button('Schließen', 'btn primary', hideModal));
    box.append(row, actions);
  });
}

function showMessage(title, text) {
  showModal(box => {
    box.append(el('h2', null, title), el('p', null, text));
    const actions = el('div', 'modal-actions');
    actions.append(button('OK', 'btn primary', hideModal));
    box.append(actions);
  });
}

// ---------- Lobby ----------
function onLobby(lobby, me) {
  app.lobby = lobby;
  app.me = me;
  showScreen('lobby');
  renderLobby();
}

function inviteLink(code) {
  return location.href.split(/[?#]/)[0] + '?room=' + code;
}

function renderLobby() {
  const l = app.lobby;
  const isHost = app.mode === 'host';
  $('lobby-status').textContent = !l ? (isHost ? 'Raum wird erstellt …' : 'Verbinde mit dem Raum …')
    : isHost ? 'Teile den Code oder Link mit deinen Mitspielern.' : 'Du bist im Raum.';
  $('lobby-code-box').classList.toggle('hidden', !l || !l.code);
  $('lobby-code').textContent = l && l.code ? l.code : '';

  const list = $('lobby-players');
  list.replaceChildren();
  (l ? l.players : []).forEach((p, i) => {
    const li = el('li');
    li.append(el('span', null, p.name + (isMe(i) ? ' (Du)' : '')));
    if (i === 0) li.append(el('span', 'badge', 'Host'));
    if (p.bot) li.append(el('span', 'badge bot', 'Bot'));
    list.append(li);
  });

  const count = l ? l.players.length : 0;
  $('lobby-host-actions').classList.toggle('hidden', !isHost || !l);
  $('btn-add-bot').disabled = count >= MAX_PLAYERS;
  $('btn-remove-bot').disabled = !l || !l.players.some(p => p.bot);
  $('btn-start').disabled = count < MIN_PLAYERS;
  $('lobby-hint').textContent = !l ? ''
    : isHost ? (count < MIN_PLAYERS ? `Mindestens ${MIN_PLAYERS} Spieler nötig (${count}/${MAX_PLAYERS}). Fülle mit Bots auf oder warte auf Mitspieler.` : `${count}/${MAX_PLAYERS} Spieler – bereit zum Start.`)
      : 'Warte, bis der Host das Spiel startet …';
}

// ---------- Starten / Beitreten / Verlassen ----------
function readSettings() {
  const name = $('player-name').value.trim().slice(0, 16);
  const settings = {
    name, bots: Number($('bot-count').value), speed: $('speed').value, dealerRule: $('dealer-rule').checked,
  };
  try { localStorage.setItem('wizard-settings', JSON.stringify(settings)); } catch (e) { /* egal */ }
  return settings;
}

function setupError(text) { $('setup-error').textContent = text || ''; }

function requireName(s) {
  if (s.name) return true;
  setupError('Bitte gib einen Namen ein.');
  $('player-name').focus();
  return false;
}

function newHost(s) {
  return new HostController({
    name: s.name, speed: SPEEDS[s.speed] || SPEEDS.normal, dealerRule: s.dealerRule, onView, onLobby,
  });
}

function startLocal() {
  const s = readSettings();
  if (!requireName(s)) return;
  leave();
  app.mode = 'local';
  app.host = newHost(s);
  for (let i = 0; i < s.bots; i++) app.host.addBot();
  app.host.start();
}

function createRoom() {
  const s = readSettings();
  if (!requireName(s)) return;
  leave();
  app.mode = 'host';
  const host = app.host = newHost(s);
  showScreen('lobby');
  renderLobby();
  createHostPeer((peer, code) => {
    if (app.host !== host) { peer.destroy(); return; }
    host.attachPeer(peer, code);
    host.syncLobby();
  }, err => {
    if (app.host !== host) return;
    leave();
    setupError(err);
  });
}

function joinRoom() {
  const s = readSettings();
  if (!requireName(s)) return;
  const code = $('room-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    setupError('Bitte gib den 5-stelligen Raumcode ein.');
    $('room-code').focus();
    return;
  }
  leave();
  app.mode = 'guest';
  showScreen('lobby');
  renderLobby();
  app.guest = new GuestConnection(code, s.name, {
    onMessage(msg) {
      if (msg.t === 'lobby') onLobby(msg.lobby, msg.you);
      else if (msg.t === 'state') onView(msg.view, msg.you);
      else if (msg.t === 'error') { leave(); setupError(msg.msg); }
    },
    onClose() {
      const inGame = !!app.view;
      leave();
      if (inGame) showMessage('Verbindung getrennt', 'Die Verbindung zum Host wurde getrennt.');
      else setupError('Die Verbindung zum Raum wurde getrennt.');
    },
    onError(text) { leave(); setupError(text); },
  });
}

function leave() {
  if (app.host) app.host.destroy();
  if (app.guest) app.guest.destroy();
  Object.assign(app, { mode: null, host: null, guest: null, me: 0, view: null, lobby: null });
  hideModal();
  $('scoreboard').classList.remove('open');
  setupError('');
  showScreen('setup');
}

function confirmLeave() {
  const text = app.mode === 'host' ? 'Spiel verlassen? Der Raum wird für alle geschlossen.' : 'Spiel verlassen und zum Menü zurückkehren?';
  if (confirm(text)) leave();
}

// ---------- Init ----------
(function init() {
  try {
    const s = JSON.parse(localStorage.getItem('wizard-settings') || 'null');
    if (s) {
      if (s.name) $('player-name').value = s.name;
      if (s.bots) $('bot-count').value = String(s.bots);
      if (s.speed) $('speed').value = s.speed;
      $('dealer-rule').checked = !!s.dealerRule;
    }
  } catch (e) { /* egal */ }

  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    $('room-code').value = room.toUpperCase().slice(0, 5);
    $('btn-join').classList.add('primary');
  }

  $('setup-form').addEventListener('submit', e => { e.preventDefault(); room ? joinRoom() : startLocal(); });
  $('btn-local').addEventListener('click', startLocal);
  $('btn-host').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('room-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinRoom(); } });

  $('btn-add-bot').addEventListener('click', () => app.host && app.host.addBot());
  $('btn-remove-bot').addEventListener('click', () => app.host && app.host.removeBot());
  $('btn-start').addEventListener('click', () => app.host && app.host.start());
  $('btn-leave-lobby').addEventListener('click', leave);
  $('btn-copy').addEventListener('click', async () => {
    const link = inviteLink(app.lobby.code);
    try {
      await navigator.clipboard.writeText(link);
      $('btn-copy').textContent = 'Link kopiert ✓';
    } catch (e) {
      prompt('Einladungslink:', link);
    }
    setTimeout(() => { $('btn-copy').textContent = 'Einladungslink kopieren'; }, 2000);
  });

  $('btn-scores').addEventListener('click', () => $('scoreboard').classList.toggle('open'));
  $('btn-last-trick').addEventListener('click', showLastTrick);
  $('btn-leave').addEventListener('click', confirmLeave);
})();
