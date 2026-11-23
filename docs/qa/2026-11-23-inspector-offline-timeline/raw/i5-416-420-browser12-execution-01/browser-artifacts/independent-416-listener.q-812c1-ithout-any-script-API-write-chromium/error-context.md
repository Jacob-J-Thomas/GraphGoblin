# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: independent-416-listener.qa.spec.ts >> B3 controlled script-consent record: native review expires across loss without any script API write
- Location: e2e\independent-416-listener.qa.spec.ts:266:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
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
        - heading "Run 01M3Y7RKG04KHKVQSJMTEC77Q8" [level=1] [ref=e36]:
          - text: Run
          - generic [ref=e37]: 01M3Y7RKG04KHKVQSJMTEC77Q8
        - generic [ref=e38]: Updating status…
      - generic [ref=e40]:
        - link "loop" [ref=e41] [cursor=pointer]:
          - /url: /app/loops/01M3Y7RKG04KHKVQSJMTEC77Q6/edit
        - link "child runs" [ref=e42] [cursor=pointer]:
          - /url: /app/runs?parent=01M3Y7RKG04KHKVQSJMTEC77Q8
      - generic [ref=e43]:
        - generic [ref=e44]:
          - generic [ref=e45]:
            - button "Resume" [disabled]
            - button "Replay..." [ref=e46] [cursor=pointer]
          - paragraph [ref=e48]: "Resume unavailable: Controlled consent"
        - button "Recover script" [ref=e49] [cursor=pointer]
    - alert [ref=e51]:
      - paragraph [ref=e54]: "Failed: SCRIPT_OUTCOME_UNCERTAIN"
      - paragraph [ref=e56]: The previous script attempt may already have produced its effect. Resume runs the script again and may repeat that effect.
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
          - text: Independent listener [1cfedaac-1] v1 · version ID
          - code [ref=e77]: 01M3Y7RKG04KHKVQSJMTEC77Q7
        - button "Exact run record" [ref=e79] [cursor=pointer]
        - button "Pinned definition JSON" [ref=e85] [cursor=pointer]
    - region [ref=e90]:
      - heading "Finalization" [level=2] [ref=e92]
      - generic [ref=e93]:
        - status [ref=e94]: Execution ended; finalization pending.
        - paragraph [ref=e95]: "Execution: failed. Delivery is tracked separately."
    - generic [ref=e96]:
      - region [ref=e97]:
        - heading "Timeline (6 events, live)" [level=2] [ref=e99]
        - generic [ref=e103]:
          - generic [ref=e104]:
            - button "Load older" [disabled] [ref=e105]
            - button "Previous rows" [disabled] [ref=e107]
            - button "Next rows" [disabled] [ref=e109]
            - button "Load newer" [disabled] [ref=e111]
            - button "Follow live" [disabled] [ref=e113]
            - generic [ref=e115]: Showing events 1–6 of the retained window.
            - generic [ref=e116]: Following live.
          - generic [ref=e117]:
            - generic [ref=e118]:
              - text: Event sequence
              - spinbutton "Event sequence" [ref=e119]
            - button "Go to event" [ref=e120] [cursor=pointer]
          - list "Timeline" [ref=e122]:
            - listitem [ref=e123]:
              - button "#1 run.queued" [ref=e124] [cursor=pointer]:
                - generic [ref=e125]: "#1"
                - code [ref=e126]: run.queued
            - listitem [ref=e127]:
              - button "#2 run.started attempt 1" [ref=e128] [cursor=pointer]:
                - generic [ref=e129]: "#2"
                - code [ref=e130]: run.started
                - generic [ref=e131]: attempt 1
            - listitem [ref=e132]:
              - button "#3 node.started Start (start) (trigger) attempt 1" [ref=e133] [cursor=pointer]:
                - generic [ref=e134]: "#3"
                - code [ref=e135]: node.started
                - generic [ref=e136]: Start (start) (trigger) attempt 1
            - listitem [ref=e137]:
              - button "#4 node.finished Start (start) → out, 2 changes, 1 ms" [ref=e138] [cursor=pointer]:
                - generic [ref=e139]: "#4"
                - code [ref=e140]: node.finished
                - generic [ref=e141]: Start (start) → out, 2 changes, 1 ms
            - listitem [ref=e142]:
              - button "#5 node.started Approve (approve) (wait) attempt 1" [ref=e143] [cursor=pointer]:
                - generic [ref=e144]: "#5"
                - code [ref=e145]: node.started
                - generic [ref=e146]: Approve (approve) (wait) attempt 1
            - listitem [ref=e147]:
              - button "#6 run.waiting Approve (approve) waits for input" [ref=e148] [cursor=pointer]:
                - generic [ref=e149]: "#6"
                - code [ref=e150]: run.waiting
                - generic [ref=e151]: Approve (approve) waits for input
      - generic [ref=e152]:
        - 'button "Exact recorded event #6" [ref=e154] [cursor=pointer]'
        - region [ref=e160]:
          - heading "Current thread" [level=2] [ref=e162]
          - generic [ref=e164]:
            - generic [ref=e165]:
              - heading "Messages (0)" [level=3] [ref=e166]
              - list "Messages"
            - generic [ref=e167]:
              - heading "Variables" [level=3] [ref=e168]
              - generic "Variables" [ref=e170]: "{}"
            - button "Full thread JSON" [ref=e172] [cursor=pointer]
        - paragraph [ref=e177]: Activity below covers the retained history window. Earlier activity is available through Load older.
        - button "Node progress (0 nodes)" [ref=e179] [cursor=pointer]
