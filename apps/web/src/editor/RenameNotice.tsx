import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { Fragment } from 'react';
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

function configOf(definition: LoopDefinitionInput, nodeId: string): unknown {
  return definition.nodes.find((node) => node.id === nodeId)?.config;
}

/**
 * The latest rename's report (#273): how many references and connections it updated, and the
 * places where the old id may remain because the domain could not settle them (dynamic, inherited
 * or authored keys, unverifiable edits, scripts and generated patches). A row opens its node at
 * the field (`onChoose`) only while that node's config is still the value the rename left, which
 * undo and redo restore: after another edit of the node an index in the path can name a different
 * row, so its rows then only inform and the notice says the node changed. Loop-level rows, and
 * rows on a node no longer in the draft, only inform. Plain text, JSON values and scripts are
 * never described as updated.
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
  const unchanged = (nodeId: string) => {
    const config = configOf(definition, nodeId);
    return config !== undefined && config === configOf(report.definition, nodeId);
  };
  const reviewable = report.warnings.filter(
    (issue) => issue.nodeId !== undefined && unchanged(issue.nodeId),
  );
  const informational = report.warnings.filter((issue) => !reviewable.includes(issue));
  const changed = [
    ...new Set(
      informational.flatMap((issue) =>
        issue.nodeId !== undefined && configOf(definition, issue.nodeId) !== undefined
          ? [issue.nodeId]
          : [],
      ),
    ),
  ];
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
            {changed.length > 0 ? (
              <p>
                {changed.map((nodeId, index) => (
                  <Fragment key={nodeId}>
                    {index === 0 ? null : index === changed.length - 1 ? ' and ' : ', '}
                    <code>{nodeId}</code>
                  </Fragment>
                ))}{' '}
                changed after the rename. {changed.length === 1 ? 'Its' : 'Their'} places show where
                they were then and no longer open a field.
              </p>
            ) : null}
          </>
        ) : null}
        <p>Undo reverses the whole rename.</p>
      </div>
    </Alert>
  );
}
