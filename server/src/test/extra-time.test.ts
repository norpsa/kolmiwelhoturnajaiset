import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { Deck } from "../wizard/deck";
import { GamePlayAction, GameState, GameStateAction } from "../wizard/types";

const TIMED_OUT = "Turn timed out, a move was played for you";
const TURN = 60;
const EXTRA = 240;

interface Bot {
  client: Socket;
  name: string;
  botId: string;
  token: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("extra time", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let port: number;
  let clients: Socket[];
  let bots: Bot[];

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

  const forecasts = (count: number) => (state: GameState) => state.round!.forecasts.length === count;

  const connectClient = async () => {
    const client = connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false });
    clients.push(client);
    await nextEvent(client, "connect");
    return client;
  };

  // Returns the bots in turn order, the first of them on turn. A Jester trump means
  // that everyone forecasts first, and the first to forecast also leads the first trick.
  const startGame = async (turnTimeoutMs = TURN, extraTimeMs = EXTRA) => {
    vi.spyOn(Deck.prototype, "shuffle").mockImplementation(function (this: Deck) {
      this.cards[this.cards.length - 4] = { rank: "N" };
    });

    gameServer = createGameServer({ turnTimeoutMs, extraTimeMs });
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    port = (gameServer.server.address() as AddressInfo).port;

    bots = [];
    for (const name of ["a", "b", "c"]) {
      const client = await connectClient();
      const registered = nextEvent<{ botId: string; token: string }>(client, GameStateAction.Registered);
      client.emit(GameStateAction.Register, { name });
      bots.push({ client, name, ...(await registered) });
    }

    const started = bots.map(b => nextEvent<GameState>(b.client, GameStateAction.State));
    bots[0].client.emit(GameStateAction.StartGame);
    const [state] = await Promise.all(started);

    const first = bots.findIndex(b => b.name === state.nextAction!.playerId);
    return [...bots.slice(first), ...bots.slice(0, first)];
  };

  const forecast = async ([first, second, third]: Bot[]) => {
    for (const [i, bot] of [first, second, third].entries()) {
      const update = stateMatching(first.client, forecasts(i + 1));
      bot.client.emit(GamePlayAction.SetForecast, { bid: 0 });
      await update;
    }
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    clients = [];
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  describe("a bot that doesn't answer", () => {
    it("gets its extra time after the turn time", async () => {
      const [idle, other] = await startGame();
      const startedAt = Date.now();

      const error = nextEvent<string>(idle.client, GameStateAction.ErrorMessage);
      await stateMatching(other.client, forecasts(1));

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TURN + EXTRA - 10);
      expect(await error).toBe(TIMED_OUT);
    });

    it("has only the turn time left after the extra time has run out", async () => {
      const [idle, second, third] = await startGame();
      await stateMatching(second.client, forecasts(1));
      await sleep(0);

      const secondUpdate = stateMatching(idle.client, forecasts(2));
      second.client.emit(GamePlayAction.SetForecast, { bid: 0 });
      await secondUpdate;
      const thirdUpdate = stateMatching(idle.client, forecasts(3));
      third.client.emit(GamePlayAction.SetForecast, { bid: 0 });
      await thirdUpdate;
      const startedAt = Date.now();

      await stateMatching(idle.client, s => s.round!.tricks.length === 1);

      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(TURN - 10);
      expect(elapsed).toBeLessThan(TURN + EXTRA / 2);
    });
  });

  describe("a bot that answers", () => {
    it("can answer during its extra time", async () => {
      const [late] = await startGame();
      const onError = vi.fn();
      late.client.on(GameStateAction.ErrorMessage, onError);

      await sleep(TURN + EXTRA / 2);
      const update = stateMatching(late.client, forecasts(1));
      late.client.emit(GamePlayAction.SetForecast, { bid: 1 });

      expect((await update).round!.forecasts[0]).toEqual({ playerId: late.botId, bid: 1 });
      expect(onError).not.toHaveBeenCalled();
    });

    it("loses only the extra time it used", async () => {
      const order = await startGame();
      const [late] = order;

      await sleep(TURN + EXTRA / 2);
      await forecast(order);
      const startedAt = Date.now();

      await stateMatching(late.client, s => s.round!.tricks.length === 1);

      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(TURN + EXTRA / 2 - 40);
      expect(elapsed).toBeLessThan(TURN + EXTRA - 40);
    });

    it("keeps all of its extra time when it answers in the turn time", async () => {
      const order = await startGame();
      const [quick] = order;

      await forecast(order);
      const startedAt = Date.now();

      await stateMatching(quick.client, s => s.round!.tricks.length === 1);

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TURN + EXTRA - 10);
    });

    it("has its own extra time, not shared with others", async () => {
      const [late, other] = await startGame();

      await sleep(TURN + EXTRA - 40);
      const update = stateMatching(late.client, forecasts(1));
      late.client.emit(GamePlayAction.SetForecast, { bid: 0 });
      await update;
      const startedAt = Date.now();

      await stateMatching(other.client, forecasts(2));

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TURN + EXTRA - 10);
    });

    it("doesn't get more time from a rejected move", async () => {
      const [idle, other] = await startGame();
      const startedAt = Date.now();

      await sleep(TURN + EXTRA / 2);
      const rejected = nextEvent<string>(idle.client, GameStateAction.ErrorMessage);
      idle.client.emit(GamePlayAction.SetForecast, { bid: 99 });
      expect(await rejected).toBe("Invalid forecast");

      await stateMatching(other.client, forecasts(1));

      expect(Date.now() - startedAt).toBeLessThan(TURN + EXTRA + EXTRA / 3);
    });
  });

  describe("a bot that disconnects", () => {
    it("isn't played for while it has extra time left", async () => {
      const [leaver, other] = await startGame();
      const startedAt = Date.now();

      leaver.client.close();
      await stateMatching(other.client, forecasts(1));

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TURN + EXTRA - 10);
    });

    it("can come back and play its own turn", async () => {
      const [leaver] = await startGame();
      leaver.client.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(2), { interval: 5 });
      await sleep(TURN);

      const back = await connectClient();
      const returned = nextEvent(back, GameStateAction.State);
      back.emit(GameStateAction.Register, { name: leaver.name, token: leaver.token });
      await returned;

      const update = stateMatching(back, forecasts(1));
      back.emit(GamePlayAction.SetForecast, { bid: 1 });

      expect((await update).round!.forecasts[0]).toEqual({ playerId: leaver.botId, bid: 1 });
    });

    it("doesn't restart the clock by reconnecting", async () => {
      const [leaver, other] = await startGame();
      const startedAt = Date.now();
      leaver.client.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(2), { interval: 5 });
      await sleep(TURN + EXTRA / 2);

      const back = await connectClient();
      const returned = nextEvent(back, GameStateAction.State);
      back.emit(GameStateAction.Register, { name: leaver.name, token: leaver.token });
      await returned;

      await stateMatching(other.client, forecasts(1));

      expect(Date.now() - startedAt).toBeLessThan(TURN + EXTRA + EXTRA / 3);
    });

    it("is played for at once when its extra time has run out", async () => {
      const [leaver, second, third] = await startGame(NEVER_TURN, 0);
      await forecast([leaver, second, third]);
      const update = stateMatching(second.client, s => s.round!.tricks.length === 1);

      leaver.client.close();

      expect((await update).round!.tricks[0].plays).toHaveLength(1);
    });

    it("loses its turn to a timeout if it doesn't come back", async () => {
      const [leaver, second] = await startGame();
      leaver.client.close();

      const state = await stateMatching(second.client, forecasts(1));

      expect(state.round!.forecasts[0]).toEqual({ playerId: leaver.botId, bid: 0 });
      expect(state.nextAction!.playerId).toBe(second.name);
    });

    it("plays out the game at once when everyone has left", async () => {
      const order = await startGame(NEVER_TURN, NEVER_TURN);
      const [current, ...others] = order;

      current.client.close();
      await vi.waitFor(() => expect(gameServer.connectedBots.size).toBe(2), { interval: 5 });
      expect(gameServer.tables.size).toBe(1);

      others.forEach(b => b.client.close());

      await vi.waitFor(() => expect(gameServer.tables.size).toBe(0), { interval: 5 });
    });
  });
});

const NEVER_TURN = 600000;
