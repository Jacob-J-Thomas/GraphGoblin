import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import {
  FIXTURE_TS,
  fakeUlid,
  kitchenSinkLoop,
  minimalLoop,
  sampleInvocation,
  sampleThread,
} from '@graphgoblin/contracts/testing';
import { createInitialThread } from '@graphgoblin/engine';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { LoopNotFoundError, SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import { decryptSecret, encryptSecret, SqliteSecrets } from './secrets.js';
import { SqliteSessionRepository } from './sessions.js';
import {
  DEFAULT_MODEL_CATALOG,
  SqliteApiKeys,
  SqliteModelCatalog,
  SqliteSettings,
  hashApiKey,
} from './settings.js';
import type { TimerStore } from '../scheduler/timer-store.js';
import { SqliteTimerStore } from './timers.js';

let handle: DatabaseHandle;
let clock: FakeClock;
let ids: FakeIds;

beforeEach(async () => {
  handle = await openMemoryDatabase();
  clock = new FakeClock();
  ids = new FakeIds();
});

afterEach(() => {
  handle.close();
});

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: fakeUlid(`run:${overrides.id ?? 'a'}`),
    ownerId: 'local',
    loopId: fakeUlid('loop:x'),
    versionId: fakeUlid('version:x'),
    invocationId: fakeUlid('inv:x'),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
    ...overrides,
  };
}

describe('database', () => {
  it('migrates idempotently', async () => {
    await handle.migrate();
    const tables = await handle.client.execute(
      "select name from sqlite_master where type='table' order by name",
    );
    const names = tables.rows.map((r) => r['name'] as string);
    expect(names).toEqual(
      expect.arrayContaining([
        'loops',
        'loop_versions',
        'runs',
        'run_events',
        'harness_sessions',
        'timers',
        'secrets',
        'api_keys',
        'settings',
        'model_catalog',
      ]),
    );
  });
});

