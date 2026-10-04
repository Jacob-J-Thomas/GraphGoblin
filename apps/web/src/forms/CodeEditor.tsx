import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, placeholder as placeholderExt } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils.js';
import { codeTheme } from '../styles/code-theme.js';

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
  /** Square the bottom corners so a preview can sit directly under the editor. */
  attached?: boolean;
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
  attached = false,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const attributesRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        codeTheme,
        languageFor(language),
        EditorView.lineWrapping,
        attributesRef.current.of(
          EditorView.contentAttributes.of({
            'aria-label': label,
            ...(id ? { id } : {}),
            'data-language': language,
          }),
        ),
        // At least `minLines` lines of 20 px (the theme's line height) plus the 6 px padding.
        EditorView.theme({ '.cm-content': { minHeight: `${minLines * 20 + 12}px` } }),
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

  // A stable collection row can move to a different path/label without recreating its editor.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: attributesRef.current.reconfigure(
        EditorView.contentAttributes.of({
          'aria-label': label,
          ...(id ? { id } : {}),
          'data-language': language,
        }),
      ),
    });
  }, [id, label, language]);

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
      className={cn(
        'min-w-0 overflow-hidden rounded-md border border-strong bg-code-bg text-sm',
        'focus-within:border-accent-strong focus-within:outline-2 focus-within:outline-offset-2',
        'focus-within:outline-focus',
        attached && 'rounded-b-none',
      )}
    />
  );
}
