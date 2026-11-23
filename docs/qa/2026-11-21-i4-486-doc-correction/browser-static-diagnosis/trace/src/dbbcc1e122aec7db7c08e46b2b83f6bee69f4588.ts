import {
  ageWorkboxRegistration,
  ensureControlledPage,
  expectGuardedApply,
  expectGuardedWorker,
  observeUpdateMessages,
  observeUpdateClassification,
  showWaitingWorker,
  workerCapability,
} from './pwa-helpers.js';
import { approvalLoop, control, expect, publishLoop, showLoopPanel, test } from './fixtures.js';

declare global {
  interface Window {
    pwaChecks: {
      calls: number;
      found: number;
      pending: number;
      activity: number;
      pageShown: boolean;
    };
  }
}

for (const [index, screen] of ['Loops', 'Runs', 'Events', 'Settings', 'run inspector'].entries()) {
  test(`${screen} recovers after the API listener restarts with the browser online`, async ({
    page,
    request,
  }) => {
    const name = `API recovery ${index}`;
    const loopId = await publishLoop(request, approvalLoop(name));
    const started = await request.post(`/loops/${loopId}/runs`, {
      data: { triggerNodeId: 'start', input: {} },
    });
    expect(started.ok()).toBe(true);
    const { run } = (await started.json()) as { run: { id: string } };
    const path =
      screen === 'run inspector' ? `/app/runs/${run.id}` : `/app/${screen.toLowerCase()}`;
    const endpoint =
      screen === 'run inspector'
        ? `/runs/${run.id}`
        : screen === 'Settings'
          ? '/settings'
          : `/${screen.toLowerCase()}`;
    await page.goto(path);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    await control(request, '/api/listener', { listening: false });
    try {
      // The shell comes from the worker, but API requests now see a genuinely refused socket.
      await page.reload();
      const offline = page.getByText(/needs the GraphGoblin API, which cannot be reached/);
      await expect(offline.first()).toBeVisible();
      await expect(
        page.getByText('Cannot reach the GraphGoblin API', { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      const back = page.waitForResponse(
        (response) => new URL(response.url()).pathname === endpoint && response.status() === 200,
        { timeout: 6_000 },
      );
      const start = Date.now();
      await control(request, '/api/listener', { listening: true });
      await back;
      expect(Date.now() - start).toBeLessThan(6_000);
      await expect(offline).toHaveCount(0);
      await expect(
        page.getByText('Cannot reach the GraphGoblin API', { exact: true }),
      ).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    } finally {
      await control(request, '/api/listener', { listening: true });
    }
  });
}

test('a loaded run inspector reports a stream outage and resumes without navigation', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, approvalLoop('Loaded stream recovery'));
  const response = await request.post(`/loops/${loopId}/runs`, {
    data: { triggerNodeId: 'start', input: {} },
  });
  expect(response.ok()).toBe(true);
  const { run } = (await response.json()) as { run: { id: string } };
  await page.goto(`/app/runs/${run.id}`);
  const live = page.getByRole('heading', { name: /Timeline .* live\)/ });
  await expect(live).toBeVisible();
  await page.waitForTimeout(1_000); // The initial event batch's reads settle before the socket drops.
  const navigation: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigation.push(frame.url());
  });
  await control(request, '/api/listener', { listening: false });
  try {
    const banner = page.getByText('Cannot reach the GraphGoblin API', { exact: true });
    await expect(banner).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    const resumed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/runs/${run.id}/events` && response.status() === 200,
      { timeout: 6_000 },
    );
    await control(request, '/api/listener', { listening: true });
    await resumed;
    await expect(live).toBeVisible({ timeout: 6_000 });
    await expect(banner).toBeHidden();
    expect(navigation).toHaveLength(0);
  } finally {
    await control(request, '/api/listener', { listening: true });
  }
});

test('an offline editor draft saves after the API listener returns without navigation', async ({
  page,
  request,
}) => {
  const name = 'API draft recovery';
  const loopId = await publishLoop(request, approvalLoop(name));
  const loaded = (await (await request.get(`/loops/${loopId}`)).json()) as { draftToken: string };
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await showLoopPanel(page);
  const navigation: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigation.push(frame.url());
  });
  await control(request, '/api/listener', { listening: false });
  try {
    await page.getByLabel('Description').fill('draft kept through an API outage');
    await expect(page.getByTestId('save-state')).toHaveText('Offline: saved on this device');
    await expect(page.getByLabel('Description')).toHaveValue('draft kept through an API outage');
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/loops/${loopId}/draft` &&
        response.request().method() === 'PUT' &&
        response.status() === 200,
      { timeout: 6_000 },
    );
    await control(request, '/api/listener', { listening: true });
    const response = await saved;
    expect(response.request().headers()['if-match']).toBe(`"${loaded.draftToken}"`);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved', {
      timeout: 6_000,
    });
    await expect(page.getByLabel('Description')).toHaveValue('draft kept through an API outage');
    const server = (await (await request.get(`/loops/${loopId}`)).json()) as {
      draft: { definition: { description: string } };
    };
    expect(server.draft.definition.description).toBe('draft kept through an API outage');
    expect(navigation).toHaveLength(0);
  } finally {
    await control(request, '/api/listener', { listening: true });
  }
});

