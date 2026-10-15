import { DecisionConfigSchema } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { convertDecision, decisionRows, record } from './decision-authoring.js';
import { canvasPortLabels, connectionProblem, newLoopDefinition, portsOf } from './model.js';

const routes = [
  { id: 'ship', label: 'Ship' },
  { id: 'review', label: 'Review' },
];
const context = { messages: 'all', vars: ['work'], includeLastOutput: false };
const options = routes.map((route) => ({ ...route, criteria: `Evidence for ${route.id}` }));
const choice = {
  kind: 'classifier',
  model: 'jev',
  question: 'Choose.',
  context,
  minConfidence: 0.8,
  answer: { type: 'choice', options },
};
const expression = { kind: 'expression' as const, jsonata: '"ship"', routes };
const llm = {
  kind: 'llm',
  instructions: 'Choose.',
  context,
  routes,
  harness: 'codex',
  model: { mode: 'explicit', value: 'alpha' },
  effort: { mode: 'explicit', value: 'high' },
};
const score = {
  ...choice,
  answer: {
    type: 'score',
    anchors: ['Low', 'High'],
    bands: routes.map((route, index) => ({ ...route, min: index / 2, max: (index + 1) / 2 })),
  },
};

describe('decision authoring conversions', () => {
  it('draws ambiguous IDs once without borrowing a label, and refuses ambiguous or invalid connections', () => {
    const definition = newLoopDefinition('Incomplete IDs');
    const node = { id: 'pick', kind: 'decision' as const, label: 'Pick', config: expression };
    definition.nodes.push(node);
    const duplicate = {
      ...node,
      config: { ...expression, routes: [routes[0]!, { id: 'ship', label: 'Different meaning' }] },
    };
    definition.nodes[definition.nodes.length - 1] = duplicate;
    expect(portsOf(duplicate)).toEqual(['ship']);
    expect(canvasPortLabels(duplicate)).toEqual({});
    expect(
      connectionProblem(definition, { source: 'pick', sourceHandle: 'ship', target: 'done' }),
    ).toContain('unique, valid route ID');
    duplicate.config.routes[0] = { id: 'bad id', label: 'Incomplete' };
    expect(
      connectionProblem(definition, { source: 'pick', sourceHandle: 'bad id', target: 'done' }),
    ).toContain('unique, valid route ID');
  });
  it.each([expression, llm, choice, score])(
    'keeps every representable route when changing $kind',
    (before) => {
      for (const kind of ['expression', 'llm', 'classifier']) {
        if (kind === before.kind) continue;
        const result = convertDecision(before, kind);
        expect(decisionRows(result.config).map(({ id, label }) => ({ id, label }))).toEqual(routes);
        expect(DecisionConfigSchema.safeParse(result.config).success).toBe(false);
        expect(result.incomplete.length).toBeGreaterThan(0);
        expect(result.lost.length).toBeGreaterThan(0);
        expect(result.blocked).toBeUndefined();
      }
    },
  );
  it('keeps provider context, but leaves instructions, classifier model and criteria unauthored', () => {
    const result = convertDecision(llm, 'classifier');
    expect(result.config).toMatchObject({
      context,
      model: '',
      question: '',
      answer: { options: routes.map((route) => ({ ...route, criteria: '' })) },
    });
    expect(result.keep).toContain('context');
    expect(result.incomplete).toContain('Route criteria');
    expect(convertDecision(choice, 'llm').config).toMatchObject({
      context,
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      instructions: '',
    });
    expect(convertDecision(llm, 'expression').lost).toContain('Provider context selection');
    expect(convertDecision(expression, 'llm').keep).toContain('routes');
  });
  it('converts exactly two Choice rows to Noul without inventing or swapping criteria', () => {
    const result = convertDecision(choice, 'classifier', 'noul');
    expect(result.config).toMatchObject({
      answer: { type: 'noul', true: options[0], false: options[1] },
      context,
      model: 'jev',
      minConfidence: 0.8,
    });
    expect(DecisionConfigSchema.safeParse(result.config).success).toBe(true);
    expect(result.lost).toEqual([]);
    expect(result.incomplete).toEqual([]);
    const returned = convertDecision(result.config, 'classifier', 'choice');
    expect(returned.config['answer']).toEqual(choice.answer);
  });
  it.each([0, 1, 3, 64])('refuses %i routes for Noul without truncation', (count) => {
    const before = {
      ...choice,
      answer: {
        type: 'choice',
        options: Array.from({ length: count }, (_, index) => ({
          id: `r${index}`,
          label: `R${index}`,
          criteria: '',
        })),
      },
    };
    const result = convertDecision(before, 'classifier', 'noul');
    expect(result.config).toBe(before);
    expect(result.blocked).toContain('exactly two routes');
  });
  it('keeps Score route identities while requiring an authored rubric and bounds', () => {
    const result = convertDecision(choice, 'classifier', 'score');
    expect(result.config['answer']).toEqual({
      type: 'score',
      anchors: ['', ''],
      bands: routes.map((route) => ({ ...route, min: undefined, max: undefined })),
    });
    expect(result.lost).toContain('Route criteria');
    const fromScore = convertDecision(score, 'classifier', 'choice');
    expect(fromScore.lost).toContain('Rubric anchors and band boundaries');
    expect(fromScore.incomplete).toContain('Route criteria');
    const fromNoul = convertDecision(
      { ...convertDecision(choice, 'classifier', 'noul').config, truthThreshold: 0.7 },
      'classifier',
      'score',
    );
    expect(fromNoul.config).not.toHaveProperty('truthThreshold');
    expect(fromNoul.lost).toContain('Noul true-probability threshold');
  });
  it('tolerates incomplete editor rows without creating criteria or route ids', () => {
    for (const value of [null, undefined, [], 7, { kind: 'expression', routes: 'unfinished' }]) {
      expect(decisionRows(value)).toEqual([]);
      expect(record(value)).toBeTypeOf('object');
    }
    const before = { kind: 'expression', routes: [{ id: '', label: 'Pending' }, {}] };
    const next = convertDecision(before, 'classifier');
    expect(decisionRows(next.config)).toEqual([
      { id: '', label: 'Pending', criteria: '' },
      { id: undefined, label: undefined, criteria: '' },
    ]);
  });
});
