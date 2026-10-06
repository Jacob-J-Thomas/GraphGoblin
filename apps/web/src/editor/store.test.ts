import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COALESCE_MS, HISTORY_LIMIT, historyClock } from './history.js';
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

  it('refuses invalid manual routes without changing the draft or its undo history', () => {
    store().load('L1', newLoopDefinition('a'));
    const id = store().definition!.edges[0]!.id;
    store().setEdgeRoute(id, [160]);
    const before = store();
    for (const invalid of [
      [],
      [1, 2],
      Array.from({ length: 65 }, (_, i) => i),
      [Infinity],
      [NaN],
    ]) {
      store().setEdgeRoute(id, invalid);
      expect(store()).toBe(before);
    }
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
    expect(store().revision).toBe(3);
    // An edit that changes nothing is not an edit: no revision, no save, no undo step.
    const steps = store().past.length;
    store().updateMeta({});
    store().updateMeta({ name: 'b' });
    store().updateNode('start', { label: 'Start' });
    store().moveNode('start', store().definition!.nodes[0]!.ui!);
    store().moveNode('missing', { x: 1, y: 1 });
    store().removeEdge('missing');
    store().removeNode('missing');
    store().setFieldError('settings', 'x', undefined);
    expect(store()).toMatchObject({ revision: 3, past: { length: steps } });
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

describe('undo and redo', () => {
  let clock = 0;
  beforeEach(() => {
    store().reset();
    clock = 0;
    vi.spyOn(historyClock, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  /** Let the merge window pass, so the next change is a step of its own. */
  const pause = () => {
    clock += COALESCE_MS;
  };
  const snapshot = () => ({ definition: store().definition, fieldErrors: store().fieldErrors });
  const node = (id: string) => store().definition!.nodes.find((n) => n.id === id);
  const unparsed = { message: 'invalid JSON', text: '{' };

  it('has nothing to undo or redo on a fresh load', () => {
    store().undo();
    store().load('L1', newLoopDefinition('a'));
    const before = store().definition;
    store().undo();
    store().redo();
    expect(store()).toMatchObject({ definition: before, revision: 0, historyEpoch: 0 });
    expect(store().past).toEqual([]);
    expect(store().future).toEqual([]);
  });

  it.each<[string, () => void, (() => void)?]>([
    ['add mutate', () => store().addNode('mutate', { x: 1, y: 2 })],
    ['move start', () => store().moveNode('start', { x: 5, y: 6 })],
    [
      'connect mutate to done',
      () => store().connect({ source: 'mutate', sourceHandle: 'out', target: 'done' }),
      () => store().addNode('mutate', { x: 0, y: 0 }),
    ],
    [
      'connect done loopBack to mutate',
      () => store().connect({ source: 'done', sourceHandle: 'loopBack', target: 'mutate' }),
      () => store().addNode('mutate', { x: 0, y: 0 }),
    ],
    ['remove edge start to done', () => store().removeEdge('e1')],
    ['delete done', () => store().removeNode('done')],
    ['rename done to finish', () => store().renameNode('done', 'finish')],
    ['edit label of start', () => store().updateNode('start', { label: 'Begin' })],
    [
      'edit config of start',
      () => store().updateNode('start', { config: { subtype: 'manual', exposeTo: ['ui'] } }),
    ],
    ['edit start', () => store().updateNode('start', { label: 'B', config: { subtype: 'cron' } })],
    ['edit loop name', () => store().updateMeta({ name: 'b' })],
    ['edit loop description', () => store().updateMeta({ description: 'about' })],
    ['edit loop name and description', () => store().updateMeta({ name: 'b', description: 'c' })],
    ['edit loop settings', () => store().updateSettings({ maxIterations: 5 })],
    ['edit variables', () => store().updateVariables({ n: { type: 'number' } })],
    ['edit config of start', () => store().setFieldError('node:start', 'inputSchema', unparsed)],
    ['edit loop settings', () => store().setFieldError('settings', 'defaults', unparsed)],
    ['edit variables', () => store().setFieldError('variables', 'variables.n', unparsed)],
    ['edit custom', () => store().setFieldError('custom', 'path', unparsed)],
  ])('undoes and redoes "%s" exactly', (label, change, setup) => {
    store().load('L1', newLoopDefinition('a'));
    setup?.();
    pause();
    const before = snapshot();
    change();
    const after = snapshot();
    expect(after).not.toEqual(before);
    expect(store().past.at(-1)!.label).toBe(label);
    store().undo();
    expect(snapshot().definition).toBe(before.definition);
    expect(snapshot().fieldErrors).toBe(before.fieldErrors);
    expect(store().future.at(-1)!.label).toBe(label);
    store().redo();
    expect(snapshot().definition).toBe(after.definition);
    expect(snapshot().fieldErrors).toBe(after.fieldErrors);
    expect(store().past.at(-1)!.label).toBe(label);
    expect(store().future).toEqual([]);
  });

  it('makes undo and redo edits that autosave, and remounts the forms', () => {
    store().load('L1', newLoopDefinition('a'));
    store().updateMeta({ name: 'b' });
    store().setSaveState('saved', undefined, store().revision);
    store().undo();
    expect(store()).toMatchObject({ revision: 2, saveState: 'pending', historyEpoch: 1 });
    expect(store().definition!.name).toBe('a');
    store().redo();
    expect(store()).toMatchObject({ revision: 3, saveState: 'pending', historyEpoch: 2 });
    // A step that only changed unparsed text has nothing for autosave to send.
    pause();
    store().setFieldError('settings', 'defaults', unparsed);
    store().setSaveState('saved', undefined, store().revision);
    store().undo();
    expect(store()).toMatchObject({ revision: 3, saveState: 'saved', historyEpoch: 3 });
    expect(store().fieldErrors).toEqual({});
  });

  it('clears redo on a new edit after an undo', () => {
    store().load('L1', newLoopDefinition('a'));
    store().addNode('mutate', { x: 0, y: 0 });
    pause();
    store().addNode('wait', { x: 0, y: 0 });
    store().undo();
    expect(store().future).toHaveLength(1);
    store().updateMeta({ name: 'b' });
    expect(store().future).toEqual([]);
    store().redo();
    expect(node('wait')).toBeUndefined();
    expect(store().past.map((entry) => entry.label)).toEqual(['add mutate', 'edit loop name']);
  });

  it('merges typing in one field, and a drag or nudges of one node, into one step', () => {
    store().load('L1', newLoopDefinition('a'));
    for (const label of ['h', 'he', 'hel', 'hell', 'hello']) {
      store().updateNode('start', { label });
      clock += 200;
    }
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(node('start')!.label).toBe('Start');
    store().redo();
    expect(node('start')!.label).toBe('hello');

    // After an undo or redo the next change starts a step of its own, even in the same field.
    store().updateNode('start', { label: 'hello!' });
    expect(store().past).toHaveLength(2);

    // A drag ends with the same position twice (xyflow's change and its drag stop): one step.
    pause();
    store().moveNode('done', { x: 400, y: 90 });
    store().moveNode('done', { x: 400, y: 90 });
    // Arrow-key nudges in quick succession: one step.
    pause();
    store().moveNode('start', { x: 5, y: 80 });
    clock += 100;
    store().moveNode('start', { x: 10, y: 80 });
    expect(store().past.map((entry) => entry.label)).toEqual([
      'edit label of start',
      'edit label of start',
      'move done',
      'move start',
    ]);
    store().undo();
    expect(node('start')!.ui).toEqual({ x: 0, y: 80 });
    store().undo();
    expect(node('done')!.ui).toEqual({ x: 320, y: 80 });

    // Typing a value and deleting it again leaves no step behind.
    pause();
    const steps = store().past.length;
    store().updateMeta({ description: 'x' });
    store().updateMeta({ description: '' });
    expect(store().past).toHaveLength(steps);
  });

  it('stores, merges, resets, and restores an edge’s manual route (#44)', () => {
    store().load('L1', newLoopDefinition('a'));
    const edge = () => store().definition!.edges[0]!;
    const id = edge().id;
    // An unknown edge, or removing a route the edge does not have, changes nothing.
    store().setEdgeRoute('missing', [1]);
    store().setEdgeRoute(id, undefined);
    expect(store().past).toHaveLength(0);
    store().setEdgeRoute(id, [160]);
    expect(edge().ui).toEqual({ route: [160] });
    // Arrow-key nudges of one edge in quick succession are one step, like a node's.
    clock += 100;
    store().setEdgeRoute(id, [182]);
    clock += 100;
    store().setEdgeRoute(id, [204]);
    expect(store().past.map((entry) => entry.label)).toEqual(['reroute start to done']);
    // A drag closes the step before it, so its single change is a step of its own.
    store().closeStep();
    store().setEdgeRoute(id, [240, 300, 260]);
    // Reset is a step of its own, however soon it follows.
    store().setEdgeRoute(id, undefined);
    expect(edge()).not.toHaveProperty('ui');
    expect(store().past.map((entry) => entry.label)).toEqual([
      'reroute start to done',
      'reroute start to done',
      'reset route of start to done',
    ]);
    store().undo();
    expect(edge().ui).toEqual({ route: [240, 300, 260] });
    store().undo();
    expect(edge().ui).toEqual({ route: [204] });
    store().undo();
    expect(edge()).not.toHaveProperty('ui');
    store().redo();
    store().redo();
    store().redo();
    expect(edge()).not.toHaveProperty('ui');
    // The route belongs to the edge: a rename keeps it; removing the edge removes it.
    store().undo();
    store().renameNode('start', 'begin');
    expect(edge()).toMatchObject({ from: { node: 'begin' }, ui: { route: [240, 300, 260] } });
    store().removeEdge(id);
    expect(store().definition!.edges).toHaveLength(0);
    store().undo();
    expect(edge().ui).toEqual({ route: [240, 300, 260] });
    // A node move that removes or changes a route it disturbs merges it into the move's step.
    pause();
    const steps = store().past.length;
    store().moveNode('done', { x: 500, y: 300 });
    store().setEdgeRoute(id, undefined, 'move:done');
    expect(store().past).toHaveLength(steps + 1);
    expect(store().past.at(-1)!.label).toBe('move done');
    store().setEdgeRoute(id, [10], 'move:done');
    expect(store().past).toHaveLength(steps + 1);
    store().undo();
    expect(edge().ui).toEqual({ route: [240, 300, 260] });
  });

  it('merges a form’s unparsed text with its edits, and brings it back on undo', () => {
    store().load('L1', newLoopDefinition('a'));
    const schema = { type: 'object' };
    // Typed JSON that does not parse, then does: the config field's one step.
    store().setFieldError('node:start', 'inputSchema', { message: 'invalid JSON', text: '{"t' });
    store().setFieldError('node:start', 'inputSchema', undefined);
    store().updateNode('start', { config: { subtype: 'manual', inputSchema: schema } });
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(node('start')!.config).toEqual({ subtype: 'manual' });
    expect(store().fieldErrors).toEqual({});

    // Text left unparsed is a step of its own: undo drops it, redo brings it back.
    store().redo();
    pause();
    store().setFieldError('node:start', 'inputSchema', unparsed);
    store().undo();
    expect(store().fieldErrors).toEqual({});
    expect(node('start')!.config).toEqual({ subtype: 'manual', inputSchema: schema });
    store().redo();
    expect(store().fieldErrors).toEqual({ 'node:start': { inputSchema: unparsed } });
  });

  it('keeps a discard of unparsed text as a step of its own, however soon it follows the typing', () => {
    store().load('L1', newLoopDefinition('a'));
    store().addNode('wait', { x: 0, y: 0 });
    pause();
    store().setFieldError('node:start', 'inputSchema', unparsed);
    // Discarded at once: still its own step, so the typing step is not dropped with it.
    store().setFieldError('node:start', 'inputSchema', undefined, 'discard');
    expect(store().past.map((entry) => entry.label)).toEqual([
      'add wait',
      'edit config of start',
      'discard text in inputSchema of start',
    ]);
    store().undo();
    expect(store().fieldErrors).toEqual({ 'node:start': { inputSchema: unparsed } });
    expect(node('wait')).toBeDefined();
    store().redo();
    expect(store().fieldErrors).toEqual({});
    // Typing right after a discard starts a new step too; the loop's forms name their scope.
    store().setFieldError('settings', 'defaults', unparsed);
    store().setFieldError('settings', 'defaults', undefined, 'discard');
    store().setFieldError('variables', 'variables.n', unparsed);
    store().setFieldError('variables', 'variables.n', undefined, 'discard');
    expect(
      store()
        .past.slice(-4)
        .map((entry) => entry.label),
    ).toEqual([
      'edit loop settings',
      'discard text in defaults of loop settings',
      'edit variables',
      'discard text in variables.n of variables',
    ]);
    // Clearing by typing until the text parses still merges with the typing.
    pause();
    const steps = store().past.length;
    store().setFieldError('node:start', 'inputSchema', unparsed);
    store().setFieldError('node:start', 'inputSchema', undefined);
    expect(store().past).toHaveLength(steps);
  });

  it('restores a deleted node with its edges, unparsed text, and an exit’s loop-back target', () => {
    store().load('L1', newLoopDefinition('a'));
    store().addNode('mutate', { x: 0, y: 0 });
    store().connect({ source: 'mutate', sourceHandle: 'out', target: 'done' });
    store().connect({ source: 'done', sourceHandle: 'loopBack', target: 'mutate' });
    store().setFieldError('node:mutate', 'operations', unparsed);
    store().openNode('mutate');
    pause();
    const before = snapshot();
    store().removeNode('mutate');
    expect(store()).toMatchObject({ selectedNodeId: undefined, nodeDialogOpen: false });
    expect(node('done')!.config).toEqual({});
    expect(store().fieldErrors).toEqual({});
    store().undo();
    expect(snapshot()).toEqual(before);
    expect(node('done')!.config).toEqual({ loopBack: { targetNodeId: 'mutate' } });
    const touching = store().definition!.edges.filter((e) =>
      [e.from.node, e.to.node].includes('mutate'),
    );
    expect(touching).toHaveLength(2);
    expect(store().fieldErrors['node:mutate']).toEqual({ operations: unparsed });
  });

  it('keeps a renamed node selected and its editor open across undo and redo', () => {
    store().load('L1', newLoopDefinition('a'));
    store().addNode('mutate', { x: 0, y: 0 });
    store().connect({ source: 'done', sourceHandle: 'loopBack', target: 'mutate' });
    store().setFieldError('node:mutate', 'operations', unparsed);
    store().openNode('mutate');
    const session = store().nodeDialogSession;
    pause();
    store().renameNode('mutate', 'prep');
    expect(store().selectedNodeId).toBe('prep');
    store().undo();
    expect(store()).toMatchObject({
      selectedNodeId: 'mutate',
      nodeDialogOpen: true,
      nodeDialogSession: session,
    });
    expect(node('done')!.config).toEqual({ loopBack: { targetNodeId: 'mutate' } });
    expect(store().definition!.edges.at(-1)!.to.node).toBe('mutate');
    expect(store().fieldErrors).toEqual({ 'node:mutate': { operations: unparsed } });
    store().redo();
    expect(store()).toMatchObject({ selectedNodeId: 'prep', nodeDialogOpen: true });
    expect(store().fieldErrors).toEqual({ 'node:prep': { operations: unparsed } });
    // With another node selected, undo and redo leave the selection alone.
    store().select('start');
    store().undo();
    expect(store().selectedNodeId).toBe('start');
    store().redo();
    expect(store().selectedNodeId).toBe('start');
  });

  it('deselects a node that an undo removes, and closes its editor for good', () => {
    store().load('L1', newLoopDefinition('a'));
    store().addNode('mutate', { x: 0, y: 0 });
    store().openNode('mutate', { field: 'config.operations' });
    store().undo();
    expect(store()).toMatchObject({
      selectedNodeId: undefined,
      nodeDialogOpen: false,
      nodeFocus: undefined,
    });
    store().redo();
    expect(node('mutate')).toBeDefined();
    expect(store()).toMatchObject({ selectedNodeId: undefined, nodeDialogOpen: false });
  });

  it('keeps the last 100 steps: 101 edits and 101 undos leave the first edit in place', () => {
    store().load('L1', newLoopDefinition('a'));
    for (let i = 1; i <= HISTORY_LIMIT + 1; i += 1) {
      store().updateMeta({ name: `name ${i}` });
      pause();
    }
    expect(store().past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i <= HISTORY_LIMIT; i += 1) store().undo();
    expect(store().definition!.name).toBe('name 1');
    expect(store().future).toHaveLength(HISTORY_LIMIT);
  });

  it('starts afresh on a load or a reset', () => {
    store().load('L1', newLoopDefinition('a'));
    store().updateMeta({ name: 'b' });
    pause();
    store().updateMeta({ description: 'c' });
    store().undo();
    expect(store()).toMatchObject({ past: { length: 1 }, future: { length: 1 } });
    store().load('L1', newLoopDefinition('server'));
    expect(store()).toMatchObject({ past: [], future: [], openStep: undefined, historyEpoch: 0 });
    store().undo();
    expect(store().definition!.name).toBe('server');
    store().updateMeta({ name: 'x' });
    store().reset();
    expect(store()).toMatchObject({ past: [], future: [], definition: undefined });
    // Unparsed text reported before a loop is loaded is not a step.
    store().setFieldError('settings', 'x', unparsed);
    expect(store().past).toEqual([]);
  });
});
