import { DeletionConfirmationSchema, DeletionSelectionSchema } from '@graphgoblin/contracts';
import type { RunRecord, RunRecovery } from '@graphgoblin/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp, type Rendered } from '../__fixtures__/render.js';
import { API_KEY_STORAGE, useApiKeyStore } from '../api/api-key.js';
import { notSentByKey, requestedBeforeKey, reviewClosedByKey } from './inspector/RunControls.js';

/**
 * #562: a choice made in the inspector under one accepted API-key credential is never sent under
 * another. A review open across the change closes and says so; a write queued before dispatch sends
 * nothing; a write already sent stays the one request and its outcome is not shown under the new
 * credential. The same key saved again while accepted keeps everything.
 */

const KEY_A = 'gg_first_key';
const KEY_B = 'gg_second_key';

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

/** A finished run whose node `done` may be replayed (after explicit consent, with `consent`). */
function replayableRun(api: FakeApi, consent = false) {
  const run = startedRun(api, { status: 'succeeded', currentNodeId: 'done' });
  const recovery: RunRecovery = {
    observedSeq: 2,
    resume: { allowed: false, code: 'RUN_FINISHED', message: 'This run cannot be resumed.' },
    replayDefault: { allowed: true },
    replay: [
      {
        nodeId: 'done',
        label: 'Done',
        effects: [],
        action: consent
          ? {
              allowed: false,
              code: 'SCRIPT_CONSENT_REQUIRED',
              message: 'Allow the uncertain script to run again.',
            }
          : { allowed: true },
      },
    ],
  };
  api.recovery.set(run.id, recovery);
  return run;
}

/** Every Replay of `run` creates `fork`; with `hold`, the answer waits until the test settles it. */
function forks(api: FakeApi, hold = false) {
  const fork = api.addRun({ status: 'running' });
  const held: { answer: (response: Response) => void }[] = [];
  api.override('POST /runs/:id/replay', () =>
    hold
      ? new Promise<Response>((resolve) => held.push({ answer: resolve }))
      : Response.json({ run: fork }, { status: 202 }),
  );
  return { fork, held };
}

/** Holds every mutation before its API call until released, as a configured client may. */
function heldMutations(view: Rendered) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { queued: false };
  view.queryClient.getMutationCache().config.onMutate = () => {
    state.queued = true;
    return held;
  };
  return { state, release };
}

/** Another tab of this browser stores `key` (or forgets it); this tab hears a real storage event. */
function otherTab(key: string | null) {
  if (key === null) localStorage.removeItem(API_KEY_STORAGE);
  else localStorage.setItem(API_KEY_STORAGE, key);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
  });
}

const openRun = (runId: string) => screen.findByRole('heading', { name: 'Run ' + runId });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const header = (runId: string) =>
  screen.getByRole('heading', { name: 'Run ' + runId }).closest('header')!;
const posts = (api: FakeApi) => api.calls.filter((call) => call.method === 'POST');
const sentAs = (api: FakeApi) =>
  posts(api).map((call) => call.headers.get('authorization')?.replace('Bearer ', ''));
const location = () => screen.getByTestId('location').textContent;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

async function openReplay(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(button('Replay...')).toBeEnabled());
  await user.click(button('Replay...'));
  return screen.findByRole('dialog', { name: 'Replay as a new run' });
}

