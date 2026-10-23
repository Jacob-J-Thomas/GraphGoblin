# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-picker.spec.ts >> catalog failure preserves the current values until retry and loop defaults share the picker
- Location: e2e\model-picker.spec.ts:151:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('dialog').getByRole('button', { name: 'Retry model catalog' })

```

# Page snapshot

```yaml
- generic [ref=e3]:
    - banner [ref=e4]:
        - generic [ref=e5]: GraphGoblin
        - navigation "Main" [ref=e22]:
            - link "Loops" [ref=e23] [cursor=pointer]:
                - /url: /app/loops
            - link "Runs" [ref=e25] [cursor=pointer]:
                - /url: /app/runs
            - link "Events" [ref=e27] [cursor=pointer]:
                - /url: /app/events
            - link "Settings" [ref=e29] [cursor=pointer]:
                - /url: /app/settings
    - generic [ref=e31]:
        - banner [ref=e32]:
            - link "Loops" [ref=e33] [cursor=pointer]:
                - /url: /app/loops
            - generic [ref=e34]: /
            - heading "failed catalog picker" [level=1] [ref=e35]
            - generic [ref=e36]: draft only
            - generic [ref=e38]: All changes saved
            - generic [ref=e42]:
                - button "Undo" [disabled] [ref=e43]
                - button "Redo" [disabled] [ref=e47]
                - link "Open in Runs" [disabled] [ref=e51]
                - generic [ref=e54]: 'Publish the loop first: runs start from a published version.'
                - generic "The server’s checks (cron expressions, subloops) could not run; Publish runs them again." [ref=e55]: Validation unavailable
                - button "Publish" [ref=e59] [cursor=pointer]
        - generic [ref=e64]:
            - complementary [ref=e65]:
                - generic [ref=e66]:
                    - button "Hide palette" [expanded] [ref=e67] [cursor=pointer]
                    - heading "Palette" [level=2] [ref=e70]
                - navigation "Node palette" [ref=e72]:
                    - button "Add Trigger node" [ref=e73]:
                        - generic [ref=e77]: Trigger
                        - generic [ref=e78]: Starts a run
                    - button "Add Decision node" [ref=e79]:
                        - generic [ref=e84]: Decision
                        - generic [ref=e85]: Chooses a route and can limit repeats
                    - button "Add Inference node" [ref=e86]:
                        - generic [ref=e91]: Inference
                        - generic [ref=e92]: Hands work to a harness
                    - button "Add Script node" [ref=e93]:
                        - generic [ref=e97]: Script
                        - generic [ref=e98]: Runs a program
                    - button "Add Mutate node" [ref=e99]:
                        - generic [ref=e104]: Mutate
                        - generic [ref=e105]: Changes the context thread
                    - button "Add Subloop node" [ref=e106]:
                        - generic [ref=e111]: Subloop
                        - generic [ref=e112]: Runs another loop
                    - button "Add Wait node" [ref=e113]:
                        - generic [ref=e117]: Wait
                        - generic [ref=e118]: Parks until input, time, or a signal
                    - button "Add Heartbeat node" [ref=e119]:
                        - generic [ref=e123]: Heartbeat
                        - generic [ref=e124]: Polls on an interval
                    - button "Add Exit node" [ref=e125]:
                        - generic [ref=e129]: Exit
                        - generic [ref=e130]: Finishes with an outcome and return value
            - main [ref=e131]:
                - application [ref=e133]:
                    - generic [ref=e135]:
                        - generic:
                            - generic:
                                - img:
                                    - group "start out to infer" [ref=e136] [cursor=pointer]
                                - img:
                                    - group "infer out to done" [ref=e139] [cursor=pointer]
                            - generic:
                                - group "Trigger Start (start)" [ref=e142]:
                                    - generic [ref=e143]:
                                        - generic [ref=e144]: Trigger
                                        - generic [ref=e149]:
                                            - generic [ref=e150]: Start
                                            - generic [ref=e151]: start
                                            - generic [ref=e153]:
                                                - text: out
                                                - generic "start output out (out)" [ref=e154]
                                - group "Inference Infer (infer)" [ref=e155]:
                                    - generic [ref=e156]:
                                        - generic "infer input" [ref=e157]
                                        - generic [ref=e158]: Inference
                                        - generic [ref=e164]:
                                            - generic [ref=e165]: Infer
                                            - generic [ref=e166]: infer
                                            - generic [ref=e168]:
                                                - text: out
                                                - generic "infer output out (out)" [ref=e169]
                                - group "Exit Done (done)" [ref=e170]:
                                    - generic [ref=e171]:
                                        - generic "done input" [ref=e172]
                                        - generic [ref=e173]: Exit
                                        - generic [ref=e178]:
                                            - generic [ref=e179]: Done
                                            - generic [ref=e180]: done
                    - generic "Control Panel" [ref=e181]:
                        - button "Zoom In" [ref=e182] [cursor=pointer]
                        - button "Zoom Out" [ref=e185] [cursor=pointer]
                        - button "Fit View" [ref=e188] [cursor=pointer]
                        - button "Toggle Interactivity" [ref=e191] [cursor=pointer]
                    - link "React Flow attribution" [ref=e195] [cursor=pointer]:
                        - /url: https://reactflow.dev?utm_source=attribution
                        - text: React Flow
            - complementary [ref=e198]:
                - generic [ref=e199]:
                    - heading "Loop settings" [level=2] [ref=e200]
                    - button "Hide loop settings" [expanded] [ref=e201] [cursor=pointer]
                - region "Loop settings" [ref=e205]:
                    - paragraph [aria-hidden] [ref=e206]: Required fields are marked *
                    - generic [ref=e207]:
                        - generic [ref=e208]:
                            - generic [ref=e209]: Name
                            - generic [aria-hidden] [ref=e210]: '*'
                        - textbox "Name" [ref=e211]: failed catalog picker
                    - generic [ref=e212]:
                        - generic [ref=e213]: Description
                        - textbox "Description" [ref=e214]
                    - heading "Settings" [level=3] [ref=e215]
                    - paragraph [ref=e216]: Maximum node visits is a safety cap against unintended cycles. Use a decision gate's maximum passes for an intentional repeat.
                    - form "Loop settings form" [ref=e217]:
                        - generic [ref=e219]:
                            - group "Working directory" [ref=e220]:
                                - generic [ref=e222]:
                                    - generic [ref=e223]: Kind
                                    - combobox "Kind" [ref=e225] [cursor=pointer]:
                                        - option "fixed"
                                        - option "template"
                                        - option "temp" [selected]
                            - group "Defaults" [ref=e226]:
                                - group "By harness" [ref=e228]:
                                    - paragraph [ref=e230]: Defaults keyed by their harness; omitted fields inherit only within that harness.
                                    - button "Add entry" [ref=e232] [cursor=pointer]
                                    - status [ref=e236]
                            - generic [ref=e237]:
                                - generic [ref=e238]: Maximum node visits
                                - spinbutton "Maximum node visits" [ref=e240]: '10'
                            - generic [ref=e241]:
                                - generic [ref=e242]: Subloop depth limit
                                - spinbutton "Subloop depth limit" [ref=e244]: '8'
                    - generic [ref=e245]:
                        - heading "Variables" [level=3] [ref=e246]
                        - paragraph [ref=e247]: Each variable maps a name to a JSON Schema.
                    - form "Variables form" [ref=e248]:
                        - group "Variables" [ref=e251]:
                            - generic [ref=e252]: Variables *
                            - button "Add entry" [ref=e254] [cursor=pointer]
                            - status [ref=e258]
        - dialog [ref=e259]:
            - banner [ref=e260]:
                - heading "Edit inference infer" [active] [level=2] [ref=e266]:
                    - text: Edit inference
                    - generic [ref=e267]: infer
                - button "Close" [ref=e268] [cursor=pointer]
            - region "Node properties" [ref=e272]:
                - paragraph [aria-hidden] [ref=e273]: Required fields are marked *
                - generic [ref=e274]:
                    - generic [ref=e275]:
                        - generic [ref=e276]:
                            - generic [ref=e277]: Node id
                            - generic [aria-hidden] [ref=e278]: '*'
                        - textbox "Node id" [ref=e279]: infer
                    - generic [ref=e280]:
                        - generic [ref=e281]:
                            - generic [ref=e282]: Label
                            - generic [aria-hidden] [ref=e283]: '*'
                        - textbox "Label" [ref=e284]: Infer
                - group [ref=e286]:
                    - form "infer config" [ref=e287]:
                        - generic [ref=e288]:
                            - tablist "Node configuration" [ref=e289]:
                                - tab "Settings" [selected] [ref=e290] [cursor=pointer]
                                - tab "Context" [ref=e291] [cursor=pointer]
                            - tabpanel "Settings" [ref=e292]:
                                - generic [ref=e293]:
                                    - radiogroup "Harness" [ref=e294]:
                                        - generic [ref=e297]:
                                            - generic [ref=e298]:
                                                - radio "codex" [checked] [ref=e299]
                                                - generic "codex" [ref=e300] [cursor=pointer]
                                            - generic [ref=e302]:
                                                - radio "claude" [ref=e303]
                                                - generic "claude" [ref=e304] [cursor=pointer]
                                    - paragraph [ref=e306]: Harness that runs the session.
                                - group "Session" [ref=e307]:
                                    - generic [ref=e309]:
                                        - generic [ref=e310]: Policy
                                        - combobox "Policy" [ref=e312] [cursor=pointer]:
                                            - option "fresh" [selected]
                                            - option "resume-previous"
                                            - option "resume-named"
                                        - paragraph [ref=e313]: Start fresh, resume the previous session, or resume a named session.
                                - group "Prompt" [ref=e314]:
                                    - paragraph [ref=e316]: Liquid template rendered against the thread.
                                    - generic [ref=e317]:
                                        - generic [ref=e318]:
                                            - generic [ref=e319]:
                                                - generic [ref=e320]: Template
                                                - generic [aria-hidden] [ref=e321]: '*'
                                            - generic [ref=e322]: Liquid
                                        - generic [ref=e323]:
                                            - generic [ref=e326]:
                                                - generic [ref=e328]: '1'
                                                - textbox "Template" [ref=e332]:
                                                    - generic [ref=e333]: picker run
                                            - generic [ref=e334]: 'Preview (sample thread): picker run'
                                            - button "Earlier node outputs (1)" [ref=e336] [cursor=pointer]
                                - generic [ref=e342]:
                                    - radiogroup "Sandbox" [ref=e343]:
                                        - generic [ref=e346]:
                                            - generic [ref=e347]:
                                                - radio "read-only" [ref=e348]
                                                - generic "read-only" [ref=e349] [cursor=pointer]
                                            - generic [ref=e351]:
                                                - radio "workspace-write" [checked] [ref=e352]
                                                - generic "workspace-write" [ref=e353] [cursor=pointer]
                                            - generic [ref=e355]:
                                                - radio "danger-full-access" [ref=e356]
                                                - generic "danger-full-access" [ref=e357] [cursor=pointer]
                                    - paragraph [ref=e359]: Sandbox or tool policy. Claude requires an explicit supported policy and provides no OS/read-path confinement.
                                - button "Advanced 1 set" [ref=e361] [cursor=pointer]:
                                    - generic [ref=e364]:
                                        - generic [ref=e365]: Advanced
                                        - generic [ref=e366]: 1 set
                - region "Connections" [ref=e368]:
                    - heading "Connections" [level=3] [ref=e369]
                    - list [ref=e370]:
                        - listitem [ref=e371]:
                            - generic [ref=e372]:
                                - text: out →
                                - code [ref=e373]: done
                            - button "Remove edge e2" [ref=e374] [cursor=pointer]
            - contentinfo [ref=e377]:
                - button "Delete node" [ref=e378] [cursor=pointer]
                - button "Done" [ref=e382] [cursor=pointer]
