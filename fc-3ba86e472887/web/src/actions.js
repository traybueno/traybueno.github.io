/**
 * What the player can do, read off the engine's `legalMoves`. Pure: no rules here, only a translation of the moves the engine offers into what a hand
 * can do on a table: which cards can be picked up, where each can be dropped, and what has to be asked next when a drop leaves more than one move.
 *
 *   source  a card the player can pick up (a hand card, a ready creature on the board, or the head spell of a resolving Chain)
 *   drop    a place a source can be dropped: a card, a Chain slot, a discard pile, or the player's own field
 *   step    what happens after a drop: commit the one move left, or ask for a second choice
 */
import { locate, CARDS } from '../../src/index.js?v=4690f3a';

export const dropKey = {
  card: (id) => `card:${id}`,
  slot: (owner, index) => `slot:${owner}:${index}`,
  pile: (owner) => `pile:${owner}`,
  field: () => 'zone:field',
};
const SPELL_MOVES = ['fireball', 'shift', 'kiss', 'rally', 'behind', 'shadow'];

/** The card a move is made with, or null for a move with no card (End turn, Release, Recover, Skip). */
export function sourceOf(view, move, seat) {
  if (move.cardId) return move.cardId;
  if (move.type === 'shadow') return move.attackerId;                                       // a Shadow Step is a plain attack: the attacker is dragged onto its target
  if (SPELL_MOVES.includes(move.type)) return view.players[seat].chain[0]?.id ?? null;     // the head spell of a resolving Chain
  return null;
}

/** Sort the moves into sources (card id -> its moves) and the buttons that apply. */
export function analyze(view, moves, seat) {
  const sources = new Map(), buttons = { end: null, release: null, recover: null, skip: null };
  for (const m of moves) {
    if (m.type === 'end') buttons.end = m;
    else if (m.type === 'release') buttons.release = m;
    else if (m.type === 'recover') buttons.recover = m;
    else if (m.type === 'skip' || m.type === 'decline') buttons.skip = m;
    else if (m.type === 'behind') continue;                              // never picked up or dropped: it has no choice in it, the front end plays it when it is the head of the Chain
    else { const id = sourceOf(view, m, seat); if (id) (sources.get(id) ?? sources.set(id, []).get(id)).push(m); }
  }
  return { sources, buttons };
}

/** Where a move is dropped. `open`: the discard piles are spread out, so a card in one is a place of its own (otherwise the pile is, and the card is asked next). */
export function dropOf(view, move, seat, { open = false } = {}) {
  switch (move.type) {
    case 'deploy': return move.dest === 'guard' ? { type: 'card', id: move.targetId } : { type: 'field' };
    case 'reguard': return move.dest === 'none' ? { type: 'field' } : { type: 'card', id: move.targetId };
    case 'wind': return { type: 'slot', owner: seat, index: move.pos };
    case 'behind': return { type: 'field' };                            // never dragged: the front end plays it by itself when it is the head of the Chain
    default: {                                                         // attack, and every spell: onto its target
      const at = locate(view, move.targetId);
      return at && at.zone === 'discard' && !open ? { type: 'pile', owner: at.p.idx } : { type: 'card', id: move.targetId };
    }
  }
}
export const keyOfDrop = (d) => (d.type === 'card' ? dropKey.card(d.id) : d.type === 'slot' ? dropKey.slot(d.owner, d.index) : d.type === 'pile' ? dropKey.pile(d.owner) : dropKey.field());

/** The places a source can be dropped: Map of drop key -> { drop, moves } (the moves that drop leaves). `open` as for `dropOf`. */
export function dropsOf(view, sourceMoves, seat, { open = false } = {}) {
  const out = new Map();
  for (const m of sourceMoves) {
    const drop = dropOf(view, m, seat, { open }), key = keyOfDrop(drop);
    (out.get(key) ?? out.set(key, { drop, moves: [] }).get(key)).moves.push(m);
  }
  // The engine offers one winding where two would leave the same Chain (a Fireball wound beside a Fireball: in front or behind is the same Chain), so only
  // the first of those slots would be a place to drop. Every slot that gives the same Chain as an offered winding takes that winding.
  const winds = sourceMoves.filter((m) => m.type === 'wind');
  if (winds.length) {
    const chain = view.players[seat].chain.map((c) => c.key), key = locate(view, winds[0].cardId)?.card.key;
    for (let pos = 0; pos <= chain.length; pos++) {
      const k = dropKey.slot(seat, pos); if (out.has(k)) continue;
      const same = winds.filter((m) => !m.rearranged && m.keys === [...chain.slice(0, pos), key, ...chain.slice(pos)].join());
      if (same.length) out.set(k, { drop: { type: 'slot', owner: seat, index: pos }, moves: same });
    }
  }
  return out;
}

