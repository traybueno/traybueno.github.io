/**
 * Play the game as text, one move at a time, for an agent (a language model, a script) that cannot or should not look at the screen. Pure: no files, no DOM.
 * `web/play.mjs` is the command line around it; docs/SIM.md says how to use both.
 *
 *   const { game, records } = startGame({ seed: 7, player: 'opus' });   // records: the game's log (fcr-game-log/1), one object per line
 *   describeState(game)            // the whole position as plain text, the legal moves numbered at the end
 *   const r = step(game, move, { i: 0, note: 'why' });  // r.game, r.records, r.text (what happened, in words)
 *
 * Nothing here knows a rule: every move comes from the engine's `legalMoves`, is sent whole to `apply`, and every sentence is read from the state.
 * The log is the same format as a bot batch's observer log, so `replay` rebuilds a game from it and `analyze` (web/sim/analyze.js) reports on it.
 */
import { newGame, legalMoves, apply, viewFor, locate, isGuarded, isBacked, protector, hasPortal, hasResolve, CARDS, DECK, CHAIN_MAX } from '../../src/index.js?v=4690f3a';
import { LOG_SCHEMA, DEFAULT_LIMITS, POLICIES, prepare, snapshot, keyOf } from './match.js?v=4690f3a';
import { PROFILES } from './bot.js?v=4690f3a';

export const AGENT_VERSION = 'agent/1';
const bare = (s) => { const { events, ...rest } = s; return rest; };
const SLOT = ['I', 'II', 'III'];

/** "Knight [0-knight-2]"; a hidden card (in a view) is just "a hidden card". */
const named = (c) => (c.hidden ? 'a hidden card' : `${CARDS[c.key].name} [${c.id}]`);
const nameOf = (id) => `${CARDS[keyOf(id)]?.name ?? id} [${id}]`;

/** A card anywhere in the game, said with whose it is and where it is: "p1's Knight [1-knight-3]", "Fireball [0-fireball-1] in p1's Chain". */
function whose(s, id) {
  const at = locate(s, id);
  if (!at) return nameOf(id);
  const { card, zone, p } = at;
  if (zone === 'hearts') return `p${p.idx}'s Heart`;
  if (zone === 'field' || zone === 'hand') return `p${p.idx}'s ${named(card)}`;
  return `${named(card)} in p${p.idx}'s ${zone === 'chain' ? `Chain (slot ${SLOT[p.chain.indexOf(card)]})` : zone === 'discard' ? 'discard pile' : zone}`;
}

/** One legal move in words. `s` is the game it is legal in. */
export function describeMove(s, m) {
  const w = (id) => whose(s, id), me = `p${s.turn}`;
  switch (m.type) {
    case 'deploy': return m.dest === 'guard' ? `Deploy ${nameOf(m.cardId)} to guard ${w(m.targetId)} (Field action)` : `Deploy ${nameOf(m.cardId)} to your field${keyOf(m.cardId) === 'maniac' ? ' (enters spent)' : ''} (Field action)`;
    case 'attack': return `${m.bonus ? 'Second attack: ' : ''}${nameOf(m.cardId)} attacks ${w(m.targetId)}${m.bonus ? '' : ' (Field action)'}`;
    case 'reguard': return `Move ${nameOf(m.cardId)} to guard ${w(m.targetId)} (Field action; it stays ready)`;
    case 'recover': return `Recover: stand all ${me}'s spent creatures${hasResolve(s, s.turn) ? ' (free: Heaven’s Resolve)' : ' (Field action)'}`;
    case 'wind': return `Wind ${nameOf(m.cardId)} onto the right end of the Chain; the Chain then reads ${m.keys.split(',').map((k) => CARDS[k].name).join(', ')} (Chain action)`;
    case 'release': return `Release the Chain: its spells resolve left to right (Chain action)`;
    case 'cast': return `Play the instant ${nameOf(m.cardId)}: ${m.spell === 'rally' ? `ready ${w(m.targetId)}` : `take ${w(m.targetId)}${m.toId ? `, it will guard ${w(m.toId)}` : ''}`} (free)`;
    case 'fireball': return `Fireball hits ${w(m.targetId)}`;
    case 'shift': return locate(s, m.targetId)?.zone === 'chain' ? `Shift returns ${w(m.targetId)} to its owner's hand` : `Shift returns ${w(m.targetId)} to its owner's hand`;
    case 'behind': return 'Behind You hits every unguarded creature, both players\' (yours too)';
    case 'shadow': return `Shadow Step: ${nameOf(m.attackerId)} attacks ${w(m.targetId)} (no Field action)`;
    case 'rally': return `Rally readies ${w(m.targetId)}`;
    case 'kiss': return `Witch’s Kiss takes ${w(m.targetId)}${m.toId ? `, it will guard ${w(m.toId)}` : ''}`;
    case 'skip': return `Skip ${nameOf(s.players[s.turn].chain[0].id)}: discard it with no effect`;
    case 'decline': return 'Decline the second attack';
    case 'end': return 'End the turn';
    default: return m.id;
  }
}

