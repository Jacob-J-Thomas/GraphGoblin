// Checks 1 (browser), 2, 6 and the notice part of 4, in Microsoft Edge (Playwright, channel
// msedge) against one real API process (QA composition, file-backed store), plus MCP list_runs.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
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
  redact,
} from './qa-lib.mjs';

const ev = new Evidence('08-ui-edge');
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = requireWeb('@playwright/test');
const base = join(temp, 'gg-qa-412f-a-ui');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const server = await startServer({
  dataDir: join(base, 'data'),
  port: 6627,
  capacityFile,
  logFile: join(base, 'server.log.txt'),
  env: { QA_LOG_LEVEL: 'warn' },
});
const api = client(server.url);
const app = `${server.url}/app`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const approval = async (id) => (await api.run(id)).deletionApproval ?? null;
const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80)}"` : 'none';
  });
const shot = async (name) => {
  await page.screenshot({ path: join(here, `${name}.png`), fullPage: false });
  ev.log(`screenshot ${name}.png`);
};

try {
  const W = await api.createLoop(workLoop('UI history'));
  const C = await api.createLoop(workLoop('UI child'));
  const P = await api.createLoop(parentLoop('UI parent', C));
  const ok1 = (await api.startRun(W, { text: 'ok1' })).id;
  const ok2 = (await api.startRun(W, { text: 'ok2' })).id;
  const fail1 = (await api.startRun(W, { text: '[[fail]] fail1' })).id;
  const ok3 = (await api.startRun(W, { text: 'ok3' })).id;
  const p1 = (await api.startRun(P, {})).id;
  for (const id of [ok1, ok2, fail1, ok3, p1]) await api.waitFinal(id);
  const c1 = (await api.get(`/runs?parent=${p1}`)).json.items[0].id;
  const active = (await api.startRun(W, { text: '[[delay=900000]] active' })).id;
  await api.waitFor(active, (r) => r.status === 'running');
  ev.log('runs', { ok1, ok2, fail1, ok3, p1, c1, active });

  // ------------------------------------------------ individual selection: Cancel, Escape, Close
  await page.goto(`${app}/runs`);
  const review = page.getByRole('button', { name: 'Review delete-ready history' });
  const withdraw = page.getByRole('button', { name: 'Withdraw delete-ready mark' });
  ev.check('Runs: review button disabled with nothing selected', await review.isDisabled());
  await page.getByRole('checkbox', { name: `Select history ${ok1}` }).check();
  ev.check('Runs: count shows 1 selected', await page.getByText('1 selected', { exact: true }).isVisible());
  await review.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByText(ok1).waitFor();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  ev.log('dialog aria snapshot (individual, Runs)\n' + (await dialog.ariaSnapshot()));
  ev.log('focus on open', await focused());
  await shot('ui-review-dialog');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  ev.log('focus after Cancel', await focused());
  ev.check('Cancel changes nothing', (await approval(ok1)) === null);
  await review.click();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  ev.log('focus after Escape', await focused());
  ev.check('Escape changes nothing', (await approval(ok1)) === null);
  await review.click();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  const closeButtons = await dialog.getByRole('button').allInnerTexts();
  ev.log('dialog buttons', closeButtons);
  const close = dialog.getByRole('button', { name: 'Close' });
  if (await close.count()) {
    await close.click();
    await dialog.waitFor({ state: 'hidden' });
    ev.check('Close button changes nothing', (await approval(ok1)) === null);
  } else ev.log('no separate Close button in this dialog');

  // ------------------------------------------------ bulk: exact frozen selection, success+failure alike
  await page.getByRole('checkbox', { name: `Select history ${ok2}` }).check();
  await page.getByRole('checkbox', { name: `Select history ${fail1}` }).check();
  ev.check('Runs: count shows 3 selected', await page.getByText('3 selected', { exact: true }).isVisible());
  await review.click();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  const listed = await dialog.locator('li code').allInnerTexts();
  ev.check('bulk preview lists exactly the three selected runs', JSON.stringify([...listed].sort()) === JSON.stringify([ok1, ok2, fail1].sort()), listed);
  // New history while the dialog is open must not join it.
  const later = (await api.startRun(W, { text: 'later' })).id;
  await api.waitFinal(later);
  await sleep(6000); // past the 5 s Runs poll
  const listedAfterPoll = await dialog.locator('li code').allInnerTexts();
  ev.check('polling and new history do not extend the frozen selection', !listedAfterPoll.includes(later) && listedAfterPoll.length === 3, listedAfterPoll);
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await dialog.waitFor({ state: 'hidden' });
  ev.log('focus after Confirm', await focused());
  const approvals = { ok1: await approval(ok1), ok2: await approval(ok2), fail1: await approval(fail1) };
  ev.check('confirm marks exactly the three (succeeded and failed alike)', Object.values(approvals).every(Boolean) && (await approval(later)) === null && (await approval(ok3)) === null, approvals);
  ev.log('who/when via API', approvals.fail1);
  await page.getByRole('cell', { name: 'Delete-ready' }).first().waitFor();
  const retentionCells = await page.getByText('Delete-ready', { exact: true }).count();
  ev.check('Runs table shows Delete-ready for exactly 3 rows', retentionCells === 3, retentionCells);
  const countAfter = await page.getByText(/\d+ selected/).innerText();
  ev.log('selection count after confirm', countAfter);

  // ------------------------------------------------ protected selection refused whole
  await page.reload();
  await page.getByRole('checkbox', { name: `Select history ${ok3}` }).check();
  await page.getByRole('checkbox', { name: `Select history ${active}` }).check();
  await review.click();
  await dialog.getByText(/Run is running/).waitFor();
  ev.log('protected dialog\n' + (await dialog.ariaSnapshot()));
  ev.check('Confirm disabled when a selected run is protected', await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).isDisabled());
  await shot('ui-protected-dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  ev.check('ok3 not marked by refused bulk selection', (await approval(ok3)) === null);
  // parent without child
  await page.reload();
  await page.getByRole('checkbox', { name: `Select history ${p1}` }).check();
  await review.click();
  await dialog.getByText(/must be selected together/).waitFor();
  ev.log('parent-only dialog\n' + (await dialog.ariaSnapshot()));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // filter clears selection
  await page.getByLabel('Status').selectOption('succeeded');
  ev.check('changing a filter clears the selection', await page.getByText('0 selected', { exact: true }).isVisible());
  await page.goto(`${app}/runs`);

  // ------------------------------------------------ stale preview (state changed by another tab)
  await page.getByRole('checkbox', { name: `Select history ${ok3}` }).check();
  await review.click();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  const other = await context.newPage();
  await other.goto(`${app}/runs/${ok3}`);
  await other.getByRole('button', { name: 'Review delete-ready history' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await other.getByText(/Delete-ready: confirmed by/).waitFor();
  const otherApproval = await approval(ok3);
  await other.getByRole('button', { name: 'Withdraw delete-ready mark' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Confirm withdrawal' }).click();
  await other.getByText('History retained.', { exact: true }).waitFor();
  await other.close();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  const alert = dialog.getByRole('alert');
  await alert.waitFor();
  ev.log('stale alert text', await alert.innerText());
  ev.check('stale confirmation refused; state unchanged (still retained after other tab withdrew)', (await approval(ok3)) === null && Boolean(otherApproval));
  ev.check('Confirm disabled after the stale error', await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).isDisabled());
  await shot('ui-stale-dialog');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  // ------------------------------------------------ inspector: mark, who/when, withdraw
  await page.goto(`${app}/runs/${fail1}`);
  const inspectorLine = await page.getByText(/Delete-ready: confirmed by/).innerText();
  ev.log('inspector approval line', inspectorLine);
  await page.getByRole('button', { name: 'Withdraw delete-ready mark' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm withdrawal' }).waitFor();
  ev.log('withdraw dialog\n' + (await dialog.ariaSnapshot()));
  await dialog.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await page.getByText('History retained.', { exact: true }).waitFor();
  ev.check('inspector withdrawal persisted', (await approval(fail1)) === null);
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await page.getByText(/Delete-ready: confirmed by/).waitFor();
  ev.check('inspector individual mark persisted', Boolean(await approval(fail1)));
  // Resume of the approved failed run from the inspector withdraws consent.
  const resume = page.getByRole('button', { name: /^Resume/ });
  ev.log('resume buttons', await resume.allInnerTexts());
  if (await resume.count()) {
    await resume.first().click();
    const confirmResume = page.getByRole('dialog').getByRole('button', { name: /Resume/ });
    if (await confirmResume.count()) await confirmResume.first().click();
    await api.waitFinal(fail1);
    ev.check('resuming an approved run from the inspector withdraws consent', (await approval(fail1)) === null);
  }

  // ------------------------------------------------ keyboard and focus
  await page.goto(`${app}/runs`);
  const box = page.getByRole('checkbox', { name: `Select history ${ok3}` });
  await box.focus();
  await page.keyboard.press('Space');
  ev.check('Space toggles a history checkbox', await box.isChecked());
  let steps = 0;
  while (!(await focused()).includes('Review delete-ready history') && steps < 40) {
    await page.keyboard.press('Shift+Tab');
    steps++;
  }
  ev.log(`Shift+Tab presses from the checkbox to the review button: ${steps}`);
  await page.keyboard.press('Enter');
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).waitFor();
  ev.log('focus on keyboard open', await focused());
  const path = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    path.push(await focused());
  }
  ev.log('Tab order inside dialog', path);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  ev.check('focus returns to the review button after Escape', (await focused()).includes('Review delete-ready history'), await focused());
  ev.check('keyboard Escape changed nothing', (await approval(ok3)) === null);

  // ------------------------------------------------ MCP: lists approvals, offers no consent tool
  const mcp = spawn(process.execPath, [join(root, 'apps/mcp/dist/main.js'), '--api-url', server.url, '--http', '--port', '6622'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await sleep(2500);
  try {
    const rpc = async (body, session) => {
      const r = await fetch('http://127.0.0.1:6622/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      const data = text.includes('data:') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).at(-1) : JSON.parse(text);
      return { session: r.headers.get('mcp-session-id'), data };
    };
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa', version: '1' } } });
    const session = init.session;
    await fetch('http://127.0.0.1:6622/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': session }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const tools = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
    const names = tools.data.result.tools.map((t) => t.name);
    ev.log('MCP tools', names);
    ev.check('MCP offers no deletion/approval tool', !names.some((n) => /delet|approv|eligib|retain|clean/i.test(n)), names);
    const listed = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_runs', arguments: {} } }, session);
    const text = JSON.stringify(listed.data.result);
    ev.check('MCP list_runs exposes the approval of an approved run', text.includes(ok1) && text.includes('deletionApproval'), text.slice(0, 300));
    ev.check('MCP list_runs did not mark anything', (await approval(ok3)) === null && (await approval(later)) === null);
  } finally {
    mcp.kill();
  }

  // ------------------------------------------------ storage notice states and placement
  const notice = page.getByRole('status', { name: 'Storage pressure' });
  await page.goto(`${app}/loops`);
  await sleep(1000);
  ev.check('adequate storage: no notice', (await notice.count()) === 0);
  setCapacity(capacityFile, PRESSURE);
  const waitState = async (state) => {
    for (let i = 0; i < 150; i++) {
      const s = await api.storage();
      if (s.state === state && !s.cleaning) return s;
      await sleep(1000);
    }
    throw new Error('state ' + state + ' not reached');
  };
  let s = await waitState('pressure');
  ev.log('pressure pass', s);
  for (const route of ['loops', 'runs', 'events', 'settings', `runs/${ok2}`]) {
    await page.goto(`${app}/${route}`);
    await notice.waitFor({ timeout: 20_000 }).catch(() => undefined);
    const visible = await notice.isVisible();
    ev.log(`notice on /${route}: visible=${visible}`, visible ? JSON.stringify(await notice.innerText()) : '');
    if (route === 'loops') {
      ev.log('notice aria snapshot\n' + (await notice.ariaSnapshot()));
      ev.log('notice attributes', await notice.evaluate((el) => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), label: el.getAttribute('aria-label'), tag: el.tagName })));
      await shot('ui-notice-pressure-loops');
    }
  }
  s = await waitState('no-eligible');
  await page.goto(`${app}/runs`);
  await notice.waitFor({ timeout: 20_000 });
  ev.log('no-eligible notice', JSON.stringify(await notice.innerText()), s);
  await shot('ui-notice-no-eligible-runs');
  await notice.getByRole('link', { name: 'Review run history' }).click();
  ev.check('notice link leads to Runs', page.url().endsWith('/app/runs'), page.url());
  setCapacity(capacityFile, { mode: 'fail' });
  s = await waitState('unavailable');
  await page.reload();
  await notice.waitFor({ timeout: 20_000 });
  ev.log('unavailable notice', JSON.stringify(await notice.innerText()));
  setCapacity(capacityFile, ADEQUATE);
  s = await waitState('adequate');
  await page.reload();
  await sleep(1500);
  ev.check('adequate again: notice gone', (await notice.count()) === 0);
  ev.check('ok1/ok2 (approved) deleted under pressure; ok3/later retained', (await api.get(`/runs/${ok1}`)).status === 404 && (await api.get(`/runs/${ok2}`)).status === 404 && (await api.get(`/runs/${ok3}`)).status === 200 && (await api.get(`/runs/${later}`)).status === 200);

  // ------------------------------------------------ check 2: loop deletion confirmation (ADR-0033)
  const D = await api.createLoop(workLoop('UI deletable loop'));
  const d1 = (await api.startRun(D, { text: 'd1' })).id;
  const d2 = (await api.startRun(D, { text: '[[fail]] d2' })).id;
  for (const id of [d1, d2]) await api.waitFinal(id);
  await page.goto(`${app}/loops`);
  const del = page.getByRole('button', { name: 'Delete UI deletable loop' });
  await del.click();
  const confirmDialog = page.getByRole('alertdialog');
  await confirmDialog.waitFor();
  ev.log('loop delete dialog\n' + (await confirmDialog.ariaSnapshot()));
  await shot('ui-loop-delete-dialog');
  await page.keyboard.press('Escape');
  await confirmDialog.waitFor({ state: 'hidden' });
  ev.check('loop delete Escape keeps loop and runs', (await api.get(`/loops/${D}`)).status === 200 && (await api.get(`/runs/${d1}`)).status === 200);
  await del.click();
  await confirmDialog.getByRole('button', { name: /Confirm delete/ }).last().click();
  await confirmDialog.waitFor({ state: 'hidden' });
  ev.check('loop delete removes loop and its (unapproved) runs', (await api.get(`/loops/${D}`)).status === 404 && (await api.get(`/runs/${d1}`)).status === 404 && (await api.get(`/runs/${d2}`)).status === 404);
  // Active run refuses loop deletion.
  const del2 = page.getByRole('button', { name: 'Delete UI history' });
  await del2.click();
  await page.getByRole('alertdialog').getByRole('button', { name: /Confirm delete/ }).last().click();
  await page.getByRole('alertdialog').getByRole('alert').waitFor({ timeout: 10_000 }).catch(() => undefined);
  ev.log('loop with active run: dialog after confirm\n' + (await page.getByRole('alertdialog').ariaSnapshot().catch(() => 'closed')));
  ev.check('loop with an active run is not deleted', (await api.get(`/loops/${W}`)).status === 200 && (await api.get(`/runs/${active}`)).status === 200);
  await page.keyboard.press('Escape');
  // Child of a deleted parent loop survives with cleared parent association.
  const childBefore = await api.run(c1);
  await api.post(`/runs/${active}/cancel`);
  await api.waitFinal(active);
  const delP = await api.call('DELETE', `/loops/${P}`);
  const childAfter = await api.get(`/runs/${c1}`);
  ev.log('delete parent loop', delP.status, 'child before parent', childBefore.parentRunId, 'child after', childAfter.status, childAfter.json?.parentRunId ?? null);
  ev.check('deleting the parent loop keeps the child loop run, clears its parent', childAfter.status === 200 && !childAfter.json.parentRunId);
  await page.goto(`${app}/runs/${c1}`);
  await sleep(1500);
  ev.log('child inspector text mentioning parent', JSON.stringify((await page.getByText(/parent/i).allInnerTexts()).slice(0, 6)));
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  await shot('ui-error').catch(() => undefined);
} finally {
  try {
    for (const r of (await api.get('/runs?status=queued,running,waiting,paused&limit=50')).json.items) await api.post(`/runs/${r.id}/cancel`);
  } catch {}
  await browser.close();
  const stopped = await Promise.race([server.stop(), sleep(60_000).then(() => 'timeout')]);
  ev.log('server stop', stopped);
  if (stopped === 'timeout') ev.log('kill', await server.kill());
  ev.log('failures', ev.failures ?? 0);
}
