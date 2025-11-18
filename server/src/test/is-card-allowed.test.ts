import { describe, it, expect, beforeEach } from "vitest";
import { GameEngine } from "../wizard/game-engine";

describe("GameEngine.isCardAllowed", () => {
  let engine: any;

  beforeEach(() => {
    engine = new GameEngine([{id: "p1", name: "p1" }, {id: "p2", name: "p2" }, {id: "p2", name: "p2" }]);
  });


  it("Card that is trickColor is allowed", () => {
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], 'humans', hand)).toBe(true);
  });

  it("Card that is not trickColor is allowed if no trickColor in hand", () => {
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], 'giants', hand)).toBe(true);
  });

  it("Card that is not trickColor is not allowed if trickColor in hand", () => {
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], 'elves', hand)).toBe(false);
  });

  it("Z is allowed even if trickColor in hand", () => {
    const card = { rank: 'Z' };
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}, { rank: 'Z'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[2], 'elves', hand)).toBe(true);
  });

  it("N is allowed even if trickColor in hand", () => {
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}, { rank: 'N'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[2], 'elves', hand)).toBe(true);
  });

  it("If trickColor is null, all cards are allowed", () => {
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], null, hand)).toBe(true);
    expect((engine as any).isCardAllowedToBePlayed(hand[1], null, hand)).toBe(true);

  });

  it("If trickColor is undefined, all cards are allowed", () => {
    const hand = [{ rank: 1, color: 'humans'}, { rank: 1, color: 'elves'}];

    expect((engine as any).isCardAllowedToBePlayed(hand[0], undefined, hand)).toBe(true);
    expect((engine as any).isCardAllowedToBePlayed(hand[1], undefined, hand)).toBe(true);

  });

});
