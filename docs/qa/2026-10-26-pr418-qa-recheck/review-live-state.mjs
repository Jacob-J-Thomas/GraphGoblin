import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  startApi,
  restClient,
  cycle,
  until,
  edge,
} from './lib.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'gg-qa-418r-review-state-'));
const states = [];
let server;
let browser;
try {
  server = await startApi({ port: 6615, dataDir, log: console.log });
  let api = restClient(server.url);
  const definition = cycle({ name: 'Review state convergence', passes: 2 });
  definition.nodes.push({
    id: 'answer',
    kind: 'wait',
    label: 'Answer',
    config: { mode: 'input', prompt: 'Continue?' },
  });
  definition.edges.find((item) => item.from.node === 'grow').to.node = 'answer';
  definition.edges.push({
    id: 'answer-gate',
    from: { node: 'answer', port: 'out' },
    to: { node: 'gate' },
  });
  const created = await api.createLoop(definition);
  const run = await api.start(created.loop.id);
  const record = () => api('GET', `/runs/${run.id}`);
  await until(async () => (await record()).status === 'waiting');
  browser = await edge();
  const page = await browser.newPage();
  const boundaries = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/runs/${run.id}/thread` && url.searchParams.has('at'))
      boundaries.push(url.searchParams.get('at'));
  });
  await page.goto(`${server.url}/app/runs/${run.id}`);
  await page.getByRole('button', { name: 'Full thread JSON', exact: true }).click();
  async function check(name, status, n) {
    await until(async () => (await record()).status === status);
    const expected = await api('GET', `/runs/${run.id}/thread`);
    await until(
      async () => {
        const text = await page
          .getByTestId('thread-json')
          .innerText()
          .catch(() => '');
        try {
          return JSON.stringify(JSON.parse(text)) === JSON.stringify(expected);
        } catch {
          return false;
        }
      },
      { what: `browser thread after ${name}` },
    );
    await page.locator(`[data-status="${status}"]`).first().waitFor();
    assert.equal(expected.vars.n, n);
    states.push({ name, status, n, browserThreadEqualsApi: true });
  }
  await check('initial wait', 'waiting', 1);
  await api('POST', `/runs/${run.id}/pause`);
  await check('paused', 'paused', 1);
  await api('POST', `/runs/${run.id}/resume`);
  await check('resumed wait', 'waiting', 1);
  await api('POST', `/runs/${run.id}/input`, {
    waitId: (await record()).waiting.waitId,
    input: 'first',
  });
  await until(async () => (await api('GET', `/runs/${run.id}/thread`)).vars.n === 2);
  await check('next visit', 'waiting', 2);
  await server.kill();
  server = await startApi({ port: 6615, dataDir, log: console.log });
  api = restClient(server.url);
  await check('gateway restart', 'waiting', 2);
  await api('POST', `/runs/${run.id}/input`, {
    waitId: (await record()).waiting.waitId,
    input: 'second',
  });
  await check('finished', 'succeeded', 2);
  await until(async () => Boolean((await record()).finalizedAt));
  assert.deepEqual(boundaries, []);
  const result = {
    states,
    historicalThreadRequests: boundaries,
    provider: 'none',
    data: 'disposable file-backed store',
  };
  console.log(JSON.stringify(result));
  await writeFile(
    join(import.meta.dirname, 'review-live-state.json'),
    JSON.stringify(result, null, 2),
  );
} finally {
  await browser?.close();
  if (server) await server.kill();
}
