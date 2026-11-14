import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { loadLocalDraft, saveLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { serializeSave } from './useAutosave.js';

const SAVE_WAIT = { timeout: 4000 };
const RECONCILING =
  'The editor is available. Checking the server and this device before saving changes.';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** The editor for a new loop named `name`, reconciled and saved once with description `first`. */
async function savedEditor(api: FakeApi, name = 'mine', first = 'A1') {
  const loop = api.addLoop(newLoopDefinition(name));
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name });
  await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
  act(() => useEditorStore.getState().updateMeta({ description: first }));
  await waitFor(
    () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    SAVE_WAIT,
  );
  return { loop, token: api.draftToken(loop.id)! };
}

const publishButton = () => screen.getByRole('button', { name: /^Publish/ });
const posts = (api: FakeApi, loopId: string) => api.callsTo('POST', `/loops/${loopId}/publish`);
const puts = (api: FakeApi, loopId: string) => api.callsTo('PUT', `/loops/${loopId}/draft`);
async function detail(api: FakeApi, loopId: string) {
  const response = await api.builtIn({
    method: 'GET',
    path: `/loops/${loopId}`,
    search: new URLSearchParams(),
    body: undefined,
    headers: new Headers(),
  });
  type Version = { id: string; version: number; definition: { description?: string } };
  return (await response.json()) as { current?: Version; draft?: Version };
}

