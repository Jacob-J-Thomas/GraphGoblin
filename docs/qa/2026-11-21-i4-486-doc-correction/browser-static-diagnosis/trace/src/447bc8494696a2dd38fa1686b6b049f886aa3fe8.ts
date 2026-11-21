import type { APIRequestContext, Page } from '@playwright/test';
import { control, expect } from './fixtures.js';

declare global {
  interface Window {
    recordPwaWorkerMessage(message: unknown): Promise<void>;
    pwaUpdateClassification: { added: number; removed: number; found: number };
  }
}

/** Observe native listener removal; Workbox removes updatefound only for external updates. */
export async function observeUpdateClassification(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stats = (window.pwaUpdateClassification = { added: 0, removed: 0, found: 0 });
    const add: unknown = Reflect.get(ServiceWorkerRegistration.prototype, 'addEventListener');
    const remove: unknown = Reflect.get(ServiceWorkerRegistration.prototype, 'removeEventListener');
    const register: unknown = Reflect.get(ServiceWorkerContainer.prototype, 'register');
    if (typeof add !== 'function' || typeof remove !== 'function' || typeof register !== 'function')
      throw new Error('missing native service worker lifecycle methods');
    ServiceWorkerRegistration.prototype.addEventListener = function (
      ...args: Parameters<ServiceWorkerRegistration['addEventListener']>
    ) {
      if (args[0] === 'updatefound') stats.added++;
      Reflect.apply(add, this, args);
    };
    ServiceWorkerRegistration.prototype.removeEventListener = function (
      ...args: Parameters<ServiceWorkerRegistration['removeEventListener']>
    ) {
      if (args[0] === 'updatefound') stats.removed++;
      Reflect.apply(remove, this, args);
    };
    const observed = new WeakSet<ServiceWorkerRegistration>();
    ServiceWorkerContainer.prototype.register = async function (
      ...args: Parameters<ServiceWorkerContainer['register']>
    ) {
      const registration: unknown = await Reflect.apply(register, this, args);
      if (!(registration instanceof ServiceWorkerRegistration))
        throw new Error('native registration returned a different object');
      if (!observed.has(registration)) {
        observed.add(registration);
        // Bypass our add counter: only Workbox and the application's own watcher count there.
        Reflect.apply(add, registration, [
          'updatefound',
          () => {
            stats.found++;
          },
        ]);
      }
      return registration;
    };
  });
}

/** Advance the clock Workbox actually reads, without replacing worker events or firing timers. */
export async function ageWorkboxRegistration(page: Page): Promise<void> {
  // Both native listeners are installed only after the real Workbox registration completes.
  await expect.poll(() => page.evaluate(() => window.pwaUpdateClassification.added)).toBe(2);
  expect(await page.evaluate(() => ({ ...window.pwaUpdateClassification }))).toEqual({
    added: 2,
    removed: 0,
    found: 0,
  });
  expect(
    await page.evaluate(() => {
      const nativeNow = performance.now.bind(performance);
      const before = nativeNow();
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => nativeNow() + 60_001,
      });
      return performance.now() - before;
    }),
  ).toBeGreaterThanOrEqual(60_001);
}

/** Observe the browser's message boundary; no application hook is installed. */
export async function observeUpdateMessages(page: Page): Promise<unknown[]> {
  const messages: unknown[] = [];
  await page.exposeFunction('recordPwaWorkerMessage', (message: unknown) => {
    messages.push(message);
  });
  await page.addInitScript(() => {
    const original: unknown = Reflect.get(ServiceWorker.prototype, 'postMessage');
    if (typeof original !== 'function') throw new Error('missing native worker message method');
    ServiceWorker.prototype.postMessage = function (
      this: ServiceWorker,
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message.type === 'SKIP_WAITING' || message.type === 'APPLY')
      )
        void window.recordPwaWorkerMessage(message);
      Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
    };
  });
  return messages;
}

/** Query the real worker boundary; capability proves the imported production guard executed. */
export async function workerCapability(page: Page, target: 'active' | 'waiting') {
  return page.evaluate(async (target) => {
    const registration = await navigator.serviceWorker.getRegistration('/app/');
    const worker = registration?.[target];
    if (!registration || !worker) throw new Error(`missing ${target} worker`);
    const channel = new MessageChannel();
    const attempt = crypto.randomUUID();
    return new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => {
        channel.port1.close();
        resolve(null);
      }, 3_000);
      channel.port1.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
        if (event.data.attempt !== attempt) return;
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage(
        {
          protocol: 'graphgoblin-chat-update-v1',
          scope: registration.scope,
          type: 'CAPABILITY',
          attempt,
        },
        [channel.port2],
      );
    });
  }, target);
}

export async function expectGuardedWorker(page: Page, target: 'active' | 'waiting') {
  expect(await workerCapability(page, target)).toEqual({
    protocol: 'graphgoblin-chat-update-v1',
    scope: new URL('/app/', page.url()).href,
    generation: 'chat-session-web-lock-v1',
    attempt: expect.any(String),
  });
}

export function expectGuardedApply(messages: readonly unknown[], page: Page, count = 1) {
  expect(messages).toEqual(
    Array.from({ length: count }, () => ({
      protocol: 'graphgoblin-chat-update-v1',
      scope: new URL('/app/', page.url()).href,
      type: 'APPLY',
      attempt: expect.any(String),
    })),
  );
}

export async function ensureControlledPage(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null)))
    await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** Publish byte-different real worker bytes and wait for the browser's installed update. */
export async function showWaitingWorker(page: Page, request: APIRequestContext = page.request) {
  await ensureControlledPage(page);
  await control(request, '/worker/build');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/app/');
    if (!registration) throw new Error('missing service worker registration');
    await registration.update();
  });
  const toast = page.getByRole('status').filter({ hasText: 'A new version is available' });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration('/app/'))?.waiting?.state,
      ),
    )
    .toBe('installed');
  await expectGuardedWorker(page, 'waiting');
  return toast;
}
