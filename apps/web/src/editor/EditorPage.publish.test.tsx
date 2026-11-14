import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
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
const PUBLISH_FEEDBACK =
  /Publish failed|Published version|Publish not confirmed|Nothing to publish|Nothing was published/;
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

/**
 * Version 1 published and a newer draft saved, whose Publish request was lost before the server
 * admitted it, and whose check after that failed too: the next Publish reads the server first.
 * Once `reads.hold` is set, this loop's detail reads wait for it (`reads.held` counts them).
 */
async function unconfirmedPublish(api: FakeApi) {
  const loop = api.addLoop(newLoopDefinition('mine'), { published: true });
  const reads: { hold: ReturnType<typeof gate> | undefined; held: number } = {
    hold: undefined,
    held: 0,
  };
  let lose = true;
  let failCheck = false;
  api.override('POST /loops/:id/publish', (call) => {
    if (!lose) return api.builtIn(call);
    lose = false;
    failCheck = true;
    throw new TypeError('Failed to fetch');
  });
  api.override('GET /loops/:id', async (call, [id]) => {
    if (id === loop.id && failCheck) {
      failCheck = false;
      throw new TypeError('Failed to fetch');
    }
    if (id === loop.id && reads.hold) {
      reads.held += 1;
      await reads.hold.promise;
    }
    return api.builtIn(call);
  });
  const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'mine' });
  await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
  act(() => useEditorStore.getState().updateMeta({ description: 'A1' }));
  await waitFor(
    () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    SAVE_WAIT,
  );
  const user = userEvent.setup();
  await user.click(publishButton());
  expect(
    await screen.findByText(
      /Checking the server failed too: .* Publish again checks the server first\./,
    ),
  ).toBeInTheDocument();
  const before = await detail(api, loop.id);
  expect(before.current?.version).toBe(1);
  expect(before.draft?.definition.description).toBe('A1');
  expect(posts(api, loop.id)).toHaveLength(1);
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return { user, loop, reads, v1: before.current!, queryClient };
}

/** Publish again, and wait until its check of the server is held there. */
async function retryHeldAtCheck(
  user: ReturnType<typeof userEvent.setup>,
  api: FakeApi,
  loopId: string,
  reads: Awaited<ReturnType<typeof unconfirmedPublish>>['reads'],
) {
  const hold = gate();
  reads.hold = hold;
  const before = api.callsTo('GET', `/loops/${loopId}`).length;
  await user.click(publishButton());
  await waitFor(() => expect(reads.held).toBe(1));
  expect(api.callsTo('GET', `/loops/${loopId}`)).toHaveLength(before + 1);
  expect(posts(api, loopId)).toHaveLength(1);
  return hold;
}

describe('Publish after an unknown outcome, while its check is answered (#237)', () => {
  it('refuses held input that arrived during the check, and sends nothing', async () => {
    const api = new FakeApi();
    const { user, loop, reads, v1 } = await unconfirmedPublish(api);
    const hold = await retryHeldAtCheck(user, api, loop.id, reads);
    // Variables text that does not parse, typed while the check's answer waits.
    act(() =>
      useEditorStore.getState().setFieldError('variables', 'variables', {
        message: 'invalid JSON',
        text: '{',
        input: 'unparsed text',
      }),
    );
    hold.release();
    expect(
      await screen.findByText(
        'Some fields hold input that is not a valid value yet; complete or discard it first.',
      ),
    ).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);
    const after = await detail(api, loop.id);
    expect(after.current).toMatchObject({ id: v1.id, version: 1 });
    expect(after.draft?.definition.description).toBe('A1');
    expect(screen.queryByText(/Published version/)).toBeNull();
    expect(useEditorStore.getState().fieldErrors['variables']?.['variables']?.text).toBe('{');

    // Discarding the text sends nothing by itself; one deliberate Publish sends one request.
    reads.hold = undefined;
    act(() => useEditorStore.getState().setFieldError('variables', 'variables', undefined));
    expect(posts(api, loop.id)).toHaveLength(1);
    await user.click(publishButton());
    expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(2);
  });

  it('sends nothing, and shows nothing, once another editor opened during the check', async () => {
    const api = new FakeApi();
    const other = api.addLoop({ ...newLoopDefinition('other'), description: 'theirs' });
    const { user, loop, reads, v1, queryClient } = await unconfirmedPublish(api);
    const hold = await retryHeldAtCheck(user, api, loop.id, reads);
    const toolbar = screen.getByTestId('save-state').closest('header')!;
    await user.click(within(toolbar).getByRole('link', { name: 'Loops' }));
    await user.click(await screen.findByRole('link', { name: 'other' }));
    await screen.findByRole('heading', { name: 'other' });
    await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
    hold.release();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(posts(api, loop.id)).toHaveLength(1);
    expect(posts(api, other.id)).toHaveLength(0);
    expect((await detail(api, loop.id)).current).toMatchObject({ id: v1.id, version: 1 });
    expect(screen.queryByText(PUBLISH_FEEDBACK)).toBeNull();
    expect(useEditorStore.getState()).toMatchObject({
      loopId: other.id,
      definition: { description: 'theirs' },
    });
  });

  it('sends one request after the check when nothing changed meanwhile', async () => {
    const api = new FakeApi();
    const { user, loop, reads } = await unconfirmedPublish(api);
    const hold = await retryHeldAtCheck(user, api, loop.id, reads);
    const check = api.calls.indexOf(api.callsTo('GET', `/loops/${loop.id}`).at(-1)!);
    hold.release();
    expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(2);
    expect(api.calls.indexOf(posts(api, loop.id)[1]!)).toBeGreaterThan(check);
    const after = await detail(api, loop.id);
    expect(after.current).toMatchObject({ version: 2, definition: { description: 'A1' } });
    expect(after.draft).toBeUndefined();
  });
});

