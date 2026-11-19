/**
 * Bot against bot, and a very small log of it. Pure: no DOM, no timers, so a script, a test or the page can all use it.
 *
 *   const { winner, log } = runMatch({ seed: 7, bots: ['knight', 'warlock'] });   // bots[seat] is a PROFILES id; seat 0 goes first
 *
 * The log is one header line and then ONE LINE PER TURN, written when the turn starts (after its draw), with the moves the player then made:
 *
 *   t3 p0|hand 5 4|deck 12 13|disc 1 0|chain F,S -|field G>h,K,a G>h,k|mv dep:K atk:K2>oG1=s end
 *
 * Each `|` part is `name seat0 seat1` (a list is comma separated, `-` is empty). `field` lists a seat's cards in play: a capital is ready, a lower case
 * letter is spent, `G>h` is a Guardian guarding the Heart and `G>2` one guarding the 2nd card of that field. Moves name a card in play by its letter and
 * place in its field (`K2`, `h` the Heart), a card of the other player with a leading `o`, and a card in a discard pile or a Chain with `d` or `c`.
 * `=s` the target turned spent, `=x` it was defeated, `=r` an Angel took the blow, `=W` the attack won. The last line is `end win=p1 turns=12` and the final position.
 * Only counts are logged for hands and piles: the log never says which cards are in a hand.
 */
import { newGame, legalMoves, apply, locate, viewFor, CARDS, DECK } from '../../src/index.js?v=b3f8a59';
import { makeBot, PROFILES, TURN_LIMIT, BOT_VERSION } from './bot.js?v=b3f8a59';

const CODE = { knight: 'K', maniac: 'M', guardian: 'G', angel: 'A', lantern: 'L', portal: 'P', resolve: 'H', fireball: 'F', shift: 'S', behind: 'B', shadow: 'D', rally: 'R', kiss: 'W' };
export const LEGEND = '# fcr1 K Knight, M Maniac, G Guardian, A Angel, L Lantern Keeper, P Portal, H Heaven\'s Resolve, F Fireball, S Shift, B Behind You, D Shadow Step, R Rally, W Witch\'s Kiss; lower case = spent; G>h guards the Heart, G>n the nth card of that field';

