import type { JsonPatch, RunEvent } from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { applyPatch } from '@graphgoblin/domain';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { ThreadViewer } from './inspector/ThreadViewer.js';
import { MAX_HISTORY_EVENTS, useRunEventStore } from './event-store.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function start(api: FakeApi) {
  const run = api.addRun({ status: 'running', lastEventSeq: 2 });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  return run;
}

it('independent S1/S2/S10: streamed outcome owns header with BOTH read models blocked and equal-sequence stale row released', async () => {
  const api = new FakeApi();
  const run = start(api);
  const runGate = gate();
  const observationGate = gate();
  let runReads = 0;
  let heldRun = 0;
  let heldObservation = 0;
  let observationReturns = 0;
  api.override('GET /runs/:id', async (call) => {
    runReads++;
    if (runReads === 1) return api.builtIn(call);
    heldRun++;
    await runGate.promise;
    return json({ ...run, status: 'running', lastEventSeq: 3, currentNodeId: 'obsolete-node' });
  });
  api.override('GET /runs/:id/observation', async (call) => {
    heldObservation++;
    await observationGate.promise;
    observationReturns++;
    return api.builtIn(call);
  });
  const view = renderApp(`/runs/${run.id}`, api);
  try {
    const heading = await screen.findByRole('heading', { name: `Run ${run.id}` });
    const header = heading.closest('header')!;
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run\.started/ });
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    act(() =>
      api.pushEvent(
        run.id,
        event(run.id, 3, 'run.finished', {
          status: 'succeeded',
          outcome: 'success',
          result: 'not-a-finalized-server-result',
        }),
      ),
    );
    await within(timeline).findByRole('button', { name: /run\.finished.*succeeded/ });
    await waitFor(() => expect(heldRun).toBeGreaterThan(0));
    expect(heldObservation).toBeGreaterThan(0);
    expect(observationReturns).toBe(0);
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded');
    expect(within(header).getByRole('button', { name: /^Pause$/ })).toBeEnabled();
    expect(screen.queryByTestId('run-result')).toBeNull();
    runGate.release();
    await waitFor(() =>
      expect(
        view.queryClient.getQueryData<{ currentNodeId?: string }>(keys.run(run.id))?.currentNodeId,
      ).toBe('obsolete-node'),
    );
    expect(observationReturns).toBe(0);
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded');
    expect(within(header).queryByText(/^at /)).toBeNull();
  } finally {
    runGate.release();
    observationGate.release();
    view.unmount();
  }
});

it('independent S8: late prior-attempt observation cannot revive failure after resumed start', async () => {
  const api = new FakeApi();
  const run = start(api);
  const observationGate = gate();
  const oldFailure = event(run.id, 3, 'run.failed', {
    failure: { code: 'INTERNAL_ERROR', message: 'old failure', resumable: true },
  });
  let returned = 0;
  api.override('GET /runs/:id/observation', async (call) => {
    const original = (await (await api.builtIn(call)).json()) as Record<string, unknown>;
    await observationGate.promise;
    returned++;
    return json({ ...original, lifecycle: oldFailure });
  });
  const view = renderApp(`/runs/${run.id}`, api);
  try {
    const header = (await screen.findByRole('heading', { name: `Run ${run.id}` })).closest(
      'header',
    )!;
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run\.started/ });
    api.runs.set(run.id, { ...run, status: 'running', lastEventSeq: 5 });
    act(() => {
      api.pushEvent(run.id, oldFailure);
      api.pushEvent(run.id, event(run.id, 4, 'run.resumed', { actor: { kind: 'user', id: 'qa' } }));
      api.pushEvent(run.id, event(run.id, 5, 'run.started', { attempt: 2 }));
    });
    await within(timeline).findByText('#5');
    // The earlier refresh is still waiting on this test's observation gate. Its run snapshot
    // can therefore remain pre-resume; the contract permits Updating until a fresh row arrives.
    expect(header.querySelector('[data-status="failed"]')).toBeNull();
    await act(async () => {
      observationGate.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => expect(returned).toBeGreaterThan(0));
    await waitFor(() =>
      expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'running'),
    );
    expect(header.querySelector('[data-status="failed"]')).toBeNull();
  } finally {
    observationGate.release();
    view.unmount();
  }
});

