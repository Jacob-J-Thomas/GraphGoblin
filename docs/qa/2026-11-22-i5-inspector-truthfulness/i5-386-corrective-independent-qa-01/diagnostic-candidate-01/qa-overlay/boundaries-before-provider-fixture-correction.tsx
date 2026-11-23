import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { runs } from '@graphgoblin/api-client';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields, TS } from '../__fixtures__/fake-api.js';
import { API_KEY_STORAGE, useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { keys } from '../api/queries.js';
import { App } from '../app/App.js';
import { Providers } from '../app/bootstrap.js';
import { useRunEventStore } from './event-store.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const actor = { kind: 'user' as const, id: 'boundary-qa' };

function seed(api: FakeApi, overrides: Partial<RunRecord> = {}) {
  const run = api.addRun({ status: 'running', lastEventSeq: 2, currentNodeId: 'old-node', ...overrides });
  useRunEventStore.getState().clear(run.id);
  api.events.set(run.id, [event(run.id, 1, 'run.queued', queuedFields()), event(run.id, 2, 'run.started', { attempt: 1 })]);
  return run;
}
function fail(runId: string, seq = 3) {
  return event(runId, seq, 'run.failed', { failure: { code: 'INTERNAL_ERROR', message: 'old scope failure', resumable: true } });
}
function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 2_000 }, mutations: { retry: false } } });
}
function mount(api: FakeApi, runId: string, queryClient = qc()) {
  let client = createAppClient('http://boundary-qa.test', api.fetch);
  let cache = queryClient;
  const tree = () => <Providers client={client} queryClient={cache}><MemoryRouter initialEntries={[`/runs/${runId}`]}><App /></MemoryRouter></Providers>;
  const view = render(tree());
  return { ...view, queryClient, swap(nextApi: FakeApi, nextCache = cache) {
    client = createAppClient('http://boundary-qa.test', nextApi.fetch);
    cache = nextCache;
    view.rerender(tree());
  }, replaceCache(nextCache: QueryClient) { cache = nextCache; view.rerender(tree()); } };
}
function header(runId: string) { return screen.getByRole('heading', { name: `Run ${runId}` }).closest('header')!; }
function noClaim(runId: string) {
  const heading = screen.queryByRole('heading', { name: `Run ${runId}` });
  if (!heading) return; // Existing QueryState may withhold the inspector under an actual refusal.
  const region = heading.closest('header')!;
  expect(region.querySelector('[data-status]')).toBeNull();
  expect(within(region).queryByText(/^at |^Last node in run record:|^Status from event/)).toBeNull();
}

it('boundary C1 negative: cold acknowledged resume tail cannot promote an older successful failure observation', async () => {
  const api = new FakeApi();
  const run = seed(api);
  const failed = fail(run.id);
  const resumed = event(run.id, 4, 'run.resumed', { actor });
  api.events.get(run.id)!.push(failed, resumed);
  act(() => useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!));
  const cache = qc();
  cache.setQueryData(keys.run(run.id), await (await api.fetch(new Request(`http://boundary-qa.test/runs/${run.id}`))).json());
  const freshRow = gate();
  let observed = 0;
  api.override('GET /runs/:id', async (call) => { await freshRow.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/observation', () => { observed++; return json({ lifecycle: failed, freshSessionChoices: [] }); });
  const view = mount(api, run.id, cache);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(observed).toBeGreaterThan(0));
    await waitFor(() => expect(cache.getQueryData<{ lifecycle?: RunEvent }>(keys.observation(run.id))?.lifecycle).toMatchObject({ type: 'run.failed', seq: 3 }));
    expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(4);
    expect(api.callsTo('GET', `/runs/${run.id}/events`).some((call) => call.headers.get('accept') === 'text/event-stream' && call.search.get('after') === '4')).toBe(true);
    noClaim(run.id);
  } finally { view.unmount(); freshRow.release(); }
});

