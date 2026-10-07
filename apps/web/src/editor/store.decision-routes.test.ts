import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyClock } from './history.js';
import { canvasPortLabels, newLoopDefinition, validateDraft } from './model.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();
const options = (...ids: string[]) =>
  ids.map((id, index) => ({
    id,
    label: id === '1' ? '1' : `Label ${index + 1}`,
    criteria: `Criterion ${index + 1}`,
  }));
const config = (ids = ['yes', 'no', 'third']) => ({
  answer: { type: 'choice' as const, options: options(...ids) },
  evaluation: { kind: 'expression' as const, jsonata: '"yes"' },
  recordAlternatives: true,
});

function fixture(): LoopDefinitionInput {
  const definition = newLoopDefinition('routes');
  definition.nodes.push({ id: 'pick', kind: 'decision', label: 'Pick', config: config() });
  definition.edges[0]!.to.node = 'pick';
  for (const id of ['yes', 'no', 'third']) {
    definition.edges.push({
      id,
      from: { node: 'pick', port: id },
      to: { node: 'done' },
      ...(id === 'third' ? { ui: { route: [300, 400, 500] } } : {}),
    });
  }
  return definition;
}

describe('decision option edits in editor history', () => {
  beforeEach(() => store().load('L1', fixture()));

  it('renames a stable option ID with its edge while preserving target and layout', () => {
    const before = store().definition!;
    const changed = config();
    changed.answer.options[2]!.id = 'other';
    store().updateNode(
      'pick',
      { config: changed },
      { path: 'answer.options.2.id', kind: 'typing', id: 1 },
    );
    const after = store().definition!;
    expect(after.edges[3]).toEqual({ ...before.edges[3], from: { node: 'pick', port: 'other' } });
    expect(after.edges.slice(0, 3)).toEqual(before.edges.slice(0, 3));
    expect(validateDraft(after).issues).toEqual([]);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toEqual(before);
    store().redo();
    expect(store().definition).toEqual(after);
  });

  it('keeps ports and edges unchanged when only labels, criteria, or order changes', () => {
    const originalEdges = store().definition!.edges;
    const changed = config(['third', 'yes', 'no']);
    changed.answer.options[0]!.label = 'Numeric label 7';
    changed.answer.options[0]!.criteria = 'Updated criterion';
    store().updateNode('pick', { config: changed });
    expect(store().definition!.edges).toBe(originalEdges);
    expect(store().definition!.edges.map((edge) => edge.from.port)).toEqual([
      'out',
      'yes',
      'no',
      'third',
    ]);
  });

  it('removes only the removed option edge and restores it together with config on undo', () => {
    const before = store().definition!;
    before.edges.push({
      id: 'elsewhere',
      from: { node: 'done', port: 'out' },
      to: { node: 'pick' },
    });
    const changed = config(['yes', 'third']);
    store().updateNode(
      'pick',
      { config: changed },
      {
        path: 'answer.options',
        kind: 'commit',
        id: 1,
        collection: { type: 'remove', index: 1 },
      },
    );
    const after = store().definition!;
    expect(after.edges.map((edge) => edge.id)).toEqual(['e1', 'yes', 'third', 'elsewhere']);
    store().undo();
    expect(store().definition).toEqual(before);
    store().redo();
    expect(store().definition).toEqual(after);
  });

  it.each(['', 'in', 'bad id'])(
    'keeps a connected edge on its last valid ID while %j is invalid',
    (id) => {
      const edges = store().definition!.edges;
      const changed = config();
      changed.answer.options[2]!.id = id;
      store().updateNode(
        'pick',
        { config: changed },
        { path: 'answer.options.2.id', kind: 'typing', id: 1 },
      );
      expect(validateDraft(store().definition!).schemaValid).toBe(false);
      expect(store().definition!.edges).toBe(edges);
      const fixed = config();
      fixed.answer.options[2]!.id = 'restored';
      store().updateNode(
        'pick',
        { config: fixed },
        { path: 'answer.options.2.id', kind: 'typing', id: 1 },
      );
      expect(store().definition!.edges[3]!.from.port).toBe('restored');
      expect(validateDraft(store().definition!).issues).toEqual([]);
    },
  );

  it('does not rewire duplicate IDs and later preserves each edge when the duplicate is fixed', () => {
    const duplicate = config(['yes', 'no', 'no']);
    const edges = store().definition!.edges;
    store().updateNode('pick', { config: duplicate });
    expect(validateDraft(store().definition!).schemaValid).toBe(false);
    expect(store().definition!.edges).toBe(edges);
    expect(store().definition!.edges.map((edge) => edge.from.port)).toEqual([
      'out',
      'yes',
      'no',
      'third',
    ]);
    const repaired = config(['yes', 'other', 'third']);
    store().updateNode(
      'pick',
      { config: repaired },
      { path: 'answer.options.1.id', kind: 'typing', id: 1 },
    );
    expect(store().definition!.edges.find((edge) => edge.id === 'no')!.from.port).toBe('other');
    expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe('third');
  });

  it('coalesces ID typing and edge rewrites into one undo step', () => {
    const clock = vi.spyOn(historyClock, 'now').mockReturnValue(100);
    try {
      const before = store().definition!;
      const change = { path: 'answer.options.2.id', kind: 'typing' as const, id: 1 };
      for (const id of ['t', 'th', 'three']) {
        const changed = config();
        changed.answer.options[2]!.id = id;
        store().updateNode('pick', { config: changed }, change);
      }
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

  it('removes the owned edge when its option is deleted, including after an incomplete ID edit', () => {
    const incomplete = config();
    incomplete.answer.options[2]!.id = '';
    store().updateNode(
      'pick',
      { config: incomplete },
      { path: 'answer.options.2.id', kind: 'typing', id: 1 },
    );
    const changed = config(['yes', 'no']);
    store().updateNode(
      'pick',
      { config: changed },
      {
        path: 'answer.options',
        kind: 'commit',
        id: 2,
        collection: { type: 'remove', index: 2 },
      },
    );
    expect(store().definition!.edges.some((edge) => edge.id === 'third')).toBe(false);
  });

  it('uses readable labels while retaining IDs as the actual route ports', () => {
    const node = fixture().nodes.find((item) => item.id === 'pick')!;
    if (node.kind !== 'decision') throw new Error('fixture decision missing');
    node.config.answer.options[2]!.label = '7';
    expect(canvasPortLabels(node)).toEqual({ yes: 'Label 1', no: 'Label 2', third: '7' });
  });

  it('retains edges if a malformed intermediate config omits the answer options, and ignores other kinds', () => {
    const edges = store().definition!.edges;
    for (const value of [null, {}, { answer: { options: 'invalid' } }]) {
      store().updateNode('pick', { config: value });
      expect(store().definition!.edges).toBe(edges);
    }
    store().updateNode('pick', { config: config() });
    store().updateNode('start', { config: { subtype: 'manual' } });
    store().updateNode('missing', { config: config() });
    store().updateNode('pick', { label: 'Choose' });
    expect(store().definition!.edges).toBe(edges);
  });
});
