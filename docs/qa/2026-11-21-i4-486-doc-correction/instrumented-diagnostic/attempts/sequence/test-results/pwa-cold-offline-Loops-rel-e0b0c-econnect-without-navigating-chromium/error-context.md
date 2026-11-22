# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pwa.spec.ts >> cold offline Loops reload recovers on reconnect without navigating
- Location: e2e\pwa.spec.ts:498:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('You are offline', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('You are offline', { exact: true }) with timeout 10000ms
  - waiting for getByText('You are offline', { exact: true })

```

```yaml
- banner:
  - text: GraphGoblin
  - navigation "Main":
    - link "Chat":
      - /url: /app/chat
    - link "Loops":
      - /url: /app/loops
    - link "Runs":
      - /url: /app/runs
    - link "Events":
      - /url: /app/events
    - link "Settings":
      - /url: /app/settings
- status:
  - strong: Cannot reach the GraphGoblin API
  - text: The app keeps working with what it has; saving, running, and live updates resume when the API is reachable again.
- region "Gateway shutdown":
  - heading "Cannot read gateway shutdown state" [level=2]
  - paragraph: Shutdown status is unavailable. Check the connection and system:read permission.
  - button "Check gateway state"
- heading "Loops" [level=1]
- form "Create loop":
  - text: New loop name
  - textbox "New loop name":
    - /placeholder: nightly-triage
  - button "Create" [disabled]
- text: Import an exported loop (JSON)
- button "Import an exported loop (JSON)"
- text: No file chosen
- status:
  - paragraph: Offline
  - text: Loops needs the GraphGoblin API, which cannot be reached right now. The app shell keeps working and unsaved editor drafts are kept on this device.
```

# Test source

```ts
  422 |   const manifest = await page.request.get('/app/manifest.webmanifest');
  423 |   expect(manifest.ok()).toBe(true);
  424 |   const body = (await manifest.json()) as { scope: string; icons: { src: string }[] };
  425 |   expect(body.scope).toBe('/app/');
  426 |   for (const icon of body.icons)
  427 |     expect((await page.request.get(`/app/${icon.src}`)).ok()).toBe(true);
  428 | 
  429 |   let clean: Awaited<ReturnType<typeof context.newPage>> | undefined;
  430 |   try {
  431 |     await ensureControlledPage(page);
  432 |     clean = await context.newPage();
  433 |     await observeUpdateClassification(clean);
  434 |     await clean.goto('/app/loops');
  435 |     await ensureControlledPage(clean);
  436 |     await expect(clean.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
  437 |     await ageWorkboxRegistration(page);
  438 |     await ageWorkboxRegistration(clean);
  439 |     await page.bringToFront();
  440 |     const toast = await showWaitingWorker(page, request);
  441 |     await expectGuardedWorker(page, 'active');
  442 |     // This is the first updatefound in each document, after the >60s clock boundary. Assert the
  443 |     // real Workbox external path ran (native listener removed) before confirming, not a fake event.
  444 |     for (const client of [page, clean]) {
  445 |       await expect
  446 |         .poll(() => client.evaluate(() => ({ ...window.pwaUpdateClassification })))
  447 |         .toEqual({ added: 2, removed: 1, found: 1 });
  448 |     }
  449 |     expect(messages).toHaveLength(0);
  450 |     const navigation: string[] = [];
  451 |     const cleanNavigation: string[] = [];
  452 |     page.on('framenavigated', (frame) => {
  453 |       if (frame === page.mainFrame()) navigation.push(frame.url());
  454 |     });
  455 |     clean.on('framenavigated', (frame) => {
  456 |       if (frame === clean!.mainFrame()) cleanNavigation.push(frame.url());
  457 |     });
  458 |     const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  459 |     const cleanReloaded = clean.waitForEvent(
  460 |       'framenavigated',
  461 |       (frame) => frame === clean!.mainFrame(),
  462 |     );
  463 |     await toast.getByRole('button', { name: 'Update', exact: true }).click();
  464 |     await Promise.all([reloaded, cleanReloaded]);
  465 |     await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
  466 |     await expect(clean.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
  467 |     await expect(toast).toBeHidden();
  468 |     await expect
  469 |       .poll(() =>
  470 |         page.evaluate(
  471 |           async () => (await navigator.serviceWorker.getRegistration('/app/'))?.waiting === null,
  472 |         ),
  473 |       )
  474 |       .toBe(true);
  475 |     await expect.poll(() => messages.length).toBe(1);
  476 |     expectGuardedApply(messages, page);
  477 |     expect(navigation).toHaveLength(1);
  478 |     expect(cleanNavigation).toHaveLength(1);
  479 |     await expectGuardedWorker(clean, 'active');
  480 |     await expect
  481 |       .poll(() =>
  482 |         page.evaluate(async () => {
  483 |           const name = `graphgoblin-chat-update-v1:${new URL('/app/', location.origin).href}`;
  484 |           return (
  485 |             (await navigator.locks.query()).held?.filter(
  486 |               (lock) => lock.name === name && lock.mode === 'shared',
  487 |             ).length ?? 0
  488 |           );
  489 |         }),
  490 |       )
  491 |       .toBe(2);
  492 |   } finally {
  493 |     if (clean && !clean.isClosed()) await clean.close();
  494 |     await control(request, '/worker/reset');
  495 |   }
  496 | });
  497 | 
  498 | test('cold offline Loops reload recovers on reconnect without navigating', async ({
  499 |   page,
  500 |   context,
  501 |   request,
  502 | }) => {
  503 |   const name = `cold offline reconnect ${test.info().repeatEachIndex}-${test.info().retry}`;
  504 |   await publishLoop(request, approvalLoop(name));
  505 |   await page.goto('/app/loops');
  506 |   const row = page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
  507 |   await expect(row).toBeVisible();
  508 |   await page.evaluate(async () => {
  509 |     await navigator.serviceWorker.ready;
  510 |   });
  511 |   // The worker deliberately does not claim existing clients; the next navigation uses it.
  512 |   await page.reload();
  513 |   await expect
  514 |     .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
  515 |     .toBe(true);
  516 | 
  517 |   await context.setOffline(true);
  518 |   try {
  519 |     await page.reload();
  520 |     const offline = page.getByText(/Loops needs the GraphGoblin API/);
  521 |     await expect(offline).toBeVisible();
> 522 |     await expect(page.getByText('You are offline', { exact: true })).toBeVisible();
      |                                                                      ^ Error: expect(locator).toBeVisible() failed
  523 |     await expect(row).toBeHidden();
  524 | 
  525 |     const recovered = page.waitForResponse(
  526 |       (response) => new URL(response.url()).pathname === '/loops' && response.status() === 200,
  527 |       { timeout: 5_000 },
  528 |     );
  529 |     await context.setOffline(false);
  530 |     await recovered;
  531 |     await expect(row).toBeVisible({ timeout: 5_000 });
  532 |     await expect(offline).toBeHidden();
  533 |     await expect(page.getByText('You are offline', { exact: true })).toBeHidden();
  534 |     await expect(page).toHaveURL(/\/app\/loops$/);
  535 |   } finally {
  536 |     await context.setOffline(false);
  537 |   }
  538 | });
  539 | 
  540 | test('another tab’s unresolved voice upload vetoes update activation until that tab closes', async ({
  541 |   page,
  542 |   context,
  543 |   request,
  544 | }) => {
  545 |   const messages = await observeUpdateMessages(page);
  546 |   await page.goto('/app/loops');
  547 |   await ensureControlledPage(page);
  548 |   await expectGuardedWorker(page, 'active');
  549 |   const dirty = await context.newPage();
  550 |   // Exercise production session restoration on a non-chat route. No application hook or audio
  551 |   // payload is installed: this is the persisted identity of an unresolved frozen voice upload.
  552 |   await dirty.addInitScript(() => {
  553 |     sessionStorage.setItem(
  554 |       'graphgoblin.owner.chat.v1.voice-upload',
  555 |       JSON.stringify({
  556 |         uploadId: '018e9c20-7b33-4a9f-9036-2e2fcf5a1a23',
  557 |         sha256: 'a'.repeat(64),
  558 |         caption: '',
  559 |       }),
  560 |     );
  561 |   });
  562 |   try {
  563 |     await dirty.goto('/app/loops');
  564 |     await expect(dirty.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
  565 |     await ensureControlledPage(dirty);
  566 |     await page.bringToFront();
  567 |     const toast = await showWaitingWorker(page, request);
  568 |     const initial = await page.evaluateHandle(async () => {
  569 |       const registration = await navigator.serviceWorker.getRegistration('/app/');
  570 |       if (!registration?.active || !registration.waiting) throw new Error('missing update pair');
  571 |       return {
  572 |         active: registration.active,
  573 |         waiting: registration.waiting,
  574 |         controller: navigator.serviceWorker.controller,
  575 |         document: performance.timeOrigin,
  576 |       };
  577 |     });
  578 |     const navigation: string[] = [];
  579 |     page.on('framenavigated', (frame) => {
  580 |       if (frame === page.mainFrame()) navigation.push(frame.url());
  581 |     });
  582 |     const sharedLeases = () =>
  583 |       page.evaluate(async () => {
  584 |         const name = `graphgoblin-chat-update-v1:${new URL('/app/', location.origin).href}`;
  585 |         return (
  586 |           (await navigator.locks.query()).held?.filter(
  587 |             (lock) => lock.name === name && lock.mode === 'shared',
  588 |           ).length ?? 0
  589 |         );
  590 |       });
  591 |     await expect.poll(sharedLeases).toBe(2);
  592 |     expect(messages).toHaveLength(0);
  593 |     await toast.getByRole('button', { name: 'Update', exact: true }).click();
  594 |     await expect(
  595 |       toast.getByText(
  596 |         'Finish or discard voice drafts and resolve pending messages in all open tabs before updating.',
  597 |         { exact: true },
  598 |       ),
  599 |     ).toBeVisible();
  600 |     await expect(toast.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  601 |     expectGuardedApply(messages, page);
  602 |     // Crossing the worker acknowledgement deadline must never expire a live dirty tab as safe.
  603 |     await page.waitForTimeout(2_100);
  604 |     expect(
  605 |       await page.evaluate(async (initial) => {
  606 |         const registration = await navigator.serviceWorker.getRegistration('/app/');
  607 |         return (
  608 |           registration?.active === initial.active &&
  609 |           registration.waiting === initial.waiting &&
  610 |           navigator.serviceWorker.controller === initial.controller &&
  611 |           performance.timeOrigin === initial.document
  612 |         );
  613 |       }, initial),
  614 |     ).toBe(true);
  615 |     expect(navigation).toHaveLength(0);
  616 |     await expect.poll(sharedLeases).toBe(2);
  617 |     await initial.dispose();
  618 |     await dirty.close();
  619 |     await expect.poll(sharedLeases).toBe(1);
  620 |     const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  621 |     await toast.getByRole('button', { name: 'Update', exact: true }).click();
  622 |     await reloaded;
```