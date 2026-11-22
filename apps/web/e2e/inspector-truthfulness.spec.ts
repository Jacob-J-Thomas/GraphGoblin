import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { APIRequestContext, Request } from '@playwright/test';
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
  const response = await request.get(`/runs/${run.id}`);
  expect(response.status()).toBe(200);
  const {
    finishedAt: _finishedAt,
    finalizedAt: _finalizedAt,
    outcome: _outcome,
    result: _result,
    ...row
  } = (await response.json()) as Record<string, unknown>;
  return { runId: run.id, terminal, row };
}

for (const lag of ['held', 'stale'] as const) {
  test(`the header shows the outcome the Timeline shows while the run record ${
    lag === 'held' ? 'refresh is held' : 'still says running at the outcome sequence'
  } (#386)`, async ({ page, request }) => {
    const { runId, terminal, row } = await finishedRun(request);
    expect(terminal.status).toBe('succeeded');
    let reads = 0;
    const runRequests: Request[] = [];
    let returnedReads = 0;
    let observationReads = 0;
    let returnedObservations = 0;
    let activeRoutes = 0;
    let releaseRun!: () => void;
    let releaseObservation!: () => void;
    const heldRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const heldObservation = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    // Neither read model can supply the outcome before the streamed event does.
    await page.route(
      (url) => url.pathname === `/runs/${runId}/observation`,
      async (route) => {
        observationReads += 1;
        activeRoutes += 1;
        try {
          await heldObservation;
          await route.continue();
          returnedObservations += 1;
        } finally {
          activeRoutes -= 1;
        }
      },
    );
    // The record as read before the outcome's status projection: still running, at its
    // position, one event before the outcome or exactly at it. Capture the real row once,
    // so released handlers do not fetch through a request context being torn down.
    await page.route(
      (url) => url.pathname === `/runs/${runId}`,
      async (route) => {
        const read = ++reads;
        runRequests.push(route.request());
        activeRoutes += 1;
        try {
          if (read > 1) await heldRun;
          await route.fulfill({
            json: {
              ...row,
              status: 'running',
              currentNodeId: 'done',
              lastEventSeq: read === 1 && lag === 'held' ? terminal.seq - 1 : terminal.seq,
            },
          });
          returnedReads += 1;
        } finally {
          activeRoutes -= 1;
        }
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
      await expect.poll(() => reads).toBeGreaterThan(1);
      expect(observationReads).toBeGreaterThan(0);
      expect(returnedObservations).toBe(0);
      expect(returnedReads).toBe(1);

      // Complete a stale refresh at the outcome sequence while observations remain held.
      // Wait for every held browser response body and rendering before checking again;
      // this covers both the run query and the attempt follower's overlapping reads.
      const heldReads = reads;
      const refreshed = Promise.all(runRequests.slice(1).map((read) => read.response()));
      releaseRun();
      for (const response of await refreshed) {
        if (!response) throw new Error('a held run refresh ended without a response');
        expect(await response.finished()).toBeNull();
        expect(await response.json()).toMatchObject({
          status: 'running',
          lastEventSeq: terminal.seq,
        });
      }
      await expect.poll(() => returnedReads).toBeGreaterThanOrEqual(heldReads);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(returnedObservations).toBe(0);
      await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
      await expect(
        header.getByText(`Status from event #${terminal.seq}; the run record is updating.`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(header.getByText(/^at /)).toHaveCount(0);
    } finally {
      releaseRun();
      releaseObservation();
      // Stop the inspector creating more reads, then finish callbacks before removing routes.
      await page.goto('about:blank');
      await expect.poll(() => activeRoutes).toBe(0);
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