const distinct = (a) => [...new Set(a)];

/** For one move: what to drag it onto, and what that does. Words only: which moves exist is the engine's answer. */
function phrase(view, m) {
  const spell = m.type === 'cast' ? m.spell : m.type, zone = () => locate(view, m.targetId)?.zone;
  switch (spell) {
    case 'deploy': return m.dest === 'guard' ? ['one of your cards', 'to guard it'] : ['your side of the table', 'to deploy it'];
    case 'reguard': return ['another of your cards', 'to guard it instead'];
    case 'attack': return ['an enemy card', 'to attack it'];
    case 'wind': return ['a Chain slot', 'to wind it'];
    case 'fireball': return ['a card', 'to hit it'];
    case 'shift': return [zone() === 'chain' ? 'a spell in their Chain' : 'an enemy Guardian', 'to send it back to their hand'];
    case 'kiss': return ['a card', 'to take it'];                     // the open piles and the Chains show which (kept to one line: the banner sits between the open piles)
    case 'rally': return ['one of your creatures', 'to ready it'];
    case 'behind': return ['the table', 'to hit every unguarded creature, yours too'];
    case 'shadow': return ['an enemy card', 'to attack it'];
    default: return null;
  }
}
/**
 * The cards a Witch's Kiss can take, to bring up into one row as soon as it is picked up: every target of these moves, when any lies in a discard pile (a Kiss
 * is the only card that reaches into one), or null. In order: the opponent's Chain, their discard pile, your Chain, your discard pile, each as it lies.
 */
export function gatherOf(view, moves, seat) {
  const targets = new Set(moves.map((m) => m.targetId).filter(Boolean));
  if (![...targets].some((id) => locate(view, id)?.zone === 'discard')) return null;
  const out = [];
  for (const p of [1 - seat, seat]) for (const zone of ['chain', 'discard']) for (const c of view.players[p][zone]) if (targets.has(c.id)) out.push(c.id);
  return out;
}

/**
 * The line shown while a card is picked up: its name, where to drag it and what that does ("Fireball: drag it onto a card to hit it, or Skip."). `moves` are that card's
 * moves (one source's). The head spell of a resolving Chain, and a second attack, add "or Skip", the button beside it.
 */
export function promptFor(view, moves, seat) {
  if (!moves?.length) return '';
  const id = sourceOf(view, moves[0], seat), key = locate(view, id)?.card.key, name = key ? CARDS[key].name : 'It';
  const byVerb = new Map();
  for (const m of moves) { const p = phrase(view, m); if (p) (byVerb.get(p[1]) ?? byVerb.set(p[1], []).get(p[1])).push(p[0]); }
  if (!byVerb.size) return '';
  const head = (SPELL_MOVES.includes(moves[0].type) && !moves[0].cardId) || moves[0].bonus;      // a Chain's head spell, or a second attack: both can be skipped
  return `${name}: drag it onto ${[...byVerb].map(([verb, what]) => `${distinct(what).join(' or ')} ${verb}`).join(', or ')}${head ? ', or Skip' : ''}.`;
}
/** What a second choice names: the card a Guardian is moved onto, or the Guardian itself for "off its card". */
const destCard = (m) => (m.dest === 'none' ? m.targetId : m.toId);

/**
 * After a drop leaves `moves`: the one move to make, or the next question.
 *   commit   { move }
 *   card     which card (Witch's Kiss out of a discard pile): options [{ id, moves }]
 *   dest     where a Guardian goes: options [{ id, moves }], the Guardian's own id meaning "off its card"
 *   arrange  how the spells already wound should stand: keep the order, or swap a pair
 */
export function nextStep(moves) {
  if (moves.length === 1) return { kind: 'commit', move: moves[0] };
  const targets = distinct(moves.map((m) => m.targetId));
  if (targets.length > 1) return { kind: 'card', options: targets.map((id) => ({ id, moves: moves.filter((m) => m.targetId === id) })) };
  const dests = distinct(moves.map(destCard));
  if (dests.length > 1) return { kind: 'dest', options: dests.map((id) => ({ id, moves: moves.filter((m) => destCard(m) === id) })) };
  if (moves.every((m) => m.type === 'wind')) {
    const keep = moves.find((m) => !m.rearranged), swap = moves.find((m) => m.rearranged);
    if (keep && swap) return { kind: 'arrange', keep, swap, others: swap.order };
  }
  return { kind: 'commit', move: moves[0] };
}
