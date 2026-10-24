import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-stored-'));
  t = await createTestApp({ env: { GG_DATA_DIR: dataDir } });
});
afterEach(async () => {
  await t.close();
  await rm(dataDir, { recursive: true, force: true });
});

it.each([
  ['draft', 'structuredTimeoutMs'],
  ['published', 'structuredTimeoutMs'],
  ['draft', 'runDeadlineSeconds'],
  ['published', 'runDeadlineSeconds'],
] as const)('reopens and exports a stored %s missing %s', async (status, field) => {
  const response = await t.app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: minimalLoop() },
  });
  const { loop, draft } = response.json<{ loop: { id: string }; draft: { id: string } }>();
  if (status === 'published')
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` })).statusCode,
    ).toBe(200);
  // Physical persisted current-format JSON, bypassing request parsing on purpose.
  // Repeat with the shape saved before #243 too, without changing any frozen input fixture.
  await t.container.handle.client.execute({
    sql: 'UPDATE loop_versions SET definition = json_remove(definition, ?) WHERE id = ?',
    args: [`$.settings.${field}`, draft.id],
  });
  const stored = (
    await t.container.handle.client.execute({
      sql: 'SELECT definition FROM loop_versions WHERE id = ?',
      args: [draft.id],
    })
  ).rows[0]?.['definition'];
  if (typeof stored !== 'string') throw new Error('expected stored definition');
  expect(LoopDefinitionSchema.parse(JSON.parse(stored)).settings[field]).toBeNull();
  await t.container.handle.client.execute(
    'DELETE FROM __drizzle_migrations WHERE created_at = 1792818000000',
  );
  await t.container.handle.migrate();
  const opened = await t.app.inject({ method: 'GET', url: `/loops/${loop.id}` });
  process.stdout.write(
    JSON.stringify({ status, removed: field, http: opened.statusCode, body: opened.json() }) + '\n',
  );
  expect(opened.statusCode, opened.body).toBe(200);
  expect(opened.json()).toMatchObject({
    [status === 'draft' ? 'draft' : 'current']: {
      definition: { settings: { structuredTimeoutMs: null, runDeadlineSeconds: null } },
    },
  });
  const version = await t.app.inject({
    method: 'GET',
    url: `/loops/${loop.id}/versions/${draft.id}`,
  });
  expect(version.statusCode, version.body).toBe(200);
  expect(version.json()).toMatchObject({
    definition: { settings: { structuredTimeoutMs: null, runDeadlineSeconds: null } },
  });
  const exported = await t.app.inject({
    method: 'GET',
    url: `/loops/${loop.id}/export${status === 'draft' ? '?draft=true' : ''}`,
  });
  expect(exported.statusCode, exported.body).toBe(200);
  expect(exported.json()).toMatchObject({
    loop: { settings: { structuredTimeoutMs: null, runDeadlineSeconds: null } },
  });
  const started = await t.app.inject({
    method: 'POST',
    url: `/loops/${loop.id}/runs`,
    payload: status === 'draft' ? { allowDraft: true, versionId: draft.id } : {},
  });
  expect(started.statusCode, started.body).toBe(202);
  expect(started.json()).toMatchObject({
    run: { pinned: { limits: { structuredTimeoutMs: null, runDeadlineSeconds: null } } },
  });
  await t.idle();
});
