import { describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import type { ClassifierNoulResult, LlmNoulResult, ScoreResult } from '../ports.js';
import { createTestEngine } from '../testing/index.js';

type DecisionInput = Extract<LoopDefinitionInput['nodes'][number], { kind: 'decision' }>['config'];
const noul: DecisionInput['answer'] = {
  type: 'noul',
  true: { id: 'pass', label: 'Ready', criteria: 'All checks pass' },
  false: { id: 'rework', label: 'Needs work', criteria: 'A check failed' },
};
const score: DecisionInput['answer'] = {
  type: 'score',
  anchors: ['low', 'moderate', 'high', 'critical'],
  bands: [
    { id: 'pass', label: 'Low', min: 0, max: 1 },
    { id: 'rework', label: 'Elevated', min: 1, max: 3 },
  ],
};
const classifier: DecisionInput['evaluation'] = {
  kind: 'classifier',
  model: 'jev',
  question: 'Evaluate {{ trigger.payload.value }}',
};
const llm: DecisionInput['evaluation'] = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  question: 'Evaluate {{ trigger.payload.value }}',
};

function loop(
  answer: DecisionInput['answer'],
  evaluation: DecisionInput['evaluation'],
): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name: 'primitive',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      { id: 'decide', kind: 'decision', label: 'Evaluate', config: { answer, evaluation } },
      {
        id: 'pass',
        kind: 'exit',
        label: 'Ready',
        config: { return: { mapping: 'outputs.decide.value' } },
      },
      {
        id: 'rework',
        kind: 'exit',
        label: 'Needs work',
        config: { return: { mapping: 'outputs.decide.value' } },
      },
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'pass', from: { node: 'decide', port: 'pass' }, to: { node: 'pass' } },
      { id: 'rework', from: { node: 'decide', port: 'rework' }, to: { node: 'rework' } },
    ],
  };
}
const scored = (value: number): ScoreResult => ({
  type: 'score',
  score: value,
  confidence: 0.9,
  legend: { '0': 'low', '1': 'moderate', '2': 'high', '3': 'critical' },
  probabilities: { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.4 },
});

