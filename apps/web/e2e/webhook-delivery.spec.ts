import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = 'http://127.0.0.1:5806';
let child: ChildProcess;
let output = '';
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
    receiver.listen(5807, '127.0.0.1', ok);
  });
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-d2-browser-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GG_')) delete env[key];
  child = spawn(process.execPath, [resolve('../api/dist/main.js')], {
    windowsHide: true,
    env: {
      ...env,
      GG_DATA_DIR: dataDir,
      GG_HOST: '127.0.0.1',
      GG_PORT: '5806',
      GG_REQUIRE_API_KEY: 'false',
      GG_SWAGGER_UI: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
      GG_WEB_DIST: resolve('dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (bytes) => {
    output = (output + String(bytes)).slice(-10000);
  });
  child.stderr?.on('data', (bytes) => {
    output = (output + String(bytes)).slice(-10000);
  });
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null) throw Error(output);
        return fetch(base + '/healthz').then(
          (response) => response.ok,
          () => false,
        );
      },
      { timeout: 90_000 },
    )
    .toBe(true);
});
test.afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  receiver.closeAllConnections();
  await new Promise<void>((ok) => receiver.close(() => ok()));
});

test('inspector updates pending delivery to delivered without a reload while execution stays succeeded', async ({
  page,
  request,
}, testInfo) => {
  const made = await request.post(base + '/loops', {
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
              destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:5807/hook' }],
            },
          },
        ],
        edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      },
    },
  });
  expect(made.status()).toBe(201);
  const { loop } = (await made.json()) as { loop: { id: string } };
  expect((await request.post(base + '/loops/' + loop.id + '/publish', { data: {} })).ok()).toBe(
    true,
  );
  const started = await request.post(base + '/loops/' + loop.id + '/runs', {
    data: { input: { answer: 42 } },
  });
  const { run } = (await started.json()) as { run: { id: string } };
  await page.goto(base + '/app/runs/' + run.id);
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
