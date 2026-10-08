import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  NodeConfigSchemas,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { validateLoop } from './graph.js';
import { findAuthoredSources, syntaxIssues } from './syntax.js';

function loop(nodes: LoopDefinitionInput['nodes'], settings?: LoopDefinitionInput['settings']) {
  return LoopDefinitionSchema.parse({
    schemaVersion: 3,
    name: 'syntax',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      ...nodes,
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [],
    ...(settings ? { settings } : {}),
  });
}

describe('syntax checks', () => {
  it.each(['', ' '])('allows empty and whitespace required templates (%j)', (source) => {
    const def = loop([
      {
        id: 'run',
        kind: 'script',
        label: 'Run',
        config: { command: 'cut', args: ['-d', source, '-f1'] },
      },
      { id: 'ask', kind: 'inference', label: 'Ask', config: { prompt: { template: source } } },
      {
        id: 'beat',
        kind: 'heartbeat',
        label: 'Beat',
        config: {
          intervalSeconds: 5,
          maxBeats: 1,
          probe: { kind: 'http', url: 'https://example.com', headers: { Empty: source } },
        },
      },
      {
        id: 'note',
        kind: 'mutate',
        label: 'Note',
        config: {
          operations: [
            { op: 'set', path: '/vars/value', value: { kind: 'template', template: source } },
            { op: 'append-message', role: 'note', content: source },
          ],
        },
      },
    ]);
    expect(syntaxIssues(def)).toEqual([]);
    expect(validateLoop(def).filter((issue) => issue.code === 'TEMPLATE_INVALID')).toEqual([]);
  });

  it('rejects a whitespace required expression with an expression-specific message', () => {
    const def = loop([
      {
        id: 'note',
        kind: 'mutate',
        label: 'Note',
        config: {
          operations: [
            { op: 'set', path: '/vars/value', value: { kind: 'expression', jsonata: ' ' } },
          ],
        },
      },
    ]);
    expect(syntaxIssues(def)[0]?.message).toContain(
      'expression is required; a blank expression is not valid',
    );
  });

  it.each([' ', '\t\n', '\u00a0'])(
    'rejects blank expressions before execution (%j), without changing contracts parsing',
    (source) => {
      const def = loop([
        {
          id: 'beat',
          kind: 'heartbeat',
          label: 'Beat',
          config: { intervalSeconds: 5, until: source },
        },
        { id: 'ask', kind: 'inference', label: 'Ask', config: { prompt: { template: source } } },
      ]);
      expect(syntaxIssues(def)).toEqual([
        expect.objectContaining({
          code: 'EXPRESSION_INVALID',
          nodeId: 'beat',
          message: expect.stringContaining('required'),
        }),
      ]);
      expect(validateLoop(def).filter((issue) => issue.code.endsWith('_INVALID'))).toHaveLength(1);
    },
  );

  it('finds no problems in the kitchen-sink loop', () => {
    const def = LoopDefinitionSchema.parse(kitchenSinkLoop());
    expect(syntaxIssues(def)).toEqual([]);
  });

  it('reports templates and expressions that do not parse, wherever they are nested', () => {
    const def = loop(
      [
        {
          id: 'ask',
          kind: 'inference',
          label: 'Ask',
          config: { prompt: { template: 'Hi {% if x %}' } },
        },
        {
          id: 'pick-question',
          kind: 'decision',
          label: 'Question',
          config: {
            answer: {
              type: 'choice',
              options: [
                { id: 'a', label: 'A', criteria: 'A' },
                { id: 'b', label: 'B', criteria: 'B' },
              ],
            },
            evaluation: { kind: 'classifier', model: 'jev', question: '{{ broken' },
          },
        },
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            answer: {
              type: 'choice',
              options: [
                { id: 'a', label: 'a', criteria: 'A' },
                { id: 'b', label: 'b', criteria: 'B' },
              ],
            },
            evaluation: { kind: 'expression', jsonata: '1 +' },
          },
        },
        {
          id: 'run',
          kind: 'script',
          label: 'Run',
          config: { command: 'node', args: ['ok', '{{ broken'] },
        },
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: {
            loopRef: { loopId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
            input: { mode: 'project', vars: { a: '$x(' } },
          },
        },
        {
          id: 'note',
          kind: 'mutate',
          label: 'Note',
          config: { operations: [{ op: 'append-message', role: 'note', content: '{{' }] },
        },
      ],
      { workingDirectory: { kind: 'template', template: '{% endif %}' } },
    );
    const issues = syntaxIssues(def);
    expect(issues.map((i) => [i.code, i.nodeId])).toEqual([
      ['TEMPLATE_INVALID', undefined],
      ['TEMPLATE_INVALID', 'ask'],
      ['TEMPLATE_INVALID', 'pick-question'],
      ['EXPRESSION_INVALID', 'pick'],
      ['TEMPLATE_INVALID', 'run'],
      ['EXPRESSION_INVALID', 'sub'],
      ['TEMPLATE_INVALID', 'note'],
    ]);
    expect(issues[1]?.message).toMatch(/^template at node "ask" prompt\.template: /);
    // Each names its field, so the editor can count and focus it.
    expect(issues.map((i) => i.path)).toEqual([
      'settings.workingDirectory.template',
      'config.prompt.template',
      'config.evaluation.question',
      'config.evaluation.jsonata',
      'config.args.1',
      'config.input.vars.a',
      'config.operations.0.content',
    ]);
    expect(issues[0]?.message).toMatch(/^template at loop settings workingDirectory\.template/);
    expect(issues[4]?.message).toContain('args.1');
    expect(issues[5]?.message).toContain('input.vars.a');
    // validateLoop includes them, so publish refuses the loop.
    expect(validateLoop(def).filter((i) => i.code.endsWith('_INVALID'))).toHaveLength(7);
  });

  it('skips absent values and union branches that do not match', () => {
    expect(findAuthoredSources(NodeConfigSchemas.exit, null)).toEqual([]);
    expect(
      findAuthoredSources(NodeConfigSchemas.exit, {
        return: { mapping: 'none', channels: [] },
      }),
    ).toEqual([]);
    expect(findAuthoredSources(NodeConfigSchemas.exit, { return: { mapping: '$.a' } })).toEqual([
      { kind: 'expression', source: '$.a', path: 'return.mapping' },
    ]);
    expect(findAuthoredSources(NodeConfigSchemas.exit, { criteria: [{ when: 'bogus' }] })).toEqual(
      [],
    );
  });
});
