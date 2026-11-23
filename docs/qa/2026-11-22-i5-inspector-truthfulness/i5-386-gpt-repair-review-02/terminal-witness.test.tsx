import { runs } from '@graphgoblin/api-client';
import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { createAppClient } from '../api/context.js';
import { keys } from '../api/queries.js';
import { App } from '../app/App.js';
import { Providers } from '../app/bootstrap.js';
import { useRunEventStore } from './event-store.js';

it('a matching cached row hides a newly accepted terminal marker while the fresh run read is held', async () => {
  const api = new FakeApi();
  const run = api.addRun({status:'succeeded',lastEventSeq:3,currentNodeId:'cached-node'});
  const id=run.id;
  useRunEventStore.getState().clear(id);
  const events=[event(id,1,'run.queued',queuedFields()),event(id,2,'run.started',{attempt:1}),
    event(id,3,'run.finished',{status:'succeeded',outcome:'success'})];
  api.events.set(id,events);
  const client=createAppClient('http://review.test',api.fetch);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:2000}}});
  cache.setQueryData(keys.run(id), await runs.get(client,id)); // Earlier provider's cached row.
  let release!:()=>void;
  const hold = new Promise<void>(resolve=>{release=resolve});
  let held=0;
  api.override('GET /runs/:id',async call=>{held++; await hold; return api.builtIn(call);});
  const view=render(<Providers client={client} queryClient={cache}><MemoryRouter initialEntries={['/runs/'+id]}><App/></MemoryRouter></Providers>);
  try {
    const h=(await screen.findByRole('heading',{name:'Run '+id})).closest('header')!;
    const timeline=await screen.findByRole('list',{name:'Timeline'});
    await within(timeline).findByRole('button',{name:/run\.finished/});
    await waitFor(()=>expect(held).toBeGreaterThan(0));
    expect(api.callsTo('GET','/runs/'+id+'/events').some(call=>call.headers.get('accept')==='text/event-stream')).toBe(true);
    expect(useRunEventStore.getState().runs[id]?.lastSeq).toBe(3);
    await waitFor(()=>expect(cache.getQueryData(keys.observation(id))).toMatchObject({lifecycle:{runId:id,seq:3,type:'run.finished',status:'succeeded'}}));
    expect(within(h).getByText('Updating status…')).toBeVisible();
    expect(h.querySelector('[data-status]')).toBeNull();
    expect(within(h).queryByText(/Status from event/)).toBeNull();
    await act(async()=>{release()});
    await within(h).findByText('Last node in run record: cached-node');
    expect(h.querySelector('[data-status]')).toHaveAttribute('data-status','succeeded');
  } finally {view.unmount(); release(); cache.clear();}
});
