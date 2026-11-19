/**
 * The animation board: made-up positions to watch the game's motion on again and again, without playing to get there. Each scenario is a board built through
 * the engine's own setup (match.js `prepare`) and a short script of real moves, each picked from `legalMoves`, so what plays is exactly what a game plays.
 * Nothing here decides a rule: a step only says which of the legal moves to make.
 *
 *   build(scenario)  the position, as a game state (seat 0 is the viewer; some scenarios are the opponent's turn)
 *   SCENARIOS        [{ id, group, name, setup, after, turn, steps }]
 */
import { newGame, legalMoves, apply } from '../../src/index.js?v=54cfdab';
import { prepare } from './match.js?v=54cfdab';

export const SEED = 5;

/** A step that makes the first legal move of this type (optionally: that `ok` accepts, given the move and the game). */
const move = (type, ok = () => true) => (moves, g) => moves.find((m) => m.type === type && ok(m, g));
/** A step that may find nothing (a second attack is not always on offer): the script goes on without it. */
const maybe = (step) => Object.assign((...a) => step(...a), { optional: true });
/** A move whose result has an event that `ok` accepts (picks a move by what it does, not by which card it names). */
const doing = (type, ok) => (moves, g) => moves.find((m) => m.type === type && apply(g, m).events.some(ok));
/** Is `id` one of the opponent's cards (ids keep the seat they were dealt to) of this kind? */
const foe = (g, id, k) => id.startsWith('1-') && key(g, id) === k;
/** Is `id` one of the viewer's own cards (seat 0) of this kind? */
const ours = (g, id, k) => id.startsWith('0-') && key(g, id) === k;
const key = (g, id) => g.players.flatMap((p) => [...p.hearts, ...p.field, ...p.hand, ...p.discard, ...p.chain]).find((c) => c.id === id)?.key;

const OPEN = { field: { 0: ['knight', 'knight', 'lantern'], 1: ['knight', 'knight', 'lantern'] }, discard: { 0: ['fireball', 'knight'], 1: ['fireball', 'rally'] } };
const WOUND = { 0: ['fireball', 'behind', 'shift'], 1: ['fireball', 'shadow'] };
/** The opponent's Heart in plain view: nothing guards it. */
const bare = (g) => { for (const c of g.players[1].field) delete c.guards; return g; };
/** A Guardian set out on the field guards a creature of its side (the first free one), or else the Heart. */
const guarded = (seat) => (g) => { const p = g.players[seat], ks = p.field.filter((c) => c.key === 'knight'); p.field.filter((c) => c.key === 'guardian' && !c.guards).forEach((c, i) => { c.guards = ks[i]?.id ?? p.hearts[0].id; }); return g; };
const spent = (g, seat, k) => { for (const c of g.players[seat].field) if (c.key === k) c.spent = true; return g; };

