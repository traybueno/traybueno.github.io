/** Field + Chain, Restricted: the whole public surface of the engine. */
import { DECK } from './cards.js?v=a027ba8';
import { blankGame, viewFor } from './state.js?v=a027ba8';
import { initialize, legalMoves, apply, moveError, locate, isGuarded, guardiansOf, attackTargets, canAttack, inPlay, isCreature, kindOf, hasPortal, hasResolve, isBacked, canStrike, protector, inForce, affects, outOfCards, INSTANTS } from './rules.js?v=a027ba8';

export { CARDS, DECK, CHAIN_MAX, HAND_SIZE, REFERENCE } from './cards.js?v=a027ba8';
export { viewFor, legalMoves, apply, moveError, locate, isGuarded, guardiansOf, attackTargets, canAttack, inPlay, isCreature, kindOf, hasPortal, hasResolve, isBacked, canStrike, protector, inForce, affects, outOfCards, INSTANTS };

/** A new game from a seed (the same seed always deals the same game). `options.deck` overrides the deck list, `{ key: count }`. Seat 0 plays first. */
export const newGame = (seed = 1, { deck = DECK } = {}) => initialize(blankGame(seed, deck));
