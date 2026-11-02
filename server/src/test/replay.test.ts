import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { ReplayStore } from "../replay-store";
import { ResultStore } from "../result-store";
import { Deck } from "../wizard/deck";
import { GameEngine } from "../wizard/game-engine";
import { Card, GamePlayAction, GameReplay, GameStateAction, RegisteredPlayer, ReplayEvent } from "../wizard/types";

const NEVER = 60000;

const seats = (count: number): RegisteredPlayer[] =>
  Array.from({ length: count }, (_, i) => ({ id: `id${i}`, name: `bot${i}` }));

const byType = <T extends ReplayEvent["type"]>(replay: GameReplay, type: T) =>
  replay.events.filter(event => event.type === type) as Extract<ReplayEvent, { type: T }>[];

const sortCards = (cards: Card[]) => cards.map(card => `${card.rank}${card.color ?? ""}`).sort();

// Bots move for themselves, and every fifth move is left for the server to make
const playGame = (players: RegisteredPlayer[]) => {
  const engine = new GameEngine(players);
  let moves = 0;
  let autoMoves = 0;

  const firstAccepted = <T>(options: T[], move: (option: T) => void) => {
    for (const option of options) {
      try {
        move(option);
        return;
      } catch {
        // Illegal, so try the next one
      }
    }
    throw new Error("No legal move");
  };

  for (let id = engine.currentPlayerId; id; id = engine.currentPlayerId) {
    const state = engine.getState(id);
    if (++moves % 5 === 0) {
      engine.playDefaultMove();
      autoMoves++;
    } else if (state.nextAction!.action === GamePlayAction.SelectTrump) {
      engine.setTrump(id, "elves");
    } else if (state.nextAction!.action === GamePlayAction.SetForecast) {
      firstAccepted([1, 0], bid => engine.setForecast(id, bid));
    } else {
      firstAccepted([...state.currentHand], card => engine.playCard(id, card));
    }
  }
  return { engine, replay: JSON.parse(JSON.stringify(engine.getReplay())) as GameReplay, moves, autoMoves };
};

