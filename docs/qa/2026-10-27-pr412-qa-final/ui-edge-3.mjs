// ADR-0033 follow-up in Edge: deleting the CHILD loop keeps the parent run, whose inspector
// explains the missing child; the parent's delete-ready review then needs no missing relative.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, client, setCapacity, ADEQUATE, workLoop, parentLoop, temp, join, root, here, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('07-ui-loop-deletion-child');
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const base = join(temp, 'gg-qa-412f-a-ui3');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir: join(base, 'data'), port: 6620, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
try {
  const C = await api.createLoop(workLoop('Child loop'));
  const P = await api.createLoop(parentLoop('Parent loop', C));
  const p = (await api.startRun(P, {})).id;
  await api.waitFinal(p);
  const c = (await api.get(`/runs?parent=${p}`)).json.items[0].id;
  const before = await api.preview([p]);
  ev.log('parent preview before child loop deletion', before.json.items);
  await page.goto(`${server.url}/app/loops`);
  await page.getByRole('button', { name: 'Delete Child loop' }).click();
  const dialog = page.getByRole('alertdialog');
  ev.log('child loop delete dialog text', JSON.stringify(await dialog.innerText()));
  await dialog.getByRole('button', { name: /Confirm delete/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  ev.check('child loop deleted with its run; parent run kept', (await api.get(`/runs/${c}`)).status === 404 && (await api.get(`/runs/${p}`)).status === 200);
  await page.goto(`${server.url}/app/runs/${p}`);
  await sleep(2500);
  const text = await page.locator('body').innerText();
  const lines = text.split('\n').filter((l) => /child|missing|deleted|no longer/i.test(l));
  ev.log('parent inspector lines about the child', lines.slice(0, 10));
  await page.screenshot({ path: join(here, 'ui-parent-missing-child.png'), fullPage: true });
  ev.log('screenshot ui-parent-missing-child.png');
  const after = await api.preview([p]);
  ev.check('parent alone is now reviewable (no missing relative blocks it)', after.status === 200 && after.json.items[0].reasons.length === 0, after.json.items);
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  await browser.close();
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
