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
import { legalMoves, apply, isGuarded, hasPortal, locate } from '../../src/index.js';

/** Bumped whenever a profile or `evaluate` changes, so saved game logs say which bots played them. */
export const BOT_VERSION = 'bots/3';

/**
 * Squire is a beginner: it looks one move ahead, half-sees threats (`caution`) and now and then settles for a lesser move (`slip`), never a wild one.
 * Knight plays soundly. Warlock plays like a Knight that also sees your answer coming: its few best lines (`reply`) are played to the end of the turn
 * and answered with what it can see of yours, never with the cards in your hand, and a line that leaves its Heart open to that answer is marked down.
 */
export const PROFILES = {
  squire: { name: 'Squire', blurb: 'Plays loosely: misses threats, and sometimes settles for a lesser move.', depth: 1, beam: 5, noise: 1.5, slip: 0.3, caution: 0.5 },
  knight: { name: 'Knight', blurb: 'Plays soundly.', depth: 2, beam: 6, noise: 0.5, random: 0 },
  warlock: { name: 'Warlock', blurb: 'Plays soundly, and sees your answer coming.', depth: 2, beam: 6, noise: 0.05, reply: 4 },
};

// ---- how good a position is ----------------------------------------------------------------------------------------------------------------
const READY_VALUE = { knight: 4, maniac: 6, angel: 3.2, guardian: 1.8, lantern: 2.6 }, SPENT_VALUE = { knight: 1.3, maniac: 2, angel: 0.5, guardian: 1.5, lantern: 0.6 };
const CHAIN_VALUE = { fireball: 2.2, shift: 2.7, behind: 2.4, shadow: 2.4 };
const HAND_CARD = 0.9, END_COST = 0.35, SLIP_RANGE = 2.5, LOSS_DANGER = 40;
const HEART_SPENT = 10;                                                     // a Heart that has taken its first blow: one more blow ends the game
/** How many attacks a ready creature makes in one sequence: a Maniac two, a Knight two while another Knight is ready (backing), else one. */
const sequence = (P, c) => (c.key === 'maniac' || (c.key === 'knight' && P.field.some((x) => x.key === 'knight' && !x.spent && x.id !== c.id)) ? 2 : 1);
/**
 * How many attacks `P` can make: the best ready attacker's sequence with the Field action, plus the next best attacker's with a Shadow Step wound in the
 * Chain (each attacker is spent after its sequence, so one attacker cannot use both). With `now`, only what is still usable this turn counts: the Field
 * action if it is unused, and a wound spell only while the Chain can still be released (or is resolving); a second attack on offer counts as one more.
 */
const usable = (s, now) => ({ field: !now || (!s.used.field && s.phase !== 'bonus'), chain: !now || s.phase === 'chain' || (!s.used.magic && s.phase !== 'bonus') });
const strikes = (s, P, now = false) => {
  const m = P.field.filter((c) => !c.spent && (c.key === 'knight' || c.key === 'maniac')).map((c) => sequence(P, c)).sort((a, b) => b - a), u = usable(s, now);
  const shadow = u.chain && P.chain.some((c) => c.key === 'shadow');
  return (now && s.phase === 'bonus' ? 1 : 0) + (u.field ? (m[0] ?? 0) + (shadow ? m[1] ?? 0 : 0) : shadow ? m[0] ?? 0 : 0);
};
const angelUp = (P) => P.field.some((c) => c.key === 'angel' && !c.spent);

function material(s, P) {
  let v = P.hand.length * HAND_CARD;                                       // only how many cards, never which
  if (P.hearts[0]?.spent) v -= HEART_SPENT;
  for (const c of P.field) {
    if (c.key === 'portal') v += 4.5;
    else if (c.key === 'resolve') v += 1.5 + 0.8 * P.field.filter((x) => READY_VALUE[x.key] !== undefined).length;       // free Recover: worth more the more creatures it keeps standing
    else v += (c.spent ? SPENT_VALUE : READY_VALUE)[c.key] ?? 0;
    if (c.key === 'guardian' && c.guards) v += c.guards === P.hearts[0]?.id ? 1.4 : 0.7;
  }
  for (const c of P.chain) v += CHAIN_VALUE[c.key] ?? 0;
  return v;
}
/**
 * How close `att` is to winning against `def` with the attacks it has: this turn's (`now`) or a fresh turn's. Only a blow on a spent Heart wins; on a ready
 * Heart it is a first blow, worth far less (the spent Heart itself is counted in `material`), unless the attacker has a second blow to follow it with.
 */
