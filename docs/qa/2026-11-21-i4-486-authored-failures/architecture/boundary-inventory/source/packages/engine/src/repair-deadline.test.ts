import { afterEach, expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/index.js';

let e: TestEngine | undefined;
afterEach(async () => {
  vi.useRealTimers();
  e?.manager.stop();
  if (e) {
    for (const row of await e.ports.runs.listRecoveryCandidates()) await e.manager.cancel(row.id);
    await e.manager.waitForIdle();
  }
});

it('retains the structured repair provider, resolved model and effort on an inference transform timeout', async () => {
  e = await createTestEngine();
  e.ports.harness.script([{ finalText: 'bad' }]);
  let completionRequest: unknown;
  e.ports.structured = {
    complete: (request, signal) => {
      completionRequest = request;
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () =>
            reject(
              signal.reason instanceof Error ? signal.reason : new Error('completion aborted'),
            ),
          { once: true },
        ),
      );
    },
  };
  const definition = singleNodeLoop('Transform deadline provenance', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: {
      prompt: { template: 'Answer' },
      effort: 'low',
      output: {
        transforms: [
          {
            op: 'coerce',
            source: '/lastOutput/value',
            target: '/vars/value',
            jsonSchema: { type: 'number' },
            repair: { enabled: true, maxAttempts: 1 },
          },
        ],
      },
    },
  });
  definition.settings = {
    structuredTimeoutMs: 50,
    defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'high' } } },
  };
  const run = await e.runToIdle(e.publish(definition).loopId);
  expect(e.ports.harness.started[0]?.effort).toBe('low');
  expect(completionRequest).toMatchObject({ model: 'gpt-6-luna', effort: 'high' });
  process.stdout.write(JSON.stringify({ kind: 'output-transform', failure: run.failure }) + '\n');
  expect(run.status).toBe('failed');
  expect(run.failure).toMatchObject({
    code: 'STRUCTURED_COMPLETION_TIMEOUT',
    nodeId: 'infer',
    details: {
      timeoutMs: 50,
      provenance: {
        kind: 'llm',
        provider: 'codex',
        classifierId: null,
        model: 'gpt-6-luna',
        effort: 'high',
      },
    },
  });
});

it.each([false, true])(
  'same-session schema repair follows node timeout (configured: %s), independently of the structured-port deadline',
  async (bounded) => {
    e = await createTestEngine();
    let inferenceStartedAt = Number.NaN;
    e.ports.harness.script([
      {
        finalText: 'bad',
        match: () => {
          inferenceStartedAt = Date.now();
          return true;
        },
      },
      { finalText: '7', delayMs: 2000 },
    ]);
    let structuredCalls = 0;
    e.ports.structured = {
      complete: () => {
        structuredCalls += 1;
        return Promise.resolve({ value: 7 });
      },
    };
    const definition = singleNodeLoop('Same-session repair boundary', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: {
        prompt: { template: 'Answer' },
        ...(bounded ? { timeoutSeconds: 1 } : {}),
        output: {
          schema: { jsonSchema: { type: 'number' }, repair: { enabled: true, maxAttempts: 1 } },
        },
      },
    });
    definition.settings = { structuredTimeoutMs: 50 };
    vi.useFakeTimers();
    const started = await e.start(e.publish(definition).loopId);
    // The manager yields between nodes. Record the public harness invocation's clock,
    // then let waitFor advance those scheduler turns before checking the deadline itself.
    await vi.waitFor(() => expect(e!.ports.harness.resumed).toHaveLength(1));
    expect(Number.isFinite(inferenceStartedAt)).toBe(true);
    await vi.advanceTimersByTimeAsync(Math.max(0, inferenceStartedAt + 51 - Date.now()));
    expect((await e.ports.runs.get(started.id))?.status).toBe('running');
    if (bounded) {
      const remaining = inferenceStartedAt + 999 - Date.now();
      expect(remaining).toBeGreaterThanOrEqual(0);
      await vi.advanceTimersByTimeAsync(remaining);
      expect((await e.ports.runs.get(started.id))?.status).toBe('running');
      await vi.advanceTimersByTimeAsync(1);
    } else await vi.runAllTimersAsync();
    const run = await e.settle(started.id);
    expect(structuredCalls).toBe(0);
    process.stdout.write(
      JSON.stringify({
        kind: 'same-session-schema',
        bounded,
        elapsedMs: Date.now() - inferenceStartedAt,
        status: run.status,
        failure: run.failure,
      }) + '\n',
    );
    expect(run.status).toBe(bounded ? 'failed' : 'succeeded');
    if (bounded) {
      expect(run.failure).toMatchObject({
        code: 'INFERENCE_TIMEOUT',
        inference: { promptKind: 'repair' },
      });
      expect(e.ports.harness.cancelled).toHaveLength(1);
    } else expect((await e.manager.getThread(run.id))?.lastOutput?.value).toBe(7);
  },
);
