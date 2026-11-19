import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
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

async function open(definition: LoopDefinitionInput) {
  const api = new FakeApi();
  const loop = api.addLoop(definition);
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'Shared edge id' });
  const saves = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
  const sent = (index: number) =>
    (saves()[index]!.body as { definition: LoopDefinitionInput }).definition;
  return { api, loop, saves, sent };
}

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
