/**
 * Learn to play: eight short lessons, each a fixed board and a script of steps. Pure: no DOM, no timers, so the page and the tests share it.
 * Design and reasons: studies/2026-11-18-new-player-clarity/STUDY.md (section 4).
 *
 * Nothing here decides a rule. A lesson only builds a position (as the animation board does) and, at each step, keeps the engine's legal moves that the
 * step teaches; the engine still says what is legal and what a move does. The opponent (seat 1) plays a tiny script: it ends its turn unless the lesson
 * gives it something to do.
 *
 *   LESSONS                 [{ id, name, intro, board, steps, foe?, done, outro }]
 *   buildLesson(lesson)     the starting game (seat 0 to move, turn 1, both allowances unused)
 *   new Tutor(lesson)       .allowed(game, moves) the moves to offer now · .played(before, move, after) after any move · .text(game) the line to show
 *                           .done(game) is the lesson complete · .foe() a player object for seat 1 ({ move(game) })
 *
 * A board names cards per seat: `field`, `hand`, `chain`, `discard`, `pile` (top of the pile last), `spentHeart`. A field entry is `key`, `key:spent`,
 * `key>heart` (a Guardian on its Heart) or `key>N` (a Guardian on the Nth card of that field, from 1), and `:spent` may follow either.
 */
import { newGame, legalMoves, locate } from '../../src/index.js';

/** Card ids keep the engine's form `<seat>-<key>-<n>` (match.js `keyOf` reads the key from it). */
let made = 0;
const card = (seat, key) => ({ id: `${seat}-${key}-l${++made}`, key, owner: seat });

/** The starting game of a lesson. */
export function buildLesson(lesson) {
  made = 0;
  const g = newGame(1), b = lesson.board;
  for (const p of g.players) {
    const seat = p.idx;
    p.hand = []; p.field = []; p.chain = []; p.discard = []; p.deck = []; delete p.dry;
    for (const entry of b.field?.[seat] ?? []) {
      const [, key, target, flag] = entry.match(/^(\w+)(?:>(\w+))?(?::(spent))?$/);
      const c = card(seat, key);
      if (target) c.guards = target === 'heart' ? p.hearts[0].id : p.field[Number(target) - 1].id;
      if (flag === 'spent') c.spent = true;
      p.field.push(c);
    }
    for (const zone of ['hand', 'chain', 'discard']) for (const key of b[zone]?.[seat] ?? []) p[zone].push(card(seat, key));
    for (const key of b.pile?.[seat] ?? []) p.deck.push(card(seat, key));
    if ((b.spentHeart ?? []).includes(seat)) p.hearts[0].spent = true;
  }
  g.turn = 0; g.turnNumber = 1; g.phase = 'play'; g.winner = null; g.used = { field: false, chain: false }; g.events = []; delete g.bonus;
  legalMoves(g);
  return g;
}

// ---- reading a move -------------------------------------------------------------------------------------------------------------------------
const keyAt = (g, id) => locate(g, id)?.card.key;
const mine = (g, id) => locate(g, id)?.card.owner === 0;
/** An attack (first, or `second` for the bonus attack) by any of your creatures on the enemy card of kind `key`. */
const attackOn = (key, { second = false } = {}) => (m, g) => m.type === 'attack' && !!m.bonus === second && keyAt(g, m.targetId) === key && !mine(g, m.targetId);
const is = (type, test = () => true) => (m, g) => m.type === type && test(m, g);

/** A step: `say` the line shown while it waits, and `pick(move, game)` the moves it accepts. `end: true` is an End Turn the engine may already have
 * taken by itself (then it is passed over); `wait` is the opponent's turn (passed over when the turn comes back). */
const step = (say, pick) => ({ say, pick });
const end = (say = 'Press End Turn.') => ({ say, pick: is('end'), end: true });
const wait = (say) => ({ say, wait: true });

