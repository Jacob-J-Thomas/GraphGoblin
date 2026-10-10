import { describe, expect, it } from 'vitest';
import {
  ChoiceAnswerSchema,
  DecisionConfigSchema,
  DecisionEmissionSchema,
  DecisionEvidenceSchema,
  DecisionPayloadSchema,
  HarnessDefaultsSchema,
  type DecisionEvidence,
} from './evaluation.js';
const options = [
  { id: 'pass', label: 'Pass', criteria: 'Meets the criterion' },
  { id: 'retry', label: 'Retry', criteria: 'Needs another attempt' },
];
const expression = { kind: 'expression', jsonata: '"pass"' };
const classifier = { kind: 'classifier', model: 'jev', question: 'Q' };
const llm = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'explicit', value: 'high' },
  question: 'Q',
};
const expressionEvidence: DecisionEvidence = {
  answer: { type: 'choice', optionId: 'pass', confidence: null, probabilities: null },
  portId: 'pass',
  provenance: { kind: 'expression', provider: null, classifierId: null, model: null, effort: null },
  diagnostics: [],
};
const classifierEvidence: DecisionEvidence = {
  answer: {
    type: 'choice',
    optionId: 'pass',
    confidence: 0.8,
    probabilities: { pass: 0.8, retry: 0.2 },
  },
  portId: 'pass',
  provenance: {
    kind: 'classifier',
    provider: 'typesafe',
    classifierId: 'jev',
    model: 'jev-latest',
    effort: null,
  },
  diagnostics: [],
};
const llmEvidence: DecisionEvidence = {
  answer: { type: 'choice', optionId: 'pass', confidence: 0.9, probabilities: null },
  portId: 'pass',
  provenance: {
    kind: 'llm',
    provider: 'codex',
    classifierId: null,
    model: 'gpt-6-luna',
    effort: 'high',
  },
  diagnostics: [],
};
describe('Choice authoring contract', () => {
  it.each([expression, classifier, llm])(
    'round-trips each single evaluation kind (%j)',
    (evaluation) => {
      const parsed = DecisionConfigSchema.parse({
        answer: { type: 'choice', options },
        evaluation,
      });
      expect(DecisionConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    },
  );
  it('requires complete explicit selections and rejects old or inactive fields', () => {
    for (const evaluation of [
      { ...llm, model: { mode: 'explicit' } },
      { ...llm, effort: { mode: 'explicit', value: 'ultra' } },
      { ...llm, minConfidence: 0.5 },
      { ...llm, harness: 'claude' },
      { ...classifier, model: undefined },
      { ...expression, question: 'inactive' },
      { kind: 'future', question: 'Q' },
      [{ ...expression }, { ...classifier }],
    ])
      expect(
        DecisionConfigSchema.safeParse({ answer: { type: 'choice', options }, evaluation }).success,
      ).toBe(false);
    expect(
      DecisionConfigSchema.safeParse({
        answer: { type: 'choice', options },
        evaluation: expression,
        strategy: ['expression'],
      }).success,
    ).toBe(false);
    expect(HarnessDefaultsSchema.safeParse({ model: 'old', effort: 'low' }).success).toBe(false);
    expect(HarnessDefaultsSchema.parse({})).toEqual({ byHarness: {} });
    expect(
      HarnessDefaultsSchema.safeParse({ byHarness: { unknown: { model: 'x' } } }).success,
    ).toBe(false);
  });
  it('rejects duplicate IDs/labels, blank criteria, invalid ports and unsupported answer types', () => {
    for (const answer of [
      { type: 'choice', options: [options[0], options[0]] },
      { type: 'choice', options: [options[0], { ...options[1], label: 'Pass' }] },
      { type: 'choice', options: [options[0], { ...options[1], criteria: '   ' }] },
      { type: 'choice', options: [options[0], { ...options[1], id: 'in' }] },
      { type: 'choice', options: [options[0], { ...options[1], id: '2' }] },
      { type: 'choice', options: [] },
      { type: 'boolean', options },
    ])
      expect(DecisionConfigSchema.safeParse({ answer, evaluation: expression }).success).toBe(
        false,
      );
    const parsed = DecisionConfigSchema.parse({
      answer: {
        type: 'choice',
        options: [{ ...options[0], label: '  Pass  ', criteria: ' Criterion ' }, options[1]],
      },
      evaluation: expression,
    });
    expect(parsed.answer).toMatchObject({
      options: [{ label: 'Pass', criteria: 'Criterion' }, options[1]],
    });
  });
});
describe('canonical evidence and fresh emission', () => {
  it.each([expressionEvidence, classifierEvidence, llmEvidence])(
    'admits fresh evidence consistent with its evaluation kind (%j)',
    (evidence) => expect(DecisionEmissionSchema.parse(evidence)).toEqual(evidence),
  );
  it('permits unknown factual historical fields, but rejects them for fresh provider execution', () => {
    const historic = {
      ...classifierEvidence,
      answer: { ...classifierEvidence.answer, confidence: null, probabilities: null },
      provenance: {
        ...classifierEvidence.provenance,
        provider: null,
        classifierId: null,
        model: null,
      },
      diagnostics: [
        {
          provenance: { ...expressionEvidence.provenance, kind: 'llm' },
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Decision provider unavailable',
        },
      ],
    };
    expect(DecisionEvidenceSchema.safeParse(historic).success).toBe(true);
    expect(DecisionEmissionSchema.safeParse(historic).success).toBe(false);
    expect(
      DecisionEvidenceSchema.safeParse({
        ...historic,
        diagnostics: Array(4).fill(historic.diagnostics[0]),
      }).success,
    ).toBe(false);
  });
  it('requires universal named fields and matching portId even for canonical history', () => {
    const { effort: _effort, ...provenance } = classifierEvidence.provenance;
    expect(DecisionEvidenceSchema.safeParse({ ...classifierEvidence, provenance }).success).toBe(
      false,
    );
    expect(
      DecisionPayloadSchema.safeParse({
        ...classifierEvidence,
        diagnostics: undefined,
        portId: 'retry',
      }).success,
    ).toBe(false);
    const { diagnostics: _diagnostics, ...payload } = classifierEvidence;
    expect(DecisionPayloadSchema.safeParse({ ...payload, portId: 'retry' }).success).toBe(false);
    expect(
      DecisionEvidenceSchema.safeParse({ ...classifierEvidence, portId: 'retry' }).success,
    ).toBe(false);
    expect(DecisionPayloadSchema.parse(payload)).toEqual(payload);
  });
  it('rejects fresh evidence with fabricated or incompatible provenance/confidence', () => {
    for (const provenance of [
      { ...expressionEvidence.provenance, provider: 'x' },
      { ...expressionEvidence.provenance, classifierId: 'jev' },
      { ...expressionEvidence.provenance, model: 'x' },
      { ...expressionEvidence.provenance, effort: 'low' },
    ])
      expect(DecisionEmissionSchema.safeParse({ ...expressionEvidence, provenance }).success).toBe(
        false,
      );
    expect(
      DecisionEmissionSchema.safeParse({
        ...expressionEvidence,
        answer: { ...expressionEvidence.answer, confidence: 1 },
      }).success,
    ).toBe(false);
    for (const evidence of [
      {
        ...classifierEvidence,
        provenance: { ...classifierEvidence.provenance, classifierId: null },
      },
      { ...classifierEvidence, provenance: { ...classifierEvidence.provenance, effort: 'low' } },
      { ...llmEvidence, provenance: { ...llmEvidence.provenance, provider: 'other' } },
      { ...llmEvidence, provenance: { ...llmEvidence.provenance, classifierId: 'jev' } },
      { ...llmEvidence, provenance: { ...llmEvidence.provenance, effort: null } },
      { ...llmEvidence, answer: { ...llmEvidence.answer, probabilities: { pass: 1, retry: 0 } } },
    ])
      expect(DecisionEmissionSchema.safeParse(evidence).success).toBe(false);
  });
  it.each([NaN, Infinity, -1, 1.01])(
    'rejects invalid numeric confidence/probability %s',
    (value) => {
      expect(
        ChoiceAnswerSchema.safeParse({ ...classifierEvidence.answer, confidence: value }).success,
      ).toBe(false);
      expect(
        ChoiceAnswerSchema.safeParse({
          ...classifierEvidence.answer,
          probabilities: { pass: value, retry: 0 },
        }).success,
      ).toBe(false);
    },
  );
});
