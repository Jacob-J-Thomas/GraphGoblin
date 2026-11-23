# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspector-truthfulness.spec.ts >> the header shows the outcome the Timeline shows while the run record still says running at the outcome sequence (#386)
- Location: e2e\inspector-truthfulness.spec.ts:45:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('list', { name: 'Timeline' }).getByRole('button', { name: /run\.finished.*succeeded/ })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('list', { name: 'Timeline' }).getByRole('button', { name: /run\.finished.*succeeded/ }) with timeout 10000ms
  - waiting for getByRole('list', { name: 'Timeline' }).getByRole('button', { name: /run\.finished.*succeeded/ })

```

```yaml
- text: "{\"id\":\"01M3Y7RKG0GQ0HYVFKK3PAEDGC\",\"ownerId\":\"local\",\"loopId\":\"01M3Y7RKG0GQ0HYVFKK3PAEDGA\",\"versionId\":\"01M3Y7RKG0GQ0HYVFKK3PAEDGB\",\"pinned\":{\"source\":\"published\",\"version\":1,\"name\":\"Header truthfulness [fb113131-1]\",\"label\":\"Header truthfulness [fb113131-1] v1\",\"defaults\":{\"owner\":{\"byHarness\":{}},\"process\":{\"byHarness\":{\"codex\":{\"model\":\"gpt-6-luna\",\"effort\":\"low\"}}}},\"limits\":{\"maxNodeVisits\":10,\"runDeadlineSeconds\":null,\"structuredTimeoutMs\":null},\"classifiers\":{}},\"invocationId\":\"01M3Y7RKG0GQ0HYVFKK3PAEDGD\",\"status\":\"running\",\"iteration\":1,\"createdAt\":\"2026-10-02T12:00:00.000Z\",\"startedAt\":\"2026-10-02T12:00:00.000Z\",\"lastEventSeq\":8,\"recovery\":{\"observedSeq\":8,\"resume\":{\"allowed\":false,\"code\":\"RUN_FINISHED\",\"message\":\"This run has finished. Resume only continues paused runs or supported failures.\"},\"replayDefault\":{\"allowed\":false,\"code\":\"REPLAY_NODE_NOT_REACHED\",\"message\":\"This run never reached this node.\"},\"replay\":[{\"nodeId\":\"start\",\"label\":\"Start\",\"action\":{\"allowed\":true},\"effects\":[]},{\"nodeId\":\"done\",\"label\":\"Done\",\"action\":{\"allowed\":true},\"effects\":[]}]},\"currentNodeId\":\"done\"}"
```

# Test source

```ts
  4   | 
  5   | interface RecordedEvent {
  6   |   seq: number;
  7   |   type: string;
  8   |   status?: string;
  9   | }
  10  | 
  11  | /** An ordinary run of a published minimal loop on the disposable API, and its recorded finish. */
  12  | async function finishedRun(request: APIRequestContext) {
  13  |   const loopId = await publishLoop(request, {
  14  |     ...minimalLoop(),
  15  |     name: uniqueLoopName('Header truthfulness'),
  16  |   });
  17  |   const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
  18  |   expect(started.status()).toBe(202);
  19  |   const { run } = (await started.json()) as { run: { id: string } };
  20  |   await expect
  21  |     .poll(
  22  |       async () =>
  23  |         ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
  24  |       { timeout: 30_000 },
  25  |     )
  26  |     .toBe('succeeded');
  27  |   const page = (await (await request.get(`/runs/${run.id}/events`)).json()) as {
  28  |     items: RecordedEvent[];
  29  |   };
  30  |   const terminal = page.items.find((item) => item.type === 'run.finished');
  31  |   if (!terminal) throw new Error('the run recorded no run.finished event');
  32  |   const response = await request.get(`/runs/${run.id}`);
  33  |   expect(response.status()).toBe(200);
  34  |   const {
  35  |     finishedAt: _finishedAt,
  36  |     finalizedAt: _finalizedAt,
  37  |     outcome: _outcome,
  38  |     result: _result,
  39  |     ...row
  40  |   } = (await response.json()) as Record<string, unknown>;
  41  |   return { runId: run.id, terminal, row };
  42  | }
  43  | 
  44  | for (const lag of ['held', 'stale'] as const) {
  45  |   test(`the header shows the outcome the Timeline shows while the run record ${
  46  |     lag === 'held' ? 'refresh is held' : 'still says running at the outcome sequence'
  47  |   } (#386)`, async ({ page, request }) => {
  48  |     const { runId, terminal, row } = await finishedRun(request);
  49  |     expect(terminal.status).toBe('succeeded');
  50  |     let reads = 0;
  51  |     let returnedReads = 0;
  52  |     let observationReads = 0;
  53  |     let returnedObservations = 0;
  54  |     let activeRoutes = 0;
  55  |     let releaseRun!: () => void;
  56  |     let releaseObservation!: () => void;
  57  |     const heldRun = new Promise<void>((resolve) => {
  58  |       releaseRun = resolve;
  59  |     });
  60  |     const heldObservation = new Promise<void>((resolve) => {
  61  |       releaseObservation = resolve;
  62  |     });
  63  |     // Neither read model can supply the outcome before the streamed event does.
  64  |     await page.route(`**/runs/${runId}/observation`, async (route) => {
  65  |       observationReads += 1;
  66  |       activeRoutes += 1;
  67  |       try {
  68  |         await heldObservation;
  69  |         await route.continue();
  70  |         returnedObservations += 1;
  71  |       } finally {
  72  |         activeRoutes -= 1;
  73  |       }
  74  |     });
  75  |     // The record as read before the outcome's status projection: still running, at its
  76  |     // position, one event before the outcome or exactly at it. Capture the real row once,
  77  |     // so released handlers do not fetch through a request context being torn down.
  78  |     await page.route(
  79  |       `**/runs/${runId}`,
  80  |       async (route) => {
  81  |         const read = ++reads;
  82  |         activeRoutes += 1;
  83  |         try {
  84  |           if (read > 1) await heldRun;
  85  |           await route.fulfill({
  86  |             json: {
  87  |               ...row,
  88  |               status: 'running',
  89  |               currentNodeId: 'done',
  90  |               lastEventSeq: read === 1 && lag === 'held' ? terminal.seq - 1 : terminal.seq,
  91  |             },
  92  |           });
  93  |           returnedReads += 1;
  94  |         } finally {
  95  |           activeRoutes -= 1;
  96  |         }
  97  |       },
  98  |     );
  99  |     try {
  100 |       await page.goto(`/app/runs/${runId}`);
  101 |       const timeline = page.getByRole('list', { name: 'Timeline' });
  102 |       await expect(
  103 |         timeline.getByRole('button', { name: /run\.finished.*succeeded/ }),
> 104 |       ).toBeVisible();
      |         ^ Error: expect(locator).toBeVisible() failed
  105 |       const header = page
  106 |         .locator('header')
  107 |         .filter({ has: page.getByRole('heading', { name: `Run ${runId}` }) });
  108 |       await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  109 |       await expect(
  110 |         header.getByText(`Status from event #${terminal.seq}; the run record is updating.`, {
  111 |           exact: true,
  112 |         }),
  113 |       ).toBeVisible();
  114 |       // The stale record's position is not claimed beside the outcome.
  115 |       await expect(header.getByText(/^at /)).toHaveCount(0);
  116 |       await expect.poll(() => reads).toBeGreaterThan(1);
  117 |       expect(observationReads).toBeGreaterThan(0);
  118 |       expect(returnedObservations).toBe(0);
  119 |       expect(returnedReads).toBe(1);
  120 | 
  121 |       // Complete a stale refresh at the outcome sequence while observations remain held.
  122 |       // Wait for its browser response body and rendering before checking the header again.
  123 |       const refreshed = page.waitForResponse(
  124 |         (response) => new URL(response.url()).pathname === `/runs/${runId}`,
  125 |       );
  126 |       releaseRun();
  127 |       const response = await refreshed;
  128 |       expect(await response.finished()).toBeNull();
  129 |       expect(await response.json()).toMatchObject({
  130 |         status: 'running',
  131 |         lastEventSeq: terminal.seq,
  132 |       });
  133 |       await expect.poll(() => returnedReads).toBeGreaterThan(1);
  134 |       await page.evaluate(
  135 |         () =>
  136 |           new Promise<void>((resolve) =>
  137 |             requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  138 |           ),
  139 |       );
  140 |       expect(returnedObservations).toBe(0);
  141 |       await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  142 |       await expect(
  143 |         header.getByText(`Status from event #${terminal.seq}; the run record is updating.`, {
  144 |           exact: true,
  145 |         }),
  146 |       ).toBeVisible();
  147 |       await expect(header.getByText(/^at /)).toHaveCount(0);
  148 |     } finally {
  149 |       releaseRun();
  150 |       releaseObservation();
  151 |       // Stop the inspector creating more reads, then finish callbacks before removing routes.
  152 |       await page.goto('about:blank');
  153 |       await expect.poll(() => activeRoutes).toBe(0);
  154 |       await page.unrouteAll({ behavior: 'wait' });
  155 |     }
  156 |   });
  157 | }
  158 | 
```