/** A card in play with what it is doing: "Knight [0-knight-2] ready, backed". */
function inField(s, c) {
  if (c.hidden) return named(c);
  const tags = [];
  if (CARDS[c.key].kind === 'creature') tags.push(c.spent ? 'SPENT' : 'ready');
  if (c.key === 'guardian') tags.push(c.guards ? `guards ${c.guards === s.players[c.owner].hearts[0].id ? 'the Heart' : nameOf(c.guards)}` : 'guards nothing');
  if (c.key === 'knight' && isBacked(s, c)) tags.push('paired');
  if (c.key !== 'guardian' && isGuarded(s, c)) tags.push('guarded');
  return `${named(c)}${tags.length ? ` (${tags.join(', ')})` : ''}`;
}
const list = (cs, f = named) => (cs.length ? cs.map(f).join('; ') : '-');

/** The whole position as text. `s` may be a `viewFor` view (the other hand and the piles are then hidden). `moves: false` leaves out the legal-moves list. */
export function describeState(s, { gameId = null, moves = true } = {}) {
  const out = [];
  const used = s.used ? `Field action ${s.used.field ? 'used' : 'free'}, Chain action ${s.used.chain ? 'used' : 'free'}` : '';
  out.push(`${gameId ? `${gameId} | ` : ''}turn ${s.turnNumber} | ${s.phase === 'over' ? `GAME OVER, p${s.winner} wins` : `p${s.turn} to play | phase ${s.phase} | ${used}`}`);
  for (const p of s.players) {
    const h = p.hearts[0], prot = protector(s, p.idx), tags = [h.spent ? 'SPENT (one more blow ends the game)' : 'ready', ...(isGuarded(s, h) ? ['guarded'] : []), ...(prot ? [`a ready Angel would take the blow`] : [])];
    out.push('', `p${p.idx}${s.phase !== 'over' && p.idx === s.turn ? ' (to play)' : ''}: Heart ${tags.join(', ')} | pile ${p.deck.length}, hand ${p.hand.length}${p.dry ? ' | pile is empty' : ''}${hasPortal(s, p.idx) ? ' | has a Warp Portal' : ''}`);
    out.push(`  field:   ${list(p.field, (c) => inField(s, c))}`);
    out.push(`  chain:   ${Array.from({ length: CHAIN_MAX }, (_, i) => `${SLOT[i]} ${p.chain[i] ? named(p.chain[i]) : '-'}`).join(' | ')}`);
    out.push(`  discard: ${list(p.discard)}`);
    out.push(`  hand:    ${p.hand.length && p.hand.every((c) => c.hidden) ? `${p.hand.length} hidden cards` : list(p.hand)}`);
  }
  if (s.phase === 'chain') out.push('', `The Chain of p${s.turn} is releasing: choose a target for ${named(s.players[s.turn].chain[0])}, or skip it. Instants, and the allowances not yet used, may still be played between spells.`);
  if (s.phase === 'bonus') out.push('', `A second attack is on offer for ${nameOf(s.bonus.cardId)}: attack again or decline. Nothing else is legal.`);
  if (moves && s.phase !== 'over') {
    const all = legalMoves(s);
    out.push('', `Legal moves for p${s.turn} (${all.length}): number, id, what it does`);
    all.forEach((m, i) => out.push(`  ${String(i + 1).padStart(2)}. ${m.id}   ${describeMove(s, m)}`));
  }
  return out.join('\n');
}

