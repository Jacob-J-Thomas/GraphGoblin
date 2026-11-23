import { runs } from '@graphgoblin/api-client';
import {
  DeletionConfirmationSchema,
  DeletionSelectionSchema,
  type RunRecord,
} from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp, type Rendered } from '../__fixtures__/render.js';
import { API_KEY_STORAGE, useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { keys } from '../api/queries.js';
import { App } from '../app/App.js';
import { Providers } from '../app/bootstrap.js';
import { errorMessage } from '../lib/utils.js';
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

/** Cancelled at the pinned loop's exit `done`, after API key `actor` asked for it at #3. */
function cancelledRun(api: FakeApi, actor: string) {
  const loop = api.addLoop(minimalLoop(), { published: true });
  const run = startedRun(api, {
    loopId: loop.id,
    versionId: loop.currentVersionId!,
    status: 'cancelled',
    lastEventSeq: 4,
    currentNodeId: 'done',
  });
  api.pushEvent(
    run.id,
    event(run.id, 3, 'run.cancel_requested', { actor: { kind: 'api-key', id: actor } }),
  );
  api.pushEvent(run.id, event(run.id, 4, 'run.cancelled', {}));
  return run;
}

/** A finished run without a result, whose pinned exit `done` has `exit` as its configuration. */
function valuelessExitRun(api: FakeApi, exit: Record<string, unknown>) {
  const base = minimalLoop();
  const loop = api.addLoop(
    {
      ...base,
      nodes: base.nodes.map((node) => (node.kind === 'exit' ? { ...node, config: exit } : node)),
    },
    { published: true },
  );
  const run = api.addRun({
    loopId: loop.id,
    versionId: loop.currentVersionId!,
    status: 'succeeded',
    lastEventSeq: 3,
  });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'exit.evaluated', { nodeId: 'done', outcome: 'success' }));
  api.pushEvent(
    run.id,
    event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
  );
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

/** Only run reads now fail, as a refused connection would; every other read keeps answering. */
async function loseRunRead(view: Rendered, runId: string) {
  view.api.override('GET /runs/:id', () => {
    throw new TypeError('Failed to fetch');
  });
  await runRead(view, runId);
  await screen.findByText(STALE);
}

const posts = (api: FakeApi) => api.calls.filter((call) => call.method === 'POST');

const UNCONFIRMED = /^This run has not been confirmed since the connection was lost\./;
const UNCERTAIN =
  'The change may or may not have been saved: the GraphGoblin API could not be reached. Review the history again once connected.';

/** Failed at `script`, whose outcome is uncertain: Recover script asks for explicit consent. */
function uncertainScriptRun(api: FakeApi, overrides: Partial<RunRecord> = {}) {
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
    ...overrides,
  });
  api.pushEvent(run.id, event(run.id, 3, 'run.failed', { failure: run.failure! }));
  return run;
}

/** Every delete-ready preview is clear; each confirmation is held until the test settles it. */
function heldConfirmations(api: FakeApi) {
  const held: { save: () => void; fail: (error: Error) => void }[] = [];
  const clear = (runIds: string[]) => ({
    token: 'b'.repeat(64),
    items: runIds.map((runId) => ({ runId, reasons: [] })),
  });
  api.override('POST /runs/deletion-eligibility/preview', ({ body }) =>
    Response.json({ ...clear(DeletionSelectionSchema.parse(body).runIds), token: 'a'.repeat(64) }),
  );
  api.override(
    'POST /runs/deletion-eligibility',
    ({ body }) =>
      new Promise<Response>((resolve, reject) => {
        const { runIds } = DeletionConfirmationSchema.parse(body);
        held.push({ save: () => resolve(Response.json(clear(runIds))), fail: reject });
      }),
  );
  return held;
}

/** Chooses Resume in the open script recovery review. */
async function resumeInReview(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Recover script' });
  await user.click(within(dialog).getByRole('button', { name: 'Resume' }));
}

