import { describe, expect, it } from 'vitest';
import { buildFrames, buildScoreTable, cardName, describeEvent, roundStarts, totalBid } from '../replay/frames';
import { replay } from './fixture';

describe('buildFrames', () => {
  const frames = buildFrames(replay);

  it('has one frame per event', () => {
    expect(frames).toHaveLength(replay.events.length);
    frames.forEach((frame, i) => expect(frame.event).toBe(replay.events[i]));
  });

  it('starts from the deal', () => {
    const [first] = frames;
    expect(first.roundNumber).toBe(1);
    expect(first.hands.a).toHaveLength(1);
    expect(first.trump).toEqual({ rank: 'Z' });
    expect(first.trumpColor).toBeNull();
    expect(first.scores).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('keeps the first player for the whole round', () => {
    expect(frames[0].firstPlayerId).toBe('b');
    expect(frames[9].firstPlayerId).toBe('b');
    expect(frames[10].firstPlayerId).toBe('c');
    expect(frames.at(-1)!.firstPlayerId).toBe('c');
  });

  it('applies the chosen trump', () => {
    expect(frames[1].trumpColor).toBe('giants');
  });

  it('collects bids', () => {
    expect(frames[1].bids).toEqual({});
    expect(frames[3].bids).toEqual({ b: 1, c: 0 });
  });

  it('moves played cards from the hand to the trick', () => {
    expect(frames[5].hands.b).toEqual([]);
    expect(frames[5].trick).toEqual([{ playerId: 'b', card: { rank: 'Z' } }]);
    expect(frames[7].trick).toHaveLength(3);
  });

  it('removes only one of two equal cards', () => {
    expect(frames[14].hands.c).toEqual([{ rank: 'N' }]);
  });

  it("doesn't change earlier frames", () => {
    expect(frames[4].hands.b).toEqual([{ rank: 'Z' }]);
    expect(frames[0].bids).toEqual({});
  });

  it('shows the winner of a finished trick', () => {
    expect(frames[7].trickWinner).toBeNull();
    expect(frames[8].trickWinner).toBe('b');
    expect(frames[8].tricksWon.b).toBe(1);
    expect(frames[8].trick).toHaveLength(3);
  });

  it('clears a finished trick at the next card', () => {
    const nextTrick = frames[18];
    expect(nextTrick.trick).toEqual([{ playerId: 'b', card: { rank: 4, color: 'elves' } }]);
    expect(nextTrick.trickWinner).toBeNull();
    expect(nextTrick.tricksWon.b).toBe(1);
  });

  it('updates scores when a round ends', () => {
    expect(frames[8].scores.b).toBe(0);
    expect(frames[9].scores).toEqual({ a: -10, b: 30, c: 20 });
  });

  it('starts the next round clean but keeps the scores', () => {
    const next = frames[10];
    expect(next.roundNumber).toBe(2);
    expect(next.bids).toEqual({});
    expect(next.trick).toEqual([]);
    expect(next.trickWinner).toBeNull();
    expect(next.tricksWon).toEqual({ a: 0, b: 0, c: 0 });
    expect(next.trumpColor).toBeNull();
    expect(next.scores).toEqual({ a: -10, b: 30, c: 20 });
  });

  it('knows who moves next', () => {
    expect(frames[0].nextPlayerId).toBe('a');
    expect(frames[1].nextPlayerId).toBe('b');
    expect(frames[7].nextPlayerId).toBeNull();
    expect(frames.at(-1)!.nextPlayerId).toBeNull();
  });

  it('ends with the final scores and empty hands', () => {
    const last = frames.at(-1)!;
    expect(last.scores).toEqual({ a: -20, b: 70, c: 40 });
    Object.values(last.hands).forEach(hand => expect(hand).toEqual([]));
  });

  it('handles an empty log', () => {
    expect(buildFrames({ players: replay.players, events: [] })).toEqual([]);
  });
});

describe('totalBid', () => {
  const frames = buildFrames(replay);

  it('adds up the bids as they are made', () => {
    expect(totalBid(frames[0])).toBe(0);
    expect(totalBid(frames[2])).toBe(1);
    expect(totalBid(frames[4])).toBe(2);
  });

  it('stays through the round', () => {
    expect(totalBid(frames[9])).toBe(2);
  });

  it('starts over in the next round', () => {
    expect(totalBid(frames[10])).toBe(0);
    expect(totalBid(frames[13])).toBe(3);
  });
});

describe('roundStarts', () => {
  it('finds each round', () => {
    expect(roundStarts(buildFrames(replay))).toEqual([
      { roundNumber: 1, index: 0 },
      { roundNumber: 2, index: 10 },
    ]);
  });
});

describe('buildScoreTable', () => {
  it('has bids, tricks and total points by round', () => {
    const table = buildScoreTable(buildFrames(replay));
    expect(table.map(row => row.roundNumber)).toEqual([1, 2]);
    expect(table[0].players.a).toEqual({ bid: 1, tricks: 0, score: -10 });
    expect(table[1].players.b).toEqual({ bid: 2, tricks: 2, score: 70 });
  });
});

describe('descriptions', () => {
  it('names cards', () => {
    expect(cardName({ rank: 'Z' })).toBe('Wizard');
    expect(cardName({ rank: 'N' })).toBe('Jester');
    expect(cardName({ rank: 7, color: 'dwarves' })).toBe('7 of dwarves');
  });

  it('describes every kind of event', () => {
    const texts = replay.events.slice(0, 10).map(event => describeEvent(event, replay.players));
    expect(texts[0]).toBe('Round 1 dealt, trump card Wizard');
    expect(texts[1]).toBe('Alpha chooses giants as trump');
    expect(texts[2]).toBe('Beta bids 1');
    expect(texts[5]).toBe('Beta plays Wizard');
    expect(texts[8]).toBe('Beta wins the trick');
    expect(texts[9]).toBe('Round scored');
  });

  it('describes a round with no trump card', () => {
    expect(describeEvent(replay.events[10], replay.players)).toBe('Round 2 dealt, no trump card');
  });
});
