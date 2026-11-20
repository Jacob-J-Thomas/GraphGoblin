import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { describe, expect, it } from 'vitest';
import { validateLoop } from './graph.js';

function storedDraft() {
  const definition = LoopDefinitionSchema.parse({
    ...minimalLoop(),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Summarise.' } },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  });
  const node = definition.nodes[1]!;
  if (node.kind !== 'inference') throw new Error('Missing fixture inference');
  return { definition, node };
}

describe('previously stored Codex configuration at publication (#429)', () => {
  it('keeps an ordinary stored configuration publishable', () => {
    const { definition, node } = storedDraft();
    node.config.harnessOptions.configOverrides = { 'features.plugins': false, toString: true };
    expect(validateLoop(definition)).toEqual([]);
  });

  it('reports the node and array-table path without changing the stored draft', () => {
    const { definition, node } = storedDraft();
    node.config.harnessOptions.configOverrides = { list: [0, { 'team docs': true }] };
    const before = JSON.stringify(definition);
    expect(validateLoop(definition)).toEqual([
      expect.objectContaining({
        code: 'CODEX_CONFIG_KEY_INVALID',
        severity: 'error',
        nodeId: 'work',
        path: 'config.harnessOptions.configOverrides.list.1.team docs',
        message: expect.stringContaining('every key segment'),
      }),
    ]);
    expect(JSON.stringify(definition)).toBe(before);
  });
});
