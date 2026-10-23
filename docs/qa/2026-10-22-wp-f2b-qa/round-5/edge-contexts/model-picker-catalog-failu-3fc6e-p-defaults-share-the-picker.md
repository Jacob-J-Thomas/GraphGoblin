# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-picker.spec.ts >> catalog failure preserves the current values until retry and loop defaults share the picker
- Location: e2e\model-picker.spec.ts:159:1

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
                - generic "A model catalog could not be loaded. Retry its lookup before publishing." [ref=e55]: Validation unavailable
                - button "Publish" [disabled]
        - generic [ref=e60]:
            - complementary [ref=e61]:
                - generic [ref=e62]:
                    - button "Hide palette" [expanded] [ref=e63] [cursor=pointer]
                    - heading "Palette" [level=2] [ref=e66]
                - navigation "Node palette" [ref=e68]:
                    - button "Add Trigger node" [ref=e69]:
                        - generic [ref=e73]: Trigger
                        - generic [ref=e74]: Starts a run
                    - button "Add Decision node" [ref=e75]:
                        - generic [ref=e80]: Decision
                        - generic [ref=e81]: Chooses a route and can limit repeats
                    - button "Add Inference node" [ref=e82]:
                        - generic [ref=e87]: Inference
                        - generic [ref=e88]: Hands work to a harness
                    - button "Add Script node" [ref=e89]:
                        - generic [ref=e93]: Script
                        - generic [ref=e94]: Runs a program
                    - button "Add Mutate node" [ref=e95]:
                        - generic [ref=e100]: Mutate
                        - generic [ref=e101]: Changes the context thread
                    - button "Add Subloop node" [ref=e102]:
                        - generic [ref=e107]: Subloop
                        - generic [ref=e108]: Runs another loop
                    - button "Add Wait node" [ref=e109]:
                        - generic [ref=e113]: Wait
                        - generic [ref=e114]: Parks until input, time, or a signal
                    - button "Add Heartbeat node" [ref=e115]:
                        - generic [ref=e119]: Heartbeat
                        - generic [ref=e120]: Polls on an interval
                    - button "Add Exit node" [ref=e121]:
                        - generic [ref=e125]: Exit
                        - generic [ref=e126]: Finishes with an outcome and return value
            - main [ref=e127]:
                - application [ref=e129]:
                    - generic [ref=e131]:
                        - generic:
                            - generic:
                                - img:
                                    - group "start out to infer" [ref=e132] [cursor=pointer]
                                - img:
                                    - group "infer out to done" [ref=e135] [cursor=pointer]
                            - generic:
                                - group "Trigger Start (start)" [ref=e138]:
                                    - generic [ref=e139]:
                                        - generic [ref=e140]: Trigger
                                        - generic [ref=e145]:
                                            - generic [ref=e146]: Start
                                            - generic [ref=e147]: start
                                            - generic [ref=e149]:
                                                - text: out
                                                - generic "start output out (out)" [ref=e150]
                                - group "Inference Infer (infer)" [ref=e151]:
                                    - generic [ref=e152]:
                                        - generic "infer input" [ref=e153]
                                        - generic [ref=e154]: Inference
                                        - generic [ref=e160]:
                                            - generic [ref=e161]: Infer
                                            - generic [ref=e162]: infer
                                            - generic [ref=e164]:
                                                - text: out
                                                - generic "infer output out (out)" [ref=e165]
                                - group "Exit Done (done)" [ref=e166]:
                                    - generic [ref=e167]:
                                        - generic "done input" [ref=e168]
                                        - generic [ref=e169]: Exit
                                        - generic [ref=e174]:
                                            - generic [ref=e175]: Done
                                            - generic [ref=e176]: done
                    - generic "Control Panel" [ref=e177]:
                        - button "Zoom In" [ref=e178] [cursor=pointer]
                        - button "Zoom Out" [ref=e181] [cursor=pointer]
                        - button "Fit View" [ref=e184] [cursor=pointer]
                        - button "Toggle Interactivity" [ref=e187] [cursor=pointer]
                    - link "React Flow attribution" [ref=e191] [cursor=pointer]:
                        - /url: https://reactflow.dev?utm_source=attribution
                        - text: React Flow
            - complementary [ref=e194]:
                - generic [ref=e195]:
                    - heading "Loop settings" [level=2] [ref=e196]
                    - button "Hide loop settings" [expanded] [ref=e197] [cursor=pointer]
                - region "Loop settings" [ref=e201]:
                    - paragraph [aria-hidden] [ref=e202]: Required fields are marked *
                    - generic [ref=e203]:
                        - generic [ref=e204]:
                            - generic [ref=e205]: Name
                            - generic [aria-hidden] [ref=e206]: '*'
                        - textbox "Name" [ref=e207]: failed catalog picker
                    - generic [ref=e208]:
                        - generic [ref=e209]: Description
                        - textbox "Description" [ref=e210]
                    - heading "Settings" [level=3] [ref=e211]
                    - paragraph [ref=e212]: Maximum node visits is a safety cap against unintended cycles. Use a decision gate's maximum passes for an intentional repeat.
                    - form "Loop settings form" [ref=e213]:
                        - generic [ref=e215]:
                            - group "Working directory" [ref=e216]:
                                - generic [ref=e218]:
                                    - generic [ref=e219]: Kind
                                    - combobox "Kind" [ref=e221] [cursor=pointer]:
                                        - option "fixed"
                                        - option "template"
                                        - option "temp" [selected]
                            - group "Defaults" [ref=e222]:
                                - group "By harness" [ref=e224]:
                                    - paragraph [ref=e226]: Defaults keyed by their harness; omitted fields inherit only within that harness.
                                    - button "Add entry" [ref=e228] [cursor=pointer]
                                    - status [ref=e232]
                            - generic [ref=e233]:
                                - generic [ref=e234]: Maximum node visits
                                - spinbutton "Maximum node visits" [ref=e236]: '10'
                            - generic [ref=e237]:
                                - generic [ref=e238]: Subloop depth limit
                                - spinbutton "Subloop depth limit" [ref=e240]: '8'
                    - generic [ref=e241]:
                        - heading "Variables" [level=3] [ref=e242]
                        - paragraph [ref=e243]: Each variable maps a name to a JSON Schema.
                    - form "Variables form" [ref=e244]:
                        - group "Variables" [ref=e247]:
                            - generic [ref=e248]: Variables *
                            - button "Add entry" [ref=e250] [cursor=pointer]
                            - status [ref=e254]
        - dialog [ref=e255]:
            - banner [ref=e256]:
                - heading "Edit inference infer" [active] [level=2] [ref=e262]:
                    - text: Edit inference
                    - generic [ref=e263]: infer
                - button "Close" [ref=e264] [cursor=pointer]
            - region "Node properties" [ref=e268]:
                - paragraph [aria-hidden] [ref=e269]: Required fields are marked *
                - generic [ref=e270]:
                    - generic [ref=e271]:
                        - generic [ref=e272]:
                            - generic [ref=e273]: Node id
                            - generic [aria-hidden] [ref=e274]: '*'
                        - textbox "Node id" [ref=e275]: infer
                    - generic [ref=e276]:
                        - generic [ref=e277]:
                            - generic [ref=e278]: Label
                            - generic [aria-hidden] [ref=e279]: '*'
                        - textbox "Label" [ref=e280]: Infer
                - group [ref=e282]:
                    - form "infer config" [ref=e283]:
                        - generic [ref=e284]:
                            - tablist "Node configuration" [ref=e285]:
                                - tab "Settings" [selected] [ref=e286] [cursor=pointer]
                                - tab "Context" [ref=e287] [cursor=pointer]
                            - tabpanel "Settings" [ref=e288]:
                                - generic [ref=e289]:
                                    - radiogroup "Harness" [ref=e290]:
                                        - generic [ref=e293]:
                                            - generic [ref=e294]:
                                                - radio "codex" [checked] [ref=e295]
                                                - generic "codex" [ref=e296] [cursor=pointer]
                                            - generic [ref=e298]:
                                                - radio "claude" [ref=e299]
                                                - generic "claude" [ref=e300] [cursor=pointer]
                                    - paragraph [ref=e302]: Harness that runs the session.
                                - group "Session" [ref=e303]:
                                    - generic [ref=e305]:
                                        - generic [ref=e306]: Policy
                                        - combobox "Policy" [ref=e308] [cursor=pointer]:
                                            - option "fresh" [selected]
                                            - option "resume-previous"
                                            - option "resume-named"
                                        - paragraph [ref=e309]: Start fresh, resume the previous session, or resume a named session.
                                - group "Prompt" [ref=e310]:
                                    - paragraph [ref=e312]: Liquid template rendered against the thread.
                                    - generic [ref=e313]:
                                        - generic [ref=e314]:
                                            - generic [ref=e315]:
                                                - generic [ref=e316]: Template
                                                - generic [aria-hidden] [ref=e317]: '*'
                                            - generic [ref=e318]: Liquid
                                        - generic [ref=e319]:
                                            - generic [ref=e322]:
                                                - generic [ref=e324]: '1'
                                                - textbox "Template" [ref=e328]:
                                                    - generic [ref=e329]: picker run
                                            - generic [ref=e330]: 'Preview (sample thread): picker run'
                                            - button "Earlier node outputs (1)" [ref=e332] [cursor=pointer]
                                - generic [ref=e338]:
                                    - radiogroup "Sandbox" [ref=e339]:
                                        - generic [ref=e342]:
                                            - generic [ref=e343]:
                                                - radio "read-only" [ref=e344]
                                                - generic "read-only" [ref=e345] [cursor=pointer]
                                            - generic [ref=e347]:
                                                - radio "workspace-write" [checked] [ref=e348]
                                                - generic "workspace-write" [ref=e349] [cursor=pointer]
                                            - generic [ref=e351]:
                                                - radio "danger-full-access" [ref=e352]
                                                - generic "danger-full-access" [ref=e353] [cursor=pointer]
                                    - paragraph [ref=e355]: Sandbox or tool policy. Claude requires an explicit supported policy and provides no OS/read-path confinement.
                                - button "Advanced 1 set" [ref=e357] [cursor=pointer]:
                                    - generic [ref=e360]:
                                        - generic [ref=e361]: Advanced
                                        - generic [ref=e362]: 1 set
                - region "Connections" [ref=e364]:
                    - heading "Connections" [level=3] [ref=e365]
                    - list [ref=e366]:
                        - listitem [ref=e367]:
                            - generic [ref=e368]:
                                - text: out →
                                - code [ref=e369]: done
                            - button "Remove edge e2" [ref=e370] [cursor=pointer]
            - contentinfo [ref=e373]:
                - button "Delete node" [ref=e374] [cursor=pointer]
                - button "Done" [ref=e378] [cursor=pointer]
