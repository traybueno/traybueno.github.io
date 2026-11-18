/**
 * Learn to play: one pretend game against a rival, told in short chapters, that teaches the whole game as it goes. Pure: no DOM, no timers, so the page
 * and the tests share it. Design and reasons: studies/2026-11-18-new-player-clarity/STUDY.md (section 4).
 *
 * Nothing here decides a rule. The story only builds the opening position and, at each step, keeps the engine's legal moves that the step teaches; the
 * engine still says what is legal and what a move does. The board carries on from turn to turn like a real game. The rival (seat 1) plays a short
 * script, one thing on some of its turns (FOE), and otherwise ends its turn. Both draw piles are stacked, so each draw is the card the story needs next.
 *
 *   STORY                   { board, steps, foe, done, outro }   (steps: chapter, tell, step, end, wait)
 *   buildLesson(story)      the opening game (seat 0 to move, turn 1, both allowances unused)
 *   new Tutor(story)        .allowed(game, moves) the moves to offer now · .played(before, move, after) after any move · .text(game) the line to show
 *                           .telling(game) a line waits for Continue · .next(game) Continue · .banner(game) { label, at } for the top of the table
 *                           .done(game) · .foe() a player object for seat 1 ({ move(game) })
 *
 * A board names cards per seat: `field`, `hand`, `chain`, `discard`, `draws` (in the order they will be drawn), `spentHeart`. A field entry is `key`,
 * `key:spent`, `key>heart` (a Guardian on its Heart) or `key>N` (a Guardian on the Nth card of that field, from 1), and `:spent` may follow either.
 */
import { newGame, legalMoves, locate } from '../../src/index.js?v=c5cc373';

/** Card ids keep the engine's form `<seat>-<key>-<n>` (match.js `keyOf` reads the key from it). */
let made = 0;
const card = (seat, key) => ({ id: `${seat}-${key}-l${++made}`, key, owner: seat });

/** The opening game. */
export function buildLesson(story) {
  made = 0;
  const g = newGame(1), b = story.board;
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
    for (const key of [...(b.draws?.[seat] ?? [])].reverse()) p.deck.push(card(seat, key));       // the top of the pile is the end of the array
    if ((b.spentHeart ?? []).includes(seat)) p.hearts[0].spent = true;
  }
  g.turn = 0; g.turnNumber = 1; g.phase = 'play'; g.winner = null; g.used = { field: false, chain: false }; delete g.bonus;
  g.events = g.players.flatMap((p) => p.hand.map((c) => ({ t: 'draw', id: c.id, p: p.idx })));     // the hands are dealt as a game's are (for the front end's motion)
  legalMoves(g);
  return g;
}

// ---- reading a move -------------------------------------------------------------------------------------------------------------------------
const keyAt = (g, id) => locate(g, id)?.card.key;
const theirs = (g, id) => locate(g, id)?.card.owner === 1;
/** An attack (first, or `second` for the second attack) on the rival's card of kind `key`. */
const attackOn = (key, { second = false } = {}) => (m, g) => m.type === 'attack' && !!m.bonus === second && keyAt(g, m.targetId) === key && theirs(g, m.targetId);
const is = (type, test = () => true) => (m, g) => m.type === type && test(m, g);

/** The script's pieces. `chapter` starts a chapter (its name goes at the top of the table). `tell` is a line to read: the game waits, the rival too,
 * until Continue. `step` waits for a move `pick` accepts, showing `say`. `end` is an End Turn the engine may already have taken by itself (then it is
 * passed over); `wait` is the rival's turn. */
const chapter = (name) => ({ chapter: name });
const tell = (say) => ({ say, tell: true });
const step = (say, pick) => ({ say, pick });
const end = (say = 'Press End Turn.') => ({ say, pick: is('end'), end: true });
const wait = (say = 'The opponent’s turn.') => ({ say, wait: true });

/** What the rival does, by turn number (its turns are the even ones): one thing every turn, then it ends its turn. */
const FOE = {
  2: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'guardian' && m.targetId === g.players[1].hearts[0].id,
  4: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'knight',
  6: (m, g) => m.type === 'attack' && keyAt(g, m.targetId) === 'guardian',
  8: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'angel',
  10: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'knight',
  12: (m, g) => m.type === 'attack' && keyAt(g, m.targetId) === 'guardian',
};

