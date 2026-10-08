import { describe, expect, it, vi } from 'vitest';
import { EvaluationSchema, type EvaluationAnswerSpec } from '@graphgoblin/contracts';
import { evaluatePrimitive, type PrimitiveEvaluationRequest } from './primitive-evaluator.js';
import type { ClassifierNoulResult, DeciderPort } from './ports.js';
import { createFakePorts } from './testing/index.js';

const noul: EvaluationAnswerSpec = {
  type: 'noul',
  true: { label: 'Ready', criteria: 'Ready' },
  false: { label: 'Fix', criteria: 'Fix' },
};
const score: EvaluationAnswerSpec = { type: 'score', anchors: ['low', 'high'] };
function request(): PrimitiveEvaluationRequest {
  return {
    nodeId: 'evaluate',
    ownerId: 'owner',
    answer: noul,
    evaluation: EvaluationSchema.parse({
      kind: 'classifier',
      model: 'jev',
      question: 'Unused template',
    }),
    expressionView: { privateFullThread: true },
    question: 'Prepared question',
    context: { suppliedState: true },
    signal: new AbortController().signal,
    ports: createFakePorts(),
    resolveModel: vi.fn(() => Promise.resolve({ model: 'gpt-6-luna', effort: 'low' as const })),
  };
}
describe('context-independent primitive evaluator boundary', () => {
  it.each(['choice', 'score'] as const)(
    'rejects a Noul threshold on %s before resolving a provider',
    async (primitive) => {
      const input = request();
      input.answer =
        primitive === 'score'
          ? score
          : {
              type: 'choice',
              options: [
                { id: 'ready', label: 'Ready', criteria: 'Ready' },
                { id: 'fix', label: 'Fix', criteria: 'Fix' },
              ],
            };
      input.evaluation = EvaluationSchema.parse({
        kind: 'classifier',
        model: 'jev',
        question: 'Unused',
        truthThreshold: 0.8,
      });
      const resolve = vi.spyOn(input.ports.classifiers, 'resolve');
      await expect(evaluatePrimitive(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
        options: { resumable: false },
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(input.resolveModel).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined, {}, [], { type: 'noul', trueProbability: '0.5' }])(
    'rejects malformed Noul response %s without a provider failure',
    async (raw) => {
      const input = request();
      const ports = createFakePorts();
      ports.jev.classifyNoul = vi.fn(() => Promise.resolve(raw as unknown as ClassifierNoulResult));
      input.ports = ports;
      await expect(evaluatePrimitive(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_RESPONSE',
        options: { resumable: false },
      });
      expect(ports.jev.choices).toHaveLength(0);
      expect(ports.jev.scores).toHaveLength(0);
    },
  );

  it('passes prepared inputs unchanged and exercises typed fake classifier capabilities', async () => {
    const input = request();
    const first = await evaluatePrimitive(input);
    expect(first).toMatchObject({
      answer: { type: 'noul', kind: 'classifier', holds: true, trueProbability: 1 },
      acceptance: { status: 'accepted' },
    });
    const second = await evaluatePrimitive({ ...input, answer: score });
    expect(second).toMatchObject({
      answer: { type: 'score', score: 0, legend: { '0': 'low', '1': 'high' } },
    });
    expect(input.resolveModel).not.toHaveBeenCalled();
  });

  it.each(['question', 'context'] as const)(
    'requires prepared %s before classifier selection',
    async (key) => {
      const input = request();
      delete input[key];
      await expect(evaluatePrimitive(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
        options: { resumable: false },
      });
    },
  );

  it.each(['expression', 'llm'] as const)(
    'rejects unsupported %s Score without dispatch',
    async (kind) => {
      const input = request();
      input.answer = score;
      input.evaluation =
        kind === 'expression'
          ? { kind: 'expression', jsonata: '1.2' }
          : EvaluationSchema.parse({
              kind: 'llm',
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: 'Unused',
            });
      await expect(evaluatePrimitive(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
        options: { resumable: false },
      });
      expect(input.resolveModel).not.toHaveBeenCalled();
    },
  );

  it('reports unavailable strict LLM capability before a completion or model resolution', async () => {
    const input = request();
    input.evaluation = EvaluationSchema.parse({
      kind: 'llm',
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      question: 'Unused',
    });
    const choose = vi.fn();
    input.ports.deciders = [
      { id: 'codex', available: () => true, choose } as unknown as DeciderPort,
    ];
    await expect(evaluatePrimitive(input)).rejects.toMatchObject({
      code: 'EVALUATION_INVALID_CONFIGURATION',
      options: { resumable: false },
    });
    expect(choose).not.toHaveBeenCalled();
    expect(input.resolveModel).not.toHaveBeenCalled();
  });
  it.each(['choice', 'score'] as const)(
    'rejects direct %s truthThreshold configuration before selection',
    async (type) => {
      const input = request();
      input.answer =
        type === 'score'
          ? score
          : { type: 'choice', options: [{ id: 'ready', label: 'Ready', criteria: 'Ready' }] };
      input.evaluation = EvaluationSchema.parse({
        kind: 'classifier',
        model: 'jev',
        question: '?',
        truthThreshold: 0.6,
      });
      const resolve = vi.spyOn(input.ports.classifiers, 'resolve');
      await expect(evaluatePrimitive(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(input.resolveModel).not.toHaveBeenCalled();
    },
  );
  it.each(['classifier', 'llm'] as const)(
    'requires authored provider Noul criteria before %s selection',
    async (kind) => {
      const input = request();
      input.answer = { type: 'noul' };
      input.evaluation = EvaluationSchema.parse(
        kind === 'classifier'
          ? { kind, model: 'jev', question: '?' }
          : {
              kind,
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: '?',
            },
      );
      const resolve = vi.spyOn(input.ports.classifiers, 'resolve');
      await expect(evaluatePrimitive(input)).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(input.resolveModel).not.toHaveBeenCalled();
    },
  );
});
