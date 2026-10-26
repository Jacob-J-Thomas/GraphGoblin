import type { RunEvent } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { cyclePass, event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { LIVE_REFRESH_MS } from './live-refresh.js';
import { EVENT_BATCH_MS } from './useRunEvents.js';

/** Each kind of server read the inspector issues for one run (#186). */
function reads(api: FakeApi, runId: string) {
  const thread = () => api.callsTo('GET', `/runs/${runId}/thread`);
  return {
    run: () => api.callsTo('GET', `/runs/${runId}`).length,
    observation: () => api.callsTo('GET', `/runs/${runId}/observation`).length,
    currentThread: () => thread().filter((call) => !call.search.has('at')).length,
    historicalThread: () => thread().filter((call) => call.search.has('at')),
  };
}

/**
 * A running run whose stream is open with its first events. Returns once the initial reads and
 * the refresh for the first batch (whose `run.started` changes the evidence) have been issued.
 */
async function followRunning(api: FakeApi) {
  const run = api.addRun({ status: 'running' });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  const view = renderApp(`/runs/${run.id}`, api);
  await screen.findByText('Timeline (2 events, live)');
  const count = reads(api, run.id);
  await waitFor(() => {
    expect(count.run()).toBeGreaterThan(1);
    expect(count.observation()).toBeGreaterThan(1);
    expect(count.currentThread()).toBeGreaterThan(0);
  });
  return { run, view, count };
}

/**
 * The most refreshes that can start within `elapsed` ms: one per interval and one at its start,
 * plus one whose request was recorded at the boundary. Fewer happen on a slower machine.
 */
const refreshBound = (elapsed: number) => Math.floor(elapsed / LIVE_REFRESH_MS) + 2;

/** Deliver each group of events as its own stream batch. */
async function deliverBatches(api: FakeApi, runId: string, batches: RunEvent[][]) {
  for (const batch of batches) {
    act(() => {
      for (const item of batch) api.pushEvent(runId, item);
    });
    await new Promise((resolve) => setTimeout(resolve, EVENT_BATCH_MS + 20));
  }
}

it('follows a fast cycle live without historical thread reads, refreshing at most once per interval (#186)', async () => {
  const api = new FakeApi();
  const { run, view, count } = await followRunning(api);
  const before = {
    run: count.run(),
    observation: count.observation(),
    thread: count.currentThread(),
  };
  const passes = 24;
  const started = performance.now();
  await deliverBatches(
    api,
    run.id,
    Array.from({ length: passes }, (_, i) => cyclePass(run.id, 3 + i * 5, i + 1)),
  );
  const last = 2 + passes * 5;
  await screen.findByText(`Timeline (${last} events, live)`);
  // Following live shows the current thread, which a trailing refresh brings up to the last pass.
  await waitFor(() =>
    expect(screen.getByLabelText('Variables')).toHaveTextContent(`"n": ${passes}`),
  );
  const bound = refreshBound(performance.now() - started);
  // No live read replays history: every completion arrived, none was read at a boundary.
  expect(count.historicalThread().map((call) => call.search.get('at'))).toEqual([]);
  // Twenty-four batches refreshed each read model at most once per elapsed interval.
  for (const [name, delta] of [
    ['run', count.run() - before.run],
    ['observation', count.observation() - before.observation],
    ['current thread', count.currentThread() - before.thread],
  ] as const) {
    expect(delta, name).toBeGreaterThan(0);
    expect(delta, name).toBeLessThanOrEqual(bound);
  }
  expect(screen.getByRole('heading', { name: 'Current thread' })).toBeInTheDocument();
  view.unmount();
});

it('refreshes only the run record while a node streams progress (#186)', async () => {
  const api = new FakeApi();
  const { run, view, count } = await followRunning(api);
  act(() =>
    api.pushEvent(
      run.id,
      event(run.id, 3, 'node.started', {
        nodeId: 'ask',
        kind: 'inference',
        attempt: 1,
        configHash: 'h',
      }),
    ),
  );
  await screen.findByText('Timeline (3 events, live)');
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Current thread' })).toBeInTheDocument(),
  );
  // Let the refresh for the visit's start finish before counting.
  await new Promise((resolve) => setTimeout(resolve, 2 * LIVE_REFRESH_MS));
  const before = {
    run: count.run(),
    observation: count.observation(),
    thread: count.currentThread(),
  };
  await deliverBatches(
    api,
    run.id,
    Array.from({ length: 10 }, (_, batch) =>
      Array.from({ length: 20 }, (_, i) =>
        event(run.id, 4 + batch * 20 + i, 'node.progress', {
          nodeId: 'ask',
          progress: { item: { id: `item-${batch}-${i}`, type: 'reasoning', summary: 'thinking' } },
        }),
      ),
    ),
  );
  await screen.findByText('Timeline (203 events, live)');
  await waitFor(() => expect(count.run()).toBeGreaterThan(before.run));
  await new Promise((resolve) => setTimeout(resolve, 2 * LIVE_REFRESH_MS));
  // Progress changes neither the context thread nor the latest evidence, so neither is read.
  expect(count.currentThread()).toBe(before.thread);
  expect(count.observation()).toBe(before.observation);
  expect(count.historicalThread()).toEqual([]);
  view.unmount();
});

