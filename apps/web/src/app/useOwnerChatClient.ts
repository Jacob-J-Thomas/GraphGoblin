import { useMemo } from 'react';
import { useApiKeyStore } from '../api/api-key.js';
import { createChatClient } from '../chat/client.js';

/** Owner credentials are connected here, outside the shared/peripheral chat module. */
export function useOwnerChatClient() {
  const key = useApiKeyStore((state) => state.key);
  return useMemo(
    () =>
      createChatClient({
        getToken: () => key,
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init);
          if (response.status === 401 && useApiKeyStore.getState().key === key)
            useApiKeyStore.getState().markRejected();
          return response;
        },
      }),
    [key],
  );
}
