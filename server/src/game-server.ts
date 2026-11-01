import { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { Bot, BotRegistry, isValidBotName } from './bot-registry';
import { GameEngine, MAX_PLAYERS, MIN_PLAYERS } from './wizard/game-engine';
import { GamePlayAction, GameStateAction, RegisteredPlayer } from './wizard/types';

interface GameTable {
  id: string;
  // Once the game has started, bots keep their seat if they disconnect
  players: RegisteredPlayer[];
  game: GameEngine | null;
  turnTimer?: NodeJS.Timeout;
}

interface GameServerOptions {
  turnTimeoutMs?: number;
  botRegistry?: BotRegistry;
}

const DEFAULT_TURN_TIMEOUT_MS = 10000;

export const createGameServer = ({
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  botRegistry = new BotRegistry(),
}: GameServerOptions = {}) => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  const tables = new Set<GameTable>();
  // A bot has one connection and sits at one table at a time
  const connectedBots = new Map<string, Socket>();
  const botTables = new Map<string, GameTable>();

  io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    let bot: Bot | null = null;

    const seatAtOpenTable = (seated: Bot, token?: string) => {
      // Players wait at the open table. A new one opens when it starts, which happens
      // at the latest when it fills up.
      let joined = [...tables].find(t => !t.game);
      if (!joined) {
        joined = { id: randomUUID(), players: [], game: null };
        tables.add(joined);
      }

      joined.players.push({ id: seated.id, name: seated.name });
      botTables.set(seated.id, joined);
      socket.join(joined.id);
      console.log(`Player registered: ${seated.name} to game ${joined.id}`);
      sendRegistered(joined, seated, token);
      io.to(joined.id).emit(GameStateAction.PlayersUpdated, joined.players);

      if (joined.players.length === MAX_PLAYERS) startGame(joined);
    };

    const sendRegistered = (table: GameTable, registered: Bot, token?: string) => {
      socket.emit(GameStateAction.Registered, {
        gameId: table.id,
        botId: registered.id,
        name: registered.name,
        ...(token && { token }),
      });
    };

    socket.on(GameStateAction.Register, (payload: unknown) => {
      // A connection that is logged in asks for its next game
      if (bot) {
        const current = botTables.get(bot.id);
        if (current) {
          socket.emit(GameStateAction.ErrorMessage, `Already registered to game ${current.id}`);
          return;
        }
        seatAtOpenTable(bot);
        return;
      }

      const { name, token } = (payload ?? {}) as { name?: unknown; token?: unknown };
      if (!isValidBotName(name)) {
        socket.emit(GameStateAction.ErrorMessage, 'Register needs a name of 1-32 characters');
        return;
      }

      let identity;
      try {
        identity = botRegistry.authenticate(name, token);
      } catch (err: any) {
        socket.emit(GameStateAction.ErrorMessage, err.message);
        return;
      }

      // Set before closing the old connection, whose disconnect would give up the seat
      bot = identity.bot;
      const previous = connectedBots.get(bot.id);
      connectedBots.set(bot.id, socket);
      previous?.disconnect(true);

      const seated = botTables.get(bot.id);
      if (!seated) {
        seatAtOpenTable(bot, identity.token);
        return;
      }

      socket.join(seated.id);
      sendRegistered(seated, bot);
      if (seated.game) sendState(seated, bot.id);
    });

    socket.on(GameStateAction.StartGame, () => {
      const table = bot && botTables.get(bot.id);
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
      handle: (game: GameEngine, botId: string, payload: Record<string, any>) => void
    ) => {
      socket.on(action, (payload: unknown) => {
        const table = bot && botTables.get(bot.id);
        if (!bot || !table?.game) return;
        try {
          if (typeof payload !== 'object' || payload === null) {
            throw new Error('Invalid payload');
          }
          handle(table.game, bot.id, payload);
          startTurn(table);
        } catch (err: any) {
          socket.emit(GameStateAction.ErrorMessage, err.message);
        }
      });
    };

    onGameAction(GamePlayAction.SetForecast, (game, botId, { bid }) => {
      console.log(botId, bid);
      game.setForecast(botId, bid);
    });

    onGameAction(GamePlayAction.SelectTrump, (game, botId, { color }) => {
      game.setTrump(botId, color);
    });

    onGameAction(GamePlayAction.PlayCard, (game, botId, { card }) => {
      game.playCard(botId, card);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected:', socket.id);
      // A bot that has moved to a new connection stays at its table
      if (!bot || connectedBots.get(bot.id) !== socket) return;
      connectedBots.delete(bot.id);

      const table = botTables.get(bot.id);
      if (!table) return;

      if (!table.game) {
        const leaving = bot.id;
        table.players = table.players.filter(p => p.id !== leaving);
        botTables.delete(leaving);
        if (table.players.length > 0) {
          io.to(table.id).emit(GameStateAction.PlayersUpdated, table.players);
        } else {
          tables.delete(table);
        }
        return;
      }

      if (!table.players.some(p => connectedBots.has(p.id))) {
        closeTable(table);
      } else if (table.game.currentPlayerId === bot.id) {
        startTurn(table);
      }
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

    // Nobody is going to answer for bots that aren't connected
    while (game.currentPlayerId && !connectedBots.has(game.currentPlayerId)) {
      game.playDefaultMove();
    }

    broadcastStates(table);

    const playerId = game.currentPlayerId;
    if (!playerId) {
      closeTable(table);
      return;
    }

    table.turnTimer = setTimeout(() => {
      game.playDefaultMove();
      connectedBots
        .get(playerId)
        ?.emit(GameStateAction.ErrorMessage, 'Turn timed out, a move was played for you');
      startTurn(table);
    }, turnTimeoutMs);
  };

  // Frees the bots to register for another game
  const closeTable = (table: GameTable) => {
    clearTimeout(table.turnTimer);
    table.players.forEach(p => botTables.delete(p.id));
    tables.delete(table);
    io.in(table.id).socketsLeave(table.id);
  };

  const broadcastStates = (table: GameTable) => {
    table.players.forEach(player => sendState(table, player.id));
  };

  const sendState = (table: GameTable, botId: string) => {
    connectedBots.get(botId)?.emit(GameStateAction.State, table.game!.getState(botId));
  };

  return { server, io, tables, connectedBots };
};
