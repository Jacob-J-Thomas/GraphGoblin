import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DecisionRoutes } from './decision-route-edges.js';
import { spacedPositions } from './space-cards.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();
const ORIGIN = { x: 0, y: 0 };
const positions = () => store().definition!.nodes.map((node) => node.ui ?? ORIGIN);

/**
 * A pile that an ordinary `edit` would not leave alone. Its restored routes table gives the
 * decision's two connections to each other's rows, so any `edit` moves their ports. It also has
 * stored edges the canvas cannot draw: a repeated id, a missing target and a port the source does
 * not have. The second card is at `-0`, the third at an explicit origin, and the first has no `ui`.
 */
function pile(): LoopDefinitionInput {
  const definition = kitchenSinkLoop();
  definition.nodes[1] = { ...definition.nodes[1]!, ui: { x: -0, y: 0 } };
  definition.nodes[2] = { ...definition.nodes[2]!, ui: { x: 0, y: 0 } };
  definition.edges.push(
    { id: 'e3', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    { id: 'gone', from: { node: 'prep', port: 'out' }, to: { node: 'ghost' } },
    { id: 'stale', from: { node: 'approve', port: 'nope' }, to: { node: 'done' } },
  );
  return definition;
}
const SWAPPED: DecisionRoutes = {
  decide: {
    nextKey: 2,
    rows: [
      { key: 0, id: 'good', edgeIds: ['e7'] },
      { key: 1, id: 'bad', edgeIds: ['e6'] },
    ],
  },
};
const port = (edgeId: string) => store().definition!.edges.find((e) => e.id === edgeId)!.from.port;

describe('spaceCards', () => {
  beforeEach(() => store().reset());

  it('spaces a pile in one ordinary step that changes only node ui, and undo and redo restore it exactly', () => {
    const original = pile();
    store().load('L1', original, { baseToken: 'token-1', decisionRoutes: SWAPPED });
    // Opening wrote nothing.
    expect(store()).toMatchObject({ definition: original, revision: 0, past: [] });
    // Held input, a conflict, a name refusal, the selection and the open dialog all stay.
    store().setFieldError('node:prep', 'config.operations', { message: 'Invalid', text: '[' });
    store().setConflict({ serverToken: 'server-token' });
    store().setNameConflict({
      name: 'kitchen-sink',
      suggestedName: 'kitchen-sink copy',
      retrying: false,
      retried: false,
    });
    store().openNode('infer');
    const before = store();

    expect(store().spaceCards()).toBe('applied');

    const after = store();
    const spaced = after.definition!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.saveState).toBe('pending');
    expect(after.past.map((step) => step.label)).toEqual([
      ...before.past.map((step) => step.label),
      'space cards',
    ]);
    expect(after.past.at(-1)!.definition).toBe(original);
    expect(after).toMatchObject({ future: [], openStep: undefined });
    for (const key of [
      'fieldErrors',
      'decisionRoutes',
      'conflict',
      'nameConflict',
      'baseToken',
      'selectedNodeId',
      'nodeDialogOpen',
      'nodeDialogSession',
      'renameReport',
      'formEpochs',
      'historyEpoch',
      'savedRevision',
      'deviceRevision',
      'connectionError',
      'generation',
    ] as const)
      expect(after[key], key).toBe(before[key]);

    // Every edge (the undrawable ones and the decision's mismatched pair included) and every
    // field other than the nodes keep their identity; the first card keeps its object and no ui.
    expect(spaced.edges).toBe(original.edges);
    const { nodes: _spacedNodes, ...spacedRest } = spaced;
    const { nodes: _originalNodes, ...originalRest } = original;
    expect(Object.keys(spacedRest)).toEqual(Object.keys(originalRest));
    for (const [key, value] of Object.entries(originalRest))
      expect(spacedRest[key as keyof typeof spacedRest], key).toBe(value);
    expect(spaced.nodes[0]).toBe(original.nodes[0]);
    expect(spaced.nodes[0]).not.toHaveProperty('ui');
    spaced.nodes.forEach((node, index) => {
      const { ui: _ui, ...fields } = node;
      const { ui: _before, ...originalFields } = original.nodes[index]!;
      expect(Object.keys(fields)).toEqual(Object.keys(originalFields));
      for (const [key, value] of Object.entries(originalFields))
        expect(fields[key as keyof typeof fields], `${node.id}.${key}`).toBe(value);
    });
    expect(positions()).toEqual(spacedPositions(original));

    // Undo restores the very draft it replaced (the absent ui and -0 included); redo the very
    // spaced draft, not a new layout.
    store().undo();
    expect(store().definition).toBe(original);
    expect(store()).toMatchObject({ revision: after.revision + 1, saveState: 'pending' });
    expect(store().fieldErrors).toBe(before.fieldErrors);
    store().redo();
    expect(store().definition).toBe(spaced);
    expect(store().decisionRoutes).toBe(before.decisionRoutes);

    // The hazard this action avoids: an ordinary edit of this draft rewrites the decision's edges.
    expect([port('e6'), port('e7')]).toEqual(['good', 'bad']);
    store().moveNode('done', { x: 1, y: 1 });
    expect([port('e6'), port('e7')]).toEqual(['bad', 'good']);
  });

  it('refuses a draft that is not a pile now, changing nothing at all', () => {
    const refuses = () => {
      const state = store();
      expect(store().spaceCards()).toBe('ineligible');
      expect(store()).toBe(state);
    };
    // No draft.
    refuses();
    // A card moved since the offer showed.
    store().load('L1', pile());
    store().moveNode('prep', { x: 0, y: 1 });
    refuses();
    // A stored route.
    store().undo();
    store().setEdgeRoute('e1', [240, 360, 420]);
    refuses();
    // A single card.
    const single = kitchenSinkLoop();
    store().load('L1', { ...single, nodes: single.nodes.slice(0, 1), edges: [] });
    refuses();
    // A second press: the cards are no longer in one spot.
    store().load('L1', pile());
    expect(store().spaceCards()).toBe('applied');
    refuses();
  });

  it('takes measured heights by the current cards’ ids, and lends none to cards that share an id', () => {
    const card = (id: string, label = id): NodeInput => ({ id, kind: 'exit', label, config: {} });
    // No trigger and no connections: every card is an entry, stacked in column 0 in card order,
    // so a card's height moves every card after it.
    const definition: LoopDefinitionInput = {
      ...kitchenSinkLoop(),
      nodes: [card('t'), card('a'), card('a', 'a again'), card('b')],
      edges: [],
    };
    store().load('L1', definition);
    const measured = new Map([
      ['t', 400],
      ['a', 500],
      ['b', 300],
      ['ghost', 999],
    ]);
    expect(store().spaceCards(measured)).toBe('applied');
    expect(positions()).toEqual(spacedPositions(definition, [400, undefined, undefined, 300]));
    // Lending "a"'s measurement to both cards would have placed them differently.
    expect(positions()).not.toEqual(spacedPositions(definition, [400, 500, 500, 300]));
  });
});
