import { Card, SerializedPlayer } from './types';

export class Player {
  public id: string;
  public hand: Card[] = [];
  public tricksTaken: number = 0;
  public tricksForecasted: number | null = null;

  constructor(id: string) {
    this.id = id;
  }

  addCardToHand(card: Card): void {
    this.hand.push(card);
  }

  playCard(index: number): Card {
    if (index < 0 || index >= this.hand.length) {
      throw new Error('Invalid card index');
    }
    return this.hand.splice(index, 1)[0];
  }

  serialize(): SerializedPlayer {
    return {
      id: this.id,
      tricksTaken: this.tricksTaken,
      tricksForecasted: this.tricksForecasted,
      cardsInHand: this.hand.length
    };
  }
}
