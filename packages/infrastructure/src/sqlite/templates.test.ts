import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  TemplateInstanceSchema,
  type JsonValue,
  type RunRecord,
  type RunStatus,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import {
  AdmissionConflictError,
  createInitialThread,
  type RunAdmission,
} from '@graphgoblin/engine';
import { FakeClock } from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission, type AfterRunStaged } from './admission.js';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { runInsert, SqliteRunRepository } from './runs.js';
import { loops, loopVersions, runEvents, runs, templateInstances } from './schema.js';
import {
  SqliteTemplateInstances,
  TemplateTransaction,
  type TemplateBundleRow,
  type TemplateSubjectFilter,
} from './templates.js';

let handle: DatabaseHandle;
let store: SqliteTemplateInstances;
beforeEach(async () => {
  handle = await openMemoryDatabase();
  store = new SqliteTemplateInstances(handle.db);
});
afterEach(() => handle.close());

function bundle(seed = 'first', ownerId = 'local') {
  const child: TemplateBundleRow = {
    key: 'child',
    loopId: fakeUlid(seed + ':child'),
    versionId: fakeUlid(seed + ':child-version'),
    version: 1,
    name: seed + ' child',
    status: 'published',
    definition: LoopDefinitionSchema.parse(minimalLoop()),
  };
  const parent: TemplateBundleRow = {
    key: 'parent',
    loopId: fakeUlid(seed + ':parent'),
    versionId: fakeUlid(seed + ':parent-version'),
    version: 1,
    name: seed + ' parent',
    status: 'draft',
    definition: LoopDefinitionSchema.parse({
      ...minimalLoop(),
      nodes: [
        { id: 'start', label: 'Start', kind: 'trigger', config: { subtype: 'manual' } },
        {
          id: 'child',
          label: 'Child',
          kind: 'subloop',
          config: {
            loopRef: { loopId: child.loopId, version: child.version },
            input: { mode: 'inherit' },
            output: { mode: 'result-only' },
          },
        },
        { id: 'done', label: 'Done', kind: 'exit', config: {} },
      ],
      edges: [
        { id: 'first', from: { node: 'start', port: 'out' }, to: { node: 'child' } },
        { id: 'last', from: { node: 'child', port: 'out' }, to: { node: 'done' } },
      ],
    }),
  };
  const prepared = [child, parent];
  const instance = TemplateInstanceSchema.parse({
    id: fakeUlid(seed + ':instance'),
    ownerId,
    templateId: 'starter',
    templateVersion: '1.0.0',
    createdAt: FIXTURE_TS,
    parentLoopId: parent.loopId,
    loops: prepared.map(({ key, loopId, versionId, version, status }) => ({
      key,
      loopId,
      versionId,
      version,
      status,
    })),
    settings: {
      kind: 'starter',
      instruction: 'Literal $(do-not-execute) {{do-not-render}}',
      roles: { assistant: { harness: 'codex', model: 'enabled-model', effort: 'low' } },
    },
  });
  const binding = {
    version: '1.0.0',
    settings: {
      instruction: instance.settings.kind === 'starter' ? instance.settings.instruction : '',
    },
    nodes: [{ id: 'child', kind: 'subloop', configHash: 'a'.repeat(64) }],
    support: { entry: 'installed/support.mjs', hash: 'b'.repeat(64) },
  };
  return { instance, binding, prepared, child, parent };
}

async function expectEmptyBundle() {
  expect(await handle.db.select().from(loops)).toEqual([]);
  expect(await handle.db.select().from(loopVersions)).toEqual([]);
  expect(await handle.db.select().from(templateInstances)).toEqual([]);
}

function record(seed: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: fakeUlid('template-run:' + seed),
    ownerId: 'local',
    loopId: fakeUlid('loop:' + seed),
    versionId: fakeUlid('version:' + seed),
    invocationId: fakeUlid('invocation:' + seed),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
    ...overrides,
  };
}

async function insertSubject(
  seed: string,
  subject: JsonValue | null,
  overrides: Partial<RunRecord> = {},
) {
  const run = record(seed, overrides);
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
  await handle.db
    .insert(runs)
    .values({ ...runInsert(run, initialThread), templateSubject: subject });
  return run;
}

function subject(patch: Record<string, JsonValue> = {}) {
  return {
    role: 'parent',
    kind: 'implementation',
    instanceId: fakeUlid('instance-a'),
    repository: 'example/project',
    issue: 7,
    attempt: 1,
    ...patch,
  };
}

