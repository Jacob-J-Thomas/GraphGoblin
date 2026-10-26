// #255 focused re-check: a cancelled run whose recorded cancellation request has been removed
// from the disposable store (storage fault). Waits for the observation read to settle, and
// records what GET /runs/{id}/observation returns.
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, until, edge_, HERE } from './lib.mjs';
import { manual } from './defs.mjs';

const PORT = 6450;
const log = logger('p255-unknown.log.txt');
const data = await makeTemp('255u');
const results = {};
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  let rest = restClient(api.url);
  const loop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Unknown actor',
    nodes: [manual(), { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'Waiting' } }, { id: 'finish', kind: 'exit', label: 'Finish', config: {} }],
    edges: [edge_('start', 'out', 'ask'), edge_('ask', 'out', 'finish')],
  });
  const run = await rest.start(loop.loop.id, {});
  await rest.waitStatus(run.id, ['waiting']);
  await rest('POST', `/runs/${run.id}/cancel`, {});
  await rest.waitStatus(run.id, ['cancelled']);
  results.observationBefore = await rest('GET', `/runs/${run.id}/observation`);
  await api.kill();
  const db = new DatabaseSync(join(data, 'graphgoblin.db'));
  results.removed = db.prepare("delete from run_events where run_id = ? and type = 'run.cancel_requested'").run(run.id).changes;
  db.close();
  api = await startApi({ port: PORT, dataDir: data, log });
  rest = restClient(api.url);
  const obs = await rest.status('GET', `/runs/${run.id}/observation`);
  results.observationAfter = { status: obs.status, body: obs.json };
  const events = await rest.status('GET', `/runs/${run.id}/events?after=0&limit=50`);
  results.eventsAfter = { status: events.status, types: events.json?.items?.map((e) => `${e.seq}:${e.type}`) };
  browser = await edge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  const region = page.getByRole('region', { name: 'Execution context' });
  await until(async () => !/Reading the cancellation record/.test(await region.innerText()), { timeout: 30_000, what: 'observation settled' }).catch(() => {});
  results.inspector = (await region.innerText()).replace(/\s+/g, ' ');
  results.ok = results.removed === 1 && results.inspector.includes('Cancelled; actor not recorded.');
  log(results.ok ? 'PASS' : 'FAIL', 'removed request -> "Cancelled; actor not recorded."', results);
  await page.screenshot({ path: join(HERE, 'p255-unknown-actor.png') });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p255-unknown.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
