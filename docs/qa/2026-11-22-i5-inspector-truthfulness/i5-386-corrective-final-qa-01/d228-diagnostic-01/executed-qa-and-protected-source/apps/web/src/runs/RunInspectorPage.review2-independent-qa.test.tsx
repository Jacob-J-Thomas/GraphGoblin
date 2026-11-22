// DRAFT ONLY: not installed in the QA checkout, typechecked, linted or executed.
// Admit with a new immutable candidate before including these five desired-outcome cases.
import type { RunRecord } from '@graphgoblin/contracts';
import { RunRecordSchema } from '@graphgoblin/contracts';
import { runs } from '@graphgoblin/api-client';
import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useApiKeyStore } from '../api/api-key.js';
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
const json = (value: unknown) => Response.json(value);
async function pause(milliseconds: number) {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); });
}
async function header(id: string) {
  return (await screen.findByRole('heading', { name: `Run ${id}` })).closest('header')!;
}
function noClaim(id: string) {
  const heading = screen.queryByRole('heading', { name: `Run ${id}` });
  if (!heading) return; // Existing QueryState may withhold the inspector while a read is refused.
  const h = heading.closest('header')!;
  expect(h.querySelector('[data-status]')).toBeNull();
  expect(within(h).queryByText(/^at |^Last node in run record:|^Status from event/)).toBeNull();
}
function parked(api: FakeApi) {
  const wait = { waitId: 'review2-wait', startedSeq: 3, nodeId: 'real-wait', kind: 'input' as const };
  const run = api.addRun({ status: 'waiting', lastEventSeq: 3, currentNodeId: 'real-wait', waiting: wait });
  const events = [event(run.id, 1, 'run.queued', queuedFields()),
    event(run.id, 2, 'run.started', { attempt: 1 }),
    event(run.id, 3, 'run.waiting', { nodeId: 'real-wait', wait })];
  api.events.set(run.id, events);
  useRunEventStore.getState().clear(run.id);
  act(() => useRunEventStore.getState().append(run.id, ...events));
  return run;
}

it('review2 R2-1: a current terminal event owns an agreeing cache-only row while the current GET is held', async () => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'succeeded', lastEventSeq: 3, currentNodeId: 'cached-node' });
  api.events.set(run.id, [event(run.id, 1, 'run.queued', queuedFields()),
    event(run.id, 2, 'run.started', { attempt: 1 }),
    event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' })]);
  useRunEventStore.getState().clear(run.id);
  expect(useRunEventStore.getState().runs[run.id]).toBeUndefined();
  const client = createAppClient('http://review2-qa.test', api.fetch);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 2_000 }, mutations: { retry: false } } });
  // This earlier cache fill happens before any provider/registry exists and cannot be its receipt.
  cache.setQueryData(keys.run(run.id), await runs.get(client, run.id));
  const currentRow = gate();
  let heldRows = 0;
  let completedRows = 0;
  api.override('GET /runs/:id', async (call) => {
    if (call.path !== `/runs/${run.id}`) return api.builtIn(call);
    heldRows++;
    await currentRow.promise;
    completedRows++;
    return api.builtIn(call);
  });
  const view = render(<Providers client={client} queryClient={cache}>
    <MemoryRouter initialEntries={[`/runs/${run.id}`]}><App /></MemoryRouter>
  </Providers>);
  try {
    const h = await header(run.id);
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run\.finished.*succeeded/ });
    await waitFor(() => expect(heldRows).toBeGreaterThan(0));
    await waitFor(() => expect(cache.getQueryData(keys.observation(run.id))).toMatchObject({
      lifecycle: { runId: run.id, seq: 3, type: 'run.finished', status: 'succeeded' },
    }));
    expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
    expect(completedRows).toBe(0);
    expect(api.callsTo('GET', `/runs/${run.id}/events`).some((call) => call.headers.get('accept') === 'text/event-stream')).toBe(true);
    await waitFor(() => expect(h.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded'));
    expect(within(h).getByText('Status from event #3; the run record is updating.')).toBeVisible();
    expect(within(h).queryByText(/^at |^Last node in run record:/)).toBeNull();
    expect(within(h).queryByText('Updating status…')).toBeNull();
    // The matching authorized response may now qualify its recorded position.
    currentRow.release();
    await within(h).findByText('Last node in run record: cached-node');
    expect(h.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  } finally {
    view.unmount(); currentRow.release(); cache.clear();
  }
});