/**
 * The editor for a loop with one variable (so Loop settings shows its Variables field), saved once
 * with description A1. While `reads.fail` is above zero, each of this loop's detail reads fails and
 * counts it down; while `reads.hold` is set, they wait for it.
 */
async function variablesEditor(api: FakeApi) {
  const loop = api.addLoop({
    ...newLoopDefinition('mine'),
    variables: { key: { type: 'string' } },
  });
  const reads: { fail: number; hold: ReturnType<typeof gate> | undefined } = {
    fail: 0,
    hold: undefined,
  };
  api.override('GET /loops/:id', async (call, [id]) => {
    if (id === loop.id && reads.fail > 0) {
      reads.fail -= 1;
      throw new TypeError('Failed to fetch');
    }
    if (id === loop.id && reads.hold) await reads.hold.promise;
    return api.builtIn(call);
  });
  const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'mine' });
  await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
  act(() => useEditorStore.getState().updateMeta({ description: 'A1' }));
  await waitFor(
    () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    SAVE_WAIT,
  );
  return { user: userEvent.setup(), loop, reads, queryClient };
}

/**
 * The native diagnostic's start: the first Publish is committed as version 1, its reply is lost,
 * and the check of the server after it fails too.
 */
async function committedButUnconfirmed(api: FakeApi) {
  const editor = await variablesEditor(api);
  let lose = true;
  api.override('POST /loops/:id/publish', async (call) => {
    const committed = await api.builtIn(call);
    if (!lose) return committed;
    lose = false;
    editor.reads.fail = 1;
    throw new TypeError('Failed to fetch');
  });
  await editor.user.click(publishButton());
  expect(
    await screen.findByText(
      /Checking the server failed too: .* Publish again checks the server first\./,
    ),
  ).toBeInTheDocument();
  const committed = await detail(api, editor.loop.id);
  expect(committed.current).toMatchObject({ version: 1, definition: { description: 'A1' } });
  expect(committed.draft).toBeUndefined();
  expect(posts(api, editor.loop.id)).toHaveLength(1);
  // The editor's own refresh after the attempt read the loop successfully meanwhile.
  await waitFor(() => expect(screen.getByText('published v1')).toBeInTheDocument());
  await waitFor(() => expect(editor.queryClient.isFetching()).toBe(0));
  return { ...editor, v1: committed.current! };
}

const HELD_REFUSAL =
  'Some fields hold input that is not a valid value yet; complete or discard it first.';
const CHECK_FAILED = /^Checking the server before publishing again failed: .* Nothing was sent/;

/** Make the Variables text unparsable, as typing `[` before it would; returns the valid text. */
async function holdVariables(user: ReturnType<typeof userEvent.setup>) {
  const show = screen.queryByRole('button', { name: 'Show loop settings' });
  if (show) await user.click(show);
  const valid = getCode('Variables value 1');
  setCode('Variables value 1', `[${valid}`);
  await screen.findByRole('button', { name: 'Discard the unparsed text' });
  return valid;
}

/** The loop's detail reads, draft saves and Publish requests from call `from` on, in order. */
const loopTraffic = (api: FakeApi, loopId: string, from: number) =>
  api.calls
    .slice(from)
    .filter(
      (call) =>
        (call.method === 'GET' && call.path === `/loops/${loopId}`) ||
        (call.method === 'PUT' && call.path === `/loops/${loopId}/draft`) ||
        (call.method === 'POST' && call.path === `/loops/${loopId}/publish`),
    )
    .map((call) => call.method);

