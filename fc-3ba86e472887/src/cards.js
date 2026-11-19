/**
 * Every card in the game and its rules text. `kind` is the card's type:
 *   creature  stays on your side, is ready or spent
 *   device    stays on your side, enters spent and never readies (so any hit defeats it)
 *   spell     wound into your Chain with the Chain action (Fireball, Shift, Behind You, Shadow Step)
 *   instant   played from your hand for free, any time on your turn (Rally, Witch's Kiss)
 *   heart     one per player, never in a deck
 * `instant: true` marks an instant creature (the Lantern Keeper, and the Maniac since 19 Nov 2026): it is deployed like an instant, any time on your turn, without the Field action; it is a creature in every other way.
 * Spent means one more hit defeats a card, and a spent creature can't attack or move; its standing effect works ready or spent (19 Nov 2026, studies/2026-11-19-spent-audit). The Maniac's text and the Lantern Keeper's are the printed exceptions.
 * `attacks: true` marks the creatures that can attack. Everything else about a card is in rules.js.
 */
export const CARDS = {
  heart: { name: 'Heart', kind: 'heart', text: 'The first attack that lands spends it and defeats the attacker. The next defeats it, and you lose.' },
  knight: { name: 'Knight', kind: 'creature', attacks: true, text: 'Attacks twice while another of your Knights is in play.' },
  maniac: { name: 'Maniac', kind: 'creature', instant: true, attacks: true, text: 'Enters spent. Attacks twice, even while spent.' },
  guardian: { name: 'Guardian', kind: 'creature', text: 'Enters on one of your cards and guards it.' },
  angel: { name: 'Angel', kind: 'creature', text: 'An attack on your Heart defeats this instead.' },
  lantern: { name: 'Lantern Keeper', kind: 'creature', instant: true, text: 'Your spent cards, other than Lantern Keepers, are guarded. Your spent Knights can still attack.' },
  portal: { name: 'Warp Portal', kind: 'device', text: 'Your attacks can hit guarded cards. Only spells can hit this.' },
  resolve: { name: 'Heaven’s Resolve', kind: 'device', text: 'Recover doesn’t use your Field action, and readies all your creatures.' },
  fireball: { name: 'Fireball', kind: 'spell', text: 'Hit any card except a Heart.' },
  shift: { name: 'Shift', kind: 'spell', text: 'Return an enemy Guardian, or a spell in the enemy’s Chain, to its owner’s hand.' },
  behind: { name: 'Behind You', kind: 'spell', text: 'Hit every creature, yours too.' },
  shadow: { name: 'Shadow Step', kind: 'spell', text: 'A Knight or Maniac of yours attacks, even if spent.' },
  rally: { name: 'Rally', kind: 'instant', text: 'Ready one of your spent creatures.' },
  kiss: { name: 'Witch’s Kiss', kind: 'instant', text: 'Take any card but a Witch’s Kiss from a discard pile or the enemy’s Chain. Creatures (ready) and devices enter play for you; the rest go to your hand.' },
};

/** The deck each player shuffles: 26 cards (a second Lantern Keeper since 19 Nov 2026). Each player also starts with a Heart and a Guardian guarding it, both outside the deck. */
export const DECK = { knight: 4, maniac: 1, guardian: 2, angel: 2, lantern: 2, portal: 1, resolve: 1, fireball: 3, shift: 2, behind: 2, shadow: 2, rally: 2, kiss: 2 };

/** Cards each player draws at the start of the game. */
export const HAND_SIZE = 5;
/** Slots in each player's Chain. */
export const CHAIN_MAX = 3;

/**
 * The reference card: the rules every card shares, printed once so the card texts stay short (docs/REFERENCE.md says the same). Words only, no numbers.
 * It is structured so a front end can lay it out as a picture rather than a block of text; each part has a `topic` the front end may draw an icon for.
 *   turn   the turn in order: `steps` (Draw, then the two actions side by side, then End), `instants` (a band beside the whole turn), `note`
 *   cards  `states` (the life of a card: ready, spent, defeated, and what moves it on), then `rows` of one rule each, and the `goal`
 */
export const REFERENCE = {
  turn: {
    title: 'Your Turn',
    steps: [
      { topic: 'draw', name: 'Draw', text: 'Draw a card.' },
      { topic: 'actions', text: 'One of each, in either order, or skip either.', actions: [
        { topic: 'field', name: 'Field', options: ['Deploy', 'Attack', 'Recover (ready your spent Knights and Maniacs)'] },
        { topic: 'chain', name: 'Chain', options: ['Wind (a spell into the next free slot)', 'Release: top to bottom, I then II then III, skip any you like'] },
      ] },
      { topic: 'end', name: 'End', text: 'End your turn.' },
    ],
    instants: { topic: 'instant', name: 'Instants', text: 'Any time on your turn, instant creatures too.' },
    note: 'Instants, instant creatures and card effects never use your actions.',
  },
  cards: {
    title: 'The Cards',
    states: { topic: 'states', steps: ['Ready', 'Spent', 'Defeated'], by: 'hit', caption: 'Upright is ready; sideways is spent. Attacking spends the attacker.' },
    rows: [
      { topic: 'attack', text: 'Only Knights and Maniacs attack. “Attacks twice”: the second comes straight after, nothing between.' },
      { topic: 'spent', text: 'A spent creature can’t attack or move, but its effect still works: a spent Guardian still guards. Rally and Heaven’s Resolve ready any creature.' },
      { topic: 'device', text: 'Devices enter spent and never ready. Their effects always work.' },
      { topic: 'guard', text: 'A guarded card can’t be hit by attacks or spells. Guardians are never guarded. Once on your turn, a Guardian may move to another of your cards. If its card leaves play, it returns to your hand.' },
      { topic: 'pile', text: 'With your pile empty, you have no Guardians.' },
    ],
    goal: { topic: 'heart', text: 'Defeat the enemy Heart.' },
  },
};
