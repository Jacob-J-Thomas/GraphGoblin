import type { ContextThread, RunEvent } from '@graphgoblin/contracts';
import { useMemo } from 'react';
import { Icon } from '../../components/icons/index.js';
import { Alert, Badge, Card } from '../../components/ui/index.js';
import { prettyJson } from '../../lib/utils.js';
import { initialThreadFrom, patchDiff, tryThreadAt, type PatchLine } from '../projections.js';

const PRE = 'm-0 px-3 py-2 font-mono text-[12.5px] leading-normal whitespace-pre-wrap break-words';

/** A finished node's patch: each operation with the value before and after it. */
function PatchDiff({ nodeId, lines }: { nodeId: string; lines: PatchLine[] }) {
  return (
    <Card title={`Patch from ${nodeId}`}>
      {lines.length === 0 ? <p className="text-xs text-muted">No changes.</p> : null}
      <ul className="grid gap-3" aria-label="Patch diff">
        {lines.map((line, i) => (
          <li key={i} className="overflow-hidden rounded-md border border-default">
            <div className="flex flex-wrap items-center gap-2 border-b border-default bg-surface-sunken px-3 py-2 text-sm">
              <Badge size="sm">{line.op}</Badge> <code>{line.path}</code>
              {line.from ? (
                <>
                  {' '}
                  from <code>{line.from}</code>
                </>
              ) : null}
            </div>
            <div className="grid sm:grid-cols-2">
              <pre className={`${PRE} bg-status-bad-bg text-status-bad-fg`}>
                − {prettyJson(line.before) || '(absent)'}
              </pre>
              <pre className={`${PRE} bg-status-good-bg text-status-good-fg`}>
                + {prettyJson(line.after) || '(absent)'}
              </pre>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The thread as it stood after event `seq`, replayed client-side, and the patch that led there. */
export function ThreadViewer({
  current,
  events,
  seq,
}: {
  current: ContextThread;
  events: RunEvent[];
  seq: number;
}) {
  const initial = useMemo(() => initialThreadFrom(current, events), [current, events]);
  const replayed = useMemo(() => tryThreadAt(initial, events, seq), [initial, events, seq]);
  const selected = events.find((e) => e.seq === seq);
  const diff = useMemo(() => {
    if (selected?.type !== 'node.finished' || !replayed.ok) return undefined;
    const before = tryThreadAt(initial, events, seq - 1);
    return before.ok ? patchDiff(before.thread, replayed.thread, selected.patch) : undefined;
  }, [selected, initial, events, seq, replayed]);
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
                <li key={m.id} className="grid gap-1 rounded-md border border-default p-3">
                  <div className="flex items-center gap-2">
                    <Badge size="sm">{m.role}</Badge>{' '}
                    <code className="text-xs text-muted">{m.nodeId}</code>
                  </div>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Variables</h3>
            <pre
              className={`${PRE} overflow-auto rounded-md border border-default bg-code-bg text-code-fg`}
              aria-label="Variables"
            >
              {prettyJson(thread.vars)}
            </pre>
          </div>
          <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm font-semibold [&::-webkit-details-marker]:hidden">
              <Icon
                name="chevron"
                className="-rotate-90 text-muted transition-transform group-open:rotate-0"
              />
              Full thread JSON
            </summary>
            <pre
              className={`${PRE} mt-2 overflow-auto rounded-md border border-default bg-code-bg text-code-fg`}
              data-testid="thread-json"
            >
              {prettyJson(thread)}
            </pre>
          </details>
        </div>
      </Card>
    </div>
  );
}
