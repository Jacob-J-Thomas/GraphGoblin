import createClient, { type Client, type Middleware } from 'openapi-fetch';
import { GraphGoblinApiError } from './errors.js';
import type { components, paths } from './generated/schema.js';

export type { components, paths };

/** The fetch signature the client uses: one `Request` in, one `Response` out. */
export type FetchLike = (request: Request) => Promise<Response>;

/**
 * Which first-party client is calling. The API maps `ui` to the `manual.ui` invocation source and
 * `mcp` to `manual.mcp`; without it, runs started through the API are `manual.api` (docs/07).
 */
export type GraphGoblinClientKind = 'ui' | 'mcp';

export interface GraphGoblinClientOptions {
  /** The API origin, for example `http://127.0.0.1:4317`. A trailing slash is ignored. */
  baseUrl: string;
  /** Bearer API key. Omit in local trusted mode. */
  apiKey?: string;
  /** Custom fetch, for tests or runtimes without a global one. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Sent as `x-graphgoblin-client`. */
  client?: GraphGoblinClientKind;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

/** Connection settings the helpers that bypass openapi-fetch (the SSE stream) need. */
export interface GraphGoblinClientConfig {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetch: FetchLike;
}

/** The typed openapi-fetch client plus the settings it was built with. */
export type GraphGoblinClient = Client<paths> & { readonly config: GraphGoblinClientConfig };

function isAbort(error: unknown, request: Request): boolean {
  return request.signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

/**
 * A `fetch` rejection, a failure before any response headers arrived, surfaces as
 * `GraphGoblinApiError` with `status` 0 and `NETWORK_ERROR`; aborts pass through. openapi-fetch
 * calls `onError` for that rejection only: a body that fails after the headers arrived is read
 * later, so raw `client.GET` and the other methods surface that native error unchanged. Only
 * `runs.get` and `runs.observation` classify it, as `RESPONSE_INTERRUPTED` (see `readJson`).
 */
const networkErrors: Middleware = {
  onError({ error, request }) {
    if (isAbort(error, request) || error instanceof GraphGoblinApiError) return undefined;
    return GraphGoblinApiError.network(error);
  },
};

export function createGraphGoblinClient(options: GraphGoblinClientOptions): GraphGoblinClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { ...options.headers };
  if (options.apiKey) headers['authorization'] = `Bearer ${options.apiKey}`;
  if (options.client) headers['x-graphgoblin-client'] = options.client;
  const fetch: FetchLike = options.fetch ?? ((request) => globalThis.fetch(request));

  const client = createClient<paths>({ baseUrl, headers, fetch });
  client.use(networkErrors);
  return Object.assign(client, {
    config: Object.freeze({ baseUrl, headers: Object.freeze({ ...headers }), fetch }),
  });
}
