import { describe, it, expect } from 'vitest';
import {
  ExitPredicateSchema,
  ExitCriterionEmissionSchema,
  ExitCriterionEvaluationSchema,
  PredicateConfigSchema,
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
const expression = { kind: 'expression', jsonata: 'true' };
const provenance = {
  kind: 'expression',
  provider: null,
  classifierId: null,
  model: null,
  effort: null,
};
const evidence = {
  index: 0,
  strategy: 'expression',
  status: 'matched',
  observation: { kind: 'boolean', holds: true, confidence: null, reasoning: null },
  provenance,
  acceptance: { status: 'accepted' },
  match: { type: 'boolean', value: true },
};
describe('separate exit predicate contract', () => {
  it('admits boolean expressions, Codex boolean instructions and classifier comparisons', () => {
    for (const predicate of [
      expression,
      {
        kind: 'llm',
        instructions: 'Done?',
        harness: 'codex',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
      },
      ...[sides, choice, score].map((answer) => ({ ...classifier, answer })),
    ])
      expect(PredicateConfigSchema.safeParse(predicate).success).toBe(true);
    expect(
      PredicateConfigSchema.safeParse({ ...expression, answer: { type: 'noul' } }).success,
    ).toBe(false);
    expect(
      PredicateConfigSchema.safeParse({ ...classifier, answer: choice, truthThreshold: 0.5 })
        .success,
    ).toBe(false);
    expect(
      PredicateConfigSchema.safeParse({ ...classifier, answer: { type: 'noul' } }).success,
    ).toBe(false);
  });
  it('defaults boolean matching and checks classifier matches precisely', () => {
    const criterion = {
      when: 'predicate',
      predicate: expression,
      match: { type: 'boolean' },
      outcome: 'success',
    };
    expect(ExitPredicateSchema.parse(criterion).match).toEqual({ type: 'boolean', value: true });
    for (const match of [
      { type: 'choice', optionIds: ['yes'] },
      { type: 'boolean', minReportedConfidence: 0.8 },
    ])
      expect(ExitPredicateSchema.safeParse({ ...criterion, match }).success).toBe(false);
    for (const optionIds of [[], ['unknown'], ['yes', 'yes']])
      expect(
        ExitPredicateSchema.safeParse({
          ...criterion,
          predicate: { ...classifier, answer: choice },
          match: { type: 'choice', optionIds },
        }).success,
      ).toBe(false);
    expect(
      ExitPredicateSchema.safeParse({
        ...criterion,
        predicate: { ...classifier, answer: score },
        match: { type: 'score', operator: 'gte', value: 2 },
      }).success,
    ).toBe(false);
    expect(
      ExitPredicateSchema.safeParse({
        ...criterion,
        predicate: { ...classifier, answer: score },
        match: { type: 'score', operator: 'gte', value: 0.5 },
      }).success,
    ).toBe(true);
  });
  it('checks fresh predicate facts without fabricating a decision port', () => {
    expect(ExitCriterionEmissionSchema.safeParse(evidence).success).toBe(true);
    const historical = {
      ...evidence,
      acceptance: null,
      observation: { ...evidence.observation, holds: null },
    };
    expect(ExitCriterionEvaluationSchema.safeParse(historical).success).toBe(true);
    for (const bad of [
      historical,
      { ...evidence, acceptance: null },
      { ...evidence, strategy: 'llm' },
      {
        ...evidence,
        acceptance: { status: 'rejected', code: 'EVALUATION_RESULT_REJECTED', minConfidence: 0.8 },
      },
      { ...evidence, rejection: { kind: 'classifier-confidence', minimum: 0.8, confidence: 0.5 } },
      { index: 0, strategy: 'max-iterations', status: 'matched', holds: null },
    ])
      expect(ExitCriterionEmissionSchema.safeParse(bad).success).toBe(false);
    for (const input of [
      { index: 0, strategy: 'max-iterations', status: 'not-matched', holds: false },
      {
        index: 1,
        strategy: 'llm',
        status: 'skipped',
        reason: { code: 'EARLIER_CRITERION_MATCHED', message: 'Earlier match' },
      },
      {
        index: 1,
        strategy: 'llm',
        status: 'error',
        diagnostic: { code: 'EVALUATION_PROVIDER_FAILED', message: 'Failed' },
      },
    ])
      expect(ExitCriterionEmissionSchema.safeParse(input).success).toBe(true);
  });
});
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
