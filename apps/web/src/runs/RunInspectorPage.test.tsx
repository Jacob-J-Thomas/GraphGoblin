import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type JsonValue, type RunEvent } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useRunEventStore } from './event-store.js';

function seedRun(api: FakeApi, overrides: Parameters<FakeApi['addRun']>[0] = {}) {
  const run = api.addRun(overrides);
  const r = run.id;
  api.pushEvent(r, event(r, 1, 'run.queued', queuedFields()));
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
    event(r, 5, 'node.progress', {
      nodeId: 'infer',
      progress: { item: { id: 'reasoning-1', type: 'reasoning', summary: 'thinking' } },
    }),
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
  it('loads the pinned definition for fallback gate counts before any decision event', async () => {
    const api = new FakeApi();
    const base = minimalLoop();
    const loop = api.addLoop(
      {
        ...base,
        nodes: [
          ...base.nodes,
          {
            id: 'gate',
            kind: 'decision',
            label: 'Gate',
            config: {
              kind: 'expression',
              jsonata: '"repeat"',
              routes: [
                { id: 'repeat', label: 'Repeat', repeat: true },
                { id: 'done', label: 'Done' },
              ],
              maxPasses: 3,
            },
          },
        ],
      },
      { published: true },
    );
    const run = api.addRun({
      loopId: loop.id,
      versionId: loop.currentVersionId!,
      status: 'succeeded',
    });
    const thread = api.threads.get(run.id)!;
    api.threads.set(run.id, { ...thread, gates: { gate: { passes: 3 } } });
    api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
    api.pushEvent(
      run.id,
      event(run.id, 2, 'node.started', {
        nodeId: 'gate',
        kind: 'decision',
        attempt: 1,
        configHash: 'h',
      }),
    );
    renderApp(`/runs/${run.id}`, api);
    await userEvent.setup().click(await screen.findByText('Full thread JSON'));
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('thread-json').textContent).gates).toEqual({
        gate: { passes: 1 },
      }),
    );
    expect(api.callsTo('GET', `/loops/${loop.id}/versions/${loop.currentVersionId}`)).toHaveLength(
      1,
    );
  });

  it('shows loading acceptance until the run’s pinned version resolves with its authored Noul threshold', async () => {
    const api = new FakeApi();
    const definition = (truthThreshold: number) =>
      LoopDefinitionSchema.parse({
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: 'Pinned threshold',
        nodes: [
          {
            id: 'check',
            kind: 'decision',
            label: 'Check',
            config: {
              kind: 'classifier',
              model: 'jev',
              question: 'Check the evidence.',
              truthThreshold,
              answer: {
                type: 'noul',
                true: { id: 'true', label: 'True', criteria: 'The check passes' },
                false: { id: 'false', label: 'False', criteria: 'The check fails' },
              },
            },
          },
        ],
        edges: [],
      });
    const loop = api.addLoop(definition(0.2), { published: true });
    const pinned = api.loops.get(loop.id)?.current;
    if (!pinned) throw new Error('Expected the initial published version.');
    api.publishVersion(loop.id, definition(0.9));
    const run = api.addRun({ loopId: loop.id, versionId: pinned.id, status: 'succeeded' });
    api.pushEvent(
      run.id,
      event(run.id, 1, 'decision.made', {
        nodeId: 'check',
        portId: 'true',
        provenance: {
          kind: 'classifier',
          provider: 'typesafe',
          classifierId: 'jev',
          model: 'jev-latest',
          effort: null,
        },
        diagnostics: [],
        observation: {
          kind: 'classifier',
          answer: {
            type: 'noul',
            holds: true,
            trueProbability: 0.6,
            confidence: 0.91,
          },
        },
      }),
    );
    let releaseVersion!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseVersion = resolve;
    });
    api.override('GET /loops/:id/versions/:versionId', async (call) => {
      await pending;
      return api.builtIn(call);
    });
    renderApp(`/runs/${run.id}`, api);

    const row = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling;
    expect(await screen.findByText('Confidence acceptance')).toBeInTheDocument();
    expect(row('Confidence acceptance')).toHaveTextContent('Loading run-version configuration…');
    expect(row('Label')).toHaveTextContent('Loading run-version configuration…');
    expect(
      screen.queryByText('Not recorded (classifier configuration unavailable)'),
    ).not.toBeInTheDocument();
    releaseVersion();

    expect(await screen.findByText('True-probability threshold')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('True-probability threshold').parentElement).toHaveTextContent('20%'),
    );
    // The chosen side's label and criterion, as the run version authored them.
    expect(row('Label')).toHaveTextContent('True');
    expect(row('Criterion')).toHaveTextContent('The check passes');
    expect(screen.getByText('Confidence acceptance').parentElement).toHaveTextContent(
      'No minimum configured in run version',
    );
    expect(
      api.calls.some(
        (call) => call.method === 'GET' && call.path === `/loops/${loop.id}/versions/${pinned.id}`,
      ),
    ).toBe(true);
  });

  it('shows Claude requested effort and states that effective effort is not reported', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api, { status: 'running' });
    api.pushEvent(
      run.id,
      event(run.id, 7, 'harness.session', {
        nodeId: 'infer',
        harness: 'claude',
        sessionId: 'native-session',
        mode: 'fresh',
        model: 'claude-opus-5-5',
        effort: 'xhigh',
      }),
    );
    renderApp(`/runs/${run.id}`, api);

    await user.click(await screen.findByText(/Node progress/));
    expect(
      await screen.findByText(
        'claude session fresh; model claude-opus-5-5; requested effort xhigh; effective effort not reported',
      ),
    ).toBeInTheDocument();
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
    // The thread at a newly selected event is reconstructed in the deferred render (#259).
    await user.click(within(timeline).getByText(/#3/));
    expect(await screen.findByLabelText('Variables')).toHaveTextContent('{}');
    expect(screen.getByText('Thread at event 3')).toBeInTheDocument();

    await user.click(within(timeline).getByText(/#4/));
    const diff = await screen.findByRole('list', { name: 'Patch diff' });
    expect(within(diff).getByText('/vars/topic')).toBeInTheDocument();
    expect(within(diff).getAllByText(/\(absent\)/).length).toBeGreaterThan(0);
    // The full thread JSON is built only once its disclosure opens (#259).
    expect(screen.queryByTestId('thread-json')).not.toBeInTheDocument();
    await user.click(screen.getByText('Full thread JSON'));
    expect(await screen.findByTestId('thread-json')).toHaveTextContent('"prep": 1');

    // A live event arrives.
    act(() =>
      api.pushEvent(
        run.id,
        event(run.id, 7, 'decision.made', {
          nodeId: 'decide',
          portId: 'good',
          provenance: {
            kind: 'expression',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          diagnostics: [],
          observation: {
            kind: 'route',
            routeId: 'good',
            confidence: null,
            reasoning: null,
          },
        }),
      ),
    );
    await waitFor(() => expect(within(timeline).getAllByRole('button')).toHaveLength(7));

    // Progress drawer groups node activity.
    await user.click(screen.getByText(/Node progress/));
    expect(screen.getByText(/thinking/)).toBeInTheDocument();
    expect(screen.getAllByText(/outputTokens/).length).toBeGreaterThan(0);
  });

  it('shows a failed command in progress while the run is still running', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api, { status: 'running' });
    api.pushEvent(
      run.id,
      event(run.id, 7, 'node.progress', {
        nodeId: 'infer',
        progress: {
          item: {
            id: 'command-1',
            type: 'command',
            summary: 'npm test (exit -1)',
            commandPreview: 'npm test',
            exitCode: -1,
            status: 'failed',
          },
        },
      }),
    );
    renderApp(`/runs/${run.id}`, api);

    await user.click(await screen.findByText(/Node progress/));
    expect(await screen.findByText('Command failed: npm test (exit -1)')).toBeInTheDocument();
  });

  it('shows a failed tool call without its provider diagnostics', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api, { status: 'running' });
    api.pushEvent(
      run.id,
      event(run.id, 7, 'node.progress', {
        nodeId: 'infer',
        progress: {
          item: {
            id: 'tool-1',
            type: 'tool-call',
            summary: 'browser.search failed: private provider detail',
            status: 'failed',
          },
        },
      }),
    );
    renderApp(`/runs/${run.id}`, api);

    await user.click(await screen.findByText(/Node progress/));
    expect(await screen.findByText('Tool call failed: browser.search')).toBeInTheDocument();
    expect(screen.queryByText(/private provider detail/)).not.toBeInTheDocument();
  });

  it('replays a child run from its seeded first event and reports logs that do not replay', async () => {
    const api = new FakeApi();
    const seeded = api.addRun({ parentRunId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ' });
    const seed = { ...api.threads.get(seeded.id)!, vars: { fromParent: 'yes' } };
    api.pushEvent(
      seeded.id,
      event(seeded.id, 1, 'run.queued', queuedFields({ initialThread: seed })),
    );
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
    api.pushEvent(broken.id, event(broken.id, 1, 'run.queued', queuedFields()));
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
        waitId: 'fixture-wait',
        startedSeq: 1,
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
      waitId: run.waiting!.waitId,
      input: { approved: true, note: 'ship it' },
    });
    await waitFor(() => expect(screen.queryByText('Approve the plan?')).not.toBeInTheDocument());
  });

  it('sends a signal to a run waiting for one, and describes timer waits', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const run = seedRun(api, {
      status: 'waiting',
      waiting: {
        waitId: 'fixture-wait',
        startedSeq: 1,
        nodeId: 'gate',
        kind: 'signal',
        signalName: 'go',
      },
    });
    const timer = seedRun(api, {
      status: 'waiting',
      waiting: {
        waitId: 'fixture-wait',
        startedSeq: 1,
        nodeId: 'nap',
        kind: 'timer',
        until: '2026-10-03T00:00:00.000Z',
      },
    });
    const view = renderApp(`/runs/${run.id}`, api);
    await user.type(await screen.findByLabelText('Input (JSON)'), '{{"ok": true}');
    await user.click(screen.getByRole('button', { name: 'Send signal' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/signals/go`)).toHaveLength(1));
    expect(api.callsTo('POST', `/runs/${run.id}/signals/go`)[0]!.body).toEqual({
      waitId: run.waiting!.waitId,
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

  it('explains a deleted child while preserving the parent inspector history', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const parent = seedRun(api, { status: 'succeeded' });
    const child = api.addRun({ status: 'succeeded', parentRunId: parent.id });
    api.runs.delete(child.id);
    api.pushEvent(
      parent.id,
      event(parent.id, 7, 'child_run.started', { nodeId: 'sub', childRunId: child.id }),
    );
    api.pushEvent(
      parent.id,
      event(parent.id, 8, 'run.finished', { status: 'succeeded', outcome: 'success' }),
    );
    renderApp(`/runs/${parent.id}`, api);
    await user.click(await screen.findByRole('button', { name: /child_run.started/ }));
    expect(await screen.findByText(/Child run .* is no longer available/)).toHaveTextContent(
      "This parent run's history is preserved.",
    );
    expect(screen.getByRole('list', { name: 'Timeline' }).children).toHaveLength(8);
    expect(screen.queryByRole('link', { name: child.id })).not.toBeInTheDocument();
  });

  it('links an available child from a child-finished event', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const parent = seedRun(api, { status: 'succeeded' });
    const child = api.addRun({ status: 'succeeded', parentRunId: parent.id });
    api.pushEvent(
      parent.id,
      event(parent.id, 7, 'child_run.finished', {
        nodeId: 'sub',
        childRunId: child.id,
        status: 'succeeded',
      }),
    );
    renderApp(`/runs/${parent.id}`, api);
    expect(await screen.findByRole('link', { name: child.id })).toHaveAttribute(
      'href',
      `/runs/${child.id}`,
    );
    await user.click(screen.getByRole('button', { name: /child_run.finished/ }));
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
    expect(screen.queryByRole('link', { name: 'failed child run' })).toBeNull();
  });

  it('links a subloop failure to the child run that failed (#251)', async () => {
    const api = new FakeApi();
    const child = api.addRun({
      status: 'failed',
      failure: { code: 'SCRIPT_EXIT_CODE', message: 'exit 3', resumable: true, nodeId: 'work' },
    });
    const run = api.addRun({
      status: 'failed',
      failure: {
        code: 'SCRIPT_EXIT_CODE',
        message: `subloop child ${child.id} failed: exit 3`,
        resumable: true,
        nodeId: 'sub',
        details: { childRunId: child.id, childNodeId: 'work' },
      },
    });
    renderApp(`/runs/${run.id}`, api);
    expect(await screen.findByText('Failed: SCRIPT_EXIT_CODE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'failed child run' })).toHaveAttribute(
      'href',
      `/runs/${child.id}`,
    );
  });

  it.each(['succeeded', 'exhausted'] as const)(
    'does not reopen a finished %s stream and retains the result',
    async (status) => {
      const api = new FakeApi();
      const run = seedRun(api, { status, result: { work: 'kept' } });
      api.pushEvent(
        run.id,
        event(run.id, 7, 'run.finished', {
          status,
          outcome: status === 'exhausted' ? 'exhausted' : 'success',
        }),
      );
      const first = renderApp(`/runs/${run.id}`, api);
      await screen.findByText(/Timeline \(7 events, complete\)/);
      expect(screen.getByTestId('run-result')).toHaveTextContent('kept');
      first.unmount();
      api.calls.length = 0;
      renderApp(`/runs/${run.id}`, api);
      await screen.findByText(/Timeline \(7 events, complete\)/);
      expect(api.callsTo('GET', `/runs/${run.id}/events`)).toHaveLength(0);
    },
  );

  it('bounds large values, builds the full thread JSON only when opened, and keeps exact access (#259)', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const long = 'z'.repeat(30_000);
    const run = seedRun(api, { result: { text: long } });
    api.pushEvent(
      run.id,
      event(run.id, 7, 'node.started', {
        nodeId: 'grow',
        kind: 'mutate',
        attempt: 1,
        configHash: 'h',
      }),
    );
    api.pushEvent(
      run.id,
      event(run.id, 8, 'node.finished', {
        nodeId: 'grow',
        durationMs: 2,
        patch: [{ op: 'add', path: '/vars/blob', value: long }],
      }),
    );
    renderApp(`/runs/${run.id}`, api);
    await screen.findByText(/Timeline \(8 events, live\)/);

    // The result and the variables show their first characters; the whole text is one click away.
    await waitFor(() => expect(screen.getByTestId('run-result').textContent?.length).toBe(4_097));
    expect(screen.getByRole('button', { name: 'Show all of Result' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Result as JSON' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Variables').textContent?.length).toBe(4_097));
    // Both the result and the variables carry the notice (each holds the 30,000-character value).
    expect(
      screen.getAllByText('Showing the first 4,096 characters of a larger value.'),
    ).toHaveLength(2);

    // The patch diff bounds each side at the cell bound.
    const diff = screen.getByRole('list', { name: 'Patch diff' });
    expect(within(diff).getByLabelText('Value before /vars/blob')).toHaveTextContent('(absent)');
    expect(within(diff).getByLabelText('Value after /vars/blob').textContent?.length).toBe(1_025);

    // The full thread JSON is not laid out until its disclosure opens.
    expect(screen.queryByTestId('thread-json')).not.toBeInTheDocument();
    await user.click(screen.getByText('Full thread JSON'));
    await waitFor(() => expect(screen.getByTestId('thread-json').textContent?.length).toBe(4_097));
    await user.click(screen.getByRole('button', { name: 'Show all of Full thread JSON' }));
    expect(JSON.parse(screen.getByTestId('thread-json').textContent).vars.blob).toBe(long);
  });
});

/** What a finished exit returned, and the last gate's passes, at the top of the run (#129). */
describe('RunInspectorPage exit evidence', () => {
  function exitRun(
    api: FakeApi,
    exit: Record<string, unknown>,
    options: { result?: JsonValue; decisions?: (runId: string) => RunEvent[] } = {},
  ) {
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
      ...(options.result !== undefined && options.result !== null
        ? { result: options.result }
        : {}),
    });
    const events = [
      event(run.id, 1, 'run.queued', queuedFields()),
      ...(options.decisions?.(run.id) ?? []),
    ];
    const next = events.length + 1;
    events.push(
      event(run.id, next, 'exit.evaluated', { nodeId: 'done', outcome: 'success' }),
      event(run.id, next + 1, 'run.finished', {
        status: 'succeeded',
        outcome: 'success',
        ...(options.result === undefined ? {} : { result: options.result }),
      }),
    );
    for (const item of events) api.pushEvent(run.id, item);
    return run;
  }

  it('says a quiet exit returned nothing by configuration, at the top and in its details', async () => {
    const api = new FakeApi();
    const run = exitRun(api, { returns: 'none', destinations: [] });
    renderApp(`/runs/${run.id}`, api);
    const quiet =
      'Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. This is the exit’s configuration, not a failure.';
    await waitFor(() => expect(screen.getByTestId('exit-returns')).toHaveTextContent(quiet));
    expect(screen.queryByTestId('run-result')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /exit\.evaluated/ }));
    expect(screen.getByText(/Exit outcome:/)).toHaveTextContent(quiet);
    expect(screen.queryByText(/See the run result/)).toBeNull();
  });

  it('names the exit and start-request destinations that a None return left empty', async () => {
    const api = new FakeApi();
    const run = exitRun(api, {
      returns: 'none',
      destinations: [{ kind: 'caller' }, { kind: 'log' }],
    });
    const thread = api.threads.get(run.id)!;
    api.threads.set(run.id, {
      ...thread,
      invocation: {
        ...thread.invocation,
        returnDefaults: [{ kind: 'webhook', url: 'https://example.test/hook' }],
      },
    });
    renderApp(`/runs/${run.id}`, api);
    await waitFor(() =>
      expect(screen.getByTestId('exit-returns')).toHaveTextContent(
        'No value was returned: Returns is None, so no destination received anything (caller, log from the exit; webhook from the start request). This is the exit’s configuration, not a failure.',
      ),
    );
  });

  it('shows a null return as the result rather than as nothing', async () => {
    const api = new FakeApi();
    const run = exitRun(api, { returns: 'vars.missing' }, { result: null });
    renderApp(`/runs/${run.id}`, api);
    await waitFor(() => expect(screen.getByTestId('run-result')).toHaveTextContent('null'));
    expect(screen.queryByTestId('exit-returns')).toBeNull();
  });

  it('does not claim a None configuration when an expression exit recorded no value', async () => {
    // A format-4 run recorded by an older build omitted a null result (CHANGELOG); the pinned exit
    // still has an expression, so the history cannot show a no-value configuration (#129 audit).
    const api = new FakeApi();
    const run = exitRun(api, { returns: 'null', destinations: [{ kind: 'caller' }] });
    renderApp(`/runs/${run.id}`, api);
    const ambiguous =
      'No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.';
    await waitFor(() => expect(screen.getByTestId('exit-returns')).toHaveTextContent(ambiguous));
    expect(screen.queryByTestId('run-result')).toBeNull();
    expect(screen.queryByText(/Returns is None/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /exit\.evaluated/ }));
    expect(screen.getByText(/Exit outcome:/)).toHaveTextContent(ambiguous);
  });

  it('keeps the last gate pass and stopping limit beside the exit outcome', async () => {
    const api = new FakeApi();
    const run = exitRun(
      api,
      { outcome: 'exhausted', returns: '"work"' },
      {
        result: 'work',
        decisions: (runId) =>
          [1, 2, 3].map((pass) =>
            event(runId, pass + 1, 'decision.made', {
              nodeId: 'gate',
              portId: pass === 3 ? 'limit-reached' : 'again',
              diagnostics: [],
              provenance: {
                kind: 'expression',
                provider: null,
                classifierId: null,
                model: null,
                effort: null,
              },
              observation: { kind: 'route', routeId: 'again', confidence: null, reasoning: null },
              gate: {
                previousPasses: pass,
                passes: pass === 3 ? 3 : pass + 1,
                repeatRouteId: 'again',
                maxPasses: 3,
                elapsedSeconds: 1,
                limit: pass === 3 ? 'max-passes' : null,
              },
            }),
          ),
      },
    );
    renderApp(`/runs/${run.id}`, api);
    expect(
      await screen.findByText(
        'Last gate decision: gate chose again on pass 3 of 3; maximum passes stopped the repeat, so it took Limit reached.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('run-result')).toHaveTextContent('work');
    expect(screen.queryByTestId('exit-returns')).toBeNull();
  });
});

it('shows cancellation instead of a stale provider failure on a cancelled run (#255)', async () => {
  const api = new FakeApi();
  const run = api.addRun({
    status: 'cancelled',
    failure: {
      code: 'HARNESS_TRANSPORT_FAILED',
      message: 'Earlier provider failure',
      resumable: false,
    },
  });
  api.pushEvent(run.id, event(run.id, 1, 'run.cancelled', {}));
  renderApp('/runs/' + run.id, api);
  expect(await screen.findByText(/Cancelled; actor not recorded/)).toBeInTheDocument();
  expect(screen.queryByText('Earlier provider failure')).not.toBeInTheDocument();
});
