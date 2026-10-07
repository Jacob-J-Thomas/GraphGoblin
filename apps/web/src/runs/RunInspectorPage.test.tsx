import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { event, FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useRunEventStore } from './event-store.js';

function seedRun(api: FakeApi, overrides: Parameters<FakeApi['addRun']>[0] = {}) {
  const run = api.addRun(overrides);
  const r = run.id;
  api.pushEvent(r, event(r, 1, 'run.queued', {}));
  api.pushEvent(r, event(r, 2, 'run.started', { attempt: 1 }));
  api.pushEvent(
    r,
    event(r, 3, 'node.started', { nodeId: 'prep', kind: 'mutate', attempt: 1, configHash: 'h' }),
  );
  api.pushEvent(
    r,
    event(r, 4, 'node.finished', {
      nodeId: 'prep',
      durationMs: 5,
      patch: [
        { op: 'add', path: '/vars/topic', value: 'loops' },
        {
          op: 'add',
          path: '/messages/-',
          value: {
            id: 'n1',
            role: 'note',
            content: 'Topic is loops',
            nodeId: 'prep',
            ts: '2026-10-02T12:00:00.000Z',
          },
        },
      ],
    }),
  );
  api.pushEvent(
    r,
    event(r, 5, 'node.progress', { nodeId: 'infer', progress: { item: 'thinking' } }),
  );
  api.pushEvent(
    r,
    event(r, 6, 'harness.usage', {
      nodeId: 'infer',
      usage: { inputTokens: 3, outputTokens: 4, cachedInputTokens: 0, reasoningOutputTokens: 0 },
    }),
  );
  return run;
}

