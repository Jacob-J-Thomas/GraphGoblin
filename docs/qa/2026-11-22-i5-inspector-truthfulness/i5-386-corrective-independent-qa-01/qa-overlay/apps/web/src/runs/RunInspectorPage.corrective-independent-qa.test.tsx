import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { useRunEventStore } from './event-store.js';

// Desired outcomes were fixed from scan 1 and D224 before seeing corrective product code.
// Historical observed-defect characterization files remain unchanged in scan-1 evidence.
const actor = { kind: 'user' as const, id: 'corrective-qa' };

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function failure(runId: string, seq: number, nodeId: string) {
  return event(runId, seq, 'run.failed', {
    failure: {
      code: 'INTERNAL_ERROR',
      message: `recorded failure at ${nodeId}`,
      nodeId,
      resumable: true,
    },
  });
}

function header(runId: string) {
  return screen.getByRole('heading', { name: `Run ${runId}` }).closest('header')!;
}

function seed(api: FakeApi, overrides: Partial<RunRecord> = {}) {
  const run = api.addRun({
    status: 'running',
    lastEventSeq: 2,
    currentNodeId: 'old-node',
    ...overrides,
  });
  useRunEventStore.getState().clear(run.id);
  api.events.set(run.id, [
    event(run.id, 1, 'run.queued', queuedFields()),
    event(run.id, 2, 'run.started', { attempt: 1 }),
  ]);
  return run;
}

function assertNeutral(runId: string) {
  expect(within(header(runId)).getByText('Updating status…')).toBeVisible();
  expect(header(runId).querySelector('[data-status]')).toBeNull();
  expect(within(header(runId)).queryByText(/^at /)).toBeNull();
  expect(within(header(runId)).queryByText(/^Last node in run record:/)).toBeNull();
}

it.each(['observation-first', 'stream-first', 'delayed-terminal-observation'] as const)(
  'corrective R1 desired outcome: %s retains predecessor knowledge and converges to parked waiting',
  async (order) => {
    const api = new FakeApi();
    const run = seed(api);
    const failed = failure(run.id, 3, 'old-node');
    const resumed = event(run.id, 4, 'run.resumed', { actor });
    api.events.get(run.id)!.push(failed, resumed);
    const stream = gate();
    const observation = gate();
    const freshRows = gate();
    let rowReads = 0;
    let allowCurrentObservation = false;
    api.override('GET /runs/:id', async (call) => {
      if (++rowReads > 1) await freshRows.promise;
      return api.builtIn(call);
    });
    api.override('GET /runs/:id/events', async (call) => {
      if (call.headers.get('accept') === 'text/event-stream') await stream.promise;
      return api.builtIn(call);
    });
    api.override('GET /runs/:id/observation', async (call) => {
      if (order !== 'observation-first') await observation.promise;
      const body = (await (await api.builtIn(call)).json()) as Record<string, unknown>;
      return json({
        ...body,
        lifecycle:
          order === 'delayed-terminal-observation' && !allowCurrentObservation ? failed : resumed,
      });
    });
    if (order === 'delayed-terminal-observation') {
      // Cursor already covers #3, but cached payloads are not receipt authority for the header.
      act(() => useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!.slice(0, 3)));
    }
    const view = renderApp(`/runs/${run.id}`, api);
    const cachedLifecycle = () =>
      view.queryClient.getQueryData<{ lifecycle?: RunEvent }>(keys.observation(run.id))?.lifecycle;
    try {
      await screen.findByRole('heading', { name: `Run ${run.id}` });
      if (order === 'observation-first')
        await waitFor(() =>
          expect(cachedLifecycle()).toMatchObject({ type: 'run.resumed', seq: 4 }),
        );
      act(() => stream.release());
      const timeline = await screen.findByRole('list', { name: 'Timeline' });
      await within(timeline).findByRole('button', { name: /run\.resumed/ });
      if (order !== 'observation-first') {
        observation.release();
        await waitFor(() =>
          expect(cachedLifecycle()).toMatchObject({
            seq: order === 'delayed-terminal-observation' ? 3 : 4,
          }),
        );
      }
      expect(view.queryClient.getQueryData<RunRecord>(keys.run(run.id))).toMatchObject({
        status: 'running',
        lastEventSeq: 2,
        currentNodeId: 'old-node',
      });
      assertNeutral(run.id);

      api.runs.set(run.id, {
        ...run,
        status: 'waiting',
        lastEventSeq: 4,
        currentNodeId: 'parked-node',
      });
      allowCurrentObservation = true;
      freshRows.release();
      await waitFor(() =>
        expect(view.queryClient.getQueryData<RunRecord>(keys.run(run.id))).toMatchObject({
          status: 'waiting',
          lastEventSeq: 4,
        }),
      );
      await waitFor(() =>
        expect(header(run.id).querySelector('[data-status]')).toHaveAttribute(
          'data-status',
          'waiting',
        ),
      );
      expect(within(header(run.id)).getByText('at parked-node')).toBeVisible();
      expect(header(run.id).querySelector('[data-status="failed"]')).toBeNull();
    } finally {
      view.unmount();
      stream.release();
      observation.release();
      freshRows.release();
    }
  },
);

