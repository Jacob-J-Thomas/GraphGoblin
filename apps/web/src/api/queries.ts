import {
  apiKeys,
  events,
  loops,
  modelCatalog,
  runs,
  secrets,
  settings,
  system,
  type ListRunsQuery,
} from '@graphgoblin/api-client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './context.js';

/** Query keys, so mutations can invalidate exactly what they change. */
export const keys = {
  loops: ['loops'] as const,
  loop: (id: string) => ['loops', id] as const,
  /** Under the loop's key, so invalidating the loop (after a publish) refetches them too. */
  versions: (id: string) => ['loops', id, 'versions'] as const,
  runs: (query: ListRunsQuery = {}) => ['runs', 'list', query] as const,
  run: (id: string) => ['runs', 'one', id] as const,
  thread: (id: string) => ['runs', 'thread', id] as const,
  settings: ['settings'] as const,
  catalog: ['model-catalog'] as const,
  secrets: ['secrets'] as const,
  apiKeys: ['api-keys'] as const,
  preflight: ['preflight'] as const,
  events: ['events'] as const,
};

export function useLoops() {
  const client = useApi();
  return useQuery({ queryKey: keys.loops, queryFn: () => loops.list(client) });
}

export function useLoop(id: string) {
  const client = useApi();
  return useQuery({ queryKey: keys.loop(id), queryFn: () => loops.get(client, id) });
}

export function useLoopVersions(id: string) {
  const client = useApi();
  return useQuery({ queryKey: keys.versions(id), queryFn: () => loops.versions(client, id) });
}

export function useRuns(query: ListRunsQuery = {}, refetchInterval: number | false = false) {
  const client = useApi();
  return useQuery({
    queryKey: keys.runs(query),
    queryFn: () => runs.list(client, query),
    refetchInterval,
  });
}

export function useRun(id: string) {
  const client = useApi();
  return useQuery({ queryKey: keys.run(id), queryFn: () => runs.get(client, id) });
}

export function useRunThread(id: string) {
  const client = useApi();
  return useQuery({ queryKey: keys.thread(id), queryFn: () => runs.thread(client, id) });
}

export function useSettings() {
  const client = useApi();
  return useQuery({ queryKey: keys.settings, queryFn: () => settings.get(client) });
}

export function useModelCatalog() {
  const client = useApi();
  return useQuery({ queryKey: keys.catalog, queryFn: () => modelCatalog.list(client) });
}

export function useSecrets() {
  const client = useApi();
  return useQuery({ queryKey: keys.secrets, queryFn: () => secrets.list(client) });
}

export function useApiKeys() {
  const client = useApi();
  return useQuery({ queryKey: keys.apiKeys, queryFn: () => apiKeys.list(client) });
}

export function usePreflight() {
  const client = useApi();
  return useQuery({ queryKey: keys.preflight, queryFn: () => system.preflight(client) });
}

export function useInboundEvents() {
  const client = useApi();
  return useQuery({ queryKey: keys.events, queryFn: () => events.list(client) });
}
