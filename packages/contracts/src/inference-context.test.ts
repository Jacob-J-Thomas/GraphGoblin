import { describe, expect, it } from 'vitest';
import { RunEventSchema } from './events.js';
import { PromptProvenanceSchema } from './run.js';
import { InferenceContextSchema } from './harness.js';
import { fakeUlid } from './testing/index.js';
const context = {
  profile: 'qualified/test',
  contextTokens: 4096,
  outputReserveTokens: 1024,
  retainedHistoryPairs: 1,
  omittedHistoryPairs: 2,
};
describe('inference context provenance', () => {
  it('keeps context and exact prompt atomic in turn and unreconciled retry intent', () => {
    const turn = {
      runId: fakeUlid('run'),
      seq: 2,
      ts: '2026-11-08T00:00:00.000Z',
      type: 'harness.turn',
      nodeId: 'respond',
      visitId: 'visit',
      turnId: fakeUlid('turn'),
      harness: 'ollama',
      promptKind: 'authored',
      prompt: 'exact 🦎',
      context,
    };
    expect(RunEventSchema.parse(turn)).toEqual(turn);
    const retry = {
      visitId: turn.visitId,
      turnId: turn.turnId,
      submission: 'definitely-not-submitted',
      promptKind: turn.promptKind,
      retry: { harness: turn.harness, prompt: turn.prompt, context },
    };
    expect(PromptProvenanceSchema.parse(retry)).toEqual(retry);
  });
  it.each([
    { contextTokens: 0 },
    { outputReserveTokens: -1 },
    { retainedHistoryPairs: 0.5 },
    { omittedHistoryPairs: -1 },
    { profile: '' },
    { extra: true },
  ])('rejects invalid admission facts %j', (change) => {
    expect(InferenceContextSchema.safeParse({ ...context, ...change }).success).toBe(false);
  });
});
