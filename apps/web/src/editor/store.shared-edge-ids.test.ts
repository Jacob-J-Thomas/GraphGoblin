import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormChange } from '../forms/changes.js';
import { COALESCE_MS } from './history.js';
import { rowConnections, type DecisionRoutes } from './decision-route-edges.js';
import { newLoopDefinition, validateDraft } from './model.js';
import { sharedEdgeIdRefusal, useEditorStore } from './store.js';

/**
 * #481: a current-format draft the API admits can give two stored edges one id (validation reports
 * `DUPLICATE_EDGE_ID`). Decision route bookkeeping and the edge-route actions must then act on the
 * one record they can identify, never on another record merely because its id matches.
 */
const store = () => useEditorStore.getState();
const edges = () => store().definition!.edges;
const routes = (...ids: string[]) => ({
  kind: 'expression' as const,
  jsonata: '"yes"',
  routes: ids.map((id) => ({ id, label: id.toUpperCase() })),
});
const SHARED =
  /^More than one connection uses the ID "e1", so the editor cannot tell which one you mean\./;

/**
 * Across source nodes, the issue's draft: `start → via` and the edge `via`'s `yes` row owns both
 * use `e1`, each with its own manual route; `c1` is an ordinary unique connection.
 */
function acrossSources(): LoopDefinitionInput {
  const definition = newLoopDefinition('Shared across sources');
  definition.nodes.push(
    { id: 'via', kind: 'decision', label: 'Via', config: routes('yes', 'no') },
    { id: 'spare', kind: 'trigger', label: 'Spare', config: { type: 'manual' } },
    { id: 'other', kind: 'exit', label: 'Other', config: {} },
  );
  definition.edges = [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'via' }, ui: { route: [120] } },
    { id: 'e1', from: { node: 'via', port: 'yes' }, to: { node: 'done' }, ui: { route: [635] } },
    { id: 'c1', from: { node: 'spare', port: 'out' }, to: { node: 'other' } },
  ];
  return definition;
}

/**
 * Within one Decision: the `yes` and `no` rows of `pick` each own an edge called `e1`; `m1` is the
 * unique connection of its `maybe` row.
 */
