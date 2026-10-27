import { RESOURCE_OWNERSHIP_REWIND_SQL } from './testing/resource-ownership.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RunStatusSchema, type RunRecord, type RunStatus } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteDeletionEligibility } from './deletion-eligibility.js';
import { SqliteEventStore } from './events.js';
import { FakeClock } from '@graphgoblin/engine/testing';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';

let handle: DatabaseHandle;
let runs: SqliteRunRepository;
let eligibility: SqliteDeletionEligibility;
const approval = {
  confirmedAt: FIXTURE_TS,
  confirmedBy: { ownerId: 'local', kind: 'user', id: 'owner' },
};
beforeEach(async () => {
  handle = await openMemoryDatabase();
  runs = new SqliteRunRepository(handle.db);
  eligibility = new SqliteDeletionEligibility(handle.db);
});
afterEach(() => handle.close());

async function seed(
  name: string,
  status: RunStatus = 'succeeded',
  refs: { parentRunId?: string; replay?: string; ownerId?: string } = {},
) {
  const run: RunRecord = {
    id: fakeUlid(name),
    ownerId: refs.ownerId ?? 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    invocationId: fakeUlid(name + '-inv'),
    pinned: samplePin(),
    status,
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
    ...(refs.parentRunId ? { parentRunId: refs.parentRunId } : {}),
  };
  const thread = sampleThread();
  if (refs.replay) thread.invocation.replayOf = { runId: refs.replay, nodeId: 'start' };
  await runs.create(run, thread);
  await runs.markFinalized(run.id);
  return run.id;
}
async function mark(runIds: string[]) {
  const preview = await eligibility.preview('local', runIds);
  return eligibility.confirm(
    'local',
    { runIds, token: preview.token, action: 'mark', confirmed: true },
    approval,
  );
}

it.each(RunStatusSchema.options)(
  'uses the same explicit consent rule for %s; nonterminal runs remain protected',
  async (status) => {
    const id = await seed(status, status);
    expect((await runs.get(id))?.deletionApproval).toBeUndefined();
    const result = await mark([id]);
    const terminal = ['succeeded', 'failed', 'cancelled', 'exhausted'].includes(status);
    expect(result.conflict).toBe(terminal ? null : 'protected');
    expect((await runs.get(id))?.deletionApproval).toEqual(terminal ? approval : undefined);
  },
);

it('requires finalization, rejects invalid/missing selections, and validates the public component input', async () => {
  const id = await seed('unfinished');
  await runs.clearFinalized(id);
  expect((await mark([id])).items[0]?.reasons).toContain('Run finalization is incomplete.');
  const missing = fakeUlid('absent');
  expect((await mark([missing])).conflict).toBe('missing');
  expect(() => eligibility.preview('local', [])).toThrow();
  expect(() => eligibility.preview('local', [id, id])).toThrow();
  const preview = await eligibility.preview('local', [id]);
  await expect(
    eligibility.confirm(
      'local',
      { runIds: [], token: preview.token, action: 'mark', confirmed: true },
      approval,
    ),
  ).rejects.toThrow();
});

it('protects the dependency component, including replay, dangling and foreign references; withdrawal retains the whole component', async () => {
  const parent = await seed('parent');
  const child = await seed('child', 'succeeded', { parentRunId: parent });
  const fork = await seed('replay', 'failed', { replay: child });
  expect((await mark([parent])).conflict).toBe('protected');
  expect((await mark([child, fork])).items[0]?.reasons.join(' ')).toContain(parent);
  const ids = [parent, child, fork];
  expect((await mark(ids)).conflict).toBeNull();
  expect((await eligibility.preview('local', [child])).items[0]?.approval).toEqual(approval);
  expect((await mark([child])).conflict).toBeNull();
  const preview = await eligibility.preview('local', [fork]);
  expect(
    (
      await eligibility.confirm(
        'local',
        { runIds: [fork], action: 'withdraw', confirmed: true, token: preview.token },
        approval,
      )
    ).conflict,
  ).toBeNull();
  for (const id of ids) expect((await runs.get(id))?.deletionApproval).toBeUndefined();
  const orphan = await seed('dangling', 'failed', { parentRunId: fakeUlid('missing-parent') });
  expect((await mark([orphan])).conflict).toBe('protected');
  const foreign = await seed('foreign', 'succeeded', { ownerId: 'other' });
  const linked = await seed('linked', 'succeeded', { parentRunId: foreign });
  expect((await mark([linked])).conflict).toBe('protected');
  expect((await mark([foreign])).conflict).toBe('missing');
});

it('invalidates approval on resume, child and replay admission, dependency changes, and event/finalization changes', async () => {
  const parent = await seed('parent');
  expect((await mark([parent])).conflict).toBeNull();
  expect(
    (await runs.transition(parent, ['succeeded'], { status: 'queued' }))?.deletionApproval,
  ).toBeUndefined();
  expect((await runs.get(parent))?.deletionApproval).toBeUndefined();
  await runs.update(parent, { status: 'failed' });
  expect((await mark([parent])).conflict).toBeNull();
  const child = await seed('child', 'succeeded', { parentRunId: parent });
  expect((await runs.get(parent))?.deletionApproval).toBeUndefined();
  expect((await mark([parent, child])).conflict).toBeNull();
  const replay = await seed('replay', 'succeeded', { replay: child });
  expect((await runs.get(child))?.deletionApproval).toBeUndefined();
  expect((await mark([parent, child, replay])).conflict).toBeNull();
  await runs.update(child, { parentRunId: undefined });
  expect((await runs.get(parent))?.deletionApproval).toBeUndefined();
  expect((await runs.get(replay))?.deletionApproval).toBeUndefined();
  expect((await mark([parent])).conflict).toBeNull();
  await runs.update(parent, { lastEventSeq: 1 });
  expect((await runs.get(parent))?.deletionApproval).toBeUndefined();
  expect((await mark([parent])).conflict).toBeNull();
  await runs.clearFinalized(parent);
  expect((await runs.get(parent))?.deletionApproval).toBeUndefined();
});

