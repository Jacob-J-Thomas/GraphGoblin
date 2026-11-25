import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../../../inspector-repair/apps/web/src/__fixtures__/fake-api';
import { renderApp } from '../../../inspector-repair/apps/web/src/__fixtures__/render';
import { keys } from '../../../inspector-repair/apps/web/src/api/queries';

it('treats a refused reconnection after a recovered and gracefully closed stream as a second loss', async () => {
  const api = new FakeApi();
  const waiting = {
    waitId: 'wait-1', nodeId: 'ask', kind: 'input' as const, prompt: 'Why?',
    inputSchema: { type: 'object', properties: { note: { type: 'string' } } }, startedSeq: 3,
  };
  const run = api.addRun({ status: 'waiting', lastEventSeq: 3, currentNodeId: 'ask', waiting });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  api.pushEvent(run.id, event(run.id, 3, 'run.waiting', { nodeId: 'ask', wait: waiting }));
  const chronology: string[] = [];
  let outage = 0;
  let refused = 0;
  let opens = 0;
  api.override('GET /runs/:id/events', (call) => {
    if (call.headers.get('accept') === 'text/event-stream') {
      if (outage) {
        refused++;
        chronology.push('refused during outage ' + outage);
        throw new TypeError('Failed to fetch');
      }
      opens++;
      chronology.push('SSE response ' + opens);
    }
    return api.builtIn(call);
  });
  let barrier: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let held = 0;
  const hold = () => { barrier = new Promise<void>((r) => { release = r; }); };
  const proceed = () => { barrier = undefined; release?.(); };
  api.override('GET /runs/:id', async (call) => {
    if (outage === 2) {
      chronology.push('post-second-loss run GET refused');
      throw new TypeError('Failed to fetch');
    }
    const response = await api.builtIn(call);
    if (barrier) {
      held++;
      chronology.push('held successful GET ' + held);
      await barrier;
    }
    return response;
  });
  const view = renderApp('/runs/' + run.id, api);
  const stale = () => screen.queryByText('Last observed, may be out of date') !== null;
  const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Submit input' });
  const reads = () => api.callsTo('GET', '/runs/' + run.id).length;
  const writes = () => api.callsTo('POST', '/runs/' + run.id + '/input').length;
  try {
    await screen.findByRole('heading', { name: /^Timeline \(3 events, live\)/ });
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(view.queryClient.getQueryState(keys.run(run.id))?.fetchStatus).toBe('idle'));
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'draft survives both failures' } });
    hold();
    outage = 1;
    act(() => api.dropStreams(run.id));
    await waitFor(() => expect(stale()).toBe(true));
    await waitFor(() => expect(held).toBe(1));
    expect(submit().disabled).toBe(true);
    chronology.push('first refused reconnect blocked writes');
    outage = 0;
    proceed();
    await waitFor(() => expect(opens).toBeGreaterThanOrEqual(2));
    await screen.findByRole('heading', { name: /^Timeline \(3 events, live\)/ });
    await waitFor(() => expect(submit().disabled).toBe(false));
    chronology.push('run recovered, second stream live with unchanged cursor');
    hold();
    const unserved = view.queryClient.refetchQueries({ queryKey: keys.run(run.id), exact: true });
    await waitFor(() => expect(held).toBe(2));
    const beforeRefusal = refused;
    outage = 2;
    // The real API ends SSE with res.end() on graceful shutdown. The helper observes EOF;
    // the subsequent reconnection fails with a transport error while this run GET is held.
    act(() => api.dropStreams(run.id));
    await waitFor(() => expect(refused).toBeGreaterThan(beforeRefusal));
    await screen.findByRole('heading', { name: /^Timeline \(3 events, connecting…\)/ });
    const atSecondFailure = { stale: stale(), submitDisabled: submit().disabled, writes: writes() };
    proceed();
    await act(async () => { await unserved; });
    const afterOldSuccess = { stale: stale(), submitDisabled: submit().disabled };
    fireEvent.submit(screen.getByRole('form', { name: 'Submit input' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const sent = writes();
    console.log(JSON.stringify({ chronology, atSecondFailure, afterOldSuccess, writesAfterImplicitSubmit: sent }));
    expect({ atSecondFailure, afterOldSuccess, sent }).toEqual({
      atSecondFailure: { stale: true, submitDisabled: true, writes: 0 },
      afterOldSuccess: { stale: true, submitDisabled: true },
      sent: 0,
    });
  } finally {
    proceed();
    view.unmount();
  }
});
