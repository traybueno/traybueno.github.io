/** Game state plumbing: the seeded shuffle, the decks, the draw and the hidden-information view. Knows nothing about what a card does. */
import { DECK } from './cards.js?v=ad16557';

function rnd(state) {                       // mulberry32; the generator state lives in the game so it snapshots
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const makeDeck = (owner, list) => Object.entries(list).flatMap(([key, count]) => Array.from({ length: count }, (_, n) => ({ id: `${owner}-${key}-${n + 1}`, key, owner })));

/** A blank game: two shuffled decks and a Heart each. rules.js `initialize` deals the opening position. */
export function blankGame(seed = 1, deck = DECK) {
  const s = { settings: { deck }, rng: seed >>> 0, players: [0, 1].map((idx) => ({ idx, hearts: [{ id: `${idx}-heart-1`, key: 'heart', owner: idx }], field: [], hand: [], deck: [], discard: [], chain: [] })), turn: 0, turnNumber: 1, phase: 'play', winner: null, events: [] };
  for (const p of s.players) p.deck = shuffle(s, makeDeck(p.idx, deck));
  return s;
}
/** Draw `n` cards into `p`'s hand (the top of the pile is the end of the array). No reshuffle: an empty pile draws nothing, and says so once with a 'dry' event. */
export function drawCards(state, p, n) {
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      if (!p.dry) { p.dry = true; state.events.push({ t: 'dry', p: p.idx }); }
      return;
    }
    const c = p.deck.pop();
    p.hand.push(c);
    state.events.push({ t: 'draw', id: c.id, p: p.idx });
  }
}
/** What `viewer` may see: the other player's hand and both draw piles with their cards hidden (a hidden card is named by its place, since a card's id spells out the card). Chains, fields and discards are public. */
export function viewFor(s, viewer) {
  const v = JSON.parse(JSON.stringify(s));
  const hide = (c, zone, i) => ({ id: `h${c.owner}-${zone}-${i}`, owner: c.owner, hidden: true });
  v.rng = 1; v.viewer = viewer;
  for (const p of v.players) {
    p.deck = p.deck.map((c, i) => hide(c, 'deck', i));
    if (p.idx !== viewer) p.hand = p.hand.map((c, i) => hide(c, 'hand', i));
  }
  // The events name cards by their real ids, so the other player's draws are redacted to the place the card now holds in their hand. Cards that became public (played, defeated, in a discard pile or a Chain) keep theirs.
  const seen = [0, 0], total = [0, 1].map((i) => s.events.filter((e) => e.t === 'draw' && e.p === i).length);
  v.events = v.events.map((e) => {
    if (e.t !== 'draw' || e.p === viewer) return e;
    const hand = v.players[e.p].hand, at = hand.length - total[e.p] + seen[e.p]++;
    return { t: 'draw', p: e.p, id: hand[at].id, hidden: true };
  });
  return v;
}