it('boundary C1 positive: cold stable terminal with audit suffix settles without new event payload or finalizedAt', async () => {
  const api = new FakeApi();
  const run = seed(api, { status: 'succeeded', lastEventSeq: 5, currentNodeId: 'done' });
  api.events.get(run.id)!.push(event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }), event(run.id, 4, 'return.delivered', { channel: { kind: 'log' } }), event(run.id, 5, 'return.delivered', { channel: { kind: 'log' } }));
  act(() => useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!));
  const fresh = gate();
  api.override('GET /runs/:id', async (call) => { await fresh.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/observation', async (call) => { await fresh.promise; return api.builtIn(call); });
  const view = mount(api, run.id);
  try {
    await waitFor(() => expect(api.callsTo('GET', `/runs/${run.id}`).length).toBeGreaterThan(0));
    noClaim(run.id);
    fresh.release();
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded'));
    expect(within(header(run.id)).getByText('Last node in run record: done')).toBeVisible();
    expect(within(header(run.id)).queryByText('Updating status…')).toBeNull();
    expect(api.runs.get(run.id)?.finalizedAt).toBeUndefined();
    expect(api.callsTo('GET', `/runs/${run.id}/events`).filter((call) => call.headers.get('accept') === 'text/event-stream').every((call) => call.search.get('after') === '5')).toBe(true);
  } finally { view.unmount(); fresh.release(); }
});

it('boundary G1: rejection immediately withholds header evidence and late old successful observation cannot restore it', async () => {
  useApiKeyStore.getState().save('synthetic-old-key');
  const api = new FakeApi();
  const run = seed(api);
  api.events.get(run.id)!.push(fail(run.id));
  const stale = gate();
  let hold = false;
  let waiting = 0;
  let returned = 0;
  api.override('GET /runs/:id/observation', async (call) => {
    const body = await (await api.builtIn(call)).json();
    if (hold) { waiting++; await stale.promise; returned++; }
    return json(body);
  });
  const view = mount(api, run.id);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'failed'));
    hold = true;
    const refresh = view.queryClient.refetchQueries({ queryKey: keys.observation(run.id), exact: true });
    await waitFor(() => expect(waiting).toBeGreaterThan(0));
    const streams = api.callsTo('GET', `/runs/${run.id}/events`).filter((call) => call.headers.get('accept') === 'text/event-stream').length;
    act(() => useApiKeyStore.getState().markRejected());
    noClaim(run.id);
    stale.release();
    await act(async () => { await refresh; });
    expect(returned).toBeGreaterThan(0);
    noClaim(run.id);
    expect(api.callsTo('GET', `/runs/${run.id}/events`).filter((call) => call.headers.get('accept') === 'text/event-stream')).toHaveLength(streams);
  } finally { view.unmount(); stale.release(); }
});

it.each(['same-key', 'replacement-key', 'cross-tab-key'] as const)('boundary G2/G4: %s recovery rejects old receipts and accepts current-source reads', async (mode) => {
  useApiKeyStore.getState().save('synthetic-old-key');
  const api = new FakeApi();
  const run = seed(api);
  api.events.get(run.id)!.push(fail(run.id));
  let blocking = false;
  const current = gate();
  api.override('GET /runs/:id', async (call) => { if (blocking) await current.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/observation', async (call) => { if (blocking) await current.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/events', async (call) => { if (blocking && call.headers.get('accept') === 'text/event-stream') await current.promise; return api.builtIn(call); });
  const view = mount(api, run.id);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'failed'));
    blocking = true;
    act(() => useApiKeyStore.getState().markRejected());
    noClaim(run.id);
    if (mode === 'cross-tab-key') {
      localStorage.setItem(API_KEY_STORAGE, 'synthetic-next-key');
      act(() => window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE })));
    } else act(() => useApiKeyStore.getState().save(mode === 'same-key' ? 'synthetic-old-key' : 'synthetic-next-key'));
    noClaim(run.id);
    api.events.get(run.id)!.push(event(run.id, 4, 'run.resumed', { actor }));
    api.runs.set(run.id, { ...run, status: 'waiting', lastEventSeq: 4, currentNodeId: 'parked-node' });
    current.release();
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: keys.run(run.id), exact: true }); });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting'));
    expect(within(header(run.id)).getByText('at parked-node')).toBeVisible();
    const persisted = JSON.stringify([...Array(sessionStorage.length)].map((_, index) => sessionStorage.getItem(sessionStorage.key(index)!)));
    expect(persisted).not.toContain('synthetic-');
    expect(persisted).not.toContain('generation');
  } finally { view.unmount(); current.release(); }
});