it('reads a selected completion exactly once and refreshes the hidden current thread only when shown again (#186)', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const { run, view, count } = await followRunning(api);
  await deliverBatches(api, run.id, [cyclePass(run.id, 3, 1)]);
  await waitFor(() => expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 1'));
  const timeline = screen.getByRole('list', { name: 'Timeline' });
  // Selecting the Grow completion reads its thread and the one before it, for the patch diff.
  await user.click(within(timeline).getByText('#4'));
  await screen.findByText('Thread at event 4');
  const diff = await screen.findByRole('list', { name: 'Patch diff' });
  expect(within(diff).getByText('/vars/n')).toBeInTheDocument();
  expect(
    count
      .historicalThread()
      .map((call) => call.search.get('at'))
      .sort(),
  ).toEqual(['3', '4']);
  const hidden = count.currentThread();
  const runs = count.run();
  await deliverBatches(api, run.id, [cyclePass(run.id, 8, 2), cyclePass(run.id, 13, 3)]);
  await waitFor(() => expect(count.run()).toBeGreaterThan(runs));
  await new Promise((resolve) => setTimeout(resolve, 2 * LIVE_REFRESH_MS));
  // The selected thread stays on screen and nothing reads the hidden current thread.
  expect(screen.getByText('Thread at event 4')).toBeInTheDocument();
  expect(count.currentThread()).toBe(hidden);
  expect(count.historicalThread()).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Follow live' }));
  await waitFor(() => expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 3'));
  expect(screen.getByRole('heading', { name: 'Current thread' })).toBeInTheDocument();
  expect(count.currentThread()).toBe(hidden + 1);
  expect(count.historicalThread()).toHaveLength(2);
  view.unmount();
});

/** A promise the test resolves when it chooses. */
function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

it('reads the context again when a live batch overtakes the first thread read (#186 review)', async () => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'running' });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  // The first current-thread read takes its snapshot before the pass arrives, then is held.
  const held = barrier();
  let first = true;
  api.override('GET /runs/:id/thread', async (call) => {
    const response = await api.builtIn(call);
    if (first && !call.search.has('at')) {
      first = false;
      await held.promise;
    }
    return response;
  });
  const view = renderApp(`/runs/${run.id}`, api);
  await waitFor(() => expect(first).toBe(false));
  act(() => {
    for (const item of cyclePass(run.id, 3, 1)) api.pushEvent(run.id, item);
  });
  await screen.findByText('Timeline (7 events, live)');
  // The pass reached the live refresh, which read the run record while the first read waited.
  await waitFor(() => expect(api.callsTo('GET', `/runs/${run.id}`).length).toBeGreaterThan(1));
  await act(async () => {
    held.release();
    await held.promise;
  });
  await waitFor(() => expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 1'));
  view.unmount();
});

