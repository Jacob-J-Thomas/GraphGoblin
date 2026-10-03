import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Mutex, openDatabase, type DatabaseHandle } from './db.js';

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
