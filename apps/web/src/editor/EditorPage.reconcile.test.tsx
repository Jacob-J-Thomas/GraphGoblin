import type { LoopIssue } from '@graphgoblin/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { cachedCatalogFingerprint, keys, refreshLoopAfterWrite } from '../api/queries.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { AUTOSAVE_DELAY_MS } from './useAutosave.js';

const SAVE_WAIT = { timeout: 4000 };
const RECONCILING =
  'The editor is available. Checking the server and this device before saving changes.';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const puts = (api: FakeApi, loopId: string) => api.callsTo('PUT', `/loops/${loopId}/draft`);

async function editorReady(name: string) {
  await screen.findByRole('heading', { name });
  await waitFor(() => expect(screen.queryByText(RECONCILING)).toBeNull());
}
/** The editor toolbar's way back to the list (the app's navigation has a Loops link too). */
async function leave(user: ReturnType<typeof userEvent.setup>) {
  const toolbar = screen.getByTestId('save-state').closest('header')!;
  await user.click(within(toolbar).getByRole('link', { name: 'Loops' }));
}
const row = (name: string) => screen.getByRole('link', { name }).closest('tr')!;
async function serverDraft(api: FakeApi, loopId: string) {
  const response = await api.builtIn({
    method: 'GET',
    path: `/loops/${loopId}`,
    search: new URLSearchParams(),
    body: undefined,
    headers: new Headers(),
  });
  return ((await response.json()) as { draft?: { definition: { description?: string } } }).draft
    ?.definition;
}

describe('Loops list after a save (#156, #237)', () => {
  for (const order of ['warm, leaving before the debounce', 'warm, save in flight', 'cold']) {
    it(`converges after the server accepts the save, ${order}, and an older read cannot roll it back`, async () => {
      const user = userEvent.setup();
      const api = new FakeApi();
      const a = api.addLoop(
        { ...newLoopDefinition('loop a'), description: 'desc a' },
        { published: true },
      );
      api.addLoop({ ...newLoopDefinition('loop b'), description: 'desc b' });
      api.addRun({ loopId: a.id, status: 'succeeded', createdAt: TS });
      if (order === 'cold') renderApp(`/loops/${a.id}/edit`, api);
      else {
        renderApp('/loops', api);
        await user.click(await screen.findByRole('link', { name: 'loop a' }));
      }
      await editorReady('loop a');
      const save = gate();
      const oldList = gate();
      let listReads = 0;
      api.override('PUT /loops/:id/draft', async (call) => {
        await save.promise;
        return api.builtIn(call);
      });
      api.override('GET /loops', async (call) => {
        listReads += 1;
        // Answered from the server's state now, before the save is admitted.
        const answer = api.builtIn(call);
        if (listReads === 1) await oldList.promise;
        return answer;
      });
      act(() => useEditorStore.getState().updateMeta({ name: 'loop a renamed', description: '' }));
      if (order === 'warm, save in flight')
        await waitFor(() => expect(puts(api, a.id)).toHaveLength(1), SAVE_WAIT);
      await leave(user);
      await waitFor(() => expect(listReads).toBe(1));
      await waitFor(() => expect(puts(api, a.id)).toHaveLength(1));
      save.release();
      // A read issued after the save's reply, not the poll's.
      await waitFor(() => expect(listReads).toBe(2));
      const renamed = await screen.findByRole('link', { name: 'loop a renamed' });
      expect(renamed.closest('tr')).not.toHaveTextContent('desc a');
      oldList.release();
      await tick();
      expect(row('loop a renamed')).not.toHaveTextContent('desc a');
      expect(screen.queryByRole('link', { name: 'loop a' })).toBeNull();
      expect(within(row('loop a renamed')).getByText('succeeded')).toBeInTheDocument();
      expect(row('loop b')).toHaveTextContent('desc b');
      expect(listReads).toBe(2);
    });
  }

  it('reopens on the server’s copy when the reopened editor’s read was answered before the leaving save', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await editorReady('mine');
    const save = gate();
    api.override('PUT /loops/:id/draft', async (call) => {
      await save.promise;
      return api.builtIn(call);
    });
    act(() => useEditorStore.getState().updateMeta({ description: 'U' }));
    await leave(user);
    await waitFor(() => expect(puts(api, loop.id)).toHaveLength(1));
    const read = gate();
    let reads = 0;
    api.override('GET /loops/:id', async (call) => {
      reads += 1;
      const answer = api.builtIn(call);
      if (reads === 1) await read.promise;
      return answer;
    });
    await user.click(await screen.findByRole('link', { name: 'mine' }));
    await screen.findByRole('heading', { name: 'mine' });
    await waitFor(() => expect(reads).toBe(1));
    expect(useEditorStore.getState().definition?.description).toBe('U');
    save.release();
    await waitFor(async () => expect((await serverDraft(api, loop.id))?.description).toBe('U'));
    read.release();
    await editorReady('mine');
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
    expect(useEditorStore.getState()).toMatchObject({
      definition: { description: 'U' },
      baseToken: api.draftToken(loop.id),
    });
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('keeps a failed refresh in its own query and the save acknowledged', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await editorReady('mine');
    const reads = api.callsTo('GET', `/loops/${loop.id}`).length;
    api.override('GET /loops/:id', () => problem(500, 'BROKEN', 'read failed'));
    act(() => useEditorStore.getState().updateMeta({ description: 'saved' }));
    await waitFor(() =>
      expect(api.callsTo('GET', `/loops/${loop.id}`).length).toBeGreaterThan(reads),
    );
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
  });
});

