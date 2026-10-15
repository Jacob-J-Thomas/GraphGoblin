import { describe, it, expect } from 'vitest';
import {
  V2LoopDefinitionSchema,
  V2NodeConfigSchemas,
  V2DecisionConfigSchema,
  LoopDefinitionSchema,
} from './index.js';
import { minimalLoop } from './testing/index.js';
const sides = {
  type: 'noul',
  true: { label: 'Yes', criteria: 'Complete' },
  false: { label: 'No', criteria: 'Incomplete' },
};
const choice = {
  type: 'choice',
  options: [
    { id: 'yes', label: 'Yes', criteria: 'Complete' },
    { id: 'no', label: 'No', criteria: 'Incomplete' },
  ],
};
const score = { type: 'score', anchors: ['None', 'Complete'] };
const classifier = { kind: 'classifier', model: 'jev', question: 'Done?' };
const llm = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  question: 'Done?',
};
describe('frozen format-2 targets', () => {
  it('retains old exit parsing and exact nested default injection after current contracts become format 3', () => {
    const old = { ...minimalLoop(), schemaVersion: 2 };
    const parsed = V2LoopDefinitionSchema.parse(old);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.settings).toEqual({
      workingDirectory: { kind: 'temp' },
      defaults: { byHarness: {} },
      maxIterations: 10,
      subloopDepthLimit: 8,
    });
    expect(parsed.nodes[1]?.kind === 'exit' && parsed.nodes[1].config.return).toEqual({
      mapping: 'none',
      channels: [{ kind: 'caller' }],
    });
    expect(parsed.edges[0]?.to.port).toBe('in');
    expect(LoopDefinitionSchema.safeParse(old).success).toBe(false);
    expect(
      V2NodeConfigSchemas.exit.safeParse({
        criteria: [{ when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' }],
      }).success,
    ).toBe(true);
  });
  it('retains additive Noul/Score and original refinement failures', () => {
    const noul = {
      ...sides,
      true: { ...sides.true, id: 'yes' },
      false: { ...sides.false, id: 'no' },
    };
    expect(V2DecisionConfigSchema.safeParse({ answer: noul, evaluation: classifier }).success).toBe(
      true,
    );
    expect(
      V2DecisionConfigSchema.safeParse({
        answer: { ...score, bands: [{ id: 'all', label: 'All', min: 0, max: 1 }] },
        evaluation: classifier,
      }).success,
    ).toBe(true);
    for (const config of [
      { answer: { ...noul, false: { ...noul.false, id: 'yes' } }, evaluation: classifier },
      {
        answer: { ...score, bands: [{ id: 'all', label: 'All', min: 0.5, max: 1 }] },
        evaluation: classifier,
      },
      { answer: choice, evaluation: { ...classifier, truthThreshold: 0.5 } },
      {
        answer: { ...score, bands: [{ id: 'all', label: 'All', min: 0, max: 1 }] },
        evaluation: llm,
      },
    ])
      expect(V2DecisionConfigSchema.safeParse(config).success).toBe(false);
    expect(V2NodeConfigSchemas.exit.safeParse({ default: 'loop-back' }).success).toBe(false);
  });
});
