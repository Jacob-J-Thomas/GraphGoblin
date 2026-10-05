import { EffortSchema, type Effort } from '@graphgoblin/contracts';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useId, useRef } from 'react';
import { Icon } from '../components/icons/index.js';
import { HelpText, Switch } from '../components/ui/index.js';
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

export type MutationMessages = Readonly<Record<string, string>>;

export function MutationError({
  error,
  id,
  announce = false,
  messages,
}: {
  error: unknown;
  id?: string;
  announce?: boolean;
  messages?: MutationMessages | undefined;
}) {
  const message =
    error instanceof GraphGoblinApiError && messages && Object.hasOwn(messages, error.code)
      ? messages[error.code]
      : undefined;
  return error ? (
    <HelpText id={id} tone="bad" role={announce ? 'alert' : undefined}>
      {message ?? errorMessage(error)}
    </HelpText>
  ) : null;
}

/** Keep keyboard focus during a save; only the pending control is optimistic. */
export function EnableSwitch({
  name,
  enabled,
  onToggle,
  messages,
  onError,
}: {
  name: string;
  enabled: boolean;
  onToggle: (next: boolean) => Promise<unknown>;
  messages?: MutationMessages;
  onError?: (error: unknown) => void | Promise<unknown>;
}) {
  const id = useId();
  const pendingRef = useRef(false);
  const toggle = useMutation({
    mutationFn: onToggle,
    onError: (error) => onError?.(error),
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  const checked = toggle.isPending ? toggle.variables : enabled;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-switch`}
          aria-label={`Enable ${name}`}
          aria-describedby={`${id}-status${toggle.error ? ` ${id}-error` : ''}`}
          aria-busy={toggle.isPending}
          aria-disabled={toggle.isPending}
          checked={checked}
          onCheckedChange={(next) => {
            if (pendingRef.current) return;
            pendingRef.current = true;
            toggle.mutate(next);
          }}
        />
        <span id={`${id}-status`} role="status" aria-atomic="true" className="text-xs text-muted">
          <span className="sr-only">{name}:</span>{' '}
          {toggle.isPending ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="wait" />
              {checked ? 'Enabling…' : 'Disabling…'}
            </span>
          ) : enabled ? (
            'Enabled'
          ) : (
            'Disabled'
          )}
        </span>
      </div>
      <MutationError id={`${id}-error`} error={toggle.error} messages={messages} announce />
    </div>
  );
}

/** A row in a settings list: the item on the left, its actions on the right. */
export const LIST_ROW =
  'flex flex-wrap items-center justify-between gap-2 border-b border-default py-2 last:border-b-0';
