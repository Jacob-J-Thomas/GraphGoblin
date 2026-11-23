import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { event, FakeApi, problem, queuedFields } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { useRunEventStore } from './event-store.js';

/** The URL a global fetch was called with; the owner Chat client passes a path string. */
function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

describe('owner Chat credentials across routes (#386)', () => {
  // An owner Devices list, sent without an abort signal, is still pending when the owner opens a
  // quiet waiting run, recovers from a management 401 with the same key and sees the status
  // verified again. Only then does the Devices request answer 401: it was sent under an earlier
  // credential generation, so it must not reject the recovered one.
  it('keeps a quiet inspector recovered when a former owner Devices page returns a retired 401', async () => {
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
        const url = requestUrl(input);
        if (url !== '/chat/devices') {
          unexpectedGlobalCalls.push(url);
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
      const runsLink = screen.getAllByRole('link', { name: 'Runs', exact: true })[0]!;
      await user.click(runsLink);
      await user.click(await screen.findByRole('link', { name: run.id, exact: true }));
      expect(screen.getByTestId('location')).toHaveTextContent('/runs/' + run.id);
      const heading = await screen.findByRole('heading', { name: 'Run ' + run.id });
      const header = heading.closest('header')!;
      await within(header).findByText('at real-wait');
      const runReads = () => api.callsTo('GET', '/runs/' + run.id).length;
      const before = runReads();

      // A separate management request is answered 401, and the owner enters the same key again.
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

      // Only now does the earlier Devices request answer 401.
      await act(async () => {
        releaseChat(Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }));
        await held;
        // Let the retired response reach its caller and anything it could schedule.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const actual = {
        generation: useApiKeyStore.getState().generation,
        rejected: useApiKeyStore.getState().rejected,
        keyForm: screen.queryByRole('form', { name: 'Enter API key' }) !== null,
        badge: header.querySelector('[data-status]')?.getAttribute('data-status') ?? null,
        updating: within(header).queryByText('Updating status…') !== null,
        recordedWait: within(header).queryByText('at real-wait') !== null,
      };
      expect(unexpectedGlobalCalls).toEqual([]);
      expect(actual).toEqual({
        generation: recovered,
        rejected: false,
        keyForm: false,
        badge: 'waiting',
        updating: false,
        recordedWait: true,
      });
      // The retired response makes no run read and moves neither the event cursor nor the route.
      expect(chatCalls).toBe(1);
      expect(runReads()).toBe(before + 1);
      expect(useRunEventStore.getState().runs[run.id]?.lastSeq).toBe(3);
      expect(screen.getByTestId('location')).toHaveTextContent('/runs/' + run.id);
    } finally {
      releaseChat(Response.json({ items: [] }));
      view.unmount();
      view.queryClient.clear();
      useRunEventStore.getState().clear(run.id);
      vi.unstubAllGlobals();
    }
  });
});
