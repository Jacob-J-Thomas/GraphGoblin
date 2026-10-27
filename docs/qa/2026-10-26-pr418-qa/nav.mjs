// Check 2 and 3, adversarial navigation: one tab moves between a parent and its running child
// through the inspector's own links while a selection is active, reloads mid-run, and must end
// with every panel equal to the API. Exercises the live refresh across a run change in the
// same page (selection on the parent, current thread on the child) and the restored selection
// when the reader comes back to the parent.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle, edge_,
  recordRequests, countByKind, inspectorState, HERE,
} from './lib.mjs';

const PORT = 6564;
const log = logger('nav.log.txt');
const data = await makeTemp('nav');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'exhausted'];
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);

  /** Poll until the page equals the API for a terminal run; then hold 3 s. */
  const settle = async (page, runId) => {
    const same = async () => {
      const [ui, run, thread] = await Promise.all([inspectorState(page), rest.run(runId), rest('GET', `/runs/${runId}/thread`)]);
      const ok =
        ui.status === run.status &&
        ui.timeline.total === run.lastEventSeq &&
        ui.timeline.stream === 'complete' &&
        ui.lastRow === run.lastEventSeq &&
        ui.threadHeading === 'Current thread' &&
        isDeepStrictEqual(ui.vars, thread.vars);
      return { ok, ui: { status: ui.status, timeline: ui.timeline, lastRow: ui.lastRow, heading: ui.threadHeading, vars: ui.vars }, api: { status: run.status, lastEventSeq: run.lastEventSeq, vars: thread.vars } };
    };
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < 20_000) {
      last = await same();
      if (last.ok) break;
      await delay(100);
    }
    if (!last.ok) return { ok: false, stale: last };
    const convergedMs = Date.now() - t0;
    for (let i = 0; i < 12; i++) {
      const again = await same();
      if (!again.ok) return { ok: false, convergedMs, regressed: again };
      await delay(250);
    }
    return { ok: true, convergedMs, ...last };
  };

  const child = await rest.createLoop(cycle({ name: 'QA nav child', passes: 1500 }));
  const parent = await rest.createLoop({
    schemaVersion: 4,
    name: 'QA nav parent',
    settings: { maxNodeVisits: null },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: child.loop.id } } },
      { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars.n' } },
    ],
    edges: [edge_('start', 'out', 'sub'), edge_('sub', 'out', 'finish')],
  });
  const run = await rest.start(parent.loop.id);
  const childRun = await until(async () => (await rest('GET', `/runs?parent=${run.id}`)).items[0], { timeout: 30_000, what: 'child run' });
  browser = await edge();
  results.edgeVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rec = recordRequests(context);
  const page = await context.newPage();
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });

  // 1. Select the parent's child_run.started, then follow the Child run link in the same tab.
  const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
  await timeline.getByRole('button', { name: /child_run\.started/ }).first().click();
  const sel = page.getByRole('heading', { name: /^Thread at event \d+$/ });
  await sel.waitFor({ timeout: 30_000 });
  const selectedSeq = Number(/\d+/.exec((await sel.textContent()) ?? '')?.[0]);
  const childCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Child run' }) });
  await childCard.getByRole('link').first().click();
  await page.waitForURL(`**/runs/${childRun.id}`);
  const tChild = Date.now();
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
  await delay(3000);
  const c1 = await inspectorState(page);
  await delay(2000);
  const c2 = await inspectorState(page);
  const childThread = await rest('GET', `/runs/${childRun.id}/thread`);
  const childReads = countByKind(rec.since(tChild).filter((r) => r.runId === childRun.id));
  check('SPA navigation from a parent with a selection to its running child: child follows live, current thread advances, no thread?at', c2.threadHeading === 'Current thread' && c2.vars?.n > c1.vars?.n && Math.abs(childThread.vars.n - c2.vars.n) < 200 && !childReads['thread?at'] && c2.status === 'running', {
    c1: { heading: c1.threadHeading, n: c1.vars?.n, status: c1.status }, c2: { heading: c2.threadHeading, n: c2.vars?.n }, apiN: childThread.vars.n, childReads,
  });

  // 2. Back to the parent through its header link: the parent's selection is restored.
  const tParent = Date.now();
  await page.getByRole('link', { name: 'parent run' }).click();
  await page.waitForURL(`**/runs/${run.id}`);
  await delay(2500);
  const p1 = await inspectorState(page);
  const parentAt = await rest('GET', `/runs/${run.id}/thread?at=${selectedSeq}`);
  const parentApi = await rest.run(run.id);
  check('back on the parent: its selection is restored with the exact thread; the header still tracks the run', p1.threadHeading === `Thread at event ${selectedSeq}` && isDeepStrictEqual(p1.vars, parentAt.vars) && p1.status === parentApi.status && p1.followLiveEnabled === true, {
    heading: p1.threadHeading, uiVars: p1.vars, apiAt: parentAt.vars, uiStatus: p1.status, apiStatus: parentApi.status, readsSinceReturn: countByKind(rec.since(tParent).filter((r) => r.runId === run.id)),
  });
  await page.getByRole('button', { name: 'Follow live' }).click();
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });

  // 3. Reload mid-run, then wait for the child and the parent to finish.
  await page.reload();
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  const reloaded = await inspectorState(page);
  const childEnd = await rest.waitStatus(childRun.id, TERMINAL, { timeout: 240_000 });
  const parentEnd = await rest.waitStatus(run.id, TERMINAL, { timeout: 60_000 });
  const sParent = await settle(page, run.id);
  check('after a mid-run reload the parent inspector ends equal to the API (status, count, current thread with the child result)', parentEnd.status === 'succeeded' && sParent.ok, {
    reloaded: { heading: reloaded.threadHeading, status: reloaded.status, timeline: reloaded.timeline }, parentEnd: { status: parentEnd.status, result: parentEnd.result }, childEnd: { status: childEnd.status, result: childEnd.result }, settle: sParent,
  });

  // 4. The child's page in the same tab, after it finished: equal to the API.
  await page.goto(`${api.url}/app/runs/${childRun.id}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  const sChild = await settle(page, childRun.id);
  check('finished child inspector equals the API', sChild.ok, { settle: sChild });
  results.requests = countByKind(rec.all);
  results.threadAtReads = rec.all.filter((r) => r.kind === 'thread?at').map((r) => ({ runId: r.runId === run.id ? 'parent' : 'child', at: r.at }));
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  results.ok = !results.error && results.checks.every((c) => c.ok);
  await writeFile(join(HERE, 'nav.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
