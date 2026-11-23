import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunEvent } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { expect, publishLoop, test, uniqueLoopName } from './fixtures.js';

const evidence =
  'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-01/output/playwright';

test('independent S1/S2: BOTH read models held, then equal-sequence stale run released before observation', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, {
    ...minimalLoop(),
    name: uniqueLoopName('Independent held reads'),
  });
  const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
    )
    .toBe('succeeded');
  const events = (
    (await (await request.get(`/runs/${run.id}/events`)).json()) as { items: RunEvent[] }
  ).items;
  const finished = events.find((event) => event.type === 'run.finished')!;
  let runReads = 0;
  let heldRun = 0;
  let returnedRun = 0;
  let heldObservation = 0;
  let returnedObservation = 0;
  let releaseRun!: () => void;
  let releaseObservation!: () => void;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const observationGate = new Promise<void>((resolve) => {
    releaseObservation = resolve;
  });
  await page.route(
    (url) => url.pathname === `/runs/${run.id}/observation`,
    async (route) => {
      heldObservation++;
      await observationGate;
      const response = await route.fetch();
      await route.fulfill({ response });
      returnedObservation++;
    },
  );
  await page.route(
    (url) => url.pathname === `/runs/${run.id}`,
    async (route) => {
      runReads++;
      if (runReads > 1) {
        heldRun++;
        await runGate;
      }
      const response = await route.fetch();
      const {
        finishedAt: _finishedAt,
        finalizedAt: _finalizedAt,
        outcome: _outcome,
        result: _result,
        ...row
      } = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...row,
          status: 'running',
          currentNodeId: 'done',
          lastEventSeq: runReads === 1 ? finished.seq - 1 : finished.seq,
        },
      });
      returnedRun++;
    },
  );
  try {
    await page.goto(`/app/runs/${run.id}`);
    const timeline = page.getByRole('list', { name: 'Timeline' });
    await expect(timeline.getByRole('button', { name: /run\.finished.*succeeded/ })).toBeVisible();
    const header = page
      .locator('header')
      .filter({ has: page.getByRole('heading', { name: `Run ${run.id}` }) });
    await expect.poll(() => heldRun).toBeGreaterThan(0);
    expect(heldObservation).toBeGreaterThan(0);
    expect(returnedObservation).toBe(0);
    await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
    await page.screenshot({ path: join(evidence, 'S1-both-models-held.png'), fullPage: true });
    releaseRun();
    await expect.poll(() => returnedRun).toBeGreaterThan(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(returnedObservation).toBe(0);
    await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
    await expect(header.getByText(/^at /)).toHaveCount(0);
    await page.screenshot({
      path: join(evidence, 'S2-equal-sequence-stale-returned.png'),
      fullPage: true,
    });
    await writeFile(
      join(evidence, 'S1-S2-schedule.json'),
      JSON.stringify(
        {
          runId: run.id,
          terminal: finished,
          runReads,
          heldRun,
          returnedRun,
          heldObservation,
          returnedObservation,
        },
        null,
        2,
      ),
    );
    await writeFile(join(evidence, 'S2-rendered.html'), await page.content());
  } finally {
    releaseRun();
    releaseObservation();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const width of [1440, 390]) {
  test(`independent P1-P5: real recorded repeated appends and non-add diffs at ${width}px`, async ({
    page,
    request,
  }) => {
    const source = minimalLoop();
    const longMessage = '長'.repeat(6000);
    const definition = {
      ...source,
      name: uniqueLoopName(`Independent patch ${width}`),
      nodes: [
        source.nodes[0]!,
        {
          id: 'mutate',
          kind: 'mutate',
          label: 'Recorded changes',
          config: {
            operations: [
              { op: 'set', path: '/vars/items', value: { kind: 'literal', value: ['seed'] } },
              { op: 'append-message', role: 'note', content: 'first α' },
              { op: 'append-message', role: 'note', content: longMessage },
              ...[null, false, 0, { nested: [1, false, ['α', null]] }, ['inner']].map((value) => ({
                op: 'set',
                path: '/vars/items/-',
                value: { kind: 'literal', value },
              })),
              { op: 'set', path: '/vars/a~1b~0c', value: { kind: 'literal', value: [] } },
              { op: 'set', path: '/vars/a~1b~0c/-', value: { kind: 'literal', value: 'escaped' } },
              {
                op: 'set',
                path: '/vars/object',
                value: { kind: 'literal', value: { '-': 'old' } },
              },
              { op: 'set', path: '/vars/object/-', value: { kind: 'literal', value: 'new' } },
              { op: 'set', path: '/vars/replaced', value: { kind: 'literal', value: 'before' } },
              { op: 'set', path: '/vars/replaced', value: { kind: 'literal', value: 'after' } },
              { op: 'set', path: '/vars/removed', value: { kind: 'literal', value: 'gone' } },
              { op: 'delete', path: '/vars/removed' },
            ],
          },
          ui: { x: 260, y: 80 },
        },
        source.nodes[1]!,
      ],
      edges: [
        { id: 'qa1', from: { node: 'start', port: 'out' }, to: { node: 'mutate' } },
        { id: 'qa2', from: { node: 'mutate', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const loopId = await publishLoop(request, definition);
    const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
    expect(started.status()).toBe(202);
    const { run } = (await started.json()) as { run: { id: string } };
    await expect
      .poll(
        async () =>
          ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
      )
      .toBe('succeeded');
    const events = (
      (await (await request.get(`/runs/${run.id}/events`)).json()) as { items: RunEvent[] }
    ).items;
    const completed = events.find(
      (event) => event.type === 'node.finished' && event.nodeId === 'mutate',
    );
    if (completed?.type !== 'node.finished')
      throw new Error('Missing real recorded mutation completion');
    await writeFile(
      join(evidence, `P-${width}-recorded-events.json`),
      JSON.stringify(events, null, 2),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/runs/${run.id}`);
    await page
      .getByRole('list', { name: 'Timeline' })
      .getByRole('button', { name: /node\.finished Recorded changes \(mutate\)/ })
      .click();
    const diff = page.getByRole('list', { name: 'Patch diff' });
    await expect(diff).toBeVisible();
    const rows = diff.getByRole('listitem');
    await expect(rows).toHaveCount(completed.patch.length);
    let longIndex = -1;
    for (const [index, operation] of completed.patch.entries()) {
      const row = rows.nth(index);
      if (operation.op === 'add') {
        const text = JSON.stringify(operation.value, null, 2);
        if (text.length > 1024) {
          longIndex = index;
          await row
            .getByRole('button', { name: `Show all of Value after ${operation.path}`, exact: true })
            .click();
        }
        await expect(row.getByLabel(`Value after ${operation.path}`, { exact: true })).toHaveText(
          text,
        );
        if (
          operation.path === '/messages/-' ||
          operation.path === '/vars/items/-' ||
          operation.path === '/vars/a~1b~0c/-'
        ) {
          await expect(
            row.getByLabel(`Value before ${operation.path}`, { exact: true }),
          ).toHaveText('(absent)');
        }
      }
      if (operation.op === 'replace' && operation.path === '/vars/object/-') {
        await expect(row.getByLabel(`Value after ${operation.path}`, { exact: true })).toHaveText(
          '"new"',
        );
      }
      if (operation.op === 'remove')
        await expect(row.getByLabel(`Value after ${operation.path}`, { exact: true })).toHaveText(
          '(absent)',
        );
    }
    expect(longIndex).toBeGreaterThanOrEqual(0);
    // Patch diff values expose expansion; exact JSON download is on the selected full thread.
    // Use that existing public control and compare the appended record inside its saved bytes.
    await page.getByText('Full thread JSON', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download Full thread JSON as JSON', exact: true })
      .click();
    const download = await downloadPromise;
    const downloadedPath = join(evidence, `P-${width}-exact-appended-message.json`);
    await download.saveAs(downloadedPath);
    const recordedLong = completed.patch[longIndex]!;
    if (recordedLong.op !== 'add') throw new Error('Expected recorded add');
    const downloadedThread = JSON.parse(await readFile(downloadedPath, 'utf8')) as {
      messages: unknown[];
    };
    expect(downloadedThread.messages).toContainEqual(recordedLong.value);
    const dimensions = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({
      path: join(evidence, `P-${width}-rendered-diffs.png`),
      fullPage: true,
    });
    await writeFile(join(evidence, `P-${width}-rendered.html`), await page.content());
    await page
      .getByRole('list', { name: 'Timeline' })
      .getByRole('button', { name: /node\.finished Start \(start\)/ })
      .click();
    await expect(page.getByRole('list', { name: 'Patch diff' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Patch diff' }).getByText('/messages/-', { exact: true }),
    ).toHaveCount(0);
  });
}
