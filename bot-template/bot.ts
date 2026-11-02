// Connects to the server and plays. Your game logic goes in strategy.ts, not here.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import { chooseMove } from './lib/turn.ts';
import { isWaitingForMove } from './lib/types.ts';
import type { Bot, ClientEvents, GameState, ServerEvents } from './lib/types.ts';
import * as strategy from './strategy.ts';

const USAGE = `Usage: npm start -- --name <name> [options]

  --name <name>     Name of your bot, or set BOT_NAME
  --players <3-6>   Play at a table that starts by itself at this many players
  --games <n>       How many games to play in a row (default 1)
  --tournament <id> Sign up for a tournament and play until it ends
  --server <url>    Server address, or set SERVER_URL (default http://localhost:3000)`;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const parseOptions = () => {
  try {
    return parseArgs({
      options: {
        name: { type: 'string', default: process.env.BOT_NAME },
        players: { type: 'string' },
        games: { type: 'string' },
        tournament: { type: 'string' },
        server: { type: 'string', default: process.env.SERVER_URL || 'http://localhost:3000' },
      },
    }).values;
  } catch (err) {
    return fail(`${(err as Error).message}\n\n${USAGE}`);
  }
};

const readOptions = () => {
  const values = parseOptions();
  const name = values.name || fail(USAGE);

  const games = Number(values.games ?? 1);
  if (!Number.isInteger(games) || games < 1) fail(`--games must be a positive number\n\n${USAGE}`);
  if (values.tournament && (values.games !== undefined || values.players !== undefined)) {
    fail(`--tournament can't be combined with --games or --players\n\n${USAGE}`);
  }

  // The server checks the range of the player count
  const players = values.players === undefined ? undefined : Number(values.players);
  return { name, players, games, tournament: values.tournament, server: values.server as string };
};

// A token is shown only once, and without it the name is lost for good. Each name has its
// own file, so that you can run several bots from this folder.
const tokenPath = (name: string) =>
  join(dirname(fileURLToPath(import.meta.url)), '.tokens', `${encodeURIComponent(name)}.token`);

const loadToken = (name: string) => {
  try {
    return readFileSync(tokenPath(name), 'utf8').trim();
  } catch {
    return undefined;
  }
};

const saveToken = (name: string, token: string) => {
  const path = tokenPath(name);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, token, { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log(`Claimed the name ${name}, token saved to ${path}`);
  } catch (err) {
    console.error(`Saving the token failed (${(err as Error).message}). Save it yourself: ${token}`);
  }
};

const options = readOptions();
const socket: Socket<ServerEvents, ClientEvents> = io(options.server, { transports: ['websocket'] });

let me: Bot | null = null;
let gamesPlayed = 0;
// Set by the server, which also keeps a bot in its tournament after a restart
let tournamentId = options.tournament;
let waitingForAnswer = false;
// Moves are answers to one state. A newer state means the server has moved on.
let latestState = 0;

const register = () => {
  waitingForAnswer = true;
  socket.emit('register', {
    name: options.name,
    token: loadToken(options.name),
    playerCount: options.players,
    tournamentId,
  });
};

const finishGame = (state: GameState, bot: Bot) => {
  gamesPlayed++;
  const score = state.scores[bot.id];
  const place = 1 + Object.values(state.scores).filter((other) => other > score).length;
  const progress = tournamentId ? gamesPlayed : `${gamesPlayed}/${options.games}`;
  console.log(`Game ${progress} over: ${score} points, place ${place}/${state.players.length}`);

  // In a tournament the server seats the bot for each game
  if (tournamentId) return;

  if (gamesPlayed < options.games) {
    register();
  } else {
    socket.close();
    process.exit(0);
  }
};

const takeTurn = async (state: GameState) => {
  const thisState = ++latestState;
  if (!me) return;

  if (state.gameOver) {
    finishGame(state, me);
    return;
  }
  if (!isWaitingForMove(state) || state.nextAction.playerId !== me.name) return;

  const move = await chooseMove(state, me, strategy);
  if (thisState !== latestState) return;

  switch (move.event) {
    case 'selectTrump':
      socket.emit('selectTrump', move.payload);
      break;
    case 'setForecast':
      socket.emit('setForecast', move.payload);
      break;
    case 'playCard':
      socket.emit('playCard', move.payload);
      break;
  }
};

// Also runs after a lost connection, and the server then gives the seat back
socket.on('connect', () => {
  console.log(`Connected to ${options.server}`);
  register();
});

socket.on('connect_error', (err) => {
  console.error(`Can't connect to ${options.server}: ${err.message}`);
});

socket.on('disconnect', (reason) => {
  // The server closes a connection when the same bot connects again
  if (reason === 'io server disconnect') fail('Another connection took over this bot');
  console.log(`Disconnected: ${reason}`);
});

socket.on('registered', ({ gameId, botId, name, playerCount, token, tournamentId: joined }) => {
  me = { id: botId, name };
  tournamentId = joined;
  waitingForAnswer = false;
  if (token) saveToken(name, token);

  if (gameId) console.log(`Joined game ${gameId} as ${name}`);
  else console.log(`In tournament ${joined} as ${name}, waiting for the next game`);

  if (!playerCount && process.stdin.isTTY) console.log('Press Enter to start the game');
});

socket.on('tournamentFinished', ({ rank, bots }) => {
  console.log(`Tournament over: rank ${rank}/${bots}`);
  socket.close();
  process.exit(0);
});

socket.on('tournamentCancelled', () => {
  console.log('The organiser cancelled the tournament');
  socket.close();
  process.exit(0);
});

socket.on('playersUpdated', (players) => {
  console.log(`Players: ${players.map((player) => player.name).join(', ')}`);
});

socket.on('gameStarted', () => console.log('Game started'));

socket.on('state', (state) => {
  takeTurn(state).catch((err) => console.error('Taking a turn failed:', err));
});

socket.on('errorMessage', (message) => {
  // The bot can't play, for example because of a taken name or a tournament that has ended
  if (waitingForAnswer) fail(`Server refused: ${message}`);
  console.error(`Server: ${message}`);
});

if (options.players === undefined && !options.tournament && process.stdin.isTTY) {
  readline
    .createInterface({ input: process.stdin })
    .on('line', () => socket.emit('startGame'));
}
