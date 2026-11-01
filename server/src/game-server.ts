import { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { Bot, BotRegistry, isValidBotName } from './bot-registry';
import { ResultStore } from './result-store';
import { GameEngine, MAX_PLAYERS, MIN_PLAYERS } from './wizard/game-engine';
import { GamePlayAction, GameStateAction, RegisteredPlayer } from './wizard/types';

interface GameTable {
  id: string;
  // Once the game has started, bots keep their seat if they disconnect
  players: RegisteredPlayer[];
  game: GameEngine | null;
  // Set when bots asked for this many players. The game then starts at that count.
  playerCount: number | null;
  turnTimer?: NodeJS.Timeout;
  lobbyTimer?: NodeJS.Timeout;
  turnStartedAt: number;
  // What each bot has left of its reserve for the game, used after the turn time ends
  extraTime: Map<string, number>;
}

interface GameServerOptions {
  turnTimeoutMs?: number;
  extraTimeMs?: number;
  lobbyWaitMs?: number;
  botRegistry?: BotRegistry;
  resultStore?: ResultStore;
}

const DEFAULT_TURN_TIMEOUT_MS = 10000;
const DEFAULT_EXTRA_TIME_MS = 60000;
const DEFAULT_LOBBY_WAIT_MS = 5000;
// Smaller tables can still be started with startGame
const MIN_PLAYERS_TO_AUTO_START = 4;

const isValidPlayerCount = (count: unknown): count is number =>
  Number.isInteger(count) && (count as number) >= MIN_PLAYERS && (count as number) <= MAX_PLAYERS;

export const createGameServer = ({
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  extraTimeMs = DEFAULT_EXTRA_TIME_MS,
  lobbyWaitMs = DEFAULT_LOBBY_WAIT_MS,
  botRegistry = new BotRegistry(),
  resultStore = new ResultStore(),
}: GameServerOptions = {}) => {
  const app = express();
  app.get('/leaderboard', (_req, res) => {
    res.json(resultStore.leaderboard());
  });

  const server = http.createServer(app);
  const io = new Server(server);

  const tables = new Set<GameTable>();
  // A bot has one connection and sits at one table at a time
  const connectedBots = new Map<string, Socket>();
  const botTables = new Map<string, GameTable>();

  io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    let bot: Bot | null = null;

    const seatAtOpenTable = (seated: Bot, playerCount: number | null, token?: string) => {
      // Each count has its own open table. Bots with no count help fill the oldest one.
      // A table opens a new one by starting, which happens at the latest when it is full.
      let joined = [...tables].find(t => !t.game && (!playerCount || t.playerCount === playerCount));
      if (!joined) {
        joined = { id: randomUUID(), players: [], game: null, playerCount, turnStartedAt: 0, extraTime: new Map() };
        tables.add(joined);
      }

      joined.players.push({ id: seated.id, name: seated.name });
      botTables.set(seated.id, joined);
      socket.join(joined.id);
      console.log(`Player registered: ${seated.name} to game ${joined.id}`);
      sendRegistered(joined, seated, token);
      io.to(joined.id).emit(GameStateAction.PlayersUpdated, joined.players);

      if (joined.players.length === (joined.playerCount ?? MAX_PLAYERS)) {
        startGame(joined);
      } else if (!joined.playerCount && joined.players.length >= MIN_PLAYERS_TO_AUTO_START && !joined.lobbyTimer) {
        // Enough to play, so give others a moment to join and then start without anyone asking
        const waiting = joined;
        joined.lobbyTimer = setTimeout(() => startGame(waiting), lobbyWaitMs);
      }
    };

    const sendRegistered = (table: GameTable, registered: Bot, token?: string) => {
      socket.emit(GameStateAction.Registered, {
        gameId: table.id,
        botId: registered.id,
        name: registered.name,
        playerCount: table.playerCount,
        ...(token && { token }),
      });
    };

    socket.on(GameStateAction.Register, (payload: unknown) => {
      const { name, token, playerCount: requestedCount } = (payload ?? {}) as {
        name?: unknown;
        token?: unknown;
        playerCount?: unknown;
      };

      // Checked first, so that a bad request doesn't claim the name
      const playerCount = requestedCount ?? null;
      if (playerCount !== null && !isValidPlayerCount(playerCount)) {
        socket.emit(GameStateAction.ErrorMessage, `Player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}`);
        return;
      }

      // A connection that is logged in asks for its next game
      if (bot) {
        const current = botTables.get(bot.id);
        if (current) {
          socket.emit(GameStateAction.ErrorMessage, `Already registered to game ${current.id}`);
          return;
        }
        seatAtOpenTable(bot, playerCount);
        return;
      }

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
        seatAtOpenTable(bot, playerCount, identity.token);
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
      if (table.playerCount) {
        socket.emit(GameStateAction.ErrorMessage, `Game starts when it has ${table.playerCount} players`);
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
          chargeExtraTime(table, bot.id);
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
        if (table.players.length < MIN_PLAYERS_TO_AUTO_START) {
          clearTimeout(table.lobbyTimer);
          table.lobbyTimer = undefined;
        }
        if (table.players.length > 0) {
          io.to(table.id).emit(GameStateAction.PlayersUpdated, table.players);
        } else {
          tables.delete(table);
        }
        return;
      }

      // Otherwise the turn clock keeps running, so that the bot can come back. Everyone
      // having left plays out here too, and the game gets recorded.
      const current = table.game.currentPlayerId;
      if (current && shouldPlayAtOnce(table, current)) startTurn(table);
    });
  });

  const startGame = (table: GameTable) => {
    clearTimeout(table.lobbyTimer);
    table.extraTime = new Map(table.players.map(p => [p.id, extraTimeMs]));
    table.game = new GameEngine(table.players);
    io.to(table.id).emit(GameStateAction.GameStarted);
    startTurn(table);
  };

  // Call after every move. Rejected moves don't get here, so they don't buy more time.
  const startTurn = (table: GameTable) => {
    clearTimeout(table.turnTimer);
    const game = table.game!;

    while (game.currentPlayerId && shouldPlayAtOnce(table, game.currentPlayerId)) {
      game.playDefaultMove();
    }

    broadcastStates(table);

    const playerId = game.currentPlayerId;
    if (!playerId) {
      finishGame(table);
      return;
    }

    table.turnStartedAt = Date.now();
    table.turnTimer = setTimeout(() => {
      table.extraTime.set(playerId, 0);
      game.playDefaultMove();
      connectedBots
        .get(playerId)
        ?.emit(GameStateAction.ErrorMessage, 'Turn timed out, a move was played for you');
      startTurn(table);
    }, turnTimeoutMs + table.extraTime.get(playerId)!);
  };

  // A disconnected bot can't come back in time without a reserve, and nobody is coming
  // back to a table that everyone has left. Waiting for them would only slow the game.
  const shouldPlayAtOnce = (table: GameTable, playerId: string) => {
    if (connectedBots.has(playerId)) return false;
    return table.extraTime.get(playerId) === 0 || !table.players.some(p => connectedBots.has(p.id));
  };

  const chargeExtraTime = (table: GameTable, botId: string) => {
    const overTime = Date.now() - table.turnStartedAt - turnTimeoutMs;
    if (overTime > 0) {
      table.extraTime.set(botId, Math.max(0, table.extraTime.get(botId)! - overTime));
    }
  };

  // Records the result and frees the bots to register for another game
  const finishGame = (table: GameTable) => {
    const { scores } = table.game!.getState(table.players[0].id);
    try {
      resultStore.record({
        gameId: table.id,
        finishedAt: new Date().toISOString(),
        players: table.players.map(p => ({ botId: p.id, name: p.name, score: scores[p.id] })),
      });
    } catch (err) {
      console.error('Saving the result failed:', err);
    }

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