describe("game log", () => {
  describe.each([3, 4, 5, 6])("of a game of %i players", count => {
    const players = seats(count);
    const { engine, replay, moves, autoMoves } = playGame(players);
    const totalRounds = 60 / count;

    it("names the players", () => {
      expect(replay.players).toEqual(players);
    });

    it("has every round, deal and move", () => {
      expect(byType(replay, "roundStart").map(r => r.roundNumber)).toEqual(
        Array.from({ length: totalRounds }, (_, i) => i + 1)
      );
      expect(byType(replay, "roundEnd")).toHaveLength(totalRounds);
      expect(byType(replay, "trickEnd")).toHaveLength((totalRounds * (totalRounds + 1)) / 2);

      const logged = byType(replay, "selectTrump").length + byType(replay, "bid").length + byType(replay, "play").length;
      expect(logged).toBe(moves);
    });

    it("deals the cards that get played", () => {
      let dealt: Record<string, Card[]> = {};
      let played: Record<string, Card[]> = {};

      for (const event of replay.events) {
        if (event.type === "roundStart") {
          dealt = event.hands;
          played = Object.fromEntries(players.map(p => [p.id, []]));
          players.forEach(p => expect(dealt[p.id]).toHaveLength(event.roundNumber));
        } else if (event.type === "play") {
          played[event.playerId].push(event.card);
        } else if (event.type === "roundEnd") {
          players.forEach(p => expect(sortCards(played[p.id])).toEqual(sortCards(dealt[p.id])));
        }
      }
    });

    it("ends with the final scores", () => {
      const last = byType(replay, "roundEnd").at(-1)!;
      expect(last.scores).toEqual(engine.getState(players[0].id).scores);
    });

    it("keeps the scores of each round", () => {
      const rounds = byType(replay, "roundEnd");
      expect(new Set(rounds.map(r => JSON.stringify(r.scores))).size).toBeGreaterThan(1);
      rounds.forEach((round, i) => {
        expect(Object.values(round.tricksWon).reduce((sum, tricks) => sum + tricks, 0)).toBe(i + 1);
      });
    });

    it("marks only the moves made by the server", () => {
      const madeMoves = [...byType(replay, "selectTrump"), ...byType(replay, "bid"), ...byType(replay, "play")];
      expect(madeMoves.filter(move => move.auto)).toHaveLength(autoMoves);
    });
  });

  describe("bots that didn't finish", () => {
    // Unshuffled, the first deal and the trump card are all Jesters, so the bots start by bidding
    const newEngine = () => {
      vi.spyOn(Deck.prototype, "shuffle").mockImplementationOnce(() => {});
      return new GameEngine(seats(3));
    };

    const ownBid = (engine: GameEngine) => engine.setForecast(engine.currentPlayerId!, 1);

    it("has none when everyone made their own moves", () => {
      const engine = newEngine();
      ownBid(engine);
      ownBid(engine);
      ownBid(engine);
      expect(engine.getBotsThatDidNotFinish()).toEqual([]);
    });

    it("finds a bot whose last move the server made", () => {
      const engine = newEngine();
      const dropped = engine.currentPlayerId!;
      engine.playDefaultMove();
      ownBid(engine);
      ownBid(engine);
      expect(engine.getBotsThatDidNotFinish()).toEqual([dropped]);
    });

    it("forgives a move missed earlier", () => {
      const engine = newEngine();
      const players = [0, 1, 2].map(() => {
        const id = engine.currentPlayerId!;
        engine.playDefaultMove();
        return id;
      });
      expect(engine.getBotsThatDidNotFinish().sort()).toEqual([...players].sort());

      const id = engine.currentPlayerId!;
      engine.playCard(id, engine.getState(id).currentHand[0]);
      expect(engine.getBotsThatDidNotFinish()).not.toContain(id);
      expect(engine.getBotsThatDidNotFinish()).toHaveLength(2);
    });
  });

  it("logs the trump a dealer chooses after a Wizard", () => {
    // The deck ends with Wizards and then Jesters, so this makes the trump card a Wizard
    vi.spyOn(Deck.prototype, "shuffle").mockImplementationOnce(function (this: Deck) {
      const last = this.cards.length - 1;
      [this.cards[last - 3], this.cards[last - 4]] = [this.cards[last - 4], this.cards[last - 3]];
    });

    const engine = new GameEngine(seats(3));
    const dealer = engine.currentPlayerId!;
    engine.setTrump(dealer, "giants");

    const [roundStart, selectTrump] = engine.getReplay().events;
    expect(roundStart).toMatchObject({ type: "roundStart", trump: { rank: "Z" }, trumpColor: null });
    expect(selectTrump).toEqual({ type: "selectTrump", playerId: dealer, color: "giants", auto: false });
  });

  it("doesn't log rejected moves", () => {
    const engine = new GameEngine(seats(3));
    const before = engine.getReplay().events.length;

    expect(() => engine.setForecast(engine.currentPlayerId!, 99)).toThrow();

    expect(engine.getReplay().events).toHaveLength(before);
  });

  it("goes back to normal moves after a failed default move", () => {
    const { engine } = playGame(seats(3));
    expect(() => engine.playDefaultMove()).toThrow("Game is over");
    expect((engine as any).isAutoMove).toBe(false);
  });
});

describe("ReplayStore", () => {
  const replay: GameReplay = { players: seats(1), events: [] };
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "replays-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps replays in memory with no directory", () => {
    const store = new ReplayStore();
    store.save("g", replay);
    expect(store.load("g")).toEqual(replay);
  });

  it("has no replay for an unknown game", () => {
    expect(new ReplayStore().load("g")).toBeNull();
    expect(new ReplayStore(dir).load("g")).toBeNull();
  });

  it("survives a restart", () => {
    new ReplayStore(dir).save("g", replay);
    expect(new ReplayStore(dir).load("g")).toEqual(replay);
  });

  it("creates its directory", () => {
    const nested = join(dir, "a", "b");
    new ReplayStore(nested).save("g", replay);
    expect(new ReplayStore(nested).load("g")).toEqual(replay);
  });

  it("treats a broken file as no replay", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(join(dir, "g.json"), "{");

    expect(new ReplayStore(dir).load("g")).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("throws when saving fails", () => {
    const file = join(dir, "file");
    writeFileSync(file, "");
    expect(() => new ReplayStore(file).save("g", replay)).toThrow();
  });
});

