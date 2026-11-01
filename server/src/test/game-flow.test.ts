import { afterEach, describe, it, expect, vi } from "vitest";
import { Deck } from "../wizard/deck";
import { GameEngine } from "../wizard/game-engine";
import { Card, GamePlayAction, Round } from "../wizard/types";

const makePlayers = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `name${i}` }));

// Makes `card` the trump of round 1 by placing it right below the dealt cards
const forceFirstTrump = (card: Card, playerCount: number) => {
  vi.spyOn(Deck.prototype, "shuffle").mockImplementationOnce(function (this: Deck) {
    this.cards[this.cards.length - 1 - playerCount] = card;
  });
};

const playLegalCard = (engine: any) => {
  const player = engine.players[engine.currentTurn];
  const hand = [...player.hand].sort(() => Math.random() - 0.5);
  for (const card of hand) {
    try {
      engine.playCard(player.id, card);
      return;
    } catch (e: any) {
      if (e.message !== "Must follow trick color") throw e;
    }
  }
  throw new Error("Player has no legal card");
};

const forecastLegally = (engine: any) => {
  const player = engine.players[engine.currentTurn];
  const bid = Math.floor(Math.random() * (engine.roundNumber + 1));
  try {
    engine.setForecast(player.id, bid);
  } catch {
    // Only the last forecast can be rejected, and any other value is then legal
    engine.setForecast(player.id, bid === 0 ? 1 : bid - 1);
  }
};

