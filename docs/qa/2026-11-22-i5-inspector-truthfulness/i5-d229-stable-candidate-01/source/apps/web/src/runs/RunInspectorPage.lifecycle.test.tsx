import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { MAX_HISTORY_BYTES, useRunEventStore } from './event-store.js';

const actor = { kind: 'user' as const, id: 'local' };
const UPDATED = /Status from event #\d+; the run record is updating\./;

/** A running record at `run.started`, with that history recorded. */
function startedRun(api: FakeApi, overrides: Partial<RunRecord> = {}) {
  const run = api.addRun({ status: 'running', lastEventSeq: 2, ...overrides });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  return run;
}

/** Holds every run read once `state.blocking` is set, until `release`; records what each returned. */
function heldRunReads(api: FakeApi, runId: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = {
    blocking: false,
    held: 0,
    returned: [] as { status: string; lastEventSeq: number }[],
  };
  api.override('GET /runs/:id', async (call) => {
    if (state.blocking) {
      state.held += 1;
      await gate;
      const row = api.runs.get(runId)!;
      state.returned.push({ status: row.status, lastEventSeq: row.lastEventSeq });
    }
    return api.builtIn(call);
  });
  return { state, release: () => release() };
}

/** Answers the run observation with `choose(the server's lifecycle)` as its lifecycle. */
function observedLifecycle(
  api: FakeApi,
  choose: (current: RunEvent | undefined) => RunEvent | undefined,
) {
  api.override('GET /runs/:id/observation', async (call) => {
    const body = (await (await api.builtIn(call)).json()) as { lifecycle?: RunEvent };
    return new Response(JSON.stringify({ ...body, lifecycle: choose(body.lifecycle) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

async function openInspector(runId: string) {
  const heading = await screen.findByRole('heading', { name: 'Run ' + runId });
  const header = heading.closest('header')!;
  const timeline = await screen.findByRole('list', { name: 'Timeline' });
  await within(timeline).findAllByRole('button', { name: /run\.started/ });
  return { header, timeline };
}

const badge = (header: HTMLElement) => header.querySelector('[data-status]');

describe('run header status follows observed lifecycle events (#386)', () => {
  it.each([
    { name: 'the refresh after the terminal event is held', releaseStaleRow: false },
    {
      name: 'the refreshed record has the terminal sequence but the earlier status',
      releaseStaleRow: true,
    },
  ])('shows the terminal status when $name', async ({ releaseStaleRow }) => {
    const api = new FakeApi();
    const run = startedRun(api);
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      expect(badge(header)).toHaveAttribute('data-status', 'running');
      expect(
        api
          .callsTo('GET', `/runs/${run.id}/events`)
          .some((call) => call.headers.get('accept') === 'text/event-stream'),
      ).toBe(true);

      const terminal = event(run.id, 3, 'run.finished', {
        status: 'succeeded',
        outcome: 'success',
      });
      reads.state.blocking = true;
      api.runs.set(run.id, {
        ...run,
        status: 'running',
        lastEventSeq: terminal.seq,
        currentNodeId: 'stale-position',
      });
      act(() => api.pushEvent(run.id, terminal));
      const terminalRow = await within(timeline).findByRole('button', {
        name: /run\.finished.*succeeded/,
      });
      expect(terminalRow).toHaveTextContent('#3');
      await waitFor(() => expect(reads.state.held).toBeGreaterThan(0), { timeout: 5000 });
      expect(reads.state.returned).toHaveLength(0);

      if (releaseStaleRow) {
        reads.release();
        // The stale record was read and is the one on screen.
        await waitFor(() =>
          expect(
            view.queryClient.getQueryData<{ currentNodeId?: string }>(keys.run(run.id))
              ?.currentNodeId,
          ).toBe('stale-position'),
        );
        expect(reads.state.returned[0]).toEqual({ status: 'running', lastEventSeq: terminal.seq });
      }

      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'succeeded'));
      expect(
        within(header).getByText('Status from event #3; the run record is updating.'),
      ).toBeVisible();
      // The record's position is not claimed beside an outcome it has not caught up with.
      expect(within(header).queryByText(/^at .*stale-position/)).toBeNull();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it.each([
    {
      status: 'failed',
      outcome: (id: string) =>
        event(id, 3, 'run.failed', {
          failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: false },
        }),
    },
    { status: 'cancelled', outcome: (id: string) => event(id, 3, 'run.cancelled', {}) },
    {
      status: 'exhausted',
      outcome: (id: string) =>
        event(id, 3, 'run.finished', { status: 'exhausted', outcome: 'exhausted' }),
    },
  ])('shows the recorded $status outcome, not success', async ({ status, outcome }) => {
    const api = new FakeApi();
    const run = startedRun(api);
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      reads.state.blocking = true;
      act(() => api.pushEvent(run.id, outcome(run.id)));
      await within(timeline).findByText('#3');
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', status));
      expect(within(header).getByText(UPDATED)).toBeVisible();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('does not turn a finish with a non-terminal status, or the stream completing, into success', async () => {
    const api = new FakeApi();
    // The fake server completes the stream after this finish, as it does after any outcome.
    const run = startedRun(api, { currentNodeId: 'work' });
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      reads.state.blocking = true;
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', { status: 'running', outcome: 'success' }),
        ),
      );
      await within(timeline).findByRole('button', { name: /run\.finished/ });
      // The completed stream's follower reads the record; that read is held.
      await waitFor(() => expect(reads.state.held).toBeGreaterThan(1), { timeout: 5000 });
      expect(badge(header)).toHaveAttribute('data-status', 'running');
      expect(header.querySelector('[data-status="succeeded"]')).toBeNull();
      expect(within(header).queryByText(UPDATED)).toBeNull();
      expect(within(header).getByText('at work')).toBeVisible();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('keeps the outcome through later delivery events it has seen while the record lags', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      reads.state.blocking = true;
      api.runs.set(run.id, { ...run, status: 'running', lastEventSeq: 5 });
      act(() => {
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
        );
        api.pushEvent(run.id, event(run.id, 4, 'return.delivered', { channel: { kind: 'log' } }));
        api.pushEvent(run.id, event(run.id, 5, 'return.delivered', { channel: { kind: 'log' } }));
      });
      await within(timeline).findByText('#5');
      reads.release();
      await waitFor(() => expect(reads.state.returned.length).toBeGreaterThan(0));
      expect(reads.state.returned[0]).toEqual({ status: 'running', lastEventSeq: 5 });
      await waitFor(() =>
        expect(
          view.queryClient.getQueryData<{ lastEventSeq: number }>(keys.run(run.id))?.lastEventSeq,
        ).toBe(5),
      );
      expect(badge(header)).toHaveAttribute('data-status', 'succeeded');
      expect(
        within(header).getByText('Status from event #3; the run record is updating.'),
      ).toBeVisible();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('says the status is updating, never the old outcome, when a newer record has unseen history', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const failed = event(run.id, 3, 'run.failed', {
      failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: false },
    });
    let frozen = false;
    observedLifecycle(api, (current) => (frozen ? failed : current));
    let releaseHistory!: () => void;
    const history = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    api.override('GET /runs/:id/events', async (call) => {
      if (call.headers.get('accept') !== 'text/event-stream' && call.search.get('after') === '3')
        await history;
      return api.builtIn(call);
    });
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      reads.state.blocking = true;
      act(() => api.pushEvent(run.id, failed));
      await within(timeline).findByRole('button', { name: /run\.failed/ });
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'failed'));
      // Resumed and started again elsewhere after this view's stream completed.
      frozen = true;
      api.events
        .get(run.id)!
        .push(
          event(run.id, 4, 'run.resumed', { actor }),
          event(run.id, 5, 'run.started', { attempt: 2 }),
        );
      api.runs.set(run.id, { ...run, status: 'running', lastEventSeq: 5 });
      reads.release();
      await within(header).findByText('Updating status…');
      expect(badge(header)).toBeNull();
      releaseHistory();
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'running'), {
        timeout: 5000,
      });
      expect(within(header).queryByText(UPDATED)).toBeNull();
    } finally {
      reads.release();
      releaseHistory();
      view.unmount();
    }
  });

  it.each([
    {
      name: 'a resume that parks in a wait again',
      supersede: (id: string) => event(id, 4, 'run.resumed', { actor }),
      next: (id: string) =>
        event(id, 5, 'run.waiting', {
          nodeId: 'w',
          wait: { waitId: 'fixture-wait', startedSeq: 5, nodeId: 'w', kind: 'input' },
        }),
      status: 'waiting',
    },
    {
      name: 'a new attempt',
      supersede: (id: string) => event(id, 4, 'run.started', { attempt: 2 }),
      next: undefined,
      status: 'running',
    },
  ])(
    'replaces an outcome superseded by $name until the record catches up',
    async ({ supersede, next, status }) => {
      const api = new FakeApi();
      const run = startedRun(api);
      const reads = heldRunReads(api, run.id);
      const view = renderApp('/runs/' + run.id, api);
      try {
        const { header, timeline } = await openInspector(run.id);
        reads.state.blocking = true;
        act(() => {
          api.pushEvent(
            run.id,
            event(run.id, 3, 'run.failed', {
              failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: true },
            }),
          );
          api.pushEvent(run.id, supersede(run.id));
        });
        await within(timeline).findByText('#4');
        await within(header).findByText('Updating status…');
        expect(badge(header)).toBeNull();
        expect(within(header).queryByText(UPDATED)).toBeNull();

        const following = next?.(run.id);
        api.runs.set(run.id, {
          ...run,
          status: status === 'waiting' ? 'waiting' : 'running',
          lastEventSeq: following?.seq ?? 4,
        });
        if (following) {
          act(() => api.pushEvent(run.id, following));
          await within(timeline).findByText('#5');
        }
        reads.release();
        await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', status), {
          timeout: 5000,
        });
        expect(header.querySelector('[data-status="failed"]')).toBeNull();
      } finally {
        reads.release();
        view.unmount();
      }
    },
  );

  it('keeps a newer streamed outcome when a later observation still reports the older start', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const started = api.events.get(run.id)![1]!;
    observedLifecycle(api, () => started);
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      const observations = () => api.callsTo('GET', `/runs/${run.id}/observation`).length;
      const before = observations();
      reads.state.blocking = true;
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
        ),
      );
      await within(timeline).findByText('#3');
      await waitFor(() => expect(observations()).toBeGreaterThan(before), { timeout: 5000 });
      await waitFor(() =>
        expect(view.queryClient.isFetching({ queryKey: keys.observation(run.id) })).toBe(0),
      );
      expect(badge(header)).toHaveAttribute('data-status', 'succeeded');
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('takes the outcome from a batch the browsed history window does not keep, however large', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const reads = heldRunReads(api, run.id);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      // The reader browses history, as the Timeline's paging does.
      act(() => useRunEventStore.getState().pause(run.id));
      await screen.findByText(/Following paused\./);
      reads.state.blocking = true;
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', {
            status: 'succeeded',
            outcome: 'success',
            result: 'r'.repeat(MAX_HISTORY_BYTES),
          }),
        ),
      );
      await waitFor(() => expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3));
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'succeeded'));
      expect(within(timeline).queryByRole('button', { name: /run\.finished/ })).toBeNull();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('ignores a cached terminal from an earlier visit and a selected historical outcome', async () => {
    const api = new FakeApi();
    const run = startedRun(api, { lastEventSeq: 5 });
    const failed = event(run.id, 3, 'run.failed', {
      failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: true },
    });
    api.pushEvent(run.id, failed);
    api.pushEvent(run.id, event(run.id, 4, 'run.resumed', { actor }));
    api.pushEvent(run.id, event(run.id, 5, 'run.started', { attempt: 2 }));
    const [queued, started] = api.events.get(run.id)!;
    act(() => useRunEventStore.getState().append(run.id, queued!, started!, failed));
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      await within(timeline).findByText('#5');
      expect(badge(header)).toHaveAttribute('data-status', 'running');
      const failedRow = within(timeline).getByRole('button', { name: /run\.failed/ });
      await userEvent.setup().click(failedRow);
      await waitFor(() => expect(failedRow).toHaveAttribute('aria-current', 'true'));
      expect(badge(header)).toHaveAttribute('data-status', 'running');
      expect(within(header).queryByText(UPDATED)).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('starts over for another run, ignoring the previous run’s outcome', async () => {
    const api = new FakeApi();
    const other = startedRun(api, { currentNodeId: 'other-work' });
    const run = startedRun(api, { parentRunId: other.id });
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
        ),
      );
      await within(timeline).findByText('#3');
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'succeeded'));
      await userEvent.setup().click(within(header).getByRole('link', { name: 'parent run' }));
      const next = await openInspector(other.id);
      expect(badge(next.header)).toHaveAttribute('data-status', 'running');
      expect(within(next.header).getByText('at other-work')).toBeVisible();
      expect(within(next.header).queryByText(UPDATED)).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
