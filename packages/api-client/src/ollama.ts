import {
  OllamaConnectionViewSchema,
  OllamaDiscoveryStatusSchema,
  type OllamaConnectionUpdate,
} from '@graphgoblin/contracts';
import type { GraphGoblinClient } from './client.js';
import { GraphGoblinApiError } from './errors.js';

/** The same configured transport and error contract as the generated resource wrappers. */
async function request<T>(
  client: GraphGoblinClient,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  schema: { parse: (value: unknown) => T },
  body?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers(client.config.headers);
  headers.set('accept', 'application/json');
  if (body !== undefined) headers.set('content-type', 'application/json');
  // Node's fetch declaration omits the browser cache member. An explicit extension keeps
  // the browser's no-store policy while remaining structurally valid in either runtime.
  const init: RequestInit & { cache: 'no-store' } = {
    method,
    headers,
    cache: 'no-store',
    redirect: 'error',
    ...options,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  const input = new Request(`${client.config.baseUrl}${path}`, init);
  let response: Response;
  try {
    response = await client.config.fetch(input);
  } catch (error) {
    if (input.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
      throw error;
    if (error instanceof GraphGoblinApiError) throw error;
    throw GraphGoblinApiError.network(error);
  }
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw GraphGoblinApiError.fromResponse(response, value);
  return schema.parse(value);
}

export const ollama = {
  connection: (client: GraphGoblinClient, options: { signal?: AbortSignal } = {}) =>
    request(
      client,
      'GET',
      '/harness/ollama/connection',
      OllamaConnectionViewSchema,
      undefined,
      options,
    ),
  configure: (
    client: GraphGoblinClient,
    body: OllamaConnectionUpdate,
    options: { signal?: AbortSignal } = {},
  ) =>
    request(client, 'PUT', '/harness/ollama/connection', OllamaConnectionViewSchema, body, options),
  refresh: (client: GraphGoblinClient, options: { signal?: AbortSignal } = {}) =>
    request(
      client,
      'POST',
      '/model-catalog/refresh',
      OllamaDiscoveryStatusSchema,
      { harness: 'ollama' },
      options,
    ),
};
