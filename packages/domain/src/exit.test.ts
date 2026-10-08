import { describe, expect, it, vi } from 'vitest';
import {
  ExitConfigSchema,
  type ExitCriterionEvaluation,
  type PrimitiveEvaluation,
  type PrimitiveAnswer,
} from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { evaluateExit, type ExitContext } from './exit.js';

const sides = {
  type: 'noul',
  true: { label: 'Ready', criteria: 'Ready' },
  false: { label: 'Continue', criteria: 'Continue' },
};
function result(
  answer: PrimitiveAnswer,
  kind: 'expression' | 'classifier' | 'llm' = 'expression',
  rejected = false,
): PrimitiveEvaluation {
  return {
    answer,
    provenance: {
      kind,
      provider: kind === 'classifier' ? 'typesafe' : kind === 'llm' ? 'codex' : null,
      classifierId: kind === 'classifier' ? 'jev' : null,
      model: kind === 'expression' ? null : 'selected-model',
      effort: kind === 'llm' ? 'low' : null,
    },
    acceptance: rejected
      ? { status: 'rejected', code: 'EVALUATION_RESULT_REJECTED', minConfidence: 0.8 }
      : { status: 'accepted' },
  };
}
function ctx(overrides: Partial<ExitContext> = {}): ExitContext {
  return {
    thread: sampleThread(),
    iteration: 1,
    maxIterations: 5,
    elapsedMs: 0,
    evaluatePredicate: vi
      .fn()
      .mockResolvedValue(
        result({ type: 'noul', kind: 'expression', holds: true, confidence: null }),
      ),
    ...overrides,
  };
}
function config(kind: 'expression' | 'classifier' | 'llm', value = true, gate = false) {
  return ExitConfigSchema.parse({
    criteria: [
      {
        when: 'predicate',
        answer: kind === 'expression' ? { type: 'noul' } : sides,
        evaluation:
          kind === 'expression'
            ? { kind, jsonata: 'true' }
            : kind === 'classifier'
              ? { kind, model: 'jev', question: '?', ...(gate ? { minConfidence: 0.8 } : {}) }
              : {
                  kind,
                  harness: 'codex',
                  model: { mode: 'inherit' },
                  effort: { mode: 'inherit' },
                  question: '?',
                },
        match: {
          type: 'noul',
          value,
          ...(gate && kind === 'llm' ? { minReportedConfidence: 0.8 } : {}),
        },
        outcome: 'failure',
      },
    ],
    default: 'loop-back',
    loopBack: { targetNodeId: 'prep' },
  });
}

