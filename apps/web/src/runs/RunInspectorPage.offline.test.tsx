import { runs } from '@graphgoblin/api-client';
import type { RunRecord } from '@graphgoblin/contracts';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp, type Rendered } from '../__fixtures__/render.js';
import { createAppClient } from '../api/context.js';
import { keys } from '../api/queries.js';
import { App } from '../app/App.js';
import { Providers } from '../app/bootstrap.js';
import { NOT_SENT } from './inspector/RunControls.js';

const STALE = 'Last observed, may be out of date';
const UNREACHABLE = /needs the GraphGoblin API, which cannot be reached/;

afterEach(() => {
  onlineManager.setOnline(true);
});

function startedRun(api: FakeApi, overrides: Partial<RunRecord> = {}) {
  const run = api.addRun({
    status: 'running',
    lastEventSeq: 2,
    currentNodeId: 'work',
    ...overrides,
  });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  return run;
}

function waitingRun(api: FakeApi) {
  const waiting = {
    waitId: 'wait-1',
    nodeId: 'ask',
    kind: 'input' as const,
    prompt: 'Why?',
    inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
    startedSeq: 3,
  };
  const run = startedRun(api, {
    status: 'waiting',
    lastEventSeq: 3,
    currentNodeId: 'ask',
    waiting,
  });
  api.pushEvent(run.id, event(run.id, 3, 'run.waiting', { nodeId: 'ask', wait: waiting }));
  return run;
}

/** Failed at `worker` with a missing provider session; a delivery audit follows the failure. */
function missingSessionRun(api: FakeApi) {
  const run = startedRun(api, { status: 'failed', lastEventSeq: 4, currentNodeId: 'worker' });
  const failure: NonNullable<RunRecord['failure']> = {
    code: 'HARNESS_SESSION_MISSING',
    message: 'The provider session old-handle is missing.',
    nodeId: 'worker',
    resumable: false,
    missingSession: {
      visitId: run.id + ':2',
      harness: 'codex',
      sessionId: 'old-handle',
      origin: 'resume-own',
      model: 'gpt-6-luna',
      effort: 'low',
    },
  };
  api.runs.set(run.id, { ...api.runs.get(run.id)!, failure });
  api.pushEvent(run.id, event(run.id, 3, 'run.failed', { failure }));
  api.pushEvent(run.id, event(run.id, 4, 'return.delivered', { channel: { kind: 'log' } }));
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

/** Delays every mutation before its API call until released, as a configured client may. */
function heldMutations(view: Rendered) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { queued: false };
  view.queryClient.setDefaultOptions({
    queries: { retry: false },
    mutations: {
      retry: false,
      onMutate: () => {
        state.queued = true;
        return held;
      },
    },
  });
  return { state, release };
}

const openRun = (runId: string) => screen.findByRole('heading', { name: 'Run ' + runId });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const runRead = (view: Rendered, runId: string) =>
  act(() => view.queryClient.refetchQueries({ queryKey: keys.run(runId), exact: true }));

/** The listener stops answering: the next run read fails as a refused connection would. */
async function loseApi(view: Rendered, runId: string) {
  view.api.offline = true;
  await runRead(view, runId);
  await screen.findByText(STALE);
}

/** The listener answers again and the reread of the failed run query (the probe's) commits. */
async function restoreApi(view: Rendered, runId: string) {
  view.api.offline = false;
  await runRead(view, runId);
  await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
}

const posts = (api: FakeApi) => api.calls.filter((call) => call.method === 'POST');

