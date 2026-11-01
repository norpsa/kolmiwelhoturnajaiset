// src/index.ts
import { BotRegistry } from './bot-registry';
import { createGameServer } from './game-server';
import { ResultStore } from './result-store';

const turnTimeoutMs = Number(process.env.TURN_TIMEOUT_MS) || undefined;
const botRegistry = new BotRegistry(process.env.BOTS_FILE || 'data/bots.json');
const lobbyWaitMs = Number(process.env.LOBBY_WAIT_MS) || undefined;
const resultStore = new ResultStore(process.env.RESULTS_FILE || 'data/results.jsonl');
const { server } = createGameServer({ turnTimeoutMs, lobbyWaitMs, botRegistry, resultStore });

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});
