import { expect, it } from 'vitest';
import { failureCases } from '@graphgoblin/engine/testing';
import type { HarnessEvent, HarnessStartRequest } from '@graphgoblin/engine';
import { CodexHarness } from './harness.js';

const request: HarnessStartRequest = {
  workingDirectory: '/work',
  options: { sandbox: 'read-only', approval: 'never' },
  turn: { prompt: 'Exact repair' },
};
const cases = failureCases.flatMap((spec) =>
  (['sync', 'promise', 'iterator', 'failed', 'error'] as const).flatMap((source) =>
    [false, true].flatMap((retriable) =>
      (source === 'sync' || source === 'promise' ? [false] : [false, true]).flatMap((accepted) =>
        [false, true].map((explicit) => ({
          spec,
          source,
          retriable,
          accepted,
          explicit,
        })),
      ),
    ),
  ),
);
it.each(cases)(
  'preserves $spec.code at $source retry=$retriable accepted=$accepted explicit=$explicit',
  async ({ spec, source, retriable, accepted, explicit }) => {
    const failure = {
      code: spec.code,
      message: 'Later selected cause',
      retriable,
      ...(explicit ? { submission: spec.state } : {}),
    };
    const harness = new CodexHarness({
      clientFactory: () => ({
        startThread: () => {
          throw new Error('Expected resume');
        },
        resumeThread: () => {
          if (source === 'sync') throw Object.assign(new Error(failure.message), failure);
          return {
            runStreamed: () => {
              if (source === 'promise')
                return Promise.reject(Object.assign(new Error(failure.message), failure));
              return Promise.resolve({
                events: (async function* () {
                  if (accepted) yield { type: 'turn.started' };
                  yield {
                    type: 'error',
                    message: 'Not logged in',
                    code: 'HARNESS_NOT_AUTHENTICATED',
                    retriable: true,
                  };
                  if (source === 'iterator')
                    throw await Promise.resolve(Object.assign(new Error(failure.message), failure));
                  if (source === 'failed') yield { type: 'turn.failed', error: failure };
                  else yield { type: 'error', ...failure };
                  throw new Error('Generic final wrapper');
                })(),
              });
            },
          };
        },
      }),
    });
    if (source === 'sync') {
      expect(() => harness.resume('own-session', request, new AbortController().signal)).toThrow(
        failure.message,
      );
      return;
    }
    const session = harness.resume('own-session', request, new AbortController().signal);
    const events: HarnessEvent[] = [];
    for await (const event of session.events) events.push(event);
    // Without explicit metadata a generic wrapper loses to the earlier ordinary auth cause.
    const earlierAuth = !explicit && spec.code === 'HARNESS_TURN_FAILED' && source !== 'promise';
    const code = earlierAuth ? 'HARNESS_NOT_AUTHENTICATED' : spec.code;
    const retry = earlierAuth ? true : retriable;
    const fallback = [
      'HARNESS_NOT_AUTHENTICATED',
      'HARNESS_NOT_INSTALLED',
      'HARNESS_ARGUMENTS_REJECTED',
    ].includes(code)
      ? 'definitely-not-submitted'
      : 'delivery-uncertain';
    const state =
      code === 'HARNESS_TERMINATION_UNCONFIRMED'
        ? 'delivery-uncertain'
        : code === 'HARNESS_SESSION_MISSING'
          ? 'session-missing'
          : explicit
            ? spec.state
            : fallback;
    const submission =
      accepted && state === 'definitely-not-submitted' ? 'delivery-uncertain' : state;
    expect(events.at(-1)).toMatchObject({ type: 'error', code, retriable: retry, submission });
    await expect(session.result).rejects.toMatchObject({ code, retriable: retry, submission });
  },
);
