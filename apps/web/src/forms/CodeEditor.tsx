import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/legacy-modes/mode/javascript';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, placeholder as placeholderExt } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { FIELD_FRAME } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { codeLinesHeight, codeTheme } from '../styles/code-theme.js';

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
  id?: string | undefined;
  placeholder?: string | undefined;
  /** The editor's height when it holds fewer lines: 36 px for one line, at least 44 px on touch. */
  minLines?: number;
  /** Square the bottom corners so a preview can sit directly under the editor. */
  attached?: boolean;
  /** Ids of the help and error text that describe the field. */
  describedBy?: string | undefined;
  /** Draws the bad-tone edge and sets `aria-invalid`. */
  invalid?: boolean | undefined;
  /** Sets `aria-required`. */
  required?: boolean | undefined;
}

/** The ARIA and data attributes of the editable content (CodeMirror's `role="textbox"`). */
function contentAttributes({
  label,
  id,
  language,
  describedBy,
  invalid,
  required,
}: Pick<CodeEditorProps, 'label' | 'id' | 'language' | 'describedBy' | 'invalid' | 'required'>) {
  return EditorView.contentAttributes.of({
    'aria-label': label,
    ...(id ? { id } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(invalid ? { 'aria-invalid': 'true' } : {}),
    ...(required ? { 'aria-required': 'true' } : {}),
    'data-language': language,
  });
}

/**
 * A CodeMirror 6 editor bound to a string value. External value changes replace the document. Its
 * frame matches the text inputs (FIELD_FRAME): the same edge, corners, hover, focus ring, and
 * invalid edge. Tab is not captured, so Tab and Shift+Tab move focus out of the editor as from any
 * other field.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  id,
  placeholder,
  minLines = 1,
  attached = false,
  describedBy,
  invalid = false,
  required = false,
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
          contentAttributes({ label, id, language, describedBy, invalid, required }),
        ),
        EditorView.theme({
          '.cm-content': { minHeight: codeLinesHeight(minLines) },
          '@media (pointer: coarse)': {
            '.cm-content': { minHeight: `max(44px, ${codeLinesHeight(minLines)})` },
          },
        }),
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

  // A stable collection row can move to a different path/label without recreating its editor, and
  // its description and state follow the field's help and errors.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: attributesRef.current.reconfigure(
        contentAttributes({ label, id, language, describedBy, invalid, required }),
      ),
    });
  }, [id, label, language, describedBy, invalid, required]);

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
      data-invalid={invalid || undefined}
      className={cn(
        FIELD_FRAME,
        'min-w-0 overflow-hidden bg-code-bg text-sm',
        'focus-within:border-accent-strong focus-within:outline-2 focus-within:outline-offset-2',
        'focus-within:outline-focus data-invalid:border-status-bad-border',
        attached && 'rounded-b-none',
      )}
    />
  );
}