it('review2 R2-2: a wrong-ID 200 cannot borrow a warm matching receipt or replace the requested inspector', async () => {
  const api = new FakeApi();
  const a = parked(api);
  const b = api.addRun({ status: 'waiting', lastEventSeq: 3, currentNodeId: 'foreign-position' });
  const view = renderApp(`/runs/${a.id}`, api);
  let foreignReturned = false;
  try {
    const original = await header(a.id);
    await within(original).findByText('at real-wait');
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(a.id))).toMatchObject({
      id: a.id, status: 'waiting', lastEventSeq: 3, currentNodeId: 'real-wait',
    });
    api.override('GET /runs/:id', async (call) => {
      if (call.path !== `/runs/${a.id}`) return api.builtIn(call);
      const originalRow = RunRecordSchema.parse(await (await api.builtIn(call)).json());
      foreignReturned = true;
      return json({ ...originalRow, id: b.id, currentNodeId: 'foreign-position' });
    });
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: keys.run(a.id), exact: true }); });
    expect(foreignReturned).toBe(true);
    expect(screen.getByTestId('location')).toHaveTextContent(`/runs/${a.id}`);
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(a.id))?.id).not.toBe(b.id);
    expect(screen.queryByRole('heading', { name: `Run ${b.id}` })).toBeNull();
    expect(screen.queryByText('at foreign-position')).toBeNull();
    // Malformed success is not a deletion: a subsequent valid same-ID read still settles A.
    api.override('GET /runs/:id', (call) => api.builtIn(call));
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: keys.run(a.id), exact: true }); });
    const valid = await header(a.id);
    await within(valid).findByText('at real-wait');
    expect(valid.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(a.id))?.id).toBe(a.id);
  } finally {
    view.unmount(); view.queryClient.clear();
  }
});