function withinDecision(): LoopDefinitionInput {
  const definition = newLoopDefinition('Shared within a decision');
  definition.nodes.push(
    { id: 'pick', kind: 'decision', label: 'Pick', config: routes('yes', 'no', 'maybe') },
    { id: 'other', kind: 'exit', label: 'Other', config: {} },
  );
  definition.edges = [
    { id: 's1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
    {
      id: 'e1',
      from: { node: 'pick', port: 'yes' },
      to: { node: 'done' },
      ui: { route: [400, 200, 500] },
    },
    { id: 'e1', from: { node: 'pick', port: 'no' }, to: { node: 'other' } },
    { id: 'm1', from: { node: 'pick', port: 'maybe' }, to: { node: 'done' } },
  ];
  return definition;
}

const typing = (path: string): FormChange => ({ path, kind: 'typing', id: 481 });
const removal = (index: number): FormChange => ({
  path: 'routes',
  kind: 'commit',
  id: 482,
  collection: { type: 'remove', index },
});
const replacement: FormChange = {
  path: 'routes',
  kind: 'commit',
  id: 483,
  collection: { type: 'replace' },
};

/**
 * Every record but `except` (indices into `definition.edges`) is still stored as its very object:
 * ends, port and manual route untouched. Each fixture record is told apart by its id, source node
 * and target node, so a rewrite shows as a readable difference before the identity check.
 */
function untouched(definition: LoopDefinitionInput, except: readonly number[] = []) {
  definition.edges.forEach((edge, index) => {
    if (except.includes(index)) return;
    const label = `edge ${index} (${edge.id} from ${edge.from.node} to ${edge.to.node})`;
    const stored = edges().find(
      (candidate) =>
        candidate.id === edge.id &&
        candidate.from.node === edge.from.node &&
        candidate.to.node === edge.to.node,
    );
    expect(stored, label).toEqual(edge);
    expect(stored, label).toBe(edge);
  });
}

beforeEach(() => {
  store().reset();
  vi.useFakeTimers({ toFake: ['performance'] });
});
afterEach(() => {
  vi.useRealTimers();
});
const pause = () => vi.advanceTimersByTime(COALESCE_MS);

describe('the shared-id fixtures', () => {
  it.each([
    ['across sources', acrossSources],
    ['within a decision', withinDecision],
  ])('parse, report DUPLICATE_EDGE_ID and load unchanged (%s)', (_, fixture) => {
    const definition = fixture();
    expect(LoopDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(validateDraft(definition).issues.map((issue) => issue.code)).toContain(
      'DUPLICATE_EDGE_ID',
    );
    store().load('L1', definition);
    expect(store().definition).toBe(definition);
  });
});

describe('unrelated edits of a draft with a shared edge id (#481)', () => {
  it.each([
    ['removing a unique connection', () => store().removeEdge('c1'), [2]],
    ['renaming the loop', () => store().updateMeta({ name: 'Renamed' }), []],
    ['moving a card', () => store().moveNode('done', { x: 999, y: 99 }), []],
    ['relabelling the Decision', () => store().updateNode('via', { label: 'Through' }), []],
    ['adding a card', () => store().addNode('wait', { x: 5, y: 5 }), []],
    ['rerouting a unique connection', () => store().setEdgeRoute('c1', [77]), [2]],
  ] as const)('keep every other record exactly across sources: %s', (_, act, changed) => {
    const definition = acrossSources();
    store().load('L1', definition);
    act();
    expect(store().definition).not.toBe(definition);
    untouched(definition, changed);
    expect(edges()[0]).toEqual(definition.edges[0]);
    expect(edges()[1]).toEqual(definition.edges[1]);
  });

  it.each([
    ['removing a unique connection', () => store().removeEdge('m1'), [3]],
    ['renaming the loop', () => store().updateMeta({ name: 'Renamed' }), []],
    ['moving a card', () => store().moveNode('done', { x: 999, y: 99 }), []],
    ['relabelling the Decision', () => store().updateNode('pick', { label: 'Choose' }), []],
    [
      'editing a row label',
      () =>
        store().updateNode(
          'pick',
          {
            config: {
              ...routes('yes', 'no', 'maybe'),
              routes: [
                { id: 'yes', label: 'Yes please' },
                { id: 'no', label: 'NO' },
                { id: 'maybe', label: 'MAYBE' },
              ],
            },
          },
          typing('routes.0.label'),
        ),
      [],
    ],
  ] as const)('keep every other record exactly within a Decision: %s', (_, act, changed) => {
    const definition = withinDecision();
    store().load('L1', definition);
    act();
    expect(store().definition).not.toBe(definition);
    untouched(definition, changed);
  });

  it('keep both records when the device restores the table an earlier editor left', () => {
    // An earlier editor saved this ownership with the device copy: the `yes` and `no` rows both
    // name `e1` (twice, as the bookkeeping recorded it after one edit).
    const table: DecisionRoutes = {
      pick: {
        nextKey: 3,
        rows: [
          { key: 0, id: 'yes', edgeIds: ['e1', 'e1'] },
          { key: 1, id: 'no', edgeIds: ['e1', 'e1'] },
          { key: 2, id: 'maybe', edgeIds: ['m1'] },
        ],
      },
    };
    const definition = withinDecision();
    store().load('L1', definition, { dirty: true, deviceSaved: true, decisionRoutes: table });
    store().updateMeta({ name: 'Renamed' });
    untouched(definition);
    const across = acrossSources();
    store().load('L1', across, {
      dirty: true,
      deviceSaved: true,
      decisionRoutes: {
        via: {
          nextKey: 2,
          rows: [
            { key: 0, id: 'yes', edgeIds: ['e1'] },
            { key: 1, id: 'no', edgeIds: [] },
          ],
        },
      },
    });
    store().removeEdge('c1');
    untouched(across, [2]);
  });
});

describe('route row edits own only their identified record (#481)', () => {
  it('renames across sources: only the Decision’s own record follows its row', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    store().updateNode('via', { config: routes('affirm', 'no') }, typing('routes.0.id'));
    const after = store().definition!;
    expect(edges()[0]).toBe(definition.edges[0]);
    expect(edges()[1]).toEqual({ ...definition.edges[1], from: { node: 'via', port: 'affirm' } });
    expect(edges()[2]).toBe(definition.edges[2]);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toBe(definition);
    store().redo();
    expect(store().definition).toBe(after);
  });

  it('renames within a Decision: only the record on the renamed row’s port follows it', () => {
    const definition = withinDecision();
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('affirm', 'no', 'maybe') }, typing('routes.0.id'));
    expect(edges()[1]).toEqual({ ...definition.edges[1], from: { node: 'pick', port: 'affirm' } });
    untouched(definition, [1]);
    // Typing on keeps following the same record.
    store().updateNode(
      'pick',
      { config: routes('affirmed', 'no', 'maybe') },
      typing('routes.0.id'),
    );
    expect(edges()[1]!.from.port).toBe('affirmed');
    expect(edges()[1]!.ui).toEqual({ route: [400, 200, 500] });
    untouched(definition, [1]);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toBe(definition);
  });

  it('removes across sources only the removed row’s own record, and Undo restores it', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    store().updateNode('via', { config: routes('no') }, removal(0));
    const after = store().definition!;
    expect(after.edges).toEqual([definition.edges[0], definition.edges[2]]);
    untouched(definition, [1]);
    // The id is unique again: the duplicate is repaired.
    expect(validateDraft(after).issues.map((issue) => issue.code)).not.toContain(
      'DUPLICATE_EDGE_ID',
    );
    store().undo();
    expect(store().definition).toBe(definition);
    store().redo();
    expect(store().definition).toBe(after);
  });

  it('removes within a Decision only the record on the removed row’s port', () => {
    const definition = withinDecision();
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('yes', 'maybe') }, removal(1));
    expect(edges()).toEqual([definition.edges[0], definition.edges[1], definition.edges[3]]);
    untouched(definition, [2]);
    store().undo();
    expect(store().definition).toBe(definition);
  });

  it('replaces section JSON across sources: only the Decision’s record on a vanished port goes', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    store().updateNode('via', { config: routes('no') }, replacement);
    expect(edges()).toEqual([definition.edges[0], definition.edges[2]]);
    untouched(definition, [1]);
  });

  it('replaces section JSON within a Decision: only the record on the vanished port goes', () => {
    const definition = withinDecision();
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('yes', 'maybe') }, replacement);
    expect(edges()).toEqual([definition.edges[0], definition.edges[1], definition.edges[3]]);
    untouched(definition, [2]);
  });
});

