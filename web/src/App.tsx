import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { GamesPage } from './pages/GamesPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ReplayPage } from './pages/ReplayPage';

export const App = () => (
  <>
    <header className="top-bar">
      <Link to="/" className="brand">Wizard bots</Link>
      <nav aria-label="Main">
        <NavLink to="/" end>Games</NavLink>
        <NavLink to="/leaderboard">Bots</NavLink>
      </nav>
    </header>
    <main>
      <Routes>
        <Route path="/" element={<GamesPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/games/:id" element={<ReplayPage />} />
        <Route path="*" element={<p>This page doesn't exist. <Link to="/">Back to games</Link></p>} />
      </Routes>
    </main>
  </>
);
