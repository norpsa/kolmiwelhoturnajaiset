import { Deck } from './deck';
import { Player } from './player';
import { Trick, Round, GameState, Color, GamePlayAction, Card, RegisteredPlayer, colors } from './types';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

export class GameEngine {
  private players: Player[];
  private deck: Deck;
  private currentTurn = 0;

  private roundNumber = 1;
  private totalRounds: number;
  private scores: Record<string, number> = {};
  private currentRound: Round | null = null;
  // Kept because the next round starts right after the last card of a round is played,
  // so otherwise players would never see the last trick
  private previousRound: Round | null = null;

  private currentAction: GamePlayAction | null = null;

  constructor(players: RegisteredPlayer[]) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new Error(`Game needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
    }

    this.players = players.map(p => new Player(p.id, p.name));
    this.deck = new Deck();
    this.totalRounds = Math.floor(this.deck.cards.length / this.players.length);

    this.players.forEach(p => (this.scores[p.id] = 0));

    this.startRound();
  }

  private startRound() {
    this.deck.reset();
    this.deck.shuffle();
    this.players.forEach(player => player.resetForRound());

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

    // In the last round every card is dealt, so there is no trump
    let trump = this.deck.cards.length > 0 ? this.deck.draw() : null;

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
      // N as trump card (or no trump card) means the round has no trump
      trumpColor: trump?.color ?? null,
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
    if (!colors.includes(color)) {
      throw new Error('Invalid trump color');
    }
    this.currentRound!.trumpColor = color;
    this.currentAction = GamePlayAction.SetForecast;
    this.currentTurn = this.currentRound!.firstPlayerOfRoundIndex;
  }

  setForecast(playerId: string, bid: number) {
    const player = this.ensureRoundPlayerAndCorrectAction(playerId, GamePlayAction.SetForecast)

    if (!Number.isInteger(bid) || bid < 0 || bid > this.roundNumber) {
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

    if (typeof card !== 'object' || card === null) {
      throw new Error('Invalid card');
    }

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
      trick.winner = this.evaluateTrick(trick, this.currentRound!.trumpColor ?? null);
      this.currentRound!.tricksWon[trick.winner]++;
      this.currentTurn = this.players.findIndex(p => p.id === trick.winner)
      this.players[this.currentTurn].tricksTaken++;

      this.currentRound!.currentTrick++;

      // if all tricks done, score round
      if (this.currentRound!.currentTrick >= this.roundNumber) {
        this.scoreRound();
        this.previousRound = this.currentRound;
        this.roundNumber++;
        if (this.roundNumber <= this.totalRounds) {
          this.startRound();
        } else {
          this.currentAction = null;
        }
      }
    }
  }

  // Whose move the game is waiting for, null when the game is over
  get currentPlayerId(): string | null {
    return this.currentAction ? this.players[this.currentTurn].id : null;
  }

  // Plays a legal move for the current player, who has timed out or left the game
  playDefaultMove() {
    const player = this.players[this.currentTurn];
    const round = this.currentRound!;

    switch (this.currentAction) {
      case GamePlayAction.SelectTrump:
        this.setTrump(player.id, colors[0]);
        break;
      case GamePlayAction.SetForecast: {
        const sumOfForecasts = round.forecasts.reduce((sum, f) => sum + f.bid, 0);
        const isLastForecast = round.forecasts.length === this.players.length - 1;
        // Zero is illegal only when the earlier forecasts already add up to the tricks
        this.setForecast(player.id, isLastForecast && sumOfForecasts === round.roundNumber ? 1 : 0);
        break;
      }
      case GamePlayAction.PlayCard: {
        const trickColor = round.tricks[round.currentTrick]?.trickColor;
        const card = player.hand.find(c => this.isCardAllowedToBePlayed(c, trickColor, player.hand));
        this.playCard(player.id, card!);
        break;
      }
      default:
        throw new Error('Game is over');
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

    let currentPlayerName = this.players[this.currentTurn].name;

    let action = null;
    if(this.currentAction) {
      action = {
        playerId: currentPlayerName,
        action: this.currentAction
      }
    }

    return {
      round: this.currentRound,
      previousRound: this.previousRound,
      totalRounds: this.totalRounds,
      players: this.players.map(p => p.serialize()),
      currentHand: player.hand,
      currentTurn: currentPlayerName,
      scores: this.scores,
      nextAction: action,
      gameOver: this.roundNumber > this.totalRounds
    };
  }
}