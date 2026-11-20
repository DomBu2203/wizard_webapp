// Wizard – Spielregeln und Spielzustand (ohne DOM).
'use strict';

const SUITS = ['red', 'blue', 'green', 'yellow'];
const SUIT_NAMES = { red: 'Rot', blue: 'Blau', green: 'Grün', yellow: 'Gelb' };

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let v = 1; v <= 13; v++) deck.push({ id: `${suit}-${v}`, type: 'num', suit, value: v });
  }
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `wizard-${i}`, type: 'wizard', suit: null, value: 14 });
    deck.push({ id: `jester-${i}`, type: 'jester', suit: null, value: 0 });
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const Rules = {
  // Die zu bedienende Farbe: erste Zahlenkarte, außer ein Zauberer kam vorher (dann frei).
  leadSuit(trick) {
    for (const { card } of trick) {
      if (card.type === 'jester') continue;
      if (card.type === 'wizard') return null;
      return card.suit;
    }
    return null;
  },

  legalCards(hand, trick) {
    const ls = Rules.leadSuit(trick);
    if (!ls || !hand.some(c => c.type === 'num' && c.suit === ls)) return hand.slice();
    return hand.filter(c => c.type !== 'num' || c.suit === ls);
  },

  // Index (im Stich) der aktuell gewinnenden Karte.
  winnerIndex(trick, trump) {
    const w = trick.findIndex(p => p.card.type === 'wizard');
    if (w >= 0) return w;
    let best = -1;
    trick.forEach((p, i) => {
      const c = p.card;
      if (c.type !== 'num') return;
      if (best < 0) { best = i; return; }
      const b = trick[best].card;
      if (c.suit === b.suit ? c.value > b.value : (trump && c.suit === trump)) best = i;
    });
    return best < 0 ? 0 : best; // nur Narren: der erste gewinnt
  },

  score(bid, tricks) {
    return bid === tricks ? 20 + 10 * tricks : -10 * Math.abs(bid - tricks);
  },
};

class WizardGame {
  constructor({ names, dealerRule = false }) {
    this.players = names.map(name => ({ name, hand: [], bid: null, tricks: 0, score: 0 }));
    this.n = names.length;
    this.totalRounds = 60 / this.n;
    this.dealerRule = dealerRule;
    this.round = 0;
    this.dealer = Math.floor(Math.random() * this.n) - 1; // wird in startRound weitergerückt
    this.history = []; // pro Runde: [{bid, tricks, delta, score}] je Spieler
    this.phase = 'idle';
  }

  next(i) { return (i + 1) % this.n; }

  startRound() {
    this.round++;
    this.dealer = (this.dealer + 1 + this.n) % this.n;
    const deck = shuffle(createDeck());
    for (const p of this.players) { p.hand = []; p.bid = null; p.tricks = 0; }
    let seat = this.next(this.dealer);
    for (let k = 0; k < this.round * this.n; k++) {
      this.players[seat].hand.push(deck.pop());
      seat = this.next(seat);
    }
    this.trumpCard = deck.length ? deck.pop() : null;
    this.trumpSuit = this.trumpCard && this.trumpCard.type === 'num' ? this.trumpCard.suit : null;
    this.trick = [];
    this.lastTrick = null;
    this.tricksPlayed = 0;
    this.trickWinner = null;
    this.current = this.next(this.dealer);
    if (this.trumpCard && this.trumpCard.type === 'wizard') {
      this.phase = 'choose-trump';
    } else {
      this.phase = 'bidding';
      this.sortHands();
    }
  }

  chooseTrump(suit) {
    if (this.phase !== 'choose-trump' || !SUITS.includes(suit)) throw new Error('Ungültige Trumpfwahl');
    this.trumpSuit = suit;
    this.phase = 'bidding';
    this.sortHands();
  }

  sortHands() {
    const order = [this.trumpSuit, ...SUITS.filter(s => s !== this.trumpSuit)];
    const rank = c => c.type === 'wizard' ? -1 : c.type === 'jester' ? 99 : order.indexOf(c.suit);
    for (const p of this.players) {
      p.hand.sort((a, b) => rank(a) - rank(b) || b.value - a.value);
    }
  }

  // Ansage, die dem Geber mit der Geber-Regel verboten ist (oder null).
  forbiddenBid() {
    if (!this.dealerRule || this.current !== this.dealer) return null;
    const sum = this.players.reduce((s, p) => s + (p.bid ?? 0), 0);
    const f = this.round - sum;
    return f >= 0 ? f : null;
  }

  placeBid(bid) {
    if (this.phase !== 'bidding') throw new Error('Keine Ansagephase');
    if (!Number.isInteger(bid) || bid < 0 || bid > this.round || bid === this.forbiddenBid()) {
      throw new Error('Ungültige Ansage');
    }
    this.players[this.current].bid = bid;
    if (this.current === this.dealer) {
      this.phase = 'playing';
      this.current = this.next(this.dealer);
    } else {
      this.current = this.next(this.current);
    }
  }

  legalCards(playerIdx = this.current) {
    return Rules.legalCards(this.players[playerIdx].hand, this.trick);
  }

  playCard(cardId) {
    if (this.phase !== 'playing') throw new Error('Keine Spielphase');
    const p = this.players[this.current];
    const card = this.legalCards().find(c => c.id === cardId);
    if (!card) throw new Error('Karte nicht erlaubt');
    p.hand.splice(p.hand.indexOf(card), 1);
    this.trick.push({ player: this.current, card });
    if (this.trick.length === this.n) {
      this.trickWinner = this.trick[Rules.winnerIndex(this.trick, this.trumpSuit)].player;
      this.phase = 'trick-complete';
    } else {
      this.current = this.next(this.current);
    }
    return card;
  }

  finishTrick() {
    if (this.phase !== 'trick-complete') throw new Error('Kein fertiger Stich');
    const w = this.trickWinner;
    this.players[w].tricks++;
    this.lastTrick = { cards: this.trick, winner: w };
    this.trick = [];
    this.trickWinner = null;
    this.tricksPlayed++;
    if (this.tricksPlayed === this.round) {
      this.scoreRound();
      this.phase = this.round === this.totalRounds ? 'game-over' : 'round-complete';
    } else {
      this.current = w;
      this.phase = 'playing';
    }
  }

  scoreRound() {
    this.history.push(this.players.map(p => {
      const delta = Rules.score(p.bid, p.tricks);
      p.score += delta;
      return { bid: p.bid, tricks: p.tricks, delta, score: p.score };
    }));
  }

  // Was ein Spieler sehen darf: nur die eigene Hand, sonst Kartenanzahl.
  viewFor(seat) {
    const myTurn = this.current === seat;
    return {
      n: this.n, round: this.round, totalRounds: this.totalRounds, dealer: this.dealer,
      current: this.current, phase: this.phase, dealerRule: this.dealerRule,
      trumpCard: this.trumpCard, trumpSuit: this.trumpSuit,
      trick: this.trick, trickWinner: this.trickWinner, lastTrick: this.lastTrick, history: this.history,
      players: this.players.map((p, i) => ({
        name: p.name, bid: p.bid, tricks: p.tricks, score: p.score,
        handCount: p.hand.length, hand: i === seat ? p.hand : null,
      })),
      legal: this.phase === 'playing' && myTurn ? this.legalCards(seat).map(c => c.id) : [],
      forbiddenBid: this.phase === 'bidding' && myTurn ? this.forbiddenBid() : null,
    };
  }

  ranking() {
    return this.players.map((p, i) => ({ ...p, index: i })).sort((a, b) => b.score - a.score);
  }
}
