// Follow-up to history.mjs section D, whose probe read the thread heading before the new
// selection's read finished and so compared the wrong boundary. This re-check:
//  1. repeats D with the boundary taken from the clicked row (decision.made and node.started
//     selections read only their own boundary, show its exact thread and no patch diff);
//  2. records what the thread panel shows WHILE a selection's read is pending, after an earlier
//     selection was left with Follow live. Every `thread?at` response is delayed by 2 s in the
//     browser (Playwright routing) so the pending state is long enough to sample; the server and
//     the product code are untouched. docs/09 says a pending read "leaves the preceding thread
//     mounted with its own label and an explicit reading note".
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle, recordRequests, inspectorState, HERE } from './lib.mjs';

const PORT = 6617; // 6616 is a fetch "bad port" (SANE), refused by fetch and browsers
const log = logger('pending-read.log.txt');
const data = await makeTemp('pend');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loop = await rest.createLoop(cycle({ name: 'QA pending read' }));
  const run = await rest.start(loop.loop.id);
  await until(async () => (await rest.run(run.id)).lastEventSeq >= 1500, { timeout: 120_000, what: '1,500 events' });
  browser = await edge();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rec = recordRequests(context);
  const page = await context.newPage();
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  await delay(1500);
  const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
  const finishedReads = async (seq) => {
    await page.getByRole('heading', { name: `Thread at event ${seq}` }).waitFor({ timeout: 30_000 });
    await until(async () => !(await inspectorState(page)).reading.some((r) => r.startsWith('Reading the thread')), { timeout: 30_000, what: 'read finished' });
  };

  // 1. Corrected section D.
  for (const [label, pattern] of [['decision.made', /decision\.made/], ['node.started', /node\.started Grow/]]) {
    const row = timeline.getByRole('button', { name: pattern }).last();
    const seq = Number(await row.getAttribute('data-seq'));
    const t = Date.now();
    await row.click();
    await finishedReads(seq);
    const st = await inspectorState(page);
    const apiAt = await rest('GET', `/runs/${run.id}/thread?at=${seq}`);
    const reads = rec.since(t, run.id).filter((r) => r.kind === 'thread?at').map((r) => r.at);
    check(`selected ${label}: shows the exact thread at its boundary, reads only that boundary, no patch diff`, isDeepStrictEqual(st.vars, apiAt.vars) && isDeepStrictEqual(reads, [seq]) && !st.patchDiff && st.threadHeading === `Thread at event ${seq}`, {
      seq, reads, uiVars: st.vars, apiVars: apiAt.vars, heading: st.threadHeading, patchDiff: st.patchDiff,
    });
    await page.getByRole('button', { name: 'Follow live' }).click();
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
    await delay(1000);
  }

  // 2. The pending state of a new selection after an earlier selection was left.
  //    a. Select a Grow completion (seq A) and let it load; b. Follow live and let the run move
  //    on; c. with thread?at responses delayed, select a newer completion (seq B) and sample.
  const first = timeline.getByRole('button', { name: /node\.finished Grow \(grow\)/ }).last();
  const seqA = Number(await first.getAttribute('data-seq'));
  await first.click();
  await finishedReads(seqA);
  const atA = await rest('GET', `/runs/${run.id}/thread?at=${seqA}`);
  await page.getByRole('button', { name: 'Follow live' }).click();
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
  await delay(8000);
  const beforeClick = await inspectorState(page);
  await page.route('**/thread?at=*', async (route) => {
    await delay(2000);
    await route.continue();
  });
  const second = timeline.getByRole('button', { name: /node\.finished Grow \(grow\)/ }).last();
  const seqB = Number(await second.getAttribute('data-seq'));
  await second.click();
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const st = await inspectorState(page);
    samples.push({ ms: i * 150, heading: st.threadHeading, reading: st.reading.filter((r) => r.startsWith('Reading')), varsN: st.vars?.n, patchDiff: Boolean(st.patchDiff), currentRow: st.currentRow });
    if (i === 3) await page.screenshot({ path: join(HERE, 'pending-read-during.png') });
    await delay(150);
  }
  await finishedReads(seqB);
  const after = await inspectorState(page);
  const atB = await rest('GET', `/runs/${run.id}/thread?at=${seqB}`);
  await page.unroute('**/thread?at=*');
  const pending = samples.filter((s) => s.reading.length > 0);
  const shownOldSelection = pending.some((s) => s.heading === `Thread at event ${seqA}`);
  results.pending = { seqA, seqB, varsAtA: atA.vars, varsAtB: atB.vars, panelJustBeforeClick: { heading: beforeClick.threadHeading, varsN: beforeClick.vars?.n }, samples, after: { heading: after.threadHeading, varsN: after.vars?.n, patchTitle: after.patchTitle } };
  check('while a new selection reads, the panel keeps the preceding thread (the current thread) with a reading note, not an older selection', !shownOldSelection && pending.length > 0, {
    seqA, seqB, precedingPanel: { heading: beforeClick.threadHeading, varsN: beforeClick.vars?.n }, pendingSamples: pending.slice(0, 4),
  });
  check('after the read: exact thread at B with its patch diff', after.threadHeading === `Thread at event ${seqB}` && isDeepStrictEqual(after.vars, atB.vars) && Boolean(after.patchDiff), {
    heading: after.threadHeading, uiVars: after.vars, apiVars: atB.vars,
  });
  await page.getByRole('button', { name: 'Follow live' }).click();
  await rest('POST', `/runs/${run.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'pending-read.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
