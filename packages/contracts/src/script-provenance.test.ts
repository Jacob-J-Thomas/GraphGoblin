import { describe, expect, it } from 'vitest';
import { RunEventSchema, RunFailureSchema } from './index.js';
import { fakeUlid } from './testing/index.js';

describe('script provenance (#321)', () => {
  const dispatchId = fakeUlid('dispatch');
  it.each(['definitely-not-started', 'outcome-uncertain', 'completed'] as const)(
    'accepts %s failure provenance',
    (state) => {
      const failure = {
        code:
          state === 'completed'
            ? 'SCRIPT_EXIT_CODE'
            : state === 'outcome-uncertain'
              ? 'SCRIPT_OUTCOME_UNCERTAIN'
              : 'SCRIPT_START_FAILED',
        message: 'script disposition',
        resumable: true,
        script: {
          visitId: 'run:4',
          dispatchId,
          state,
          ...(state === 'completed' ? { exitCode: 7 } : {}),
        },
      };
      expect(RunFailureSchema.parse(failure)).toEqual(failure);
    },
  );
  it('accepts a pre-dispatch refusal without a dispatch ID and refuses malformed provenance', () => {
    const failure = {
      code: 'SCRIPT_START_FAILED',
      message: 'not started',
      resumable: true,
      script: { visitId: 'run:4', state: 'definitely-not-started' },
    };
    expect(RunFailureSchema.parse(failure)).toEqual(failure);
    for (const script of [
      { ...failure.script, state: 'unknown' },
      { ...failure.script, visitId: '' },
      { ...failure.script, dispatchId: 'invalid' },
      { ...failure.script, exitCode: 0.5 },
      { ...failure.script, hidden: true },
    ])
      expect(RunFailureSchema.safeParse({ ...failure, script }).success).toBe(false);
  });
  it('keeps dispatch identity and node binding in a strict durable event', () => {
    const event = {
      runId: fakeUlid('run'),
      seq: 5,
      ts: '2026-10-22T00:00:00.000Z',
      type: 'script.dispatched',
      nodeId: 'script',
      visitId: 'run:4',
      dispatchId,
    };
    expect(RunEventSchema.parse(event)).toEqual(event);
    for (const change of [
      { dispatchId: 'invalid' },
      { nodeId: '' },
      { visitId: '' },
      { extra: true },
    ])
      expect(RunEventSchema.safeParse({ ...event, ...change }).success).toBe(false);
  });
});
