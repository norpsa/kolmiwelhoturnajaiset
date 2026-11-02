import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { GamesPage } from './pages/GamesPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ReplayPage } from './pages/ReplayPage';
import { TournamentPage } from './pages/TournamentPage';
import { TournamentsPage } from './pages/TournamentsPage';

export const App = () => (
  <>
    <header className="top-bar">
      <Link to="/" className="brand">Wizard bots</Link>
      <nav aria-label="Main">
        <NavLink to="/" end>Games</NavLink>
        <NavLink to="/leaderboard">Bots</NavLink>
        <NavLink to="/tournaments">Tournaments</NavLink>
      </nav>
    </header>
    <main>
      <Routes>
        <Route path="/" element={<GamesPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/games/:id" element={<ReplayPage />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/:id" element={<TournamentPage />} />
        <Route path="*" element={<p>This page doesn't exist. <Link to="/">Back to games</Link></p>} />
      </Routes>
    </main>
  </>
);
