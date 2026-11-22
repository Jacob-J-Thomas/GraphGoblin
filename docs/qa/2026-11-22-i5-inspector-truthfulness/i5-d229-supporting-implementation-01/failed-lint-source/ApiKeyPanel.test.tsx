import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useRunEventStore } from '../runs/event-store.js';
import { useApiKeyStore } from './api-key.js';
import { createAppClient } from './context.js';
import { keys } from './queries.js';

const KEY = 'gg_same';

function parkedRun(api: FakeApi) {
  const run = api.addRun({ status: 'waiting', lastEventSeq: 3, currentNodeId: 'real-wait' });
  api.pushEvent(run.id, event(run.id, 1, 'run.queued', queuedFields()));
  api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
  api.pushEvent(
    run.id,
    event(run.id, 3, 'run.waiting', {
      nodeId: 'real-wait',
      wait: { waitId: 'fixture-wait', startedSeq: 3, nodeId: 'real-wait', kind: 'input' },
    }),
  );
  // Returning to an acknowledged tail: neither the initial nor recovered stream has new frames.
  useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!);
  api.requiredKey = KEY;
  useApiKeyStore.getState().save(KEY);
  return run;
}

async function headerFor(runId: string) {
  return (await screen.findByRole('heading', { name: 'Run ' + runId })).closest('header')!;
}

async function rejectThroughHttp(api: FakeApi) {
  api.override('GET /api-keys', () => problem(401, 'UNAUTHORIZED'));
  const client = createAppClient('http://graphgoblin.test', api.fetch);
  await act(async () => {
    const { response } = await client.GET('/api-keys');
    expect(response.status).toBe(401);
  });
  await screen.findByRole('form', { name: 'Enter API key' });
  expect(useApiKeyStore.getState().rejected).toBe(true);
}

async function submitSameKey() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('API key', { selector: 'input' }), KEY);
  await user.click(screen.getByRole('button', { name: 'Use key' }));
}

function streams(api: FakeApi, runId: string) {
  return api
    .callsTo('GET', `/runs/${runId}/events`)
    .filter((call) => call.headers.get('accept') === 'text/event-stream');
}

