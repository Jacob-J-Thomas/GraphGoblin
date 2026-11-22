// PREPARED / UNEXECUTED. Destination after exact repaired-source admission:
// apps/web/src/app/owner-chat-request-generation.qa.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { useOwnerChatClient } from './useOwnerChatClient.js';

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => vi.unstubAllGlobals());

function heldResponse() {
  let release!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => { release = resolve; });
  return { promise, release };
}

function unauthorized() {
  return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
}

function chatSchedule() {
  const old = heldResponse();
  const current = heldResponse();
  let requests = 0;
  const fetch = vi.fn<typeof globalThis.fetch>((input) => {
    expect(requestUrl(input)).toBe('/chat/devices');
    requests++;
    const gate = requests === 1 ? old : current;
    if (requests > 2) throw new Error('Unplanned owner Chat request');
    return gate.promise;
  });
  vi.stubGlobal('fetch', fetch);
  return { old, current, fetch };
}

async function managementRejection() {
  const api = new FakeApi();
  api.override('GET /api-keys', () => problem(401, 'UNAUTHORIZED'));
  const client = createAppClient('http://graphgoblin.test', api.fetch);
  await act(async () => {
    const { response } = await client.GET('/api-keys');
    expect(response.status).toBe(401);
  });
  expect(useApiKeyStore.getState().rejected).toBe(true);
}

it('D230 C2: an old same-key Chat 401 is retired but a post-recovery 401 from the same memoized client rejects', async () => {
  const key = 'synthetic-d230-same';
  useApiKeyStore.getState().save(key);
  const schedule = chatSchedule();
  const view = renderHook(useOwnerChatClient);
  try {
    const owner = view.result.current;
    // Attach the rejection observer at send time, before releasing either response.
    const retired = owner.devices().catch((error: unknown) => error);
    await waitFor(() => expect(schedule.fetch).toHaveBeenCalledTimes(1));
    const sent = useApiKeyStore.getState().generation;
    expect(new Headers(schedule.fetch.mock.calls[0]![1]?.headers).get('authorization')).toBe(`Bearer ${key}`);
    await managementRejection();
    expect(useApiKeyStore.getState().generation).toBe(sent + 1);
    act(() => useApiKeyStore.getState().save(key));
    const recovered = useApiKeyStore.getState().generation;
    expect(recovered).toBe(sent + 2);
    // A guard captured only at useMemo creation must fail this current-request control.
    expect(view.result.current).toBe(owner);
    const fresh = owner.devices().catch((error: unknown) => error);
    await waitFor(() => expect(schedule.fetch).toHaveBeenCalledTimes(2));
    await act(async () => {
      schedule.old.release(unauthorized());
      expect(await retired).toMatchObject({ status: 401 });
    });
    expect(useApiKeyStore.getState()).toMatchObject({ key, rejected: false, generation: recovered });
    await act(async () => {
      schedule.current.release(unauthorized());
      expect(await fresh).toMatchObject({ status: 401 });
    });
    expect(view.result.current).toBe(owner);
    expect(useApiKeyStore.getState()).toMatchObject({ key, rejected: true, generation: recovered + 1 });
  } finally {
    schedule.old.release(Response.json({ items: [] }));
    schedule.current.release(Response.json({ items: [] }));
    view.unmount();
  }
});

it.each(['replace', 'forget-and-reaccept'] as const)(
  'D230 C3/C4: a retired Chat 401 preserves %s, while its current request still rejects',
  async (transition) => {
    const oldKey = 'synthetic-d230-A';
    const key = transition === 'replace' ? 'synthetic-d230-B' : oldKey;
    useApiKeyStore.getState().save(oldKey);
    const schedule = chatSchedule();
    const view = renderHook(useOwnerChatClient);
    try {
      const owner = view.result.current;
      const retired = owner.devices().catch((error: unknown) => error);
      await waitFor(() => expect(schedule.fetch).toHaveBeenCalledTimes(1));
      const sent = useApiKeyStore.getState().generation;
      if (transition === 'forget-and-reaccept') {
        act(() => useApiKeyStore.getState().forget());
        await waitFor(() => expect(view.result.current).not.toBe(owner));
        expect(useApiKeyStore.getState()).toMatchObject({ key: undefined, rejected: false, generation: sent + 1 });
      }
      act(() => useApiKeyStore.getState().save(key));
      const recovered = useApiKeyStore.getState().generation;
      expect(recovered).toBe(sent + (transition === 'replace' ? 1 : 2));
      const fresh = view.result.current.devices().catch((error: unknown) => error);
      await waitFor(() => expect(schedule.fetch).toHaveBeenCalledTimes(2));
      expect(new Headers(schedule.fetch.mock.calls[0]![1]?.headers).get('authorization')).toBe(`Bearer ${oldKey}`);
      expect(new Headers(schedule.fetch.mock.calls[1]![1]?.headers).get('authorization')).toBe(`Bearer ${key}`);
      await act(async () => {
        schedule.old.release(unauthorized());
        expect(await retired).toMatchObject({ status: 401 });
      });
      expect(useApiKeyStore.getState()).toMatchObject({ key, rejected: false, generation: recovered });
      await act(async () => {
        schedule.current.release(unauthorized());
        expect(await fresh).toMatchObject({ status: 401 });
      });
      expect(useApiKeyStore.getState()).toMatchObject({ key, rejected: true, generation: recovered + 1 });
    } finally {
      schedule.old.release(Response.json({ items: [] }));
      schedule.current.release(Response.json({ items: [] }));
      view.unmount();
    }
  },
);

it('D230 C5: cancellation alone does not make a current Chat 401 obsolete', async () => {
  const key = 'synthetic-d230-current';
  useApiKeyStore.getState().save(key);
  const sent = useApiKeyStore.getState().generation;
  const held = heldResponse();
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(() => held.promise));
  const view = renderHook(useOwnerChatClient);
  try {
    const controller = new AbortController();
    const pending = view.result.current.devices(controller.signal).catch((error: unknown) => error);
    controller.abort();
    await act(async () => {
      held.release(unauthorized());
      expect(await pending).toMatchObject({ status: 401 });
    });
    expect(useApiKeyStore.getState()).toMatchObject({ key, rejected: true, generation: sent + 1 });
  } finally {
    held.release(Response.json({ items: [] }));
    view.unmount();
  }
});
