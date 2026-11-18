/** Field + Chain, Restricted: the whole public surface of the engine. */
import { DECK } from './cards.js?v=4690f3a';
import { blankGame, viewFor } from './state.js?v=4690f3a';
import { initialize, legalMoves, apply, moveError, locate, isGuarded, guardiansOf, attackTargets, canAttack, inPlay, isCreature, kindOf, hasPortal, hasResolve, isBacked, canStrike, protector, inForce, outOfCards, INSTANTS } from './rules.js?v=4690f3a';

export { CARDS, DECK, CHAIN_MAX, HAND_SIZE, REFERENCE } from './cards.js?v=4690f3a';
export { viewFor, legalMoves, apply, moveError, locate, isGuarded, guardiansOf, attackTargets, canAttack, inPlay, isCreature, kindOf, hasPortal, hasResolve, isBacked, canStrike, protector, inForce, outOfCards, INSTANTS };

/** A new game from a seed (the same seed always deals the same game). `options.deck` overrides the deck list, `{ key: count }`. Seat 0 plays first. */
export const newGame = (seed = 1, { deck = DECK } = {}) => initialize(blankGame(seed, deck));
