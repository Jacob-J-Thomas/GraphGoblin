import { createGraphGoblinClient } from '@graphgoblin/api-client';
import {
  ContextThreadSchema,
  DeletionConfirmationSchema,
  DeletionSelectionSchema,
  RunSnapshotSchema,
  type RunRecord,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { MutationCache, onlineManager, QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
  event,
  FakeApi,
  problem,
  queuedFields,
  type RecordedCall,
} from '../__fixtures__/fake-api.js';
import { createAppClient } from '../api/context.js';
import { useApiKeyStore } from '../api/api-key.js';
import { keys } from '../api/queries.js';
import { Providers } from '../app/bootstrap.js';
import { RunInspectorPage } from './RunInspectorPage.js';
import { RunsPage } from './RunsPage.js';

// Independent public-interface overlay, prepared at6924c529. No execution admission is
// implied by this file. Fake HTTP/component evidence does not establish native layout.
const STALE = 'Last observed, may be out of date';
const clients = new Set<QueryClient>();
const releases = new Set<() => void>();
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.add(release);
  return { promise, release };
}
function row(api: FakeApi, overrides: Partial<RunRecord> = {}) {
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
function waiting(api: FakeApi, kind: 'input' | 'signal' = 'input') {
  const spec = {
    waitId: 'independent-wait-A',
    nodeId: 'ask',
    kind,
    prompt: 'Independent draft',
    startedSeq: 3,
    ...(kind === 'signal'
      ? { signalName: 'go' }
      : { inputSchema: { type: 'object', properties: { note: { type: 'string' } } } }),
  };
  const run = row(api, { status: 'waiting', currentNodeId: 'ask', lastEventSeq: 3, waiting: spec });
  api.pushEvent(run.id, event(run.id, 3, 'run.waiting', { nodeId: 'ask', wait: spec }));
  return run;
}
function missing(api: FakeApi) {
  const run = row(api, { status: 'failed', currentNodeId: 'worker', lastEventSeq: 4 });
  const failure: NonNullable<RunRecord['failure']> = {
    code: 'HARNESS_SESSION_MISSING',
    message: 'Independent missing provider conversation',
    nodeId: 'worker',
    resumable: false,
    missingSession: {
      visitId: run.id + ':visit-A',
      harness: 'codex',
      sessionId: 'controlled-missing',
      origin: 'resume-own',
      model: 'gpt-6-luna',
      effort: 'low',
    },
  };
  api.runs.set(run.id, { ...run, failure });
  api.pushEvent(run.id, event(run.id, 3, 'run.failed', { failure }));
  // Failure identity is3, not the later audit suffix4.
  api.pushEvent(run.id, event(run.id, 4, 'return.delivered', { channel: { kind: 'log' } }));
  return api.runs.get(run.id)!;
}
function scripted(api: FakeApi) {
  const run = row(api, {
    status: 'failed',
    currentNodeId: 'script',
    lastEventSeq: 3,
    failure: {
      code: 'SCRIPT_OUTCOME_UNCERTAIN',
      message: 'Controlled script uncertainty',
      nodeId: 'script',
      resumable: true,
      script: { visitId: 'script-visit', state: 'outcome-uncertain' },
    },
  });
  api.pushEvent(run.id, event(run.id, 3, 'run.failed', { failure: run.failure! }));
  return run;
}
function mount(
  api: FakeApi,
  runId: string,
  options: { queued?: boolean; seed?: unknown; otherRun?: string } = {},
) {
  const hold = barrier();
  let queued = 0;
  // Install before any useMutation observer renders; never change default callbacks late.
  const mutationCache = new MutationCache({
    onMutate: async () => {
      if (options.queued) {
        queued++;
        await hold.promise;
      }
    },
  });
  let queryClient = new QueryClient({
    mutationCache,
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.add(queryClient);
  if (options.seed !== undefined) queryClient.setQueryData(keys.run(runId), options.seed);
  let client = createAppClient('http://independent-ui.invalid', api.fetch);
  const ui = () => (
    <Providers client={client} queryClient={queryClient}>
      <MemoryRouter initialEntries={['/runs/' + runId]}>
        <Routes>
          <Route
            path="/runs/:runId"
            element={
              <>
                <nav aria-label="Independent visits">
                  <Link to={'/runs/' + runId}>Visit A</Link>
                  {options.otherRun ? <Link to={'/runs/' + options.otherRun}>Visit B</Link> : null}
                  <Link to="/runs">History list</Link>
                </nav>
                <RunInspectorPage />
              </>
            }
          />
          <Route path="/runs" element={<RunsPage />} />
        </Routes>
      </MemoryRouter>
    </Providers>
  );
  const view = render(ui());
  return {
    ...view,
    api,
    get queryClient() {
      return queryClient;
    },
    hold,
    queued: () => queued,
    replaceCache: () => {
      const seed = queryClient.getQueryData(keys.run(runId));
      queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { retry: false },
        },
      });
      clients.add(queryClient);
      queryClient.setQueryData(keys.run(runId), seed);
      view.rerender(ui());
    },
    replaceClient: () => {
      client = createGraphGoblinClient({ baseUrl: 'http://foreign-ui.invalid', fetch: api.fetch });
      view.rerender(ui());
    },
  };
}
type View = ReturnType<typeof mount>;
const writes = (api: FakeApi) =>
  api.calls.filter((call) => !['GET', 'HEAD', 'OPTIONS'].includes(call.method));
