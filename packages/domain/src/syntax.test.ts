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
    schemaVersion: 1,
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
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            routes: [
              { label: 'a', description: 'A' },
              { label: 'b', description: 'B' },
            ],
            question: 'q {{ x | nosuchfilter }}',
            strategy: ['expression'],
            expression: { jsonata: '1 +' },
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
      ['TEMPLATE_INVALID', 'pick'],
      ['EXPRESSION_INVALID', 'pick'],
      ['TEMPLATE_INVALID', 'run'],
      ['EXPRESSION_INVALID', 'sub'],
      ['TEMPLATE_INVALID', 'note'],
    ]);
    expect(issues[1]?.message).toMatch(/^template at node "ask" prompt\.template: /);
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
