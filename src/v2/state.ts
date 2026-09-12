import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

export interface LedgerEntry {
  id: string;
  operationKey: string;
  userId: string;
  delta: number;
  kind: string;
  groupId: string | null;
  createdAt: number;
  meta: Record<string, unknown>;
}

export interface FollowEntry {
  id: string;
  kind: 'movie' | 'tv' | 'release';
  provider: 'tmdb' | 'local';
  providerId: string;
  title: string;
  createdAt: number;
}

export interface WatchItem {
  id: string;
  title: string;
  watchedAt: number | null;
  createdAt: number;
}

export interface GroupSession {
  id: string;
  title: string;
  createdBy: string;
  members: string[];
  createdAt: number;
  status: 'open' | 'closed';
}

export interface ActivityEntry {
  firstSeenAt: number;
  lastSeenAt: number;
  messagesObserved: number;
}

export interface CleanupDraft {
  token: string;
  actorId: string;
  days: number;
  candidateIds: string[];
  expiresAt: number;
}

export interface V2State {
  version: 1;
  users: Record<string, { createdAt: number; notifications: boolean; deletedAt: number | null }>;
  wallets: Record<string, { credits: number; gems: number }>;
  ledger: LedgerEntry[];
  dailyClaims: Record<string, string>;
  inventory: Record<string, string[]>;
  follows: Record<string, FollowEntry[]>;
  watchlists: Record<string, WatchItem[]>;
  groupSuggestions: Record<string, Array<{ id: string; title: string; suggestedBy: string; votes: string[]; createdAt: number }>>;
  sessions: Record<string, GroupSession>;
  activity: Record<string, Record<string, ActivityEntry>>;
  exemptions: Record<string, string[]>;
  cleanupDrafts: Record<string, CleanupDraft>;
  processedOps: Record<string, number>;
}

export function emptyState(): V2State {
  return {
    version: 1,
    users: {},
    wallets: {},
    ledger: [],
    dailyClaims: {},
    inventory: {},
    follows: {},
    watchlists: {},
    groupSuggestions: {},
    sessions: {},
    activity: {},
    exemptions: {},
    cleanupDrafts: {},
    processedOps: {}
  };
}

export interface StateStore {
  readonly kind: 'json' | 'postgres';
  read<T>(fn: (state: Readonly<V2State>) => T): Promise<T>;
  mutate<T>(fn: (state: V2State) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function normalizeState(value: unknown): V2State {
  if (!value || typeof value !== 'object') return emptyState();
  return { ...emptyState(), ...(value as Partial<V2State>), version: 1 } as V2State;
}

function cloneState(state: V2State): V2State {
  return structuredClone(state);
}

export class JsonStateStore implements StateStore {
  readonly kind = 'json' as const;
  private readonly file: string;
  private state: V2State = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(authDir: string) {
    this.file = join(authDir, 'rimuru-v2-state.json');
  }

  async init(): Promise<void> {
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  async read<T>(fn: (state: Readonly<V2State>) => T): Promise<T> {
    await this.queue;
    return fn(cloneState(this.state));
  }

  async mutate<T>(fn: (state: V2State) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const next = cloneState(this.state);
      const result = await fn(next);
      this.state = next;
      await this.persist();
      return result;
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2), 'utf8');
    await rename(temp, this.file);
  }
}

export class PostgresStateStore implements StateStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 8000 });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rimuru_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(
      'INSERT INTO rimuru_state(id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
      [JSON.stringify(emptyState())]
    );
  }

  async read<T>(fn: (state: Readonly<V2State>) => T): Promise<T> {
    const result = await this.pool.query<{ data: unknown }>('SELECT data FROM rimuru_state WHERE id = 1');
    return fn(normalizeState(result.rows[0]?.data));
  }

  async mutate<T>(fn: (state: V2State) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ data: unknown }>('SELECT data FROM rimuru_state WHERE id = 1 FOR UPDATE');
      const state = normalizeState(result.rows[0]?.data);
      const value = await fn(state);
      await client.query('UPDATE rimuru_state SET data = $1::jsonb, updated_at = now() WHERE id = 1', [JSON.stringify(state)]);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createStateStore(authDir: string): Promise<StateStore> {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (databaseUrl) {
    const store = new PostgresStateStore(databaseUrl);
    await store.init();
    return store;
  }
  const store = new JsonStateStore(authDir);
  await store.init();
  return store;
}
