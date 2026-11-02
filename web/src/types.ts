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
  // Ids of bots that weren't playing at the end, which keeps the game out of the rankings
  didNotFinish?: string[];
  // Set for games of a tournament
  tournamentId?: string;
  round?: number;
}

export interface GameList {
  total: number;
  games: GameResult[];
}

export interface GameDetails {
  result: GameResult;
  replay: GameReplay | null;
}

export type TournamentStatus = 'signup' | 'running' | 'finished' | 'interrupted' | 'cancelled';

export interface TournamentSummary {
  id: string;
  name: string;
  tableSize: number;
  rounds: number;
  status: TournamentStatus;
  createdAt: string;
  entrants: number;
  roundsPlayed: number;
  winners: string[];
}

export interface StandingsRow {
  rank: number;
  botId: string;
  name: string;
  games: number;
  missed: number;
  points: number;
  averagePoints: number;
  wins: number;
  averageScore: number;
}

export interface TournamentTable {
  // Null until the game has finished
  gameId: string | null;
  players: RegisteredPlayer[];
  result: GameResult | null;
}

export interface Tournament {
  id: string;
  name: string;
  tableSize: number;
  rounds: number;
  status: TournamentStatus;
  createdAt: string;
  entrants: RegisteredPlayer[];
  schedule: TournamentTable[][];
  // Bots that missed each round. Missing from older tournaments.
  absences?: RegisteredPlayer[][];
  standings: StandingsRow[];
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