it('serializes the return to the current thread with the next live refresh (#186 review)', async () => {
  const api = new FakeApi();
  const user = userEvent.setup();
  const { run, view } = await followRunning(api);
  await deliverBatches(api, run.id, [cyclePass(run.id, 3, 1)]);
  await waitFor(() => expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 1'));
  await user.click(within(screen.getByRole('list', { name: 'Timeline' })).getByText('#4'));
  await screen.findByText('Thread at event 4');
  // A thread change while the selection is shown leaves the current thread stale.
  const runs = api.callsTo('GET', `/runs/${run.id}`).length;
  await deliverBatches(api, run.id, [cyclePass(run.id, 8, 2)]);
  await waitFor(() => expect(api.callsTo('GET', `/runs/${run.id}`).length).toBeGreaterThan(runs));
  await new Promise((resolve) => setTimeout(resolve, 2 * LIVE_REFRESH_MS));
  const held = barrier();
  let inFlight = 0;
  let most = 0;
  let reads = 0;
  api.override('GET /runs/:id/thread', async (call) => {
    if (call.search.has('at')) return api.builtIn(call);
    const response = await api.builtIn(call);
    reads++;
    inFlight++;
    most = Math.max(most, inFlight);
    if (reads === 1) await held.promise;
    inFlight--;
    return response;
  });
  try {
    await user.click(screen.getByRole('button', { name: 'Follow live' }));
    await waitFor(() => expect(reads).toBe(1));
    act(() => {
      for (const item of cyclePass(run.id, 13, 3)) api.pushEvent(run.id, item);
    });
    await screen.findByText('Timeline (17 events, live)');
    // The pass asks for another thread read; it waits for the return read instead of starting
    // beside it, however long that read takes.
    await new Promise((resolve) => setTimeout(resolve, 3 * LIVE_REFRESH_MS));
    expect(reads).toBe(1);
    expect(most).toBe(1);
  } finally {
    await act(async () => {
      held.release();
      await held.promise;
    });
  }
  await waitFor(() => expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 3'));
  await waitFor(() => expect(reads).toBe(2));
  expect(most).toBe(1);
  view.unmount();
});

it('keeps the thread on screen while a new selection is read, not an older selection (#186 QA)', async () => {
  const api = new FakeApi();
  const user = userEvent.setup();
  const { run, view } = await followRunning(api);
  await deliverBatches(api, run.id, [cyclePass(run.id, 3, 1)]);
  const timeline = screen.getByRole('list', { name: 'Timeline' });
  await user.click(within(timeline).getByText('#4'));
  await screen.findByText('Thread at event 4');
  await user.click(screen.getByRole('button', { name: 'Follow live' }));
  await deliverBatches(api, run.id, [cyclePass(run.id, 8, 2)]);
  await waitFor(() => expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 2'));
  expect(screen.getByRole('heading', { name: 'Current thread' })).toBeInTheDocument();
  const held = barrier();
  api.override('GET /runs/:id/thread', async (call) => {
    if (call.search.has('at')) await held.promise;
    return api.builtIn(call);
  });
  await user.click(within(timeline).getByText('#9'));
  await screen.findByText('Reading the thread at event 9…');
  // The reader left the current thread, so it stays until event 9's thread is read.
  expect(screen.getByRole('heading', { name: 'Current thread' })).toBeInTheDocument();
  expect(screen.queryByText('Thread at event 4')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 2');
  await act(async () => {
    held.release();
    await held.promise;
  });
  await screen.findByText('Thread at event 9');
  expect(screen.getByLabelText('Variables')).toHaveTextContent('"n": 2');
  view.unmount();
});
