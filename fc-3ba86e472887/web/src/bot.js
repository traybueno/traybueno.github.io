/**
 * Computer opponents. A bot is given the game and its seat and returns one of the engine's legal moves; it never makes a move the engine would refuse.
 *
 * It plays with what a player can see: its own hand, both fields, both Chains and both discard piles, and only the NUMBER of cards in the other hand
 * and in either pile. (`evaluate` reads nothing else, and a test swaps the other hand for different cards and checks the bot does not change its mind.)
 *
 * How it chooses: each legal move is tried on a copy of the game (`apply` never mutates), the resulting position is scored by `evaluate`, and the bot
 * looks a few moves further along its own turn (a deploy, an instant and an attack are one turn) before picking. The profiles differ in how far they
 * look, how much noise there is in their judgement, how much a threat counts, how often they settle for a lesser move, and whether they weigh the answer.
 */
import { legalMoves, apply, isGuarded, hasPortal, hasResolve, locate } from '../../src/index.js?v=54cfdab';

/** Bumped whenever a profile or `evaluate` changes, so saved game logs say which bots played them. bots/17 (19 Nov 2026): one free Guardian move a turn; it is judged where it leaves the Guardian when the turn ends (see `chooseMove`). bots/16 had a loop guard for unlimited moves, no longer needed. */
export const BOT_VERSION = 'bots/17';

/**
 * Squire is a beginner: it looks one move ahead, half-sees threats (`caution`) and now and then settles for a lesser move (`slip`), never a wild one.
 * Knight plays soundly, a move or two at a time. Warlock (since bots/14) plans whole turns: it searches every order of its moves to the end of the turn
 * (`plan` positions at most), so it finds turns that only pay when their moves come together, and answers each of its best few (`reply`) with your best
 * whole turn, played with what it can see of yours and hands dealt from the cards you could hold, never the cards in your hand (`replyBudget`, `deals`).
 * It reads its own hand (`ownHand`: a Rally in it counts towards its next attacks). Before bots/14 it was the Knight's search with a check on its Heart.
 */
export const PROFILES = {
  squire: { name: 'Squire', blurb: 'Plays loosely: misses threats, and sometimes settles for a lesser move.', hold: 0.6, depth: 1, beam: 5, noise: 2.5, slip: 0.4, caution: 0.25 },
  knight: { name: 'Knight', blurb: 'Plays soundly.', hold: 0.5, depth: 2, beam: 6, noise: 0.5, random: 0 },
  warlock: { name: 'Warlock', blurb: 'Plans whole turns, and sees your answer coming.', depth: 2, beam: 6, noise: 0.05, reply: 6, plan: 2000, replyBudget: 400, deals: 2, ownHand: true, hold: 0.35 },
};

// ---- how good a position is ----------------------------------------------------------------------------------------------------------------
const READY_VALUE = { knight: 4, maniac: 6, angel: 3.2, guardian: 1.8, lantern: 2.6 }, SPENT_VALUE = { knight: 2.6, maniac: 4, angel: 0.8, guardian: 1.1, lantern: 0.8 };
// Since bots/13 (18 Nov 2026: Recover stands only attackers) a spent Guardian, Angel or Lantern Keeper stays spent until a Rally, so it is worth much less than
// its ready value: a spent Angel saves nothing and a spent Keeper shelters nobody; a spent Guardian still guards, so it keeps more. Knights and Maniacs
// still stand with one Recover, and keep the bots/9 values below.
// A spent creature stands again with one Recover (one Field action stands them all), so it is worth well over half its ready value (since bots/9;
// before, a Knight was 1.3 and a Maniac 2). Too low, and defeating a spent creature, which is permanent, looked worth less than spending a ready
// one, which a Recover undoes: the bot spread its hits instead of finishing what it had spent.
const CHAIN_VALUE = { fireball: 2.2, shift: 2.7, behind: 2.4, shadow: 2.4 };
// A spell that sits in the Chain is worth only about half of what it would do when released (since bots/10): it does nothing until released, and the other
// side's Witch's Kiss or Shift can take it first. At full value releasing a Fireball that defeated a spent Knight (2.6) barely beat keeping it (2.2), so the
// bots left loaded Chains standing about once a game (web/audit.mjs `heldKill`: 34 turns in 40 Knight games; 1 at 0.4). The playing strength was the same
// from 0.25 to 1 (head to head, 200 games each), so this changes what the bot does, not how well.
const HELD = 0.5;
/**
 * What a wound spell is worth to `P` against `O`. Behind You hits both sides' creatures (the rule again since later on 18 Nov 2026), so it is worth what it
 * takes from `O` less what it takes from `P`'s own, capped, and never below nothing (it can be skipped); for a while in bots/12 it hit only `O`'s and counted only theirs. Before bots/11 every wound Behind You counted 2.4
 * whatever stood on the board, so the bots wound it with nothing of the other side's open, and then skipped it. A Shift with no Guardian to take off and no spell in the other Chain does nothing yet,
 * so it counts a quarter.
 */
