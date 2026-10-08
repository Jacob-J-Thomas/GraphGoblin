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
  templates,
  type ListRunsQuery,
} from '@graphgoblin/api-client';
import type {
  ClassifierModelSummary,
  LoopDefinitionInput,
  ModelCatalogEntry,
  TemplateSettings,
} from '@graphgoblin/contracts';
import { HarnessPreflightSchema } from '@graphgoblin/contracts';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useApi } from './context.js';

const HarnessPreflightItemSchema = HarnessPreflightSchema.extend({ harness: z.string() });
export type HarnessPreflightItem = z.infer<typeof HarnessPreflightItemSchema>;

/** Query keys, so mutations can invalidate exactly what they change. */
export const keys = {
  loops: ['loops'] as const,
  templates: ['templates'] as const,
  template: (id: string) => ['templates', id] as const,
  templateInstance: (id: string) => ['template-instances', id] as const,
  loop: (id: string) => ['loops', id] as const,
  /** Under the loop's key, so invalidating the loop (after a publish) refetches them too. */
  versions: (id: string) => ['loops', id, 'versions'] as const,
  version: (loopId: string, versionId: string) => ['loops', loopId, 'version', versionId] as const,
  /**
   * The API's checks of a saved draft (`POST /loops/{id}/validate`), keyed by what they read: the
   * draft (its server draft token, a hash of its content, or `draftContentKey` when there is no
   * token) and the catalogs (`catalogFingerprint`), which change without a draft edit.
   */
  validation: (id: string, draft: string, catalogs: string) =>
    ['loops', id, 'validate', draft, catalogs] as const,
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

export function useTemplates() {
  const client = useApi();
  return useQuery({ queryKey: keys.templates, queryFn: () => templates.list(client) });
}

export function useTemplate(id: string) {
  const client = useApi();
  return useQuery({
    queryKey: keys.template(id),
    queryFn: () => templates.get(client, id),
    enabled: id.length > 0,
  });
}

export function useTemplateInstance(id: string) {
  const client = useApi();
  return useQuery({
    queryKey: keys.templateInstance(id),
    queryFn: () => templates.instance(client, id),
    enabled: id.length > 0,
  });
}

export function useCheckTemplatePrerequisites() {
  const client = useApi();
  return useMutation({
    mutationFn: ({ templateId, settings }: { templateId: string; settings: TemplateSettings }) =>
      templates.prerequisites(client, templateId, { settings }),
  });
}

export function useInstantiateTemplate() {
  const client = useApi();
  return useMutation({
    mutationFn: ({ templateId, settings }: { templateId: string; settings: TemplateSettings }) =>
      templates.instantiate(client, templateId, { settings }),
  });
}

export function useLoop(id: string) {
  const client = useApi();
  return useQuery({ queryKey: keys.loop(id), queryFn: () => loops.get(client, id) });
}

export function useLoopVersions(id: string) {
  const client = useApi();
  return useQuery({ queryKey: keys.versions(id), queryFn: () => loops.versions(client, id) });
}

/** The immutable version a run actually used; an unavailable version stays unavailable. */
export function useLoopVersion(loopId: string, versionId: string, enabled = true) {
  const client = useApi();
  return useQuery({
    queryKey: keys.version(loopId, versionId),
    queryFn: () => loops.version(client, loopId, versionId),
    enabled: enabled && loopId !== '' && versionId !== '',
  });
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

type ModelFields = Pick<
  ModelCatalogEntry,
  'harness' | 'model' | 'enabled' | 'efforts' | 'defaultEffort'
>;

/**
 * What the API's checks read from the catalogs, as a string for a query key. From the LLM model
 * catalog (`MODEL_DISABLED`, `MODEL_NOT_IN_CATALOG`): each entry's harness and model id, enabled
 * state, efforts, and default effort. From the classifier catalog: each entry's id, display name
 * (in the messages), capabilities, enabled and configured state, and the reason it is not
 * configured (which names its secret). A refetch that finds the same catalogs gives the same
 * string, so it does not run the checks again; any change the checks would report gives a new one.
 * A catalog not loaded (yet, or after a failed load) is unknown (`null`), not empty, so its loading
 * is a change too.
 */
export function catalogFingerprint(
  models: readonly ModelFields[] | undefined,
  classifiers: readonly ClassifierModelSummary[] | undefined,
): string {
  return JSON.stringify([
    models?.map((e) => [e.harness, e.model, e.enabled, e.efforts, e.defaultEffort]) ?? null,
    classifiers?.map((e) => [
      e.id,
      e.displayName,
      e.primitives,
      e.enabled,
      e.configured,
      e.configurationReason ?? '',
    ]) ?? null,
  ]);
}

/** The catalogs' fingerprint as the query cache holds them now. */
export function cachedCatalogFingerprint(queryClient: QueryClient): string {
  return catalogFingerprint(
    queryClient.getQueryData<ModelFields[]>(keys.catalog),
    queryClient.getQueryData<ClassifierModelSummary[]>(keys.classifiers),
  );
}

/**
 * A key for a definition's content, for the API's checks when the server gave no draft token (the
 * token is itself a hash of the server draft): 53-bit FNV-1a over its JSON, in base 36.
 */
export function draftContentKey(definition: LoopDefinitionInput): string {
  const text = JSON.stringify(definition);
  let high = 0x811c9dc5;
  let low = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    high = Math.imul(high ^ code, 0x01000193);
    low = Math.imul(low ^ code, 0x01000193);
  }
  return `content:${((high >>> 0) * 0x200000 + ((low >>> 0) & 0x1fffff)).toString(36)}`;
}

/** Whether a query key is one of the editor's API checks (`keys.validation`). */
export function isValidationKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'loops' && queryKey[2] === 'validate';
}

