import { describe, expect, it } from 'vitest';
import {
  DecisionConfigSchema,
  ExpressionDecisionConfigSchema,
  LlmDecisionConfigSchema,
  ClassifierDecisionConfigSchema,
  DecisionEmissionSchema,
  LIMIT_REACHED_PORT_ID,
  LoopSettingsSchema,
} from './index.js';

const routes = [
  { id: 'repeat', label: 'Repeat', repeat: true },
  { id: 'done', label: 'Done' },
];
const expression = { kind: 'expression', jsonata: '"repeat"', routes, maxPasses: 3 };
const classifiers = [
  { type: 'choice', options: routes.map((route) => ({ ...route, criteria: route.label })) },
  {
    type: 'noul',
    true: { ...routes[0], criteria: 'Repeat' },
    false: { ...routes[1], criteria: 'Done' },
  },
  {
    type: 'score',
    anchors: ['Low', 'High'],
    bands: [
      { ...routes[0], min: 0, max: 0.5 },
      { ...routes[1], min: 0.5, max: 1 },
    ],
  },
];
const configs = [
  expression,
  {
    routes,
    maxPasses: 3,
    kind: 'llm',
    instructions: 'Choose',
    harness: 'codex',
    model: { mode: 'inherit' },
    effort: { mode: 'inherit' },
  },
  ...classifiers.map((answer) => ({
    kind: 'classifier',
    model: 'jev',
    question: 'Choose',
    answer,
    maxPasses: 3,
  })),
];

describe('decision gate contracts', () => {
  it('enforces gate limits in the branch schemas as well as the decision union', () => {
    const schemas = [
      ExpressionDecisionConfigSchema,
      LlmDecisionConfigSchema,
      ...classifiers.map(() => ClassifierDecisionConfigSchema),
    ];
    configs.forEach((config, index) => {
      const { maxPasses: _removed, ...missing } = config;
      expect(schemas[index]!.safeParse(missing).success).toBe(false);
    });
  });

  it.each([
    [
      {
        type: 'choice',
        options: routes.map((route) => ({ ...route, criteria: route.label, repeat: true })),
      },
      ['answer', 'options', 1, 'repeat'],
    ],
    [
      {
        type: 'noul',
        true: { ...routes[0], criteria: 'Repeat', repeat: true },
        false: { ...routes[1], criteria: 'Done', repeat: true },
      },
      ['answer', 'false', 'repeat'],
    ],
    [
      {
        type: 'score',
        anchors: ['Low', 'High'],
        bands: [
          { ...routes[0], min: 0, max: 0.5, repeat: true },
          { ...routes[1], min: 0.5, max: 1, repeat: true },
        ],
      },
      ['answer', 'bands', 1, 'repeat'],
    ],
  ])('identifies the second repeat marker on classifier answer %#', (answer, path) => {
    const parsed = DecisionConfigSchema.safeParse({
      kind: 'classifier',
      model: 'jev',
      question: 'Choose',
      maxPasses: 3,
      answer,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path }));
  });
  it.each(configs)('admits a bounded repeat for $kind', (config) => {
    expect(DecisionConfigSchema.parse({ ...config, maxRunTimeSeconds: 60 }).maxPasses).toBe(3);
    const { maxPasses: _removed, ...missing } = config;
    const result = DecisionConfigSchema.safeParse(missing);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['maxPasses'] }));
  });

  it.each([0, -1, 1.5, 10_001, Infinity, NaN])('rejects invalid pass limit %s', (maxPasses) => {
    expect(DecisionConfigSchema.safeParse({ ...expression, maxPasses }).success).toBe(false);
  });

  it.each([0, -1, 1.5, 31_536_001, Infinity, NaN])(
    'rejects invalid run time %s',
    (maxRunTimeSeconds) => {
      expect(DecisionConfigSchema.safeParse({ ...expression, maxRunTimeSeconds }).success).toBe(
        false,
      );
    },
  );

  it('rejects multiple repeats, orphan limits and reserved ids', () => {
    expect(
      DecisionConfigSchema.safeParse({
        ...expression,
        routes: routes.map((route) => ({ ...route, repeat: true })),
      }).success,
    ).toBe(false);
    for (const limit of [{ maxPasses: 3 }, { maxRunTimeSeconds: 60 }])
      expect(
        DecisionConfigSchema.safeParse({
          kind: 'expression',
          jsonata: '"done"',
          routes: routes.map(({ id, label }) => ({ id, label })),
          ...limit,
        }).success,
      ).toBe(false);
    for (const config of configs) {
      const reserved = JSON.parse(
        JSON.stringify(config).replaceAll('"repeat"', '"limit-reached"'),
      ) as unknown;
      expect(DecisionConfigSchema.safeParse(reserved).success).toBe(false);
    }
    expect(LoopSettingsSchema.safeParse({ maxIterations: 3 }).success).toBe(false);
    expect(LoopSettingsSchema.parse({}).maxNodeVisits).toBe(10);
  });

  it('records the observed repeat separately from a limit output and validates atomic count facts', () => {
    const payload = {
      provenance: {
        kind: 'expression',
        provider: null,
        classifierId: null,
        model: null,
        effort: null,
      },
      observation: { kind: 'route', routeId: 'repeat', confidence: null, reasoning: null },
      portId: LIMIT_REACHED_PORT_ID,
      diagnostics: [],
      gate: {
        previousPasses: 3,
        passes: 3,
        repeatRouteId: 'repeat',
        maxPasses: 3,
        elapsedSeconds: 0,
        limit: 'max-passes',
      },
    };
    expect(DecisionEmissionSchema.parse(payload)).toEqual(payload);
    for (const bad of [
      { ...payload, gate: undefined },
      { ...payload, portId: 'repeat' },
      { ...payload, portId: 'in', gate: undefined },
      { ...payload, gate: { ...payload.gate, passes: 4 } },
      { ...payload, gate: { ...payload.gate, limit: 'max-run-time' } },
    ])
      expect(DecisionEmissionSchema.safeParse(bad).success).toBe(false);
    expect(
      DecisionEmissionSchema.safeParse({
        ...payload,
        gate: {
          ...payload.gate,
          previousPasses: 1,
          passes: 1,
          maxRunTimeSeconds: 60,
          elapsedSeconds: 60,
          limit: 'max-run-time',
        },
      }).success,
    ).toBe(true);
  });
});
