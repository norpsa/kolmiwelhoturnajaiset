import { useEffect, useMemo, useRef, useState } from 'react';
import { buildFrames, buildScoreTable, describeEvent, Frame, roundStarts } from '../replay/frames';
import { GameReplay, RegisteredPlayer } from '../types';
import { CardView } from './CardView';

const SPEEDS = [0.5, 1, 2, 5, 20];
const STEP_MS = 800;

const isAuto = (frame: Frame) => 'auto' in frame.event && frame.event.auto;

const TrumpInfo = ({ frame }: { frame: Frame }) => (
  <span className="trump">
    Trump: {frame.trumpColor ?? 'none'}
    {frame.trump && <CardView card={frame.trump} />}
  </span>
);

const Trick = ({ frame, players }: { frame: Frame; players: RegisteredPlayer[] }) => (
  <section className="trick" aria-label="Current trick">
    {frame.trick.length === 0 && <p className="note">No cards on the table</p>}
    {frame.trick.map(({ playerId, card }) => (
      <div key={playerId} className={playerId === frame.trickWinner ? 'trick-play won' : 'trick-play'}>
        <CardView card={card} />
        <small>{players.find(p => p.id === playerId)?.name}</small>
      </div>
    ))}
  </section>
);

const Seat = ({ player, frame }: { player: RegisteredPlayer; frame: Frame }) => (
  <section className={player.id === frame.nextPlayerId ? 'seat active' : 'seat'} aria-label={player.name}>
    <header>
      <strong>{player.name}</strong>
      <span className="score">{frame.scores[player.id]} points</span>
    </header>
    <p className="note">
      Bid {frame.bids[player.id] ?? '–'}, tricks {frame.tricksWon[player.id]}
    </p>
    <div className="hand">
      {frame.hands[player.id].map((card, index) => (
        <CardView key={`${card.rank}-${card.color}-${index}`} card={card} />
      ))}
    </div>
  </section>
);

const MoveList = ({ replay, frames, index, onSelect }: {
  replay: GameReplay;
  frames: Frame[];
  index: number;
  onSelect: (index: number) => void;
}) => {
  const list = useRef<HTMLOListElement>(null);

  // Only scrolls the list, so that stepping doesn't move the page
  useEffect(() => {
    const element = list.current;
    const item = element?.children[index] as HTMLElement | undefined;
    if (element && item) element.scrollTop = item.offsetTop - element.clientHeight / 2;
  }, [index]);

  return (
    <ol className="moves" ref={list} aria-label="Moves">
      {frames.map((frame, i) => (
        <li key={i} className={frame.event.type === 'roundStart' ? 'round-start' : undefined}>
          <button
            type="button"
            className={i === index ? 'current' : undefined}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => onSelect(i)}
          >
            {describeEvent(frame.event, replay.players)}
            {isAuto(frame) && <em> (played by server)</em>}
          </button>
        </li>
      ))}
    </ol>
  );
};

const ScoreTable = ({ replay, frames }: { replay: GameReplay; frames: Frame[] }) => {
  const rows = useMemo(() => buildScoreTable(frames), [frames]);

  return (
    <details className="score-table">
      <summary>Scores by round</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="number">Round</th>
              {replay.players.map(player => <th key={player.id}>{player.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.roundNumber}>
                <td className="number">{row.roundNumber}</td>
                {replay.players.map(player => {
                  const { bid, tricks, score } = row.players[player.id];
                  return <td key={player.id}>{score} <small>({tricks}/{bid})</small></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Total points, with tricks taken / bid in brackets.</p>
    </details>
  );
};

export const ReplayPlayer = ({ replay }: { replay: GameReplay }) => {
  const frames = useMemo(() => buildFrames(replay), [replay]);
  const rounds = useMemo(() => roundStarts(frames), [frames]);
  const last = frames.length - 1;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const goTo = (target: number) => setIndex(Math.min(last, Math.max(0, target)));

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex(index + 1), STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, index, last, speed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Arrow keys already mean something in the round and speed menus
      if (event.target instanceof HTMLSelectElement) return;
      if (event.key === 'ArrowRight') setIndex(current => Math.min(last, current + 1));
      if (event.key === 'ArrowLeft') setIndex(current => Math.max(0, current - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  const frame = frames[index];

  return (
    <div className="replay">
      <div className="controls" role="group" aria-label="Replay controls">
        <button type="button" onClick={() => goTo(0)} disabled={index === 0}>First</button>
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}>Back</button>
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          disabled={!playing && index === last}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => goTo(index + 1)} disabled={index === last}>Forward</button>
        <button type="button" onClick={() => goTo(last)} disabled={index === last}>Last</button>

        <label>
          Speed{' '}
          <select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
            {SPEEDS.map(option => <option key={option} value={option}>{option}x</option>)}
          </select>
        </label>
        <label>
          Round{' '}
          <select value={frame.roundNumber} onChange={event => {
            const round = rounds.find(r => r.roundNumber === Number(event.target.value));
            if (round) goTo(round.index);
          }}>
            {rounds.map(round => <option key={round.index} value={round.roundNumber}>{round.roundNumber}</option>)}
          </select>
        </label>
      </div>

      <p className="status" aria-live={playing ? 'off' : 'polite'}>
        <span>Step {index + 1} of {frames.length}: {describeEvent(frame.event, replay.players)}</span>
        <TrumpInfo frame={frame} />
      </p>

      <div className="replay-layout">
        <div>
          <Trick frame={frame} players={replay.players} />
          <div className="seats">
            {replay.players.map(player => <Seat key={player.id} player={player} frame={frame} />)}
          </div>
        </div>
        <MoveList replay={replay} frames={frames} index={index} onSelect={goTo} />
      </div>

      <ScoreTable replay={replay} frames={frames} />
    </div>
  );
};
