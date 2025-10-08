// src/index.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { GameEngine } from './wizard/game-engine';
import { GamePlayAction, GameStateAction } from './wizard/types';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let game: GameEngine | null = null;
const registeredPlayers: string[] = []; // socket.id or assigned player IDs
let gameStarted = false;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on(GameStateAction.Register, (playerId: string) => {
    if (gameStarted) {
      socket.emit(GameStateAction.ErrorMessage, 'Game already started. Cannot register.');
      return;
    }
    if (!registeredPlayers.includes(socket.id)) {
      registeredPlayers.push(socket.id);
      console.log(`Player registered: ${socket.id}`);
    }
    io.emit(GameStateAction.PlayersUpdated, registeredPlayers);
  });

  socket.on(GameStateAction.StartGame, () => {
    if (gameStarted) {
      socket.emit(GameStateAction.ErrorMessage, 'Game already started');
      return;
    }
    if (!registeredPlayers.includes(socket.id)) {
      socket.emit(GameStateAction.ErrorMessage, 'You must be registered to start the game');
      return;
    }
    if (registeredPlayers.length < 2) {
      socket.emit(GameStateAction.ErrorMessage, 'Need at least 2 players to start');
      return;
    }

    game = new GameEngine(registeredPlayers);
    gameStarted = true;
    io.emit(GameStateAction.GameStarted);
    broadcastStates();
  });

  socket.on(GamePlayAction.SetForecast, ({ playerId, bid }) => {
    if (!game) return;
    try {
      console.log(playerId, bid);
      game.setForecast(playerId, bid);
      broadcastStates();
    } catch (err: any) {
      socket.emit(GameStateAction.ErrorMessage, err.message);
    }
  });

  socket.on(GamePlayAction.SelectTrump, ({ playerId, color }) => {
    if (!game) return;
     try {
      game.setTrump(playerId, color);
      broadcastStates();
    } catch (err: any) {
      socket.emit(GameStateAction.ErrorMessage, err.message);
    }
  });

  socket.on(GamePlayAction.PlayCard, ({ playerId, card }) => {
    if (!game) return;
    try {
      game.playCard(playerId, card);
      broadcastStates();
    } catch (err: any) {
      socket.emit(GameStateAction.ErrorMessage, err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const index = registeredPlayers.indexOf(socket.id);
    if (index !== -1) registeredPlayers.splice(index, 1);
    io.emit(GameStateAction.PlayersUpdated, registeredPlayers);
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
  io.sockets.sockets.get(playerId)?.emit(GameStateAction.State, game.getState(playerId));
}

server.listen(3000, () => {
  console.log('Game server running at http://localhost:3000');
});