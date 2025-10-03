// src/game/types.ts
export const colors = ['humans', 'dwarves', 'elves', 'giants'] as const;
export type Color = (typeof colors)[number];

// Numeric ranks (1–13)
export const numberRanks = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
] as const;
export type NumberRank = (typeof numberRanks)[number];

// Special ranks
export const specialRanks = ['Z', 'N'] as const;
export type SpecialRank = (typeof specialRanks)[number];

// All ranks
export type Rank = NumberRank | SpecialRank;

// Card type
export interface Card {
  color?: Color; // optional because Z/N don't have colors
  rank: Rank;
}

export interface SerializedPlayer {
  id: string;
  tricksTaken: number;
  tricksForecasted: number | null;
  cardsInHand: number;
}

export interface Forecast {
  playerId: string;
  bid: number;
}

export interface Trick {
  id: number;
  plays: { playerId: string; card: Card }[];
  winner?: string;
}

export interface Round {
  roundNumber: number;
  tricks: Trick[];
  currentTrick: number;
  forecasts: Forecast[];
  tricksWon: Record<string, number>;
  trump: Card | null;
}

export interface GameState {
  round: Round | null;
  totalRounds: number;
  players: SerializedPlayer[];
  currentTurn: string;
  scores: Record<string, number>;
  currentHand: Card[];
}