// File-backed, repeatable projection benchmark (#246). Build before running.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import console from 'node:console';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  openDatabase,
  SqliteRunRepository,
  SqliteDeliveryRunRepository,
} from '@graphgoblin/infrastructure/sqlite';
import { fakeUlid, samplePin, sampleThread, FIXTURE_TS } from '@graphgoblin/contracts/testing';

const worker = process.argv[2] === '--worker';
const dir = worker ? process.argv[3] : await mkdtemp(join(tmpdir(), 'gg-wp-d2-projection-'));
let handle;
try {
  if (!worker) {
    // The parent owns cleanup after all native SQLite mappings in the child have exited.
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', dir], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    console.log(result.stdout.trim());
  } else {
    handle = openDatabase({ url: 'file:' + join(dir, 'graphgoblin.db') });
    await handle.migrate();
    const base = new SqliteRunRepository(handle.db);
    const projected = new SqliteDeliveryRunRepository(handle.db);
    const ids = Array.from({ length: 20 }, (_, i) => fakeUlid('projection-' + i));
    for (const id of ids) {
      await base.create(
        {
          id,
          ownerId: 'local',
          loopId: fakeUlid('loop'),
          versionId: fakeUlid('version'),
          pinned: samplePin(),
          invocationId: fakeUlid('inv'),
          status: 'succeeded',
          iteration: 1,
          createdAt: FIXTURE_TS,
          lastEventSeq: 1000,
        },
        sampleThread(),
      );
      await handle.client.batch(
        Array.from({ length: 1000 }, (_, i) => ({
          sql: 'INSERT INTO run_events (run_id,seq,ts,type,payload) VALUES (?,?,?,?,?)',
          args: [id, i + 1, FIXTURE_TS, 'run.started', '{}'],
        })),
        'write',
      );
    }
    const results = {};
    for (const [label, repo] of [
      ['base', base],
      ['delivery', projected],
    ]) {
      for (const [operation, read] of [
        ['get', () => repo.get(ids[0])],
        ['page20', () => repo.page({ ownerId: 'local', limit: 20 })],
      ]) {
        for (let i = 0; i < 5; i++) await read();
        const samples = [];
        for (let i = 0; i < 30; i++) {
          const t = performance.now();
          await read();
          samples.push(performance.now() - t);
        }
        samples.sort((a, b) => a - b);
        results[label + '.' + operation] = { medianMs: samples[15], p95Ms: samples[28] };
      }
    }
    console.log(JSON.stringify({ runs: 20, events: 20000, warmups: 5, samples: 30, results }));
  }
} finally {
  handle?.close();
  if (!worker) {
    assert.equal(dirname(dir), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('gg-wp-d2-projection-'));
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
