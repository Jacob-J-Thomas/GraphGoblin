import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { API_KEY_STORAGE, useApiKeyStore } from '../api/api-key.js';
import { keys } from '../api/queries.js';
import { useRunEventStore } from './event-store.js';

const actor = { kind: 'user' as const, id: 'local' };
const UPDATING = 'Updating status…';
const failure = (resumable: boolean) => ({
  code: 'INTERNAL_ERROR' as const,
  message: 'boom',
  resumable,
});

function startedRun(api: FakeApi, overrides: Partial<RunRecord> = {}) {
  const run = api.addRun({ status: 'running', lastEventSeq: 2, ...overrides });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  return run;
}

/** Holds run reads while `state.blocking`, until released; the row is read on release. */
function heldRunReads(api: FakeApi) {
  let release!: () => void;
  const hold = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  let gate = hold();
  const state = { blocking: false, held: 0 };
  api.override('GET /runs/:id', async (call) => {
    if (state.blocking) {
      state.held += 1;
      await gate;
    }
    return api.builtIn(call);
  });
  return {
    state,
    release: () => {
      state.blocking = false;
      release();
      gate = hold();
    },
  };
}

/** Answers observations with `choose(the server's lifecycle)`. */
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

/** Records whether a failed badge is ever shown in `header`. */
function watchFailed(header: HTMLElement) {
  const seen = { failed: false };
  const observer = new MutationObserver(() => {
    if (header.querySelector('[data-status="failed"]')) seen.failed = true;
  });
  observer.observe(header, { subtree: true, childList: true, attributes: true });
  return { seen, stop: () => observer.disconnect() };
}

afterEach(() => {
  localStorage.removeItem(API_KEY_STORAGE);
  useApiKeyStore.setState({ key: undefined, rejected: false });
});

