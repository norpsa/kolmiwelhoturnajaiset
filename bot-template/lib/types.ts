// Everything the server sends, and everything your strategy gets to see. The server doesn't
// check this file, so keep it in line with server/src/wizard/types.ts.

export type Color = 'humans' | 'dwarves' | 'elves' | 'giants';

export interface Card {
  /** 1-13, 'Z' for a Wizard or 'N' for a Jester. */
  rank: number | 'Z' | 'N';
  /** Wizards and Jesters have no color. */
  color?: Color;
}

export interface Bot {
  id: string;
  name: string;
}

export interface Player extends Bot {
  tricksTaken: number;
  /** Null until the player has bid. */
  tricksForecasted: number | null;
  cardsInHand: number;
}

export interface Forecast {
  playerId: string;
  bid: number;
}

export interface Trick {
  id: number;
  /** In the order they were played. */
  plays: { playerId: string; card: Card }[];
  /**
   * The color to follow. Undefined until the trick has one, for example while only Jesters
   * have been played, and null if the trick has no color because a Wizard came first.
   */
  trickColor?: Color | null;
  /** Set when the trick is complete. */
  winner?: string;
}

export interface Round {
  /** The current round, which is also how many tricks it has. */
  roundNumber: number;
  tricks: Trick[];
  /** Index in tricks of the trick being played. */
  currentTrick: number;
  forecasts: Forecast[];
  /** By bot id. */
  tricksWon: Record<string, number>;
  /** The card that set the trump, null in the last round. */
  trump: Card | null;
  /** Null if the round has no trump, or until the dealer has chosen one after a Wizard. */
  trumpColor: Color | null;
  firstPlayerOfRoundIndex: number;
}

export type Action = 'selectTrump' | 'setForecast' | 'playCard';

export interface NextAction {
  action: Action;
  /** Despite the name this is the bot's name, unlike every other playerId. */
  playerId: string;
}

export interface GameState {
  round: Round | null;
  previousRound: Round | null;
  totalRounds: number;
  players: Player[];
  /** The name of the bot to move. */
  currentTurn: string;
  /** Points so far by bot id. */
  scores: Record<string, number>;
  /** Your own cards. */
  currentHand: Card[];
  nextAction: NextAction | null;
  gameOver: boolean;
}

/** A state that is waiting for a move. */
export interface MoveState extends GameState {
  round: Round;
  nextAction: NextAction;
}

export const isWaitingForMove = (state: GameState): state is MoveState =>
  state.round !== null && state.nextAction !== null;

/** What your strategy gets for each move. */
export interface View {
  /** Your bot. */
  me: Bot;
  /** Your cards. */
  hand: Card[];
  /** Bids you can make now, empty if you aren't bidding. */
  legalBids: number[];
  /** Cards you can play now, empty if you aren't playing a card. */
  legalCards: Card[];
  /** All four colors. */
  colors: readonly Color[];
  /** The trump color, or null if the round has no trump. */
  trumpColor: Color | null;
  /** The trick being played, or null if you lead it. */
  trick: Trick | null;
  /** The current round, which is also how many tricks it has. */
  roundNumber: number;
  /** How many rounds the game has. */
  totalRounds: number;
  /** All of the current round. */
  round: Round;
  /** The same for the round before, or null in the first round. */
  previousRound: Round | null;
  players: Player[];
  /** Points so far by bot id. */
  scores: Record<string, number>;
  /** The whole state as the server sent it. */
  state: MoveState;
}

/** The three functions in strategy.ts. Each can also return a promise. */
export interface Strategy {
  chooseTrump(view: View): Color | Promise<Color>;
  chooseBid(view: View): number | Promise<number>;
  chooseCard(view: View): Card | Promise<Card>;
}

export type Move =
  | { event: 'selectTrump'; payload: { color: Color } }
  | { event: 'setForecast'; payload: { bid: number } }
  | { event: 'playCard'; payload: { card: Card } };

export interface Registered {
  /** Null while waiting for the next game of a tournament. */
  gameId: string | null;
  botId: string;
  name: string;
  playerCount: number | null;
  tournamentId?: string;
  /** Sent only when the name is claimed. */
  token?: string;
}

export interface ServerEvents {
  registered: (registered: Registered) => void;
  playersUpdated: (players: Bot[]) => void;
  gameStarted: () => void;
  state: (state: GameState) => void;
  errorMessage: (message: string) => void;
  tournamentFinished: (result: { tournamentId: string; rank: number; bots: number }) => void;
  tournamentCancelled: (result: { tournamentId: string }) => void;
}

export interface ClientEvents {
  register: (request: { name: string; token?: string; playerCount?: number; tournamentId?: string }) => void;
  startGame: () => void;
  selectTrump: (move: { color: Color }) => void;
  setForecast: (move: { bid: number }) => void;
  playCard: (move: { card: Card }) => void;
}
