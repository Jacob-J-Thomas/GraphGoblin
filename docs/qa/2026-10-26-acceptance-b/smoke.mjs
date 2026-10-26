// Harness smoke check: built API, fake Codex, MCP stdio and Edge all start and agree.
import {
  makeTemp, removeTemp, compileFakeCodex, startApi, restClient, mcpClient, edge, logger, edge_,
} from './lib.mjs';

const log = logger('smoke.log.txt');
const data = await makeTemp('smoke');
let api;
try {
  const codex = await compileFakeCodex(data);
  api = await startApi({ port: 6450, dataDir: data, codex, log });
  const rest = restClient(api.url);
  const created = await rest.createLoop({
    schemaVersion: 4,
    name: 'Smoke',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'work', kind: 'inference', label: 'Work', config: { prompt: { template: 'fake' } } },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput' } },
    ],
    edges: [edge_('start', 'out', 'work'), edge_('work', 'out', 'done')],
  });
  const run = await rest.start(created.loop.id, {});
  const finished = await rest.waitStatus(run.id, ['succeeded', 'failed']);
  log('run', finished.status, finished.result, finished.failure ?? null, 'finalizedAt', finished.finalizedAt);
  const mcp = await mcpClient(api.url);
  const viaMcp = await mcp.call('get_run', { runId: run.id });
  log('mcp get_run status', viaMcp.status ?? viaMcp.run?.status, Object.keys(viaMcp));
  await mcp.close();
  const browser = await edge();
  const page = await browser.newPage();
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.getByText('Fully finalized.').waitFor({ timeout: 15000 });
  log('browser shows', await page.getByRole('status').first().textContent());
  await browser.close();
} finally {
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
