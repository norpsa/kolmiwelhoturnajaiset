// src/game/Deck.ts
import { Card, colors, numberRanks } from './types';

export class Deck {
  public cards: Card[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.cards = [];

    // Add number cards
    for (const color of colors) {
      for (const rank of numberRanks) {
        this.cards.push({ color, rank });
      }
    }

    // Add 4 Z cards
    for (let i = 0; i < 4; i++) {
      this.cards.push({ rank: 'Z' });
    }

    // Add 4 N cards
    for (let i = 0; i < 4; i++) {
      this.cards.push({ rank: 'N' });
    }
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(): Card {
    const card = this.cards.pop();
    if (!card) throw new Error('Deck is empty');
    return card;
  }
}