```

# Test source

```ts
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
> 185 |   await dialog.getByRole('button', { name: 'Retry model catalog' }).click();
      |                                                                     ^ Error: locator.click: Test timeout of 60000ms exceeded.
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
  239 |                 },
  240 |               ],
  241 |             },
  242 |           }
  243 |         : node,
  244 |     ),
  245 |     edges: [
  246 |       source.edges[0],
  247 |       { id: 'yes', from: { node: 'infer', port: 'yes' }, to: { node: 'done' } },
  248 |       { id: 'no', from: { node: 'infer', port: 'no' }, to: { node: 'done' } },
  249 |     ],
  250 |   });
  251 |   const invalid = await request.post('/loops', {
  252 |     data: {
  253 |       definition: withDecision('max'),
  254 |     },
  255 |   });
  256 |   expect(invalid.status()).toBe(400);
  257 |   const created = await request.post('/loops', { data: { definition: withDecision('high') } });
  258 |   expect(created.status()).toBe(201);
  259 |   const { loop } = (await created.json()) as { loop: { id: string } };
  260 |   await page.goto(`/app/loops/${loop.id}/edit`);
  261 |   const dialog = await openNode(page, 'infer');
  262 |   const evaluation = dialog;
  263 |   const modelGroup = evaluation.getByRole('group', { name: 'Model', exact: true });
  264 |   const effortGroup = evaluation.getByRole('group', { name: 'Effort', exact: true });
  265 |   const model = modelGroup.getByLabel('Value', { exact: true });
  266 |   const effort = effortGroup.getByLabel('Value', { exact: true });
  267 |   await expect(model).toHaveValue('picker-decision');
  268 |   await expect(effort).toHaveValue('high');
  269 |   await closeNode(page);
  270 |   await page.getByRole('button', { name: 'Publish', exact: true }).click();
  271 |   await expect(page.getByText('Published version 1.')).toBeVisible();
  272 |   const read = await request.get(`/loops/${loop.id}`);
  273 |   const stored = (await read.json()) as { current: { definition: unknown } };
  274 |   expect(
  275 |     LoopDefinitionSchema.parse(stored.current.definition).nodes.find((node) => node.id === 'infer')
  276 |       ?.config,
  277 |   ).toMatchObject({
  278 |     kind: 'llm',
  279 |     model: { mode: 'explicit', value: 'picker-decision' },
  280 |     effort: { mode: 'explicit', value: 'high' },
  281 |   });
  282 | });
  283 |
  284 | test('following a model issue keeps focus through a delayed catalog and a failed cached refresh', async ({
  285 |   page,
```
