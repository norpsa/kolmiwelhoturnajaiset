// What the server sends. Keep in line with server/src/wizard/types.ts and result-store.ts.
export type Color = 'humans' | 'dwarves' | 'elves' | 'giants';

export interface Card {
  color?: Color; // Wizards and Jesters have no color
  rank: number | 'Z' | 'N';
}

export interface RegisteredPlayer {
  id: string;
  name: string;
}

export type ReplayEvent =
  | {
      type: 'roundStart';
      roundNumber: number;
      hands: Record<string, Card[]>;
      trump: Card | null;
      trumpColor: Color | null;
      firstPlayerId: string;
    }
  | { type: 'selectTrump'; playerId: string; color: Color; auto: boolean }
  | { type: 'bid'; playerId: string; bid: number; auto: boolean }
  | { type: 'play'; playerId: string; card: Card; auto: boolean }
  | { type: 'trickEnd'; winner: string }
  | { type: 'roundEnd'; tricksWon: Record<string, number>; scores: Record<string, number> };

export interface GameReplay {
  players: RegisteredPlayer[];
  events: ReplayEvent[];
}

export interface PlayerResult {
  botId: string;
  name: string;
  score: number;
}

export interface GameResult {
  gameId: string;
  finishedAt: string;
  players: PlayerResult[];
}

export interface GameList {
  total: number;
  games: GameResult[];
}

export interface GameDetails {
  result: GameResult;
  replay: GameReplay | null;
}

export interface LeaderboardRow {
  rank: number;
  botId: string;
  name: string;
  games: number;
  wins: number;
  performance: number;
  averageScore: number;
}
