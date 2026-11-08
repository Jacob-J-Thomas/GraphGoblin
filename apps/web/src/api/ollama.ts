import { ollama } from '@graphgoblin/api-client';
import type { OllamaConnectionView } from '@graphgoblin/contracts';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApi } from './context.js';
import { keys, refreshCatalogState } from './queries.js';

export const ollamaConnectionKey = ['ollama-connection'] as const;

/** Background discovery is gateway-owned; this query only observes its current snapshot. */
export function useOllamaConnection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const previousRef = useRef<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ollamaConnectionKey,
    queryFn: ({ signal }) => ollama.connection(client, { signal }),
    refetchInterval: (query) =>
      query.state.data?.discovery.state === 'refreshing' ? 5_000 : 30_000,
  });
  const revision = query.data?.connection.revision;
  const success = query.data?.discovery.lastSuccessAt;
  useEffect(() => {
    if (revision === undefined) return;
    const snapshot = JSON.stringify([revision, success]);
    if (previousRef.current !== undefined && previousRef.current !== snapshot) {
      void Promise.all([
        refreshCatalogState(queryClient),
        queryClient.invalidateQueries({ queryKey: keys.preflight, exact: true }),
      ]);
    }
    previousRef.current = snapshot;
  }, [queryClient, revision, success]);
  return query;
}

/** A completed explicit lifecycle action replaces an older observation before refreshing picks. */
export async function refreshOllamaState(
  queryClient: QueryClient,
  connection?: OllamaConnectionView,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ollamaConnectionKey, exact: true });
  if (connection) queryClient.setQueryData(ollamaConnectionKey, connection);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ollamaConnectionKey, exact: true }),
    queryClient.invalidateQueries({ queryKey: keys.preflight, exact: true }),
    refreshCatalogState(queryClient),
  ]);
}