function intent(
  seed: string,
  mode: 'manual' | 'poll' | 'webhook' = 'manual',
  overrides: Partial<RunRecord> = {},
): RunAdmission {
  const run = record(seed, overrides);
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: run.parentRunId ? 'subloop' : mode === 'manual' ? 'manual.api' : mode,
      ...(run.parentRunId ? { caller: { kind: 'run', id: run.parentRunId } } : {}),
      trigger: {
        nodeId: 'start',
        kind: mode,
        payload: null,
        receivedAt: run.createdAt,
        ...(mode === 'poll' ? { dedupeKey: 'independent-key:' + seed } : {}),
      },
    },
  });
  return {
    run,
    initialThread,
    queued: { type: 'run.queued', initialThread },
    pinnedLoopIds: [run.loopId],
  };
}

function reserveSubject(): AfterRunStaged {
  return async (tx, input, pollItem) => {
    const prior = await tx.subjectRuns({
      ownerId: input.run.ownerId,
      repository: 'example/project',
      issue: 7,
      limit: 10,
    });
    if (prior.length > 0) {
      if (pollItem) return { action: 'skip' };
      throw new AdmissionConflictError();
    }
    await tx.setSubject(input.run.id, subject());
    return { action: 'keep' };
  };
}

describe('SQLite template bundles', () => {
  it('commits published child pins and a draft parent with the owner binding together', async () => {
    const value = bundle();
    await store.create(value.instance, value.binding, value.prepared);
    expect(await store.get('local', value.instance.id)).toEqual({
      instance: value.instance,
      binding: value.binding,
    });
    expect(await store.bindingForLoop('local', value.child.loopId)).toEqual(
      await store.get('local', value.instance.id),
    );
    expect(await store.bindingForLoop('local', value.parent.loopId)).toEqual(
      await store.get('local', value.instance.id),
    );
    const rows = await handle.db.select().from(loops);
    expect(rows.find((row) => row.id === value.child.loopId)).toMatchObject({
      currentVersionId: value.child.versionId,
      draftVersionId: null,
    });
    expect(rows.find((row) => row.id === value.parent.loopId)).toMatchObject({
      currentVersionId: null,
      draftVersionId: value.parent.versionId,
    });
    expect(await store.version(value.parent.versionId)).toMatchObject({
      definition: value.parent.definition,
      publishedAt: null,
    });
    expect(await store.version(value.child.versionId)).toMatchObject({ publishedAt: FIXTURE_TS });
    expect(await store.version(fakeUlid('missing-version'))).toBeUndefined();
  });

  it('refuses an allocation mismatch before making any child visible', async () => {
    const value = bundle();
    await expect(store.create(value.instance, value.binding, [value.child])).rejects.toThrow(
      'allocations disagree',
    );
    await expectEmptyBundle();
    await expect(
      store.create(value.instance, value.binding, [value.child, { ...value.parent, version: 2 }]),
    ).rejects.toThrow('allocations disagree');
    await expectEmptyBundle();
    await expect(
      store.create(value.instance, value.binding, [value.parent, value.child]),
    ).rejects.toThrow('allocations disagree');
    await expectEmptyBundle();
  });

  it('refuses a published parent before writing any rows', async () => {
    const value = bundle();
    const invalid = {
      ...value.instance,
      loops: value.instance.loops.map((loop) => ({ ...loop, status: 'published' as const })),
    };
    await expect(store.create(invalid, value.binding, value.prepared)).rejects.toThrow(
      'draft parent',
    );
    await expectEmptyBundle();
  });

  it.each(['parent', 'version', 'binding'])(
    'rolls back every child and parent if the %s write fails',
    async (stage) => {
      const value = bundle();
      const statement =
        stage === 'parent'
          ? `CREATE TRIGGER reject_bundle BEFORE INSERT ON loops WHEN NEW.id='${value.parent.loopId}' BEGIN SELECT RAISE(ABORT,'injected parent failure'); END`
          : stage === 'version'
            ? `CREATE TRIGGER reject_bundle BEFORE INSERT ON loop_versions WHEN NEW.id='${value.parent.versionId}' BEGIN SELECT RAISE(ABORT,'injected version failure'); END`
            : "CREATE TRIGGER reject_bundle BEFORE INSERT ON template_instances BEGIN SELECT RAISE(ABORT,'injected binding failure'); END";
      await handle.client.execute(statement);
      await expect(store.create(value.instance, value.binding, value.prepared)).rejects.toThrow();
      await expectEmptyBundle();
      await handle.client.execute('DROP TRIGGER reject_bundle');
      await store.create(value.instance, value.binding, value.prepared);
      expect(await store.get('local', value.instance.id)).toBeDefined();
    },
  );

  it('keeps the immutable binding independent from caller objects and subsequent editor changes', async () => {
    const value = bundle();
    const snapshot = structuredClone({ instance: value.instance, binding: value.binding });
    await store.create(value.instance, value.binding, value.prepared);
    value.binding.settings.instruction = 'caller mutation';
    if (value.instance.settings.kind !== 'starter') throw new Error('expected starter settings');
    value.instance.settings.maxIterations = 22;
    const changed = LoopDefinitionSchema.parse({
      ...value.parent.definition,
      name: 'Edited definition',
    });
    await handle.client.execute({
      sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
      args: [JSON.stringify(changed), value.parent.versionId],
    });
    expect(await store.get('local', value.instance.id)).toEqual(snapshot);
    const fetched = await store.get('local', value.instance.id);
    if (!fetched) throw new Error('missing committed instance');
    fetched.instance.templateVersion = '2.0.0';
    expect(await store.get('local', value.instance.id)).toEqual(snapshot);
  });

  it('never returns another owner binding or an unbound loop', async () => {
    const value = bundle();
    await store.create(value.instance, value.binding, value.prepared);
    expect(await store.get('other-owner', value.instance.id)).toBeUndefined();
    expect(await store.bindingForLoop('other-owner', value.parent.loopId)).toBeUndefined();
    expect(await store.bindingForLoop('local', fakeUlid('unbound'))).toBeUndefined();
    expect(await store.get('local', fakeUlid('missing-instance'))).toBeUndefined();
  });

  it('does not replace an existing instance when a duplicate bundle is submitted', async () => {
    const first = bundle();
    await store.create(first.instance, first.binding, first.prepared);
    const second = bundle('second');
    second.instance.id = first.instance.id;
    await expect(store.create(second.instance, second.binding, second.prepared)).rejects.toThrow();
    expect(await store.get('local', first.instance.id)).toEqual({
      instance: first.instance,
      binding: first.binding,
    });
    expect(await store.bindingForLoop('local', second.parent.loopId)).toBeUndefined();
    expect(await handle.db.select().from(loops)).toHaveLength(2);
    expect(await handle.db.select().from(loopVersions)).toHaveLength(2);
  });

  it('retains owner and binding pins after a real file database is reopened', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'graphgoblin-template-storage-'));
    const url = 'file:' + join(folder, 'test.db');
    let disk = openDatabase({ url });
    try {
      await disk.migrate();
      const value = bundle('restart');
      await new SqliteTemplateInstances(disk.db).create(
        value.instance,
        value.binding,
        value.prepared,
      );
      // Windows native SQLite keeps WAL sidecars mapped past close; this fixture needs no WAL.
      await disk.client.execute('PRAGMA journal_mode = DELETE');
      disk.close();
      disk = openDatabase({ url });
      await disk.migrate();
      const reopened = new SqliteTemplateInstances(disk.db);
      expect(await reopened.get('local', value.instance.id)).toEqual({
        instance: value.instance,
        binding: value.binding,
      });
      expect(await reopened.bindingForLoop('local', value.child.loopId)).toEqual(
        await reopened.get('local', value.instance.id),
      );
      expect(await reopened.get('other-owner', value.instance.id)).toBeUndefined();
    } finally {
      await disk.client.execute('PRAGMA journal_mode = DELETE');
      disk.close();
      // libsql on Windows may hold a native file mapping until the Vitest worker exits.
      // Keep every persistence assertion strict, and tolerate only that fixture cleanup lock.
      await rm(folder, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(
        (error: unknown) => {
          if (
            process.platform === 'win32' &&
            error instanceof Error &&
            'code' in error &&
            (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')
          )
            return;
          throw error;
        },
      );
    }
  });
});

