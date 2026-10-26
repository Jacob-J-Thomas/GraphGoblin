import type { APIRequestContext, Response, Route } from '@playwright/test';
import type { LoopDefinitionInput, RunRecord, RunRecovery } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { control, expect, publishLoop, test } from './fixtures.js';
type Snapshot = RunRecord & { recovery: RunRecovery };
const read = async (request: APIRequestContext, id: string): Promise<Snapshot> =>
  (await request.get(`/runs/${id}`)).json() as Promise<Snapshot>;
function chain(name: string, work: LoopDefinitionInput['nodes'][number]): LoopDefinitionInput {
  const base = minimalLoop();
  return {
    ...base,
    name,
    nodes: [base.nodes[0]!, work, base.nodes[1]!],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: work.id } },
      { id: 'b', from: { node: work.id, port: 'out' }, to: { node: 'done' } },
    ],
  };
}
const inference = {
  id: 'think',
  kind: 'inference' as const,
  label: 'Think',
  config: { prompt: { template: 'Controlled recovery' } },
};
async function fail(request: APIRequestContext, loopId: string) {
  await control(request, '/harness/script', {
    turns: [
      {
        error: {
          code: 'usage_limit_reached',
          message: 'Controlled quota failure',
          retriable: true,
        },
      },
    ],
  });
  const response = await request.post(`/loops/${loopId}/runs`, { data: {} });
  expect(response.status()).toBe(202);
  const { run } = (await response.json()) as { run: RunRecord };
  await expect.poll(async () => (await read(request, run.id)).status).toBe('failed');
  return read(request, run.id);
}

