import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  RunRecordSchema,
  RunSnapshotSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { approvalLoop, expect, publishLoop, test, uniqueLoopName } from './fixtures.js';
import {
  boundCandidate,
  createOwnedInstance,
  expectExpiredReview,
  expectNoFurtherWritesForQuietSample,
  holdOwnedRequests,
  holdOwnedResponse,
  initialInspectorSettled,
  ownedControl,
  recordOwnedRequests,
  requireOwnedLoopback,
  setOwnedListener,
  type OwnedInstance,
} from './independent-416-420-helpers.js';

// Prepared against frozen6924c529, never imported as an executing spec during authoring.
// Root must bind final corrected source/build and allocate execution separately.
async function waitingRun(request: Parameters<typeof publishLoop>[0], instance: OwnedInstance) {
  const definition = LoopDefinitionSchema.parse(
    approvalLoop(uniqueLoopName('Independent listener')),
  );
  const ask = definition.nodes.find((node) => node.kind === 'wait');
  if (!ask || ask.kind !== 'wait' || ask.config.mode !== 'input')
    throw new Error('Missing public input wait fixture');
  ask.config = {
    ...ask.config,
    inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
  };
  const origin = requireOwnedLoopback(instance.url).origin;
  const id = await publishLoop(request, definition, origin);
  const started = await request.post(`${origin}/loops/${id}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const run = RunRecordSchema.parse((await started.json()).run);
  await expect
    .poll(
      async () =>
        RunSnapshotSchema.parse(await (await request.get(`${origin}/runs/${run.id}`)).json())
          .status,
    )
    .toBe('waiting');
  return RunSnapshotSchema.parse(await (await request.get(`${origin}/runs/${run.id}`)).json());
}

test('B1/B2 real listener close/reopen: same-body held run GET, expired replay, editable draft and one new consent', async ({
  page,
  request,
}, info) => {
  const binding = boundCandidate();
  const instance = await createOwnedInstance(request);
  const origin = requireOwnedLoopback(instance.url).origin;
  const run = await waitingRun(request, instance);
  const path = `/runs/${run.id}`;
  const log = recordOwnedRequests(page, origin);
  let held: Awaited<ReturnType<typeof holdOwnedRequests>> | undefined;
  try {
    await page.goto(`${origin}/app${path}`);
    await expect(page.getByRole('form', { name: 'Submit input', exact: true })).toBeVisible();
    await initialInspectorSettled(page, log, path);
    await page.getByLabel('note', { exact: true }).fill('Native listener draft');
    await page.getByRole('button', { name: 'Replay...', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Replay as a new run', exact: true });
    const confirm = review.getByRole('button', { name: 'Create replay run', exact: true });
    const replayNode = run.recovery.replay.find((node) => node.action.allowed)?.nodeId;
    if (!replayNode) throw new Error('Waiting source must expose a current allowed replay');
    await review.getByLabel('Replay from node', { exact: true }).selectOption(replayNode);
    await expect(confirm).toBeEnabled();
    const beforeWrites = log.writes().length;
    await setOwnedListener(ownedControl, request, instance, false);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Run ' + run.id, exact: true })).toBeVisible();
    await expectExpiredReview(review, confirm);
    await page.getByLabel('note', { exact: true }).fill('Native listener draft retained');
    await page
      .getByRole('form', { name: 'Submit input', exact: true })
      .evaluate((form) =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
    await expectNoFurtherWritesForQuietSample(page, log.writes, beforeWrites);
    held = await holdOwnedRequests(page, origin, 'GET', path);
    const readsAtRestore = log.rows.filter(
      (row) => row.method === 'GET' && row.path === path,
    ).length;
    await setOwnedListener(ownedControl, request, instance, true);
    expect((await request.get(`${origin}/healthz`)).status()).toBe(200);
    await expect.poll(held.captured).toBe(1);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit input', exact: true })).toBeDisabled();
    await expectExpiredReview(review, confirm);
    const response = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url() === origin + path &&
        response.status() === 200,
    );
    held.release();
    const fresh = await response;
    expect(await fresh.finished()).toBeNull();
    expect(RunSnapshotSchema.parse(await fresh.json())).toEqual(run);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeHidden();
    await expect(page.getByLabel('note', { exact: true })).toHaveValue(
      'Native listener draft retained',
    );
    await expectExpiredReview(review, confirm);
    await expect.poll(() => log.pendingReads()).toBe(0);
    const readBudget =
      log.rows.filter((row) => row.method === 'GET' && row.path === path).length - readsAtRestore;
    expect(readBudget).toBe(1);
    await expectNoFurtherWritesForQuietSample(page, log.writes, beforeWrites);
    // Old consent stays spent; this is a new review after the qualifying actual GET.
    await page.getByRole('button', { name: 'Replay...', exact: true }).click();
    await review.getByLabel('Replay from node', { exact: true }).selectOption(replayNode);
    const accepted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url() === origin + path + '/replay',
    );
    await confirm.click();
    expect((await accepted).status()).toBe(202);
    expect(log.writes()).toHaveLength(beforeWrites + 1);
    await info.attach('native-listener-schedule', {
      body: JSON.stringify({
        evidence:
          'Native owned API listener/in-memory store, scripted fake ports; controlled browser GET hold',
        binding,
        runId: run.id,
        sameBody: true,
        postRestoreRunReads: readBudget,
        requests: log.rows,
      }),
      contentType: 'application/json',
    });
  } finally {
    await setOwnedListener(ownedControl, request, instance, true);
    if (held) await held.close();
    log.stop();
  }
});

test('B2 short browser offline/online cannot unlock before the automatic matching run GET', async ({
  page,
  request,
}, info) => {
  const binding = boundCandidate();
  const instance = await createOwnedInstance(request);
  const origin = requireOwnedLoopback(instance.url).origin;
  const run = await waitingRun(request, instance);
  const path = `/runs/${run.id}`;
  const log = recordOwnedRequests(page, origin);
  let held: Awaited<ReturnType<typeof holdOwnedRequests>> | undefined;
  try {
    await page.goto(`${origin}/app${path}`);
    await initialInspectorSettled(page, log, path);
    await page.context().setOffline(true);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeVisible();
    held = await holdOwnedRequests(page, origin, 'GET', path);
    const before = log.writes().length;
    const reads = log.rows.filter((row) => row.method === 'GET' && row.path === path).length;
    await page.context().setOffline(false);
    expect((await request.get(`${origin}/healthz`)).status()).toBe(200);
    await expect.poll(held.captured).toBe(1);
    await expect(page.getByRole('button', { name: 'Submit input', exact: true })).toBeDisabled();
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeVisible();
    held.release();
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Submit input', exact: true })).toBeEnabled();
    await expect.poll(() => log.pendingReads()).toBe(0);
    expect(log.rows.filter((row) => row.method === 'GET' && row.path === path).length - reads).toBe(
      1,
    );
    await expectNoFurtherWritesForQuietSample(page, log.writes, before);
    await info.attach('browser-connectivity-schedule', {
      body: JSON.stringify({
        evidence:
          'Real listener remained healthy; browser context network disabled, actual automatic run GET held',
        requests: log.rows,
      }),
      contentType: 'application/json',
    });
  } finally {
    await page.context().setOffline(false);
    if (held) await held.close();
    log.stop();
  }
});

test('B3 native deletion dialog: an actual late preview cannot revive after a browser loss/recovery', async ({
  page,
  request,
}, info) => {
  const binding = boundCandidate();
  const instance = await createOwnedInstance(request);
  const origin = requireOwnedLoopback(instance.url).origin;
  const waiting = await waitingRun(request, instance);
  const path = `/runs/${waiting.id}`;
  expect(waiting.waiting).toBeDefined();
  const provided = await request.post(origin + path + '/input', {
    data: { waitId: waiting.waiting!.waitId, input: { note: 'completed' } },
  });
  expect(provided.status()).toBe(200);
  await expect
    .poll(
      async () => RunSnapshotSchema.parse(await (await request.get(origin + path)).json()).status,
    )
    .toBe('succeeded');
  const log = recordOwnedRequests(page, origin);
  let held: Awaited<ReturnType<typeof holdOwnedResponse>> | undefined;
  try {
    await page.goto(`${origin}/app${path}`);
    await initialInspectorSettled(page, log, path);
    held = await holdOwnedResponse(page, origin, 'POST', '/runs/deletion-eligibility/preview');
    await page.getByRole('button', { name: 'Review delete-ready history', exact: true }).click();
    const review = page.getByRole('dialog', {
      name: 'Mark selected history delete-ready?',
      exact: true,
    });
    const confirm = review.getByRole('button', {
      name: 'Confirm delete-ready selection',
      exact: true,
    });
    await expect.poll(held.arrived).toBe(1);
    await expect(confirm).toBeDisabled();
    await page.context().setOffline(true);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeHidden();
    held.release();
    await expect.poll(held.active).toBe(0);
    await expectExpiredReview(review, confirm);
    await page.keyboard.press('Escape');
    await expect(review).toBeHidden();
    expect(
      log.rows.filter((row) => row.method === 'POST' && row.path === '/runs/deletion-eligibility'),
    ).toHaveLength(0);
    // Reopening and cancelling a new native review preserves local reading and sends no confirm.
    await held.close();
    held = undefined;
    await page.getByRole('button', { name: 'Review delete-ready history', exact: true }).click();
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).toBeHidden();
    await info.attach('late-real-preview', {
      body: JSON.stringify({
        evidence:
          'Actual native preview response delayed in browser routing; context offline/online controlled',
        requests: log.rows,
      }),
      contentType: 'application/json',
    });
  } finally {
    await page.context().setOffline(false);
    if (held) await held.close();
    log.stop();
  }
});

test('B3 controlled script-consent record: native review expires across loss without any script API write', async ({
  page,
  request,
}, info) => {
  const binding = boundCandidate();
  const instance = await createOwnedInstance(request);
  const origin = requireOwnedLoopback(instance.url).origin;
  const run = await waitingRun(request, instance);
  const controlledTerminalAt = run.startedAt ?? run.createdAt;
  const path = `/runs/${run.id}`;
  const match = (url: URL) => url.origin === origin && url.pathname === path;
  await page.route(match, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const actual = RunSnapshotSchema.parse(await response.json());
    const controlled = RunSnapshotSchema.parse({
      ...actual,
      status: 'failed',
      finishedAt: controlledTerminalAt,
      finalizedAt: controlledTerminalAt,
      currentNodeId: 'approve',
      waiting: undefined,
      failure: {
        code: 'SCRIPT_OUTCOME_UNCERTAIN',
        message: 'Controlled browser consent input; no real script ran',
        nodeId: 'approve',
        resumable: true,
        script: { visitId: 'controlled-script-visit', state: 'outcome-uncertain' },
      },
      recovery: {
        ...actual.recovery,
        resume: { allowed: false, code: 'SCRIPT_CONSENT_REQUIRED', message: 'Controlled consent' },
        scriptConsent: { failureSeq: actual.recovery.observedSeq, nodeId: 'approve' },
        replay: [
          {
            nodeId: 'approve',
            label: 'Controlled script',
            action: {
              allowed: false,
              code: 'SCRIPT_CONSENT_REQUIRED',
              message: 'Controlled consent',
            },
            effects: [{ nodeId: 'approve', label: 'Controlled script', kind: 'script' }],
          },
        ],
      },
    });
    await route.fulfill({ response, json: controlled });
  });
  const log = recordOwnedRequests(page, origin);
  try {
    await page.goto(`${origin}/app${path}`);
    await initialInspectorSettled(page, log, path);
    await page.getByRole('button', { name: 'Recover script', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Recover script', exact: true });
    const confirm = review.getByRole('button', { name: 'Resume', exact: true });
    await expect(confirm).toBeEnabled();
    await page.context().setOffline(true);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeVisible();
    await expectExpiredReview(review, confirm);
    await page.context().setOffline(false);
    await expect(page.getByText(binding.lastObservedText, { exact: true })).toBeHidden();
    await expectExpiredReview(review, confirm);
    expect(log.writes()).toHaveLength(0);
    await info.attach('controlled-script-consent', {
      body: JSON.stringify({
        evidence:
          'Native browser/dialog over real owned API; explicitly schema-valid controlled run GET consent fields, no real script/provider execution or server acceptance claimed',
        requests: log.rows,
      }),
      contentType: 'application/json',
    });
  } finally {
    await page.context().setOffline(false);
    await page.unroute(match);
    log.stop();
  }
});

test('S2 browser supplement: real engine/API large fake result renders boundedly; cost is observational', async ({
  page,
  request,
}, info) => {
  boundCandidate();
  const instance = await createOwnedInstance(request);
  const origin = requireOwnedLoopback(instance.url).origin;
  const payload = {
    rows: Array.from({ length: 8192 }, (_, index) => ({ index, value: 'x'.repeat(112) })),
  };
  const text = JSON.stringify(payload);
  await ownedControl(request, '/harness/script', {
    instanceId: instance.instanceId,
    turns: [
      {
        finalText: text,
        items: [{ id: 'controlled', type: 'message', summary: 'Large fake result' }],
      },
    ],
  });
  const definition: LoopDefinitionInput = {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: uniqueLoopName('Independent bounded result'),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Fake inference',
        config: {
          harness: 'codex',
          prompt: { template: 'Controlled fake only' },
          output: { captureTranscript: 'none', toMessages: 'none' },
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const loop = await publishLoop(request, definition, origin);
  const started = await request.post(`${origin}/loops/${loop}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const run = RunRecordSchema.parse((await started.json()).run);
  const path = `/runs/${run.id}`;
  await expect
    .poll(
      async () => RunSnapshotSchema.parse(await (await request.get(origin + path)).json()).status,
    )
    .toBe('succeeded');
  await page.addInitScript(() => {
    Reflect.set(window, '__i5LongTasks', []);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
      new PerformanceObserver((list) => {
        const values = Reflect.get(window, '__i5LongTasks') as unknown[];
        values.push(
          ...list
            .getEntries()
            .map((entry) => ({ start: entry.startTime, duration: entry.duration })),
        );
      }).observe({ type: 'longtask', buffered: true });
  });
  const bodyRead = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url() === origin + path &&
      response.status() === 200,
  );
  const begin = performance.now();
  await page.goto(`${origin}/app${path}`);
  const response = await bodyRead;
  const snapshot = RunSnapshotSchema.parse(await response.json());
  expect(snapshot.result).toEqual(payload);
  await expect(page.getByTestId('run-result')).toBeVisible();
  const elapsed = performance.now() - begin;
  const shownText = await page.getByTestId('run-result').innerText();
  expect(shownText.length).toBeLessThan(12000);
  const longTasks: unknown = await page.evaluate((): unknown =>
    Reflect.get(window, '__i5LongTasks'),
  );
  await info.attach('large-result-observation', {
    body: JSON.stringify({
      evidence:
        'Real engine/API scripted FakeHarness result; bounded browser display. No performance pass threshold.',
      resultBytes: Buffer.byteLength(text),
      resultSha256: createHash('sha256').update(text).digest('hex'),
      navigationToVisibleMs: elapsed,
      longTasks,
      shownCharacters: shownText.length,
    }),
    contentType: 'application/json',
  });
});
