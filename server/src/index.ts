// src/index.ts
import { BotRegistry } from './bot-registry';
import { createGameServer } from './game-server';

const turnTimeoutMs = Number(process.env.TURN_TIMEOUT_MS) || undefined;
const botRegistry = new BotRegistry(process.env.BOTS_FILE || 'data/bots.json');
const { server } = createGameServer({ turnTimeoutMs, botRegistry });

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});
