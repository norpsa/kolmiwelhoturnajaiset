import { describe, it, expect } from "vitest";
import { GameEngine } from "../wizard/game-engine";

describe("GameEngine.isCardAllowed", () => {

  it("Card that is trickColor is allowed", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], 'humans', hand)).toBe(true);
  });

  it("Card that is not trickColor is allowed if no trickColor in hand", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], 'giants', hand)).toBe(true);
  });

  it("Card that is not trickColor is not allowed if trickColor in hand", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], 'elves', hand)).toBe(false);
  });

  it("Z is allowed even if trickColor in hand", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const card = { rank: 'Z' };
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}, { rank: 'Z'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[2], 'elves', hand)).toBe(true);
  });

  it("N is allowed even if trickColor in hand", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}, { rank: 'N'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[2], 'elves', hand)).toBe(true);
  });

  it("If trickColor is null, all cards are allowed", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], null, hand)).toBe(true);
    expect((engine as any).isCardAllowedToBePlayed(hand[1], null, hand)).toBe(true);

  });

  it("If trickColor is undefined, all cards are allowed", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);

    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], undefined, hand)).toBe(true);
    expect((engine as any).isCardAllowedToBePlayed(hand[1], undefined, hand)).toBe(true);

  });

});