export const STORY = {
  board: {
    field: { 0: ['knight', 'knight'] }, hand: { 0: ['knight'], 1: ['guardian', 'knight', 'angel', 'knight'] },
    draws: { 0: ['fireball', 'guardian', 'kiss', 'shift', 'shadow', 'rally', 'rally'], 1: ['shift', 'shift', 'shift', 'shift', 'shift', 'shift', 'shift', 'shift'] },
  },
  steps: [
    chapter('The first blow'),
    tell('This is a pretend game against an opponent. You each have a Heart. Defeat the opponent’s Heart to win.'),
    tell('Your cards are at the bottom, the opponent’s at the top. Upright cards are ready, and a ready Knight can attack.'),
    step('Drag one of your Knights onto the opponent’s Heart to attack it.', attackOn('heart')),
    end(),
    tell('The opponent’s Heart turned sideways: it is spent now. One more blow defeats it.'),
    tell('But the first blow on a Heart costs the attacker: your Knight was defeated.'),
    wait(),

    chapter('Guard'),
    tell('The opponent put a Guardian on their Heart. A guarded card can’t be hit, by attacks or by spells.'),
    step('Deploy the Knight in your hand: drag it onto your side of the table.', is('deploy')),
    step('Deploying used your Field action. You also get a Chain action each turn: drag the Fireball into your Chain.', is('wind')),
    end(),
    tell('A spell in your Chain waits there: you play it on a later turn.'),
    wait(),

    chapter('Defend'),
    tell('The opponent deployed a Knight. Your Heart has no Guardian, so their Knight could attack it.'),
    step('Drag your Guardian onto your Heart.', (m, g) => m.type === 'deploy' && m.targetId === g.players[0].hearts[0].id),
    step('Keep the Fireball for now. Press End Turn.', is('end')),
    wait('The opponent’s turn. Watch their Knight.'),

    chapter('Spent'),
    tell('Their Knight couldn’t reach your Heart, so it hit your Guardian. Sideways means spent: your Guardian still guards, but one more hit defeats it.'),
    tell('Their Knight is spent too: attacking spends the attacker.'),
    step('Press Release to play your Chain.', is('release')),
    step('Drag the Fireball onto the opponent’s spent Knight. A hit on a spent card defeats it.', is('fireball', (m, g) => keyAt(g, m.targetId) === 'knight')),

    chapter('Instants'),
    tell('Instants are free: play them any time on your turn.'),
    step('Drag Witch’s Kiss onto a discard pile, then pick a Knight. The opponent’s pile works too.', is('cast', (m, g) => m.spell === 'kiss' && keyAt(g, m.targetId) === 'knight')),
    end('The Knight joins your side ready, and playing the Kiss used no action. Press End Turn.'),
    wait(),

    chapter('The Chain'),
    tell('The opponent called an Angel. While an Angel is ready, it takes any attack on its Heart instead.'),
    step('Drag Shift into your Chain.', is('wind')),
    end(),
    wait(),

    chapter('The plan'),
    tell('The opponent deployed another Knight.'),
    tell('When you release your Chain, it plays from slot I down to slot III. The order is your plan.'),
    step('Drag Shadow Step into your Chain, after Shift.', is('wind')),
    end('Next turn, you strike. Press End Turn.'),
    wait('The opponent’s turn. Watch their new Knight.'),

    chapter('The final blow'),
    tell('Their Knight defeated your spent Guardian, so your Heart is open now. You have to win this turn.'),
    tell('The opponent’s Heart has one blow left, behind a Guardian and an Angel. Your Chain holds Shift, then Shadow Step.'),
    step('Press Release.', is('release')),
    step('Shift comes first: drag it onto the opponent’s Guardian to send it back to their hand.', is('shift', (m, g) => keyAt(g, m.targetId) === 'guardian')),
    step('Their Heart has no Guardian now. Shadow Step makes one of your Knights attack: drag a Knight onto the opponent’s Heart.', is('shadow', (m, g) => keyAt(g, m.targetId) === 'heart')),
    tell('The Angel took the blow and was defeated. The attack didn’t land on the Heart, so your Knight survived.'),
    step('Your Knight has a partner Knight, so it attacks twice. Hit the opponent’s Heart.', attackOn('heart', { second: true })),
  ],
  foe: (moves, g) => moves.find((m) => FOE[g.turnNumber]?.(m, g)),
  done: (g) => g.winner === 0,
  outro: 'You know the game. The reference card at the left edge holds every shared rule. Try a real game against the Squire next.',
};

export class Tutor {
  constructor(story) { this.story = story; this.i = 0; this.n = 0; this.chapter = null; this.settle(null); }
  get current() { return this.story.steps[this.i]; }
  /** Step over chapter marks, an End Turn the engine already took, and the rival's turn once it is over. */
  settle(game) {
    for (let st = this.current; st; st = this.current) {
      if (st.chapter) { this.chapter = st; this.n = (this.n ?? 0) + 1; this.i++; continue; }
      if (game && ((st.end && game.turn !== 0) || (st.wait && game.turn === 0))) { this.i++; continue; }
      break;
    }
  }
  /** The moves to offer the player now: the ones the current step accepts. */
  allowed(game, moves = legalMoves(game)) {
    this.settle(game);
    const st = this.current;
    if (!st || st.wait || st.tell || this.done(game)) return [];
    return moves.filter((m) => st.pick(m, game));
  }
  /** Call after every move, either seat's. */
  played(before, move, after) {
    const st = this.current;
    if (before.turn === 0 && st && !st.wait && st.pick(move, before)) this.i++;
    this.settle(after);
  }
  done(game) { return this.story.done(game); }
  /** Is a line waiting to be read (the game, the rival too, waits for Continue)? */
  telling(game) { this.settle(game); return !this.done(game) && !!this.current?.tell; }
  /** Continue: the line has been read. */
  next(game) { if (this.telling(game)) { this.i++; this.settle(game); } }
  /** The line for the current step. */
  text(game) { this.settle(game); return this.done(game) ? '' : this.current?.say ?? ''; }
  /** The chapter, for the top of the table: its name and where it is in the story. */
  banner(game) { this.settle(game); return { label: this.chapter?.chapter ?? '', at: `Learn to play · ${this.n ?? 0} of ${this.story.steps.filter((x) => x.chapter).length}` }; }
  /** The rival: the story's move for this turn if it has one, otherwise it lets the turn go (a second attack declined, a spell skipped, the turn ended). */
  foe() {
    const pick = this.story.foe ?? (() => null);
    return {
      move(game) {
        const moves = legalMoves(game);
        return pick(moves, game) ?? moves.find((m) => m.type === 'decline') ?? moves.find((m) => m.type === 'skip') ?? moves.find((m) => m.type === 'end') ?? moves[0];
      },
    };
  }
}
