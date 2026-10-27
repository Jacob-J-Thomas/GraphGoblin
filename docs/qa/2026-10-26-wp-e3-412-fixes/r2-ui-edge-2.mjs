// Adapted Edge reproduction: confirmation clears selection, then background cleanup cannot leave ghost IDs.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import {
  startServer,
  client,
  setCapacity,
  ADEQUATE,
  PRESSURE,
  workLoop,
  parentLoop,
  temp,
  join,
  root,
  here,
  Evidence,
  sleep,
} from './r2-qa-lib.mjs';

const ev = new Evidence('r2-ui-edge-2');
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const base = fs.mkdtempSync(join(temp, 'gg-wp-e3-r2-ui2-'));
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const sockets = new Set();
const hanging = http.createServer(() => undefined);
hanging.on('connection', (s) => sockets.add(s));
await new Promise((r) => hanging.listen(6357, '127.0.0.1', r));
const server = await startServer({ dataDir: join(base, 'data'), port: 6356, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const app = `${server.url}/app`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const shot = async (name, p = page) => {
  await p.screenshot({ path: join(here, `${name}.png`) });
  ev.log(`screenshot ${name}.png`);
};
const approval = async (id) => (await api.run(id)).deletionApproval ?? null;

try {
  const W = await api.createLoop(workLoop('Follow-up history'));
  const C = await api.createLoop(workLoop('Follow-up child'));
  const P = await api.createLoop(parentLoop('Follow-up parent', C));
  const a = (await api.startRun(W, { text: 'a' })).id;
  const b = (await api.startRun(W, { text: 'b' })).id;
  const keep = (await api.startRun(W, { text: 'keep' })).id;
  const p1 = (await api.startRun(P, {})).id;
  for (const id of [a, b, keep, p1]) await api.waitFinal(id);
  const c1 = (await api.get(`/runs?parent=${p1}`)).json.items[0].id;

  // ------------------------------------------------ selection outliving cleanup on an open page
  await page.goto(`${app}/runs`);
  for (const id of [a, b]) await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  const review = page.getByRole('button', { name: 'Review delete-ready history' });
  await review.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await dialog.waitFor({ state: 'hidden' });
  ev.check('selection clears after confirmation', (await page.getByText(/\d+ selected/).innerText()) === '0 selected');
  setCapacity(capacityFile, PRESSURE);
  for (let i = 0; i < 150; i++) {
    const s = await api.storage();
    if (s.state === 'pressure' && !s.cleaning) break;
    await sleep(1000);
  }
  ev.log('a/b after pressure', (await api.get(`/runs/${a}`)).status, (await api.get(`/runs/${b}`)).status);
  await sleep(6000); // Runs list polls every 5 s
  const rowsVisible = await page.getByRole('checkbox', { name: `Select history ${a}` }).count();
  const countText = await page.getByText(/\d+ selected/).innerText();
  ev.log(`open Runs page after cleanup: row for deleted run visible=${rowsVisible}, count text "${countText}"`);
  await page.getByRole('checkbox', { name: `Select history ${keep}` }).check();
  ev.log('count after selecting one visible run', await page.getByText(/\d+ selected/).innerText());
  await review.click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await sleep(1500);
  ev.log('dialog after cleanup removed earlier selected runs\n' + (await dialog.ariaSnapshot()));
  await shot('ui-ghost-selection');
  const blocked = await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).isDisabled();
  ev.check('review after cleanup contains only the newly selected retained run and permits confirmation', !blocked, { confirmDisabled: blocked });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const uncheckable = await page.getByRole('checkbox', { name: `Select history ${a}` }).count();
  ev.log(`deleted run rows available to uncheck: ${uncheckable}`);
  setCapacity(capacityFile, ADEQUATE);

} catch (error) {
  process.exitCode = 1; ev.log('ERROR', String(error?.stack ?? error));
  await shot('ui2-error').catch(() => undefined);
} finally {
  try {
    for (const r of (await api.get('/runs?status=queued,running,waiting,paused&limit=50')).json.items) await api.post(`/runs/${r.id}/cancel`);
  } catch {}
  for (const s of sockets) s.destroy();
  hanging.close();
  await browser.close();
  const stopped = await Promise.race([server.stop(), sleep(60_000).then(() => 'timeout')]);
  ev.log('server stop', stopped);
  if (stopped === 'timeout') ev.log('kill', await server.kill());
  ev.log('failures', ev.failures ?? 0);
}
