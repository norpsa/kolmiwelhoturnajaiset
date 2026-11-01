import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { Deck } from "../wizard/deck";
import { GameEngine } from "../wizard/game-engine";
import { Card, GamePlayAction, GameState, GameStateAction } from "../wizard/types";

const TIMED_OUT = "Turn timed out, a move was played for you";
const NEVER = 60000;

describe("stalled games", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let clients: Socket[];
  let latest: Map<Socket, GameState>;

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

  const seatIndex = (state: GameState) => Number(state.nextAction!.playerId.slice(-1));
  const currentClient = () => clients[seatIndex(latest.get(clients[0])!)];

  const startGame = async (turnTimeoutMs: number, trump: Card = { rank: "N" }) => {
    vi.spyOn(Deck.prototype, "shuffle").mockImplementation(function (this: Deck) {
      this.cards[this.cards.length - 4] = trump;
    });

    gameServer = createGameServer({ turnTimeoutMs });
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    const { port } = gameServer.server.address() as AddressInfo;

    latest = new Map();
    clients = [0, 1, 2].map(() => connect(`http://localhost:${port}`, { transports: ["websocket"] }));
    await Promise.all(clients.map(c => nextEvent(c, "connect")));
    clients.forEach(c => c.on(GameStateAction.State, (state: GameState) => latest.set(c, state)));

    for (const [i, client] of clients.entries()) {
      const registered = nextEvent(client, GameStateAction.Registered);
      client.emit(GameStateAction.Register, `player${i}`);
      await registered;
    }

    const started = clients.map(c => nextEvent(c, GameStateAction.State));
    clients[0].emit(GameStateAction.StartGame);
    await Promise.all(started);
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    clients.forEach(c => c.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  describe("players who don't answer", () => {
    it("plays a forecast for them and tells only them", async () => {
      await startGame(30);
      const idle = currentClient();
      const others = clients.filter(c => c !== idle);
      const onOtherError = vi.fn();
      others.forEach(c => c.on(GameStateAction.ErrorMessage, onOtherError));

      const error = nextEvent<string>(idle, GameStateAction.ErrorMessage);
      const state = await stateMatching(idle, s => s.round!.forecasts.length === 1);

      expect(await error).toBe(TIMED_OUT);
      expect(state.round!.forecasts).toEqual([{ playerId: idle.id, bid: 0 }]);
      expect(onOtherError).not.toHaveBeenCalled();
    });

    it("selects trump for an idle dealer", async () => {
      await startGame(30, { rank: "Z" });

      const state = await stateMatching(clients[0], s => s.round!.trumpColor !== null);

      expect(state.round!.trumpColor).toBe("humans");
    });

    it("plays a card for them", async () => {
      await startGame(30);
      const state = await stateMatching(clients[0], s => s.round!.tricks.length === 1);

      expect(state.round!.forecasts).toHaveLength(3);
      expect(state.round!.tricks[0].plays).toHaveLength(1);
    });

    it("finishes a whole game when nobody answers", async () => {
      await startGame(1);

      const final = await stateMatching(clients[0], s => s.gameOver);

      expect(final.round!.roundNumber).toBe(20);
      expect(final.nextAction).toBeNull();
    }, 15000);

    it("doesn't play for a player who answers in time", async () => {
      await startGame(150);
      const player = currentClient();
      const onError = vi.fn();
      player.on(GameStateAction.ErrorMessage, onError);

      const update = stateMatching(player, s => s.round!.forecasts.length === 1);
      player.emit(GamePlayAction.SetForecast, { bid: 1 });
      const state = await update;

      expect(state.round!.forecasts).toEqual([{ playerId: player.id, bid: 1 }]);
      expect(onError).not.toHaveBeenCalled();
    });

    it("gives every player a full turn after a move", async () => {
      await startGame(300);
      const first = currentClient();

      await new Promise(resolve => setTimeout(resolve, 200));
      const update = stateMatching(first, s => s.round!.forecasts.length === 1);
      first.emit(GamePlayAction.SetForecast, { bid: 1 });
      await update;
      const moved = Date.now();

      await stateMatching(first, s => s.round!.forecasts.length === 2);

      expect(Date.now() - moved).toBeGreaterThan(250);
    });

    it("rejected moves don't buy more time", async () => {
      await startGame(300);
      const idle = currentClient();
      const started = Date.now();

      await new Promise(resolve => setTimeout(resolve, 200));
      const rejected = nextEvent<string>(idle, GameStateAction.ErrorMessage);
      idle.emit(GamePlayAction.SetForecast, { bid: 99 });
      expect(await rejected).toBe("Invalid forecast");

      await stateMatching(idle, s => s.round!.forecasts.length === 1);

      expect(Date.now() - started).toBeLessThan(450);
    });

    it("stops the turn timer when the game is over", async () => {
      await startGame(1);
      await stateMatching(clients[0], s => s.gameOver);
      const move = vi.spyOn(GameEngine.prototype, "playDefaultMove");

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(move).not.toHaveBeenCalled();
    }, 15000);
  });

  describe("players who leave", () => {
    it("moves on at once when the current player disconnects", async () => {
      await startGame(NEVER);
      const leaver = currentClient();
      const stayer = clients.find(c => c !== leaver)!;

      const update = stateMatching(stayer, s => s.round!.forecasts.length === 1);
      leaver.close();
      const state = await update;

      expect(state.round!.forecasts[0].playerId).not.toBe(stayer.id);
      expect(state.round!.forecasts[0].bid).toBe(0);
    });

    it("skips a disconnected player when their turn comes", async () => {
      await startGame(NEVER);
      const seat = seatIndex(latest.get(clients[0])!);
      const current = clients[seat];
      const leaver = clients[(seat + 1) % 3];

      const left = nextEvent(current, GameStateAction.PlayersUpdated);
      leaver.close();
      await left;

      const update = stateMatching(current, s => s.round!.forecasts.length === 2);
      current.emit(GamePlayAction.SetForecast, { bid: 0 });
      const state = await update;

      expect(state.round!.forecasts[0].playerId).toBe(current.id);
      expect(state.nextAction!.playerId).toBe(`player${(seat + 2) % 3}`);
    });

    it("finishes the game for the last player left", async () => {
      await startGame(1);
      const [stays, ...leave] = clients;
      const final = stateMatching(stays, s => s.gameOver);

      leave.forEach(c => c.close());

      expect((await final).round!.roundNumber).toBe(20);
    }, 15000);

    it("stops the turn timer when everyone has left", async () => {
      await startGame(150);
      clients.forEach(c => c.close());
      await vi.waitFor(() => expect(gameServer.tables.size).toBe(0), { interval: 5 });
      const move = vi.spyOn(GameEngine.prototype, "playDefaultMove");

      // Longer than the turn timer, which is running if it wasn't stopped
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(move).not.toHaveBeenCalled();
    });
  });
});