const BEHIND_CAP = 8, DEAD_SHIFT = 0.25;
const hitCost = (c) => (c.spent ? SPENT_VALUE[c.key] : READY_VALUE[c.key] - SPENT_VALUE[c.key]);          // a hit defeats a spent creature, and only spends a ready one
const openCreatures = (s, Q) => Q.field.filter((c) => READY_VALUE[c.key] !== undefined && !isGuarded(s, c));
function chainValue(s, c, P, O) {
  if (c.key === 'behind') { const sum = (Q) => openCreatures(s, Q).reduce((a, x) => a + hitCost(x), 0); return Math.max(0, Math.min(BEHIND_CAP, sum(O) - sum(P))); }
  if (c.key === 'shift' && !O.chain.length && !O.field.some((g) => g.key === 'guardian' && g.guards)) return CHAIN_VALUE.shift * DEAD_SHIFT;
  return CHAIN_VALUE[c.key] ?? 0;
}
const HAND_CARD = 0.9, END_COST = 0.35, SLIP_RANGE = 2.5, LOSS_DANGER = 40;
const HEART_SPENT = 10;                                                                               // a Heart that has taken its first blow: one more blow ends the game
/**
 * How many attacks `P` can make: the best ready attacker's sequence with the Field action, plus the next best attacker's with a Shadow Step wound in the
 * Chain (each attacker is spent after its sequence, so one attacker cannot use both). With `now`, only what is still usable this turn counts: the Field
 * action if it is unused, and a wound spell only while the Chain can still be released (or is resolving); a second attack on offer counts as one more.
 */
const usable = (s, now) => ({ field: !now || (!s.used.field && s.phase !== 'bonus'), chain: !now || s.phase === 'chain' || (!s.used.chain && s.phase !== 'bonus') });
/** `{ n, by }`: `n` attacks in all, made by `by` different creatures (at most two: the Field action and a Shadow Step). */
const strikes = (s, P, now = false, own = false) => {
  const u = usable(s, now), shadow = u.chain && P.chain.some((c) => c.key === 'shadow'), atk = P.field.filter((c) => c.key === 'knight' || c.key === 'maniac');
  // a spent attacker sheltered by a ready Lantern Keeper attacks as if ready (since bots/8); a Knight pairs with any other Knight of its owner's, ready or spent (18 Nov 2026)
  const lantern = P.field.some((l) => l.key === 'lantern' && !l.spent), strikes1 = (up) => (c) => up(c) || (lantern && c.spent);
  const len = (c) => (c.key === 'maniac' || (c.key === 'knight' && P.field.some((x) => x.key === 'knight' && x.id !== c.id)) ? 2 : 1);
  const seqs = (up) => atk.filter(strikes1(up)).map(len).sort((a, b) => b - a);
  const total = (x, field) => { const by = Math.min(x.length, (field ? 1 : 0) + (shadow ? 1 : 0)); return { n: x.slice(0, by).reduce((a, b) => a + b, 0), by }; };
  // `own` (the Warlock, since bots/14): a player may read their own hand, and each Rally in it stands one more spent attacker without an action
  const rallies = own ? P.hand.filter((c) => c.key === 'rally').length : 0;
  const ready = (rallies ? [...seqs((c) => !c.spent), ...atk.filter((c) => c.spent && !strikes1(() => false)(c)).map(len).sort((a, b) => b - a).slice(0, rallies)].sort((a, b) => b - a) : seqs((c) => !c.spent));
  const r = total(ready, u.field);
  if (now && s.phase === 'bonus') { r.n += 1; r.by += 1; }
  if (now) return r;
  // Next turn they may Recover first (since bots/4): every attacker stands, and backing is counted with every Knight ready. Recover uses the Field action,
  // so only a Shadow Step attacks after it, unless a Heaven's Resolve makes Recover free.
  const q = total(seqs(() => true), hasResolve(s, P.idx));
  return { n: Math.max(r.n, q.n), by: Math.max(r.by, q.by) };
};

