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
  kind: 'expression' as const,
  jsonata: '"yes"',
  routes: options(...ids).map(({ id, label }) => ({ id, label })),
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
  it.each(['expression', 'llm'] as const)(
    'keeps %s route edges through incomplete IDs and repairs',
    (kind) => {
      const definition = fixture();
      const node = definition.nodes.find((node) => node.id === 'pick');
      if (node?.kind !== 'decision') throw new Error('Decision fixture missing');
      const branch =
        kind === 'expression'
          ? config()
          : {
              kind,
              instructions: 'Choose a declared route.',
              harness: 'codex' as const,
              model: { mode: 'inherit' as const },
              effort: { mode: 'inherit' as const },
              routes: config().routes,
            };
      node.config = branch;
      store().load('L1', definition);
      for (const id of ['', 'renamed'])
        store().updateNode(
          'pick',
          {
            config: {
              ...branch,
              routes: branch.routes.map((row, index) => (index === 0 ? { ...row, id } : row)),
            },
          },
          { path: 'routes.0.id', kind: 'typing', id: 910 },
        );
      expect(store().definition?.edges.find((edge) => edge.id === 'yes')?.from.port).toBe(
        'renamed',
      );
      expect(store().definition?.edges.find((edge) => edge.id === 'no')?.from.port).toBe('no');
    },
  );
  beforeEach(() => store().load('L1', fixture()));

  it('scopes JSON replacement to the edited decision, preserving another decision mid-rename', () => {
    const definition = fixture();
    definition.nodes.push({ id: 'other', label: 'Other', kind: 'decision', config: config() });
    definition.edges.push({
      id: 'other-edge',
      from: { node: 'other', port: 'yes' },
      to: { node: 'done' },
    });
    store().load('L1', definition);
    store().updateNode(
      'other',
      { config: config(['unfinished!', 'no', 'third']) },
      {
        path: 'routes.0.id',
        kind: 'typing',
        id: 300,
      },
    );
    store().updateNode(
      'pick',
      { config: config(['yes', 'no', 'fresh']) },
      {
        path: 'routes',
        kind: 'commit',
        id: 301,
        collection: { type: 'replace' },
      },
    );
    expect(store().definition!.edges.find((edge) => edge.id === 'other-edge')!.from.port).toBe(
      'yes',
    );
    expect(store().definition!.edges.some((edge) => edge.id === 'third')).toBe(false);
  });

  it('removes vanished IDs in equal-count JSON replacements instead of treating them as renames', () => {
    store().updateNode(
      'pick',
      { config: config(['third', 'renamed', 'yes']) },
      { path: 'answer', kind: 'commit', id: 101, collection: { type: 'replace' } },
    );
    expect(store().definition!.edges.some((edge) => edge.id === 'no')).toBe(false);
    store().undo();
    expect(store().definition!.edges.find((edge) => edge.id === 'no')!.from.port).toBe('no');
    store().redo();
    expect(store().definition!.edges.some((edge) => edge.id === 'no')).toBe(false);
    expect(store().definition!.edges.find((edge) => edge.id === 'third')!.ui).toEqual({
      route: [300, 400, 500],
    });
    store().updateNode(
      'pick',
      { config: config(['third', 'yes']) },
      { path: 'answer', kind: 'commit', id: 102, collection: { type: 'replace' } },
    );
    expect(store().definition!.edges.some((edge) => edge.id === 'no')).toBe(false);
    expect(store().definition!.edges.find((edge) => edge.id === 'yes')!.from.port).toBe('yes');
    store().undo();
    expect(store().definition!.edges.some((edge) => edge.id === 'no')).toBe(false);
    store().redo();
    expect(store().definition!.edges.some((edge) => edge.id === 'no')).toBe(false);
  });

  it.each([
    ['third', 'yes', 'no'],
    ['no', 'yes', 'third'],
  ])('keeps connections on their IDs through JSON reorder or swap: %j', (...ids) => {
    const edges = store().definition!.edges;
    store().updateNode(
      'pick',
      { config: config(ids) },
      {
        path: 'answer',
        kind: 'commit',
        id: 201,
        collection: { type: 'replace' },
      },
    );
    expect(store().definition!.edges).toEqual(edges);
  });

  it('does not transfer a connection when a single route is renamed in JSON', () => {
    store().updateNode(
      'pick',
      { config: config(['yes', 'no', 'fresh']) },
      {
        path: 'answer',
        kind: 'commit',
        id: 202,
        collection: { type: 'replace' },
      },
    );
    expect(store().definition!.edges.map((edge) => edge.id)).toEqual(['e1', 'yes', 'no']);
  });

  it('renames a stable option ID with its edge while preserving target and layout', () => {
    const before = store().definition!;
    const changed = config();
    changed.routes[2]!.id = 'other';
    store().updateNode('pick', { config: changed }, { path: 'routes.2.id', kind: 'typing', id: 1 });
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
    changed.routes[0]!.label = 'Numeric label 7';
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
        path: 'routes',
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
      changed.routes[2]!.id = id;
      store().updateNode(
        'pick',
        { config: changed },
        { path: 'routes.2.id', kind: 'typing', id: 1 },
      );
      expect(validateDraft(store().definition!).schemaValid).toBe(false);
      expect(store().definition!.edges).toBe(edges);
      const fixed = config();
      fixed.routes[2]!.id = 'restored';
      store().updateNode('pick', { config: fixed }, { path: 'routes.2.id', kind: 'typing', id: 1 });
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
      { path: 'routes.1.id', kind: 'typing', id: 1 },
    );
    expect(store().definition!.edges.find((edge) => edge.id === 'no')!.from.port).toBe('other');
    expect(store().definition!.edges.find((edge) => edge.id === 'third')!.from.port).toBe('third');
  });

  it('coalesces ID typing and edge rewrites into one undo step', () => {
    const clock = vi.spyOn(historyClock, 'now').mockReturnValue(100);
    try {
      const before = store().definition!;
      const change = { path: 'routes.2.id', kind: 'typing' as const, id: 1 };
      for (const id of ['t', 'th', 'three']) {
        const changed = config();
        changed.routes[2]!.id = id;
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
    incomplete.routes[2]!.id = '';
    store().updateNode(
      'pick',
      { config: incomplete },
      { path: 'routes.2.id', kind: 'typing', id: 1 },
    );
    const changed = config(['yes', 'no']);
    store().updateNode(
      'pick',
      { config: changed },
      {
        path: 'routes',
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
    if (node.config.kind !== 'expression') throw new Error('fixture Choice answer missing');
    node.config.routes[2]!.label = '7';
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

  it('keeps Noul side connections attached through ID edits, labels, undo, and redo', () => {
    const definition = newLoopDefinition('noul routes');
    definition.nodes.push({
      id: 'check',
      kind: 'decision',
      label: 'Check',
      config: {
        kind: 'expression',
        routes: [
          {
            id: 'holds',
            label: 'Holds',
          },
          {
            id: 'fails',
            label: 'Fails',
          },
        ],
        jsonata: '(true) ? "holds" : "fails"',
      },
    });
    definition.edges[0]!.to.node = 'check';
    definition.edges.push(
      { id: 'true-edge', from: { node: 'check', port: 'holds' }, to: { node: 'done' } },
      { id: 'false-edge', from: { node: 'check', port: 'fails' }, to: { node: 'start' } },
    );
    store().load('L1', definition);
    const before = store().definition!;
    const changed = {
      kind: 'expression' as const,
      routes: [
        {
          id: 'affirm',
          label: 'Holds',
        },
        {
          id: 'fails',
          label: 'Not true',
        },
      ],
      jsonata: '(true) ? "affirm" : "fails"',
    };
    store().updateNode(
      'check',
      { config: changed },
      { path: 'answer.true.id', kind: 'typing', id: 1 },
    );
    const after = store().definition!;
    expect(after.edges.find((edge) => edge.id === 'true-edge')?.from.port).toBe('affirm');
    expect(after.edges.find((edge) => edge.id === 'false-edge')?.from.port).toBe('fails');
    const node = after.nodes.find((item) => item.id === 'check')!;
    if (node.kind !== 'decision') throw new Error('Noul decision fixture is missing.');
    expect(canvasPortLabels(node)).toEqual({ affirm: 'Holds', fails: 'Not true' });
    expect(validateDraft(after).schemaValid).toBe(true);
    store().undo();
    expect(store().definition).toEqual(before);
    store().redo();
    expect(store().definition).toEqual(after);
  });

  it('moves Score band edges by stable ID and removes only a deleted band route', () => {
    const definition = newLoopDefinition('score routes');
    definition.nodes.push({
      id: 'grade',
      kind: 'decision',
      label: 'Grade',
      config: {
        kind: 'classifier',
        model: 'jev',
        question: 'Score it',
        answer: {
          type: 'score',
          anchors: ['Low', 'Middle', 'High'],
          bands: [
            { id: 'low', label: 'Low', min: 0, max: 0.5 },
            { id: 'middle', label: 'Middle', min: 0.5, max: 1.5 },
            { id: 'high', label: 'High', min: 1.5, max: 2 },
          ],
        },
      },
    });
    definition.edges[0]!.to.node = 'grade';
    definition.edges.push(
      { id: 'low-edge', from: { node: 'grade', port: 'low' }, to: { node: 'done' } },
      { id: 'middle-edge', from: { node: 'grade', port: 'middle' }, to: { node: 'start' } },
      { id: 'high-edge', from: { node: 'grade', port: 'high' }, to: { node: 'done' } },
    );
    store().load('L1', definition);
    const changed = {
      recordAlternatives: true,
      kind: 'classifier' as const,
      model: 'jev',
      question: 'Score it',
      answer: {
        type: 'score' as const,
        anchors: ['Low', 'Middle', 'High'],
        bands: [
          { id: 'low', label: 'Low', min: 0, max: 0.5 },
          { id: 'review', label: 'Review', min: 0.5, max: 1.5 },
          { id: 'high', label: 'High', min: 1.5, max: 2 },
        ],
      },
    };
    store().updateNode(
      'grade',
      { config: changed },
      { path: 'answer.bands.1.id', kind: 'typing', id: 1 },
    );
    expect(store().definition!.edges.find((edge) => edge.id === 'middle-edge')?.from.port).toBe(
      'review',
    );
    const grade = store().definition!.nodes.find((item) => item.id === 'grade')!;
    if (grade.kind !== 'decision') throw new Error('Score decision fixture is missing.');
    expect(canvasPortLabels(grade)).toEqual({ low: 'Low', review: 'Review', high: 'High' });
    const removed = {
      ...changed,
      answer: { ...changed.answer, bands: [changed.answer.bands[0]!, changed.answer.bands[2]!] },
    };
    store().updateNode(
      'grade',
      { config: removed },
      {
        path: 'answer.bands',
        kind: 'commit',
        id: 2,
        collection: { type: 'remove', index: 1 },
      },
    );
    expect(store().definition!.edges.some((edge) => edge.id === 'middle-edge')).toBe(false);
    store().undo();
    expect(store().definition!.edges.find((edge) => edge.id === 'middle-edge')?.from.port).toBe(
      'review',
    );
  });
});