describe('decision primitive execution', () => {
  it.each([true, false])(
    'routes strict expression Noul %s through authored side IDs',
    async (holds) => {
      const e = await createTestEngine();
      const r = await e.runToIdle(
        e.publish(loop(noul, { kind: 'expression', jsonata: String(holds) })).loopId,
      );
      expect(r.result).toMatchObject({
        answer: { type: 'noul', kind: 'expression', holds, confidence: null },
        portId: holds ? 'pass' : 'rework',
        provenance: { kind: 'expression', provider: null, model: null, effort: null },
      });
      expect(e.ports.classifiers.requests).toEqual([]);
      expect(e.ports.codexDecider.nouls).toEqual([]);
    },
  );

  it.each(['"true"', '1', '[]', '{}', 'null'])(
    'rejects nonboolean Noul expression %s',
    async (jsonata) => {
      const e = await createTestEngine();
      const r = await e.runToIdle(e.publish(loop(noul, { kind: 'expression', jsonata })).loopId);
      expect(r.failure).toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE', resumable: false });
      expect(e.eventTypes(r.id)).not.toContain('decision.made');
      expect(e.ports.classifiers.requests).toEqual([]);
    },
  );

  it.each([
    [0.49, 0.5, false, 0.51],
    [0.5, 0.5, true, 0.5],
    [0.3, 0.2, true, 0.3],
    [0.7, 0.8, false, 0.3],
  ])('retains raw Noul %s at threshold %s', async (probability, threshold, holds, confidence) => {
    const e = await createTestEngine();
    const call = vi.fn((_request, _signal) =>
      Promise.resolve({ type: 'noul' as const, trueProbability: probability }),
    );
    e.ports.jev.classifyNoul = call;
    const r = await e.runToIdle(
      e.publish(loop(noul, { ...classifier, truthThreshold: threshold })).loopId,
      { value: 'ready' },
    );
    expect(r.result).toMatchObject({
      answer: { type: 'noul', kind: 'classifier', trueProbability: probability, holds },
      portId: holds ? 'pass' : 'rework',
      provenance: { kind: 'classifier', classifierId: 'jev', model: 'jev-latest', effort: null },
    });
    const event = e.events(r.id).find((item) => item.type === 'decision.made');
    expect(event?.type === 'decision.made' && event.answer.confidence).toBeCloseTo(confidence);
    expect(call).toHaveBeenCalledExactlyOnceWith(
      {
        question: 'Evaluate ready',
        context: {
          trigger: { value: 'ready' },
          messages: [],
          vars: {},
          lastOutput: { value: 'ready' },
        },
        criteria: { true: 'All checks pass', false: 'A check failed' },
      },
      expect.any(AbortSignal),
    );
    expect(e.ports.classifiers.requests).toEqual([
      { ownerId: 'local', modelId: 'jev', primitive: 'noul' },
    ]);
    expect(e.ports.jev.choices).toEqual([]);
    expect(e.ports.jev.judgements).toEqual([]);
  });

  it('retains the raw rejected classifier answer and does not route it', async () => {
    const e = await createTestEngine();
    e.ports.jev.classifyNoul = vi.fn(() =>
      Promise.resolve({ type: 'noul' as const, trueProbability: 0.7 }),
    );
    const r = await e.runToIdle(
      e.publish(loop(noul, { ...classifier, truthThreshold: 0.8, minConfidence: 0.5 })).loopId,
    );
    expect(r.failure).toMatchObject({
      code: 'EVALUATION_RESULT_REJECTED',
      resumable: false,
      details: {
        answer: { type: 'noul', kind: 'classifier', holds: false, trueProbability: 0.7 },
        provenance: { kind: 'classifier', classifierId: 'jev' },
        acceptance: { status: 'rejected', minConfidence: 0.5 },
      },
    });
    expect(e.ports.jev.classifyNoul).toHaveBeenCalledTimes(1);
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
    expect((await e.ports.runs.getThread(r.id))?.outputs.decide).toBeUndefined();
  });

  it.each([-0.01, 1.01, NaN, Infinity])(
    'rejects malformed raw classifier Noul %s',
    async (trueProbability) => {
      const e = await createTestEngine();
      e.ports.jev.classifyNoul = vi.fn(() =>
        Promise.resolve({ type: 'noul' as const, trueProbability }),
      );
      const r = await e.runToIdle(e.publish(loop(noul, classifier)).loopId);
      expect(r.failure).toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE', resumable: false });
      expect(e.ports.jev.classifyNoul).toHaveBeenCalledTimes(1);
      expect(e.eventTypes(r.id)).not.toContain('decision.made');
    },
  );

  it('uses strict LLM Noul with resolved defaults and informational confidence', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(loop(noul, llm)).loopId, { value: 'ready' });
    expect(r.result).toMatchObject({
      answer: { type: 'noul', kind: 'llm', holds: true, confidence: 1, reasoning: 'Verified' },
      portId: 'pass',
      provenance: { kind: 'llm', provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
    });
    expect(e.ports.codexDecider.nouls).toEqual([
      {
        question: 'Evaluate ready',
        context: {
          trigger: { value: 'ready' },
          messages: [],
          vars: {},
          lastOutput: { value: 'ready' },
        },
        criteria: { true: 'All checks pass', false: 'A check failed' },
        model: 'gpt-6-luna',
        effort: 'low',
      },
    ]);
    expect(e.ports.codexDecider.judgements).toEqual([]);
    expect(e.ports.classifiers.requests).toEqual([]);
  });

  it.each([undefined, '0.9', NaN, Infinity, -0.1, 1.1])(
    'rejects strict LLM Noul confidence %s',
    async (confidence) => {
      const e = await createTestEngine();
      e.ports.codexDecider.noul = vi.fn(() =>
        Promise.resolve({
          type: 'noul',
          holds: false,
          confidence,
          reasoning: 'No',
        } as unknown as LlmNoulResult),
      );
      const r = await e.runToIdle(e.publish(loop(noul, llm)).loopId);
      expect(r.failure).toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE', resumable: false });
      expect(e.ports.codexDecider.noul).toHaveBeenCalledTimes(1);
      expect(e.eventTypes(r.id)).not.toContain('decision.made');
    },
  );

  it.each([
    [0, 'pass'],
    [0.99, 'pass'],
    [1, 'rework'],
    [1.4, 'rework'],
    [3, 'rework'],
  ])('routes fractional Score %s without rounding', async (value, portId) => {
    const e = await createTestEngine();
    e.ports.jev.score = vi.fn(() => Promise.resolve(scored(value)));
    const r = await e.runToIdle(e.publish(loop(score, classifier)).loopId, { value: 'severity' });
    expect(r.result).toMatchObject({ answer: scored(value), portId });
    expect(e.ports.jev.score).toHaveBeenCalledExactlyOnceWith(
      {
        question: 'Evaluate severity',
        context: {
          trigger: { value: 'severity' },
          messages: [],
          vars: {},
          lastOutput: { value: 'severity' },
        },
        anchors: ['low', 'moderate', 'high', 'critical'],
      },
      expect.any(AbortSignal),
    );
    expect(e.ports.classifiers.requests).toEqual([
      { ownerId: 'local', modelId: 'jev', primitive: 'score' },
    ]);
  });

  it.each([
    { ...scored(1), score: -1 },
    { ...scored(1), score: 3.01 },
    { ...scored(1), score: Infinity },
    { ...scored(1), legend: { '0': 'wrong', '1': 'moderate', '2': 'high', '3': 'critical' } },
    { ...scored(1), probabilities: { '0': 1 } },
    { ...scored(1), confidence: 1.1 },
  ])('rejects malformed Score before routing', async (answer) => {
    const e = await createTestEngine();
    e.ports.jev.score = vi.fn(() => Promise.resolve(answer));
    const r = await e.runToIdle(e.publish(loop(score, classifier)).loopId);
    expect(r.failure).toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE', resumable: false });
    expect(e.ports.jev.score).toHaveBeenCalledTimes(1);
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
  });

  it('rejects a valid Score below the minimum and retains its fractional raw evidence', async () => {
    const e = await createTestEngine();
    e.ports.jev.score = vi.fn(() => Promise.resolve({ ...scored(1.4), confidence: 0.3 }));
    const r = await e.runToIdle(
      e.publish(loop(score, { ...classifier, minConfidence: 0.8 })).loopId,
    );
    expect(r.failure).toMatchObject({
      code: 'EVALUATION_RESULT_REJECTED',
      details: { answer: { score: 1.4, confidence: 0.3 } },
    });
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
  });
  it('omits rejected Score alternatives while retaining fractional value, confidence, rubric and gate', async () => {
    const e = await createTestEngine();
    e.ports.jev.score = vi.fn(() => Promise.resolve({ ...scored(1.4), confidence: 0.3 }));
    const definition = loop(score, { ...classifier, minConfidence: 0.8 });
    const decision = definition.nodes.find((node) => node.id === 'decide');
    if (!decision || decision.kind !== 'decision') throw new Error('Missing decision fixture');
    decision.config.recordAlternatives = false;
    const r = await e.runToIdle(e.publish(definition).loopId);
    expect(r.failure).toMatchObject({
      code: 'EVALUATION_RESULT_REJECTED',
      details: {
        answer: {
          type: 'score',
          score: 1.4,
          confidence: 0.3,
          legend: scored(1.4).legend,
          probabilities: null,
        },
        provenance: { kind: 'classifier', classifierId: 'jev' },
        acceptance: { status: 'rejected', minConfidence: 0.8 },
      },
    });
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
    expect((await e.manager.getThread(r.id))?.outputs['decide']).toBeUndefined();
    expect(e.events(r.id).find((event) => event.type === 'run.failed')).toMatchObject({
      failure: { details: { answer: { probabilities: null } } },
    });
  });

  it('allows unavailable Score confidence without a minimum, but cannot bypass an authored gate', async () => {
    const e = await createTestEngine();
    e.ports.jev.score = () =>
      Promise.resolve({ ...scored(0.5), confidence: null, probabilities: null });
    const noGate = await e.runToIdle(e.publish(loop(score, classifier)).loopId);
    expect(noGate.result).toMatchObject({
      answer: { score: 0.5, confidence: null, probabilities: null },
      portId: 'pass',
    });
    const gated = await e.runToIdle(
      e.publish(loop(score, { ...classifier, minConfidence: 0.2 })).loopId,
    );
    expect(gated.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
  });

  it.each(['provider-error', 'cancelled', 'wrong-primitive'] as const)(
    'propagates Noul %s without fallback',
    async (failure) => {
      const e = await createTestEngine();
      e.ports.jev.classifyNoul = vi.fn(() => {
        if (failure === 'cancelled')
          return Promise.reject(new DOMException('private text', 'AbortError'));
        if (failure === 'provider-error')
          return Promise.reject(
            Object.assign(new Error('private text'), { code: 'DECIDER_RATE_LIMITED' }),
          );
        return Promise.resolve({ type: 'choice' } as unknown as ClassifierNoulResult);
      });
      const r = await e.runToIdle(e.publish(loop(noul, classifier)).loopId);
      expect(failure === 'cancelled' ? r.status : r.failure?.code).toBe(
        failure === 'cancelled'
          ? 'cancelled'
          : failure === 'provider-error'
            ? 'EVALUATION_PROVIDER_FAILED'
            : 'EVALUATION_INVALID_RESPONSE',
      );
      expect(JSON.stringify(e.events(r.id))).not.toContain('private text');
      expect(e.ports.jev.classifyNoul).toHaveBeenCalledTimes(1);
      expect(e.ports.codexDecider.nouls).toEqual([]);
      expect(e.eventTypes(r.id)).not.toContain('decision.made');
    },
  );
});
