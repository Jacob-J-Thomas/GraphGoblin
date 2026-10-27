// Focused reproduction of the realistic-store phase D finding: one retained run of a loop with a
// TEMPLATE working directory that ended without resolving that directory keeps every approved,
// unshared, unaliased temp workspace in the store from being reclaimed. Two variants:
//   V1  template loop trigger -> exit (never needs a working directory), run succeeds;
//   V2  template loop whose directory renders empty, so the run fails before resolving it.
// Captures the status and the Edge notice in that state, then approves the blocking run.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, root, here, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('03-template-unknown');
const base = join(temp, 'gg-qa-e3r-tpl');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(join(base, 'user', 'tpl'), { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir, port: 6588, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const ws = (id) => join(dataDir, 'workspaces', id);
const waitPass = async (prev) => {
  const deadline = Date.now() + 150_000;
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    if (Date.now() > deadline) throw new Error('no pass');
    await sleep(250);
  }
};
const brief = (s) => ({ state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources });
try {
  const W = await api.createLoop(workLoop('Plain temp work'));
  const TX = await api.createLoop({
    schemaVersion: 4,
    name: 'Template loop that ends early',
    settings: { workingDirectory: { kind: 'template', template: '{{ trigger.payload.dir }}' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } }],
  });
  const TW = await api.createLoop(workLoop('Template loop with a script', { workingDirectory: { kind: 'template', template: '{{ trigger.payload.dir }}' } }));
  const v1 = (await api.startRun(TX, { dir: join(base, 'user', 'tpl') })).id;
  const v1Run = await api.waitFinal(v1);
  ev.log('V1 retained template run (trigger -> exit)', v1, v1Run.status);
  const a = [];
  for (let i = 0; i < 2; i++) a.push((await api.startRun(W, { text: `a${i}`, files: 2, bytes: 1000 })).id);
  for (const id of a) await api.waitFinal(id);
  ev.check('approve two plain temp-workspace runs (no links, no shared directories, no aliases)', (await api.mark(a)).status === 200);
  let s = await api.storage();
  setCapacity(capacityFile, PRESSURE);
  for (let i = 1; i <= 3; i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`V1 pass ${i}`, brief(s), 'approved runs', await Promise.all(a.map(async (id) => (await api.get(`/runs/${id}`)).status)), 'their workspaces on disk', a.filter((id) => fs.existsSync(ws(id))).length);
  }
  ev.check('V1: approved, unshared workspaces are reclaimed while the template run is retained', a.every((id) => !fs.existsSync(ws(id))), { onDisk: a.filter((id) => fs.existsSync(ws(id))).length, state: s.state });
  await page.goto(`${server.url}/app/runs`);
  const notice = page.getByRole('status', { name: 'Storage pressure' });
  await notice.waitFor({ timeout: 20_000 });
  ev.log('V1 notice text in this state', JSON.stringify(await notice.innerText()));
  await page.screenshot({ path: join(here, 'ui-notice-template-unknown.png') });
  ev.log('screenshot ui-notice-template-unknown.png');
  ev.check('V1: approving the template run itself', (await api.mark([v1])).status === 200);
  s = await waitPass(s.checkedAt);
  ev.log('V1 after approving the template run', brief(s), 'workspaces on disk', a.filter((id) => fs.existsSync(ws(id))).length);
  ev.check('V1: once the template run is deleted, the workspaces are reclaimed', a.every((id) => !fs.existsSync(ws(id))));

  // V2: a template run that fails before resolving its directory (empty render).
  const v2 = (await api.startRun(TW, { text: 'v2', files: 1, bytes: 1, dir: '' })).id;
  const v2Run = await api.waitFinal(v2);
  ev.log('V2 retained template run whose directory renders empty', v2, v2Run.status, v2Run.failure?.message ?? '');
  const b = [];
  for (let i = 0; i < 2; i++) b.push((await api.startRun(W, { text: `b${i}`, files: 2, bytes: 1000 })).id);
  for (const id of b) await api.waitFinal(id);
  ev.check('approve two more plain temp-workspace runs', (await api.mark(b)).status === 200);
  for (let i = 1; i <= 2; i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`V2 pass ${i}`, brief(s), 'their workspaces on disk', b.filter((id) => fs.existsSync(ws(id))).length);
  }
  ev.check('V2: approved, unshared workspaces are reclaimed while the failed template run is retained', b.every((id) => !fs.existsSync(ws(id))), { onDisk: b.filter((id) => fs.existsSync(ws(id))).length, state: s.state });
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await browser.close();
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