function material(s, P, O) {
  let v = P.hand.length * HAND_CARD;                                       // only how many cards, never which
  if (P.hearts[0]?.spent) v -= HEART_SPENT;
  for (const c of P.field) {
    if (c.key === 'portal') v += 4.5;
    else if (c.key === 'resolve') v += 1.5 + 0.8 * P.field.filter((x) => x.key === 'knight' || x.key === 'maniac').length;       // free Recover: worth more the more attackers it keeps standing (bots/13: it stands only attackers)
    else v += (c.spent ? SPENT_VALUE : READY_VALUE)[c.key] ?? 0;
    if (c.key === 'guardian' && c.guards) v += c.guards === P.hearts[0]?.id ? 1.4 : 0.7;
  }
  for (const c of P.chain) v += chainValue(s, c, P, O) * HELD;
  return v;
}
/**
 * Can the spells wound in `att`'s Chain take every Guardian off `def`'s Heart? A Shift takes one off; a Fireball defeats a spent Guardian, and two
 * defeat a ready one. Shifts go to the ready Guardians first (they cost two Fireballs). The order of the spells and Behind You are left out. Before bots/4 any wound Shift counted as an open door, however many Guardians stood on the Heart, so a
 * second Guardian or an Angel never looked like a defence and the bot kept them in hand.
 */
function chainOpens(s, att, def, now) {
  if (!usable(s, now).chain) return false;
  const chain = s.players[att].chain, heart = s.players[def].hearts[0];
  let shifts = chain.filter((c) => c.key === 'shift').length, fireballs = chain.filter((c) => c.key === 'fireball').length;
  if (!shifts && !fireballs) return false;
  const guards = s.players[def].field.filter((c) => c.key === 'guardian' && c.guards === heart.id).sort((a, b) => !!a.spent - !!b.spent);       // ready ones first
  for (const g of guards) {
    if (shifts) { shifts--; continue; }
    fireballs -= g.spent ? 1 : 2;
  }
  return fireballs >= 0;
}
/**
 * How close `att` is to winning against `def` with the attacks it has: this turn's (`now`) or a fresh turn's. Only a blow on a spent Heart wins; on a ready
 * Heart it is a first blow, worth far less (the spent Heart itself is counted in `material`), unless the attacker has a second blow to follow it with.
 */
function pressure(s, att, def, now = false, own = false) {
  const { n, by } = strikes(s, s.players[att], now, own);
  if (!n) return 0;
  const heart = s.players[def].hearts[0], open = !isGuarded(s, heart) || hasPortal(s, att) || chainOpens(s, att, def, now);
  if (!open) return 0;
  // It takes two creatures to defeat a Heart (since bots/5): the creature whose attack lands on a ready Heart is defeated, so it has no second attack, and
  // a ready Heart falls only to two attackers. One creature's double on it is a first blow that costs that creature (counted in `material`), not a win.
  // Each ready Angel takes one attack and the attacker survives it (since bots/6 the Angels are counted, not just seen): `left` attacks reach the Heart,
  // and each creature lands at most one of them. With a single Angel this gives the same numbers as bots/5; with more, every Angel taken is progress,
  // and a threat into a wall of Angels counts for little, so the bot no longer spends its turns keeping the other side's Knights spent.
  const a = angels(s, def), left = n - a;
  if (left <= 0) return 2.5 * n / a;                                      // only Angels are taken: a grind, worth more the fewer Angels are left
  if (heart.spent || Math.min(left, by) > 1) return a ? 14 : 32;
  return a ? 7 : 5;
}
/**
 * What `att` could defeat of `def`'s spent creatures on a fresh turn (since bots/7): a hit defeats a spent creature, so each spent creature that is not
 * guarded (a ready Lantern Keeper guards them; a Warp Portal lets attacks ignore Guard) is at risk from `att`'s attacks and wound Fireballs, and every one
 * of them from a wound Behind You. The most valuable ones are counted, one per attack or Fireball, at what defeating it would cost (its spent value). Before, the bot only watched its Heart, so it had no reason to shelter its creatures or to deploy a Lantern.
 */
