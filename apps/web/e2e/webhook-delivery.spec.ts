import { test, expect } from './fixtures.js';
import { createServer, type ServerResponse } from 'node:http';

let receiverUrl: string;
let acknowledge = false;
const held = new Set<ServerResponse>();
const receiver = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (acknowledge) res.writeHead(200).end('ack');
    else {
      held.add(res);
      res.once('close', () => held.delete(res));
    }
  });
});

test.beforeAll(async () => {
  await new Promise<void>((ok, no) => {
    receiver.once('error', no);
    receiver.listen(0, '127.0.0.1', ok);
  });
  const address = receiver.address();
  if (!address || typeof address === 'string') throw Error('Missing receiver address');
  receiverUrl = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => {
  receiver.closeAllConnections();
  await new Promise<void>((ok) => receiver.close(() => ok()));
});

test('inspector updates pending delivery to delivered without a reload while execution stays succeeded', async ({
  page,
  request,
}, testInfo) => {
  const made = await request.post('/loops', {
    data: {
      definition: {
        schemaVersion: 4,
        name: 'Browser webhook delivery',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              returns: 'trigger.payload',
              destinations: [{ kind: 'webhook', url: receiverUrl + '/hook' }],
            },
          },
        ],
        edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      },
    },
  });
  expect(made.status()).toBe(201);
  const { loop } = (await made.json()) as { loop: { id: string } };
  expect((await request.post('/loops/' + loop.id + '/publish', { data: {} })).ok()).toBe(true);
  const started = await request.post('/loops/' + loop.id + '/runs', {
    data: { input: { answer: 42 } },
  });
  const { run } = (await started.json()) as { run: { id: string } };
  await page.goto('/app/runs/' + run.id);
  await expect(
    page.getByText('Execution: succeeded. Delivery is tracked separately.'),
  ).toBeVisible();
  await expect(page.getByText(/Pending \(\d\/5 attempts\)/)).toBeVisible();
  await expect(page.getByText(/Delivery identity:/)).toBeVisible();
  acknowledge = true;
  for (const res of held) res.writeHead(200).end('ack');
  await expect(page.getByText(/Delivered after \d attempts?/)).toBeVisible();
  await expect(
    page.getByText('Execution: succeeded. Delivery is tracked separately.'),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('delivered.png'), fullPage: true });
});