describe("games api", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let port: number;
  let clients: Socket[];
  let dir: string;

  const startServer = async (options: Parameters<typeof createGameServer>[0] = {}) => {
    gameServer = createGameServer({ extraTimeMs: 0, turnTimeoutMs: NEVER, webDir: join(dir, "no-web"), ...options });
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    port = (gameServer.server.address() as AddressInfo).port;
  };

  const get = (path: string) => fetch(`http://localhost:${port}${path}`);
  const getJson = async (path: string) => (await get(path)).json();

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  // Seats 3 bots at a table that starts by itself
  const startGame = async () => {
    const bots = ["a", "b", "c"].map(() =>
      connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false })
    );
    clients.push(...bots);
    await Promise.all(bots.map(b => nextEvent(b, "connect")));

    const registered: { gameId: string; token: string }[] = [];
    for (const [i, bot] of bots.entries()) {
      const next = nextEvent<{ gameId: string; token: string }>(bot, GameStateAction.Registered);
      bot.emit(GameStateAction.Register, { name: "abc"[i], playerCount: 3 });
      registered.push(await next);
    }
    return { bots, gameId: registered[0].gameId, tokens: registered.map(r => r.token) };
  };

  // The server plays out a game that everyone has left
  const finishGame = async () => {
    const { bots, gameId, tokens } = await startGame();
    bots.forEach(bot => bot.disconnect());
    await vi.waitFor(async () => expect((await getJson("/api/games")).total).toBeGreaterThan(0));
    return { gameId, tokens };
  };

  const recorded = (gameId: string, ...names: string[]) => ({
    gameId,
    finishedAt: "2026-11-01T00:00:00.000Z",
    players: names.map(name => ({ botId: `id-${name}`, name, score: 10 })),
  });

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clients = [];
    dir = mkdtempSync(join(tmpdir(), "games-api-"));
  });

  afterEach(async () => {
    clients.forEach(c => c.disconnect());
    await new Promise(resolve => gameServer.io.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("has no games at first", async () => {
    await startServer();
    expect(await getJson("/api/games")).toEqual({ total: 0, games: [] });
  });

  it("serves the replay of a finished game", async () => {
    await startServer();
    const { gameId } = await finishGame();

    const { result, replay } = await getJson(`/api/games/${gameId}`);

    expect(result.gameId).toBe(gameId);
    expect(replay.players.map((p: RegisteredPlayer) => p.name).sort()).toEqual(["a", "b", "c"]);
    const scores = byType(replay, "roundEnd").at(-1)!.scores;
    result.players.forEach((p: { botId: string; score: number }) => expect(scores[p.botId]).toBe(p.score));
  });

  it("marks the moves played for bots that left", async () => {
    await startServer();
    const { gameId } = await finishGame();

    const { replay } = await getJson(`/api/games/${gameId}`);

    expect(byType(replay, "play").every(play => play.auto)).toBe(true);
  });

  it("saves replays to the store it is given", async () => {
    const replayStore = new ReplayStore(join(dir, "replays"));
    await startServer({ replayStore });
    const { gameId } = await finishGame();

    expect(new ReplayStore(join(dir, "replays")).load(gameId)).not.toBeNull();
  });

  it("shows nothing of a running game", async () => {
    await startServer();
    const { gameId } = await startGame();

    expect(await getJson("/api/games")).toEqual({ total: 0, games: [] });
    expect(await getJson("/api/leaderboard")).toEqual([]);
    expect((await get(`/api/games/${gameId}`)).status).toBe(404);
  });

  it("doesn't show tokens", async () => {
    await startServer();
    const { gameId, tokens } = await finishGame();

    const responses = await Promise.all(
      ["/api/games", `/api/games/${gameId}`, "/api/leaderboard"].map(async path => (await get(path)).text())
    );

    expect(tokens.filter(Boolean)).toHaveLength(3);
    tokens.forEach(token => responses.forEach(text => expect(text).not.toContain(token)));
  });

  it("keeps the result when saving the replay fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const replayStore = new ReplayStore();
    vi.spyOn(replayStore, "save").mockImplementation(() => {
      throw new Error("disk full");
    });
    await startServer({ replayStore });

    const { gameId } = await finishGame();

    const { result, replay } = await getJson(`/api/games/${gameId}`);
    expect(result.gameId).toBe(gameId);
    expect(replay).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("shows a game with no replay", async () => {
    const resultStore = new ResultStore();
    resultStore.record(recorded("old", "a", "b", "c"));
    await startServer({ resultStore });

    const { result, replay } = await getJson("/api/games/old");

    expect(result.gameId).toBe("old");
    expect(replay).toBeNull();
  });

  describe("unknown games", () => {
    it.each(["nope", "..%2Fsecret", "..%2F..%2Fsecret", "%2e%2e%2Fsecret", "secret"])("doesn't find %s", async id => {
      const replays = join(dir, "replays");
      mkdirSync(replays);
      writeFileSync(join(dir, "secret.json"), '{"secret":true}');
      await startServer({ replayStore: new ReplayStore(replays) });

      const response = await get(`/api/games/${id}`);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("secret\":true");
    });
  });

  describe("listing", () => {
    const ids = async (query: string) =>
      (await getJson(`/api/games${query}`)).games.map((game: { gameId: string }) => game.gameId);

    const manyGames = (count: number) => {
      const resultStore = new ResultStore();
      for (let i = 0; i < count; i++) resultStore.record(recorded(`g${i}`, "a", "b", "c"));
      return resultStore;
    };

    it("puts the newest game first", async () => {
      await startServer({ resultStore: manyGames(3) });
      expect(await ids("")).toEqual(["g2", "g1", "g0"]);
    });

    it("doesn't change the order of the leaderboard's data", async () => {
      const resultStore = manyGames(3);
      await startServer({ resultStore });
      await ids("");
      expect(await ids("")).toEqual(["g2", "g1", "g0"]);
    });

    it("returns one page and the total", async () => {
      await startServer({ resultStore: manyGames(5) });

      const { total, games } = await getJson("/api/games?limit=2&offset=1");

      expect(total).toBe(5);
      expect(games.map((game: { gameId: string }) => game.gameId)).toEqual(["g3", "g2"]);
    });

    it("returns an empty page past the end", async () => {
      await startServer({ resultStore: manyGames(2) });
      expect(await ids("?offset=5")).toEqual([]);
    });

    it("limits the page size", async () => {
      await startServer({ resultStore: manyGames(120) });
      expect(await ids("")).toHaveLength(50);
      expect(await ids("?limit=1000")).toHaveLength(100);
    });

    it.each(["limit=0", "limit=-1", "limit=abc", "limit=1.5", "limit=", "offset=-1", "offset=abc", "limit=1&limit=2"])(
      "uses the defaults for %s",
      async query => {
        await startServer({ resultStore: manyGames(3) });
        expect(await ids(`?${query}`)).toEqual(["g2", "g1", "g0"]);
      }
    );

    it("filters by bot and counts only those games", async () => {
      const resultStore = new ResultStore();
      resultStore.record(recorded("g0", "a", "b", "c"));
      resultStore.record(recorded("g1", "b", "c", "d"));
      resultStore.record(recorded("g2", "a", "c", "d"));
      await startServer({ resultStore });

      const { total, games } = await getJson("/api/games?botId=id-a");

      expect(total).toBe(2);
      expect(games.map((game: { gameId: string }) => game.gameId)).toEqual(["g2", "g0"]);
    });
  });

  describe("web pages", () => {
    const startWithPages = async () => {
      const webDir = join(dir, "web");
      mkdirSync(webDir);
      writeFileSync(join(webDir, "index.html"), "<title>page</title>");
      writeFileSync(join(webDir, "app.js"), "// script");
      await startServer({ webDir });
    };

    it.each(["/", "/leaderboard", "/games/some-id"])("serves the page at %s", async path => {
      await startWithPages();
      expect(await (await get(path)).text()).toContain("<title>page</title>");
    });

    it("serves files of the page", async () => {
      await startWithPages();
      expect(await (await get("/app.js")).text()).toContain("// script");
    });

    it("doesn't answer unknown api routes with the page", async () => {
      await startWithPages();
      const response = await get("/api/nope");
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    });

    it("still answers the api", async () => {
      await startWithPages();
      expect(await getJson("/api/leaderboard")).toEqual([]);
    });

    it("works without a built web ui", async () => {
      await startServer();
      expect((await get("/")).status).toBe(404);
      expect(await getJson("/api/leaderboard")).toEqual([]);
    });
  });
});