describe('run header corrective cases (#386)', () => {
  it.each([
    { order: 'the observation reports the resume first, then a delayed failure', observed: true },
    { order: 'the stream delivers the failure and resume first', observed: false },
  ])('stays neutral, never failed, when $order (R1)', async ({ observed }) => {
    const api = new FakeApi();
    const run = startedRun(api);
    const failed = event(run.id, 3, 'run.failed', { failure: failure(true) });
    const resumed = event(run.id, 4, 'run.resumed', { actor });
    let observations = 0;
    // A resume read first; later reads still report the failure it superseded.
    if (observed)
      observedLifecycle(api, (current) =>
        current?.runId === run.id ? (observations++ === 0 ? resumed : failed) : current,
      );
    const reads = heldRunReads(api);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      reads.state.blocking = true;
      // Once the resume is known, the failure must never be shown.
      let watch: ReturnType<typeof watchFailed> | undefined;
      if (observed) {
        await within(header).findByText(UPDATING);
        expect(badge(header)).toBeNull();
        watch = watchFailed(header);
      }
      act(() => {
        api.pushEvent(run.id, failed);
        api.pushEvent(run.id, resumed);
      });
      await within(timeline).findByText('#4');
      watch ??= watchFailed(header);
      await waitFor(() => expect(reads.state.held).toBeGreaterThan(0), { timeout: 5000 });
      // The only record is still running at #2: the earlier attempt's.
      expect(within(header).getByText(UPDATING)).toBeVisible();
      expect(within(header).queryByText(/^at /)).toBeNull();
      if (observed) await waitFor(() => expect(observations).toBeGreaterThan(1));

      api.runs.set(run.id, { ...run, status: 'waiting', lastEventSeq: 5 });
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 5, 'run.waiting', {
            nodeId: 'w',
            wait: { waitId: 'fixture-wait', startedSeq: 5, nodeId: 'w', kind: 'input' },
          }),
        ),
      );
      reads.release();
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'waiting'), {
        timeout: 5000,
      });
      expect(watch.seen.failed).toBe(false);
      watch.stop();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('shows a new failure over an older failed record and attributes a record node (R2)', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const reads = heldRunReads(api);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      // The first attempt fails at node A; its record agrees and settles.
      api.runs.set(run.id, { ...run, status: 'failed', lastEventSeq: 3, currentNodeId: 'node-a' });
      act(() => api.pushEvent(run.id, event(run.id, 3, 'run.failed', { failure: failure(false) })));
      await within(timeline).findByText('#3');
      await within(header).findByText('Last node in run record: node-a');
      expect(badge(header)).toHaveAttribute('data-status', 'failed');

      // Elsewhere it is resumed and fails again at node B; this view reads that observation
      // while the record it holds is still the first failure's.
      reads.state.blocking = true;
      api.events
        .get(run.id)!
        .push(
          event(run.id, 4, 'run.resumed', { actor }),
          event(run.id, 5, 'run.started', { attempt: 2 }),
          event(run.id, 6, 'run.failed', { failure: failure(false) }),
        );
      await act(() => view.queryClient.invalidateQueries({ queryKey: keys.observation(run.id) }));
      await within(header).findByText('Status from event #6; the run record is updating.');
      expect(badge(header)).toHaveAttribute('data-status', 'failed');
      expect(within(header).queryByText('Last node in run record: node-a')).toBeNull();

      // A record at the outcome's sequence whose position may not be projected yet.
      api.runs.set(run.id, { ...run, status: 'failed', lastEventSeq: 6, currentNodeId: 'node-a' });
      reads.release();
      await act(() => view.queryClient.invalidateQueries({ queryKey: keys.run(run.id) }));
      await waitFor(() =>
        expect(
          view.queryClient.getQueryData<{ lastEventSeq: number }>(keys.run(run.id))?.lastEventSeq,
        ).toBe(6),
      );
      await within(header).findByText('Last node in run record: node-a');
      expect(within(header).queryByText(/^at /)).toBeNull();
      expect(within(header).queryByText(/Status from event/)).toBeNull();

      // The stable record settles with its own node, and never says it is updating.
      api.runs.set(run.id, { ...run, status: 'failed', lastEventSeq: 6, currentNodeId: 'node-b' });
      await act(() => view.queryClient.invalidateQueries({ queryKey: keys.run(run.id) }));
      await within(header).findByText('Last node in run record: node-b');
      expect(badge(header)).toHaveAttribute('data-status', 'failed');
      expect(within(header).queryByText(UPDATING)).toBeNull();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('keeps a resumed run neutral across A → B → A with held reads and a stale observation (R3)', async () => {
    const api = new FakeApi();
    const b = startedRun(api, { currentNodeId: 'b-work' });
    const a = startedRun(api, { parentRunId: b.id });
    api.runs.set(b.id, { ...api.runs.get(b.id)!, parentRunId: a.id });
    const failed = event(a.id, 3, 'run.failed', { failure: failure(true) });
    let stale = false;
    observedLifecycle(api, (current) => (stale && current?.runId === a.id ? failed : current));
    const reads = heldRunReads(api);
    const user = userEvent.setup();
    const view = renderApp('/runs/' + a.id, api);
    try {
      let { header, timeline } = await openInspector(a.id);
      reads.state.blocking = true;
      act(() => {
        api.pushEvent(a.id, failed);
        api.pushEvent(a.id, event(a.id, 4, 'run.resumed', { actor }));
      });
      await within(timeline).findByRole('button', { name: /run\.failed/ });
      await within(timeline).findByText('#4');
      // The resume is accepted: the failure it superseded is not the run's status.
      await within(header).findByText(UPDATING);
      reads.release();
      stale = true;
      await user.click(within(header).getByRole('link', { name: 'parent run' }));
      ({ header } = await openInspector(b.id));
      expect(badge(header)).toHaveAttribute('data-status', 'running');
      expect(within(header).getByText('at b-work')).toBeVisible();

      reads.state.blocking = true;
      await user.click(within(header).getByRole('link', { name: 'parent run' }));
      ({ header, timeline } = await openInspector(a.id));
      const watch = watchFailed(header);
      await within(timeline).findByText('#4');
      await waitFor(() => expect(reads.state.held).toBeGreaterThan(0), { timeout: 5000 });
      await waitFor(() =>
        expect(view.queryClient.isFetching({ queryKey: keys.observation(a.id) })).toBe(0),
      );
      expect(within(header).getByText(UPDATING)).toBeVisible();

      api.runs.set(a.id, { ...a, status: 'running', lastEventSeq: 4, currentNodeId: 'a-work' });
      reads.release();
      await within(header).findByText('at a-work');
      expect(badge(header)).toHaveAttribute('data-status', 'running');
      expect(watch.seen.failed).toBe(false);
      watch.stop();
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('shows nothing from an earlier credential generation until current reads settle it', async () => {
    useApiKeyStore.getState().save('gg_good');
    const api = new FakeApi();
    const run = startedRun(api, { currentNodeId: 'work' });
    const reads = heldRunReads(api);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const { header, timeline } = await openInspector(run.id);
      reads.state.blocking = true;
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
        ),
      );
      await within(timeline).findByText('#3');
      await waitFor(() => expect(badge(header)).toHaveAttribute('data-status', 'succeeded'));

      act(() => useApiKeyStore.getState().markRejected());
      expect(within(header).getByText(UPDATING)).toBeVisible();
      expect(within(header).queryByText(/Status from event|^at /)).toBeNull();
      // The same key accepted again: the cached record and the old evidence stay withheld.
      act(() => useApiKeyStore.getState().save('gg_good'));
      expect(within(header).getByText(UPDATING)).toBeVisible();
      expect(within(header).queryByText(/Status from event|^at /)).toBeNull();

      api.runs.set(run.id, { ...run, status: 'succeeded', lastEventSeq: 3, currentNodeId: 'done' });
      reads.release();
      await act(() => view.queryClient.invalidateQueries({ queryKey: keys.run(run.id) }));
      await within(header).findByText('Last node in run record: done');
      expect(badge(header)).toHaveAttribute('data-status', 'succeeded');

      // Another tab replacing the key retires this generation too, until its own read.
      localStorage.setItem(API_KEY_STORAGE, 'gg_next');
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
      });
      await waitFor(() =>
        expect(api.callsTo('GET', `/runs/${run.id}`).at(-1)?.headers.get('authorization')).toBe(
          'Bearer gg_next',
        ),
      );
      await within(header).findByText('Last node in run record: done');
      expect(JSON.stringify(useRunEventStore.getState())).not.toContain('gg_');
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('settles a cold finished run past its delivery audits from real reads only', async () => {
    const api = new FakeApi();
    const run = startedRun(api, { status: 'succeeded', lastEventSeq: 5, currentNodeId: 'done' });
    api.pushEvent(
      run.id,
      event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
    );
    api.pushEvent(run.id, event(run.id, 4, 'return.delivered', { channel: { kind: 'log' } }));
    api.pushEvent(run.id, event(run.id, 5, 'return.delivered', { channel: { kind: 'log' } }));
    // A cursor retained from an earlier page: the stream resumes after the audits.
    act(() => useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!));
    let releaseObservation!: () => void;
    const observation = new Promise<void>((resolve) => (releaseObservation = resolve));
    api.override('GET /runs/:id/observation', async (call) => {
      await observation;
      return api.builtIn(call);
    });
    const reads = heldRunReads(api);
    reads.state.blocking = true;
    const view = renderApp('/runs/' + run.id, api);
    try {
      await waitFor(() => expect(reads.state.held).toBeGreaterThan(0));
      // Nothing is claimed while the authorized reads are held.
      expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).toBeNull();
      reads.release();
      releaseObservation();
      const { header } = await openInspector(run.id);
      await waitFor(() =>
        expect(view.queryClient.getQueryState(keys.observation(run.id))?.status).toBe('success'),
      );
      expect(badge(header)).toHaveAttribute('data-status', 'succeeded');
      expect(within(header).getByText('Last node in run record: done')).toBeVisible();
      expect(within(header).queryByText(UPDATING)).toBeNull();
      expect(
        api
          .callsTo('GET', `/runs/${run.id}/events`)
          .filter((call) => call.headers.get('accept') === 'text/event-stream')
          .every((call) => call.search.get('after') === '5' || call.search.get('after') === null),
      ).toBe(true);
    } finally {
      reads.release();
      releaseObservation();
      view.unmount();
    }
  });
});
