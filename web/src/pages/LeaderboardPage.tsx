import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { LeaderboardRow } from '../types';

const percent = (share: number) => `${Math.round(share * 100)}%`;

export const LeaderboardPage = () => {
  const loaded = useApi<LeaderboardRow[]>('/api/leaderboard');

  if (loaded.status === 'loading') return <p>Loading bots…</p>;
  if (loaded.status === 'failed') return <p role="alert">Loading the bots failed.</p>;

  return (
    <>
      <h1>Bots</h1>
      {loaded.data.length === 0 ? (
        <p>No bots have finished a game yet.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="number">Rank</th>
                  <th>Bot</th>
                  <th className="number">Games</th>
                  <th className="number">Wins</th>
                  <th className="number">Win rate</th>
                  <th className="number">Performance</th>
                  <th className="number">Average score</th>
                </tr>
              </thead>
              <tbody>
                {loaded.data.map(row => (
                  <tr key={row.botId}>
                    <td className="number">{row.rank}</td>
                    <td><Link to={`/?bot=${row.botId}`}>{row.name}</Link></td>
                    <td className="number">{row.games}</td>
                    <td className="number">{row.wins}</td>
                    <td className="number">{percent(row.wins / row.games)}</td>
                    <td className="number">{percent(row.performance)}</td>
                    <td className="number">{Math.round(row.averageScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Bots are ranked by performance, the average share of opponents they beat. Average scores
            can't be compared directly, because smaller tables play more rounds. A game doesn't count
            for a bot that didn't play to the end, and the other bots are compared with each other.
          </p>
        </>
      )}
    </>
  );
};
