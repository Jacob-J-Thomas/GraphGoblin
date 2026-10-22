import type { ContextThread, LoopDefinition, RunEvent } from '@graphgoblin/contracts';
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  BoundedValue,
  Card,
  CELL_PREVIEW_CHARS,
  Disclosure,
} from '../../components/ui/index.js';
import { createThreadCache, initialThreadFrom, patchDiff, type PatchLine } from '../projections.js';

/** A finished node's patch: each operation with the value before and after it. */
function PatchDiff({ nodeId, lines }: { nodeId: string; lines: PatchLine[] }) {
  return (
    <Card title={`Patch from ${nodeId}`}>
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
                <span className="px-3 pt-2 text-xs font-semibold text-status-good-fg">After</span>
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
}: {
  current: ContextThread;
  events: RunEvent[];
  seq: number;
  definition?: LoopDefinition | undefined;
}) {
  // The initial thread depends on the first event only; a growing log must not rebuild it.
  const first = events[0];
  const initial = useMemo(
    () => initialThreadFrom(current, first ? [first] : [], definition),
    [current, first, definition],
  );
  const [cache] = useState(createThreadCache);
  const replayed = useMemo(() => cache.at(initial, events, seq), [cache, initial, events, seq]);
  const selected = events.find((e) => e.seq === seq);
  const diff = useMemo(() => {
    if (selected?.type !== 'node.finished' || !replayed.ok) return undefined;
    const before = cache.at(initial, events, seq - 1);
    return before.ok ? patchDiff(before.thread, replayed.thread, selected.patch) : undefined;
  }, [selected, cache, initial, events, seq, replayed]);
  const [showJson, setShowJson] = useState(false);
  if (!replayed.ok) {
    return (
      <Alert title={`The thread cannot be reconstructed at event ${seq}`}>{replayed.error}</Alert>
    );
  }
  const thread = replayed.thread;
  return (
    <div className="grid gap-section">
      {diff ? (
        <PatchDiff
          nodeId={selected?.type === 'node.finished' ? selected.nodeId : ''}
          lines={diff}
        />
      ) : null}
      <Card title={`Thread at event ${seq}`}>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Messages ({thread.messages.length})</h3>
            <ol className="grid gap-2 text-md" aria-label="Messages">
              {thread.messages.map((m) => (
                <li key={m.id} className="grid min-w-0 gap-1 rounded-md border border-default p-3">
                  <div className="flex items-center gap-2">
                    <Badge size="sm">{m.role}</Badge>{' '}
                    <code className="text-xs text-muted">{m.nodeId}</code>
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
              fileName={`run-${thread.run.id}-variables-at-${seq}`}
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
                fileName={`run-${thread.run.id}-thread-at-${seq}`}
              />
            ) : null}
          </Disclosure>
        </div>
      </Card>
    </div>
  );
}
