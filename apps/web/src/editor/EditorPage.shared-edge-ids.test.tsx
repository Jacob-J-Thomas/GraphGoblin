import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { deviceKeys, storeRawDeviceRecord } from '../__fixtures__/device-drafts.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { pasteInto } from '../__fixtures__/user.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition, validateDraft } from './model.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();
const SAVE_WAIT = { timeout: 4000 };
const codes = (definition: LoopDefinitionInput) =>
  validateDraft(definition).issues.map((issue) => issue.code);

/**
 * #481 through the editor page: `start → pick` and the connection of `pick`'s `ship` route both
 * use `e1`, as an imported or API-written draft can. Every route is connected with a manual route.
 */
function sharedAcrossSources(): LoopDefinitionInput {
  const definition = newLoopDefinition('Shared edge id');
  definition.nodes.push({
    id: 'pick',
    kind: 'decision',
    label: 'Pick',
    config: {
      kind: 'expression',
      jsonata: '"ship"',
      // Three routes, so the draft stays schema-valid (two at least) once one is removed.
      routes: [
        { id: 'ship', label: 'Ship' },
        { id: 'review', label: 'Review' },
        { id: 'stop', label: 'Stop' },
      ],
    },
  });
  definition.edges = [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' }, ui: { route: [120] } },
    {
      id: 'e1',
      from: { node: 'pick', port: 'ship' },
      to: { node: 'done' },
      ui: { route: [200, 300, 400] },
    },
    { id: 'review-edge', from: { node: 'pick', port: 'review' }, to: { node: 'done' } },
    { id: 'stop-edge', from: { node: 'pick', port: 'stop' }, to: { node: 'done' } },
  ];
  return definition;
}

/**
 * Within one Decision: `pick`'s `yes` and `no` routes each own a connection called `e1`, to
 * different cards with different manual routes; `stop` owns its own. With `second`, the second
 * route's ID reads that instead of `no` (its connection stays on `no`).
 */
function sharedWithinDecision(second = 'no'): LoopDefinitionInput {
  const definition = newLoopDefinition('Shared edge id');
  definition.nodes.push(
    {
      id: 'pick',
      kind: 'decision',
      label: 'Pick',
      config: {
        kind: 'expression',
        jsonata: '"yes"',
        routes: [
          { id: 'yes', label: 'Yes' },
          { id: second, label: 'No' },
          { id: 'stop', label: 'Stop' },
        ],
      },
    },
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
    { id: 'e1', from: { node: 'pick', port: 'no' }, to: { node: 'other' }, ui: { route: [650] } },
    { id: 'stop-edge', from: { node: 'pick', port: 'stop' }, to: { node: 'done' } },
  ];
  return definition;
}

async function open(definition: LoopDefinitionInput) {
  const api = new FakeApi();
  const loop = api.addLoop(definition);
  const rendered = renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'Shared edge id' });
  const saves = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
  const sent = (index: number) =>
    (saves()[index]!.body as { definition: LoopDefinitionInput }).definition;
  return { api, loop, rendered, saves, sent };
}

/** The second route's ID field in `pick`'s editor, opening it first. */
async function secondRouteId() {
  act(() => store().openNode('pick'));
  const dialog = await screen.findByRole('dialog', { name: 'Edit decision pick' });
  return {
    dialog,
    id: dialog.querySelector<HTMLInputElement>('[data-field="routes.1.id"] input')!,
  };
}

/** Select the whole field and type `text` over it, one keystroke at a time. */
const typeOver = (
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLInputElement,
  text: string,
) => user.type(field, text, { initialSelectionStart: 0, initialSelectionEnd: field.value.length });

