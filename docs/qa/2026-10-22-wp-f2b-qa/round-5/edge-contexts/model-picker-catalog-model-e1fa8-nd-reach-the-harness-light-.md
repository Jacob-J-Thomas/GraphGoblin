# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-picker.spec.ts >> catalog model and effort publish and reach the harness (light)
- Location: e2e\model-picker.spec.ts:36:3

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('dialog').getByLabel('Model', { exact: true })
Expected: "picker-light"
Received: ""
Timeout:  10000ms

Call log:
  - Expect "toHaveValue" getByRole('dialog').getByLabel('Model', { exact: true }) with timeout 10000ms
  - waiting for getByRole('dialog').getByLabel('Model', { exact: true })
    23 × locator resolved to <select id="_r_11_" aria-describedby="_r_11_-help" class="rounded-md border border-strong transition-[border-color,box-shadow] hover:border-field-hover bg-surface-field aria-invalid:border-status-bad-border w-full min-w-0 px-3 text-md text-default placeholder:text-subtle focus-visible:border-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-default disabled:bg-surface-sunken disabled:text-subtle h-9 cursor-point…>…</select>
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
    - heading "picker light" [level=1]
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
        - textbox "Name": picker light
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
  3   | import {
  4   |   closeNode,
  5   |   control,
  6   |   expect,
  7   |   openAdvanced,
  8   |   openNode,
  9   |   showLoopPanel,
  10  |   test,
  11  | } from './fixtures.js';
  12  |
  13  | function inferenceLoop(name: string, model?: string) {
  14  |   const source = minimalLoop();
  15  |   return {
  16  |     ...source,
  17  |     name,
  18  |     nodes: [
  19  |       source.nodes[0]!,
  20  |       {
  21  |         id: 'infer',
  22  |         kind: 'inference',
  23  |         label: 'Infer',
  24  |         config: { prompt: { template: 'picker run' }, ...(model ? { model } : {}) },
  25  |       },
  26  |       source.nodes[1]!,
  27  |     ].map((node, i) => ({ ...node, ui: { x: i * 260, y: 80 } })),
  28  |     edges: [
  29  |       { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
  30  |       { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
  31  |     ],
  32  |   };
  33  | }
  34  |
  35  | for (const theme of ['dark', 'light']) {
  36  |   test(`catalog model and effort publish and reach the harness (${theme})`, async ({
  37  |     page,
  38  |     request,
  39  |   }) => {
  40  |     const selected = `picker-${theme}`;
  41  |     await control(request, '/catalog/upsert', {
  42  |       harness: 'codex',
  43  |       model: selected,
  44  |       displayName: `Picker ${theme}`,
  45  |       efforts: ['low', 'high'],
  46  |       defaultEffort: 'low',
  47  |       enabled: true,
  48  |       source: 'harness',
  49  |     });
  50  |     const created = await request.post('/loops', {
  51  |       data: { definition: inferenceLoop(`picker ${theme}`) },
  52  |     });
  53  |     expect(created.status()).toBe(201);
  54  |     const { loop } = (await created.json()) as { loop: { id: string } };
  55  |     await page.addInitScript((choice) => localStorage.setItem('graphgoblin-theme', choice), theme);
  56  |     await page.goto(`/app/loops/${loop.id}/edit`);
  57  |     const dialog = await openNode(page, 'infer');
  58  |     const model = dialog.getByLabel('Model', { exact: true });
  59  |     await expect(model).not.toHaveAttribute('aria-readonly');
  60  |     await expect(model).toHaveValue('');
  61  |     await model.focus();
  62  |     await page.keyboard.type(`Picker ${theme}`);
  63  |     await page.keyboard.press('Enter');
> 64  |     await expect(model).toHaveValue(selected);
      |                         ^ Error: expect(locator).toHaveValue(expected) failed
  65  |     const effort = dialog.getByLabel('Effort', { exact: true });
  66  |     await expect(effort.locator('option')).toHaveText([
  67  |       '(inherited; the catalog suggests low)',
  68  |       'low',
  69  |       'high',
  70  |     ]);
  71  |     await effort.focus();
  72  |     await page.keyboard.press('h');
  73  |     await page.keyboard.press('Enter');
  74  |     await expect(effort).toHaveValue('high');
  75  |     await closeNode(page);
  76  |     await page.getByRole('button', { name: 'Publish', exact: true }).click();
  77  |     await expect(page.getByText('Published version 1.')).toBeVisible();
  78  |     const read = await request.get(`/loops/${loop.id}`);
  79  |     const stored = (await read.json()) as { current: { definition: unknown } };
  80  |     const config = LoopDefinitionSchema.parse(stored.current.definition).nodes.find(
  81  |       (node) => node.id === 'infer',
  82  |     )?.config;
  83  |     expect(config).toMatchObject({ model: selected, effort: 'high' });
  84  |     await control(request, '/harness/script', { turns: [{ finalText: 'picker done' }] });
  85  |     const before = (await control(request, '/harness/requests')) as {
  86  |       started: { model: string; effort: string }[];
  87  |     };
  88  |     await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  89  |     await page.getByRole('button', { name: 'Start run', exact: true }).click();
  90  |     await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  91  |     await expect
  92  |       .poll(async () =>
  93  |         ((await control(request, '/harness/requests')) as typeof before).started.slice(
  94  |           before.started.length,
  95  |         ),
  96  |       )
  97  |       .toEqual([{ model: selected, effort: 'high' }]);
  98  |     await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  99  |   });
  100 | }
  101 |
  102 | test('a saved model removed from the catalog stays selected and explicit unknown import is rejected', async ({
  103 |   page,
  104 |   request,
  105 | }) => {
  106 |   await control(request, '/catalog/upsert', {
  107 |     harness: 'codex',
  108 |     model: 'imported-unknown-model',
  109 |     displayName: 'Imported unknown picker',
  110 |     efforts: ['low'],
  111 |     defaultEffort: 'low',
  112 |     enabled: true,
  113 |     source: 'litellm',
  114 |   });
  115 |   const created = await request.post('/loops', {
  116 |     data: { definition: inferenceLoop('imported unknown picker', 'imported-unknown-model') },
  117 |   });
  118 |   expect(created.status()).toBe(201);
  119 |   const { loop } = (await created.json()) as { loop: { id: string } };
  120 |   expect((await request.delete('/model-catalog/codex/imported-unknown-model')).status()).toBe(204);
  121 |   const rejectedImport = await request.post('/loops/import', {
  122 |     data: inferenceLoop('explicit unknown import', 'imported-unknown-model'),
  123 |   });
  124 |   expect(rejectedImport.status()).toBe(400);
  125 |   await page.goto(`/app/loops/${loop.id}/edit`);
  126 |   const dialog = await openNode(page, 'infer');
  127 |   const model = dialog.getByLabel('Model', { exact: true });
  128 |   await expect(model).toHaveValue('imported-unknown-model');
  129 |   await expect(model.locator('option:checked')).toHaveText(
  130 |     'imported-unknown-model (not in catalog)',
  131 |   );
  132 |   await expect(model).toHaveAccessibleDescription(/not in the catalog/);
  133 |   await expect(model).not.toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG/);
  134 |   await expect(dialog.locator('[data-field="model"] [role="status"] svg')).toHaveAttribute(
  135 |     'data-icon',
  136 |     'alert',
  137 |   );
  138 |   await expect(dialog.getByRole('link', { name: 'Model catalog in Settings' })).toHaveAttribute(
  139 |     'href',
  140 |     '/app/settings',
  141 |   );
  142 |   await closeNode(page);
  143 |   await page.route('**/model-catalog', (route) =>
  144 |     route.fulfill({
  145 |       status: 503,
  146 |       contentType: 'application/problem+json',
  147 |       body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
  148 |     }),
  149 |   );
  150 |   await page.reload();
  151 |   const offlineDialog = await openNode(page, 'infer');
  152 |   const offlineModel = offlineDialog.getByLabel('Model', { exact: true });
  153 |   await expect(offlineModel).toHaveValue('imported-unknown-model');
  154 |   await expect(offlineModel).toHaveAttribute('aria-readonly', 'true');
  155 |   await expect(offlineModel).toHaveAccessibleDescription(/Cannot load the model catalog/);
  156 |   await expect(offlineModel).toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG/);
  157 | });
  158 |
  159 | test('catalog failure preserves the current values until retry and loop defaults share the picker', async ({
  160 |   page,
  161 |   request,
  162 | }) => {
  163 |   const catalog = ModelCatalogEntrySchema.array().parse(
  164 |     ((await (await request.get('/model-catalog')).json()) as { items: unknown }).items,
```
