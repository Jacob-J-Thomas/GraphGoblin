import type { NodeInput } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { canvasPortLabels, connectionProblem, newLoopDefinition, portsOf } from './model.js';
import { useEditorStore } from './store.js';

function collision(marked: boolean): NodeInput {
  return {
    id: 'gate',
    kind: 'decision',
    label: 'Gate',
    config: {
      kind: 'expression',
      jsonata: '"repeat"',
      routes: [
        { id: 'repeat', label: 'Repeat', ...(marked ? { repeat: true } : {}) },
        { id: 'limit-reached', label: 'Invalid authored route' },
      ],
      ...(marked ? { maxPasses: 2 } : {}),
    },
  };
}

describe('reserved gate output while authoring invalid IDs', () => {
  it('draws Limit reached only once and refuses a reserved authored route without a gate', () => {
    const definition = newLoopDefinition('reserved');
    definition.nodes.push(collision(false));
    expect(
      connectionProblem(definition, {
        source: 'gate',
        sourceHandle: 'limit-reached',
        target: 'done',
      }),
    ).toContain('valid route ID');
    const gate = collision(true);
    expect(portsOf(gate).filter((port) => port === 'limit-reached')).toHaveLength(1);
    expect(canvasPortLabels(gate)['limit-reached']).toBe('Limit reached');
  });

  it('never transfers the Limit reached connection to a repaired authored route ID', () => {
    const definition = newLoopDefinition('reserved'),
      gate = collision(true);
    definition.nodes.push(gate);
    definition.edges.push({
      id: 'limit',
      from: { node: 'gate', port: 'limit-reached' },
      to: { node: 'done' },
    });
    const store = useEditorStore.getState;
    store().load('reserved', definition);
    expect(store().decisionRoutes['gate']!.rows[1]!.edgeIds).toEqual([]);
    if (gate.kind !== 'decision' || gate.config.kind !== 'expression')
      throw new Error('Expected expression gate');
    store().updateNode(
      'gate',
      {
        config: {
          ...gate.config,
          routes: gate.config.routes.map((row, i) => (i === 1 ? { ...row, id: 'done' } : row)),
        },
      },
      { path: 'routes.1.id', kind: 'typing', id: 99999 },
    );
    expect(store().definition!.edges.find((edge) => edge.id === 'limit')!.from.port).toBe(
      'limit-reached',
    );
    store().reset();
  });
});
