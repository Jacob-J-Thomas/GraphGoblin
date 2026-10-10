import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LoopDefinitionSchema,
  type LoopDefinition,
  type LoopExport,
  type LoopVersionRecord,
  type RunRecord,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { inspectDatabaseUpgrade, applyDatabaseUpgrade } from '@graphgoblin/infrastructure/sqlite';
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

/** Seed genuine pre-upgrade stored JSON, then run the shipped migration on that database. */
async function seedVersion(status: 'draft' | 'published', definition = inferenceLoop()) {
  const loopId = fakeUlid(`legacy-${status}`);
  const versionId = fakeUlid(`legacy-version-${status}`);
  const raw = JSON.stringify({
    ...definition,
    schemaVersion: 1,
    settings: {
      ...definition.settings,
      defaults: { harness: 'codex' },
    },
  });
  await t.container.handle.client.batch(
    [
      {
        sql: 'INSERT INTO loops (id, owner_id, name, current_version_id, draft_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [
          loopId,
          'local',
          definition.name,
          status === 'published' ? versionId : null,
          status === 'draft' ? versionId : null,
          FIXTURE_TS,
          FIXTURE_TS,
        ],
      },
      {
        sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
        args: [
          versionId,
          loopId,
          status,
          raw,
          FIXTURE_TS,
          status === 'published' ? FIXTURE_TS : null,
        ],
      },
    ],
    'write',
  );
  // Reconstruct the historical schema before clearing its migration ledger. This database was
  // created with all current migrations by createTestApp, so remove later structural additions.
  await t.container.handle.client.execute('DROP TABLE classifier_models');
  await t.container.handle.client.execute('DROP TABLE webhook_receipts');
  await t.container.handle.client.execute('DROP INDEX runs_trigger_dedupe_idx');
  await t.container.handle.client.execute('DROP INDEX template_instances_owner_idx');
  await t.container.handle.client.execute('DROP INDEX template_issue_attempt_idx');
  await t.container.handle.client.execute('DROP INDEX template_qa_merge_idx');
  await t.container.handle.client.execute('DROP INDEX template_qa_issue_attempt_idx');
  await t.container.handle.client.execute('DROP INDEX template_pr_head_idx');
  await t.container.handle.client.execute('DROP INDEX template_active_pr_idx');
  await t.container.handle.client.execute('DROP INDEX template_child_visit_idx');
  await t.container.handle.client.execute('DROP TABLE template_instances');
  await t.container.handle.client.execute('ALTER TABLE runs DROP COLUMN template_subject');
  await t.container.handle.client.execute(
    'DELETE FROM __drizzle_migrations WHERE created_at > 1791136800000',
  );
  expect(await t.container.handle.pendingMigrations()).toBe(7);
  await expect(t.container.handle.migrate()).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
  const inventory = await inspectDatabaseUpgrade(t.container.handle.client);
  await applyDatabaseUpgrade(t.container.handle.client, {
    format: 'graphgoblin-upgrade-manifest',
    targetVersion: 3,
    sourceHash: inventory.sourceHash,
    approvedBy: 'test-owner',
    approvedAt: FIXTURE_TS,
    versions: Object.fromEntries(
      inventory.versions.map((version) => [
        version.id,
        { definitionHash: version.definitionHash, resolutions: {} },
      ]),
    ),
    failedRuns: {},
  });
  return { loopId, versionId, raw };
}