describe('SQLite template subject storage', () => {
  it('pages equal timestamps without omissions or repeated rows and excludes other owners and ordinary runs', async () => {
    const expected: string[] = [];
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const run = await insertSubject(seed, subject({ issue: seed.charCodeAt(0) }));
      expected.push(run.id);
    }
    await insertSubject('other-owner', subject(), { ownerId: 'other-owner' });
    await insertSubject('ordinary', null);
    const found: string[] = [];
    let before: TemplateSubjectFilter['before'];
    for (let page = 0; page < 4; page++) {
      const rows = await store.subjectRuns({
        ownerId: 'local',
        limit: 2,
        ...(before ? { before } : {}),
      });
      if (rows.length === 0) break;
      found.push(...rows.map(({ run }) => run.id));
      const last = rows.at(-1)!;
      before = { createdAt: last.run.createdAt, id: last.run.id };
    }
    expect(found).toEqual(expected.sort().reverse());
    expect(new Set(found).size).toBe(expected.length);
  });

  it('combines all supported subject filters without leaking adjacent subjects', async () => {
    const selectedSubject = subject({
      kind: 'review',
      pullRequest: 3,
      head: 'a'.repeat(40),
      mergeSha: 'b'.repeat(40),
    });
    const selected = await insertSubject('selected', selectedSubject);
    const filters = {
      repository: 'example/project',
      issue: 7,
      pullRequest: 3,
      head: 'a'.repeat(40),
      mergeSha: 'b'.repeat(40),
      instanceId: fakeUlid('instance-a'),
    };
    let index = 0;
    for (const [key, value] of Object.entries(filters)) {
      const different = typeof value === 'number' ? value + 1 : value + '-different';
      await insertSubject('different-' + index++, {
        ...selectedSubject,
        [key]: different,
        role: 'worker',
        parentRunId: fakeUlid('filter-parent-' + index),
        nodeId: 'work',
        visit: 1,
      });
    }
    expect(await store.subjectRuns({ ownerId: 'local', ...filters, limit: 10 })).toEqual([
      { run: selected, subject: selectedSubject },
    ]);
    expect(
      await store.subjectRuns({ ownerId: 'local', repository: 'absent/repo', limit: 10 }),
    ).toEqual([]);
  });

  it('runs the facade inside the admission transaction and rolls back its subject and events', async () => {
    const run = await insertSubject('transaction', null);
    await expect(
      handle.db.transaction(async (tx) => {
        const scoped = new TemplateTransaction(tx);
        await scoped.setSubject(run.id, subject());
        expect(await scoped.run(run.id)).toEqual({ run, subject: subject() });
        await tx.insert(runEvents).values({
          runId: run.id,
          seq: 1,
          ts: FIXTURE_TS,
          type: 'node.started',
          nodeId: 'claim',
          payload: { kind: 'script', configHash: 'a'.repeat(64) },
        });
        expect(await scoped.events(run.id)).toHaveLength(1);
        throw new Error('refuse staged admission');
      }),
    ).rejects.toThrow('refuse staged admission');
    expect(await store.run(run.id)).toEqual({ run, subject: null });
    expect(await store.events(run.id)).toEqual([]);
    expect(await store.run(fakeUlid('missing-run'))).toBeUndefined();
  });

  it('reads only the requested run in sequence order and provides a bounded overflow sentinel', async () => {
    const run = await insertSubject('bounded-events', subject());
    const other = await insertSubject('other-events', subject({ issue: 8 }));
    await handle.db.insert(runEvents).values(
      Array.from({ length: 1002 }, (_, index) => ({
        runId: run.id,
        seq: 1002 - index,
        ts: FIXTURE_TS,
        type: 'node.finished',
        nodeId: 'claim',
        payload: {},
      })),
    );
    await handle.db
      .insert(runEvents)
      .values({ runId: other.id, seq: 1, ts: FIXTURE_TS, type: 'node.finished', payload: {} });
    const bounded = await store.events(run.id);
    expect(bounded).toHaveLength(1001);
    expect(bounded.every((event) => event.runId === run.id)).toBe(true);
    expect(bounded[0]?.seq).toBe(1);
    expect(bounded.at(-1)?.seq).toBe(1001);
    expect((await store.events(run.id, 2)).map((event) => event.seq)).toEqual([1, 2]);
  });

  it.each<RunStatus>(['succeeded', 'failed', 'cancelled', 'exhausted'])(
    'keeps an implementation attempt consumed after %s across instances',
    async (status) => {
      await insertSubject('claimed', subject(), { status });
      await expect(
        insertSubject('replacement', subject({ instanceId: fakeUlid('instance-b') })),
      ).rejects.toThrow();
      expect(
        await store.subjectRuns({
          ownerId: 'local',
          repository: 'example/project',
          issue: 7,
          limit: 10,
        }),
      ).toHaveLength(1);
      await insertSubject('next-attempt', subject({ attempt: 2 }));
      await insertSubject('other-owner', subject(), { ownerId: 'other-owner' });
      await insertSubject('other-repo', subject({ repository: 'example/other' }));
    },
  );

  it('lets child workers inherit an attempt while uniquely recovering the original parent visit', async () => {
    const parent = await insertSubject('parent', subject());
    const workerSubject = subject({
      role: 'worker',
      parentRunId: parent.id,
      nodeId: 'task',
      visit: 5,
    });
    const original = await insertSubject('original-child', workerSubject, {
      parentRunId: parent.id,
    });
    expect(await store.originalChild(parent.id, 'task', 5)).toEqual(original);
    await expect(
      insertSubject('duplicate-child', workerSubject, { parentRunId: parent.id }),
    ).rejects.toThrow();
    const next = await insertSubject(
      'next-visit',
      { ...workerSubject, visit: 6 },
      { parentRunId: parent.id },
    );
    expect(await store.originalChild(parent.id, 'task', 6)).toEqual(next);
    expect(await store.originalChild(parent.id, 'task', 7)).toBeUndefined();
    expect(await store.originalChild(fakeUlid('different-parent'), 'task', 5)).toBeUndefined();
    expect(await store.originalChild(parent.id, 'different-node', 5)).toBeUndefined();
  });

  it('keeps a merge SHA consumed after a failed no-turn run, including changed issue linkage', async () => {
    const qa = subject({ kind: 'qa', mergeSha: 'c'.repeat(40) });
    await insertSubject('qa-failed', qa, { status: 'failed' });
    await expect(
      insertSubject('qa-repeat', { ...qa, issue: 99, instanceId: fakeUlid('instance-b') }),
    ).rejects.toThrow();
    await insertSubject('qa-worker', {
      ...qa,
      role: 'worker',
      parentRunId: fakeUlid('qa-parent'),
      nodeId: 'qa',
      visit: 1,
    });
    // A new merge must also belong to a distinct authenticated issue attempt.
    await insertSubject('new-merge', { ...qa, attempt: 2, mergeSha: 'd'.repeat(40) });
  });

  it.each<RunStatus>(['queued', 'running', 'waiting', 'paused'])(
    'prevents a second active review across instances while the first is %s',
    async (status) => {
      const review = subject({ kind: 'review', pullRequest: 3, head: 'a'.repeat(40) });
      await insertSubject('review-holder', review, { status });
      await expect(
        insertSubject('review-competing', {
          ...review,
          instanceId: fakeUlid('instance-b'),
          head: 'b'.repeat(40),
        }),
      ).rejects.toThrow();
      await insertSubject('review-worker', {
        ...review,
        role: 'worker',
        parentRunId: fakeUlid('review-parent'),
        nodeId: 'reviewer',
        visit: 1,
      });
      expect(await store.subjectRuns({ ownerId: 'local', pullRequest: 3, limit: 10 })).toHaveLength(
        2,
      );
    },
  );

  it('consumes the reviewed head after termination while allowing a genuinely different head', async () => {
    const review = subject({ kind: 'review', pullRequest: 3, head: 'a'.repeat(40) });
    await insertSubject('review-failed', review, { status: 'failed' });
    await expect(
      insertSubject('review-same-head', { ...review, instanceId: fakeUlid('instance-b') }),
    ).rejects.toThrow();
    const changed = await insertSubject('review-new-head', { ...review, head: 'b'.repeat(40) });
    expect(await store.run(changed.id)).toMatchObject({ run: changed });
  });

  it('does not let a failed review resume into another active holder', async () => {
    const review = subject({ kind: 'review', pullRequest: 3, head: 'a'.repeat(40) });
    const failed = await insertSubject('failed-holder', review, { status: 'failed' });
    const active = await insertSubject('active-holder', { ...review, head: 'b'.repeat(40) });
    await expect(
      new SqliteRunRepository(handle.db).transition(failed.id, ['failed'], { status: 'queued' }),
    ).rejects.toThrow();
    expect((await store.run(failed.id))?.run.status).toBe('failed');
    expect((await store.run(active.id))?.run.status).toBe('queued');
  });
});