function pressure(s, att, def, now = false) {
  const n = strikes(s, s.players[att], now);
  if (!n) return 0;
  const heart = s.players[def].hearts[0], open = !isGuarded(s, heart) || hasPortal(s, att);
  if (!open) return usable(s, now).chain && s.players[att].chain.some((c) => c.key === 'shift') ? 6 : 0;        // a wound Shift can take the guard away
  if (angelUp(s.players[def])) return heart.spent ? (n > 1 ? 14 : 5) : (n > 1 ? 7 : 2.5);       // the Angel takes the first blow (and a second turns a ready Heart spent)
  return heart.spent || n > 1 ? 32 : 5;
}
/** Score of a position for `me` (higher is better). Reads only what a player can see. `caution` scales how much the other player's threat counts. */
export function evaluate(s, me, caution = 1) {
  if (s.phase === 'over') return s.winner === me ? 1e6 : -1e6;
  const foe = 1 - me, mine = s.turn === me;
  let v = material(s, s.players[me]) - material(s, s.players[foe]);
  // my chance to win: in full only while this turn still has the actions to take it, otherwise as a threat for my next turn
  v += mine ? Math.max(pressure(s, me, foe, true), 0.55 * pressure(s, me, foe)) : 0.55 * pressure(s, me, foe);
  v -= pressure(s, foe, me) * (mine ? 0.8 : 1) * caution;                 // theirs
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
/** The best score reachable by playing up to `depth` more moves of this turn, trying only the `beam` most promising each time, and the position it leads to: `{ v, g }`. */
function reach(s, me, depth, beam) {
  const here = { v: evaluate(s, me), g: s };
  if (depth === 0 || s.phase === 'over' || s.turn !== me) return here;
  let best = here;
  const next = sensible(s).filter((m) => m.type !== 'end').map((m) => { const g = step(s, m, me); return { g, v: evaluate(g, me) }; }).sort((a, b) => b.v - a.v).slice(0, beam);
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
 * What the other player's answer to a position at the end of `me`'s turn would do to `me`'s Heart, judged with only what `me` can see of them: they
 * answer with their field and Chain, as if their hand and pile were empty (never with the cards they really hold). Only the Heart is counted (a loss,
 * a first blow, an Angel spent saving it): counting everything would teach the bot that cards kept in hand are safe, and it would stop deploying.
 */
function danger(s, me) {
  if (s.phase === 'over') return 0;
  const g = JSON.parse(JSON.stringify(s)), foe = g.players[1 - me];
  foe.hand = []; foe.deck = [];
  const after = playOut(g, 1 - me), heart = (x) => x.players[me].hearts[0];
  if (after.phase === 'over') return after.winner === me ? 0 : LOSS_DANGER;
  return (heart(after).spent && !heart(s).spent ? HEART_SPENT + 2 : 0) + (after.events.some((e) => e.t === 'rescue') || angels(after, me) < angels(s, me) ? 2 : 0);
}
const angels = (s, me) => s.players[me].field.filter((c) => c.key === 'angel' && !c.spent).length;

/** The moves a bot considers. A Witch's Kiss that takes back a Witch's Kiss only trades one for the other (and two of them could do it for ever), so it is never chosen. */
const sensible = (game) => legalMoves(game).filter((m) => !(m.type === 'cast' && m.spell === 'kiss' && locate(game, m.targetId)?.card.key === 'kiss'));

/**
 * Choose a legal move for the player at `seat`, whose turn it is. `rng` returns [0, 1). If `trace` is given it is filled with why: `kind` is
 * 'only' (one move), 'random', 'win' or 'search', and `top` the best four candidates as `[id, score]`.
 */
export function chooseMove(game, seat, profile = PROFILES.knight, rng = Math.random, trace = null) {
  const moves = sensible(game);
  const done = (m, kind, list = []) => { if (trace) { trace.kind = kind; trace.top = list.slice(0, 4).map((x) => [x.m.id, Math.round(x.score * 100) / 100]); } return m; };
  if (moves.length === 1) return done(moves[0], 'only');
  const nonEnd = moves.filter((m) => m.type !== 'end');
  if (profile.random && nonEnd.length && rng() < profile.random) return done(nonEnd[Math.floor(rng() * nonEnd.length)], 'random');
  const caution = profile.caution ?? 1, here = evaluate(game, seat, caution);
  const scored = moves.map((m) => {
    if (m.type === 'end') return { m, score: 1.25 * here - END_COST };    // doing nothing more costs a little, so a useful move always beats it
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
    const pool = [...cands].sort((a, b) => b.score - a.score).slice(0, profile.reply), stop = scored.find((x) => x.m.type === 'end');
    for (const x of pool) x.score -= danger(playOut(x.line, seat), seat);
    if (stop) stop.score -= danger(apply(game, stop.m), seat);
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
  let x = seed >>> 0, turn = -1, made = 0;
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
      return chooseMove(game, seat, profile, rng, trace);
    },
  };
}
