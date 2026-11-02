import { Link, useParams } from 'react-router-dom';
import { ApiError, useApi } from '../api';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { ScoreList } from '../components/ScoreList';
import { UnrankedNote } from '../components/UnrankedNote';
import { GameDetails } from '../types';

export const ReplayPage = () => {
  const { id } = useParams();
  const loaded = useApi<GameDetails>(`/api/games/${encodeURIComponent(id ?? '')}`);

  if (loaded.status === 'loading') return <p>Loading the game…</p>;
  if (loaded.status === 'failed') {
    const notFound = loaded.error instanceof ApiError && loaded.error.status === 404;
    return (
      <>
        <p role="alert">{notFound ? 'This game was not found.' : 'Loading the game failed.'}</p>
        <p><Link to="/">Back to games</Link></p>
      </>
    );
  }

  const { result, replay } = loaded.data;

  return (
    <>
      <h1>Game replay</h1>
      <p className="note">Finished {new Date(result.finishedAt).toLocaleString()}</p>
      <ScoreList result={result} />
      <UnrankedNote result={result} />
      {replay && replay.events.length > 0 ? (
        <ReplayPlayer replay={replay} />
      ) : (
        <p>This game was played before replays were saved, or its replay is missing.</p>
      )}
    </>
  );
};