describe('migrated SQLite versions through the API', () => {
  it('reads, validates, publishes a migrated draft, exports, imports, saves and lists canonical versions', async () => {
    const { loopId, versionId, raw } = await seedVersion('draft');
    const detail = await t.app.inject(`/loops/${loopId}`);
    expect(detail.statusCode, detail.body).toBe(200);
    const draft = detail.json<{ draft: LoopVersionRecord }>().draft;
    expect(draft.definition.settings.defaults).not.toHaveProperty('harness');
    expect(draft.definition.nodes[1]).toMatchObject({ config: { harness: 'codex' } });
    const validated = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/validate`,
      payload: { definition: draft.definition },
    });
    expect(validated.statusCode, validated.body).toBe(200);
    const published = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/publish` });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json<{ version: LoopVersionRecord }>().version).toMatchObject({
      id: versionId,
      version: 1,
      definition: draft.definition,
    });
    const unchanged = await t.container.handle.client.execute({
      sql: 'SELECT definition FROM loop_versions WHERE id = ?',
      args: [versionId],
    });
    const stored = unchanged.rows[0]?.['definition'];
    if (typeof stored !== 'string') throw new Error('expected stored definition JSON');
    expect(JSON.parse(stored)).toEqual(draft.definition);
    expect(stored).not.toBe(raw);
    for (const path of [
      `/loops/${loopId}`,
      `/loops/${loopId}/versions`,
      `/loops/${loopId}/versions/${versionId}`,
    ]) {
      const response = await t.app.inject(path);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toContain('"defaults":{"harness"');
    }
    const exported = await t.app.inject(`/loops/${loopId}/export`);
    expect(exported.statusCode, exported.body).toBe(200);
    const envelope = exported.json<LoopExport>();
    expect(envelope.loop).toEqual(draft.definition);
    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: envelope,
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const saved = await t.app.inject({
      method: 'PUT',
      url: `/loops/${loopId}/draft`,
      payload: { definition: draft.definition },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<{ draft: LoopVersionRecord }>().draft.definition).toEqual(envelope.loop);
    const draftExport = await t.app.inject(`/loops/${loopId}/export?draft=true`);
    expect(draftExport.statusCode).toBe(200);
    expect(draftExport.json<LoopExport>().loop).toEqual(envelope.loop);
  });

  it('completes an old pinned run after a newer publication and replays the old version', async () => {
    const definition = inferenceLoop();
    // An input wait gives publication a deterministic point between old-run nodes.
    const input = {
      ...definition,
      nodes: [
        definition.nodes[0]!,
        {
          id: 'hold',
          kind: 'wait' as const,
          label: 'Hold',
          config: { mode: 'input' as const, prompt: 'Continue?' },
        },
        ...definition.nodes.slice(1),
      ],
      edges: [
        { id: 'w1', from: { node: 'start', port: 'out' }, to: { node: 'hold' } },
        { id: 'w2', from: { node: 'hold', port: 'out' }, to: { node: 'infer' } },
        definition.edges[1]!,
      ],
    };
    const { loopId, versionId } = await seedVersion('published', LoopDefinitionSchema.parse(input));
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: { versionId },
    });
    expect(started.statusCode, started.body).toBe(202);
    const run = started.json<{ run: RunRecord }>().run;
    await t.idle();
    expect((await t.container.repos.runs.get(run.id))?.status).toBe('waiting');
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${loopId}/draft`,
      payload: { definition: { ...minimalLoop(), name: 'new version' } },
    });
    const newer = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/publish` });
    expect(newer.statusCode, newer.body).toBe(200);
    await t.app.inject({ method: 'POST', url: `/runs/${run.id}/input`, payload: { input: true } });
    await t.idle();
    expect(await t.container.repos.runs.get(run.id)).toMatchObject({
      status: 'succeeded',
      versionId,
    });
    const replayed = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/replay`,
      payload: { nodeId: 'infer' },
    });
    expect(replayed.statusCode, replayed.body).toBe(202);
    await t.idle();
    const fork = replayed.json<{ run: RunRecord }>().run;
    expect(await t.container.repos.runs.get(fork.id)).toMatchObject({
      status: 'succeeded',
      versionId,
    });
    expect(t.harness.started).toHaveLength(2);
  });

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
        const answered = await app.inject({ method: 'POST', url: '/runs/' + runId + '/input', payload: { input: true } });
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
