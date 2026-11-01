import { afterEach, describe, it, expect, vi } from "vitest";
import { Deck } from "../wizard/deck";
import { GameEngine } from "../wizard/game-engine";
import { Card, GamePlayAction } from "../wizard/types";

const makePlayers = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `name${i}` }));

const forceFirstTrump = (card: Card, playerCount: number) => {
  vi.spyOn(Deck.prototype, "shuffle").mockImplementationOnce(function (this: Deck) {
    this.cards[this.cards.length - 1 - playerCount] = card;
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GameEngine.playDefaultMove", () => {
  it.each([3, 4, 5, 6])("plays a whole game with %i players using only legal moves", count => {
    for (let game = 0; game < 50; game++) {
      const engine = new GameEngine(makePlayers(count));
      while (engine.currentPlayerId) engine.playDefaultMove();

      const state = engine.getState("p0");
      expect(state.gameOver).toBe(true);
      expect(state.round!.roundNumber).toBe(state.totalRounds);
    }
  });

  it("selects a trump color for the dealer", () => {
    forceFirstTrump({ rank: "Z" }, 3);
    const engine: any = new GameEngine(makePlayers(3));

    engine.playDefaultMove();

    expect(engine.currentRound.trumpColor).toBe("humans");
    expect(engine.currentAction).toBe(GamePlayAction.SetForecast);
  });

  it("forecasts zero", () => {
    forceFirstTrump({ rank: 5, color: "giants" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    const player = engine.currentPlayerId;

    engine.playDefaultMove();

    expect(engine.currentRound.forecasts).toEqual([{ playerId: player, bid: 0 }]);
  });

  it("avoids the illegal last forecast", () => {
    forceFirstTrump({ rank: 5, color: "giants" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    engine.setForecast(engine.currentPlayerId, 1);
    engine.setForecast(engine.currentPlayerId, 0);
    const last = engine.currentPlayerId;

    engine.playDefaultMove();

    expect(engine.currentRound.forecasts[2]).toEqual({ playerId: last, bid: 1 });
  });

  it("follows the trick color", () => {
    forceFirstTrump({ rank: 5, color: "giants" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    for (let i = 0; i < 3; i++) engine.playDefaultMove();

    const leader = engine.players[engine.currentTurn];
    const follower = engine.players[(engine.currentTurn + 1) % 3];
    leader.hand = [{ rank: 2, color: "elves" }];
    follower.hand = [{ rank: 9, color: "dwarves" }, { rank: 3, color: "elves" }];
    engine.playCard(leader.id, leader.hand[0]);

    engine.playDefaultMove();

    expect(engine.currentRound.tricks[0].plays[1].card).toEqual({ rank: 3, color: "elves" });
  });

  it("refuses to move after the game is over", () => {
    const engine = new GameEngine(makePlayers(3));
    while (engine.currentPlayerId) engine.playDefaultMove();

    expect(engine.currentPlayerId).toBeNull();
    expect(() => engine.playDefaultMove()).toThrow("Game is over");
  });
});
