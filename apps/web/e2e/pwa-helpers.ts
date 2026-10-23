import type { APIRequestContext, Page } from '@playwright/test';
import { control, expect } from './fixtures.js';

declare global {
  interface Window {
    recordPwaWorkerMessage(message: unknown): Promise<void>;
  }
}

/** Observe the browser's message boundary; no application hook is installed. */
export async function observeSkipWaiting(page: Page): Promise<unknown[]> {
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
        message.type === 'SKIP_WAITING'
      )
        void window.recordPwaWorkerMessage(message);
      Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
    };
  });
  return messages;
}

/** Publish byte-different real worker bytes and wait for the browser's installed update. */
export async function showWaitingWorker(page: Page, request: APIRequestContext = page.request) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null)))
    await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
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
  return toast;
}
