import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import * as drafts from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { useLoadEditor } from './useLoadEditor.js';
import { useAutosave } from './useAutosave.js';
import { keys } from '../api/queries.js';
import {
  deviceKeys,
  formatThreeDraft,
  storeRawDeviceRecord,
} from '../__fixtures__/device-drafts.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
  'times device rendering (warm=%s) and distinguishes late set-aside restoration from an autosave 409 (#171)',
  async (warm) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('device work'),
      savedAt: '2000-01-01T00:00:00.000Z',
      synced: false,
      baseToken: 'old-token',
    });
    const started = performance.now();
    const events: { event: string; ms: number }[] = [];
    const record = (event: string) =>
      events.push({ event, ms: Math.round(performance.now() - started) });
    const cached = drafts.cachedLocalDraft;
    vi.spyOn(drafts, 'cachedLocalDraft').mockImplementation((id) => {
      const copy = warm ? cached(id) : undefined;
      record(copy ? 'memory cache hit' : 'memory cache miss');
      return copy;
    });
    const server = deferred();
    api.override('GET /loops/:id', async (call) => {
      record('server request');
      await server.promise;
      record('server response');
      return api.builtIn(call);
    });
    const read = drafts.loadLocalDraft;
    vi.spyOn(drafts, 'loadLocalDraft').mockImplementation(async (id) => {
      record('device read started');
      const copy = await read(id);
      record('device read completed');
      return copy;
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.data) record('server query cached');
    });
    const client = createAppClient('http://graphgoblin.test', api.fetch);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={client}>{children}</ApiProvider>
      </QueryClientProvider>
    );
    const view = renderHook(
      () => {
        const loaded = useLoadEditor(loop.id);
        const definition = useEditorStore((s) => s.definition);
        useEffect(() => {
          if (loaded.ready && definition) record(`render ${definition.name}`);
        }, [loaded.ready, definition]);
        return loaded;
      },
      { wrapper },
    );
    await waitFor(() => expect(useEditorStore.getState().definition?.name).toBe('device work'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    const renderedBeforeServer = events.some((e) => e.event === 'render device work');
    await act(async () => {
      server.resolve();
      await server.promise;
    });
    await waitFor(() => expect(view.result.current.setAside?.definition.name).toBe('device work'));
    record('set-aside prompt (not 409)');
    console.warn('#171 ordering', JSON.stringify(events));
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    expect(useEditorStore.getState().conflict).toBeUndefined();
    expect(renderedBeforeServer).toBe(true);
    expect(events.findIndex((e) => e.event === 'device read started')).toBeLessThan(
      events.findIndex((e) => e.event === 'server response'),
    );
    view.unmount();
    queryClient.clear();
  },
);

const mounted: { unmount: () => void; queryClient: QueryClient }[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.unmount();
    view.queryClient.clear();
  }
  useEditorStore.getState().reset();
});

function mount(
  api: FakeApi,
  loopId: string,
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
      const loaded = useLoadEditor(loopId);
      const definition = useEditorStore((s) => s.definition);
      const flush = useAutosave(client, 20, {
        enabled: loaded.ready && !loaded.preservationBlocked && !loaded.unsupportedBlocked,
        deviceReady: loaded.deviceWritable,
        serverReconciled: loaded.serverReconciled,
      });
      return { ...loaded, definition, flush };
    },
    { wrapper },
  );
  mounted.push({ ...view, queryClient });
  return { ...view, queryClient };
}

function slowServer(api: FakeApi) {
  const server = deferred();
  api.override('GET /loops/:id', async (call) => {
    await server.promise;
    return api.builtIn(call);
  });
  return server;
}

it.each([false, true])(
  'gates saves, preserves edits and uses the loaded base token (synced=%s)',
  async (synced) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    const token = api.draftToken(loop.id)!;
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('device'),
      savedAt: '2999',
      synced,
      baseToken: token,
    });
    const server = slowServer(api);
    const view = mount(api, loop.id);
    await waitFor(() => expect(view.result.current.definition?.name).toBe('device'));
    act(() => useEditorStore.getState().updateMeta({ description: 'edited during read' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(await view.result.current.flush()).toBe(false);
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    expect((await drafts.loadLocalDraft(loop.id))?.definition.description).toBe(
      'edited during read',
    );
    act(() => {
      server.resolve();
    });
    await waitFor(() => expect(useEditorStore.getState().saveState).toBe('saved'));
    expect(useEditorStore.getState().definition?.description).toBe('edited during read');
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)[0]?.headers.get('if-match')).toBe(
      `"${token}"`,
    );
  },
);

