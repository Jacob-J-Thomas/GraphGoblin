# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: claude-harness.spec.ts >> saved Codex model stays labelled on narrow Claude editor with readiness true
- Location: e2e\claude-harness.spec.ts:258:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('dialog').getByLabel('Model', { exact: true })
    - locator resolved to <select id="_r_1u_" aria-describedby="_r_1u_-help _r_1i_-model-catalog" class="rounded-md border border-strong transition-[border-color,box-shadow] hover:border-field-hover bg-surface-field aria-invalid:border-status-bad-border w-full min-w-0 px-3 text-md text-default placeholder:text-subtle focus-visible:border-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-default disabled:bg-surface-sunken disabled:text-su…>…</select>
  - attempting select option action
    2 × waiting for element to be visible and enabled
      - element is not visible
    - retrying select option action
    - waiting 20ms
    2 × waiting for element to be visible and enabled
      - element is not visible
    - retrying select option action
      - waiting 100ms
    117 × waiting for element to be visible and enabled
        - element is not visible
      - retrying select option action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e3]:
    - banner [ref=e4]:
        - generic [ref=e5]: GraphGoblin
        - button "Menu" [ref=e22] [cursor=pointer]
    - generic [ref=e25]:
        - banner [ref=e26]:
            - link "Loops" [ref=e27] [cursor=pointer]:
                - /url: /app/loops
            - generic [ref=e28]: /
            - heading "Retained model" [level=1] [ref=e29]
            - generic [ref=e30]: draft only
            - generic "invalid evaluator or model configuration (EVALUATION_INVALID_CONFIGURATION)" [ref=e32]: Save failed
            - generic [ref=e35]:
                - button "Undo edit config of infer" [ref=e36] [cursor=pointer]
                - button "Redo" [disabled] [ref=e40]
                - link "Open in Runs" [disabled] [ref=e44]
                - generic [ref=e47]: 'Publish the loop first: runs start from a published version.'
                - generic [ref=e48]: Ready to publish
                - button "Publish" [ref=e52] [cursor=pointer]
        - status [ref=e57]:
            - generic [ref=e61]: invalid evaluator or model configuration (EVALUATION_INVALID_CONFIGURATION)
            - button "Dismiss notice" [ref=e62] [cursor=pointer]
        - generic [ref=e66]:
            - complementary "Palette" [ref=e67]:
                - button "Show palette" [ref=e68] [cursor=pointer]
                - generic [ref=e73]:
                    - button "Add Trigger node" [ref=e74]
                    - button "Add Decision node" [ref=e78]
                    - button "Add Inference node" [ref=e83]
                    - button "Add Script node" [ref=e88]
                    - button "Add Mutate node" [ref=e92]
                    - button "Add Subloop node" [ref=e97]
                    - button "Add Wait node" [ref=e102]
                    - button "Add Heartbeat node" [ref=e106]
                    - button "Add Exit node" [ref=e110]
            - main [ref=e114]:
                - application [ref=e116]:
                    - generic [ref=e118]:
                        - generic:
                            - generic:
                                - img:
                                    - group "start out to infer" [ref=e119] [cursor=pointer]
                                - img:
                                    - group "infer out to done" [ref=e122] [cursor=pointer]
                            - generic:
                                - group "Trigger Start (start)" [ref=e125]:
                                    - generic [ref=e126]:
                                        - generic [ref=e127]: Trigger
                                        - generic [ref=e132]:
                                            - generic [ref=e133]: Start
                                            - generic [ref=e134]: start
                                            - generic [ref=e136]:
                                                - text: out
                                                - generic "start output out (out)" [ref=e137]
                                - group "Inference Infer (infer)" [ref=e138]:
                                    - generic [ref=e139]:
                                        - generic "infer input" [ref=e140]
                                        - generic [ref=e141]: Inference
                                        - generic [ref=e147]:
                                            - generic [ref=e148]: Infer
                                            - generic [ref=e149]: infer
                                            - generic [ref=e151]:
                                                - text: out
                                                - generic "infer output out (out)" [ref=e152]
                                - group "Exit Done (done)" [ref=e153]:
                                    - generic [ref=e154]:
                                        - generic "done input" [ref=e155]
                                        - generic [ref=e156]: Exit
                                        - generic [ref=e161]:
                                            - generic [ref=e162]: Done
                                            - generic [ref=e163]: done
                    - generic "Control Panel" [ref=e164]:
                        - button "Zoom In" [ref=e165] [cursor=pointer]
                        - button "Zoom Out" [ref=e168] [cursor=pointer]
                        - button "Fit View" [ref=e171] [cursor=pointer]
                        - button "Toggle Interactivity" [ref=e174] [cursor=pointer]
                    - link "React Flow attribution" [ref=e178] [cursor=pointer]:
                        - /url: https://reactflow.dev?utm_source=attribution
                        - text: React Flow
            - complementary "Loop settings" [ref=e181]:
                - button "Show loop settings" [ref=e182] [cursor=pointer]
        - dialog [ref=e189]:
            - banner [ref=e190]:
                - heading "Edit inference infer" [level=2] [ref=e196]:
                    - text: Edit inference
                    - generic [ref=e197]: infer
                - button "Close" [ref=e198] [cursor=pointer]
            - region "Node properties" [ref=e202]:
                - paragraph [aria-hidden] [ref=e203]: Required fields are marked *
                - generic [ref=e204]:
                    - generic [ref=e205]:
                        - generic [ref=e206]:
                            - generic [ref=e207]: Node id
                            - generic [aria-hidden] [ref=e208]: '*'
                        - textbox "Node id" [ref=e209]: infer
                    - generic [ref=e210]:
                        - generic [ref=e211]:
                            - generic [ref=e212]: Label
                            - generic [aria-hidden] [ref=e213]: '*'
                        - textbox "Label" [ref=e214]: Infer
                - group [ref=e216]:
                    - form "infer config" [ref=e217]:
                        - generic [ref=e218]:
                            - tablist "Node configuration" [ref=e219]:
                                - tab "Settings" [selected] [ref=e220] [cursor=pointer]
                                - tab "Context" [ref=e221] [cursor=pointer]
                            - tabpanel "Settings" [ref=e222]:
                                - generic [ref=e223]:
                                    - radiogroup "Harness" [ref=e224]:
                                        - generic [ref=e227]:
                                            - generic [ref=e228]:
                                                - radio "codex" [ref=e229]
                                                - generic "codex" [ref=e230] [cursor=pointer]
                                            - generic [ref=e232]:
                                                - radio "claude" [checked] [active] [ref=e233]
                                                - generic "claude" [ref=e234] [cursor=pointer]
                                    - paragraph [ref=e236]: Harness that runs the session.
                                - group "Session" [ref=e237]:
                                    - generic [ref=e239]:
                                        - generic [ref=e240]: Policy
                                        - combobox "Policy" [ref=e242] [cursor=pointer]:
                                            - option "fresh" [selected]
                                            - option "resume-previous"
                                            - option "resume-named"
                                        - paragraph [ref=e243]: Start fresh, resume the previous session, or resume a named session.
                                - group "Prompt" [ref=e244]:
                                    - paragraph [ref=e246]: Liquid template rendered against the thread.
                                    - generic [ref=e247]:
                                        - generic [ref=e248]:
                                            - generic [ref=e249]:
                                                - generic [ref=e250]: Template
                                                - generic [aria-hidden] [ref=e251]: '*'
                                            - generic [ref=e252]: Liquid
                                        - generic [ref=e253]:
                                            - generic [ref=e256]:
                                                - generic [ref=e258]: '1'
                                                - textbox "Template" [ref=e262]:
                                                    - generic [ref=e263]: Return the synthetic Claude E2E result.
                                            - generic [ref=e264]: 'Preview (sample thread): Return the synthetic Claude E2E result.'
                                            - button "Earlier node outputs (1)" [ref=e266] [cursor=pointer]
                                - generic [ref=e272]:
                                    - generic [ref=e273]: Sandbox and approval policy
                                    - combobox "Sandbox and approval policy" [ref=e275] [cursor=pointer]:
                                        - option "Read-only — built-in tools only; no OS or read-path isolation" [selected]
                                        - option "Danger full access — command execution and network unconfined"
                                    - paragraph [ref=e276]: Read-only restricts built-in tools but provides no filesystem or OS confinement. Danger full access leaves command execution and network unconfined.
                                - button "Advanced 2 set" [ref=e278] [cursor=pointer]:
                                    - generic [ref=e281]:
                                        - generic [ref=e282]: Advanced
                                        - generic [ref=e283]: 2 set
                - region "Connections" [ref=e285]:
                    - heading "Connections" [level=3] [ref=e286]
                    - list [ref=e287]:
                        - listitem [ref=e288]:
                            - generic [ref=e289]:
                                - text: out →
                                - code [ref=e290]: done
                            - button "Remove edge e2" [ref=e291] [cursor=pointer]
            - contentinfo [ref=e294]:
                - button "Delete node" [ref=e295] [cursor=pointer]
                - button "Done" [ref=e299] [cursor=pointer]
