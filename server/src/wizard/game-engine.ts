import { Deck } from './deck';
import { Player } from './player';
import { Trick, Round, GameState, Color, GamePlayAction, Card } from './types';

export class GameEngine {
  private players: Player[];
  private deck: Deck;
  private currentTurn = 0;

  private roundNumber = 1;
  private totalRounds = 10;
  private scores: Record<string, number> = {};
  private currentRound: Round | null = null;

  private currentAction: GamePlayAction | null = null;

  constructor(playerIds: string[]) {
    this.players = playerIds.map(id => new Player(id));
    this.deck = new Deck();

    this.players.forEach(p => (this.scores[p.id] = 0));

    this.startRound();
  }

  private startRound() {
    this.deck.reset();
    this.deck.shuffle();

    let firstPlayerIndex;
    if(this.roundNumber === 1 || !this.currentRound) {
      const randomIndex = Math.floor(Math.random() * this.players.length);
      firstPlayerIndex = randomIndex;
    } else {
      firstPlayerIndex = (this.currentRound.firstPlayerOfRoundIndex + 1) % this.players.length;
    }
    

    for (let i = 0; i < this.roundNumber; i++) {
      this.players.forEach(player => {
        player.addCardToHand(this.deck.draw());
      });
    }

    let trump = this.deck.cards ? this.deck.draw() : null;

    // If trump card is Z, last player of the round selects trump color
    if(trump && trump.rank === 'Z') {
      this.currentAction = GamePlayAction.SelectTrump;
      this.currentTurn = (firstPlayerIndex + this.players.length - 1) % this.players.length;
    } else {
      this.currentAction = GamePlayAction.SetForecast;
      this.currentTurn = firstPlayerIndex;
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
      trump: trump,
      trumpColor: trump ? trump.color : null,
      firstPlayerOfRoundIndex: firstPlayerIndex
    };
  }

  private ensureRoundPlayerAndCorrectAction(playerId: string, action: GamePlayAction) {
    if(!this.currentRound) throw new Error('Round not found');
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player !== this.players[this.currentTurn]) {
      throw new Error("Not this player's turn");
    }
    if(action !== this.currentAction) {
      throw new Error('Wrong action');
    }
    return player;
  }

  setTrump(playerId: string, color: Color) {
    this.ensureRoundPlayerAndCorrectAction(playerId, GamePlayAction.SelectTrump);
    this.currentRound!.trumpColor = color;
    this.currentAction = GamePlayAction.SetForecast;
    this.currentTurn = this.currentRound!.firstPlayerOfRoundIndex;
  }

  setForecast(playerId: string, bid: number) {
    const player = this.ensureRoundPlayerAndCorrectAction(playerId, GamePlayAction.SetForecast)

    if (bid < 0 || bid > this.roundNumber) {
      throw new Error('Invalid forecast');
    }
    if (this.currentRound!.forecasts.some(f => f.playerId === playerId)) {
      throw new Error('Forecast already set');
    }

    if(this.currentRound!.forecasts.length === this.players.length - 1) {
      let sumOfForecasts = this.currentRound!.forecasts.reduce((a, b) => a + b.bid, 0);
      if(sumOfForecasts + bid === this.currentRound?.roundNumber) {
        throw new Error(`Illegal forecast, sum of forecasts can't be even`);
      }
    }

    this.currentRound!.forecasts.push({ playerId, bid });
    player.setForecast(bid);
    this.currentTurn = (this.currentTurn + 1) % this.players.length;

    // If everyone has forecasted, trick starts
    if(this.currentRound!.forecasts.length === this.players.length) {
      this.currentAction = GamePlayAction.PlayCard;
    } else {
      this.currentAction = GamePlayAction.SetForecast;
    }
  }

  private isCardAllowedToBePlayed(card: Card, trickColor: Color | null | undefined, hand: Card[]) {
    if(!card.color) return true;

    if(trickColor && card.color !== trickColor) {
      if(hand.findIndex(c => c.color === trickColor) !== -1) return false;
    }

    return true;
  }

  playCard(playerId: string, card: Card) {
    const player = this.ensureRoundPlayerAndCorrectAction(playerId, GamePlayAction.PlayCard);

    let trick: Trick = this.currentRound!.tricks[this.currentRound!.currentTrick];

    // jos tikki on aloitettu, tarkistetaan onko kortti laillinen
    if(trick) {
      if(!this.isCardAllowedToBePlayed(card, trick.trickColor, player.hand)) {
        throw new Error('Must follow trick color');
      }
    }

    try {
      player.playCard(card);
    } catch(e) {
      throw new Error('Card not in hand');
    }

    if (!trick) {
      trick = { id: this.currentRound!.currentTrick, plays: [], trickColor: undefined };
      this.currentRound!.tricks[this.currentRound!.currentTrick] = trick;
    }

    if(trick.trickColor === undefined) {
      if(card.color) {
        trick.trickColor = card.color;
      } else if(card.rank === 'Z') {
        trick.trickColor = null;
      }
    }

    trick.plays.push({ playerId, card });
    
    // advance turn
    this.currentTurn = (this.currentTurn + 1) % this.players.length;

    // if trick complete
    if (trick.plays.length === this.players.length) {
      if(!this.currentRound!.trumpColor) throw new Error('Round should have trump color defined')
      trick.winner = this.evaluateTrick(trick, this.currentRound!.trumpColor);
      this.currentRound!.tricksWon[trick.winner]++;
      this.currentTurn = this.players.findIndex(p => p.id === trick.winner)

      this.currentRound!.currentTrick++;

      // if all tricks done, score round
      if (this.currentRound!.currentTrick >= this.roundNumber) {
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

  private evaluateTrick(trick: Trick, trump: Color | null): string {
    let winner = trick.plays[0];
    let winningValue = 0;
    if(typeof winner.card.rank === 'number') {
      winningValue = winner.card.rank as number;
       if(winner.card.color === trump) {
          winningValue *= 100;
        }
    }

    for (const play of trick.plays) {
      // eka zeppo voittaa
      if(play.card.rank === 'Z') {
        return play.playerId;
      }

      if(typeof play.card.rank === 'number') {
        let cardValue = play.card.rank as number;
        // Valtit on parempi
        if(play.card.color === trump) {
          cardValue *= 100;
        // Jos pelattiin ei valttia eikä tikin väriä niin ei arvoa
        } else if(play.card.color !== trick.trickColor) {
          cardValue = 0;
        }

        if(cardValue > winningValue) {
          winner = play;
          winningValue = cardValue;
        }
      }
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

    let currentPlayerId = this.players[this.currentTurn].id

    let action = null;
    if(this.currentAction) {
      action = {
        playerId: currentPlayerId,
        action: this.currentAction
      }
    }

    return {
      round: this.currentRound,
      totalRounds: this.totalRounds,
      players: this.players.map(p => p.serialize()),
      currentHand: player.hand,
      currentTurn: currentPlayerId,
      scores: this.scores,
      nextAction: action
    };
  }
}