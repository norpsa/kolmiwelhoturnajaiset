import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GameResult, PlayerResult } from './result-store';
import { MAX_PLAYERS, MIN_PLAYERS } from './wizard/game-engine';
import { RegisteredPlayer } from './wizard/types';

export type TournamentStatus = 'signup' | 'running' | 'finished' | 'interrupted' | 'cancelled';

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
  // Bots that were gone when each round was drawn. Missing from older files.
  absences?: RegisteredPlayer[][];
}

export interface StandingsRow {
  rank: number;
  botId: string;
  name: string;
  // Includes the rounds it missed, which are worth 0 points
  games: number;
  missed: number;
  points: number;
  averagePoints: number;
  wins: number;
  // Over the games it finished. Used only as the last tie-break.
  averageScore: number;
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

// For a group of level bots: games each won against the others, minus games lost to them
const headToHead = (group: string[], results: GameResult[], tableSize: number) => {
  const net = new Map(group.map(id => [id, 0]));

  for (const result of results) {
    const placings = placingPoints(result, tableSize);
    const present = group.filter(id => placings.has(id));
    for (const id of present) {
      for (const other of present) {
        const difference = placings.get(id)!.points - placings.get(other)!.points;
        net.set(id, net.get(id)! + Math.sign(difference));
      }
    }
  }
  return net;
};

// Average points decide, because bots sitting out can leave a difference of one game. Ties
// go to the most wins, then to who placed ahead when the level bots met, and last to the
// average game score. Only bots level on all of these share a rank.
export const standings = ({ entrants, schedule, tableSize, absences = [] }: Tournament): StandingsRow[] => {
  const totals = new Map(
    entrants.map(bot => [bot.id, { played: 0, missed: 0, points: 0, wins: 0, score: 0, finished: 0 }])
  );
  const results = schedule.flat().flatMap(table => (table.result ? [table.result] : []));

  for (const result of results) {
    for (const [botId, { points, won }] of placingPoints(result, tableSize)) {
      const total = totals.get(botId);
      if (!total) continue;
      total.played++;
      total.points += points;
      total.wins += won ? 1 : 0;
    }
    for (const { botId, score } of result.players) {
      const total = totals.get(botId);
      if (!total || result.didNotFinish?.includes(botId)) continue;
      total.finished++;
      total.score += score;
    }
  }

  for (const bot of absences.flat()) {
    const total = totals.get(bot.id);
    if (total) total.missed++;
  }

  const rows = entrants
    .map(bot => {
      const { played, missed, points, wins, score, finished } = totals.get(bot.id)!;
      const games = played + missed;
      return {
        botId: bot.id,
        name: bot.name,
        games,
        missed,
        points,
        wins,
        averagePoints: games ? points / games : 0,
        averageScore: finished ? score / finished : 0,
        finished,
      };
    })
    .sort((a, b) => b.averagePoints - a.averagePoints || b.wins - a.wins);

  // With no finished games the average score means nothing, so it can't beat a real one
  const hasScore = (row: (typeof rows)[number]) => Number(row.finished > 0);

  const net = new Map<string, number>();
  const ordered: typeof rows = [];

  while (rows.length > 0) {
    const [first] = rows;
    const level = rows.filter(r => r.averagePoints === first.averagePoints && r.wins === first.wins);
    rows.splice(0, level.length);

    headToHead(level.map(r => r.botId), results, tableSize).forEach((value, id) => net.set(id, value));
    ordered.push(
      ...level.sort(
        (a, b) =>
          net.get(b.botId)! - net.get(a.botId)! ||
          hasScore(b) - hasScore(a) ||
          b.averageScore - a.averageScore ||
          a.name.localeCompare(b.name)
      )
    );
  }

  const isLevel = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.averagePoints === b.averagePoints &&
    a.wins === b.wins &&
    net.get(a.botId) === net.get(b.botId) &&
    hasScore(a) === hasScore(b) &&
    a.averageScore === b.averageScore;

  return ordered.map(({ finished: _, ...row }, index) => ({
    rank: 1 + ordered.findIndex(other => isLevel(other, ordered[index])),
    ...row,
    averagePoints: round(row.averagePoints),
    averageScore: round(row.averageScore),
  }));
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