it.each([
  { name: 'older row', seq: 3, node: 'first-node', eventDerived: true },
  { name: 'equal-sequence row', seq: 8, node: 'first-node', eventDerived: false },
  { name: 'fresh agreeing row', seq: 9, node: 'second-node', eventDerived: false },
])(
  'corrective R2 desired outcome: $name never presents a terminal node without its source',
  async ({ seq, node, eventDerived }) => {
    const api = new FakeApi();
    const run = seed(api, {
      status: 'failed',
      lastEventSeq: seq,
      currentNodeId: node,
      failure: { code: 'INTERNAL_ERROR', message: 'captured row', nodeId: node, resumable: true },
    });
    api.events
      .get(run.id)!
      .push(
        failure(run.id, 3, 'first-node'),
        event(run.id, 4, 'run.resumed', { actor }),
        event(run.id, 5, 'node.started', {
          nodeId: 'first-node',
          kind: 'mutate',
          attempt: 2,
          configHash: 'qa',
        }),
        event(run.id, 6, 'node.finished', { nodeId: 'first-node', durationMs: 1, patch: [] }),
        event(run.id, 7, 'node.started', {
          nodeId: 'second-node',
          kind: 'mutate',
          attempt: 1,
          configHash: 'qa',
        }),
        failure(run.id, 8, 'second-node'),
        event(run.id, 9, 'return.delivered', { channel: { kind: 'log' } }),
      );
    const freshRows = gate();
    let reads = 0;
    api.override('GET /runs/:id', async (call) => {
      if (++reads > 1) await freshRows.promise;
      return api.builtIn(call);
    });
    const view = renderApp(`/runs/${run.id}`, api);
    try {
      const timeline = await screen.findByRole('list', { name: 'Timeline' });
      await within(timeline).findByText('#9');
      expect(within(timeline).getAllByRole('button', { name: /run\.failed/ })).toHaveLength(2);
      expect(header(run.id).querySelector('[data-status]')).toHaveAttribute(
        'data-status',
        'failed',
      );
      expect(within(header(run.id)).queryByText(`at ${node}`)).toBeNull();
      if (eventDerived)
        expect(
          within(header(run.id)).getByText('Status from event #8; the run record is updating.'),
        ).toBeVisible();
      else
        expect(within(header(run.id)).getByText(`Last node in run record: ${node}`)).toBeVisible();

      api.runs.set(run.id, {
        ...run,
        status: 'failed',
        lastEventSeq: 9,
        currentNodeId: 'second-node',
        failure: {
          code: 'INTERNAL_ERROR',
          message: 'fresh row',
          nodeId: 'second-node',
          resumable: true,
        },
      });
      freshRows.release();
      await waitFor(() =>
        expect(view.queryClient.getQueryData<RunRecord>(keys.run(run.id))).toMatchObject({
          status: 'failed',
          lastEventSeq: 9,
          currentNodeId: 'second-node',
        }),
      );
      await waitFor(() =>
        expect(
          within(header(run.id)).getByText('Last node in run record: second-node'),
        ).toBeVisible(),
      );
      expect(within(header(run.id)).queryByText('Updating status…')).toBeNull();
    } finally {
      view.unmount();
      freshRows.release();
    }
  },
);