it('boundary G3: new API client with the same QueryClient withholds former source until current reads settle', async () => {
  const oldApi = new FakeApi();
  const run = seed(oldApi);
  oldApi.events.get(run.id)!.push(fail(run.id));
  const view = mount(oldApi, run.id);
  const current = gate();
  const next = new FakeApi();
  next.addRun({ ...run, status: 'waiting', lastEventSeq: 4, currentNodeId: 'new-source-node' });
  next.events.set(run.id, [...oldApi.events.get(run.id)!, event(run.id, 4, 'run.resumed', { actor })]);
  next.override('GET /runs/:id', async (call) => { await current.promise; return next.builtIn(call); });
  next.override('GET /runs/:id/observation', async (call) => { await current.promise; return next.builtIn(call); });
  next.override('GET /runs/:id/events', async (call) => { if (call.headers.get('accept') === 'text/event-stream') await current.promise; return next.builtIn(call); });
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'failed'));
    view.swap(next);
    noClaim(run.id);
    current.release();
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: keys.run(run.id), exact: true }); });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting'));
    expect(within(header(run.id)).getByText('at new-source-node')).toBeVisible();
  } finally { view.unmount(); current.release(); }
});

it.each([401, 404])('boundary C3: cold actual %s refuses a terminal claim', async (status) => {
  const api = new FakeApi();
  const run = seed(api);
  api.events.get(run.id)!.push(fail(run.id));
  act(() => useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!));
  api.override('GET /runs/:id', () => problem(status, status === 401 ? 'UNAUTHORIZED' : 'RUN_NOT_FOUND', 'explicit QA refusal'));
  api.override('GET /runs/:id/observation', () => problem(status, status === 401 ? 'UNAUTHORIZED' : 'RUN_NOT_FOUND', 'explicit QA refusal'));
  api.override('GET /runs/:id/events', () => problem(status, status === 401 ? 'UNAUTHORIZED' : 'RUN_NOT_FOUND', 'explicit QA refusal'));
  const view = mount(api, run.id);
  try {
    await waitFor(() => expect(view.queryClient.getQueryState(keys.run(run.id))?.status).toBe('error'));
    noClaim(run.id);
    if (status === 401) expect(screen.getByRole('heading', { name: 'API key required' })).toBeVisible();
    expect(api.callsTo('GET', `/runs/${run.id}`).length).toBeLessThanOrEqual(3);
  } finally { view.unmount(); }
});

it('boundary G2 follower negative: a held pre-rejection attempt observation cannot write after same-key recovery', async () => {
  useApiKeyStore.getState().save('synthetic-same-key');
  const api = new FakeApi();
  const run = seed(api); // The lagging row remains running #2, distinct from failure #3.
  api.events.get(run.id)!.push(fail(run.id));
  const cache = qc();
  // Public query configuration isolates the real attempt follower as the only observation reader.
  cache.setQueryDefaults(keys.observation(run.id), { enabled: false });
  const oldObservation = gate();
  const currentReads = gate();
  let blockCurrent = false;
  let held = 0;
  let returned = 0;
  let oldSignal: AbortSignal | undefined;
  api.override('GET /runs/:id', async (call) => { if (blockCurrent) await currentReads.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/observation', async (call) => {
    held++;
    oldSignal = call.signal;
    const body = await (await api.builtIn(call)).json();
    await oldObservation.promise;
    returned++;
    return json(body);
  });
  const view = mount(api, run.id, cache);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(held).toBe(1));
    expect(cache.getQueryData(keys.observation(run.id))).toBeUndefined();
    expect(oldSignal?.aborted).toBe(false);
    expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'failed');
    blockCurrent = true;
    act(() => useApiKeyStore.getState().markRejected());
    noClaim(run.id);
    act(() => useApiKeyStore.getState().save('synthetic-same-key'));
    noClaim(run.id);
    oldObservation.release();
    await waitFor(() => expect(returned).toBe(1));
    // The follower is independent of the disabled page query; no cache read can explain a badge.
    expect(cache.getQueryData(keys.observation(run.id))).toBeUndefined();
    await act(async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); });
    noClaim(run.id);
  } finally { view.unmount(); oldObservation.release(); currentReads.release(); }
});

it('boundary G3 cache replacement: same client with a new QueryClient requires current receipts', async () => {
  const api = new FakeApi();
  const run = seed(api);
  api.events.get(run.id)!.push(fail(run.id));
  let blocking = false;
  const fresh = gate();
  api.override('GET /runs/:id', async (call) => { if (blocking) await fresh.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/observation', async (call) => { if (blocking) await fresh.promise; return api.builtIn(call); });
  api.override('GET /runs/:id/events', async (call) => { if (blocking && call.headers.get('accept') === 'text/event-stream') await fresh.promise; return api.builtIn(call); });
  const view = mount(api, run.id);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'failed'));
    const replacement = qc();
    replacement.setQueryData(keys.run(run.id), view.queryClient.getQueryData(keys.run(run.id)));
    replacement.setQueryData(keys.observation(run.id), view.queryClient.getQueryData(keys.observation(run.id)));
    blocking = true;
    view.replaceCache(replacement);
    noClaim(run.id);
    api.runs.set(run.id, { ...run, status: 'waiting', lastEventSeq: 4, currentNodeId: 'new-cache-node' });
    api.events.get(run.id)!.push(event(run.id, 4, 'run.resumed', { actor }));
    fresh.release();
    await act(async () => { await replacement.invalidateQueries({ queryKey: keys.run(run.id), exact: true }); });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting'));
    expect(within(header(run.id)).getByText('at new-cache-node')).toBeVisible();
  } finally { view.unmount(); fresh.release(); }
});

