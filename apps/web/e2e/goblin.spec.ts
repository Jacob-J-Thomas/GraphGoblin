import { resolve } from 'node:path';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import type {
  ChatDevice,
  ChatPairClaimRequest,
  ChatPairingCreated,
  ChatSession,
  ChatTurn,
} from '@graphgoblin/contracts';
import { control, expect, test } from './fixtures.js';

async function captureDialogMatrix(
  page: Page,
  testInfo: TestInfo,
  name: string,
  role: 'dialog' | 'alertdialog',
) {
  for (const theme of ['dark', 'light']) {
    await page.evaluate((selected) => {
      document.documentElement.dataset['theme'] = selected;
    }, theme);
    for (const width of [360, 768, 1024, 1440, 512]) {
      await page.setViewportSize({ width, height: width === 512 ? 384 : 900 });
      const box = await page.getByRole(role).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
}

async function gateway(request: APIRequestContext) {
  const instance = await control(request, '/apps', {
    requireApiKey: true,
    env: { GG_GOBLIN_DIST: resolve('dist-goblin') },
  });
  const url = String(instance['url']);
  const headers = { authorization: `Bearer ${String(instance['token'])}` };
  const pairingResponse = await request.post(`${url}/chat/pairings`, { headers, data: {} });
  expect(pairingResponse.status()).toBe(201);
  return {
    url,
    headers,
    instanceId: String(instance['instanceId']),
    pairing: (await pairingResponse.json()) as ChatPairingCreated,
  };
}

async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function emptyGoblinGeometry(page: Page, noticeText?: string) {
  const chat = page.getByRole('region', { name: 'Goblin chat', exact: true });
  await expect(chat.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(chat.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await expect(chat.locator('[data-chat-reply]')).toHaveCount(0);
  const geometry = await chat.evaluate((section, expectedNotice) => {
    const box = (element: Element) => {
      const { top, bottom, height } = element.getBoundingClientRect();
      return { top, bottom, height };
    };
    const notice = [...document.querySelectorAll('[role="status"]')].find(
      (element) => expectedNotice !== null && element.textContent?.trim() === expectedNotice,
    );
    return {
      scrollTop: document.scrollingElement!.scrollTop,
      excess: document.scrollingElement!.scrollHeight - window.innerHeight,
      horizontalExcess: document.scrollingElement!.scrollWidth - window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: box(document.querySelector('header')!),
      section: box(section),
      composer: box(section.querySelector('form')!),
      notice: notice ? box(notice) : null,
    };
  }, noticeText ?? null);
  expect(geometry.scrollTop).toBe(0);
  expect(geometry.excess).toBeLessThanOrEqual(1);
  expect(geometry.horizontalExcess).toBeLessThanOrEqual(1);
  expect(geometry.composer.top).toBeGreaterThanOrEqual(0);
  expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
  if (noticeText) {
    expect(geometry.notice).not.toBeNull();
    expect(geometry.notice!.height).toBeGreaterThan(0);
    expect(geometry.notice!.top).toBeGreaterThanOrEqual(geometry.header.bottom);
    expect(geometry.notice!.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  } else expect(geometry.notice).toBeNull();
  return geometry;
}

for (const viewport of [
  { width: 360, height: 740 },
  { width: 1280, height: 860 },
]) {
  test(`fresh same-machine pairing keeps empty Goblin at the top with a visible notice at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }, testInfo) => {
    const gatewayApp = await gateway(request);
    expect(new URL(gatewayApp.pairing.url!).origin).toBe(gatewayApp.url);
    await page.setViewportSize(viewport);
    let claims = 0;
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/chat/pairings/claim')
        claims++;
    });
    await page.goto(gatewayApp.pairing.url!);
    await expect(
      page.getByRole('button', { name: 'Pair this browser instead', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    expect(claims).toBe(0);
    await page.getByRole('button', { name: 'Pair this browser instead', exact: true }).click();
    const label = `Layout ${viewport.width}x${viewport.height}`;
    await page.getByLabel('Device name', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    const noticeText = `Paired as ${label}.`;
    await expect(page.getByText(noticeText, { exact: true })).toBeVisible();
    const measurements = [
      { phase: 'after explicit claim', ...(await emptyGoblinGeometry(page, noticeText)) },
    ];
    await expect(page.getByTestId('goblin-status')).toContainText('Connected');
    await settleLayout(page);
    measurements.push({
      phase: 'fonts and initial observers settled',
      ...(await emptyGoblinGeometry(page, noticeText)),
    });
    const resized =
      viewport.width === 360 ? { width: 1280, height: 860 } : { width: 360, height: 740 };
    for (const size of [resized, viewport]) {
      await page.setViewportSize(size);
      await settleLayout(page);
      measurements.push({
        phase: `resized ${size.width}x${size.height}`,
        ...(await emptyGoblinGeometry(page, noticeText)),
      });
    }
    expect(claims).toBe(1);
    // A restored empty device has no transient pairing notice and still must not reveal a tail.
    await page.reload();
    await expect(page.getByTestId('goblin-status')).toContainText('Connected');
    await expect(page.getByText(noticeText, { exact: true })).toHaveCount(0);
    await settleLayout(page);
    measurements.push({
      phase: 'reload without pairing notice',
      ...(await emptyGoblinGeometry(page)),
    });
    expect(claims).toBe(1);
    await testInfo.attach('empty-goblin-geometry', {
      contentType: 'application/json',
      body: JSON.stringify(measurements, null, 2),
    });
  });
}

test('a consumed code is refused without implicit Enter retries, then an explicit new code pairs', async ({
  page,
  browser,
  request,
}) => {
  const gatewayApp = await gateway(request);
  // Consume the real one-time code in one browser before trying it in separate storage.
  await page.goto(gatewayApp.pairing.url!);
  await page.getByRole('button', { name: 'Pair this browser instead', exact: true }).click();
  await page.getByLabel('Device name', { exact: true }).fill('First code consumer');
  await page.getByRole('button', { name: 'Pair this browser', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();

  const secondContext = await browser.newContext({ viewport: { width: 360, height: 740 } });
  try {
    const second = await secondContext.newPage();
    const claims: ChatPairClaimRequest[] = [];
    const claimStatuses: number[] = [];
    const sessionStatuses: number[] = [];
    second.on('request', (sent) => {
      if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/chat/pairings/claim')
        claims.push(sent.postDataJSON() as ChatPairClaimRequest);
    });
    second.on('response', (received) => {
      if (new URL(received.url()).pathname === '/chat/pairings/claim')
        claimStatuses.push(received.status());
      if (new URL(received.url()).pathname === '/chat/session')
        sessionStatuses.push(received.status());
    });
    await second.goto(`${gatewayApp.url}/goblin/`);
    const code = second.getByLabel('Pairing code', { exact: true });
    const name = second.getByLabel('Device name', { exact: true });
    await code.fill(gatewayApp.pairing.code);
    await name.fill('Fresh replacement device');
    expect(claims).toHaveLength(0);
    await second.getByRole('button', { name: 'Pair this browser', exact: true }).click();
    await expect(second.getByRole('alert')).toContainText('Pairing was refused');
    await expect(second.locator('#goblin-pairing-error')).toBeFocused();
    expect(claims).toHaveLength(1);
    expect(claimStatuses).toEqual([401]);
    expect(sessionStatuses).toEqual([401]);
    const pending = await second.evaluate(() =>
      localStorage.getItem('graphgoblin.goblin.device.v1'),
    );
    expect(JSON.parse(pending!)).toMatchObject({ kind: 'pending', ...claims[0] });
    await second.keyboard.press('Tab');
    const replace = second.getByRole('button', { name: 'Use a new code', exact: true });
    await expect(replace).toBeFocused();
    await name.press('Enter');
    await code.press('Enter');
    await settleLayout(second);
    expect(claims).toHaveLength(1);
    expect(claimStatuses).toEqual([401]);
    expect(sessionStatuses).toEqual([401]);
    expect(await second.evaluate(() => localStorage.getItem('graphgoblin.goblin.device.v1'))).toBe(
      pending,
    );
    await expect(second.getByRole('button', { name: 'Retry pairing', exact: true })).toBeVisible();
    // Enter on the actual replacement button remains an explicit, keyboard-operable action.
    await replace.focus();
    await replace.press('Enter');
    await expect(code).toBeFocused();
    await expect(code).toHaveValue('');
    await expect(
      second.getByText('Saved attempt forgotten. Paste a new code.', { exact: true }),
    ).toBeVisible();
    expect(
      await second.evaluate(() => localStorage.getItem('graphgoblin.goblin.device.v1')),
    ).toBeNull();
    expect(claims).toHaveLength(1);
    const generated = await request.post(`${gatewayApp.url}/chat/pairings`, {
      headers: gatewayApp.headers,
      data: {},
    });
    expect(generated.status()).toBe(201);
    const fresh = (await generated.json()) as ChatPairingCreated;
    await code.fill(fresh.code);
    await second.getByRole('button', { name: 'Pair this browser', exact: true }).click();
    await expect(second.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect(
      second.getByText('Paired as Fresh replacement device.', { exact: true }),
    ).toBeVisible();
    expect(claims).toHaveLength(2);
    expect(claimStatuses).toEqual([401, 200]);
    expect(claims[1]!.code).toBe(fresh.code);
    expect(claims[1]!.claimId).not.toBe(claims[0]!.claimId);
    expect(claims[1]!.deviceToken).not.toBe(claims[0]!.deviceToken);
    const devices = (await (
      await request.get(`${gatewayApp.url}/chat/devices`, { headers: gatewayApp.headers })
    ).json()) as { items: ChatDevice[] };
    expect(devices.items.map((device) => device.label).sort()).toEqual([
      'First code consumer',
      'Fresh replacement device',
    ]);
    expect(devices.items.every((device) => !device.revokedAt)).toBe(true);
  } finally {
    await secondContext.close();
  }
});

test('Goblin pairs explicitly, executes a native turn, keeps API data out of its scoped cache, and signs out locally', async ({
  page,
  context,
  request,
}, testInfo) => {
  const gatewayApp = await gateway(request);
  await control(request, '/harness/script', {
    instanceId: gatewayApp.instanceId,
    turns: [
      {
        finalText: 'Peripheral native reply <b>literal text</b>',
      },
    ],
  });
  const mutations: string[] = [];
  const authorization: Promise<void>[] = [];
  page.on('request', (sent) => {
    const path = new URL(sent.url()).pathname;
    if (!path.startsWith('/chat/')) return;
    if (sent.method() !== 'GET') mutations.push(`${sent.method()} ${path}`);
    if (path !== '/chat/pairings/claim')
      authorization.push(
        sent.allHeaders().then((headers) => {
          expect(headers['authorization']).toMatch(/^Bearer ggd_[\w-]{43}$/);
        }),
      );
  });
  await page.addInitScript(() =>
    localStorage.setItem('graphgoblin-api-key', 'owner-secret-must-stay-local'),
  );
  await page.goto(`${gatewayApp.url}/goblin/#pair=${encodeURIComponent(gatewayApp.pairing.code)}`);
  await expect(
    page.getByRole('heading', { name: 'Install Goblin, then pair in the app' }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(mutations).toEqual([]);
  await expect(page.getByText('This page forgets the code if you reload or leave.')).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((selected) => {
      document.documentElement.dataset['theme'] = selected;
    }, theme);
    for (const width of [360, 768, 1024, 1440, 512]) {
      await page.setViewportSize({ width, height: width === 512 ? 384 : 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`install-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset['theme'] = 'dark';
  });
  await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy code' }).click();
  expect(mutations).toEqual([]);
  await page.getByRole('button', { name: 'Pair this browser instead' }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toBeFocused();
  await page.getByLabel('Device name', { exact: true }).fill('Browser peripheral');
  await page.getByRole('button', { name: 'Pair this browser' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  expect(mutations.filter((value) => value.endsWith('/pairings/claim'))).toHaveLength(1);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Actual native turn');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('[data-chat-reply]')).toContainText(
    'Peripheral native reply <b>literal text</b>',
  );
  await expect(page.locator('[data-chat-reply] b')).toHaveCount(0);
  const credential = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('graphgoblin.goblin.device.v1')!) as { deviceToken: string },
  );
  const deviceHeaders = { authorization: `Bearer ${credential.deviceToken}` };
  const conversations = (await (
    await request.get(`${gatewayApp.url}/chat/conversations`, { headers: deviceHeaders })
  ).json()) as { items: { id: string }[] };
  const turns = (await (
    await request.get(`${gatewayApp.url}/chat/conversations/${conversations.items[0]!.id}/turns`, {
      headers: deviceHeaders,
    })
  ).json()) as { items: ChatTurn[] };
  expect(turns.items).toHaveLength(1);
  expect(turns.items[0]).toMatchObject({
    runStatus: 'succeeded',
    response: { reply: 'Peripheral native reply <b>literal text</b>' },
  });
  const native = await request.get(`${gatewayApp.url}/runs/${turns.items[0]!.runId}`, {
    headers: gatewayApp.headers,
  });
  expect(native.ok()).toBe(true);
  expect(await native.json()).toMatchObject({ status: 'succeeded' });

  const manifest = (await (
    await request.get(`${gatewayApp.url}/goblin/manifest.webmanifest`)
  ).json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    id: '/goblin/',
    start_url: '/goblin/',
    scope: '/goblin/',
    name: 'Goblin',
  });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const baseline = mutations.length;
  await page.reload();
  await expect(page.locator('[data-chat-reply]')).toBeVisible();
  expect(mutations).toHaveLength(baseline);
  const scopes = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then((items) => items.map((item) => item.scope)),
  );
  expect(scopes).toEqual([`${gatewayApp.url}/goblin/`]);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname),
        ),
      )
    ).flat();
  });
  expect(cached.length).toBeGreaterThan(5);
  expect(cached.every((path) => path.startsWith('/goblin/'))).toBe(true);
  expect(cached.some((path) => /^\/(chat|loops|runs)/.test(path))).toBe(false);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((selected) => {
      document.documentElement.dataset['theme'] = selected;
    }, theme);
    for (const width of [360, 768, 1024, 1440, 512]) {
      // 512×384 CSS pixels is reflow at 200% zoom of a 1024×768 window, as in responsive.spec.
      await page.setViewportSize({ width, height: width === 512 ? 384 : 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`goblin-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.documentElement.dataset['theme'] = 'dark';
  });
  await context.setOffline(true);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Unsent offline draft');
  await expect(page.getByRole('button', { name: 'Send message' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('button', { name: 'Send message' }).click({ force: true });
  expect(mutations).toHaveLength(baseline);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Unsent offline draft',
  );
  expect(mutations).toHaveLength(baseline);
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Send message' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  expect(mutations).toHaveLength(baseline);
  await page.getByRole('button', { name: 'Gateway', exact: true }).click();
  await captureDialogMatrix(page, testInfo, 'gateway', 'dialog');
  await page.getByRole('button', { name: 'Sign out on this device' }).click();
  await captureDialogMatrix(page, testInfo, 'sign-out', 'alertdialog');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('graphgoblin.goblin.device.v1')),
  ).toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem('graphgoblin.goblin.chat.v1')),
  ).toBeNull();
  const devices = (await (
    await request.get(`${gatewayApp.url}/chat/devices`, { headers: gatewayApp.headers })
  ).json()) as { items: ChatDevice[] };
  expect(devices.items).toHaveLength(1);
  expect(devices.items[0]?.revokedAt).toBeUndefined();
  await Promise.all(authorization);
});

test('peripheral pairing reflows in both themes and at 200% zoom without claiming on load', async ({
  page,
  request,
}, testInfo) => {
  const gatewayApp = await gateway(request);
  let claims = 0;
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname === '/chat/pairings/claim') claims++;
  });
  await page.goto(`${gatewayApp.url}/goblin/`);
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  await page
    .getByLabel('Device name', { exact: true })
    .fill('A device name that is visible on the owner gateway');
  await page.getByLabel('Pairing code').fill('A'.repeat(43));
  for (const theme of ['dark', 'light']) {
    await page.evaluate((selected) => {
      document.documentElement.dataset['theme'] = selected;
    }, theme);
    for (const width of [360, 768, 1024, 1440, 512]) {
      await page.setViewportSize({ width, height: width === 512 ? 384 : 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`pair-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
  expect(claims).toBe(0);
});

test('same-Mac loopback pairing without PUBLIC_URL generates, claims, chats, and revokes through the built UI', async ({
  page,
  context,
  request,
}) => {
  const instance = await control(request, '/apps', {
    requireApiKey: true,
    env: { GG_GOBLIN_DIST: resolve('dist-goblin') },
  });
  const url = String(instance['url']);
  const token = String(instance['token']);
  const headers = { authorization: `Bearer ${token}` };
  const loopsResponse = await request.get(`${url}/loops`, { headers });
  expect(loopsResponse.ok()).toBe(true);
  const loops = (await loopsResponse.json()) as { items: { id: string; createdAt: string }[] };
  expect(loops.items).toHaveLength(1);
  // Pairing expiry is driven by the disposable API's FakeClock, not the host clock.
  await page.clock.setFixedTime(new Date(loops.items[0]!.createdAt));
  await page.addInitScript((key) => localStorage.setItem('graphgoblin-api-key', key), token);
  await control(request, '/harness/script', {
    instanceId: String(instance['instanceId']),
    turns: [{ finalText: 'Same-Mac native reply' }],
  });
  const mutations: string[] = [];
  context.on('request', (sent) => {
    const path = new URL(sent.url()).pathname;
    if (path.startsWith('/chat/') && sent.method() !== 'GET')
      mutations.push(`${sent.method()} ${path}`);
  });
  await page.goto(`${url}/app/chat/devices`);
  await page.getByRole('button', { name: 'Pair a device', exact: true }).click();
  const pairingDialog = page.getByRole('dialog', { name: 'Pair a device', exact: true });
  await expect(
    pairingDialog.getByRole('heading', { name: 'This computer only', exact: true }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
  const generated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/chat/pairings' &&
      response.request().method() === 'POST',
  );
  await pairingDialog.getByRole('button', { name: 'Generate pairing link', exact: true }).click();
  const response = await generated;
  expect(response.status()).toBe(201);
  const pairing = (await response.json()) as ChatPairingCreated;
  expect(new URL(pairing.url!).origin).toBe(url);
  expect(new URL(pairing.url!).pathname).toBe('/goblin/');
  expect(new URL(pairing.url!).hash).toBe(`#pair=${pairing.code}`);
  expect(mutations).toEqual(['POST /chat/pairings']);
  const link = pairingDialog.getByRole('link', {
    name: 'Open Goblin on this computer',
    exact: true,
  });
  await expect(link).toHaveAttribute('href', pairing.url!);
  const opened = page.waitForEvent('popup');
  await link.click();
  const goblin = await opened;
  const authorization: Promise<void>[] = [];
  goblin.on('request', (sent) => {
    const path = new URL(sent.url()).pathname;
    if (!path.startsWith('/chat/')) return;
    authorization.push(
      sent.allHeaders().then((values) => {
        if (path === '/chat/pairings/claim') expect(values['authorization']).toBeUndefined();
        else expect(values['authorization']).toMatch(/^Bearer ggd_[\w-]{43}$/);
      }),
    );
  });
  try {
    await expect(
      goblin.getByRole('heading', { name: 'Install Goblin, then pair in the app', exact: true }),
    ).toBeVisible();
    expect(new URL(goblin.url()).hash).toBe('');
    expect(mutations.filter((value) => value.endsWith('/pairings/claim'))).toHaveLength(0);
    await goblin.getByRole('button', { name: 'Pair this browser instead', exact: true }).click();
    await goblin.getByLabel('Device name', { exact: true }).fill('Same-Mac browser');
    await goblin.getByRole('button', { name: 'Pair this browser', exact: true }).click();
    await expect(goblin.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    expect(mutations.filter((value) => value.endsWith('/pairings/claim'))).toHaveLength(1);
    await expect(goblin.getByRole('navigation')).toHaveCount(0);
    await goblin
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Same-Mac loopback request');
    await goblin.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(goblin.locator('[data-chat-reply]')).toContainText('Same-Mac native reply');
    expect(
      mutations.filter((value) => /POST \/chat\/conversations\/[^/]+\/turns$/.test(value)),
    ).toHaveLength(1);
    const sessionResponse = await request.get(`${url}/chat/session`, { headers });
    expect(sessionResponse.ok()).toBe(true);
    const ownerSession = (await sessionResponse.json()) as ChatSession;
    const credential = await goblin.evaluate(
      () =>
        JSON.parse(localStorage.getItem('graphgoblin.goblin.device.v1')!) as {
          deviceToken: string;
        },
    );
    const deviceHeaders = { authorization: `Bearer ${credential.deviceToken}` };
    expect((await request.get(`${url}/loops`, { headers: deviceHeaders })).status()).toBe(403);
    await page.bringToFront();
    await pairingDialog.getByRole('button', { name: 'Done', exact: true }).click();
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText('Same-Mac browser', { exact: true }) });
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    const devicesBefore = (await (
      await request.get(`${url}/chat/devices`, { headers })
    ).json()) as { items: ChatDevice[] };
    expect(devicesBefore.items).toHaveLength(1);
    expect(devicesBefore.items[0]!.loopId).not.toBe(ownerSession.systemLoopId);
    await row.getByRole('button', { name: 'Revoke Same-Mac browser', exact: true }).click();
    const confirm = page.getByRole('alertdialog', {
      name: 'Revoke “Same-Mac browser”?',
      exact: true,
    });
    await confirm
      .getByRole('button', { name: 'Confirm revoke Same-Mac browser', exact: true })
      .click();
    await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
    await goblin.bringToFront();
    // Reload performs a read-only credential check; it must not replay the admitted message.
    await goblin.reload();
    await expect(
      goblin.getByRole('heading', { name: 'This device no longer has access', exact: true }),
    ).toBeVisible();
    expect(
      await goblin.evaluate(() => localStorage.getItem('graphgoblin.goblin.device.v1')),
    ).toBeNull();
    expect(
      await goblin.evaluate(() => sessionStorage.getItem('graphgoblin.goblin.chat.v1')),
    ).toBeNull();
    expect((await request.get(`${url}/chat/session`, { headers: deviceHeaders })).status()).toBe(
      401,
    );
    const retained = (await (await request.get(`${url}/chat/devices`, { headers })).json()) as {
      items: ChatDevice[];
    };
    expect(retained.items[0]).toMatchObject({
      id: devicesBefore.items[0]!.id,
      loopId: devicesBefore.items[0]!.loopId,
    });
    expect(retained.items[0]!.revokedAt).toBeTruthy();
    const historyResponse = await request.get(
      `${url}/runs?loopId=${devicesBefore.items[0]!.loopId}`,
      { headers },
    );
    expect(historyResponse.ok()).toBe(true);
    const history = (await historyResponse.json()) as {
      items: { status: string; loopId: string }[];
    };
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      status: 'succeeded',
      loopId: devicesBefore.items[0]!.loopId,
    });
    expect(
      mutations.filter((value) => /POST \/chat\/conversations\/[^/]+\/turns$/.test(value)),
    ).toHaveLength(1);
    await Promise.all(authorization);
  } finally {
    await goblin.close();
  }
});

test('emulated Home Screen context pairs in separate browser storage and revocation clears access', async ({
  browser,
  page,
  request,
}, testInfo) => {
  const gatewayApp = await gateway(request);
  const claims: string[] = [];
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname === '/chat/pairings/claim') claims.push(sent.url());
  });
  await page.goto(`${gatewayApp.url}/goblin/`);
  await expect(page.getByRole('heading', { name: 'Pair this device', exact: true })).toBeVisible();
  // Deliver a pairing link to an already open tab: hashchange must prefill and scrub it.
  await page.evaluate((code) => {
    window.location.hash = `pair=${encodeURIComponent(code)}`;
  }, gatewayApp.pairing.code);
  await expect(page.getByRole('button', { name: 'Pair this browser instead' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(claims).toEqual([]);
  const installed = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await installed.addInitScript(() =>
      Object.defineProperty(navigator, 'standalone', { value: true }),
    );
    const app = await installed.newPage();
    await app.goto(`${gatewayApp.url}/goblin/`);
    await expect(app.getByText('Install Goblin, then pair in the app')).toHaveCount(0);
    await app.getByLabel('Pairing code').fill(gatewayApp.pairing.code);
    await app.getByLabel('Device name', { exact: true }).fill('Emulated Home Screen');
    await app.getByRole('button', { name: 'Pair', exact: true }).click();
    await expect(app.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('graphgoblin.goblin.device.v1')),
    ).toBeNull();
    const devices = (await (
      await request.get(`${gatewayApp.url}/chat/devices`, { headers: gatewayApp.headers })
    ).json()) as { items: ChatDevice[] };
    expect(devices.items).toHaveLength(1);
    await request.post(`${gatewayApp.url}/chat/devices/${devices.items[0]!.id}/revoke`, {
      headers: gatewayApp.headers,
      data: {},
    });
    await app.getByRole('button', { name: 'Gateway', exact: true }).click();
    await app.getByRole('button', { name: 'Check connection' }).click();
    await expect(
      app.getByRole('heading', { name: 'This device no longer has access' }),
    ).toBeVisible();
    for (const theme of ['dark', 'light']) {
      await app.evaluate((selected) => {
        document.documentElement.dataset['theme'] = selected;
      }, theme);
      for (const width of [360, 768, 1024, 1440, 512]) {
        await app.setViewportSize({ width, height: width === 512 ? 384 : 900 });
        expect(
          await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await app.screenshot({
          path: testInfo.outputPath(`access-lost-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    expect(
      await app.evaluate(() => localStorage.getItem('graphgoblin.goblin.device.v1')),
    ).toBeNull();
    expect(
      await app.evaluate(() => sessionStorage.getItem('graphgoblin.goblin.chat.v1')),
    ).toBeNull();
  } finally {
    await installed.close();
  }
});
