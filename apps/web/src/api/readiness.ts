import type { HarnessReadinessState } from '@graphgoblin/contracts';
import { harnessDisplayName } from '@graphgoblin/domain';
import type { UseQueryResult } from '@tanstack/react-query';
import type { HarnessPreflightItem } from './queries.js';

/** A server readiness state, or `checking` while no result exists yet (client only). */
export type ReadinessView = HarnessReadinessState | 'checking';

/** What badges and help lines say for each state; the state itself goes in `data-state`. */
export const READINESS_LABEL: Record<ReadinessView, string> = {
  ready: 'Ready',
  checking: 'Checking…',
  unknown: 'Unknown',
  'cli-missing': 'CLI not found',
  'cli-incompatible': 'CLI update needed',
  auth: 'Sign-in needed',
  quota: 'Usage limit',
  transport: 'Connection failed',
};

export interface HarnessReadiness {
  state: ReadinessView;
  item: HarnessPreflightItem | undefined;
  /** The preflight request itself failed or is paused offline: no harness result is current. */
  lookupFailed: boolean;
  /** A background check is running; `state` stays the last result until it finishes. */
  rechecking: boolean;
}

/**
 * One harness's readiness from the shared preflight query. A background refetch keeps the last
 * result (a ready field stays editable while rechecking); a failed or paused lookup is `unknown`,
 * never the cached success; with no result yet the state is `checking`.
 */
export function harnessReadiness(
  query: UseQueryResult<HarnessPreflightItem[]>,
  harness: string,
): HarnessReadiness {
  const item = query.data?.find((entry) => entry.harness === harness);
  const lookupFailed = query.isError || query.fetchStatus === 'paused';
  return {
    state: lookupFailed
      ? 'unknown'
      : query.data === undefined
        ? 'checking'
        : (item?.state ?? 'unknown'),
    item,
    lookupFailed,
    rechecking: query.isFetching && query.data !== undefined,
  };
}

/** `Claude readiness: Sign-in needed.`, the short line used wherever a full problem would not fit. */
export function readinessLine(harness: string, readiness: HarnessReadiness): string {
  const name = harnessDisplayName(harness);
  if (readiness.lookupFailed) return `Could not check ${name} readiness.`;
  // The checking label already ends in an ellipsis.
  if (readiness.state === 'checking') return `${name} readiness: ${READINESS_LABEL.checking}`;
  return `${name} readiness: ${READINESS_LABEL[readiness.state]}.`;
}
