import {
  assert,
  api,
  state,
  create,
  startRun,
  newStore,
  launch,
  stop,
  removeStore,
  report,
} from './qa-lib.mjs';
const r = report('claude'),
  data = await newStore('claude'),
  port = 5907;
let server;
const call = (method, path, body) => api(method, path, body, port);
export function inferenceDefinition(mode) {
  return {
    schemaVersion: 4,
    name: 'QA native Claude ' + mode,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          harness: 'claude',
          model: 'claude-opus-5-5',
          effort: 'high',
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: 'QA fake only' },
          output: { captureTranscript: 'artifact', toMessages: 'none' },
          ...(mode === 'stall' ? { timeoutSeconds: 10 } : {}),
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}
try {
  server = await launch(data, 'claude', port);
  await r.check('native large result, bounded detail, no max-turns or per-turn timer', async () => {
    await call('POST', '/qa/mode', { mode: 'large' });
    const run = await startRun(await create(inferenceDefinition('large'), port), port),
      done = await state(run.id, 'succeeded', port);
    assert.equal(done.result.length, 20000);
    const transcript = await call('GET', `/qa/transcript/${run.id}`),
      text = transcript.items.find((x) => x.type === 'message').detail.text;
    assert.equal(text.length, 16384);
    const observations = await call('GET', '/qa/observations');
    assert.equal(observations.facts.at(-1).maxTurns, false);
    assert.equal(observations.facts.at(-1).timeoutMs, null);
    return {
      runId: run.id,
      finalChars: done.result.length,
      detailChars: text.length,
      request: observations.facts.at(-1),
    };
  });
  await r.check('validated result submission is observable before native exit', async () => {
    await call('POST', '/qa/mode', { mode: 'result-only' });
    const run = await startRun(await create(inferenceDefinition('result-only'), port), port);
    await state(run.id, 'succeeded', port);
    const fact = (await call('GET', '/qa/observations')).facts.at(-1);
    assert.equal(fact.marker, 'claude.result');
    assert(fact.acceptedAt < fact.returnedAt);
    return { fact, acceptanceBeforeReturnMs: fact.returnedAt - fact.acceptedAt };
  });
  for (const [mode, code] of [
    ['transport', 'HARNESS_TRANSPORT_FAILED'],
    ['quota', 'HARNESS_QUOTA_EXHAUSTED'],
    ['auth', 'HARNESS_NOT_AUTHENTICATED'],
    ['overflow', 'HARNESS_OUTPUT_LIMIT'],
    ['stall', 'INFERENCE_TIMEOUT'],
  ])
    await r.check('native ' + mode + ' failure and one invocation', async () => {
      await call('POST', '/qa/mode', { mode });
      const before = (await call('GET', '/qa/observations')).facts.length,
        begin = Date.now();
      const run = await startRun(await create(inferenceDefinition(mode), port), port),
        failed = await state(run.id, 'failed', port);
      assert.equal(failed.failure.code, code);
      const o = await call('GET', '/qa/observations');
      assert.equal(o.facts.length - before, 1);
      return {
        elapsedMs: Date.now() - begin,
        failure: failed.failure,
        invocations: o.facts.length - before,
        fact: o.facts.at(-1),
      };
    });
  r.data.nativeLog = await call('GET', '/qa/observations');
} finally {
  if (server) r.data.lifecycle.push(await stop(server));
  r.data.cleanup = await removeStore(data);
  await r.finish();
}
