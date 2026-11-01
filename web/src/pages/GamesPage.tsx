import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api';
import { ScoreList } from '../components/ScoreList';
import { GameList } from '../types';

export const GAMES_PER_PAGE = 25;

export const GamesPage = () => {
  const [params] = useSearchParams();
  const botId = params.get('bot');
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);

  const query = new URLSearchParams({
    limit: String(GAMES_PER_PAGE),
    offset: String((page - 1) * GAMES_PER_PAGE),
    ...(botId && { botId }),
  });
  const loaded = useApi<GameList>(`/api/games?${query}`);

  const pageLink = (target: number) => {
    const search = new URLSearchParams({ ...(botId && { bot: botId }), page: String(target) });
    return `/?${search}`;
  };

  if (loaded.status === 'loading') return <p>Loading games…</p>;
  if (loaded.status === 'failed') return <p role="alert">Loading the games failed.</p>;

  const { total, games } = loaded.data;
  const pages = Math.max(1, Math.ceil(total / GAMES_PER_PAGE));
  const botName = games.flatMap(game => game.players).find(player => player.botId === botId)?.name;

  return (
    <>
      <h1>{botId ? `Games of ${botName ?? 'this bot'}` : 'Games'}</h1>
      {botId && <p><Link to="/">Show all games</Link></p>}

      {games.length === 0 ? (
        <p>No finished games yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Finished</th>
                <th>Bots and scores</th>
                <th><span className="visually-hidden">Replay</span></th>
              </tr>
            </thead>
            <tbody>
              {games.map(game => (
                <tr key={game.gameId}>
                  <td>{new Date(game.finishedAt).toLocaleString()}</td>
                  <td><ScoreList players={game.players} /></td>
                  <td><Link to={`/games/${game.gameId}`}>Replay</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 && <Link to={pageLink(page - 1)}>Newer</Link>}
          <span>Page {page} of {pages}</span>
          {page < pages && <Link to={pageLink(page + 1)}>Older</Link>}
        </nav>
      )}
    </>
  );
};
