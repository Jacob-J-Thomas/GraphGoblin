import { useEffect, useState } from 'react';
import { CodeEditor, type CodeLanguage } from './CodeEditor.js';
import { renderPreview, type PreviewKind, type PreviewResult } from './preview.js';

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

/** A template (Liquid) or expression (JSONata) field: CodeMirror plus the live preview. */
export function CodeField({
  kind,
  value,
  onChange,
  label,
  id,
}: {
  kind: PreviewKind;
  value: string;
  onChange: (value: string) => void;
  label: string;
  id: string;
}) {
  const language: CodeLanguage = kind === 'template' ? 'liquid' : 'jsonata';
  return (
    <div>
      <CodeEditor
        value={value}
        onChange={onChange}
        language={language}
        label={label}
        id={id}
        attached
      />
      <Preview kind={kind} source={value} />
    </div>
  );
}
