import { loops } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import { keys } from '../api/queries.js';
import * as drafts from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { useAutosave } from './useAutosave.js';
import { useLoadEditor } from './useLoadEditor.js';

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const mounted: { unmount: () => void; queryClient: QueryClient }[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.unmount();
    view.queryClient.clear();
  }
  useEditorStore.getState().reset();
  vi.restoreAllMocks();
});
function mount(
  api: FakeApi,
  loopId: string,
  autosave = false,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const client = createAppClient('http://graphgoblin.test', api.fetch);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={client}>{children}</ApiProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const load = useLoadEditor(loopId);
      const definition = useEditorStore((s) => s.definition);
      const flush = useAutosave(client, 20, {
        enabled: autosave && load.ready && !load.preservationBlocked && !load.conversionLoadFailed,
        deviceReady: load.deviceWritable,
        serverReconciled: load.serverReconciled,
      });
      return { ...load, definition, flush };
    },
    { wrapper },
  );
  mounted.push({ ...view, queryClient });
  return { ...view, queryClient, client };
}

it('F1: failed warm refetch keeps stale data in error state and reconciles only after later success', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('old server'));
  const client = createAppClient('http://graphgoblin.test', api.fetch);
  const stale = await loops.get(client, loop.id);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(keys.loop(loop.id), stale);
  await drafts.saveLocalDraft({
    loopId: loop.id,
    definition: newLoopDefinition('warm work'),
    savedAt: '2000',
    synced: false,
    baseToken: stale.draftToken!,
  });
  api.offline = true;
  const view = mount(api, loop.id, false, queryClient);
  await waitFor(() => expect(view.result.current.query.isError).toBe(true));
  expect(view.result.current.query.isSuccess).toBe(false);
  expect(view.result.current.query.isFetchedAfterMount).toBe(true);
  expect(view.result.current.query.data).toEqual(stale);
  expect(view.result.current.serverReconciled).toBe(false);
  expect(view.result.current.definition?.name).toBe('warm work');
  act(() =>
    useEditorStore.getState().updateMeta({ description: 'edited after the failed refetch' }),
  );
  api.offline = false;
  api.saveDraftElsewhere(loop.id, newLoopDefinition('newer server'));
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: keys.loop(loop.id) });
  });
  await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
  expect(view.result.current.query.data?.draft?.definition.name).toBe('newer server');
  expect(view.result.current.definition).toMatchObject({
    name: 'warm work',
    description: 'edited after the failed refetch',
  });
  expect(useEditorStore.getState().conflict?.serverToken).toBe(api.draftToken(loop.id));
  expect(view.result.current.setAside?.definition.name).toBe('warm work');
  expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
});

it.each([false, true])(
  'F2: previous editor save finishes before reconciliation without spurious prompts (new edits=%s)',
  async (edited) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    const client = createAppClient('http://graphgoblin.test', api.fetch);
    const work = newLoopDefinition('previous editor work');
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition: work,
      savedAt: '2000',
      synced: false,
      baseToken: api.draftToken(loop.id)!,
    });
    const saving = gate();
    const reading = gate();
    api.override('PUT /loops/:id/draft', async (call) => {
      await saving.promise;
      return api.builtIn(call);
    });
    api.override('GET /loops/:id', async (call) => {
      await reading.promise;
      return api.builtIn(call);
    });
    const initialToken = api.draftToken(loop.id);
    const previousSave = loops
      .saveDraft(client, loop.id, work, { ifMatch: api.draftToken(loop.id)! })
      .then(async (accepted) => {
        await drafts.recordServerSave(loop.id, work, accepted.draftToken, initialToken);
        return accepted.draftToken;
      });
    const view = mount(api, loop.id);
    await waitFor(() => expect(view.result.current.deviceWritable).toBe(true));
    expect(view.result.current.definition?.name).toBe('previous editor work');
    if (edited) {
      act(() =>
        useEditorStore.getState().updateMeta({ description: 'new work in reopened editor' }),
      );
      await drafts.saveLocalDraft({
        loopId: loop.id,
        definition: useEditorStore.getState().definition!,
        savedAt: '2001',
        synced: false,
        baseToken: useEditorStore.getState().baseToken!,
      });
    }
    let acceptedToken = '';
    await act(async () => {
      saving.release();
      acceptedToken = await previousSave;
    });
    expect(view.result.current.serverReconciled).toBe(false);
    expect(drafts.cachedLocalDraft(loop.id)?.draft.baseToken).toBe(acceptedToken);
    await act(async () => {
      reading.release();
      await reading.promise;
    });
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
    expect(view.result.current.setAside).toBeUndefined();
    expect(useEditorStore.getState().conflict).toBeUndefined();
    expect(useEditorStore.getState().baseToken).toBe(acceptedToken);
    if (edited)
      expect(view.result.current.definition?.description).toBe('new work in reopened editor');
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1);
    if (edited) {
      expect((await drafts.loadLocalDraft(loop.id))?.baseToken).toBe(acceptedToken);
      view.unmount();
      const reopened = mount(api, loop.id);
      await waitFor(() => expect(reopened.result.current.serverReconciled).toBe(true));
      expect(reopened.result.current.definition?.description).toBe('new work in reopened editor');
      expect(useEditorStore.getState().baseToken).toBe(acceptedToken);
      expect(useEditorStore.getState().conflict).toBeUndefined();
      expect(reopened.result.current.setAside).toBeUndefined();
    }
  },
);

