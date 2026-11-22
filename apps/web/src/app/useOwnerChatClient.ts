import { useMemo } from 'react';
import { useApiKeyStore } from '../api/api-key.js';
import { createChatClient } from '../chat/client.js';

/**
 * Owner credentials are connected here, outside the shared/peripheral chat module. Each request
 * notes the credential generation current when it is sent, and its 401 rejects the key only while
 * that key and generation are both still current, as a management request's does (#386). A request
 * left pending across a rejection and same-key recovery, a replacement or a forget cannot reject
 * the newer state; a request sent afterwards, even through this same memoized client, still can.
 * Every response reaches its caller unchanged.
 */
export function useOwnerChatClient() {
  const key = useApiKeyStore((state) => state.key);
  return useMemo(
    () =>
      createChatClient({
        getToken: () => key,
        fetch: async (input, init) => {
          // Read per request, not per client: one client serves every generation of the same key.
          const { generation } = useApiKeyStore.getState();
          const response = await globalThis.fetch(input, init);
          const current = useApiKeyStore.getState();
          if (response.status === 401 && current.key === key && current.generation === generation)
            current.markRejected();
          return response;
        },
      }),
    [key],
  );
}
