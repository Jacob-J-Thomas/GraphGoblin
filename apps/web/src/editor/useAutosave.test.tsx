import { loops } from '@graphgoblin/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import { keys, useLoop } from '../api/queries.js';
import { clearLocalDraft, loadLocalDraft } from '../drafts/local-drafts.js';
import { startReachability, useReachability } from '../lib/reachability.js';
import type * as Reachability from '../lib/reachability.js';
import { isOfflineError } from '../lib/utils.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';
import { useAutosave } from './useAutosave.js';

const recoveryListeners = vi.hoisted(() => new Set<() => void>());
vi.mock('../lib/reachability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Reachability>();
  return {
    ...actual,
    subscribeApiRecovery: (listener: () => void) => {
      recoveryListeners.add(listener);
      const unsubscribe = actual.subscribeApiRecovery(listener);
      return () => {
        recoveryListeners.delete(listener);
        unsubscribe();
      };
    },
  };
});

const queryClients: QueryClient[] = [];
const loopIds: string[] = [];

async function mountAutosave() {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const api = new FakeApi();
  const definition = newLoopDefinition('draft recovery');
  const loop = api.addLoop(definition);
  loopIds.push(loop.id);
  const token = api.draftToken(loop.id)!;
  const fetch = vi.fn(api.fetch);
  const requests = (method: string) =>
    fetch.mock.calls.map(([request]) => request).filter((request) => request.method === method);
  const client = createAppClient('http://graphgoblin.test', fetch);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0, staleTime: Infinity } },
  });
  queryClients.push(queryClient);
  queryClient.setQueryData(keys.loop(loop.id), await loops.get(client, loop.id));
  useEditorStore.getState().load(loop.id, definition, { baseToken: token });
  const view = renderHook(
    () => {
      useLoop(loop.id); // The loaded editor's active read, without mounting its other components.
      return useAutosave(client, 60_000);
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ApiProvider client={client}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ApiProvider>
      ),
    },
  );
  return { ...view, api, loop, token, queryClient, requests, client };
}

function notifyRecovery() {
  for (const listener of recoveryListeners) listener();
}

async function failSave(view: Awaited<ReturnType<typeof mountAutosave>>) {
  view.api.offline = true;
  act(() => useEditorStore.getState().updateMeta({ description: 'kept while unreachable' }));
  await act(async () => {
    expect(await view.result.current()).toBe(false);
  });
  await waitFor(() =>
    expect(isOfflineError(view.queryClient.getQueryState(keys.loop(view.loop.id))?.error)).toBe(
      true,
    ),
  );
  expect(useEditorStore.getState().saveState).toBe('offline');
  expect(useReachability.getState().apiReachable).toBe(false);
  expect(navigator.onLine).toBe(true);
  expect(view.requests('PUT')).toHaveLength(1);
  await waitFor(async () =>
    expect(await loadLocalDraft(view.loop.id)).toMatchObject({
      synced: false,
      definition: { description: 'kept while unreachable' },
      baseToken: view.token,
    }),
  );
}

afterEach(async () => {
  cleanup();
  expect(recoveryListeners.size).toBe(0);
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  for (const loopId of loopIds.splice(0)) await clearLocalDraft(loopId);
  useEditorStore.getState().reset();
  useReachability.setState({ apiReachable: true });
  vi.restoreAllMocks();
});

