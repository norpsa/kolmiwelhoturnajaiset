import { Deck } from './deck';
import { Player } from './player';
import { Card, Trick, Round, Forecast, GameState } from './types';

export class GameEngine {
  private players: Player[];
  private deck: Deck;
  private currentTurn = 0;

  private roundNumber = 1;
  private totalRounds = 10;
  private scores: Record<string, number> = {};
  private currentRound: Round | null = null;

  constructor(playerIds: string[]) {
    this.players = playerIds.map(id => new Player(id));
    this.deck = new Deck();

    this.players.forEach(p => (this.scores[p.id] = 0));

    this.startRound();
  }

  private startRound() {
    this.deck.reset();
    this.deck.shuffle();

    // TODO: kierroksen aloittajan päättäminen

    for (let i = 0; i < this.roundNumber; i++) {
      this.players.forEach(player => {
        player.addCardToHand(this.deck.draw());
      });
    }

    this.currentRound = {
      roundNumber: this.roundNumber,
      tricks: [],
      currentTrick: 0,
      forecasts: [],
      tricksWon: this.players.reduce<Record<string, number>>((acc, player) => {
        acc[player.id] = 0;
        return acc;
      }, {}),
      trump: this.deck.cards ? this.deck.draw() : null,
    };
  }

  // players set their forecasts at start of round
  setForecast(playerId: string, bid: number) {
    if(!this.currentRound) throw new Error('Round not found');
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player !== this.players[this.currentTurn]) {
      throw new Error("Not this player's turn");
    }

    if (bid < 0 || bid > this.roundNumber) {
      throw new Error('Invalid forecast');
    }
    if (this.currentRound.forecasts.some(f => f.playerId === playerId)) {
      throw new Error('Forecast already set');
    }
    this.currentRound.forecasts.push({ playerId, bid });
    this.currentTurn = (this.currentTurn + 1) % this.players.length;
  }

  playCard(playerId: string, cardIndex: number) {
    if(!this.currentRound) throw new Error('Round not found');
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player !== this.players[this.currentTurn]) {
      throw new Error("Not this player's turn");
    }

    const card = player.playCard(cardIndex);

    // get or create current trick
    let trick: Trick = this.currentRound.tricks[this.currentRound.currentTrick];
    if (!trick) {
      trick = { id: this.currentRound.currentTrick, plays: [] };
      this.currentRound.tricks[this.currentRound.currentTrick] = trick;
    }

    trick.plays.push({ playerId, card });

    // advance turn
    this.currentTurn = (this.currentTurn + 1) % this.players.length;

    // if trick complete
    if (trick.plays.length === this.players.length) {
      trick.winner = this.evaluateTrick(trick);
      this.currentRound.tricksWon[trick.winner]++;
      this.currentTurn = this.players.findIndex(p => p.id === trick.winner)

      this.currentRound.currentTrick++;

      // if all tricks done, score round
      if (this.currentRound.currentTrick >= this.roundNumber) {
        this.scoreRound();
        this.roundNumber++;
        if (this.roundNumber <= this.totalRounds) {
          this.startRound();
        } else {
          console.log('Game over');
        }
      }
    }
  }

  private evaluateTrick(trick: Trick): string {
    // Placeholder rule: highest number wins
    let winner = trick.plays[0];
    for (const play of trick.plays) {
      if (
        typeof play.card.rank === 'number' &&
        typeof winner.card.rank === 'number' &&
        play.card.rank > winner.card.rank
      ) {
        winner = play;
      }
      // TODO: implement Wizard rules for Z/N/trump
    }
    return winner.playerId;
  }

  private scoreRound() {
    if(!this.currentRound) throw new Error('Round not found');
    for (const forecast of this.currentRound.forecasts) {
      const actual = this.currentRound.tricksWon[forecast.playerId];
      if (forecast.bid === actual) {
        this.scores[forecast.playerId] += 20 + forecast.bid * 10;
      } else {
        this.scores[forecast.playerId] -= Math.abs(forecast.bid - actual) * 10;
      }
    }
  }

  getState(playerId: string): GameState {
    const player = this.players.find(p => p.id === playerId);
    if(!player) throw new Error('Player not found ' + playerId);
    return {
      round: this.currentRound,
      totalRounds: this.totalRounds,
      players: this.players.map(p => p.serialize()),
      currentHand: player.hand,
      currentTurn: this.players[this.currentTurn].id,
      scores: this.scores
    };
  }
}