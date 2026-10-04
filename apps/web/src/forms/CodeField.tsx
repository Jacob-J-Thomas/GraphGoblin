import { useEffect, useState } from 'react';
import { HelpText } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { CodeEditor, type CodeLanguage } from './CodeEditor.js';
import { renderPreview, type PreviewKind, type PreviewResult } from './preview.js';

/** The language a code field takes (Liquid, JSONata, JSON), as a small tag beside its label. */
export function LanguageTag({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-default bg-surface-sunken px-1.5 font-mono text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

/** Live preview of a template or expression against the sample thread. */
export function Preview({ kind, source }: { kind: PreviewKind; source: string }) {
  const [result, setResult] = useState<PreviewResult | undefined>();
  useEffect(() => {
    let cancelled = false;
    void renderPreview(kind, source).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, source]);
  return (
    <div
      className="rounded-b-md border border-t-0 border-strong bg-surface-sunken px-3 py-1.5 text-xs leading-snug"
      data-testid="preview"
    >
      <span className="font-semibold whitespace-nowrap text-muted">Preview (sample thread): </span>
      {result === undefined ? (
        <span className="text-subtle">rendering…</span>
      ) : result.ok ? (
        <pre className="inline whitespace-pre-wrap text-default">{result.output}</pre>
      ) : (
        <span className="font-medium text-status-bad-fg">{result.error}</span>
      )}
    </div>
  );
}

/**
 * A template (Liquid) or expression (JSONata) field: CodeMirror plus the live preview. The field's
 * help and error ids (`describedBy`), its invalid state, and `required` reach the editor, and a
 * required expression left blank says so under it, linked the same way.
 */
export function CodeField({
  kind,
  value,
  onChange,
  label,
  id,
  optional = false,
  errorMessage,
  requiredMessage,
  describedBy,
  invalid = false,
}: {
  kind: PreviewKind;
  value: string;
  onChange: (value: string) => void;
  label: string;
  id: string;
  optional?: boolean;
  errorMessage?: string | undefined;
  requiredMessage?: string | undefined;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
}) {
  const language: CodeLanguage = kind === 'template' ? 'liquid' : 'jsonata';
  const [edited, setEdited] = useState(false);
  const blank = kind === 'expression' ? value.trim() === '' : value === '';
  const showPreview = !blank || (kind === 'template' && !optional);
  const missing = kind === 'expression' && !optional && blank && !errorMessage;
  const missingId = `${id}-missing`;
  return (
    <div>
      <CodeEditor
        value={value}
        onChange={(next) => {
          setEdited(true);
          onChange(next);
        }}
        language={language}
        label={label}
        id={id}
        attached={showPreview}
        describedBy={cn(describedBy, missing && missingId) || undefined}
        invalid={invalid || missing}
        required={!optional}
      />
      {missing ? (
        <HelpText id={missingId} tone="bad" role={edited ? 'alert' : undefined}>
          {requiredMessage ?? 'Required'}
        </HelpText>
      ) : null}
      {showPreview ? <Preview kind={kind} source={value} /> : null}
    </div>
  );
}