it.each([false, true])(
  'corrective R3 desired outcome: A to B to A preserves supersession (cleanup buffer=%s)',
  async (cleanupBuffer) => {
    const api = new FakeApi();
    const b = seed(api, { currentNodeId: 'B-node' });
    const a = seed(api, { parentRunId: b.id });
    api.runs.set(b.id, { ...b, parentRunId: a.id });
    const failed = failure(a.id, 3, 'old-node');
    api.events.get(a.id)!.push(failed);
    // The retained cursor includes the old failure; it cannot substitute for receipt authority.
    act(() => useRunEventStore.getState().append(a.id, ...api.events.get(a.id)!));
    const stream = gate();
    const freshReads = gate();
    let rowReads = 0;
    let observationReads = 0;
    let returnedAfterResume = false;
    api.override('GET /runs/:id', async (call) => {
      if (call.path === `/runs/${a.id}` && ++rowReads > 1) await freshReads.promise;
      return api.builtIn(call);
    });
    api.override('GET /runs/:id/observation', async (call) => {
      if (call.path === `/runs/${a.id}/observation` && ++observationReads > 1)
        await freshReads.promise;
      return api.builtIn(call);
    });
    api.override('GET /runs/:id/events', async (call) => {
      if (
        call.path === `/runs/${a.id}/events` &&
        call.headers.get('accept') === 'text/event-stream'
      ) {
        if (call.search.get('after') === '4') returnedAfterResume = true;
        await stream.promise;
      }
      return api.builtIn(call);
    });
    const view = renderApp(`/runs/${a.id}`, api);
    try {
      await screen.findByRole('heading', { name: `Run ${a.id}` });
      await waitFor(() =>
        expect(
          view.queryClient.getQueryData<{ lifecycle?: RunEvent }>(keys.observation(a.id))
            ?.lifecycle,
        ).toMatchObject({ type: 'run.failed', seq: 3 }),
      );
      api.events.get(a.id)!.push(event(a.id, 4, 'run.resumed', { actor }));
      if (cleanupBuffer) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await act(async () => {
        stream.release();
        // Let the local transport parse accepted bytes without advancing its 100 ms flush timer.
        for (let tick = 0; tick < 16; tick++) await Promise.resolve();
      });
      if (cleanupBuffer) {
        expect(useRunEventStore.getState().runs[a.id]?.lastSeq).toBe(3);
      } else {
        await within(header(a.id)).findByText('Updating status…');
        expect(useRunEventStore.getState().runs[a.id]?.lastSeq).toBe(4);
      }
      fireEvent.click(within(header(a.id)).getByRole('link', { name: 'parent run' }));
      if (cleanupBuffer) {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
      await screen.findByRole('heading', { name: `Run ${b.id}` });
      expect(useRunEventStore.getState().runs[a.id]?.lastSeq).toBe(4);
      expect(header(b.id).querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
      fireEvent.click(within(header(b.id)).getByRole('link', { name: 'parent run' }));
      await screen.findByRole('heading', { name: `Run ${a.id}` });
      await waitFor(() => expect(returnedAfterResume).toBe(true));
      expect(
        view.queryClient.getQueryData<{ lifecycle?: RunEvent }>(keys.observation(a.id))?.lifecycle,
      ).toMatchObject({ type: 'run.failed', seq: 3 });
      assertNeutral(a.id);

      api.runs.set(a.id, {
        ...a,
        status: 'waiting',
        lastEventSeq: 4,
        currentNodeId: 'parked-node',
      });
      freshReads.release();
      await waitFor(() =>
        expect(header(a.id).querySelector('[data-status]')).toHaveAttribute(
          'data-status',
          'waiting',
        ),
      );
      expect(within(header(a.id)).getByText('at parked-node')).toBeVisible();
    } finally {
      vi.useRealTimers();
      view.unmount();
      stream.release();
      freshReads.release();
    }
  },
);
