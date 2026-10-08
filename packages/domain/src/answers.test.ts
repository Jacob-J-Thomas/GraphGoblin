import { describe, expect, it } from 'vitest';
import {
  ChoiceConfigSchema,
  NoulConfigSchema,
  ScoreConfigSchema,
  type PrimitiveAnswer,
  type ScoreAnswer,
} from '@graphgoblin/contracts';
import { answerPortIds, decisionPortId, validatePrimitiveAnswer } from './answers.js';
import { outputPorts } from './graph.js';

const choice = ChoiceConfigSchema.parse({
  type: 'choice',
  options: [
    { id: 'yes', label: 'Yes', criteria: 'Ready' },
    { id: 'no', label: 'No', criteria: 'Needs work' },
  ],
});
const noul = NoulConfigSchema.parse({
  type: 'noul',
  true: choice.options[0],
  false: choice.options[1],
});
const score = ScoreConfigSchema.parse({
  type: 'score',
  anchors: ['Low', 'Medium', 'High', 'Critical'],
  bands: [
    { id: 'high', label: 'High', min: 1.5, max: 3 },
    { id: 'low', label: 'Low', min: 0, max: 1.5 },
  ],
});
const scoreAnswer: ScoreAnswer = {
  type: 'score',
  score: 1.25,
  confidence: 0.8,
  legend: { '0': 'Low', '1': 'Medium', '2': 'High', '3': 'Critical' },
  probabilities: { '0': 0, '1': 0.75, '2': 0.25, '3': 0 },
};
const choiceAnswer: PrimitiveAnswer = {
  type: 'choice',
  optionId: 'yes',
  confidence: null,
  probabilities: null,
};

describe('primitive validation and routing', () => {
  it('uses stable Choice and Noul route IDs', () => {
    expect(decisionPortId(choice, choiceAnswer)).toBe('yes');
    expect(
      decisionPortId(noul, { type: 'noul', kind: 'expression', holds: false, confidence: null }),
    ).toBe('no');
    expect(
      decisionPortId(noul, {
        type: 'noul',
        kind: 'classifier',
        holds: true,
        trueProbability: 0.5,
        confidence: 0.5,
      }),
    ).toBe('yes');
    expect(
      decisionPortId(noul, {
        type: 'noul',
        kind: 'llm',
        holds: true,
        confidence: 0.8,
        reasoning: 'Ready',
      }),
    ).toBe('yes');
    expect(answerPortIds(choice)).toEqual(['yes', 'no']);
    expect(answerPortIds(noul)).toEqual(['yes', 'no']);
    expect(answerPortIds(score)).toEqual(['high', 'low']);
    expect(
      outputPorts({
        id: 'rate',
        kind: 'decision',
        label: 'Rate',
        ui: { x: 0, y: 0 },
        config: {
          answer: score,
          evaluation: {
            kind: 'classifier',
            model: 'jev',
            question: 'Rate',
            context: { messages: 'last', includeLastOutput: true },
          },
          recordAlternatives: true,
        },
      }),
    ).toEqual(['high', 'low']);
  });
  it.each([
    [0, 'low'],
    [1.25, 'low'],
    [1.499999, 'low'],
    [1.5, 'high'],
    [2.99, 'high'],
    [3, 'high'],
  ] as const)('routes fractional score %s to %s', (value, port) => {
    expect(decisionPortId(score, { ...scoreAnswer, score: value })).toBe(port);
  });
  it('rejects primitive mismatch, malformed values and undeclared Choice/probability IDs', () => {
    expect(validatePrimitiveAnswer(noul, choiceAnswer)).toMatch(/different/);
    expect(validatePrimitiveAnswer(choice, { ...choiceAnswer, confidence: Infinity })).toMatch(
      /malformed/,
    );
    expect(validatePrimitiveAnswer(choice, { ...choiceAnswer, optionId: 'unknown' })).toMatch(
      /declared/,
    );
    expect(
      validatePrimitiveAnswer(choice, { ...choiceAnswer, probabilities: { yes: 0.7 } }),
    ).toMatch(/exactly/);
    expect(
      validatePrimitiveAnswer(choice, { ...choiceAnswer, probabilities: { yes: 0.7, extra: 0.3 } }),
    ).toMatch(/exactly/);
    expect(
      validatePrimitiveAnswer(choice, { ...choiceAnswer, probabilities: { yes: 0.7, no: 0.3 } }),
    ).toBeNull();
    expect(() => decisionPortId(choice, { ...choiceAnswer, optionId: 'unknown' })).toThrow(
      /declared/,
    );
  });
  it('retains selected-side Noul confidence independently of probability threshold', () => {
    expect(
      validatePrimitiveAnswer(noul, {
        type: 'noul',
        kind: 'classifier',
        holds: false,
        trueProbability: 0.7,
        confidence: 1 - 0.7,
      }),
    ).toBeNull();
    expect(
      validatePrimitiveAnswer(noul, {
        type: 'noul',
        kind: 'classifier',
        holds: false,
        trueProbability: 0.7,
        confidence: 0.7,
      }),
    ).toMatch(/selected boolean/);
  });
  it.each([
    { ...scoreAnswer, score: 3.01 },
    { ...scoreAnswer, legend: { ...scoreAnswer.legend, '4': 'Extra' } },
    { ...scoreAnswer, legend: { '0': 'Wrong', '1': 'Medium', '2': 'High', '3': 'Critical' } },
    { ...scoreAnswer, probabilities: { '0': 0, '1': 1, '2': 0 } },
    { ...scoreAnswer, probabilities: { '0': 0, '1': 1, '2': 0, extra: 0 } },
  ])('rejects invalid Score fact %j', (answer) => {
    expect(validatePrimitiveAnswer(score, answer)).not.toBeNull();
  });
  it('retains honest absent Score confidence/probabilities and rejects an uncovered route', () => {
    expect(
      validatePrimitiveAnswer(score, { ...scoreAnswer, confidence: null, probabilities: null }),
    ).toBeNull();
    expect(() => decisionPortId({ ...score, bands: [] }, scoreAnswer)).toThrow(
      /no declared output/,
    );
  });
});
