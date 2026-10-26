import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const parent = new URL('../../../../apps/api/package.json', import.meta.url);
const load = (name) => import(import.meta.resolve(name, parent));
const { LoopDefinitionSchema, CURRENT_DEFINITION_FORMAT: format } =
  await load('@graphgoblin/contracts');
const { RunManager, AdmissionConflictError } = await load('@graphgoblin/engine');
const { createFakePorts, DEFAULT_TEST_SETTINGS } = await load('@graphgoblin/engine/testing');
const {
  openDatabase,
  SqliteEventStore,
  SqliteRunRepository,
  SqliteLoopRepository,
  SqliteTriggerAdmission,
} = await load('@graphgoblin/infrastructure/sqlite');
const directory = await mkdtemp(join(tmpdir(), 'gg-qa-320-r2-admission-'));
const h = openDatabase({ url: `file:${join(directory, 'graphgoblin.db').replaceAll('\\', '/')}` });
const results = [];
const record = (name, expected, actual, pass) => {
  results.push({ ts: new Date().toISOString(), name, expected, actual, pass });
  if (!pass) process.exitCode = 1;
};
try {
  await h.migrate();
  const fake = createFakePorts(),
    events = new SqliteEventStore(h.db, fake.clock),
    runs = new SqliteRunRepository(h.db),
    loops = new SqliteLoopRepository(h.db, fake.clock, fake.ids);
  const admission = new SqliteTriggerAdmission(h.db, events);
  const manager = new RunManager(
    { ...fake, events, runs, loops, admission },
    DEFAULT_TEST_SETTINGS,
  );
  manager.stop();
  const start = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    done = { id: 'done', kind: 'exit', label: 'Done', config: {} };
  const publish = async (d) => {
    const { loop } = await loops.create('local', LoopDefinitionSchema.parse(d));
    await loops.publish(loop.id);
    return loop.id;
  };
  const leafId = await publish({
    schemaVersion: format,
    name: 'R2 admission leaf',
    nodes: [start, done],
    edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  });
  const topId = await publish({
    schemaVersion: format,
    name: 'R2 admission parent',
    nodes: [
      start,
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: leafId } } },
      done,
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ],
  });
  const control = await manager.startRun({ ownerId: 'local', loopId: topId, source: 'manual.api' });
  const controlLog = await events.read(control.id);
  record(
    'unparented control',
    'queued root admission succeeds with one queued event',
    { run: await runs.get(control.id), events: controlLog },
    control.status === 'queued' && controlLog.length === 1,
  );
  const child = await manager.startRun({
    ownerId: 'local',
    loopId: leafId,
    source: 'subloop',
    parentRunId: control.id,
    parentNodeId: 'sub',
    caller: { kind: 'run', id: control.id },
  });
  const links = await events.read(control.id),
    childLog = await events.read(child.id),
    initial = await runs.getInitialThread(child.id);
  record(
    'well-formed child',
    'child and parent child_run.started committed together',
    { child: await runs.get(child.id), parentEvents: links, childEvents: childLog },
    links.filter(
      (e) => e.type === 'child_run.started' && e.childRunId === child.id && e.nodeId === 'sub',
    ).length === 1 && childLog.length === 1,
  );
  const { runId: _id, seq: _seq, ts: _ts, ...queued } = childLog[0];
  const frozen = {
    run: { ...child, lastEventSeq: 0 },
    initialThread: initial,
    queued,
    pinnedLoopIds: [child.loopId],
    parentNodeId: 'sub',
  };
  await admission.create(structuredClone(frozen));
  record(
    'identical admission acknowledgement lost',
    'same child, no extra events or parent link',
    { parentEvents: await events.read(control.id), childEvents: await events.read(child.id) },
    (await events.read(control.id)).length === links.length &&
      (await events.read(child.id)).length === 1,
  );
  const negativeCases = [
    { name: 'missing-parent-with-node', parentRunId: fake.ids.next(), parentNodeId: 'sub' },
    { name: 'missing-parent-without-node', parentRunId: fake.ids.next() },
    { name: 'existing-parent-without-node', parentRunId: control.id },
    { name: 'node-without-parent', parentNodeId: 'sub' },
  ];
  for (const c of negativeCases) {
    const input = structuredClone(frozen);
    input.run.id = fake.ids.next();
    input.run.invocationId = fake.ids.next();
    input.initialThread.run.id = input.run.id;
    input.initialThread.invocation.id = input.run.invocationId;
    delete input.run.parentRunId;
    delete input.initialThread.run.parentRunId;
    delete input.parentNodeId;
    if (c.parentRunId) {
      input.run.parentRunId = c.parentRunId;
      input.initialThread.run.parentRunId = c.parentRunId;
    }
    if (c.parentNodeId) input.parentNodeId = c.parentNodeId;
    input.queued.initialThread = input.initialThread;
    let failure;
    try {
      await admission.create(input);
    } catch (error) {
      failure = {
        isAdmissionConflict: error instanceof AdmissionConflictError,
        code: error.code,
        name: error.name,
      };
    }
    const childRow = await runs.get(input.run.id),
      log = await events.read(input.run.id);
    record(
      c.name,
      'AdmissionConflictError; no child row or events; parent log unchanged',
      {
        failure: failure ?? null,
        childExists: Boolean(childRow),
        childEvents: log,
        parentEvents: await events.read(control.id),
      },
      failure?.isAdmissionConflict === true &&
        !childRow &&
        log.length === 0 &&
        (await events.read(control.id)).length === links.length,
    );
  }
  let wrong;
  try {
    await admission.create({ ...structuredClone(frozen), parentNodeId: 'other' });
  } catch (error) {
    wrong = error instanceof AdmissionConflictError;
  }
  record(
    'repeat child with different parent node',
    'refused, existing child and link unchanged',
    {
      refused: wrong,
      parentEvents: await events.read(control.id),
      childEvents: await events.read(child.id),
    },
    wrong === true &&
      (await events.read(control.id)).length === links.length &&
      (await events.read(child.id)).length === 1,
  );
  const query = `SELECT c.id,c.parent_run_id FROM runs c WHERE c.parent_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.run_id=c.parent_run_id AND e.type='child_run.started' AND json_extract(e.payload,'$.childRunId')=c.id)`;
  const gaps = (await h.client.execute(query)).rows;
  record(
    'final orphan query',
    'zero orphan children, only root and legitimate child',
    {
      query,
      gaps,
      runs: (await h.client.execute('SELECT id,parent_run_id,last_event_seq FROM runs')).rows,
    },
    gaps.length === 0 && (await h.client.execute('SELECT id FROM runs')).rows.length === 2,
  );
} catch (error) {
  record('unexpected harness failure', 'none', { message: error.message }, false);
} finally {
  h.close();
  globalThis.gc?.();
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
      results.map(({ name, pass, cleanup, removed, actual }) => ({
        name,
        pass,
        cleanup,
        removed,
        ...(actual?.failure ? { failure: actual.failure } : {}),
      })),
      null,
      2,
    ),
  );
}
