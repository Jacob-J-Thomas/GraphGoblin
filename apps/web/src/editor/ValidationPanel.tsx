import { Icon } from '../components/icons/index.js';
import { cn } from '../lib/utils.js';
import type { EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

/** Live results of the same validation the API runs on publish. Click an issue to open its node. */
export function ValidationPanel({ issues }: { issues: EditorIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return (
    <section
      aria-label="Validation"
      className="grid gap-2 border-t border-default bg-surface-raised px-5 pt-4 pb-5 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Validation</h2>
        {issues.length > 0 ? (
          <p className="text-xs text-muted">
            {errors} error{errors === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>
      {issues.length === 0 ? (
        <p className="inline-flex items-center gap-1.5 font-medium text-status-good-fg">
          <Icon name="check-circle" />
          Ready to publish
        </p>
      ) : (
        <ul className="grid max-h-48 gap-1.5 overflow-auto">
          {issues.map((issue, index) => (
            <li key={index}>
              <button
                type="button"
                className="block w-full cursor-pointer rounded-md border border-default bg-surface-raised px-3 py-2 text-left text-xs leading-normal hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-surface-raised"
                disabled={!issue.nodeId}
                onClick={() => useEditorStore.getState().openNode(issue.nodeId!)}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-semibold [&_svg]:size-3 [&_svg]:stroke-[2.8]',
                    issue.severity === 'error' ? 'text-status-bad-fg' : 'text-status-warn-fg',
                  )}
                >
                  <Icon name={issue.severity === 'error' ? 'failed' : 'alert'} />
                  {issue.code}
                </span>{' '}
                {issue.nodeId ? <code>{issue.nodeId}</code> : null}
                {issue.path ? <code>.{issue.path}</code> : null} {issue.message}
              </button>
              {issue.discard ? (
                <button
                  type="button"
                  className="mt-1 cursor-pointer text-xs text-link underline underline-offset-2"
                  aria-label={`Discard unparsed text at ${issue.discard.path}`}
                  onClick={() => {
                    const { scope, path } = issue.discard!;
                    useEditorStore.getState().setFieldError(scope, path, undefined);
                  }}
                >
                  Discard text
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
