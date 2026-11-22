import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { useRunEventStore } from './event-store.js';
function gate() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return {held, release};
}
it('restores an invalidated failed outcome from cached observation after A to B to A navigation', async () => {
  const api = new FakeApi();
  const b = api.addRun({status:'running', lastEventSeq:2});
  const a = api.addRun({status:'running', lastEventSeq:2, currentNodeId:'old-node', parentRunId:b.id});
  api.runs.set(b.id,{...b, parentRunId:a.id});
  for(const run of [a,b]) {
    useRunEventStore.getState().clear(run.id);
    api.events.set(run.id, [
      event(run.id,1,'run.queued',queuedFields()),
      event(run.id,2,'run.started',{attempt:1}),
    ]);
  }
  api.events.get(a.id)!.push(event(a.id,3,'run.failed',{failure:{code:'INTERNAL_ERROR',message:'fixture',resumable:true}}));
  const stream = gate();
  const reads = gate();
  let rowCount = 0, observationCount = 0, returnedCursor = false;
  api.override('GET /runs/:id/events',async (call) => {
    if (call.path === '/runs/'+a.id+'/events' && call.headers.get('accept') === 'text/event-stream') {
      if(call.search.get('after') === '4') returnedCursor = true;
      await stream.held;
    }
    return api.builtIn(call);
  });
  api.override('GET /runs/:id',async (call) => {
    if(call.path === '/runs/'+a.id && ++rowCount > 1) await reads.held;
    return api.builtIn(call);
  });
  api.override('GET /runs/:id/observation', async (call) => {
    if(call.path === '/runs/'+a.id+'/observation' && ++observationCount > 1) await reads.held;
    return api.builtIn(call);
  });
  const view = renderApp('/runs/'+a.id,api);
  const header = async (id: string) => (await screen.findByRole('heading',{name:'Run '+id})).closest('header')!;
  try {
    const first = await header(a.id);
    const terminal = () => view.queryClient.getQueryData<{lifecycle?:RunEvent}>(keys.observation(a.id))?.lifecycle;
    await waitFor(() => expect(terminal()).toMatchObject({seq:3,type:'run.failed'}));
    api.events.get(a.id)!.push(event(a.id,4,'run.resumed',{actor:{kind:'user',id:'local'}}));
    act(() => stream.release());
    await within(first).findByText('Updating status…');
    expect(within(await screen.findByRole('list',{name:'Timeline'})).getByText('#4')).toBeVisible();
    fireEvent.click(within(first).getByRole('link',{name:'parent run'}));
    const other = await header(b.id);
    fireEvent.click(within(other).getByRole('link',{name:'parent run'}));
    const revisited = await header(a.id);
    await waitFor(() => expect(returnedCursor).toBe(true));
    const timeline = await screen.findByRole('list',{name:'Timeline'});
    expect(within(timeline).getByRole('button',{name:/run\.resumed/})).toBeVisible();
    expect(useRunEventStore.getState().runs[a.id]?.lastSeq).toBe(4);
    expect(terminal()).toMatchObject({seq:3,type:'run.failed'});
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(a.id))).toMatchObject({status:'running',lastEventSeq:2});
    expect(revisited.querySelector('[data-status]')).toHaveAttribute('data-status','failed');
    expect(within(revisited).getByText('Status from event #3; the run record is updating.')).toBeVisible();
  } finally {view.unmount(); stream.release(); reads.release();}
});