import { describe, it, expect } from 'vitest';
import {
  DecisionConfigSchema,
  DecisionEmissionSchema,
  DecisionEvidenceSchema,
  DecisionPayloadSchema,
  EvaluationEmissionSchema,
  HarnessDefaultsSchema,
  RouteDeclarationsSchema,
} from './evaluation.js';
const routes = [
  { id: 'pass', label: 'Pass' },
  { id: 'retry', label: 'Retry' },
];
const configs = [
  { kind: 'expression', jsonata: '"pass"', routes },
  {
    kind: 'llm',
    instructions: 'Choose {{ vars.result }}',
    routes,
    harness: 'codex',
    model: { mode: 'inherit' },
    effort: { mode: 'inherit' },
  },
  {
    kind: 'classifier',
    model: 'jev',
    question: 'Q',
    answer: { type: 'choice', options: routes.map((r) => ({ ...r, criteria: r.label })) },
  },
];
const provenance = {
  kind: 'expression',
  provider: null,
  classifierId: null,
  model: null,
  effort: null,
};
const fact = {
  portId: 'pass',
  provenance,
  observation: { kind: 'route', routeId: 'pass', confidence: null, reasoning: null },
};
describe('evaluator-specific decision contracts', () => {
  it.each(configs)('round-trips the $kind branch without inactive settings', (config) => {
    const parsed = DecisionConfigSchema.parse(config);
    expect(DecisionConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    if (parsed.kind === 'classifier') expect(parsed.recordAlternatives).toBe(true);
    if (parsed.kind !== 'expression')
      expect(parsed.context).toEqual({ messages: 'last', includeLastOutput: true });
  });
  it.each([
    [{ ...configs[0], jsonata: ' ' }, ['jsonata']],
    [{ ...configs[0], jsonata: '' }, ['jsonata']],
    [{ ...configs[0], jsonata: 'x'.repeat(100001) }, ['jsonata']],
    [{ ...configs[1], instructions: 'x'.repeat(100001) }, ['instructions']],
    [{ ...configs[1], harness: 'claude' }, ['harness']],
    [{ ...configs[1], model: { mode: 'explicit', value: 'x'.repeat(257) } }, ['model', 'value']],
    [{ ...configs[1], effort: { mode: 'explicit', value: 'ultra' } }, ['effort', 'value']],
    [{ ...configs[2], model: undefined }, ['model']],
  ] as const)('reports the exact branch path %#', (input, path) => {
    const result = DecisionConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path)).toContainEqual(path);
  });
  it.each([
    'answer',
    'evaluation',
    'question',
    'context',
    'minConfidence',
    'truthThreshold',
    'recordAlternatives',
  ])('rejects inactive expression field %s', (key) => {
    expect(DecisionConfigSchema.safeParse({ ...configs[0], [key]: {} }).success).toBe(false);
  });
  it.each(['minConfidence', 'truthThreshold', 'recordAlternatives', 'answer', 'question'])(
    'rejects inactive LLM field %s',
    (key) => {
      expect(DecisionConfigSchema.safeParse({ ...configs[1], [key]: 0 }).success).toBe(false);
    },
  );
  it.each([
    [
      [{ id: 'in', label: 'A' }, routes[1]],
      [0, 'id'],
    ],
    [
      [{ id: 'Bad ID', label: 'A' }, routes[1]],
      [0, 'id'],
    ],
    [
      [{ id: 'a'.repeat(65), label: 'A' }, routes[1]],
      [0, 'id'],
    ],
    [
      [routes[0], routes[0]],
      [1, 'id'],
    ],
    [
      [routes[0], { id: 'b', label: ' Pass ' }],
      [1, 'label'],
    ],
    [
      [{ id: 'a', label: ' ' }, routes[1]],
      [0, 'label'],
    ],
    [
      [{ id: 'a', label: 'x'.repeat(121) }, routes[1]],
      [0, 'label'],
    ],
  ] as const)('validates route identifiers and trimmed labels %#', (input, path) => {
    const result = RouteDeclarationsSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path)).toContainEqual(path);
  });
  it('enforces two to sixty-four routes and trims labels', () => {
    for (const count of [0, 1, 65])
      expect(
        RouteDeclarationsSchema.safeParse(
          Array.from({ length: count }, (_, i) => ({ id: `r${i}`, label: `R${i}` })),
        ).success,
      ).toBe(false);
    expect(
      RouteDeclarationsSchema.parse(
        Array.from({ length: 64 }, (_, i) => ({ id: `r${i}`, label: ` R${i} ` })),
      ),
    ).toHaveLength(64);
    expect(RouteDeclarationsSchema.parse([{ id: 'a', label: ' A ' }, routes[1]])[0]?.label).toBe(
      'A',
    );
  });
  it('rejects old matrix inputs and keeps harness defaults strict', () => {
    expect(
      DecisionConfigSchema.safeParse({
        answer: { type: 'choice' },
        evaluation: { kind: 'expression', jsonata: '"pass"' },
      }).success,
    ).toBe(false);
    expect(HarnessDefaultsSchema.parse({})).toEqual({ byHarness: {} });
    expect(HarnessDefaultsSchema.safeParse({ byHarness: { other: {} } }).success).toBe(false);
  });
  it('separates historical unknowns, predicate facts and fresh decision emissions', () => {
    expect(DecisionEmissionSchema.parse({ ...fact, diagnostics: [] })).toEqual({
      ...fact,
      diagnostics: [],
    });
    expect(DecisionPayloadSchema.safeParse({ ...fact, portId: 'retry' }).success).toBe(false);
    const boolean = {
      ...fact,
      observation: { kind: 'boolean', holds: null, confidence: null, reasoning: null },
    };
    expect(DecisionPayloadSchema.safeParse(boolean).success).toBe(true);
    expect(DecisionEmissionSchema.safeParse({ ...boolean, diagnostics: [] }).success).toBe(false);
    expect(
      EvaluationEmissionSchema.safeParse({
        provenance,
        observation: { kind: 'boolean', holds: false, confidence: null, reasoning: null },
      }).success,
    ).toBe(true);
  });
  it('caps factual diagnostics at three and requires none on fresh emissions', () => {
    const diagnostic = { provenance, code: 'RECORDED', message: 'Recorded fact' };
    for (const count of [0, 1, 3, 4]) {
      const input = { ...fact, diagnostics: Array.from({ length: count }, () => diagnostic) };
      expect(DecisionEvidenceSchema.safeParse(input).success).toBe(count <= 3);
      expect(DecisionEmissionSchema.safeParse(input).success).toBe(count === 0);
    }
  });
  it.each([null, NaN, Infinity, -0.1, 1.1])(
    'rejects invalid fresh LLM confidence %j',
    (confidence) => {
      expect(
        DecisionEmissionSchema.safeParse({
          ...fact,
          provenance: {
            kind: 'llm',
            provider: 'codex',
            classifierId: null,
            model: 'm',
            effort: 'low',
          },
          observation: { kind: 'route', routeId: 'pass', confidence, reasoning: 'R' },
          diagnostics: [],
        }).success,
      ).toBe(false);
    },
  );
  it('checks fresh provenance and observation consistency', () => {
    const llm = {
      ...fact,
      provenance: { kind: 'llm', provider: 'codex', classifierId: null, model: 'm', effort: 'low' },
      observation: { kind: 'route', routeId: 'pass', confidence: 0, reasoning: 'R' },
      diagnostics: [],
    };
    expect(DecisionEmissionSchema.safeParse(llm).success).toBe(true);
    for (const input of [
      { ...llm, observation: { ...llm.observation, reasoning: null } },
      { ...llm, provenance: { ...llm.provenance, effort: null } },
      { ...llm, provenance: { ...llm.provenance, provider: 'other' } },
      { ...fact, provenance: { ...provenance, model: 'unexpected' }, diagnostics: [] },
      { ...fact, observation: { ...fact.observation, confidence: 1 }, diagnostics: [] },
    ])
      expect(DecisionEmissionSchema.safeParse(input).success).toBe(false);
  });
});
