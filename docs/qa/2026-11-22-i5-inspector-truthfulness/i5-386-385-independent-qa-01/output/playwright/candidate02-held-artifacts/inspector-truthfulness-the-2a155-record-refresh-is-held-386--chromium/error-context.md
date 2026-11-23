# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspector-truthfulness.spec.ts >> the header shows the outcome the Timeline shows while the run record refresh is held (#386)
- Location: e2e\inspector-truthfulness.spec.ts:36:3

# Error details

```
Error: route.fulfill: Route is already handled!
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: GraphGoblin
    - navigation "Main" [ref=e22]:
      - link "Chat" [ref=e23] [cursor=pointer]:
        - /url: /app/chat
      - link "Loops" [ref=e25] [cursor=pointer]:
        - /url: /app/loops
      - link "Runs" [ref=e27] [cursor=pointer]:
        - /url: /app/runs
      - link "Events" [ref=e29] [cursor=pointer]:
        - /url: /app/events
      - link "Settings" [ref=e31] [cursor=pointer]:
        - /url: /app/settings
  - generic [ref=e33]:
    - banner [ref=e34]:
      - generic [ref=e35]:
        - heading "Run 01M3Y7RKG0KXGKJ61VNYX76SC3" [level=1] [ref=e36]:
          - text: Run
          - generic [ref=e37]: 01M3Y7RKG0KXGKJ61VNYX76SC3
        - generic [ref=e38]: succeeded
      - generic [ref=e42]:
        - link "loop" [ref=e43] [cursor=pointer]:
          - /url: /app/loops/01M3Y7RKG0KXGKJ61VNYX76SC1/edit
        - link "child runs" [ref=e44] [cursor=pointer]:
          - /url: /app/runs?parent=01M3Y7RKG0KXGKJ61VNYX76SC3
      - generic [ref=e46]:
        - generic [ref=e47]:
          - button "Resume" [disabled]
          - button "Replay..." [ref=e48] [cursor=pointer]
        - paragraph [ref=e50]: "Resume unavailable: This run has finished. Resume only continues paused runs or supported failures."
    - region [ref=e51]:
      - heading "Exit evaluation" [level=2] [ref=e53]
      - generic [ref=e54]:
        - paragraph [ref=e55]: "Done (done): Exited: success"
        - paragraph [ref=e56]: "No value was returned: Returns is None, so no destination received anything (caller from the exit). This is the exit’s configuration, not a failure."
    - region [ref=e57]:
      - heading "Execution limits" [level=2] [ref=e59]
      - generic [ref=e60]:
        - paragraph [ref=e61]: "Maximum node visits: 10. Run deadline: none."
        - paragraph [ref=e62]: "Structured completion: Unlimited."
        - paragraph [ref=e63]: Limits are pinned for this run. Gate pass limits and node watchdogs follow its pinned definition.
    - generic [ref=e64]:
      - paragraph [ref=e65]: History retained.
      - generic [ref=e66]:
        - button "Review delete-ready history" [ref=e67] [cursor=pointer]
        - button "Withdraw delete-ready mark" [ref=e69] [cursor=pointer]
        - generic [ref=e71]: 1 selected
    - region [ref=e72]:
      - heading "Execution context" [level=2] [ref=e74]
      - generic [ref=e75]:
        - paragraph [ref=e76]:
          - text: Header truthfulness [7037dadc-1] v1 · version ID
          - code [ref=e77]: 01M3Y7RKG0KXGKJ61VNYX76SC2
        - button "Exact run record" [ref=e79] [cursor=pointer]
        - button "Pinned definition JSON" [ref=e85] [cursor=pointer]
    - region [ref=e90]:
      - heading "Finalization" [level=2] [ref=e92]
      - generic [ref=e93]:
        - status [ref=e94]: Fully finalized.
        - paragraph [ref=e95]: "Execution: succeeded. Delivery is tracked separately."
    - generic [ref=e96]:
      - region [ref=e97]:
        - heading "Timeline (8 events, complete)" [level=2] [ref=e99]
        - generic [ref=e100]:
          - generic [ref=e101]:
            - button "Load older" [disabled] [ref=e102]
            - button "Previous rows" [disabled] [ref=e104]
            - button "Next rows" [disabled] [ref=e106]
            - button "Load newer" [disabled] [ref=e108]
            - button "Follow live" [disabled] [ref=e110]
            - generic [ref=e112]: Showing events 1–8 of the retained window.
            - generic [ref=e113]: Following live.
          - generic [ref=e114]:
            - generic [ref=e115]:
              - text: Event sequence
              - spinbutton "Event sequence" [ref=e116]
            - button "Go to event" [ref=e117] [cursor=pointer]
          - list "Timeline" [ref=e119]:
            - listitem [ref=e120]:
              - button "#1 run.queued" [ref=e121] [cursor=pointer]:
                - generic [ref=e122]: "#1"
                - code [ref=e123]: run.queued
            - listitem [ref=e124]:
              - button "#2 run.started attempt 1" [ref=e125] [cursor=pointer]:
                - generic [ref=e126]: "#2"
                - code [ref=e127]: run.started
                - generic [ref=e128]: attempt 1
            - listitem [ref=e129]:
              - button "#3 node.started Start (start) (trigger) attempt 1" [ref=e130] [cursor=pointer]:
                - generic [ref=e131]: "#3"
                - code [ref=e132]: node.started
                - generic [ref=e133]: Start (start) (trigger) attempt 1
            - listitem [ref=e134]:
              - button "#4 node.finished Start (start) → out, 2 changes, 16 ms" [ref=e135] [cursor=pointer]:
                - generic [ref=e136]: "#4"
                - code [ref=e137]: node.finished
                - generic [ref=e138]: Start (start) → out, 2 changes, 16 ms
            - listitem [ref=e139]:
              - button "#5 node.started Done (done) (exit) attempt 1" [ref=e140] [cursor=pointer]:
                - generic [ref=e141]: "#5"
                - code [ref=e142]: node.started
                - generic [ref=e143]: Done (done) (exit) attempt 1
            - listitem [ref=e144]:
              - 'button "#6 exit.evaluated Done (done): Exited: success" [ref=e145] [cursor=pointer]':
                - generic [ref=e146]: "#6"
                - code [ref=e147]: exit.evaluated
                - generic [ref=e148]: "Done (done): Exited: success"
            - listitem [ref=e149]:
              - button "#7 node.finished Done (done), 0 changes, 2 ms" [ref=e150] [cursor=pointer]:
                - generic [ref=e151]: "#7"
                - code [ref=e152]: node.finished
                - generic [ref=e153]: Done (done), 0 changes, 2 ms
            - listitem [ref=e154]:
              - button "#8 run.finished succeeded (success)" [ref=e155] [cursor=pointer]:
                - generic [ref=e156]: "#8"
                - code [ref=e157]: run.finished
                - generic [ref=e158]: succeeded (success)
      - generic [ref=e159]:
        - 'button "Exact recorded event #8" [ref=e161] [cursor=pointer]'
        - region [ref=e167]:
          - heading "Current thread" [level=2] [ref=e169]
          - generic [ref=e171]:
            - generic [ref=e172]:
              - heading "Messages (0)" [level=3] [ref=e173]
              - list "Messages"
            - generic [ref=e174]:
              - heading "Variables" [level=3] [ref=e175]
              - generic "Variables" [ref=e177]: "{}"
            - button "Full thread JSON" [ref=e179] [cursor=pointer]
        - paragraph [ref=e184]: Activity below covers the retained history window. Earlier activity is available through Load older.
        - button "Node progress (1 nodes)" [ref=e186] [cursor=pointer]
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
  60 |         } = (await response.json()) as Record<string, unknown>;
> 61 |         await route.fulfill({
     |                     ^ Error: route.fulfill: Route is already handled!
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
  93 |       // Finish every released route before Playwright disposes this page's request context.
  94 |       await page.unrouteAll({ behavior: 'wait' });
  95 |     }
  96 |   });
  97 | }
  98 | 
```