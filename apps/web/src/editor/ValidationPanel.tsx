import type { EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

/** Live results of the same validation the API runs on publish. Click an issue to select its node. */
export function ValidationPanel({ issues }: { issues: EditorIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return (
    <section aria-label="Validation" className="text-sm">
      <h2 className="mb-1 text-xs font-semibold text-slate-600 uppercase">Validation</h2>
      {issues.length === 0 ? (
        <p className="text-sky-800">✓ Ready to publish</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-slate-600">
            {errors} error{errors === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}
          </p>
          <ul className="max-h-48 space-y-1 overflow-auto">
            {issues.map((issue, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="w-full rounded px-1 text-left text-xs hover:bg-slate-100"
                  disabled={!issue.nodeId}
                  onClick={() => useEditorStore.getState().select(issue.nodeId)}
                >
                  <span
                    className={issue.severity === 'error' ? 'text-orange-800' : 'text-amber-700'}
                  >
                    {issue.severity === 'error' ? '✗' : '!'} {issue.code}
                  </span>{' '}
                  {issue.nodeId ? <code>{issue.nodeId}</code> : null}
                  {issue.path ? <code>.{issue.path}</code> : null} {issue.message}
                </button>
                {issue.discard ? (
                  <button
                    type="button"
                    className="ml-1 text-xs text-sky-800 underline"
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
        </>
      )}
    </section>
  );
}
