import type { RunEvent } from '@graphgoblin/contracts';
import { Alert, Card } from '../../components/ui/index.js';
import { cn } from '../../lib/utils.js';
import { describeEvent } from '../projections.js';
import type { StreamStatus } from '../useRunEvents.js';

const STREAM_LABEL: Record<StreamStatus, string> = {
  connecting: 'connecting…',
  live: 'live',
  finished: 'complete',
  error: 'stream error',
};

/** The run's events as they stream in; choosing one shows the thread at that point. */
export function Timeline({
  events,
  status,
  error,
  selected,
  onSelect,
}: {
  events: RunEvent[];
  status: StreamStatus;
  error: string | undefined;
  selected: number | undefined;
  onSelect: (seq: number) => void;
}) {
  return (
    <Card
      flush
      title={`Timeline (${events.length} events, ${STREAM_LABEL[status]})`}
      actions={
        status === 'live' ? (
          <span
            aria-hidden="true"
            className="glow-live size-[7px] animate-pulse-soft rounded-full bg-status-info-border"
          />
        ) : undefined
      }
    >
      {error ? (
        <div className="px-5 pt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <ol className="max-h-[60vh] overflow-auto p-2" aria-label="Timeline">
        {events.map((event) => (
          <li key={event.seq}>
            <button
              type="button"
              aria-current={event.seq === selected ? 'true' : undefined}
              className={cn(
                'grid w-full cursor-pointer grid-cols-[30px_auto_minmax(0,1fr)] items-center gap-2',
                'rounded-sm px-2 py-[5px] text-left text-sm text-default hover:bg-surface-hover',
                'aria-[current=true]:bg-accent-subtle aria-[current=true]:shadow-current-row',
                'forced-colors:aria-[current=true]:outline',
              )}
              onClick={() => onSelect(event.seq)}
            >
              <span className="text-right font-mono text-xs text-subtle">#{event.seq}</span>
              <code className="text-[12.5px] font-medium">{event.type}</code>
              <span className="min-w-0 break-words text-muted">{describeEvent(event)}</span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
