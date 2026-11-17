/**
 * Every card in the game and its rules text. `kind` is the card's type:
 *   creature  stays on your side, is ready or spent
 *   device    stays on your side, never ready or spent
 *   spell     wound into your Chain with the Magic action (Fireball, Shift, Behind You, Shadow Step)
 *   instant   played from your hand for free, any time on your turn (Rally, Witch's Kiss)
 *   heart     one per player, never in a deck
 * `attacks: true` marks the creatures that can attack. Everything else about a card is in rules.js.
 */
export const CARDS = {
  heart: { name: 'Heart', kind: 'heart', text: 'Stationary. The first successful attack turns it spent. Another defeats it, and you lose.' },
  knight: { name: 'Knight', kind: 'creature', attacks: true, text: 'Attacks. While another of your Knights is ready, it can attack twice.' },
  maniac: { name: 'Maniac', kind: 'creature', attacks: true, text: 'Enters spent. Attacks twice each turn.' },
  guardian: { name: 'Guardian', kind: 'creature', text: 'Guards one of your cards. Never attacks. Moving it is your Field action and turns it spent.' },
  angel: { name: 'Angel', kind: 'creature', text: 'Never attacks. While it is ready, an attack on your Heart defeats the Angel instead.' },
  lantern: { name: 'Lantern Keeper', kind: 'creature', text: 'Never attacks. While it is ready, your other spent creatures are guarded.' },
  portal: { name: 'Warp Portal', kind: 'device', text: 'Your attacks ignore Guard. Creatures can’t attack it. Spells can.' },
  resolve: { name: 'Heaven’s Resolve', kind: 'device', text: 'While it stands, Recover doesn’t use your Field action.' },
  fireball: { name: 'Fireball', kind: 'spell', text: 'Hit one unguarded card that is not a Heart.' },
  shift: { name: 'Shift', kind: 'spell', text: 'Take an enemy Guardian off its card, or return a spell in the enemy’s Chain to its owner’s hand.' },
  behind: { name: 'Behind You', kind: 'spell', text: 'Hit every unguarded creature.' },
  shadow: { name: 'Shadow Step', kind: 'spell', text: 'One of your ready attackers attacks. This does not use your Field action.' },
  rally: { name: 'Rally', kind: 'instant', text: 'Ready one of your creatures.' },
  kiss: { name: 'Witch’s Kiss', kind: 'instant', text: 'Take one card from either discard pile or from either player’s Chain. A creature enters spent. Anything else goes to your hand.' },
};

/** The deck each player shuffles: 25 cards. Each player also starts with a Heart and a Guardian guarding it, both outside the deck. */
export const DECK = { knight: 4, maniac: 1, guardian: 2, angel: 3, lantern: 1, portal: 1, resolve: 1, fireball: 3, shift: 2, behind: 1, shadow: 2, rally: 2, kiss: 2 };

/** Cards each player draws at the start of the game. */
export const HAND_SIZE = 5;
/** Slots in each player's Chain. */
export const CHAIN_MAX = 3;
