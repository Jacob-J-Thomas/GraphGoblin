import { EditorView } from '@codemirror/view';
import { act, screen } from '@testing-library/react';

/** Replace the document of the CodeMirror editor labelled `label`, as typing would. */
export function setCode(label: string, text: string, index = 0): void {
  const content = screen
    .getAllByLabelText(label)
    .filter((el) => el.classList.contains('cm-content'))[index];
  if (!content) throw new Error(`no code editor labelled ${label}`);
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error(`no EditorView for ${label}`);
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

/** The current text of the CodeMirror editor labelled `label`. */
export function getCode(label: string, index = 0): string {
  const content = screen
    .getAllByLabelText(label)
    .filter((el) => el.classList.contains('cm-content'))[index];
  if (!content) throw new Error(`no code editor labelled ${label}`);
  return EditorView.findFromDOM(content)?.state.doc.toString() ?? '';
}
