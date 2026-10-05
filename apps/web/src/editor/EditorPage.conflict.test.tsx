import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { act, screen, waitFor, within } from '@testing-library/react';
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

  it('answers a conflict from inside an open node editor', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    act(() => useEditorStore.getState().openNode('start'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit trigger start' });
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'theirs' });
    await user.type(within(dialog).getByLabelText('Label'), ' here');
    expect(await within(dialog).findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('save-state')).toHaveTextContent('Draft changed elsewhere');

    // Overwrite from the dialog: saved, and the editor stays open on the node.
    await user.click(within(dialog).getByRole('button', { name: 'Overwrite with this copy' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    expect(within(dialog).queryByText(TITLE)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit trigger start' })).toBe(dialog);

    // Reload from the dialog: the server draft replaces this copy and the editor closes.
    api.saveDraftElsewhere(loop.id, newLoopDefinition('saved elsewhere'));
    await user.type(within(dialog).getByLabelText('Label'), '!');
    expect(await within(dialog).findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reload server draft' }));
    expect(await screen.findByRole('heading', { name: 'saved elsewhere' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
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
    const user = userEvent.setup();
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
    expect(
      await screen.findByText('Restored unsaved changes from this device.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(await screen.findByText(TITLE, undefined, SAVE_WAIT)).toBeInTheDocument();
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)[0]!.headers.get('if-match')).toBe(
      '"stale-token"',
    );

    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    expect(await screen.findByRole('heading', { name: 'mine' })).toBeInTheDocument();
    expect(screen.queryByText('Restored unsaved changes from this device.')).toBeNull();
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

describe('draft tokens across editors and saves', () => {
  it('does not load a delayed server draft for loop A into the editor of loop B', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const a = api.addLoop(newLoopDefinition('mine'));
    const b = api.addLoop(newLoopDefinition('loop b'));
    await openConflict(api, a.id);

    let release!: () => void;
    let holding = false;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.override('GET /loops/:id', async (call, [id]) => {
      if (holding && id === a.id) await gate;
      return api.builtIn(call);
    });
    holding = true;
    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Loops' }),
    );
    await user.click(await screen.findByRole('link', { name: 'loop b' }));
    expect(await screen.findByRole('heading', { name: 'loop b' })).toBeInTheDocument();
    act(() => useEditorStore.getState().updateMeta({ description: 'work on b' }));

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = useEditorStore.getState();
    expect(state.loopId).toBe(b.id);
    expect(state.definition).toMatchObject({ name: 'loop b', description: 'work on b' });
    expect(screen.getByRole('heading', { name: 'loop b' })).toBeInTheDocument();
    // A's unsynced device copy was not replaced either: the user never saw the reload land.
    expect(await loadLocalDraft(a.id)).toMatchObject({ synced: false });
  });

  it('bases the save sent on leaving on the save still in flight, so it does not conflict', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let puts = 0;
    api.override('PUT /loops/:id/draft', async (call) => {
      puts += 1;
      if (puts === 1) await gate;
      return api.builtIn(call);
    });
    const view = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    act(() => useEditorStore.getState().updateMeta({ description: 'first' }));
    await waitFor(() => expect(puts).toBe(1), SAVE_WAIT);
    act(() => useEditorStore.getState().updateMeta({ description: 'second' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.unmount();
    release();

    await waitFor(() => expect(puts).toBe(2), SAVE_WAIT);
    await waitFor(async () =>
      expect(await loadLocalDraft(loop.id)).toMatchObject({
        synced: true,
        definition: { description: 'second' },
        baseToken: api.draftToken(loop.id),
      }),
    );
    const detail = (await (
      await api.fetch(new Request(`http://localhost/loops/${loop.id}`))
    ).json()) as { draft: { definition: { description?: string } } };
    expect(detail.draft.definition.description).toBe('second');
  });

  it('moves a newer unsynced device copy onto the token of the save it follows', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let puts = 0;
    api.override('PUT /loops/:id/draft', async (call) => {
      puts += 1;
      if (puts === 1) await gate;
      return api.builtIn(call);
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    act(() => useEditorStore.getState().updateMeta({ description: 'first' }));
    await waitFor(() => expect(puts).toBe(1), SAVE_WAIT);
    act(() => useEditorStore.getState().updateMeta({ description: 'second' }));
    await waitFor(async () =>
      expect((await loadLocalDraft(loop.id))?.definition.description).toBe('second'),
    );
    // The first save is accepted; the follow-up save finds the network gone.
    api.offline = true;
    release();
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('Offline'),
      SAVE_WAIT,
    );
    const accepted = api.draftToken(loop.id);
    expect(await loadLocalDraft(loop.id)).toMatchObject({
      synced: false,
      definition: { description: 'second' },
      baseToken: accepted,
    });
    expect(useEditorStore.getState().baseToken).toBe(accepted);

    // Back online, the retry saves without a conflict.
    api.offline = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
  });
});