const letter = (c) => (c.spent ? CODE[c.key].toLowerCase() : CODE[c.key]);
/** A card in play named by its letter and place in its field ("K2"), the Heart as "h"; a card of the other player gets a leading "o". */
function ref(s, id, me) {
  const at = locate(s, id);
  if (!at) return '?';
  const { card, zone, p } = at, o = p.idx === me ? '' : 'o';
  if (zone === 'hearts') return `${o}h`;
  if (zone === 'field') return `${o}${letter(card)}${p.field.indexOf(card) + 1}`;
  return `${zone === 'chain' ? 'c' : 'd'}${CODE[card.key]}`;
}
const guardRef = (s, id, p) => (id == null ? '-' : id === p.hearts[0].id ? 'h' : String(p.field.findIndex((c) => c.id === id) + 1));
const fieldOf = (s, p) => p.field.length ? p.field.map((c) => letter(c) + (c.key === 'guardian' && c.guards ? `>${guardRef(s, c.guards, p)}` : '')).join(',') : '-';
const both = (s, name, f) => `${name} ${s.players.map(f).join(' ')}`;
/** The position in a few words: hand, pile, discard and Chain sizes or letters, and each field. */
export function snapshot(s) {
  return [
    both(s, 'hand', (p) => p.hand.length), both(s, 'deck', (p) => p.deck.length), both(s, 'disc', (p) => p.discard.length),
    both(s, 'chain', (p) => (p.chain.length ? p.chain.map((c) => CODE[c.key]).join(',') : '-')), both(s, 'field', (p) => fieldOf(s, p)),
  ].join('|');
}
/** One move as a short token, from the game before it and the events it caused. An attacker defeated by its own first blow on a Heart is not counted as `=x`: the token reads `=s`, the Heart turned spent. */
export function token(before, move, after) {
  const me = before.turn, r = (id) => ref(before, id, me), e = after.events;
  const result = e.some((x) => x.t === 'win') ? '=W' : e.some((x) => x.t === 'rescue') ? '=r' : e.some((x) => x.t === 'defeat' && x.id !== (move.cardId ?? move.attackerId)) ? '=x' : e.some((x) => x.t === 'hit') ? '=s' : '';
  const hand = (id) => CODE[before.players[me].hand.find((c) => c.id === id)?.key] ?? '?';
  switch (move.type) {
    case 'deploy': return `dep:${hand(move.cardId)}${move.dest === 'guard' ? `>${r(move.targetId)}` : ''}`;
    case 'attack': return `${move.bonus ? 'atk2' : 'atk'}:${r(move.cardId)}>${r(move.targetId)}${result}`;
    case 'decline': return 'no2';
    case 'reguard': return `gd:${r(move.cardId)}>${move.dest === 'none' ? '-' : r(move.targetId)}`;
    case 'recover': return 'rec';
    case 'wind': return `wind:${hand(move.cardId)}@${move.pos}${move.rearranged ? '~' : ''}`;
    case 'release': return 'rel';
    case 'end': return 'end';
    case 'skip': return `skip:${CODE[before.players[me].chain[0].key]}`;
    case 'fireball': return `fb:${r(move.targetId)}${result}`;
    case 'behind': return `by${result}`;
    case 'shift': return `sh:${r(move.targetId)}`;
    case 'shadow': return `sd:${r(move.attackerId)}>${r(move.targetId)}${result}`;
    case 'cast': return move.spell === 'rally' ? `ra:${r(move.targetId)}` : `ki:${r(move.targetId)}${move.toId ? `>${r(move.toId)}` : ''}`;
    case 'rally': return `ra:${r(move.targetId)}`;
    case 'kiss': return `ki:${r(move.targetId)}${move.toId ? `>${r(move.toId)}` : ''}`;
    default: return move.type;
  }
}

/** Collects the log. Call `move(before, move, after)` for every move made, in order, then read `text()`. */
export class MatchLog {
  constructor(meta = '') { this.lines = [LEGEND, `# ${meta}`.trim()]; this.turn = null; this.moves = []; }
  flush() { if (this.turn) this.lines.push(`${this.turn}|mv ${this.moves.join(' ')}`); this.turn = null; this.moves = []; }
  /** Record `move`, played in `before` giving `after`. */
  move(before, move, after) {
    if (!this.turn || before.turnNumber !== this.n) { this.flush(); this.n = before.turnNumber; this.turn = `t${before.turnNumber} p${before.turn}|${snapshot(before)}`; }
    this.moves.push(token(before, move, after));
  }
  /** The last line: who won (or `-` when the game was stopped) and the final position. */
  finish(game) { this.flush(); this.lines.push(`end win=${game.winner === null ? '-' : `p${game.winner}`} turns=${game.turnNumber}|${snapshot(game)}`); }
  text() { return this.lines.join('\n') + '\n'; }
}

/** Play a whole game between two bots and return it with its compact log. `playGame` below does the playing, with all its limits; a stopped game has `winner: null`. */
export function runMatch({ seed = 1, bots = ['knight', 'knight'], maxTurns = 150, setup = null } = {}) {
  const log = new MatchLog(`seed=${seed} p0=${bots[0]} p1=${bots[1]}`);
  const r = playGame({ seed, bots, setup, limits: { maxTurns }, onMove: (before, move, after) => log.move(before, move, after) });
  log.finish(r.game);
  return { game: r.game, winner: r.game.winner, turns: r.game.turnNumber, plies: r.actions, status: r.status, reason: r.reason, log: log.text() };
}

// ---- the game loop every bot game runs through (the page's Bot vs Bot, runMatch, web/sim.mjs) ----------------------------------------------