it('replaces an untouched clean device cache with the server without autosaving it', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  await drafts.saveLocalDraft({
    loopId: loop.id,
    definition: newLoopDefinition('old cache'),
    savedAt: 'old',
    synced: true,
    baseToken: 'stale',
  });
  const server = slowServer(api);
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.definition?.name).toBe('old cache'));
  act(() => {
    server.resolve();
  });
  await waitFor(() => expect(view.result.current.definition?.name).toBe('server'));
  expect(useEditorStore.getState().conflict).toBeUndefined();
  expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
});

it('ignores a stale durable read in favour of the latest warm copy, scoped per loop', async () => {
  const api = new FakeApi();
  const a = api.addLoop(newLoopDefinition('A'));
  const b = api.addLoop(newLoopDefinition('B'));
  const stale = {
    loopId: a.id,
    definition: newLoopDefinition('stale A'),
    savedAt: '2999',
    synced: false,
    baseToken: api.draftToken(a.id)!,
  };
  await drafts.saveLocalDraft({ ...stale, definition: newLoopDefinition('latest A') });
  await drafts.saveLocalDraft({
    ...stale,
    loopId: b.id,
    definition: newLoopDefinition('latest B'),
    baseToken: api.draftToken(b.id)!,
  });
  vi.spyOn(drafts, 'loadLocalDraft').mockResolvedValue(stale);
  slowServer(api);
  const first = mount(api, a.id);
  await waitFor(() => expect(first.result.current.definition?.name).toBe('latest A'));
  first.unmount();
  const second = mount(api, b.id);
  await waitFor(() => expect(second.result.current.definition?.name).toBe('latest B'));
  second.unmount();
  const again = mount(api, a.id);
  await waitFor(() => expect(again.result.current.definition?.name).toBe('latest A'));
});

it.each([false, true])('late storage does not replace new edits (edited=%s)', async (edited) => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const storage = deferred();
  const local = {
    loopId: loop.id,
    definition: newLoopDefinition('late device'),
    savedAt: '2999',
    synced: false,
    baseToken: api.draftToken(loop.id)!,
  };
  vi.spyOn(drafts, 'loadLocalDraft').mockImplementation(async () => {
    await storage.promise;
    return local;
  });
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.definition?.name).toBe('server'));
  if (edited) act(() => useEditorStore.getState().updateMeta({ description: 'newer edit' }));
  act(() => {
    storage.resolve();
  });
  await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
  expect(useEditorStore.getState().definition?.name).toBe(edited ? 'server' : 'late device');
  if (edited) {
    expect(useEditorStore.getState().definition?.description).toBe('newer edit');
    expect((await drafts.loadSetAsideDraft(loop.id))?.definition.name).toBe('late device');
  }
});

it.each([0, Infinity])(
  'does not reconcile from a cached query while a fresh server read is pending (staleTime=%s)',
  async (staleTime) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime } },
    });
    const detail = await (
      await api.fetch(new Request(`http://graphgoblin.test/loops/${loop.id}`))
    ).json();
    queryClient.setQueryData(keys.loop(loop.id), detail);
    const server = slowServer(api);
    const view = mount(api, loop.id, queryClient);
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(view.result.current.serverReconciled).toBe(false);
    act(() => {
      server.resolve();
    });
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
  },
);

it.each([false, true])(
  'recovers offline device work and reconciles before saving (stale=%s)',
  async (stale) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('offline work'),
      savedAt: '2999',
      synced: false,
      baseToken: stale ? 'old-token' : api.draftToken(loop.id)!,
    });
    api.offline = true;
    const view = mount(api, loop.id);
    await waitFor(() => expect(view.result.current.query.isError).toBe(true));
    expect(view.result.current.definition?.name).toBe('offline work');
    expect(view.result.current.serverReconciled).toBe(false);
    expect(await view.result.current.flush()).toBe(false);
    api.offline = false;
    await act(async () => {
      await view.queryClient.refetchQueries({ queryKey: keys.loop(loop.id) });
    });
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
    if (stale) {
      expect(useEditorStore.getState().conflict).toBeDefined();
      expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
      expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('server');
    } else
      await waitFor(() =>
        expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('offline work'),
      );
  },
);

