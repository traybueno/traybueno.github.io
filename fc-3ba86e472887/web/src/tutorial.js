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
import { newGame, legalMoves, locate } from '../../src/index.js?v=b3f8a59';

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
  g.turn = 0; g.turnNumber = 1; g.phase = 'play'; g.winner = null; g.used = { field: false, chain: false, guard: false }; delete g.bonus;
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
  8: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'resolve',
  10: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'angel',
  12: (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'angel',
};

/** The story, chapter by chapter, follows the reference card: the turn (Draw, a Field action and a Chain action, instants beside them), then the life
 * of a card (ready, spent, defeated), Guardians, devices, Recover, and last one turn that puts both actions to full use. */
export const STORY = {
  board: {
    field: { 0: ['knight', 'knight'] }, hand: { 0: ['knight'], 1: ['guardian', 'knight', 'resolve', 'angel', 'angel'] },
    draws: { 0: ['fireball', 'guardian', 'rally', 'shift', 'shadow', 'rally', 'rally', 'rally'], 1: ['shift', 'shift', 'shift', 'shift', 'shift', 'shift', 'shift', 'shift'] },
  },
  steps: [
    chapter('Your turn'),
    tell('This is a pretend game against an opponent. You each have a Heart. Defeat the opponent’s Heart to win.'),
    tell('Every turn has the same shape: draw a card, then take one Field action and one Chain action, in either order. You may skip either. Then end your turn.'),
    tell('The Field action is for the table: deploy a card, attack, or recover. The Chain action is for spells: wind one into your Chain, or release it. The Rules card at the left shows this any time.'),

    chapter('Creatures'),
    tell('Knights are creatures. Upright means ready. A creature takes two hits: the first turns it sideways (spent), the second defeats it.'),
    step('Only Knights and Maniacs attack, and attacking is a Field action. Drag one of your Knights onto the opponent’s Heart.', attackOn('heart')),
    end(),
    tell('A Heart takes two blows too. The first spends it, but costs the attacker: your Knight was defeated. One more blow wins.'),
    tell('That attack was your Field action, and you had no spell for your Chain, so your turn ended by itself.'),
    wait(),

    chapter('Two actions'),
    tell('The opponent put a Guardian on their Heart. A guarded card can’t be hit, by attacks or by spells.'),
    tell('Your turn began with a draw: a Fireball, a spell. Now use both actions.'),
    step('Field action: deploy the Knight in your hand. Drag it onto your side of the table.', is('deploy')),
    step('Chain action: drag the Fireball into your Chain. A spell waits there until you release it on a later turn.', is('wind')),
    end('Both actions are used. Press End Turn.'),
    wait(),

    chapter('Guardians'),
    tell('The opponent deployed a Knight. Your Heart has no Guardian, so their Knight could attack it.'),
    step('You drew a Guardian. Deploying it is your Field action, and it must go onto one of your cards. Drag it onto one of your Knights.', (m, g) => m.type === 'deploy' && keyAt(g, m.cardId) === 'guardian' && keyAt(g, m.targetId) === 'knight'),
    step('Once each turn, a ready Guardian may move to another of your cards, using no action. Drag it from the Knight onto your Heart.', is('reguard', (m, g) => m.targetId === g.players[0].hearts[0].id)),
    tell('A Guardian is never guarded: it can always be hit, and it can’t go onto another Guardian. If the card it guards leaves play, it returns to your hand.'),
    end('Keep the Fireball for now. Where your Guardians stand when you end your turn is what the opponent faces. Press End Turn.'),
    wait('The opponent’s turn. Watch their Knight.'),

    chapter('Spent'),
    tell('Their Knight couldn’t reach your Heart, so it hit your Guardian. Now your Guardian is spent: it can’t move, and one more hit defeats it.'),
    tell('A spent card’s effect still works, so your Guardian still guards your Heart. Their Knight is spent too: attacking spends the attacker.'),
    step('You drew a Rally, an instant. Instants use no action: play them any time on your turn. Drag it onto your Guardian to ready it.', is('cast', (m) => m.spell === 'rally')),
    step('Press Release to play your Chain. That is your Chain action.', is('release')),
    step('Drag the Fireball onto the opponent’s spent Knight. A hit on a spent card defeats it.', is('fireball', (m, g) => keyAt(g, m.targetId) === 'knight' && theirs(g, m.targetId))),
    tell('The Maniac and the Lantern Keeper are instant creatures: you deploy them like instants, with no action.'),
    end('Your Field action went unused this turn, and that’s fine. Press End Turn.'),
    wait(),

    chapter('Devices'),
    tell('The opponent deployed a device, Heaven’s Resolve. Devices aren’t creatures: they enter spent and never ready, so one hit defeats them. Their effect always works.'),
    step('Field action: drag a Knight onto the Heaven’s Resolve to attack it.', attackOn('resolve')),
    step('Your Knight has a partner Knight in play, so it attacks twice, the second straight after. Hit the opponent’s Guardian.', attackOn('guardian', { second: true })),
    tell('Two attacks, one Field action. Their Guardian is spent now: it still guards their Heart, but it can’t move.'),
    step('Chain action: drag Shift into your Chain.', is('wind')),
    end(),
    wait(),

    chapter('Ready again'),
    tell('The opponent deployed an Angel. While an Angel is in play, ready or spent, an attack on its Heart defeats the Angel instead.'),
    step('One of your Knights is still spent from attacking. Field action: press Recover to ready your spent Knights and Maniacs.', is('recover')),
    step('Chain action: drag Shadow Step into your Chain, after Shift. A Chain plays from slot I down to slot III, so the order is your plan.', is('wind')),
    end(),
    wait(),

    chapter('One full turn'),
    tell('A second Angel. Their Heart has one blow left, behind a Guardian and two Angels. Win this turn.'),
    tell('Releasing is one Chain action, but it plays every spell in your Chain, in order. You may skip any, and take your Field action between them.'),
    step('Press Release.', is('release')),
    step('Shift comes first: drag it onto the opponent’s Guardian to send it back to their hand.', is('shift', (m, g) => keyAt(g, m.targetId) === 'guardian')),
    step('Before Shadow Step, take your Field action: drag a Knight onto the opponent’s Heart.', attackOn('heart')),
    step('An Angel took the blow, so your Knight survived. It has a partner, so it attacks again: hit the Heart.', attackOn('heart', { second: true })),
    step('The second Angel is gone too. Now Shadow Step: it makes a Knight attack, even a spent one, using no action. Drag a Knight onto the Heart.', is('shadow', (m, g) => keyAt(g, m.targetId) === 'heart')),
  ],
  foe: (moves, g) => moves.find((m) => FOE[g.turnNumber]?.(m, g)),
  done: (g) => g.winner === 0,
  outro: 'One Field action, one Chain action, and three attacks. One last rule: when your draw pile runs out, your Guardians are discarded and no more can enter. The Rules card at the left edge holds every shared rule. Try a real game against the Squire next.',
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
