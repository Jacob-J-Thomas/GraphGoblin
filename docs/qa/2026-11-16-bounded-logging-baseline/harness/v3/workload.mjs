import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const authCanary = 'qa438-private-authorization-9d205789';
export const queryCanary = 'qa438-private-query-2e5eb985';

export async function request(port, path, options) {
  assert(Number.isInteger(port) && port > 0 && port < 65536 && ![4747, 4748].includes(port));
  assert(path.startsWith('/') && !path.startsWith('//'));
  return fetch('http://127.0.0.1:' + port + path,
    { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
}

export async function healthy(port, path = '/healthz') {
  const response = await request(port, path);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  const rawPid = response.headers.get('x-graphgoblin-pid');
  assert.match(rawPid ?? '', /^[1-9][0-9]*$/u);
  const identity = response.headers.get('x-graphgoblin-instance');
  assert.match(identity ?? '', /^[a-f0-9]{64}$/u);
  return { pid: Number(rawPid), identity, phase: response.headers.get('x-graphgoblin-phase') };
}

export async function invalidAuthorization(port) {
  const path = '/healthz?qa=invalid-authorization-probe';
  const response = await request(port, path, { headers: { authorization: 'Bearer ' + authCanary } });
  return {
    path, sentInvalidAuthorization: true, status: response.status,
    contentType: response.headers.get('content-type'), body: await response.text(),
  };
}

async function json(port, path, status, body) {
  const response = await request(port, path, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.status, status, path + ': ' + await response.clone().text());
  return response.json();
}

export async function startWork({ port, directory, node, definitionFormat, observe }, register) {
  const release = join(directory, 'release');
  const marker = join(directory, 'script-pid.json');
  // This real Script node exits independently if the harness disappears.
  const script = [
    "const fs = require('node:fs')",
    `fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid}), {flag:'wx'})`,
    `setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) process.exit(0) }, 100)`,
    'setTimeout(() => process.exit(3), 300000)',
  ].join(';\n');
  const definition = {
    schemaVersion: definitionFormat, name: 'Independent #438 held work',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'hold', kind: 'script', label: 'Hold work',
        config: { command: node, args: ['-e', script], timeoutSeconds: 310,
          stdin: 'none', stdout: 'ignore' } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'hold' } },
      { id: 'e2', from: { node: 'hold', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const { loop: { id: loopId } } = await json(port, '/loops', 201, { definition });
  assert.equal((await request(port, '/loops/' + loopId + '/publish', { method: 'POST' })).status, 200);
  const { run: { id } } = await json(port, '/loops/' + loopId + '/runs', 202, {});
  const state = { loopId, runId: id, release, marker };
  register(state);
  state.scriptPid = (await observe('owned Script node PID marker', async () => {
    try { return JSON.parse(await readFile(marker, 'utf8')); } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }, 20_000)).pid;
  assert(Number.isSafeInteger(state.scriptPid) && state.scriptPid > 0);
  assert.equal((await workState(port, state)).status, 'running');
  return state;
}

export async function workState(port, state) {
  return json(port, '/runs/' + state.runId, 200);
}

export async function releaseWork(state) {
  try { await writeFile(state.release, 'release\n', { flag: 'wx' }); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

export async function traffic(port, expected, count, workers, start) {
  const workerResults = await Promise.allSettled(Array.from({ length: workers }, async (_, offset) => {
    for (let index = offset; index < count; index += workers) {
      const stamp = start + index;
      const current = await healthy(port, '/healthz?token=' + queryCanary + '&qa=' + stamp + '-' + 'x'.repeat(900));
      assert.deepEqual(current, expected, 'Serving PID, identity or phase changed during pressure');
    }
  }));
  for (const entry of workerResults) if (entry.status === 'rejected') throw entry.reason;
}