it('a failed storage read permits reconciliation and keeps device mirrors memory-only until retry', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  vi.spyOn(drafts, 'loadLocalDraft').mockRejectedValue(new Error('read failed'));
  const writes = vi.spyOn(drafts, 'saveLocalDraft');
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.deviceReadError).toBe('read failed'));
  await waitFor(() => expect(view.result.current.definition?.name).toBe('server'));
  expect(view.result.current.deviceInspected).toBe(true);
  expect(view.result.current.deviceWritable).toBe(false);
  await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
  act(() => useEditorStore.getState().updateMeta({ description: 'memory edit' }));
  expect(drafts.cachedLocalDraft(loop.id)).toMatchObject({
    durable: false,
    draft: { definition: { description: 'memory edit' } },
  });
  expect(useEditorStore.getState().deviceRevision).toBeUndefined();
  expect(writes).not.toHaveBeenCalled();
});

it('ignores a late response for an editor that has been replaced by another loop', async () => {
  const api = new FakeApi();
  const a = api.addLoop(newLoopDefinition('A'));
  const b = api.addLoop(newLoopDefinition('B'));
  const server = slowServer(api);
  const first = mount(api, a.id);
  first.unmount();
  const second = mount(api, b.id);
  act(() => {
    server.resolve();
  });
  await waitFor(() => expect(second.result.current.definition?.name).toBe('B'));
  expect(useEditorStore.getState().loopId).toBe(b.id);
});

it.each(['restore', 'discard'] as const)(
  'retains a set-aside backup when %s fails, and succeeds on retry',
  async (action) => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server'));
    const copy = {
      loopId: loop.id,
      definition: newLoopDefinition('backup'),
      savedAt: '2000',
      synced: false,
      baseToken: 'old',
    };
    await drafts.saveSetAsideDraft(copy);
    const view = mount(api, loop.id);
    await waitFor(() => expect(view.result.current.setAside?.definition.name).toBe('backup'));
    await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
    const failure =
      action === 'restore'
        ? vi.spyOn(drafts, 'saveLocalDraft').mockRejectedValueOnce(new Error('quota'))
        : vi.spyOn(drafts, 'clearSetAsideDraft').mockRejectedValueOnce(new Error('quota'));
    await act(async () => {
      if (action === 'restore') await view.result.current.restoreSetAside();
      else await view.result.current.discardSetAside();
    });
    expect(view.result.current.recoveryError).toContain('retained');
    expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(copy);
    expect(useEditorStore.getState().definition?.name).toBe('server');
    failure.mockRestore();
    await act(async () => {
      if (action === 'restore') await view.result.current.restoreSetAside();
      else await view.result.current.discardSetAside();
    });
    expect(await drafts.loadSetAsideDraft(loop.id)).toBeUndefined();
    expect(useEditorStore.getState().definition?.name).toBe(
      action === 'restore' ? 'backup' : 'server',
    );
  },
);

it('does not reset held field input when a late server cache is reconciled', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  await drafts.saveLocalDraft({
    loopId: loop.id,
    definition: newLoopDefinition('cached'),
    savedAt: 'old',
    synced: true,
    baseToken: 'stale',
  });
  const server = slowServer(api);
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.definition?.name).toBe('cached'));
  act(() =>
    useEditorStore.setState({
      fieldErrors: { settings: { raw: { message: 'Incomplete', text: '{' } } },
    }),
  );
  act(() => server.resolve());
  await waitFor(() => expect(view.result.current.serverReconciled).toBe(true));
  expect(useEditorStore.getState().fieldErrors).toHaveProperty('settings.raw');
  expect(useEditorStore.getState().definition?.name).toBe('cached');
  expect(useEditorStore.getState().conflict).toBeDefined();
  expect(useEditorStore.getState().revision).not.toBe(useEditorStore.getState().savedRevision);
  // The explicit overwrite uses the fresh token even though only held text changed.
  act(() => {
    const state = useEditorStore.getState();
    state.setBaseToken(state.conflict?.serverToken);
    state.setConflict(undefined);
  });
  await act(async () => {
    await view.result.current.flush();
  });
  expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('cached');
});

