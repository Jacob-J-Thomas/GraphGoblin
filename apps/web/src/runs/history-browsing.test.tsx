import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useRunEventStore } from './event-store.js';

it('shows an exact oversized event payload even when the event has no thread patch or evaluation panel', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const run = api.addRun({ status: 'running' });
  const payload = 'x'.repeat(600_000);
  api.pushEvent(
    run.id,
    event(run.id, 1, 'run.woken', { nodeId: 'wait', reason: 'manual', payload }),
  );
  const view = renderApp(`/runs/${run.id}`, api);
  const timeline = await screen.findByRole('list', { name: 'Timeline' });
  await user.click(
    await within(timeline).findByRole('button', { name: /run\.woken.*wait woken by manual/ }),
  );
  await screen.findByTestId('event-payload');
  await user.click(screen.getByRole('button', { name: 'Show all of Event payload' }));
  expect(JSON.parse(screen.getByTestId('event-payload').textContent)).toMatchObject({
    seq: 1,
    type: 'run.woken',
    payload,
  });
  const stored = JSON.parse(sessionStorage.getItem('graphgoblin-run-events-v4') ?? '{}') as {
    state: { runs: Record<string, unknown> };
  };
  expect(JSON.stringify(stored.state.runs[run.id]).length).toBeLessThan(10_000);
  view.unmount();
});

it('retains a bounded suffix and reconnects after a typed slow-consumer failure at its delivered cursor', async () => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'running' });
  for (let seq = 1; seq <= 800; seq++)
    api.pushEvent(run.id, event(run.id, seq, 'run.started', { attempt: 1 }));
  let opened = 0;
  api.override('GET /runs/:id/events', (call) => {
    if (call.headers.get('accept') !== 'text/event-stream' || ++opened !== 1)
      return api.builtIn(call);
    const prefix = api.events
      .get(run.id)!
      .slice(0, 600)
      .map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join('');
    return new Response(
      prefix +
        'event: stream.error\ndata: {"status":503,"code":"SSE_SLOW_CONSUMER","detail":"The reader fell behind."}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const view = renderApp(`/runs/${run.id}`, api);
  await waitFor(() => expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(800), {
    timeout: 10_000,
  });
  const requests = api
    .callsTo('GET', `/runs/${run.id}/events`)
    .filter((call) => call.headers.get('accept') === 'text/event-stream');
  expect(requests[1]?.search.get('after')).toBe('600');
  const log = useRunEventStore.getState().runs[run.id]!;
  expect(log.events.map((e) => e.seq)).toEqual(Array.from({ length: 512 }, (_, i) => 289 + i));
  view.unmount();
});

it('browses older history during execution, reloads at the live acknowledgement and selects an evicted sequence with full projections intact', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const loop = api.addLoop(minimalLoop(), { published: true });
  const run = api.addRun({ loopId: loop.id, versionId: loop.currentVersionId!, status: 'running' });
  const seed = api.threads.get(run.id)!;
  seed.vars = { inherited: 'kept' };
  seed.counters.nodeVisits = { inherited: 700 };
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields({ initialThread: seed })));
  api.pushEvent(
    run.id,
    event(run.id, 2, 'decision.made', {
      nodeId: 'gate',
      portId: 'done',
      provenance: {
        kind: 'expression',
        provider: null,
        model: null,
        effort: null,
        classifierId: null,
      },
      diagnostics: [],
      observation: { kind: 'route', routeId: 'done', confidence: null, reasoning: null },
      gate: {
        previousPasses: 9,
        passes: 10,
        maxPasses: 10,
        elapsedSeconds: 0,
        repeatRouteId: 'repeat',
        limit: 'max-passes',
      },
    }),
  );
  api.pushEvent(run.id, event(run.id, 3, 'exit.evaluated', { nodeId: 'done', outcome: 'success' }));
  api.pushEvent(
    run.id,
    event(run.id, 4, 'run.finished', { status: 'succeeded', outcome: 'success', result: null }),
  );
  api.pushEvent(run.id, event(run.id, 5, 'run.started', { attempt: 2 }));
  for (let seq = 6; seq <= 905; seq++)
    api.pushEvent(
      run.id,
      event(run.id, seq, 'node.progress', {
        nodeId: 'work',
        progress: { item: { id: String(seq), type: 'reasoning', summary: 'working' } },
      }),
    );
  const view = renderApp(`/runs/${run.id}`, api);
  const log = () => useRunEventStore.getState().runs[run.id]!;
  await waitFor(() => expect(log()?.lastSeq).toBe(905));
  const timeline = screen.getByRole('list', { name: 'Timeline' });
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(80);
  expect(log().events).toHaveLength(512);
  expect(await screen.findByText(/Exited: success$/)).toBeInTheDocument();
  expect(screen.getByText(/Last gate decision/)).toHaveTextContent('on pass 9 of 10');
  expect(screen.getByTestId('run-result')).toHaveTextContent('null');
  await user.click(screen.getByRole('button', { name: 'Full thread JSON' }));
  expect(
    JSON.parse((await screen.findByTestId('thread-json')).textContent).counters.nodeVisits,
  ).toEqual({ inherited: 700 });
  await user.click(screen.getByRole('button', { name: 'Load older' }));
  await waitFor(() => expect(log().events[0]?.seq).toBe(266));
  await user.click(screen.getByRole('button', { name: 'Load older' }));
  await waitFor(() => expect(log().events[0]?.seq).toBe(138));
  expect(
    api.callsTo('GET', `/runs/${run.id}/events`).some((call) => call.search.has('cursor')),
  ).toBe(true);
  const window = log().events;
  act(() => api.pushEvent(run.id, event(run.id, 906, 'run.started', { attempt: 3 })));
  await waitFor(() => expect(log().lastSeq).toBe(906));
  expect(log().events).toBe(window);
  const stored = sessionStorage.getItem('graphgoblin-run-events-v4')!;
  view.unmount();
  useRunEventStore.setState({ runs: {} });
  sessionStorage.setItem('graphgoblin-run-events-v4', stored);
  await useRunEventStore.persist.rehydrate();
  const reloaded = renderApp(`/runs/${run.id}`, api);
  await waitFor(() =>
    expect(
      api
        .callsTo('GET', `/runs/${run.id}/events`)
        .some((call) => call.search.get('after') === '906'),
    ).toBe(true),
  );
  expect(log().mode).toBe('history');
  expect(log().events[0]?.seq).toBe(138);
  await user.type(screen.getByRole('spinbutton', { name: 'Event sequence' }), '1');
  await user.click(screen.getByRole('button', { name: 'Go to event' }));
  await screen.findByText('Thread at event 1');
  expect(screen.getByLabelText('Variables')).toHaveTextContent('inherited');
  expect(log().lastSeq).toBe(906);
  await user.click(screen.getByRole('button', { name: 'Follow live' }));
  await waitFor(() => expect(log().mode).toBe('live'));
  expect(log().events.at(-1)?.seq).toBe(906);
  reloaded.unmount();
});