describe('SQLite template admission policy transaction', () => {
  it('retains a pending webhook receipt and its pins when template policy refuses a staged run', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const input = intent('webhook-refusal', 'webhook');
    const admission = new SqliteTriggerAdmission(handle.db, events, async (tx, authored) => {
      await tx.setSubject(authored.run.id, subject());
      throw new Error('template precondition refused');
    });
    const receipt = await admission.claim(
      {
        id: fakeUlid('policy-webhook-receipt'),
        ownerId: input.run.ownerId,
        loopId: input.run.loopId,
        triggerNodeId: 'start',
        contentHash: 'a'.repeat(64),
        inbound: {
          id: fakeUlid('policy-webhook-inbound'),
          ownerId: input.run.ownerId,
          type: 'webhook',
          payload: null,
          source: 'webhook:test',
          receivedAt: FIXTURE_TS,
          runIds: [],
        },
      },
      input,
    );
    expect(await admission.get(receipt.receipt.id)).toEqual(receipt.receipt);
    await expect(admission.create(input, receipt.receipt.id)).rejects.toThrow(
      'template precondition refused',
    );
    expect((await admission.get(receipt.receipt.id))?.status).toBe('pending');
    expect(await admission.hasPendingPin(input.run.loopId)).toBe(true);
    expect(await store.run(input.run.id)).toBeUndefined();
    expect(await store.events(input.run.id)).toEqual([]);
    expect(
      (await handle.client.execute('SELECT run_ids FROM inbound_events')).rows[0]?.['run_ids'],
    ).toBe('[]');
    await handle.client.execute({
      sql: 'UPDATE webhook_receipts SET intent=? WHERE id=?',
      args: ['{"spoofedAuthority":true}', receipt.receipt.id],
    });
    await expect(admission.get(receipt.receipt.id)).rejects.toThrow(AdmissionConflictError);
    expect(await admission.get(fakeUlid('missing-receipt'))).toBeUndefined();
  });

  it('cannot remove a previously committed run through a later skip policy result', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const input = intent('prior-skip');
    const committed = await new SqliteTriggerAdmission(handle.db, events).create(input);
    const admission = new SqliteTriggerAdmission(handle.db, events, async (tx) => {
      expect(await tx.run(committed.id)).toBeDefined();
      return { action: 'skip' };
    });
    await expect(admission.create(input)).rejects.toThrow(AdmissionConflictError);
    expect((await store.run(committed.id))?.run).toEqual(committed);
    expect(await events.read(committed.id)).toHaveLength(1);
  });

  it('refuses a malformed first event before any policy can authorize the existing identity', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const input = intent('malformed-first-event');
    await new SqliteTriggerAdmission(handle.db, events).create(input);
    await handle.client.execute({
      sql: "UPDATE run_events SET type='node.finished', payload='{}' WHERE run_id=?",
      args: [input.run.id],
    });
    const admission = new SqliteTriggerAdmission(handle.db, events, async (tx) => {
      await tx.run(input.run.id);
      throw new Error('policy must not authorize malformed history');
    });
    await expect(admission.create(input)).rejects.toThrow(AdmissionConflictError);
    expect(await handle.db.select().from(runs)).toHaveLength(1);
    expect(await store.events(input.run.id)).toHaveLength(1);
  });

  it('serializes competing manual admissions across instances before either can become visible', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const first = intent('manual-first');
    const second = intent('manual-second');
    const notified: string[] = [];
    events.subscribe(first.run.id, (event) => notified.push(event.runId));
    events.subscribe(second.run.id, (event) => notified.push(event.runId));
    const admissions = await Promise.allSettled([
      new SqliteTriggerAdmission(handle.db, events, reserveSubject()).create(first),
      new SqliteTriggerAdmission(handle.db, events, reserveSubject()).create(second),
    ]);
    expect(admissions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = admissions.find((result) => result.status === 'rejected');
    expect(refused).toMatchObject({
      status: 'rejected',
      reason: { code: 'WEBHOOK_INTENT_CONFLICT' },
    });
    const rows = await store.subjectRuns({
      ownerId: 'local',
      repository: 'example/project',
      issue: 7,
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(await handle.db.select().from(runs)).toHaveLength(1);
    expect(await handle.db.select().from(runEvents)).toHaveLength(1);
    expect(notified).toEqual([rows[0]!.run.id]);
  });

  it('returns normal poll non-admission for a competing template subject with a distinct raw trigger key', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const first = intent('poll-first', 'poll');
    const second = intent('poll-second', 'poll');
    const notified: string[] = [];
    events.subscribe(first.run.id, (event) => notified.push(event.runId));
    events.subscribe(second.run.id, (event) => notified.push(event.runId));
    const results = await Promise.all([
      new SqliteTriggerAdmission(handle.db, events, reserveSubject()).createPollItem(first),
      new SqliteTriggerAdmission(handle.db, events, reserveSubject()).createPollItem(second),
    ]);
    const admitted = results.filter((run) => run !== undefined);
    expect(admitted).toHaveLength(1);
    expect(results.filter((run) => run === undefined)).toHaveLength(1);
    expect(await handle.db.select().from(runs)).toHaveLength(1);
    expect(await handle.db.select().from(runEvents)).toHaveLength(1);
    expect(notified).toEqual([admitted[0]!.id]);
  });

  it('rolls back the staged row, first event, and subject when policy refuses before commit', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const input = intent('refused');
    const notified: number[] = [];
    events.subscribe(input.run.id, (event) => notified.push(event.seq));
    const admission = new SqliteTriggerAdmission(
      handle.db,
      events,
      async (tx, authored, pollItem) => {
        expect(pollItem).toBe(false);
        expect((await tx.run(authored.run.id))?.run.lastEventSeq).toBe(1);
        expect((await tx.events(authored.run.id)).map((event) => event.type)).toEqual([
          'run.queued',
        ]);
        await tx.setSubject(authored.run.id, subject());
        throw new Error('trusted prerequisite refusal');
      },
    );
    await expect(admission.create(input)).rejects.toThrow('trusted prerequisite refusal');
    expect(await store.run(input.run.id)).toBeUndefined();
    expect(await store.events(input.run.id)).toEqual([]);
    expect(notified).toEqual([]);
  });

  it('revalidates the already committed identity without destroying it on later policy refusal', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const input = intent('prior');
    let allowed = true;
    let calls = 0;
    const admission = new SqliteTriggerAdmission(handle.db, events, async (tx, authored) => {
      calls++;
      if (!allowed) throw new Error('binding no longer ready');
      await tx.setSubject(authored.run.id, subject());
      return { action: 'keep' };
    });
    const admitted = await admission.create(input);
    allowed = false;
    await expect(admission.create(input)).rejects.toThrow('binding no longer ready');
    expect(calls).toBe(2);
    expect(await store.run(admitted.id)).toEqual({ run: admitted, subject: subject() });
    expect(await events.read(admitted.id)).toHaveLength(1);
  });

  it('rejects a changed invocation before the trusted policy can authorize it', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const input = intent('immutable');
    let calls = 0;
    const admission = new SqliteTriggerAdmission(handle.db, events, async (tx, authored) => {
      expect(await tx.run(authored.run.id)).toBeDefined();
      calls++;
      return { action: 'keep' };
    });
    const admitted = await admission.create(input);
    input.initialThread.invocation.trigger.payload = {
      spoofedSubject: { repository: 'other/project', issue: 99 },
    };
    await expect(admission.create(input)).rejects.toThrow(AdmissionConflictError);
    expect(calls).toBe(1);
    expect((await store.run(admitted.id))?.run).toEqual(admitted);
    expect(await events.read(admitted.id)).toHaveLength(1);
  });

  it('returns the one committed child after a crash before the parent child-started link, without candidate effects', async () => {
    const events = new SqliteEventStore(handle.db, new FakeClock());
    const parent = await insertSubject('recovery-parent', subject(), { status: 'running' });
    const originalInput = intent('original-committed-child', 'manual', { parentRunId: parent.id });
    const candidate = intent('candidate-child', 'manual', {
      parentRunId: parent.id,
      loopId: originalInput.run.loopId,
      versionId: originalInput.run.versionId,
    });
    const notified: string[] = [];
    events.subscribe(originalInput.run.id, (event) => notified.push(event.runId));
    events.subscribe(candidate.run.id, (event) => notified.push(event.runId));
    const admission = new SqliteTriggerAdmission(handle.db, events, async (tx, input) => {
      const original = await tx.originalChild(parent.id, 'work', 4);
      if (original) return { action: 'replace', run: original };
      await tx.setSubject(
        input.run.id,
        subject({ role: 'worker', parentRunId: parent.id, nodeId: 'work', visit: 4 }),
      );
      return { action: 'keep' };
    });
    const original = await admission.create(originalInput);
    await new SqliteRunRepository(handle.db).update(original.id, { status: 'running' });
    const recovered = await admission.create(candidate);
    expect(recovered).toEqual({ ...original, status: 'running' });
    expect(await store.originalChild(parent.id, 'work', 4)).toEqual(recovered);
    expect(await store.run(candidate.run.id)).toBeUndefined();
    expect(await store.events(candidate.run.id)).toEqual([]);
    expect(await events.read(parent.id)).toEqual([]);
    expect(notified).toEqual([original.id]);
    expect(await handle.db.select().from(runs)).toHaveLength(2);
  });

  it.each(['ownerId', 'loopId', 'versionId', 'parentRunId'] as const)(
    'refuses a replacement child with a different %s and rolls back the candidate',
    async (field) => {
      const events = new SqliteEventStore(handle.db, new FakeClock());
      const input = intent('replacement-mismatch', 'manual', { parentRunId: fakeUlid('parent') });
      const different = field === 'ownerId' ? 'other-owner' : fakeUlid('different-' + field);
      const admission = new SqliteTriggerAdmission(handle.db, events, async (tx) => {
        expect(await tx.run(input.run.id)).toBeDefined();
        return { action: 'replace', run: { ...input.run, [field]: different } };
      });
      await expect(admission.create(input)).rejects.toThrow(AdmissionConflictError);
      expect(await store.run(input.run.id)).toBeUndefined();
      expect(await store.events(input.run.id)).toEqual([]);
    },
  );
});

