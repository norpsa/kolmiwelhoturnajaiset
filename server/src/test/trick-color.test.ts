import { beforeEach, describe, it, expect } from "vitest";
import { GameEngine } from "../wizard/game-engine";

describe("GameEngine.playCard - setting trickColor", () => {
  let engine: any;

  beforeEach(() => {
    engine = new GameEngine(["p1", "p2", "p3", "p4"]);

    engine.currentTurn = 0;

    // Mock a round structure
    engine.currentRound = {
      tricks: [],
      trumpColor: "humans",
      tricksWon: { p1: 0, p2: 0 },
      currentTrick: 0
    };

    engine.roundNumber = 1;
    engine.totalRounds = 1;
  });

  it("should set trickColor to card.color for the first play", () => {
    engine.players[0].hand = [{ rank: 10, color: "humans" }];
    engine.playCard("p1", { rank: 10, color: "humans" });
    const trick = engine.currentRound.tricks[0];
    expect(trick.trickColor).toBe("humans");
  });

  it("should not override trickColor on second play", () => {
    engine.players[0].hand = [{ rank: 10, color: "humans" }];
    engine.players[1].hand = [{ rank: 10, color: "giants" }];
    engine.playCard("p1", { rank: 10, color: "humans" });
    engine.playCard = engine.playCard.bind(engine); // ensure context;

    engine.playCard("p2", { rank: 10, color: "giants" });

    const trick = engine.currentRound.tricks[0]
    expect(trick.trickColor).toBe("humans"); // still the first card color
  });

  it("should set trickColor to null when first card is Zeppo", () => {
    engine.players[0].hand = [{ rank: 'Z'}];
    engine.players[1].hand = [{ rank: 10, color: 'humans'}];
    engine.playCard("p1", { rank: 'Z'});
    engine.playCard = engine.playCard.bind(engine); // ensure context;
    engine.playCard("p2", { rank: 10, color: 'humans'});
    const trick = engine.currentRound.tricks[0];
    expect(trick.trickColor).toBeNull();
  });

  it("should set trickColor to first non N when first card is N", () => {
    engine.players[0].hand = [{ rank: 'N'}];
    engine.players[1].hand = [{ rank: 'N'}];
    engine.players[2].hand = [{ rank: 10, color: 'humans'}];
    engine.playCard("p1", { rank: 'N'});
    engine.playCard = engine.playCard.bind(engine); // ensure context;
    engine.playCard("p2", { rank: 'N'});
    engine.playCard("p3", { rank: 10, color: 'humans'});
    const trick = engine.currentRound.tricks[0];
    expect(trick.trickColor).toBe('humans');
  });

});
