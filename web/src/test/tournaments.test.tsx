import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { GameResult, Tournament, TournamentSummary } from '../types';

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  path: string;
  init?: RequestInit;
}

const mockApi = (answer: (call: Call) => Response) => {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    const call = { path, init };
    calls.push(call);
    return answer(call);
  }));
  return calls;
};

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

const summary: TournamentSummary = {
  id: 't1',
  name: 'Autumn Cup',
  tableSize: 4,
  rounds: 6,
  status: 'finished',
  createdAt: '2026-11-01T12:00:00.000Z',
  entrants: 8,
  roundsPlayed: 6,
  winners: ['Planner'],
};

const entrants = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

const result: GameResult = {
  gameId: 'game-1',
  finishedAt: '2026-11-01T12:00:00.000Z',
  players: [
    { botId: 'a', name: 'Alpha', score: 30 },
    { botId: 'b', name: 'Beta', score: 20 },
    { botId: 'c', name: 'Gamma', score: 90 },
  ],
  didNotFinish: ['c'],
  tournamentId: 't1',
  round: 1,
};

const tournament = (changes: Partial<Tournament> = {}): Tournament => ({
  id: 't1',
  name: 'Autumn Cup',
  tableSize: 3,
  rounds: 2,
  status: 'running',
  createdAt: '2026-11-01T12:00:00.000Z',
  entrants,
  schedule: [
    [{ gameId: 'game-1', players: entrants, result }],
    [{ gameId: null, players: entrants, result: null }],
  ],
  absences: [[], [{ id: 'c', name: 'Gamma' }]],
  standings: [
    { rank: 1, botId: 'a', name: 'Alpha', games: 1, missed: 0, points: 2, averagePoints: 2, wins: 1, averageScore: 30.4 },
    { rank: 2, botId: 'b', name: 'Beta', games: 1, missed: 0, points: 1, averagePoints: 1, wins: 0, averageScore: 20 },
    { rank: 3, botId: 'c', name: 'Gamma', games: 2, missed: 1, points: 0, averagePoints: 0, wins: 0, averageScore: 0 },
  ],
  ...changes,
});

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tournaments page', () => {
  const fillIn = (key: string) => {
    fireEvent.click(screen.getByText('Create a tournament'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Winter Cup' } });
    fireEvent.change(screen.getByLabelText('Bots at each table'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Rounds'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Organiser key'), { target: { value: key } });
  };

  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  it('lists tournaments with their status and winner', async () => {
    mockApi(() => respond([summary]));
    open('/tournaments');

    const row = (await screen.findByRole('link', { name: 'Autumn Cup' })).closest('tr')!;
    const cells = within(row).getAllByRole('cell').map(cell => cell.textContent);
    expect(cells).toEqual(['Autumn Cup', 'Finished', '8', '4', '6/6', 'Planner']);
    expect(screen.getByRole('link', { name: 'Autumn Cup' }).getAttribute('href')).toBe('/tournaments/t1');
  });

  it('says when there are none', async () => {
    mockApi(() => respond([]));
    open('/tournaments');

    expect(await screen.findByText('No tournaments yet.')).toBeTruthy();
  });

  it('says when loading fails', async () => {
    mockApi(() => respond({}, 500));
    open('/tournaments');

    expect((await screen.findByRole('alert')).textContent).toContain('failed');
  });

  it('creates a tournament with the key and opens it', async () => {
    const created = tournament({ id: 'new', status: 'signup', entrants: [], schedule: [] });
    const calls = mockApi(({ path, init }) => {
      if (init?.method === 'POST') return respond(created, 201);
      return respond(path === '/api/tournaments/new' ? created : []);
    });
    open('/tournaments');
    await screen.findByText('No tournaments yet.');

    fillIn('secret');
    submit();

    expect(await screen.findByText(/--tournament new/)).toBeTruthy();
    const post = calls.find(call => call.init?.method === 'POST')!;
    expect(post.path).toBe('/api/tournaments');
    expect(JSON.parse(post.init!.body as string)).toEqual({ name: 'Winter Cup', tableSize: 5, rounds: 12 });
    expect((post.init!.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it.each([
    [401, 'Wrong organiser key.'],
    [403, 'This server has no organiser key. Set ADMIN_KEY to use this.'],
  ])('explains a %i', async (status, message) => {
    mockApi(({ init }) => (init?.method === 'POST' ? respond({ error: 'no' }, status) : respond([])));
    open('/tournaments');
    await screen.findByText('No tournaments yet.');

    fillIn('wrong');
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it("shows the server's explanation of bad settings", async () => {
    mockApi(({ init }) => (init?.method === 'POST' ? respond({ error: 'Needs 1-100 rounds' }, 400) : respond([])));
    open('/tournaments');
    await screen.findByText('No tournaments yet.');

    fillIn('secret');
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe('Needs 1-100 rounds');
  });

  it('keeps the key only for the session', async () => {
    mockApi(() => respond([]));
    open('/tournaments');
    await screen.findByText('No tournaments yet.');

    fillIn('secret');

    expect(sessionStorage.getItem('organiser-key')).toBe('secret');
    expect(localStorage.getItem('organiser-key')).toBeNull();
    expect((screen.getByLabelText('Organiser key') as HTMLInputElement).type).toBe('password');
  });
});

describe('tournament page', () => {
  it('shows sign-up with the command and the bots so far', async () => {
    mockApi(() => respond(tournament({ status: 'signup', schedule: [] })));
    open('/tournaments/t1');

    expect((await screen.findByText(/npm start/)).textContent).toBe(
      'npm start -- --name MyBot --tournament t1'
    );
    const section = screen.getByRole('region', { name: 'Sign-up' });
    expect(section.textContent).toContain('Bots signed up: 3');
    expect(section.textContent).toContain('Gamma');
    expect(section.textContent).toContain('Needs at least 3 bots');
    expect(screen.queryByRole('region', { name: 'Standings' })).toBeNull();
  });

  it('starts it with the key and shows the running tournament', async () => {
    let started = false;
    const calls = mockApi(({ init }) => {
      if (init?.method === 'POST') {
        started = true;
        return respond(tournament());
      }
      return respond(started ? tournament() : tournament({ status: 'signup', schedule: [] }));
    });
    open('/tournaments/t1');
    await screen.findByText(/npm start/);

    fireEvent.change(screen.getByLabelText('Organiser key'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start the tournament' }));

    expect(await screen.findByRole('region', { name: 'Standings' })).toBeTruthy();
    const post = calls.find(call => call.init?.method === 'POST')!;
    expect(post.path).toBe('/api/tournaments/t1/start');
    expect((post.init!.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('explains when it can not start', async () => {
    mockApi(({ init }) =>
      init?.method === 'POST'
        ? respond({ error: 'Needs at least 3 bots' }, 409)
        : respond(tournament({ status: 'signup', schedule: [] }))
    );
    open('/tournaments/t1');
    await screen.findByText(/npm start/);

    fireEvent.change(screen.getByLabelText('Organiser key'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start the tournament' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Needs at least 3 bots');
  });

  it('shows standings', async () => {
    mockApi(() => respond(tournament()));
    open('/tournaments/t1');

    const row = (await screen.findByRole('link', { name: 'Alpha' })).closest('tr')!;
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
      '1', 'Alpha', '1', '2', '2.00', '1', '0', '30',
    ]);
    const standings = screen.getByRole('region', { name: 'Standings' }).textContent;
    expect(standings).toContain('1st place gets 2 points');
    expect(standings).toContain('who placed ahead when the tied bots met');
  });

  it('shows who missed a round', async () => {
    mockApi(() => respond(tournament()));
    open('/tournaments/t1');

    const rounds = await screen.findByRole('region', { name: 'Rounds' });
    expect(rounds.textContent).toContain('Missed this round: Gamma');
    const round1 = within(rounds).getByRole('heading', { name: 'Round 1 of 2' }).closest('.round')!;
    expect(round1.textContent).not.toContain('Missed this round');
  });

  it('copes with a tournament saved before absences existed', async () => {
    mockApi(() => respond(tournament({ absences: undefined })));
    open('/tournaments/t1');

    expect(await screen.findByRole('region', { name: 'Rounds' })).toBeTruthy();
  });

  it('cancels with the key and says so', async () => {
    let cancelled = false;
    const calls = mockApi(({ init }) => {
      if (init?.method === 'POST') cancelled = true;
      return respond(tournament({ status: cancelled ? 'cancelled' : 'signup', schedule: [], absences: [] }));
    });
    open('/tournaments/t1');
    await screen.findByText(/npm start/);

    const cancel = screen.getByRole('button', { name: 'Cancel the tournament' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Organiser key'), { target: { value: 'secret' } });
    fireEvent.click(cancel);

    expect(await screen.findByText(/cancelled this tournament/)).toBeTruthy();
    const post = calls.find(call => call.init?.method === 'POST')!;
    expect(post.path).toBe('/api/tournaments/t1/cancel');
    expect((post.init!.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(screen.queryByRole('region', { name: 'Standings' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sign-up' })).toBeNull();
  });

  it('explains when cancelling fails', async () => {
    mockApi(({ init }) =>
      init?.method === 'POST' ? respond({ error: 'no' }, 401) : respond(tournament({ status: 'signup', schedule: [] }))
    );
    open('/tournaments/t1');
    await screen.findByText(/npm start/);

    fireEvent.change(screen.getByLabelText('Organiser key'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the tournament' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Wrong organiser key.');
  });

  it('shows the newest round first, with running tables and replays', async () => {
    mockApi(() => respond(tournament()));
    open('/tournaments/t1');

    const rounds = await screen.findByRole('region', { name: 'Rounds' });
    expect(within(rounds).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Round 2 of 2',
      'Round 1 of 2',
    ]);
    expect(rounds.textContent).toContain('playing');
    expect(within(rounds).getByRole('link', { name: 'Replay' }).getAttribute('href')).toBe('/games/game-1');
  });

  it('gives the win to the best bot that finished and explains last place', async () => {
    mockApi(() => respond(tournament()));
    open('/tournaments/t1');

    const rounds = await screen.findByRole('region', { name: 'Rounds' });
    expect(within(rounds).getByLabelText('Winner').closest('li')!.textContent).toContain('Alpha');
    expect(rounds.textContent).toContain("Last place for Gamma: didn't play to the end");
  });

  it('explains an interrupted tournament', async () => {
    mockApi(() => respond(tournament({ status: 'interrupted' })));
    open('/tournaments/t1');

    expect(await screen.findByText(/server restarted/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Standings' })).toBeTruthy();
  });

  it('says when a tournament is not found', async () => {
    mockApi(() => respond({ error: 'Tournament not found' }, 404));
    open('/tournaments/nope');

    expect((await screen.findByRole('alert')).textContent).toBe('This tournament was not found.');
  });

  describe('refreshing', () => {
    const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('follows a running tournament until it finishes', async () => {
      let status: Tournament['status'] = 'running';
      const calls = mockApi(() => respond(tournament({ status })));
      open('/tournaments/t1');
      await settle();
      expect(calls).toHaveLength(1);

      await wait(5000);
      expect(calls).toHaveLength(2);

      status = 'finished';
      await wait(5000);
      expect(calls).toHaveLength(3);
      expect(screen.getByText(/Finished ·/)).toBeTruthy();

      await wait(30000);
      expect(calls).toHaveLength(3);
    });

    it('keeps updating sign-ups', async () => {
      let bots = entrants.slice(0, 1);
      mockApi(() => respond(tournament({ status: 'signup', schedule: [], entrants: bots })));
      open('/tournaments/t1');
      await settle();
      expect(screen.getByText('Bots signed up: 1')).toBeTruthy();

      bots = entrants;
      await wait(5000);

      expect(screen.getByText('Bots signed up: 3')).toBeTruthy();
    });

    it("doesn't lose what the organiser typed when refreshing", async () => {
      mockApi(() => respond(tournament({ status: 'signup', schedule: [] })));
      open('/tournaments/t1');
      await settle();

      fireEvent.change(screen.getByLabelText('Organiser key'), { target: { value: 'typing' } });
      const input = screen.getByLabelText('Organiser key');
      await wait(5000);

      expect(screen.getByLabelText('Organiser key')).toBe(input);
      expect((input as HTMLInputElement).value).toBe('typing');
    });

    it('keeps showing the page if a refresh fails', async () => {
      let failing = false;
      mockApi(() => (failing ? respond({}, 500) : respond(tournament())));
      open('/tournaments/t1');
      await settle();

      failing = true;
      await wait(5000);

      expect(screen.getByRole('region', { name: 'Standings' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['finished', 'interrupted', 'cancelled'] as const)("doesn't refresh a tournament that is %s", async status => {
      const calls = mockApi(() => respond(tournament({ status })));
      open('/tournaments/t1');
      await settle();

      await wait(30000);

      expect(calls).toHaveLength(1);
    });
  });
});

describe('games of a tournament', () => {
  it('links from the games list', async () => {
    mockApi(() => respond({ total: 1, games: [result] }));
    open('/');

    const link = await screen.findByRole('link', { name: 'Tournament game' });
    expect(link.getAttribute('href')).toBe('/tournaments/t1');
    expect(link.closest('p')!.textContent).toContain('round 1');
  });

  it('links from the replay', async () => {
    mockApi(() => respond({ result, replay: null }));
    open('/games/game-1');

    expect((await screen.findByRole('link', { name: 'Tournament game' })).getAttribute('href')).toBe('/tournaments/t1');
  });

  it("doesn't show on casual games", async () => {
    const { tournamentId: _, round: __, ...casual } = result;
    mockApi(() => respond({ total: 1, games: [casual] }));
    open('/');

    await screen.findByText(/Doesn't count for Gamma/);
    expect(screen.queryByRole('link', { name: 'Tournament game' })).toBeNull();
  });

  it('is in the navigation', async () => {
    mockApi(() => respond([]));
    open('/');

    expect(screen.getByRole('link', { name: 'Tournaments' }).getAttribute('href')).toBe('/tournaments');
  });
});
