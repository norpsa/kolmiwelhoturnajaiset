import { mkdtempSync, readFileSync, rmSync } from "fs";
import { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { GameResult, LeaderboardRow, ResultStore } from "../result-store";
import { GameState, GameStateAction } from "../wizard/types";
import { playLegally } from "./legal-move";

const NEVER = 60000;

const game = (scores: Record<string, number>, gameId = "g"): GameResult => ({
  gameId,
  finishedAt: "2026-11-01T00:00:00.000Z",
  players: Object.entries(scores).map(([name, score]) => ({ botId: `id-${name}`, name, score })),
});

const row = (store: ResultStore, name: string) => store.leaderboard().find(r => r.name === name)!;

describe("ResultStore", () => {
  it("is empty without results", () => {
    expect(new ResultStore().leaderboard()).toEqual([]);
  });

  it("counts opponents beaten as performance", () => {
    const store = new ResultStore();
    store.record(game({ a: 30, b: 20, c: 10 }));

    expect(row(store, "a").performance).toBe(1);
    expect(row(store, "b").performance).toBe(0.5);
    expect(row(store, "c").performance).toBe(0);
  });

  it("counts a tie as half an opponent beaten", () => {
    const store = new ResultStore();
    store.record(game({ a: 30, b: 30, c: 10 }));

    expect(row(store, "a").performance).toBe(0.75);
    expect(row(store, "c").performance).toBe(0);
  });

  it("gives a win to everyone tied for the top score", () => {
    const store = new ResultStore();
    store.record(game({ a: 30, b: 30, c: 10 }));

    expect(row(store, "a").wins).toBe(1);
    expect(row(store, "b").wins).toBe(1);
    expect(row(store, "c").wins).toBe(0);
  });

  it("averages over games", () => {
    const store = new ResultStore();
    store.record(game({ a: 30, b: 20, c: 10 }));
    store.record(game({ a: 0, b: 20, c: 40 }));

    expect(row(store, "a")).toMatchObject({ games: 2, wins: 1, performance: 0.5, averageScore: 15 });
  });

  it("compares different table sizes by performance, not by score", () => {
    const store = new ResultStore();
    store.record(game({ big: 300, x: 500, y: 400 }));
    store.record(game({ small: 40, z: 30, w: 20 }));

    expect(store.leaderboard()[0].name).toBe("small");
    expect(row(store, "big").rank).toBeGreaterThan(row(store, "small").rank);
  });

  it("ranks equal performance by number of games, then by name", () => {
    const store = new ResultStore();
    store.record(game({ b: 20, a: 20, c: 20 }));
    store.record(game({ c: 20, d: 20, e: 20 }));

    expect(store.leaderboard().map(r => r.name)).toEqual(["c", "a", "b", "d", "e"]);
    expect(store.leaderboard().map(r => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  describe("with a file", () => {
    let directory: string;
    let file: string;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "results-"));
      file = join(directory, "nested", "results.jsonl");
    });

    afterEach(() => {
      rmSync(directory, { recursive: true });
    });

    it("keeps results over a restart", () => {
      const before = new ResultStore(file);
      before.record(game({ a: 30, b: 20, c: 10 }, "first"));
      before.record(game({ a: 30, b: 20, c: 10 }, "second"));

      expect(new ResultStore(file).leaderboard()).toEqual(before.leaderboard());
      expect(row(new ResultStore(file), "a").games).toBe(2);
    });

    it("adds to results from before a restart", () => {
      new ResultStore(file).record(game({ a: 30, b: 20, c: 10 }));
      new ResultStore(file).record(game({ a: 30, b: 20, c: 10 }));

      expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    });
  });
});

describe("games that a bot didn't finish", () => {
  const unfinished = (scores: Record<string, number>, ...names: string[]): GameResult => ({
    ...game(scores),
    didNotFinish: names.map(name => `id-${name}`),
  });

  it("don't count for the bot that left", () => {
    const store = new ResultStore();
    store.record(game({ a: 30, b: 20, c: 10 }));
    store.record(unfinished({ a: 500, b: 0, c: 0 }, "a"));

    expect(row(store, "a")).toMatchObject({ games: 1, wins: 1, averageScore: 30 });
  });

  it("count for the bots that finished", () => {
    const store = new ResultStore();
    store.record(game({ a: 30, b: 20, c: 10 }));
    store.record(unfinished({ a: 500, b: 40, c: 20 }, "a"));

    expect(row(store, "b")).toMatchObject({ games: 2, wins: 1, averageScore: 30 });
    expect(row(store, "c")).toMatchObject({ games: 2, wins: 0, averageScore: 15 });
  });

  it("compare the bots that finished only with each other", () => {
    const store = new ResultStore();
    store.record(unfinished({ a: 500, b: 30, c: 20, d: 10 }, "a"));

    expect(row(store, "b")).toMatchObject({ wins: 1, performance: 1 });
    expect(row(store, "c")).toMatchObject({ wins: 0, performance: 0.5 });
    expect(row(store, "d")).toMatchObject({ wins: 0, performance: 0 });
  });

  it("leave a bot out if it has no other games", () => {
    const store = new ResultStore();
    store.record(unfinished({ a: 30, b: 20, d: 10 }, "d"));

    expect(store.leaderboard().map(r => r.name)).toEqual(["a", "b"]);
  });

  it("don't count for a bot with nobody left to beat", () => {
    const store = new ResultStore();
    store.record(unfinished({ a: 30, b: 20, c: 10 }, "a", "b"));

    expect(store.leaderboard()).toEqual([]);
  });

  it("don't count for anyone if everyone left", () => {
    const store = new ResultStore();
    store.record(unfinished({ a: 30, b: 20, c: 10 }, "a", "b", "c"));

    expect(store.leaderboard()).toEqual([]);
  });

  it("are still listed", () => {
    const store = new ResultStore();
    store.record(unfinished({ a: 30, b: 20, c: 10 }, "a"));

    expect(store.games({ limit: 10, offset: 0 }).total).toBe(1);
    expect(store.find("g")).toBeDefined();
  });

  it("count if everyone finished", () => {
    const store = new ResultStore();
    store.record({ ...game({ a: 30, b: 20, c: 10 }), didNotFinish: [] });

    expect(row(store, "a").games).toBe(1);
  });

  it("stay left out after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "results-"));
    try {
      const file = join(dir, "results.jsonl");
      new ResultStore(file).record(unfinished({ a: 30, b: 20, c: 10 }, "a"));

      expect(new ResultStore(file).leaderboard().map(r => r.name)).toEqual(["b", "c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("recording games", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let port: number;
  let clients: Socket[];
  let tokens: Record<string, string>;

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const startServer = async (options: Parameters<typeof createGameServer>[0]) => {
    gameServer = createGameServer({ extraTimeMs: 0, ...options });
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    port = (gameServer.server.address() as AddressInfo).port;
  };

  const leaderboard = async (): Promise<LeaderboardRow[]> =>
    (await fetch(`http://localhost:${port}/api/leaderboard`)).json();

  const connectBots = async (names: string[]) => {
    const bots = names.map(() =>
      connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false })
    );
    clients.push(...bots);
    await Promise.all(bots.map(b => nextEvent(b, "connect")));

    for (const [i, bot] of bots.entries()) {
      const registered = nextEvent<{ token: string }>(bot, GameStateAction.Registered);
      bot.emit(GameStateAction.Register, { name: names[i] });
      tokens[names[i]] = (await registered).token;
    }
    return bots;
  };

  const gameOver = (socket: Socket) =>
    new Promise<GameState>(resolve => {
      socket.on(GameStateAction.State, (state: GameState) => {
        if (state.gameOver) resolve(state);
      });
    });

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clients = [];
    tokens = {};
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  it("has an empty leaderboard before any game", async () => {
    await startServer({});

    expect(await leaderboard()).toEqual([]);
  });

  it("records a finished game with the final scores", async () => {
    const resultStore = new ResultStore();
    const record = vi.spyOn(resultStore, "record");
    await startServer({ turnTimeoutMs: 1, resultStore });
    const bots = await connectBots(["a", "b", "c"]);

    const final = gameOver(bots[0]);
    bots[0].emit(GameStateAction.StartGame);
    const { scores, players } = await final;

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].players).toEqual(
      players.map(p => ({ botId: p.id, name: p.name, score: scores[p.id] }))
    );
  }, 15000);

  it("shows finished games on the leaderboard without tokens", async () => {
    await startServer({ turnTimeoutMs: NEVER });
    const names = ["a", "b", "c"];
    const bots = await connectBots(names);
    bots.forEach((bot, i) => playLegally(bot, names[i]));

    const final = gameOver(bots[0]);
    bots[0].emit(GameStateAction.StartGame);
    await final;

    const rows = await leaderboard();
    expect(rows.map(r => r.name).sort()).toEqual(["a", "b", "c"]);
    expect(rows.every(r => r.games === 1)).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["averageScore", "botId", "games", "name", "performance", "rank", "wins"].sort()
    );
  }, 15000);

  it("doesn't record a game that is still running", async () => {
    await startServer({ turnTimeoutMs: NEVER });
    const bots = await connectBots(["a", "b", "c"]);

    const started = nextEvent(bots[0], GameStateAction.State);
    bots[0].emit(GameStateAction.StartGame);
    await started;

    expect(await leaderboard()).toEqual([]);
  });

  it("plays out and records a game that everyone has left, without ranking it", async () => {
    const resultStore = new ResultStore();
    await startServer({ turnTimeoutMs: NEVER, resultStore });
    const bots = await connectBots(["a", "b", "c"]);
    const started = nextEvent(bots[0], GameStateAction.State);
    bots[0].emit(GameStateAction.StartGame);
    await started;

    bots.forEach(b => b.close());
    await vi.waitFor(() => expect(gameServer.tables.size).toBe(0), { interval: 5 });

    const [game] = resultStore.games({ limit: 1, offset: 0 }).games;
    expect(game.didNotFinish).toHaveLength(3);
    expect(await leaderboard()).toEqual([]);
  });

  describe("bots that don't play to the end", () => {
    const NAMES = ["a", "b", "c"];

    const finishedGame = async (resultStore: ResultStore) => {
      await vi.waitFor(() => expect(resultStore.games({ limit: 1, offset: 0 }).total).toBe(1), { timeout: 10000 });
      return resultStore.games({ limit: 1, offset: 0 }).games[0];
    };

    const idOf = (game: GameResult, name: string) => game.players.find(p => p.name === name)!.botId;

    const rankedNames = async () => (await leaderboard()).map(r => r.name).sort();

    it("leaves out only the bot that left", async () => {
      const resultStore = new ResultStore();
      await startServer({ turnTimeoutMs: NEVER, resultStore });
      const bots = await connectBots(NAMES);
      playLegally(bots[1], "b");
      playLegally(bots[2], "c");

      const started = nextEvent(bots[0], GameStateAction.State);
      bots[0].emit(GameStateAction.StartGame);
      await started;
      bots[0].close();

      const game = await finishedGame(resultStore);
      expect(game.didNotFinish).toEqual([idOf(game, "a")]);
      expect(await rankedNames()).toEqual(["b", "c"]);
    }, 15000);

    it("leaves out only the bot that stopped answering", async () => {
      const resultStore = new ResultStore();
      await startServer({ turnTimeoutMs: 2, resultStore });
      const bots = await connectBots(NAMES);
      playLegally(bots[1], "b");
      playLegally(bots[2], "c");

      bots[0].emit(GameStateAction.StartGame);

      const game = await finishedGame(resultStore);
      expect(game.didNotFinish).toEqual([idOf(game, "a")]);
      expect(await rankedNames()).toEqual(["b", "c"]);
    }, 15000);

    it("counts a game where a bot missed a move and carried on", async () => {
      const resultStore = new ResultStore();
      await startServer({ turnTimeoutMs: 20, resultStore });
      const bots = await connectBots(NAMES);
      let missed = false;
      playLegally(bots[0], "a", () => !missed && (missed = true));
      playLegally(bots[1], "b");
      playLegally(bots[2], "c");

      bots[0].emit(GameStateAction.StartGame);

      const game = await finishedGame(resultStore);
      expect(missed).toBe(true);
      expect(game.didNotFinish).toEqual([]);
      expect((await leaderboard()).map(r => r.games)).toEqual([1, 1, 1]);
    }, 15000);

    it("counts a game that a bot came back to", async () => {
      const resultStore = new ResultStore();
      await startServer({ turnTimeoutMs: NEVER, extraTimeMs: NEVER, resultStore });
      const bots = await connectBots(NAMES);
      playLegally(bots[1], "b");
      playLegally(bots[2], "c");

      const started = nextEvent(bots[0], GameStateAction.State);
      bots[0].emit(GameStateAction.StartGame);
      await started;
      bots[0].close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(2), { interval: 5 });

      const back = connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false });
      clients.push(back);
      await nextEvent(back, "connect");
      playLegally(back, "a");
      back.emit(GameStateAction.Register, { name: "a", token: tokens.a });

      const game = await finishedGame(resultStore);
      expect(game.didNotFinish).toEqual([]);
      expect((await leaderboard()).map(r => r.games)).toEqual([1, 1, 1]);
    }, 15000);
  });

  it("doesn't record a table that never started", async () => {
    await startServer({});
    const bots = await connectBots(["a", "b"]);

    bots.forEach(b => b.close());
    await vi.waitFor(() => expect(gameServer.tables.size).toBe(0), { interval: 5 });

    expect(await leaderboard()).toEqual([]);
  });

  it("stays up when saving a result fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resultStore = new ResultStore();
    vi.spyOn(resultStore, "record").mockImplementation(() => {
      throw new Error("Disk is full");
    });
    await startServer({ turnTimeoutMs: 1, resultStore });
    const bots = await connectBots(["a", "b", "c"]);

    const final = gameOver(bots[0]);
    bots[0].emit(GameStateAction.StartGame);
    await final;

    expect(gameServer.tables.size).toBe(0);
    expect(await leaderboard()).toEqual([]);
  }, 15000);

  it("runs a series when bots keep registering", async () => {
    await startServer({ turnTimeoutMs: NEVER, lobbyWaitMs: 1 });
    const names = ["a", "b", "c", "d"];
    const bots = await connectBots(names);
    bots.forEach((bot, i) => playLegally(bot, names[i]));
    const GAMES = 3;

    const finished = bots.map(
      bot =>
        new Promise<void>(resolve => {
          let games = 0;
          bot.on(GameStateAction.State, (state: GameState) => {
            if (!state.gameOver) return;
            if (++games === GAMES) resolve();
            else bot.emit(GameStateAction.Register, {});
          });
        })
    );
    await Promise.all(finished);

    await vi.waitFor(async () => {
      expect((await leaderboard()).map(r => r.games)).toEqual([GAMES, GAMES, GAMES, GAMES]);
    });
  }, 15000);

  describe("lobby", () => {
    const started = (bot: Socket) => {
      const onStarted = vi.fn();
      bot.on(GameStateAction.GameStarted, onStarted);
      return onStarted;
    };

    it("starts a table with enough players after the wait", async () => {
      await startServer({ lobbyWaitMs: 20, turnTimeoutMs: NEVER });
      const [first] = await connectBots(["a", "b", "c"]);
      const onStarted = started(first);
      const game = nextEvent(first, GameStateAction.GameStarted);

      await connectBots(["d"]);
      await game;

      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    it("doesn't start three bots by itself", async () => {
      await startServer({ lobbyWaitMs: 10 });
      const [bot] = await connectBots(["a", "b", "c"]);
      const onStarted = started(bot);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onStarted).not.toHaveBeenCalled();
    });

    it("still lets three bots start with startGame", async () => {
      await startServer({ turnTimeoutMs: NEVER });
      const [bot] = await connectBots(["a", "b", "c"]);

      const game = nextEvent(bot, GameStateAction.GameStarted);
      bot.emit(GameStateAction.StartGame);

      await game;
    });

    it("waits so that more bots can join", async () => {
      await startServer({ lobbyWaitMs: 150, turnTimeoutMs: NEVER });
      const bots = await connectBots(["a", "b", "c", "d"]);
      const game = nextEvent(bots[0], GameStateAction.State);

      await connectBots(["e"]);

      expect((await game as GameState).players).toHaveLength(5);
    });

    it("stops the wait when too few players are left", async () => {
      await startServer({ lobbyWaitMs: 60 });
      const bots = await connectBots(["a", "b", "c", "d"]);
      const onStarted = started(bots[0]);

      bots[3].close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(3), { interval: 5 });
      await new Promise(resolve => setTimeout(resolve, 120));

      expect(onStarted).not.toHaveBeenCalled();
    });

    it("starts again when the table refills", async () => {
      await startServer({ lobbyWaitMs: 30, turnTimeoutMs: NEVER });
      const bots = await connectBots(["a", "b", "c", "d"]);
      const onStarted = started(bots[0]);
      bots[3].close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(3), { interval: 5 });

      const game = nextEvent(bots[0], GameStateAction.GameStarted);
      await connectBots(["e"]);
      await game;

      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    it("doesn't start twice after a manual start", async () => {
      await startServer({ lobbyWaitMs: 30, turnTimeoutMs: NEVER });
      const bots = await connectBots(["a", "b", "c", "d"]);
      const onStarted = started(bots[0]);

      const game = nextEvent(bots[0], GameStateAction.GameStarted);
      bots[0].emit(GameStateAction.StartGame);
      await game;
      await new Promise(resolve => setTimeout(resolve, 70));

      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    it("starts a full table at once", async () => {
      await startServer({ lobbyWaitMs: NEVER, turnTimeoutMs: NEVER });
      const bots = await connectBots(["a", "b", "c", "d", "e"]);
      const game = nextEvent(bots[0], GameStateAction.GameStarted);

      await connectBots(["f"]);

      await game;
    });
  });
});
