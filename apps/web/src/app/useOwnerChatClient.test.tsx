import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApiKeyStore } from '../api/api-key.js';
import { session } from '../chat/__fixtures__/chat.js';
import { useOwnerChatClient } from './useOwnerChatClient.js';
afterEach(() => vi.unstubAllGlobals());
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
});
