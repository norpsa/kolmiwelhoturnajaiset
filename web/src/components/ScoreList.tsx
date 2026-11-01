import { PlayerResult } from '../types';

// Everyone with the top score counts as a winner, as on the leaderboard
export const ScoreList = ({ players }: { players: PlayerResult[] }) => {
  const topScore = Math.max(...players.map(p => p.score));
  const ordered = [...players].sort((a, b) => b.score - a.score);

  return (
    <ul className="scores">
      {ordered.map(player => (
        <li key={player.botId} className={player.score === topScore ? 'winner' : undefined}>
          {player.score === topScore && <span title="Winner" aria-label="Winner">★ </span>}
          {player.name} <span className="score">{player.score}</span>
        </li>
      ))}
    </ul>
  );
};
