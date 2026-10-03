import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client, Transaction } from '@libsql/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Mutex,
  YIELD_INTERVAL_MS,
  databaseFilePath,
  openDatabase,
  serializeClient,
  type DatabaseHandle,
} from './db.js';

const handles: DatabaseHandle[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const h of handles.splice(0)) h.close();
  // Windows may hold the database file briefly after close; retry, then give up on the temp dir.
  for (const d of dirs.splice(0)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(d, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
});

describe('Mutex', () => {
  it('runs tasks one at a time in order and tolerates double release', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const a = mutex.run(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('a:end');
    });
    const b = mutex.run(async () => {
      order.push('b:start');
      await Promise.resolve();
      order.push('b:end');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    const release = await mutex.acquire();
    release();
    release();
    await mutex.run(() => Promise.resolve());
  });

  it('releases the lock when the task throws', async () => {
    const mutex = new Mutex();
    await expect(mutex.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(mutex.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

describe('serialised client', () => {
  it('lets a transaction and other statements interleave safely on a file database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gg-db-'));
    dirs.push(dir);
    const handle = openDatabase({ url: `file:${join(dir, 'test.db').replace(/\\/g, '/')}` });
    handles.push(handle);
    await handle.migrate();
    await handle.migrate();
    await handle.client.execute(
      "insert into settings (owner_id, key, value, updated_at) values ('o', 'a', '1', 'now')",
    );
    const results = await Promise.all([
      handle.client.transaction('write').then(async (tx) => {
        await tx.execute(
          "insert into settings (owner_id, key, value, updated_at) values ('o', 'b', '2', 'now')",
        );
        await tx.commit();
        return 'tx';
      }),
      handle.client
        .execute('select count(*) as n from settings')
        .then((r) => Number(r.rows[0]?.['n'])),
      handle.client
        .batch(
          ["insert into settings (owner_id, key, value, updated_at) values ('o', 'c', '3', 'now')"],
          'write',
        )
        .then(() => 'batch'),
    ]);
    expect(results[0]).toBe('tx');
    expect(results[2]).toBe('batch');
    const total = await handle.client.execute('select count(*) as n from settings');
    expect(Number(total.rows[0]?.['n'])).toBe(3);
    expect(handle.client.closed).toBe(false);
  });

  it('releases the lock when a transaction rolls back or fails to open', async () => {
    const handle = openDatabase({ url: ':memory:' });
    handles.push(handle);
    await handle.migrate();
    const tx = await handle.client.transaction('write');
    await tx.execute(
      "insert into settings (owner_id, key, value, updated_at) values ('o', 'x', '1', 'now')",
    );
    await tx.rollback();
    const count = await handle.client.execute('select count(*) as n from settings');
    expect(Number(count.rows[0]?.['n'])).toBe(0);
    const tx2 = await handle.client.transaction('write');
    tx2.close();
    await expect(handle.client.executeMultiple('select 1; select 2;')).resolves.toBeUndefined();
    handle.close();
    await expect(handle.client.transaction('write')).rejects.toThrow();
    await expect(handle.client.execute('select 1')).rejects.toThrow();
  });
});

describe('event loop fairness', () => {
  it('yields to the event loop before a statement once the interval has passed', async () => {
    const handle = openDatabase({ url: ':memory:' });
    handles.push(handle);
    await new Promise((r) => setTimeout(r, YIELD_INTERVAL_MS + 5));
    let ticked = false;
    setImmediate(() => {
      ticked = true;
    });
    await handle.client.execute('select 1');
    expect(ticked).toBe(true);
    // Straight after a yield, statements run without one.
    ticked = false;
    setImmediate(() => {
      ticked = true;
    });
    await handle.client.execute('select 1');
    expect(ticked).toBe(false);
  });
});

describe('serialised client ordering with yields', () => {
  /** A fake client whose statements resolve without touching the event loop, like libsql's. */
  function recordingClient(order: string[]): Client {
    const tx = {
      execute: (sql: string) => {
        order.push(sql);
        return Promise.resolve({});
      },
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
      close: () => undefined,
    } as unknown as Transaction;
    return {
      execute: (sql: string) => {
        order.push(sql);
        return Promise.resolve({});
      },
      transaction: () => Promise.resolve(tx),
    } as unknown as Client;
  }

  it('never lets a statement submitted after a yield overtake one already queued', async () => {
    // The clock stands still after the first yield, so C, submitted once A is done, is not due
    // a yield while B, queued earlier, is still waiting for its own.
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const order: string[] = [];
    const client = serializeClient(recordingClient(order));
    now = YIELD_INTERVAL_MS * 10;
    const a = client.execute('A');
    const b = client.execute('B');
    await a;
    const c = client.execute('C');
    await Promise.all([b, c]);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('keeps submission order when every statement yields', async () => {
    const order: string[] = [];
    const client = serializeClient(recordingClient(order), { yieldIntervalMs: 0 });
    const a = client.execute('A');
    const b = client.execute('B');
    await a;
    const c = client.execute('C');
    await Promise.all([b, c]);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('keeps a transaction in its queue position when it yields', async () => {
    const order: string[] = [];
    const client = serializeClient(recordingClient(order), { yieldIntervalMs: 0 });
    const a = client.execute('A');
    const txPromise = client.transaction('write');
    await a;
    const c = client.execute('C');
    const tx = await txPromise;
    await tx.execute('T');
    await tx.commit();
    await c;
    expect(order).toEqual(['A', 'T', 'C']);
  });
});

describe('databaseFilePath', () => {
  it('resolves the file a libsql URL opens, like libsql does', () => {
    expect(databaseFilePath(':memory:')).toBeUndefined();
    expect(databaseFilePath('file::memory:')).toBeUndefined();
    expect(databaseFilePath('file:')).toBeUndefined();
    expect(databaseFilePath('libsql://db.example.io')).toBeUndefined();
    expect(databaseFilePath('file://remote-host/x.db')).toBeUndefined();
    expect(databaseFilePath('file:bad%E0%A4%A.db')).toBeUndefined();
    expect(databaseFilePath('not a url')).toBeUndefined();
    expect(databaseFilePath('file:data/gg.db')).toBe(resolve('data/gg.db'));
    expect(databaseFilePath('file:/srv/a%20b.db?tls=0', 'linux')).toBe(resolve('/srv/a b.db'));
    expect(databaseFilePath('file:///srv/x.db', 'linux')).toBe(resolve('/srv/x.db'));
    expect(databaseFilePath('file://localhost/srv/x.db', 'linux')).toBe(resolve('/srv/x.db'));
    expect(databaseFilePath('file://local%68ost/C:/x.db', 'win32')).toBe(resolve('C:/x.db'));
    expect(databaseFilePath('file://LOCAL%48OST/srv/x.db', 'linux')).toBe(resolve('/srv/x.db'));
    expect(databaseFilePath('file://remote%2Dhost/srv/x.db')).toBeUndefined();
    expect(databaseFilePath('file://local%E0%A4%A/srv/x.db')).toBeUndefined();
    expect(databaseFilePath('file:///C:/data/x%20y.db', 'win32')).toBe(resolve('C:/data/x y.db'));
    expect(databaseFilePath('file:C:/data/x.db', 'win32')).toBe(resolve('C:/data/x.db'));
  });

  it('names the file libsql actually creates for an encoded URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gg-db url '));
    dirs.push(dir);
    const url = pathToFileURL(join(dir, 'space db.sqlite')).href;
    expect(url).toContain('%20');
    const handle = openDatabase({ url });
    handles.push(handle);
    await handle.migrate();
    const path = databaseFilePath(url);
    expect(path).toBe(join(dir, 'space db.sqlite'));
    expect(existsSync(path!)).toBe(true);
  });
});

describe('pendingMigrations', () => {
  it('counts shipped migrations until they are applied, by the last recorded one', async () => {
    const handle = openDatabase({ url: ':memory:' });
    handles.push(handle);
    const shipped = await handle.pendingMigrations();
    expect(shipped).toBeGreaterThanOrEqual(2);
    await handle.client.execute(
      'create table __drizzle_migrations (id integer primary key, hash text not null, created_at numeric)',
    );
    expect(await handle.pendingMigrations()).toBe(shipped);
    await handle.client.execute(
      "insert into __drizzle_migrations (hash, created_at) values ('x', 1)",
    );
    expect(await handle.pendingMigrations()).toBe(shipped);
    await handle.migrate();
    expect(await handle.pendingMigrations()).toBe(0);
  });
});
