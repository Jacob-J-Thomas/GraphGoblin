// Smoke check of the QA composition: one run with an artifact and workspace files.
import { readdirSync } from 'node:fs';
import { startServer, client, setCapacity, ADEQUATE, workLoop, temp, join, Evidence } from './qa-lib.mjs';

const ev = new Evidence('00-smoke');
const base = join(temp, 'gg-qa-e3-smoke');
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
await import('node:fs').then((fs) => fs.mkdirSync(base, { recursive: true }));
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir, port: 6480, capacityFile, logFile: join(base, 'server.log') });
const api = client(server.url);
try {
  const loop = await api.createLoop(workLoop('Smoke'));
  const run = await api.startRun(loop, { text: 'smoke unique 1', files: 2, bytes: 100 });
  const done = await api.waitFinal(run.id);
  ev.log('run', { id: done.id, status: done.status, finalizedAt: done.finalizedAt, deletionApproval: done.deletionApproval ?? null });
  ev.log('failure', done.failure ?? null);
  const thread = await api.get(`/runs/${run.id}/thread`);
  ev.log('artifacts', thread.json.artifacts ?? thread.json.thread?.artifacts);
  ev.log('workspaces', readdirSync(join(dataDir, 'workspaces')));
  ev.log('workspace files', readdirSync(join(dataDir, 'workspaces', run.id)));
  ev.log('artifacts dir', readdirSync(join(dataDir, 'artifacts')));
  ev.log('storage', await api.storage());
} finally {
  await server.stop();
}
