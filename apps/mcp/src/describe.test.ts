import { describe, expect, it } from 'vitest';
import { DecisionConfigSchema, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { describeDefinition } from './describe.js';

describe('evaluator-specific decision descriptions', () => {
  const routes = [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
  ];
  const answers = [
    { type: 'choice', options: routes.map((route) => ({ ...route, criteria: route.label })) },
    {
      type: 'noul',
      true: { ...routes[0], criteria: 'True' },
      false: { ...routes[1], criteria: 'False' },
    },
    {
      type: 'score',
      anchors: ['Low', 'High'],
      bands: [
        { id: 'low', label: 'Low', min: 0, max: 0.5 },
        { id: 'high', label: 'High', min: 0.5, max: 1 },
      ],
    },
  ];
  const configs = [
    { kind: 'expression', jsonata: '"yes"', routes },
    {
      kind: 'llm',
      instructions: 'Choose.',
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      routes,
    },
    ...answers.map((answer) => ({ kind: 'classifier', model: 'jev', question: 'Choose.', answer })),
  ];
  it.each(configs)(
    'describes $kind with readable stable routes and applicable selection',
    (raw) => {
      const config = DecisionConfigSchema.parse(raw),
        definition = LoopDefinitionSchema.parse(minimalLoop());
      definition.nodes.push({
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config,
        ui: { x: 0, y: 0 },
      });
      const result = describeDefinition(definition).decisions[0];
      expect(result).toMatchObject({ nodeId: 'pick', label: 'Pick', kind: config.kind });
      expect(result?.routes).toEqual(
        config.kind === 'classifier' && config.answer.type === 'score'
          ? [
              { id: 'low', label: 'Low' },
              { id: 'high', label: 'High' },
            ]
          : routes,
      );
      if (config.kind === 'classifier')
        expect(result).toMatchObject({ answerType: config.answer.type, model: 'jev' });
      else if (config.kind === 'llm')
        expect(result).toMatchObject({
          harness: 'codex',
          model: { mode: 'inherit' },
          effort: { mode: 'inherit' },
        });
      else expect(result).not.toHaveProperty('model');
    },
  );
});
