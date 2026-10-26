# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: drafts.spec.ts >> an older version’s open connection blocks device drafts: the editor says so until it closes (review F2)
- Location: e2e\drafts.spec.ts:159:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Changes are not kept on this device')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Changes are not kept on this device') with timeout 10000ms
  - waiting for getByText('Changes are not kept on this device')

```

```yaml
- banner:
    - text: GraphGoblin
    - navigation "Main":
        - link "Loops":
            - /url: /app/loops
        - link "Runs":
            - /url: /app/runs
        - link "Events":
            - /url: /app/events
        - link "Settings":
            - /url: /app/settings
- banner:
    - link "Loops":
        - /url: /app/loops
    - text: /
    - heading "qa blocked storage" [level=1]
    - text: draft only All changes saved
    - button "Undo" [disabled]
    - button "Redo" [disabled]
    - link "Open in Runs" [disabled]
    - text: 'Publish the loop first: runs start from a published version. Checking…'
    - button "Publish"
- status: The editor is available. Checking the server and this device before saving changes.
- complementary "Palette":
    - button "Hide palette" [expanded]
    - heading "Palette" [level=2]
    - navigation "Node palette":
        - button "Add Trigger node": Trigger Starts a run
        - button "Add Decision node": Decision Chooses a route and can limit repeats
        - button "Add Inference node": Inference Hands work to a harness
        - button "Add Script node": Script Runs a program
        - button "Add Mutate node": Mutate Changes the context thread
        - button "Add Subloop node": Subloop Runs another loop
        - button "Add Wait node": Wait Parks until input, time, or a signal
        - button "Add Heartbeat node": Heartbeat Polls on an interval
        - button "Add Exit node": Exit Finishes with an outcome and return value
- main:
    - application:
        - img:
            - group "start out to approve"
        - img:
            - group "approve out to done"
        - group "Trigger Start (start)": Trigger Start start out
        - group "Wait Approve (approve)": Wait Approve approve out
        - group "Exit Done (done)": Exit Done done
        - img
        - button "Zoom In":
            - img
        - button "Zoom Out":
            - img
        - button "Fit View":
            - img
        - button "Toggle Interactivity":
            - img
        - link "React Flow attribution":
            - /url: https://reactflow.dev?utm_source=attribution
            - text: React Flow
- complementary "Loop settings":
    - heading "Loop settings" [level=2]
    - button "Hide loop settings" [expanded]
    - region "Loop settings":
        - text: Name
        - textbox "Name": qa blocked storage
        - text: Description
        - textbox "Description"
        - heading "Settings" [level=3]
        - paragraph: Maximum node visits is a safety cap against unintended cycles. Use a decision gate's maximum passes for an intentional repeat. The elapsed execution deadline includes waits and pauses. There is no run deadline unless you set one. Structured completion milliseconds bounds each LLM decision evaluation or output-transform repair through the structured port when Limited; it defaults to Unlimited. Same-session inference schema repairs follow the node timeout. Visits and passes can also be explicitly set to Unlimited; cancellation remains available.
        - form "Loop settings form":
            - group "Working directory":
                - text: Working directory Kind
                - combobox "Kind":
                    - option "fixed"
                    - option "template"
                    - option "temp" [selected]
            - group "Defaults":
                - text: Defaults
                - group "By harness":
                    - text: By harness
                    - paragraph: Defaults keyed by their harness; omitted fields inherit only within that harness.
                    - button "Add entry"
                    - status
            - text: Maximum node visits
            - spinbutton "Maximum node visits": '10'
            - combobox "Maximum node visits mode":
                - option "Limited" [selected]
                - option "Unlimited"
            - paragraph: Fresh entries per node. Default 10; unlimited removes this cutoff.
            - text: Run deadline seconds
            - combobox "Run deadline seconds mode":
                - option "Limited"
                - option "No run deadline" [selected]
            - paragraph: Elapsed seconds including waits, pauses and restart downtime. No deadline by default; set seconds to add one.
            - paragraph: No deadline; set one to stop a forgotten run.
            - text: Structured completion milliseconds
            - combobox "Structured completion milliseconds mode":
                - option "Limited"
                - option "Unlimited" [selected]
            - paragraph: Milliseconds per LLM decision evaluation or output-transform repair through the structured port. Same-session inference schema repairs follow the node timeout. No deadline by default; Unlimited removes this cutoff.
            - paragraph: No completion deadline; LLM decisions and repairs remain cancellable.
            - text: Subloop depth limit
            - spinbutton "Subloop depth limit": '8'
        - heading "Variables" [level=3]
        - paragraph: Each variable maps a name to a JSON Schema.
        - form "Variables form":
            - group "Variables":
                - text: Variables
                - button "Add entry"
                - status
