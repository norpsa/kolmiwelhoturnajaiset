import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import http from 'http';
import { join, resolve } from 'path';
import { Server, Socket } from 'socket.io';
import { Bot, BotRegistry, isValidBotName } from './bot-registry';
import { ReplayStore } from './replay-store';
import { GameResult, ResultStore } from './result-store';
import {
  drawTables,
  isValidSettings,
  standings,
  Tournament,
  TournamentStore,
  TournamentTable,
} from './tournament';
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
  // Set for tables that are part of a tournament
  tournament?: { tournament: Tournament; table: TournamentTable; round: number };
}

interface Seat {
  gameId: string | null;
  playerCount: number | null;
  tournamentId?: string;
}

interface GameServerOptions {
  turnTimeoutMs?: number;
  extraTimeMs?: number;
  lobbyWaitMs?: number;
  botRegistry?: BotRegistry;
  resultStore?: ResultStore;
  replayStore?: ReplayStore;
  tournamentStore?: TournamentStore;
  // Needed to create and start tournaments, which nobody can do if this isn't set
  adminKey?: string;
  webDir?: string;
}

const DEFAULT_WEB_DIR = resolve(__dirname, '../../web/dist');
const DEFAULT_GAMES_PER_PAGE = 50;
const MAX_GAMES_PER_PAGE = 100;

const DEFAULT_TURN_TIMEOUT_MS = 10000;
const DEFAULT_EXTRA_TIME_MS = 60000;
const DEFAULT_LOBBY_WAIT_MS = 5000;
// Smaller tables can still be started with startGame
const MIN_PLAYERS_TO_AUTO_START = 4;

const isValidPlayerCount = (count: unknown): count is number =>
  Number.isInteger(count) && (count as number) >= MIN_PLAYERS && (count as number) <= MAX_PLAYERS;

const readNumber = (value: unknown, min: number, fallback: number) => {
  const number = typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isInteger(number) && number >= min ? number : fallback;
};

const sha256 = (text: string) => createHash('sha256').update(text).digest();

// Tables are shown without a game id until they finish, so running games stay hidden
const publicTournament = (tournament: Tournament) => ({
  ...tournament,
  schedule: tournament.schedule.map(tables =>
    tables.map(({ id, players, result }) => ({ gameId: result ? id : null, players, result }))
  ),
  standings: standings(tournament),
});

const tournamentSummary = (tournament: Tournament) => {
  const { id, name, tableSize, rounds, status, createdAt, entrants, schedule } = tournament;
  return {
    id,
    name,
    tableSize,
    rounds,
    status,
    createdAt,
    entrants: entrants.length,
    roundsPlayed: schedule.filter(tables => tables.every(table => table.result)).length,
    winners: status === 'finished' ? standings(tournament).filter(row => row.rank === 1).map(row => row.name) : [],
  };
};

