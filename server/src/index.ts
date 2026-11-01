// src/index.ts
import { createGameServer } from './game-server';

const turnTimeoutMs = Number(process.env.TURN_TIMEOUT_MS) || undefined;
const { server } = createGameServer({ turnTimeoutMs });

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});
