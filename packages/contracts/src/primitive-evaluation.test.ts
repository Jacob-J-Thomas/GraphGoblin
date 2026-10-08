import { describe, expect, it } from 'vitest';
import {
  DecisionConfigSchema,
  DecisionEmissionSchema,
  EvaluationSchema,
  EvaluationAnswerSpecSchema,
  NoulAnswerSchema,
  NoulConfigSchema,
  ScoreConfigSchema,
  ScoreAnswerSchema,
} from './evaluation.js';
import { ClassifierNoulResponseSchema, ClassifierScoreResponseSchema } from './classifiers.js';

const noul = {
  type: 'noul',
  true: { id: 'yes', label: 'Ready', criteria: 'All checks pass' },
  false: { id: 'no', label: 'Needs work', criteria: 'Any check fails' },
};
const score = {
  type: 'score',
  anchors: ['Low', 'Medium', 'High', 'Critical'],
  bands: [
    { id: 'low', label: 'Low', min: 0, max: 1.5 },
    { id: 'high', label: 'High', min: 1.5, max: 3 },
  ],
};
const classifier = { kind: 'classifier', model: 'jev', question: 'Q' };
const expression = { kind: 'expression', jsonata: 'true' };
const llm = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  question: 'Q',
};

describe('primitive authoring', () => {
  it.each([expression, classifier, llm])(
    'admits Noul with one supported evaluator %j',
    (evaluation) => {
      const parsed = DecisionConfigSchema.parse({ answer: noul, evaluation });
      expect(DecisionConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      if (parsed.evaluation.kind !== 'expression')
        expect(parsed.evaluation.context).toEqual({ messages: 'last', includeLastOutput: true });
      expect(parsed.evaluation).not.toHaveProperty('truthThreshold');
    },
  );
  it('keeps the shared evaluation/base answer schemas free of decision-only selection and routes', () => {
    expect(EvaluationSchema.parse(classifier)).toEqual(classifier);
    expect(EvaluationSchema.safeParse({ ...classifier, context: {} }).success).toBe(false);
    expect(
      EvaluationAnswerSpecSchema.parse({
        type: 'noul',
        true: { label: 'Yes', criteria: 'Ready' },
        false: { label: 'No', criteria: 'Not ready' },
      }),
    ).toHaveProperty('type', 'noul');
    expect(EvaluationAnswerSpecSchema.parse({ type: 'score', anchors: score.anchors })).toEqual({
      type: 'score',
      anchors: score.anchors,
    });
  });
  it.each([
    { ...noul, false: noul.true },
    { ...noul, false: { ...noul.false, label: noul.true.label } },
    { ...noul, true: { ...noul.true, criteria: ' ' } },
    { ...noul, true: { ...noul.true, id: 'in' } },
    { ...noul, false: undefined },
  ])('requires complete distinct authored sides %j', (answer) => {
    expect(NoulConfigSchema.safeParse(answer).success).toBe(false);
  });
  it('permits truth thresholds only on classifier Noul and Score only on classifiers', () => {
    expect(
      DecisionConfigSchema.parse({ answer: noul, evaluation: { ...classifier, truthThreshold: 0 } })
        .evaluation,
    ).toHaveProperty('truthThreshold', 0);
    for (const evaluation of [expression, llm]) {
      expect(DecisionConfigSchema.safeParse({ answer: score, evaluation }).success).toBe(false);
      expect(
        DecisionConfigSchema.safeParse({
          answer: noul,
          evaluation: { ...evaluation, truthThreshold: 0.5 },
        }).success,
      ).toBe(false);
    }
    expect(
      DecisionConfigSchema.safeParse({
        answer: score,
        evaluation: { ...classifier, truthThreshold: 0.5 },
      }).success,
    ).toBe(false);
    expect(DecisionConfigSchema.safeParse({ answer: score, evaluation: classifier }).success).toBe(
      true,
    );
  });
  it('validates full score coverage independent of display order', () => {
    expect(
      ScoreConfigSchema.parse({ ...score, bands: [...score.bands].reverse() }).bands.map(
        (band) => band.id,
      ),
    ).toEqual(['high', 'low']);
    expect(
      ScoreConfigSchema.parse({ ...score, bands: [{ id: 'all', label: 'All', min: 0, max: 3 }] })
        .bands,
    ).toHaveLength(1);
  });
  it.each([
    { ...score, anchors: ['Only'] },
    { ...score, anchors: ['Low', ' '] },
    { ...score, bands: [] },
    { ...score, bands: [score.bands[0], score.bands[0]] },
    { ...score, bands: [score.bands[0], { ...score.bands[1], label: 'Low' }] },
    { ...score, bands: [{ ...score.bands[0], min: 0.1 }, score.bands[1]] },
    { ...score, bands: [score.bands[0], { ...score.bands[1], min: 1.6 }] },
    { ...score, bands: [score.bands[0], { ...score.bands[1], min: 1.4 }] },
    { ...score, bands: [{ ...score.bands[0], max: 0 }, score.bands[1]] },
    { ...score, bands: [score.bands[0]] },
    { ...score, bands: [{ ...score.bands[0], max: Infinity }, score.bands[1]] },
    { ...score, bands: [{ id: 'all', label: 'All', min: 0, max: 4 }] },
  ])('rejects invalid rubric/bands %j', (answer) => {
    expect(ScoreConfigSchema.safeParse(answer).success).toBe(false);
  });
});

describe('primitive facts', () => {
  it('keeps boolean answers distinct from classifier true probability', () => {
    expect(
      NoulAnswerSchema.parse({ type: 'noul', kind: 'expression', holds: false, confidence: null }),
    ).not.toHaveProperty('trueProbability');
    expect(
      NoulAnswerSchema.parse({
        type: 'noul',
        kind: 'classifier',
        holds: false,
        trueProbability: 0.7,
        confidence: 1 - 0.7,
      }),
    ).toHaveProperty('trueProbability', 0.7);
    expect(
      NoulAnswerSchema.safeParse({
        type: 'noul',
        kind: 'llm',
        holds: true,
        confidence: 0.8,
        reasoning: 'Ready',
        trueProbability: 0.8,
      }).success,
    ).toBe(false);
  });
  it.each([undefined, 'high', NaN, Infinity, -0.1, 1.1])(
    'rejects missing or invalid LLM confidence %j',
    (confidence) => {
      expect(
        NoulAnswerSchema.safeParse({
          type: 'noul',
          kind: 'llm',
          holds: true,
          confidence,
          reasoning: 'Ready',
        }).success,
      ).toBe(false);
    },
  );
  it('admits applicable fresh Noul and Score evidence without altering old Choice facts', () => {
    const provenance = {
      kind: 'classifier',
      provider: 'typesafe',
      classifierId: 'jev',
      model: 'jev-latest',
      effort: null,
    };
    const answer = {
      type: 'noul',
      kind: 'classifier',
      holds: true,
      trueProbability: 0.8,
      confidence: 0.8,
    };
    expect(
      DecisionEmissionSchema.safeParse({ answer, portId: 'yes', provenance, diagnostics: [] })
        .success,
    ).toBe(true);
    expect(
      DecisionEmissionSchema.safeParse({
        answer,
        portId: 'yes',
        provenance: {
          ...provenance,
          kind: 'llm',
          provider: 'codex',
          classifierId: null,
          effort: 'low',
        },
        diagnostics: [],
      }).success,
    ).toBe(false);
    const scoreAnswer = {
      type: 'score',
      score: 1.25,
      confidence: null,
      legend: { '0': 'Low', '1': 'High' },
      probabilities: null,
    };
    expect(ScoreAnswerSchema.parse(scoreAnswer)).toEqual(scoreAnswer);
    expect(
      DecisionEmissionSchema.safeParse({
        answer: scoreAnswer,
        portId: 'low',
        provenance,
        diagnostics: [],
      }).success,
    ).toBe(true);
    expect(
      DecisionEmissionSchema.safeParse({
        answer: scoreAnswer,
        portId: 'low',
        provenance: {
          kind: 'expression',
          provider: null,
          classifierId: null,
          model: null,
          effort: null,
        },
        diagnostics: [],
      }).success,
    ).toBe(false);
    expect(
      DecisionEmissionSchema.safeParse({
        answer: { type: 'noul', kind: 'expression', holds: false, confidence: null },
        portId: 'no',
        provenance: {
          kind: 'expression',
          provider: null,
          classifierId: null,
          model: null,
          effort: null,
        },
        diagnostics: [],
      }).success,
    ).toBe(true);
    expect(
      DecisionEmissionSchema.safeParse({
        answer: {
          type: 'noul',
          kind: 'llm',
          holds: false,
          confidence: 0.7,
          reasoning: 'Needs work',
        },
        portId: 'no',
        provenance: {
          kind: 'llm',
          provider: 'codex',
          classifierId: null,
          model: 'gpt-6-luna',
          effort: 'low',
        },
        diagnostics: [],
      }).success,
    ).toBe(true);
  });
  it('validates primitive HTTP responses without requiring unrelated provider metadata', () => {
    expect(
      ClassifierNoulResponseSchema.parse({ answers: { answer: { type: 'noul', noul: 0 } } }).answers
        .answer.noul,
    ).toBe(0);
    expect(
      ClassifierNoulResponseSchema.safeParse({ answers: { answer: { type: 'noul', noul: 1.1 } } })
        .success,
    ).toBe(false);
    expect(
      ClassifierScoreResponseSchema.parse({
        answers: { answer: { type: 'score', score: 0.3, legend: { '0': 'Low', '1': 'High' } } },
      }).answers.answer,
    ).not.toHaveProperty('confidence');
  });
});
