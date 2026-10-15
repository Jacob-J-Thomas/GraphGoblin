import { describe, it, expect, vi } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type ClassifierAnswerConfig,
} from '@graphgoblin/contracts';
import { createTestEngine } from '../testing/index.js';
const noul: ClassifierAnswerConfig = {
  type: 'noul',
  true: { id: 'pass', label: 'Ready', criteria: 'Complete' },
  false: { id: 'rework', label: 'Needs work', criteria: 'Incomplete' },
};
const score: ClassifierAnswerConfig = {
  type: 'score',
  anchors: ['low', 'moderate', 'high', 'critical'],
  bands: [
    { id: 'pass', label: 'Low', min: 0, max: 1 },
    { id: 'rework', label: 'Elevated', min: 1, max: 3 },
  ],
};
function loop(
  answer: ClassifierAnswerConfig,
  minConfidence?: number,
  truthThreshold?: number,
  recordAlternatives = true,
): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'classifier',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Decide',
        config: {
          kind: 'classifier',
          model: 'jev',
          question: 'Evaluate {{ trigger.payload.value }}',
          answer,
          recordAlternatives,
          ...(minConfidence !== undefined ? { minConfidence } : {}),
          ...(truthThreshold !== undefined ? { truthThreshold } : {}),
        },
      },
      ...['pass', 'rework'].map((id) => ({
        id,
        kind: 'exit' as const,
        label: id,
        config: { return: { mapping: 'outputs.decide.value' } },
      })),
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      ...['pass', 'rework'].map((id) => ({
        id,
        from: { node: 'decide', port: id },
        to: { node: id },
      })),
    ],
  };
}
const scored = (value: number) => ({
  type: 'score' as const,
  score: value,
  confidence: 0.9,
  legend: { '0': 'low', '1': 'moderate', '2': 'high', '3': 'critical' },
  probabilities: { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.4 },
});
describe('classifier decision mathematics', () => {
  it.each([
    [0.69, 0.7, 'rework'],
    [0.7, 0.7, 'pass'],
    [0, 0, 'pass'],
    [1, 1, 'pass'],
  ] as const)('uses unrounded Noul probability %s at threshold %s', async (p, threshold, route) => {
    const e = await createTestEngine();
    e.ports.jev.classifyNoul = () => Promise.resolve({ type: 'noul', trueProbability: p });
    const r = await e.runToIdle(e.publish(loop(noul, undefined, threshold)).loopId, {
      value: 'task',
    });
    expect(r.result).toMatchObject({
      portId: route,
      observation: {
        kind: 'classifier',
        answer: {
          type: 'noul',
          holds: route === 'pass',
          trueProbability: p,
          confidence: route === 'pass' ? p : 1 - p,
        },
      },
    });
    expect(e.ports.classifiers.requests[0]).toMatchObject({ modelId: 'jev', primitive: 'noul' });
    expect(e.ports.codexDecider.routes).toEqual([]);
  });
  it('accepts confidence equality and rejects chosen-side confidence without emitting a port or patch', async () => {
    const e = await createTestEngine();
    e.ports.jev.classifyNoul = () => Promise.resolve({ type: 'noul', trueProbability: 0.7 });
    const accepted = await e.runToIdle(e.publish(loop(noul, 0.7, 0.7)).loopId);
    expect(accepted.status).toBe('succeeded');
    const rejected = await e.runToIdle(e.publish(loop(noul, 0.31, 0.8)).loopId);
    expect(rejected.failure).toMatchObject({
      code: 'EVALUATION_RESULT_REJECTED',
      resumable: false,
      details: {
        observation: { kind: 'classifier', answer: { holds: false, confidence: 1 - 0.7 } },
      },
    });
    expect(e.eventTypes(rejected.id)).not.toContain('decision.made');
    expect((await e.manager.getThread(rejected.id))?.outputs).not.toHaveProperty('decide');
  });
  it.each([
    [0, 'pass'],
    [0.999999, 'pass'],
    [1, 'rework'],
    [1.25, 'rework'],
    [3, 'rework'],
  ] as const)('routes fractional Score %s without rounding', async (value, portId) => {
    const e = await createTestEngine();
    e.ports.jev.score = () => Promise.resolve(scored(value));
    const r = await e.runToIdle(e.publish(loop(score)).loopId);
    expect(r.result).toMatchObject({
      portId,
      observation: { kind: 'classifier', answer: { score: value } },
    });
  });
  it('preserves classifier request fields and suppresses alternatives only after validation', async () => {
    const e = await createTestEngine();
    const scoreCall = vi.spyOn(e.ports.jev, 'score');
    const r = await e.runToIdle(e.publish(loop(score, undefined, undefined, false)).loopId, {
      value: 'task',
    });
    expect(scoreCall.mock.calls[0]?.[0]).toMatchObject({
      question: 'Evaluate task',
      anchors: score.type === 'score' ? score.anchors : [],
      context: { trigger: { value: 'task' } },
    });
    expect(r.result).toMatchObject({ observation: { answer: { probabilities: null } } });
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects malformed Noul probability %s', async (value) => {
    const e = await createTestEngine();
    e.ports.jev.classifyNoul = () => Promise.resolve({ type: 'noul', trueProbability: value });
    const r = await e.runToIdle(e.publish(loop(noul)).loopId);
    expect(r.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
  });
  it('requires actual Score confidence when a minimum is configured', async () => {
    const e = await createTestEngine();
    e.ports.jev.score = () => Promise.resolve({ ...scored(0.5), confidence: null });
    const r = await e.runToIdle(e.publish(loop(score, 0)).loopId);
    expect(r.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
  });
});