/** The shape of the records `playGame` emits. Bump it when a record changes shape. */
export const LOG_SCHEMA = 'fcr-game-log/1';
/**
 * How long a game may run before it is stopped and recorded as aborted (never as a result):
 *   maxActions all moves in the game, maxTurns turns, maxTurnActions moves in one turn, maxMs wall-clock time (only a backstop: it depends on how busy
 *   the machine is, so the move and turn limits and the two stall checks are what normally stop a game),
 *   repeatLimit how often the same whole position may stand at the start of a turn (it can only recur once a draw pile is empty, and a bot may still
 *   break out of a short cycle, so a few returns are allowed), stallTurns turns in a row with no progress (no card drawn, deployed or defeated, no blow on a Heart).
 */
export const DEFAULT_LIMITS = { maxActions: 3000, maxTurns: 200, maxTurnActions: 40, maxMs: 300000, repeatLimit: 4, stallTurns: 30 };
/** Players besides the bot profiles: `random` (any legal move, for a baseline) and `passive` (does nothing; for testing the stall limits). */
export const POLICIES = ['random', 'passive'];

/** A player for one seat: `move(game, trace)` returns a legal move. `id` is a PROFILES id or one of POLICIES. */
export function makePlayer(id, seat, seed) {
  if (PROFILES[id]) return makeBot(PROFILES[id], seat, seed);
  if (!POLICIES.includes(id)) throw new Error(`Unknown bot "${id}". Use ${[...Object.keys(PROFILES), ...POLICIES].join(', ')}.`);
  let x = seed >>> 0, turn = -1, made = 0;
  const rng = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  return {
    seat, profile: { name: id },
    move(game, trace = null) {
      const all = legalMoves(game), stop = all.find((m) => m.type === 'end') ?? all.find((m) => m.type === 'decline') ?? all.find((m) => m.type === 'skip');
      if (game.turnNumber !== turn) { turn = game.turnNumber; made = 0; }
      if (trace) trace.kind = id;
      if (id === 'passive' || ++made > TURN_LIMIT) return stop ?? all[0];
      return all[Math.floor(rng() * all.length)];
    },
  };
}

/** Card key from a card id (`0-knight-2`, `1-guardian-s0`, `0-heart-1`); ids never change, even when a Witch's Kiss changes a card's side. */
export const keyOf = (id) => id.split('-')[1];
const bare = (s) => { const { events, ...rest } = s; return rest; };
const PROGRESS = new Set(['draw', 'deploy', 'defeat', 'rescue', 'win']);
const progressed = (s, events) => events.some((e) => PROGRESS.has(e.t) || (e.t === 'hit' && keyOf(e.id) === 'heart'));
const position = (s) => JSON.stringify([s.players, s.turn, s.phase, s.used]);

/**
 * A scenario for testing a card or a behaviour, applied to the dealt game before the first move:
 *   { deck: { key: count }, hand: { 0: ['shadow'] }, field: { 1: ['lantern', 'knight:spent'] }, chain: { 0: ['fireball'] }, discard: { 1: ['portal'] }, spentHeart: [1] }
 * Each listed card is one of that seat's own copies (so the deck must hold it), taken from its draw pile, or from its hand if all are dealt (the hand then
 * draws a card in its place). Asking for a card in the hand is met by a dealt copy if there is one; otherwise one dealt card that was not asked for goes
 * back under the pile, so the hand keeps its size. A field card is ready unless it says `:spent`; a Guardian placed this way guards nothing.
 */
