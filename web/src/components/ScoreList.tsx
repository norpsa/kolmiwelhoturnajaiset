import { GameResult } from '../types';

// Winners as on the leaderboard: everyone with the top score among the bots that finished.
// A bot that finished alone had nobody to beat.
export const ScoreList = ({ result }: { result: GameResult }) => {
  const { players, didNotFinish } = result;
  const finished = players.filter(p => !didNotFinish?.includes(p.botId));
  const topScore = Math.max(...finished.map(p => p.score));
  const isWinner = (botId: string, score: number) =>
    finished.length >= 2 && score === topScore && !didNotFinish?.includes(botId);
  const ordered = [...players].sort((a, b) => b.score - a.score);

  return (
    <ul className="scores">
      {ordered.map(({ botId, name, score }) => (
        <li key={botId} className={isWinner(botId, score) ? 'winner' : undefined}>
          {isWinner(botId, score) && <span title="Winner" aria-label="Winner">★ </span>}
          {name} <span className="score">{score}</span>
        </li>
      ))}
    </ul>
  );
};
