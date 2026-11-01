import { Card, Color, GameReplay, RegisteredPlayer, ReplayEvent } from '../types';

export interface TrickPlay {
  playerId: string;
  card: Card;
}

// The game right after one event of the log
export interface Frame {
  event: ReplayEvent;
  roundNumber: number;
  trump: Card | null;
  trumpColor: Color | null;
  hands: Record<string, Card[]>;
  bids: Record<string, number>;
  tricksWon: Record<string, number>;
  scores: Record<string, number>;
  trick: TrickPlay[];
  trickWinner: string | null;
  // Who the game is waiting for, null between moves
  nextPlayerId: string | null;
}

const removeCard = (hand: Card[], card: Card) => {
  const index = hand.findIndex(c => c.rank === card.rank && c.color === card.color);
  return hand.filter((_, i) => i !== index);
};

// Frames share everything that didn't change, so a whole game stays small in memory
export const buildFrames = ({ players, events }: GameReplay): Frame[] => {
  const zeros = Object.fromEntries(players.map(p => [p.id, 0]));
  const frames: Frame[] = [];

  let current: Omit<Frame, 'event' | 'nextPlayerId'> = {
    roundNumber: 0,
    trump: null,
    trumpColor: null,
    hands: {},
    bids: {},
    tricksWon: zeros,
    scores: zeros,
    trick: [],
    trickWinner: null,
  };

  events.forEach((event, index) => {
    switch (event.type) {
      case 'roundStart':
        current = {
          ...current,
          roundNumber: event.roundNumber,
          trump: event.trump,
          trumpColor: event.trumpColor,
          hands: event.hands,
          bids: {},
          tricksWon: zeros,
          trick: [],
          trickWinner: null,
        };
        break;
      case 'selectTrump':
        current = { ...current, trumpColor: event.color };
        break;
      case 'bid':
        current = { ...current, bids: { ...current.bids, [event.playerId]: event.bid } };
        break;
      case 'play': {
        const { playerId, card } = event;
        // A finished trick stays on the table until the next card
        const trick = current.trickWinner ? [] : current.trick;
        current = {
          ...current,
          hands: { ...current.hands, [playerId]: removeCard(current.hands[playerId], card) },
          trick: [...trick, { playerId, card }],
          trickWinner: null,
        };
        break;
      }
      case 'trickEnd':
        current = {
          ...current,
          trickWinner: event.winner,
          tricksWon: { ...current.tricksWon, [event.winner]: current.tricksWon[event.winner] + 1 },
        };
        break;
      case 'roundEnd':
        current = { ...current, tricksWon: event.tricksWon, scores: event.scores };
        break;
    }

    const next = events[index + 1];
    frames.push({ ...current, event, nextPlayerId: next && 'playerId' in next ? next.playerId : null });
  });

  return frames;
};

// Where each round starts, for jumping to it
export const roundStarts = (frames: Frame[]) =>
  frames.flatMap((frame, index) =>
    frame.event.type === 'roundStart' ? [{ roundNumber: frame.roundNumber, index }] : []
  );

export interface RoundScore {
  roundNumber: number;
  players: Record<string, { bid: number; tricks: number; score: number }>;
}

// One row per finished round
export const buildScoreTable = (frames: Frame[]): RoundScore[] =>
  frames.flatMap(frame =>
    frame.event.type === 'roundEnd'
      ? [
          {
            roundNumber: frame.roundNumber,
            players: Object.fromEntries(
              Object.keys(frame.scores).map(id => [
                id,
                { bid: frame.bids[id], tricks: frame.tricksWon[id], score: frame.scores[id] },
              ])
            ),
          },
        ]
      : []
  );

export const cardName = (card: Card) => {
  if (card.rank === 'Z') return 'Wizard';
  if (card.rank === 'N') return 'Jester';
  return `${card.rank} of ${card.color}`;
};

export const describeEvent = (event: ReplayEvent, players: RegisteredPlayer[]) => {
  const name = (id: string) => players.find(p => p.id === id)?.name ?? id;

  switch (event.type) {
    case 'roundStart': {
      const trump = event.trump ? `trump card ${cardName(event.trump)}` : 'no trump card';
      return `Round ${event.roundNumber} dealt, ${trump}`;
    }
    case 'selectTrump':
      return `${name(event.playerId)} chooses ${event.color} as trump`;
    case 'bid':
      return `${name(event.playerId)} bids ${event.bid}`;
    case 'play':
      return `${name(event.playerId)} plays ${cardName(event.card)}`;
    case 'trickEnd':
      return `${name(event.winner)} wins the trick`;
    case 'roundEnd':
      return 'Round scored';
  }
};
