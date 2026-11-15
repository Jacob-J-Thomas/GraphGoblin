import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useId, useRef } from 'react';
import { Icon } from '../components/icons/index.js';
import { Button, Popover } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { isProtectedVoiceEdge, VOICE_STEP_MESSAGE } from './chat-protection.js';
import {
  IssueList,
  refocusAfterDiscard,
  SEVERITY,
  SEVERITY_CLASSES,
  worstSeverity,
} from './IssuePopover.js';
import { countsLabel, groupIssues, issuesLabel, type EditorIssue } from './model.js';
import { removeStrandedEdge, strandedEdges } from './stranded-edges.js';
import { useEditorStore } from './store.js';

const GROUP_LABEL = 'px-2 pt-0.5 text-xs font-semibold text-muted';

/**
 * Where the API's own checks (cron syntax, subloop references: `POST /loops/{id}/validate`) stand
 * for the saved draft: under way, failed (offline, say), or done.
 */
export type ServerCheck = 'pending' | 'error' | 'done';

/** What the indicator says when there is nothing to list, by the server check's state. */
const STATUS: Record<ServerCheck, { icon: 'queued' | 'info' | 'check-circle'; text: string }> = {
  pending: { icon: 'queued', text: 'Checking…' },
  error: { icon: 'info', text: 'Validation unavailable' },
  done: { icon: 'check-circle', text: 'Ready to publish' },
};

/**
 * The loop's validation at a glance, beside Publish. With no issues it says "Ready to publish",
 * but only once the API's checks of the saved draft have answered: until then "Checking…", and
 * "Validation unavailable" (muted: nothing is known to be wrong) when they could not run.
 * Otherwise it is a button named by the counts ("2 errors, 1 warning", from the same merged list
 * Publish checks) that opens a popover listing every loop-level and edge issue in full, then one
 * row per node with issues ("prep: 2 issues"), which opens that node; each node's badge on the
 * canvas has the detail. A stored edge the canvas cannot draw (from a missing node or port, into a
 * missing node or a trigger) has nothing to select on the canvas, so the popover's "Connections
 * the canvas cannot draw" group lists each one by its stored ends with one Remove edge (#207): one
 * undo step, refused for a protected Chat voice step. The group is read from the draft, so it is
 * there also while the draft does not parse; it adds nothing to the counts. Such an edge always
 * comes with an error (the schema's, or the edge's own), so the popover is there to open.
 */
export function ValidationIndicator({
  issues,
  definition,
  check = 'done',
  readyLabel,
  unavailableReason,
}: {
  issues: readonly EditorIssue[];
  definition: LoopDefinitionInput;
  check?: ServerCheck;
  readyLabel?: string;
  unavailableReason?: string | undefined;
}) {
  const loopGroupId = useId();
  const nodeGroupId = useId();
  // Where focus goes when "Discard the unparsed text" removed the last issue, and with it the button.
  const readyRef = useRef<HTMLSpanElement>(null);
  if (issues.length === 0) {
    const status = STATUS[check];
    return (
      <span
        ref={readyRef}
        tabIndex={-1}
        title={
          check === 'error'
            ? (unavailableReason ??
              'The server’s checks (cron expressions, subloops) could not run; Publish runs them again.')
            : undefined
        }
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 text-sm font-medium',
          check === 'done' ? 'text-status-good-fg' : 'text-muted',
        )}
      >
        <Icon name={status.icon} />
        {check === 'done' && readyLabel ? readyLabel : status.text}
      </span>
    );
  }
  const severity = worstSeverity(issues);
  const { general, nodes } = groupIssues(issues, definition);
  return (
    <Popover
      label="Loop issues"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          data-severity={severity}
          className={cn(
            'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm font-semibold whitespace-nowrap pointer-coarse:h-11',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-[15px] [&_svg]:stroke-[2.4]',
            SEVERITY_CLASSES[severity],
          )}
        >
          <Icon name={SEVERITY[severity].icon} />
          {countsLabel(issues)}
        </button>
      )}
    >
      {({ close }) => (
        <div className="grid gap-3">
          {general.length > 0 ? (
            <div role="group" aria-labelledby={loopGroupId} className="grid gap-1.5">
              <p id={loopGroupId} className={GROUP_LABEL}>
                Loop and connections
              </p>
              <IssueList
                issues={general}
                subject
                onDiscard={() => refocusAfterDiscard(close, () => readyRef.current)}
              />
            </div>
          ) : null}
          <StrandedEdges
            definition={definition}
            onRemoved={() => refocusAfterDiscard(close, () => readyRef.current)}
          />
          {nodes.length > 0 ? (
            <div role="group" aria-labelledby={nodeGroupId} className="grid gap-1.5">
              <p id={nodeGroupId} className={GROUP_LABEL}>
                Nodes
              </p>
              <ul className="grid gap-1">
                {nodes.map(({ nodeId, issues: list }) => {
                  const worst = worstSeverity(list);
                  return (
                    <li key={nodeId}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover pointer-coarse:min-h-11"
                        onClick={() => {
                          close();
                          useEditorStore.getState().openNode(nodeId);
                        }}
                      >
                        <span
                          className={cn(
                            'inline-grid size-5 shrink-0 place-items-center rounded-full border [&_svg]:size-3 [&_svg]:stroke-[2.6]',
                            SEVERITY_CLASSES[worst],
                          )}
                        >
                          <Icon name={SEVERITY[worst].icon} />
                        </span>
                        <span>
                          <code>{nodeId}</code>: {issuesLabel(list.length)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

/**
 * The open popover's "Connections the canvas cannot draw" group (#207): each such stored edge by its
 * id and stored ends, with its one Remove edge, disabled with the voice-step message for a protected
 * Chat edge. Read from the draft only while the popover is open, since every edge's source card is
 * checked for its port. Nothing when there are none.
 */
function StrandedEdges({
  definition,
  onRemoved,
}: {
  definition: LoopDefinitionInput;
  onRemoved: () => void;
}) {
  const groupId = useId();
  const system = useEditorStore((s) => s.systemChat);
  const stranded = strandedEdges(definition);
  if (stranded.length === 0) return null;
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1.5">
      <p id={groupId} className={GROUP_LABEL}>
        Connections the canvas cannot draw
      </p>
      <ul className="grid gap-1">
        {stranded.map((edge) => {
          const blocked = isProtectedVoiceEdge(definition, system, edge);
          return (
            <li key={edge.id} className="grid justify-items-start gap-1">
              <span className="px-2 text-sm leading-snug text-default">
                <code>{edge.id}</code> from <code>{edge.from.node}</code> output{' '}
                <code>{edge.from.port}</code> to <code>{edge.to.node}</code>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-2"
                disabled={blocked}
                title={blocked ? VOICE_STEP_MESSAGE : undefined}
                onClick={() => {
                  if (removeStrandedEdge(edge)) onRemoved();
                }}
              >
                Remove edge {edge.id}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
