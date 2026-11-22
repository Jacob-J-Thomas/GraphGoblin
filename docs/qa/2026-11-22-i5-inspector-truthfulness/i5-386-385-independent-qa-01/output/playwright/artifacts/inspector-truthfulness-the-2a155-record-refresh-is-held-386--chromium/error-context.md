# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspector-truthfulness.spec.ts >> the header shows the outcome the Timeline shows while the run record refresh is held (#386)
- Location: e2e\inspector-truthfulness.spec.ts:36:3

# Error details

```
Error: apiResponse.json: Response has been disposed
```

# Test source

```ts
  1  | import { minimalLoop } from '@graphgoblin/contracts/testing';
  2  | import type { APIRequestContext } from '@playwright/test';
  3  | import { expect, publishLoop, test, uniqueLoopName } from './fixtures.js';
  4  | 
  5  | interface RecordedEvent {
  6  |   seq: number;
  7  |   type: string;
  8  |   status?: string;
  9  | }
  10 | 
  11 | /** An ordinary run of a published minimal loop on the disposable API, and its recorded finish. */
  12 | async function finishedRun(request: APIRequestContext) {
  13 |   const loopId = await publishLoop(request, {
  14 |     ...minimalLoop(),
  15 |     name: uniqueLoopName('Header truthfulness'),
  16 |   });
  17 |   const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
  18 |   expect(started.status()).toBe(202);
  19 |   const { run } = (await started.json()) as { run: { id: string } };
  20 |   await expect
  21 |     .poll(
  22 |       async () =>
  23 |         ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
  24 |       { timeout: 30_000 },
  25 |     )
  26 |     .toBe('succeeded');
  27 |   const page = (await (await request.get(`/runs/${run.id}/events`)).json()) as {
  28 |     items: RecordedEvent[];
  29 |   };
  30 |   const terminal = page.items.find((item) => item.type === 'run.finished');
  31 |   if (!terminal) throw new Error('the run recorded no run.finished event');
  32 |   return { runId: run.id, terminal };
  33 | }
  34 | 
  35 | for (const lag of ['held', 'stale'] as const) {
  36 |   test(`the header shows the outcome the Timeline shows while the run record ${
  37 |     lag === 'held' ? 'refresh is held' : 'still says running at the outcome sequence'
  38 |   } (#386)`, async ({ page, request }) => {
  39 |     const { runId, terminal } = await finishedRun(request);
  40 |     expect(terminal.status).toBe('succeeded');
  41 |     let reads = 0;
  42 |     let release!: () => void;
  43 |     const held = new Promise<void>((resolve) => {
  44 |       release = resolve;
  45 |     });
  46 |     // The record as read before the outcome's status projection: still running, at its
  47 |     // position, one event before the outcome or exactly at it.
  48 |     await page.route(
  49 |       (url) => url.pathname === `/runs/${runId}`,
  50 |       async (route) => {
  51 |         reads += 1;
  52 |         if (lag === 'held' && reads > 1) await held;
  53 |         const response = await route.fetch();
  54 |         const {
  55 |           finishedAt: _finishedAt,
  56 |           finalizedAt: _finalizedAt,
  57 |           outcome: _outcome,
  58 |           result: _result,
  59 |           ...row
> 60 |         } = (await response.json()) as Record<string, unknown>;
     |                             ^ Error: apiResponse.json: Response has been disposed
  61 |         await route.fulfill({
  62 |           response,
  63 |           json: {
  64 |             ...row,
  65 |             status: 'running',
  66 |             currentNodeId: 'done',
  67 |             lastEventSeq: lag === 'held' ? terminal.seq - 1 : terminal.seq,
  68 |           },
  69 |         });
  70 |       },
  71 |     );
  72 |     try {
  73 |       await page.goto(`/app/runs/${runId}`);
  74 |       const timeline = page.getByRole('list', { name: 'Timeline' });
  75 |       await expect(
  76 |         timeline.getByRole('button', { name: /run\.finished.*succeeded/ }),
  77 |       ).toBeVisible();
  78 |       const header = page
  79 |         .locator('header')
  80 |         .filter({ has: page.getByRole('heading', { name: `Run ${runId}` }) });
  81 |       await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  82 |       await expect(
  83 |         header.getByText(`Status from event #${terminal.seq}; the run record is updating.`, {
  84 |           exact: true,
  85 |         }),
  86 |       ).toBeVisible();
  87 |       // The stale record's position is not claimed beside the outcome.
  88 |       await expect(header.getByText(/^at /)).toHaveCount(0);
  89 |       if (lag === 'held') await expect.poll(() => reads).toBeGreaterThan(1);
  90 |       else expect(reads).toBeGreaterThan(0);
  91 |     } finally {
  92 |       release();
  93 |     }
  94 |   });
  95 | }
  96 | 
```