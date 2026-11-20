import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LoopDefinitionSchema,
  type LoopDefinitionInput,
  type LoopVersionRecord,
} from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { guardCurrentStore, openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { afterAll, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

function definition(): LoopDefinitionInput {
  const source = minimalLoop();
  return {
    ...source,
    name: 'Operator recovery fixture',
    variables: {
      receipt: { description: 'Retain this authored JSON', properties: { 'not plain': {} } },
    },
    nodes: [
      source.nodes[0]!,
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          prompt: { template: 'Inert recovery fixture.' },
          timeoutSeconds: 120,
          harnessOptions: {
            sandbox: 'read-only',
            approval: 'never',
            configOverrides: { 'features.plugins': false },
          },
        },
      },
      source.nodes[1]!,
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

const databaseUrl = (directory: string) =>
  'file:' + join(directory, 'graphgoblin.db').replaceAll('\\', '/');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const observations: Record<string, unknown>[] = [];
function record(observation: Record<string, unknown>) {
  observations.push(observation);
}
afterAll(async () => {
  const destination = process.env['GG_429_CORE_EVIDENCE_DIR'];
  if (destination)
    await writeFile(
      join(destination, 'recovery-observations.json'),
      JSON.stringify(observations, null, 2) + '\n',
    );
});

it('requires full explicit operator correction before authenticated GET, publish and restart (#429 F2)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gg-429-recovery-copy-'));
  const original = join(root, 'original');
  const copy = join(root, 'copy');
  await mkdir(original);
  await mkdir(copy);
  let current: TestApp | undefined;
  let origin = '';
  let token = '';
  async function start(directory: string) {
    current = await createTestApp({
      requireApiKey: true,
      env: { GG_DATA_DIR: directory, GG_DB_URL: databaseUrl(directory) },
    });
    await current.app.listen({ host: '127.0.0.1', port: 0 });
    const address = current.app.server.address();
    if (typeof address !== 'object' || address === null)
      throw new Error('Missing recovery listener');
    origin = `http://127.0.0.1:${address.port}`;
    return current;
  }
  async function stop() {
    const closing = current;
    current = undefined;
    await closing?.close();
    globalThis.gc?.();
  }
  async function call<T>(method: string, path: string, body?: unknown, authenticated = true) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  }
  async function readDefinition(client: ReturnType<typeof openDatabase>['client'], id: string) {
    const result = await client.execute({
      sql: 'SELECT definition FROM loop_versions WHERE id = ?',
      args: [id],
    });
    const value = result.rows[0]?.['definition'];
    if (typeof value !== 'string') throw new Error('Missing stored definition');
    return value;
  }
  try {
    const first = await start(original);
    token = (await first.container.repos.apiKeys.create('local', 'disposable recovery', ['*']))
      .token;
    expect((await call('GET', '/loops', undefined, false)).status).toBe(401);
    const created = await call<{ loop: { id: string }; draft: LoopVersionRecord }>(
      'POST',
      '/loops',
      { definition: definition() },
    );
    expect(created.status).toBe(201);
    const { loop, draft } = created.body;
    const sourceNode = draft.definition.nodes[1]!;
    expect(sourceNode.kind === 'inference' && sourceNode.config.harness).toBe('codex');
    const neighborInput = { ...minimalLoop(), name: 'Unrelated retained history' };
    const neighbor = await call<{ loop: { id: string } }>('POST', '/loops', {
      definition: neighborInput,
    });
    expect((await call('POST', `/loops/${neighbor.body.loop.id}/publish`)).status).toBe(200);
    const started = await call<{ run: { id: string } }>(
      'POST',
      `/loops/${neighbor.body.loop.id}/runs`,
      {},
    );
    expect(started.status).toBe(202);
    await first.idle();
    const runId = started.body.run.id;
    const historyBefore = JSON.stringify({
      run: await first.container.repos.runs.get(runId),
      events: await first.container.repos.events.read(runId),
      neighbor: await first.container.repos.loops.getLatestPublished(neighbor.body.loop.id),
    });
    const sourceDefinition = await readDefinition(first.container.handle.client, draft.id);
    await stop();
    const originalFile = join(original, 'graphgoblin.db');
    const originalHash = hash(await readFile(originalFile));
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        await copyFile(originalFile + suffix, join(copy, 'graphgoblin.db') + suffix);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    const operator = openDatabase({ url: databaseUrl(copy) });
    const harnessPath = '$.nodes[1].config.harness';
    const overridesPath = '$.nodes[1].config.harnessOptions.configOverrides';
    const changelog = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const discovery = changelog.match(/```sql\s+(SELECT v\.id[\s\S]*?)```/)?.[1];
    const removeMember = changelog.match(
      /```sql\s+(UPDATE loop_versions\s+SET definition = json_remove[\s\S]*?)```/,
    )?.[1];
    const materializeHarness = changelog.match(
      /```sql\s+(UPDATE loop_versions\s+SET definition = json_set[\s\S]*?)```/,
    )?.[1];
    const discoverOmissions = changelog.match(
      /```sql\s+(SELECT n\.key AS node_index[\s\S]*?)```/,
    )?.[1];
    if (!discovery || !removeMember) throw new Error('Missing operator recovery recipe');
    try {
      expect(await readDefinition(operator.client, draft.id)).toBe(sourceDefinition);
      await operator.client.execute({
        sql: 'UPDATE loop_versions SET definition = json_set(json_remove(definition, ?), ?, json(?)) WHERE id = ?',
        args: [
          harnessPath,
          overridesPath,
          JSON.stringify({ 'features.plugins': false, 'recovery.bad key': true }),
          draft.id,
        ],
      });
      await expect(guardCurrentStore(operator.client)).rejects.toMatchObject({
        code: 'STORE_UNSUPPORTED',
      });
      const found = await operator.client.execute(discovery);
      expect(found.rows).toHaveLength(1);
      const path = found.rows[0]?.['key_path'];
      if (typeof path !== 'string') throw new Error('Missing discovered member path');
      await operator.client.execute({ sql: removeMember, args: [path, draft.id] });
      expect((await operator.client.execute(discovery)).rows).toHaveLength(0);
      expect(await guardCurrentStore(operator.client)).toBe('current');
    } finally {
      operator.close();
      globalThis.gc?.();
    }
    const keyOnly = await start(copy);
    const keyOnlyBytes = await readDefinition(keyOnly.container.handle.client, draft.id);
    const expectedCorrection = JSON.parse(keyOnlyBytes) as typeof draft.definition;
    const correctedNode = expectedCorrection.nodes[1]!;
    if (correctedNode.kind !== 'inference') throw new Error('Missing expected correction node');
    correctedNode.config.harness = 'codex';
    const expectedCorrectionBytes = JSON.stringify(expectedCorrection);
    const partialGet = await call<{ code?: string }>('GET', `/loops/${loop.id}`);
    const partialPublish = await call<{ code?: string }>('POST', `/loops/${loop.id}/publish`);
    record({
      finding: 'F2',
      phase: 'key-only repair',
      get: partialGet.status,
      getCode: partialGet.body.code,
      publish: partialPublish.status,
      publishCode: partialPublish.body.code,
      startup: 'accepted',
    });
    expect(partialGet).toMatchObject({ status: 500, body: { code: 'RESPONSE_INVALID' } });
    expect(partialPublish).toMatchObject({ status: 500, body: { code: 'INTERNAL_ERROR' } });
    expect(await readDefinition(keyOnly.container.handle.client, draft.id)).toBe(keyOnlyBytes);
    expect(keyOnly.harness.started).toHaveLength(0);
    await stop();
    const correction = openDatabase({ url: databaseUrl(copy) });
    try {
      if (materializeHarness) {
        if (!discoverOmissions) throw new Error('Missing independent omission discovery');
        const missing = await correction.client.execute(discoverOmissions);
        expect(missing.rows).toHaveLength(1);
        expect(missing.rows[0]).toMatchObject({ id: draft.id, harness_path: harnessPath });
        await correction.client.execute({
          sql: materializeHarness,
          args: [harnessPath, draft.id, harnessPath],
        });
        expect((await correction.client.execute(discoverOmissions)).rows).toHaveLength(0);
        expect(await readDefinition(correction.client, draft.id)).toBe(expectedCorrectionBytes);
      }
    } finally {
      correction.close();
      globalThis.gc?.();
    }
    const corrected = await start(copy);
    const detail = await call<{ draft?: LoopVersionRecord }>('GET', `/loops/${loop.id}`);
    const published = await call<{ version?: LoopVersionRecord }>(
      'POST',
      `/loops/${loop.id}/publish`,
    );
    record({
      finding: 'F2',
      phase: 'complete documented recipe',
      materializationStepPresent: materializeHarness !== undefined,
      get: detail.status,
      publish: published.status,
    });
    expect({ get: detail.status, publish: published.status }).toEqual({ get: 200, publish: 200 });
    expect(detail.body.draft?.definition).toEqual(draft.definition);
    expect(published.body.version?.id).toBe(draft.id);
    expect(await readDefinition(corrected.container.handle.client, draft.id)).toBe(
      expectedCorrectionBytes,
    );
    expect(corrected.harness.started).toHaveLength(0);
    await stop();
    const restarted = await start(copy);
    expect((await call('GET', `/loops/${loop.id}`)).status).toBe(200);
    expect(
      JSON.stringify({
        run: await restarted.container.repos.runs.get(runId),
        events: await restarted.container.repos.events.read(runId),
        neighbor: await restarted.container.repos.loops.getLatestPublished(neighbor.body.loop.id),
      }),
    ).toBe(historyBefore);
    expect(hash(await readFile(originalFile))).toBe(originalHash);
    record({
      finding: 'F2',
      phase: 'restart after complete repair',
      get: 200,
      unrelatedHistoryUnchanged: true,
      originalBackupUnchanged: true,
    });
  } finally {
    await stop();
    globalThis.gc?.();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 80_000);

it('requires discovery and exact bytes after the product driver reports a quoted-member update (#429 F3)', async () => {
  const test = await createTestApp();
  try {
    const definitionValue = LoopDefinitionSchema.parse(definition());
    const node = definitionValue.nodes[1]!;
    if (node.kind !== 'inference') throw new Error('Missing recovery inference');
    node.config.harnessOptions.configOverrides = {
      'features.plugins': false,
      'recovery."quoted"': true,
    };
    const { draft } = await test.container.repos.loops.create('local', definitionValue);
    const client = test.container.handle.client;
    const read = async () => {
      const result = await client.execute({
        sql: 'SELECT definition FROM loop_versions WHERE id = ?',
        args: [draft.id],
      });
      return result.rows[0]?.['definition'];
    };
    const changelog = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const discovery = changelog.match(/```sql\s+(SELECT v\.id[\s\S]*?)```/)?.[1];
    const correction = changelog.match(
      /```sql\s+(UPDATE loop_versions\s+SET definition = json_remove[\s\S]*?)```/,
    )?.[1];
    if (!discovery || !correction) throw new Error('Missing recovery SQL');
    const rows = await client.execute(discovery);
    expect(rows.rows).toHaveLength(1);
    const path = rows.rows[0]?.['key_path'];
    if (typeof path !== 'string') throw new Error('Missing quoted-member path');
    const before = await read();
    const result = await client.execute({ sql: correction, args: [path, draft.id] });
    const after = await read();
    const remaining = await client.execute(discovery);
    const version = (await client.execute('SELECT sqlite_version() AS version')).rows[0]?.[
      'version'
    ];
    record({
      finding: 'F3',
      sqlite: version,
      rowsAffected: result.rowsAffected,
      bytesUnchanged: before === after,
      discoveredAfter: remaining.rows.length,
    });
    expect(result.rowsAffected).toBe(1);
    expect(after).toBe(before);
    expect(remaining.rows).toHaveLength(1);
    delete node.config.harnessOptions.configOverrides['recovery."quoted"'];
    const replacement = JSON.stringify(definitionValue);
    await client.execute({
      sql: "UPDATE loop_versions SET definition = ? WHERE id = ? AND status IN ('draft', 'published')",
      args: [replacement, draft.id],
    });
    expect(await read()).toBe(replacement);
    expect((await client.execute(discovery)).rows).toHaveLength(0);
    expect(LoopDefinitionSchema.safeParse(JSON.parse(replacement)).success).toBe(true);
  } finally {
    await test.close();
  }
});