describe('edge routes by a shared id (#481)', () => {
  it.each([
    ['a drag or nudge', [300] as readonly number[] | undefined, undefined],
    ['Reset route', undefined, undefined],
    ['a card move’s reset', undefined, 'move:done'],
  ])('refuses %s, changing nothing but the notice', (_, route, key) => {
    const definition = acrossSources();
    store().load('L1', definition, { baseToken: 'token-1', deviceSaved: true });
    store().moveNode('spare', { x: 1, y: 1 });
    const before = store();
    store().setEdgeRoute('e1', route, key);
    expect(store().definition).toBe(before.definition);
    expect(store().past).toBe(before.past);
    expect(store().openStep).toBe(before.openStep);
    expect(store().revision).toBe(before.revision);
    expect(store().connectionError).toMatch(SHARED);
  });

  it('shows the repair guidance, keeps redo, and lets a move’s other resets merge', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    store().setEdgeRoute('c1', [10]);
    store().undo();
    const future = store().future;
    store().setEdgeRoute('e1', [300]);
    expect(store().connectionError).toBe(sharedEdgeIdRefusal('e1'));
    expect(sharedEdgeIdRefusal('e1')).toBe(
      'More than one connection uses the ID "e1", so the editor cannot tell which one you mean. To repair it, remove a Decision route one of them starts from (its review should list just that connection), add the route back and draw its connection again, until one keeps the ID. Otherwise, or without a pointer, correct the ID with PUT /loops/{id}/draft.',
    );
    // Nothing to undo or redo changed: Redo still brings back the undone route.
    expect(store().future).toBe(future);
    store().redo();
    expect(edges()[2]!.ui).toEqual({ route: [10] });
    // A card move that resets routes: the shared id is refused, a unique one merges into the move.
    pause();
    store().moveNode('other', { x: 50, y: 50 });
    const steps = store().past.length;
    useEditorStore.setState({ connectionError: undefined });
    store().setEdgeRoute('e1', undefined, 'move:other');
    expect(store().connectionError).toBe(sharedEdgeIdRefusal('e1'));
    store().setEdgeRoute('c1', undefined, 'move:other');
    expect(store().past).toHaveLength(steps);
    expect(store().past.at(-1)!.label).toBe('move other');
    expect(edges()[2]).not.toHaveProperty('ui');
    untouched(definition, [2]);
    store().undo();
    expect(edges()[2]!.ui).toEqual({ route: [10] });
  });

  it('still reroutes, coalesces and resets a unique connection', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    store().setEdgeRoute('c1', [10]);
    vi.advanceTimersByTime(100);
    store().setEdgeRoute('c1', [32]);
    expect(store().past.map((step) => step.label)).toEqual(['reroute spare to other']);
    pause();
    store().setEdgeRoute('c1', undefined);
    expect(edges()[2]).toEqual(definition.edges[2]);
    untouched(definition, [2]);
    expect(store().connectionError).toBeUndefined();
  });
});

describe('records a shared id cannot tell apart within a Decision (#481)', () => {
  /** `pick`'s `yes` port holds two edges called `e1` (doubly connected, as an import can be). */
  function samePort(): LoopDefinitionInput {
    const definition = withinDecision();
    definition.edges[2] = { ...definition.edges[2]!, from: { node: 'pick', port: 'yes' } };
    return definition;
  }

  it('neither moves nor removes either record, and the review lists none', () => {
    const definition = samePort();
    store().load('L1', definition);
    expect(rowConnections(definition, store().decisionRoutes, 'pick', 0)).toEqual([]);
    store().updateNode('pick', { config: routes('affirm', 'no', 'maybe') }, typing('routes.0.id'));
    untouched(definition);
    pause();
    store().updateNode('pick', { config: routes('no', 'maybe') }, removal(0));
    untouched(definition);
    // The config edit itself applied; Undo restores it.
    expect(store().past).toHaveLength(2);
    store().undo();
    store().undo();
    expect(store().definition).toBe(definition);
  });

  it('lists in the removal review exactly the record the removal takes', () => {
    const across = acrossSources();
    store().load('L1', across);
    expect(rowConnections(across, store().decisionRoutes, 'via', 0)).toEqual([across.edges[1]]);
    expect(rowConnections(across, store().decisionRoutes, 'via', 1)).toEqual([]);
    expect(rowConnections(across, store().decisionRoutes, 'via', 9)).toEqual([]);
    expect(rowConnections(across, store().decisionRoutes, 'start', 0)).toEqual([]);
    const within = withinDecision();
    store().load('L1', within);
    expect(rowConnections(within, store().decisionRoutes, 'pick', 0)).toEqual([within.edges[1]]);
    expect(rowConnections(within, store().decisionRoutes, 'pick', 1)).toEqual([within.edges[2]]);
  });
});

