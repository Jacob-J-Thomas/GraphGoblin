import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { loadLocalDraft, saveLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { draftConflict } from './useAutosave.js';

const SAVE_WAIT = { timeout: 4000 };
const TITLE = 'The draft changed on the server';

/** Open the editor, let another tab save, then edit here so the next save meets a 409. */
async function openConflict(api: FakeApi, loopId: string, elsewhere = 'saved elsewhere') {
  renderApp(`/loops/${loopId}/edit`, api);
  await screen.findByRole('heading', { name: 'mine' });
  api.saveDraftElsewhere(loopId, { ...newLoopDefinition(elsewhere), description: 'theirs' });
  act(() => useEditorStore.getState().updateMeta({ description: 'my edit' }));
  expect(await screen.findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
}

describe('draft conflicts (If-Match)', () => {
  it('sends the loaded token, and the token from each save after it', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    const loaded = api.draftToken(loop.id);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    act(() => useEditorStore.getState().updateMeta({ description: 'one' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    act(() => useEditorStore.getState().updateMeta({ description: 'two' }));
    await waitFor(
      () => expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(2),
      SAVE_WAIT,
    );
    const [first, second] = api.callsTo('PUT', `/loops/${loop.id}/draft`);
    expect(first!.headers.get('if-match')).toBe(`"${loaded}"`);
    expect(second!.headers.get('if-match')).not.toBe(`"${loaded}"`);
    await waitFor(async () =>
      expect((await loadLocalDraft(loop.id))?.baseToken).toBe(api.draftToken(loop.id)),
    );
  });

  it('stops saving on a conflict and reloads the server draft on request', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    await openConflict(api, loop.id);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Draft changed elsewhere');
    // Nothing was overwritten, and later edits wait for a choice instead of retrying.
    expect(api.draftToken(loop.id)).toBeDefined();
    const puts = api.callsTo('PUT', `/loops/${loop.id}/draft`).length;
    act(() => useEditorStore.getState().updateMeta({ description: 'still mine' }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(puts);
    expect((await loadLocalDraft(loop.id))?.synced).toBe(false);

    // Publishing explains the conflict instead of publishing either copy.
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/reload it or overwrite it first/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    expect(await screen.findByRole('heading', { name: 'saved elsewhere' })).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(useEditorStore.getState().definition?.description).toBe('theirs');
    expect(await loadLocalDraft(loop.id)).toMatchObject({
      synced: true,
      baseToken: api.draftToken(loop.id),
    });
  });

  it('overwrites the server draft with this copy on request', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    await openConflict(api, loop.id);
    const serverToken = api.draftToken(loop.id);
    await user.click(screen.getByRole('button', { name: 'Overwrite with this copy' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    expect(screen.queryByText(TITLE)).toBeNull();
    const last = api.callsTo('PUT', `/loops/${loop.id}/draft`).at(-1)!;
    expect(last.headers.get('if-match')).toBe(`"${serverToken}"`);
    expect(
      (await (await fetchLoop(api, loop.id)).json()) as { draft: { definition: unknown } },
    ).toMatchObject({ draft: { definition: { name: 'mine', description: 'my edit' } } });
  });

  it('asks the server for its token when the conflict did not carry one, and shows failures', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    api.override('PUT /loops/:id/draft', () => problem(409, 'DRAFT_CONFLICT', 'changed'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    act(() => useEditorStore.getState().updateMeta({ description: 'my edit' }));
    expect(await screen.findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(useEditorStore.getState().conflict).toEqual({ serverToken: undefined });

    await user.click(screen.getByRole('button', { name: 'Overwrite with this copy' }));
    await waitFor(() => expect(useEditorStore.getState().baseToken).toBe(api.draftToken(loop.id)));
    // The override still answers 409: the conflict comes back.
    expect(await screen.findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();

    api.override('GET /loops/:id', () => problem(500, 'INTERNAL_ERROR', 'down'));
    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    expect(await screen.findByText(/down/)).toBeInTheDocument();
  });

  it('does not save over the server draft when leaving in conflict', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    const view = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    api.saveDraftElsewhere(loop.id, newLoopDefinition('saved elsewhere'));
    act(() => useEditorStore.getState().updateMeta({ description: 'my edit' }));
    expect(await screen.findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
    const puts = api.callsTo('PUT', `/loops/${loop.id}/draft`).length;
    act(() => useEditorStore.getState().updateMeta({ description: 'typed then left' }));
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(puts);
  });

  it('sends the token a restored device copy was based on, so a newer server draft conflicts', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    await saveLocalDraft({
      loopId: loop.id,
      definition: { ...newLoopDefinition('mine'), description: 'offline edit' },
      // Newer than the server's updatedAt, so it is restored, but based on an older token.
      savedAt: '2030-01-01T00:00:00.000Z',
      synced: false,
      baseToken: 'stale-token',
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)[0]!.headers.get('if-match')).toBe(
      '"stale-token"',
    );
  });

  it('recognises only DRAFT_CONFLICT problems', () => {
    expect(draftConflict(new Error('x'))).toBe(false);
    expect(draftConflict(new GraphGoblinApiError({ status: 409, code: 'NO_DRAFT' }))).toBe(false);
    expect(
      draftConflict(
        new GraphGoblinApiError({ status: 409, code: 'DRAFT_CONFLICT', draftToken: 't' }),
      ),
    ).toEqual({ serverToken: 't' });
  });
});

function fetchLoop(api: FakeApi, loopId: string): Promise<Response> {
  return api.fetch(new Request(`http://localhost/loops/${loopId}`));
}
