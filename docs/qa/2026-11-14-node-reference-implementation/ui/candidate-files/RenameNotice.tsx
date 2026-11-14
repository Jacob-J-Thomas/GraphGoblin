import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { Alert } from '../components/ui/index.js';
import { IssueList } from './IssuePopover.js';
import type { EditorIssue } from './model.js';
import { useEditorStore, type RenameReport } from './store.js';

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a rename changed, in one sentence, or undefined when it changed only the id. */
export function renameSummary({ references, connections }: RenameReport): string | undefined {
  if (references > 0)
    return `Updated ${counted(references, 'reference')} in expressions, templates and mutation paths${
      connections > 0 ? `, and ${counted(connections, 'connection')}` : ''
    }.`;
  return connections > 0 ? `Updated ${counted(connections, 'connection')}.` : undefined;
}

/**
 * Whether a report has something to say: references it updated or places to review. A rename that
 * changed only the id and its connections stays quiet, as renames did before.
 */
export function hasRenameNotice(report: RenameReport | undefined): report is RenameReport {
  return report !== undefined && (report.references > 0 || report.warnings.length > 0);
}

/**
 * The latest rename's report (#273): how many references and connections it updated, and the
 * places where the old id may remain because the domain could not settle them (dynamic, inherited
 * or authored keys, unverifiable edits, scripts and generated patches). Rows on a node that is
 * still in the draft open it at the field (`onChoose`); others only inform. Plain text, JSON values
 * and scripts are never described as updated.
 *
 * The editor shows it above the canvas and, while the node dialog is open (the page is inert
 * then), inside the dialog as well, as it does the draft conflict notice.
 */
export function RenameNotice({
  definition,
  onChoose,
  onDismissed,
}: {
  definition: LoopDefinitionInput;
  onChoose: (issue: EditorIssue) => void;
  /** After Dismiss: put focus somewhere that stays. */
  onDismissed?: () => void;
}) {
  const report = useEditorStore((s) => s.renameReport);
  if (!hasRenameNotice(report)) return null;
  const present = new Set(definition.nodes.map((node) => node.id));
  const reviewable = report.warnings.filter(
    (issue) => issue.nodeId !== undefined && present.has(issue.nodeId),
  );
  const informational = report.warnings.filter((issue) => !reviewable.includes(issue));
  const summary = renameSummary(report);
  const places = report.warnings.length;
  return (
    <Alert
      tone={places > 0 ? 'warn' : 'info'}
      title={`Renamed ${report.from} to ${report.to}`}
      onDismiss={() => {
        useEditorStore.getState().dismissRenameReport();
        onDismissed?.();
      }}
    >
      <div className="grid gap-1.5">
        <p>{summary ? `${summary} ` : null}Plain text, JSON values and scripts are not changed.</p>
        {places > 0 ? (
          <>
            <p>
              Review {places === 1 ? 'one place' : `${String(places)} places`} where{' '}
              <code>{report.from}</code> may remain:
            </p>
            {reviewable.length > 0 ? (
              <IssueList issues={reviewable} subject onChoose={onChoose} />
            ) : null}
            {informational.length > 0 ? <IssueList issues={informational} subject /> : null}
          </>
        ) : null}
        <p>Undo reverses the whole rename.</p>
      </div>
    </Alert>
  );
}
