import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';

const root = new URL('./', import.meta.url);
const fingerprint = '38797520d0408da14831a7b101981b343721af0676027587188855a4b36e1b10';
const save = (name, data) => writeFile(new URL(name, root), JSON.stringify(data, null, 2) + '\n');

async function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port: 62241, method, path,
      signal: AbortSignal.timeout(4000), agent: false,
      headers: bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes) } }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) res.destroy(new Error('response exceeds evidence bound'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()), headers: res.headers }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(bytes);
  });
}

const health = await api('GET', '/healthz');
assert.equal(health.status, 200);
assert.equal(health.headers['x-graphgoblin-instance'], fingerprint);
assert.equal(health.headers['x-graphgoblin-phase'], 'running');
const mode = process.argv[2];

if (mode === 'create') {
  const definition = {
    schemaVersion: 4, name: 'QA browser close resume08 20261117T0452 fde14a78',
    description: 'Authorized provider-free GUI continuity QA. Manual trigger, 1800-second timer, quiet exit.',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', ui: { x: 0, y: 0 }, config: { type: 'manual', exposeTo: ['ui', 'api', 'mcp'] } },
      { id: 'pause', kind: 'wait', label: 'Pause', ui: { x: 260, y: 0 }, config: { mode: 'duration', seconds: 1800 } },
      { id: 'done', kind: 'exit', label: 'Done', ui: { x: 520, y: 0 }, config: { outcome: 'success', returns: 'none', destinations: [] } }
    ],
    edges: [
      { id: 'start-pause', from: { node: 'start', port: 'out' }, to: { node: 'pause', port: 'in' } },
      { id: 'pause-done', from: { node: 'pause', port: 'out' }, to: { node: 'done', port: 'in' } }
    ]
  };
  const created = await api('POST', '/loops', { definition });
  await save('03-loop-created.json', { at: new Date().toISOString(), status: created.status, body: created.body });
  assert.equal(created.status, 201);
  const { loop, draft } = created.body;
  assert.equal(loop.id, draft.loopId);
  assert.equal(loop.draftVersionId, draft.id);
  const owned = { loopId: loop.id, draftId: draft.id, name: definition.name, seconds: 1800 };
  await save('test-owned.json', owned);
  const started = await api('POST', `/loops/${loop.id}/runs`, { versionId: draft.id, allowDraft: true });
  await save('03-run-started.json', { at: new Date().toISOString(), status: started.status, body: started.body });
  assert.equal(started.status, 202);
  assert.equal(started.body.run.loopId, loop.id);
  assert.equal(started.body.run.pinned.source, 'draft');
  assert.notEqual(started.body.run.versionId, draft.id);
  Object.assign(owned, { runId: started.body.run.id, snapshotId: started.body.run.versionId, pinned: started.body.run.pinned });
  await save('test-owned.json', owned);
  console.log(JSON.stringify(owned));
} else {
  const owned = JSON.parse(await readFile(new URL('test-owned.json', root), 'utf8'));
  const run = await api('GET', `/runs/${owned.runId}`);
  assert.equal(run.status, 200);
  assert.equal(run.body.id, owned.runId);
  assert.equal(run.body.loopId, owned.loopId);
  assert.equal(run.body.versionId, owned.snapshotId);
  assert.deepEqual(run.body.pinned, owned.pinned);
  if (mode === 'cancel') {
    const cancelled = await api('POST', `/runs/${owned.runId}/cancel`, {});
    await save('06-cancel-response.json', { at: new Date().toISOString(), status: cancelled.status, body: cancelled.body });
    assert.ok([200, 202].includes(cancelled.status));
    let final;
    for (let n = 0; n < 15; n++) {
      final = await api('GET', `/runs/${owned.runId}`);
      if (final.body.status === 'cancelled') break;
      await pause(500);
    }
    assert.equal(final.body.status, 'cancelled');
    assert.equal(final.body.versionId, owned.snapshotId);
    await save('06-cancelled-run.json', { at: new Date().toISOString(), status: final.status, body: final.body });
    console.log(JSON.stringify({ runId: owned.runId, status: final.body.status, snapshotId: final.body.versionId }));
  } else {
    assert.equal(mode, 'observe');
    const label = process.argv[3];
    assert.match(label, /^[a-z0-9-]+$/);
    const observation = { at: new Date().toISOString(), health: { pid: health.headers['x-graphgoblin-pid'], instance: health.headers['x-graphgoblin-instance'] }, status: run.status, body: run.body };
    await save(label + '.json', observation);
    console.log(JSON.stringify({ at: observation.at, runId: owned.runId, status: run.body.status, waiting: run.body.waiting, snapshotId: run.body.versionId, pid: observation.health.pid }));
  }
}
