import { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { GameEngine, MAX_PLAYERS, MIN_PLAYERS } from './wizard/game-engine';
import { GamePlayAction, GameStateAction, RegisteredPlayer } from './wizard/types';

interface GameTable {
  id: string;
  players: RegisteredPlayer[];
  game: GameEngine | null;
  turnTimer?: NodeJS.Timeout;
}

interface GameServerOptions {
  turnTimeoutMs?: number;
}

const DEFAULT_TURN_TIMEOUT_MS = 10000;

export const createGameServer = ({ turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS }: GameServerOptions = {}) => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  const tables = new Set<GameTable>();

  io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // A connection plays one game at a time
    let table: GameTable | null = null;

    socket.on(GameStateAction.Register, (name: unknown) => {
      if (typeof name !== 'string' || !name) {
        socket.emit(GameStateAction.ErrorMessage, 'Register needs a name');
        return;
      }
      if (table) {
        socket.emit(GameStateAction.ErrorMessage, `Already registered to game ${table.id}`);
        return;
      }

      // Players wait at the open table. A new one opens when it starts, which happens
      // at the latest when it fills up.
      let joined = [...tables].find(t => !t.game);
      if (!joined) {
        joined = { id: randomUUID(), players: [], game: null };
        tables.add(joined);
      }

      joined.players.push({ id: socket.id, name });
      table = joined;
      socket.join(joined.id);
      console.log(`Player registered: ${name} to game ${joined.id}`);
      socket.emit(GameStateAction.Registered, { gameId: joined.id });
      io.to(joined.id).emit(GameStateAction.PlayersUpdated, joined.players);

      if (joined.players.length === MAX_PLAYERS) startGame(joined);
    });

    socket.on(GameStateAction.StartGame, () => {
      if (!table) {
        socket.emit(GameStateAction.ErrorMessage, 'You must be registered to start the game');
        return;
      }
      if (table.game) {
        socket.emit(GameStateAction.ErrorMessage, 'Game already started');
        return;
      }
      if (table.players.length < MIN_PLAYERS) {
        socket.emit(GameStateAction.ErrorMessage, `Need ${MIN_PLAYERS}-${MAX_PLAYERS} players to start`);
        return;
      }

      startGame(table);
    });

    // Payloads come from bots, so they can't be trusted to have the expected shape.
    // Actions always apply to the sender, so a client can't act for another player.
    const onGameAction = (
      action: GamePlayAction,
      handle: (game: GameEngine, payload: Record<string, any>) => void
    ) => {
      socket.on(action, (payload: unknown) => {
        if (!table?.game) return;
        try {
          if (typeof payload !== 'object' || payload === null) {
            throw new Error('Invalid payload');
          }
          handle(table.game, payload);
          startTurn(table);
        } catch (err: any) {
          socket.emit(GameStateAction.ErrorMessage, err.message);
        }
      });
    };

    onGameAction(GamePlayAction.SetForecast, (game, { bid }) => {
      console.log(socket.id, bid);
      game.setForecast(socket.id, bid);
    });

    onGameAction(GamePlayAction.SelectTrump, (game, { color }) => {
      game.setTrump(socket.id, color);
    });

    onGameAction(GamePlayAction.PlayCard, (game, { card }) => {
      game.playCard(socket.id, card);
    });

    socket.on('disconnect', () => {
      console.log('Player disconnected:', socket.id);
      if (!table) return;

      table.players = table.players.filter(p => p.id !== socket.id);
      if (table.players.length === 0) {
        clearTimeout(table.turnTimer);
        tables.delete(table);
        return;
      }

      io.to(table.id).emit(GameStateAction.PlayersUpdated, table.players);
      if (table.game?.currentPlayerId === socket.id) startTurn(table);
    });
  });

  const startGame = (table: GameTable) => {
    table.game = new GameEngine(table.players);
    io.to(table.id).emit(GameStateAction.GameStarted);
    startTurn(table);
  };

  // Call after every move. Rejected moves don't get here, so they don't buy more time.
  const startTurn = (table: GameTable) => {
    clearTimeout(table.turnTimer);
    const game = table.game!;

    // Nobody is going to answer for players who have left
    const isConnected = (playerId: string) => table.players.some(p => p.id === playerId);
    while (game.currentPlayerId && !isConnected(game.currentPlayerId)) {
      game.playDefaultMove();
    }

    broadcastStates(table);

    const playerId = game.currentPlayerId;
    if (!playerId) return;

    table.turnTimer = setTimeout(() => {
      game.playDefaultMove();
      io.sockets.sockets
        .get(playerId)
        ?.emit(GameStateAction.ErrorMessage, 'Turn timed out, a move was played for you');
      startTurn(table);
    }, turnTimeoutMs);
  };

  const broadcastStates = (table: GameTable) => {
    for (const player of table.players) {
      io.sockets.sockets.get(player.id)?.emit(GameStateAction.State, table.game!.getState(player.id));
    }
  };

  return { server, io, tables };
};
