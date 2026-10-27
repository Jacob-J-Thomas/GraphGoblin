// Follow-up Edge checks: loop deletion (ADR-0033) through the UI, a selection that outlives
// pressure cleanup on an open Runs page, an unfinalized run in the dialog, and a phone-width view.
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
} from './qa-lib.mjs';

const ev = new Evidence('09-ui-edge-followup');
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const base = join(temp, 'gg-qa-412f-a-ui2');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const sockets = new Set();
const hanging = http.createServer(() => undefined);
hanging.on('connection', (s) => sockets.add(s));
await new Promise((r) => hanging.listen(6625, '127.0.0.1', r));
const server = await startServer({ dataDir: join(base, 'data'), port: 6626, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
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
  const g1 = (await api.startRun(W, { text: 'g1' })).id;
  const g2 = (await api.startRun(W, { text: 'g2' })).id;
  const p1 = (await api.startRun(P, {})).id;
  for (const id of [a, b, keep, g1, g2, p1]) await api.waitFinal(id);
  const c1 = (await api.get(`/runs?parent=${p1}`)).json.items[0].id;

  // ------------------------------------------------ D4 re-check: selection after confirm, withdraw and cleanup
  // (Re-check rewrite of the first QA's block: confirmation should now clear the confirmed IDs,
  // and IDs that cleanup removed should be pruned once the public run read returns 404.)
  const focused = () => page.evaluate(() => { const el = document.activeElement; return el ? `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 60)}"` : 'none'; });
  const countText = () => page.getByText(/\d+ selected/).innerText();
  await page.goto(`${app}/runs`);
  for (const id of [a, b]) await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  const countNode = page.getByText(/\d+ selected/);
  ev.log('selection count element attributes', await countNode.evaluate((el) => ({ live: el.getAttribute('aria-live'), atomic: el.getAttribute('aria-atomic'), role: el.getAttribute('role') })));
  const review = page.getByRole('button', { name: 'Review delete-ready history' });
  await review.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const afterConfirm = await countText();
  ev.log('after confirm: count text', afterConfirm, 'focus', await focused());
  ev.check('D4: confirming clears the confirmed IDs from the Runs selection', afterConfirm === '0 selected', afterConfirm);
  ev.check('D4: a and b are approved', Boolean(await approval(a)) && Boolean(await approval(b)));
  // Withdraw from the Runs selection also clears it.
  await page.getByRole('checkbox', { name: `Select history ${b}` }).check();
  await page.getByRole('button', { name: 'Withdraw delete-ready mark' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const afterWithdraw = await countText();
  ev.log('after withdraw: count text', afterWithdraw, 'focus', await focused());
  ev.check('D4: withdrawing clears the withdrawn IDs from the Runs selection', afterWithdraw === '0 selected' && !(await approval(b)), afterWithdraw);
  // Runs selected on this page, approved elsewhere (API), then removed by cleanup while the page stays open.
  for (const id of [g1, g2]) await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  ev.log('selected g1 and g2 on the page', await countText());
  ev.check('g1 and g2 approved through the API while selected on the open page', (await api.mark([g1, g2])).status === 200);
  setCapacity(capacityFile, PRESSURE);
  for (let i = 0; i < 150; i++) {
    const s = await api.storage();
    if ((await api.get(`/runs/${g1}`)).status === 404 && !s.cleaning) break;
    await sleep(1000);
  }
  ev.log('a/g1/g2 after pressure', (await api.get(`/runs/${a}`)).status, (await api.get(`/runs/${g1}`)).status, (await api.get(`/runs/${g2}`)).status);
  await sleep(8000); // Runs list polls every 5 s; pruning follows a 404 from the run read
  const ghostRows = await page.getByRole('checkbox', { name: `Select history ${g1}` }).count();
  const afterCleanup = await countText();
  ev.log(`open Runs page after cleanup: row for deleted run visible=${ghostRows}, count text "${afterCleanup}"`);
  ev.check('D4: runs removed by cleanup leave the selection', afterCleanup === '0 selected', afterCleanup);
  await page.getByRole('checkbox', { name: `Select history ${keep}` }).check();
  const oneSelected = await countText();
  await review.click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await sleep(1500);
  const listed = await dialog.locator('li code').allInnerTexts();
  ev.log('dialog after cleanup removed earlier selected runs\n' + (await dialog.ariaSnapshot()));
  await shot('ui-selection-after-cleanup');
  const blocked = await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).isDisabled();
  ev.check('D4: the review lists only the visible run and can be confirmed', oneSelected === '1 selected' && JSON.stringify(listed) === JSON.stringify([keep]) && !blocked, { oneSelected, listed, confirmDisabled: blocked });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  setCapacity(capacityFile, ADEQUATE);

  // ------------------------------------------------ unfinalized terminal run in the dialog
  const hookLoop = workLoop('Follow-up webhook');
  hookLoop.nodes.find((n) => n.id === 'done').config = { outcome: 'success', returns: '{"ok": true}', destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:6625/hook' }] };
  const H = await api.createLoop(hookLoop);
  const u = (await api.startRun(H, { text: 'u' })).id;
  await api.waitFor(u, (r) => r.status === 'succeeded');
  await page.goto(`${app}/runs/${u}`);
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText(/finalization/i).waitFor({ timeout: 10_000 }).catch(() => undefined);
  ev.log('unfinalized run dialog\n' + (await dialog.ariaSnapshot()));
  ev.check('unfinalized terminal run cannot be confirmed', await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).isDisabled());
  await page.keyboard.press('Escape');
  for (const s of sockets) s.destroy();

  // ------------------------------------------------ check 2: loop deletion through the UI
  const D = await api.createLoop(workLoop('Deletable loop'));
  const d1 = (await api.startRun(D, { text: 'd1' })).id;
  const d2 = (await api.startRun(D, { text: '[[fail]] d2' })).id;
  for (const id of [d1, d2]) await api.waitFinal(id);
  ev.log('d1 approval before loop deletion (never marked)', await approval(d1));
  await page.goto(`${app}/loops`);
  await page.getByRole('button', { name: 'Delete Deletable loop' }).click();
  let confirm = page.getByRole('alertdialog');
  await confirm.waitFor();
  ev.log('loop delete dialog\n' + (await confirm.ariaSnapshot()));
  ev.log('focus on open', await page.evaluate(() => document.activeElement?.textContent?.trim()));
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await confirm.waitFor({ state: 'hidden' });
  ev.check('Keep leaves loop and history', (await api.get(`/loops/${D}`)).status === 200 && (await api.get(`/runs/${d1}`)).status === 200);
  await page.getByRole('button', { name: 'Delete Deletable loop' }).click();
  await confirm.getByRole('button', { name: /Confirm delete/ }).click();
  await confirm.waitFor({ state: 'hidden' });
  ev.check('Confirm delete removes the loop and both runs (succeeded and failed), without delete-ready marks', (await api.get(`/loops/${D}`)).status === 404 && (await api.get(`/runs/${d1}`)).status === 404 && (await api.get(`/runs/${d2}`)).status === 404);
  ev.log('focus after delete', await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.id} ${document.activeElement?.textContent?.trim().slice(0, 40)}`));
  // Active run refuses deletion.
  const active = (await api.startRun(W, { text: '[[delay=900000]] active' })).id;
  await api.waitFor(active, (r) => r.status === 'running');
  await page.goto(`${app}/loops`);
  await page.getByRole('button', { name: 'Delete Follow-up history' }).click();
  confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: /Confirm delete/ }).click();
  await confirm.getByRole('alert').waitFor({ timeout: 10_000 });
  ev.log('active-run refusal\n' + (await confirm.ariaSnapshot()));
  await shot('ui-loop-delete-refused');
  ev.check('loop with an active run is kept with its history', (await api.get(`/loops/${W}`)).status === 200 && (await api.get(`/runs/${keep}`)).status === 200);
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await api.post(`/runs/${active}/cancel`);
  await api.waitFinal(active);
  // Parent loop deletion keeps the child loop's run and explains the missing parent.
  await page.getByRole('button', { name: 'Delete Follow-up parent' }).click();
  confirm = page.getByRole('alertdialog');
  ev.log('parent loop delete dialog text', await confirm.innerText());
  await confirm.getByRole('button', { name: /Confirm delete/ }).click();
  await confirm.waitFor({ state: 'hidden' });
  const child = await api.get(`/runs/${c1}`);
  ev.check('child-loop run survives parent loop deletion with its parent association cleared', child.status === 200 && !child.json.parentRunId && (await api.get(`/runs/${p1}`)).status === 404, { status: child.status, parentRunId: child.json?.parentRunId ?? null });
  await page.goto(`${app}/runs/${c1}`);
  await sleep(2000);
  const mentions = await page.getByText(/parent/i).allInnerTexts();
  ev.log('child inspector parent text', mentions.slice(0, 5));

  // ------------------------------------------------ phone width
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  setCapacity(capacityFile, PRESSURE);
  await mobile.goto(`${app}/runs`);
  for (let i = 0; i < 150; i++) {
    const s = await api.storage();
    if ((s.state === 'no-eligible' || s.state === 'pressure') && !s.cleaning) break;
    await sleep(1000);
  }
  await mobile.reload();
  await mobile.getByRole('status', { name: 'Storage pressure' }).waitFor({ timeout: 20_000 });
  await mobile.getByRole('checkbox', { name: `Select history ${keep}` }).check();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ev.log('phone width horizontal overflow px', overflow);
  await shot('ui-phone-runs', mobile);
  await mobile.getByRole('button', { name: 'Review delete-ready history' }).click();
  await mobile.getByRole('dialog').getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await shot('ui-phone-dialog', mobile);
  await mobile.keyboard.press('Escape');
  setCapacity(capacityFile, ADEQUATE);
  await phone.close();
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
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
