import {
  assert,
  api,
  raw,
  state,
  create,
  startRun,
  waitDefinition,
  cycleDefinition,
  newStore,
  launch,
  stop,
  removeStore,
  report,
  until,
  delay,
} from './qa-lib.mjs';
const r = report('api'),
  data = await newStore('api');
let server;
try {
  server = await launch(data);
  await r.check('published omitted defaults pin', async () => {
    const run = await startRun(await create(waitDefinition()));
    await state(run.id, 'waiting');
    assert.deepEqual(run.pinned.limits, { maxNodeVisits: 10, runDeadlineSeconds: null });
    await api('POST', `/runs/${run.id}/cancel`, {});
    return { pin: run.pinned.limits };
  });
  await r.check('five-second input deadline and correctly shaped late input', async () => {
    const run = await startRun(
      await create(waitDefinition('QA 5 second wait', { runDeadlineSeconds: 5 })),
    );
    const w = await state(run.id, 'waiting'),
      f = await state(run.id, 'failed');
    assert.equal(f.failure.code, 'RUN_DEADLINE_EXCEEDED');
    assert.equal(f.failure.resumable, false);
    const late = await raw('POST', `/runs/${run.id}/input`, {
      waitId: w.waiting.waitId,
      input: true,
    });
    assert.equal(late.status, 409);
    const resume = await raw('POST', `/runs/${run.id}/resume`, {});
    assert(resume.status >= 400);
    await delay(250);
    assert.equal((await api('GET', '/runs/' + run.id)).failure.code, 'RUN_DEADLINE_EXCEEDED');
    return {
      elapsedMs: Date.parse(f.finishedAt) - Date.parse(f.startedAt),
      failure: f.failure,
      lateInput: late,
      resume,
    };
  });
  await r.check('paused authored deadline survives kill and native restart', async () => {
    const run = await startRun(
      await create(waitDefinition('QA paused deadline', { runDeadlineSeconds: 5 })),
    );
    await state(run.id, 'waiting');
    await api('POST', `/runs/${run.id}/pause`, {});
    const before = await api('GET', '/runs/' + run.id);
    r.data.lifecycle.push(await stop(server, true));
    server = undefined;
    await delay(5500);
    server = await launch(data);
    const after = await state(run.id, 'failed');
    assert.equal(after.failure.code, 'RUN_DEADLINE_EXCEEDED');
    assert.equal(after.startedAt, before.startedAt);
    assert.deepEqual(after.pinned.limits, before.pinned.limits);
    return {
      before: { status: before.status, startedAt: before.startedAt, limits: before.pinned.limits },
      after: { status: after.status, startedAt: after.startedAt, limits: after.pinned.limits },
      absoluteDeadline: new Date(Date.parse(after.startedAt) + 5000).toISOString(),
    };
  });
  await r.check('default input wait survives native restart without a deadline', async () => {
    const run = await startRun(await create(waitDefinition('QA default no deadline')));
    await state(run.id, 'waiting');
    r.data.lifecycle.push(await stop(server, true));
    server = undefined;
    server = await launch(data);
    await delay(7000);
    const w = await state(run.id, 'waiting');
    assert.equal(w.pinned.limits.runDeadlineSeconds, null);
    await api('POST', `/runs/${run.id}/cancel`, {});
    return {
      pin: w.pinned.limits,
      observation:
        '7 seconds after native restart; engine focused run separately advances 24 hours',
    };
  });
  await r.check('Unlimited marked repeat gate exceeds twenty visits and cancels', async () => {
    const run = await startRun(await create(cycleDefinition()));
    const thread = await until(async () => {
      const t = await api('GET', `/runs/${run.id}/thread`);
      return t.counters.nodeVisits.work > 20 && t;
    });
    const start = Date.now();
    await api('POST', `/runs/${run.id}/cancel`, {});
    await state(run.id, 'cancelled');
    return {
      visits: thread.counters.nodeVisits.work,
      pin: run.pinned.limits,
      cancelMs: Date.now() - start,
    };
  });
  for (const [code, submission, retriable, expected] of [
    ['HARNESS_TRANSPORT_FAILED', 'definitely-not-submitted', true, 2],
    ['HARNESS_TRANSPORT_FAILED', 'delivery-uncertain', true, 1],
    ['HARNESS_TRANSPORT_FAILED', 'definitely-not-submitted', false, 1],
    ['HARNESS_QUOTA_EXHAUSTED', 'definitely-not-submitted', true, 1],
    ['HARNESS_NOT_AUTHENTICATED', 'definitely-not-submitted', false, 1],
    ['HARNESS_TIMEOUT', 'definitely-not-submitted', false, 1],
    ['HARNESS_OUTPUT_LIMIT', 'delivery-uncertain', false, 1],
  ])
    await r.check(`retry ${code} ${submission} retriable=${retriable}`, async () => {
      const before = (await api('GET', '/qa/requests')).count;
      await api('POST', '/qa/script', {
        turns: Array.from({ length: 3 }, () => ({
          announceSession: false,
          submission,
          error: { code, message: 'QA synthetic failure', retriable },
        })),
      });
      const def = waitDefinition('QA retry ' + code);
      def.nodes[1] = {
        id: 'ask',
        kind: 'inference',
        label: 'Ask',
        config: { prompt: { template: 'QA original authored task' } },
      };
      const run = await startRun(await create(def)),
        f = await state(run.id, 'failed'),
        count = (await api('GET', '/qa/requests')).count - before;
      assert.equal(count, expected);
      return { invocations: count, failure: f.failure };
    });
} finally {
  if (server) r.data.lifecycle.push(await stop(server));
  r.data.cleanup = await removeStore(data);
  await r.finish();
}
