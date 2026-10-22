import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LoopDefinitionSchema, type LoopDefinition } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
  await t.container.stop();
  await rm(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function inferenceLoop(): LoopDefinition {
  const input = minimalLoop();
  return LoopDefinitionSchema.parse({
    ...input,
    nodes: [
      input.nodes[0],
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { harness: 'codex', prompt: { template: 'Hello' } },
      },
      input.nodes[1],
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  });
}

describe('current-format runs through the API', () => {
  it('recovers a current-format pinned run across restart mid-run without migration', async () => {
    await t.app.close();
    await t.container.stop();
    // Run file-backed libsql in a child so Windows releases every native file handle before
    // the parent removes the directory. The child uses its own store and never binds a port.
    const script = `
      import assert from 'node:assert/strict';
      import { join } from 'node:path';
      import { createContainer } from ${JSON.stringify(new URL('./container.ts', import.meta.url).href)};
      import { buildApp } from ${JSON.stringify(new URL('./app.ts', import.meta.url).href)};
      import { loadConfig } from ${JSON.stringify(new URL('./config.ts', import.meta.url).href)};
      import { FakeHarness } from '@graphgoblin/engine/testing';
      const definition = ${JSON.stringify(inferenceLoop())};
      definition.nodes.splice(1, 0, { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue?' } });
      definition.edges[0].to.node = 'hold';
      definition.edges.push({ id: 'w2', from: { node: 'hold', port: 'out' }, to: { node: 'infer' } });
      const config = loadConfig({
        GG_DATA_DIR: process.env.GG_RECOVERY_TEST_DIR,
        GG_DB_URL: 'file:' + join(process.env.GG_RECOVERY_TEST_DIR, 'restart.db').replaceAll(String.fromCharCode(92), '/'),
        GG_SWAGGER_UI: 'false', GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
      });
      const harness = new FakeHarness();
      const overrides = { harnesses: { codex: harness }, startTimers: false };
      const loopId = '${fakeUlid('recovery-loop')}';
      const versionId = '${fakeUlid('recovery-version')}';
      const first = await createContainer(config, overrides);
      await first.start();
      let app = await buildApp(first, { logger: false });
      let runId;
      try {
        await first.handle.client.batch([
          { sql: 'INSERT INTO loops (id, owner_id, name, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', args: [loopId, 'local', 'legacy', versionId, '${FIXTURE_TS}', '${FIXTURE_TS}'] },
          { sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, 1, ?, ?, ?, ?)', args: [versionId, loopId, 'published', JSON.stringify(definition), '${FIXTURE_TS}', '${FIXTURE_TS}'] },
        ], 'write');
        const started = await app.inject({ method: 'POST', url: '/loops/' + loopId + '/runs', payload: {} });
        assert.equal(started.statusCode, 202, started.body);
        runId = started.json().run.id;
        await first.manager.waitForIdle();
        assert.equal((await first.repos.runs.get(runId)).status, 'waiting');
      } finally { await app.close(); await first.stop(); }
      const second = await createContainer(config, overrides);
      try {
        await second.start();
        app = await buildApp(second, { logger: false });
        const answered = await app.inject({ method: 'POST', url: '/runs/' + runId + '/input', payload: { waitId: (await second.repos.runs.get(runId)).waiting.waitId, input: true } });
        assert.equal(answered.statusCode, 200, answered.body);
        await second.manager.waitForIdle();
        const finished = await second.repos.runs.get(runId);
        assert.equal(finished.status, 'succeeded');
        assert.equal(finished.versionId, versionId);
        assert.equal(harness.started.length, 1);
        const version = await second.repos.loops.getVersion(versionId);
        assert.equal(version.id, versionId);
        assert.equal(version.version, 1);
        assert.equal(version.publishedAt, '${FIXTURE_TS}');
        assert.equal(Object.hasOwn(version.definition.settings.defaults, 'harness'), false);
        const replay = await app.inject({ method: 'POST', url: '/runs/' + runId + '/replay', payload: { nodeId: 'infer' } });
        assert.equal(replay.statusCode, 202, replay.body);
        await second.manager.waitForIdle();
        assert.equal((await second.repos.runs.get(replay.json().run.id)).status, 'succeeded');
        assert.equal(harness.started.length, 2);
      } finally { await app.close(); await second.stop(); }
      process.stdout.write('migration recovery succeeded');
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--conditions=development',
        '--input-type=module',
        '-e',
        script,
      ],
      {
        // Keep bare test dependencies in the API package's scope, including from a root runner.
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, GG_RECOVERY_TEST_DIR: t.dataDir },
        timeout: 60_000,
      },
    );
    expect(stdout).toBe('migration recovery succeeded');
  }, 80_000);
});
