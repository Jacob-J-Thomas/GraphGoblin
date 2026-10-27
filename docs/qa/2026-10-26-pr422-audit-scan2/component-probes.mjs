import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const built = (path) => import(pathToFileURL(resolve(path)).href);
const { createContainer, buildApp, loadConfig } = await built('apps/api/dist/index.js');
const { RunManager } = await built('packages/engine/dist/index.js');
const { createTestEngine, singleNodeLoop } = await built('packages/engine/dist/testing/index.js');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Probe state deadline exceeded');
    await pause(10);
  }
}

// Supported component ports: no private manager access or modification.
const complete = {
  state: 'completed', exitCode: 0, stdout: 'null', stderr: '', stdoutBytes: 4,
  stderrBytes: 0, stdoutOverflow: false, stderrOverflow: false, timedOut: false,
};
const e = await createTestEngine();
e.manager.stop();
let dispatches = 0;
e.ports.scripts.respondWith(() => {
  dispatches++;
  return dispatches === 1 || dispatches === 3
    ? { ...complete, state: 'outcome-uncertain', exitCode: null }
    : complete;
});
const childDefinition = singleNodeLoop('audit child', {
  id: 'a', label: 'A', kind: 'script', config: { command: 'a' },
});
childDefinition.nodes.splice(2, 0, { id: 'b', label: 'B', kind: 'script', config: { command: 'b' } });
childDefinition.edges = [
  { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
  { id: 'b', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
  { id: 'c', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
];
const childVersion = e.publish(childDefinition);
const parentVersion = e.publish(singleNodeLoop('audit parent', {
  id: 'sub', label: 'Child', kind: 'subloop', config: { loopRef: { loopId: childVersion.loopId } },
}));
let parentId;
let armed = false;
let blocked = false;
let release;
const gate = new Promise((resolve) => { release = resolve; });
const events = {
  append: (...args) => e.ports.events.append(...args),
  subscribe: (...args) => e.ports.events.subscribe(...args),
  read: async (...args) => {
    const history = await e.ports.events.read(...args);
    if (armed && !blocked && args[0] === parentId && history.some((event) => event.type === 'run.resumed')) {
      blocked = true;
      await gate;
    }
    return history;
  },
};
const manager = new RunManager({ ...e.ports, events }, e.settings);
try {
  await manager.start();
  const parent = await manager.startRun({ ownerId: 'local', loopId: parentVersion.loopId, source: 'manual.api' });
  parentId = parent.id;
  await manager.waitForIdle();
  const failedParent = await manager.getRun(parent.id);
  const childId = failedParent.failure.details.childRunId;
  assert.equal((await manager.getRun(childId)).failure.nodeId, 'a');
  const parentObservation = await manager.getRecovery(parentId);
  assert.equal(parentObservation.resume.code, 'SCRIPT_CONSENT_REQUIRED');
  armed = true;
  await manager.resume(parentId, { kind: 'user', id: 'parent-tab' }, {
    observedSeq: parentObservation.observedSeq, retryUncertainScript: true,
  });
  await until(() => blocked);
  const childObservation = await manager.getRecovery(childId);
  assert.equal(childObservation.resume.code, 'SCRIPT_CONSENT_REQUIRED');
  await manager.resume(childId, { kind: 'user', id: 'child-tab' }, {
    observedSeq: childObservation.observedSeq, retryUncertainScript: true,
  });
  await until(async () => (await manager.getRun(childId)).failure?.nodeId === 'b');
  const beforeRelease = { dispatches, failure: (await manager.getRun(childId)).failure.nodeId };
  release();
  await manager.waitForIdle();
  console.log(JSON.stringify({
    scenario: 'parent consent followed by independent child recovery during parent scheduling',
    beforeRelease, afterRelease: { dispatches, childStatus: (await manager.getRun(childId)).status,
      parentStatus: (await manager.getRun(parentId)).status },
    resumedActors: e.events(childId).filter((event) => event.type === 'run.resumed').map(({ actor, retryUncertainScript }) => ({ actor, retryUncertainScript })),
  }));
} finally { release(); manager.stop(); }

const dataDir = await mkdtemp(join(tmpdir(), 'gg-audit-422-snapshot-'));
const base = await createContainer(loadConfig({
  GG_DATA_DIR: dataDir, GG_SWAGGER_UI: 'false', GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
}), { startTimers: false });
await base.start();
base.manager.stop();
let reads = [];
let measureRows = true;
const measuredEvents = {
  append: (...args) => base.ports.events.append(...args),
  subscribe: (...args) => base.ports.events.subscribe(...args),
  read: async (...args) => {
    const rows = await base.ports.events.read(...args);
    if (measureRows) reads.push({ after: args[1] ?? null, rows: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows)) });
    return rows;
  },
};
const measured = new RunManager({ ...base.ports, events: measuredEvents }, base.settings);
const app = await buildApp({ ...base, manager: measured }, { logger: false });
try {
  await measured.start();
  const definition = singleNodeLoop('audit long history', { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'signal', name: 'go' } });
  const created = await app.inject({ method: 'POST', url: '/loops', payload: { definition } });
  assert.equal(created.statusCode, 201, created.body);
  const loopId = created.json().loop.id;
  assert.equal((await app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode, 200);
  const started = await measured.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
  await measured.waitForIdle();
  for (const count of [0, 1000, 10000]) {
    if (count) {
      for (let i = 0; i < count; i += 100) await base.ports.events.append(started.id,
        Array.from({ length: Math.min(100, count - i) }, () => ({ type: 'signal.received', name: 'unrelated', payload: 'x'.repeat(1024) })));
    }
    reads = [];
    measureRows = true;
    const began = performance.now();
    const response = await app.inject(`/runs/${started.id}`);
    assert.equal(response.statusCode, 200, response.body);
    const durationMs = performance.now() - began;
    const snapshotReads = reads;
    measureRows = false;
    const rawBegan = performance.now();
    assert.equal((await app.inject(`/runs/${started.id}`)).statusCode, 200);
    const uninstrumentedDurationMs = performance.now() - rawBegan;
    reads = [];
    measureRows = true;
    const rowBegan = performance.now();
    await measured.getRun(started.id);
    console.log(JSON.stringify({ scenario: 'snapshot history cost', addedEvents: count, durationMs, uninstrumentedDurationMs,
      snapshotReads, oldGetRunMs: performance.now() - rowBegan, oldGetRunHistoryReads: reads.length }));
  }
} finally { measured.stop(); await app.close(); await base.dispose(); }
