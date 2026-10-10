import { describe, expect, it } from 'vitest';
import {
  ExitPredicateSchema,
  ExitCriterionEmissionSchema,
  ExitCriterionEvaluationSchema,
  PrimitiveAnswerSchema,
  PrimitiveAnswerEmissionSchema,
  PrimitiveEvaluationConfigSchema,
  PrimitiveEvaluationSchema,
  DecisionEmissionSchema,
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
const classifier = { kind: 'classifier', model: 'jev', question: 'Done?' };
const llm = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  question: 'Done?',
};
const choice = {
  type: 'choice',
  options: [
    { id: 'yes', label: 'Yes', criteria: 'Complete' },
    { id: 'no', label: 'No', criteria: 'Incomplete' },
  ],
};
const score = { type: 'score', anchors: ['None', 'Complete'] };
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
  answer: { type: 'noul', kind: 'expression', holds: true, confidence: null },
  provenance,
  acceptance: { status: 'accepted' },
  match: { type: 'noul', value: true },
};

describe('explicit exit primitives', () => {
  it('validates the supported pairs and refuses missing provider sides or irrelevant thresholds', () => {
    for (const [answer, evaluation] of [
      [{ type: 'noul' }, expression],
      [choice, expression],
      [sides, classifier],
      [choice, classifier],
      [score, classifier],
      [sides, llm],
      [choice, llm],
    ])
      expect(PrimitiveEvaluationConfigSchema.safeParse({ answer, evaluation }).success).toBe(true);
    for (const [answer, evaluation] of [
      [{ type: 'noul' }, classifier],
      [{ type: 'noul' }, llm],
      [score, expression],
      [score, llm],
      [choice, { ...classifier, truthThreshold: 0.4 }],
      [score, { ...classifier, truthThreshold: 0.4 }],
    ])
      expect(PrimitiveEvaluationConfigSchema.safeParse({ answer, evaluation }).success).toBe(false);
    expect(
      PrimitiveEvaluationConfigSchema.safeParse({
        answer: sides,
        evaluation: { ...classifier, truthThreshold: 0.4 },
      }).success,
    ).toBe(true);
  });
  it('defaults boolean matching and validates match declarations and reported confidence', () => {
    const predicate = {
      when: 'predicate',
      answer: { type: 'noul' },
      evaluation: expression,
      match: { type: 'noul' },
      outcome: 'success',
    };
    expect(ExitPredicateSchema.parse(predicate).match).toEqual({ type: 'noul', value: true });
    for (const bad of [
      { ...predicate, match: { type: 'choice', optionIds: ['yes'] } },
      { ...predicate, match: { type: 'noul', value: true, minReportedConfidence: 0.8 } },
      { ...predicate, answer: choice, match: { type: 'choice', optionIds: [] } },
      { ...predicate, answer: choice, match: { type: 'choice', optionIds: ['unknown'] } },
      { ...predicate, answer: choice, match: { type: 'choice', optionIds: ['yes', 'yes'] } },
      { ...predicate, answer: choice, match: { type: 'choice', optionIds: ['yes'] } },
      {
        ...predicate,
        answer: score,
        evaluation: classifier,
        match: { type: 'score', operator: 'gte', value: 2 },
      },
      {
        ...predicate,
        answer: score,
        evaluation: classifier,
        match: { type: 'score', operator: 'gte', value: Infinity },
      },
      { ...predicate, answer: { type: 'noul' }, evaluation: classifier },
    ])
      expect(ExitPredicateSchema.safeParse(bad).success).toBe(false);
    expect(
      ExitPredicateSchema.safeParse({
        ...predicate,
        answer: sides,
        evaluation: llm,
        match: { type: 'noul', value: false, minReportedConfidence: 0.8 },
      }).success,
    ).toBe(true);
    expect(
      ExitPredicateSchema.safeParse({
        ...predicate,
        answer: choice,
        evaluation: llm,
        match: { type: 'choice', optionIds: ['no'], minReportedConfidence: 0.8 },
      }).success,
    ).toBe(true);
    expect(
      ExitPredicateSchema.safeParse({
        ...predicate,
        answer: score,
        evaluation: classifier,
        match: { type: 'score', operator: 'gte', value: 0.5 },
      }).success,
    ).toBe(true);
  });
  it('allows factual unknowns only in canonical history and rejects every unknown fresh Noul fact', () => {
    const cases = [
      { type: 'noul', kind: 'expression', holds: null, confidence: null },
      { type: 'noul', kind: 'classifier', holds: false, trueProbability: null, confidence: 0.8 },
      { type: 'noul', kind: 'classifier', holds: true, trueProbability: 0.8, confidence: null },
      { type: 'noul', kind: 'llm', holds: true, confidence: null, reasoning: 'Done' },
      { type: 'noul', kind: 'llm', holds: true, confidence: 0.8, reasoning: null },
    ];
    for (const answer of cases) {
      expect(PrimitiveAnswerSchema.safeParse(answer).success).toBe(true);
      expect(PrimitiveAnswerEmissionSchema.safeParse(answer).success).toBe(false);
      expect(
        DecisionEmissionSchema.safeParse({ answer, portId: 'yes', provenance, diagnostics: [] })
          .success,
      ).toBe(false);
    }
    for (const answer of [
      evidence.answer,
      { type: 'noul', kind: 'classifier', holds: true, trueProbability: 0.8, confidence: 0.8 },
      { type: 'noul', kind: 'llm', holds: true, confidence: 0.8, reasoning: 'Done' },
      { type: 'choice', optionId: 'yes', confidence: null, probabilities: null },
    ])
      expect(PrimitiveAnswerEmissionSchema.safeParse(answer).success).toBe(true);
  });
  it('separates retained raw evidence, confidence rejection, and strict fresh emission', () => {
    expect(ExitCriterionEmissionSchema.safeParse(evidence).success).toBe(true);
    expect(
      ExitCriterionEvaluationSchema.safeParse({
        ...evidence,
        acceptance: null,
        answer: { ...evidence.answer, holds: null },
      }).success,
    ).toBe(true);
    for (const bad of [
      { ...evidence, acceptance: null },
      { ...evidence, strategy: 'llm' },
      {
        ...evidence,
        acceptance: { status: 'rejected', code: 'EVALUATION_RESULT_REJECTED', minConfidence: 0.8 },
      },
      { ...evidence, answer: { ...evidence.answer, holds: null } },
      {
        ...evidence,
        rejection: { kind: 'llm-reported-confidence', minimum: 0.8, confidence: 0.5 },
      },
      { index: 0, strategy: 'max-iterations', status: 'not-matched', holds: null },
    ])
      expect(ExitCriterionEmissionSchema.safeParse(bad).success).toBe(false);
    expect(
      ExitCriterionEmissionSchema.safeParse({
        index: 0,
        strategy: 'max-iterations',
        status: 'not-matched',
        holds: false,
      }).success,
    ).toBe(true);
    expect(
      ExitCriterionEmissionSchema.safeParse({
        index: 1,
        strategy: 'llm',
        status: 'skipped',
        reason: { code: 'EARLIER_CRITERION_MATCHED', message: 'Earlier match' },
      }).success,
    ).toBe(true);
    expect(
      ExitCriterionEmissionSchema.safeParse({
        index: 1,
        strategy: 'llm',
        status: 'error',
        provenance: { ...provenance, kind: 'llm' },
        diagnostic: { code: 'EVALUATION_PROVIDER_FAILED', message: 'Failed' },
      }).success,
    ).toBe(true);
    expect(
      PrimitiveEvaluationSchema.safeParse({
        answer: evidence.answer,
        provenance,
        acceptance: { status: 'rejected', code: 'EVALUATION_RESULT_REJECTED', minConfidence: 0.8 },
      }).success,
    ).toBe(true);
    expect(
      PrimitiveEvaluationSchema.safeParse({ answer: evidence.answer, provenance, acceptance: null })
        .success,
    ).toBe(false);
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