export const SCENARIOS = [
  // ---- the Chain ----
  { id: 'release', group: 'The Chain', name: 'Release the Chain', setup: { ...OPEN, chain: { 0: WOUND[0] } }, steps: [move('release')] },
  { id: 'release-all', group: 'The Chain', name: 'Release and resolve it all', setup: { ...OPEN, chain: { 0: WOUND[0] } },
    steps: [move('release'), move('fireball', (m, g) => foe(g, m.targetId, 'knight')), move('behind'), move('shift')] },
  { id: 'release-opp', group: 'The Chain', name: 'Opponent releases', turn: 1, setup: { ...OPEN, chain: WOUND }, steps: [move('release')] },
  { id: 'wind', group: 'The Chain', name: 'Wind a spell into the Chain', setup: { ...OPEN, chain: { 0: ['shift'] }, hand: { 0: ['fireball', 'knight'] } }, steps: [move('wind', (m, g) => key(g, m.cardId) === 'fireball')] },
  // ---- playing cards ----
  { id: 'deploy', group: 'Cards', name: 'Deploy a creature', setup: { ...OPEN, hand: { 0: ['knight'] } }, steps: [move('deploy', (m, g) => m.dest === 'open' && key(g, m.cardId) === 'knight')] },
  { id: 'guard', group: 'Cards', name: 'Deploy a Guardian', setup: { ...OPEN, hand: { 0: ['guardian'] } }, steps: [move('deploy', (m, g) => m.dest === 'guard' && key(g, m.cardId) === 'guardian' && key(g, m.targetId) === 'knight')] },
  { id: 'deploy-opp', group: 'Cards', name: 'Opponent deploys', turn: 1, setup: { ...OPEN, hand: { 1: ['knight'] } }, steps: [move('deploy', (m, g) => m.dest === 'open')] },
  { id: 'reguard', group: 'Cards', name: 'Move a Guardian', setup: OPEN, steps: [move('reguard', (m, g) => m.dest === 'to' && key(g, m.targetId) === 'knight')] },
  { id: 'recover', group: 'Cards', name: 'Recover', after: (g) => spent(spent(g, 0, 'knight'), 0, 'lantern'), setup: OPEN, steps: [move('recover')] },
  { id: 'end', group: 'Cards', name: 'End the turn', setup: OPEN, steps: [move('end')] },
  // ---- blows ----
  { id: 'attack', group: 'Combat', name: 'Attack a creature', setup: OPEN, steps: [move('attack', (m, g) => foe(g, m.targetId, 'knight')), maybe(move('decline'))] },
  { id: 'defeat', group: 'Combat', name: 'Attack defeats a spent creature', after: (g) => spent(g, 1, 'knight'), setup: { ...OPEN, field: { 0: OPEN.field[0], 1: ['knight', 'knight'] } }, steps: [move('attack', (m, g) => foe(g, m.targetId, 'knight')), maybe(move('decline'))] },
  { id: 'heart', group: 'Combat', name: 'Attack the Heart', after: bare, setup: OPEN, steps: [move('attack', (m, g) => key(g, m.targetId) === 'heart'), maybe(move('decline'))] },
  { id: 'rescue', group: 'Combat', name: 'An Angel saves the Heart', after: bare, setup: { ...OPEN, field: { 0: OPEN.field[0], 1: ['angel', 'knight'] } }, steps: [move('attack', (m, g) => key(g, m.targetId) === 'heart'), maybe(move('decline'))] },
  // the Heart falls: no ready Lantern Keeper on that side, which would light the spent Heart (19 Nov 2026)
  { id: 'win', group: 'Combat', name: 'The Heart falls (win)', after: bare, setup: { ...OPEN, field: { 0: OPEN.field[0], 1: ['knight', 'knight'] }, spentHeart: [1] }, steps: [move('attack', (m, g) => key(g, m.targetId) === 'heart')] },
  { id: 'portal', group: 'Combat', name: 'Attack through a Warp Portal', setup: { ...OPEN, field: { 0: ['knight', 'portal'], 1: ['knight', 'lantern'] } }, steps: [doing('attack', (e) => e.t === 'attack' && e.portal), maybe(move('decline'))] },
  // ---- devices: the moments a Warp Portal, a Lantern Keeper and a Heaven's Resolve touch several cards ----
  { id: 'device-portal', group: 'Devices', name: 'Warp Portal comes in', after: guarded(1), setup: { field: { 0: ['knight', 'knight'], 1: ['knight', 'knight', 'guardian'] }, hand: { 0: ['portal'] } }, steps: [move('deploy', (m, g) => key(g, m.cardId) === 'portal')] },
  { id: 'device-portal-opp', group: 'Devices', name: 'Their Warp Portal comes in', turn: 1, after: guarded(0), setup: { field: { 0: ['knight', 'knight', 'guardian'], 1: ['knight'] }, hand: { 1: ['portal'] } }, steps: [move('deploy', (m, g) => key(g, m.cardId) === 'portal')] },
  { id: 'device-lantern', group: 'Devices', name: 'Lantern Keeper lights spent creatures', setup: { field: { 0: ['knight:spent', 'knight:spent', 'maniac'], 1: OPEN.field[1] }, hand: { 0: ['lantern'] } }, steps: [move('deploy', (m, g) => key(g, m.cardId) === 'lantern')] },
  { id: 'device-lantern-attack', group: 'Devices', name: 'A lit creature attacks', setup: { field: { 0: ['knight:spent', 'lantern'], 1: ['knight', 'knight'] } }, steps: [doing('attack', (e) => e.t === 'attack' && e.lit), maybe(move('decline'))] },
  { id: 'device-lantern-out', group: 'Devices', name: 'The Lantern’s light goes out', setup: { field: { 0: ['knight'], 1: ['knight:spent', 'knight:spent', 'lantern'] }, chain: { 0: ['fireball'] } }, steps: [move('release'), move('fireball', (m, g) => foe(g, m.targetId, 'lantern'))] },
  { id: 'device-resolve', group: 'Devices', name: 'Heaven’s Resolve comes in', setup: { field: { 0: ['knight:spent', 'knight', 'maniac'], 1: OPEN.field[1] }, hand: { 0: ['resolve'] } }, steps: [move('deploy', (m, g) => key(g, m.cardId) === 'resolve')] },
  { id: 'device-resolve-recover', group: 'Devices', name: 'A free Recover', setup: { field: { 0: ['knight:spent', 'knight:spent', 'resolve:spent'], 1: OPEN.field[1] } }, steps: [move('recover')] },
  // ---- spells ----
  { id: 'fireball', group: 'Spells', name: 'Fireball', setup: { ...OPEN, chain: { 0: ['fireball'] } }, steps: [move('release'), move('fireball', (m, g) => foe(g, m.targetId, 'knight'))] },
  { id: 'fireball-kill', group: 'Spells', name: 'Fireball defeats', after: (g) => spent(g, 1, 'knight'), setup: { ...OPEN, field: { 0: OPEN.field[0], 1: ['knight', 'knight'] }, chain: { 0: ['fireball'] } }, steps: [move('release'), move('fireball', (m, g) => foe(g, m.targetId, 'knight'))] },
  { id: 'behind', group: 'Spells', name: 'Behind You', setup: { ...OPEN, field: { 0: ['knight', 'knight'], 1: ['knight', 'knight', 'lantern'] }, chain: { 0: ['behind'] } }, steps: [move('release'), move('behind')] },
  { id: 'shift', group: 'Spells', name: 'Shift a Guardian off its card', setup: { ...OPEN, chain: { 0: ['shift'] } }, steps: [move('release'), doing('shift', (e) => e.t === 'shift')] },
  { id: 'recall', group: 'Spells', name: 'Shift returns a spell to hand', setup: { ...OPEN, chain: { 0: ['shift'], 1: ['fireball', 'behind'] } }, steps: [move('release'), doing('shift', (e) => e.t === 'recall')] },
  { id: 'shadow', group: 'Spells', name: 'Shadow Step', setup: { ...OPEN, chain: { 0: ['shadow'] } }, steps: [move('release'), move('shadow', (m, g) => foe(g, m.targetId, 'knight')), maybe(move('decline'))] },
  { id: 'rally', group: 'Spells', name: 'Rally', after: (g) => spent(g, 0, 'knight'), setup: { ...OPEN, hand: { 0: ['rally'] } }, steps: [move('cast', (m) => m.spell === 'rally')] },
  { id: 'kiss', group: 'Spells', name: 'Witch’s Kiss (from a discard pile)', setup: { ...OPEN, hand: { 0: ['kiss'] } }, steps: [move('cast', (m, g) => m.spell === 'kiss' && key(g, m.targetId) === 'fireball')] },
  { id: 'kiss-chain', group: 'Spells', name: 'Witch’s Kiss (from a Chain)', setup: { ...OPEN, hand: { 0: ['kiss'] }, chain: { 1: ['fireball', 'shadow'] } }, steps: [move('cast', (m, g) => m.spell === 'kiss' && key(g, m.targetId) === 'shadow')] },
  // ---- the opponent's spells: what you see when they play them ----
  { id: 'kiss-opp', group: 'Opponent spells', name: 'Their Kiss takes from your pile', turn: 1, setup: { ...OPEN, hand: { 1: ['kiss'] } }, steps: [move('cast', (m, g) => m.spell === 'kiss' && ours(g, m.targetId, 'fireball'))] },
  { id: 'kiss-chain-opp', group: 'Opponent spells', name: 'Their Kiss takes from your Chain', turn: 1, setup: { ...OPEN, hand: { 1: ['kiss'] }, chain: { 0: ['fireball', 'shadow'] } }, steps: [move('cast', (m, g) => m.spell === 'kiss' && ours(g, m.targetId, 'shadow'))] },
  { id: 'kiss-creature-opp', group: 'Opponent spells', name: 'Their Kiss takes a creature', turn: 1, setup: { ...OPEN, hand: { 1: ['kiss'] } }, steps: [move('cast', (m, g) => m.spell === 'kiss' && ours(g, m.targetId, 'knight'))] },
  { id: 'shift-opp', group: 'Opponent spells', name: 'Their Shift takes your Guardian', turn: 1, setup: { ...OPEN, chain: { 1: ['shift'] } }, steps: [move('release'), doing('shift', (e) => e.t === 'shift')] },
  { id: 'recall-opp', group: 'Opponent spells', name: 'Their Shift returns your spell', turn: 1, setup: { ...OPEN, chain: { 1: ['shift'], 0: ['fireball', 'behind'] } }, steps: [move('release'), doing('shift', (e) => e.t === 'recall')] },
  { id: 'fireball-opp', group: 'Opponent spells', name: 'Their Fireball', turn: 1, setup: { ...OPEN, chain: { 1: ['fireball'] } }, steps: [move('release'), move('fireball', (m, g) => ours(g, m.targetId, 'knight'))] },
];

/** The scenario's position: a dealt game with its cards set out, some tweaks, and whose turn it is. */
export function build(sc) {
  let g = prepare(newGame(SEED), sc.setup ?? {});
  if (sc.turn !== undefined) g.turn = sc.turn;
  if (sc.after) g = sc.after(g) ?? g;
  g.events = [];
  legalMoves(g);
  return g;
}

/** The move a step makes in `game`, or null if the step finds none. */
export const stepMove = (game, step) => step(legalMoves(game), game) ?? null;

/** Run a scenario in memory: [{ move, events }] for every step that found a move (an optional step that finds none is skipped, any other throws). Used by the tests; the page runs the same steps with motion. */
export function rehearse(sc) {
  let g = build(sc); const out = [];
  for (const step of sc.steps) {
    const m = stepMove(g, step);
    if (!m) { if (!step.optional) throw new Error(`${sc.id}: a step found no legal move`); out.push({ move: null }); continue; }
    g = apply(g, m); out.push({ move: m, events: g.events.map((e) => e.t) });
  }
  return out;
}