test('clean event-stream closes retain backoff without refetch or worker-update churn', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, approvalLoop('Clean stream backoff'));
  const response = await request.post(`/loops/${loopId}/runs`, {
    data: { triggerNodeId: 'start', input: {} },
  });
  expect(response.ok()).toBe(true);
  const { run } = (await response.json()) as { run: { id: string } };
  await page.addInitScript(() => {
    const stats = (window.pwaChecks = {
      calls: 0,
      found: 0,
      pending: 0,
      activity: Date.now(),
      pageShown: false,
    });
    const update = ServiceWorkerRegistration.prototype.update;
    ServiceWorkerRegistration.prototype.update = function () {
      stats.calls++;
      return update.call(this);
    };
  });
  let streams = 0;
  let reads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/runs/${run.id}`) reads++;
  });
  await page.route(`**/runs/${run.id}/events**`, async (route) => {
    streams++;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });
  await page.goto(`/app/runs/${run.id}`);
  await expect(page.getByRole('heading', { name: /^Timeline/ })).toBeVisible();
  const baselineStreams = streams;
  const baselineReads = reads;
  const baselineUpdates = await page.evaluate(() => window.pwaChecks.calls);
  await page.waitForTimeout(4_000);
  expect(streams).toBeGreaterThanOrEqual(2);
  expect(streams - baselineStreams).toBeLessThanOrEqual(4);
  expect(reads - baselineReads).toBeLessThanOrEqual(1);
  expect((await page.evaluate(() => window.pwaChecks.calls)) - baselineUpdates).toBeLessThanOrEqual(
    1,
  );
  await expect(page.getByText('Cannot reach the GraphGoblin API', { exact: true })).toBeHidden();
});

test('an open window detects a changed worker on focus, prompts, and updates only on confirmation', async ({
  page,
  request,
}) => {
  test.setTimeout(100_000);
  const messages = await observeUpdateMessages(page);
  page.on('console', (message) => {
    const content = message.text();
    if (content.startsWith('PWA lifecycle:')) console.log(content);
  });
  await page.addInitScript(() => {
    const stats: Window['pwaChecks'] = (window.pwaChecks = {
      calls: 0,
      found: 0,
      pending: 0,
      activity: Date.now(),
      pageShown: false,
    });
    const record = (kind: string, event?: Event) =>
      console.log(
        'PWA lifecycle:' +
          JSON.stringify({
            kind,
            at: Date.now(),
            documentId: performance.timeOrigin,
            ...stats,
            visibility: document.visibilityState,
            focused: document.hasFocus(),
            trusted: event?.isTrusted ?? null,
          }),
      );
    window.addEventListener('pageshow', (event) => {
      stats.pageShown = event.isTrusted;
      record('pageshow', event);
    });
    window.addEventListener('focus', (event) => record('focus', event));
    window.addEventListener('pagehide', (event) => record('pagehide', event));
    document.addEventListener('visibilitychange', (event) => record('visibilitychange', event));
    record('document-created');
    const watched = new WeakSet<ServiceWorkerRegistration>();
    const watch = (registration: ServiceWorkerRegistration) => {
      if (!watched.has(registration)) {
        watched.add(registration);
        registration.addEventListener('updatefound', () => {
          stats.found++;
          stats.activity = Date.now();
          record('updatefound');
        });
      }
      return registration;
    };
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (...args) {
      stats.pending++;
      stats.activity = Date.now();
      record('register-start');
      return register
        .apply(this, args)
        .then(watch)
        .finally(() => {
          stats.pending--;
          stats.activity = Date.now();
          record('register-complete');
        });
    };
    const update = ServiceWorkerRegistration.prototype.update;
    ServiceWorkerRegistration.prototype.update = function () {
      watch(this);
      stats.calls++;
      stats.pending++;
      stats.activity = Date.now();
      record('update-start');
      return update.call(this).finally(() => {
        stats.pending--;
        stats.activity = Date.now();
        record('update-complete');
      });
    };
  });
  const initialCheckFinished = () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/app/');
      return (
        window.pwaChecks.pageShown &&
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        registration?.active?.state === 'activated' &&
        !registration.installing &&
        window.pwaChecks.calls > 0 &&
        window.pwaChecks.pending === 0
      );
    });
  await page.bringToFront();
  await page.goto('/app/loops');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Observe native pageshow and registration/update completion in each document. The app also
  // checks on pageshow, which can follow load and an earlier registration-triggered check.
  await expect.poll(initialCheckFinished).toBe(true);
  await expectGuardedWorker(page, 'active');
  await page.bringToFront();
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
  // Finish the navigation check before publishing; only the subsequent app check may detect it.
  await expect.poll(initialCheckFinished).toBe(true);
  const baseline = await page.evaluate(() => ({ ...window.pwaChecks }));
  console.log('PWA baseline: ' + JSON.stringify(baseline));
  const initialWorker = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  const navigation = [] as string[];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigation.push(frame.url());
  });
  try {
    await control(request, '/worker/build');
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => window.pwaChecks.found)).toBe(baseline.found);
    expect(await page.evaluate(() => window.pwaChecks.calls)).toBe(baseline.calls);
    // Drive the window event the app listens to; there is no navigation or registration.update in the test.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const toast = page.getByRole('status').filter({ hasText: 'A new version is available' });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => window.pwaChecks.calls)).toBe(baseline.calls + 1);
    expect(await page.evaluate(() => window.pwaChecks.found)).toBe(baseline.found + 1);
    expect(navigation).toHaveLength(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(
      initialWorker,
    );
    expect(messages).toHaveLength(0);
    expect(
      await page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration('/app/'))?.waiting),
      ),
    ).toBe(true);
    await toast.getByRole('button', { name: 'Later' }).click();
    await expect(toast).toBeHidden();
    expect(navigation).toHaveLength(0);

    // Workbox also classifies the second updatefound as external and drops its listener.
    // Visibility checks exercise that path immediately, without waiting for the time heuristic.
    await control(request, '/worker/build');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(toast).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => window.pwaChecks.calls)).toBe(baseline.calls + 2);
    expect(await page.evaluate(() => window.pwaChecks.found)).toBe(baseline.found + 2);
    expect(navigation).toHaveLength(0);
    expect(messages).toHaveLength(0);

    await toast.getByRole('button', { name: 'Later' }).click();
    // The previous external update makes Workbox detach its own updatefound listener.
    // Visibility is an independent check trigger, so another build does not wait on focus throttling.
    await control(request, '/worker/build');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(toast).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => window.pwaChecks.calls)).toBe(baseline.calls + 3);
    expect(await page.evaluate(() => window.pwaChecks.found)).toBe(baseline.found + 3);
    expect(navigation).toHaveLength(0);

    // Fresh registration sees the existing waiting worker immediately, without a second interaction.
    await page.reload();
    await expect(toast).toBeVisible();
    const beforeConfirm = navigation.length;
    const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    await toast.getByRole('button', { name: 'Update', exact: true }).click();
    await reloaded;
    await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await expect(toast).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration('/app/'))?.waiting === null,
        ),
      )
      .toBe(true);
    await expect.poll(() => messages.length).toBe(1);
    expectGuardedApply(messages, page);
    expect(navigation).toHaveLength(beforeConfirm + 1);
  } finally {
    await control(request, '/worker/reset');
  }
});

test('two clean tabs reload after an update found more than 60 seconds after registration', async ({
  page,
  context,
  request,
}) => {
  const messages = await observeUpdateMessages(page);
  await observeUpdateClassification(page);
  await page.goto('/app/loops');
  await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();

  // The production build registers the worker for the /app/ scope.
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration('/app/'))?.scope ?? null,
      ),
    )
    .toMatch(/\/app\/$/);

  // The manifest is installable: name, scope, and icons are served.
  const manifest = await page.request.get('/app/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as { scope: string; icons: { src: string }[] };
  expect(body.scope).toBe('/app/');
  for (const icon of body.icons)
    expect((await page.request.get(`/app/${icon.src}`)).ok()).toBe(true);

  let clean: Awaited<ReturnType<typeof context.newPage>> | undefined;
  try {
    await ensureControlledPage(page);
    clean = await context.newPage();
    await observeUpdateClassification(clean);
    await clean.goto('/app/loops');
    await ensureControlledPage(clean);
    await expect(clean.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await ageWorkboxRegistration(page);
    await ageWorkboxRegistration(clean);
    await page.bringToFront();
    const toast = await showWaitingWorker(page, request);
    await expectGuardedWorker(page, 'active');
    // This is the first updatefound in each document, after the >60s clock boundary. Assert the
    // real Workbox external path ran (native listener removed) before confirming, not a fake event.
    for (const client of [page, clean]) {
      await expect
        .poll(() => client.evaluate(() => ({ ...window.pwaUpdateClassification })))
        .toEqual({ added: 2, removed: 1, found: 1 });
    }
    expect(messages).toHaveLength(0);
    const navigation: string[] = [];
    const cleanNavigation: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigation.push(frame.url());
    });
    clean.on('framenavigated', (frame) => {
      if (frame === clean!.mainFrame()) cleanNavigation.push(frame.url());
    });
    const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    const cleanReloaded = clean.waitForEvent(
      'framenavigated',
      (frame) => frame === clean!.mainFrame(),
    );
    await toast.getByRole('button', { name: 'Update', exact: true }).click();
    await Promise.all([reloaded, cleanReloaded]);
    await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await expect(clean.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await expect(toast).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration('/app/'))?.waiting === null,
        ),
      )
      .toBe(true);
    await expect.poll(() => messages.length).toBe(1);
    expectGuardedApply(messages, page);
    expect(navigation).toHaveLength(1);
    expect(cleanNavigation).toHaveLength(1);
    await expectGuardedWorker(clean, 'active');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const name = `graphgoblin-chat-update-v1:${new URL('/app/', location.origin).href}`;
          return (
            (await navigator.locks.query()).held?.filter(
              (lock) => lock.name === name && lock.mode === 'shared',
            ).length ?? 0
          );
        }),
      )
      .toBe(2);
  } finally {
    if (clean && !clean.isClosed()) await clean.close();
    await control(request, '/worker/reset');
  }
});

test('cold offline Loops reload recovers on reconnect without navigating', async ({
  page,
  context,
  request,
}) => {
  const name = `cold offline reconnect ${test.info().repeatEachIndex}-${test.info().retry}`;
  await publishLoop(request, approvalLoop(name));
  await page.goto('/app/loops');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(row).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The worker deliberately does not claim existing clients; the next navigation uses it.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    const offline = page.getByText(/Loops needs the GraphGoblin API/);
    await expect(offline).toBeVisible();
    await expect(page.getByText('You are offline', { exact: true })).toBeVisible();
    await expect(row).toBeHidden();

    const recovered = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/loops' && response.status() === 200,
      { timeout: 5_000 },
    );
    await context.setOffline(false);
    await recovered;
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(offline).toBeHidden();
    await expect(page.getByText('You are offline', { exact: true })).toBeHidden();
    await expect(page).toHaveURL(/\/app\/loops$/);
  } finally {
    await context.setOffline(false);
  }
});

test('another tab’s unresolved voice upload vetoes update activation until that tab closes', async ({
  page,
  context,
  request,
}) => {
  const messages = await observeUpdateMessages(page);
  await page.goto('/app/loops');
  await ensureControlledPage(page);
  await expectGuardedWorker(page, 'active');
  const dirty = await context.newPage();
  // Exercise production session restoration on a non-chat route. No application hook or audio
  // payload is installed: this is the persisted identity of an unresolved frozen voice upload.
  await dirty.addInitScript(() => {
    sessionStorage.setItem(
      'graphgoblin.owner.chat.v1.voice-upload',
      JSON.stringify({
        uploadId: '018e9c20-7b33-4a9f-9036-2e2fcf5a1a23',
        sha256: 'a'.repeat(64),
        caption: '',
      }),
    );
  });
  try {
    await dirty.goto('/app/loops');
    await expect(dirty.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await ensureControlledPage(dirty);
    await page.bringToFront();
    const toast = await showWaitingWorker(page, request);
    const initial = await page.evaluateHandle(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/app/');
      if (!registration?.active || !registration.waiting) throw new Error('missing update pair');
      return {
        active: registration.active,
        waiting: registration.waiting,
        controller: navigator.serviceWorker.controller,
        document: performance.timeOrigin,
      };
    });
    const navigation: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigation.push(frame.url());
    });
    const sharedLeases = () =>
      page.evaluate(async () => {
        const name = `graphgoblin-chat-update-v1:${new URL('/app/', location.origin).href}`;
        return (
          (await navigator.locks.query()).held?.filter(
            (lock) => lock.name === name && lock.mode === 'shared',
          ).length ?? 0
        );
      });
    await expect.poll(sharedLeases).toBe(2);
    expect(messages).toHaveLength(0);
    await toast.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(
      toast.getByText(
        'Finish or discard voice drafts and resolve pending messages in all open tabs before updating.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
    expectGuardedApply(messages, page);
    // Crossing the worker acknowledgement deadline must never expire a live dirty tab as safe.
    await page.waitForTimeout(2_100);
    expect(
      await page.evaluate(async (initial) => {
        const registration = await navigator.serviceWorker.getRegistration('/app/');
        return (
          registration?.active === initial.active &&
          registration.waiting === initial.waiting &&
          navigator.serviceWorker.controller === initial.controller &&
          performance.timeOrigin === initial.document
        );
      }, initial),
    ).toBe(true);
    expect(navigation).toHaveLength(0);
    await expect.poll(sharedLeases).toBe(2);
    await initial.dispose();
    await dirty.close();
    await expect.poll(sharedLeases).toBe(1);
    const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    await toast.getByRole('button', { name: 'Update', exact: true }).click();
    await reloaded;
    await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await expect(toast).toBeHidden();
    await expectGuardedWorker(page, 'active');
    expectGuardedApply(messages, page, 2);
    expect(navigation).toHaveLength(1);
  } finally {
    if (!dirty.isClosed()) await dirty.close();
    await control(request, '/worker/reset');
  }
});

test('a legacy active worker requires all app windows to close before the guarded update activates', async ({
  page,
  context,
  request,
}) => {
  const messages = await observeUpdateMessages(page);
  await control(request, '/worker/build', { mode: 'legacy' });
  let late: Awaited<ReturnType<typeof context.newPage>> | undefined;
  let observer: Awaited<ReturnType<typeof context.newPage>> | undefined;
  let reopened: Awaited<ReturnType<typeof context.newPage>> | undefined;
  try {
    await page.goto('/app/loops');
    await ensureControlledPage(page);
    expect(await workerCapability(page, 'active')).toBeNull();
    const toast = await showWaitingWorker(page, request);
    late = await context.newPage();
    await late.goto('/app/loops');
    await ensureControlledPage(late);
    const initial = await page.evaluateHandle(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/app/');
      if (!registration?.active || !registration.waiting) throw new Error('missing update pair');
      return {
        active: registration.active,
        waiting: registration.waiting,
        controller: navigator.serviceWorker.controller,
        document: performance.timeOrigin,
      };
    });
    const navigation: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigation.push(frame.url());
    });
    await page.bringToFront();
    await toast.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(
      toast.getByText(
        'An older version is still running. Close all app windows to finish updating.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
    expectGuardedApply(messages, page);
    expect(navigation).toHaveLength(0);
    expect(
      await page.evaluate(async (initial) => {
        const registration = await navigator.serviceWorker.getRegistration('/app/');
        return (
          registration?.active === initial.active &&
          registration.waiting === initial.waiting &&
          navigator.serviceWorker.controller === initial.controller &&
          performance.timeOrigin === initial.document
        );
      }, initial),
    ).toBe(true);
    await initial.dispose();
    // This same-origin observer is outside /app/ and is never controlled by its worker. It can
    // observe native activation after every app window closes without keeping the old worker alive.
    observer = await context.newPage();
    await observer.goto('/healthz');
    expect(await observer.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await late.close();
    await page.close();
    await expect
      .poll(() =>
        observer!.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration('/app/');
          return registration?.active?.state === 'activated' && registration.waiting === null;
        }),
      )
      .toBe(true);
    await expectGuardedWorker(observer, 'active');
    reopened = await context.newPage();
    await reopened.goto('/app/loops');
    await ensureControlledPage(reopened);
    await expectGuardedWorker(reopened, 'active');
    await expect(reopened.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    await expect(
      reopened.getByRole('status').filter({ hasText: 'A new version is available' }),
    ).toBeHidden();
  } finally {
    if (late && !late.isClosed()) await late.close();
    if (reopened && !reopened.isClosed()) await reopened.close();
    if (observer && !observer.isClosed()) await observer.close();
    await control(request, '/worker/reset');
  }
});
