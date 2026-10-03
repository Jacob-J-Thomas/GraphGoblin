import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import * as drafts from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

/** Holds the IndexedDB write of the restored copy until released. */
const gate = vi.hoisted(() => ({ hold: false, release: (): void => undefined }));

vi.mock('../drafts/local-drafts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof drafts>();
  return {
    ...actual,
    saveLocalDraft: async (draft: Parameters<typeof actual.saveLocalDraft>[0]) => {
      if (gate.hold && draft.definition.name === 'older local copy') {
        await new Promise<void>((resolve) => (gate.release = resolve));
      }
      return actual.saveLocalDraft(draft);
    },
  };
});

describe('restoring a set-aside copy', () => {
  it('does not load into another loop opened while the restore was being persisted', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const a = api.addLoop(newLoopDefinition('server copy'));
    const b = api.addLoop(newLoopDefinition('loop b'));
    await drafts.saveLocalDraft({
      loopId: a.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    renderApp(`/loops/${a.id}/edit`, api);
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();

    gate.hold = true;
    await user.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    // Navigate to loop B and edit it while A's restore is still being written.
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Loops' }),
    );
    await user.click(await screen.findByRole('link', { name: 'loop b' }));
    expect(await screen.findByRole('heading', { name: 'loop b' })).toBeInTheDocument();
    act(() => useEditorStore.getState().updateMeta({ description: 'work on b' }));

    gate.hold = false;
    gate.release();
    await waitFor(async () => expect(await drafts.loadSetAsideDraft(a.id)).toBeUndefined());

    // B is untouched.
    const state = useEditorStore.getState();
    expect(state.loopId).toBe(b.id);
    expect(state.definition).toMatchObject({ name: 'loop b', description: 'work on b' });
    expect(screen.getByRole('heading', { name: 'loop b' })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.callsTo('PUT', `/loops/${b.id}/draft`).length).toBeGreaterThan(0),
    );
    expect(api.callsTo('PUT', `/loops/${a.id}/draft`)).toHaveLength(0);

    // A's restored copy is durable and comes back on the next visit.
    expect(await drafts.loadLocalDraft(a.id)).toMatchObject({
      synced: false,
      definition: { name: 'older local copy' },
    });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Loops' }),
    );
    await user.click(await screen.findByRole('link', { name: 'server copy' }));
    expect(await screen.findByRole('heading', { name: 'older local copy' })).toBeInTheDocument();
  });
});
