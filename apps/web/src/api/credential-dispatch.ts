import {
  createGraphGoblinClient,
  GraphGoblinApiError,
  type GraphGoblinClient,
} from '@graphgoblin/api-client';

/**
 * The accepted credential state a write was chosen under (#562): the API-key store's opaque
 * generation and whether that state was a rejection, never the key itself. Every acceptance,
 * replacement, forgetting and rejection is a new generation, so two equal credentials are the same
 * accepted state; the same key saved again while accepted keeps it.
 */
export interface Credential {
  readonly generation: number;
  readonly rejected: boolean;
}

/**
 * A write chosen under one credential reached dispatch under another, so it was not sent. Thrown
 * by the API-key fetch in the step that reads the key it would send, before `fetch` is called.
 */
export class CredentialChangedError extends Error {
  override readonly name = 'CredentialChangedError';
  constructor() {
    super("Not sent: this browser's API key changed before the request was sent.");
  }
}

const expected = new WeakMap<Request, Credential>();

/** The credential `request` may only be sent under, when a bound client sent it. */
export function expectedCredential(request: Request): Credential | undefined {
  return expected.get(request);
}

/**
 * `client` sending each request only under `credential`. The app client's API-key fetch
 * (`withApiKey`) compares it with the accepted credential in the same synchronous step that reads
 * the key to send, after every queued, mutation and middleware await, and refuses with
 * {@link CredentialChangedError} without calling `fetch`. `client` must be the app client from
 * `createAppClient`.
 */
export function bindCredential(
  client: GraphGoblinClient,
  credential: Credential,
): GraphGoblinClient {
  const { baseUrl, headers, fetch } = client.config;
  return createGraphGoblinClient({
    baseUrl,
    headers: { ...headers },
    fetch: (request) => {
      expected.set(request, credential);
      return fetch(request);
    },
  });
}

/**
 * Run `send` with `client` bound to `credential` (unbound without one). A write refused at
 * dispatch rejects with {@link CredentialChangedError} itself: the typed client reports anything
 * its fetch throws as a transport failure, but this one was never sent.
 */
export async function sendUnder<T>(
  client: GraphGoblinClient,
  credential: Credential | undefined,
  send: (client: GraphGoblinClient) => Promise<T>,
): Promise<T> {
  if (!credential) return send(client);
  try {
    return await send(bindCredential(client, credential));
  } catch (error) {
    if (error instanceof GraphGoblinApiError && error.cause instanceof CredentialChangedError)
      throw error.cause;
    throw error;
  }
}