export const LESSONS = [
  {
    id: 'strike', name: 'Strike',
    intro: 'Defeat the enemy Heart. A Heart takes two blows.',
    board: { field: { 0: ['knight', 'knight'] } },
    steps: [
      step('Drag one of your Knights onto their Heart to attack it.', attackOn('heart')),
      end(),
      wait('The first blow turned their Heart sideways (spent), and it cost your Knight. Their turn.'),
      step('A spent Heart falls to one more blow. Attack it with your other Knight.', attackOn('heart')),
    ],
    done: (g) => g.winner === 0,
    outro: 'A Heart takes two blows, and the first one costs the attacker. So it takes two creatures to win.',
  },
  {
    id: 'spent', name: 'Spent',
    intro: 'Defeat the enemy Knight. Upright cards are ready; sideways cards are spent.',
    board: { field: { 0: ['knight'], 1: ['knight', 'guardian>heart'] } },
    steps: [
      step('Drag your Knight onto their Knight to attack it.', attackOn('knight')),
      end(),
      wait('A hit turns a ready card sideways: it’s spent. Attacking spent your Knight too. Their turn.'),
      step('A spent Knight can’t attack. Press Recover to ready it. Recover is your Field action, so it is all you do this turn.', is('recover')),
      end(),
      wait('Their turn.'),
      step('A hit on a spent card defeats it. Attack their spent Knight.', attackOn('knight')),
    ],
    done: (g) => g.players[1].discard.some((c) => c.key === 'knight'),
    outro: 'Hit once: spent. Hit again: defeated. Recover readies your Knights and Maniacs, and it uses your Field action.',
  },
  {
    id: 'guard', name: 'Guard',
    intro: 'Open the enemy Heart. A Guardian sits on a card and guards it: a guarded card can’t be hit.',
    board: { field: { 0: ['knight', 'knight'], 1: ['guardian>heart'] } },
    steps: [
      step('Their Heart has a Guardian on it, so you can’t attack the Heart. Guardians are never guarded: attack the Guardian.', attackOn('guardian')),
      step('Your Knight has a partner, so it attacks twice. Attack the spent Guardian again.', attackOn('guardian', { second: true })),
    ],
    done: (g) => g.players[1].discard.some((c) => c.key === 'guardian'),
    outro: 'The Guardian is defeated and their Heart is open. A Knight attacks twice while another of your Knights is in play.',
  },
  {
    id: 'defend', name: 'Defend',
    intro: 'Survive their turn. Your Heart is spent: one more blow and you lose.',
    board: { field: { 0: ['knight'], 1: ['knight', 'guardian>heart'] }, hand: { 0: ['guardian'] }, pile: { 0: ['knight', 'knight', 'knight'], 1: ['knight', 'knight', 'knight'] }, spentHeart: [0] },
    steps: [
      step('Their Knight is ready. Drag your Guardian onto your Heart.', (m, g) => m.type === 'deploy' && m.targetId === g.players[0].hearts[0].id),
      end(),
      wait('Their turn. Your Heart is guarded, so their Knight can’t reach it.'),
    ],
    foe: (moves, g) => moves.find((m) => m.type === 'attack' && keyAt(g, m.targetId) === 'guardian'),
    done: (g) => g.turn === 0 && g.turnNumber >= 3,
    outro: 'They had to hit your Guardian instead. A spent Guardian still guards, but one more hit defeats it. With an empty draw pile you have no Guardians, so watch your pile.',
  },
  {
    id: 'chain', name: 'The Chain',
    intro: 'Defeat the enemy Heart. Each turn you have a Field action and a Chain action.',
    board: { field: { 0: ['knight'], 1: ['guardian>heart:spent'] }, hand: { 0: ['fireball'] }, spentHeart: [1] },
    steps: [
      step('Spells go into your Chain first. Drag the Fireball into your Chain. This is Wind, your Chain action.', is('wind')),
      step('A spell you wind waits for a later turn. Press End Turn.', is('end')),
      wait('Their turn.'),
      step('Press Release: your Chain plays from left to right. Release is your Chain action this turn.', is('release')),
      step('Drag the Fireball onto their spent Guardian. A hit on a spent card defeats it.', is('fireball', (m, g) => keyAt(g, m.targetId) === 'guardian')),
      step('Their Heart is open, and your Field action is still free. Attack their Heart.', attackOn('heart')),
    ],
    done: (g) => g.winner === 0,
    outro: 'Wind a spell on one turn, Release it on a later one. Your Field action can come before, between or after your Chain’s spells.',
  },
  {
    id: 'order', name: 'Order',
    intro: 'Defeat the enemy Heart in one turn. A Chain plays left to right, so the order is your plan.',
    board: { field: { 0: ['knight', 'knight'], 1: ['guardian>heart'] }, chain: { 0: ['shift'] }, hand: { 0: ['shadow'] } },
    steps: [
      step('Your Chain already holds Shift. Wind Shadow Step after it.', is('wind')),
      step('Press End Turn.', is('end')),
      wait('Their turn.'),
      step('Press Release.', is('release')),
      step('Shift comes first: drag it onto their Guardian to send it back to their hand.', is('shift', (m, g) => keyAt(g, m.targetId) === 'guardian')),
      step('Their Heart is open. Shadow Step: drag one of your Knights onto their Heart.', is('shadow', (m, g) => keyAt(g, m.targetId) === 'heart')),
      step('The first blow cost that Knight. Your Field action is still free: finish with your other Knight.', attackOn('heart')),
    ],
    done: (g) => g.winner === 0,
    outro: 'Shift had to come before Shadow Step. Swapped round, the Heart would still have been guarded.',
  },
  {
    id: 'instants', name: 'Instants',
    intro: 'Defeat the enemy Heart. Instants are free, and you can play them any time on your turn.',
    board: { discard: { 0: ['knight'] }, hand: { 0: ['kiss', 'rally'] }, spentHeart: [1] },
    steps: [
      step('Drag Witch’s Kiss onto your discard pile, then pick the Knight.', is('cast', (m, g) => m.spell === 'kiss' && keyAt(g, m.targetId) === 'knight')),
      step('A Knight taken by a Kiss enters spent. Drag Rally onto it to ready it.', is('cast', (m) => m.spell === 'rally')),
      step('Attack their Heart.', attackOn('heart')),
    ],
    done: (g) => g.winner === 0,
    outro: 'Instants never use your actions: two of them, then an attack, all in one turn.',
  },
  {
    id: 'angel', name: 'The Angel',
    intro: 'Defeat the enemy Heart. While an Angel is ready, it takes any attack on its Heart.',
    board: { field: { 0: ['knight', 'knight'], 1: ['angel'] }, spentHeart: [1] },
    steps: [
      step('Attack their Heart.', attackOn('heart')),
      step('The Angel was defeated instead. That attack didn’t land, so your Knight survived, and it attacks twice: hit the Heart.', attackOn('heart', { second: true })),
    ],
    done: (g) => g.winner === 0,
    outro: 'That’s the game. The reference card at the left edge has every shared rule. Next: a real game against the Squire.',
  },
];
export class Tutor {
  constructor(lesson) { this.lesson = lesson; this.i = 0; }
  get current() { return this.lesson.steps[this.i]; }
  /** Pass over an End Turn the engine already took, and the opponent's turn once it is over. */
  settle(game) {
    for (let st = this.current; st; st = this.current) {
      if ((st.end && game.turn !== 0) || (st.wait && game.turn === 0)) this.i++; else break;
    }
  }
  /** The moves to offer the learner now: the ones the current step accepts. */
  allowed(game, moves = legalMoves(game)) {
    this.settle(game);
    const st = this.current;
    if (!st || st.wait || this.done(game)) return [];
    return moves.filter((m) => st.pick(m, game));
  }
  /** Call after every move, either seat's. */
  played(before, move, after) {
    const st = this.current;
    if (before.turn === 0 && st && !st.wait && st.pick(move, before)) this.i++;
    this.settle(after);
  }
  done(game) { return this.lesson.done(game); }
  /** The line to show for the current step. */
  text(game) { this.settle(game); return this.done(game) ? '' : this.current?.say ?? ''; }
  /** The opponent: the lesson's own move if it has one, otherwise it lets the turn go (a second attack declined, a spell skipped, the turn ended). */
  foe() {
    const pick = this.lesson.foe ?? (() => null);
    return {
      move(game) {
        const moves = legalMoves(game);
        return pick(moves, game) ?? moves.find((m) => m.type === 'decline') ?? moves.find((m) => m.type === 'skip') ?? moves.find((m) => m.type === 'end') ?? moves[0];
      },
    };
  }
}
