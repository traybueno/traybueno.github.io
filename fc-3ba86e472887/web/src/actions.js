/**
 * What the player can do, read off the engine's `legalMoves`. Pure: no rules here, only a translation of the moves the engine offers into what a hand
 * can do on a table: which cards can be picked up, where each can be dropped, and what has to be asked next when a drop leaves more than one move.
 *
 *   source  a card the player can pick up (a hand card, a ready creature on the board, or the head spell of a resolving Chain)
 *   drop    a place a source can be dropped: a card, a Chain slot, a discard pile, or the player's own field
 *   step    what happens after a drop: commit the one move left, or ask for a second choice
 */
import { locate } from '../../src/index.js';

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
    else { const id = sourceOf(view, m, seat); if (id) (sources.get(id) ?? sources.set(id, []).get(id)).push(m); }
  }
  return { sources, buttons };
}

/** Where a move is dropped. */
export function dropOf(view, move, seat) {
  switch (move.type) {
    case 'deploy': return move.dest === 'guard' ? { type: 'card', id: move.targetId } : { type: 'field' };
    case 'reguard': return move.dest === 'none' ? { type: 'field' } : { type: 'card', id: move.targetId };
    case 'wind': return { type: 'slot', owner: seat, index: move.pos };
    case 'shadow': return { type: 'card', id: move.attackerId };        // dropped on the attacker; what it attacks is the next choice
    case 'behind': return { type: 'field' };                            // it has no target: dropped on the table, it affects every unguarded creature
    default: {                                                         // attack, and every spell: onto its target
      const at = locate(view, move.targetId);
      return at && at.zone === 'discard' ? { type: 'pile', owner: at.p.idx } : { type: 'card', id: move.targetId };
    }
  }
}
export const keyOfDrop = (d) => (d.type === 'card' ? dropKey.card(d.id) : d.type === 'slot' ? dropKey.slot(d.owner, d.index) : d.type === 'pile' ? dropKey.pile(d.owner) : dropKey.field());

/** The places a source can be dropped: Map of drop key -> { drop, moves } (the moves that drop leaves). */
export function dropsOf(view, sourceMoves, seat) {
  const out = new Map();
  for (const m of sourceMoves) {
    const drop = dropOf(view, m, seat), key = keyOfDrop(drop);
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
