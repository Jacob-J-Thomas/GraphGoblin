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
    <div className="mt-1 rounded bg-slate-50 p-1 text-xs" data-testid="preview">
      <span className="font-semibold text-slate-600">Preview (sample thread): </span>
      {result === undefined ? (
        <span className="text-slate-500">rendering…</span>
      ) : result.ok ? (
        <pre className="inline whitespace-pre-wrap text-slate-800">{result.output}</pre>
      ) : (
        <span className="text-orange-800">{result.error}</span>
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
      <CodeEditor value={value} onChange={onChange} language={language} label={label} id={id} />
      <Preview kind={kind} source={value} />
    </div>
  );
}
