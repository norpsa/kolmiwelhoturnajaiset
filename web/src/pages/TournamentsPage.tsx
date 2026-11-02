import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { postJson, useApi } from '../api';
import { organiserError, useOrganiserKey } from '../organiser';
import { Tournament, TournamentStatus, TournamentSummary } from '../types';

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  signup: 'Open for sign-up',
  running: 'Running',
  finished: 'Finished',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
};

// Nothing more will happen to a tournament in one of these
export const hasEnded = ({ status }: { status: TournamentStatus }) =>
  status === 'finished' || status === 'interrupted' || status === 'cancelled';

const REFRESH_MS = 5000;

const CreateForm = () => {
  const navigate = useNavigate();
  const [key, setKey] = useOrganiserKey();
  const [name, setName] = useState('');
  const [tableSize, setTableSize] = useState(4);
  const [rounds, setRounds] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const created = await postJson<Tournament>('/api/tournaments', key, { name, tableSize, rounds });
      navigate(`/tournaments/${created.id}`);
    } catch (err) {
      setError(organiserError(err));
      setSending(false);
    }
  };

  return (
    <details className="organiser">
      <summary>Create a tournament</summary>
      <form onSubmit={create}>
        <label>
          Name
          <input value={name} onChange={event => setName(event.target.value)} maxLength={64} required />
        </label>
        <label>
          Bots at each table
          <select value={tableSize} onChange={event => setTableSize(Number(event.target.value))}>
            {[3, 4, 5, 6].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <label>
          Rounds
          <input
            type="number"
            min={1}
            max={100}
            value={rounds}
            onChange={event => setRounds(Number(event.target.value))}
            required
          />
        </label>
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
        <button type="submit" disabled={sending}>Create</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
};

export const TournamentsPage = () => {
  const loaded = useApi<TournamentSummary[]>('/api/tournaments', {
    refreshMs: REFRESH_MS,
    until: tournaments => tournaments.every(hasEnded),
  });

  if (loaded.status === 'loading') return <p>Loading tournaments…</p>;
  if (loaded.status === 'failed') return <p role="alert">Loading the tournaments failed.</p>;

  return (
    <>
      <h1>Tournaments</h1>
      {loaded.data.length === 0 ? (
        <p>No tournaments yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tournament</th>
                <th>Status</th>
                <th className="number">Bots</th>
                <th className="number">Table size</th>
                <th className="number">Rounds</th>
                <th>Winner</th>
              </tr>
            </thead>
            <tbody>
              {loaded.data.map(tournament => (
                <tr key={tournament.id}>
                  <td><Link to={`/tournaments/${tournament.id}`}>{tournament.name}</Link></td>
                  <td>{STATUS_LABELS[tournament.status]}</td>
                  <td className="number">{tournament.entrants}</td>
                  <td className="number">{tournament.tableSize}</td>
                  <td className="number">{tournament.roundsPlayed}/{tournament.rounds}</td>
                  <td>{tournament.winners.join(', ') || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateForm />
    </>
  );
};
