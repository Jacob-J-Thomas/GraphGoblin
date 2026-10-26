import { expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import {
  FakeHarness,
  expectedFailure,
  failureCases,
  failureLoop,
  recordingModes,
} from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

const matrix = failureCases.flatMap((spec) =>
  (['launch', 'promise', 'iterator', 'failed', 'error'] as const).flatMap((source) =>
    [false, true].flatMap((retriable) =>
      recordingModes.map((storage) => ({ spec, source, retriable, storage })),
    ),
  ),
);

it.each(matrix)(
  'keeps SDK/SQLite $spec.code at $source retry=$retriable storage=$storage',
  async ({ spec, source, retriable, storage }) => {
    const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }]);
    const calls: string[] = [];
    const failure = () =>
      Object.assign(new Error('Selected ' + spec.code), {
        code: spec.code,
        retriable,
        ...(spec.state === 'definitely-not-submitted' ? { submission: spec.state } : {}),
      });
    const sdk = new CodexHarness({
      clientFactory: () => ({
        startThread: () => {
          throw new Error('Expected repair resume');
        },
        resumeThread: () => {
          if (source === 'launch') throw failure();
          return {
            runStreamed: () =>
              source === 'promise'
                ? Promise.reject(failure())
                : Promise.resolve({
                    events: (async function* () {
                      // Exercise the adapter's own precedence before the engine's durable fold.
                      if (!spec.eligible)
                        yield {
                          type: 'error',
                          code: 'HARNESS_NOT_AUTHENTICATED',
                          message: 'Earlier auth',
                          retriable: true,
                        };
                      if (source === 'iterator') throw await Promise.resolve(failure());
                      if (source === 'failed') yield { type: 'turn.failed', error: failure() };
                      else yield { type: 'error', ...failure(), message: failure().message };
                      throw new Error('Generic final wrapper');
                    })(),
                  }),
          };
        },
      }),
    });
    const harness: HarnessPort = {
      id: 'codex',
      preflight: () => fake.preflight(),
      start(request, signal) {
        calls.push(request.turn.prompt);
        return fake.start(request, signal);
      },
      resume(id, request, signal) {
        calls.push(request.turn.prompt);
        return calls.length === 2
          ? sdk.resume(id, request, signal)
          : fake.resume(id, request, signal);
      },
    };
    const expected = expectedFailure(
      spec,
      source === 'launch' ? 'launch' : 'result',
      'codex',
      retriable,
    );
    const test = await createTestApp({ harnesses: { codex: harness } });
    const events = test.container.ports.events;
    let fired = false;
    test.container.ports.events = {
      async append(id, drafts, options) {
        if (
          storage !== 'ok' &&
          !fired &&
          calls.length === 2 &&
          drafts.some((d) => d.type === 'harness.submission' && d.submission === expected.state)
        ) {
          fired = true;
          if (storage === 'after') await events.append(id, drafts, options);
          throw new Error('SDK classification append ' + storage);
        }
        return events.append(id, drafts, options);
      },
      read: (...args) => events.read(...args),
      subscribe: (...args) => events.subscribe(...args),
    };
    try {
      const loopId = await test.publishLoop(failureLoop('codex'));
      const started = await test.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      expect(started.statusCode).toBe(202);
      const id = started.json<{ run: { id: string } }>().run.id;
      await test.idle();
      const run = (await test.app.inject({ method: 'GET', url: `/runs/${id}` })).json<RunRecord>();
      expect.soft(run.failure).toMatchObject({
        code: expected.code,
        resumable: expected.resumable,
        inference: { promptKind: 'repair', submission: expected.state },
      });
      if (storage !== 'ok') {
        expect.soft(fired).toBe(true);
        expect.soft(run.failure?.details).toMatchObject({ recording: expect.any(Array) });
      }
      const resumed = await test.app.inject({
        method: 'POST',
        url: `/runs/${id}/resume`,
        payload: { observedSeq: (await test.container.manager.getRecovery(id)).observedSeq },
      });
      await test.idle();
      expect.soft(resumed.statusCode).toBe(expected.resumable ? 200 : 409);
      expect.soft(calls.length).toBe(expected.resumable ? 3 : 2);
      if (expected.resumable)
        expect(calls.at(-1)).toBe(
          expected.state === 'definitely-not-submitted'
            ? 'Repair exactly: "invalid"'
            : 'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
        );
    } finally {
      await test.close();
    }
  },
);
