import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, postJson, useApi } from '../api';
import { ScoreList } from '../components/ScoreList';
import { UnrankedNote } from '../components/UnrankedNote';
import { organiserError, useOrganiserKey } from '../organiser';
import { Tournament, TournamentTable } from '../types';
import { hasEnded, STATUS_LABELS } from './TournamentsPage';

const REFRESH_MS = 5000;

const Standings = ({ tournament }: { tournament: Tournament }) => (
  <section aria-label="Standings">
    <h2>Standings</h2>
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="number">Rank</th>
            <th>Bot</th>
            <th className="number">Games</th>
            <th className="number">Points</th>
            <th className="number">Average</th>
            <th className="number">Wins</th>
            <th className="number">Missed</th>
            <th className="number">Average score</th>
          </tr>
        </thead>
        <tbody>
          {tournament.standings.map(row => (
            <tr key={row.botId}>
              <td className="number">{row.rank}</td>
              <td><Link to={`/?bot=${row.botId}`}>{row.name}</Link></td>
              <td className="number">{row.games}</td>
              <td className="number">{row.points}</td>
              <td className="number">{row.averagePoints.toFixed(2)}</td>
              <td className="number">{row.wins}</td>
              <td className="number">{row.missed}</td>
              <td className="number">{Math.round(row.averageScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="note">
      Only the placing in each game matters. At a table of {tournament.tableSize}, 1st place gets{' '}
      {tournament.tableSize - 1} points and last place 0. Bots are ranked by average points. Ties go to
      the most wins, then to who placed ahead when the tied bots met, and last to the average game score.
      A missed round counts as a game worth 0 points.
    </p>
  </section>
);

const TableRow = ({ table }: { table: TournamentTable }) => (
  <li>
    {table.result ? (
      <>
        <ScoreList result={table.result} />
        <UnrankedNote result={table.result} />
        <Link to={`/games/${table.gameId}`}>Replay</Link>
      </>
    ) : (
      <span>{table.players.map(player => player.name).join(', ')} <em className="note">playing</em></span>
    )}
  </li>
);

const Rounds = ({ tournament }: { tournament: Tournament }) => {
  // Newest first, because that is what people following the tournament look for
  const rounds = tournament.schedule
    .map((tables, index) => ({ tables, number: index + 1, missed: tournament.absences?.[index] ?? [] }))
    .reverse();

  return (
    <section aria-label="Rounds">
      <h2>Rounds</h2>
      {rounds.map(({ tables, number, missed }) => (
        <div key={number} className="round">
          <h3>Round {number} of {tournament.rounds}</h3>
          <ul className="round-tables">
            {tables.map((table, index) => <TableRow key={index} table={table} />)}
          </ul>
          {missed.length > 0 && (
            <p className="note">Missed this round: {missed.map(bot => bot.name).join(', ')}</p>
          )}
        </div>
      ))}
    </section>
  );
};

const SignUp = ({ tournament, onChanged }: { tournament: Tournament; onChanged: () => void }) => {
  const [key, setKey] = useOrganiserKey();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (action: 'start' | 'cancel') => {
    setError(null);
    setSending(true);
    try {
      await postJson(`/api/tournaments/${tournament.id}/${action}`, key);
      onChanged();
    } catch (err) {
      setError(organiserError(err));
    }
    setSending(false);
  };

  const start = (event: FormEvent) => {
    event.preventDefault();
    send('start');
  };

  return (
    <section aria-label="Sign-up">
      <p>To sign up a bot, run this in the bot template and keep it running:</p>
      <pre className="command"><code>node bot.js --name MyBot --tournament {tournament.id}</code></pre>

      <h2>Bots signed up: {tournament.entrants.length}</h2>
      {tournament.entrants.length === 0 ? (
        <p>No bots yet.</p>
      ) : (
        <ul className="entrants">
          {tournament.entrants.map(bot => <li key={bot.id}>{bot.name}</li>)}
        </ul>
      )}
      <p className="note">Needs at least {tournament.tableSize} bots to start.</p>

      <form className="organiser start-form" onSubmit={start}>
        <label>
          Organiser key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={event => setKey(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={sending}>Start the tournament</button>
        <button type="button" disabled={sending || !key} onClick={() => send('cancel')}>
          Cancel the tournament
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
};

export const TournamentPage = () => {
  const { id } = useParams();
  const loaded = useApi<Tournament>(`/api/tournaments/${encodeURIComponent(id ?? '')}`, {
    refreshMs: REFRESH_MS,
    until: hasEnded,
  });

  if (loaded.status === 'loading') return <p>Loading the tournament…</p>;
  if (loaded.status === 'failed') {
    const notFound = loaded.error instanceof ApiError && loaded.error.status === 404;
    return (
      <>
        <p role="alert">{notFound ? 'This tournament was not found.' : 'Loading the tournament failed.'}</p>
        <p><Link to="/tournaments">Back to tournaments</Link></p>
      </>
    );
  }

  const tournament = loaded.data;
  const roundsDrawn = tournament.schedule.length;

  return (
    <>
      <h1>{tournament.name}</h1>
      <p className="note">
        {STATUS_LABELS[tournament.status]} · {tournament.rounds} rounds · {tournament.tableSize} bots at each table
      </p>
      {tournament.status === 'interrupted' && (
        <p>The server restarted during this tournament, so it can't go on. These are the results so far.</p>
      )}
      {tournament.status === 'cancelled' && <p>The organiser cancelled this tournament before it started.</p>}
      {tournament.status === 'signup' && <SignUp tournament={tournament} onChanged={loaded.reload} />}
      {tournament.status !== 'signup' && tournament.status !== 'cancelled' && (
        <>
          <Standings tournament={tournament} />
          {roundsDrawn > 0 && <Rounds tournament={tournament} />}
        </>
      )}
    </>
  );
};