describe('a draft whose edges share an id, in the editor (#481)', () => {
  it('saves an unrelated edit with the other records exact, and keeps reporting the shared id', async () => {
    const definition = sharedAcrossSources();
    expect(codes(definition)).toContain('DUPLICATE_EDGE_ID');
    const { loop, saves, sent } = await open(definition);
    const loaded = store().definition!;
    act(() => store().updateMeta({ description: 'An unrelated edit' }));
    await waitFor(() => expect(saves()).toHaveLength(1), SAVE_WAIT);
    // The draft saves although validation reports the shared id: saving is not publishing.
    expect(sent(0).description).toBe('An unrelated edit');
    expect(sent(0).edges).toEqual(loaded.edges);
    expect(codes(sent(0))).toContain('DUPLICATE_EDGE_ID');
    await waitFor(async () => {
      const copy = await loadLocalDraft(loop.id);
      expect(copy?.synced).toBe(true);
      expect(copy?.definition.edges).toEqual(loaded.edges);
    }, SAVE_WAIT);
  });

  it('lists and removes only the Decision’s own connection when its route is removed', async () => {
    const user = userEvent.setup();
    const definition = sharedAcrossSources();
    const { saves, sent } = await open(definition);
    const loaded = store().definition!;
    act(() => store().openNode('pick'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit decision pick' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove routes 1' }));
    const review = within(dialog).getByRole('region', { name: 'Remove connected route?' });
    expect(review).toHaveTextContent('Connection ship → done (e1)');
    expect(review).not.toHaveTextContent('Connection out → pick (e1)');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    // `start → pick` keeps its record: ends, port and manual route.
    const kept = [loaded.edges[0], loaded.edges[2], loaded.edges[3]];
    expect(store().definition!.edges).toEqual(kept);
    expect(store().definition!.edges[0]).toBe(loaded.edges[0]);
    expect(codes(store().definition!)).not.toContain('DUPLICATE_EDGE_ID');
    await waitFor(() => expect(saves()).toHaveLength(1), SAVE_WAIT);
    expect(sent(0).edges).toEqual(kept);
    // One Undo brings the route and its connection back, with the other record as it was.
    act(() => store().undo());
    expect(store().definition!.edges).toEqual(loaded.edges);
  });
});

describe('a route ID typed to collide with another route’s, in the editor (#481)', () => {
  it('renames only the typed route’s own connection, and saves it', async () => {
    const user = userEvent.setup();
    const { saves, sent } = await open(sharedWithinDecision());
    const loaded = store().definition!;
    const [start, yes, no, stop] = loaded.edges;
    const { id } = await secondRouteId();
    // `no` becomes `yes` for a moment: two routes read `yes`, so no connection moves.
    await user.clear(id);
    await pasteInto(user, id, 'yes');
    expect(store().definition!.edges).toEqual(loaded.edges);
    await typeOver(user, id, 'affirm');
    expect(store().definition!.edges).toEqual([
      start,
      yes,
      { ...no, from: { node: 'pick', port: 'affirm' } },
      stop,
    ]);
    expect(store().definition!.edges[1]).toBe(yes);
    const renamed = store().definition!.edges;
    await waitFor(() => {
      expect(saves().length).toBeGreaterThan(0);
      expect(sent(saves().length - 1).edges).toEqual(renamed);
    }, SAVE_WAIT);
    // The typing is one step: one Undo restores every record.
    act(() => store().undo());
    expect(store().definition!.edges).toEqual(loaded.edges);
  });

  it('lists and removes only the typed route’s own connection', async () => {
    const user = userEvent.setup();
    const { saves, sent } = await open(sharedWithinDecision());
    const loaded = store().definition!;
    const [start, yes, , stop] = loaded.edges;
    const { dialog, id } = await secondRouteId();
    await user.clear(id);
    await pasteInto(user, id, 'yes');
    await user.click(within(dialog).getByRole('button', { name: 'Remove routes 2' }));
    const review = within(dialog).getByRole('region', { name: 'Remove connected route?' });
    expect(review).toHaveTextContent('Connection no → other (e1)');
    expect(review).not.toHaveTextContent('Connection yes → done (e1)');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(store().definition!.edges).toEqual([start, yes, stop]);
    expect(store().definition!.edges[1]).toBe(yes);
    expect(codes(store().definition!)).not.toContain('DUPLICATE_EDGE_ID');
    await waitFor(() => expect(saves()).toHaveLength(1), SAVE_WAIT);
    expect(sent(0).edges).toEqual([start, yes, stop]);
    act(() => store().undo());
    expect(store().definition!.edges).toEqual(loaded.edges);
  });

  it('keeps which connection the route owns through a reload of the device copy', async () => {
    const user = userEvent.setup();
    const { api, loop, rendered, saves } = await open(sharedWithinDecision());
    const loaded = store().definition!;
    const [start, yes, no, stop] = loaded.edges;
    const { id } = await secondRouteId();
    await user.clear(id);
    await pasteInto(user, id, 'yes');
    // Two routes read `yes`, so the draft stays on this device, with the row still on `no`.
    const copy = await waitFor(async () => {
      const local = await loadLocalDraft(loop.id);
      expect(local?.definition.nodes.find((node) => node.id === 'pick')).toHaveProperty(
        'config.routes.1.id',
        'yes',
      );
      return local!;
    });
    expect(copy.synced).toBe(false);
    expect(copy.definition.edges).toEqual(loaded.edges);
    expect(copy.decisionRoutes?.['pick']?.rows.map((row) => [row.id, row.edgeIds])).toEqual([
      ['yes', ['e1']],
      ['no', ['e1']],
      ['stop', ['stop-edge']],
    ]);
    expect(saves()).toEqual([]);
    rendered.unmount();
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Shared edge id' });
    await waitFor(() =>
      expect(store().definition!.nodes.find((node) => node.id === 'pick')).toHaveProperty(
        'config.routes.1.id',
        'yes',
      ),
    );
    const reopened = await secondRouteId();
    await typeOver(user, reopened.id, 'affirm');
    expect(store().definition!.edges).toEqual([
      start,
      yes,
      { ...no, from: { node: 'pick', port: 'affirm' } },
      stop,
    ]);
    const renamed = store().definition!.edges;
    await waitFor(
      () => expect(api.loops.get(loop.id)!.draft!.definition.edges).toEqual(renamed),
      SAVE_WAIT,
    );
  });
});

