import {
  apiKeys,
  classifierModels,
  cron,
  events,
  loops,
  modelCatalog,
  runs,
  secrets,
  settings,
  system,
  type ListRunsQuery,
} from '@graphgoblin/api-client';
import type { ClassifierModelSummary } from '@graphgoblin/contracts';
import { usePrefetchQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { useApi } from './context.js';

/** Query keys, so mutations can invalidate exactly what they change. */
export const keys = {
  loops: ['loops'] as const,
  loop: (id: string) => ['loops', id] as const,
  /** Under the loop's key, so invalidating the loop (after a publish) refetches them too. */
  versions: (id: string) => ['loops', id, 'versions'] as const,
  /**
   * The API's checks of a saved draft (`POST /loops/{id}/validate`), for one saved revision and
   * one state of the classifier catalog (`classifierFingerprint`): the classifier checks read the
   * catalog and its secrets, which change without a draft edit.
   */
  validation: (id: string, revision: number, classifiers: string) =>
    ['loops', id, 'validate', revision, classifiers] as const,
  runs: (query: ListRunsQuery = {}) => ['runs', 'list', query] as const,
  run: (id: string) => ['runs', 'one', id] as const,
  thread: (id: string) => ['runs', 'thread', id] as const,
  settings: ['settings'] as const,
  catalog: ['model-catalog'] as const,
  /** Classifier summaries: their configured state follows the secrets they reference. */
  classifiers: ['classifier-models'] as const,
  secrets: ['secrets'] as const,
  apiKeys: ['api-keys'] as const,
  preflight: ['preflight'] as const,
  events: ['events'] as const,
  cronPreview: (expression: string, timezone: string) =>
    ['cron-preview', expression, timezone] as const,
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

/** The owner's classifier models, built-in first, with each one's configured state. */
export function useClassifierModels() {
  const client = useApi();
  return useQuery({ queryKey: keys.classifiers, queryFn: () => classifierModels.list(client) });
}

/**
 * What the API's classifier checks read from the catalog, as a string for a query key: each
 * entry's id, display name (in the messages), capabilities, enabled and configured state, and the
 * reason it is not configured. A refetch that finds the same catalog gives the same string, so it
 * does not run the checks again; any change the checks would report gives a new one.
 */
export function classifierFingerprint(entries: readonly ClassifierModelSummary[] | undefined) {
  if (!entries) return '';
  return JSON.stringify(
    entries.map((e) => [
      e.id,
      e.displayName,
      e.primitives,
      e.enabled,
      e.configured,
      e.configurationReason ?? '',
    ]),
  );
}

/** Whether a query key is one of the editor's API checks (`keys.validation`). */
export function isValidationKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'loops' && queryKey[2] === 'validate';
}

/**
 * After a classifier or secret write: refetch the classifier summaries, and make the editor's API
 * checks of saved drafts run again, since their classifier warnings and errors follow the catalog
 * and its secrets.
 *
 * Checks still running are cancelled first: one that finishes after the write may have read the
 * new server state and would store it under the old catalog's key (`keys.validation` holds the
 * catalog fingerprint the check was issued for). Every check is then marked stale without being
 * refetched, so none runs against an out-of-date key; once the summaries are back, the active
 * checks already keyed by the catalog as it now is (a write the checks do not read) run again,
 * and the others run under their new key when the editor renders it.
 */
export async function refreshClassifierState(queryClient: QueryClient): Promise<void> {
  const validation = {
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => isValidationKey(queryKey),
  };
  await queryClient.cancelQueries(validation);
  await queryClient.invalidateQueries({ ...validation, refetchType: 'none' });
  await queryClient.invalidateQueries({ queryKey: keys.classifiers });
  const now = classifierFingerprint(
    queryClient.getQueryData<ClassifierModelSummary[]>(keys.classifiers),
  );
  await queryClient.refetchQueries({
    predicate: ({ queryKey }) => isValidationKey(queryKey) && queryKey[4] === now,
    type: 'active',
  });
}

/** Start the catalog request before a node dialog or the loop settings form opens. */
export function usePrefetchModelCatalog() {
  const client = useApi();
  usePrefetchQuery({ queryKey: keys.catalog, queryFn: () => modelCatalog.list(client) });
}

export function useSecrets() {
  const client = useApi();
  return useQuery({ queryKey: keys.secrets, queryFn: () => secrets.list(client) });
}

export function useApiKeys() {
  const client = useApi();
  return useQuery({
    queryKey: keys.apiKeys,
    queryFn: ({ signal }) => apiKeys.list(client, { signal }),
  });
}

export function usePreflight() {
  const client = useApi();
  return useQuery({ queryKey: keys.preflight, queryFn: () => system.preflight(client) });
}

export function useInboundEvents() {
  const client = useApi();
  return useQuery({ queryKey: keys.events, queryFn: () => events.list(client) });
}

/** The control enables this only once its expression and zone have stopped changing. */
export function useCronPreview(expression: string, timezone: string, enabled: boolean) {
  const client = useApi();
  return useQuery({
    queryKey: keys.cronPreview(expression, timezone),
    queryFn: ({ signal }) => cron.preview(client, { expression, timezone, count: 5 }, { signal }),
    enabled,
    retry: false,
    staleTime: 0,
  });
}
