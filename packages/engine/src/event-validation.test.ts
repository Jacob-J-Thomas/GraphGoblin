import { describe, expect, it } from 'vitest';
import { RunFailureSchema, WaitSpecSchema, PROGRESS_SUMMARY_MAX } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { boundedFailure, validateGeneratedEvent } from './event-validation.js';

const base = { runId: fakeUlid('validation'), seq: 1, ts: FIXTURE_TS };
describe('generated event validation', () => {
  it.each(['run.failed', 'run.waiting', 'node.progress'])(
    'validates the exact bound of %s and rejects one character over',
    (type) => {
      const bound =
        type === 'run.failed'
          ? RunFailureSchema.shape.message.maxLength!
          : type === 'run.waiting'
            ? WaitSpecSchema.shape.prompt.unwrap().maxLength!
            : PROGRESS_SUMMARY_MAX;
      const event = (length: number) => ({
        ...base,
        type,
        ...(type === 'run.failed'
          ? { failure: { code: 'INTERNAL_ERROR', message: 'x'.repeat(length), resumable: false } }
          : type === 'run.waiting'
            ? {
                nodeId: 'work',
                wait: { nodeId: 'work', kind: 'input', prompt: 'x'.repeat(length) },
              }
            : {
                nodeId: 'work',
                progress: { item: { id: 'item', type: 'message', summary: 'x'.repeat(length) } },
              }),
      });
      expect(validateGeneratedEvent(event(bound))).toEqual(event(bound));
      expect(() => validateGeneratedEvent(event(bound + 1))).toThrow(
        expect.objectContaining({ code: 'EVENT_INVALID', options: { resumable: false } }),
      );
    },
  );
  it('rejects an unknown node.failed variant and malformed records', () => {
    for (const value of [null, {}, { ...base, type: 'node.failed', nodeId: 'work' }]) {
      expect(() => validateGeneratedEvent(value)).toThrow(
        expect.objectContaining({ code: 'EVENT_INVALID' }),
      );
    }
  });
  it('leaves exact-bound failures unchanged, bounds longer diagnostics visibly, and handles invalid metadata', () => {
    const bound = RunFailureSchema.shape.message.maxLength!;
    const failure = {
      code: 'INTERNAL_ERROR' as const,
      message: 'x'.repeat(bound),
      resumable: true,
    };
    expect(boundedFailure(failure)).toEqual(failure);
    const bounded = boundedFailure({ ...failure, message: 'x'.repeat(bound + 1) });
    expect(bounded.message).toHaveLength(bound);
    expect(bounded.message).toContain(`[truncated; original ${bound + 1} characters]`);
    expect(boundedFailure({ ...failure, nodeId: 'invalid id' })).toMatchObject({
      code: 'EVENT_INVALID',
      resumable: false,
    });
  });
});
