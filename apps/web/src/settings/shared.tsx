import { EffortSchema, type Effort } from '@graphgoblin/contracts';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { HelpText } from '../components/ui/index.js';
import { errorMessage } from '../lib/utils.js';

export const EFFORTS = EffortSchema.options;

export type CatalogEntry = {
  harness: string;
  model: string;
  source: 'harness' | 'litellm';
  displayName: string;
  efforts: Effort[];
  defaultEffort: Effort;
  enabled: boolean;
};

export function useInvalidate() {
  const queryClient = useQueryClient();
  return (key: QueryKey) => void queryClient.invalidateQueries({ queryKey: key });
}

const CATALOG_ERRORS: Record<string, string> = {
  MODEL_MANAGED_BY_HARNESS: 'Harness models can only be enabled or disabled.',
  LITELLM_NOT_CONFIGURED: 'LiteLLM is not configured. Adding local models is not available yet.',
  MODEL_NOT_FOUND:
    'This model is no longer in the catalog. Refresh Settings to see the current models.',
};

export function MutationError({
  error,
  id,
  announce = false,
}: {
  error: unknown;
  id?: string;
  announce?: boolean;
}) {
  const message = error instanceof GraphGoblinApiError ? CATALOG_ERRORS[error.code] : undefined;
  return error ? (
    <HelpText id={id} tone="bad" role={announce ? 'alert' : undefined}>
      {message ?? errorMessage(error)}
    </HelpText>
  ) : null;
}

/** A row in a settings list: the item on the left, its actions on the right. */
export const LIST_ROW =
  'flex flex-wrap items-center justify-between gap-2 border-b border-default py-2 last:border-b-0';
