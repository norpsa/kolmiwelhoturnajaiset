import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { GameResult, ResultStore } from "../result-store";
import { drawTables, isValidSettings, placingPoints, standings, Tournament, TournamentStore } from "../tournament";
import { GameStateAction } from "../wizard/types";
import { playLegally } from "./legal-move";

const NEVER = 60000;
const KEY = "organiser-key";

const game = (scores: Record<string, number>, ...didNotFinish: string[]): GameResult => ({
  gameId: "g",
  finishedAt: "2026-11-01T00:00:00.000Z",
  players: Object.entries(scores).map(([botId, score]) => ({ botId, name: botId, score })),
  didNotFinish,
});

const points = (result: GameResult, tableSize = Object.keys(result.players).length) =>
  Object.fromEntries([...placingPoints(result, tableSize)].map(([id, placing]) => [id, placing.points]));

const tournamentOf = (ids: string[], tableSize: number, ...games: GameResult[]): Tournament => ({
  id: "t",
  name: "Cup",
  tableSize,
  rounds: games.length,
  status: "running",
  createdAt: "2026-11-01T00:00:00.000Z",
  entrants: ids.map(id => ({ id, name: id })),
  schedule: games.map(result => [{ id: result.gameId, players: [], result }]),
});

describe("placingPoints", () => {
  it.each([
    [3, [2, 1, 0]],
    [4, [3, 2, 1, 0]],
    [5, [4, 3, 2, 1, 0]],
    [6, [5, 4, 3, 2, 1, 0]],
  ])("spaces places evenly at a table of %i", (size, expected) => {
    const ids = expected.map((_, i) => `b${i}`);
    const result = game(Object.fromEntries(ids.map((id, i) => [id, 100 - i])));
    expect(ids.map(id => points(result, size)[id])).toEqual(expected);
  });

  it("uses the order of the scores, not their size", () => {
    expect(points(game({ a: 1000, b: 1, c: 0, d: -5 }))).toEqual(points(game({ a: 4, b: 3, c: 2, d: 1 })));
  });

  it("doesn't depend on the seating order", () => {
    expect(points(game({ c: 10, a: 30, d: 0, b: 20 }))).toEqual({ a: 3, b: 2, c: 1, d: 0 });
  });

  it("splits the points of a tie", () => {
    expect(points(game({ a: 30, b: 30, c: 20, d: 10 }))).toEqual({ a: 2.5, b: 2.5, c: 1, d: 0 });
    expect(points(game({ a: 30, b: 20, c: 20, d: 20 }))).toEqual({ a: 3, b: 1, c: 1, d: 1 });
    expect(points(game({ a: 5, b: 5, c: 5, d: 5 }))).toEqual({ a: 1.5, b: 1.5, c: 1.5, d: 1.5 });
  });

  it("gives a bot that didn't finish last place, even with the top score", () => {
    expect(points(game({ a: 900, b: 30, c: 20, d: 10 }, "a"))).toEqual({ a: 0, b: 3, c: 2, d: 1 });
  });

  it("gives every bot that didn't finish 0 points", () => {
    expect(points(game({ a: 40, b: 30, c: 20, d: 10 }, "a", "b"))).toEqual({ a: 0, b: 0, c: 3, d: 2 });
  });

  it("gives a bot that finished alone 1st place", () => {
    const placings = placingPoints(game({ a: 40, b: 30, c: 20 }, "a", "b"), 3);
    expect(placings.get("c")).toEqual({ points: 2, won: true });
  });

  it("gives nothing if nobody finished", () => {
    expect(points(game({ a: 40, b: 30, c: 20 }, "a", "b", "c"))).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("counts everyone tied for 1st as winners", () => {
    const placings = placingPoints(game({ a: 30, b: 30, c: 20 }), 3);
    expect([placings.get("a")!.won, placings.get("b")!.won, placings.get("c")!.won]).toEqual([true, true, false]);
  });

  it("copes with results recorded without didNotFinish", () => {
    const { didNotFinish: _, ...result } = game({ a: 2, b: 1, c: 0 });
    expect(points(result)).toEqual({ a: 2, b: 1, c: 0 });
  });
});

describe("standings", () => {
  const row = (t: Tournament, id: string) => standings(t).find(r => r.botId === id)!;

  it("adds up points and wins", () => {
    const t = tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 }), game({ a: 1, b: 3, c: 2 }));
    expect(row(t, "a")).toMatchObject({ games: 2, points: 2, wins: 1, averagePoints: 1 });
    expect(row(t, "b")).toMatchObject({ games: 2, points: 3, wins: 1, averagePoints: 1.5 });
    expect(row(t, "c")).toMatchObject({ games: 2, points: 1, wins: 0, averagePoints: 0.5 });
  });

  it("orders by average points", () => {
    const t = tournamentOf(["a", "b", "c"], 3, game({ a: 1, b: 3, c: 2 }));
    expect(standings(t).map(r => r.botId)).toEqual(["b", "c", "a"]);
    expect(standings(t).map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it("isn't fooled by a higher total from more games", () => {
    const t = tournamentOf(
      ["a", "b", "c", "d"],
      3,
      game({ a: 3, b: 2, c: 1 }),
      game({ a: 1, b: 3, c: 2 }),
      game({ a: 2, b: 3, d: 9 })
    );
    expect(row(t, "d")).toMatchObject({ games: 1, points: 2 });
    expect(standings(t)[0].botId).toBe("d");
  });

  it("breaks a level average with wins", () => {
    // a wins and comes last, b is 2nd twice
    const t = tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 }), game({ a: 1, b: 2, c: 3 }));
    expect(row(t, "a").averagePoints).toBe(row(t, "b").averagePoints);
    expect(row(t, "a").rank).toBeLessThan(row(t, "b").rank);
  });

  it("shares a rank when bots are level on both", () => {
    const t = tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 }), game({ a: 2, b: 3, c: 1 }));
    expect(standings(t).map(r => r.rank)).toEqual([1, 1, 3]);
  });

  describe("tie-breaks", () => {
    // In all of these a and b are level on average and wins
    it("goes to who placed ahead when the level bots met", () => {
      const level = tournamentOf(
        ["a", "b", "c"],
        3,
        game({ a: 1, b: 9, c: 0 }),
        game({ a: 9, c: 8, b: 0 }),
        game({ a: 3, b: 5, c: 9 })
      );
      expect(row(level, "a")).toMatchObject({ points: 3, wins: 1 });
      expect(row(level, "b")).toMatchObject({ points: 3, wins: 1 });
      expect(standings(level).map(r => r.botId).indexOf("b")).toBeLessThan(
        standings(level).map(r => r.botId).indexOf("a")
      );
      expect(row(level, "a").rank).toBe(row(level, "b").rank + 1);
    });

    it("ignores games where only one of the level bots played", () => {
      // a placed ahead of b the one time they met, and b's big scores elsewhere don't matter
      const t = tournamentOf(
        ["a", "b", "c", "d"],
        3,
        game({ a: 2, b: 1, c: 3 }),
        game({ b: 300, c: 2, d: 1 }),
        game({ a: 3, c: 2, d: 1 }),
        game({ c: 300, b: 200, d: 1 }),
        game({ c: 3, d: 2, a: 0 })
      );
      expect(row(t, "a").averagePoints).toBe(row(t, "b").averagePoints);
      expect(row(t, "a").wins).toBe(row(t, "b").wins);
      expect(row(t, "a").rank).toBeLessThan(row(t, "b").rank);
    });

    it("treats a bot that left a game as behind in that game", () => {
      const t = tournamentOf(
        ["a", "b", "c", "d"],
        3,
        game({ a: 900, b: 1, c: 0 }, "a"),
        game({ a: 9, c: 1, d: 0 }),
        game({ c: 2, d: 1, b: 0 })
      );
      expect(row(t, "a").averagePoints).toBe(row(t, "b").averagePoints);
      expect(row(t, "a").wins).toBe(row(t, "b").wins);
      expect(row(t, "a").averageScore).toBeGreaterThan(row(t, "b").averageScore);
      expect(row(t, "b").rank).toBeLessThan(row(t, "a").rank);
    });

    it("falls back on the average game score when they split their meetings", () => {
      const t = tournamentOf(["a", "b", "c"], 3, game({ a: 90, b: 20, c: 1 }), game({ a: 10, b: 30, c: 1 }));
      expect(row(t, "a").averagePoints).toBe(row(t, "b").averagePoints);
      expect(row(t, "a")).toMatchObject({ rank: 1, averageScore: 50 });
      expect(row(t, "b")).toMatchObject({ rank: 2, averageScore: 25 });
    });

    it("doesn't let score decide before placings do", () => {
      const t = tournamentOf(["a", "b", "c"], 3, game({ a: 2, b: 1, c: 0 }), game({ a: 2, b: 1, c: 0 }));
      expect(standings(t).map(r => r.botId)).toEqual(["a", "b", "c"]);
      const big = tournamentOf(["a", "b", "c"], 3, game({ a: 2, b: 1, c: 0 }), game({ a: 1, b: 2000, c: 0 }), game({ a: 3, b: 2, c: 0 }));
      expect(row(big, "a").rank).toBe(1);
    });

    it("leaves out games a bot didn't finish from its average score", () => {
      const t = tournamentOf(["a", "b", "c"], 3, game({ a: 900, b: 2, c: 1 }, "a"), game({ a: 10, b: 2, c: 1 }));
      expect(row(t, "a").averageScore).toBe(10);
    });

    it("puts a bot that finished no games behind one that did, whatever its score", () => {
      const t = tournamentOf(
        ["a", "b", "c", "d", "e"],
        4,
        game({ a: 50, c: 3, d: 2, e: 1 }, "a"),
        game({ b: -900, c: 3, d: 2, e: 1 })
      );
      expect(row(t, "a")).toMatchObject({ averagePoints: 0, wins: 0, averageScore: 0 });
      expect(row(t, "b")).toMatchObject({ averagePoints: 0, wins: 0, averageScore: -900 });
      expect(row(t, "b").rank).toBeLessThan(row(t, "a").rank);
    });

    it("doesn't show internal fields", () => {
      const [first] = standings(tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 })));
      expect(Object.keys(first).sort()).toEqual(
        ["averagePoints", "averageScore", "botId", "games", "missed", "name", "points", "rank", "wins"].sort()
      );
    });

    it("works out a three-way tie where each bot beat one of the others", () => {
      const t = tournamentOf(
        ["a", "b", "c"],
        3,
        game({ a: 30, b: 2, c: 1 }),
        game({ b: 3, c: 2, a: 1 }),
        game({ c: 3, a: 2, b: 1 })
      );
      expect(standings(t).map(r => r.averagePoints)).toEqual([1, 1, 1]);
      expect(standings(t).map(r => r.botId)).toEqual(["a", "b", "c"]);
      expect(standings(t).map(r => r.rank)).toEqual([1, 2, 2]);
    });

    it("leaves bots level on everything sharing a rank", () => {
      const t = tournamentOf(
        ["a", "b", "c"],
        3,
        game({ a: 3, b: 2, c: 1 }),
        game({ b: 3, c: 2, a: 1 }),
        game({ c: 3, a: 2, b: 1 })
      );
      expect(standings(t).map(r => r.rank)).toEqual([1, 1, 1]);
    });
  });

  describe("missed rounds", () => {
    const withAbsences = (t: Tournament, ...absent: string[][]) => ({
      ...t,
      absences: absent.map(ids => ids.map(id => ({ id, name: id }))),
    });

    it("count as games worth 0 points", () => {
      const t = withAbsences(tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 })), [], ["a"], ["a"]);
      expect(row(t, "a")).toMatchObject({ games: 3, missed: 2, points: 2, averagePoints: 0.667 });
    });

    it("stop a leader from protecting its average by leaving", () => {
      const played = [game({ a: 3, b: 2, c: 1 }), game({ a: 3, b: 2, c: 1 })];
      const t = withAbsences(tournamentOf(["a", "b", "c"], 3, ...played), [], [], ["a"], ["a"], ["a"]);
      expect(standings(t)[0].botId).toBe("b");
    });

    it("copes with tournaments saved before absences existed", () => {
      const t = tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 }));
      delete t.absences;
      expect(row(t, "a")).toMatchObject({ games: 1, missed: 0 });
    });
  });

  it("counts a game a bot didn't finish as played", () => {
    const t = tournamentOf(["a", "b", "c"], 3, game({ a: 900, b: 2, c: 1 }, "a"));
    expect(row(t, "a")).toMatchObject({ games: 1, points: 0, wins: 0 });
    expect(row(t, "b")).toMatchObject({ points: 2, wins: 1 });
  });

  it("skips tables that are still being played", () => {
    const t = tournamentOf(["a", "b", "c"], 3);
    t.schedule = [[{ id: "g", players: [], result: null }]];
    expect(standings(t).every(r => r.games === 0 && r.rank === 1)).toBe(true);
  });

  it("lists bots with no games yet", () => {
    expect(standings(tournamentOf(["a", "b", "c"], 3)).map(r => r.averagePoints)).toEqual([0, 0, 0]);
  });
});