const EXPOSED = 0.6;
function exposure(s, att, def) {
  const A = s.players[att], spent = s.players[def].field.filter((c) => c.spent && READY_VALUE[c.key] !== undefined && !isGuarded(s, c));
  const guardedSpent = hasPortal(s, att) ? s.players[def].field.filter((c) => c.spent && READY_VALUE[c.key] !== undefined && isGuarded(s, c)) : [];
  if (!spent.length && !guardedSpent.length) return 0;
  const worth = (c) => SPENT_VALUE[c.key], sum = (xs) => xs.reduce((a, c) => a + worth(c), 0);
  const fireballs = A.chain.filter((c) => c.key === 'fireball').length, attacks = strikes(s, A).n;
  if (A.chain.some((c) => c.key === 'behind')) return EXPOSED * (sum(spent) + sum([...guardedSpent].sort((a, b) => worth(b) - worth(a)).slice(0, attacks)));
  const byAttack = [...spent, ...guardedSpent].sort((a, b) => worth(b) - worth(a)).slice(0, attacks), rest = spent.filter((c) => !byAttack.includes(c)).sort((a, b) => worth(b) - worth(a)).slice(0, fireballs);
  return EXPOSED * (sum(byAttack) + sum(rest));
}
/** Score of a position for `me` (higher is better). Reads only what a player can see. `caution` scales how much the other player's threat counts. */
export function evaluate(s, me, caution = 1, own = false) {
  if (s.phase === 'over') return s.winner === me ? 1e6 : -1e6;
  const foe = 1 - me, mine = s.turn === me;
  let v = material(s, s.players[me], s.players[foe]) - material(s, s.players[foe], s.players[me]);
  // my chance to win: in full only while this turn still has the actions to take it, otherwise as a threat for my next turn (`own`: counting my own Rallies)
  v += mine ? Math.max(pressure(s, me, foe, true, own), 0.55 * pressure(s, me, foe, false, own)) : 0.55 * pressure(s, me, foe, false, own);
  v -= pressure(s, foe, me) * (mine ? 0.8 : 1) * caution;                 // theirs
  v -= exposure(s, foe, me) * (mine ? 0.8 : 1) * caution;               // my spent creatures left open to a hit (only my own: counting theirs as a gain made two bots spend each other's Knights and Recover for ever)
  return v;
}

// ---- choosing --------------------------------------------------------------------------------------------------------------------------------
/** The moves that finish a forced sequence: resolving or skipping the head spell of a released Chain, and taking or declining a second attack. */
const FINISH = new Set(['fireball', 'shift', 'kiss', 'rally', 'behind', 'shadow', 'skip', 'attack', 'decline']);
/**
 * A move and whatever it forces: a released Chain cannot be left half done, and a first attack is only worth what the second one after it is worth, so
 * such a position is never judged half way. Each spell left in the Chain and a second attack on offer is played with the best one-move-ahead choice.
 */
function step(s, m, me) {
  let g = apply(s, m);
  for (let i = 0; i < 6 && g.turn === me && (g.phase === 'chain' || g.phase === 'bonus'); i++) {
    let best = null;
    for (const f of sensible(g)) if (FINISH.has(f.type)) { const n = apply(g, f), v = evaluate(n, me); if (!best || v > best.v) best = { n, v }; }
    if (!best) break;
    g = best.n;
  }
  return g;
}
/** The best score reachable by playing up to `depth` more moves of this turn, trying only the `beam` most promising each time, and the position it leads to: `{ v, g }`. Guardian moves are left out (they are judged at the end of the turn, see `chooseMove`). */
function reach(s, me, depth, beam) {
  const here = { v: evaluate(s, me), g: s };
  if (depth === 0 || s.phase === 'over' || s.turn !== me) return here;
  let best = here;
  const next = sensible(s).filter((m) => m.type !== 'end' && m.type !== 'reguard').map((m) => { const g = step(s, m, me); return { g, v: evaluate(g, me) }; }).sort((a, b) => b.v - a.v).slice(0, beam);
  for (const { g, v } of next) { const r = depth > 1 ? reach(g, me, depth - 1, beam) : { v, g }; if (r.v > best.v) best = r; }
  return best;
}

const GREEDY = { depth: 1, beam: 1, noise: 0, random: 0 }, steady = () => 0.5;
/** `seat`'s turn played out from `s` by a plain one-move-ahead choice (at most TURN_LIMIT moves, then wound up), and the position after it. */
function playOut(s, seat) {
  let g = s;
  for (let i = 0; g.phase !== 'over' && g.turn === seat && i < TURN_LIMIT; i++) g = apply(g, chooseMove(g, seat, GREEDY, steady));
  while (g.phase !== 'over' && g.turn === seat) { const all = legalMoves(g); g = apply(g, all.find((m) => m.type === 'end') ?? all.find((m) => m.type === 'decline') ?? all.find((m) => m.type === 'skip')); }
  return g;
}
/**
 * The cards the other player could hold, as far as `me` can tell (since bots/11): their deck list less every card of theirs that is in the open (both fields, Chains and
 * discard piles, and any of theirs in `me`'s hand). Their own hand and both piles are never read, only the size of their hand (see `danger`).
 */
