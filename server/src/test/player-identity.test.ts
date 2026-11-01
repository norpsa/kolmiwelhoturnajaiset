import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { Deck } from "../wizard/deck";
import { Card, GamePlayAction, GameState, GameStateAction } from "../wizard/types";

const NAMES = ["a", "b", "c"];

describe("clients can only act as themselves", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let clients: Socket[];
  let states: Map<Socket, GameState>;

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const latestState = () => states.get(clients[0])!;
  const clientByName = (name: string | undefined) => clients[NAMES.indexOf(name!)];
  const currentClient = () => clientByName(latestState().nextAction?.playerId);
  const otherClient = (socket: Socket) => clients.find(c => c !== socket)!;
  const handOf = (socket: Socket) => states.get(socket)!.currentHand;

  // Resolves when every client has received the state caused by the action
  const sendAccepted = async (socket: Socket, action: GamePlayAction, payload: object) => {
    const updates = clients.map(c => nextEvent(c, GameStateAction.State));
    socket.emit(action, payload);
    await Promise.all(updates);
  };

  // Resolves with the error sent to the client. Times out if the action was accepted.
  const sendRejected = (socket: Socket, action: GamePlayAction, payload: object) => {
    const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
    socket.emit(action, payload);
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

  const forecastAll = async () => {
    await sendAccepted(currentClient(), GamePlayAction.SetForecast, { bid: 0 });
    await sendAccepted(currentClient(), GamePlayAction.SetForecast, { bid: 0 });
    await sendAccepted(currentClient(), GamePlayAction.SetForecast, { bid: 0 });
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

  describe("setForecast", () => {
    it("rejects a forecast sent with the current player's id by another client", async () => {
      await startGame({ rank: "N" });
      const current = currentClient();

      const error = await sendRejected(otherClient(current), GamePlayAction.SetForecast, {
        playerId: current.id,
        bid: 0,
      });

      expect(error).toBe("Not this player's turn");
      expect(latestState().round!.forecasts).toEqual([]);
    });

    it("records the forecast for the sender, not the player id in the message", async () => {
      await startGame({ rank: "N" });
      const current = currentClient();

      await sendAccepted(current, GamePlayAction.SetForecast, {
        playerId: otherClient(current).id,
        bid: 0,
      });

      expect(latestState().round!.forecasts).toEqual([{ playerId: current.id, bid: 0 }]);
    });
  });

  describe("selectTrump", () => {
    it("rejects a trump color sent with the dealer's id by another client", async () => {
      await startGame({ rank: "Z" });
      const dealer = currentClient();

      const error = await sendRejected(otherClient(dealer), GamePlayAction.SelectTrump, {
        playerId: dealer.id,
        color: "elves",
      });

      expect(error).toBe("Not this player's turn");
      expect(latestState().round!.trumpColor).toBeNull();
    });

    it("lets the dealer choose even if the message names another player", async () => {
      await startGame({ rank: "Z" });
      const dealer = currentClient();

      await sendAccepted(dealer, GamePlayAction.SelectTrump, {
        playerId: otherClient(dealer).id,
        color: "elves",
      });

      expect(latestState().round!.trumpColor).toBe("elves");
    });
  });

  describe("playCard", () => {
    it("rejects a card sent with the current player's id by another client", async () => {
      await startGame({ rank: "N" });
      await forecastAll();
      const current = currentClient();

      const error = await sendRejected(otherClient(current), GamePlayAction.PlayCard, {
        playerId: current.id,
        card: handOf(current)[0],
      });

      expect(error).toBe("Not this player's turn");
      expect(latestState().round!.tricks).toEqual([]);
      expect(handOf(current)).toHaveLength(1);
    });

    it("plays the sender's card, not the player id in the message", async () => {
      await startGame({ rank: "N" });
      await forecastAll();
      const current = currentClient();
      const card = handOf(current)[0];

      await sendAccepted(current, GamePlayAction.PlayCard, {
        playerId: otherClient(current).id,
        card,
      });

      expect(latestState().round!.tricks[0].plays).toEqual([{ playerId: current.id, card }]);
    });
  });
});
