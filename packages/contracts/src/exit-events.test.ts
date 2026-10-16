import { describe, it, expect } from 'vitest';
import { RunEventSchema } from './index.js';
import { FIXTURE_IDS, FIXTURE_TS } from './testing/index.js';

describe('terminal exit evidence', () => {
  it('records the outcome and rejects predicate or continuation evidence', () => {
    const event = {
      runId: FIXTURE_IDS.run,
      seq: 1,
      ts: FIXTURE_TS,
      type: 'exit.evaluated',
      nodeId: 'done',
      outcome: 'exhausted',
    };
    expect(RunEventSchema.parse(event)).toEqual(event);
    for (const fields of [
      { criteria: [] },
      { result: { kind: 'looped-back', targetNodeId: 'work' } },
      { iteration: 1 },
      { outcome: 'unknown' },
    ])
      expect(RunEventSchema.safeParse({ ...event, ...fields }).success).toBe(false);
  });
});
