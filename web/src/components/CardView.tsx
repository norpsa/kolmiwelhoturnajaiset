import { cardName } from '../replay/frames';
import { Card } from '../types';

const rankLabel = (card: Card) => (card.rank === 'Z' ? 'W' : card.rank === 'N' ? 'J' : card.rank);

export const CardView = ({ card }: { card: Card }) => (
  <span className={`card card-${card.color ?? 'special'}`} title={cardName(card)} role="img" aria-label={cardName(card)}>
    {rankLabel(card)}
    {card.color && <small>{card.color.slice(0, 2)}</small>}
  </span>
);