const heading = (id: string) => screen.findByRole('heading', { name: 'Run ' + id });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
async function settled(view: View, runId: string) {
  await heading(runId);
  await waitFor(() => {
    expect(view.queryClient.isFetching()).toBe(0);
    // The initial SSE batch has caused its run-model refresh (500ms scheduler); do not
    // begin an outage while that initial live invalidation is still merely scheduled.
    expect(view.api.callsTo('GET', `/runs/${runId}`).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('list', { name: 'Timeline' })).toHaveTextContent('run.started');
  });
}
const reread = (view: View, id: string) =>
  act(() => view.queryClient.refetchQueries({ queryKey: keys.run(id), exact: true }));
async function lose(view: View, id: string) {
  view.api.offline = true;
  await reread(view, id);
  await screen.findByText(STALE);
}
async function recover(view: View, id: string) {
  view.api.offline = false;
  await reread(view, id);
  await waitFor(() => expect(screen.queryByText(STALE)).not.toBeInTheDocument());
}
async function expired(dialog: HTMLElement, confirm: string) {
  await waitFor(() => {
    if (dialog.isConnected && dialog.hasAttribute('open'))
      expect(within(dialog).getByRole('button', { name: confirm })).toBeDisabled();
    else
      expect(
        screen.queryByRole('dialog', { name: dialog.getAttribute('aria-label') ?? '' }),
      ).not.toBe(dialog);
  });
}
function deletion(api: FakeApi) {
  api.override('POST /runs/deletion-eligibility/preview', ({ body }) => {
    const { runIds } = DeletionSelectionSchema.parse(body);
    return Response.json({
      token: 'a'.repeat(64),
      items: runIds.map((runId) => ({ runId, reasons: [] })),
    });
  });
  api.override('POST /runs/deletion-eligibility', ({ body }) => {
    const value = DeletionConfirmationSchema.parse(body);
    return Response.json({
      token: 'b'.repeat(64),
      items: value.runIds.map((runId) => ({ runId, reasons: [] })),
    });
  });
}
afterEach(async () => {
  for (const release of releases) release();
  releases.clear();
  cleanup();
  for (const client of clients) {
    await client.cancelQueries();
    client.clear();
  }
  clients.clear();
  onlineManager.setOnline(true);
});