describe('the save sent on leaving (#237)', () => {
  it('stays on its own load’s token when a later load took another writer’s draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    const loaded = api.draftToken(loop.id)!;
    const first = gate();
    let sent = 0;
    api.override('PUT /loops/:id/draft', async (call) => {
      sent += 1;
      if (sent === 1) await first.promise;
      return api.builtIn(call);
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await editorReady('mine');
    act(() => useEditorStore.getState().updateMeta({ description: 'S1' }));
    await waitFor(() => expect(sent).toBe(1), SAVE_WAIT);
    act(() => useEditorStore.getState().updateMeta({ description: 'U' }));
    await leave(user);
    await tick(5);
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'B' });
    // As the API does, that save stamps the loop's time: this device's copy of U is older, so
    // reopening sets it aside and loads B with B's token.
    const updatedAt = new Date().toISOString();
    api.override('GET /loops/:id', async (call) => {
      const detail = (await (await api.builtIn(call)).json()) as { loop: object };
      return new Response(JSON.stringify({ ...detail, loop: { ...detail.loop, updatedAt } }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    await user.click(await screen.findByRole('link', { name: 'mine' }));
    await editorReady('mine');
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();
    expect(useEditorStore.getState().definition?.description).toBe('B');
    first.release();
    await waitFor(() => expect(sent).toBe(2), SAVE_WAIT);
    const leaving = puts(api, loop.id)[1]!;
    expect(leaving.body).toMatchObject({ definition: { description: 'U' } });
    expect(leaving.headers.get('if-match')).toBe(`"${loaded}"`);
    await tick();
    expect((await serverDraft(api, loop.id))?.description).toBe('B');
  });

  it('sends nothing for an earlier load’s snapshot after Reload server draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await editorReady('mine');
    api.saveDraftElsewhere(loop.id, { ...newLoopDefinition('mine'), description: 'B' });
    act(() => useEditorStore.getState().updateMeta({ description: 'C1' }));
    await screen.findByText('The draft changed on the server', undefined, SAVE_WAIT);
    const edited = Date.now();
    act(() => useEditorStore.getState().updateMeta({ description: 'U' }));
    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    await waitFor(() => expect(useEditorStore.getState().definition?.description).toBe('B'));
    await leave(user);
    // The earlier load's debounce had not fired: its snapshot was still pending on leaving.
    expect(Date.now() - edited).toBeLessThan(AUTOSAVE_DELAY_MS);
    await tick(AUTOSAVE_DELAY_MS + 200);
    expect(
      puts(api, loop.id).filter(
        (call) =>
          (call.body as { definition: { description?: string } }).definition.description === 'U',
      ),
    ).toHaveLength(0);
    expect((await serverDraft(api, loop.id))?.description).toBe('B');
  });
});

const validations = (api: FakeApi, loopId: string) =>
  api.callsTo('POST', `/loops/${loopId}/validate`).length;
const nodeBadge = (id: string) =>
  screen
    .getByTestId(`node-${id}`)
    .querySelector<HTMLButtonElement>(`button[aria-label$=" on ${id}"]`);
/** The open editor's API check of a loop's unchanged draft, under the catalogs cached now. */
const checkKey = (api: FakeApi, queryClient: QueryClient, loopId: string) =>
  keys.validation(loopId, api.draftToken(loopId)!, cachedCatalogFingerprint(queryClient));

/**
 * Loop `parent` runs loop `target`, a draft only, as a subloop. The parent's API checks report the
 * target unpublished while it is, as the API does, and while `checks.hold` is set each waits for it
 * after reading the target (`checks.held` counts them).
 */
function subloopLoops(api: FakeApi) {
  const target = api.addLoop(newLoopDefinition('target'));
  const definition = newLoopDefinition('parent');
  const parent = api.addLoop({
    ...definition,
    nodes: [
      ...definition.nodes,
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: target.id } } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ],
  });
  const checks: { hold: ReturnType<typeof gate> | undefined; held: number } = {
    hold: undefined,
    held: 0,
  };
  api.override('POST /loops/:id/validate', async (call, [id]) => {
    const { issues } = (await (await api.builtIn(call)).json()) as { issues: LoopIssue[] };
    if (id === parent.id && !api.loops.get(target.id)?.current)
      issues.push({
        code: 'SUBLOOP_NOT_PUBLISHED',
        severity: 'error',
        nodeId: 'sub',
        message: 'subloop "sub" references "target", which has no published version',
      });
    const hold = id === parent.id ? checks.hold : undefined;
    if (hold) {
      checks.held += 1;
      await hold.promise;
    }
    return new Response(
      JSON.stringify({ issues, publishable: !issues.some((i) => i.severity === 'error') }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  return { target, parent, checks };
}

async function open(user: ReturnType<typeof userEvent.setup>, name: string) {
  await leave(user);
  await user.click(await screen.findByRole('link', { name }));
  await editorReady(name);
}

describe('caches after a publish (#237)', () => {
  it('re-runs no check of the unchanged open draft, and marks other loops’ checks stale', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('mine'));
    const view = renderApp(`/loops/${loop.id}/edit`, api);
    await editorReady('mine');
    await waitFor(() =>
      expect(api.callsTo('POST', `/loops/${loop.id}/validate`).length).toBeGreaterThan(0),
    );
    await tick(200);
    const checks = api.callsTo('POST', `/loops/${loop.id}/validate`).length;
    const own = checkKey(api, view.queryClient, loop.id);
    const ownAnswer = view.queryClient.getQueryData(own);
    expect(ownAnswer).toBeDefined();
    // Another loop's check, which can read this loop's published version as a subloop.
    const other = keys.validation('other-loop', 'its-draft', 'catalogs');
    view.queryClient.setQueryData(other, []);
    // Caches no publication changes: another loop's detail, and the catalog.
    const otherDetail = keys.loop('other-loop');
    view.queryClient.setQueryData(otherDetail, { loop: { id: 'other-loop' } });
    await user.click(screen.getByRole('button', { name: /^Publish/ }));
    expect(await screen.findByText(/^Published version \d+\.$/)).toBeInTheDocument();
    await tick(300);
    expect(api.callsTo('POST', `/loops/${loop.id}/validate`)).toHaveLength(checks);
    expect(view.queryClient.getQueryState(other)).toMatchObject({ data: [], isInvalidated: true });
    // The open draft's own check is the same key, still answered and fresh.
    expect(checkKey(api, view.queryClient, loop.id)).toEqual(own);
    expect(view.queryClient.getQueryState(own)).toMatchObject({
      data: ownAnswer,
      isInvalidated: false,
    });
    expect(view.queryClient.getQueryState(otherDetail)?.isInvalidated).toBe(false);
    expect(view.queryClient.getQueryState(keys.catalog)?.isInvalidated).toBe(false);
  });

  it('drops another loop’s check answered before the publish, and checks it again on reopening', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { target, parent, checks } = subloopLoops(api);
    api.addLoop(newLoopDefinition('unrelated'));
    const { queryClient } = renderApp(`/loops/${parent.id}/edit`, api);
    await editorReady('parent');
    await waitFor(() => expect(nodeBadge('sub')).toHaveAttribute('aria-label', '1 issue on sub'));
    const key = checkKey(api, queryClient, parent.id);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    // An unrelated publication marks the parent's warm answer stale for its next use.
    await open(user, 'unrelated');
    await user.click(screen.getByRole('button', { name: /^Publish/ }));
    expect(await screen.findByText(/^Published version \d+\.$/)).toBeInTheDocument();
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);

    // Publish the target with its request held before admission, and go back to the parent,
    // whose stale answer is checked again: that check reads the target before the publication.
    const admission = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      await admission.promise;
      return api.builtIn(call);
    });
    await open(user, 'target');
    await user.click(screen.getByRole('button', { name: /^Publish/ }));
    await waitFor(() => expect(api.callsTo('POST', `/loops/${target.id}/publish`)).toHaveLength(1));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const targetChecks = validations(api, target.id);
    checks.hold = gate();
    await open(user, 'parent');
    await waitFor(() => expect(checks.held).toBe(1));
    expect(queryClient.getQueryState(key)?.fetchStatus).toBe('fetching');
    admission.release();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(api.loops.get(target.id)?.current).toBeDefined();
    checks.hold.release();
    checks.hold = undefined;
    await tick();

    // That answer predates the publication: it never makes the key fresh.
    expect(queryClient.getQueryState(key)).toMatchObject({
      fetchStatus: 'idle',
      isInvalidated: true,
    });
    const before = validations(api, parent.id);
    await open(user, 'parent');
    await waitFor(() => expect(validations(api, parent.id)).toBe(before + 1));
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    expect(nodeBadge('sub')).toBeNull();
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    // The target's own unchanged check was not run again by its publication.
    expect(validations(api, target.id)).toBe(targetChecks);
  });

  it('drops another loop’s first check answered before the publish (nothing cached)', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { target, parent, checks } = subloopLoops(api);
    const admission = gate();
    api.override('POST /loops/:id/publish', async (call) => {
      await admission.promise;
      return api.builtIn(call);
    });
    const { queryClient } = renderApp(`/loops/${target.id}/edit`, api);
    await editorReady('target');
    await user.click(screen.getByRole('button', { name: /^Publish/ }));
    await waitFor(() => expect(api.callsTo('POST', `/loops/${target.id}/publish`)).toHaveLength(1));
    checks.hold = gate();
    await open(user, 'parent');
    const key = checkKey(api, queryClient, parent.id);
    await waitFor(() => expect(queryClient.getQueryState(key)?.fetchStatus).toBe('fetching'));
    expect(queryClient.getQueryState(key)?.data).toBeUndefined();
    admission.release();
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(api.loops.get(target.id)?.current).toBeDefined();
    checks.hold.release();
    checks.hold = undefined;
    await tick();

    expect(queryClient.getQueryState(key)).toMatchObject({ data: undefined, isInvalidated: true });
    expect(nodeBadge('sub')).toBeNull();
    expect(screen.queryByText('Ready to publish')).toBeNull();
    await open(user, 'parent');
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    expect(nodeBadge('sub')).toBeNull();
  });

  it('cancels a running check of another loop before marking it stale (installed query library)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = keys.validation('loop-b', 'draft-b', 'catalogs');
    const running = (answer: string[]) => {
      const late = gate();
      const fetched = queryClient
        .fetchQuery({
          queryKey: key,
          queryFn: async () => {
            await late.promise;
            return answer;
          },
          staleTime: 0,
        })
        .catch(() => undefined);
      return async () => {
        late.release();
        await fetched;
      };
    };
    // Control: in this query library, marking a running query stale does not outlast its answer.
    const plain = running(['before publication']);
    await queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
    await plain();
    expect(queryClient.getQueryState(key)).toMatchObject({
      data: ['before publication'],
      isInvalidated: false,
    });

    // After a publish of loop A, loop B's running check is dropped and B stays stale.
    queryClient.setQueryData(key, ['earlier']);
    const late = running(['before publication']);
    await refreshLoopAfterWrite(queryClient, 'loop-a', { published: true });
    await late();
    expect(queryClient.getQueryState(key)).toMatchObject({
      data: ['earlier'],
      isInvalidated: true,
      fetchStatus: 'idle',
    });
    // Loop A's own check, running or not, is not touched.
    const own = keys.validation('loop-a', 'draft-a', 'catalogs');
    queryClient.setQueryData(own, ['own']);
    await refreshLoopAfterWrite(queryClient, 'loop-a', { published: true });
    expect(queryClient.getQueryState(own)).toMatchObject({ data: ['own'], isInvalidated: false });
  });
});