const playRound = (engine: any) => {
  const roundNumber = engine.roundNumber;
  while (engine.roundNumber === roundNumber) {
    if (engine.currentAction === GamePlayAction.SelectTrump) {
      engine.setTrump(engine.players[engine.currentTurn].id, "elves");
    } else if (engine.currentAction === GamePlayAction.SetForecast) {
      forecastLegally(engine);
    } else {
      playLegalCard(engine);
    }
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("game setup", () => {
  it.each([2, 7])("rejects %i players", count => {
    expect(() => new GameEngine(makePlayers(count))).toThrow("3-6 players");
  });

  it.each([
    [3, 20],
    [4, 15],
    [5, 12],
    [6, 10],
  ])("%i players play %i rounds", (count, rounds) => {
    const state = new GameEngine(makePlayers(count)).getState("p0");
    expect(state.totalRounds).toBe(rounds);
    expect(state.gameOver).toBe(false);
  });
});

describe("trump", () => {
  it("colored trump card sets trump color", () => {
    forceFirstTrump({ rank: 5, color: "giants" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    expect(engine.currentRound.trumpColor).toBe("giants");
    expect(engine.currentAction).toBe(GamePlayAction.SetForecast);
  });

  it("N as trump card means no trump and the round can be finished", () => {
    forceFirstTrump({ rank: "N" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    expect(engine.currentRound.trumpColor).toBeNull();
    expect(engine.currentAction).toBe(GamePlayAction.SetForecast);

    playRound(engine);
    expect(engine.roundNumber).toBe(2);
  });

  it("Z as trump card lets the dealer choose before forecasts", () => {
    forceFirstTrump({ rank: "Z" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    const { firstPlayerOfRoundIndex } = engine.currentRound;
    const dealer = engine.players[(firstPlayerOfRoundIndex + 2) % 3];

    expect(engine.currentAction).toBe(GamePlayAction.SelectTrump);
    expect(engine.players[engine.currentTurn]).toBe(dealer);
    expect(() => engine.setTrump(dealer.id, "purple")).toThrow("Invalid trump color");

    engine.setTrump(dealer.id, "dwarves");
    expect(engine.currentRound.trumpColor).toBe("dwarves");
    expect(engine.currentTurn).toBe(firstPlayerOfRoundIndex);
    expect(engine.currentAction).toBe(GamePlayAction.SetForecast);
  });

  it.each([3, 4, 5, 6])("last round with %i players has no trump", count => {
    const engine: any = new GameEngine(makePlayers(count));
    while (engine.roundNumber < engine.totalRounds) playRound(engine);

    expect(engine.currentRound.trump).toBeNull();
    expect(engine.currentRound.trumpColor).toBeNull();
    expect(engine.deck.cards).toHaveLength(0);
  });
});

describe("forecasts", () => {
  it.each([-1, 2, 0.5, NaN])("rejects bid %d in round 1", bid => {
    const engine: any = new GameEngine(makePlayers(3));
    if (engine.currentAction === GamePlayAction.SelectTrump) {
      engine.setTrump(engine.players[engine.currentTurn].id, "elves");
    }
    const player = engine.players[engine.currentTurn];
    expect(() => engine.setForecast(player.id, bid)).toThrow("Invalid forecast");
  });

  it("last player can't make forecasts add up to the number of tricks", () => {
    forceFirstTrump({ rank: 5, color: "giants" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    engine.setForecast(engine.players[engine.currentTurn].id, 0);
    engine.setForecast(engine.players[engine.currentTurn].id, 0);

    const last = engine.players[engine.currentTurn];
    expect(() => engine.setForecast(last.id, 1)).toThrow("Illegal forecast");
    engine.setForecast(last.id, 0);
    expect(engine.currentAction).toBe(GamePlayAction.PlayCard);
  });
});

describe("player round stats", () => {
  it("tracks tricks taken and resets stats for the next round", () => {
    forceFirstTrump({ rank: 5, color: "giants" }, 3);
    const engine: any = new GameEngine(makePlayers(3));
    playRound(engine);

    const reset = engine.getState("p0").players;
    expect(reset.every((p: any) => p.tricksTaken === 0 && p.tricksForecasted === null)).toBe(true);

    if (engine.currentAction === GamePlayAction.SelectTrump) {
      engine.setTrump(engine.players[engine.currentTurn].id, "elves");
    }
    forecastLegally(engine);
    forecastLegally(engine);
    forecastLegally(engine);
    playLegalCard(engine);
    playLegalCard(engine);
    playLegalCard(engine);

    const players = engine.getState("p0").players;
    expect(players.reduce((sum: number, p: any) => sum + p.tricksTaken, 0)).toBe(1);
    expect(players.every((p: any) => p.tricksForecasted !== null)).toBe(true);
  });
});

describe("previous round", () => {
  it("is empty during the first round", () => {
    const engine = new GameEngine(makePlayers(3));

    expect(engine.getState("p0").previousRound).toBeNull();
  });

  it("shows the whole finished round, including its last trick", () => {
    const engine: any = new GameEngine(makePlayers(3));
    const finished = engine.currentRound;

    playRound(engine);

    const { round, previousRound } = engine.getState("p0");
    expect(round.roundNumber).toBe(2);
    expect(previousRound).toEqual(finished);
    expect(previousRound.roundNumber).toBe(1);
    expect(previousRound.forecasts).toHaveLength(3);
    expect(previousRound.tricks[0].plays).toHaveLength(3);
    expect(previousRound.tricks[0].winner).toBeDefined();
    expect(previousRound.tricksWon[previousRound.tricks[0].winner]).toBe(1);
  });

  it("always shows the round before the current one", () => {
    const engine: any = new GameEngine(makePlayers(4));

    for (let finished = 1; finished < engine.totalRounds; finished++) {
      playRound(engine);
      const { round, previousRound } = engine.getState("p0");
      expect(previousRound.roundNumber).toBe(finished);
      expect(previousRound.tricks).toHaveLength(finished);
      expect(previousRound.tricks[finished - 1].plays).toHaveLength(4);
      expect(round.roundNumber).toBe(finished + 1);
    }
  });

  it("shows the last round when the game is over", () => {
    const engine: any = new GameEngine(makePlayers(3));
    while (engine.roundNumber <= engine.totalRounds) playRound(engine);

    const { gameOver, previousRound } = engine.getState("p0");
    expect(gameOver).toBe(true);
    expect(previousRound.roundNumber).toBe(20);
    expect(previousRound.tricks[19].plays).toHaveLength(3);
  });
});

describe("full game", () => {
  it.each([3, 4, 5, 6])("%i players can play whole games by the rules", count => {
    for (let game = 0; game < 50; game++) {
      const engine: any = new GameEngine(makePlayers(count));
      const expectedScores: Record<string, number> = {};
      engine.players.forEach((p: any) => (expectedScores[p.id] = 0));

      for (let roundNumber = 1; roundNumber <= engine.totalRounds; roundNumber++) {
        expect(engine.roundNumber).toBe(roundNumber);
        engine.players.forEach((p: any) => expect(p.hand).toHaveLength(roundNumber));

        const round: Round = engine.currentRound;
        const dealtCards = roundNumber * count;
        const trumpCards = round.trump ? 1 : 0;
        expect(engine.deck.cards).toHaveLength(60 - dealtCards - trumpCards);

        playRound(engine);

        const sumOfBids = round.forecasts.reduce((sum, f) => sum + f.bid, 0);
        expect(sumOfBids).not.toBe(roundNumber);
        expect(Object.values(round.tricksWon).reduce((a, b) => a + b, 0)).toBe(roundNumber);
        expect(round.tricks).toHaveLength(roundNumber);

        for (const { playerId, bid } of round.forecasts) {
          const won = round.tricksWon[playerId];
          expectedScores[playerId] += bid === won ? 20 + bid * 10 : -Math.abs(bid - won) * 10;
        }
        expect(engine.scores).toEqual(expectedScores);
      }

      const state = engine.getState("p0");
      expect(state.gameOver).toBe(true);
      expect(state.nextAction).toBeNull();
      expect(() => engine.playCard(engine.players[engine.currentTurn].id, { rank: "Z" })).toThrow();
    }
  });
});