describe('SQLite template transition policy transaction', () => {
  it('runs policy inside the status transaction and rolls back subject changes on refusal', async () => {
    const failed = await insertSubject('resume-refused', subject(), { status: 'failed' });
    const repository = new SqliteRunRepository(handle.db, async (tx, current, changes) => {
      expect(current).toEqual(failed);
      expect(changes).toEqual({ status: 'queued' });
      expect((await tx.run(current.id))?.run.status).toBe('failed');
      await tx.setSubject(current.id, subject({ attempt: 99 }));
      throw new Error('unsafe consumed failure');
    });
    await expect(
      repository.transition(failed.id, ['failed'], { status: 'queued' }),
    ).rejects.toThrow('unsafe consumed failure');
    expect(await store.run(failed.id)).toEqual({ run: failed, subject: subject() });
  });

  it('allows only one of two competing resumes of the same failed identity', async () => {
    const failed = await insertSubject('same-identity', subject(), { status: 'failed' });
    const checked: string[] = [];
    const repository = new SqliteRunRepository(handle.db, async (tx, current) => {
      expect((await tx.run(current.id))?.run.status).toBe('failed');
      checked.push(current.id);
    });
    const results = await Promise.all([
      repository.transition(failed.id, ['failed'], { status: 'queued' }),
      repository.transition(failed.id, ['failed'], { status: 'queued' }),
    ]);
    expect(results.filter((run) => run !== undefined)).toHaveLength(1);
    expect(results.filter((run) => run === undefined)).toHaveLength(1);
    expect(checked).toEqual([failed.id]);
    expect((await store.run(failed.id))?.run.status).toBe('queued');
  });

  it('serializes different failed heads competing to resume one PR across instances', async () => {
    const review = subject({ kind: 'review', pullRequest: 3, head: 'a'.repeat(40) });
    const first = await insertSubject('resume-first', review, { status: 'failed' });
    const second = await insertSubject(
      'resume-second',
      { ...review, head: 'b'.repeat(40), instanceId: fakeUlid('instance-b') },
      { status: 'failed' },
    );
    const repository = new SqliteRunRepository(handle.db, async (tx, current) => {
      expect((await tx.run(current.id))?.run.status).toBe('failed');
    });
    const results = await Promise.allSettled([
      repository.transition(first.id, ['failed'], { status: 'queued' }),
      repository.transition(second.id, ['failed'], { status: 'queued' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rows = await store.subjectRuns({ ownerId: 'local', pullRequest: 3, limit: 10 });
    expect(rows.map(({ run }) => run.status).sort()).toEqual(['failed', 'queued']);
    expect(rows.map(({ run }) => run.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('does not invoke policy for a status mismatch, empty update, or absent run', async () => {
    const failed = await insertSubject('no-transition', subject(), { status: 'failed' });
    const repository = new SqliteRunRepository(handle.db, async (tx) => {
      await tx.events(failed.id);
      throw new Error('policy must not execute');
    });
    expect(
      await repository.transition(failed.id, ['running'], { status: 'queued' }),
    ).toBeUndefined();
    expect(await repository.transition(failed.id, ['failed'], {})).toEqual(failed);
    await expect(
      repository.transition(fakeUlid('absent-run'), ['failed'], { status: 'queued' }),
    ).rejects.toThrow('not found');
    expect(await store.run(failed.id)).toEqual({ run: failed, subject: subject() });
  });
});

describe('permanent QA issue-attempt ownership', () => {
  it.each([
    'queued',
    'running',
    'waiting',
    'paused',
    'succeeded',
    'failed',
    'cancelled',
    'exhausted',
  ] as const)(
    'rejects another merge or instance for the same issue attempt after %s',
    async (status) => {
      await insertSubject('qa-first', subject({ kind: 'qa', mergeSha: 'a'.repeat(40) }), {
        status,
      });
      await expect(
        insertSubject(
          'qa-second',
          subject({ kind: 'qa', mergeSha: 'b'.repeat(40), instanceId: fakeUlid('other-instance') }),
        ),
      ).rejects.toThrow();
      expect(
        await store.subjectRuns({
          ownerId: 'local',
          repository: 'example/project',
          issue: 7,
          limit: 10,
        }),
      ).toHaveLength(1);
    },
  );
  it('keeps distinct attempts, issues, repositories and owners independent', async () => {
    await insertSubject('qa-a', subject({ kind: 'qa', mergeSha: 'a'.repeat(40) }));
    await insertSubject(
      'qa-attempt',
      subject({ kind: 'qa', attempt: 2, mergeSha: 'b'.repeat(40) }),
    );
    await insertSubject('qa-issue', subject({ kind: 'qa', issue: 8, mergeSha: 'c'.repeat(40) }));
    await insertSubject(
      'qa-repository',
      subject({ kind: 'qa', repository: 'example/another', mergeSha: 'a'.repeat(40) }),
    );
    await insertSubject('qa-owner', subject({ kind: 'qa', mergeSha: 'a'.repeat(40) }), {
      ownerId: 'another',
    });
    await insertSubject('implementation', subject());
    expect(await handle.db.select().from(runs)).toHaveLength(6);
  });
});
