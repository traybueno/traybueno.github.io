/**
 * Every card in the game and its rules text. `kind` is the card's type:
 *   creature  stays on your side, is ready or spent
 *   device    stays on your side, enters spent and never readies (so any hit defeats it)
 *   spell     wound into your Chain with the Chain action (Fireball, Shift, Behind You, Shadow Step)
 *   instant   played from your hand for free, any time on your turn (Rally, Witch's Kiss)
 *   heart     one per player, never in a deck
 * `instant: true` marks an instant creature (the Lantern Keeper): it is deployed like an instant, any time on your turn, without the Field action; it is a creature in every other way.
 * `attacks: true` marks the creatures that can attack. Everything else about a card is in rules.js.
 */
export const CARDS = {
  heart: { name: 'Heart', kind: 'heart', text: 'The first attack that lands turns it spent and defeats the attacker. The next one defeats it, and you lose.' },
  knight: { name: 'Knight', kind: 'creature', attacks: true, text: 'Attacks twice while another of your Knights is in play.' },
  maniac: { name: 'Maniac', kind: 'creature', attacks: true, text: 'Enters spent. Attacks twice.' },
  guardian: { name: 'Guardian', kind: 'creature', text: 'Enters on one of your cards and guards it.' },
  angel: { name: 'Angel', kind: 'creature', text: 'While it’s ready, an attack on your Heart defeats this instead.' },
  lantern: { name: 'Lantern Keeper', kind: 'creature', instant: true, text: 'While it’s ready, your other spent creatures are guarded and can still attack.' },
  portal: { name: 'Warp Portal', kind: 'device', text: 'Your attacks can hit guarded cards. Only spells can hit this.' },
  resolve: { name: 'Heaven’s Resolve', kind: 'device', text: 'Recover doesn’t use your Field action.' },
  fireball: { name: 'Fireball', kind: 'spell', text: 'Hit any card except a Heart.' },
  shift: { name: 'Shift', kind: 'spell', text: 'Return an enemy Guardian, or a spell in the enemy’s Chain, to its owner’s hand.' },
  behind: { name: 'Behind You', kind: 'spell', text: 'Hit every creature, yours too.' },
  shadow: { name: 'Shadow Step', kind: 'spell', text: 'A Knight or Maniac of yours attacks for free, even if spent.' },
  rally: { name: 'Rally', kind: 'instant', text: 'Ready one of your spent creatures.' },
  kiss: { name: 'Witch’s Kiss', kind: 'instant', text: 'Take a card from any discard pile or Chain and play it free, ready. A spell goes to your hand.' },
};

/** The deck each player shuffles: 25 cards. Each player also starts with a Heart and a Guardian guarding it, both outside the deck. */
export const DECK = { knight: 4, maniac: 1, guardian: 2, angel: 2, lantern: 1, portal: 1, resolve: 1, fireball: 3, shift: 2, behind: 2, shadow: 2, rally: 2, kiss: 2 };

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
        { topic: 'field', name: 'Field', options: ['Deploy', 'Attack', 'Move a Guardian', 'Recover (ready your spent Knights and Maniacs)'] },
        { topic: 'chain', name: 'Chain', options: ['Wind (a spell onto the right end)', 'Release: left to right, skip any you like'] },
      ] },
      { topic: 'end', name: 'End', text: 'End your turn.' },
    ],
    instants: { topic: 'instant', name: 'Instants', text: 'Any time on your turn.' },
    note: 'Instants and card effects never use your actions.',
  },
  cards: {
    title: 'The Cards',
    states: { topic: 'states', steps: ['Ready', 'Spent', 'Defeated'], by: 'hit', caption: 'Upright is ready; sideways is spent. Attacking spends the attacker.' },
    rows: [
      { topic: 'attack', text: 'Only Knights and Maniacs attack. “Attacks twice”: the second comes straight after, nothing between.' },
      { topic: 'spent', text: 'A spent creature can’t attack or move until it is readied. Recover readies Knights and Maniacs; only Rally readies other creatures.' },
      { topic: 'device', text: 'Devices enter spent.' },
      { topic: 'guard', text: 'A guarded card can’t be hit by attacks or spells. A Guardian guards the card it is on; Guardians are never guarded. If that card leaves play, its Guardian returns to your hand.' },
      { topic: 'pile', text: 'With your pile empty, you have no Guardians.' },
    ],
    goal: { topic: 'heart', text: 'Defeat the enemy Heart.' },
  },
};
