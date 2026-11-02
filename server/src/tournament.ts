import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GameResult, PlayerResult } from './result-store';
import { MAX_PLAYERS, MIN_PLAYERS } from './wizard/game-engine';
import { RegisteredPlayer } from './wizard/types';

export type TournamentStatus = 'signup' | 'running' | 'finished' | 'interrupted';

export const MAX_ROUNDS = 100;
const MAX_NAME_LENGTH = 64;

export interface TournamentTable {
  // Also the id of the game
  id: string;
  players: RegisteredPlayer[];
  result: GameResult | null;
}

export interface Tournament {
  id: string;
  name: string;
  tableSize: number;
  rounds: number;
  status: TournamentStatus;
  createdAt: string;
  entrants: RegisteredPlayer[];
  // Tables by round, only for rounds that have been drawn
  schedule: TournamentTable[][];
}

export interface StandingsRow {
  rank: number;
  botId: string;
  name: string;
  games: number;
  points: number;
  averagePoints: number;
  wins: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export const isValidSettings = (name: unknown, tableSize: unknown, rounds: unknown) =>
  typeof name === 'string' &&
  name.trim().length >= 1 &&
  name.trim().length <= MAX_NAME_LENGTH &&
  Number.isInteger(tableSize) &&
  (tableSize as number) >= MIN_PLAYERS &&
  (tableSize as number) <= MAX_PLAYERS &&
  Number.isInteger(rounds) &&
  (rounds as number) >= 1 &&
  (rounds as number) <= MAX_ROUNDS;

// What a game gives each bot. Places are worth tableSize - 1 points for 1st down to 0 for
// last, and bots tied on score split the places they share. Score only decides the order.
// Bots that didn't finish get 0, and the others are placed among themselves from 1st.
export const placingPoints = ({ players, didNotFinish }: GameResult, tableSize: number) => {
  const placings = new Map<string, { points: number; won: boolean }>();
  const finished: PlayerResult[] = [];

  for (const player of players) {
    if (didNotFinish?.includes(player.botId)) placings.set(player.botId, { points: 0, won: false });
    else finished.push(player);
  }

  const ordered = [...finished].sort((a, b) => b.score - a.score);
  ordered.forEach(player => {
    const tied = ordered.filter(p => p.score === player.score);
    const firstPlace = ordered.indexOf(tied[0]);
    const lastPlace = firstPlace + tied.length - 1;
    placings.set(player.botId, {
      points: tableSize - 1 - (firstPlace + lastPlace) / 2,
      won: firstPlace === 0,
    });
  });

  return placings;
};

// Average points decide, because bots sitting out can leave a difference of one game.
// Bots level on both average and wins share a rank.
export const standings = ({ entrants, schedule, tableSize }: Tournament): StandingsRow[] => {
  const totals = new Map(entrants.map(bot => [bot.id, { games: 0, points: 0, wins: 0 }]));

  for (const table of schedule.flat()) {
    if (!table.result) continue;
    for (const [botId, { points, won }] of placingPoints(table.result, tableSize)) {
      const total = totals.get(botId);
      if (!total) continue;
      total.games++;
      total.points += points;
      total.wins += won ? 1 : 0;
    }
  }

  const rows = entrants
    .map(bot => {
      const { games, points, wins } = totals.get(bot.id)!;
      return { botId: bot.id, name: bot.name, games, points, wins, averagePoints: games ? points / games : 0 };
    })
    .sort((a, b) => b.averagePoints - a.averagePoints || b.wins - a.wins || a.name.localeCompare(b.name));

  return rows.map(row => {
    const rank = 1 + rows.findIndex(r => r.averagePoints === row.averagePoints && r.wins === row.wins);
    return { rank, ...row, averagePoints: round(row.averagePoints) };
  });
};

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const shuffled = <T>(items: T[], random: () => number) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const DRAW_ATTEMPTS = 300;

// Tables for the next round. Bots that don't fit sit out, taken from those with the most
// games so that game counts stay within one. The best of many random draws is the one
// where bots meet earlier opponents the least.
export const drawTables = (
  botIds: string[],
  tableSize: number,
  earlierTables: string[][],
  random: () => number = Math.random
): string[][] => {
  const games = new Map(botIds.map(id => [id, 0]));
  const pairings = new Map<string, number>();

  for (const table of earlierTables) {
    table.forEach((id, i) => {
      games.set(id, (games.get(id) ?? 0) + 1);
      for (const other of table.slice(i + 1)) {
        const key = pairKey(id, other);
        pairings.set(key, (pairings.get(key) ?? 0) + 1);
      }
    });
  }

  const sittingOut = botIds.length % tableSize;
  const fewestGamesLast = shuffled(botIds, random).sort((a, b) => games.get(b)! - games.get(a)!);
  const playing = fewestGamesLast.slice(sittingOut);

  const chunks = (bots: string[]) =>
    Array.from({ length: bots.length / tableSize }, (_, i) => bots.slice(i * tableSize, (i + 1) * tableSize));

  const repeats = (tables: string[][]) => {
    let total = 0;
    for (const table of tables) {
      table.forEach((id, i) => {
        for (const other of table.slice(i + 1)) total += pairings.get(pairKey(id, other)) ?? 0;
      });
    }
    return total;
  };

  let best = chunks(shuffled(playing, random));
  for (let attempt = 1; attempt < DRAW_ATTEMPTS && repeats(best) > 0; attempt++) {
    const candidate = chunks(shuffled(playing, random));
    if (repeats(candidate) < repeats(best)) best = candidate;
  }
  return best;
};

// One file per tournament. Kept only in memory if no directory is given.
export class TournamentStore {
  private tournaments = new Map<string, Tournament>();

  constructor(private dirPath?: string) {
    if (!dirPath) return;

    mkdirSync(dirPath, { recursive: true });
    for (const file of readdirSync(dirPath).filter(name => name.endsWith('.json'))) {
      const tournament: Tournament = JSON.parse(readFileSync(join(dirPath, file), 'utf8'));
      this.tournaments.set(tournament.id, tournament);

      // Games live in memory, so a round that was running can't go on after a restart.
      // Sign-ups are lost too, as the bots aren't connected any more.
      if (tournament.status === 'running') {
        tournament.status = 'interrupted';
        this.save(tournament);
      } else if (tournament.status === 'signup' && tournament.entrants.length > 0) {
        tournament.entrants = [];
        this.save(tournament);
      }
    }
  }

  get(id: string) {
    return this.tournaments.get(id);
  }

  // Newest first
  list() {
    return [...this.tournaments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  save(tournament: Tournament) {
    this.tournaments.set(tournament.id, tournament);
    if (!this.dirPath) return;

    const path = join(this.dirPath, `${tournament.id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify(tournament));
    renameSync(`${path}.tmp`, path);
  }
}
