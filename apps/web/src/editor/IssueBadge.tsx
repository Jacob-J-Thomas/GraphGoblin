import { Icon } from '../components/icons/index.js';
import { Popover } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import {
  IssueList,
  refocusAfterDiscard,
  SEVERITY,
  SEVERITY_CLASSES,
  worstSeverity,
} from './IssuePopover.js';
import { countsLabel, issuesLabel, type EditorIssue } from './model.js';

/**
 * xyflow ignores pointer drags, pans, wheel zooms, and keys that start inside elements with these
 * classes, so pressing the badge or working in its popover never drags the node, pans or zooms the
 * canvas, or selects or moves the node from the keyboard.
 */
const CANVAS_INERT = 'nodrag nopan nowheel nokey';

/**
 * A node's validation issues as a small button: the icon of the worst severity (a cross on the bad
 * tone for any error, a warning triangle on the warn tone for warnings only), plus the count when
 * there are two or more. Its name says it all ("2 issues on prep"). Hover, keyboard focus, or a
 * click opens a popover listing each issue; choosing one calls `onChoose`, which opens the node at
 * the issue's field (on the canvas) or focuses the field (in the node editor). A click on the badge
 * opens only the popover, never the node's editor.
 */
export function IssueBadge({
  nodeId,
  issues,
  onChoose,
  fallbackFocus,
  className,
}: {
  nodeId: string;
  issues: readonly EditorIssue[];
  onChoose: (issue: EditorIssue) => void;
  /** Where focus goes when "Discard the unparsed text" removed the last issue, and with it the badge. */
  fallbackFocus?: () => HTMLElement | null | undefined;
  className?: string;
}) {
  const severity = worstSeverity(issues);
  const { icon } = SEVERITY[severity];
  return (
    <Popover
      label={`Issues on ${nodeId}`}
      className={CANVAS_INERT}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`${issuesLabel(issues.length)} on ${nodeId}`}
          data-severity={severity}
          className={cn(
            CANVAS_INERT,
            'touch-target inline-flex h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full border px-1.5',
            'text-[11px] leading-none font-semibold [&_svg]:size-3 [&_svg]:stroke-[2.6]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            SEVERITY_CLASSES[severity],
            className,
          )}
        >
          <Icon name={icon} />
          {issues.length > 1 ? issues.length : null}
        </button>
      )}
    >
      {({ close }) => (
        <div className="grid gap-1.5">
          <p className="px-2 pt-0.5 text-xs font-semibold text-muted">
            {countsLabel(issues)} on <code>{nodeId}</code>
          </p>
          <IssueList
            issues={issues}
            onChoose={(issue) => {
              close();
              onChoose(issue);
            }}
            onDiscard={() => refocusAfterDiscard(close, fallbackFocus)}
          />
        </div>
      )}
    </Popover>
  );
}