/** What the engine's events say happened, in words, one sentence each. */
export function describeEvents(after) {
  const w = (id) => whose(after, id), out = [];
  for (const e of after.events) {
    switch (e.t) {
      case 'turn': out.push(`-- turn ${after.turnNumber}: p${e.p} begins`); break;
      case 'draw': out.push(`p${e.p} draws ${e.hidden ? 'a card' : nameOf(e.id)}`); break;
      case 'dry': out.push(`p${e.p}'s pile is empty`); break;
      case 'deploy': out.push(`${w(e.id)} is deployed`); break;
      case 'attack': out.push(`${w(e.id)} attacks ${w(e.hit)}${e.portal ? ' through the Warp Portal' : ''}`); break;
      case 'hit': out.push(keyOf(e.id) === 'heart' ? `${w(e.id)} takes its first blow and turns spent` : `${w(e.id)} is hit and turns spent`); break;
      case 'defeat': out.push(`${nameOf(e.id)} is defeated`); break;
      case 'rescue': out.push(`${nameOf(e.id)} takes the blow meant for ${nameOf(e.saved)} and is defeated`); break;
      case 'bonus': out.push('a second attack is on offer'); break;
      case 'reguard': out.push(`${w(e.id)} now guards ${e.to ? w(e.to) : 'nothing'}`); break;
      case 'recover': out.push(`p${e.p} recovers: their spent creatures stand`); break;
      case 'wind': out.push(`${nameOf(e.id)} is wound into the Chain`); break;
      case 'release': out.push(`p${e.p} releases the Chain`); break;
      case 'cast': out.push(`${nameOf(e.id)} is played (${e.from})`); break;
      case 'fireball': out.push(`Fireball hits ${w(e.hit)}`); break;
      case 'shift': out.push(`Shift returns ${nameOf(e.id)} to its owner's hand`); break;
      case 'return': out.push(`${nameOf(e.id)} goes back to its owner's hand (the card it guarded left play)`); break;
      case 'recall': out.push(`Shift returns ${nameOf(e.id)} to p${after.players.findIndex((p) => p.hand.some((c) => c.id === e.id))}'s hand`); break;
      case 'rally': out.push(`Rally readies ${w(e.id)}`); break;
      case 'behind': out.push(`Behind You hits ${e.hits.length} creature${e.hits.length === 1 ? '' : 's'}: ${e.hits.map(nameOf).join(', ') || 'none'}`); break;
      case 'shadow': out.push(`Shadow Step lets ${w(e.id)} attack`); break;
      case 'kiss': out.push(`Witch’s Kiss takes ${nameOf(e.id)} from p${e.from}'s ${e.zone}${e.to === 'field' ? '; it enters play ready' : '; it goes to hand'}`); break;
      case 'skip': out.push(`${nameOf(e.id)} is skipped`); break;
      case 'end': out.push(`p${e.p} ends the turn`); break;
      case 'win': out.push(`p${e.p} WINS`); break;
      default: out.push(e.t);
    }
  }
  return out;
}

/** The rules, short, with the cards read from the engine's own data. */
export function rulesText() {
  const cards = Object.entries(CARDS).filter(([k]) => k !== 'heart').map(([k, c]) => `  ${c.name} x${DECK[k]} (${c.instant ? 'instant ' : ''}${c.kind}): ${c.text}`);
  return [
    'FIELD + CHAIN, RESTRICTED. Two players, p0 goes first. Defeat the other player\'s Heart: the first successful attack on it turns it spent AND DEFEATS THE ATTACKER (so it has no second attack); a second successful attack, by another creature, defeats the Heart. It takes two creatures to defeat a Heart.',
    `Each player has a Heart and a starting Guardian guarding it, and shuffles a ${Object.values(DECK).reduce((a, b) => a + b, 0)}-card deck; hand 5; draw one at the start of your turn (no reshuffle). No HP, mana or counters.`,
    'Three rules: HIT a ready card turns it spent; a hit on a spent card defeats it (devices enter spent, so any hit defeats them). SPENT creatures cannot attack or be moved (except that a ready Lantern Keeper lets your other spent creatures attack as if ready); Recover or Rally stands them. GUARD: a guarded card cannot be hit by attacks or spells (a Guardian guards one card; a ready Lantern Keeper guards your other spent creatures; a Warp Portal lets your attacks ignore Guard). A Guardian whose card leaves play goes back to its owner\'s hand.',
    'A turn has two allowances, each once, any order: FIELD action (deploy, attack, move a ready Guardian onto another card, or Recover; an instant creature such as the Lantern Keeper is deployed without it) and CHAIN action (wind a Fireball/Shift/Behind You/Shadow Step onto the right end of your Chain, or Release the Chain). Instants (Rally, Witch\'s Kiss) and card effects never use an allowance; instants are played any time on your turn. The Chain has three slots and resolves left to right; each spell may be skipped.',
    'THE END OF THE PILES: when your own draw pile is empty, you have no Guardians: the draw that empties it discards yours, and you cannot bring one into play after.',
    'Only Knights and Maniacs attack. An attack turns the attacker spent. An attack on a Heart with a ready Angel defeats the Angel instead (the attacker survives, spent). "Attacks twice": the second attack comes straight after the first, nothing between. A Maniac attacks twice; a Knight attacks twice if you have another Knight ("paired").',
    'Cards:', ...cards,
    'Full rules: docs/RULES.md. The engine decides what is legal: you only ever choose from the numbered list.',
  ].join('\n');
}

