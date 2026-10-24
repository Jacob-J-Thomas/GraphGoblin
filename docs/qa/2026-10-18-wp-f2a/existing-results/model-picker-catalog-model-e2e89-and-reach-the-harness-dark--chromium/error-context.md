# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-picker.spec.ts >> catalog model and effort publish and reach the harness (dark)
- Location: e2e\model-picker.spec.ts:28:3

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('dialog').getByLabel('Model', { exact: true })
Expected: "picker-dark"
Received: ""
Timeout:  10000ms

Call log:
  - Expect "toHaveValue" getByRole('dialog').getByLabel('Model', { exact: true }) with timeout 10000ms
  - waiting for getByRole('dialog').getByLabel('Model', { exact: true })
    22 × locator resolved to <select id="_r_12_" aria-describedby="_r_12_-help" class="rounded-md border border-strong transition-[border-color,box-shadow] hover:border-field-hover bg-surface-field aria-invalid:border-status-bad-border w-full min-w-0 px-3 text-md text-default placeholder:text-subtle focus-visible:border-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-default disabled:bg-surface-sunken disabled:text-subtle h-9 cursor-point…>…</select>
       - unexpected value ""

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
    - heading "picker dark" [level=1]
    - text: draft only All changes saved
    - button "Undo" [disabled]
    - button "Redo" [disabled]
    - link "Open in Runs" [disabled]
    - text: 'Publish the loop first: runs start from a published version. Ready to publish'
    - button "Publish"
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
            - group "start out to infer"
        - img:
            - group "infer out to done"
        - group "Trigger Start (start)": Trigger Start start out
        - group "Inference Infer (infer)": Inference Infer infer out
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
        - textbox "Name": picker dark
        - text: Description
        - textbox "Description"
        - heading "Settings" [level=3]
        - paragraph: Maximum node visits is a safety cap against unintended cycles. Use a decision gate's maximum passes for an intentional repeat.
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
            - text: Subloop depth limit
            - spinbutton "Subloop depth limit": '8'
        - heading "Variables" [level=3]
        - paragraph: Each variable maps a name to a JSON Schema.
        - form "Variables form":
            - group "Variables":
                - text: Variables
                - button "Add entry"
                - status
- dialog "Edit inference infer":
    - banner:
        - heading "Edit inference infer" [level=2]
        - button "Close"
    - region "Node properties":
        - text: Node id
        - textbox "Node id": infer
        - text: Label
        - textbox "Label": Infer
        - group:
            - form "infer config":
                - tablist "Node configuration":
                    - tab "Settings" [selected]
                    - tab "Context"
                - tabpanel "Settings":
                    - radiogroup "Harness":
                        - text: Harness
                        - radio "codex" [checked]
                        - text: codex
                        - radio "claude"
                        - text: claude
                    - paragraph: Harness that runs the session.
                    - group "Session":
                        - text: Session Policy
                        - combobox "Policy":
                            - option "fresh" [selected]
                            - option "resume-previous"
                            - option "resume-named"
                        - paragraph: Start fresh, resume the previous session, or resume a named session.
                    - group "Prompt":
                        - text: Prompt
                        - paragraph: Liquid template rendered against the thread.
                        - text: Template Liquid
                        - textbox "Template"
                        - text: 'Preview (sample thread): picker run'
                        - button "Earlier node outputs (1)"
                    - radiogroup "Sandbox":
                        - text: Sandbox
                        - radio "read-only"
                        - text: read-only
                        - radio "workspace-write" [checked]
                        - text: workspace-write
                        - radio "danger-full-access"
                        - text: danger-full-access
                    - paragraph: Sandbox or tool policy. Claude requires an explicit supported policy and provides no OS/read-path confinement.
                    - button "Advanced"
        - region "Connections":
            - heading "Connections" [level=3]
            - list:
                - listitem:
                    - text: out →
                    - code: done
                    - button "Remove edge e2"
    - contentinfo:
        - button "Delete node"
        - button "Done"