/** Publish with that text held: refused in this editor, with nothing sent for the loop. */
async function refusedPublish(
  user: ReturnType<typeof userEvent.setup>,
  api: FakeApi,
  loopId: string,
  queryClient: QueryClient,
) {
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  const before = api.calls.length;
  await user.click(publishButton());
  expect(await screen.findByText(HELD_REFUSAL)).toBeInTheDocument();
  expect(screen.getByText('Publish failed')).toBeInTheDocument();
  await waitFor(() => expect(publishButton()).toHaveTextContent(/^Publish$/));
  expect(loopTraffic(api, loopId, before)).toEqual([]);
}

async function discardVariables(user: ReturnType<typeof userEvent.setup>, valid: string) {
  await user.click(screen.getByRole('button', { name: 'Discard the unparsed text' }));
  await waitFor(() => expect(getCode('Variables value 1')).toBe(valid));
}

describe('Publish after an unknown outcome and a refusal that sent nothing (#237)', () => {
  it('reads the server first after a held-input refusal, and sends no second request', async () => {
    const api = new FakeApi();
    const { user, loop, v1, queryClient } = await committedButUnconfirmed(api);
    const valid = await holdVariables(user);
    await refusedPublish(user, api, loop.id, queryClient);
    // The refusal is the latest attempt's feedback; the earlier notice is replaced.
    expect(screen.queryByText('Publish not confirmed')).toBeNull();
    await discardVariables(user, valid);
    expect(puts(api, loop.id)).toHaveLength(1);

    const before = api.calls.length;
    await user.click(publishButton());
    expect(
      await screen.findByText('Nothing to publish: version 1 already holds this draft.'),
    ).toBeInTheDocument();
    expect(loopTraffic(api, loop.id, before)[0]).toBe('GET');
    expect(posts(api, loop.id)).toHaveLength(1);
    expect(puts(api, loop.id)).toHaveLength(1);
    const after = await detail(api, loop.id);
    expect(after.current).toEqual(v1);
    expect(after.draft).toBeUndefined();
    expect(screen.queryByText('Publish failed')).toBeNull();
    expect(useEditorStore.getState().conflict).toBeUndefined();
  });

  it('stays unresolved through refusals and a failed check, until a check answers', async () => {
    const api = new FakeApi();
    const { user, loop, reads, queryClient } = await committedButUnconfirmed(api);
    let valid = await holdVariables(user);
    await refusedPublish(user, api, loop.id, queryClient);
    await discardVariables(user, valid);

    // The check fails again: still nothing is sent.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    reads.fail = 1;
    await user.click(publishButton());
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);

    valid = await holdVariables(user);
    await refusedPublish(user, api, loop.id, queryClient);
    await discardVariables(user, valid);

    await user.click(publishButton());
    expect(
      await screen.findByText('Nothing to publish: version 1 already holds this draft.'),
    ).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);
  });

  it('stays unresolved through a Publish whose save failed, then sends once after a check', async () => {
    const api = new FakeApi();
    const { user, loop, reads, queryClient } = await committedButUnconfirmed(api);
    let saving = false;
    api.override('PUT /loops/:id/draft', (call) =>
      saving ? api.builtIn(call) : problem(503, 'UNAVAILABLE', 'the gateway is restarting'),
    );
    act(() => useEditorStore.getState().updateMeta({ description: 'A2' }));
    await user.click(publishButton());
    expect(
      await screen.findByText('The draft could not be saved; fix the issues below first.'),
    ).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);

    // The draft saves later on its own; an accepted save says nothing about the publication.
    saving = true;
    act(() => useEditorStore.getState().updateMeta({ description: 'A3' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    reads.fail = 1;
    await user.click(publishButton());
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);

    // A check that answers settles it: version 1 holds A1, so A3 is published, once.
    const before = api.calls.length;
    await user.click(publishButton());
    expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
    expect(loopTraffic(api, loop.id, before).slice(0, 2)).toEqual(['GET', 'POST']);
    expect(posts(api, loop.id)).toHaveLength(2);
    expect((await detail(api, loop.id)).current).toMatchObject({
      version: 2,
      definition: { description: 'A3' },
    });
  });

  it('stays unresolved through a refusal met where the request would be sent', async () => {
    const api = new FakeApi();
    const { user, loop, reads, queryClient } = await committedButUnconfirmed(api);
    // While the publish's own save runs, another job for this loop joins the queue behind it.
    const queued = gate();
    let block = true;
    api.override('PUT /loops/:id/draft', async (call) => {
      const answer = await api.builtIn(call);
      if (block) void serializeSave(loop.id, () => queued.promise);
      block = false;
      return answer;
    });
    act(() => useEditorStore.getState().updateMeta({ description: 'A2' }));
    await user.click(publishButton());
    await waitFor(() => expect(puts(api, loop.id)).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
    const valid = await holdVariables(user);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const before = api.calls.length;
    queued.release();
    expect(await screen.findByText(HELD_REFUSAL)).toBeInTheDocument();
    await waitFor(() => expect(publishButton()).toHaveTextContent(/^Publish$/));
    expect(loopTraffic(api, loop.id, before)).toEqual([]);
    expect(posts(api, loop.id)).toHaveLength(1);
    await discardVariables(user, valid);

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    reads.fail = 1;
    await user.click(publishButton());
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(posts(api, loop.id)).toHaveLength(1);
    expect((await detail(api, loop.id)).draft?.definition.description).toBe('A2');
  });

  it('sends at once after a refusal when the last outcome was known (control)', async () => {
    const api = new FakeApi();
    const { user, loop, reads, queryClient } = await variablesEditor(api);
    await user.click(publishButton());
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
    const valid = await holdVariables(user);
    await refusedPublish(user, api, loop.id, queryClient);
    await discardVariables(user, valid);
    act(() => useEditorStore.getState().updateMeta({ description: 'A2' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    // Reads of the loop wait; the request does not.
    const hold = gate();
    reads.hold = hold;
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(2));
    hold.release();
    expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
  });

  it('sends at once after a refusal when the check after a lost request answered (control)', async () => {
    const api = new FakeApi();
    const { user, loop, reads, queryClient } = await variablesEditor(api);
    let lose = true;
    api.override('POST /loops/:id/publish', (call) => {
      if (!lose) return api.builtIn(call);
      lose = false;
      throw new TypeError('Failed to fetch');
    });
    await user.click(publishButton());
    expect(
      await screen.findByText(/is not its current published version\. Publish again to retry\./),
    ).toBeInTheDocument();
    const valid = await holdVariables(user);
    await refusedPublish(user, api, loop.id, queryClient);
    await discardVariables(user, valid);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    const hold = gate();
    reads.hold = hold;
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(2));
    hold.release();
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
  });

  it('does not carry an unresolved request into a newer load of the editor (control)', async () => {
    const api = new FakeApi();
    const { user, loop, reads, queryClient } = await committedButUnconfirmed(api);
    // Reload server draft starts a newer load, from the server's draft as read now.
    api.saveDraftElsewhere(loop.id, {
      ...newLoopDefinition('mine'),
      variables: { key: { type: 'string' } },
      description: 'B',
    });
    act(() => useEditorStore.getState().updateMeta({ description: 'A2' }));
    expect(
      await screen.findByText('The draft changed on the server', undefined, SAVE_WAIT),
    ).toBeInTheDocument();
    const generation = useEditorStore.getState().generation;
    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    await waitFor(() => expect(useEditorStore.getState().generation).toBeGreaterThan(generation));
    expect(useEditorStore.getState().definition?.description).toBe('B');
    expect(screen.queryByText('Publish not confirmed')).toBeNull();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    const hold = gate();
    reads.hold = hold;
    await user.click(publishButton());
    await waitFor(() => expect(posts(api, loop.id)).toHaveLength(2));
    hold.release();
    expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
    expect((await detail(api, loop.id)).current).toMatchObject({
      version: 2,
      definition: { description: 'B' },
    });
  });
});

describe('Readiness beside a refusal that holds the draft (#237)', () => {
  it('does not claim Ready to publish while another loop has the name', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop(newLoopDefinition('Nightly Triage'));
    const mine = api.addLoop(newLoopDefinition('Daytime Triage'));
    renderApp(`/loops/${mine.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Daytime Triage' });
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    const show = screen.queryByRole('button', { name: 'Show loop settings' });
    if (show) await user.click(show);
    const field = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(field);
    await user.type(field, 'nightly triage');
    await screen.findByText('Another loop already has this name', undefined, SAVE_WAIT);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved: name in use');
    expect(screen.queryByText('Ready to publish')).toBeNull();
    expect(screen.getByText('Validation unavailable')).toHaveAttribute(
      'title',
      'Another loop already has this name; choose a different name before publishing.',
    );
    // Another name ends the refusal; once saved and checked, the draft is ready again.
    await user.type(field, ' b');
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
  });

  it('does not claim Ready to publish in a draft conflict', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { loop } = await savedEditor(api);
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'B' });
    act(() => useEditorStore.getState().updateMeta({ description: 'A2' }));
    expect(
      await screen.findByText('The draft changed on the server', undefined, SAVE_WAIT),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ready to publish')).toBeNull();
    expect(screen.getByText('Validation unavailable')).toHaveAttribute(
      'title',
      'The draft changed on the server; reload it or overwrite it first.',
    );
    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
  });
});
