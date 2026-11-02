// src/index.ts
import { BotRegistry } from './bot-registry';
import { createGameServer } from './game-server';
import { ReplayStore } from './replay-store';
import { ResultStore } from './result-store';
import { TournamentStore } from './tournament';

const turnTimeoutMs = Number(process.env.TURN_TIMEOUT_MS) || undefined;
const botRegistry = new BotRegistry(process.env.BOTS_FILE || 'data/bots.json');
const extraTimeMs = process.env.EXTRA_TIME_MS ? Number(process.env.EXTRA_TIME_MS) : undefined;
const lobbyWaitMs = Number(process.env.LOBBY_WAIT_MS) || undefined;
const resultStore = new ResultStore(process.env.RESULTS_FILE || 'data/results.jsonl');
const replayStore = new ReplayStore(process.env.REPLAYS_DIR || 'data/replays');
const tournamentStore = new TournamentStore(process.env.TOURNAMENTS_DIR || 'data/tournaments');
const adminKey = process.env.ADMIN_KEY || undefined;
const { server } = createGameServer({
  turnTimeoutMs,
  extraTimeMs,
  lobbyWaitMs,
  botRegistry,
  resultStore,
  replayStore,
  tournamentStore,
  adminKey,
});

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});
