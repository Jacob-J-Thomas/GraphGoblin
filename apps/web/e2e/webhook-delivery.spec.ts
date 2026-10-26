import { test, expect, control, publishLoop } from './fixtures.js';
import { createServer, type ServerResponse } from 'node:http';

let receiverUrl: string;
let acknowledge = false;
let acknowledgementStatus = 200;
const uncertainRequests: string[] = [];
const held = new Set<ServerResponse>();
const receiver = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (req.url === '/uncertainty') {
      uncertainRequests.push(String(req.headers['idempotency-key']));
      if (uncertainRequests.length === 1) {
        res.writeHead(200, { 'content-length': '100' });
        res.write('partial');
        setTimeout(() => res.destroy(), 5);
      } else res.writeHead(uncertainRequests.length === 2 ? 429 : 200).end('ack');
      return;
    }
    if (acknowledge) res.writeHead(acknowledgementStatus).end('ack');
    else {
      held.add(res);
      res.once('close', () => held.delete(res));
    }
  });
});

test('inspector retains unknown acknowledgement after a rejection and eventual success', async ({
  page,
  request,
}) => {
  const made = await request.post('/loops', {
    data: {
      definition: {
        schemaVersion: 4,
        name: 'Uncertainty across three attempts',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              returns: 'trigger.payload',
              destinations: [{ kind: 'webhook', url: receiverUrl + '/uncertainty' }],
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
  const { run } = (await (
    await request.post('/loops/' + loop.id + '/runs', { data: { input: 42 } })
  ).json()) as { run: { id: string } };
  await page.goto('/app/runs/' + run.id);
  await expect(page.getByText('Delivered after 3 attempts')).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole('region', { name: 'Webhook delivery' }).getByText(/HTTP 429/),
  ).toBeVisible();
  await expect(page.getByText(/An acknowledgement was unknown/)).toBeVisible();
  expect(uncertainRequests).toHaveLength(3);
  expect(new Set(uncertainRequests).size).toBe(1);
  expect((await (await request.get('/runs/' + run.id)).json()).deliveries[0]).toMatchObject({
    status: 'delivered',
    attempts: 3,
    acknowledgement: 'accepted',
    acknowledgementUncertain: true,
    lastError: { httpStatus: 429, acknowledgement: 'rejected' },
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

for (const finalStatus of [200, 400]) {
  test(
    'inspector finalizes HTTP ' + finalStatus + ' without a reload while execution stays succeeded',
    async ({ page, request }, testInfo) => {
      acknowledge = false;
      acknowledgementStatus = finalStatus;
      const made = await request.post('/loops', {
        data: {
          definition: {
            schemaVersion: 4,
            name: 'Browser webhook delivery ' + finalStatus,
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
      await expect(page.getByRole('heading', { name: /^Timeline .*live\)/ })).toBeVisible();
      await expect(page.getByText('Execution ended; finalization pending.')).toBeVisible();
      acknowledge = true;
      for (const res of held) res.writeHead(finalStatus).end('ack');
      await expect(
        page.getByText(
          finalStatus === 200 ? /Delivered after \d attempts?/ : /Failed after \d attempts?/,
        ),
      ).toBeVisible();
      await expect(
        page.getByText('Execution: succeeded. Delivery is tracked separately.'),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Timeline .*complete\)/ })).toBeVisible();
      await expect(page.getByText('Fully finalized.')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('delivered.png'), fullPage: true });
    },
  );
}

test('remote resume that finishes between polls stays live while its webhook is pending', async ({
  page,
  request,
}) => {
  acknowledge = false;
  acknowledgementStatus = 200;
  await control(request, '/harness/script', {
    turns: [
      { error: { code: 'TURN_FAILED', message: 'controlled resumable failure' } },
      { finalText: 'recovered without a provider call' },
    ],
  });
  const loopId = await publishLoop(request, {
    schemaVersion: 4,
    name: 'Remote resume delivery completion',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'controlled turn' } },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          returns: 'trigger.payload',
          destinations: [{ kind: 'webhook', url: receiverUrl + '/remote' }],
        },
      },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  });
  const { run } = (await (
    await request.post('/loops/' + loopId + '/runs', { data: { input: 42 } })
  ).json()) as { run: { id: string } };
  try {
    await page.goto('/app/runs/' + run.id);
    await expect(page.getByRole('heading', { name: /^Timeline .*complete\)/ })).toBeVisible();
    expect(
      (
        await request.post('/runs/' + run.id + '/resume', {
          data: {
            observedSeq: (
              (await (await request.get('/runs/' + run.id)).json()) as {
                recovery: { observedSeq: number };
              }
            ).recovery.observedSeq,
          },
        })
      ).ok(),
    ).toBe(true);
    await expect(page.getByText(/Pending \(\d\/5 attempts\)/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Timeline .*live\)/ })).toBeVisible();
    acknowledge = true;
    for (const res of held) res.writeHead(200).end('ack');
    await expect(page.getByText(/Delivered after \d attempts?/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Timeline .*complete\)/ })).toBeVisible();
  } finally {
    acknowledge = true;
    for (const res of held) res.writeHead(200).end('ack');
  }
});