export function prepare(game, setup = {}) {
  const g = JSON.parse(JSON.stringify(game));
  for (const seat of [0, 1]) {
    const p = g.players[seat], asked = new Set();
    for (const zone of ['field', 'chain', 'discard', 'hand']) for (const entry of setup[zone]?.[seat] ?? []) {
      const [key, flag] = entry.split(':'), dealt = p.hand.findIndex((c) => c.key === key && !asked.has(c.id));
      if (!CARDS[key]) throw new Error(`Setup: no card "${key}".`);
      if (zone === 'chain' && CARDS[key].kind !== 'spell') throw new Error(`Setup: only spells can be wound, not "${key}".`);
      if (zone === 'field' && !['creature', 'device'].includes(CARDS[key].kind)) throw new Error(`Setup: "${key}" cannot stand on the field.`);
      if (zone === 'hand' && dealt >= 0) { asked.add(p.hand[dealt].id); continue; }          // already dealt to it
      let c, i = p.deck.findLastIndex((x) => x.key === key);
      if (i >= 0) [c] = p.deck.splice(i, 1);
      else if (dealt >= 0) { [c] = p.hand.splice(dealt, 1); if (p.deck.length) p.hand.push(p.deck.pop()); }      // taken from the hand, which draws a card in its place
      else throw new Error(`Setup: seat ${seat} has no ${key} left to place.`);
      if (zone === 'field' && (flag === 'spent' || key === 'maniac')) c.spent = true;
      p[zone].push(c); asked.add(c.id);
      if (zone === 'hand') { const j = p.hand.findIndex((x) => !asked.has(x.id)); if (j >= 0) p.deck.unshift(p.hand.splice(j, 1)[0]); }
    }
    if ((setup.spentHeart ?? []).includes(seat)) p.hearts[0].spent = true;
  }
  legalMoves(g);
  return g;
}

/**
 * One bot game, move by move, through the engine's own `legalMoves` and `apply`, with every limit in DEFAULT_LIMITS enforced. Pure apart from the clock.
 *
 *   playGame({ seed, bots: ['knight', 'warlock'], setup, limits, gameId, versions, views, emit, onMove, players })
 *     -> { gameId, status: 'completed' | 'aborted', reason, winner, game, turns, actions, ms, diagnostic }
 *
 * `emit(record, audience)` receives the game log, one record at a time (see docs/SIM.md): audience 'observer' sees everything; with `views: true` the same
 * records are emitted again for audience 0 and 1, as that seat sees them (`viewFor`: the other hand and both piles hidden, the other seat's legal moves and
 * reasoning left out). `onMove(before, move, after)` is called for every move. `players[seat]`, if given, plays that seat instead of `bots[seat]` (any
 * object with `move(game, trace)` returning a legal move: an agent's own policy; `bots[seat]` is then only its name in the log). A game that hits a limit, or whose bot fails, ends `aborted` with a
 * `diagnostic`; only a game that reached a winner is `completed`.
 */
