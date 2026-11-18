/**
 * Field + Chain, Restricted: setup, legal moves and what a move does. The code is the rules; docs/RULES.md says the same in words.
 *
 * A turn has two allowances, `state.used = { field, chain }`, taken in either order (or not at all):
 *   Field: Deploy (an instant creature, the Lantern Keeper, is deployed without it), Attack (a second attack is part of it when the attacker has one), move a Guardian, or Recover (stand all your spent creatures; free while you have a Heaven's Resolve).
 *   Chain: Wind one spell (Fireball, Shift, Behind You or Shadow Step) onto the right end of the Chain, or Release the Chain.
 * Instants (Rally, Witch's Kiss) are played from the hand: free, unlimited, any time on your own turn, never wound.
 * Phases: 'play' (the turn), 'chain' (a released Chain is resolving: the head spell needs a target or a skip), 'bonus' (a second attack, optional), 'over'.
 * Every move is complete: `{ type, id, ... }` with its own target. `legalMoves(state)` lists them, `apply(state, move)` returns a new state and never mutates.
 * Links between cards: a Guardian holds `guards`, the id of the card it guards; a Guardian in play always guards a card (one whose card leaves play goes back to its
 * owner's hand). A creature that is spent holds `spent: true`, and so does a Heart that has taken its first blow (a Heart never readies again) and every device (devices
 * enter spent and never ready, so any hit defeats them). Nothing else is stored on a card.
 * The end of the piles, per player: the draw that empties a player's own pile discards that player's Guardians, and while their pile is empty they can bring no Guardian into play.
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
/** Does a ready Lantern Keeper of the card's owner light it? It lights that player's other spent creatures (so never the Keeper itself, which is not spent while it is ready), never a Guardian (Guardians are never guarded; until 18 Nov 2026 a spent Guardian was reported lit in `light` events though it was not guarded). */
const lit = (s, c) => isCreature(c) && c.key !== 'guardian' && c.spent && s.players[c.owner].field.some((k) => k.key === 'lantern' && !k.spent && k.id !== c.id);
/** A card is guarded while any Guardian guards it, or, if it is a spent creature, while its owner has a ready Lantern Keeper. A Guardian is never guarded. */
export const isGuarded = (s, c) => c.key !== 'guardian' && (guardiansOf(s, c).length > 0 || lit(s, c));
/** Is this player's draw pile empty? Then they have no Guardian in play and can bring none into play (see `startTurn`). A pure query: a pile's size is public. */
export const outOfCards = (s, seat) => s.players[seat].deck.length === 0;
export const hasPortal = (s, seat) => s.players[seat].field.some((c) => c.key === 'portal');
export const hasResolve = (s, seat) => s.players[seat].field.some((c) => c.key === 'resolve');
/** Can `c` attack now? A ready attacker can; so can a spent one while a ready Lantern Keeper of its owner shelters it (it attacks as if ready, and stays spent). */
export const canStrike = (s, c) => canAttack(c) && (ready(c) || lit(s, c));
/** Knight pair: does this Knight's owner have another Knight in play (ready or spent)? Enemy Knights and Maniacs don't count, and the other Knight takes no action. */
export const isBacked = (s, c) => c.key === 'knight' && s.players[c.owner].field.some((k) => k.key === 'knight' && k.id !== c.id);
/** Does this creature attack a second time after its first attack? A Maniac always; a Knight while its owner has another Knight. Never a third. */
const attacksTwice = (s, c) => c.key === 'maniac' || isBacked(s, c);
/** The cards a Guardian of `seat` could guard (not itself, not another Guardian), except `except`. */
const guardable = (s, seat, except) => inPlay(s, seat).filter((c) => GUARDABLE.includes(c.key) && c.id !== except);
/** Does this card attack? Knights and Maniacs. Guardians and Angels never do. */
export const canAttack = (c) => CARDS[c.key].attacks === true;
/** What a creature of `seat` can attack: any unguarded enemy card, or every enemy card with a Warp Portal; never a Warp Portal. */
export const attackTargets = (s, seat) => inPlay(s, 1 - seat).filter((t) => (!isGuarded(s, t) || hasPortal(s, seat)) && t.key !== 'portal');
const throughPortal = (s, seat, t) => t.owner !== seat && isGuarded(s, t) && hasPortal(s, seat);
/** The ready Angel that would take an attack on `seat`'s Heart, or undefined. A spent Angel does not protect. */
/** Is this card's standing effect in force right now? A Warp Portal and a Heaven's Resolve always are; a Lantern Keeper and an Angel are while ready. Any other card has none. (A pure query for a front end to mark them.) */
export const inForce = (s, c) => c.key === 'portal' || c.key === 'resolve' || ((c.key === 'lantern' || c.key === 'angel') && !c.spent);
export const protector = (s, seat) => s.players[seat].field.find((c) => c.key === 'angel' && !c.spent);
/** What a Fireball can pick: any unguarded card that is not a Heart, either player's. */
const fireballTargets = (s) => everything(s).filter((t) => !isGuarded(s, t) && t.key !== 'heart');
/** What Behind You hits: every creature of either player that is not guarded, the caster's own too, taken as a snapshot before anything is hit. A Guardian is never guarded, so every Guardian is included. Hearts and devices are not creatures. (Enemy creatures only for part of 18 Nov 2026; both sides again since, so a second copy in the same Chain wipes the caster's open creatures too.) */
const behindTargets = (s) => everything(s).filter((c) => isCreature(c) && !isGuarded(s, c));
/** Recover needs at least one spent creature of the player's. */
const canRecover = (s, p) => p.field.some((c) => canAttack(c) && c.spent);           // Recover stands only attackers (18 Nov 2026): Guardians, Angels and Lantern Keepers ready only through Rally
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
  s.used = { field: false, chain: false };
  const p = s.players[s.turn], wasLive = !outOfCards(s, p.idx);
  drawCards(s, p, 1);
  if (wasLive && outOfCards(s, p.idx)) for (const g of p.field.filter((c) => c.key === 'guardian')) { ev(s, { t: 'defeat', id: g.id }); remove(s, g); discard(s, g); }       // their last card is drawn: their Guardians are discarded
  s.events.push({ t: 'turn', p: s.turn });
}