describe('a device copy whose route rows claim one record, restored in the editor (#481)', () => {
  /**
   * The server draft, and the unsynced copy an earlier editor (95c759b) left of it in this browser,
   * in the shape QA captured from IndexedDB: the second route typed from `no` to `yes`, and both
   * rows of its map on `yes` naming `e1`, while the two `e1` records stay on `yes` and `no`.
   */
  async function restoreCaptured() {
    const api = new FakeApi();
    const loop = api.addLoop(sharedWithinDecision());
    const copy = sharedWithinDecision('yes');
    await storeRawDeviceRecord(deviceKeys(loop.id).active, {
      loopId: loop.id,
      definition: copy,
      decisionRoutes: {
        pick: {
          nextKey: 3,
          rows: [
            { key: 0, edgeIds: ['e1'], id: 'yes' },
            { key: 1, edgeIds: ['e1'], id: 'yes' },
            { key: 2, edgeIds: ['stop-edge'], id: 'stop' },
          ],
        },
      },
      savedAt: '2026-11-19T05:50:00.000Z',
      synced: false,
      baseToken: api.draftToken(loop.id),
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Shared edge id' });
    await waitFor(() => expect(routeIds()).toEqual(['yes', 'yes', 'stop']));
    // What the editor sent in its latest draft save (the server adds parsed defaults to its copy).
    const saved = () => {
      const saves = api.callsTo('PUT', `/loops/${loop.id}/draft`);
      expect(saves.length).toBeGreaterThan(0);
      return (saves.at(-1)!.body as { definition: LoopDefinitionInput }).definition;
    };
    return { copy, saved };
  }
  const routeIds = () =>
    (
      store().definition!.nodes.find((node) => node.id === 'pick')!.config as {
        routes: { id: string }[];
      }
    ).routes.map((route) => route.id);

  it('renames the restored second route without moving either connection, and saves them exact', async () => {
    const user = userEvent.setup();
    const { copy, saved } = await restoreCaptured();
    const { id } = await secondRouteId();
    await typeOver(user, id, 'affirm');
    expect(routeIds()).toEqual(['yes', 'affirm', 'stop']);
    expect(store().definition!.edges).toEqual(copy.edges);
    await waitFor(() => expect(saved().edges).toEqual(copy.edges), SAVE_WAIT);
    act(() => store().undo());
    expect(routeIds()).toEqual(['yes', 'yes', 'stop']);
    expect(store().definition!.edges).toEqual(copy.edges);
  });

  it('removes the restored second route without listing or removing a connection', async () => {
    const user = userEvent.setup();
    const { copy, saved } = await restoreCaptured();
    const { dialog } = await secondRouteId();
    await user.click(within(dialog).getByRole('button', { name: 'Remove routes 2' }));
    expect(within(dialog).queryByRole('region', { name: 'Remove connected route?' })).toBeNull();
    expect(routeIds()).toEqual(['yes', 'stop']);
    expect(store().definition!.edges).toEqual(copy.edges);
    await waitFor(() => expect(saved().edges).toEqual(copy.edges), SAVE_WAIT);
  });

  it('repairs it: retyped to `no`, the route lists and removes only its own connection', async () => {
    const user = userEvent.setup();
    const { copy, saved } = await restoreCaptured();
    const [start, yes, no, stop] = copy.edges;
    const { dialog, id } = await secondRouteId();
    await typeOver(user, id, 'no');
    expect(store().definition!.edges).toEqual(copy.edges);
    await user.click(within(dialog).getByRole('button', { name: 'Remove routes 2' }));
    const review = within(dialog).getByRole('region', { name: 'Remove connected route?' });
    expect(review).toHaveTextContent('Connection no → other (e1)');
    expect(review).not.toHaveTextContent('Connection yes → done (e1)');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(store().definition!.edges).toEqual([start, yes, stop]);
    expect(store().definition!.edges).not.toContainEqual(no);
    expect(codes(store().definition!)).not.toContain('DUPLICATE_EDGE_ID');
    await waitFor(() => expect(saved().edges).toEqual([start, yes, stop]), SAVE_WAIT);
  });
});
