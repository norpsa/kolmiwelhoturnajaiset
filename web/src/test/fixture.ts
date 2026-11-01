import { GameDetails, GameReplay } from '../types';

export const replay: GameReplay = {
  players: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ],
  events: [
    {
      type: 'roundStart',
      roundNumber: 1,
      hands: {
        a: [{ rank: 5, color: 'elves' }],
        b: [{ rank: 'Z' }],
        c: [{ rank: 2, color: 'humans' }],
      },
      trump: { rank: 'Z' },
      trumpColor: null,
      firstPlayerId: 'b',
    },
    { type: 'selectTrump', playerId: 'a', color: 'giants', auto: false },
    { type: 'bid', playerId: 'b', bid: 1, auto: false },
    { type: 'bid', playerId: 'c', bid: 0, auto: true },
    { type: 'bid', playerId: 'a', bid: 1, auto: false },
    { type: 'play', playerId: 'b', card: { rank: 'Z' }, auto: false },
    { type: 'play', playerId: 'c', card: { rank: 2, color: 'humans' }, auto: true },
    { type: 'play', playerId: 'a', card: { rank: 5, color: 'elves' }, auto: false },
    { type: 'trickEnd', winner: 'b' },
    { type: 'roundEnd', tricksWon: { a: 0, b: 1, c: 0 }, scores: { a: -10, b: 30, c: 20 } },
    {
      type: 'roundStart',
      roundNumber: 2,
      hands: {
        a: [{ rank: 1, color: 'elves' }, { rank: 2, color: 'elves' }],
        b: [{ rank: 3, color: 'elves' }, { rank: 4, color: 'elves' }],
        c: [{ rank: 'N' }, { rank: 'N' }],
      },
      trump: null,
      trumpColor: null,
      firstPlayerId: 'c',
    },
    { type: 'bid', playerId: 'c', bid: 0, auto: false },
    { type: 'bid', playerId: 'a', bid: 1, auto: false },
    { type: 'bid', playerId: 'b', bid: 2, auto: false },
    { type: 'play', playerId: 'c', card: { rank: 'N' }, auto: false },
    { type: 'play', playerId: 'a', card: { rank: 1, color: 'elves' }, auto: false },
    { type: 'play', playerId: 'b', card: { rank: 3, color: 'elves' }, auto: false },
    { type: 'trickEnd', winner: 'b' },
    { type: 'play', playerId: 'b', card: { rank: 4, color: 'elves' }, auto: false },
    { type: 'play', playerId: 'c', card: { rank: 'N' }, auto: false },
    { type: 'play', playerId: 'a', card: { rank: 2, color: 'elves' }, auto: false },
    { type: 'trickEnd', winner: 'b' },
    { type: 'roundEnd', tricksWon: { a: 0, b: 2, c: 0 }, scores: { a: -20, b: 70, c: 40 } },
  ],
};

export const details: GameDetails = {
  result: {
    gameId: 'game-1',
    finishedAt: '2026-11-01T12:00:00.000Z',
    players: [
      { botId: 'a', name: 'Alpha', score: -20 },
      { botId: 'b', name: 'Beta', score: 70 },
      { botId: 'c', name: 'Gamma', score: 40 },
    ],
  },
  replay,
};
