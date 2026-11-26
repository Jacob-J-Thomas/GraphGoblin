import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { APIRequestContext, Browser, Page, TestInfo } from '@playwright/test';
import { approvalLoop, control, expect, test, uniqueLoopName } from './fixtures.js';

/**
 * #562 against actual authenticated actors: an owned instance that requires API keys
 * (`/apps/credential-actors`, controlled setup in e2e/server.ts) holds two valid keys for one
 * disposable owner, and audits every request it answers by the label of the key presented. A real
 * second tab of the same browser stores the other key, so the inspector hears an actual `storage`
 * event. The API's own run events name the key it attributed each write to. The plaintext tokens
 * are typed into the page only; attachments carry labels and key IDs.
 */

const KEY_STORAGE = 'graphgoblin-api-key';
const closed = (trigger: string) =>
  `Review closed: this browser's API key changed. Nothing was sent. Open ${trigger} again to choose with the current key.`;
const requested = (action: string) =>
  `${action} was requested before this browser's API key changed. Its outcome isn't shown under the current key; check Runs before trying again.`;

interface Actor {
  keyId: string;
  token: string;
}
interface Instance {
  instanceId: string;
  url: string;
  a: Actor;
  b: Actor;
}
interface AuditEntry {
  method: string;
  path: string;
  status: number;
  actor: string;
}

async function credentialActors(request: APIRequestContext): Promise<Instance> {
  const created = await control(request, '/apps/credential-actors');
  const actors = created['actors'] as Record<'a' | 'b', Actor>;
  return {
    instanceId: String(created['instanceId']),
    url: String(created['url']),
    a: actors.a,
    b: actors.b,
  };
}

async function audit(request: APIRequestContext, instance: Instance): Promise<AuditEntry[]> {
  const result = await control(request, '/credential-audit', { instanceId: instance.instanceId });
  return result['entries'] as AuditEntry[];
}

/** Every write to a run the instance answered, as labels: never a token. */
async function runWrites(request: APIRequestContext, instance: Instance) {
  return (await audit(request, instance))
    .filter((entry) => entry.method !== 'GET' && entry.path.startsWith('/runs'))
    .map(({ method, path, actor, status }) => ({
      write: `${method} ${path}`,
      actor,
      accepted: status < 300,
    }));
}

const bearer = (actor: Actor) => ({ authorization: `Bearer ${actor.token}` });

