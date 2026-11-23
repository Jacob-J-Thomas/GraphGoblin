# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspector-final-independent-qa.spec.ts >> independent S1/S2: BOTH read models held, then equal-sequence stale run released before observation
- Location: e2e\inspector-final-independent-qa.spec.ts:10:1

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
        - heading "Run 01M3Y7RKG08DBTTA7WQFE8PBJQ" [level=1] [ref=e36]:
          - text: Run
          - generic [ref=e37]: 01M3Y7RKG08DBTTA7WQFE8PBJQ
        - generic [ref=e38]: succeeded
      - generic [ref=e42]:
        - link "loop" [ref=e43] [cursor=pointer]:
          - /url: /app/loops/01M3Y7RKG08DBTTA7WQFE8PBJN/edit
        - link "child runs" [ref=e44] [cursor=pointer]:
          - /url: /app/runs?parent=01M3Y7RKG08DBTTA7WQFE8PBJQ
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
          - text: Independent held reads [c8a4d532-1] v1 · version ID
          - code [ref=e77]: 01M3Y7RKG08DBTTA7WQFE8PBJP
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
              - button "#4 node.finished Start (start) → out, 2 changes, 9 ms" [ref=e135] [cursor=pointer]:
                - generic [ref=e136]: "#4"
                - code [ref=e137]: node.finished
                - generic [ref=e138]: Start (start) → out, 2 changes, 9 ms
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
              - button "#7 node.finished Done (done), 0 changes, 1 ms" [ref=e150] [cursor=pointer]:
                - generic [ref=e151]: "#7"
                - code [ref=e152]: node.finished
                - generic [ref=e153]: Done (done), 0 changes, 1 ms
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
  1   | import { readFile, writeFile } from 'node:fs/promises';
  2   | import { join } from 'node:path';
  3   | import type { RunEvent } from '@graphgoblin/contracts';
  4   | import { minimalLoop } from '@graphgoblin/contracts/testing';
  5   | import { expect, publishLoop, test, uniqueLoopName } from './fixtures.js';
  6   | 
  7   | const evidence =
  8   |   'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-candidate-01/output/playwright/independent';
  9   | 
  10  | test('independent S1/S2: BOTH read models held, then equal-sequence stale run released before observation', async ({
  11  |   page,
  12  |   request,
  13  | }) => {
  14  |   const loopId = await publishLoop(request, {
  15  |     ...minimalLoop(),
  16  |     name: uniqueLoopName('Independent held reads'),
  17  |   });
  18  |   const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
  19  |   expect(started.status()).toBe(202);
  20  |   const { run } = (await started.json()) as { run: { id: string } };
  21  |   await expect
  22  |     .poll(
  23  |       async () =>
  24  |         ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
  25  |     )
  26  |     .toBe('succeeded');
  27  |   const events = (
  28  |     (await (await request.get(`/runs/${run.id}/events`)).json()) as { items: RunEvent[] }
  29  |   ).items;
  30  |   const finished = events.find((event) => event.type === 'run.finished')!;
  31  |   let runReads = 0;
  32  |   let heldRun = 0;
  33  |   let returnedRun = 0;
  34  |   let heldObservation = 0;
  35  |   let returnedObservation = 0;
  36  |   let releaseRun!: () => void;
  37  |   let releaseObservation!: () => void;
  38  |   const runGate = new Promise<void>((resolve) => {
  39  |     releaseRun = resolve;
  40  |   });
  41  |   const observationGate = new Promise<void>((resolve) => {
  42  |     releaseObservation = resolve;
  43  |   });
  44  |   await page.route(
  45  |     (url) => url.pathname === `/runs/${run.id}/observation`,
  46  |     async (route) => {
  47  |       heldObservation++;
  48  |       await observationGate;
  49  |       const response = await route.fetch();
> 50  |       await route.fulfill({ response });
      |                   ^ Error: route.fulfill: Route is already handled!
  51  |       returnedObservation++;
  52  |     },
  53  |   );
  54  |   await page.route(
  55  |     (url) => url.pathname === `/runs/${run.id}`,
  56  |     async (route) => {
  57  |       runReads++;
  58  |       if (runReads > 1) {
  59  |         heldRun++;
  60  |         await runGate;
  61  |       }
  62  |       const response = await route.fetch();
  63  |       const {
  64  |         finishedAt: _finishedAt,
  65  |         finalizedAt: _finalizedAt,
  66  |         outcome: _outcome,
  67  |         result: _result,
  68  |         ...row
  69  |       } = (await response.json()) as Record<string, unknown>;
  70  |       await route.fulfill({
  71  |         response,
  72  |         json: {
  73  |           ...row,
  74  |           status: 'running',
  75  |           currentNodeId: 'done',
  76  |           lastEventSeq: runReads === 1 ? finished.seq - 1 : finished.seq,
  77  |         },
  78  |       });
  79  |       returnedRun++;
  80  |     },
  81  |   );
  82  |   try {
  83  |     await page.goto(`/app/runs/${run.id}`);
  84  |     const timeline = page.getByRole('list', { name: 'Timeline' });
  85  |     await expect(timeline.getByRole('button', { name: /run\.finished.*succeeded/ })).toBeVisible();
  86  |     const header = page
  87  |       .locator('header')
  88  |       .filter({ has: page.getByRole('heading', { name: `Run ${run.id}` }) });
  89  |     await expect.poll(() => heldRun).toBeGreaterThan(0);
  90  |     expect(heldObservation).toBeGreaterThan(0);
  91  |     expect(returnedObservation).toBe(0);
  92  |     await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  93  |     await page.screenshot({ path: join(evidence, 'S1-both-models-held.png'), fullPage: true });
  94  |     releaseRun();
  95  |     await expect.poll(() => returnedRun).toBeGreaterThan(1);
  96  |     await page.evaluate(
  97  |       () =>
  98  |         new Promise<void>((resolve) =>
  99  |           requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  100 |         ),
  101 |     );
  102 |     expect(returnedObservation).toBe(0);
  103 |     await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  104 |     await expect(header.getByText(/^at /)).toHaveCount(0);
  105 |     await page.screenshot({
  106 |       path: join(evidence, 'S2-equal-sequence-stale-returned.png'),
  107 |       fullPage: true,
  108 |     });
  109 |     await writeFile(
  110 |       join(evidence, 'S1-S2-schedule.json'),
  111 |       JSON.stringify(
  112 |         {
  113 |           runId: run.id,
  114 |           terminal: finished,
  115 |           runReads,
  116 |           heldRun,
  117 |           returnedRun,
  118 |           heldObservation,
  119 |           returnedObservation,
  120 |         },
  121 |         null,
  122 |         2,
  123 |       ),
  124 |     );
  125 |     await writeFile(join(evidence, 'S2-rendered.html'), await page.content());
  126 |   } finally {
  127 |     releaseRun();
  128 |     releaseObservation();
  129 |     await page.unrouteAll({ behavior: 'wait' });
  130 |   }
  131 | });
  132 | 
  133 | for (const width of [1440, 390]) {
  134 |   test(`independent P1-P5: real recorded repeated appends and non-add diffs at ${width}px`, async ({
  135 |     page,
  136 |     request,
  137 |   }) => {
  138 |     const source = minimalLoop();
  139 |     const longMessage = '長'.repeat(6000);
  140 |     const definition = {
  141 |       ...source,
  142 |       name: uniqueLoopName(`Independent patch ${width}`),
  143 |       nodes: [
  144 |         source.nodes[0]!,
  145 |         {
  146 |           id: 'mutate',
  147 |           kind: 'mutate',
  148 |           label: 'Recorded changes',
  149 |           config: {
  150 |             operations: [
```