/**
 * Begin a game. Returns the game and its first records (the header and the first turn), in the format of a bot game's observer log.
 * `player` is the name both seats go under in the log and the reports (an agent plays both seats): "opus", "haiku", "agent"...
 */
export function startGame({ seed = 1, setup = null, gameId = null, player = 'agent', vs = null, agentSeat = 0 } = {}) {
  let game = newGame(seed, setup?.deck ? { deck: setup.deck } : {});
  if (setup) game = prepare(game, setup);
  if (vs && !PROFILES[vs] && !POLICIES.includes(vs)) throw new Error(`Unknown bot "${vs}". Use ${[...Object.keys(PROFILES), ...POLICIES].join(', ')}.`);
  if (![0, 1].includes(agentSeat)) throw new Error('--agent-seat must be 0 or 1.');
  // With `vs`, the agent plays one seat and that bot plays the other: the game is named for both, so reports split by who played.
  const bots = vs ? (agentSeat === 0 ? [player, vs] : [vs, player]) : [player, player], id = gameId ?? (vs ? `${bots[0]}-${bots[1]}-s${seed}` : `${player}-s${seed}`);
  const records = [
    { k: 'game', schema: LOG_SCHEMA, gameId: id, seed, bots, setup, limits: DEFAULT_LIMITS, versions: { agent: AGENT_VERSION, deck: setup?.deck ?? DECK }, initial: bare(game) },
    { k: 'turn', n: game.turnNumber, seat: game.turn, state: bare(game) },
  ];
  return { game, gameId: id, bots, records, vs: vs ? { bot: vs, agentSeat } : null };
}

/** Which of the legal moves a player meant: an id (`attack:0-knight-2:1-heart-1`), or its number in the printed list (`3`). Throws, saying what was wrong, if it matches none. */
export function pick(game, what) {
  const all = legalMoves(game), text = String(what).trim();
  const byId = all.find((m) => m.id === text);
  if (byId) return byId;
  if (/^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= all.length) return all[Number(text) - 1];
  throw new Error(`"${text}" is not a legal move now. Legal ids: ${all.map((m) => m.id).join(', ')}`);
}

/** Play one move. `i` is its number in the game, `note` the player's reason (kept in the log). Returns the new game, the records to append and the events in words. */
export function step(game, move, { i, note = null, decision = null } = {}) {
  const legal = legalMoves(game), after = apply(game, move), seat = game.turn;
  const foeHeart = game.players[1 - seat].hearts[0].id;
  const wins = legal.filter((m) => m.targetId === foeHeart && (m.type === 'attack' || m.type === 'shadow') && apply(game, m).winner === seat).map((m) => m.id);
  const head = game.phase === 'chain' ? game.players[seat].chain[0].id : undefined;
  const records = [{ k: 'act', i, n: game.turnNumber, seat, phase: game.phase, head, legal: legal.map((m) => m.id), wins: wins.length ? wins : undefined, move, decision: decision ?? { kind: 'agent', ...(note ? { note } : {}) }, events: after.events }];
  if (after.phase !== 'over' && after.turnNumber !== game.turnNumber) records.push({ k: 'turn', n: after.turnNumber, seat: after.turn, state: bare(after) });
  return { game: after, records, text: describeEvents(after), over: after.phase === 'over' };
}

/** The closing record of a game: a win (`completed`), or `abandon` with a reason (`aborted`, never counted as a result). */
export function finish(game, { actions, abandon = null, recent = [], ms = null } = {}) {
  const over = game.phase === 'over', status = over ? 'completed' : 'aborted', reason = over ? 'win' : 'abandoned';
  const diagnostic = over ? undefined : { reason, detail: abandon ?? 'stopped by the player', turn: game.turnNumber, action: actions, lastMoves: recent, position: snapshot(game) };
  return { k: 'end', status, reason, winner: over ? game.winner : null, turns: game.turnNumber, actions, ms, diagnostic, final: bare(game) };
}

/** The one-line summary of a finished game, as a `games.jsonl` line of a run. */
export const summary = (head, end, log) => ({ gameId: head.gameId, seed: head.seed, bots: head.bots, status: end.status, reason: end.reason, winner: end.winner, turns: end.turns, actions: end.actions, ms: end.ms, diagnostic: end.diagnostic, log });

/** A view for one seat, as text: the other hand stays hidden. */
export const describeSeat = (game, seat, opts) => describeState(viewFor(game, seat), opts);
