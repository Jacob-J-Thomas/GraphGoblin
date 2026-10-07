import { describe, expect, it } from 'vitest';
import { RunEventSchema } from './events.js';
import { MAX_MODEL_NAME_LENGTH } from './common.js';
import { LoopSettingsSchema } from './loop.js';
import { DecisionConfigSchema, InferenceConfigSchema } from './nodes.js';
import { fakeUlid, FIXTURE_TS } from './testing/index.js';

const base = { runId: fakeUlid('run'), seq: 1, ts: FIXTURE_TS, nodeId: 'done' };
const exit = {
  ...base,
  type: 'exit.evaluated',
  iteration: 2,
  maxIterations: 5,
  criteria: [],
  result: { kind: 'completed', outcome: 'success', reason: 'default-success' },
};

describe('exit and decision evidence contracts', () => {
  it('round-trips the maximum configured model name in exit evidence', () => {
    const model = 'm'.repeat(MAX_MODEL_NAME_LENGTH);
    const configured = LoopSettingsSchema.parse({ defaults: { model } }).defaults.model;
    const event = {
      ...exit,
      criteria: [{ index: 0, strategy: 'codex', status: 'matched', model: configured }],
    };
    expect(RunEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    const oversized = `${model}m`;
    expect(LoopSettingsSchema.safeParse({ defaults: { model: oversized } }).success).toBe(false);
    const decision = {
      routes: [
        { label: 'yes', description: 'Yes' },
        { label: 'no', description: 'No' },
      ],
      question: 'Done?',
      strategy: ['codex'],
      codex: { model },
    };
    const inference = { prompt: { template: 'Hello' }, model };
    expect(DecisionConfigSchema.safeParse(decision).success).toBe(true);
    expect(InferenceConfigSchema.safeParse(inference).success).toBe(true);
    expect(
      DecisionConfigSchema.safeParse({ ...decision, codex: { model: oversized } }).success,
    ).toBe(false);
    expect(InferenceConfigSchema.safeParse({ ...inference, model: oversized }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({ ...event, criteria: [{ ...event.criteria[0], model: oversized }] })
        .success,
    ).toBe(false);
  });
  it('accepts all exit outcomes and rejects raw diagnostics and unbounded reasoning', () => {
    for (const result of [
      exit.result,
      { kind: 'completed', outcome: 'failure', reason: 'criterion-matched', criterionIndex: 1 },
      { kind: 'looped-back', reason: 'no-criterion-matched', targetNodeId: 'prep' },
      { kind: 'limit-reached', limit: 'iteration-ceiling', value: 5, outcome: 'exhausted' },
      {
        kind: 'failed',
        diagnostic: { code: 'DECIDER_HTTP_ERROR', message: 'Provider failed', status: 503 },
      },
      { kind: 'cancelled' },
    ])
      expect(RunEventSchema.safeParse({ ...exit, result }).success).toBe(true);
    const criteria = [
      {
        index: 0,
        strategy: 'jev',
        status: 'not-matched',
        holds: false,
        confidence: 0.8,
        classifierModel: 'jev',
      },
      {
        index: 1,
        strategy: 'codex',
        status: 'matched',
        holds: true,
        model: 'judge',
        reasoning: 'Done',
      },
      {
        index: 2,
        strategy: 'expression',
        status: 'skipped',
        reason: { code: 'EARLIER_CRITERION_MATCHED', message: 'Earlier match' },
      },
      {
        index: 3,
        strategy: 'jev',
        status: 'error',
        diagnostic: { code: 'DECIDER_INVALID_RESPONSE', message: 'Invalid response' },
      },
    ];
    expect(RunEventSchema.safeParse({ ...exit, criteria }).success).toBe(true);
    for (const entry of [
      { ...criteria[1], reasoning: 'x'.repeat(2049) },
      { ...criteria[0], confidence: 2 },
      { ...criteria[3], diagnostic: { code: 'RAW_PROVIDER_CODE', message: 'Raw' } },
      { ...criteria[3], raw: { token: 'private' } },
    ])
      expect(RunEventSchema.safeParse({ ...exit, criteria: [entry] }).success).toBe(false);
  });
  it('requires the decision skipped list and bounds its fixed messages', () => {
    const decision = { ...base, type: 'decision.made', strategy: 'expression', route: 'yes' };
    expect(RunEventSchema.safeParse(decision).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...decision, skipped: [] }).success).toBe(true);
    expect(
      RunEventSchema.safeParse({
        ...decision,
        skipped: [
          { strategy: 'jev', code: 'CLASSIFIER_MODEL_DISABLED', message: 'Classifier disabled' },
        ],
      }).success,
    ).toBe(true);
    expect(
      RunEventSchema.safeParse({
        ...decision,
        skipped: [{ strategy: 'jev', code: 'UNKNOWN', message: 'x'.repeat(257) }],
      }).success,
    ).toBe(false);
  });
});
