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
import { createInitialThread, parseRunAdmission, type RunAdmission } from '@graphgoblin/engine';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteLoopRepository } from './loops.js';
import { RunPinMissingError, SqliteRunRepository } from './runs.js';
import { applyShippedSqlToHistoricalTestFixture } from './testing/shipped-migrations.js';

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
  afterEach(() => handle.close());

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

  it('a stored run without a pin is reported as corrupt', async () => {
    const { run } = await draftRun('corrupt');
    await handle.client.execute({
      sql: 'UPDATE runs SET pinned = NULL WHERE id = ?',
      args: [run.id],
    });
    await expect(runs.get(run.id)).rejects.toBeInstanceOf(RunPinMissingError);
  });
});

describe('migration 0014 pins existing runs', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0))
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** A store migrated through 0013, the last migration before definition pins. */
  async function storeBeforePins(): Promise<DatabaseHandle> {
    const dir = await mkdtemp(join(tmpdir(), 'gg-pin-migration-'));
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
            JSON.stringify(named(name)),
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
        definition: named('Draft name'),
        createdAt: FIXTURE_TS,
      });
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
});
