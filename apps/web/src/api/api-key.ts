import { create } from 'zustand';

/** Where this browser keeps the API key it sends when the server runs with GG_REQUIRE_API_KEY. */
export const API_KEY_STORAGE = 'graphgoblin-api-key';

function read(): string | undefined {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface ApiKeyState {
  /** The stored key, if any. */
  key: string | undefined;
  /** The API answered 401: the app needs a (different) key before it can load data. */
  rejected: boolean;
  save: (key: string) => void;
  forget: () => void;
  markRejected: () => void;
}

/**
 * The browser's API key. Local trusted mode needs none; with `GG_REQUIRE_API_KEY=true` the first
 * 401 asks for one, it is kept in `localStorage`, and every request and event stream sends it.
 */
export const useApiKeyStore = create<ApiKeyState>((set) => ({
  key: read(),
  rejected: false,
  save: (key) => {
    const trimmed = key.trim();
    localStorage.setItem(API_KEY_STORAGE, trimmed);
    set({ key: trimmed, rejected: false });
  },
  forget: () => {
    localStorage.removeItem(API_KEY_STORAGE);
    set({ key: undefined, rejected: false });
  },
  markRejected: () => set({ rejected: true }),
}));

/** Wrap a fetch so it sends the stored key and reports a 401 to the key store. */
export function withApiKey(fetch: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const { key } = useApiKeyStore.getState();
    if (key && !request.headers.has('authorization')) {
      request.headers.set('authorization', `Bearer ${key}`);
    }
    const response = await fetch(request);
    if (response.status === 401) useApiKeyStore.getState().markRejected();
    return response;
  };
}
