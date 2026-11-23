// PREPARED / UNEXECUTED. Destination after exact repaired-source admission:
// apps/web/e2e/owner-chat-cross-route.qa.spec.ts
import type { Request } from '@playwright/test';
import { approvalLoop, control, expect, test, uniqueLoopName } from './fixtures.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test('D230 B1: a retired Devices 401 preserves the recovered quiet inspector through real route navigation', async ({ page, request }, testInfo) => {
  // The existing E2E controller creates a disposable API, in-memory database and synthetic key.
  const instance = await control(request, '/apps', { requireApiKey: true });
  const url = String(instance['url']);
  const token = String(instance['token']);
  const headers = { authorization: `Bearer ${token}` };
  const definition = approvalLoop(uniqueLoopName('D230 quiet cross route'));
  const created = await request.post(`${url}/loops`, { headers, data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = await created.json() as { loop: { id: string } };
  expect((await request.post(`${url}/loops/${loop.id}/publish`, { headers })).status()).toBe(200);
  const started = await request.post(`${url}/loops/${loop.id}/runs`, { headers, data: { input: null } });
  expect(started.status()).toBe(202);
  const { run } = await started.json() as { run: { id: string } };
  await expect.poll(async () => (await (await request.get(`${url}/runs/${run.id}`, { headers })).json() as { status: string }).status).toBe('waiting');
  const baseline = await (await request.get(`${url}/runs/${run.id}`, { headers })).json() as { lastEventSeq: number; currentNodeId: string };
  expect(baseline.currentNodeId).toBe('approve');

  await page.addInitScript((key) => localStorage.setItem('graphgoblin-api-key', key), token);
  // Ordinary setup visit acknowledges the existing waiting tail. Persistence uses the app's
  // actual event store. No private cache write, injected cursor or test-triggered refresh.
  // The subsequent Devices -> inspector schedule therefore has no initial SSE replay batch
  // that could be mistaken for a recovery refresh.
  await page.goto(`${url}/app/runs/${run.id}`);
  await expect(page.getByRole('list', { name: 'Timeline' }).getByRole('button', { name: /run\.waiting/ })).toBeVisible();
  const warmHeader = page.locator('header').filter({ has: page.getByRole('heading', { name: `Run ${run.id}` }) });
  await expect(warmHeader.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
  await expect(warmHeader.getByText('at approve', { exact: true })).toBeVisible();
  const devices = gate();
  const rejection = gate();
  let chatCalls = 0;
  let observationCalls = 0;
  let runReads = 0;
  let activeRoutes = 0;
  let oldDevice: Request | undefined;
  const streamCursors: string[] = [];
  page.on('request', (sent) => {
    const target = new URL(sent.url());
    if (sent.method() === 'GET' && target.pathname === `/runs/${run.id}`) runReads++;
    if (target.pathname === `/runs/${run.id}/events` && sent.headers()['accept']?.includes('text/event-stream')) streamCursors.push(target.searchParams.get('after') ?? '0');
  });
  await page.route((target) => target.pathname === '/chat/devices', async (route) => {
    chatCalls++;
    oldDevice = route.request();
    activeRoutes++;
    try {
      expect((await oldDevice.allHeaders())['authorization']).toBe(`Bearer ${token}`);
      await devices.promise;
      await route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } });
    } finally { activeRoutes--; }
  });
  await page.route((target) => target.pathname === `/runs/${run.id}/observation`, async (route) => {
    observationCalls++;
    if (observationCalls > 1) { await route.continue(); return; }
    activeRoutes++;
    try {
      await rejection.promise;
      await route.fulfill({ status: 401, json: { status: 401, code: 'UNAUTHORIZED', title: 'Unauthorized' } });
    } finally { activeRoutes--; }
  });
  try {
    await page.goto(`${url}/app/chat/devices`);
    await expect.poll(() => chatCalls).toBe(1);
    // Ordinary router links preserve the pending owner request across the route change.
    await page.getByRole('link', { name: 'Runs', exact: true }).first().click();
    await page.getByRole('link', { name: run.id, exact: true }).click();
    const header = page.locator('header').filter({ has: page.getByRole('heading', { name: `Run ${run.id}` }) });
    await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
    await expect(header.getByText('at approve', { exact: true })).toBeVisible();
    await expect.poll(() => streamCursors.length).toBe(1);
    expect(streamCursors[0]).toBe(String(baseline.lastEventSeq));
    const beforeRecovery = runReads;
    rejection.release();
    const form = page.getByRole('form', { name: 'Enter API key' });
    await expect(form).toBeVisible();
    await form.getByLabel('API key', { exact: true }).fill(token);
    await form.getByRole('button', { name: 'Use key' }).click();
    await expect(form).toHaveCount(0);
    await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
    await expect(header.getByText('at approve', { exact: true })).toBeVisible();
    await expect.poll(() => runReads).toBe(beforeRecovery + 1);
    await expect.poll(() => streamCursors.length).toBe(2);
    expect(streamCursors.at(-1)).toBe(String(baseline.lastEventSeq));
    expect(oldDevice).toBeDefined();
    const oldResponse = oldDevice!.response();
    devices.release();
    const response = await oldResponse;
    expect(response?.status()).toBe(401);
    expect(await response!.finished()).toBeNull();
    // HTTP completion plus frames is browser-render evidence, not cache-consumption proof.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(form).toHaveCount(0);
    await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
    await expect(header.getByText('at approve', { exact: true })).toBeVisible();
    await expect(header.getByText('Updating status…', { exact: true })).toHaveCount(0);
    // Fixed, finite read-budget measurement; never used to synchronize initial rendering.
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 2200)));
    expect(runReads).toBe(beforeRecovery + 1);
    expect(chatCalls).toBe(1);
    expect(streamCursors).toHaveLength(2);
    await expect(form).toHaveCount(0);
    await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'waiting');
    await expect(header.getByText('at approve', { exact: true })).toBeVisible();
    // A current server read remains waiting; the browser fixture creates no lifecycle change.
    const current = await request.get(`${url}/runs/${run.id}`, { headers });
    expect(current.status()).toBe(200);
    expect(await current.json()).toMatchObject({ status: 'waiting', lastEventSeq: baseline.lastEventSeq, currentNodeId: 'approve' });
    await testInfo.attach('D230-schedule', { body: JSON.stringify({ runReads, beforeRecovery, chatCalls, observationCalls, streamCursors, quietSampleMs: 2200, browserOnly: true }), contentType: 'application/json' });
  } finally {
    devices.release();
    rejection.release();
    await page.goto('about:blank');
    await expect.poll(() => activeRoutes).toBe(0);
    await page.unrouteAll({ behavior: 'wait' });
  }
});
