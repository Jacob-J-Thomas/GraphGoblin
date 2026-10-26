import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type LoopDefinition,
  type LoopDefinitionInput,
  type RunEvent,
  type RunRecord,
  type RunSnapshot,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

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
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.app.close();
    await t.container.dispose();
    await rm(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  it('recovers a current-format pinned run across restart mid-run without migration', async () => {
    await t.app.close();
    await t.container.dispose();
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
      } finally { await app.close(); await first.dispose(); }
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
        const replay = await app.inject({ method: 'POST', url: '/runs/' + runId + '/replay', payload: { nodeId: 'infer', observedSeq: (await app.inject('/runs/' + runId)).json().recovery.observedSeq } });
        assert.equal(replay.statusCode, 202, replay.body);
        await second.manager.waitForIdle();
        assert.equal((await second.repos.runs.get(replay.json().run.id)).status, 'succeeded');
        assert.equal(harness.started.length, 2);
      } finally { await app.close(); await second.dispose(); }
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

const leaf = (result: string): LoopDefinitionInput => ({
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Native pinned child',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Continue?' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: JSON.stringify(result) } },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
    { id: 'b', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
  ],
});

describe('pinned child runs across a real API restart', () => {
  it('retains a child pin through a real API restart and Replay while new runs use the new publish', async () => {
    const fixture = await createApiProcessFixture({ prefix: 'gg-wp-d1-int-pinned-' });
    try {
      const token = await fixture.createKey();
      const origin = `http://127.0.0.1:${fixture.port}`;
      async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
        const response = await fetch(origin + path, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        expect(response.ok, `${method} ${path}: ${response.status}`).toBe(true);
        return (await response.json()) as T;
      }
      const run = (id: string) => call<RunSnapshot>('GET', `/runs/${id}`);
      async function publish(definition: LoopDefinitionInput) {
        const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
        const { version } = await call<{ version: { id: string } }>(
          'POST',
          `/loops/${loop.id}/publish`,
        );
        return { loopId: loop.id, versionId: version.id };
      }
      let server = fixture.run();
      await fixture.ready(server, token);
      const childLoop = await publish(leaf('old'));
      const parentLoop = await publish({
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: 'Native pinned parent',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'sub',
            kind: 'subloop',
            label: 'Sub',
            config: { loopRef: { loopId: childLoop.loopId } },
          },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: { returns: 'outputs.sub.value.result' },
          },
        ],
        edges: [
          { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
          { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
        ],
      });
      async function waitingChild(parentId: string): Promise<RunRecord> {
        let child: RunRecord | undefined;
        await eventually(async () => {
          const { items } = await call<{ items: RunRecord[] }>('GET', `/runs?parent=${parentId}`);
          [child] = items;
          return items.length === 1 && child?.status === 'waiting';
        });
        if (!child) throw new Error('No waiting child');
        return child;
      }
      async function finish(parentId: string, versionId: string, result: string) {
        const child = await waitingChild(parentId);
        expect(child.versionId).toBe(versionId);
        await call('POST', `/runs/${child.id}/input`, {
          waitId: child.waiting!.waitId,
          input: true,
        });
        await eventually(async () => (await run(parentId)).status === 'succeeded');
        expect(await run(parentId)).toMatchObject({ result });
        const { items } = await call<{ items: RunEvent[] }>(
          'GET',
          `/runs/${parentId}/events?limit=500`,
        );
        expect(items.filter((event) => event.type === 'child_run.started')).toHaveLength(1);
        expect(items.filter((event) => event.type === 'child_run.finished')).toHaveLength(1);
        return child;
      }
      const { run: original } = await call<{ run: RunRecord }>(
        'POST',
        `/loops/${parentLoop.loopId}/runs`,
        {},
      );
      const originalChild = await waitingChild(original.id);
      await call('PUT', `/loops/${childLoop.loopId}/draft`, { definition: leaf('new') });
      const { version: newer } = await call<{ version: { id: string } }>(
        'POST',
        `/loops/${childLoop.loopId}/publish`,
      );
      server.child.kill('SIGKILL');
      await server.waitForExit();
      server = fixture.run();
      await fixture.ready(server, token);
      expect((await finish(original.id, childLoop.versionId, 'old')).id).toBe(originalChild.id);
      const { run: next } = await call<{ run: RunRecord }>(
        'POST',
        `/loops/${parentLoop.loopId}/runs`,
        {},
      );
      await finish(next.id, newer.id, 'new');
      const { run: replay } = await call<{ run: RunRecord }>(
        'POST',
        `/runs/${original.id}/replay`,
        {
          nodeId: 'sub',
          observedSeq: (await run(original.id)).recovery.observedSeq,
        },
      );
      expect((await finish(replay.id, childLoop.versionId, 'old')).id).not.toBe(originalChild.id);
    } finally {
      await fixture.dispose();
      await expect(access(fixture.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }, 180_000);
});
