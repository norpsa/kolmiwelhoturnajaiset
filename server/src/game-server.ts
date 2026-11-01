import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { GameEngine, MAX_PLAYERS, MIN_PLAYERS } from './wizard/game-engine';
import { GamePlayAction, GameStateAction, RegisteredPlayer } from './wizard/types';

export const createGameServer = () => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  let game: GameEngine | null = null;
  const registeredPlayers: RegisteredPlayer[] = []; // socket.id or assigned player IDs
  let gameStarted = false;

  io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on(GameStateAction.Register, (playerName: string) => {
      if (gameStarted) {
        socket.emit(GameStateAction.ErrorMessage, 'Game already started. Cannot register.');
        return;
      }
      if (!registeredPlayers.map(a => a.id).includes(socket.id)) {
        registeredPlayers.push({ id: socket.id, name: playerName });
        console.log(`Player registered: ${playerName}`);
      }
      io.emit(GameStateAction.PlayersUpdated, registeredPlayers);
    });

    socket.on(GameStateAction.StartGame, () => {
      if (gameStarted) {
        socket.emit(GameStateAction.ErrorMessage, 'Game already started');
        return;
      }
      if (!registeredPlayers.map(a => a.id).includes(socket.id)) {
        socket.emit(GameStateAction.ErrorMessage, 'You must be registered to start the game');
        return;
      }
      if (registeredPlayers.length < MIN_PLAYERS || registeredPlayers.length > MAX_PLAYERS) {
        socket.emit(GameStateAction.ErrorMessage, `Need ${MIN_PLAYERS}-${MAX_PLAYERS} players to start`);
        return;
      }

      game = new GameEngine(registeredPlayers);
      gameStarted = true;
      io.emit(GameStateAction.GameStarted);
      broadcastStates();
    });

    // Actions always apply to the sender, so a client can't act for another player
    socket.on(GamePlayAction.SetForecast, ({ bid }) => {
      if (!game) return;
      try {
        console.log(socket.id, bid);
        game.setForecast(socket.id, bid);
        broadcastStates();
      } catch (err: any) {
        socket.emit(GameStateAction.ErrorMessage, err.message);
      }
    });

    socket.on(GamePlayAction.SelectTrump, ({ color }) => {
      if (!game) return;
      try {
        game.setTrump(socket.id, color);
        broadcastStates();
      } catch (err: any) {
        socket.emit(GameStateAction.ErrorMessage, err.message);
      }
    });

    socket.on(GamePlayAction.PlayCard, ({ card }) => {
      if (!game) return;
      try {
        game.playCard(socket.id, card);
        broadcastStates();
      } catch (err: any) {
        socket.emit(GameStateAction.ErrorMessage, err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log('Player disconnected:', socket.id);
      const index = registeredPlayers.findIndex(s => s.id === socket.id);
      if (index !== -1) registeredPlayers.splice(index, 1);
      io.emit(GameStateAction.PlayersUpdated, registeredPlayers);
    });
  });

  const broadcastStates = () => {
    if (!game) {
      return;
    }
    for (const player of registeredPlayers) {
      sendPlayerState(player.id);
    }
  };

  const sendPlayerState = (playerId: string) => {
    if (!game) return;
    io.sockets.sockets.get(playerId)?.emit(GameStateAction.State, game.getState(playerId));
  };

  return { server, io };
};
