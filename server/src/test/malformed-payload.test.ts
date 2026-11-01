import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { Deck } from "../wizard/deck";
import { Card, GamePlayAction, GameState, GameStateAction } from "../wizard/types";

const NAMES = ["a", "b", "c"];
const NOT_OBJECTS = [undefined, null, 5, "text", true];
const EMPTY_SHAPES = [[], {}];

describe("malformed payloads", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let clients: Socket[];
  let states: Map<Socket, GameState>;

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const currentClient = () =>
    clients[NAMES.indexOf(states.get(clients[0])!.nextAction!.playerId)];

  const sendAccepted = async (socket: Socket, action: GamePlayAction, payload: object) => {
    const updates = clients.map(c => nextEvent(c, GameStateAction.State));
    socket.emit(action, payload);
    await Promise.all(updates);
  };

  const sendRejected = (socket: Socket, action: GamePlayAction, ...args: unknown[]) => {
    const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
    socket.emit(action, ...args);
    return error;
  };

  const startGame = async (trump: Card) => {
    vi.spyOn(Deck.prototype, "shuffle").mockImplementationOnce(function (this: Deck) {
      this.cards[this.cards.length - 1 - NAMES.length] = trump;
    });

    const registered = new Promise<void>(resolve => {
      clients[0].on(GameStateAction.PlayersUpdated, (players: unknown[]) => {
        if (players.length === NAMES.length) resolve();
      });
    });
    clients.forEach((client, i) => client.emit(GameStateAction.Register, NAMES[i]));
    await registered;

    const started = clients.map(c => nextEvent(c, GameStateAction.State));
    clients[0].emit(GameStateAction.StartGame);
    await Promise.all(started);
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    gameServer = createGameServer();
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    const { port } = gameServer.server.address() as AddressInfo;

    states = new Map();
    clients = NAMES.map(() => connect(`http://localhost:${port}`, { transports: ["websocket"] }));
    clients.forEach(client => {
      client.on(GameStateAction.State, (state: GameState) => states.set(client, state));
    });
    await Promise.all(clients.map(c => nextEvent(c, "connect")));
  });

  afterEach(async () => {
    clients.forEach(client => client.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  it.each(Object.values(GamePlayAction))("%s without a payload before a game is ignored", async action => {
    clients[0].emit(action);

    const players = nextEvent<unknown[]>(clients[0], GameStateAction.PlayersUpdated);
    clients[0].emit(GameStateAction.Register, "a");
    expect(await players).toHaveLength(1);
  });

  it("rejects a message with no arguments", async () => {
    await startGame({ rank: "N" });

    const error = await sendRejected(currentClient(), GamePlayAction.SetForecast);

    expect(error).toBe("Invalid payload");
  });

  it.each(NOT_OBJECTS)("rejects payload %j for every action", async payload => {
    await startGame({ rank: "N" });
    const current = currentClient();

    for (const action of Object.values(GamePlayAction)) {
      expect(await sendRejected(current, action, payload)).toBe("Invalid payload");
    }
  });

  it.each(EMPTY_SHAPES)("rejects forecast payload %j, then accepts a valid one", async payload => {
    await startGame({ rank: "N" });
    const current = currentClient();

    expect(await sendRejected(current, GamePlayAction.SetForecast, payload)).toBe("Invalid forecast");

    await sendAccepted(current, GamePlayAction.SetForecast, { bid: 0 });
    expect(states.get(clients[0])!.round!.forecasts).toHaveLength(1);
  });

  it.each([{ bid: "1" }, { bid: null }, { bid: {} }])("rejects forecast %j", async payload => {
    await startGame({ rank: "N" });

    const error = await sendRejected(currentClient(), GamePlayAction.SetForecast, payload);

    expect(error).toBe("Invalid forecast");
  });

  it.each([{}, { color: 5 }, { color: null }, { color: "purple" }])("rejects trump %j", async payload => {
    await startGame({ rank: "Z" });

    const error = await sendRejected(currentClient(), GamePlayAction.SelectTrump, payload);

    expect(error).toBe("Invalid trump color");
  });

  describe("playCard", () => {
    const startPlaying = async () => {
      await startGame({ rank: "N" });
      for (let i = 0; i < NAMES.length; i++) {
        await sendAccepted(currentClient(), GamePlayAction.SetForecast, { bid: 0 });
      }
    };

    it.each([{}, { card: null }, { card: 5 }, { card: "Z" }])("rejects %j when leading", async payload => {
      await startPlaying();

      const error = await sendRejected(currentClient(), GamePlayAction.PlayCard, payload);

      expect(error).toBe("Invalid card");
    });

    it("rejects a missing card when following", async () => {
      await startPlaying();
      const leader = currentClient();
      await sendAccepted(leader, GamePlayAction.PlayCard, { card: states.get(leader)!.currentHand[0] });

      const error = await sendRejected(currentClient(), GamePlayAction.PlayCard, { card: null });

      expect(error).toBe("Invalid card");
    });

    it("rejects a card object that isn't a real card", async () => {
      await startPlaying();

      const error = await sendRejected(currentClient(), GamePlayAction.PlayCard, { card: {} });

      expect(error).toBe("Card not in hand");
    });
  });
});
