// Re-check of live-state scenario 4 with a corrected probe assertion. live-state.mjs looked for
// the taken route on the `decision.made` event, which does not carry it (the route is on the
// gate's `node.finished`), so its first check failed although the run behaved correctly. This
// re-runs the same scenario and reads the route from the gate's last completion.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, cycle, recordRequests, countByKind, inspectorState, HERE } from './lib.mjs';

const PORT = 6565;
const log = logger('gate-recheck.log.txt');
const data = await makeTemp('gate');
const results = {};
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  browser = await edge();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rec = recordRequests(context);
  const loop = await rest.createLoop(cycle({ name: 'QA gate limit', gateJsonata: '"again"', maxPasses: 150 }));
  const run = await rest.start(loop.loop.id);
  const page = await context.newPage();
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  const end = await rest.waitStatus(run.id, ['succeeded', 'failed', 'cancelled', 'exhausted'], { timeout: 120_000 });
  const events = await rest.allEvents(run.id);
  const gateFinish = events.filter((e) => e.type === 'node.finished' && e.nodeId === 'gate').at(-1);
  const obs = await rest('GET', `/runs/${run.id}/observation`);
  const thread = await rest('GET', `/runs/${run.id}/thread`);
  let ui;
  const t0 = Date.now();
  for (;;) {
    ui = await inspectorState(page);
    if ((ui.timeline.stream === 'complete' && ui.status === end.status && isDeepStrictEqual(ui.vars, thread.vars)) || Date.now() - t0 > 20_000) break;
    await delay(100);
  }
  const passes = obs.gate?.gate?.passes;
  results.run = run.id;
  results.end = { status: end.status, result: end.result, lastEventSeq: end.lastEventSeq };
  results.gateRoute = gateFinish?.route;
  results.observationGate = obs.gate?.gate;
  results.ui = { status: ui.status, timeline: ui.timeline, vars: ui.vars, exitCard: ui.exitCard };
  results.convergedMs = Date.now() - t0;
  results.threadAtReads = countByKind(rec.all)['thread?at'] ?? 0;
  results.ok =
    end.status === 'succeeded' &&
    end.result === 150 &&
    gateFinish?.route === 'limit-reached' &&
    passes === 150 &&
    ui.status === 'succeeded' &&
    ui.timeline.total === end.lastEventSeq &&
    isDeepStrictEqual(ui.vars, thread.vars) &&
    (ui.exitCard ?? '').includes('on pass 150 of 150') &&
    (ui.exitCard ?? '').includes('Limit reached') &&
    results.threadAtReads === 0;
  log(results.ok ? 'PASS' : 'FAIL', 'decision gate reaches its pass limit (corrected route check)', results);
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'gate-recheck.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
