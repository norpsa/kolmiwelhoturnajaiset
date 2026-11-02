import { GameResult } from '../types';

export const UnrankedNote = ({ result }: { result: GameResult }) => {
  const names = result.players.filter(p => result.didNotFinish?.includes(p.botId)).map(p => p.name);
  if (names.length === 0) return null;

  return (
    <p className="note">
      Doesn't count for {names.join(', ')}: didn't play to the end
    </p>
  );
};