it.each(['autosave', 'flush', 'navigation'] as const)(
  'F4: permanently unavailable IndexedDB permits server %s without durable mirrors',
  async (savePath) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new Error('Device storage unavailable');
    });
    const mirrors = vi.spyOn(drafts, 'saveLocalDraft');
    const view = mount(api, loop.id, true);
    await waitFor(() =>
      expect(view.result.current.deviceReadError).toBe('Device storage unavailable'),
    );
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
    expect(view.result.current.deviceInspected).toBe(true);
    expect(view.result.current.deviceWritable).toBe(false);
    act(() => useEditorStore.getState().updateMeta({ description: savePath }));
    if (savePath === 'flush') {
      await act(async () => expect(await view.result.current.flush()).toBe(true));
    } else if (savePath === 'navigation') view.unmount();
    await waitFor(() =>
      expect(api.loops.get(loop.id)?.draft?.definition.description).toBe(savePath),
    );
    await waitFor(() => expect(drafts.cachedLocalDraft(loop.id)?.draft.synced).toBe(true));
    expect(drafts.cachedLocalDraft(loop.id)?.durable).toBe(false);
    expect(mirrors).not.toHaveBeenCalled();
    if (savePath !== 'navigation') {
      expect(useEditorStore.getState().deviceRevision).toBeUndefined();
      expect(useEditorStore.getState().saveState).toBe('saved');
      const attempts = transactions.mock.calls.length;
      act(() => view.result.current.retryDeviceRead());
      await waitFor(() =>
        expect(view.result.current.deviceReadError).toBe('Device storage unavailable'),
      );
      expect(transactions.mock.calls.length).toBeGreaterThan(attempts);
      expect(view.result.current.serverReconciled).toBe(true);
      expect(view.result.current.deviceWritable).toBe(false);
      expect(view.result.current.definition?.description).toBe(savePath);
    }
    transactions.mockRestore();
    expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
  },
);

it('F4: permanently unavailable IndexedDB keeps its warning and Retry while server autosave works', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
    throw new Error('Device storage unavailable');
  });
  const mirrors = vi.spyOn(drafts, 'saveLocalDraft');
  const view = renderApp(`/loops/${loop.id}/edit`, api);
  mounted.push(view);
  await screen.findByText('Device drafts could not be read');
  act(() => useEditorStore.getState().updateMeta({ description: 'server work without IndexedDB' }));
  await waitFor(() => expect(useEditorStore.getState().saveState).toBe('saved'), { timeout: 3000 });
  expect(api.loops.get(loop.id)?.draft?.definition.description).toBe(
    'server work without IndexedDB',
  );
  expect(
    screen.getByText(/Changes are saved to the server; this window keeps a copy only in memory/),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Retry device read' }));
  await screen.findByText('Device drafts could not be read');
  expect(screen.getByRole('button', { name: 'Retry device read' })).toBeVisible();
  expect(drafts.cachedLocalDraft(loop.id)?.durable).toBe(false);
  expect(useEditorStore.getState().deviceRevision).toBeUndefined();
  expect(mirrors).not.toHaveBeenCalled();
});

