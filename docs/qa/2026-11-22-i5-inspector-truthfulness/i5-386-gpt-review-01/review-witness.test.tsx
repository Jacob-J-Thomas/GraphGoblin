import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { event, FakeApi, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { useRunEventStore } from './event-store.js';
import { emptyEvidence, observeEvents, observeLifecycle, headerStatus } from './run-header-status.js';

const actor = { kind: 'user' as const, id: 'local' };
function gate() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return { held, release };
}
function failure(runId: string, seq: number, nodeId: string) {
  return event(runId, seq, 'run.failed', { failure: { code: 'INTERNAL_ERROR', message: 'fixture', nodeId, resumable: true } });
}
function header(id: string) {
  return screen.getByRole('heading', { name: 'Run ' + id }).closest('header')!;
}
it('receiving the resume observation before its replay loses the known prior failure in the rendered header', async () => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'running', lastEventSeq: 2, currentNodeId: 'stale-node' });
  const id = run.id;
  useRunEventStore.getState().clear(id);
  const events: RunEvent[] = [
    event(id, 1, 'run.queued', queuedFields()),
    event(id, 2, 'run.started', { attempt: 1 }),
    failure(id, 3, 'stale-node'),
    event(id, 4, 'run.resumed', { actor }),
  ];
  api.events.set(id, events);
  const stream = gate();
  const freshRow = gate();
  let reads = 0;
  api.override('GET /runs/:id/events', async (call) => {
    if (call.headers.get('accept') === 'text/event-stream') await stream.held;
    return api.builtIn(call);
  });
  api.override('GET /runs/:id', async (call) => {
    if (++reads > 1) await freshRow.held;
    return api.builtIn(call);
  });
  const view = renderApp('/runs/' + id, api);
  try {
    await screen.findByRole('heading', { name: 'Run ' + id });
    const cache = () => view.queryClient.getQueryData<{lifecycle?: RunEvent}>(keys.observation(id));
    await waitFor(() => expect(cache()?.lifecycle).toMatchObject({ type: 'run.resumed', seq: 4 }));
    act(() => stream.release());
    const timeline = await screen.findByRole('list', {name: 'Timeline'});
    await within(timeline).findByRole('button', { name: /run\.failed/ });
    await within(timeline).findByRole('button', { name: /run\.resumed/ });
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(id))).toMatchObject({ status: 'running', lastEventSeq: 2, currentNodeId: 'stale-node' });
    expect(header(id).querySelector('[data-status]')).toHaveAttribute('data-status', 'running');
    expect(within(header(id)).getByText('at stale-node')).toBeVisible();
    expect(within(header(id)).queryByText('Updating status…')).toBeNull();
    const streamFirst = observeLifecycle(observeEvents(emptyEvidence(id), events), events.at(-1));
    const observationFirst = observeEvents(observeLifecycle(emptyEvidence(id), events.at(-1)), events);
    expect(headerStatus(streamFirst, run)).toEqual({kind: 'updating'});
    expect(headerStatus(observationFirst, run)).toEqual({kind: 'record', status: 'running'});
  } finally { view.unmount(); stream.release(); freshRow.release(); }
});
it('renders the previous attempt position when two failures have the same status but different nodes', async () => {
  const api = new FakeApi();
  const run = api.addRun({ status: 'failed', lastEventSeq: 3, currentNodeId: 'first-node',
    failure: { code:'INTERNAL_ERROR', message:'fixture', nodeId:'first-node', resumable: true } });
  const id = run.id;
  useRunEventStore.getState().clear(id);
  const events: RunEvent[] = [
    event(id, 1, 'run.queued', queuedFields()),
    event(id, 2, 'run.started', {attempt: 1}),
    failure(id, 3, 'first-node'),
    event(id, 4, 'run.resumed', {actor}),
    event(id, 5, 'node.started', {nodeId:'first-node',kind:'mutate',attempt:2,configHash:'h'}),
    event(id, 6, 'node.finished', {nodeId:'first-node',durationMs:1,patch:[]}),
    event(id, 7, 'node.started', {nodeId:'second-node',kind:'mutate',attempt:1,configHash:'h'}),
    failure(id, 8, 'second-node'),
  ];
  api.events.set(id, events);
  const freshRow = gate();
  let reads = 0;
  api.override('GET /runs/:id', async (call) => {
    if (++reads > 1) await freshRow.held;
    return api.builtIn(call);
  });
  const view = renderApp('/runs/' + id, api);
  try {
    const timeline = await screen.findByRole('list', {name:'Timeline'});
    await within(timeline).findByText('#8');
    expect(within(timeline).getAllByRole('button',{name:/run\.failed/})).toHaveLength(2);
    expect(view.queryClient.getQueryData<RunRecord>(keys.run(id))).toMatchObject({status:'failed',lastEventSeq:3,currentNodeId:'first-node'});
    expect(header(id).querySelector('[data-status]')).toHaveAttribute('data-status','failed');
    expect(within(header(id)).getByText('at first-node')).toBeVisible();
    expect(within(header(id)).queryByText(/Status from event #8/)).toBeNull();
  } finally { view.unmount(); freshRow.release(); }
});