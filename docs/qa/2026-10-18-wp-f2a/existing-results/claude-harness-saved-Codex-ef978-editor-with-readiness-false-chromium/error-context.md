# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: claude-harness.spec.ts >> saved Codex model stays labelled on narrow Claude editor with readiness false
- Location: e2e\claude-harness.spec.ts:258:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog').getByRole('status').filter({ hasText: 'Claude CLI preflight is not ready; model choices' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog').getByRole('status').filter({ hasText: 'Claude CLI preflight is not ready; model choices' }) with timeout 10000ms
  - waiting for getByRole('dialog').getByRole('status').filter({ hasText: 'Claude CLI preflight is not ready; model choices' })

```

```yaml
- banner:
    - text: GraphGoblin
    - button "Menu"
- banner:
    - link "Loops":
        - /url: /app/loops
    - text: /
    - heading "Retained model" [level=1]
    - text: draft only Save failed
    - button "Undo edit config of infer"
    - button "Redo" [disabled]
    - link "Open in Runs" [disabled]
    - text: 'Publish the loop first: runs start from a published version. Ready to publish'
    - button "Publish"
- status:
    - text: invalid evaluator or model configuration (EVALUATION_INVALID_CONFIGURATION)
    - button "Dismiss notice"
- complementary "Palette":
    - button "Show palette"
    - button "Add Trigger node"
    - button "Add Decision node"
    - button "Add Inference node"
    - button "Add Script node"
    - button "Add Mutate node"
    - button "Add Subloop node"
    - button "Add Wait node"
    - button "Add Heartbeat node"
    - button "Add Exit node"
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
    - button "Show loop settings"
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
                        - radio "codex"
                        - text: codex
                        - radio "claude" [checked]
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
                        - text: 'Preview (sample thread): Return the synthetic Claude E2E result.'
                        - button "Earlier node outputs (1)"
                    - text: Sandbox and approval policy
                    - combobox "Sandbox and approval policy":
                        - 'option "Current policy: read-only / never (saved; not verified)" [disabled] [selected]'
                    - paragraph: Read-only restricts built-in tools but provides no filesystem or OS confinement. Danger full access leaves command execution and network unconfined.
                    - status: Claude CLI preflight is not ready. The saved policy is unchanged.
                    - button "Advanced 2 set"
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
  198 |     await expect(page.getByText('Published version 1.')).toBeVisible();
  199 |
  200 |     const saved = await request.get(instance.url + '/loops/' + loop.id);
  201 |     const current = (await saved.json()) as { current: { definition: unknown } };
  202 |     const authored = LoopDefinitionSchema.parse(current.current.definition).nodes.find(
  203 |       (node) => node.id === 'infer',
  204 |     );
  205 |     expect(authored?.config).toMatchObject({ harness: 'claude', model, effort });
  206 |
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
> 298 |       ).toBeVisible();
      |         ^ Error: expect(locator).toBeVisible() failed
  299 |       await control(request, '/harness/preflight', {
  300 |         instanceId: instance.id,
  301 |         harness: 'claude',
  302 |         state: 'ready',
  303 |       });
  304 |       await dialog.getByRole('button', { name: 'Retry Claude preflight' }).click();
  305 |     }
  306 |     await expect(model).not.toHaveAttribute('aria-readonly', 'true');
  307 |     await model.selectOption('claude-fable-5-1');
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
```