describe('SqliteRunRepository', () => {
  it('creates, reads, updates, and clears fields', async () => {
    const repo = new SqliteRunRepository(handle.db);
    const thread = sampleThread();
    const run = runRecord({
      parentRunId: fakeUlid('parent'),
      waiting: { nodeId: 'w', kind: 'input' },
    });
    await repo.create(run, thread);
    expect(await repo.get(run.id)).toEqual(run);
    expect(await repo.getInitialThread(run.id)).toEqual(thread);
    expect(await repo.getThread(run.id)).toEqual(thread);

    const updated = await repo.update(run.id, {
      status: 'running',
      waiting: undefined,
      startedAt: FIXTURE_TS,
      result: { ok: true },
      failure: { code: 'INTERNAL_ERROR', message: 'x', resumable: true },
      outcome: 'success',
    });
    expect(updated.status).toBe('running');
    expect(updated.waiting).toBeUndefined();
    expect(updated.result).toEqual({ ok: true });
    expect(updated.failure?.code).toBe('INTERNAL_ERROR');
    expect(updated.outcome).toBe('success');

    const next = { ...thread, vars: { changed: true } };
    await repo.saveThread(run.id, next);
    expect((await repo.getThread(run.id))?.vars).toEqual({ changed: true });
    expect(await repo.getThreadCheckpoint(run.id)).toBeUndefined();
    await repo.saveThread(run.id, next, 7);
    expect(await repo.getThreadCheckpoint(run.id)).toEqual({ thread: next, seq: 7 });
    await repo.clearThreadSnapshot(run.id);
    expect(await repo.getThreadCheckpoint(run.id)).toBeUndefined();
    expect(await repo.getThread(run.id)).toBeUndefined();
    expect(await repo.getInitialThread(run.id)).toEqual(thread);
    await expect(repo.update('missing', {})).rejects.toThrow(/not found/);
    await expect(repo.update('missing', { status: 'running' })).rejects.toThrow(/not found/);
    expect(await repo.update(run.id, {})).toMatchObject({ id: run.id });
    expect(await repo.get('missing')).toBeUndefined();
    expect(await repo.getThread('missing')).toBeUndefined();
    expect(await repo.getInitialThread('missing')).toBeUndefined();
  });

  it('transitions only from expected statuses', async () => {
    const repo = new SqliteRunRepository(handle.db);
    const run = runRecord();
    await repo.create(run, sampleThread());
    expect(await repo.transition(run.id, ['running'], { status: 'waiting' })).toBeUndefined();
    const started = await repo.transition(run.id, ['queued'], { status: 'running' });
    expect(started?.status).toBe('running');
    expect(await repo.transition(run.id, ['running'], {})).toMatchObject({ status: 'running' });
    expect(await repo.transition(run.id, ['queued'], {})).toBeUndefined();
    await expect(repo.transition('missing', ['queued'], {})).rejects.toThrow(/not found/);
    await expect(repo.transition('missing', ['queued'], { status: 'running' })).rejects.toThrow(
      /not found/,
    );
  });

  it('lists terminal runs until their finalization is recorded', async () => {
    const repo = new SqliteRunRepository(handle.db);
    const run = runRecord();
    await repo.create(run, sampleThread());
    expect(await repo.listUnfinalized()).toEqual([]);
    await repo.update(run.id, { status: 'succeeded' });
    expect((await repo.listUnfinalized()).map((r) => r.id)).toEqual([run.id]);
    await repo.markFinalized(run.id);
    expect(await repo.listUnfinalized()).toEqual([]);
  });

  it('migration 0002 marks runs that were already terminal as finalized', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gg-0002-'));
    const migrations = join(dir, 'migrations');
    mkdirSync(join(migrations, 'meta'), { recursive: true });
    const source = fileURLToPath(new URL('../../drizzle/', import.meta.url));
    const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx < 2);
    writeFileSync(join(migrations, 'meta', '_journal.json'), JSON.stringify(journal));
    for (const e of journal.entries)
      copyFileSync(join(source, `${e.tag}.sql`), join(migrations, `${e.tag}.sql`));
    const url = `file:${join(dir, 'old.db').replace(/\\/g, '/')}`;
    const old = openDatabase({ url, migrationsFolder: migrations });
    await old.migrate();
    const thread = JSON.stringify(sampleThread());
    for (const [id, status] of [
      [fakeUlid('old-done'), 'succeeded'],
      [fakeUlid('old-wait'), 'waiting'],
    ] as const) {
      await old.client.execute({
        sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, last_event_seq, initial_thread) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?)',
        args: [
          id,
          'local',
          fakeUlid('loop'),
          fakeUlid('v'),
          fakeUlid(`i-${id}`),
          status,
          '2026-10-01T00:00:00.000Z',
          thread,
        ],
      });
    }
    old.close();
    const current = openDatabase({ url });
    try {
      expect(await current.pendingMigrations()).toBe(1);
      await current.migrate();
      const repo = new SqliteRunRepository(current.db);
      expect(await repo.listUnfinalized()).toEqual([]);
      await repo.update(fakeUlid('old-wait'), { status: 'failed' });
      expect((await repo.listUnfinalized()).map((r) => r.id)).toEqual([fakeUlid('old-wait')]);
    } finally {
      current.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can hold the database file briefly after close; the temp dir is left behind.
      }
    }
  });

  it('claims a cancel request once, and only on an expected status', async () => {
    const repo = new SqliteRunRepository(handle.db);
    const run = runRecord();
    await repo.create(run, sampleThread());
    const at = '2026-10-02T12:00:01.000Z';
    expect(await repo.claimCancel(run.id, ['running'], at)).toBeUndefined();
    const claims = await Promise.all([
      repo.claimCancel(run.id, ['queued'], at),
      repo.claimCancel(run.id, ['queued'], '2026-10-02T12:00:02.000Z'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await repo.get(run.id))?.cancelRequestedAt).toBe(
      claims.find(Boolean)?.cancelRequestedAt,
    );
    expect(await repo.claimCancel('missing', ['queued'], at)).toBeUndefined();
  });

  it('lists by status, children, and filters', async () => {
    const repo = new SqliteRunRepository(handle.db);
    const parent = runRecord({ id: 'p', status: 'waiting', createdAt: '2026-10-02T10:00:00.000Z' });
    const child = runRecord({
      id: 'c',
      parentRunId: parent.id,
      status: 'succeeded',
      createdAt: '2026-10-02T11:00:00.000Z',
      loopId: fakeUlid('loop:child'),
    });
    const other = runRecord({
      id: 'o',
      ownerId: 'someone-else',
      status: 'queued',
      createdAt: '2026-10-02T12:00:00.000Z',
    });
    for (const r of [parent, child, other]) await repo.create(r, sampleThread());

    expect((await repo.listByStatus(['waiting', 'queued'])).map((r) => r.id)).toEqual([
      parent.id,
      other.id,
    ]);
    expect(await repo.listByStatus([])).toEqual([]);
    expect((await repo.listChildren(parent.id)).map((r) => r.id)).toEqual([child.id]);
    expect((await repo.list()).map((r) => r.id)).toEqual([other.id, child.id, parent.id]);
    expect((await repo.list({ ownerId: 'local' })).map((r) => r.id)).toEqual([child.id, parent.id]);
    expect((await repo.list({ loopId: fakeUlid('loop:child') })).map((r) => r.id)).toEqual([
      child.id,
    ]);
    expect((await repo.list({ status: ['succeeded'] })).map((r) => r.id)).toEqual([child.id]);
    expect((await repo.list({ parentRunId: null })).map((r) => r.id)).toEqual([
      other.id,
      parent.id,
    ]);
    expect((await repo.list({ parentRunId: parent.id })).map((r) => r.id)).toEqual([child.id]);
    expect(
      (await repo.list({ before: '2026-10-02T11:30:00.000Z', limit: 1 })).map((r) => r.id),
    ).toEqual([child.id]);
  });
});

