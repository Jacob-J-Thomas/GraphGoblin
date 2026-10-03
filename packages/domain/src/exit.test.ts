import { describe, expect, it, vi } from 'vitest';
import { ExitConfigSchema } from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { evaluateExit, type ExitContext } from './exit.js';

function ctx(overrides: Partial<ExitContext> = {}): ExitContext {
  return {
    thread: sampleThread(),
    iteration: 1,
    maxIterations: 5,
    elapsedMs: 0,
    askPredicate: vi.fn().mockResolvedValue({ holds: true, confidence: 0.9 }),
    renderQuestion: vi.fn((t: string) => Promise.resolve(`Q:${t}`)),
    ...overrides,
  };
}

describe('evaluateExit', () => {
  it('defaults to success with no criteria', async () => {
    const decision = await evaluateExit(ExitConfigSchema.parse({}), ctx());
    expect(decision).toEqual({ kind: 'finish', outcome: 'success', reason: 'default' });
  });

  it('loops back until the criterion or ceiling is reached', async () => {
    const config = ExitConfigSchema.parse({
      criteria: [{ when: 'max-iterations', value: 3 }],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
    });
    expect(await evaluateExit(config, ctx({ iteration: 1 }))).toEqual({
      kind: 'loop-back',
      targetNodeId: 'prep',
    });
    const atLimit = await evaluateExit(config, ctx({ iteration: 3 }));
    expect(atLimit.kind === 'finish' && atLimit.outcome).toBe('exhausted');
    const ceiling = await evaluateExit(config, ctx({ iteration: 2, maxIterations: 2 }));
    expect(ceiling).toMatchObject({ kind: 'finish', outcome: 'exhausted' });
    expect(ceiling.kind === 'finish' && ceiling.reason).toMatch(/ceiling/);
  });

  it('evaluates duration and last-output criteria', async () => {
    const config = ExitConfigSchema.parse({
      criteria: [
        { when: 'max-duration', seconds: 10 },
        { when: 'last-output-matches', jsonSchema: { type: 'object', required: ['done'] } },
      ],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
    });
    expect(await evaluateExit(config, ctx({ elapsedMs: 10_000 }))).toMatchObject({
      kind: 'finish',
      outcome: 'exhausted',
      criterionIndex: 0,
    });
    expect(await evaluateExit(config, ctx({ elapsedMs: 1 }))).toEqual({
      kind: 'loop-back',
      targetNodeId: 'prep',
    });
    const withOutput = ctx({
      thread: sampleThread({
        lastOutput: { nodeId: 'infer', value: { done: true }, at: '2026-10-02T12:00:00.000Z' },
      }),
    });
    expect(await evaluateExit(config, withOutput)).toMatchObject({
      kind: 'finish',
      outcome: 'success',
      criterionIndex: 1,
    });
  });

  it('evaluates expression predicates against the thread view', async () => {
    const config = ExitConfigSchema.parse({
      criteria: [
        {
          when: 'predicate',
          strategy: 'expression',
          jsonata: 'vars.count = 2',
          outcome: 'failure',
        },
      ],
    });
    expect(await evaluateExit(config, ctx())).toMatchObject({ kind: 'finish', outcome: 'failure' });
  });

  it('asks the engine for jev and codex predicates and honours confidence', async () => {
    const config = ExitConfigSchema.parse({
      criteria: [
        {
          when: 'predicate',
          strategy: 'jev',
          question: 'Done {{ vars.topic }}?',
          minConfidence: 0.8,
          outcome: 'success',
        },
      ],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
    });
    const confident = ctx();
    expect(await evaluateExit(config, confident)).toMatchObject({
      kind: 'finish',
      outcome: 'success',
    });
    expect(confident.renderQuestion).toHaveBeenCalledWith('Done {{ vars.topic }}?');
    expect(confident.askPredicate).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'jev' }),
      'Q:Done {{ vars.topic }}?',
    );

    const unsure = ctx({
      askPredicate: vi.fn().mockResolvedValue({ holds: true, confidence: 0.5 }),
    });
    expect(await evaluateExit(config, unsure)).toEqual({ kind: 'loop-back', targetNodeId: 'prep' });

    const no = ctx({ askPredicate: vi.fn().mockResolvedValue({ holds: false }) });
    expect(await evaluateExit(config, no)).toEqual({ kind: 'loop-back', targetNodeId: 'prep' });

    const noConfidence = ctx({ askPredicate: vi.fn().mockResolvedValue({ holds: true }) });
    expect(await evaluateExit(config, noConfidence)).toMatchObject({
      kind: 'finish',
      outcome: 'success',
    });
  });
});