describe('RunInspectorPage', () => {
  it.each([
    {
      result: { kind: 'completed', reason: 'criterion-matched', outcome: 'failure' },
      expected: 'Exited: a criterion matched (failure)',
    },
    {
      result: { kind: 'limit-reached', limit: 'max-duration', value: 10, outcome: 'exhausted' },
      expected: 'Exited: duration limit of 10 seconds reached',
    },
  ] as const)(
    'renders $expected without a criterion index in the timeline and run detail',
    async ({ result, expected }) => {
      const api = new FakeApi();
      const run = api.addRun({ status: 'failed' });
      api.pushEvent(
        run.id,
        event(run.id, 1, 'exit.evaluated', {
          nodeId: 'done',
          iteration: 2,
          maxIterations: 5,
          criteria: [],
          result,
        }),
      );
      renderApp(`/runs/${run.id}`, api);
      const timeline = await screen.findByRole('list', { name: 'Timeline' });
      expect(await within(timeline).findByText(expected)).toBeInTheDocument();
      expect(await screen.findAllByText(expected)).toHaveLength(3);
      expect(screen.queryByText(/default success|loop ceiling/)).not.toBeInTheDocument();
    },
  );
  it('explains exit criteria and skipped decision strategies in the timeline and selected detail', async () => {
    const api = new FakeApi();
    const run = api.addRun({ status: 'succeeded' });
    api.pushEvent(run.id, event(run.id, 1, 'run.queued', {}));
    api.pushEvent(
      run.id,
      event(run.id, 2, 'decision.made', {
        nodeId: 'choose',
        strategy: 'expression',
        route: 'yes',
        skipped: [
          {
            strategy: 'jev',
            code: 'CLASSIFIER_MODEL_DISABLED',
            message: 'The selected classifier is disabled',
          },
        ],
      }),
    );
    api.pushEvent(
      run.id,
      event(run.id, 3, 'exit.evaluated', {
        nodeId: 'done',
        iteration: 2,
        maxIterations: 5,
        criteria: [
          {
            index: 0,
            strategy: 'jev',
            status: 'not-matched',
            holds: false,
            confidence: 0.9,
            classifierModel: 'jev',
          },
          {
            index: 1,
            strategy: 'codex',
            status: 'matched',
            holds: true,
            confidence: 0.93,
            minConfidence: 0.8,
            model: 'judge-model',
            reasoning: 'All checks passed',
          },
          {
            index: 2,
            strategy: 'expression',
            status: 'skipped',
            reason: { code: 'EARLIER_CRITERION_MATCHED', message: 'An earlier criterion matched' },
          },
        ],
        result: {
          kind: 'completed',
          outcome: 'success',
          reason: 'criterion-matched',
          criterionIndex: 1,
        },
      }),
    );
    renderApp(`/runs/${run.id}`, api);
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    expect(
      await within(timeline).findByText(
        /Exited: criterion 2 \(Codex\) matched with confidence 0.93/,
      ),
    ).toBeInTheDocument();
    expect(
      within(timeline).getByText(/Skipped Jev: The selected classifier is disabled/),
    ).toBeInTheDocument();
    const criteria = await screen.findByRole('list', { name: 'Exit criteria' });
    expect(criteria).toHaveTextContent(
      'Criterion 1 (Jev): did not match; predicate false; confidence 0.9; classifier jev',
    );
    expect(criteria).toHaveTextContent('model judge-model');
    expect(criteria).toHaveTextContent('Judge reasoning: All checks passed');
    expect(criteria).toHaveTextContent(
      'Criterion 3 (expression): skipped: An earlier criterion matched',
    );
    await userEvent.click(within(timeline).getByRole('button', { name: /decision.made/ }));
    expect(screen.getByRole('list', { name: 'Skipped strategies' })).toHaveTextContent(
      'Skipped Jev: The selected classifier is disabled',
    );
  });
  it('streams the timeline, replays the thread at any event, and shows the patch diff', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api);
    renderApp(`/runs/${run.id}`, api);

    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await waitFor(() => expect(within(timeline).getAllByRole('button')).toHaveLength(6));
    expect(screen.getByText(/Timeline \(6 events, live\)/)).toBeInTheDocument();

    // At the latest event the replayed thread has the mutation's variable and message.
    await waitFor(() =>
      expect(screen.getByLabelText('Variables')).toHaveTextContent('"topic": "loops"'),
    );
    expect(
      within(screen.getByRole('list', { name: 'Messages' })).getByText('Topic is loops'),
    ).toBeInTheDocument();

    // Before the node finished the thread is the initial one.
    await user.click(within(timeline).getByText(/#3/));
    expect(screen.getByLabelText('Variables')).toHaveTextContent('{}');
    expect(screen.getByText('Thread at event 3')).toBeInTheDocument();

    await user.click(within(timeline).getByText(/#4/));
    const diff = screen.getByRole('list', { name: 'Patch diff' });
    expect(within(diff).getByText('/vars/topic')).toBeInTheDocument();
    expect(within(diff).getAllByText(/\(absent\)/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('thread-json')).toHaveTextContent('"prep": 1');

    // A live event arrives.
    act(() =>
      api.pushEvent(
        run.id,
        event(run.id, 7, 'decision.made', {
          skipped: [],
          nodeId: 'decide',
          strategy: 'expression',
          route: 'good',
        }),
      ),
    );
    await waitFor(() => expect(within(timeline).getAllByRole('button')).toHaveLength(7));

    // Progress drawer groups node activity.
    await user.click(screen.getByText(/Node progress/));
    expect(screen.getByText(/thinking/)).toBeInTheDocument();
    expect(screen.getAllByText(/outputTokens/).length).toBeGreaterThan(0);
  });

  it('replays a child run from its seeded first event and reports logs that do not replay', async () => {
    const api = new FakeApi();
    const seeded = api.addRun({ parentRunId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ' });
    const seed = { ...api.threads.get(seeded.id)!, vars: { fromParent: 'yes' } };
    api.pushEvent(seeded.id, event(seeded.id, 1, 'run.queued', { initialThread: seed }));
    api.pushEvent(
      seeded.id,
      event(seeded.id, 2, 'node.finished', {
        nodeId: 'prep',
        durationMs: 1,
        patch: [{ op: 'replace', path: '/vars/fromParent', value: 'patched' }],
      }),
    );
    const view = renderApp(`/runs/${seeded.id}`, api);
    await waitFor(() =>
      expect(screen.getByLabelText('Variables')).toHaveTextContent('"fromParent": "patched"'),
    );
    view.unmount();

    // A log whose patch cannot apply to its start shows an explanation, not a blank page.
    const broken = api.addRun();
    api.pushEvent(broken.id, event(broken.id, 1, 'run.queued', {}));
    api.pushEvent(
      broken.id,
      event(broken.id, 2, 'node.finished', {
        nodeId: 'prep',
        durationMs: 1,
        patch: [{ op: 'replace', path: '/outputs/start', value: 1 }],
      }),
    );
    renderApp(`/runs/${broken.id}`, api);
    expect(
      await screen.findByText('The thread cannot be reconstructed at event 2'),
    ).toBeInTheDocument();
  });

  it('resumes the stream after the stored cursor on reload', async () => {
    const api = new FakeApi();
    const run = seedRun(api);
    const first = renderApp(`/runs/${run.id}`, api);
    await waitFor(() => expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(6));
    first.unmount();

    // A reload: the persisted log is reused and the stream continues after seq 6.
    api.calls.length = 0;
    renderApp(`/runs/${run.id}`, api);
    await screen.findByText(/Timeline \(6 events/);
    await waitFor(() => expect(api.callsTo('GET', `/runs/${run.id}/events`)).toHaveLength(1));
    // The resumed stream is open with nothing new to send: it reads live, not connecting.
    expect(await screen.findByText(/Timeline \(6 events, live\)/)).toBeInTheDocument();
    expect(api.callsTo('GET', `/runs/${run.id}/events`)[0]!.search.get('after')).toBe('6');
    act(() =>
      api.pushEvent(
        run.id,
        event(run.id, 7, 'run.finished', { status: 'succeeded', outcome: 'success' }),
      ),
    );
    await screen.findByText(/Timeline \(7 events, complete\)/);
    useRunEventStore.getState().clear(run.id);
  });

  it('renders the input form from the wait node schema and submits input', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api, {
      status: 'waiting',
      waiting: {
        nodeId: 'approve',
        kind: 'input',
        prompt: 'Approve the plan?',
        inputSchema: {
          type: 'object',
          properties: { approved: { type: 'boolean' }, note: { type: 'string' } },
        },
      },
    });
    renderApp(`/runs/${run.id}`, api);
    expect(await screen.findByText('Approve the plan?')).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'approved' })).getByRole('radio', {
        name: 'Yes',
      }),
    );
    await user.type(screen.getByLabelText('note'), 'ship it');
    await user.click(screen.getByRole('button', { name: 'Submit input' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/input`)).toHaveLength(1));
    expect(api.callsTo('POST', `/runs/${run.id}/input`)[0]!.body).toEqual({
      input: { approved: true, note: 'ship it' },
    });
    await waitFor(() => expect(screen.queryByText('Approve the plan?')).not.toBeInTheDocument());
  });

  it('sends a signal to a run waiting for one, and describes timer waits', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api, {
      status: 'waiting',
      waiting: { nodeId: 'gate', kind: 'signal', signalName: 'go' },
    });
    const timer = seedRun(api, {
      status: 'waiting',
      waiting: { nodeId: 'nap', kind: 'timer', until: '2026-10-03T00:00:00.000Z' },
    });
    const view = renderApp(`/runs/${run.id}`, api);
    await user.type(await screen.findByLabelText('Input (JSON)'), '{{"ok": true}');
    await user.click(screen.getByRole('button', { name: 'Send signal' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/signals/go`)).toHaveLength(1));
    expect(api.callsTo('POST', `/runs/${run.id}/signals/go`)[0]!.body).toEqual({
      payload: { ok: true },
    });
    view.unmount();
    renderApp(`/runs/${timer.id}`, api);
    expect(await screen.findByText(/Waiting for timer/)).toBeInTheDocument();
  });

  it('cancels, pauses, and resumes runs', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api);
    const paused = seedRun(api, { status: 'paused' });
    const view = renderApp(`/runs/${run.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/pause`)).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/cancel`)).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument(),
    );
    view.unmount();

    api.override(
      'POST /runs/:id/resume',
      () =>
        new Response(JSON.stringify({ status: 409, code: 'INVALID_STATE', detail: 'nope' }), {
          status: 409,
        }),
    );
    renderApp(`/runs/${paused.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByText(/nope/)).toBeInTheDocument();
  });

  it('keeps the keyboard order: loop, parent run, child runs, then the run controls', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const parent = api.addRun({ status: 'running' });
    const child = seedRun(api, { status: 'running', parentRunId: parent.id });
    renderApp(`/runs/${child.id}`, api);
    const loop = await screen.findByRole('link', { name: 'loop' });
    loop.focus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'parent run' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'child runs' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toHaveFocus();
  });

  it('shows failures, results, parent links, and stream errors', async () => {
    const api = new FakeApi();
    const parent = api.addRun({ status: 'succeeded' });
    const run = api.addRun({
      status: 'failed',
      parentRunId: parent.id,
      result: { answer: 42 },
      failure: { code: 'SCRIPT_EXIT_CODE', message: 'exit 3', resumable: true },
    });
    api.threads.delete(run.id);
    api.override(
      'GET /runs/:id/events',
      () =>
        new Response(JSON.stringify({ status: 403, code: 'FORBIDDEN', detail: 'no' }), {
          status: 403,
        }),
    );
    renderApp(`/runs/${run.id}`, api);
    expect(await screen.findByText('Failed: SCRIPT_EXIT_CODE')).toBeInTheDocument();
    expect(screen.getByText(/exit 3 \(resumable\)/)).toBeInTheDocument();
    expect(screen.getByTestId('run-result')).toHaveTextContent('42');
    expect(screen.getByRole('link', { name: 'parent run' })).toHaveAttribute(
      'href',
      `/runs/${parent.id}`,
    );
    expect(await screen.findByText(/stream error/)).toBeInTheDocument();
    expect(screen.getByText('The thread is not available yet.')).toBeInTheDocument();
  });

  it('does not reopen a finished run stream', async () => {
    const api = new FakeApi();
    const run = seedRun(api, { status: 'succeeded' });
    api.pushEvent(
      run.id,
      event(run.id, 7, 'run.finished', { status: 'succeeded', outcome: 'success' }),
    );
    const first = renderApp(`/runs/${run.id}`, api);
    await screen.findByText(/Timeline \(7 events, complete\)/);
    first.unmount();
    api.calls.length = 0;
    renderApp(`/runs/${run.id}`, api);
    await screen.findByText(/Timeline \(7 events, complete\)/);
    expect(api.callsTo('GET', `/runs/${run.id}/events`)).toHaveLength(0);
  });
});
