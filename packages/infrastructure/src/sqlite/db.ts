import { createClient, type Client, type Transaction } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { schema, type Schema } from './schema.js';

export type Database = LibSQLDatabase<Schema>;

export interface DatabaseHandle {
  client: Client;
  db: Database;
  /** Apply pending migrations from the package's `drizzle/` folder. Idempotent. */
  migrate(): Promise<void>;
  /**
   * How many shipped migrations `migrate()` would apply now, by the same rule Drizzle uses (a
   * migration is pending when it is newer than the last one recorded). Read-only; 0 when current.
   */
  pendingMigrations(): Promise<number>;
  close(): void;
}

export interface DatabaseOptions {
  /** libsql URL: `file:/path/to/graphgoblin.db` or `:memory:`. */
  url: string;
  /** Override the migrations folder; defaults to the folder shipped with this package. */
  migrationsFolder?: string;
}

const DEFAULT_MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** A minimal async mutex. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Acquire the lock; resolves with a release function. */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = this.tail.then(() => next);
    return previous.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    });
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

type AnyFn = (...args: unknown[]) => unknown;

/** The longest stretch of back-to-back database work before the client yields to the event loop. */
export const YIELD_INTERVAL_MS = 10;

/**
 * Serialise every statement and transaction through one mutex. SQLite has one writer at a time
 * anyway, libsql's in-memory client has exactly one connection, and GraphGoblin 1.0 is a single
 * process, so this is both correct and cheap. A transaction holds the lock until it commits,
 * rolls back, or closes. Inside a transaction callback, always use the transaction handle, never
 * the outer client, or the callback deadlocks on its own lock.
 *
 * libsql's local client does its work in native code and settles its promises without returning
 * to the event loop, so a burst of statements (an executor appending a thousand events back to
 * back) would starve sockets, timers, and SSE flushes until it ended. Before taking the lock, the
 * client therefore yields with `setImmediate` once `YIELD_INTERVAL_MS` have passed since the last
 * yield (docs/10, "Performance baseline").
 */
export function serializeClient(inner: Client): Client {
  const mutex = new Mutex();
  let lastYield = performance.now();
  const breathe = async (): Promise<void> => {
    if (performance.now() - lastYield < YIELD_INTERVAL_MS) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    lastYield = performance.now();
  };
  const run = async (fn: () => Promise<unknown>): Promise<unknown> => {
    await breathe();
    return mutex.run(fn);
  };
  const wrapTransaction = (tx: Transaction, release: () => void): Transaction => {
    const finish = (name: 'commit' | 'rollback' | 'close') => async () => {
      try {
        await tx[name]();
      } finally {
        release();
      }
    };
    return new Proxy(tx, {
      get(target, prop, receiver) {
        if (prop === 'commit' || prop === 'rollback' || prop === 'close') return finish(prop);
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as AnyFn).bind(target) : value;
      },
    });
  };
  const overrides: Partial<Record<keyof Client, AnyFn>> = {
    execute: (...args: unknown[]) =>
      run(() => (inner.execute as AnyFn)(...args) as Promise<unknown>),
    batch: (...args: unknown[]) => run(() => (inner.batch as AnyFn)(...args) as Promise<unknown>),
    executeMultiple: (...args: unknown[]) =>
      run(() => (inner.executeMultiple as AnyFn)(...args) as Promise<unknown>),
    migrate: (...args: unknown[]) =>
      run(() => (inner.migrate as AnyFn)(...args) as Promise<unknown>),
    transaction: async (...args: unknown[]) => {
      await breathe();
      const release = await mutex.acquire();
      try {
        const tx = (await (inner.transaction as AnyFn)(...args)) as Transaction;
        return wrapTransaction(tx, release);
      } catch (error) {
        release();
        throw error;
      }
    },
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const override = overrides[prop as keyof Client];
      if (override) return override;
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as AnyFn).bind(target) : value;
    },
  });
}

export function openDatabase(options: DatabaseOptions): DatabaseHandle {
  const client = serializeClient(createClient({ url: options.url }));
  const db = drizzle(client, { schema });
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS;
  return {
    client,
    db,
    async migrate() {
      await client.execute('PRAGMA journal_mode = WAL').catch(() => undefined);
      await client.execute('PRAGMA busy_timeout = 5000').catch(() => undefined);
      await migrate(db, { migrationsFolder });
    },
    async pendingMigrations() {
      const shipped = readMigrationFiles({ migrationsFolder });
      const table = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
      );
      if (table.rows.length === 0) return shipped.length;
      const last = await client.execute(
        'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
      );
      const row = last.rows[0];
      if (!row) return shipped.length;
      const lastMillis = Number(row[0]);
      return shipped.filter((m) => lastMillis < m.folderMillis).length;
    },
    close() {
      client.close();
    },
  };
}

/** Convenience for tests and tools: an in-memory database with migrations applied. */
export async function openMemoryDatabase(): Promise<DatabaseHandle> {
  const handle = openDatabase({ url: ':memory:' });
  await handle.migrate();
  return handle;
}