describe('same-key inspector recovery through the visible API key panel (R2-3)', () => {
  it('reads the quiet parked run once after same-key submit, without injected refresh or new SSE data', async () => {
    const api = new FakeApi();
    const run = parkedRun(api);
    const view = renderApp('/runs/' + run.id, api);
    try {
      const header = await headerFor(run.id);
      await within(header).findByText('at real-wait');
      expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
      const before = api.callsTo('GET', `/runs/${run.id}`).length;
      await rejectThroughHttp(api);
      expect(within(header).getByText('Updating status…')).toBeVisible();
      expect(api.callsTo('GET', `/runs/${run.id}`)).toHaveLength(before);
      await submitSameKey();
      await within(header).findByText('at real-wait');
      expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
      expect(screen.queryByRole('form', { name: 'Enter API key' })).toBeNull();
      expect(api.callsTo('GET', `/runs/${run.id}`)).toHaveLength(before + 1);
      await waitFor(() => expect(streams(api, run.id)).toHaveLength(2));
      expect(streams(api, run.id).every((call) => call.search.get('after') === '3')).toBe(true);
      expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
    } finally {
      view.unmount();
      view.queryClient.clear();
      useRunEventStore.getState().clear(run.id);
    }
  });

  it.each([
    { cache: 'warm', oldStatus: 200 },
    { cache: 'warm', oldStatus: 401 },
    { cache: 'empty', oldStatus: 200 },
    { cache: 'empty', oldStatus: 401 },
  ] as const)(
    'retires an old pending $oldStatus read with a $cache cache before the fresh recovery read',
    async ({ cache, oldStatus }) => {
      const api = new FakeApi();
      const run = parkedRun(api);
      let holdOld = cache === 'empty';
      let holdFresh = false;
      let oldSignal: AbortSignal | undefined;
      let oldGeneration: number | undefined;
      let freshGeneration: number | undefined;
      let freshReads = 0;
      let releaseOld!: () => void;
      let releaseFresh!: () => void;
      const oldGate = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      const freshGate = new Promise<void>((resolve) => {
        releaseFresh = resolve;
      });
      api.override('GET /runs/:id', async (call) => {
        if (holdOld) {
          holdOld = false;
          oldSignal = call.signal;
          oldGeneration = useApiKeyStore.getState().generation;
          await oldGate;
          return oldStatus === 401
            ? problem(401, 'UNAUTHORIZED')
            : Response.json({
                ...run,
                status: 'running',
                lastEventSeq: 2,
                currentNodeId: 'old-node',
              });
        }
        if (holdFresh) {
          freshReads += 1;
          freshGeneration = useApiKeyStore.getState().generation;
          await freshGate;
        }
        return api.builtIn(call);
      });
      const view = renderApp('/runs/' + run.id, api);
      try {
        if (cache === 'warm') {
          await within(await headerFor(run.id)).findByText('at real-wait');
          holdOld = true;
          act(() => {
            void view.queryClient.refetchQueries({ queryKey: keys.run(run.id), exact: true });
          });
        }
        await waitFor(() => expect(oldSignal).toBeDefined());
        expect(oldSignal?.aborted).toBe(false);
        await rejectThroughHttp(api);
        const rejectedReadCount = api.callsTo('GET', `/runs/${run.id}`).length;
        holdFresh = true;
        // From submission onward only the production panel schedules reads. The test releases bodies.
        await submitSameKey();
        await waitFor(() => expect(freshReads).toBe(1));
        const generation = useApiKeyStore.getState().generation;
        expect(freshGeneration).toBe(generation);
        expect(freshGeneration).toBeGreaterThan(oldGeneration!);
        expect(oldSignal?.aborted).toBe(true);
        expect(api.callsTo('GET', `/runs/${run.id}`)).toHaveLength(rejectedReadCount + 1);
        await act(async () => {
          releaseOld();
          await oldGate;
        });
        expect(useApiKeyStore.getState()).toMatchObject({ rejected: false, generation });
        expect(screen.queryByRole('form', { name: 'Enter API key' })).toBeNull();
        if (cache === 'warm') {
          const header = await headerFor(run.id);
          expect(within(header).getByText('Updating status…')).toBeVisible();
          expect(within(header).queryByText(/^at /)).toBeNull();
          expect(view.queryClient.getQueryData(keys.run(run.id))).toMatchObject({
            id: run.id,
            status: 'waiting',
            currentNodeId: 'real-wait',
          });
        } else {
          expect(view.queryClient.getQueryData(keys.run(run.id))).toBeUndefined();
        }
        await act(async () => {
          releaseFresh();
          await freshGate;
        });
        const header = await headerFor(run.id);
        await within(header).findByText('at real-wait');
        expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
        expect(within(header).queryByText('Updating status…')).toBeNull();
        expect(useApiKeyStore.getState()).toMatchObject({ rejected: false, generation });
        expect(freshReads).toBe(1);
        expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
        await waitFor(() => expect(streams(api, run.id)).toHaveLength(2));
        expect(streams(api, run.id).every((call) => call.search.get('after') === '3')).toBe(true);
      } finally {
        releaseOld();
        releaseFresh();
        view.unmount();
        view.queryClient.clear();
        useRunEventStore.getState().clear(run.id);
      }
    },
  );

  it('does not refresh an already accepted unchanged key', async () => {
    const api = new FakeApi();
    const run = parkedRun(api);
    const view = renderApp('/runs/' + run.id, api);
    try {
      await within(await headerFor(run.id)).findByText('at real-wait');
      const before = api.callsTo('GET', `/runs/${run.id}`).length;
      const generation = useApiKeyStore.getState().generation;
      await act(async () => {
        useApiKeyStore.getState().save(KEY);
      });
      expect(useApiKeyStore.getState().generation).toBe(generation);
      expect(api.callsTo('GET', `/runs/${run.id}`)).toHaveLength(before);
      expect(streams(api, run.id)).toHaveLength(1);
    } finally {
      view.unmount();
      view.queryClient.clear();
      useRunEventStore.getState().clear(run.id);
    }
  });
});
