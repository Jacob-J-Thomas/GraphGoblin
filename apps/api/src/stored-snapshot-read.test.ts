/**
 * Explicit version reads of stored current-format records (#525). A record the store guard accepts
 * can omit a field the current schema defaults, such as an inference node's `harness` in a draft-run
 * snapshot authored by hand. `GET /loops/{id}/versions/{versionId}` serves that record through
 * `LoopVersionRecordSchema`, so its response carries the schema's default whatever the record's
 * status, while the stored row, the snapshot's immutability, the loop's draft and every other row
 * stay exactly as they were. Every record here is a synthetic fixture in a disposable store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type LoopDefinition,
  type LoopDefinitionInput,
  type LoopVersionRecord,
} from '@graphgoblin/contracts';
import { guardCurrentStore } from '@graphgoblin/infrastructure/sqlite';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const PROMPT = 'Summarise the notes in “one” paragraph.\nKeep ünïcode and the trailing spaces.  ';
const OVERRIDES = { 'features.plugins': false, model_verbosity: 'low' };
const OUTPUT_SCHEMA = {
  type: 'object',
  required: ['summary'],
  properties: { summary: { type: 'string', maxLength: 400 } },
  additionalProperties: false,
};
const CREATED_AT = '2026-11-24T09:30:00.000Z';
const PUBLISHED_AT = '2026-11-24T09:45:00.000Z';

/** Authored without `harness`; an API write stores the schema's default for it. */
const authored = (name: string): LoopDefinitionInput => ({
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name,
  description: 'Synthetic and disposable.',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: {
        prompt: { template: PROMPT },
        timeoutSeconds: 120,
        harnessOptions: { sandbox: 'read-only', approval: 'never', configOverrides: OVERRIDES },
        output: { schema: { jsonSchema: OUTPUT_SCHEMA } },
      },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
    { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
  ],
});

/** The definition as JSON text, with `edit` applied to every inference node's stored config. */
function storedText(
  definition: LoopDefinition,
  edit: (config: Record<string, unknown>) => void,
): string {
  const raw = structuredClone(definition) as unknown as {
    nodes: { kind: string; config: Record<string, unknown> }[];
  };
  for (const node of raw.nodes) if (node.kind === 'inference') edit(node.config);
  return JSON.stringify(raw);
}

const omitHarness = (config: Record<string, unknown>) => {
  delete config['harness'];
};

const problemBody = (status: number, code: string, detail: string) => ({
  type: `https://graphgoblin.dev/problems/${code.toLowerCase().replaceAll('_', '-')}`,
  title: code.replaceAll('_', ' ').toLowerCase(),
  status,
  code,
  detail,
});

/** An API that requires keys, with a key for the local owner and one for another owner. */
async function start() {
  const app = (t = await createTestApp({ requireApiKey: true }));
  const keys = app.container.repos.apiKeys;
  const owner = (await keys.create('local', 'snapshot read owner', ['*'])).token;
  const foreign = (await keys.create('foreign-owner', 'snapshot read foreign', ['*'])).token;
  const request = (method: 'GET' | 'POST', url: string, token?: string, payload?: object) =>
    app.app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(payload ? { payload } : {}),
    });
  async function createLoop(name: string) {
    const created = await request('POST', '/loops', owner, { definition: authored(name) });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json<{ loop: { id: string }; draft: LoopVersionRecord }>();
    return { loopId: body.loop.id, draft: body.draft };
  }
  return { app, owner, foreign, request, createLoop };
}

async function rows(app: TestApp, sql: string, args: (string | number)[] = []) {
  const result = await app.container.handle.client.execute({ sql, args });
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column) => [column, row[column]])),
  );
}

/** Insert a version row as an operator would, with every storage trigger left active. */
async function insertVersion(
  app: TestApp,
  row: {
    loopId: string;
    version: number;
    status: 'snapshot' | 'published';
    definition: string;
    publishedAt?: string;
  },
): Promise<string> {
  const id = app.container.ports.ids.next();
  await app.container.handle.client.execute({
    sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [
      id,
      row.loopId,
      row.version,
      row.status,
      row.definition,
      CREATED_AT,
      row.publishedAt ?? null,
    ],
  });
  return id;
}

const storedRow = (app: TestApp, id: string) =>
  rows(app, 'SELECT * FROM loop_versions WHERE id = ?', [id]);

/** Loop, version, run, event and trigger rows, to show a read writes none of them. */
async function storeState(app: TestApp) {
  const state: Record<string, Record<string, unknown>[]> = {};
  for (const table of [
    'loops',
    'loop_versions',
    'runs',
    'run_events',
    'schedules',
    'webhook_endpoints',
    'inbound_events',
    'webhook_receipts',
    'event_receipts',
  ])
    state[table] = await rows(app, `SELECT * FROM ${table} ORDER BY rowid`);
  return state;
}

