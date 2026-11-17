/**
 * Field + Chain, Restricted: setup, legal moves and what a move does. The code is the rules; docs/RULES.md says the same in words.
 *
 * A turn has two allowances, `state.used = { field, magic }`, taken in either order (or not at all):
 *   Field: Deploy, Attack (a second attack is part of it when the attacker has one), move a Guardian, or Recover (stand all your spent creatures; free while you have a Heaven's Resolve).
 *   Magic: Wind one spell (Fireball, Shift, Behind You or Shadow Step) into the Chain, or Release the Chain.
 * Instants (Rally, Witch's Kiss) are played from the hand: free, unlimited, any time on your own turn, never wound.
 * Phases: 'play' (the turn), 'chain' (a released Chain is resolving: the head spell needs a target or a skip), 'bonus' (a second attack, optional), 'over'.
 * Every move is complete: `{ type, id, ... }` with its own target. `legalMoves(state)` lists them, `apply(state, move)` returns a new state and never mutates.
 * Links between cards: a Guardian holds `guards`, the id of the card it guards. A creature that is spent holds `spent: true`, and so does a Heart that has taken its first blow
 * (a Heart never readies again). Nothing else is stored on a card.
 */
import { CARDS, CHAIN_MAX, HAND_SIZE } from './cards.js';
import { drawCards } from './state.js';

/** The cards a Guardian may guard. */
const GUARDABLE = ['heart', 'knight', 'maniac', 'angel', 'lantern', 'portal', 'resolve'];
/** The instants. */
export const INSTANTS = ['kiss', 'rally'];

// ---- looking at the game -----------------------------------------------------------------------------------------------------------------
export const kindOf = (c) => CARDS[c.key].kind;
export const isCreature = (c) => kindOf(c) === 'creature';
const ready = (c) => isCreature(c) && !c.spent;
const an = (c) => `${/^[AEIOU]/.test(CARDS[c.key].name) ? 'an' : 'a'} ${CARDS[c.key].name}`;
/** Find a card anywhere in the game: `{ card, zone, p }` or null. */
export function locate(s, id) {
  for (const p of s.players) for (const zone of ['hand', 'field', 'chain', 'discard', 'deck', 'hearts']) {
    const card = p[zone].find((c) => c.id === id);
    if (card) return { card, zone, p };
  }
  return null;
}
export const inPlay = (s, seat) => [...s.players[seat].hearts, ...s.players[seat].field];
const everything = (s) => [...inPlay(s, 0), ...inPlay(s, 1)];
export const guardiansOf = (s, c) => s.players[c.owner].field.filter((g) => g.key === 'guardian' && g.guards === c.id);
/** Does a ready Lantern Keeper of the card's owner light it? It lights that player's other spent creatures (so never the Keeper itself, which is not spent while it is ready). */
const lit = (s, c) => isCreature(c) && c.spent && s.players[c.owner].field.some((k) => k.key === 'lantern' && !k.spent && k.id !== c.id);
/** A card is guarded while any Guardian guards it, or, if it is a spent creature, while its owner has a ready Lantern Keeper. A Guardian is never guarded. */
export const isGuarded = (s, c) => c.key !== 'guardian' && (guardiansOf(s, c).length > 0 || lit(s, c));
export const hasPortal = (s, seat) => s.players[seat].field.some((c) => c.key === 'portal');
export const hasResolve = (s, seat) => s.players[seat].field.some((c) => c.key === 'resolve');
/** Knight backing: is another ready Knight of the same player standing beside this Knight? Spent Knights, enemy Knights and Maniacs never back it, and the backing Knight takes no action. */
export const isBacked = (s, c) => c.key === 'knight' && s.players[c.owner].field.some((k) => k.key === 'knight' && !k.spent && k.id !== c.id);
/** Does this creature attack a second time after its first attack? A Maniac always; a Knight while it is backed by another ready Knight. Never a third. */
const attacksTwice = (s, c) => c.key === 'maniac' || isBacked(s, c);
/** The cards a Guardian of `seat` could guard (not itself, not another Guardian), except `except`. */
const guardable = (s, seat, except) => inPlay(s, seat).filter((c) => GUARDABLE.includes(c.key) && c.id !== except);
/** Does this card attack? Knights and Maniacs. Guardians and Angels never do. */
export const canAttack = (c) => CARDS[c.key].attacks === true;
/** What a creature of `seat` can attack: any unguarded enemy card, or every enemy card with a Warp Portal; never a Warp Portal. */
export const attackTargets = (s, seat) => inPlay(s, 1 - seat).filter((t) => (!isGuarded(s, t) || hasPortal(s, seat)) && t.key !== 'portal');
const throughPortal = (s, seat, t) => t.owner !== seat && isGuarded(s, t) && hasPortal(s, seat);
/** The ready Angel that would take an attack on `seat`'s Heart, or undefined. A spent Angel does not protect. */
export const protector = (s, seat) => s.players[seat].field.find((c) => c.key === 'angel' && !c.spent);
/** What a Fireball can pick: any unguarded card that is not a Heart, either player's. */
const fireballTargets = (s) => everything(s).filter((t) => !isGuarded(s, t) && t.key !== 'heart');
/** What Behind You hits: every creature of either player that is not guarded, taken as a snapshot before anything is hit. A Guardian is never guarded, so it is always included. Hearts and devices are not creatures. */
const behindTargets = (s) => everything(s).filter((c) => isCreature(c) && !isGuarded(s, c));
/** Recover needs at least one spent creature of the player's. */
const canRecover = (s, p) => p.field.some((c) => isCreature(c) && c.spent);
const rallyTargets = (s, seat) => s.players[seat].field.filter((c) => isCreature(c) && c.spent);
const bonusTargets = (s, b) => { const c = locate(s, b.cardId)?.card; return c ? attackTargets(s, c.owner) : []; };