it('F4: a transient active-read failure keeps mirrors memory-only and preserves unread device work', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const unread = {
    loopId: loop.id,
    definition: newLoopDefinition('unread unsynced work'),
    savedAt: '2999',
    synced: false,
    baseToken: 'older-token',
  };
  await drafts.saveLocalDraft(unread);
  vi.spyOn(drafts, 'cachedLocalDraft').mockReturnValueOnce(undefined);
  const get = IDBObjectStore.prototype.get;
  let failed = false;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (key === loop.id && !failed) {
      failed = true;
      throw new Error('transient active read failure');
    }
    return get.call(this, key);
  });
  const view = mount(api, loop.id, true);
  await waitFor(() => expect(failed).toBe(true));
  await waitFor(() => expect(view.result.current.definition?.name).toBe('server'));
  act(() => useEditorStore.getState().updateMeta({ description: 'new work in memory' }));
  await waitFor(() =>
    expect(api.loops.get(loop.id)?.draft?.definition.description).toBe('new work in memory'),
  );
  expect(await drafts.loadLocalDraft(loop.id)).toEqual(unread);
  expect(drafts.cachedLocalDraft(loop.id)).toMatchObject({
    durable: false,
    draft: { definition: { description: 'new work in memory' } },
  });
  expect(useEditorStore.getState().deviceRevision).toBeUndefined();
  expect(view.result.current.deviceInspected).toBe(true);
  expect(view.result.current.deviceWritable).toBe(false);
  expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1);
  const generation = useEditorStore.getState().generation;
  act(() => view.result.current.retryDeviceRead());
  await waitFor(() => expect(view.result.current.deviceReadError).toBeUndefined());
  await waitFor(() => expect(view.result.current.setAside?.definition).toEqual(unread.definition));
  expect(view.result.current.setAsideIsLate).toBe(true);
  expect(view.result.current.deviceWritable).toBe(true);
  expect(useEditorStore.getState().generation).toBe(generation);
  expect(view.result.current.definition?.description).toBe('new work in memory');
  act(() => useEditorStore.getState().updateMeta({ description: 'durable work after retry' }));
  await waitFor(() =>
    expect(useEditorStore.getState().deviceRevision).toBe(useEditorStore.getState().revision),
  );
  expect((await drafts.loadSetAsideDraft(loop.id))?.definition).toEqual(unread.definition);
  await waitFor(() =>
    expect(api.loops.get(loop.id)?.draft?.definition.description).toBe('durable work after retry'),
  );
});

it('F5: a current-format set-aside backup reopens with a backup label, not an unconverted-original label', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const oldest = {
    loopId: loop.id,
    definition: newLoopDefinition('earlier set-aside'),
    savedAt: '1900',
    synced: false,
  };
  const active = { ...oldest, definition: newLoopDefinition('active work'), savedAt: '2000' };
  const legacy = {
    ...oldest,
    definition: { ...oldest.definition, schemaVersion: 3 } as unknown as LoopDefinitionInput,
    savedAt: '1800',
  };
  await drafts.saveSetAsideDraft(oldest);
  await drafts.saveLocalDraft(active);
  await drafts.saveArchivedDraft(legacy);
  const first = renderApp(`/loops/${loop.id}/edit`, api);
  mounted.push(first);
  await screen.findByRole('heading', { name: 'server' });
  await waitFor(async () =>
    expect(await drafts.loadArchivedDrafts(loop.id)).toContainEqual(oldest),
  );
  first.unmount();
  const reopened = renderApp(`/loops/${loop.id}/edit`, api);
  mounted.push(reopened);
  expect((await screen.findAllByText('Saved device backup')).length).toBeGreaterThan(0);
  expect(screen.getByText('Original device copy preserved')).toBeVisible();
  expect(
    (await drafts.loadArchivedDrafts(loop.id)).find((copy) => copy.savedAt === oldest.savedAt),
  ).toEqual(oldest);
  expect(
    (await screen.findAllByRole('button', { name: 'Export device backup' })).length,
  ).toBeGreaterThan(0);
});

it.each([false, true])(
  'F6: a server loop with no definition finishes checking (device work=%s)',
  async (device) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('empty'), { draft: false, published: false });
    if (device)
      await drafts.saveLocalDraft({
        loopId: loop.id,
        definition: newLoopDefinition('device only'),
        savedAt: '2999',
        synced: false,
      });
    const view = mount(api, loop.id);
    await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
    expect(view.result.current.ready).toBe(true);
    expect(view.result.current.definition?.name).toBe(device ? 'device only' : undefined);
  },
);

