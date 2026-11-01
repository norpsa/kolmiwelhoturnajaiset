import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';

export interface PlayerResult {
  botId: string;
  name: string;
  score: number;
}

export interface GameResult {
  gameId: string;
  finishedAt: string;
  players: PlayerResult[];
}

export interface LeaderboardRow {
  rank: number;
  botId: string;
  name: string;
  games: number;
  wins: number;
  // Average share of opponents beaten in a game, from 0 to 1. Ranking uses this
  // because scores aren't comparable: smaller tables play more rounds.
  performance: number;
  averageScore: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// Finished games, one JSON object per line. Kept only in memory if no file is given.
export class ResultStore {
  private results: GameResult[] = [];

  constructor(private filePath?: string) {
    if (filePath && existsSync(filePath)) {
      this.results = readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(line => line)
        .map(line => JSON.parse(line));
    }
  }

  // Counted before saving, so a failed write costs the result only at the next restart
  record(result: GameResult) {
    this.results.push(result);

    if (this.filePath) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(result)}\n`);
    }
  }

  leaderboard(): LeaderboardRow[] {
    const totals = new Map<string, { name: string; games: number; wins: number; performance: number; score: number }>();

    for (const { players } of this.results) {
      for (const player of players) {
        const others = players.filter(p => p !== player);
        const beaten = others.filter(p => p.score < player.score).length;
        const tied = others.filter(p => p.score === player.score).length;

        const total = totals.get(player.botId) ?? { name: player.name, games: 0, wins: 0, performance: 0, score: 0 };
        total.games++;
        total.wins += beaten + tied === others.length ? 1 : 0;
        total.performance += (beaten + tied / 2) / others.length;
        total.score += player.score;
        totals.set(player.botId, total);
      }
    }

    return [...totals]
      .map(([botId, total]) => ({
        botId,
        name: total.name,
        games: total.games,
        wins: total.wins,
        performance: round(total.performance / total.games),
        averageScore: round(total.score / total.games),
      }))
      .sort((a, b) => b.performance - a.performance || b.games - a.games || a.name.localeCompare(b.name))
      .map((row, index) => ({ rank: index + 1, ...row }));
  }
}
