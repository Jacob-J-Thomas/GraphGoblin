import type { RunStatus } from '@graphgoblin/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { Alert, Badge } from './ui.js';

/** Colour-blind-safe tones (blue for success, orange for failure) plus a text glyph. */
const RUN_STATUS: Record<
  RunStatus,
  { tone: 'neutral' | 'good' | 'bad' | 'warn' | 'info'; glyph: string }
> = {
  queued: { tone: 'neutral', glyph: '…' },
  running: { tone: 'info', glyph: '▶' },
  waiting: { tone: 'warn', glyph: '⏸' },
  paused: { tone: 'warn', glyph: '‖' },
  succeeded: { tone: 'good', glyph: '✓' },
  failed: { tone: 'bad', glyph: '✗' },
  cancelled: { tone: 'neutral', glyph: '⊘' },
  exhausted: { tone: 'bad', glyph: '↻' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { tone, glyph } = RUN_STATUS[status];
  return (
    <Badge tone={tone} data-status={status}>
      <span aria-hidden="true">{glyph}</span>
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
  if (query.isPending)
    return <p className="text-sm text-slate-500">Loading {what.toLowerCase()}…</p>;
  if (query.isError) return <ErrorState error={query.error} what={what} />;
  return <>{children(query.data)}</>;
}
