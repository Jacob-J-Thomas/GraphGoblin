import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { APIRequestContext } from '@playwright/test';
import { expect, publishLoop, test, uniqueLoopName } from './fixtures.js';

interface RecordedEvent {
  seq: number;
  type: string;
  status?: string;
}

/** An ordinary run of a published minimal loop on the disposable API, and its recorded finish. */
async function finishedRun(request: APIRequestContext) {
  const loopId = await publishLoop(request, {
    ...minimalLoop(),
    name: uniqueLoopName('Header truthfulness'),
  });
  const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
      { timeout: 30_000 },
    )
    .toBe('succeeded');
  const page = (await (await request.get(`/runs/${run.id}/events`)).json()) as {
    items: RecordedEvent[];
  };
  const terminal = page.items.find((item) => item.type === 'run.finished');
  if (!terminal) throw new Error('the run recorded no run.finished event');
  return { runId: run.id, terminal };
}

for (const lag of ['held', 'stale'] as const) {
  test(`the header shows the outcome the Timeline shows while the run record ${
    lag === 'held' ? 'refresh is held' : 'still says running at the outcome sequence'
  } (#386)`, async ({ page, request }) => {
    const { runId, terminal } = await finishedRun(request);
    expect(terminal.status).toBe('succeeded');
    let reads = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The record as read before the outcome's status projection: still running, at its
    // position, one event before the outcome or exactly at it.
    await page.route(
      (url) => url.pathname === `/runs/${runId}`,
      async (route) => {
        reads += 1;
        if (lag === 'held' && reads > 1) await held;
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
            lastEventSeq: lag === 'held' ? terminal.seq - 1 : terminal.seq,
          },
        });
      },
    );
    try {
      await page.goto(`/app/runs/${runId}`);
      const timeline = page.getByRole('list', { name: 'Timeline' });
      await expect(
        timeline.getByRole('button', { name: /run\.finished.*succeeded/ }),
      ).toBeVisible();
      const header = page
        .locator('header')
        .filter({ has: page.getByRole('heading', { name: `Run ${runId}` }) });
      await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
      await expect(
        header.getByText(`Status from event #${terminal.seq}; the run record is updating.`, {
          exact: true,
        }),
      ).toBeVisible();
      // The stale record's position is not claimed beside the outcome.
      await expect(header.getByText(/^at /)).toHaveCount(0);
      if (lag === 'held') await expect.poll(() => reads).toBeGreaterThan(1);
      else expect(reads).toBeGreaterThan(0);
    } finally {
      release();
      // Finish every released route before Playwright disposes this page's request context.
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