function unseenPool(s, me) {
  const foe = 1 - me, left = { ...(s.settings?.deck ?? {}) };
  for (const c of [...s.players.flatMap((p) => [...p.field, ...p.chain, ...p.discard]), ...s.players[me].hand]) {
    const [owner, key, n] = String(c.id).split('-');                      // the starting Guardian ('-s0') is not in the deck
    if (owner === String(foe) && n !== 's0' && left[key] > 0) left[key]--;
  }
  return Object.entries(left).flatMap(([key, n]) => Array(n).fill(key));
}
const lcg = (seed) => { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); };
/** How many hands the other player is dealt from `unseenPool` when a Warlock weighs their answer. The same ones for every line it compares (`seed`), so lines are judged alike. */
const DEALS = 2;
/**
 * What the other player's answer to a position at the end of `me`'s turn would do to `me`'s Heart, judged with only what `me` can see of them: they
 * answer with their field and Chain and a hand dealt from the cards they could hold (`seed` given: the average over `DEALS` deals; before bots/11 they answered as if
 * their hand were empty, so a Warlock never feared a Fireball, a Shift or a Warp Portal it could not see, and its look at the answer was the Knight's with extra cost).
 * Without `seed` the hand is empty. Only the Heart is counted (a loss, a first blow, an Angel spent saving it): counting everything would teach the bot that cards kept in hand are safe, and it would stop deploying.
 */
function danger(s, me, seed = null) {
  if (s.phase === 'over') return 0;
  const foe = 1 - me, pool = seed === null ? null : unseenPool(s, me), tries = pool ? DEALS : 1, heart = (x) => x.players[me].hearts[0];
  let total = 0;
  for (let k = 0; k < tries; k++) {
    const g = JSON.parse(JSON.stringify(s)), f = g.players[foe], size = f.hand.length;
    f.hand = []; f.deck = [];
    if (pool) {
      const r = lcg(seed + 7919 * k), cards = pool.slice();
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      f.hand = cards.slice(0, size).map((key, i) => ({ id: `${foe}-${key}-x${i}`, key, owner: foe }));
    }
    const after = playOut(g, foe);
    if (after.phase === 'over') total += after.winner === me ? 0 : LOSS_DANGER;
    else total += (heart(after).spent && !heart(s).spent ? HEART_SPENT + 2 : 0) + (after.events.some((e) => e.t === 'rescue') || angels(after, me) < angels(s, me) ? 2 : 0);
  }
  return total / tries;
}
const angels = (s, me) => s.players[me].field.filter((c) => c.key === 'angel' && !c.spent).length;
/**
 * For the scanner (web/sim/luck.js): `s` is the position just after `me`'s turn ended. Does the other player defeat `me`'s Heart next turn with only what
 * `me` can see of them (field and Chain, hand and pile treated as empty)? Every line of up to `depth` Releases, attacks and Recovers is tried (a released
 * Chain and a second attack are played out as the bots would play them). A kill that needs a card from their hand (a drawn Rally, a Kiss-returned
 * Portal) is not counted. This is wider than `danger`, whose one-move-ahead reply ends its turn before a "release, then attack" kill.
 */
const KILL_MOVES = new Set(['release', 'attack', 'recover']);
export function visibleKill(s, me, depth = 3) {
  if (s.phase === 'over' || s.turn === me) return false;
  const foe = 1 - me, g = JSON.parse(JSON.stringify(s));
  g.players[foe].hand = []; g.players[foe].deck = [];
  const search = (x, d) => legalMoves(x).some((m) => {
    if (!KILL_MOVES.has(m.type)) return false;
    const y = step(x, m, foe);
    return y.phase === 'over' ? y.winner === foe : d > 1 && y.turn === foe && search(y, d - 1);
  });
  return search(g, depth);
}
/** For the scanner: a move and whatever it forces (a released Chain played to its end, a second attack taken or declined), as the bots judge a move. */
export const settle = (s, m, me) => step(s, m, me);

// ---- whole turns (the Warlock, since bots/14) ------------------------------------------------------------------------------------------------
/**
 * A key for a position within a turn: two orders of moves that reach the same board (Rally then Kiss, or Kiss then Rally) give the same key, so the
 * turn search looks at each position once. It covers everything a later move can depend on: both fields (in play order, which decides which Angel saves),
 * Hearts, hands, Chains, discard piles, the allowances and the Guardian move used, the phase and a second attack on offer.
 */
