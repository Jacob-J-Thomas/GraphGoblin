import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { sameValue } from './history.js';
import { useEditorStore } from './store.js';
import { AUTOSAVE_DELAY_MS } from './useAutosave.js';

const SAVE_WAIT = { timeout: 4000 };
const withoutUi = (definition: LoopDefinitionInput) => ({
  ...definition,
  nodes: definition.nodes.map(({ ui: _ui, ...node }) => node),
});

describe('Space cards in the editor (#208)', () => {
  it('opens a pile without writing, saves Space cards as one ordinary edit, and saves its Undo as the original', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(kitchenSinkLoop());
    const loaded = api.draftToken(loop.id);
    const saves = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'kitchen-sink' });
    const original = useEditorStore.getState().definition!;
    // Opening writes nothing, also once autosave's delay has passed.
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS + 200));
    expect(saves()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Space cards' }));
    // Focus stays on the canvas, not on the Undo that now names the step.
    expect(screen.getByTestId('canvas')).toHaveFocus();
    const undo = screen.getByRole('button', { name: 'Undo space cards' });
    expect(undo).not.toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Space cards' })).toBeNull();

    // One ordinary save of the loaded draft, differing from it only in the cards' ui.
    await waitFor(() => expect(saves()).toHaveLength(1), SAVE_WAIT);
    const [save] = saves();
    expect(save!.headers.get('if-match')).toBe(`"${loaded}"`);
    const sent = (save!.body as { definition: LoopDefinitionInput }).definition;
    expect(sameValue(withoutUi(sent), withoutUi(original))).toBe(true);
    // The first card stays as loaded (the stored format's explicit origin); the others moved.
    expect(sent.nodes[0]).toEqual(original.nodes[0]);
    expect(sent.nodes.slice(1).every((node) => node.ui && (node.ui.x || node.ui.y))).toBe(true);
    await waitFor(async () => {
      const copy = await loadLocalDraft(loop.id);
      expect(copy?.synced).toBe(true);
      expect(sameValue(copy?.definition, sent)).toBe(true);
    }, SAVE_WAIT);

    // Undo is an ordinary edit too: it saves the original draft, and the offer is back.
    await user.click(undo);
    await waitFor(() => expect(saves()).toHaveLength(2), SAVE_WAIT);
    const restored = (saves()[1]!.body as { definition: LoopDefinitionInput }).definition;
    expect(sameValue(restored, original)).toBe(true);
    expect(screen.getByRole('button', { name: 'Space cards' })).toBeInTheDocument();
  });
});
