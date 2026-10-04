import type { RunStatus } from '@graphgoblin/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { cn, errorMessage, isOfflineError } from '../lib/utils.js';
import { StatusIcon } from './icons/index.js';
import { Alert, Badge, type Tone } from './ui/index.js';

/** Colour-blind-safe tones (blue for success, orange for failure), always with an icon. */
const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  queued: 'neutral',
  running: 'info',
  waiting: 'warn',
  paused: 'warn',
  succeeded: 'good',
  failed: 'bad',
  cancelled: 'neutral',
  exhausted: 'bad',
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const running = status === 'running';
  return (
    <Badge
      tone={RUN_STATUS_TONE[status]}
      data-status={status}
      className={cn(running && 'glow-running')}
    >
      <StatusIcon status={status} className={cn(running && 'animate-pulse-soft')} />
      {status}
    </Badge>
  );
}

/** The backend could not be reached: say so plainly instead of showing an empty screen. */
export function OfflineState({ what }: { what: string }) {
  return (
    <Alert tone="warn" title="Offline">
      {what} needs the GraphGoblin API, which cannot be reached right now. The app shell keeps
      working and unsaved editor drafts are kept on this device.
    </Alert>
  );
}

export function ErrorState({ error, what }: { error: unknown; what: string }) {
  if (isOfflineError(error)) return <OfflineState what={what} />;
  return <Alert title={`Could not load ${what.toLowerCase()}`}>{errorMessage(error)}</Alert>;
}

/** Loading, error, and offline handling for one query; renders `children` with the data. */
export function QueryState<T>({
  query,
  what,
  children,
}: {
  query: UseQueryResult<T>;
  what: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <p className="text-sm text-muted">Loading {what.toLowerCase()}…</p>;
  if (query.isError) return <ErrorState error={query.error} what={what} />;
  return <>{children(query.data)}</>;
}
