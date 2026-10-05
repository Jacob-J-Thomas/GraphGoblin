import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();

describe('editor store', () => {
  beforeEach(() => store().reset());

  it('ignores edits before a loop is loaded', () => {
    store().updateMeta({ name: 'x' });
    expect(store().definition).toBeUndefined();
    expect(store().connect({ source: 'a', sourceHandle: null, target: 'b' })).toBe(
      'no loop loaded',
    );
    expect(store().addNode('exit', { x: 0, y: 0 })).toBe('exit');
  });

  it('loads clean or dirty and bumps the revision on edits', () => {
    store().load('L1', newLoopDefinition('a'));
    expect(store()).toMatchObject({ loopId: 'L1', revision: 0, saveState: 'saved' });
    store().load('L1', newLoopDefinition('a'), { dirty: true });
    expect(store()).toMatchObject({ revision: 1, saveState: 'pending' });
    store().updateMeta({ name: 'b', description: 'about' });
    expect(store().definition).toMatchObject({ name: 'b', description: 'about' });
    store().updateMeta({ description: '' });
    expect(store().definition).not.toHaveProperty('description');
    store().updateMeta({});
    expect(store().revision).toBe(4);
  });

  it('opens and closes the node editor without touching the selection', () => {
    store().load('L1', newLoopDefinition('a'));
    store().openNode('nowhere');
    expect(store()).toMatchObject({ selectedNodeId: undefined, nodeDialogOpen: false });
    store().openNode('start');
    expect(store()).toMatchObject({ selectedNodeId: 'start', nodeDialogOpen: true });
    // Opening the node already open keeps its session; another node starts a new one.
    const session = store().nodeDialogSession;
    store().openNode('start');
    expect(store().nodeDialogSession).toBe(session);
    store().openNode('done');
    expect(store().nodeDialogSession).toBe(session + 1);
    store().openNode('start');
    store().closeNodeDialog();
    expect(store()).toMatchObject({ selectedNodeId: 'start', nodeDialogOpen: false });
    // Selecting alone does not open it; renaming keeps it on the node; deleting closes it.
    store().select('done');
    expect(store().nodeDialogOpen).toBe(false);
    store().openNode('done');
    store().renameNode('done', 'finish');
    expect(store()).toMatchObject({ selectedNodeId: 'finish', nodeDialogOpen: true });
    store().removeNode('start');
    expect(store()).toMatchObject({ selectedNodeId: 'finish', nodeDialogOpen: true });
    store().removeNode('finish');
    expect(store()).toMatchObject({ selectedNodeId: undefined, nodeDialogOpen: false });
    // A load closes it too.
    store().load('L1', newLoopDefinition('a'));
    store().openNode('start');
    store().load('L1', newLoopDefinition('b'));
    expect(store().nodeDialogOpen).toBe(false);
  });

  it('keeps a pending focus target for the node editor until it is used or the editor closes', () => {
    store().load('L1', newLoopDefinition('a'));
    expect(store().nodeFocus).toBeUndefined();
    // Opened at an issue's field: the target names the node and the path.
    store().openNode('start', { field: 'config.inputSchema' });
    expect(store()).toMatchObject({
      selectedNodeId: 'start',
      nodeDialogOpen: true,
      nodeFocus: { nodeId: 'start', field: 'config.inputSchema' },
    });
    // The editor uses it once and clears it.
    store().clearNodeFocus();
    expect(store().nodeFocus).toBeUndefined();
    // Already open on the node: a new target, same session (the dialog focuses it at once).
    const session = store().nodeDialogSession;
    store().openNode('start', { field: 'label' });
    expect(store()).toMatchObject({ nodeDialogSession: session, nodeFocus: { field: 'label' } });
    // Without a field (or with an empty one) the heading takes focus: no target.
    store().openNode('done');
    expect(store().nodeFocus).toBeUndefined();
    store().openNode('done', { field: '' });
    expect(store().nodeFocus).toBeUndefined();
    store().openNode('done', { field: undefined });
    expect(store().nodeFocus).toBeUndefined();
    // An unknown node opens nothing and leaves the target alone; closing drops it.
    store().openNode('start', { field: 'label' });
    store().openNode('nowhere', { field: 'id' });
    expect(store().nodeFocus).toEqual({ nodeId: 'start', field: 'label' });
    store().closeNodeDialog();
    expect(store().nodeFocus).toBeUndefined();
    // A load forgets it.
    store().openNode('start', { field: 'label' });
    store().load('L1', newLoopDefinition('b'));
    expect(store().nodeFocus).toBeUndefined();
  });

  it('adds, updates, moves, renames, and removes nodes', () => {
    store().load('L1', newLoopDefinition('a'));
    const id = store().addNode('mutate', { x: 1, y: 2 });
    expect(store().selectedNodeId).toBe('mutate');
    store().updateNode(id, { label: 'Prep', config: { operations: [] } });
    store().updateNode(id, {});
    store().moveNode(id, { x: 5, y: 6 });
    const node = store().definition!.nodes.find((n) => n.id === id)!;
    expect(node).toMatchObject({ label: 'Prep', config: { operations: [] }, ui: { x: 5, y: 6 } });

    store().connect({ source: 'start', sourceHandle: 'out', target: id });
    store().removeEdge('e1');
    expect(store().connect({ source: 'start', sourceHandle: 'out', target: id })).toBeNull();
    store().renameNode(id, 'prep');
    store().renameNode('prep', 'prep');
    expect(store().selectedNodeId).toBe('prep');
    expect(store().definition!.edges.some((e) => e.to.node === 'prep')).toBe(true);

    store().select('start');
    store().removeNode('prep');
    expect(store().definition!.edges.some((e) => e.to.node === 'prep')).toBe(false);
    expect(store().selectedNodeId).toBe('start');
    store().removeNode('start');
    expect(store().selectedNodeId).toBeUndefined();
  });

  it('keeps exit loop-backs in sync with edges, renames, and removals', () => {
    store().load('L1', newLoopDefinition('a'));
    store().addNode('mutate', { x: 0, y: 0 });
    expect(
      store().connect({ source: 'done', sourceHandle: 'loopBack', target: 'mutate' }),
    ).toBeNull();
    const exit = () => store().definition!.nodes.find((n) => n.id === 'done')!;
    expect(exit().config).toEqual({ loopBack: { targetNodeId: 'mutate' } });
    store().renameNode('mutate', 'again');
    expect(exit().config).toEqual({ loopBack: { targetNodeId: 'again' } });
    const edgeId = store().definition!.edges.find((e) => e.from.port === 'loopBack')!.id;
    store().removeEdge(edgeId);
    expect(exit().config).toEqual({});
    store().connect({ source: 'done', sourceHandle: 'loopBack', target: 'again' });
    store().removeNode('again');
    expect(exit().config).toEqual({});
    store().removeEdge('missing');

    expect(store().connect({ source: 'done', sourceHandle: 'loopBack', target: 'start' })).toBe(
      'triggers have no input',
    );
    expect(store().connectionError).toBe('triggers have no input');
  });

  it('replaces settings and variables and tracks save state', () => {
    store().load('L1', kitchenSinkLoop());
    store().updateSettings({ maxIterations: 5 });
    store().updateVariables({ n: { type: 'number' } });
    expect(store().definition).toMatchObject({
      settings: { maxIterations: 5 },
      variables: { n: { type: 'number' } },
    });
    store().setSaveState('saved', undefined, 7);
    expect(store()).toMatchObject({ saveState: 'saved', savedRevision: 7 });
    store().setSaveState('error', 'boom');
    expect(store()).toMatchObject({ saveState: 'error', saveMessage: 'boom', savedRevision: 7 });
  });
});
