import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  RunEventSchema,
  RunPinSchema,
  RunRecordSchema,
  type LoopDefinition,
  type LoopVersionRecord,
  type RunPin,
  type RunRecord,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import {
  createInitialThread,
  parseRunAdmission,
  UnreadableRunHistoryError,
  type RunAdmission,
} from '@graphgoblin/engine';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import {
  applyShippedSqlToHistoricalTestFixture,
  openStoreBefore,
  shippedSqlMigrationsFrom,
} from './testing/shipped-migrations.js';

const DEFAULTS_MIGRATION = '0019_completion_deadline_defaults';
const NO_DEFAULTS = { owner: { byHarness: {} }, process: { byHarness: {} } };
const named = (name: string): LoopDefinition =>
  LoopDefinitionSchema.parse({ ...minimalLoop(), name });

/** A manual start pinned to `record`, carrying it as a draft snapshot when it is one. */
function admissionFor(record: LoopVersionRecord, seed: string): RunAdmission {
  const source = record.status === 'published' ? 'published' : 'draft';
  const pinned: RunPin = {
    source,
    version: record.version,
    name: record.definition.name,
    label: `${record.definition.name} ${source === 'draft' ? 'draft ' : ''}v${record.version}`,
    defaults: NO_DEFAULTS,
    classifiers: {},
    limits: { structuredTimeoutMs: null, maxNodeVisits: 10, runDeadlineSeconds: null },
  };
  const run: RunRecord = {
    id: fakeUlid(`run:${seed}`),
    ownerId: 'local',
    loopId: record.loopId,
    versionId: record.id,
    pinned,
    invocationId: fakeUlid(`invocation:${seed}`),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'manual.api',
      trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
    },
  });
  return {
    run,
    initialThread,
    pinnedLoopIds: [run.loopId],
    queued: { type: 'run.queued', versionId: run.versionId, pinned, initialThread },
    ...(record.status === 'snapshot' ? { snapshot: record } : {}),
  };
}