```

# Test source

```ts
  207 |     await page.reload();
  208 |     const reopened = await openNode(page, 'infer');
  209 |     await openAdvanced(reopened);
  210 |     await expect(reopened.getByLabel('Model', { exact: true })).toHaveValue(model);
  211 |     await expect(reopened.getByLabel('Effort', { exact: true })).toHaveValue(effort);
  212 |     await reopened.getByRole('button', { name: 'Done' }).click();
  213 |
  214 |     await control(request, '/harness/script', {
  215 |       instanceId: instance.id,
  216 |       harness: 'claude',
  217 |       turns: [{ finalText: 'Synthetic Claude result.' }],
  218 |     });
  219 |     const started = await request.post(instance.url + '/loops/' + loop.id + '/runs', {
  220 |       data: { input: null },
  221 |     });
  222 |     expect(started.status()).toBe(202);
  223 |     const { run } = (await started.json()) as { run: { id: string } };
  224 |     await waitForTerminal(request, instance.url, run.id, 'succeeded');
  225 |     expect(
  226 |       await control(request, '/harness/requests', { instanceId: instance.id, harness: 'claude' }),
  227 |     ).toMatchObject({
  228 |       started: [
  229 |         {
  230 |           harness: 'claude',
  231 |           model,
  232 |           effort,
  233 |           options: { sandbox: 'read-only', approval: 'never' },
  234 |         },
  235 |       ],
  236 |     });
  237 |
  238 |     // An unsupported effort for this model is refused at authoring and never reaches the adapter.
  239 |     const unsupported = inferenceLoop(displayName + ' unsupported', 'claude');
  240 |     const node = unsupported.nodes.find((item) => item.id === 'infer');
  241 |     if (!node || !('config' in node)) throw new Error('missing inference node');
  242 |     Object.assign(node.config, { model, effort: 'minimal' });
  243 |     for (const [method, url] of [
  244 |       ['post', instance.url + '/loops'],
  245 |       ['put', instance.url + '/loops/' + loop.id + '/draft'],
  246 |     ] as const) {
  247 |       const refused = await request[method](url, { data: { definition: unsupported } });
  248 |       expect(refused.status()).toBe(400);
  249 |       expect(await refused.text()).toContain('EFFORT_UNSUPPORTED');
  250 |     }
  251 |     expect(
  252 |       await control(request, '/harness/requests', { instanceId: instance.id, harness: 'claude' }),
  253 |     ).toMatchObject({ started: [{ model, effort }] });
  254 |   });
  255 | }
  256 |
  257 | for (const ready of [false, true]) {
  258 |   test(`saved Codex model stays labelled on narrow Claude editor with readiness ${ready}`, async ({
  259 |     page,
  260 |     request,
  261 |   }) => {
  262 |     const instance = await claudeInstance(request);
  263 |     if (!ready)
  264 |       await control(request, '/harness/preflight', {
  265 |         instanceId: instance.id,
  266 |         harness: 'claude',
  267 |         state: 'not-ready',
  268 |       });
  269 |     const definition = inferenceLoop('Retained model');
  270 |     const node = definition.nodes.find((item) => item.id === 'infer');
  271 |     if (!node || !('config' in node)) throw new Error('missing inference node');
  272 |     Object.assign(node.config, {
  273 |       model: 'gpt-6-astra',
  274 |       effort: 'high',
  275 |       harnessOptions: { sandbox: 'workspace-write', approval: 'never' },
  276 |     });
  277 |     const created = await request.post(instance.url + '/loops', { data: { definition } });
  278 |     expect(created.status(), await created.text()).toBe(201);
  279 |     const { loop } = (await created.json()) as { loop: { id: string } };
  280 |     await page.setViewportSize({ width: 390, height: 844 });
  281 |     await page.goto(instance.url + '/app/loops/' + loop.id + '/edit');
  282 |     const dialog = await openNode(page, 'infer');
  283 |     const harness = dialog.getByRole('radio', { name: 'claude', exact: true });
  284 |     await harness.focus();
  285 |     await page.keyboard.press('Space');
  286 |     await expect(harness).toBeChecked();
  287 |     await expect(harness).toBeFocused();
  288 |     const model = dialog.getByLabel('Model', { exact: true });
  289 |     await expect(model).toHaveValue('gpt-6-astra');
  290 |     await expect(model.locator('option:checked')).toHaveText(/Saved model belongs to Codex/);
  291 |     await expect(model.locator('option:checked')).toBeDisabled();
  292 |     if (!ready) {
  293 |       await expect(model).toHaveAttribute('aria-readonly', 'true');
  294 |       await expect(
  295 |         dialog
  296 |           .getByRole('status')
  297 |           .filter({ hasText: 'Claude CLI preflight is not ready; model choices' }),
  298 |       ).toBeVisible();
  299 |       await control(request, '/harness/preflight', {
  300 |         instanceId: instance.id,
  301 |         harness: 'claude',
  302 |         state: 'ready',
  303 |       });
  304 |       await dialog.getByRole('button', { name: 'Retry Claude preflight' }).click();
  305 |     }
  306 |     await expect(model).not.toHaveAttribute('aria-readonly', 'true');
> 307 |     await model.selectOption('claude-fable-5-1');
      |                 ^ Error: locator.selectOption: Test timeout of 60000ms exceeded.
  308 |     await expect(model).toHaveValue('claude-fable-5-1');
  309 |     await expect(dialog.getByLabel('Sandbox and approval policy', { exact: true })).toHaveValue(
  310 |       '0',
  311 |     );
  312 |     expect(
  313 |       await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  314 |     ).toBe(true);
  315 |   });
  316 | }
  317 |
  318 | test('Settings separates Claude adapter support from CLI readiness and supports Fable', async ({
  319 |   page,
  320 |   request,
  321 | }) => {
  322 |   const instance = await claudeInstance(request);
  323 |   const controlUrl = String(process.env['GG_E2E_CONTROL_URL']);
  324 |   const preflightControl = await request.post(controlUrl + '/harness/preflight', {
  325 |     data: { instanceId: instance.id, harness: 'claude', state: 'not-ready' },
  326 |   });
  327 |   expect(preflightControl.status(), await preflightControl.text()).toBe(200);
  328 |
  329 |   const unknown = await request.post(controlUrl + '/harness/requests', {
  330 |     data: { instanceId: 'not-an-e2e-instance', harness: 'claude' },
  331 |   });
  332 |   expect(unknown.status()).toBe(400);
  333 |   expect(await unknown.json()).toMatchObject({
  334 |     error: expect.stringContaining('unknown E2E instance'),
  335 |   });
  336 |   const wrongFamily = await request.post(controlUrl + '/harness/requests', {
  337 |     data: { instanceId: instance.id, harness: 'future-harness' },
  338 |   });
  339 |   expect(wrongFamily.status()).toBe(400);
  340 |   expect(await wrongFamily.json()).toMatchObject({
  341 |     error: expect.stringContaining('unknown E2E harness'),
  342 |   });
  343 |
  344 |   const preflightResponse = await request.get(instance.url + '/harness/preflight');
  345 |   expect(preflightResponse.status(), await preflightResponse.text()).toBe(200);
  346 |
  347 |   await page.goto(instance.url + '/app/settings');
  348 |   const preflight = page.getByRole('region', { name: 'Harness preflight' });
  349 |   const claudeStatus = preflight.getByRole('listitem').filter({ hasText: 'claude' });
  350 |   await expect(claudeStatus.getByText('not ready', { exact: true })).toBeVisible();
  351 |   await expect(claudeStatus.getByText('Claude CLI is not signed in.')).toBeVisible();
  352 |
  353 |   const support = claudeStatus.getByRole('list', { name: 'Claude model support' });
  354 |   const catalog = page.getByRole('region', { name: 'Model catalog' });
  355 |   for (const [model, displayName] of [
  356 |     ['claude-opus-5-5', 'Claude Opus 5.5'],
  357 |     ['claude-fable-5-1', 'Claude Fable 5.1'],
  358 |     ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  359 |     ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  360 |   ] as const) {
  361 |     const row = support.getByRole('listitem').filter({ hasText: model });
  362 |     await expect(row.getByText('supported by adapter')).toBeVisible();
  363 |     await expect(catalog.getByRole('switch', { name: 'Enable ' + displayName })).toBeChecked();
  364 |   }
  365 |   await expect(catalog.getByText(/Enabled in catalog; Claude harness not ready/)).toHaveCount(4);
  366 |
  367 |   const model = page.getByLabel('Default model (claude)', { exact: true });
  368 |   await expect(model).toBeVisible();
  369 |   await expect(model.getByRole('option', { name: /Claude Opus 5\.5/ })).toHaveCount(0);
  370 |   await expect(model.getByRole('option', { name: /Fable/ })).toHaveCount(0);
  371 | });
  372 |
  373 | test('Claude settings stay pending through refresh and preserve the Codex defaults', async ({
  374 |   page,
  375 |   request,
  376 | }) => {
  377 |   const instance = await claudeInstance(request);
  378 |   let holdNextGet = false;
  379 |   let release!: () => void;
  380 |   let announceHeld!: () => void;
  381 |   const held = new Promise<void>((resolve) => {
  382 |     release = resolve;
  383 |   });
  384 |   const heldRequest = new Promise<void>((resolve) => {
  385 |     announceHeld = resolve;
  386 |   });
  387 |   await page.route(instance.url + '/settings', async (route) => {
  388 |     if (route.request().method() === 'GET' && holdNextGet) {
  389 |       holdNextGet = false;
  390 |       announceHeld();
  391 |       await held;
  392 |     }
  393 |     await route.continue();
  394 |   });
  395 |
  396 |   try {
  397 |     await page.goto(instance.url + '/app/settings');
  398 |     const claudeModel = page.getByLabel('Default model (claude)', { exact: true });
  399 |     const codexEffort = page.getByLabel('Default effort', { exact: true });
  400 |     await expect(claudeModel).toBeVisible();
  401 |     await expect(codexEffort).toBeVisible();
  402 |
  403 |     holdNextGet = true;
  404 |     const saveClaude = page.waitForResponse(
  405 |       (response) =>
  406 |         response.request().method() === 'PUT' && response.url() === instance.url + '/settings',
  407 |     );
```
