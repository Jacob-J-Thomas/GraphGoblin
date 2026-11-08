import { resolve } from 'node:path';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import type { ChatDevice, ChatPairingCreated, ChatTurn } from '@graphgoblin/contracts';
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
    env: { GG_GOBLIN_DIST: resolve('dist-goblin'), GG_PUBLIC_URL: 'http://127.0.0.1' },
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
        structured: {
          protocol: 'graphgoblin.chat.v1',
          reply: 'Peripheral native reply <b>literal text</b>',
        },
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
  await page.goto(`${gatewayApp.url}/goblin/#pair=${encodeURIComponent(gatewayApp.pairing.code)}`);
  await expect(page.getByRole('button', { name: 'Pair this browser instead' })).toBeVisible();
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