// First schedule deliberately observes the initial healthy browser generation before any
// public disconnect transition in this isolated Vitest file. No private loss counter is reset.
it('C8 initial healthy event-qualified header may show an unread seed, then loss hides that unproved run', async () => {
  const api = new FakeApi();
  const run = waiting(api);
  const call: RecordedCall = {
    method: 'GET',
    path: `/runs/${run.id}`,
    search: new URLSearchParams(),
    body: undefined,
    headers: new Headers(),
  };
  const seed = RunSnapshotSchema.parse(await (await api.builtIn(call)).json());
  const hold = barrier();
  let held = 0;
  api.override('GET /runs/:id', async (request) => {
    held++;
    await hold.promise;
    return api.builtIn(request);
  });
  const view = mount(api, run.id, { seed });
  await heading(run.id);
  await waitFor(() =>
    expect(screen.getByRole('list', { name: 'Timeline' })).toHaveTextContent('run.started'),
  );
  expect(held).toBeGreaterThan(0);
  expect(button('Submit input')).toBeEnabled();
  act(() => onlineManager.setOnline(false));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('list', { name: 'Timeline' })).toBeVisible();
  expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  await view.queryClient.cancelQueries({ queryKey: keys.run(run.id), exact: true });
  hold.release();
  expect(writes(api)).toHaveLength(0);
});