it('boundary G4: delayed old-key 401 does not reject replacement key; cross-tab forget withholds prior header', async () => {
  useApiKeyStore.getState().save('synthetic-old-key');
  const api = new FakeApi();
  const run = seed(api);
  api.events.get(run.id)!.push(fail(run.id));
  const old401 = gate();
  let holdOld = false;
  let held = 0;
  api.override('GET /runs/:id', async (call) => {
    if (holdOld && call.headers.get('authorization') === 'Bearer synthetic-old-key') { held++; await old401.promise; return problem(401, 'UNAUTHORIZED', 'delayed old-key refusal'); }
    return api.builtIn(call);
  });
  const view = mount(api, run.id);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'failed'));
    holdOld = true;
    const oldRead = runs.get(createAppClient('http://boundary-qa.test', api.fetch), run.id).catch((error: unknown) => error);
    await waitFor(() => expect(held).toBeGreaterThan(0));
    api.runs.set(run.id, { ...run, status: 'waiting', lastEventSeq: 4, currentNodeId: 'new-key-node' });
    api.events.get(run.id)!.push(event(run.id, 4, 'run.resumed', { actor }));
    localStorage.setItem(API_KEY_STORAGE, 'synthetic-next-key');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE })));
    await waitFor(() => expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting'));
    old401.release();
    expect(await oldRead).toMatchObject({ status: 401 });
    expect(useApiKeyStore.getState().rejected).toBe(false);
    expect(header(run.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
    api.requiredKey = 'synthetic-next-key';
    localStorage.removeItem(API_KEY_STORAGE);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE })));
    await waitFor(() => expect(useApiKeyStore.getState().rejected).toBe(true));
    noClaim(run.id);
  } finally { view.unmount(); old401.release(); }
});

it('boundary C2: 21 public run visits evict A; a late old row cannot certify the new entry, then fresh terminal reads settle', async () => {
  const api = new FakeApi();
  const chain = Array.from({ length: 21 }, (_, index) => seed(api, { currentNodeId: `node-${index}` }));
  const a = chain[0]!;
  chain.forEach((run, index) => api.runs.set(run.id, { ...run, parentRunId: chain[(index + 1) % chain.length]!.id }));
  const initialA = api.runs.get(a.id)!;
  const failed = fail(a.id);
  api.events.get(a.id)!.push(failed);
  act(() => useRunEventStore.getState().append(a.id, ...api.events.get(a.id)!));
  const stream = gate();
  const oldRow = gate();
  const freshReads = gate();
  let aRows = 0;
  let aObservations = 0;
  let oldRowReturned = false;
  let acceptCurrent = false;
  api.override('GET /runs/:id', async (call) => {
    if (call.path !== `/runs/${a.id}`) return api.builtIn(call);
    aRows++;
    if (aRows === 1) return api.builtIn(call);
    if (aRows === 2) {
      await oldRow.promise;
      oldRowReturned = true;
      return json({ ...initialA, status: 'failed', lastEventSeq: 3, failure: { code: 'INTERNAL_ERROR', message: 'late evicted row', resumable: true } });
    }
    if (!acceptCurrent) await freshReads.promise;
    return api.builtIn(call);
  });
  api.override('GET /runs/:id/observation', async (call) => {
    if (call.path === `/runs/${a.id}/observation` && ++aObservations > 1 && !acceptCurrent) await freshReads.promise;
    return api.builtIn(call);
  });
  api.override('GET /runs/:id/events', async (call) => {
    if (call.path === `/runs/${a.id}/events` && call.headers.get('accept') === 'text/event-stream') await stream.promise;
    return api.builtIn(call);
  });
  const view = mount(api, a.id);
  try {
    await screen.findByRole('heading', { name: `Run ${a.id}` });
    await waitFor(() => expect(view.queryClient.getQueryData<{ lifecycle?: RunEvent }>(keys.observation(a.id))?.lifecycle).toMatchObject({ seq: 3 }));
    api.events.get(a.id)!.push(event(a.id, 4, 'run.resumed', { actor }));
    stream.release();
    await within(header(a.id)).findByText('Updating status…');
    await waitFor(() => expect(aRows).toBeGreaterThan(1));
    for (let index = 1; index < chain.length; index++) {
      fireEvent.click(within(header(chain[index - 1]!.id)).getByRole('link', { name: 'parent run' }));
      await screen.findByRole('heading', { name: `Run ${chain[index]!.id}` });
      await waitFor(() => expect(header(chain[index]!.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'running'));
    }
    // Device cursor restoration is setup, not a new header receipt, after the 21 distinct views.
    act(() => useRunEventStore.getState().append(a.id, ...api.events.get(a.id)!));
    fireEvent.click(within(header(chain.at(-1)!.id)).getByRole('link', { name: 'parent run' }));
    await screen.findByRole('heading', { name: `Run ${a.id}` });
    noClaim(a.id);
    oldRow.release();
    await waitFor(() => expect(oldRowReturned).toBe(true));
    await waitFor(() => expect(view.queryClient.getQueryData<RunRecord>(keys.run(a.id))).toMatchObject({ status: 'failed', lastEventSeq: 3 }));
    noClaim(a.id);
    acceptCurrent = true;
    api.runs.set(a.id, { ...initialA, status: 'succeeded', lastEventSeq: 6, currentNodeId: 'done' });
    api.events.get(a.id)!.push(event(a.id, 5, 'run.finished', { status: 'succeeded', outcome: 'success' }), event(a.id, 6, 'return.delivered', { channel: { kind: 'log' } }));
    freshReads.release();
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: keys.run(a.id), exact: true }); await view.queryClient.invalidateQueries({ queryKey: keys.observation(a.id), exact: true }); });
    await waitFor(() => expect(header(a.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded'));
    expect(within(header(a.id)).getByText('Last node in run record: done')).toBeVisible();
    expect(within(header(a.id)).queryByText('Updating status…')).toBeNull();
  } finally { view.unmount(); stream.release(); oldRow.release(); freshReads.release(); }
});

