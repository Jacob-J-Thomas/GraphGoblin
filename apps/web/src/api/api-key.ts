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
  /**
   * An opaque in-memory count of credential states, never derived from the key. It changes when
   * the key is replaced or forgotten, on the first rejection, and on recovery from one, here or in
   * another tab. Evidence read under one generation is not shown under another (#386).
   */
  generation: number;
  save: (key: string) => void;
  forget: () => void;
  markRejected: () => void;
}

/** An accepted key (or none): a new generation unless it is the same accepted state. */
function accept(state: ApiKeyState, key: string | undefined): Partial<ApiKeyState> {
  return state.key === key && !state.rejected
    ? { key, rejected: false }
    : { key, rejected: false, generation: state.generation + 1 };
}

/**
 * The browser's API key. Local trusted mode needs none; with `GG_REQUIRE_API_KEY=true` the first
 * 401 asks for one, it is kept in `localStorage`, and every request and event stream sends it.
 */
export const useApiKeyStore = create<ApiKeyState>((set) => ({
  key: read(),
  rejected: false,
  generation: 0,
  save: (key) => {
    const trimmed = key.trim();
    localStorage.setItem(API_KEY_STORAGE, trimmed);
    set((state) => accept(state, trimmed));
  },
  forget: () => {
    localStorage.removeItem(API_KEY_STORAGE);
    set((state) => ({ key: undefined, rejected: false, generation: state.generation + 1 }));
  },
  markRejected: () =>
    set((state) => (state.rejected ? state : { rejected: true, generation: state.generation + 1 })),
}));

/**
 * Other tabs share `localStorage` but not this store: follow their changes, so "Forget key" in one
 * tab signs every tab out (its event streams restart without the key) and a key entered in one
 * tab is used by all.
 */
export function syncApiKeyAcrossTabs(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== API_KEY_STORAGE && event.key !== null) return;
    useApiKeyStore.setState((state) => accept(state, read()));
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** Wrap a fetch so it sends the stored key and reports a 401 to the key store. */
export function withApiKey(fetch: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const { key } = useApiKeyStore.getState();
    if (key && !request.headers.has('authorization')) {
      request.headers.set('authorization', `Bearer ${key}`);
    }
    // A cancelled query can still deliver a response. Only reject the credentials it sent,
    // including an explicit bearer header, while they still belong to this browser.
    const sentKey = /^Bearer\s+(.+)$/i
      .exec(request.headers.get('authorization') ?? '')?.[1]
      ?.trim();
    const response = await fetch(request);
    const current = useApiKeyStore.getState();
    if (response.status === 401 && (current.key?.trim() || undefined) === sentKey)
      current.markRejected();
    return response;
  };
}