describe('independent416: public inspector retention and scope', () => {
  it('C1/C7 keeps the same-wait editable draft through equal-body recovery, then resets a different wait', async () => {
    const api = new FakeApi();
    const run = waiting(api);
    const view = mount(api, run.id);
    const user = userEvent.setup();
    await settled(view, run.id);
    await user.type(await screen.findByLabelText('note'), 'retained locally');
    const before = view.queryClient.getQueryData(keys.run(run.id));
    await lose(view, run.id);
    expect(await heading(run.id)).toBeVisible();
    expect(screen.getByLabelText('note')).toHaveValue('retained locally');
    fireEvent.submit(screen.getByRole('form', { name: 'Submit input' }));
    expect(writes(api)).toHaveLength(0);
    await recover(view, run.id);
    expect(view.queryClient.getQueryData(keys.run(run.id))).toBe(before);
    expect(button('Submit input')).toBeEnabled();
    expect(screen.getByLabelText('note')).toHaveValue('retained locally');
    api.runs.set(run.id, { ...run, waiting: { ...run.waiting!, waitId: 'independent-wait-B' } });
    await reread(view, run.id);
    expect(screen.getByLabelText('note')).toHaveValue('');
  });

  it.each(['manual', 'remove-recreate', 'foreign-client', 'foreign-cache'] as const)(
    'C2 excludes %s data from the new outage fallback',
    async (kind) => {
      const api = new FakeApi();
      const run = waiting(api);
      const fakeCall: RecordedCall = {
        method: 'GET',
        path: `/runs/${run.id}`,
        search: new URLSearchParams(),
        body: undefined,
        headers: new Headers(),
      };
      const seeded = RunSnapshotSchema.parse(await (await api.builtIn(fakeCall)).json());
      const view = mount(api, run.id);
      await settled(view, run.id);
      api.offline = true;
      if (kind === 'manual') view.queryClient.setQueryData(keys.run(run.id), seeded);
      if (kind === 'remove-recreate') {
        view.queryClient.removeQueries({ queryKey: keys.run(run.id), exact: true });
        view.queryClient.setQueryData(keys.run(run.id), seeded);
      }
      if (kind === 'foreign-client') view.replaceClient();
      if (kind === 'foreign-cache') view.replaceCache();
      act(() => onlineManager.setOnline(false));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).not.toBeInTheDocument(),
      );
      expect(screen.queryByText(STALE)).not.toBeInTheDocument();
      expect(writes(api)).toHaveLength(0);
    },
  );

  it('C2 credential-generation change cannot erase the remembered outage latch', async () => {
    const api = new FakeApi();
    const run = waiting(api);
    const view = mount(api, run.id);
    await settled(view, run.id);
    await lose(view, run.id);
    const held = barrier();
    let seen = 0;
    api.override('GET /runs/:id', async (call) => {
      seen++;
      await held.promise;
      return api.builtIn(call);
    });
    api.offline = false;
    act(() => useApiKeyStore.getState().save('independent-synthetic-generation-B'));
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(seen).toBeGreaterThan(0));
    // New generation has no accepted receipt: neither a cached row nor online can unlock it.
    expect(screen.queryByRole('heading', { name: 'Run ' + run.id })).not.toBeInTheDocument();
    expect(writes(api)).toHaveLength(0);
    held.release();
    await waitFor(() => expect(button('Submit input')).toBeEnabled());
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });

  it.each([401, 403, 404, 500, 'wrong-id', 'invalid-body'] as const)(
    'C3 a definitive %s response then transport failure cannot revive retained fields',
    async (refusal) => {
      const api = new FakeApi();
      const run = row(api, { status: 'succeeded', result: 'independent-retained-secret' });
      const view = mount(api, run.id);
      await settled(view, run.id);
      api.override('GET /runs/:id', async (call) => {
        if (typeof refusal === 'number') return problem(refusal, 'CONTROLLED_REFUSAL');
        const body = RunSnapshotSchema.parse(await (await api.builtIn(call)).json());
        return Response.json(
          refusal === 'wrong-id'
            ? { ...body, id: fakeUlid('wrong-independent-id') }
            : { ...body, unexpectedExtraField: true },
        );
      });
      await reread(view, run.id);
      api.override('GET /runs/:id', () => {
        throw new TypeError('Controlled transport loss after refusal');
      });
      await reread(view, run.id);
      await waitFor(() => expect(screen.queryByTestId('run-result')).not.toBeInTheDocument());
      expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    },
  );

  it('C4 a pre-loss held completion cannot release the latch; only the second post-loss GET can', async () => {
    const api = new FakeApi();
    const run = waiting(api);
    const view = mount(api, run.id);
    await settled(view, run.id);
    const old = barrier();
    const next = barrier();
    let calls = 0;
    api.override('GET /runs/:id', async (call) => {
      const response = await api.builtIn(call);
      calls++;
      await (calls === 1 ? old.promise : next.promise);
      return response;
    });
    const preLoss = view.queryClient.refetchQueries({ queryKey: keys.run(run.id), exact: true });
    await waitFor(() => expect(calls).toBe(1));
    act(() => onlineManager.setOnline(false));
    await screen.findByText(STALE);
    act(() => onlineManager.setOnline(true));
    await act(async () => {
      old.release();
      await preLoss;
    });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByText(STALE)).toBeVisible();
    expect(button('Submit input')).toBeDisabled();
    next.release();
    await waitFor(() => expect(button('Submit input')).toBeEnabled());
  });

  it.each(['node', 'visit', 'run', 'code'] as const)(
    'C5 rejects mismatched %s observation after run recovery',
    async (mismatch) => {
      const api = new FakeApi();
      const run = missing(api);
      const view = mount(api, run.id);
      await settled(view, run.id);
      await waitFor(() => expect(button('Start fresh session for worker')).toBeEnabled());
      await lose(view, run.id);
      const hold = barrier();
      let seen = 0;
      api.override('GET /runs/:id/observation', async (call) => {
        seen++;
        await hold.promise;
        const body = (await (await api.builtIn(call)).json()) as Record<string, unknown>;
        const failure = run.failure!;
        const changed: NonNullable<RunRecord['failure']> = {
          ...failure,
          nodeId: mismatch === 'node' ? 'other-node' : failure.nodeId,
          code: mismatch === 'code' ? 'INTERNAL_ERROR' : failure.code,
          ...(mismatch === 'visit'
            ? {
                missingSession: {
                  ...failure.missingSession!,
                  visitId: run.id + ':different-visit',
                },
              }
            : {}),
        };
        return Response.json({
          ...body,
          lifecycle: event(
            mismatch === 'run' ? fakeUlid('foreign-failure') : run.id,
            3,
            'run.failed',
            { failure: changed },
          ),
        });
      });
      await recover(view, run.id);
      await waitFor(() => expect(seen).toBeGreaterThan(0));
      expect(button('Start fresh session for worker')).toBeDisabled();
      hold.release();
      await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
      expect(button('Start fresh session for worker')).toBeDisabled();
      expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(0);
    },
  );
});

type Operation =
  | 'pause'
  | 'cancel'
  | 'resume'
  | 'replay'
  | 'script-resume'
  | 'script-replay'
  | 'fresh-session'
  | 'input'
  | 'signal';
