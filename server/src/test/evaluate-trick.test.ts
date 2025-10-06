import { describe, it, expect } from "vitest";
import { Trick } from "../wizard/types";
import { GameEngine } from "../wizard/game-engine";

describe("evaluateTrick", () => {
  it("Zeppo instantly wins", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 10, color: "humans" } },
        { playerId: "p2", card: { rank: "Z" } },
        { playerId: "p3", card: { rank: 12, color: "giants" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "humans")).toBe("p2");
  });

    it("First zeppo wins", () => {
        const engine = new GameEngine(["p1", "p2", "p3"]);
        const trick: Trick = {
        trickColor: "humans",
        id: 1,
        plays: [
            { playerId: "p1", card: { rank: 10, color: "humans" } },
            { playerId: "p2", card: { rank: "Z" } },
            { playerId: "p3", card: { rank: "Z" } },
        ],
        };

        expect((engine as any).evaluateTrick(trick, "humans")).toBe("p2");
    });

  it("Highest of trick color wins when no trump", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 10, color: "humans" } },
        { playerId: "p2", card: { rank: 11, color: "humans" } },
        { playerId: "p3", card: { rank: 12, color: "giants" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "elves")).toBe("p2");
  });

  it("Trump beats higher non-trump", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 10, color: "humans" } },
        { playerId: "p2", card: { rank: 11, color: "humans" } },
        { playerId: "p3", card: { rank: 1, color: "elves" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "elves")).toBe("p3");
  });

  it("Higher trump beats lower trump and non trumps", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 10, color: "humans" } },
        { playerId: "p2", card: { rank: 1, color: "elves" } },
        { playerId: "p3", card: { rank: 11, color: "elves" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "elves")).toBe("p3");
  });

  it("Non-trick, non-trump card is ignored", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 10, color: "humans" } },
        { playerId: "p2", card: { rank: 13, color: "giants" } },
        { playerId: "p3", card: { rank: 1, color: "humans" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "elves")).toBe("p1");
  });

  it("First play wins if all others have no valid color", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 1, color: "humans" } },
        { playerId: "p2", card: { rank: 13, color: "giants" } },
        { playerId: "p3", card: { rank: 1, color: "giants" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "elves")).toBe("p1");
  });

  it("Biggest of color wins if no trump", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: "humans",
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 1, color: "humans" } },
        { playerId: "p2", card: { rank: 13, color: "giants" } },
        { playerId: "p3", card: { rank: 2, color: "humans" } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, null)).toBe("p3");
  });

  it("If everyone has N, first player wins", () => {
    const engine = new GameEngine(["p1", "p2", "p3"]);
    const trick: Trick = {
      trickColor: undefined,
      id: 1,
      plays: [
        { playerId: "p1", card: { rank: 'N' } },
        { playerId: "p2", card: { rank: 'N' } },
        { playerId: "p3", card: { rank: 'N' } },
      ],
    };

    expect((engine as any).evaluateTrick(trick, "elves")).toBe("p1");
  });
});
