import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../wizard/game-engine';
import { GameState, RegisteredPlayer } from '../wizard/types';

// Computed, because the template is outside of what tsc compiles here
const templateFile = (file: string) => pathToFileURL(resolve(__dirname, '../../../bot-template', file)).href;

let chooseMove: (state: GameState, me: RegisteredPlayer, strategy: unknown, warn?: unknown) => Promise<any>;
let strategy: Record<string, (view: any) => unknown>;

beforeAll(async () => {
  ({ chooseMove } = await import(templateFile('lib/turn.js')));
  strategy = await import(templateFile('strategy.js'));
});

const seats = (count: number): RegisteredPlayer[] =>
  Array.from({ length: count }, (_, i) => ({ id: `id${i}`, name: `bot${i}` }));

// The engine throws on an illegal move, so this fails if the template and the engine disagree
const playGame = async (players: RegisteredPlayer[], botStrategy: unknown, warn: unknown) => {
  const engine = new GameEngine(players);

  for (let id = engine.currentPlayerId; id; id = engine.currentPlayerId) {
    // Through JSON, because this is what bots get from the server
    const state: GameState = JSON.parse(JSON.stringify(engine.getState(id)));
    const me = players.find(p => p.id === id)!;
    const { event, payload } = await chooseMove(state, me, botStrategy, warn);

    if (event === 'selectTrump') engine.setTrump(id, payload.color);
    else if (event === 'setForecast') engine.setForecast(id, payload.bid);
    else engine.playCard(id, payload.card);
  }
  return engine.getState(players[0].id);
};

describe('bot template', () => {
  describe.each([3, 4, 5, 6])('with %i players', count => {
    it('plays full games with legal moves', async () => {
      const warn = vi.fn();
      for (let game = 0; game < 25; game++) {
        const state = await playGame(seats(count), strategy, warn);
        expect(state.gameOver).toBe(true);
      }
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('when the strategy misbehaves', () => {
    const illegalMoves = {
      'throws': () => { throw new Error('bug'); },
      'returns nothing': () => undefined,
      'returns null': () => null,
      'returns garbage': () => 'garbage',
      'returns an illegal number': () => -1,
      'returns a card with no rank': () => ({}),
    };

    it.each(Object.entries(illegalMoves))('still plays when it %s', async (_name, choose) => {
      const warn = vi.fn();
      const broken = { chooseTrump: choose, chooseBid: choose, chooseCard: choose };

      const state = await playGame(seats(4), broken, warn);

      expect(state.gameOver).toBe(true);
      expect(warn).toHaveBeenCalled();
    });
  });

  it('sees whose id is whose in the view', async () => {
    const players = seats(3);
    const engine = new GameEngine(players);
    const id = engine.currentPlayerId!;
    const me = players.find(p => p.id === id)!;
    const seen: any[] = [];

    await chooseMove(
      JSON.parse(JSON.stringify(engine.getState(id))),
      me,
      {
        chooseTrump: (view: any) => { seen.push(view); return view.colors[0]; },
        chooseBid: (view: any) => { seen.push(view); return view.legalBids[0]; },
      }
    );

    expect(seen[0].me).toEqual(me);
    expect(seen[0].hand).toHaveLength(1);
    expect(seen[0].totalRounds).toBe(20);
  });
});