const operations: Operation[] = [
  'pause',
  'cancel',
  'resume',
  'replay',
  'script-resume',
  'script-replay',
  'fresh-session',
  'input',
  'signal',
];
function operationRun(api: FakeApi, op: Operation) {
  if (op === 'input' || op === 'signal') return waiting(api, op);
  if (op === 'fresh-session') return missing(api);
  if (op.startsWith('script-')) return scripted(api);
  return row(api, op === 'resume' ? { status: 'paused' } : {});
}
function endpoint(runId: string, op: Operation) {
  const suffix =
    op === 'script-resume'
      ? 'resume'
      : op === 'script-replay'
        ? 'replay'
        : op === 'fresh-session'
          ? 'recover-session'
          : op === 'signal'
            ? 'signals/go'
            : op;
  return `/runs/${runId}/${suffix}`;
}
async function choose(op: Operation) {
  const user = userEvent.setup();
  if (op === 'replay') {
    await user.click(button('Replay...'));
    const dialog = await screen.findByRole('dialog', { name: 'Replay as a new run' });
    await user.selectOptions(within(dialog).getByLabelText('Replay from node'), 'work');
    await user.click(within(dialog).getByRole('button', { name: 'Create replay run' }));
  } else if (op.startsWith('script-')) {
    await user.click(button('Recover script'));
    const dialog = await screen.findByRole('dialog', { name: 'Recover script' });
    await user.click(
      within(dialog).getByRole('button', {
        name: op === 'script-resume' ? 'Resume' : 'Replay',
      }),
    );
  } else if (op === 'input') {
    await user.type(screen.getByLabelText('note'), 'chosen-value');
    await user.click(button('Submit input'));
  } else if (op === 'signal') {
    await user.click(button('Send signal'));
  } else
    await user.click(
      button(
        op === 'pause'
          ? /Pause/
          : op === 'cancel'
            ? /Cancel run/
            : op === 'fresh-session'
              ? 'Start fresh session for worker'
              : 'Resume',
      ),
    );
}

