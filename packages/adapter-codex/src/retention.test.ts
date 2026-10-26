import { setImmediate as nextTask } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { CodexHarness, type CodexThreadLike } from './harness.js';

it('keeps no consumed stream step reachable, so a long progress stream holds bounded memory', async () => {
  const gc = globalThis.gc;
  if (!gc) throw new Error('This test needs Node started with --expose-gc (vitest.config.ts)');
  const count = 2_000;
  const yielded: WeakRef<object>[] = [];
  const thread: CodexThreadLike = {
    runStreamed: () =>
      Promise.resolve({
        events: (async function* () {
          yield await Promise.resolve({ type: 'thread.started', thread_id: 'retention-thread' });
          yield { type: 'turn.started' };
          for (let index = 0; index < count; index++) {
            // Progress the turn ignores: nothing needs this event once its step is consumed.
            const event = {
              type: 'item.updated',
              item: { id: 'progress', type: 'reasoning', text: String(index) },
            };
            yielded.push(new WeakRef(event));
            yield event;
          }
          yield {
            type: 'turn.completed',
            usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
          };
        })(),
      }),
  };
  const session = new CodexHarness({
    clientFactory: () => ({ startThread: () => thread, resumeThread: () => thread }),
  }).start(
    {
      workingDirectory: '/work',
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: 'Controlled progress stream; no provider call' },
    },
    new AbortController().signal,
  );
  for await (const event of session.events) void event;
  await session.result;
  // WeakRef targets stay alive until the job that created or read them ends.
  await nextTask();
  gc();
  const retained = yielded.filter((ref) => ref.deref() !== undefined).length;
  // The caller still holds the session, as the engine does until the node settles.
  await expect(session.sessionId).resolves.toBe('retention-thread');
  // Every one of them stays reachable when each step's wait outlives the step.
  expect(retained).toBeLessThan(count / 100);
});