```

# Test source

```ts
  1   | import { LoopDefinitionSchema, ModelCatalogEntrySchema } from '@graphgoblin/contracts';
  2   | import { minimalLoop } from '@graphgoblin/contracts/testing';
  3   | import { closeNode, control, expect, openNode, showLoopPanel, test } from './fixtures.js';
  4   |
  5   | function inferenceLoop(name: string, model?: string) {
  6   |   const source = minimalLoop();
  7   |   return {
  8   |     ...source,
  9   |     name,
  10  |     nodes: [
  11  |       source.nodes[0]!,
  12  |       {
  13  |         id: 'infer',
  14  |         kind: 'inference',
  15  |         label: 'Infer',
  16  |         config: { prompt: { template: 'picker run' }, ...(model ? { model } : {}) },
  17  |       },
  18  |       source.nodes[1]!,
  19  |     ].map((node, i) => ({ ...node, ui: { x: i * 260, y: 80 } })),
  20  |     edges: [
  21  |       { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
  22  |       { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
  23  |     ],
  24  |   };
  25  | }
  26  |
  27  | for (const theme of ['dark', 'light']) {
  28  |   test(`catalog model and effort publish and reach the harness (${theme})`, async ({
  29  |     page,
  30  |     request,
  31  |   }) => {
  32  |     const selected = `picker-${theme}`;
  33  |     await control(request, '/catalog/upsert', {
  34  |       harness: 'codex',
  35  |       model: selected,
  36  |       displayName: `Picker ${theme}`,
  37  |       efforts: ['low', 'high'],
  38  |       defaultEffort: 'low',
  39  |       enabled: true,
  40  |       source: 'harness',
  41  |     });
  42  |     const created = await request.post('/loops', {
  43  |       data: { definition: inferenceLoop(`picker ${theme}`) },
  44  |     });
  45  |     expect(created.status()).toBe(201);
  46  |     const { loop } = (await created.json()) as { loop: { id: string } };
  47  |     await page.addInitScript((choice) => localStorage.setItem('graphgoblin-theme', choice), theme);
  48  |     await page.goto(`/app/loops/${loop.id}/edit`);
  49  |     const dialog = await openNode(page, 'infer');
  50  |     const model = dialog.getByLabel('Model', { exact: true });
  51  |     await expect(model).not.toHaveAttribute('aria-readonly');
  52  |     await expect(model).toHaveValue('');
  53  |     await model.focus();
  54  |     await page.keyboard.type(`Picker ${theme}`);
  55  |     await page.keyboard.press('Enter');
> 56  |     await expect(model).toHaveValue(selected);
      |                         ^ Error: expect(locator).toHaveValue(expected) failed
  57  |     const effort = dialog.getByLabel('Effort', { exact: true });
  58  |     await expect(effort.locator('option')).toHaveText([
  59  |       '(inherited; the catalog suggests low)',
  60  |       'low',
  61  |       'high',
  62  |     ]);
  63  |     await effort.focus();
  64  |     await page.keyboard.press('h');
  65  |     await page.keyboard.press('Enter');
  66  |     await expect(effort).toHaveValue('high');
  67  |     await closeNode(page);
  68  |     await page.getByRole('button', { name: 'Publish', exact: true }).click();
  69  |     await expect(page.getByText('Published version 1.')).toBeVisible();
  70  |     const read = await request.get(`/loops/${loop.id}`);
  71  |     const stored = (await read.json()) as { current: { definition: unknown } };
  72  |     const config = LoopDefinitionSchema.parse(stored.current.definition).nodes.find(
  73  |       (node) => node.id === 'infer',
  74  |     )?.config;
  75  |     expect(config).toMatchObject({ model: selected, effort: 'high' });
  76  |     await control(request, '/harness/script', { turns: [{ finalText: 'picker done' }] });
  77  |     const before = (await control(request, '/harness/requests')) as {
  78  |       started: { model: string; effort: string }[];
  79  |     };
  80  |     await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  81  |     await page.getByRole('button', { name: 'Start run', exact: true }).click();
  82  |     await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  83  |     await expect
  84  |       .poll(async () =>
  85  |         ((await control(request, '/harness/requests')) as typeof before).started.slice(
  86  |           before.started.length,
  87  |         ),
  88  |       )
  89  |       .toEqual([{ model: selected, effort: 'high' }]);
  90  |     await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  91  |   });
  92  | }
  93  |
  94  | test('a saved model removed from the catalog stays selected and explicit unknown import is rejected', async ({
  95  |   page,
  96  |   request,
  97  | }) => {
  98  |   await control(request, '/catalog/upsert', {
  99  |     harness: 'codex',
  100 |     model: 'imported-unknown-model',
  101 |     displayName: 'Imported unknown picker',
  102 |     efforts: ['low'],
  103 |     defaultEffort: 'low',
  104 |     enabled: true,
  105 |     source: 'litellm',
  106 |   });
  107 |   const created = await request.post('/loops', {
  108 |     data: { definition: inferenceLoop('imported unknown picker', 'imported-unknown-model') },
  109 |   });
  110 |   expect(created.status()).toBe(201);
  111 |   const { loop } = (await created.json()) as { loop: { id: string } };
  112 |   expect((await request.delete('/model-catalog/codex/imported-unknown-model')).status()).toBe(204);
  113 |   const rejectedImport = await request.post('/loops/import', {
  114 |     data: inferenceLoop('explicit unknown import', 'imported-unknown-model'),
  115 |   });
  116 |   expect(rejectedImport.status()).toBe(400);
  117 |   await page.goto(`/app/loops/${loop.id}/edit`);
  118 |   const dialog = await openNode(page, 'infer');
  119 |   const model = dialog.getByLabel('Model', { exact: true });
  120 |   await expect(model).toHaveValue('imported-unknown-model');
  121 |   await expect(model.locator('option:checked')).toHaveText(
  122 |     'imported-unknown-model (not in catalog)',
  123 |   );
  124 |   await expect(model).toHaveAccessibleDescription(/not in the catalog/);
  125 |   await expect(model).not.toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG/);
  126 |   await expect(dialog.locator('[data-field="model"] [role="status"] svg')).toHaveAttribute(
  127 |     'data-icon',
  128 |     'alert',
  129 |   );
  130 |   await expect(dialog.getByRole('link', { name: 'Model catalog in Settings' })).toHaveAttribute(
  131 |     'href',
  132 |     '/app/settings',
  133 |   );
  134 |   await closeNode(page);
  135 |   await page.route('**/model-catalog', (route) =>
  136 |     route.fulfill({
  137 |       status: 503,
  138 |       contentType: 'application/problem+json',
  139 |       body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
  140 |     }),
  141 |   );
  142 |   await page.reload();
  143 |   const offlineDialog = await openNode(page, 'infer');
  144 |   const offlineModel = offlineDialog.getByLabel('Model', { exact: true });
  145 |   await expect(offlineModel).toHaveValue('imported-unknown-model');
  146 |   await expect(offlineModel).toHaveAttribute('aria-readonly', 'true');
  147 |   await expect(offlineModel).toHaveAccessibleDescription(/Cannot load the model catalog/);
  148 |   await expect(offlineModel).toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG/);
  149 | });
  150 |
  151 | test('catalog failure preserves the current values until retry and loop defaults share the picker', async ({
  152 |   page,
  153 |   request,
  154 | }) => {
  155 |   const catalog = ModelCatalogEntrySchema.array().parse(
  156 |     ((await (await request.get('/model-catalog')).json()) as { items: unknown }).items,
```