describe("drawTables", () => {
  const bots = (count: number) => Array.from({ length: count }, (_, i) => `b${i}`);

  // A small repeatable random source, so that the tests don't depend on luck
  const seeded = (seed = 1) => () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const repeats = (tables: string[][]) => {
    const seen = new Map<string, number>();
    for (const table of tables) {
      for (const a of table) {
        for (const b of table) {
          if (a < b) seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
        }
      }
    }
    return [...seen.values()].reduce((total, count) => total + count - 1, 0);
  };

  const playRounds = (ids: string[], size: number, rounds: number, draw = drawTables) => {
    const tables: string[][] = [];
    const random = seeded();
    for (let round = 0; round < rounds; round++) {
      const drawn = draw(ids, size, tables, random);
      const seated = drawn.flat();
      expect(new Set(seated).size).toBe(seated.length);
      tables.push(...drawn);
    }
    return tables;
  };

  it.each([[8, 4, 2], [9, 3, 3], [12, 6, 2], [4, 4, 1]])("divides %i bots at tables of %i", (count, size, expected) => {
    const tables = drawTables(bots(count), size, []);
    expect(tables).toHaveLength(expected);
    tables.forEach(table => expect(table).toHaveLength(size));
  });

  it("leaves out only as many bots as don't fit", () => {
    const tables = drawTables(bots(9), 4, []);
    expect(tables).toHaveLength(2);
    expect(tables.flat()).toHaveLength(8);
  });

  it.each([[9, 4], [7, 3], [11, 5], [5, 4], [13, 6]])("keeps game counts within one with %i bots at tables of %i", (count, size) => {
    for (const rounds of [1, 2, 3, 7, 10, 13]) {
      const seated = playRounds(bots(count), size, rounds).flat();
      const games = bots(count).map(id => seated.filter(seat => seat === id).length);
      expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1);
    }
  });

  it("avoids repeats entirely when it can", () => {
    // 9 bots at tables of 3 can avoid each other for 4 rounds, so 2 are easy
    expect(repeats(playRounds(bots(9), 3, 2))).toBe(0);
  });

  it("repeats far fewer pairings than a single random draw", () => {
    const singleDraw: typeof drawTables = (ids, size, _earlier, random) => {
      const order = drawTables(ids, size, [], random).flat();
      return Array.from({ length: Math.floor(order.length / size) }, (_, i) => order.slice(i * size, (i + 1) * size));
    };

    const careful = repeats(playRounds(bots(12), 4, 5));
    const careless = repeats(playRounds(bots(12), 4, 5, singleDraw));

    expect(careful).toBeLessThan(careless);
  });

  it("can draw from the same random numbers twice", () => {
    expect(drawTables(bots(8), 4, [], seeded(7))).toEqual(drawTables(bots(8), 4, [], seeded(7)));
  });
});

