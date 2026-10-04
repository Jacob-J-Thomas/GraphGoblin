import { approvalLoop, control, expect, publishLoop, showLoopPanel, test } from './fixtures.js';

declare global {
  interface Window {
    pwaChecks: { calls: number; found: number; pending: number; activity: number };
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

test('an open window detects a changed worker on focus, prompts, and updates only on confirmation', async ({
  page,
  request,
}) => {
  test.setTimeout(100_000);
  await page.addInitScript(() => {
    const stats = (window.pwaChecks = { calls: 0, found: 0, pending: 0, activity: Date.now() });
    const watched = new WeakSet<ServiceWorkerRegistration>();
    const watch = (registration: ServiceWorkerRegistration) => {
      if (!watched.has(registration)) {
        watched.add(registration);
        registration.addEventListener('updatefound', () => {
          stats.found++;
          stats.activity = Date.now();
        });
      }
      return registration;
    };
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (...args) {
      return register.apply(this, args).then(watch);
    };
    const update = ServiceWorkerRegistration.prototype.update;
    ServiceWorkerRegistration.prototype.update = function () {
      watch(this);
      stats.calls++;
      stats.pending++;
      stats.activity = Date.now();
      return update.call(this).finally(() => {
        stats.pending--;
        stats.activity = Date.now();
      });
    };
  });
  await page.goto('/app/loops');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
  // Finish the navigation check before publishing; only the subsequent app check may detect it.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/app/');
        return (
          !registration?.installing &&
          window.pwaChecks.pending === 0 &&
          Date.now() - window.pwaChecks.activity >= 2_000
        );
      }),
    )
    .toBe(true);
  const baseline = await page.evaluate(() => ({ ...window.pwaChecks }));
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
    expect(await page.evaluate(() => window.graphgoblinPwa?.appliedUpdates)).toBe(0);
    expect(
      await page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration('/app/'))?.waiting),
      ),
    ).toBe(true);
    await toast.getByRole('button', { name: 'Later' }).click();
    await expect(toast).toBeHidden();
    expect(navigation).toHaveLength(0);

    // Workbox's private 60 s external-update boundary is not configurable. Keep this window open
    // past it, also allowing the app's focus throttle to expire, then detect a different build.
    await page.waitForTimeout(61_000);
    await control(request, '/worker/build');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(toast).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => window.pwaChecks.calls)).toBe(baseline.calls + 2);
    expect(await page.evaluate(() => window.pwaChecks.found)).toBe(baseline.found + 2);
    expect(navigation).toHaveLength(0);
    expect(await page.evaluate(() => window.graphgoblinPwa?.appliedUpdates)).toBe(0);

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
  } finally {
    await control(request, '/worker/reset');
  }
});

test('registers the service worker and asks before applying an update', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Loops' })).toBeVisible();

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

  // A new worker is waiting: the toast appears and nothing activates until the user confirms.
  await page.evaluate(() => window.graphgoblinPwa?.simulateUpdate());
  const toast = page.getByRole('status').filter({ hasText: 'A new version is available' });
  await expect(toast).toBeVisible();
  expect(await page.evaluate(() => window.graphgoblinPwa?.appliedUpdates)).toBe(0);
  await toast.getByRole('button', { name: 'Update' }).click();
  await expect(toast).toBeHidden();
  expect(await page.evaluate(() => window.graphgoblinPwa?.appliedUpdates)).toBe(1);
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
