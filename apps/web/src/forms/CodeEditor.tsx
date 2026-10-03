import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, placeholder as placeholderExt } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

export type CodeLanguage = 'liquid' | 'jsonata' | 'json';

/**
 * Liquid uses the Jinja2 stream mode (same delimiters and tag shapes); JSONata uses the JavaScript
 * stream mode, which highlights its operators, strings, and paths well enough for authoring.
 */
function languageFor(language: CodeLanguage): Extension {
  switch (language) {
    case 'liquid':
      return StreamLanguage.define(jinja2);
    case 'jsonata':
      return StreamLanguage.define(javascript);
    case 'json':
      return json();
  }
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  label: string;
  id?: string;
  placeholder?: string;
  minLines?: number;
}

/** A CodeMirror 6 editor bound to a string value. External value changes replace the document. */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  id,
  placeholder,
  minLines = 2,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        languageFor(language),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': label,
          ...(id ? { id } : {}),
          'data-language': language,
        }),
        EditorView.theme({ '.cm-content': { minHeight: `${minLines * 1.4}em` } }),
        ...(placeholder ? [placeholderExt(placeholder)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const editor = new EditorView({ state, parent: hostRef.current as HTMLDivElement });
    viewRef.current = editor;
    return () => {
      editor.destroy();
      viewRef.current = null;
    };
    // The editor is created once per language; value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const editor = viewRef.current as EditorView;
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-md border border-slate-300 bg-white text-sm focus-within:outline-2 focus-within:outline-emerald-600"
    />
  );
}