describe('SqliteEventStore', () => {
  it('assigns increasing sequence numbers, updates the run, and notifies subscribers', async () => {
    const runs = new SqliteRunRepository(handle.db);
    const store = new SqliteEventStore(handle.db, clock);
    const run = runRecord();
    await runs.create(run, sampleThread());
    const seen: RunEvent[] = [];
    const unsubscribe = store.subscribe(run.id, (e) => seen.push(e));

    expect(await store.append(run.id, [])).toEqual([]);
    const first = await store.append(run.id, [
      { type: 'run.queued' },
      { type: 'run.started', attempt: 1 },
    ]);
    expect(first.map((e) => e.seq)).toEqual([1, 2]);
    const [a, b] = await Promise.all([
      store.append(run.id, [
        { type: 'node.started', nodeId: 'n', kind: 'mutate', attempt: 1, configHash: 'h' },
      ]),
      store.append(run.id, [
        { type: 'node.finished', nodeId: 'n', patch: [], route: 'out', durationMs: 1 },
      ]),
    ]);
    const seqs = [...a, ...b].map((e) => e.seq).sort();
    expect(seqs).toEqual([3, 4]);
    expect((await runs.get(run.id))?.lastEventSeq).toBe(4);

    const all = await store.read(run.id);
    expect(all.map((e) => e.type)).toEqual(
      ['run.queued', 'run.started', 'node.started', 'node.finished'].sort((x, y) =>
        all.findIndex((e) => e.type === x) > all.findIndex((e) => e.type === y) ? 1 : -1,
      ),
    );
    const started = all.find((e) => e.type === 'node.started');
    expect(started).toMatchObject({
      nodeId: 'n',
      kind: 'mutate',
      attempt: 1,
      configHash: 'h',
      ts: clock.now().toISOString(),
    });
    expect(await store.read(run.id, 2)).toHaveLength(2);
    expect(await store.read(run.id, 0, 1)).toHaveLength(1);
    expect(seen).toHaveLength(4);
    unsubscribe();
    await store.append(run.id, [{ type: 'run.cancelled' }]);
    expect(seen).toHaveLength(4);
  });

  it('appends conditionally on the last seq, atomically', async () => {
    const runs = new SqliteRunRepository(handle.db);
    const store = new SqliteEventStore(handle.db, clock);
    const run = runRecord();
    await runs.create(run, sampleThread());
    await store.append(run.id, [{ type: 'run.queued' }], { expectedLastSeq: 0 });
    const results = await Promise.allSettled([
      store.append(run.id, [{ type: 'run.woken', nodeId: 'w', reason: 'input' }], {
        expectedLastSeq: 1,
      }),
      store.append(run.id, [{ type: 'run.woken', nodeId: 'w', reason: 'input' }], {
        expectedLastSeq: 1,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { name: 'AppendConflictError', expectedLastSeq: 1, actualLastSeq: 2 },
    });
    expect((await store.read(run.id)).map((e) => e.type)).toEqual(['run.queued', 'run.woken']);
  });
});

describe('SqliteLoopRepository', () => {
  it('creates loops with drafts, publishes, and resolves versions', async () => {
    const repo = new SqliteLoopRepository(handle.db, clock, ids);
    const definition = LoopDefinitionSchema.parse(minimalLoop());
    const { loop, draft } = await repo.create('local', definition);
    expect(loop.name).toBe('minimal');
    expect(loop.draftVersionId).toBe(draft.id);
    expect(draft.status).toBe('draft');
    expect(await repo.getLatestPublished(loop.id)).toBeUndefined();
    expect((await repo.listLoops('local')).map((l) => l.id)).toEqual([loop.id]);
    expect(await repo.listLoops('nobody')).toEqual([]);

    const published = await repo.publish(loop.id);
    expect(published?.status).toBe('published');
    expect(published?.publishedAt).toBe(clock.now().toISOString());
    const afterPublish = await repo.getLoop(loop.id);
    expect(afterPublish?.currentVersionId).toBe(draft.id);
    expect(afterPublish?.draftVersionId).toBeUndefined();
    expect(await repo.publish(loop.id)).toBeUndefined();
    expect((await repo.getLatestPublished(loop.id))?.id).toBe(draft.id);
    expect((await repo.getPublished(loop.id, 1))?.id).toBe(draft.id);
    expect(await repo.getPublished(loop.id, 2)).toBeUndefined();

    const second = LoopDefinitionSchema.parse({ ...kitchenSinkLoop(), name: 'renamed' });
    const newDraft = await repo.saveDraft(loop.id, second);
    expect(newDraft.version).toBe(2);
    expect(newDraft.status).toBe('draft');
    expect((await repo.getLoop(loop.id))?.name).toBe('renamed');
    const sameDraft = await repo.saveDraft(loop.id, { ...second, description: 'edited' });
    expect(sameDraft.id).toBe(newDraft.id);
    expect(sameDraft.definition.description).toBe('edited');
    expect((await repo.listVersions(loop.id)).map((v) => v.version)).toEqual([2, 1]);
    await repo.publish(loop.id);
    expect((await repo.getLatestPublished(loop.id))?.version).toBe(2);
    expect((await repo.getVersion(newDraft.id))?.status).toBe('published');

    await expect(repo.saveDraft('missing', definition)).rejects.toBeInstanceOf(LoopNotFoundError);
    await expect(repo.publish('missing')).rejects.toBeInstanceOf(LoopNotFoundError);
    expect(await repo.delete(loop.id)).toBe(true);
    expect(await repo.delete(loop.id)).toBe(false);
    expect(await repo.getLoop(loop.id)).toBeUndefined();
    expect(await repo.listVersions(loop.id)).toEqual([]);
  });
});

describe('SqliteSessionRepository', () => {
  it('upserts and queries sessions', async () => {
    const repo = new SqliteSessionRepository(handle.db);
    const runId = fakeUlid('run:s');
    await repo.upsert({
      runId,
      nodeId: 'a',
      attempt: 1,
      harness: 'codex',
      status: 'starting',
      updatedAt: '2026-10-02T12:00:00.000Z',
      model: 'm',
      effort: 'low',
      scopeKey: 'loop:shared',
    });
    await repo.upsert({
      runId,
      nodeId: 'a',
      attempt: 1,
      harness: 'codex',
      sessionId: 's1',
      status: 'active',
      updatedAt: '2026-10-02T12:00:01.000Z',
      scopeKey: 'loop:shared',
    });
    await repo.upsert({
      runId,
      nodeId: 'a',
      attempt: 2,
      harness: 'codex',
      sessionId: 's1',
      status: 'finished',
      updatedAt: '2026-10-02T12:00:02.000Z',
    });
    await repo.upsert({
      runId,
      nodeId: 'b',
      attempt: 1,
      harness: 'codex',
      sessionId: 's2',
      status: 'finished',
      updatedAt: '2026-10-02T12:00:03.000Z',
    });
    expect((await repo.forNode(runId, 'a'))?.attempt).toBe(2);
    expect((await repo.forNode(runId, 'a'))?.model).toBeUndefined();
    expect(await repo.forNode(runId, 'zzz')).toBeUndefined();
    expect((await repo.latestWithSession(runId))?.sessionId).toBe('s2');
    expect((await repo.byScopeKey('loop:shared'))?.sessionId).toBe('s1');
    expect(await repo.byScopeKey('nope')).toBeUndefined();
    expect(await repo.listForRun(runId)).toHaveLength(3);
  });
});

describe('SqliteTimerStore', () => {
  it('stores, lists, and removes timers', async () => {
    // Typed as the scheduler's interface: a compile-time check that the structural match holds.
    const store: TimerStore = new SqliteTimerStore(handle.db);
    const run = fakeUlid('run:t');
    await store.upsert(run, 'timer', new Date('2026-10-02T12:00:10.000Z'));
    await store.upsert(run, 'timeout', new Date('2026-10-02T12:00:20.000Z'));
    await store.upsert(run, 'timer', new Date('2026-10-02T12:00:05.000Z'));
    expect((await store.list(run)).map((t) => t.key)).toEqual(['timer', 'timeout']);
    expect((await store.listDue(new Date('2026-10-02T12:00:06.000Z'))).map((t) => t.key)).toEqual([
      'timer',
    ]);
    expect(await store.listDue(new Date('2026-10-02T12:00:00.000Z'))).toEqual([]);
    // Acknowledging a fire removes the timer only while it still has the fired time.
    await store.acknowledge(run, 'timeout', new Date('2026-10-02T12:00:19.000Z'));
    expect((await store.list(run)).map((t) => t.key)).toEqual(['timer', 'timeout']);
    await store.acknowledge(run, 'timer', new Date('2026-10-02T12:00:05.000Z'));
    expect((await store.list(run)).map((t) => t.key)).toEqual(['timeout']);
    await store.upsert(run, 'timer', new Date('2026-10-02T12:00:05.000Z'));
    await store.remove(run, 'timer');
    expect((await store.list(run)).map((t) => t.key)).toEqual(['timeout']);
    await store.remove(run);
    expect(await store.list(run)).toEqual([]);
  });
});

describe('secrets', () => {
  const key = Buffer.alloc(32, 7);

  it('encrypts and decrypts, detecting tampering and bad keys', () => {
    const encoded = encryptSecret(key, 'hello');
    expect(decryptSecret(key, encoded)).toBe('hello');
    expect(encryptSecret(key, 'hello')).not.toBe(encoded);
    const tampered = Buffer.from(encoded, 'base64');
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(() => decryptSecret(key, tampered.toString('base64'))).toThrow();
    expect(() => decryptSecret(key, 'AAAA')).toThrow(/too short/);
    expect(() => encryptSecret(Buffer.alloc(3), 'x')).toThrow(/32 bytes/);
    expect(() => decryptSecret(Buffer.alloc(3), encoded)).toThrow(/32 bytes/);
  });

  it('stores per owner and never returns plaintext in listings', async () => {
    const mine = new SqliteSecrets(handle.db, clock, key, 'local');
    const theirs = new SqliteSecrets(handle.db, clock, key, 'other');
    const summary = await mine.set('jev', 'secret-value');
    expect(summary).toEqual({
      name: 'jev',
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    });
    expect(await mine.resolve('jev')).toBe('secret-value');
    expect(await theirs.resolve('jev')).toBeUndefined();
    clock.advance(1000);
    await mine.set('jev', 'rotated');
    expect(await mine.resolve('jev')).toBe('rotated');
    const listed = await mine.list();
    expect(listed).toEqual([
      { name: 'jev', createdAt: FIXTURE_TS, updatedAt: clock.now().toISOString() },
    ]);
    expect(JSON.stringify(listed)).not.toContain('rotated');
    expect(await mine.delete('jev')).toBe(true);
    expect(await mine.delete('jev')).toBe(false);
    expect(await mine.resolve('jev')).toBeUndefined();
  });
});

describe('settings, api keys, model catalog', () => {
  it('settings round-trip per owner', async () => {
    const s = new SqliteSettings(handle.db, clock);
    expect(await s.get('local', 'defaultModel')).toBeUndefined();
    await s.set('local', 'defaultModel', 'gpt-6-luna');
    await s.set('local', 'defaultModel', 'gpt-6-sol');
    await s.set('local', 'effort', 'low');
    expect(await s.get('local', 'defaultModel')).toBe('gpt-6-sol');
    expect(await s.getAll('local')).toEqual({ defaultModel: 'gpt-6-sol', effort: 'low' });
    expect(await s.getAll('other')).toEqual({});
    expect(await s.delete('local', 'effort')).toBe(true);
    expect(await s.delete('local', 'effort')).toBe(false);
  });

  it('api keys authenticate until revoked', async () => {
    const keys = new SqliteApiKeys(handle.db, clock, ids);
    const { record, token } = await keys.create('local', 'ci', ['runs:write']);
    expect(token.startsWith('gg_')).toBe(true);
    expect(hashApiKey(token)).toHaveLength(64);
    clock.advance(5000);
    const authed = await keys.authenticate(token);
    expect(authed).toMatchObject({
      id: record.id,
      ownerId: 'local',
      scopes: ['runs:write'],
      lastUsedAt: clock.now().toISOString(),
    });
    expect(await keys.authenticate('gg_nope')).toBeUndefined();
    const listed = await keys.list('local');
    expect(listed[0]).toMatchObject({ label: 'ci', lastUsedAt: clock.now().toISOString() });
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(await keys.revoke('other', record.id)).toBe(false);
    expect(await keys.revoke('local', record.id)).toBe(true);
    expect(await keys.revoke('local', record.id)).toBe(false);
    expect(await keys.authenticate(token)).toBeUndefined();
    expect((await keys.list('local'))[0]?.revokedAt).toBeDefined();
  });

  it('seeds the model catalog once and answers allow-list questions', async () => {
    const catalog = new SqliteModelCatalog(handle.db);
    expect(await catalog.seed()).toBe(DEFAULT_MODEL_CATALOG.length);
    expect(await catalog.seed()).toBe(0);
    expect((await catalog.list()).map((m) => m.model)).toContain('gpt-6-luna');
    expect(await catalog.isAllowed('codex', 'gpt-6-luna', 'low')).toBe(true);
    expect(await catalog.isAllowed('codex', 'gpt-6-luna', 'max')).toBe(false);
    expect(await catalog.isAllowed('codex', 'gpt-6-luna')).toBe(true);
    expect(await catalog.isAllowed('codex', 'nope')).toBe(false);
    await catalog.upsert({
      harness: 'codex',
      model: 'gpt-6-luna',
      displayName: 'Luna',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: false,
    });
    expect(await catalog.isAllowed('codex', 'gpt-6-luna', 'low')).toBe(false);
    expect(await catalog.delete('codex', 'gpt-6-luna')).toBe(true);
    expect(await catalog.delete('codex', 'gpt-6-luna')).toBe(false);
  });
});

describe('with the engine', () => {
  it('runs a loop end to end on SQLite', async () => {
    const { RunManager } = await import('@graphgoblin/engine');
    const { createFakePorts, DEFAULT_TEST_SETTINGS } = await import('@graphgoblin/engine/testing');
    const fakes = createFakePorts();
    const runs = new SqliteRunRepository(handle.db);
    const loops = new SqliteLoopRepository(handle.db, clock, ids);
    const { loop } = await loops.create(
      'local',
      LoopDefinitionSchema.parse(kitchenSinkLoopReduced()),
    );
    await loops.publish(loop.id);
    const manager = new RunManager(
      {
        ...fakes,
        clock,
        ids,
        runs,
        loops,
        events: new SqliteEventStore(handle.db, clock),
        sessions: new SqliteSessionRepository(handle.db),
      },
      DEFAULT_TEST_SETTINGS,
    );
    await manager.start();
    const run = await manager.startRun({
      ownerId: 'local',
      loopId: loop.id,
      source: 'manual.api',
      payload: { hello: 1 },
    });
    await manager.waitForIdle();
    const final = await runs.get(run.id);
    expect(final?.status).toBe('succeeded');
    expect(final?.lastEventSeq).toBeGreaterThan(4);
    const thread = await manager.getThread(run.id);
    expect(thread?.vars['topic']).toBe('loops');
    expect(thread?.invocation).toMatchObject({
      source: 'manual.api',
      trigger: { kind: 'manual', payload: { hello: 1 } },
    });
    expect(sampleInvocation().source).toBe(thread?.invocation.source);
    const initial = await runs.getInitialThread(run.id);
    expect(
      createInitialThread({
        runId: run.id,
        loopId: loop.id,
        versionId: final!.versionId,
        invocation: thread!.invocation,
      }),
    ).toEqual(initial);
    manager.stop();
  });
});

/** Trigger, mutate, exit: enough to exercise persistence without external nodes. */
function kitchenSinkLoopReduced() {
  const loop = kitchenSinkLoop();
  return {
    ...loop,
    settings: { maxIterations: 3 },
    nodes: loop.nodes
      .filter((n) => ['start', 'prep', 'done'].includes(n.id))
      .map((n) => (n.id === 'done' ? { ...n, config: {} } : n)),
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
      { id: 'e3', from: { node: 'prep', port: 'out' }, to: { node: 'done' } },
    ],
  };
}