describe('independent416: C6 public writes and queued dispatch', () => {
  for (const op of operations) {
    it(`${op}: a current choice sends the exact endpoint once`, async () => {
      const api = new FakeApi();
      const run = operationRun(api, op);
      const path = endpoint(run.id, op);
      api.override(`POST ${path}`, () =>
        Response.json(op.endsWith('replay') || op === 'replay' ? { run } : run, { status: 200 }),
      );
      const view = mount(api, run.id);
      await settled(view, run.id);
      await choose(op);
      await waitFor(() => expect(api.callsTo('POST', path)).toHaveLength(1));
      const body = api.callsTo('POST', path)[0]!.body;
      if (op === 'fresh-session') expect(body).toEqual({ nodeId: 'worker', failureSeq: 3 });
      if (op.startsWith('script-'))
        expect(body).toMatchObject({ observedSeq: 3, retryUncertainScript: true });
      if (op === 'resume' || op === 'replay') expect(body).toMatchObject({ observedSeq: 2 });
      if (op === 'input')
        expect(body).toEqual({ waitId: 'independent-wait-A', input: { note: 'chosen-value' } });
      if (op === 'signal') expect(body).toMatchObject({ waitId: 'independent-wait-A' });
    });
    it(`${op}: a queued choice spanning loss and recovery never reaches HTTP`, async () => {
      const api = new FakeApi();
      const run = operationRun(api, op);
      const view = mount(api, run.id, { queued: true });
      await settled(view, run.id);
      await choose(op);
      await waitFor(() => expect(view.queued()).toBe(1));
      await lose(view, run.id);
      await recover(view, run.id);
      view.hold.release();
      await waitFor(() =>
        expect(
          view.queryClient
            .getMutationCache()
            .getAll()
            .every((mutation) => mutation.state.status !== 'pending'),
        ).toBe(true),
      );
      expect(api.callsTo('POST', endpoint(run.id, op))).toHaveLength(0);
      expect(
        view.queryClient
          .getMutationCache()
          .getAll()
          .some(
            (mutation) =>
              mutation.state.error instanceof Error &&
              mutation.state.error.message.startsWith('Not sent:'),
          ),
      ).toBe(true);
    });
  }

  it('C5 a matching fresh observation after loss enables the failure-sequence3 choice despite audit4', async () => {
    const api = new FakeApi();
    const run = missing(api);
    const view = mount(api, run.id);
    await settled(view, run.id);
    await lose(view, run.id);
    const hold = barrier();
    let reads = 0;
    api.override('GET /runs/:id/observation', async (call) => {
      reads++;
      await hold.promise;
      return api.builtIn(call);
    });
    api.override(`POST /runs/${run.id}/recover-session`, () => Response.json(run));
    await recover(view, run.id);
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    expect(button('Start fresh session for worker')).toBeDisabled();
    hold.release();
    await waitFor(() => expect(button('Start fresh session for worker')).toBeEnabled());
    await choose('fresh-session');
    await waitFor(() =>
      expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(1),
    );
    expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)[0]!.body).toEqual({
      nodeId: 'worker',
      failureSeq: 3,
    });
  });
  it('C5 a queued fresh-session choice cannot answer a different failure visit even without an outage', async () => {
    const api = new FakeApi();
    const run = missing(api);
    const view = mount(api, run.id, { queued: true });
    await settled(view, run.id);
    await choose('fresh-session');
    await waitFor(() => expect(view.queued()).toBe(1));
    const failure = {
      ...run.failure!,
      missingSession: { ...run.failure!.missingSession!, visitId: run.id + ':visit-B' },
    };
    api.runs.set(run.id, { ...run, lastEventSeq: 6, failure });
    api.pushEvent(run.id, event(run.id, 5, 'run.failed', { failure }));
    api.pushEvent(run.id, event(run.id, 6, 'return.delivered', { channel: { kind: 'log' } }));
    await reread(view, run.id);
    await act(() =>
      view.queryClient.refetchQueries({ queryKey: keys.observation(run.id), exact: true }),
    );
    view.hold.release();
    await waitFor(() =>
      expect(
        view.queryClient
          .getMutationCache()
          .getAll()
          .every((m) => m.state.status !== 'pending'),
      ).toBe(true),
    );
    expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(0);
    expect(
      view.queryClient
        .getMutationCache()
        .getAll()
        .some(
          (m) =>
            m.state.error instanceof Error &&
            m.state.error.message ===
              'Not sent: the failure shown has changed. Review the run again.',
        ),
    ).toBe(true);
  });
});

