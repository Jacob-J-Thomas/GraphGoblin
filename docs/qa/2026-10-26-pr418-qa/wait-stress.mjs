// Adversarial repeat of the "stale after the last event" case for a run that parks: the engine
// appends `run.waiting` before it records the waiting status on the run row, so a refresh that
// lands between the two would read a running run, and no later event would correct it until
// the input arrives. 15 runs each burst through 100 passes and park on an input wait while an
// inspector follows; each must show the waiting status and the Input requested panel within
// 3 s of the API reporting `waiting`, and keep showing them.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, cycle, edge_, inspectorState, HERE } from './lib.mjs';

const PORT = 6564;
const log = logger('wait-stress.log.txt');
const data = await makeTemp('wst');
const results = { runs: [] };
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const def = cycle({ name: 'QA wait stress', passes: 100 });
  def.nodes.splice(3, 0, { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'qa-418 prompt' } });
  def.edges = def.edges.map((e) => (e.id === 'gate-done-finish' ? edge_('gate', 'done', 'ask') : e));
  def.edges.push(edge_('ask', 'out', 'finish'));
  const loop = await rest.createLoop(def);
  browser = await edge();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (let i = 0; i < 15; i++) {
    const run = await rest.start(loop.loop.id);
    const page = await context.newPage();
    await page.goto(`${api.url}/app/runs/${run.id}`);
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
    const waiting = await rest.waitStatus(run.id, ['waiting'], { timeout: 60_000, interval: 50 });
    const t0 = Date.now();
    let shownAt;
    let ui;
    while (Date.now() - t0 < 3000) {
      ui = await inspectorState(page);
      const body = await page.locator('body').innerText();
      if (ui.status === 'waiting' && body.includes('Input requested')) {
        shownAt = Date.now() - t0;
        break;
      }
      await delay(50);
    }
    await delay(2000);
    const later = await inspectorState(page);
    const laterBody = await page.locator('body').innerText();
    const entry = { i, runId: run.id, shownWithinMs: shownAt, stillWaitingAfter2s: later.status === 'waiting' && laterBody.includes('Input requested'), uiStatusIfMissed: shownAt === undefined ? ui?.status : undefined };
    results.runs.push(entry);
    log(entry);
    await rest('POST', `/runs/${run.id}/input`, { waitId: waiting.waiting.waitId, input: { i } });
    await rest.waitStatus(run.id, ['succeeded', 'failed'], { timeout: 60_000 });
    await page.close();
  }
  results.ok = results.runs.every((r) => r.shownWithinMs !== undefined && r.stillWaitingAfter2s);
  log(results.ok ? 'PASS' : 'FAIL', 'every parked run showed waiting and the Input requested panel within 3 s and kept them', {
    maxMs: Math.max(...results.runs.map((r) => r.shownWithinMs ?? Infinity)),
  });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'wait-stress.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