describe('autosave on API recovery', () => {
  it.each(['offline', 'error'] as const)(
    'saves a pending %s draft with If-Match on the recovery notification',
    async (saveState) => {
      const view = await mountAutosave();
      await failSave(view);
      const reads = view.requests('GET').length;
      await act(async () => {
        await view.result.current();
      });
      expect(view.requests('GET')).toHaveLength(reads);
      // Both current and older error-state drafts use the same recovery path.
      act(() => useEditorStore.getState().setSaveState(saveState));
      view.api.offline = false;
      act(notifyRecovery);
      await waitFor(() => expect(useEditorStore.getState().saveState).toBe('saved'));
      const saved = view.api.callsTo('PUT', `/loops/${view.loop.id}/draft`).at(-1)!;
      expect(saved.headers.get('if-match')).toBe(`"${view.token}"`);
      expect(saved.body).toMatchObject({ definition: { description: 'kept while unreachable' } });
      expect(useEditorStore.getState().baseToken).toBe(view.api.draftToken(view.loop.id));
      expect(await loadLocalDraft(view.loop.id)).toMatchObject({ synced: true });
    },
  );

  it('stops on a 409 from the recovery retry and keeps the device draft and its base token', async () => {
    const view = await mountAutosave();
    await failSave(view);
    view.api.offline = false;
    view.api.saveDraftElsewhere(view.loop.id, {
      ...newLoopDefinition('changed elsewhere'),
      description: 'theirs',
    });
    act(notifyRecovery);
    await waitFor(() => expect(useEditorStore.getState().saveState).toBe('conflict'));
    expect(useEditorStore.getState().conflict).toEqual({
      serverToken: view.api.draftToken(view.loop.id),
    });
    expect(useEditorStore.getState().baseToken).toBe(view.token);
    expect(useEditorStore.getState().definition?.description).toBe('kept while unreachable');
    expect(view.requests('PUT')[1]?.headers.get('if-match')).toBe(`"${view.token}"`);
    await act(async () => {
      notifyRecovery();
      window.dispatchEvent(new Event('online'));
      expect(await view.result.current()).toBe(false);
    });
    expect(view.requests('PUT')).toHaveLength(2);
    view.unmount();
    expect(await loadLocalDraft(view.loop.id)).toMatchObject({
      synced: false,
      baseToken: view.token,
    });
    expect(view.requests('PUT')).toHaveLength(2);
  });

  it('serializes repeated recovery notifications and the browser event into one save', async () => {
    const view = await mountAutosave();
    await failSave(view);
    view.api.offline = false;
    let finish!: (response: Response) => void;
    view.api.override(
      'PUT /loops/:id/draft',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    act(notifyRecovery);
    await waitFor(() => expect(view.requests('PUT')).toHaveLength(2));
    act(() => {
      notifyRecovery();
      notifyRecovery();
      window.dispatchEvent(new Event('online'));
    });
    expect(view.requests('PUT')).toHaveLength(2);
    finish(
      new Response(JSON.stringify({ draftToken: 'saved-token', issues: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await waitFor(() => expect(useEditorStore.getState().saveState).toBe('saved'));
    await act(async () => {
      await view.result.current();
    });
    expect(view.requests('PUT')).toHaveLength(2);
  });

  it('does not land a recovered save in a later generation of the same editor', async () => {
    const view = await mountAutosave();
    await failSave(view);
    view.api.offline = false;
    let finish!: (response: Response) => void;
    view.api.override(
      'PUT /loops/:id/draft',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    act(notifyRecovery);
    await waitFor(() => expect(view.requests('PUT')).toHaveLength(2));
    const generation = useEditorStore.getState().generation;
    act(() =>
      useEditorStore
        .getState()
        .load(view.loop.id, newLoopDefinition('later generation'), { baseToken: 'later-token' }),
    );
    finish(
      new Response(JSON.stringify({ draftToken: 'old-save-token', issues: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await act(async () => {
      await view.result.current();
    });
    expect(useEditorStore.getState()).toMatchObject({
      generation: generation + 1,
      definition: { name: 'later generation' },
      baseToken: 'later-token',
      revision: 0,
      savedRevision: 0,
      saveState: 'saved',
    });
  });

  it('does not loop recovery reads and saves when GET succeeds but PUT keeps failing', async () => {
    const view = await mountAutosave();
    const stop = startReachability(view.queryClient, view.client);
    try {
      view.api.override('PUT /loops/:id/draft', () => {
        throw new TypeError('Failed to fetch');
      });
      act(() => useEditorStore.getState().updateMeta({ description: 'kept on this device' }));
      await act(async () => {
        expect(await view.result.current()).toBe(false);
      });
      // The real reachability signal fires on the successful recovery read. One retry is enough:
      // another failed PUT cannot continually refetch a healthy read for the same revision.
      await act(async () => {
        expect(await view.result.current()).toBe(false);
      });
      expect(view.requests('PUT')).toHaveLength(3); // Initial save, recovery, explicit flush.
      expect(view.requests('GET')).toHaveLength(2); // Load and the one recovery read.
      expect(useReachability.getState().apiReachable).toBe(true);
      expect(useEditorStore.getState().saveState).toBe('offline');
      expect(await loadLocalDraft(view.loop.id)).toMatchObject({ synced: false });
    } finally {
      stop();
    }
  });

  it('unsubscribes on unmount so later recovery cannot retry its offline draft', async () => {
    const view = await mountAutosave();
    await failSave(view);
    view.unmount();
    view.api.offline = false;
    act(notifyRecovery);
    expect(view.requests('PUT')).toHaveLength(1);
    expect(recoveryListeners.size).toBe(0);
    expect(await loadLocalDraft(view.loop.id)).toMatchObject({ synced: false });
  });
});