/** Confirms the open delete-ready review once its preview has been read. */
async function confirmReview(user: ReturnType<typeof userEvent.setup>) {
  const confirm = await screen.findByRole('button', { name: 'Confirm delete-ready selection' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
}

/** The browser disconnects and reconnects; a run read that started after the loss commits. */
async function browserOutage() {
  act(() => onlineManager.setOnline(false));
  expect(await screen.findByText(/This browser is offline\./)).toBeVisible();
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
}

/**
 * Another tab stores a second accepted key, which the mounted API key panel follows, while run
 * reads are held. No read under that key has committed and this view has recorded a browser
 * loss, so the run section, its header and its controls are withheld rather than shown from an
 * unproved row. Returns the header shown before.
 */
async function withholdForAnotherKey(
  api: FakeApi,
  runId: string,
  reads: ReturnType<typeof heldRunReads>,
) {
  const original = screen.getByRole('heading', { name: 'Run ' + runId }).closest('header')!;
  reads.state.blocking = true;
  localStorage.setItem(API_KEY_STORAGE, 'gg_second_key');
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
  });
  expect(original).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Run ' + runId })).toBeNull();
  expect(screen.getByText(UNCONFIRMED)).toBeVisible();
  // The run is read again under the second key, and that read is held.
  await waitFor(() => expect(reads.state.held).toBeGreaterThan(0));
  const read = api.callsTo('GET', `/runs/${runId}`).at(-1);
  expect(read?.headers.get('authorization')).toBe('Bearer gg_second_key');
  expect(screen.queryByRole('heading', { name: 'Run ' + runId })).toBeNull();
  return original;
}

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

  // A browser disconnect stays recorded for the rest of this file. This case comes before every
  // test that takes the browser offline, so its choice is queued with no outage boundary at all.
  it.each(['removed and read again', 'read again under another accepted API key'] as const)(
    'keeps a fresh-session choice queued before a shown observation-only loss spent once its receipt is %s',
    async (replacement) => {
      const anotherKey = replacement === 'read again under another accepted API key';
      // The first accepted key, stored before the app opens.
      if (anotherKey) useApiKeyStore.getState().save('gg_first_key');
      const api = new FakeApi();
      const run = missingSessionRun(api);
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const start = () => button('Start fresh session for worker');
      const recoveries = () => api.callsTo('POST', `/runs/${run.id}/recover-session`);
      const observationGets = () => api.callsTo('GET', `/runs/${run.id}/observation`);
      const observationQuery = () =>
        view.queryClient.getQueryCache().find({ queryKey: keys.observation(run.id), exact: true });
      const evidenceError = /^Run evidence could not be read: /;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let queued = false;
      try {
        await openRun(run.id);
        await waitFor(() => expect(start()).toBeEnabled());
        const evidence = view.queryClient.getQueryData(keys.observation(run.id));
        expect(evidence).toBeDefined();
        // The mutation cache holds the choice before its API call; the gate is read at dispatch.
        view.queryClient.getMutationCache().config.onMutate = () => {
          queued = true;
          return held;
        };
        await user.click(start());
        await waitFor(() => expect(queued).toBe(true));
        expect(recoveries()).toHaveLength(0);

        // Only the observation read fails in transport, and the view shows it. The run read and
        // the browser stay healthy, so the run stays current and its other controls available.
        api.override('GET /runs/:id/observation', () => {
          throw new TypeError('Failed to fetch');
        });
        await act(() =>
          view.queryClient.refetchQueries({ queryKey: keys.observation(run.id), exact: true }),
        );
        expect(await screen.findByText(evidenceError)).toBeVisible();
        expect(screen.getByText('Reading the run evidence again.')).toBeVisible();
        expect(start()).toBeDisabled();
        expect(screen.queryByText(STALE)).toBeNull();
        expect(button('Replay...')).toBeEnabled();
        expect(button('Review delete-ready history')).toBeEnabled();
        expect(view.queryClient.getQueryState(keys.run(run.id))?.status).toBe('success');
        expect(onlineManager.isOnline()).toBe(true);

        // The observation answers again, and its receipt is replaced, with no loss of its own.
        api.override('GET /runs/:id/observation', (call) => api.builtIn(call));
        const lostQuery = observationQuery();
        expect(lostQuery).toBeDefined();
        const getsBefore = observationGets().length;
        if (anotherKey) {
          // Another tab stores a second accepted key. The mounted API key panel follows it and
          // reads the run and its observation again under it, from the same query entries.
          localStorage.setItem(API_KEY_STORAGE, 'gg_second_key');
          act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
          });
          const lastKey = (path: string) =>
            api.callsTo('GET', path).at(-1)?.headers.get('authorization');
          await waitFor(() => {
            expect(lastKey(`/runs/${run.id}/observation`)).toBe('Bearer gg_second_key');
            expect(lastKey(`/runs/${run.id}`)).toBe('Bearer gg_second_key');
          });
        } else {
          // The query, and its receipt with it, is removed; the mounted view reads a new one.
          act(() => {
            view.queryClient.removeQueries({ queryKey: keys.observation(run.id), exact: true });
          });
        }
        await waitFor(() => {
          expect(view.queryClient.getQueryState(keys.observation(run.id))).toMatchObject({
            status: 'success',
            fetchStatus: 'idle',
          });
          expect(view.queryClient.getQueryState(keys.run(run.id))).toMatchObject({
            status: 'success',
            fetchStatus: 'idle',
          });
        });
        if (anotherKey) expect(observationQuery()).toBe(lostQuery);
        else expect(observationQuery()).not.toBe(lostQuery);
        // A genuine successful GET returned the same failure evidence. The queued choice is still
        // pending, which alone keeps the control disabled until it settles.
        expect(observationGets().length).toBeGreaterThan(getsBefore);
        expect(view.queryClient.getQueryData(keys.observation(run.id))).toEqual(evidence);
        await waitFor(() => {
          expect(screen.queryByText(evidenceError)).toBeNull();
          expect(screen.queryByText('Reading the run evidence again.')).toBeNull();
        });
        expect(screen.queryByText(STALE)).toBeNull();
        expect(recoveries()).toHaveLength(0);

        // The choice queued before the loss the view showed stays spent.
        release();
        expect(await screen.findByText(NOT_SENT)).toBeVisible();
        expect(recoveries()).toHaveLength(0);

        // A deliberate choice made now sends once, with the failure's own sequence.
        api.override('POST /runs/:id/recover-session', () =>
          Response.json({ ...api.runs.get(run.id), status: 'running' }),
        );
        await waitFor(() => expect(start()).toBeEnabled());
        await user.click(start());
        await waitFor(() => expect(recoveries()).toHaveLength(1));
        expect(recoveries()[0]!.body).toEqual({ nodeId: 'worker', failureSeq: 3 });
        expect(posts(api)).toHaveLength(1);
      } finally {
        release();
        view.unmount();
      }
    },
  );

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

  // Unlike the replacement cases above, this view records a browser loss of its own first, so the
  // run section is withheld when the credentials change, whatever ran earlier in this file.
  it('keeps a fresh-session choice queued before an observation-only loss pending through a run section withheld for another accepted API key after a browser outage, then reports it Not sent', async () => {
    // The first accepted key, stored before the app opens.
    useApiKeyStore.getState().save('gg_first_key');
    const api = new FakeApi();
    const run = missingSessionRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const start = () => button('Start fresh session for worker');
    const header = () => screen.getByRole('heading', { name: 'Run ' + run.id }).closest('header')!;
    const recoveries = () => api.callsTo('POST', `/runs/${run.id}/recover-session`);
    const lastKey = (path: string) => api.callsTo('GET', path).at(-1)?.headers.get('authorization');
    const evidenceError = /^Run evidence could not be read: /;
    const unconfirmed = /^This run has not been confirmed since the connection was lost\./;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queued = false;
    try {
      await openRun(run.id);
      await waitFor(() => expect(start()).toBeEnabled());

      // The browser disconnects and reconnects. The view reads the run and its failure evidence
      // again after that, and the choice is available once more.
      act(() => onlineManager.setOnline(false));
      expect(await screen.findByText(STALE)).toBeVisible();
      expect(start()).toBeDisabled();
      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
      await waitFor(() => expect(start()).toBeEnabled());
      const evidence = view.queryClient.getQueryData(keys.observation(run.id));
      expect(evidence).toBeDefined();
      expect(posts(api)).toHaveLength(0);

      // The mutation cache holds the choice before its API call; the gate is read at dispatch.
      view.queryClient.getMutationCache().config.onMutate = () => {
        queued = true;
        return held;
      };
      await user.click(start());
      await waitFor(() => expect(queued).toBe(true));
      expect(recoveries()).toHaveLength(0);

      // Only the observation read fails in transport, and the view shows it. The run read and the
      // browser stay healthy, so the run stays current and its other controls available.
      api.override('GET /runs/:id/observation', () => {
        throw new TypeError('Failed to fetch');
      });
      await act(() =>
        view.queryClient.refetchQueries({ queryKey: keys.observation(run.id), exact: true }),
      );
      expect(await screen.findByText(evidenceError)).toBeVisible();
      expect(screen.getByText('Reading the run evidence again.')).toBeVisible();
      expect(start()).toBeDisabled();
      expect(screen.queryByText(STALE)).toBeNull();
      expect(button('Replay...')).toBeEnabled();
      expect(view.queryClient.getQueryState(keys.run(run.id))?.status).toBe('success');
      expect(onlineManager.isOnline()).toBe(true);

      // Another tab stores a second accepted key, which the mounted API key panel follows. No
      // read under it has committed yet and this view has recorded a browser loss, so the run
      // section, its header and its control are withheld rather than shown from an unproved row.
      api.override('GET /runs/:id/observation', (call) => api.builtIn(call));
      const originalHeader = header();
      const originalStart = start();
      localStorage.setItem(API_KEY_STORAGE, 'gg_second_key');
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
      });
      expect(originalHeader).not.toBeInTheDocument();
      expect(originalStart).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).toBeNull();
      expect(screen.getByText(unconfirmed)).toBeVisible();

      // The run and its observation are read under the second key and return the same failure.
      await waitFor(() => {
        expect(lastKey(`/runs/${run.id}/observation`)).toBe('Bearer gg_second_key');
        expect(lastKey(`/runs/${run.id}`)).toBe('Bearer gg_second_key');
      });
      await waitFor(() => {
        expect(view.queryClient.getQueryState(keys.observation(run.id))).toMatchObject({
          status: 'success',
          fetchStatus: 'idle',
        });
        expect(view.queryClient.getQueryState(keys.run(run.id))).toMatchObject({
          status: 'success',
          fetchStatus: 'idle',
        });
      });
      expect(view.queryClient.getQueryData(keys.observation(run.id))).toEqual(evidence);

      // The run is shown again, with a new header and control. The queued choice is still
      // pending, which alone keeps the new control disabled.
      await openRun(run.id);
      await waitFor(() => {
        expect(screen.queryByText(unconfirmed)).toBeNull();
        expect(screen.queryByText(evidenceError)).toBeNull();
        expect(screen.queryByText('Reading the run evidence again.')).toBeNull();
      });
      expect(header()).not.toBe(originalHeader);
      const replacement = start();
      expect(replacement).not.toBe(originalStart);
      expect(replacement).toBeDisabled();
      expect(screen.queryByText(STALE)).toBeNull();
      expect(screen.queryByText(NOT_SENT)).toBeNull();
      expect(recoveries()).toHaveLength(0);

      // Released, the choice queued before the loss is not sent, and the control shown now says so.
      release();
      expect(await screen.findByText(NOT_SENT)).toBeVisible();
      expect(recoveries()).toHaveLength(0);
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(screen.getByText(NOT_SENT)).toBeVisible();
      expect(posts(api)).toHaveLength(0);

      // A new explicit choice replaces that report and sends once, with the failure's own sequence.
      api.override('POST /runs/:id/recover-session', () =>
        Response.json({ ...api.runs.get(run.id), status: 'running' }),
      );
      await waitFor(() => expect(start()).toBeEnabled());
      await user.click(start());
      await waitFor(() => expect(recoveries()).toHaveLength(1));
      expect(recoveries()[0]!.body).toEqual({ nodeId: 'worker', failureSeq: 3 });
      expect(posts(api)).toHaveLength(1);
      await waitFor(() => expect(screen.queryByText(NOT_SENT)).toBeNull());
    } finally {
      release();
      view.unmount();
    }
  });

  it('keeps a fresh-session choice queued for one run from holding or reporting on another run opened in the same view', async () => {
    const api = new FakeApi();
    const b = missingSessionRun(api);
    const a = missingSessionRun(api);
    api.runs.set(a.id, { ...api.runs.get(a.id)!, parentRunId: b.id });
    api.override('POST /runs/:id/recover-session', (_call, [runId]) =>
      Response.json({ ...api.runs.get(runId!), status: 'running' }),
    );
    const view = renderApp('/runs/' + a.id, api);
    const user = userEvent.setup();
    const start = () => button('Start fresh session for worker');
    const recoveries = (runId: string) => api.callsTo('POST', `/runs/${runId}/recover-session`);
    const outcomes = () =>
      view.queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) =>
          mutation.state.status === 'error'
            ? errorMessage(mutation.state.error)
            : mutation.state.status,
        );
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queued = 0;
    try {
      await openRun(a.id);
      await waitFor(() => expect(start()).toBeEnabled());
      // The mutation cache holds every choice before its API call; the gate is read at dispatch.
      view.queryClient.getMutationCache().config.onMutate = () => {
        queued += 1;
        return held;
      };
      await user.click(start());
      await waitFor(() => expect(queued).toBe(1));
      expect(start()).toBeDisabled();

      // A's header links its parent, B, which opens in the same view while A's choice is queued.
      const header = screen.getByRole('heading', { name: 'Run ' + a.id }).closest('header')!;
      await user.click(within(header).getByRole('link', { name: 'parent run' }));
      await openRun(b.id);
      // B shows its own failure: A's queued choice neither holds B's control nor reports there.
      await waitFor(() => expect(start()).toBeEnabled());
      expect(screen.queryByText(/^Not sent: /)).toBeNull();

      // B's own choice is queued as well; then both are released.
      await user.click(start());
      await waitFor(() => expect(queued).toBe(2));
      expect(start()).toBeDisabled();
      release();
      // A's choice belonged to a visit no longer shown: it is not sent, and that is not reported
      // as B's outcome. B's choice sends once, with B's own failure sequence.
      await waitFor(() => expect(outcomes()).toEqual([NOT_SENT, 'success']));
      expect(screen.queryByText(/^Not sent: /)).toBeNull();
      expect(recoveries(a.id)).toHaveLength(0);
      expect(recoveries(b.id)).toHaveLength(1);
      expect(recoveries(b.id)[0]!.body).toEqual({ nodeId: 'worker', failureSeq: 3 });
      expect(posts(api)).toHaveLength(1);
    } finally {
      release();
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

  it('spends a queued fresh-session choice on a loss of the observation read alone, even once read again', async () => {
    const api = new FakeApi();
    const run = missingSessionRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const start = () => button('Start fresh session for worker');
    const recoveries = () => api.callsTo('POST', `/runs/${run.id}/recover-session`);
    const observationRead = () =>
      act(() =>
        view.queryClient.refetchQueries({ queryKey: keys.observation(run.id), exact: true }),
      );
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queued = false;
    try {
      await openRun(run.id);
      await waitFor(() => expect(start()).toBeEnabled());
      // The client's mutation cache holds the choice before its API call; it is read at dispatch.
      view.queryClient.getMutationCache().config.onMutate = () => {
        queued = true;
        return held;
      };
      await user.click(start());
      await waitFor(() => expect(queued).toBe(true));

      // Only the observation read fails; the run read and the browser stay healthy, so the run
      // stays current and its other controls stay available.
      const evidence = view.queryClient.getQueryData(keys.observation(run.id));
      api.override('GET /runs/:id/observation', () => {
        throw new TypeError('Failed to fetch');
      });
      await observationRead();
      expect(await screen.findByText('Reading the run evidence again.')).toBeVisible();
      expect(screen.queryByText(STALE)).toBeNull();
      expect(button('Replay...')).toBeEnabled();
      expect(button('Review delete-ready history')).toBeEnabled();

      // A genuine reread whose body is equal: structural sharing keeps the cached object.
      api.override('GET /runs/:id/observation', (call) => api.builtIn(call));
      await observationRead();
      await waitFor(() =>
        expect(screen.queryByText('Reading the run evidence again.')).not.toBeInTheDocument(),
      );
      expect(view.queryClient.getQueryData(keys.observation(run.id))).toBe(evidence);

      // The choice queued before that loss stays spent.
      release();
      expect(await screen.findByText(NOT_SENT)).toBeVisible();
      expect(recoveries()).toHaveLength(0);

      // A deliberate choice made now sends once, with the failure's own sequence.
      api.override('POST /runs/:id/recover-session', () =>
        Response.json({ ...api.runs.get(run.id), status: 'running' }),
      );
      await waitFor(() => expect(start()).toBeEnabled());
      await user.click(start());
      await waitFor(() => expect(recoveries()).toHaveLength(1));
      expect(recoveries()[0]!.body).toEqual({ nodeId: 'worker', failureSeq: 3 });
    } finally {
      release();
      view.unmount();
    }
  });

  it.each(['fails in transport', 'succeeds'] as const)(
    'keeps a script retry sent before an outage the only one, and its outcome, until it %s',
    async (settle) => {
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
      let answer!: (response: Response) => void;
      let fail!: (error: Error) => void;
      api.override(
        'POST /runs/:id/resume',
        () =>
          new Promise<Response>((resolve, reject) => {
            answer = resolve;
            fail = reject;
          }),
      );
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const resumes = () => api.callsTo('POST', `/runs/${run.id}/resume`);
      try {
        await openRun(run.id);
        await user.click(button('Recover script'));
        await user.click(
          within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resume' }),
        );
        await waitFor(() => expect(resumes()).toHaveLength(1));
        await loseApi(view, run.id);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await restoreApi(view, run.id);

        // The run is current and still uncertain, and the retry already sent has not settled:
        // no second review opens and nothing else is sent.
        expect(screen.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')).toBeVisible();
        expect(button('Recover script')).toBeDisabled();
        await user.click(button('Recover script'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(resumes()).toHaveLength(1);

        if (settle === 'fails in transport') {
          await act(async () => {
            fail(new TypeError('Failed to fetch'));
            await Promise.resolve();
          });
          const header = screen.getByRole('heading', { name: 'Run ' + run.id }).closest('header')!;
          const outcome = await within(header).findByRole('alert');
          expect(outcome).toBeVisible();
          expect(outcome).toHaveTextContent(/^The GraphGoblin API cannot be reached\.$/);
          await waitFor(() => expect(button('Recover script')).toBeEnabled());
        } else {
          const running: RunRecord = { ...api.runs.get(run.id)!, status: 'running' };
          delete running.failure;
          await act(async () => {
            api.runs.set(run.id, running);
            answer(Response.json(running));
            await Promise.resolve();
          });
          await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Recover script' })).toBeNull(),
          );
        }
        expect(resumes()).toHaveLength(1);
        expect(posts(api)).toHaveLength(1);
      } finally {
        view.unmount();
      }
    },
  );

  it.each(['fails in transport', 'succeeds'] as const)(
    'keeps a script retry sent before a browser outage the only one through a run section withheld for another accepted API key, and reports it when it %s',
    async (settle) => {
      // The first accepted key, stored before the app opens.
      useApiKeyStore.getState().save('gg_first_key');
      const api = new FakeApi();
      const run = uncertainScriptRun(api);
      const reads = heldRunReads(api);
      let answer!: (response: Response) => void;
      let fail!: (error: Error) => void;
      api.override(
        'POST /runs/:id/resume',
        () =>
          new Promise<Response>((resolve, reject) => {
            answer = resolve;
            fail = reject;
          }),
      );
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const header = () =>
        screen.getByRole('heading', { name: 'Run ' + run.id }).closest('header')!;
      const recover = () => button('Recover script');
      const resumes = () => api.callsTo('POST', `/runs/${run.id}/resume`);
      try {
        await openRun(run.id);
        await user.click(recover());
        await resumeInReview(user);
        await waitFor(() => expect(resumes()).toHaveLength(1));
        expect(resumes()[0]!.body).toEqual({ observedSeq: 3, retryUncertainScript: true });

        // The browser disconnects, which expires the review, and reconnects. A run read that
        // started after the loss commits the same failure; the retry sent before is unresolved.
        await browserOutage();
        expect(screen.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')).toBeVisible();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(recover()).toBeDisabled();

        const originalRecover = recover();
        const originalHeader = await withholdForAnotherKey(api, run.id, reads);
        expect(originalRecover).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Recover script' })).toBeNull();

        // The held read returns the same failed run under the second key. The run is shown again
        // with a new header and control, which the retry still unresolved alone keeps disabled.
        reads.release();
        await openRun(run.id);
        expect(header()).not.toBe(originalHeader);
        const replacement = recover();
        expect(replacement).not.toBe(originalRecover);
        expect(replacement).toBeDisabled();
        expect(within(header()).queryByRole('alert')).toBeNull();
        await user.click(replacement);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(resumes()).toHaveLength(1);

        if (settle === 'fails in transport') {
          await act(async () => {
            fail(new TypeError('Failed to fetch'));
            await Promise.resolve();
          });
          // The control shown now reports the retry's own failure, and keeps reporting it.
          const outcome = await within(header()).findByRole('alert');
          expect(outcome).toHaveTextContent(/^The GraphGoblin API cannot be reached\.$/);
          await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
          expect(within(header()).getByRole('alert')).toHaveTextContent(
            /^The GraphGoblin API cannot be reached\.$/,
          );
          // A new explicit choice, made only now, sends once more with the same consent.
          api.override('POST /runs/:id/resume', (call) => api.builtIn(call));
          await waitFor(() => expect(recover()).toBeEnabled());
          await user.click(recover());
          await resumeInReview(user);
          await waitFor(() => expect(resumes()).toHaveLength(2));
          expect(resumes()[1]!.body).toEqual({ observedSeq: 3, retryUncertainScript: true });
        } else {
          const running: RunRecord = { ...api.runs.get(run.id)!, status: 'running' };
          delete running.failure;
          await act(async () => {
            api.runs.set(run.id, running);
            answer(Response.json(running));
            await Promise.resolve();
          });
          await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Recover script' })).toBeNull(),
          );
          expect(within(header()).queryByRole('alert')).toBeNull();
          expect(resumes()).toHaveLength(1);
        }
        expect(posts(api)).toHaveLength(settle === 'succeeds' ? 1 : 2);
      } finally {
        reads.release();
        view.unmount();
      }
    },
  );

  it.each(['fails in transport', 'succeeds'] as const)(
    'keeps a delete-ready confirmation sent before a browser outage the only one through a run section withheld for another accepted API key, and reports it when it %s',
    async (settle) => {
      // The first accepted key, stored before the app opens.
      useApiKeyStore.getState().save('gg_first_key');
      const api = new FakeApi();
      const run = startedRun(api, { status: 'succeeded', lastEventSeq: 3, currentNodeId: 'done' });
      api.pushEvent(
        run.id,
        event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
      );
      const confirmations = heldConfirmations(api);
      const reads = heldRunReads(api);
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const header = () =>
        screen.getByRole('heading', { name: 'Run ' + run.id }).closest('header')!;
      const review = () => button('Review delete-ready history');
      const withdraw = () => button('Withdraw delete-ready mark');
      const previews = () => api.callsTo('POST', '/runs/deletion-eligibility/preview');
      const confirms = () => api.callsTo('POST', '/runs/deletion-eligibility');
      const outcome = settle === 'succeeds' ? '1 run marked delete-ready.' : UNCERTAIN;
      try {
        await openRun(run.id);
        await user.click(review());
        await confirmReview(user);
        expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
        expect(confirms()).toHaveLength(1);
        expect(confirms()[0]!.body).toEqual({
          runIds: [run.id],
          action: 'mark',
          token: 'a'.repeat(64),
          confirmed: true,
        });

        // The browser disconnects, which expires the review, and reconnects. A run read that
        // started after the loss commits; the confirmation sent before is unresolved.
        await browserOutage();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(review()).toBeDisabled();
        expect(withdraw()).toBeDisabled();

        const originalReview = review();
        const originalHeader = await withholdForAnotherKey(api, run.id, reads);
        expect(originalReview).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review delete-ready history' })).toBeNull();

        // The held read returns the same run under the second key. The run is shown again with
        // new controls, which the confirmation still unresolved alone holds.
        reads.release();
        await openRun(run.id);
        expect(header()).not.toBe(originalHeader);
        expect(review()).not.toBe(originalReview);
        expect(review()).toBeDisabled();
        expect(withdraw()).toBeDisabled();
        // An attempt to open a replacement review opens nothing and reads no preview.
        await user.click(review());
        await user.click(withdraw());
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(previews()).toHaveLength(1);
        expect(confirms()).toHaveLength(1);
        expect(screen.queryByText(outcome)).toBeNull();

        await act(async () => {
          if (settle === 'succeeds') confirmations[0]!.save();
          else confirmations[0]!.fail(new TypeError('Failed to fetch'));
          await Promise.resolve();
        });
        // The controls shown now report what happened to it: saved, or possibly saved.
        expect(await screen.findByText(outcome)).toBeVisible();
        await waitFor(() => expect(review()).toBeEnabled());
        expect(withdraw()).toBeEnabled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(confirms()).toHaveLength(1);

        // A new explicit review, opened only now, reads its own preview and is confirmed once.
        await user.click(review());
        await confirmReview(user);
        await waitFor(() => expect(confirms()).toHaveLength(2));
        expect(previews()).toHaveLength(2);
        expect(posts(api)).toHaveLength(4);
      } finally {
        reads.release();
        view.unmount();
      }
    },
  );

  it.each(['script retry', 'delete-ready confirmation'] as const)(
    'keeps a %s sent for one run from holding or reporting on another run opened in the same view',
    async (kind) => {
      const api = new FakeApi();
      const b = uncertainScriptRun(api);
      const a = uncertainScriptRun(api, { parentRunId: b.id });
      const confirmations = heldConfirmations(api);
      let fail!: (error: Error) => void;
      api.override(
        'POST /runs/:id/resume',
        () =>
          new Promise<Response>((_resolve, reject) => {
            fail = reject;
          }),
      );
      const view = renderApp('/runs/' + a.id, api);
      const user = userEvent.setup();
      const script = kind === 'script retry';
      const launcher = () => button(script ? 'Recover script' : 'Review delete-ready history');
      const header = (runId: string) =>
        screen.getByRole('heading', { name: 'Run ' + runId }).closest('header')!;
      const resumes = (runId: string) => api.callsTo('POST', `/runs/${runId}/resume`);
      const confirms = () => api.callsTo('POST', '/runs/deletion-eligibility');
      const selections = () =>
        confirms().map((call) => DeletionConfirmationSchema.parse(call.body).runIds);
      const mutations = view.queryClient.getMutationCache();
      // The shown run's own action, chosen in its review.
      const choose = async () => {
        await user.click(launcher());
        await (script ? resumeInReview(user) : confirmReview(user));
      };
      try {
        await openRun(a.id);
        await choose();
        await waitFor(() => expect(script ? resumes(a.id) : confirms()).toHaveLength(1));
        expect(launcher()).toBeDisabled();

        // A's header links its parent, B, which opens in the same view while A's is unresolved.
        await user.click(within(header(a.id)).getByRole('link', { name: 'parent run' }));
        await openRun(b.id);
        // B shows its own controls: A's action does not hold them.
        await waitFor(() => expect(launcher()).toBeEnabled());

        // A's action fails in transport while B is shown, and is not reported as B's outcome.
        await act(async () => {
          if (script) fail(new TypeError('Failed to fetch'));
          else confirmations[0]!.fail(new TypeError('Failed to fetch'));
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        if (script) expect(mutations.getAll().map(({ state }) => state.status)).toEqual(['error']);
        expect(within(header(b.id)).queryByRole('alert')).toBeNull();
        expect(screen.queryByText(UNCERTAIN)).toBeNull();
        expect(launcher()).toBeEnabled();

        // B's own action is sent once, for B.
        await choose();
        if (script) {
          await waitFor(() => expect(resumes(b.id)).toHaveLength(1));
          expect(resumes(a.id)).toHaveLength(1);
        } else {
          await waitFor(() => expect(selections()).toEqual([[a.id], [b.id]]));
        }
        expect(posts(api)).toHaveLength(script ? 2 : 4);
      } finally {
        view.unmount();
      }
    },
  );

  it.each(['nothing', 'only the run read of A', 'the browser'] as const)(
    'keeps run B as its own reads say after %s was lost while A was shown',
    async (lost) => {
      const api = new FakeApi();
      const b = startedRun(api);
      const a = startedRun(api, { parentRunId: b.id });
      api.runs.set(b.id, { ...api.runs.get(b.id)!, parentRunId: a.id });
      // The health probe keeps answering; only the reads named below change.
      api.override('GET /healthz', () => Response.json({ status: 'ok' }));
      const reads = { failA: false, holdB: false, heldB: 0 };
      let releaseB = () => {};
      const heldB = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      api.override('GET /runs/:id', async (call) => {
        if (reads.failA && call.path === `/runs/${a.id}`) throw new TypeError('Failed to fetch');
        if (reads.holdB && call.path === `/runs/${b.id}`) {
          reads.heldB += 1;
          await heldB;
        }
        return api.builtIn(call);
      });
      const view = renderApp('/runs/' + b.id, api);
      const user = userEvent.setup();
      const parent = async (from: string, to: string) => {
        const header = (await openRun(from)).closest('header')!;
        await user.click(within(header).getByRole('link', { name: 'parent run' }));
        await openRun(to);
      };
      try {
        await openRun(b.id);
        await waitFor(() => expect(button(/Pause/)).toBeEnabled());
        await parent(b.id, a.id);
        await waitFor(() => expect(button(/Pause/)).toBeEnabled());
        if (lost === 'only the run read of A') {
          reads.failA = true;
          await runRead(view, a.id);
          await screen.findByText(STALE);
          reads.failA = false;
          await runRead(view, a.id);
        } else if (lost === 'the browser') {
          act(() => onlineManager.setOnline(false));
          expect(await screen.findByText(/This browser is offline\./)).toBeVisible();
          act(() => onlineManager.setOnline(true));
        }
        await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
        expect(button(/Pause/)).toBeEnabled();

        // Back to B, whose own read on return is held.
        reads.holdB = true;
        await parent(a.id, b.id);
        await waitFor(() => expect(reads.heldB).toBeGreaterThan(0));
        if (lost === 'the browser') {
          // A browser disconnect applies to every run until each is read again.
          expect(screen.getByText(/Reconnecting: reading this run again\./)).toBeVisible();
          expect(button(/Pause/)).toBeDisabled();
        } else {
          expect(screen.queryByText(STALE)).toBeNull();
          expect(button(/Pause/)).toBeEnabled();
        }
        reads.holdB = false;
        releaseB();
        await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
        expect(button(/Pause/)).toBeEnabled();
        expect(posts(api)).toHaveLength(0);
      } finally {
        releaseB();
        view.unmount();
      }
    },
  );

  it.each(['qualified', 'foreign', 'manually replaced'] as const)(
    'keeps execution context through a run-only loss, with the actor of a %s observation only when qualified',
    async (observation) => {
      const api = new FakeApi();
      const run = cancelledRun(api, 'operator-key');
      if (observation === 'foreign') {
        // A successful answer whose events all name another run.
        const other = cancelledRun(api, 'foreign-key');
        api.override('GET /runs/:id/observation', (call) =>
          api.builtIn({ ...call, path: `/runs/${other.id}/observation` }),
        );
      }
      const view = renderApp('/runs/' + run.id, api);
      const position = () => screen.getByText(/Recorded node position:/);
      try {
        await openRun(run.id);
        await waitFor(() =>
          expect(view.queryClient.getQueryState(keys.observation(run.id))?.status).toBe('success'),
        );
        // While the run is current, the pinned definition names the recorded node.
        await waitFor(() =>
          expect(position()).toHaveTextContent(/Recorded node position: .+ \(done\)\./),
        );
        if (observation === 'manually replaced') {
          await waitFor(() =>
            expect(view.queryClient.getQueryState(keys.observation(run.id))?.fetchStatus).toBe(
              'idle',
            ),
          );
          // Later observation reads stay in flight, so the manual write is what stays cached.
          api.override('GET /runs/:id/observation', () => new Promise<Response>(() => {}));
          act(() => {
            view.queryClient.setQueryData<Record<string, unknown>>(
              keys.observation(run.id),
              (current) => ({
                ...current,
                cancelRequested: event(run.id, 3, 'run.cancel_requested', {
                  actor: { kind: 'api-key', id: 'manual-key' },
                }),
              }),
            );
          });
        }
        await loseRunRead(view, run.id);
        expect(screen.getByText(/^Pinned definition unavailable\./)).toBeVisible();
        expect(position()).toHaveTextContent(
          observation === 'qualified'
            ? 'Cancelled by api-key operator-key (request #3; cancellation #4). Recorded node position: done.'
            : 'Cancelled. The cancellation record could not be read. Recorded node position: done.',
        );
        expect(screen.queryByText(/foreign-key|manual-key/)).toBeNull();
        expect(posts(api)).toHaveLength(0);
      } finally {
        view.unmount();
      }
    },
  );

  it.each([
    {
      returns: 'Returns None',
      exit: { returns: 'none', destinations: [] },
      explanation:
        'Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. This is the exit’s configuration, not a failure.',
    },
    {
      returns: 'an expression',
      exit: { returns: 'null', destinations: [{ kind: 'caller' }] },
      explanation:
        'No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.',
    },
  ])(
    'keeps the selected exit’s own explanation for $returns through a run-only loss',
    async ({ exit, explanation }) => {
      const api = new FakeApi();
      const run = valuelessExitRun(api, exit);
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const selected = () => screen.getByText(/Exit outcome:/);
      try {
        await openRun(run.id);
        await waitFor(() =>
          expect(screen.getByTestId('exit-returns')).toHaveTextContent(explanation),
        );
        await user.click(screen.getByRole('button', { name: /exit\.evaluated/ }));
        expect(selected()).toHaveTextContent(explanation);
        await loseRunRead(view, run.id);
        // The retained run section omits its summary; the selected exit keeps its own.
        expect(screen.queryByTestId('exit-returns')).toBeNull();
        expect(selected()).toHaveTextContent(explanation);
        expect(screen.queryByText(/See the run result/)).toBeNull();
        expect(posts(api)).toHaveLength(0);
      } finally {
        view.unmount();
      }
    },
  );
});
