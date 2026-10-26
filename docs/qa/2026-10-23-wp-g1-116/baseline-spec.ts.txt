import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { ContextThreadSchema, RunRecordSchema, type ContextThread } from '@graphgoblin/contracts';
import { test, expect, type Page } from '@playwright/test';

test('open and reloaded inspectors follow persisted failure, resume and success with delayed snapshots', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const child = spawn(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', 'scripts/thread-history-server.ts'],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const ready = await new Promise<{ url: string; loopId: string }>((resolveReady, reject) => {
    let bytes = '';
    const timer = setTimeout(
      () => reject(new Error('Fixture server startup exceeded 60s')),
      60_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.toString();
      if (bytes.includes('\n')) {
        clearTimeout(timer);
        resolveReady(JSON.parse(bytes.trim()) as { url: string; loopId: string });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Fixture exited: ' + code));
    });
  });
  const control = async (path: string) => {
    const response = await request.get('http://127.0.0.1:5931' + path);
    expect(response.ok()).toBe(true);
    return (await response.json()) as { snapshot: ContextThread; bytes: string };
  };
  const context = await browser.newContext();
  const open = await context.newPage();
  const reloaded = await context.newPage();
  const observations: {
    step: string;
    api: ContextThread;
    existing: ContextThread;
    reload: ContextThread;
    snapshot: ContextThread;
    readsUnchanged: boolean;
    status: string;
  }[] = [];
  try {
    const response = await request.post(ready.url + '/loops/' + ready.loopId + '/runs', {
      data: {},
    });
    expect(response.status()).toBe(202);
    const run = RunRecordSchema.parse((await response.json()).run);
    for (const page of [open, reloaded]) {
      await page.bringToFront();
      await page.goto(ready.url + '/app/runs/' + run.id);
      await page.getByRole('button', { name: 'Full thread JSON' }).click();
    }
    await control('/start');
    async function browserThread(page: Page) {
      await page.bringToFront();
      return ContextThreadSchema.parse(
        JSON.parse(await page.getByTestId('thread-json').innerText()),
      );
    }
    async function check(step: string) {
      const before = await control('/snapshot/' + run.id);
      const api = ContextThreadSchema.parse(
        await (await request.get(ready.url + '/runs/' + run.id + '/thread')).json(),
      );
      const record = RunRecordSchema.parse(
        await (await request.get(ready.url + '/runs/' + run.id)).json(),
      );
      // Diagnostic sampling records all baseline steps before the final assertions.
      await open.waitForTimeout(3500);
      const existing = await browserThread(open);
      await reloaded.reload();
      await reloaded.getByRole('button', { name: 'Full thread JSON' }).click();
      await reloaded.waitForTimeout(3500);
      const reload = await browserThread(reloaded);
      const after = await control('/snapshot/' + run.id);
      observations.push({
        step,
        status: record.status,
        api,
        existing,
        reload,
        snapshot: after.snapshot,
        readsUnchanged: before.bytes === after.bytes,
      });
    }
    await check('failed');
    expect((await request.post(ready.url + '/runs/' + run.id + '/resume')).ok()).toBe(true);
    await control('/working');
    await check('resumed-unfinished');
    await control('/release');
    await check('succeeded');
    await control('/flush');
    if (process.env['GG_THREAD_EVIDENCE'])
      await writeFile(process.env['GG_THREAD_EVIDENCE'], JSON.stringify(observations, null, 2));
    for (const item of observations) {
      const expected = {
        prepared: true,
        ...(item.step === 'succeeded' ? { completed: true } : {}),
      };
      expect(item.api.vars, item.step).toEqual(expected);
      expect(item.existing, item.step).toEqual(item.api);
      expect(item.reload, item.step).toEqual(item.api);
      expect(item.readsUnchanged, item.step).toBe(true);
    }
  } finally {
    await context.close();
    const stopped = once(child, 'exit');
    child.stdin.end('stop\n');
    await stopped;
  }
});
