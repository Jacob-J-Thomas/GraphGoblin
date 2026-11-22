// PREPARED / UNEXECUTED. Additive derivative; original witness retained byte-identical separately.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { keys } from '../api/queries.js';
import { useRunEventStore } from './event-store.js';

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

it('D230 C1b: keeps the original recovery assertions plus cache, cursor and quiet read budget', async () => {
  const key = 'synthetic-owner-witness';
  const api = new FakeApi();
  api.requiredKey = key;
  useApiKeyStore.getState().save(key);
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
  useRunEventStore.getState().append(run.id, ...api.events.get(run.id)!);
  let oldGeneration: number | undefined;
  let chatCalls = 0;
  let oldHadSignal: boolean | undefined;
  let oldSentSameKey: boolean | undefined;
  let releaseChat!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => {
    releaseChat = resolve;
  });
  const unexpectedGlobalCalls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>((input, init) => {
      if (requestUrl(input) !== '/chat/devices') {
        unexpectedGlobalCalls.push(requestUrl(input));
        return Promise.reject(new Error('Unplanned fixture request'));
      }
      chatCalls += 1;
      oldGeneration = useApiKeyStore.getState().generation;
      oldHadSignal = Boolean(init?.signal);
      oldSentSameKey = new Headers(init?.headers).get('authorization') === 'Bearer ' + key;
      return held;
    }),
  );
  const user = userEvent.setup();
  const view = renderApp('/chat/devices', api);
  try {
    await waitFor(() => expect(chatCalls).toBe(1));
    expect(oldSentSameKey).toBe(true);
    expect(oldHadSignal).toBe(false);
    const runsLink = screen.getAllByRole('link', { name: 'Runs' })[0]!;
    await user.click(runsLink);
    await user.click(await screen.findByRole('link', { name: run.id }));
    expect(screen.getByTestId('location')).toHaveTextContent('/runs/' + run.id);
    const header = (await screen.findByRole('heading', { name: 'Run ' + run.id })).closest(
      'header',
    )!;
    await within(header).findByText('at real-wait');
    const runReads = () => api.callsTo('GET', '/runs/' + run.id).length;
    const before = runReads();
    api.override('GET /api-keys', () => problem(401, 'UNAUTHORIZED'));
    const appClient = createAppClient('http://graphgoblin.test', api.fetch);
    await act(async () => {
      const { response } = await appClient.GET('/api-keys');
      expect(response.status).toBe(401);
    });
    await screen.findByRole('form', { name: 'Enter API key' });
    const rejected = useApiKeyStore.getState().generation;
    expect(rejected).toBeGreaterThan(oldGeneration!);
    await user.type(screen.getByLabelText('API key', { selector: 'input' }), key);
    await user.click(screen.getByRole('button', { name: 'Use key' }));
    await within(header).findByText('at real-wait');
    await waitFor(() => expect(runReads()).toBe(before + 1));
    const recovered = useApiKeyStore.getState().generation;
    expect(recovered).toBeGreaterThan(rejected);
    expect(useApiKeyStore.getState().rejected).toBe(false);
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
    expect(screen.queryByRole('form', { name: 'Enter API key' })).toBeNull();
    await act(async () => {
      releaseChat(Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }));
      await held;
    });
    const actual = {
      generation: useApiKeyStore.getState().generation,
      rejected: useApiKeyStore.getState().rejected,
      keyForm: screen.queryByRole('form', { name: 'Enter API key' }) !== null,
      badge: header.querySelector('[data-status]')?.getAttribute('data-status') ?? null,
      updating: within(header).queryByText('Updating status…') !== null,
      recordedWait: within(header).queryByText('at real-wait') !== null,
    };
    process.stdout.write(
      'retired owner Devices response ' +
        JSON.stringify({
          oldGeneration,
          rejected,
          recovered,
          oldSentSameKey,
          oldHadSignal,
          chatCalls,
          runReadsBefore: before,
          runReadsAfter: runReads(),
          route: screen.getByTestId('location').textContent,
          cursor: useRunEventStore.getState().runs[run.id]?.lastSeq,
          unexpectedGlobalCalls,
          actual,
        }) +
        '\n',
    );
    expect(unexpectedGlobalCalls).toEqual([]);
    expect(actual).toEqual({
      generation: recovered,
      rejected: false,
      keyForm: false,
      badge: 'waiting',
      updating: false,
      recordedWait: true,
    });
    // Additive independent measurements; all original assertions above are unchanged.
    expect(runReads()).toBe(before + 1);
    expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
    expect(view.queryClient.getQueryData(keys.run(run.id))).toMatchObject({
      id: run.id,
      status: 'waiting',
      lastEventSeq: 3,
      currentNodeId: 'real-wait',
    });
    // Fixed finite quiet-budget sample, not a synchronization wait or a product timeout change.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 2200));
    });
    expect(runReads()).toBe(before + 1);
    expect(screen.getByTestId('location')).toHaveTextContent('/runs/' + run.id);
    expect(useApiKeyStore.getState()).toMatchObject({ generation: recovered, rejected: false });
    expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
    expect(screen.queryByRole('form', { name: 'Enter API key' })).toBeNull();
    expect(header.querySelector('[data-status]')).toHaveAttribute('data-status', 'waiting');
    expect(within(header).getByText('at real-wait')).toBeVisible();
    expect(within(header).queryByText('Updating status…')).toBeNull();
  } finally {
    releaseChat(Response.json({ items: [] }));
    view.unmount();
    view.queryClient.clear();
    useRunEventStore.getState().clear(run.id);
    vi.unstubAllGlobals();
  }
});