export function playGame({ seed = 1, bots = ['knight', 'knight'], setup = null, limits = {}, gameId = null, versions = {}, views = false, emit = () => {}, onMove = () => {}, players: given = null, now = Date.now } = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }, id = gameId ?? `${bots[0]}-${bots[1]}-s${seed}`, t0 = now();
  const players = bots.map((b, seat) => given?.[seat] ?? makePlayer(b, seat, seed * 2 + seat));
  let game = newGame(seed, setup?.deck ? { deck: setup.deck } : {});
  if (setup) game = prepare(game, setup);
  const out = (rec, seatView) => { emit(rec, 'observer'); if (views) for (const seat of [0, 1]) emit(seatView(seat), seat); };
  const seen = new Map(), recent = [];
  let actions = 0, turnActions = 0, turn = null, lastProgress = game.turnNumber, stop = null;

  out({ k: 'game', schema: LOG_SCHEMA, gameId: id, seed, bots, setup, limits: L, versions: { bots: BOT_VERSION, deck: setup?.deck ?? DECK, ...versions }, initial: bare(game) },
    (seat) => ({ k: 'game', schema: LOG_SCHEMA, gameId: id, seat, seed, bots, setup, versions: { bots: BOT_VERSION, ...versions }, initial: bare(viewFor(game, seat)) }));
  while (game.phase !== 'over') {
    if (game.turnNumber !== turn) {                              // a turn starts: the turn limits and the stall checks
      turn = game.turnNumber; turnActions = 0;
      if (turn > L.maxTurns) { stop = { reason: 'turn-limit', detail: `more than ${L.maxTurns} turns` }; break; }
      const key = position(game), at = seen.get(key);
      seen.set(key, at ? { first: at.first, n: at.n + 1 } : { first: turn, n: 1 });
      if (at && at.n + 1 >= L.repeatLimit) { stop = { reason: 'repetition', detail: `the position at the start of turn ${turn} first stood at turn ${at.first} and has now stood ${at.n + 1} times` }; break; }
      if (turn - lastProgress > L.stallTurns) { stop = { reason: 'no-progress', detail: `no card drawn, deployed or defeated and no blow on a Heart since turn ${lastProgress}` }; break; }
      const g = game;
      out({ k: 'turn', n: turn, seat: g.turn, state: bare(g) }, (seat) => ({ k: 'turn', n: turn, seat: g.turn, state: bare(viewFor(g, seat)) }));
    }
    if (actions >= L.maxActions) { stop = { reason: 'action-limit', detail: `more than ${L.maxActions} moves` }; break; }
    if (++turnActions > L.maxTurnActions) { stop = { reason: 'turn-action-limit', detail: `more than ${L.maxTurnActions} moves in turn ${turn}` }; break; }
    const before = game, seat = before.turn, legal = legalMoves(before), decision = {};
    let move, after;
    try {
      move = players[seat].move(before, decision);
      after = apply(before, move);
    } catch (err) { stop = { reason: 'error', detail: `${err.message} (seat ${seat}, move ${move?.id ?? 'none'})` }; break; }
    const foeHeart = before.players[1 - seat].hearts[0].id;              // a move that would have won on the spot, whether or not it was taken
    const wins = legal.filter((m) => m.targetId === foeHeart && (m.type === 'attack' || m.type === 'shadow') && apply(before, m).winner === seat).map((m) => m.id);
    const head = before.phase === 'chain' ? before.players[seat].chain[0].id : undefined, n = actions++;
    out({ k: 'act', i: n, n: before.turnNumber, seat, phase: before.phase, head, legal: legal.map((m) => m.id), wins: wins.length ? wins : undefined, move, decision, events: after.events },
      (v) => ({ k: 'act', i: n, n: before.turnNumber, seat, phase: before.phase, head, legal: v === seat ? legal.map((m) => m.id) : undefined, move, decision: v === seat ? decision : undefined, events: viewFor(after, v).events }));
    onMove(before, move, after);
    recent.push(move.id); if (recent.length > 12) recent.shift();
    if (progressed(after, after.events)) lastProgress = after.turnNumber;
    game = after;
    if (now() - t0 > L.maxMs) { stop = { reason: 'time-limit', detail: `ran past ${L.maxMs} ms` }; break; }
  }
  const ms = now() - t0, status = game.phase === 'over' && !stop ? 'completed' : 'aborted';
  const diagnostic = stop && { ...stop, turn: game.turnNumber, action: actions, lastMoves: recent, position: snapshot(game) };
  const g = game;
  out({ k: 'end', status, reason: stop?.reason ?? 'win', winner: g.winner, turns: g.turnNumber, actions, ms, diagnostic, final: bare(g) },
    (seat) => ({ k: 'end', status, reason: stop?.reason ?? 'win', winner: g.winner, turns: g.turnNumber, actions, diagnostic, final: bare(viewFor(g, seat)) }));
  return { gameId: id, seed, bots, status, reason: stop?.reason ?? 'win', winner: g.winner, game: g, turns: g.turnNumber, actions, ms, diagnostic };
}

/**
 * Rebuild a game from its observer log (the records, in order): starts from the logged opening position and applies each logged move with the engine,
 * checking each one is legal and gives the logged events. Returns the states before each move (`states[i]` is the position action i was played in) and the end.
 */
export function replay(records) {
  const head = records.find((r) => r.k === 'game');
  if (!head || head.schema !== LOG_SCHEMA) throw new Error(`Not a ${LOG_SCHEMA} log.`);
  let game = { ...JSON.parse(JSON.stringify(head.initial)), events: [] };
  const states = [];
  for (const r of records) {
    if (r.k !== 'act') continue;
    states.push(game);
    const next = apply(game, r.move);
    if (JSON.stringify(next.events) !== JSON.stringify(r.events)) throw new Error(`Action ${r.i} gave different events on replay.`);
    game = next;
  }
  return { states, final: game };
}