describe("isValidSettings", () => {
  it("accepts good settings", () => {
    expect(isValidSettings("Cup", 3, 1)).toBe(true);
    expect(isValidSettings("Cup", 6, 100)).toBe(true);
  });

  it.each([
    ["", 4, 5],
    ["   ", 4, 5],
    ["x".repeat(65), 4, 5],
    [5, 4, 5],
    [undefined, 4, 5],
    ["Cup", 2, 5],
    ["Cup", 7, 5],
    ["Cup", 4.5, 5],
    ["Cup", "4", 5],
    ["Cup", 4, 0],
    ["Cup", 4, 101],
    ["Cup", 4, 1.5],
    ["Cup", 4, "5"],
    ["Cup", 4, null],
  ])("refuses %j, %j, %j", (name, tableSize, rounds) => {
    expect(isValidSettings(name, tableSize, rounds)).toBe(false);
  });
});

describe("TournamentStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tournaments-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps tournaments in memory with no directory", () => {
    const store = new TournamentStore();
    store.save(tournamentOf(["a"], 3));
    expect(store.get("t")?.name).toBe("Cup");
  });

  it("survives a restart", () => {
    const t = tournamentOf(["a"], 3);
    t.status = "finished";
    new TournamentStore(dir).save(t);
    expect(new TournamentStore(dir).get("t")).toEqual(t);
  });

  it("marks a running tournament as interrupted after a restart, keeping its games", () => {
    new TournamentStore(dir).save(tournamentOf(["a", "b", "c"], 3, game({ a: 3, b: 2, c: 1 })));

    const reloaded = new TournamentStore(dir).get("t")!;

    expect(reloaded.status).toBe("interrupted");
    expect(standings(reloaded)[0].botId).toBe("a");
    expect(JSON.parse(readFileSync(join(dir, "t.json"), "utf8")).status).toBe("interrupted");
  });

  it("empties the sign-ups after a restart, as those bots are gone", () => {
    const t = tournamentOf(["a", "b"], 3);
    t.status = "signup";
    new TournamentStore(dir).save(t);

    const reloaded = new TournamentStore(dir).get("t")!;

    expect(reloaded.status).toBe("signup");
    expect(reloaded.entrants).toEqual([]);
  });

  it("lists the newest first", () => {
    const store = new TournamentStore();
    store.save({ ...tournamentOf([], 3), id: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    store.save({ ...tournamentOf([], 3), id: "new", createdAt: "2026-02-01T00:00:00.000Z" });
    expect(store.list().map(t => t.id)).toEqual(["new", "old"]);
  });

  it("ignores other files", () => {
    writeFileSync(join(dir, "notes.txt"), "hello");
    expect(new TournamentStore(dir).list()).toEqual([]);
  });
});

