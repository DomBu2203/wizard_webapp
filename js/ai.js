// Einfache Computergegner (heuristisch).
'use strict';

const AI = {
  // Grobe Wahrscheinlichkeit, mit dieser Karte einen Stich zu machen.
  cardTrickChance(c, trump, n) {
    if (c.type === 'wizard') return 0.95;
    if (c.type === 'jester') return 0;
    const crowd = n <= 3 ? 1.1 : n <= 4 ? 1 : 0.8;
    if (trump && c.suit === trump) {
      const base = c.value >= 12 ? 0.9 : c.value >= 10 ? 0.7 : c.value >= 7 ? 0.45 : 0.2;
      return Math.min(0.95, base * crowd);
    }
    const base = c.value === 13 ? 0.7 : c.value === 12 ? 0.45 : c.value === 11 ? 0.2 : c.value >= 9 ? 0.07 : 0.02;
    return base * crowd * (trump ? 0.8 : 1.1);
  },

  chooseBid(game) {
    const p = game.players[game.current];
    let est = p.hand.reduce((s, c) => s + AI.cardTrickChance(c, game.trumpSuit, game.n), 0);
    let bid = Math.max(0, Math.min(game.round, Math.round(est)));
    const forbidden = game.forbiddenBid();
    if (bid === forbidden) {
      const up = bid + 1 <= game.round ? bid + 1 : null;
      const down = bid - 1 >= 0 ? bid - 1 : null;
      bid = (est >= bid && up !== null) || down === null ? up : down;
    }
    return bid;
  },

  chooseTrump(game) {
    const hand = game.players[game.dealer].hand;
    let best = SUITS[0], bestScore = -1;
    for (const s of SUITS) {
      const cards = hand.filter(c => c.suit === s);
      const score = cards.length * 10 + cards.reduce((a, c) => a + c.value, 0);
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return best;
  },

  strength(c, trump, leadSuit) {
    if (c.type === 'wizard') return 100;
    if (c.type === 'jester') return 0;
    if (trump && c.suit === trump) return 40 + c.value;
    if (leadSuit && c.suit === leadSuit) return 20 + c.value;
    return c.value;
  },

  chooseCard(game) {
    const idx = game.current;
    const p = game.players[idx];
    const legal = game.legalCards(idx);
    const trick = game.trick;
    const trump = game.trumpSuit;
    const ls = Rules.leadSuit(trick);
    const str = c => AI.strength(c, trump, ls);
    const asc = arr => arr.slice().sort((a, b) => str(a) - str(b));
    const wantsTricks = p.bid - p.tricks > 0;
    const playersAfter = game.n - trick.length - 1;

    // Ausspielen
    if (trick.length === 0) {
      const sorted = asc(legal);
      return wantsTricks ? sorted[sorted.length - 1] : sorted[0];
    }

    const wins = c => Rules.winnerIndex([...trick, { player: idx, card: c }], trump) === trick.length;
    const winners = asc(legal.filter(wins));
    const losers = asc(legal.filter(c => !wins(c)));

    if (wantsTricks) {
      if (!winners.length) return losers[0]; // schwächste Karte abwerfen
      if (playersAfter === 0) return winners[0]; // Letzter: knappste Gewinnkarte
      // Sonst eine Karte, die wahrscheinlich hält
      const safe = winners.find(c => str(c) >= (trump ? 50 : 32));
      return safe || winners[winners.length - 1];
    }
    // Keine Stiche mehr gewollt: höchste Karte, die sicher verliert
    if (losers.length) return losers[losers.length - 1];
    // Alles würde gewinnen: niedrigste und auf Überstechen hoffen
    return winners[0];
  },
};