describe('a route ID typed through another row’s or a blank one (#481)', () => {
  /**
   * The within-Decision draft with its `no` record given a manual route of its own: the two `e1`
   * records differ in port, target and geometry.
   */
  function bothRouted(): LoopDefinitionInput {
    const definition = withinDecision();
    definition.edges[2] = { ...definition.edges[2]!, ui: { route: [650] } };
    return definition;
  }
  type Edge = LoopDefinitionInput['edges'][number];
  /** The fixture's records in stored order: `start → pick`, `yes → done`, `no → other`, `maybe`. */
  const records = (definition: LoopDefinitionInput) => definition.edges as [Edge, Edge, Edge, Edge];
  /** `edge` as stored on `port` of its Decision, everything else (ends, id, route) the same. */
  const on = (edge: Edge, port: string) => ({ ...edge, from: { ...edge.from, port } });
  const pickConnections = (index: number) =>
    rowConnections(store().definition!, store().decisionRoutes, 'pick', index);

  it.each([
    ['the second row, into the first', 1, ['yes', 'yes', 'maybe'], ['yes', 'affirm', 'maybe'], 2],
    ['the first row, into the second', 0, ['no', 'no', 'maybe'], ['nope', 'no', 'maybe'], 1],
  ])(
    'renames only its own record when %s’s ID collides and is typed on',
    (_, row, collided, renamed, own) => {
      const definition = bothRouted();
      store().load('L1', definition);
      store().updateNode('pick', { config: routes(...collided) }, typing(`routes.${row}.id`));
      // Two rows read the same ID: nothing moves, and the row still names its own record.
      untouched(definition);
      expect(pickConnections(row)).toEqual([definition.edges[own]]);
      expect(pickConnections(1 - row)).toEqual([definition.edges[3 - own]]);
      store().updateNode('pick', { config: routes(...renamed) }, typing(`routes.${row}.id`));
      const after = store().definition!;
      expect(edges()[own]).toEqual(on(definition.edges[own]!, renamed[row]!));
      untouched(definition, [own]);
      // The typing is one step: Undo and Redo give back each draft exactly.
      expect(store().past).toHaveLength(1);
      store().undo();
      expect(store().definition).toBe(definition);
      store().redo();
      expect(store().definition).toBe(after);
    },
  );

  it.each([
    ['the row typed to collide', 1, 2],
    ['the row it collides with', 0, 1],
  ])(
    'removes only %s’s own record, as its review lists, while two IDs collide',
    (_, index, own) => {
      const definition = bothRouted();
      store().load('L1', definition);
      store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing('routes.1.id'));
      const collided = store().definition!;
      expect(pickConnections(index)).toEqual([definition.edges[own]]);
      pause();
      store().updateNode('pick', { config: routes('yes', 'maybe') }, removal(index));
      const after = store().definition!;
      // The record the review listed goes; the remaining row's ID is unique again, so its own record
      // follows it to `yes` (where it already is when the first row stays).
      const [start, yes, no, maybe] = records(definition);
      expect(after.edges).toEqual(own === 2 ? [start, yes, maybe] : [start, on(no, 'yes'), maybe]);
      untouched(definition, own === 2 ? [2] : [1, 2]);
      expect(validateDraft(after).issues.map((issue) => issue.code)).not.toContain(
        'DUPLICATE_EDGE_ID',
      );
      store().undo();
      expect(store().definition).toBe(collided);
      store().undo();
      expect(store().definition).toBe(definition);
      store().redo();
      store().redo();
      expect(store().definition).toBe(after);
    },
  );

  it('swaps two rows’ IDs through the collision, each record following its own row', () => {
    const definition = bothRouted();
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('no', 'no', 'maybe') }, typing('routes.0.id'));
    untouched(definition);
    pause();
    store().updateNode('pick', { config: routes('no', 'yes', 'maybe') }, typing('routes.1.id'));
    const [start, yes, no, maybe] = records(definition);
    expect(edges()).toEqual([start, on(yes, 'no'), on(no, 'yes'), maybe]);
    expect(pickConnections(0)).toEqual([edges()[1]]);
    expect(pickConnections(1)).toEqual([edges()[2]]);
    store().undo();
    store().undo();
    expect(store().definition).toBe(definition);
  });

  it('keeps following its record through a blank ID', () => {
    const definition = withinDecision();
    store().load('L1', definition);
    for (const id of ['', 'affirm'])
      store().updateNode('pick', { config: routes(id, 'no', 'maybe') }, typing('routes.0.id'));
    expect(edges()[1]).toEqual(on(definition.edges[1]!, 'affirm'));
    untouched(definition, [1]);
    expect(store().past).toHaveLength(1);
  });

  it('keeps the collision’s ownership in the device table, and names nothing rebuilt without it', () => {
    const definition = bothRouted();
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing('routes.1.id'));
    const collided = store().definition!;
    // As this device keeps it with its copy: the second row still on `no`, where its record is.
    const table = store().decisionRoutes;
    expect(table['pick']!.rows.map((row) => [row.id, row.edgeIds])).toEqual([
      ['yes', ['e1']],
      ['no', ['e1']],
      ['maybe', ['m1']],
    ]);
    store().load('L1', collided, { dirty: true, deviceSaved: true, decisionRoutes: table });
    expect(store().decisionRoutes).toEqual(table);
    store().updateNode('pick', { config: routes('yes', 'affirm', 'maybe') }, typing('routes.1.id'));
    expect(edges()[2]).toEqual(on(definition.edges[2]!, 'affirm'));
    untouched(definition, [2]);
    // The server copy alone cannot say which `e1` either row had: neither row names one, and the
    // rename or the removal of the second row moves and removes no record.
    store().load('L1', collided);
    expect(pickConnections(0)).toEqual([]);
    expect(pickConnections(1)).toEqual([]);
    store().updateNode('pick', { config: routes('yes', 'affirm', 'maybe') }, typing('routes.1.id'));
    untouched(definition);
    store().load('L1', collided);
    store().updateNode('pick', { config: routes('yes', 'maybe') }, removal(1));
    untouched(definition);
  });

  it('replaces section JSON during the collision by port, never touching the other record', () => {
    const definition = bothRouted();
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing('routes.1.id'));
    pause();
    store().updateNode('pick', { config: routes('yes', 'affirm', 'maybe') }, replacement);
    // JSON names routes by ID: `no` is no longer declared, so its record goes; `yes` keeps its own.
    expect(edges()).toEqual([definition.edges[0], definition.edges[1], definition.edges[3]]);
    untouched(definition, [2]);
  });

  it('renames and removes a unique-id row’s own connection through the collision as before', () => {
    const definition = bothRouted();
    definition.edges[2] = { ...definition.edges[2]!, id: 'e2' };
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing('routes.1.id'));
    store().updateNode('pick', { config: routes('yes', 'affirm', 'maybe') }, typing('routes.1.id'));
    expect(edges()[2]).toEqual(on(definition.edges[2], 'affirm'));
    untouched(definition, [2]);
    store().undo();
    store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing('routes.1.id'));
    expect(pickConnections(1)).toEqual([definition.edges[2]]);
    pause();
    store().updateNode('pick', { config: routes('yes', 'maybe') }, removal(1));
    expect(edges()).toEqual([definition.edges[0], definition.edges[1], definition.edges[3]]);
    untouched(definition, [2]);
  });
});