describe('run inspector through an outage (#416)', () => {
  it('keeps a waiting run, its form and same-wait draft as last observed, and sends nothing', async () => {
    const api = new FakeApi();
    const run = waitingRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await user.type(await screen.findByLabelText('note'), 'kept draft');
      await loseApi(view, run.id);

      const header = screen.getByRole('heading', { name: 'Run ' + run.id }).closest('header')!;
      expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
      expect(
        screen.getByText(/The GraphGoblin API cannot be reached; reconnecting\./),
      ).toBeVisible();
      expect(screen.getByText('Input requested')).toBeVisible();
      expect(screen.getByLabelText('note')).toHaveValue('kept draft');
      for (const name of [
        'Submit input',
        /Pause/,
        /Cancel run/,
        'Replay...',
        'Review delete-ready history',
        'Withdraw delete-ready mark',
      ]) {
        expect(button(name)).toBeDisabled();
      }
      // Reading and editing stay local; keyboard submission sends nothing.
      await user.type(screen.getByLabelText('note'), ' and more{Enter}');
      expect(posts(api)).toHaveLength(0);

      await restoreApi(view, run.id);
      expect(screen.getByLabelText('note')).toHaveValue('kept draft and more');
      await user.click(button('Submit input'));
      await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/input`)).toHaveLength(1));
      expect(api.callsTo('POST', `/runs/${run.id}/input`)[0]!.body).toEqual({
        waitId: 'wait-1',
        input: { note: 'kept draft and more' },
      });
    } finally {
      view.unmount();
    }
  });

  it.each(['failed', 'succeeded'] as const)(
    'keeps a %s run record as last observed without claiming anything more',
    async (status) => {
      const api = new FakeApi();
      const run = startedRun(
        api,
        status === 'failed'
          ? {
              status,
              lastEventSeq: 3,
              failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: false },
            }
          : { status, lastEventSeq: 3, result: { answer: 42 } },
      );
      api.pushEvent(
        run.id,
        status === 'failed'
          ? event(run.id, 3, 'run.failed', { failure: run.failure! })
          : event(run.id, 3, 'run.finished', {
              status,
              outcome: 'success',
              result: { answer: 42 },
            }),
      );
      const view = renderApp('/runs/' + run.id, api);
      try {
        await openRun(run.id);
        await waitFor(() =>
          expect(view.queryClient.getQueryState(keys.observation(run.id))?.status).toBe('success'),
        );
        await loseApi(view, run.id);
        if (status === 'failed') expect(screen.getByText('Failed: INTERNAL_ERROR')).toBeVisible();
        else expect(screen.getByTestId('run-result')).toHaveTextContent('42');
        // Finalization is still pending in the record: the retained view does not invent it.
        expect(screen.getByText('Execution ended; finalization pending.')).toBeVisible();
        expect(screen.queryByText('Fully finalized.')).not.toBeInTheDocument();
        expect(posts(api)).toHaveLength(0);
      } finally {
        view.unmount();
      }
    },
  );

  it('keeps a cold run unavailable', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    api.offline = true;
    const view = renderApp('/runs/' + run.id, api);
    try {
      expect((await screen.findAllByText(UNREACHABLE)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).toBeNull();
      expect(screen.queryByText(STALE)).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('never presents an unread seeded row as last observed', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const client = createAppClient('http://graphgoblin.test', api.fetch);
    // A successful read made before the providers existed: a cache seed, not a receipt.
    const seeded = await runs.get(client, run.id);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(keys.run(run.id), seeded);
    api.offline = true;
    const view = render(
      <Providers client={client} queryClient={queryClient}>
        <MemoryRouter initialEntries={['/runs/' + run.id]}>
          <App />
        </MemoryRouter>
      </Providers>,
    );
    try {
      await waitFor(() =>
        expect(queryClient.getQueryState(keys.run(run.id))?.fetchFailureCount).toBeGreaterThan(0),
      );
      expect((await screen.findAllByText(UNREACHABLE)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).toBeNull();
      expect(screen.queryByText(STALE)).toBeNull();
      expect(queryClient.getQueryData(keys.run(run.id))).toBe(seeded);
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });

  it('retires the fallback on a definitive refusal; only a new valid read restores the run', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const view = renderApp('/runs/' + run.id, api);
    try {
      await openRun(run.id);
      api.override('GET /runs/:id', () => problem(500, 'RUN_READ_FAILED', 'the read failed'));
      await runRead(view, run.id);
      expect(await screen.findByText('Could not load run')).toBeVisible();
      // A later transport error cannot resurrect the refused run.
      api.override('GET /runs/:id', () => {
        throw new TypeError('Failed to fetch');
      });
      await runRead(view, run.id);
      expect((await screen.findAllByText(UNREACHABLE)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).toBeNull();
      expect(screen.queryByText(STALE)).toBeNull();
      api.override('GET /runs/:id', (call) => api.builtIn(call));
      await runRead(view, run.id);
      await openRun(run.id);
      expect(screen.queryByText(STALE)).toBeNull();
      expect(button(/Pause/)).toBeEnabled();
    } finally {
      view.unmount();
    }
  });

  it('stays locked through a browser reconnect and a held pre-loss read; one later read unlocks', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const reads = heldRunReads(api);
    const view = renderApp('/runs/' + run.id, api);
    const runGets = () => api.callsTo('GET', `/runs/${run.id}`).length;
    try {
      await openRun(run.id);
      // The stream's first batch (events 1 and 2) is shown, and the live refresh it requested has
      // read the run once after it and settled. Otherwise that refresh, unrelated to the outage,
      // could join the held read below and read again after it, or follow the recovery read.
      expect(
        await screen.findByRole('heading', { name: /^Timeline \(2 events, / }),
      ).toBeInTheDocument();
      await waitFor(() => expect(runGets()).toBe(2));
      await waitFor(() =>
        expect(view.queryClient.getQueryState(keys.run(run.id))?.fetchStatus).toBe('idle'),
      );
      expect(button(/Pause/)).toBeEnabled();
      // A read starts, and is still in flight when the browser disconnects.
      reads.state.blocking = true;
      void view.queryClient.refetchQueries({ queryKey: keys.run(run.id), exact: true });
      await waitFor(() => expect(reads.state.held).toBe(1));
      act(() => onlineManager.setOnline(false));
      expect(await screen.findByText(/This browser is offline\./)).toBeVisible();
      expect(button(/Pause/)).toBeDisabled();
      // Being online again is not a read: the view stays last observed.
      act(() => onlineManager.setOnline(true));
      expect(await screen.findByText(/Reconnecting: reading this run again\./)).toBeVisible();
      expect(button(/Pause/)).toBeDisabled();
      const before = runGets();
      reads.release();
      await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
      expect(button(/Pause/)).toBeEnabled();
      // The held read started before the disconnect and could not unlock: exactly one did.
      expect(runGets() - before).toBe(1);
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(runGets() - before).toBe(1);
      expect(posts(api)).toHaveLength(0);
    } finally {
      reads.release();
      view.unmount();
    }
  });

  it('expires an open replay review on loss and does not revive it after reconnecting', async () => {
    const api = new FakeApi();
    const run = startedRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await user.click(button('Replay...'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'Create replay run' })).toBeEnabled();
      await loseApi(view, run.id);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await restoreApi(view, run.id);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.callsTo('POST', `/runs/${run.id}/replay`)).toHaveLength(0);
      // A review opened under the current read sends once.
      await user.click(button('Replay...'));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Create replay run',
        }),
      );
      await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/replay`)).toHaveLength(1));
    } finally {
      view.unmount();
    }
  });

  it('expires an open script consent review on loss and sends no resume or replay', async () => {
    const api = new FakeApi();
    const run = startedRun(api, {
      status: 'failed',
      lastEventSeq: 3,
      currentNodeId: 'script',
      failure: {
        code: 'SCRIPT_OUTCOME_UNCERTAIN',
        message: 'uncertain',
        nodeId: 'script',
        resumable: true,
      },
    });
    api.pushEvent(run.id, event(run.id, 3, 'run.failed', { failure: run.failure! }));
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await user.click(button('Recover script'));
      expect(await screen.findByRole('dialog')).toHaveTextContent('Recover script');
      await loseApi(view, run.id);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button('Recover script')).toBeDisabled();
      await restoreApi(view, run.id);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(posts(api)).toHaveLength(0);
      await user.click(button('Recover script'));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume' }),
      );
      await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(1));
      expect(api.callsTo('POST', `/runs/${run.id}/resume`)[0]!.body).toMatchObject({
        retryUncertainScript: true,
      });
    } finally {
      view.unmount();
    }
  });

  it.each(['lost', 'lost and read again'] as const)(
    'does not send a queued command whose connection was %s before dispatch',
    async (change) => {
      const api = new FakeApi();
      const run = startedRun(api);
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      try {
        await openRun(run.id);
        const mutations = heldMutations(view);
        // Render again so the controls take the client's delayed mutation options.
        await runRead(view, run.id);
        await user.click(button(/Pause/));
        await waitFor(() => expect(mutations.state.queued).toBe(true));
        await loseApi(view, run.id);
        if (change === 'lost and read again') await restoreApi(view, run.id);
        mutations.release();
        expect(await screen.findByText(NOT_SENT)).toBeVisible();
        expect(api.callsTo('POST', `/runs/${run.id}/pause`)).toHaveLength(0);
      } finally {
        view.unmount();
      }
    },
  );

  it('needs a fresh observation of the same failure after recovery, and sends its own sequence', async () => {
    const api = new FakeApi();
    const run = missingSessionRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const start = () => button('Start fresh session for worker');
    let observationReads = 0;
    const stop = view.queryClient.getQueryCache().subscribe((change) => {
      if (
        change.type === 'updated' &&
        change.action.type === 'fetch' &&
        change.query.queryKey[0] === 'run-observation'
      )
        observationReads += 1;
    });
    let release = () => {};
    try {
      await openRun(run.id);
      await waitFor(() => expect(start()).toBeEnabled());
      await loseApi(view, run.id);
      expect(start()).toBeDisabled();
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      api.override('GET /runs/:id/observation', async (call) => {
        await held;
        return api.builtIn(call);
      });
      observationReads = 0;
      await restoreApi(view, run.id);
      // The run is current again; the failure evidence was read before the outage.
      await waitFor(() => expect(observationReads).toBe(1));
      expect(start()).toBeDisabled();
      expect(screen.getByText('Reading the run evidence again.')).toBeVisible();
      await user.click(start());
      expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(0);
      release();
      await waitFor(() => expect(start()).toBeEnabled());
      expect(observationReads).toBe(1);
      api.override('POST /runs/:id/recover-session', () =>
        Response.json({ ...api.runs.get(run.id), status: 'running' }),
      );
      await user.click(start());
      await waitFor(() =>
        expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(1),
      );
      // The failure event's own sequence, not the later delivery audit's.
      expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)[0]!.body).toEqual({
        nodeId: 'worker',
        failureSeq: 3,
      });
    } finally {
      stop();
      release();
      view.unmount();
    }
  });

  it('lets no review or queued command from an earlier visit act after A → B → A', async () => {
    const api = new FakeApi();
    const b = startedRun(api);
    const a = startedRun(api, { parentRunId: b.id });
    api.runs.set(b.id, { ...api.runs.get(b.id)!, parentRunId: a.id });
    const view = renderApp('/runs/' + a.id, api);
    const user = userEvent.setup();
    const visit = async (from: string, to: string) => {
      const header = (await openRun(from)).closest('header')!;
      await user.click(within(header).getByRole('link', { name: 'parent run' }));
      await openRun(to);
    };
    try {
      await openRun(a.id);
      await user.click(button('Replay...'));
      await screen.findByRole('dialog');
      await visit(a.id, b.id);
      await visit(b.id, a.id);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const mutations = heldMutations(view);
      await runRead(view, a.id);
      await user.click(button(/Pause/));
      await waitFor(() => expect(mutations.state.queued).toBe(true));
      await visit(a.id, b.id);
      await visit(b.id, a.id);
      mutations.release();
      await waitFor(() =>
        expect(
          view.queryClient
            .getMutationCache()
            .getAll()
            .every((mutation) => mutation.state.status !== 'pending'),
        ).toBe(true),
      );
      expect(posts(api)).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });
});
