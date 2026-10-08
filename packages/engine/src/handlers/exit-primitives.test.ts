import { describe, expect, it, vi } from 'vitest';
import {
  ExitPredicateSchema,
  RunEventSchema,
  type ExitPredicate,
  type PrimitiveAnswerSpec,
} from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop, type TestEngine } from '../testing/index.js';
import type { LlmNoulResult, ClassifierNoulResult } from '../ports.js';

const sides = {
  type: 'noul',
  true: { label: 'Ready', criteria: 'Task is done' },
  false: { label: 'Continue', criteria: 'Task is not done' },
};
const choice = {
  type: 'choice',
  options: [
    { id: 'ready', label: 'Ready', criteria: 'Ready' },
    { id: 'continue', label: 'Continue', criteria: 'Continue' },
  ],
};
function predicate(
  kind: 'expression' | 'classifier' | 'llm',
  value = true,
  gate = false,
): ExitPredicate {
  return ExitPredicateSchema.parse({
    when: 'predicate',
    answer: kind === 'expression' ? { type: 'noul' } : sides,
    evaluation:
      kind === 'expression'
        ? { kind, jsonata: 'true' }
        : kind === 'classifier'
          ? { kind, model: 'jev', question: 'Done?', ...(gate ? { minConfidence: 0.8 } : {}) }
          : {
              kind,
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: 'Done?',
            },
    match: {
      type: 'noul',
      value,
      ...(kind === 'llm' && gate ? { minReportedConfidence: 0.8 } : {}),
    },
    outcome: 'success',
  });
}
async function run(e: TestEngine, criterion: ExitPredicate) {
  const def = singleNodeLoop(
    'primitive-exit',
    {
      id: 'prep',
      kind: 'mutate',
      label: 'Prepare',
      config: {
        operations: [{ op: 'set', path: '/vars/saved', value: { kind: 'literal', value: 42 } }],
      },
    },
    {
      criteria: [criterion],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
      return: { mapping: 'vars.saved', channels: [{ kind: 'caller' }] },
    },
  );
  def.settings = { maxIterations: 1 };
  def.edges.push({ id: 'back', from: { node: 'done', port: 'loopBack' }, to: { node: 'prep' } });
  const v = e.publish(def);
  const record = await e.runToIdle(v.loopId, { task: 'keep context' });
  const evidence = e.events(record.id).find((event) => event.type === 'exit.evaluated');
  expect(RunEventSchema.safeParse(evidence).success).toBe(true);
  const thread = await e.manager.getThread(record.id);
  expect(thread?.outputs).not.toHaveProperty('done');
  if (!record.failure)
    expect(
      e
        .events(record.id)
        .filter((event) => event.type === 'node.finished' && event.nodeId === 'done'),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ patch: [] })]));
  return { record, evidence };
}

