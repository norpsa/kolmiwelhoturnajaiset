import { Link } from 'react-router-dom';
import { GameResult } from '../types';

export const TournamentNote = ({ result }: { result: GameResult }) =>
  result.tournamentId ? (
    <p className="note">
      <Link to={`/tournaments/${result.tournamentId}`}>Tournament game</Link>, round {result.round}
    </p>
  ) : null;
