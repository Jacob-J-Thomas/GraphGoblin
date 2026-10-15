import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { validateTemplateDraft } from './template-bundle.js';

describe('manual template draft validation', () => {
  it('keeps a manual workflow as an independent editable definition', () => {
    const input = definition();
    const draft = validateTemplateDraft(input);
    expect(draft).toEqual(input);
    expect(draft).not.toBe(input);
  });
  it('refuses malformed data and dangling graph targets', () => {
    expect(() => validateTemplateDraft({})).toThrow('template draft schema is invalid');
    const input = definition();
    input.edges[0]!.to.node = 'missing';
    expect(() => validateTemplateDraft(input)).toThrow('template draft graph is invalid');
  });
  it('refuses nonmanual triggers and packaged scripts in authored starting points', () => {
    const input = definition();
    input.nodes[0] = LoopDefinitionSchema.parse({
      ...input,
      nodes: [
        {
          id: 'start',
          label: 'Start',
          kind: 'trigger',
          config: { subtype: 'cron', expression: '* * * * *', timezone: 'UTC' },
        },
      ],
    }).nodes[0]!;
    expect(() => validateTemplateDraft(input)).toThrow('must be manual workflows');
    input.nodes[0] = definition().nodes[0]!;
    input.nodes[2] = LoopDefinitionSchema.parse({
      ...input,
      nodes: [
        {
          id: 'work',
          label: 'Work',
          kind: 'script',
          config: { command: 'authored-script' },
        },
      ],
    }).nodes[0]!;
    expect(() => validateTemplateDraft(input)).toThrow('without scripts');
  });
  it('refuses file and remote return channels in the shipped draft', () => {
    const input = definition();
    const exit = input.nodes.find((node) => node.kind === 'exit');
    if (!exit || exit.kind !== 'exit') throw new Error('missing exit');
    exit.config.return.channels = [{ kind: 'file', path: 'result.json', format: 'json' }];
    expect(() => validateTemplateDraft(input)).toThrow('only to the caller');
  });
});

function definition() {
  return LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Authored',
    nodes: [
      { id: 'start', label: 'Start', kind: 'trigger', config: { subtype: 'manual' } },
      {
        id: 'settings',
        label: 'Settings',
        kind: 'mutate',
        config: {
          operations: [
            { op: 'set', path: '/vars/templateSettings', value: { kind: 'literal', value: {} } },
          ],
        },
      },
      {
        id: 'work',
        label: 'Work',
        kind: 'inference',
        config: { prompt: { template: '{{ vars.templateSettings.instruction }}' } },
      },
      { id: 'done', label: 'Done', kind: 'exit', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'settings' } },
      { id: 'b', from: { node: 'settings', port: 'out' }, to: { node: 'work' } },
      { id: 'c', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  });
}