describe('evaluateExit explicit primitive matching', () => {
  for (const kind of ['classifier', 'llm'] as const) {
    for (const holds of [false, true])
      for (const value of [false, true])
        for (const confidence of [0.799, 0.8, 0.801]) {
          it(`${kind} holds=${holds} match=${value} confidence=${confidence} gates before matching`, async () => {
            const answer: PrimitiveAnswer =
              kind === 'classifier'
                ? {
                    type: 'noul',
                    kind,
                    holds,
                    trueProbability: holds ? confidence : 1 - confidence,
                    confidence,
                  }
                : { type: 'noul', kind, holds, confidence, reasoning: 'Reviewed' };
            const raw = result(answer, kind, kind === 'classifier' && confidence < 0.8);
            const evidence: ExitCriterionEvaluation[] = [];
            const decision = await evaluateExit(
              config(kind, value, true),
              ctx({
                evaluatePredicate: () => Promise.resolve(raw),
                onCriterion: (e) => evidence.push(e),
              }),
            );
            const matched = holds === value && confidence >= 0.8;
            expect(decision.kind).toBe(matched ? 'finish' : 'loop-back');
            expect(evidence[0]).toMatchObject({
              status: matched ? 'matched' : 'not-matched',
              answer,
              acceptance: raw.acceptance,
            });
            if (confidence < 0.8)
              expect(evidence[0]).toMatchObject({
                rejection: {
                  kind: kind === 'classifier' ? 'classifier-confidence' : 'llm-reported-confidence',
                  minimum: 0.8,
                  confidence,
                },
              });
            else expect(evidence[0]).not.toHaveProperty('rejection');
          });
        }
    it.each([false, true])(`${kind} has no implicit confidence gate for %s`, async (holds) => {
      const answer: PrimitiveAnswer =
        kind === 'classifier'
          ? { type: 'noul', kind, holds, trueProbability: 0.5, confidence: 0.5 }
          : { type: 'noul', kind, holds, confidence: 0.01, reasoning: 'Reviewed' };
      expect(
        await evaluateExit(
          config(kind, holds),
          ctx({ evaluatePredicate: () => Promise.resolve(result(answer, kind)) }),
        ),
      ).toMatchObject({ outcome: 'failure' });
    });
  }
  it.each([false, true])('matches expression booleans explicitly, including %s', async (holds) => {
    expect(
      await evaluateExit(
        config('expression', holds),
        ctx({
          evaluatePredicate: () =>
            Promise.resolve(result({ type: 'noul', kind: 'expression', holds, confidence: null })),
        }),
      ),
    ).toMatchObject({ outcome: 'failure' });
  });
  it.each(['a', 'b', 'c'])('matches Choice membership for %s', async (optionId) => {
    const authored = ExitConfigSchema.parse({
      criteria: [
        {
          when: 'predicate',
          answer: {
            type: 'choice',
            options: ['a', 'b', 'c'].map((id) => ({ id, label: id, criteria: id })),
          },
          evaluation: { kind: 'classifier', model: 'jev', question: '?' },
          match: { type: 'choice', optionIds: ['a', 'c'] },
          outcome: 'failure',
        },
      ],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
    });
    const decision = await evaluateExit(
      authored,
      ctx({
        evaluatePredicate: () =>
          Promise.resolve(
            result(
              {
                type: 'choice',
                optionId,
                confidence: 1,
                probabilities: {
                  a: optionId === 'a' ? 1 : 0,
                  b: optionId === 'b' ? 1 : 0,
                  c: optionId === 'c' ? 1 : 0,
                },
              },
              'classifier',
            ),
          ),
      }),
    );
    expect(decision.kind).toBe(optionId === 'b' ? 'loop-back' : 'finish');
  });
  for (const operator of ['lt', 'lte', 'eq', 'gte', 'gt'] as const)
    for (const score of [0.999, 1, 1.001]) {
      it(`compares unrounded Score ${score} using ${operator}`, async () => {
        const authored = ExitConfigSchema.parse({
          criteria: [
            {
              when: 'predicate',
              answer: { type: 'score', anchors: ['low', 'middle', 'high'] },
              evaluation: { kind: 'classifier', model: 'jev', question: '?' },
              match: { type: 'score', operator, value: 1 },
              outcome: 'failure',
            },
          ],
          default: 'loop-back',
          loopBack: { targetNodeId: 'prep' },
        });
        const expected = {
          lt: score < 1,
          lte: score <= 1,
          eq: score === 1,
          gte: score >= 1,
          gt: score > 1,
        }[operator];
        const decision = await evaluateExit(
          authored,
          ctx({
            evaluatePredicate: () =>
              Promise.resolve(
                result(
                  {
                    type: 'score',
                    score,
                    confidence: null,
                    legend: { 0: 'low', 1: 'middle', 2: 'high' },
                    probabilities: null,
                  },
                  'classifier',
                ),
              ),
          }),
        );
        expect(decision.kind).toBe(expected ? 'finish' : 'loop-back');
      });
    }
  it('observes ordered nonmatches then first match, without evaluating a later predicate', async () => {
    const raw = result({ type: 'noul', kind: 'expression', holds: false, confidence: null });
    const evaluatePredicate = vi
      .fn()
      .mockResolvedValueOnce(raw)
      .mockResolvedValueOnce({ ...raw, answer: { ...raw.answer, holds: true } });
    const authored = config('expression');
    authored.criteria.push(authored.criteria[0]!, authored.criteria[0]!);
    const evidence: ExitCriterionEvaluation[] = [];
    expect(
      await evaluateExit(
        authored,
        ctx({ evaluatePredicate, onCriterion: (e) => evidence.push(e) }),
      ),
    ).toMatchObject({ criterionIndex: 1 });
    expect(evaluatePredicate).toHaveBeenCalledTimes(2);
    expect(evidence.map((e) => e.status)).toEqual(['not-matched', 'matched']);
  });
  it('records safe criterion error then propagates it before the ceiling', async () => {
    const marker = new Error('private provider payload');
    const evidence: ExitCriterionEvaluation[] = [];
    await expect(
      evaluateExit(
        config('expression'),
        ctx({
          iteration: 5,
          evaluatePredicate: () => Promise.reject(marker),
          onCriterion: (e) => evidence.push(e),
        }),
      ),
    ).rejects.toBe(marker);
    expect(evidence).toEqual([
      {
        index: 0,
        strategy: 'expression',
        status: 'error',
        diagnostic: { code: 'CRITERION_ERROR', message: 'Exit criterion evaluation failed' },
      },
    ]);
    expect(JSON.stringify(evidence)).not.toContain(marker.message);
  });
  it('evaluates a final-iteration match before the implicit ceiling; only a no-match exhausts', async () => {
    expect(await evaluateExit(config('expression'), ctx({ iteration: 5 }))).toMatchObject({
      outcome: 'failure',
      criterionIndex: 0,
    });
    expect(await evaluateExit(config('expression', false), ctx({ iteration: 5 }))).toMatchObject({
      outcome: 'exhausted',
    });
  });
  it('defaults to success without criteria', async () =>
    expect(await evaluateExit(ExitConfigSchema.parse({}), ctx())).toEqual({
      kind: 'finish',
      outcome: 'success',
      reason: 'default',
    }));
  it('keeps explicit limits ordered and supports schema matching of last output', async () => {
    const authored = ExitConfigSchema.parse({
      criteria: [
        { when: 'max-iterations', value: 3 },
        { when: 'max-duration', seconds: 10 },
        { when: 'last-output-matches', jsonSchema: { type: 'object', required: ['done'] } },
      ],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
    });
    expect(await evaluateExit(authored, ctx({ iteration: 3, elapsedMs: 10000 }))).toMatchObject({
      criterionIndex: 0,
      outcome: 'exhausted',
    });
    expect(await evaluateExit(authored, ctx({ elapsedMs: 10000 }))).toMatchObject({
      criterionIndex: 1,
      outcome: 'exhausted',
    });
    expect(await evaluateExit(authored, ctx())).toEqual({
      kind: 'loop-back',
      targetNodeId: 'prep',
    });
    const thread = sampleThread({
      lastOutput: { nodeId: 'infer', value: { done: true }, at: '2026-10-02T12:00:00.000Z' },
    });
    expect(await evaluateExit(authored, ctx({ thread }))).toMatchObject({
      criterionIndex: 2,
      outcome: 'success',
    });
  });
});