describe('draft snapshots', () => {
  let handle: DatabaseHandle;
  let loops: SqliteLoopRepository;
  let runs: SqliteRunRepository;
  let admission: SqliteTriggerAdmission;
  beforeEach(async () => {
    handle = await openMemoryDatabase();
    loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
    runs = new SqliteRunRepository(handle.db);
    admission = new SqliteTriggerAdmission(
      handle.db,
      new SqliteEventStore(handle.db, new FakeClock()),
    );
  });
  const dirs: string[] = [];
  afterEach(async () => {
    handle.close();
    for (const dir of dirs.splice(0))
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** A genuine store through 0018 for seeding; reopening its URL applies 0019 and later. */
  async function storeBeforeDefaults() {
    const dir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-defaults-'));
    dirs.push(dir);
    const url = 'file:' + join(dir, 'store.db').replaceAll('\\', '/');
    const old = await openStoreBefore(url, DEFAULTS_MIGRATION);
    return { url, old, loops: new SqliteLoopRepository(old.db, new FakeClock(), new FakeIds()) };
  }

  async function draftRun(seed: string) {
    const { loop, draft } = await loops.create('local', named('Snap'));
    const snapshot: LoopVersionRecord = {
      ...structuredClone(draft),
      id: fakeUlid(`snapshot:${seed}`),
      status: 'snapshot',
    };
    const run = await admission.create(admissionFor(snapshot, seed));
    return { loop, draft, snapshot, run };
  }

  it.each([null, 250])(
    'materializes omitted deadline fields in every stored copy, preserving authored %s',
    async (authored) => {
      const store = await storeBeforeDefaults();
      const old = store.old;
      const definition = named('Additive defaults');
      definition.settings.structuredTimeoutMs = authored;
      definition.settings.runDeadlineSeconds = authored === null ? null : 5;
      const { loop, draft } = await store.loops.create('local', definition);
      await store.loops.publish(loop.id);
      const snapshot: LoopVersionRecord = {
        ...draft,
        id: fakeUlid('default-snapshot'),
        status: 'snapshot',
      };
      const intent = admissionFor(snapshot, 'default-copies');
      intent.run.pinned.limits.structuredTimeoutMs = authored;
      intent.run.pinned.limits.runDeadlineSeconds = definition.settings.runDeadlineSeconds;
      // The pinned definition is inserted with pre-field bytes, before its immutability guard applies.
      const oldDefinition = JSON.stringify(definition);
      const remove =
        authored === null
          ? "json_remove(?, '$.settings.structuredTimeoutMs', '$.settings.runDeadlineSeconds')"
          : '?';
      await old.client.execute({
        sql: `INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at) VALUES (?, ?, 1, 'snapshot', ${remove}, ?)`,
        args: [snapshot.id, loop.id, oldDefinition, FIXTURE_TS],
      });
      if (authored === null)
        await old.client.execute({
          sql: "UPDATE loop_versions SET definition = json_remove(definition, '$.settings.structuredTimeoutMs', '$.settings.runDeadlineSeconds') WHERE id = ?",
          args: [draft.id],
        });
      await new SqliteRunRepository(old.db).create(intent.run, intent.initialThread);
      await new SqliteEventStore(old.db, new FakeClock()).append(intent.run.id, [intent.queued]);
      await old.client.execute({
        sql: "INSERT INTO webhook_receipts (id, owner_id, loop_id, trigger_node_id, content_hash, inbound_id, status, intent, attempts) VALUES (?, 'local', ?, 'start', ?, ?, 'pending', ?, 0)",
        args: [
          fakeUlid('default-receipt'),
          loop.id,
          'a'.repeat(64),
          fakeUlid('default-inbound'),
          JSON.stringify(intent),
        ],
      });
      if (authored === null) {
        await old.client.execute(
          "UPDATE runs SET pinned = json_remove(pinned, '$.limits.structuredTimeoutMs', '$.limits.runDeadlineSeconds')",
        );
        await old.client.execute(
          "UPDATE run_events SET payload = json_remove(payload, '$.pinned.limits.structuredTimeoutMs', '$.pinned.limits.runDeadlineSeconds')",
        );
        await old.client.execute(
          "UPDATE webhook_receipts SET intent = json_remove(intent, '$.run.pinned.limits.structuredTimeoutMs', '$.run.pinned.limits.runDeadlineSeconds', '$.queued.pinned.limits.structuredTimeoutMs', '$.queued.pinned.limits.runDeadlineSeconds', '$.snapshot.definition.settings.structuredTimeoutMs', '$.snapshot.definition.settings.runDeadlineSeconds')",
        );
      }
      const beforeTrigger = (
        await old.client.execute(
          "SELECT sql FROM sqlite_master WHERE name = 'loop_versions_snapshot_immutable'",
        )
      ).rows;
      old.close();
      // The store upgrades through the whole shipped suffix, as an installed gateway would.
      handle.close();
      handle = openDatabase({ url: store.url });
      expect(await handle.pendingMigrations()).toBe(
        await shippedSqlMigrationsFrom(DEFAULTS_MIGRATION),
      );
      await handle.migrate();
      expect(await handle.pendingMigrations()).toBe(0);
      const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
      const runs = new SqliteRunRepository(handle.db);
      const events = new SqliteEventStore(handle.db, new FakeClock());
      const admission = new SqliteTriggerAdmission(handle.db, events);
      const expected = {
        structuredTimeoutMs: authored,
        runDeadlineSeconds: authored === null ? null : 5,
      };
      for (const version of [
        await loops.getVersion(draft.id),
        await loops.getVersion(snapshot.id),
        await loops.getLatestPublished(loop.id),
        await loops.getPublished(loop.id, 1),
        ...(await loops.listVersions(loop.id)),
      ])
        expect(version?.definition.settings).toMatchObject(expected);
      expect((await runs.get(intent.run.id))?.pinned.limits).toMatchObject(expected);
      expect((await events.read(intent.run.id))[0]).toMatchObject({ pinned: { limits: expected } });
      const saved = (await admission.get(fakeUlid('default-receipt')))?.intent;
      expect(saved?.run.pinned.limits).toMatchObject(expected);
      expect(saved?.queued.pinned.limits).toMatchObject(expected);
      expect(saved?.snapshot?.definition.settings).toMatchObject(expected);
      if (!saved) throw new Error('expected saved admission');
      expect((await admission.create(saved)).id).toBe(intent.run.id);
      expect(
        (await events.read(intent.run.id)).filter((event) => event.type === 'run.queued'),
      ).toHaveLength(1);
      // Each persisted JSON spelling now contains the default; readers need no compatibility path.
      for (const [table, column, path] of [
        ['loop_versions', 'definition', '$.settings.structuredTimeoutMs'],
        ['runs', 'pinned', '$.limits.structuredTimeoutMs'],
        ['run_events', 'payload', '$.pinned.limits.structuredTimeoutMs'],
        ['webhook_receipts', 'intent', '$.snapshot.definition.settings.structuredTimeoutMs'],
      ] as const)
        expect(
          (
            await handle.client.execute(
              `SELECT json_type(${column}, '${path}') AS type FROM ${table}`,
            )
          ).rows.every((row) => row['type'] === (authored === null ? 'null' : 'integer')),
        ).toBe(true);
      expect(
        (
          await handle.client.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'loop_versions_snapshot_immutable'",
          )
        ).rows,
      ).toEqual(beforeTrigger);
      await expect(
        handle.client.execute({
          sql: "UPDATE loop_versions SET definition = '{}' WHERE id = ?",
          args: [snapshot.id],
        }),
      ).rejects.toThrow(/LOOP_VERSION_SNAPSHOT_IMMUTABLE/);
      await handle.migrate();
      expect((await loops.getVersion(snapshot.id))?.definition.settings).toMatchObject(expected);
    },
  );

  it('leaves malformed and invalid values untouched during the additive-default migration', async () => {
    for (const stored of [
      '{broken',
      JSON.stringify({
        ...named('Invalid'),
        settings: { ...named('Invalid').settings, structuredTimeoutMs: -1 },
      }),
    ]) {
      const { old, loops: historical } = await storeBeforeDefaults();
      try {
        const { draft } = await historical.create('local', named('Damaged defaults'));
        await old.client.execute({
          sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
          args: [stored, draft.id],
        });
        // Every shipped migration from 0019 on, as raw SQL: such rows would not pass the upgrade guard.
        await applyShippedSqlToHistoricalTestFixture(old);
        expect(
          (
            await old.client.execute(
              'SELECT COUNT(*) AS applied FROM __drizzle_migrations WHERE created_at = 1792818000000',
            )
          ).rows[0]?.['applied'],
        ).toBe(1);
        expect(
          (
            await old.client.execute({
              sql: 'SELECT definition FROM loop_versions WHERE id = ?',
              args: [draft.id],
            })
          ).rows[0]?.['definition'],
        ).toBe(stored);
      } finally {
        old.close();
      }
    }
  });

  it.each([null, 5])(
    'migrates authored deadline %s once and preserves damaged JSON',
    async (deadline) => {
      const definition = named('Custom limits');
      definition.settings.maxNodeVisits = 4;
      definition.settings.runDeadlineSeconds = deadline;
      const { draft } = await loops.create('local', definition);
      const snapshot: LoopVersionRecord = {
        ...draft,
        id: fakeUlid('limits-snapshot'),
        status: 'snapshot',
      };
      const intent = admissionFor(snapshot, 'limits');
      const created = await admission.create(intent);
      await handle.client.execute({
        sql: "UPDATE runs SET pinned = json_remove(pinned, '$.limits') WHERE id = ?",
        args: [created.id],
      });
      await handle.client.execute({
        sql: "UPDATE run_events SET payload = json_remove(payload, '$.pinned.limits') WHERE run_id = ?",
        args: [created.id],
      });
      await handle.client.execute({
        sql: "INSERT INTO webhook_receipts (id, owner_id, loop_id, trigger_node_id, content_hash, inbound_id, status, intent, attempts) VALUES (?, 'local', ?, 'start', ?, ?, 'pending', ?, 0)",
        args: [
          fakeUlid('limits-receipt'),
          draft.loopId,
          'a'.repeat(64),
          fakeUlid('limits-inbound'),
          JSON.stringify({
            ...intent,
            run: { ...intent.run, pinned: { ...intent.run.pinned, limits: undefined } },
            queued: { ...intent.queued, pinned: { ...intent.run.pinned, limits: undefined } },
          }),
        ],
      });
      const migration = await readFile(
        new URL('../../drizzle/0017_run_execution_limits.sql', import.meta.url),
        'utf8',
      );
      const apply = async () => {
        for (const statement of migration.split('--> statement-breakpoint'))
          await handle.client.execute(statement);
      };
      await apply();
      await apply();
      expect((await runs.get(created.id))?.pinned.limits).toEqual({
        structuredTimeoutMs: null,
        maxNodeVisits: 4,
        runDeadlineSeconds: deadline,
      });
      expect(
        (await new SqliteEventStore(handle.db, new FakeClock()).read(created.id))[0],
      ).toMatchObject({
        pinned: {
          limits: { maxNodeVisits: 4, runDeadlineSeconds: deadline },
        },
      });
      const saved = (await handle.client.execute('SELECT intent FROM webhook_receipts')).rows[0]?.[
        'intent'
      ];
      if (typeof saved !== 'string') throw new Error('Expected saved admission JSON');
      expect(parseRunAdmission(JSON.parse(saved)).run.pinned.limits).toEqual({
        structuredTimeoutMs: null,
        maxNodeVisits: 4,
        runDeadlineSeconds: deadline,
      });
      await handle.client.execute({
        sql: 'UPDATE runs SET pinned = ? WHERE id = ?',
        args: ['{broken', created.id],
      });
      await apply();
      expect(
        (
          await handle.client.execute({
            sql: 'SELECT pinned FROM runs WHERE id = ?',
            args: [created.id],
          })
        ).rows[0]?.['pinned'],
      ).toBe('{broken');
    },
  );

  it('are stored with their run, read by id, and kept out of the version history', async () => {
    const { loop, draft, snapshot, run } = await draftRun('history');
    expect(run).toMatchObject({ versionId: snapshot.id, pinned: { label: 'Snap draft v1' } });
    expect(await loops.getVersion(snapshot.id)).toEqual(snapshot);
    expect((await loops.listVersions(loop.id)).map((version) => version.id)).toEqual([draft.id]);
    // Editing and publishing the draft never touch the snapshot, which is never "latest".
    await loops.saveDraft(loop.id, named('Edited'));
    const published = await loops.publish(loop.id);
    expect(published?.id).toBe(draft.id);
    expect((await loops.getLatestPublished(loop.id))?.id).toBe(draft.id);
    expect(await loops.getPublished(loop.id, 1)).toMatchObject({ id: draft.id });
    expect(await loops.getVersion(snapshot.id)).toEqual(snapshot);
  });

  it('refuse any change, and deletion while a run pins them', async () => {
    const { snapshot } = await draftRun('guard');
    await expect(
      handle.client.execute({
        sql: "UPDATE loop_versions SET definition = json_set(definition, '$.name', 'Changed') WHERE id = ?",
        args: [snapshot.id],
      }),
    ).rejects.toThrow(/LOOP_VERSION_SNAPSHOT_IMMUTABLE/);
    await expect(
      handle.client.execute({
        sql: "UPDATE loop_versions SET status = 'published' WHERE id = ?",
        args: [snapshot.id],
      }),
    ).rejects.toThrow(/LOOP_VERSION_SNAPSHOT_IMMUTABLE/);
    await expect(
      handle.client.execute({ sql: 'DELETE FROM loop_versions WHERE id = ?', args: [snapshot.id] }),
    ).rejects.toThrow(/LOOP_VERSION_SNAPSHOT_PINNED/);
    expect(await loops.getVersion(snapshot.id)).toEqual(snapshot);
  });

  it('go with the last run that pins them', async () => {
    const kept = await draftRun('kept');
    // A replay fork shares its source's snapshot.
    const fork = admissionFor(kept.snapshot, 'fork');
    delete fork.snapshot;
    await admission.create(fork);
    const orphaned = await draftRun('orphaned');
    // Legacy damage: the loop row is gone, so its run is an orphan.
    await handle.client.execute({
      sql: 'DELETE FROM loops WHERE id = ?',
      args: [orphaned.loop.id],
    });
    expect(await runs.deleteOrphans()).toBe(1);
    expect(await loops.getVersion(orphaned.snapshot.id)).toBeUndefined();
    expect(await loops.getVersion(kept.snapshot.id)).toEqual(kept.snapshot);

    await runs.update(kept.run.id, { status: 'succeeded' });
    await runs.update(fork.run.id, { status: 'succeeded' });
    expect(await loops.delete(kept.loop.id)).toBe(true);
    expect(await loops.getVersion(kept.snapshot.id)).toBeUndefined();
    expect(await runs.get(fork.run.id)).toBeUndefined();
  });

  it.each([
    ['missing', null, /has no definition pin/],
    ['malformed', '{"source": not json', /malformed JSON in pinned/],
    ['schema-invalid', '{"source":"published"}', /does not conform to the run record contract/],
  ] as const)(
    'reports a %s pin as unreadable history for that run only',
    async (_kind, pinned, reason) => {
      const { run } = await draftRun('corrupt');
      const healthy = await draftRun('healthy');
      await handle.client.execute({
        sql: 'UPDATE runs SET pinned = ? WHERE id = ?',
        args: [pinned, run.id],
      });
      const error = await runs.get(run.id).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UnreadableRunHistoryError);
      expect(error).toMatchObject({
        code: 'HISTORY_UNREADABLE',
        runId: run.id,
        message: expect.stringMatching(reason),
      });
      expect((await runs.get(healthy.run.id))?.pinned).toEqual(healthy.run.pinned);
    },
  );
});