it('independent P3/P4: rendered patch keeps literal dash, escaped append, numeric add and non-add boundary semantics', () => {
  const before = sampleThread();
  before.vars = {
    'a/b~c': [1],
    object: { '-': 'old' },
    list: ['first'],
    replaced: 'before',
    removed: 'gone',
    source: { unicode: 'β' },
    moveSource: 'm',
  };
  const patch: JsonPatch = [
    { op: 'add', path: '/vars/a~1b~0c/-', value: null },
    { op: 'add', path: '/vars/object/-', value: 'new' },
    { op: 'add', path: '/vars/list/0', value: 'inserted' },
    { op: 'replace', path: '/vars/replaced', value: 'after' },
    { op: 'remove', path: '/vars/removed' },
    { op: 'copy', from: '/vars/source', path: '/vars/copied' },
    { op: 'move', from: '/vars/moveSource', path: '/vars/moved' },
  ];
  const after = applyPatch(before, patch);
  const finished: RunEvent = event(before.run.id, 3, 'node.finished', {
    nodeId: 'qa',
    durationMs: 1,
    patch,
  });
  render(<ThreadViewer current={after} before={before} events={[finished]} seq={3} />);
  const rows = within(screen.getByRole('list', { name: 'Patch diff' })).getAllByRole('listitem');
  const expected = [
    ['(absent)', 'null'],
    ['"old"', '"new"'],
    ['"first"', '"inserted"'],
    ['"before"', '"after"'],
    ['"gone"', '(absent)'],
    ['(absent)', '{ "unicode": "β" }'],
    ['(absent)', '"m"'],
  ];
  expect(rows).toHaveLength(expected.length);
  rows.forEach((row, index) => {
    const path = patch[index]!.path;
    expect(within(row).getByLabelText(`Value before ${path}`)).toHaveTextContent(
      expected[index]![0]!,
    );
    expect(within(row).getByLabelText(`Value after ${path}`)).toHaveTextContent(
      expected[index]![1]!,
    );
  });
  expect(rows[5]).toHaveTextContent('from /vars/source');
  expect(rows[6]).toHaveTextContent('from /vars/moveSource');
});

it('independent S6: header retains the streamed outcome after its payload is evicted by event count', async () => {
  const api = new FakeApi();
  const run = start(api);
  const runGate = gate();
  let reads = 0;
  api.override('GET /runs/:id', async (call) => {
    if (++reads > 1) await runGate.promise;
    return api.builtIn(call);
  });
  api.override('GET /runs/:id/observation', async (call) => {
    const body = (await (await api.builtIn(call)).json()) as Record<string, unknown>;
    return json({ ...body, lifecycle: event(run.id, 2, 'run.started', { attempt: 1 }) });
  });
  const view = renderApp(`/runs/${run.id}`, api);
  try {
    const header = (await screen.findByRole('heading', { name: `Run ${run.id}` })).closest(
      'header',
    )!;
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run\.started/ });
    // Append one batch: after an awaited terminal render the fake stream has completed,
    // and later events would need the metadata follower whose run read this fixture holds.
    act(() => {
      api.pushEvent(
        run.id,
        event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
      );
      for (let seq = 4; seq <= MAX_HISTORY_EVENTS + 12; seq++) {
        api.pushEvent(run.id, event(run.id, seq, 'return.delivered', { channel: { kind: 'log' } }));
      }
    });
    await waitFor(() =>
      expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(MAX_HISTORY_EVENTS + 12),
    );
    expect(useRunEventStore.getState().runs[run.id]?.events.length).toBeLessThanOrEqual(
      MAX_HISTORY_EVENTS,
    );
    expect(useRunEventStore.getState().runs[run.id]?.events.some((item) => item.seq === 3)).toBe(
      false,
    );
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  } finally {
    runGate.release();
    view.unmount();
  }
});

it('independent S8: a late older terminal run response never flashes failure after a newer resumed start', async () => {
  const api = new FakeApi();
  const run = start(api);
  const rowGate = gate();
  let reads = 0;
  let held = 0;
  let returned = 0;
  api.override('GET /runs/:id', async (call) => {
    if (++reads !== 2) return api.builtIn(call);
    held++;
    await rowGate.promise;
    returned++;
    return json({
      ...run,
      status: 'failed',
      lastEventSeq: 3,
      failure: { code: 'INTERNAL_ERROR', message: 'older attempt', resumable: true },
    });
  });
  const view = renderApp(`/runs/${run.id}`, api);
  try {
    const header = (await screen.findByRole('heading', { name: `Run ${run.id}` })).closest(
      'header',
    )!;
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run\.started/ });
    await waitFor(() => expect(held).toBe(1));
    api.runs.set(run.id, { ...run, status: 'running', lastEventSeq: 5 });
    act(() => {
      api.pushEvent(
        run.id,
        event(run.id, 3, 'run.failed', {
          failure: { code: 'INTERNAL_ERROR', message: 'older attempt', resumable: true },
        }),
      );
      api.pushEvent(run.id, event(run.id, 4, 'run.resumed', { actor: { kind: 'user', id: 'qa' } }));
      api.pushEvent(run.id, event(run.id, 5, 'run.started', { attempt: 2 }));
    });
    await within(timeline).findByText('#5');
    let flashedFailure = false;
    const observer = new MutationObserver(() => {
      if (header.querySelector('[data-status="failed"]')) flashedFailure = true;
    });
    observer.observe(header, { subtree: true, childList: true, attributes: true });
    try {
      rowGate.release();
      await waitFor(() => expect(returned).toBe(1));
      await waitFor(() =>
        expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'running'),
      );
      expect(flashedFailure).toBe(false);
    } finally {
      observer.disconnect();
    }
  } finally {
    rowGate.release();
    view.unmount();
  }
});