/**
 * After a write to either catalog (a model's or a classifier's) or to a secret: refetch both
 * catalogs, and make the editor's API checks of saved drafts run again, since their catalog
 * warnings and errors follow the catalogs and the secrets the classifiers use.
 *
 * Checks still running are cancelled first: one that finishes after the write may have read the
 * new server state and would store it under the old catalogs' key (`keys.validation` holds the
 * fingerprint the check was issued for). Every check is then marked stale without being
 * refetched, so none runs against an out-of-date key; once the catalogs are back, the active
 * checks still stale under the resolved fingerprint run again. A new fingerprint may already
 * have been checked while the other catalog was loading; its fresh or in-flight check is kept.
 */
export async function refreshCatalogState(queryClient: QueryClient): Promise<void> {
  const validation = {
    predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => isValidationKey(queryKey),
  };
  await queryClient.cancelQueries(validation);
  await queryClient.invalidateQueries({ ...validation, refetchType: 'none' });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.catalog }),
    queryClient.invalidateQueries({ queryKey: keys.classifiers }),
  ]);
  const now = cachedCatalogFingerprint(queryClient);
  await queryClient.refetchQueries(
    {
      predicate: (query) =>
        isValidationKey(query.queryKey) &&
        query.queryKey[4] === now &&
        query.isStale() &&
        query.state.fetchStatus === 'idle',
      type: 'active',
    },
    { cancelRefetch: false },
  );
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
  return useQuery({
    queryKey: keys.preflight,
    queryFn: async () =>
      (await system.preflight(client)).map((item) => HarnessPreflightItemSchema.parse(item)),
  });
}

const PENDING_EVENT_REFRESH_MS = 2_000;

export function useInboundEvents() {
  const client = useApi();
  return useQuery({
    queryKey: keys.events,
    queryFn: () => events.list(client),
    refetchInterval: (query) =>
      query.state.data?.some((event) => event.delivery?.state === 'pending')
        ? PENDING_EVENT_REFRESH_MS
        : false,
  });
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
