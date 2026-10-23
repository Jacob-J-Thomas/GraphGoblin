# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-picker.spec.ts >> a saved model removed from the catalog stays selected and explicit unknown import is rejected
- Location: e2e\model-picker.spec.ts:102:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('dialog').getByRole('link', { name: 'Model catalog in Settings' })
Expected: "/app/settings"
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('dialog').getByRole('link', { name: 'Model catalog in Settings' }) with timeout 10000ms
  - waiting for getByRole('dialog').getByRole('link', { name: 'Model catalog in Settings' })

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
    - heading "imported unknown picker" [level=1]
    - text: draft only All changes saved
    - button "Undo" [disabled]
    - button "Redo" [disabled]
    - link "Open in Runs" [disabled]
    - text: 'Publish the loop first: runs start from a published version.'
    - button "1 error"
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
        - group "Inference Infer (infer)":
            - text: Inference
            - button "1 issue on infer"
            - text: Infer infer out
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
        - textbox "Name": imported unknown picker
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
        - button "1 issue on infer"
        - button "Close"
    - region "Node properties":
        - text: Node id
        - textbox "Node id": infer
        - text: Label
        - textbox "Label": Infer
        - group:
            - form "infer config":
                - tablist "Node configuration":
                    - tab "Settings 1 error" [selected]
                    - tab "Context"
                - tabpanel "Settings 1 error":
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
                    - button "Advanced 1 set 1 error"
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
  64  |     await expect(model).toHaveValue(selected);
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
> 138 |   await expect(dialog.getByRole('link', { name: 'Model catalog in Settings' })).toHaveAttribute(
      |                                                                                 ^ Error: expect(locator).toHaveAttribute(expected) failed
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
  165 |   );
  166 |   const chosen = catalog.find((entry) => entry.enabled && entry.harness === 'codex')!;
  167 |   const created = await request.post('/loops', {
  168 |     data: { definition: inferenceLoop('failed catalog picker', chosen.model) },
  169 |   });
  170 |   const { loop } = (await created.json()) as { loop: { id: string } };
  171 |   await page.route('**/model-catalog', (route) =>
  172 |     route.fulfill({
  173 |       status: 503,
  174 |       contentType: 'application/problem+json',
  175 |       body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
  176 |     }),
  177 |   );
  178 |   await page.goto(`/app/loops/${loop.id}/edit`);
  179 |   const dialog = await openNode(page, 'infer');
  180 |   const model = dialog.getByLabel('Model', { exact: true });
  181 |   await expect(model).toHaveValue(chosen.model);
  182 |   await expect(model).toHaveAttribute('aria-readonly', 'true');
  183 |   await expect(model).toHaveAccessibleDescription(/Cannot load the model catalog/);
  184 |   await page.unroute('**/model-catalog');
  185 |   await dialog.getByRole('button', { name: 'Retry model catalog' }).click();
  186 |   await expect(model).not.toHaveAttribute('aria-readonly');
  187 |   await expect(model).toHaveValue(chosen.model);
  188 |   await closeNode(page);
  189 |   await showLoopPanel(page);
  190 |   const settings = page.getByRole('form', { name: 'Loop settings form' });
  191 |   const defaults = settings.locator('[data-field="defaults.byHarness"]');
  192 |   await defaults.getByRole('button', { name: 'Add entry', exact: true }).click();
  193 |   await defaults.getByRole('textbox', { name: 'By harness key 1' }).fill('codex');
  194 |   const codexDefaults = settings.locator('[data-field="defaults.byHarness.codex"]');
  195 |   const defaultModel = codexDefaults.getByLabel('Model', { exact: true });
  196 |   await expect(defaultModel.locator('option').first()).toHaveText('(owner default)');
  197 |   await defaultModel.selectOption(chosen.model);
  198 |   await expect(codexDefaults.getByLabel('Effort', { exact: true }).locator('option')).toHaveCount(
  199 |     chosen.efforts.length + 1,
  200 |   );
  201 | });
  202 |
  203 | test('the decision LLM uses an explicit harness model and rejects unsupported effort on admission', async ({
  204 |   page,
  205 |   request,
  206 | }) => {
  207 |   await control(request, '/catalog/upsert', {
  208 |     harness: 'codex',
  209 |     model: 'picker-decision',
  210 |     displayName: 'Picker decision',
  211 |     efforts: ['low', 'high'],
  212 |     defaultEffort: 'low',
  213 |     enabled: true,
  214 |     source: 'harness',
  215 |   });
  216 |   const source = inferenceLoop('decision picker');
  217 |   const withDecision = (effort: string) => ({
  218 |     ...source,
  219 |     nodes: source.nodes.map((node) =>
  220 |       node.id === 'infer'
  221 |         ? {
  222 |             ...node,
  223 |             kind: 'decision',
  224 |             config: {
  225 |               kind: 'llm',
  226 |               harness: 'codex',
  227 |               model: { mode: 'explicit', value: 'picker-decision' },
  228 |               effort: { mode: 'explicit', value: effort },
  229 |               context: {},
  230 |               instructions: 'q',
  231 |               routes: [
  232 |                 {
  233 |                   id: 'yes',
  234 |                   label: 'Yes',
  235 |                 },
  236 |                 {
  237 |                   id: 'no',
  238 |                   label: 'No',
```