const cardKey = (c) => c.id + (c.spent ? '*' : '') + (c.guards ? '>' + c.guards : '');
export function posKey(s) {
  const side = (p) => [p.hearts.map(cardKey).join(','), p.field.map(cardKey).join(','), p.hand.map((c) => c.id).sort().join(','), p.chain.map((c) => c.id).join(','), p.discard.map((c) => c.id).sort().join(',')].join('|');
  return [s.turn, s.turnNumber, s.phase, s.used.field ? 1 : 0, s.used.chain ? 1 : 0, s.used.guard ? 1 : 0, s.bonus ? `${s.bonus.cardId}${s.bonus.free ? 'f' : ''}${s.bonus.back ?? ''}` : '', ...s.players.map(side)].join('/');
}
/** A small binary heap, highest `pri` first. */
function heap() {
  const a = [];
  const up = (i) => { while (i) { const p = (i - 1) >> 1; if (a[p].pri >= a[i].pri) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } };
  const down = (i) => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].pri > a[m].pri) m = l; if (r < a.length && a[r].pri > a[m].pri) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } };
  return { get size() { return a.length; }, push(x) { a.push(x); up(a.length - 1); }, pop() { const t = a[0], e = a.pop(); if (a.length) { a[0] = e; down(0); } return t; } };
}
/**
 * Every way `seat` could play the rest of its turn from `s`, searched best first: the positions that look best (by `evaluate` for `seat`) are opened first,
 * each position is opened once (`posKey`), and the search stops after `budget` positions have been opened. Every spell of a released Chain, every target,
 * a skip, the Field action taken between two spells and a second attack are branches of the search, not greedy picks, so a turn that only pays when its
 * moves come together (Rally, then a Fireball on the Guardian, then a paired Shadow Step) is found. Wherever the turn could end, that ending is a finished
 * turn: the position after "end", judged on the other side's turn. Returns the `keep` best finished turns, `{ v, g, line }` (the moves, in order), best first.
 * A turn that wins is `v >= 1e5`, and among them the shortest is first.
 */
const FINISH_OPEN = 16;
export function searchTurn(s, seat, { budget = 2000, keep = 6, own = false } = {}) {
  const ev = (g) => evaluate(g, seat, 1, own);
  const done = new Map(), seen = new Set([posKey(s)]), open = heap();
  const finish = (g, line) => {                                         // a finished turn: keep the best one per resulting position
    const k = posKey(g), v = ev(g) - (g.phase === 'over' ? line.length : 0);
    const was = done.get(k);
    if (!was || v > was.v) done.set(k, { v, g, line });
  };
  open.push({ pri: ev(s), g: s, line: [] });
  let opened = 0;
  while (open.size && opened < budget) {
    const { g, line } = open.pop();
    opened++;
    for (const m of sensible(g)) {
      const n = apply(g, m), l = [...line, m];
      if (m.type === 'end' || n.phase === 'over' || n.turn !== seat) { finish(n, l); continue; }
      const k = posKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      open.push({ pri: ev(n), g: n, line: l });
    }
  }
  const complete = !open.size;
  // the most promising positions the budget left unopened still finish (FINISH_OPEN of them; finishing them all could take seconds): each is played to
  // its end the way the Knight would see it, one move at a time
  for (let i = 0; open.size && i < FINISH_OPEN; i++) { const { g, line } = open.pop(); finishGreedy(g, seat, line, finish); }
  const out = [...done.values()].sort((a, b) => b.v - a.v).slice(0, keep);
  out.opened = opened; out.complete = complete;
  return out;
}
/** Play `g` to the end of `seat`'s turn with the best one-move-ahead choice (ending as soon as it may), recording the moves. */
function finishGreedy(g, seat, line, finish) {
  const l = [...line];
  for (let i = 0; g.phase !== 'over' && g.turn === seat && i < TURN_LIMIT; i++) {
    const moves = sensible(g), end = moves.find((m) => m.type === 'end');
    const m = end ?? moves.map((x) => ({ x, v: evaluate(apply(g, x), seat) })).sort((a, b) => b.v - a.v)[0].x;
    g = apply(g, m); l.push(m);
  }
  finish(g, l);
}
/**
 * The other side's best answer to a finished turn `g` (it is their turn), judged with only what `me` can see: they play their field and Chain and a hand
 * dealt from the cards they could hold (`unseenPool`), `deals` times with the same seed for every turn compared. Each deal they play their best whole turn
 * (by their own judgement); the result is `me`'s score after it, averaged. This is the Warlock's look at the answer (since bots/14); it replaces `danger`,
 * whose one-move-ahead answer missed kills that need a Release and then an attack.
 */