describe('a device copy whose route rows claim one record (#481)', () => {
  type Edge = LoopDefinitionInput['edges'][number];
  /**
   * The unsynced device copy an earlier editor (95c759b) left in IndexedDB, as captured in QA: the
   * second route was typed from `no` to `yes`, and its map recorded both rows on `yes` naming `e1`,
   * while the two `e1` records stayed on `yes` (to Done) and `no` (to Other), each with its own
   * manual route. The current format admits it on the device; the API refuses its route IDs. With
   * `second`, the second route's ID as another capture of the same draft had it.
   */
  function captured(second = 'yes'): {
    definition: LoopDefinitionInput;
    decisionRoutes: DecisionRoutes;
  } {
    const exit = {
      outcome: 'success' as const,
      returns: 'none' as const,
      destinations: [{ kind: 'caller' as const }],
    };
    return {
      definition: {
        schemaVersion: 4,
        name: 'Ownership shared rename-after-collision baseline',
        description: 'Independent transient route-identity ownership QA',
        settings: {
          workingDirectory: { kind: 'temp' },
          defaults: { byHarness: {} },
          maxNodeVisits: 10,
          runDeadlineSeconds: null,
          structuredTimeoutMs: null,
          subloopDepthLimit: 8,
        },
        variables: {},
        nodes: [
          {
            id: 'start',
            label: 'Start',
            ui: { x: 0, y: 100 },
            kind: 'trigger',
            config: { type: 'manual', exposeTo: ['ui', 'api', 'mcp'] },
          },
          {
            id: 'pick',
            label: 'Pick',
            ui: { x: 310, y: 100 },
            kind: 'decision',
            config: {
              kind: 'expression',
              jsonata: '"yes"',
              routes: [
                { id: 'yes', label: 'Yes' },
                { id: second, label: 'No' },
                { id: 'maybe', label: 'Maybe' },
              ],
            },
          },
          { id: 'done', label: 'Done', ui: { x: 810, y: 0 }, kind: 'exit', config: exit },
          { id: 'other', label: 'Other', ui: { x: 810, y: 360 }, kind: 'exit', config: exit },
        ],
        edges: [
          {
            id: 's1',
            from: { node: 'start', port: 'out' },
            to: { node: 'pick', port: 'in' },
            ui: { route: [220] },
          },
          {
            id: 'e1',
            from: { node: 'pick', port: 'yes' },
            to: { node: 'done', port: 'in' },
            ui: { route: [500, 200, 650] },
          },
          {
            id: 'e1',
            from: { node: 'pick', port: 'no' },
            to: { node: 'other', port: 'in' },
            ui: { route: [670] },
          },
          {
            id: 'm1',
            from: { node: 'pick', port: 'maybe' },
            to: { node: 'done', port: 'in' },
            ui: { route: [550, 440, 700] },
          },
        ],
      },
      decisionRoutes: {
        pick: {
          nextKey: 3,
          rows: [
            { key: 0, edgeIds: ['e1'], id: 'yes' },
            { key: 1, edgeIds: ['e1'], id: 'yes' },
            { key: 2, edgeIds: ['m1'], id: 'maybe' },
          ],
        },
      },
    };
  }
  /** As the editor restores an unsynced device copy (`useLoadEditor`), with or without its map. */
  function restore(copy: ReturnType<typeof captured>, withMap = true) {
    store().load('L1', copy.definition, {
      dirty: true,
      deviceSaved: true,
      ...(withMap ? { decisionRoutes: copy.decisionRoutes } : {}),
    });
  }
  const pickRoutes = (...ids: string[]) => ({
    kind: 'expression' as const,
    jsonata: '"yes"',
    routes: ids.map((id, index) => ({ id, label: ['Yes', 'No', 'Maybe'][index]! })),
  });
  const rows = () => store().decisionRoutes['pick']!.rows.map((row) => [row.id, row.edgeIds]);
  const listed = (index: number) =>
    rowConnections(store().definition!, store().decisionRoutes, 'pick', index);
  /** The fixture's records in stored order: `s1`, `e1` to Done, `e1` to Other, `m1`. */
  const records = (definition: LoopDefinitionInput) => definition.edges as [Edge, Edge, Edge, Edge];
  const on = (edge: Edge, port: string) => ({ ...edge, from: { ...edge.from, port } });

  it('restores both rows’ claims as naming no owner, exactly as a load without the map', () => {
    const copy = captured();
    restore(copy);
    expect(store().definition).toBe(copy.definition);
    expect(rows()).toEqual([
      ['yes', []],
      ['yes', []],
      ['maybe', ['m1']],
    ]);
    expect(listed(0)).toEqual([]);
    expect(listed(1)).toEqual([]);
    const restored = store().decisionRoutes;
    restore(captured(), false);
    expect(store().decisionRoutes).toEqual(restored);
  });

  it.each([
    ['the second row', 1, ['yes', 'affirm', 'maybe']],
    ['the first row', 0, ['yes2', 'yes', 'maybe']],
  ])('renaming %s moves neither record, and Undo and Redo are exact', (_, row, ids) => {
    const copy = captured();
    restore(copy);
    const loaded = store().decisionRoutes;
    store().updateNode('pick', { config: pickRoutes(...ids) }, typing(`routes.${row}.id`));
    const after = store().definition!;
    expect(after.edges).toEqual(copy.definition.edges);
    untouched(copy.definition);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().definition).toBe(copy.definition);
    expect(store().decisionRoutes).toBe(loaded);
    store().redo();
    expect(store().definition).toBe(after);
  });

  it.each([
    ['the second row', 1],
    ['the first row', 0],
  ])('removing %s lists no connection and removes none', (_, row) => {
    const copy = captured();
    restore(copy);
    expect(listed(row)).toEqual([]);
    store().updateNode('pick', { config: pickRoutes('yes', 'maybe') }, removal(row));
    const after = store().definition!;
    expect(after.edges).toEqual(copy.definition.edges);
    untouched(copy.definition);
    store().undo();
    expect(store().definition).toBe(copy.definition);
    store().redo();
    expect(store().definition).toBe(after);
  });

  it('lets the author repair it: retyped to the port its record is on, the row owns and removes only that record', () => {
    const copy = captured();
    restore(copy);
    const [start, done, other, maybe] = records(copy.definition);
    // Typed a key at a time: at `n` the first row is the one `yes` route and takes up its record;
    // at `no` the second takes up the other `e1`, alone on its port.
    for (const id of ['n', 'no'])
      store().updateNode('pick', { config: pickRoutes('yes', id, 'maybe') }, typing('routes.1.id'));
    untouched(copy.definition);
    expect(listed(0)).toEqual([done]);
    expect(listed(1)).toEqual([other]);
    pause();
    store().updateNode('pick', { config: pickRoutes('yes', 'maybe') }, removal(1));
    expect(edges()).toEqual([start, done, maybe]);
    untouched(copy.definition, [2]);
    expect(validateDraft(store().definition!).issues.map((issue) => issue.code)).not.toContain(
      'DUPLICATE_EDGE_ID',
    );
    store().undo();
    store().undo();
    expect(store().definition).toBe(copy.definition);
  });

  it('keeps no refused claim to act on later: after reload, and after a blank ID', () => {
    const copy = captured();
    const [, done] = records(copy.definition);
    // The refused rename, then the device copy as the mirror keeps it, reloaded.
    restore(copy);
    store().updateNode(
      'pick',
      { config: pickRoutes('yes', 'affirm', 'maybe') },
      typing('routes.1.id'),
    );
    expect(rows()).toEqual([
      ['yes', ['e1']],
      ['affirm', []],
      ['maybe', ['m1']],
    ]);
    store().load('L1', store().definition!, {
      dirty: true,
      deviceSaved: true,
      decisionRoutes: store().decisionRoutes,
    });
    // The first row is now the one `yes` route: its record follows it, the other stays.
    store().updateNode(
      'pick',
      { config: pickRoutes('yes2', 'affirm', 'maybe') },
      typing('routes.0.id'),
    );
    expect(edges()[1]).toEqual(on(done, 'yes2'));
    untouched(copy.definition, [1]);
    // Blank, then named: the second row never takes the first row's record.
    restore(captured());
    for (const [row, ids] of [
      [1, ['yes', '', 'maybe']],
      [0, ['yes2', '', 'maybe']],
      [1, ['yes2', 'affirm', 'maybe']],
    ] as const) {
      store().updateNode('pick', { config: pickRoutes(...ids) }, typing(`routes.${row}.id`));
      pause();
    }
    expect(edges()[1]).toEqual(on(done, 'yes2'));
    expect(edges()[2]).toEqual(copy.definition.edges[2]);
    expect(listed(1)).toEqual([]);
  });

  it('takes up a record through a row’s ID without moving another record of that id', () => {
    // The captured draft loaded without its map (as from the server), the second row retyped to
    // `no`: read on its old port `yes`, `e1` would name the Done record, which must stay.
    const copy = captured();
    restore(copy, false);
    store().updateNode('pick', { config: pickRoutes('yes', 'no', 'maybe') }, typing('routes.1.id'));
    untouched(copy.definition);
    const [, done, other] = records(copy.definition);
    expect(listed(0)).toEqual([done]);
    expect(listed(1)).toEqual([other]);
  });

  it('keeps every record through unrelated edits', () => {
    const copy = captured();
    restore(copy);
    store().updateMeta({ name: 'Renamed' });
    store().moveNode('done', { x: 999, y: 9 });
    store().updateNode(
      'pick',
      {
        config: {
          ...pickRoutes('yes', 'yes', 'maybe'),
          routes: [
            { id: 'yes', label: 'Yes please' },
            { id: 'yes', label: 'No' },
            { id: 'maybe', label: 'Maybe' },
          ],
        },
      },
      typing('routes.0.label'),
    );
    untouched(copy.definition);
  });

  it('still trusts each row’s claim a readable device map names on its own port', () => {
    // As the same QA captured the device copy after Undo: the second route back on `no`.
    const readable = captured('no');
    readable.decisionRoutes = {
      pick: {
        nextKey: 3,
        rows: [
          { key: 0, edgeIds: ['e1'], id: 'yes' },
          { key: 1, edgeIds: ['e1'], id: 'no' },
          { key: 2, edgeIds: ['m1'], id: 'maybe' },
        ],
      },
    };
    const [start, done, other, maybe] = records(readable.definition);
    restore(readable);
    expect(listed(1)).toEqual([other]);
    store().updateNode(
      'pick',
      { config: pickRoutes('yes', 'yes', 'maybe') },
      typing('routes.1.id'),
    );
    store().updateNode(
      'pick',
      { config: pickRoutes('yes', 'affirm', 'maybe') },
      typing('routes.1.id'),
    );
    expect(edges()).toEqual([start, done, on(other, 'affirm'), maybe]);
    restore(readable);
    store().updateNode('pick', { config: pickRoutes('yes', 'maybe') }, removal(1));
    expect(edges()).toEqual([start, done, maybe]);
  });

  it('still trusts unique ids in a device map whose rows read one ID', () => {
    // As the same QA captured it with the `no → Other` record called `e2`.
    const unique = captured();
    unique.definition.edges[2] = { ...unique.definition.edges[2]!, id: 'e2' };
    unique.decisionRoutes = {
      pick: {
        nextKey: 3,
        rows: [
          { key: 0, edgeIds: ['e1'], id: 'yes' },
          { key: 1, edgeIds: ['e2'], id: 'yes' },
          { key: 2, edgeIds: ['m1'], id: 'maybe' },
        ],
      },
    };
    const [start, done, other, maybe] = records(unique.definition);
    restore(unique);
    expect(listed(1)).toEqual([other]);
    store().updateNode(
      'pick',
      { config: pickRoutes('yes', 'affirm', 'maybe') },
      typing('routes.1.id'),
    );
    expect(edges()).toEqual([start, done, on(other, 'affirm'), maybe]);
    restore(unique);
    store().updateNode('pick', { config: pickRoutes('yes', 'maybe') }, removal(1));
    expect(edges()).toEqual([start, done, maybe]);
  });
});

