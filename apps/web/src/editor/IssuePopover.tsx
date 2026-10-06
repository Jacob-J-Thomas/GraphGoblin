import { Icon } from '../components/icons/index.js';
import { Badge, Button, type PopoverControls } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import type { EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

/** Severity by more than colour: a tone, an icon shape, and a word. */
export const SEVERITY = {
  error: { tone: 'bad', icon: 'failed', word: 'Error' },
  warning: { tone: 'warn', icon: 'alert', word: 'Warning' },
} as const;

/** The tone classes of an issue badge or indicator: fill, text, and a 3:1 edge. */
export const SEVERITY_CLASSES = {
  error: 'border-status-bad-border bg-status-bad-bg text-status-bad-fg',
  warning: 'border-status-warn-border bg-status-warn-bg text-status-warn-fg',
} as const;

/** The worst severity in a non-empty list. */
export function worstSeverity(issues: readonly EditorIssue[]): EditorIssue['severity'] {
  return issues.some((i) => i.severity === 'error') ? 'error' : 'warning';
}

/**
 * Close a popover after "Discard text", with focus back on its trigger; when the discard removed
 * the last issue and so the trigger too, focus goes to `fallback` instead of the page.
 */
export function refocusAfterDiscard(
  close: PopoverControls['close'],
  fallback?: () => HTMLElement | null | undefined,
): void {
  close({ returnFocus: true });
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    fallback?.()?.focus();
  }, 0);
}

function IssueSummary({ issue, subject }: { issue: EditorIssue; subject: boolean }) {
  const severity = SEVERITY[issue.severity];
  const where = subject
    ? issue.nodeId
      ? `node ${issue.nodeId}`
      : issue.edgeId
        ? `edge ${issue.edgeId}`
        : undefined
    : undefined;
  // The spaces between the parts keep them apart in the row's accessible name; grid and flex
  // layout ignore them.
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={severity.tone} size="sm">
          <Icon name={severity.icon} />
          {severity.word}
        </Badge>{' '}
        <span className="font-mono text-2xs text-muted">{issue.code}</span>
      </span>{' '}
      <span className="text-sm leading-snug text-default">{issue.message}</span>
      {where || issue.path ? (
        <>
          {' '}
          <span className="flex flex-wrap gap-x-2 text-xs text-muted">
            {where ? <code>{where}</code> : null}
            {where && issue.path ? ' ' : null}
            {issue.path ? <code>{issue.path}</code> : null}
          </span>
        </>
      ) : null}
    </>
  );
}

const ROW = 'grid w-full gap-1 rounded-md px-2 py-1.5 text-left pointer-coarse:min-h-11';

/**
 * Issues as rows: each shows its severity (icon and word), code, message, and field path. With
 * `onChoose`, each row is a button (open the node at the field); otherwise the rows only inform.
 * An issue for text that does not parse (`FIELD_UNPARSED`) keeps its "Discard text" button, which
 * drops the text and the issue.
 */
export function IssueList({
  issues,
  onChoose,
  onDiscard,
  subject = false,
}: {
  issues: readonly EditorIssue[];
  onChoose?: ((issue: EditorIssue) => void) | undefined;
  /** Called after "Discard text" has dropped an issue's text. */
  onDiscard?: ((issue: EditorIssue) => void) | undefined;
  /** Name each issue's node or edge (for a list from the whole loop). */
  subject?: boolean;
}) {
  return (
    <ul className="grid gap-1">
      {issues.map((issue, index) => (
        <li key={index} className="grid justify-items-start gap-1">
          {onChoose ? (
            <button
              type="button"
              className={cn(ROW, 'cursor-pointer hover:bg-surface-hover')}
              onClick={() => onChoose(issue)}
            >
              <IssueSummary issue={issue} subject={subject} />
            </button>
          ) : (
            <div className={ROW}>
              <IssueSummary issue={issue} subject={subject} />
            </div>
          )}
          {issue.discard ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              aria-label={`Discard unparsed text at ${issue.discard.path}`}
              onClick={() => {
                const { scope, path } = issue.discard!;
                useEditorStore.getState().setFieldError(scope, path, undefined, 'discard');
                onDiscard?.(issue);
              }}
            >
              Discard text
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
