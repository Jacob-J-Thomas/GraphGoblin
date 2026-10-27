// Supplementary API checks: unfinalized terminal runs, authenticated actors and scopes,
// proof/inventory budgets, explicit loop deletion and resources, and API latency while a
// pressure pass reaps large workspaces.
import fs from 'node:fs';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import {
  startServer,
  client,
  setCapacity,
  ADEQUATE,
  PRESSURE,
  workLoop,
  temp,
  join,
  Evidence,
  sleep,
} from './qa-lib.mjs';

const ev = new Evidence('03-api-extra');
const base = join(temp, 'gg-qa-e3-extra');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
setCapacity(capacityFile, ADEQUATE);
const sockets = new Set();
const hanging = http.createServer(() => undefined);
hanging.on('connection', (s) => sockets.add(s));
await new Promise((r) => hanging.listen(6488, '127.0.0.1', r));
const server = await startServer({ dataDir, port: 6485, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const withKey = (token) => ({
  call: (method, path, body) => api.call(method, path, body, { authorization: `Bearer ${token}` }),
});
async function waitPass(prev) {
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    await sleep(250);
  }
}

try {
  // ------------------------------------------------ unfinalized terminal run
  const hookLoop = workLoop('Webhook return');
  hookLoop.nodes.find((n) => n.id === 'done').config = {
    outcome: 'success',
    returns: '{"ok": true}',
    destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:6488/hook' }],
  };
  const H = await api.createLoop(hookLoop);
  const u = (await api.startRun(H, { text: 'unfinalized' })).id;
  const terminal = await api.waitFor(u, (r) => r.status === 'succeeded');
  ev.log('webhook run terminal', { status: terminal.status, finalizedAt: terminal.finalizedAt ?? null, deliveries: terminal.deliveries ?? terminal.delivery ?? null });
  const pu = await api.preview([u]);
  ev.check('terminal run with pending webhook delivery is protected (finalization incomplete)', !terminal.finalizedAt && pu.json.items[0].reasons.some((r) => /finalization/i.test(r)), pu.json.items[0]);
  const W = await api.createLoop(workLoop('Extra work'));
  const plain = (await api.startRun(W, { text: 'plain' })).id;
  await api.waitFinal(plain);
  const bulk = await api.mark([plain, u]);
  ev.check('bulk with the unfinalized run refused whole', bulk.status === 409 && !(await api.run(plain)).deletionApproval, bulk.json.code);
  for (const s of sockets) s.destroy();

  // ------------------------------------------------ authenticated actors and scopes
  const mint = async (scopes) => (await api.post('/api-keys', { name: `qa ${scopes.join(' ')}`, scopes })).json;
  const readKey = await mint(['runs:read']);
  const writeKey = await mint(['runs:write']);
  ev.log('minted keys', { read: readKey.key?.id ?? readKey.id, write: writeKey.key?.id ?? writeKey.id });
  const readToken = readKey.token ?? readKey.key?.token;
  const writeToken = writeKey.token ?? writeKey.key?.token;
  const p = await withKey(readToken).call('POST', '/runs/deletion-eligibility/preview', { runIds: [plain] });
  ev.check('runs:read key can preview', p.status === 200, p.status);
  const c = await withKey(readToken).call('POST', '/runs/deletion-eligibility', { runIds: [plain], token: p.json.token, action: 'mark', confirmed: true });
  ev.check('runs:read key cannot confirm (403)', c.status === 403, c.status);
  const c2 = await withKey(writeToken).call('POST', '/runs/deletion-eligibility', { runIds: [plain], token: p.json.token, action: 'mark', confirmed: true });
  const approval = (await api.run(plain)).deletionApproval;
  ev.check('runs:write key confirms; approval names the api-key actor', c2.status === 200 && approval?.confirmedBy?.kind === 'api-key', approval);
  const st = await withKey(writeToken).call('GET', '/system/storage');
  ev.check('key without system:read cannot read storage status (403)', st.status === 403, st.status);

  // ------------------------------------------------ component-wide revocation and cancelled runs
  const Cl = await api.createLoop(workLoop('Extra child'));
  const { parentLoop } = await import('./qa-lib.mjs');
  const Pl = await api.createLoop(parentLoop('Extra parent', Cl));
  const pr = (await api.startRun(Pl, {})).id;
  await api.waitFinal(pr);
  const ch = (await api.get(`/runs?parent=${pr}`)).json.items[0].id;
  const both = await api.mark([pr, ch]);
  ev.check('parent + child marked together', both.status === 200 && Boolean(await api.run(pr).then((r) => r.deletionApproval)), both.status);
  const chReplay = await api.post(`/runs/${ch}/replay`, { nodeId: 'files' });
  await api.waitFinal(chReplay.json.run.id);
  const prAfter = (await api.run(pr)).deletionApproval;
  const chAfter = (await api.run(ch)).deletionApproval;
  ev.check('replaying the child withdraws consent for the whole component (parent and child)', !prAfter && !chAfter, { parent: prAfter ?? null, child: chAfter ?? null });
  const cancelled = (await api.startRun(W, { text: '[[delay=600000]] to cancel' })).id;
  await api.waitFor(cancelled, (r) => r.status === 'running');
  await api.post(`/runs/${cancelled}/cancel`);
  const cRun = await api.waitFinal(cancelled);
  const cMark = await api.mark([cancelled]);
  ev.check('cancelled (terminal, finalized) run can be marked like succeeded/failed', cRun.status === 'cancelled' && cMark.status === 200, { status: cRun.status, mark: cMark.status });

  // ------------------------------------------------ inventory bound: a 2,100-file workspace
  const big = (await api.startRun(W, { text: 'big workspace', files: 2100, bytes: 1 })).id;
  await api.waitFinal(big, 300_000);
  // ------------------------------------------------ proof budget: unique artifact, many retained events
  const uniq = (await api.startRun(W, { text: 'unique artifact under budget pressure' })).id;
  await api.waitFinal(uniq);
  const noisy = (await api.startRun(W, { text: 'retained noisy [[items=2100]]' })).id;
  await api.waitFinal(noisy, 300_000);
  const m = await api.mark([big, uniq]);
  ev.check('mark big + uniq', m.status === 200, m.json.code ?? m.status);

  // ------------------------------------------------ explicit loop deletion leaves resources
  const L = await api.createLoop(workLoop('Loop to delete'));
  const l1 = (await api.startRun(L, { text: 'loop deletion run', files: 3, bytes: 100 })).id;
  await api.waitFinal(l1);
  const markL = await api.mark([l1]);
  const del = await api.call('DELETE', `/loops/${L}`);
  ev.check('deleting a loop whose run is delete-ready works (204) and removes the run', del.status === 204 && (await api.get(`/runs/${l1}`)).status === 404, { mark: markL.status, del: del.status });
  ev.log('deleted loop run workspace still on disk', fs.existsSync(join(dataDir, 'workspaces', l1)));

  // ------------------------------------------------ latency while reaping large workspaces
  const heavy = [];
  for (let i = 0; i < 12; i++) heavy.push((await api.startRun(W, { text: `heavy ${i}`, files: 1900, bytes: 10 })).id);
  for (const id of heavy) await api.waitFinal(id, 600_000);
  ev.check('mark heavy', (await api.mark(heavy)).status === 200);
  // Baseline latency.
  const probe = async (ms) => {
    const samples = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const t = performance.now();
      await api.get('/runs?limit=1');
      samples.push(performance.now() - t);
      await sleep(25);
    }
    samples.sort((a, b) => a - b);
    return { n: samples.length, p50: +samples[Math.floor(samples.length / 2)].toFixed(1), p99: +samples[Math.floor(samples.length * 0.99)].toFixed(1), max: +samples.at(-1).toFixed(1) };
  };
  ev.log('baseline GET /runs?limit=1 latency (ms)', await probe(3000));
  let s = await api.storage();
  setCapacity(capacityFile, PRESSURE);
  // Probe until the pass is over; also time a run that appends 2,000 events during the pass.
  const probing = (async () => {
    const samples = [];
    let passSeen = false;
    const t0 = Date.now();
    for (;;) {
      const t = performance.now();
      const r = await api.get('/system/storage');
      const dt = performance.now() - t;
      samples.push(dt);
      if (r.json.checkedAt !== s.checkedAt) passSeen = true;
      if (passSeen && !r.json.cleaning) break;
      if (Date.now() - t0 > 180_000) break;
      await sleep(25);
    }
    samples.sort((a, b) => a - b);
    return { n: samples.length, p50: +samples[Math.floor(samples.length / 2)].toFixed(1), max: +samples.at(-1).toFixed(1) };
  })();
  const dbProbe = (async () => {
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 100_000) {
      const t = performance.now();
      await api.get('/runs?limit=1');
      samples.push({ at: Date.now(), ms: performance.now() - t });
      await sleep(25);
    }
    return samples;
  })();
  const passStatus = await probing;
  const samples = await dbProbe;
  const ms = samples.map((x) => x.ms).sort((a, b) => a - b);
  ev.log('GET /system/storage latency during the pressure transition (ms)', passStatus);
  ev.log('GET /runs?limit=1 latency over 100 s including the pass (ms)', { n: ms.length, p50: +ms[Math.floor(ms.length / 2)].toFixed(1), p99: +ms[Math.floor(ms.length * 0.99)].toFixed(1), max: +ms.at(-1).toFixed(1), over1s: ms.filter((x) => x > 1000).length });
  s = await api.storage();
  ev.log('pass result', s);
  // Next pass for remaining jobs (32 per pass) and check budgets.
  s = await waitPass(s.checkedAt);
  ev.log('next pass', s);
  ev.check('2,100-file workspace preserved (inventory bound)', fs.existsSync(join(dataDir, 'workspaces', big)), { big: fs.existsSync(join(dataDir, 'workspaces', big)) });
  const uniqArtifact = fs.readdirSync(join(dataDir, 'artifacts', 'transcript'));
  ev.log('artifact files remaining', uniqArtifact.length, 'preservedResources', s.preservedResources, 'pendingResources', s.pendingResources);
  ev.log('heavy workspaces remaining', heavy.filter((id) => fs.existsSync(join(dataDir, 'workspaces', id))).length);
  ev.check('approved runs gone', (await api.get(`/runs/${big}`)).status === 404 && (await api.get(`/runs/${uniq}`)).status === 404 && (await api.get(`/runs/${cancelled}`)).status === 404);
  // The notice copy with preserved resources.
  ev.log('notice-state with preserved resources', { state: s.state, preserved: s.preservedResources });
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  for (const s of sockets) s.destroy();
  hanging.close();
  const stopped = await Promise.race([server.stop(), sleep(60_000).then(() => 'timeout')]);
  ev.log('server stop', stopped);
  if (stopped === 'timeout') ev.log('kill', await server.kill());
  ev.log('failures', ev.failures ?? 0);
}
