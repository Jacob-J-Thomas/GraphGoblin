import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { onlineManager, QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { keys, useRun } from '../api/queries.js';
import { createQueryClient, Providers } from '../app/bootstrap.js';
import {
  getInspectorRead,
  markInspectorReadLoss,
  markInspectorTransportLoss,
  trackInspectorRead,
  useInspectorRead,
} from './inspector-read-provenance.js';
import { RunHeaderRegistry, useRunHeaderRegistry } from './run-header-store.js';

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function mountRun(api: FakeApi, id: string) {
  const cache = queryClient();
  const client = createAppClient('http://test', api.fetch);
  return renderHook(
    () => {
      const owner = useRunHeaderRegistry()!;
      const run = useRun(id);
      return { run, status: run.status, read: useInspectorRead(owner, keys.run(id)), owner };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(Providers, { client, queryClient: cache, children }),
    },
  );
}

function owner(cache = queryClient(), api = new FakeApi()) {
  return new RunHeaderRegistry({
    client: createAppClient('http://test', api.fetch),
    queryClient: cache,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const run = keys.run('one');
const observation = keys.observation('one');
const evidence = { id: 'one', result: 'observed' };
const offline = () => GraphGoblinApiError.network(new TypeError('listener stopped'));

function read(source: RunHeaderRegistry, key: QueryKey, request = () => Promise.resolve(evidence)) {
  return source.source.queryClient.fetchQuery({
    queryKey: key,
    queryFn: (ctx) => trackInspectorRead(source, ctx, request, (row) => row.id === 'one'),
  });
}

afterEach(() => {
  cleanup();
  useApiKeyStore.setState({ rejected: false });
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('full inspector reads', () => {
  it('publishes identical real run commits independently of their body, header position and timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const api = new FakeApi();
    const row = api.addRun({ status: 'running', result: 'observed' });
    const view = mountRun(api, row.id);
    await waitFor(() => expect(view.result.current.read.committed).toBeGreaterThan(0));
    const before = view.result.current;
    const loss = markInspectorReadLoss();
    await act(async () => {
      await view.result.current.run.refetch();
    });
    expect(view.result.current.run.data).toBe(before.run.data);
    expect(view.result.current.run.dataUpdatedAt).toBe(before.run.dataUpdatedAt);
    expect(view.result.current.read.committed).toBeGreaterThan(loss);
    expect(before.read.committed).toBeLessThan(loss);
    act(() => {
      before.owner.source.queryClient.setQueryData(keys.run(row.id), before.run.data);
    });
    expect(view.result.current.run.data).toBe(before.run.data);
    expect(view.result.current.read.committed).toBe(0);
  });

  it.each([401, 403, 404, 500, 'wrong id', 'invalid body'] as const)(
    'retires the full run after %s, preserves ordinary query behavior and requires another valid GET',
    async (refusal) => {
      const api = new FakeApi();
      const row = api.addRun({ status: 'running' });
      const view = mountRun(api, row.id);
      await waitFor(() => expect(view.result.current.read.committed).toBeGreaterThan(0));
      const original = view.result.current.run.data!;
      const invalid = { ...original, recovery: null };
      api.override('GET /runs/:id', () => {
        if (typeof refusal === 'number') return problem(refusal, 'REFUSED');
        return Response.json(refusal === 'wrong id' ? { ...original, id: 'foreign' } : invalid);
      });
      await act(async () => {
        await view.result.current.run.refetch();
      });
      expect(view.result.current.read.committed).toBe(0);
      if (refusal === 'invalid body') {
        expect(view.result.current.run.isSuccess).toBe(true);
        expect(view.result.current.run.data).toEqual(invalid);
      } else {
        await waitFor(() => expect(view.result.current.status).toBe('error'));
        expect(view.result.current.run.data).toBe(original);
      }
      // The real API key boundary rejects a 401. Reacceptance alone proves no new run body.
      if (useApiKeyStore.getState().rejected) act(() => useApiKeyStore.getState().forget());
      api.override('GET /runs/:id', () => {
        throw new TypeError('failed to connect');
      });
      await act(async () => {
        await view.result.current.run.refetch();
      });
      expect(view.result.current.read.committed).toBe(0);
      const boundary = view.result.current.read.loss;
      expect(boundary).toBeGreaterThan(0);
      api.override('GET /runs/:id', () => Response.json(original));
      await act(async () => {
        await view.result.current.run.refetch();
      });
      expect(view.result.current.read.committed).toBeGreaterThan(boundary);
    },
  );

  it('only qualifies a committed GET and retires even byte-identical manual or unrelated successes', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    const held = deferred<typeof evidence>();
    const observer = new QueryObserver(cache, {
      queryKey: run,
      placeholderData: evidence,
      enabled: false,
    });
    expect(observer.getCurrentResult().isPlaceholderData).toBe(true);
    expect(getInspectorRead(source, run).committed).toBe(0);
    cache.setQueryData(run, evidence);
    expect(getInspectorRead(source, run).committed).toBe(0);
    await read(source, run);
    expect(getInspectorRead(source, run).committed).toBeGreaterThan(0);
    const pending = read(source, run, () => held.promise);
    const start = getInspectorRead(source, run).pending;
    cache.setQueryData(run, evidence);
    expect(getInspectorRead(source, run)).toMatchObject({ committed: 0, pending: start });
    held.resolve(evidence);
    await pending;
    expect(getInspectorRead(source, run).committed).toBe(start);
    await cache.fetchQuery({ queryKey: run, queryFn: () => evidence });
    expect(getInspectorRead(source, run).committed).toBe(0);
  });

  it('keeps the last run through transport errors and compares independent read starts to the same loss', async () => {
    const source = owner();
    await read(source, run);
    const committed = getInspectorRead(source, run).committed;
    const held = deferred<typeof evidence>();
    const oldObservation = read(source, observation, () => held.promise);
    await expect(read(source, run, () => Promise.reject(offline()))).rejects.toThrow(
      'NETWORK_ERROR',
    );
    const boundary = getInspectorRead(source, run).loss;
    expect(boundary).toBeGreaterThan(committed);
    expect(getInspectorRead(source, run).committed).toBe(committed);
    await expect(read(source, run, () => Promise.reject(offline()))).rejects.toThrow(
      'NETWORK_ERROR',
    );
    expect(getInspectorRead(source, run).loss).toBe(boundary);
    await read(source, run);
    expect(getInspectorRead(source, run).committed).toBeGreaterThan(boundary);
    held.resolve(evidence);
    await oldObservation;
    expect(getInspectorRead(source, observation).committed).toBeLessThan(boundary);
    await read(source, observation);
    expect(getInspectorRead(source, observation).committed).toBeGreaterThan(boundary);
    await expect(read(source, run, () => Promise.reject(offline()))).rejects.toThrow();
    expect(getInspectorRead(source, run).loss).toBeGreaterThan(boundary);
  });

  it('binds proof to the provider incarnation, physical query, cache and accepted generation', async () => {
    const a = owner();
    const cache = a.source.queryClient;
    const b = owner(cache);
    const otherCache = new RunHeaderRegistry({ ...a.source, queryClient: queryClient() });
    await read(a, run);
    expect(getInspectorRead(b, run).committed).toBe(0);
    expect(getInspectorRead(otherCache, run).committed).toBe(0);
    await read(b, run);
    expect(getInspectorRead(a, run).committed).toBe(0);
    expect(getInspectorRead(new RunHeaderRegistry(a.source), run).committed).toBe(0);
    useApiKeyStore.getState().markRejected();
    expect(getInspectorRead(b, run).committed).toBe(0);
    await read(b, run);
    useApiKeyStore.getState().forget();
    expect(getInspectorRead(b, run).committed).toBe(0);
    await read(b, run);
    expect(getInspectorRead(b, run).committed).toBeGreaterThan(0);
    await cache.resetQueries({ queryKey: run, exact: true });
    expect(getInspectorRead(b, run).committed).toBe(0);
    await read(b, run);
    cache.removeQueries({ queryKey: run, exact: true });
    cache.setQueryData(run, evidence);
    expect(getInspectorRead(b, run).committed).toBe(0);
  });

  it('retains only the qualified revision during a pause and records a start when the GET can run', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    cache.mount();
    try {
      await read(source, run);
      const previous = getInspectorRead(source, run).committed;
      onlineManager.setOnline(false);
      const pending = read(source, run);
      const paused = getInspectorRead(source, run);
      expect(paused).toMatchObject({ committed: previous, pending: 0 });
      expect(paused.loss).toBeGreaterThan(previous);
      onlineManager.setOnline(true);
      await pending;
      expect(getInspectorRead(source, run).committed).toBeGreaterThan(paused.loss);
    } finally {
      cache.unmount();
    }
  });

  it('preserves the same qualified revision when cancelling a paused refetch before its GET', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    await read(source, run);
    const previous = getInspectorRead(source, run).committed;
    const revision = cache.getQueryState(run)!;
    const request = vi.fn(() => Promise.resolve(evidence));

    onlineManager.setOnline(false);
    const paused = read(source, run, request);
    try {
      expect(cache.getQueryState(run)?.fetchStatus).toBe('paused');
      const outage = getInspectorRead(source, run);
      expect(previous).toBeGreaterThan(0);
      expect(outage).toMatchObject({ committed: previous, pending: 0 });
      expect(outage.loss).toBeGreaterThan(previous);

      await cache.cancelQueries({ queryKey: run, exact: true });
      expect(await paused).toBe(revision.data);
      expect(request).not.toHaveBeenCalled();
      expect(cache.getQueryState(run)).toMatchObject({
        fetchStatus: 'idle',
        dataUpdateCount: revision.dataUpdateCount,
      });
      expect(cache.getQueryData(run)).toBe(revision.data);
      expect(getInspectorRead(source, run)).toEqual(outage);
    } finally {
      await cache.cancelQueries({ queryKey: run, exact: true });
    }
  });

  it.each(['cancelled', 'successful'] as const)(
    'preserves retry provenance after a transport failure with a %s app-default retry',
    async (outcome) => {
      vi.useFakeTimers();
      const cache = createQueryClient();
      const source = owner(cache);
      try {
        await read(source, run);
        const previous = getInspectorRead(source, run).committed;
        const revision = cache.getQueryState(run)!;
        await cache.invalidateQueries({ queryKey: run, exact: true, refetchType: 'none' });
        const request = vi
          .fn<() => Promise<typeof evidence>>()
          .mockRejectedValueOnce(offline())
          .mockResolvedValueOnce(evidence);
        const retry = read(source, run, request);
        await vi.advanceTimersByTimeAsync(0);

        expect(request).toHaveBeenCalledOnce();
        expect(cache.getQueryState(run)).toMatchObject({
          fetchStatus: 'fetching',
          fetchFailureCount: 1,
        });
        const outage = getInspectorRead(source, run);
        expect(previous).toBeGreaterThan(0);
        expect(outage).toMatchObject({ committed: previous, pending: 0 });
        expect(outage.loss).toBeGreaterThan(previous);

        if (outcome === 'cancelled') {
          await cache.cancelQueries({ queryKey: run, exact: true });
        }
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await retry).toBe(revision.data);
        expect(cache.getQueryState(run)?.fetchStatus).toBe('idle');
        expect(cache.getQueryData(run)).toBe(revision.data);
        if (outcome === 'cancelled') {
          expect(request).toHaveBeenCalledOnce();
          expect(cache.getQueryState(run)?.dataUpdateCount).toBe(revision.dataUpdateCount);
          expect(getInspectorRead(source, run)).toEqual(outage);
        } else {
          expect(request).toHaveBeenCalledTimes(2);
          expect(cache.getQueryState(run)?.dataUpdateCount).toBe(revision.dataUpdateCount + 1);
          expect(getInspectorRead(source, run).committed).toBeGreaterThan(outage.loss);
          expect(getInspectorRead(source, run).pending).toBe(0);
        }
      } finally {
        await cache.cancelQueries({ queryKey: run, exact: true });
        cache.clear();
        vi.useRealTimers();
      }
    },
  );

  it('keeps a real useRun receipt when its last observer unmounts and remounts offline', async () => {
    const api = new FakeApi();
    const row = api.addRun({ status: 'running' });
    const key = keys.run(row.id);
    const cache = queryClient();
    const client = createAppClient('http://test', api.fetch);

    function Probe() {
      const source = useRunHeaderRegistry()!;
      const query = useRun(row.id);
      const read = useInspectorRead(source, key);
      return createElement(
        'output',
        { 'data-committed': read.committed, 'data-loss': read.loss },
        query.fetchStatus,
      );
    }

    const provider = (visible: boolean) =>
      createElement(Providers, {
        client,
        queryClient: cache,
        children: visible ? createElement(Probe) : null,
      });
    const view = render(provider(true));
    const receipt = () => view.getByRole('status');
    try {
      await waitFor(() => expect(Number(receipt().dataset['committed'])).toBeGreaterThan(0));
      const committed = Number(receipt().dataset['committed']);
      const revision = cache.getQueryState(key)!;
      const unexpectedRead = vi.fn(() => problem(500, 'UNEXPECTED_GET'));
      api.override('GET /runs/:id', unexpectedRead);

      await act(async () => {
        onlineManager.setOnline(false);
        await cache.refetchQueries({ queryKey: key, exact: true });
      });
      await waitFor(() => expect(receipt()).toHaveTextContent('paused'));
      const loss = Number(receipt().dataset['loss']);
      expect(loss).toBeGreaterThan(committed);
      expect(Number(receipt().dataset['committed'])).toBe(committed);

      view.rerender(provider(false));
      await waitFor(() => expect(cache.getQueryState(key)?.fetchStatus).toBe('idle'));
      expect(cache.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount()).toBe(
        0,
      );
      expect(cache.getQueryData(key)).toBe(revision.data);
      expect(cache.getQueryState(key)?.dataUpdateCount).toBe(revision.dataUpdateCount);

      view.rerender(provider(true));
      await waitFor(() => expect(receipt()).toHaveTextContent('paused'));
      expect(cache.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount()).toBe(
        1,
      );
      expect(unexpectedRead).not.toHaveBeenCalled();
      expect(Number(receipt().dataset['loss'])).toBe(loss);
      expect(Number(receipt().dataset['committed'])).toBe(committed);
    } finally {
      view.unmount();
      cache.clear();
    }
  });

  it('refuses an identical manual write made inside a synchronous network-success observer', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    const observer = new QueryObserver(cache, { queryKey: run, enabled: false });
    let replaced = false;
    const stop = observer.subscribe((result) => {
      if (result.isSuccess && !replaced) {
        replaced = true;
        cache.setQueryData(run, evidence);
      }
    });
    try {
      await read(source, run);
      expect(replaced).toBe(true);
      expect(getInspectorRead(source, run).committed).toBe(0);
      await read(source, run);
      expect(getInspectorRead(source, run).committed).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  it('keeps a newer GET started by a synchronous observer of the previous success', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    const held = deferred<typeof evidence>();
    const observer = new QueryObserver(cache, { queryKey: run, enabled: false });
    let next: Promise<typeof evidence> | undefined;
    const stop = observer.subscribe((result) => {
      if (result.isSuccess && result.fetchStatus === 'idle' && !next)
        next = read(source, run, () => held.promise);
    });
    try {
      await read(source, run);
      const start = getInspectorRead(source, run).pending;
      expect(start).toBeGreaterThan(0);
      held.resolve(evidence);
      await next;
      expect(getInspectorRead(source, run)).toMatchObject({ committed: start, pending: 0 });
    } finally {
      stop();
    }
  });

  it('cannot qualify a matching body committed after its credential generation retired', async () => {
    const source = owner();
    const held = deferred<typeof evidence>();
    const pending = read(source, run, () => held.promise);
    useApiKeyStore.getState().markRejected();
    useApiKeyStore.getState().forget();
    held.resolve(evidence);
    await pending;
    expect(source.source.queryClient.getQueryData(run)).toEqual(evidence);
    expect(getInspectorRead(source, run).committed).toBe(0);
    await read(source, run);
    expect(getInspectorRead(source, run).committed).toBeGreaterThan(0);
  });

  it('preserves unguarded or refused GET results without issuing full-read receipts', async () => {
    const cache = queryClient();
    const source = owner(cache);
    for (const candidate of [undefined, owner(), source]) {
      const response = await cache.fetchQuery({
        queryKey: run,
        queryFn: (ctx) =>
          trackInspectorRead(
            candidate,
            ctx,
            () => Promise.resolve(evidence),
            () => {
              throw new Error('invalid for fallback');
            },
          ),
      });
      expect(response).toBe(evidence);
      expect(getInspectorRead(source, run).committed).toBe(0);
    }
  });

  it('retires a definitive refusal before a held retry and qualifies only the successful retry', async () => {
    const source = owner();
    await read(source, run);
    const first = getInspectorRead(source, run).committed;
    const held = deferred<typeof evidence>();
    const request = vi
      .fn<() => Promise<typeof evidence>>()
      .mockRejectedValueOnce(new GraphGoblinApiError({ status: 403, code: 'FORBIDDEN' }))
      .mockReturnValueOnce(held.promise);
    const retried = source.source.queryClient.fetchQuery({
      queryKey: run,
      retry: 1,
      retryDelay: 0,
      queryFn: (ctx) => trackInspectorRead(source, ctx, request, () => true),
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const retry = getInspectorRead(source, run);
    expect(retry.committed).toBe(0);
    expect(retry.pending).toBeGreaterThan(first);
    held.resolve(evidence);
    await retried;
    expect(getInspectorRead(source, run).committed).toBe(retry.pending);
  });

  it('cannot borrow proof when a new provider joins a GET already running under the old provider', async () => {
    const a = owner();
    const b = owner(a.source.queryClient);
    const held = deferred<typeof evidence>();
    const old = read(a, run, () => held.promise);
    const request = vi.fn(() => Promise.resolve(evidence));
    const joined = read(b, run, request);
    expect(getInspectorRead(b, run).pending).toBe(0);
    held.resolve(evidence);
    await Promise.all([old, joined]);
    expect(request).not.toHaveBeenCalled();
    expect(getInspectorRead(b, run).committed).toBe(0);
    await read(b, run, request);
    expect(request).toHaveBeenCalledOnce();
    expect(getInspectorRead(b, run).committed).toBeGreaterThan(0);
  });

  it.each([
    ['success', false],
    ['refusal', false],
    ['success', true],
    ['refusal', true],
  ] as const)(
    'discards a cancelled late %s after a fresh GET (replace physical entry: %s)',
    async (outcome, replaceEntry) => {
      const source = owner();
      const cache = source.source.queryClient;
      await read(source, run);
      const original = getInspectorRead(source, run).committed;
      const held = deferred<typeof evidence>();
      const obsolete = read(source, run, () => held.promise).catch(() => undefined);
      await cache.cancelQueries({ queryKey: run, exact: true });
      expect(getInspectorRead(source, run)).toMatchObject({ committed: original, pending: 0 });
      if (replaceEntry) cache.removeQueries({ queryKey: run, exact: true });
      await read(source, run);
      const replacement = getInspectorRead(source, run).committed;
      if (outcome === 'success') held.resolve({ id: 'one', result: 'obsolete' });
      else held.reject(new Error('old refusal'));
      await obsolete;
      expect(replacement).toBeGreaterThan(original);
      expect(getInspectorRead(source, run).committed).toBe(replacement);
      expect(cache.getQueryData(run)).toEqual(evidence);
    },
  );
});

describe('transport losses of a connection that follows the run (#575)', () => {
  it('keeps the evidence and the GET in flight through a loss that only a later GET can end', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    await read(source, run);
    const committed = getInspectorRead(source, run).committed;
    const revision = cache.getQueryState(run)!;
    const held = deferred<typeof evidence>();
    const pending = read(source, run, () => held.promise);
    const start = getInspectorRead(source, run).pending;
    expect(start).toBeGreaterThan(committed);

    markInspectorTransportLoss(source, run);
    const lost = getInspectorRead(source, run);
    expect(lost).toMatchObject({ committed, pending: start });
    expect(lost.loss).toBeGreaterThan(start);
    // Neither an error nor a read: the cached revision and the GET in flight are untouched.
    expect(cache.getQueryState(run)).toMatchObject({
      fetchStatus: 'fetching',
      error: null,
      dataUpdateCount: revision.dataUpdateCount,
    });
    // Repeated reports of the same outage keep its boundary.
    markInspectorTransportLoss(source, run);
    expect(getInspectorRead(source, run)).toEqual(lost);

    // The GET begun before the loss succeeds after it: last observed, never current.
    held.resolve(evidence);
    await pending;
    expect(getInspectorRead(source, run)).toEqual({
      committed: start,
      pending: 0,
      loss: lost.loss,
    });
    markInspectorTransportLoss(source, run);
    expect(getInspectorRead(source, run).loss).toBe(lost.loss);

    await read(source, run);
    const recovered = getInspectorRead(source, run);
    expect(recovered.committed).toBeGreaterThan(lost.loss);
    // After recovery, another loss is a distinct outage.
    markInspectorTransportLoss(source, run);
    expect(getInspectorRead(source, run)).toMatchObject({ committed: recovered.committed });
    expect(getInspectorRead(source, run).loss).toBeGreaterThan(recovered.committed);
  });

  it('moves the boundary past a recovery GET still unanswered at another loss', async () => {
    const source = owner();
    await read(source, run);
    markInspectorTransportLoss(source, run);
    const first = getInspectorRead(source, run).loss;
    const held = deferred<typeof evidence>();
    const recovery = read(source, run, () => held.promise);
    const start = getInspectorRead(source, run).pending;
    expect(start).toBeGreaterThan(first);

    markInspectorTransportLoss(source, run);
    const second = getInspectorRead(source, run);
    expect(second.pending).toBe(start);
    expect(second.loss).toBeGreaterThan(start);
    held.resolve(evidence);
    await recovery;
    expect(getInspectorRead(source, run)).toEqual({
      committed: start,
      pending: 0,
      loss: second.loss,
    });
    await read(source, run);
    expect(getInspectorRead(source, run).committed).toBeGreaterThan(second.loss);
  });

  it('shares one unrecovered boundary with transport failures and cancellation of the reads', async () => {
    const source = owner();
    const cache = source.source.queryClient;
    await read(source, run);
    const committed = getInspectorRead(source, run).committed;
    markInspectorTransportLoss(source, run);
    const boundary = getInspectorRead(source, run).loss;
    await expect(read(source, run, () => Promise.reject(offline()))).rejects.toThrow(
      'NETWORK_ERROR',
    );
    expect(getInspectorRead(source, run)).toEqual({ committed, pending: 0, loss: boundary });

    // A read outlasted by the loss is cancelled: the revision and the boundary stay.
    const held = deferred<typeof evidence>();
    const cancelled = read(source, run, () => held.promise).catch(() => undefined);
    markInspectorTransportLoss(source, run);
    expect(getInspectorRead(source, run).loss).toBeGreaterThan(boundary);
    const later = getInspectorRead(source, run).loss;
    await cache.cancelQueries({ queryKey: run, exact: true });
    held.resolve(evidence);
    await cancelled;
    expect(getInspectorRead(source, run)).toEqual({ committed, pending: 0, loss: later });

    // A recovered view's next read failure starts a new boundary that the stream keeps.
    await read(source, run);
    await expect(read(source, run, () => Promise.reject(offline()))).rejects.toThrow();
    const readLoss = getInspectorRead(source, run).loss;
    expect(readLoss).toBeGreaterThan(later);
    markInspectorTransportLoss(source, run);
    expect(getInspectorRead(source, run).loss).toBe(readLoss);
  });

  it('records on the owner’s current query under accepted credentials, never borrowing evidence', async () => {
    const a = owner();
    const cache = a.source.queryClient;
    // Nothing is recorded without an owner or a query, and no query is created.
    const before = markInspectorReadLoss();
    markInspectorTransportLoss(a, run);
    markInspectorTransportLoss(undefined, run);
    expect(markInspectorReadLoss()).toBe(before + 1);
    expect(cache.getQueryCache().find({ queryKey: run, exact: true })).toBeUndefined();

    // A cached row no GET qualified gets the loss without evidence; a later GET ends it.
    cache.setQueryData(run, evidence);
    markInspectorTransportLoss(a, run);
    const unproved = getInspectorRead(a, run);
    expect(unproved).toMatchObject({ committed: 0, pending: 0 });
    expect(unproved.loss).toBeGreaterThan(before + 1);
    await read(a, run);
    expect(getInspectorRead(a, run).committed).toBeGreaterThan(unproved.loss);

    // Another provider incarnation on the same cache starts from its own loss without a's proof,
    // and a cannot borrow it back.
    const b = owner(cache);
    markInspectorTransportLoss(b, run);
    const replaced = getInspectorRead(b, run);
    expect(replaced.committed).toBe(0);
    expect(replaced.loss).toBeGreaterThan(unproved.loss);
    expect(getInspectorRead(a, run)).toEqual({ committed: 0, pending: 0, loss: 0 });

    // A rejected key records nothing. Another generation starts from its own loss.
    await read(b, run);
    const proof = getInspectorRead(b, run).committed;
    useApiKeyStore.getState().markRejected();
    const rejected = markInspectorReadLoss();
    markInspectorTransportLoss(b, run);
    expect(markInspectorReadLoss()).toBe(rejected + 1);
    useApiKeyStore.getState().forget();
    expect(getInspectorRead(b, run)).toEqual({ committed: 0, pending: 0, loss: 0 });
    markInspectorTransportLoss(b, run);
    const generation = getInspectorRead(b, run);
    expect(generation.committed).toBe(0);
    expect(generation.loss).toBeGreaterThan(proof);
    await read(b, run);
    expect(getInspectorRead(b, run).committed).toBeGreaterThan(generation.loss);

    // A removed and recreated query starts without the earlier entry.
    cache.removeQueries({ queryKey: run, exact: true });
    cache.setQueryData(run, evidence);
    expect(getInspectorRead(b, run)).toEqual({ committed: 0, pending: 0, loss: 0 });
  });
});