```

# Test source

```ts
  89  |   const localDefinition = approvalLoop('older local copy');
  90  |   await page.goto('/app/loops');
  91  |
  92  |   // Seed an older unsynced browser copy so the editor offers it separately from the server draft.
  93  |   await page.evaluate(
  94  |     async ({ loopId, definition }) => {
  95  |       const db = await new Promise<IDBDatabase>((resolve, reject) => {
  96  |         // Version 2 preserves older copies; conversion is explicit per draft.
  97  |         const request = indexedDB.open('graphgoblin', 2);
  98  |         request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  99  |         request.onsuccess = () => resolve(request.result);
  100 |         request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  101 |       });
  102 |       await new Promise<void>((resolve, reject) => {
  103 |         const transaction = db.transaction('drafts', 'readwrite');
  104 |         transaction.objectStore('drafts').put(
  105 |           {
  106 |             loopId,
  107 |             definition,
  108 |             savedAt: '2000-01-01T00:00:00.000Z',
  109 |             synced: false,
  110 |           },
  111 |           loopId,
  112 |         );
  113 |         transaction.oncomplete = () => resolve();
  114 |         transaction.onerror = () =>
  115 |           reject(transaction.error ?? new Error('IndexedDB write failed'));
  116 |         transaction.onabort = () =>
  117 |           reject(transaction.error ?? new Error('IndexedDB write aborted'));
  118 |       });
  119 |       db.close();
  120 |     },
  121 |     { loopId: loop.id, definition: localDefinition },
  122 |   );
  123 |
  124 |   // Keep the accepted local copy unsynced so the reload below exercises restoration again.
  125 |   await page.route(`**/loops/${loop.id}/draft`, (route) =>
  126 |     route.request().method() === 'PUT' ? route.abort() : route.continue(),
  127 |   );
  128 |   await page.goto(`/app/loops/${loop.id}/edit`);
  129 |   await expect(page.getByRole('heading', { name: 'server copy' })).toBeVisible();
  130 |   await page.getByRole('button', { name: "Use this device's copy instead" }).click();
  131 |   await expect(page.getByRole('heading', { name: 'older local copy' })).toBeVisible();
  132 |   const restoredNotice = page.getByText('Restored unsaved changes from this device.');
  133 |   await expect(restoredNotice).toBeVisible();
  134 |   await expect(page.getByTestId('save-state')).toHaveText('Offline: saved on this device');
  135 |
  136 |   const dismissButtons = page.getByRole('button', { name: 'Dismiss notice' });
  137 |   await dismissButtons.nth(0).click();
  138 |   await expect(restoredNotice).toBeHidden();
  139 |   await expect(page.getByText('Notice dismissed')).toBeAttached();
  140 |   await expect(dismissButtons).toHaveCount(1);
  141 |   await expect(dismissButtons).toBeFocused();
  142 |   await dismissButtons.click();
  143 |   await expect(page.getByTestId('save-state')).toBeFocused();
  144 |   await expect(page.getByTestId('save-state')).toHaveAttribute('tabindex', '-1');
  145 |
  146 |   await showLoopPanel(page);
  147 |   await page.getByLabel('Description').fill('edited while the restore notice is dismissed');
  148 |   await expect(restoredNotice).toBeHidden();
  149 |   await expect(page.getByTestId('save-state')).toHaveText('Offline: saved on this device');
  150 |   await expect(
  151 |     page.getByText('Offline: the draft is kept on this device and saved when the API is back.'),
  152 |   ).toBeHidden();
  153 |
  154 |   await page.reload();
  155 |   await expect(page.getByRole('heading', { name: 'older local copy' })).toBeVisible();
  156 |   await expect(page.getByText('Restored unsaved changes from this device.')).toBeVisible();
  157 | });
  158 |
  159 | test('an older version’s open connection blocks device drafts: the editor says so until it closes (review F2)', async ({
  160 |   context,
  161 |   request,
  162 | }) => {
  163 |   const created = await request.post('/loops', {
  164 |     data: { definition: approvalLoop('qa blocked storage') },
  165 |   });
  166 |   expect(created.status()).toBe(201);
  167 |   const loopId = ((await created.json()) as { loop: { id: string } }).loop.id;
  168 |
  169 |   // A tab of the previous version: its version 1 connection stays open and ignores
  170 |   // `versionchange`, so this version's store upgrade waits for it.
  171 |   const older = await context.newPage();
  172 |   await older.goto('/app/loops');
  173 |   await older.evaluate(
  174 |     () =>
  175 |       new Promise<void>((resolve, reject) => {
  176 |         const request = indexedDB.open('graphgoblin', 1);
  177 |         request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  178 |         request.onsuccess = () => {
  179 |           (window as unknown as { olderTab: IDBDatabase }).olderTab = request.result;
  180 |           resolve();
  181 |         };
  182 |         request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  183 |       }),
  184 |   );
  185 |
  186 |   const page = await context.newPage();
  187 |   await page.goto(`/app/loops/${loopId}/edit`);
  188 |   await expect(page.getByRole('heading', { name: 'qa blocked storage' })).toBeVisible();
> 189 |   await expect(page.getByText('Changes are not kept on this device')).toBeVisible();
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
  190 |   await expect(page.getByText(/Close other GraphGoblin tabs and windows\./)).toBeVisible();
  191 |
  192 |   // A schema-invalid edit (a subloop without its loop) cannot go to the server, and the device
  193 |   // refuses it: the editor says it is in this window only.
  194 |   await page.getByRole('button', { name: 'Add Subloop node' }).click();
  195 |   await expect(page.getByTestId('save-state')).toHaveText('Kept in this window only');
  196 |   await expect(
  197 |     page.getByText(
  198 |       'Fix the schema errors to save to the server. Changes are kept in this window only.',
  199 |     ),
  200 |   ).toBeVisible();
  201 |
  202 |   // Closing the old tab releases its real connection without evaluating in an inactive renderer.
  203 |   // Wait for that public browser operation, then observe the completed upgrade in the editor.
  204 |   await older.close();
  205 |   await expect(page.getByText('Changes are not kept on this device')).toBeHidden();
  206 |   await expect(page.getByTestId('save-state')).toHaveText('Saved on this device only');
  207 |   await page.reload();
  208 |   await expect(page.getByText('Restored unsaved changes from this device.')).toBeVisible();
  209 |   await expect(page.locator('.react-flow__node[data-id="subloop"]')).toBeVisible();
  210 | });
  211 |
  212 | for (const scenario of ['pending', 'synced', 'stale', 'unsynced'] as const) {
  213 |   test(`a seeded format-3 device draft: ${scenario}`, async ({ page, request }) => {
  214 |     const pending = scenario === 'pending';
  215 |     const synced = scenario === 'synced';
  216 |     const stale = scenario === 'stale';
  217 |     const created = await request.post('/loops', {
  218 |       data: { definition: approvalLoop('cutover server') },
  219 |     });
  220 |     expect(created.status()).toBe(201);
  221 |     const { loop } = (await created.json()) as { loop: { id: string } };
  222 |     const original = {
  223 |       loopId: loop.id,
  224 |       savedAt: scenario === 'unsynced' ? '2999-01-01T00:00:00.000Z' : '2000-01-01T00:00:00.000Z',
  225 |       synced,
  226 |       baseToken: 'old-server-token',
  227 |       definition: {
  228 |         schemaVersion: 3,
  229 |         name: pending ? 'pending device' : 'automatic device',
  230 |         nodes: [
  231 |           { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
  232 |           {
  233 |             id: 'done',
  234 |             kind: 'exit',
  235 |             label: 'Done',
  236 |             config: pending ? { criteria: [{ when: 'max-iterations', value: 3 }] } : {},
  237 |           },
  238 |         ],
  239 |         edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  240 |       },
  241 |     };
  242 |     await page.goto('/app/loops');
  243 |     await page.evaluate(async (draft) => {
  244 |       const database = await new Promise<IDBDatabase>((resolve, reject) => {
  245 |         const opening = indexedDB.open('graphgoblin', 2);
  246 |         opening.onupgradeneeded = () => {
  247 |           if (!opening.result.objectStoreNames.contains('drafts'))
  248 |             opening.result.createObjectStore('drafts');
  249 |         };
  250 |         opening.onsuccess = () => resolve(opening.result);
  251 |         opening.onerror = () => reject(opening.error ?? new Error('IndexedDB open failed'));
  252 |       });
  253 |       await new Promise<void>((resolve, reject) => {
  254 |         const tx = database.transaction('drafts', 'readwrite');
  255 |         tx.objectStore('drafts').put(draft, draft.loopId);
  256 |         tx.oncomplete = () => resolve();
  257 |         tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  258 |         tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  259 |       });
  260 |       database.close();
  261 |     }, original);
  262 |     await page.goto(`/app/loops/${loop.id}/edit`);
  263 |     if (pending) {
  264 |       await expect(page.getByRole('heading', { name: 'cutover server' })).toBeVisible();
  265 |       await expect(page.getByText('This device copy could not be migrated safely')).toBeVisible();
  266 |       await expect(page.getByText('/nodes/1/config:exit-policy', { exact: true })).toBeVisible();
  267 |       const downloadReady = page.waitForEvent('download');
  268 |       await page.getByRole('button', { name: 'Export original device copy' }).click();
  269 |       const download = await downloadReady;
  270 |       const path = await download.path();
  271 |       if (!path) throw new Error('Expected local download');
  272 |       expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original);
  273 |     } else if (synced || stale) {
  274 |       await expect(page.getByRole('heading', { name: 'cutover server' })).toBeVisible();
  275 |       // The server heading can render before device conversion and archival finish. Negative
  276 |       // notice assertions and reload must follow the observable reconciliation completion.
  277 |       await expect(
  278 |         page.getByText(
  279 |           'The editor is available. Checking the server and this device before saving changes.',
  280 |           { exact: true },
  281 |         ),
  282 |       ).toBeHidden();
  283 |       await expect(page.getByText('This device draft was converted to format 4')).toBeHidden();
  284 |       await expect(page.getByText('The draft changed on the server')).toBeHidden();
  285 |       if (stale) {
  286 |         await expect(page.getByText('The server has a newer draft')).toBeVisible();
  287 |         await page.getByRole('button', { name: "Use this device's copy instead" }).click();
  288 |         await expect(page.getByRole('heading', { name: 'automatic device' })).toBeVisible();
  289 |         await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
```
