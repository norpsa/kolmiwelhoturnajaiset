import { colors, legalBids, legalCards } from './rules.ts';
import type { Bot, Card, MoveState, Move, Strategy, View } from './types.ts';

type Warn = (message: string, detail: unknown) => void;

const pickRandom = <T>(options: readonly T[]): T => options[Math.floor(Math.random() * options.length)];

// A strategy's choice is checked at runtime, so these also have to cope with wrong types
const isSameCard = (a: Card, b: unknown) => {
  const card = b as Card | null | undefined;
  return a.rank === card?.rank && a.color === card?.color;
};
const isSameValue = (a: unknown, b: unknown) => a === b;

// What strategy.ts gets to see. The state uses names in nextAction and currentTurn, and ids
// everywhere else.
export function buildView(state: MoveState, me: Bot): View {
  const { round, previousRound, players, scores, currentHand, totalRounds, nextAction } = state;

  return {
    me,
    colors,
    hand: currentHand,
    legalBids: nextAction.action === 'setForecast' ? legalBids(state) : [],
    legalCards: nextAction.action === 'playCard' ? legalCards(state) : [],
    roundNumber: round.roundNumber,
    totalRounds,
    trumpColor: round.trumpColor ?? null,
    trick: round.tricks[round.currentTrick] ?? null,
    round,
    previousRound,
    players,
    scores,
    state,
  };
}

// Asks the strategy for a move and makes sure it is legal. A rejected move would leave the
// bot waiting for the server's timeout, which uses up its extra time. Returns our own copy
// of the choice, so that a strategy can't add anything to the move.
async function legalChoice<T>(
  name: string,
  options: readonly T[],
  isSame: (option: T, choice: unknown) => boolean,
  choose: () => T | Promise<T>,
  warn: Warn
): Promise<T> {
  let choice: unknown;
  try {
    choice = await choose();
  } catch (err) {
    warn(`${name} failed, playing a random legal move:`, err);
    return pickRandom(options);
  }

  const legal = options.find((option) => isSame(option, choice));
  if (legal === undefined) {
    warn(`${name} returned an illegal move, playing a random legal move:`, choice);
    return pickRandom(options);
  }
  return legal;
}

export async function chooseMove(
  state: MoveState,
  me: Bot,
  strategy: Strategy,
  warn: Warn = console.warn
): Promise<Move> {
  const view = buildView(state, me);

  switch (state.nextAction.action) {
    case 'selectTrump': {
      const color = await legalChoice('chooseTrump', colors, isSameValue, () => strategy.chooseTrump(view), warn);
      return { event: 'selectTrump', payload: { color } };
    }
    case 'setForecast': {
      const bid = await legalChoice('chooseBid', view.legalBids, isSameValue, () => strategy.chooseBid(view), warn);
      return { event: 'setForecast', payload: { bid } };
    }
    case 'playCard': {
      const card = await legalChoice('chooseCard', view.legalCards, isSameCard, () => strategy.chooseCard(view), warn);
      return { event: 'playCard', payload: { card } };
    }
  }
}