export const createGameServer = ({
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  extraTimeMs = DEFAULT_EXTRA_TIME_MS,
  lobbyWaitMs = DEFAULT_LOBBY_WAIT_MS,
  botRegistry = new BotRegistry(),
  resultStore = new ResultStore(),
  replayStore = new ReplayStore(),
  tournamentStore = new TournamentStore(),
  adminKey,
  webDir = DEFAULT_WEB_DIR,
}: GameServerOptions = {}) => {
  const app = express();

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!adminKey) {
      res.status(403).json({ error: 'This server has no organiser key' });
      return;
    }
    const given = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!timingSafeEqual(sha256(given), sha256(adminKey))) {
      res.status(401).json({ error: 'Wrong organiser key' });
      return;
    }
    next();
  };

  app.get('/api/leaderboard', (_req, res) => {
    res.json(resultStore.leaderboard());
  });

  app.get('/api/games', (req, res) => {
    const { limit, offset, botId } = req.query;
    res.json(
      resultStore.games({
        limit: Math.min(readNumber(limit, 1, DEFAULT_GAMES_PER_PAGE), MAX_GAMES_PER_PAGE),
        offset: readNumber(offset, 0, 0),
        botId: typeof botId === 'string' ? botId : undefined,
      })
    );
  });

  // Only finished games have a result, so replays of running games can't be asked for.
  // This also means that only ids made by the server get used as file names.
  app.get('/api/games/:id', (req, res) => {
    const result = resultStore.find(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json({ result, replay: replayStore.load(result.gameId) });
  });

  app.get('/api/tournaments', (_req, res) => {
    res.json(tournamentStore.list().map(tournamentSummary));
  });

  app.get('/api/tournaments/:id', (req, res) => {
    const tournament = tournamentStore.get(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json(publicTournament(tournament));
  });

  // The key is checked first, so that nobody else gets as far as sending a body
  app.post('/api/tournaments', requireAdmin, express.json({ limit: '10kb' }), (req, res) => {
    const { name, tableSize, rounds } = (req.body ?? {}) as Record<string, unknown>;
    if (!isValidSettings(name, tableSize, rounds)) {
      res.status(400).json({ error: `Needs a name, a table size of ${MIN_PLAYERS}-${MAX_PLAYERS} and 1-100 rounds` });
      return;
    }

    const tournament: Tournament = {
      id: randomUUID(),
      name: (name as string).trim(),
      tableSize: tableSize as number,
      rounds: rounds as number,
      status: 'signup',
      createdAt: new Date().toISOString(),
      entrants: [],
      schedule: [],
    };
    tournamentStore.save(tournament);
    res.status(201).json(publicTournament(tournament));
  });

  app.post('/api/tournaments/:id/start', requireAdmin, (req, res) => {
    const tournament = tournamentStore.get(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    if (tournament.status !== 'signup') {
      res.status(409).json({ error: 'Tournament has already started' });
      return;
    }
    if (tournament.entrants.length < tournament.tableSize) {
      res.status(409).json({ error: `Needs at least ${tournament.tableSize} bots` });
      return;
    }

    tournament.status = 'running';
    startRound(tournament);
    res.json(publicTournament(tournament));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // For example a body that isn't JSON. Express would otherwise answer with a stack trace.
  app.use('/api', (err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: 'Invalid request' });
  });

  // The pages are routed in the browser, so they all get index.html
  if (existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get('*', (_req, res) => {
      res.sendFile(join(webDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const io = new Server(server);

  const tables = new Set<GameTable>();
  // A bot has one connection and sits at one table at a time
  const connectedBots = new Map<string, Socket>();
  const botTables = new Map<string, GameTable>();
  // From signing up until the tournament ends, also between its games
  const botTournaments = new Map<string, Tournament>();

  const newTable = (players: RegisteredPlayer[], playerCount: number | null, id: string = randomUUID()): GameTable => {
    const table = { id, players, game: null, playerCount, turnStartedAt: 0, extraTime: new Map() };
    tables.add(table);
    return table;
  };

  const sendRegistered = (socket: Socket | undefined, player: RegisteredPlayer, seat: Seat, token?: string) => {
    socket?.emit(GameStateAction.Registered, {
      ...seat,
      botId: player.id,
      name: player.name,
      ...(token && { token }),
    });
  };

  const tableSeat = (table: GameTable): Seat => ({
    gameId: table.id,
    playerCount: table.playerCount,
    ...(table.tournament && { tournamentId: table.tournament.tournament.id }),
  });

  const tournamentSeat = (tournament: Tournament): Seat => ({
    gameId: null,
    playerCount: tournament.tableSize,
    tournamentId: tournament.id,
  });

  // Entrants can come back to a running tournament, but it is too late for anyone else
  const canJoinTournament = ({ status, entrants }: Tournament, name: string) =>
    status === 'signup' ||
    (status === 'running' && entrants.some(bot => bot.name.toLowerCase() === name.toLowerCase()));

  const saveTournament = (tournament: Tournament) => {
    try {
      tournamentStore.save(tournament);
    } catch (err) {
      console.error('Saving the tournament failed:', err);
    }
  };

  io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    let bot: Bot | null = null;

    const seatAtOpenTable = (seated: Bot, playerCount: number | null, token?: string) => {
      // Each count has its own open table. Bots with no count help fill the oldest one.
      // A table opens a new one by starting, which happens at the latest when it is full.
      let joined = [...tables].find(t => !t.game && (!playerCount || t.playerCount === playerCount));
      if (!joined) joined = newTable([], playerCount);

      joined.players.push({ id: seated.id, name: seated.name });
      botTables.set(seated.id, joined);
      socket.join(joined.id);
      console.log(`Player registered: ${seated.name} to game ${joined.id}`);
      sendRegistered(socket, seated, tableSeat(joined), token);
      io.to(joined.id).emit(GameStateAction.PlayersUpdated, joined.players);

      if (joined.players.length === (joined.playerCount ?? MAX_PLAYERS)) {
        startGame(joined);
      } else if (!joined.playerCount && joined.players.length >= MIN_PLAYERS_TO_AUTO_START && !joined.lobbyTimer) {
        // Enough to play, so give others a moment to join and then start without anyone asking
        const waiting = joined;
        joined.lobbyTimer = setTimeout(() => startGame(waiting), lobbyWaitMs);
      }
    };

    const enterTournament = (entered: Bot, tournament: Tournament, token?: string) => {
      tournament.entrants.push({ id: entered.id, name: entered.name });
      botTournaments.set(entered.id, tournament);
      saveTournament(tournament);
      sendRegistered(socket, entered, tournamentSeat(tournament), token);
    };

    socket.on(GameStateAction.Register, (payload: unknown) => {
      const { name, token, playerCount: requestedCount, tournamentId } = (payload ?? {}) as {
        name?: unknown;
        token?: unknown;
        playerCount?: unknown;
        tournamentId?: unknown;
      };

      // Checked first, so that a bad request doesn't claim the name
      const playerCount = requestedCount ?? null;
      if (playerCount !== null && !isValidPlayerCount(playerCount)) {
        socket.emit(GameStateAction.ErrorMessage, `Player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}`);
        return;
      }

      let tournament: Tournament | undefined;
      if (tournamentId !== undefined && tournamentId !== null) {
        tournament = typeof tournamentId === 'string' ? tournamentStore.get(tournamentId) : undefined;
        if (!tournament) {
          socket.emit(GameStateAction.ErrorMessage, 'Tournament not found');
          return;
        }
        if (playerCount !== null) {
          socket.emit(GameStateAction.ErrorMessage, 'A tournament has its own table size');
          return;
        }
      }

      // A connection that is logged in asks for its next game
      if (bot) {
        const current = botTables.get(bot.id);
        if (current) {
          socket.emit(GameStateAction.ErrorMessage, `Already registered to game ${current.id}`);
          return;
        }
        const entered = botTournaments.get(bot.id);
        if (entered) {
          socket.emit(GameStateAction.ErrorMessage, `Already in tournament ${entered.name}`);
          return;
        }
        if (tournament?.status === 'signup') enterTournament(bot, tournament);
        else if (tournament) socket.emit(GameStateAction.ErrorMessage, 'Tournament is closed for sign-up');
        else seatAtOpenTable(bot, playerCount);
        return;
      }

      if (!isValidBotName(name)) {
        socket.emit(GameStateAction.ErrorMessage, 'Register needs a name of 1-32 characters');
        return;
      }

      // Checked first, so that a bot that can't join doesn't claim the name
      if (tournament && !canJoinTournament(tournament, name)) {
        socket.emit(GameStateAction.ErrorMessage, 'Tournament is closed for sign-up');
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
      if (seated) {
        socket.join(seated.id);
        sendRegistered(socket, bot, tableSeat(seated));
        if (seated.game) sendState(seated, bot.id);
        return;
      }

      // Back between the games of a tournament, whatever it asked for
      const entered = botTournaments.get(bot.id);
      if (entered) {
        sendRegistered(socket, bot, tournamentSeat(entered));
      } else if (tournament) {
        enterTournament(bot, tournament, identity.token);
      } else {
        seatAtOpenTable(bot, playerCount, identity.token);
      }
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
      if (!table) {
        leaveSignup(bot.id);
        return;
      }

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

    // Separate from the result, which still counts if the replay can't be saved
    try {
      replayStore.save(table.id, table.game!.getReplay());
    } catch (err) {
      console.error('Saving the replay failed:', err);
    }

    const result: GameResult = {
      gameId: table.id,
      finishedAt: new Date().toISOString(),
      players: table.players.map(p => ({ botId: p.id, name: p.name, score: scores[p.id] })),
      didNotFinish: table.game!.getBotsThatDidNotFinish(),
      ...(table.tournament && { tournamentId: table.tournament.tournament.id, round: table.tournament.round }),
    };

    try {
      resultStore.record(result);
    } catch (err) {
      console.error('Saving the result failed:', err);
    }

    table.players.forEach(p => botTables.delete(p.id));
    tables.delete(table);
    io.in(table.id).socketsLeave(table.id);

    if (table.tournament) {
      table.tournament.table.result = result;
      advanceTournament(table.tournament.tournament);
    }
  };

  const leaveSignup = (botId: string) => {
    const tournament = botTournaments.get(botId);
    if (tournament?.status !== 'signup') return;

    tournament.entrants = tournament.entrants.filter(bot => bot.id !== botId);
    botTournaments.delete(botId);
    saveTournament(tournament);
  };

  // A bot that isn't connected keeps its seat, and the turn clock plays for it if it stays away
  const startTournamentTable = (tournament: Tournament, seat: TournamentTable, round: number) => {
    const table = newTable(seat.players, tournament.tableSize, seat.id);
    table.tournament = { tournament, table: seat, round };

    for (const player of seat.players) {
      const socket = connectedBots.get(player.id);
      botTables.set(player.id, table);
      socket?.join(table.id);
      sendRegistered(socket, player, tableSeat(table));
    }
    io.to(table.id).emit(GameStateAction.PlayersUpdated, table.players);
    startGame(table);
  };

  // Saved before starting, because a table of absent bots plays out right away
  const startRound = (tournament: Tournament) => {
    const earlierTables = tournament.schedule.flat().map(table => table.players.map(p => p.id));
    const botIds = tournament.entrants.map(bot => bot.id);
    const seats = drawTables(botIds, tournament.tableSize, earlierTables).map(ids => ({
      id: randomUUID(),
      players: ids.map(id => tournament.entrants.find(bot => bot.id === id)!),
      result: null,
    }));

    tournament.schedule.push(seats);
    saveTournament(tournament);

    const round = tournament.schedule.length;
    seats.forEach(seat => startTournamentTable(tournament, seat, round));
  };

  const advanceTournament = (tournament: Tournament) => {
    saveTournament(tournament);

    if (tournament.schedule.at(-1)!.some(table => !table.result)) return;

    if (tournament.schedule.length < tournament.rounds) {
      startRound(tournament);
      return;
    }

    tournament.status = 'finished';
    saveTournament(tournament);

    for (const { botId, rank } of standings(tournament)) {
      botTournaments.delete(botId);
      connectedBots.get(botId)?.emit(GameStateAction.TournamentFinished, {
        tournamentId: tournament.id,
        rank,
        bots: tournament.entrants.length,
      });
    }
  };

  const broadcastStates = (table: GameTable) => {
    table.players.forEach(player => sendState(table, player.id));
  };

  const sendState = (table: GameTable, botId: string) => {
    connectedBots.get(botId)?.emit(GameStateAction.State, table.game!.getState(botId));
  };

  return { server, io, tables, connectedBots };
};
