// Computergegner.
//
// Entscheidungen (Ansage, Karte, Trumpfwahl) per Monte-Carlo-Suche:
// Der Bot verteilt die ihm unbekannten Karten viele Male zufällig auf die Gegner –
// passend zu allem, was er weiß (gespielte Karten, aufgedeckter Trumpf, Farben, die
// ein Spieler nicht bedienen konnte) – und spielt jede Option bis zum Rundenende
// durch. Gewählt wird die Option mit dem besten durchschnittlichen Rundenergebnis.
// Für das Durchspielen nutzt er eine schnelle Faustregel-Strategie.
'use strict';

const AI = {
  config: {
    timeBudget: 200, // ms Rechenzeit pro Entscheidung
    minSamples: 16,
    maxSamples: 400,
  },

  // ---------- Faustregeln (schnell, für Simulationen) ----------

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

  heuristicBid(hand, trump, n) {
    const est = hand.reduce((s, c) => s + AI.cardTrickChance(c, trump, n), 0);
    return Math.max(0, Math.min(hand.length, Math.round(est)));
  },

  strength(c, trump, leadSuit) {
    if (c.type === 'wizard') return 100;
    if (c.type === 'jester') return 0;
    if (trump && c.suit === trump) return 40 + c.value;
    if (leadSuit && c.suit === leadSuit) return 20 + c.value;
    return c.value;
  },

  // Würde `card` den aktuellen Stich übernehmen? (best = Index der führenden Karte)
  beats(card, trick, best, trump) {
    if (!trick.length) return true;
    const b = trick[best].card;
    if (b.type === 'wizard') return false;
    if (card.type === 'wizard') return true;
    if (card.type === 'jester') return false;
    if (b.type === 'jester') return true; // bisher nur Narren
    if (card.suit === b.suit) return card.value > b.value;
    return !!trump && card.suit === trump;
  },

  heuristicCard(hand, trick, trump, wantsTricks, n) {
    const legal = Rules.legalCards(hand, trick);
    if (legal.length === 1) return legal[0];
    const ls = Rules.leadSuit(trick);
    const str = c => AI.strength(c, trump, ls);
    legal.sort((a, b) => str(a) - str(b));
    if (!trick.length) return wantsTricks ? legal[legal.length - 1] : legal[0];

    const best = Rules.winnerIndex(trick, trump);
    const winners = [], losers = [];
    for (const c of legal) (AI.beats(c, trick, best, trump) ? winners : losers).push(c);
    const playersAfter = n - trick.length - 1;

    if (wantsTricks) {
      if (!winners.length) return losers[0];
      if (playersAfter === 0) return winners[0];
      const safe = winners.find(c => str(c) >= (trump ? 50 : 32));
      return safe || winners[winners.length - 1];
    }
    if (losers.length) return losers[losers.length - 1];
    return winners[0];
  },

  // ---------- Wissen des Bots ----------

  knowledge(game, me) {
    const seen = new Set(game.players[me].hand.map(c => c.id));
    if (game.trumpCard) seen.add(game.trumpCard.id);
    const tricks = [...(game.roundTricks || []).map(t => t.cards), game.trick];
    const voids = game.players.map(() => new Set());
    for (const t of tricks) {
      t.forEach((play, k) => {
        seen.add(play.card.id);
        const ls = Rules.leadSuit(t.slice(0, k));
        if (ls && play.card.type === 'num' && play.card.suit !== ls) voids[play.player].add(ls);
      });
    }
    const playing = game.phase === 'playing';
    return {
      me,
      n: game.n,
      trump: game.trumpSuit,
      pool: createDeck().filter(c => !seen.has(c.id)),
      counts: game.players.map((p, i) => (i === me ? 0 : p.hand.length)),
      voids,
      myHand: game.players[me].hand,
      bids: game.players.map(p => p.bid),
      tricks: game.players.map(p => p.tricks),
      trick: playing ? game.trick.slice() : [],
      current: playing ? game.current : (game.dealer + 1) % game.n,
    };
  },

  // Verteilt die unbekannten Karten zufällig, passend zu den bekannten Fehlfarben.
  sampleHands(k) {
    const total = k.counts.reduce((a, b) => a + b, 0);
    for (let attempt = 0; attempt < 40; attempt++) {
      const ignoreVoids = attempt >= 30;
      const hands = k.counts.map(() => []);
      const cap = k.counts.slice();
      let undealt = k.pool.length - total;
      let ok = true;
      for (const card of shuffle(k.pool.slice())) {
        let weight = undealt;
        const allowed = [];
        for (let i = 0; i < k.n; i++) {
          if (cap[i] > 0 && (ignoreVoids || card.type !== 'num' || !k.voids[i].has(card.suit))) {
            allowed.push(i);
            weight += cap[i];
          }
        }
        if (weight === 0) { ok = false; break; }
        let r = Math.random() * weight;
        let target = -1;
        for (const i of allowed) {
          r -= cap[i];
          if (r < 0) { target = i; break; }
        }
        if (target < 0) undealt--;
        else { hands[target].push(card); cap[target]--; }
      }
      if (ok) {
        hands[k.me] = k.myHand.slice();
        return hands;
      }
    }
    return null;
  },

  // Spielt die Runde mit Faustregeln zu Ende und liefert die Punkte des Bots.
  rollout(st, me) {
    const { n, trump, hands, bids, tricks } = st;
    let trick = st.trick;
    let cur = st.current;
    let forced = st.forced;
    for (;;) {
      if (trick.length === n) {
        const w = trick[Rules.winnerIndex(trick, trump)].player;
        tricks[w]++;
        trick = [];
        cur = w;
      }
      const hand = hands[cur];
      if (!hand.length) break;
      let card;
      if (cur === me && forced) { card = forced; forced = null; }
      else card = AI.heuristicCard(hand, trick, trump, bids[cur] - tricks[cur] > 0, n);
      hand.splice(hand.indexOf(card), 1);
      trick.push({ player: cur, card });
      cur = (cur + 1) % n;
    }
    return Rules.score(bids[me], tricks[me]);
  },

  // Bewertet Optionen: apply(state, option) verändert den Startzustand je Option.
  evaluate(game, options, apply) {
    const me = game.phase === 'choose-trump' ? game.dealer : game.current;
    const k = AI.knowledge(game, me);
    const sums = new Array(options.length).fill(0);
    const { timeBudget, minSamples, maxSamples } = AI.config;
    const t0 = performance.now();
    let samples = 0;
    while (samples < maxSamples && (samples < minSamples || performance.now() - t0 < timeBudget)) {
      const hands = AI.sampleHands(k);
      if (!hands) break;
      options.forEach((opt, i) => {
        const st = {
          n: k.n, trump: k.trump, hands: hands.map(h => h.slice()), bids: k.bids.slice(),
          tricks: k.tricks.slice(), trick: k.trick.slice(), current: k.current, forced: null,
        };
        apply(st, opt);
        for (let p = 0; p < k.n; p++) {
          if (st.bids[p] == null) st.bids[p] = AI.heuristicBid(st.hands[p], st.trump, k.n);
        }
        sums[i] += AI.rollout(st, me);
      });
      samples++;
    }
    return sums;
  },

  argmax(arr) {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
  },

  // ---------- Entscheidungen ----------

  chooseBid(game) {
    const forbidden = game.forbiddenBid();
    const options = [];
    for (let b = 0; b <= game.round; b++) if (b !== forbidden) options.push(b);
    if (options.length === 1) return options[0];
    const sums = AI.evaluate(game, options, (st, b) => { st.bids[game.current] = b; });
    return options[AI.argmax(sums)];
  },

  chooseCard(game) {
    const legal = game.legalCards();
    if (legal.length === 1) return legal[0];
    const sums = AI.evaluate(game, legal, (st, card) => { st.forced = card; });
    return legal[AI.argmax(sums)];
  },

  chooseTrump(game) {
    const sums = AI.evaluate(game, SUITS, (st, suit) => { st.trump = suit; });
    return SUITS[AI.argmax(sums)];
  },
};
