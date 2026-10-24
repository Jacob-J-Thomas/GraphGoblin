import process from 'node:process';
import { Buffer } from 'node:buffer';
import { log } from 'node:console';
// Run after pnpm build: node --test apps/api/scripts/recovery-process.integration.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { RunManager } from '@graphgoblin/engine';
import {
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
  singleNodeLoop,
} from '@graphgoblin/engine/testing';
import {
  openDatabase,
  SqliteApiKeys,
  SqliteEventStore,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteTriggerAdmission,
} from '@graphgoblin/infrastructure/sqlite';

const { fetch } = globalThis;
const root = fileURLToPath(new URL('../../../', import.meta.url));

async function freePort() {
  const start = Number(process.env.GG_TEST_PORT_START ?? 5600);
  const count = Number(process.env.GG_TEST_PORT_COUNT ?? 100);
  for (let port = start; port < start + count; port++) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve) => server.close(resolve));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No free disposable API port in the configured test range');
}

test(
  'built API recovers healthy work beside damaged event and run rows',
  { timeout: 180_000 },
  async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), process.env.GG_TEST_STORE_PREFIX ?? 'gg-recovery-process-'),
    );
    const url = `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}`;
    const handle = openDatabase({ url });
    await handle.migrate();
    const fake = createFakePorts();
    const events = new SqliteEventStore(handle.db, fake.clock);
    const runs = new SqliteRunRepository(handle.db);
    const loops = new SqliteLoopRepository(handle.db, fake.clock, fake.ids);
    const manager = new RunManager(
      { ...fake, events, runs, loops, admission: new SqliteTriggerAdmission(handle.db, events) },
      DEFAULT_TEST_SETTINGS,
    );
    manager.stop();
    const { loop } = await loops.create(
      'local',
      LoopDefinitionSchema.parse(
        singleNodeLoop('Recovery process control', {
          id: 'work',
          kind: 'wait',
          label: 'Work',
          config: { mode: 'input', prompt: 'healthy recovered prompt' },
        }),
      ),
    );
    await loops.publish(loop.id);
    const start = () =>
      manager.startRun({ ownerId: 'local', loopId: loop.id, source: 'manual.api' });
    const damagedEvent = await start();
    const damagedRow = await start();
    const healthy = await start();
    const original = await handle.client.execute({
      sql: 'SELECT payload FROM run_events WHERE run_id = ?',
      args: [damagedEvent.id],
    });
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ?',
      args: ['{broken', damagedEvent.id],
    });
    await handle.client.execute({
      sql: 'UPDATE runs SET waiting = ? WHERE id = ?',
      args: ['{broken', damagedRow.id],
    });
    const { token } = await new SqliteApiKeys(handle.db, fake.clock, fake.ids).create(
      'local',
      'Recovery integration',
      ['runs:read'],
    );
    handle.close();
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${token}` };
    let child;
    let output = '';
    let succeeded = false;
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
    }
    async function boot() {
      output = '';
      const env = {
        ...process.env,
        GG_DATA_DIR: dataDir,
        GG_DB_URL: url,
        GG_HOST: '127.0.0.1',
        GG_PORT: String(port),
        GG_REQUIRE_API_KEY: 'true',
        GG_DEFAULTS: JSON.stringify(DEFAULT_TEST_SETTINGS.defaults),
        GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
        GG_SWAGGER_UI: 'false',
        GG_LOG_LEVEL: 'info',
      };
      delete env.GG_DEFAULT_MODEL;
      delete env.GG_DEFAULT_EFFORT;
      child = spawn(process.execPath, ['apps/api/dist/main.js'], {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, output);
        const response = await fetch(`${origin}/healthz`).catch(() => undefined);
        if (response?.ok) return;
        await setTimeout(100);
      }
      throw new Error(`API did not become ready: ${output}`);
    }
    async function recoveredSnapshot(id) {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${origin}/runs/${id}`, { headers });
        assert.equal(response.status, 200);
        const snapshot = await response.json();
        if (snapshot.status === 'waiting') return snapshot;
        assert.ok(['queued', 'running'].includes(snapshot.status), JSON.stringify(snapshot));
        await setTimeout(50);
      }
      throw new Error(`run ${id} did not recover to waiting`);
    }
    try {
      await boot();
      const snapshotResponse = await fetch(`${origin}/runs/${healthy.id}`, { headers });
      assert.equal(snapshotResponse.status, 200);
      const snapshot = await recoveredSnapshot(healthy.id);
      assert.equal(snapshot.status, 'waiting');
      assert.equal(snapshot.waiting.prompt, 'healthy recovered prompt');
      const eventResponse = await fetch(`${origin}/runs/${healthy.id}/events`, { headers });
      assert.equal(eventResponse.status, 200);
      assert.ok((await eventResponse.json()).items.some((event) => event.type === 'run.waiting'));
      const diagnosticsResponse = await fetch(`${origin}/runs/diagnostics`, { headers });
      assert.equal(diagnosticsResponse.status, 200);
      const diagnostics = await diagnosticsResponse.json();
      assert.deepEqual(
        new Set(diagnostics.items.map((item) => item.runId)),
        new Set([damagedEvent.id, damagedRow.id]),
      );
      assert.ok(
        diagnostics.items.every(
          (item) => item.code === 'HISTORY_UNREADABLE' && item.reason.includes(item.runId),
        ),
      );
      assert.ok(
        output.includes('HISTORY_UNREADABLE') &&
          output.includes(damagedEvent.id) &&
          output.includes(damagedRow.id),
      );
      log(
        `healthy: waiting; run.waiting readable; damaged: ${diagnostics.items.length} HISTORY_UNREADABLE; port ${port}`,
      );
      await stop();
      // Explicit external/manual repair: restore only the known fixture columns. Recovery itself
      // must have left the original damage untouched, and never repairs it automatically.
      const repair = openDatabase({ url });
      try {
        const broken = await repair.client.execute({
          sql: 'SELECT payload FROM run_events WHERE run_id = ?',
          args: [damagedEvent.id],
        });
        assert.equal(broken.rows[0].payload, '{broken');
        const row = await repair.client.execute({
          sql: 'SELECT waiting FROM runs WHERE id = ?',
          args: [damagedRow.id],
        });
        assert.equal(row.rows[0].waiting, '{broken');
        await repair.client.execute({
          sql: 'UPDATE run_events SET payload = ? WHERE run_id = ?',
          args: [original.rows[0].payload, damagedEvent.id],
        });
        await repair.client.execute({
          sql: 'UPDATE runs SET waiting = NULL WHERE id = ?',
          args: [damagedRow.id],
        });
      } finally {
        repair.close();
      }
      await boot();
      const repaired = await fetch(`${origin}/runs/diagnostics`, { headers });
      assert.equal(repaired.status, 200);
      assert.deepEqual((await repaired.json()).items, []);
      for (const run of [damagedEvent, damagedRow]) {
        assert.equal((await recoveredSnapshot(run.id)).status, 'waiting');
      }
      log('manual column repair: both formerly damaged runs recover; diagnostics empty');
      succeeded = true;
    } finally {
      await stop();
      if (succeeded) {
        await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        log('disposable fixture removed');
      } else log(`failed disposable fixture retained: ${dataDir}`);
    }
  },
);
