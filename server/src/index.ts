// src/index.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { GameEngine } from './wizard/game-engine';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let game: GameEngine | null = null;
const registeredPlayers: string[] = []; // socket.id or assigned player IDs
let gameStarted = false;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('register', (playerId: string) => {
    if (gameStarted) {
      socket.emit('errorMessage', 'Game already started. Cannot register.');
      return;
    }
    if (!registeredPlayers.includes(socket.id)) {
      registeredPlayers.push(socket.id);
      console.log(`Player registered: ${socket.id}`);
    }
    io.emit('playersUpdated', registeredPlayers);
  });

  socket.on('startGame', () => {
    if (gameStarted) {
      socket.emit('errorMessage', 'Game already started');
      return;
    }
    if (!registeredPlayers.includes(socket.id)) {
      socket.emit('errorMessage', 'You must be registered to start the game');
      return;
    }
    if (registeredPlayers.length < 2) {
      socket.emit('errorMessage', 'Need at least 2 players to start');
      return;
    }

    game = new GameEngine(registeredPlayers);
    gameStarted = true;
    io.emit('gameStarted');
    broadcastStates();
  });

  socket.on('setForecast', ({ playerId, bid }) => {
    if (!game) return;
    game.setForecast(playerId, bid);
    broadcastStates();
  });

  socket.on('playCard', ({ playerId, cardIndex }) => {
    if (!game) return;
    try {
      game.playCard(playerId, cardIndex);
      broadcastStates();
    } catch (err: any) {
      socket.emit('errorMessage', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const index = registeredPlayers.indexOf(socket.id);
    if (index !== -1) registeredPlayers.splice(index, 1);
    io.emit('playersUpdated', registeredPlayers);
  });
});

const broadcastStates = () => {
  if(!game) {
    return;
  }
  for (const playerId of registeredPlayers) {
    sendPlayerState(playerId);
  }
}

const sendPlayerState = (playerId: string) => {
  if(!game) return;
  io.sockets.sockets.get(playerId)?.emit('state', game.getState(playerId));
}

// TODO joku systeemi joka kuuluttaa kaikille pelaajille oman tilansa

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});