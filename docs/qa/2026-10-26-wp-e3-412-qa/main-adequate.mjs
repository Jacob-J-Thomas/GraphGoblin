// Check 3 on the unmodified production entry point (apps/api/dist/main.js): real composition,
// real fs.statfs capacity, no fakes. Script-only loop, so no provider turn is needed.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { client, temp, join, root, here, Evidence, sleep, redact } from './qa-lib.mjs';

const ev = new Evidence('09-main-adequate');
const base = join(temp, 'gg-qa-e3-main');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GG_|JEV_)/i.test(k)));
const child = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...env, GG_DATA_DIR: join(base, 'data'), GG_PORT: '6480', GG_HOST: '127.0.0.1', GG_MASTER_KEY: Buffer.alloc(32, 43).toString('base64'), GG_LOG_LEVEL: 'warn' },
});
let log = '';
child.stdout.on('data', (c) => (log += String(c)));
child.stderr.on('data', (c) => (log += String(c)));
const api = client('http://127.0.0.1:6480');
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch('http://127.0.0.1:6480/healthz')).ok) break;
  } catch {}
  await sleep(200);
}
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
try {
  const loop = await api.createLoop({
    schemaVersion: 4,
    name: 'Production adequate',
    settings: { workingDirectory: { kind: 'temp' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'files', kind: 'script', label: 'Files', config: { command: process.execPath, args: ['-e', "require('fs').writeFileSync('kept.txt','kept')"], cwd: 'workspace', stdin: 'none' } },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'files', port: 'in' } },
      { id: 'e2', from: { node: 'files', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await api.startRun(loop, {})).id);
  for (const id of ids) await api.waitFinal(id);
  ev.check('approve 3 runs in production composition', (await api.mark(ids)).status === 200);
  let s = await api.storage();
  ev.log('storage (production fs.statfs)', s);
  const gib = (b) => (b / 1024 ** 3).toFixed(1) + ' GiB';
  ev.log('volume reading', s.volumes.map((v) => `${v.name}: ${gib(v.availableBytes)} free of ${gib(v.totalBytes)}`));
  const first = s.checkedAt;
  for (let i = 0; i < 80 && s.checkedAt === first; i++) {
    await sleep(1000);
    s = await api.storage();
  }
  ev.log('after the next timer pass', s);
  ev.check('adequate real storage: state adequate, nothing deleted', s.state === 'adequate' && s.deletedRuns === 0 && s.removedFileBytes === 0);
  for (const id of ids) ev.check(`approved ${id} still present with its workspace`, (await api.get(`/runs/${id}`)).status === 200 && fs.existsSync(join(base, 'data', 'workspaces', id, 'kept.txt')));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:6480/app/runs');
  await page.getByRole('heading', { name: 'Runs' }).waitFor();
  await sleep(1500);
  ev.check('no storage notice in Edge with adequate real storage', (await page.getByRole('status', { name: 'Storage pressure' }).count()) === 0);
  await browser.close();
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  child.kill('SIGINT');
  await new Promise((r) => child.once('exit', r));
  ev.log('production process warnings/errors', redact(log).split('\n').filter((l) => /"level":(40|50|60)/.test(l)).map((l) => l.replace(/"hostname":"[^"]*",?/g, '')).slice(0, 10));
  ev.log('failures', ev.failures ?? 0);
}
