import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { GameList, LeaderboardRow } from '../types';
import { details } from './fixture';

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Answers by the path of the request and remembers what was asked
const mockApi = (answer: (path: string) => Response) => {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    asked.push(path);
    return answer(path);
  }));
  return asked;
};

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

const games: GameList = { total: 1, games: [details.result] };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('games page', () => {
  it('lists bots, scores and a replay link', async () => {
    mockApi(() => respond(games));
    open('/');

    const row = (await screen.findByText('Beta', { exact: false })).closest('tr')!;
    expect(row.textContent).toContain('Alpha');
    expect(row.textContent).toContain('70');
    expect(within(row).getByRole('link', { name: 'Replay' }).getAttribute('href')).toBe('/games/game-1');
  });

  it('marks the winner, and everyone tied for the win', async () => {
    const tied = { ...details.result, players: details.result.players.map(p => ({ ...p, score: 10 })) };
    mockApi(() => respond({ total: 1, games: [tied] }));
    open('/');

    expect(await screen.findAllByLabelText('Winner')).toHaveLength(3);
  });

  it('marks only the top score', async () => {
    mockApi(() => respond(games));
    open('/');

    const [winner] = await screen.findAllByLabelText('Winner');
    expect(winner.closest('li')!.textContent).toContain('Beta');
    expect(screen.getAllByLabelText('Winner')).toHaveLength(1);
  });

  it('says who a game does not count for', async () => {
    const unfinished = { ...details.result, didNotFinish: ['a', 'c'] };
    mockApi(() => respond({ total: 1, games: [unfinished] }));
    open('/');

    expect(await screen.findByText("Doesn't count for Alpha, Gamma: didn't play to the end")).toBeTruthy();
  });

  it.each([[undefined], [[]]])('shows no note when everyone finished (%j)', async didNotFinish => {
    mockApi(() => respond({ total: 1, games: [{ ...details.result, didNotFinish }] }));
    open('/');

    await screen.findByText('Beta', { exact: false });
    expect(screen.queryByText(/Doesn't count/)).toBeNull();
  });

  it('gives the win to the best bot that finished', async () => {
    const unfinished = { ...details.result, didNotFinish: ['b'] };
    mockApi(() => respond({ total: 1, games: [unfinished] }));
    open('/');

    const winners = await screen.findAllByLabelText('Winner');
    expect(winners).toHaveLength(1);
    expect(winners[0].closest('li')!.textContent).toContain('Gamma');
  });

  it('has no winner when one bot finished alone', async () => {
    const unfinished = { ...details.result, didNotFinish: ['a', 'b'] };
    mockApi(() => respond({ total: 1, games: [unfinished] }));
    open('/');

    await screen.findByText(/Doesn't count/);
    expect(screen.queryByLabelText('Winner')).toBeNull();
  });

  it('says when there are no games', async () => {
    mockApi(() => respond({ total: 0, games: [] }));
    open('/');

    expect(await screen.findByText('No finished games yet.')).toBeTruthy();
  });

  it('asks for the games of one bot', async () => {
    const asked = mockApi(() => respond(games));
    open('/?bot=b');

    expect(await screen.findByRole('heading', { name: 'Games of Beta' })).toBeTruthy();
    expect(asked[0]).toContain('botId=b');
    expect(screen.getByRole('link', { name: 'Show all games' })).toBeTruthy();
  });

  it('asks for the right page and links to the next ones', async () => {
    const asked = mockApi(() => respond({ ...games, total: 60 }));
    open('/?bot=b&page=2');

    expect(await screen.findByText('Page 2 of 3')).toBeTruthy();
    expect(asked[0]).toContain('offset=25');
    expect(screen.getByRole('link', { name: 'Newer' }).getAttribute('href')).toBe('/?bot=b&page=1');
    expect(screen.getByRole('link', { name: 'Older' }).getAttribute('href')).toBe('/?bot=b&page=3');
  });

  it('survives a nonsense page number', async () => {
    const asked = mockApi(() => respond(games));
    open('/?page=abc');

    await screen.findByText('Beta', { exact: false });
    expect(asked[0]).toContain('offset=0');
  });

  it('says when loading fails', async () => {
    mockApi(() => respond({}, 500));
    open('/');

    expect((await screen.findByRole('alert')).textContent).toContain('failed');
  });
});

describe('bots page', () => {
  const rows: LeaderboardRow[] = [
    { rank: 1, botId: 'b', name: 'Beta', games: 4, wins: 3, performance: 0.875, averageScore: 120.5 },
    { rank: 2, botId: 'a', name: 'Alpha', games: 4, wins: 0, performance: 0.125, averageScore: -40 },
  ];

  it('shows the stats of each bot', async () => {
    mockApi(() => respond(rows));
    open('/leaderboard');

    const row = (await screen.findByRole('link', { name: 'Beta' })).closest('tr')!;
    const cells = within(row).getAllByRole('cell').map(cell => cell.textContent);
    expect(cells).toEqual(['1', 'Beta', '4', '3', '75%', '88%', '121']);
  });

  it('links a bot to its games', async () => {
    mockApi(() => respond(rows));
    open('/leaderboard');

    expect((await screen.findByRole('link', { name: 'Alpha' })).getAttribute('href')).toBe('/?bot=a');
  });

  it('says when there are no bots', async () => {
    mockApi(() => respond([]));
    open('/leaderboard');

    expect(await screen.findByText('No bots have finished a game yet.')).toBeTruthy();
  });
});

describe('replay page', () => {
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
  const status = () => document.querySelector('.status')!.textContent;
  const seat = (name: string) => screen.getByRole('region', { name });

  const openReplay = async () => {
    mockApi(() => respond(details));
    open('/games/game-1');
    await screen.findByRole('group', { name: 'Replay controls' });
  };

  it('shows the deal first', async () => {
    await openReplay();

    expect(status()).toContain('Step 1 of 23');
    expect(status()).toContain('Round 1 dealt');
    expect(within(seat('Alpha')).getByRole('img', { name: '5 of elves' })).toBeTruthy();
  });

  it('asks for the right game', async () => {
    const asked = mockApi(() => respond(details));
    open('/games/game-1');
    await screen.findByRole('group', { name: 'Replay controls' });

    expect(asked).toEqual(['/api/games/game-1']);
  });

  it('steps forward and back', async () => {
    await openReplay();

    fireEvent.click(button('Forward'));
    expect(status()).toContain('Alpha chooses giants as trump');

    fireEvent.click(button('Back'));
    expect(status()).toContain('Round 1 dealt');
  });

  it('goes to both ends and stops there', async () => {
    await openReplay();
    expect(button('First').disabled).toBe(true);
    expect(button('Back').disabled).toBe(true);

    fireEvent.click(button('Last'));
    expect(status()).toContain('Step 23 of 23');
    expect(button('Forward').disabled).toBe(true);
    expect(button('Play').disabled).toBe(true);

    fireEvent.click(button('First'));
    expect(status()).toContain('Step 1 of 23');
  });

  it('follows the arrow keys', async () => {
    await openReplay();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(status()).toContain('Step 3 of 23');

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(status()).toContain('Step 2 of 23');
  });

  it('leaves the arrow keys to the menus', async () => {
    await openReplay();

    fireEvent.keyDown(screen.getByLabelText('Round'), { key: 'ArrowRight' });

    expect(status()).toContain('Step 1 of 23');
  });

  it('jumps to a round', async () => {
    await openReplay();

    fireEvent.change(screen.getByLabelText('Round'), { target: { value: '2' } });

    expect(status()).toContain('Round 2 dealt');
    expect((screen.getByLabelText('Round') as HTMLSelectElement).value).toBe('2');
  });

  it('jumps to a move in the list', async () => {
    await openReplay();

    const moves = within(screen.getByRole('list', { name: 'Moves' }));
    fireEvent.click(moves.getAllByRole('button')[8]);

    expect(status()).toContain('Step 9 of 23: Beta wins the trick');
    expect(moves.getAllByRole('button')[8].getAttribute('aria-current')).toBe('step');
  });

  it('labels moves made by the server', async () => {
    await openReplay();

    const auto = screen.getAllByText('(played by server)');
    expect(auto).toHaveLength(2);
    expect(auto[0].closest('button')!.textContent).toContain('Gamma bids 0');
  });

  it('shows bids, tricks and scores as the game goes on', async () => {
    await openReplay();

    fireEvent.click(button('Last'));

    expect(seat('Beta').textContent).toContain('70 points');
    expect(seat('Beta').textContent).toContain('Bid 2, tricks 2');
  });

  it('highlights the first player of the round', async () => {
    await openReplay();

    // Alpha chooses the trump before Beta starts the round
    expect(seat('Alpha').className).toContain('active');
    expect(seat('Alpha').textContent).not.toContain('First');
    expect(seat('Beta').className).toContain('first');
    expect(seat('Beta').textContent).toContain('First');

    fireEvent.click(button('Last'));

    expect(seat('Beta').className).not.toContain('first');
    expect(seat('Gamma').className).toContain('first');
    expect(document.querySelectorAll('.first-badge')).toHaveLength(1);
  });

  it('shows the total bids of the round', async () => {
    await openReplay();
    expect(status()).toContain('Total bids: 0 · Tricks in round: 1');

    for (let i = 0; i < 4; i++) fireEvent.click(button('Forward'));
    expect(status()).toContain('Total bids: 2 · Tricks in round: 1');

    fireEvent.click(button('Last'));
    expect(status()).toContain('Total bids: 3 · Tricks in round: 2');
  });

  it('shows the current trick', async () => {
    await openReplay();

    for (let i = 0; i < 6; i++) fireEvent.click(button('Forward'));

    const trick = screen.getByRole('region', { name: 'Current trick' });
    expect(within(trick).getByRole('img', { name: 'Wizard' })).toBeTruthy();
    expect(trick.textContent).toContain('Gamma');
  });

  it('highlights whose move it is', async () => {
    await openReplay();
    expect(seat('Alpha').className).toContain('active');
    expect(seat('Beta').className).not.toContain('active');
  });

  it('plays by itself and stops at the end', async () => {
    await openReplay();
    vi.useFakeTimers();

    fireEvent.click(button('Play'));
    expect(button('Pause')).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(status()).toContain('Step 1 of 23');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(status()).toContain('Step 2 of 23');

    // One at a time, because each step sets the timer for the next one
    for (let step = 0; step < 30; step++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    }
    expect(status()).toContain('Step 23 of 23');
    expect(button('Play')).toBeTruthy();
  });

  it('pauses', async () => {
    await openReplay();
    vi.useFakeTimers();

    fireEvent.click(button('Play'));
    fireEvent.click(button('Pause'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(status()).toContain('Step 1 of 23');
  });

  it('plays faster at a higher speed', async () => {
    await openReplay();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '2' } });
    fireEvent.click(button('Play'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(status()).toContain('Step 2 of 23');
  });

  it('has scores by round', async () => {
    await openReplay();

    const table = screen.getByText('Scores by round').closest('details')!;
    const rows = within(table).getAllByRole('row', { hidden: true });
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('70 (2/2)');
  });

  it('says who a game does not count for', async () => {
    mockApi(() => respond({ ...details, result: { ...details.result, didNotFinish: ['b'] } }));
    open('/games/game-1');

    expect(await screen.findByText("Doesn't count for Beta: didn't play to the end")).toBeTruthy();
  });

  it('shows the result of a game with no replay', async () => {
    mockApi(() => respond({ ...details, replay: null }));
    open('/games/game-1');

    expect(await screen.findByText(/before replays were saved/)).toBeTruthy();
    expect(screen.getByText('Beta', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Replay controls' })).toBeNull();
  });

  it('says when a game is not found', async () => {
    mockApi(() => respond({ error: 'Game not found' }, 404));
    open('/games/nope');

    expect((await screen.findByRole('alert')).textContent).toBe('This game was not found.');
  });
});

describe('navigation', () => {
  beforeEach(() => {
    mockApi(path => respond(path.includes('leaderboard') ? [] : games));
  });

  it('has a page for unknown paths', () => {
    open('/nope');
    expect(screen.getByText(/doesn't exist/)).toBeTruthy();
  });

  it('moves between the pages', async () => {
    open('/');
    fireEvent.click(screen.getByRole('link', { name: 'Bots' }));
    expect(await screen.findByRole('heading', { name: 'Bots' })).toBeTruthy();
  });
});
