import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { BotRegistry } from "../bot-registry";
import { createGameServer } from "../game-server";
import { Deck } from "../wizard/deck";
import { GamePlayAction, GameState, GameStateAction } from "../wizard/types";

interface Registered {
  gameId: string;
  botId: string;
  name: string;
  token?: string;
}

const TAKEN = "Name is taken, a valid token is needed";
const NEVER = 60000;

describe("bot identity", () => {
  let servers: ReturnType<typeof createGameServer>[];
  let clients: Socket[];

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const stateMatching = (socket: Socket, matches: (state: GameState) => boolean) =>
    new Promise<GameState>(resolve => {
      const check = (state: GameState) => {
        if (matches(state)) {
          socket.off(GameStateAction.State, check);
          resolve(state);
        }
      };
      socket.on(GameStateAction.State, check);
    });

  const startServer = async (options: Parameters<typeof createGameServer>[0] = {}) => {
    const gameServer = createGameServer({ turnTimeoutMs: NEVER, ...options });
    servers.push(gameServer);
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    return gameServer;
  };

  const connectTo = async (gameServer: ReturnType<typeof createGameServer>) => {
    const { port } = gameServer.server.address() as AddressInfo;
    const client = connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false });
    clients.push(client);
    await nextEvent(client, "connect");
    return client;
  };

  const register = (client: Socket, name: string, token?: string) => {
    const registered = nextEvent<Registered>(client, GameStateAction.Registered);
    client.emit(GameStateAction.Register, { name, token });
    return registered;
  };

  const rejected = (client: Socket, name: string, token?: string) => {
    const error = nextEvent<string>(client, GameStateAction.ErrorMessage);
    client.emit(GameStateAction.Register, { name, token });
    return error;
  };

  // Three bots in a started game, where a Jester trump means forecasts come first
  const startGameWithThreeBots = async (gameServer: ReturnType<typeof createGameServer>) => {
    vi.spyOn(Deck.prototype, "shuffle").mockImplementation(function (this: Deck) {
      this.cards[this.cards.length - 4] = { rank: "N" };
    });

    const bots: { client: Socket; identity: Registered }[] = [];
    for (const name of ["a", "b", "c"]) {
      const client = await connectTo(gameServer);
      bots.push({ client, identity: await register(client, name) });
    }

    const states = bots.map(({ client }) => nextEvent<GameState>(client, GameStateAction.State));
    bots[0].client.emit(GameStateAction.StartGame);
    const [state] = await Promise.all(states);

    const current = bots.find(b => b.identity.name === state.nextAction!.playerId)!;
    return { bots, current, others: bots.filter(b => b !== current) };
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    servers = [];
    clients = [];
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    await Promise.all(servers.map(s => s.io.close()));
    vi.restoreAllMocks();
  });

  describe("claiming a name", () => {
    it("gives a free name an id and a token", async () => {
      const client = await connectTo(await startServer());

      const { botId, name, token } = await register(client, "alpha");

      expect(botId).toMatch(/^[0-9a-f-]{36}$/);
      expect(name).toBe("alpha");
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ["no token", undefined],
      ["a wrong token", "f".repeat(64)],
      ["a token of the wrong type", 5],
    ])("rejects a taken name with %s", async (_, token) => {
      const server = await startServer();
      await register(await connectTo(server), "alpha");

      const error = await rejected(await connectTo(server), "alpha", token as string);

      expect(error).toBe(TAKEN);
    });

    it("rejects another bot's token", async () => {
      const server = await startServer();
      const { token } = await register(await connectTo(server), "alpha");
      await register(await connectTo(server), "beta");

      expect(await rejected(await connectTo(server), "beta", token)).toBe(TAKEN);
    });

    it("treats names that differ only by case as the same name", async () => {
      const server = await startServer();
      await register(await connectTo(server), "Alpha");

      expect(await rejected(await connectTo(server), "aLPHA")).toBe(TAKEN);
    });

    it("doesn't seat a bot whose login failed", async () => {
      const server = await startServer();
      const { botId } = await register(await connectTo(server), "alpha");

      await rejected(await connectTo(server), "alpha");

      expect(server.connectedBots.size).toBe(1);
      expect([...server.tables][0].players.map(p => p.id)).toEqual([botId]);
    });

    it("never shows the token to other players", async () => {
      const server = await startServer();
      const first = await connectTo(server);
      const seen: unknown[] = [];
      first.onAny((_, ...args) => seen.push(args));
      await register(first, "first");

      const second = await connectTo(server);
      const players = nextEvent(first, GameStateAction.PlayersUpdated);
      const { token } = await register(second, "second");
      await players;

      expect(JSON.stringify(seen)).toContain("second");
      expect(JSON.stringify(seen)).not.toContain(token);
    });
  });

  describe("logging in again", () => {
    it("gives the same id and no new token", async () => {
      const server = await startServer();
      const first = await connectTo(server);
      const { botId, token } = await register(first, "alpha");
      first.close();
      await vi.waitFor(() => expect(server.connectedBots.size).toBe(0), { interval: 5 });

      const again = await register(await connectTo(server), "alpha", token);

      expect(again.botId).toBe(botId);
      expect(again.token).toBeUndefined();
    });

    it("uses the bot id in the game, so scores follow the bot", async () => {
      const server = await startServer();
      const { bots, current } = await startGameWithThreeBots(server);

      const state = stateMatching(current.client, s => s.round!.forecasts.length === 1);
      current.client.emit(GamePlayAction.SetForecast, { bid: 0 });
      const { scores, round } = await state;

      expect(Object.keys(scores).sort()).toEqual(bots.map(b => b.identity.botId).sort());
      expect(round!.forecasts[0].playerId).toBe(current.identity.botId);
    });
  });

  describe("reconnecting to a running game", () => {
    it("returns the bot to its game with its hand", async () => {
      const server = await startServer();
      const { others } = await startGameWithThreeBots(server);
      const [{ client, identity }] = others;
      client.close();
      await vi.waitFor(() => expect(server.connectedBots.size).toBe(2), { interval: 5 });

      const back = await connectTo(server);
      const state = nextEvent<GameState>(back, GameStateAction.State);
      const registered = await register(back, identity.name, identity.token);

      expect(registered.gameId).toBe(identity.gameId);
      expect(registered.botId).toBe(identity.botId);
      expect((await state).currentHand).toHaveLength(1);
    });

    it("lets the bot play its own turns again", async () => {
      const server = await startServer();
      const { current, others } = await startGameWithThreeBots(server);
      const [returning, stayer] = others;
      returning.client.close();
      await vi.waitFor(() => expect(server.connectedBots.size).toBe(2), { interval: 5 });

      const back = await connectTo(server);
      await register(back, returning.identity.name, returning.identity.token);

      // The bot is at the table, so the game waits for it in its turn
      const forecasts = async (count: number, player: Socket) => {
        const update = stateMatching(back, s => s.round!.forecasts.length === count);
        player.emit(GamePlayAction.SetForecast, { bid: 1 });
        return update;
      };
      const firstState = await forecasts(1, current.client);
      const isNext = firstState.nextAction!.playerId === returning.identity.name;
      const final = isNext
        ? await forecasts(2, back)
        : (await forecasts(2, stayer.client), await forecasts(3, back));

      const own = final.round!.forecasts.find(f => f.playerId === returning.identity.botId);
      expect(own).toEqual({ playerId: returning.identity.botId, bid: 1 });
    });

    it("moves a bot to a new connection without losing its turn", async () => {
      const server = await startServer();
      const { current } = await startGameWithThreeBots(server);
      const closed = nextEvent(current.client, "disconnect");

      const replacement = await connectTo(server);
      const state = nextEvent<GameState>(replacement, GameStateAction.State);
      const registered = await register(replacement, current.identity.name, current.identity.token);
      await closed;

      expect(registered.gameId).toBe(current.identity.gameId);
      const { round, nextAction } = await state;
      expect(round!.forecasts).toEqual([]);
      expect(nextAction!.playerId).toBe(current.identity.name);

      const update = stateMatching(replacement, s => s.round!.forecasts.length === 1);
      replacement.emit(GamePlayAction.SetForecast, { bid: 1 });
      expect((await update).round!.forecasts[0]).toEqual({ playerId: current.identity.botId, bid: 1 });
    });

    it("keeps a replaced bot's seat at a table that hasn't started", async () => {
      const server = await startServer();
      const first = await connectTo(server);
      const { gameId, token } = await register(first, "alpha");

      const replacement = await connectTo(server);
      const registered = await register(replacement, "alpha", token);

      expect(registered.gameId).toBe(gameId);
      expect([...server.tables][0].players).toHaveLength(1);
    });
  });

  describe("the next game", () => {
    const playGameToEnd = async (server: ReturnType<typeof createGameServer>) => {
      const { bots } = await startGameWithThreeBots(server);
      return bots;
    };

    it("lets a bot register again on the same connection when its game is over", async () => {
      const server = await startServer({ turnTimeoutMs: 1 });
      const bots = await playGameToEnd(server);
      await stateMatching(bots[0].client, s => s.gameOver);

      const next = await register(bots[0].client, bots[0].identity.name);

      expect(next.gameId).not.toBe(bots[0].identity.gameId);
      expect(next.botId).toBe(bots[0].identity.botId);
    }, 15000);

    it("seats a bot that logs in after its game is over", async () => {
      const server = await startServer({ turnTimeoutMs: 1 });
      const bots = await playGameToEnd(server);
      const { client, identity } = bots[0];
      await stateMatching(client, s => s.gameOver);
      client.close();
      await vi.waitFor(() => expect(server.connectedBots.size).toBe(2), { interval: 5 });

      const registered = await register(await connectTo(server), identity.name, identity.token);

      expect(registered.gameId).not.toBe(identity.gameId);
    }, 15000);

    it("closes the table when the game is over", async () => {
      const server = await startServer({ turnTimeoutMs: 1 });
      const bots = await playGameToEnd(server);

      await stateMatching(bots[0].client, s => s.gameOver);

      expect(server.tables.size).toBe(0);
    }, 15000);
  });

  describe("storing bots", () => {
    let directory: string;
    let file: string;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "bots-"));
      file = join(directory, "nested", "bots.json");
    });

    afterEach(() => {
      rmSync(directory, { recursive: true });
    });

    it("keeps bots over a server restart", async () => {
      const before = await startServer({ botRegistry: new BotRegistry(file) });
      const { botId, token } = await register(await connectTo(before), "alpha");

      const after = await startServer({ botRegistry: new BotRegistry(file) });

      const again = await register(await connectTo(after), "alpha", token);
      expect(again.botId).toBe(botId);
    });

    it("rejects a wrong token after a server restart", async () => {
      new BotRegistry(file).authenticate("alpha", undefined);

      const after = await startServer({ botRegistry: new BotRegistry(file) });

      expect(await rejected(await connectTo(after), "alpha", "wrong")).toBe(TAKEN);
    });

    it("doesn't store the token itself", () => {
      const { token } = new BotRegistry(file).authenticate("alpha", undefined);

      expect(token).toBeTruthy();
      expect(readFileSync(file, "utf8")).not.toContain(token);
    });

    it("keeps the file readable only by its owner", () => {
      new BotRegistry(file).authenticate("alpha", undefined);

      expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it("keeps earlier bots when a new one is added", () => {
      const first = new BotRegistry(file);
      const { token } = first.authenticate("alpha", undefined);
      first.authenticate("beta", undefined);

      expect(new BotRegistry(file).authenticate("alpha", token).bot.name).toBe("alpha");
    });

    it("tells the player and stays up when the file can't be written", async () => {
      const registry = new BotRegistry(join(directory, "bots.json"));
      vi.spyOn(registry as any, "save").mockImplementation(() => {
        throw new Error("Disk is full");
      });
      const server = await startServer({ botRegistry: registry });

      expect(await rejected(await connectTo(server), "alpha")).toBe("Disk is full");
      expect(server.connectedBots.size).toBe(0);
    });
  });
});
