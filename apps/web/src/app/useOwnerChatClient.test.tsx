import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApiKeyStore } from '../api/api-key.js';
import { session } from '../chat/__fixtures__/chat.js';
import { ChatApiError } from '../chat/client.js';
import { useOwnerChatClient } from './useOwnerChatClient.js';
afterEach(() => vi.unstubAllGlobals());

/** Stubs fetch so every request waits until the test answers it, by its call index. */
function heldFetch() {
  const answers: ((response: Response) => void)[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(
    () =>
      new Promise<Response>((resolve) => {
        answers.push(resolve);
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    sentKey: (call: number) =>
      new Headers(fetch.mock.calls[call]![1]!.headers).get('authorization'),
    answer: (call: number, response: Response) => answers[call]!(response),
  };
}

const unauthorized = () => new Response('{"code":"UNAUTHORIZED"}', { status: 401 });

describe('owner chat credential composition', () => {
  it('injects only the current owner key and marks a current 401 rejected', async () => {
    useApiKeyStore.getState().save('owner-key');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(session))));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(useOwnerChatClient);
    await result.current.session();
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('authorization')).toBe(
      'Bearer owner-key',
    );
    fetch.mockResolvedValue(new Response('{"code":"UNAUTHORIZED"}', { status: 401 }));
    await expect(result.current.session()).rejects.toMatchObject({ status: 401 });
    expect(useApiKeyStore.getState().rejected).toBe(true);
  });
  it('does not reject a replacement key after an older request fails', async () => {
    useApiKeyStore.getState().save('old-key');
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const { result } = renderHook(useOwnerChatClient);
    const pending = result.current.session();
    act(() => useApiKeyStore.getState().save('new-key'));
    finish(new Response('{}', { status: 401 }));
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(useApiKeyStore.getState().rejected).toBe(false);
  });
  it('keeps same-key recovery from an older 401 and rejects a current 401 on the same client', async () => {
    useApiKeyStore.getState().save('owner-key');
    const calls = heldFetch();
    const { result } = renderHook(useOwnerChatClient);
    const client = result.current;
    const old = client.devices();
    expect(calls.sentKey(0)).toBe('Bearer owner-key');
    // Another request's 401 rejects the key, then the owner enters the same key again.
    act(() => useApiKeyStore.getState().markRejected());
    act(() => useApiKeyStore.getState().save('owner-key'));
    const recovered = useApiKeyStore.getState().generation;
    expect(result.current).toBe(client);
    // Sent after recovery through the same memoized client, while the older request is pending.
    const current = client.devices();
    expect(calls.sentKey(1)).toBe('Bearer owner-key');

    calls.answer(0, unauthorized());
    await expect(old).rejects.toBeInstanceOf(ChatApiError);
    await expect(old).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(useApiKeyStore.getState()).toMatchObject({
      key: 'owner-key',
      rejected: false,
      generation: recovered,
    });

    calls.answer(1, unauthorized());
    await expect(current).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(useApiKeyStore.getState()).toMatchObject({
      key: 'owner-key',
      rejected: true,
      generation: recovered + 1,
    });
    expect(calls.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a current 401 from a client reused across same-key recovery', async () => {
    useApiKeyStore.getState().save('owner-key');
    const calls = heldFetch();
    const { result } = renderHook(useOwnerChatClient);
    const client = result.current;
    act(() => useApiKeyStore.getState().markRejected());
    act(() => useApiKeyStore.getState().save('owner-key'));
    const recovered = useApiKeyStore.getState().generation;
    expect(result.current).toBe(client);
    const current = client.session();
    calls.answer(0, unauthorized());
    await expect(current).rejects.toMatchObject({ status: 401 });
    expect(useApiKeyStore.getState()).toMatchObject({ rejected: true, generation: recovered + 1 });
  });
  it.each([
    {
      change: 'forgotten and accepted again',
      apply: () => {
        useApiKeyStore.getState().forget();
        useApiKeyStore.getState().save('owner-key');
      },
      key: 'owner-key',
    },
    {
      change: 'replaced and accepted again',
      apply: () => {
        useApiKeyStore.getState().save('other-key');
        useApiKeyStore.getState().save('owner-key');
      },
      key: 'owner-key',
    },
    { change: 'forgotten', apply: () => useApiKeyStore.getState().forget(), key: undefined },
  ])('rejects only a current 401 after the key is $change', async ({ apply, key }) => {
    useApiKeyStore.getState().save('owner-key');
    const calls = heldFetch();
    const { result } = renderHook(useOwnerChatClient);
    const old = result.current.devices();
    expect(calls.sentKey(0)).toBe('Bearer owner-key');
    act(apply);
    const settled = useApiKeyStore.getState().generation;
    calls.answer(0, unauthorized());
    await expect(old).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(useApiKeyStore.getState()).toMatchObject({ key, rejected: false, generation: settled });

    const current = result.current.devices();
    expect(calls.sentKey(1)).toBe(key === undefined ? null : `Bearer ${key}`);
    calls.answer(1, unauthorized());
    await expect(current).rejects.toMatchObject({ status: 401 });
    expect(useApiKeyStore.getState()).toMatchObject({
      key,
      rejected: true,
      generation: settled + 1,
    });
  });
});