describe('a record two rows came to claim while editing (#481)', () => {
  it.each([
    ['the second row', 1, ['yes', 'affirm', 'maybe']],
    ['the first row', 0, ['affirm', 'yes', 'maybe']],
  ])('renaming %s after section JSON gave both one ID moves no record', (_, row, ids) => {
    const definition = withinDecision();
    definition.edges[2] = { ...definition.edges[2]!, id: 'e2' };
    store().load('L1', definition);
    // JSON names routes by ID: `no` is gone with its record, and both rows read `yes`.
    store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, replacement);
    pause();
    store().updateNode('pick', { config: routes(...ids) }, typing(`routes.${row}.id`));
    expect(edges()).toEqual([definition.edges[0], definition.edges[1], definition.edges[3]]);
    untouched(definition, [2]);
  });
});

describe('repairing a shared id in the editor (#481)', () => {
  it('removes the Decision route, adds it back and draws it again, then edits by id as usual', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    store().updateNode('via', { config: routes('no') }, removal(0));
    pause();
    store().updateNode(
      'via',
      { config: routes('no', 'yes') },
      {
        path: 'routes',
        kind: 'commit',
        id: 484,
      },
    );
    pause();
    expect(store().connect({ source: 'via', sourceHandle: 'yes', target: 'done' })).toBeNull();
    const drawn = edges().at(-1)!;
    expect(drawn).toMatchObject({ from: { node: 'via', port: 'yes' }, to: { node: 'done' } });
    expect(drawn.id).not.toBe('e1');
    // Repaired: only the fixture's never-connected `no` route is left to report.
    expect(validateDraft(store().definition!).issues.map((issue) => issue.code)).toEqual([
      'PORT_UNCONNECTED',
    ]);
    // `start → via` is the one `e1` now: its route and its removal act on it alone.
    pause();
    store().setEdgeRoute('e1', [140]);
    expect(edges()[0]).toEqual({ ...definition.edges[0], ui: { route: [140] } });
    pause();
    store().removeEdge('e1');
    expect(edges().some((edge) => edge.id === 'e1')).toBe(false);
    expect(store().connectionError).toBeUndefined();
  });

  it('renames the Decision card: ends follow the card, ports and routes stay', () => {
    const definition = acrossSources();
    store().load('L1', definition);
    expect(store().renameNode('via', 'gate')).toBeUndefined();
    expect(edges()[0]).toEqual({ ...definition.edges[0], to: { node: 'gate' } });
    expect(edges()[1]).toEqual({ ...definition.edges[1], from: { node: 'gate', port: 'yes' } });
    expect(store().decisionRoutes['gate']!.rows[0]).toMatchObject({ id: 'yes', edgeIds: ['e1'] });
    store().updateMeta({ name: 'After the rename' });
    expect(edges()[0]!.from.port).toBe('out');
  });
});

