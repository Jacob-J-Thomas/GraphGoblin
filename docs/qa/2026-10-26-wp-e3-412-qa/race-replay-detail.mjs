// Why did concurrent replays answer 409 INVALID_STATE in race.mjs? Same requests, adequate
// storage (no cleanup), with and without delete-ready marks, problem details logged.
import fs from 'node:fs';
import { startServer, client, setCapacity, ADEQUATE, workLoop, temp, join, Evidence } from './qa-lib.mjs';

const ev = new Evidence('10b-race-replay-detail');
const base = join(temp, 'gg-qa-e3-race2');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir: join(base, 'data'), port: 6482, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
try {
  const W = await api.createLoop(workLoop('Replay detail'));
  for (const approved of [false, true]) {
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push((await api.startRun(W, { text: `detail ${approved} ${i} [[items=200]]`, files: 2, bytes: 10 })).id);
    for (const id of ids) await api.waitFinal(id);
    if (approved) ev.check('mark 8', (await api.mark(ids)).status === 200);
    const results = await Promise.all(ids.map((id) => api.post(`/runs/${id}/replay`, { nodeId: 'files' })));
    ev.log(`concurrent replays (approved=${approved})`, results.map((r) => `${r.status} ${r.json?.code ?? ''} ${r.json?.detail ?? ''}`.trim()));
    const sequential = [];
    for (const id of ids) {
      const r = await api.post(`/runs/${id}/replay`, { nodeId: 'files' });
      sequential.push(`${r.status} ${r.json?.code ?? ''} ${r.json?.detail ?? ''}`.trim());
    }
    ev.log(`sequential replays afterwards (approved=${approved})`, sequential);
  }
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  for (const r of (await api.get('/runs?status=queued,running,waiting,paused&limit=100')).json.items) await api.post(`/runs/${r.id}/cancel`);
  ev.log('server stop', await server.stop());
}
