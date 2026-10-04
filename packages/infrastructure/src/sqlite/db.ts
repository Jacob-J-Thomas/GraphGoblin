import { createClient, type Client, type Transaction } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { resolve } from 'node:path';
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
 * back) would starve sockets, timers, and SSE flushes until it ended. Once it holds the lock, the
 * client therefore yields with `setImmediate` when `YIELD_INTERVAL_MS` have passed since the last
 * yield (docs/10, "Performance baseline"). The lock is taken first, synchronously at submission, so
 * the yield can never let a later statement overtake one already queued.
 */
export function serializeClient(inner: Client, options: { yieldIntervalMs?: number } = {}): Client {
  const mutex = new Mutex();
  const interval = options.yieldIntervalMs ?? YIELD_INTERVAL_MS;
  let lastYield = performance.now();
  const breathe = async (): Promise<void> => {
    if (performance.now() - lastYield < interval) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    lastYield = performance.now();
  };
  const run = (fn: () => Promise<unknown>): Promise<unknown> =>
    mutex.run(async () => {
      await breathe();
      return fn();
    });
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
      const release = await mutex.acquire();
      try {
        await breathe();
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

// The URI grammar libsql uses (RFC 3986, but allowing relative `file:` paths).
const LIBSQL_URI =
  /^(?<scheme>[A-Za-z][A-Za-z.+-]*):(\/\/(?<authority>[^/?#]*))?(?<path>[^?#]*)(\?[^#]*)?(#.*)?$/su;

/**
 * The file a libsql URL opens, resolved against the working directory, or undefined for in-memory
 * and remote databases. Mirrors libsql: percent-decoded path, `file:relative`, `file:/abs`,
 * `file:///abs`, `file://localhost/abs`, and on Windows `file:///C:/...` (leading slash dropped).
 */
export function databaseFilePath(
  url: string,
  platform: string = process.platform,
): string | undefined {
  if (url === ':memory:') return undefined;
  const groups = LIBSQL_URI.exec(url)?.groups;
  if (!groups || groups['scheme']?.toLowerCase() !== 'file') return undefined;
  let authority: string;
  let path: string;
  try {
    // libsql percent-decodes the host before comparing it, so `local%68ost` is localhost.
    authority = decodeURIComponent(groups['authority'] ?? '');
    path = decodeURIComponent(groups['path'] ?? '');
  } catch {
    return undefined;
  }
  if (authority !== '' && authority.toLowerCase() !== 'localhost') return undefined;
  if (path === '' || path === ':memory:') return undefined;
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return resolve(path);
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
      // SQLite has no ADD COLUMN IF NOT EXISTS. Keep Drizzle's timestamp ledger and atomic
      // migration batch, but skip this additive statement if an installation already has it.
      const shipped = readMigrationFiles({ migrationsFolder });
      await client.execute(
        'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      );
      const last = await client.execute(
        'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
      );
      const columns = await client.execute('PRAGMA table_info(model_catalog)');
      const hasSource = columns.rows.some((row) => row['name'] === 'source');
      const statements = shipped
        .filter((m) => !last.rows[0] || Number(last.rows[0][0]) < m.folderMillis)
        .flatMap((migration) => [
          ...migration.sql.filter(
            (stmt) =>
              !(
                hasSource &&
                stmt.trim() ===
                  "ALTER TABLE model_catalog ADD COLUMN source TEXT NOT NULL DEFAULT 'harness';"
              ),
          ),
          {
            sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
            args: [migration.hash, migration.folderMillis],
          },
        ]);
      await client.migrate(statements);
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