describe("tournaments on the server", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let port: number;
  let clients: Socket[];
  let resultStore: ResultStore;

  const startServer = async (options: Parameters<typeof createGameServer>[0] = {}) => {
    resultStore = new ResultStore();
    gameServer = createGameServer({
      turnTimeoutMs: NEVER,
      extraTimeMs: 0,
      roundWaitMs: 0,
      adminKey: KEY,
      resultStore,
      ...options,
    });
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    port = (gameServer.server.address() as AddressInfo).port;
  };

  const url = (path: string) => `http://localhost:${port}${path}`;
  const getJson = async (path: string) => (await fetch(url(path))).json();

  const post = (path: string, body?: unknown, key: string | null = KEY) =>
    fetch(url(path), {
      method: "POST",
      headers: {
        ...(key !== null && { Authorization: `Bearer ${key}` }),
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

  const createTournament = async (tableSize: number, rounds: number) =>
    (await (await post("/api/tournaments", { name: "Cup", tableSize, rounds })).json()).id as string;

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const newSocket = async () => {
    const socket = connect(url(""), { transports: ["websocket"], reconnection: false });
    clients.push(socket);
    await nextEvent(socket, "connect");
    return socket;
  };

  const signUp = async (name: string, tournamentId: string) => {
    const socket = await newSocket();
    const registered = nextEvent<any>(socket, GameStateAction.Registered);
    socket.emit(GameStateAction.Register, { name, tournamentId });
    return { socket, name, registered: await registered };
  };

  const signUpAll = (names: string[], tournamentId: string) =>
    Promise.all(names.map(name => signUp(name, tournamentId)));

  const finished = (tournamentId: string) =>
    vi.waitFor(
      async () => {
        const tournament = await getJson(`/api/tournaments/${tournamentId}`);
        expect(tournament.status).toBe("finished");
        return tournament;
      },
      { timeout: 10000, interval: 10 }
    );

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clients = [];
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  describe("signing up", () => {
    it("gives a new bot its token and lists it", async () => {
      await startServer();
      const id = await createTournament(3, 1);

      const { registered } = await signUp("a", id);

      expect(registered).toMatchObject({ gameId: null, name: "a", tournamentId: id, playerCount: 3 });
      expect(registered.token).toBeTruthy();
      const { entrants } = await getJson(`/api/tournaments/${id}`);
      expect(entrants.map((e: { name: string }) => e.name)).toEqual(["a"]);
    });

    it("doesn't start a game by itself, however many sign up", async () => {
      await startServer({ lobbyWaitMs: 1 });
      const id = await createTournament(3, 1);

      await signUpAll(["a", "b", "c", "d", "e", "f"], id);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect((await getJson(`/api/tournaments/${id}`)).status).toBe("signup");
      expect(gameServer.tables.size).toBe(0);
    });

    it("removes a bot that disconnects before the start", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const [a] = await signUpAll(["a", "b"], id);

      a.socket.close();

      await vi.waitFor(async () => {
        expect((await getJson(`/api/tournaments/${id}`)).entrants).toHaveLength(1);
      });
    });

    it("lets a bot that left sign up again", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const first = await signUp("a", id);
      first.socket.close();
      await vi.waitFor(async () => {
        expect((await getJson(`/api/tournaments/${id}`)).entrants).toHaveLength(0);
      });

      const socket = await newSocket();
      const registered = nextEvent<any>(socket, GameStateAction.Registered);
      socket.emit(GameStateAction.Register, { name: "a", token: first.registered.token, tournamentId: id });

      expect((await registered).tournamentId).toBe(id);
    });

    it.each([["nope"], [5], [{}], [["x"]]])("refuses tournament id %j and doesn't claim the name", async tournamentId => {
      await startServer();
      const socket = await newSocket();

      const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
      socket.emit(GameStateAction.Register, { name: "a", tournamentId });

      expect(await error).toBe("Tournament not found");
      const other = await newSocket();
      const registered = nextEvent<any>(other, GameStateAction.Registered);
      other.emit(GameStateAction.Register, { name: "a" });
      expect((await registered).token).toBeTruthy();
    });

    it("refuses a player count with a tournament", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const socket = await newSocket();

      const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
      socket.emit(GameStateAction.Register, { name: "a", tournamentId: id, playerCount: 4 });

      expect(await error).toBe("A tournament has its own table size");
    });

    it("refuses new bots after the start", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      await signUpAll(["a", "b", "c"], id);
      await post(`/api/tournaments/${id}/start`);

      const socket = await newSocket();
      const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
      socket.emit(GameStateAction.Register, { name: "late", tournamentId: id });

      expect(await error).toBe("Tournament is closed for sign-up");
    });

    it("refuses a logged in bot after the start", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      await signUpAll(["a", "b", "c"], id);
      await post(`/api/tournaments/${id}/start`);

      const casual = await newSocket();
      const registered = nextEvent(casual, GameStateAction.Registered);
      casual.emit(GameStateAction.Register, { name: "casual" });
      await registered;

      const error = nextEvent<string>(casual, GameStateAction.ErrorMessage);
      casual.emit(GameStateAction.Register, { tournamentId: id });

      expect(await error).toMatch(/Already registered/);
    });
  });

  describe("keeping games apart", () => {
    it("keeps a signed-up bot out of casual games", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const { socket } = await signUp("a", id);

      const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
      socket.emit(GameStateAction.Register, {});

      expect(await error).toBe("Already in tournament Cup");
      expect(gameServer.tables.size).toBe(0);
    });

    it("makes a bot at a casual table finish first", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const socket = await newSocket();
      const registered = nextEvent(socket, GameStateAction.Registered);
      socket.emit(GameStateAction.Register, { name: "a" });
      await registered;

      const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
      socket.emit(GameStateAction.Register, { tournamentId: id });

      expect(await error).toMatch(/Already registered/);
      expect((await getJson(`/api/tournaments/${id}`)).entrants).toEqual([]);
    });

    it("lets bots play casual games again afterwards", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));
      const over = nextEvent(bots[0].socket, GameStateAction.TournamentFinished);

      await post(`/api/tournaments/${id}/start`);
      await over;

      const registered = nextEvent<any>(bots[0].socket, GameStateAction.Registered);
      bots[0].socket.emit(GameStateAction.Register, {});
      expect((await registered).gameId).toBeTruthy();
      expect((await registered).tournamentId).toBeUndefined();
    });

    it("isn't joined by a casual bot looking for a table", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      await signUpAll(["a", "b", "c"], id);
      await post(`/api/tournaments/${id}/start`);

      const socket = await newSocket();
      const registered = nextEvent<any>(socket, GameStateAction.Registered);
      socket.emit(GameStateAction.Register, { name: "casual" });

      const { gameId } = await registered;
      const tournamentGames = [...gameServer.tables].filter(t => t.tournament).map(t => t.id);
      expect(tournamentGames).not.toContain(gameId);
    });
  });

  describe("playing", () => {
    it("plays every round to the end and tells the bots their rank", async () => {
      await startServer();
      const id = await createTournament(3, 2);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));
      const ranks = bots.map(bot => nextEvent<any>(bot.socket, GameStateAction.TournamentFinished));

      await post(`/api/tournaments/${id}/start`);
      const results = await Promise.all(ranks);
      const tournament = await finished(id);

      expect(tournament.schedule).toHaveLength(2);
      expect(tournament.standings.every((row: { games: number }) => row.games === 2)).toBe(true);
      results.forEach((result, i) => {
        const row = tournament.standings.find((r: { name: string }) => r.name === bots[i].name);
        expect(result).toEqual({ tournamentId: id, rank: row.rank, bots: 3 });
      });
      expect(gameServer.tables.size).toBe(0);
    }, 15000);

    it("runs tables at the same time and sits out the bots that don't fit", async () => {
      await startServer();
      const id = await createTournament(3, 4);
      const names = ["a", "b", "c", "d", "e", "f", "g"];
      const bots = await signUpAll(names, id);

      // Held back, so that the first round stays on the tables while the test looks at it
      let playing = false;
      const answers = bots.map(bot => playLegally(bot.socket, bot.name, () => !playing));
      const seated = new Set<string>();
      bots.forEach(bot => bot.socket.once(GameStateAction.State, () => seated.add(bot.name)));

      await post(`/api/tournaments/${id}/start`);
      await vi.waitFor(() => expect(seated.size).toBe(6));

      expect([...gameServer.tables].map(t => t.players.length)).toEqual([3, 3]);

      playing = true;
      answers.forEach(answer => answer());

      const tournament = await finished(id);
      const games = tournament.standings.map((row: { games: number }) => row.games);
      expect(tournament.schedule.flat()).toHaveLength(8);
      expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1);
    }, 15000);

    it("records the games with their tournament and round", async () => {
      await startServer();
      const id = await createTournament(3, 2);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));

      await post(`/api/tournaments/${id}/start`);
      await finished(id);

      const { games } = resultStore.games({ limit: 10, offset: 0 });
      expect(games.map(g => [g.tournamentId, g.round])).toEqual([[id, 2], [id, 1]]);
    }, 15000);

    it("counts on the overall leaderboard too", async () => {
      await startServer();
      const id = await createTournament(3, 2);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));

      await post(`/api/tournaments/${id}/start`);
      await finished(id);

      expect((await getJson("/api/leaderboard")).map((row: { games: number }) => row.games)).toEqual([2, 2, 2]);
    }, 15000);

    it("gives a bot that left last place and leaves the others alone", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      playLegally(bots[1].socket, "b");
      playLegally(bots[2].socket, "c");

      await post(`/api/tournaments/${id}/start`);
      bots[0].socket.close();

      const tournament = await finished(id);
      const rows = tournament.standings;
      expect(rows.at(-1)).toMatchObject({ name: "a", points: 0, games: 1 });
      expect(rows.slice(0, 2).map((row: { points: number }) => row.points).sort()).toEqual([1, 2]);
      expect((await getJson("/api/leaderboard")).map((row: { name: string }) => row.name)).not.toContain("a");
    }, 15000);

    it("finishes even if every bot leaves", async () => {
      await startServer();
      const id = await createTournament(3, 3);
      const bots = await signUpAll(["a", "b", "c"], id);

      await post(`/api/tournaments/${id}/start`);
      bots.forEach(bot => bot.socket.close());

      const tournament = await finished(id);
      expect(tournament.schedule).toHaveLength(3);
      expect(tournament.standings.every((row: { points: number }) => row.points === 0)).toBe(true);
    }, 15000);

    it("lets a bot come back during a game", async () => {
      await startServer({ extraTimeMs: NEVER });
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      playLegally(bots[1].socket, "b");
      playLegally(bots[2].socket, "c");

      const state = nextEvent(bots[0].socket, GameStateAction.State);
      await post(`/api/tournaments/${id}/start`);
      await state;
      bots[0].socket.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(2));

      const back = await newSocket();
      playLegally(back, "a");
      const registered = nextEvent<any>(back, GameStateAction.Registered);
      back.emit(GameStateAction.Register, { name: "a", token: bots[0].registered.token, tournamentId: id });

      expect((await registered).tournamentId).toBe(id);
      const tournament = await finished(id);
      expect(tournament.standings.find((r: { name: string }) => r.name === "a").games).toBe(1);
      expect(tournament.schedule[0][0].result.didNotFinish).toEqual([]);
    }, 15000);

    it("keeps a bot in the tournament when it reconnects asking for a casual game", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c", "d"], id);
      await post(`/api/tournaments/${id}/start`);

      const seated = [...gameServer.tables][0].players.map(p => p.name);
      const waiting = bots.find(bot => !seated.includes(bot.name))!;
      waiting.socket.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(3));

      const back = await newSocket();
      const registered = nextEvent<any>(back, GameStateAction.Registered);
      back.emit(GameStateAction.Register, { name: waiting.name, token: waiting.registered.token });

      expect(await registered).toMatchObject({ gameId: null, tournamentId: id });
      expect((await getJson(`/api/tournaments/${id}`)).entrants).toHaveLength(4);
    });

    it("leaves a bot that is gone out of the next rounds, for 0 points each", async () => {
      await startServer();
      const id = await createTournament(3, 3);
      const bots = await signUpAll(["a", "b", "c", "d"], id);

      let playing = false;
      const answers = bots.map(bot => playLegally(bot.socket, bot.name, () => !playing));
      const received = new Set<string>();
      bots.forEach(bot => bot.socket.once(GameStateAction.State, () => received.add(bot.name)));
      await post(`/api/tournaments/${id}/start`);
      await vi.waitFor(() => expect(received.size).toBe(3));

      const seated = [...gameServer.tables][0].players.map(p => p.name);
      const gone = bots.find(bot => seated.includes(bot.name))!;
      gone.socket.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(3));
      playing = true;
      answers.forEach(answer => answer());

      const tournament = await finished(id);
      const names = (round: number) => tournament.schedule[round].flatMap((t: any) => t.players.map((p: any) => p.name));
      expect(names(1)).not.toContain(gone.name);
      expect(names(2)).not.toContain(gone.name);
      expect(tournament.absences.map((bots: any[]) => bots.map(b => b.name))).toEqual([[], [gone.name], [gone.name]]);
      expect(tournament.standings.find((r: any) => r.name === gone.name)).toMatchObject({ games: 3, missed: 2, points: 0 });
    }, 15000);

    it("seats a gone bot only if a table can't be filled without it", async () => {
      await startServer();
      const id = await createTournament(3, 3);
      const bots = await signUpAll(["a", "b", "c"], id);
      playLegally(bots[1].socket, "b");
      playLegally(bots[2].socket, "c");

      await post(`/api/tournaments/${id}/start`);
      bots[0].socket.close();

      const tournament = await finished(id);
      expect(tournament.schedule).toHaveLength(3);
      expect(tournament.absences.flat()).toEqual([]);
      expect(tournament.standings.find((r: any) => r.name === "a")).toMatchObject({ games: 3, points: 0 });
    }, 15000);

    it("seats a bot again once it comes back", async () => {
      await startServer({ extraTimeMs: NEVER });
      const id = await createTournament(3, 2);
      const bots = await signUpAll(["a", "b", "c", "d"], id);

      let playing = false;
      const answers = bots.map(bot => playLegally(bot.socket, bot.name, () => !playing));
      const received = new Set<string>();
      bots.forEach(bot => bot.socket.once(GameStateAction.State, () => received.add(bot.name)));

      await post(`/api/tournaments/${id}/start`);
      await vi.waitFor(() => expect(received.size).toBe(3));

      const seated = [...gameServer.tables][0].players.map(p => p.name);
      const waiting = bots.find(bot => !seated.includes(bot.name))!;
      waiting.socket.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(3));

      // Back before the first round ends, so it counts as here when the next one is drawn
      const back = await newSocket();
      const registered = nextEvent<any>(back, GameStateAction.Registered);
      back.emit(GameStateAction.Register, { name: waiting.name, token: waiting.registered.token });
      expect(await registered).toMatchObject({ gameId: null, tournamentId: id });

      playing = true;
      answers.forEach(answer => answer());

      await vi.waitFor(() => {
        const [table] = [...gameServer.tables];
        expect(table?.tournament?.round).toBe(2);
      }, { timeout: 10000, interval: 5 });
      expect([...gameServer.tables][0].players.map(p => p.name)).toContain(waiting.name);
      expect((await getJson(`/api/tournaments/${id}`)).absences).toEqual([[], []]);
    }, 15000);

    describe("waiting before a round", () => {
      // Short, and unlike any other timer in these games, so that the test can count it
      const ROUND_WAIT = 37;

      // Plays the first round while the bot that sits out is disconnected
      const finishRoundWithoutOneBot = async (id: string) => {
        const bots = await signUpAll(["a", "b", "c", "d"], id);
        let playing = false;
        const answers = bots.map(bot => playLegally(bot.socket, bot.name, () => !playing));
        const received = new Set<string>();
        bots.forEach(bot => bot.socket.once(GameStateAction.State, () => received.add(bot.name)));

        await post(`/api/tournaments/${id}/start`);
        await vi.waitFor(() => expect(received.size).toBe(3));

        const seated = [...gameServer.tables][0].players.map(p => p.name);
        const away = bots.find(bot => !seated.includes(bot.name))!;
        away.socket.close();
        await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(3));

        playing = true;
        answers.forEach(answer => answer());
        await vi.waitFor(
          async () => {
            const { schedule } = await getJson(`/api/tournaments/${id}`);
            expect(schedule[0][0].result).not.toBeNull();
          },
          { timeout: 10000, interval: 5 }
        );
        return { away };
      };

      const comeBack = async (bot: { name: string; registered: { token: string } }) => {
        const back = await newSocket();
        playLegally(back, bot.name);
        const registered = nextEvent<any>(back, GameStateAction.Registered);
        back.emit(GameStateAction.Register, { name: bot.name, token: bot.registered.token });
        return registered;
      };

      it("holds the next round for a bot that has just gone", async () => {
        await startServer({ roundWaitMs: NEVER });
        const id = await createTournament(3, 2);

        await finishRoundWithoutOneBot(id);

        expect((await getJson(`/api/tournaments/${id}`)).schedule).toHaveLength(1);
        expect(gameServer.tables.size).toBe(0);
      }, 15000);

      it("draws at once when the bot is back, without a missed round", async () => {
        await startServer({ roundWaitMs: NEVER });
        const id = await createTournament(3, 2);
        const { away } = await finishRoundWithoutOneBot(id);

        await comeBack(away);

        const { schedule, absences } = await getJson(`/api/tournaments/${id}`);
        expect(schedule).toHaveLength(2);
        expect(absences).toEqual([[], []]);
        expect([...gameServer.tables][0].players.map(p => p.name)).toContain(away.name);
      }, 15000);

      it("draws without the bot when the wait ends", async () => {
        await startServer({ roundWaitMs: 30 });
        const id = await createTournament(3, 2);
        const { away } = await finishRoundWithoutOneBot(id);

        await vi.waitFor(async () => {
          const { absences } = await getJson(`/api/tournaments/${id}`);
          expect(absences).toEqual([[], [expect.objectContaining({ name: away.name })]]);
        });
      }, 15000);

      it("draws only once if the bot returns just as the wait ends", async () => {
        await startServer({ roundWaitMs: 5 });
        const id = await createTournament(3, 2);
        const { away } = await finishRoundWithoutOneBot(id);

        await comeBack(away);
        await new Promise(resolve => setTimeout(resolve, 30));

        expect((await getJson(`/api/tournaments/${id}`)).schedule).toHaveLength(2);
      }, 15000);

      it("waits once for a bot, not every round", async () => {
        const timers = vi.spyOn(globalThis, "setTimeout");
        await startServer({ roundWaitMs: ROUND_WAIT });
        const id = await createTournament(3, 3);
        const bots = await signUpAll(["a", "b", "c", "d"], id);
        const here = bots.slice(1);
        here.forEach(bot => playLegally(bot.socket, bot.name));

        await post(`/api/tournaments/${id}/start`);
        bots[0].socket.close();

        const tournament = await finished(id);

        expect(tournament.schedule).toHaveLength(3);
        expect(timers.mock.calls.filter(([, ms]) => ms === ROUND_WAIT)).toHaveLength(1);
      }, 15000);

      it("doesn't wait when everyone is here", async () => {
        await startServer({ roundWaitMs: NEVER });
        const id = await createTournament(3, 2);
        const bots = await signUpAll(["a", "b", "c"], id);
        bots.forEach(bot => playLegally(bot.socket, bot.name));

        await post(`/api/tournaments/${id}/start`);

        expect((await finished(id)).schedule).toHaveLength(2);
      }, 15000);

      it("doesn't wait when nobody is left", async () => {
        await startServer({ roundWaitMs: NEVER });
        const id = await createTournament(3, 3);
        const bots = await signUpAll(["a", "b", "c"], id);

        await post(`/api/tournaments/${id}/start`);
        bots.forEach(bot => bot.socket.close());

        expect((await finished(id)).schedule).toHaveLength(3);
      }, 15000);

      it("doesn't wait after the last round", async () => {
        await startServer({ roundWaitMs: NEVER });
        const id = await createTournament(3, 1);
        const bots = await signUpAll(["a", "b", "c"], id);
        playLegally(bots[1].socket, "b");
        playLegally(bots[2].socket, "c");

        await post(`/api/tournaments/${id}/start`);
        bots[0].socket.close();

        await finished(id);
      }, 15000);
    });

    it("refuses a bot coming back after the end", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));
      await post(`/api/tournaments/${id}/start`);
      await finished(id);

      const back = await newSocket();
      const error = nextEvent<string>(back, GameStateAction.ErrorMessage);
      back.emit(GameStateAction.Register, { name: "a", token: bots[0].registered.token, tournamentId: id });

      expect(await error).toBe("Tournament is closed for sign-up");
    }, 15000);
  });

  describe("organiser key", () => {
    const settings = { name: "Cup", tableSize: 3, rounds: 1 };

    it("is needed to create a tournament", async () => {
      await startServer();

      expect((await post("/api/tournaments", settings, null)).status).toBe(401);
      expect((await post("/api/tournaments", settings, "wrong")).status).toBe(401);
      expect((await post("/api/tournaments", settings, "")).status).toBe(401);
      expect(await getJson("/api/tournaments")).toEqual([]);
    });

    it("is needed to start a tournament", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      await signUpAll(["a", "b", "c"], id);

      expect((await post(`/api/tournaments/${id}/start`, undefined, null)).status).toBe(401);
      expect((await post(`/api/tournaments/${id}/start`, undefined, "wrong")).status).toBe(401);
      expect((await getJson(`/api/tournaments/${id}`)).status).toBe("signup");
    });

    it("turns these routes off when the server has none", async () => {
      await startServer({ adminKey: undefined });

      expect((await post("/api/tournaments", settings, "")).status).toBe(403);
      expect((await post("/api/tournaments", settings, "anything")).status).toBe(403);
    });

    it("is checked before the body is read", async () => {
      await startServer();
      expect((await post("/api/tournaments", "{not json", "wrong")).status).toBe(401);
    });

    it("never shows up in responses, and neither do tokens", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));
      await post(`/api/tournaments/${id}/start`);
      await finished(id);

      const text = await (await fetch(url(`/api/tournaments/${id}`))).text();
      const list = await (await fetch(url("/api/tournaments"))).text();

      for (const secret of [KEY, ...bots.map(bot => bot.registered.token)]) {
        expect(text).not.toContain(secret);
        expect(list).not.toContain(secret);
      }
    }, 15000);
  });

  describe("api", () => {
    it.each([
      [{ tableSize: 3, rounds: 1 }],
      [{ name: "Cup", tableSize: 2, rounds: 1 }],
      [{ name: "Cup", tableSize: 3, rounds: 0 }],
      [{ name: "Cup", tableSize: 3, rounds: 101 }],
      [{}],
    ])("refuses settings %j", async settings => {
      await startServer();
      expect((await post("/api/tournaments", settings)).status).toBe(400);
      expect(await getJson("/api/tournaments")).toEqual([]);
    });

    it("answers a broken body with json", async () => {
      await startServer();
      const response = await post("/api/tournaments", "{not json");
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request" });
    });

    it("refuses a body that is too large", async () => {
      await startServer();
      const response = await post("/api/tournaments", { name: "x".repeat(20000), tableSize: 3, rounds: 1 });
      expect(response.status).toBe(413);
    });

    it("trims the name", async () => {
      await startServer();
      const created = await (await post("/api/tournaments", { name: "  Cup  ", tableSize: 3, rounds: 1 })).json();
      expect(created.name).toBe("Cup");
    });

    it("needs enough bots to start", async () => {
      await startServer();
      const id = await createTournament(4, 1);
      await signUpAll(["a", "b", "c"], id);

      const response = await post(`/api/tournaments/${id}/start`);

      expect(response.status).toBe(409);
      expect((await getJson(`/api/tournaments/${id}`)).status).toBe("signup");
    });

    it("can't be started twice", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      await signUpAll(["a", "b", "c"], id);

      expect((await post(`/api/tournaments/${id}/start`)).status).toBe(200);
      expect((await post(`/api/tournaments/${id}/start`)).status).toBe(409);
      expect(gameServer.tables.size).toBe(1);
    });

    it("doesn't find unknown tournaments", async () => {
      await startServer();
      expect((await fetch(url("/api/tournaments/nope"))).status).toBe(404);
      expect((await post("/api/tournaments/nope/start")).status).toBe(404);
      expect((await post("/api/tournaments/nope/cancel")).status).toBe(404);
    });

    describe("cancelling", () => {
      it("tells the bots and frees them for casual games", async () => {
        await startServer();
        const id = await createTournament(3, 1);
        const [bot] = await signUpAll(["a", "b"], id);
        const told = nextEvent<any>(bot.socket, GameStateAction.TournamentCancelled);

        const response = await post(`/api/tournaments/${id}/cancel`);

        expect(response.status).toBe(200);
        expect(await told).toEqual({ tournamentId: id });
        const tournament = await getJson(`/api/tournaments/${id}`);
        expect(tournament).toMatchObject({ status: "cancelled", entrants: [] });

        const registered = nextEvent<any>(bot.socket, GameStateAction.Registered);
        bot.socket.emit(GameStateAction.Register, {});
        expect((await registered).gameId).toBeTruthy();
      });

      it("needs the key", async () => {
        await startServer();
        const id = await createTournament(3, 1);

        expect((await post(`/api/tournaments/${id}/cancel`, undefined, null)).status).toBe(401);
        expect((await post(`/api/tournaments/${id}/cancel`, undefined, "wrong")).status).toBe(401);
        expect((await getJson(`/api/tournaments/${id}`)).status).toBe("signup");
      });

      it("isn't possible once it has started", async () => {
        await startServer();
        const id = await createTournament(3, 1);
        await signUpAll(["a", "b", "c"], id);
        await post(`/api/tournaments/${id}/start`);

        expect((await post(`/api/tournaments/${id}/cancel`)).status).toBe(409);
        expect((await getJson(`/api/tournaments/${id}`)).status).toBe("running");
      });

      it("can't be done twice, or followed by a start or sign-up", async () => {
        await startServer();
        const id = await createTournament(3, 1);
        await post(`/api/tournaments/${id}/cancel`);

        expect((await post(`/api/tournaments/${id}/cancel`)).status).toBe(409);
        expect((await post(`/api/tournaments/${id}/start`)).status).toBe(409);

        const socket = await newSocket();
        const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
        socket.emit(GameStateAction.Register, { name: "late", tournamentId: id });
        expect(await error).toBe("Tournament is closed for sign-up");
      });

      it("stays cancelled after a restart", () => {
        const dir = mkdtempSync(join(tmpdir(), "tournaments-"));
        try {
          const t = tournamentOf([], 3);
          t.status = "cancelled";
          new TournamentStore(dir).save(t);
          expect(new TournamentStore(dir).get("t")?.status).toBe("cancelled");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });

    it("hides what is running", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      await signUpAll(["a", "b", "c"], id);
      await post(`/api/tournaments/${id}/start`);

      const text = await (await fetch(url(`/api/tournaments/${id}`))).text();
      const { schedule } = JSON.parse(text);

      expect(schedule[0][0].gameId).toBeNull();
      expect(schedule[0][0].players).toHaveLength(3);
      expect(text).not.toContain([...gameServer.tables][0].id);
      expect(text).not.toContain("currentHand");
    });

    it("links a finished table to its game", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));
      await post(`/api/tournaments/${id}/start`);

      const { schedule } = await finished(id);
      const game = await getJson(`/api/games/${schedule[0][0].gameId}`);

      expect(game.replay).not.toBeNull();
      expect(game.result.tournamentId).toBe(id);
    }, 15000);

    it("summarises tournaments", async () => {
      await startServer();
      const id = await createTournament(3, 1);
      const bots = await signUpAll(["a", "b", "c"], id);
      bots.forEach(bot => playLegally(bot.socket, bot.name));
      await post(`/api/tournaments/${id}/start`);
      const { standings: rows } = await finished(id);

      const [summary] = await getJson("/api/tournaments");

      expect(summary).toMatchObject({ id, status: "finished", entrants: 3, roundsPlayed: 1, tableSize: 3, rounds: 1 });
      expect(summary.winners).toContain(rows[0].name);
    }, 15000);
  });
});
