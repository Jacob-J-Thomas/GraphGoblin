import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createTestApp,
  shippedSqlMigrationsFrom,
  storeLoopBefore,
  type TestApp,
} from './testing/test-app.js';

const DEFAULTS_MIGRATION = '0019_completion_deadline_defaults';
let t: TestApp | undefined;
let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-stored-'));
});
afterEach(async () => {
  await t?.close();
  t = undefined;
  // Windows can hold the closed store briefly, as test-app.ts tolerates for its own directory.
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

it.each([
  ['draft', 'structuredTimeoutMs'],
  ['published', 'structuredTimeoutMs'],
  ['draft', 'runDeadlineSeconds'],
  ['published', 'runDeadlineSeconds'],
] as const)('reopens and exports a stored %s missing %s', async (status, field) => {
  // A genuine store from before 0019, with the shape saved before #243 too; the gateway's own
  // startup then applies 0019 and every later shipped migration.
  const { url, loopId, draftId } = await storeLoopBefore({
    dataDir,
    tag: DEFAULTS_MIGRATION,
    definition: minimalLoop(),
    publish: status === 'published',
    remove: [`$.settings.${field}`],
  });
  const old = openDatabase({ url });
  try {
    const stored = (
      await old.client.execute({
        sql: 'SELECT definition FROM loop_versions WHERE id = ?',
        args: [draftId],
      })
    ).rows[0]?.['definition'];
    if (typeof stored !== 'string') throw new Error('expected stored definition');
    expect(LoopDefinitionSchema.parse(JSON.parse(stored)).settings[field]).toBeNull();
    expect(await old.pendingMigrations()).toBe(await shippedSqlMigrationsFrom(DEFAULTS_MIGRATION));
  } finally {
    old.close();
  }
  const gateway = (t = await createTestApp({ env: { GG_DATA_DIR: dataDir, GG_DB_URL: url } }));
  expect(await gateway.container.handle.pendingMigrations()).toBe(0);
  const loop = { id: loopId };
  const draft = { id: draftId };
  const opened = await gateway.app.inject({ method: 'GET', url: `/loops/${loop.id}` });
  process.stdout.write(
    JSON.stringify({ status, removed: field, http: opened.statusCode, body: opened.json() }) + '\n',
  );
  expect(opened.statusCode, opened.body).toBe(200);
  expect(opened.json()).toMatchObject({
    [status === 'draft' ? 'draft' : 'current']: {
      definition: { settings: { structuredTimeoutMs: null, runDeadlineSeconds: null } },
    },
  });
  const version = await gateway.app.inject({
    method: 'GET',
    url: `/loops/${loop.id}/versions/${draft.id}`,
  });
  expect(version.statusCode, version.body).toBe(200);
  expect(version.json()).toMatchObject({
    definition: { settings: { structuredTimeoutMs: null, runDeadlineSeconds: null } },
  });
  const exported = await gateway.app.inject({
    method: 'GET',
    url: `/loops/${loop.id}/export${status === 'draft' ? '?draft=true' : ''}`,
  });
  expect(exported.statusCode, exported.body).toBe(200);
  expect(exported.json()).toMatchObject({
    loop: { settings: { structuredTimeoutMs: null, runDeadlineSeconds: null } },
  });
  const started = await gateway.app.inject({
    method: 'POST',
    url: `/loops/${loop.id}/runs`,
    payload: status === 'draft' ? { allowDraft: true, versionId: draft.id } : {},
  });
  expect(started.statusCode, started.body).toBe(202);
  expect(started.json()).toMatchObject({
    run: { pinned: { limits: { structuredTimeoutMs: null, runDeadlineSeconds: null } } },
  });
  await gateway.idle();
});
