import type { ContextThread, LoopDefinition, RunEvent } from '@graphgoblin/contracts';
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  BoundedValue,
  Button,
  Card,
  CELL_PREVIEW_CHARS,
  Disclosure,
} from '../../components/ui/index.js';
import { downloadJson } from '../../lib/utils.js';
import { LARGE_HISTORY_BYTES } from '../event-store.js';
import {
  createThreadCache,
  initialThreadFrom,
  nodeName,
  patchDiff,
  type PatchLine,
} from '../projections.js';

/**
 * Messages laid out at once: the latest ones, which is where a reader looks at an event; the
 * rest, and an exact download of all of them, are one click away (#259). Fifty keeps a thread of
 * thousands of short messages from mounting tens of thousands of elements on every selection.
 */
export const MESSAGE_PREVIEW_COUNT = 50;
const count = (n: number) => n.toLocaleString('en-US');
const megabytes = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

/** A finished node's patch: each operation with the value before and after it. */
function PatchDiff({ nodeId, lines }: { nodeId: string; lines: PatchLine[] }) {
  return (
    <Card title={<span className="min-w-0 wrap-anywhere">Patch from {nodeId}</span>}>
      {lines.length === 0 ? <p className="text-xs text-muted">No changes.</p> : null}
      <ul className="grid gap-3" aria-label="Patch diff">
        {lines.map((line, i) => (
          <li key={i} className="overflow-hidden rounded-md border border-default">
            <div className="flex flex-wrap items-center gap-2 border-b border-default bg-surface-sunken px-3 py-2 text-sm">
              <Badge size="sm">{line.op}</Badge> <code className="wrap-anywhere">{line.path}</code>
              {line.from ? (
                <>
                  {' '}
                  from <code className="wrap-anywhere">{line.from}</code>
                </>
              ) : null}
            </div>
            <div className="grid sm:grid-cols-2">
              <div className="grid min-w-0 content-start bg-status-bad-bg">
                <span className="px-3 pt-2 text-xs font-semibold text-status-bad-fg">Before</span>
                <BoundedValue
                  value={line.before}
                  label={`Value before ${line.path}`}
                  labelled
                  tone="removed"
                  emptyText="(absent)"
                  previewChars={CELL_PREVIEW_CHARS}
                />
              </div>
              <div className="grid min-w-0 content-start bg-status-good-bg">
                <span className="px-3 pt-2 text-xs font-semibold text-status-good-fg">
                  {line.op === 'add' ? 'Added value' : 'After'}
                </span>
                <BoundedValue
                  value={line.after}
                  label={`Value after ${line.path}`}
                  labelled
                  tone="added"
                  emptyText="(absent)"
                  previewChars={CELL_PREVIEW_CHARS}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The thread as it stood after event `seq`, replayed client-side, and the patch that led there.
 * Every value is laid out within a bound (`BoundedValue`): a large variable, message or patch value
 * shows its first characters and offers the whole text and an exact download on request, so the
 * inspector's controls stay responsive whatever the thread holds (#259). The full thread JSON is
 * built only while its disclosure is open.
 */
export function ThreadViewer({
  current,
  events,
  seq,
  definition,
  historyBytes = 0,
}: {
  current: ContextThread;
  events: RunEvent[];
  seq: number;
  definition?: LoopDefinition | undefined;
  /** Recorded size of the run's events (`RunEventLog.bytes`); decides the large-history mode. */
  historyBytes?: number;
}) {
  // The initial thread depends on the first event only; a growing log must not rebuild it.
  const first = events[0];
  const initial = useMemo(
    () => initialThreadFrom(current, first ? [first] : [], definition),
    [current, first, definition],
  );
  const [cache] = useState(createThreadCache);
  // A large history (`LARGE_HISTORY_BYTES`) is reconstructed on request only, so a selection or a
  // live event costs a constant until the reader asks. An event is ready while the cache still
  // holds its reconstruction (and the one before it, for a patch diff): the cache keeps the last
  // 32, so an event asked for long ago asks again rather than being rebuilt unasked.
  const large = historyBytes > LARGE_HISTORY_BYTES;
  const [, setPrepared] = useState(0);
  // A newly selected event is otherwise reconstructed in the deferred render after the urgent one,
  // so the selection paints (the title and a note) before a thread is rebuilt; the remembered
  // threads make most selections immediate anyway.
  const deferredSeq = useDeferredValue(seq);
  const shownSeq = large ? seq : deferredSeq;
  const reconstructing = shownSeq !== seq;
  const selected = events.find((e) => e.seq === shownSeq);
  const withDiff = selected?.type === 'node.finished';
  const ready =
    !large ||
    (cache.has(initial, events, shownSeq) &&
      (!withDiff || cache.has(initial, events, shownSeq - 1)));
  const replayed = useMemo(
    () => (ready ? cache.at(initial, events, shownSeq) : undefined),
    [ready, cache, initial, events, shownSeq],
  );
  const diff = useMemo(() => {
    if (selected?.type !== 'node.finished' || !replayed?.ok) return undefined;
    const before = cache.at(initial, events, shownSeq - 1);
    return before.ok ? patchDiff(before.thread, replayed.thread, selected.patch) : undefined;
  }, [selected, cache, initial, events, shownSeq, replayed]);
  const [showJson, setShowJson] = useState(false);
  const thread = replayed?.ok ? replayed.thread : undefined;
  // Whether every message is laid out. Like a value's expansion, it lasts while the same thread
  // stays shown: another event's thread starts bounded again (adjusted in the render that sees it).
  const [allMessagesState, setAllMessagesState] = useState(false);
  const [shownThread, setShownThread] = useState<unknown>(thread);
  // The keyboard may be inside the message list when a live event replaces the thread and the
  // window slides past the message that held it. Ownership is tracked by the section's focus
  // events so the render that sees the new thread knows it before the DOM changes; the list stays
  // focusable through that commit and the hand-off below puts the keyboard on the controls or the
  // list itself, as `BoundedValue` does for a value.
  const messagesRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const showAllRef = useRef<HTMLButtonElement>(null);
  const [ownsFocus, setOwnsFocus] = useState(false);
  const [holdsFocus, setHoldsFocus] = useState(false);
  const [handoffs, setHandoffs] = useState(0);
  // In large-history mode the card and the thread replace each other: when a live event's card
  // replaces a thread the keyboard was in, the keyboard goes to the card's button; when the reader
  // activates that button, the keyboard goes to the thread's controls (the hand-off below).
  // Ownership of the whole viewer is tracked by its focus events for the same reason as above.
  const rootRef = useRef<HTMLDivElement>(null);
  const reconstructRef = useRef<HTMLButtonElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [viewerOwnsFocus, setViewerOwnsFocus] = useState(false);
  // The card unmounts the messages section without a blur event: its ownership ends here.
  if (!ready && ownsFocus) {
    setOwnsFocus(false);
    setHoldsFocus(false);
  }
  if (shownThread !== thread) {
    setShownThread(thread);
    setAllMessagesState(false);
    if (ownsFocus) {
      setHoldsFocus(true);
      setHandoffs((n) => n + 1);
    }
  }
  const allMessages = allMessagesState && shownThread === thread;
  useLayoutEffect(() => {
    if (handoffs === 0) return;
    const section = messagesRef.current;
    const list = listRef.current;
    const inside = section !== null && section.contains(document.activeElement);
    // Without a messages section (a reconstruction that failed), the alert itself takes the
    // keyboard, so an activated control never leaves it on the body.
    if (!inside) (showAllRef.current ?? list ?? alertRef.current)?.focus();
    setHoldsFocus(document.activeElement === list);
  }, [handoffs]);
  useLayoutEffect(() => {
    if (ready || !viewerOwnsFocus) return;
    const root = rootRef.current;
    if (root !== null && !root.contains(document.activeElement)) reconstructRef.current?.focus();
  }, [ready, shownSeq, viewerOwnsFocus]);
  const viewerFocus = {
    ref: rootRef,
    onFocus: () => setViewerOwnsFocus(true),
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!rootRef.current?.contains(event.relatedTarget)) setViewerOwnsFocus(false);
    },
  };
  if (!ready) {
    return (
      <div {...viewerFocus}>
        <Card title={`Thread at event ${shownSeq}`}>
          <p className="text-sm text-muted">
            This run's history holds {megabytes(historyBytes)} of recorded events. Replaying them to
            rebuild the thread at an event can take a while, so it happens on request.
          </p>
          <p>
            <Button
              ref={reconstructRef}
              size="sm"
              onClick={() => {
                // The replay happens here, on request; the render that follows finds it cached.
                cache.at(initial, events, shownSeq);
                if (withDiff) cache.at(initial, events, shownSeq - 1);
                setPrepared((n) => n + 1);
                // The button goes away with the card: the thread's controls take the keyboard.
                setHoldsFocus(true);
                setHandoffs((n) => n + 1);
              }}
            >{`Reconstruct the thread at event ${shownSeq}`}</Button>
          </p>
        </Card>
      </div>
    );
  }
  if (replayed === undefined || !replayed.ok || thread === undefined) {
    return (
      <div {...viewerFocus}>
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <Alert title={`The thread cannot be reconstructed at event ${shownSeq}`}>
            {replayed === undefined || replayed.ok ? '' : replayed.error}
          </Alert>
        </div>
      </div>
    );
  }
  const messages = thread.messages;
  const hidden = allMessages ? 0 : Math.max(0, messages.length - MESSAGE_PREVIEW_COUNT);
  const shownMessages = hidden > 0 ? messages.slice(hidden) : messages;
  return (
    <div className="grid gap-section" {...viewerFocus}>
      {diff ? (
        <PatchDiff
          nodeId={selected?.type === 'node.finished' ? nodeName(definition, selected.nodeId) : ''}
          lines={diff}
        />
      ) : null}
      <Card title={`Thread at event ${shownSeq}`}>
        {/* While the newly selected event's thread is rebuilt, the previous one stays mounted (so
            nothing loses the keyboard or its open state), keeps its own event's identifiers in its
            title and downloads, and says what is coming. */}
        {reconstructing ? (
          <p className="text-sm text-muted" aria-live="polite">
            Reconstructing the thread at event {seq}…
          </p>
        ) : null}
        <div className="grid gap-4" data-reconstructing={reconstructing ? 'true' : undefined}>
          <div
            ref={messagesRef}
            className="grid gap-2"
            onFocus={() => setOwnsFocus(true)}
            onBlur={(event) => {
              if (messagesRef.current?.contains(event.relatedTarget)) return;
              // The reader left the section: nothing is owed, and the list stops being focusable.
              setOwnsFocus(false);
              setHoldsFocus(false);
            }}
          >
            <h3 className="text-sm font-semibold">Messages ({count(messages.length)})</h3>
            {messages.length > MESSAGE_PREVIEW_COUNT ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>
                  {hidden > 0
                    ? `Showing the last ${count(MESSAGE_PREVIEW_COUNT)} of ${count(messages.length)} messages.`
                    : `Showing all ${count(messages.length)} messages.`}
                </span>
                <Button
                  ref={showAllRef}
                  size="sm"
                  aria-label={hidden > 0 ? 'Show all messages' : 'Show fewer messages'}
                  onClick={() => setAllMessagesState(hidden > 0)}
                >
                  {hidden > 0 ? 'Show all' : 'Show fewer'}
                </Button>
                <Button
                  size="sm"
                  aria-label="Download messages as JSON"
                  onClick={() =>
                    downloadJson(`run-${thread.run.id}-messages-at-${shownSeq}.json`, messages)
                  }
                >
                  Download JSON
                </Button>
              </p>
            ) : null}
            <ol
              ref={listRef}
              className="grid gap-2 text-md"
              aria-label="Messages"
              {...(holdsFocus ? { tabIndex: -1, onBlur: () => setHoldsFocus(false) } : {})}
            >
              {shownMessages.map((m) => (
                <li key={m.id} className="grid min-w-0 gap-1 rounded-md border border-default p-3">
                  <div className="flex items-center gap-2">
                    <Badge size="sm">{m.role}</Badge>{' '}
                    <code className="min-w-0 text-xs wrap-anywhere text-muted">
                      {m.nodeId ? nodeName(definition, m.nodeId) : 'Node not recorded'}
                    </code>
                  </div>
                  <BoundedValue
                    value={m.content}
                    text
                    tone="plain"
                    label={`Message ${m.id} content`}
                    className="-mx-3"
                  />
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Variables</h3>
            <BoundedValue
              value={thread.vars}
              label="Variables"
              labelled
              fileName={`run-${thread.run.id}-variables-at-${shownSeq}`}
            />
          </div>
          <Disclosure
            label={<span className="font-semibold">Full thread JSON</span>}
            variant="row"
            open={showJson}
            onOpenChange={setShowJson}
          >
            {showJson ? (
              <BoundedValue
                value={thread}
                label="Full thread JSON"
                testId="thread-json"
                fileName={`run-${thread.run.id}-thread-at-${shownSeq}`}
              />
            ) : null}
          </Disclosure>
        </div>
      </Card>
    </div>
  );
}
