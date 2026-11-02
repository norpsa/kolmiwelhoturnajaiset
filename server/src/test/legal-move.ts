import { Socket } from "socket.io-client";
import { GamePlayAction, GameState, GameStateAction } from "../wizard/types";

const legalMove = ({ round, currentHand, players, nextAction }: GameState): [GamePlayAction, object] => {
  const { forecasts, roundNumber, tricks, currentTrick } = round!;

  if (nextAction!.action === GamePlayAction.SelectTrump) {
    return [GamePlayAction.SelectTrump, { color: "humans" }];
  }

  if (nextAction!.action === GamePlayAction.SetForecast) {
    const sum = forecasts.reduce((total, forecast) => total + forecast.bid, 0);
    const isLast = forecasts.length === players.length - 1;
    return [GamePlayAction.SetForecast, { bid: isLast && sum === roundNumber ? 1 : 0 }];
  }

  const trickColor = tricks[currentTrick]?.trickColor;
  const mustFollow = Boolean(trickColor) && currentHand.some(card => card.color === trickColor);
  const card = currentHand.find(c => !c.color || !mustFollow || c.color === trickColor);
  return [GamePlayAction.PlayCard, { card }];
};

// Makes a bot play for real, so that its moves aren't made by the server.
// skip decides whether to leave a turn unanswered.
export const playLegally = (bot: Socket, name: string, skip: () => boolean = () => false) => {
  bot.on(GameStateAction.State, (state: GameState) => {
    if (state.nextAction?.playerId !== name || skip()) return;
    const [action, payload] = legalMove(state);
    bot.emit(action, payload);
  });
};
