import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
const parent = new URL('../../../apps/api/package.json', import.meta.url);
const load = (name) => import(import.meta.resolve(name, parent));
const { LoopDefinitionSchema, CURRENT_DEFINITION_FORMAT } = await load('@graphgoblin/contracts');
const { RunManager } = await load('@graphgoblin/engine');
const { createFakePorts, DEFAULT_TEST_SETTINGS } = await load('@graphgoblin/engine/testing');
const {
  openDatabase,
  SqliteEventStore,
  SqliteRunRepository,
  SqliteLoopRepository,
  SqliteTriggerAdmission,
} = await load('@graphgoblin/infrastructure/sqlite');
const directory = await mkdtemp(join(tmpdir(), 'gg-qa-320-'));
const h = openDatabase({ url: `file:${join(directory, 'graphgoblin.db').replaceAll('\\', '/')}` });
const results = [];
try {
  await h.migrate();
  const fake = createFakePorts();
  const events = new SqliteEventStore(h.db, fake.clock),
    runs = new SqliteRunRepository(h.db);
  const loops = new SqliteLoopRepository(h.db, fake.clock, fake.ids);
  const admission = new SqliteTriggerAdmission(h.db, events);
  const manager = new RunManager(
    { ...fake, events, runs, loops, admission },
    DEFAULT_TEST_SETTINGS,
  );
  manager.stop();
  const { loop } = await loops.create(
    'local',
    LoopDefinitionSchema.parse({
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'QA orphan admission control',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    }),
  );
  await loops.publish(loop.id);
  const control = await manager.startRun({
    ownerId: 'local',
    loopId: loop.id,
    source: 'manual.api',
  });
  const initial = await runs.getInitialThread(control.id);
  const { runId: _runId, seq: _seq, ts: _ts, ...queued } = (await events.read(control.id))[0];
  for (const withNode of [true, false]) {
    const run = {
      ...control,
      id: fake.ids.next(),
      parentRunId: fake.ids.next(),
      invocationId: fake.ids.next(),
      lastEventSeq: 0,
    };
    const thread = structuredClone(initial);
    thread.run.id = run.id;
    thread.run.parentRunId = run.parentRunId;
    thread.invocation.id = run.invocationId;
    thread.invocation.source = 'subloop';
    const input = {
      run,
      initialThread: thread,
      queued: { ...queued, initialThread: thread },
      pinnedLoopIds: [run.loopId],
      ...(withNode ? { parentNodeId: 'sub' } : {}),
    };
    const result = {
      ts: new Date().toISOString(),
      withParentNodeId: withNode,
      expected: 'refused, no child row or queued event',
    };
    try {
      await admission.create(input);
      result.actual = 'admitted';
    } catch (error) {
      result.actual = 'refused';
      result.code = error.code;
      result.message = error.message;
    }
    result.childExists = Boolean(await runs.get(run.id));
    result.parentExists = Boolean(await runs.get(run.parentRunId));
    result.childEvents = await events.read(run.id);
    result.pass = result.actual === 'refused' && !result.childExists;
    results.push(result);
  }
  results.push({
    ts: new Date().toISOString(),
    query: 'child rows without a matching parent link',
    rows: (
      await h.client
        .execute(`SELECT c.id,c.parent_run_id FROM runs c WHERE c.parent_run_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.run_id=c.parent_run_id AND e.type='child_run.started'
      AND json_extract(e.payload,'$.childRunId')=c.id)`)
    ).rows,
  });
  if (results.some((r) => r.pass === false)) process.exitCode = 1;
} finally {
  h.close();
  assert.ok(
    resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
      directory.split(sep).at(-1).startsWith('gg-qa-320-'),
  );
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    results.push({ cleanup: directory.split(sep).at(-1), removed: true });
  } catch (error) {
    results.push({ cleanup: directory.split(sep).at(-1), removed: false, code: error.code });
    process.exitCode = 1;
  }
  await writeFile(
    new URL('admission-negative.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      results.map(({ childEvents, ...r }) => r),
      null,
      2,
    ),
  );
}