describe('GET /loops/{id}/versions/{versionId} of a stored current-format record (#525)', () => {
  it('serves a hand-authored snapshot that omits the default harness with that default, changing nothing', async () => {
    const { app, owner, request, createLoop } = await start();
    const { loopId, draft } = await createLoop('Hand-authored snapshot');
    const materialized = draft.definition;
    const work = materialized.nodes[1];
    // An API write stores the schema default; the hand-authored snapshot leaves it out.
    expect(work?.kind === 'inference' && work.config.harness).toBe('codex');
    const omittedText = storedText(materialized, omitHarness);
    expect(JSON.parse(omittedText).nodes[1].config).not.toHaveProperty('harness');
    const snapshotId = await insertVersion(app, {
      loopId,
      version: draft.version,
      status: 'snapshot',
      definition: omittedText,
    });
    // The equivalent snapshot as an API write would have stored it: the control.
    const controlId = await insertVersion(app, {
      loopId,
      version: draft.version,
      status: 'snapshot',
      definition: JSON.stringify(materialized),
    });
    expect(
      await rows(
        app,
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'loop_versions_snapshot_%' ORDER BY name",
      ),
    ).toEqual([
      { name: 'loop_versions_snapshot_immutable' },
      { name: 'loop_versions_snapshot_pinned' },
    ]);
    expect(await guardCurrentStore(app.container.handle.client)).toBe('current');
    const storedBefore = await storedRow(app, snapshotId);
    expect(storedBefore).toEqual([
      {
        id: snapshotId,
        loop_id: loopId,
        version: draft.version,
        status: 'snapshot',
        definition: omittedText,
        created_at: CREATED_AT,
        published_at: null,
      },
    ]);
    const stateBefore = await storeState(app);

    const read = await request('GET', `/loops/${loopId}/versions/${snapshotId}`, owner);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({
      id: snapshotId,
      loopId,
      version: draft.version,
      status: 'snapshot',
      definition: materialized,
      createdAt: CREATED_AT,
    });
    // The schema's default, beside the authored text, overrides and output schema as stored.
    expect(read.json<LoopVersionRecord>().definition.nodes[1]).toMatchObject({
      id: 'work',
      kind: 'inference',
      config: {
        harness: 'codex',
        prompt: { template: PROMPT },
        timeoutSeconds: 120,
        harnessOptions: { sandbox: 'read-only', approval: 'never', configOverrides: OVERRIDES },
        output: { schema: { jsonSchema: OUTPUT_SCHEMA } },
      },
    });

    const control = await request('GET', `/loops/${loopId}/versions/${controlId}`, owner);
    expect(control.statusCode, control.body).toBe(200);
    expect(control.json()).toEqual({
      id: controlId,
      loopId,
      version: draft.version,
      status: 'snapshot',
      definition: materialized,
      createdAt: CREATED_AT,
    });

    // Nothing was written: the raw row, the repository's record, and every other row.
    expect(await storedRow(app, snapshotId)).toEqual(storedBefore);
    expect((await app.container.repos.loops.getVersion(snapshotId))?.definition).toEqual(
      JSON.parse(omittedText),
    );
    expect(await storeState(app)).toEqual(stateBefore);
    expect(stateBefore['runs']).toEqual([]);
    expect(app.harness.started).toHaveLength(0);

    // The loop keeps its draft; snapshots stay out of the version history.
    const detail = await request('GET', `/loops/${loopId}`, owner);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({ loop: { id: loopId, draftVersionId: draft.id }, draft });
    expect(detail.json()).not.toHaveProperty('current');
    const history = await request('GET', `/loops/${loopId}/versions`, owner);
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json()).toEqual({ items: [draft] });

    // The snapshot stays immutable after it was read.
    await expect(
      app.container.handle.client.execute({
        sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
        args: [JSON.stringify(materialized), snapshotId],
      }),
    ).rejects.toThrow(/LOOP_VERSION_SNAPSHOT_IMMUTABLE/);
    expect(await storedRow(app, snapshotId)).toEqual(storedBefore);
  });

  it('serves a hand-authored published record the same way: the endpoint decides, not the status', async () => {
    const { app, owner, request, createLoop } = await start();
    const { loopId, draft } = await createLoop('Hand-authored published version');
    const omittedText = storedText(draft.definition, omitHarness);
    const publishedId = await insertVersion(app, {
      loopId,
      version: draft.version + 1,
      status: 'published',
      definition: omittedText,
      publishedAt: PUBLISHED_AT,
    });
    expect(await guardCurrentStore(app.container.handle.client)).toBe('current');
    const storedBefore = await storedRow(app, publishedId);
    expect(storedBefore[0]?.['definition']).toBe(omittedText);
    const stateBefore = await storeState(app);

    const read = await request('GET', `/loops/${loopId}/versions/${publishedId}`, owner);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({
      id: publishedId,
      loopId,
      version: draft.version + 1,
      status: 'published',
      definition: draft.definition,
      createdAt: CREATED_AT,
      publishedAt: PUBLISHED_AT,
    });
    expect(await storedRow(app, publishedId)).toEqual(storedBefore);
    expect(await storeState(app)).toEqual(stateBefore);
  });

  describe('a snapshot the current schema refuses', () => {
    async function invalidFixture() {
      const fixture = await start();
      const holder = await fixture.createLoop('Holds the invalid snapshot');
      const other = await fixture.createLoop('Another loop of the same owner');
      const invalidText = storedText(holder.draft.definition, (config) => {
        (config['harnessOptions'] as Record<string, unknown>)['configOverrides'] = {
          ...OVERRIDES,
          'recovery.bad key': true,
        };
      });
      expect(LoopDefinitionSchema.safeParse(JSON.parse(invalidText)).success).toBe(false);
      const invalidId = await insertVersion(fixture.app, {
        loopId: holder.loopId,
        version: holder.draft.version,
        status: 'snapshot',
        definition: invalidText,
      });
      // Genuinely invalid: the store guard would refuse this store at its next start.
      await expect(guardCurrentStore(fixture.app.container.handle.client)).rejects.toMatchObject({
        code: 'STORE_UNSUPPORTED',
      });
      return {
        ...fixture,
        loopId: holder.loopId,
        otherLoopId: other.loopId,
        invalidId,
        storedBefore: await storedRow(fixture.app, invalidId),
        stateBefore: await storeState(fixture.app),
      };
    }

    it('binds the version to its loop and owner before validating it', async () => {
      const f = await invalidFixture();
      const wrongLoop = await f.request(
        'GET',
        `/loops/${f.otherLoopId}/versions/${f.invalidId}`,
        f.owner,
      );
      expect(wrongLoop.statusCode, wrongLoop.body).toBe(404);
      expect(wrongLoop.json()).toEqual(
        problemBody(404, 'VERSION_NOT_FOUND', `version ${f.invalidId} not found`),
      );
      const unknownId = f.app.container.ports.ids.next();
      const unknown = await f.request('GET', `/loops/${f.loopId}/versions/${unknownId}`, f.owner);
      expect(unknown.statusCode, unknown.body).toBe(404);
      expect(unknown.json()).toEqual(
        problemBody(404, 'VERSION_NOT_FOUND', `version ${unknownId} not found`),
      );
      const foreign = await f.request(
        'GET',
        `/loops/${f.loopId}/versions/${f.invalidId}`,
        f.foreign,
      );
      expect(foreign.statusCode, foreign.body).toBe(404);
      expect(foreign.json()).toEqual(
        problemBody(404, 'LOOP_NOT_FOUND', `loop ${f.loopId} not found`),
      );
      const anonymous = await f.request('GET', `/loops/${f.loopId}/versions/${f.invalidId}`);
      expect(anonymous.statusCode, anonymous.body).toBe(401);
      expect(anonymous.json()).toEqual(problemBody(401, 'UNAUTHORIZED', 'an API key is required'));
      expect(await storedRow(f.app, f.invalidId)).toEqual(f.storedBefore);
      expect(await storeState(f.app)).toEqual(f.stateBefore);
    });

    it('answers its own loop with the sanitized 500 RESPONSE_INVALID, leaving the row as stored', async () => {
      const f = await invalidFixture();
      const read = await f.request('GET', `/loops/${f.loopId}/versions/${f.invalidId}`, f.owner);
      expect(read.statusCode, read.body).toBe(500);
      expect(read.json()).toEqual(
        problemBody(
          500,
          'RESPONSE_INVALID',
          'the server produced a response that does not match its schema',
        ),
      );
      // Nothing of the stored record or the validation failure reaches the client.
      for (const leaked of ['recovery.bad key', 'features.plugins', 'Summarise', f.invalidId])
        expect(read.body).not.toContain(leaked);
      expect(await storedRow(f.app, f.invalidId)).toEqual(f.storedBefore);
      expect(await storeState(f.app)).toEqual(f.stateBefore);
    });
  });
});