it('independent S9: A to B to A scopes late events and resets the header to the current run', async () => {
  const api = new FakeApi();
  const a = start(api);
  const b = start(api);
  api.runs.set(a.id, { ...a, parentRunId: b.id });
  api.runs.set(b.id, { ...b, parentRunId: a.id });
  const view = renderApp(`/runs/${a.id}`, api);
  const user = userEvent.setup();
  try {
    const headerA = (await screen.findByRole('heading', { name: `Run ${a.id}` })).closest(
      'header',
    )!;
    await screen.findByRole('list', { name: 'Timeline' });
    act(() =>
      api.pushEvent(
        a.id,
        event(a.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
      ),
    );
    await waitFor(() =>
      expect(headerA.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded'),
    );
    await user.click(within(headerA).getByRole('link', { name: 'parent run' }));
    const headerB = (await screen.findByRole('heading', { name: `Run ${b.id}` })).closest(
      'header',
    )!;
    expect(headerB.querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    api.runs.set(a.id, { ...a, status: 'failed', lastEventSeq: 4, parentRunId: b.id });
    act(() =>
      api.pushEvent(
        a.id,
        event(a.id, 4, 'run.failed', {
          failure: { code: 'INTERNAL_ERROR', message: 'A failed elsewhere', resumable: true },
        }),
      ),
    );
    expect(headerB.querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    await user.click(within(headerB).getByRole('link', { name: 'parent run' }));
    const returned = (await screen.findByRole('heading', { name: `Run ${a.id}` })).closest(
      'header',
    )!;
    await waitFor(() =>
      expect(returned.querySelector('[data-status]')).toHaveAttribute('data-status', 'failed'),
    );
  } finally {
    view.unmount();
  }
});

it('independent S4/S5: cancel request is not cancellation; later failed delivery is not execution failure', async () => {
  const api = new FakeApi();
  const run = start(api);
  const rowGate = gate();
  let reads = 0;
  let staleReturns = 0;
  let permitFreshObservation = false;
  api.override('GET /runs/:id', async (call) => {
    if (++reads === 1) return api.builtIn(call);
    await rowGate.promise;
    staleReturns++;
    return json({ ...run, status: 'running', lastEventSeq: 9 });
  });
  api.override('GET /runs/:id/observation', async (call) => {
    const body = (await (await api.builtIn(call)).json()) as Record<string, unknown>;
    return json({
      ...body,
      lifecycle: permitFreshObservation
        ? body.lifecycle
        : event(run.id, 2, 'run.started', { attempt: 1 }),
    });
  });
  const view = renderApp(`/runs/${run.id}`, api);
  try {
    const header = (await screen.findByRole('heading', { name: `Run ${run.id}` })).closest(
      'header',
    )!;
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    await within(timeline).findByRole('button', { name: /run\.started/ });
    act(() => {
      api.pushEvent(
        run.id,
        event(run.id, 3, 'node.started', {
          nodeId: 'work',
          kind: 'mutate',
          attempt: 1,
          configHash: 'qa',
        }),
      );
      api.pushEvent(
        run.id,
        event(run.id, 4, 'node.progress', {
          nodeId: 'work',
          progress: { item: { id: 'qa', type: 'reasoning', summary: 'still working' } },
        }),
      );
      api.pushEvent(
        run.id,
        event(run.id, 5, 'node.finished', { nodeId: 'work', durationMs: 1, patch: [] }),
      );
      api.pushEvent(
        run.id,
        event(run.id, 6, 'run.cancel_requested', { actor: { kind: 'user', id: 'qa' } }),
      );
    });
    await within(timeline).findByRole('button', { name: /run\.cancel_requested/ });
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    act(() => {
      api.pushEvent(
        run.id,
        event(run.id, 7, 'run.finished', { status: 'succeeded', outcome: 'success' }),
      );
      api.pushEvent(
        run.id,
        event(run.id, 8, 'return.failed', {
          channel: { kind: 'log' },
          error: 'qa delivery failure',
        }),
      );
      api.pushEvent(run.id, event(run.id, 9, 'return.delivered', { channel: { kind: 'log' } }));
    });
    await within(timeline).findByRole('button', { name: /return\.failed/ });
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded');
    // Let the independent attempt follower receive the true terminal lifecycle once released.
    // A permanently false active observation makes the zero-latency fake reopen a completed
    // stream forever; that is unrelated to the header assertions already established above.
    permitFreshObservation = true;
    rowGate.release();
    await waitFor(() => expect(staleReturns).toBeGreaterThan(0));
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  } finally {
    rowGate.release();
    view.unmount();
  }
});