describe('inspector writes belong to the accepted API key they were chosen under (#562)', () => {
  it('closes a Replay review when another tab stores another key, sends nothing, and sends a fresh choice once as that key', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api);
    const { fork } = forks(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const closed = reviewClosedByKey('Replay...');
    try {
      await openRun(run.id);
      await openReplay(user);

      otherTab(KEY_B);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // Said in the status line under the Resume reason; focus returns to the enabled trigger.
      const status = within(header(run.id)).getByText(closed);
      expect(status).toHaveAttribute('role', 'status');
      expect(status.previousElementSibling).toHaveAttribute('id', `resume-reason-${run.id}`);
      await waitFor(() => expect(button('Replay...')).toHaveFocus());
      expect(within(header(run.id)).queryByRole('alert')).toBeNull();
      // The run is read again under the new key; nothing was written.
      await waitFor(() =>
        expect(api.callsTo('GET', `/runs/${run.id}`).at(-1)?.headers.get('authorization')).toBe(
          `Bearer ${KEY_B}`,
        ),
      );
      expect(posts(api)).toHaveLength(0);

      // Opening it again is a new review under the current key, and the report goes.
      const again = await openReplay(user);
      expect(screen.queryByText(closed)).toBeNull();
      await user.click(within(again).getByRole('button', { name: 'Create replay run' }));
      await waitFor(() => expect(location()).toBe('/runs/' + fork.id));
      expect(sentAs(api)).toEqual([KEY_B]);
    } finally {
      view.unmount();
    }
  });

  it('keeps a review, its node and its consent when the accepted key is saved again, and sends one click once', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api, true);
    const { fork } = forks(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      const dialog = await openReplay(user);
      await user.click(within(dialog).getByRole('checkbox'));
      const generation = useApiKeyStore.getState().generation;

      act(() => useApiKeyStore.getState().save(KEY_A));
      otherTab(KEY_A);
      expect(useApiKeyStore.getState().generation).toBe(generation);
      await settle();
      expect(dialog).toBeVisible();
      expect(within(dialog).getByRole('checkbox')).toBeChecked();
      expect(screen.queryByText(reviewClosedByKey('Replay...'))).toBeNull();

      await user.click(within(dialog).getByRole('button', { name: 'Create replay run' }));
      await waitFor(() => expect(location()).toBe('/runs/' + fork.id));
      expect(sentAs(api)).toEqual([KEY_A]);
      expect(posts(api)[0]!.body).toEqual({
        nodeId: 'done',
        observedSeq: 2,
        retryUncertainScript: true,
      });
    } finally {
      view.unmount();
    }
  });

  it.each([
    [
      'A→B→A',
      () => {
        useApiKeyStore.getState().save(KEY_B);
        useApiKeyStore.getState().save(KEY_A);
      },
    ],
    [
      'forgetting and entering A again',
      () => {
        useApiKeyStore.getState().forget();
        useApiKeyStore.getState().save(KEY_A);
      },
    ],
    [
      'a rejection and A accepted again',
      () => {
        useApiKeyStore.getState().markRejected();
        useApiKeyStore.getState().save(KEY_A);
      },
    ],
  ])('expires a review across %s', async (_name, change) => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api, true);
    forks(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      const dialog = await openReplay(user);
      await user.click(within(dialog).getByRole('checkbox'));
      act(change);
      expect(useApiKeyStore.getState().key).toBe(KEY_A);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await screen.findByText(reviewClosedByKey('Replay...'))).toBeVisible();
      expect(posts(api)).toHaveLength(0);
      // Reopened, its node and consent start again.
      const again = await openReplay(user);
      expect(within(again).getByRole('checkbox')).not.toBeChecked();
      expect(within(again).getByRole('button', { name: 'Create replay run' })).toBeDisabled();
    } finally {
      view.unmount();
    }
  });

  it('sends nothing for a click on the old review after the key changes and before React re-renders', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api);
    forks(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      const dialog = await openReplay(user);
      const create = within(dialog).getByRole('button', { name: 'Create replay run' });
      let stillShown: boolean | undefined;
      // Runs synchronously inside the store update, after React has only scheduled its render.
      const stop = useApiKeyStore.subscribe(() => {
        stillShown =
          dialog.hasAttribute('open') &&
          create instanceof HTMLButtonElement &&
          create.isConnected &&
          !create.disabled;
        fireEvent.click(create);
      });
      try {
        useApiKeyStore.getState().save(KEY_B);
      } finally {
        stop();
      }
      expect(stillShown).toBe(true);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await settle();
      expect(posts(api)).toHaveLength(0);
      expect(within(header(run.id)).queryByRole('alert')).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it.each(['replacement', 'same key as a new generation'] as const)(
    'sends nothing for a Replay queued before dispatch across a %s, and says so outside the closed review',
    async (variant) => {
      useApiKeyStore.getState().save(KEY_A);
      const api = new FakeApi();
      const run = replayableRun(api);
      forks(api);
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const mutations = heldMutations(view);
      try {
        await openRun(run.id);
        const dialog = await openReplay(user);
        await user.click(within(dialog).getByRole('button', { name: 'Create replay run' }));
        await waitFor(() => expect(mutations.state.queued).toBe(true));
        expect(posts(api)).toHaveLength(0);

        act(() => {
          if (variant === 'replacement') useApiKeyStore.getState().save(KEY_B);
          else {
            useApiKeyStore.getState().markRejected();
            useApiKeyStore.getState().save(KEY_A);
          }
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        // Its write is unsettled, so the review does not claim nothing was sent; the trigger
        // waits for it, and focus goes to the status line that will report it.
        expect(screen.queryByText(reviewClosedByKey('Replay...'))).toBeNull();
        expect(button('Replay...')).toBeDisabled();
        expect(document.activeElement).toHaveAttribute('role', 'status');

        mutations.release();
        const alert = await within(header(run.id)).findByRole('alert');
        expect(alert).toHaveTextContent(notSentByKey('Replay'));
        await settle();
        // Nothing is sent, retried or reopened.
        expect(posts(api)).toHaveLength(0);
        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(() => expect(button('Replay...')).toBeEnabled());
      } finally {
        mutations.release();
        view.unmount();
      }
    },
  );

  it.each(['Pause', 'Cancel run'] as const)(
    'sends nothing for %s queued before another tab stores another key',
    async (name) => {
      useApiKeyStore.getState().save(KEY_A);
      const api = new FakeApi();
      const run = startedRun(api);
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      const mutations = heldMutations(view);
      try {
        await openRun(run.id);
        await waitFor(() => expect(button(new RegExp(name))).toBeEnabled());
        await user.click(button(new RegExp(name)));
        await waitFor(() => expect(mutations.state.queued).toBe(true));
        otherTab(KEY_B);
        mutations.release();
        expect(await within(header(run.id)).findByRole('alert')).toHaveTextContent(
          notSentByKey(name),
        );
        await settle();
        expect(posts(api)).toHaveLength(0);
        // A new choice under the current key is sent once, as that key.
        await waitFor(() => expect(button(new RegExp(name))).toBeEnabled());
        await user.click(button(new RegExp(name)));
        await waitFor(() => expect(sentAs(api)).toEqual([KEY_B]));
        await waitFor(() => expect(within(header(run.id)).queryByRole('alert')).toBeNull());
      } finally {
        mutations.release();
        view.unmount();
      }
    },
  );

  it.each(['is accepted', 'is refused'] as const)(
    'keeps a Replay sent under the first key one pending request through a switch, and shows neither its run nor its answer when it %s',
    async (settled) => {
      useApiKeyStore.getState().save(KEY_A);
      const api = new FakeApi();
      const run = replayableRun(api);
      const { fork, held } = forks(api, true);
      const other = api.addRun({ status: 'running' });
      const detail = `A replay from this node already exists: run ${other.id}.`;
      const view = renderApp('/runs/' + run.id, api);
      const user = userEvent.setup();
      try {
        await openRun(run.id);
        const dialog = await openReplay(user);
        await user.click(within(dialog).getByRole('button', { name: 'Create replay run' }));
        await waitFor(() => expect(held).toHaveLength(1));
        expect(sentAs(api)).toEqual([KEY_A]);

        otherTab(KEY_B);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        // Still the one pending request: nothing else can be chosen, and nothing is resent.
        expect(button('Replay...')).toBeDisabled();
        expect(screen.queryByText(reviewClosedByKey('Replay...'))).toBeNull();
        expect(document.activeElement).toHaveAttribute('role', 'status');

        await act(async () => {
          held[0]!.answer(
            settled === 'is accepted'
              ? Response.json({ run: fork }, { status: 202 })
              : problem(409, 'REPLAY_EXISTS', detail),
          );
          await Promise.resolve();
        });
        const requested = await within(header(run.id)).findByText(requestedBeforeKey('Replay'));
        expect(requested).toHaveAttribute('role', 'status');
        await waitFor(() => expect(button('Replay...')).toBeEnabled());
        expect(location()).toBe('/runs/' + run.id);
        expect(within(header(run.id)).queryByRole('alert')).toBeNull();
        expect(document.body.textContent).not.toContain(fork.id);
        expect(document.body.textContent).not.toContain(detail);
        expect(document.body.textContent).not.toContain(other.id);
        await settle();
        expect(sentAs(api)).toEqual([KEY_A]);
        // The run is still read again after the answer, as after any write.
        expect(api.callsTo('GET', `/runs/${run.id}`).at(-1)?.headers.get('authorization')).toBe(
          `Bearer ${KEY_B}`,
        );
      } finally {
        held.forEach(({ answer }) => answer(Response.json({ run: fork }, { status: 202 })));
        view.unmount();
      }
    },
  );

  it('hides an earlier key’s refusal once another key is accepted', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = startedRun(api);
    api.override('POST /runs/:id/pause', () => problem(409, 'RUN_BUSY', 'Busy with run-x.'));
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await waitFor(() => expect(button(/Pause/)).toBeEnabled());
      await user.click(button(/Pause/));
      expect(await within(header(run.id)).findByRole('alert')).toHaveTextContent(
        'Busy with run-x. (RUN_BUSY)',
      );
      otherTab(KEY_B);
      await waitFor(() => expect(within(header(run.id)).queryByRole('alert')).toBeNull());
      expect(document.body.textContent).not.toContain('run-x');
      expect(screen.queryByText(requestedBeforeKey('Pause'))).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('sends one Replay for a double click under the second key, as that key', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api);
    const { fork } = forks(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      otherTab(KEY_B);
      const dialog = await openReplay(user);
      await user.dblClick(within(dialog).getByRole('button', { name: 'Create replay run' }));
      await waitFor(() => expect(location()).toBe('/runs/' + fork.id));
      expect(sentAs(api)).toEqual([KEY_B]);
    } finally {
      view.unmount();
    }
  });

  it('leaves focus with the API key prompt when a rejection closes a review', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api);
    forks(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await openReplay(user);
      act(() => useApiKeyStore.getState().markRejected());
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /Replay/ })).toBeNull());
      await screen.findByRole('heading', { name: 'API key required' });
      const input = document.getElementById('api-key-input')!;
      await waitFor(() => expect(input).toHaveFocus());
      await settle();
      expect(input).toHaveFocus();
      expect(screen.getByText(reviewClosedByKey('Replay...'))).toBeInTheDocument();
      expect(posts(api)).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it('keeps an open review and the event-qualified header through a pending run read under the same key', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = replayableRun(api);
    api.runs.set(run.id, { ...api.runs.get(run.id)!, status: 'running', currentNodeId: 'work' });
    const { fork } = forks(api);
    let releaseReads!: () => void;
    const reads = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const state = { blocking: false, held: 0 };
    api.override('GET /runs/:id', async (call) => {
      if (state.blocking) {
        state.held += 1;
        await reads;
      }
      return api.builtIn(call);
    });
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await screen.findByRole('list', { name: 'Timeline' });
      const dialog = await openReplay(user);
      state.blocking = true;
      api.runs.set(run.id, { ...api.runs.get(run.id)!, status: 'succeeded', lastEventSeq: 3 });
      act(() =>
        api.pushEvent(
          run.id,
          event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
        ),
      );
      await waitFor(() => expect(state.held).toBeGreaterThan(0), { timeout: 5000 });
      expect(
        await within(header(run.id)).findByText(
          'Status from event #3; the run record is updating.',
        ),
      ).toBeVisible();
      act(() => useApiKeyStore.getState().save(KEY_A));
      await settle();
      expect(dialog).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Create replay run' }));
      await waitFor(() => expect(location()).toBe('/runs/' + fork.id));
      expect(sentAs(api)).toEqual([KEY_A]);
    } finally {
      releaseReads();
      view.unmount();
    }
  });
});

