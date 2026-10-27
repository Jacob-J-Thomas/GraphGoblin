// R3 re-check in Microsoft Edge, keyboard only: where focus lands after confirming or withdrawing
// from the Runs selection and from the inspector, what Chromium's accessibility tree exposes for
// the focused element (role and computed name, as a screen reader receives them), and what the
// polite live regions say. Cancel/Escape keep returning focus to the opener.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, client, setCapacity, ADEQUATE, workLoop, temp, join, root, here, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('10-r3-focus');
const base = join(temp, 'gg-qa-412f-a-r3');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({ dataDir: join(base, 'data'), port: 6626, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Accessibility.enable');
await cdp.send('DOM.enable');

/** Role and computed name of document.activeElement from Chromium's accessibility tree. */
async function focusedAx() {
  const tag = await page.evaluate(() => {
    document.querySelectorAll('[data-qa-focused]').forEach((e) => e.removeAttribute('data-qa-focused'));
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: el ? 'body' : 'none' };
    el.setAttribute('data-qa-focused', '1');
    return { tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 60), tabindex: el.getAttribute('tabindex'), live: el.getAttribute('aria-live') };
  });
  if (tag.tag === 'body' || tag.tag === 'none') return tag;
  const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '[data-qa-focused]' });
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const n = nodes[0];
  return { ...tag, axRole: n?.role?.value, axName: n?.name?.value ?? '', ignored: n?.ignored ?? false };
}
const liveRegions = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[aria-live]')].map((e) => ({ live: e.getAttribute('aria-live'), atomic: e.getAttribute('aria-atomic'), role: e.getAttribute('role'), text: (e.textContent ?? '').trim().slice(0, 100) })),
  );
async function tabTo(name, key = 'Shift+Tab', max = 40) {
  for (let i = 0; i < max; i++) {
    const f = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    if (f === name) return i;
    await page.keyboard.press(key);
  }
  throw new Error('could not reach ' + name);
}
try {
  const W = await api.createLoop(workLoop('Focus history'));
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await api.startRun(W, { text: `f${i}` })).id);
  for (const id of ids) await api.waitFinal(id);
  await page.goto(`${server.url}/app/runs`);
  await page.getByRole('checkbox', { name: `Select history ${ids[0]}` }).waitFor();

  // Keyboard-only mark of two runs.
  for (const id of ids.slice(0, 2)) {
    await page.getByRole('checkbox', { name: `Select history ${id}` }).focus();
    await page.keyboard.press('Space');
  }
  ev.log('selected with Space', await page.getByText(/\d+ selected/).innerText());
  ev.log(`Shift+Tab presses to the review button: ${await tabTo('Review delete-ready history')}`);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await sleep(500);
  ev.log('focus when the dialog opens', await focusedAx());
  await tabTo('Confirm delete-ready selection', 'Tab', 10);
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await sleep(500);
  const afterMark = await focusedAx();
  ev.log('focus after keyboard Confirm (Runs)', afterMark);
  ev.check('R3: after confirming, focus is on the selection count, exposed with its text as the name', afterMark.tag === 'span' && /^0 selected$/.test(afterMark.text) && afterMark.axName === '0 selected' && !afterMark.ignored, afterMark);
  const regionsMark = await liveRegions();
  ev.log('live regions after Confirm', regionsMark);
  ev.check('R3: the outcome is announced in a polite live region', regionsMark.some((r) => r.live === 'polite' && r.text === '2 runs marked delete-ready.'), regionsMark);
  ev.check('two runs approved', Boolean((await api.run(ids[0])).deletionApproval) && Boolean((await api.run(ids[1])).deletionApproval));
  await page.keyboard.press('Tab');
  ev.log('next Tab from the count goes to', await focusedAx());
  await page.keyboard.press('Shift+Tab');
  ev.log('Shift+Tab back goes to', await focusedAx());

  // Keyboard-only withdraw of one of them.
  await page.getByRole('checkbox', { name: `Select history ${ids[1]}` }).focus();
  await page.keyboard.press('Space');
  await tabTo('Withdraw delete-ready mark');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Confirm withdrawal' }).waitFor();
  await sleep(500);
  await tabTo('Confirm withdrawal', 'Tab', 10);
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await sleep(500);
  const afterWithdraw = await focusedAx();
  ev.log('focus after keyboard Confirm withdrawal (Runs)', afterWithdraw);
  ev.check('R3: after withdrawing, focus is on the selection count', afterWithdraw.tag === 'span' && afterWithdraw.axName === '0 selected', afterWithdraw);
  const regionsWithdraw = await liveRegions();
  ev.check('R3: the withdrawal is announced politely', regionsWithdraw.some((r) => r.live === 'polite' && r.text === 'Deletion approval withdrawn for 1 run.'), regionsWithdraw);
  ev.check('withdrawn run retained', !(await api.run(ids[1])).deletionApproval);

  // Cancel and Escape still return focus to the opener.
  await page.getByRole('checkbox', { name: `Select history ${ids[2]}` }).focus();
  await page.keyboard.press('Space');
  await tabTo('Review delete-ready history');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const afterEscape = await focusedAx();
  ev.check('Escape returns focus to the review button and changes nothing', afterEscape.axName === 'Review delete-ready history' && !(await api.run(ids[2])).deletionApproval, afterEscape);
  ev.log('live regions after Escape (the earlier outcome text)', await liveRegions());

  // Inspector.
  await page.goto(`${server.url}/app/runs/${ids[2]}`);
  await page.getByRole('button', { name: 'Review delete-ready history' }).focus();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await sleep(500);
  await tabTo('Confirm delete-ready selection', 'Tab', 10);
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await sleep(500);
  const afterInspector = await focusedAx();
  ev.log('focus after keyboard Confirm (inspector)', afterInspector);
  ev.check('R3: inspector confirm moves focus to its count and announces the outcome', afterInspector.axName === '1 selected' && (await liveRegions()).some((r) => r.text === '1 run marked delete-ready.'), afterInspector);
  ev.log('inspector approval line', await page.getByText(/Delete-ready: confirmed by/).innerText());
  await page.screenshot({ path: join(here, 'ui-r3-inspector-after-confirm.png') });
  ev.log('screenshot ui-r3-inspector-after-confirm.png');
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  await browser.close();
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