describe('independent416: C7 expired reviews, late previews and sent outcomes', () => {
  it.each(['replay', 'script'] as const)(
    '%s review opened before loss stays expired after recovery; Escape sends nothing',
    async (kind) => {
      const api = new FakeApi();
      const run = kind === 'script' ? scripted(api) : row(api);
      const view = mount(api, run.id);
      const user = userEvent.setup();
      await settled(view, run.id);
      await user.click(button(kind === 'script' ? 'Recover script' : 'Replay...'));
      const dialog = await screen.findByRole('dialog', {
        name: kind === 'script' ? 'Recover script' : 'Replay as a new run',
      });
      await lose(view, run.id);
      await recover(view, run.id);
      await expired(dialog, kind === 'script' ? 'Resume' : 'Create replay run');
      await user.keyboard('{Escape}');
      expect(writes(api)).toHaveLength(0);
    },
  );
  it.each(['mark', 'withdraw'] as const)(
    'deletion %s: current preview/confirm sends once; expired review and late preview cannot confirm',
    async (action) => {
      const api = new FakeApi();
      deletion(api);
      const run = row(api, { status: 'succeeded' });
      const view = mount(api, run.id);
      const user = userEvent.setup();
      await settled(view, run.id);
      const open = action === 'mark' ? 'Review delete-ready history' : 'Withdraw delete-ready mark';
      const confirm = action === 'mark' ? 'Confirm delete-ready selection' : 'Confirm withdrawal';
      await user.click(button(open));
      let dialog = await screen.findByRole('dialog');
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: confirm })).toBeEnabled(),
      );
      await user.click(within(dialog).getByRole('button', { name: confirm }));
      await waitFor(() =>
        expect(api.callsTo('POST', '/runs/deletion-eligibility')).toHaveLength(1),
      );
      expect(
        DeletionConfirmationSchema.parse(
          api.callsTo('POST', '/runs/deletion-eligibility')[0]!.body,
        ),
      ).toMatchObject({ action, runIds: [run.id], confirmed: true });
      const late = barrier();
      let previews = 0;
      api.override('POST /runs/deletion-eligibility/preview', async (call) => {
        previews++;
        await late.promise;
        const { runIds } = DeletionSelectionSchema.parse(call.body);
        return Response.json({
          token: 'c'.repeat(64),
          items: runIds.map((runId) => ({ runId, reasons: [] })),
        });
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(button(open));
      dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(previews).toBe(1));
      await lose(view, run.id);
      const afterLoss = writes(api).length;
      fireEvent.click(button(open));
      expect(writes(api)).toHaveLength(afterLoss);
      await recover(view, run.id);
      late.release();
      await expired(dialog, confirm);
      expect(api.callsTo('POST', '/runs/deletion-eligibility')).toHaveLength(1);
    },
  );
  it('A→B→A never revives an old replay review or queued choice', async () => {
    const api = new FakeApi();
    const a = row(api);
    const b = row(api);
    const view = mount(api, a.id, { queued: true, otherRun: b.id });
    const user = userEvent.setup();
    await settled(view, a.id);
    await choose('replay');
    await waitFor(() => expect(view.queued()).toBe(1));
    await user.click(screen.getByRole('link', { name: 'Visit B' }));
    await heading(b.id);
    await user.click(screen.getByRole('link', { name: 'Visit A' }));
    await heading(a.id);
    view.hold.release();
    await waitFor(() =>
      expect(
        view.queryClient
          .getMutationCache()
          .getAll()
          .every((m) => m.state.status !== 'pending'),
      ).toBe(true),
    );
    expect(api.callsTo('POST', `/runs/${a.id}/replay`)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('A→B→A cannot revive a late deletion preview from an earlier visit', async () => {
    const api = new FakeApi();
    deletion(api);
    const a = row(api, { status: 'succeeded' });
    const b = row(api, { status: 'succeeded' });
    const late = barrier();
    let previews = 0;
    api.override('POST /runs/deletion-eligibility/preview', async (call) => {
      previews++;
      await late.promise;
      const { runIds } = DeletionSelectionSchema.parse(call.body);
      return Response.json({
        token: 'd'.repeat(64),
        items: runIds.map((runId) => ({ runId, reasons: [] })),
      });
    });
    const view = mount(api, a.id, { otherRun: b.id });
    const user = userEvent.setup();
    await settled(view, a.id);
    await user.click(button('Review delete-ready history'));
    await waitFor(() => expect(previews).toBe(1));
    await user.click(screen.getByRole('link', { name: 'Visit B' }));
    await heading(b.id);
    await user.click(screen.getByRole('link', { name: 'Visit A' }));
    await heading(a.id);
    late.release();
    await act(() => Promise.resolve());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/runs/deletion-eligibility')).toHaveLength(0);
  });
  it('an already-dispatched deletion retains delivery uncertainty after loss; it is not sent again', async () => {
    const api = new FakeApi();
    deletion(api);
    const run = row(api, { status: 'succeeded' });
    const sent = barrier();
    let dispatched = 0;
    api.override('POST /runs/deletion-eligibility', async () => {
      dispatched++;
      await sent.promise;
      throw new TypeError('Controlled lost acknowledgement');
    });
    const view = mount(api, run.id);
    const user = userEvent.setup();
    await settled(view, run.id);
    await user.click(button('Review delete-ready history'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Confirm delete-ready selection' }),
      ).toBeEnabled(),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirm delete-ready selection' }),
    );
    await waitFor(() => expect(dispatched).toBe(1));
    await lose(view, run.id);
    sent.release();
    expect(await screen.findByText(/The change may or may not have been saved/)).toBeVisible();
    await recover(view, run.id);
    expect(dispatched).toBe(1);
  });
});

describe('independent416: retained outcomes and C8 local-reading boundary', () => {
  it.each(['failed', 'succeeded'] as const)(
    'C1 retains %s result and explicitly controlled pending/uncertain delivery evidence',
    async (status) => {
      const api = new FakeApi();
      const run = row(api, {
        status,
        result: { marker: 'independent-observed-result' },
        ...(status === 'failed'
          ? {
              failure: {
                code: 'INTERNAL_ERROR',
                message: 'Independent observed failure',
                resumable: false,
              },
            }
          : {}),
        deliveries: [
          {
            id: 'independent-controlled-delivery',
            channel: { kind: 'webhook', url: 'https://controlled-delivery.invalid/not-contacted' },
            status: 'pending',
            attempts: 1,
            maxAttempts: 3,
            inFlight: true,
            acknowledgement: 'unknown',
            effectMayHaveHappened: true,
            acknowledgementUncertain: true,
          },
        ],
      });
      const view = mount(api, run.id);
      await settled(view, run.id);
      await lose(view, run.id);
      expect(screen.getByTestId('run-result')).toHaveTextContent('independent-observed-result');
      expect(screen.getByText('Delivery identity: independent-controlled-delivery')).toBeVisible();
      expect(screen.getByText('Pending (1/3 attempts)')).toBeVisible();
      expect(screen.getByText(/An acknowledgement was unknown/)).toBeVisible();
      expect(screen.getByText('Execution ended; finalization pending.')).toBeVisible();
      expect(writes(api)).toHaveLength(0);
    },
  );
  it('C8 selected exact thread keeps its preceding label while the next read is held through run loss', async () => {
    const api = new FakeApi();
    const run = row(api);
    const hold = barrier();
    let waitingSecond = 0;
    const base = ContextThreadSchema.parse(api.threads.get(run.id));
    api.override('GET /runs/:id/thread', async (call) => {
      const at = call.search.get('at');
      const response = Response.json({ ...base, vars: { independentPosition: at ?? 'current' } });
      if (at === '2') {
        waitingSecond++;
        await hold.promise;
      }
      return response;
    });
    const view = mount(api, run.id);
    const user = userEvent.setup();
    await settled(view, run.id);
    const timeline = screen.getByRole('list', { name: 'Timeline' });
    await user.click(within(timeline).getByRole('button', { name: /#1.*run.queued/ }));
    await screen.findByRole('heading', { name: 'Thread at event 1' });
    await user.click(within(timeline).getByRole('button', { name: /#2.*run.started/ }));
    await waitFor(() => expect(waitingSecond).toBe(1));
    await lose(view, run.id);
    expect(screen.getByRole('heading', { name: 'Thread at event 1' })).toBeVisible();
    expect(screen.getByText('Reading the thread at event 2…')).toBeVisible();
    expect(timeline).toBeVisible();
    hold.release();
    await screen.findByRole('heading', { name: 'Thread at event 2' });
    expect(writes(api)).toHaveLength(0);
  });
  it('C8 Runs-list deletion retains its ordinary healthy workflow after leaving a stale inspector', async () => {
    const api = new FakeApi();
    deletion(api);
    const run = row(api, { status: 'succeeded' });
    const view = mount(api, run.id);
    const user = userEvent.setup();
    await settled(view, run.id);
    await lose(view, run.id);
    api.offline = false;
    await user.click(screen.getByRole('link', { name: 'History list' }));
    await user.click(await screen.findByRole('checkbox', { name: `Select history ${run.id}` }));
    await user.click(button('Review delete-ready history'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm delete-ready selection' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() => expect(api.callsTo('POST', '/runs/deletion-eligibility')).toHaveLength(1));
    expect(
      DeletionConfirmationSchema.parse(api.callsTo('POST', '/runs/deletion-eligibility')[0]!.body)
        .runIds,
    ).toEqual([run.id]);
  });
});