```

# Test source

```ts
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
  157 |   );
  158 |   const chosen = catalog.find((entry) => entry.enabled && entry.harness === 'codex')!;
  159 |   const created = await request.post('/loops', {
  160 |     data: { definition: inferenceLoop('failed catalog picker', chosen.model) },
  161 |   });
  162 |   const { loop } = (await created.json()) as { loop: { id: string } };
  163 |   await page.route('**/model-catalog', (route) =>
  164 |     route.fulfill({
  165 |       status: 503,
  166 |       contentType: 'application/problem+json',
  167 |       body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
  168 |     }),
  169 |   );
  170 |   await page.goto(`/app/loops/${loop.id}/edit`);
  171 |   const dialog = await openNode(page, 'infer');
  172 |   const model = dialog.getByLabel('Model', { exact: true });
  173 |   await expect(model).toHaveValue(chosen.model);
  174 |   await expect(model).toHaveAttribute('aria-readonly', 'true');
  175 |   await expect(model).toHaveAccessibleDescription(/Cannot load the model catalog/);
  176 |   await page.unroute('**/model-catalog');
> 177 |   await dialog.getByRole('button', { name: 'Retry model catalog' }).click();
      |                                                                     ^ Error: locator.click: Test timeout of 60000ms exceeded.
  178 |   await expect(model).not.toHaveAttribute('aria-readonly');
  179 |   await expect(model).toHaveValue(chosen.model);
  180 |   await closeNode(page);
  181 |   await showLoopPanel(page);
  182 |   const settings = page.getByRole('form', { name: 'Loop settings form' });
  183 |   const defaults = settings.locator('[data-field="defaults.byHarness"]');
  184 |   await defaults.getByRole('button', { name: 'Add entry', exact: true }).click();
  185 |   await defaults.getByRole('textbox', { name: 'By harness key 1' }).fill('codex');
  186 |   const codexDefaults = settings.locator('[data-field="defaults.byHarness.codex"]');
  187 |   const defaultModel = codexDefaults.getByLabel('Model', { exact: true });
  188 |   await expect(defaultModel.locator('option').first()).toHaveText('(owner default)');
  189 |   await defaultModel.selectOption(chosen.model);
  190 |   await expect(codexDefaults.getByLabel('Effort', { exact: true }).locator('option')).toHaveCount(
  191 |     chosen.efforts.length + 1,
  192 |   );
  193 | });
  194 |
  195 | test('the decision LLM uses an explicit harness model and rejects unsupported effort on admission', async ({
  196 |   page,
  197 |   request,
  198 | }) => {
  199 |   await control(request, '/catalog/upsert', {
  200 |     harness: 'codex',
  201 |     model: 'picker-decision',
  202 |     displayName: 'Picker decision',
  203 |     efforts: ['low', 'high'],
  204 |     defaultEffort: 'low',
  205 |     enabled: true,
  206 |     source: 'harness',
  207 |   });
  208 |   const source = inferenceLoop('decision picker');
  209 |   const withDecision = (effort: string) => ({
  210 |     ...source,
  211 |     nodes: source.nodes.map((node) =>
  212 |       node.id === 'infer'
  213 |         ? {
  214 |             ...node,
  215 |             kind: 'decision',
  216 |             config: {
  217 |               kind: 'llm',
  218 |               harness: 'codex',
  219 |               model: { mode: 'explicit', value: 'picker-decision' },
  220 |               effort: { mode: 'explicit', value: effort },
  221 |               context: {},
  222 |               instructions: 'q',
  223 |               routes: [
  224 |                 {
  225 |                   id: 'yes',
  226 |                   label: 'Yes',
  227 |                 },
  228 |                 {
  229 |                   id: 'no',
  230 |                   label: 'No',
  231 |                 },
  232 |               ],
  233 |             },
  234 |           }
  235 |         : node,
  236 |     ),
  237 |     edges: [
  238 |       source.edges[0],
  239 |       { id: 'yes', from: { node: 'infer', port: 'yes' }, to: { node: 'done' } },
  240 |       { id: 'no', from: { node: 'infer', port: 'no' }, to: { node: 'done' } },
  241 |     ],
  242 |   });
  243 |   const invalid = await request.post('/loops', {
  244 |     data: {
  245 |       definition: withDecision('max'),
  246 |     },
  247 |   });
  248 |   expect(invalid.status()).toBe(400);
  249 |   const created = await request.post('/loops', { data: { definition: withDecision('high') } });
  250 |   expect(created.status()).toBe(201);
  251 |   const { loop } = (await created.json()) as { loop: { id: string } };
  252 |   await page.goto(`/app/loops/${loop.id}/edit`);
  253 |   const dialog = await openNode(page, 'infer');
  254 |   const evaluation = dialog;
  255 |   const modelGroup = evaluation.getByRole('group', { name: 'Model', exact: true });
  256 |   const effortGroup = evaluation.getByRole('group', { name: 'Effort', exact: true });
  257 |   const model = modelGroup.getByLabel('Value', { exact: true });
  258 |   const effort = effortGroup.getByLabel('Value', { exact: true });
  259 |   await expect(model).toHaveValue('picker-decision');
  260 |   await expect(effort).toHaveValue('high');
  261 |   await closeNode(page);
  262 |   await page.getByRole('button', { name: 'Publish', exact: true }).click();
  263 |   await expect(page.getByText('Published version 1.')).toBeVisible();
  264 |   const read = await request.get(`/loops/${loop.id}`);
  265 |   const stored = (await read.json()) as { current: { definition: unknown } };
  266 |   expect(
  267 |     LoopDefinitionSchema.parse(stored.current.definition).nodes.find((node) => node.id === 'infer')
  268 |       ?.config,
  269 |   ).toMatchObject({
  270 |     kind: 'llm',
  271 |     model: { mode: 'explicit', value: 'picker-decision' },
  272 |     effort: { mode: 'explicit', value: 'high' },
  273 |   });
  274 | });
  275 |
  276 | test('following a model issue keeps focus through a delayed catalog and a failed cached refresh', async ({
  277 |   page,
```
