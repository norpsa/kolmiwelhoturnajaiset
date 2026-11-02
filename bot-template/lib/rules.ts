// What is legal right now, worked out from the state the server sends.
// These have to match the checks in the server's game engine.
import type { Card, Color, MoveState } from './types.ts';

export const colors: readonly Color[] = ['humans', 'dwarves', 'elves', 'giants'];

export function legalBids(state: MoveState): number[] {
  const { roundNumber, forecasts } = state.round;
  const bids = Array.from({ length: roundNumber + 1 }, (_, bid) => bid);

  // The last bid can't make the bids add up to the number of tricks
  if (forecasts.length === state.players.length - 1) {
    const sum = forecasts.reduce((total, forecast) => total + forecast.bid, 0);
    return bids.filter((bid) => sum + bid !== roundNumber);
  }
  return bids;
}

export function legalCards(state: MoveState): Card[] {
  const { round, currentHand } = state;
  const trickColor = round.tricks[round.currentTrick]?.trickColor;
  const mustFollow = Boolean(trickColor) && currentHand.some((card) => card.color === trickColor);

  // Wizards and Jesters have no color, so they can always be played
  return currentHand.filter((card) => !card.color || !mustFollow || card.color === trickColor);
}
