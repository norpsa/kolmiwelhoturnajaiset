// src/index.ts
import { createGameServer } from './game-server';

const { server } = createGameServer();

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});