test('child directs recovery to its parent; two tabs Resume the same parent and child exactly once', async ({
  page,
  context,
  request,
}, info) => {
  const childLoop = await publishLoop(request, chain('Recovery child', inference));
  const parentLoop = await publishLoop(
    request,
    chain('Recovery parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: childLoop } },
    }),
  );
  const parent = await fail(request, parentLoop);
  const { items } = (await (await request.get(`/runs?parent=${parent.id}`)).json()) as {
    items: RunRecord[];
  };
  const child = items[0]!;
  expect(items).toHaveLength(1);
  await page.goto(`/app/runs/${child.id}`);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
  const resumeReason = page.locator(`#resume-reason-${child.id}`);
  await expect(resumeReason).toBeVisible();
  await expect(resumeReason).toContainText(`Recovery belongs to parent run ${parent.id}`);
  await page.screenshot({ path: info.outputPath('child-recovery.png') });
  await page.getByRole('link', { name: `Open parent ${parent.id}` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(parent.id);
  const other = await context.newPage();
  await other.goto(`/app/runs/${parent.id}`);
  for (const tab of [page, other])
    await expect(tab.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await control(request, '/harness/script', { turns: [{ finalText: 'Recovered' }] });
  const routes: Route[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const tab of [page, other])
    await tab.route(`**/runs/${parent.id}/resume`, async (route) => {
      routes.push(route);
      if (routes.length === 2) release();
      await gate;
      await route.continue();
    });
  const responses = [page, other].map((tab) =>
    tab.waitForResponse((response) => response.url().endsWith(`/runs/${parent.id}/resume`)),
  );
  // Activate each actual tab as a user would; both HTTP requests remain held until released together.
  for (const tab of [page, other]) {
    await tab.bringToFront();
    await tab.getByRole('button', { name: 'Resume', exact: true }).click();
  }
  const results = await Promise.all(responses);
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect(await results.find((r) => r.status() === 409)!.json()).toMatchObject({
    code: 'RECOVERY_STALE',
  });
  await expect.poll(async () => (await read(request, parent.id)).status).toBe('succeeded');
  expect((await read(request, child.id)).status).toBe('succeeded');
  const children = (await (await request.get(`/runs?parent=${parent.id}`)).json()) as {
    items: RunRecord[];
  };
  expect(children.items.map((r) => r.id)).toEqual([child.id]);
  for (const id of [parent.id, child.id]) {
    const history = (await (await request.get(`/runs/${id}/events`)).json()) as {
      items: { type: string }[];
    };
    expect(history.items.filter((event) => event.type === 'run.resumed')).toHaveLength(1);
  }
  await page.bringToFront();
  await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
  expect(page.url()).toContain(`/runs/${parent.id}`);
  await page.screenshot({ path: info.outputPath('parent-resumed.png') });
  await other.close();
});

test('stale inspector Resume is refused after API recovery, with no second attempt', async ({
  page,
  request,
}) => {
  const loop = await publishLoop(request, chain('Stale recovery', inference));
  const run = await fail(request, loop);
  await page.goto(`/app/runs/${run.id}`);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  // Preserve the actual old server snapshot in this tab while the API advances the run.
  await page.route(`**/runs/${run.id}`, (route) => route.fulfill({ json: run }));
  await control(request, '/harness/script', { turns: [{ finalText: 'API recovered' }] });
  const response = await request.post(`/runs/${run.id}/resume`, {
    data: { observedSeq: run.recovery.observedSeq },
  });
  expect(response.status()).toBe(200);
  await expect.poll(async () => (await read(request, run.id)).status).toBe('succeeded');
  const refused = page.waitForResponse((r) => r.url().endsWith(`/runs/${run.id}/resume`));
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect((await refused).status()).toBe(409);
  await expect(
    page.getByRole('alert').filter({ hasText: 'changed since it was shown' }),
  ).toBeVisible();
  const history = (await (await request.get(`/runs/${run.id}/events`)).json()) as {
    items: { type: string }[];
  };
  expect(history.items.filter((event) => event.type === 'run.resumed')).toHaveLength(1);
  await page.unroute(`**/runs/${run.id}`);
  await page.reload();
  await page.bringToFront();
  await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
});

test('two tabs Replay one observed intent into one separate linked run; repeat clicks cannot add a fork', async ({
  page,
  context,
  request,
}, info) => {
  const loop = await publishLoop(request, { ...minimalLoop(), name: 'Replay identity' });
  const start = await request.post(`/loops/${loop}/runs`, { data: {} });
  const { run } = (await start.json()) as { run: RunRecord };
  await expect.poll(async () => (await read(request, run.id)).status).toBe('succeeded');
  const other = await context.newPage();
  for (const tab of [page, other]) {
    await tab.bringToFront();
    await tab.goto(`/app/runs/${run.id}`);
    await tab.getByRole('button', { name: 'Replay...', exact: true }).click();
    await expect(tab.getByRole('dialog', { name: 'Replay as a new run' })).toContainText('new id');
    await tab.getByLabel('Replay from node').selectOption('done');
  }
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const tab of [page, other])
    await tab.route(`**/runs/${run.id}/replay`, async (route) => {
      if (++count === 2) release();
      await gate;
      await route.continue();
    });
  const responses = [page, other].map((tab) =>
    tab.waitForResponse((r) => r.url().endsWith(`/runs/${run.id}/replay`)),
  );
  for (const tab of [page, other]) {
    await tab.bringToFront();
    await tab.getByRole('button', { name: 'Create replay run' }).click();
  }
  const results = await Promise.all(responses);
  expect(results.map((r) => r.status()).sort()).toEqual([202, 409]);
  const fork = ((await results.find((r) => r.status() === 202)!.json()) as { run: RunRecord }).run;
  expect(fork.id).not.toBe(run.id);
  const winner = results[0]!.status() === 202 ? page : other;
  await winner.bringToFront();
  await expect(winner).toHaveURL(new RegExp(`/app/runs/${fork.id}$`));
  await expect(winner.getByRole('heading', { level: 1 })).toContainText(fork.id);
  await expect(winner.getByText(`Replay run ${fork.id} from`, { exact: false })).toContainText(
    run.id,
  );
  const source = await read(request, run.id);
  expect(source.status).toBe('succeeded');
  const history = (await (await request.get(`/runs/${run.id}/events`)).json()) as {
    items: { type: string; replayRunId?: string }[];
  };
  expect(
    history.items
      .filter((event) => event.type === 'run.replay_requested')
      .map((event) => event.replayRunId),
  ).toEqual([fork.id]);
  const stale = await request.post(`/runs/${run.id}/replay`, {
    data: { observedSeq: source.recovery.observedSeq - 1, nodeId: 'done' },
  });
  expect(stale.status()).toBe(409);
  await winner.screenshot({ path: info.outputPath('replay-identity.png') });
  await other.close();
});

test('repeat browser clicks admit one Resume and one Replay intent and preserve the exact identities', async ({
  page,
  request,
}) => {
  const loop = await publishLoop(request, chain('Repeat recovery clicks', inference));
  const source = await fail(request, loop);
  await page.goto(`/app/runs/${source.id}`);
  await control(request, '/harness/script', {
    turns: [{ finalText: 'One deliberate continuation' }],
  });
  let resumeRequests = 0;
  const resumeResponses: Response[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith(`/runs/${source.id}/resume`)) resumeResponses.push(response);
  });
  let releaseResume!: () => void;
  const resumeGate = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  await page.route(`**/runs/${source.id}/resume`, async (route) => {
    resumeRequests++;
    await resumeGate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Resume', exact: true }).dblclick();
  await expect.poll(() => resumeRequests).toBeGreaterThan(0);
  releaseResume();
  await oneAcceptedIntent(resumeResponses, () => resumeRequests, 200);
  expect(
    (await resumeResponses.find((response) => response.status() === 200)!.json()) as RunRecord,
  ).toMatchObject({ id: source.id });
  await expect.poll(async () => (await read(request, source.id)).status).toBe('succeeded');
  expect(page.url()).toContain(`/runs/${source.id}`);
  await page.bringToFront();
  await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
  const before = await control(request, '/harness/requests');
  await page.getByRole('button', { name: 'Replay...', exact: true }).click();
  await page.getByLabel('Replay from node').selectOption('done');
  let replayRequests = 0;
  const replayResponses: Response[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith(`/runs/${source.id}/replay`)) replayResponses.push(response);
  });
  let releaseReplay!: () => void;
  const replayGate = new Promise<void>((resolve) => {
    releaseReplay = resolve;
  });
  await page.route(`**/runs/${source.id}/replay`, async (route) => {
    replayRequests++;
    await replayGate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Create replay run' }).dblclick();
  await expect.poll(() => replayRequests).toBeGreaterThan(0);
  releaseReplay();
  await oneAcceptedIntent(replayResponses, () => replayRequests, 202);
  const response = replayResponses.find((result) => result.status() === 202)!;
  const fork = ((await response.json()) as { run: RunRecord }).run;
  expect(fork.id).not.toBe(source.id);
  await expect(page).toHaveURL(new RegExp(`/app/runs/${fork.id}$`));
  await expect.poll(async () => (await read(request, fork.id)).status).toBe('succeeded');
  expect(await control(request, '/harness/requests')).toEqual(before);
  const history = (await (await request.get(`/runs/${source.id}/events`)).json()) as {
    items: { type: string }[];
  };
  expect(history.items.filter((event) => event.type === 'run.resumed')).toHaveLength(1);
  expect(history.items.filter((event) => event.type === 'run.replay_requested')).toHaveLength(1);
});

/** A double click can race the pending render; duplicate requests must be refused clearly. */
async function oneAcceptedIntent(
  responses: Response[],
  requests: () => number,
  accepted: 200 | 202,
) {
  await expect.poll(() => responses.length > 0 && responses.length === requests()).toBe(true);
  expect(requests()).toBeLessThanOrEqual(2);
  expect(responses.filter((response) => response.status() === accepted)).toHaveLength(1);
  for (const response of responses.filter((result) => result.status() !== accepted)) {
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'RECOVERY_STALE',
      detail: expect.stringContaining('changed since it was shown'),
    });
  }
}
