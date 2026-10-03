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
    await user.click(screen.getByLabelText('approved'));
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
