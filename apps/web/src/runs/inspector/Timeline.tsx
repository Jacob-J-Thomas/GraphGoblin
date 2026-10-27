import type { LoopDefinition } from '@graphgoblin/contracts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input } from '../../components/ui/index.js';
import { cn } from '../../lib/utils.js';
import { describeEvent, describeParts } from '../projections.js';
import type { TimelineEvent } from '../event-store.js';
import type { StreamStatus } from '../useRunEvents.js';

const STREAM_LABEL: Record<StreamStatus, string> = {
  connecting: 'connecting…',
  live: 'live',
  finished: 'complete',
  error: 'stream error',
};
// Count-based row windowing avoids fixed-height assumptions for wrapped, accessible names.
export const TIMELINE_ROWS = 80;

/**
 * A paging control that stays focusable while it cannot act (`aria-disabled`, not `disabled`), so
 * activating it never drops keyboard focus to the page when it disables itself (#186).
 */
function PagingButton({
  off,
  onActivate,
  children,
  type = 'button',
}: {
  off: boolean;
  onActivate?: () => void;
  children: string;
  type?: 'button' | 'submit';
}) {
  return (
    <Button
      size="sm"
      type={type}
      aria-disabled={off ? true : undefined}
      onClick={(event) => {
        if (off) event.preventDefault();
        else onActivate?.();
      }}
    >
      {children}
    </Button>
  );
}
export function Timeline({
  events,
  status,
  error,
  selected,
  onSelect,
  definition,
  total = events.length,
  hasOlder = false,
  hasNewer = false,
  busy = false,
  following = true,
  onOlder,
  onNewer,
  onLive,
  onPause,
}: {
  events: TimelineEvent[];
  definition?: LoopDefinition | undefined;
  status: StreamStatus;
  error: string | undefined;
  selected: number | undefined;
  onSelect: (seq: number) => void;
  total?: number;
  hasOlder?: boolean;
  hasNewer?: boolean;
  busy?: boolean;
  following?: boolean;
  onOlder?: () => void;
  onNewer?: () => void;
  onLive?: () => void;
  onPause?: () => void;
}) {
  const [anchor, setAnchor] = useState<number>();
  const [active, setActive] = useState<number>();
  const [jump, setJump] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const focusRef = useRef<number | undefined>(undefined);
  const readerScrollingRef = useRef(false);
  useEffect(() => {
    const released = () => {
      readerScrollingRef.current = false;
    };
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', released);
    window.addEventListener('touchend', released);
    return () => {
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', released);
      window.removeEventListener('touchend', released);
    };
  }, []);
  const tail = Math.max(0, events.length - TIMELINE_ROWS);
  const anchorIndex =
    anchor === undefined ? tail : events.findIndex((event) => event.seq >= anchor);
  const start = following || anchor === undefined ? tail : Math.max(0, Math.min(tail, anchorIndex));
  const shown = events.slice(start, start + TIMELINE_ROWS);
  const end = start + shown.length;
  // One row is in the Tab order (the last focused, else the selected, else the newest shown), so
  // Tab and Shift+Tab leave the list in one step; arrows, Page Up/Down and Home/End move within.
  const mounted = (seq: number | undefined) => shown.some((event) => event.seq === seq);
  const tabStop = mounted(active) ? active : mounted(selected) ? selected : shown.at(-1)?.seq;
  const windowText = events.length
    ? `Showing events ${shown[0]?.seq}–${shown.at(-1)?.seq} of the retained window.`
    : 'No events loaded.';
  useLayoutEffect(() => {
    if (focusRef.current !== undefined) {
      listRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-seq="${focusRef.current}"]`)
        ?.focus();
      focusRef.current = undefined;
    }
    if (following && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  });
  function move(index: number) {
    const row = events[index];
    if (!row) return;
    onPause?.();
    setAnchor(events[Math.max(0, Math.min(index, events.length - TIMELINE_ROWS))]?.seq);
    focusRef.current = row.seq;
  }
  return (
    <Card
      flush
      title={`Timeline (${total} events, ${STREAM_LABEL[status]})`}
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
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs text-muted">
        <PagingButton
          off={!hasOlder || busy}
          onActivate={() => {
            onPause?.();
            setAnchor(0);
            onOlder?.();
          }}
        >
          Load older
        </PagingButton>
        <PagingButton
          off={start === 0 || busy}
          onActivate={() => move(Math.max(0, start - TIMELINE_ROWS))}
        >
          Previous rows
        </PagingButton>
        <PagingButton off={end >= events.length || busy} onActivate={() => move(end)}>
          Next rows
        </PagingButton>
        <PagingButton
          off={!hasNewer || busy}
          onActivate={() => {
            setAnchor(undefined);
            onNewer?.();
          }}
        >
          Load newer
        </PagingButton>
        <PagingButton
          off={following || busy}
          onActivate={() => {
            setAnchor(undefined);
            onLive?.();
          }}
        >
          Follow live
        </PagingButton>
        <span>{windowText}</span>
        {/* Announces what the reader changes (pausing, browsing, returning live), never each live
            append, which would repeat several times a second while following (#186). */}
        <span className="sr-only" aria-live="polite">
          {following ? 'Following live.' : `Following paused. ${windowText}`}
        </span>
      </div>
      <form
        className="flex items-center gap-2 px-4 py-2 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const seq = Number(jump);
          if (Number.isSafeInteger(seq) && seq > 0) {
            setAnchor(seq);
            onSelect(seq);
          }
        }}
      >
        <label>
          Event sequence{' '}
          <Input
            className="w-24"
            type="number"
            min="1"
            step="1"
            value={jump}
            onChange={(event) => setJump(event.target.value)}
          />
        </label>
        <PagingButton type="submit" off={busy}>
          Go to event
        </PagingButton>
      </form>
      <ol
        ref={listRef}
        className="max-h-[60vh] overflow-auto p-2"
        aria-label="Timeline"
        onPointerDown={() => {
          readerScrollingRef.current = true;
        }}
        onTouchMove={() => {
          readerScrollingRef.current = true;
        }}
        onWheel={(event) => {
          if (following && event.deltaY < 0 && event.currentTarget.scrollTop > 0) {
            setAnchor(shown[0]?.seq);
            onPause?.();
          }
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          // Fonts, layout and our own tail scrolling also emit scroll events. Only a reader's
          // scrollbar/touch gesture may pause retention here; wheel and keyboard act explicitly.
          if (
            readerScrollingRef.current &&
            following &&
            element.scrollTop + element.clientHeight < element.scrollHeight - 8
          ) {
            setAnchor(shown[0]?.seq);
            onPause?.();
          }
        }}
        onKeyDown={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLButtonElement)) return;
          const index = events.findIndex((row) => row.seq === Number(target.dataset['seq']));
          let next: number | undefined;
          if (event.key === 'ArrowDown') next = index + 1;
          if (event.key === 'ArrowUp') next = index - 1;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = events.length - 1;
          if (event.key === 'PageDown') next = Math.min(events.length - 1, index + TIMELINE_ROWS);
          if (event.key === 'PageUp') next = Math.max(0, index - TIMELINE_ROWS);
          if (next !== undefined && next >= 0 && next < events.length) {
            event.preventDefault();
            move(next);
          }
        }}
      >
        {shown.map((event) => (
          <li key={event.seq}>
            <button
              type="button"
              data-seq={event.seq}
              tabIndex={event.seq === tabStop ? 0 : -1}
              aria-current={event.seq === selected ? 'true' : undefined}
              aria-description={
                'uncached' in event
                  ? 'Select to load the exact event payload from the server.'
                  : undefined
              }
              className={cn(
                'grid w-full cursor-pointer grid-cols-[30px_auto_minmax(0,1fr)] items-center gap-2',
                'rounded-sm px-2 py-[5px] text-left text-sm text-default hover:bg-surface-hover pointer-coarse:min-h-11',
                'aria-[current=true]:bg-accent-subtle aria-[current=true]:shadow-current-row',
                'forced-colors:aria-[current=true]:outline',
              )}
              onFocus={() => {
                setActive(event.seq);
                setAnchor(shown[0]?.seq);
                onPause?.();
              }}
              onClick={() => {
                setAnchor(shown[0]?.seq);
                onSelect(event.seq);
              }}
            >
              <span className="text-right font-mono text-xs text-subtle">#{event.seq}</span>
              <code className="text-[12.5px] font-medium">{event.type}</code>
              <span className="min-w-0 break-words text-muted">
                {'uncached' in event ? (
                  <>
                    {describeParts(event.description, definition)}
                    <span aria-hidden="true"> - Load exact event payload</span>
                  </>
                ) : (
                  describeEvent(event, definition)
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