// ---- what can be done --------------------------------------------------------------------------------------------------------------------
/** Winding `c`: always onto the right end of the Chain; the spells already wound keep their order. `pos`, `order`, `rearranged` and `keys` describe the result. */
const windMoves = (p, c) => [{ type: 'wind', id: `wind:${c.id}`, cardId: c.id, pos: p.chain.length, order: p.chain.map((x) => x.id), rearranged: false, keys: [...p.chain.map((x) => x.key), c.key].join() }];
/** Shift: an enemy Guardian, or any spell wound in the enemy's Chain; either goes back to its owner's hand. The enemy's Chain is never the one resolving. */
function shiftMoves(s, p) {
  const foe = s.players[1 - p.idx];
  return [...foe.field.filter((g) => g.key === 'guardian' && g.guards), ...foe.chain].map((c) => ({ type: 'shift', id: `shift:${c.id}`, targetId: c.id }));
}
/** Shadow Step: any attacker of the player's (a Knight or Maniac), ready or spent (since 18 Nov 2026, at the designer's request), on any target it could attack with the Field action (the same targets, the same Guard and Warp Portal rules). */
function shadowMoves(s, p) {
  const targets = attackTargets(s, p.idx), out = [];
  for (const c of p.field) if (canAttack(c)) for (const t of targets) out.push({ type: 'shadow', id: `shadow:${c.id}:${t.id}`, attackerId: c.id, targetId: t.id });
  return out;
}
/** Witch's Kiss: any card in either discard pile, or a wound spell in either Chain, in any slot. A Chain that is resolving is committed and can't be taken from. A Guardian needs a card to guard. */
function kissMoves(s, p) {
  const out = [];
  for (const q of s.players) for (const c of q.discard) {
    if (c.key === 'guardian' && outOfCards(s, p.idx)) continue;                         // with your pile empty, you have no Guardians
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
  if (key === 'behind') return behindTargets(s).length ? [{ type: 'behind', id: 'behind' }] : [];       // it names no target: it hits every unguarded creature, both players'
  if (key === 'kiss') return kissMoves(s, p);
  if (key === 'shift') return shiftMoves(s, p);
  if (key === 'shadow') return shadowMoves(s, p);
  if (key === 'rally') return rallyTargets(s, p.idx).map((t) => ({ type: 'rally', id: `rally:${t.id}`, targetId: t.id }));
  return [];
}
/** The Field action: Deploy, Attack, move a Guardian, or Recover. */
function fieldMoves(s, p) {
  const moves = [];
  const lanterns = () => p.hand.filter((c) => CARDS[c.key].instant).map((c) => ({ type: 'deploy', id: `deploy:${c.id}`, cardId: c.id, dest: 'open' }));
  if (s.used.field) { if (canRecover(s, p) && hasResolve(s, p.idx)) moves.push({ type: 'recover', id: 'recover' }); moves.push(...lanterns()); return moves; }       // with a Heaven's Resolve, Recover is still open after the Field action is used; an instant creature is deployed without it
  for (const c of p.hand) {
    if (kindOf(c) !== 'creature' && kindOf(c) !== 'device') continue;
    if (c.key === 'guardian' && outOfCards(s, p.idx)) continue;                           // with your pile empty, you have no Guardians
    if (c.key === 'guardian') for (const t of guardable(s, p.idx)) moves.push({ type: 'deploy', id: `deploy:${c.id}:${t.id}`, cardId: c.id, dest: 'guard', targetId: t.id });
    else moves.push({ type: 'deploy', id: `deploy:${c.id}`, cardId: c.id, dest: 'open' });
  }
  const targets = attackTargets(s, p.idx);
  for (const c of p.field) {
    if (!ready(c) && !canStrike(s, c)) continue;                                        // a sheltered spent creature can still attack, and nothing else
    if (c.key === 'guardian' && ready(c)) {
      for (const t of guardable(s, p.idx, c.guards)) moves.push({ type: 'reguard', id: `reguard:${c.id}:${t.id}`, cardId: c.id, dest: 'to', targetId: t.id });
    }
    if (canStrike(s, c)) for (const t of targets) moves.push({ type: 'attack', id: `attack:${c.id}:${t.id}`, cardId: c.id, targetId: t.id });
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
/** The Chain action: Wind one spell (Fireball, Shift, Behind You or Shadow Step) onto the right end, or Release the Chain. */
function chainMoves(s, p) {
  const moves = [];
  if (s.used.chain) return moves;
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
  return [...fieldMoves(s, p), ...chainMoves(s, p), ...instantMoves(s, p), { type: 'end', id: 'end' }];
}
export const moveError = (s, move, moves = legalMoves(s)) => (moves.some((m) => m.id === move.id) ? null : 'That is not a legal action now.');

// ---- what a move does --------------------------------------------------------------------------------------------------------------------
const ev = (s, e) => s.events.push(e);
const clean = (c) => { delete c.guards; delete c.spent; return c; };
const discard = (s, c) => s.players[c.owner].discard.push(clean(c));
/** A card leaves play; any Guardian guarding it goes back to its owner's hand (a Guardian in play always guards a card). */
function remove(s, c) {
  const p = s.players[c.owner];
  p.field.splice(p.field.indexOf(c), 1);
  for (const g of p.field.filter((x) => x.guards === c.id)) { p.field.splice(p.field.indexOf(g), 1); p.hand.push(clean(g)); ev(s, { t: 'return', id: g.id, from: c.id }); }
}
function win(s, seat) { s.phase = 'over'; s.winner = seat; ev(s, { t: 'win', p: seat }); }
/** Hit a creature or device that is not a Heart: a ready card turns spent; a spent one is defeated (a device is always spent). */
function hit(s, t) {
  if (isCreature(t) && !t.spent) { t.spent = true; ev(s, { t: 'hit', id: t.id }); return; }
  ev(s, { t: 'defeat', id: t.id });
  remove(s, t); discard(s, t);
}
/**
 * An attack reaches a Heart. A ready Angel of its owner is defeated instead (automatic, no choice) and the Heart is untouched, whatever state it is in;
 * the attacker survives. Otherwise the attack lands: a ready Heart turns spent (it never readies again) and the attacker `k` is defeated, so it has no
 * second attack and it takes two creatures to defeat a Heart; a spent Heart is defeated: the attacker wins.
 */
function strikeHeart(s, t, k) {
  const angel = protector(s, t.owner);
  if (angel) { ev(s, { t: 'rescue', id: angel.id, saved: t.id }); remove(s, angel); discard(s, angel); return; }
  if (t.spent) { win(s, 1 - t.owner); return; }
  t.spent = true; ev(s, { t: 'hit', id: t.id });
  remove(s, k); discard(s, k); ev(s, { t: 'defeat', id: k.id });
}
/**
 * One attack: `k` turns spent, `t` is hit (a Heart takes a blow), and a creature that attacks twice is offered its second attack at once, with nothing allowed
 * in between (`phase: 'bonus'`). Whether it does is decided here, after the first attack has resolved, from the board as it then stands. `free` is an attack
 * made by Shadow Step: it does not use the Field action. The second attack itself (`second`) never leads to a third.
 */
function attack(s, p, k, t, { second = false, free = false } = {}) {
  const back = second ? s.bonus.back : s.phase === 'chain' ? 'chain' : 'play', via = throughPortal(s, p.idx, t), sheltered = !!k.spent && lit(s, k);
  if (!free) s.used.field = true;
  k.spent = true;                                         // an attack is a hit, and the attacker turns spent
  ev(s, sheltered ? { t: 'attack', id: k.id, hit: t.id, portal: via, lit: true } : { t: 'attack', id: k.id, hit: t.id, portal: via });     // `lit`: a spent attacker that a Lantern Keeper lets attack
  if (t.key === 'heart') strikeHeart(s, t, k); else hit(s, t);
  if (second) { if (s.phase !== 'over') s.phase = back; delete s.bonus; return; }
  if (s.phase === 'over' || !p.field.includes(k) || !attacksTwice(s, k)) return;        // an attacker defeated by striking a Heart has no second attack
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
    const inPlay = isCreature(c) || kindOf(c) === 'device';      // a creature or a device is played free (no Field action): every creature enters ready (18 Nov 2026), a Guardian guarding the card chosen; a device enters spent like any device
    if (inPlay) {
      if (kindOf(c) === 'device') c.spent = true;
      p.field.push(c);
      if (c.key === 'guardian') c.guards = legal.toId;
    } else p.hand.push(c);                                       // a spell or an instant goes to the hand
    ev(s, { t: 'kiss', id: c.id, zone: at.zone, from: q.idx, slot, to: inPlay ? 'field' : 'hand', guards: c.guards, by });
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
    } else {                                                     // a Guardian goes back to its owner's hand
      const q = at.p, was = c.guards;
      q.field.splice(q.field.indexOf(c), 1); q.hand.push(clean(c));
      ev(s, { t: 'shift', id: c.id, from: was, to: null, by });
    }
  }
}
/**
 * A Lantern Keeper's light comes on or goes out over creatures that were already spent: it was deployed or readied, or it was spent, hit or taken away.
 * One `light` event per player whose light changed, after the move's own events: `on`, the creatures (`ids`), and the Keeper (`by`). For the front end only.
 */
function light(before, s) {
  const litIn = (g) => new Set(everything(g).filter((c) => lit(g, c)).map((c) => c.id));
  const was = litIn(before), now = litIn(s), spentThen = (id) => { const at = locate(before, id); return at?.zone === 'field' && !!at.card.spent; };
  const spentNow = (id) => { const at = locate(s, id); return at?.zone === 'field' && !!at.card.spent; };
  const keeper = (g, seat) => g.players[seat].field.find((k) => k.key === 'lantern' && !k.spent)?.id;
  for (const seat of [0, 1]) {
    const mine = (id) => locate(s, id)?.card.owner === seat;
    const on = [...now].filter((id) => !was.has(id) && spentThen(id) && mine(id)), off = [...was].filter((id) => !now.has(id) && spentNow(id) && mine(id));
    if (on.length) ev(s, { t: 'light', p: seat, on: true, ids: on, by: keeper(s, seat) });
    if (off.length) ev(s, { t: 'light', p: seat, on: false, ids: off, by: keeper(before, seat) });
  }
}
function play(state, legal) {
  const s = JSON.parse(JSON.stringify(state)); s.events = [];
  const p = s.players[s.turn];
  const take = (zone, id) => p[zone].splice(p[zone].findIndex((c) => c.id === id), 1)[0];
  const card = (id) => locate(s, id).card;

  if (legal.type === 'deploy') {
    const c = take('hand', legal.cardId);
    p.field.push(c); if (!CARDS[c.key].instant) s.used.field = true;              // an instant creature (the Lantern Keeper) is deployed without the Field action (18 Nov 2026)
    if (c.key === 'maniac' || kindOf(c) === 'device') c.spent = true;             // a Maniac and every device enter spent
    if (legal.dest === 'guard') c.guards = legal.targetId;
    const touches = c.key === 'portal' ? s.players[1 - p.idx].field.filter((g) => g.key === 'guardian') : c.key === 'resolve' ? p.field.filter(canAttack) : null;
    ev(s, touches ? { t: 'deploy', id: c.id, touches: touches.map((g) => g.id) } : { t: 'deploy', id: c.id });   // what a Warp Portal or a Heaven's Resolve affects as it comes in (for the front end's effects)
  } else if (legal.type === 'decline') {
    s.phase = s.bonus.back || 'play'; delete s.bonus;
  } else if (legal.type === 'attack') {
    attack(s, p, card(legal.cardId), card(legal.targetId), { second: !!legal.bonus, free: !!legal.bonus && s.bonus.free });
  } else if (legal.type === 'reguard') {
    const g = card(legal.cardId), was = g.guards ?? null;
    g.guards = legal.targetId;
    s.used.field = true;                                        // moving does not spend it (18 Nov 2026); it uses the Field action
    ev(s, { t: 'reguard', id: g.id, from: was, to: g.guards });
  } else if (legal.type === 'recover') {
    for (const c of p.field) if (canAttack(c)) delete c.spent;                   // only Knights and Maniacs stand; a spent defender waits for a Rally
    const free = hasResolve(s, p.idx);
    if (!free) s.used.field = true;                                              // with a Heaven's Resolve it is free: the Field action is still there to use
    ev(s, free ? { t: 'recover', p: p.idx, free: true } : { t: 'recover', p: p.idx });
  } else if (legal.type === 'wind') {
    const c = take('hand', legal.cardId);
    s.used.chain = true;
    p.chain.push(c);
    ev(s, { t: 'wind', id: legal.cardId });
  } else if (legal.type === 'release') {
    s.phase = 'chain'; s.used.chain = true;
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
  light(state, s);

  if (s.phase === 'over') return s;
  if (s.phase === 'bonus') return s;                         // a second attack is on offer: nothing may come between
  if (s.phase === 'chain') {                                 // a released Chain is resolving
    if (p.chain.length) return s;                            // the next spell in it is reached, or the Chain goes on from the new position after a Field action at a breakpoint
    s.phase = 'play';                                        // the Chain is done: back to the turn it interrupted
  }
  if (legal.type === 'end' || legalMoves(s).every((m) => m.type === 'end')) endTurn(s);      // the turn ends when the player says so, or when nothing is left to do
  return s;
}
