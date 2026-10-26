// Responsiveness while a timer pass reaps large approved workspaces: HTTP reads that touch
// SQLite and an active run's event appends, compared with the same work without a pass.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('12-latency');
const base = join(temp, 'gg-qa-e3-latency');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir: join(base, 'data'), port: 6485, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: +s[Math.floor(s.length / 2)].toFixed(1), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), max: +s.at(-1).toFixed(1), over1s: s.filter((x) => x > 1000).length };
};
async function probe(ms) {
  const out = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = performance.now();
    await api.get('/runs?limit=1');
    out.push(performance.now() - t);
    await sleep(20);
  }
  return out;
}
async function timedRun(W, label) {
  const t = performance.now();
  const id = (await api.startRun(W, { text: `${label} [[items=400]]` })).id;
  await api.waitFinal(id, 120_000);
  return +(performance.now() - t).toFixed(0);
}
try {
  const W = await api.createLoop(workLoop('Latency work'));
  const heavy = [];
  for (let i = 0; i < 16; i++) heavy.push((await api.startRun(W, { text: `heavy ${i}`, files: 1900, bytes: 50 })).id);
  for (const id of heavy) await api.waitFinal(id, 600_000);
  ev.check('16 approved runs with 1,900-file workspaces', (await api.mark(heavy)).status === 200);
  // Baseline without a pass in progress.
  const [baseProbe, baseRun] = await Promise.all([probe(6000), timedRun(W, 'baseline')]);
  ev.log('baseline GET /runs?limit=1 (ms)', stats(baseProbe), 'baseline 400-event run to finalization (ms)', baseRun);
  // Align with the next timer tick.
  const last = server.passTimes.at(-1);
  const tick = last + 60_000 * Math.ceil((Date.now() - last + 1000) / 60_000);
  setCapacity(capacityFile, PRESSURE);
  await sleep(Math.max(0, tick - Date.now() + 300));
  const [passProbe, passRun] = await Promise.all([probe(20000), timedRun(W, 'during pass')]);
  const s = await api.storage();
  ev.log('pass', { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources }, 'pass began', new Date(server.passTimes.at(-1)).toISOString());
  ev.log('during-pass GET /runs?limit=1 (ms)', stats(passProbe), '400-event run started during the pass, to finalization (ms)', passRun);
  ev.log('remaining heavy workspaces', heavy.filter((id) => fs.existsSync(join(base, 'data', 'workspaces', id))).length);
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
