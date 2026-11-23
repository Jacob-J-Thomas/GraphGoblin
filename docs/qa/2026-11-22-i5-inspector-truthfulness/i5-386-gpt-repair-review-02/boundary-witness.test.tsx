import type { RunRecord } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { useApiKeyStore } from '../api/api-key.js';
import { useRunEventStore } from './event-store.js';

async function header(id: string) {
  return (await screen.findByRole('heading', { name: 'Run ' + id })).closest('header')!;
}
function seed(api: FakeApi) {
  const run = api.addRun({ status: 'waiting', lastEventSeq: 3, currentNodeId: 'real-wait',
    waiting: { waitId: 'test-wait', startedSeq: 3, nodeId: 'real-wait', kind: 'input' } });
  const wait = { waitId: 'test-wait', startedSeq: 3, nodeId: 'real-wait', kind: 'input' as const };
  const events = [event(run.id,1,'run.queued',queuedFields()),event(run.id,2,'run.started',{attempt:1}),
    event(run.id,3,'run.waiting',{nodeId:'real-wait',wait})];
  api.events.set(run.id, events);
  useRunEventStore.getState().clear(run.id);
  useRunEventStore.getState().append(run.id,...events);
  return run;
}
it('a successful foreign row reuses an existing matching receipt and shows its node on the requested route', async () => {
  const api = new FakeApi();
  const a = seed(api);
  const b = api.addRun({status:'waiting',lastEventSeq:3,currentNodeId:'foreign-position'});
  const view = renderApp('/runs/' + a.id, api);
  try {
    const original = await header(a.id);
    await within(original).findByText('at real-wait');
    api.override('GET /runs/:id', async (call) => {
      const body = await (await api.builtIn(call)).json();
      return Response.json({ ...body, id:b.id, currentNodeId:'foreign-position' });
    });
    await act(async () => { await view.queryClient.invalidateQueries({queryKey: keys.run(a.id),exact:true}); });
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(a.id))).toMatchObject({id:b.id,status:'waiting',lastEventSeq:3});
    expect(screen.getByTestId('location').textContent).toBe('/runs/' + a.id);
    const wrong = await header(b.id);
    expect(wrong.querySelector('[data-status]')).toHaveAttribute('data-status','waiting');
    expect(within(wrong).getByText('at foreign-position')).toBeVisible();
  } finally { view.unmount(); }
});
it('reentering the accepted key reopens SSE but leaves an idle parked run without a current receipt', async () => {
  const api = new FakeApi();
  const a = seed(api);
  useApiKeyStore.getState().save('synthetic-review-key');
  const view = renderApp('/runs/' + a.id, api);
  try {
    const h = await header(a.id);
    await within(h).findByText('at real-wait');
    const streamCalls = () => api.callsTo('GET','/runs/'+a.id+'/events').filter(c=>c.headers.get('accept')==='text/event-stream');
    await waitFor(()=>expect(streamCalls()).toHaveLength(1));
    const before=api.callsTo('GET','/runs/'+a.id).length;
    api.override('GET /runs/:id/observation', () => problem(401,'REFUSED'));
    await act(async () => { await view.queryClient.invalidateQueries({queryKey:keys.observation(a.id),exact:true}); });
    const prompt = await screen.findByRole('form',{name:'Enter API key'});
    expect(useApiKeyStore.getState().rejected).toBe(true);
    expect(within(h).getByText('Updating status…')).toBeVisible();
    api.override('GET /runs/:id/observation', (call) => api.builtIn(call));
    const user=userEvent.setup();
    await user.type(within(prompt).getByLabelText(/API key/), 'synthetic-review-key');
    await user.click(within(prompt).getByRole('button',{name:'Use key'}));
    await waitFor(()=>expect(streamCalls()).toHaveLength(2));
    expect(streamCalls()[1]!.search.get('after')).toBe('3');
    expect(useApiKeyStore.getState().rejected).toBe(false);
    await act(async () => { await new Promise(resolve=>setTimeout(resolve,2200)); });
    expect(api.callsTo('GET','/runs/'+a.id)).toHaveLength(before);
    expect(within(h).getByText('Updating status…')).toBeVisible();
    expect(within(h).queryByText('at real-wait')).toBeNull();
    // Show the available current response settles immediately when the missing read is asked for.
    await act(async () => { await view.queryClient.invalidateQueries({queryKey:keys.run(a.id),exact:true}); });
    await within(h).findByText('at real-wait');
    expect(h.querySelector('[data-status]')).toHaveAttribute('data-status','waiting');
  } finally { view.unmount(); useApiKeyStore.getState().forget(); }
});
