import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const MAX_NAME_LENGTH = 32;

export interface Bot {
  id: string;
  name: string;
}

interface StoredBot extends Bot {
  tokenHash: string;
  createdAt: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const isValidBotName = (name: unknown): name is string =>
  typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH;

// Lasting identities of bots. Kept only in memory if no file is given.
export class BotRegistry {
  // By lowercase name, so that Bot and bot can't be two different bots
  private bots = new Map<string, StoredBot>();

  constructor(private filePath?: string) {
    if (filePath && existsSync(filePath)) {
      const stored: StoredBot[] = JSON.parse(readFileSync(filePath, 'utf8'));
      stored.forEach(bot => this.bots.set(bot.name.toLowerCase(), bot));
    }
  }

  // Claims a free name, or logs in to a claimed one. The token is returned only when
  // the name is claimed, because only its hash is stored.
  authenticate(name: string, token: unknown): { bot: Bot; token?: string } {
    const stored = this.bots.get(name.toLowerCase());
    if (!stored) return this.create(name);

    if (typeof token !== 'string' || !this.isTokenOf(stored, token)) {
      throw new Error('Name is taken, a valid token is needed');
    }
    return { bot: { id: stored.id, name: stored.name } };
  }

  private create(name: string) {
    const token = randomBytes(32).toString('hex');
    const stored = {
      id: randomUUID(),
      name,
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
    };

    // Saved first, so that a failed write can't hand out a token that is later lost
    this.save([...this.bots.values(), stored]);
    this.bots.set(name.toLowerCase(), stored);
    return { bot: { id: stored.id, name }, token };
  }

  private isTokenOf(bot: StoredBot, token: string) {
    return timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(bot.tokenHash));
  }

  private save(bots: StoredBot[]) {
    if (!this.filePath) return;

    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(bots, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
