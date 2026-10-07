import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyClock } from './history.js';
import { newLoopDefinition, validateDraft } from './model.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();
const routes = (...labels: string[]) => labels.map((label) => ({ label, description: label }));
const config = (labels = ['yes', 'no', 'third']) => ({
  routes: routes(...labels),
  question: 'Choose',
  strategy: ['jev' as const],
});

function fixture(): LoopDefinitionInput {
  const definition = newLoopDefinition('routes');
  definition.nodes.push({ id: 'pick', kind: 'decision', label: 'Pick', config: config() });
  definition.edges[0]!.to.node = 'pick';
  for (const label of ['yes', 'no', 'third']) {
    definition.edges.push({
      id: label,
      from: { node: 'pick', port: label },
      to: { node: 'done' },
      ...(label === 'third' ? { ui: { route: [300, 400, 500] } } : {}),
    });
  }
  return definition;
}

describe('decision route edits in editor history', () => {
  beforeEach(() => store().load('L1', fixture()));

  it('renames a connected route with its edge, preserving id, target, layout and unrelated edges', () => {
    const before = store().definition!;
    store().updateNode('pick', { config: config(['yes', 'no', 'other']) });
    const after = store().definition!;
    expect(after.edges[3]).toEqual({ ...before.edges[3], from: { node: 'pick', port: 'other' } });
    expect(after.edges.slice(0, 3)).toEqual(before.edges.slice(0, 3));
    for (let i = 0; i < 3; i++) expect(after.edges[i]).toBe(before.edges[i]);
    expect(validateDraft(after).issues).toEqual([]);
    expect(store().revision).toBe(1);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toEqual(before);
    store().redo();
    expect(store().definition).toEqual(after);
  });

  it('removes only the removed route’s outgoing edge and restores config and edge together', () => {
    const before = store().definition!;
    // A different source with the same port name must survive.
    before.edges.push({
      id: 'elsewhere',
      from: { node: 'done', port: 'no' },
      to: { node: 'pick' },
    });
    store().updateNode(
      'pick',
      { config: config(['yes', 'third']) },
      { path: 'routes', kind: 'commit', id: 1 },
    );
    const after = store().definition!;
    expect(after.edges.map((edge) => edge.id)).toEqual(['e1', 'yes', 'third', 'elsewhere']);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toEqual(before);
    store().redo();
    expect(store().definition).toEqual(after);
  });

  it('keeps edges by label through reorder, addition, descriptions and an unconnected rename', () => {
    const originalEdges = store().definition!.edges;
    store().updateNode('pick', { config: config(['third', 'yes', 'no']) });
    expect(store().definition!.edges).toBe(originalEdges);
    store().updateNode('pick', { config: config(['third', 'yes', 'no', 'extra']) });
    expect(store().definition!.edges).toBe(originalEdges);
    store().updateNode('pick', { config: config(['third', 'yes', 'no', 'spare']) });
    expect(store().definition!.edges).toBe(originalEdges);
    const described = config(['third', 'yes', 'no', 'spare']);
    described.routes[0]!.description = 'A different description';
    store().updateNode('pick', { config: described });
    expect(store().definition!.edges).toBe(originalEdges);
  });

  it.each(['', 'no', 'in', 'bad label'])(
    'keeps invalid label %j refused by validation without rewiring edges',
    (label) => {
      const edges = store().definition!.edges;
      store().updateNode('pick', { config: config(['yes', 'no', label]) });
      expect(validateDraft(store().definition!).schemaValid).toBe(false);
      expect(store().definition!.edges).toBe(edges);
      store().undo();
      expect(validateDraft(store().definition!).issues).toEqual([]);
      store().redo();
      expect(store().definition!.edges).toBe(edges);
    },
  );

  it.each(['', 'in', 'bad label'])(
    'finishing an unambiguous invalid label %j retains its connection',
    (label) => {
      store().updateNode('pick', { config: config(['yes', 'no', label]) });
      store().updateNode('pick', { config: config(['yes', 'no', 'other']) });
      expect(store().definition!.edges[3]!.from.port).toBe('other');
      expect(validateDraft(store().definition!).issues).toEqual([]);
    },
  );

  it('does not transfer a connection between two rows with colliding labels', () => {
    const edges = store().definition!.edges;
    store().updateNode('pick', { config: config(['yes', 'no', 'no']) });
    expect(store().definition!.edges).toBe(edges);
    store().updateNode('pick', { config: config(['yes', 'other', 'no']) });
    expect(store().definition!.edges.find((edge) => edge.id === 'no')!.from.port).toBe('other');
    expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe('no');
    expect(validateDraft(store().definition!).issues).toEqual([]);
    store().updateNode('pick', { config: config() });
    store().updateNode('pick', { config: config(['yes', 'no', 'other']) });
    expect(store().definition!.edges[3]!.from.port).toBe('other');
    expect(validateDraft(store().definition!).issues).toEqual([]);
  });

  it('does not give an unconnected blank row the connection of another incomplete row', () => {
    const definition = fixture();
    definition.edges = definition.edges.filter((edge) => edge.id !== 'no');
    store().load('L1', definition);
    store().updateNode('pick', { config: config(['yes', '', '']) });
    store().updateNode('pick', { config: config(['yes', 'free', '']) });
    expect(store().definition!.edges).toBe(definition.edges);
    store().updateNode('pick', { config: config(['yes', 'free', 'other']) });
    expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe('other');
  });

  it('coalesces label typing with the edge rewrites into one undo step', () => {
    const clock = vi.spyOn(historyClock, 'now').mockReturnValue(100);
    try {
      const before = store().definition!;
      const change = { path: 'routes.2.label', kind: 'typing' as const, id: 1 };
      for (const label of ['t', 'th', 'three'])
        store().updateNode('pick', { config: config(['yes', 'no', label]) }, change);
      const after = store().definition!;
      expect(after.edges[3]!.from.port).toBe('three');
      expect(store().past).toHaveLength(1);
      store().undo();
      expect(store().definition).toEqual(before);
      store().redo();
      expect(store().definition).toEqual(after);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([1, 2])(
    "keeps the third row's edge in completion order starting with row %i",
    (first) => {
      const definition = fixture();
      definition.edges = definition.edges.filter((edge) => edge.id !== 'no');
      store().load('L1', definition);
      store().updateNode('pick', { config: config(['yes', '', '']) });
      const labels = ['yes', '', ''];
      labels[first] = first === 1 ? 'free' : 'other';
      store().updateNode('pick', { config: config(labels) });
      expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe(
        first === 2 ? 'other' : 'third',
      );
      labels[3 - first] = first === 1 ? 'other' : 'free';
      store().updateNode('pick', { config: config(labels) });
      expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe(
        'other',
      );
      expect(store().definition!.edges.some((edge) => edge.from.port === 'free')).toBe(false);
      store().undo();
      store().redo();
      store().updateNode('pick', { config: config(['yes', 'free', 'final']) });
      expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe(
        'final',
      );
    },
  );

  it('deletes an edge owned by a temporarily blank row, and restores ownership on undo', () => {
    store().updateNode('pick', { config: config(['yes', 'no', '']) });
    const incomplete = store().definition!;
    store().updateNode('pick', { config: config(['yes', 'no']) });
    const removed = store().definition!;
    expect(removed.edges.some((edge) => edge.id === 'third')).toBe(false);
    expect(validateDraft(removed).issues).toEqual([]);
    store().undo();
    expect(store().definition).toEqual(incomplete);
    store().redo();
    expect(store().definition).toEqual(removed);
    store().undo();
    store().updateNode('pick', { config: config(['yes', 'no', 'other']) });
    expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe('other');
  });

  it.each([1, 2])(
    'removes the owned edges of blank row %i while an identical row survives',
    (index) => {
      store().updateNode('pick', { config: config(['yes', '', '']) });
      const before = store().decisionRoutes['pick']!;
      store().updateNode(
        'pick',
        { config: config(['yes', '']) },
        {
          path: 'routes',
          kind: 'commit',
          id: 1,
          collection: { type: 'remove', index },
        },
      );
      expect(store().definition!.edges.map((edge) => edge.id)).toEqual([
        'e1',
        'yes',
        index === 1 ? 'third' : 'no',
      ]);
      expect(store().decisionRoutes['pick']!.rows[1]!.key).toBe(before.rows[3 - index]!.key);
      store().undo();
      expect(store().decisionRoutes['pick']).toBe(before);
      store().redo();
      store().updateNode('pick', { config: config(['yes', 'other']) });
      expect(store().definition!.edges.at(-1)!.from.port).toBe('other');
    },
  );

  it('acquires a new connection, keeps ownership through node rename and discards it on a new load', () => {
    const definition = fixture();
    definition.edges = definition.edges.filter((edge) => edge.id !== 'third');
    store().load('L1', definition);
    expect(store().connect({ source: 'pick', sourceHandle: 'third', target: 'done' })).toBeNull();
    store().updateNode('pick', { config: config(['yes', 'no', '']) });
    store().renameNode('pick', 'choice');
    store().updateNode('choice', { config: config(['yes', 'no', 'other']) });
    expect(store().definition!.edges.at(-1)!.from).toEqual({ node: 'choice', port: 'other' });
    expect(store().decisionRoutes['pick']).toBeUndefined();
    store().removeEdge(store().definition!.edges.at(-1)!.id);
    expect(store().decisionRoutes['choice']!.rows[2]!.edgeIds).toEqual([]);
    store().load('L2', fixture());
    expect(store().decisionRoutes['choice']).toBeUndefined();
    store().removeNode('pick');
    expect(store().decisionRoutes).toEqual({});
  });

  it('owns a new connection made on a unique numeric draft label when that row is completed', () => {
    const definition = fixture();
    definition.edges = definition.edges.filter((edge) => edge.id !== 'third');
    store().load('L1', definition);
    store().updateNode('pick', { config: config(['yes', 'no', '1']) });
    expect(store().connect({ source: 'pick', sourceHandle: '1', target: 'done' })).toBeNull();
    store().updateNode('pick', { config: config(['yes', 'no', 'other']) });
    expect(store().definition!.edges.at(-1)!.from.port).toBe('other');
    expect(validateDraft(store().definition!).issues).toEqual([]);
  });

  it('retains connections when a raw config has no route array, and ignores other node kinds', () => {
    const edges = store().definition!.edges;
    for (const value of [null, {}, { routes: 'invalid' }]) {
      store().updateNode('pick', { config: value });
      expect(store().definition!.edges).toBe(edges);
    }
    store().updateNode('pick', { config: config() });
    expect(store().definition!.edges).toBe(edges);
    store().updateNode('start', { config: { subtype: 'manual' } });
    store().updateNode('missing', { config: config() });
    store().updateNode('pick', { label: 'Choose' });
    expect(store().definition!.edges).toBe(edges);
  });
});