describe('script, session, input and history writes follow the same credential (#562)', () => {
  function uncertainScriptRun(api: FakeApi) {
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
    return run;
  }

  function missingSessionRun(api: FakeApi) {
    const run = startedRun(api, { status: 'failed', lastEventSeq: 3, currentNodeId: 'worker' });
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

  it('closes a script recovery review across a key change and does not send a Resume queued before it', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = uncertainScriptRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await user.click(button('Recover script'));
      await screen.findByRole('dialog', { name: 'Recover script' });
      otherTab(KEY_B);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const closed = within(header(run.id)).getByText(reviewClosedByKey('Recover script'));
      expect(closed).toHaveAttribute('role', 'status');
      await waitFor(() => expect(button('Recover script')).toHaveFocus());

      const mutations = heldMutations(view);
      try {
        await user.click(button('Recover script'));
        expect(screen.queryByText(reviewClosedByKey('Recover script'))).toBeNull();
        const dialog = await screen.findByRole('dialog', { name: 'Recover script' });
        await user.click(within(dialog).getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(mutations.state.queued).toBe(true));
        otherTab(KEY_A);
        mutations.release();
        expect(await within(header(run.id)).findByRole('alert')).toHaveTextContent(
          notSentByKey('Resume'),
        );
        await settle();
        expect(posts(api)).toHaveLength(0);
      } finally {
        mutations.release();
      }
    } finally {
      view.unmount();
    }
  });

  it('reports only that a script retry was requested when it settles under another key', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = uncertainScriptRun(api);
    let answer!: (response: Response) => void;
    api.override(
      'POST /runs/:id/replay',
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const fork = api.addRun({ status: 'running' });
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    try {
      await openRun(run.id);
      await user.click(button('Recover script'));
      const dialog = await screen.findByRole('dialog', { name: 'Recover script' });
      await user.click(within(dialog).getByRole('button', { name: 'Replay' }));
      await waitFor(() => expect(sentAs(api)).toEqual([KEY_A]));
      otherTab(KEY_B);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await act(async () => {
        answer(Response.json({ run: fork }, { status: 202 }));
        await Promise.resolve();
      });
      expect(await screen.findByText(requestedBeforeKey('Replay'))).toBeVisible();
      expect(location()).toBe('/runs/' + run.id);
      expect(document.body.textContent).not.toContain(fork.id);
      expect(sentAs(api)).toEqual([KEY_A]);
    } finally {
      view.unmount();
    }
  });

  it('does not send a fresh-session choice queued under another key, and reports one sent before a key change only as requested', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = missingSessionRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const start = () => button('Start fresh session for worker');
    const mutations = heldMutations(view);
    try {
      await openRun(run.id);
      await waitFor(() => expect(start()).toBeEnabled());
      await user.click(start());
      await waitFor(() => expect(mutations.state.queued).toBe(true));
      otherTab(KEY_B);
      mutations.release();
      expect(await screen.findByText(notSentByKey('Start fresh session'))).toBeVisible();
      await settle();
      expect(posts(api)).toHaveLength(0);

      delete view.queryClient.getMutationCache().config.onMutate;
      let answer!: (response: Response) => void;
      api.override(
        'POST /runs/:id/recover-session',
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      await waitFor(() => expect(start()).toBeEnabled());
      await user.click(start());
      await waitFor(() => expect(sentAs(api)).toEqual([KEY_B]));
      expect(screen.queryByText(notSentByKey('Start fresh session'))).toBeNull();
      otherTab(KEY_A);
      await act(async () => {
        answer(problem(409, 'RECOVERY_REFUSED', 'Refused for run-secret.'));
        await Promise.resolve();
      });
      expect(await screen.findByText(requestedBeforeKey('Start fresh session'))).toBeVisible();
      expect(document.body.textContent).not.toContain('run-secret');
      expect(sentAs(api)).toEqual([KEY_B]);
    } finally {
      mutations.release();
      view.unmount();
    }
  });

  it('keeps a typed input draft when its queued answer is not sent under another key, and reports a sent one only as requested', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = waitingRun(api);
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const inputs = () => api.callsTo('POST', `/runs/${run.id}/input`);
    const mutations = heldMutations(view);
    try {
      await openRun(run.id);
      const note = await screen.findByRole('textbox', { name: /note/i });
      await user.type(note, 'keep me');
      await waitFor(() => expect(button('Submit input')).toBeEnabled());
      await user.click(button('Submit input'));
      await waitFor(() => expect(mutations.state.queued).toBe(true));
      otherTab(KEY_B);
      mutations.release();
      expect(await screen.findByText(notSentByKey('Submit input'))).toBeVisible();
      await settle();
      expect(inputs()).toHaveLength(0);
      expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('keep me');

      delete view.queryClient.getMutationCache().config.onMutate;
      let answer!: (response: Response) => void;
      api.override(
        'POST /runs/:id/input',
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      await waitFor(() => expect(button('Submit input')).toBeEnabled());
      await user.click(button('Submit input'));
      await waitFor(() => expect(inputs()).toHaveLength(1));
      expect(inputs()[0]!.headers.get('authorization')).toBe(`Bearer ${KEY_B}`);
      otherTab(KEY_A);
      await act(async () => {
        answer(problem(409, 'WAIT_CHANGED', 'Wait wait-secret has moved on.'));
        await Promise.resolve();
      });
      expect(await screen.findByText(requestedBeforeKey('Submit input'))).toBeVisible();
      expect(document.body.textContent).not.toContain('wait-secret');
      expect(inputs()).toHaveLength(1);
    } finally {
      mutations.release();
      view.unmount();
    }
  });

  it('closes a delete-ready review and drops its preview across a key change, and reports a confirmation sent before one only as requested', async () => {
    useApiKeyStore.getState().save(KEY_A);
    const api = new FakeApi();
    const run = startedRun(api, { status: 'succeeded', currentNodeId: 'done' });
    const previewsHeld: (() => void)[] = [];
    let holdPreview = true;
    api.override('POST /runs/deletion-eligibility/preview', ({ body }) => {
      const { runIds } = DeletionSelectionSchema.parse(body);
      const answer = Response.json({
        token: 'a'.repeat(64),
        items: runIds.map((runId) => ({ runId, reasons: [] })),
      });
      return holdPreview
        ? new Promise<Response>((resolve) => previewsHeld.push(() => resolve(answer)))
        : answer;
    });
    let confirm!: (response: Response) => void;
    api.override('POST /runs/deletion-eligibility', ({ body }) => {
      DeletionConfirmationSchema.parse(body);
      return new Promise<Response>((resolve) => {
        confirm = resolve;
      });
    });
    const view = renderApp('/runs/' + run.id, api);
    const user = userEvent.setup();
    const previews = () => api.callsTo('POST', '/runs/deletion-eligibility/preview');
    const confirms = () => api.callsTo('POST', '/runs/deletion-eligibility');
    try {
      await openRun(run.id);
      await waitFor(() => expect(button('Review delete-ready history')).toBeEnabled());
      await user.click(button('Review delete-ready history'));
      await screen.findByRole('dialog', { name: 'Mark selected history delete-ready?' });
      await waitFor(() => expect(previews()).toHaveLength(1));

      // The preview read under the first key answers only after the second is stored.
      otherTab(KEY_B);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const closed = screen.getByText(reviewClosedByKey('Review delete-ready history'));
      expect(closed).toHaveAttribute('aria-live', 'polite');
      await waitFor(() => expect(button('Review delete-ready history')).toHaveFocus());
      await act(async () => {
        previewsHeld[0]!();
        await Promise.resolve();
      });
      await settle();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(confirms()).toHaveLength(0);

      // A new review under the second key reads its own preview; its confirmation is sent as B.
      holdPreview = false;
      await user.click(button('Review delete-ready history'));
      expect(screen.queryByText(reviewClosedByKey('Review delete-ready history'))).toBeNull();
      const confirmButton = await screen.findByRole('button', {
        name: 'Confirm delete-ready selection',
      });
      await waitFor(() => expect(confirmButton).toBeEnabled());
      await user.click(confirmButton);
      await waitFor(() => expect(confirms()).toHaveLength(1));
      expect(confirms()[0]!.headers.get('authorization')).toBe(`Bearer ${KEY_B}`);
      expect(previews().map((call) => call.headers.get('authorization'))).toEqual([
        `Bearer ${KEY_A}`,
        `Bearer ${KEY_B}`,
      ]);

      otherTab(KEY_A);
      await act(async () => {
        confirm(Response.json({ token: 'a'.repeat(64), items: [{ runId: run.id, reasons: [] }] }));
        await Promise.resolve();
      });
      expect(
        await screen.findByText(requestedBeforeKey('Confirm delete-ready selection')),
      ).toBeVisible();
      expect(screen.queryByText('1 run marked delete-ready.')).toBeNull();
      expect(confirms()).toHaveLength(1);
    } finally {
      previewsHeld.forEach((release) => release());
      view.unmount();
    }
  });
});
