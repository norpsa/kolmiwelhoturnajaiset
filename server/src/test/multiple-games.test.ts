import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, Socket } from "socket.io-client";
import { createGameServer } from "../game-server";
import { Deck } from "../wizard/deck";
import { GamePlayAction, GameState, GameStateAction, RegisteredPlayer } from "../wizard/types";

describe("multiple games", () => {
  let gameServer: ReturnType<typeof createGameServer>;
  let port: number;
  let openClients: Socket[];

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>(resolve => socket.once(event, resolve));

  const connectClients = async (count: number) => {
    const clients = Array.from({ length: count }, () =>
      connect(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false })
    );
    openClients.push(...clients);
    await Promise.all(clients.map(c => nextEvent(c, "connect")));
    return clients;
  };

  const registerOne = (client: Socket, name: string) => {
    const registered = nextEvent<{ gameId: string }>(client, GameStateAction.Registered);
    client.emit(GameStateAction.Register, name);
    return registered.then(({ gameId }) => gameId);
  };

  const register = async (clients: Socket[]) => {
    const gameIds: string[] = [];
    for (const [i, client] of clients.entries()) {
      gameIds.push(await registerOne(client, `player${i}`));
    }
    return gameIds;
  };

  const start = async (clients: Socket[]) => {
    const states = clients.map(c => nextEvent<GameState>(c, GameStateAction.State));
    clients[0].emit(GameStateAction.StartGame);
    return Promise.all(states);
  };

  const expectError = (socket: Socket, event: string, payload?: unknown) => {
    const error = nextEvent<string>(socket, GameStateAction.ErrorMessage);
    socket.emit(event, payload);
    return error;
  };

  // Plays every turn of one player until the game ends. A rejected move is
  // retried with the next option, which finds a legal bid or card.
  const autoPlay = (socket: Socket, name: string, firstState: GameState) =>
    new Promise<GameState>(resolve => {
      let state = firstState;
      let attempt = 0;

      const act = () => {
        if (state.gameOver) return resolve(state);
        if (state.nextAction?.playerId !== name) return;

        const tryNumber = attempt++;
        if (state.nextAction.action === GamePlayAction.SelectTrump) {
          socket.emit(GamePlayAction.SelectTrump, { color: "elves" });
        } else if (state.nextAction.action === GamePlayAction.SetForecast) {
          socket.emit(GamePlayAction.SetForecast, { bid: tryNumber });
        } else {
          socket.emit(GamePlayAction.PlayCard, { card: state.currentHand[tryNumber] });
        }
      };

      socket.on(GameStateAction.State, (newState: GameState) => {
        state = newState;
        attempt = 0;
        act();
      });
      socket.on(GameStateAction.ErrorMessage, act);
      act();
    });

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    openClients = [];

    gameServer = createGameServer();
    await new Promise<void>(resolve => gameServer.server.listen(0, resolve));
    port = (gameServer.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    openClients.forEach(client => client.close());
    await gameServer.io.close();
    vi.restoreAllMocks();
  });

  it("plays different sized games to the end at the same time", async () => {
    const clientsA = await connectClients(3);
    const clientsB = await connectClients(4);
    await register(clientsA);
    const startedA = await start(clientsA);
    await register(clientsB);
    const startedB = await start(clientsB);

    // Both games are running before anyone makes a move
    const finishedA = clientsA.map((c, i) => autoPlay(c, `player${i}`, startedA[i]));
    const finishedB = clientsB.map((c, i) => autoPlay(c, `player${i}`, startedB[i]));
    const [stateA, stateB] = await Promise.all([Promise.all(finishedA), Promise.all(finishedB)]);

    const idsOf = (clients: Socket[]) => clients.map(c => c.id).sort();
    expect(stateA[0].totalRounds).toBe(20);
    expect(stateA[0].round!.roundNumber).toBe(20);
    expect(Object.keys(stateA[0].scores).sort()).toEqual(idsOf(clientsA));
    expect(stateB[0].totalRounds).toBe(15);
    expect(stateB[0].round!.roundNumber).toBe(15);
    expect(Object.keys(stateB[0].scores).sort()).toEqual(idsOf(clientsB));
  }, 10000);

  it("sends game state only to the players of that game", async () => {
    vi.spyOn(Deck.prototype, "shuffle").mockImplementation(function (this: Deck) {
      this.cards[this.cards.length - 4] = { rank: "N" };
    });
    const clientsA = await connectClients(3);
    const clientsB = await connectClients(3);
    await register(clientsA);
    const statesA = await start(clientsA);
    await register(clientsB);
    const statesB = await start(clientsB);

    const statesSeenInB = vi.fn();
    clientsB.forEach(c => c.on(GameStateAction.State, statesSeenInB));

    const firstInA = clientsA[Number(statesA[0].nextAction!.playerId.slice(-1))];
    const updatesA = clientsA.map(c => nextEvent<GameState>(c, GameStateAction.State));
    firstInA.emit(GamePlayAction.SetForecast, { bid: 0 });
    const [updatedA] = await Promise.all(updatesA);
    expect(updatedA.round!.forecasts).toEqual([{ playerId: firstInA.id, bid: 0 }]);

    // A state leaked from game a would reach game b before the answer to this action
    const firstInB = clientsB[Number(statesB[0].nextAction!.playerId.slice(-1))];
    const updatesB = clientsB.map(c => nextEvent<GameState>(c, GameStateAction.State));
    firstInB.emit(GamePlayAction.SetForecast, { bid: 0 });
    const [updatedB] = await Promise.all(updatesB);

    expect(updatedB.round!.forecasts).toEqual([{ playerId: firstInB.id, bid: 0 }]);
    expect(statesSeenInB).toHaveBeenCalledTimes(3);
  });

  it("sends player lists only to the players of that game", async () => {
    const clientsA = await connectClients(3);
    const [inB] = await connectClients(1);
    await register(clientsA);
    await start(clientsA);

    const listsSeenInA = vi.fn();
    clientsA.forEach(c => c.on(GameStateAction.PlayersUpdated, listsSeenInA));

    const update = nextEvent<RegisteredPlayer[]>(inB, GameStateAction.PlayersUpdated);
    await registerOne(inB, "other");

    expect(await update).toEqual([{ id: inB.id, name: "other" }]);
    expect(listsSeenInA).not.toHaveBeenCalled();
  });

  it("generates the game id and seats players at the open game", async () => {
    const clients = await connectClients(3);

    const gameIds = await register(clients);

    expect(gameIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(gameIds).size).toBe(1);
  });

  it("opens a new game once the open game has started", async () => {
    const clients = await connectClients(3);
    const [gameId] = await register(clients);
    await start(clients);

    const [late] = await connectClients(1);

    expect(await registerOne(late, "late")).not.toBe(gameId);
  });

  it("opens a new game once the open game is full", async () => {
    const clients = await connectClients(7);

    const gameIds = await register(clients);

    expect(new Set(gameIds.slice(0, 6)).size).toBe(1);
    expect(gameIds[6]).not.toBe(gameIds[0]);
  });

  it("starts a game by itself when the table is full", async () => {
    const clients = await connectClients(6);
    const started = clients.map(c => nextEvent(c, GameStateAction.GameStarted));
    const states = clients.map(c => nextEvent<GameState>(c, GameStateAction.State));

    await register(clients);
    await Promise.all(started);

    for (const state of await Promise.all(states)) {
      expect(state.players).toHaveLength(6);
      expect(state.totalRounds).toBe(10);
    }
  });

  it("tells the last player about the seat before the game starts", async () => {
    const clients = await connectClients(6);
    await register(clients.slice(0, 5));

    const events: string[] = [];
    clients[5].onAny(event => events.push(event));
    const state = nextEvent(clients[5], GameStateAction.State);
    clients[5].emit(GameStateAction.Register, "last");
    await state;

    expect(events).toEqual([
      GameStateAction.Registered,
      GameStateAction.PlayersUpdated,
      GameStateAction.GameStarted,
      GameStateAction.State,
    ]);
  });

  it("doesn't start a game by itself before the table is full", async () => {
    const clients = await connectClients(5);
    const onStarted = vi.fn();
    clients.forEach(c => c.on(GameStateAction.GameStarted, onStarted));

    await register(clients);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onStarted).not.toHaveBeenCalled();

    await start(clients);
    expect(onStarted).toHaveBeenCalledTimes(5);
  });

  it("rejects a manual start of a game that started by itself", async () => {
    const clients = await connectClients(6);
    const state = nextEvent(clients[0], GameStateAction.State);
    await register(clients);
    await state;

    expect(await expectError(clients[0], GameStateAction.StartGame)).toBe("Game already started");
  });

  it("generates a different id for every game", async () => {
    const clientsA = await connectClients(3);
    const clientsB = await connectClients(3);
    const [gameIdA] = await register(clientsA);
    await start(clientsA);
    const [gameIdB] = await register(clientsB);

    expect(gameIdB).not.toBe(gameIdA);
  });

  it("a starter counts only the players of its own game", async () => {
    const clientsA = await connectClients(3);
    const clientsB = await connectClients(2);
    await register(clientsA);
    await start(clientsA);
    await register(clientsB);

    expect(await expectError(clientsB[0], GameStateAction.StartGame)).toBe("Need 3-6 players to start");
  });

  it("a connection can only be in one game", async () => {
    const [client] = await connectClients(1);
    const [gameId] = await register([client]);

    const error = await expectError(client, GameStateAction.Register, "again");

    expect(error).toBe(`Already registered to game ${gameId}`);
  });

  it("removes a started game when its last player leaves", async () => {
    const clients = await connectClients(3);
    await register(clients);
    await start(clients);
    expect(gameServer.tables.size).toBe(1);

    clients.forEach(c => c.close());

    await vi.waitFor(() => expect(gameServer.tables.size).toBe(0));
  });

  it("a player joining after the open game emptied gets a new game", async () => {
    const [leaves, newcomer] = await connectClients(2);
    const [gameId] = await register([leaves]);

    leaves.close();
    await vi.waitFor(() => expect(gameServer.tables.size).toBe(0));

    expect(await registerOne(newcomer, "new")).not.toBe(gameId);
  });

  it("keeps a game open while someone is still in it", async () => {
    const [stays, leaves, newcomer] = await connectClients(3);
    const [gameId] = await register([stays, leaves]);

    const left = new Promise<RegisteredPlayer[]>(resolve => {
      stays.on(GameStateAction.PlayersUpdated, (players: RegisteredPlayer[]) => {
        if (players.length === 1) resolve(players);
      });
    });
    leaves.close();
    expect(await left).toEqual([{ id: stays.id, name: "player0" }]);

    expect(await registerOne(newcomer, "new")).toBe(gameId);
  });

  it.each([[undefined], [null], [5], [""], [{}], [{ name: "a" }]])("rejects registration %j", async payload => {
    const [client] = await connectClients(1);

    const error = await expectError(client, GameStateAction.Register, payload);

    expect(error).toBe("Register needs a name");
  });

  it("ignores game actions from a connection that isn't in a game", async () => {
    const clients = await connectClients(3);
    const [outsider] = await connectClients(1);
    await register(clients);
    await start(clients);

    outsider.emit(GamePlayAction.SetForecast, { bid: 0 });

    expect(await expectError(outsider, GameStateAction.StartGame)).toBe(
      "You must be registered to start the game"
    );
  });
});