describe('migration 0014 pins existing runs', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0))
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** A store migrated through 0013, the last migration before definition pins. */
  async function storeBeforePins(): Promise<DatabaseHandle> {
    const dir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-pin-migration-'));
    dirs.push(dir);
    const source = fileURLToPath(new URL('../../drizzle/', import.meta.url));
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    const before = journal.entries.findIndex((entry) => entry.tag === '0014_run_definition_pins');
    await mkdir(join(dir, 'meta'));
    for (const entry of journal.entries.slice(0, before))
      await copyFile(join(source, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    await writeFile(
      join(dir, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, before) }),
    );
    const handle = openDatabase({ url: ':memory:', migrationsFolder: dir });
    await handle.migrate();
    return handle;
  }

  async function insert(handle: DatabaseHandle, sql: string, args: (string | number | null)[]) {
    await handle.client.execute({ sql, args });
  }

  it('freezes draft-run definitions, pins every run, event and saved intent', async () => {
    const handle = await storeBeforePins();
    try {
      const loopId = fakeUlid('m:loop');
      const published = fakeUlid('m:v1');
      const draft = fakeUlid('m:v2');
      await insert(
        handle,
        'INSERT INTO loops (id, owner_id, name, current_version_id, draft_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [loopId, 'local', 'Draft name', published, draft, FIXTURE_TS, FIXTURE_TS],
      );
      for (const [id, version, status, name] of [
        [published, 1, 'published', 'Release'],
        [draft, 2, 'draft', 'Draft name'],
      ] as const)
        await insert(
          handle,
          'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            loopId,
            version,
            status,
            JSON.stringify({ ...named(name), settings: { maxNodeVisits: 10 } }),
            FIXTURE_TS,
            status === 'published' ? FIXTURE_TS : null,
          ],
        );
      const owner = { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } };
      await insert(
        handle,
        'INSERT INTO settings (owner_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        ['local', 'defaults', JSON.stringify(owner), FIXTURE_TS],
      );
      const runIds = { published: fakeUlid('m:run-published'), draft: fakeUlid('m:run-draft') };
      for (const [kind, versionId] of [
        ['published', published],
        ['draft', draft],
      ] as const) {
        const thread = sampleThread({
          run: { id: runIds[kind], loopId, versionId, iteration: 1 },
        });
        await insert(
          handle,
          'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, last_event_seq, initial_thread, thread_snapshot) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)',
          [
            runIds[kind],
            'local',
            loopId,
            versionId,
            thread.invocation.id,
            'waiting',
            FIXTURE_TS,
            JSON.stringify(thread),
            JSON.stringify(thread),
          ],
        );
        await insert(
          handle,
          'INSERT INTO run_events (run_id, seq, ts, type, node_id, payload) VALUES (?, 1, ?, ?, NULL, ?)',
          [runIds[kind], FIXTURE_TS, 'run.queued', JSON.stringify({ initialThread: thread })],
        );
      }
      // A saved webhook admission for a run that does not exist yet.
      const pendingRun = fakeUlid('m:run-pending');
      const pendingThread = createInitialThread({
        runId: pendingRun,
        loopId,
        versionId: published,
        invocation: {
          id: fakeUlid('m:pending-invocation'),
          source: 'webhook',
          trigger: { nodeId: 'start', kind: 'webhook', payload: {}, receivedAt: FIXTURE_TS },
        },
      });
      const intent = {
        run: {
          id: pendingRun,
          ownerId: 'local',
          loopId,
          versionId: published,
          invocationId: pendingThread.invocation.id,
          status: 'queued',
          iteration: 1,
          createdAt: FIXTURE_TS,
          lastEventSeq: 0,
        },
        initialThread: pendingThread,
        queued: { type: 'run.queued', initialThread: pendingThread },
        pinnedLoopIds: [loopId],
      };
      await insert(
        handle,
        'INSERT INTO webhook_receipts (id, owner_id, loop_id, trigger_node_id, content_hash, inbound_id, status, intent, attempts, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
        [
          fakeUlid('m:receipt'),
          'local',
          loopId,
          'start',
          'a'.repeat(64),
          fakeUlid('m:inbound'),
          'pending',
          JSON.stringify(intent),
          FIXTURE_TS,
        ],
      );

      await applyShippedSqlToHistoricalTestFixture(handle);

      const repo = new SqliteRunRepository(handle.db);
      const releaseRun = RunRecordSchema.parse(await repo.get(runIds.published));
      expect(releaseRun).toMatchObject({
        versionId: published,
        pinned: {
          source: 'published',
          version: 1,
          name: 'Release',
          label: 'Release v1',
          defaults: { owner, process: { byHarness: {} } },
          classifiers: {},
          limits: { structuredTimeoutMs: null, maxNodeVisits: 10, runDeadlineSeconds: null },
        },
      });
      // The draft run now pins a frozen copy named by its own id, everywhere it is recorded.
      const draftRun = RunRecordSchema.parse(await repo.get(runIds.draft));
      expect(draftRun).toMatchObject({
        versionId: runIds.draft,
        pinned: { source: 'draft', version: 2, label: 'Draft name draft v2' },
      });
      const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
      expect(await loops.getVersion(runIds.draft)).toMatchObject({
        loopId,
        version: 2,
        status: 'snapshot',
        definition: { ...named('Draft name'), settings: { maxNodeVisits: 10 } },
        createdAt: FIXTURE_TS,
      });
      expect(
        LoopDefinitionSchema.parse((await loops.getVersion(runIds.draft))?.definition).settings
          .runDeadlineSeconds,
      ).toBeNull();
      expect((await loops.listVersions(loopId)).map((version) => version.id).sort()).toEqual(
        [published, draft].sort(),
      );
      expect((await repo.getInitialThread(runIds.draft))?.run.versionId).toBe(runIds.draft);
      expect((await repo.getThread(runIds.draft))?.run.versionId).toBe(runIds.draft);
      const events = new SqliteEventStore(handle.db, new FakeClock());
      for (const run of [releaseRun, draftRun]) {
        const [queued] = await events.read(run.id);
        expect(RunEventSchema.parse(queued)).toMatchObject({
          type: 'run.queued',
          versionId: run.versionId,
          pinned: run.pinned,
          initialThread: { run: { versionId: run.versionId } },
        });
      }
      const admission = new SqliteTriggerAdmission(handle.db, events);
      const receipt = await admission.get(fakeUlid('m:receipt'));
      expect(receipt?.intent?.run.pinned).toEqual(RunPinSchema.parse(releaseRun.pinned));
      expect(parseRunAdmission(receipt?.intent).queued).toMatchObject({
        versionId: published,
        pinned: releaseRun.pinned,
      });
      // The frozen copy is guarded like any snapshot.
      await expect(
        handle.client.execute({
          sql: "UPDATE loop_versions SET definition = '{}' WHERE id = ?",
          args: [runIds.draft],
        }),
      ).rejects.toThrow(/LOOP_VERSION_SNAPSHOT_IMMUTABLE/);
    } finally {
      handle.close();
    }
  });

  /** A loop whose decisions use the classifiers `custom`, `keyed` and `gone` (never catalogued). */
  function classifierLoop(name: string): LoopDefinition {
    const decision = (id: string, model: string) => ({
      id,
      kind: 'decision',
      label: id,
      config: {
        kind: 'classifier',
        model,
        question: 'Which?',
        answer: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'Yes', criteria: 'Yes' },
            { id: 'no', label: 'No', criteria: 'No' },
          ],
        },
      },
    });
    const chain = [
      ['first', 'custom', 'second'],
      ['second', 'keyed', 'third'],
      ['third', 'gone', 'done'],
    ] as const;
    return LoopDefinitionSchema.parse({
      ...minimalLoop(),
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        ...chain.map(([id, model]) => decision(id, model)),
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'e0', from: { node: 'start', port: 'out' }, to: { node: 'first' } },
        ...chain.flatMap(([id, , next]) =>
          ['yes', 'no'].map((port) => ({
            id: `${id}-${port}`,
            from: { node: id, port },
            to: { node: next },
          })),
        ),
      ],
    });
  }

  it('pins healthy history and leaves damaged JSON untouched for unreadable-history reports', async () => {
    const handle = await storeBeforePins();
    try {
      const loopId = fakeUlid('d:loop');
      const published = fakeUlid('d:v1');
      const draft = fakeUlid('d:v2');
      await insert(
        handle,
        'INSERT INTO loops (id, owner_id, name, current_version_id, draft_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [loopId, 'local', 'Mixed', published, draft, FIXTURE_TS, FIXTURE_TS],
      );
      for (const [id, version, status] of [
        [published, 1, 'published'],
        [draft, 2, 'draft'],
      ] as const)
        await insert(
          handle,
          'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            loopId,
            version,
            status,
            JSON.stringify(classifierLoop('Mixed')),
            FIXTURE_TS,
            status === 'published' ? FIXTURE_TS : null,
          ],
        );
      for (const [id, model, endpoint, secretRef] of [
        ['custom', 'model-original', 'http://127.0.0.1:9', null],
        ['keyed', 'model-keyed', 'https://classifier.test', 'classifier-key'],
        ['unused', 'model-unused', 'https://classifier.test', null],
      ] as const)
        await insert(
          handle,
          'INSERT INTO classifier_models (owner_id, id, display_name, source, provider, provider_model, primitives, endpoint, secret_ref, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
          ['local', id, id, 'custom', 'http', model, '["choice"]', endpoint, secretRef],
        );
      const ids = {
        healthy: fakeUlid('d:healthy'),
        healthyDraft: fakeUlid('d:healthy-draft'),
        damagedDraft: fakeUlid('d:damaged-draft'),
        damagedEvent: fakeUlid('d:damaged-event'),
      };
      const damaged = '{"run": not json';
      for (const [key, versionId, snapshot, payload] of [
        ['healthy', published, 'valid', 'valid'],
        ['healthyDraft', draft, 'valid', 'valid'],
        ['damagedDraft', draft, damaged, damaged],
        ['damagedEvent', published, 'valid', damaged],
      ] as const) {
        const runId = ids[key];
        const thread = JSON.stringify(
          sampleThread({ run: { id: runId, loopId, versionId, iteration: 1 } }),
        );
        await insert(
          handle,
          'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, last_event_seq, initial_thread, thread_snapshot) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)',
          [
            runId,
            'local',
            loopId,
            versionId,
            fakeUlid(`d:invocation:${key}`),
            'succeeded',
            FIXTURE_TS,
            thread,
            snapshot === 'valid' ? thread : snapshot,
          ],
        );
        await insert(
          handle,
          'INSERT INTO run_events (run_id, seq, ts, type, node_id, payload) VALUES (?, 1, ?, ?, NULL, ?)',
          [
            runId,
            FIXTURE_TS,
            'run.queued',
            payload === 'valid' ? JSON.stringify({ initialThread: JSON.parse(thread) }) : payload,
          ],
        );
      }
      const receipt = (seed: string, intent: string) =>
        insert(
          handle,
          'INSERT INTO webhook_receipts (id, owner_id, loop_id, trigger_node_id, content_hash, inbound_id, status, intent, attempts, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
          [
            fakeUlid(`d:receipt:${seed}`),
            'local',
            loopId,
            'start',
            seed.padEnd(64, '0'),
            fakeUlid(`d:inbound:${seed}`),
            'pending',
            intent,
            FIXTURE_TS,
          ],
        );
      const pendingRun = fakeUlid('d:pending-run');
      const pendingThread = createInitialThread({
        runId: pendingRun,
        loopId,
        versionId: published,
        invocation: {
          id: fakeUlid('d:pending-invocation'),
          source: 'webhook',
          trigger: { nodeId: 'start', kind: 'webhook', payload: {}, receivedAt: FIXTURE_TS },
        },
      });
      await receipt(
        'a',
        JSON.stringify({
          run: {
            id: pendingRun,
            ownerId: 'local',
            loopId,
            versionId: published,
            invocationId: pendingThread.invocation.id,
            status: 'queued',
            iteration: 1,
            createdAt: FIXTURE_TS,
            lastEventSeq: 0,
          },
          initialThread: pendingThread,
          queued: { type: 'run.queued', initialThread: pendingThread },
          pinnedLoopIds: [loopId],
        }),
      );
      await receipt('b', damaged);
      const raw = async (sql: string, args: string[]) =>
        (await handle.client.execute({ sql, args })).rows[0];
      const payloads = () =>
        Promise.all(
          [ids.damagedDraft, ids.damagedEvent].map((id) =>
            raw('SELECT payload FROM run_events WHERE run_id = ?', [id]),
          ),
        );
      const before = {
        thread: await raw('SELECT thread_snapshot FROM runs WHERE id = ?', [ids.damagedDraft]),
        events: await payloads(),
        intent: await raw('SELECT intent FROM webhook_receipts WHERE id = ?', [
          fakeUlid('d:receipt:b'),
        ]),
      };

      // One malformed value used to abort the whole migration; now it completes.
      await applyShippedSqlToHistoricalTestFixture(handle);

      const bindings = {
        custom: {
          provider: 'http',
          providerModel: 'model-original',
          primitives: ['choice'],
          endpoint: 'http://127.0.0.1:9',
        },
        keyed: {
          provider: 'http',
          providerModel: 'model-keyed',
          primitives: ['choice'],
          endpoint: 'https://classifier.test',
          secretRef: 'classifier-key',
        },
      };
      const repo = new SqliteRunRepository(handle.db);
      const events = new SqliteEventStore(handle.db, new FakeClock());
      for (const id of [ids.healthy, ids.healthyDraft]) {
        const run = RunRecordSchema.parse(await repo.get(id));
        expect(run.pinned.classifiers).toEqual(bindings);
        expect(RunEventSchema.parse((await events.read(id))[0])).toMatchObject({
          versionId: run.versionId,
          pinned: run.pinned,
        });
      }
      // Damaged rows keep every malformed byte; their run rows are still pinned.
      expect(
        await raw('SELECT thread_snapshot FROM runs WHERE id = ?', [ids.damagedDraft]),
      ).toEqual(before.thread);
      expect(await payloads()).toEqual(before.events);
      for (const id of [ids.damagedDraft, ids.damagedEvent]) {
        const row = await raw('SELECT version_id, pinned FROM runs WHERE id = ?', [id]);
        const pinned = row?.['pinned'];
        if (typeof pinned !== 'string') throw new Error('the migration pins every run row');
        expect(RunPinSchema.parse(JSON.parse(pinned))).toMatchObject({
          classifiers: bindings,
        });
        if (id === ids.damagedDraft) expect(row?.['version_id']).toBe(id);
      }
      expect(
        await raw('SELECT intent FROM webhook_receipts WHERE id = ?', [fakeUlid('d:receipt:b')]),
      ).toEqual(before.intent);
      const admission = new SqliteTriggerAdmission(handle.db, events);
      const saved = await admission.get(fakeUlid('d:receipt:a'));
      expect(saved?.intent?.run.pinned).toMatchObject({ label: 'Mixed v1', classifiers: bindings });
      expect(saved?.intent?.queued).toMatchObject({ versionId: published });
    } finally {
      handle.close();
    }
  });
});
