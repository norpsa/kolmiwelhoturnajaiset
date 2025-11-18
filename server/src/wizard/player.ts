import { Card, SerializedPlayer } from './types';

export class Player {
  public id: string;
  public name: string;
  public hand: Card[] = [];
  public tricksTaken: number = 0;
  public tricksForecasted: number | null = null;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  addCardToHand(card: Card): void {
    this.hand.push(card);
  }

  playCard(card: Card): Card {
    let index = this.hand.findIndex(c => c.color === card.color && c.rank === card.rank);
    if (index === -1) {
      throw new Error('Card not in hand');
    }
    return this.hand.splice(index, 1)[0];
  }

  setForecast(bid: number): void {
    this.tricksForecasted = bid;
  }

  serialize(): SerializedPlayer {
    return {
      id: this.id,
      name: this.name,
      tricksTaken: this.tricksTaken,
      tricksForecasted: this.tricksForecasted,
      cardsInHand: this.hand.length
    };
  }
}
