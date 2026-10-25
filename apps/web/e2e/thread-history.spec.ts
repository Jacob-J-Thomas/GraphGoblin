import { writeFile } from 'node:fs/promises';
import { ContextThreadSchema, RunRecordSchema, type ContextThread } from '@graphgoblin/contracts';
import type { Page } from '@playwright/test';
import { test, expect, control } from './fixtures.js';

test('open and reloaded inspectors follow persisted failure, resume and success with delayed snapshots', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const instance = await control(request, '/apps', { threadHistory: true });
  const ready = { url: String(instance['url']), loopId: String(instance['loopId']) };
  const action = (name: string, runId?: string) =>
    control(request, '/thread-history', {
      instanceId: instance['instanceId'],
      action: name,
      runId,
    });
  const context = await browser.newContext();
  try {
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
    await action('start');
    async function browserThread(page: Page) {
      await page.bringToFront();
      return ContextThreadSchema.parse(
        JSON.parse(await page.getByTestId('thread-json').innerText()),
      );
    }
    /**
     * The browser thread once it equals `expected`, keeping the value that matched: a live refresh
     * can re-render the bounded JSON (briefly showing its preparing note) before a second read.
     */
    async function matchedThread(page: Page, expected: ContextThread) {
      let last: unknown;
      await expect.poll(async () => (last = await browserThread(page))).toEqual(expected);
      return ContextThreadSchema.parse(last);
    }
    async function snapshot() {
      const value = await action('snapshot', run.id);
      if (typeof value['bytes'] !== 'string') throw new Error('Missing stored bytes');
      return { snapshot: ContextThreadSchema.parse(value['snapshot']), bytes: value['bytes'] };
    }
    async function check(step: string) {
      const before = await snapshot();
      const api = ContextThreadSchema.parse(
        await (await request.get(ready.url + '/runs/' + run.id + '/thread')).json(),
      );
      const record = RunRecordSchema.parse(
        await (await request.get(ready.url + '/runs/' + run.id)).json(),
      );
      const existing = await matchedThread(open, api);
      // Drive the active renderer, as the two-tab draft fixture does: background reloads can
      // finish navigation while leaving the following UI wait stalled until activation.
      await reloaded.bringToFront();
      await reloaded.reload();
      await reloaded.getByRole('button', { name: 'Full thread JSON' }).click();
      const reload = await matchedThread(reloaded, api);
      const after = await snapshot();
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
    // Lose the transport while both tabs hold a terminal event, then resume from another client.
    const failedPoll = context.waitForEvent('requestfailed', {
      predicate: (request) => request.url().startsWith(ready.url + '/runs/' + run.id),
    });
    await context.setOffline(true);
    const outage = await failedPoll;
    expect(outage.failure()?.errorText).toBeTruthy();
    expect((await request.post(ready.url + '/runs/' + run.id + '/resume')).ok()).toBe(true);
    await action('working');
    await context.setOffline(false);
    await check('resumed-unfinished');
    await action('release');
    await check('succeeded');
    await action('flush');
    if (process.env['GG_THREAD_EVIDENCE'])
      await writeFile(
        process.env['GG_THREAD_EVIDENCE'],
        JSON.stringify(
          { outage: { url: outage.url(), error: outage.failure()?.errorText }, observations },
          null,
          2,
        ),
      );
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
  }
});