it('boundary I1: live progress keeps the existing request budget, event-cache format and server action authority', async () => {
  const api = new FakeApi();
  const run = seed(api);
  const view = mount(api, run.id);
  try {
    await screen.findByRole('heading', { name: `Run ${run.id}` });
    await screen.findByText('Timeline (2 events, live)');
    await waitFor(() => expect(view.queryClient.isFetching({ queryKey: keys.run(run.id), exact: true })).toBe(0));
    await waitFor(() => expect(view.queryClient.isFetching({ queryKey: keys.observation(run.id), exact: true })).toBe(0));
    const keysBefore = Object.keys(sessionStorage).sort();
    const beforeRun = api.callsTo('GET', `/runs/${run.id}`).length;
    const beforeObservation = api.callsTo('GET', `/runs/${run.id}/observation`).length;
    const started = performance.now();
    for (let index = 0; index < 8; index++) {
      act(() => api.pushEvent(run.id, event(run.id, index + 3, 'node.progress', { nodeId: 'work', progress: { item: { id: `qa-${index}`, type: 'reasoning', summary: 'still working' } } })));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await screen.findByText('Timeline (10 events, live)');
    const elapsed = performance.now() - started;
    expect(api.callsTo('GET', `/runs/${run.id}`).length - beforeRun).toBeLessThanOrEqual(Math.floor(elapsed / 500) + 2);
    expect(api.callsTo('GET', `/runs/${run.id}/observation`).length).toBe(beforeObservation);
    expect(Object.keys(sessionStorage).sort()).toEqual(keysBefore);
    const stored = Object.keys(sessionStorage).filter((key) => key.startsWith('graphgoblin-run-events-v'));
    expect(stored).toHaveLength(1);
    const saved = JSON.parse(sessionStorage.getItem(stored[0]!)!) as { version: number; state: { runs: Record<string, Record<string, unknown>> } };
    expect(saved.version).toBe(2);
    const allowed = ['events', 'uncached', 'lastSeq', 'bytes', 'mode', 'olderCursor', 'newerCursor'];
    for (const log of Object.values(saved.state.runs)) expect(Object.keys(log).every((key) => allowed.includes(key))).toBe(true);
    expect(sessionStorage.getItem(stored[0]!)).not.toMatch(/"generation"|"receipts"|"terminalSeq"|"marker"/);
    expect(within(header(run.id)).getByRole('button', { name: /^Pause$/ })).toBeEnabled();
    expect(api.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  } finally { view.unmount(); }
});