it('rejects stale confirmations including an approval/withdrawal cycle with the same clock and status', async () => {
  const id = await seed('run');
  const old = await eligibility.preview('local', [id]);
  expect((await mark([id])).conflict).toBeNull();
  const marked = await eligibility.preview('local', [id]);
  await eligibility.confirm(
    'local',
    { runIds: [id], token: marked.token, action: 'withdraw', confirmed: true },
    approval,
  );
  expect(
    (
      await eligibility.confirm(
        'local',
        { runIds: [id], token: old.token, action: 'mark', confirmed: true },
        approval,
      )
    ).conflict,
  ).toBe('stale');
});

it('leaves unrelated approvals and preview tokens unchanged during ordinary event appends', async () => {
  const approved = await seed('approved');
  expect((await mark([approved])).conflict).toBeNull();
  const preview = await eligibility.preview('local', [approved]);
  const parent = await seed('active-parent', 'running');
  const child = await seed('active-child', 'running', { parentRunId: parent });
  const events = new SqliteEventStore(handle.db, new FakeClock());
  for (let i = 0; i < 20; i++)
    await events.append(child, [{ type: 'run.resumed', actor: { kind: 'user', id: 'owner' } }]);
  expect(await events.read(child)).toHaveLength(20);
  expect((await runs.get(child))?.lastEventSeq).toBe(20);
  expect(await eligibility.preview('local', [approved])).toEqual(preview);
});

it('preserves whole-component approval on unrelated metadata and no-op updates, then revokes on member Resume', async () => {
  const parent = await seed('parent');
  const child = await seed('child', 'succeeded', { parentRunId: parent });
  expect((await mark([parent, child])).conflict).toBeNull();
  await runs.update(child, { status: 'succeeded', parentRunId: parent, lastEventSeq: 0 });
  await runs.update(child, { outcome: 'success' });
  for (const id of [parent, child])
    expect((await runs.get(id))?.deletionApproval).toEqual(approval);
  await runs.transition(child, ['succeeded'], { status: 'queued' });
  for (const id of [parent, child]) expect((await runs.get(id))?.deletionApproval).toBeUndefined();
});

it('indexes replay provenance and revokes both former and new components on a relationship edit', async () => {
  const source = await seed('source');
  const fork = await seed('fork', 'failed', { replay: source });
  const other = await seed('other');
  expect((await mark([source, fork, other])).conflict).toBeNull();
  const thread = sampleThread();
  thread.invocation.replayOf = { runId: other, nodeId: 'start' };
  await handle.client.execute({
    sql: 'UPDATE runs SET initial_thread = ? WHERE id = ?',
    args: [JSON.stringify(thread), fork],
  });
  const indexed = await handle.client.execute({
    sql: 'SELECT replay_source_run_id FROM runs WHERE id = ?',
    args: [fork],
  });
  expect(indexed.rows[0]?.['replay_source_run_id']).toBe(other);
  for (const id of [source, fork, other])
    expect((await runs.get(id))?.deletionApproval).toBeUndefined();
  expect((await mark([source])).conflict).toBeNull();
  expect((await mark([fork])).conflict).toBe('protected');
  expect((await mark([fork, other])).conflict).toBeNull();
});

it('backfills indexed replay provenance from existing threads in the shipped migration', async () => {
  const source = await seed('old-source');
  const fork = await seed('old-fork', 'failed', { replay: source });
  for (const statement of [
    'DROP INDEX run_events_reached_idx',
    'DROP INDEX runs_replay_intent_idx',
    'ALTER TABLE runs DROP COLUMN replay_intent_observed_seq',
    'ALTER TABLE runs DROP COLUMN replay_intent_node_id',
    ...RESOURCE_OWNERSHIP_REWIND_SQL,
    'DROP TRIGGER runs_deletion_activity',
    'DROP TRIGGER runs_deletion_relationship',
    'DROP TRIGGER runs_replay_source_update',
    'DROP TRIGGER runs_deletion_dependency_insert',
    'DROP TRIGGER runs_deletion_revision',
    'DROP INDEX runs_replay_source_idx',
    'DROP INDEX runs_deletion_approval_idx',
    'ALTER TABLE runs DROP COLUMN replay_source_run_id',
    'ALTER TABLE runs DROP COLUMN deletion_approval',
    'ALTER TABLE runs DROP COLUMN deletion_revision',
  ])
    await handle.client.execute(statement);
  const shipped = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  const first = shipped.findIndex((entry) =>
    entry.sql.some((statement) => statement.includes('ADD `deletion_approval`')),
  );
  expect(first).toBeGreaterThanOrEqual(0);
  // Restore the whole suffix, including ownership and observed intents, in shipped order.
  for (const entry of shipped.slice(first))
    for (const statement of entry.sql) await handle.client.execute(statement);
  expect((await mark([source])).conflict).toBe('protected');
  expect((await mark([source, fork])).conflict).toBeNull();
  await runs.transition(fork, ['failed'], { status: 'queued' });
  expect((await runs.get(source))?.deletionApproval).toBeUndefined();
});
