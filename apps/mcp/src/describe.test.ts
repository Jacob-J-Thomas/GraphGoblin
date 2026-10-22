import { describe, expect, it } from 'vitest';
import { DecisionConfigSchema, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { describeDefinition, summarizeRun } from './describe.js';
import { RunRecordSchema } from '@graphgoblin/contracts';
import { fakeUlid, samplePin } from '@graphgoblin/contracts/testing';

it('preserves script uncertainty and retry provenance in the MCP run summary (#321)', () => {
  const failure = {
    code: 'SCRIPT_OUTCOME_UNCERTAIN',
    message:
      'The previous script attempt may already have produced its effect. Resume runs it again.',
    resumable: true,
    script: { visitId: 'run:3', dispatchId: fakeUlid('dispatch'), state: 'outcome-uncertain' },
  };
  const run = RunRecordSchema.parse({
    id: fakeUlid('run'),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    invocationId: fakeUlid('invocation'),
    pinned: samplePin(),
    status: 'failed',
    iteration: 1,
    createdAt: '2026-10-22T00:00:00.000Z',
    lastEventSeq: 5,
    failure,
  });
  expect(summarizeRun(run).failure).toEqual(failure);
});

describe('evaluator-specific decision descriptions', () => {
  it.each([undefined, 60])(
    'describes gate limits, repeat routes and terminal exits (seconds: %s)',
    (seconds) => {
      const definition = LoopDefinitionSchema.parse(minimalLoop());
      definition.nodes.push({
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: DecisionConfigSchema.parse({
          kind: 'expression',
          jsonata: '"repeat"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: 3,
          ...(seconds ? { maxRunTimeSeconds: seconds } : {}),
        }),
        ui: { x: 0, y: 0 },
      });
      const result = describeDefinition(definition);
      expect(result.decisions[0]?.gate).toMatchObject({
        maxPasses: 3,
        limitPort: 'limit-reached',
        passCountPath: 'gates."gate".passes',
      });
      expect(result.exits[0]).toMatchObject({
        outcome: 'success',
        returns: 'none',
        destinations: ['caller'],
      });
      definition.nodes.at(-1)!.id = 'my-gate';
      expect(describeDefinition(definition).decisions[0]?.gate?.passCountPath).toBe(
        'gates."my-gate".passes',
      );
    },
  );
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
