import { EffortSchema, type Effort } from '@graphgoblin/contracts';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useId, useRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../components/icons/index.js';
import { HelpText, Switch } from '../components/ui/index.js';
import { focusFallback, restoreFocusAfterRemoval } from '../lib/focus.js';
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

/** What a refused toggle knows about where keyboard focus was. */
export interface ToggleFailure {
  /**
   * The switch, when it had focus as it was activated; otherwise null. A list refresh may remove
   * its row before the refusal arrives, so the switch is captured at activation rather than read
   * from `document.activeElement` when the error lands (the page body by then).
   */
  opener: HTMLElement | null;
}

/** Keep keyboard focus during a save; only the pending control is optimistic. */
export function EnableSwitch({
  name,
  enabled,
  onToggle,
  messages,
  onError,
  description,
}: {
  name: string;
  enabled: boolean;
  onToggle: (next: boolean) => Promise<unknown>;
  messages?: MutationMessages | undefined;
  onError?: (error: unknown, failure: ToggleFailure) => void | Promise<unknown>;
  /** Help under the switch that also describes it, such as what disabling it stops. */
  description?: ReactNode;
}) {
  const id = useId();
  const pendingRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const toggle = useMutation({
    mutationFn: onToggle,
    onError: (error) => onError?.(error, { opener: openerRef.current }),
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  const checked = toggle.isPending ? toggle.variables : enabled;
  const describedBy = [
    `${id}-status`,
    description ? `${id}-help` : '',
    toggle.error ? `${id}-error` : '',
  ].filter(Boolean);
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-switch`}
          aria-label={`Enable ${name}`}
          aria-describedby={describedBy.join(' ')}
          aria-busy={toggle.isPending}
          aria-disabled={toggle.isPending}
          checked={checked}
          onCheckedChange={(next) => {
            if (pendingRef.current) return;
            pendingRef.current = true;
            const self = document.getElementById(`${id}-switch`);
            openerRef.current = self !== null && document.activeElement === self ? self : null;
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
      {description ? (
        <HelpText id={`${id}-help`} className="max-w-[24ch]">
          {description}
        </HelpText>
      ) : null}
      <MutationError id={`${id}-error`} error={toggle.error} messages={messages} announce />
    </div>
  );
}

/**
 * After a refused toggle's list refresh: when the switch had focus at activation and its row has
 * since disappeared (keyboard focus fell to the page body), focus the section's heading. A
 * deliberate move to another control, or a switch still on the page, keeps focus where it is.
 */
export function restoreVanishedToggleFocus(
  { opener }: ToggleFailure,
  heading: HTMLElement | null,
  refresh?: Promise<unknown>,
): void {
  if (!opener || !heading) return;
  restoreFocusAfterRemoval({
    opener,
    scope: heading.closest<HTMLElement>('section') ?? heading,
    target: () => heading,
    refresh,
  });
}

/** The Secrets section's id on the Settings page, the target of `SecretsLink`. */
export const SECRETS_SECTION = 'secrets';

/**
 * A link to the Secrets section on the Settings page. Following it scrolls there and moves keyboard
 * focus to the section's heading, so the next Tab reaches its Name field.
 */
export function SecretsLink({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={`#${SECRETS_SECTION}`}
      className="touch-target font-medium text-link underline underline-offset-[3px]"
      onClick={(event) => {
        const heading = document.getElementById(SECRETS_SECTION)?.querySelector('h2') ?? null;
        if (!heading) return;
        event.preventDefault();
        heading.scrollIntoView({ block: 'start' });
        focusFallback(heading);
      }}
    >
      {children}
    </a>
  );
}

/** A row in a settings list: the item on the left, its actions on the right. */
export const LIST_ROW =
  'flex flex-wrap items-center justify-between gap-2 border-b border-default py-2 last:border-b-0';
