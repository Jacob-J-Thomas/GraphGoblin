// Authenticated actor and scopes for deletion eligibility and the storage observation.
import fs from 'node:fs';
import { startServer, client, setCapacity, ADEQUATE, workLoop, temp, join, Evidence } from './qa-lib.mjs';

const ev = new Evidence('11-api-keys');
const base = join(temp, 'gg-qa-e3-keys');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir: join(base, 'data'), port: 6485, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const as = (token) => (method, path, body) => api.call(method, path, body, { authorization: `Bearer ${token}` });
try {
  const W = await api.createLoop(workLoop('Keys'));
  const run = (await api.startRun(W, { text: 'keys' })).id;
  await api.waitFinal(run);
  const mint = async (scopes) => (await api.post('/api-keys', { label: `qa ${scopes.join(' ')}`, scopes })).json;
  const read = await mint(['runs:read']);
  const write = await mint(['runs:write']);
  const sys = await mint(['system:read']);
  ev.log('key ids', { read: read.key.id, write: write.key.id, system: sys.key.id });
  const p = await as(read.token)('POST', '/runs/deletion-eligibility/preview', { runIds: [run] });
  ev.check('runs:read key can preview', p.status === 200, p.status);
  const c = await as(read.token)('POST', '/runs/deletion-eligibility', { runIds: [run], token: p.json.token, action: 'mark', confirmed: true });
  ev.check('runs:read key cannot confirm (403)', c.status === 403, c.status);
  const c2 = await as(write.token)('POST', '/runs/deletion-eligibility', { runIds: [run], token: p.json.token, action: 'mark', confirmed: true });
  const approval = (await api.run(run)).deletionApproval;
  ev.check('runs:write key confirms; approval names the api-key actor and server time', c2.status === 200 && approval?.confirmedBy?.kind === 'api-key' && approval.confirmedBy.id === write.key.id, approval);
  const s1 = await as(write.token)('GET', '/system/storage');
  ev.check('key without system:read cannot read storage status (403)', s1.status === 403, s1.status);
  const s2 = await as(sys.token)('GET', '/system/storage');
  ev.check('system:read key reads storage status', s2.status === 200 && s2.json.state === 'adequate', s2.status);
  const none = await api.call('POST', '/runs/deletion-eligibility/preview', { runIds: [run] }, { authorization: 'Bearer wrong' });
  ev.check('wrong key refused (401)', none.status === 401, none.status);
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