it.each([
  { name: 'no predecessor request', oldStatus: undefined },
  { name: 'old pending 200', oldStatus: 200 },
  { name: 'old pending 401', oldStatus: 401 },
] as const)('review2 R2-3: visible same-key recovery reads a quiet parked run in the recovered generation ($name)', async ({ oldStatus }) => {
  const overlap = oldStatus !== undefined;
  const api = new FakeApi();
  const run = parked(api);
  const syntheticKey = 'synthetic-review2-qa-key';
  api.requiredKey = syntheticKey;
  useApiKeyStore.getState().save(syntheticKey);
  const oldRow = gate();
  const currentRow = gate();
  const rowReads: { generation: number; signal: AbortSignal | undefined; phase: string }[] = [];
  const observationReads: number[] = [];
  let phase = 'initial';
  let oldStarted = false;
  let oldReturned = false;
  let oldRefresh: Promise<void> | undefined;
  api.override('GET /runs/:id', async (call) => {
    if (call.path !== `/runs/${run.id}`) return api.builtIn(call);
    const sentPhase = phase;
    rowReads.push({ generation: useApiKeyStore.getState().generation, signal: call.signal, phase: sentPhase });
    if (sentPhase === 'old-pending') {
      oldStarted = true;
      await oldRow.promise;
      oldReturned = true;
      if (oldStatus === 401) return problem(401, 'REFUSED', 'retired generation response');
      return json({ ...run, currentNodeId: 'retired-wait' });
    }
    if (sentPhase === 'recovery') await currentRow.promise;
    return api.builtIn(call);
  });
  api.override('GET /runs/:id/observation', (call) => {
    observationReads.push(useApiKeyStore.getState().generation);
    return api.builtIn(call);
  });
  const streams = () => api.callsTo('GET', `/runs/${run.id}/events`).filter((call) => call.headers.get('accept') === 'text/event-stream');
  const view = renderApp(`/runs/${run.id}`, api);
  try {
    await within(await header(run.id)).findByText('at real-wait');
    await waitFor(() => expect(streams()).toHaveLength(1));
    const originalGeneration = useApiKeyStore.getState().generation;
    if (overlap) {
      phase = 'old-pending';
      // Setup only: start the predecessor request before rejection. No test refresh follows recovery.
      oldRefresh = view.queryClient.invalidateQueries({ queryKey: keys.run(run.id), exact: true });
      await waitFor(() => expect(oldStarted).toBe(true));
      expect(rowReads.find((read) => read.phase === 'old-pending')?.signal).toBeDefined();
    }
    api.override('GET /runs/:id/observation', () => problem(401, 'REFUSED', 'synthetic rejection'));
    await act(async () => { await view.queryClient.invalidateQueries({ queryKey: keys.observation(run.id), exact: true }); });
    const panel = await screen.findByRole('form', { name: 'Enter API key' });
    expect(useApiKeyStore.getState().rejected).toBe(true);
    const rejectedGeneration = useApiKeyStore.getState().generation;
    expect(rejectedGeneration).toBeGreaterThan(originalGeneration);
    noClaim(run.id);
    const readsAtRejection = rowReads.length;
    await pause(600);
    expect(rowReads).toHaveLength(readsAtRejection);
    api.override('GET /runs/:id/observation', (call) => {
      observationReads.push(useApiKeyStore.getState().generation);
      return api.builtIn(call);
    });
    phase = 'recovery';
    const user = userEvent.setup();
    await user.type(within(panel).getByLabelText(/API key/), syntheticKey);
    await user.click(within(panel).getByRole('button', { name: 'Use key' }));
    const recoveredGeneration = useApiKeyStore.getState().generation;
    expect(recoveredGeneration).toBeGreaterThan(rejectedGeneration);
    expect(useApiKeyStore.getState().rejected).toBe(false);
    await waitFor(() => expect(streams()).toHaveLength(2));
    expect(streams()[1]!.search.get('after')).toBe('3');
    // This request must start without events, focus, navigation, or test-side invalidation.
    await waitFor(() => expect(rowReads.filter((read) => read.generation === recoveredGeneration)).toHaveLength(1));
    noClaim(run.id);
    if (overlap) {
      expect(oldReturned).toBe(false);
      oldRow.release();
      await waitFor(() => expect(oldReturned).toBe(true));
      await act(async () => { await oldRefresh; });
      // Drain the returned synthetic response through withApiKey before releasing the new row.
      await pause(0);
      expect(useApiKeyStore.getState().generation).toBe(recoveredGeneration);
      expect(useApiKeyStore.getState().rejected).toBe(false);
      expect(screen.queryByRole('form', { name: 'Enter API key' })).toBeNull();
      noClaim(run.id);
      expect(screen.queryByText('at retired-wait')).toBeNull();
    }
    currentRow.release();
    const fresh = await header(run.id);
    await within(fresh).findByText('at real-wait');
    expect(fresh.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
    expect(within(fresh).queryByText('Updating status…')).toBeNull();
    await pause(2_200);
    expect(rowReads.filter((read) => read.generation === recoveredGeneration)).toHaveLength(1);
    expect(observationReads.filter((generation) => generation === recoveredGeneration).length).toBeLessThanOrEqual(1);
    expect(streams()).toHaveLength(2);
    expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
    expect(useApiKeyStore.getState().generation).toBe(recoveredGeneration);
    expect(useApiKeyStore.getState().rejected).toBe(false);
    expect(screen.queryByRole('form', { name: 'Enter API key' })).toBeNull();
    expect(fresh.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
  } finally {
    view.unmount(); oldRow.release(); currentRow.release(); view.queryClient.clear();
    useApiKeyStore.getState().forget();
  }
});
