import { EffortSchema, type Effort } from '@graphgoblin/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { HelpText } from '../components/ui/index.js';
import { errorMessage } from '../lib/utils.js';

export const EFFORTS = EffortSchema.options;

export type CatalogEntry = {
  harness: string;
  model: string;
  displayName: string;
  efforts: Effort[];
  defaultEffort: Effort;
  enabled: boolean;
};

export function useInvalidate() {
  const queryClient = useQueryClient();
  return (key: QueryKey) => void queryClient.invalidateQueries({ queryKey: key });
}

export function MutationError({ error }: { error: unknown }) {
  return error ? <HelpText tone="bad">{errorMessage(error)}</HelpText> : null;
}

/** A native checkbox in the accent colour (the switch and toggle chips are #8). */
export const CHECKBOX = 'size-4 cursor-pointer accent-accent';

/** A row in a settings list: the item on the left, its actions on the right. */
export const LIST_ROW =
  'flex flex-wrap items-center justify-between gap-2 border-b border-default py-2 last:border-b-0';