describe('unique-id controls (#481)', () => {
  /** The within-Decision draft with its `no` connection given its own id. */
  function unique(): LoopDefinitionInput {
    const definition = withinDecision();
    definition.edges[2] = { ...definition.edges[2]!, id: 'e2' };
    return definition;
  }

  it('renames, removes and replaces route rows with their connections as before', () => {
    const definition = unique();
    expect(validateDraft(definition).issues).toEqual([]);
    store().load('L1', definition);
    store().updateNode('pick', { config: routes('affirm', 'no', 'maybe') }, typing('routes.0.id'));
    expect(edges()[1]).toEqual({ ...definition.edges[1], from: { node: 'pick', port: 'affirm' } });
    pause();
    store().updateNode('pick', { config: routes('affirm', 'maybe') }, removal(1));
    expect(edges().map((edge) => edge.id)).toEqual(['s1', 'e1', 'm1']);
    pause();
    store().updateNode('pick', { config: routes('affirm') }, replacement);
    expect(edges().map((edge) => edge.id)).toEqual(['s1', 'e1']);
    store().undo();
    store().undo();
    store().undo();
    expect(store().definition).toBe(definition);
  });

  it('keeps unrelated records exactly and reroutes by id', () => {
    const definition = unique();
    store().load('L1', definition);
    store().removeEdge('m1');
    untouched(definition, [3]);
    store().setEdgeRoute('e2', [10]);
    expect(edges()[2]!.ui).toEqual({ route: [10] });
    expect(store().connectionError).toBeUndefined();
  });

  it('edits normally once the shared id is repaired outside the editor and loaded', () => {
    // The same ownership table the device kept, with the API-repaired draft: `start → via` now
    // has its own id.
    const repaired = acrossSources();
    repaired.edges[0] = { ...repaired.edges[0]!, id: 'e9' };
    expect(validateDraft(repaired).issues.map((issue) => issue.code)).not.toContain(
      'DUPLICATE_EDGE_ID',
    );
    store().load('L1', repaired, {
      decisionRoutes: {
        via: {
          nextKey: 2,
          rows: [
            { key: 0, id: 'yes', edgeIds: ['e1'] },
            { key: 1, id: 'no', edgeIds: [] },
          ],
        },
      },
    });
    store().updateNode('via', { config: routes('affirm', 'no') }, typing('routes.0.id'));
    expect(edges()[1]!.from.port).toBe('affirm');
    untouched(repaired, [1]);
    store().setEdgeRoute('e1', [700]);
    expect(edges()[1]!.ui).toEqual({ route: [700] });
  });
});