function answer(g, me, seed, { budget, deals, own }) {
  if (g.phase === 'over') return evaluate(g, me);
  const foe = 1 - me, pool = unseenPool(g, me);
  let total = 0;
  for (let k = 0; k < deals; k++) {
    const x = JSON.parse(JSON.stringify(g)), f = x.players[foe], size = f.hand.length, r = lcg(seed + 7919 * k), cards = pool.slice();
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    const fake = cards.map((key, i) => ({ id: `${foe}-${key}-x${i}`, key, owner: foe }));
    f.hand = fake.slice(0, size);
    f.deck = fake.slice(size, size + f.deck.length);                     // the same number of cards (an empty pile changes what they may deploy), never which
    const mine = x.players[me].deck;                                       // its own pile: the cards are known (deck list less what it has seen), their order is not
    for (let i = mine.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [mine[i], mine[j]] = [mine[j], mine[i]]; }
    const [best] = searchTurn(x, foe, { budget, keep: 1 });
    total += evaluate(best.g, me, 1, own);
  }
  return total / deals;
}
/**
 * The Warlock's choice (`profile.plan`): its best whole turns (`searchTurn`), each answered by the other side's best whole turn (`answer`, `profile.reply`
 * of them), and the first move of the turn that leaves it best placed after the answer. The rest of that turn is kept in `memo` with the position each
 * move expects, so the next moves of the turn are played without searching again, unless the position is not the one expected.
 */
function planMove(game, seat, profile, rng, trace, memo) {
  const planned = memo?.plan?.get(posKey(game));
  if (planned) return finishTrace(trace, 'plan', [[planned.id, 0]]) ?? planned;
  const own = !!profile.ownHand, turns = searchTurn(game, seat, { budget: profile.plan, keep: profile.reply, own });
  const deal = Math.floor(rng() * 2 ** 30);
  let pick;
  if (turns[0].v >= 1e5) pick = turns[0];                                 // a turn that wins: the shortest
  else {
    for (const t of turns) t.score = answer(t.g, seat, deal, { budget: profile.replyBudget, deals: profile.deals ?? DEALS, own }) + 0.1 * t.v + (rng() - 0.5) * 2 * profile.noise;
    pick = turns.reduce((a, b) => (b.score > a.score ? b : a));
  }
  if (memo) {                                                             // remember the rest of the turn, keyed by the position each move is played from
    memo.plan = new Map();
    let g = game;
    for (const m of pick.line) { memo.plan.set(posKey(g), m); g = apply(g, m); }
  }
  finishTrace(trace, 'turn', turns.map((t) => [t.line.map((m) => m.id).join(' > '), Math.round((t.score ?? t.v) * 100) / 100]));
  return pick.line[0];
}
const finishTrace = (trace, kind, top) => { if (trace) { trace.kind = kind; trace.top = top; } return null; };

/**
 * The moves a bot considers. Some legal moves are ones no player makes, and a bot never chooses them (they only fed loops and wasted cards):
 * a Witch's Kiss that takes a Shift out of a Chain (since bots/11:
 * the Shift goes back and forth, a card was wound three times in a game in one game in five), and a Fireball at the player's own card (skipping it costs nothing).
 */
let holding = false;                                                      // set by a bot (see `makeBot`) for a turn in which it keeps its Witch's Kiss in hand
const sensible = (game) => legalMoves(game).filter((m) => {
  if (holding && m.type === 'cast' && m.spell === 'kiss') return false;
  if (m.type === 'cast' && m.spell === 'kiss') { const at = locate(game, m.targetId); if (at?.zone === 'chain' && at.card.key === 'shift') return false; }        // a Kiss taking a Kiss is no longer legal (19 Nov 2026)
  if (m.type === 'fireball' && locate(game, m.targetId)?.p.idx === game.turn) return false;
  return true;
});

/**
 * Choose a legal move for the player at `seat`, whose turn it is. `rng` returns [0, 1). If `trace` is given it is filled with why: `kind` is
 * 'only' (one move), 'random', 'win' or 'search', and `top` the best four candidates as `[id, score]`.
 */