describe('Publish (#237)', () => {
  it('names the stored version when its reply arrives after newer work, and queues that work behind it', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const reply = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      const committed = await api.builtIn(call);
      await reply.promise;
      return committed;
    });
    const { loop } = await savedEditor(api);
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(1));
    const v1 = (await detail(api, loop.id)).current!;
    expect(v1.definition.description).toBe('A1');
    act(() => useEditorStore.getState().updateMeta({ description: 'A2' }));
    // This editor's own later save waits behind the publish request in the loop's queue.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts(api, loop.id)).toHaveLength(1);
    reply.release();
    expect(
      await screen.findByText(
        'Published version 1. It holds the draft saved for this publish; changes made after that are not published.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(puts(api, loop.id)).toHaveLength(2), SAVE_WAIT);
    const after = await detail(api, loop.id);
    expect(after.current).toMatchObject({ id: v1.id, definition: { description: 'A1' } });
    expect(after.draft?.definition.description).toBe('A2');
    await waitFor(() => expect(screen.getByText('published v1')).toBeInTheDocument());
    // The notice stays until dismissed: the reply never relabels A2.
    await user.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText(/Published version 1/)).toBeNull();
  });

  it('shows nothing in a newer load of the editor, though its caches refresh', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    // An older unsynced device copy, set aside on load: restoring it starts a new editor load.
    await saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    const reply = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      const committed = await api.builtIn(call);
      await reply.promise;
      return committed;
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    const restore = await screen.findByRole('button', { name: "Use this device's copy instead" });
    await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(1));
    const generation = useEditorStore.getState().generation;
    await user.click(restore);
    expect(await screen.findByText('Restored unsaved changes from this device.')).toBeVisible();
    expect(useEditorStore.getState().generation).toBeGreaterThan(generation);
    const reads = api.callsTo('GET', `/loops/${loop.id}`).length;
    reply.release();
    await waitFor(() =>
      expect(api.callsTo('GET', `/loops/${loop.id}`).length).toBeGreaterThan(reads),
    );
    const { current } = await detail(api, loop.id);
    await waitFor(() =>
      expect(screen.getByText(`published v${current!.version}`)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(
        /Published version|Publish failed|Nothing to publish|Nothing was published/,
      ),
    ).toBeNull();
    expect(useEditorStore.getState().conflict).toBeUndefined();
  });

  it('says a different stored draft was published when another write lands before admission', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const admission = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      await admission.promise;
      return api.builtIn(call);
    });
    const { loop, token } = await savedEditor(api);
    const saved = (await detail(api, loop.id)).draft!;
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(1));
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'B' });
    admission.release();
    expect(await screen.findByText('A different draft was published')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Version 1 holds a different stored draft from the draft saved for this publish. This editor’s draft is not published.',
      ),
    ).toBeInTheDocument();
    // The same draft row and number as this editor's save, holding different content.
    expect((await detail(api, loop.id)).current).toMatchObject({
      id: saved.id,
      version: saved.version,
      definition: { description: 'B' },
    });
    // The existing explicit recovery, with this editor's copy kept unsynced on its own base.
    expect(screen.getByText('The draft changed on the server')).toBeInTheDocument();
    expect(screen.getByTestId('save-state')).toHaveTextContent('Draft changed elsewhere');
    await waitFor(async () =>
      expect(await loadLocalDraft(loop.id)).toMatchObject({
        synced: false,
        baseToken: token,
        definition: { description: 'A1' },
      }),
    );
    expect(useEditorStore.getState().definition?.description).toBe('A1');
  });

  it('separates nothing to publish from a competing publication of another draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const admission = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      await admission.promise;
      return api.builtIn(call);
    });
    const { loop } = await savedEditor(api);
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(1));
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'B' });
    api.publishElsewhere(loop.id);
    admission.release();
    expect(await screen.findByText('Nothing was published')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The server had no draft to publish. Its current version, version 1, holds a different stored draft from the draft saved for this publish.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('The draft changed on the server')).toBeInTheDocument();
  });

  it('confirms a matching no-op without a false mismatch, and clears it on the next edit', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('clean'), { published: true });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'clean' });
    await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
    await user.click(publishButton());
    expect(
      await screen.findByText('Nothing to publish: version 1 already holds this draft.'),
    ).toBeInTheDocument();
    expect(useEditorStore.getState().conflict).toBeUndefined();
    expect(puts(api, loop.id)).toHaveLength(0);
    act(() => useEditorStore.getState().updateMeta({ description: 'changed' }));
    await waitFor(() => expect(screen.queryByText(/Nothing to publish/)).toBeNull());
  });

  it('reads the server back when the reply is lost after the commit, and claims no failure', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.override('POST /loops/:id/publish', async (call) => {
      await api.builtIn(call);
      throw new TypeError('Failed to fetch');
    });
    const { loop } = await savedEditor(api);
    await user.click(publishButton());
    expect(await screen.findByText('Publish not confirmed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The GraphGoblin API cannot be reached. A check of the server found that version 1, its current published version, holds the draft saved for this publish.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Publish failed')).toBeNull();
    expect(useEditorStore.getState().conflict).toBeUndefined();
    // Nothing is resubmitted on its own.
    expect(posts(api, loop.id)).toHaveLength(1);
  });

  it('offers a retry when the check finds the draft unpublished (a request lost before admission)', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    let lose = true;
    api.override('POST /loops/:id/publish', (call) => {
      if (lose) throw new TypeError('Failed to fetch');
      return api.builtIn(call);
    });
    const { loop } = await savedEditor(api);
    await user.click(publishButton());
    expect(
      await screen.findByText(/is not its current published version\. Publish again to retry\./),
    ).toBeInTheDocument();
    expect(useEditorStore.getState().conflict).toBeUndefined();
    lose = false;
    await user.click(publishButton());
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(2);
  });

  it('reports a server error after the commit as unconfirmed, with the server’s reason', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.override('POST /loops/:id/publish', async (call) => {
      await api.builtIn(call);
      return problem(503, 'UNAVAILABLE', 'the gateway is restarting');
    });
    await savedEditor(api);
    await user.click(publishButton());
    expect(
      await screen.findByText(
        /^the gateway is restarting \(UNAVAILABLE\) A check of the server found that version 1/,
      ),
    ).toBeInTheDocument();
  });

  it('never sends another request blind after an unknown outcome whose check failed', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    let reachable = true;
    api.override('POST /loops/:id/publish', async (call) => {
      await api.builtIn(call);
      throw new TypeError('Failed to fetch');
    });
    api.override('GET /loops/:id', (call) => {
      if (!reachable) throw new TypeError('Failed to fetch');
      return api.builtIn(call);
    });
    const { loop } = await savedEditor(api);
    reachable = false;
    await user.click(publishButton());
    expect(
      await screen.findByText(
        /Checking the server failed too: .* Publish again checks the server first\./,
      ),
    ).toBeInTheDocument();
    await user.click(publishButton());
    expect(
      await screen.findByText(
        /^Checking the server before publishing again failed: .* Nothing was sent/,
      ),
    ).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);
    reachable = true;
    await user.click(publishButton());
    expect(
      await screen.findByText('Nothing to publish: version 1 already holds this draft.'),
    ).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);
  });

  it('refuses when input is held while the publish’s save is in flight', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    const save = gate();
    api.override('PUT /loops/:id/draft', async (call) => {
      await save.promise;
      return api.builtIn(call);
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
    act(() => useEditorStore.getState().updateMeta({ description: 'H1' }));
    await user.click(publishButton());
    await waitFor(() => expect(puts(api, loop.id)).toHaveLength(1));
    act(() =>
      useEditorStore
        .getState()
        .setFieldError('settings', 'maxNodeVisits', { message: 'Enter a number', text: '1e' }),
    );
    save.release();
    expect(
      await screen.findByText(
        'Some fields hold input that is not a valid value yet; complete or discard it first.',
      ),
    ).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(0);
  });

  it('rechecks the load and held input where the request is sent, behind queued saves', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
    // While the publish's own save runs, another job for this loop joins the queue behind it.
    let queued = gate();
    api.override('PUT /loops/:id/draft', async (call) => {
      const answer = await api.builtIn(call);
      const blocker = queued;
      void serializeSave(loop.id, () => blocker.promise);
      return answer;
    });

    // Held input arrives in the gap between the save and the request.
    act(() => useEditorStore.getState().updateMeta({ description: 'one' }));
    await user.click(publishButton());
    await waitFor(() => expect(puts(api, loop.id)).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
    act(() =>
      useEditorStore
        .getState()
        .setFieldError('variables', 'variables', { message: 'Not JSON', text: '{' }),
    );
    queued.release();
    expect(await screen.findByText(/Some fields hold input/)).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(0);
    act(() => useEditorStore.getState().setFieldError('variables', 'variables', undefined));

    // A new editor load in the gap: nothing is sent and nothing is shown.
    queued = gate();
    act(() => useEditorStore.getState().updateMeta({ description: 'two' }));
    await user.click(publishButton());
    await waitFor(() => expect(puts(api, loop.id)).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
    act(() =>
      useEditorStore.getState().load(loop.id, newLoopDefinition('mine'), {
        baseToken: api.draftToken(loop.id),
      }),
    );
    queued.release();
    await waitFor(() => expect(publishButton()).toHaveTextContent(/^Publish$/));
    expect(posts(api, loop.id)).toHaveLength(0);
    expect(screen.queryByText(/Publish failed|Published version/)).toBeNull();
  });

  it('describes a release that a newer publication has since replaced, and keeps the toolbar current', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const reply = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      const committed = await api.builtIn(call);
      await reply.promise;
      return committed;
    });
    const { loop } = await savedEditor(api);
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(1));
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'B' });
    api.publishElsewhere(loop.id);
    reply.release();
    expect(
      await screen.findByText('Published version 1. Version 2 has been published since.'),
    ).toBeInTheDocument();
    expect(screen.getByText('published v2')).toBeInTheDocument();
    // The notice carries no run link: the toolbar's opens the loop's current Runs flow.
    const notice = screen.getByText(/Published version 1/).closest('[role=status]')!;
    expect(within(notice as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('sends one request for two clicks in the same task', async () => {
    const api = new FakeApi();
    const { loop } = await savedEditor(api);
    act(() => {
      publishButton().click();
      publishButton().click();
    });
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);
  });
});
