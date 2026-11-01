import { colors, legalBids, legalCards } from './rules.js';

const pickRandom = (options) => options[Math.floor(Math.random() * options.length)];

const isSameCard = (a, b) => a.rank === b?.rank && a.color === b?.color;

// nextAction.action is also the name of the server event that answers it
const moves = {
  selectTrump: {
    choose: 'chooseTrump',
    options: () => colors,
    isSame: (a, b) => a === b,
    payload: (color) => ({ color }),
  },
  setForecast: {
    choose: 'chooseBid',
    options: legalBids,
    isSame: (a, b) => a === b,
    payload: (bid) => ({ bid }),
  },
  playCard: {
    choose: 'chooseCard',
    options: legalCards,
    isSame: isSameCard,
    payload: (card) => ({ card }),
  },
};

// What strategy.js gets to see. me is { id, name }. The state uses names in nextAction
// and currentTurn, and ids everywhere else.
export function buildView(state, me) {
  const { round, previousRound, players, scores, currentHand, totalRounds } = state;
  const action = state.nextAction.action;

  return {
    me,
    colors,
    hand: currentHand,
    legalBids: action === 'setForecast' ? legalBids(state) : [],
    legalCards: action === 'playCard' ? legalCards(state) : [],
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
// bot waiting for the server's timeout, which uses up its extra time.
export async function chooseMove(state, me, strategy, warn = console.warn) {
  const action = state.nextAction.action;
  const move = moves[action];
  const options = move.options(state);

  let choice;
  try {
    choice = await strategy[move.choose](buildView(state, me));
  } catch (err) {
    warn(`${move.choose} failed, playing a random legal move:`, err);
    return { event: action, payload: move.payload(pickRandom(options)) };
  }

  // Sends our own copy of the choice, so that a strategy can't add anything to the move
  const legal = options.find((option) => move.isSame(option, choice));
  if (legal === undefined) {
    warn(`${move.choose} returned an illegal move, playing a random legal move:`, choice);
    return { event: action, payload: move.payload(pickRandom(options)) };
  }
  return { event: action, payload: move.payload(legal) };
}
