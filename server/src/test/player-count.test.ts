import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { GameState, GameStateAction } from "../wizard/types";

const NEVER = 60000;

interface Registered {
  gameId: string;
  botId: string;
  playerCount: number | null;
  token?: string;
}

describe("player count", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let port: number;
  let clients: Socket[];

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const startServer = async (options: Parameters<typeof createGameServer>[0] = {}) => {
    gameServer = createGameServer({ turnTimeoutMs: NEVER, lobbyWaitMs: NEVER, extraTimeMs: 0, ...options });
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    port = (gameServer.server.address() as AddressInfo).port;
  };

  const connectClient = async () => {
    const client = connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false });
    clients.push(client);
    await nextEvent(client, "connect");
    return client;
  };

  const join = async (name: string, playerCount?: unknown) => {
    const client = await connectClient();
    const registered = nextEvent<Registered>(client, GameStateAction.Registered);
    client.emit(GameStateAction.Register, { name, playerCount });
    return { client, ...(await registered) };
  };

  const joinAll = async (names: string[], playerCount?: unknown) => {
    const bots = [];
    for (const name of names) bots.push(await join(name, playerCount));
    return bots;
  };

  const expectError = (socket: Socket, event: string, payload?: unknown) => {
    const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
    socket.emit(event, payload);
    return error;
  };

  const NAMES = ["a", "b", "c", "d", "e", "f"];
  const openTables = () => [...gameServer.tables].filter(t => !t.game);

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clients = [];
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  describe("starting", () => {
    it.each([3, 4, 5, 6])("a table for %i starts by itself at that count", async count => {
      await startServer();
      const waiting = await joinAll(NAMES.slice(0, count - 1), count);
      expect(openTables()).toHaveLength(1);

      const states = waiting.map(b => nextEvent<GameState>(b.client, GameStateAction.State));
      await join("last", count);

      for (const state of await Promise.all(states)) {
        expect(state.players).toHaveLength(count);
      }
      expect(openTables()).toHaveLength(0);
    });

    it("doesn't use the lobby wait", async () => {
      await startServer({ lobbyWaitMs: 5 });
      const [bot] = await joinAll(["a", "b", "c", "d"], 5);
      const onStarted = vi.fn();
      bot.client.on(GameStateAction.GameStarted, onStarted);

      await new Promise(resolve => setTimeout(resolve, 40));

      expect(onStarted).not.toHaveBeenCalled();
    });

    it("refuses startGame, because the bots asked for a count", async () => {
      await startServer();
      const [bot] = await joinAll(["a", "b", "c"], 4);

      expect(await expectError(bot.client, GameStateAction.StartGame)).toBe("Game starts when it has 4 players");
    });

    it("waits for a replacement when a bot leaves", async () => {
      await startServer();
      const [stays, leaves] = await joinAll(["a", "b"], 3);
      leaves.client.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(1), { interval: 5 });

      await join("c", 3);
      expect(openTables()).toHaveLength(1);

      const started = nextEvent(stays.client, GameStateAction.GameStarted);
      await join("d", 3);
      await started;
    });
  });

  describe("seating", () => {
    it("reports the count of the table", async () => {
      await startServer();

      expect((await join("a", 5)).playerCount).toBe(5);
      expect((await join("b")).playerCount).toBe(5);
    });

    it("keeps different counts at different tables", async () => {
      await startServer();

      const three = await join("a", 3);
      const four = await join("b", 4);
      const threeAgain = await join("c", 3);

      expect(four.gameId).not.toBe(three.gameId);
      expect(threeAgain.gameId).toBe(three.gameId);
      expect(openTables()).toHaveLength(2);
    });

    it("runs games of different counts at the same time", async () => {
      await startServer();
      const threes = await joinAll(["a", "b"], 3);
      const fours = await joinAll(["c", "d", "e"], 4);

      const threeState = nextEvent<GameState>(threes[0].client, GameStateAction.State);
      await join("f", 3);
      const fourState = nextEvent<GameState>(fours[0].client, GameStateAction.State);
      await join("g", 4);

      expect((await threeState).players).toHaveLength(3);
      expect((await fourState).players).toHaveLength(4);
    });

    it("lets a bot with no count fill a table with a count", async () => {
      await startServer();
      const [first] = await joinAll(["a", "b"], 3);

      const started = nextEvent(first.client, GameStateAction.GameStarted);
      const filler = await join("c");
      await started;

      expect(filler.gameId).toBe(first.gameId);
    });

    it("puts a bot with no count at the oldest open table", async () => {
      await startServer();
      const oldest = await join("a", 5);
      await join("b", 4);

      expect((await join("c")).gameId).toBe(oldest.gameId);
    });

    it("doesn't seat a bot with a count at a table with no count", async () => {
      await startServer();
      const noCount = await join("a");

      const withCount = await join("b", 3);

      expect(withCount.gameId).not.toBe(noCount.gameId);
      expect(withCount.playerCount).toBe(3);
    });

    it("treats a null count as no count", async () => {
      await startServer();

      expect((await join("a", null)).playerCount).toBeNull();
    });

    it("leaves tables with no count to work as before", async () => {
      await startServer({ lobbyWaitMs: 5 });
      const bots = await joinAll(["a", "b", "c"]);
      const game = nextEvent<GameState>(bots[0].client, GameStateAction.State);

      await join("d");

      expect((await game).players).toHaveLength(4);
    });
  });

  describe("invalid counts", () => {
    const invalid: unknown[][] = [[2], [7], [0], [-3], [3.5], ["4"], [true], [{}], [[4]]];

    it.each(invalid)("rejects %j", async playerCount => {
      await startServer();
      const client = await connectClient();

      const error = await expectError(client, GameStateAction.Register, { name: "a", playerCount });

      expect(error).toBe("Player count must be 3-6");
      expect(gameServer.connectedBots.size).toBe(0);
      expect(gameServer.tables.size).toBe(0);
    });

    it("doesn't claim the name", async () => {
      await startServer();
      const client = await connectClient();
      await expectError(client, GameStateAction.Register, { name: "a", playerCount: 9 });

      const { token } = await join("a", 3);

      expect(token).toBeDefined();
    });
  });

  describe("the next game", () => {
    const finishGame = async () => {
      await startServer({ turnTimeoutMs: 1 });
      const bots = await joinAll(["a", "b"], 3);
      const last = await join("c", 3);
      const over = new Promise<void>(resolve => {
        bots[0].client.on(GameStateAction.State, (state: GameState) => {
          if (state.gameOver) resolve();
        });
      });
      await over;
      return { bot: last, first: bots[0] };
    };

    it("can ask for a different count on the same connection", async () => {
      const { first } = await finishGame();

      const registered = nextEvent<Registered>(first.client, GameStateAction.Registered);
      first.client.emit(GameStateAction.Register, { playerCount: 5 });

      expect((await registered).playerCount).toBe(5);
    }, 15000);

    it("rejects an invalid count on the same connection", async () => {
      const { first } = await finishGame();

      const error = await expectError(first.client, GameStateAction.Register, { playerCount: 9 });

      expect(error).toBe("Player count must be 3-6");
      expect(gameServer.tables.size).toBe(0);
    }, 15000);
  });

  it("keeps a reconnecting bot at its table whatever count it sends", async () => {
    await startServer();
    const { client, gameId, token } = await join("a", 3);
    expect(gameServer.tables.size).toBe(1);

    const replacement = await connectClient();
    const registered = nextEvent<Registered>(replacement, GameStateAction.Registered);
    replacement.emit(GameStateAction.Register, { name: "a", token, playerCount: 5 });

    expect(await registered).toMatchObject({ gameId, playerCount: 3 });
    expect(gameServer.tables.size).toBe(1);
    client.close();
  });
});