it('F4: read failure stays visible after other storage succeeds, and retry preserves edits and held input', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const unread = {
    loopId: loop.id,
    definition: newLoopDefinition('unread work'),
    savedAt: '2000',
    synced: false,
    baseToken: 'old',
  };
  await drafts.saveLocalDraft(unread);
  vi.spyOn(drafts, 'cachedLocalDraft').mockReturnValueOnce(undefined);
  const get = IDBObjectStore.prototype.get;
  let failed = false;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (key === loop.id && !failed) {
      failed = true;
      throw new Error('transient read failure');
    }
    return get.call(this, key);
  });
  const view = renderApp(`/loops/${loop.id}/edit`, api);
  mounted.push(view);
  await screen.findByText('Device drafts could not be read');
  await drafts.loadSetAsideDraft(loop.id);
  expect(drafts.deviceStorageProblem()).toBeUndefined();
  expect(screen.getByText('Device drafts could not be read')).toBeVisible();
  const generation = useEditorStore.getState().generation;
  act(() => {
    useEditorStore.getState().updateMeta({ description: 'typed before retry' });
    useEditorStore.setState({
      fieldErrors: { settings: { json: { text: '{', message: 'Incomplete JSON' } } },
    });
  });
  await userEvent.click(screen.getByRole('button', { name: 'Retry device read' }));
  await waitFor(() => expect(screen.queryByText('Device drafts could not be read')).toBeNull());
  await waitFor(async () => expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(unread));
  expect(useEditorStore.getState().generation).toBe(generation);
  expect(useEditorStore.getState().definition?.description).toBe('typed before retry');
  expect(useEditorStore.getState().fieldErrors.settings?.json?.text).toBe('{');
});

it.each([
  ['autosave', false],
  ['navigation', false],
  ['autosave', true],
  ['navigation', true],
] as const)(
  'second review F1: failed-read %s preserves unread work and requires a choice on reopening (same base=%s)',
  async (savePath, sameBase) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    const unread = {
      loopId: loop.id,
      definition: newLoopDefinition('unread earlier-session work'),
      savedAt: '2999',
      synced: false,
      baseToken: sameBase ? api.draftToken(loop.id)! : 'earlier-session-token',
    };
    await drafts.saveLocalDraft(unread);
    // A fresh window has no memory cache, including on reopening after the server save.
    vi.spyOn(drafts, 'cachedLocalDraft').mockReturnValue(undefined);
    const recording = vi.spyOn(drafts, 'recordServerSave');
    const saveBase = api.draftToken(loop.id);
    const get = IDBObjectStore.prototype.get;
    let failed = false;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      if (key === loop.id && !failed) {
        failed = true;
        throw new Error('transient device read failure');
      }
      return get.call(this, key);
    });
    const first = mount(api, loop.id, true);
    await waitFor(() => expect(first.result.current.serverReconciled).toBe(true));
    expect(first.result.current.deviceWritable).toBe(false);
    act(() => useEditorStore.getState().updateMeta({ description: 'new server work' }));
    if (savePath === 'navigation') first.unmount();
    await waitFor(() => expect(recording).toHaveBeenCalledOnce());
    await act(async () => {
      await recording.mock.results[0]!.value;
    });
    expect(api.loops.get(loop.id)?.draft?.definition.description).toBe('new server work');
    expect(recording).toHaveBeenCalledWith(
      loop.id,
      expect.objectContaining({ description: 'new server work' }),
      api.draftToken(loop.id),
      saveBase,
    );
    expect(await drafts.loadLocalDraft(loop.id)).toEqual(unread);
    first.unmount();
    const reading = gate();
    api.override('GET /loops/:id', async (call) => {
      await reading.promise;
      return api.builtIn(call);
    });
    const reopened = mount(api, loop.id, true);
    await waitFor(() =>
      expect(reopened.result.current.definition?.name).toBe(unread.definition.name),
    );
    act(reading.release);
    await waitFor(() => expect(reopened.result.current.serverReconciled).toBe(true));
    expect(useEditorStore.getState().conflict?.serverToken).toBe(api.draftToken(loop.id));
    expect(useEditorStore.getState().baseToken).toBe(unread.baseToken);
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1);
    expect(api.loops.get(loop.id)?.draft?.definition.description).toBe('new server work');
  },
);

it.each([true, false])(
  're-review F2: absent tokens leave the timestamp comparison in control (server newer=%s)',
  async (serverNewer) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('published server'), {
      published: true,
      draft: false,
    });
    api.override('GET /loops/:id', async (call) => {
      const response = await api.builtIn(call);
      const detail = (await response.json()) as Record<string, unknown>;
      delete detail['draftToken'];
      return new Response(JSON.stringify(detail), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const local = {
      loopId: loop.id,
      definition: newLoopDefinition('device without a base'),
      savedAt: serverNewer ? '2000' : '2999',
      synced: false,
    };
    await drafts.saveLocalDraft(local);
    const view = mount(api, loop.id);
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
    expect(view.result.current.definition?.name).toBe(
      serverNewer ? 'published server' : local.definition.name,
    );
    expect(view.result.current.setAside).toEqual(serverNewer ? local : undefined);
    expect(useEditorStore.getState().conflict).toBeUndefined();
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
  },
);