```

# Test source

```ts
  98  |   request: APIRequestContext,
  99  |   instance: OwnedInstance,
  100 |   listening: boolean,
  101 | ) {
  102 |   requireOwnedLoopback(instance.url);
  103 |   if (!instance.instanceId.startsWith('e2e-instance-'))
  104 |     throw new Error('Dedicated extra disposable API instance required');
  105 |   await control(request, '/api/listener', { instanceId: instance.instanceId, listening });
  106 | }
  107 | 
  108 | export function deferred() {
  109 |   let release!: () => void;
  110 |   const promise = new Promise<void>((resolve) => {
  111 |     release = resolve;
  112 |   });
  113 |   return { promise, release };
  114 | }
  115 | 
  116 | export function recordOwnedRequests(page: Page, origin: string) {
  117 |   const owned = requireOwnedLoopback(origin).origin;
  118 |   const rows: {
  119 |     ordinal: number;
  120 |     method: string;
  121 |     path: string;
  122 |     status?: number;
  123 |     failed?: boolean;
  124 |     finished?: boolean;
  125 |     stream: boolean;
  126 |   }[] = [];
  127 |   let changedAt = Date.now();
  128 |   const index = new Map<Request, number>();
  129 |   const sent = (request: Request) => {
  130 |     const url = new URL(request.url());
  131 |     if (url.origin !== owned) return;
  132 |     index.set(request, rows.length);
  133 |     const stream = (request.headers()['accept'] ?? '').includes('text/event-stream');
  134 |     rows.push({
  135 |       ordinal: rows.length + 1,
  136 |       method: request.method(),
  137 |       path: url.pathname + url.search,
  138 |       stream,
  139 |     });
  140 |     if (!stream) changedAt = Date.now();
  141 |   };
  142 |   const returned = (response: Awaited<ReturnType<Request['response']>>) => {
  143 |     if (!response) return;
  144 |     const at = index.get(response.request());
  145 |     if (at !== undefined) rows[at]!.status = response.status();
  146 |   };
  147 |   const failed = (request: Request) => {
  148 |     const at = index.get(request);
  149 |     if (at !== undefined) {
  150 |       rows[at]!.failed = true;
  151 |       if (!rows[at]!.stream) changedAt = Date.now();
  152 |     }
  153 |   };
  154 |   const finished = (request: Request) => {
  155 |     const at = index.get(request);
  156 |     if (at !== undefined) {
  157 |       rows[at]!.finished = true;
  158 |       if (!rows[at]!.stream) changedAt = Date.now();
  159 |     }
  160 |   };
  161 |   page.on('request', sent);
  162 |   page.on('response', returned);
  163 |   page.on('requestfailed', failed);
  164 |   page.on('requestfinished', finished);
  165 |   return {
  166 |     rows,
  167 |     writes: () => rows.filter((row) => !['GET', 'HEAD', 'OPTIONS'].includes(row.method)),
  168 |     quietFor: () => Date.now() - changedAt,
  169 |     pendingReads: () =>
  170 |       rows.filter((row) => row.method === 'GET' && !row.stream && !row.failed && !row.finished)
  171 |         .length,
  172 |     stop: () => {
  173 |       page.off('request', sent);
  174 |       page.off('response', returned);
  175 |       page.off('requestfailed', failed);
  176 |       page.off('requestfinished', finished);
  177 |     },
  178 |   };
  179 | }
  180 | 
  181 | /** Initial SSE batch/live invalidations must finish before any recovery read budget begins. */
  182 | export async function initialInspectorSettled(
  183 |   page: Page,
  184 |   log: ReturnType<typeof recordOwnedRequests>,
  185 |   path: string,
  186 | ) {
  187 |   await expect(page.getByRole('list', { name: 'Timeline', exact: true })).toContainText(
  188 |     'run.started',
  189 |   );
  190 |   await expect
  191 |     .poll(
  192 |       () =>
  193 |         log.rows.filter(
  194 |           (row) => row.method === 'GET' && row.path === path && row.status === 200 && row.finished,
  195 |         ).length,
  196 |     )
  197 |     .toBeGreaterThan(0);
> 198 |   await expect.poll(() => log.pendingReads() === 0 && log.quietFor() >= 2200).toBe(true);
      |                                                                               ^ Error: expect(received).toBe(expected) // Object.is equality
  199 | }
  200 | 
  201 | /** Delay actual browser dispatch; release/drain before unroute. No fabricated response/cache write. */
  202 | export async function holdOwnedRequests(
  203 |   page: Page,
  204 |   origin: string,
  205 |   method: string,
  206 |   exactPath: string,
  207 | ) {
  208 |   const owned = requireOwnedLoopback(origin).origin;
  209 |   if (!exactPath.startsWith('/runs/')) throw new Error('Bound run endpoint required');
  210 |   const gate = deferred();
  211 |   let captured = 0;
  212 |   let active = 0;
  213 |   const match = (url: URL) => url.origin === owned && url.pathname === exactPath;
  214 |   const handler = async (route: Route) => {
  215 |     if (route.request().method() !== method) {
  216 |       await route.continue();
  217 |       return;
  218 |     }
  219 |     captured++;
  220 |     active++;
  221 |     try {
  222 |       await gate.promise;
  223 |       await route.continue();
  224 |     } finally {
  225 |       active--;
  226 |     }
  227 |   };
  228 |   await page.route(match, handler);
  229 |   return {
  230 |     captured: () => captured,
  231 |     active: () => active,
  232 |     release: gate.release,
  233 |     close: async () => {
  234 |       gate.release();
  235 |       await expect.poll(() => active).toBe(0);
  236 |       await page.unroute(match, handler);
  237 |     },
  238 |   };
  239 | }
  240 | 
  241 | /** A controlled browser response hold around a real server read/preview, explicitly labelled. */
  242 | export async function holdOwnedResponse(
  243 |   page: Page,
  244 |   origin: string,
  245 |   method: string,
  246 |   exactPath: string,
  247 | ) {
  248 |   const owned = requireOwnedLoopback(origin).origin;
  249 |   if (!exactPath.startsWith('/runs/')) throw new Error('Bound run endpoint required');
  250 |   const gate = deferred();
  251 |   let arrived = 0;
  252 |   let active = 0;
  253 |   const match = (url: URL) => url.origin === owned && url.pathname === exactPath;
  254 |   const handler = async (route: Route) => {
  255 |     if (route.request().method() !== method) {
  256 |       await route.continue();
  257 |       return;
  258 |     }
  259 |     active++;
  260 |     try {
  261 |       const realResponse = await route.fetch();
  262 |       arrived++;
  263 |       await gate.promise;
  264 |       await route.fulfill({ response: realResponse });
  265 |     } finally {
  266 |       active--;
  267 |     }
  268 |   };
  269 |   await page.route(match, handler);
  270 |   return {
  271 |     arrived: () => arrived,
  272 |     active: () => active,
  273 |     release: gate.release,
  274 |     close: async () => {
  275 |       gate.release();
  276 |       await expect.poll(() => active).toBe(0);
  277 |       await page.unroute(match, handler);
  278 |     },
  279 |   };
  280 | }
  281 | 
  282 | /** Contract permits closing the review or retaining it with confirmation unavailable. */
  283 | export async function expectExpiredReview(dialog: Locator, confirm: Locator) {
  284 |   if (await dialog.isVisible()) await expect(confirm).toBeDisabled();
  285 |   else await expect(dialog).toBeHidden();
  286 | }
  287 | 
  288 | /** Call only after meaningful UI/HTTP completion; this is a fixed budget observation, not readiness. */
  289 | export async function expectNoFurtherWritesForQuietSample(
  290 |   page: Page,
  291 |   writes: () => unknown[],
  292 |   before: number,
  293 | ) {
  294 |   expect(writes()).toHaveLength(before);
  295 |   await page.waitForTimeout(2200);
  296 |   expect(writes()).toHaveLength(before);
  297 | }
  298 | 
```