// ---- setup -------------------------------------------------------------------------------------------------------------------------------
/** Deal the opening position onto a blank game: a Guardian guarding each Heart, five cards each, then the first turn. */
export function initialize(s) {
  for (const p of s.players) {
    p.field.push({ id: `${p.idx}-guardian-s0`, key: 'guardian', owner: p.idx, guards: p.hearts[0].id });
    drawCards(s, p, HAND_SIZE);
  }
  s.turn = 0; s.turnNumber = 0; s.phase = 'play'; s.winner = null;
  startTurn(s);
  return s;
}
function startTurn(s) {
  s.turnNumber += 1;
  s.used = { field: false, magic: false };
  drawCards(s, s.players[s.turn], 1);
  s.events.push({ t: 'turn', p: s.turn });
}

// ---- what can be done --------------------------------------------------------------------------------------------------------------------
const permutations = (a) => (a.length < 2 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
/** Winding `c`: into any slot, with the spells already wound in any order (the only time the Chain may be rearranged). `order` lists the wound spells' ids as they will stand. */
function windMoves(p, c) {
  const wound = p.chain.map((x) => x.id), keyOf = (id) => p.chain.find((x) => x.id === id).key, out = [], seen = new Set();
  for (const order of permutations(wound)) {
    const same = order.every((id, i) => id === wound[i]);
    for (let pos = 0; pos <= order.length; pos++) out.push({ type: 'wind', id: same ? `wind:${c.id}:${pos}` : `wind:${c.id}:${pos}:${order.join(',')}`, cardId: c.id, pos, order, rearranged: !same, keys: [...order.map(keyOf).slice(0, pos), c.key, ...order.map(keyOf).slice(pos)].join() });
  }
  return out.sort((a, b) => a.rearranged - b.rearranged).filter((m) => !seen.has(m.keys) && seen.add(m.keys));      // identical Chains are one choice
}
/** Shift: an enemy Guardian that guards something (taken off its card), or any spell wound in the enemy's Chain (returned to its owner's hand). The enemy's Chain is never the one resolving. */
function shiftMoves(s, p) {
  const foe = s.players[1 - p.idx];
  return [...foe.field.filter((g) => g.key === 'guardian' && g.guards), ...foe.chain].map((c) => ({ type: 'shift', id: `shift:${c.id}`, targetId: c.id }));
}
/** Shadow Step: any ready attacker of the player's, on any target it could attack with the Field action (the same targets, the same Guard and Warp Portal rules). */
function shadowMoves(s, p) {
  const targets = attackTargets(s, p.idx), out = [];
  for (const c of p.field) if (ready(c) && canAttack(c)) for (const t of targets) out.push({ type: 'shadow', id: `shadow:${c.id}:${t.id}`, attackerId: c.id, targetId: t.id });
  return out;
}
/** Witch's Kiss: any card in either discard pile, or a wound spell in either Chain, in any slot. A Chain that is resolving is committed and can't be taken from. A Guardian needs a card to guard. */
function kissMoves(s, p) {
  const out = [];
  for (const q of s.players) for (const c of q.discard) {
    if (c.key === 'guardian') for (const t of guardable(s, p.idx)) out.push({ type: 'kiss', id: `kiss:${c.id}:${t.id}`, targetId: c.id, toId: t.id });
    else out.push({ type: 'kiss', id: `kiss:${c.id}`, targetId: c.id });
  }
  for (const q of s.players) {
    if (s.phase === 'chain' && q.idx === s.turn) continue;
    for (const c of q.chain) out.push({ type: 'kiss', id: `kiss:${c.id}`, targetId: c.id });
  }
  return out;
}
/** The targets of one spell, as moves named for the spell; a hand cast and a Chain spell share them. */
function spellMoves(s, p, key) {
  if (key === 'fireball') return fireballTargets(s).map((t) => ({ type: 'fireball', id: `fireball:${t.id}`, targetId: t.id }));
  if (key === 'behind') return behindTargets(s).length ? [{ type: 'behind', id: 'behind' }] : [];       // it names no target: it hits every unguarded creature
  if (key === 'kiss') return kissMoves(s, p);
  if (key === 'shift') return shiftMoves(s, p);
  if (key === 'shadow') return shadowMoves(s, p);
  if (key === 'rally') return rallyTargets(s, p.idx).map((t) => ({ type: 'rally', id: `rally:${t.id}`, targetId: t.id }));
  return [];
}
/** The Field action: Deploy, Attack, move a Guardian, or Recover. */
function fieldMoves(s, p) {
  const moves = [];
  if (s.used.field) { if (canRecover(s, p) && hasResolve(s, p.idx)) moves.push({ type: 'recover', id: 'recover' }); return moves; }       // with a Heaven's Resolve, Recover is still open after the Field action is used
  for (const c of p.hand) {
    if (kindOf(c) !== 'creature' && kindOf(c) !== 'device') continue;
    if (c.key === 'guardian') for (const t of guardable(s, p.idx)) moves.push({ type: 'deploy', id: `deploy:${c.id}:${t.id}`, cardId: c.id, dest: 'guard', targetId: t.id });
    else moves.push({ type: 'deploy', id: `deploy:${c.id}`, cardId: c.id, dest: 'open' });
  }
  const targets = attackTargets(s, p.idx);
  for (const c of p.field) {
    if (!ready(c)) continue;
    if (c.key === 'guardian') {
      for (const t of guardable(s, p.idx, c.guards)) moves.push({ type: 'reguard', id: `reguard:${c.id}:${t.id}`, cardId: c.id, dest: 'to', targetId: t.id });
      if (c.guards) moves.push({ type: 'reguard', id: `reguard:${c.id}:none`, cardId: c.id, dest: 'none' });
    }
    if (canAttack(c)) for (const t of targets) moves.push({ type: 'attack', id: `attack:${c.id}:${t.id}`, cardId: c.id, targetId: t.id });
  }
  if (canRecover(s, p)) moves.push({ type: 'recover', id: 'recover' });
  return moves;
}
/** The instants in the hand, cast for free (a cast is complete with its target, and names the spell it casts). */
function instantMoves(s, p) {
  const moves = [];
  for (const c of p.hand) if (INSTANTS.includes(c.key)) for (const m of spellMoves(s, p, c.key)) moves.push({ ...m, type: 'cast', spell: c.key, cardId: c.id, id: `cast:${c.id}:${m.id}` });
  return moves;
}
/** The Magic action: Wind one spell (Fireball, Shift, Behind You or Shadow Step) or Release the Chain. */
function magicMoves(s, p) {
  const moves = [];
  if (s.used.magic) return moves;
  for (const c of p.hand) if (kindOf(c) === 'spell' && p.chain.length < CHAIN_MAX) moves.push(...windMoves(p, c));
  if (p.chain.length) moves.push({ type: 'release', id: 'release' });
  return moves;
}
/** Every move the player to move may take now. */
export function legalMoves(s) {
  if (s.phase === 'over') return [];
  const p = s.players[s.turn];
  if (s.phase === 'chain') return [...spellMoves(s, p, p.chain[0].key), { type: 'skip', id: 'skip' }, ...instantMoves(s, p), ...fieldMoves(s, p)];       // the head spell (the owner may always skip it), an instant, or the unused Field action between spells
  if (s.phase === 'bonus') {                                                         // a second attack: another target, or stop; nothing may come between
    const c = locate(s, s.bonus.cardId).card;
    return [...bonusTargets(s, s.bonus).map((t) => ({ type: 'attack', id: `attack:${c.id}:${t.id}`, cardId: c.id, targetId: t.id, bonus: true })), { type: 'decline', id: 'decline' }];
  }
  return [...fieldMoves(s, p), ...magicMoves(s, p), ...instantMoves(s, p), { type: 'end', id: 'end' }];
}
export const moveError = (s, move, moves = legalMoves(s)) => (moves.some((m) => m.id === move.id) ? null : 'That is not a legal action now.');

// ---- what a move does --------------------------------------------------------------------------------------------------------------------
const ev = (s, e) => s.events.push(e);
const clean = (c) => { delete c.guards; delete c.spent; return c; };
const discard = (s, c) => s.players[c.owner].discard.push(clean(c));
/** A card leaves play; any Guardian guarding it stops guarding. */
function remove(s, c) {
  const p = s.players[c.owner];
  p.field.splice(p.field.indexOf(c), 1);
  for (const g of p.field) if (g.guards === c.id) delete g.guards;
}
function win(s, seat) { s.phase = 'over'; s.winner = seat; ev(s, { t: 'win', p: seat }); }
/** Hit a creature or device that is not a Heart: a ready creature turns spent; a spent creature or a device is defeated. */
function hit(s, t) {
  if (isCreature(t) && !t.spent) { t.spent = true; ev(s, { t: 'hit', id: t.id }); return; }
  ev(s, { t: 'defeat', id: t.id });
  remove(s, t); discard(s, t);
}
/**
 * An attack reaches a Heart. A ready Angel of its owner is defeated instead (automatic, no choice) and the Heart is untouched, whatever state it is in.
 * Otherwise a ready Heart turns spent (it never readies again) and a spent Heart is defeated: the attacker wins.
 */
function strikeHeart(s, t) {
  const angel = protector(s, t.owner);
  if (angel) { ev(s, { t: 'rescue', id: angel.id, saved: t.id }); remove(s, angel); discard(s, angel); return; }
  if (!t.spent) { t.spent = true; ev(s, { t: 'hit', id: t.id }); return; }
  win(s, 1 - t.owner);
}
/**
 * One attack: `k` turns spent, `t` is hit (a Heart takes a blow), and a creature that attacks twice is offered its second attack at once, with nothing allowed
 * in between (`phase: 'bonus'`). Whether it does is decided here, after the first attack has resolved, from the board as it then stands. `free` is an attack
 * made by Shadow Step: it does not use the Field action. The second attack itself (`second`) never leads to a third.
 */
function attack(s, p, k, t, { second = false, free = false } = {}) {
  const back = second ? s.bonus.back : s.phase === 'chain' ? 'chain' : 'play', via = throughPortal(s, p.idx, t);
  if (!free) s.used.field = true;
  k.spent = true;                                         // an attack is a hit, and the attacker turns spent
  ev(s, { t: 'attack', id: k.id, hit: t.id, portal: via });
  if (t.key === 'heart') strikeHeart(s, t); else hit(s, t);
  if (second) { if (s.phase !== 'over') s.phase = back; delete s.bonus; return; }
  if (s.phase === 'over' || !attacksTwice(s, k)) return;
  const bonus = { cardId: k.id, back, free };
  if (bonusTargets(s, bonus).length) { s.phase = 'bonus'; s.bonus = bonus; ev(s, { t: 'bonus', id: k.id }); }
}
function endTurn(s) {
  s.turn = 1 - s.turn; s.phase = 'play';
  startTurn(s);
}
/** Play `move` and return the new game. Throws if the move is not legal. */
export function apply(state, move) {
  if (state.phase === 'over') throw new Error('The game is over.');
  const moves = legalMoves(state), bad = moveError(state, move, moves);
  if (bad) throw new Error(bad);
  return play(state, moves.find((m) => m.id === move.id));
}
/** The effect of a spell (`kind` is its name; `by` the id of the spell card casting it, which the effect's event repeats). */
function resolve(s, p, kind, legal, by) {
  const card = (id) => locate(s, id).card;
  if (kind === 'fireball') {
    const t = card(legal.targetId);
    ev(s, { t: 'fireball', hit: t.id, by });
    hit(s, t);
  } else if (kind === 'behind') {
    const hits = behindTargets(s);                               // fixed before the first hit: a Guardian defeated here does not expose the card it guarded to this same effect
    ev(s, { t: 'behind', hits: hits.map((c) => c.id), by });
    for (const c of hits) hit(s, c);                             // a hit changes only its own target, so the order makes no difference
  } else if (kind === 'kiss') {
    const at = locate(s, legal.targetId), c = at.card, q = at.p, slot = at.zone === 'chain' ? q.chain.indexOf(c) : undefined;
    q[at.zone].splice(q[at.zone].indexOf(c), 1);                 // from a discard pile, or from a Chain (which closes up)
    clean(c); c.owner = p.idx;                                   // it changes sides
    if (isCreature(c)) {                                         // a creature enters the field spent (a Guardian guarding the card chosen)
      c.spent = true; p.field.push(c);
      if (c.key === 'guardian') c.guards = legal.toId;
    } else p.hand.push(c);                                       // anything else (a device, a spell, an instant) goes to the hand; a device is then deployed with the Field action
    ev(s, { t: 'kiss', id: c.id, zone: at.zone, from: q.idx, slot, to: isCreature(c) ? 'field' : 'hand', guards: c.guards, by });
  } else if (kind === 'rally') {
    const c = card(legal.targetId);
    delete c.spent;                                              // it readies at once; the Field action is still the player's
    ev(s, { t: 'rally', id: c.id, by });
  } else if (kind === 'shadow') {
    const k = card(legal.attackerId);
    ev(s, { t: 'shadow', id: k.id, by });
    attack(s, p, k, card(legal.targetId), { free: true });       // the same attack sequence as a Field attack, without using the Field action
  } else if (kind === 'shift') {
    const at = locate(s, legal.targetId), c = at.card;
    if (at.zone === 'chain') {                                   // a spell goes back to its owner's hand, and the Chain closes up
      const q = at.p, slot = q.chain.indexOf(c);
      q.chain.splice(slot, 1); q.hand.push(c);
      ev(s, { t: 'recall', id: c.id, from: q.idx, slot, by });
    } else {                                                     // a Guardian is taken off its card and guards nothing
      const was = c.guards; delete c.guards;
      ev(s, { t: 'shift', id: c.id, from: was, to: null, by });
    }
  }
}
function play(state, legal) {
  const s = JSON.parse(JSON.stringify(state)); s.events = [];
  const p = s.players[s.turn];
  const take = (zone, id) => p[zone].splice(p[zone].findIndex((c) => c.id === id), 1)[0];
  const card = (id) => locate(s, id).card;

  if (legal.type === 'deploy') {
    const c = take('hand', legal.cardId);
    p.field.push(c); s.used.field = true;
    if (c.key === 'maniac') c.spent = true;                                       // a Maniac enters spent
    if (legal.dest === 'guard') c.guards = legal.targetId;
    ev(s, { t: 'deploy', id: c.id });
  } else if (legal.type === 'decline') {
    s.phase = s.bonus.back || 'play'; delete s.bonus;
  } else if (legal.type === 'attack') {
    attack(s, p, card(legal.cardId), card(legal.targetId), { second: !!legal.bonus, free: !!legal.bonus && s.bonus.free });
  } else if (legal.type === 'reguard') {
    const g = card(legal.cardId), was = g.guards ?? null;
    if (legal.dest === 'none') delete g.guards; else g.guards = legal.targetId;
    g.spent = true; s.used.field = true;
    ev(s, { t: 'reguard', id: g.id, from: was, to: g.guards ?? null });
  } else if (legal.type === 'recover') {
    for (const c of p.field) if (isCreature(c)) delete c.spent;
    if (!hasResolve(s, p.idx)) s.used.field = true;                              // with a Heaven's Resolve it is free: the Field action is still there to use
    ev(s, { t: 'recover', p: p.idx });
  } else if (legal.type === 'wind') {
    const c = take('hand', legal.cardId);
    s.used.magic = true;
    if (legal.rearranged) p.chain = legal.order.map((id) => p.chain.find((x) => x.id === id));
    p.chain.splice(legal.pos, 0, c);
    ev(s, { t: 'wind', id: legal.cardId });
  } else if (legal.type === 'release') {
    s.phase = 'chain'; s.used.magic = true;
    ev(s, { t: 'release', p: p.idx });
  } else if (legal.type === 'end') {
    ev(s, { t: 'end', p: p.idx });
  } else if (legal.type === 'cast') {                       // an instant played from the hand: free
    const c = take('hand', legal.cardId);
    ev(s, { t: 'cast', id: c.id, spell: c.key, p: p.idx, from: 'hand', to: 'discard' });
    resolve(s, p, legal.spell, legal, c.id);
    p.discard.push(clean(c));
  } else {                                                  // the head spell of a releasing Chain
    const spell = p.chain[0];
    if (legal.type === 'skip') ev(s, { t: 'skip', id: spell.id, p: p.idx, to: 'discard' });
    else { ev(s, { t: 'cast', id: spell.id, spell: spell.key, p: p.idx, from: 'chain', to: 'discard' }); resolve(s, p, legal.type, legal, spell.id); }
    p.discard.push(clean(p.chain.shift()));
  }

  if (s.phase === 'over') return s;
  if (s.phase === 'bonus') return s;                         // a second attack is on offer: nothing may come between
  if (s.phase === 'chain') {                                 // a released Chain is resolving
    if (p.chain.length) return s;                            // the next spell in it is reached, or the Chain goes on from the new position after a Field action at a breakpoint
    s.phase = 'play';                                        // the Chain is done: back to the turn it interrupted
  }
  if (legal.type === 'end' || legalMoves(s).every((m) => m.type === 'end')) endTurn(s);      // the turn ends when the player says so, or when nothing is left to do
  return s;
}