it('a late unsupported device draft pauses device writes, is neither converted nor replaced, and only a discard resumes', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const original = formatThreeDraft(loop.id, 'legacy device', '2999-01-01T00:00:00.000Z');
  await storeRawDeviceRecord(deviceKeys(loop.id).active, original);
  const storage = deferred();
  const read = drafts.loadLocalDraft;
  vi.spyOn(drafts, 'loadLocalDraft').mockImplementation(async (id) => {
    await storage.promise;
    return read(id);
  });
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.definition?.name).toBe('server'));
  act(() => useEditorStore.getState().updateMeta({ description: 'new current work' }));
  act(() => storage.resolve());
  await waitFor(() => expect(view.result.current.unsupportedBlocked).toBe(true));
  expect(view.result.current.unsupportedCopies).toEqual([{ ...original, source: 'active' }]);
  expect(view.result.current.deviceWritable).toBe(false);
  await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
  expect(await read(loop.id)).toEqual(original);
  expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);
  expect(await drafts.loadSetAsideDraft(loop.id)).toBeUndefined();
  expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
  expect(view.result.current.definition?.description).toBe('new current work');

  await act(() => view.result.current.discardDeviceCopy(view.result.current.unsupportedCopies[0]!));
  await waitFor(() => expect(view.result.current.unsupportedBlocked).toBe(false));
  await waitFor(() => expect(view.result.current.deviceWritable).toBe(true));
  expect(view.result.current.unsupportedCopies).toEqual([]);
  expect(view.result.current.definition?.description).toBe('new current work');
  const stored = await read(loop.id);
  expect(stored === undefined || drafts.isCurrentDeviceDraft(stored)).toBe(true);
});

it('blocks mirror replacement when a late device recovery copy cannot be preserved', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const copy = {
    loopId: loop.id,
    definition: newLoopDefinition('old device'),
    savedAt: '2999',
    synced: false,
    baseToken: api.draftToken(loop.id)!,
  };
  await drafts.saveLocalDraft(copy);
  vi.spyOn(drafts, 'cachedLocalDraft').mockReturnValueOnce(undefined);
  const storage = deferred();
  const read = drafts.loadLocalDraft;
  vi.spyOn(drafts, 'loadLocalDraft').mockImplementation(async (id) => {
    await storage.promise;
    return read(id);
  });
  vi.spyOn(drafts, 'saveSetAsideDraft').mockRejectedValue(new Error('quota'));
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.definition?.name).toBe('server'));
  act(() => useEditorStore.getState().updateMeta({ description: 'new work' }));
  act(() => storage.resolve());
  await waitFor(() => expect(view.result.current.preservationBlocked).toBe(true));
  expect(view.result.current.definition?.description).toBe('new work');
  expect(await read(loop.id)).toEqual(copy);
  expect(drafts.cachedLocalDraft(loop.id)?.draft.definition.description).toBe('new work');
  expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
});

it('keeps a different durable copy discovered behind a stale warm cache as explicit recovery work', async () => {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('server'));
  const warm = {
    loopId: loop.id,
    definition: newLoopDefinition('warm work'),
    savedAt: '2998',
    synced: false,
    baseToken: api.draftToken(loop.id)!,
  };
  await drafts.saveLocalDraft(warm);
  const durable = { ...warm, definition: newLoopDefinition('another window'), savedAt: '2999' };
  vi.spyOn(drafts, 'loadLocalDraft').mockResolvedValue(durable);
  slowServer(api);
  const view = mount(api, loop.id);
  await waitFor(() => expect(view.result.current.deviceWritable).toBe(true));
  expect(view.result.current.definition?.name).toBe('warm work');
  expect(view.result.current.setAsideIsLate).toBe(true);
  expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(durable);
  act(() => useEditorStore.getState().updateMeta({ description: 'continued warm work' }));
  expect(drafts.cachedLocalDraft(loop.id)?.draft.definition.description).toBe(
    'continued warm work',
  );
  expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(durable);
});