export function chooseMove(game, seat, profile = PROFILES.knight, rng = Math.random, trace = null, memo = null) {
  const moves = sensible(game);
  const done = (m, kind, list = []) => { if (trace) { trace.kind = kind; trace.top = list.slice(0, 4).map((x) => [x.m.id, Math.round(x.score * 100) / 100]); } return m; };
  if (moves.length === 1) return done(moves[0], 'only');
  if (profile.plan) return planMove(game, seat, profile, rng, trace, memo);
  const nonEnd = moves.filter((m) => m.type !== 'end');
  if (profile.random && nonEnd.length && rng() < profile.random) return done(nonEnd[Math.floor(rng() * nonEnd.length)], 'random');
  const caution = profile.caution ?? 1, here = evaluate(game, seat, caution);
  const scored = moves.map((m) => {
    // Doing nothing more costs a little, so a useful move always beats it. Ending is scored as the position it really leaves, on the other player's turn
    // (since bots/10): before, it was this position judged as still mine, with their threats discounted, so in a bad position ending always looked a few
    // points better than any move that happened to end the turn (a free Recover after both actions are used passed the turn on its own).
    if (m.type === 'end') return { m, score: 1.25 * evaluate(apply(game, m), seat, caution) - END_COST };
    // A Guardian's place matters only when the turn ends (since bots/16 moving one is free, any time; once a turn since bots/17): a move is scored as the turn ending with it there, as
    // "end" is. Judged mid-turn, where the other side's threats count less, sliding a Guardian off the Heart looked a little better than ending, every turn.
    if (m.type === 'reguard') { const n = apply(game, m), ended = n.phase === 'play' ? apply(n, { id: 'end' }) : null; if (ended) return { m, score: 1.25 * evaluate(ended, seat, caution) - END_COST }; }
    const g = step(game, m, seat);
    return { m, g, v: evaluate(g, seat, caution) };
  });
  const cands = scored.filter((x) => x.g).sort((a, b) => b.v - a.v);
  if (cands[0] && cands[0].v >= 1e5) {                                    // a move that wins now (or a forced line that does): of several, the one that does least harm on the way
    const wins = cands.filter((x) => x.v >= 1e5).map((x) => ({ ...x, score: evaluate(apply(game, x.m), seat) })).sort((a, b) => b.score - a.score);
    return done(wins[0].m, 'win', wins);
  }
  cands.forEach((x, i) => { const r = profile.depth > 1 && i < profile.beam + 2 ? reach(x.g, seat, profile.depth - 1, profile.beam) : { v: x.v, g: x.g }; x.score = r.v + 0.25 * x.v; x.line = r.g; });
  for (const x of scored) x.score += (rng() - 0.5) * 2 * profile.noise;
  if (profile.slip && rng() < profile.slip) {                            // a believable mistake: one of the next few moves it likes, never one far worse
    const ranked = [...scored].sort((a, b) => b.score - a.score), near = ranked.slice(1, 4).filter((x) => x.m.type !== 'end' && x.score > ranked[0].score - SLIP_RANGE);       // a lesser action, never passing
    if (near.length) return done(near[Math.floor(rng() * near.length)].m, 'slip', ranked);
  }
  if (profile.reply) {                                                   // the few best lines, each played to the end of the turn, less what the answer would do to the Heart
    const pool = [...cands].sort((a, b) => b.score - a.score).slice(0, profile.reply), stop = scored.find((x) => x.m.type === 'end'), deal = Math.floor(rng() * 2 ** 30);
    for (const x of pool) x.score -= danger(playOut(x.line, seat), seat, deal);
    if (stop) stop.score -= danger(apply(game, stop.m), seat, deal);
    const pick = [...pool, ...(stop ? [stop] : [])].sort((a, b) => b.score - a.score);
    return done(pick[0].m, 'search', pick);
  }
  return done(scored.reduce((a, b) => (b.score > a.score ? b : a)).m, 'search', [...scored].sort((a, b) => b.score - a.score));
}

/** Most moves a bot may make in one turn before it is made to finish it: a backstop so that no turn can run on for ever, whatever it prefers. */
export const TURN_LIMIT = 16;

/**
 * A bot for one seat: `bot.move(game)` is the move to make now. It is `chooseMove` plus the backstop above, and it owns its random numbers
 * (`seed`), so the same seed plays the same game. Use this, not `chooseMove`, when a bot plays a whole game.
 */
export function makeBot(profile, seat, seed = 1) {
  let x = seed >>> 0, turn = -1, made = 0, heldTurn = -1, held = false;
  const memo = {};                                                        // the rest of a planned turn (the Warlock)
  const rng = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  return {
    seat, profile,
    move(game, trace = null) {
      if (game.turn !== seat) throw new Error(`It is not seat ${seat}'s turn.`);
      if (game.turnNumber !== turn) { turn = game.turnNumber; made = 0; }
      if (++made > TURN_LIMIT) {                                          // wind the turn up: finish the Chain and any second attack, then end
        const all = legalMoves(game);
        if (trace) trace.kind = 'turn-limit';
        return all.find((m) => m.type === 'end') ?? all.find((m) => m.type === 'decline') ?? all.find((m) => m.type === 'skip');
      }
      // A Witch's Kiss played the moment it is held is easy to read. Each turn the bot decides, by chance, whether to keep it back (`hold`), so it comes out
      // at different times. It never keeps it back once either Heart has been hit: then it is a race, and every card counts.
      if (game.turnNumber !== heldTurn) { heldTurn = game.turnNumber; held = rng() < (profile.hold ?? 0) && !game.players.some((p) => p.hearts[0]?.spent); }
      holding = held;
      try { return chooseMove(game, seat, profile, rng, trace, memo); } finally { holding = false; }
    },
  };
}