async function publish(
  request: APIRequestContext,
  instance: Instance,
  definition: unknown,
): Promise<string> {
  const headers = bearer(instance.a);
  const created = await request.post(`${instance.url}/loops`, { headers, data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const published = await request.post(`${instance.url}/loops/${loop.id}/publish`, { headers });
  expect(published.status()).toBe(200);
  return loop.id;
}

interface RunRead {
  id: string;
  status: string;
  finalizedAt?: string;
}

async function readRun(request: APIRequestContext, instance: Instance, runId: string) {
  const response = await request.get(`${instance.url}/runs/${runId}`, {
    headers: bearer(instance.a),
  });
  return (await response.json()) as RunRead;
}

/** A run of `loopId` started by key A, once it reaches `status` (and, when finished, is final). */
async function startRun(
  request: APIRequestContext,
  instance: Instance,
  loopId: string,
  data: unknown,
  status: string,
): Promise<string> {
  const started = await request.post(`${instance.url}/loops/${loopId}/runs`, {
    headers: bearer(instance.a),
    data,
  });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect
    .poll(async () => (await readRun(request, instance, run.id)).status, { timeout: 30_000 })
    .toBe(status);
  if (status === 'succeeded')
    await expect
      .poll(async () => (await readRun(request, instance, run.id)).finalizedAt)
      .toBeTruthy();
  return run.id;
}

/** Opens `path` in a fresh browser and enters key `actor` in the API key panel it asks with. */
async function signIn(browser: Browser, instance: Instance, path: string, actor: Actor) {
  // No service worker: every request the page sends goes through Playwright's routing.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.goto(`${instance.url}/app${path}`);
  const key = page.getByLabel('API key', { exact: true });
  await expect(key).toBeVisible();
  await key.fill(actor.token);
  await page.getByRole('button', { name: 'Use key' }).click();
  await expect(page.getByRole('heading', { name: 'API key required' })).toHaveCount(0);
  // A real second tab of the same browser, on the same origin, shares its localStorage.
  const other = await context.newPage();
  await other.goto(`${instance.url}/app/settings`);
  await page.bringToFront();
  return { context, page, other };
}

/** The other tab stores `actor`'s key; the inspector's tab hears an actual `storage` event. */
async function storeInOtherTab(other: Page, page: Page, actor: Actor) {
  await other.evaluate(({ name, value }) => localStorage.setItem(name, value), {
    name: KEY_STORAGE,
    value: actor.token,
  });
  await page.bringToFront();
}

async function receipt(info: TestInfo, name: string, value: unknown) {
  const body = JSON.stringify(value, null, 2);
  await info.attach(name, { body, contentType: 'application/json' });
}

async function runEvents(request: APIRequestContext, instance: Instance, runId: string) {
  const response = await request.get(`${instance.url}/runs/${runId}/events`, {
    headers: bearer(instance.a),
  });
  return ((await response.json()) as { items: { type: string; actor?: unknown }[] }).items;
}

test('a key stored by another tab closes a review opened under the first key, sends nothing, and a fresh choice is sent once as the second key (#562)', async ({
  browser,
  request,
}, info) => {
  const instance = await credentialActors(request);
  const loopId = await publish(
    request,
    instance,
    approvalLoop(uniqueLoopName('Credential review')),
  );
  const runId = await startRun(
    request,
    instance,
    loopId,
    { triggerNodeId: 'start', input: {} },
    'waiting',
  );
  const { context, page, other } = await signIn(browser, instance, `/runs/${runId}`, instance.a);
  try {
    await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
    const replay = page.getByRole('button', { name: 'Replay...', exact: true });
    await replay.click();
    const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
    await expect(dialog).toBeVisible();
    expect(await runWrites(request, instance)).toEqual([]);

    await storeInOtherTab(other, page, instance.b);
    await expect(dialog).toBeHidden();
    await expect(page.getByText(closed('Replay...'), { exact: true })).toBeVisible();
    // Focus returns to the review's trigger, which is still enabled under the new key.
    await expect(replay).toBeEnabled();
    await expect(replay).toBeFocused();
    await page.screenshot({ path: info.outputPath('review-closed.png'), fullPage: true });
    // The inspector reads the run again under the second key; nothing was written.
    await expect
      .poll(async () =>
        (await audit(request, instance)).some(
          (entry) =>
            entry.method === 'GET' &&
            entry.path === `/runs/${runId}` &&
            entry.actor === 'actor-b' &&
            entry.status === 200,
        ),
      )
      .toBe(true);
    expect(await runWrites(request, instance)).toEqual([]);

    // A review opened again is a new one under the current key.
    await replay.click();
    await expect(dialog).toBeVisible();
    await expect(page.getByText(closed('Replay...'), { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Ordinary authorization is unchanged: no key, or an unknown key, writes nothing.
    expect((await request.post(`${instance.url}/runs/${runId}/pause`)).status()).toBe(401);
    expect(
      (
        await request.post(`${instance.url}/runs/${runId}/pause`, {
          headers: { authorization: 'Bearer gg_not_a_key_of_this_instance' },
        })
      ).status(),
    ).toBe(401);
    expect((await readRun(request, instance, runId)).status).toBe('waiting');

    // A fresh deliberate choice under the second key is sent once, as that key.
    await page.getByRole('button', { name: /Cancel run/ }).click();
    await expect
      .poll(() => runWrites(request, instance))
      .toEqual([
        { write: `POST /runs/${runId}/pause`, actor: 'none', accepted: false },
        { write: `POST /runs/${runId}/pause`, actor: 'unrecognised', accepted: false },
        { write: `POST /runs/${runId}/cancel`, actor: 'actor-b', accepted: true },
      ]);
    // The API's own record attributes the cancellation to key B, not only the header sent.
    await expect
      .poll(async () =>
        (await runEvents(request, instance, runId))
          .filter((event) => event.type === 'run.cancel_requested')
          .map((event) => event.actor),
      )
      .toEqual([{ kind: 'api-key', id: instance.b.keyId }]);
    await receipt(info, 'run-writes-by-actor', {
      keys: { 'actor-a': instance.a.keyId, 'actor-b': instance.b.keyId },
      writes: await runWrites(request, instance),
    });
  } finally {
    await context.close();
  }
});

test('a Replay sent under the first key stays one pending request through a switch to the second key, which shows neither its new run nor navigates to it (#562)', async ({
  browser,
  request,
}, info) => {
  const instance = await credentialActors(request);
  const loopId = await publish(request, instance, {
    ...minimalLoop(),
    name: uniqueLoopName('Credential sent replay'),
  });
  const runId = await startRun(request, instance, loopId, {}, 'succeeded');
  const { context, page, other } = await signIn(browser, instance, `/runs/${runId}`, instance.a);
  let release = () => {};
  try {
    await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
    const replay = page.getByRole('button', { name: 'Replay...', exact: true });
    await replay.click();
    const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
    await dialog.getByLabel('Replay from node').selectOption('done');
    const create = dialog.getByRole('button', { name: 'Create replay run' });
    await expect(create).toBeEnabled();
    // The API answers the Replay at once, under the key the page sent; the page gets the answer
    // only when released.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answers: { status: number; forkId?: string }[] = [];
    await page.route(`**/runs/${runId}/replay`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { run?: { id: string } };
      answers.push({ status: response.status(), ...(body.run ? { forkId: body.run.id } : {}) });
      await held;
      await route.fulfill({ response });
    });
    await create.click();
    await expect.poll(() => answers.length).toBe(1);
    expect(answers[0]!.status).toBe(202);
    const forkId = answers[0]!.forkId!;
    await expect(create).toBeDisabled();

    await storeInOtherTab(other, page, instance.b);
    await expect(dialog).toBeHidden();
    // Still pending: nothing else can be chosen until the request settles, and nothing was resent.
    await expect(replay).toBeDisabled();
    expect(await runWrites(request, instance)).toEqual([
      { write: `POST /runs/${runId}/replay`, actor: 'actor-a', accepted: true },
    ]);

    release();
    await expect(page.getByText(requested('Replay'), { exact: true })).toBeVisible();
    await expect(replay).toBeEnabled();
    // No navigation to the run created under the first key, and its ID is not shown.
    expect(new URL(page.url()).pathname).toBe(`/app/runs/${runId}`);
    await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(forkId);
    expect(await runWrites(request, instance)).toEqual([
      { write: `POST /runs/${runId}/replay`, actor: 'actor-a', accepted: true },
    ]);
    await page.screenshot({ path: info.outputPath('requested-before-change.png'), fullPage: true });
    await receipt(info, 'run-writes-by-actor', await runWrites(request, instance));
  } finally {
    release();
    await context.close();
  }
});

test('a refused Replay sent under the first key shows neither its error text nor the run it names under the second key (#562)', async ({
  browser,
  request,
}, info) => {
  const instance = await credentialActors(request);
  const loopId = await publish(request, instance, {
    ...minimalLoop(),
    name: uniqueLoopName('Credential refused replay'),
  });
  const runId = await startRun(request, instance, loopId, {}, 'succeeded');
  const { context, page, other } = await signIn(browser, instance, `/runs/${runId}`, instance.a);
  let release = () => {};
  try {
    await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
    const replay = page.getByRole('button', { name: 'Replay...', exact: true });
    await replay.click();
    const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
    await dialog.getByLabel('Replay from node').selectOption('done');
    // Another client admits the same Replay intent first, as key B.
    const observed = (await (
      await request.get(`${instance.url}/runs/${runId}`, { headers: bearer(instance.a) })
    ).json()) as { recovery: { observedSeq: number } };
    const first = await request.post(`${instance.url}/runs/${runId}/replay`, {
      headers: bearer(instance.b),
      data: { nodeId: 'done', observedSeq: observed.recovery.observedSeq },
    });
    expect(first.status()).toBe(202);
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answers: { status: number; detail?: string }[] = [];
    await page.route(`**/runs/${runId}/replay`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { detail?: string };
      answers.push({ status: response.status(), ...(body.detail ? { detail: body.detail } : {}) });
      await held;
      await route.fulfill({ response });
    });
    await dialog.getByRole('button', { name: 'Create replay run' }).click();
    await expect.poll(() => answers.length).toBe(1);
    expect(answers[0]!.status).toBe(409);
    const detail = answers[0]!.detail!;
    const named = /run (\S+?)\./.exec(detail)?.[1];
    expect(named).toBeTruthy();

    await storeInOtherTab(other, page, instance.b);
    await expect(dialog).toBeHidden();
    release();
    await expect(page.getByText(requested('Replay'), { exact: true })).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toContain(detail);
    expect(text).not.toContain(named!);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/app/runs/${runId}`);
    expect(await runWrites(request, instance)).toEqual([
      { write: `POST /runs/${runId}/replay`, actor: 'actor-b', accepted: true },
      { write: `POST /runs/${runId}/replay`, actor: 'actor-a', accepted: false },
    ]);
    await page.screenshot({ path: info.outputPath('refusal-not-shown.png'), fullPage: true });
    await receipt(info, 'run-writes-by-actor', await runWrites(request, instance));
  } finally {
    release();
    await context.close();
  }
});

test('a double click under the second key sends one Replay as that key and opens its run (#562)', async ({
  browser,
  request,
}, info) => {
  const instance = await credentialActors(request);
  const loopId = await publish(request, instance, {
    ...minimalLoop(),
    name: uniqueLoopName('Credential double click'),
  });
  const runId = await startRun(request, instance, loopId, {}, 'succeeded');
  const { context, page, other } = await signIn(browser, instance, `/runs/${runId}`, instance.a);
  try {
    await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
    await storeInOtherTab(other, page, instance.b);
    await expect
      .poll(async () =>
        (await audit(request, instance)).some(
          (entry) => entry.path === `/runs/${runId}` && entry.actor === 'actor-b',
        ),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Replay...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
    await dialog.getByLabel('Replay from node').selectOption('done');
    const response = page.waitForResponse((r) => r.url().endsWith(`/runs/${runId}/replay`));
    await dialog.getByRole('button', { name: 'Create replay run' }).dblclick();
    const answer = await response;
    expect(answer.status()).toBe(202);
    const fork = ((await answer.json()) as { run: { id: string } }).run.id;
    await expect(page).toHaveURL(new RegExp(`/app/runs/${fork}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(fork);
    expect(await runWrites(request, instance)).toEqual([
      { write: `POST /runs/${runId}/replay`, actor: 'actor-b', accepted: true },
    ]);
    await receipt(info, 'run-writes-by-actor', await runWrites(request, instance));
  } finally {
    await context.close();
  }
});