describe('shared primitive exit execution', () => {
  for (const kind of ['classifier', 'llm'] as const)
    for (const holds of [false, true])
      for (const value of [false, true])
        for (const confidence of [0.799, 0.8, 0.801]) {
          it(`${kind} match=${value} answer=${holds} confidence=${confidence} retains the raw gated answer`, async () => {
            const e = await createTestEngine();
            if (kind === 'classifier')
              e.ports.jev.classifyNoul = () =>
                Promise.resolve({
                  type: 'noul',
                  trueProbability: holds ? confidence : 1 - confidence,
                });
            else
              e.ports.codexDecider.noul = () =>
                Promise.resolve({ type: 'noul', holds, confidence, reasoning: 'Reviewed' });
            const actualConfidence =
              kind === 'classifier' && !holds ? 1 - (1 - confidence) : confidence;
            const { record, evidence } = await run(e, predicate(kind, value, true));
            expect(record.status).toBe(
              holds === value && actualConfidence >= 0.8 ? 'succeeded' : 'exhausted',
            );
            expect(record.result).toBe(42);
            expect(evidence).toMatchObject({
              criteria: [
                {
                  answer: { type: 'noul', holds, confidence: actualConfidence },
                  acceptance: {
                    status:
                      kind === 'classifier' && actualConfidence < 0.8 ? 'rejected' : 'accepted',
                  },
                  ...(actualConfidence < 0.8
                    ? {
                        rejection: {
                          kind:
                            kind === 'classifier'
                              ? 'classifier-confidence'
                              : 'llm-reported-confidence',
                          minimum: 0.8,
                          confidence: actualConfidence,
                        },
                      }
                    : {}),
                },
              ],
            });
          });
        }
  it.each([0.499, 0.5, 0.501])(
    'uses unrounded classifier true probability %s at the default truth threshold',
    async (probability) => {
      const e = await createTestEngine();
      e.ports.jev.classifyNoul = () =>
        Promise.resolve({ type: 'noul', trueProbability: probability });
      const { record, evidence } = await run(e, predicate('classifier', false));
      expect(record.status).toBe(probability < 0.5 ? 'succeeded' : 'exhausted');
      expect(evidence).toMatchObject({
        criteria: [
          {
            answer: {
              holds: probability >= 0.5,
              trueProbability: probability,
              confidence: probability >= 0.5 ? probability : 1 - probability,
            },
          },
        ],
      });
    },
  );
  it('preserves the current fixed exit state and full thread question rendering', async () => {
    const e = await createTestEngine();
    const criterion = predicate('classifier');
    criterion.evaluation = {
      kind: 'classifier',
      model: 'jev',
      question:
        '{{ run.id }}|{{ counters.nodeVisits.prep }}|{{ vars.saved }}|{{ trigger.payload.task }}',
      truthThreshold: 0.7,
    };
    e.ports.jev.classifyNoul = vi.fn((): Promise<ClassifierNoulResult> =>
      Promise.resolve({ type: 'noul', trueProbability: 0.7 }),
    );
    const { record } = await run(e, criterion);
    expect(e.ports.jev.classifyNoul).toHaveBeenCalledWith(
      {
        question: `${record.id}|1|42|keep context`,
        context: {
          trigger: { task: 'keep context' },
          vars: { saved: 42 },
          lastOutput: { task: 'keep context' },
          lastMessage: null,
          iteration: 1,
        },
        criteria: { true: 'Task is done', false: 'Task is not done' },
      },
      expect.any(AbortSignal),
    );
    expect(record.status).toBe('succeeded');
  });
  it.each(['classifier', 'llm'] as const)(
    'matches stable Choice IDs with a %s evaluator',
    async (kind) => {
      const e = await createTestEngine();
      if (kind === 'classifier')
        e.ports.jev.choose = () =>
          Promise.resolve({
            type: 'choice',
            optionId: 'continue',
            confidence: 0.9,
            probabilities: { ready: 0.1, continue: 0.9 },
          });
      if (kind === 'llm')
        e.ports.codexDecider.choose = () =>
          Promise.resolve({
            type: 'choice',
            optionId: 'continue',
            confidence: 0.1,
            probabilities: null,
          });
      const original = predicate(kind);
      const criterion = ExitPredicateSchema.parse({
        ...original,
        answer: choice,
        evaluation: original.evaluation,
        match: { type: 'choice', optionIds: ['continue'] },
      });
      const { record, evidence } = await run(e, criterion);
      expect(record.status).toBe('succeeded');
      expect(evidence).toMatchObject({
        criteria: [
          {
            answer: { type: 'choice', optionId: 'continue' },
            match: { type: 'choice', optionIds: ['continue'] },
          },
        ],
      });
    },
  );
  it('rejects low-confidence Choice membership without writing decision outputs', async () => {
    const e = await createTestEngine();
    e.ports.jev.choose = () =>
      Promise.resolve({
        type: 'choice',
        optionId: 'continue',
        confidence: 0.7,
        probabilities: { ready: 0.3, continue: 0.7 },
      });
    const criterion = ExitPredicateSchema.parse({
      ...predicate('classifier', true, true),
      answer: choice,
      match: { type: 'choice', optionIds: ['continue'] },
    });
    const { record, evidence } = await run(e, criterion);
    expect(record.status).toBe('exhausted');
    expect(evidence).toMatchObject({
      criteria: [
        {
          answer: { optionId: 'continue', probabilities: { ready: 0.3, continue: 0.7 } },
          rejection: { kind: 'classifier-confidence' },
        },
      ],
    });
  });
  it.each([false, true])(
    'keeps valid nullable Score confidence accepted without an authored gate (rejected=%s)',
    async (gated) => {
      const e = await createTestEngine();
      e.ports.jev.score = () =>
        Promise.resolve({
          type: 'score',
          score: 1.25,
          confidence: gated ? 0.7 : null,
          legend: { 0: 'low', 1: 'middle', 2: 'high' },
          probabilities: null,
        });
      const answer: PrimitiveAnswerSpec = { type: 'score', anchors: ['low', 'middle', 'high'] };
      const criterion = ExitPredicateSchema.parse({
        ...predicate('classifier', true, gated),
        answer,
        match: { type: 'score', operator: 'gt', value: 1 },
      });
      const { record, evidence } = await run(e, criterion);
      expect(record.status).toBe(gated ? 'exhausted' : 'succeeded');
      expect(evidence).toMatchObject({
        criteria: [
          {
            answer: { type: 'score', score: 1.25, confidence: gated ? 0.7 : null },
            acceptance: { status: gated ? 'rejected' : 'accepted' },
          },
        ],
      });
    },
  );
  it.each([undefined, null, NaN, Infinity, -0.1, 1.1])(
    'rejects invalid LLM confidence %s even without a gate',
    async (confidence) => {
      const e = await createTestEngine();
      e.ports.codexDecider.noul = () =>
        Promise.resolve({
          type: 'noul',
          holds: false,
          confidence,
          reasoning: 'Reviewed',
        } as unknown as LlmNoulResult);
      const { record, evidence } = await run(e, predicate('llm', false));
      expect(record.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
      expect(evidence).toMatchObject({
        criteria: [{ status: 'error', provenance: { model: 'gpt-6-luna' } }],
        result: { kind: 'failed' },
      });
    },
  );
  it.each(['"false"', '1', 'null', '{}', '[]'])(
    'rejects expression truthiness from %s',
    async (jsonata) => {
      const e = await createTestEngine();
      const criterion = predicate('expression');
      criterion.evaluation = { kind: 'expression', jsonata };
      expect((await run(e, criterion)).record.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
    },
  );
  it('fails a gated Score with missing confidence rather than treating it as a nonmatch', async () => {
    const e = await createTestEngine();
    e.ports.jev.score = () =>
      Promise.resolve({
        type: 'score',
        score: 1,
        confidence: null,
        legend: { 0: 'low', 1: 'high' },
        probabilities: null,
      });
    const criterion = ExitPredicateSchema.parse({
      ...predicate('classifier', true, true),
      answer: { type: 'score', anchors: ['low', 'high'] },
      match: { type: 'score', operator: 'eq', value: 1 },
    });
    expect((await run(e, criterion)).record.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
  });
  it.each([0.799, 0.8, 0.801])(
    'applies the exit-only LLM Choice reported confidence gate at %s',
    async (confidence) => {
      const e = await createTestEngine();
      e.ports.codexDecider.choose = () =>
        Promise.resolve({ type: 'choice', optionId: 'continue', confidence, probabilities: null });
      const criterion = ExitPredicateSchema.parse({
        ...predicate('llm'),
        answer: choice,
        match: { type: 'choice', optionIds: ['continue'], minReportedConfidence: 0.8 },
      });
      const { record, evidence } = await run(e, criterion);
      expect(record.status).toBe(confidence >= 0.8 ? 'succeeded' : 'exhausted');
      expect(evidence).toMatchObject({
        criteria: [
          {
            answer: { type: 'choice', optionId: 'continue', confidence },
            acceptance: { status: 'accepted' },
            ...(confidence < 0.8
              ? { rejection: { kind: 'llm-reported-confidence', minimum: 0.8, confidence } }
              : {}),
          },
        ],
      });
    },
  );
  it.each([
    { holds: null, reasoning: 'Reviewed' },
    { holds: false, reasoning: null },
  ])('rejects fresh LLM historical unknown facts %j', async (unknownFacts) => {
    const e = await createTestEngine();
    e.ports.codexDecider.noul = () =>
      Promise.resolve({
        type: 'noul',
        confidence: 0.9,
        ...unknownFacts,
      } as unknown as LlmNoulResult);
    const { record, evidence } = await run(e, predicate('llm', false));
    expect(record.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
    expect(evidence).toMatchObject({ criteria: [{ status: 'error' }], result: { kind: 'failed' } });
  });
});
