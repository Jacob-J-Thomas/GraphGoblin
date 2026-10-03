import {
  createGraphGoblinClient,
  type FetchLike,
  type GraphGoblinClient,
} from '@graphgoblin/api-client';
import { createContext, use, type ReactNode } from 'react';
import { withApiKey } from './api-key.js';

/**
 * The one API client for the app. It identifies itself as the UI (`x-graphgoblin-client: ui`) so
 * runs started here carry the `manual.ui` invocation source, and sends the browser's stored API
 * key, if any, on every request and event stream.
 */
export function createAppClient(baseUrl: string, fetch?: FetchLike): GraphGoblinClient {
  const base: FetchLike = fetch ?? ((request) => globalThis.fetch(request));
  return createGraphGoblinClient({ baseUrl, client: 'ui', fetch: withApiKey(base) });
}

const ApiContext = createContext<GraphGoblinClient | null>(null);

export function ApiProvider({
  client,
  children,
}: {
  client: GraphGoblinClient;
  children: ReactNode;
}) {
  return <ApiContext value={client}>{children}</ApiContext>;
}

export function useApi(): GraphGoblinClient {
  const client = use(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}
