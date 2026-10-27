import { assertRetained } from './r3-store-fixture.mjs';
// Measures how long the API takes to start listening when the startup storage pass has
// approved workspaces to reclaim under pressure, against the same store under adequate storage.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, temp, join, here, Evidence } from './r3-qa-lib.mjs';

const ev = new Evidence('r3-startup-latency');
const base = fs.mkdtempSync(join(temp, 'gg-wp-e3-r3-startup-'));
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const logFile = join(base, 'server.log.txt');
const PORT = 6353;
setCapacity(capacityFile, ADEQUATE);
const loop = {
  schemaVersion: 4,
  name: 'Startup work',
  settings: { workingDirectory: { kind: 'temp' } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'files', kind: 'script', label: 'Files', config: { command: process.execPath, args: ['-e', "const fs=require('fs');for(let i=0;i<1900;i++)fs.writeFileSync('f'+i+'.bin','x'.repeat(100))"], cwd: 'workspace', stdin: 'none' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'files', port: 'in' } },
    { id: 'e2', from: { node: 'files', port: 'out' }, to: { node: 'done', port: 'in' } },
  ],
};
async function timeToReady() {
  const t0 = Date.now();
  const child = spawn(process.execPath, [join(here, 'r3-qa-server.mjs'), dataDir, String(PORT), capacityFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, QA_LOG_LEVEL: 'warn', QA_SEED_RETAINED: '1000' } });
  let buffer = '';
  let passAt;
  await new Promise((res) => {
    const on = (c) => {
      buffer += String(c);
      if (!passAt && /QA_CAPACITY_READ/.test(buffer)) passAt = Date.now();
      if (/QA_READY/.test(buffer)) res();
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
  const ready = Date.now();
  const status = await (await fetch(`http://127.0.0.1:${PORT}/system/storage`)).json();
  const visibleDuringCleanup = status.cleaning;
  while ((await (await fetch(`http://127.0.0.1:${PORT}/system/storage`)).json()).cleaning) await new Promise(r => setTimeout(r, 100));
  const settled = await (await fetch(`http://127.0.0.1:${PORT}/system/storage`)).json();
  child.stdin.write('stop\n');
  await new Promise((r) => child.once('exit', r));
  return { completed: { state: settled.state, deletedRuns: settled.deletedRuns, removedFileBytes: settled.removedFileBytes, pending: settled.pendingResources }, visibleDuringCleanup, spawnToPassMs: passAt - t0, passToListeningMs: ready - passAt, totalMs: ready - t0, state: status.state, deletedRuns: status.deletedRuns, removedFileBytes: status.removedFileBytes, pending: status.pendingResources };
}
try {
  const server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn', QA_SEED_RETAINED: '1000' } });
  const api = client(server.url);
  ev.log('retained fixture', await assertRetained(dataDir));
  const id = await api.createLoop(loop);
  const runs = [];
  for (let i = 0; i < 20; i++) runs.push((await api.startRun(id, {})).id);
  for (const r of runs) await api.waitFinal(r, 300_000);
  ev.check('20 runs with 1,900 files each approved', (await api.mark(runs)).status === 200);
  await server.stop();
  for (let i = 0; i < 2; i++) ev.log('adequate restart', await timeToReady());
  setCapacity(capacityFile, PRESSURE);
  const pressure = await timeToReady();
  ev.log('pressure restart with 20 approved 1,900-file workspaces and 1000 retained runs', pressure);
  ev.check('listener serves HTTP while startup cleanup runs', pressure.visibleDuringCleanup);
  ev.check('startup pass reclaims all 20 owned unshared workspaces in the large store', pressure.completed.deletedRuns === 20 && pressure.completed.removedFileBytes >= 3_800_000 && pressure.completed.pending === 0);
  ev.log('pressure restart afterwards', await timeToReady());
  ev.log('retained after cleanup', await assertRetained(dataDir));
} catch (error) {
  process.exitCode = 1; ev.log('ERROR', String(error?.stack ?? error));
} finally {
  ev.log('failures', ev.failures ?? 0);
}
